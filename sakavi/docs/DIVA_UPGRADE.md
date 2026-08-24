# DIVA Upgrade Report

## Architecture changes

DIVA is no longer a single heuristic loop. It runs a fixed cognitive pipeline:

```
INPUT → INTENT_ANALYSIS → CONTEXT_BUILDING → TASK_DECOMPOSITION
  → RISK_ANALYSIS → EXECUTION_PLAN → PLAN_VALIDATION (Critic)
  → EXECUTION → OBSERVATION → VERIFICATION → RECOVERY → FINAL_RESULT
```

**Unchanged security spine:** Capability Manager → Policy Engine → Tool Gateway → Sandbox / specialists.  
DIVA still **cannot** self-approve HIGH/CRITICAL actions, disable the kill switch, or mount host secrets.

## New files

| Path | Purpose |
|------|---------|
| `platform/src/agents/diva/types.ts` | `DivaTaskState`, `PlanStep`, budgets, observations |
| `platform/src/agents/diva/planner.ts` | Intent analysis + hierarchical decomposition |
| `platform/src/agents/diva/plan-critic.ts` | Independent plan review |
| `platform/src/agents/diva/risk-engine.ts` | Impact/reversibility risk (non-model) |
| `platform/src/agents/diva/executor.ts` | Delegate + verify criteria |
| `platform/src/agents/diva/recovery.ts` | Failure class + recovery policy |
| `platform/src/agents/diva/memory.ts` | Working + long-term memory |
| `platform/src/agents/diva/timeline.ts` | Scrubbed execution timeline |
| `platform/tests/diva/pipeline.test.ts` | Planner/critic/risk/recovery unit tests |
| `docs/DIVA_UPGRADE.md` | This report |

## Modified files

| Path | Change |
|------|--------|
| `platform/src/agents/diva/index.ts` | Full pipeline + pause/resume/cancel/emergencyStop |
| `platform/src/index.ts` | Export new DIVA controls & types |
| `platform/README.md` | Cognitive pipeline documentation |

## New capabilities (behavioral, not privilege escalation)

- Hierarchical plans with **dependencies** and **success criteria**
- **Plan Critic** before execution
- Independent **risk engine** and **confidence** (advisory only)
- **Verification** after specialist results
- Structured **recovery** (no blind destructive retries)
- **Working / long-term memory** with untrusted tagging
- **Budgets**: tool calls, duration, plan revisions, reflection cycles, parallelism
- **Checkpoints** before/after high-risk steps
- **Timeline** observability (secrets redacted)
- Operator **pause / resume / cancel / emergencyStop**

## Security improvements

- Critic blocks coder+`deployment.execute` and circular deps
- High-risk steps require rollback strategy notes
- Network capability flagged when unjustified in plan
- Secrets capability always surfaces as critical critic issue
- Recovery never auto-retries `critical` steps
- External research/browser observations marked `untrusted`
- Long-term memory cannot trust `repo:` / `web:` sources
- Confidence never used as authorization
- Emergency stop cancels in-flight DIVA tasks + activates global kill switch

## Test results

Unit tests live in `platform/tests/diva/pipeline.test.ts`.

On a complete install:

```bash
cd platform && npm install && npm test
```

This environment had incomplete optional native deps for `tsx`/esbuild; re-run tests on a full `npm install`.

## Example complex task (planning → verification)

**Objective:** `Fix login bug, run tests, open draft PR`

1. **INTENT** — `needsWrite=true`, hints: coder, github  
2. **DECOMPOSE** — inspect repo → security skim → implement in sandbox → re-test → github PR  
3. **RISK** — overall `high` (github.write / PR)  
4. **CRITIC** — ensures test step + success criteria; blocks unsafe capability mixes  
5. **EXECUTE** — each step via specialist → Tool Gateway (sandbox/github)  
6. **VERIFY** — criteria checked against observations; PR step does not write `main`  
7. **FINAL** — summary with verified step counts, residual risks, pending approvals if any  

If GitHub write requires approval, status becomes `awaiting_approval` and DIVA **stops** until a human approves via `approvalService`.

## Remaining limitations / attack surface

| Item | Notes |
|------|-------|
| Planner is heuristic, not LLM | Replace with constrained structured LLM later; still must not grant capabilities |
| In-memory task store | Multi-instance needs durable store |
| Verification is heuristic | Prefer compiler/tests/diff as ground truth when wiring deeper |
| Specialist GitHub/DB handlers partially stubbed | Wire to existing Edge/Octokit/DB with same gates |
| Host Docker trust | Unchanged assumption |
| Prompt injection | External data tagged untrusted; policy is code, not prompt — still validate any future LLM planner I/O |

**Not claimed:** fully secure or unbreakable. Security rests on external control plane + isolation, not on DIVA “being careful.”
