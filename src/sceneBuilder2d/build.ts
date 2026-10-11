/**
 * build.ts — a 2D Scene Builder scene as a real node graph (docs/scene-builder-2d-plan.md).
 *
 * The graph is what a skilled user would wire by hand:
 *
 *   UV ─► space transforms ─► per shape: Motion 2D ─► Transform ─► (ring: Angular Repeat ─► Transform)
 *                                  ─► Shape SDF ─► Offset / Onion ─► × scale ─► combines ─► distance
 *   background ─► (Glow Layer ─► Add) ─► SDF Fill, one pair per layer ─► Tone Map ─► post ─► Output
 *
 * Every node gets a plain-language note (`__comment`) and a role (`_sbRole`): a stable name for the
 * part of the spec it comes from (`s2:place` is shape s2's Transform, `p1` the first space
 * transform), so a rebuild can find the node again, keep its id (Play controls stay pointed at it)
 * and carry the user's own edits over. Numbers go on params, which compile to live uniforms:
 * dragging a generated slider never recompiles.
 *
 * Pure: ids come from `idFor`, positions from the layout here.
 */
import type { GraphNode, InputSocket } from '../types/nodeGraph';
import { getNodeDefinition } from '../nodes/definitions';
import { ROLE_KEY, mk, ref, tidy, type Ctx, type Ref } from '../sceneBuilder/build';
import { fmt } from '../sceneBuilder/recipe';
import { PALETTE_BY_KEY } from '../sceneBuilder/output';
import {
  MOTION_BY_KIND, SHAPE_BY_KIND, SPACE_BY_KIND, hasShapes, itemName, num, opLabel,
  type DupSpec, type Item, type MotionSpec, type Scene2D, type ShapeSpec, type SpaceOp, type Vec2, type Vec3,
} from './spec';
import { colourText } from '../lang/colours';
import { GRID_LABELS, gridProgram, type GridSpec } from './grid';
import { callBody, type FnRef } from './functions';
import { COMBINE_BY_MODE, blockGlslLines, checkBlock, clampTimes, type SpaceBlock } from './blocks';
import { BLOCK_BY_ID } from './blockLibrary';
import { FIT_LABELS, LUMA, findTex, fitLines, glf, newTexUse, picUv, sampleWrap, standInId, standIns, type TexSource, type TexUse } from '../builders/textures';

export { ROLE_KEY };
/** On the UV node: the scene it was built from (and, once applied, fingerprints of what was built). */
export const META_KEY_2D = 'sceneBuilder2D';

export interface Scene2DMeta {
  v: 1;
  spec: Scene2D;
  build?: string;
  /** role → fingerprint of the node as built (params and wires), to tell the user's edits apart. */
  built?: Record<string, string>;
}

export interface Build2DResult {
  nodes: GraphNode[];
  /** The node whose colour is the picture (what Output shows). */
  final: Ref;
  /** The UV node: it carries the spec. */
  sceneId: string;
  warnings: string[];
}

const rad = (deg: number) => Math.round(deg * Math.PI / 180 * 1e6) / 1e6;
const v2 = (v: Vec2) => `(${v.map(fmt).join(', ')})`;
const col = (c: Vec3) => colourText(c);

/** The nodes of a scene: the shared context while building. */
interface B {
  c: Ctx;
  spec: Scene2D;
  time: Ref | null;
  getTime: () => Ref;
  /** Each item's own point (after its placement, motion and ring): where a picture fill is read. */
  local: Map<string, Ref>;
}

// ── Pictures (builders/textures.ts) ─────────────────────────────────────────

/** The source a use names, and its Texture output; a warning (and null) when there is none. */
function texFor(b: B, name: string, what: string): { src: TexSource; out: Ref } | null {
  const src = findTex(b.spec.textures, name);
  if (!src) { b.c.warnings.push(`${what} reads the picture “${name}”, which the scene doesn't have: pick one under Pictures.`); return null; }
  return { src, out: { nodeId: standInId(src), outputKey: 'texture' } };
}

/** The frame's half-size: the picture is 2 tall and as wide as the screen. */
const SCREEN_EXT = 'vec2(u_resolution.x / u_resolution.y, 1.0)';

/**
 * A picture read in a box: q (a point, centred in the box of half-size `ext`) through the fit to a
 * place on the picture, then Sample (texture). Returns its colour, its alpha and whether q is on the
 * picture (Fit leaves a margin).
 */
function samplePicture(b: B, role: string, use: TexUse, src: TexSource, out: Ref, q: Ref, ext: string, where: string): { color: Ref; alpha: Ref; inside: Ref } {
  const { c } = b;
  const tile = use.fit === 'tile';
  const fit = expr(c, `${role}:fit`, 'Picture fit', [
    { name: 'q', type: 'vec2', from: q },
    { name: 'k', type: 'float', slider: { value: use.scale, min: tile ? 0.25 : 0.1, max: tile ? 16 : 8 } },
  ], picUv('st'),
  `Where ${where} reads the picture “${src.name}”: q is the point in its box (ext is the box's half-size${ext === SCREEN_EXT ? ', the whole frame' : ''}); the picture is ${fmt(src.aspect ?? 1)} wide for 1 tall. `
    + `${FIT_LABELS[use.fit].label}: ${FIT_LABELS[use.fit].blurb} k is ${tile ? 'how many times it repeats up the box' : 'a zoom, above 1 closer'} (live). `
    + 'st is the place on the picture (0 to 1 across); the result is that place in the picture coordinates Sample (texture) reads; inside is 0 off the picture.',
  'vec2', [{ lhs: 'vec2 ext', op: '=', rhs: ext }, ...fitLines(use.fit, 'q', 'ext', glf(src.aspect ?? 1), 'k')], [{ name: 'inside', type: 'float', label: 'Inside' }]);
  const s = mk(c, 'sampleTexture', `${role}:sample`, sampleWrap(use.fit), { texture: out, uv: ref(fit, 'result') },
    `Reads the picture “${src.name}” where the fit before it says: its colour and alpha there. Its Texture is wired from the picture's node, so a new picture there shows here.`);
  return { color: ref(s, 'color'), alpha: ref(s, 'alpha'), inside: ref(fit, 'inside') };
}

/** A shape's half-size in its own space, for fitting a picture to it. */
function extentOf(spec: Scene2D, it: Item): Vec2 {
  if (it.type === 'group') return [0.5, 0.5];
  const v = (k: string, d: number) => num(it.size[k], d);
  if (it.kind === 'picture') { const h = v('h', 0.6); const src = it.fill ? findTex(spec.textures, it.fill.tex) : undefined; return [h * (src?.aspect ?? 1), h]; }
  const size = it.size.size;
  if (Array.isArray(size)) return [Math.max(0.01, size[0]), Math.max(0.01, size[1])];
  if (it.kind === 'heart') return [1, 1];
  if (it.kind === 'vesica') return [v('w', 0.34), Math.max(0.01, v('h', 0.18) * 2)];
  if (it.kind === 'ring') return [v('r', 0.3) + v('th', 0.04), v('r', 0.3) + v('th', 0.04)];
  const r = Math.max(0.01, v('r', 0.3));
  return [r, r];
}

