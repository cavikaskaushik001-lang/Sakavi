/**
 * Independent plan critic — reviews planner output before execution.
 * Looks for excessive permissions, missing tests/rollback, cycles, etc.
 */

import type { CriticReport, PlanStep, DivaRiskLevel } from './types.js';
import { hasCircularDeps } from './planner.js';
import { assessStepRisk } from './risk-engine.js';

export function critiquePlan(plan: PlanStep[]): CriticReport {
  const issues: CriticReport['issues'] = [];
  const revisions: CriticReport['revisions'] = [];

  if (!plan.length) {
    return {
      approved: false,
      issues: [{ severity: 'high', message: 'Empty plan' }],
      revisions: [],
      summary: 'Plan rejected: empty',
    };
  }

  if (hasCircularDeps(plan)) {
    issues.push({ severity: 'critical', message: 'Circular dependencies detected' });
  }

  const hasWrite = plan.some(
    (p) =>
      p.requiredCapabilities.includes('workspace.write') ||
      p.requiredCapabilities.includes('github.write')
  );
  const hasTest = plan.some(
    (p) =>
      /test/i.test(p.objective) ||
      p.successCriteria.some((c) => /test/i.test(c))
  );
  if (hasWrite && !hasTest) {
    issues.push({
      severity: 'medium',
      message: 'Code/write steps without explicit test verification',
    });
  }

  for (const s of plan) {
    if (!s.successCriteria.length) {
      issues.push({
        severity: 'medium',
        message: `Step ${s.id} lacks success criteria`,
      });
      revisions.push({
        id: s.id,
        successCriteria: ['Step completes without error', 'Outcome recorded in observations'],
      });
    }

    const risk = assessStepRisk(s);
    if ((risk === 'high' || risk === 'critical') && !s.rollbackStrategy) {
      issues.push({
        severity: risk,
        message: `High-risk step ${s.id} missing rollback strategy`,
      });
      revisions.push({
        id: s.id,
        rollbackStrategy: 'Halt and request operator guidance; do not retry destructive op',
      });
    }

    // Excessive capabilities for agent role
    if (s.assignedAgent === 'research' && s.requiredCapabilities.some((c) => c.includes('write'))) {
      issues.push({
        severity: 'high',
        message: `Research step ${s.id} requests write capability`,
      });
    }
    if (s.assignedAgent === 'coder' && s.requiredCapabilities.includes('deployment.execute')) {
      issues.push({
        severity: 'critical',
        message: `Coder step ${s.id} must not execute production deploy`,
      });
    }

    // Network only when needed
    if (
      s.requiredCapabilities.includes('network.read') &&
      !/research|install|fetch|npm|pip|browser/i.test(s.objective)
    ) {
      issues.push({
        severity: 'low',
        message: `Step ${s.id} requests network without clear need`,
      });
    }

    // Secrets
    if (s.requiredCapabilities.includes('secrets.request')) {
      issues.push({
        severity: 'critical',
        message: `Step ${s.id} requests secrets — requires explicit approval`,
      });
    }

    // Ambiguous objectives
    if (s.objective.trim().length < 8) {
      issues.push({ severity: 'medium', message: `Step ${s.id} has vague objective` });
    }
  }

  // Apply soft revisions in-place for missing criteria / rollback
  for (const rev of revisions) {
    const target = plan.find((p) => p.id === rev.id);
    if (!target) continue;
    if (rev.successCriteria) target.successCriteria = rev.successCriteria;
    if (rev.rollbackStrategy) target.rollbackStrategy = rev.rollbackStrategy;
  }

  const critical = issues.filter((i) => i.severity === 'critical');
  const approved = critical.length === 0;

  return {
    approved,
    issues,
    revisions,
    summary: approved
      ? `Plan accepted with ${issues.length} non-blocking notes`
      : `Plan blocked: ${critical.map((c) => c.message).join('; ')}`,
  };
}

export function riskFromIssues(issues: CriticReport['issues']): DivaRiskLevel {
  if (issues.some((i) => i.severity === 'critical')) return 'critical';
  if (issues.some((i) => i.severity === 'high')) return 'high';
  if (issues.some((i) => i.severity === 'medium')) return 'medium';
  return 'low';
}
