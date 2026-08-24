/**
 * Security research workflow:
 * Authorization → Scope → Passive analysis → (optional dynamic) →
 * Findings → Verify → Root cause → Remediation plan → Report
 *
 * DIVA/agents must not use this as an uncontrolled offensive engine.
 */

import { randomUUID } from 'node:crypto';
import { killSwitch } from '../core/kill-switch.js';
import { emitAudit } from '../core/audit.js';
import { assertScope, ScopeViolationError } from './scope.js';
import { runRecon } from './recon.js';
import { scanFiles } from './scanner.js';
import { analyzeArchitecture, findingsFromArchitecture } from './analyzer.js';
import { refineFinding, safeDynamicVerify } from './verifier.js';
import { buildRootCause, remediationPlan } from './remediation.js';
import { findingsToMarkdown } from './reporter.js';
import type {
  SecurityFinding,
  SecurityScope,
  SecurityTaskInput,
  SecurityTaskResult,
} from './types.js';

export type {
  SecurityScope,
  SecurityFinding,
  SecurityTaskInput,
  SecurityTaskResult,
  RootCauseReport,
} from './types.js';

export { assertScope, assertAction, assertHostInScope, assertPathInScope } from './scope.js';
export { scanFiles } from './scanner.js';
export { findingsToMarkdown } from './reporter.js';

export interface SecurityRunOptions {
  /** Files already loaded from authorized workspace (preferred) */
  files?: { path: string; content: string }[];
}

/**
 * Full passive-first security task.
 */
export async function runSecurityResearch(
  input: SecurityTaskInput,
  options: SecurityRunOptions = {}
): Promise<SecurityTaskResult> {
  const taskId = randomUUID();
  killSwitch.assertNotActive();

  try {
    const scope = assertScope(input.scope);

    emitAudit({
      agentId: 'security',
      taskId,
      userId: input.userId,
      tool: 'security.research.start',
      capability: 'security.inspect',
      resultStatus: 'ok',
      riskLevel: scope.environment === 'production' ? 'HIGH' : 'MEDIUM',
      meta: {
        authorizationId: scope.authorizationId,
        target: scope.target,
        dynamic: Boolean(input.allowDynamic),
      },
    });

    // Stop if authorization ambiguous (already enforced)
    const recon = await runRecon({
      userId: input.userId,
      taskId,
      scope,
      projectPath: input.projectPath,
    });

    let findings: SecurityFinding[] = [];
    const files = options.files || [];

    if (files.length) {
      findings = findings.concat(scanFiles(files));
      const arch = analyzeArchitecture(files);
      findings = findings.concat(findingsFromArchitecture(arch));
    } else {
      // No files provided — report informational only
      findings.push({
        id: randomUUID().slice(0, 10),
        title: 'No source files supplied for static analysis',
        severity: 'INFO',
        confidence: 'HIGH',
        affectedComponent: 'process',
        affectedPath: input.projectPath || 'n/a',
        evidence: recon.facts,
        reproductionSummary: 'N/A',
        rootCause: 'Caller did not provide file contents',
        impact: 'None',
        remediation: 'Pass authorized file set from workspace read tools',
        regressionTest: 'N/A',
        verificationStatus: 'unverified',
        observedFacts: recon.facts,
        hypotheses: [],
        createdAt: new Date().toISOString(),
      });
    }

    const ctx = { scope, allowDynamic: Boolean(input.allowDynamic) };
    findings = findings.map((f) => refineFinding(f, ctx));

    if (input.allowDynamic) {
      findings = await Promise.all(findings.map((f) => safeDynamicVerify(f, ctx)));
    }

    // Never mark CRITICAL solely on theory without evidence
    findings = findings.map((f) => {
      if (f.severity === 'CRITICAL' && f.confidence === 'LOW') {
        return { ...f, severity: 'HIGH' as const, hypotheses: [...f.hypotheses, 'Severity capped: low confidence'] };
      }
      return f;
    });

    const rootCauses = findings
      .filter((f) => f.severity === 'HIGH' || f.severity === 'CRITICAL')
      .map(buildRootCause);

    const plan = remediationPlan(findings);
    const reportMarkdown = findingsToMarkdown(scope, findings, {
      rootCauses,
    }) + `\n## Remediation workflow\n\nBranch: \`${plan.branchName}\`\n\n` +
      plan.steps.map((s, i) => `${i + 1}. ${s}`).join('\n') + '\n';

    return {
      taskId,
      status: 'completed',
      summary: `Security research complete: ${findings.length} finding(s)`,
      findings,
      reportMarkdown,
    };
  } catch (err) {
    if (err instanceof ScopeViolationError) {
      emitAudit({
        agentId: 'security',
        taskId,
        userId: input.userId,
        tool: 'security.research.stop',
        capability: 'security.inspect',
        resultStatus: 'blocked',
        riskLevel: 'HIGH',
        meta: { reason: err.message.slice(0, 300) },
      });
      return {
        taskId,
        status: 'stopped',
        summary: err.message,
        findings: [],
        stopReason: err.message,
        reportMarkdown: `# Stopped\n\n${err.message}\n`,
      };
    }
    const msg = err instanceof Error ? err.message : 'security research failed';
    return {
      taskId,
      status: 'failed',
      summary: msg,
      findings: [],
      stopReason: msg,
      reportMarkdown: `# Failed\n\n${msg}\n`,
    };
  }
}

/** Project-scoped knowledge (not global policy) */
const projectKnowledge = new Map<
  string,
  {
    known: string[];
    fixed: string[];
    falsePositives: string[];
    assumptions: string[];
  }
>();

export function getProjectSecurityKnowledge(projectKey: string) {
  return (
    projectKnowledge.get(projectKey) || {
      known: [],
      fixed: [],
      falsePositives: [],
      assumptions: [],
    }
  );
}

export function recordFixedFinding(projectKey: string, findingId: string): void {
  const k = getProjectSecurityKnowledge(projectKey);
  k.fixed.push(findingId);
  projectKnowledge.set(projectKey, k);
}
