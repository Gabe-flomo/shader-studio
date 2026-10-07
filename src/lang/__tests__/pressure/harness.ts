/**
 * harness.ts — the language pressure test (docs/reports/language-pressure-test.md): print an
 * example as Do… bar lines (lang/fromGraph.ts), run the lines through the real bar on the store
 * (the way components/NodeGraph/DoBar.tsx `run` does: other dialects through their builders,
 * picture and edit lines through runCommand), and compare what comes out with the example:
 * its structure (nodes, wires, settings, groups, containers) and its compiled shader.
 */
import type { GraphNode } from '../../../types/nodeGraph';
import { useNodeGraphStore, migrateLoadedNodes } from '../../../store/useNodeGraphStore';
import { spreadLegacyLayout } from '../../../store/legacyLayout';
import { readLine, readsCanonically, gridPlan, sceneNodes, agentsNodes } from '../../run';
import { execCommand } from '../../../suggestions/doCommands';
import { parseDo } from '../../../suggestions/doBar';
import { compileGraph } from '../../../compiler/graphCompiler';
import { getNodeDefinition, getNodeDefinitionFor } from '../../../nodes/definitions';
import { graphToScript, emptyOutput, sameValue, PARAM_SKIP, type PrintResult, type Gap } from '../../fromGraph';
import { flattenGraph, levelDigest, digestOverlap, subgraphOf, isPlainGroup, pairInside } from '../../graphFlat';

export type Klass = 'Full' | 'Near' | 'Partial' | 'None';

export interface Diff { kind: 'missing-node' | 'extra-node' | 'type' | 'param' | 'label' | 'missing-wire' | 'extra-wire' | 'group' | 'container' | 'shader' | 'uniform' | 'compile' | 'run'; detail: string }

export interface ExampleResult {
  key: string;
  label: string;
  category: string;
  klass: Klass;
  nodes: number;
  nodesMade: number;
  pctNodes: number;
  wires: number;
  wiresMade: number;
  params: number;
  paramsSet: number;
  lines: number;
  canonicalLines: number;
  sugarLines: number;
  recipeLines: number;
  gapLines: number;
  /** Lines the printer kept that failed when the store ran them. */
  runFailures: Array<{ line: string; error: string }>;
  shaderSame: boolean | null;
  uniformsSame: boolean | null;
  compileOriginal: boolean;
  compileRebuilt: boolean;
  diffs: Diff[];
  gaps: Gap[];
  script: string;
  printerThrew?: string;
  ms: number;
}

/** An example's nodes as loading brings them up to date (useNodeGraphStore loadExampleGraph). */
export const loadNodes = (raw: GraphNode[]) => spreadLegacyLayout(migrateLoadedNodes(raw));

// ── Running lines on the store, as the Do… bar does ─────────────────────────

export interface StoreRun { ok: boolean; error?: string; added: string[] }

const topIds = () => useNodeGraphStore.getState().nodes.map(nd => nd.id);

export function storeRunLine(text: string): StoreRun {
  const st = useNodeGraphStore.getState();
  const before = new Set(topIds());
  const done = (ok: boolean, error?: string): StoreRun => ({ ok, error, added: topIds().filter(id => !before.has(id)) });
  if (text.startsWith('#')) return done(true);
  try {
    const line = readLine(text, { seed: 1 });
    const canonicalRun = readsCanonically(line) ? line : null;
    const runText = canonicalRun?.dialect === 'picture' ? canonicalRun.picture!.sentence! : text;
    const other = canonicalRun && canonicalRun.dialect !== 'picture' ? canonicalRun : null;
    const selected = (st.selectedNodeIds.length > 1 ? st.selectedNodeIds : st.selectedNodeId ? [st.selectedNodeId] : st.selectedNodeIds);
    if (other) {
      if (other.dialect === 'grid') {
        const ran = st.runDoPlan(gridPlan(other.grid!, selected[0]), text);
        return done(ran.length > 0, ran.length ? undefined : 'Grid Rules: nothing ran');
      }
      const nextId = () => useNodeGraphStore.getState().newNodeId();
      const nodes = useNodeGraphStore.getState().nodes;
      const made = other.dialect === 'scene' ? sceneNodes(nodes, other.scene!, nextId).nodes : agentsNodes(nodes, other.agents!, nextId).nodes;
      useNodeGraphStore.getState().setNodesRewritten(made, `Do: ${text}`);
      return done(true);
    }
    if (line.dialect !== 'picture') return done(false, line.errors[0]?.message ?? 'does not read');
    const plan = parseDo(runText, { nodes: st.nodes, selected });
    if (plan.intent) return done(false, 'reads as a question');
    const cmd = execCommand(runText, st.nodes, { selected, topLevel: true });
    if (!cmd.ok) return done(false, cmd.clauses.find(c => c.status !== 'ok')?.message ?? 'nothing to run');
    const ran = useNodeGraphStore.getState().runCommand(runText.trim(), {});
    return done(ran.ok, ran.ok ? undefined : ran.clauses.find(c => c.status !== 'ok')?.message);
  } catch (e) {
    return done(false, `threw: ${(e as Error).message}`);
  }
}

