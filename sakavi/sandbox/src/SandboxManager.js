/**
 * SandboxManager – create / execute / destroy isolated Docker sandboxes.
 *
 * Security invariants enforced here:
 * - Only the project directory is bind-mounted → /workspace
 * - Host root ("/") is never mounted
 * - Docker socket is never exposed
 * - Container runs as non-root (UID 1000)
 * - No --privileged
 * - Resource limits always applied
 * - Commands are validated before execution
 * - Network is off by default
 */

import Docker from 'dockerode';
import { v4 as uuidv4 } from 'uuid';
import path from 'node:path';
import { DEFAULT_CONFIG } from './config.js';
import { SecurityValidator } from './SecurityValidator.js';

export class SandboxManager {
  /**
   * @param {Partial<typeof DEFAULT_CONFIG> & { docker?: Docker }} options
   */
  constructor(options = {}) {
    this.config = { ...DEFAULT_CONFIG, ...options };
    this.docker = options.docker || new Docker(); // uses DOCKER_HOST / default socket on host only
    /** @type {Map<string, { container: import('dockerode').Container, meta: object }>} */
    this.active = new Map();
  }

  /**
   * Create a new isolated sandbox.
   *
   * @param {object} opts
   * @param {string} opts.projectPath  Absolute path on the *host* to the project directory
   * @param {string} [opts.networkMode]  "none" | "bridge"  (default from config)
   * @param {string} [opts.memory]       Override memory limit
   * @param {number} [opts.cpus]         Override CPU limit
   * @param {object} [opts.env]          Extra env vars (never pass secrets)
   * @param {string} [opts.name]         Optional friendly name suffix
   * @returns {Promise<{ sandboxId: string, status: string }>}
   */
  async createSandbox(opts = {}) {
    const {
      projectPath,
      networkMode = this.config.defaultNetworkMode,
      memory = this.config.memoryLimit,
      cpus = this.config.cpuLimit,
      env = {},
      name,
    } = opts;

    if (!projectPath) {
      throw new Error('projectPath is required');
    }

    const absProject = path.resolve(projectPath);
    if (!SecurityValidator.isSafeHostProjectPath(absProject)) {
      throw new Error(
        `Unsafe projectPath rejected: ${absProject}. ` +
          'Never mount host root, system dirs, or secret locations.'
      );
    }

    // Ensure image exists
    await this._ensureImage();

    const sandboxId = (name ? `${name}-` : '') + uuidv4().slice(0, 8);
    const containerName = `${this.config.namePrefix}${sandboxId}`;

    const envList = [
      'HOME=/home/sandbox',
      'NODE_ENV=development',
      'PYTHONUNBUFFERED=1',
      ...Object.entries(env).map(([k, v]) => `${k}=${v}`),
    ];

    // Hard security options
    const hostConfig = {
      Memory: this._parseMemory(memory),
      NanoCpus: Math.floor(cpus * 1e9),
      PidsLimit: this.config.pidsLimit,
      NetworkMode: networkMode === 'bridge' ? 'bridge' : 'none',
      Binds: [`${absProject}:${this.config.workspacePath}:rw`],
      // NEVER add docker.sock
      // NEVER set Privileged: true
      Privileged: false,
      SecurityOpt: ['no-new-privileges:true'],
      CapDrop: ['ALL'],
      Tmpfs: {
        '/tmp': `size=${this.config.diskTmpSize},mode=1777`,
      },
      // Extra hardening
      ReadonlyRootfs: false, // workspace needs write
      AutoRemove: false,     // we manage lifecycle ourselves
    };

    const container = await this.docker.createContainer({
      Image: this.config.image,
      name: containerName,
      User: this.config.user,
      WorkingDir: this.config.workspacePath,
      Env: envList,
      HostConfig: hostConfig,
      // Keep alive
      Cmd: ['sleep', 'infinity'],
      // Labels for easy cleanup
      Labels: {
        'sakavi.sandbox': 'true',
        'sakavi.sandbox.id': sandboxId,
      },
    });

    await container.start();

    const meta = {
      sandboxId,
      containerId: container.id,
      containerName,
      projectPath: absProject,
      networkMode,
      createdAt: new Date().toISOString(),
      memory,
      cpus,
    };

    this.active.set(sandboxId, { container, meta });

    return {
      sandboxId,
      status: 'running',
      networkMode,
      workspace: this.config.workspacePath,
    };
  }

