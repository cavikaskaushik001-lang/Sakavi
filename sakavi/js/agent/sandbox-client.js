/**
 * Sakavi — Coding Sandbox client (thin stub)
 *
 * The real Docker sandbox runs on a trusted host/worker (see sandbox/).
 * Tokens and Docker socket NEVER live in the browser.
 *
 * This client talks to a future / existing backend endpoint that proxies
 * to SandboxManager (createSandbox / executeCommand / destroySandbox).
 *
 * Until a backend worker is deployed, methods throw a clear message.
 * Existing GitHub agent architecture is unchanged.
 */
(function () {
  const DEFAULT_PATH = '/functions/v1/sandbox-agent'; // optional future Edge/worker path

  function cfg() {
    return window.SAKAVI_CONFIG || {};
  }

  async function call(action, params) {
    const c = cfg();
    const base = c.sandboxAgentUrl || (c.supabaseUrl ? `${c.supabaseUrl}${DEFAULT_PATH}` : null);
    if (!base) {
      throw new Error(
        'Sandbox worker not configured. Run the Docker sandbox locally ' +
          '(see docs/SANDBOX.md and sandbox/README.md) or set SAKAVI_CONFIG.sandboxAgentUrl.'
      );
    }

    const client = window.sakaviSupabase;
    let token = c.supabaseAnonKey;
    if (client) {
      try {
        const { data } = await client.auth.getSession();
        if (data?.session?.access_token) token = data.session.access_token;
      } catch (_) {}
    }

    const res = await fetch(base, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + token,
        apikey: c.supabaseAnonKey || '',
      },
      body: JSON.stringify({ action, ...params }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || data.message || 'Sandbox agent error ' + res.status);
    }
    if (data.error) throw new Error(data.error);
    return data;
  }

  async function createSandbox(opts) {
    return call('createSandbox', opts || {});
  }

  async function executeCommand(sandboxId, command, options) {
    return call('executeCommand', { sandboxId, command, ...(options || {}) });
  }

  async function getCommandOutput(result) {
    return result || null;
  }

  async function destroySandbox(sandboxId) {
    return call('destroySandbox', { sandboxId });
  }

  async function status() {
    return call('status', {});
  }

  window.SakaviSandbox = {
    createSandbox,
    executeCommand,
    getCommandOutput,
    destroySandbox,
    status,
  };
})();
