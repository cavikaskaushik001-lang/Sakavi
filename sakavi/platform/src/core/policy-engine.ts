/**
 * Policy Engine — final authority on whether a tool invocation may proceed.
 * Agents cannot override policies. Content from repos/web is untrusted.
 */

import type { AgentId, Capability, ToolInvocation } from './types.js';
import { CAPABILITY_RISK } from './types.js';
import { killSwitch } from './kill-switch.js';
import { PolicyViolationError, KillSwitchActiveError } from './errors.js';
import { emitAudit } from './audit.js';

/** Private / metadata ranges that must never be contacted */
const BLOCKED_IP_PATTERNS = [
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[0-1])\./,
  /^169\.254\./,
  /^0\./,
  /^::1$/,
  /^fc00:/i,
  /^fe80:/i,
  /^localhost$/i,
  /^metadata\.google\.internal$/i,
  /^169\.254\.169\.254$/,
];

/** Default network allowlist when network is explicitly enabled */
const DEFAULT_NETWORK_ALLOWLIST = [
  'registry.npmjs.org',
  'pypi.org',
  'files.pythonhosted.org',
  'github.com',
  'api.github.com',
  'objects.githubusercontent.com',
  'codeload.github.com',
];

export interface PolicyContext {
  agentAllowedCapabilities: readonly Capability[];
  networkEnabled: boolean;
  networkAllowlist: string[];
  maxToolCallsForTask: number;
  currentToolCallCount: number;
  protectedBranches: string[];
}

export interface PolicyDecision {
  allow: boolean;
  reason?: string;
  sanitizedArgs?: unknown;
}

class PolicyEngine {
  private networkAllowlist = [...DEFAULT_NETWORK_ALLOWLIST];
  private protectedBranches = ['main', 'master', 'production', 'prod'];

  setNetworkAllowlist(hosts: string[]): void {
    // Operator only — agents cannot call this via tools
    this.networkAllowlist = hosts.map((h) => h.toLowerCase());
  }

  getNetworkAllowlist(): string[] {
    return [...this.networkAllowlist];
  }

  evaluate(inv: ToolInvocation, ctx: PolicyContext): PolicyDecision {
    if (killSwitch.isActive()) {
      throw new KillSwitchActiveError();
    }

    // 1. Capability must be in agent manifest
    if (!ctx.agentAllowedCapabilities.includes(inv.capability)) {
      return this.deny(inv, 'capability not in agent manifest');
    }

    // 2. Tool-call budget
    if (ctx.currentToolCallCount >= ctx.maxToolCallsForTask) {
      return this.deny(inv, 'max tool calls exceeded for task');
    }

    // 3. Tool-specific rules
    switch (inv.toolName) {
      case 'sandbox.execute':
        return this.policySandboxExecute(inv, ctx);
      case 'github.commit':
      case 'github.push':
      case 'github.upsert_file':
      case 'github.delete_file':
        return this.policyGithubWrite(inv, ctx);
      case 'github.create_pr':
        return this.policyGithubPr(inv);
      case 'database.query':
        return this.policyDatabase(inv);
      case 'network.fetch':
        return this.policyNetwork(inv, ctx);
      case 'secrets.reveal':
        return this.policySecrets(inv);
      case 'deployment.execute':
        return this.policyDeploy(inv);
      default:
        // Unknown tools require explicit registration; deny by default
        if (!KNOWN_TOOLS.has(inv.toolName)) {
          return this.deny(inv, `unknown tool: ${inv.toolName}`);
        }
        return { allow: true, sanitizedArgs: inv.args };
    }
  }

  private policySandboxExecute(inv: ToolInvocation, ctx: PolicyContext): PolicyDecision {
    if (inv.capability !== 'process.execute' && inv.capability !== 'workspace.write') {
      // reading via execute still needs process.execute
      if (inv.capability !== 'workspace.read') {
        return this.deny(inv, 'sandbox.execute requires process.execute or workspace.*');
      }
    }
    const args = asRecord(inv.args);
    const cmd = String(args.command ?? '');
    if (!cmd || cmd.length > 32_768) {
      return this.deny(inv, 'invalid or oversized command');
    }
    // Isolation is primary; still reject obvious escape attempts as defense-in-depth
    if (/\/var\/run\/docker\.sock/i.test(cmd) || /\b--privileged\b/i.test(cmd)) {
      return this.deny(inv, 'docker socket / privileged access forbidden');
    }
    if (!ctx.networkEnabled && /\b(npm\s+i|npm\s+install|pip3?\s+install|curl\s+|wget\s+)/i.test(cmd)) {
      return this.deny(inv, 'network disabled; package install / outbound fetch blocked');
    }
    return { allow: true, sanitizedArgs: { ...args, command: cmd } };
  }

  private policyGithubWrite(inv: ToolInvocation, ctx: PolicyContext): PolicyDecision {
    const args = asRecord(inv.args);
    const branch = String(args.branch ?? args.head ?? '');
    if (this.protectedBranches.includes(branch) || ctx.protectedBranches.includes(branch)) {
      return this.deny(inv, `direct writes to protected branch "${branch}" are forbidden`);
    }
    const path = String(args.path ?? '');
    if (isSecretPath(path)) {
      return this.deny(inv, 'refusing to write secret/protected path');
    }
    return { allow: true, sanitizedArgs: args };
  }

