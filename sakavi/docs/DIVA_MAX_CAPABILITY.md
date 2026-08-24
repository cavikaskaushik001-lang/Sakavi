# DIVA Maximum Capability (Controlled Boundary)

## Design principle

> Maximum capability **inside** a controlled infrastructure boundary.

DIVA has a **permanent** capability catalogue and tool universe so it does not rediscover permissions each task.  
It **cannot** disable, modify, or bypass: Policy Engine, Capability Manager, Tool Gateway, sandbox isolation, secret isolation, approval service, audit log, or kill switch.

## Permanent capability catalogue

`src/core/capability-catalogue.ts`

Includes: filesystem.*, process.*, git.*, github.*, database.*, network.*, browser.*, cloud.*, deployment.*, security.*, logs/monitoring.*, artifacts.*, plus orchestration/secrets aliases.

## Unified tool registry

`src/tools/registry.ts` — typed `ToolDefinition` with name, description, Zod input schema, capability, risk, timeout, category.

Handlers remain in `src/tools/register.ts` and only run via **Tool Gateway**.

## Specialists

| Agent | Role |
|-------|------|
| diva | Orchestrator (plan → critic → execute → verify → recover) |
| coder | Sandbox code changes / tests |
| debugger | Structured debug sessions |
| security | Authorized security research |
| github | Branch/PR workflow |
| database | Read/write/destructive tiers |
| browser / researcher | Untrusted external data |
| deployment / infrastructure | Plans, health, logs |
| monitoring | Health/metrics reads |

## Memory

`src/memory/` — task / project / technical / debugging / security stores with source, confidence, scope, trusted flag. `repo:`/`web:` sources cannot be trusted.

## Verification

`src/verification/` — phases: **attempted | successful | verified | failed** for code, security, deployment.

## Architecture

```
USER → DIVA (planner, memory, observer)
         → Task execution graph
         → Specialist agents
         → Tool registry
         → Infrastructure (Gateway → Policy → Caps → Sandbox/GitHub/DB/…)
         → Verification → Recovery → Result
```

External emergency stop remains **outside** DIVA.

## Remaining limitations

- Some cloud/DB/log handlers are stubs behind the same gates
- In-process task/memory stores (use durable store for multi-instance)
- Planner is heuristic (structured LLM can plug in without granting caps)
- Host Docker trust and operator approval channel still required

## Local verify

```bash
cd platform && npm install && npm test && npm run typecheck
```
