/**
 * build.ts — a Scene Builder spec as a real node graph (docs/scene-builder-3d.md).
 *
 * The graph is what a skilled user would wire by hand:
 *
 *   March Camera ──► March Loop / GI Lit March / Glass Scene ──► lighting ──► Tone Map ──► Output
 *   Scene Group ───┘      (Scene Pos → warps → moves / turns → shapes → combines → Scene Output)
 *
 * Every node gets a plain-language note (`__comment`) and a role (`_sbRole`):
 * a stable name for the part of the spec it comes from (`s2:at` is shape s2's
 * Move, `light` the Multi-Light), so a rebuild can find the node again, keep
 * its id (Play controls stay pointed at it) and carry the user's own edits
 * over. Numbers go on params, which compile to live uniforms: dragging a
 * generated slider never recompiles.
 *
 * Pure: ids come from `idFor`, positions from the layout here.
 */
import type { GraphNode, InputSocket, OutputSocket, SubgraphData } from '../types/nodeGraph';
import { GROUP_PORT_SENTINEL } from '../types/nodeGraph';
import { getNodeDefinition } from '../nodes/definitions';
import { startingSockets } from '../nodes/definitions/transformAny';
import { estimateNodeHeight, layoutByRank } from '../store/graphLayout';
import {
  MAX_TEX_SHAPES, REVERSE_DEFAULTS, texturesUsed3D, SHAPE_BY_KIND, TEX_MAP_LABELS, TEX_SHARP_DEFAULT, WARP_BY_KIND, allShapes, effectiveStepScale, filterTree, itemName, num, opLabel, stepHints,
  type GroupSpec, type SceneItem, type SceneSpec, type ShapeSpec, type Vec3, type WarpSpec,
} from './spec';
import { LUMA, findTex, fitLines, glf, picUv, sampleWrap, standInId, standIns } from '../builders/textures';
import { fmt } from './recipe';
import { OUTPUT_BY_SHOW, PALETTE_BY_KEY, isPicture, outputClause, outputProblem, type OutputSpec } from './output';

export const ROLE_KEY = '_sbRole';
/** On the Scene Group: the spec it was built from (and, once applied, fingerprints of what was built). */
export const META_KEY = 'sceneBuilder';

export interface SceneBuilderMeta {
  v: 1;
  spec: SceneSpec;
  /** role → fingerprint of the node as built (params and wires), to tell the user's edits apart. */
  built?: Record<string, string>;
}

export interface BuildResult {
  nodes: GraphNode[];
  /** The node whose colour is the picture (what Output shows). */
  final: { nodeId: string; outputKey: string };
  sceneId: string;
  warnings: string[];
}

export type Ref = { nodeId: string; outputKey: string };

const rad = (deg: number) => Math.round(deg * Math.PI / 180 * 1e6) / 1e6;
const v3 = (v: Vec3) => `(${v.map(fmt).join(', ')})`;

export interface Ctx {
  spec: SceneSpec;
  idFor: (role: string) => string;
  /** Prepended to every role made in this scope (the Materials group's copies of the shapes). */
  rolePrefix?: string;
  nodes: GraphNode[];
  warnings: string[];
  /** Picture balls built in this scope, whose Picture comes in through a port of the group round them. */
  balls?: Array<{ node: GraphNode; sh: ShapeSpec }>;
}

/** Picture balls' node params beyond the catalogue's: their own grid, and the picture's shape. */
function ballsExtra(ctx: Ctx, sh: ShapeSpec): Record<string, unknown> {
  const src = sh.tex ? findTex(ctx.spec.textures, sh.tex.tex) : undefined;
  return { layout: 'own', aspect: src?.aspect ?? 1.5 };
}

/**
 * The group ports that bring each picture-balls shape's picture in (a Picture port per shape, wired
 * from the picture's node outside): Scene Groups map a port to its node (toNodeId), plain groups read
 * it through the port sentinel.
 */
function ballsPorts(ctx: Ctx, list: Array<{ node: GraphNode; sh: ShapeSpec }>, sentinel: boolean): { ports: SubgraphData['inputPorts']; inputs: Record<string, InputSocket> } {
  const ports: SubgraphData['inputPorts'] = [];
  const inputs: Record<string, InputSocket> = {};
  for (const { node, sh } of list) {
    const src = sh.tex ? findTex(ctx.spec.textures, sh.tex.tex) : undefined;
    if (!src) continue;
    const key = `pic_${sh.id}`;
    const label = `Picture for ${itemName(ctx.spec, sh)}`;
    ports.push({ key, type: 'texture', label, toNodeId: node.id, toInputKey: 'picture' });
    inputs[key] = { type: 'texture', label, connection: { nodeId: standInId(src), outputKey: 'texture' } };
    if (sentinel) node.inputs.picture = { ...node.inputs.picture, connection: { nodeId: GROUP_PORT_SENTINEL, outputKey: key } };
  }
  return { ports, inputs };
}

/** A node of `type` from its definition: sockets as defined, params = defaults + `params`, wires and note. */
export function mk(ctx: Ctx, type: string, role: string, params: Record<string, unknown>, wires: Record<string, Ref | null | undefined>, note: string, list = ctx.nodes): GraphNode {
  const def = getNodeDefinition(type);
  if (!def) throw new Error(`Scene Builder: unknown node type ${type}`);
  // A Transform's sockets follow its Dimension (transformAny.ts).
  const sockets = startingSockets(type, def, { ...(def.defaultParams ?? {}), ...params });
  const inputs: Record<string, InputSocket> = {};
  for (const [k, s] of Object.entries(sockets.inputs)) {
    const w = wires[k];
    inputs[k] = { type: s.type, label: s.label, ...(w ? { connection: { ...w } } : {}) };
  }
  const outputs: Record<string, OutputSocket> = {};
  for (const [k, s] of Object.entries(sockets.outputs)) outputs[k] = { type: s.type, label: s.label };
  const full = (ctx.rolePrefix ?? '') + role;
  const node: GraphNode = {
    id: ctx.idFor(full), type, position: { x: 0, y: 0 }, inputs, outputs,
    params: { ...(def.defaultParams ?? {}), ...params, __comment: note, [ROLE_KEY]: full },
  };
  list.push(node);
  return node;
}

export const ref = (n: GraphNode, outputKey: string): Ref => ({ nodeId: n.id, outputKey });

/** A vec3 Mix / Add (the arithmetic nodes carry their vector type in params.outputType and on their sockets). */
export function vecMath(ctx: Ctx, type: 'mix' | 'add', role: string, a: Ref, b: Ref, t: Ref | null, note: string, list = ctx.nodes): GraphNode {
  const n = mk(ctx, type, role, { outputType: 'vec3' }, type === 'mix' ? { a, b, t } : { a, b }, note, list);
  for (const k of ['a', 'b']) n.inputs[k] = { ...n.inputs[k], type: 'vec3' };
  for (const k of Object.keys(n.outputs)) n.outputs[k] = { ...n.outputs[k], type: 'vec3' };
  return n;
}

export type ExprInput = { name: string; type: 'float' | 'vec3'; from?: Ref; slider?: { value: number; min: number; max: number } };

/** An Expression Block with typed inputs (wired, or a float slider) and a vec3 (or float) result. */
export function exprBlock(ctx: Ctx, role: string, label: string, inputs: ExprInput[], result: string, note: string, list = ctx.nodes, outputType: 'vec3' | 'float' = 'vec3'): GraphNode {
  const node: GraphNode = {
    id: ctx.idFor(role), type: 'exprNode', position: { x: 0, y: 0 },
    inputs: Object.fromEntries(inputs.map(i => [i.name, { type: i.type, label: i.name, ...(i.from ? { connection: { ...i.from } } : {}) }])),
    outputs: { result: { type: outputType, label: 'Result' } },
    params: {
      label, outputType, lines: [], result, expr: result,
      inputs: inputs.map(i => ({ name: i.name, type: i.type, slider: i.slider ? { min: i.slider.min, max: i.slider.max } : null })),
      ...Object.fromEntries(inputs.filter(i => i.slider).map(i => [i.name, i.slider!.value])),
      __comment: note, [ROLE_KEY]: role,
    },
  };
  list.push(node);
  return node;
}

// ── The shapes ──────────────────────────────────────────────────────────────

/** A warp's node params from its values (degrees to radians, axis letters to switches). */
export function warpParams(w: WarpSpec): Record<string, unknown> {
  const def = WARP_BY_KIND[w.kind];
  const out: Record<string, unknown> = {};
  for (const p of def.params) {
    if (!p.param) continue;
    const v = w.values[p.key];
    if (Array.isArray(p.param)) {
      const arr = Array.isArray(v) ? v : [Number(v ?? 0), Number(v ?? 0), Number(v ?? 0)];
      p.param.forEach((k, i) => { out[k] = arr[i]; });
    } else if (typeof v === 'number') out[p.param] = p.deg ? rad(v) : v;
  }
  if (def.axes?.kind === 'flags') {
    const letters = String(w.values[def.axes.key] ?? def.axes.def);
    def.axes.params.forEach((k, i) => { out[k] = letters.includes('xyz'[i]); });
  } else if (def.axes) out[def.axes.param] = String(w.values[def.axes.key] ?? def.axes.def);
  if (def.select) {
    const v = String(w.values[def.select.key] ?? def.select.def);
    // Kaleidoscope's folds are a select of strings.
    out[def.select.param] = v;
  }
  if (w.kind === 'kaleido') out.iterations = String(Math.round(Number(w.values.n ?? 3)));
  // Scale 3D multiplies the point: growing by s is a point shrunk by 1/s (and the distance grown by s).
  if (w.kind === 'scale') out.scale = scaleParam(w);
  // Offset adds to the distance: rounding by r is an offset of -r.
  if (w.kind === 'round') out.amount = -num(w.values.r, 0.05);
  return out;
}

export const scaleParam = (w: WarpSpec) => Math.round(1e6 / Math.max(0.001, num(w.values.s, 1.5))) / 1e6;

