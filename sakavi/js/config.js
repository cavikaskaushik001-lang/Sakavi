/**
 * Sakavi — config
 * Same Supabase project as Blyque by default.
 * Deploy edge function `sakavi-chat` separately, or set OPENAI_COMPAT_URL.
 */
window.SAKAVI_CONFIG = {
    name: 'Sakavi',
    tagline: 'Your AI assistant',
    version: '1.4.0',

    // Same backend as Blyque
    supabaseUrl: 'https://rdhrtsucpmwknlbrcasq.supabase.co',
    supabaseAnonKey: 'sb_publishable_hWk7s4ePw0cqJ5kkHQ4tgg_FQjUo_mZ',

    // Edge function path (deploy on same or other Supabase project)
    chatFunction: 'sakavi-chat',

    // GitHub Coding Agent (token ONLY on edge: GITHUB_TOKEN, GITHUB_REPO secrets)
    githubAgentFunction: 'github-agent',
    githubRepo: '', // optional; server uses GITHUB_REPO secret when empty

    // Optional: direct OpenAI-compatible API (OpenAI, Groq, Together, etc.)
    // Leave empty to use Supabase edge function or local demo mode.
    openaiCompatUrl: '', // e.g. 'https://api.openai.com/v1/chat/completions'
    openaiCompatKey: '', // set only for local testing; prefer edge function secrets
    openaiModel: 'gpt-4o-mini',

    // Available models (id used in settings + edge function)
    models: [
        {
            id: 'diva',
            name: 'Diva',
            desc: 'Flagship · web + full tools · strongest all-round AI',
            badge: 'Flagship',
        },
        {
            id: 'sakavi-1',
            name: 'Sakavi 1',
            desc: 'Balanced · web search · everyday chat & writing',
            badge: 'Default',
        },
        {
            id: 'vigrah',
            name: 'Vigrah',
            desc: 'Reasoning + web · deeper answers',
            badge: 'Pro',
        },
        {
            id: 'sakavi-mini',
            name: 'Sakavi Mini',
            desc: 'Fast · web search · quick replies',
            badge: 'Fast',
        },
    ],

    // Tools available to every model
    tools: {
        webSearch: true,       // live web search
        fetchUrl: true,        // fetch public page text
        sandbox: true,         // safe analysis sandbox (no host OS access)
        fullInternet: true,    // models may use live web context
    },

    // Optional: Brave Search API key for higher-quality results (edge function)
    // braveSearchKey is set as secret BRAVE_API_KEY on the edge function

    // Demo mode replies when no backend key is configured
    allowDemoMode: true,

    systemPrompt: `You are Sakavi, a warm, sharp AI assistant.
Be clear, honest, and helpful. Prefer short paragraphs and bullet points when useful.
If the user asks for study help (exams, CA, concepts), explain step-by-step.
Never claim to be human. If unsure, say so. Reply in the same language the user writes in.`,
};
