/**
 * CLI entrypoints:
 *   diva self diagnose | repair | audit
 *
 * Usage (from platform/):
 *   npx tsx src/self-dev/cli.ts diagnose
 *   npx tsx src/self-dev/cli.ts audit
 *   npx tsx src/self-dev/cli.ts repair
 */

import { selfDiagnose, selfAudit } from '../agents/self-engineer/index.js';
import { selfRepair } from './workflow.js';

async function main(): Promise<void> {
  const cmd = process.argv[2] || 'diagnose';
  if (cmd === 'diagnose') {
    const r = selfDiagnose();
    console.log(JSON.stringify({ version: r.version, findings: r.findings.length, reportPath: r.reportPath, health: r.health }, null, 2));
    return;
  }
  if (cmd === 'audit') {
    const r = selfAudit();
    console.log(JSON.stringify({ testGaps: r.testGaps.length, reportPath: r.reportPath }, null, 2));
    return;
  }
  if (cmd === 'repair') {
    const r = selfRepair({});
    console.log(JSON.stringify(r, null, 2));
    return;
  }
  console.error('Usage: cli.ts [diagnose|audit|repair]');
  process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
