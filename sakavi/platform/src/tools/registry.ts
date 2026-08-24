/**
 * Unified tool registry — permanent catalogue of tools for DIVA.
 * Invocation still requires Tool Gateway + Policy + Capability grant.
 */

import { z } from 'zod';
import type { CatalogueCapability } from '../core/capability-catalogue.js';
import type { RiskLevel } from '../core/types.js';

export interface ToolDefinition {
  name: string;
  description: string;
  capability: CatalogueCapability;
  risk: RiskLevel;
  timeoutMs: number;
  category:
    | 'filesystem'
    | 'shell'
    | 'git'
    | 'github'
    | 'database'
    | 'browser'
    | 'network'
    | 'cloud'
    | 'deployment'
    | 'security'
    | 'debugging'
    | 'monitoring'
    | 'artifacts'
    | 'orchestration';
  inputSchema: z.ZodTypeAny;
  /** Human-readable output shape */
  outputDescription: string;
  resourceHints?: { memoryMb?: number; network?: boolean };
}

const str = z.string();
const optStr = z.string().optional();

/** Complete tool universe (definitions only — handlers in register.ts) */
export const TOOL_REGISTRY: readonly ToolDefinition[] = Object.freeze([
  // filesystem
  {
    name: 'filesystem.read',
    description: 'Read a file under /workspace',
    capability: 'filesystem.read',
    risk: 'LOW',
    timeoutMs: 30_000,
    category: 'filesystem',
    inputSchema: z.object({ path: str, sandboxId: optStr }),
    outputDescription: '{ content: string }',
  },
  {
    name: 'filesystem.write',
    description: 'Write a file under /workspace',
    capability: 'filesystem.write',
    risk: 'MEDIUM',
    timeoutMs: 30_000,
    category: 'filesystem',
    inputSchema: z.object({ path: str, content: str, sandboxId: optStr }),
    outputDescription: '{ ok: true }',
  },
  {
    name: 'filesystem.search',
    description: 'Search files for a pattern',
    capability: 'filesystem.search',
    risk: 'LOW',
    timeoutMs: 60_000,
    category: 'filesystem',
    inputSchema: z.object({ pattern: str, path: optStr, sandboxId: optStr }),
    outputDescription: '{ matches: string[] }',
  },
  // shell / process
  {
    name: 'sandbox.create',
    description: 'Create isolated sandbox for project',
    capability: 'process.execute',
    risk: 'MEDIUM',
    timeoutMs: 60_000,
    category: 'shell',
    inputSchema: z.object({
      projectPath: str,
      networkMode: z.enum(['none', 'bridge']).optional(),
    }),
    outputDescription: '{ sandboxId: string }',
  },
  {
    name: 'sandbox.execute',
    description: 'Execute command in sandbox',
    capability: 'process.execute',
    risk: 'MEDIUM',
    timeoutMs: 180_000,
    category: 'shell',
    inputSchema: z.object({
      sandboxId: str,
      command: str,
      timeoutMs: z.number().optional(),
    }),
    outputDescription: '{ stdout, stderr, exitCode, executionTimeMs }',
  },
  {
    name: 'sandbox.destroy',
    description: 'Destroy sandbox',
    capability: 'process.execute',
    risk: 'LOW',
    timeoutMs: 30_000,
    category: 'shell',
    inputSchema: z.object({ sandboxId: str }),
    outputDescription: '{ destroyed: true }',
  },
  {
    name: 'process.inspect',
    description: 'Inspect sandbox process list',
    capability: 'process.inspect',
    risk: 'LOW',
    timeoutMs: 15_000,
    category: 'shell',
    inputSchema: z.object({ sandboxId: str }),
    outputDescription: '{ processes: string }',
  },
  // git
  {
    name: 'git.status',
    description: 'git status in workspace',
    capability: 'git.read',
    risk: 'LOW',
    timeoutMs: 15_000,
    category: 'git',
    inputSchema: z.object({ sandboxId: str }),
    outputDescription: '{ status: string }',
  },
  {
    name: 'git.diff',
    description: 'git diff',
    capability: 'git.read',
    risk: 'LOW',
    timeoutMs: 30_000,
    category: 'git',
    inputSchema: z.object({ sandboxId: str, ref: optStr }),
    outputDescription: '{ diff: string }',
  },
  {
    name: 'git.log',
    description: 'git log summary',
    capability: 'git.read',
    risk: 'LOW',
    timeoutMs: 15_000,
    category: 'git',
    inputSchema: z.object({ sandboxId: str, n: z.number().optional() }),
    outputDescription: '{ log: string }',
  },
  // github
  {
    name: 'github.status',
    description: 'GitHub connection status (no token returned)',
    capability: 'github.read',
    risk: 'LOW',
    timeoutMs: 15_000,
    category: 'github',
    inputSchema: z.object({}),
    outputDescription: '{ connected: boolean }',
  },
  {
    name: 'github.list_tree',
    description: 'List repo tree',
    capability: 'github.read',
    risk: 'LOW',
    timeoutMs: 30_000,
    category: 'github',
    inputSchema: z.object({ ref: optStr }),
    outputDescription: '{ files: string[] }',
  },
  {
    name: 'github.read_file',
    description: 'Read file from GitHub',
    capability: 'github.read',
    risk: 'LOW',
    timeoutMs: 30_000,
    category: 'github',
    inputSchema: z.object({ path: str, ref: optStr }),
    outputDescription: '{ path, content }',
  },
  {
    name: 'github.create_branch',
    description: 'Create feature branch',
    capability: 'github.write',
    risk: 'HIGH',
    timeoutMs: 30_000,
    category: 'github',
    inputSchema: z.object({ task: optStr, base: optStr, name: optStr }),
    outputDescription: '{ branch, base }',
  },
  {
    name: 'github.upsert_file',
    description: 'Create/update file on feature branch',
    capability: 'github.write',
    risk: 'HIGH',
    timeoutMs: 30_000,
    category: 'github',
    inputSchema: z.object({ path: str, content: str, branch: str, message: str }),
    outputDescription: '{ ok, path, branch }',
  },
  {
    name: 'github.create_pr',
    description: 'Open draft PR',
    capability: 'github.pull_request',
    risk: 'HIGH',
    timeoutMs: 30_000,
    category: 'github',
    inputSchema: z.object({
      head: str,
      base: optStr,
      title: str,
      body: optStr,
      draft: z.boolean().optional(),
    }),
    outputDescription: '{ url, head, base }',
  },
  {
    name: 'github.issue',
    description: 'Create or comment on issue',
    capability: 'github.issue',
    risk: 'MEDIUM',
    timeoutMs: 30_000,
    category: 'github',
    inputSchema: z.object({
      title: optStr,
      body: str,
      issueNumber: z.number().optional(),
    }),
    outputDescription: '{ ok, number? }',
  },
  // database
  {
    name: 'database.query',
    description: 'Run SQL under capability tier',
    capability: 'database.read',
    risk: 'MEDIUM',
    timeoutMs: 30_000,
    category: 'database',
    inputSchema: z.object({ sql: str, approvalId: optStr }),
    outputDescription: '{ rows?, rowsAffected? }',
  },
  {
    name: 'database.schema',
    description: 'Inspect schema',
    capability: 'database.schema',
    risk: 'LOW',
    timeoutMs: 30_000,
    category: 'database',
    inputSchema: z.object({ table: optStr }),
    outputDescription: '{ tables: string[] }',
  },
  // network / browser
  {
    name: 'network.fetch',
    description: 'Allowlisted HTTP fetch',
    capability: 'network.request',
    risk: 'MEDIUM',
    timeoutMs: 30_000,
    category: 'network',
    inputSchema: z.object({ url: str }),
    outputDescription: '{ status, body }',
    resourceHints: { network: true },
  },
  {
    name: 'browser.navigate',
    description: 'Navigate allowlisted URL',
    capability: 'browser.use',
    risk: 'MEDIUM',
    timeoutMs: 45_000,
    category: 'browser',
    inputSchema: z.object({ url: str }),
    outputDescription: '{ ok, url }',
    resourceHints: { network: true },
  },
  {
    name: 'browser.snapshot',
    description: 'Capture page text (untrusted)',
    capability: 'browser.use',
    risk: 'MEDIUM',
    timeoutMs: 45_000,
    category: 'browser',
    inputSchema: z.object({ url: str }),
    outputDescription: '{ text, untrusted: true }',
  },
  // cloud / deployment
  {
    name: 'cloud.describe',
    description: 'Read cloud resource metadata',
    capability: 'cloud.read',
    risk: 'MEDIUM',
    timeoutMs: 30_000,
    category: 'cloud',
    inputSchema: z.object({ resource: str }),
    outputDescription: '{ metadata }',
  },
  {
    name: 'deployment.plan',
    description: 'Create deployment plan',
    capability: 'deployment.request',
    risk: 'HIGH',
    timeoutMs: 60_000,
    category: 'deployment',
    inputSchema: z.object({
      planId: str,
      environment: str,
      projectPath: str,
    }),
    outputDescription: '{ planId, steps }',
  },
  {
    name: 'deployment.execute',
    description: 'Execute approved deployment',
    capability: 'deployment.execute',
    risk: 'CRITICAL',
    timeoutMs: 300_000,
    category: 'deployment',
    inputSchema: z.object({
      planId: str,
      approvalId: str,
      environment: str,
    }),
    outputDescription: '{ deployed }',
  },
  {
    name: 'deployment.health',
    description: 'Post-deploy health check',
    capability: 'deployment.request',
    risk: 'MEDIUM',
    timeoutMs: 60_000,
    category: 'deployment',
    inputSchema: z.object({ environment: str, planId: str }),
    outputDescription: '{ ok }',
  },
  // security
  {
    name: 'security.scan',
    description: 'Passive security scan',
    capability: 'security.scan',
    risk: 'LOW',
    timeoutMs: 120_000,
    category: 'security',
    inputSchema: z.object({ projectPath: optStr }),
    outputDescription: '{ findings }',
  },
  {
    name: 'security.research',
    description: 'Authorized security research run',
    capability: 'security.scan',
    risk: 'MEDIUM',
    timeoutMs: 300_000,
    category: 'security',
    inputSchema: z.object({
      scope: z.record(z.unknown()),
      files: z.array(z.object({ path: str, content: str })).optional(),
    }),
    outputDescription: '{ findings, reportMarkdown }',
  },
  // debugging
  {
    name: 'debug.session',
    description: 'Structured debug session',
    capability: 'process.execute',
    risk: 'MEDIUM',
    timeoutMs: 300_000,
    category: 'debugging',
    inputSchema: z.object({
      projectPath: str,
      failingCommand: optStr,
      logs: z.array(str).optional(),
      stackTrace: optStr,
    }),
    outputDescription: '{ rootCause, verification, regressionTest }',
  },
  {
    name: 'debug.typecheck',
    description: 'Run TypeScript check in sandbox',
    capability: 'process.execute',
    risk: 'LOW',
    timeoutMs: 180_000,
    category: 'debugging',
    inputSchema: z.object({ sandboxId: str }),
    outputDescription: '{ stdout, exitCode }',
  },
  {
    name: 'debug.test',
    description: 'Run tests in sandbox',
    capability: 'process.execute',
    risk: 'LOW',
    timeoutMs: 300_000,
    category: 'debugging',
    inputSchema: z.object({ sandboxId: str, command: optStr }),
    outputDescription: '{ stdout, exitCode }',
  },
  // monitoring / logs / artifacts
  {
    name: 'logs.read',
    description: 'Read recent logs (authorized)',
    capability: 'logs.read',
    risk: 'LOW',
    timeoutMs: 30_000,
    category: 'monitoring',
    inputSchema: z.object({ source: str, lines: z.number().optional() }),
    outputDescription: '{ lines: string[] }',
  },
  {
    name: 'monitoring.health',
    description: 'Read service health',
    capability: 'monitoring.read',
    risk: 'LOW',
    timeoutMs: 15_000,
    category: 'monitoring',
    inputSchema: z.object({ service: str }),
    outputDescription: '{ ok, detail }',
  },
  {
    name: 'artifact.create',
    description: 'Create report/artifact metadata',
    capability: 'artifact.create',
    risk: 'LOW',
    timeoutMs: 15_000,
    category: 'artifacts',
    inputSchema: z.object({ name: str, content: str }),
    outputDescription: '{ id, name }',
  },
  // orchestration
  {
    name: 'agent.delegate',
    description: 'Record delegation / plan step',
    capability: 'agent.delegate',
    risk: 'MEDIUM',
    timeoutMs: 15_000,
    category: 'orchestration',
    inputSchema: z.object({ steps: z.array(z.string()).optional() }),
    outputDescription: '{ recorded: true }',
  },
  {
    name: 'research.search',
    description: 'External research (untrusted)',
    capability: 'research.query',
    risk: 'LOW',
    timeoutMs: 30_000,
    category: 'network',
    inputSchema: z.object({ query: str }),
    outputDescription: '{ snippet, untrusted: true }',
    resourceHints: { network: true },
  },
]);

const byName = new Map(TOOL_REGISTRY.map((t) => [t.name, t]));

export function getTool(name: string): ToolDefinition | undefined {
  return byName.get(name);
}

export function listTools(category?: ToolDefinition['category']): ToolDefinition[] {
  return category
    ? TOOL_REGISTRY.filter((t) => t.category === category)
    : [...TOOL_REGISTRY];
}

export function toolsForCapability(cap: CatalogueCapability): ToolDefinition[] {
  return TOOL_REGISTRY.filter((t) => t.capability === cap);
}

/** Permanent summary for DIVA context bootstrap */
export function divaToolSummary(): string {
  return TOOL_REGISTRY.map(
    (t) => `${t.name} → ${t.capability} [${t.risk}] — ${t.description}`
  ).join('\n');
}

export function validateToolInput(name: string, args: unknown): unknown {
  const tool = byName.get(name);
  if (!tool) throw new Error(`Unknown tool: ${name}`);
  return tool.inputSchema.parse(args);
}
