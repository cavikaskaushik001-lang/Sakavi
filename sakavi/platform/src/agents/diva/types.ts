/**
 * DIVA cognitive types — structured state for every pipeline stage.
 * Security is enforced outside these types (Policy / Capability / Gateway).
 */

import type { Capability, RiskLevel as CoreRisk } from '../../core/types.js';

export type DivaRiskLevel = 'low' | 'medium' | 'high' | 'critical';

export type DivaTaskStatus =
  | 'planning'
  | 'awaiting_approval'
  | 'executing'
  | 'verifying'
  | 'recovering'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'paused';

export type Specialist =
  | 'coder'
  | 'github'
  | 'research'
  | 'security'
  | 'database'
  | 'deployment'
  | 'browser'
  | 'diva';

export type FailureClass =
  | 'TRANSIENT'
  | 'AUTHORIZATION'
  | 'VALIDATION'
  | 'TOOL'
  | 'ENVIRONMENT'
  | 'LOGIC'
  | 'SECURITY'
  | 'UNKNOWN';

export type PipelineStage =
  | 'INPUT'
  | 'INTENT_ANALYSIS'
  | 'CONTEXT_BUILDING'
  | 'TASK_DECOMPOSITION'
  | 'RISK_ANALYSIS'
  | 'EXECUTION_PLAN'
  | 'PLAN_VALIDATION'
  | 'EXECUTION'
  | 'OBSERVATION'
  | 'VERIFICATION'
  | 'RECOVERY'
  | 'FINAL_RESULT';

export interface PlanStep {
  id: string;
  objective: string;
  dependencies: string[];
  assignedAgent: Specialist;
  requiredCapabilities: Capability[];
  riskLevel: DivaRiskLevel;
  successCriteria: string[];
  rollbackStrategy?: string;
  params: Record<string, unknown>;
  status: 'pending' | 'ready' | 'running' | 'done' | 'failed' | 'skipped' | 'blocked';
  attempts: number;
  observationIds: string[];
  verificationPassed?: boolean;
}

export interface Observation {
  id: string;
  stepId: string;
  at: string;
  source: Specialist | 'system' | 'tool';
  summary: string;
  /** Untrusted external content must be flagged */
  untrusted: boolean;
  evidence?: string[];
  rawStatus?: string;
}

export interface AgentError {
  id: string;
  stepId?: string;
  at: string;
  class: FailureClass;
  message: string;
  retriable: boolean;
}

export interface Decision {
  action: string;
  confidence: number; // 0..1 — decision quality only, NOT a security boundary
  evidence: string[];
  assumptions: string[];
  riskLevel: DivaRiskLevel;
  requiresApproval: boolean;
}

export interface TaskBudget {
  maxToolCalls: number;
  usedToolCalls: number;
  maxDurationMs: number;
  maxRetries: number;
  maxPlanRevisions: number;
  maxReflectionCycles: number;
  maxParallelAgents: number;
  maxNetworkRequests: number;
  usedNetworkRequests: number;
  estimatedCost: number;
}

export interface Checkpoint {
  id: string;
  at: string;
  stepId: string;
  label: string;
  /** e.g. git commit sha on agent branch — never on protected branch */
  ref?: string;
  verified: boolean;
}

export interface TimelineEvent {
  at: string;
  stage: PipelineStage | 'CONTROL';
  message: string;
  meta?: Record<string, string | number | boolean | null>;
}

export interface WorkingMemory {
  objective: string;
  constraints: string[];
  decisions: Decision[];
  toolResultSummaries: string[];
  importantObservations: string[];
  failedApproaches: string[];
  successfulApproaches: string[];
  currentPlanIds: string[];
  notes: string[];
}

export interface MemoryItem {
  id: string;
  kind: 'preference' | 'project' | 'technical' | 'outcome' | 'lesson' | 'security';
  content: string;
  source: string;
  confidence: number;
  createdAt: string;
  updatedAt: string;
  scope: string;
  sensitivity: 'public' | 'internal' | 'sensitive';
  /** External/repo content is never auto-trusted */
  trusted: boolean;
}

export interface IntentAnalysis {
  primaryGoal: string;
  secondaryGoals: string[];
  domainHints: Specialist[];
  constraints: string[];
  irreversibleHints: boolean;
  needsNetwork: boolean;
  needsWrite: boolean;
  needsDeploy: boolean;
  needsDatabase: boolean;
}

export interface RiskAssessment {
  overall: DivaRiskLevel;
  factors: { name: string; level: DivaRiskLevel; detail: string }[];
  requiresHumanApproval: boolean;
  boundaryCrossings: string[];
}

export interface CriticReport {
  approved: boolean;
  issues: { severity: DivaRiskLevel; message: string }[];
  revisions: Partial<PlanStep>[];
  summary: string;
}

export interface DivaTaskState {
  taskId: string;
  userId: string;
  objective: string;
  projectPath?: string;
  status: DivaTaskStatus;
  stage: PipelineStage;
  plan: PlanStep[];
  currentStep: number;
  riskLevel: DivaRiskLevel;
  capabilities: Capability[];
  observations: Observation[];
  errors: AgentError[];
  attempts: number;
  planRevisions: number;
  reflectionCycles: number;
  budget: TaskBudget;
  workingMemory: WorkingMemory;
  checkpoints: Checkpoint[];
  timeline: TimelineEvent[];
  pendingApprovals: string[];
  createdAt: string;
  updatedAt: string;
  deadline: string;
  resultSummary?: string;
  paused: boolean;
  cancelRequested: boolean;
}

export interface DivaInput {
  userId: string;
  objective: string;
  projectPath?: string;
  /** Optional seed plan from caller */
  seedPlan?: PlanStep[];
  constraints?: string[];
  /** Resume an existing paused task */
  resumeTaskId?: string;
}

export interface DivaOutput {
  taskId: string;
  status: DivaTaskStatus;
  summary: string;
  riskLevel: DivaRiskLevel;
  stepResults: {
    id: string;
    objective: string;
    agent: string;
    status: string;
    verified?: boolean;
  }[];
  pendingApprovals: string[];
  timeline: TimelineEvent[];
  remainingRisks: string[];
  missingCapabilities: string[];
}

/** Map core RiskLevel to DIVA lowercase */
export function toDivaRisk(r: CoreRisk): DivaRiskLevel {
  return r.toLowerCase() as DivaRiskLevel;
}

export function riskRank(r: DivaRiskLevel): number {
  return { low: 1, medium: 2, high: 3, critical: 4 }[r];
}

export function maxRisk(a: DivaRiskLevel, b: DivaRiskLevel): DivaRiskLevel {
  return riskRank(a) >= riskRank(b) ? a : b;
}
