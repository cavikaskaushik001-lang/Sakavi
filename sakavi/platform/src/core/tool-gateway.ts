/**
 * Tool Gateway — sole entry for privileged operations.
 *
 * Flow:
 *   Agent → Gateway → kill-switch → schema validate → capability → policy →
 *   approval check → execute → audit
 */

import type {
  AgentId,
  AgentManifest,
  Capability,
  ToolInvocation,
  ToolResult,
} from './types.js';
import { ToolInvocationSchema, CAPABILITY_RISK } from './types.js';
import { capabilityManager } from './capability-manager.js';
import { assertPolicy, type PolicyContext } from './policy-engine.js';
import { approvalService } from './approval.js';
import { emitAudit } from './audit.js';
import { killSwitch } from './kill-switch.js';
import {
  ApprovalRequiredError,
  CapabilityDeniedError,
  PlatformError,
  ValidationError,
} from './errors.js';

export type ToolHandler = (args: unknown, inv: ToolInvocation) => Promise<unknown>;

export interface GatewayContext {
  getManifest(agentId: AgentId): AgentManifest;
  getTaskToolCount(taskId: string): number;
  incrementTaskToolCount(taskId: string): void;
  isNetworkEnabled(taskId: string): boolean;
}

class ToolGateway {
  private readonly handlers = new Map<string, ToolHandler>();
  private ctx: GatewayContext | null = null;

  setContext(ctx: GatewayContext): void {
    this.ctx = ctx;
  }

  register(toolName: string, handler: ToolHandler): void {
    this.handlers.set(toolName, handler);
  }

  has(toolName: string): boolean {
    return this.handlers.has(toolName);
  }

  listTools(): string[] {
    return [...this.handlers.keys()];
  }

  async invoke(raw: ToolInvocation): Promise<ToolResult> {
    const start = Date.now();
    let auditId = '';

    try {
      killSwitch.assertNotActive();

      // Schema validation
      const parsed = ToolInvocationSchema.safeParse(raw);
      if (!parsed.success) {
        throw new ValidationError(parsed.error.message);
      }
      const inv = parsed.data as ToolInvocation;

      if (!this.ctx) {
        throw new PlatformError('GATEWAY_NOT_READY', 'Tool gateway context not set', 503);
      }

      const manifest = this.ctx.getManifest(inv.agentId);
      if (!manifest.allowedCapabilities.includes(inv.capability)) {
        throw new CapabilityDeniedError(
          inv.capability,
          `agent ${inv.agentId} manifest does not include this capability`
        );
      }

      // Capability grant (may create approval request)
      const grantResult = capabilityManager.request({
        agentId: inv.agentId,
        taskId: inv.taskId,
        userId: inv.userId,
        capability: inv.capability,
        scope: inv.scope,
        reason: inv.reason,
        agentAllowed: manifest.allowedCapabilities,
        approvalId: (inv.args as { approvalId?: string } | undefined)?.approvalId,
      });

      if (grantResult.denied) {
        throw new CapabilityDeniedError(inv.capability, grantResult.reason || 'denied');
      }
      if (grantResult.approvalRequired && grantResult.approvalId) {
        // Surface to caller — do not execute
        const event = emitAudit({
          agentId: inv.agentId,
          taskId: inv.taskId,
          userId: inv.userId,
          tool: inv.toolName,
          capability: inv.capability,
          resultStatus: 'blocked',
          riskLevel: CAPABILITY_RISK[inv.capability],
          approvalRequired: true,
          approvalStatus: 'pending',
          input: inv.args,
          durationMs: Date.now() - start,
        });
        throw new ApprovalRequiredError(grantResult.approvalId, inv.capability);
      }

      const policyCtx: PolicyContext = {
        agentAllowedCapabilities: manifest.allowedCapabilities,
        networkEnabled: this.ctx.isNetworkEnabled(inv.taskId),
        networkAllowlist: [], // engine uses its default if empty
        maxToolCallsForTask: manifest.maxToolCalls,
        currentToolCallCount: this.ctx.getTaskToolCount(inv.taskId),
        protectedBranches: ['main', 'master', 'production', 'prod'],
      };

      const sanitizedArgs = assertPolicy(inv, policyCtx);

      const handler = this.handlers.get(inv.toolName);
      if (!handler) {
        throw new PlatformError('TOOL_NOT_FOUND', `No handler for tool ${inv.toolName}`, 404);
      }

      // Enforce per-call timeout
      const timeoutMs = Math.min(
        inv.timeoutMs ?? manifest.defaultTimeoutMs,
        manifest.maxTaskDurationMs
      );
      const data = await withTimeout(handler(sanitizedArgs, inv), timeoutMs, inv.toolName);

      this.ctx.incrementTaskToolCount(inv.taskId);

      const event = emitAudit({
        agentId: inv.agentId,
        taskId: inv.taskId,
        userId: inv.userId,
        tool: inv.toolName,
        capability: inv.capability,
        resultStatus: 'ok',
        riskLevel: CAPABILITY_RISK[inv.capability],
        approvalRequired: grantResult.grant?.approvalRequired ?? false,
        approvalStatus: grantResult.grant?.approvalStatus ?? 'n/a',
        input: inv.args,
        durationMs: Date.now() - start,
      });
      auditId = event.id;

      return { ok: true, data, durationMs: Date.now() - start, auditId };
    } catch (err) {
      const durationMs = Date.now() - start;
      if (err instanceof ApprovalRequiredError) {
        return {
          ok: false,
          blocked: true,
          error: { code: err.code, message: err.message },
          durationMs,
          auditId,
        };
      }

      const code = err instanceof PlatformError ? err.code : 'INTERNAL_ERROR';
      const message = err instanceof Error ? err.message : 'unknown error';
      const status: 'denied' | 'blocked' | 'timeout' | 'error' =
        code === 'CAPABILITY_DENIED' || code === 'POLICY_VIOLATION'
          ? 'denied'
          : code === 'TIMEOUT'
            ? 'timeout'
            : code === 'KILL_SWITCH_ACTIVE'
              ? 'blocked'
              : 'error';

      const event = emitAudit({
        agentId: (raw as ToolInvocation).agentId ?? 'system',
        taskId: (raw as ToolInvocation).taskId ?? 'unknown',
        userId: (raw as ToolInvocation).userId ?? 'unknown',
        tool: (raw as ToolInvocation).toolName ?? 'unknown',
        capability: ((raw as ToolInvocation).capability as Capability) ?? null,
        resultStatus: status,
        riskLevel: (raw as ToolInvocation).capability
          ? CAPABILITY_RISK[(raw as ToolInvocation).capability]
          : 'NONE',
        input: (raw as ToolInvocation).args,
        durationMs,
        errorCode: code,
        meta: { message: message.slice(0, 300) },
      });

      return {
        ok: false,
        error: { code, message },
        durationMs,
        auditId: event.id,
        blocked: status === 'denied' || status === 'blocked',
      };
    }
  }
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => {
      reject(new PlatformError('TIMEOUT', `${label} timed out after ${ms}ms`, 408));
    }, ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      }
    );
  });
}

export const toolGateway = new ToolGateway();
