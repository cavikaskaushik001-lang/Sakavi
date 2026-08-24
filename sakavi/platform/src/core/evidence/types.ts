export type EvidenceType = 'fact' | 'observation' | 'test' | 'log' | 'tool_result';

export interface EvidenceItem {
  id: string;
  source: string;
  type: EvidenceType;
  confidence: number;
  timestamp: string;
  summary: string;
  /** Never store secrets */
  dataRef?: string;
}

export type ClaimKind = 'FACT' | 'ASSUMPTION' | 'HYPOTHESIS' | 'EVIDENCE' | 'VERIFIED' | 'UNKNOWN';

export interface Claim {
  kind: ClaimKind;
  text: string;
  evidenceIds: string[];
}
