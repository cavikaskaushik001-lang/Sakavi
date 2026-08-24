# DIVA V3.0

Long-horizon autonomous engineering / debugging / research / authorized security analysis — **with infrastructure safety intact**.

## Architecture

```
USER
 → INTENT ENGINE (existing planner analyzeIntent)
 → CONTEXT ENGINE (working memory + permanent catalogues)
 → PROJECT GRAPH (src/project/graph.ts)
 → PLANNER + PLAN CRITIC + RISK ENGINE (existing)
 → TASK EXECUTION GRAPH (task-engine scheduler)
 → SPECIALIST AGENTS
 → TOOL GATEWAY → EXECUTION
 → OBSERVATION → VERIFICATION (independent)
 → SELF-EVALUATION (advisory)
 → RECOVERY / CHECKPOINT
 → FINAL REPORT (VERIFIED_SUCCESS | PARTIAL | FAILED | BLOCKED | UNKNOWN)
 → BENCHMARK DATA
```

## New modules

| Path | Purpose |
|------|---------|
| `core/task-engine/*` | Durable tasks: create/pause/resume/cancel/checkpoint |
| `core/evidence/*` | FACT vs HYPOTHESIS discipline |
| `core/self-evaluation.ts` | Stage evaluation + confidence calibration |
| `project/graph.ts` | Project intelligence + impact analysis |
| `evaluation/benchmark.ts` + `cases.ts` | Measurable benchmarks |
| `agents/diva/v3-report.ts` | Honest final reports + quality scores |

## Preserved

- Capability Manager, Policy Engine, Tool Gateway
- Sandbox isolation, secrets, approvals, audit, kill switch
- Existing DIVA pipeline, security research, debug sessions
- Specialist agents and tool registry

## Final status honesty

Never `VERIFIED_SUCCESS` if verification is incomplete.

## Benchmarks

```bash
cd platform && npm install
node --import tsx -e "import { runBenchmarks } from './src/evaluation/benchmark.js'; import './src/evaluation/cases.js'; console.log(runBenchmarks());"
```

Or `npm test` (includes `tests/diva/v3.test.ts`).

## Remaining limitations

- Full crash-recovery depends on `DIVA_TASK_DIR` persistence path writability
- Project graph is path-heuristic until deeper AST wiring
- Self-eval cannot replace CI/compiler/tests
- Some cloud/DB integrations remain stubs behind the same gates
- “Self-improving” only via measured benchmarks + failure memory — not automatic weight updates

## Before/after (design metrics)

| Metric | Pre-V3 | V3 |
|--------|--------|-----|
| Task resume after pause | Limited in-memory | Checkpoint + disk JSON |
| Failed strategy loop prevention | Soft | Recorded + `wasStrategyTried` |
| Hypothesis as fact | Possible in text | Evidence engine downgrades |
| Impact analysis | Ad hoc | Project graph |
| Success labeling | Informal | FinalStatus enum + report guard |
| Measurable quality | Manual | Benchmark suite + TaskQuality |
