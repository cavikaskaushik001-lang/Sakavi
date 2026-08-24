/**
 * Hardened sandbox — isolation is the primary boundary.
 * Allowlists + resource limits; command blocklists are defense-in-depth only.
 *
 * Port of existing sakavi/sandbox with stricter HostConfig defaults.
 */

import Docker from 'dockerode';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { PlatformError } from '../core/errors.js';

export interface SandboxConfig {
  image: string;
  memoryBytes: number;
  nanoCpus: number;
  pidsLimit: number;
  defaultTimeoutMs: number;
  maxTimeoutMs: number;
  maxOutputBytes: number;
}

const DEFAULTS: SandboxConfig = {
  image: process.env.SANDBOX_IMAGE || 'sakavi-sandbox:latest',
  memoryBytes: 2 * 1024 ** 3,
  nanoCpus: 2e9,
  pidsLimit: 256,
  defaultTimeoutMs: 120_000,
  maxTimeoutMs: 600_000,
  maxOutputBytes: 1_048_576,
};

export interface CreateOpts {
  projectPath: string;
  networkMode?: 'none' | 'bridge';
  memoryBytes?: number;
  nanoCpus?: number;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  executionTimeMs: number;
  timedOut: boolean;
}

interface Active {
  container: Docker.Container;
  projectPath: string;
  networkMode: string;
}

export class HardenedSandbox {
  private readonly docker: Docker;
  private readonly cfg: SandboxConfig;
  private readonly active = new Map<string, Active>();

  constructor(cfg: Partial<SandboxConfig> = {}, docker?: Docker) {
    this.cfg = { ...DEFAULTS, ...cfg };
    this.docker = docker ?? new Docker();
  }

  async create(opts: CreateOpts): Promise<{ sandboxId: string }> {
    const abs = path.resolve(opts.projectPath);
    if (!isSafeProjectPath(abs)) {
      throw new PlatformError('UNSAFE_PATH', `Rejected project path: ${abs}`, 400);
    }

    try {
      await this.docker.getImage(this.cfg.image).inspect();
    } catch {
      throw new PlatformError(
        'IMAGE_MISSING',
        `Image ${this.cfg.image} not found. Build with: docker build -t sakavi-sandbox:latest ./sandbox`,
        500
      );
    }

    const sandboxId = randomUUID().slice(0, 12);
    const networkMode = opts.networkMode === 'bridge' ? 'bridge' : 'none';

    const container = await this.docker.createContainer({
      Image: this.cfg.image,
      name: `sakavi-sbx-${sandboxId}`,
      User: '1000:1000',
      WorkingDir: '/workspace',
      Cmd: ['sleep', 'infinity'],
      Env: ['HOME=/home/sandbox', 'NODE_ENV=development', 'PYTHONUNBUFFERED=1'],
      HostConfig: {
        Memory: opts.memoryBytes ?? this.cfg.memoryBytes,
        NanoCpus: opts.nanoCpus ?? this.cfg.nanoCpus,
        PidsLimit: this.cfg.pidsLimit,
        NetworkMode: networkMode,
        // ONLY project → /workspace
        Binds: [`${abs}:/workspace:rw`],
        Privileged: false,
        SecurityOpt: ['no-new-privileges:true'],
        CapDrop: ['ALL'],
        ReadonlyRootfs: false,
        Tmpfs: {
          '/tmp': 'size=512m,mode=1777',
        },
        AutoRemove: false,
      },
      Labels: { 'sakavi.sandbox': 'true', 'sakavi.sandbox.id': sandboxId },
    });

    await container.start();
    this.active.set(sandboxId, { container, projectPath: abs, networkMode });
    return { sandboxId };
  }

  async execute(
    sandboxId: string,
    command: string,
    timeoutMs?: number
  ): Promise<ExecResult> {
    const entry = this.active.get(sandboxId);
    if (!entry) throw new PlatformError('SANDBOX_NOT_FOUND', `Unknown sandbox ${sandboxId}`, 404);

    const ms = Math.min(timeoutMs ?? this.cfg.defaultTimeoutMs, this.cfg.maxTimeoutMs);
    const start = Date.now();

    const exec = await entry.container.exec({
      Cmd: ['sh', '-c', command],
      AttachStdout: true,
      AttachStderr: true,
      User: '1000:1000',
      WorkingDir: '/workspace',
    });

    const stream = await exec.start({ hijack: true, stdin: false });
    const collected = await collectStream(stream, ms, this.cfg.maxOutputBytes);

    let exitCode = 1;
    try {
      const inspect = await exec.inspect();
      exitCode = inspect.ExitCode ?? (collected.timedOut ? 124 : 1);
    } catch {
      exitCode = collected.timedOut ? 124 : 1;
    }

    return {
      stdout: collected.stdout,
      stderr: collected.stderr,
      exitCode,
      executionTimeMs: Date.now() - start,
      timedOut: collected.timedOut,
    };
  }

  async destroy(sandboxId: string): Promise<void> {
    const entry = this.active.get(sandboxId);
    if (!entry) return;
    try {
      await entry.container.stop({ t: 5 });
    } catch {
      /* already stopped */
    }
    try {
      await entry.container.remove({ force: true });
    } catch {
      /* already removed */
    }
    this.active.delete(sandboxId);
  }

  async destroyAll(): Promise<void> {
    await Promise.all([...this.active.keys()].map((id) => this.destroy(id)));
  }
}

function isSafeProjectPath(p: string): boolean {
  const forbidden = ['/', '/etc', '/usr', '/bin', '/sbin', '/lib', '/root', '/var', '/sys', '/proc', '/dev'];
  if (forbidden.includes(p)) return false;
  if (p.includes('/.ssh') || p.includes('/.aws') || p.endsWith('.env') || p.endsWith('.pem')) return false;
  return true;
}

function collectStream(
  stream: NodeJS.ReadableStream,
  timeoutMs: number,
  maxBytes: number
): Promise<{ stdout: string; stderr: string; timedOut: boolean }> {
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
        (stream as { destroy?: () => void }).destroy?.();
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

    stream.on('data', (chunk: Buffer) => {
      let offset = 0;
      while (offset + 8 <= chunk.length) {
        const type = chunk[offset];
        const size = chunk.readUInt32BE(offset + 4);
        offset += 8;
        const payload = chunk.subarray(offset, offset + size);
        offset += size;
        if (type === 1) {
          if (stdout.length < maxBytes) {
            stdout = Buffer.concat([stdout, payload.subarray(0, maxBytes - stdout.length)]);
          }
        } else if (type === 2) {
          if (stderr.length < maxBytes) {
            stderr = Buffer.concat([stderr, payload.subarray(0, maxBytes - stderr.length)]);
          }
        }
      }
    });
    stream.on('end', finish);
    stream.on('error', finish);
  });
}

export const sandboxService = new HardenedSandbox();
