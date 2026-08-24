/**
 * Capability Manager — issues time-bounded grants.
 * Does not execute tools; only tracks what an agent may attempt.
 */

import { randomUUID } from 'node:crypto';
import type { AgentId, Capability, CapabilityGrant, RiskLevel } from './types.js';
import { CAPABILITY_RISK } from './types.js';
import { approvalService } from './approval.js';
import { emitAudit } from './audit.js';
import { CapabilityDeniedError, KillSwitchActiveError } from './errors.js';
import { killSwitch } from './kill-switch.js';

const DEFAULT_GRANT_TTL_MS = 15 * 60 * 1000; // 15 min

export interface GrantRequest {
  agentId: AgentId;
  taskId: string;
  userId: string;
  capability: Capability;
  scope: string;
  reason: string;
  /** Agent manifest allow-list */
  agentAllowed: readonly Capability[];
  ttlMs?: number;
  /** Pre-existing approval id if already approved */
  approvalId?: string;
}

export interface GrantResult {
  grant?: CapabilityGrant;
  approvalRequired: boolean;
  approvalId?: string;
  denied?: boolean;
  reason?: string;
}

class CapabilityManager {
  private readonly grants = new Map<string, CapabilityGrant>();

  request(req: GrantRequest): GrantResult {
    if (killSwitch.isActive()) {
      throw new KillSwitchActiveError();
    }

    // Agent must list the capability in its manifest
    if (!req.agentAllowed.includes(req.capability)) {
      emitAudit({
        agentId: req.agentId,
        taskId: req.taskId,
        userId: req.userId,
        tool: 'capability.request',
        capability: req.capability,
        resultStatus: 'denied',
        riskLevel: CAPABILITY_RISK[req.capability],
        meta: { reason: 'not_in_manifest' },
      });
      return {
        approvalRequired: false,
        denied: true,
        reason: `Agent ${req.agentId} is not allowed to request ${req.capability}`,
      };
    }

    const risk: RiskLevel = CAPABILITY_RISK[req.capability];
    const needsApproval = approvalService.needsApproval(req.capability, risk);

    if (needsApproval) {
      if (req.approvalId && approvalService.isApproved(req.approvalId)) {
        // proceed to issue grant
      } else {
        const approval = approvalService.create({
          taskId: req.taskId,
          agentId: req.agentId,
          capability: req.capability,
          reason: req.reason,
          summary: `${req.agentId} requests ${req.capability} on scope=${req.scope}`,
          scope: req.scope,
        });
        return {
          approvalRequired: true,
          approvalId: approval.id,
        };
      }
    }

    const now = Date.now();
    const grant: CapabilityGrant = {
      id: randomUUID(),
      capability: req.capability,
      agentId: req.agentId,
      taskId: req.taskId,
      scope: req.scope,
      riskLevel: risk,
      issuedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + (req.ttlMs ?? DEFAULT_GRANT_TTL_MS)).toISOString(),
      approvalRequired: needsApproval,
      approvalStatus: needsApproval ? 'approved' : 'not_required',
      approvedBy: needsApproval ? 'human' : undefined,
      revoked: false,
    };
    this.grants.set(grant.id, grant);

    emitAudit({
      agentId: req.agentId,
      taskId: req.taskId,
      userId: req.userId,
      tool: 'capability.grant',
      capability: req.capability,
      resultStatus: 'ok',
      riskLevel: risk,
      approvalRequired: needsApproval,
      approvalStatus: grant.approvalStatus,
      meta: { grantId: grant.id, scope: req.scope.slice(0, 200) },
    });

    return { grant, approvalRequired: false };
  }

  /**
   * Validate an existing grant is still valid for this invocation.
   */
  assertValid(grantId: string, capability: Capability, agentId: AgentId, taskId: string): CapabilityGrant {
    if (killSwitch.isActive()) throw new KillSwitchActiveError();

    const grant = this.grants.get(grantId);
    if (!grant || grant.revoked) {
      throw new CapabilityDeniedError(capability, 'grant missing or revoked');
    }
    if (grant.capability !== capability || grant.agentId !== agentId || grant.taskId !== taskId) {
      throw new CapabilityDeniedError(capability, 'grant mismatch');
    }
    if (new Date(grant.expiresAt).getTime() < Date.now()) {
      grant.revoked = true;
      throw new CapabilityDeniedError(capability, 'grant expired');
    }
    return grant;
  }

  revoke(grantId: string, reason: string): void {
    const g = this.grants.get(grantId);
    if (g) {
      g.revoked = true;
      emitAudit({
        agentId: g.agentId,
        taskId: g.taskId,
        userId: 'system',
        tool: 'capability.revoke',
        capability: g.capability,
        resultStatus: 'ok',
        riskLevel: g.riskLevel,
        meta: { grantId, reason: reason.slice(0, 200) },
      });
    }
  }

  revokeAllForTask(taskId: string): void {
    for (const g of this.grants.values()) {
      if (g.taskId === taskId && !g.revoked) {
        g.revoked = true;
      }
    }
  }

  /** On kill switch — revoke everything */
  revokeAll(): void {
    for (const g of this.grants.values()) {
      g.revoked = true;
    }
  }
}

export const capabilityManager = new CapabilityManager();

// Hook kill switch to revoke grants
killSwitch.onChange((active) => {
  if (active) capabilityManager.revokeAll();
});
