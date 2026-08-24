/**
 * GitHub agent — branch-first, PR workflow.
 * Credentials stay server-side via secretProvider. Never in prompts.
 * Preserves existing Edge function policies: no direct main/master writes.
 */

import type { AgentManifest } from '../../core/types.js';
import { createTask, updateTask, addStep, callTool, assertNotExpired } from '../../core/agent-base.js';
import { killSwitch } from '../../core/kill-switch.js';

export const GITHUB_MANIFEST: AgentManifest = {
  id: 'github',
  name: 'GitHub',
  description: 'Repository inspection, feature branches, commits, pull requests',
  allowedCapabilities: ['github.read', 'github.write', 'github.pull_request'],
  maxToolCalls: 30,
  maxTaskDurationMs: 10 * 60 * 1000,
  maxRetries: 2,
  defaultTimeoutMs: 60_000,
};

export interface GithubAgentInput {
  userId: string;
  objective: string;
  /** e.g. inspect | branch_and_pr */
  mode?: 'inspect' | 'propose_changes';
  files?: { path: string; content: string; message: string }[];
  baseBranch?: string;
  summary?: string;
  testResults?: string;
}

export interface GithubAgentOutput {
  taskId: string;
  status: string;
  summary: string;
  branch?: string;
  prUrl?: string;
}

export async function runGithub(input: GithubAgentInput): Promise<GithubAgentOutput> {
  killSwitch.assertNotActive();
  const task = createTask({
    userId: input.userId,
    objective: input.objective,
    agentId: 'github',
    manifest: GITHUB_MANIFEST,
  });
  updateTask(task.taskId, { status: 'running' });

  try {
    assertNotExpired(task);

    addStep(task.taskId, {
      agentId: 'github',
      description: 'Repository status',
      status: 'running',
      capability: 'github.read',
    });
    const status = await callTool({
      toolName: 'github.status',
      agentId: 'github',
      taskId: task.taskId,
      userId: input.userId,
      capability: 'github.read',
      scope: 'repo',
      reason: 'Inspect default branch and connection',
      args: {},
    });
    if (!status.ok) {
      updateTask(task.taskId, { status: 'failed', error: status.error?.message });
      return { taskId: task.taskId, status: 'failed', summary: status.error?.message || 'status failed' };
    }

    if (input.mode !== 'propose_changes' || !input.files?.length) {
      updateTask(task.taskId, {
        status: 'completed',
        resultSummary: 'Inspection complete',
      });
      return {
        taskId: task.taskId,
        status: 'completed',
        summary: 'Inspection complete',
      };
    }

    // Create feature branch
    addStep(task.taskId, {
      agentId: 'github',
      description: 'Create feature branch',
      status: 'running',
      capability: 'github.write',
    });
    const branchRes = await callTool({
      toolName: 'github.create_branch',
      agentId: 'github',
      taskId: task.taskId,
      userId: input.userId,
      capability: 'github.write',
      scope: 'repo',
      reason: `Feature branch for: ${input.objective.slice(0, 120)}`,
      args: { task: input.objective, base: input.baseBranch },
    });
    if (!branchRes.ok) {
      updateTask(task.taskId, { status: 'failed', error: branchRes.error?.message });
      return {
        taskId: task.taskId,
        status: 'failed',
        summary: branchRes.error?.message || 'branch failed',
      };
    }
    const branch = (branchRes.data as { branch: string }).branch;

    // Upsert files on agent branch only
    for (const f of input.files) {
      addStep(task.taskId, {
        agentId: 'github',
        description: `Upsert ${f.path}`,
        status: 'running',
        capability: 'github.write',
      });
      const up = await callTool({
        toolName: 'github.upsert_file',
        agentId: 'github',
        taskId: task.taskId,
        userId: input.userId,
        capability: 'github.write',
        scope: f.path,
        reason: f.message,
        args: {
          path: f.path,
          content: f.content,
          branch,
          message: f.message,
        },
      });
      if (!up.ok) {
        updateTask(task.taskId, { status: 'failed', error: up.error?.message });
        return { taskId: task.taskId, status: 'failed', summary: up.error?.message || 'upsert failed', branch };
      }
    }

    // Open PR (never auto-merge)
    addStep(task.taskId, {
      agentId: 'github',
      description: 'Create pull request',
      status: 'running',
      capability: 'github.pull_request',
    });
    const pr = await callTool({
      toolName: 'github.create_pr',
      agentId: 'github',
      taskId: task.taskId,
      userId: input.userId,
      capability: 'github.pull_request',
      scope: branch,
      reason: 'Human review required before merge',
      args: {
        head: branch,
        base: input.baseBranch || 'main',
        title: input.objective.slice(0, 72),
        body: [
          '## Summary',
          input.summary || input.objective,
          '',
          '## Testing',
          input.testResults || '_Not run in this environment_',
          '',
          '---',
          'Generated by Sakavi GitHub agent. Review carefully before merge.',
        ].join('\n'),
        draft: true,
      },
    });

    if (!pr.ok) {
      updateTask(task.taskId, { status: 'failed', error: pr.error?.message });
      return { taskId: task.taskId, status: 'failed', summary: pr.error?.message || 'PR failed', branch };
    }

    const prUrl = (pr.data as { url?: string }).url;
    updateTask(task.taskId, {
      status: 'completed',
      resultSummary: `PR opened: ${prUrl || branch}`,
    });
    return {
      taskId: task.taskId,
      status: 'completed',
      summary: `PR opened on branch ${branch}`,
      branch,
      prUrl,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'github agent failed';
    updateTask(task.taskId, { status: 'failed', error: msg });
    return { taskId: task.taskId, status: 'failed', summary: msg };
  }
}

export default { manifest: GITHUB_MANIFEST, run: runGithub };
