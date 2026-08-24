/**
 * Immutable structured audit log.
 * Never stores raw secrets, tokens, passwords, or full prompt content.
 */

import { createHash, randomUUID } from 'node:crypto';
import type { AgentId, AuditEvent, Capability, RiskLevel } from './types.js';

const SECRET_RE =
  /\b(api[_-]?key|secret[_-]?key|password|passwd|token|bearer\s+[a-z0-9._-]{20,}|ghp_[a-z0-9]{20,}|sk-[a-z0-9]{20,}|AKIA[0-9A-Z]{16})\b/gi;

function redact(value: string): string {
  return value.replace(SECRET_RE, '[REDACTED]');
}

export function hashInput(input: unknown): string {
  const raw = typeof input === 'string' ? input : JSON.stringify(input ?? null);
  const safe = redact(raw).slice(0, 50_000);
  return createHash('sha256').update(safe).digest('hex').slice(0, 32);
}

export interface AuditSink {
  append(event: AuditEvent): void | Promise<void>;
  list(filter?: { taskId?: string; agentId?: string; limit?: number }): AuditEvent[];
}

/** In-memory sink (replace with append-only store / SIEM in production) */
export class MemoryAuditSink implements AuditSink {
  private readonly events: AuditEvent[] = [];

  append(event: AuditEvent): void {
    // Freeze to approximate immutability
    this.events.push(Object.freeze({ ...event, meta: event.meta ? { ...event.meta } : undefined }));
  }

  list(filter: { taskId?: string; agentId?: string; limit?: number } = {}): AuditEvent[] {
    let out = this.events;
    if (filter.taskId) out = out.filter((e) => e.taskId === filter.taskId);
    if (filter.agentId) out = out.filter((e) => e.agentId === filter.agentId);
    const limit = filter.limit ?? 500;
    return out.slice(-limit);
  }
}

let defaultSink: AuditSink = new MemoryAuditSink();

export function setAuditSink(sink: AuditSink): void {
  defaultSink = sink;
}

export function getAuditSink(): AuditSink {
  return defaultSink;
}

export function emitAudit(partial: {
  agentId: AgentId | 'system';
  taskId: string;
  userId: string;
  tool: string;
  capability: Capability | null;
  resultStatus: AuditEvent['resultStatus'];
  riskLevel: RiskLevel | 'NONE';
  approvalRequired?: boolean;
  approvalStatus?: string;
  input?: unknown;
  durationMs?: number;
  errorCode?: string;
  meta?: Record<string, string | number | boolean | null>;
}): AuditEvent {
  const event: AuditEvent = {
    id: randomUUID(),
    agentId: partial.agentId,
    taskId: partial.taskId,
    userId: partial.userId,
    tool: partial.tool,
    capability: partial.capability,
    timestamp: new Date().toISOString(),
    inputHash: hashInput(partial.input ?? null),
    resultStatus: partial.resultStatus,
    riskLevel: partial.riskLevel,
    approvalRequired: partial.approvalRequired ?? false,
    approvalStatus: partial.approvalStatus ?? 'n/a',
    durationMs: partial.durationMs,
    errorCode: partial.errorCode,
    meta: partial.meta,
  };
  void defaultSink.append(event);
  return event;
}
