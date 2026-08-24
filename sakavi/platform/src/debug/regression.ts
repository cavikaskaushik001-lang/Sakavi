/**
 * Regression test suggestions — never claim fixed without retest.
 */

import type { ParsedError } from './error-analyzer.js';

export function suggestRegressionTest(params: {
  symptom: string;
  parsed?: ParsedError;
  rootCause: string;
}): string {
  const file = params.parsed?.fileHints[0];
  const base = params.symptom.slice(0, 80).replace(/\s+/g, ' ');
  if (file) {
    return (
      `Add a focused test covering "${base}" near ${file}; ` +
      `assert the failure mode (${params.rootCause.slice(0, 60)}) cannot recur; ` +
      `run the same command that originally failed.`
    );
  }
  return (
    `Add regression test for: ${base}. ` +
    `Reproduce original failing command; assert expected behavior after fix.`
  );
}

/** Project-scoped memory of past failures */
const pastFailures = new Map<string, string[]>();

export function rememberFailure(projectKey: string, signature: string): void {
  const list = pastFailures.get(projectKey) || [];
  if (!list.includes(signature)) list.push(signature.slice(0, 200));
  pastFailures.set(projectKey, list.slice(-50));
}

export function knownFailures(projectKey: string): string[] {
  return pastFailures.get(projectKey) || [];
}
