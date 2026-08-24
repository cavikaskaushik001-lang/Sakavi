/**
 * Structured errors — never embed secrets in messages.
 */

export class PlatformError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode = 400,
    public readonly meta?: Record<string, string | number | boolean>
  ) {
    super(message);
    this.name = 'PlatformError';
  }
}

export class CapabilityDeniedError extends PlatformError {
  constructor(capability: string, reason: string) {
    super('CAPABILITY_DENIED', `Capability "${capability}" denied: ${reason}`, 403, {
      capability,
    });
    this.name = 'CapabilityDeniedError';
  }
}

export class ApprovalRequiredError extends PlatformError {
  constructor(
    public readonly approvalId: string,
    capability: string
  ) {
    super(
      'APPROVAL_REQUIRED',
      `Capability "${capability}" requires human approval (id=${approvalId})`,
      402,
      { capability, approvalId }
    );
    this.name = 'ApprovalRequiredError';
  }
}

export class KillSwitchActiveError extends PlatformError {
  constructor() {
    super('KILL_SWITCH_ACTIVE', 'Emergency stop is active — all privileged operations blocked', 503);
    this.name = 'KillSwitchActiveError';
  }
}

export class PolicyViolationError extends PlatformError {
  constructor(message: string, meta?: Record<string, string | number | boolean>) {
    super('POLICY_VIOLATION', message, 403, meta);
    this.name = 'PolicyViolationError';
  }
}

export class ValidationError extends PlatformError {
  constructor(message: string) {
    super('VALIDATION_ERROR', message, 400);
    this.name = 'ValidationError';
  }
}

export class TimeoutError extends PlatformError {
  constructor(what: string, ms: number) {
    super('TIMEOUT', `${what} timed out after ${ms}ms`, 408, { timeoutMs: ms });
    this.name = 'TimeoutError';
  }
}

export class CircuitOpenError extends PlatformError {
  constructor(agentId: string) {
    super('CIRCUIT_OPEN', `Circuit breaker open for agent ${agentId}`, 503, { agentId });
    this.name = 'CircuitOpenError';
  }
}
