/**
 * depth.ts — a picture with depth in the 2D Scene Builder (docs/scene-builder-2d.md, "Picture with depth";
 * docs/depth-mix.md).
 *
 * The scene keeps one picture with depth (`scene.depth`): the picture (by name, from the shared picker), its depth
 * (a Depth node; Generate depth bakes it once, on this device, into `bake`), how the shapes respond to it (size and
 * space, either or both), how the scene and the picture go together (the look: on top, occlude, fog, mix, light) and
 * a gradient laid along depth. Build turns it into a Sample (texture) for the picture, a Depth node, and two Depth Mix
 * nodes: one the shapes read (Scale into each layer's Grow, Depth UV as their point), one that puts the scene and the
 * picture together. Every setting is a Depth Mix param, so each slider is live on the node.
 *
 * Pure: no React, no store. The recipe clause is `depth-picture` (parseDepthArgs / printDepth).
 */
import type { DepthBakeInfo } from '../nodes/definitions/depth';
import {
  DEPTH_MIX_COMBINES, DEPTH_SPACE_STYLES, DEPTH_GRADIENT_HOWS, DEPTH_GRADIENT_TARGETS,
  type DepthMixCombine, type DepthMixMode, type DepthSpaceStyle, type DepthGradientHow, type DepthGradientTarget,
} from '../nodes/definitions/depthMix';
import { PALETTE_PRESETS } from '../nodes/definitions/color';
import type { TexFit } from '../builders/textures';
import type { Vec2, Vec3 } from './spec';

/** How the scene and the picture go together (a Depth Mix mode; `top` is the scene over the picture). */
export const DEPTH_LOOKS = ['top', 'occlude', 'fog', 'mix', 'light'] as const;
export type DepthLook = typeof DEPTH_LOOKS[number];
export const DEPTH_LOOK_LABELS: Record<DepthLook, { label: string; blurb: string }> = {
  top: { label: 'On top', blurb: 'The scene over the picture, as With the picture says (light added, by default).' },
  occlude: { label: 'Occlude', blurb: 'The scene sits at one depth: near parts of the picture hide it, far parts show it.' },
  fog: { label: 'Fog', blurb: 'The scene fades where the picture is far, into a haze: it sits in the picture\'s air.' },
  mix: { label: 'Mix', blurb: 'The scene and the picture blended by depth: near things show the picture, far things the scene (or the other way).' },
  light: { label: 'Light', blurb: 'The scene is light falling on the picture, strongest on near things; it still glows on its own.' },
};
/** The Depth Mix mode a look builds. */
export const LOOK_MODE: Record<DepthLook, DepthMixMode> = { top: 'size', occlude: 'occlude', fog: 'fog', mix: 'mix', light: 'light' };

/** Recipe words for the space styles (the node's shift / radial / swirl). */
export const SPACE_STYLE_WORDS: Record<DepthSpaceStyle, string> = { shift: 'shift', radial: 'zoom', swirl: 'turn' };

/** The gradient palettes by recipe name: the Palette node's cosine presets ("sunset", "fire", "rainbow"…). */
export const DEPTH_PALETTES: Array<{ key: string; index: number; label: string }> = PALETTE_PRESETS.map((pr, i) => ({
  key: pr.name.toLowerCase().replace(/^iq\s+/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''), index: i, label: pr.name,
}));
export const depthPaletteByKey = (k: string) => DEPTH_PALETTES.find(p => p.key === k);

export interface DepthGradient2D {
  /** A DEPTH_PALETTES key. */
  palette: string;
  on: DepthGradientTarget;
  how: DepthGradientHow;
  amount: number;
  /** How many times the palette repeats from far to near. */
  cycles: number;
  phase: number;
  /** Phase per second (0: still): the colours flow along depth. */
  flow: number;
}

