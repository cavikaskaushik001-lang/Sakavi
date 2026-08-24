export type SelfFindingCategory =
  | 'bug'
  | 'security'
  | 'performance'
  | 'reliability'
  | 'maintainability'
  | 'architecture'
  | 'test_gap';

export interface SelfFinding {
  id: string;
  category: SelfFindingCategory;
  severity: 'low' | 'medium' | 'high' | 'critical';
  confidence: number;
  file: string;
  line?: number;
  description: string;
  evidence: string[];
  suggestedFix?: string;
  verificationPlan?: string;
  /** hypothesis until tests/static evidence confirm */
  confirmed: boolean;
}

export interface ModuleMapEntry {
  name: string;
  path: string;
  responsibility: string;
  dependencies: string[];
  publicInterfaces: string[];
  consumers: string[];
  tests: string[];
  risk: 'low' | 'medium' | 'high' | 'critical';
}

export interface SelfDevVersion {
  version: string;
  commit?: string;
  parentVersion?: string;
  createdAt: string;
  testReport?: string;
  securityReport?: string;
  reviewResult?: string;
  status: 'candidate' | 'canary' | 'active' | 'rolled_back' | 'rejected';
}

export interface SelfRepairReport {
  issueId: string;
  rootCause: string;
  evidence: string[];
  affectedComponent: string;
  minimalFix: string;
  regressionTest: string;
  verificationPlan: string;
  branchName: string;
  protectedBlocked: string[];
  verified: boolean;
  finalStatus: 'PREPARED_PR' | 'NEEDS_EXTERNAL_REVIEW' | 'BLOCKED' | 'FAILED';
}