/** An Expression Block with typed inputs (wired, or a float slider) and a float or vec3 result. */
function expr(c: Ctx, role: string, label: string, inputs: Array<{ name: string; type: 'float' | 'vec2' | 'vec3'; from?: Ref; slider?: { value: number; min: number; max: number } }>, result: string, note: string, outputType: 'vec3' | 'vec2' | 'float' = 'vec3', lines: Array<{ lhs: string; op: string; rhs: string }> = [], outputs: Array<{ name: string; type: 'float' | 'vec2' | 'vec3'; label: string }> = []): GraphNode {
  const node: GraphNode = {
    id: c.idFor(role), type: 'exprNode', position: { x: 0, y: 0 },
    inputs: Object.fromEntries(inputs.map(i => [i.name, { type: i.type, label: i.name, ...(i.from ? { connection: { ...i.from } } : {}) } as InputSocket])),
    outputs: { result: { type: outputType, label: 'Result' }, ...Object.fromEntries(outputs.map(o => [o.name, { type: o.type, label: o.label }])) },
    params: {
      label, outputType, lines, result, expr: result,
      inputs: inputs.map(i => ({ name: i.name, type: i.type, slider: i.slider ? { min: i.slider.min, max: i.slider.max } : null })),
      ...Object.fromEntries(inputs.filter(i => i.slider).map(i => [i.name, i.slider!.value])),
      ...(outputs.length ? { outputs: outputs.map(o => o.name) } : {}),
      __comment: note, [ROLE_KEY]: role,
    },
  };
  c.nodes.push(node);
  return node;
}

/** A Custom Function node that carries a GLSL function (and its helpers) and calls it on p (and t). */
function fnNode(b: B, role: string, f: FnRef, pos: Ref, out: 'vec2' | 'float', note: string): GraphNode {
  const { c } = b;
  const inputs: Array<{ name: string; type: string; slider: null }> = [{ name: 'p', type: 'vec2', slider: null }, ...(f.timed ? [{ name: 't', type: 'float', slider: null }] : [])];
  const node: GraphNode = {
    id: c.idFor(role), type: 'customFn', position: { x: 0, y: 0 },
    inputs: {
      p: { type: 'vec2', label: 'p', connection: { ...pos } },
      ...(f.timed ? { t: { type: 'float', label: 't', connection: { ...b.getTime() } } as InputSocket } : {}),
    },
    outputs: { result: { type: out, label: 'Result' } },
    params: { label: f.name, inputs, outputType: out, body: callBody(f), glslFunctions: f.code, __comment: note, [ROLE_KEY]: role },
  };
  c.nodes.push(node);
  return node;
}

// ── Space ───────────────────────────────────────────────────────────────────

/** A transform block as an Expression Block: uv in, its lines (run `times` over), uv out; its numbers are sliders. */
function blockNode(b: B, role: string, block: SpaceBlock, pos: Ref, where: string): Ref | null {
  const { c } = b;
  const lines = blockGlslLines(block);
  const name = block.name || 'Block';
  if (!lines) {
    const chk = checkBlock(block);
    const why = [...chk.errors, ...chk.lines.filter(l => !l.ok).map(l => l.error!)][0] ?? 'it doesn\'t check';
    c.warnings.push(`${where} “${name}” was left out: ${why}`);
    return null;
  }
  const times = clampTimes(block.times);
  const entry = block.lib ? BLOCK_BY_ID[block.lib] : undefined;
  const sliders = block.params.map(p => `${p.name} ${fmt(p.value)}`);
  const note = `${name} (${where}): ${entry ? entry.blurb : 'a transform block written in the 2D Scene Builder.'} `
    + `Each line changes uv, the point every shape below looks from, top to bottom${times > 1 ? `; the ${lines.length / times} line${lines.length / times === 1 ? ' is' : 's are'} written out ${times} times, so the fold runs ${times} times over` : ''}. `
    + 'In the builder x and y stand for uv.x and uv.y (written out here), t is time in seconds, and whole numbers are written as floats. '
    + `${sliders.length ? `The sliders (${sliders.join(', ')}) are live: drag them on the node without recompiling.` : 'It has no sliders: select a number in a line to make one.'}`;
  const node = expr(c, role, name, [
    { name: 'uv', type: 'vec2', from: pos },
    ...block.params.map(p => ({ name: p.name, type: 'float' as const, slider: { value: p.value, min: p.min, max: p.max } })),
  ], 'uv', note, 'vec2', lines);
  return ref(node, 'result');
}

