/**
 * Independent risk engine — not driven by the model's self-assessment.
 * Evaluates impact, reversibility, scope, sensitivity, side effects.
 */

import type {
  DivaRiskLevel,
  PlanStep,
  RiskAssessment,
  IntentAnalysis,
} from './types.js';
import { maxRisk, riskRank } from './types.js';
import type { Capability } from '../../core/types.js';
import { CAPABILITY_RISK, ALWAYS_APPROVE } from '../../core/types.js';

const BOUNDARIES = [
  'Sandbox boundary',
  'Credential boundary',
  'Network boundary',
  'Filesystem boundary',
  'GitHub permission boundary',
  'Database boundary',
  'Production boundary',
  'Human approval boundary',
] as const;

export function assessIntentRisk(intent: IntentAnalysis): RiskAssessment {
  const factors: RiskAssessment['factors'] = [];
  let overall: DivaRiskLevel = 'low';

  if (intent.needsWrite) {
    factors.push({ name: 'code_write', level: 'medium', detail: 'Source modification requested' });
    overall = maxRisk(overall, 'medium');
  }
  if (intent.needsNetwork) {
    factors.push({ name: 'network', level: 'medium', detail: 'Outbound network may be required' });
    overall = maxRisk(overall, 'medium');
  }
  if (intent.needsDatabase) {
    factors.push({ name: 'database', level: 'high', detail: 'Database access hinted' });
    overall = maxRisk(overall, 'high');
  }
  if (intent.needsDeploy) {
    factors.push({ name: 'deployment', level: 'critical', detail: 'Deployment hinted' });
    overall = maxRisk(overall, 'critical');
  }
  if (intent.irreversibleHints) {
    factors.push({
      name: 'irreversible',
      level: 'critical',
      detail: 'Objective language suggests irreversible action',
    });
    overall = maxRisk(overall, 'critical');
  }

  const boundaryCrossings: string[] = [];
  if (intent.needsNetwork) boundaryCrossings.push('Network boundary');
  if (intent.needsWrite) boundaryCrossings.push('Filesystem boundary');
  if (intent.needsDeploy) boundaryCrossings.push('Production boundary');
  if (intent.needsDatabase) boundaryCrossings.push('Database boundary');
  if (overall === 'high' || overall === 'critical') {
    boundaryCrossings.push('Human approval boundary');
  }

  return {
    overall,
    factors,
    requiresHumanApproval: overall === 'high' || overall === 'critical',
    boundaryCrossings: [...new Set(boundaryCrossings)],
  };
}

export function assessStepRisk(step: PlanStep): DivaRiskLevel {
  let level: DivaRiskLevel = step.riskLevel;
  for (const cap of step.requiredCapabilities) {
    const mapped = CAPABILITY_RISK[cap].toLowerCase() as DivaRiskLevel;
    level = maxRisk(level, mapped);
    if (ALWAYS_APPROVE.has(cap)) level = maxRisk(level, 'critical');
  }
  if (step.assignedAgent === 'deployment') level = maxRisk(level, 'high');
  if (step.assignedAgent === 'database' && step.requiredCapabilities.includes('database.destructive')) {
    level = 'critical';
  }
  return level;
}

export function assessPlanRisk(plan: PlanStep[]): RiskAssessment {
  let overall: DivaRiskLevel = 'low';
  const factors: RiskAssessment['factors'] = [];
  const boundaryCrossings: string[] = [];

  for (const step of plan) {
    const lvl = assessStepRisk(step);
    overall = maxRisk(overall, lvl);
    if (riskRank(lvl) >= riskRank('high')) {
      factors.push({
        name: step.id,
        level: lvl,
        detail: step.objective.slice(0, 120),
      });
    }
    for (const cap of step.requiredCapabilities) {
      if (cap.startsWith('network')) boundaryCrossings.push('Network boundary');
      if (cap.startsWith('database')) boundaryCrossings.push('Database boundary');
      if (cap.startsWith('deployment')) boundaryCrossings.push('Production boundary');
      if (cap.startsWith('github')) boundaryCrossings.push('GitHub permission boundary');
      if (cap === 'secrets.request') boundaryCrossings.push('Credential boundary');
      if (ALWAYS_APPROVE.has(cap)) boundaryCrossings.push('Human approval boundary');
    }
  }

  return {
    overall,
    factors,
    requiresHumanApproval: overall === 'high' || overall === 'critical',
    boundaryCrossings: [...new Set(boundaryCrossings)],
  };
}

/** Confidence is advisory only — never used as authorization */
export function decisionConfidence(params: {
  evidenceCount: number;
  hasTests: boolean;
  risk: DivaRiskLevel;
  unknownFactors: number;
}): number {
  let c = 0.5;
  c += Math.min(0.3, params.evidenceCount * 0.05);
  if (params.hasTests) c += 0.15;
  c -= params.unknownFactors * 0.1;
  if (params.risk === 'high') c -= 0.1;
  if (params.risk === 'critical') c -= 0.2;
  return Math.max(0, Math.min(1, c));
}

export function listBoundaries(): readonly string[] {
  return BOUNDARIES;
}

export function capabilitiesForRisk(risk: DivaRiskLevel): Capability[] {
  // Informational — actual grants still go through Capability Manager
  if (risk === 'critical') return ['deployment.execute', 'database.destructive', 'secrets.request'];
  if (risk === 'high') return ['github.write', 'github.pull_request', 'database.write', 'deployment.request'];
  if (risk === 'medium') return ['workspace.write', 'process.execute', 'network.read'];
  return ['workspace.read', 'github.read', 'research.query', 'security.inspect'];
}
