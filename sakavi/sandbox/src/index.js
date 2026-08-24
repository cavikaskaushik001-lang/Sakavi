/**
 * Public API for Sakavi Secure Coding Sandbox
 *
 * Usage:
 *   import { SandboxManager, createSandboxManager } from './src/index.js';
 *
 *   const manager = createSandboxManager();
 *   const { sandboxId } = await manager.createSandbox({ projectPath: '/abs/path/to/project' });
 *   const result = await manager.executeCommand(sandboxId, 'npm test');
 *   console.log(result.stdout, result.exitCode, result.executionTimeMs);
 *   await manager.destroySandbox(sandboxId);
 */

export { SandboxManager } from './SandboxManager.js';
export { SecurityValidator } from './SecurityValidator.js';
export { DEFAULT_CONFIG, BLOCKED_PATTERNS } from './config.js';

import { SandboxManager } from './SandboxManager.js';

/**
 * Factory
 * @param {object} [options]  Override DEFAULT_CONFIG
 * @returns {SandboxManager}
 */
export function createSandboxManager(options = {}) {
  return new SandboxManager(options);
}

/** Optional process-wide singleton */
let _defaultManager = null;
export function getDefaultManager(options = {}) {
  if (!_defaultManager) {
    _defaultManager = new SandboxManager(options);
  }
  return _defaultManager;
}
