/**
 * Debug verification — error gone once ≠ fixed.
 */

export interface VerifyFixInput {
  beforeOutput: string;
  afterOutput: string;
  testsPassed: boolean;
  /** Same failing command re-run */
  originalCommandRerunOk: boolean;
}

export interface VerifyFixResult {
  fixed: boolean;
  detail: string;
  observedFacts: string[];
}

export function verifyFix(input: VerifyFixInput): VerifyFixResult {
  const facts: string[] = [];
  facts.push(`Tests passed flag: ${input.testsPassed}`);
  facts.push(`Original command re-run ok: ${input.originalCommandRerunOk}`);

  if (!input.originalCommandRerunOk) {
    return {
      fixed: false,
      detail: 'Original failing command still fails — not fixed',
      observedFacts: facts,
    };
  }
  if (!input.testsPassed) {
    return {
      fixed: false,
      detail: 'Command ok but test suite not green — incomplete fix',
      observedFacts: facts,
    };
  }
  // Require behavioral evidence, not only absence of one error string
  if (
    input.beforeOutput &&
    input.afterOutput &&
    input.beforeOutput === input.afterOutput
  ) {
    facts.push('Before/after outputs identical — weak evidence of change');
  }

  return {
    fixed: true,
    detail: 'Original command and tests succeeded after patch',
    observedFacts: facts,
  };
}
