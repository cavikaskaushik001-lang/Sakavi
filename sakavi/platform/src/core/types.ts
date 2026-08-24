/**
 * Core types for Sakavi agent platform.
 * Strict capability model — no isAdmin boolean.
 */

import { z } from 'zod';

// ─── Capabilities ───────────────────────────────────────────────────────────

export const CAPABILITIES = [
  'workspace.read',
  'workspace.write',
  'process.execute',
  'network.read',
  'github.read',
  'github.write',
  'github.pull_request',
  'database.read',
  'database.write',
  'database.destructive',
  'deployment.request',
  'deployment.execute',
  'secrets.request',
  'browser.navigate',
  'research.query',
  'agent.delegate',
  'security.inspect',
] as const;

export type Capability = (typeof CAPABILITIES)[number];

export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export const CAPABILITY_RISK: Record<Capability, RiskLevel> = {
  'workspace.read': 'LOW',
  'workspace.write': 'MEDIUM',
  'process.execute': 'MEDIUM',
  'network.read': 'MEDIUM',
  'github.read': 'LOW',
  'github.write': 'HIGH',
  'github.pull_request': 'HIGH',
  'database.read': 'LOW',
  'database.write': 'HIGH',
  'database.destructive': 'CRITICAL',
  'deployment.request': 'HIGH',
  'deployment.execute': 'CRITICAL',
  'secrets.request': 'CRITICAL',
  'browser.navigate': 'MEDIUM',
  'research.query': 'LOW',
  'agent.delegate': 'MEDIUM',
  'security.inspect': 'LOW',
};

/** Capabilities that always require human approval before execution */
export const ALWAYS_APPROVE: ReadonlySet<Capability> = new Set([
  'database.destructive',
  'deployment.execute',
  'secrets.request',
]);

// ─── Agents ─────────────────────────────────────────────────────────────────

export const AGENT_IDS = [
  'diva',
  'coder',
  'github',
  'research',
  'browser',
  'database',
  'deployment',
  'security',
] as const;

export type AgentId = (typeof AGENT_IDS)[number];

export interface AgentManifest {
  id: AgentId;
  name: string;
  description: string;
  /** Capabilities this agent is allowed to request (policy still decides) */
  allowedCapabilities: readonly Capability[];
  /** Max concurrent tool calls */
  maxToolCalls: number;
  /** Max wall-clock ms per task */
  maxTaskDurationMs: number;
  /** Max retries for a single tool call */
  maxRetries: number;
  /** Default timeout per tool invocation */
  defaultTimeoutMs: number;
}

// ─── Task / request context ─────────────────────────────────────────────────

export interface AgentRequest {
  agentId: AgentId;
  taskId: string;
  userId: string;
  requestedCapability: Capability;
  scope: string;
  reason: string;
  parentAgentId?: AgentId;
  correlationId?: string;
}

export interface CapabilityGrant {
  id: string;
  capability: Capability;
  agentId: AgentId;
  taskId: string;
  scope: string;
  riskLevel: RiskLevel;
  issuedAt: string;
  expiresAt: string;
  approvalRequired: boolean;
  approvalStatus: 'not_required' | 'pending' | 'approved' | 'denied';
  approvedBy?: string;
  revoked: boolean;
}

export type ApprovalStatus = 'pending' | 'approved' | 'denied' | 'expired';

export interface ApprovalRequest {
  id: string;
  taskId: string;
  agentId: AgentId;
  capability: Capability;
  riskLevel: RiskLevel;
  reason: string;
  summary: string;
  scope: string;
  createdAt: string;
  expiresAt: string;
  status: ApprovalStatus;
  decidedBy?: string;
  decidedAt?: string;
}

export interface AuditEvent {
  id: string;
  agentId: AgentId | 'system';
  taskId: string;
  userId: string;
  tool: string;
  capability: Capability | null;
  timestamp: string;
  inputHash: string;
  resultStatus: 'ok' | 'error' | 'blocked' | 'timeout' | 'cancelled' | 'denied';
  riskLevel: RiskLevel | 'NONE';
  approvalRequired: boolean;
  approvalStatus: string;
  durationMs?: number;
  errorCode?: string;
  /** Never contains secrets — only redacted metadata */
  meta?: Record<string, string | number | boolean | null>;
}

export interface ToolInvocation {
  toolName: string;
  agentId: AgentId;
  taskId: string;
  userId: string;
  capability: Capability;
  scope: string;
  reason: string;
  args: unknown;
  timeoutMs?: number;
  parentAgentId?: AgentId;
  correlationId?: string;
}

export interface ToolResult<T = unknown> {
  ok: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
  };
  blocked?: boolean;
  durationMs: number;
  auditId: string;
}

export interface TaskState {
  taskId: string;
  userId: string;
  objective: string;
  status: 'pending' | 'running' | 'waiting_approval' | 'completed' | 'failed' | 'cancelled';
  createdAt: string;
  updatedAt: string;
  agentId: AgentId;
  steps: TaskStep[];
  toolCallCount: number;
  maxToolCalls: number;
  deadline: string;
  resultSummary?: string;
  error?: string;
}

export interface TaskStep {
  id: string;
  agentId: AgentId;
  description: string;
  status: 'pending' | 'running' | 'done' | 'failed' | 'skipped';
  capability?: Capability;
  resultPreview?: string;
  startedAt?: string;
  finishedAt?: string;
}

// ─── Zod schemas for runtime validation ─────────────────────────────────────

export const AgentRequestSchema = z.object({
  agentId: z.enum(AGENT_IDS),
  taskId: z.string().min(8).max(128),
  userId: z.string().min(1).max(128),
  requestedCapability: z.enum(CAPABILITIES),
  scope: z.string().max(1024),
  reason: z.string().min(1).max(2000),
  parentAgentId: z.enum(AGENT_IDS).optional(),
  correlationId: z.string().max(128).optional(),
});

export const ToolInvocationSchema = z.object({
  toolName: z.string().min(1).max(64),
  agentId: z.enum(AGENT_IDS),
  taskId: z.string().min(8).max(128),
  userId: z.string().min(1).max(128),
  capability: z.enum(CAPABILITIES),
  scope: z.string().max(1024),
  reason: z.string().min(1).max(2000),
  args: z.unknown(),
  timeoutMs: z.number().int().positive().max(600_000).optional(),
  parentAgentId: z.enum(AGENT_IDS).optional(),
  correlationId: z.string().max(128).optional(),
});
