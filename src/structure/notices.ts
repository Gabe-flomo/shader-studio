/**
 * notices.ts — gentle order notices (docs/structure-hints.md): a few orders that are usually an
 * accident, said as a question. They never block, move or rewrite anything.
 *
 *  - bend-after-colour: a Bend-space node fed a colour whose result goes on as a colour (into a
 *    colour step, a finish or the Output). It bends the colour's values, not the shape. A bend
 *    whose result goes back into space (a shape, a sampler: colour-to-space) is deliberate and
 *    not flagged.
 *  - glow-after-tonemap: Bloom downstream of a Tone map. The brights are already squeezed.
 *  - noise-after-post: a noise mixed into the picture after a finish (vignette, grain, tone map…)
 *    that it doesn't pass through.
 *
 * Exceptions: anything that reads a previous frame (Pass, Previous Frame, Echo, Fade) or sits in an
 * iterated group or loop is left alone (feedback is deliberate), and so are Expression Blocks
 * and custom functions (they can do anything).
 *
 * Pure.
 */
import type { GraphNode } from '../types/nodeGraph';
import { GROUP_PORT_SENTINEL } from '../types/nodeGraph';
import { getNodeDefinition } from '../nodes/definitions';
import { stageOfType, type StageOf } from './stages';

export type NoticeRule = 'bend-after-colour' | 'glow-after-tonemap' | 'noise-after-post';

export interface OrderNotice {
  /** Stable across edits: rule and node id (dismissals are kept by it). */
  id: string;
  rule: NoticeRule;
  /** The node the notice is about. */
  nodeId: string;
  /** The group path to its level ([] on top). */
  path: string[];
  title: string;
  text: string;
}

const OUTPUTS = new Set(['output', 'vec4Output']);
/** Nodes that read a previous frame: anything around them is feedback. */
const FEEDBACK = new Set(['pass', 'prevFrame', 'echo', 'textureFade', 'gridRules', 'motionBlur']);
/** Nodes whose inside says nothing about order. */
const OPAQUE = new Set(['exprNode', 'customFn', 'forLoop', 'loopCarry']);
const NOISE = new Set(['fbm', 'voronoi', 'noiseFloat', 'scatter', 'waveTexture', 'magicTexture', 'chaosLayers', 'turbulence']);
const GLOWS = new Set(['bloom', 'glowTexture']);

const label = (n: GraphNode) => (typeof n.params?.label === 'string' && n.params.label) || getNodeDefinition(n.type)?.label || n.type;

interface Level {
  nodes: GraphNode[];
  byId: Map<string, GraphNode>;
  /** id → nodes it feeds (with the input key). */
  consumers: Map<string, Array<{ node: GraphNode; key: string }>>;
}

function level(nodes: GraphNode[]): Level {
  const byId = new Map(nodes.map(n => [n.id, n]));
  const consumers = new Map<string, Array<{ node: GraphNode; key: string }>>();
  for (const n of nodes) {
    for (const [key, inp] of Object.entries(n.inputs ?? {})) {
      const c = inp?.connection;
      if (!c || c.nodeId === GROUP_PORT_SENTINEL || !byId.has(c.nodeId)) continue;
      const list = consumers.get(c.nodeId) ?? [];
      list.push({ node: n, key });
      consumers.set(c.nodeId, list);
    }
  }
  return { nodes, byId, consumers };
}

const feedersOf = (L: Level, n: GraphNode): GraphNode[] =>
  Object.values(n.inputs ?? {}).map(i => i?.connection).filter(c => c && c.nodeId !== GROUP_PORT_SENTINEL).map(c => L.byId.get(c!.nodeId)).filter((m): m is GraphNode => !!m);

/** Everything upstream of n (n excluded). */
function ancestors(L: Level, n: GraphNode): Set<string> {
  const seen = new Set<string>();
  const stack = feedersOf(L, n);
  while (stack.length) {
    const m = stack.pop()!;
    if (seen.has(m.id)) continue;
    seen.add(m.id);
    stack.push(...feedersOf(L, m));
  }
  return seen;
}

/** Everything downstream of n (n excluded). */
function descendants(L: Level, n: GraphNode): Set<string> {
  const seen = new Set<string>();
  const stack = (L.consumers.get(n.id) ?? []).map(c => c.node);
  while (stack.length) {
    const m = stack.pop()!;
    if (seen.has(m.id)) continue;
    seen.add(m.id);
    stack.push(...(L.consumers.get(m.id) ?? []).map(c => c.node));
  }
  return seen;
}

const st = (n: GraphNode): StageOf => stageOfType(n.type);

/** The nearest staged nodes feeding `n` through its input `key`, through nodes that go anywhere. */
function stagedFeeders(L: Level, n: GraphNode, key: string): GraphNode[] {
  const c = n.inputs?.[key]?.connection;
  const first = c && c.nodeId !== GROUP_PORT_SENTINEL ? L.byId.get(c.nodeId) : undefined;
  if (!first) return [];
  const out: GraphNode[] = [];
  const seen = new Set<string>();
  const stack = [first];
  while (stack.length) {
    const m = stack.pop()!;
    if (seen.has(m.id)) continue;
    seen.add(m.id);
    if (OPAQUE.has(m.type)) continue;
    if (st(m) !== 'any') out.push(m);
    else stack.push(...feedersOf(L, m));
  }
  return out;
}