function warpNote(ctx: Ctx, w: WarpSpec, on: string): string {
  const def = WARP_BY_KIND[w.kind];
  const hint = def.stepHint(w);
  const vals = def.params.map(p => {
    const v = w.values[p.key];
    return `${p.label} ${Array.isArray(v) ? v3(v as Vec3) : fmt(Number(v))}${p.deg || w.kind === 'rotate' ? '°' : ''}`;
  });
  if (def.axes) vals.unshift(`${def.axes.label} ${w.values[def.axes.key]}`);
  const step = hint < 1 ? ` It stretches space, so the march takes smaller steps (it asks for Step Scale ${fmt(hint)}; the loop uses ${fmt(effectiveStepScale(ctx.spec))}).` : '';
  const how = w.kind === 'round' ? ` An Offset of ${fmt(-num(w.values.r, 0.05))} on the distance: the surface moves out and its edges round off.`
    : w.kind === 'onion' ? ' abs(distance) − thickness: only a skin is left.'
    : '';
  return `${def.label} on ${on}: ${def.blurb}${vals.length ? ` ${vals.join(', ')}.` : ''}${how}${step}`;
}

/** What happens to an item's distance once it exists (a modifier, or Scale's correction), with the point it reads. */
type DistStep = { w: WarpSpec; pos: Ref };

/**
 * An item's stack from `pos`, in order: warps, moves and turns bend the point; modifiers (and
 * Scale's correction) are kept for after the distance exists (emitModifiers).
 */
function emitWarps(ctx: Ctx, warps: WarpSpec[], pos: Ref, on: string, list: GraphNode[]): { pos: Ref; modifiers: DistStep[] } {
  const modifiers: DistStep[] = [];
  for (const w of warps) {
    const def = WARP_BY_KIND[w.kind];
    if (!def) { ctx.warnings.push(`${on}: “${w.label ?? w.kind}” can't be built (it was a custom part); left out.`); continue; }
    if (def.modifier) { modifiers.push({ w, pos }); continue; }
    // Move, Turn, Rotate and Scale are one Transform each (docs/transform-node.md); _sbKind says which.
    const trf = transformWarp(w);
    if (trf) {
      const n = mk(ctx, 'transform', `${w.id}`, { dim: '3', ...trf.params, [WARP_KIND_KEY]: w.kind }, { p: pos }, `${warpNote(ctx, w, on)} ${trf.how}`, list);
      pos = ref(n, 'p');
      if (def.distStep) modifiers.push({ w, pos });
      continue;
    }
    const n = mk(ctx, def.type, `${w.id}`, warpParams(w), { [def.posIn]: pos }, warpNote(ctx, w, on), list);
    pos = ref(n, def.posOut);
    if (def.distStep) modifiers.push({ w, pos });
  }
  return { pos, modifiers };
}

/** The Scene Builder warp a Transform stands for (Move, Turn, Rotate, Scale), on the node: recognize.ts reads it back. */
export const WARP_KIND_KEY = '_sbKind';

/** A Move / Turn / Rotate / Scale warp as a 3D Transform's settings, with a sentence on what it does. Null for other warps. */
export function transformWarp(w: WarpSpec): { params: Record<string, unknown>; how: string } | null {
  const v3of = (x: unknown) => (Array.isArray(x) ? x : [0, 0, 0]) as Vec3;
  if (w.kind === 'move') {
    const by = v3of(w.values.by);
    return { params: { x: by[0], y: by[1], z: by[2] }, how: `A Transform: Move ${v3(by)}.` };
  }
  if (w.kind === 'rotate') {
    // Like a shape's Rotation: X, then Y, then Z.
    const by = v3of(w.values.by);
    return { params: { rx: by[0], ry: by[1], rz: by[2] }, how: `A Transform: Rotate ${v3(by)}° (X, then Y, then Z).` };
  }
  if (w.kind === 'turn') {
    // Turn moves the point about the axis (Apply mode), as Rotate 3D did.
    const axis = String(w.values.axis ?? 'y');
    const deg = num(w.values.angle, 0);
    return { params: { mode: 'space', [`r${['x', 'y', 'z'].includes(axis) ? axis : 'y'}`]: deg }, how: `A Transform in Apply mode: turns the point ${fmt(deg)}° about ${axis.toUpperCase()}.` };
  }
  if (w.kind === 'scale') {
    const s = num(w.values.s, 1.5);
    return { params: { scale: s }, how: `A Transform: Scale ${fmt(s)} divides the point by ${fmt(s)}, which grows what it measures; a second Transform after the distance multiplies it back so the march stays exact.` };
  }
  return null;
}

/** The distance steps, innermost (the last in the stack) first: a stack reads outside in, like the recipe. */
function emitModifiers(ctx: Ctx, mods: DistStep[], dist: Ref, on: string, list: GraphNode[]): Ref {
  for (const { w, pos } of [...mods].reverse()) {
    const def = WARP_BY_KIND[w.kind];
    const step = def.distStep!;
    const role = def.modifier ? w.id : `${w.id}:dist`;
    if (w.kind === 'scale') {
      // Scale's distance half: a second Transform with the same Scale, the distance through its Distance sockets.
      const n = mk(ctx, 'transform', role, { dim: '3', scale: num(w.values.s, 1.5), [WARP_KIND_KEY]: 'scale' }, { dist },
        `Scale on ${on}, the distance half: multiplies the distance by its Scale ${fmt(num(w.values.s, 1.5))}, so it is in the scene's units again. Keep its Scale equal to the first Transform's.`, list);
      dist = ref(n, 'dist');
      continue;
    }
    const n = mk(ctx, step.type, role, warpParams(w), { [step.distIn]: dist, ...(step.posIn ? { [step.posIn]: pos } : {}) }, warpNote(ctx, w, on), list);
    dist = ref(n, step.distOut);
  }
  return dist;
}

function shapeSummary(sh: ShapeSpec): string {
  const def = SHAPE_BY_KIND[sh.kind];
  return def.params.filter(p => p.param !== '' && !(p.key === 'round' && !sh.size.round)).map(p => {
    const v = sh.size[p.key];
    return `${p.label.toLowerCase()} ${Array.isArray(v) ? v3(v as Vec3) : fmt(Number(v))}${p.deg ? '°' : ''}`;
  }).join(', ');
}

/**
 * Scene Pos (or any point) → this shape's warps, move, turns → the shape → its distance. `local`
 * gets the point as the shape sees it (after them): where a picture on it is read.
 */
