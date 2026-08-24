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
export { runDiva, DIVA_MANIFEST } from './agents/diva/index.js';
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
