/**
 * Task checkpoints — resume from last valid state.
 */

import { randomUUID } from 'node:crypto';
import type { DivaTaskV3, TaskCheckpoint } from './task-state.js';

export function makeCheckpoint(task: DivaTaskV3, label: string, stepId?: string): TaskCheckpoint {
  const snapshot = JSON.stringify({
    status: task.status,
    completedSteps: task.completedSteps,
    failedSteps: task.failedSteps,
    planStepIds: task.planStepIds,
    usedToolCalls: task.budget.usedToolCalls,
    failedApproaches: task.failedApproaches.slice(-10),
    resultSummary: task.resultSummary,
  });
  return {
    id: randomUUID().slice(0, 10),
    at: new Date().toISOString(),
    label,
    stepId,
    stateSnapshot: snapshot,
    verified: true,
  };
}

export function applyCheckpoint(task: DivaTaskV3, cp: TaskCheckpoint): DivaTaskV3 {
  try {
    const data = JSON.parse(cp.stateSnapshot) as Partial<DivaTaskV3> & {
      usedToolCalls?: number;
    };
    task.status = (data.status as DivaTaskV3['status']) || task.status;
    if (data.completedSteps) task.completedSteps = data.completedSteps;
    if (data.failedSteps) task.failedSteps = data.failedSteps;
    if (data.planStepIds) task.planStepIds = data.planStepIds;
    if (typeof data.usedToolCalls === 'number') task.budget.usedToolCalls = data.usedToolCalls;
    if (data.failedApproaches) task.failedApproaches = data.failedApproaches as DivaTaskV3['failedApproaches'];
    task.updatedAt = new Date().toISOString();
  } catch {
    /* keep task as-is if snapshot corrupt */
  }
  return task;
}

export function latestCheckpoint(task: DivaTaskV3): TaskCheckpoint | undefined {
  return task.checkpoints[task.checkpoints.length - 1];
}
