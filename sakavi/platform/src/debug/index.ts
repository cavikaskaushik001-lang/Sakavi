/**
 * Debugging workflow:
 * Reproduce → Capture → Localize → Hypothesize → (minimal fix via agents) →
 * Retest → Regression → Report
 *
 * Does not rewrite large codebases by default; prefers smallest safe change.
 */

import { randomUUID } from 'node:crypto';
import { killSwitch } from '../core/kill-switch.js';
import { emitAudit } from '../core/audit.js';
import { analyzeErrorText } from './error-analyzer.js';
import { parseStackTrace, likelyAppFrames } from './stacktrace.js';
import { analyzeDependencySignals } from './dependency-analyzer.js';
import { classifyRuntimeFailure, runtimeGuidance } from './runtime-analyzer.js';
import { suggestRegressionTest, rememberFailure, knownFailures } from './regression.js';
import { verifyFix } from './verifier.js';
import type { DebugInput, DebugReport, DebugHypothesis } from './types.js';
import { runCoder } from '../agents/coder/index.js';

export type { DebugInput, DebugReport, DebugScope } from './types.js';

export async function runDebugSession(input: DebugInput): Promise<DebugReport> {
  const taskId = randomUUID();
  killSwitch.assertNotActive();

  emitAudit({
    agentId: 'coder',
    taskId,
    userId: input.userId,
    tool: 'debug.session.start',
    capability: 'workspace.read',
    resultStatus: 'ok',
    riskLevel: 'LOW',
    meta: { objective: input.objective.slice(0, 200) },
  });

  const observedFacts: string[] = [];
  const hypotheses: DebugHypothesis[] = [];
  const logs = [...(input.logs || [])];
  if (input.stackTrace) logs.push(input.stackTrace);
  const blob = logs.join('\n') || input.objective;

  // 1–2 Reproduce / capture (from provided evidence)
  const parsed = analyzeErrorText(blob);
  observedFacts.push(...parsed.facts);

  const frames = input.stackTrace ? likelyAppFrames(parseStackTrace(input.stackTrace)) : [];
  const executionPath = frames.map(
    (f) => `${f.file || '?'}:${f.line || '?'}${f.functionName ? `#${f.functionName}` : ''}`
  );
  if (executionPath.length) {
    observedFacts.push(`App stack frames: ${executionPath.slice(0, 5).join(' → ')}`);
  }

  // 3 Localize
  const runtimeClass = classifyRuntimeFailure(blob);
  observedFacts.push(`Runtime class: ${runtimeClass}`);
  observedFacts.push(runtimeGuidance(runtimeClass));

  const dep = analyzeDependencySignals({ errorText: blob });
  observedFacts.push(...dep.facts);
  for (const h of dep.hypotheses) {
    hypotheses.push({
      id: randomUUID().slice(0, 6),
      statement: h,
      status: 'open',
      evidence: dep.facts,
    });
  }

  if (parsed.fileHints.length) {
    hypotheses.push({
      id: randomUUID().slice(0, 6),
      statement: `Defect likely near ${parsed.fileHints[0]}:${parsed.lineHints[0] || '?'}`,
      status: 'open',
      evidence: parsed.fileHints,
    });
  }

  // 4–5 Root cause (stated carefully)
  let rootCause =
    'Root cause not confirmed — insufficient runtime reproduction in this session';
  let conclusions: string[] = [];

  // Optional: run failing command inside sandbox via coder agent (authorized project path)
  let reproduction = 'No automated reproduction executed';
  let verification = 'Not verified';
  let fixSummary = 'No code change applied in this session';
  let beforeAfter: DebugReport['beforeAfter'];

  if (input.scope.projectPath && input.scope.failingCommand) {
    const run = await runCoder({
      userId: input.userId,
      objective: `Reproduce: ${input.scope.failingCommand}`,
      projectPath: input.scope.projectPath,
      allowNetwork: false,
    });
    reproduction = run.summary;
    observedFacts.push(`Coder/sandbox reproduction status: ${run.status}`);
    if (run.testResults) {
      observedFacts.push(`Test output excerpt: ${run.testResults.slice(0, 300)}`);
    }

    // Minimal fix is delegated — we do not bulk-rewrite here
    if (run.status === 'completed') {
      const v = verifyFix({
        beforeOutput: blob.slice(0, 200),
        afterOutput: run.testResults || run.summary,
        testsPassed: run.status === 'completed',
        originalCommandRerunOk: run.status === 'completed',
      });
      verification = v.detail;
      observedFacts.push(...v.observedFacts);
      if (v.fixed) {
        // Still: one green run ≠ deep root cause certainty
        rootCause =
          hypotheses[0]?.statement ||
          'Symptom no longer reproduced in sandbox; confirm with regression test';
        conclusions.push('Sandbox run succeeded after investigation path');
        conclusions.push('Do not close until regression test is added and CI is green');
        fixSummary =
          'Investigation completed in sandbox; apply minimal patch on feature branch via GitHub agent';
        beforeAfter = { before: blob.slice(0, 400), after: (run.testResults || '').slice(0, 400) };
        for (const h of hypotheses) h.status = 'supported';
      } else {
        conclusions.push('Failure still present or tests not fully green');
      }
    }
  } else {
    conclusions.push(
      'Provide scope.failingCommand + projectPath for automated reproduction in sandbox'
    );
  }

  const regressionTest = suggestRegressionTest({
    symptom: parsed.message,
    parsed,
    rootCause,
  });

  rememberFailure(input.scope.projectPath, parsed.message);
  const past = knownFailures(input.scope.projectPath);
  if (past.length > 1) {
    observedFacts.push(`Prior failure signatures in project: ${past.length}`);
  }

  return {
    taskId,
    status: 'completed',
    symptom: parsed.message,
    reproduction,
    executionPath,
    rootCause,
    contributingFactors: hypotheses.map((h) => h.statement),
    fixSummary,
    regressionTest,
    verification,
    observedFacts,
    hypotheses,
    conclusions,
    beforeAfter,
  };
}

export {
  analyzeErrorText,
  parseStackTrace,
  classifyRuntimeFailure,
  verifyFix,
  suggestRegressionTest,
};
