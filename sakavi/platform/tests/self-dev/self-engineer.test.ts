import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isProtectedPath, filterWritablePaths } from '../../src/self-dev/protected.js';
import { assertWithinBudget, DEFAULT_SELF_DEV_BUDGET, BudgetExceededError } from '../../src/self-dev/budget.js';
import { selfDiagnose, selfAudit } from '../../src/agents/self-engineer/index.js';
import { reviewSelfChange } from '../../src/agents/self-reviewer/index.js';
import { selfRepair } from '../../src/self-dev/workflow.js';
import { buildArchitectureMap } from '../../src/self-dev/architecture-map.js';

describe('protected paths', () => {
  it('flags kill-switch and policy', () => {
    assert.equal(isProtectedPath('src/core/kill-switch.ts'), true);
    assert.equal(isProtectedPath('src/core/policy-engine.ts'), true);
    assert.equal(isProtectedPath('src/agents/diva/planner.ts'), false);
  });

  it('filters writable set', () => {
    const { allowed, protectedHits } = filterWritablePaths([
      'src/core/kill-switch.ts',
      'src/agents/diva/planner.ts',
    ]);
    assert.deepEqual(allowed, ['src/agents/diva/planner.ts']);
    assert.equal(protectedHits.length, 1);
  });
});

describe('budget', () => {
  it('throws when files exceed max', () => {
    assert.throws(
      () =>
        assertWithinBudget(DEFAULT_SELF_DEV_BUDGET, {
          filesChanged: 100,
          patchBytes: 10,
          attempt: 1,
        }),
      BudgetExceededError
    );
  });
});

describe('self diagnose', () => {
  it('reads source and returns structured result', () => {
    const r = selfDiagnose();
    assert.ok(r.sourceFiles > 0);
    assert.ok(r.reportPath.includes('diagnose'));
    assert.ok(Array.isArray(r.findings));
  });
});

describe('self audit', () => {
  it('produces audit report', () => {
    const r = selfAudit();
    assert.ok(r.reportPath);
  });
});

describe('self reviewer', () => {
  it('rejects protected path changes', () => {
    const r = reviewSelfChange({
      branchName: 'self/x',
      changedFiles: ['src/core/kill-switch.ts'],
      diffSummary: 'change',
      testSummary: 'all pass',
      authorRationale: 'need change',
    });
    assert.equal(r.approved, false);
    assert.equal(r.requiresExternalReview, true);
  });
});

describe('self repair', () => {
  it('never claims verified without tests', () => {
    const r = selfRepair({});
    assert.equal(r.verified, false);
    assert.ok(
      ['PREPARED_PR', 'NEEDS_EXTERNAL_REVIEW', 'BLOCKED', 'FAILED'].includes(r.finalStatus)
    );
  });
});

describe('architecture map', () => {
  it('includes core modules', () => {
    const m = buildArchitectureMap();
    assert.ok(m.some((x) => /Gateway|Policy|DIVA|Sandbox/i.test(x.name)));
  });
});
