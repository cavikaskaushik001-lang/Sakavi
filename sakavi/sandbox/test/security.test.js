/**
 * Unit tests for SecurityValidator (no Docker required).
 * Run: node --test test/security.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SecurityValidator } from '../src/SecurityValidator.js';

describe('SecurityValidator.validateCommand', () => {
  it('allows normal commands', () => {
    assert.equal(SecurityValidator.validateCommand('ls -la').ok, true);
    assert.equal(SecurityValidator.validateCommand('npm test').ok, true);
    assert.equal(SecurityValidator.validateCommand('python3 -m pytest').ok, true);
    assert.equal(SecurityValidator.validateCommand('git status').ok, true);
  });

  it('blocks sudo / privilege escalation', () => {
    const r = SecurityValidator.validateCommand('sudo rm -rf /tmp/foo');
    assert.equal(r.ok, false);
  });

  it('blocks rm -rf /', () => {
    const r = SecurityValidator.validateCommand('rm -rf /');
    assert.equal(r.ok, false);
  });

  it('blocks docker socket references', () => {
    const r = SecurityValidator.validateCommand('ls /var/run/docker.sock');
    assert.equal(r.ok, false);
  });

  it('blocks package install when network is disabled', () => {
    const r = SecurityValidator.validateCommand('npm install lodash', {
      allowNetwork: false,
    });
    assert.equal(r.ok, false);
    assert.match(r.reason, /network/i);
  });

  it('allows package install when network is enabled', () => {
    const r = SecurityValidator.validateCommand('npm install lodash', {
      allowNetwork: true,
    });
    assert.equal(r.ok, true);
  });

  it('rejects empty / huge commands', () => {
    assert.equal(SecurityValidator.validateCommand('').ok, false);
    assert.equal(SecurityValidator.validateCommand('x'.repeat(40_000)).ok, false);
  });
});

describe('SecurityValidator.sanitizeWorkspacePath', () => {
  it('accepts relative paths under workspace', () => {
    const r = SecurityValidator.sanitizeWorkspacePath('src/app.js');
    assert.equal(r.ok, true);
    assert.equal(r.safePath, '/workspace/src/app.js');
  });

  it('accepts /workspace absolute paths', () => {
    const r = SecurityValidator.sanitizeWorkspacePath('/workspace/package.json');
    assert.equal(r.ok, true);
  });

  it('rejects path traversal', () => {
    const r = SecurityValidator.sanitizeWorkspacePath('../etc/passwd');
    assert.equal(r.ok, false);
  });

  it('rejects absolute paths outside workspace', () => {
    const r = SecurityValidator.sanitizeWorkspacePath('/etc/passwd');
    assert.equal(r.ok, false);
  });

  it('blocks secret-like paths', () => {
    assert.equal(SecurityValidator.sanitizeWorkspacePath('.env').ok, false);
    assert.equal(SecurityValidator.sanitizeWorkspacePath('config/.env.production').ok, false);
    assert.equal(SecurityValidator.sanitizeWorkspacePath('.ssh/id_rsa').ok, false);
  });
});

describe('SecurityValidator.isSafeHostProjectPath', () => {
  it('rejects host root and system dirs', () => {
    assert.equal(SecurityValidator.isSafeHostProjectPath('/'), false);
    assert.equal(SecurityValidator.isSafeHostProjectPath('/etc'), false);
    assert.equal(SecurityValidator.isSafeHostProjectPath('/root'), false);
  });

  it('rejects obvious secret locations', () => {
    assert.equal(SecurityValidator.isSafeHostProjectPath('/home/user/.ssh'), false);
    assert.equal(SecurityValidator.isSafeHostProjectPath('/app/.env'), false);
  });
});