// ── Comparing ─────────────────────────────────────────────────────────────

function allNodes(nodes: GraphNode[]): GraphNode[] {
  return nodes.flatMap(nd => [nd, ...(subgraphOf(nd) ? allNodes(subgraphOf(nd)!.nodes) : [])]);
}

const describe = (nd: GraphNode | undefined) => (nd ? `${getNodeDefinition(nd.type)?.label ?? nd.type}${typeof nd.params.label === 'string' ? ` “${nd.params.label}”` : ''}` : '?');

/** Rename ids (everywhere: node ids, connections, ports, group-port params) and put each level in the original's order. */
function renameGraph(nodes: GraphNode[], ren: Map<string, string>, order: Map<string, number>): GraphNode[] {
  const r = (id: string) => ren.get(id) ?? id;
  const level = (ns: GraphNode[]): GraphNode[] => ns.map(nd => {
    const sg = subgraphOf(nd);
    const params: Record<string, unknown> = { ...nd.params };
    if (sg) {
      params.subgraph = {
        ...sg, nodes: level(sg.nodes),
        inputPorts: (sg.inputPorts ?? []).map(p => ({ ...p, toNodeId: r(p.toNodeId) })),
        outputPorts: (sg.outputPorts ?? []).map(p => ({ ...p, fromNodeId: r(p.fromNodeId) })),
      };
    }
    return {
      ...nd, id: r(nd.id), params,
      inputs: Object.fromEntries(Object.entries(nd.inputs).map(([k, i]) => [k, i.connection ? { ...i, connection: { ...i.connection, nodeId: r(i.connection.nodeId) } } : i])),
    };
  }).sort((a, b) => (order.get(a.id) ?? 1e9) - (order.get(b.id) ?? 1e9));
  return level(nodes);
}

/** GLSL without comments (node notes are written into the shader as comments) or blank lines. */
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map(l => l.replace(/\/\/.*$/, '').trimEnd()).filter(l => l.trim()).join('\n');

/**
 * Every node's settings over its type's defaults, both sides: an example node written before a
 * setting existed and a new node with it at its default draw the same, but one inlines the value
 * and the other makes it a uniform.
 */
function withDefaults(nodes: GraphNode[]): GraphNode[] {
  return nodes.map(nd => {
    const sg = subgraphOf(nd);
    const params = { ...(getNodeDefinition(nd.type)?.defaultParams ?? {}), ...nd.params };
    if (sg) params.subgraph = { ...sg, nodes: withDefaults(sg.nodes) };
    return { ...nd, params };
  });
}

interface Compiled { ok: boolean; text: string; uniforms: Record<string, number | number[]>; error?: string }
function compile(nodes: GraphNode[]): Compiled {
  try {
    const c = compileGraph({ nodes } as never);
    const text = stripComments([c.fragmentShader, ...(c.passes ?? []).map(p => p.fragmentShader)].join('\n@@pass@@\n'));
    return { ok: c.success, text, uniforms: c.paramUniforms ?? {}, error: c.errors?.[0] };
  } catch (e) {
    return { ok: false, text: '', uniforms: {}, error: (e as Error).message };
  }
}

