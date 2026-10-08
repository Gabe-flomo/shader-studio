/**
 * recognize.ts — a 3D graph back into a Scene Builder spec ("Describe this
 * graph", docs/scene-builder.md).
 *
 * For a graph the builder made, this reads back exactly the spec it was built
 * from (the tests check every template). For a hand-made 3D graph it is a
 * best effort: it follows the wires from Output to the march loop, from the
 * loop to the camera and the Scene Group, and inside the Scene Group from
 * Scene Output back to Scene Pos, naming what it knows (shapes, combines,
 * warps, moves and turns, the render mode, lights, fog, tone) and marking the
 * rest `custom(…)`, so the recognised part can be opened in the builder.
 *
 * Pure: reads nodes, changes nothing.
 */
import type { GraphNode, SubgraphData } from '../types/nodeGraph';
import { getNodeDefinition } from '../nodes/definitions';
import {
  DEFAULT_LOOK, SHAPES, WARPS, autoStepScale, emptySpec, newGroup, newShape, num, vec, walkItems,
  type GroupSpec, type SceneItem, type SceneSpec, type ShapeDef, type ShapeSpec, type Vec3, type WarpDef, type WarpSpec,
} from './spec';
import { round, printRecipe } from './recipe';
import { META_KEY, ROLE_KEY, type SceneBuilderMeta } from './build';
import { DEFAULT_PALETTE, OUTPUT_BY_SHOW, PALETTES, type OutputShow, type OutputSpec } from './output';

export interface DescribeResult {
  spec: SceneSpec;
  recipe: string;
  /** What was read, in plain words. */
  recognized: string[];
  /** What wasn't, in plain words (each also a custom(…) in the recipe when it sits in the scene). */
  unknown: string[];
  /** Nodes read / 3D nodes looked at. */
  coverage: { read: number; total: number };
  /** The Scene Group and the renderer it came from. */
  sceneId: string | null;
  rendererId: string | null;
  /** The Scene Group carries a builder spec (it was made in the builder). */
  builderMade: boolean;
}

const deg = (r: number) => round(r * 180 / Math.PI);
const roleOf = (n: GraphNode | undefined) => (typeof n?.params?.[ROLE_KEY] === 'string' ? n.params[ROLE_KEY] as string : '');
const label = (n: GraphNode) => (typeof n.params.label === 'string' && n.params.label.trim()) || getNodeDefinition(n.type)?.label || n.type;
const subNodes = (n: GraphNode | undefined): GraphNode[] => ((n?.params?.subgraph as SubgraphData | undefined)?.nodes ?? []);

/** Node type → the shape it is (a rounded variant counts as its shape with Round set). */
const SHAPE_OF_TYPE = new Map<string, ShapeDef>();
for (const s of SHAPES) { SHAPE_OF_TYPE.set(s.type, s); if (s.roundType) SHAPE_OF_TYPE.set(s.roundType, s); }
SHAPE_OF_TYPE.set('verticalCapsuleSDF3D', SHAPES.find(s => s.kind === 'capsule')!);
/** Node type → the warp it is; the first in WARPS wins (Rotate 3D on its own is a Turn). */
const WARP_OF_TYPE = new Map<string, WarpDef>();
for (const w of WARPS) if (!WARP_OF_TYPE.has(w.type)) WARP_OF_TYPE.set(w.type, w);
/** Node type → the modifier that changes a distance with it (Displace 3D, Offset, Onion; Scale 3D's correction). */
const DIST_OF_TYPE = new Map<string, WarpDef>();
for (const w of WARPS) if (w.distStep && !DIST_OF_TYPE.has(w.distStep.type)) DIST_OF_TYPE.set(w.distStep.type, w);
const OP_OF_TYPE: Record<string, GroupSpec['op']> = { sdfUnion: 'union', sdfSubtract: 'subtract', sdfIntersect: 'intersect' };

// ── Reading one node ────────────────────────────────────────────────────────

class Reader {
  byId: Map<string, GraphNode>;
  /** Item id → its warp ids in the builder's order (from the spec a builder scene carries). */
  order?: Map<string, string[]>;
  read = new Set<string>();
  unknown: string[] = [];
  constructor(nodes: GraphNode[]) { this.byId = new Map(nodes.map(n => [n.id, n])); }
  src(n: GraphNode, key: string): GraphNode | undefined {
    const c = n.inputs[key]?.connection;
    return c ? this.byId.get(c.nodeId) : undefined;
  }
  wiredParams(n: GraphNode, keys: string[], what: string) {
    for (const k of keys) if (n.inputs[k]?.connection) this.unknown.push(`${what}: ${n.inputs[k].label ?? k} is driven by a wire (its slider value is used).`);
  }
}

