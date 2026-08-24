/**
 * Components DIVA may analyze and propose patches for, but must NOT
 * autonomously activate changes to. External review required.
 */

export const PROTECTED_PATH_PATTERNS: readonly RegExp[] = [
  /\/core\/kill-switch\.ts$/,
  /\/core\/secrets\.ts$/,
  /\/core\/approval\.ts$/,
  /\/core\/policy-engine\.ts$/,
  /\/core\/capability-manager\.ts$/,
  /\/core\/tool-gateway\.ts$/,
  /\/core\/audit\.ts$/,
  /\/sandbox\/index\.ts$/,
  /\/security\/scope\.ts$/,
  /\/self-dev\/protected\.ts$/,
  /\/self-dev\/budget\.ts$/,
];

export function isProtectedPath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/');
  return PROTECTED_PATH_PATTERNS.some((re) => re.test(normalized));
}

export function filterWritablePaths(paths: string[]): {
  allowed: string[];
  protectedHits: string[];
} {
  const allowed: string[] = [];
  const protectedHits: string[] = [];
  for (const p of paths) {
    if (isProtectedPath(p)) protectedHits.push(p);
    else allowed.push(p);
  }
  return { allowed, protectedHits };
}
