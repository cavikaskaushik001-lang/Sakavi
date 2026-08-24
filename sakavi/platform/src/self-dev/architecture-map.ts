/**
 * Structured map of DIVA architecture from known modules + source heuristics.
 */

import type { ModuleMapEntry } from './types.js';
import { listPlatformSourceFiles, readPlatformFile } from './workspace.js';

const KNOWN: Array<{ match: RegExp; entry: Omit<ModuleMapEntry, 'path' | 'dependencies' | 'publicInterfaces' | 'consumers' | 'tests'> & { pathHint: string } }> = [
  { match: /agents\/diva/, entry: { name: 'Planner/DIVA', pathHint: 'src/agents/diva', responsibility: 'Orchestration, planning, recovery', risk: 'high' } },
  { match: /core\/task-engine/, entry: { name: 'Task Engine', pathHint: 'src/core/task-engine', responsibility: 'Long-horizon task state', risk: 'medium' } },
  { match: /core\/tool-gateway/, entry: { name: 'Tool Gateway', pathHint: 'src/core/tool-gateway.ts', responsibility: 'Sole privileged tool entry', risk: 'critical' } },
  { match: /core\/policy-engine/, entry: { name: 'Policy Engine', pathHint: 'src/core/policy-engine.ts', responsibility: 'Authorization policy', risk: 'critical' } },
  { match: /core\/capability-manager/, entry: { name: 'Capability Manager', pathHint: 'src/core/capability-manager.ts', responsibility: 'Time-bounded grants', risk: 'critical' } },
  { match: /core\/kill-switch/, entry: { name: 'Kill Switch', pathHint: 'src/core/kill-switch.ts', responsibility: 'Emergency stop', risk: 'critical' } },
  { match: /sandbox\//, entry: { name: 'Sandbox', pathHint: 'src/sandbox', responsibility: 'Isolated execution', risk: 'critical' } },
  { match: /memory\//, entry: { name: 'Memory', pathHint: 'src/memory', responsibility: 'Scoped knowledge stores', risk: 'medium' } },
  { match: /verification\//, entry: { name: 'Verification', pathHint: 'src/verification', responsibility: 'Independent verify phases', risk: 'high' } },
  { match: /security\//, entry: { name: 'Security Research', pathHint: 'src/security', responsibility: 'Authorized analysis', risk: 'high' } },
  { match: /tools\//, entry: { name: 'Tool Registry', pathHint: 'src/tools', responsibility: 'Tool definitions and handlers', risk: 'high' } },
];

export function buildArchitectureMap(): ModuleMapEntry[] {
  const files = listPlatformSourceFiles();
  const byName = new Map<string, ModuleMapEntry>();

  for (const k of KNOWN) {
    byName.set(k.entry.name, {
      name: k.entry.name,
      path: k.entry.pathHint,
      responsibility: k.entry.responsibility,
      dependencies: [],
      publicInterfaces: [],
      consumers: [],
      tests: [],
      risk: k.entry.risk,
    });
  }

  for (const f of files) {
    for (const k of KNOWN) {
      if (!k.match.test(f)) continue;
      const mod = byName.get(k.entry.name)!;
      try {
        const content = readPlatformFile(f);
        const exports = [...content.matchAll(/export (?:async )?function (\w+)|export const (\w+)/g)].map(
          (m) => m[1] || m[2]
        );
        for (const e of exports) {
          if (e && !mod.publicInterfaces.includes(e)) mod.publicInterfaces.push(e);
        }
        const imports = [...content.matchAll(/from ['"](\.\.?\/[^'"]+)['"]/g)].map((m) => m[1]);
        for (const im of imports.slice(0, 20)) {
          if (!mod.dependencies.includes(im)) mod.dependencies.push(im);
        }
      } catch {
        /* skip unreadable */
      }
    }
    if (/tests\//.test(f) || /\.test\.ts$/.test(f)) {
      for (const mod of byName.values()) {
        if (f.includes(mod.path.replace(/^src\//, '')) || f.includes(mod.name.toLowerCase())) {
          mod.tests.push(f);
        }
      }
    }
  }

  return [...byName.values()];
}

export function architectureDiagram(modules: ModuleMapEntry[]): string {
  const lines = ['DIVA', '├── Planner', '├── Task Engine', '├── Memory', '├── Tool Gateway', '├── Policy Engine', '├── Sandbox', '├── Verification', '├── Recovery', '└── Security / Agents'];
  lines.push('', 'Modules:');
  for (const m of modules) {
    lines.push(`- ${m.name} (${m.risk}): ${m.responsibility}`);
  }
  return lines.join('\n');
}
