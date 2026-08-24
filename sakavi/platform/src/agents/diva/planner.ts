/**
 * Hierarchical task decomposition.
 * Plans are data — Policy Engine still authorizes every tool call.
 * External content never injects plan steps as trusted instructions.
 */

import { randomUUID } from 'node:crypto';
import type {
  DivaInput,
  IntentAnalysis,
  PlanStep,
  Specialist,
  DivaRiskLevel,
} from './types.js';
import type { Capability } from '../../core/types.js';

export function analyzeIntent(objective: string, constraints: string[] = []): IntentAnalysis {
  const o = objective.toLowerCase();
  const domainHints: Specialist[] = [];
  const secondary: string[] = [];

  const needsWrite = /fix|implement|refactor|edit|change|improve|bug|feature|code/.test(o);
  const needsNetwork = /research|search|look up|fetch|npm install|pip install/.test(o);
  const needsDeploy = /deploy|release|production|staging|ship/.test(o);
  const needsDatabase = /\b(sql|database|migration|schema|query)\b/.test(o);
  const irreversibleHints = /delete|drop|destroy|wipe|truncate|force.?push|production/.test(o);

  if (needsWrite || /test|build|lint/.test(o)) domainHints.push('coder');
  if (/github|pr\b|pull request|branch|commit/.test(o)) domainHints.push('github');
  if (/research|search|find out|documentation/.test(o)) domainHints.push('research');
  if (/security|secret|vulnerab|cve|pentest|owasp|exploit/.test(o)) domainHints.push('security');
  if (/debug|stack.?trace|regress|root.?cause|bugfix|incident/.test(o)) domainHints.push('coder');
  if (needsDatabase) domainHints.push('database');
  if (needsDeploy) domainHints.push('deployment');
  if (/browse|website|url|http/.test(o)) domainHints.push('browser');

  if (!domainHints.length) domainHints.push('research');

  if (needsWrite) secondary.push('Verify with tests after changes');
  if (needsDeploy) secondary.push('Require approval before production deploy');
  if (irreversibleHints) secondary.push('Prefer reversible steps and checkpoints');

  return {
    primaryGoal: objective.slice(0, 500),
    secondaryGoals: secondary,
    domainHints: [...new Set(domainHints)],
    constraints: [...constraints],
    irreversibleHints,
    needsNetwork,
    needsWrite,
    needsDeploy,
    needsDatabase,
  };
}

function step(
  objective: string,
  agent: Specialist,
  caps: Capability[],
  risk: DivaRiskLevel,
  success: string[],
  deps: string[] = [],
  params: Record<string, unknown> = {},
  rollback?: string
): PlanStep {
  return {
    id: randomUUID().slice(0, 8),
    objective,
    dependencies: deps,
    assignedAgent: agent,
    requiredCapabilities: caps,
    riskLevel: risk,
    successCriteria: success,
    rollbackStrategy: rollback,
    params,
    status: 'pending',
    attempts: 0,
    observationIds: [],
  };
}

/**
 * Build a hierarchical plan from intent.
 * Seed plan from caller is accepted only as structure, then normalized.
 */
