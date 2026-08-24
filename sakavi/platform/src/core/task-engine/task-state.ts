/**
 * Durable task state for long-horizon execution.
 * Attempted ≠ successful ≠ verified.
 */

import type { EvidenceItem } from '../evidence/types.js';

export type TaskStatus =
  | 'created'
  | 'planning'
  | 'awaiting_approval'
  | 'executing'
  | 'verifying'
  | 'evaluating'
  | 'recovering'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'blocked'
  | 'unknown';

export type FinalStatus =
  | 'VERIFIED_SUCCESS'
  | 'PARTIALLY_COMPLETE'
  | 'FAILED'
  | 'BLOCKED'
  | 'UNKNOWN';

export interface TaskCheckpoint {
  id: string;
  at: string;
  label: string;
  stepId?: string;
  stateSnapshot: string; // JSON of critical fields
  verified: boolean;
}

export interface FailedApproach {
  strategy: string;
  assumption: string;
  action: string;
  result: string;
  failureReason: string;
  lesson: string;
  at: string;
}

export interface TaskQuality {
  correctness: number;
  verification: number;
  efficiency: number;
  reliability: number;
  scopeDiscipline: number;
  recovery: number;
  regressionSafety: number;
  overall: number;
}

export interface DivaTaskV3 {
  id: string;
  userId: string;
  objective: string;
  status: TaskStatus;
  finalStatus?: FinalStatus;
  planStepIds: string[];
  activeAgents: string[];
  completedSteps: string[];
  failedSteps: string[];
  observations: string[];
  decisions: string[];
  evidenceIds: string[];
  failedApproaches: FailedApproach[];
  checkpoints: TaskCheckpoint[];
  quality?: TaskQuality;
  budget: {
    maxToolCalls: number;
    usedToolCalls: number;
    maxDurationMs: number;
    maxRetries: number;
    maxParallelAgents: number;
  };
  projectPath?: string;
  createdAt: string;
  updatedAt: string;
  deadline: string;
  lastError?: string;
  resultSummary?: string;
}

export function createEmptyTask(partial: {
  id: string;
  userId: string;
  objective: string;
  projectPath?: string;
  maxDurationMs?: number;
}): DivaTaskV3 {
  const now = new Date().toISOString();
  const maxDurationMs = partial.maxDurationMs ?? 45 * 60 * 1000;
  return {
    id: partial.id,
    userId: partial.userId,
    objective: partial.objective,
    status: 'created',
    planStepIds: [],
    activeAgents: [],
    completedSteps: [],
    failedSteps: [],
    observations: [],
    decisions: [],
    evidenceIds: [],
    failedApproaches: [],
    checkpoints: [],
    budget: {
      maxToolCalls: 50,
      usedToolCalls: 0,
      maxDurationMs,
      maxRetries: 2,
      maxParallelAgents: 3,
    },
    projectPath: partial.projectPath,
    createdAt: now,
    updatedAt: now,
    deadline: new Date(Date.now() + maxDurationMs).toISOString(),
  };
}
