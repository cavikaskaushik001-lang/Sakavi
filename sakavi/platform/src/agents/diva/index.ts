/**
 * DIVA — production-grade autonomous orchestration agent.
 *
 * Cognitive pipeline:
 * INPUT → INTENT → CONTEXT → DECOMPOSE → RISK → PLAN → CRITIC →
 * EXECUTE → OBSERVE → VERIFY → RECOVER → FINAL
 *
 * Authority is NEVER self-granted. All side effects pass:
 *   Capability Manager → Policy Engine → Tool Gateway
 *
 * Does not bypass kill switch, approvals, or sandbox isolation.
 */

import { randomUUID } from 'node:crypto';
import type { AgentManifest, Capability } from '../../core/types.js';
import { killSwitch } from '../../core/kill-switch.js';
import { emitAudit } from '../../core/audit.js';
import { PlatformError } from '../../core/errors.js';

import type {
  DivaInput,
  DivaOutput,
  DivaTaskState,
  DivaTaskStatus,
  PlanStep,
} from './types.js';
import { analyzeIntent, decompose, nextReadySteps, markReady } from './planner.js';
import { critiquePlan } from './plan-critic.js';
import { assessIntentRisk, assessPlanRisk, decisionConfidence } from './risk-engine.js';
import {
  createWorkingMemory,
  recordDecision,
  summarizeWorkingMemory,
  writeLongTerm,
} from './memory.js';
import { executeStep } from './executor.js';
import { recoveryPolicy, makeError } from './recovery.js';
import { pushTimeline, formatTimeline } from './timeline.js';
import { divaCapabilitySummary } from '../../core/capability-catalogue.js';
import { divaToolSummary } from '../../tools/registry.js';
import { memorySummary } from '../../memory/index.js';


export type {
  DivaInput,
  DivaOutput,
  DivaTaskState,
  PlanStep,
  Specialist,
} from './types.js';