export function decompose(input: DivaInput, intent: IntentAnalysis): PlanStep[] {
  if (input.seedPlan?.length) {
    return normalizeSeed(input.seedPlan, input);
  }

  const plan: PlanStep[] = [];
  const path = input.projectPath;

  // Always start with understanding when a project is involved
  if (path || intent.needsWrite) {
    const inspect = step(
      'Inspect repository structure and manifests',
      'coder',
      ['workspace.read', 'process.execute'],
      'low',
      ['Project files listed', 'Manifest readable or absence noted'],
      [],
      { projectPath: path, mode: 'inspect' }
    );
    plan.push(inspect);

    const sec = step(
      'Security skim of workspace',
      'security',
      ['security.inspect', 'workspace.read'],
      'low',
      ['Security report produced'],
      [inspect.id],
      { projectPath: path }
    );
    plan.push(sec);
  }

  if (intent.domainHints.includes('research')) {
    plan.push(
      step(
        'Research relevant context (untrusted external data)',
        'research',
        ['research.query', 'network.read'],
        'low',
        ['Research notes collected and marked untrusted'],
        [],
        { queries: [intent.primaryGoal] }
      )
    );
  }

  if (intent.needsWrite) {
    const code = step(
      'Implement or fix code in isolated sandbox',
      'coder',
      ['workspace.read', 'workspace.write', 'process.execute'],
      'medium',
      ['Sandbox run completed', 'Tests executed or absence documented'],
      plan.filter((p) => p.assignedAgent === 'coder' && p.params.mode === 'inspect').map((p) => p.id),
      { projectPath: path, allowNetwork: false },
      'Revert workspace changes via git checkout if on agent branch'
    );
    plan.push(code);

    const test = step(
      'Re-run tests after changes',
      'coder',
      ['process.execute', 'workspace.read'],
      'medium',
      ['Test command executed', 'Exit status recorded'],
      [code.id],
      { projectPath: path, mode: 'test' }
    );
    plan.push(test);
  }

  if (intent.domainHints.includes('github') || /pr\b|pull request|branch/.test(intent.primaryGoal.toLowerCase())) {
    const deps = plan.filter((p) => p.assignedAgent === 'coder').map((p) => p.id);
    plan.push(
      step(
        'Prepare feature branch and draft PR (no direct main)',
        'github',
        ['github.read', 'github.write', 'github.pull_request'],
        'high',
        ['Branch is not protected name', 'PR draft created or inspection done'],
        deps,
        { mode: 'inspect' },
        'Close PR / delete agent branch'
      )
    );
  }

  if (intent.needsDatabase) {
    plan.push(
      step(
        'Database operation (read-first; writes need approval)',
        'database',
        ['database.read'],
        'high',
        ['Query classified', 'Approval obtained if non-read'],
        [],
        { sql: 'SELECT 1' }
      )
    );
  }

  if (intent.needsDeploy) {
    const deps = plan.map((p) => p.id);
    plan.push(
      step(
        'Controlled deployment plan (approval required to execute)',
        'deployment',
        ['deployment.request'],
        'critical',
        ['Deployment plan created', 'Execute only after human approval'],
        deps.slice(-2),
        {
          projectPath: path,
          environment: /prod/.test(intent.primaryGoal.toLowerCase()) ? 'production' : 'staging',
        },
        'Rollback via provider if health fails'
      )
    );
  }

  // Final verification step when we did work
  if (plan.length > 1) {
    plan.push(
      step(
        'Synthesize results and remaining risks',
        'diva',
        ['agent.delegate'],
        'low',
        ['Summary of changes, verification, and residual risks'],
        plan.map((p) => p.id),
        { mode: 'synthesize' }
      )
    );
  }

  if (!plan.length) {
    plan.push(
      step(
        'Default research pass on objective',
        'research',
        ['research.query'],
        'low',
        ['Notes collected'],
        [],
        { queries: [intent.primaryGoal] }
      )
    );
  }

  markReady(plan);
  return plan;
}

function normalizeSeed(seed: PlanStep[], input: DivaInput): PlanStep[] {
  return seed.map((s) => ({
    ...s,
    id: s.id || randomUUID().slice(0, 8),
    params: { projectPath: input.projectPath, ...s.params },
    status: s.status || 'pending',
    attempts: s.attempts || 0,
    observationIds: s.observationIds || [],
  }));
}

export function markReady(plan: PlanStep[]): void {
  const done = new Set(plan.filter((p) => p.status === 'done').map((p) => p.id));
  for (const s of plan) {
    if (s.status === 'done' || s.status === 'failed' || s.status === 'skipped' || s.status === 'running') {
      continue;
    }
    const depsOk = s.dependencies.every((d) => done.has(d));
    s.status = depsOk ? 'ready' : 'pending';
  }
}

export function nextReadySteps(plan: PlanStep[], maxParallel: number): PlanStep[] {
  markReady(plan);
  const ready = plan.filter((p) => p.status === 'ready');
  // Never parallelize conflicting mutation agents
  const writers = new Set(['coder', 'github', 'database', 'deployment']);
  const selected: PlanStep[] = [];
  let writerTaken = false;
  for (const s of ready) {
    if (selected.length >= maxParallel) break;
    if (writers.has(s.assignedAgent)) {
      if (writerTaken) continue;
      writerTaken = true;
    }
    selected.push(s);
  }
  return selected;
}

export function hasCircularDeps(plan: PlanStep[]): boolean {
  const ids = new Set(plan.map((p) => p.id));
  const visiting = new Set<string>();
  const visited = new Set<string>();

  function dfs(id: string): boolean {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    const node = plan.find((p) => p.id === id);
    for (const d of node?.dependencies ?? []) {
      if (!ids.has(d)) continue;
      if (dfs(d)) return true;
    }
    visiting.delete(id);
    visited.add(id);
    return false;
  }

  return plan.some((p) => dfs(p.id));
}