function emitShape(ctx: Ctx, sh: ShapeSpec, pos: Ref, list: GraphNode[], local?: Map<string, Ref>): Ref | null {
  const name = `‘${itemName(ctx.spec, sh)}’`;
  if (sh.kind === 'custom') { ctx.warnings.push(`custom(${sh.label ?? ''}) can't be built: it stands for nodes the builder doesn't know. Left out.`); return null; }
  const def = SHAPE_BY_KIND[sh.kind];
  const warped = emitWarps(ctx, sh.warps, pos, name, list);
  pos = warped.pos;
  // Where the shape is and how it is turned: one Transform (Move, then Rotate X, then Y, then Z).
  if (sh.at.some(v => v !== 0) || sh.rot.some(v => v !== 0)) {
    const bits = [
      ...(sh.at.some(v => v !== 0) ? [`moves ${name} to ${v3(sh.at)}`] : []),
      ...(sh.rot.some(v => v !== 0) ? [`turns it ${v3(sh.rot)}° (about X, then Y, then Z)`] : []),
    ];
    const n = mk(ctx, 'transform', `${sh.id}:at`, { dim: '3', x: sh.at[0], y: sh.at[1], z: sh.at[2], rx: sh.rot[0], ry: sh.rot[1], rz: sh.rot[2] }, { p: pos },
      `Places ${name}: ${bits.join(' and ')}. A shape is measured in its own space, so the point is moved and turned the other way first: that puts the shape there.`, list);
    pos = ref(n, 'p');
  }
  local?.set(sh.id, pos);
  const rounded = def.roundType && Number(sh.size.round ?? 0) > 0;
  const params: Record<string, unknown> = {};
  for (const p of def.params) {
    if (!p.param) continue;
    if (p.key === 'round' && !rounded) continue;
    const v = sh.size[p.key] ?? p.def;
    if (Array.isArray(p.param)) {
      const arr = Array.isArray(v) ? v : [Number(v), Number(v), Number(v)];
      p.param.forEach((k, i) => { params[k] = arr[i]; });
    } else params[p.param] = p.deg ? rad(Number(v)) : Number(v);
  }
  // Rounded Cylinder's Radius is half the cylinder's (its formula doubles it): keep r the outer radius.
  if (rounded && def.roundType === 'roundedCylinderSDF3D') params.radius = Number(params.radius) / 2;
  const colourWord = ctx.spec.look.mode === 'surface' && allShapes(ctx.spec).length > 1 ? ` Its colour ${v3(sh.color)} is picked in Materials.` : '';
  // A 4D shape: the point is lifted to 4D at the slice W and turned in xw first (docs/4d.md).
  let shapePos = pos;
  if (def.fourD) {
    const w = Number(sh.size.w ?? 0), spin = Number(sh.size.spin ?? 0);
    const lift = mk(ctx, 'lift4D', `${sh.id}:lift`, { w, sliceDir: def.fourD.slice }, { pos },
      `Lifts the 3D point to 4D for ${name}: (x, y, z) becomes a 4D point on the slice at W ${fmt(w)}, cut ${def.fourD.slice}-first. Move W to sweep the slice through the 4D shape.`, list);
    shapePos = ref(lift, 'p4');
    if (spin) {
      const turn = mk(ctx, 'rotate4D', `${sh.id}:turn4`, { plane: 'xw', angle: 0, spin }, { p4: shapePos },
        `Turns ${name} in the xw plane, ${fmt(spin)}° a second: a turn into the fourth axis, so its 3D slice morphs.`, list);
      shapePos = ref(turn, 'p4');
    }
  }
  const isBalls = sh.kind === 'picture-balls';
  const node = mk(ctx, rounded ? def.roundType! : def.type, sh.id, { ...params, ...(isBalls ? ballsExtra(ctx, sh) : {}), _sbName: sh.name },
    { [def.posKey]: shapePos }, `${name}: a ${def.label.toLowerCase()}${shapeSummary(sh) ? `, ${shapeSummary(sh)}` : ''}. ${def.blurb}${colourWord}${isBalls ? ` Its picture comes in through the group's “Picture for ${itemName(ctx.spec, sh)}” port.` : ''}`, list);
  if (isBalls) {
    if (sh.tex) ctx.balls?.push({ node, sh });
    else ctx.warnings.push(`${name} has no picture: give it one under its Picture (texture=), or its balls are a colour gradient, all at one depth.`);
  }
  let dist = ref(node, def.distKey);
  if (def.field) {
    const ball = Number(sh.size.ball ?? 1.1);
    if (ball > 0) {
      const b = mk(ctx, 'sphereSDF3D', `${sh.id}:ball`, { radius: ball }, { pos },
        `The ball ${name} is cut to. A ${def.label} fills all of space, so the camera would be inside it; this keeps a ball of radius ${fmt(ball)} of it. Set Ball radius to 0 in the builder to fill the scene.`, list);
      const cut = mk(ctx, 'sdfIntersect', `${sh.id}:cut`, {}, { a: dist, b: ref(b, 'dist') },
        `Keeps only the part of ${name} inside its ball: the scene is where both are.`, list);
      dist = ref(cut, 'dist');
    }
  }
  return emitModifiers(ctx, warped.modifiers, dist, name, list);
}

function opNote(g: GroupSpec, a: string, b: string): string {
  const k = g.k > 0 ? ` Blend radius ${fmt(g.k)} is how wide the join is.` : '';
  if (g.op === 'union') return g.k > 0 ? `Melts ${a} and ${b} together like putty.${k}` : `Joins ${a} and ${b}: wherever is nearer wins.`;
  if (g.op === 'subtract') return g.k > 0 ? `Cuts ${b} out of ${a} with a softened edge.${k}` : `Cuts ${b} out of ${a}.`;
  return g.k > 0 ? `Keeps only where ${a} and ${b} overlap, with a rounded crease.${k}` : `Keeps only where ${a} and ${b} overlap.`;
}

const TYPE_OF_OP = { union: 'sdfUnion', subtract: 'sdfSubtract', intersect: 'sdfIntersect' } as const;

function emitItem(ctx: Ctx, it: SceneItem, pos: Ref, list: GraphNode[]): Ref | null {
  if (it.type === 'shape') return emitShape(ctx, it, pos, list);
  const name = it.id === ctx.spec.root.id ? 'the whole scene' : `‘${itemName(ctx.spec, it)}’`;
  const warped = emitWarps(ctx, it.warps, pos, name, list);
  const parts = it.children.map(c => ({ c, d: emitItem(ctx, c, warped.pos, list) })).filter((x): x is { c: SceneItem; d: Ref } => x.d !== null);
  if (!parts.length) return null;
  let dist = parts[0].d;
  const names = parts.map(x => `‘${itemName(ctx.spec, x.c)}’`);
  const join = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}` : xs[0]);
  parts.slice(1).forEach(({ d }, i) => {
    const n = mk(ctx, TYPE_OF_OP[it.op], `${it.id}:op${i + 1}`, { k: it.k, ...(i === 0 && it.name ? { _sbName: it.name } : {}) }, { a: dist, b: d },
      `${opLabel(it)}${it.name ? ` (‘${it.name}’)` : ''}: ${opNote(it, join(names.slice(0, i + 1)), names[i + 1])}`, list);
    dist = ref(n, 'dist');
  });
  return emitModifiers(ctx, warped.modifiers, dist, name, list);
}

/** A Scene Group holding `root`: Scene Pos → … → Scene Output, laid out in columns. */
function sceneGroup(ctx: Ctx, role: string, root: GroupSpec, label: string, note: string): GraphNode {
  const inner: GraphNode[] = [];
  const scope: Ctx = { ...ctx, balls: [] };
  const sp = mk(scope, 'scenePos', `${role}:pos`, { _groupOriginal: true }, {}, 'The point being measured. The march asks the scene "how far is the nearest surface from here?" many times per pixel, moving this point along the ray.', inner);
  const dist = emitItem(scope, root, ref(sp, 'pos'), inner);
  mk(scope, 'sceneOutput', `${role}:out`, { _groupOriginal: true }, { dist }, 'The scene\'s answer: the distance from the point to the nearest surface.', inner);
  tidy(inner, 0, 120);
  const pics = ballsPorts(ctx, scope.balls!, false);
  const sub: SubgraphData = { nodes: inner, inputPorts: pics.ports, outputPorts: [] };
  const g = mk(ctx, 'sceneGroup', role, { label, subgraph: sub }, {}, note);
  g.inputs = { ...g.inputs, ...pics.inputs };
  return g;
}

// ── Materials (surface mode, more than one colour) ──────────────────────────

/** The warps from the root down to an item (each group's, in order), for measuring one shape on its own. */
function pathWarps(spec: SceneSpec, target: ShapeSpec): Array<{ warps: WarpSpec[]; on: string }> {
  const out: Array<{ warps: WarpSpec[]; on: string }> = [];
  const go = (g: GroupSpec): boolean => {
    out.push({ warps: g.warps, on: g.id === spec.root.id ? 'the whole scene' : `‘${itemName(spec, g)}’` });
    for (const c of g.children) {
      if (c === target) return true;
      if (c.type === 'group' && go(c)) return true;
    }
    out.pop();
    return false;
  };
  go(spec.root);
  return out;
}

/** The nodes of `nodes` that `roots` read, directly or through others (by their wires). */
function reachableFrom(nodes: GraphNode[], roots: string[]): Set<string> {
  const byId = new Map(nodes.map(n => [n.id, n]));
  const seen = new Set<string>();
  const stack = [...roots];
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id) || !byId.has(id)) continue;
    seen.add(id);
    for (const sock of Object.values(byId.get(id)!.inputs)) if (sock.connection) stack.push(sock.connection.nodeId);
  }
  return seen;
}

function materialsGroup(ctx: Ctx, shapes: ShapeSpec[], hitPos: Ref, texShapes: ShapeSpec[] = []): GraphNode {
  const inner: GraphNode[] = [];
  const matBalls: Array<{ node: GraphNode; sh: ShapeSpec }> = [];
  // Inside the group the hit point arrives through the port.
  const port: Ref = { nodeId: GROUP_PORT_SENTINEL, outputKey: 'hitPos' };
  let colour: Ref | null = null, shine: Ref | null = null, dist: Ref | null = null;
  const anyShine = shapes.some(s => s.shine > 0);
  // Pictures: each painted shape's own point (where its picture is read) and which one is nearest (a slot per channel).
  const local = new Map<string, Ref>();
  const texPos: Ref[] = [];
  let slots: Ref | null = null;
  for (const sh0 of shapes) {
    const sh = sh0;
    // Each shape is measured on its own here, so the warps it shares with others are made once per shape.
    const scope: Ctx = { ...ctx, rolePrefix: `mat:${sh.id}:`, balls: matBalls };
    let pos = port;
    for (const step of pathWarps(ctx.spec, sh)) {
      const w = emitWarps(scope, step.warps.filter(x => !WARP_BY_KIND[x.kind]?.modifier), pos, step.on, inner);
      pos = w.pos;
    }
    const d = emitShape(scope, { ...sh, warps: sh.warps }, pos, inner, local);
    if (!d) continue;
    const name = `‘${itemName(ctx.spec, sh)}’`;
    const c = mk(scope, 'colorPicker', `${sh.id}:color`, { color: [...sh.color] }, {}, `${name}'s colour.`, inner);
    const slot = texShapes.indexOf(sh);
    let own: Ref | null = null;
    if (texShapes.length) {
      const e: Vec3 = [slot === 0 ? 1 : 0, slot === 1 ? 1 : 0, slot === 2 ? 1 : 0];
      own = ref(mk(scope, 'colorPicker', `${sh.id}:texslot`, { color: e }, {}, slot >= 0
        ? `${name}'s picture slot: ${'xyz'[slot]} (${['red', 'green', 'blue'][slot]}) is 1 where ${name} is the nearest surface, so its picture is painted only there.`
        : `${name} has no picture: 0 in every slot.`, inner), 'rgb');
      if (slot >= 0) {
        let lp = local.get(sh.id) ?? port;
        // The group's output needs a node to come from: the hit point as it is, through a block.
        if (lp.nodeId === GROUP_PORT_SENTINEL) lp = ref(exprBlock(scope, `${sh.id}:local`, 'Own point', [{ name: 'p', type: 'vec3', from: lp }], 'p', `The point as ${name} sees it (it has no move or warp of its own): where its picture is read.`, inner), 'result');
        texPos[slot] = lp;
      }
    }
    if (!colour || !dist) {
      colour = ref(c, 'rgb'); dist = d;
      if (own) slots = own;
      if (anyShine) shine = ref(mk(scope, 'constant', `${sh.id}:shine`, { value: sh.shine }, {}, `${name}'s shine: how strong its highlight is (0 matt, 1 glossy).`, inner), 'value');
      continue;
    }
    const pick = mk(scope, 'materialSelect', `${sh.id}:pick`, {}, { distA: dist, distB: d, colorA: colour, colorB: ref(c, 'rgb') },
      `Picks ${name}'s colour where ${name} is the nearest surface, the colour so far elsewhere.`, inner);
    colour = ref(pick, 'color');
    if (own && slots) slots = ref(vecMath(scope, 'mix', `${sh.id}:texpick`, slots, own, ref(pick, 'blend'), `Takes ${name}'s picture slot where it is the nearest surface (the same choice as its colour).`, inner), 'result');
    if (anyShine && shine) {
      const own = mk(scope, 'constant', `${sh.id}:shine`, { value: sh.shine }, {}, `${name}'s shine (0 matt, 1 glossy).`, inner);
      const mixS = mk(scope, 'mix', `${sh.id}:shinemix`, {}, { a: shine, b: ref(own, 'value'), t: ref(pick, 'blend') }, `Takes ${name}'s shine where its colour was picked.`, inner);
      shine = ref(mixS, 'result');
    }
    const nearer = mk(scope, 'sdfUnion', `${sh.id}:near`, { k: 0 }, { a: dist, b: d }, `The nearest of the shapes so far, for the next pick.`, inner);
    dist = ref(nearer, 'dist');
  }
  const texOuts0 = texShapes.map((_, i) => texPos[i]).filter(Boolean);
  // Only what the group hands out: the last shape's "nearest so far" (no shape after it to pick
  // against) and a lone painted shape's own distance (nothing to compare it with) are not built.
  const roots = [colour, shine, ...(slots && texOuts0.length ? [slots, ...texOuts0] : [])].filter((r): r is Ref => !!r).map(r => r.nodeId);
  const live = reachableFrom(inner, roots);
  for (let i = inner.length - 1; i >= 0; i--) if (!live.has(inner[i].id)) inner.splice(i, 1);
  tidy(inner, 0, 120);
  const matPics = ballsPorts(ctx, matBalls, true);
  const texOuts = texShapes.map((s, i) => ({ key: `tp${i}`, label: `${itemName(ctx.spec, s)} point`, from: texPos[i] })).filter(o => o.from);
  const pics = slots && texOuts.length ? [
    { key: 'slots', type: 'vec3' as const, label: 'Picture slots', from: slots },
    ...texOuts.map(o => ({ key: o.key, type: 'vec3' as const, label: o.label, from: o.from })),
  ] : [];
  const outputs: Record<string, OutputSocket> = {
    color: { type: 'vec3', label: 'Colour' }, ...(shine ? { shine: { type: 'float', label: 'Shine' } } : {}),
    ...Object.fromEntries(pics.map(o => [o.key, { type: o.type, label: o.label }])),
  };
  const node: GraphNode = {
    id: ctx.idFor('materials'), type: 'group', position: { x: 0, y: 0 },
    inputs: { hitPos: { type: 'vec3', label: 'Hit Pos', connection: { ...hitPos } }, ...matPics.inputs },
    outputs,
    params: {
      label: 'Materials', iterations: 1,
      subgraph: {
        nodes: inner,
        inputPorts: [{ key: 'hitPos', type: 'vec3', label: 'Hit Pos', toNodeId: inner[0]?.id ?? '', toInputKey: 'pos' }, ...matPics.ports],
        outputPorts: [
          { key: 'color', type: 'vec3', label: 'Colour', fromNodeId: colour!.nodeId, fromOutputKey: colour!.outputKey },
          ...(shine ? [{ key: 'shine', type: 'float' as const, label: 'Shine', fromNodeId: shine.nodeId, fromOutputKey: shine.outputKey }] : []),
          ...pics.map(o => ({ key: o.key, type: o.type, label: o.label, fromNodeId: o.from.nodeId, fromOutputKey: o.from.outputKey })),
        ],
      } satisfies SubgraphData,
      __comment: `Which shape is under each pixel, and its colour. Each shape is measured again at the hit point and Material Select keeps the colour of the nearest one. Edit the colours inside (double-click), or in the Scene Builder.${pics.length ? ' Picture slots says which painted shape is nearest (x, y, z: the first, second and third), and each painted shape\'s point is the hit point as that shape sees it, so its picture moves, turns and repeats with it.' : ''}`,
      [ROLE_KEY]: 'materials',
    },
  };
  ctx.nodes.push(node);
  return node;
}

