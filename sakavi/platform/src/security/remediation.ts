/**
 * Minimal remediation guidance + optional branch workflow notes.
 * Actual code changes go through Coder/GitHub agents + sandbox — never silent prod edits.
 */

import type { SecurityFinding, RootCauseReport } from './types.js';

export function buildRootCause(f: SecurityFinding): RootCauseReport {
  return {
    symptom: f.title,
    reproduction: f.reproductionSummary,
    executionPath: [f.affectedPath, f.affectedComponent],
    rootCause: f.rootCause,
    contributingFactors: f.hypotheses,
    fix: f.remediation,
    regressionTest: f.regressionTest,
    verification: f.verificationStatus,
    observedFacts: f.observedFacts,
    hypotheses: f.hypotheses,
    conclusions:
      f.verificationStatus === 'reproduced' || f.confidence === 'CONFIRMED'
        ? [`Issue supported by evidence at ${f.affectedPath}`]
        : ['No confirmed exploitation — treat as unverified finding'],
  };
}

export function remediationPlan(findings: SecurityFinding[]): {
  ordered: SecurityFinding[];
  branchName: string;
  steps: string[];
} {
  const severityOrder = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3, INFO: 4 };
  const ordered = [...findings].sort(
    (a, b) => severityOrder[a.severity] - severityOrder[b.severity]
  );

  return {
    ordered,
    branchName: `security/fix-${Date.now().toString(36)}`,
    steps: [
      'Create security/debug branch (never push to main/master)',
      'Apply minimal patches for CONFIRMED/HIGH confidence issues first',
      'Add regression tests listed on each finding',
      'Run unit/integration tests in sandbox',
      'Re-run passive security scan',
      'Open draft PR with evidence and residual risk',
    ],
  };
}

export function minimalFixHint(f: SecurityFinding): string {
  switch (f.affectedComponent) {
    case 'secrets':
      return 'Remove secret from code; rotate credential; add secret scanning to CI';
    case 'injection':
      return 'Replace string concatenation with parameterized APIs; add negative tests';
    case 'command_execution':
      return 'Remove shell interpolation; allowlist executables and args';
    case 'path_traversal':
      return 'Resolve path and ensure prefix stays inside trusted root';
    case 'ssrf':
      return 'Allowlist outbound hosts; block link-local/metadata IPs';
    default:
      return f.remediation;
  }
}
