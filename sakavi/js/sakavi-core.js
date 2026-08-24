/**
 * Sakavi core — chat, history, streaming-ish replies
 */
(function () {
    const STORAGE_CHATS = 'sakavi_chats_v1';
    const STORAGE_SETTINGS = 'sakavi_settings_v1';

    const defaultSettings = {
        model: 'sakavi-1',
        length: 'balanced',
        persona: 'friendly',
        rememberContext: true,
        theme: 'dark',
        voiceIn: true,
        voiceOut: false,
        voiceStyle: 'default',
    };

    function getModelMeta(id) {
        const list = (window.SAKAVI_CONFIG && window.SAKAVI_CONFIG.models) || [];
        return list.find((m) => m.id === id) || list[0] || { id: id || 'sakavi-1', name: id || 'Sakavi 1', desc: '' };
    }

    function modelLabel(id) {
        return getModelMeta(id).name;
    }

    function loadSettings() {
        try {
            return { ...defaultSettings, ...JSON.parse(localStorage.getItem(STORAGE_SETTINGS) || '{}') };
        } catch (_) {
            return { ...defaultSettings };
        }
    }

    function saveSettings(s) {
        localStorage.setItem(STORAGE_SETTINGS, JSON.stringify(s));
    }

    function loadChats() {
        try {
            return JSON.parse(localStorage.getItem(STORAGE_CHATS) || '[]');
        } catch (_) {
            return [];
        }
    }

    function saveChats(list) {
        localStorage.setItem(STORAGE_CHATS, JSON.stringify(list.slice(0, 50)));
    }

    function uid() {
        return 'c_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    }

    function getChat(id) {
        return loadChats().find((c) => c.id === id) || null;
    }

    function upsertChat(chat) {
        const list = loadChats().filter((c) => c.id !== chat.id);
        list.unshift(chat);
        saveChats(list);
        return chat;
    }

    function deleteChat(id) {
        saveChats(loadChats().filter((c) => c.id !== id));
    }

    function titleFromMessages(messages) {
        const first = messages.find((m) => m.role === 'user');
        if (!first) return 'New chat';
        const t = (first.content || '').trim().replace(/\s+/g, ' ');
        return t.length > 42 ? t.slice(0, 42) + '…' : t || 'New chat';
    }

    function buildSystemPrompt(settings) {
        const cfg = window.SAKAVI_CONFIG || {};
        let base = cfg.systemPrompt || 'You are Sakavi, a helpful AI assistant.';
        const model = settings.model || 'sakavi-1';
        if (model === 'diva') {
            base = `You are Diva — the flagship model of the Sakavi family: the strongest, most capable assistant available here.

Identity & quality bar:
- You are a general-purpose expert system: reasoning, coding, writing, research-style analysis, study help, planning, and creative work.
- Aim for answers that feel like a top-tier AI product: accurate, structured, and useful on the first try.
- Match the user's language (Hindi, Hinglish, English, etc.). Never claim to be human.

How you work:
- For hard problems: think step-by-step, state assumptions, then conclude. Show key intermediate reasoning when it helps.
- For code: write correct, runnable solutions; explain briefly; note edge cases and tests when relevant.
- For study (exams, CA, concepts): definitions → intuition → steps → short practice check.
- For writing: clear structure, strong opening, and a natural voice unless a tone is requested.
- For files/images the user shares: use any provided text or captions; ask for missing detail only when necessary.
- When unsure, say so and suggest what would improve the answer. Do not invent citations or facts.

Style:
- Premium and calm — confident without arrogance. Prefer clarity over fluff.
- Use short paragraphs, headings, or bullets when structure helps. Full depth when the user needs it.
- If the user asks for “everything” or a broad task, cover the important angles first, then offer deeper dives.`;
        } else if (model === 'vigrah') {
            base =
                'You are Vigrah, the advanced reasoning model in the Sakavi family. Think step-by-step, check assumptions, and give precise, structured answers. Prefer clarity over fluff.';
        } else if (model === 'sakavi-mini') {
            base =
                'You are Sakavi Mini — a fast, lightweight assistant. Keep replies short and practical. Skip long preambles. Prefer 2–5 sentences or tight bullets.';
        }
        const persona = {
            friendly: 'Tone: warm and conversational.',
            professional: 'Tone: professional and concise.',
            tutor: 'Tone: patient tutor — use steps and examples.',
            witty: 'Tone: light wit, still accurate.',
        }[settings.persona] || '';
        const length = {
            short: 'Keep answers short (a few sentences unless asked for more).',
            balanced: 'Balance brevity and depth.',
            detailed: 'Give thorough explanations when useful.',
        }[settings.length] || '';
        return [base, persona, length].filter(Boolean).join('\n');
    }

    /** Demo replies when no API configured */
    function demoReply(userText, settings) {
        const q = (userText || '').toLowerCase();
        const mName = modelLabel(settings.model);
        if (/hello|hi\b|hey|namaste|hola/.test(q)) {
            if (settings.model === 'diva') {
                return 'Hey — I’m **Diva**, Sakavi’s strongest model. Bring the hard stuff: architecture, proofs, full essays, debug sessions, or a plan from zero to ship.';
            }
            return 'Hey — I’m **' + mName + '**. Ask me anything: ideas, writing, code, study notes, or plans for the day.';
        }
        if (/who are you|what are you|tum kaun|model/.test(q)) {
            if (settings.model === 'diva') {
                return (
                    'I’m **Diva** — Sakavi’s flagship model. I’m built for the hardest asks: deep reasoning, full coding workflows, long-form writing, study walkthroughs, and multi-step plans.\n\n' +
                    'Other models in the family: **Sakavi 1** (balanced), **Vigrah** (reasoning focus), **Sakavi Mini** (speed). Switch anytime from Settings → Model.'
                );
            }
            return (
                'I’m **' +
                mName +
                '** (Sakavi family). Models: **Diva** (flagship), **Sakavi 1**, **Vigrah**, **Sakavi Mini**. Switch from Settings → Model or the pill above the composer.'
            );
        }
        if (/ca\b|exam|study|syllabus/.test(q)) {
            return 'For study help, share the topic or a question. I’ll break it into steps, key definitions, and a short practice check.\n\nExample: “Explain AS 2 inventory valuation simply.”';
        }
        if (/code|javascript|python|html|bug/.test(q)) {
            return 'Paste the snippet or describe the error. I’ll suggest a fix and a short explanation.\n\n*(Connect OpenAI-compatible API or deploy `sakavi-chat` for full model answers.)*';
        }
        if (/thank/.test(q)) {
            return 'Glad it helped. Anything else?';
        }
        const tip =
            settings.length === 'short'
                ? 'Short take: '
                : settings.length === 'detailed'
                  ? 'Here’s a fuller take:\n\n'
                  : '';
        if (settings.model === 'diva') {
            return (
                tip +
                '**Diva** (demo) received: “' +
                userText.slice(0, 140) +
                (userText.length > 140 ? '…' : '') +
                '”.\n\n' +
                'In live mode I would structure a full answer: clarify the goal → key options or steps → concrete output (code, outline, or plan) → risks & next actions.\n\n' +
                '**Demo mode** is on — connect `sakavi-chat` or an OpenAI-compatible API in `js/config.js` for real flagship-quality replies. UI, history, voice, and files already work.'
            );
        }
        return (
            tip +
            'I understood: “' +
            userText.slice(0, 120) +
            (userText.length > 120 ? '…' : '') +
            '”.\n\n' +
            '**Demo mode** · model **' +
            mName +
            '**. To go live:\n' +
            '1. Deploy Supabase function `sakavi-chat` with `OPENAI_API_KEY`, or\n' +
            '2. Set `openaiCompatUrl` + key in `js/config.js`.\n\n' +
            'Meanwhile, ask another question — history and UI are fully working.'
        );
    }

    async function callOpenAICompat(messages, settings) {
        const cfg = window.SAKAVI_CONFIG || {};
        const url = cfg.openaiCompatUrl;
        const key = cfg.openaiCompatKey;
        if (!url || !key) return null;

        const res = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: 'Bearer ' + key,
            },
            body: JSON.stringify({
                model: cfg.openaiModel || 'gpt-4o-mini',
                messages: [{ role: 'system', content: buildSystemPrompt(settings) }, ...messages],
                temperature: 0.7,
            }),
        });
        if (!res.ok) {
            const err = await res.text();
            throw new Error('API ' + res.status + ': ' + err.slice(0, 200));
        }
        const data = await res.json();
        return data.choices?.[0]?.message?.content || '';
    }

    async function callEdgeFunction(messages, settings) {
        const cfg = window.SAKAVI_CONFIG || {};
        const client = window.sakaviSupabase;
        if (!client) return null;

        const { data: sessionData } = await client.auth.getSession();
        const token = sessionData?.session?.access_token || cfg.supabaseAnonKey;

        const res = await fetch(`${cfg.supabaseUrl}/functions/v1/${cfg.chatFunction}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: 'Bearer ' + token,
                apikey: cfg.supabaseAnonKey,
            },
            body: JSON.stringify({
                messages: [{ role: 'system', content: buildSystemPrompt(settings) }, ...messages],
                model: settings.model,
                length: settings.length,
            }),
        });

        if (res.status === 404 || res.status === 401) return null;
        if (!res.ok) {
            const err = await res.text();
            // Treat missing function as "try next"
            if (res.status >= 500) throw new Error(err.slice(0, 200));
            return null;
        }
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        return data.reply || data.content || data.message || '';
    }

    async function generateReply(messages, settings) {
        // 1) Direct OpenAI-compatible
        try {
            const direct = await callOpenAICompat(messages, settings);
            if (direct) return { text: direct, source: 'api' };
        } catch (e) {
            console.warn('[Sakavi] OpenAI compat failed', e);
            // fall through
        }

        // 2) Supabase edge
        try {
            const edge = await callEdgeFunction(messages, settings);
            if (edge) return { text: edge, source: 'edge' };
        } catch (e) {
            console.warn('[Sakavi] Edge failed', e);
            if (!(window.SAKAVI_CONFIG || {}).allowDemoMode) throw e;
        }

        // 3) Demo
        if ((window.SAKAVI_CONFIG || {}).allowDemoMode !== false) {
            const last = [...messages].reverse().find((m) => m.role === 'user');
            await new Promise((r) => setTimeout(r, 400 + Math.random() * 500));
            return { text: demoReply(last?.content || '', settings), source: 'demo' };
        }

        throw new Error('No AI backend configured');
    }

    /** Simple markdown-ish to HTML */
    function formatMessage(text) {
        let t = (text || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
        t = t.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
        t = t.replace(/`([^`]+)`/g, '<code>$1</code>');
        t = t.replace(/\n/g, '<br>');
        return t;
    }


    function resolveAppearance(raw) {
        const v = (raw || 'System (Default)').toString();
        if (/light/i.test(v)) return 'light';
        if (/dark/i.test(v)) return 'dark';
        return 'system';
    }

    function applyTheme(appearance) {
        const mode = resolveAppearance(appearance != null ? appearance : loadSettings().appearance);
        document.documentElement.setAttribute('data-theme', mode);
        const meta = document.querySelector('meta[name="theme-color"]');
        if (meta) {
            const light = mode === 'light' || (mode === 'system' && window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches);
            meta.setAttribute('content', light ? '#f2f2f7' : '#0e0e14');
        }
        return mode;
    }

    // Apply as early as possible when script loads
    try {
        applyTheme();
        if (window.matchMedia) {
            window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
                if (resolveAppearance(loadSettings().appearance) === 'system') applyTheme('System (Default)');
            });
        }
    } catch (_) {}

    window.Sakavi = {
        loadSettings,
        saveSettings,
        loadChats,
        getChat,
        upsertChat,
        deleteChat,
        uid,
        titleFromMessages,
        generateReply,
        formatMessage,
        buildSystemPrompt,
        getModelMeta,
        modelLabel,
        applyTheme,
        resolveAppearance,
    };
})();
