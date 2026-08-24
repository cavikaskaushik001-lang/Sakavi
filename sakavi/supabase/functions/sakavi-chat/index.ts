// Sakavi — chat Edge Function (all models: web search + internet tools)
// ------------------------------------------------------------
// Deploy:
//   supabase functions deploy sakavi-chat
//   supabase secrets set OPENAI_API_KEY=sk-...
// Optional:
//   supabase secrets set OPENAI_BASE_URL=https://api.openai.com/v1
//   supabase secrets set OPENAI_MODEL=gpt-4o-mini
//   supabase secrets set OPENAI_MODEL_DIVA=gpt-4o
//   supabase secrets set BRAVE_API_KEY=...   (better web search)
//
// Request body:
//   { messages, model?, length?, webSearch?, tools? }
// Response:
//   { reply, model, search? }
// ------------------------------------------------------------

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY') || '';
const OPENAI_BASE_URL = (Deno.env.get('OPENAI_BASE_URL') || 'https://api.openai.com/v1').replace(/\/$/, '');
const OPENAI_MODEL = Deno.env.get('OPENAI_MODEL') || 'gpt-4o-mini';
const BRAVE_API_KEY = Deno.env.get('BRAVE_API_KEY') || '';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

type SearchHit = { title: string; url: string; snippet: string; source: string };

async function searchBrave(query: string): Promise<SearchHit[]> {
  if (!BRAVE_API_KEY) return [];
  const res = await fetch(
    'https://api.search.brave.com/res/v1/web/search?q=' + encodeURIComponent(query) + '&count=6',
    {
      headers: {
        Accept: 'application/json',
        'X-Subscription-Token': BRAVE_API_KEY,
      },
    },
  );
  if (!res.ok) return [];
  const data = await res.json();
  const hits: SearchHit[] = [];
  for (const r of data.web?.results || []) {
    hits.push({
      title: r.title || 'Result',
      url: r.url || '',
      snippet: r.description || '',
      source: 'brave',
    });
  }
  return hits;
}

async function searchDuckDuckGo(query: string): Promise<SearchHit[]> {
  const hits: SearchHit[] = [];
  try {
    const res = await fetch(
      'https://api.duckduckgo.com/?format=json&no_redirect=1&no_html=1&q=' + encodeURIComponent(query),
    );
    if (res.ok) {
      const data = await res.json();
      if (data.AbstractText) {
        hits.push({
          title: data.Heading || 'Summary',
          url: data.AbstractURL || 'https://duckduckgo.com/?q=' + encodeURIComponent(query),
          snippet: data.AbstractText,
          source: 'ddg',
        });
      }
      for (const t of (data.RelatedTopics || []).slice(0, 5)) {
        if (t.Text && t.FirstURL) {
          hits.push({ title: t.Text.slice(0, 100), url: t.FirstURL, snippet: t.Text, source: 'ddg' });
        } else if (t.Topics) {
          for (const s of t.Topics.slice(0, 2)) {
            if (s.Text && s.FirstURL) {
              hits.push({ title: s.Text.slice(0, 100), url: s.FirstURL, snippet: s.Text, source: 'ddg' });
            }
          }
        }
      }
    }
  } catch (_) {}
  return hits;
}

async function searchWikipedia(query: string): Promise<SearchHit[]> {
  const hits: SearchHit[] = [];
  try {
    const res = await fetch(
      'https://en.wikipedia.org/w/api.php?action=opensearch&limit=5&namespace=0&format=json&search=' +
        encodeURIComponent(query),
    );
    if (res.ok) {
      const data = await res.json();
      const titles: string[] = data[1] || [];
      const descs: string[] = data[2] || [];
      const urls: string[] = data[3] || [];
      for (let i = 0; i < titles.length; i++) {
        hits.push({
          title: titles[i],
          url: urls[i],
          snippet: descs[i] || '',
          source: 'wikipedia',
        });
      }
    }
  } catch (_) {}
  return hits;
}

async function fetchPublicUrl(url: string): Promise<SearchHit | null> {
  try {
    const u = new URL(url);
    if (u.hostname.endsWith('wikipedia.org')) {
      const title = decodeURIComponent(u.pathname.split('/').pop() || '');
      const res = await fetch(
        'https://en.wikipedia.org/api/rest_v1/page/summary/' + encodeURIComponent(title),
      );
      if (!res.ok) return null;
      const data = await res.json();
      return {
        title: data.title || title,
        url: data.content_urls?.desktop?.page || url,
        snippet: data.extract || '',
        source: 'url',
      };
    }
    // Generic public page — limited text extract
    const res = await fetch(url, {
      headers: { 'User-Agent': 'SakaviBot/1.0 (web-search; +https://sakavi.app)' },
      redirect: 'follow',
    });
    if (!res.ok) return null;
    const ct = res.headers.get('content-type') || '';
    if (!/text|html|json|xml/i.test(ct)) return null;
    let text = await res.text();
    text = text.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ');
    text = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 2500);
    return { title: u.hostname, url, snippet: text, source: 'url' };
  } catch (_) {
    return null;
  }
}

