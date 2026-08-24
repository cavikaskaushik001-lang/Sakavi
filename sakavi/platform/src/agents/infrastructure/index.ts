/**
 * Infrastructure specialist — diagnose containers/services/health (read-heavy).
 * Cannot disable kill switch or expand network policy.
 */

import type { AgentManifest } from '../../core/types.js';
import { createTask, updateTask, callTool, assertNotExpired } from '../../core/agent-base.js';
import { killSwitch } from '../../core/kill-switch.js';

export const INFRASTRUCTURE_MANIFEST: AgentManifest = {
  id: 'deployment',
  name: 'Infrastructure',
  description: 'Inspect services, health, logs; prepare infra diagnoses',
  allowedCapabilities: [
    'deployment.request',
    'process.execute',
    'logs.read',
    'monitoring.read',
    'cloud.read',
  ],
  maxToolCalls: 25,
  maxTaskDurationMs: 15 * 60 * 1000,
  maxRetries: 2,
  defaultTimeoutMs: 60_000,
};

export interface InfraInput {
  userId: string;
  objective: string;
  service?: string;
  projectPath?: string;
}

export async function runInfrastructure(input: InfraInput) {
  killSwitch.assertNotActive();
  const task = createTask({
    userId: input.userId,
    objective: input.objective,
    agentId: 'deployment',
    manifest: INFRASTRUCTURE_MANIFEST,
  });
  updateTask(task.taskId, { status: 'running' });
  try {
    assertNotExpired(task);
    const health = await callTool({
      toolName: 'monitoring.health',
      agentId: 'deployment',
      taskId: task.taskId,
      userId: input.userId,
      capability: 'monitoring.read',
      scope: input.service || 'default',
      reason: input.objective,
      args: { service: input.service || 'app' },
    });
    const logs = await callTool({
      toolName: 'logs.read',
      agentId: 'deployment',
      taskId: task.taskId,
      userId: input.userId,
      capability: 'logs.read',
      scope: input.service || 'default',
      reason: 'Collect recent logs for diagnosis',
      args: { source: input.service || 'app', lines: 100 },
    });
    updateTask(task.taskId, {
      status: 'completed',
      resultSummary: 'Infrastructure diagnosis snapshot collected',
    });
    return {
      taskId: task.taskId,
      status: 'completed',
      summary: 'Infra snapshot complete',
      health: health.data,
      logs: logs.data,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'infra failed';
    updateTask(task.taskId, { status: 'failed', error: msg });
    return { taskId: task.taskId, status: 'failed', summary: msg };
  }
}

export default { manifest: INFRASTRUCTURE_MANIFEST, run: runInfrastructure };