function spaceNode(b: B, op: SpaceOp, pos: Ref): Ref {
  const { c } = b;
  if (op.kind === 'block') {
    if (!op.block) { c.warnings.push(`The block ${op.id} is empty; left out.`); return pos; }
    return blockNode(b, op.id, op.block, pos, `space ${op.id}`) ?? pos;
  }
  if (op.kind === 'combine') {
    const k = op.combine;
    if (!k) { c.warnings.push(`The combine ${op.id} is empty; left out.`); return pos; }
    const m = COMBINE_BY_MODE[k.mode] ?? COMBINE_BY_MODE.add;
    const A = blockNode(b, `${op.id}:a`, k.a, pos, `block A of ${op.id}`) ?? pos;
    const B2 = blockNode(b, `${op.id}:b`, k.b, pos, `block B of ${op.id}`) ?? pos;
    const an = k.a.name || 'A', bn = k.b.name || 'B';
    const node = expr(c, op.id, `${m.label} blocks`, [
      { name: 'uv', type: 'vec2', from: pos },
      { name: 'a', type: 'vec2', from: A },
      { name: 'b', type: 'vec2', from: B2 },
      ...(k.mode === 'blend' ? [{ name: 'amount', type: 'float' as const, slider: { value: k.amount, min: 0, max: 1 } }] : []),
    ], m.glsl, `${m.label} (space ${op.id}): joins two blocks that both start from the same uv. a is “${an}”, b is “${bn}”, uv the point before either. ${m.blurb} `
      + `${k.mode === 'add' ? 'a + b − uv adds the two pushes (each block\'s change from uv).' : k.mode === 'subtract' ? 'uv + a − b keeps A\'s push and takes B\'s away.' : k.mode === 'multiply' ? 'a * b multiplies x by x and y by y.' : 'Amount is live: 0 is all A, 1 is all B.'} The result is the uv every shape below looks from.`, 'vec2');
    return ref(node, 'result');
  }
  const def = SPACE_BY_KIND[op.kind];
  if (!def) { c.warnings.push(`A space transform “${op.kind}” isn't known; left out.`); return pos; }
  const v = op.values;
  const words: string[] = [];
  if (def.select) words.push(`${def.select.label} ${v[def.select.key] ?? def.select.def}`);
  for (const p of def.params) {
    const x = v[p.key] ?? p.def;
    words.push(`${p.label} ${Array.isArray(x) ? v2(x as Vec2) : fmt(Number(x))}${p.deg ? '°' : ''}`);
  }
  const note = (extra = '') => `${def.label} (space ${op.id}): ${def.blurb}${words.length ? ` ${words.join(', ')}.` : ''}${extra} It changes where every shape below it looks, not the shapes themselves.`;
  const n1 = (k: string, d: number) => num(v[k], d);
  switch (op.kind) {
    case 'fn': {
      const f: FnRef = { name: String(v.name ?? 'f'), code: String(v.code ?? ''), timed: num(v.timed, 1) > 0, from: String(v.from ?? '') };
      if (!f.code) { c.warnings.push(`The function space transform ${op.id} has no code; left out.`); return pos; }
      return ref(fnNode(b, op.id, f, pos, 'vec2', `${f.name} (space ${op.id}, ${f.from || 'a function'}): bends space through this GLSL function, vec2 ${f.name}(vec2 p${f.timed ? ', float t' : ''}). The function is in the node's helpers; the body calls it. Edit either to change what it does. It changes where every shape below it looks.`), 'result');
    }
    case 'zoom': {
      // A Transform (Place mode) scaled by the zoom: the point is divided by it, so the picture magnifies.
      const by = Math.max(0.01, n1('by', 1.5));
      return ref(mk(c, 'transform', op.id, { dim: '2', scale: by }, { p: pos }, note(` Transform divides the coordinates by its Scale ${fmt(by)}: smaller coordinates magnify.`)), 'p');
    }
    case 'move': {
      const by = (Array.isArray(v.by) ? v.by : [0, 0]) as Vec2;
      return ref(mk(c, 'transform', op.id, { dim: '2', x: by[0], y: by[1] }, { p: pos }, note(' Transform moves the picture by its Move X and Y (the coordinates are shifted the other way).')), 'p');
    }
    case 'rotate': {
      // Apply mode turns the point itself (as Rotate 2D did), so the picture turns the other way round.
      const deg = n1('angle', 30), spin = n1('spin', 0);
      if (!spin) return ref(mk(c, 'transform', op.id, { dim: '2', mode: 'space', rotate: deg }, { p: pos }, note()), 'p');
      const w = mk(c, 'multiply', `${op.id}:spin`, { b: Math.round(spin * 2 * Math.PI * 1e6) / 1e6 }, { a: b.getTime() }, `Spin for ${op.id}: time × ${fmt(spin)} turns a second in radians (2π × ${fmt(spin)}), into the Transform's Turn.`);
      return ref(mk(c, 'transform', op.id, { dim: '2', mode: 'space', rotate: deg }, { p: pos, turn: ref(w, 'result') }, note(' Its Turn is wired from the spin below.')), 'p');
    }
    case 'wave': {
      const speed = n1('speed', 0);
      let t: Ref | null = null;
      if (speed) {
        t = speed === 1 ? b.getTime() : ref(mk(c, 'multiply', `${op.id}:t`, { b: speed }, { a: b.getTime() }, `Time × ${fmt(speed)}: how fast ${op.id}'s waves travel.`), 'result');
      }
      const f = n1('freq', 5), a = n1('amp', 0.1);
      return ref(mk(c, 'rippleSpace', op.id, { freqX: f, freqY: f, ampX: a, ampY: a }, { input: pos, time: t }, note()), 'output');
    }
    case 'warp': {
      const speed = n1('speed', 0);
      return ref(mk(c, 'domainWarp', op.id, { strength: n1('amount', 0.3), scale: n1('scale', 1.5), time_scale: speed }, { uv: pos, time: speed ? b.getTime() : null }, note(speed ? ' Time is wired so the noise drifts.' : '')), 'uv');
    }
    case 'fisheye':
      return ref(mk(c, 'sphericalSpace', op.id, { strength: n1('amount', 0.5), mode: 'fisheye' }, { input: pos }, note()), 'output');
    default: {
      const params: Record<string, unknown> = {};
      for (const p of def.params) {
        if (!p.param) continue;
        const x = v[p.key] ?? p.def;
        if (Array.isArray(p.param)) {
          const arr = Array.isArray(x) ? x : [Number(x), Number(x)];
          p.param.forEach((k, i) => { params[k] = arr[i]; });
        } else params[p.param] = p.deg ? rad(Number(x)) : Number(x);
      }
      if (def.select) params[def.select.param] = String(v[def.select.key] ?? def.select.def);
      return ref(mk(c, def.type, op.id, params, { [def.posIn]: pos }, note()), def.posOut);
    }
  }
}

// ── Items ───────────────────────────────────────────────────────────────────

const TYPE_OF_OP = { union: 'sdfUnion', subtract: 'sdfSubtract', intersect: 'sdfIntersect' } as const;

function motionWords(m: MotionSpec): string {
  const d = MOTION_BY_KIND[m.kind];
  return `${d.label.toLowerCase()} ${fmt(m.speed)} cycles a second${d.amount ? `, ${d.amount.label.toLowerCase()} ${fmt(m.amount)}` : ''}${m.phase ? `, starting ${fmt(m.phase)}° in` : ''}`;
}

/** An item's Motion 2D chain: what to wire into its Transform. */
function emitMotion(b: B, it: Item, name: string): { offset: Ref | null; turn: Ref | null; grow: Ref | null } {
  const { c } = b;
  let last: GraphNode | null = null;
  let hasOffset = false, hasTurn = false, hasGrow = false;
  for (const m of it.motion) {
    const d = MOTION_BY_KIND[m.kind];
    const wires: Record<string, Ref | null> = { time: b.getTime() };
    if (last) {
      if (hasOffset) wires.offset = ref(last, 'offset');
      if (hasTurn) wires.turn = ref(last, 'turn');
      if (hasGrow) wires.grow = ref(last, 'grow');
    }
    last = mk(c, 'motion2D', m.id, { mode: m.kind, speed: m.speed, amount: m.amount, phase: m.phase, direction: m.dir }, wires,
      `${d.label} on ${name}: ${d.blurb} ${motionWords(m)}. Wired into ${name}'s Transform${it.motion.length > 1 ? '; motions are chained, each adds to the one before' : ''}.`);
    if (m.kind === 'orbit' || m.kind === 'bob') hasOffset = true;
    if (m.kind === 'spin') hasTurn = true;
    if (m.kind === 'pulse') hasGrow = true;
  }
  return { offset: last && hasOffset ? ref(last, 'offset') : null, turn: last && hasTurn ? ref(last, 'turn') : null, grow: last && hasGrow ? ref(last, 'grow') : null };
}

