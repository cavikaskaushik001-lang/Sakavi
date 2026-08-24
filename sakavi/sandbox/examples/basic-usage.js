/**
 * Example workflow matching the required AI agent flow:
 *
 *   AI request
 *   → sandbox create
 *   → repository available at /workspace
 *   → AI executes commands / modifies code / runs tests / builds
 *   → results returned
 *   → sandbox destroy
 *
 * Run after:
 *   docker build -t sakavi-sandbox:latest .
 *   npm install
 *   node examples/basic-usage.js
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSandboxManager } from '../src/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Use a tiny demo project inside this repo (or point to any real project)
const PROJECT_PATH = path.resolve(__dirname, '../example-project');

async function main() {
  const manager = createSandboxManager({
    // Optional overrides
    // memoryLimit: '1g',
    // cpuLimit: 1,
    // defaultTimeoutMs: 60_000,
  });

  console.log('1. Creating sandbox…');
  const { sandboxId, status, networkMode } = await manager.createSandbox({
    projectPath: PROJECT_PATH,
    networkMode: 'none', // start with no network
  });
  console.log('   →', { sandboxId, status, networkMode });

  // 2. Inspect environment
  console.log('\n2. Checking tools inside sandbox…');
  const tools = await manager.executeCommand(
    sandboxId,
    'node -v && npm -v && python3 --version && git --version && whoami && pwd'
  );
  console.log(tools.stdout.trim());
  console.log('   exitCode:', tools.exitCode, '| time:', tools.executionTimeMs, 'ms');

  // 3. List project files
  console.log('\n3. Listing /workspace…');
  const ls = await manager.executeCommand(sandboxId, 'ls -la');
  console.log(ls.stdout);

  // 4. Run a simple test / script
  console.log('\n4. Running example script…');
  const run = await manager.executeCommand(sandboxId, 'node index.js');
  console.log('stdout:', run.stdout.trim());
  console.log('stderr:', run.stderr.trim());
  console.log('exitCode:', run.exitCode, '| time:', run.executionTimeMs, 'ms');

  // 5. Demonstrate blocked dangerous command
  console.log('\n5. Attempting blocked command (should be rejected)…');
  const blocked = await manager.executeCommand(sandboxId, 'sudo rm -rf /');
  console.log('blocked:', blocked.blocked, '| reason:', blocked.reason);

  // 6. Package install requires network – recreate or note the policy
  console.log('\n6. Network is disabled by default. Package installs need networkMode: "bridge".');

  // 7. Destroy
  console.log('\n7. Destroying sandbox…');
  await manager.destroySandbox(sandboxId);
  console.log('   → done');

  // Clean up any leftovers
  await manager.destroyAll();
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
