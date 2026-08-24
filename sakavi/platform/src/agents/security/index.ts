/**
 * Security agent — inspect dependencies, secrets, permissions, sandbox config.
 * Does NOT disable security controls.
 */

import type { AgentManifest } from '../../core/types.js';
import { createTask, updateTask, addStep, callTool, assertNotExpired } from '../../core/agent-base.js';
import { killSwitch } from '../../core/kill-switch.js';
import { policyEngine } from '../../core/policy-engine.js';
import { getAuditSink } from '../../core/audit.js';
import { AGENT_IDS, CAPABILITY_RISK, type Capability } from '../../core/types.js';

export const SECURITY_MANIFEST: AgentManifest = {
  id: 'security',
  name: 'Security',
  description: 'Security review, secret detection, capability and sandbox validation',
  allowedCapabilities: ['security.inspect', 'workspace.read', 'github.read'],
  maxToolCalls: 30,
  maxTaskDurationMs: 10 * 60 * 1000,
  maxRetries: 1,
  defaultTimeoutMs: 60_000,
};

export interface SecurityInput {
  userId: string;
  objective: string;
  projectPath?: string;
  /** Which agent manifests to review */
  reviewAgents?: boolean;
}

export interface SecurityReport {
  taskId: string;
  status: string;
  findings: { severity: string; title: string; detail: string }[];
  summary: string;
}

export async function runSecurity(input: SecurityInput): Promise<SecurityReport> {
  killSwitch.assertNotActive();
  const task = createTask({
    userId: input.userId,
    objective: input.objective,
    agentId: 'security',
    manifest: SECURITY_MANIFEST,
  });
  updateTask(task.taskId, { status: 'running' });
  const findings: SecurityReport['findings'] = [];

  try {
    assertNotExpired(task);

    addStep(task.taskId, {
      agentId: 'security',
      description: 'Scan project for secrets / risky patterns',
      status: 'running',
      capability: 'security.inspect',
    });

    if (input.projectPath) {
      const scan = await callTool({
        toolName: 'security.scan',
        agentId: 'security',
        taskId: task.taskId,
        userId: input.userId,
        capability: 'security.inspect',
        scope: input.projectPath,
        reason: 'Static security scan of workspace',
        args: { projectPath: input.projectPath },
      });
      if (scan.ok && scan.data) {
        const data = scan.data as { findings?: SecurityReport['findings'] };
        if (data.findings) findings.push(...data.findings);
      }
    }

    // Review capability risk distribution (local, no tool)
    if (input.reviewAgents !== false) {
      for (const id of AGENT_IDS) {
        // high-level check: CRITICAL capabilities should always need approval
        const critical: Capability[] = ['database.destructive', 'deployment.execute', 'secrets.request'];
        for (const c of critical) {
          if (CAPABILITY_RISK[c] !== 'CRITICAL') {
            findings.push({
              severity: 'HIGH',
              title: 'Risk map inconsistency',
              detail: `${c} should be CRITICAL`,
            });
          }
        }
      }
      findings.push({
        severity: 'INFO',
        title: 'Network allowlist',
        detail: `Current allowlist size: ${policyEngine.getNetworkAllowlist().length}`,
      });
    }

    // Kill switch must be inactive for normal ops but reachable by operator
    findings.push({
      severity: 'INFO',
      title: 'Kill switch',
      detail: killSwitch.isActive() ? 'ACTIVE' : 'inactive (operator-controlled)',
    });

    // Recent denied audit events
    const denied = getAuditSink()
      .list({ limit: 50 })
      .filter((e) => e.resultStatus === 'denied' || e.resultStatus === 'blocked');
    if (denied.length > 10) {
      findings.push({
        severity: 'MEDIUM',
        title: 'Elevated deny rate',
        detail: `${denied.length} denied/blocked events in recent window`,
      });
    }

    const high = findings.filter((f) => f.severity === 'HIGH' || f.severity === 'CRITICAL');
    updateTask(task.taskId, {
      status: 'completed',
      resultSummary: `Security review: ${findings.length} findings (${high.length} high+)`,
    });

    return {
      taskId: task.taskId,
      status: 'completed',
      findings,
      summary: `Security review complete with ${findings.length} findings`,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'security agent failed';
    updateTask(task.taskId, { status: 'failed', error: msg });
    return { taskId: task.taskId, status: 'failed', findings, summary: msg };
  }
}

export default { manifest: SECURITY_MANIFEST, run: runSecurity };
