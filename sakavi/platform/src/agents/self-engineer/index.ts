/**
 * Self-engineer agent — inspect and improve DIVA source via controlled workflow.
 * Cannot activate production version or modify protected security infrastructure.
 */

import type { AgentManifest } from '../../core/types.js';
import { killSwitch } from '../../core/kill-switch.js';
import { emitAudit } from '../../core/audit.js';
import { analyzeSelfCode } from '../../self-dev/analyzer.js';
import { buildArchitectureMap, architectureDiagram } from '../../self-dev/architecture-map.js';
import {
  ensureSelfDevDirs,
  writeReport,
  appendHistory,
  listPlatformSourceFiles,
} from '../../self-dev/workspace.js';
import type { SelfFinding } from '../../self-dev/types.js';
import { isProtectedPath } from '../../self-dev/protected.js';

export const SELF_ENGINEER_MANIFEST: AgentManifest = {
  id: 'coder',
  name: 'SelfEngineer',
  description: 'Analyze and prepare patches for DIVA source (isolated workflow)',
  allowedCapabilities: [
    'workspace.read',
    'workspace.write',
    'process.execute',
    'git.read',
    'git.write',
    'github.write',
    'github.pull_request',
    'security.inspect',
  ],
  maxToolCalls: 40,
  maxTaskDurationMs: 30 * 60 * 1000,
  maxRetries: 2,
  defaultTimeoutMs: 120_000,
};

export interface SelfDiagnoseResult {
  version: string;
  architecture: string;
  modules: number;
  sourceFiles: number;
  findings: SelfFinding[];
  protectedPathsNoted: string[];
  health: Record<string, string>;
  reportPath: string;
}

export function selfDiagnose(): SelfDiagnoseResult {
  killSwitch.assertNotActive();
  ensureSelfDevDirs();

  const modules = buildArchitectureMap();
  const files = listPlatformSourceFiles();
  const findings = analyzeSelfCode();
  const protectedPathsNoted = files.filter((f) => isProtectedPath(f));

  const health: Record<string, string> = {
    killSwitch: 'external (ok if inactive)',
    sourceTree: files.length ? 'readable' : 'empty',
    architectureMap: modules.length ? 'built' : 'empty',
    findings: String(findings.length),
    note: 'Diagnose does not mutate code',
  };

  const report = [
    '# DIVA Self Diagnose',
    '',
    architectureDiagram(modules),
    '',
    `Source files: ${files.length}`,
    `Findings (unconfirmed static): ${findings.length}`,
    '',
    '## Top findings',
    ...findings.slice(0, 20).map(
      (f) =>
        `- [${f.severity}/${f.confidence.toFixed(2)}] ${f.category} ${f.file}: ${f.description}`
    ),
    '',
    '## Protected paths (no autonomous activation)',
    ...protectedPathsNoted.map((p) => `- ${p}`),
  ].join('\n');

  const reportPath = writeReport(`diagnose-${Date.now()}.md`, report);
  appendHistory({ type: 'diagnose', findings: findings.length, reportPath });

  emitAudit({
    agentId: 'coder',
    taskId: 'self-diagnose',
    userId: 'system',
    tool: 'self.diagnose',
    capability: 'workspace.read',
    resultStatus: 'ok',
    riskLevel: 'LOW',
    meta: { findings: findings.length },
  });

  return {
    version: process.env.DIVA_VERSION || '3.0.0-dev',
    architecture: architectureDiagram(modules),
    modules: modules.length,
    sourceFiles: files.length,
    findings,
    protectedPathsNoted,
    health,
    reportPath,
  };
}

export function selfAudit(): {
  unusedHints: string[];
  testGaps: SelfFinding[];
  dependencyNotes: string[];
  reportPath: string;
} {
  const findings = analyzeSelfCode();
  const testGaps = findings.filter((f) => f.category === 'test_gap');
  const unusedHints = findings
    .filter((f) => f.category === 'maintainability')
    .map((f) => `${f.file}: ${f.description}`);
  const dependencyNotes = [
    'Run npm audit externally for CVE data',
    'package.json must not embed secrets',
  ];
  const reportPath = writeReport(
    `audit-${Date.now()}.md`,
    ['# Self Audit', '', `Test gaps: ${testGaps.length}`, ...unusedHints.slice(0, 30)].join('\n')
  );
  appendHistory({ type: 'audit', testGaps: testGaps.length });
  return { unusedHints, testGaps, dependencyNotes, reportPath };
}

export default { manifest: SELF_ENGINEER_MANIFEST, selfDiagnose, selfAudit };
