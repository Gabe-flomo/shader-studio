/**
 * where.ts — the Agent Builder's Where picker (docs/agent-builder.md "Where"), its pure part.
 *
 * A **region** is something in your graph that can say "here" or "not here" at each point of the
 * picture: a shape's distance (an SDF: inside where it is below 0), any other number chain (a 0–1
 * mask: inside above ½), a texture (inside where it is bright), or in 3D a ray-marched Scene. The
 * picker lists them (`listRegions`) with a thumbnail each, plus shapes made here (madeShapes.ts),
 * and wires the picked one where its use needs it:
 *
 *   use          the rule set                         the wire
 *   onlyWhen     a mask slot + a `mask` condition      the group's mask socket
 *   fieldMask    a layer's mask { region }             the group's mask socket
 *   slope        (a slope layer reads Field ƒ)         the group's Field ƒ socket
 *   born         —                                    the Emit: Shape Field (Where ƒ) or Picture
 *   obstacle     `obstacle` (Move's Obstacle ƒ)       the group's Obstacle ƒ socket; 3D: Scene
 *   food         —                                    the Trail field's Add (painted into a channel)
 *
 * The list has three parts, as the picker shows them: outputs of the graph, outputs **from a
 * group** (a plain group, a Shader Texture, another Agents group's trail), and what you can
 * **create new** (a shape made here, a new Shader Texture, a new group: whereActions.ts).
 *
 * Where a use needs a different reading (Emit's Where ƒ wants "above ½ inside", Obstacle ƒ wants
 * "below 0 inside"), a small **adapter** Expression Block sits between, noted, and is read back.
 */
import type { GraphNode } from '../types/nodeGraph';
import { getNodeDefinition } from '../nodes/definitions';
import { n } from '../store/graphBuilder';
import type { AgentRuleSet, RuleCondition } from '../agentRules/spec';
import { MAX_MASKS } from '../agentRules/spec';
import { type MadeShape, madeShapeName, readMadeShape } from './madeShapes';

export type WhereUse = 'onlyWhen' | 'fieldMask' | 'slope' | 'born' | 'obstacle' | 'food';
export type RegionKind = 'shape' | 'mask' | 'texture' | 'scene';
export interface RegionOut { nodeId: string; outputKey: string }
export interface Region extends RegionOut {
  kind: RegionKind;
  /** Its name ("Circle SDF", "Noise · Value", "Where: circle"). */
  label: string;
  /** A shape made here (its handles show on the picture). */
  made?: MadeShape;
  /** An output of a group (a plain group, a Shader Texture, another Agents group's trail): the group's name. */
  from?: string;
  /** That group, when it can be opened to edit (a plain group or a Shader Texture). */
  inside?: string;
}

export const REGION_WORDS: Record<RegionKind, { label: string; hint: string }> = {
  shape: { label: 'Shape', hint: 'A distance: inside where it is below 0.' },
  mask: { label: 'Mask', hint: 'A number: inside where it is above ½.' },
  texture: { label: 'Texture', hint: 'A picture: inside where it is bright.' },
  scene: { label: '3D scene', hint: 'A ray-marched shape the walkers flow round (Collide).' },
};

export const USE_WORDS: Record<WhereUse, { label: string; kinds: RegionKind[]; none: string }> = {
  onlyWhen: { label: 'only when inside', kinds: ['shape', 'mask', 'texture'], none: 'Pick where this card acts' },
  fieldMask: { label: 'this layer\'s region', kinds: ['shape', 'mask', 'texture'], none: 'Everywhere' },
  slope: { label: 'the field to follow', kinds: ['shape', 'mask'], none: 'Nothing wired into Field ƒ' },
  born: { label: 'born inside', kinds: ['shape', 'mask', 'texture'], none: 'Its shape (above)' },
  obstacle: { label: 'walls', kinds: ['shape', 'mask', 'scene'], none: 'No walls' },
  food: { label: 'food', kinds: ['shape', 'mask', 'texture'], none: 'No food: only their own trail' },
};

/** Uses that can read a texture (and so a new Shader Texture). */
export const takesTexture = (use: WhereUse) => USE_WORDS[use].kinds.includes('texture');

