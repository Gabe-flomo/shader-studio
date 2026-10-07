/**
 * surprise.ts — the Scene Builder's randomness (docs/surprise.md): a whole random scene
 * (Surprise me), one random shape (Random shape) and new settings for one item (Randomise this).
 *
 * Every function takes a seeded generator (lib/surprise), so a seed always rebuilds the same
 * scene. Values come from curated bands, not the sliders' legal ranges: sizes near a shape's
 * default, blends that melt without swallowing, warps strong enough to see and weak enough not
 * to tear the march, a camera far enough to frame what is there. Subtract and intersect only ever
 * hold overlapping shapes, so a cut or an overlap is never empty.
 *
 * Pure: the window (components/sceneBuilder) checks the picture's frame stats and retries.
 */
import { darkBackground, harmoniousPalette, hslToRgb, lightBackground, makeRng, randomColour, type Rng } from '../lib/surprise';
import { addShape } from './edit';
import {
  DEFAULT_CAMERA, DEFAULT_LOOK, DEFAULT_QUALITY, SHAPE_BY_KIND, WARP_BY_KIND,
  findItem, newGroup, newShape, newWarp, nextId, walkItems,
  type CombineOp, type GroupSpec, type RenderMode, type SceneItem, type SceneSpec, type ShapeSpec, type Vec3, type WarpSpec,
} from './spec';
import type { OutputShow } from './output';

const round = (v: number, d = 3) => Math.round(v * 10 ** d) / 10 ** d;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Shapes Surprise me picks from, by weight (the floor and the space-filling lattices are added separately). */
const SHAPE_WEIGHTS: Array<readonly [string, number]> = [
  ['sphere', 6], ['box', 5], ['torus', 4], ['cylinder', 3], ['capsule', 3], ['octahedron', 3], ['ellipsoid', 3],
  ['cone', 2], ['capped-cone', 2], ['hex-prism', 2], ['tri-prism', 2], ['link', 2], ['box-frame', 2], ['capped-torus', 2],
  ['pyramid', 2], ['solid-angle', 1],
];

/** A shape's size settings: near its default (×0.6–1.5), within its legal range. */
export function randomSize(kind: string, rng: Rng): ShapeSpec['size'] {
  const def = SHAPE_BY_KIND[kind];
  const out: ShapeSpec['size'] = {};
  for (const p of def?.params ?? []) {
    const d = p.def;
    const fit = (v: number) => round(clamp(v, p.min, p.max));
    if (p.key === 'round') out[p.key] = rng.chance(0.45) ? round(rng.float(0.02, 0.09)) : 0;
    else if (p.key === 'ball') out[p.key] = round(rng.float(0.85, 1.2));
    else if (p.key === 'y') out[p.key] = round(rng.float(-1, -0.6));
    else if (p.deg) out[p.key] = round(clamp(Number(d) * rng.float(0.6, 1.5), Math.max(p.min, 8), Math.min(p.max, 150)), 1);
    else if (p.key === 'count') out[p.key] = d;
    else if (Array.isArray(d)) {
      const k = rng.float(0.7, 1.3);
      out[p.key] = d.map(v => fit(v * k * rng.float(0.7, 1.4))) as Vec3;
    } else out[p.key] = fit(Number(d) * rng.logFloat(0.65, 1.5));
  }
  return out;
}

/** Warps and modifiers Surprise me adds, by weight, with values worth seeing. */
const WARP_WEIGHTS: Array<readonly [string, number]> = [
  ['twist', 3], ['bend', 2], ['displace', 3], ['noise', 2], ['sine', 2], ['mirror', 2], ['polar-repeat', 2], ['round', 2], ['kaleido', 1],
];

