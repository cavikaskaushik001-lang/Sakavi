/**
 * Independent self-reviewer — uses diff/tests evidence, not author narrative alone.
 */

import type { AgentManifest } from '../../core/types.js';
import { writeReview, appendHistory } from '../../self-dev/workspace.js';
import { isProtectedPath, filterWritablePaths } from '../../self-dev/protected.js';
import { assertWithinBudget, DEFAULT_SELF_DEV_BUDGET } from '../../self-dev/budget.js';

export const SELF_REVIEWER_MANIFEST: AgentManifest = {
  id: 'security',
  name: 'SelfReviewer',
  description: 'Independent review of self-modification candidates',
  allowedCapabilities: ['workspace.read', 'security.inspect', 'git.read'],
  maxToolCalls: 20,
  maxTaskDurationMs: 10 * 60 * 1000,
  maxRetries: 1,
  defaultTimeoutMs: 60_000,
};

export interface ReviewInput {
  branchName: string;
  changedFiles: string[];
  diffSummary: string;
  testSummary: string;
  authorRationale: string;
}

export interface ReviewResult {
  approved: boolean;
  requiresExternalReview: boolean;
  issues: string[];
  evidence: string[];
  reviewPath: string;
}

export function reviewSelfChange(input: ReviewInput): ReviewResult {
  const issues: string[] = [];
  const evidence: string[] = [];

  const { allowed, protectedHits } = filterWritablePaths(input.changedFiles);
  if (protectedHits.length) {
    issues.push(`Protected paths in change set: ${protectedHits.join(', ')}`);
    evidence.push('Protected path policy blocked autonomous approval');
  }

  try {
    assertWithinBudget(DEFAULT_SELF_DEV_BUDGET, {
      filesChanged: input.changedFiles.length,
      patchBytes: input.diffSummary.length,
      attempt: 1,
    });
  } catch (e) {
    issues.push(e instanceof Error ? e.message : 'budget exceeded');
  }

  if (!input.testSummary || /fail|error/i.test(input.testSummary)) {
    issues.push('Tests not clearly passing');
  } else {
    evidence.push(`Tests: ${input.testSummary.slice(0, 200)}`);
  }

  if (!input.diffSummary.trim()) {
    issues.push('Empty diff — nothing to review');
  }

  // Scope: reject huge unrelated claims without evidence in diff
  if (input.authorRationale.length > 2000 && input.diffSummary.length < 100) {
    issues.push('Rationale far larger than diff — suspicious scope');
  }

  const requiresExternalReview = protectedHits.length > 0 || issues.some((i) => /Protected|budget/i.test(i));
  const approved = issues.length === 0 && !requiresExternalReview;

  const body = [
    '# Self Review',
    `Branch: ${input.branchName}`,
    `Approved: ${approved}`,
    `External review required: ${requiresExternalReview}`,
    '',
    '## Issues',
    ...issues.map((i) => `- ${i}`),
    '',
    '## Evidence',
    ...evidence.map((e) => `- ${e}`),
    '',
    '## Changed files',
    ...input.changedFiles.map((f) => `- ${f}${isProtectedPath(f) ? ' [PROTECTED]' : ''}`),
  ].join('\n');

  const reviewPath = writeReview(`review-${Date.now()}.md`, body);
  appendHistory({
    type: 'review',
    approved,
    requiresExternalReview,
    files: input.changedFiles.length,
  });

  return { approved, requiresExternalReview, issues, evidence, reviewPath };
}

export default { manifest: SELF_REVIEWER_MANIFEST, reviewSelfChange };
