/**
 * Centralized secret provider.
 * - Never put secrets in prompts, logs, frontend, or git
 * - Inject only into the specific process that needs them
 * - Prefer short-lived credentials
 */

import { PlatformError } from './errors.js';
import { emitAudit } from './audit.js';
import { killSwitch } from './kill-switch.js';

export type SecretName =
  | 'GITHUB_TOKEN'
  | 'OPENAI_API_KEY'
  | 'DATABASE_URL'
  | 'DEPLOY_TOKEN'
  | string;

interface SecretRecord {
  value: string;
  expiresAt: number | null; // epoch ms
}

class SecretProvider {
  private readonly store = new Map<string, SecretRecord>();

  /**
   * Load from process env at startup (host only).
   * Does not expose values via listing.
   */
  loadFromEnv(names: SecretName[]): void {
    for (const name of names) {
      const v = process.env[name];
      if (v && v.length > 0) {
        this.store.set(name, { value: v, expiresAt: null });
      }
    }
  }

  /**
   * Inject a short-lived secret (e.g. from a vault).
   * Operators only — agents request via capability, never read the value.
   */
  inject(name: SecretName, value: string, ttlMs?: number): void {
    if (!name || !value) throw new PlatformError('INVALID_SECRET', 'name and value required');
    this.store.set(name, {
      value,
      expiresAt: ttlMs ? Date.now() + ttlMs : null,
    });
  }

  has(name: SecretName): boolean {
    const rec = this.store.get(name);
    if (!rec) return false;
    if (rec.expiresAt && Date.now() > rec.expiresAt) {
      this.store.delete(name);
      return false;
    }
    return true;
  }

  /**
   * Returns the secret value ONLY for trusted server-side executors
   * (e.g. GitHub client, DB driver). Never pass to model context.
   *
   * Requires secrets.request capability already approved upstream.
   */
  reveal(
    name: SecretName,
    context: { taskId: string; userId: string; agentId: string; reason: string }
  ): string {
    killSwitch.assertNotActive();
    const rec = this.store.get(name);
    if (!rec || (rec.expiresAt && Date.now() > rec.expiresAt)) {
      this.store.delete(name);
      throw new PlatformError('SECRET_NOT_FOUND', `Secret not available: ${name}`, 404);
    }

    emitAudit({
      agentId: context.agentId as 'diva',
      taskId: context.taskId,
      userId: context.userId,
      tool: 'secrets.reveal',
      capability: 'secrets.request',
      resultStatus: 'ok',
      riskLevel: 'CRITICAL',
      meta: { secretName: name, reason: context.reason.slice(0, 200) },
    });

    return rec.value;
  }

  /** List names only — never values */
  listNames(): string[] {
    const now = Date.now();
    const names: string[] = [];
    for (const [k, v] of this.store) {
      if (v.expiresAt && now > v.expiresAt) {
        this.store.delete(k);
        continue;
      }
      names.push(k);
    }
    return names;
  }

  revoke(name: SecretName): void {
    this.store.delete(name);
  }

  revokeAll(): void {
    this.store.clear();
  }
}

export const secretProvider = new SecretProvider();