export function compareGraphs(orig: GraphNode[], rebuilt: GraphNode[], map: Map<string, string>): { diffs: Diff[]; shaderSame: boolean | null; uniformsSame: boolean | null; compileOriginal: boolean; compileRebuilt: boolean; made: Set<string> } {
  const diffs: Diff[] = [];
  const fo = flattenGraph(orig), fr = flattenGraph(rebuilt);
  const rById = new Map(allNodes(rebuilt).map(nd => [nd.id, nd]));
  const frIds = new Set(fr.nodes.map(nd => nd.id));
  const made = new Set<string>();
  for (const o of fo.nodes) {
    const m = map.get(o.id);
    const r = m ? rById.get(m) : undefined;
    if (!r || !frIds.has(r.id)) { diffs.push({ kind: 'missing-node', detail: describe(o) }); continue; }
    if (r.type !== o.type) { diffs.push({ kind: 'type', detail: `${describe(o)} came out as ${r.type}` }); continue; }
    made.add(o.id);
    const def = getNodeDefinitionFor(o);
    const keys = new Set([...Object.keys(o.params), ...Object.keys(r.params)].filter(k => !PARAM_SKIP.has(k)));
    for (const k of keys) {
      const a = o.params[k] ?? def?.defaultParams?.[k], b = r.params[k] ?? def?.defaultParams?.[k];
      if (a === undefined && b === undefined) continue;
      if (!sameValue(a, b)) diffs.push({ kind: 'param', detail: `${describe(o)} · ${k}: ${short(a)} → ${short(b)}` });
    }
    if ((o.params.label ?? null) !== (r.params.label ?? null) && !isPlainGroup(o)) diffs.push({ kind: 'label', detail: `${describe(o)} named ${short(r.params.label)}` });
    const so = subgraphOf(o), sr = subgraphOf(r);
    if (so) {
      const a = levelDigest(so.nodes), b = sr ? levelDigest(sr.nodes) : [];
      const same = digestOverlap(a, b);
      if (same < a.length || a.length !== b.length) diffs.push({ kind: 'container', detail: `${describe(o)}: ${a.length - same} of ${a.length} inner nodes differ (${b.length} made)` });
    }
  }
  const back = new Map([...map].map(([a, b]) => [b, a]));
  for (const r of fr.nodes) if (!back.has(r.id)) diffs.push({ kind: 'extra-node', detail: describe(r) });
  const wkey = (w: { from: string; out: string; to: string; in: string }) => `${w.from}.${w.out}→${w.to}.${w.in}`;
  const want = new Set(fo.wires.map(w => wkey({ ...w, from: map.get(w.from) ?? `?${w.from}`, to: map.get(w.to) ?? `?${w.to}` })));
  const got = new Set(fr.wires.map(wkey));
  for (const w of fo.wires) {
    const k = wkey({ ...w, from: map.get(w.from) ?? `?${w.from}`, to: map.get(w.to) ?? `?${w.to}` });
    if (!got.has(k)) diffs.push({ kind: 'missing-wire', detail: `${describe(fo.nodes.find(x => x.id === w.from))}.${w.out} → ${describe(fo.nodes.find(x => x.id === w.to))}.${w.in}` });
  }
  for (const w of fr.wires) if (!want.has(wkey(w))) diffs.push({ kind: 'extra-wire', detail: `${describe(rById.get(w.from))}.${w.out} → ${describe(rById.get(w.to))}.${w.in}` });
  // Plain groups: the same members, the same number of ports.
  const rGroups = new Map(fr.groups.map(g => [g.id, g]));
  for (const g of fo.groups) {
    const rg = rGroups.get(map.get(g.id) ?? '');
    if (!rg) { diffs.push({ kind: 'group', detail: `group “${g.label ?? 'Group'}” not made` }); continue; }
    const want2 = new Set(g.members.map(m => map.get(m) ?? `?${m}`)), got2 = new Set(rg.members);
    const missing = [...want2].filter(x => !got2.has(x)).length, extra = [...got2].filter(x => !want2.has(x)).length;
    if (missing || extra) diffs.push({ kind: 'group', detail: `group “${g.label ?? 'Group'}”: ${missing} members missing, ${extra} extra` });
    const og = allNodes(orig).find(x => x.id === g.id)!, rgN = rById.get(rg.id)!;
    const ports = (nd: GraphNode) => { const sg = subgraphOf(nd)!; return `${(sg.inputPorts ?? []).map(p => p.type).sort().join(',')} | ${(sg.outputPorts ?? []).map(p => p.type).sort().join(',')}`; };
    if (ports(og) !== ports(rgN)) diffs.push({ kind: 'group', detail: `group “${g.label ?? 'Group'}” ports ${ports(og)} → ${ports(rgN)}` });
    for (const [k, v] of Object.entries(g.params)) if (!PARAM_SKIP.has(k) && !sameValue(v, rg.params[k]) && !(k === 'iterations' && v === 1 && rg.params[k] === undefined)) diffs.push({ kind: 'group', detail: `group “${g.label ?? 'Group'}” · ${k}: ${short(v)} → ${short(rg.params[k])}` });
  }
  // The shader: the rebuilt graph with the original's ids and order.
  const ren = new Map([...map].map(([o, r]) => [r, o]));
  // A container's insides: paired by what they are (the bar made them, with its own ids).
  for (const o of fo.nodes) {
    const so = subgraphOf(o), r = rById.get(map.get(o.id) ?? '');
    const sr = r ? subgraphOf(r) : null;
    if (so && sr) for (const [a, b] of pairInside(so.nodes, sr.nodes)) if (!ren.has(b)) ren.set(b, a);
  }
  const order = new Map(allNodes(orig).map((nd, i) => [nd.id, i]));
  const co = compile(withDefaults(orig)), cr = compile(withDefaults(renameGraph(rebuilt, ren, order)));
  let shaderSame: boolean | null = null, uniformsSame: boolean | null = null;
  if (co.ok && cr.ok) {
    shaderSame = co.text === cr.text;
    const ku = new Set([...Object.keys(co.uniforms), ...Object.keys(cr.uniforms)]);
    uniformsSame = [...ku].every(k => sameValue(co.uniforms[k], cr.uniforms[k]));
    if (!shaderSame) diffs.push({ kind: 'shader', detail: firstDiff(co.text, cr.text) });
    if (!uniformsSame) diffs.push({ kind: 'uniform', detail: [...ku].filter(k => !sameValue(co.uniforms[k], cr.uniforms[k])).slice(0, 4).join(', ') });
  } else if (co.ok && !cr.ok) diffs.push({ kind: 'compile', detail: `the rebuilt graph doesn't compile: ${cr.error ?? '?'}` });
  return { diffs, shaderSame, uniformsSame, compileOriginal: co.ok, compileRebuilt: cr.ok, made };
}

