/**
 * Infrastructure-level self-modification budgets (not model instructions).
 */

export interface SelfDevBudget {
  maxFilesChanged: number;
  maxPatchBytes: number;
  maxTestDurationMs: number;
  maxAttempts: number;
  maxConcurrentTasks: number;
}

export const DEFAULT_SELF_DEV_BUDGET: SelfDevBudget = {
  maxFilesChanged: 12,
  maxPatchBytes: 200_000,
  maxTestDurationMs: 15 * 60 * 1000,
  maxAttempts: 5,
  maxConcurrentTasks: 1,
};

export class BudgetExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BudgetExceededError';
  }
}

export function assertWithinBudget(
  budget: SelfDevBudget,
  usage: {
    filesChanged: number;
    patchBytes: number;
    attempt: number;
  }
): void {
  if (usage.filesChanged > budget.maxFilesChanged) {
    throw new BudgetExceededError(
      `Self-dev budget: files changed ${usage.filesChanged} > ${budget.maxFilesChanged}`
    );
  }
  if (usage.patchBytes > budget.maxPatchBytes) {
    throw new BudgetExceededError(
      `Self-dev budget: patch size ${usage.patchBytes} > ${budget.maxPatchBytes}`
    );
  }
  if (usage.attempt > budget.maxAttempts) {
    throw new BudgetExceededError(
      `Self-dev budget: attempts ${usage.attempt} > ${budget.maxAttempts}`
    );
  }
}
