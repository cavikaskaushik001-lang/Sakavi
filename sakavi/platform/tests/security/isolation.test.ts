/**
 * Isolation-oriented tests (path, network policy, secrets redaction).
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { policyEngine } from '../../src/core/policy-engine.js';
import { hashInput } from '../../src/core/audit.js';
import { initPlatform } from '../../src/index.js';
import type { ToolInvocation, Capability } from '../../src/core/types.js';

before(() => {
  initPlatform({ loadEnvSecrets: false });
});

function baseInv(over: Partial<ToolInvocation>): ToolInvocation {
  return {
    agentId: 'coder',
    taskId: 'task-iso-0001',
    userId: 'user-1',
    toolName: 'sandbox.execute',
    capability: 'process.execute',
    scope: '/workspace',
    reason: 'test',
    args: {},
    ...over,
  };
}

const ctx = {
  agentAllowedCapabilities: [
    'process.execute',
    'workspace.read',
    'workspace.write',
    'network.read',
    'github.write',
  ] as Capability[],
  networkEnabled: false,
  networkAllowlist: [] as string[],
  maxToolCallsForTask: 40,
  currentToolCallCount: 0,
  protectedBranches: ['main', 'master'],
};

describe('network isolation policy', () => {
  it('blocks metadata and private IPs', () => {
    const decision = policyEngine.evaluate(
      baseInv({
        toolName: 'network.fetch',
        capability: 'network.read',
        args: { url: 'http://169.254.169.254/latest/meta-data/' },
      }),
      { ...ctx, networkEnabled: true }
    );
    assert.equal(decision.allow, false);
  });

  it('blocks localhost', () => {
    const decision = policyEngine.evaluate(
      baseInv({
        toolName: 'network.fetch',
        capability: 'network.read',
        args: { url: 'http://localhost:8080/admin' },
      }),
      { ...ctx, networkEnabled: true }
    );
    assert.equal(decision.allow, false);
  });

  it('blocks when network disabled', () => {
    const decision = policyEngine.evaluate(
      baseInv({
        toolName: 'network.fetch',
        capability: 'network.read',
        args: { url: 'https://registry.npmjs.org' },
      }),
      { ...ctx, networkEnabled: false }
    );
    assert.equal(decision.allow, false);
  });

  it('allows allowlisted host when network enabled', () => {
    const decision = policyEngine.evaluate(
      baseInv({
        toolName: 'network.fetch',
        capability: 'network.read',
        args: { url: 'https://registry.npmjs.org/lodash' },
      }),
      { ...ctx, networkEnabled: true }
    );
    assert.equal(decision.allow, true);
  });
});

describe('audit redaction', () => {
  it('does not keep raw secrets in hash input path (redacts before hash)', () => {
    const h1 = hashInput({ token: 'ghp_abcdefghijklmnopqrstuvwxyz012345' });
    const h2 = hashInput({ token: '[REDACTED]' });
    // Both should be stable hashes of redacted content
    assert.equal(typeof h1, 'string');
    assert.equal(h1.length, 32);
    assert.equal(h1, h2);
  });
});

describe('sandbox execute policy', () => {
  it('blocks docker.sock references', () => {
    const decision = policyEngine.evaluate(
      baseInv({
        args: { command: 'ls /var/run/docker.sock' },
      }),
      ctx
    );
    assert.equal(decision.allow, false);
  });

  it('blocks package install when network disabled', () => {
    const decision = policyEngine.evaluate(
      baseInv({
        args: { command: 'npm install lodash' },
      }),
      { ...ctx, networkEnabled: false }
    );
    assert.equal(decision.allow, false);
  });
});
