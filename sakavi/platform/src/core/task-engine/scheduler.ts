/**
 * Dependency-aware scheduling with concurrency limits and mutation isolation.
 */

export interface Schedulable {
  id: string;
  dependencies: string[];
  status: 'pending' | 'ready' | 'running' | 'done' | 'failed' | 'skipped';
  mutates?: boolean;
}

export function markReady(steps: Schedulable[]): void {
  const done = new Set(steps.filter((s) => s.status === 'done').map((s) => s.id));
  for (const s of steps) {
    if (['done', 'failed', 'skipped', 'running'].includes(s.status)) continue;
    s.status = s.dependencies.every((d) => done.has(d)) ? 'ready' : 'pending';
  }
}

export function selectBatch(steps: Schedulable[], maxParallel: number): Schedulable[] {
  markReady(steps);
  const ready = steps.filter((s) => s.status === 'ready');
  const out: Schedulable[] = [];
  let mutationTaken = false;
  for (const s of ready) {
    if (out.length >= maxParallel) break;
    if (s.mutates) {
      if (mutationTaken) continue;
      mutationTaken = true;
    }
    out.push(s);
  }
  return out;
}
