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
- **Clean URLs**: links use paths without `.html` (e.g. `/settings`, `/history`).  
  - Netlify: `_redirects` is included.  
  - Vercel: `vercel.json` rewrites are included.  
  - nginx: add try_files or rewrite rules for extensionless paths.
- **nginx**: point root to `sakavi/`.
- No Node build step required.

## Privacy

- Chat history is stored in **browser localStorage** only (`sakavi_chats_v1`).
- Live model calls go to your edge function / API — not to Blyque app servers.

## Branding

Purple / indigo gradient, name **Sakavi**, logo letter **S**. Change `SAKAVI_CONFIG.name` and CSS variables in `css/sakavi.css` if needed.
