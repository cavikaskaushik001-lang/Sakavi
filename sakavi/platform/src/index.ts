/**
 * Sakavi Agent Platform — bootstrap
 *
 * DIVA → Capability Manager → Policy Engine → Tool Gateway → Specialists / Sandbox
 */

import { toolGateway } from './core/tool-gateway.js';
import { registerAllTools } from './tools/register.js';
import {
  getTaskToolCount,
  incrementTaskToolCount,
  isNetworkEnabled,
} from './core/agent-base.js';
import { secretProvider } from './core/secrets.js';
import { killSwitch } from './core/kill-switch.js';
import { approvalService } from './core/approval.js';
import { capabilityManager } from './core/capability-manager.js';
import { policyEngine } from './core/policy-engine.js';
import { getAuditSink, setAuditSink, MemoryAuditSink } from './core/audit.js';

import { CODER_MANIFEST } from './agents/coder/index.js';
import { GITHUB_MANIFEST } from './agents/github/index.js';
import { RESEARCH_MANIFEST } from './agents/research/index.js';
import { BROWSER_MANIFEST } from './agents/browser/index.js';
import { DATABASE_MANIFEST } from './agents/database/index.js';
import { DEPLOYMENT_MANIFEST } from './agents/deployment/index.js';
import { SECURITY_MANIFEST } from './agents/security/index.js';
import { DIVA_MANIFEST } from './agents/diva/index.js';

import type { AgentId, AgentManifest } from './core/types.js';

const MANIFESTS: Record<AgentId, AgentManifest> = {
  diva: DIVA_MANIFEST,
  coder: CODER_MANIFEST,
  github: GITHUB_MANIFEST,
  research: RESEARCH_MANIFEST,
  browser: BROWSER_MANIFEST,
  database: DATABASE_MANIFEST,
  deployment: DEPLOYMENT_MANIFEST,
  security: SECURITY_MANIFEST,
};

let initialized = false;

export function initPlatform(opts: { loadEnvSecrets?: boolean } = {}): void {
  if (initialized) return;

  registerAllTools();

  toolGateway.setContext({
    getManifest: (id) => MANIFESTS[id],
    getTaskToolCount,
    incrementTaskToolCount,
    isNetworkEnabled,
  });

  if (opts.loadEnvSecrets !== false) {
    secretProvider.loadFromEnv([
      'GITHUB_TOKEN',
      'OPENAI_API_KEY',
      'DATABASE_URL',
      'DEPLOY_TOKEN',
    ]);
  }

  initialized = true;
}

export function getManifest(agentId: AgentId): AgentManifest {
  return MANIFESTS[agentId];
}

export function listManifests(): AgentManifest[] {
  return Object.values(MANIFESTS);
}

// Re-exports for consumers
export { toolGateway, killSwitch, approvalService, capabilityManager, policyEngine };
export { secretProvider, getAuditSink, setAuditSink, MemoryAuditSink };
export {
  runDiva,
  DIVA_MANIFEST,
  pauseTask,
  resumeTask,
  cancelTask,
  emergencyStop,
  getDivaTask,
  getTaskTimeline,
} from './agents/diva/index.js';
export type { DivaInput, DivaOutput, DivaTaskState, PlanStep } from './agents/diva/index.js';
export { runCoder, CODER_MANIFEST } from './agents/coder/index.js';
export { runGithub, GITHUB_MANIFEST } from './agents/github/index.js';
export { runResearch, RESEARCH_MANIFEST } from './agents/research/index.js';
export { runBrowser, BROWSER_MANIFEST } from './agents/browser/index.js';
export { runDatabase, DATABASE_MANIFEST } from './agents/database/index.js';
export { runDeployment, DEPLOYMENT_MANIFEST } from './agents/deployment/index.js';
export { runSecurity, SECURITY_MANIFEST } from './agents/security/index.js';
export { sandboxService } from './sandbox/index.js';
export * from './core/types.js';
export * from './core/errors.js';


// Security research & debugging specialization
export {
  runSecurityResearch,
  assertScope,
  scanFiles,
  findingsToMarkdown,
  getProjectSecurityKnowledge,
  recordFixedFinding,
} from './security/index.js';
export type {
  SecurityScope,
  SecurityFinding,
  SecurityTaskInput,
  SecurityTaskResult,
} from './security/index.js';

export {
  runDebugSession,
  analyzeErrorText,
  parseStackTrace,
  classifyRuntimeFailure,
  verifyFix,
  suggestRegressionTest,
} from './debug/index.js';
export type { DebugInput, DebugReport, DebugScope } from './debug/index.js';


// Permanent catalogues
export {
  CAPABILITY_CATALOGUE,
  listCapabilities,
  getCapability,
  divaCapabilitySummary,
} from './core/capability-catalogue.js';
export {
  TOOL_REGISTRY,
  listTools,
  getTool,
  divaToolSummary,
  validateToolInput,
} from './tools/registry.js';

// Memory & verification
export { memoryWrite, memoryQuery, memorySummary } from './memory/index.js';
export {
  verifyCodeChanges,
  verifySecurityRemediation,
  verifyDeployment,
  fromExitCode,
} from './verification/index.js';

// Extra specialists
export { runDebugger, DEBUGGER_MANIFEST } from './agents/debugger/index.js';
export { runResearcher, RESEARCHER_MANIFEST } from './agents/researcher/index.js';
export { runInfrastructure, INFRASTRUCTURE_MANIFEST } from './agents/infrastructure/index.js';
export { runMonitoring, MONITORING_MANIFEST } from './agents/monitoring/index.js';


// DIVA V3 subsystems
export * from './core/task-engine/index.js';
export * from './core/evidence/index.js';
export { evaluateStage, recordCalibration, calibrationSummary } from './core/self-evaluation.js';
export { ProjectGraph, getOrCreateGraph, impactAnalysis } from './project/graph.js';
export { registerBench, runBenchmarks, loadLatestBench } from './evaluation/benchmark.js';
import './evaluation/cases.js';
export { buildFinalReport, scoreQuality } from './agents/diva/v3-report.js';


// Self-engineering (isolated workflow; protected core not auto-activated)
export { selfDiagnose, selfAudit, SELF_ENGINEER_MANIFEST } from './agents/self-engineer/index.js';
export { reviewSelfChange, SELF_REVIEWER_MANIFEST } from './agents/self-reviewer/index.js';
export { selfRepair } from './self-dev/workflow.js';
export { isProtectedPath, filterWritablePaths } from './self-dev/protected.js';
export { DEFAULT_SELF_DEV_BUDGET } from './self-dev/budget.js';
