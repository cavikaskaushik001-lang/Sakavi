/**
 * Sakavi — Supabase client (same backend pattern as Blyque)
 */
(function () {
    const cfg = window.SAKAVI_CONFIG || {};
    const url = cfg.supabaseUrl || '';
    const key = cfg.supabaseAnonKey || '';

    if (!window.supabase) {
        console.warn('[Sakavi] Load @supabase/supabase-js before this file.');
        return;
    }

    window.sakaviSupabase = window.supabase.createClient(url, key, {
        auth: {
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: true,
            storageKey: 'sakavi-auth',
        },
    });
})();
