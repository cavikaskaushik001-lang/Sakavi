/**
 * Evidence engine — never present hypothesis as confirmed fact.
 */

import { randomUUID } from 'node:crypto';
import type { Claim, ClaimKind, EvidenceItem, EvidenceType } from './types.js';

const store = new Map<string, EvidenceItem>();

export function addEvidence(partial: {
  source: string;
  type: EvidenceType;
  confidence: number;
  summary: string;
  dataRef?: string;
}): EvidenceItem {
  const item: EvidenceItem = {
    id: randomUUID().slice(0, 12),
    source: partial.source,
    type: partial.type,
    confidence: Math.max(0, Math.min(1, partial.confidence)),
    timestamp: new Date().toISOString(),
    summary: partial.summary.slice(0, 1000),
    dataRef: partial.dataRef,
  };
  store.set(item.id, item);
  return item;
}

export function getEvidence(id: string): EvidenceItem | undefined {
  return store.get(id);
}

export function claim(kind: ClaimKind, text: string, evidenceIds: string[] = []): Claim {
  if (kind === 'FACT' || kind === 'VERIFIED') {
    if (!evidenceIds.length) {
      return { kind: 'HYPOTHESIS', text: `[downgraded from ${kind}] ${text}`, evidenceIds: [] };
    }
  }
  return { kind, text, evidenceIds };
}

export function formatClaims(claims: Claim[]): string {
  return claims.map((c) => `[${c.kind}] ${c.text}`).join('\n');
}

export type { EvidenceItem, Claim, ClaimKind, EvidenceType };
