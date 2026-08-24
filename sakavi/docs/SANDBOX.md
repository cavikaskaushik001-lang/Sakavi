# Sakavi Secure Coding Sandbox

Modular Docker-based isolated environment for running tests, builds, and commands without touching the host root filesystem, Docker socket, secrets, or production environment.

This component lives in `sandbox/` and is intentionally **orthogonal** to the GitHub agent (browser + Supabase Edge). Use it when the AI needs real execution (npm test, pytest, build, etc.).

## Quick start (host with Docker)

```bash
cd sandbox
docker build -t sakavi-sandbox:latest .
npm install
node examples/basic-usage.js
```

## API

```js
import { createSandboxManager } from '../sandbox/src/index.js';

const manager = createSandboxManager();

const { sandboxId } = await manager.createSandbox({
  projectPath: '/absolute/path/to/repo',
  networkMode: 'none',   // or 'bridge' only for package installs
});

const result = await manager.executeCommand(sandboxId, 'npm test', {
  timeoutMs: 60_000,
});

// result: { stdout, stderr, exitCode, executionTimeMs, timedOut, blocked?, reason? }

await manager.destroySandbox(sandboxId);
```

Full security model, resource limits, blocked commands, and integration notes: see `sandbox/README.md`.

## Relationship to GitHub agent

| Concern | GitHub agent | Sandbox |
|---------|--------------|---------|
| Branch / PR / review | ✅ | — |
| Read/write files via GitHub API | ✅ | — |
| Run tests / build / lint locally | — | ✅ |
| Isolated non-root execution | — | ✅ |

Typical flow: inspect & edit via GitHub agent → run tests/build in sandbox → put results in PR body → human merges.

## Security (summary)

- Only project dir mounted at `/workspace`
- Host `/` and Docker socket never exposed
- Non-root (UID 1000), no `--privileged`, CapDrop ALL
- CPU / RAM / PIDs / timeout limits always on
- Network default `none`
- Dangerous commands blocked before execution
- No secrets, `.env`, SSH keys, or cloud credentials mounted
