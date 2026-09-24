/**
 * Node type aliases (audit D4–D6).
 *
 * Several node types were strict duplicates of one another under different
 * names (three unions, three intersects, four LFOs…). The duplicates are gone
 * from the registry; this table maps each old type key to the canonical node
 * so every saved graph, example and preset keeps loading. Resolution happens
 * once, when a graph is loaded (`resolveNodeAliases`), and rewrites:
 *
 *  - the node's `type`,
 *  - renamed input / output socket keys (`inputs` / `outputs` maps), including
 *    the `connection.outputKey` of every downstream wire and group ports,
 *  - params, via `params(old)` — the returned object *replaces* the params;
 *    a key set to `undefined` is dropped,
 *  - live socket types (`socketTypes`), for the vectorised arithmetic nodes.
 *
 * `getNodeDefinition()` also resolves an alias so a stray un-migrated node
 * (clipboard paste from an old session) still finds a definition.
 */
import type { GraphNode, DataType, NodeDefinition, SubgraphData } from '../../types/nodeGraph';

export interface NodeAlias {
  /** Canonical type key. */
  to: string;
  /** Old input socket key → canonical key. Unlisted keys are kept. */
  inputs?: Record<string, string>;
  /** Old output socket key → canonical key. Downstream wires are rewritten. */
  outputs?: Record<string, string>;
  /** Canonical params from the old params (`undefined` drops a key). */
  params?: (old: Record<string, unknown>) => Record<string, unknown>;
  /** Live socket types the canonical node should carry. */
  socketTypes?: { inputs?: Record<string, DataType>; outputs?: Record<string, DataType> };
}

const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);

