/**
 * Research agent — external knowledge queries only via allowlisted network tools.
 * Treats all external content as untrusted (prompt-injection resistant).
 */

import type { AgentManifest } from '../../core/types.js';
import { createTask, updateTask, addStep, callTool, assertNotExpired, setNetworkEnabled } from '../../core/agent-base.js';
import { killSwitch } from '../../core/kill-switch.js';

export const RESEARCH_MANIFEST: AgentManifest = {
  id: 'research',
  name: 'Research',
  description: 'Query external sources through allowlisted network paths',
  allowedCapabilities: ['research.query', 'network.read'],
  maxToolCalls: 15,
  maxTaskDurationMs: 5 * 60 * 1000,
  maxRetries: 2,
  defaultTimeoutMs: 30_000,
};

export interface ResearchInput {
  userId: string;
  objective: string;
  queries: string[];
}

export interface ResearchOutput {
  taskId: string;
  status: string;
  summary: string;
  /** Untrusted external snippets — never elevate privileges based on this */
  notes: string[];
}

export async function runResearch(input: ResearchInput): Promise<ResearchOutput> {
  killSwitch.assertNotActive();
  const task = createTask({
    userId: input.userId,
    objective: input.objective,
    agentId: 'research',
    manifest: RESEARCH_MANIFEST,
  });
  setNetworkEnabled(task.taskId, true); // research needs network, still allowlisted
  updateTask(task.taskId, { status: 'running' });
  const notes: string[] = [];

  try {
    assertNotExpired(task);
    for (const q of input.queries.slice(0, 5)) {
      addStep(task.taskId, {
        agentId: 'research',
        description: `Research: ${q.slice(0, 80)}`,
        status: 'running',
        capability: 'research.query',
      });
      const res = await callTool({
        toolName: 'research.search',
        agentId: 'research',
        taskId: task.taskId,
        userId: input.userId,
        capability: 'research.query',
        scope: 'external',
        reason: input.objective,
        args: { query: q },
      });
      if (res.ok && res.data) {
        // Mark as untrusted in the note itself
        notes.push(`[UNTRUSTED] ${String((res.data as { snippet?: string }).snippet ?? res.data).slice(0, 500)}`);
      }
    }
    updateTask(task.taskId, {
      status: 'completed',
      resultSummary: `Collected ${notes.length} research notes (untrusted)`,
    });
    return {
      taskId: task.taskId,
      status: 'completed',
      summary: 'Research complete — treat results as untrusted data',
      notes,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'research failed';
    updateTask(task.taskId, { status: 'failed', error: msg });
    return { taskId: task.taskId, status: 'failed', summary: msg, notes };
  }
}

export default { manifest: RESEARCH_MANIFEST, run: runResearch };