function warpValues(n: GraphNode, def: WarpDef): WarpSpec['values'] {
  const out: WarpSpec['values'] = {};
  for (const p of def.params) {
    if (Array.isArray(p.param)) out[p.key] = p.param.map((k, i) => round(num(n.params[k], (p.def as Vec3)[i]))) as Vec3;
    else out[p.key] = p.deg ? deg(num(n.params[p.param], 0)) : round(num(n.params[p.param], p.def as number));
  }
  if (def.axes?.kind === 'flags') out[def.axes.key] = def.axes.params.map((k, i) => (n.params[k] ? 'xyz'[i] : '')).join('') || def.axes.def;
  else if (def.axes) out[def.axes.key] = String(n.params[def.axes.param] ?? def.axes.def);
  if (def.select) out[def.select.key] = String(n.params[def.select.param] ?? def.select.def);
  if (def.kind === 'kaleido') out.n = Math.round(Number(n.params.iterations ?? 3));
  if (def.kind === 'scale') out.s = round(1 / Math.max(1e-6, num(n.params.scale, 1)));
  if (def.kind === 'round') out.r = round(-num(n.params.amount, -0.05));
  return out;
}

function toWarp(r: Reader, n: GraphNode): WarpSpec {
  const def = WARP_OF_TYPE.get(n.type);
  r.read.add(n.id);
  const role = roleOf(n);
  const id = /^w\d+$/.test(role) ? role : `w_${n.id}`;
  if (!def) { r.unknown.push(`${label(n)} bends space in a way the builder doesn't know: custom.`); return { id, kind: 'custom', values: {}, label: label(n) }; }
  r.wiredParams(n, Object.keys(n.inputs).filter(k => k !== def.posIn && k !== 'dist' && k !== 'time' && k !== def.distStep?.distIn && k !== def.distStep?.posIn), def.label);
  return { id, kind: def.kind, values: warpValues(n, def) };
}

/** A distance modifier read off the distance chain, or Scale's correction, and where on the point chain it sits. */
type Mod =
  | { kind: 'mod'; w: WarpSpec; /** the node whose point it reads (Displace) */ at: string | null }
  | { kind: 'fix'; node: GraphNode; scale: number };

// ── The scene tree ──────────────────────────────────────────────────────────

type Raw =
  | { kind: 'shape'; shape: ShapeSpec; chain: GraphNode[]; mods: Mod[] }
  | { kind: 'group'; group: GroupSpec; children: Raw[]; chain: GraphNode[]; mods: Mod[] };

/** The position chain from Scene Pos out to `n`'s input (Scene Pos first). Unknown steps are kept as custom. */
function posChain(r: Reader, n: GraphNode | undefined, key: string, guard = 0): GraphNode[] {
  const from = n ? r.src(n, key) : undefined;
  if (!from || guard > 64) return [];
  if (from.type === 'scenePos') { r.read.add(from.id); return []; }
  const def = WARP_OF_TYPE.get(from.type);
  const inKey = def?.posIn ?? Object.keys(from.inputs).find(k => from.inputs[k].type === 'vec3' && from.inputs[k].connection) ?? 'pos';
  return [...posChain(r, from, inKey, guard + 1), from];
}

function readShape(r: Reader, n: GraphNode, def: ShapeDef): ShapeSpec {
  r.read.add(n.id);
  const role = roleOf(n);
  const sh = newShape(def.kind, /^s\d+$/.test(role) ? role : `s_${n.id}`);
  sh.name = typeof n.params._sbName === 'string' ? n.params._sbName : '';
  const rounded = n.type === def.roundType;
  for (const p of def.params) {
    if (!p.param) continue;
    if (p.key === 'round') { sh.size.round = rounded ? round(num(n.params[p.param as string], 0)) : 0; continue; }
    if (Array.isArray(p.param)) sh.size[p.key] = p.param.map((k, i) => round(num(n.params[k], (p.def as Vec3)[i]))) as Vec3;
    else sh.size[p.key] = p.deg ? deg(num(n.params[p.param], 0)) : round(num(n.params[p.param], p.def as number));
  }
  if (n.type === 'roundedCylinderSDF3D') sh.size.r = round(Number(sh.size.r) * 2);
  if (def.field) sh.size.ball = 0;
  r.wiredParams(n, Object.keys(n.inputs).filter(k => k !== def.posKey), `‘${def.label}’`);
  return sh;
}

