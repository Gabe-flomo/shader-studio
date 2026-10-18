/**
 * effects.ts — the scene builders' Effects page (docs/builder-look.md, "Effects"): shader effects on
 * the finished picture, as stacked cards built after the scene in the order shown.
 *
 *   Displace (by noise, or by a picture) · Swirl · Ripple · Lens · Pixelate · Kaleidoscope ·
 *   Blur · Deep Glow · Light rays / Radial blur · Chromatic aberration (spectral) · CRT mask
 *   (Glow is retired for Deep Glow: not offered, but old scenes keep it and build it as before)
 *
 * How they build. Effects apply top to bottom, each to the picture the ones above made.
 *   Moves (Displace by noise, Swirl, Ripple, Lens, Pixelate, Kaleidoscope, CRT curvature) only change
 *   WHERE the picture is read: they bend the coordinates. Before the first read they bend the scene's
 *   own coordinates (the 2D builder draws its shapes in the bent space), so they cost no Pass.
 *   Colour (CRT mask) works on the colour at the pixel, no Pass.
 *   Reads (Blur, Deep Glow, Glow, Light rays, Chromatic aberration, Displace by a picture) read round
 *   a pixel: the picture so far goes into a Pass and the read's node reads it, at the point the
 *   moves after it bend. So a stack costs one Pass per read, and nothing for the rest.
 */
import { mk, ref, type Ctx, type Ref } from '../../sceneBuilder/build';
import { fmt } from '../../sceneBuilder/recipe';
import { numOf, stackOffered, stackUpgrade, stackValue, type LookParam, type StackItem, type StackKindDef } from './stack';

const num = (v: unknown, d: number) => (typeof v === 'number' && isFinite(v) ? v : d);

const sel = (...o: Array<[string, string]>) => o.map(([value, label]) => ({ value, label }));

