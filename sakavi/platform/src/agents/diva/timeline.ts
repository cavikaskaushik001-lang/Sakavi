/**
 * Execution timeline — observability without secrets.
 */

import type { DivaTaskState, PipelineStage, TimelineEvent } from './types.js';

const SECRET_RE =
  /\b(api[_-]?key|secret|password|token|ghp_[a-z0-9]+|sk-[a-z0-9]+)\b/gi;

function scrub(msg: string): string {
  return msg.replace(SECRET_RE, '[REDACTED]').slice(0, 500);
}

export function pushTimeline(
  state: DivaTaskState,
  stage: PipelineStage | 'CONTROL',
  message: string,
  meta?: TimelineEvent['meta']
): void {
  state.timeline.push({
    at: new Date().toISOString(),
    stage,
    message: scrub(message),
    meta,
  });
  // Bound memory
  if (state.timeline.length > 200) {
    state.timeline.splice(0, state.timeline.length - 200);
  }
  state.updatedAt = new Date().toISOString();
}

export function formatTimeline(state: DivaTaskState): string {
  return state.timeline
    .map((e) => `${e.at} [${e.stage}] ${e.message}`)
    .join('\n');
}
