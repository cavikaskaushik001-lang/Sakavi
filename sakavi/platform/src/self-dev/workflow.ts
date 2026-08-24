/**
 * Self-modification workflow — prepares branch/patch/PR materials.
 * Never activates production version; never silently edits protected core.
 */

import { randomUUID } from 'node:crypto';
import { killSwitch } from '../core/kill-switch.js';
import { analyzeSelfCode } from './analyzer.js';
import { filterWritablePaths, isProtectedPath } from './protected.js';
import { assertWithinBudget, DEFAULT_SELF_DEV_BUDGET, BudgetExceededError } from './budget.js';
import {
  ensureSelfDevDirs,
  writePatch,
  writeReport,
  writeTestResult,
  appendHistory,
  readHistory,
} from './workspace.js';
import { reviewSelfChange } from '../agents/self-reviewer/index.js';
import type { SelfRepairReport, SelfFinding } from './types.js';
import { impactAnalysis, ProjectGraph } from '../project/graph.js';
import { listPlatformSourceFiles } from './workspace.js';

export function prioritizeFindings(findings: SelfFinding[]): SelfFinding[] {
  const order = { critical: 0, high: 1, medium: 2, low: 3 };
  return [...findings].sort(
    (a, b) => order[a.severity] - order[b.severity] || b.confidence - a.confidence
  );
}

/**
 * Prepare a self-repair candidate. Does not mutate live source tree in-process.
 * Outputs patch metadata + review; human/CI applies and activates.
 */
export function selfRepair(options: {
  findingId?: string;
  dryRun?: boolean;
}): SelfRepairReport {
  killSwitch.assertNotActive();
  ensureSelfDevDirs();

  const history = readHistory(20);
  const prior = history.filter((h) => h.type === 'repair');
  if (prior.length >= DEFAULT_SELF_DEV_BUDGET.maxAttempts) {
    return {
      issueId: 'budget',
      rootCause: 'Self-repair attempt budget exhausted',
      evidence: [`Prior repairs in history: ${prior.length}`],
      affectedComponent: 'self-dev',
      minimalFix: 'Reset budget via operator',
      regressionTest: 'n/a',
      verificationPlan: 'Operator review',
      branchName: 'n/a',
      protectedBlocked: [],
      verified: false,
      finalStatus: 'BLOCKED',
    };
  }

  const findings = prioritizeFindings(analyzeSelfCode());
  const target =
    (options.findingId && findings.find((f) => f.id === options.findingId)) || findings[0];

  if (!target) {
    return {
      issueId: 'none',
      rootCause: 'No findings',
      evidence: [],
      affectedComponent: 'n/a',
      minimalFix: 'n/a',
      regressionTest: 'n/a',
      verificationPlan: 'n/a',
      branchName: 'n/a',
      protectedBlocked: [],
      verified: false,
      finalStatus: 'FAILED',
    };
  }

  const issueId = target.id;
  const branchName = `self/fix-${issueId}-${Date.now().toString(36)}`;
  const files = [target.file];
  const { allowed, protectedHits } = filterWritablePaths(files);

  if (protectedHits.length) {
    const report: SelfRepairReport = {
      issueId,
      rootCause: target.description,
      evidence: target.evidence,
      affectedComponent: target.file,
      minimalFix: target.suggestedFix || 'See external review',
      regressionTest: target.verificationPlan || 'Add regression test',
      verificationPlan: 'External review required for protected component',
      branchName,
      protectedBlocked: protectedHits,
      verified: false,
      finalStatus: 'NEEDS_EXTERNAL_REVIEW',
    };
    writeReport(`repair-protected-${issueId}.md`, JSON.stringify(report, null, 2));
    appendHistory({ type: 'repair', issueId, status: report.finalStatus });
    return report;
  }

  // Impact analysis
  const graph = ProjectGraph.fromFileList('diva-platform', listPlatformSourceFiles());
  const impact = impactAnalysis(graph, allowed);

  // Minimal patch proposal (text only — not applied to running process)
  const patchBody = [
    `--- a/${target.file}`,
    `+++ b/${target.file}`,
    `@@ proposal @@`,
    ` # Finding: ${target.description}`,
    ` # Suggested: ${target.suggestedFix || 'minimal fix'}`,
    ` # Confirmed: ${target.confirmed}`,
    ` # Impact:`,
    impact.report
      .split('\n')
      .map((l) => ` # ${l}`)
      .join('\n'),
  ].join('\n');

  try {
    assertWithinBudget(DEFAULT_SELF_DEV_BUDGET, {
      filesChanged: allowed.length,
      patchBytes: patchBody.length,
      attempt: prior.length + 1,
    });
  } catch (e) {
    if (e instanceof BudgetExceededError) {
      return {
        issueId,
        rootCause: e.message,
        evidence: target.evidence,
        affectedComponent: target.file,
        minimalFix: 'Reduce patch scope',
        regressionTest: '',
        verificationPlan: '',
        branchName,
        protectedBlocked: [],
        verified: false,
        finalStatus: 'BLOCKED',
      };
    }
    throw e;
  }

  const patchPath = writePatch(`${branchName.replace(/\//g, '_')}.patch`, patchBody);
  const testStub = writeTestResult(
    `${issueId}-plan.txt`,
    `Plan: reproduce → apply patch on branch ${branchName} → npm test → security tests → review`
  );

  const review = reviewSelfChange({
    branchName,
    changedFiles: allowed,
    diffSummary: patchBody,
    testSummary: 'pending — not yet executed in this dry preparation',
    authorRationale: target.suggestedFix || target.description,
  });

  const verified = false; // never claim verified until independent tests pass
  const finalStatus = review.requiresExternalReview
    ? 'NEEDS_EXTERNAL_REVIEW'
    : review.approved
      ? 'PREPARED_PR'
      : 'FAILED';

  const report: SelfRepairReport = {
    issueId,
    rootCause: target.description,
    evidence: [...target.evidence, `patch:${patchPath}`, `tests:${testStub}`],
    affectedComponent: target.file,
    minimalFix: target.suggestedFix || 'See patch proposal',
    regressionTest: target.verificationPlan || 'Add failing test then fix',
    verificationPlan:
      'On isolated branch: typecheck, unit, integration, security tests; canary; external activate/rollback',
    branchName,
    protectedBlocked: protectedHits,
    verified,
    finalStatus,
  };

  writeReport(`repair-${issueId}.md`, JSON.stringify(report, null, 2));
  appendHistory({
    type: 'repair',
    issueId,
    status: finalStatus,
    branchName,
    verified: false,
  });

  return report;
}