// ── Pictures on surfaces (docs/scene-builder-3d.md, "Textures") ─────────────

/** A shape's half-size across its front (x, y), for the face map. */
function faceExtent(sh: ShapeSpec): [number, number] {
  const size = sh.size.size;
  if (Array.isArray(size)) return [Math.max(0.01, size[0]), Math.max(0.01, size[1])];
  const r = num(sh.size.r ?? sh.size.R ?? sh.size.s, 0.5);
  const h = num(sh.size.h, r);
  return [Math.max(0.01, r), Math.max(0.01, sh.kind === 'cylinder' ? h : r)];
}

/**
 * The colour of each painted shape's picture at the hit point, read in the shape's own space with
 * its map, and painted over the base colour where that shape is the nearest surface. Tiled maps
 * read through Sample (texture) on Edges: Repeat, which wraps in the shader but picks the mipmap
 * from the unwrapped place: no seam where the picture starts again, no shimmer far away. With a
 * bump on any shape, `height` is the pictures' brightness (times each bump) for bumpNormal.
 */
function surfacePictures(ctx: Ctx, texShapes: ShapeSpec[], mat: GraphNode, normal: Ref, base: Ref): { color: Ref; height: Ref | null } {
  const cols: Array<{ i: number; from: Ref; bump: number }> = [];
  const L = (lhs: string, rhs: string) => ({ lhs, op: '=', rhs });
  texShapes.forEach((sh, i) => {
    const t = sh.tex!;
    const src = findTex(ctx.spec.textures, t.tex);
    const name = `‘${itemName(ctx.spec, sh)}’`;
    if (!src) { ctx.warnings.push(`${name} reads the picture “${t.tex}”, which the scene doesn't have: pick one under Pictures.`); return; }
    if (!mat.outputs[`tp${i}`]) return;
    const texRef: Ref = { nodeId: standInId(src), outputKey: 'texture' };
    const a = glf(src.aspect ?? 1);
    const role = `${sh.id}:pic`;
    if (sh.kind === 'picture-balls') {
      // Picture balls: each ball is the picture's colour at its home, from the same grid at the shape's own point.
      const def = SHAPE_BY_KIND['picture-balls'];
      const params: Record<string, unknown> = { ...ballsExtra(ctx, sh) };
      for (const p of def.params) if (typeof p.param === 'string' && p.param) params[p.param] = Number(sh.size[p.key] ?? p.def);
      const b = mk(ctx, 'pieceBalls', `${role}:balls`, params, { pos: ref(mat, `tp${i}`), picture: texRef },
        `${name}'s colour: the same grid of balls measured at the hit point (in ${name}'s own space), so each ball is the picture “${src.name}”'s colour at its home.`);
      cols.push({ i, from: ref(b, 'color'), bump: t.bump ?? 0 });
      return;
    }
    const map = TEX_MAP_LABELS[t.map];
    const tiled = t.map !== 'face';
    const sample = (k: string, uv: Ref) => ref(mk(ctx, 'sampleTexture', `${role}:${k}`, sampleWrap(tiled ? 'repeat' : 'once'), { texture: texRef, uv },
      `Reads the picture “${src.name}” for ${name}${k === 'x' || k === 'y' || k === 'z' ? `: the projection along ${k}` : ''}. Its Texture is wired from the picture's node. ${tiled ? 'Edges: Repeat wraps the picture here, picking the mipmap from the unwrapped place, so it repeats with no seam and doesn\'t shimmer far away.' : ''}`), 'color');
    const off = t.offset ?? [0, 0];
    const common = [
      { name: 'k', type: 'float' as const, slider: { value: t.scale, min: 0.1, max: 16 } },
      { name: 'ox', type: 'float' as const, slider: { value: off[0], min: -1, max: 1 } },
      { name: 'oy', type: 'float' as const, slider: { value: off[1], min: -1, max: 1 } },
      { name: 'turn', type: 'float' as const, slider: { value: t.rot ?? 0, min: -180, max: 180 } },
    ];
    // Turned about the picture's middle, then slid: R * (place - 0.5) + 0.5 + offset.
    const place = (st: string) => picUv(`R * (${st} - 0.5) + 0.5 + vec2(ox, oy)`);
    const rotLines = [L('float ca', 'cos(radians(turn))'), L('float sa', 'sin(radians(turn))'), L('mat2 R', 'mat2(ca, sa, -sa, ca)')];
    const head = `Where ${name}'s picture “${src.name}” is read: p is the hit point in ${name}'s own space (after its move, turn and warps, so the picture moves and repeats with it). ${map.label}: ${map.blurb} `
      + `k is ${t.map === 'face' ? 'a zoom, above 1 closer' : t.map === 'spherical' ? 'how many times it goes round' : 'how many times it repeats every 2 units'}; ox and oy slide it (1 is a whole picture), turn turns it (degrees). All live.`;
    if (t.map === 'triplanar') {
      const coords = exprBlock(ctx, `${role}:coords`, 'Triplanar', [
        { name: 'p', type: 'vec3', from: ref(mat, `tp${i}`) }, { name: 'n', type: 'vec3', from: normal },
        ...common, { name: 'sharp', type: 'float', slider: { value: t.sharp ?? TEX_SHARP_DEFAULT, min: 1, max: 16 } },
      ], 'ux', `${head} ux, uy and uz are the places to read for the projections along x, y and z (the picture keeps its shape, ${glf(src.aspect ?? 1)} wide for 1 tall); w how much of each to take, from how squarely the surface faces each axis, to the power sharp (1 a soft blend, 16 crisp edges between them).`);
      coords.params.lines = [
        ...rotLines,
        L('vec3 q', 'p * k * 0.5'),
        L('vec2 ux', place(`vec2(q.z / ${a}, q.y)`)),
        L('vec2 uy', place(`vec2(q.x / ${a}, q.z)`)),
        L('vec2 uz', place(`vec2(q.x / ${a}, q.y)`)),
        L('vec3 w', 'pow(abs(n), vec3(sharp))'),
        L('w', 'w / max(w.x + w.y + w.z, 1e-4)'),
      ];
      coords.params.outputs = ['uy', 'uz', 'w'];
      coords.outputs = { result: { type: 'vec2', label: 'Result' }, uy: { type: 'vec2', label: 'uy' }, uz: { type: 'vec2', label: 'uz' }, w: { type: 'vec3', label: 'w' } };
      coords.params.outputType = 'vec2';
      const cx = sample('x', ref(coords, 'result')), cy = sample('y', ref(coords, 'uy')), cz = sample('z', ref(coords, 'uz'));
      const blend = exprBlock(ctx, `${role}:blend`, 'Triplanar blend', [
        { name: 'cx', type: 'vec3', from: cx }, { name: 'cy', type: 'vec3', from: cy }, { name: 'cz', type: 'vec3', from: cz }, { name: 'w', type: 'vec3', from: ref(coords, 'w') },
      ], 'cx * w.x + cy * w.y + cz * w.z', `${name}'s picture: the three projections mixed by w, so each face takes the one that looks at it squarely.`);
      cols.push({ i, from: ref(blend, 'result'), bump: t.bump ?? 0 });
      return;
    }
    const lines = t.map === 'planar'
      ? [...rotLines, L('vec2 uv', place(`vec2(p.x / ${a}, p.y) * k * 0.5 + 0.5`))]
      : t.map === 'spherical'
        ? [...rotLines, L('vec3 d', 'normalize(p + vec3(1e-5))'), L('vec2 uv', place('vec2(atan(d.z, d.x) / 6.2831853 + 0.5, acos(clamp(d.y, -1.0, 1.0)) / 3.1415927) * k'))]
        : [...rotLines, L('vec2 ext', `vec2(${faceExtent(sh).map(glf).join(', ')})`), ...fitLines('cover', 'p.xy', 'ext', a, 'k'), L('vec2 uv', place('st'))];
    const coords = exprBlock(ctx, `${role}:coords`, `${map.label} map`, [{ name: 'p', type: 'vec3', from: ref(mat, `tp${i}`) }, ...common], 'uv', `${head} uv is the place to read, in the picture coordinates Sample (texture) reads.`);
    coords.params.lines = lines;
    coords.params.outputType = 'vec2';
    coords.outputs = { result: { type: 'vec2', label: 'Result' } };
    cols.push({ i, from: sample('s', ref(coords, 'result')), bump: t.bump ?? 0 });
  });
  if (!cols.length) return { color: base, height: null };
  const chain = cols.reduce((acc, c) => `mix(${acc}, c${c.i}, slots.${'xyz'[c.i]})`, 'base');
  const bumps = cols.filter(c => c.bump > 0);
  const paint = exprBlock(ctx, 'pictures', 'Surface pictures', [
    { name: 'base', type: 'vec3', from: base }, { name: 'slots', type: 'vec3', from: ref(mat, 'slots') },
    ...cols.map(c => ({ name: `c${c.i}`, type: 'vec3' as const, from: c.from })),
    ...bumps.map(c => ({ name: `b${c.i}`, type: 'float' as const, slider: { value: c.bump, min: 0, max: 4 } })),
  ], chain, `Paints each picture on its shape: base is the shapes' own colours, slots says which painted shape is nearest (x the first, y the second, z the third), c0… their pictures. The lighting after it shades the pictures like any colour.${bumps.length ? ' h is the height for the bump: each bumped picture\'s brightness times its bump (b0…, live), where it is painted.' : ''}`);
  if (!bumps.length) return { color: ref(paint, 'result'), height: null };
  paint.params.lines = [L('float h', bumps.map(c => `${LUMA(`c${c.i}`)} * slots.${'xyz'[c.i]} * b${c.i}`).join(' + '))];
  paint.params.outputs = ['h'];
  paint.outputs = { ...paint.outputs, h: { type: 'float', label: 'Height' } };
  return { color: ref(paint, 'result'), height: ref(paint, 'h') };
}

