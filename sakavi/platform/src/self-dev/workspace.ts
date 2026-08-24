/**
 * Self-development workspace under platform/self-development/
 */

import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SelfFinding, SelfDevVersion, SelfRepairReport } from './types.js';

function platformRoot(): string {
  // src/self-dev -> platform/
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, '..', '..');
}

export function selfDevRoot(): string {
  return join(platformRoot(), 'self-development');
}

export function ensureSelfDevDirs(): void {
  for (const sub of [
    'snapshots',
    'branches',
    'patches',
    'test-results',
    'reviews',
    'reports',
  ]) {
    mkdirSync(join(selfDevRoot(), sub), { recursive: true });
  }
}

export function writeReport(name: string, content: string): string {
  ensureSelfDevDirs();
  const path = join(selfDevRoot(), 'reports', name);
  writeFileSync(path, content, 'utf8');
  return path;
}

export function writePatch(name: string, content: string): string {
  ensureSelfDevDirs();
  const path = join(selfDevRoot(), 'patches', name);
  writeFileSync(path, content, 'utf8');
  return path;
}

export function writeReview(name: string, content: string): string {
  ensureSelfDevDirs();
  const path = join(selfDevRoot(), 'reviews', name);
  writeFileSync(path, content, 'utf8');
  return path;
}

export function writeTestResult(name: string, content: string): string {
  ensureSelfDevDirs();
  const path = join(selfDevRoot(), 'test-results', name);
  writeFileSync(path, content, 'utf8');
  return path;
}

/** Simple append-only history of self-dev events */
export function appendHistory(entry: Record<string, unknown>): void {
  ensureSelfDevDirs();
  const path = join(selfDevRoot(), 'reports', 'history.jsonl');
  const line = JSON.stringify({ ...entry, at: new Date().toISOString() }) + '\n';
  writeFileSync(path, line, { flag: 'a', encoding: 'utf8' });
}

export function readHistory(limit = 50): Record<string, unknown>[] {
  const path = join(selfDevRoot(), 'reports', 'history.jsonl');
  if (!existsSync(path)) return [];
  const lines = readFileSync(path, 'utf8').trim().split('\n').filter(Boolean);
  return lines.slice(-limit).map((l) => JSON.parse(l) as Record<string, unknown>);
}

export function listSrcFiles(relativeToPlatform = 'src'): string[] {
  const root = join(platformRoot(), relativeToPlatform);
  const out: string[] = [];
  function walk(dir: string, prefix: string): void {
    let entries: string[] = [];
    try {
      entries = readdirSync(dir, { withFileTypes: true }).map(String) as unknown as string[];
    } catch {
      return;
    }
    // readdir with file types properly
    try {
      const { readdirSync: rd } = require('node:fs') as typeof import('node:fs');
      for (const ent of rd(dir, { withFileTypes: true })) {
        const rel = prefix ? `${prefix}/${ent.name}` : ent.name;
        const full = join(dir, ent.name);
        if (ent.isDirectory()) {
          if (ent.name === 'node_modules' || ent.name === 'dist') continue;
          walk(full, rel);
        } else if (ent.isFile() && /\.(ts|js|json|md)$/.test(ent.name)) {
          out.push(rel);
        }
      }
    } catch {
      /* ignore */
    }
  }
  walk(root, relativeToPlatform);
  return out;
}

// ESM-safe walk without require
export function listPlatformSourceFiles(): string[] {
  const root = join(platformRoot(), 'src');
  const out: string[] = [];
  const walk = (dir: string, prefix: string) => {
    let ents;
    try {
      ents = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of ents) {
      if (ent.name === 'node_modules' || ent.name === 'dist') continue;
      const rel = `${prefix}/${ent.name}`;
      const full = join(dir, ent.name);
      if (ent.isDirectory()) walk(full, rel);
      else if (/\.(ts|js)$/.test(ent.name)) out.push(rel);
    }
  };
  walk(root, 'src');
  return out;
}

export function readPlatformFile(relFromPlatform: string): string {
  return readFileSync(join(platformRoot(), relFromPlatform), 'utf8');
}

export function platformSrcRoot(): string {
  return join(platformRoot(), 'src');
}

export type { SelfFinding, SelfDevVersion, SelfRepairReport };
