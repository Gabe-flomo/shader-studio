/**
 * surprise.ts — the 2D Scene Builder's Surprise me (docs/scene-builder-2d.md, "Surprise me"): a
 * whole random scene from a seed, built from the space-block library, a few shapes with motion and
 * copies, and a look. The same seed always gives the same scene. Pure: no React, no store.
 *
 * What keeps it good-looking:
 *  - one or two blocks (sometimes a combine of two), sliders varied inside their ranges the way
 *    Random varies them; a stack that throws points far away or to NaN is dealt again;
 *  - glowing outlines and rings on a dark ground, colours from one harmonious palette;
 *  - ACES tone mapping (AgX greyed the dark ground), a little vignette now and then;
 *  - now and then shapes coloured from a palette's slots, a same-frame glow, a touch of grade and,
 *    rarely, one tasteful effect (a little chromatic aberration, a CRT mask).
 */
import { darkBackground, harmoniousPalette, makeRng, type Rng } from '../lib/surprise';
import { randomChoices } from './blockLibrary';
import { MOTIONS, emptyScene, newBlockOp, newCombineOp, newDup, newMotion, newShape, type MotionKind, type Scene2D, type ShapeSpec, type Vec3 } from './spec';
import { stackMap } from './thumbnails';
import { newStackItem, type StackItem } from '../builders/look/stack';
import { GRADE_BY_KIND } from '../builders/look/grade';
import { FX_BY_KIND } from '../builders/look/effects';

const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** Blocks that look broken more often than good in a random scene (still in the library and in Random). */
const HARSH = ['tangent-tear', 'pixel-steps'];

/** Shapes that read well glowing, with a size for each (the key is the shape's size setting). */
const SHAPES: Array<{ kind: string; w: number; size: (rng: Rng) => Record<string, number | [number, number]> }> = [
  { kind: 'ring', w: 4, size: rng => ({ r: r3(rng.float(0.18, 0.45)), th: r3(rng.float(0.01, 0.035)) }) },
  { kind: 'circle', w: 2, size: rng => ({ r: r3(rng.float(0.08, 0.3)) }) },
  { kind: 'star', w: 2, size: rng => ({ r: r3(rng.float(0.18, 0.35)), inner: r3(rng.float(0.35, 0.6)) }) },
  { kind: 'burst', w: 1, size: rng => ({ r: r3(rng.float(0.2, 0.35)), points: rng.int(5, 12), sharp: r3(rng.float(2.2, 3.5)) }) },
  { kind: 'hexagon', w: 2, size: rng => ({ r: r3(rng.float(0.15, 0.35)) }) },
  { kind: 'triangle', w: 1, size: rng => ({ r: r3(rng.float(0.15, 0.3)) }) },
  { kind: 'box', w: 1, size: rng => { const s = r3(rng.float(0.12, 0.3)); return { size: [s, r3(s * rng.float(0.5, 1.2))] }; } },
  { kind: 'vesica', w: 1, size: rng => ({ w: r3(rng.float(0.2, 0.35)), h: r3(rng.float(0.08, 0.16)) }) },
  { kind: 'heart', w: 1, size: rng => ({ size: r3(rng.float(0.2, 0.32)) }) },
];

/** A stack that keeps points in view: no NaN, and the grid not flung far away. */
function tame(scene: Scene2D): boolean {
  const m = stackMap(scene.space, 1);
  let far = 0;
  for (let j = 0; j < 9; j++) {
    for (let i = 0; i < 9; i++) {
      const [x, y] = m((i / 8 - 0.5) * 2, (j / 8 - 0.5) * 2);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
      if (Math.abs(x) > 8 || Math.abs(y) > 8) far++;
    }
  }
  return far < 12;
}

function space(rng: Rng, scene: Scene2D): void {
  for (let attempt = 0; attempt < 8; attempt++) {
    const r = rng.fork(`space${attempt}`);
    scene.space = [];
    const picks = randomChoices(() => r.next(), 3, HARSH);
    if (r.chance(0.25)) {
      scene.space.push(newCombineOp('p1', picks[0], picks[1], r.pick(['add', 'blend', 'add', 'multiply'] as const), r3(r.float(0.3, 0.7))));
    } else {
      const n = r.weighted([[1, 3], [2, 2]] as const);
      picks.slice(0, n).forEach((b, i) => scene.space.push(newBlockOp(`p${i + 1}`, b)));
    }
    if (tame(scene)) return;
  }
  scene.space = [];
}

