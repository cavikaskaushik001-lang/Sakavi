/**
 * Global emergency stop — outside agent control.
 * Agents cannot activate or deactivate this.
 * Only an external operator / host process can.
 */

import { emitAudit } from './audit.js';
import { KillSwitchActiveError } from './errors.js';

export type KillSwitchListener = (active: boolean, reason: string) => void;

class KillSwitch {
  private active = false;
  private reason = '';
  private activatedAt: string | null = null;
  private readonly listeners = new Set<KillSwitchListener>();
  private readonly abortControllers = new Map<string, AbortController>();

  isActive(): boolean {
    return this.active;
  }

  getReason(): string {
    return this.reason;
  }

  /** OPERATOR ONLY. Agents must never call this. */
  activate(reason: string, operatorId = 'operator'): void {
    this.active = true;
    this.reason = reason || 'emergency stop';
    this.activatedAt = new Date().toISOString();

    for (const [, ctrl] of this.abortControllers) {
      try {
        ctrl.abort(new Error('Kill switch activated'));
      } catch {
        /* ignore */
      }
    }
    this.abortControllers.clear();

    emitAudit({
      agentId: 'system',
      taskId: 'kill-switch',
      userId: operatorId,
      tool: 'kill_switch.activate',
      capability: null,
      resultStatus: 'ok',
      riskLevel: 'CRITICAL',
      meta: { reason: this.reason },
    });

    for (const fn of this.listeners) {
      try {
        fn(true, this.reason);
      } catch {
        /* ignore */
      }
    }
  }

  /** OPERATOR ONLY. */
  deactivate(operatorId = 'operator'): void {
    this.active = false;
    this.reason = '';
    this.activatedAt = null;

    emitAudit({
      agentId: 'system',
      taskId: 'kill-switch',
      userId: operatorId,
      tool: 'kill_switch.deactivate',
      capability: null,
      resultStatus: 'ok',
      riskLevel: 'HIGH',
    });

    for (const fn of this.listeners) {
      try {
        fn(false, '');
      } catch {
        /* ignore */
      }
    }
  }

  status(): { active: boolean; reason: string; activatedAt: string | null } {
    return {
      active: this.active,
      reason: this.reason,
      activatedAt: this.activatedAt,
    };
  }

  onChange(fn: KillSwitchListener): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  registerTask(taskId: string): AbortSignal {
    const existing = this.abortControllers.get(taskId);
    if (existing) return existing.signal;
    const ctrl = new AbortController();
    this.abortControllers.set(taskId, ctrl);
    if (this.active) {
      ctrl.abort(new Error('Kill switch already active'));
    }
    return ctrl.signal;
  }

  unregisterTask(taskId: string): void {
    this.abortControllers.delete(taskId);
  }

  assertNotActive(): void {
    if (this.active) {
      throw new KillSwitchActiveError();
    }
  }
}

/** Singleton — process-wide */
export const killSwitch = new KillSwitch();
