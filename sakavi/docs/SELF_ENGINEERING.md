# DIVA Self-Engineering

Autonomous engineering on **DIVA's own source**, with hard limits:

- No direct overwrite of the running production version
- No autonomous modification of protected security infrastructure
- Activation / rollback remain **external**
- Never claim verified success without independent tests

## Workspace

```
platform/self-development/
  snapshots/ branches/ patches/ test-results/ reviews/ reports/
```

## Commands

```bash
cd platform
npm run self:diagnose   # architecture + static findings
npm run self:audit      # test gaps / maintainability
npm run self:repair     # prioritize finding → patch proposal → review
```

## Agents

- `agents/self-engineer` — diagnose, audit, architecture map
- `agents/self-reviewer` — independent review (diff/tests/budget/protected paths)

## Workflow

```
SELF ISSUE → isolated branch name → checkpoint metadata → patch proposal
 → typecheck/tests plan → self-reviewer → PREPARED_PR or NEEDS_EXTERNAL_REVIEW
 → (external) canary → activate / rollback
```

## Protected (analyze OK, auto-activate forbidden)

kill-switch, secrets, approval, policy-engine, capability-manager, tool-gateway, audit, sandbox isolation, security scope, self-dev protected/budget modules

## Budgets

max files, patch bytes, attempts, concurrent tasks — infrastructure enforced in `self-dev/budget.ts`

## Example

1. `self:diagnose` → findings (unconfirmed static)
2. `self:repair` → `SelfRepairReport` with `verified: false`
3. Human/CI applies patch on branch, runs `npm test`
4. Only then can status become verified externally

## Remaining limitations

- Patch is a **proposal** text (not live AST rewrite of disk in all environments)
- Full canary runtime comparison needs external runner
- Static findings are hypotheses until tests confirm
- Compiler/lint integration should be wired via sandbox tools in CI
