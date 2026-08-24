/**
 * DIVA — highest-level orchestration agent.
 *
 * Understands objectives, decomposes tasks, delegates to specialists,
 * inspects results, retries, coordinates coding/research/GitHub/deploy.
 * Does NOT bypass Policy Engine / Tool Gateway / Capability Manager.
 */

import type { AgentManifest } from '../../core/types.js';
import {
  createTask,
  updateTask,
  addStep,
  callTool,
  assertNotExpired,
  getTask,
} from '../../core/agent-base.js';
import { killSwitch } from '../../core/kill-switch.js';
import { runCoder } from '../coder/index.js';
import { runGithub } from '../github/index.js';
import { runResearch } from '../research/index.js';
import { runSecurity } from '../security/index.js';
import { runDatabase } from '../database/index.js';
import { runDeployment } from '../deployment/index.js';
import { runBrowser } from '../browser/index.js';

export const DIVA_MANIFEST: AgentManifest = {
  id: 'diva',
  name: 'DIVA',
  description: 'Orchestrator — plans and delegates; never self-approves high-risk ops',
  allowedCapabilities: [
    'agent.delegate',
    'workspace.read',
    'github.read',
    'research.query',
    'security.inspect',
  ],
  maxToolCalls: 50,
  maxTaskDurationMs: 45 * 60 * 1000,
  maxRetries: 2,
  defaultTimeoutMs: 60_000,
};

export type Specialist =
  | 'coder'
  | 'github'
  | 'research'
  | 'security'
  | 'database'
  | 'deployment'
  | 'browser';

export interface DivaPlanStep {
  specialist: Specialist;
  description: string;
  /** Input bag for the specialist */
  params: Record<string, unknown>;
}

export interface DivaInput {
  userId: string;
  objective: string;
  projectPath?: string;
  /** Optional explicit plan; otherwise a simple heuristic plan is built */
  plan?: DivaPlanStep[];
}

export interface DivaOutput {
  taskId: string;
  status: string;
  summary: string;
  stepResults: { specialist: string; status: string; summary: string }[];
  pendingApprovals: string[];
}

/**
 * Heuristic planner — production systems would use an LLM behind a
 * constrained schema. External content never overrides policy.
 */
function buildPlan(input: DivaInput): DivaPlanStep[] {
  if (input.plan?.length) return input.plan;

  const obj = input.objective.toLowerCase();
  const steps: DivaPlanStep[] = [];

  if (/research|search|find out|look up/.test(obj)) {
    steps.push({
      specialist: 'research',
      description: 'Gather background information',
      params: { queries: [input.objective] },
    });
  }

  if (input.projectPath || /code|refactor|test|bug|implement|fix/.test(obj)) {
    steps.push({
      specialist: 'security',
      description: 'Pre-change security skim',
      params: { projectPath: input.projectPath },
    });
    steps.push({
      specialist: 'coder',
      description: 'Inspect and test codebase in sandbox',
      params: { projectPath: input.projectPath, allowNetwork: false },
    });
  }

  if (/pull request|pr\b|commit|branch|github/.test(obj)) {
    steps.push({
      specialist: 'github',
      description: 'GitHub inspection / PR workflow',
      params: { mode: 'inspect' },
    });
  }

  if (/deploy|release|production|staging/.test(obj)) {
    steps.push({
      specialist: 'deployment',
      description: 'Prepare controlled deployment plan',
      params: {
        projectPath: input.projectPath,
        environment: /prod/.test(obj) ? 'production' : 'staging',
      },
    });
  }

  if (/select |query |database|sql/.test(obj)) {
    steps.push({
      specialist: 'database',
      description: 'Database operation (read-first)',
      params: { sql: 'SELECT 1' },
    });
  }

  if (steps.length === 0) {
    steps.push({
      specialist: 'research',
      description: 'Default research pass',
      params: { queries: [input.objective] },
    });
  }

  return steps;
}

