/**
 * corpus.ts — what the Code Explorer indexes, as docs (docs/code-explorer-plan.md §3).
 *
 * Phase 1 is written code only: Expression Blocks (their lines and result),
 * Custom Functions (body and helper functions), input expressions, presets,
 * saved shaders, Function Builder functions, Convert sources, linked .glsl
 * files and the code typed into Present code blocks. Pure: graphs and stored
 * values in, DocInputs out. collect.ts reads them from the app.
 */
import type { DocInput, Origin, SourceInput, SourceKind } from './types';

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | undefined => (v && typeof v === 'object' && !Array.isArray(v) ? v as Obj : undefined);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

export const INPUT_EXPR_PREFIX = '__inExpr_';

export interface GraphSourceOptions {
  /** A node type's label (its definition's), for nodes without their own. */
  nodeLabel?: (type: string) => string | undefined;
  /** What the node code counts as: graph nodes, or a preset's. */
  kindFor?: (natural: SourceKind) => SourceKind;
}

/** An Expression Block's code as one text, a line per block line, with where each came from. */
export function exprBlockSource(lines: unknown, result: unknown, legacyExpr?: unknown): { text: string; lineFields: NonNullable<SourceInput['lineFields']> } | null {
  const rows: string[] = [];
  const lineFields: NonNullable<SourceInput['lineFields']> = [];
  const flat = (s: string) => s.replace(/[\r\n]+/g, ' ');
  if (Array.isArray(lines)) {
    lines.forEach((raw, i) => {
      const l = obj(raw);
      const lhs = flat(str(l?.lhs) ?? ''), rhs = flat(str(l?.rhs) ?? ''), op = str(l?.op) || '=';
      if (!lhs.trim() || !rhs.trim() || l?.off) return;
      rows.push(`${lhs} ${op} ${rhs};`);
      lineFields.push({ field: `lines[${i}].rhs`, line: i + 1, prefix: lhs.length + op.length + 2 });
    });
    const r = flat(str(result) ?? '').trim();
    if (r) {
      rows.push(`return ${r};`);
      lineFields.push({ field: 'result', line: lines.length + 1, prefix: 7 });
    }
  } else if (typeof legacyExpr === 'string' && legacyExpr.trim()) {
    const parts = legacyExpr.split(';').map(s => flat(s).trim()).filter(Boolean);
    parts.forEach((p, i) => {
      const last = i === parts.length - 1;
      rows.push(last ? `return ${p};` : `${p};`);
      lineFields.push({ field: 'expr', line: i + 1, prefix: last ? 7 : 0 });
    });
  }
  return rows.length ? { text: rows.join('\n'), lineFields } : null;
}

/** A Custom Function's body: statements as they are, a bare expression read as its return. */
export function customFnBody(body: string): { text: string; lineFields?: SourceInput['lineFields'] } {
  if (/\breturn\b/.test(body) || /;\s*\S/.test(body.trim())) return { text: body };
  const lines = body.split('\n');
  return {
    text: `return ${body.replace(/;\s*$/, '')};`,
    lineFields: lines.map((_, i) => ({ field: 'body', line: i + 1, prefix: i === 0 ? 7 : 0 })),
  };
}

const firstLine = (s: string, max = 60) => { const l = s.split('\n').map(x => x.trim()).find(Boolean) ?? ''; return l.length > max ? `${l.slice(0, max - 1)}…` : l; };

/** The written code inside a graph's nodes, into groups at any depth. */
export function graphSources(nodes: unknown, opts: GraphSourceOptions = {}, path: string[] = []): SourceInput[] {
  const out: SourceInput[] = [];
  const kind = opts.kindFor ?? ((k: SourceKind) => k);
  for (const n of arr(nodes).map(obj)) {
    if (!n) continue;
    const id = str(n.id);
    const type = str(n.type) ?? '';
    const params = obj(n.params) ?? {};
    if (!id) continue;
    const nodePath = [...path, id];
    const comment = str(params.__comment) ?? '';
    const ownLabel = str(params.label)?.trim();
    const nodeLabel = ownLabel || (comment ? firstLine(comment) : '') || opts.nodeLabel?.(type) || type;
    const base = { nodeId: id, nodePath, nodeLabel, nodeType: type, words: [ownLabel ?? '', comment].join(' ').trim() || undefined };
    if (type === 'exprNode') {
      const s = exprBlockSource(params.lines, params.result, params.expr);
      if (s) out.push({ ...base, sourceKind: kind('expr'), mode: 'body', field: 'lines', text: s.text, lineFields: s.lineFields });
    }
    if (type === 'customFn') {
      const body = str(params.body);
      if (body?.trim()) { const b = customFnBody(body); out.push({ ...base, sourceKind: kind('customFn'), mode: 'body', field: 'body', text: b.text, lineFields: b.lineFields }); }
      const fns = str(params.glslFunctions);
      if (fns?.trim()) out.push({ ...base, sourceKind: kind('customFn'), mode: 'file', field: 'glslFunctions', text: fns });
    }
    for (const [k, v] of Object.entries(params)) {
      if (!k.startsWith(INPUT_EXPR_PREFIX) || typeof v !== 'string' || !v.trim()) continue;
      out.push({ ...base, sourceKind: kind('inputExpr'), mode: 'expr', field: k, text: v.replace(/[\r\n]+/g, ' ') });
    }
    const sub = obj(params.subgraph);
    if (sub) out.push(...graphSources(sub.nodes, opts, nodePath));
  }
  return out;
}

