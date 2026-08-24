# DIVA Security Research & Debugging Specialization

## Objective

```
Find → Understand → Reproduce safely → Verify → Fix → Retest → Document
```

DIVA is **not** an uncontrolled offensive executor. All security work requires an explicit `SecurityScope` with `authorizationId`, owner, allowlists, and permitted actions.

## Layout

```
platform/src/security/
  index.ts          # runSecurityResearch workflow
  types.ts          # SecurityScope, SecurityFinding
  scope.ts          # authorization boundary
  recon.ts          # passive recon
  scanner.ts        # static patterns
  analyzer.ts       # architecture / auth hints
  verifier.ts       # false-positive reduction
  remediation.ts    # root cause + branch workflow
  reporter.ts       # markdown report

platform/src/debug/
  index.ts          # runDebugSession
  error-analyzer.ts
  stacktrace.ts
  dependency-analyzer.ts
  runtime-analyzer.ts
  regression.ts
  verifier.ts
```

## Authorization

```ts
import { runSecurityResearch } from '@sakavi/platform';

const result = await runSecurityResearch({
  userId: 'analyst-1',
  objective: 'Passive audit of owned lab app',
  scope: {
    target: 'payments-lab',
    owner: 'security@example.com',
    authorizationId: 'ENG-2026-081',
    allowedHosts: ['lab.internal'],
    allowedPaths: ['/workspace'],
    permittedActions: ['recon.repo', 'analyze.code', 'analyze.secrets'],
    environment: 'lab',
  },
  allowDynamic: false,
}, {
  files: [{ path: 'src/api.ts', content: sourceText }],
});
```

If scope is missing/expired/ambiguous → **STOP SECURITY TESTING**.

## Finding format

Each finding separates **observed facts** from **hypotheses**.  
Static matches stay `unverified` / not `CONFIRMED` until safe reproduction in scope.

## Debugging

```ts
import { runDebugSession } from '@sakavi/platform';

const report = await runDebugSession({
  userId: 'dev-1',
  objective: 'Investigate test failure',
  scope: {
    projectPath: '/abs/path/to/repo',
    failingCommand: 'npm test',
  },
  stackTrace: '...',
  logs: ['...'],
});
```

Flow: observe → reproduce (sandbox) → localize → hypothesize → minimal fix path → retest → regression suggestion.  
A single disappearing error does **not** count as fixed.

## Workflow diagram

```
SECURITY TASK → AUTHORIZATION CHECK → SCOPE → PASSIVE ANALYSIS
        → CODE ANALYSIS / optional DYNAMIC (allowlisted)
        → FINDINGS → VERIFICATION → ROOT CAUSE
        → REMEDIATION PLAN → REGRESSION → RETEST → REPORT
```

## Acceptance stance

Optimized for deep analysis, safe verification, accurate debugging, high-quality remediation, and repeatable testing — **not** for maximizing impact on systems.