/**
 * Bump from brightness: the surface's normal tilted by how the picture's brightness changes from
 * pixel to pixel (Mikkelsen's surface gradient, from screen derivatives: no extra reads of the
 * picture, no tangents), so a plain photo gets some relief under the light.
 */
function bumpNormal(ctx: Ctx, normal: Ref, pos: Ref, height: Ref): Ref {
  const L = (lhs: string, rhs: string) => ({ lhs, op: '=', rhs });
  const b = exprBlock(ctx, 'bump', 'Bump from brightness', [
    { name: 'n', type: 'vec3', from: normal }, { name: 'p', type: 'vec3', from: pos }, { name: 'h', type: 'float', from: height },
    { name: 'depth', type: 'float', slider: { value: 0.03, min: 0, max: 0.2 } },
  ], 'normalize(abs(det) * n - depth * g)',
  'Bump from brightness: tilts the surface\'s normal by how the pictures\' brightness (h) changes across the screen, so bright parts read as raised. dpx and dpy are how the hit point changes from one pixel to the next, dhx and dhy the same for h; g is the slope of h along the surface (Mikkelsen\'s surface gradient), depth how deep the relief is (live). The lights read this normal; shadows and AO keep the shape\'s own.');
  b.params.lines = [
    L('vec3 dpx', 'dFdx(p)'), L('vec3 dpy', 'dFdy(p)'),
    L('float dhx', 'dFdx(h)'), L('float dhy', 'dFdy(h)'),
    L('vec3 r1', 'cross(dpy, n)'), L('vec3 r2', 'cross(n, dpx)'),
    L('float det', 'dot(dpx, r1)'),
    L('vec3 g', 'sign(det) * (dhx * r1 + dhy * r2)'),
  ];
  return ref(b, 'result');
}

// ── Layout ──────────────────────────────────────────────────────────────────

/**
 * How tall a card will be. A group card also lists the sliders of the nodes inside it (a Scene
 * Group shows its shapes' sizes), which the plain estimate doesn't count.
 */
function cardHeight(n: GraphNode): number {
  const base = estimateNodeHeight(n);
  const sub = (n.params.subgraph as SubgraphData | undefined)?.nodes;
  if (!sub || n.type === 'marchLoopGroup' || n.type === 'giLitMarchGroup') return base;
  let extra = 0;
  for (const c of sub) {
    const rows = Object.values(getNodeDefinition(c.type)?.paramDefs ?? {}).filter(p => p.type === 'float' || p.type === 'select' || p.type === 'vec3color').length;
    if (rows) extra += 30 + rows * 36;
  }
  return base + extra;
}

/** Columns by data flow, each column in the order the nodes were made. */
export function tidy(nodes: GraphNode[], x0: number, y0: number) {
  const order = new Map(nodes.map((n, i) => [n.id, i]));
  const at = layoutByRank(nodes, { startX: x0, startY: y0, colW: 440, gap: 40, heightOf: cardHeight, order: (a, b) => order.get(a.id)! - order.get(b.id)! });
  for (const n of nodes) n.position = at.get(n.id) ?? n.position;
}

// ── Outputs (output.ts): a measurement of the march instead of the picture ─

/** What the march loop hands out, for an output to read. */
export interface MarchRefs {
  kind: 'march' | 'gi';
  loop: GraphNode;
  scene: Ref;
  sun: Ref | null;
  maxDist: number;
  camDist: number;
}

/**
 * The nodes that show `o` (not the picture) from a march loop's outputs: an Expression Block that
 * turns the measurement into something to look at (grey, a colour, or a 0–1 shade), then a
 * Palette or Color Ramp when it colours the space. Returns what to wire into the Output.
 * Exported for the Do… bar, which shows a hand-made loop's outputs the same way.
 */
export function emitOutput(base: { idFor: (role: string) => string; nodes: GraphNode[]; spec?: SceneSpec; warnings?: string[] }, o: OutputSpec, m: MarchRefs): Ref {
  const c: Ctx = { spec: base.spec as SceneSpec, idFor: base.idFor, nodes: base.nodes, warnings: base.warnings ?? [] };
  const def = OUTPUT_BY_SHOW[o.show];
  const L = m.loop;
  const pal = o.palette ? PALETTE_BY_KEY[o.palette] : undefined;
  const range = (value: number) => ({ value, min: 0.1, max: Math.max(20, value * 2) });
  const existing = (role: string) => c.nodes.find(n => n.params[ROLE_KEY] === role);
  let inputs: ExprInput[] = [];
  let shade = '';   // a 0–1 number (through the palette, or grey)
  let colour = '';  // a vec3 shown as it is (normal, position without a palette)
  let why = '';
  switch (o.show) {
    case 'depth': inputs = [{ name: 'depth', type: 'float', from: ref(L, 'depth') }]; shade = 'clamp(depth, 0.0, 1.0)'; why = `Depth is 0 at the camera and 1 at Max Dist (${fmt(m.maxDist)}) and on the background.`; break;
    case 'distance': inputs = [{ name: 'dist', type: 'float', from: ref(L, 'dist') }, { name: 'range', type: 'float', slider: range(Math.round(m.camDist * 200) / 100) }]; shade = 'clamp(dist / range, 0.0, 1.0)'; why = 'Distance is how far the ray went, in scene units; Range is the distance shown as white.'; break;
    case 'height': inputs = [{ name: 'pos', type: 'vec3', from: ref(L, 'pos') }, { name: 'hit', type: 'float', from: ref(L, 'hit') }, { name: 'range', type: 'float', slider: range(1) }]; shade = 'clamp(pos.y / range * 0.5 + 0.5, 0.0, 1.0) * hit'; why = 'Height is the hit point\'s Y: -Range is 0, +Range is 1; the background is 0.'; break;
    case 'normal': inputs = [{ name: 'n', type: 'vec3', from: ref(L, 'normal') }]; colour = 'n * 0.5 + 0.5'; shade = 'n.y * 0.5 + 0.5'; why = pal ? 'Through the palette by how much each surface faces up (n.y): 0 facing down, 1 facing up.' : 'The normal (-1…1 per axis) moved to 0…1 so it shows as a colour: X red, Y green, Z blue.'; break;
    case 'hit': inputs = [{ name: 'hit', type: 'float', from: ref(L, 'hit') }]; shade = 'hit'; why = 'Hit is 1 where a ray touched a surface, 0 where it missed.'; break;
    case 'position': inputs = [{ name: 'pos', type: 'vec3', from: ref(L, 'pos') }, { name: 'hit', type: 'float', from: ref(L, 'hit') }, { name: 'range', type: 'float', slider: range(2) }]; colour = 'clamp(pos / range * 0.5 + 0.5, 0.0, 1.0) * hit'; shade = 'clamp(length(pos) / range, 0.0, 1.0) * hit'; why = pal ? 'Through the palette by how far each hit point is from the centre (Range is 1).' : 'The hit point as a colour: -Range…+Range on each axis is 0…1 (X red, Y green, Z blue).'; break;
    case 'steps': inputs = [{ name: 'iter', type: 'float', from: ref(L, 'iter') }]; shade = 'iter'; why = 'Steps taken as 0–1 of Max Steps: high along edges and in crevices, where the march works hardest.'; break;
    case 'ao': {
      const src: Ref = m.kind === 'gi' ? ref(L, 'ao') : ref(existing('ao') ?? mk(c, 'sdfAo', 'out:ao', { stepDist: 0.06 }, { scene: m.scene, pos: ref(L, 'pos'), normal: ref(L, 'normal'), hit: ref(L, 'hit') },
        'Ambient occlusion for the AO output: steps out along the normal and darkens where other surfaces are close.'), 'ao');
      inputs = [{ name: 'ao', type: 'float', from: src }]; shade = 'ao'; why = 'AO is 1 in the open and darker in creases and corners.'; break;
    }
    case 'shadow': {
      const src: Ref = m.kind === 'gi' ? ref(L, 'shadow') : ref(existing('shadow') ?? mk(c, 'softShadow', 'out:shadow', { k: 16, tmax: m.maxDist }, { scene: m.scene, pos: ref(L, 'pos'), normal: ref(L, 'normal'), hit: ref(L, 'hit'), lightDir: m.sun },
        'Soft shadow for the Shadow output: marches from each hit point toward the sun.'), 'shadow');
      inputs = [{ name: 'shadow', type: 'float', from: src }]; shade = 'shadow'; why = 'Shadow is 1 in sunlight and 0 in full shadow.'; break;
    }
    default: break;
  }
  const clause = outputClause(o);
  const tail = `(Recipe: ${clause}.) The lit picture is still built beside it: wire Tone Map back into the Output to see it.`;
  if (pal) {
    const v = exprBlock(c, 'out:value', `${def.label} shade`, inputs, shade, `Output: ${def.label}. ${def.blurb} ${why} This block makes it a 0–1 shade for the ${pal.kind === 'palette' ? 'Palette' : 'Color Ramp'} after it. ${tail}`, c.nodes, 'float');
    v.params._sbOutput = { ...o };
    if (pal.kind === 'palette') {
      const p = mk(c, 'palette', 'out:palette', { preset: String(pal.preset ?? 0) }, { value: ref(v, 'result') }, `Colours the space: the ${def.label.toLowerCase()} shade through the ${pal.label} palette (a cosine palette). Pick another Preset here, or under Output in the Scene Builder.`);
      return ref(p, 'color');
    }
    const stops = pal.stops ?? [[0, 0, 0], [1, 1, 1]];
    const r = mk(c, 'colorRamp', 'out:ramp', { stops: String(stops.length), ...Object.fromEntries(stops.map((col, i) => [`color${i}`, [...col]])) }, { t: ref(v, 'result') },
      `Colours the space: the ${def.label.toLowerCase()} shade through the ${pal.label} ramp (${stops.length} stops, evenly spaced). Change the stops here, or pick another under Output in the Scene Builder.`);
    return ref(r, 'color');
  }
  const v = exprBlock(c, 'out:value', `Show ${def.label.toLowerCase()}`, inputs, colour || `vec3(${shade})`, `Output: ${def.label}. ${def.blurb} ${why} Shown ${colour ? 'as a colour' : 'as grey'}, without tone mapping: these are the raw numbers. ${tail}`);
  v.params._sbOutput = { ...o };
  return ref(v, 'result');
}

