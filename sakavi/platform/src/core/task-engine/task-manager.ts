/**
 * Long-horizon task manager with optional filesystem durability.
 */

import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createEmptyTask, type DivaTaskV3, type TaskStatus, type FinalStatus } from './task-state.js';
import { makeCheckpoint, applyCheckpoint, latestCheckpoint } from './checkpoint.js';

const memory = new Map<string, DivaTaskV3>();

function persistDir(): string {
  return process.env.DIVA_TASK_DIR || join(process.cwd(), 'data', 'tasks');
}

function ensureDir(): void {
  try {
    mkdirSync(persistDir(), { recursive: true });
  } catch {
    /* ignore */
  }
}

function persist(task: DivaTaskV3): void {
  memory.set(task.id, task);
  try {
    ensureDir();
    writeFileSync(join(persistDir(), `${task.id}.json`), JSON.stringify(task, null, 2), 'utf8');
  } catch {
    /* memory-only fallback */
  }
}

function loadFromDisk(id: string): DivaTaskV3 | undefined {
  try {
    const p = join(persistDir(), `${id}.json`);
    if (!existsSync(p)) return undefined;
    return JSON.parse(readFileSync(p, 'utf8')) as DivaTaskV3;
  } catch {
    return undefined;
  }
}

export function createTask(params: {
  userId: string;
  objective: string;
  projectPath?: string;
  maxDurationMs?: number;
}): DivaTaskV3 {
  const task = createEmptyTask({
    id: randomUUID(),
    userId: params.userId,
    objective: params.objective,
    projectPath: params.projectPath,
    maxDurationMs: params.maxDurationMs,
  });
  persist(task);
  return task;
}

export function getTask(id: string): DivaTaskV3 | undefined {
  return memory.get(id) || loadFromDisk(id);
}

export function saveTask(task: DivaTaskV3): DivaTaskV3 {
  task.updatedAt = new Date().toISOString();
  persist(task);
  return task;
}

export function setStatus(id: string, status: TaskStatus, extra?: Partial<DivaTaskV3>): DivaTaskV3 {
  const t = getTask(id);
  if (!t) throw new Error(`Task not found: ${id}`);
  t.status = status;
  Object.assign(t, extra || {});
  return saveTask(t);
}

export function checkpoint(id: string, label: string, stepId?: string): DivaTaskV3 {
  const t = getTask(id);
  if (!t) throw new Error(`Task not found: ${id}`);
  t.checkpoints.push(makeCheckpoint(t, label, stepId));
  if (t.checkpoints.length > 40) t.checkpoints.shift();
  return saveTask(t);
}

export function resume(id: string): DivaTaskV3 {
  const t = getTask(id);
  if (!t) throw new Error(`Task not found: ${id}`);
  if (t.status === 'cancelled') throw new Error('Cannot resume cancelled task');
  const cp = latestCheckpoint(t);
  if (cp) applyCheckpoint(t, cp);
  if (t.status === 'paused' || t.status === 'failed') {
    t.status = 'executing';
  }
  t.lastError = undefined;
  return saveTask(t);
}

export function pause(id: string): DivaTaskV3 {
  const t = getTask(id);
  if (!t) throw new Error(`Task not found: ${id}`);
  checkpoint(id, 'pause');
  t.status = 'paused';
  return saveTask(t);
}

export function cancel(id: string, reason?: string): DivaTaskV3 {
  const t = getTask(id);
  if (!t) throw new Error(`Task not found: ${id}`);
  t.status = 'cancelled';
  t.finalStatus = 'FAILED';
  t.lastError = reason || 'cancelled';
  return saveTask(t);
}

export function complete(id: string, finalStatus: FinalStatus, summary: string): DivaTaskV3 {
  const t = getTask(id);
  if (!t) throw new Error(`Task not found: ${id}`);
  t.status = finalStatus === 'VERIFIED_SUCCESS' || finalStatus === 'PARTIALLY_COMPLETE' ? 'completed' : 'failed';
  t.finalStatus = finalStatus;
  t.resultSummary = summary;
  checkpoint(id, 'complete');
  return saveTask(t);
}

export function recordFailedApproach(
  id: string,
  approach: {
    strategy: string;
    assumption: string;
    action: string;
    result: string;
    failureReason: string;
    lesson: string;
  }
): DivaTaskV3 {
  const t = getTask(id);
  if (!t) throw new Error(`Task not found: ${id}`);
  t.failedApproaches.push({ ...approach, at: new Date().toISOString() });
  if (t.failedApproaches.length > 30) t.failedApproaches.shift();
  return saveTask(t);
}

export function wasStrategyTried(id: string, strategy: string): boolean {
  const t = getTask(id);
  if (!t) return false;
  return t.failedApproaches.some((f) => f.strategy === strategy);
}

export function listPersistedTaskIds(): string[] {
  const ids = new Set<string>(memory.keys());
  try {
    ensureDir();
    for (const f of readdirSync(persistDir())) {
      if (f.endsWith('.json')) ids.add(f.replace(/\.json$/, ''));
    }
  } catch {
    /* ignore */
  }
  return [...ids];
}