export const FX_KINDS: StackKindDef[] = [
  {
    kind: 'displace', label: 'Displace', words: ['displace', 'warp-picture', 'distort'], nodes: ['domainWarp', 'displace', 'displaceTexture'],
    blurb: 'Pushes the picture around: by drifting noise, or by another picture (its red and green say where).',
    picture: { showWhen: { key: 'by', is: ['picture'] } },
    params: [
      { key: 'by', label: 'By', hint: 'Noise: a soft, drifting push everywhere. A picture: its red pushes sideways and its green up and down (mid-grey stays still); a Shader Texture moves it.', type: 'select', def: 'noise', options: sel(['noise', 'Noise'], ['picture', 'A picture']) },
      { key: 'strength', label: 'Strength', hint: 'How far the noise pushes, in picture units: 0.05 is a shimmer, 0.5 melts it.', type: 'num', def: 0.12, min: 0, max: 1, primary: true, showWhen: { key: 'by', is: ['noise'] }, node: ':bend', param: 'amount', aliases: ['amount'] },
      { key: 'scale', label: 'Scale', hint: 'How big the noise\'s swirls are: higher is smaller and busier.', type: 'num', def: 2, min: 0.1, max: 8, showWhen: { key: 'by', is: ['noise'] }, node: ':noise', param: 'scale' },
      { key: 'speed', label: 'Speed', hint: 'How fast the noise drifts. 0 holds it still.', type: 'num', def: 0.2, min: 0, max: 2, showWhen: { key: 'by', is: ['noise'] }, node: ':noise', param: 'time_scale' },
      { key: 'pixels', label: 'Amount', hint: 'How far the picture pushes, in screen pixels, for a full swing of its red or green.', type: 'num', def: 24, min: -200, max: 200, step: 0.5, showWhen: { key: 'by', is: ['picture'] }, node: '', param: 'amount', aliases: ['px'] },
    ],
  },
  {
    kind: 'swirl', label: 'Swirl', words: ['swirl', 'twirl', 'vortex'], nodes: ['uvWarp'],
    blurb: 'Twists the picture round its centre, most in the middle.',
    params: [
      { key: 'strength', label: 'Twist', hint: 'Radians of twist at the centre; negative turns the other way.', type: 'num', def: 2, min: -10, max: 10, primary: true, node: ':bend', param: 'strength', aliases: ['amount', 'twist'] },
      { key: 'falloff', label: 'Falloff', hint: 'How fast the twist fades outward: higher keeps it near the centre.', type: 'num', def: 1.5, min: 0.1, max: 5, node: ':bend', param: 'falloff' },
    ],
  },
  {
    kind: 'ripple', label: 'Ripple', words: ['ripple', 'wobble', 'water'], nodes: ['rippleSpace'],
    blurb: 'Waves running through the picture, like a reflection in water.',
    params: [
      { key: 'amp', label: 'Size', hint: 'How far the waves push, in picture units: 0.01 is a shimmer.', type: 'num', def: 0.015, min: 0, max: 0.2, step: 0.001, primary: true, node: ':bend', param: 'ampX', aliases: ['amount', 'amplitude'] },
      { key: 'freq', label: 'Waves', hint: 'How many waves across the picture.', type: 'num', def: 8, min: 0, max: 40, node: ':bend', param: 'freqX', aliases: ['frequency'] },
    ],
  },
  {
    kind: 'lens', label: 'Lens', words: ['lens', 'barrel', 'fisheye-picture'], nodes: ['lensDistortion'],
    blurb: 'Bends the picture like a wide lens (barrel) or a telephoto (pincushion).',
    params: [
      { key: 'bend', label: 'Bend', hint: 'Above 0 bulges the middle out (barrel); below 0 pinches it in.', type: 'num', def: 0.2, min: -1, max: 1, primary: true, node: ':bend', param: 'k1', aliases: ['k1', 'amount'] },
      { key: 'zoom', label: 'Zoom', hint: 'Scales the picture to crop the bent border away: 1.06 hides most of it.', type: 'num', def: 1, min: 0.5, max: 2, node: ':bend', param: 'zoom' },
    ],
  },
  {
    kind: 'pixelate', label: 'Pixelate', words: ['pixelate', 'pixels', 'mosaic'], nodes: ['pixelate'],
    blurb: 'Big square pixels: the picture read once per block.',
    params: [{ key: 'size', label: 'Block size', hint: 'Each block\'s size in picture units (the frame is 2 tall): 0.02 is fine, 0.1 chunky.', type: 'num', def: 0.025, min: 0.003, max: 0.25, step: 0.001, primary: true, node: ':bend', param: 'pixelSize', aliases: ['block'] }],
  },
  {
    kind: 'kaleido', label: 'Kaleidoscope', words: ['kaleido', 'kaleidoscope-picture', 'mirror-picture'], nodes: ['kaleidoSpace'],
    blurb: 'Folds the finished picture into mirrored wedges round the centre.',
    params: [
      { key: 'segments', label: 'Wedges', hint: 'How many mirrored wedges: 6 a snowflake, 8 a classic kaleidoscope.', type: 'num', def: 6, min: 1, max: 24, step: 1, integer: true, primary: true, node: ':bend', param: 'segments', aliases: ['n', 'wedges'] },
      { key: 'rotate', label: 'Turn', hint: 'Turns the wedges, in degrees.', type: 'num', def: 0, min: -180, max: 180, step: 1, deg: true, node: ':bend', param: 'rotate', aliases: ['rot'] },
    ],
  },
  {
    kind: 'blur', label: 'Blur', words: ['blur', 'soften', 'defocus'], nodes: ['blurTexture'],
    blurb: 'Softens the whole picture (a true Gaussian, in the same frame).',
    params: [{ key: 'radius', label: 'Radius', hint: 'How far the blur reaches, in screen pixels.', type: 'num', def: 4, min: 0, max: 64, step: 0.5, primary: true, node: '', param: 'radius', aliases: ['r', 'amount'] }],
  },
  {
    kind: 'glow', label: 'Glow', words: ['glow', 'bloom', 'halo'], nodes: ['glowTexture', 'addColor'],
    blurb: 'Bright parts bleed soft light round them, in the same frame (Glow (texture), Bloom chain).',
    // Retired for Deep Glow: not offered, but a scene that has it builds it as before (and can upgrade).
    retired: { by: 'deepglow', label: 'Deep Glow', params: it => ({ intensity: num(it.params.intensity, 0.8), threshold: num(it.params.threshold, 0.6), radius: Math.round(Math.min(800, Math.max(4, num(it.params.radius, 16) * 4))) }) },
    params: [
      { key: 'intensity', label: 'Intensity', hint: 'How bright the glow is.', type: 'num', def: 0.8, min: 0, max: 4, primary: true, node: '', param: 'intensity', aliases: ['amount'] },
      { key: 'threshold', label: 'Threshold', hint: 'How bright a part must be to glow: 0 everything, 0.8 only the brightest.', type: 'num', def: 0.6, min: 0, max: 2, node: '', param: 'threshold' },
      { key: 'radius', label: 'Radius', hint: 'How far the glow spreads, in screen pixels (its tail reaches further).', type: 'num', def: 16, min: 1, max: 64, step: 0.5, node: '', param: 'radius', aliases: ['r'] },
    ],
  },
  {
    kind: 'deepglow', label: 'Deep Glow', words: ['deepglow', 'deep-glow', 'glow-deep'], nodes: ['glowTexture'],
    blurb: 'A bloom like After Effects\' Deep Glow: bright parts get a hot core and a long, natural tail (Deep Glow (texture)).',
    params: [
      { key: 'intensity', label: 'Intensity', hint: 'How bright the glow is (its exposure).', type: 'num', def: 1, min: 0, max: 4, primary: true, node: '', param: 'intensity', aliases: ['amount', 'exposure'] },
      { key: 'radius', label: 'Radius', hint: 'How far the tail reaches, in screen pixels. The core stays hot; a big Radius adds a long, soft falloff. Costs the same at any size.', type: 'num', def: 120, min: 4, max: 800, step: 1, node: '', param: 'radius', aliases: ['r'] },
      { key: 'threshold', label: 'Threshold', hint: 'How bright a part must be to glow: 0 everything, 0.8 only the brightest.', type: 'num', def: 0.6, min: 0, max: 2, node: '', param: 'threshold', aliases: ['thr'] },
      { key: 'knee', label: 'Knee', hint: 'How softly the glow fades in round Threshold: 0 a hard cut.', type: 'num', def: 0.3, min: 0, max: 1, node: '', param: 'knee' },
      { key: 'spread', label: 'Chromatic spread', hint: 'Red reaches a little further and blue a little less: warm edges round a white core. 0 is off.', type: 'num', def: 0, min: 0, max: 1, node: '', param: 'spread', aliases: ['chroma'] },
      { key: 'preserve', label: 'Preserve colour', hint: '1 keeps the glow the colour of what glows; 0 lets its hot core bloom to white.', type: 'num', def: 0.5, min: 0, max: 1, node: '', param: 'preserve' },
      { key: 'composite', label: 'Composite', hint: 'Add: the glow\'s light added (it can pass white). Screen: softer, never past white.', type: 'select', def: 'add', options: sel(['add', 'Add'], ['screen', 'Screen']), node: '', param: 'composite', aliases: ['mode'] },
      { key: 'tint', label: 'Tint', hint: 'The glow\'s colour: white keeps the picture\'s own.', type: 'colour', def: [1, 1, 1], node: '', param: 'tint' },
    ],
  },
  {
    kind: 'rays', label: 'Light rays / Radial blur', words: ['rays', 'light-rays', 'radial-blur', 'zoom-blur', 'god-rays'], nodes: ['radialFastBlur'],
    blurb: 'Streaks from a centre, like CC Radial Fast Blur: light rays from the bright parts, or a zoom blur (Radial Fast Blur).',
    params: [
      { key: 'mode', label: 'Mode', hint: 'Brightest: light rays, the brightest colour along each streak where it is brighter. Average: a zoom blur. Add: the streaks added as glowing light.', type: 'select', def: 'brightest', options: sel(['brightest', 'Brightest (light rays)'], ['average', 'Average (zoom blur)'], ['add', 'Add (glow rays)']), node: '', param: 'mode' },
      { key: 'length', label: 'Length', hint: 'How long the streaks are: 0.2 a smear, 1 half way to the centre, 3 a light-speed burst. Long streaks cost the same.', type: 'num', def: 0.6, min: 0, max: 4, primary: true, node: '', param: 'length', aliases: ['amount', 'len'] },
      { key: 'threshold', label: 'Threshold', hint: 'Only parts brighter than this streak: 0 everything (a zoom blur), 0.5 rays from the bright parts.', type: 'num', def: 0.35, min: 0, max: 1.5, node: '', param: 'threshold', aliases: ['thr'] },
      { key: 'intensity', label: 'Intensity', hint: 'How strong the streaks are.', type: 'num', def: 1, min: 0, max: 4, node: '', param: 'intensity' },
      { key: 'opacity', label: 'Opacity', hint: 'Brightest and Add: how much of the rays shows over the picture. Below 1, what is behind them shows through.', type: 'num', def: 0.6, min: 0, max: 1, showWhen: { key: 'mode', is: ['brightest', 'add'] }, node: '', param: 'opacity', aliases: ['mix'] },
      { key: 'decay', label: 'Decay', hint: 'How much the streaks fade along their length. Brightest always tails off smoothly; higher keeps the rays shorter and softer.', type: 'num', def: 0.5, min: 0, max: 1, node: '', param: 'decay' },
      { key: 'falloff', label: 'Falloff', hint: 'How much the effect fades away from the centre: 0 the same everywhere.', type: 'num', def: 0, min: 0, max: 4, node: '', param: 'falloff' },
      { key: 'direction', label: 'Zoom', hint: 'Out: the streaks fly outward from the centre. In: they pull in toward it.', type: 'select', def: 'out', options: sel(['out', 'Out from the centre'], ['in', 'Into the centre']), node: '', param: 'direction', aliases: ['dir'] },
      { key: 'cx', label: 'Centre X', hint: 'Where the streaks come from, across (0 the middle, ±1.8 the sides).', type: 'num', def: 0, min: -2, max: 2, step: 0.01, node: '', param: 'centerX', aliases: ['x'] },
      { key: 'cy', label: 'Centre Y', hint: 'Where the streaks come from, up and down (0 the middle, 1 the top).', type: 'num', def: 0, min: -1, max: 1, step: 0.01, node: '', param: 'centerY', aliases: ['y'] },
      { key: 'tint', label: 'Tint', hint: 'The streaks\' colour: white keeps the picture\'s own.', type: 'colour', def: [1, 1, 1], node: '', param: 'tint' },
    ],
  },
  {
    kind: 'chroma', label: 'Chromatic aberration', words: ['chroma', 'chromatic', 'rgb-split', 'aberration'], nodes: ['chromaLens'],
    blurb: 'A lens\'s colour fringes: smooth rainbow edges growing toward the frame\'s edges (Spectral), or a clean red / blue split (Chromatic Aberration (lens)).',
    params: [
      { key: 'amount', label: 'Amount', hint: 'How far the colours move, in screen pixels: red one way, blue the other (at the frame\'s top and bottom edge for Radial).', type: 'num', def: 4, min: 0, max: 40, step: 0.25, primary: true, node: '', param: 'amount', aliases: ['px'] },
      { key: 'look', label: 'Look', hint: 'Spectral: many taps across the spectrum that add up to white, so edges fringe in a smooth rainbow. Channel split: red and blue copies, green still (a clean, graphic look).', type: 'select', def: 'spectral', options: sel(['spectral', 'Spectral'], ['split', 'Channel split']), node: '', param: 'mode' },
      { key: 'mode', label: 'Direction', hint: 'Radial: outward from the centre, growing to the edges (a lens). Axial: no shift, a coloured defocus halo round highlights. Directional: the same way everywhere (a prism, a video signal).', type: 'select', def: 'radial', options: sel(['radial', 'Radial (lens)'], ['axial', 'Axial (halo)'], ['directional', 'Directional (prism)']), node: '', param: 'geometry' },
      { key: 'angle', label: 'Angle', hint: 'Which way red goes, in degrees: 0 right, 90 up.', type: 'num', def: 0, min: -180, max: 180, step: 1, showWhen: { key: 'mode', is: ['directional'] }, node: '', param: 'angle', aliases: ['dir'] },
      { key: 'falloff', label: 'Falloff', hint: 'How the fringes grow from the centre: 0 the same everywhere, 2 only near the edges.', type: 'num', def: 1, min: 0, max: 3, showWhen: { key: 'mode', is: ['radial'] }, node: '', param: 'falloff' },
      { key: 'blur', label: 'Blur', hint: 'Each colour softened by how far it moved, so the fringe melts in. 0 is crisp.', type: 'num', def: 0.3, min: 0, max: 2, node: '', param: 'blur', aliases: ['soft'] },
      { key: 'samples', label: 'Samples', hint: 'Spectral: taps across the spectrum. More is a smoother rainbow and slower.', type: 'num', def: 12, min: 3, max: 16, step: 1, integer: true, showWhen: { key: 'look', is: ['spectral'] }, node: '', param: 'samples', aliases: ['taps'] },
      { key: 'distortion', label: 'Distortion', hint: 'Bends each colour differently toward the edges: above 0 red bulges out and violet in. 0 is off.', type: 'num', def: 0, min: -1, max: 1, node: '', param: 'distortion', aliases: ['bend'] },
      { key: 'cx', label: 'Centre X', hint: 'The lens\'s centre, across (0 the middle, ±1.8 the sides).', type: 'num', def: 0, min: -2, max: 2, step: 0.01, showWhen: { key: 'mode', is: ['radial', 'axial'] }, node: '', param: 'centerX', aliases: ['x'] },
      { key: 'cy', label: 'Centre Y', hint: 'The lens\'s centre, up and down (0 the middle, 1 the top).', type: 'num', def: 0, min: -1, max: 1, step: 0.01, showWhen: { key: 'mode', is: ['radial', 'axial'] }, node: '', param: 'centerY', aliases: ['y'] },
    ],
  },
  {
    kind: 'crt', label: 'CRT mask', words: ['crt', 'tube', 'crt-mask'], nodes: ['crtScreen', 'crtMask'],
    blurb: 'The picture on an old tube: red, green and blue phosphors, a curved screen and dark corners.',
    params: [
      { key: 'mask', label: 'Mask', hint: 'Slot: staggered RGB slots (most TVs). Aperture grille: unbroken vertical stripes (Trinitron). Shadow mask: round dots in triads (old monitors).', type: 'select', def: 'slot', options: sel(['slot', 'Slot mask'], ['aperture', 'Aperture grille'], ['shadow', 'Shadow mask (dots)']), node: '', param: 'maskType', aliases: ['type'] },
      { key: 'size', label: 'Cell size', hint: 'One RGB cell\'s width in screen pixels: 3 a fine monitor, 8 a TV up close.', type: 'num', def: 5, min: 2, max: 16, step: 0.5, node: '', param: 'cellSize', aliases: ['cell'] },
      { key: 'strength', label: 'Strength', hint: 'How much of the mask shows: 0 none, 1 all of it.', type: 'num', def: 0.8, min: 0, max: 1, primary: true, node: '', param: 'strength', aliases: ['amount'] },
      { key: 'scanlines', label: 'Scanlines', hint: 'Darkens every other row of cells.', type: 'num', def: 0.3, min: 0, max: 1, node: '', param: 'scanlines', aliases: ['scan'] },
      { key: 'curve', label: 'Curvature', hint: 'How much the glass bows: 0 flat, 0.05 a TV, 0.12 a fishbowl. The picture outside the tube goes black.', type: 'num', def: 0.04, min: 0, max: 0.2, step: 0.005, node: ':screen', param: 'curvature', aliases: ['curvature', 'bow'] },
      { key: 'vignette', label: 'Vignette', hint: 'How dark the tube\'s corners go: 0 none, 0.4 classic, 1 a spotlight.', type: 'num', def: 0.35, min: 0, max: 2, node: ':screen', param: 'vignettePower', aliases: ['corners'] },
    ],
  },
];