interface Branch { pos: Ref; scales: Ref[] }

/** The ring array of an item from `start`: Angular Repeat, then Transform out to the radius (twice for rings of rings). */
function emitRing(b: B, it: Item, dup: DupSpec, start: Branch, k: number, name: string): Branch {
  const { c } = b;
  const suffix = dup.levels > 1 ? `:${k}` : '';
  let { pos } = start;
  const scales = [...start.scales];
  // The whole ring at a bigger (or smaller) size.
  if (dup.levels > 1 && k > 0) {
    const s = Math.round(Math.pow(dup.factor, k) * 1e6) / 1e6;
    const lv = mk(c, 'transform', `${it.id}:size${suffix}`, { dim: '2', scale: s }, { p: pos },
      `Size ${k + 1} of ${dup.levels} for ${name}'s ring: the whole ring drawn ${fmt(s)}× as big (${fmt(dup.factor)} to the power ${k}). The ring is drawn once per size and the sizes are joined.`);
    pos = ref(lv, 'p');
    scales.push(ref(lv, 'scale'));
  }
  const ring = mk(c, 'angularRepeat2D', `${it.id}:ring${suffix}`, { count: dup.count }, { input: pos },
    `Ring of ${dup.count} for ${name}: repeats space ${dup.count} times round the centre, like slices of a cake, so one shape becomes ${dup.count}.`);
  const out = mk(c, 'transform', `${it.id}:ring-at${suffix}`, { dim: '2', x: dup.radius }, { p: ref(ring, 'output') },
    `Puts each copy of ${name} ${fmt(dup.radius)} out from the centre of its ring (Move X ${fmt(dup.radius)}). Change it to make the ring wider or tighter.`);
  pos = ref(out, 'p');
  if (dup.inner) {
    const r2 = mk(c, 'angularRepeat2D', `${it.id}:inner${suffix}`, { count: dup.inner.count }, { input: pos },
      `Rings of rings for ${name}: each of the ${dup.count} copies is itself a ring of ${dup.inner.count}.`);
    const o2 = mk(c, 'transform', `${it.id}:inner-at${suffix}`, { dim: '2', x: dup.inner.radius }, { p: ref(r2, 'output') },
      `Puts each copy of the inner ring ${fmt(dup.inner.radius)} out from the centre of its inner ring.`);
    pos = ref(o2, 'p');
  }
  return { pos, scales };
}

function shapeNode(b: B, sh: ShapeSpec, pos: Ref, name: string, sfx = ''): Ref {
  const { c } = b;
  const def = SHAPE_BY_KIND[sh.kind];
  const params: Record<string, unknown> = {};
  for (const p of def.params) {
    if (!p.param) continue;
    const x = sh.size[p.key] ?? p.def;
    if (Array.isArray(p.param)) {
      const arr = Array.isArray(x) ? x : [Number(x), Number(x)];
      p.param.forEach((k, i) => { params[k] = arr[i]; });
    } else params[p.param] = p.deg ? rad(Number(x)) : Number(x);
  }
  const words = def.params.filter(p => p.param !== '' || def.kind === 'ring').map(p => {
    const x = sh.size[p.key] ?? p.def;
    return `${p.label.toLowerCase()} ${Array.isArray(x) ? v2(x as Vec2) : fmt(Number(x))}`;
  }).join(', ');
  const note = `${name}: a ${def.label.toLowerCase()}${words ? `, ${words}` : ''}. ${def.blurb} It gives the distance from the point to its edge: negative inside, positive outside.`;
  if (def.shape === 'fn') {
    if (!sh.fn?.code) { c.warnings.push(`${name} has no function; drawn as a circle.`); return ref(mk(c, 'shapeSDF', `${sh.id}${sfx}`, { shape: 'circle', r: 0.3 }, { p: pos }, `${name}: a circle (its function is missing).`), 'distance'); }
    const f = sh.fn;
    return ref(fnNode(b, `${sh.id}${sfx}`, f, pos, 'float', `${name}: a shape measured by the GLSL function ${f.name} (${f.from || 'a function'}), float ${f.name}(vec2 p${f.timed ? ', float t' : ''}): negative inside, positive outside. The function is in the node's helpers; edit it to change the shape.`), 'result');
  }
  if (def.shape === 'ring') {
    const hair = mk(c, 'ringSDF', `${sh.id}${sfx}`, { radius: params.radius }, { position: pos }, `${name}: a ring of radius ${fmt(Number(params.radius))}. Ring SDF is a hairline (the distance to a circle line); the Offset after it gives it thickness.`);
    const th = Number(sh.size.th ?? 0.04);
    const fat = mk(c, 'sdfOffset', `${sh.id}:th${sfx}`, { amount: -th }, { sdf: ref(hair, 'distance') }, `Thickens ${name}'s line: an Offset of ${fmt(-th)} pushes the edge out by ${fmt(th)} each side of the hairline.`);
    return ref(fat, 'result');
  }
  if (def.kind === 'picture') {
    const [rx, ry] = extentOf(b.spec, sh);
    if (!sh.fill) c.warnings.push(`${name} has no picture yet: pick one for it under Picture.`);
    const n = mk(c, 'shapeSDF', `${sh.id}${sfx}`, { shape: 'box', rx: Math.round(rx * 1e6) / 1e6, ry }, { p: pos },
      `${name}: a picture layer, a box ${fmt(rx * 2)} wide and ${fmt(ry * 2)} tall (the picture's shape), painted with ${sh.fill ? `“${sh.fill.tex}”` : 'a picture'} where it is drawn. It gives the distance to the box's edge: negative inside.`);
    return ref(n, 'distance');
  }
  const n = mk(c, 'shapeSDF', `${sh.id}${sfx}`, { shape: def.shape, ...params }, { p: pos }, note);
  return ref(n, 'distance');
}

/**
 * An item's distance from `pos`: placement (Motion 2D → Transform), the ring array, the shape or the
 * combine of its children, Round and Outline, and the distance put right for any scaling.
 */
