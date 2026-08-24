/**
 * Permanent capability catalogue — DIVA always knows what exists.
 * Grants still go through Capability Manager + Policy Engine.
 * DIVA cannot add/remove/disable entries at runtime to expand authority.
 */

import type { RiskLevel } from './types.js';

export const CATALOGUE_CAPABILITIES = [
  'filesystem.read',
  'filesystem.write',
  'filesystem.search',
  'process.execute',
  'process.inspect',
  'git.read',
  'git.write',
  'github.read',
  'github.write',
  'github.pull_request',
  'github.issue',
  'database.read',
  'database.write',
  'database.schema',
  'network.request',
  'browser.use',
  'cloud.read',
  'cloud.write',
  'deployment.request',
  'security.scan',
  'security.test',
  'logs.read',
  'monitoring.read',
  'artifact.create',
  'artifact.modify',
  // retained from earlier model (aliases / orchestration)
  'workspace.read',
  'workspace.write',
  'process.execute',
  'network.read',
  'agent.delegate',
  'secrets.request',
  'database.destructive',
  'deployment.execute',
  'security.inspect',
  'research.query',
  'browser.navigate',
] as const;

export type CatalogueCapability = (typeof CATALOGUE_CAPABILITIES)[number];

export interface CatalogueEntry {
  id: CatalogueCapability;
  description: string;
  risk: RiskLevel;
  /** Whether human approval is typically required */
  approvalTypical: boolean;
  category: string;
}

/** Frozen catalogue — infrastructure, not model-writable */
export const CAPABILITY_CATALOGUE: readonly CatalogueEntry[] = Object.freeze([
  { id: 'filesystem.read', description: 'Read files in authorized workspace', risk: 'LOW', approvalTypical: false, category: 'filesystem' },
  { id: 'filesystem.write', description: 'Write/modify files in authorized workspace', risk: 'MEDIUM', approvalTypical: false, category: 'filesystem' },
  { id: 'filesystem.search', description: 'Search code/files in workspace', risk: 'LOW', approvalTypical: false, category: 'filesystem' },
  { id: 'process.execute', description: 'Run commands in isolated sandbox', risk: 'MEDIUM', approvalTypical: false, category: 'process' },
  { id: 'process.inspect', description: 'Inspect process state inside sandbox', risk: 'LOW', approvalTypical: false, category: 'process' },
  { id: 'git.read', description: 'Read git history/status/diff', risk: 'LOW', approvalTypical: false, category: 'git' },
  { id: 'git.write', description: 'Local git branch/commit on non-protected branches', risk: 'MEDIUM', approvalTypical: false, category: 'git' },
  { id: 'github.read', description: 'Read GitHub repos/PRs/issues via server token', risk: 'LOW', approvalTypical: false, category: 'github' },
  { id: 'github.write', description: 'Write files/branches on feature branches', risk: 'HIGH', approvalTypical: true, category: 'github' },
  { id: 'github.pull_request', description: 'Open/update pull requests', risk: 'HIGH', approvalTypical: true, category: 'github' },
  { id: 'github.issue', description: 'Manage GitHub issues', risk: 'MEDIUM', approvalTypical: false, category: 'github' },
  { id: 'database.read', description: 'Read-only SQL / schema inspect', risk: 'LOW', approvalTypical: false, category: 'database' },
  { id: 'database.write', description: 'Non-destructive writes/migrations', risk: 'HIGH', approvalTypical: true, category: 'database' },
  { id: 'database.schema', description: 'Inspect or plan schema changes', risk: 'MEDIUM', approvalTypical: false, category: 'database' },
  { id: 'database.destructive', description: 'DROP/TRUNCATE/destructive SQL', risk: 'CRITICAL', approvalTypical: true, category: 'database' },
  { id: 'network.request', description: 'Outbound HTTP to allowlisted hosts', risk: 'MEDIUM', approvalTypical: false, category: 'network' },
  { id: 'network.read', description: 'Alias for controlled outbound read', risk: 'MEDIUM', approvalTypical: false, category: 'network' },
  { id: 'browser.use', description: 'Controlled browser automation', risk: 'MEDIUM', approvalTypical: false, category: 'browser' },
  { id: 'browser.navigate', description: 'Navigate allowlisted URLs', risk: 'MEDIUM', approvalTypical: false, category: 'browser' },
  { id: 'cloud.read', description: 'Read cloud resource metadata', risk: 'MEDIUM', approvalTypical: false, category: 'cloud' },
  { id: 'cloud.write', description: 'Mutate cloud resources', risk: 'HIGH', approvalTypical: true, category: 'cloud' },
  { id: 'deployment.request', description: 'Create deployment plan', risk: 'HIGH', approvalTypical: true, category: 'deployment' },
  { id: 'deployment.execute', description: 'Execute approved deployment', risk: 'CRITICAL', approvalTypical: true, category: 'deployment' },
  { id: 'security.scan', description: 'Passive/static security analysis', risk: 'LOW', approvalTypical: false, category: 'security' },
  { id: 'security.test', description: 'Authorized dynamic security tests', risk: 'HIGH', approvalTypical: true, category: 'security' },
  { id: 'security.inspect', description: 'Inspect configs/permissions/sandbox', risk: 'LOW', approvalTypical: false, category: 'security' },
  { id: 'logs.read', description: 'Read application/infrastructure logs', risk: 'LOW', approvalTypical: false, category: 'observability' },
  { id: 'monitoring.read', description: 'Read metrics/health', risk: 'LOW', approvalTypical: false, category: 'observability' },
  { id: 'artifact.create', description: 'Create build artifacts/reports', risk: 'LOW', approvalTypical: false, category: 'artifacts' },
  { id: 'artifact.modify', description: 'Modify artifacts', risk: 'MEDIUM', approvalTypical: false, category: 'artifacts' },
  { id: 'workspace.read', description: 'Legacy alias filesystem.read', risk: 'LOW', approvalTypical: false, category: 'filesystem' },
  { id: 'workspace.write', description: 'Legacy alias filesystem.write', risk: 'MEDIUM', approvalTypical: false, category: 'filesystem' },
  { id: 'agent.delegate', description: 'Orchestrator delegation', risk: 'MEDIUM', approvalTypical: false, category: 'orchestration' },
  { id: 'secrets.request', description: 'Request secret injection to trusted handler', risk: 'CRITICAL', approvalTypical: true, category: 'secrets' },
  { id: 'research.query', description: 'External research (untrusted results)', risk: 'LOW', approvalTypical: false, category: 'research' },
] as const);

const byId = new Map(CAPABILITY_CATALOGUE.map((e) => [e.id, e]));

export function getCapability(id: string): CatalogueEntry | undefined {
  return byId.get(id as CatalogueCapability);
}

export function listCapabilities(): readonly CatalogueEntry[] {
  return CAPABILITY_CATALOGUE;
}

export function listCapabilitiesByCategory(category: string): CatalogueEntry[] {
  return CAPABILITY_CATALOGUE.filter((e) => e.category === category);
}

/** DIVA bootstrap knowledge — permanent, not rediscovered per task */
export function divaCapabilitySummary(): string {
  return CAPABILITY_CATALOGUE.map(
    (e) => `${e.id} [${e.risk}] ${e.description}${e.approvalTypical ? ' (approval typical)' : ''}`
  ).join('\n');
}
