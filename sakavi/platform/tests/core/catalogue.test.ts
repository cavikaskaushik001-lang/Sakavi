import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  CAPABILITY_CATALOGUE,
  listCapabilities,
  getCapability,
  divaCapabilitySummary,
} from '../../src/core/capability-catalogue.js';
import { TOOL_REGISTRY, getTool, listTools, validateToolInput } from '../../src/tools/registry.js';
import { verifyCodeChanges, verifyDeployment } from '../../src/verification/index.js';
import { memoryWrite, memoryQuery } from '../../src/memory/index.js';

describe('capability catalogue', () => {
  it('is non-empty and frozen knowledge', () => {
    assert.ok(CAPABILITY_CATALOGUE.length >= 20);
    assert.ok(getCapability('filesystem.read'));
    assert.ok(getCapability('security.scan'));
    assert.ok(divaCapabilitySummary().includes('filesystem.read'));
  });

  it('lists by helper', () => {
    assert.ok(listCapabilities().length === CAPABILITY_CATALOGUE.length);
  });
});

describe('tool registry', () => {
  it('registers core tools with schemas', () => {
    assert.ok(getTool('sandbox.execute'));
    assert.ok(getTool('github.create_pr'));
    assert.ok(listTools('github').length >= 3);
  });

  it('validates input with zod', () => {
    assert.throws(() => validateToolInput('sandbox.execute', {}));
    const ok = validateToolInput('sandbox.execute', {
      sandboxId: 'abc',
      command: 'ls',
    });
    assert.equal((ok as { command: string }).command, 'ls');
  });
});

describe('verification phases', () => {
  it('distinguishes verified vs failed', () => {
    const v = verifyCodeChanges({
      typecheckOk: true,
      unitTestsOk: true,
      buildOk: true,
      lintOk: true,
      integrationOk: true,
      diffReviewed: true,
    });
    assert.equal(v.overall, 'verified');
    const f = verifyDeployment({ deployed: true, healthOk: false });
    assert.equal(f.overall, 'failed');
  });
});

describe('memory trust', () => {
  it('does not trust repo: sources', () => {
    const r = memoryWrite('security', {
      content: 'finding x',
      source: 'repo:README',
      confidence: 0.9,
      scope: 'proj',
      trusted: true,
    });
    assert.equal(r.trusted, false);
    assert.ok(memoryQuery('security', { scope: 'proj' }).length >= 1);
  });
});
