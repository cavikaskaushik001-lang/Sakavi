/**
 * DIVA V3 final report — never claim success without verification.
 */

import type { FinalStatus } from '../../core/task-engine/task-state.js';
import type { Evaluation } from '../../core/self-evaluation.js';
import type { TaskQuality } from '../../core/task-engine/task-state.js';

export interface DivaV3Report {
  objective: string;
  plan: string[];
  actions: string[];
  changes: string[];
  evidence: string[];
  tests: string[];
  verification: string;
  failures: string[];
  recovery: string[];
  remainingIssues: string[];
  risk: string;
  finalStatus: FinalStatus;
  evaluation?: Evaluation;
  quality?: TaskQuality;
}

export function buildFinalReport(partial: Omit<DivaV3Report, 'finalStatus'> & {
  verified: boolean;
  blocked?: boolean;
  failed?: boolean;
  partial?: boolean;
}): DivaV3Report {
  let finalStatus: FinalStatus = 'UNKNOWN';
  if (partial.blocked) finalStatus = 'BLOCKED';
  else if (partial.failed) finalStatus = 'FAILED';
  else if (partial.verified) finalStatus = 'VERIFIED_SUCCESS';
  else if (partial.partial) finalStatus = 'PARTIALLY_COMPLETE';
  else finalStatus = 'UNKNOWN';

  // Never VERIFIED_SUCCESS if verification string says incomplete
  if (
    finalStatus === 'VERIFIED_SUCCESS' &&
    /incomplete|not verified|unverified/i.test(partial.verification)
  ) {
    finalStatus = 'PARTIALLY_COMPLETE';
  }

  return { ...partial, finalStatus };
}

export function scoreQuality(params: {
  verified: boolean;
  failedApproaches: number;
  toolCalls: number;
  maxToolCalls: number;
  unexpectedChanges: number;
  hadRegression: boolean;
}): TaskQuality {
  const correctness = params.verified ? 0.9 : 0.3;
  const verification = params.verified ? 0.9 : 0.2;
  const efficiency = Math.max(0.2, 1 - params.toolCalls / Math.max(1, params.maxToolCalls));
  const reliability = Math.max(0.1, 1 - params.failedApproaches * 0.15);
  const scopeDiscipline = Math.max(0.2, 1 - params.unexpectedChanges * 0.2);
  const recovery = params.failedApproaches ? 0.6 : 0.8;
  const regressionSafety = params.hadRegression ? 0.9 : 0.5;
  const overall =
    (correctness +
      verification +
      efficiency +
      reliability +
      scopeDiscipline +
      recovery +
      regressionSafety) /
    7;
  return {
    correctness,
    verification,
    efficiency,
    reliability,
    scopeDiscipline,
    recovery,
    regressionSafety,
    overall,
  };
}
