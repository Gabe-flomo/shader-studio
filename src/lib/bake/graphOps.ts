/**
 * Bake's graph surgery (docs/bake.md), as pure functions on node lists:
 *
 * - `tuckSet`: the nodes a bake freezes: the chosen node and every node above
 *   it that feeds nothing else (a Time or UV node something else still reads
 *   stays live).
 * - `applyBake`: puts a Baked node where the chosen node was, wires it to
 *   everything the chosen output fed, and keeps the tucked nodes (with their
 *   places in the list and every downstream wire) inside the Baked node's
 *   `_bake` param. Nothing is deleted, and the tucked nodes are no longer in
 *   the graph, so they aren't compiled.
 * - `unbake`: the exact reverse: the same nodes, in the same order, with the
 *   same wires.
 * - `bakeRenderGraph`: the graph a bake renders: the chosen node and
 *   everything above it, ending in an output that draws the chosen output
 *   (colour, colour with alpha, or a value as grey).
 */
import type { GraphNode, InputSocket } from '../../types/nodeGraph';
import type { BakeSettings } from './plan';

/** The kinds of output a bake can freeze: a colour, a colour with alpha, a value. */
export type BakeOutType = 'vec3' | 'vec4' | 'float';

/** One wire into the chosen node from below it, as it was before the bake. */
export interface BakeWire {
  nodeId: string;
  inputKey: string;
  /** The chosen node's output the wire came from. */
  outputKey: string;
  /** No output of the Baked node stands in for it, so it was left unwired while baked. */
  dropped?: boolean;
}

/** What a Baked node keeps of the live nodes it replaced (params._bake). */
export interface BakeStash {
  version: 1;
  targetId: string;
  outputKey: string;
  outType: BakeOutType;
  /** The tucked nodes as they were, the chosen one included. */
  nodes: GraphNode[];
  /** Each tucked node's index in the node list before the bake (same order as `nodes`). */
  indices: number[];
  /** Index of the chosen node (where the Baked node sits). */
  targetIndex: number;
  wires: BakeWire[];
  settings: BakeSettings;
}

/** The Baked node's outputs, by the kind of output they stand in for. */
export const BAKED_OUTPUT_FOR: Record<BakeOutType, string> = { vec3: 'color', vec4: 'rgba', float: 'value' };

export const BAKED_TYPE = 'baked';

/** Node types a bake never replaces (outputs draw the picture; a Baked node is already baked). */
const NOT_BAKEABLE = new Set(['output', 'vec4Output', 'passOutput', 'scope', BAKED_TYPE]);

/** The output a bake of `node` freezes: the one asked for, else the first colour, colour with alpha, or value. */
export function bakeableOutput(node: GraphNode, prefer?: string): { key: string; type: BakeOutType } | null {
  if (NOT_BAKEABLE.has(node.type)) return null;
  const ok = (t: string): t is BakeOutType => t === 'vec3' || t === 'vec4' || t === 'float';
  if (prefer && node.outputs[prefer] && ok(node.outputs[prefer].type)) return { key: prefer, type: node.outputs[prefer].type as BakeOutType };
  const entries = Object.entries(node.outputs);
  for (const want of ['vec3', 'vec4', 'float'] as const) {
    const e = entries.find(([, s]) => s.type === want);
    if (e) return { key: e[0], type: want };
  }
  return null;
}

/** Does this node have an alpha to keep: a colour with alpha, or a colour beside a float output called Alpha. */
export function hasAlpha(node: GraphNode, outType: BakeOutType): boolean {
  if (outType === 'vec4') return true;
  return outType === 'vec3' && node.outputs.alpha?.type === 'float';
}

/** "Bake the picture": the node wired into the graph's output, and which of its outputs. */
export function pictureTarget(nodes: GraphNode[]): { nodeId: string; outputKey: string } | null {
  const out = nodes.find(n => n.type === 'output' || n.type === 'vec4Output');
  const c = out?.inputs.color?.connection;
  return c ? { nodeId: c.nodeId, outputKey: c.outputKey } : null;
}

function consumersOf(nodes: GraphNode[]): Map<string, Set<string>> {
  const m = new Map<string, Set<string>>();
  for (const n of nodes) for (const s of Object.values(n.inputs)) {
    const from = s.connection?.nodeId;
    if (!from) continue;
    let set = m.get(from);
    if (!set) m.set(from, set = new Set());
    set.add(n.id);
  }
  return m;
}