const short = (v: unknown) => { const s = JSON.stringify(v) ?? 'undefined'; return s.length > 60 ? `${s.slice(0, 57)}…` : s; };

function firstDiff(a: string, b: string): string {
  const la = a.split('\n'), lb = b.split('\n');
  for (let i = 0; i < Math.max(la.length, lb.length); i++) if (la[i] !== lb[i]) return `line ${i + 1}: ${(la[i] ?? '∅').trim().slice(0, 80)} ≠ ${(lb[i] ?? '∅').trim().slice(0, 80)}`;
  return 'same lines';
}

// ── One example ─────────────────────────────────────────────────────────────

export function pressureTest(key: string, label: string, category: string, graph: { nodes: GraphNode[]; play?: unknown; datasets?: unknown; images?: Record<string, string> }): ExampleResult {
  const t0 = Date.now();
  const orig = loadNodes(graph.nodes);
  let printed: PrintResult;
  const base: Omit<ExampleResult, 'klass' | 'nodesMade' | 'pctNodes' | 'wiresMade' | 'diffs' | 'shaderSame' | 'uniformsSame' | 'compileOriginal' | 'compileRebuilt' | 'runFailures' | 'ms'> = {
    key, label, category, nodes: 0, wires: 0, params: 0, paramsSet: 0, lines: 0, canonicalLines: 0, sugarLines: 0, recipeLines: 0, gapLines: 0, gaps: [], script: '',
  };
  try {
    printed = graphToScript(orig, { play: graph.play, datasets: graph.datasets, images: graph.images });
  } catch (e) {
    return { ...base, klass: 'None', nodesMade: 0, pctNodes: 0, wiresMade: 0, diffs: [], shaderSame: null, uniformsSame: null, compileOriginal: false, compileRebuilt: false, runFailures: [], printerThrew: String((e as Error).stack ?? e), ms: Date.now() - t0 };
  }
  // Run the script on an empty graph (an Output), on the store.
  useNodeGraphStore.setState({ nodes: [emptyOutput()], selectedNodeId: null, selectedNodeIds: [], activeGroupPath: [], activeGroupId: null } as never);
  const map = new Map<string, string>([...Object.entries(printed.map)].filter(([, v]) => v === 'out'));
  const runFailures: ExampleResult['runFailures'] = [];
  for (const line of printed.lines) {
    if (line.form === 'comment') continue;
    const was = new Set(allNodes(useNodeGraphStore.getState().nodes).map(nd => nd.id));
    const r = storeRunLine(line.text);
    if (!r.ok) { runFailures.push({ line: line.text, error: r.error ?? '?' }); continue; }
    if (line.section === 'recipe') {
      // A builder's nodes: paired with the original's by what they are (lang/graphFlat.ts pairInside).
      const added = useNodeGraphStore.getState().nodes.filter(nd => !was.has(nd.id));
      const mapped = new Set(map.keys());
      for (const [o, r] of pairInside(orig.filter(x => !mapped.has(x.id) && x.type !== 'output'), added)) if (line.makes?.some(m => m.orig === o)) map.set(o, r);
    } else if (line.makes) {
      const now = allNodes(useNodeGraphStore.getState().nodes).filter(nd => !was.has(nd.id));
      const used = new Set<string>();
      for (const m of line.makes) {
        const hit = now.find(nd => nd.type === m.type && !used.has(nd.id) && (line.section !== 'recipe' || useNodeGraphStore.getState().nodes.some(t => t.id === nd.id)));
        if (hit) { used.add(hit.id); map.set(m.orig, hit.id); }
      }
      // A group adds its Loop Index: it stands for the original group's.
      if (line.section === 'group') {
        const og = allNodes(orig).find(x => x.id === line.makes![0].orig);
        const li = og && subgraphOf(og)?.nodes.find(x => x.type === 'loopIndex');
        const rli = now.find(nd => nd.type === 'loopIndex');
        if (li && rli) map.set(li.id, rli.id);
      }
    }
  }
  const rebuilt = useNodeGraphStore.getState().nodes;
  const cmp = compareGraphs(orig, rebuilt, map);
  const st = printed.stats;
  // Made: the flat nodes that came out right, plus containers' insides that match.
  const containerInside = (nodes: GraphNode[]) => {
    let total = 0, same = 0;
    for (const o of flattenGraph(nodes).nodes) {
      const so = subgraphOf(o);
      if (!so) continue;
      const count = allNodes(so.nodes).length;
      total += count;
      const r = allNodes(rebuilt).find(x => x.id === map.get(o.id));
      const sr = r ? subgraphOf(r) : null;
      if (sr && cmp.made.has(o.id)) same += digestOverlap(levelDigest(so.nodes), levelDigest(sr.nodes)) * (count / Math.max(1, so.nodes.length));
    }
    return { total, same: Math.round(same) };
  };
  const ci = containerInside(orig);
  const flatCount = flattenGraph(orig).nodes.length;
  const nodesTotal = flatCount + ci.total;
  const nodesMade = cmp.made.size + ci.same;
  const missing = cmp.diffs.filter(d => d.kind === 'missing-node' || d.kind === 'type' || d.kind === 'missing-wire').length + (ci.same < ci.total ? 1 : 0);
  const nonOutputMade = [...cmp.made].filter(id => flattenGraph(orig).nodes.find(x => x.id === id)?.type !== 'output').length;
  const klass: Klass = cmp.shaderSame && cmp.uniformsSame && missing === 0 ? 'Full'
    : missing === 0 && nonOutputMade > 0 ? 'Near'
      : nonOutputMade > 0 ? 'Partial' : 'None';
  const wiresMade = flattenGraph(orig).wires.length - cmp.diffs.filter(d => d.kind === 'missing-wire').length;
  return {
    key, label, category, klass,
    nodes: nodesTotal, nodesMade, pctNodes: nodesTotal ? Math.round(100 * nodesMade / nodesTotal) : 100,
    wires: st.wires, wiresMade,
    params: st.params, paramsSet: st.paramsSet,
    lines: printed.lines.length,
    canonicalLines: printed.lines.filter(l => l.form === 'canonical').length,
    sugarLines: printed.lines.filter(l => l.form === 'sugar').length,
    recipeLines: printed.lines.filter(l => l.form === 'recipe').length,
    gapLines: printed.lines.filter(l => l.form === 'comment').length,
    runFailures, shaderSame: cmp.shaderSame, uniformsSame: cmp.uniformsSame, compileOriginal: cmp.compileOriginal, compileRebuilt: cmp.compileRebuilt,
    diffs: cmp.diffs, gaps: printed.gaps, script: printed.script, ms: Date.now() - t0,
  };
}

export const isAllNodes = allNodes;
export { isPlainGroup };
