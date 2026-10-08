/**
 * surprise.ts — the random statement generator: "surprise me" in the Do… bar (a command and a
 * button) builds a whole line of the language from simple grammar rules (§13, "Randomness").
 *
 * A line follows the order most shaders are built in (docs/structure-hints.md), each stage taken
 * with a weight learned from how common it is:
 *
 *   2D  space → shape → shape it → colour → post        circle · twist 1.2 · glow falloff=9 · colour by angle palette=fire · tone-map
 *   3D  mode → objects (and combines) → bend → lighting → camera → output
 *       gi · smooth-union(sphere r=0.6, torus R=0.7 r=0.15) k=0.3 · twist 0.8 · fog 0.2 · camera orbit=8
 *
 * Size sets how many stages and parts: small (3–4 clauses), medium (5–6), large (7–9). Values come
 * from the registry's interesting ranges through the app's seeded generator (src/lib/surprise),
 * so a seed always makes the same line. The line is ordinary canonical text: it shows in the bar,
 * reads back, and can be edited before it runs. Tests check every size and dialect over hundreds
 * of seeds: each line reads with no mistakes and runs to a graph that compiles.
 */
import { drawFrom, makeRng, freshSeed, type RandSpec, type Rng } from './random';
import { lookupHead, type Entry } from './registry';
import { printValue, fmtNum } from './print';
import { PALETTES } from '../sceneBuilder/output';
import { SHAPES as SCENE_SHAPES, WARPS } from '../sceneBuilder/spec';
import { sceneRand } from './sceneRand';
import { moveById } from '../suggestions/moves';
import { leanWeights, leanList, type SurpriseBias } from './surpriseBias';

export type SurpriseSize = 'small' | 'medium' | 'large';
export type SurpriseDialect = '2d' | '3d';

export interface SurpriseOptions {
  seed?: number; size?: SurpriseSize; dialect?: SurpriseDialect;
  /** Word counts from the examples and saved graphs (surpriseBias.ts): the word choices lean toward them, a little. */
  bias?: SurpriseBias;
}

const val = (spec: RandSpec | undefined, rng: Rng, fallback: string): string => (spec ? printValue(drawFrom(spec, rng)) : fallback);
const step = (head: string) => lookupHead(head, 'picture', ['step', 'maker'])!.entry;
/** A clause with its primary value (and maybe one more setting) drawn from the interesting ranges. */
function clause(e: Entry, rng: Rng, extra = 0.4): string {
  const parts = [e.words[0]];
  const primary = e.params.find(p => p.primary && p.rand);
  if (primary && rng.chance(0.8)) parts.push(val(primary.rand, rng, ''));
  for (const p of e.params) {
    if (p === primary || !p.rand || p.key === 'at') continue;
    // Only the settings of the step's usual move (glow on a shape: falloff and colour).
    if (e.move && !(moveById(e.move)?.args ?? []).some(a => a.name === p.key || p.aliases?.includes(a.name))) continue;
    if (rng.chance(extra)) parts.push(`${p.key}=${val(p.rand, rng, '')}`);
  }
  return parts.filter(Boolean).join(' ');
}

const SHAPE_W: Array<readonly [string, number]> = [['circle', 4], ['ring', 2], ['box', 2], ['star', 3], ['hexagon', 2], ['heart', 1], ['triangle', 1], ['moon', 1], ['cross', 1], ['diamond', 1], ['pentagon', 1], ['octagon', 1]];
const SPACE_W: Array<readonly [string, number]> = [['twist', 3], ['swirl', 3], ['polar-repeat', 3], ['repeat', 2], ['mirror', 2], ['warp', 2], ['zoom-rotate', 1]];
const SHAPE_IT_W: Array<readonly [string, number]> = [['glow', 6], ['rings', 3], ['outline', 2]];
const POST_W: Array<readonly [string, number]> = [['tone-map', 4], ['grain', 2], ['brighten', 1]];
const DRIVERS_W: Array<readonly [string, number]> = [['length', 4], ['angle', 3], ['x', 1], ['y', 1], ['time', 2]];
const COUNTS: Record<SurpriseSize, [number, number]> = { small: [3, 4], medium: [5, 6], large: [7, 9] };