/** Values for a warp of `kind`: curated bands (a twist you can see, bumps that don't tear the march). */
export function randomWarpValues(kind: string, rng: Rng): WarpSpec['values'] {
  switch (kind) {
    case 'twist': return { k: round(rng.sign() * rng.float(0.5, 2)) };
    case 'bend': return { k: round(rng.sign() * rng.float(0.2, 0.8)) };
    case 'displace': return { amp: round(rng.float(0.02, 0.07)), freq: round(rng.float(4, 14), 1) };
    case 'noise': return { amt: round(rng.float(0.1, 0.35)), scale: round(rng.float(0.8, 2)), octaves: rng.int(2, 4) };
    case 'sine': return { amp: round(rng.float(0.05, 0.18)), freq: round(rng.float(1.5, 5)), axis: rng.pick(['x', 'y', 'z']), from: rng.pick(['x', 'y', 'z']) };
    case 'mirror': return { axes: rng.pick(['x', 'xz', 'xy', 'xyz']) };
    case 'polar-repeat': return { count: rng.int(3, 9), axis: rng.weighted([['y', 4], ['z', 1], ['x', 1]]) };
    case 'round': return { r: round(rng.float(0.02, 0.08)) };
    case 'onion': return { t: round(rng.float(0.015, 0.05)) };
    case 'kaleido': return { n: rng.int(1, 3), sym: rng.pick(['oct', 'tet', 'icos']) };
    case 'scale': return { s: round(rng.float(0.7, 1.4)) };
    case 'rotate': return { by: [round(rng.float(-45, 45), 1), round(rng.float(-45, 45), 1), round(rng.float(-45, 45), 1)] };
    case 'move': return { by: [round(rng.float(-0.4, 0.4)), round(rng.float(-0.3, 0.3)), round(rng.float(-0.4, 0.4))] };
    case 'repeat': case 'mirror-repeat': { const c = round(rng.float(1.8, 3)); return { cell: [c, c, c] }; }
    case 'limited-repeat': { const c = round(rng.float(0.9, 1.4)); return { cell: [c, c, c], count: [rng.int(1, 2), 0, rng.int(0, 2)] }; }
    case 'turn': return { angle: round(rng.float(-90, 90), 1), axis: rng.pick(['x', 'y', 'z']) };
    case 'fold': return { axes: rng.pick(['xy', 'xz', 'xyz']), offset: [round(rng.float(-0.3, 0.3)), round(rng.float(-0.3, 0.3)), 0] };
    default: return {};
  }
}

const randomRot = (rng: Rng): Vec3 => (rng.chance(0.55) ? [round(rng.float(-50, 50), 1), round(rng.float(-90, 90), 1), round(rng.float(-30, 30), 1)] : [0, 0, 0]);

function makeShape(spec: SceneSpec, kind: string, rng: Rng, colour: Vec3, at: Vec3): ShapeSpec {
  const sh = newShape(kind, nextId(spec, 's'), { at, rot: randomRot(rng), size: randomSize(kind, rng), color: colour, shine: round(rng.float(0, 0.75), 2) });
  return sh;
}

/** A place near the middle (the first shape sits at the centre). */
const spot = (rng: Rng, i: number, spread = 0.75): Vec3 => (i === 0 ? [0, round(rng.float(-0.1, 0.25)), 0] : [round(rng.float(-spread, spread)), round(rng.float(-0.35, 0.6)), round(rng.float(-spread, spread))]);

function opFor(rng: Rng): { op: CombineOp; k: number } {
  const which = rng.weighted<string>([['smooth-union', 6], ['union', 2], ['smooth-subtract', 2], ['subtract', 1], ['smooth-intersect', 1]]);
  if (which === 'smooth-union') return { op: 'union', k: round(rng.float(0.1, 0.4)) };
  if (which === 'union') return { op: 'union', k: 0 };
  if (which === 'smooth-subtract') return { op: 'subtract', k: round(rng.float(0.03, 0.14)) };
  if (which === 'subtract') return { op: 'subtract', k: 0 };
  return { op: 'intersect', k: round(rng.float(0.03, 0.1)) };
}

/**
 * Children for a cut or an overlap: the first shape stays, the rest move onto it (within a third
 * of its size), and an overlap's others grow so they still cross it.
 */
