/**
 * Database agent — strict READ / WRITE / DESTRUCTIVE separation.
 * Default: database.read only. Destructive ops require approval + audit.
 */

import type { AgentManifest } from '../../core/types.js';
import { createTask, updateTask, addStep, callTool, assertNotExpired } from '../../core/agent-base.js';
import { killSwitch } from '../../core/kill-switch.js';
import { approvalService } from '../../core/approval.js';

export const DATABASE_MANIFEST: AgentManifest = {
  id: 'database',
  name: 'Database',
  description: 'Controlled database access with destructive-operation gates',
  allowedCapabilities: ['database.read', 'database.write', 'database.destructive'],
  maxToolCalls: 20,
  maxTaskDurationMs: 5 * 60 * 1000,
  maxRetries: 1,
  defaultTimeoutMs: 30_000,
};

export interface DatabaseInput {
  userId: string;
  objective: string;
  sql: string;
  /** approvalId required for write/destructive after human approval */
  approvalId?: string;
}

export interface DatabaseOutput {
  taskId: string;
  status: string;
  summary: string;
  rowsAffected?: number;
  approvalId?: string;
}

function classifySql(sql: string): 'read' | 'write' | 'destructive' {
  const u = sql.trim().toUpperCase();
  if (/^\s*(DROP|TRUNCATE)\b/.test(u) || u.includes('DROP TABLE') || u.includes('DROP DATABASE')) {
    return 'destructive';
  }
  if (/^\s*(DELETE|UPDATE|INSERT|ALTER|CREATE|REPLACE)\b/.test(u)) {
    return 'write';
  }
  return 'read';
}

export async function runDatabase(input: DatabaseInput): Promise<DatabaseOutput> {
  killSwitch.assertNotActive();
  const task = createTask({
    userId: input.userId,
    objective: input.objective,
    agentId: 'database',
    manifest: DATABASE_MANIFEST,
  });
  updateTask(task.taskId, { status: 'running' });

  try {
    assertNotExpired(task);
    const kind = classifySql(input.sql);
    const capability =
      kind === 'destructive'
        ? 'database.destructive'
        : kind === 'write'
          ? 'database.write'
          : 'database.read';

    addStep(task.taskId, {
      agentId: 'database',
      description: `Execute ${kind} query`,
      status: 'running',
      capability,
    });

    // Pre-explain for non-read
    if (kind !== 'read' && !input.approvalId) {
      const approval = approvalService.create({
        taskId: task.taskId,
        agentId: 'database',
        capability,
        reason: input.objective,
        summary: `${kind.toUpperCase()} SQL proposed: ${input.sql.slice(0, 200)}`,
        scope: 'database',
      });
      updateTask(task.taskId, { status: 'waiting_approval' });
      return {
        taskId: task.taskId,
        status: 'waiting_approval',
        summary: `Approval required for ${kind} operation`,
        approvalId: approval.id,
      };
    }

    const result = await callTool({
      toolName: 'database.query',
      agentId: 'database',
      taskId: task.taskId,
      userId: input.userId,
      capability,
      scope: 'database',
      reason: input.objective,
      args: {
        sql: input.sql,
        approvalId: input.approvalId,
      },
    });

    if (!result.ok) {
      updateTask(task.taskId, { status: 'failed', error: result.error?.message });
      return {
        taskId: task.taskId,
        status: result.blocked ? 'blocked' : 'failed',
        summary: result.error?.message || 'query failed',
        approvalId: input.approvalId,
      };
    }

    const rowsAffected = (result.data as { rowsAffected?: number })?.rowsAffected;
    updateTask(task.taskId, {
      status: 'completed',
      resultSummary: `Query ok (${kind})`,
    });
    return {
      taskId: task.taskId,
      status: 'completed',
      summary: `Query executed (${kind})`,
      rowsAffected,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'database agent failed';
    updateTask(task.taskId, { status: 'failed', error: msg });
    return { taskId: task.taskId, status: 'failed', summary: msg };
  }
}

export default { manifest: DATABASE_MANIFEST, run: runDatabase };
