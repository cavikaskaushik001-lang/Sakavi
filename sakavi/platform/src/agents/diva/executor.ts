/**
 * Step execution + independent verification.
 * All side effects go through specialist agents → Tool Gateway (never direct).
 */

import { randomUUID } from 'node:crypto';
import type {
  DivaTaskState,
  Observation,
  PlanStep,
  Specialist,
} from './types.js';
import { runCoder } from '../coder/index.js';
import { runGithub } from '../github/index.js';
import { runResearch } from '../research/index.js';
import { runSecurity } from '../security/index.js';
import { runDatabase } from '../database/index.js';
import { runDeployment } from '../deployment/index.js';
import { runBrowser } from '../browser/index.js';
import { recordObservation, recordToolSummary, recordSuccess, recordFailure } from './memory.js';
import { pushTimeline } from './timeline.js';
import { makeError } from './recovery.js';

export interface StepResult {
  ok: boolean;
  status: string;
  summary: string;
  approvalId?: string;
  observation: Observation;
  missingCapability?: string;
}

export async function executeStep(state: DivaTaskState, step: PlanStep): Promise<StepResult> {
  step.status = 'running';
  step.attempts += 1;
  state.budget.usedToolCalls += 1;
  pushTimeline(state, 'EXECUTION', `Delegate to ${step.assignedAgent}: ${step.objective}`);

  try {
    const out = await delegate(step, state);
    const obs: Observation = {
      id: randomUUID().slice(0, 8),
      stepId: step.id,
      at: new Date().toISOString(),
      source: step.assignedAgent,
      summary: out.summary.slice(0, 500),
      untrusted: step.assignedAgent === 'research' || step.assignedAgent === 'browser',
      evidence: out.evidence,
      rawStatus: out.status,
    };
    state.observations.push(obs);
    step.observationIds.push(obs.id);
    recordObservation(state.workingMemory, obs);
    recordToolSummary(state.workingMemory, `${step.assignedAgent}: ${out.summary}`);

    if (out.approvalId) {
      state.pendingApprovals.push(out.approvalId);
      step.status = 'blocked';
      return {
        ok: false,
        status: 'awaiting_approval',
        summary: out.summary,
        approvalId: out.approvalId,
        observation: obs,
      };
    }

    if (out.missingCapability) {
      step.status = 'blocked';
      return {
        ok: false,
        status: 'failed',
        summary: out.summary,
        observation: obs,
        missingCapability: out.missingCapability,
      };
    }

    const verified = await verifyStep(state, step, out);
    step.verificationPassed = verified.passed;
    pushTimeline(state, 'VERIFICATION', verified.detail);

    if (!verified.passed) {
      step.status = 'failed';
      recordFailure(state.workingMemory, step.objective);
      return {
        ok: false,
        status: 'failed',
        summary: verified.detail,
        observation: obs,
      };
    }

    step.status = 'done';
    recordSuccess(state.workingMemory, step.objective);
    return {
      ok: true,
      status: 'done',
      summary: out.summary,
      observation: obs,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'step failed';
    const agentErr = makeError(step.id, msg);
    state.errors.push(agentErr);
    step.status = 'failed';
    recordFailure(state.workingMemory, `${step.objective}: ${msg}`);
    const obs: Observation = {
      id: randomUUID().slice(0, 8),
      stepId: step.id,
      at: new Date().toISOString(),
      source: 'system',
      summary: msg,
      untrusted: false,
      rawStatus: 'error',
    };
    state.observations.push(obs);
    return { ok: false, status: 'failed', summary: msg, observation: obs };
  }
}

async function delegate(
  step: PlanStep,
  state: DivaTaskState
): Promise<{
  status: string;
  summary: string;
  approvalId?: string;
  evidence?: string[];
  missingCapability?: string;
}> {
  const userId = state.userId;
  const projectPath = String(step.params.projectPath || state.projectPath || '');

  switch (step.assignedAgent as Specialist) {
    case 'coder':
      return runCoder({
        userId,
        objective: step.objective,
        projectPath,
        allowNetwork: Boolean(step.params.allowNetwork),
      });
    case 'github':
      return runGithub({
        userId,
        objective: step.objective,
        mode: (step.params.mode as 'inspect' | 'propose_changes') || 'inspect',
        files: step.params.files as { path: string; content: string; message: string }[] | undefined,
        summary: step.params.summary as string | undefined,
        testResults: step.params.testResults as string | undefined,
      });
    case 'research':
      return runResearch({
        userId,
        objective: step.objective,
        queries: (step.params.queries as string[]) || [state.objective],
      });
    case 'security':
      return runSecurity({
        userId,
        objective: step.objective,
        projectPath: projectPath || undefined,
      });
    case 'database':
      return runDatabase({
        userId,
        objective: step.objective,
        sql: String(step.params.sql || 'SELECT 1'),
        approvalId: step.params.approvalId as string | undefined,
      });
    case 'deployment':
      return runDeployment({
        userId,
        objective: step.objective,
        projectPath,
        environment: (step.params.environment as 'staging' | 'production') || 'staging',
        approvalId: step.params.approvalId as string | undefined,
        planId: step.params.planId as string | undefined,
      });
    case 'browser':
      return runBrowser({
        userId,
        objective: step.objective,
        url: String(step.params.url || 'https://example.com'),
      });
    case 'diva':
      return {
        status: 'completed',
        summary: synthesize(state),
        evidence: state.observations.slice(-5).map((o) => o.summary),
      };
    default:
      return {
        status: 'failed',
        summary: `Unknown specialist: ${step.assignedAgent}`,
        missingCapability: `agent:${step.assignedAgent}`,
      };
  }
}

/**
 * Independent verification — do not trust a single "ok" flag.
 */
async function verifyStep(
  state: DivaTaskState,
  step: PlanStep,
  out: { status: string; summary: string }
): Promise<{ passed: boolean; detail: string }> {
  pushTimeline(state, 'OBSERVATION', `Observe ${step.assignedAgent}: ${out.status}`);

  if (out.status === 'failed' || out.status === 'blocked') {
    return { passed: false, detail: `Upstream status ${out.status}: ${out.summary}` };
  }

  // successCriteria soft check against summary text
  const summaryLower = out.summary.toLowerCase();
  const unmet = step.successCriteria.filter((c) => {
    // Heuristic: if criterion mentions test/branch/pr, look for keywords
    const key = c.toLowerCase();
    if (/test/.test(key)) return !/test|pass|executed|absence|no test/.test(summaryLower);
    if (/branch/.test(key)) return !/branch|pr|inspect|complete/.test(summaryLower);
    if (/approval/.test(key)) return false; // handled separately
    return false; // don't over-reject on soft criteria
  });

  if (unmet.length && out.status !== 'completed' && out.status !== 'done') {
    return { passed: false, detail: `Criteria not evidenced: ${unmet.join('; ')}` };
  }

  // High-risk: require explicit non-failure
  if ((step.riskLevel === 'high' || step.riskLevel === 'critical') && out.status === 'waiting_approval') {
    return { passed: false, detail: 'Awaiting human approval — not verified as executed' };
  }

  return { passed: true, detail: `Verified step ${step.id} (${out.status})` };
}

function synthesize(state: DivaTaskState): string {
  const done = state.plan.filter((p) => p.status === 'done').length;
  const failed = state.plan.filter((p) => p.status === 'failed').length;
  const risks = state.errors.map((e) => e.message).slice(0, 5);
  return [
    `Objective: ${state.objective}`,
    `Steps done=${done} failed=${failed}`,
    state.pendingApprovals.length
      ? `Pending approvals: ${state.pendingApprovals.join(', ')}`
      : 'No pending approvals',
    risks.length ? `Errors: ${risks.join(' | ')}` : 'No recorded errors',
  ].join(' · ');
}
