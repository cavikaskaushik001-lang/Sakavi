/**
 * Structured failure classification and recovery policy.
 * Destructive ops are never blindly retried.
 */

import type { AgentError, FailureClass, PlanStep, DivaTaskState } from './types.js';
import { randomUUID } from 'node:crypto';

export function classifyFailure(message: string, code?: string): FailureClass {
  const m = `${code || ''} ${message}`.toLowerCase();
  if (/timeout|econnreset|temporarily|rate.?limit|503|busy/.test(m)) return 'TRANSIENT';
  if (/capability_denied|authorization|403|401|forbidden|approval/.test(m)) return 'AUTHORIZATION';
  if (/validation|invalid|schema|zod|malformed/.test(m)) return 'VALIDATION';
  if (/tool_not_found|handler|not configured|stub/.test(m)) return 'TOOL';
  if (/sandbox|docker|image_missing|environment|enospace/.test(m)) return 'ENVIRONMENT';
  if (/policy_violation|kill_switch|security|secret|protected_branch/.test(m)) return 'SECURITY';
  if (/assert|logic|invariant|criteria/.test(m)) return 'LOGIC';
  return 'UNKNOWN';
}

export function isRetriable(fc: FailureClass, step: PlanStep): boolean {
  if (step.riskLevel === 'critical' || step.riskLevel === 'high') {
    // Never auto-retry high-risk / destructive-ish steps
    if (fc === 'TRANSIENT' && step.riskLevel === 'high' && step.assignedAgent !== 'deployment') {
      return step.attempts < 1;
    }
    return false;
  }
  return fc === 'TRANSIENT' || fc === 'TOOL' || fc === 'ENVIRONMENT';
}

export function makeError(stepId: string | undefined, message: string, code?: string): AgentError {
  const fc = classifyFailure(message, code);
  return {
    id: randomUUID().slice(0, 8),
    stepId,
    at: new Date().toISOString(),
    class: fc,
    message: message.slice(0, 500),
    retriable: false, // set by caller with step context
  };
}

export type RecoveryAction =
  | { type: 'retry'; backoffMs: number }
  | { type: 'revise_plan'; reason: string }
  | { type: 'request_approval'; reason: string }
  | { type: 'stop'; reason: string }
  | { type: 'correct_input'; reason: string };

export function recoveryPolicy(
  state: DivaTaskState,
  step: PlanStep,
  err: AgentError
): RecoveryAction {
  err.retriable = isRetriable(err.class, step);

  if (err.class === 'SECURITY' || err.class === 'AUTHORIZATION') {
    return { type: 'request_approval', reason: err.message };
  }
  if (err.class === 'VALIDATION') {
    return { type: 'correct_input', reason: err.message };
  }
  if (err.class === 'LOGIC') {
    if (state.planRevisions >= state.budget.maxPlanRevisions) {
      return { type: 'stop', reason: 'Max plan revisions exceeded after logic failure' };
    }
    return { type: 'revise_plan', reason: err.message };
  }
  if (err.class === 'UNKNOWN') {
    return { type: 'stop', reason: `Unknown failure — halting risky continuation: ${err.message}` };
  }
  if (err.retriable && step.attempts < state.budget.maxRetries) {
    const backoff = Math.min(8000, 500 * Math.pow(2, step.attempts));
    return { type: 'retry', backoffMs: backoff };
  }
  if (state.planRevisions < state.budget.maxPlanRevisions && err.class !== 'SECURITY') {
    return { type: 'revise_plan', reason: `Exhausted retries: ${err.message}` };
  }
  return { type: 'stop', reason: err.message };
}