function emitItem(b: B, it: Item, pos: Ref, depth: number): Ref | null {
  const { c, spec } = b;
  const name = `‘${itemName(spec, it)}’`;
  if (it.type === 'group' && !it.children.length) { c.warnings.push(`${name} has nothing in it; left out.`); return null; }
  const def = it.type === 'shape' ? SHAPE_BY_KIND[it.kind] : null;
  if (it.type === 'shape' && !def) { c.warnings.push(`${name}: “${it.kind}” isn't a shape the builder knows; left out.`); return null; }
  const unit = def?.unit ? Number((it as ShapeSpec).size.size ?? def.params[0].def) : 1;
  const pulse = it.motion.some(m => m.kind === 'pulse');
  const baseScale = it.scale * unit;
  const placed = it.at[0] !== 0 || it.at[1] !== 0 || it.rot !== 0 || baseScale !== 1 || it.motion.length > 0;
  let start: Branch = { pos, scales: [] };
  if (placed) {
    const mo = emitMotion(b, it, name);
    const wires: Record<string, Ref | null> = { p: pos, offset: mo.offset, turn: mo.turn, grow: mo.grow };
    const bits: string[] = [];
    if (it.at[0] || it.at[1]) bits.push(`moved to ${v2(it.at)}`);
    if (it.rot) bits.push(`turned ${fmt(it.rot)}°`);
    if (baseScale !== 1) bits.push(def?.unit ? `sized ${fmt(unit)} (a ${def.label.toLowerCase()} has no radius of its own, so its size is this node's Scale)` : `scaled ${fmt(it.scale)}×`);
    if (it.motion.length) bits.push('moved by its motion');
    const pl = mk(c, 'transform', `${it.id}:place`, { dim: '2', x: it.at[0], y: it.at[1], rotate: it.rot, scale: baseScale }, wires,
      `Places ${name}: ${bits.join(', ')}. Transform gives the shape a new view of space: the shape is measured from the point as it sees it, so it ends up where the node says. Its Scale output multiplies the distance back to the picture's units.`);
    start = { pos: ref(pl, 'p'), scales: baseScale !== 1 || pulse ? [ref(pl, 'scale')] : [] };
  }
  const dup = it.dup && it.dup.count >= 2 ? it.dup : null;
  const levels = dup ? Math.max(1, Math.min(6, Math.round(dup.levels))) : 1;
  const branches: Ref[] = [];
  for (let k = 0; k < levels; k++) {
    const br = dup ? emitRing(b, it, { ...dup, levels }, start, k, name) : start;
    if (k === 0) b.local.set(it.id, br.pos);
    const sfx = levels > 1 ? `:${k}` : '';
    let dist: Ref | null;
    if (it.type === 'shape') dist = shapeNode(b, it, br.pos, name, sfx);
    else {
      // Each size of a ring draws the children again, so their roles carry the size.
      const outer = c.rolePrefix;
      if (levels > 1) c.rolePrefix = `${outer ?? ''}L${k}:`;
      const parts = it.children.map(ch => ({ ch, d: emitItem(b, ch, br.pos, depth + 1) })).filter((x): x is { ch: Item; d: Ref } => x.d !== null);
      c.rolePrefix = outer;
      if (!parts.length) return null;
      dist = parts[0].d;
      const names = parts.map(x => `‘${itemName(spec, x.ch)}’`);
      parts.slice(1).forEach(({ d }, i) => {
        const n = mk(c, TYPE_OF_OP[it.op], `${it.id}:op${i + 1}${sfx}`, { k: it.k }, { a: dist!, b: d },
          `${opLabel(it)} in ${name}: ${it.op === 'union' ? `${it.k > 0 ? 'melts' : 'joins'} ${names[0]}${i ? ' (and the ones before)' : ''} and ${names[i + 1]}` : it.op === 'subtract' ? `cuts ${names[i + 1]} out of ${names[0]}${i ? ' (and the cuts before)' : ''}` : `keeps only where ${names[0]}${i ? ' (and the ones before)' : ''} and ${names[i + 1]} overlap`}.${it.k > 0 ? ` Blend radius ${fmt(it.k)} is how wide the join is.` : ''}`);
        dist = ref(n, 'dist');
      });
    }
    if (it.inflate > 0) dist = ref(mk(c, 'sdfOffset', `${it.id}:inflate${sfx}`, { amount: -it.inflate }, { sdf: dist }, `Inflate on ${name}: an Offset of ${fmt(-it.inflate)} grows the edge out by ${fmt(it.inflate)} and rounds its corners.`), 'result');
    if (it.hollow > 0) dist = ref(mk(c, 'sdfOnion', `${it.id}:hollow${sfx}`, { r: it.hollow }, { dist }, `Outline on ${name}: Onion turns the solid into a line ${fmt(it.hollow)} thick, abs(distance) − ${fmt(it.hollow)}.`), 'dist');
    br.scales.forEach((s, i) => {
      dist = ref(mk(c, 'multiply', `${it.id}:fix${sfx}${br.scales.length > 1 ? `-${i}` : ''}`, {}, { a: dist!, b: s },
        `Puts ${name}'s distance back in the picture's units: multiplies it by the scale it was drawn at (the Scale output of its Transform), so combines, glow and outlines measure true.`), 'result');
    });
    branches.push(dist!);
  }
  let out = branches[0];
  branches.slice(1).forEach((d, i) => {
    out = ref(mk(c, 'sdfUnion', `${it.id}:sizes${i + 1}`, { k: 0 }, { a: out, b: d }, `Joins the ring of ${name} at size ${i + 2} to the sizes before it: the same ring repeated at bigger scales.`), 'dist');
  });
  return out;
}

// ── Colour, glow, composite ─────────────────────────────────────────────────

/** A palette (cosine or ramp) from the colour-by settings: `value` through it. */
export function paletteNode(c: Ctx, role: string, key: string, value: Ref, anim: Ref | null, scale: number, speed: number, note: string): Ref {
  const pal = PALETTE_BY_KEY[key] ?? PALETTE_BY_KEY.sunset;
  if (pal.kind === 'palette') {
    return ref(mk(c, 'palette', role, { preset: String(pal.preset ?? 0), scale, speed }, { value, anim }, `${note} The ${pal.label} palette (a cosine palette).`), 'color');
  }
  const stops = pal.stops ?? [[0, 0, 0], [1, 1, 1]];
  return ref(mk(c, 'colorRamp', role, { stops: String(stops.length), ...Object.fromEntries(stops.map((s, i) => [`color${i}`, [...s]])) }, { t: value }, `${note} The ${pal.label} ramp (${stops.length} stops).`), 'color');
}

const DRIVERS: Record<string, { code: string; what: string }> = {
  length: { code: 'length(uv)', what: 'how far each point is from the centre' },
  angle: { code: 'abs(atan(uv.y, uv.x)) / 3.14159265', what: 'the angle of each point round the centre, 0 on the right to 1 on the left, the bottom half mirroring the top so there is no seam' },
  x: { code: 'uv.x * 0.5 + 0.5', what: 'how far across each point is' },
  y: { code: 'uv.y * 0.5 + 0.5', what: 'how far up each point is' },
};

/**
 * The graph for `spec`. `idFor(role)` names each node (a rebuild passes the ids the nodes had).
 * The result has no Output node: `final` is what to wire into it.
 */
