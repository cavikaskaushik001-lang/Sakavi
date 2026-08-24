/**
 * Debug session unit tests (no Docker).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeErrorText } from '../../src/debug/error-analyzer.js';
import { parseStackTrace, likelyAppFrames } from '../../src/debug/stacktrace.js';
import { classifyRuntimeFailure } from '../../src/debug/runtime-analyzer.js';
import { verifyFix } from '../../src/debug/verifier.js';
import { suggestRegressionTest } from '../../src/debug/regression.js';

describe('error analyzer', () => {
  it('extracts MODULE_NOT_FOUND facts', () => {
    const p = analyzeErrorText("Error: Cannot find module 'foo'\n");
    assert.ok(p.facts.some((f) => /Missing module/i.test(f)));
  });
});

describe('stack trace', () => {
  it('parses frames and prefers app code', () => {
    const stack = `Error: x
    at Object.handler (/app/src/api.ts:10:5)
    at Module._load (node:internal/modules/cjs/loader:1:1)
    at foo (/app/node_modules/lib/index.js:2:2)`;
    const frames = parseStackTrace(stack);
    assert.ok(frames.length >= 1);
    const app = likelyAppFrames(frames);
    assert.ok(app.some((f) => f.file?.includes('/app/src/')));
  });
});

describe('runtime class', () => {
  it('detects compile vs test', () => {
    assert.equal(classifyRuntimeFailure('TS2345: Type error'), 'compile');
    assert.equal(classifyRuntimeFailure('AssertionError: expected 1'), 'test');
  });
});

describe('verify fix', () => {
  it('rejects when original command still fails', () => {
    const v = verifyFix({
      beforeOutput: 'err',
      afterOutput: 'err',
      testsPassed: true,
      originalCommandRerunOk: false,
    });
    assert.equal(v.fixed, false);
  });

  it('requires tests green', () => {
    const v = verifyFix({
      beforeOutput: 'err',
      afterOutput: 'ok',
      testsPassed: false,
      originalCommandRerunOk: true,
    });
    assert.equal(v.fixed, false);
  });
});

describe('regression suggestion', () => {
  it('returns actionable text', () => {
    const s = suggestRegressionTest({
      symptom: 'login throws',
      rootCause: 'null user',
    });
    assert.match(s, /regression/i);
  });
});
