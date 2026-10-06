/**
 * "Where else is this used?": scan graphs for an idiom, or for the shape of a made function,
 * and list the places with their provenance (graph → node → line).
 *
 * Simple and in memory on purpose: it walks the graphs it is given (the current one and the
 * bundled examples), parsing each Expression Block line and Custom Function statement as it
 * goes. The code explorer (docs/code-explorer-plan.md) will index everything later; this is the
 * place to swap that index in.
 */
import type { GraphNode } from '../../types/nodeGraph';
import { allNodes, type Expr, type GlslType } from './ast';
import { parseLine, splitStatements } from './parse';
import { explainTree } from './explain';
import { compilePattern, matchNormalized, normalize } from './match';
import { typesFromCode, type TypeEnv } from './types';

/** One graph to look in. */
export interface UseSource {
  /** "Current graph", or the example's title. */
  graph: string;
  /** Set for a bundled example: the key `loadExampleGraph` takes. */
  exampleKey?: string;
  nodes: GraphNode[];
}

/** One place it is used. */
export interface UseHit {
  graph: string;
  exampleKey?: string;
  /** The node, and the groups it sits in (outermost first). */
  nodeId: string;
  nodeLabel: string;
  groupPath: Array<{ id: string; label: string }>;
  /** "Line 3", "Return", "Statement 2 (line 5)". */
  where: string;
  /** The line's code, and the part that matched. */
  code: string;
  match: string;
  /** Expression Block: the line index (-1 for Return); Custom Function: the statement's 1-based source line. */
  line: number;
}

/** What to look for: an idiom by id, or a pattern (`buildFunction(…).pattern`). */
export type UseQuery = { idiomId: string } | { pattern: string };

const labelOf = (n: GraphNode) => (typeof n.params?.label === 'string' && n.params.label.trim() ? n.params.label.trim() : n.type === 'exprNode' ? 'Expression Block' : n.type === 'customFn' ? 'Custom Function' : n.type);

/** The names an Expression Block's lines can read, with their types. */
export function exprBlockEnv(node: GraphNode): TypeEnv {
  const env: TypeEnv = {};
  const inputs = node.params?.inputs;
  if (Array.isArray(inputs)) for (const i of inputs as Array<{ name?: string; type?: string }>) if (i?.name) env[i.name] = (i.type ?? 'float') as GlslType;
  if (!('t' in env)) env.t = 'float';
  const lines = node.params?.lines;
  if (Array.isArray(lines)) for (const l of lines as Array<{ lhs?: string }>) { const m = /^\s*(float|vec[234]|int|mat[234])\s+([A-Za-z_]\w*)/.exec(l?.lhs ?? ''); if (m && !(m[2] in env)) env[m[2]] = m[1] as GlslType; }
  if (!('p' in env)) env.p = ((node.params?.outputType as string) || 'vec3') as GlslType;
  return env;
}

/** A Custom Function's parameters and locals, with their types. */
export function customFnEnv(node: GraphNode): TypeEnv {
  const env: TypeEnv = {};
  const inputs = node.params?.inputs;
  if (Array.isArray(inputs)) for (const i of inputs as Array<{ name?: string; type?: string }>) if (i?.name) env[i.name] = (i.type ?? 'float') as GlslType;
  const body = typeof node.params?.body === 'string' ? node.params.body : '';
  return { ...typesFromCode(body), ...env };
}

interface Candidate { node: GraphNode; groupPath: UseHit['groupPath']; where: string; line: number; text: string; env: TypeEnv }

/** Every line of code in a graph (and the groups inside it). */
export function codeLines(nodes: GraphNode[], groupPath: UseHit['groupPath'] = []): Candidate[] {
  const out: Candidate[] = [];
  for (const n of nodes) {
    if (n.type === 'exprNode') {
      const env = exprBlockEnv(n);
      const lines = n.params?.lines;
      if (Array.isArray(lines)) (lines as Array<{ lhs?: string; op?: string; rhs?: string; off?: boolean }>).forEach((l, i) => {
        if (l?.rhs && !l.off) out.push({ node: n, groupPath, where: `Line ${i + 1}`, line: i, text: `${l.lhs ?? ''} ${l.op || '='} ${l.rhs}`, env });
      });
      const result = typeof n.params?.result === 'string' ? n.params.result.trim() : '';
      if (result) out.push({ node: n, groupPath, where: 'Return', line: -1, text: `return ${result}`, env });
    } else if (n.type === 'customFn') {
      const env = customFnEnv(n);
      const body = typeof n.params?.body === 'string' ? n.params.body : '';
      splitStatements(body).forEach((s, i) => out.push({ node: n, groupPath, where: `Statement ${i + 1} (line ${s.line})`, line: s.line, text: s.text, env }));
    }
    const sub = n.params?.subgraph as { nodes?: GraphNode[] } | undefined;
    if (sub && Array.isArray(sub.nodes)) out.push(...codeLines(sub.nodes, [...groupPath, { id: n.id, label: labelOf(n) }]));
  }
  return out;
}

/** The sub-expressions of one line that match the query. */
export function matchesInLine(text: string, query: UseQuery, env: TypeEnv = {}): Expr[] {
  const r = parseLine(text);
  if (!r.ok) return [];
  const root = r.line.expr;
  if ('idiomId' in query) {
    const ex = explainTree(root, text, { types: { ...env, ...(r.line.declType && r.line.target ? { [r.line.target]: r.line.declType as GlslType } : {}) } });
    return ex.idioms.filter(h => h.idiom.id === query.idiomId).map(h => h.node);
  }
  let pat;
  try { pat = compilePattern(query.pattern); } catch { return []; }
  const hits: Expr[] = [];
  for (const n of allNodes(root)) {
    if (n.kind === 'num' || n.kind === 'ident') continue;
    if (matchNormalized(pat, normalize(n))) {
      // Outermost only: a match inside a match is the same use
      if (!hits.some(h => h.start <= n.start && h.end >= n.end)) hits.push(n);
    }
  }
  return hits;
}

/** Look for `query` in every source. `limit` caps the list (the examples are many). */
export function findUses(query: UseQuery, sources: UseSource[], limit = 200): UseHit[] {
  const out: UseHit[] = [];
  for (const src of sources) {
    for (const c of codeLines(src.nodes)) {
      for (const m of matchesInLine(c.text, query, c.env)) {
        out.push({
          graph: src.graph, exampleKey: src.exampleKey, nodeId: c.node.id, nodeLabel: labelOf(c.node), groupPath: c.groupPath,
          where: c.where, code: c.text.replace(/\s+/g, ' ').trim(), match: c.text.slice(m.start, m.end).trim(), line: c.line,
        });
        if (out.length >= limit) return out;
      }
    }
  }
  return out;
}

/** "Current graph → Group A → Expression Block → Line 3". */
export function provenance(h: UseHit): string {
  return [h.graph, ...h.groupPath.map(g => g.label), h.nodeLabel, h.where].join(' → ');
}