function readDist(r: Reader, from: GraphNode | undefined, guard = 0): Raw | null {
  if (!from || guard > 200) return null;
  const shapeDef = SHAPE_OF_TYPE.get(from.type);
  if (shapeDef) {
    return { kind: 'shape', shape: readShape(r, from, shapeDef), chain: posChain(r, from, shapeDef.posKey), mods: [] };
  }
  // A modifier on the distance (innermost first, as the builder applies them): kept on the item it changes.
  const distDef = DIST_OF_TYPE.get(from.type);
  if (distDef?.distStep && from.inputs[distDef.distStep.distIn]?.connection) {
    const step = distDef.distStep;
    const inner = readDist(r, r.src(from, step.distIn), guard + 1);
    if (!inner) return inner;
    if (distDef.modifier) {
      const w = toWarp(r, from);
      inner.mods.push({ kind: 'mod', w: { ...w, kind: distDef.kind, values: warpValues(from, distDef) }, at: step.posIn ? r.src(from, step.posIn)?.id ?? null : null });
    } else {
      r.read.add(from.id);
      inner.mods.push({ kind: 'fix', node: from, scale: num(from.params.scale, 1) });
    }
    return inner;
  }
  // A plain Min / Max of two distances is a hard union / intersect.
  if ((from.type === 'minMath' || from.type === 'max') && from.inputs.a?.connection && from.inputs.b?.connection && (from.params.outputType ?? 'float') === 'float') {
    r.read.add(from.id);
    const children = [readDist(r, r.src(from, 'a'), guard + 1), readDist(r, r.src(from, 'b'), guard + 1)].filter((x): x is Raw => !!x);
    return { kind: 'group', group: newGroup(`g_${from.id}`, { op: from.type === 'minMath' ? 'union' : 'intersect' }), children, chain: commonPrefix(children.map(c => c.chain)), mods: [] };
  }
  const op = OP_OF_TYPE[from.type];
  if (op) {
    r.read.add(from.id);
    const k = round(num(from.params.k, 0));
    if (from.inputs.k?.connection) r.unknown.push(`${label(from)}: its blend radius is driven by a wire (its slider value is used).`);
    const a = r.src(from, 'a'), b = r.src(from, 'b');
    // A field cut to a ball (how the builder and the 3D auto-placement show a Gyroid).
    if (op === 'intersect' && a && b && SHAPE_OF_TYPE.get(a.type)?.field && b.type === 'sphereSDF3D') {
      const field = readDist(r, a, guard + 1);
      const ballChain = posChain(r, b, 'pos');
      if (field?.kind === 'shape' && ballChain.map(x => x.id).join() === field.chain.map(x => x.id).join()) {
        r.read.add(b.id);
        field.shape.size.ball = round(num(b.params.radius, 1.1));
        return field;
      }
    }
    const role = roleOf(from);
    const gid = role.split(':')[0];
    const group = newGroup(/^g\d+$/.test(gid) ? gid : `g_${from.id}`, { op, k, name: typeof from.params._sbName === 'string' ? from.params._sbName : '' });
    const children: Raw[] = [];
    // A chain of the same combine (same group, or no roles at all) is one group of several children.
    const left = a && OP_OF_TYPE[a.type] === op && round(num(a.params.k, 0)) === k && roleOf(a).split(':')[0] === gid && !a.inputs.k?.connection ? readDist(r, a, guard + 1) : null;
    if (left?.kind === 'group' && left.group.id === group.id && !left.mods.length) { children.push(...left.children); if (!group.name) group.name = left.group.name; }
    else {
      const ra = left ?? readDist(r, a, guard + 1);
      if (ra) children.push(ra);
    }
    const rb = readDist(r, b, guard + 1);
    if (rb) children.push(rb);
    const chain = commonPrefix(children.map(c => c.chain));
    return { kind: 'group', group, children, chain, mods: [] };
  }
  // Something else makes this distance: kept as a custom part, read through to whatever it reads.
  r.read.add(from.id);
  r.unknown.push(`${label(from)} shapes the distance in a way the builder doesn't know: custom(${label(from)}).`);
  return { kind: 'shape', shape: newShape('custom', `s_${from.id}`, { label: label(from) }), chain: [], mods: [] };
}

function commonPrefix(chains: GraphNode[][]): GraphNode[] {
  if (!chains.length) return [];
  const out: GraphNode[] = [];
  for (let i = 0; ; i++) {
    const n = chains[0][i];
    if (!n || chains.some(c => c[i]?.id !== n.id)) return out;
    out.push(n);
  }
}

/**
 * The point chain's own nodes as warps: a builder Rotate's turns (roles `w3:x`, `w3:y`…) are one
 * Rotate again; everything else is one warp per node.
 */
function chainWarps(r: Reader, nodes: GraphNode[]): Array<{ w: WarpSpec; at: number }> {
  const out: Array<{ w: WarpSpec; at: number }> = [];
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    const m = n.type === 'rotate3D' && !n.inputs.angle?.connection ? /^(w\d+):([xyz])$/.exec(roleOf(n)) : null;
    if (m) {
      const by: Vec3 = [0, 0, 0];
      const at = i;
      for (; i < nodes.length; i++) {
        const k = nodes[i].type === 'rotate3D' ? /^(w\d+):([xyz])$/.exec(roleOf(nodes[i])) : null;
        if (!k || k[1] !== m[1]) break;
        by['xyz'.indexOf(k[2])] = round(-deg(num(nodes[i].params.angle, 0)));
        r.read.add(nodes[i].id);
      }
      i--;
      out.push({ w: { id: m[1], kind: 'rotate', values: { by: by.map(v => (Object.is(v, -0) ? 0 : v)) as Vec3 } }, at });
      continue;
    }
    out.push({ w: toWarp(r, n), at: i });
  }
  return out;
}

/**
 * An item's stack: the point chain's warps with the distance modifiers put back where they sit.
 * A Displace reads the point after a warp, so it goes right after it; Scale's correction pairs
 * with its Scale on the point; Round and Onion go before the next modifier that has a place
 * (they commute with the warps between), else last.
 */
