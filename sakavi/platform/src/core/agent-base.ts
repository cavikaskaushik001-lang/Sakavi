/**
 * Shared agent runtime helpers — timeouts, retries, circuit breaker, task state.
 */

import { randomUUID } from 'node:crypto';
import type {
  AgentId,
  AgentManifest,
  Capability,
  TaskState,
  TaskStep,
  ToolInvocation,
  ToolResult,
} from './types.js';
import { toolGateway } from './tool-gateway.js';
import { killSwitch } from './kill-switch.js';
import { CircuitOpenError, PlatformError } from './errors.js';
import { emitAudit } from './audit.js';

interface CircuitState {
  failures: number;
  openUntil: number;
}

const circuits = new Map<AgentId, CircuitState>();
const taskStore = new Map<string, TaskState>();
const taskToolCounts = new Map<string, number>();
const taskNetwork = new Map<string, boolean>();

const CIRCUIT_THRESHOLD = 5;
const CIRCUIT_COOLDOWN_MS = 60_000;

export function getTask(taskId: string): TaskState | undefined {
  return taskStore.get(taskId);
}

export function listTasks(userId?: string): TaskState[] {
  const all = [...taskStore.values()];
  return userId ? all.filter((t) => t.userId === userId) : all;
}

export function getTaskToolCount(taskId: string): number {
  return taskToolCounts.get(taskId) ?? 0;
}

export function incrementTaskToolCount(taskId: string): void {
  taskToolCounts.set(taskId, getTaskToolCount(taskId) + 1);
}

export function isNetworkEnabled(taskId: string): boolean {
  return taskNetwork.get(taskId) === true;
}

export function setNetworkEnabled(taskId: string, enabled: boolean): void {
  // Only policy/operator path should call this — not agents directly via model
  taskNetwork.set(taskId, enabled);
}

export function createTask(params: {
  userId: string;
  objective: string;
  agentId: AgentId;
  manifest: AgentManifest;
}): TaskState {
  const taskId = randomUUID();
  const now = new Date().toISOString();
  const deadline = new Date(Date.now() + params.manifest.maxTaskDurationMs).toISOString();
  const task: TaskState = {
    taskId,
    userId: params.userId,
    objective: params.objective,
    status: 'pending',
    createdAt: now,
    updatedAt: now,
    agentId: params.agentId,
    steps: [],
    toolCallCount: 0,
    maxToolCalls: params.manifest.maxToolCalls,
    deadline,
  };
  taskStore.set(taskId, task);
  taskToolCounts.set(taskId, 0);
  taskNetwork.set(taskId, false);
  killSwitch.registerTask(taskId);
  return task;
}

export function updateTask(taskId: string, patch: Partial<TaskState>): TaskState {
  const t = taskStore.get(taskId);
  if (!t) throw new PlatformError('TASK_NOT_FOUND', `Task ${taskId} not found`, 404);
  Object.assign(t, patch, { updatedAt: new Date().toISOString() });
  return t;
}

export function addStep(taskId: string, step: Omit<TaskStep, 'id'>): TaskStep {
  const t = taskStore.get(taskId);
  if (!t) throw new PlatformError('TASK_NOT_FOUND', `Task ${taskId} not found`, 404);
  const full: TaskStep = { ...step, id: randomUUID() };
  t.steps.push(full);
  t.updatedAt = new Date().toISOString();
  return full;
}

export function cancelTask(taskId: string, reason: string): void {
  const t = taskStore.get(taskId);
  if (!t) return;
  t.status = 'cancelled';
  t.error = reason;
  t.updatedAt = new Date().toISOString();
  killSwitch.unregisterTask(taskId);
}

function checkCircuit(agentId: AgentId): void {
  const c = circuits.get(agentId);
  if (c && c.openUntil > Date.now()) {
    throw new CircuitOpenError(agentId);
  }
}

function recordSuccess(agentId: AgentId): void {
  circuits.set(agentId, { failures: 0, openUntil: 0 });
}

function recordFailure(agentId: AgentId): void {
  const c = circuits.get(agentId) ?? { failures: 0, openUntil: 0 };
  c.failures += 1;
  if (c.failures >= CIRCUIT_THRESHOLD) {
    c.openUntil = Date.now() + CIRCUIT_COOLDOWN_MS;
    emitAudit({
      agentId,
      taskId: 'circuit',
      userId: 'system',
      tool: 'circuit.open',
      capability: null,
      resultStatus: 'error',
      riskLevel: 'HIGH',
      meta: { failures: c.failures },
    });
  }
  circuits.set(agentId, c);
}

/**
 * Invoke a tool through the gateway with retry + backoff.
 */
export async function callTool(
  inv: ToolInvocation,
  opts: { maxRetries?: number; backoffMs?: number } = {}
): Promise<ToolResult> {
  checkCircuit(inv.agentId);
  killSwitch.assertNotActive();

  const maxRetries = opts.maxRetries ?? 2;
  const backoffMs = opts.backoffMs ?? 500;
  let last: ToolResult | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (killSwitch.isActive()) {
      return {
        ok: false,
        error: { code: 'KILL_SWITCH_ACTIVE', message: 'Emergency stop' },
        durationMs: 0,
        auditId: '',
        blocked: true,
      };
    }
    last = await toolGateway.invoke(inv);
    if (last.ok) {
      recordSuccess(inv.agentId);
      return last;
    }
    // Do not retry policy/capability denials or approval required
    if (last.blocked || last.error?.code === 'APPROVAL_REQUIRED') {
      return last;
    }
    if (attempt < maxRetries) {
      await sleep(backoffMs * Math.pow(2, attempt));
    }
  }
  recordFailure(inv.agentId);
  return last!;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function assertNotExpired(task: TaskState): void {
  if (new Date(task.deadline).getTime() < Date.now()) {
    task.status = 'failed';
    task.error = 'task deadline exceeded';
    throw new PlatformError('TASK_DEADLINE', 'Task deadline exceeded', 408);
  }
  if (task.status === 'cancelled') {
    throw new PlatformError('TASK_CANCELLED', 'Task was cancelled', 409);
  }
}
