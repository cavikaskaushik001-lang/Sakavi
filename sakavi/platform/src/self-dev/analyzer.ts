/**
 * Static self-code analysis — findings start unconfirmed.
 */

import { randomUUID } from 'node:crypto';
import type { SelfFinding } from './types.js';
import { listPlatformSourceFiles, readPlatformFile } from './workspace.js';
import { isProtectedPath } from './protected.js';

interface Rule {
  category: SelfFinding['category'];
  severity: SelfFinding['severity'];
  re: RegExp;
  description: string;
  suggestedFix: string;
}

const RULES: Rule[] = [
  {
    category: 'reliability',
    severity: 'medium',
    re: /catch\s*\([^)]*\)\s*\{\s*\}/g,
    description: 'Empty catch block may swallow errors',
    suggestedFix: 'Log or rethrow structured error; avoid silent catch',
  },
  {
    category: 'maintainability',
    severity: 'low',
    re: /\bany\b/g,
    description: 'Use of TypeScript any reduces type safety',
    suggestedFix: 'Replace with unknown or precise types',
  },
  {
    category: 'security',
    severity: 'high',
    re: /console\.log\([^)]*(?:token|password|secret|key)/gi,
    description: 'Possible secret logged to console',
    suggestedFix: 'Remove secret from logs; use redacted audit',
  },
  {
    category: 'reliability',
    severity: 'medium',
    re: /TODO|FIXME/g,
    description: 'Outstanding TODO/FIXME marker',
    suggestedFix: 'Track issue or resolve before release',
  },
  {
    category: 'performance',
    severity: 'low',
    re: /JSON\.parse\(JSON\.stringify/g,
    description: 'Expensive deep clone via JSON',
    suggestedFix: 'Use structuredClone or targeted copy',
  },
];

export function analyzeSelfCode(): SelfFinding[] {
  const files = listPlatformSourceFiles();
  const findings: SelfFinding[] = [];

  for (const file of files) {
    let content: string;
    try {
      content = readPlatformFile(file);
    } catch {
      continue;
    }
    for (const rule of RULES) {
      rule.re.lastIndex = 0;
      if (!rule.re.test(content)) continue;
      rule.re.lastIndex = 0;
      const count = (content.match(rule.re) || []).length;
      findings.push({
        id: randomUUID().slice(0, 10),
        category: rule.category,
        severity: rule.severity,
        confidence: Math.min(0.85, 0.4 + count * 0.05),
        file,
        description: rule.description,
        evidence: [`Pattern matched ${count} time(s) in ${file}`],
        suggestedFix: rule.suggestedFix,
        verificationPlan: 'Add lint rule or unit test; re-scan after fix',
        confirmed: false,
      });
    }

    // Test gap: module without nearby test reference
    if (
      file.startsWith('src/') &&
      file.endsWith('.ts') &&
      !file.includes('.test.') &&
      !file.includes('/types/') &&
      content.includes('export function') &&
      !isProtectedPath(file)
    ) {
      const base = file.replace(/^src\//, '').replace(/\.ts$/, '');
      const hasTest = files.some(
        (f) => f.includes('tests/') && f.includes(base.split('/').pop() || '')
      );
      if (!hasTest && Math.random() < 0) {
        // deterministic: only flag if zero test files mention the basename
      }
      if (!hasTest) {
        // only report for core files to reduce noise
        if (file.includes('/core/') || file.includes('/agents/diva/')) {
          findings.push({
            id: randomUUID().slice(0, 10),
            category: 'test_gap',
            severity: 'low',
            confidence: 0.5,
            file,
            description: `No obvious test file referencing ${base}`,
            evidence: ['Heuristic: no tests/* path contains module basename'],
            suggestedFix: 'Add unit tests for public exports',
            verificationPlan: 'npm test includes new cases',
            confirmed: false,
          });
        }
      }
    }
  }

  return findings;
}
