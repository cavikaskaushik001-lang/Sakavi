/**
 * DIVA planner / critic / recovery / risk tests (no Docker required).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeIntent, decompose, hasCircularDeps, nextReadySteps } from '../../src/agents/diva/planner.js';
import { critiquePlan } from '../../src/agents/diva/plan-critic.js';
import { classifyFailure, isRetriable } from '../../src/agents/diva/recovery.js';
import { assessIntentRisk, assessPlanRisk, decisionConfidence } from '../../src/agents/diva/risk-engine.js';
import type { PlanStep } from '../../src/agents/diva/types.js';

describe('intent analysis', () => {
  it('detects write + deploy intents', () => {
    const i = analyzeIntent('Improve website and deploy to production');
    assert.equal(i.needsWrite, true);
    assert.equal(i.needsDeploy, true);
    assert.ok(i.domainHints.includes('coder') || i.domainHints.includes('deployment'));
  });

  it('marks irreversible hints', () => {
    const i = analyzeIntent('Drop production database table');
    assert.equal(i.irreversibleHints, true);
  });
});

describe('hierarchical planning', () => {
  it('builds multi-step plan with dependencies for coding objective', () => {
    const intent = analyzeIntent('Fix login bug and open a PR', []);
    const plan = decompose(
      { userId: 'u', objective: 'Fix login bug and open a PR', projectPath: '/tmp/proj' },
      intent
    );
    assert.ok(plan.length >= 2);
    assert.ok(plan.every((p) => p.successCriteria.length > 0));
    assert.ok(plan.every((p) => p.id));
    assert.equal(hasCircularDeps(plan), false);
  });

  it('does not run steps before dependencies complete', () => {
    const plan: PlanStep[] = [
      {
        id: 'a',
        objective: 'first',
        dependencies: [],
        assignedAgent: 'research',
        requiredCapabilities: ['research.query'],
        riskLevel: 'low',
        successCriteria: ['done'],
        params: {},
        status: 'pending',
        attempts: 0,
        observationIds: [],
      },
      {
        id: 'b',
        objective: 'second',
        dependencies: ['a'],
        assignedAgent: 'coder',
        requiredCapabilities: ['workspace.read'],
        riskLevel: 'low',
        successCriteria: ['done'],
        params: {},
        status: 'pending',
        attempts: 0,
        observationIds: [],
      },
    ];
    let ready = nextReadySteps(plan, 3);
    assert.deepEqual(ready.map((r) => r.id), ['a']);
    plan[0].status = 'done';
    ready = nextReadySteps(plan, 3);
    assert.deepEqual(ready.map((r) => r.id), ['b']);
  });
});

describe('plan critic', () => {
  it('rejects circular dependencies', () => {
    const plan: PlanStep[] = [
      {
        id: 'a',
        objective: 'a',
        dependencies: ['b'],
        assignedAgent: 'coder',
        requiredCapabilities: ['workspace.read'],
        riskLevel: 'low',
        successCriteria: ['x'],
        params: {},
        status: 'pending',
        attempts: 0,
        observationIds: [],
      },
      {
        id: 'b',
        objective: 'b',
        dependencies: ['a'],
        assignedAgent: 'coder',
        requiredCapabilities: ['workspace.read'],
        riskLevel: 'low',
        successCriteria: ['x'],
        params: {},
        status: 'pending',
        attempts: 0,
        observationIds: [],
      },
    ];
    const report = critiquePlan(plan);
    assert.equal(report.approved, false);
    assert.ok(report.issues.some((i) => /circular/i.test(i.message)));
  });

  it('flags coder requesting deployment.execute', () => {
    const plan: PlanStep[] = [
      {
        id: 'x',
        objective: 'deploy from coder',
        dependencies: [],
        assignedAgent: 'coder',
        requiredCapabilities: ['deployment.execute'],
        riskLevel: 'critical',
        successCriteria: ['deployed'],
        params: {},
        status: 'pending',
        attempts: 0,
        observationIds: [],
      },
    ];
    const report = critiquePlan(plan);
    assert.equal(report.approved, false);
  });
});

describe('recovery classification', () => {
  it('classifies security vs transient', () => {
    assert.equal(classifyFailure('CAPABILITY_DENIED'), 'AUTHORIZATION');
    assert.equal(classifyFailure('timeout waiting'), 'TRANSIENT');
    assert.equal(classifyFailure('protected_branch'), 'SECURITY');
  });

  it('does not retry critical steps', () => {
    const step = {
      id: 'd',
      objective: 'deploy',
      dependencies: [],
      assignedAgent: 'deployment' as const,
      requiredCapabilities: [] as never[],
      riskLevel: 'critical' as const,
      successCriteria: [],
      params: {},
      status: 'failed' as const,
      attempts: 0,
      observationIds: [],
    };
    assert.equal(isRetriable('TRANSIENT', step), false);
  });
});

describe('risk engine', () => {
  it('elevates deploy intent to critical', () => {
    const intent = analyzeIntent('Ship to production now');
    const risk = assessIntentRisk(intent);
    assert.ok(risk.overall === 'critical' || risk.overall === 'high');
    assert.ok(risk.requiresHumanApproval);
  });

  it('confidence is not 1.0 for critical risk', () => {
    const c = decisionConfidence({
      evidenceCount: 1,
      hasTests: false,
      risk: 'critical',
      unknownFactors: 2,
    });
    assert.ok(c < 0.6);
  });
});
