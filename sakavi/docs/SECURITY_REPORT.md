# Sakavi Platform — Security Report

**Date:** 2026-08-24  
**Scope:** Agent platform (`platform/`), hardened sandbox, capability model, existing GitHub Edge agent.

## What was strengthened

1. **Capability-based access** — no global `isAdmin`. Every action maps to a named capability with risk level, scope, expiry, and audit.
2. **Tool Gateway** — single chokepoint: auth context → capability → policy → approval → execute → audit.
3. **Policy Engine** — protected branches, network allowlist, private/metadata IP block, SQL class enforcement, unknown-tool deny-by-default.
4. **Sandbox isolation** — non-root, `no-new-privileges`, `CapDrop ALL`, no Docker socket, project-only bind mount, CPU/RAM/PIDs/timeout/output limits, network default `none`.
5. **Human approval** — HIGH/CRITICAL and always-approve capabilities cannot be self-approved by DIVA.
6. **Kill switch** — process-wide emergency stop; not exposed as an agent tool.
7. **Audit** — structured events with input hashing and secret redaction.
8. **Secrets provider** — values only revealed to trusted handlers after capability grant; never logged.
9. **Prompt-injection stance** — research/browser results marked untrusted; policies are not data-driven from repo/web content.

## Residual risks and assumptions

| Risk | Severity | Assumption / mitigation needed in production |
|------|----------|-----------------------------------------------|
| Docker daemon compromise | Critical | Host running Docker is trusted; restrict who can talk to the daemon |
| Worker process compromise | Critical | Run control plane with least privilege; separate from frontend |
| Incomplete GitHub/DB/deploy adapters | Medium | Current handlers stub some external calls; wire to real Octokit/DB/deploy with same gates |
| LLM planner inside DIVA | Medium | Heuristic planner only; if replaced by LLM, constrain outputs to schema and never let model output grant capabilities |
| Network allowlist gaps | Medium | Review and tighten allowlist per environment; prefer egress proxy |
| Audit sink is in-memory by default | Medium | Replace `MemoryAuditSink` with append-only store / SIEM |
| Sandbox image supply chain | Medium | Pin base image digests; scan image; rebuild regularly |
| Human approval channel | Medium | Integrate real out-of-band approval (Slack/email/UI) with authenticated operators |
| Shared task store in-process | Low | For multi-instance deploy, use durable task state with authz |
| TypeScript platform vs Deno Edge | Low | Edge functions remain Deno; platform is Node worker — keep tokens only server-side |

## Explicit non-claims

- Command **blocklists alone are not** the security boundary. Isolation + allowlists + capability grants are.
- The system is **not** safe if the host Docker socket is exposed to untrusted users.
- Passing tests does **not** prove absence of sandbox escapes against a malicious kernel/Docker bug.
- Stubs that return success without calling real cloud APIs must not be mistaken for production integrations.

## Recommended production checklist

- [ ] Deploy platform as a private worker (not in the static frontend bundle)
- [ ] `GITHUB_TOKEN` fine-grained, single-repo, in server secrets only
- [ ] Replace audit sink with durable immutable log
- [ ] Wire real DB driver behind `database.query` with statement timeouts
- [ ] Wire deploy provider behind plan/execute with short-lived tokens
- [ ] Egress proxy for any `network.read`
- [ ] Operator UI for approvals + kill switch
- [ ] Continuous security tests in CI (`npm run test:security`)
- [ ] Image scanning for `sakavi-sandbox:latest`

## Conclusion

The platform prioritizes **broad capability with narrow authority**: DIVA can request powerful work, but Policy Engine, approvals, and isolation decide what actually runs. Security is control-plane driven, not “trust the model” or “trust the blacklist.”
