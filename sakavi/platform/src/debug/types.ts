/**
 * Debugging mode types — evidence over speculation.
 */

export interface DebugScope {
  projectPath: string;
  /** Optional failing command, e.g. npm test */
  failingCommand?: string;
  branchPrefix?: string;
}

export interface DebugHypothesis {
  id: string;
  statement: string;
  status: 'open' | 'supported' | 'rejected';
  evidence: string[];
}

export interface DebugReport {
  taskId: string;
  status: 'completed' | 'failed' | 'awaiting_approval';
  symptom: string;
  reproduction: string;
  executionPath: string[];
  rootCause: string;
  contributingFactors: string[];
  fixSummary: string;
  regressionTest: string;
  verification: string;
  observedFacts: string[];
  hypotheses: DebugHypothesis[];
  conclusions: string[];
  beforeAfter?: { before: string; after: string };
}

export interface DebugInput {
  userId: string;
  objective: string;
  scope: DebugScope;
  /** Optional logs / stack traces supplied by caller */
  logs?: string[];
  stackTrace?: string;
}
