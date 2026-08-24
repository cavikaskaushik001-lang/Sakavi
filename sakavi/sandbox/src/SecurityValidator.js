/**
 * SecurityValidator – blocks dangerous commands and path escapes
 * before they ever reach the container.
 */

import { BLOCKED_PATTERNS, ALLOWED_INSTALL_PREFIXES } from './config.js';
import path from 'node:path';

export class SecurityValidator {
  /**
   * Validate a command string.
   * @param {string} command
   * @param {{ allowNetwork?: boolean }} options
   * @returns {{ ok: boolean, reason?: string }}
   */
  static validateCommand(command, options = {}) {
    if (!command || typeof command !== 'string') {
      return { ok: false, reason: 'Command must be a non-empty string' };
    }

    const trimmed = command.trim();
    if (trimmed.length === 0) {
      return { ok: false, reason: 'Empty command' };
    }

    // Length guard (prevent huge payloads)
    if (trimmed.length > 32_768) {
      return { ok: false, reason: 'Command too long' };
    }

    // Block dangerous patterns
    for (const pattern of BLOCKED_PATTERNS) {
      if (pattern.test(trimmed)) {
        return {
          ok: false,
          reason: `Blocked by security policy: matched ${pattern}`,
        };
      }
    }

    // If network is disabled, still allow most commands,
    // but flag obvious package installs so caller can decide.
    if (!options.allowNetwork) {
      const lower = trimmed.toLowerCase();
      const isInstall = ALLOWED_INSTALL_PREFIXES.some((p) =>
        lower.startsWith(p.toLowerCase())
      );
      if (isInstall) {
        return {
          ok: false,
          reason:
            'Package installation requires network. Call executeCommand with { network: true } or createSandbox({ networkMode: "bridge" }).',
        };
      }
    }

    return { ok: true };
  }

  /**
   * Ensure a path stays inside /workspace (prevents container path traversal tricks).
   * @param {string} filePath  relative or absolute path as seen by the agent
   * @returns {{ ok: boolean, safePath?: string, reason?: string }}
   */
  static sanitizeWorkspacePath(filePath) {
    if (!filePath || typeof filePath !== 'string') {
      return { ok: false, reason: 'Path required' };
    }

    // Reject absolute host-style paths that try to escape
    if (filePath.startsWith('/') && !filePath.startsWith('/workspace')) {
      // Allow only /workspace/... 
      return { ok: false, reason: 'Absolute paths outside /workspace are forbidden' };
    }

    // Normalize and resolve against /workspace
    const base = '/workspace';
    const candidate = filePath.startsWith('/workspace')
      ? filePath
      : path.posix.join(base, filePath);

    const resolved = path.posix.normalize(candidate);

    if (!resolved.startsWith(base + '/') && resolved !== base) {
      return { ok: false, reason: 'Path escapes /workspace' };
    }

    // Block common secret locations even inside workspace
    const lower = resolved.toLowerCase();
    const secretHints = [
      '/.env',
      '/.env.local',
      '/.env.production',
      '/.aws/',
      '/.ssh/',
      '/credentials.json',
      '/service-account',
      '/id_rsa',
      '/id_ed25519',
      '/.git/config', // can contain tokens in some setups
    ];
    for (const hint of secretHints) {
      if (lower.includes(hint)) {
        return {
          ok: false,
          reason: `Access to potential secret path blocked: ${hint}`,
        };
      }
    }

    return { ok: true, safePath: resolved };
  }

  /**
   * Quick check that a host path intended for mounting is sane.
   * Caller must still ensure it is NOT / or sensitive system dirs.
   */
  static isSafeHostProjectPath(hostPath) {
    if (!hostPath || typeof hostPath !== 'string') return false;
    const resolved = path.resolve(hostPath);

    // Never allow mounting the host root or critical system dirs
    const forbidden = ['/', '/etc', '/usr', '/bin', '/sbin', '/lib', '/lib64', '/root', '/home', '/var', '/sys', '/proc', '/dev'];
    if (forbidden.includes(resolved)) return false;

    // Disallow obvious secret locations
    if (
      resolved.includes('/.ssh') ||
      resolved.includes('/.aws') ||
      resolved.includes('/.gnupg') ||
      resolved.endsWith('.env') ||
      resolved.endsWith('.pem') ||
      resolved.endsWith('.key')
    ) {
      return false;
    }

    return true;
  }
}