function overlapOnto(first: ShapeSpec, rest: ShapeSpec[], op: CombineOp, rng: Rng): void {
  for (const s of rest) {
    s.at = [round(first.at[0] + rng.float(-0.25, 0.25)), round(first.at[1] + rng.float(-0.2, 0.3)), round(first.at[2] + rng.float(-0.25, 0.25))];
    if (op === 'intersect') for (const [k, v] of Object.entries(s.size)) s.size[k] = Array.isArray(v) ? v.map(x => round(x * 1.4)) as Vec3 : round(v * 1.3);
    if (op === 'subtract') for (const [k, v] of Object.entries(s.size)) if (k !== 'round' && k !== 'angle') s.size[k] = Array.isArray(v) ? v.map(x => round(x * 0.75)) as Vec3 : round(v * 0.8);
  }
}

/** Nest `shapes` into combine groups: a few levels at most, cuts and overlaps on shapes only. */
function nest(spec: SceneSpec, shapes: ShapeSpec[], rng: Rng, depth: number): SceneItem[] {
  if (shapes.length <= 1) return shapes;
  const out: SceneItem[] = [];
  let rest = [...shapes];
  while (rest.length) {
    if (rest.length === 1 || rng.chance(0.25)) { out.push(rest.shift()!); continue; }
    const take = Math.min(rest.length, rng.int(2, Math.min(4, rest.length)));
    const part = rest.slice(0, take);
    rest = rest.slice(take);
    const { op, k } = opFor(rng);
    const g = newGroup('g', { op, k });
    if (op !== 'union') {
      overlapOnto(part[0], part.slice(1), op, rng);
      g.children = part;
    } else if (depth < 2 && part.length >= 3 && rng.chance(0.5)) {
      g.children = nest(spec, part, rng, depth + 1);
    } else g.children = part;
    out.push(g);
  }
  return out;
}

/** Sometimes a modifier on an item (a quarter of the time), set so it shows. */
function maybeWarp(spec: SceneSpec, it: SceneItem, rng: Rng, p = 0.25): void {
  if (!rng.chance(p)) return;
  const kind = rng.weighted(WARP_WEIGHTS);
  // Copies round an axis only show when the item sits off the axis.
  if (kind === 'polar-repeat' && it.type === 'shape') {
    it.at = [round(rng.float(0.5, 0.8)), it.at[1], 0];
    for (const [k, v] of Object.entries(it.size)) if (k !== 'round' && k !== 'angle' && k !== 'ball') it.size[k] = Array.isArray(v) ? v.map(x => round(x * 0.55)) as Vec3 : round(v * 0.55);
  }
  it.warps.push(newWarp(kind, nextId(spec, 'w'), randomWarpValues(kind, rng)));
}

/** How far the scene reaches from the centre (for the camera). */
function extent(spec: SceneSpec): number {
  let r = 0.8;
  walkItems(spec.root, it => {
    if (it.type !== 'shape' || it.kind === 'plane') return;
    const sz = Object.values(it.size).reduce<number>((m, v) => Math.max(m, Array.isArray(v) ? Math.max(...v) : v), 0);
    r = Math.max(r, Math.hypot(...it.at) + Math.min(1.5, sz));
  });
  return r;
}

