// Sakavi — GitHub Coding Agent (secure, branch-first, PR workflow)
// ------------------------------------------------------------
// Secrets (never put in frontend):
//   supabase secrets set GITHUB_TOKEN=ghp_...          # fine-grained or classic with minimal scopes
//   supabase secrets set GITHUB_REPO=owner/repo        # default repository
// Optional:
//   supabase secrets set GITHUB_DEFAULT_BASE=main
//   supabase secrets set GITHUB_AGENT_CONFIRM_DESTROY=true
//
// Required token scopes (minimum):
//   contents: read/write  (code)
//   pull_requests: write
//   metadata: read
// Prefer Fine-grained PAT limited to one repo. Do NOT grant delete_repo / admin.
//
// POST body: { action, ...params }
// Auth: Bearer user JWT or anon key (same pattern as sakavi-chat)
// ------------------------------------------------------------

const GITHUB_TOKEN = Deno.env.get('GITHUB_TOKEN') || '';
const DEFAULT_REPO = Deno.env.get('GITHUB_REPO') || '';
const DEFAULT_BASE = Deno.env.get('GITHUB_DEFAULT_BASE') || 'main';
const REQUIRE_DESTROY_CONFIRM = (Deno.env.get('GITHUB_AGENT_CONFIRM_DESTROY') || 'true') === 'true';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const SECRET_PATH_RE =
  /(^|\/)(\.env|\.env\..*|\.pem|\.key|credentials|secrets?|id_rsa|id_ed25519|\.git\/config)(\/|$)/i;
const SECRET_CONTENT_RE =
  /\b(api[_-]?key|secret[_-]?key|private[_-]?key|password|passwd|database_url|mongodb(\+srv)?:\/\/|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{20,}|xox[baprs]-)\b/i;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

