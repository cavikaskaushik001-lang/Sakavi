/**
 * Structured project-scoped memory stores.
 * External content never auto-trusted.
 */

import { randomUUID } from 'node:crypto';

export type MemoryStoreName =
  | 'task'
  | 'project'
  | 'technical'
  | 'debugging'
  | 'security';

export interface MemoryRecord {
  id: string;
  store: MemoryStoreName;
  content: string;
  source: string;
  confidence: number;
  scope: string;
  sensitivity: 'public' | 'internal' | 'sensitive';
  trusted: boolean;
  createdAt: string;
  updatedAt: string;
}

const stores: Record<MemoryStoreName, MemoryRecord[]> = {
  task: [],
  project: [],
  technical: [],
  debugging: [],
  security: [],
};

function isTrustedSource(source: string, requestedTrusted: boolean): boolean {
  if (!requestedTrusted) return false;
  if (/^(repo|web|readme|issue|commit|upload|api|untrusted):/i.test(source)) return false;
  return true;
}

export function memoryWrite(
  store: MemoryStoreName,
  item: {
    content: string;
    source: string;
    confidence: number;
    scope: string;
    sensitivity?: MemoryRecord['sensitivity'];
    trusted?: boolean;
  }
): MemoryRecord {
  if (item.content.length > 8000) throw new Error('Memory content too large');
  const now = new Date().toISOString();
  const rec: MemoryRecord = {
    id: randomUUID(),
    store,
    content: item.content,
    source: item.source,
    confidence: Math.max(0, Math.min(1, item.confidence)),
    scope: item.scope,
    sensitivity: item.sensitivity || 'internal',
    trusted: isTrustedSource(item.source, item.trusted === true),
    createdAt: now,
    updatedAt: now,
  };
  const list = stores[store];
  list.push(rec);
  if (list.length > 300) list.shift();
  return rec;
}

export function memoryQuery(
  store: MemoryStoreName,
  opts: { scope?: string; trustedOnly?: boolean; limit?: number } = {}
): MemoryRecord[] {
  let out = [...stores[store]];
  if (opts.scope) out = out.filter((r) => r.scope === opts.scope);
  if (opts.trustedOnly) out = out.filter((r) => r.trusted);
  return out.slice(-(opts.limit ?? 20));
}

export function memorySummary(store: MemoryStoreName, scope?: string): string {
  return memoryQuery(store, { scope, limit: 10 })
    .map((r) => `[${r.trusted ? 'T' : 'U'}] ${r.content.slice(0, 120)}`)
    .join('\n');
}
