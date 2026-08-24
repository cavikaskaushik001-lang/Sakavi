# Sakavi GitHub Coding Agent

Secure, modular connection between the Sakavi AI agent and a GitHub repository.

## Principles

| Rule | Enforcement |
|------|-------------|
| No tokens in frontend / source | `GITHUB_TOKEN` only as Supabase Edge secret |
| No direct commits to `main`/`master` | Server rejects writes on protected branches |
| Branch-first workflow | `start_task` creates `sakavi/agent-…` branch |
| Merge only via PR | Agent creates PR; human merges |
| Secrets never read/committed | Blocks `.env`, keys, credential patterns |
| Destructive ops need confirm | `delete_file` requires `confirmDestroy: true` |
| Minimum permissions | Fine-grained PAT: contents + pull requests on one repo |

## Setup

### 1. Create a Fine-grained Personal Access Token (or GitHub App installation token)

Recommended scopes on **one repository**:

- **Contents**: Read and write  
- **Pull requests**: Read and write  
- **Metadata**: Read  

Do **not** grant: administration, delete repository, workflows (unless CI control is intentional).

### 2. Set Edge Function secrets

```bash
supabase secrets set GITHUB_TOKEN=github_pat_... --project-ref YOUR_REF
supabase secrets set GITHUB_REPO=owner/repo-name --project-ref YOUR_REF
# optional
supabase secrets set GITHUB_DEFAULT_BASE=main --project-ref YOUR_REF
```

### 3. Deploy the function

```bash
supabase functions deploy github-agent --project-ref YOUR_REF
```

### 4. Frontend config (no secrets)

In `js/config.js`:

```js
githubRepo: '',              // optional display override; server uses GITHUB_REPO secret
githubAgentFunction: 'github-agent',
```

Load scripts:

```html
<script src="js/supabase-client.js"></script>
<script src="js/agent/github-agent.js"></script>
```

## Workflow (required)

```
User task
  → status / list_tree / search_code / read_file   (inspect)
  → start_task / create_branch                    (new branch only)
  → upsert_file on agent branch                   (modify)
  → run tests/build/lint (CI or local)            (verify)
  → create_pr with summary + test results         (review)
  → human reviews & merges                        (merge)
```

### Client example

```js
// Inspect
await SakaviGitHub.status();
await SakaviGitHub.searchCode('function handleAuth');
await SakaviGitHub.readFile('src/app.ts', 'main');

// Branch + changes + draft PR
const result = await SakaviGitHub.proposeChanges({
  task: 'Add health check endpoint',
  summary: 'Adds GET /health returning { ok: true } without touching auth.',
  testResults: 'npm test — pass (12)\nnpm run lint — pass',
  files: [
    {
      path: 'src/health.ts',
      content: 'export const health = () => ({ ok: true });\n',
      message: 'feat: health check helper',
    },
  ],
  draft: true,
});
console.log(result.pr.url);
```

## Actions (API)

| Action | Purpose |
|--------|---------|
| `status` | Repo connection + default branch |
| `list_tree` | All non-secret file paths |
| `read_file` | File content (secrets blocked) |
| `search_code` | Code search in repo |
| `list_branches` | Branch list |
| `create_branch` | Agent working branch from base |
| `upsert_file` | Create/update file on agent branch |
| `delete_file` | Delete with `confirmDestroy: true` |
| `create_pr` | Open PR (never auto-merge) |
| `start_task` | Inspect + create branch + policy |

## What the agent must do before editing

1. **Search** relevant symbols and paths.  
2. **Read** nearby files and dependency manifests (`package.json`, etc.).  
3. Prefer **minimal diffs** — do not rewrite unrelated code.  
4. After edits, run **test / build / lint** when available; put results in the PR body.  
5. On failure, read logs, fix on the **same branch**, push again.

## Future modules (same pattern)

Edge functions + secrets only:

- `deploy-agent` — Vercel/Netlify tokens  
- `supabase-migrate` — DB migrations with service role  
- `ci-agent` — trigger/read GitHub Actions  

**Local / worker execution (already shipped):**

- `sandbox/` — secure Docker coding sandbox (`docs/SANDBOX.md`)  
  Run tests/builds in isolation; never expose Docker socket or host secrets to the browser.

Never embed those credentials in the static frontend.

## Security checklist

- [ ] Token is fine-grained and repo-scoped  
- [ ] Secrets only in Supabase Edge secrets  
- [ ] Default branch has branch protection + required PR  
- [ ] Agent PRs default to **draft**  
- [ ] `.env` and credential files remain unreadable/uncommitable by agent  
- [ ] Humans merge after review  
