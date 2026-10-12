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
  MOTION_BY_KIND, SHAPE_BY_KIND, SPACE_BY_KIND, hasShapes, itemName, num, opLabel, styleOf,
  type DupSpec, type GroupSpec, type Item, type MotionSpec, type Scene2D, type ShapeSpec, type SpaceOp, type Vec2, type Vec3,
} from './spec';
import { colourText } from '../lang/colours';
import { GRID_LABELS, gridProgram, type GridSpec } from './grid';
import type { PiecesSpec } from './pieces';
import { callBody, type FnRef } from './functions';
import { COMBINE_BY_MODE, MAX_LOOP_TIMES, blockGlslLines, blockLoopParts, checkBlock, clampTimes, trapWords, type SpaceBlock } from './blocks';
import { MUTE_TO_PARAM } from '../builders/mute';
import { BLOCK_BY_ID } from './blockLibrary';
import { FAR, gateChain, gateNode } from '../builders/mute';
import { MOD_BY_KIND, customParams, modGlsl, modReads } from './modify';
import { glowFormula, GLOW_TYPE_LABELS, type GlowType } from '../nodes/definitions/combiners';
import { DEPTH_LOOK_LABELS, depthMixParams, depthSummary, type DepthPic2D } from './depth';
import { DEPTH_MIX_COMBINE_LABELS, DEPTH_SPACE_LABELS } from '../nodes/definitions/depthMix';
import { FIT_LABELS, LUMA, findTex, fitLines, glf, newTexUse, picUv, sampleWrap, standInId, standIns, type TexSource, type TexUse } from '../builders/textures';
import { CUSTOM_PALETTE, paletteLabel, paletteSwatches, slotColour } from '../builders/look/palette';
import { emitGrades } from '../builders/look/grade';
import { emitEffects } from '../builders/look/effects';

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
  /** Depth → size: the Depth Mix Scale every top-level layer grows by (depth.ts), or null. */
  depthGrow?: Ref | null;
  /** A shape's own colour (its Color node or palette slot), for a combine that blends its shapes' colours; null when colour comes from elsewhere. */
  colourOf?: ((it: Item) => Ref) | null;
  /** A combine's colour, blended from its shapes by the smooth weight (groups with `mix`). */
  mixCol: Map<string, Ref>;
  /** The last looped block's orbit trap (its node's `trap` output): Look → Colour by trap reads it. */
  trap?: Ref | null;
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
function samplePicture(b: B, role: string, use: TexUse, src: TexSource, out: Ref, q: Ref, ext: string, where: string): { color: Ref; alpha: Ref; inside: Ref; place: Ref } {
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
  return { color: ref(s, 'color'), alpha: ref(s, 'alpha'), inside: ref(fit, 'inside'), place: ref(fit, 'result') };
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
  const loop = blockLoopParts(block);
  const times = clampTimes(block.times, !!block.loop);
  const entry = block.lib ? BLOCK_BY_ID[block.lib] : undefined;
  const sliders = block.params.map(p => `${p.name} ${fmt(p.value)}`);
  const note = `${name} (${where}): ${entry ? entry.blurb : 'a transform block written in the 2D Scene Builder.'} `
    + (loop
      ? `Each line changes uv, the point every shape below looks from, and the lines run in a loop: Loop is on, Iterations (${times}) is a live slider on this node, up to Max iterations. uv0 is the point before the block; fi, k and n count the passes.${block.trap ? ` ${trapWords(block.trap)}: the trap output, which Look → Colour by trap reads.` : ''} `
      : `Each line changes uv, the point every shape below looks from, top to bottom${times > 1 ? `; the ${lines.length / times} line${lines.length / times === 1 ? ' is' : 's are'} written out ${times} times, so the fold runs ${times} times over` : ''}. `)
    + 'In the builder x and y stand for uv.x and uv.y (written out here), t is time in seconds, and whole numbers are written as floats. '
    + `${sliders.length ? `The sliders (${sliders.join(', ')}) are live: drag them on the node without recompiling.` : 'It has no sliders: select a number in a line to make one.'}`;
  const node = expr(c, role, name, [
    { name: 'uv', type: 'vec2', from: pos },
    ...block.params.map(p => ({ name: p.name, type: 'float' as const, slider: { value: p.value, min: p.min, max: p.max } })),
  ], 'uv', note, 'vec2', loop ? [...lines, ...loop.extra] : lines, block.loop && block.trap ? [{ name: 'trap', type: 'float', label: 'Trap' }] : []);
  if (loop) {
    // Loop mode (nodes/exprLoop.ts): compiled to MAX_LOOP_TIMES, Iterations a uniform
    node.params.loop = { on: true, max: MAX_LOOP_TIMES, before: loop.before, after: loop.after };
    node.params.loopN = times;
    // Muted, the trap is 0 (no shade), live like the rest of the mute (compiler/muteGate.ts)
    if (block.trap) { node.params[MUTE_TO_PARAM] = '0.0'; b.trap = ref(node, 'trap'); }
  }
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
/** A role inside the current scope (a ring's sizes draw a group's children again under a prefix). */
const scoped = (c: Ctx, role: string) => `${c.rolePrefix ?? ''}${role}`;

/** What one combine does, for its node's note. */
function opWords(it: GroupSpec, names: string[], i: number): string {
  const before = i ? ' (and the ones before)' : '';
  switch (it.op) {
    case 'union': return `${it.k > 0 ? 'melts' : 'joins'} ${names[0]}${before} and ${names[i + 1]}`;
    case 'subtract': return `cuts ${names[i + 1]} out of ${names[0]}${i ? ' (and the cuts before)' : ''}`;
    case 'intersect': return `keeps only where ${names[0]}${before} and ${names[i + 1]} overlap`;
    default: return `keeps ${names[0]}${before} and ${names[i + 1]} but not where they overlap`;
  }
}

/**
 * One combine of two distances: the Union, Subtract or Intersect node (its Blend radius a live
 * param), or for Xor an Expression Block. Returns the distance and the blend weight (1: a's side).
 */
function emitOp(b: B, it: GroupSpec, role: string, a: Ref, d: Ref, note: string): { dist: Ref; blend: Ref } {
  const { c } = b;
  if (it.op === 'xor') {
    const n = expr(c, scoped(c, role), 'Xor', [{ name: 'a', type: 'float', from: a }, { name: 'b', type: 'float', from: d }],
      'max(min(a, b), -max(a, b))', `${note} Xor is either shape but not both: max(min(a, b), −max(a, b)), so where they overlap is outside. blend is 1 where a is the nearer, for the colour.`,
      'float', [{ lhs: 'float blend', op: '=', rhs: 'step(a, b)' }], [{ name: 'blend', type: 'float', label: 'Blend' }]);
    return { dist: ref(n, 'result'), blend: ref(n, 'blend') };
  }
  const n = mk(c, TYPE_OF_OP[it.op], role, { k: it.k }, { a, b: d }, note);
  return { dist: ref(n, 'dist'), blend: ref(n, 'blend') };
}

/** Two colours joined by a combine's blend weight (1: a). Subtract keeps a's colour: the cut takes nothing of the cutter's. */
function mixColour(b: B, role: string, op: GroupSpec['op'], ca: Ref, cb: Ref, w: Ref, name: string): Ref {
  if (op === 'subtract') return ca;
  const { c } = b;
  return ref(expr(c, scoped(c, role), 'Combine colour', [
    { name: 'a', type: 'vec3', from: ca }, { name: 'b', type: 'vec3', from: cb }, { name: 'w', type: 'float', from: w },
  ], 'mix(b, a, w)', `The colour of ${name} where its shapes join: w is the combine's blend weight (1 on the first shape's side, 0 on the other's, in between across a smooth join), so the colours run into each other as the shapes do. Change Blend radius on the combine and the colour follows.`), 'result');
}

function motionWords(m: MotionSpec): string {
  const d = MOTION_BY_KIND[m.kind];
  return `${d.label.toLowerCase()} ${fmt(m.speed)} cycles a second${d.amount ? `, ${d.amount.label.toLowerCase()} ${fmt(m.amount)}` : ''}${m.phase ? `, starting ${fmt(m.phase)}° in` : ''}`;
}

/** An item's Motion 2D chain: what to wire into its Transform. */
function emitMotion(b: B, it: Item, name: string): { offset: Ref | null; turn: Ref | null; grow: Ref | null } {
  const { c } = b;
  let last: GraphNode | null = null;
  let hasOffset = false, hasTurn = false, hasGrow = false;
  for (const m of it.motion.filter(x => !x.muted)) {
    const d = MOTION_BY_KIND[m.kind];
    const wires: Record<string, Ref | null> = { time: b.getTime() };
    if (last) {
      if (hasOffset) wires.offset = ref(last, 'offset');
      if (hasTurn) wires.turn = ref(last, 'turn');
      if (hasGrow) wires.grow = ref(last, 'grow');
    }
    last = mk(c, 'motion2D', m.id, { mode: m.kind, speed: m.speed, amount: m.amount, phase: m.phase, direction: m.dir }, wires,
      `${d.label} on ${name}: ${d.blurb} ${motionWords(m)}. Wired into ${name}'s Transform${it.motion.filter(x => !x.muted).length > 1 ? '; motions are chained, each adds to the one before' : ''}.`);
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
 * Modify (modify.ts): each operation on the item's distance as an Expression Block, d in, d out,
 * its numbers sliders (live, wireable). A muted one passes d through (live); one that doesn't check
 * is left out with a warning.
 */
function emitMods(b: B, it: Item, d: Ref, name: string): Ref {
  const { c } = b;
  for (const m of it.mods ?? []) {
    const def = MOD_BY_KIND[m.kind];
    if (!def) { c.warnings.push(`${name}: a modify “${m.kind}” isn't known; left out.`); continue; }
    const g = modGlsl(m);
    if ('error' in g) { c.warnings.push(`${name}'s ${def.label} was left out: ${g.error}`); continue; }
    const reads = modReads(m);
    const local = b.local.get(it.id);
    const sliders = m.kind === 'custom'
      ? customParams(m).map(p => ({ name: p.name, type: 'float' as const, slider: { value: p.value, min: p.min, max: p.max } }))
      : def.params.map(p => ({ name: p.key, type: 'float' as const, slider: { value: m.values[p.key] ?? p.def, min: p.min, max: p.max } }));
    const node = expr(c, scoped(c, `${it.id}:mod:${m.id}`), def.label, [
      { name: 'd', type: 'float', from: d },
      ...(reads.uv && local ? [{ name: 'uv', type: 'vec2' as const, from: local }] : []),
      ...(reads.t ? [{ name: 't', type: 'float' as const, from: b.getTime() }] : []),
      ...(m.kind === 'onion' ? sliders.filter(x => x.name !== 'count') : sliders),
    ], g.result,
    `Modify ${name}: ${def.label}. ${def.blurb} d is its distance (negative inside), and the result is the distance it is drawn with.${sliders.length ? ` The numbers (${sliders.filter(x => x.name !== 'count').map(x => `${x.name} ${fmt(x.slider.value)}`).join(', ')}) are live sliders: drag them, or wire them, without recompiling.` : ''}${m.kind === 'onion' && (m.values.count ?? 1) > 1 ? ` Done ${Math.round(m.values.count)} times, each ring half as wide, ring inside ring.` : ''}${m.kind === 'custom' ? ' x and y are the point (uv.x, uv.y), t is time.' : ''}`,
    'float', g.lines);
    gateNode(node, m.muted, { from: 'd' });
    d = ref(node, 'result');
  }
  return d;
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
  // A muted motion or ring is left out (builders/mute.ts): nothing passes through a motion.
  const motions = it.motion.filter(m => !m.muted);
  const pulse = motions.some(m => m.kind === 'pulse');
  const baseScale = it.scale * unit;
  // Depth → size: every top-level layer grows by the picture's depth (its Transform's Grow).
  const depthGrow = depth === 0 ? b.depthGrow ?? null : null;
  // A placing pinned to Quick controls (quick.ts) is built even at rest, so its Play control has a param to drive.
  const pinned = !!spec.quick?.some(q => q.play?.role === `${it.id}:place`);
  const placed = it.at[0] !== 0 || it.at[1] !== 0 || it.rot !== 0 || baseScale !== 1 || motions.length > 0 || !!depthGrow || pinned;
  let start: Branch = { pos, scales: [] };
  if (placed) {
    const mo = emitMotion(b, it, name);
    let grow = mo.grow;
    if (depthGrow) {
      grow = grow
        ? ref(mk(c, 'multiply', `${it.id}:depthgrow`, {}, { a: grow, b: depthGrow }, `${name}'s pulse times its size by depth: both grow it.`), 'result')
        : depthGrow;
    }
    const wires: Record<string, Ref | null> = { p: pos, offset: mo.offset, turn: mo.turn, grow };
    const bits: string[] = [];
    if (it.at[0] || it.at[1]) bits.push(`moved to ${v2(it.at)}`);
    if (it.rot) bits.push(`turned ${fmt(it.rot)}°`);
    if (baseScale !== 1) bits.push(def?.unit ? `sized ${fmt(unit)} (a ${def.label.toLowerCase()} has no radius of its own, so its size is this node's Scale)` : `scaled ${fmt(it.scale)}×`);
    if (motions.length) bits.push('moved by its motion');
    if (pinned && !bits.length) bits.push('at rest for now (its place is a Quick control, so Play can move it)');
    if (depthGrow) bits.push('grown by the picture\'s depth (Grow is wired from Depth Mix\'s Scale: bigger on near things)');
    const pl = mk(c, 'transform', `${it.id}:place`, { dim: '2', x: it.at[0], y: it.at[1], rotate: it.rot, scale: baseScale }, wires,
      `Places ${name}: ${bits.join(', ')}. Transform gives the shape a new view of space: the shape is measured from the point as it sees it, so it ends up where the node says. Its Scale output multiplies the distance back to the picture's units.`);
    start = { pos: ref(pl, 'p'), scales: baseScale !== 1 || pulse || depthGrow ? [ref(pl, 'scale')] : [] };
  }
  const dup = it.dup && !it.dup.muted && it.dup.count >= 2 ? it.dup : null;
  const levels = dup ? Math.max(1, Math.min(6, Math.round(dup.levels))) : 1;
  const branches: Ref[] = [];
  const levelCols: Ref[] = [];
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
      // Its colour from its shapes, blended by each combine's weight (Look → colour by each layer's).
      const colOf = it.mix && b.colourOf ? (ch: Item): Ref => b.mixCol.get(ch.id) ?? b.colourOf!(ch) : null;
      let col: Ref | null = colOf ? colOf(parts[0].ch) : null;
      parts.slice(1).forEach(({ ch, d }, i) => {
        const role = `${it.id}:op${i + 1}${sfx}`;
        const o = emitOp(b, it, role, dist!, d,
          `${opLabel(it)} in ${name}: ${opWords(it, names, i)}.${it.k > 0 && it.op !== 'xor' ? ` Blend radius ${fmt(it.k)} is how wide the join is (live: drag it on the node).` : ''}${col ? ' Its Blend output (the 0–1 weight) blends the shapes\' colours.' : ''}`);
        dist = o.dist;
        if (col && colOf) col = mixColour(b, `${it.id}:col${i + 1}${sfx}`, it.op, col, colOf(ch), o.blend, name);
      });
      if (col) levelCols.push(col);
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
  let outCol: Ref | null = levelCols[0] ?? null;
  branches.slice(1).forEach((d, i) => {
    const u = mk(c, 'sdfUnion', `${it.id}:sizes${i + 1}`, { k: 0 }, { a: out, b: d }, `Joins the ring of ${name} at size ${i + 2} to the sizes before it: the same ring repeated at bigger scales.`);
    out = ref(u, 'dist');
    if (outCol && levelCols[i + 1]) outCol = mixColour(b, `${it.id}:sizecol${i + 1}`, 'union', outCol, levelCols[i + 1], ref(u, 'blend'), name);
  });
  if (outCol) b.mixCol.set(it.id, outCol);
  out = emitMods(b, it, out, name);
  // Muted (builders/mute.ts): its distance is far away, by a live uniform, so it draws nothing and
  // every union, cut and glow ignores it.
  gateNode(c.nodes.find(n => n.id === out.nodeId), it.muted, { to: FAR });
  return out;
}

// ── Colour, glow, composite ─────────────────────────────────────────────────

/** A palette (cosine or ramp) from the colour-by settings: `value` through it. */
export function paletteNode(c: Ctx, role: string, key: string, value: Ref, anim: Ref | null, scale: number, speed: number, note: string, custom?: readonly Vec3[] | null, customName?: string | null): Ref {
  if (key === CUSTOM_PALETTE && custom && custom.length >= 2) {
    const cols = custom.slice(0, 8);
    return ref(mk(c, 'colorRamp', role, { stops: String(cols.length), ...Object.fromEntries(cols.map((s, i) => [`color${i}`, [...s]])) }, { t: value }, `${note} ${paletteLabel(key, customName)}: the scene's own palette (${cols.length} colours).`), 'color');
  }
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
  const b: B = { c, spec, time: null, local: new Map(), mixCol: new Map(), getTime: () => {
    if (!b.time) b.time = ref(mk(c, 'time', 'time', {}, {}, 'Time in seconds: it drives every motion, spin and drifting warp in this scene.'), 'time');
    return b.time;
  } };
  if (!hasShapes(spec)) c.warnings.push('The scene has no shapes yet: add one under Shapes.');

  const uv = mk(c, 'uv', 'uv', {}, {}, `The picture's coordinates: the centre is (0, 0), the top is 1 and the bottom −1. Built by the 2D Scene Builder${spec.space.length ? `; ${spec.space.length} space transform${spec.space.length === 1 ? '' : 's'} follow` : ''}. Right-click → Edit in 2D Scene Builder, or use Rebuild from recipe on its Recipe chip.`);
  const screen = ref(uv, 'uv');
  let pos = screen;
  for (const op of spec.space) {
    // A muted transform is still built, its node bypassed by a live uniform (builders/mute.ts).
    const next = spaceNode(b, op, pos);
    gateChain(c.nodes, pos, next, op.muted);
    pos = next;
  }
  // A picture with depth (depth.ts): its picture and Depth node, and the Depth Mix the shapes read.
  const depthPic = spec.depth ? emitDepthPicture(b, spec.depth, screen, pos) : null;
  if (depthPic?.shapes && spec.depth?.space.on) pos = ref(depthPic.shapes, 'uv');
  b.depthGrow = depthPic?.shapes && spec.depth?.size.on ? ref(depthPic.shapes, 'scale') : null;

  // The palette's slots in use: one Color node each, wired to every part that takes it, so changing
  // the palette (or that node) recolours them all (builders/look/palette.ts).
  const swatches = paletteSwatches(L.colour.palette, L.custom);
  const slots = new Map<number, Ref>();
  const slotRef = (slot: number): Ref => {
    const n = ((Math.round(slot) % swatches.length) + swatches.length) % swatches.length;
    let r = slots.get(n);
    if (!r) {
      const colour = slotColour(swatches, n);
      r = ref(mk(c, 'colorPicker', `palette:slot${n + 1}`, { color: colour }, {}, `Palette slot ${n + 1} of ${paletteLabel(L.colour.palette, L.customName)}, ${col(colour)}: every part coloured from this slot reads it, so changing it here (or the palette in the builder) recolours them all.`), 'rgb');
      slots.set(n, r);
    }
    return r;
  };
  // A combine that blends its shapes' colours (`mix`) reads each shape's own colour: its slot or a
  // Color node of its own. Only when every layer has its own colour (Look → colour by each layer's).
  const own = new Map<string, Ref>();
  b.colourOf = L.colour.by !== 'layer' ? null : it => {
    if (it.slot != null) return slotRef(it.slot);
    let r = own.get(it.id);
    if (!r) {
      r = ref(mk(c, 'colorPicker', `${it.id}:color`, { color: [...it.color] }, {}, `‘${itemName(spec, it)}’'s colour, ${col(it.color)}: its combine blends it with the others' by the smooth weight.`), 'rgb');
      own.set(it.id, r);
    }
    return r;
  };

  // Distances, one per layer.
  const layers = spec.layers.map(it => ({ it, d: emitItem(b, it, pos, 0) })).filter((x): x is { it: Item; d: Ref } => x.d !== null);

  // Colour: each layer's own, or a palette driven by something about the picture.
  const by = L.colour.by;
  let sharedColour: Ref | null = null;
  const anim = by === 'time' ? b.getTime() : L.colour.speed ? b.getTime() : null;
  if (by === 'trap' && !b.trap) c.warnings.push('Colour by trap needs a looped space block with its orbit trap on (Kali loop, Julia, Mandelbox…): colouring by distance from the centre instead.');
  if (by !== 'layer' && by !== 'distance') {
    // By trap: the last looped block's orbit trap, a shade (1 where its passes came close)
    const trap = by === 'trap' ? b.trap ?? null : null;
    const driver = by === 'time' || trap ? null : DRIVERS[by === 'trap' ? 'length' : by];
    const value = trap ?? (driver ? ref(expr(c, 'drive', `Colour by ${by}`, [{ name: 'uv', type: 'vec2', from: pos }], driver.code, `The number the palette is read with: ${driver.what}, in the warped space. Colour → by ${by}.`, 'float'), 'result') : null);
    const speed = by === 'time' ? (L.colour.speed || 0.2) : L.colour.speed;
    sharedColour = paletteNode(c, 'palette', L.colour.palette, value ?? ref(mk(c, 'constant', 'drive', { value: 0 }, {}, 'Nothing drives the palette but time.'), 'value'), anim, L.colour.scale, speed,
      `Colours every layer: ${trap ? 'the orbit trap of the last looped space block (1 where its passes came close to the trap, fading out)' : driver ? driver.what : 'time'} read through a palette${speed ? `, moving at ${fmt(speed)}` : ''}.`, L.custom, L.customName);
  }

  let acc: Ref = L.bgSlot != null ? slotRef(L.bgSlot)
    : ref(mk(c, 'colorPicker', 'bg', { color: [...L.bg] }, {}, `The background colour, ${col(L.bg)}: what shows where no shape is.`), 'rgb');
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
      fill = paletteNode(c, `${it.id}:palette`, L.colour.palette, d, anim, L.colour.scale, L.colour.speed, `Colours ${name} by its distance field, so it comes out in bands that follow its outline.`, L.custom, L.customName);
    } else if (it.type === 'group' && b.mixCol.has(it.id)) fill = b.mixCol.get(it.id)!;
    else if (it.slot != null) fill = slotRef(it.slot);
    else fill = ref(mk(c, 'colorPicker', `${it.id}:color`, { color: [...it.color] }, {}, `${name}'s colour, ${col(it.color)}.`), 'rgb');
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
    const style = styleOf(it);
    // The glow formula: the layer's own type, the Look's, or Soft for a Glow-style layer and Halo round a Filled one.
    const gtype = (fallback: GlowType): GlowType => it.glowType ?? L.glow.type ?? fallback;
    if (style === 'outline') {
      // Outline: a glowing line along the edge, the glow of abs(distance).
      acc = ref(expr(c, `${it.id}:outline`, 'Glow outline', [
        { name: 'bg', type: 'vec3', from: acc }, { name: 'd', type: 'float', from: d }, { name: 'color', type: 'vec3', from: glowTint ?? fill },
        { name: 'amount', type: 'float', slider: { value: L.glow.amount, min: 0.0005, max: 0.05 } },
        { name: 'falloff', type: 'float', slider: { value: L.glow.falloff, min: 0.5, max: 3 } },
      ], 'bg + color * pow(amount / (abs(d) + max(amount, 1.0e-5)), falloff)',
      `${name} drawn as its outline (Style: Outline): its colour × (amount ÷ (distance from the edge + amount)) ^ falloff, added to what is behind. It is brightest on the edge and fades both ways, so the shape reads as a glowing line. Amount and falloff are live (Look → Glow sets them for the scene).`), 'result');
    } else if (style === 'glow' && glows) {
      // Glow (the default): the shape is its glow, colour × (amount ÷ (distance outside + amount)) ^ falloff:
      // its own colour inside and at the edge, fading out from there (the Grid builder's Soft). No fill
      // is painted over it. Muting the glow (once it has been muted) shows the crisp shape instead.
      const crisp = L.mute?.glow !== undefined
        ? ref(mk(c, 'sdfFill', `${it.id}:fill`, {}, { d, fillColor: fill, background: acc }, `${name} as a crisp shape: what shows while the Look's glow is muted (the glow node passes it through).`), 'result')
        : null;
      const g = expr(c, `${it.id}:glow`, 'Glow shape', [
        { name: 'bg', type: 'vec3', from: acc }, { name: 'd', type: 'float', from: d }, { name: 'color', type: 'vec3', from: fill },
        { name: 'amount', type: 'float', slider: { value: L.glow.amount, min: 0.0005, max: 0.05 } },
        { name: 'falloff', type: 'float', slider: { value: L.glow.falloff, min: 0.5, max: 3 } },
        ...(crisp ? [{ name: 'crisp', type: 'vec3' as const, from: crisp }] : []),
      ], `bg + color * ${glowFormula(gtype('soft'), 'd', 'amount', 'falloff')}`,
      `${name} drawn as its glow (Style: Glow, type ${GLOW_TYPE_LABELS[gtype('soft')].label}): ${GLOW_TYPE_LABELS[gtype('soft')].blurb} The glow is added to what is behind; with Soft (the default) it is the shape's own colour inside and at the edge, fading out from there, so the shape and its glow read as one, the way a distance field glows (the Grid builder's Soft glow). No flat fill is painted over it. Amount (how far it reaches) and falloff (how fast it fades) are live sliders.`);
      if (crisp) gateNode(g, L.mute?.glow, { from: 'crisp' });
      acc = ref(g, 'result');
    } else if (style === 'glow') {
      // Glow style on a layer that doesn't glow (Look → Glow off, or not marked): the crisp shape.
      acc = ref(mk(c, 'sdfFill', `${it.id}:fill`, {}, { d, fillColor: fill, background: acc },
        `Paints ${name} over what is behind it: its distance field's edge, anti-aliased by one pixel. It glows when Look → Glow is on for it.`), 'result');
    } else if (glows) {
      const glowFrom = acc;
      const ht = gtype('halo');
      const g = mk(c, 'glowLayer', `${it.id}:glow`, { intensity: L.glow.amount, power: L.glow.falloff, ...(ht !== 'halo' ? { mode: ht } : {}) }, { d, color: glowTint ?? fill },
        `The glow of ${name}: its colour × (${fmt(L.glow.amount)} ÷ distance) ^ ${fmt(L.glow.falloff)}. A bigger Intensity reaches further; a bigger Power makes it fall off faster. It is added to what is behind, then the shape is painted over it.`);
      acc = ref(mk(c, 'addColor', `${it.id}:addglow`, {}, { a: acc, b: ref(g, 'result') }, `Adds ${name}'s glow to what is behind it. Light adds up, so it can go past 1; Tone Map brings it back.`), 'result');
      gateChain(c.nodes, glowFrom, acc, L.mute?.glow);
    }
    if (style === 'filled') {
      acc = ref(mk(c, 'sdfFill', `${it.id}:fill`, {}, { d, fillColor: fill, background: acc },
        `Paints ${name} over what is behind it (Style: Filled): inside the distance is negative, so the fill colour shows there; the edge is anti-aliased by one pixel.`), 'result');
    }
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
    // A muted layer: the picture behind it passes straight through (builders/mute.ts).
    gateChain(c.nodes, behind, acc, it.muted);
  }
  if (spec.grid) {
    const under = acc;
    acc = emitGrid(b, spec.grid, pos, screen, acc, anim);
    gateChain(c.nodes, under, acc, spec.grid.muted);
  }
  if (spec.pieces) {
    const under = acc;
    acc = emitPieces(b, spec.pieces, pos, acc);
    gateChain(c.nodes, under, acc, spec.pieces.muted);
  }
  if (depthPic && spec.depth) acc = emitDepthMix(b, spec.depth, depthPic, acc, layers.map(l => l.d));
  let final = acc;
  // A muted effect is still built, bypassed by a live uniform (builders/mute.ts).
  const M = L.mute ?? {};
  const effect = (key: keyof typeof M, n: GraphNode, out: string): Ref => { gateNode(n, M[key], { from: 'color' }); return ref(n, out); };
  if (L.tone !== 'none') final = effect('tone', mk(c, 'toneMap', 'tone', { mode: L.tone }, { color: final }, `Squeezes the bright, linear light into colours a screen can show (${L.tone.toUpperCase()}) without clipping highlights.`), 'color');
  // The Look's grade, then the Effects page, each in its order (builders/look).
  final = emitGrades(c, L.grade, final, { swatches });
  final = emitEffects(c, spec.effects, final, { screen, getTime: b.getTime, texture: (name, what) => texFor(b, name, what)?.out ?? null });
  const P = L.post;
  if (P.bloom > 0) final = effect('bloom', mk(c, 'bloom', 'bloom', { intensity: P.bloom, threshold: 0.35 }, { color: final, uv: screen }, `Bloom: bright areas bleed light into their surroundings. Intensity ${fmt(P.bloom)}.`), 'result');
  if (P.vignette > 0) final = effect('vignette', mk(c, 'vignette', 'vignette', { strength: P.vignette }, { color: final, uv: screen }, `Vignette: darkens the corners. Strength ${fmt(P.vignette)}.`), 'result');
  if (P.scanlines > 0) final = effect('scanlines', mk(c, 'scanlines', 'scanlines', { intensity: P.scanlines }, { color: final, uv: screen }, `Scanlines: thin dark lines across the picture. Intensity ${fmt(P.scanlines)}.`), 'result');
  if (P.grain > 0) final = effect('grain', mk(c, 'grain', 'grain', { amount: P.grain }, { color: final, uv: screen }, `Film grain: a little noise over everything. Amount ${fmt(P.grain)}.`), 'color');

  // Another output: a measurement instead of the picture (the picture's nodes stay, unwired).
  const o = spec.output;
  if (o && o.show !== 'picture') final = emitOutput(b, o.show, o.palette, layers.map(l => l.d), pos, final);

  tidy(c.nodes, 0, 0);
  // The UV node carries the scene; it is the one place its Recipe chip shows.
  return { nodes: c.nodes, final, sceneId: uv.id, warnings: c.warnings };
}

/**
 * Picture in pieces (pieces.ts, docs/pieces.md): the Pieces node over what is behind (its Background),
 * moved by a Vector Field wired into its Offset ƒ (read at each piece's home) or pushed away from the
 * mouse, with an LFO eased into Amount when it scatters and comes back.
 */
function emitPieces(b: B, pc: PiecesSpec, pos: Ref, behind: Ref): Ref {
  const { c } = b;
  const t = texFor(b, pc.tex, 'Picture in pieces');
  let offset: Ref | null = null;
  if (pc.move === 'noise' || pc.move === 'flow') {
    const vf = mk(c, 'vectorField', 'pieces:field', { mode: pc.move === 'flow' ? 'curl' : 'fbm', scale: pc.swirl, speed: 0.12, strength: pc.amount }, { uv: pos, time: b.getTime() },
      `The offset field: a direction at every point (${pc.move === 'flow' ? 'curl noise: it tears along lines' : 'noise, turning slowly'}), Strength ${fmt(pc.amount)} long: how far the pieces fly, a share of the frame's height. Pieces reads it at each piece's home (Offset ƒ is a field socket), so neighbours drift together.`);
    offset = ref(vf, 'dir');
  } else if (pc.move === 'mouse') {
    const m = mk(c, 'mouse', 'pieces:mouse', {}, {}, 'The mouse, in the same space as UV: the pieces flee from it.');
    offset = ref(expr(c, 'pieces:push', 'Push from the mouse', [{ name: 'uv', type: 'vec2', from: pos }, { name: 'm', type: 'vec2', from: ref(m, 'uv') }, { name: 'amount', type: 'float', slider: { value: pc.amount, min: 0, max: 1.5 } }],
      'normalize(uv - m + 1e-5) * amount * exp(-length(uv - m) * 4.0)', 'The offset field: away from the mouse, strongest near it (amount at the pointer, fading over a quarter of the frame). Pieces reads it at each home.', 'vec2'), 'result');
  }
  let amount: Ref | null = null;
  let scatter: Ref | null = null;
  const scat = pc.scatter ?? 0;
  if ((offset || scat > 0) && pc.speed > 0) {
    const lfo = mk(c, 'lfo', 'pieces:lfo', { waveform: 'sine', freq: pc.speed, amplitude: 0.5, offset: 0.5 }, { time: b.getTime() },
      `An LFO from 0 to 1 and back, ${fmt(pc.speed)} times a second: the picture breaks up and comes home.`);
    const ease = ref(expr(c, 'pieces:ease', 'Ease', [{ name: 'v', type: 'float', from: ref(lfo, 'value') }], 'smoothstep(0.15, 0.95, v)',
      `The LFO eased: it rests at 0 a moment (the picture whole) before it scatters again. It is Pieces' Amount${scat > 0 ? ' and, times Scatter, its Scatter' : ''}.`, 'float'), 'result');
    if (offset) amount = ease;
    if (scat > 0) {
      scatter = ref(expr(c, 'pieces:scatter', 'Scatter', [{ name: 'v', type: 'float', from: ease }, { name: 'scatter', type: 'float', slider: { value: scat, min: 0, max: 1 } }], 'scatter * v',
        'Scatter on the LFO: every piece\'s own random push (its direction and distance from the Seed), scaled by the eased LFO, so the pieces fly apart and land back home.', 'float'), 'result');
    }
  }
  const node = mk(c, 'pieces', 'pieces', {
    shape: pc.shape, count: pc.count, size: pc.size, colourMode: pc.colour, sizeBy: pc.sizeBy, minSize: pc.sizeBy === 'none' ? 0.15 : 0, amount: 1,
    aspect: t?.src.aspect ?? 0,
    scatter: scat, seed: pc.seed ?? 1, scatterTurn: pc.scatterTurn ?? 0, scatterSize: pc.scatterSize ?? 0, dimFloor: pc.dim ?? 0,
  }, { uv: pos, picture: t?.out, offset, amount, background: behind, scatter },
  `Picture in pieces: “${pc.tex}” rebuilt from ${pc.count} ${pc.shape === 'glyph' ? 'glyphs' : `${pc.shape}s`} across, each the picture's colour ${pc.colour === 'piece' ? 'round its home (it carries its piece)' : 'at its home'}${pc.sizeBy !== 'none' ? `, sized by its ${pc.sizeBy}` : ''}${scat > 0 ? `, scattered up to ${fmt(scat)} each its own way (Seed ${fmt(pc.seed ?? 1)})` : ''}. ${offset ? 'The offset moves them, and with them the picture.' : 'Wire a field into Offset ƒ to move them.'} What is behind shows between them (Background).`);
  return ref(node, 'color');
}

// ── A picture with depth (depth.ts, docs/depth-mix.md) ──────────────────────

interface DepthPicRefs { color: Ref; depth: Ref; shapes: GraphNode | null; name: string }

/**
 * The picture over the whole frame (a Picture fit and a Sample, at the screen's point), its Depth node (reading the
 * same place, so depth and colour line up; baked when Generate depth ran), and, when the shapes respond to depth, the
 * Depth Mix they read: Scale into each layer's Grow, Depth UV as their point.
 */
function emitDepthPicture(b: B, d: DepthPic2D, screen: Ref, pos: Ref): DepthPicRefs | null {
  const { c } = b;
  const t = texFor(b, d.tex, 'The picture with depth');
  if (!t) return null;
  // Stretch reads the picture at the screen's own point (no fit needed); Fill and Fit go through a Picture fit.
  const pic = d.fit === 'stretch'
    ? { color: ref(mk(c, 'sampleTexture', 'depth:pic:sample', {}, { texture: t.out, uv: screen }, `Reads the picture “${t.src.name}” stretched over the whole frame: its colour at this pixel.`), 'color'), place: null as Ref | null }
    : samplePicture(b, 'depth:pic', newTexUse(t.src.name, { fit: d.fit }), t.src, t.out, screen, SCREEN_EXT, 'the picture with depth');
  const baked = !!d.bake;
  const dn = mk(c, 'depth', 'depth', baked ? { update: 'baked', depthBake: structuredClone(d.bake) } : {}, { texture: t.out, uv: pic.place },
    `Depth: how far each part of “${t.src.name}” is (0 far, 1 near), worked out on this device by a small model. `
      + (baked ? 'Generate depth ran it once in the 2D Scene Builder and kept the result as an image beside the picture (Update: Baked), so it is ready at once and goes into exported pages. ' : 'It runs live once the model is downloaded (the card offers it); Bake depth on the card keeps it, smooth and ready for exported pages. ')
      + (pic.place ? 'Its UV is wired from the picture\'s fit, so the depth lines up with the picture whatever its shape.' : 'It reads this pixel, as the stretched picture does.'));
  let shapes: GraphNode | null = null;
  if (d.size.on || d.space.on) {
    const what = [d.size.on ? `Scale (${fmt(d.size.far)} far … ${fmt(d.size.near)} near) grows every layer through its Transform's Grow` : '', d.space.on ? `Depth UV (${DEPTH_SPACE_LABELS[d.space.style].label.toLowerCase()}, amount ${fmt(d.space.amount)}) is the point every shape is measured from` : ''].filter(Boolean).join('; ');
    shapes = mk(c, 'depthMix', 'depth:shapes', { ...depthMixParams(d), mode: d.space.on ? 'space' : 'size' }, { picture: pic.color, depth: ref(dn, 'depth'), uv: pos },
      `Depth Mix for the shapes: ${what}. Its Color isn't used: the second Depth Mix puts the scene and the picture together (one node can't do both, as the shapes it moves feed that one's Scene). `
        + 'Depth range and Curve shape the depth first (live sliders).');
  }
  return { color: pic.color, depth: ref(dn, 'depth'), shapes, name: t.src.name };
}

/** The scene and the picture put together by depth (the look), with the gradient over depth. */
function emitDepthMix(b: B, d: DepthPic2D, p: DepthPicRefs, scene: Ref, dists: Ref[]): Ref {
  const { c } = b;
  let coverage: Ref | null = null;
  if (d.with === 'over' && dists.length && (d.look === 'top' || d.look === 'occlude' || d.look === 'fog')) {
    let u = dists[0];
    dists.slice(1).forEach((x, i) => { u = ref(mk(c, 'sdfUnion', `depth:u${i + 1}`, { k: 0 }, { a: u, b: x }, 'Joins the layers into one distance for the Scene mask.'), 'dist'); });
    coverage = ref(expr(c, 'depth:mask', 'Scene mask', [{ name: 'd', type: 'float', from: u }], '1.0 - smoothstep(-0.003, 0.003, d)',
      'Where the shapes are (1) and aren\'t (0): With the picture: Over paints the scene over the picture only here (glows outside the shapes are left out).', 'float'), 'result');
  }
  const g = d.gradient;
  const phase = g && g.flow ? ref(mk(c, 'multiply', 'depth:flow', { b: g.flow }, { a: b.getTime() }, `Time × ${fmt(g.flow)}: the gradient's colours flow along depth at ${fmt(g.flow)} cycles a second.`), 'result') : null;
  const look = DEPTH_LOOK_LABELS[d.look];
  const node = mk(c, 'depthMix', 'depth:mix', depthMixParams(d), { picture: p.color, depth: p.depth, scene, coverage, phase },
    `Depth Mix: the scene and the picture “${p.name}” put together by depth. ${look.label}: ${look.blurb} `
      + `${d.look === 'top' || d.look === 'occlude' || d.look === 'fog' ? `With the picture: ${DEPTH_MIX_COMBINE_LABELS[d.with].label} (${DEPTH_MIX_COMBINE_LABELS[d.with].blurb.toLowerCase()}) ` : ''}`
      + `Picture ${fmt(d.picture)} is how bright the picture shows. Depth range ${fmt(d.range[0])}–${fmt(d.range[1])} and Curve ${fmt(d.curve)} shape the depth first. `
      + (g ? `A ${g.palette} gradient is laid along depth on ${g.on === 'both' ? 'the scene and the picture' : `the ${g.on}`} (${g.how}, ${fmt(g.cycles)} cycle${g.cycles === 1 ? '' : 's'} far to near${g.flow ? ', flowing with time through Phase' : ''}). ` : '')
      + `Built by the 2D Scene Builder: ${depthSummary(d)}. Every slider is live.`);
  return ref(node, 'color');
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
      g.colourBy === 'ripple' ? 'Colours each cell by the ripple passing through it, so the waves show as colour.' : 'Colours each cell with its own random value through a palette.', L.custom, L.customName);
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