export interface DepthPic2D {
  /** The picture's name in the scene's textures. */
  tex: string;
  /** How the picture covers the frame (tile makes no sense for a photo with depth). */
  fit: Exclude<TexFit, 'tile'>;
  /** The depth Generate depth baked (an image in the library); absent: the Depth node works it out live. */
  bake?: DepthBakeInfo | null;
  /** Shapes grow on near things: Size far … Size near (× their own size). */
  size: { on: boolean; far: number; near: number };
  /** The shapes' point moves by depth. */
  space: { on: boolean; style: DepthSpaceStyle; amount: number; dir: number; focus: number };
  look: DepthLook;
  /** With the picture (on top, occlude and fog). */
  with: DepthMixCombine;
  /** How bright the picture shows under the scene. */
  picture: number;
  /** The depth range [far end, near end] and the curve. */
  range: Vec2;
  curve: number;
  /** Occlude: the scene's depth and the edge's softness. */
  at: number;
  soft: number;
  /** Fog: density, haze and its colour. */
  fog: number;
  haze: number;
  fogColor: Vec3;
  /** Light: strength, the picture's own light, the scene's own glow on top. */
  light: number;
  own: number;
  glow: number;
  /** Mix: what near things show, and how far it goes. */
  near: 'picture' | 'scene';
  mix: number;
  gradient: DepthGradient2D | null;
}

export const DEFAULT_GRADIENT: DepthGradient2D = { palette: 'sunset', on: 'scene', how: 'multiply', amount: 0.8, cycles: 1, phase: 0, flow: 0 };

export function newDepthPic(tex: string, over: Partial<DepthPic2D> = {}): DepthPic2D {
  return {
    tex, fit: 'cover', bake: null,
    size: { on: false, far: 0.4, near: 1.6 },
    space: { on: false, style: 'shift', amount: 0.15, dir: 0, focus: 0 },
    look: 'top', with: 'add', picture: 1, range: [0, 1], curve: 1,
    at: 0.5, soft: 0.05, fog: 1, haze: 0.6, fogColor: [0.72, 0.78, 0.9], light: 3, own: 0.5, glow: 0.35,
    near: 'picture', mix: 1, gradient: null,
    ...over,
  };
}

/** The Depth Mix params for a picture with depth (both nodes take the same; each reads the ones its mode uses). */
export function depthMixParams(d: DepthPic2D): Record<string, unknown> {
  const g = d.gradient;
  const pal = g ? depthPaletteByKey(g.palette) : undefined;
  return {
    mode: LOOK_MODE[d.look], combine: d.with, pictureAmount: d.picture,
    farEnd: d.range[0], nearEnd: d.range[1], curve: d.curve,
    sizeFar: d.size.far, sizeNear: d.size.near,
    spaceStyle: d.space.style, spaceAmount: d.space.amount, angle: d.space.dir, focus: d.space.focus,
    level: d.at, softness: d.soft, fogDensity: d.fog, haze: d.haze, fogColor: [...d.fogColor],
    lightStrength: d.light, ambient: d.own, glowKeep: d.glow, mixNear: d.near, mixAmount: d.mix,
    gradient: pal ? String(pal.index) : 'off', gradientTo: g?.on ?? 'scene', gradientHow: g?.how ?? 'multiply',
    gradientAmount: g?.amount ?? 0.8, gradientScale: g?.cycles ?? 1, gradientPhase: g?.phase ?? 0,
  };
}

/** A line about it, for the tab's summary and notes. */
export function depthSummary(d: DepthPic2D): string {
  const parts = [d.tex];
  if (d.size.on) parts.push('size by depth');
  if (d.space.on) parts.push(`space by depth (${SPACE_STYLE_WORDS[d.space.style]})`);
  parts.push(DEPTH_LOOK_LABELS[d.look].label.toLowerCase());
  if (d.gradient) parts.push(`${d.gradient.palette} gradient`);
  return parts.join(' · ');
}

// ── Recipe ──────────────────────────────────────────────────────────────────

/** What the recipe parser lends: reading values, and reporting a problem at an argument. */
export interface DepthArgReader<A> {
  key(a: A): string | null;
  word(a: A): string | null;
  num(a: A, what: string): number | null;
  vec2(a: A, what: string): Vec2 | null;
  colour(a: A): Vec3 | null;
  fail(a: A, message: string): void;
}

const SPACE_BY_WORD: Record<string, DepthSpaceStyle> = { shift: 'shift', parallax: 'shift', zoom: 'radial', radial: 'radial', turn: 'swirl', swirl: 'swirl' };

