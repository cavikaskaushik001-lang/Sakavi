# Sakavi — AI Assistant

Standalone AI chat app. **Name: Sakavi.**  
Uses the same Supabase project pattern as Blyque, but you can deploy this frontend anywhere (Vercel, Netlify, Cloudflare Pages, S3, nginx).

## What's included

| Path | Purpose |
|------|---------|
| `index.html` | Main chat UI |
| `history.html` | On-device chat history |
| `settings.html` | Model, length, persona, privacy |
| `js/config.js` | Supabase URL + optional OpenAI-compatible API |
| `js/sakavi-core.js` | Chat engine, history, demo fallback |
| `js/supabase-client.js` | Supabase client |
| `css/sakavi.css` | Dark premium UI |
| `supabase/functions/sakavi-chat/` | Edge function → OpenAI-compatible models |
| `manifest.json` + `service-worker.js` | PWA install |

## Quick start (demo works offline)

```bash
cd sakavi
npx serve .
# or: python3 -m http.server 8080
```

Open the URL — chat works in **Demo mode** without any API key.

## Go live (recommended: edge function)

1. Install Supabase CLI and link your project (same as Blyque or a new one).

2. Deploy the function:

```bash
supabase functions deploy sakavi-chat --project-ref YOUR_REF
supabase secrets set OPENAI_API_KEY=sk-your-key --project-ref YOUR_REF
# optional:
# supabase secrets set OPENAI_BASE_URL=https://api.openai.com/v1
# supabase secrets set OPENAI_MODEL=gpt-4o-mini
```

3. In `js/config.js` set:

```js
supabaseUrl: 'https://YOUR_REF.supabase.co',
supabaseAnonKey: 'your-anon-key',
chatFunction: 'sakavi-chat',
```

## Alternative: direct OpenAI-compatible API

In `js/config.js`:

```js
openaiCompatUrl: 'https://api.openai.com/v1/chat/completions',
openaiCompatKey: 'sk-...',   // prefer edge function so key is not in the browser
openaiModel: 'gpt-4o-mini',
```

Works with OpenAI, Groq, Together, Azure OpenAI (compatible path), etc.

## Deploy frontend separately

- **Vercel / Netlify / Cloudflare Pages**: upload the `sakavi/` folder as static site.
- **Clean URLs**: app links use paths without `.html` (e.g. `settings`, `history`).  
  - On static hosts, configure your own rewrites if extensionless routes 404.  
  - Files on disk remain `settings.html`, `history.html`, etc.
- **nginx**: point root to `sakavi/`.
- No Node build step required.

## Privacy

- Chat history is stored in **browser localStorage** only (`sakavi_chats_v1`).
- Live model calls go to your edge function / API — not to Blyque app servers.

## Branding

Purple / indigo gradient, name **Sakavi**, logo letter **S**. Change `SAKAVI_CONFIG.name` and CSS variables in `css/sakavi.css` if needed.


## GitHub Coding Agent

Secure repo access for the AI coding agent (branch-first + Pull Requests only).

- Edge function: `supabase/functions/github-agent`
- Client: `js/agent/github-agent.js`
- Guide: `docs/GITHUB_AGENT.md`

```bash
supabase secrets set GITHUB_TOKEN=github_pat_... 
supabase secrets set GITHUB_REPO=owner/repo
supabase functions deploy github-agent
```

Never put tokens in `js/` or commit `.env`. Agent refuses writes to `main` and blocks secret files.

## Coding agents

| Module | Path | Role |
|--------|------|------|
| GitHub agent | `js/agent/github-agent.js` + Edge function | Branch-first edits, PRs, no direct main |
| Secure sandbox | `sandbox/` | Isolated Docker runs for test/build/lint |

Docs:

- `docs/GITHUB_AGENT.md` — GitHub workflow & security
- `docs/SANDBOX.md` — Docker sandbox quick start
- `sandbox/README.md` — Full sandbox API, limits, security model

Frontend stub (optional, needs a worker): `js/agent/sandbox-client.js`  
(`createSandbox` / `executeCommand` / `getCommandOutput` / `destroySandbox`)

Typical flow: GitHub agent for branch + file changes → sandbox for `npm test` / build → results in PR body → human merge.

## Agent platform (control plane)

See `platform/README.md` and `docs/SECURITY_REPORT.md`.

TypeScript strict agent runtime with DIVA orchestrator, capability manager, policy engine, tool gateway, hardened sandbox integration, audit, approvals, and kill switch. Existing UI and Supabase Edge functions remain supported.
