// Sakavi — chat Edge Function
// ------------------------------------------------------------
// Deploy (same or separate Supabase project):
//   supabase functions deploy sakavi-chat
//   supabase secrets set OPENAI_API_KEY=sk-...
// Optional:
//   supabase secrets set OPENAI_BASE_URL=https://api.openai.com/v1
//   supabase secrets set OPENAI_MODEL=gpt-4o-mini
//
// Request body:
//   { messages: [{role, content}], model?, length? }
// Response:
//   { reply: string, model: string }
// ------------------------------------------------------------

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY') || '';
const OPENAI_BASE_URL = (Deno.env.get('OPENAI_BASE_URL') || 'https://api.openai.com/v1').replace(/\/$/, '');
const OPENAI_MODEL = Deno.env.get('OPENAI_MODEL') || 'gpt-4o-mini';

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

    // Optional: verify JWT if present (anon key also allowed for public demo)
    const authHeader = req.headers.get('Authorization') || '';
    if (authHeader.startsWith('Bearer ') && SERVICE_ROLE_KEY && SUPABASE_URL) {
      const token = authHeader.replace('Bearer ', '');
      // skip strict check for anon key length — real user JWT optional
      if (token.length > 40) {
        const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
        const { data } = await admin.auth.getUser(token);
        // data.user may be null for anon — still allow chat
        void data;
      }
    }

    const body = await req.json();
    const messages = body.messages;
    if (!Array.isArray(messages) || !messages.length) {
      return json({ error: 'messages array required' }, 400);
    }

    // Cap context size
    const trimmed = messages.slice(-24).map((m: { role: string; content: string }) => ({
      role: m.role === 'assistant' ? 'assistant' : m.role === 'system' ? 'system' : 'user',
      content: String(m.content || '').slice(0, 8000),
    }));

    const model = body.model === 'sakavi-study' ? OPENAI_MODEL : (body.model || OPENAI_MODEL);

    const res = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        messages: trimmed,
        temperature: body.model === 'sakavi-study' ? 0.4 : 0.7,
        max_tokens: body.length === 'short' ? 400 : body.length === 'detailed' ? 1600 : 900,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error('Upstream error', res.status, errText);
      return json({ error: 'Upstream model error', detail: errText.slice(0, 300) }, 502);
    }

    const data = await res.json();
    const reply = data.choices?.[0]?.message?.content || '';
    return json({ reply, model: data.model || model });
  } catch (err) {
    console.error(err);
    return json({ error: 'Internal error' }, 500);
  }
});
