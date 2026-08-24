# Sakavi Secure Coding Sandbox

Docker-based isolated environment for AI coding agents.  
The agent can **read / modify / test / build** project code without ever touching the host root filesystem, Docker socket, secrets, or production environment.

Designed as a **modular drop-in component** for the existing Sakavi agent (no architectural rewrite required).

---

## Security Guarantees

| Requirement | Enforcement |
|-------------|-------------|
| Project mounted only at `/workspace` | `Binds: [projectPath:/workspace:rw]` |
| Host `/` never mounted | Explicit path validation + Docker HostConfig |
| Docker socket never exposed | Never added to `Binds` or volumes |
| Non-root user | `User: "1000:1000"` (matches Dockerfile) |
| No `--privileged` | `Privileged: false` hard-coded |
| Capabilities dropped | `CapDrop: ["ALL"]` + `no-new-privileges` |
| CPU / RAM / PIDs limited | `Memory`, `NanoCpus`, `PidsLimit` always set |
| Command timeout | Hard timeout on every `executeCommand` |
| stdout / stderr / exit / time captured | Returned on every call |
| Dangerous commands blocked | `SecurityValidator` pre-flight regex + path checks |
| Network restricted by default | `networkMode: "none"`; opt-in `"bridge"` only when needed |
| Secrets never injected | No `.env`, SSH keys, cloud credentials, or host secrets mounted |
| Easy destroy / recreate | `destroySandbox()` + `destroyAll()` |

---

## Quick Start

### 1. Prerequisites
- Docker Engine 20+ running on the host
- Node.js 18+

### 2. Build the sandbox image
```bash
cd sakavi-sandbox
docker build -t sakavi-sandbox:latest .
```

### 3. Install the manager package
```bash
npm install
```

### 4. Run the example
```bash
node examples/basic-usage.js
```

---

## API (exactly as requested)

```js
import { createSandboxManager } from './src/index.js';

const manager = createSandboxManager();

// 1. Create
const { sandboxId } = await manager.createSandbox({
  projectPath: '/absolute/path/to/your/repo',  // only this dir is mounted
  networkMode: 'none',                         // or 'bridge' for npm/pip install
  memory: '2g',
  cpus: 2,
});

// 2. Execute (any shell command)
const result = await manager.executeCommand(sandboxId, 'npm test', {
  timeoutMs: 60_000,
  workdir: '/workspace',          // optional, must stay under /workspace
});

// 3. Inspect output
const output = manager.getCommandOutput(result);
/*
{
  stdout: string,
  stderr: string,
  exitCode: number,
  executionTimeMs: number,
  timedOut: boolean,
  blocked?: boolean,
  reason?: string
}
*/

// 4. Destroy (always call when done)
await manager.destroySandbox(sandboxId);
```

### Additional helpers
```js
manager.listSandboxes();   // currently active
manager.destroyAll();      // clean everything created by this process
```

---

## Typical AI Agent Workflow

```
User asks AI to implement a feature
        │
        ▼
manager.createSandbox({ projectPath: repoOnDisk, networkMode: 'none' })
        │
        ▼
AI inspects:  ls, cat package.json, find, grep, git status …
        │
        ▼
AI edits files (write via host-side tools OR via echo/cat inside sandbox)
        │
        ▼
(If dependencies needed)
  destroy → recreate with networkMode: 'bridge'
  executeCommand('npm ci')  or  'pip install -r requirements.txt'
  (then optionally switch back to network:none for pure execution)
        │
        ▼
executeCommand('npm test') / 'npm run build' / 'pytest' …
        │
        ▼
Results (stdout/stderr/exit/time) returned to AI
        │
        ▼
manager.destroySandbox(sandboxId)   // or destroyAll()
```

Because the project directory is a **bind mount**, any file changes the AI makes inside `/workspace` are immediately visible on the host (and vice-versa). The container is only an execution + isolation boundary.

---

## Configuration

Copy `.env.example` → `.env` or pass options to the constructor / `createSandbox`.

| Variable / option | Default | Meaning |
|-------------------|---------|---------|
| `SANDBOX_IMAGE` | `sakavi-sandbox:latest` | Image name |
| `SANDBOX_MEMORY` | `2g` | Memory hard limit |
| `SANDBOX_CPUS` | `2` | CPU quota |
| `SANDBOX_PIDS` | `256` | Max processes |
| `SANDBOX_TIMEOUT_MS` | `120000` | Default command timeout |
| `SANDBOX_MAX_TIMEOUT_MS` | `600000` | Absolute ceiling |
| `SANDBOX_NETWORK` | `none` | Default network mode |

---

## Adding Extra Tools

The base image already contains:
- git
- Node.js 22 + npm
- Python 3 + pip
- build-essential (for native modules)

To add more (e.g. Go, Rust, JDK, Playwright browsers):

1. Extend the `Dockerfile`:
   ```dockerfile
   RUN apt-get update && apt-get install -y --no-install-recommends golang-go \
       && rm -rf /var/lib/apt/lists/*
   ```
2. Rebuild: `docker build -t sakavi-sandbox:latest .`
3. Or install at runtime inside a network-enabled sandbox:
   ```js
   await manager.executeCommand(id, 'npm install -g typescript', { timeoutMs: 120000 });
   ```

Prefer baking tools into the image for speed and reproducibility.

---

## Integration with Existing Sakavi Agent

The current Sakavi GitHub agent lives in the browser + Supabase Edge Function and only talks to the GitHub API.  
This sandbox is intentionally **orthogonal**:

- Keep the GitHub agent for branch / PR / review workflow.
- Add a **local or backend runner** that uses `SandboxManager` when the agent needs to actually execute tests or builds.
- Possible placements:
  1. **Local CLI / desktop companion** – agent asks the companion to run tests.
  2. **Self-hosted worker** – a small Node service on a machine that has Docker; Edge Function proxies the request.
  3. **Future “ci-agent” Edge Function** – if you later run a Docker-capable runner.

Because the public surface is only four methods (`createSandbox`, `executeCommand`, `getCommandOutput`, `destroySandbox`), the existing frontend and Edge Function need almost no changes.

---

## Important Security Notes for Operators

- The **host** that runs Docker must be trusted. Docker itself is the isolation boundary; a compromised Docker daemon can escape any container.
- Never mount production `.env`, SSH keys, cloud credentials, or the Docker socket into the sandbox.
- Prefer `networkMode: 'none'` for pure execution. Enable `bridge` only for the duration of `npm install` / `pip install`, then destroy and recreate without network if you want maximum isolation.
- The block-list in `SecurityValidator` is a defense-in-depth layer. The primary controls are the Docker HostConfig (no privileges, no socket, limited resources, non-root).
- Always call `destroySandbox` (or `destroyAll`) when a task finishes so experimental processes and containers do not accumulate.

---

## File Layout

```
sakavi-sandbox/
├── Dockerfile                 # Non-root image with git/node/python
├── docker-compose.yml         # Optional local demo
├── package.json
├── .env.example
├── README.md
├── src/
│   ├── index.js               # Public exports
│   ├── SandboxManager.js      # create / execute / destroy
│   ├── SecurityValidator.js   # Command & path policy
│   └── config.js              # Defaults + block patterns
├── examples/
│   └── basic-usage.js
└── example-project/           # Tiny demo repo for the example
```

---

## License

MIT – use freely inside Sakavi or any other AI coding agent.
