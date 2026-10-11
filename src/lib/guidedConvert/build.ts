/**
 * Guided Convert, the graph at a step (docs/guided-convert.md): the staged shader through the automatic
 * converter, every node mapped back to the step (or the remainder) it came from, then what the steps
 * chose applied: remainder functions labelled, number chips as slider inputs, Expression steps folded,
 * groups collapsed, columns laid out again. Pure and deterministic: the same (shader, steps) gives the
 * same graph, so undo is dropping the last step.
 */
import { glslToGraph, type ConversionReport } from '../../glslToGraph';
import { compileGraph } from '../../compiler/graphCompiler';
import { optimizeGraph } from '../../optimize/optimizeGraph';
import { collapseToGroup } from '../../store/groupCollapse';
import { estimateNodeHeight, layoutByRank } from '../../store/graphLayout';
import { getNodeDefinitionFor } from '../../nodes/definitions';
import { rangeForValue } from '../rangeMath';
import type { GraphNode } from '../../types/nodeGraph';
import type { PlayControl } from '../../types/play';
import type { ConstantsItem } from '../../nodes/definitions/constants';
import { lineShare, type Analysis } from './analyse';
import { stage, unitOwners, type ConvertStep, type GroupStep, type Staged, type Step } from './stage';

/** Nodes every step reads (time, resolution, the Constants card): never tinted as a step's, never pulled into a group. */
export const SHARED_TYPES = new Set(['fragCoord', 'resolution', 'time', 'mouse', 'constants', 'output', 'vec4Output']);

export interface GuidedBuild {
  ok: true;
  staged: Staged;
  nodes: GraphNode[];
  controls?: PlayControl[];
  /** Node id (top level and inside loop groups) → its owner: a step id, `rest:<unit>`, or `setup`. */
  owner: Map<string, string>;
  report: ConversionReport;
  /** The share of main()'s lines converted. */
  share: { done: number; total: number };
  /** Things a step asked for that couldn't be done (a group that would loop back on itself). */
  notes: string[];
  /** The compiled graph's fragment shader and slider uniforms (null when it doesn't compile). */
  compiled: { fragmentShader: string; paramUniforms: Record<string, number | number[]> } | null;
  compileErrors: string[];
}
export type BuildResult = GuidedBuild | { ok: false; error: string };

/**
 * Each node's stable key: `<owner>:<type>#<n>`, n counting that owner's nodes of that type in graph
 * order. Ids shift as later steps convert more; these don't, so a group's hidden sliders survive.
 */
export function stableKeys(nodes: readonly GraphNode[], owner: ReadonlyMap<string, string>): Map<string, string> {
  const count = new Map<string, number>();
  const out = new Map<string, string>();
  const visit = (list: readonly GraphNode[]) => {
    for (const n of list) {
      const base = `${owner.get(n.id) ?? '?'}:${n.type}`;
      const k = count.get(base) ?? 0; count.set(base, k + 1);
      out.set(n.id, `${base}#${k}`);
      const sg = n.params.subgraph as { nodes: GraphNode[] } | undefined;
      if (sg) visit(sg.nodes);
    }
  };
  visit(nodes);
  return out;
}

/** The float sliders a set of nodes has, as `<stable key>::<param>` with a label, for a group's "shown sliders". */
export function slidersOf(nodes: readonly GraphNode[], keys: ReadonlyMap<string, string>): { key: string; label: string; node: string; value: number }[] {
  const out: { key: string; label: string; node: string; value: number }[] = [];
  for (const n of nodes) {
    const def = getNodeDefinitionFor(n);
    for (const [k, pd] of Object.entries(def?.paramDefs ?? {})) {
      if (pd.type !== 'float' || pd.step === 1) continue;
      const v = n.params[k];
      out.push({ key: `${keys.get(n.id)}::${k}`, label: pd.label ?? k, node: String(n.params.label ?? def?.label ?? n.type), value: typeof v === 'number' ? v : 0 });
    }
  }
  return out;
}

