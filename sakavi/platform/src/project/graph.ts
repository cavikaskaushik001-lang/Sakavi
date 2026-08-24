/**
 * Project intelligence graph — structured relationships for impact analysis.
 */

import { randomUUID } from 'node:crypto';

export type NodeKind =
  | 'repository'
  | 'file'
  | 'module'
  | 'function'
  | 'api'
  | 'database'
  | 'dependency'
  | 'service'
  | 'test'
  | 'infra'
  | 'security_boundary';

export interface GraphNode {
  id: string;
  kind: NodeKind;
  name: string;
  path?: string;
  meta?: Record<string, string>;
}

export interface GraphEdge {
  from: string;
  to: string;
  rel: 'contains' | 'imports' | 'calls' | 'exposes' | 'uses' | 'tests' | 'deploys' | 'guards';
}

export class ProjectGraph {
  readonly projectKey: string;
  nodes = new Map<string, GraphNode>();
  edges: GraphEdge[] = [];

  constructor(projectKey: string) {
    this.projectKey = projectKey;
  }

  upsert(node: Omit<GraphNode, 'id'> & { id?: string }): GraphNode {
    const id = node.id || `${node.kind}:${node.path || node.name}`;
    const full: GraphNode = { ...node, id };
    this.nodes.set(id, full);
    return full;
  }

  link(from: string, to: string, rel: GraphEdge['rel']): void {
    this.edges.push({ from, to, rel });
  }

  dependents(nodeId: string): GraphNode[] {
    const out: GraphNode[] = [];
    for (const e of this.edges) {
      if (e.to === nodeId || e.from === nodeId) {
        const other = e.from === nodeId ? e.to : e.from;
        const n = this.nodes.get(other);
        if (n) out.push(n);
      }
    }
    return out;
  }

  /** Build a minimal graph from file path list */
  static fromFileList(projectKey: string, files: string[]): ProjectGraph {
    const g = new ProjectGraph(projectKey);
    const repo = g.upsert({ kind: 'repository', name: projectKey });
    for (const f of files) {
      const file = g.upsert({ kind: 'file', name: f.split('/').pop() || f, path: f });
      g.link(repo.id, file.id, 'contains');
      if (/\.test\.|\.spec\.|__tests__/.test(f)) {
        const t = g.upsert({ kind: 'test', name: file.name, path: f });
        g.link(t.id, file.id, 'tests');
      }
      if (/route|controller|api\//i.test(f)) {
        const api = g.upsert({ kind: 'api', name: file.name, path: f });
        g.link(file.id, api.id, 'exposes');
      }
      if (/package\.json|requirements|go\.mod|Cargo\.toml/.test(f)) {
        const d = g.upsert({ kind: 'dependency', name: file.name, path: f });
        g.link(repo.id, d.id, 'uses');
      }
    }
    return g;
  }
}

const graphs = new Map<string, ProjectGraph>();

export function getOrCreateGraph(projectKey: string): ProjectGraph {
  let g = graphs.get(projectKey);
  if (!g) {
    g = new ProjectGraph(projectKey);
    graphs.set(projectKey, g);
  }
  return g;
}

export function impactAnalysis(
  graph: ProjectGraph,
  changedPaths: string[]
): {
  affectedFiles: string[];
  affectedApis: string[];
  affectedTests: string[];
  deploymentRisk: 'low' | 'medium' | 'high';
  report: string;
} {
  const affected = new Set<string>();
  const apis: string[] = [];
  const tests: string[] = [];

  for (const path of changedPaths) {
    affected.add(path);
    for (const n of graph.nodes.values()) {
      if (n.path === path) {
        for (const dep of graph.dependents(n.id)) {
          if (dep.path) affected.add(dep.path);
          if (dep.kind === 'api') apis.push(dep.path || dep.name);
          if (dep.kind === 'test') tests.push(dep.path || dep.name);
        }
      }
    }
  }

  const deploymentRisk =
    apis.length > 3 ? 'high' : apis.length > 0 || changedPaths.some((p) => /infra|deploy|docker/i.test(p))
      ? 'medium'
      : 'low';

  const report = [
    `Changed: ${changedPaths.join(', ')}`,
    `Affected files: ${[...affected].slice(0, 20).join(', ')}`,
    `APIs: ${apis.join(', ') || 'none'}`,
    `Tests: ${tests.join(', ') || 'none'}`,
    `Deployment risk: ${deploymentRisk}`,
  ].join('\n');

  return {
    affectedFiles: [...affected],
    affectedApis: apis,
    affectedTests: tests,
    deploymentRisk,
    report,
  };
}