/**
 * `depth-picture <name> [fit=] [size | size=(far,near)] [space=shift|zoom|turn shift= dir= focus=] [look=top|occlude|fog|mix|light]
 * [with=add|screen|over|tint] [picture=] [range=(far,near)] [curve=] [at=] [soft=] [fog=] [haze=] [fog-color=] [light=] [own=] [glow=]
 * [near=picture|scene] [mix=] [gradient=<palette>|off gradient-on= gradient-how= gradient-amount= cycles= phase= flow=]`.
 * The name is the first bare word; null when there is none.
 */
export function parseDepthArgs<A>(args: A[], r: DepthArgReader<A>, nameOf: (a: A) => string | null): DepthPic2D | null {
  const named = args.find(a => !r.key(a) && r.word(a) && r.word(a) !== 'size');
  const name = named ? nameOf(named) : null;
  if (!name) return null;
  const d = newDepthPic(name);
  const pick = <T extends string>(a: A, list: readonly T[], what: string): T | null => {
    const w = r.word(a);
    if (w && (list as readonly string[]).includes(w)) return w as T;
    r.fail(a, `${what} is one of ${list.join(', ')}.`);
    return null;
  };
  const n = (a: A, what: string, set: (v: number) => void) => { const v = r.num(a, what); if (v !== null) set(v); };
  const grad = (): DepthGradient2D => (d.gradient ??= { ...DEFAULT_GRADIENT });
  for (const a of args) {
    if (a === named) continue;
    const key = r.key(a);
    if (!key) {
      if (r.word(a) === 'size') { d.size.on = true; continue; }
      r.fail(a, 'depth-picture takes the picture\'s name, then key=value settings.');
      continue;
    }
    switch (key) {
      case 'fit': {
        const w = r.word(a);
        const fit = w === 'fill' ? 'cover' : w === 'fit' ? 'contain' : w;
        if (fit === 'cover' || fit === 'contain' || fit === 'stretch') d.fit = fit; else r.fail(a, 'fit is cover, contain or stretch.');
        break;
      }
      case 'size': { const v = r.vec2(a, 'size'); if (v) { d.size.on = true; d.size.far = v[0]; d.size.near = v[1]; } break; }
      case 'space': {
        const w = r.word(a);
        if (w && SPACE_BY_WORD[w]) { d.space.on = true; d.space.style = SPACE_BY_WORD[w]; } else r.fail(a, 'space is shift, zoom or turn.');
        break;
      }
      case 'shift': case 'space-amount': n(a, key, v => { d.space.on = true; d.space.amount = v; }); break;
      case 'dir': case 'direction': n(a, key, v => { d.space.dir = v; }); break;
      case 'focus': n(a, key, v => { d.space.focus = v; }); break;
      case 'look': { const v = pick(a, DEPTH_LOOKS, 'look'); if (v) d.look = v; break; }
      case 'with': { const v = pick(a, DEPTH_MIX_COMBINES, 'with'); if (v) d.with = v; break; }
      case 'picture': n(a, key, v => { d.picture = Math.max(0, v); }); break;
      case 'range': { const v = r.vec2(a, 'range'); if (v) d.range = v; break; }
      case 'curve': n(a, key, v => { d.curve = Math.max(0.01, v); }); break;
      case 'at': n(a, key, v => { d.at = v; }); break;
      case 'soft': case 'softness': n(a, key, v => { d.soft = Math.max(0, v); }); break;
      case 'fog': n(a, key, v => { d.fog = v; }); break;
      case 'haze': n(a, key, v => { d.haze = v; }); break;
      case 'fog-color': case 'fog-colour': { const c = r.colour(a); if (c) d.fogColor = c; break; }
      case 'light': n(a, key, v => { d.light = v; }); break;
      case 'own': n(a, key, v => { d.own = v; }); break;
      case 'glow': n(a, key, v => { d.glow = v; }); break;
      case 'near': { const v = pick(a, ['picture', 'scene'] as const, 'near'); if (v) d.near = v; break; }
      case 'mix': n(a, key, v => { d.mix = v; }); break;
      case 'gradient': {
        const w = r.word(a);
        if (w === 'off' || w === 'none') { d.gradient = null; break; }
        if (w && depthPaletteByKey(w)) grad().palette = w;
        else r.fail(a, `gradient is off or one of ${DEPTH_PALETTES.map(p => p.key).join(', ')}.`);
        break;
      }
      case 'gradient-on': { const v = pick(a, DEPTH_GRADIENT_TARGETS, 'gradient-on'); if (v) grad().on = v; break; }
      case 'gradient-how': { const v = pick(a, DEPTH_GRADIENT_HOWS, 'gradient-how'); if (v) grad().how = v; break; }
      case 'gradient-amount': n(a, key, v => { grad().amount = v; }); break;
      case 'cycles': n(a, key, v => { grad().cycles = v; }); break;
      case 'phase': n(a, key, v => { grad().phase = v; }); break;
      case 'flow': n(a, key, v => { grad().flow = v; }); break;
      default: r.fail(a, `depth-picture has no setting “${key}”: fit, size, space, shift, dir, focus, look, with, picture, range, curve, at, soft, fog, haze, fog-color, light, own, glow, near, mix, gradient, gradient-on, gradient-how, gradient-amount, cycles, phase, flow.`);
    }
  }
  return d;
}