export const NODE_ALIASES: Record<string, NodeAlias> = {
  // ── D4: SDF combine ops. Union / Intersect / Subtract take a blend radius k
  //    (0 = hard op); Offset / Onion / Sharpen are the shape modifiers. ──
  min:                { to: 'sdfUnion',     outputs: { result: 'dist' } },
  smoothMin:          { to: 'sdfUnion',     inputs: { smoothness: 'k' }, outputs: { result: 'dist' },
                        params: o => ({ ...o, k: num(o.smoothness, 0.5), smoothness: undefined }) },
  sdf2dSmoothUnion:   { to: 'sdfUnion',     inputs: { sdfA: 'a', sdfB: 'b' }, outputs: { result: 'dist' },
                        params: o => ({ ...o, k: num(o.k, 0.12) }) },
  sdfSmoothUnion:     { to: 'sdfUnion',     params: o => ({ ...o, k: num(o.k, 0.15) }) },
  sdfMax:             { to: 'sdfIntersect', outputs: { result: 'dist' } },
  smoothMax:          { to: 'sdfIntersect', inputs: { smoothness: 'k' }, outputs: { result: 'dist' },
                        params: o => ({ ...o, k: num(o.smoothness, 0.3), smoothness: undefined }) },
  sdfSmoothIntersect: { to: 'sdfIntersect', params: o => ({ ...o, k: num(o.k, 0.1) }) },
  smoothSubtract:     { to: 'sdfSubtract',  inputs: { smoothness: 'k' }, outputs: { result: 'dist' },
                        params: o => ({ ...o, k: num(o.smoothness, 0.3), smoothness: undefined }) },
  sdfSmoothSubtract:  { to: 'sdfSubtract',  inputs: { base: 'a', cut: 'b' }, params: o => ({ ...o, k: num(o.k, 0.1) }) },
  // Round = offset by -r. (A *wired* radius keeps its wire but not the sign flip.)
  sdfRound:           { to: 'sdfOffset',    inputs: { dist: 'sdf', r: 'amount' }, outputs: { dist: 'result' },
                        params: o => ({ ...o, amount: -num(o.r, 0.05), r: undefined }) },
  sdf2dOnion:         { to: 'sdfOnion',     inputs: { sdf: 'dist' }, outputs: { result: 'dist' },
                        params: o => ({ ...o, r: num(o.thickness, 0.02), thickness: undefined }) },

  // ── D5: vector arithmetic is the scalar node with its type pill set ──
  addVec2:      { to: 'add',      params: o => ({ ...o, outputType: 'vec2', b: 0.0 }),
                  socketTypes: { inputs: { a: 'vec2', b: 'vec2' }, outputs: { result: 'vec2' } } },
  addVec3:      { to: 'add',      params: o => ({ ...o, outputType: 'vec3', b: 0.0 }),
                  socketTypes: { inputs: { a: 'vec3', b: 'vec3' }, outputs: { result: 'vec3' } } },
  multiplyVec2: { to: 'multiply', inputs: { v: 'a', scale: 'b' },
                  params: o => ({ ...o, outputType: 'vec2', b: num(o.scale, 1.0), scale: undefined }),
                  socketTypes: { inputs: { a: 'vec2', b: 'vec2' }, outputs: { result: 'vec2' } } },
  multiplyVec3: { to: 'multiply', inputs: { color: 'a', scale: 'b' },
                  params: o => ({ ...o, outputType: 'vec3', b: num(o.scale, 1.0), scale: undefined }),
                  socketTypes: { inputs: { a: 'vec3', b: 'vec3' }, outputs: { result: 'vec3' } } },
  mixVec3:      { to: 'mix',      inputs: { fac: 't' },
                  params: o => ({ ...o, outputType: 'vec3', t: num(o.fac, 0.5), fac: undefined }),
                  socketTypes: { inputs: { a: 'vec3', b: 'vec3' }, outputs: { result: 'vec3' } } },
  blend:        { to: 'mix',      inputs: { factor: 't' },
                  params: o => ({ ...o, outputType: 'vec3', t: num(o.factor, 0.5), factor: undefined }),
                  socketTypes: { inputs: { a: 'vec3', b: 'vec3' }, outputs: { result: 'vec3' } } },

  // ── SDF Outline became SDF Fill: same sockets and params, plus a background and a stroke alignment ──
  sdfOutline: { to: 'sdfFill' },

  // ── D6: strict subsets ──
  extractX:      { to: 'splitVec2' },
  extractY:      { to: 'splitVec2' },
  opRepeat:      { to: 'infiniteRepeatSpace', inputs: { p: 'input', s: 'cellX' }, outputs: { result: 'output' },
                   params: o => ({ ...o, cellX: num(o.s, 1.0), cellY: num(o.s, 1.0), s: undefined }) },
  opRepeatPolar: { to: 'angularRepeat2D', inputs: { p: 'input', n: 'count' }, outputs: { result: 'output' },
                   params: o => ({ ...o, count: num(o.n, 6.0), n: undefined }) },
  makeLight:     { to: 'light', params: o => ({ ...o, mode: 'glow', brightness: num(o.brightness, 10.0) }) },
  lumaGrain:     { to: 'grain', params: o => ({ ...o, mode: 'luma', amount: num(o.amount, 0.06), seed: num(o.seed, 0.0), scale: 1.0 }) },
  temporalGrain: { to: 'grain', params: o => ({ ...o, mode: 'temporal', amount: num(o.amount, 0.05), scale: 1.0 }) },
  screenBlend:   { to: 'blendModes', inputs: { a: 'base', b: 'blend' }, params: o => ({ ...o, mode: 'screen', opacity: 1.0 }) },
  blendMode:     { to: 'blendModes', inputs: { colorA: 'base', colorB: 'blend', mask: 'opacity' },
                   params: o => ({ ...o, mode: typeof o.mode === 'string' ? o.mode : 'additive', opacity: 1.0, strength: num(o.strength, 1.0) }) },
  // Saturation(1 - a) == Desaturate(a). (A *wired* amount keeps its wire but not the inversion.)
  desaturate:    { to: 'colorSaturation', params: o => ({ ...o, amount: 1.0 - num(o.amount, 1.0) }) },
  vec3Const:     { to: 'makeVec3', outputs: { val: 'rgb' },
                   params: o => ({ ...o, r: num(o.x, 0), g: num(o.y, 0), b: num(o.z, 0), x: undefined, y: undefined, z: undefined }) },
  sdBox:         { to: 'boxSDF', inputs: { p: 'position', b: 'dimensions' },
                   params: o => ({ ...o, width: num(o.bx, 0.3), height: num(o.by, 0.3), posX: 0.0, posY: 0.0, bx: undefined, by: undefined }) },
  palettePreset: { to: 'palette', params: o => ({ ...o, preset: typeof o.preset === 'string' ? o.preset : '1' }) },
  sineLFO:       { to: 'lfo', params: o => ({ ...o, waveform: 'sine' }) },
  squareLFO:     { to: 'lfo', params: o => ({ ...o, waveform: 'square' }) },
  sawtoothLFO:   { to: 'lfo', params: o => ({ ...o, waveform: 'sawtooth' }) },
  triangleLFO:   { to: 'lfo', params: o => ({ ...o, waveform: 'triangle' }) },
};

/** Canonical params for a node created fresh (no old params) or migrated. */
export function aliasParams(alias: NodeAlias, old: Record<string, unknown>): Record<string, unknown> {
  const raw = alias.params ? alias.params(old) : { ...old };
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) if (v !== undefined) out[k] = v;
  return out;
}

type GetDef = (type: string) => NodeDefinition | undefined;