// ── The whole graph ─────────────────────────────────────────────────────────

const toneNote = (mode: string) => `Squeezes the bright, linear light into colours a screen can show (${mode.toUpperCase()}), without clipping highlights.`;

/**
 * The graph for `spec`. `idFor(role)` names each node (a rebuild passes the ids
 * the nodes had). The result has no Output node: `final` is what to wire into it.
 */
export function buildSceneGraph(spec: SceneSpec, idFor: (role: string) => string = role => `sb_${role.replace(/[^A-Za-z0-9]/g, '_')}`): BuildResult {
  const ctx: Ctx = { spec, idFor, nodes: [], warnings: [] };
  const L = spec.look, Q = spec.quality, C = spec.camera;
  const shapes = allShapes(spec).filter(s => s.kind !== 'custom');
  if (!shapes.length) ctx.warnings.push('The scene has no shapes yet: add one under Shapes.');
  const step = effectiveStepScale(spec);
  const hints = stepHints(spec);

  // Projection (March Camera's Perspective): absent is perspective, as before, with Flatten when set.
  const proj = C.projection ?? 'perspective';
  const rev = { strength: C.reverse ?? REVERSE_DEFAULTS.reverse, at: C.converge ?? REVERSE_DEFAULTS.converge };
  const projParams = proj === 'orthographic' ? { projection: 'orthographic' }
    : proj === 'reverse' ? { projection: 'reverse', reverseStrength: rev.strength, reverseDist: rev.at }
      : C.flatten > 0 ? { ortho: C.flatten } : {};
  const projNote = proj === 'orthographic' ? ', orthographic: its rays run parallel, so size doesn\'t change with distance (an isometric drawing)'
    : proj === 'reverse' ? `, in reverse perspective: its rays start spread out and meet ${fmt(rev.at)} in front (strength ${fmt(rev.strength)}), so far things look bigger, like a Byzantine icon`
      : C.flatten ? `, flattened ${fmt(C.flatten)} toward isometric` : '';
  const cam = mk(ctx, 'marchCamera', 'camera', {
    camDist: C.dist, camAngle: rad(C.angle), camElevation: rad(C.elev), rotSpeed: rad(C.orbit), fov: C.zoom,
    targetX: C.x, targetY: C.y, targetZ: C.z, ...projParams,
  }, {}, `The camera: ${fmt(C.dist)} away, ${fmt(C.angle)}° round and ${fmt(C.elev)}° up${C.orbit ? `, orbiting ${fmt(C.orbit)}° a second` : ''}, zoom ${fmt(C.zoom)}${projNote}. Every pixel becomes a ray from here. Target X / Y / Z move the camera and the point it looks at together (Translate).`);

  // Glass mode measures two scenes: the glass, and what is seen through it.
  const glassParts = L.mode === 'glass' ? filterTree(spec.root, s => s.glass) : null;
  const fgRoot = L.mode === 'glass' ? (glassParts ?? spec.root) : spec.root;
  const bgRoot = L.mode === 'glass' && glassParts ? filterTree(spec.root, s => !s.glass) : null;
  if (L.mode === 'glass' && !glassParts) ctx.warnings.push('No shape is marked Glass, so every shape is glass.');

  const scene = sceneGroup(ctx, 'scene', fgRoot, L.mode === 'glass' ? 'Glass' : 'Scene',
    `The scene as one distance function: for any point, how far the nearest surface is. Inside: Scene Pos → ${spec.root.warps.length ? 'warps → ' : ''}moves and turns → shapes → combines → Scene Output. Built by the Scene Builder: right-click → Edit in Scene Builder.`);
  const bgScene = bgRoot ? sceneGroup(ctx, 'scene2', bgRoot, 'Seen through the glass', 'The shapes that are not glass: what the glass refracts and reflects. Glass Scene marches it separately.') : null;

  const usesSun = (L.mode === 'surface') || L.mode === 'gi' || L.mode === 'glass';
  const sun = usesSun ? mk(ctx, 'makeVec3', 'sun', { r: L.sunDir[0], g: L.sunDir[1], b: L.sunDir[2] }, {},
    `Which way the sunlight comes from ${v3(L.sunDir)} (pointing toward the sun; only its direction matters). It feeds the shadows and the lighting, so they always agree.`) : null;

  const background = (): Ref => {
    const bgSrc = L.bgTex ? findTex(spec.textures, L.bgTex) : undefined;
    if (L.bgTex && !bgSrc) ctx.warnings.push(`The background reads the picture “${L.bgTex}”, which the scene doesn't have: pick one under Pictures.`);
    if (bgSrc) {
      const env = mk(ctx, 'pictureEnvironment', 'bg', { fov: C.zoom }, {
        picture: { nodeId: standInId(bgSrc), outputKey: 'texture' }, dir: ref(cam, 'rd'), forward: ref(cam, 'forward'), right: ref(cam, 'right'), up: ref(cam, 'up'),
      }, `The background: the picture “${bgSrc.name}” as the backdrop the camera looks at (Picture Environment). Each ray that misses every shape reads the picture where it points; past the frame's edge the picture is mirrored. Its Camera FOV matches the camera's Zoom (${fmt(C.zoom)}).`);
      return ref(env, 'color');
    }
    if (!L.bg2) return ref(mk(ctx, 'colorPicker', 'bg', { color: [...L.bg] }, {}, 'The background: what rays that miss every shape see.'), 'rgb');
    const top = mk(ctx, 'colorPicker', 'bg:top', { color: [...L.bg] }, {}, 'The top of the background gradient (looking up).');
    const bottom = mk(ctx, 'colorPicker', 'bg:bottom', { color: [...L.bg2] }, {}, 'The bottom of the background gradient (looking down).');
    return ref(exprBlock(ctx, 'bg', 'Sky gradient', [
      { name: 'rd', type: 'vec3', from: ref(cam, 'rd') }, { name: 'top', type: 'vec3', from: ref(top, 'rgb') }, { name: 'bottom', type: 'vec3', from: ref(bottom, 'rgb') },
    ], 'mix(bottom, top, clamp(rd.y * 0.5 + 0.5, 0.0, 1.0))', 'The background: a gradient by which way each ray points, from Bottom (straight down) to Top (straight up).'), 'result');
  };

  const loopNote = (what: string) => `The ray marcher: for every pixel it walks a ray from the camera, stepping by the scene's distance${what}. Max Steps ${Q.steps}, Max Dist ${fmt(Q.maxDist)}, Step Scale ${fmt(step)}${hints.length && step < 1 ? ` (smaller steps for ${hints[0].why})` : ''}.`;
  const passBody = (role: string): SubgraphData => {
    const inner: GraphNode[] = [];
    const gi = mk(ctx, 'marchLoopInputs', `${role}:in`, { _groupOriginal: true }, {}, 'The ray\'s current point (March Pos) and how far it has gone (March Dist).', inner);
    mk(ctx, 'marchLoopOutput', `${role}:out`, { _groupOriginal: true }, { pos: ref(gi, 'marchPos') }, 'The point the scene is measured at: March Pos, unwarped (the scene\'s own warps live in the Scene Group, so shadows see them too).', inner);
    tidy(inner, 0, 180);
    return { nodes: inner, inputPorts: [], outputPorts: [] };
  };
  const loopParams = { maxSteps: Q.steps, maxDist: Q.maxDist, stepScale: step, jitter: Q.jitter, bg: [...L.bg], ...(Q.warp ? { warpSafety: Q.warp } : {}) };

  let final: Ref;
  let march: MarchRefs | null = null;
  if (L.mode === 'volumetric') {
    const inner: GraphNode[] = [];
    const gi = mk(ctx, 'marchLoopInputs', 'march:in', { _groupOriginal: true }, {}, 'The ray\'s current point (March Pos) at this step.', inner);
    const sd = mk(ctx, 'marchSceneDist', 'march:dist', {}, { pos: ref(gi, 'marchPos') }, 'How far this step\'s point is from the nearest surface (Raw Distance is negative inside a shape).', inner);
    const glow = mk(ctx, 'volumeGlow', 'march:glow', { density: L.glow.density, falloff: L.glow.falloff, shell: L.glow.shell }, { dist: ref(sd, 'rawDist') },
      `Adds a little light at every step (+=): full inside a shape, fading with distance outside (Falloff ${fmt(L.glow.falloff)}).${L.glow.shell ? ` Shell ${fmt(L.glow.shell)}: only a skin glows.` : ''} The total leaves the loop as Glow.`, inner);
    glow.assignOp = '+=';
    mk(ctx, 'marchLoopOutput', 'march:out', { _groupOriginal: true }, { pos: ref(gi, 'marchPos') }, 'The point the scene is measured at: March Pos, unwarped.', inner);
    tidy(inner, 0, 180);
    const loop = mk(ctx, 'marchLoopGroup', 'march', { ...loopParams, volumetric: true, passthrough: 0.1, subgraph: { nodes: inner, inputPorts: [], outputPorts: [] } },
      { ro: ref(cam, 'ro'), rd: ref(cam, 'rd'), scene: ref(scene, 'scene') }, loopNote(', but in volumetric mode it never stops at a surface: it walks right through, and Volume Glow inside adds light at every step'));
    loop.outputs = { ...loop.outputs, acc0: { type: 'float', label: 'Glow' } };
    march = { kind: 'march', loop, scene: ref(scene, 'scene'), sun: null, maxDist: Q.maxDist, camDist: C.dist };
    const colour = mk(ctx, 'glowToColor', 'glowColor', { exposure: L.glow.exposure, tint: [...L.glow.tint] }, { glow: ref(loop, 'acc0') },
      `Turns the glow the ray gathered into colour: Tint × tanh(glow × Exposure ${fmt(L.glow.exposure)}), so bright cores don't blow out.`);
    const add = vecMath(ctx, 'add', 'compose', background(), ref(colour, 'color'), null, 'The glow added over the background (glow is light: it only adds).');
    final = ref(add, 'result');
    if (L.fog > 0) ctx.warnings.push('Fog is for lit surfaces; Volumetric mode leaves it out.');
    if (new Set(shapes.map(s => s.color.join())).size > 1) ctx.warnings.push('Volumetric glow has one tint; the shapes\' own colours are not used.');
  } else if (L.mode === 'glass') {
    const tint = mk(ctx, 'colorPicker', 'glassTint', { color: [...L.glass.tint] }, {}, 'The glass\'s tint: light passing through it takes this colour.');
    const bgShape = bgRoot ? allShapes({ ...spec, root: bgRoot }).find(s => s.kind !== 'custom') : undefined;
    const bgAlbedo = bgScene ? mk(ctx, 'colorPicker', 'bgAlbedo', { color: [...(bgShape?.color ?? [0.75, 0.78, 0.85])] }, {}, 'The colour of the shapes seen through the glass.') : null;
    const glass = mk(ctx, 'glassScene', 'march', { ior: L.glass.ior, dispersion: L.glass.dispersion }, {
      ro: ref(cam, 'ro'), rd: ref(cam, 'rd'), foreground: ref(scene, 'scene'), background: bgScene ? ref(bgScene, 'scene') : null,
      tintColor: ref(tint, 'rgb'), bgAlbedo: bgAlbedo ? ref(bgAlbedo, 'rgb') : null, lightDir: sun ? ref(sun, 'rgb') : null,
    }, `Glass: marches the glass shapes, bends each ray through them (IOR ${fmt(L.glass.ior)}; Dispersion ${fmt(L.glass.dispersion)} splits colours a little), and shows ${bgScene ? 'the other shapes' : 'a sky'} through and around them.`);
    final = ref(glass, 'color');
    if (L.fog > 0) ctx.warnings.push('Glass mode has no fog; it is left out.');
  } else if (L.mode === 'gi') {
    const first = shapes[0]?.color ?? [0.7, 0.7, 0.7];
    if (new Set(shapes.map(s => s.color.join())).size > 1) ctx.warnings.push('GI lighting uses one surface colour (the first shape\'s); per-shape colours are a Surface-mode feature.');
    const loop = mk(ctx, 'giLitMarchGroup', 'march', {
      ...loopParams, albedo: [...first], metallic: L.gi.metal, roughness: L.gi.rough, giStrength: L.gi.strength, specStrength: L.gi.spec,
      lightR: L.sunColor[0], lightG: L.sunColor[1], lightB: L.sunColor[2],
      skyTopR: L.sky[0], skyTopG: L.sky[1], skyTopB: L.sky[2], skyBotR: L.bounce[0] * 4, skyBotG: L.bounce[1] * 4, skyBotB: L.bounce[2] * 4,
      subgraph: passBody('march'),
    }, { ro: ref(cam, 'ro'), rd: ref(cam, 'rd'), scene: ref(scene, 'scene'), lightDir: sun ? ref(sun, 'rgb') : null },
    loopNote(', then lights the hit with soft shadows, ambient occlusion, a sky dome, one bounce of light off nearby surfaces and a reflection'));
    final = ref(loop, 'color');
    march = { kind: 'gi', loop, scene: ref(scene, 'scene'), sun: sun ? ref(sun, 'rgb') : null, maxDist: Q.maxDist, camDist: C.dist };
    if (L.bg2) final = ref(vecMath(ctx, 'mix', 'compose', background(), final, ref(loop, 'hit'), 'The lit surface where a ray hit (Hit = 1), the background gradient where it missed.'), 'result');
    if (L.fog > 0) {
      const fogC = L.fogColor ?? L.bg;
      const fog = mk(ctx, 'volumetricFog', 'fog', { density: L.fog, fogR: fogC[0], fogG: fogC[1], fogB: fogC[2] }, { color: final, depth: ref(loop, 'depth'), hit: ref(loop, 'hit') },
        `Fog: distant surfaces fade into the fog colour, 1 − exp(−depth × ${fmt(L.fog)}).`);
      final = ref(fog, 'color');
    }
  } else {
    const loop = mk(ctx, 'marchLoopGroup', 'march', { ...loopParams, albedo: [...(shapes[0]?.color ?? [0.8, 0.8, 0.8])], subgraph: passBody('march') },
      { ro: ref(cam, 'ro'), rd: ref(cam, 'rd'), scene: ref(scene, 'scene') }, loopNote(' until it lands on a surface. Its outputs (Hit Pos, Normal, Hit, Depth) feed the lighting after it'));
    const hit = ref(loop, 'hit'), pos = ref(loop, 'pos'), normal = ref(loop, 'normal');
    march = { kind: 'march', loop, scene: ref(scene, 'scene'), sun: sun ? ref(sun, 'rgb') : null, maxDist: Q.maxDist, camDist: C.dist };
    // With Warp safety on, the shadow and AO rays divide by the loop's Stretch too.
    const stretch = Q.warp ? { stretch: ref(loop, 'stretch') } : {};
    const ao = L.ao > 0 ? mk(ctx, 'sdfAo', 'ao', { stepDist: L.ao }, { scene: ref(scene, 'scene'), pos, normal, hit, ...stretch },
      'Ambient occlusion: steps out along the surface\'s normal and darkens creases and corners where other surfaces are close.') : null;
    const shadow = L.shadows > 0 ? mk(ctx, 'softShadow', 'shadow', { k: L.shadows, tmax: Q.maxDist }, { scene: ref(scene, 'scene'), pos, normal, hit, lightDir: sun ? ref(sun, 'rgb') : null, ...stretch },
      `Soft shadows: marches again from the hit point toward the sun; Hardness ${fmt(L.shadows)} (8 soft … 32 hard).`) : null;
    const colours = new Set(shapes.map(s => s.color.join()));
    const shines = new Set(shapes.map(s => s.shine));
    let base: Ref, shine: Ref | null = null;
    const shineValue = shapes[0]?.shine ?? 0;
    let litNormal = normal;
    const painted = shapes.filter(s => s.tex);
    if (painted.length > MAX_TEX_SHAPES) ctx.warnings.push(`Pictures paint ${MAX_TEX_SHAPES} shapes at most; ${painted.slice(MAX_TEX_SHAPES).map(s => `‘${itemName(spec, s)}’`).join(', ')} keep${painted.length - MAX_TEX_SHAPES === 1 ? 's' : ''} its colour.`);
    const texShapes = painted.slice(0, MAX_TEX_SHAPES);
    if (texShapes.length || (shapes.length > 1 && (colours.size > 1 || shines.size > 1))) {
      const mat = materialsGroup(ctx, shapes, pos, texShapes);
      base = ref(mat, 'color');
      if (mat.outputs.shine) shine = ref(mat, 'shine');
      if (texShapes.length) {
        const pics = surfacePictures(ctx, texShapes, mat, normal, base);
        base = pics.color;
        // Bump from brightness: the lights (and the highlight) read a normal tilted by the pictures.
        if (pics.height) litNormal = bumpNormal(ctx, normal, pos, pics.height);
      }
    } else {
      base = ref(mk(ctx, 'colorPicker', 'color', { color: [...(shapes[0]?.color ?? [0.8, 0.8, 0.8])] }, {}, 'The surface colour. Keep it fairly dark (around 0.2–0.8) and get brightness from the lights.'), 'rgb');
    }
    const light = mk(ctx, 'multiLight', 'light', {
      sunDirX: L.sunDir[0], sunDirY: L.sunDir[1], sunDirZ: L.sunDir[2], sunR: L.sunColor[0], sunG: L.sunColor[1], sunB: L.sunColor[2],
      skyR: L.sky[0], skyG: L.sky[1], skyB: L.sky[2], bounceR: L.bounce[0], bounceG: L.bounce[1], bounceB: L.bounce[2],
    }, { baseColor: base, normal: litNormal, hit, ao: ao ? ref(ao, 'ao') : null, shadow: shadow ? ref(shadow, 'shadow') : null, sunDir: sun ? ref(sun, 'rgb') : null },
    'The outdoor light rig: a warm sun (shadowed), a cool sky from above and a weak bounce from below (both darkened by AO). It gives linear light that can go past 1; Tone Map brings it back.');
    let lit = ref(light, 'color');
    if (shine || shineValue > 0) {
      const spec2 = mk(ctx, 'blinnPhong', 'spec', { shininess: 48, diffuseness: 0 }, { normal: litNormal, viewDir: ref(cam, 'rd'), lightDir: sun ? ref(sun, 'rgb') : null },
        'The highlight: where the surface mirrors the sun toward the camera (Blinn-Phong, specular only).');
      const add = exprBlock(ctx, 'shine', 'Add highlight', [
        { name: 'lit', type: 'vec3', from: lit }, { name: 'spec', type: 'float', from: ref(spec2, 'light') }, { name: 'hit', type: 'float', from: hit },
        shine ? { name: 'shine', type: 'float', from: shine } : { name: 'shine', type: 'float', slider: { value: shineValue, min: 0, max: 1 } },
      ], 'lit + vec3(spec * shine * hit)', 'Adds the highlight to the lit colour, scaled by Shine (0 matt, 1 glossy), only where a ray hit.');
      lit = ref(add, 'result');
    }
    if (L.fog > 0) {
      const fogC = L.fogColor ?? L.bg;
      const fog = mk(ctx, 'volumetricFog', 'fog', { density: L.fog, fogR: fogC[0], fogG: fogC[1], fogB: fogC[2] }, { color: lit, depth: ref(loop, 'depth'), hit },
        `Fog: distant surfaces fade into the fog colour, 1 − exp(−depth × ${fmt(L.fog)}). Depth is 0–1 of Max Dist.`);
      lit = ref(fog, 'color');
    }
    const compose = vecMath(ctx, 'mix', 'compose', background(), lit, hit, 'The lit surface where a ray hit (Hit = 1), the background where it missed.');
    final = ref(compose, 'result');
  }
  if (L.mode !== 'surface' && shapes.some(s => s.tex)) ctx.warnings.push('Pictures on shapes are a Surface-mode feature; in this mode the shapes keep their colours.');
  // A picture with depth: the objects stand in it (docs/depth-node.md "Depth in 3D scenes").
  if (spec.depth) {
    if (march && (L.mode === 'surface' || L.mode === 'gi')) final = emitDepthPicture3D(ctx, spec, cam, ref(scene, 'scene'), march.loop, final);
    else ctx.warnings.push('A picture with depth needs Surface or GI lit mode (the march has to stop on surfaces to know what is nearer); it is left out.');
  }
  if (L.tone !== 'none') final = ref(mk(ctx, 'toneMap', 'tone', { mode: L.tone }, { color: final }, toneNote(L.tone)), 'color');
  // Another output: the measurement instead of the picture (the picture's nodes stay, unwired).
  if (!isPicture(spec.output)) {
    const problem = outputProblem(L.mode, spec.output);
    if (problem) ctx.warnings.push(problem);
    else if (march) final = emitOutput(ctx, spec.output!, march);
  }
  tidy(ctx.nodes, 0, 0);
  return { nodes: ctx.nodes, final, sceneId: scene.id, warnings: ctx.warnings };
}

