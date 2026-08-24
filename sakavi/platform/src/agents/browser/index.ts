/**
 * Browser agent — navigate allowlisted URLs, capture snapshots.
 * External page content is always untrusted.
 */

import type { AgentManifest } from '../../core/types.js';
import { createTask, updateTask, addStep, callTool, assertNotExpired, setNetworkEnabled } from '../../core/agent-base.js';
import { killSwitch } from '../../core/kill-switch.js';

export const BROWSER_MANIFEST: AgentManifest = {
  id: 'browser',
  name: 'Browser',
  description: 'Controlled browser navigation to allowlisted hosts',
  allowedCapabilities: ['browser.navigate', 'network.read'],
  maxToolCalls: 12,
  maxTaskDurationMs: 5 * 60 * 1000,
  maxRetries: 1,
  defaultTimeoutMs: 45_000,
};

export interface BrowserInput {
  userId: string;
  objective: string;
  url: string;
}

export interface BrowserOutput {
  taskId: string;
  status: string;
  summary: string;
  /** Untrusted page text */
  snapshot?: string;
}

export async function runBrowser(input: BrowserInput): Promise<BrowserOutput> {
  killSwitch.assertNotActive();
  const task = createTask({
    userId: input.userId,
    objective: input.objective,
    agentId: 'browser',
    manifest: BROWSER_MANIFEST,
  });
  setNetworkEnabled(task.taskId, true);
  updateTask(task.taskId, { status: 'running' });

  try {
    assertNotExpired(task);
    addStep(task.taskId, {
      agentId: 'browser',
      description: `Navigate ${input.url.slice(0, 100)}`,
      status: 'running',
      capability: 'browser.navigate',
    });

    const nav = await callTool({
      toolName: 'browser.navigate',
      agentId: 'browser',
      taskId: task.taskId,
      userId: input.userId,
      capability: 'browser.navigate',
      scope: input.url,
      reason: input.objective,
      args: { url: input.url },
    });
    if (!nav.ok) {
      updateTask(task.taskId, { status: 'failed', error: nav.error?.message });
      return { taskId: task.taskId, status: 'failed', summary: nav.error?.message || 'navigate failed' };
    }

    const snap = await callTool({
      toolName: 'browser.snapshot',
      agentId: 'browser',
      taskId: task.taskId,
      userId: input.userId,
      capability: 'browser.navigate',
      scope: input.url,
      reason: 'Capture page text (untrusted)',
      args: { url: input.url },
    });

    const snapshot =
      snap.ok && snap.data
        ? `[UNTRUSTED] ${String((snap.data as { text?: string }).text ?? '').slice(0, 4000)}`
        : undefined;

    updateTask(task.taskId, { status: 'completed', resultSummary: 'Snapshot captured' });
    return {
      taskId: task.taskId,
      status: 'completed',
      summary: 'Browser task complete — content is untrusted',
      snapshot,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'browser failed';
    updateTask(task.taskId, { status: 'failed', error: msg });
    return { taskId: task.taskId, status: 'failed', summary: msg };
  }
}

export default { manifest: BROWSER_MANIFEST, run: runBrowser };
