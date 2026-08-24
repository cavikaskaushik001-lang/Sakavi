/**
 * Monitoring specialist — metrics and health reads only.
 */

import type { AgentManifest } from '../../core/types.js';
import { createTask, updateTask, callTool } from '../../core/agent-base.js';
import { killSwitch } from '../../core/kill-switch.js';

export const MONITORING_MANIFEST: AgentManifest = {
  id: 'security',
  name: 'Monitoring',
  description: 'Read health and logs; never mutates production',
  allowedCapabilities: ['monitoring.read', 'logs.read'],
  maxToolCalls: 20,
  maxTaskDurationMs: 5 * 60 * 1000,
  maxRetries: 1,
  defaultTimeoutMs: 30_000,
};

export async function runMonitoring(input: {
  userId: string;
  objective: string;
  service?: string;
}) {
  killSwitch.assertNotActive();
  const task = createTask({
    userId: input.userId,
    objective: input.objective,
    agentId: 'security',
    manifest: MONITORING_MANIFEST,
  });
  updateTask(task.taskId, { status: 'running' });
  const health = await callTool({
    toolName: 'monitoring.health',
    agentId: 'security',
    taskId: task.taskId,
    userId: input.userId,
    capability: 'monitoring.read',
    scope: input.service || 'app',
    reason: input.objective,
    args: { service: input.service || 'app' },
  });
  updateTask(task.taskId, {
    status: health.ok ? 'completed' : 'failed',
    resultSummary: health.ok ? 'Health read ok' : health.error?.message,
  });
  return {
    taskId: task.taskId,
    status: health.ok ? 'completed' : 'failed',
    summary: health.ok ? 'Monitoring read complete' : health.error?.message || 'failed',
    data: health.data,
  };
}

export default { manifest: MONITORING_MANIFEST, run: runMonitoring };