export function buildScene2D(spec: Scene2D, idFor: (role: string) => string = role => `sb2_${role.replace(/[^A-Za-z0-9]/g, '_')}`): Build2DResult {
  const c: Ctx = { spec: undefined as never, idFor, nodes: [], warnings: [] };
  const L = spec.look;
  const b: B = { c, spec, time: null, local: new Map(), getTime: () => {
    if (!b.time) b.time = ref(mk(c, 'time', 'time', {}, {}, 'Time in seconds: it drives every motion, spin and drifting warp in this scene.'), 'time');
    return b.time;
  } };
  if (!hasShapes(spec)) c.warnings.push('The scene has no shapes yet: add one under Shapes.');

  const uv = mk(c, 'uv', 'uv', {}, {}, `The picture's coordinates: the centre is (0, 0), the top is 1 and the bottom −1. Built by the 2D Scene Builder${spec.space.length ? `; ${spec.space.length} space transform${spec.space.length === 1 ? '' : 's'} follow` : ''}. Right-click → Edit in 2D Scene Builder, or use Rebuild from recipe on its Recipe chip.`);
  const screen = ref(uv, 'uv');
  let pos = screen;
  for (const op of spec.space) pos = spaceNode(b, op, pos);

  // Distances, one per layer.
  const layers = spec.layers.map(it => ({ it, d: emitItem(b, it, pos, 0) })).filter((x): x is { it: Item; d: Ref } => x.d !== null);

  // Colour: each layer's own, or a palette driven by something about the picture.
  const by = L.colour.by;
  let sharedColour: Ref | null = null;
  const anim = by === 'time' ? b.getTime() : L.colour.speed ? b.getTime() : null;
  if (by !== 'layer' && by !== 'distance') {
    const driver = by === 'time' ? null : DRIVERS[by];
    const value = driver ? ref(expr(c, 'drive', `Colour by ${by}`, [{ name: 'uv', type: 'vec2', from: pos }], driver.code, `The number the palette is read with: ${driver.what}, in the warped space. Colour → by ${by}.`, 'float'), 'result') : null;
    const speed = by === 'time' ? (L.colour.speed || 0.2) : L.colour.speed;
    sharedColour = paletteNode(c, 'palette', L.colour.palette, value ?? ref(mk(c, 'constant', 'drive', { value: 0 }, {}, 'Nothing drives the palette but time.'), 'value'), anim, L.colour.scale, speed,
      `Colours every layer: ${driver ? driver.what : 'time'} read through a palette${speed ? `, moving at ${fmt(speed)}` : ''}.`);
  }

  const bg = mk(c, 'colorPicker', 'bg', { color: [...L.bg] }, {}, `The background colour, ${col(L.bg)}: what shows where no shape is.`);
  let acc: Ref = ref(bg, 'rgb');
  if (L.bgTex) {
    const t = texFor(b, L.bgTex.tex, 'The background');
    if (t) {
      const warped = L.bgTex.warp && spec.space.length > 0;
      const pic = samplePicture(b, 'bgpic', L.bgTex, t.src, t.out, L.bgTex.warp ? pos : screen, SCREEN_EXT, 'the background');
      acc = ref(expr(c, 'bgpic', 'Background picture', [
        { name: 'bg', type: 'vec3', from: acc }, { name: 'tex', type: 'vec3', from: pic.color }, { name: 'a', type: 'float', from: pic.alpha }, { name: 'inside', type: 'float', from: pic.inside },
      ], 'mix(bg, tex, clamp(a, 0.0, 1.0) * inside)',
      `The picture “${t.src.name}” behind every layer, over the background colour (which shows where the picture is see-through or, with Fit, round it). `
        + `${warped ? 'It is read at the warped point: every space transform and block above bends it, so warping the picture is adding a block.' : L.bgTex.warp ? 'It is read at the warped point: add a space transform or block to bend it.' : 'It is read at the screen\'s point, so the space transforms leave it as it is.'}`), 'result');
    }
  }
  const glowTint = L.glow.tint ? ref(mk(c, 'colorPicker', 'glowtint', { color: [...L.glow.tint] }, {}, `The glow's colour, ${col(L.glow.tint)}, for every glowing layer. Clear Tint in the builder to glow in each layer's own colour.`), 'rgb') : null;
  for (const { it, d } of layers) {
    const name = `‘${itemName(spec, it)}’`;
    const behind = acc;
    let fill: Ref;
    if (sharedColour) fill = sharedColour;
    else if (by === 'distance') {
      fill = paletteNode(c, `${it.id}:palette`, L.colour.palette, d, anim, L.colour.scale, L.colour.speed, `Colours ${name} by its distance field, so it comes out in bands that follow its outline.`);
    } else fill = ref(mk(c, 'colorPicker', `${it.id}:color`, { color: [...it.color] }, {}, `${name}'s colour, ${col(it.color)}.`), 'rgb');
    // A picture fill: read at the layer's own point, so the picture moves, turns and repeats with it.
    const t = it.fill ? texFor(b, it.fill.tex, name) : null;
    if (t && it.fill) {
      const pic = samplePicture(b, `${it.id}:tex`, it.fill, t.src, t.out, b.local.get(it.id) ?? pos, `vec2(${extentOf(spec, it).map(glf).join(', ')})`, name);
      fill = ref(expr(c, `${it.id}:paint`, 'Picture fill', [
        { name: 'base', type: 'vec3', from: fill }, { name: 'tex', type: 'vec3', from: pic.color }, { name: 'a', type: 'float', from: pic.alpha }, { name: 'inside', type: 'float', from: pic.inside },
      ], 'mix(base, tex, clamp(a, 0.0, 1.0) * inside)',
      `${name} painted with the picture “${t.src.name}”: the picture where it is opaque, ${name}'s own colour where it is see-through or (with Fit) round it. `
        + 'It is read at the layer\'s own point (after its place, motion and ring of copies), so the picture moves, turns and repeats with it and bends with every space transform above.'), 'result');
    }
    const glows = L.glow.mode === 'all' || (L.glow.mode === 'selected' && it.glow);
    if (glows) {
      const g = mk(c, 'glowLayer', `${it.id}:glow`, { intensity: L.glow.amount, power: L.glow.falloff }, { d, color: glowTint ?? fill },
        `The glow of ${name}: its colour × (${fmt(L.glow.amount)} ÷ distance) ^ ${fmt(L.glow.falloff)}. A bigger Intensity reaches further; a bigger Power makes it fall off faster. It is added to what is behind, then the shape is painted over it.`);
      acc = ref(mk(c, 'addColor', `${it.id}:addglow`, {}, { a: acc, b: ref(g, 'result') }, `Adds ${name}'s glow to what is behind it. Light adds up, so it can go past 1; Tone Map brings it back.`), 'result');
    }
    acc = ref(mk(c, 'sdfFill', `${it.id}:fill`, {}, { d, fillColor: fill, background: acc },
      `Paints ${name} over what is behind it: inside the distance is negative, so the fill colour shows there; the edge is anti-aliased by one pixel.`), 'result');
    // A picture mask: the layer (and its glow) only where the picture is bright.
    const m = it.mask ? texFor(b, it.mask.tex, `${name}'s mask`) : null;
    if (m && it.mask) {
      const pic = samplePicture(b, `${it.id}:mask`, { tex: m.src.name, fit: 'cover', scale: 1 }, m.src, m.out, screen, SCREEN_EXT, `${name}'s mask`);
      acc = ref(expr(c, `${it.id}:masked`, 'Picture mask', [
        { name: 'behind', type: 'vec3', from: behind }, { name: 'layer', type: 'vec3', from: acc },
        { name: 'tex', type: 'vec3', from: pic.color }, { name: 'a', type: 'float', from: pic.alpha }, { name: 'inside', type: 'float', from: pic.inside },
        { name: 'cut', type: 'float', slider: { value: it.mask.cut, min: 0, max: 1 } },
      ], 'mix(behind, layer, m)',
      `${name} only where the picture “${m.src.name}” (over the whole frame) is ${it.mask.invert ? 'dark' : 'bright'}: l is its brightness (times its alpha), m how much of the layer shows, softly round cut (live). `
        + 'behind is the picture before this layer, layer the picture with it and its glow.', 'vec3', [
        { lhs: 'float l', op: '=', rhs: `${LUMA('tex')} * clamp(a, 0.0, 1.0) * inside` },
        { lhs: 'float m', op: '=', rhs: 'smoothstep(cut - 0.05, cut + 0.05, l)' },
        ...(it.mask.invert ? [{ lhs: 'm', op: '=', rhs: '1.0 - m' }] : []),
      ]), 'result');
    }
  }
  if (spec.grid) acc = emitGrid(b, spec.grid, pos, screen, acc, anim);
  let final = acc;
  if (L.tone !== 'none') final = ref(mk(c, 'toneMap', 'tone', { mode: L.tone }, { color: final }, `Squeezes the bright, linear light into colours a screen can show (${L.tone.toUpperCase()}) without clipping highlights.`), 'color');
  const P = L.post;
  if (P.bloom > 0) final = ref(mk(c, 'bloom', 'bloom', { intensity: P.bloom, threshold: 0.35 }, { color: final, uv: screen }, `Bloom: bright areas bleed light into their surroundings. Intensity ${fmt(P.bloom)}.`), 'result');
  if (P.vignette > 0) final = ref(mk(c, 'vignette', 'vignette', { strength: P.vignette }, { color: final, uv: screen }, `Vignette: darkens the corners. Strength ${fmt(P.vignette)}.`), 'result');
  if (P.scanlines > 0) final = ref(mk(c, 'scanlines', 'scanlines', { intensity: P.scanlines }, { color: final, uv: screen }, `Scanlines: thin dark lines across the picture. Intensity ${fmt(P.scanlines)}.`), 'result');
  if (P.grain > 0) final = ref(mk(c, 'grain', 'grain', { amount: P.grain }, { color: final, uv: screen }, `Film grain: a little noise over everything. Amount ${fmt(P.grain)}.`), 'color');

  // Another output: a measurement instead of the picture (the picture's nodes stay, unwired).
  const o = spec.output;
  if (o && o.show !== 'picture') final = emitOutput(b, o.show, o.palette, layers.map(l => l.d), pos, final);

  tidy(c.nodes, 0, 0);
  // The UV node carries the scene; it is the one place its Recipe chip shows.
  return { nodes: c.nodes, final, sceneId: uv.id, warnings: c.warnings };
}