/** The clause for a picture with depth: only what differs from a new one. */
export function printDepth(d: DepthPic2D, f: { num: (n: number) => string; name: (s: string) => string; colour: (c: Vec3) => string }): string {
  const D = newDepthPic(d.tex);
  const eq = (a: number, b: number) => f.num(a) === f.num(b);
  const out = ['depth-picture', f.name(d.tex)];
  if (d.fit !== 'cover') out.push(`fit=${d.fit}`);
  if (d.size.on) out.push(eq(d.size.far, D.size.far) && eq(d.size.near, D.size.near) ? 'size' : `size=(${f.num(d.size.far)},${f.num(d.size.near)})`);
  if (d.space.on) {
    out.push(`space=${SPACE_STYLE_WORDS[d.space.style]}`);
    if (!eq(d.space.amount, D.space.amount)) out.push(`shift=${f.num(d.space.amount)}`);
  }
  if (!eq(d.space.dir, D.space.dir)) out.push(`dir=${f.num(d.space.dir)}`);
  if (!eq(d.space.focus, D.space.focus)) out.push(`focus=${f.num(d.space.focus)}`);
  if (d.look !== D.look) out.push(`look=${d.look}`);
  if (d.with !== D.with) out.push(`with=${d.with}`);
  if (!eq(d.picture, D.picture)) out.push(`picture=${f.num(d.picture)}`);
  if (!eq(d.range[0], D.range[0]) || !eq(d.range[1], D.range[1])) out.push(`range=(${f.num(d.range[0])},${f.num(d.range[1])})`);
  const nums: Array<[string, number, number]> = [['curve', d.curve, D.curve], ['at', d.at, D.at], ['soft', d.soft, D.soft], ['fog', d.fog, D.fog], ['haze', d.haze, D.haze], ['light', d.light, D.light], ['own', d.own, D.own], ['glow', d.glow, D.glow], ['mix', d.mix, D.mix]];
  for (const [k, v, def] of nums) if (!eq(v, def)) out.push(`${k}=${f.num(v)}`);
  if (d.fogColor.some((c, i) => !eq(c, D.fogColor[i]))) out.push(`fog-color=${f.colour(d.fogColor)}`);
  if (d.near !== D.near) out.push(`near=${d.near}`);
  const g = d.gradient;
  if (g) {
    const G = DEFAULT_GRADIENT;
    out.push(`gradient=${g.palette}`);
    if (g.on !== G.on) out.push(`gradient-on=${g.on}`);
    if (g.how !== G.how) out.push(`gradient-how=${g.how}`);
    if (!eq(g.amount, G.amount)) out.push(`gradient-amount=${f.num(g.amount)}`);
    if (!eq(g.cycles, G.cycles)) out.push(`cycles=${f.num(g.cycles)}`);
    if (!eq(g.phase, G.phase)) out.push(`phase=${f.num(g.phase)}`);
    if (!eq(g.flow, G.flow)) out.push(`flow=${f.num(g.flow)}`);
  }
  return out.join(' ');
}

export { DEPTH_SPACE_STYLES };
