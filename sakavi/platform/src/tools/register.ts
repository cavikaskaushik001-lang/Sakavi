/**
 * Register all tool handlers with the Tool Gateway.
 * Handlers are the only place privileged side-effects happen.
 */

import { toolGateway } from '../core/tool-gateway.js';
import { sandboxService } from '../sandbox/index.js';
import { secretProvider } from '../core/secrets.js';
import { PlatformError } from '../core/errors.js';

const deployPlans = new Map<string, { environment: string; projectPath: string }>();

export function registerAllTools(): void {
  toolGateway.register('sandbox.create', async (args) => {
    const a = args as { projectPath: string; networkMode?: 'none' | 'bridge' };
    if (!a.projectPath) throw new PlatformError('INVALID_ARGS', 'projectPath required');
    return sandboxService.create({
      projectPath: a.projectPath,
      networkMode: a.networkMode,
    });
  });

  toolGateway.register('sandbox.execute', async (args) => {
    const a = args as { sandboxId: string; command: string; timeoutMs?: number };
    if (!a.sandboxId || !a.command) {
      throw new PlatformError('INVALID_ARGS', 'sandboxId and command required');
    }
    return sandboxService.execute(a.sandboxId, a.command, a.timeoutMs);
  });

  toolGateway.register('sandbox.destroy', async (args) => {
    const a = args as { sandboxId: string };
    if (!a.sandboxId) throw new PlatformError('INVALID_ARGS', 'sandboxId required');
    await sandboxService.destroy(a.sandboxId);
    return { destroyed: true };
  });

  toolGateway.register('github.status', async () => {
    const token = tryToken();
    return {
      connected: Boolean(token),
      message: token ? 'GitHub token present (value never returned)' : 'GITHUB_TOKEN not configured',
    };
  });

  toolGateway.register('github.list_tree', async (args) => {
    requireToken();
    const a = args as { ref?: string };
    return { ref: a.ref || 'main', files: [], note: 'Wire to existing github-agent Edge or Octokit' };
  });

  toolGateway.register('github.read_file', async (args) => {
    requireToken();
    const a = args as { path: string; ref?: string };
    if (!a.path) throw new PlatformError('INVALID_ARGS', 'path required');
    return { path: a.path, content: '', note: 'Wire to existing github-agent read_file' };
  });

  toolGateway.register('github.search_code', async (args) => {
    requireToken();
    return { query: (args as { query: string }).query, results: [] };
  });

  toolGateway.register('github.create_branch', async (args) => {
    requireToken();
    const a = args as { task?: string; base?: string; name?: string };
    const branch =
      a.name ||
      `sakavi/agent-${(a.task || 'task')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .slice(0, 40)}-${Date.now().toString(36)}`;
    if (['main', 'master', 'production', 'prod'].includes(branch)) {
      throw new PlatformError('PROTECTED_BRANCH', 'Cannot use protected branch name');
    }
    return { branch, base: a.base || 'main' };
  });

  toolGateway.register('github.upsert_file', async (args) => {
    requireToken();
    const a = args as { path: string; content: string; branch: string; message: string };
    if (!a.path || !a.branch || !a.message) {
      throw new PlatformError('INVALID_ARGS', 'path, branch, message required');
    }
    if (['main', 'master'].includes(a.branch)) {
      throw new PlatformError('PROTECTED_BRANCH', 'Direct commits to main/master forbidden');
    }
    return { ok: true, path: a.path, branch: a.branch };
  });

  toolGateway.register('github.delete_file', async (args) => {
    requireToken();
    const a = args as { path: string; branch: string; confirmDestroy?: boolean };
    if (!a.confirmDestroy) {
      throw new PlatformError('CONFIRM_REQUIRED', 'delete_file requires confirmDestroy: true');
    }
    if (['main', 'master'].includes(a.branch)) {
      throw new PlatformError('PROTECTED_BRANCH', 'Direct deletes on main/master forbidden');
    }
    return { ok: true, deleted: a.path };
  });

  toolGateway.register('github.create_pr', async (args) => {
    requireToken();
    const a = args as { head: string; base?: string; title: string; body?: string; draft?: boolean };
    if (!a.head || !a.title) throw new PlatformError('INVALID_ARGS', 'head and title required');
    return {
      ok: true,
      url: 'https://github.com/example/repo/pull/0',
      head: a.head,
      base: a.base || 'main',
      draft: a.draft !== false,
    };
  });

  toolGateway.register('github.commit', async () => {
    throw new PlatformError('USE_UPSERT', 'Use github.upsert_file on feature branches');
  });

  toolGateway.register('github.push', async () => {
    throw new PlatformError('USE_PR', 'Push is mediated via upsert + create_pr');
  });

  toolGateway.register('database.query', async (args) => {
    const a = args as { sql: string };
    if (!a.sql) throw new PlatformError('INVALID_ARGS', 'sql required');
    if (/^\s*SELECT\b/i.test(a.sql)) {
      return { rows: [], rowsAffected: 0 };
    }
    return { rowsAffected: 0, note: 'Write/destructive only after approval' };
  });

  toolGateway.register('network.fetch', async (args) => {
    const a = args as { url: string };
    return { url: a.url, status: 0, body: '', note: 'Outbound fetch stub' };
  });

  toolGateway.register('secrets.reveal', async (args, inv) => {
    const a = args as { name: string };
    const value = secretProvider.reveal(a.name, {
      taskId: inv.taskId,
      userId: inv.userId,
      agentId: inv.agentId,
      reason: inv.reason,
    });
    return { name: a.name, present: true, length: value.length };
  });

  toolGateway.register('deployment.plan', async (args) => {
    const a = args as { planId: string; environment: string; projectPath: string };
    deployPlans.set(a.planId, { environment: a.environment, projectPath: a.projectPath });
    return {
      planId: a.planId,
      environment: a.environment,
      steps: ['build', 'test', 'security', 'diff', 'approve', 'deploy', 'health'],
    };
  });

  toolGateway.register('deployment.execute', async (args) => {
    const a = args as { planId: string; approvalId: string; environment: string };
    if (!deployPlans.has(a.planId)) {
      throw new PlatformError('PLAN_NOT_FOUND', 'Unknown deployment plan');
    }
    return { deployed: true, environment: a.environment, planId: a.planId };
  });

  toolGateway.register('deployment.health', async (args) => {
    const a = args as { environment: string; planId: string };
    return { ok: true, environment: a.environment, planId: a.planId };
  });

  toolGateway.register('research.search', async (args) => {
    const a = args as { query: string };
    return { query: a.query, snippet: 'No live search backend configured', untrusted: true };
  });

  toolGateway.register('browser.navigate', async (args) => {
    const a = args as { url: string };
    return { url: a.url, ok: true };
  });

  toolGateway.register('browser.snapshot', async (args) => {
    const a = args as { url: string };
    return { url: a.url, text: '', untrusted: true };
  });

  toolGateway.register('security.scan', async (args) => {
    const a = args as { projectPath?: string };
    const findings: { severity: string; title: string; detail: string }[] = [];
    if (!a.projectPath) {
      findings.push({ severity: 'INFO', title: 'No project path', detail: 'Skipped filesystem scan' });
    } else {
      findings.push({
        severity: 'INFO',
        title: 'Scan queued',
        detail: `Would scan ${a.projectPath} for secrets and risky patterns`,
      });
    }
    return { findings };
  });

  toolGateway.register('agent.delegate', async (args) => {
    return { recorded: true, args };
  });

  toolGateway.register('workspace.read_file', async () => {
    throw new PlatformError('USE_SANDBOX', 'Use sandbox.execute for workspace reads');
  });

  toolGateway.register('workspace.write_file', async () => {
    throw new PlatformError('USE_SANDBOX', 'Use sandbox or github.upsert_file for writes');
  });

  toolGateway.register('workspace.list', async () => {
    throw new PlatformError('USE_SANDBOX', 'Use sandbox.execute for listing');
  });


  toolGateway.register('process.inspect', async (args) => {
    const a = args as { sandboxId: string };
    return sandboxService.execute(a.sandboxId, 'ps aux | head -50');
  });

  toolGateway.register('git.status', async (args) => {
    const a = args as { sandboxId: string };
    return sandboxService.execute(a.sandboxId, 'git status');
  });

  toolGateway.register('git.diff', async (args) => {
    const a = args as { sandboxId: string };
    return sandboxService.execute(a.sandboxId, 'git diff');
  });

  toolGateway.register('git.log', async (args) => {
    const a = args as { sandboxId: string; n?: number };
    const n = a.n ?? 10;
    return sandboxService.execute(a.sandboxId, `git log -n ${n} --oneline`);
  });

  toolGateway.register('github.issue', async (args) => {
    requireToken();
    return { ok: true, note: 'Wire to GitHub issues API', args };
  });

  toolGateway.register('database.schema', async () => {
    return { tables: [], note: 'Wire DB schema inspector' };
  });

  toolGateway.register('cloud.describe', async (args) => {
    return { resource: (args as { resource: string }).resource, metadata: {}, note: 'Wire cloud read API' };
  });

  toolGateway.register('logs.read', async (args) => {
    const a = args as { source: string; lines?: number };
    return { lines: [], source: a.source, note: 'Wire log backend' };
  });

  toolGateway.register('monitoring.health', async (args) => {
    return { ok: true, service: (args as { service: string }).service, detail: 'stub healthy' };
  });

  toolGateway.register('artifact.create', async (args) => {
    const a = args as { name: string; content: string };
    return { id: 'art-' + Date.now().toString(36), name: a.name };
  });

  toolGateway.register('filesystem.read', async (args) => {
    const a = args as { path: string; sandboxId?: string };
    if (!a.sandboxId) return { content: '', note: 'sandboxId required for read' };
    return sandboxService.execute(a.sandboxId, `cat ${JSON.stringify(a.path)}`);
  });

  toolGateway.register('filesystem.write', async (args) => {
    throw new PlatformError('USE_SANDBOX', 'Prefer controlled write via sandbox or github.upsert_file');
  });

  toolGateway.register('filesystem.search', async (args) => {
    const a = args as { pattern: string; sandboxId?: string; path?: string };
    if (!a.sandboxId) return { matches: [] };
    return sandboxService.execute(
      a.sandboxId,
      `grep -R -n -E ${JSON.stringify(a.pattern)} ${a.path || '.'} | head -50`
    );
  });

  toolGateway.register('debug.typecheck', async (args) => {
    const a = args as { sandboxId: string };
    return sandboxService.execute(a.sandboxId, 'npx tsc --noEmit || true');
  });

  toolGateway.register('debug.test', async (args) => {
    const a = args as { sandboxId: string; command?: string };
    return sandboxService.execute(a.sandboxId, a.command || 'npm test --if-present');
  });

  toolGateway.register('debug.session', async (args) => {
    return { note: 'Use agents/debugger runDebugSession from orchestrator', args };
  });

  toolGateway.register('security.research', async (args) => {
    return { note: 'Use runSecurityResearch from security module', args };
  });
}

function tryToken(): string | null {
  if (secretProvider.has('GITHUB_TOKEN')) return 'present';
  return process.env.GITHUB_TOKEN ? 'present' : null;
}

function requireToken(): void {
  if (!tryToken()) {
    throw new PlatformError('GITHUB_TOKEN_MISSING', 'GITHUB_TOKEN not configured on server', 503);
  }
}