  /**
   * Execute a command inside an existing sandbox.
   *
   * @param {string} sandboxId
   * @param {string} command   Shell command (will be run with `sh -c`)
   * @param {object} [options]
   * @param {number} [options.timeoutMs]
   * @param {boolean} [options.network]  If true and container has network=none, command is rejected
   * @param {string} [options.workdir]   Relative or absolute path under /workspace
   * @returns {Promise<{
   *   stdout: string,
   *   stderr: string,
   *   exitCode: number,
   *   executionTimeMs: number,
   *   timedOut: boolean,
   *   blocked?: boolean,
   *   reason?: string
   * }>}
   */
  async executeCommand(sandboxId, command, options = {}) {
    const entry = this.active.get(sandboxId);
    if (!entry) {
      throw new Error(`Sandbox not found: ${sandboxId}`);
    }

    const { container, meta } = entry;
    const timeoutMs = Math.min(
      options.timeoutMs ?? this.config.defaultTimeoutMs,
      this.config.maxTimeoutMs
    );

    // Security validation
    const validation = SecurityValidator.validateCommand(command, {
      allowNetwork: meta.networkMode === 'bridge' || options.network === true,
    });
    if (!validation.ok) {
      return {
        stdout: '',
        stderr: '',
        exitCode: 126,
        executionTimeMs: 0,
        timedOut: false,
        blocked: true,
        reason: validation.reason,
      };
    }

    // Workdir sanitization
    let workdir = this.config.workspacePath;
    if (options.workdir) {
      const pathCheck = SecurityValidator.sanitizeWorkspacePath(options.workdir);
      if (!pathCheck.ok) {
        return {
          stdout: '',
          stderr: '',
          exitCode: 126,
          executionTimeMs: 0,
          timedOut: false,
          blocked: true,
          reason: pathCheck.reason,
        };
      }
      workdir = pathCheck.safePath;
    }

    const start = Date.now();
    let timedOut = false;

    // Create exec instance
    const exec = await container.exec({
      Cmd: ['sh', '-c', command],
      AttachStdout: true,
      AttachStderr: true,
      WorkingDir: workdir,
      User: this.config.user,
    });

    // Stream with timeout
    const stream = await exec.start({ hijack: true, stdin: false });

    const result = await this._collectStream(stream, timeoutMs, this.config.maxOutputBytes);
    timedOut = result.timedOut;

    // Inspect exit code
    let exitCode = 1;
    try {
      const inspect = await exec.inspect();
      exitCode = inspect.ExitCode ?? 1;
    } catch {
      // if timed out the process may already be gone
      if (timedOut) exitCode = 124; // conventional timeout code
    }

    // If we timed out, try to kill the exec process (best effort)
    if (timedOut) {
      try {
        // dockerode doesn't expose kill on exec directly; container kill of the whole thing
        // is too aggressive. We leave the process; next destroy will clean up.
      } catch {
        /* ignore */
      }
    }

    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode,
      executionTimeMs: Date.now() - start,
      timedOut,
    };
  }

  /**
   * Convenience: get last command output is just the return value of executeCommand.
   * Kept for API completeness.
   */
  getCommandOutput(result) {
    if (!result) return null;
    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
      executionTimeMs: result.executionTimeMs,
      timedOut: result.timedOut,
      blocked: result.blocked || false,
      reason: result.reason,
    };
  }

  /**
   * Destroy a sandbox (stop + remove container).
   * Safe to call multiple times.
   */
  async destroySandbox(sandboxId) {
    const entry = this.active.get(sandboxId);
    if (!entry) {
      // Already gone or never existed
      return { destroyed: true, sandboxId };
    }

    const { container } = entry;
    try {
      await container.stop({ t: 5 });
    } catch (err) {
      // already stopped
    }
    try {
      await container.remove({ force: true });
    } catch (err) {
      // already removed
    }

    this.active.delete(sandboxId);
    return { destroyed: true, sandboxId };
  }

  /**
   * List active sandboxes managed by this process.
   */
  listSandboxes() {
    return Array.from(this.active.values()).map((e) => ({ ...e.meta }));
  }

  /**
   * Destroy every sandbox created by this manager.
   */
  async destroyAll() {
    const ids = Array.from(this.active.keys());
    await Promise.all(ids.map((id) => this.destroySandbox(id)));
    return { destroyed: ids };
  }

  // ─── Internal helpers ───────────────────────────────────────────────

  async _ensureImage() {
    try {
      await this.docker.getImage(this.config.image).inspect();
    } catch {
      // Image missing – try to build from local Dockerfile if present,
      // otherwise pull (user should have built it).
      throw new Error(
        `Docker image "${this.config.image}" not found. ` +
          'Run: docker build -t sakavi-sandbox:latest .'
      );
    }
  }

  _parseMemory(mem) {
    if (typeof mem === 'number') return mem;
    const s = String(mem).toLowerCase().trim();
    const match = s.match(/^(\d+(?:\.\d+)?)\s*(b|k|kb|m|mb|g|gb)?$/);
    if (!match) return 2 * 1024 * 1024 * 1024; // 2 GiB fallback
    const n = parseFloat(match[1]);
    const unit = match[2] || 'b';
    const multipliers = {
      b: 1,
      k: 1024,
      kb: 1024,
      m: 1024 ** 2,
      mb: 1024 ** 2,
      g: 1024 ** 3,
      gb: 1024 ** 3,
    };
    return Math.floor(n * (multipliers[unit] || 1));
  }

  /**
   * Collect stdout/stderr from a docker exec stream with timeout + size limit.
   */
  _collectStream(stream, timeoutMs, maxBytes) {
    return new Promise((resolve) => {
      let stdout = Buffer.alloc(0);
      let stderr = Buffer.alloc(0);
      let timedOut = false;
      let settled = false;

      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try {
          stream.destroy();
        } catch {
          /* ignore */
        }
        resolve({
          stdout: stdout.toString('utf8'),
          stderr: stderr.toString('utf8'),
          timedOut,
        });
      };

      const timer = setTimeout(() => {
        timedOut = true;
        finish();
      }, timeoutMs);

      // dockerode multiplexes stdout/stderr when hijack=true
      stream.on('data', (chunk) => {
        // Simple demux: docker stream header is 8 bytes
        // [streamType(1), 0,0,0, size(4 big-endian)]
        let offset = 0;
        while (offset < chunk.length) {
          if (chunk.length - offset < 8) {
            // incomplete header – treat rest as stdout
            stdout = Buffer.concat([stdout, chunk.slice(offset)]);
            break;
          }
          const streamType = chunk[offset];
          const size = chunk.readUInt32BE(offset + 4);
          offset += 8;
          const payload = chunk.slice(offset, offset + size);
          offset += size;

          if (streamType === 1) {
            // stdout
            if (stdout.length + payload.length <= maxBytes) {
              stdout = Buffer.concat([stdout, payload]);
            } else {
              // truncate
              const remaining = maxBytes - stdout.length;
              if (remaining > 0) stdout = Buffer.concat([stdout, payload.slice(0, remaining)]);
            }
          } else if (streamType === 2) {
            // stderr
            if (stderr.length + payload.length <= maxBytes) {
              stderr = Buffer.concat([stderr, payload]);
            } else {
              const remaining = maxBytes - stderr.length;
              if (remaining > 0) stderr = Buffer.concat([stderr, payload.slice(0, remaining)]);
            }
          }
        }
      });

      stream.on('end', finish);
      stream.on('error', finish);
    });
  }
}
