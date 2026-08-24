/**
 * Cancellation propagation registry for long-horizon tasks.
 */

const cancelled = new Set<string>();
const abortByTask = new Map<string, AbortController>();

export function requestCancel(taskId: string): void {
  cancelled.add(taskId);
  const c = abortByTask.get(taskId);
  if (c) {
    try {
      c.abort(new Error('task cancelled'));
    } catch {
      /* ignore */
    }
  }
}

export function clearCancel(taskId: string): void {
  cancelled.delete(taskId);
  abortByTask.delete(taskId);
}

export function isCancelled(taskId: string): boolean {
  return cancelled.has(taskId);
}

export function signalFor(taskId: string): AbortSignal {
  let c = abortByTask.get(taskId);
  if (!c) {
    c = new AbortController();
    abortByTask.set(taskId, c);
  }
  if (cancelled.has(taskId)) {
    try {
      c.abort(new Error('task cancelled'));
    } catch {
      /* ignore */
    }
  }
  return c.signal;
}
