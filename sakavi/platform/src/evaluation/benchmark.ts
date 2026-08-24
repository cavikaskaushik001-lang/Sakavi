/**
 * Repeatable benchmark harness — measurable, not self-congratulatory.
 */

import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export type BenchCategory =
  | 'coding'
  | 'debugging'
  | 'security'
  | 'planning'
  | 'recovery'
  | 'reasoning'
  | 'prompt-injection'
  | 'reliability';

export interface BenchCase {
  id: string;
  category: BenchCategory;
  name: string;
  /** Pure function under test */
  run: () => { pass: boolean; detail: string; latencyMs: number };
}

export interface BenchResult {
  id: string;
  category: BenchCategory;
  name: string;
  pass: boolean;
  detail: string;
  latencyMs: number;
  at: string;
}

export interface BenchSuiteResult {
  at: string;
  results: BenchResult[];
  successRate: number;
  avgLatencyMs: number;
}

const cases: BenchCase[] = [];

export function registerBench(c: BenchCase): void {
  cases.push(c);
}

export function runBenchmarks(filter?: BenchCategory): BenchSuiteResult {
  const selected = filter ? cases.filter((c) => c.category === filter) : cases;
  const results: BenchResult[] = [];
  for (const c of selected) {
    const started = Date.now();
    try {
      const r = c.run();
      results.push({
        id: c.id,
        category: c.category,
        name: c.name,
        pass: r.pass,
        detail: r.detail,
        latencyMs: r.latencyMs || Date.now() - started,
        at: new Date().toISOString(),
      });
    } catch (err) {
      results.push({
        id: c.id,
        category: c.category,
        name: c.name,
        pass: false,
        detail: err instanceof Error ? err.message : 'error',
        latencyMs: Date.now() - started,
        at: new Date().toISOString(),
      });
    }
  }
  const successRate = results.length
    ? results.filter((r) => r.pass).length / results.length
    : 0;
  const avgLatencyMs = results.length
    ? results.reduce((s, r) => s + r.latencyMs, 0) / results.length
    : 0;
  const suite: BenchSuiteResult = {
    at: new Date().toISOString(),
    results,
    successRate,
    avgLatencyMs,
  };
  persistSuite(suite);
  return suite;
}

function benchDir(): string {
  return process.env.DIVA_BENCH_DIR || join(process.cwd(), 'data', 'benchmarks');
}

function persistSuite(suite: BenchSuiteResult): void {
  try {
    mkdirSync(benchDir(), { recursive: true });
    const name = `bench-${Date.now()}.json`;
    writeFileSync(join(benchDir(), name), JSON.stringify(suite, null, 2));
    writeFileSync(join(benchDir(), 'latest.json'), JSON.stringify(suite, null, 2));
  } catch {
    /* ignore */
  }
}

export function loadLatestBench(): BenchSuiteResult | null {
  try {
    const p = join(benchDir(), 'latest.json');
    if (!existsSync(p)) return null;
    return JSON.parse(readFileSync(p, 'utf8')) as BenchSuiteResult;
  } catch {
    return null;
  }
}
