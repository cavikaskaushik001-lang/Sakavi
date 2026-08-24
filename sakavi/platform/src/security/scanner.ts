/**
 * Static pattern scanner — correlates with paths; does not claim confirmed vulns alone.
 * Output = candidate findings with LOW/MEDIUM confidence until verifier runs.
 */

import { randomUUID } from 'node:crypto';
import type { SecurityFinding, FindingSeverity, FindingConfidence } from './types.js';

interface PatternRule {
  id: string;
  title: string;
  severity: FindingSeverity;
  re: RegExp;
  category: string;
  remediation: string;
}

const RULES: PatternRule[] = [
  {
    id: 'secret-aws',
    title: 'Possible AWS access key material',
    severity: 'HIGH',
    re: /AKIA[0-9A-Z]{16}/g,
    category: 'secrets',
    remediation: 'Rotate key; remove from source; use secret manager',
  },
  {
    id: 'secret-ghp',
    title: 'Possible GitHub token in source',
    severity: 'CRITICAL',
    re: /ghp_[A-Za-z0-9]{20,}/g,
    category: 'secrets',
    remediation: 'Revoke token; purge history if committed; use CI secrets',
  },
  {
    id: 'secret-sk',
    title: 'Possible OpenAI/API secret key',
    severity: 'HIGH',
    re: /sk-[A-Za-z0-9]{20,}/g,
    category: 'secrets',
    remediation: 'Rotate and remove from repository',
  },
  {
    id: 'sql-concat',
    title: 'Possible SQL string concatenation',
    severity: 'HIGH',
    re: /(query|sql|execute)\s*\(\s*[`'"].*\$\{|(query|sql)\s*\(\s*[^)]*\+/gi,
    category: 'injection',
    remediation: 'Use parameterized queries / prepared statements',
  },
  {
    id: 'cmd-exec',
    title: 'Dynamic command execution',
    severity: 'HIGH',
    re: /\b(exec|execSync|spawn|child_process)\s*\(|\bos\.system\s*\(|\bsubprocess\.(call|run|Popen)\s*\(/g,
    category: 'command_execution',
    remediation: 'Avoid shell; allowlist args; never pass raw user input',
  },
  {
    id: 'path-traversal',
    title: 'Path join with possible user input',
    severity: 'MEDIUM',
    re: /path\.(join|resolve)\s*\([^)]*req\.|readFile\s*\([^)]*req\./g,
    category: 'path_traversal',
    remediation: 'Canonicalize and enforce root directory boundary',
  },
  {
    id: 'ssrf-fetch',
    title: 'HTTP fetch to variable URL',
    severity: 'MEDIUM',
    re: /\b(fetch|axios|request|got)\s*\(\s*[a-zA-Z_][\w.]*\s*[,)]/g,
    category: 'ssrf',
    remediation: 'Allowlist destinations; block link-local and private ranges',
  },
  {
    id: 'weak-crypto-md5',
    title: 'Weak hash algorithm (MD5/SHA1) usage',
    severity: 'MEDIUM',
    re: /\b(md5|sha1)\s*\(|createHash\(\s*['"]md5['"]|createHash\(\s*['"]sha1['"]/gi,
    category: 'crypto',
    remediation: 'Use SHA-256+ or password KDF (bcrypt/scrypt/argon2) as appropriate',
  },
  {
    id: 'auth-disabled',
    title: 'Possible authentication bypass flag',
    severity: 'HIGH',
    re: /auth\s*=\s*false|disableAuth|skipAuth|noauth\s*=\s*true/gi,
    category: 'authentication',
    remediation: 'Ensure production builds cannot skip authentication',
  },
  {
    id: 'eval-use',
    title: 'Use of eval / Function constructor',
    severity: 'HIGH',
    re: /\beval\s*\(|new\s+Function\s*\(/g,
    category: 'injection',
    remediation: 'Remove eval; use safe parsers',
  },
  {
    id: 'deserialize-yaml',
    title: 'Unsafe YAML/JSON load pattern',
    severity: 'MEDIUM',
    re: /yaml\.(load|unsafeLoad)\s*\(|pickle\.loads\s*\(/g,
    category: 'deserialization',
    remediation: 'Use safe loaders; never deserialize untrusted data with powerful loaders',
  },
];

export interface ScanFileInput {
  path: string;
  content: string;
}

export function scanFiles(files: ScanFileInput[]): SecurityFinding[] {
  const findings: SecurityFinding[] = [];
  const now = new Date().toISOString();

  for (const file of files) {
    // Skip obvious binaries
    if (/[\x00-\x08]/.test(file.content.slice(0, 200))) continue;

    for (const rule of RULES) {
      rule.re.lastIndex = 0;
      if (!rule.re.test(file.content)) continue;
      rule.re.lastIndex = 0;
      const matches = file.content.match(rule.re) || [];
      const confidence: FindingConfidence =
        rule.category === 'secrets' && matches.length ? 'HIGH' : 'MEDIUM';

      findings.push({
        id: randomUUID().slice(0, 10),
        title: rule.title,
        severity: rule.severity,
        confidence,
        affectedComponent: rule.category,
        affectedPath: file.path,
        evidence: [
          `Pattern ${rule.id} matched ${matches.length} time(s) in ${file.path}`,
          // Never echo full secrets
          rule.category === 'secrets'
            ? 'Secret-like material redacted — rotate if real'
            : `Sample context length ${file.content.length} bytes`,
        ],
        reproductionSummary: 'Static match only — not yet dynamically verified',
        rootCause: 'See code path analysis; static pattern is a hypothesis until verified',
        impact: severityImpact(rule.severity),
        remediation: rule.remediation,
        regressionTest: `Add lint/semgrep rule for ${rule.id}; test that sample pattern fails CI`,
        verificationStatus: 'unverified',
        observedFacts: [`Static pattern ${rule.id} matched in ${file.path}`],
        hypotheses: [`May indicate ${rule.category} weakness if reachable with attacker control`],
        createdAt: now,
      });
    }
  }

  return findings;
}

function severityImpact(s: FindingSeverity): string {
  switch (s) {
    case 'CRITICAL':
      return 'Potential full compromise if confirmed and reachable';
    case 'HIGH':
      return 'Significant confidentiality/integrity impact if confirmed';
    case 'MEDIUM':
      return 'Limited or conditional impact; verify reachability';
    case 'LOW':
      return 'Minor hardening issue';
    default:
      return 'Informational';
  }
}
