/**
 * Debugger specialist — wraps structured debug session.
 */

import type { AgentManifest } from '../../core/types.js';
import { runDebugSession } from '../../debug/index.js';
import type { DebugInput, DebugReport } from '../../debug/types.js';

export const DEBUGGER_MANIFEST: AgentManifest = {
  id: 'coder', // maps to existing agent id space; logical name debugger
  name: 'Debugger',
  description: 'Reproduce, localize, hypothesize, minimal fix, retest',
  allowedCapabilities: [
    'workspace.read',
    'workspace.write',
    'process.execute',
    'git.read',
  ],
  maxToolCalls: 40,
  maxTaskDurationMs: 20 * 60 * 1000,
  maxRetries: 2,
  defaultTimeoutMs: 120_000,
};

export async function runDebugger(input: DebugInput): Promise<DebugReport> {
  return runDebugSession(input);
}

export default { manifest: DEBUGGER_MANIFEST, run: runDebugger };