export const FX_BY_KIND: Record<string, StackKindDef> = Object.fromEntries(FX_KINDS.map(d => [d.kind, d]));
export const FX_WORDS: Record<string, string> = Object.fromEntries(FX_KINDS.flatMap(d => d.words.map(w => [w, d.kind])));
/** The effects the page offers (Glow is retired for Deep Glow: old scenes keep it). */
export const fxOffered = () => stackOffered(FX_KINDS);
/** An old Glow card swapped for a Deep Glow of about the same strength (same id, place, on/off); null for any other card. */
export const fxUpgrade = (it: StackItem): StackItem | null => stackUpgrade(it, FX_BY_KIND);

/** How many Pass nodes the effects may add (a graph has room for 8, the scene's pictures need some). */
export const MAX_FX_PASSES = 6;

export const fxRole = (it: StackItem) => `fx:${it.id}`;
const rad = (deg: number) => Math.round(deg * Math.PI / 180 * 1e6) / 1e6;

export interface FxOpts {
  /** The picture's centred coordinates (a UV node's output). */
  screen: Ref;
  getTime: () => Ref;
  /** A picture by name: its Texture output, or null (with a warning) when the scene has none. */
  texture: (name: string, what: string) => Ref | null;
}

/**
 * What an effect does to the picture. A move only changes where the picture is read (a pure bend
 * of the coordinates); colour works on the colour at this pixel; a read reads round the pixel, so it
 * needs the picture so far in a Pass. CRT with curvature is a move and colour (its screen, then its mask).
 */
