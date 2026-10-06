/**
 * Line previews (docs/node-previews.md, "Line previews"): the value of one variable inside an
 * Expression Block or a Custom Function, drawn by the eye preview like any node output.
 *
 * A probe is temporary. While one is set, the eye preview compiles a *copy* of the block whose
 * only output is that variable, as if it were an "Also outputs" socket:
 *
 *  - Expression Block: the lines up to and including the probed one (the variable's value right
 *    after that line), with the variable exposed (params.outputs). An input probe keeps no lines;
 *    the Return probe is the block's own result.
 *  - Custom Function: the body with `pv_probe = <name>;` put after the statement that declares
 *    the variable, and `pv_probe` as an extra (out) output (no `__`: GLSL reserves it).
 *
 * The saved graph is never touched: no param changes, no undo step, no dirty mark. The copy only
 * exists in the preview compile (store buildPreviewGraph), the value runner and the Show as UI,
 * which all ask `probedNode`.
 */
import { create } from 'zustand';
import type { GraphNode } from '../../types/nodeGraph';

export type ProbeTarget =
  | { kind: 'input'; name: string }
  | { kind: 'line'; index: number }
  | { kind: 'return' }
  /** A Custom Function's named local (its declaration's line in the body, 0-based). */
  | { kind: 'local'; name: string; line: number };

export interface LineProbe { nodeId: string; target: ProbeTarget }

/** The preview types a probe can draw. */
const DRAWABLE = /^(float|vec[234])$/;
const DECL = /^\s*(?:(?:const|highp|mediump|lowp)\s+)*(float|vec[234]|int|bool|mat[234])\s+([A-Za-z_]\w*)/;

type ExprLine = { lhs?: string; op?: string; rhs?: string; off?: boolean };
type InputDef = { name: string; type: string };

const inputsOf = (node: GraphNode): InputDef[] =>
  Array.isArray(node.params.inputs) ? (node.params.inputs as InputDef[]).filter(i => i && typeof i.name === 'string') : [];

export interface ResolvedProbe {
  /** The variable shown. */
  name: string;
  type: string;
  /** One line for the panel's header: "Line 3 · float h = fract(dot(p, …))". */
  label: string;
}

/** The variable an Expression Block line assigns, and its type (from the line, an earlier declaration, an input, or the block). */
export function exprLineVariable(node: GraphNode, index: number): { name: string; type: string } | null {
  const lines = (node.params.lines as ExprLine[] | undefined) ?? [];
  const line = lines[index];
  if (!line || !line.lhs) return null;
  const decl = DECL.exec(line.lhs);
  if (decl) return { name: decl[2], type: decl[1] };
  const m = /^\s*([A-Za-z_]\w*)/.exec(line.lhs);
  if (!m) return null;
  const name = m[1];
  for (let i = index - 1; i >= 0; i--) {
    const d = lines[i]?.lhs ? DECL.exec(lines[i].lhs!) : null;
    if (d && d[2] === name) return { name, type: d[1] };
  }
  const inp = inputsOf(node).find(i => i.name === name);
  if (inp) return { name, type: inp.type };
  // `p` (and `t`) are the block's own scratch variables
  if (name === 'p') return { name, type: (node.params.outputType as string) || 'vec3' };
  if (name === 't') return { name, type: 'float' };
  return null;
}

/** Named locals a Custom Function body declares, in order, with the line each is declared on. */
export function customFnLocals(body: string): Array<{ name: string; type: string; line: number }> {
  const out: Array<{ name: string; type: string; line: number }> = [];
  body.split('\n').forEach((l, i) => {
    // Declarations at the start of a statement on this line (after `{` / `;` too)
    const re = /(?:^|[;{]\s*)(?:(?:const|highp|mediump|lowp)\s+)*(float|vec[234])\s+([A-Za-z_]\w*)\s*(?==|;|,)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(l))) if (!out.some(o => o.name === m![2])) out.push({ name: m[2], type: m[1], line: i });
  });
  return out;
}

function clip(s: string, n = 34): string { const t = s.replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; }

/** What a probe shows, or why it can't. */
export function resolveProbe(node: GraphNode, target: ProbeTarget): ResolvedProbe | { error: string } {
  if (target.kind === 'return') {
    const type = (node.params.outputType as string) || node.outputs?.result?.type || 'float';
    const expr = node.type === 'customFn' ? 'result' : `return ${clip((node.params.result as string) || '…')}`;
    return { name: 'result', type, label: `Return · ${expr}` };
  }
  if (target.kind === 'input') {
    const inp = inputsOf(node).find(i => i.name === target.name);
    const type = node.inputs?.[target.name]?.type ?? inp?.type;
    if (!type) return { error: `No input called ${target.name}.` };
    return { name: target.name, type, label: `Input · ${type} ${target.name}` };
  }
  if (target.kind === 'local') {
    const local = customFnLocals(typeof node.params.body === 'string' ? node.params.body : '').find(l => l.name === target.name);
    if (!local) return { error: `${target.name} isn't declared in the body any more.` };
    return { name: local.name, type: local.type, label: `Line ${local.line + 1} · ${local.type} ${local.name}` };
  }
  const lines = (node.params.lines as ExprLine[] | undefined) ?? [];
  const line = lines[target.index];
  if (!line) return { error: 'That line is gone.' };
  if (!line.lhs || !line.rhs) return { error: `Line ${target.index + 1} isn't finished yet.` };
  if (line.off) return { error: `Line ${target.index + 1} is switched off.` };
  const v = exprLineVariable(node, target.index);
  if (!v) return { error: `Can't tell which variable line ${target.index + 1} sets.` };
  return { ...v, label: `Line ${target.index + 1} · ${clip(`${line.lhs} ${line.op || '='} ${line.rhs}`, 44)}` };
}