/**
 * A picture with depth in the scene: the picture (its Texture node), its Depth node (baked when Generate depth ran),
 * and a Depth Composite of the picture and `shown` by distance; lit adds a Depth Light (the scene's glowing shapes and
 * its shadows on the picture), reflect a Picture Environment the objects mirror first. The same wiring as "Add a
 * picture with depth" on a March Loop card (nodes/recipes/depthRecipes.ts).
 */
function emitDepthPicture3D(ctx: Ctx, spec: SceneSpec, cam: GraphNode, scene: Ref, loop: GraphNode, shown: Ref): Ref {
  const d = spec.depth!;
  const src = findTex(spec.textures, d.tex);
  if (!src) { ctx.warnings.push(`The picture with depth reads “${d.tex}”, which the scene doesn't have: pick one under Light & colour → Picture with depth.`); return shown; }
  const tex = { nodeId: standInId(src), outputKey: 'texture' }, colour = { nodeId: standInId(src), outputKey: 'color' };
  const dn = mk(ctx, 'depth', 'depth', d.bake ? { update: 'baked', depthBake: structuredClone(d.bake) } : {}, { texture: tex },
    `Depth: how far each part of “${src.name}” is, worked out on this device by a small model. `
      + (d.bake ? 'Generate depth ran it once in the Scene Builder and kept it as an image beside the picture (Update: Baked).' : 'It runs once the model is downloaded (the card offers it); Bake depth keeps it.'));
  let sceneIn = shown;
  if (d.how === 'reflect') {
    const dir = exprBlock(ctx, 'depth:mirror', 'Mirror direction', [{ name: 'rd', type: 'vec3', from: ref(cam, 'rd') }, { name: 'normal', type: 'vec3', from: ref(loop, 'normal') }],
      'reflect(normalize(rd), normalize(normal))', 'Where a mirror at each hit point looks: the camera\'s ray bounced off the surface. Picture Environment reads the picture that way.');
    const env = mk(ctx, 'pictureEnvironment', 'depth:env', { fov: spec.camera.zoom, blur: 0.01 }, { picture: tex, dir: ref(dir, 'result'), forward: ref(cam, 'forward'), right: ref(cam, 'right'), up: ref(cam, 'up') },
      `Picture Environment: “${src.name}” as the room round the objects. Color is what a mirror sees, Ambient the picture's average colour. Outside the photo's frame it is mirrored back in.`);
    sceneIn = ref(exprBlock(ctx, 'depth:reflect', 'Reflect the picture', [
      { name: 'scene', type: 'vec3', from: shown }, { name: 'env', type: 'vec3', from: ref(env, 'color') }, { name: 'ambient', type: 'vec3', from: ref(env, 'ambient') },
      { name: 'normal', type: 'vec3', from: ref(loop, 'normal') }, { name: 'rd', type: 'vec3', from: ref(cam, 'rd') }, { name: 'hit', type: 'float', from: ref(loop, 'hit') },
      { name: 'reflectivity', type: 'float', slider: { value: 0.35, min: 0, max: 1 } }, { name: 'ambientMix', type: 'float', slider: { value: 0.5, min: 0, max: 1 } },
    ], 'mix(scene * mix(vec3(1.0), ambient * 1.6, ambientMix), env, clamp(hit * (reflectivity + (1.0 - reflectivity) * pow(1.0 - max(dot(-normalize(rd), normalize(normal)), 0.0), 5.0)), 0.0, 1.0))',
    'The objects mirror the picture: more at grazing angles (Schlick\'s Fresnel), at least Reflectivity facing you; Ambient Mix tints them by the picture\'s average colour.'), 'result');
  }
  const comp = mk(ctx, 'depthComposite', 'depth:composite', { nearD: d.near, farD: d.far, softness: d.soft },
    { picture: colour, nearness: ref(dn, 'depth'), scene: sceneIn, dist: ref(loop, 'dist'), hit: ref(loop, 'hit') },
    `Depth Composite: “${src.name}” and the scene, the nearer one at each pixel, so the objects pass behind and in front of what is in the picture. Nearest ${fmt(d.near)} and Farthest ${fmt(d.far)} say where the picture's near and far things are, in scene units: set them with Show: Picture distance.`);
  if (d.how === 'composite') return ref(comp, 'color');
  const only = exprBlock(ctx, 'depth:only', 'Only the picture', [{ name: 'front', type: 'float', from: ref(comp, 'front') }], '1.0 - front',
    '1 where the picture shows, 0 where an object is in front: the light relights the picture, not the objects (they have their own).', ctx.nodes, 'float');
  const light = mk(ctx, 'depthLight', 'depth:light', { nearD: d.near, farD: d.far, glowIntensity: 0.6, glowReach: 0.3 }, {
    picture: ref(comp, 'color'), nearness: ref(dn, 'depth'), ro: ref(cam, 'ro'), rd: ref(cam, 'rd'), mask: ref(only, 'result'), glow: scene, occluders: scene,
  }, 'Depth Light: the scene\'s light on the picture. The Glowing scene\'s shapes light it from where they are, and Shadows from lets the objects shade it. Link to scene object… on the card makes its point light follow a shape.');
  return ref(light, 'color');
}