/** The grid (grid.ts): one Expression Block for the cells, then colour, glow and fill over what is behind. */
function emitGrid(b: B, g: GridSpec, pos: Ref, screen: Ref, behind: Ref, anim: Ref | null): Ref {
  const { c, spec } = b;
  const L = spec.look;
  const prog = gridProgram(g);
  const shapes = g.shapes.join(', ');
  const inputs: Parameters<typeof expr>[3] = [
    { name: 'uv', type: 'vec2', from: pos },
    { name: 't', type: 'float', from: b.getTime() },
  ];
  if (prog.usesMouse) inputs.push({ name: 'mouse', type: 'vec2', from: ref(mk(c, 'mouse', 'grid:mouse', {}, {}, 'The mouse position, in the same space as UV: one of the grid\'s ripples starts here, so the waves follow the pointer.'), 'uv') });
  inputs.push(
    { name: 'size', type: 'float', slider: { value: g.size, min: 0.05, max: 1.5 } },
    { name: 'amount', type: 'float', slider: { value: g.amount, min: 0, max: 1.5 } },
    { name: 'freq', type: 'float', slider: { value: g.freq, min: 0, max: 40 } },
    { name: 'speed', type: 'float', slider: { value: g.speed, min: -3, max: 3 } },
  );
  const rip = g.ripples.map(r => (r.from === 'point' ? `the point (${r.at.map(fmt).join(', ')})` : GRID_LABELS.from[r.from].toLowerCase())).join(' and ');
  const ge = expr(c, 'grid', 'Grid', inputs, prog.result,
    `The grid: ${g.cols} × ${g.rows} cells across ±${fmt(g.span)}, each holding a ${shapes.includes(',') ? `shape (${shapes}, given out ${GRID_LABELS.assign[g.assign].toLowerCase()})` : g.shapes[0]}. ` +
    `Line by line: cs is a cell's size; id which cell this point is in (column, row); inGrid is 1 inside the grid; cc the cell's centre and q the point measured from it. ` +
    `w is the ripple: a sine of the distance from ${rip} to the cell's centre, moving with time (freq rings per unit, speed cycles a second), averaged, −1..1. ` +
    `It changes ${g.target === 'none' ? 'nothing but the colour' : GRID_LABELS.target[g.target].toLowerCase()} by amount. s is the shape's size (size × half a cell); k which shape the cell gets; d0… each shape's distance; d the one the cell uses (0 inside the grid's edge, far outside it). ` +
    'The result packs three numbers: x the distance, y the ripple 0..1, z the shape (or a random per-cell value) 0..1. The sliders are live.'
    + (g.pic && prog.place ? ` place is where its picture is read (${GRID_LABELS.pic[g.pic.mode].label.toLowerCase()}): ${g.pic.mode === 'matte' ? 'the cell\'s centre, one colour a shape' : g.pic.mode === 'piece' ? 'the cell\'s centre plus q, turned and pushed with the shape, m / s undoing its grow, so its piece goes with it' : 'q in the shape\'s own box, the whole picture in every shape'}.` : ''),
    'vec3', prog.lines, prog.place ? [{ name: 'place', type: 'vec2', label: 'Picture place' }] : []);
  const sp = mk(c, 'splitVec3', 'grid:split', {}, { v: ref(ge, 'result') }, 'Splits the grid\'s three numbers: X the distance to the cell\'s shape, Y the ripple (0..1), Z the shape index or per-cell value (0..1).');
  const d = ref(sp, 'x');
  let fill: Ref;
  if (g.colourBy === 'ripple' || g.colourBy === 'cell') {
    fill = paletteNode(c, 'grid:palette', L.colour.palette, ref(sp, g.colourBy === 'ripple' ? 'y' : 'z'), anim, L.colour.scale, L.colour.speed,
      g.colourBy === 'ripple' ? 'Colours each cell by the ripple passing through it, so the waves show as colour.' : 'Colours each cell with its own random value through a palette.');
  } else {
    const c1 = mk(c, 'colorPicker', 'grid:color', { color: [...g.colour] }, {}, `The grid's first colour, ${col(g.colour)}: cells with the first shape.`);
    const c2 = mk(c, 'colorPicker', 'grid:color2', { color: [...g.colour2] }, {}, `The grid's second colour, ${col(g.colour2)}: cells with the last shape.`);
    fill = ref(expr(c, 'grid:shade', 'Grid colour', [{ name: 'a', type: 'vec3', from: ref(c1, 'rgb') }, { name: 'b', type: 'vec3', from: ref(c2, 'rgb') }, { name: 'k', type: 'float', from: ref(sp, 'z') }],
      'mix(a, b, k)', 'Each cell\'s colour by its shape: the first colour for the first shape, the second for the last, blended between for a morph.'), 'result');
  }
  // The picture the shapes carry (GRID_PIC_MODES): read where the grid says (Mask: the screen's point), over their colour.
  const t = g.pic ? texFor(b, g.pic.tex, 'The grid') : null;
  if (g.pic && t) {
    const mode = g.pic.mode;
    const cellHalf = `vec2(${fmt(Math.min(2 * g.span / Math.max(1, g.cols), 2 * g.span / Math.max(1, g.rows)) * 0.5 * g.size)})`;
    const pic = samplePicture(b, 'grid:pic', newTexUse(t.src.name), t.src, t.out, mode === 'mask' ? screen : ref(ge, 'place'), mode === 'cell' ? cellHalf : SCREEN_EXT,
      mode === 'mask' ? 'the grid (Mask: the picture over the whole frame, read at the screen\'s point)' : mode === 'cell' ? 'each grid shape' : `the grid (${GRID_LABELS.pic[mode].label})`);
    fill = ref(expr(c, 'grid:picpaint', 'Grid picture', [
      { name: 'base', type: 'vec3', from: fill }, { name: 'tex', type: 'vec3', from: pic.color }, { name: 'a', type: 'float', from: pic.alpha }, { name: 'inside', type: 'float', from: pic.inside },
    ], 'mix(base, tex, clamp(a, 0.0, 1.0) * inside)', `The grid's shapes painted with the picture “${t.src.name}” (${GRID_LABELS.pic[mode].label}: ${GRID_LABELS.pic[mode].blurb.toLowerCase()}); their own colour where the picture is clear.`), 'result');
  }
  let acc = behind;
  if (L.glow.mode === 'all' || (g.glow && L.glow.mode !== 'off')) {
    const gl = mk(c, 'glowLayer', 'grid:glow', { intensity: L.glow.amount, power: L.glow.falloff }, { d, color: fill },
      `The grid's glow: its colour × (${fmt(L.glow.amount)} ÷ distance) ^ ${fmt(L.glow.falloff)}, added to what is behind.`);
    acc = ref(mk(c, 'addColor', 'grid:addglow', {}, { a: acc, b: ref(gl, 'result') }, 'Adds the grid\'s glow to what is behind it.'), 'result');
  }
  return ref(mk(c, 'sdfFill', 'grid:fill', {}, { d, fillColor: fill, background: acc }, 'Paints the grid\'s shapes over what is behind them.'), 'result');
}

