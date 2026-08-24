/**
 * Security research types — authorization-first.
 * No finding is "confirmed" without evidence + safe reproduction in scope.
 */

export type FindingSeverity = 'INFO' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type FindingConfidence = 'LOW' | 'MEDIUM' | 'HIGH' | 'CONFIRMED';
export type VerificationStatus =
  | 'unverified'
  | 'reproduced'
  | 'not_reproducible'
  | 'mitigated'
  | 'false_positive'
  | 'out_of_scope';

/** Explicit authorization — never inferred from reachability */
export interface SecurityScope {
  target: string;
  owner: string;
  authorizationId: string;
  allowedHosts: string[];
  allowedPorts?: number[];
  allowedPaths?: string[];
  startTime?: string;
  endTime?: string;
  permittedActions: string[];
  /** Optional: production-like systems require extra confirmation */
  environment: 'lab' | 'staging' | 'production-readonly' | 'production';
}

export interface SecurityFinding {
  id: string;
  title: string;
  severity: FindingSeverity;
  confidence: FindingConfidence;
  affectedComponent: string;
  affectedPath: string;
  evidence: string[];
  reproductionSummary: string;
  rootCause: string;
  impact: string;
  remediation: string;
  regressionTest: string;
  verificationStatus: VerificationStatus;
  /** Observed fact vs hypothesis separation */
  observedFacts: string[];
  hypotheses: string[];
  createdAt: string;
}

export interface RootCauseReport {
  symptom: string;
  reproduction: string;
  executionPath: string[];
  rootCause: string;
  contributingFactors: string[];
  fix: string;
  regressionTest: string;
  verification: string;
  observedFacts: string[];
  hypotheses: string[];
  conclusions: string[];
}

export interface SecurityTaskInput {
  userId: string;
  objective: string;
  scope: SecurityScope;
  projectPath?: string;
  /** Passive-only unless true and action in permittedActions */
  allowDynamic?: boolean;
}

export interface SecurityTaskResult {
  taskId: string;
  status: 'completed' | 'stopped' | 'failed' | 'awaiting_approval';
  summary: string;
  findings: SecurityFinding[];
  stopReason?: string;
  reportMarkdown: string;
}

export const PASSIVE_ACTIONS = [
  'recon.repo',
  'recon.config',
  'analyze.code',
  'analyze.deps',
  'analyze.secrets',
  'analyze.auth_flow',
] as const;

export const DYNAMIC_ACTIONS = [
  'test.authorized_http',
  'test.sandbox_payload',
] as const;

export function isScopeActive(scope: SecurityScope, now = Date.now()): boolean {
  if (scope.startTime && new Date(scope.startTime).getTime() > now) return false;
  if (scope.endTime && new Date(scope.endTime).getTime() < now) return false;
  return Boolean(scope.authorizationId && scope.owner && scope.target);
}

export function actionPermitted(scope: SecurityScope, action: string): boolean {
  return scope.permittedActions.includes(action) || scope.permittedActions.includes('*');
}