export async function runDiva(input: DivaInput): Promise<DivaOutput> {
  killSwitch.assertNotActive();
  const task = createTask({
    userId: input.userId,
    objective: input.objective,
    agentId: 'diva',
    manifest: DIVA_MANIFEST,
  });
  updateTask(task.taskId, { status: 'running' });

  const stepResults: DivaOutput['stepResults'] = [];
  const pendingApprovals: string[] = [];

  try {
    assertNotExpired(task);
    const plan = buildPlan(input);

    // Audit the plan via gateway (delegate capability)
    await callTool({
      toolName: 'agent.delegate',
      agentId: 'diva',
      taskId: task.taskId,
      userId: input.userId,
      capability: 'agent.delegate',
      scope: 'plan',
      reason: 'Record orchestration plan',
      args: { steps: plan.map((p) => p.specialist) },
    });

    for (const step of plan) {
      if (killSwitch.isActive()) break;
      assertNotExpired(getTask(task.taskId)!);

      addStep(task.taskId, {
        agentId: 'diva',
        description: step.description,
        status: 'running',
        capability: 'agent.delegate',
      });

      const result = await delegate(step, input);
      stepResults.push({
        specialist: step.specialist,
        status: result.status,
        summary: result.summary,
      });
      if (result.approvalId) pendingApprovals.push(result.approvalId);

      // Simple retry once on failure (not on approval wait)
      if (result.status === 'failed') {
        const retry = await delegate(step, input);
        stepResults.push({
          specialist: step.specialist,
          status: retry.status,
          summary: `retry: ${retry.summary}`,
        });
        if (retry.approvalId) pendingApprovals.push(retry.approvalId);
      }
    }

    const status =
      pendingApprovals.length > 0
        ? 'waiting_approval'
        : stepResults.some((s) => s.status === 'failed')
          ? 'failed'
          : 'completed';

    const summary = [
      `DIVA finished objective: ${input.objective.slice(0, 120)}`,
      `Steps: ${stepResults.length}`,
      pendingApprovals.length ? `Pending approvals: ${pendingApprovals.join(', ')}` : '',
    ]
      .filter(Boolean)
      .join(' | ');

    updateTask(task.taskId, { status, resultSummary: summary });
    return { taskId: task.taskId, status, summary, stepResults, pendingApprovals };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'diva failed';
    updateTask(task.taskId, { status: 'failed', error: msg });
    return {
      taskId: task.taskId,
      status: 'failed',
      summary: msg,
      stepResults,
      pendingApprovals,
    };
  }
}

async function delegate(
  step: DivaPlanStep,
  input: DivaInput
): Promise<{ status: string; summary: string; approvalId?: string }> {
  const userId = input.userId;
  switch (step.specialist) {
    case 'coder':
      return runCoder({
        userId,
        objective: step.description,
        projectPath: String(step.params.projectPath || input.projectPath || ''),
        allowNetwork: Boolean(step.params.allowNetwork),
      });
    case 'github':
      return runGithub({
        userId,
        objective: step.description,
        mode: (step.params.mode as 'inspect' | 'propose_changes') || 'inspect',
        files: step.params.files as { path: string; content: string; message: string }[] | undefined,
        summary: step.params.summary as string | undefined,
        testResults: step.params.testResults as string | undefined,
      });
    case 'research':
      return runResearch({
        userId,
        objective: step.description,
        queries: (step.params.queries as string[]) || [input.objective],
      });
    case 'security':
      return runSecurity({
        userId,
        objective: step.description,
        projectPath: (step.params.projectPath as string) || input.projectPath,
      });
    case 'database':
      return runDatabase({
        userId,
        objective: step.description,
        sql: String(step.params.sql || 'SELECT 1'),
        approvalId: step.params.approvalId as string | undefined,
      });
    case 'deployment':
      return runDeployment({
        userId,
        objective: step.description,
        projectPath: String(step.params.projectPath || input.projectPath || ''),
        environment: (step.params.environment as 'staging' | 'production') || 'staging',
        approvalId: step.params.approvalId as string | undefined,
        planId: step.params.planId as string | undefined,
      });
    case 'browser':
      return runBrowser({
        userId,
        objective: step.description,
        url: String(step.params.url || 'https://example.com'),
      });
    default:
      return { status: 'failed', summary: `Unknown specialist` };
  }
}

export default { manifest: DIVA_MANIFEST, run: runDiva };