function stack(r: Reader, own: GraphNode[], upTo: number, mods: Mod[]): WarpSpec[] {
  const warps = chainWarps(r, own.slice(0, upTo)).map((x, i) => ({ w: x.w, key: x.at, order: i }));
  // Read innermost first: the stack's order is the reverse.
  const inOrder = [...mods].reverse();
  const paired = new Set<string>();
  const keyed: Array<{ w: WarpSpec | null; key: number | null }> = inOrder.map(m => {
    if (m.kind === 'fix') {
      const role = roleOf(m.node).replace(/:dist$/, '');
      const i = own.slice(0, upTo).findIndex(n => n.type === 'scale3d' && !paired.has(n.id) && (role && roleOf(n) === role || Math.abs(num(n.params.scale, 1) - m.scale) < 1e-6));
      if (i < 0) { r.unknown.push('A Scale 3D on the distance has no matching Scale 3D on the point: left out.'); return { w: null, key: null }; }
      paired.add(own[i].id);
      return { w: null, key: i - 0.5 };
    }
    if (!m.at) return { w: m.w, key: null };
    const i = own.findIndex(n => n.id === m.at);
    return { w: m.w, key: Math.min(i + 0.5, upTo) };
  });
  // A modifier with no place of its own goes before the next one that has one.
  let next = upTo;
  for (let i = keyed.length - 1; i >= 0; i--) {
    if (keyed[i].key === null) keyed[i].key = next;
    else next = keyed[i].key!;
  }
  const all = [
    ...warps.map(x => ({ w: x.w, key: x.key, tie: 1, order: x.order })),
    ...keyed.flatMap((x, i) => (x.w ? [{ w: x.w, key: x.key!, tie: 0, order: i }] : [])),
  ];
  all.sort((a, b) => a.key - b.key || a.tie - b.tie || a.order - b.order);
  return all.map(x => x.w);
}

/** The builder's own order for an item's stack (from the spec it carries), when the graph holds the same warps. */
function builderOrder(r: Reader, id: string, warps: WarpSpec[]): WarpSpec[] {
  const want = r.order?.get(id);
  if (!want || want.length !== warps.length) return warps;
  const byId = new Map(warps.map(w => [w.id, w]));
  return want.every(w => byId.has(w)) ? want.map(w => byId.get(w)!) : warps;
}

/** Assign each chain's own part (beyond what its parent took) as warps, moves and turns. */
function finish(r: Reader, raw: Raw, taken: number): SceneItem {
  const own = raw.chain.slice(taken);
  if (raw.kind === 'group') {
    raw.group.warps = builderOrder(r, raw.group.id, stack(r, own, own.length, raw.mods));
    raw.group.children = raw.children.map(c => finish(r, c, raw.chain.length));
    return raw.group;
  }
  const sh = raw.shape;
  // Trailing turns (Z, then Y, then X as the builder writes them) are the shape's rotation; a move just before them is where it is.
  let end = own.length;
  const rot: Vec3 = [0, 0, 0];
  const order = ['z', 'y', 'x'];
  const tail: GraphNode[] = [];
  for (let i = own.length - 1; i >= 0; i--) {
    const n = own[i];
    if (n.type !== 'rotate3D' || n.inputs.angle?.connection) break;
    const role = roleOf(n);
    if (role && !/:rot[xyz]$/.test(role)) break;
    tail.unshift(n);
    end = i;
  }
  // Accept the tail only in Z, Y, X order with each axis once.
  const axes = tail.map(n => String(n.params.axis ?? 'y'));
  const ok = axes.every((a, i) => order.indexOf(a) >= (i ? order.indexOf(axes[i - 1]) + 1 : 0));
  if (ok) {
    for (const n of tail) { const i = 'xyz'.indexOf(String(n.params.axis ?? 'y')); rot[i] = round(-deg(num(n.params.angle, 0))); r.read.add(n.id); }
  } else end = own.length;
  const last = own[end - 1];
  const lastRole = roleOf(last);
  if (last?.type === 'translate3D' && !last.inputs.tx?.connection && !last.inputs.ty?.connection && !last.inputs.tz?.connection && (!lastRole || lastRole.endsWith(':at'))) {
    sh.at = [round(num(last.params.tx, 0)), round(num(last.params.ty, 0)), round(num(last.params.tz, 0))];
    r.read.add(last.id);
    end--;
  }
  sh.rot = rot.map(v => (Object.is(v, -0) ? 0 : v)) as Vec3;
  sh.warps = builderOrder(r, sh.id, stack(r, own, end, raw.mods));
  return sh;
}

