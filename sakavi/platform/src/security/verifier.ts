/**
 * Vulnerability verification — safe, minimal, in-scope only.
 * Prefer non-destructive PoC. Never maximize impact.
 */

import type { SecurityFinding, SecurityScope, FindingConfidence, VerificationStatus } from './types.js';
import { assertAction, assertScope } from './scope.js';

export interface VerifyContext {
  scope: SecurityScope;
  allowDynamic: boolean;
}

/**
 * Reduce false positives: reachability, config presence, mitigations.
 */
export function refineFinding(f: SecurityFinding, ctx: VerifyContext): SecurityFinding {
  assertScope(ctx.scope);

  let confidence: FindingConfidence = f.confidence;
  const verificationStatus: VerificationStatus = f.verificationStatus;
  const observedFacts = [...f.observedFacts];
  const hypotheses = [...f.hypotheses];

  if (f.affectedComponent === 'secrets' && f.confidence === 'HIGH') {
    observedFacts.push('High-entropy credential-like pattern in repository text');
    confidence = 'HIGH';
    hypotheses.push('Token may be revoked or example placeholder — do not validate live');
  }

  if (f.verificationStatus === 'unverified' && f.affectedComponent !== 'secrets') {
    observedFacts.push('No dynamic reproduction performed yet');
  }

  if (!ctx.allowDynamic) {
    observedFacts.push('Dynamic verification disabled for this run (passive only)');
  }

  if (ctx.scope.environment === 'production' || ctx.scope.environment === 'production-readonly') {
    if (confidence === 'CONFIRMED') confidence = 'HIGH';
    observedFacts.push('Production scope: confirmation limited to non-destructive evidence');
  }

  return {
    ...f,
    confidence,
    verificationStatus,
    observedFacts,
    hypotheses,
  };
}

export async function safeDynamicVerify(
  f: SecurityFinding,
  ctx: VerifyContext
): Promise<SecurityFinding> {
  assertScope(ctx.scope);
  if (!ctx.allowDynamic) {
    return refineFinding(f, ctx);
  }
  try {
    assertAction(ctx.scope, 'test.sandbox_payload');
  } catch {
    return {
      ...refineFinding(f, ctx),
      observedFacts: [
        ...f.observedFacts,
        'Dynamic test action not permitted — left unverified',
      ],
    };
  }

  return {
    ...f,
    confidence: f.confidence === 'LOW' ? 'MEDIUM' : f.confidence,
    verificationStatus: 'unverified',
    reproductionSummary:
      f.reproductionSummary +
      ' | Dynamic path authorized but requires instrumented lab harness (no destructive payloads).',
    observedFacts: [...f.observedFacts, 'Dynamic verification slot reserved under scope'],
  };
}

export function markFalsePositive(f: SecurityFinding, reason: string): SecurityFinding {
  return {
    ...f,
    verificationStatus: 'false_positive',
    confidence: 'LOW',
    observedFacts: [...f.observedFacts, `False positive rationale: ${reason}`],
    hypotheses: [...f.hypotheses, reason],
  };
}
