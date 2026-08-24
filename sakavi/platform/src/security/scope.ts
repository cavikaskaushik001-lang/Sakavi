/**
 * Authorization boundary — stop if missing/ambiguous/expired.
 * Reachability ≠ authorization.
 */

import { PlatformError } from '../core/errors.js';
import type { SecurityScope } from './types.js';
import { actionPermitted, isScopeActive } from './types.js';

export class ScopeViolationError extends PlatformError {
  constructor(message: string) {
    super('SCOPE_VIOLATION', message, 403);
    this.name = 'ScopeViolationError';
  }
}

export function assertScope(scope: SecurityScope | undefined | null): SecurityScope {
  if (!scope) {
    throw new ScopeViolationError(
      'STOP SECURITY TESTING: authorization scope missing. Do not infer from reachability.'
    );
  }
  if (!scope.authorizationId?.trim()) {
    throw new ScopeViolationError('STOP SECURITY TESTING: authorizationId required');
  }
  if (!scope.owner?.trim()) {
    throw new ScopeViolationError('STOP SECURITY TESTING: owner required');
  }
  if (!scope.target?.trim()) {
    throw new ScopeViolationError('STOP SECURITY TESTING: target required');
  }
  if (!scope.allowedHosts?.length && scope.environment !== 'lab') {
    // lab may be path-only (repo analysis)
    if (!scope.allowedPaths?.length) {
      throw new ScopeViolationError('STOP SECURITY TESTING: allowedHosts or allowedPaths required');
    }
  }
  if (!isScopeActive(scope)) {
    throw new ScopeViolationError('STOP SECURITY TESTING: authorization expired or not yet valid');
  }
  if (scope.environment === 'production' && !scope.permittedActions.includes('production.ack')) {
    throw new ScopeViolationError(
      'STOP SECURITY TESTING: production targets require permittedActions including production.ack'
    );
  }
  return scope;
}

export function assertAction(scope: SecurityScope, action: string): void {
  assertScope(scope);
  if (!actionPermitted(scope, action)) {
    throw new ScopeViolationError(
      `STOP SECURITY TESTING: action "${action}" not in permittedActions`
    );
  }
}

export function assertHostInScope(scope: SecurityScope, host: string): void {
  assertScope(scope);
  const h = host.toLowerCase();
  const ok = scope.allowedHosts.some(
    (a) => h === a.toLowerCase() || h.endsWith('.' + a.toLowerCase())
  );
  if (!ok && scope.allowedHosts.length > 0) {
    throw new ScopeViolationError(`STOP SECURITY TESTING: host out of scope: ${host}`);
  }
}

export function assertPathInScope(scope: SecurityScope, filePath: string): void {
  assertScope(scope);
  if (!scope.allowedPaths?.length) return;
  const normalized = filePath.replace(/\\/g, '/');
  const ok = scope.allowedPaths.some(
    (p) => normalized === p || normalized.startsWith(p.endsWith('/') ? p : p + '/')
  );
  if (!ok) {
    throw new ScopeViolationError(`STOP SECURITY TESTING: path out of scope: ${filePath}`);
  }
}