/** The graph for these steps. */
export function buildGuided(a: Analysis, steps: readonly Step[]): BuildResult {
  const staged = stage(a, steps);
  if ('error' in staged) return { ok: false, error: staged.error };
  const conv = glslToGraph(staged.code, { origins: true });
  if (conv.report.unsupported.length) return { ok: false, error: `The converter can’t take this cut: ${conv.report.unsupported.join(' · ')}` };
  let nodes = conv.nodes;
  const notes: string[] = [];

  // Every node back to its step: the statement of main() it was made for, and that statement's owner.
  const offset = (conv.mainStatements ?? staged.stmtOwner.length) - staged.stmtOwner.length;
  const owner = new Map<string, string>();
  for (const [id, i] of Object.entries(conv.origins ?? {})) owner.set(id, i < 0 ? 'setup' : staged.stmtOwner[i - offset] ?? 'setup');
  const steppy = steps.filter((s): s is ConvertStep => s.kind === 'convert');
  const stepById = new Map(steppy.map(s => [s.id, s]));

  // Remainder and One function regions: labelled by where they came from.
  const runOf = new Map(staged.runs.map(r => [r.owner, r]));
  const linesOf = (units: number[]) => `${a.units[units[0]].lines[0]}–${Math.max(...units.map(i => a.units[i].lines[1]))}`;
  nodes = nodes.map(n => {
    const run = runOf.get(owner.get(n.id) ?? '');
    if (!run || n.type !== 'customFn') return n;
    const part = /\(\d+\/\d+\)$/.exec(String(n.params.label ?? ''))?.[0];
    const rest = run.owner.startsWith('rest:');
    const label = rest ? `Not converted yet · lines ${linesOf(run.units)}` : stepById.get(run.owner)?.name ?? run.fn;
    return { ...n, params: { ...n.params, label: part ? `${label} ${part}` : label, __guided: rest ? 'rest' : 'step' } };
  });

  // Number chips on One function steps: a slider is a slider input on the function, an input stays wired to its constant.
  for (const run of staged.runs) for (const c of run.chipParams) {
    if (c.choice !== 'slider') continue;
    nodes = nodes.map(n => {
      if (n.type !== 'customFn' || owner.get(n.id) !== run.owner || !n.inputs[c.name]) return n;
      const r = rangeForValue(c.value);
      const ins = (n.params.inputs as Array<{ name: string; type: string; slider: unknown }>).map(i => (i.name === c.name ? { ...i, slider: { min: Math.min(r.min, c.value), max: Math.max(r.max, c.value) } } : i));
      return { ...n, inputs: { ...n.inputs, [c.name]: { ...n.inputs[c.name], connection: undefined } }, params: { ...n.params, inputs: ins, [c.name]: c.value } };
    });
  }
  nodes = dropUnreadConstants(nodes);

  // Expression steps: the step's chains of math cards folded into Expression Blocks, sliders kept.
  for (const s of steppy) {
    if (s.mode !== 'blocks') continue;
    const only = new Set(nodes.filter(n => owner.get(n.id) === s.id && !SHARED_TYPES.has(n.type)).map(n => n.id));
    if (only.size < 2) continue;
    const o = optimizeGraph(nodes, { only, minChain: 2, keepSliders: true, absorb: false });
    for (const f of o.report.folds) owner.set(f.blockId, s.id);
    nodes = o.nodes;
  }

  // Groups.
  for (const g of steps.filter((s): s is GroupStep => s.kind === 'group')) {
    const members = new Set(g.members);
    const ids = nodes.filter(n => members.has(owner.get(n.id) ?? '') && !SHARED_TYPES.has(n.type)).map(n => n.id);
    if (!ids.length) { notes.push(`“${g.name}” has no nodes to group`); continue; }
    const between = loopsBack(nodes, new Set(ids));
    if (between) { notes.push(`“${g.name}” can’t be one group: ${between} sits between its parts. Group steps that follow one another.`); continue; }
    const keys = stableKeys(nodes, owner);
    let k = 0;
    const r = collapseToGroup(nodes, ids, { label: g.name, nextId: () => `${g.id}_${k++ === 0 ? 'index' : 'group'}` });
    if (!r) { notes.push(`“${g.name}” couldn’t be grouped`); continue; }
    owner.set(r.groupId, g.id);
    owner.set(`${g.id}_index`, g.id);
    const hidden = new Set(g.hidden);
    const hiddenParams: string[] = [];
    for (const id of ids) {
      const node = nodes.find(n => n.id === id)!;
      const def = getNodeDefinitionFor(node);
      for (const pk of Object.keys(def?.paramDefs ?? {})) if (hidden.has(`${keys.get(id)}::${pk}`)) hiddenParams.push(`${id}::${pk}`);
    }
    // Outputs named after the values they carry, where a reader says (a function's or block's inputs are the shader's names).
    const portName = new Map<string, string>();
    for (const n of r.nodes) if (n.type === 'customFn' || n.type === 'exprNode') for (const [k, i] of Object.entries(n.inputs)) if (i.connection?.nodeId === r.groupId && !portName.has(i.connection.outputKey)) portName.set(i.connection.outputKey, k.replace(/_in$/, ''));
    nodes = r.nodes.map(n => {
      if (n.id !== r.groupId) return n;
      const outputs = Object.fromEntries(Object.entries(n.outputs).map(([k, o]) => [k, portName.has(k) ? { ...o, label: portName.get(k)! } : o]));
      const sg = n.params.subgraph as { outputPorts: Array<{ key: string; label: string }> };
      const outputPorts = sg.outputPorts.map(p => (portName.has(p.key) ? { ...p, label: portName.get(p.key)! } : p));
      return { ...n, outputs, params: { ...n.params, subgraph: { ...sg, outputPorts }, hiddenParams, __guided: 'group' } };
    });
  }

  // Columns again (a group sits where its members were; folded blocks are taller than what they replaced).
  const at = layoutByRank(nodes, { heightOf: estimateNodeHeight, order: (p, q) => p.position.y - q.position.y });
  nodes = nodes.map(n => { const p = at.get(n.id); return p ? { ...n, position: p } : n; });

  const owned = new Set<number>();
  for (const [u, o] of unitOwners(a, steps)) if (o !== 'setup') owned.add(u);
  const c = compileGraph({ nodes });
  return {
    ok: true, staged, nodes, ...(conv.controls ? { controls: conv.controls } : {}), owner, report: conv.report,
    share: lineShare(a, owned), notes,
    compiled: c.success ? { fragmentShader: c.fragmentShader, paramUniforms: c.paramUniforms ?? {} } : null,
    compileErrors: c.success ? [] : (c.errors ?? ['The graph doesn’t compile']),
  };
}

