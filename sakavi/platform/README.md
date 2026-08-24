# Sakavi Agent Platform

Production-oriented, **capability-controlled** autonomous agent runtime.

Existing Sakavi frontend, Supabase Edge functions (`sakavi-chat`, `github-agent`), and the Docker sandbox image are **preserved**. This `platform/` package adds the orchestration and security control plane.

## Architecture

```
USER
  │
  ▼
DIVA (orchestrator)
  │
  ▼
Capability Manager ──► time-bounded grants, no isAdmin flag
  │
  ▼
Policy Engine ──► branch protection, network allowlist, SQL class, etc.
  │
  ▼
Tool Gateway ──► sole entry for side effects
  │
  ├── Coder ──► Sandbox (non-root, no socket, limits)
  ├── GitHub ──► server-side token only
  ├── Database ──► read / write / destructive gates
  ├── Deployment ──► plan → approval → deploy → health
  ├── Security ──► inspect only (cannot disable controls)
  ├── Research / Browser ──► untrusted external data
  └── Audit + Approval + Kill switch
```

## Agents (`src/agents/*/index.ts`)

| Agent | Role | Default capabilities |
|-------|------|----------------------|
| `diva` | Orchestrator | delegate, read, research, security.inspect |
| `coder` | Edit/test in sandbox | workspace.*, process.execute |
| `github` | Branch-first PR workflow | github.read/write/pull_request |
| `research` | External queries | research.query, network.read |
| `browser` | Allowlisted navigation | browser.navigate, network.read |
| `database` | SQL with tiers | database.read (+ write/destructive gated) |
| `deployment` | Controlled release | deployment.request/execute |
| `security` | Review & reports | security.inspect, workspace.read |

Each agent has: manifest, timeouts, retries, circuit breaker, task state, audit.

## Quick start

```bash
cd platform
npm install
npm run typecheck
npm test
```

Build sandbox image (from repo root):

```bash
cd ../sandbox && docker build -t sakavi-sandbox:latest .
```

## Operator controls

```ts
import { initPlatform, killSwitch, approvalService, runDiva } from './src/index.js';

initPlatform();

// Emergency stop (agents cannot call this)
killSwitch.activate('incident', 'ops@example.com');

// Approve a pending HIGH/CRITICAL action
approvalService.decide({
  approvalId: '...',
  status: 'approved',
  decidedBy: 'ops@example.com',
});

const result = await runDiva({
  userId: 'user-1',
  objective: 'Inspect the repo and run tests',
  projectPath: '/abs/path/to/project',
});
```

## Security invariants

- No `--privileged`, no Docker socket, no host `/` mounts
- Network **disabled** by default; allowlist when enabled
- Secrets never in prompts, logs, frontend, or git
- Protected branches (`main`/`master`/…) cannot be written directly
- Destructive DB and production deploy require human approval
- Kill switch is outside agent control
- Prompt/repo/web content is treated as **untrusted**

See `docs/SECURITY_REPORT.md` for residual risks and assumptions.

## Relation to existing code

| Existing | Status |
|----------|--------|
| `js/*`, HTML UI | Unchanged |
| `supabase/functions/github-agent` | Unchanged (server-side GitHub) |
| `supabase/functions/sakavi-chat` | Unchanged |
| `sandbox/` (Docker image + JS manager) | Preserved; TS `platform/src/sandbox` is the hardened runtime used by the gateway |

Wire Edge functions or a worker to `initPlatform()` + agent `run*` exports when deploying the control plane.

## DIVA cognitive pipeline

```
INPUT → INTENT → CONTEXT → DECOMPOSE → RISK → PLAN → CRITIC
  → EXECUTE → OBSERVE → VERIFY → RECOVER → FINAL
```

Modules under `src/agents/diva/`:

| File | Role |
|------|------|
| `index.ts` | Pipeline orchestration, pause/resume/cancel/emergencyStop |
| `planner.ts` | Intent analysis + hierarchical decomposition |
| `plan-critic.ts` | Independent plan review |
| `risk-engine.ts` | Impact/reversibility risk (not model self-score) |
| `executor.ts` | Delegate + verify success criteria |
| `recovery.ts` | Failure classification + policy |
| `memory.ts` | Working + validated long-term memory |
| `timeline.ts` | Scrubbed execution trace |
| `types.ts` | Durable `DivaTaskState`, `PlanStep`, etc. |

Controls:

```ts
import { runDiva, pauseTask, cancelTask, emergencyStop, getTaskTimeline } from '@sakavi/platform';

const out = await runDiva({
  userId: 'u1',
  objective: 'Fix login bug, run tests, open draft PR',
  projectPath: '/abs/path/to/repo',
});

// Operator only
pauseTask(out.taskId);
cancelTask(out.taskId);
emergencyStop('incident', 'ops@example.com');
```

DIVA **cannot** self-approve HIGH/CRITICAL capabilities or deactivate the kill switch.