export type FxClass = 'move' | 'colour' | 'move+colour' | 'read';

export function fxClass(it: StackItem): FxClass | null {
  const def = FX_BY_KIND[it.kind];
  if (!def) return null;
  const v = (key: string) => def.params.find(p => p.key === key)!;
  switch (it.kind) {
    case 'swirl': case 'ripple': case 'lens': case 'pixelate': case 'kaleido': return 'move';
    case 'displace': return String(stackValue(it, v('by'))) === 'picture' ? 'read' : 'move';
    case 'crt': return numOf(it, v('curve')) > 0 ? 'move+colour' : 'colour';
    default: return 'read';
  }
}

/** Does the item need its picture as a texture (a Pass)? Only the reads do: moves bend the coordinates, colour works in place. */
export function fxNeedsPass(it: StackItem): boolean {
  return it.on && fxClass(it) === 'read';
}

/** The effects stack, planned: where the scene is drawn, and the rest after its colour. */
export interface FxPlan {
  /**
   * Where the scene should be drawn: the screen's point bent by the moves before the first read
   * (null: no such moves, or the scene can't be bent and they read a Pass instead). Every part of
   * the scene that reads the screen's point must read this instead.
   */
  sceneUv: Ref | null;
  /** The effects after the scene's colour (and whatever per-pixel colour work comes between). */
  finish: (color: Ref) => Ref;
}