/** A 2D picture line. */
function line2d(rng: Rng, size: SurpriseSize, bias?: SurpriseBias): string {
  const [lo, hi] = COUNTS[size];
  const want = rng.int(lo, hi);
  const paletteKeys = PALETTES.filter(p => p.kind === 'palette').map(p => p.key);
  const palette = () => (bias ? rng.weighted(leanList('palette', paletteKeys, bias)) : rng.pick(paletteKeys));
  // A noise field now and then (shape → colour), else a shape lit by a shape-it step.
  if (rng.chance(0.2)) {
    const out = [`noise${rng.chance(0.5) ? ` scale=${fmtNum(Math.round(rng.float(1.5, 6) * 10) / 10)}` : ''}`];
    if (rng.chance(0.7)) out.push(clause(step('warp'), rng, 0));
    out.push(`colour by it palette=${palette()}`);
    out.push('output');
    while (out.length < want) {
      const post = rng.weighted(leanWeights('post', POST_W, bias));
      if (out.some(c => c.startsWith(post))) break;
      out.splice(out.length - 1, 0, clause(step(post), rng, 0));
    }
    return out.join(' · ');
  }
  const shape = rng.weighted(leanWeights('shape', SHAPE_W, bias));
  const out: string[] = [rng.chance(0.4) ? `${shape} r=${val(step(shape).params.find(p => p.key === 'r')?.rand, rng, '0.25')}` : shape];
  const spaces = size === 'small' ? (rng.chance(0.4) ? 1 : 0) : size === 'medium' ? rng.int(1, 2) : rng.int(1, 3);
  const used = new Set<string>();
  for (let i = 0; i < spaces; i++) {
    const s = rng.weighted(leanWeights('space', SPACE_W, bias));
    if (used.has(s)) continue;
    used.add(s);
    out.push(clause(step(s), rng, 0.2));
  }
  out.push(clause(step(rng.weighted(leanWeights('shapeIt', SHAPE_IT_W, bias))), rng, 0.3));
  if (out.length < want || rng.chance(0.8)) out.push(`colour by ${rng.weighted(leanWeights('driver', DRIVERS_W, bias))}${rng.chance(0.7) ? ` palette=${palette()}` : ''}`);
  const posts = Math.max(0, want - out.length);
  const usedPost = new Set<string>();
  for (let i = 0; i < posts; i++) {
    const p = rng.weighted(leanWeights('post', POST_W, bias));
    if (usedPost.has(p)) continue;
    usedPost.add(p);
    out.push(clause(step(p), rng, 0.3));
  }
  return out.join(' · ');
}

const MODES_W: Array<readonly ['surface' | 'gi' | 'volumetric' | 'glass', number]> = [['surface', 5], ['gi', 3], ['volumetric', 2], ['glass', 1]];
const SCENE_SHAPE_W: Array<readonly [string, number]> = [['sphere', 4], ['box', 3], ['torus', 3], ['capsule', 2], ['cylinder', 2], ['cone', 1], ['octahedron', 2], ['capped-torus', 1], ['box-frame', 1], ['pyramid', 1], ['ellipsoid', 1]];
const WARP_W: Array<readonly [string, number]> = [['twist', 3], ['bend', 2], ['polar-repeat', 2], ['sine', 2], ['fold', 1], ['warp', 2], ['kaleido', 1]];