/** The chosen node and every node above it whose outputs go nowhere but into that set. */
export function tuckSet(nodes: GraphNode[], targetId: string): Set<string> {
  const byId = new Map(nodes.map(n => [n.id, n]));
  const set = new Set<string>();
  const queue = [targetId];
  while (queue.length) {
    const id = queue.pop()!;
    if (set.has(id) || !byId.has(id)) continue;
    set.add(id);
    for (const s of Object.values(byId.get(id)!.inputs)) if (s.connection) queue.push(s.connection.nodeId);
  }
  const consumers = consumersOf(nodes);
  // A node something outside reads stays live; dropping it can strand the nodes above it, so repeat until settled.
  for (let changed = true; changed;) {
    changed = false;
    for (const id of [...set]) {
      if (id === targetId) continue;
      const users = consumers.get(id);
      if (users && [...users].some(u => !set.has(u))) { set.delete(id); changed = true; }
    }
  }
  return set;
}

const withConnection = (s: InputSocket, connection: InputSocket['connection']): InputSocket => {
  if (connection) return { ...s, connection };
  const rest = { ...s };
  delete rest.connection;
  return rest;
};

/**
 * Replace `targetId` (and the nodes only it needs) with `baked`. `baked` comes
 * without a stash; the returned node list holds it with `params._bake` filled.
 */
export function applyBake(nodes: GraphNode[], targetId: string, outputKey: string, baked: GraphNode, settings: BakeSettings): { nodes: GraphNode[]; baked: GraphNode; stash: BakeStash } {
  const target = nodes.find(n => n.id === targetId);
  if (!target) throw new Error('The node to bake is gone');
  const out = bakeableOutput(target, outputKey);
  if (!out || out.key !== outputKey) throw new Error('That output can’t be baked (colours, colours with alpha and values can)');
  const tuck = tuckSet(nodes, targetId);
  const mapped = BAKED_OUTPUT_FOR[out.type];
  const keepsAlpha = settings.alpha && hasAlpha(target, out.type);

  const wires: BakeWire[] = [];
  const stashNodes: GraphNode[] = [], indices: number[] = [];
  let targetIndex = -1;
  nodes.forEach((n, i) => {
    if (!tuck.has(n.id)) return;
    stashNodes.push(n); indices.push(i);
    if (n.id === targetId) targetIndex = i;
  });
  const stash: BakeStash = { version: 1, targetId, outputKey, outType: out.type, nodes: stashNodes, indices, targetIndex, wires, settings };
  const placed: GraphNode = { ...baked, position: { ...target.position }, params: { ...baked.params, _bake: stash } };

  const result: GraphNode[] = [];
  for (const n of nodes) {
    if (n.id === targetId) { result.push(placed); continue; }
    if (tuck.has(n.id)) continue;
    let inputs: Record<string, InputSocket> | null = null;
    for (const [k, s] of Object.entries(n.inputs)) {
      if (s.connection?.nodeId !== targetId) continue;
      const from = s.connection.outputKey;
      // The chosen output goes to its stand-in; the chosen node's alpha to the Baked alpha when the bake keeps it.
      const to = from === outputKey ? mapped : from === 'alpha' && keepsAlpha && out.type === 'vec3' ? 'alpha' : null;
      wires.push({ nodeId: n.id, inputKey: k, outputKey: from, ...(to ? {} : { dropped: true }) });
      inputs ??= { ...n.inputs };
      inputs[k] = withConnection(s, to ? { nodeId: placed.id, outputKey: to } : undefined);
    }
    result.push(inputs ? { ...n, inputs } : n);
  }
  return { nodes: result, baked: placed, stash };
}

/** The stash of a Baked node, if it has one. */
export function stashOf(node: GraphNode | undefined): BakeStash | null {
  const s = node?.params._bake as BakeStash | undefined;
  return s && s.version === 1 && Array.isArray(s.nodes) ? s : null;
}

/**
 * The tucked nodes with fresh ids for any that something added since took
 * (a reloaded graph can hand a tucked node's id to a new node). Wires among
 * them follow the new ids; `targetId` is the chosen node's id now.
 */