/** A graph as a doc. */
export function graphDoc(docId: string, origin: Origin, label: string, group: string, nodes: unknown, opts: GraphSourceOptions = {}): DocInput | null {
  const sources = graphSources(nodes, opts);
  return sources.length ? { docId, origin, label, group, sources } : null;
}

/** The bundled examples (except the blank starter). `folderOf` names a key's Examples folder. */
export function exampleDocs(graphs: Record<string, { label: string; nodes: unknown }>, folderOf: (key: string) => string | undefined, opts: GraphSourceOptions = {}): DocInput[] {
  const out: DocInput[] = [];
  for (const [key, g] of Object.entries(graphs)) {
    if (key === 'blank') continue;
    const d = graphDoc(`example:${key}`, 'example', g.label || key, folderOf(key) ?? 'Other examples', g.nodes, opts);
    if (d) out.push(d);
  }
  return out;
}

/** A Custom Function preset (body + helper functions). */
export function customFnPresetDoc(docId: string, v: unknown, group = 'Presets'): DocInput | null {
  const p = obj(v);
  if (!p) return null;
  const label = str(p.label) || 'Custom function';
  const base = { sourceKind: 'preset' as const, nodeLabel: label, nodeType: 'customFn', words: [label, str(p.comment) ?? ''].join(' ') };
  const sources: SourceInput[] = [];
  const body = str(p.body);
  if (body?.trim()) { const b = customFnBody(body); sources.push({ ...base, mode: 'body', field: 'body', text: b.text, lineFields: b.lineFields }); }
  const fns = str(p.glslFunctions);
  if (fns?.trim()) sources.push({ ...base, mode: 'file', field: 'glslFunctions', text: fns });
  return sources.length ? { docId, origin: 'saved', label, group, sources } : null;
}

/** An Expression preset (lines + result). */
export function exprPresetDoc(docId: string, v: unknown, group = 'Presets'): DocInput | null {
  const p = obj(v);
  if (!p) return null;
  const label = str(p.label) || 'Expression';
  const s = exprBlockSource(p.lines, p.result);
  if (!s) return null;
  return { docId, origin: 'saved', label, group, sources: [{ sourceKind: 'preset', nodeLabel: label, nodeType: 'exprNode', words: [label, str(p.comment) ?? ''].join(' '), mode: 'body', field: 'lines', text: s.text, lineFields: s.lineFields }] };
}

/** A whole GLSL text (a saved shader, a Convert source, a linked file). */
export function fileDoc(docId: string, origin: Origin, label: string, group: string, sourceKind: SourceKind, code: string, words?: string): DocInput | null {
  if (!code.trim()) return null;
  return { docId, origin, label, group, sources: [{ sourceKind, mode: 'file', field: 'code', text: code, words: [label, words ?? ''].join(' ') }] };
}

/** A Function Builder function: one expression of x / uv and t. */
export function builderFnDoc(docId: string, v: unknown, group = 'Presets'): DocInput | null {
  const p = obj(v);
  const body = str(p?.body);
  if (!p || !body?.trim()) return null;
  const label = str(p.name) || 'Builder function';
  return { docId, origin: 'saved', label, group, sources: [{ sourceKind: 'preset', nodeLabel: label, words: label, mode: 'expr', field: 'body', text: body.replace(/[\r\n]+/g, ' ') }] };
}

/** The GLSL typed into a presentation's code blocks (quotes of generated code are left for phase 2). */
export function presentationDoc(docId: string, name: string, v: unknown): DocInput | null {
  const p = obj(v);
  if (!p) return null;
  const sources: SourceInput[] = [];
  arr(p.steps).forEach((rawStep, si) => {
    const step = obj(rawStep);
    arr(step?.blocks).forEach((rawBlock, bi) => {
      const b = obj(rawBlock);
      if (b?.type !== 'code' || b.language !== 'glsl' || b.from) return;
      const code = str(b.code);
      if (!code?.trim()) return;
      const where = str(step?.title) || `Step ${si + 1}`;
      sources.push({ sourceKind: 'present', mode: 'file', field: `steps[${si}].blocks[${bi}]`, nodeId: str(b.id), nodeLabel: str(b.caption) || where, words: [where, str(b.caption) ?? ''].join(' '), text: code });
    });
  });
  return sources.length ? { docId, origin: 'presentation', label: str(p.title) || name, group: 'Presentations', sources } : null;
}