/** A random look for `mode`: light, sky, background, fog, tone, and the mode's own settings. */
export function randomLook(mode: RenderMode, rng: Rng): SceneSpec['look'] {
  const look = structuredClone(DEFAULT_LOOK);
  look.mode = mode;
  const hue = rng.next();
  const warm = rng.chance(0.6);
  look.sunDir = [round(rng.float(-0.8, 0.8)), round(rng.float(0.5, 1)), round(rng.float(-0.6, 0.8))];
  look.sunColor = warm ? hslToRgb(0.08 + rng.float(-0.03, 0.04), rng.float(0.3, 0.7), rng.float(0.78, 0.9)) : hslToRgb(0.58, rng.float(0.1, 0.4), rng.float(0.82, 0.92));
  look.sky = hslToRgb(warm ? 0.6 : 0.08, rng.float(0.3, 0.6), rng.float(0.4, 0.6));
  look.shadows = rng.chance(0.85) ? round(rng.float(8, 24), 1) : 0;
  look.ao = round(rng.float(0.04, 0.08));
  look.tone = rng.weighted([['aces', 4], ['agx', 3], ['hable', 2], ['reinhard2', 1]]);
  const lightBg = mode !== 'volumetric' && rng.chance(mode === 'surface' ? 0.4 : 0.65);
  // GI bounces the sky onto everything: a mid-tone sky keeps it from washing out.
  const sky = (h: number) => (mode === 'gi' ? hslToRgb(h, rng.float(0.2, 0.45), rng.float(0.35, 0.55)) : lightBackground(rng, h));
  if (lightBg) { look.bg = sky(hue); look.bg2 = rng.chance(0.7) ? sky(hue + 0.1) : null; }
  else { look.bg = darkBackground(rng, hue); look.bg2 = rng.chance(0.6) ? darkBackground(rng, hue + 0.05) : null; }
  look.fog = rng.chance(0.3) ? round(rng.float(0.03, 0.15)) : 0;
  if (mode === 'volumetric') {
    look.glow = { density: round(rng.float(0.02, 0.05)), falloff: round(rng.float(8, 16), 1), shell: rng.chance(0.5) ? round(rng.float(0.04, 0.15)) : 0, exposure: round(rng.float(1, 1.6), 2), tint: randomColour(rng, { light: [0.55, 0.75] }) };
    look.tone = rng.chance(0.5) ? 'none' : 'aces';
    look.fog = 0;
  }
  if (mode === 'glass') look.fog = 0;
  if (mode === 'glass') look.glass = { ior: round(rng.float(1.3, 1.7), 2), dispersion: round(rng.float(0, 0.08)), tint: hslToRgb(rng.next(), rng.float(0, 0.35), rng.float(0.85, 0.97)) };
  if (mode === 'gi') look.gi = { strength: round(rng.float(0.3, 0.7), 2), metal: rng.chance(0.4) ? round(rng.float(0.2, 0.7), 2) : 0, rough: round(rng.float(0.3, 0.7), 2), spec: round(rng.float(0.2, 0.6), 2) };
  return look;
}

/** A camera that frames a scene reaching `reach` from the centre. */
export function randomCamera(rng: Rng, reach = 1.2): SceneSpec['camera'] {
  return {
    ...DEFAULT_CAMERA,
    dist: round(clamp(reach * rng.float(1.9, 2.5), 2.6, 6), 2),
    angle: round(rng.float(-60, 60), 1),
    elev: round(rng.float(8, 30), 1),
    orbit: rng.chance(0.6) ? round(rng.float(3, 10), 1) : 0,
    zoom: round(rng.float(1.35, 1.8), 2),
  };
}

const OUTPUT_PICKS: Array<readonly [{ show: OutputShow; palette?: string }, number]> = [
  [{ show: 'normal' }, 1], [{ show: 'steps', palette: 'heat' }, 1], [{ show: 'ao' }, 1], [{ show: 'distance', palette: 'ice' }, 1],
  [{ show: 'height', palette: 'terrain' }, 1], [{ show: 'position', palette: 'psychedelic' }, 1], [{ show: 'depth', palette: 'sunset' }, 1],
];