/** Node types never listed: the agents' own family and what only draws. */
const SKIP = /^(agentsGroup|agent[A-Z].*|drawAgents|output|trailField|sceneGroup|marchLoopGroup|giLitMarchGroup|spaceWarpGroup)$/;
/** Nodes that hold a graph of their own: their outputs are listed "from a group". */
const HOLDS_GRAPH = /^(group|shaderTexture)$/;
/** Sources that are the same at every point (time, constants, inputs): not a region. */
const CONSTANT = /^(time|clock|constant|constants|float|int|colorPicker|color|constColor|mouse|mouseButton|lfo|audioInput|midiInput|slider|knob|bpm|beat|resolution|loopIndex)$/;

const labelOf = (nd: GraphNode) => (typeof nd.params.label === 'string' && nd.params.label.trim()) || getNodeDefinition(nd.type)?.label || nd.type;

/** Is a float output a shape's distance? (an SDF node, a "distance" output, a shape made here) */
export function isDistance(nd: GraphNode, outputKey: string): boolean {
  if (nd.params.whereShape) return true;
  const def = getNodeDefinition(nd.type);
  const label = nd.outputs[outputKey]?.label ?? def?.outputs?.[outputKey]?.label ?? '';
  if (/^(distance|dist|sdf|d)$/i.test(outputKey) || /distance|sdf/i.test(label)) return true;
  return def?.category === 'SDF' || (def?.category === '2D Primitives' && outputKey !== 'color');
}

/** The nodes downstream of `id` (reading it, directly or not). */
function downstream(nodes: readonly GraphNode[], id: string): Set<string> {
  const out = new Set<string>();
  let grew = true;
  while (grew) {
    grew = false;
    for (const nd of nodes) {
      if (out.has(nd.id)) continue;
      if (Object.values(nd.inputs).some(i => i.connection && (i.connection.nodeId === id || out.has(i.connection.nodeId)))) { out.add(nd.id); grew = true; }
    }
  }
  return out;
}

/** Can this node vary across the picture (a source of position, or something wired)? */
function varies(nd: GraphNode, byId: Map<string, GraphNode>, seen = new Set<string>()): boolean {
  if (seen.has(nd.id)) return false;
  seen.add(nd.id);
  if (CONSTANT.test(nd.type)) return false;
  const def = getNodeDefinition(nd.type);
  const ins = Object.entries(def?.inputs ?? {});
  // An unwired UV (vec2) input is read at each point (g_uv).
  if (ins.some(([k, v]) => v.type === 'vec2' && !nd.inputs[k]?.connection)) return true;
  if (nd.type === 'exprNode' && ((nd.params.inputs as Array<{ name: string; type: string }> | undefined) ?? []).some(i => i.type === 'vec2' && !nd.inputs[i.name]?.connection)) return true;
  if (nd.type === 'uv' || nd.type === 'pixelUV' || nd.type === 'fragCoord') return true;
  if (ins.length === 0 && nd.type !== 'exprNode') return true; // a picture source (noise, a texture)
  return Object.values(nd.inputs).some(i => i.connection && byId.has(i.connection.nodeId) && varies(byId.get(i.connection.nodeId)!, byId, seen));
}

/**
 * Everything at the top of the graph that can be a region for a group: float outputs (shapes and
 * masks), texture outputs, and in 3D Scene outputs. Nothing that reads the group (a cycle), except
 * its trail's texture (read a step late, as Sense does).
 */
export function listRegions(nodes: readonly GraphNode[], groupId: string, d3 = false): Region[] {
  const after = downstream(nodes, groupId);
  const byId = new Map(nodes.map(x => [x.id, x]));
  const out: Region[] = [];
  for (const nd of nodes) {
    if (nd.id === groupId || nd.params.whereAdapter) continue;
    const trail = nd.type === 'trailField';
    if (SKIP.test(nd.type) && !trail) continue;
    const from = groupOf(nodes, nd, groupId);
    const tagged = from ? { from, ...(HOLDS_GRAPH.test(nd.type) ? { inside: nd.id } : {}) } : {};
    const outs = Object.entries(nd.outputs ?? {});
    for (const [key, o] of outs) {
      const many = outs.filter(([, x]) => x.type === o.type).length > 1;
      const name = `${labelOf(nd)}${many ? ` · ${o.label}` : ''}`;
      if (o.type === 'texture') { out.push({ nodeId: nd.id, outputKey: key, kind: 'texture', label: `${labelOf(nd)}${outs.filter(([, x]) => x.type === 'texture').length > 1 ? ` · ${o.label}` : ''}`, ...tagged }); continue; }
      if (trail || after.has(nd.id)) continue;
      if (o.type === 'scene3d' && d3) { out.push({ nodeId: nd.id, outputKey: key, kind: 'scene', label: name, ...tagged }); continue; }
      if (o.type !== 'float' || !varies(nd, byId)) continue;
      const made = readMadeShape(nd) ?? undefined;
      out.push({ nodeId: nd.id, outputKey: key, kind: isDistance(nd, key) ? 'shape' : 'mask', label: made ? madeShapeName(made) : name, ...(made ? { made } : {}), ...tagged });
    }
  }
  // Shapes made here first, then shapes, masks, textures, scenes.
  const order: Record<RegionKind, number> = { shape: 1, mask: 2, texture: 3, scene: 4 };
  return out.sort((a, b) => (a.made ? 0 : order[a.kind]) - (b.made ? 0 : order[b.kind]));
}