/** Scene Output back to Scene Pos: the tree. */
function readScene(r: Reader, sceneGroup: GraphNode, meta: SceneBuilderMeta | null = null): GroupSpec {
  const inner = subNodes(sceneGroup);
  const ir = new Reader(inner);
  if (meta) {
    ir.order = new Map();
    walkItems(meta.spec.root, it => ir.order!.set(it.id, it.warps.map(w => w.id)));
  }
  const out = inner.find(n => n.type === 'sceneOutput');
  if (out) ir.read.add(out.id);
  // Older scenes have no Scene Output: the return is named on the subgraph, or is the last distance nobody reads.
  const legacy = sceneGroup.params.subgraph as { outputNodeId?: string } | undefined;
  const consumed = new Set(inner.flatMap(n => Object.values(n.inputs).map(i => i.connection?.nodeId).filter(Boolean)));
  const tail = [...inner].reverse().find(n => !consumed.has(n.id) && ['dist', 'distance', 'surface'].some(k => n.outputs[k]?.type === 'float'));
  const ret = out ? ir.src(out, 'dist') : (legacy?.outputNodeId ? ir.byId.get(legacy.outputNodeId) : undefined) ?? tail;
  const raw = ret ? readDist(ir, ret) : null;
  let root: GroupSpec;
  if (!raw) root = newGroup('g1');
  else if (raw.kind === 'group') root = finish(ir, raw, 0) as GroupSpec;
  else {
    const item = finish(ir, raw, 0);
    root = newGroup('g1', { children: [item] });
    // One shape: its warps could be the scene's or its own. The builder's spec says which.
    const sceneWarpIds = new Set(meta?.spec.root.warps.map(w => w.id) ?? []);
    while (item.warps.length && sceneWarpIds.has(item.warps[0].id)) root.warps.push(item.warps.shift()!);
  }
  root.name = root.name || 'Scene';
  // Inside nodes nobody reads (a shape left unwired, a note) are not part of the scene.
  for (const n of inner) {
    if (ir.read.has(n.id) || n.type === 'scenePos' || consumed.has(n.id)) continue;
    if (n.type === 'sceneOutput') continue;
    ir.unknown.push(`${label(n)} inside ${label(sceneGroup)} is not wired into Scene Output, so it is not part of the scene.`);
  }
  r.unknown.push(...ir.unknown);
  r.read.add(sceneGroup.id);
  (r as Reader & { innerRead?: number }).innerRead = ((r as Reader & { innerRead?: number }).innerRead ?? 0) + ir.read.size;
  (r as Reader & { innerTotal?: number }).innerTotal = ((r as Reader & { innerTotal?: number }).innerTotal ?? 0) + inner.length;
  return root;
}

/** A group with one child is that child (its warps first): the tree as the builder would show it. */
export function collapseGroups(g: GroupSpec, isRoot = true): GroupSpec {
  g.children = g.children.map(c => {
    if (c.type !== 'group') return c;
    const cc = collapseGroups(c, false);
    if (cc.children.length === 1 && !cc.name) {
      const only = cc.children[0];
      return { ...only, warps: [...cc.warps, ...only.warps] } as SceneItem;
    }
    return cc;
  });
  if (isRoot && g.children.length === 1 && g.children[0].type === 'group' && !g.warps.length && (!g.name || g.name === 'Scene')) {
    const only = g.children[0];
    return { ...only, name: only.name || 'Scene' };
  }
  return g;
}

// ── The whole graph ─────────────────────────────────────────────────────────

const RENDERERS = new Set(['marchLoopGroup', 'giLitMarchGroup', 'glassScene']);

function upstream(r: Reader, start: GraphNode | undefined): Set<string> {
  const seen = new Set<string>();
  const go = (n: GraphNode | undefined) => {
    if (!n || seen.has(n.id)) return;
    seen.add(n.id);
    for (const s of Object.values(n.inputs)) if (s.connection) go(r.byId.get(s.connection.nodeId));
  };
  go(start);
  return seen;
}

const colourOf = (n: GraphNode | undefined): Vec3 | null => {
  if (!n) return null;
  if (n.type === 'colorPicker') return vec(n.params.color, [0.8, 0.8, 0.8]).map(round) as Vec3;
  if (n.type === 'makeVec3') return [round(num(n.params.r, 0)), round(num(n.params.g, 0)), round(num(n.params.b, 0))];
  return null;
};

const SOCKET_OUTPUT: Record<string, OutputShow> = { depth: 'depth', dist: 'distance', normal: 'normal', hit: 'hit', pos: 'position', iter: 'steps', ao: 'ao', shadow: 'shadow' };

/** The output the graph's Output shows, when it isn't the picture: its spec and the nodes it reads. */
function readOutput(r: Reader, output: GraphNode | undefined, renderer: GraphNode): { output: OutputSpec; read: string[] } | null {
  const first = output ? r.src(output, 'color') : undefined;
  if (!first) return null;
  // The builder's own chain: Palette / Color Ramp ← Expression Block carrying the output it shows.
  const chain = [first, ...(first.type === 'palette' ? [r.src(first, 'value')] : first.type === 'colorRamp' ? [r.src(first, 't')] : [])].filter((n): n is GraphNode => !!n);
  const block = chain.find(n => roleOf(n) === 'out:value' && n.params._sbOutput);
  if (block) {
    const o = block.params._sbOutput as OutputSpec;
    const read = chain.map(n => n.id);
    for (const k of Object.keys(block.inputs)) { const s = r.src(block, k); if (s && /^out:/.test(roleOf(s))) read.push(s.id); }
    return OUTPUT_BY_SHOW[o.show] ? { output: { ...o }, read } : null;
  }
  // By hand: the Output (or a Palette before it) wired straight to one of the loop's sockets.
  const direct = (n: GraphNode, key: string) => {
    const c = n.inputs[key]?.connection;
    return c && c.nodeId === renderer.id ? SOCKET_OUTPUT[c.outputKey] ?? null : null;
  };
  const show = output ? direct(output, 'color') : null;
  if (show) return { output: { show }, read: [] };
  if (first.type === 'palette') {
    const viaPalette = direct(first, 'value');
    const preset = Number(first.params.preset);
    const pal = PALETTES.find(p => p.kind === 'palette' && p.preset === preset);
    if (viaPalette) return { output: { show: viaPalette, palette: pal?.key ?? DEFAULT_PALETTE }, read: [first.id] };
  }
  return null;
}