export function stashNodesFree(stash: BakeStash, taken: Set<string>, newId: () => string): { nodes: GraphNode[]; targetId: string } {
  const remap = new Map<string, string>();
  for (const n of stash.nodes) if (taken.has(n.id)) {
    let id = newId();
    while (taken.has(id) || stash.nodes.some(m => m.id === id)) id = newId();
    remap.set(n.id, id);
  }
  if (!remap.size) return { nodes: stash.nodes, targetId: stash.targetId };
  const nodes = stash.nodes.map(n => {
    const inputs: Record<string, InputSocket> = {};
    for (const [k, s] of Object.entries(n.inputs)) {
      const to = s.connection && remap.get(s.connection.nodeId);
      inputs[k] = to ? { ...s, connection: { ...s.connection!, nodeId: to } } : s;
    }
    return { ...n, id: remap.get(n.id) ?? n.id, inputs };
  });
  return { nodes, targetId: remap.get(stash.targetId) ?? stash.targetId };
}

/** Undo a bake: the tucked nodes back in their places, every wire back on the chosen node. */
export function unbake(nodes: GraphNode[], bakedId: string, newId: () => string): GraphNode[] {
  const baked = nodes.find(n => n.id === bakedId);
  const stash = stashOf(baked);
  if (!baked || !stash) throw new Error('This node has nothing baked to restore');
  const rest = nodes.filter(n => n.id !== bakedId);
  const { nodes: back, targetId } = stashNodesFree(stash, new Set(rest.map(n => n.id)), newId);
  const reverse = new Map<string, string>([[BAKED_OUTPUT_FOR[stash.outType], stash.outputKey], ['alpha', stash.outType === 'vec3' ? 'alpha' : '']]);
  const wireFor = new Map(stash.wires.map(w => [`${w.nodeId}::${w.inputKey}`, w]));

  const rewired = rest.map(n => {
    let inputs: Record<string, InputSocket> | null = null;
    for (const [k, s] of Object.entries(n.inputs)) {
      const w = wireFor.get(`${n.id}::${k}`);
      let next: InputSocket['connection'] | null = null; // null: leave as is
      if (s.connection?.nodeId === bakedId) {
        // Wired from the Baked node: back to the output it stood in for (a wire made since maps by kind).
        const key = w && !w.dropped ? w.outputKey : reverse.get(s.connection.outputKey);
        next = key ? { nodeId: targetId, outputKey: key } : undefined;
      } else if (w?.dropped && !s.connection) {
        next = { nodeId: targetId, outputKey: w.outputKey };
      }
      if (next === null) continue;
      inputs ??= { ...n.inputs };
      inputs[k] = withConnection(s, next);
    }
    return inputs ? { ...n, inputs } : n;
  });

  // Back into their old places: ascending indices into the list the bake left reproduce the original order.
  const order = back.map((n, i) => ({ n, at: stash.indices[i] ?? Number.MAX_SAFE_INTEGER })).sort((a, b) => a.at - b.at);
  const out = [...rewired];
  for (const { n, at } of order) out.splice(Math.min(at, out.length), 0, n);
  return out;
}

const synth = (id: string, type: string, inputs: GraphNode['inputs'], outputs: GraphNode['outputs'] = {}): GraphNode => ({ id, type, position: { x: 0, y: 0 }, params: {}, inputs, outputs });

/**
 * The graph a bake renders: `targetId` and everything above it (from `nodes`,
 * which for a re-bake holds the tucked nodes too), ending in an output that
 * draws `outputKey`: a colour as is, a colour with alpha (or a colour and its
 * Alpha output) as RGBA, a value as grey.
 */
export function bakeRenderGraph(nodes: GraphNode[], targetId: string, outputKey: string, alpha: boolean): GraphNode[] {
  const byId = new Map(nodes.map(n => [n.id, n]));
  const target = byId.get(targetId);
  if (!target) throw new Error('The node to bake is gone');
  const out = bakeableOutput(target, outputKey);
  if (!out) throw new Error('That output can’t be baked');
  const keep = new Set<string>();
  const queue = [targetId];
  while (queue.length) {
    const id = queue.pop()!;
    if (keep.has(id)) continue;
    const n = byId.get(id);
    if (!n) continue;
    keep.add(id);
    for (const s of Object.values(n.inputs)) if (s.connection) queue.push(s.connection.nodeId);
  }
  const sub = nodes.filter(n => keep.has(n.id));
  const from = (key: string) => ({ nodeId: targetId, outputKey: key });
  if (out.type === 'vec4') return [...sub, synth('__bake_out__', 'vec4Output', { color: { type: 'vec4', label: 'Color', connection: from(out.key) } })];
  if (out.type === 'float') return [...sub,
    synth('__bake_grey__', 'floatToVec3', { input: { type: 'float', label: 'Float', connection: from(out.key) } }, { rgb: { type: 'vec3', label: 'Color' } }),
    synth('__bake_out__', 'output', { color: { type: 'vec3', label: 'Color', connection: { nodeId: '__bake_grey__', outputKey: 'rgb' } } }),
  ];
  if (alpha && hasAlpha(target, 'vec3')) return [...sub,
    synth('__bake_split__', 'splitVec3', { v: { type: 'vec3', label: 'Vec3', connection: from(out.key) } }, { x: { type: 'float', label: 'X' }, y: { type: 'float', label: 'Y' }, z: { type: 'float', label: 'Z' } }),
    synth('__bake_rgba__', 'makeVec4', {
      x: { type: 'float', label: 'X', connection: { nodeId: '__bake_split__', outputKey: 'x' } },
      y: { type: 'float', label: 'Y', connection: { nodeId: '__bake_split__', outputKey: 'y' } },
      z: { type: 'float', label: 'Z', connection: { nodeId: '__bake_split__', outputKey: 'z' } },
      w: { type: 'float', label: 'W', connection: from('alpha') },
    }, { xyzw: { type: 'vec4', label: 'XYZW' } }),
    synth('__bake_out__', 'vec4Output', { color: { type: 'vec4', label: 'Color', connection: { nodeId: '__bake_rgba__', outputKey: 'xyzw' } } }),
  ];
  return [...sub, synth('__bake_out__', 'output', { color: { type: 'vec3', label: 'Color', connection: from(out.key) } })];
}