/**
 * The group a node's outputs come from, for the picker's "From a group": a plain group or a Shader
 * Texture (its own name), or a Trail field another Agents group deposits into ("Prey's trail").
 */
function groupOf(nodes: readonly GraphNode[], nd: GraphNode, groupId: string): string | undefined {
  if (HOLDS_GRAPH.test(nd.type)) return labelOf(nd);
  if (nd.type !== 'trailField') return undefined;
  const dep = nodes.find(d => d.type === 'agentDeposit' && nd.inputs.deposit?.connection?.nodeId === d.id);
  const g = dep && nodes.find(x => x.id === dep.inputs.agents?.connection?.nodeId && x.type === 'agentsGroup');
  return g && g.id !== groupId ? labelOf(g) : undefined;
}

/** The regions a use can take. */
export const regionsFor = (use: WhereUse, regions: readonly Region[]) => regions.filter(r => USE_WORDS[use].kinds.includes(r.kind));
export const sameOut = (a: RegionOut | null | undefined, b: RegionOut | null | undefined) => !!a && !!b && a.nodeId === b.nodeId && a.outputKey === b.outputKey;

/** A region by its output, as listed (null when it isn't one any more). */
export function regionAt(nodes: readonly GraphNode[], out: RegionOut | null | undefined): Region | null {
  if (!out) return null;
  const nd = nodes.find(x => x.id === out.nodeId);
  const o = nd?.outputs[out.outputKey];
  if (!nd || !o) return null;
  const made = readMadeShape(nd) ?? undefined;
  const kind: RegionKind = o.type === 'texture' ? 'texture' : o.type === 'scene3d' ? 'scene' : isDistance(nd, out.outputKey) ? 'shape' : 'mask';
  const holds = HOLDS_GRAPH.test(nd.type);
  return { ...out, kind, label: made ? madeShapeName(made) : labelOf(nd), ...(made ? { made } : {}), ...(holds ? { from: labelOf(nd), inside: nd.id } : {}) };
}

// ── Reading a region: inside or outside ─────────────────────────────────────

/** The "only when inside" condition for a region in mask slot `mask`. */
export function maskCondition(kind: RegionKind, mask: number, outside = false): RuleCondition {
  if (kind === 'shape') return { kind: 'mask', mask, cmp: outside ? '>' : '<', value: 0 };
  return { kind: 'mask', mask, cmp: outside ? '<' : '>', value: 0.5 };
}
/** Is a mask condition "inside"? (a distance below 0, or a mask above its level) */
export const maskInside = (c: Extract<RuleCondition, { kind: 'mask' }>) => (c.value === 0 ? c.cmp === '<' : c.cmp === '>');

/** The mask slots the rule set reads (conditions and field layers). */
export function usedMasks(set: AgentRuleSet): Set<number> {
  const used = new Set<number>();
  for (const s of set.species) for (const r of s.rules) {
    for (const c of r.when) if (c.kind === 'mask') used.add(c.mask);
    for (const a of r.do) if (a.kind === 'field') for (const l of a.spec.layers) if (l.mask?.region) used.add(l.mask.region.mask);
  }
  return used;
}

/**
 * The mask slot for a region: the one already wired to it, else a free one (not read by any rule),
 * else a new one (at most MAX_MASKS). The set with that slot named and typed for it, and its index;
 * null when all are taken. `wired(i)` is what the group's mask socket i is wired to now.
 */