/** What `nodes` (a graph's top level) draws in 3D, as a spec, or null when it has no march loop or glass scene. */
export function describeGraph(nodes: GraphNode[]): DescribeResult | null {
  const r = new Reader(nodes);
  const output = nodes.find(n => (n.type === 'output' || n.type === 'vec4Output') && n.inputs.color?.connection);
  const feeding = upstream(r, output);
  const renderers = nodes.filter(n => RENDERERS.has(n.type));
  const renderer = renderers.find(n => feeding.has(n.id)) ?? renderers[0];
  if (!renderer) return null;
  const spec = emptySpec();
  // What the Output shows: a builder output chain, or one of the loop's own sockets (maybe through a Palette).
  const shown = readOutput(r, output, renderer);
  if (shown) {
    spec.output = shown.output;
    for (const id of shown.read) r.read.add(id);
    // The picture's chain still sits beside it: read the lights and the look from there.
    const pictureEnd = nodes.find(n => roleOf(n) === 'tone') ?? nodes.find(n => roleOf(n) === 'compose');
    if (pictureEnd) for (const id of upstream(r, pictureEnd)) feeding.add(id);
  }
  const L = spec.look;
  const recognized: string[] = [];
  const mode = renderer.type === 'glassScene' ? 'glass' : renderer.type === 'giLitMarchGroup' ? 'gi' : renderer.params.volumetric ? 'volumetric' : 'surface';
  L.mode = mode;
  r.read.add(renderer.id);
  recognized.push(`${label(renderer)}: ${mode === 'surface' ? 'lit surfaces' : mode === 'gi' ? 'GI lighting' : mode === 'glass' ? 'glass' : 'volumetric glow'}`);

  // Camera.
  const cam = r.src(renderer, 'ro');
  if (cam?.type === 'marchCamera') {
    r.read.add(cam.id);
    const P = cam.params;
    spec.camera = {
      dist: round(num(P.camDist, 3)), angle: deg(num(P.camAngle, 0.6)), elev: deg(num(P.camElevation, 0.3)), orbit: deg(num(P.rotSpeed, 0)),
      zoom: round(num(P.fov, 1.5)), flatten: round(num(P.ortho, 0)), x: round(num(P.targetX, 0)), y: round(num(P.targetY, 0)), z: round(num(P.targetZ, 0)),
    };
    r.wiredParams(cam, ['camDist', 'camAngle', 'camElevation', 'rotSpeed', 'fov', 'target', 'targetX', 'targetY', 'targetZ'], 'March Camera');
    if (num(P.aperture, 0) > 0) r.unknown.push('March Camera\'s depth of field (Aperture) has no builder setting.');
    recognized.push('March Camera');
  } else r.unknown.push(cam ? `${label(cam)} makes the rays: not a March Camera, so the camera is the builder's default.` : 'Nothing is wired into the loop\'s Ray Origin.');

  // The scene (Glass: the glass and what is behind it).
  const sceneNode = r.src(renderer, renderer.type === 'glassScene' ? 'foreground' : 'scene');
  let meta: SceneBuilderMeta | null = null;
  if (sceneNode?.type === 'sceneGroup') {
    meta = (sceneNode.params[META_KEY] as SceneBuilderMeta | undefined) ?? null;
    spec.root = readScene(r, sceneNode, meta);
    if (mode === 'glass') {
      walkItems(spec.root, it => { if (it.type === 'shape') it.glass = true; });
      const behind = r.src(renderer, 'background');
      if (behind?.type === 'sceneGroup') {
        const back = readScene(r, behind);
        const bgCol = colourOf(r.src(renderer, 'bgAlbedo'));
        walkItems(back, it => { if (it.type === 'shape') { it.glass = false; if (bgCol) it.color = bgCol; } });
        // Both scenes side by side: the glass ones first.
        const fg = spec.root;
        spec.root = newGroup('g1', { name: 'Scene', children: [...(fg.op === 'union' && fg.k === 0 && !fg.warps.length ? fg.children : [fg]), ...(back.op === 'union' && back.k === 0 && !back.warps.length ? back.children : [back])] });
      }
    }
    let shapes = 0, groups = 0, warps = 0;
    walkItems(spec.root, it => { if (it.type === 'shape') shapes++; else groups++; warps += it.warps.length; });
    recognized.push(`${label(sceneNode)}: ${shapes} shape${shapes === 1 ? '' : 's'}, ${Math.max(0, groups - 1)} combine group${groups - 1 === 1 ? '' : 's'}, ${warps} warp${warps === 1 ? '' : 's'}`);
  } else r.unknown.push('No Scene Group is wired into the loop\'s Scene.');

  // The loop's body: warps there bend the whole scene; Volume Glow is the glow.
  if (renderer.type !== 'glassScene') {
    const body = subNodes(renderer);
    const br = new Reader(body);
    const out = body.find(n => n.type === 'marchLoopOutput');
    const chain: GraphNode[] = [];
    let at = out ? br.src(out, 'pos') : undefined;
    for (let g = 0; at && at.type !== 'marchLoopInputs' && g < 64; g++) {
      chain.unshift(at);
      const def = WARP_OF_TYPE.get(at.type);
      at = br.src(at, def?.posIn ?? Object.keys(at.inputs).find(k => at!.inputs[k].type === 'vec3') ?? 'pos');
    }
    if (chain.length) {
      const ws = chain.map(n => toWarp(br, n));
      spec.root.warps = [...ws, ...spec.root.warps];
      r.unknown.push(...br.unknown);
      recognized.push(`Loop body: ${ws.length} warp${ws.length === 1 ? '' : 's'} over the whole scene (the builder puts them in the Scene Group, so shadows see them too)`);
    }
    const glow = body.find(n => n.type === 'volumeGlow');
    if (glow && mode === 'volumetric') {
      L.glow.density = round(num(glow.params.density, 0.02)); L.glow.falloff = round(num(glow.params.falloff, 8)); L.glow.shell = round(num(glow.params.shell, 0));
      recognized.push('Volume Glow');
    }
    const P = renderer.params;
    spec.quality = {
      steps: Math.round(num(P.maxSteps, 80)), maxDist: round(num(P.maxDist, 20)), stepScale: round(num(P.stepScale, 1)), jitter: round(num(P.jitter, 1)),
      ...(P.warpSafety === 'auto' || P.warpSafety === 'careful' || P.warpSafety === 'high' ? { warp: P.warpSafety } : {}),
    };
    L.bg = vec(P.bg, [0, 0, 0]).map(round) as Vec3;
  }

  // Lighting and finishing, read wherever they are.
  const byType = (t: string) => nodes.filter(n => n.type === t && feeding.has(n.id));
  const one = (t: string) => byType(t)[0];
  const multi = one('multiLight');
  const sunNode = (n: GraphNode | undefined, key: string) => { const s = n ? r.src(n, key) : undefined; return s?.type === 'makeVec3' ? s : undefined; };
  if (mode === 'surface') {
    if (multi) {
      r.read.add(multi.id);
      const P = multi.params;
      L.sunDir = [round(num(P.sunDirX, 0.6)), round(num(P.sunDirY, 0.7)), round(num(P.sunDirZ, 0.4))];
      const sn = sunNode(multi, 'sunDir');
      if (sn) { L.sunDir = colourOf(sn)!; r.read.add(sn.id); }
      L.sunColor = [round(num(P.sunR, 1)), round(num(P.sunG, 0.9)), round(num(P.sunB, 0.7))];
      L.sky = [round(num(P.skyR, 0.3)), round(num(P.skyG, 0.5)), round(num(P.skyB, 0.7))];
      L.bounce = [round(num(P.bounceR, 0.1)), round(num(P.bounceG, 0.1)), round(num(P.bounceB, 0.08))];
      recognized.push('Multi-Light (sun, sky, bounce)');
      const base = r.src(multi, 'baseColor');
      const c = colourOf(base);
      if (c) { walkItems(spec.root, it => { if (it.type === 'shape') it.color = c; }); r.read.add(base!.id); }
      else if (base?.type === 'group' && roleOf(base) === 'materials') {
        r.read.add(base.id);
        for (const n of subNodes(base)) {
          const m = /^mat:(s\d+):\1:(color|shine)$/.exec(roleOf(n));
          if (!m) continue;
          walkItems(spec.root, it => {
            if (it.type !== 'shape' || it.id !== m[1]) return;
            if (m[2] === 'color') it.color = colourOf(n) ?? it.color; else it.shine = round(num(n.params.value, 0));
          });
        }
        recognized.push('Materials (a colour per shape)');
      } else if (base) r.unknown.push(`${label(base)} colours the surface: not read (the shapes keep the default colour).`);
    } else {
      L.shadows = 0; L.ao = 0;
      r.unknown.push('The picture is the loop\'s own simple shading (no Multi-Light); the builder lights it with its sun, sky and bounce.');
      const c = vec(renderer.params.albedo, [0.6, 0.7, 0.9]).map(round) as Vec3;
      walkItems(spec.root, it => { if (it.type === 'shape') it.color = c; });
    }
    const sh = one('softShadow');
    L.shadows = sh ? round(num(sh.params.k, 16)) : 0;
    if (sh) { r.read.add(sh.id); recognized.push('Soft Shadow'); }
    const ao = one('sdfAo');
    L.ao = ao ? round(num(ao.params.stepDist, 0.05)) : 0;
    if (ao) { r.read.add(ao.id); recognized.push('SDF Ambient Occlusion'); }
    const hl = nodes.find(n => n.type === 'exprNode' && roleOf(n) === 'shine');
    if (hl && typeof hl.params.shine === 'number') walkItems(spec.root, it => { if (it.type === 'shape') it.shine = round(hl.params.shine as number); });
    for (const t of ['blinnPhong', 'exprNode']) for (const n of byType(t)) if (roleOf(n) === 'spec' || roleOf(n) === 'shine') r.read.add(n.id);
  } else if (mode === 'gi') {
    const P = renderer.params;
    const c = vec(P.albedo, [0.7, 0.7, 0.7]).map(round) as Vec3;
    walkItems(spec.root, it => { if (it.type === 'shape') it.color = c; });
    L.gi = { strength: round(num(P.giStrength, 0.4)), metal: round(num(P.metallic, 0)), rough: round(num(P.roughness, 0.5)), spec: round(num(P.specStrength, 0.5)) };
    L.sunColor = [round(num(P.lightR, 1)), round(num(P.lightG, 0.95)), round(num(P.lightB, 0.85))];
    L.sky = [round(num(P.skyTopR, 0.2)), round(num(P.skyTopG, 0.45)), round(num(P.skyTopB, 0.8))];
    L.bounce = [round(num(P.skyBotR, 0.55) / 4), round(num(P.skyBotG, 0.5) / 4), round(num(P.skyBotB, 0.4) / 4)];
    const sn = sunNode(renderer, 'lightDir');
    if (sn) { L.sunDir = colourOf(sn)!; r.read.add(sn.id); }
    else L.sunDir = [round(num(P.lightX, 1.5)), round(num(P.lightY, 3)), round(num(P.lightZ, 1))];
  } else if (mode === 'glass') {
    const P = renderer.params;
    L.glass = { ior: round(num(P.ior, 1.5)), dispersion: round(num(P.dispersion, 0.06)), tint: colourOf(r.src(renderer, 'tintColor')) ?? [1, 1, 1] };
    const sn = sunNode(renderer, 'lightDir');
    if (sn) { L.sunDir = colourOf(sn)!; r.read.add(sn.id); }
    for (const k of ['tintColor', 'bgAlbedo']) { const s = r.src(renderer, k); if (s) r.read.add(s.id); }
  } else {
    const g2c = byType('glowToColor')[0];
    if (g2c) {
      r.read.add(g2c.id);
      L.glow.exposure = round(num(g2c.params.exposure, 1)); L.glow.tint = vec(g2c.params.tint, [1, 0.6, 0.3]).map(round) as Vec3;
      recognized.push('Glow to Color');
    }
  }
  // Fog, background, tone.
  const fog = one('volumetricFog');
  if (fog) {
    r.read.add(fog.id);
    L.fog = round(num(fog.params.density, 0.5));
    L.fogColor = [round(num(fog.params.fogR, 0.7)), round(num(fog.params.fogG, 0.8)), round(num(fog.params.fogB, 0.9))];
    recognized.push('Volumetric Fog');
  }
  const compose = nodes.find(n => roleOf(n) === 'compose') ?? byType('mix').find(n => r.src(n, 't')?.id === renderer.id);
  const bgSrc = compose ? r.src(compose, 'a') : undefined;
  if (compose) r.read.add(compose.id);
  if (bgSrc?.type === 'exprNode' && roleOf(bgSrc) === 'bg') {
    const top = colourOf(r.src(bgSrc, 'top')), bottom = colourOf(r.src(bgSrc, 'bottom'));
    if (top) L.bg = top;
    L.bg2 = bottom;
    r.read.add(bgSrc.id);
    for (const k of ['top', 'bottom']) { const s = r.src(bgSrc, k); if (s) r.read.add(s.id); }
  } else if (colourOf(bgSrc)) { L.bg = colourOf(bgSrc)!; r.read.add(bgSrc!.id); }
  if (L.fogColor && L.fogColor.every((v, i) => v === L.bg[i])) L.fogColor = null;
  const tone = one('toneMap');
  L.tone = tone ? (String(tone.params.mode ?? 'aces') as SceneSpec['look']['tone']) : 'none';
  if (tone) { r.read.add(tone.id); recognized.push(`Tone Map (${L.tone})`); }
  // Settings the graph doesn't have in this mode keep the builder's defaults.
  if (mode !== 'surface') { L.shadows = DEFAULT_LOOK.shadows; L.ao = DEFAULT_LOOK.ao; }
  if (mode === 'glass') spec.quality = { ...spec.quality, ...emptySpec().quality };
  // Group names from the builder's notes on combines are read above; finally tidy the tree.
  spec.root = collapseGroups(spec.root);
  if (spec.quality.stepScale === autoStepScale(spec)) spec.quality.stepScale = 'auto';

  // What else feeds the picture.
  const known = new Set(['output', 'vec4Output', 'uv', 'time', 'colorPicker', 'makeVec3', 'mix', 'add', 'exprNode', 'blinnPhong', 'group', 'constant']);
  for (const id of feeding) {
    const n = r.byId.get(id)!;
    if (r.read.has(id) || known.has(n.type) && roleOf(n)) continue;
    if (n.type === 'output' || n.type === 'vec4Output' || n.type === 'uv' || n.type === 'time') continue;
    r.unknown.push(`${label(n)} (after the loop) has no builder setting.`);
  }
  const rr = r as Reader & { innerRead?: number; innerTotal?: number };
  const total = feeding.size + (rr.innerTotal ?? 0) - [...feeding].filter(id => ['output', 'vec4Output', 'uv', 'time'].includes(r.byId.get(id)!.type)).length;
  const read = r.read.size + (rr.innerRead ?? 0);
  return {
    spec, recipe: printRecipe(spec, { multiline: true }), recognized, unknown: [...new Set(r.unknown)],
    coverage: { read: Math.min(read, total), total },
    sceneId: sceneNode?.type === 'sceneGroup' ? sceneNode.id : null, rendererId: renderer.id, builderMade: !!meta,
  };
}
