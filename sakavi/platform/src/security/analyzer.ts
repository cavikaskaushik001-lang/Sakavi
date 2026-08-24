/**
 * Architecture / auth-flow oriented analysis — facts vs hypotheses.
 */

import type { SecurityFinding } from './types.js';
import { randomUUID } from 'node:crypto';

export interface ArchitectureNotes {
  facts: string[];
  hypotheses: string[];
  authHints: string[];
  apiHints: string[];
}

export function analyzeArchitecture(files: { path: string; content: string }[]): ArchitectureNotes {
  const facts: string[] = [];
  const hypotheses: string[] = [];
  const authHints: string[] = [];
  const apiHints: string[] = [];

  for (const f of files) {
    const p = f.path.toLowerCase();
    const c = f.content;
    if (/route|router|controller|api/.test(p) || /\.(get|post|put|delete)\s*\(/.test(c)) {
      apiHints.push(f.path);
      facts.push(`Routing/API-related file: ${f.path}`);
    }
    if (/auth|session|jwt|oauth|passport/.test(p) || /jsonwebtoken|passport|session\(/.test(c)) {
      authHints.push(f.path);
      facts.push(`Auth-related file: ${f.path}`);
    }
    if (/cors\(|Access-Control-Allow-Origin:\s*\*/.test(c)) {
      hypotheses.push(`Permissive CORS may be present in ${f.path}`);
    }
    if (/helmet\(|csrf|rateLimit|rate-limit/.test(c)) {
      facts.push(`Security middleware reference in ${f.path}`);
    }
  }

  if (apiHints.length && !authHints.length) {
    hypotheses.push('API surface present without obvious co-located auth modules (may live elsewhere)');
  }

  return { facts, hypotheses, authHints, apiHints };
}

export function findingsFromArchitecture(notes: ArchitectureNotes): SecurityFinding[] {
  const now = new Date().toISOString();
  const out: SecurityFinding[] = [];
  for (const h of notes.hypotheses) {
    out.push({
      id: randomUUID().slice(0, 10),
      title: 'Architectural hypothesis',
      severity: 'INFO',
      confidence: 'LOW',
      affectedComponent: 'architecture',
      affectedPath: notes.apiHints[0] || 'n/a',
      evidence: notes.facts.slice(0, 5),
      reproductionSummary: 'Not a confirmed vulnerability — hypothesis only',
      rootCause: 'Pending verification',
      impact: 'Unknown until verified',
      remediation: 'Review authz on all exposed routes',
      regressionTest: 'Add integration tests for unauthorized access denials',
      verificationStatus: 'unverified',
      observedFacts: notes.facts.slice(0, 10),
      hypotheses: [h],
      createdAt: now,
    });
  }
  return out;
}