interface Step { it: StackItem; i: number; cls: FxClass; map: Ref | null }

/**
 * The effects stack (docs/builder-look.md, "Effects"). Effects apply top to bottom, each to the
 * picture the ones above made, so at the screen's point p the result of [A, B] is A's picture read
 * where B bends p: picture(bendA(bendB(p))). The later move bends the screen's point first.
 *
 * Only the reads (blur, glow, rays, chroma, displace by a picture) need the picture so far in a
 * Pass. The moves after a read bend the point that read works at; the moves before the first read
 * bend the scene's own coordinates (`sceneUv`): the shapes are drawn in the bent space, which is the
 * same picture as reading a Pass of it at the bent point, with no Pass. With `bendScene` false (the
 * scene can't be bent), those first moves read a Pass of the scene instead.
 *
 * CRT works in two places: its screen bends the point (a move) and its mask works on the colour at
 * the point that reaches it, with the vignette of its screen.
 */
export function planEffects(c: Ctx, items: readonly StackItem[] | undefined, opts: FxOpts, bendScene: boolean): FxPlan {
  const all = (items ?? []).filter(it => it.on && FX_BY_KIND[it.kind]);
  const steps: Step[] = [];
  all.forEach((it, i) => {
    const cls = fxClass(it)!;
    let map: Ref | null = null;
    if (it.kind === 'displace' && cls === 'read') {
      map = it.tex ? opts.texture(it.tex, 'Displace') : null;
      if (!map) { if (!it.tex) c.warnings.push('Displace by a picture has no picture: pick one on its card.'); return; }
    }
    steps.push({ it, i, cls, map });
  });

  // Runs between the reads: the first run works on the scene, each later one on its read.
  const first: Step[] = [];
  const reads: Array<{ read: Step; after: Step[] }> = [];
  const isMove = (s: Step) => s.cls === 'move' || s.cls === 'move+colour';
  let k = 0;
  for (; k < steps.length && steps[k].cls !== 'read'; k++) first.push(steps[k]);
  const fallback = !bendScene && first.some(isMove);
  let budget = MAX_FX_PASSES - (fallback ? 1 : 0);
  for (; k < steps.length; k++) {
    const s = steps[k];
    if (s.cls === 'read') {
      if (budget <= 0) {
        c.warnings.push(`${FX_BY_KIND[s.it.kind].label.toLowerCase()} needs a Pass and the effects already use ${MAX_FX_PASSES}: it is left out. Fewer effects that blur or read round the picture.`);
        continue;
      }
      budget--;
      reads.push({ read: s, after: [] });
    } else (reads.length ? reads[reads.length - 1].after : first).push(s);
  }

  const label = (s: Step) => FX_BY_KIND[s.it.kind].label;
  const stepName = (s: Step) => `Effect ${s.i + 1} of ${all.length}, ${label(s)}`;
  const P = (s: Step, key: string) => FX_BY_KIND[s.it.kind].params.find(p => p.key === key) as LookParam;
  const n = (s: Step, key: string) => numOf(s.it, P(s, key));
  const str = (s: Step, key: string) => String(stackValue(s.it, P(s, key)));

  /** What each step of a run sees: the point that reaches it (null: the screen's) and its CRT vignette. */
  type Seen = Map<Step, { at: Ref | null; vignette: Ref | null }>;
  /**
   * A run's moves, the last first: each bends the point that reaches it, so the point the run's
   * input is read at is bendFirst(…(bendLast(screen))). Returns that point (null: nothing moved).
   */
  const bendRun = (run: Step[], what: string): { at: Ref | null; seen: Seen } => {
    let q: Ref | null = null;
    const seen: Seen = new Map();
    for (let j = run.length - 1; j >= 0; j--) {
      const s = run[j];
      const here = q;
      const input = here ?? opts.screen;
      const role = fxRole(s.it);
      const bend = (type: string, params: Record<string, unknown>, wires: Record<string, Ref | null>, inKey: string, outKey: string, note: string) => {
        const node = mk(c, type, `${role}:bend`, params, { ...wires, [inKey]: input },
          `${stepName(s)}: ${note} It bends the point ${what} is read at${here ? ' (after the moves below it on the Effects page, which bend the screen\'s point first)' : ''}.`);
        q = ref(node, outKey);
      };
      let vignette: Ref | null = null;
      switch (s.it.kind) {
        case 'displace': {
          const noise = mk(c, 'domainWarp', `${role}:noise`, { strength: 1, scale: n(s, 'scale'), time_scale: n(s, 'speed') }, { uv: input, time: n(s, 'speed') ? opts.getTime() : null },
            `Noise for ${stepName(s)}: its Offset is a soft, swirling push (scale ${fmt(n(s, 'scale'))}${n(s, 'speed') ? `, drifting at ${fmt(n(s, 'speed'))}` : ''}).`);
          bend('displace', { amount: n(s, 'strength') }, { offset: ref(noise, 'offset') }, 'input', 'output', `each point pushed by the noise's Offset × ${fmt(n(s, 'strength'))}.`);
          break;
        }
        case 'swirl': bend('uvWarp', { kind: 'swirl', strength: n(s, 'strength'), falloff: n(s, 'falloff'), cx: 0, cy: 0, speed: 0 }, {}, 'input', 'output', `a twist of ${fmt(n(s, 'strength'))} radians at the centre, fading out at ${fmt(n(s, 'falloff'))}.`); break;
        case 'ripple': bend('rippleSpace', { freqX: n(s, 'freq'), freqY: n(s, 'freq'), ampX: n(s, 'amp'), ampY: n(s, 'amp') }, { time: opts.getTime() }, 'input', 'output', `${fmt(n(s, 'freq'))} waves of ${fmt(n(s, 'amp'))}, moving with time.`); break;
        case 'lens': bend('lensDistortion', { k1: n(s, 'bend'), zoom: n(s, 'zoom') }, {}, 'input', 'output', `a lens bend of ${fmt(n(s, 'bend'))}${n(s, 'zoom') !== 1 ? `, zoomed ${fmt(n(s, 'zoom'))}` : ''}.`); break;
        case 'pixelate': bend('pixelate', { pixelSize: n(s, 'size') }, {}, 'uv', 'uv', `blocks ${fmt(n(s, 'size'))} across.`); break;
        case 'kaleido': bend('kaleidoSpace', { segments: Math.round(n(s, 'segments')), rotate: rad(n(s, 'rotate')) }, {}, 'input', 'output', `${Math.round(n(s, 'segments'))} mirrored wedges${n(s, 'rotate') ? `, turned ${fmt(n(s, 'rotate'))}°` : ''}.`); break;
        case 'crt': {
          const curve = n(s, 'curve'), vig = n(s, 'vignette');
          if (curve > 0) {
            const scr = mk(c, 'crtScreen', `${role}:screen`, { curvature: curve, snap: 'off', vignettePower: Math.max(vig, 0.02) }, { uv: input },
              `${stepName(s)}: bows the screen like a tube's glass (curvature ${fmt(curve)}); outside the tube is black. It bends the point ${what} is read at. Vignette darkens toward the bent edges.`);
            q = ref(scr, 'uv');
            vignette = ref(scr, 'vignette');
          } else if (vig > 0) {
            const scr = mk(c, 'crtScreen', `${role}:screen`, { curvature: 0, snap: 'off', vignettePower: vig }, { uv: input }, `${stepName(s)}: the tube's vignette, darker toward the edges (the screen is flat: Curvature 0).`);
            vignette = ref(scr, 'vignette');
          }
          break;
        }
      }
      seen.set(s, { at: here, vignette });
    }
    return { at: q, seen };
  };

  /** A run's colour work, in order (CRT mask), at the point that reaches each. */
  const colourRun = (run: Step[], color: Ref, seen: Seen): Ref => {
    let cur = color;
    for (const s of run) {
      if (s.it.kind !== 'crt') continue;
      const v = seen.get(s)!;
      const node = mk(c, 'crtMask', fxRole(s.it), { maskType: str(s, 'mask'), cellSize: n(s, 'size'), strength: n(s, 'strength'), scanlines: n(s, 'scanlines') }, { color: cur, uv: v.at ?? opts.screen, vignette: v.vignette },
        `${stepName(s)}: the ${P(s, 'mask').options!.find(o => o.value === str(s, 'mask'))?.label.toLowerCase()} of a tube, ${fmt(n(s, 'size'))}-pixel cells at ${fmt(n(s, 'strength'))}${n(s, 'scanlines') ? `, scanlines ${fmt(n(s, 'scanlines'))}` : ''}.`);
      cur = ref(node, 'result');
    }
    return cur;
  };

  const passOf = (role: string, color: Ref, what: string): Ref => ref(mk(c, 'pass', `${role}:pass`, { scale: '1', format: 'half' }, { color },
    `Pass: draws the picture so far into a texture of its own, so ${what} can read it round each pixel, not only at this one.`), 'texture');

  /** A read's node: it reads `tex` (the Pass of `before`) at `at` (null: the screen's point). */
  const emitRead = (s: Step, tex: Ref, at: Ref | null, before: Ref): Ref => {
    const role = fxRole(s.it);
    const step = stepName(s);
    const moved = at ? ' It reads at the point the moves below it on the Effects page bend.' : '';
    switch (s.it.kind) {
      case 'displace': {
        const node = mk(c, 'displaceTexture', role, { amount: n(s, 'pixels') }, { texture: tex, map: s.map, uv: at },
          `${step}: the picture read where the picture “${s.it.tex}” pushes it: its red sideways, its green up and down (mid-grey stays), up to ${fmt(n(s, 'pixels'))} pixels.${moved}`);
        return ref(node, 'color');
      }
      case 'rays': {
        const mode = str(s, 'mode');
        const node = mk(c, 'radialFastBlur', role, {
          mode, direction: str(s, 'direction'), length: n(s, 'length'), centerX: n(s, 'cx'), centerY: n(s, 'cy'), threshold: n(s, 'threshold'), knee: 0.15,
          intensity: n(s, 'intensity'), opacity: n(s, 'opacity'), decay: n(s, 'decay'), falloff: n(s, 'falloff'), tint: stackValue(s.it, P(s, 'tint')),
        }, { texture: tex, uv: at },
          `${step}: streaks ${str(s, 'direction') === 'in' ? 'into' : 'out from'} the centre, Length ${fmt(n(s, 'length'))}${mode === 'average' ? ' (a zoom blur)' : mode === 'add' ? ', added as light' : ', the brightest along each (light rays)'}${n(s, 'threshold') > 0 ? `, from the parts brighter than ${fmt(n(s, 'threshold'))}` : ''}. Four small hidden passes, so long streaks stay cheap.${moved}`);
        return ref(node, 'color');
      }
      case 'deepglow': {
        const node = mk(c, 'glowTexture', role, {
          method: 'deep', intensity: n(s, 'intensity'), radius: n(s, 'radius'), threshold: n(s, 'threshold'), knee: n(s, 'knee'), spread: n(s, 'spread'), preserve: n(s, 'preserve'),
          composite: str(s, 'composite'), tint: stackValue(s.it, P(s, 'tint')),
        }, { texture: tex, uv: at },
          `${step}: the parts brighter than ${fmt(n(s, 'threshold'))} glow with a hot core and a tail reaching ${fmt(n(s, 'radius'))} pixels, at ${fmt(n(s, 'intensity'))}${str(s, 'composite') === 'screen' ? ', screened' : ', added'} over the picture. A small mip chain of hidden passes, so a wide glow stays cheap.${moved}`);
        return ref(node, 'color');
      }
      case 'blur':
        return ref(mk(c, 'blurTexture', role, { method: 'smooth', radius: n(s, 'radius') }, { texture: tex, uv: at }, `${step}: a Gaussian blur of ${fmt(n(s, 'radius'))} pixels over the whole picture.${moved}`), 'color');
      case 'chroma': {
        // The builder's Direction (radial / axial / directional, as recipes have always said it) is the node's Geometry.
        const geometry = str(s, 'mode') === 'directional' ? 'directional' : str(s, 'mode') === 'axial' ? 'axial' : 'lateral';
        const node = mk(c, 'chromaLens', role, {
          mode: str(s, 'look'), geometry, amount: n(s, 'amount'), samples: Math.round(n(s, 'samples')), blur: n(s, 'blur'), falloff: n(s, 'falloff'),
          centerX: n(s, 'cx'), centerY: n(s, 'cy'), angle: n(s, 'angle'), distortion: n(s, 'distortion'),
        }, { texture: tex, uv: at },
          `${step}: ${str(s, 'look') === 'split' ? 'red and blue copies' : `${Math.round(n(s, 'samples'))} taps across the spectrum`} ${geometry === 'axial' ? `defocused up to ${fmt(n(s, 'amount'))} pixels round the highlights` : `moved ${fmt(n(s, 'amount'))} pixels${geometry === 'lateral' ? ', outward from the centre' : `, at ${fmt(n(s, 'angle'))}°`}`}${n(s, 'blur') > 0 ? `, each softened by ${fmt(n(s, 'blur'))} × how far it moved` : ''}.${moved}`);
        return ref(node, 'color');
      }
      default: { // glow (retired): Bloom chain, added over the picture
        const here = at ? ref(mk(c, 'sampleTexture', `${role}:here`, {}, { texture: tex, uv: at }, 'The picture at the bent point: what the glow is added to.'), 'color') : before;
        const node = mk(c, 'glowTexture', role, { method: 'bloom', threshold: n(s, 'threshold'), knee: 0.2, radius: n(s, 'radius'), intensity: n(s, 'intensity'), tail: 0.4 }, { texture: tex, uv: at },
          `${step}: the parts brighter than ${fmt(n(s, 'threshold'))} spread ${fmt(n(s, 'radius'))} pixels (a Bloom chain), at ${fmt(n(s, 'intensity'))}. Same frame: nothing lags or smears.${moved}`);
        return ref(mk(c, 'addColor', `${role}:add`, {}, { a: here, b: ref(node, 'glow') }, 'Adds the glow over the picture: light adds up, so it can pass 1.'), 'result');
      }
    }
  };

  // The moves before the first read bend the scene itself (made now, before the scene is drawn).
  const pre = bendScene && first.some(isMove) ? bendRun(first, 'the whole scene') : null;
  return {
    sceneUv: pre?.at ?? null,
    finish(color: Ref): Ref {
      let cur = color;
      if (pre) cur = colourRun(first, cur, pre.seen);
      else {
        const b = bendRun(first, 'the picture');
        if (b.at) {
          const role = fxRole(first.find(isMove)!.it);
          const tex = passOf(role, cur, `the moves (${first.filter(isMove).map(s => label(s).toLowerCase()).join(', ')})`);
          cur = ref(mk(c, 'sampleTexture', `${role}:read`, {}, { texture: tex, uv: b.at }, 'Reads the picture (the Pass before) at the bent point: every move above (swirl, ripple, pixelate…) is where this reads.'), 'color');
        }
        cur = colourRun(first, cur, b.seen);
      }
      for (const { read, after } of reads) {
        const tex = passOf(fxRole(read.it), cur, `${label(read).toLowerCase()}`);
        const b = bendRun(after, `${label(read).toLowerCase()}'s picture`);
        cur = emitRead(read, tex, b.at, cur);
        cur = colourRun(after, cur, b.seen);
      }
      return cur;
    },
  };
}

/** The effects stack after `color`, for a scene that can't be bent (the first moves read a Pass of it). */
export function emitEffects(c: Ctx, items: readonly StackItem[] | undefined, color: Ref, opts: FxOpts): Ref {
  return planEffects(c, items, opts, false).finish(color);
}


/** The node and param an effect setting sets, by role (for the Play menu). */
export function fxParamTarget(it: StackItem, key: string): { role: string; param: string } | null {
  const p = FX_BY_KIND[it.kind]?.params.find(q => q.key === key);
  if (!p || p.param === undefined) return null;
  // The moves' bend nodes, the read, the CRT screen: their suffixes; the rest the item's main node.
  return { role: fxRole(it) + (p.node ?? ''), param: p.param };
}
