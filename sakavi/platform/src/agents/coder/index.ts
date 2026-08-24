/**
 * Coder agent — inspect, edit, test code inside the sandbox only.
 * No production credentials. No direct host execution.
 */

import type { AgentManifest, ToolResult } from '../../core/types.js';
import {
  createTask,
  updateTask,
  addStep,
  callTool,
  assertNotExpired,
  setNetworkEnabled,
} from '../../core/agent-base.js';
import { killSwitch } from '../../core/kill-switch.js';

export const CODER_MANIFEST: AgentManifest = {
  id: 'coder',
  name: 'Coder',
  description: 'Inspects and modifies code; runs tests/builds only inside the sandbox',
  allowedCapabilities: [
    'workspace.read',
    'workspace.write',
    'process.execute',
    'network.read', // only when explicitly enabled for package install
  ],
  maxToolCalls: 40,
  maxTaskDurationMs: 15 * 60 * 1000,
  maxRetries: 2,
  defaultTimeoutMs: 120_000,
};

export interface CoderInput {
  userId: string;
  objective: string;
  /** Absolute host path to project (mounted as /workspace) */
  projectPath: string;
  /** Allow npm/pip install for this task */
  allowNetwork?: boolean;
}

export interface CoderOutput {
  taskId: string;
  status: string;
  summary: string;
  testResults?: string;
  steps: { description: string; status: string }[];
}

export async function runCoder(input: CoderInput): Promise<CoderOutput> {
  killSwitch.assertNotActive();
  const task = createTask({
    userId: input.userId,
    objective: input.objective,
    agentId: 'coder',
    manifest: CODER_MANIFEST,
  });
  if (input.allowNetwork) setNetworkEnabled(task.taskId, true);
  updateTask(task.taskId, { status: 'running' });

  try {
    assertNotExpired(task);

    // 1. Create sandbox
    addStep(task.taskId, {
      agentId: 'coder',
      description: 'Create isolated sandbox',
      status: 'running',
      capability: 'process.execute',
    });
    const created = await callTool({
      toolName: 'sandbox.create',
      agentId: 'coder',
      taskId: task.taskId,
      userId: input.userId,
      capability: 'process.execute',
      scope: input.projectPath,
      reason: 'Isolated environment for code changes and tests',
      args: {
        projectPath: input.projectPath,
        networkMode: input.allowNetwork ? 'bridge' : 'none',
      },
    });
    if (!created.ok) {
      return fail(task.taskId, created, 'sandbox.create failed');
    }
    const sandboxId = (created.data as { sandboxId: string }).sandboxId;

    // 2. Inspect
    addStep(task.taskId, {
      agentId: 'coder',
      description: 'Inspect project layout',
      status: 'running',
      capability: 'workspace.read',
    });
    await callTool({
      toolName: 'sandbox.execute',
      agentId: 'coder',
      taskId: task.taskId,
      userId: input.userId,
      capability: 'workspace.read',
      scope: '/workspace',
      reason: 'List project files before editing',
      args: { sandboxId, command: 'ls -la && (test -f package.json && cat package.json || true)' },
    });

    // 3. Run tests if present (read-only execute)
    addStep(task.taskId, {
      agentId: 'coder',
      description: 'Run tests',
      status: 'running',
      capability: 'process.execute',
    });
    const tests = await callTool({
      toolName: 'sandbox.execute',
      agentId: 'coder',
      taskId: task.taskId,
      userId: input.userId,
      capability: 'process.execute',
      scope: '/workspace',
      reason: 'Verify project health before/after changes',
      args: {
        sandboxId,
        command:
          '(test -f package.json && npm test --if-present) || (test -f requirements.txt && python3 -m pytest -q) || echo "no test runner detected"',
      },
      timeoutMs: 180_000,
    });

    const testResults =
      tests.ok && tests.data
        ? String((tests.data as { stdout?: string }).stdout ?? '').slice(0, 4000)
        : tests.error?.message ?? 'tests did not run';

    // 4. Destroy sandbox
    await callTool({
      toolName: 'sandbox.destroy',
      agentId: 'coder',
      taskId: task.taskId,
      userId: input.userId,
      capability: 'process.execute',
      scope: sandboxId,
      reason: 'Cleanup after coding task',
      args: { sandboxId },
    });

    updateTask(task.taskId, {
      status: 'completed',
      resultSummary: `Coder finished. Tests: ${testResults.slice(0, 200)}`,
    });

    const final = updateTask(task.taskId, {});
    return {
      taskId: task.taskId,
      status: 'completed',
      summary: final.resultSummary || input.objective,
      testResults,
      steps: final.steps.map((s) => ({ description: s.description, status: s.status })),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'coder failed';
    updateTask(task.taskId, { status: 'failed', error: msg });
    return {
      taskId: task.taskId,
      status: 'failed',
      summary: msg,
      steps: [],
    };
  }
}

function fail(taskId: string, result: ToolResult, label: string): CoderOutput {
  const msg = result.error?.message || label;
  updateTask(taskId, { status: 'failed', error: msg });
  return { taskId, status: 'failed', summary: msg, steps: [] };
}

export default { manifest: CODER_MANIFEST, run: runCoder };