export function maskSlotFor(set: AgentRuleSet, region: Region, wired: (i: number) => RegionOut | null, keep?: number): { set: AgentRuleSet; mask: number } | null {
  const kind = region.kind === 'texture' ? 'texture' : 'number';
  const named = (i: number) => {
    const masks = set.masks.slice();
    masks[i] = { name: region.label.replace(/^Where: /, ''), kind };
    return { set: { ...set, masks }, mask: i };
  };
  const hit = set.masks.findIndex((m, i) => sameOut(wired(i), region) && m.kind === kind);
  if (hit >= 0) return named(hit);
  const used = usedMasks(set);
  if (keep !== undefined && keep < set.masks.length) used.delete(keep);
  const free = set.masks.findIndex((_, i) => !used.has(i));
  if (free >= 0) return named(free);
  if (set.masks.length < MAX_MASKS) return named(set.masks.length);
  return null;
}

/** Mask slots at the end that nothing reads, taken off (their sockets go). */
export function pruneMasks(set: AgentRuleSet): AgentRuleSet {
  const used = usedMasks(set);
  let k = set.masks.length;
  while (k > 0 && !used.has(k - 1)) k--;
  return k === set.masks.length ? set : { ...set, masks: set.masks.slice(0, k) };
}

// ── Adapters (Emit's Where ƒ, Move's Obstacle ƒ) ─────────────────────────────

export interface AdapterSpec extends RegionOut { kind: RegionKind; use: 'born' | 'obstacle'; outside?: boolean; name: string }

// ── Food (the Trail field's Add) ────────────────────────────────────────────

/** Food's default rate: trail painted per second where it is (the Trail's Add). */
export const FOOD_AMOUNT = 600;

/**
 * What a food adapter returns: a vec4 with the food in trail channel `channel` (0–3). A shape feeds
 * its inside (a hard edge), a mask and a texture as much as they are bright (0–1).
 */
export function foodResult(kind: RegionKind, channel: number, outside = false): string {
  const inside = kind === 'shape' ? '(1.0 - step(0.0, v))' : kind === 'texture' ? 'clamp(dot(c, vec3(0.299, 0.587, 0.114)), 0.0, 1.0)' : 'clamp(v, 0.0, 1.0)';
  const f = `${outside ? `(1.0 - ${inside})` : inside} * amount`;
  const ch = Math.max(0, Math.min(3, Math.round(channel)));
  return `vec4(${[0, 1, 2, 3].map(i => (i === ch ? f : '0.0')).join(', ')})`;
}

/**
 * The food adapter: an Expression Block between the region and the Trail field's Add, with How much
 * as its slider. A texture is read through a Sample (texture) node first (`sampleId`), its colour
 * into `c`.
 */
export function foodAdapterNode(id: string, a: RegionOut & { kind: RegionKind; outside?: boolean; name: string; channel: number; amount?: number }, x: number, y: number, sampleId?: string): GraphNode {
  const result = foodResult(a.kind, a.channel, a.outside);
  const tex = a.kind === 'texture';
  const node = n('exprNode', id, x, y, {
    label: `Food: ${a.outside ? 'outside ' : ''}${a.name}`,
    inputs: [tex ? { name: 'c', type: 'vec3', slider: null } : { name: 'v', type: 'float', slider: null }, { name: 'amount', type: 'float', slider: { min: 0, max: 2000 } }],
    amount: a.amount ?? FOOD_AMOUNT,
    outputType: 'vec4', lines: [], result, expr: result,
    whereAdapter: { nodeId: a.nodeId, outputKey: a.outputKey, kind: a.kind, use: 'food', channel: a.channel, ...(a.outside ? { outside: true } : {}) },
    __comment: [
      `Food (an Expression Block, made by the Agent Builder's Where picker): ${a.name} painted into the trail every second, in channel ${a.channel + 1}, so the walkers that smell it grow over it.`,
      tex ? `c: ${a.name}'s colour here (a Sample (texture) reads it); its brightness is the food.` : `v: ${a.name} (${a.kind === 'shape' ? 'a distance, below 0 inside: the inside is food' : 'a number: as much food as it is bright, 0–1'}).`,
      'amount: how much trail it paints a second (Trail → Food → How much, in the builder).',
      `result: ${result}.`,
    ].join('\n'),
  });
  node.inputs = {
    ...(tex
      ? { c: { type: 'vec3', label: 'c (vec3)', ...(sampleId ? { connection: { nodeId: sampleId, outputKey: 'color' } } : {}) } }
      : { v: { type: 'float', label: 'v (float)', connection: { nodeId: a.nodeId, outputKey: a.outputKey } } }),
    amount: { type: 'float', label: 'amount (float)' },
  } as GraphNode['inputs'];
  node.outputs = { result: { type: 'vec4', label: 'Result (vec4)' } };
  return node;
}

