/**
 * build.ts — a 2D Scene Builder scene as a real node graph (docs/scene-builder-2d-plan.md).
 *
 * The graph is what a skilled user would wire by hand:
 *
 *   UV ─► space transforms ─► per shape: Motion 2D ─► Place 2D ─► (ring: Angular Repeat ─► Place 2D)
 *                                  ─► Shape SDF ─► Offset / Onion ─► × scale ─► combines ─► distance
 *   background ─► (Glow Layer ─► Add) ─► SDF Fill, one pair per layer ─► Tone Map ─► post ─► Output
 *
 * Every node gets a plain-language note (`__comment`) and a role (`_sbRole`): a stable name for the
 * part of the spec it comes from (`s2:place` is shape s2's Place 2D, `p1` the first space
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
}

/** An Expression Block with typed inputs (wired, or a float slider) and a float or vec3 result. */
function expr(c: Ctx, role: string, label: string, inputs: Array<{ name: string; type: 'float' | 'vec2' | 'vec3'; from?: Ref; slider?: { value: number; min: number; max: number } }>, result: string, note: string, outputType: 'vec3' | 'float' = 'vec3'): GraphNode {
  const node: GraphNode = {
    id: c.idFor(role), type: 'exprNode', position: { x: 0, y: 0 },
    inputs: Object.fromEntries(inputs.map(i => [i.name, { type: i.type, label: i.name, ...(i.from ? { connection: { ...i.from } } : {}) } as InputSocket])),
    outputs: { result: { type: outputType, label: 'Result' } },
    params: {
      label, outputType, lines: [], result, expr: result,
      inputs: inputs.map(i => ({ name: i.name, type: i.type, slider: i.slider ? { min: i.slider.min, max: i.slider.max } : null })),
      ...Object.fromEntries(inputs.filter(i => i.slider).map(i => [i.name, i.slider!.value])),
      __comment: note, [ROLE_KEY]: role,
    },
  };
  c.nodes.push(node);
  return node;
}

// ── Space ───────────────────────────────────────────────────────────────────

function spaceNode(b: B, op: SpaceOp, pos: Ref): Ref {
  const { c } = b;
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
    case 'zoom': {
      const by = Math.max(0.01, n1('by', 1.5));
      return ref(mk(c, 'uvTransform2d', op.id, { sx: Math.round(1e6 / by) / 1e6, sy: Math.round(1e6 / by) / 1e6 }, { uv: pos }, note(` UV Transform 2D scales the coordinates by 1 ÷ ${fmt(by)}: smaller coordinates magnify.`)), 'result');
    }
    case 'move': {
      const by = (Array.isArray(v.by) ? v.by : [0, 0]) as Vec2;
      return ref(mk(c, 'uvTransform2d', op.id, { tx: -by[0], ty: -by[1] }, { uv: pos }, note(' The coordinates are shifted the other way, which slides the picture this way.')), 'result');
    }
    case 'rotate': {
      const angle = rad(n1('angle', 30)), spin = n1('spin', 0);
      if (!spin) return ref(mk(c, 'rotate2d', op.id, { angle }, { input: pos }, note()), 'output');
      const w = mk(c, 'multiply', `${op.id}:spin`, { b: Math.round(spin * 2 * Math.PI * 1e6) / 1e6 }, { a: b.getTime() }, `Spin for ${op.id}: time × ${fmt(spin)} turns a second in radians (2π × ${fmt(spin)}).`);
      const a = mk(c, 'add', `${op.id}:angle`, { b: angle }, { a: ref(w, 'result') }, `The starting angle ${fmt(n1('angle', 30))}° (${fmt(angle)} radians) plus the spin so far: the angle Rotate 2D uses.`);
      return ref(mk(c, 'rotate2d', op.id, {}, { input: pos, angle: ref(a, 'result') }, note(' Its Angle is wired from the spin below.')), 'output');
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

/** An item's Motion 2D chain: what to wire into its Place 2D. */
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
      `${d.label} on ${name}: ${d.blurb} ${motionWords(m)}. Wired into ${name}'s Place 2D${it.motion.length > 1 ? '; motions are chained, each adds to the one before' : ''}.`);
    if (m.kind === 'orbit' || m.kind === 'bob') hasOffset = true;
    if (m.kind === 'spin') hasTurn = true;
    if (m.kind === 'pulse') hasGrow = true;
  }
  return { offset: last && hasOffset ? ref(last, 'offset') : null, turn: last && hasTurn ? ref(last, 'turn') : null, grow: last && hasGrow ? ref(last, 'grow') : null };
}

