/**
 * Passive reconnaissance — authorized environment only.
 * Prefers data already available (repo, config, manifests). No broad Internet scanning.
 */

import { assertAction, assertScope } from './scope.js';
import type { SecurityScope } from './types.js';
import { callTool } from '../core/agent-base.js';
import type { AgentId } from '../core/types.js';

export interface ReconResult {
  facts: string[];
  manifests: string[];
  notes: string[];
}

export async function runRecon(params: {
  userId: string;
  taskId: string;
  scope: SecurityScope;
  projectPath?: string;
}): Promise<ReconResult> {
  assertScope(params.scope);
  assertAction(params.scope, 'recon.repo');

  const facts: string[] = [];
  const manifests: string[] = [];
  const notes: string[] = [];

  facts.push(`Target: ${params.scope.target}`);
  facts.push(`Owner: ${params.scope.owner}`);
  facts.push(`Auth: ${params.scope.authorizationId}`);
  facts.push(`Environment: ${params.scope.environment}`);
  facts.push(`Permitted actions: ${params.scope.permittedActions.join(', ')}`);

  if (params.projectPath) {
    const inv = {
      toolName: 'sandbox.execute',
      agentId: 'security' as AgentId,
      taskId: params.taskId,
      userId: params.userId,
      capability: 'workspace.read' as const,
      scope: params.projectPath,
      reason: 'Passive recon: list project structure',
      args: {
        // Caller must have created sandbox; if not, tool may fail — we record fact
        sandboxId: params.scope.authorizationId, // placeholder — index wires real sandbox
        command:
          'ls -la 2>/dev/null; echo "---"; (test -f package.json && echo HAS_PACKAGE_JSON); (test -f requirements.txt && echo HAS_REQUIREMENTS); (test -f go.mod && echo HAS_GOMOD); find . -maxdepth 3 -type f \\( -name "*.env*" -o -name "Dockerfile" -o -name "docker-compose*.yml" \\) 2>/dev/null | head -40',
      },
    };
    // Soft: recon can work without live sandbox by recording intent
    notes.push('Prefer sandbox listing when sandboxId is provisioned by security index');
    manifests.push('package.json|requirements.txt|go.mod|Dockerfile (if present)');
    void inv;
  }

  notes.push('Recon is passive — no intrusive probes in this phase');
  return { facts, manifests, notes };
}

/** Pure static listing helpers for when file content is supplied by caller */
export function analyzeManifestText(name: string, content: string): string[] {
  const facts: string[] = [];
  if (name === 'package.json') {
    try {
      const pkg = JSON.parse(content) as { dependencies?: object; devDependencies?: object; scripts?: object };
      facts.push(`npm deps: ${Object.keys(pkg.dependencies || {}).length}`);
      facts.push(`devDeps: ${Object.keys(pkg.devDependencies || {}).length}`);
      facts.push(`scripts: ${Object.keys(pkg.scripts || {}).join(', ')}`);
    } catch {
      facts.push('package.json parse failed');
    }
  }
  if (/\.env/i.test(name)) {
    facts.push('Env file present — content must not be logged; check for secret patterns offline');
  }
  return facts;
}