/** The Sample (texture) a texture's food is read through (dropped with its adapter). */
export function foodSampleNode(id: string, from: RegionOut, x: number, y: number): GraphNode {
  const node = n('sampleTexture', id, x, y, {
    whereAdapter: { nodeId: from.nodeId, outputKey: from.outputKey, kind: 'texture', use: 'food-sample' },
    __comment: 'Sample (texture), made by the Agent Builder\'s Where picker: reads the food\'s texture at each trail pixel, for the Food block beside it.',
  });
  node.inputs = { ...node.inputs, texture: { ...node.inputs.texture, connection: { nodeId: from.nodeId, outputKey: from.outputKey } } };
  return node;
}

/** What an adapter returns from `v` (the region's value): Where ƒ wants 1 inside; Obstacle ƒ a distance (below 0 in the wall). */
export function adapterResult(a: Pick<AdapterSpec, 'kind' | 'use' | 'outside'>): string {
  if (a.use === 'born') {
    const inside = a.kind === 'shape' ? '1.0 - step(0.0, v)' : 'step(0.5, v)';
    return a.outside ? `1.0 - (${inside})` : inside;
  }
  // Obstacle: below 0 is a wall. Walls are the region (or everything outside it).
  const wall = a.kind === 'shape' ? 'v' : '0.5 - v';
  return a.outside ? `-(${wall})` : wall;
}
/** Does a use need an adapter for this region? (a distance into Obstacle ƒ, inside, needs none) */
export const needsAdapter = (use: WhereUse, kind: RegionKind, outside: boolean) =>
  (use === 'born' && kind !== 'texture') || (use === 'obstacle' && kind !== 'scene' && (kind !== 'shape' || outside));

export function adapterNode(id: string, a: AdapterSpec, x: number, y: number): GraphNode {
  const result = adapterResult(a);
  const node = n('exprNode', id, x, y, {
    label: a.use === 'born' ? `Born ${a.outside ? 'outside' : 'inside'} ${a.name}` : `Walls: ${a.outside ? 'outside' : ''} ${a.name}`.replace('  ', ' '),
    inputs: [{ name: 'v', type: 'float', slider: null }], outputType: 'float', lines: [], result, expr: result,
    whereAdapter: { nodeId: a.nodeId, outputKey: a.outputKey, kind: a.kind, use: a.use, ...(a.outside ? { outside: true } : {}) },
    __comment: [
      a.use === 'born'
        ? `${a.outside ? 'Outside' : 'Inside'} ${a.name} (an Expression Block, made by the Agent Builder's Where picker): 1 where walkers may be born, 0 elsewhere, for Emit's Where ƒ (born where it is above Threshold ½).`
        : `Walls (an Expression Block, made by the Agent Builder's Where picker): a distance for Move's Obstacle ƒ, below 0 where walkers can't go: ${a.outside ? `everywhere outside ${a.name}` : `inside ${a.name}`}.`,
      `v: ${a.name} (${a.kind === 'shape' ? 'a distance, below 0 inside' : 'a number, inside above ½'}).`,
      `result: ${result}.`,
    ].join('\n'),
  });
  node.inputs = { v: { type: 'float', label: 'v (float)', connection: { nodeId: a.nodeId, outputKey: a.outputKey } } };
  node.outputs = { result: { type: 'float', label: 'Result (float)' } };
  return node;
}

/** What a wire really reads: through an adapter to its region (and whether it is "outside"). */
export function throughAdapter(nodes: readonly GraphNode[], c: RegionOut | null | undefined): { out: RegionOut; outside: boolean; adapter?: string } | null {
  if (!c) return null;
  const nd = nodes.find(x => x.id === c.nodeId);
  const a = nd?.params.whereAdapter as { outside?: boolean } | undefined;
  const v = nd?.inputs.v?.connection;
  if (nd && a && v) return { out: { nodeId: v.nodeId, outputKey: v.outputKey }, outside: !!a.outside, adapter: nd.id };
  // A texture's food: the adapter reads a Sample (texture), which reads the texture.
  const sc = nd && a ? nd.inputs.c?.connection : undefined;
  const t = sc ? nodes.find(x => x.id === sc.nodeId)?.inputs.texture?.connection : undefined;
  if (nd && a && t) return { out: { nodeId: t.nodeId, outputKey: t.outputKey }, outside: !!a.outside, adapter: nd.id };
  return { out: { nodeId: c.nodeId, outputKey: c.outputKey }, outside: false };
}
