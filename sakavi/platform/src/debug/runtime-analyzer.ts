/**
 * Runtime failure categorization for recovery guidance.
 */

export type RuntimeClass =
  | 'compile'
  | 'test'
  | 'network'
  | 'filesystem'
  | 'config'
  | 'logic'
  | 'unknown';

export function classifyRuntimeFailure(text: string): RuntimeClass {
  if (/SyntaxError|TS\d{4}|Type error|failed to compile/i.test(text)) return 'compile';
  if (/FAIL|AssertionError|expected|test failed/i.test(text)) return 'test';
  if (/ECONNREFUSED|ENOTFOUND|fetch failed|socket/i.test(text)) return 'network';
  if (/ENOENT|EACCES|EPERM|filesystem/i.test(text)) return 'filesystem';
  if (/config|env|undefined.*process\.env/i.test(text)) return 'config';
  if (/TypeError|ReferenceError|RangeError/i.test(text)) return 'logic';
  return 'unknown';
}

export function runtimeGuidance(c: RuntimeClass): string {
  switch (c) {
    case 'compile':
      return 'Fix type/syntax at indicated file:line; re-run typecheck/build';
    case 'test':
      return 'Isolate failing test; prefer fix production code over deleting assertions';
    case 'network':
      return 'Check service availability and allowlists; do not broaden network policy casually';
    case 'filesystem':
      return 'Validate paths stay in workspace; check permissions inside sandbox';
    case 'config':
      return 'Verify required env vars via secret provider — never hardcode secrets';
    case 'logic':
      return 'Add minimal reproduction; assert invariants; patch smallest surface';
    default:
      return 'Gather more evidence before large refactors';
  }
}