export const DIVA_MANIFEST: AgentManifest = {
  id: 'diva',
  name: 'DIVA',
  description:
    'Orchestrator with hierarchical planning, plan critic, verification, recovery; never self-approves high-risk ops',
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

/** In-process durable task store (replace with DB in multi-instance prod) */
const tasks = new Map<string, DivaTaskState>();

const DEFAULT_BUDGET = {
  maxToolCalls: 50,
  usedToolCalls: 0,
  maxDurationMs: 45 * 60 * 1000,
  maxRetries: 2,
  maxPlanRevisions: 3,
  maxReflectionCycles: 3,
  maxParallelAgents: 3,
  maxNetworkRequests: 10,
  usedNetworkRequests: 0,
  estimatedCost: 0,
};

function now(): string {
  return new Date().toISOString();
}

function createState(input: DivaInput): DivaTaskState {
  const taskId = randomUUID();
  const created = now();
  return {
    taskId,
    userId: input.userId,
    objective: input.objective,
    projectPath: input.projectPath,
    status: 'planning',
    stage: 'INPUT',
    plan: [],
    currentStep: 0,
    riskLevel: 'low',
    capabilities: [...DIVA_MANIFEST.allowedCapabilities],
    observations: [],
    errors: [],
    attempts: 0,
    planRevisions: 0,
    reflectionCycles: 0,
    budget: { ...DEFAULT_BUDGET },
    workingMemory: createWorkingMemory(input.objective, input.constraints || []),
    checkpoints: [],
    timeline: [],
    pendingApprovals: [],
    createdAt: created,
    updatedAt: created,
    deadline: new Date(Date.now() + DEFAULT_BUDGET.maxDurationMs).toISOString(),
    paused: false,
    cancelRequested: false,
  };
}

function assertRunnable(state: DivaTaskState): void {
  killSwitch.assertNotActive();
  if (state.cancelRequested || state.status === 'cancelled') {
    throw new PlatformError('TASK_CANCELLED', 'Task cancelled', 409);
  }
  if (state.paused || state.status === 'paused') {
    throw new PlatformError('TASK_PAUSED', 'Task is paused', 409);
  }
  if (new Date(state.deadline).getTime() < Date.now()) {
    state.status = 'failed';
    throw new PlatformError('TASK_DEADLINE', 'Task deadline exceeded', 408);
  }
  if (state.budget.usedToolCalls >= state.budget.maxToolCalls) {
    throw new PlatformError('BUDGET_EXCEEDED', 'Max tool calls exhausted', 429);
  }
}

/**
 * Main entry — full cognitive pipeline.
 */
export async function runDiva(input: DivaInput): Promise<DivaOutput> {
  killSwitch.assertNotActive();

  let state: DivaTaskState;
  if (input.resumeTaskId) {
    const existing = tasks.get(input.resumeTaskId);
    if (!existing) throw new PlatformError('TASK_NOT_FOUND', 'Unknown task', 404);
    existing.paused = false;
    if (existing.status === 'paused') existing.status = 'executing';
    state = existing;
    pushTimeline(state, 'CONTROL', 'Task resumed');
  } else {
    state = createState(input);
    tasks.set(state.taskId, state);
    pushTimeline(state, 'INPUT', `Task created: ${input.objective.slice(0, 160)}`);
    emitAudit({
      agentId: 'diva',
      taskId: state.taskId,
      userId: input.userId,
      tool: 'diva.start',
      capability: 'agent.delegate',
      resultStatus: 'ok',
      riskLevel: 'MEDIUM',
      meta: { objective: input.objective.slice(0, 200) },
    });
  }

  try {
    // ── INTENT ANALYSIS ──────────────────────────────────────────────
    state.stage = 'INTENT_ANALYSIS';
    const intent = analyzeIntent(input.objective, input.constraints || state.workingMemory.constraints);
    pushTimeline(state, 'INTENT_ANALYSIS', `Goal: ${intent.primaryGoal.slice(0, 120)}`);

    // ── CONTEXT BUILDING ─────────────────────────────────────────────
    state.stage = 'CONTEXT_BUILDING';
    const ctxSummary = summarizeWorkingMemory(state.workingMemory);
    // Permanent catalogues — not rediscovered each task
    const capKnowledge = divaCapabilitySummary();
    const toolKnowledge = divaToolSummary();
    const projectMem = memorySummary('project', state.projectPath);
    state.workingMemory.notes.push(
      `Catalogue caps: ${capKnowledge.split('\n').length}; tools: ${toolKnowledge.split('\n').length}`
    );
    if (projectMem) state.workingMemory.notes.push(projectMem.slice(0, 500));
    pushTimeline(
      state,
      'CONTEXT_BUILDING',
      `Context built (memory ${ctxSummary.length}c; permanent catalogue loaded)`
    );

    // ── TASK DECOMPOSITION ───────────────────────────────────────────
    state.stage = 'TASK_DECOMPOSITION';
    state.plan = decompose({ ...input, objective: intent.primaryGoal }, intent);
    state.workingMemory.currentPlanIds = state.plan.map((p) => p.id);
    pushTimeline(state, 'TASK_DECOMPOSITION', `Plan steps: ${state.plan.length}`);

    // ── RISK ANALYSIS ────────────────────────────────────────────────
    state.stage = 'RISK_ANALYSIS';
    const intentRisk = assessIntentRisk(intent);
    const planRisk = assessPlanRisk(state.plan);
    state.riskLevel =
      intentRisk.overall === 'critical' || planRisk.overall === 'critical'
        ? 'critical'
        : intentRisk.overall === 'high' || planRisk.overall === 'high'
          ? 'high'
          : intentRisk.overall === 'medium' || planRisk.overall === 'medium'
            ? 'medium'
            : 'low';
    pushTimeline(state, 'RISK_ANALYSIS', `Risk=${state.riskLevel}; boundaries=${planRisk.boundaryCrossings.join(',') || 'none'}`);

    recordDecision(state.workingMemory, {
      action: 'accept_plan_for_critique',
      confidence: decisionConfidence({
        evidenceCount: state.plan.length,
        hasTests: state.plan.some((p) => /test/i.test(p.objective)),
        risk: state.riskLevel,
        unknownFactors: planRisk.boundaryCrossings.length,
      }),
      evidence: state.plan.map((p) => p.objective),
      assumptions: intent.constraints,
      riskLevel: state.riskLevel,
      requiresApproval: planRisk.requiresHumanApproval,
    });

    // ── PLAN VALIDATION (Critic) ─────────────────────────────────────
    state.stage = 'PLAN_VALIDATION';
    let critic = critiquePlan(state.plan);
    pushTimeline(state, 'PLAN_VALIDATION', critic.summary);

    while (!critic.approved && state.planRevisions < state.budget.maxPlanRevisions) {
      state.planRevisions += 1;
      state.reflectionCycles += 1;
      // Safe revision: drop critical coder-deploy steps; re-decompose softer plan
      state.plan = state.plan.filter(
        (p) =>
          !(
            p.assignedAgent === 'coder' &&
            p.requiredCapabilities.includes('deployment.execute')
          )
      );
      // Re-run critic
      critic = critiquePlan(state.plan);
      pushTimeline(state, 'PLAN_VALIDATION', `Revision ${state.planRevisions}: ${critic.summary}`);
    }

    if (!critic.approved) {
      state.status = 'failed';
      state.resultSummary = `Plan rejected by critic: ${critic.summary}`;
      return finalize(state);
    }

    state.stage = 'EXECUTION_PLAN';
    state.status = 'executing';
    markReady(state.plan);

    // ── EXECUTION LOOP ───────────────────────────────────────────────
    const missingCapabilities: string[] = [];

    while (state.plan.some((p) => p.status === 'pending' || p.status === 'ready')) {
      assertRunnable(state);
      state.stage = 'EXECUTION';

      const batch = nextReadySteps(state.plan, state.budget.maxParallelAgents);
      if (!batch.length) {
        // Deadlock: pending but deps never satisfied
        const stuck = state.plan.filter((p) => p.status === 'pending');
        if (stuck.length) {
          for (const s of stuck) {
            s.status = 'skipped';
            state.errors.push(makeError(s.id, 'Dependencies never completed'));
          }
        }
        break;
      }

      // Sequential within batch if any writer (executor already limits writers)
      for (const step of batch) {
        assertRunnable(state);
        state.currentStep = state.plan.findIndex((p) => p.id === step.id);

        // Checkpoint before high-risk mutation
        if (step.riskLevel === 'high' || step.riskLevel === 'critical') {
          state.checkpoints.push({
            id: randomUUID().slice(0, 8),
            at: now(),
            stepId: step.id,
            label: `pre:${step.objective.slice(0, 60)}`,
            verified: true,
          });
          pushTimeline(state, 'EXECUTION', `Checkpoint before ${step.id}`);
        }

        const result = await executeStep(state, step);

        if (result.missingCapability) {
          missingCapabilities.push(result.missingCapability);
          pushTimeline(state, 'EXECUTION', `Missing capability: ${result.missingCapability}`);
          // Least-authority escalation is REQUEST only — Policy/Approval decide
          state.status = 'awaiting_approval';
          state.resultSummary = `Requires capability: ${result.missingCapability}`;
          return finalize(state, missingCapabilities);
        }

        if (result.approvalId || result.status === 'awaiting_approval') {
          state.status = 'awaiting_approval';
          pushTimeline(state, 'EXECUTION', `Approval required: ${result.approvalId || 'pending'}`);
          return finalize(state, missingCapabilities);
        }

        if (!result.ok) {
          state.stage = 'RECOVERY';
          state.status = 'recovering';
          const lastErr =
            state.errors[state.errors.length - 1] ||
            makeError(step.id, result.summary);
          if (!state.errors.includes(lastErr)) state.errors.push(lastErr);

          const action = recoveryPolicy(state, step, lastErr);
          pushTimeline(state, 'RECOVERY', `${action.type}: ${'reason' in action ? action.reason : action.type}`);

          if (action.type === 'retry') {
            step.status = 'ready';
            await sleep(action.backoffMs);
            continue;
          }
          if (action.type === 'request_approval') {
            state.status = 'awaiting_approval';
            return finalize(state, missingCapabilities);
          }
          if (action.type === 'revise_plan') {
            state.planRevisions += 1;
            if (state.planRevisions > state.budget.maxPlanRevisions) {
              state.status = 'failed';
              state.resultSummary = 'Max plan revisions exceeded';
              return finalize(state, missingCapabilities);
            }
            // Skip failed step and continue remaining
            step.status = 'skipped';
            markReady(state.plan);
            continue;
          }
          if (action.type === 'correct_input') {
            step.status = 'failed';
            state.status = 'failed';
            state.resultSummary = action.reason;
            return finalize(state, missingCapabilities);
          }
          // stop
          step.status = 'failed';
          state.status = 'failed';
          state.resultSummary = action.reason;
          return finalize(state, missingCapabilities);
        }

        // Post-success checkpoint
        state.checkpoints.push({
          id: randomUUID().slice(0, 8),
          at: now(),
          stepId: step.id,
          label: `post:${step.id}`,
          verified: step.verificationPassed === true,
        });
      }

      markReady(state.plan);
    }

    // ── FINAL RESULT ─────────────────────────────────────────────────
    state.stage = 'FINAL_RESULT';
    const failed = state.plan.filter((p) => p.status === 'failed');
    const done = state.plan.filter((p) => p.status === 'done');
    if (failed.length && !done.length) {
      state.status = 'failed';
      state.resultSummary = buildFailureSummary(state);
    } else if (state.pendingApprovals.length) {
      state.status = 'awaiting_approval';
      state.resultSummary = buildSuccessSummary(state) + ' (approvals pending)';
    } else {
      state.status = failed.length ? 'failed' : 'completed';
      state.resultSummary = failed.length ? buildFailureSummary(state) : buildSuccessSummary(state);
    }

    // Controlled memory write for outcomes
    writeLongTerm({
      kind: 'outcome',
      content: state.resultSummary || state.status,
      source: `task:${state.taskId}`,
      confidence: failed.length ? 0.4 : 0.7,
      scope: state.projectPath || 'global',
      sensitivity: 'internal',
      trusted: true,
    });

    return finalize(state, missingCapabilities);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'DIVA failed';
    state.status =
      state.status === 'cancelled' || state.cancelRequested ? 'cancelled' : 'failed';
    state.resultSummary = msg;
    state.errors.push(makeError(undefined, msg));
    pushTimeline(state, 'FINAL_RESULT', msg);
    return finalize(state);
  }
}

function finalize(state: DivaTaskState, missingCapabilities: string[] = []): DivaOutput {
  state.updatedAt = now();
  tasks.set(state.taskId, state);

  const remainingRisks = [
    ...state.errors.filter((e) => e.class === 'SECURITY').map((e) => e.message),
    ...state.plan
      .filter((p) => p.riskLevel === 'high' || p.riskLevel === 'critical')
      .filter((p) => p.status !== 'done')
      .map((p) => `Open high-risk step: ${p.objective}`),
  ];

  return {
    taskId: state.taskId,
    status: state.status,
    summary: state.resultSummary || state.status,
    riskLevel: state.riskLevel,
    stepResults: state.plan.map((p) => ({
      id: p.id,
      objective: p.objective,
      agent: p.assignedAgent,
      status: p.status,
      verified: p.verificationPassed,
    })),
    pendingApprovals: [...state.pendingApprovals],
    timeline: [...state.timeline],
    remainingRisks,
    missingCapabilities,
  };
}

function buildSuccessSummary(state: DivaTaskState): string {
  const done = state.plan.filter((p) => p.status === 'done');
  return [
    `Completed objective: ${state.objective.slice(0, 120)}`,
    `Steps verified: ${done.filter((p) => p.verificationPassed).length}/${done.length}`,
    `Risk level: ${state.riskLevel}`,
    `Tool calls: ${state.budget.usedToolCalls}/${state.budget.maxToolCalls}`,
    state.pendingApprovals.length
      ? `Pending approvals: ${state.pendingApprovals.join(', ')}`
      : 'No pending approvals',
  ].join(' | ');
}

function buildFailureSummary(state: DivaTaskState): string {
  const last = state.errors[state.errors.length - 1];
  return [
    `Failed: ${state.objective.slice(0, 100)}`,
    last ? `Cause (${last.class}): ${last.message}` : 'Unknown cause',
    `Attempts/plan revisions: ${state.attempts}/${state.planRevisions}`,
    'Recommended: inspect timeline, resolve approvals or missing capabilities, resume if safe',
  ].join(' | ');
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── Task controls (outside model) ─────────────────────────────────────────

export function pauseTask(taskId: string): DivaTaskState {
  const t = tasks.get(taskId);
  if (!t) throw new PlatformError('TASK_NOT_FOUND', 'Unknown task', 404);
  t.paused = true;
  t.status = 'paused';
  pushTimeline(t, 'CONTROL', 'Task paused by operator');
  return t;
}

export function resumeTask(taskId: string): DivaTaskState {
  const t = tasks.get(taskId);
  if (!t) throw new PlatformError('TASK_NOT_FOUND', 'Unknown task', 404);
  if (t.cancelRequested) {
    throw new PlatformError('TASK_CANCELLED', 'Cannot resume cancelled task', 409);
  }
  t.paused = false;
  t.status = 'executing';
  pushTimeline(t, 'CONTROL', 'Task resumed by operator');
  return t;
}

export function cancelTask(taskId: string): DivaTaskState {
  const t = tasks.get(taskId);
  if (!t) throw new PlatformError('TASK_NOT_FOUND', 'Unknown task', 404);
  t.cancelRequested = true;
  t.paused = false;
  t.status = 'cancelled';
  pushTimeline(t, 'CONTROL', 'Task cancelled by operator');
  emitAudit({
    agentId: 'diva',
    taskId,
    userId: t.userId,
    tool: 'diva.cancel',
    capability: null,
    resultStatus: 'cancelled',
    riskLevel: 'HIGH',
  });
  return t;
}

/** Operator emergency stop — also activates global kill switch */
export function emergencyStop(reason: string, operatorId = 'operator'): void {
  killSwitch.activate(reason, operatorId);
  for (const t of tasks.values()) {
    if (t.status === 'executing' || t.status === 'planning' || t.status === 'recovering') {
      t.cancelRequested = true;
      t.status = 'cancelled';
      pushTimeline(t, 'CONTROL', `Emergency stop: ${reason}`);
    }
  }
}

export function getDivaTask(taskId: string): DivaTaskState | undefined {
  return tasks.get(taskId);
}

export function getTaskTimeline(taskId: string): string {
  const t = tasks.get(taskId);
  if (!t) return '';
  return formatTimeline(t);
}

export default {
  manifest: DIVA_MANIFEST,
  run: runDiva,
  pauseTask,
  resumeTask,
  cancelTask,
  emergencyStop,
  getDivaTask,
  getTaskTimeline,
};
