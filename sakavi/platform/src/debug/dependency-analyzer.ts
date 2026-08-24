/**
 * Correlate failures with dependency manifests / lockfile hints.
 */

export function analyzeDependencySignals(params: {
  errorText: string;
  packageJson?: string;
  recentDiff?: string;
}): { facts: string[]; hypotheses: string[] } {
  const facts: string[] = [];
  const hypotheses: string[] = [];

  if (/Cannot find module ['"]([^'"]+)['"]/.test(params.errorText)) {
    const mod = params.errorText.match(/Cannot find module ['"]([^'"]+)['"]/)?.[1];
    facts.push(`Missing module reported: ${mod}`);
    hypotheses.push('Dependency not installed or not declared in package.json');
  }

  if (params.packageJson) {
    try {
      const pkg = JSON.parse(params.packageJson) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      facts.push(
        `Declared dependencies: ${Object.keys(pkg.dependencies || {}).length}, dev: ${Object.keys(pkg.devDependencies || {}).length}`
      );
    } catch {
      facts.push('package.json present but not parseable');
    }
  }

  if (params.recentDiff && /package\.json|package-lock|yarn.lock|pnpm-lock/.test(params.recentDiff)) {
    facts.push('Recent changes touched dependency manifests');
    hypotheses.push('Regression may stem from dependency version change');
  }

  return { facts, hypotheses };
}
