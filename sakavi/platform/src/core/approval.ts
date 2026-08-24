/**
 * Human approval system for HIGH / CRITICAL operations.
 * DIVA may request; cannot self-approve.
 */

import { randomUUID } from 'node:crypto';
import type { AgentId, ApprovalRequest, ApprovalStatus, Capability, RiskLevel } from './types.js';
import { ALWAYS_APPROVE, CAPABILITY_RISK } from './types.js';
import { emitAudit } from './audit.js';
import { PlatformError } from './errors.js';

const DEFAULT_TTL_MS = 30 * 60 * 1000; // 30 minutes

export interface ApprovalDecision {
  approvalId: string;
  status: 'approved' | 'denied';
  decidedBy: string;
  note?: string;
}

class ApprovalService {
  private readonly pending = new Map<string, ApprovalRequest>();
  private readonly history: ApprovalRequest[] = [];

  /**
   * Whether this capability at this risk needs human approval.
   */
  needsApproval(capability: Capability, riskOverride?: RiskLevel): boolean {
    if (ALWAYS_APPROVE.has(capability)) return true;
    const risk = riskOverride ?? CAPABILITY_RISK[capability];
    return risk === 'HIGH' || risk === 'CRITICAL';
  }

  create(params: {
    taskId: string;
    agentId: AgentId;
    capability: Capability;
    reason: string;
    summary: string;
    scope: string;
    ttlMs?: number;
  }): ApprovalRequest {
    const risk = CAPABILITY_RISK[params.capability];
    const id = randomUUID();
    const now = Date.now();
    const req: ApprovalRequest = {
      id,
      taskId: params.taskId,
      agentId: params.agentId,
      capability: params.capability,
      riskLevel: risk,
      reason: params.reason,
      summary: params.summary,
      scope: params.scope,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + (params.ttlMs ?? DEFAULT_TTL_MS)).toISOString(),
      status: 'pending',
    };
    this.pending.set(id, req);

    emitAudit({
      agentId: params.agentId,
      taskId: params.taskId,
      userId: 'system',
      tool: 'approval.create',
      capability: params.capability,
      resultStatus: 'ok',
      riskLevel: risk,
      approvalRequired: true,
      approvalStatus: 'pending',
      meta: { approvalId: id, summary: params.summary.slice(0, 200) },
    });

    return req;
  }

  get(id: string): ApprovalRequest | undefined {
    const req = this.pending.get(id) ?? this.history.find((h) => h.id === id);
    if (!req) return undefined;
    if (req.status === 'pending' && new Date(req.expiresAt).getTime() < Date.now()) {
      req.status = 'expired';
      this.pending.delete(id);
      this.history.push(req);
    }
    return req;
  }

  /**
   * OPERATOR / human only. Agents must not call decide().
   */
  decide(decision: ApprovalDecision): ApprovalRequest {
    const req = this.pending.get(decision.approvalId);
    if (!req) {
      throw new PlatformError('APPROVAL_NOT_FOUND', 'Approval request not found or already decided', 404);
    }
    if (req.status !== 'pending') {
      throw new PlatformError('APPROVAL_ALREADY_DECIDED', `Status is ${req.status}`, 409);
    }
    if (new Date(req.expiresAt).getTime() < Date.now()) {
      req.status = 'expired';
      this.pending.delete(req.id);
      this.history.push(req);
      throw new PlatformError('APPROVAL_EXPIRED', 'Approval request expired', 410);
    }

    req.status = decision.status;
    req.decidedBy = decision.decidedBy;
    req.decidedAt = new Date().toISOString();
    this.pending.delete(req.id);
    this.history.push(req);

    emitAudit({
      agentId: req.agentId,
      taskId: req.taskId,
      userId: decision.decidedBy,
      tool: 'approval.decide',
      capability: req.capability,
      resultStatus: decision.status === 'approved' ? 'ok' : 'denied',
      riskLevel: req.riskLevel,
      approvalRequired: true,
      approvalStatus: decision.status,
      meta: { approvalId: req.id, note: decision.note?.slice(0, 200) ?? null },
    });

    return req;
  }

  listPending(taskId?: string): ApprovalRequest[] {
    const now = Date.now();
    const out: ApprovalRequest[] = [];
    for (const [id, req] of this.pending) {
      if (new Date(req.expiresAt).getTime() < now) {
        req.status = 'expired';
        this.pending.delete(id);
        this.history.push(req);
        continue;
      }
      if (taskId && req.taskId !== taskId) continue;
      out.push(req);
    }
    return out;
  }

  isApproved(approvalId: string): boolean {
    const req = this.get(approvalId);
    return req?.status === 'approved';
  }
}

export const approvalService = new ApprovalService();