/** A whole random scene: 2–6 shapes, nested combines, sometimes modifiers, a look, colours and a camera. */
export function surpriseScene(rng: Rng): SceneSpec {
  const mode = rng.weighted<RenderMode>([['surface', 5], ['volumetric', 2], ['glass', 2], ['gi', 2]]);
  const spec: SceneSpec = { root: newGroup('g1', { name: 'Scene' }), look: randomLook(mode, rng.fork('look')), camera: { ...DEFAULT_CAMERA }, quality: { ...DEFAULT_QUALITY } };
  const n = rng.int(2, 6);
  // GI shades everything with the first shape's colour and a bright bounce: deeper colours keep it from washing out.
  const colours = harmoniousPalette(rng.fork('colours'), n, mode === 'gi' ? { light: [0.3, 0.5], sat: [0.55, 0.9] } : {});
  const kinds: string[] = [];
  // At most one lattice (it fills a ball), mostly in volumetric.
  const lattice = rng.chance(mode === 'volumetric' ? 0.35 : 0.08);
  for (let i = 0; i < n; i++) kinds.push(lattice && i === 0 ? rng.pick(['gyroid', 'schwarz-p']) : rng.weighted(SHAPE_WEIGHTS));
  const shapes: ShapeSpec[] = [];
  for (let i = 0; i < n; i++) {
    const sh = makeShape(spec, kinds[i], rng, colours[i], spot(rng, i));
    shapes.push(sh);
    spec.root.children.push(sh); // so the next id is fresh
  }
  spec.root.children = [];
  spec.root.children = nest(spec, shapes, rng.fork('nest'), 0);
  // Groups made side by side may share an id: number them in tree order.
  let gi = 1;
  walkItems(spec.root, it => { if (it.type === 'group') it.id = `g${gi++}`; });
  walkItems(spec.root, it => { if (it !== spec.root) maybeWarp(spec, it, rng); });
  if (rng.chance(0.1)) spec.root.warps.push(newWarp('mirror', nextId(spec, 'w'), { axes: 'x' }));
  if (mode === 'glass') {
    const glassy = rng.sample(shapes, Math.max(1, Math.ceil(shapes.length / 2)));
    for (const s of glassy) s.glass = true;
  }
  // A floor, sometimes (never in volumetric: glow fills it).
  if (mode !== 'volumetric' && rng.chance(mode === 'glass' ? 0.8 : 0.55)) {
    const floor = newShape('plane', nextId(spec, 's'), { size: { y: round(rng.float(-1.1, -0.75)) }, color: hslToRgb(rng.next(), rng.float(0, 0.25), rng.float(0.35, 0.6)), name: 'Floor' });
    spec.root.children.push(floor);
  }
  spec.camera = randomCamera(rng.fork('camera'), extent(spec));
  spec.quality = { ...DEFAULT_QUALITY, steps: rng.pick([96, 110, 128]) };
  if (rng.chance(0.12)) spec.output = { ...rng.weighted(OUTPUT_PICKS) };
  return spec;
}

/** Surprise me by seed. */
export const surpriseSceneFromSeed = (seed: number) => surpriseScene(makeRng(seed));

/** Random shape: a random kind, size, place, turn and colour, added beside the selection. Returns its id. */
export function addRandomShape(spec: SceneSpec, selectedId: string | null, rng: Rng): string {
  const kind = rng.weighted(SHAPE_WEIGHTS);
  const sh = addShape(spec, kind, selectedId);
  sh.size = randomSize(kind, rng);
  sh.at = spot(rng, 1, 0.9);
  sh.rot = randomRot(rng);
  sh.color = randomColour(rng);
  sh.shine = round(rng.float(0, 0.75), 2);
  maybeWarp(spec, sh, rng, 0.2);
  return sh.id;
}

/**
 * Randomise this: new settings for one item. A shape: size, turn, colour, shine, a nudge to its
 * place and new values for its modifiers. A group: its combine and blend, and its modifiers' values
 * (a cut or overlap keeps its op, so it can't come out empty). The whole scene (the root): a new
 * look and camera. False when there is no such item.
 */
export function randomiseItem(spec: SceneSpec, id: string, rng: Rng): boolean {
  const hit = findItem(spec, id);
  if (!hit) return false;
  const it = hit.item;
  for (const w of it.warps) if (WARP_BY_KIND[w.kind]) w.values = { ...w.values, ...randomWarpValues(w.kind, rng) };
  if (it.type === 'shape') {
    it.size = randomSize(it.kind, rng);
    if (it.kind !== 'plane') {
      it.rot = randomRot(rng);
      it.at = it.at.map(v => round(v + rng.float(-0.15, 0.15))) as Vec3;
    }
    it.color = randomColour(rng);
    it.shine = round(rng.float(0, 0.75), 2);
    return true;
  }
  if (it.id === spec.root.id) {
    spec.look = randomLook(rng.chance(0.75) ? spec.look.mode : rng.pick(['surface', 'volumetric', 'glass', 'gi'] as const), rng);
    spec.camera = randomCamera(rng, extent(spec));
    return true;
  }
  const g = it as GroupSpec;
  if (g.op === 'union') {
    g.k = rng.chance(0.75) ? round(rng.float(0.1, 0.4)) : 0;
  } else g.k = rng.chance(0.7) ? round(rng.float(0.03, g.op === 'subtract' ? 0.14 : 0.1)) : 0;
  return true;
}