function parseRepo(input?: string): { owner: string; repo: string } {
  const raw = (input || DEFAULT_REPO || '').trim();
  if (!raw) throw new Error('GITHUB_REPO not configured. Set secret GITHUB_REPO=owner/name');
  // support full URL or owner/repo
  const m = raw.match(/github\.com[/:]([^/]+)\/([^/#.]+)/) || raw.match(/^([^/]+)\/([^/]+)$/);
  if (!m) throw new Error('Invalid repo. Use owner/repo');
  return { owner: m[1], repo: m[2].replace(/\.git$/, '') };
}

function isProtectedPath(path: string): boolean {
  return SECRET_PATH_RE.test(path.replace(/\\/g, '/'));
}

function looksLikeSecretContent(content: string): boolean {
  return SECRET_CONTENT_RE.test(content);
}

async function gh(
  path: string,
  opts: { method?: string; body?: unknown; accept?: string } = {},
): Promise<Response> {
  if (!GITHUB_TOKEN) {
    throw new Error('GITHUB_TOKEN secret not set on github-agent function');
  }
  return fetch('https://api.github.com' + path, {
    method: opts.method || 'GET',
    headers: {
      Accept: opts.accept || 'application/vnd.github+json',
      Authorization: 'Bearer ' + GITHUB_TOKEN,
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
      'User-Agent': 'Sakavi-GitHub-Agent/1.0',
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
}

async function ghJson<T = unknown>(path: string, opts?: Parameters<typeof gh>[1]): Promise<T> {
  const res = await gh(path, opts);
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text.slice(0, 500) };
  }
  if (!res.ok) {
    const msg = (data as { message?: string })?.message || text.slice(0, 200) || res.statusText;
    throw new Error(`GitHub ${res.status}: ${msg}`);
  }
  return data as T;
}

function branchNameFromTask(task: string): string {
  const slug = (task || 'task')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'task';
  const ts = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
  return `sakavi/agent-${slug}-${ts}`;
}

// ---- Actions ----

async function actionStatus(repoSpec?: string) {
  const { owner, repo } = parseRepo(repoSpec);
  const repoInfo = await ghJson<{
    full_name: string;
    default_branch: string;
    private: boolean;
    html_url: string;
  }>(`/repos/${owner}/${repo}`);
  return {
    ok: true,
    connected: true,
    repo: repoInfo.full_name,
    defaultBranch: repoInfo.default_branch,
    private: repoInfo.private,
    url: repoInfo.html_url,
    tokenConfigured: !!GITHUB_TOKEN,
  };
}

async function actionListTree(repoSpec: string | undefined, ref?: string) {
  const { owner, repo } = parseRepo(repoSpec);
  const branch = ref || DEFAULT_BASE;
  const refData = await ghJson<{ object: { sha: string } }>(
    `/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(branch)}`,
  );
  const tree = await ghJson<{
    tree: Array<{ path: string; type: string; size?: number; sha: string }>;
    truncated: boolean;
  }>(`/repos/${owner}/${repo}/git/trees/${refData.object.sha}?recursive=1`);

  const files = (tree.tree || [])
    .filter((n) => n.type === 'blob')
    .filter((n) => !isProtectedPath(n.path))
    .map((n) => ({ path: n.path, size: n.size, sha: n.sha }));

  return {
    ok: true,
    ref: branch,
    truncated: tree.truncated,
    count: files.length,
    files,
  };
}

async function actionReadFile(repoSpec: string | undefined, path: string, ref?: string) {
  if (!path) throw new Error('path required');
  if (isProtectedPath(path)) {
    return { ok: false, blocked: true, reason: 'Secret/protected path cannot be read by agent' };
  }
  const { owner, repo } = parseRepo(repoSpec);
  const data = await ghJson<{
    content?: string;
    encoding?: string;
    sha: string;
    size: number;
    path: string;
  }>(
    `/repos/${owner}/${repo}/contents/${encodeURIComponent(path).replace(/%2F/g, '/')}?ref=${encodeURIComponent(ref || DEFAULT_BASE)}`,
  );
  let content = '';
  if (data.encoding === 'base64' && data.content) {
    content = atob(data.content.replace(/\n/g, ''));
  }
  if (looksLikeSecretContent(content)) {
    return {
      ok: false,
      blocked: true,
      reason: 'File content looks like secrets — agent will not expose it',
      path: data.path,
    };
  }
  // Cap large files
  if (content.length > 400_000) {
    content = content.slice(0, 400_000) + '\n\n/* … truncated by agent for size … */';
  }
  return { ok: true, path: data.path, sha: data.sha, size: data.size, content };
}

async function actionSearchCode(repoSpec: string | undefined, query: string) {
  const { owner, repo } = parseRepo(repoSpec);
  if (!query) throw new Error('query required');
  const q = `${query} repo:${owner}/${repo}`;
  const data = await ghJson<{
    total_count: number;
    items: Array<{ path: string; html_url: string; name: string }>;
  }>(`/search/code?q=${encodeURIComponent(q)}&per_page=30`);
  const items = (data.items || [])
    .filter((i) => !isProtectedPath(i.path))
    .map((i) => ({ path: i.path, name: i.name, url: i.html_url }));
  return { ok: true, total: data.total_count, items };
}

async function actionListBranches(repoSpec?: string) {
  const { owner, repo } = parseRepo(repoSpec);
  const branches = await ghJson<Array<{ name: string; protected: boolean }>>(
    `/repos/${owner}/${repo}/branches?per_page=100`,
  );
  return {
    ok: true,
    branches: branches.map((b) => ({ name: b.name, protected: b.protected })),
  };
}

async function actionCreateBranch(
  repoSpec: string | undefined,
  task: string,
  base?: string,
  name?: string,
) {
  const { owner, repo } = parseRepo(repoSpec);
  const baseBranch = base || DEFAULT_BASE;
  if (name && (name === baseBranch || name === 'main' || name === 'master')) {
    throw new Error('Cannot use main/master as agent working branch');
  }
  const branch = name || branchNameFromTask(task);
  if (branch === 'main' || branch === 'master' || branch === baseBranch) {
    throw new Error('Refusing to create branch with protected name');
  }
  const refData = await ghJson<{ object: { sha: string } }>(
    `/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(baseBranch)}`,
  );
  await ghJson(`/repos/${owner}/${repo}/git/refs`, {
    method: 'POST',
    body: {
      ref: `refs/heads/${branch}`,
      sha: refData.object.sha,
    },
  });
  return { ok: true, branch, base: baseBranch, sha: refData.object.sha };
}

async function actionUpsertFile(params: {
  repo?: string;
  path: string;
  content: string;
  branch: string;
  message: string;
  sha?: string;
  confirmDestroy?: boolean;
}) {
  const { path, content, branch, message } = params;
  if (!path || !branch || !message) throw new Error('path, branch, message required');
  if (branch === 'main' || branch === 'master') {
    throw new Error('Direct commits to main/master are forbidden. Use an agent branch + PR.');
  }
  if (isProtectedPath(path)) {
    throw new Error('Refusing to write secret/protected path: ' + path);
  }
  if (looksLikeSecretContent(content)) {
    throw new Error('Refusing to commit content that looks like secrets/credentials');
  }
  const { owner, repo } = parseRepo(params.repo);
  // Get existing sha if not provided
  let sha = params.sha;
  if (!sha) {
    try {
      const existing = await ghJson<{ sha: string }>(
        `/repos/${owner}/${repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(branch)}`,
      );
      sha = existing.sha;
    } catch {
      sha = undefined; // new file
    }
  }
  const body: Record<string, string> = {
    message,
    content: btoa(unescape(encodeURIComponent(content))),
    branch,
  };
  if (sha) body.sha = sha;

  const result = await ghJson<{
    content: { path: string; sha: string; html_url: string };
    commit: { sha: string; html_url: string };
  }>(`/repos/${owner}/${repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}`, {
    method: 'PUT',
    body,
  });
  return {
    ok: true,
    path: result.content.path,
    commitSha: result.commit.sha,
    url: result.commit.html_url,
  };
}

async function actionDeleteFile(params: {
  repo?: string;
  path: string;
  branch: string;
  message: string;
  sha: string;
  confirmDestroy?: boolean;
}) {
  if (REQUIRE_DESTROY_CONFIRM && !params.confirmDestroy) {
    return {
      ok: false,
      needsConfirmation: true,
      message: 'Destructive delete requires confirmDestroy: true',
    };
  }
  if (params.branch === 'main' || params.branch === 'master') {
    throw new Error('Direct deletes on main/master are forbidden');
  }
  if (isProtectedPath(params.path)) {
    throw new Error('Refusing to delete protected path');
  }
  const { owner, repo } = parseRepo(params.repo);
  await ghJson(
    `/repos/${owner}/${repo}/contents/${params.path.split('/').map(encodeURIComponent).join('/')}`,
    {
      method: 'DELETE',
      body: {
        message: params.message,
        sha: params.sha,
        branch: params.branch,
      },
    },
  );
  return { ok: true, deleted: params.path, branch: params.branch };
}

async function actionCreatePR(params: {
  repo?: string;
  title: string;
  body: string;
  head: string;
  base?: string;
  draft?: boolean;
}) {
  const { owner, repo } = parseRepo(params.repo);
  const base = params.base || DEFAULT_BASE;
  if (params.head === base || params.head === 'main' || params.head === 'master') {
    throw new Error('PR head cannot be the default/main branch');
  }
  const pr = await ghJson<{
    number: number;
    html_url: string;
    title: string;
    state: string;
  }>(`/repos/${owner}/${repo}/pulls`, {
    method: 'POST',
    body: {
      title: params.title,
      body: params.body,
      head: params.head,
      base,
      draft: !!params.draft,
    },
  });
  return {
    ok: true,
    number: pr.number,
    url: pr.html_url,
    title: pr.title,
    state: pr.state,
  };
}

/** High-level workflow: inspect → branch → (caller applies files) → PR template */
async function actionStartTask(params: {
  repo?: string;
  task: string;
  base?: string;
}) {
  const status = await actionStatus(params.repo);
  const branch = await actionCreateBranch(params.repo, params.task, params.base);
  const tree = await actionListTree(params.repo, branch.base);
  return {
    ok: true,
    workflow: 'branch-first',
    policy: {
      noDirectMain: true,
      secretsBlocked: true,
      deleteNeedsConfirm: REQUIRE_DESTROY_CONFIRM,
      mergeOnlyViaPR: true,
    },
    repo: status.repo,
    base: branch.base,
    branch: branch.branch,
    fileCount: tree.count,
    samplePaths: tree.files.slice(0, 40).map((f) => f.path),
    next: [
      'search_code / read_file for relevant paths',
      'analyze dependencies before edits',
      'upsert_file on agent branch only',
      'run tests locally or via CI',
      'create_pr with summary + test results',
    ],
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const body = await req.json();
    const action = String(body.action || '').toLowerCase();

    switch (action) {
      case 'status':
        return json(await actionStatus(body.repo));
      case 'list_tree':
      case 'list_files':
        return json(await actionListTree(body.repo, body.ref || body.branch));
      case 'read_file':
        return json(await actionReadFile(body.repo, body.path, body.ref || body.branch));
      case 'search_code':
        return json(await actionSearchCode(body.repo, body.query));
      case 'list_branches':
        return json(await actionListBranches(body.repo));
      case 'create_branch':
        return json(
          await actionCreateBranch(body.repo, body.task || body.name || 'task', body.base, body.name),
        );
      case 'upsert_file':
      case 'write_file':
        return json(
          await actionUpsertFile({
            repo: body.repo,
            path: body.path,
            content: body.content,
            branch: body.branch,
            message: body.message,
            sha: body.sha,
            confirmDestroy: body.confirmDestroy,
          }),
        );
      case 'delete_file':
        return json(
          await actionDeleteFile({
            repo: body.repo,
            path: body.path,
            branch: body.branch,
            message: body.message || `Delete ${body.path}`,
            sha: body.sha,
            confirmDestroy: body.confirmDestroy,
          }),
        );
      case 'create_pr':
        return json(
          await actionCreatePR({
            repo: body.repo,
            title: body.title,
            body: body.body || body.description || '',
            head: body.head || body.branch,
            base: body.base,
            draft: body.draft,
          }),
        );
      case 'start_task':
        return json(await actionStartTask({ repo: body.repo, task: body.task, base: body.base }));
      default:
        return json({
          error: 'Unknown action',
          actions: [
            'status',
            'list_tree',
            'read_file',
            'search_code',
            'list_branches',
            'create_branch',
            'upsert_file',
            'delete_file',
            'create_pr',
            'start_task',
          ],
        }, 400);
    }
  } catch (err) {
    console.error(err);
    return json({ error: err instanceof Error ? err.message : 'Internal error' }, 500);
  }
});