/** The spec a built scene carries (on its Scene Group). */
export function metaOf(node: GraphNode | undefined | null): SceneBuilderMeta | null {
  const m = node?.params?.[META_KEY] as SceneBuilderMeta | undefined;
  return m && m.v === 1 && m.spec?.root ? m : null;
}

/** A stand-alone graph (with its own Output) for `spec`: examples and tests. */
export function buildStandaloneGraph(spec: SceneSpec, opts: { idFor?: (role: string) => string; outputId?: string } = {}): BuildResult & { outputId: string } {
  const built = buildSceneGraph(spec, opts.idFor);
  // Its pictures: a Texture node per source it reads, so it compiles alone (the previews bind the real
  // picture to it). A source nothing reads gets none: no unused node, and no sampler the GLSL compiler drops.
  const used = new Set(texturesUsed3D(spec));
  built.nodes.push(...standIns(spec.textures?.filter(s => used.has(s.name))));
  const scene = built.nodes.find(n => n.id === built.sceneId)!;
  scene.params = { ...scene.params, [META_KEY]: { v: 1, spec: structuredClone(spec) } satisfies SceneBuilderMeta };
  const last = built.nodes.find(n => n.id === built.final.nodeId)!;
  const outputId = opts.outputId ?? 'out';
  const def = getNodeDefinition('output')!;
  built.nodes.push({
    id: outputId, type: 'output', position: { x: last.position.x + 440, y: last.position.y },
    inputs: { color: { type: def.inputs.color.type, label: def.inputs.color.label, connection: { ...built.final } } },
    outputs: {}, params: {},
  });
  return { ...built, outputId };
}
