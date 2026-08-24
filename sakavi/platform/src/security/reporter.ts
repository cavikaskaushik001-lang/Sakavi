/**
 * Security report generator — evidence-based, no hyped severity.
 */

import type { SecurityFinding, SecurityScope, RootCauseReport } from './types.js';

export function findingsToMarkdown(
  scope: SecurityScope,
  findings: SecurityFinding[],
  extra?: { stopReason?: string; rootCauses?: RootCauseReport[] }
): string {
  const lines: string[] = [
    '# Security Research Report',
    '',
    '## Authorization',
    `- Target: ${scope.target}`,
    `- Owner: ${scope.owner}`,
    `- Authorization ID: ${scope.authorizationId}`,
    `- Environment: ${scope.environment}`,
    `- Allowed hosts: ${scope.allowedHosts.join(', ') || '(none)'}`,
    `- Permitted actions: ${scope.permittedActions.join(', ')}`,
    '',
  ];

  if (extra?.stopReason) {
    lines.push('## Stop condition', extra.stopReason, '');
  }

  lines.push(`## Findings (${findings.length})`, '');

  if (!findings.length) {
    lines.push('_No findings reported._', '');
  }

  for (const f of findings) {
    lines.push(
      `### [${f.severity}/${f.confidence}] ${f.title}`,
      '',
      `- ID: ${f.id}`,
      `- Component: ${f.affectedComponent}`,
      `- Path: ${f.affectedPath}`,
      `- Verification: ${f.verificationStatus}`,
      '',
      '**Observed facts**',
      ...f.observedFacts.map((x) => `- ${x}`),
      '',
      '**Hypotheses** (not conclusions)',
      ...f.hypotheses.map((x) => `- ${x}`),
      '',
      '**Evidence**',
      ...f.evidence.map((x) => `- ${x}`),
      '',
      `**Reproduction:** ${f.reproductionSummary}`,
      `**Root cause (stated):** ${f.rootCause}`,
      `**Impact:** ${f.impact}`,
      `**Remediation:** ${f.remediation}`,
      `**Regression test:** ${f.regressionTest}`,
      ''
    );
  }

  if (extra?.rootCauses?.length) {
    lines.push('## Root cause analyses', '');
    for (const r of extra.rootCauses) {
      lines.push(
        `### ${r.symptom}`,
        `- Reproduction: ${r.reproduction}`,
        `- Root cause: ${r.rootCause}`,
        `- Fix: ${r.fix}`,
        `- Verification: ${r.verification}`,
        ''
      );
    }
  }

  lines.push(
    '## Disclaimer',
    'Static matches are not confirmed vulnerabilities until verified in an authorized lab.',
    'This report does not authorize further testing beyond the stated scope.',
    ''
  );

  return lines.join('\n');
}