/** A random, good-looking 2D scene from `seed`. */
export function surpriseScene2D(seed: number | string): Scene2D {
  const rng = makeRng(seed);
  const s = emptyScene();
  space(rng.fork('space'), s);

  const look = rng.fork('look');
  const n = look.weighted([[1, 3], [2, 3], [3, 1]] as const);
  const cols = harmoniousPalette(look, n, { light: [0.5, 0.7], sat: [0.6, 0.95] });
  const sh = rng.fork('shapes');
  for (let i = 0; i < n; i++) {
    const def = sh.weighted(SHAPES.map(x => [x, x.w] as const));
    const id = `s${i + 1}`;
    const shape: ShapeSpec = newShape(def.kind, id, { color: cols[i] as Vec3, glow: true });
    shape.size = { ...shape.size, ...def.size(sh) };
    if (def.kind !== 'ring' && sh.chance(0.6)) shape.hollow = r3(sh.float(0.006, 0.02));
    if (i > 0 || sh.chance(0.4)) {
      // A ring of copies, now and then rings of rings or the ring at several sizes.
      shape.dup = newDup({ count: sh.int(3, 9), radius: r3(sh.float(0.3, 0.6)) });
      if (sh.chance(0.2)) shape.dup.inner = { count: sh.int(3, 6), radius: r3(sh.float(0.08, 0.16)) };
      else if (sh.chance(0.25)) { shape.dup.levels = sh.int(2, 3); shape.dup.factor = r3(sh.float(1.4, 1.8)); }
      shape.scale = r3(sh.float(0.35, 0.7));
    }
    if (sh.chance(0.6)) {
      const kind = sh.pick(MOTIONS.map(m => m.kind)) as MotionKind;
      const m = newMotion(kind, `m${i + 1}`);
      m.speed = r3(m.speed * sh.float(0.5, 1.4) * sh.sign());
      if (m.amount) m.amount = r3(m.amount * sh.float(0.5, 1));
      shape.motion.push(m);
    }
    s.layers.push(shape);
  }

  const L = s.look;
  L.bg = darkBackground(look) as Vec3;
  L.glow = { mode: 'all', amount: r3(look.float(0.003, 0.009)), falloff: r3(look.float(1.25, 1.7)), tint: null };
  // ACES keeps the dark ground dark; AgX lifted it to grey in every trial sheet.
  L.tone = 'aces';
  if (look.chance(0.35)) {
    L.colour = { by: look.pick(['length', 'angle', 'distance'] as const), palette: look.pick(['sunset', 'rainbow', 'teal', 'warm', 'haze', 'ice']), scale: r3(look.float(0.6, 1.6)), speed: look.chance(0.5) ? r3(look.float(0.05, 0.25)) : 0 };
  }
  if (look.chance(0.5)) L.post.vignette = r3(look.float(0.2, 0.5));
  finish(rng.fork('finish'), s);
  return s;
}

/** Palettes that colour a glowing scene well, as slots. */
const SLOT_PALETTES = ['sunset', 'teal', 'warm', 'haze', 'ice', 'heat', 'fire'];

/**
 * The palette, grade and effects, now and then and lightly: shapes coloured from a library
 * palette's slots, a same-frame glow (Bloom is no longer offered), a touch of grade, and once in a
 * while one effect that suits a glowing scene (a little chromatic aberration, a CRT mask).
 */
function finish(rng: Rng, s: Scene2D) {
  const L = s.look;
  if (rng.chance(0.3) && L.colour.by === 'layer') {
    L.colour.palette = rng.pick(SLOT_PALETTES);
    const shift = rng.int(0, 4);
    s.layers.forEach((it, i) => { it.slot = (i + shift) % 5; });
  }
  const grade: StackItem[] = [];
  if (rng.chance(0.25)) grade.push(newStackItem(GRADE_BY_KIND.saturation, 'gr1', { amount: r3(rng.float(1.1, 1.35)) }));
  if (rng.chance(0.15)) grade.push(newStackItem(GRADE_BY_KIND.levels, `gr${grade.length + 1}`, { blacks: r3(rng.float(0.01, 0.05)), whites: 1, curve: r3(rng.float(0.3, 0.6)) }));
  if (grade.length) L.grade = grade;
  const fx: StackItem[] = [];
  if (rng.chance(0.3)) fx.push(newStackItem(FX_BY_KIND.glow, 'fx1', { intensity: r3(rng.float(0.4, 0.9)), threshold: r3(rng.float(0.45, 0.7)), radius: Math.round(rng.float(10, 24)) }));
  const roll = rng.float(0, 1);
  if (roll < 0.1) fx.push(newStackItem(FX_BY_KIND.chroma, `fx${fx.length + 1}`, { amount: r3(rng.float(1.5, 4)) }));
  else if (roll < 0.17) fx.push(newStackItem(FX_BY_KIND.crt, `fx${fx.length + 1}`, { mask: rng.pick(['slot', 'aperture']), size: rng.pick([4, 5, 6]), strength: r3(rng.float(0.4, 0.7)), curve: r3(rng.float(0.02, 0.05)) }));
  if (fx.length) s.effects = fx;
}