function emitOutput(b: B, show: 'distance' | 'mask' | 'space', palette: string | undefined, dists: Ref[], pos: Ref, picture: Ref): Ref {
  const { c } = b;
  const pal = palette ? PALETTE_BY_KEY[palette] : undefined;
  const tail = ' The picture is still built beside it: wire Tone Map (or the last effect) back into the Output to see it.';
  let shade: GraphNode;
  if (show === 'space') {
    const g = mk(c, 'grid', 'out:grid', { scale: 4, lineWidth: 0.04 }, { uv: pos }, 'A checkerboard and grid lines drawn through the space transforms: it shows what the Space tab does to the picture.');
    shade = expr(c, 'out:value', 'Show space', [{ name: 'checker', type: 'float', from: ref(g, 'checker') }, { name: 'line', type: 'float', from: ref(g, 'grid') }],
      pal ? 'clamp(0.15 + 0.6 * checker + 0.25 * line, 0.0, 1.0)' : 'vec3(0.12 + 0.6 * checker) + vec3(0.9, 0.5, 0.2) * line', `Output: Space. Checker squares and grid lines, shown as they land after the transforms.${tail}`, pal ? 'float' : 'vec3');
  } else {
    if (!dists.length) return picture;
    let d = dists[0];
    dists.slice(1).forEach((x, i) => { d = ref(mk(c, 'sdfUnion', `out:u${i + 1}`, { k: 0 }, { a: d, b: x }, 'Joins all the layers into one distance for the output.'), 'dist'); });
    shade = show === 'mask'
      ? expr(c, 'out:value', 'Show mask', [{ name: 'd', type: 'float', from: d }], pal ? '1.0 - smoothstep(-0.003, 0.003, d)' : 'vec3(1.0 - smoothstep(-0.003, 0.003, d))', `Output: Mask. White where any shape is, black elsewhere.${tail}`, pal ? 'float' : 'vec3')
      : expr(c, 'out:value', 'Show distance', [{ name: 'd', type: 'float', from: d }, { name: 'bands', type: 'float', slider: { value: 8, min: 1, max: 40 } }],
        pal ? 'abs(fract(d * bands) - 0.5) * 2.0' : 'vec3(abs(fract(d * bands) - 0.5) * 2.0)', `Output: Distance bands. The distance to the nearest shape, repeated ${show === 'distance' ? '`bands`' : ''} times per unit: rings that follow every outline.${tail}`, pal ? 'float' : 'vec3');
  }
  if (!pal) return ref(shade, 'result');
  return paletteNode(c, 'out:palette', pal.key, ref(shade, 'result'), null, 1, 0, 'Colours the output: the shade through a palette.');
}

/** A stand-alone graph (with its own Output) for `scene`: examples and tests. */
export function buildStandalone2D(scene: Scene2D, opts: { idFor?: (role: string) => string; outputId?: string } = {}): Build2DResult & { outputId: string } {
  const built = buildScene2D(scene, opts.idFor);
  // Its pictures: a Texture node per source, so it compiles alone (the previews bind the real picture to it).
  built.nodes.push(...standIns(scene.textures));
  const uv = built.nodes.find(n => n.id === built.sceneId)!;
  uv.params = { ...uv.params, [META_KEY_2D]: { v: 1, spec: structuredClone(scene) } satisfies Scene2DMeta };
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
