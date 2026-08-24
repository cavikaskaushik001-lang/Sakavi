/**
 * Security research authorization and scanner tests.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { assertScope, ScopeViolationError } from '../../src/security/scope.js';
import { scanFiles } from '../../src/security/scanner.js';
import { runSecurityResearch } from '../../src/security/index.js';
import type { SecurityScope } from '../../src/security/types.js';

const labScope = (): SecurityScope => ({
  target: 'lab-app',
  owner: 'team@example.com',
  authorizationId: 'authz-lab-001',
  allowedHosts: ['localhost'],
  allowedPaths: ['/workspace'],
  permittedActions: ['recon.repo', 'analyze.code', 'analyze.secrets'],
  environment: 'lab',
});

describe('authorization boundary', () => {
  it('stops when scope missing', () => {
    assert.throws(() => assertScope(null as unknown as SecurityScope), ScopeViolationError);
  });

  it('stops when authorizationId empty', () => {
    const s = labScope();
    s.authorizationId = '';
    assert.throws(() => assertScope(s), ScopeViolationError);
  });

  it('accepts valid lab scope', () => {
    const s = assertScope(labScope());
    assert.equal(s.environment, 'lab');
  });
});

describe('static scanner', () => {
  it('flags secret-like patterns without echoing the secret', () => {
    const findings = scanFiles([
      {
        path: 'src/config.ts',
        content: 'const t = "ghp_abcdefghijklmnopqrstuvwxyz0123456789";\n',
      },
    ]);
    assert.ok(findings.some((f) => f.affectedComponent === 'secrets'));
    const f = findings.find((f) => f.affectedComponent === 'secrets')!;
    assert.ok(!f.evidence.some((e) => e.includes('ghp_abcdefgh')));
  });

  it('does not claim CONFIRMED on static match alone', () => {
    const findings = scanFiles([
      { path: 'a.js', content: 'eval(userInput);\n' },
    ]);
    assert.ok(findings.length >= 1);
    assert.ok(findings.every((f) => f.verificationStatus === 'unverified'));
    assert.ok(findings.every((f) => f.confidence !== 'CONFIRMED'));
  });
});

describe('research workflow', () => {
  it('stops without authorization', async () => {
    const r = await runSecurityResearch({
      userId: 'u1',
      objective: 'scan',
      scope: {
        target: 'x',
        owner: '',
        authorizationId: '',
        allowedHosts: [],
        permittedActions: [],
        environment: 'lab',
      },
    });
    assert.equal(r.status, 'stopped');
    assert.match(r.stopReason || '', /STOP SECURITY TESTING/);
  });

  it('runs passive analysis with files', async () => {
    const r = await runSecurityResearch(
      {
        userId: 'u1',
        objective: 'passive audit',
        scope: labScope(),
        allowDynamic: false,
      },
      {
        files: [
          {
            path: 'src/db.js',
            content: 'db.query("select * from u where id=" + userId);\n',
          },
        ],
      }
    );
    assert.equal(r.status, 'completed');
    assert.ok(r.findings.length >= 1);
    assert.ok(r.reportMarkdown.includes('Authorization'));
  });
});