function renameKeys<T>(rec: Record<string, T> | undefined, map?: Record<string, string>): Record<string, T> {
  const src = rec ?? {};
  if (!map) return src;
  const out: Record<string, T> = {};
  for (const [k, v] of Object.entries(src)) {
    const nk = map[k] ?? k;
    if (!(nk in out)) out[nk] = v;
  }
  return out;
}

interface Resolved {
  nodes: GraphNode[];
  changed: boolean;
  /** nodeId → old input key → new key, for nodes that were aliased. */
  inRen: Map<string, Record<string, string>>;
  /** nodeId → old output key → new key. */
  outRen: Map<string, Record<string, string>>;
}

function resolveList(nodes: GraphNode[], getDef: GetDef): Resolved {
  const inRen = new Map<string, Record<string, string>>();
  const outRen = new Map<string, Record<string, string>>();
  let changed = false;

  const resolved = nodes.map(n => {
    let node = n;
    // Group nodes: resolve the subgraph first (any nesting depth).
    const sg = node.params?.subgraph as SubgraphData | undefined;
    if (sg && Array.isArray(sg.nodes)) {
      const nsg = resolveSubgraphAliases(sg, getDef);
      if (nsg !== sg) { node = { ...node, params: { ...node.params, subgraph: nsg } }; changed = true; }
    }
    const alias = NODE_ALIASES[node.type];
    if (!alias) return node;
    changed = true;
    const def = getDef(alias.to);
    const inputs = renameKeys(node.inputs, alias.inputs);
    const outputs = renameKeys(node.outputs, alias.outputs);
    // Refresh labels from the canonical definition and apply live socket types.
    for (const [k, s] of Object.entries(inputs)) {
      const d = def?.inputs[k];
      const t = alias.socketTypes?.inputs?.[k];
      if (d || t) inputs[k] = { ...s, ...(d ? { label: d.label } : {}), ...(t ? { type: t } : {}) };
    }
    for (const [k, s] of Object.entries(outputs)) {
      const d = def?.outputs[k];
      const t = alias.socketTypes?.outputs?.[k];
      if (d || t) outputs[k] = { ...s, ...(d ? { label: d.label } : {}), ...(t ? { type: t } : {}) };
    }
    // A socket the alias types but the saved node never had (older save) is created here so
    // migrateNodeParams' backfill doesn't add it with the definition's (scalar) type.
    for (const [k, t] of Object.entries(alias.socketTypes?.inputs ?? {})) {
      if (!inputs[k]) inputs[k] = { type: t, label: def?.inputs[k]?.label ?? k };
    }
    if (alias.inputs)  inRen.set(node.id, alias.inputs);
    if (alias.outputs) outRen.set(node.id, alias.outputs);
    return { ...node, type: alias.to, inputs, outputs, params: aliasParams(alias, node.params ?? {}) };
  });

  if (!changed) return { nodes, changed, inRen, outRen };
  if (outRen.size === 0) return { nodes: resolved, changed, inRen, outRen };

  // Downstream wires reference the old output key — follow the rename.
  const rewired = resolved.map(n => {
    let inputs = n.inputs;
    let touched = false;
    for (const [k, sock] of Object.entries(n.inputs ?? {})) {
      const c = sock.connection;
      if (!c) continue;
      const nk = outRen.get(c.nodeId)?.[c.outputKey];
      if (!nk || nk === c.outputKey) continue;
      if (!touched) { inputs = { ...inputs }; touched = true; }
      inputs[k] = { ...sock, connection: { ...c, outputKey: nk } };
    }
    return touched ? { ...n, inputs } : n;
  });
  return { nodes: rewired, changed, inRen, outRen };
}

/** Resolve aliases in a subgraph, keeping its group ports pointing at the renamed sockets. */
export function resolveSubgraphAliases(sg: SubgraphData, getDef: GetDef): SubgraphData {
  const r = resolveList(sg.nodes, getDef);
  if (!r.changed) return sg;
  const inputPorts = (sg.inputPorts ?? []).map(p => {
    const nk = r.inRen.get(p.toNodeId)?.[p.toInputKey];
    return nk ? { ...p, toInputKey: nk } : p;
  });
  const outputPorts = (sg.outputPorts ?? []).map(p => {
    const nk = r.outRen.get(p.fromNodeId)?.[p.fromOutputKey];
    return nk ? { ...p, fromOutputKey: nk } : p;
  });
  return { ...sg, nodes: r.nodes, inputPorts, outputPorts };
}

/**
 * Resolve every aliased node type in a loaded graph. Returns the same array
 * when nothing needed resolving.
 */
export function resolveNodeAliases(nodes: GraphNode[], getDef: GetDef): GraphNode[] {
  return resolveList(nodes, getDef).nodes;
}
