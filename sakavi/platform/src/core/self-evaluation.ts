/**
 * Self-evaluation — does NOT replace independent verification.
 */

import type { EvidenceItem } from './evidence/types.js';

export interface Evaluation {
  goalAchieved: boolean;
  confidence: number;
  evidence: EvidenceItem[];
  unresolvedIssues: string[];
  unexpectedChanges: string[];
  recommendedNextAction?: string;
  notes: string[];
}

export function evaluateStage(params: {
  goal: string;
  expected: string;
  actual: string;
  evidence: EvidenceItem[];
  unresolved?: string[];
  unexpected?: string[];
  verifiedExternally?: boolean;
}): Evaluation {
  const goalAchieved =
    Boolean(params.verifiedExternally) &&
    !/fail|error|blocked/i.test(params.actual) &&
    params.evidence.some((e) => e.type === 'test' || e.type === 'tool_result');

  let confidence = 0.4;
  confidence += Math.min(0.3, params.evidence.length * 0.05);
  if (params.verifiedExternally) confidence += 0.25;
  if ((params.unresolved || []).length) confidence -= 0.15;
  confidence = Math.max(0, Math.min(1, confidence));

  return {
    goalAchieved,
    confidence,
    evidence: params.evidence,
    unresolvedIssues: params.unresolved || [],
    unexpectedChanges: params.unexpected || [],
    recommendedNextAction: goalAchieved
      ? undefined
      : 'Collect more evidence or run independent verification',
    notes: [
      `Goal: ${params.goal}`,
      `Expected: ${params.expected}`,
      `Actual: ${params.actual}`,
      'Self-eval is advisory; external verification is authoritative',
    ],
  };
}

/** Confidence calibration record */
export interface CalibrationSample {
  predictedConfidence: number;
  actualSuccess: boolean;
  at: string;
}

const calibration: CalibrationSample[] = [];

export function recordCalibration(predictedConfidence: number, actualSuccess: boolean): void {
  calibration.push({
    predictedConfidence,
    actualSuccess,
    at: new Date().toISOString(),
  });
  if (calibration.length > 200) calibration.shift();
}

export function calibrationSummary(): { samples: number; avgPredicted: number; successRate: number } {
  if (!calibration.length) return { samples: 0, avgPredicted: 0, successRate: 0 };
  const avgPredicted =
    calibration.reduce((s, c) => s + c.predictedConfidence, 0) / calibration.length;
  const successRate = calibration.filter((c) => c.actualSuccess).length / calibration.length;
  return { samples: calibration.length, avgPredicted, successRate };
}
