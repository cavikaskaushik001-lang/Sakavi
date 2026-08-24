/**
 * Stack trace localization helpers.
 */

export interface StackFrame {
  functionName?: string;
  file?: string;
  line?: number;
  column?: number;
  raw: string;
}

export function parseStackTrace(stack: string): StackFrame[] {
  const frames: StackFrame[] = [];
  for (const line of stack.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('at ')) continue;
    // at fn (file:line:col) OR at file:line:col
    const withFn = trimmed.match(/^at\s+(.+?)\s+\((.+):(\d+):(\d+)\)$/);
    if (withFn) {
      frames.push({
        functionName: withFn[1],
        file: withFn[2],
        line: parseInt(withFn[3], 10),
        column: parseInt(withFn[4], 10),
        raw: trimmed,
      });
      continue;
    }
    const bare = trimmed.match(/^at\s+(.+):(\d+):(\d+)$/);
    if (bare) {
      frames.push({
        file: bare[1],
        line: parseInt(bare[2], 10),
        column: parseInt(bare[3], 10),
        raw: trimmed,
      });
    }
  }
  return frames;
}

/** Prefer application frames over node_internals */
export function likelyAppFrames(frames: StackFrame[]): StackFrame[] {
  return frames.filter(
    (f) =>
      f.file &&
      !f.file.includes('node:internal') &&
      !f.file.includes('node_modules')
  );
}
