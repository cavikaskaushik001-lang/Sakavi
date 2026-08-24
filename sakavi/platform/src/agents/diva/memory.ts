/**
 * Working memory (per-task) + controlled long-term memory.
 * External/repo content is never auto-promoted to trusted memory.
 */

import { randomUUID } from 'node:crypto';
import type { MemoryItem, WorkingMemory, Decision, Observation } from './types.js';

const longTerm: MemoryItem[] = [];

export function createWorkingMemory(objective: string, constraints: string[] = []): WorkingMemory {
  return {
    objective,
    constraints: [...constraints],
    decisions: [],
    toolResultSummaries: [],
    importantObservations: [],
    failedApproaches: [],
    successfulApproaches: [],
    currentPlanIds: [],
    notes: [],
  };
}

export function recordDecision(wm: WorkingMemory, d: Decision): void {
  wm.decisions.push(d);
  // Keep bounded
  if (wm.decisions.length > 40) wm.decisions.shift();
}

export function recordObservation(wm: WorkingMemory, obs: Observation): void {
  const line = `${obs.source}: ${obs.summary}`.slice(0, 300);
  if (obs.untrusted) {
    wm.notes.push(`[UNTRUSTED] ${line}`);
  } else {
    wm.importantObservations.push(line);
  }
  if (wm.importantObservations.length > 50) wm.importantObservations.shift();
  if (wm.notes.length > 30) wm.notes.shift();
}

export function recordToolSummary(wm: WorkingMemory, summary: string): void {
  wm.toolResultSummaries.push(summary.slice(0, 400));
  if (wm.toolResultSummaries.length > 40) wm.toolResultSummaries.shift();
}

export function recordFailure(wm: WorkingMemory, approach: string): void {
  wm.failedApproaches.push(approach.slice(0, 200));
  if (wm.failedApproaches.length > 20) wm.failedApproaches.shift();
}

export function recordSuccess(wm: WorkingMemory, approach: string): void {
  wm.successfulApproaches.push(approach.slice(0, 200));
  if (wm.successfulApproaches.length > 20) wm.successfulApproaches.shift();
}

/** Compact context for any future model call — not full history */
export function summarizeWorkingMemory(wm: WorkingMemory): string {
  const parts = [
    `Objective: ${wm.objective}`,
    wm.constraints.length ? `Constraints: ${wm.constraints.join('; ')}` : '',
    wm.successfulApproaches.length
      ? `Worked: ${wm.successfulApproaches.slice(-5).join(' | ')}`
      : '',
    wm.failedApproaches.length ? `Failed: ${wm.failedApproaches.slice(-5).join(' | ')}` : '',
    wm.importantObservations.length
      ? `Obs: ${wm.importantObservations.slice(-8).join(' | ')}`
      : '',
    wm.notes.filter((n) => n.startsWith('[UNTRUSTED]')).length
      ? 'Note: some observations are UNTRUSTED external data'
      : '',
  ];
  return parts.filter(Boolean).join('\n').slice(0, 4000);
}

/**
 * Long-term memory write — validated, never auto-trusted from repo/web.
 */
export function writeLongTerm(item: {
  kind: MemoryItem['kind'];
  content: string;
  source: string;
  confidence: number;
  scope: string;
  sensitivity: MemoryItem['sensitivity'];
  trusted: boolean;
}): MemoryItem {
  if (item.content.length > 4000) {
    throw new Error('Memory content too large');
  }
  // Repo/web sources cannot be marked trusted
  const trusted =
    item.trusted &&
    !/^(repo|web|readme|issue|commit|upload|api):/i.test(item.source);

  const now = new Date().toISOString();
  const mem: MemoryItem = {
    id: randomUUID(),
    kind: item.kind,
    content: item.content,
    source: item.source,
    confidence: Math.max(0, Math.min(1, item.confidence)),
    createdAt: now,
    updatedAt: now,
    scope: item.scope,
    sensitivity: item.sensitivity,
    trusted,
  };
  longTerm.push(mem);
  if (longTerm.length > 500) longTerm.shift();
  return mem;
}

export function queryLongTerm(filter: {
  kind?: MemoryItem['kind'];
  scope?: string;
  trustedOnly?: boolean;
  limit?: number;
}): MemoryItem[] {
  let out = [...longTerm];
  if (filter.kind) out = out.filter((m) => m.kind === filter.kind);
  if (filter.scope) out = out.filter((m) => m.scope === filter.scope);
  if (filter.trustedOnly) out = out.filter((m) => m.trusted);
  return out.slice(-(filter.limit ?? 20));
}
