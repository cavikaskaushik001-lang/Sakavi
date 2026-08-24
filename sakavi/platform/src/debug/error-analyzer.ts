/**
 * Parse error messages and logs into structured facts.
 */

export interface ParsedError {
  message: string;
  code?: string;
  fileHints: string[];
  lineHints: number[];
  facts: string[];
}

export function analyzeErrorText(text: string): ParsedError {
  const facts: string[] = [];
  const fileHints: string[] = [];
  const lineHints: number[] = [];

  const msg = text.split('\n')[0]?.slice(0, 500) || 'unknown error';
  facts.push(`Primary message: ${msg}`);

  // file:line patterns
  const locRe = /(?:at\s+)?([^\s():]+\.\w+):(\d+)(?::(\d+))?/g;
  let m: RegExpExecArray | null;
  while ((m = locRe.exec(text)) !== null) {
    fileHints.push(m[1]);
    lineHints.push(parseInt(m[2], 10));
  }

  if (/ENOENT/.test(text)) facts.push('Missing file or path (ENOENT)');
  if (/EADDRINUSE/.test(text)) facts.push('Port already in use');
  if (/TypeError/.test(text)) facts.push('TypeError category');
  if (/ReferenceError/.test(text)) facts.push('ReferenceError category');
  if (/SyntaxError/.test(text)) facts.push('SyntaxError category');
  if (/timeout|ETIMEDOUT/i.test(text)) facts.push('Timeout-related failure');
  if (/ECONNREFUSED/.test(text)) facts.push('Connection refused');
  if (/MODULE_NOT_FOUND|Cannot find module/.test(text)) facts.push('Missing module dependency');

  const codeMatch = text.match(/\b([A-Z][A-Z0-9_]{2,})\b/);
  return {
    message: msg,
    code: codeMatch?.[1],
    fileHints: [...new Set(fileHints)].slice(0, 20),
    lineHints: lineHints.slice(0, 20),
    facts,
  };
}
