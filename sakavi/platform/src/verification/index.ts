/**
 * Independent verification layer.
 * attempted ≠ successful ≠ verified
 */

export type VerificationPhase =
  | 'attempted'
  | 'successful'
  | 'verified'
  | 'failed';

export interface VerificationStepResult {
  name: string;
  phase: VerificationPhase;
  detail: string;
  exitCode?: number;
}

export interface VerificationReport {
  overall: VerificationPhase;
  steps: VerificationStepResult[];
  summary: string;
}

export function verifyCodeChanges(params: {
  typecheckOk?: boolean;
  lintOk?: boolean;
  unitTestsOk?: boolean;
  integrationOk?: boolean;
  buildOk?: boolean;
  diffReviewed?: boolean;
}): VerificationReport {
  const steps: VerificationStepResult[] = [
    step('typecheck', params.typecheckOk),
    step('lint', params.lintOk),
    step('unit_tests', params.unitTestsOk),
    step('integration_tests', params.integrationOk),
    step('build', params.buildOk),
    step('diff_review', params.diffReviewed),
  ];
  return summarize(steps, 'code');
}

export function verifySecurityRemediation(params: {
  reproduced?: boolean;
  remediated?: boolean;
  retested?: boolean;
  evidence?: boolean;
}): VerificationReport {
  const steps: VerificationStepResult[] = [
    step('reproduction', params.reproduced),
    step('evidence', params.evidence),
    step('remediation', params.remediated),
    step('retest', params.retested),
  ];
  return summarize(steps, 'security');
}

export function verifyDeployment(params: {
  deployed?: boolean;
  healthOk?: boolean;
  smokeOk?: boolean;
  monitoringOk?: boolean;
}): VerificationReport {
  const steps: VerificationStepResult[] = [
    step('deploy', params.deployed),
    step('health', params.healthOk),
    step('smoke', params.smokeOk),
    step('monitoring', params.monitoringOk),
  ];
  return summarize(steps, 'deployment');
}

function step(name: string, ok: boolean | undefined): VerificationStepResult {
  if (ok === undefined) {
    return { name, phase: 'attempted', detail: 'Not run' };
  }
  if (ok) {
    return { name, phase: 'verified', detail: 'Passed' };
  }
  return { name, phase: 'failed', detail: 'Failed' };
}

function summarize(steps: VerificationStepResult[], kind: string): VerificationReport {
  const failed = steps.filter((s) => s.phase === 'failed');
  const verified = steps.filter((s) => s.phase === 'verified');
  const attemptedOnly = steps.filter((s) => s.phase === 'attempted');
  let overall: VerificationPhase = 'attempted';
  if (failed.length) overall = 'failed';
  else if (verified.length && attemptedOnly.length === 0) overall = 'verified';
  else if (verified.length) overall = 'successful';
  return {
    overall,
    steps,
    summary: `${kind}: overall=${overall}; verified=${verified.length}; failed=${failed.length}; skipped=${attemptedOnly.length}`,
  };
}

/** Map command exit to verification phase */
export function fromExitCode(name: string, exitCode: number): VerificationStepResult {
  return {
    name,
    phase: exitCode === 0 ? 'verified' : 'failed',
    detail: `exit ${exitCode}`,
    exitCode,
  };
}