  private policyGithubPr(inv: ToolInvocation): PolicyDecision {
    const args = asRecord(inv.args);
    const head = String(args.head ?? '');
    const base = String(args.base ?? 'main');
    if (this.protectedBranches.includes(head)) {
      return this.deny(inv, 'PR head cannot be a protected branch');
    }
    if (head === base) {
      return this.deny(inv, 'PR head and base must differ');
    }
    return { allow: true, sanitizedArgs: args };
  }

  private policyDatabase(inv: ToolInvocation): PolicyDecision {
    const args = asRecord(inv.args);
    const sql = String(args.sql ?? args.query ?? '').trim();
    const upper = sql.toUpperCase();
    const destructive =
      /^\s*(DROP|TRUNCATE|ALTER\s+.*\s+DROP|DELETE\s+FROM\s+\w+\s*;?\s*$)/i.test(sql) ||
      upper.includes('DROP TABLE') ||
      upper.includes('DROP DATABASE');

    if (destructive && inv.capability !== 'database.destructive') {
      return this.deny(inv, 'destructive SQL requires database.destructive capability');
    }
    if (inv.capability === 'database.read' && !/^\s*(SELECT|SHOW|EXPLAIN|WITH)\b/i.test(sql)) {
      return this.deny(inv, 'database.read only allows SELECT/SHOW/EXPLAIN');
    }
    return { allow: true, sanitizedArgs: args };
  }

  private policyNetwork(inv: ToolInvocation, ctx: PolicyContext): PolicyDecision {
    if (!ctx.networkEnabled) {
      return this.deny(inv, 'network is disabled for this task');
    }
    const args = asRecord(inv.args);
    const url = String(args.url ?? '');
    let host: string;
    try {
      host = new URL(url).hostname.toLowerCase();
    } catch {
      return this.deny(inv, 'invalid URL');
    }
    for (const pat of BLOCKED_IP_PATTERNS) {
      if (pat.test(host)) {
        return this.deny(inv, `blocked host/IP range: ${host}`);
      }
    }
    const allow = ctx.networkAllowlist.length ? ctx.networkAllowlist : this.networkAllowlist;
    if (!allow.some((h) => host === h || host.endsWith('.' + h))) {
      return this.deny(inv, `host not in allowlist: ${host}`);
    }
    return { allow: true, sanitizedArgs: args };
  }

  private policySecrets(inv: ToolInvocation): PolicyDecision {
    if (inv.capability !== 'secrets.request') {
      return this.deny(inv, 'secrets.reveal requires secrets.request');
    }
    return { allow: true, sanitizedArgs: inv.args };
  }

  private policyDeploy(inv: ToolInvocation): PolicyDecision {
    if (inv.capability !== 'deployment.execute') {
      return this.deny(inv, 'deployment.execute capability required');
    }
    const args = asRecord(inv.args);
    if (!args.planId || !args.approvalId) {
      return this.deny(inv, 'deployment requires planId and approvalId');
    }
    return { allow: true, sanitizedArgs: args };
  }

  private deny(inv: ToolInvocation, reason: string): PolicyDecision {
    emitAudit({
      agentId: inv.agentId,
      taskId: inv.taskId,
      userId: inv.userId,
      tool: inv.toolName,
      capability: inv.capability,
      resultStatus: 'denied',
      riskLevel: CAPABILITY_RISK[inv.capability],
      input: inv.args,
      meta: { reason: reason.slice(0, 300) },
    });
    return { allow: false, reason };
  }
}

const KNOWN_TOOLS = new Set([
  'sandbox.execute',
  'sandbox.create',
  'sandbox.destroy',
  'github.status',
  'github.list_tree',
  'github.read_file',
  'github.search_code',
  'github.create_branch',
  'github.upsert_file',
  'github.delete_file',
  'github.create_pr',
  'github.commit',
  'github.push',
  'database.query',
  'network.fetch',
  'secrets.reveal',
  'deployment.plan',
  'deployment.execute',
  'deployment.health',
  'research.search',
  'browser.navigate',
  'browser.snapshot',
  'security.scan',
  'agent.delegate',
  'workspace.read_file',
  'workspace.write_file',
  'workspace.list',
]);

function asRecord(args: unknown): Record<string, unknown> {
  if (args && typeof args === 'object' && !Array.isArray(args)) {
    return args as Record<string, unknown>;
  }
  return {};
}

function isSecretPath(path: string): boolean {
  return /(^|\/)(\.env|\.env\..*|\.pem|\.key|credentials|id_rsa|id_ed25519|\.aws\/|\.ssh\/)/i.test(
    path
  );
}

export const policyEngine = new PolicyEngine();

export function assertPolicy(inv: ToolInvocation, ctx: PolicyContext): unknown {
  const decision = policyEngine.evaluate(inv, ctx);
  if (!decision.allow) {
    throw new PolicyViolationError(decision.reason || 'policy denied', {
      tool: inv.toolName,
      capability: inv.capability,
    });
  }
  return decision.sanitizedArgs ?? inv.args;
}