/** Every node a re-bake can render from: the graph as it is (the Baked node aside) and the tucked nodes. */
export function rebakeNodes(nodes: GraphNode[], bakedId: string, newId: () => string): { nodes: GraphNode[]; targetId: string; stash: BakeStash } {
  const stash = stashOf(nodes.find(n => n.id === bakedId));
  if (!stash) throw new Error('This node has nothing baked to render again');
  const rest = nodes.filter(n => n.id !== bakedId);
  const { nodes: back, targetId } = stashNodesFree(stash, new Set(rest.map(n => n.id)), newId);
  return { nodes: [...rest, ...back], targetId, stash };
}

/**
 * What stops moving once baked: the live inputs the frozen nodes read. From
 * the bake graph's compile (its uniforms and shader) and the Play setup
 * (controls and mappings that name a tucked node).
 */
export function frozenInputs(compiled: { fragmentShader: string; audioUniforms: Record<string, string>; liveUniforms: Record<string, string>; videoUniforms: Record<string, string>; passes?: { fragmentShader: string }[] }, tuckedIds: string[], tuckedTypes: string[], playJson: string): string[] {
  const out: string[] = [];
  // Read, not just declared (every program declares u_mouse).
  const shaders = [compiled.fragmentShader, ...(compiled.passes ?? []).map(p => p.fragmentShader)].join('\n').replace(/^[ \t]*uniform[^\n;]*;/gm, '');
  if (/\bu_mouse\b/.test(shaders)) out.push('the mouse');
  if (Object.keys(compiled.audioUniforms).length || /\bu_(?:audio|mic|spectrum)/.test(shaders)) out.push('sound');
  const live = Object.keys(compiled.liveUniforms);
  if (live.some(n => n.startsWith('u_midi_')) || tuckedTypes.includes('midiInput')) out.push('MIDI');
  if (live.some(n => !n.startsWith('u_midi_'))) out.push('live inputs');
  if (tuckedTypes.some(t => t === 'videoInput' || t === 'camera' || t === 'cameraInput')) out.push('live video');
  // A control or mapping names its node by id, alone or as "id::param".
  if (tuckedIds.some(id => playJson.includes(`"${id}"`) || playJson.includes(`"${id}::`))) out.push('Play controls');
  return out;
}

/** The videos every Baked node in these nodes plays: inside groups, and those Baked nodes keep tucked away (a bake of a bake). */
export function bakedVideoIds(nodes: readonly GraphNode[], out: string[] = []): string[] {
  for (const n of nodes) {
    if (n.type === BAKED_TYPE && typeof n.params.videoId === 'string' && n.params.videoId) out.push(n.params.videoId);
    // A Time Cube's video (docs/time-cube.md) is a use too, so Clean up keeps it.
    if (n.type === 'timeCube' && n.params.source === 'library' && typeof n.params.videoId === 'string' && n.params.videoId) out.push(n.params.videoId);
    const sg = n.params?.subgraph as { nodes?: GraphNode[] } | undefined;
    if (Array.isArray(sg?.nodes)) bakedVideoIds(sg.nodes, out);
    const st = stashOf(n);
    if (st) bakedVideoIds(st.nodes, out);
  }
  return out;
}