/** Constants entries nothing reads any more (a chip turned into a slider) go; an empty card goes too. */
function dropUnreadConstants(nodes: GraphNode[]): GraphNode[] {
  const read = new Set<string>();
  const visit = (list: readonly GraphNode[]) => { for (const n of list) { for (const i of Object.values(n.inputs)) if (i.connection) read.add(`${i.connection.nodeId}:${i.connection.outputKey}`); const sg = n.params.subgraph as { nodes: GraphNode[] } | undefined; if (sg) visit(sg.nodes); } };
  visit(nodes);
  const out: GraphNode[] = [];
  for (const n of nodes) {
    if (n.type !== 'constants') { out.push(n); continue; }
    const items = (n.params.items as ConstantsItem[]) ?? [];
    const keep = items.filter(i => read.has(`${n.id}:${i.key}`) || Object.keys(n.outputs).some(k => k.startsWith(`${i.key}_`) && read.has(`${n.id}:${k}`)));
    if (keep.length === items.length) { out.push(n); continue; }
    if (!keep.length) continue;
    const outputs = Object.fromEntries(Object.entries(n.outputs).filter(([k]) => keep.some(i => k === i.key || k.startsWith(`${i.key}_`))));
    out.push({ ...n, outputs, params: { ...n.params, items: keep } });
  }
  return out;
}

/** A node outside `ids` that one of them feeds and that feeds one of them (grouping would make a loop), by label; else null. */
function loopsBack(nodes: readonly GraphNode[], ids: ReadonlySet<string>): string | null {
  const readers = new Map<string, string[]>();
  for (const n of nodes) for (const i of Object.values(n.inputs)) if (i.connection) readers.set(i.connection.nodeId, [...(readers.get(i.connection.nodeId) ?? []), n.id]);
  const byId = new Map(nodes.map(n => [n.id, n]));
  // Downstream of the members, outside them.
  const down = new Set<string>();
  const stack = [...ids];
  while (stack.length) { const id = stack.pop()!; for (const r of readers.get(id) ?? []) if (!ids.has(r) && !down.has(r)) { down.add(r); stack.push(r); } }
  // Upstream of the members, outside them.
  const up = new Set<string>();
  const st2 = [...ids];
  while (st2.length) { const id = st2.pop()!; for (const i of Object.values(byId.get(id)?.inputs ?? {})) { const f = i.connection?.nodeId; if (f && !ids.has(f) && !up.has(f) && byId.has(f)) { up.add(f); st2.push(f); } } }
  for (const id of down) if (up.has(id)) { const n = byId.get(id)!; return `“${String(n.params.label ?? getNodeDefinitionFor(n)?.label ?? n.type)}”`; }
  return null;
}

/** Owners shown in colour: the convert steps, in order (remainder and setup aren't). */
export const STEP_HUES = [211, 28, 152, 280, 345, 48, 188, 100];
export const hueOf = (steps: readonly Step[], id: string): number | null => {
  const i = steps.filter(s => s.kind === 'convert').findIndex(s => s.id === id);
  return i < 0 ? null : STEP_HUES[i % STEP_HUES.length];
};