interface Branch { pos: Ref; scales: Ref[] }

/** The ring array of an item from `start`: Angular Repeat, then Place 2D out to the radius (twice for rings of rings). */
function emitRing(b: B, it: Item, dup: DupSpec, start: Branch, k: number, name: string): Branch {
  const { c } = b;
  const suffix = dup.levels > 1 ? `:${k}` : '';
  let { pos } = start;
  const scales = [...start.scales];
  // The whole ring at a bigger (or smaller) size.
  if (dup.levels > 1 && k > 0) {
    const s = Math.round(Math.pow(dup.factor, k) * 1e6) / 1e6;
    const lv = mk(c, 'place2D', `${it.id}:size${suffix}`, { scale: s }, { uv: pos },
      `Size ${k + 1} of ${dup.levels} for ${name}'s ring: the whole ring drawn ${fmt(s)}× as big (${fmt(dup.factor)} to the power ${k}). The ring is drawn once per size and the sizes are joined.`);
    pos = ref(lv, 'p');
    scales.push(ref(lv, 'scale'));
  }
  const ring = mk(c, 'angularRepeat2D', `${it.id}:ring${suffix}`, { count: dup.count }, { input: pos },
    `Ring of ${dup.count} for ${name}: repeats space ${dup.count} times round the centre, like slices of a cake, so one shape becomes ${dup.count}.`);
  const out = mk(c, 'place2D', `${it.id}:ring-at${suffix}`, { x: dup.radius }, { uv: ref(ring, 'output') },
    `Puts each copy of ${name} ${fmt(dup.radius)} out from the centre of its ring (Move X ${fmt(dup.radius)}). Change it to make the ring wider or tighter.`);
  pos = ref(out, 'p');
  if (dup.inner) {
    const r2 = mk(c, 'angularRepeat2D', `${it.id}:inner${suffix}`, { count: dup.inner.count }, { input: pos },
      `Rings of rings for ${name}: each of the ${dup.count} copies is itself a ring of ${dup.inner.count}.`);
    const o2 = mk(c, 'place2D', `${it.id}:inner-at${suffix}`, { x: dup.inner.radius }, { uv: ref(r2, 'output') },
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
  if (def.shape === 'ring') {
    const hair = mk(c, 'ringSDF', `${sh.id}${sfx}`, { radius: params.radius }, { position: pos }, `${name}: a ring of radius ${fmt(Number(params.radius))}. Ring SDF is a hairline (the distance to a circle line); the Offset after it gives it thickness.`);
    const th = Number(sh.size.th ?? 0.04);
    const fat = mk(c, 'sdfOffset', `${sh.id}:th${sfx}`, { amount: -th }, { sdf: ref(hair, 'distance') }, `Thickens ${name}'s line: an Offset of ${fmt(-th)} pushes the edge out by ${fmt(th)} each side of the hairline.`);
    return ref(fat, 'result');
  }
  const n = mk(c, 'shapeSDF', `${sh.id}${sfx}`, { shape: def.shape, ...params }, { p: pos }, note);
  return ref(n, 'distance');
}

/**
 * An item's distance from `pos`: placement (Motion 2D → Place 2D), the ring array, the shape or the
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
    const wires: Record<string, Ref | null> = { uv: pos, offset: mo.offset, turn: mo.turn, grow: mo.grow };
    const bits: string[] = [];
    if (it.at[0] || it.at[1]) bits.push(`moved to ${v2(it.at)}`);
    if (it.rot) bits.push(`turned ${fmt(it.rot)}°`);
    if (baseScale !== 1) bits.push(def?.unit ? `sized ${fmt(unit)} (a ${def.label.toLowerCase()} has no radius of its own, so its size is this node's Scale)` : `scaled ${fmt(it.scale)}×`);
    if (it.motion.length) bits.push('moved by its motion');
    const pl = mk(c, 'place2D', `${it.id}:place`, { x: it.at[0], y: it.at[1], rotate: it.rot, scale: baseScale }, wires,
      `Places ${name}: ${bits.join(', ')}. Place 2D gives the shape a new view of space: the shape is measured from the point as it sees it, so it ends up where the node says. Its Scale output multiplies the distance back to the picture's units.`);
    start = { pos: ref(pl, 'p'), scales: baseScale !== 1 || pulse ? [ref(pl, 'scale')] : [] };
  }
  const dup = it.dup && it.dup.count >= 2 ? it.dup : null;
  const levels = dup ? Math.max(1, Math.min(6, Math.round(dup.levels))) : 1;
  const branches: Ref[] = [];
  for (let k = 0; k < levels; k++) {
    const br = dup ? emitRing(b, it, { ...dup, levels }, start, k, name) : start;
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
        `Puts ${name}'s distance back in the picture's units: multiplies it by the scale it was drawn at (the Scale output of its Place 2D), so combines, glow and outlines measure true.`), 'result');
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
  angle: { code: 'atan(uv.y, uv.x) / 6.28318 + 0.5', what: 'the angle of each point round the centre (0 to 1)' },
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
  const b: B = { c, spec, time: null, getTime: () => {
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
  const glowTint = L.glow.tint ? ref(mk(c, 'colorPicker', 'glowtint', { color: [...L.glow.tint] }, {}, `The glow's colour, ${col(L.glow.tint)}, for every glowing layer. Clear Tint in the builder to glow in each layer's own colour.`), 'rgb') : null;
  for (const { it, d } of layers) {
    const name = `‘${itemName(spec, it)}’`;
    let fill: Ref;
    if (sharedColour) fill = sharedColour;
    else if (by === 'distance') {
      fill = paletteNode(c, `${it.id}:palette`, L.colour.palette, d, anim, L.colour.scale, L.colour.speed, `Colours ${name} by its distance field, so it comes out in bands that follow its outline.`);
    } else fill = ref(mk(c, 'colorPicker', `${it.id}:color`, { color: [...it.color] }, {}, `${name}'s colour, ${col(it.color)}.`), 'rgb');
    const glows = L.glow.mode === 'all' || (L.glow.mode === 'selected' && it.glow);
    if (glows) {
      const g = mk(c, 'glowLayer', `${it.id}:glow`, { intensity: L.glow.amount, power: L.glow.falloff }, { d, color: glowTint ?? fill },
        `The glow of ${name}: its colour × (${fmt(L.glow.amount)} ÷ distance) ^ ${fmt(L.glow.falloff)}. A bigger Intensity reaches further; a bigger Power makes it fall off faster. It is added to what is behind, then the shape is painted over it.`);
      acc = ref(mk(c, 'addColor', `${it.id}:addglow`, {}, { a: acc, b: ref(g, 'result') }, `Adds ${name}'s glow to what is behind it. Light adds up, so it can go past 1; Tone Map brings it back.`), 'result');
    }
    acc = ref(mk(c, 'sdfFill', `${it.id}:fill`, {}, { d, fillColor: fill, background: acc },
      `Paints ${name} over what is behind it: inside the distance is negative, so the fill colour shows there; the edge is anti-aliased by one pixel.`), 'result');
  }
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