/** A 3D scene line. */
function line3d(rng: Rng, size: SurpriseSize, bias?: SurpriseBias): string {
  const mode = rng.weighted(leanWeights('mode', MODES_W, bias));
  const [lo, hi] = COUNTS[size];
  const want = rng.int(lo, hi);
  const shapeText = (kind: string, at?: string) => {
    const def = SCENE_SHAPES.find(s => s.kind === kind);
    if (!def) return kind;
    const parts = [kind];
    const p = def.params[0];
    if (p && rng.chance(0.6)) { const r = sceneRand(p); const v = drawFrom(r, rng); parts.push(`${p.key}=${printValue(v)}`); }
    if (at) parts.push(`at=${at}`);
    if (mode !== 'volumetric' && rng.chance(0.6)) parts.push(`color=${printValue(drawFrom({ kind: 'colour' }, rng))}`);
    if (mode === 'glass' && rng.chance(0.6)) parts.push('glass');
    return parts.join(' ');
  };
  const out: string[] = [mode];
  const nShapes = size === 'small' ? 1 : size === 'medium' ? rng.int(1, 2) : rng.int(2, 3);
  const kinds = Array.from({ length: nShapes }, () => rng.weighted(leanWeights('scene', SCENE_SHAPE_W, bias)));
  if (nShapes >= 2 && rng.chance(0.6)) {
    const op = rng.weighted([['smooth-union', 4], ['subtract', 2], ['smooth-intersect', 1], ['union', 1]] as const);
    out.push(`${op}(${kinds.map((k, i) => shapeText(k, i ? `(${fmtNum(rng.float(-0.5, 0.5))},${fmtNum(rng.float(-0.3, 0.4))},0)` : undefined)).join(', ')})${op.startsWith('smooth') ? ` k=${fmtNum(Math.round(rng.float(0.1, 0.45) * 100) / 100)}` : ''}`);
  } else kinds.forEach((k, i) => out.push(shapeText(k, i ? `(${fmtNum(rng.float(-0.9, 0.9))},0,0)` : undefined)));
  const warps = size === 'small' ? (rng.chance(0.5) ? 1 : 0) : size === 'medium' ? 1 : rng.int(1, 2);
  for (let i = 0; i < warps; i++) {
    const word = rng.weighted(leanWeights('warp3', WARP_W, bias));
    const def = WARPS.find(w => w.kind === (word === 'warp' ? 'noise' : word));
    const p = def?.params[0];
    out.push(p ? `${word} ${printValue(drawFrom(sceneRand(p), rng))}` : word);
  }
  if (mode === 'surface' && rng.chance(0.5)) out.push(`plane y=-${fmtNum(Math.round(rng.float(0.6, 1.2) * 10) / 10)}`);
  const settings: string[] = [];
  if (rng.chance(0.4)) settings.push(`fog ${fmtNum(Math.round(rng.float(0.05, 0.4) * 100) / 100)}`);
  if (rng.chance(0.6)) settings.push(`camera orbit=${rng.int(4, 14)}${rng.chance(0.4) ? ` elev=${rng.int(8, 30)}` : ''}`);
  if (mode !== 'volumetric' && rng.chance(0.3)) settings.push(`tone ${rng.pick(['aces', 'agx', 'hable'])}`);
  if ((mode === 'surface' || mode === 'gi') && rng.chance(size === 'large' ? 0.4 : 0.15)) settings.push(`colour by ${rng.pick(['depth', 'height', 'normal', 'distance'])} palette=${rng.pick(PALETTES).key}`);
  for (const s of settings) if (out.length < want + 1) out.push(s);
  return out.join(' · ');
}

/** A random line of the language: 2D by default, the seed and size given or drawn. */
export function surpriseLine(o: SurpriseOptions = {}): { line: string; seed: number; size: SurpriseSize; dialect: SurpriseDialect } {
  const seed = o.seed ?? freshSeed();
  const rng = makeRng(seed);
  const size = o.size ?? 'medium';
  const dialect = o.dialect ?? '2d';
  return { line: dialect === '3d' ? line3d(rng, size, o.bias) : line2d(rng, size, o.bias), seed, size, dialect };
}

/** "surprise me", "surprise me large 3d", "surprise me small seed=42": the bar's command (null: not one). */
export function readSurpriseCommand(text: string): SurpriseOptions | null {
  const t = text.trim().toLowerCase();
  const m = /^(surprise( me)?|random statement|random line)\b(.*)$/.exec(t);
  if (!m) return null;
  const rest = m[3];
  const size = /\b(small|short|tiny)\b/.test(rest) ? 'small' : /\b(large|big|long)\b/.test(rest) ? 'large' : /\b(medium)\b/.test(rest) ? 'medium' : undefined;
  const dialect = /\b(3d|scene)\b/.test(rest) ? '3d' : /\b(2d|picture)\b/.test(rest) ? '2d' : undefined;
  const s = /\bseed\s*=?\s*(\d+)/.exec(rest);
  return { ...(size ? { size } : {}), ...(dialect ? { dialect } : {}), ...(s ? { seed: Number(s[1]) } : {}) };
}
