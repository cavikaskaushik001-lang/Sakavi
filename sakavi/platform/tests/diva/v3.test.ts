import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createTask,
  checkpoint,
  pause,
  resume,
  cancel,
  recordFailedApproach,
  wasStrategyTried,
  complete,
} from '../../src/core/task-engine/task-manager.js';
import { selectBatch } from '../../src/core/task-engine/scheduler.js';
import { claim, addEvidence } from '../../src/core/evidence/index.js';
import { ProjectGraph, impactAnalysis } from '../../src/project/graph.js';
import { evaluateStage, recordCalibration, calibrationSummary } from '../../src/core/self-evaluation.js';
import { buildFinalReport, scoreQuality } from '../../src/agents/diva/v3-report.js';
import { runBenchmarks } from '../../src/evaluation/benchmark.js';
import '../../src/evaluation/cases.js';

describe('task engine long-horizon', () => {
  it('create checkpoint pause resume cancel', () => {
    const t = createTask({ userId: 'u', objective: 'long task' });
    checkpoint(t.id, 'start');
    pause(t.id);
    const r = resume(t.id);
    assert.equal(r.status, 'executing');
    recordFailedApproach(t.id, {
      strategy: 's1',
      assumption: 'a',
      action: 'act',
      result: 'fail',
      failureReason: 'x',
      lesson: 'y',
    });
    assert.equal(wasStrategyTried(t.id, 's1'), true);
    cancel(t.id, 'stop');
    assert.equal(cancel(t.id).status, 'cancelled');
  });

  it('complete with final status', () => {
    const t = createTask({ userId: 'u', objective: 'ok' });
    const c = complete(t.id, 'VERIFIED_SUCCESS', 'done');
    assert.equal(c.finalStatus, 'VERIFIED_SUCCESS');
  });
});

describe('evidence', () => {
  it('downgrades FACT without evidence', () => {
    assert.equal(claim('FACT', 'x', []).kind, 'HYPOTHESIS');
    const e = addEvidence({
      source: 'test',
      type: 'test',
      confidence: 0.9,
      summary: 'passed',
    });
    assert.equal(claim('VERIFIED', 'x', [e.id]).kind, 'VERIFIED');
  });
});

describe('project graph impact', () => {
  it('reports affected paths', () => {
    const g = ProjectGraph.fromFileList('p', [
      'src/api/user.ts',
      'src/api/user.test.ts',
      'package.json',
    ]);
    const imp = impactAnalysis(g, ['src/api/user.ts']);
    assert.ok(imp.report.includes('Changed'));
  });
});

describe('self-eval vs verification', () => {
  it('does not mark achieved without external verify', () => {
    const ev = evaluateStage({
      goal: 'fix',
      expected: 'green',
      actual: 'green',
      evidence: [],
      verifiedExternally: false,
    });
    assert.equal(ev.goalAchieved, false);
  });
});

describe('final report honesty', () => {
  it('does not claim VERIFIED_SUCCESS when verification incomplete', () => {
    const r = buildFinalReport({
      objective: 'x',
      plan: [],
      actions: [],
      changes: [],
      evidence: [],
      tests: [],
      verification: 'incomplete',
      failures: [],
      recovery: [],
      remainingIssues: [],
      risk: 'low',
      verified: true,
    });
    assert.equal(r.finalStatus, 'PARTIALLY_COMPLETE');
  });
});

describe('quality score', () => {
  it('scores verified higher', () => {
    const q = scoreQuality({
      verified: true,
      failedApproaches: 0,
      toolCalls: 5,
      maxToolCalls: 50,
      unexpectedChanges: 0,
      hadRegression: true,
    });
    assert.ok(q.overall > 0.5);
  });
});

describe('benchmarks', () => {
  it('runs built-in suite', () => {
    const suite = runBenchmarks();
    assert.ok(suite.results.length >= 5);
    assert.ok(suite.successRate >= 0.8);
  });
});

describe('scheduler', () => {
  it('isolates mutations', () => {
    const batch = selectBatch(
      [
        { id: 'a', dependencies: [], status: 'pending', mutates: true },
        { id: 'b', dependencies: [], status: 'pending', mutates: true },
      ],
      2
    );
    assert.equal(batch.filter((x) => x.mutates).length, 1);
  });
});
