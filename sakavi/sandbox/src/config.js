/**
 * Sandbox configuration defaults.
 * Override via environment variables or constructor options.
 * NEVER put secrets, tokens, SSH keys, or cloud credentials here.
 */

export const DEFAULT_CONFIG = {
  // Docker image
  image: process.env.SANDBOX_IMAGE || 'sakavi-sandbox:latest',

  // Resource limits
  memoryLimit: process.env.SANDBOX_MEMORY || '2g',       // e.g. 512m, 2g
  cpuLimit: parseFloat(process.env.SANDBOX_CPUS || '2'), // number of CPUs
  pidsLimit: parseInt(process.env.SANDBOX_PIDS || '256', 10),
  diskTmpSize: process.env.SANDBOX_TMP_SIZE || '512m',

  // Execution
  defaultTimeoutMs: parseInt(process.env.SANDBOX_TIMEOUT_MS || '120000', 10), // 2 min
  maxTimeoutMs: parseInt(process.env.SANDBOX_MAX_TIMEOUT_MS || '600000', 10), // 10 min hard cap
  maxOutputBytes: parseInt(process.env.SANDBOX_MAX_OUTPUT || '1048576', 10),  // 1 MB

  // Network
  // "none" = no network (safest default)
  // "bridge" = controlled internet (only when package install needed)
  defaultNetworkMode: process.env.SANDBOX_NETWORK || 'none',

  // Workspace mount inside container
  workspacePath: '/workspace',

  // User inside container (must match Dockerfile)
  user: '1000:1000',

  // Security
  noNewPrivileges: true,
  dropAllCapabilities: true,
  privileged: false,          // NEVER true
  readOnlyRootfs: false,      // workspace needs write; image layers stay clean

  // Container name prefix
  namePrefix: 'sakavi-sbx-',

  // Auto-remove on destroy
  autoRemove: true,
};

/**
 * Dangerous command patterns (case-insensitive).
 * These are blocked before the command ever reaches the container.
 */
export const BLOCKED_PATTERNS = [
  // Privilege escalation / container escape attempts
  /\bsudo\b/i,
  /\bsu\b\s/i,
  /\bchmod\s+[0-7]*[4567]/g,
  /\bchown\b/i,
  /\bsetuid\b/i,
  /\bsetgid\b/i,

  // Host / system destructive
  /\brm\s+(-[a-zA-Z]*f[a-zA-Z]*\s+)?\/\b/,          // rm -rf /
  /\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f[a-zA-Z]*|[a-zA-Z]*f[a-zA-Z]*r)\s+\//i,
  /\bmkfs\b/i,
  /\bdd\s+if=/i,
  /\b:\(\)\s*\{\s*:\|:\s*&\s*\}\s*;/,               // fork bomb
  /\bshutdown\b/i,
  /\breboot\b/i,
  /\bhalt\b/i,
  /\bpoweroff\b/i,

  // Docker / socket access (should never be possible, but belt+suspenders)
  /\/var\/run\/docker\.sock/i,
  /\bdocker\b/i,
  /\bdockerode\b/i,
  /\bcontainerd\b/i,

  // Mount / namespace escapes
  /\bmount\b/i,
  /\bumount\b/i,
  /\bnsenter\b/i,
  /\bunshare\b/i,
  /\bchroot\b/i,

  // Network discovery that can leak host info (optional strictness)
  // /\bcurl\s+.*169\.254\.169\.254/i,  // AWS metadata – uncomment if desired
  // /\bwget\s+.*169\.254\.169\.254/i,

  // Writing outside workspace (common paths)
  />\s*\/etc\//i,
  />\s*\/usr\//i,
  />\s*\/bin\//i,
  />\s*\/sbin\//i,
  />\s*\/lib\//i,
  />\s*\/root\//i,
  />\s*\/home\/(?!sandbox)/i,

  // Secrets / credential patterns that should never be written
  /\.aws\/credentials/i,
  /\.ssh\/id_/i,
  /\.gnupg\//i,
];

/**
 * Allowed package managers / install commands (when network is enabled).
 * Everything else still goes through the general block list.
 */
export const ALLOWED_INSTALL_PREFIXES = [
  'npm install',
  'npm ci',
  'npm i ',
  'yarn install',
  'yarn add',
  'pnpm install',
  'pnpm add',
  'pip install',
  'pip3 install',
  'python -m pip install',
  'python3 -m pip install',
];