/** The probe output's socket key on the copy. */
export const PROBE_KEY = 'pv_probe';

/**
 * The copy of `node` the eye preview compiles for a probe: its only output is the probed value
 * (key PROBE_KEY for a Custom Function, else the variable's own name or `result`). Pure.
 */
export function applyProbe(node: GraphNode, target: ProbeTarget): { node: GraphNode; outputKey: string } | { error: string } {
  const r = resolveProbe(node, target);
  if ('error' in r) return r;
  if (!DRAWABLE.test(r.type)) return { error: `A ${r.type} can't be drawn; preview a float or a vector.` };
  const label = r.name;
  if (target.kind === 'return') {
    const outputs = { result: { ...(node.outputs?.result ?? { label: 'Result' }), type: r.type as never } } as GraphNode['outputs'];
    return { node: { ...node, outputs }, outputKey: 'result' };
  }
  if (node.type === 'customFn') {
    const body = typeof node.params.body === 'string' ? node.params.body : '';
    let probed: string;
    if (target.kind === 'local') {
      const ls = body.split('\n');
      const local = customFnLocals(body).find(l => l.name === r.name)!;
      // After the statement that declares it: the first line from there that ends one
      let at = local.line;
      while (at < ls.length - 1 && !/;\s*(\/\/.*)?$/.test(ls[at])) at++;
      ls.splice(at + 1, 0, `${PROBE_KEY} = ${r.name};`);
      probed = ls.join('\n');
    } else {
      // An input: assigned first thing
      const trimmed = body.trim();
      const single = !trimmed.includes('\n') && !/;/.test(trimmed.replace(/;\s*$/, '')) && !/\breturn\b/.test(trimmed);
      probed = `${PROBE_KEY} = ${r.name};\n${single ? `return ${trimmed.replace(/;\s*$/, '')};` : trimmed}`;
    }
    return {
      node: {
        ...node,
        params: {
          ...node.params, body: probed,
          // Its own out parameters stay declared (the body assigns them); the probe is one more
          outputs: [...((node.params.outputs as Array<{ name: string; type: string }> | undefined) ?? []).filter(o => o && o.name !== PROBE_KEY), { name: PROBE_KEY, type: r.type }],
        },
        outputs: { [PROBE_KEY]: { type: r.type as never, label } } as GraphNode['outputs'],
      },
      outputKey: PROBE_KEY,
    };
  }
  // Expression Block: the lines up to the probed one, the variable exposed; the result is the type's zero
  const lines = (node.params.lines as ExprLine[] | undefined) ?? [];
  const kept = target.kind === 'line' ? lines.slice(0, target.index + 1) : [];
  return {
    node: {
      ...node,
      params: { ...node.params, lines: kept, result: '', outputs: [r.name] },
      outputs: { [r.name]: { type: r.type as never, label } } as GraphNode['outputs'],
    },
    outputKey: r.name,
  };
}

// ── State ────────────────────────────────────────────────────────────────────

export const useLineProbe = create<{
  probe: LineProbe | null;
  set: (probe: LineProbe | null) => void;
}>(set => ({
  probe: null,
  set: probe => set({ probe }),
}));

// One copy per (node object, probe): the store replaces a node object on every change, so a
// stale copy is never reused, and repeat calls in one compile share it.
const copies = new WeakMap<GraphNode, { probe: LineProbe; node: GraphNode }>();

/** The node as the preview sees it: the probe's copy while a probe is set on it, else itself. */
export function probedNode<N extends GraphNode | null>(node: N, probe: LineProbe | null = useLineProbe.getState().probe): N {
  if (!node || !probe || probe.nodeId !== node.id) return node;
  const hit = copies.get(node);
  if (hit && hit.probe === probe) return hit.node as N;
  const r = applyProbe(node, probe.target);
  const key = JSON.stringify(probe.target);
  let out: GraphNode;
  if ('error' in r) {
    // Mid-typing: keep the last copy that worked for this line (the last good picture)
    const good = lastGood.get(node.id);
    out = good && good.key === key ? good.node : node;
  } else {
    out = r.node;
    lastGood.set(node.id, { key, node: out });
  }
  copies.set(node, { probe, node: out });
  return out as N;
}
const lastGood = new Map<string, { key: string; node: GraphNode }>();

/** The order ↑ / ↓ walk: the inputs, then each line, then Return. */
export function probeSteps(node: GraphNode): ProbeTarget[] {
  const steps: ProbeTarget[] = inputsOf(node).map(i => ({ kind: 'input', name: i.name }));
  if (node.type === 'customFn') {
    for (const l of customFnLocals(typeof node.params.body === 'string' ? node.params.body : '')) steps.push({ kind: 'local', name: l.name, line: l.line });
  } else {
    const lines = (node.params.lines as ExprLine[] | undefined) ?? [];
    lines.forEach((_, index) => steps.push({ kind: 'line', index }));
  }
  steps.push({ kind: 'return' });
  return steps;
}

export function sameTarget(a: ProbeTarget, b: ProbeTarget): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** The target `step` away from `current` in probeSteps order (clamped at the ends). */
export function stepProbe(node: GraphNode, current: ProbeTarget, step: number): ProbeTarget {
  const steps = probeSteps(node);
  let i = steps.findIndex(s => sameTarget(s, current));
  if (i < 0 && current.kind === 'local') i = steps.findIndex(s => s.kind === 'local' && s.name === current.name);
  if (i < 0) return steps[0];
  return steps[Math.max(0, Math.min(steps.length - 1, i + step))];
}