/** The nearest staged (or Output) nodes `n` feeds, through nodes that go anywhere. */
function stagedConsumers(L: Level, n: GraphNode): GraphNode[] {
  const out: GraphNode[] = [];
  const seen = new Set<string>();
  const stack = (L.consumers.get(n.id) ?? []).map(c => c.node);
  while (stack.length) {
    const m = stack.pop()!;
    if (seen.has(m.id)) continue;
    seen.add(m.id);
    if (OPAQUE.has(m.type)) { out.push(m); continue; }
    if (OUTPUTS.has(m.type) || st(m) !== 'any') out.push(m);
    else stack.push(...(L.consumers.get(m.id) ?? []).map(c => c.node));
  }
  return out;
}

const isColourish = (s: StageOf) => s === 'colour' || s === 'post';

function checkLevel(nodes: GraphNode[], path: string[], out: OrderNotice[]) {
  const L = level(nodes);
  // Feedback anywhere in this level: everything wired to it is deliberate.
  const tainted = new Set<string>();
  for (const n of nodes) {
    if (!FEEDBACK.has(n.type)) continue;
    tainted.add(n.id);
    for (const id of ancestors(L, n)) tainted.add(id);
    for (const id of descendants(L, n)) tainted.add(id);
  }
  const ok = (n: GraphNode) => !tainted.has(n.id) && !n.bypassed;

  for (const n of nodes) {
    if (!ok(n)) continue;

    // 1. A bend fed a colour, whose result is used as a colour.
    if (st(n) === 'bend') {
      const spaceKeys = Object.entries(n.inputs ?? {}).filter(([, i]) => i.type === 'vec2' && i.connection).map(([k]) => k);
      for (const key of spaceKeys.slice(0, 1)) {
        const colourIn = stagedFeeders(L, n, key).find(m => isColourish(st(m)));
        if (!colourIn) continue;
        const next = stagedConsumers(L, n);
        if (!next.length || !next.every(m => OUTPUTS.has(m.type) || isColourish(st(m)))) continue;
        out.push({
          id: `bend-after-colour:${n.id}`, rule: 'bend-after-colour', nodeId: n.id, path,
          title: `${label(n)} comes after the colour`,
          text: `${label(n)} is fed ${label(colourIn)}'s colour and its result goes on as a colour: this bends the colours, not the shape. Bends usually go on the UV, before the shape. Was that intended?`,
        });
        break;
      }
    }

    // 2. Bloom after a Tone map.
    if (n.type === 'toneMap') {
      const below = descendants(L, n);
      const glow = [...below].map(id => L.byId.get(id)!).find(m => GLOWS.has(m.type) && ok(m));
      if (glow) {
        out.push({
          id: `glow-after-tonemap:${glow.id}`, rule: 'glow-after-tonemap', nodeId: glow.id, path,
          title: `${label(glow)} comes after the Tone map`,
          text: `${label(n)} has already squeezed the brights into range, so ${label(glow)} has little to catch. A glow usually goes before the tone map. Was that intended?`,
        });
      }
    }

    // 3. Noise mixed in after a finish it doesn't pass through.
    if (NOISE.has(n.type)) {
      const before = ancestors(L, n);
      for (const { node: j } of L.consumers.get(n.id) ?? []) {
        if (!ok(j) || OPAQUE.has(j.type) || OUTPUTS.has(j.type)) continue;
        // The join's other inputs: does one come from a finish this noise isn't part of?
        const ups = ancestors(L, j);
        const post = [...ups].map(id => L.byId.get(id)!).find(p => st(p) === 'post' && ok(p) && !before.has(p.id) && !ancestors(L, p).has(n.id));
        if (!post) continue;
        // Only when the join makes the picture (feeds the Output, possibly through colour steps).
        const toOut = [...descendants(L, j)].some(id => OUTPUTS.has(L.byId.get(id)!.type)) || false;
        if (!toOut) continue;
        out.push({
          id: `noise-after-post:${n.id}`, rule: 'noise-after-post', nodeId: n.id, path,
          title: `${label(n)} is mixed in after ${label(post)}`,
          text: `${label(n)} joins the picture after ${label(post)}, so the finish doesn't touch it. Noise usually goes in before the colour, and the finish comes last. Was that intended?`,
        });
        break;
      }
    }
  }

  // Into groups, except iterated ones (loops are deliberate).
  for (const n of nodes) {
    const sg = n.params?.subgraph as { nodes?: GraphNode[] } | undefined;
    if (!sg?.nodes) continue;
    const iters = Number(n.params?.iterations ?? 1);
    if (iters > 1 || n.carryMode) continue;
    if (tainted.has(n.id)) continue;
    checkLevel(sg.nodes, [...path, n.id], out);
  }
}

/** The order notices for a graph (all levels). */
export function orderNotices(nodes: readonly GraphNode[]): OrderNotice[] {
  const out: OrderNotice[] = [];
  checkLevel([...nodes], [], out);
  return out;
}