function shouldSearch(text: string, webSearch: boolean): boolean {
  if (!webSearch) return false;
  const q = (text || '').toLowerCase();
  if (!q.trim()) return false;
  if (/https?:\/\//.test(q)) return true;
  if (/\b(search|google|latest|today|news|current|price|stock|weather|who is|what is|2024|2025|2026|research|lookup|look up|browse)\b/i.test(q)) {
    return true;
  }
  if (q.length < 140 && /\?/.test(text)) return true;
  // Default ON for tool-enabled models: light heuristic — search on most non-chitchat
  if (q.length > 12 && !/^(hi|hey|hello|thanks|thank you|ok|okay)\b/.test(q)) return true;
  return false;
}

function formatSearchBlock(hits: SearchHit[], query: string): string {
  if (!hits.length) {
    return `[Web search for "${query}" returned no hits. Answer carefully and note uncertainty.]`;
  }
  const lines = hits.map((h, i) => `${i + 1}. ${h.title}\n   ${h.url}\n   ${h.snippet.slice(0, 500)}`);
  return (
    `[Live web search results for "${query}" — all Sakavi models have internet + sandbox tools]\n` +
    lines.join('\n') +
    `\n[Cite title + URL when you use a result.]`
  );
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    if (!OPENAI_API_KEY) {
      return json({
        error: 'OPENAI_API_KEY not set on sakavi-chat function',
        hint: 'supabase secrets set OPENAI_API_KEY=...',
      }, 503);
    }

    const authHeader = req.headers.get('Authorization') || '';
    if (authHeader.startsWith('Bearer ') && SERVICE_ROLE_KEY && SUPABASE_URL) {
      const token = authHeader.replace('Bearer ', '');
      if (token.length > 40) {
        const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
        const { data } = await admin.auth.getUser(token);
        void data;
      }
    }

    const body = await req.json();
    const messages = body.messages;
    if (!Array.isArray(messages) || !messages.length) {
      return json({ error: 'messages array required' }, 400);
    }

    const webSearch = body.webSearch !== false;
    const lastUser = [...messages].reverse().find((m: { role: string }) => m.role === 'user');
    const userText = String(lastUser?.content || '');

    let searchHits: SearchHit[] = [];
    let searchQuery = '';

    if (shouldSearch(userText, webSearch)) {
      searchQuery = userText.replace(/\[Live web search[\s\S]*$/i, '').trim().slice(0, 200);
      const urlMatch = userText.match(/https?:\/\/[^\s\]]+/);
      const tasks: Promise<SearchHit[]>[] = [
        searchBrave(searchQuery),
        searchDuckDuckGo(searchQuery),
        searchWikipedia(searchQuery),
      ];
      if (urlMatch) {
        tasks.push(fetchPublicUrl(urlMatch[0]).then((h) => (h ? [h] : [])));
      }
      const batches = await Promise.all(tasks);
      const seen = new Set<string>();
      for (const batch of batches) {
        for (const h of batch) {
          if (!h.url || seen.has(h.url)) continue;
          seen.add(h.url);
          searchHits.push(h);
        }
      }
      searchHits = searchHits.slice(0, 8);
    }

    // Cap context + inject search
    let trimmed = messages.slice(-24).map((m: { role: string; content: string }) => ({
      role: m.role === 'assistant' ? 'assistant' : m.role === 'system' ? 'system' : 'user',
      content: String(m.content || '').slice(0, 8000),
    }));

    if (searchHits.length || (webSearch && searchQuery)) {
      const block = formatSearchBlock(searchHits, searchQuery || userText.slice(0, 120));
      // Append to last user message if not already present
      for (let i = trimmed.length - 1; i >= 0; i--) {
        if (trimmed[i].role === 'user') {
          if (!/\[Live web search/i.test(trimmed[i].content)) {
            trimmed[i] = { ...trimmed[i], content: trimmed[i].content + '\n\n' + block };
          }
          break;
        }
      }
      // Ensure system message mentions tools
      const sysIdx = trimmed.findIndex((m) => m.role === 'system');
      const toolNote =
        '\nYou have live web search, URL fetch, and sandbox analysis tools. Use the search block when present. Cite sources.';
      if (sysIdx >= 0) {
        if (!/live web search/i.test(trimmed[sysIdx].content)) {
          trimmed[sysIdx] = { ...trimmed[sysIdx], content: trimmed[sysIdx].content + toolNote };
        }
      } else {
        trimmed = [{ role: 'system', content: 'You are Sakavi.' + toolNote }, ...trimmed];
      }
    }

    const requested = String(body.model || '').toLowerCase();
    let model = OPENAI_MODEL;
    if (requested === 'diva') {
      model =
        Deno.env.get('OPENAI_MODEL_DIVA') ||
        Deno.env.get('OPENAI_MODEL_FLAGSHIP') ||
        Deno.env.get('OPENAI_MODEL_PRO') ||
        OPENAI_MODEL;
    } else if (requested === 'vigrah') {
      model = Deno.env.get('OPENAI_MODEL_VIGRAH') || Deno.env.get('OPENAI_MODEL_PRO') || OPENAI_MODEL;
    } else if (requested === 'sakavi-mini') {
      model = Deno.env.get('OPENAI_MODEL_MINI') || 'gpt-4o-mini';
    } else if (requested === 'sakavi-1' || requested === 'sakavi-study') {
      model = OPENAI_MODEL;
    } else if (requested) {
      model = requested;
    }

    const res = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model,
        messages: trimmed,
        temperature:
          requested === 'diva' ? 0.55 :
          requested === 'sakavi-study' || requested === 'vigrah' ? 0.4 : 0.7,
        max_tokens:
          requested === 'diva'
            ? (body.length === 'short' ? 800 : body.length === 'detailed' ? 3200 : 2000)
            : body.length === 'short' ? 400 : body.length === 'detailed' ? 1600 : 900,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error('Upstream error', res.status, errText);
      return json({ error: 'Upstream model error', detail: errText.slice(0, 300) }, 502);
    }

    const data = await res.json();
    const reply = data.choices?.[0]?.message?.content || '';
    return json({
      reply,
      model: data.model || model,
      search: searchQuery
        ? { query: searchQuery, count: searchHits.length, sources: searchHits.map((h) => h.url) }
        : null,
    });
  } catch (err) {
    console.error(err);
    return json({ error: 'Internal error' }, 500);
  }
});
