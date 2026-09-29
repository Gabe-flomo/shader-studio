/**
 * finish.js — the Finish stack: colour grading, lens and screen effects,
 * film effects, camera shake and time displacement over the FINAL picture
 * (the shader with its layers on top), for the app (play/overlay.ts) and web
 * exports (play/runtime/play-runtime.js, through exportHtml.ts, which inlines
 * the kit files into one closure: every top-level name here starts `fn`/`FN_`).
 *
 * One pass does the work: a fragment shader built from the stack (only the
 * effects that are on, in the stack's order) reads the picture and the layers
 * as two textures and writes the finished frame. Three things need more, and
 * only run when an effect asks for them:
 *   glow   bloom, halation and CRT glow read small blurred copies of the frame
 *          (a quarter-size prefilter, then a quarter, an eighth and a
 *          sixteenth, each blurred across and down: seven tiny passes)
 *   time   time displacement keeps the last N frames, reduced, in a texture
 *          array; each drawn frame is written into it after the final pass
 *   curves the grade's curves are baked into a 256 × 2 lookup texture when
 *          they change, so a curve costs one texture read per pixel
 *
 * Order: geometry (camera shake, lens distortion, CRT curvature) bends where
 * the picture is read, chromatic aberration and time displacement choose what
 * is read there, and every colour effect then runs in the stack's order.
 *
 * Needs WebGL2. Without it `fnCreate` returns { ok: false } and the host shows
 * the picture unfinished.
 *
 * The CPU functions (curves, the LUT, fnGradePixel, the ring) are the same
 * maths as the shader, for the tests and for anything that grades a colour
 * outside the GPU.
 */
import { FN_TONE_GLSL, FN_TONE_FUNCTIONS, FN_CRT_MASK_GLSL } from './finishGlsl.js';

// ── The catalogue ────────────────────────────────────────────────────────────

/**
 * Every effect: its label, where the Add menu lists it, a one-line summary,
 * and its numbers in uniform order (key, label, min, max, step, default, hint).
 * `hidden` numbers have no slider of their own (a wheel's position, a
 * colour's channels) but are still mappable.
 */
const FN_P = (key, label, min, max, step, value, hint, hidden) => ({ key, label, min, max, step, value, hint: hint || '', hidden: !!hidden });

/**
 * Halation's shape and colour, measured from the reference (the Joo.Works
 * "ACES lite Halation" PowerGrade: before/after frames, docs/finish-stack.md
 * "Halation"). Distances are pixels of a 1080-line picture (scaled with the
 * picture's height).
 *
 *   sigma      the tight bleed's falloff. It is a max-spread, not a blur: at a
 *              distance d from a bright part the bleed is that part's excess ×
 *              e^(−d²/2σ²), so a two-pixel glint bleeds as far and as strongly
 *              as the edge of a big bright shape (as the reference does)
 *   gain       the tight bleed's strength at Amount 1
 *   tail       the Reach tail's strength from Reach 0.5 up: a true blur of the
 *              excess, the wide haze. Reach 0 → 0.5 fades it in at σ ≈ 16 px
 *              (the glow chain's eighth level); 0.5 → 1 widens it to σ ≈ 32
 *              (the sixteenth), at the same strength
 *   knee       the threshold's soft knee, as a fraction of the threshold
 *   recv       the bleed lands only on what is darker than this (linear red):
 *              all of it below recv[0], none above recv[1]. So the bright part
 *              itself never turns red; its dark surroundings do
 *   greenKnee  green joins where the bleed is strong: dG = warmth · dR² / (dR + greenKnee)
 *   blue       blue in the bleed, per unit of red (a little is taken away)
 *   srcMax     the red source saturates here (srcMax · tanh(excess / srcMax)):
 *              the reference's brightest glint (red 227, excess ≈ 0.3) is
 *              about the most anything bleeds, so a clipped white or a lamp
 *              under 6 stops of headroom bleeds like that glint, not 200 times
 *              more. Headroom now only decides how fast near-white saturates
 *   whiteMax   the same for Growth's white source
 * and the controls' defaults (Amount 1 is the reference's strength).
 */
/** A number as a GLSL float literal. */
const fnGl = v => { const t = String(Math.round(v * 1e6) / 1e6); return /[.e]/.test(t) ? t : t + '.0'; };

export const FN_HAL = {
  sigma: 4.5, gain: 1.04, tail: 0.52, knee: 0.3, recv: [0.17, 0.53], greenKnee: 0.076, blue: -0.07,
  srcMax: 0.3, whiteMax: 1,
  amount: 1, reach: 0.25, threshold: -1.15, headroom: 6, warmth: 0.26, growth: 0.2, conserve: 0.03,
  /** The halation model saved with each effect; older records are migrated by fnMigrateHalation. */
  model: 2,
};

export const FN_EFFECTS = {
  grade: {
    label: 'Grade', group: 'Colour', icon: 'sliders',
    summary: 'Exposure, white balance, curves, colour wheels, split toning, looks',
    params: [
      FN_P('exposure', 'Exposure', -4, 4, 0.01, 0, 'Brightness in stops, in linear light: +1 doubles the light.'),
      FN_P('contrast', 'Contrast', -1, 1, 0.01, 0, 'Pushes tones away from (or toward) the middle, without clipping.'),
      FN_P('highlights', 'Highlights', -1, 1, 0.01, 0, 'The bright tones only. Lower it to bring back detail in bright areas.'),
      FN_P('shadows', 'Shadows', -1, 1, 0.01, 0, 'The dark tones only. Raise it to open up the shadows.'),
      FN_P('whites', 'Whites', -1, 1, 0.01, 0, 'Where white sits: raise it for brighter whites (and more clipping).'),
      FN_P('blacks', 'Blacks', -1, 1, 0.01, 0, 'Where black sits: raise it for faded, milky blacks; lower it to crush them.'),
      FN_P('temperature', 'Temperature', -1, 1, 0.01, 0, 'White balance: warmer (orange) to the right, cooler (blue) to the left.'),
      FN_P('tint', 'Tint', -1, 1, 0.01, 0, 'White balance: magenta to the right, green to the left.'),
      FN_P('vibrance', 'Vibrance', -1, 1, 0.01, 0, 'Saturation for the muted colours, leaving the already vivid ones (and skin) alone.'),
      FN_P('saturation', 'Saturation', -1, 1, 0.01, 0, 'Every colour equally: -1 is black and white.'),
      FN_P('liftX', 'Shadows hue X', -1, 1, 0.01, 0, '', true), FN_P('liftY', 'Shadows hue Y', -1, 1, 0.01, 0, '', true),
      FN_P('liftL', 'Shadows level', -1, 1, 0.01, 0, 'Lift: raises or lowers the darkest tones.'),
      FN_P('gammaX', 'Midtones hue X', -1, 1, 0.01, 0, '', true), FN_P('gammaY', 'Midtones hue Y', -1, 1, 0.01, 0, '', true),
      FN_P('gammaL', 'Midtones level', -1, 1, 0.01, 0, 'Gamma: brightens or darkens the middle tones.'),
      FN_P('gainX', 'Highlights hue X', -1, 1, 0.01, 0, '', true), FN_P('gainY', 'Highlights hue Y', -1, 1, 0.01, 0, '', true),
      FN_P('gainL', 'Highlights level', -1, 1, 0.01, 0, 'Gain: scales the brightest tones.'),
      FN_P('splitHiHue', 'Highlights hue', 0, 360, 1, 40, 'The colour the highlights lean toward.'),
      FN_P('splitHiSat', 'Highlights amount', 0, 1, 0.01, 0, 'How strongly the highlights are tinted.'),
      FN_P('splitShHue', 'Shadows hue', 0, 360, 1, 200, 'The colour the shadows lean toward.'),
      FN_P('splitShSat', 'Shadows amount', 0, 1, 0.01, 0, 'How strongly the shadows are tinted.'),
      FN_P('splitBalance', 'Balance', -1, 1, 0.01, 0, 'Moves the split between the two tints: right gives the highlight tint more of the picture.'),
      FN_P('hslHue', 'Pick hue', 0, 360, 1, 30, 'The centre of the colour range the HSL secondary changes.'),
      FN_P('hslRange', 'Range', 0, 180, 1, 0, 'How wide the range is, in degrees either side. 0 turns the secondary off.'),
      FN_P('hslSoft', 'Softness', 0, 1, 0.01, 0.5, 'How gently the range fades out at its edges.'),
      FN_P('hslShift', 'Hue shift', -180, 180, 1, 0, 'Turns the picked colours around the colour wheel.'),
      FN_P('hslSat', 'Saturation', -1, 1, 0.01, 0, 'Saturation of the picked colours only.'),
      FN_P('hslLum', 'Luminance', -1, 1, 0.01, 0, 'Brightness of the picked colours only.'),
      FN_P('amount', 'Amount', 0, 1, 0.01, 1, 'How much of the whole grade shows: 0 is the picture as it was.'),
    ],
  },
  lens: {
    label: 'Lens distortion', group: 'Lens & screen', icon: 'target',
    summary: 'Barrel or pincushion, zoomed to keep the edges filled',
    params: [
      FN_P('distortion', 'Distortion', -1, 1, 0.01, 0.25, 'Right bulges the picture outward (barrel), left pinches it in (pincushion).'),
      FN_P('cubic', 'Edges', -1, 1, 0.01, 0, 'Extra bend at the edges only.'),
      FN_P('fit', 'Fill frame', 0, 1, 0.01, 1, 'Zooms in so a barrel never shows past the picture’s edge.'),
    ],
  },
  chroma: {
    label: 'Chromatic aberration', group: 'Lens & screen', icon: 'spark',
    summary: 'Red and blue split apart toward the edges',
    params: [
      FN_P('amount', 'Amount', 0, 1, 0.01, 0.35, 'How far red and blue separate at the corners.'),
      FN_P('falloff', 'Falloff', 0.5, 4, 0.05, 1.6, 'Higher keeps the middle clean and pushes the fringes to the edges.'),
    ],
  },
  vignette: {
    label: 'Vignette', group: 'Lens & screen', icon: 'eye',
    summary: 'Darker (or coloured) corners',
    params: [
      FN_P('amount', 'Amount', 0, 1, 0.01, 0.45, 'How dark the corners get.'),
      FN_P('size', 'Size', 0, 1, 0.01, 0.5, 'Where the darkening starts: larger keeps more of the picture clear.'),
      FN_P('roundness', 'Roundness', 0, 1, 0.01, 1, '1 is a circle, 0 follows the frame’s shape.'),
      FN_P('feather', 'Feather', 0, 1, 0.01, 0.55, 'How soft the edge of the vignette is.'),
      FN_P('colorR', 'Colour R', 0, 1, 0.01, 0, '', true), FN_P('colorG', 'Colour G', 0, 1, 0.01, 0, '', true), FN_P('colorB', 'Colour B', 0, 1, 0.01, 0, '', true),
    ],
  },
  crt: {
    label: 'CRT', group: 'Lens & screen', icon: 'layoutCanvas',
    summary: 'Curved glass, scanlines, an RGB shadow mask and glow',
    params: [
      FN_P('curvature', 'Curvature', 0, 1, 0.01, 0.3, 'How much the screen bulges; the corners round off.'),
      FN_P('scanlines', 'Scanlines', 0, 1, 0.01, 0.5, 'Darkens every other row of cells.'),
      FN_P('mask', 'Mask', 0, 1, 0.01, 0.6, 'How visible the red, green and blue sub-cells are.'),
      FN_P('cell', 'Cell size', 2, 16, 0.5, 4, 'Width of one RGB cell, in pixels of a 1080p picture.'),
      FN_P('stagger', 'Stagger', 0, 1, 1, 1, 'Offsets every other column by half a cell, like a real shadow mask.'),
      FN_P('glow', 'Glow', 0, 1, 0.01, 0.35, 'Light bleeding around bright parts, as phosphor does.'),
      FN_P('pulse', 'Pulse', 0, 0.2, 0.005, 0.02, 'A slow ripple of brightness across the screen. 0 is off.'),
    ],
  },
  bloom: {
    label: 'Bloom', group: 'Film', icon: 'sun',
    summary: 'A soft glow around bright parts',
    params: [
      FN_P('amount', 'Amount', 0, 2, 0.01, 0.6, 'How strong the glow is.'),
      FN_P('threshold', 'Threshold', 0, 1.5, 0.01, 0.7, 'How bright a part has to be to glow (1 = white).'),
      FN_P('radius', 'Radius', 0, 1, 0.01, 0.5, 'Small and tight, or wide and hazy.'),
      FN_P('tintR', 'Tint R', 0, 1, 0.01, 1, '', true), FN_P('tintG', 'Tint G', 0, 1, 0.01, 1, '', true), FN_P('tintB', 'Tint B', 0, 1, 0.01, 1, '', true),
    ],
  },
  halation: {
    label: 'Halation', group: 'Film', icon: 'sun',
    summary: 'Film’s thin red bleed around bright edges',
    params: [
      FN_P('amount', 'Amount', 0, 2, 0.01, FN_HAL.amount, 'How strong the bleed is. 1 matches the reference grade.'),
      FN_P('reach', 'Reach', 0, 1, 0.01, FN_HAL.reach, 'A wide, soft tail on top of the tight bleed that hugs the edges. 0 keeps only the tight bleed.'),
      FN_P('threshold', 'Threshold', -4, 4, 0.05, FN_HAL.threshold, 'How bright the red in a part has to be to bleed, in stops from white in linear light: -1.15 (0.70 on screen) is where the reference starts, fading in from about 0.6. Above 0 only light brighter than white bleeds.'),
      FN_P('headroom', 'Highlight headroom', 1, 16, 0.5, FN_HAL.headroom, 'How much brighter than white the clipped parts of an ordinary picture are taken to be, in stops. More makes clipped highlights (lamps, the sun) bleed further than a white that is merely bright.'),
      FN_P('warmth', 'Warmth', 0, 1, 0.01, FN_HAL.warmth, 'Red (0) to orange (1): how much green joins the bleed where it is strongest, right at the edge.'),
      FN_P('growth', 'Growth', 0, 1, 0.01, FN_HAL.growth, 'A tight white spread around light brighter than white: very bright sources look bigger than they are.'),
      FN_P('conserve', 'Conserve', 0, 1, 0.01, FN_HAL.conserve, 'How much the bright part itself darkens as its light bleeds out: 0 only adds the bleed, 1 takes the part down to the threshold.'),
    ],
  },
  grain: {
    label: 'Film grain', group: 'Film', icon: 'dice',
    summary: 'Grain that follows brightness, mono or colour',
    params: [
      FN_P('amount', 'Amount', 0, 1, 0.01, 0.3, 'How strong the grain is.'),
      FN_P('size', 'Size', 0.5, 4, 0.05, 1.4, 'Grain size, in pixels of a 1080p picture.'),
      FN_P('colour', 'Colour', 0, 1, 0.01, 0.15, '0 is mono grain, 1 is separate grain in red, green and blue.'),
      FN_P('response', 'Response', 0, 1, 0.01, 0.7, 'How much the grain follows brightness: film shows it most in the mid-tones and least in deep black.'),
      FN_P('fps', 'Frames a second', 0, 60, 1, 24, 'How often the grain changes. 0 holds it still.'),
    ],
  },
  flicker: {
    label: 'Flicker', group: 'Film', icon: 'bolt',
    summary: 'Brightness that wavers like an old projector',
    params: [
      FN_P('amount', 'Amount', 0, 1, 0.01, 0.2, 'How much the brightness wavers.'),
      FN_P('speed', 'Speed', 1, 30, 0.5, 10, 'How fast, in changes a second.'),
    ],
  },
  shake: {
    label: 'Camera shake', group: 'Motion', icon: 'hand',
    summary: 'A handheld camera and film gate weave, zoomed to hide the edges',
    params: [
      FN_P('amount', 'Amount', 0, 1, 0.01, 0.25, 'How far the camera wanders.'),
      FN_P('speed', 'Speed', 0, 4, 0.01, 1, 'How quickly it moves.'),
      FN_P('rotate', 'Rotation', 0, 1, 0.01, 0.3, 'How much it rolls as it moves.'),
      FN_P('weave', 'Gate weave', 0, 1, 0.01, 0.3, 'The small sideways drift and frame-to-frame jitter of film in a projector gate.'),
    ],
  },
  time: {
    label: 'Time displacement', group: 'Time', icon: 'clock',
    summary: 'Parts of the picture show earlier frames: slit-scan and friends',
    params: [
      FN_P('amount', 'Frames back', 0, 63, 0.5, 16, 'The most frames back any part of the picture shows.'),
      FN_P('angle', 'Direction', 0, 360, 1, 90, 'Slit-scan: which way time runs across the picture (90 = bottom to top).'),
      FN_P('scale', 'Scale', 0.5, 10, 0.1, 3, 'Noise map: the size of the blotches.'),
      FN_P('speed', 'Speed', 0, 2, 0.01, 0.3, 'Noise map: how fast the blotches move.'),
      FN_P('cx', 'Centre X', 0, 1, 0.01, 0.5, 'Radial map: its centre.'), FN_P('cy', 'Centre Y', 0, 1, 0.01, 0.5, 'Radial map: its centre.'),
      FN_P('smooth', 'Smooth', 0, 1, 0.01, 1, 'Blends between frames (1) or steps from one to the next (0).'),
      FN_P('invert', 'Invert', 0, 1, 1, 0, 'Swaps now and the past across the map.'),
    ],
  },
};

/**
 * Halation presets for the card (they only set the sliders). Classic cine is
 * the reference's own measurement; Subtle and Strong sit either side of it.
 */
export const FN_HALATION_PRESETS = [
  { name: 'Subtle', values: { amount: 0.6, reach: 0.3, threshold: -0.9, headroom: 5, warmth: 0.15, growth: 0.1, conserve: 0.03 } },
  { name: 'Classic cine', values: { amount: FN_HAL.amount, reach: FN_HAL.reach, threshold: FN_HAL.threshold, headroom: FN_HAL.headroom, warmth: FN_HAL.warmth, growth: FN_HAL.growth, conserve: FN_HAL.conserve } },
  { name: 'Strong', values: { amount: 1.6, reach: 0.8, threshold: -1.5, headroom: 8, warmth: 0.35, growth: 0.5, conserve: 0.15 } },
];

/** The kinds in the Add menu's order. Each kind appears at most once in a stack. */
export const FN_KINDS = ['grade', 'lens', 'chroma', 'vignette', 'crt', 'bloom', 'halation', 'grain', 'flicker', 'shake', 'time'];
export const FN_TONE_MODES = ['none', 'aces', 'agx', 'hable', 'reinhard2', 'unreal', 'lottes', 'uchimura', 'tanh', 'oklab'];
export const FN_TIME_MAPS = ['slit', 'luma', 'noise', 'radial', 'layer'];
export const FN_TIME_QUALITY = { low: { frames: 16, scale: 0.25, cap: 8e6 }, medium: { frames: 32, scale: 0.5, cap: 20e6 }, high: { frames: 64, scale: 0.5, cap: 48e6 } };
export const FN_CURVE_CHANNELS = ['rgb', 'r', 'g', 'b'];
export const FN_HUE_CURVES = ['hueSat', 'hueHue', 'lumaSat'];

/**
 * The before/after wipe (`finish.compare`): where the picture before the stack
 * meets the finished one. Mappable like an effect's numbers, under the id
 * 'compare' (`finish:compare::pos`).
 */
export const FN_COMPARE_ID = 'compare';
export const FN_COMPARE_PARAMS = [
  FN_P('pos', 'Position', 0, 1, 0.001, 0.5, 'Where the wipe is along its direction: 0 shows only the finished picture, 1 only the picture before the stack.'),
  FN_P('angle', 'Angle', -180, 180, 1, 0, 'The divider’s angle in degrees: 0 is upright with the picture before the stack on the left, 90 is level with it below.'),
  FN_P('softness', 'Softness', 0, 1, 0.01, 0, 'How wide the blend between the two is (0 is a hard edge).'),
];
/** A wipe at its defaults (off). */
export function fnDefaultCompare() {
  return { on: false, pos: 0.5, angle: 0, softness: 0 };
}
/** Is the wipe showing? */
export function fnCompareOn(finish) {
  return !!(finish && finish.compare && finish.compare.on);
}

/** A fresh set of curves: straight lines, and flat hue curves (none). */
export function fnDefaultCurves() {
  return { rgb: [0, 0, 1, 1], r: [0, 0, 1, 1], g: [0, 0, 1, 1], b: [0, 0, 1, 1], hueSat: [], hueHue: [], lumaSat: [] };
}

/** A new effect of `kind` at its defaults. */
export function fnDefaultEffect(kind, id) {
  const def = FN_EFFECTS[kind];
  const e = { id, kind, enabled: true };
  for (const p of def.params) e[p.key] = p.value;
  if (kind === 'grade') { e.tone = 'none'; e.curves = fnDefaultCurves(); }
  if (kind === 'time') { e.map = 'slit'; e.layerId = ''; e.quality = 'medium'; }
  if (kind === 'halation') e.model = FN_HAL.model;
  return e;
}

/**
 * A halation effect saved before the reference model (no `model`): the keys
 * keep their meanings (Threshold is still stops from white on the headroom
 * estimate, so a saved stack halates the same parts it did), but Amount's
 * scale changed: the old default 0.7 is the new 1. Conserve starts at its
 * default. Returns a new object; one already on the model comes back as is.
 */
export function fnMigrateHalation(e) {
  if (!e || e.kind !== 'halation' || e.model === FN_HAL.model) return e;
  const out = Object.assign({}, e, { model: FN_HAL.model });
  const a = typeof e.amount === 'number' && isFinite(e.amount) ? e.amount : 0.7;
  out.amount = Math.round(Math.min(2, Math.max(0, a / 0.7)) * 100) / 100;
  if (typeof e.conserve !== 'number' || !isFinite(e.conserve)) out.conserve = FN_HAL.conserve;
  return out;
}

/** Can this effect run: a built-in kind, or a custom effect with code. */
function fnRunnable(e) {
  return !!e && !!e.enabled && (e.kind === 'custom' ? typeof e.code === 'string' && e.code.trim().length > 0 : !!FN_EFFECTS[e.kind]);
}
/** Is there anything to do: the stack on, with an effect on. */
export function fnActive(finish) {
  return !!finish && finish.on !== false && Array.isArray(finish.effects) && finish.effects.some(fnRunnable);
}
/** The effects that run, in order (first of each built-in kind only; custom effects as many as there are). */
export function fnRunning(finish) {
  if (!fnActive(finish)) return [];
  const seen = new Set(), out = [];
  for (const e of finish.effects) {
    if (!fnRunnable(e)) continue;
    if (e.kind === 'custom') { out.push(e); continue; }
    if (!seen.has(e.kind)) { seen.add(e.kind); out.push(e); }
  }
  return out;
}
/** Does the stack change with the clock (so a paused shader still needs frames drawn while the clock runs)? */
export function fnAnimated(finish) {
  return fnRunning(finish).some(e => (e.kind === 'grain' && e.fps > 0) || e.kind === 'shake' || e.kind === 'flicker' || e.kind === 'time' || (e.kind === 'crt' && e.pulse > 0) || (e.kind === 'custom' && /\btime\b/.test(e.code)));
}

// ── Custom effects (effect code) ─────────────────────────────────────────────

/**
 * A custom effect is a snippet of GLSL ES 3.00 run as one more colour step of
 * the Finish pass:
 *
 *   uniform float amount; // 0..1 = 0.5
 *   uniform vec3 tint;    // color = #ff8800
 *   vec3 effect(vec2 uv, vec3 color) { return mix(color, tint * picture(uv), amount); }
 *
 * `uv` is the point on the picture (0..1), `color` the colour so far (after
 * the stack's colour steps above it). Helpers: `picture(uv)` reads the
 * picture as it came in (the shader and the layers, before the stack), `px`
 * is one pixel in uv units, `time` the clock in seconds, `resolution` the
 * output size in pixels, `aspect` its width over height.
 *
 * Each `uniform float` (or `int`) becomes a slider and a control target; a
 * comment after it gives `min..max = default`, optionally `step s` and a label
 * (`// 2..16 = 6 step 1 Levels`). A `uniform vec3` is a colour
 * (`// color = #rrggbb`), kept as three numbers `<name>.r`, `.g`, `.b`.
 */
export const FN_CUSTOM_RESERVED = ['id', 'kind', 'enabled', 'name', 'code', 'defId', 'sealed', 'source', 'look', 'tone', 'curves', 'map', 'layerId', 'quality', 'uv', 'color', 'effect', 'picture', 'px', 'time', 'resolution', 'aspect', 'main'];
const FN_CUSTOM_MAX_NUMBERS = 32;
const FN_NUM = '[-+]?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][-+]?\\d+)?';

function fnPretty(name) {
  const w = name.replace(/_/g, ' ').replace(/([a-z0-9])([A-Z])/g, '$1 $2').trim().toLowerCase();
  return w ? w[0].toUpperCase() + w.slice(1) : name;
}
function fnHexRgb(hex) {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  const n = parseInt(full, 16);
  return isFinite(n) && full.length === 6 ? [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255] : [1, 1, 1];
}

const fnCustomCache = new Map();
/**
 * An effect's code read for its settings: `params` (the numbers, in uniform
 * order, as FN_P gives them, plus `colour: name` on a colour's three),
 * `colours` ({ name, label, keys }), `lines` (the code with each uniform line
 * blanked, so line numbers stay the user's), and `error` for what can be told
 * without compiling (no effect function, a reserved or repeated name).
 */
export function fnParseCustom(code) {
  const src = typeof code === 'string' ? code : '';
  const hit = fnCustomCache.get(src);
  if (hit) return hit;
  const params = [], colours = [], errors = [];
  const names = new Set();
  const uniRe = /^\s*uniform\s+(?:(?:highp|mediump|lowp)\s+)?(float|int|vec3)\s+([A-Za-z_]\w*)\s*;\s*(?:\/\/\s*(.*))?$/;
  const lines = src.split('\n').map((line, i) => {
    const m = uniRe.exec(line);
    if (!m) {
      if (/^\s*uniform\b/.test(line)) errors.push(`Line ${i + 1}: only “uniform float”, “uniform int” and “uniform vec3” settings are supported, one per line.`);
      return line;
    }
    const [, type, name, comment = ''] = m;
    if (FN_CUSTOM_RESERVED.includes(name) || /^(fn|FN_|U_|u[A-Z])/.test(name)) { errors.push(`Line ${i + 1}: “${name}” is a name the Finish pass uses; call the setting something else.`); return ''; }
    if (names.has(name)) { errors.push(`Line ${i + 1}: “${name}” is declared twice.`); return ''; }
    names.add(name);
    if (type === 'vec3') {
      const hex = /#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/.exec(comment);
      const rgb = hex ? fnHexRgb(hex[1]) : [1, 1, 1];
      const label = comment.replace(/colou?r\s*=?\s*/i, '').replace(/#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/, '').trim() || fnPretty(name);
      const keys = ['r', 'g', 'b'].map(c => `${name}.${c}`);
      keys.forEach((k, j) => params.push(Object.assign(FN_P(k, `${label} ${'RGB'[j]}`, 0, 1, 0.01, rgb[j], '', true), { colour: name, type: 'colour' })));
      colours.push({ name, label, keys });
      return '';
    }
    let min = 0, max = 1, value = NaN, step = NaN;
    let rest = comment.trim();
    const range = new RegExp(`^(${FN_NUM})\\s*\\.\\.\\s*(${FN_NUM})`).exec(rest);
    if (range) { min = +range[1]; max = +range[2]; rest = rest.slice(range[0].length).trim(); }
    const def = new RegExp(`^=\\s*(${FN_NUM})`).exec(rest);
    if (def) { value = +def[1]; rest = rest.slice(def[0].length).trim(); }
    const st = new RegExp(`^step\\s+(${FN_NUM})`, 'i').exec(rest);
    if (st) { step = Math.abs(+st[1]); rest = rest.slice(st[0].length).trim(); }
    const label = rest.replace(/^[-:·—]\s*/, '').trim();
    if (min > max) { const t = min; min = max; max = t; }
    if (min === max) max = min + 1;
    if (!isFinite(value)) value = type === 'int' ? Math.round((min + max) / 2) : (min + max) / 2;
    const whole = type === 'int' || (!!range && !/\./.test(range[0]) && Number.isInteger(value) && max - min >= 2);
    if (!isFinite(step) || step <= 0) step = whole ? 1 : Math.max(1e-4, +((max - min) / 100).toPrecision(2));
    value = Math.max(min, Math.min(max, value));
    params.push(Object.assign(FN_P(name, label || fnPretty(name), min, max, step, value, ''), { type }));
    return '';
  });
  if (params.length > FN_CUSTOM_MAX_NUMBERS) errors.push(`At most ${FN_CUSTOM_MAX_NUMBERS} numbers (a colour is three).`);
  if (!/\bvec3\s+effect\s*\(\s*(?:in\s+)?vec2\s+\w+\s*,\s*(?:in\s+)?vec3\s+\w+\s*\)/.test(src)) errors.push('The code needs a function “vec3 effect(vec2 uv, vec3 color)”.');
  const out = { params: params.slice(0, FN_CUSTOM_MAX_NUMBERS), colours, lines, error: errors.join('\n') };
  if (fnCustomCache.size > 64) fnCustomCache.delete(fnCustomCache.keys().next().value);
  fnCustomCache.set(src, out);
  return out;
}

/** A custom effect's numbers at their defaults, keyed as the effect keeps them. */
export function fnCustomDefaults(code) {
  const out = {};
  for (const p of fnParseCustom(code).params) out[p.key] = p.value;
  return out;
}

/** The source-string number a custom stage's code is compiled under (so an error names the stage). */
const FN_CUSTOM_SOURCE = 1000;
/** Every top-level function and constant a snippet declares (renamed per stage so two stages never clash). */
function fnCustomNames(lines) {
  const out = new Set();
  let depth = 0;
  for (const line of lines) {
    if (depth === 0) {
      const f = /^\s*(?:(?:highp|mediump|lowp)\s+)?(?:float|int|uint|bool|void|[biu]?vec[234]|mat[234](?:x[234])?)\s+([A-Za-z_]\w*)\s*\(/.exec(line);
      if (f) out.add(f[1]);
      const c = /^\s*const\s+(?:(?:highp|mediump|lowp)\s+)?\w+\s+([A-Za-z_]\w*)/.exec(line);
      if (c) out.add(c[1]);
    }
    for (const ch of line.replace(/\/\/.*$/, '')) { if (ch === '{') depth++; else if (ch === '}') depth = Math.max(0, depth - 1); }
  }
  out.delete('effect');
  return [...out];
}

/** One custom stage's GLSL: its numbers, the helpers, the code (as the user wrote it, line for line) and the call the pass makes. */
function fnCustomStage(e, i) {
  const parsed = fnParseCustom(e.code);
  const U = `U_cx${i}`, n = Math.max(1, Math.ceil(parsed.params.length / 4));
  const at = j => `${U}[${j >> 2}].${'xyzw'[j & 3]}`;
  const defs = [];
  parsed.params.forEach((p, j) => { if (!p.colour) defs.push([p.key, p.type === 'int' ? `int(floor(${at(j)} + 0.5))` : at(j)]); });
  for (const c of parsed.colours) defs.push([c.name, `vec3(${c.keys.map(k => at(parsed.params.findIndex(p => p.key === k))).join(', ')})`]);
  for (const name of fnCustomNames(parsed.lines)) defs.push([name, `${name}_cx${i}`]);
  defs.push(['effect', `fnCx${i}`], ['picture', 'fnPicture'], ['px', '(1.0 / uRes)'], ['time', 'uTime'], ['resolution', 'uRes'], ['aspect', 'uAspect']);
  return {
    glsl: `uniform vec4 ${U}[${n}];\n${defs.map(([a, b]) => `#define ${a} ${b}`).join('\n')}\n#line 1 ${FN_CUSTOM_SOURCE + i}\n${parsed.lines.join('\n')}\n#line 1 0\n${defs.map(([a]) => `#undef ${a}`).join('\n')}\n`,
    call: `c = fnCx${i}(p, c);`,
  };
}

/** A compile log's errors that belong to custom stage `i`, with its own line numbers ("Line 3: …"). */
export function fnCustomErrors(log, i) {
  const re = new RegExp(`^ERROR:\\s*${FN_CUSTOM_SOURCE + i}:(\\d+):\\s*(.*)$`);
  const out = [];
  for (const l of String(log || '').split('\n')) { const m = re.exec(l.trim()); if (m) out.push(`Line ${m[1]}: ${m[2].trim()}`); }
  return out.join('\n');
}

// ── Curves ───────────────────────────────────────────────────────────────────

/** Points as [x0, y0, x1, y1…] sorted by x, clamped to 0..1, x unique. */
export function fnCurvePoints(flat) {
  const pts = [];
  for (let i = 0; i + 1 < (flat ? flat.length : 0); i += 2) {
    const x = Math.max(0, Math.min(1, +flat[i] || 0)), y = Math.max(0, Math.min(1, +flat[i + 1] || 0));
    pts.push([x, y]);
  }
  pts.sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const p of pts) if (!out.length || p[0] - out[out.length - 1][0] > 1e-4) out.push(p);
  return out;
}

/**
 * A monotone cubic through the points (Fritsch–Carlson): smooth, never
 * overshooting between points, flat beyond the first and last. No points is
 * the straight line y = x.
 */
export function fnCurveEval(flat, x) {
  const pts = fnCurvePoints(flat);
  const n = pts.length;
  if (!n) return x;
  if (n === 1) return pts[0][1];
  if (x <= pts[0][0]) return pts[0][1];
  if (x >= pts[n - 1][0]) return pts[n - 1][1];
  const m = fnMonotoneTangents(pts);
  let i = 0;
  while (i < n - 2 && x > pts[i + 1][0]) i++;
  const [x0, y0] = pts[i], [x1, y1] = pts[i + 1];
  const h = x1 - x0, t = (x - x0) / h, t2 = t * t, t3 = t2 * t;
  return (2 * t3 - 3 * t2 + 1) * y0 + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * y1 + (t3 - t2) * h * m[i + 1];
}

function fnMonotoneTangents(pts) {
  const n = pts.length, d = [], m = new Array(n).fill(0);
  for (let i = 0; i < n - 1; i++) d.push((pts[i + 1][1] - pts[i][1]) / (pts[i + 1][0] - pts[i][0]));
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
    const a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b;
    if (s > 9) { const t = 3 / Math.sqrt(s); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
  }
  return m;
}

/**
 * A hue (or luma) curve: y 0.5 is "no change". It wraps round (hue 1 is hue
 * 0) with a smooth periodic spline; no points is flat 0.5. `wrap` false (the
 * luma-vs-sat curve) holds flat beyond its ends instead.
 */
export function fnHueCurveEval(flat, x, wrap = true) {
  const pts = fnCurvePoints(flat);
  const n = pts.length;
  if (!n) return 0.5;
  if (n === 1) return pts[0][1];
  if (!wrap) return fnCurveEval(flat, x);
  // Copies a turn either side, then a Catmull-Rom through the neighbours of x.
  const ext = [...pts.map(p => [p[0] - 1, p[1]]), ...pts, ...pts.map(p => [p[0] + 1, p[1]])];
  let i = n;
  while (i < ext.length - 2 && x > ext[i + 1][0]) i++;
  while (i > 1 && x < ext[i][0]) i--;
  const p0 = ext[i - 1], p1 = ext[i], p2 = ext[i + 1], p3 = ext[i + 2];
  const h = p2[0] - p1[0], t = h > 0 ? (x - p1[0]) / h : 0, t2 = t * t, t3 = t2 * t;
  const m1 = (p2[1] - p0[1]) / Math.max(1e-6, p2[0] - p0[0]) * h, m2 = (p3[1] - p1[1]) / Math.max(1e-6, p3[0] - p1[0]) * h;
  const y = (2 * t3 - 3 * t2 + 1) * p1[1] + (t3 - 2 * t2 + t) * m1 + (-2 * t3 + 3 * t2) * p2[1] + (t3 - t2) * m2;
  return Math.max(0, Math.min(1, y));
}

/** Are the curves all neutral (straight RGB lines, no hue curves)? */
export function fnCurvesNeutral(c) {
  if (!c) return true;
  const straight = f => { const p = fnCurvePoints(f); return !p.length || (p.length === 2 && p[0][0] === 0 && p[0][1] === 0 && p[1][0] === 1 && p[1][1] === 1); };
  return FN_CURVE_CHANNELS.every(k => straight(c[k])) && !fnHueCurvesUsed(c);
}
export function fnHueCurvesUsed(c) {
  return !!c && FN_HUE_CURVES.some(k => fnCurvePoints(c[k]).some(p => Math.abs(p[1] - 0.5) > 1e-3));
}

/**
 * The curves baked into a 256 × 2 RGBA lookup (bytes). Row 0: red, green and
 * blue through the master curve then their own, and the luma-vs-sat curve in
 * alpha; row 1: hue-vs-sat in red, hue-vs-hue in green.
 */
export function fnBakeLut(curves) {
  const c = curves || fnDefaultCurves();
  const out = new Uint8Array(256 * 2 * 4);
  const b = v => Math.max(0, Math.min(255, Math.round(v * 255)));
  for (let i = 0; i < 256; i++) {
    const x = i / 255, m = fnCurveEval(c.rgb, x);
    out[i * 4] = b(fnCurveEval(c.r, m));
    out[i * 4 + 1] = b(fnCurveEval(c.g, m));
    out[i * 4 + 2] = b(fnCurveEval(c.b, m));
    out[i * 4 + 3] = b(fnHueCurveEval(c.lumaSat, x, false));
    const j = (256 + i) * 4;
    out[j] = b(fnHueCurveEval(c.hueSat, x));
    out[j + 1] = b(fnHueCurveEval(c.hueHue, x));
    out[j + 2] = 128; out[j + 3] = 255;
  }
  return out;
}

// ── The grade on the CPU (the shader's maths, for tests) ─────────────────────

const fnMix = (a, b, t) => a + (b - a) * t;
const fnClamp01 = v => Math.max(0, Math.min(1, v));
const fnSmooth = (a, b, x) => { const t = fnClamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
export const fnLuma = c => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const fnHue = h => [0, 4, 2].map(o => fnClamp01(Math.abs(((h * 6 + o) % 6 + 6) % 6 - 3) - 1));
/** A wheel position (x, y in -1..1) as a colour push with no brightness of its own. */
export function fnWheel(x, y) {
  const r = Math.min(1, Math.hypot(x, y));
  if (r < 1e-5) return [0, 0, 0];
  const h = fnHue((Math.atan2(y, x) / (2 * Math.PI) + 1) % 1), l = fnLuma(h);
  return h.map(v => (v - l) * r);
}
function fnRgb2Hsv(c) {
  const mx = Math.max(c[0], c[1], c[2]), mn = Math.min(c[0], c[1], c[2]), d = mx - mn;
  let h = 0;
  if (d > 1e-6) {
    if (mx === c[0]) h = ((c[1] - c[2]) / d) % 6; else if (mx === c[1]) h = (c[2] - c[0]) / d + 2; else h = (c[0] - c[1]) / d + 4;
    h = ((h / 6) % 1 + 1) % 1;
  }
  return [h, mx > 1e-6 ? d / mx : 0, mx];
}
function fnHsv2Rgb(h, s, v) { return fnHue(h).map(k => v * (1 - s + s * k)); }
const fnLut = (lut, x, ch, row = 0) => { const i = Math.round(fnClamp01(x) * 255); return lut[((row * 256) + i) * 4 + ch] / 255; };
function fnToneCpu(mode, x) {
  if (mode === 'aces') return x.map(c => fnClamp01((c * (2.51 * c + 0.03)) / (c * (2.43 * c + 0.59) + 0.14)));
  if (mode === 'reinhard2') return x.map(c => (c * (1 + c / 16)) / (1 + c));
  if (mode === 'unreal') return x.map(c => c / (c + 0.155) * 1.019);
  return x;
}

/**
 * One colour (display RGB, 0..1) through a grade: the same steps as the
 * shader's fnGrade, in the same order. `lut` from fnBakeLut (null = neutral
 * curves). Tone modes other than none, ACES, Reinhard2 and Unreal pass
 * through here.
 */
export function fnGradePixel(rgb, g, lut) {
  const v = k => (typeof g[k] === 'number' ? g[k] : FN_EFFECTS.grade.params.find(p => p.key === k).value);
  const orig = rgb.slice(0, 3);
  let x = orig.map(c => Math.pow(Math.max(c, 0), 2.2));
  x = x.map(c => c * Math.pow(2, v('exposure')));
  const t = v('temperature'), m = v('tint');
  let wb = [1 + 0.3 * t + 0.1 * m, 1 - 0.25 * m, 1 - 0.3 * t + 0.1 * m];
  const wl = fnLuma(wb); wb = wb.map(c => c / wl);
  x = x.map((c, i) => c * wb[i]);
  if (g.tone && g.tone !== 'none') x = fnToneCpu(g.tone, x);
  let c = x.map(k => Math.pow(Math.max(k, 0), 1 / 2.2));
  // Levels: blacks and whites move the ends.
  const lo = -0.15 * v('blacks'), hi = 1 - 0.2 * v('whites');
  c = c.map(k => (k - lo) / (hi - lo));
  // Contrast: an S around the middle, never clipping.
  const kc = Math.pow(2, v('contrast') * 1.5);
  c = c.map(k => { k = fnClamp01(k); return k < 0.5 ? 0.5 * Math.pow(2 * k, kc) : 1 - 0.5 * Math.pow(2 - 2 * k, kc); });
  // Shadows and highlights: a gamma on each end, masked by brightness.
  let L = fnLuma(c);
  const sh = 1 - fnSmooth(0, 0.55, L), hl = fnSmooth(0.45, 1, L);
  c = c.map(k => Math.pow(fnClamp01(k), Math.pow(2, -v('shadows') * 0.8 * sh)));
  c = c.map(k => 1 - Math.pow(fnClamp01(1 - k), Math.pow(2, v('highlights') * 0.8 * hl)));
  // Lift, gamma, gain.
  const lw = fnWheel(v('liftX'), v('liftY')), gw = fnWheel(v('gammaX'), v('gammaY')), aw = fnWheel(v('gainX'), v('gainY'));
  c = c.map((k, i) => {
    const lift = lw[i] * 0.35 + v('liftL') * 0.25, gain = 1 + aw[i] * 0.6 + v('gainL') * 0.5, gam = Math.max(0.05, 1 + gw[i] * 0.6 + v('gammaL') * 0.5);
    k = k + lift * (1 - k);
    k = k * gain;
    return Math.pow(Math.max(k, 0), 1 / gam);
  });
  // Curves.
  if (lut) c = [fnLut(lut, c[0], 0), fnLut(lut, c[1], 1), fnLut(lut, c[2], 2)];
  // Hue curves (only when used; the shader skips them the same way).
  if (lut && g.curves && fnHueCurvesUsed(g.curves)) {
    const hsv = fnRgb2Hsv(c.map(fnClamp01));
    const l = fnLuma(c);
    hsv[1] = fnClamp01(hsv[1] * 2 * fnLut(lut, hsv[0], 0, 1) * 2 * fnLut(lut, l, 3));
    hsv[0] = ((hsv[0] + (fnLut(lut, hsv[0], 1, 1) - 0.5) * 0.5) % 1 + 1) % 1;
    c = fnHsv2Rgb(hsv[0], hsv[1], hsv[2]);
  }
  // Vibrance and saturation.
  L = fnLuma(c);
  const sat = Math.max(...c) - Math.min(...c);
  c = c.map(k => fnMix(L, k, 1 + v('vibrance') * (1 - fnClamp01(sat * 1.5))));
  c = c.map(k => fnMix(L, k, 1 + v('saturation')));
  // Split toning.
  const tb = fnClamp01(fnLuma(c) - v('splitBalance') * 0.5 + 0.0);
  const ws = (1 - tb) * (1 - tb), wh = tb * tb;
  const th = fnHue(v('splitHiHue') / 360), ts = fnHue(v('splitShHue') / 360), thl = fnLuma(th), tsl = fnLuma(ts);
  c = c.map((k, i) => k + (th[i] - thl) * v('splitHiSat') * wh * 0.6 + (ts[i] - tsl) * v('splitShSat') * ws * 0.6);
  // HSL secondary.
  if (v('hslRange') > 0) {
    const hsv = fnRgb2Hsv(c.map(fnClamp01));
    const d = Math.abs((((hsv[0] - v('hslHue') / 360 + 0.5) % 1) + 1) % 1 - 0.5) * 360;
    const r = v('hslRange');
    const w = (1 - fnSmooth(r * (1 - v('hslSoft')), r + 1e-3, d)) * fnSmooth(0.04, 0.2, hsv[1]);
    hsv[0] = ((hsv[0] + v('hslShift') / 360 * w) % 1 + 1) % 1;
    hsv[1] = fnClamp01(hsv[1] * (1 + v('hslSat') * w));
    hsv[2] = Math.max(0, hsv[2] * (1 + v('hslLum') * w * 0.6));
    c = fnHsv2Rgb(hsv[0], hsv[1], hsv[2]);
  }
  c = c.map(fnClamp01);
  return c.map((k, i) => fnMix(orig[i], k, v('amount')));
}

// ── Halation's scene-energy estimate (the shader's fnEnergy, for tests) ──────

/**
 * Linear display light → estimated scene light. An 8-bit picture stops at
 * white; this assumes the tones right under white were squeezed in by a
 * shoulder that started at `knee`, and undoes it so display 1.0 becomes
 * 2^headroom while the mid-tones stay where they are.
 */
export function fnEnergy(x, headroom, knee = 0.75) {
  if (x <= knee) return x;
  const maxE = Math.pow(2, headroom), tMax = (maxE - knee) / (1 - knee), uMax = tMax / (1 + tMax);
  const u = Math.min(1, (x - knee) / (1 - knee)) * uMax;
  return knee + (1 - knee) * u / (1 - u);
}
/** A soft threshold: 0 well below, a quadratic knee around it, then linear. */
export function fnSoftThreshold(v, thr, knee) {
  const k = Math.max(1e-4, knee);
  const q = Math.max(0, Math.min(2 * k, v - thr + k));
  return Math.max(q * q / (4 * k), v - thr);
}
/**
 * Halation's two sources from a linear pixel: [red, white]. Red is the red
 * channel's scene energy over the threshold (a soft knee of FN_HAL.knee × the
 * threshold): what bleeds. White is the dimmest channel's energy over 1.5 × white:
 * only light brighter than white in every channel grows (Growth).
 */
export function fnHalSource(rgb, thresholdStops, headroom) {
  const thr = Math.pow(2, thresholdStops);
  const red = fnSoftThreshold(fnEnergy(rgb[0], headroom), thr, thr * FN_HAL.knee);
  const white = fnSoftThreshold(fnEnergy(Math.min(rgb[0], rgb[1], rgb[2]), headroom), 1.5, 0.5);
  return [fnHalSat(red, FN_HAL.srcMax), fnHalSat(white, FN_HAL.whiteMax)];
}
/** A source's soft ceiling: linear for small excesses, never past `max`. */
export function fnHalSat(v, max) {
  return max * Math.tanh(Math.max(0, v) / max);
}
/** The tight bleed's falloff at a distance (px at `height` lines) from a source: e^(−d²/2σ²), σ scaled with the picture. */
export function fnHalSpread(d, height = 1080) {
  const s = FN_HAL.sigma * height / 1080;
  return Math.exp(-d * d / (2 * s * s));
}
/** A gaussian blur (σ px) of a half plane, at a distance d outside its edge: erfc(d / σ√2) / 2, so 0.5 at the edge. */
function fnHalfPlane(d, s) {
  const x = Math.max(0, d) / (s * Math.SQRT2);
  // Abramowitz & Stegun 7.1.26
  const t = 1 / (1 + 0.3275911 * x);
  return 0.5 * t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429)))) * Math.exp(-x * x);
}
/** The Reach tail's strength and width mix: strength × FN_HAL.tail, and how far from the eighth level (σ 16) toward the sixteenth (σ 32). */
export function fnHalTailMix(reach) {
  const r = Math.min(1, Math.max(0, reach));
  return { strength: Math.min(1, r * 2), wide: Math.max(0, r * 2 - 1) };
}
/** The Reach tail at a distance d outside a straight edge, per unit of source (px at `height` lines). */
export function fnHalTailEdge(d, reach = FN_HAL.reach, height = 1080) {
  const m = fnHalTailMix(reach), k = height / 1080;
  return FN_HAL.tail * m.strength * ((1 - m.wide) * fnHalfPlane(d, 16 * k) + m.wide * fnHalfPlane(d, 32 * k));
}
/**
 * The bleed (linear red, before the receive mask) at a distance d outside a
 * straight bright edge whose red source is `src`: the tight max-spread plus
 * the Reach tail. The radius profile the docs strip draws.
 */
export function fnHalEdgeBleed(d, src, amount = FN_HAL.amount, reach = FN_HAL.reach, height = 1080) {
  return amount * src * (FN_HAL.gain * fnHalSpread(d, height) + fnHalTailEdge(d, reach, height));
}
/** How much of the bleed a pixel takes, by its own linear red: all of it when dark, none when it is itself bright. */
export function fnHalReceive(red) {
  const [a, b] = FN_HAL.recv, t = Math.min(1, Math.max(0, (red - a) / (b - a)));
  return 1 - t * t * (3 - 2 * t);
}
/** The bleed's colour from its red (linear): green joins only where it is strong (orange at the edge, red further out), a little blue goes. */
export function fnHalTint(dR, warmth) {
  const r = Math.max(0, dR);
  return [r, warmth * r * r / (r + FN_HAL.greenKnee), FN_HAL.blue * r];
}
/**
 * One pixel of halation, in linear light: `rgb` the pixel, `bleed` what
 * reaches it (linear red, from fnHalEdgeBleed or the shader's levels),
 * `src` its own red source over the threshold in linear light (for
 * Conserve), `white` the growth reaching it. The shader does the same.
 */
export function fnHalPixel(rgb, bleed, src, p = {}) {
  const v = k => (typeof p[k] === 'number' ? p[k] : FN_HAL[k]);
  const dR = Math.max(0, bleed) * fnHalReceive(rgb[0]);
  const t = fnHalTint(dR, v('warmth'));
  const take = v('conserve') * Math.min(1, v('amount')) * Math.max(0, src);
  const w = Math.max(0, p.white || 0) * v('growth') * v('amount');
  t[2] = Math.max(t[2], -0.5 * rgb[2]); // never more than half the pixel's own blue, so a black surround keeps its hue
  return rgb.map((c, i) => {
    const x = Math.max(0, c - take) + t[i];
    const tone = [1, 0.95, 0.9][i];
    return Math.max(0, x + (1 - Math.min(1, x)) * (1 - Math.exp(-w * tone)));
  });
}

// ── The frame ring (time displacement) ───────────────────────────────────────

/**
 * Which slot of a ring of `size` frames holds which frame. `push()` after a
 * frame is drawn writes it into `slotForWrite()`; `slotFor(back)` is the frame
 * `back` frames ago (1 = the previous frame), or -1 before one exists.
 */
export function fnRing(size) {
  let head = -1, count = 0;
  return {
    size,
    get count() { return count; },
    reset() { head = -1; count = 0; },
    slotForWrite() { return (head + 1) % size; },
    push() { head = (head + 1) % size; count = Math.min(size, count + 1); },
    slotFor(back) { if (back < 1 || back > count) return -1; return ((head - (back - 1)) % size + size) % size; },
    get head() { return head; },
  };
}

/** Ring size for a quality at an output size: frames, and the texture size (scaled down to stay under the quality's bytes). */
export function fnRingSize(quality, W, H) {
  const q = FN_TIME_QUALITY[quality] || FN_TIME_QUALITY.medium;
  let s = q.scale;
  const bytes = sc => q.frames * Math.max(1, Math.round(W * sc)) * Math.max(1, Math.round(H * sc)) * 4;
  while (s > 0.05 && bytes(s) > q.cap) s *= 0.9;
  return { frames: q.frames, w: Math.max(1, Math.round(W * s)), h: Math.max(1, Math.round(H * s)), bytes: bytes(s) };
}

// ── Shaders ──────────────────────────────────────────────────────────────────

const FN_COMMON = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2DArray;
uniform sampler2D uPic, uLay;
uniform float uInFlip, uStraightIn;
uniform vec2 uRes;
uniform vec2 uSrcRes;
uniform float uAspect, uTime;
vec4 scene(vec2 p) {
  vec4 pic = texture(uPic, uInFlip > 0.5 ? vec2(p.x, 1.0 - p.y) : p);
  if (uStraightIn > 0.5) pic.rgb *= pic.a;
  vec4 lay = texture(uLay, p);
  return lay + pic * (1.0 - lay.a);
}
float fnLuma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
vec3 toLin(vec3 c) { return pow(max(c, 0.0), vec3(2.2)); }
vec3 toSrgb(vec3 c) { return pow(max(c, 0.0), vec3(1.0 / 2.2)); }
float fnHash(vec3 p) { p = fract(p * 0.3183099 + vec3(0.1, 0.17, 0.13)); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float fnNoise(vec3 x) {
  vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(fnHash(i), fnHash(i + vec3(1,0,0)), f.x), mix(fnHash(i + vec3(0,1,0)), fnHash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(fnHash(i + vec3(0,0,1)), fnHash(i + vec3(1,0,1)), f.x), mix(fnHash(i + vec3(0,1,1)), fnHash(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float fnHash2(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
float fnNoise2(vec2 x) { vec2 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f); return mix(mix(fnHash2(i), fnHash2(i + vec2(1, 0)), f.x), mix(fnHash2(i + vec2(0, 1)), fnHash2(i + vec2(1, 1)), f.x), f.y); }
float fnSoft(float v, float thr, float knee) { float k = max(knee, 1e-4); float q = clamp(v - thr + k, 0.0, 2.0 * k); return max(q * q / (4.0 * k), v - thr); }
float fnEnergy1(float x, float headroom) {
  const float knee = 0.75;
  if (x <= knee) return x;
  float maxE = exp2(headroom), tMax = (maxE - knee) / (1.0 - knee), uMax = tMax / (1.0 + tMax);
  float u = min(1.0, (x - knee) / (1.0 - knee)) * uMax;
  return knee + (1.0 - knee) * u / (1.0 - u);
}
// Halation's sources (fnHalSource): red over the threshold, and the dimmest channel over white. h = threshold stops, headroom, knee.
vec2 fnHalSrc(vec3 x, vec3 h) {
  float thr = exp2(h.x);
  vec2 s = vec2(fnSoft(fnEnergy1(x.r, h.y), thr, thr * h.z), fnSoft(fnEnergy1(min(x.r, min(x.g, x.b)), h.y), 1.5, 0.5));
  // Saturate (fnHalSat): a clipped white bleeds like the reference's brightest glint, no more.
  const vec2 m = vec2(${fnGl(FN_HAL.srcMax)}, ${fnGl(FN_HAL.whiteMax)});
  return m * tanh(min(s / m, vec2(9.0))); // capped: some drivers make tanh of a big number NaN
}
`;

const FN_VS = `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

/** `#define`s naming each number of a kind as a component of its vec4 array. */
function fnDefines(kind) {
  const ps = FN_EFFECTS[kind].params;
  const n = Math.ceil(ps.length / 4);
  return `uniform vec4 U_${kind}[${n}];\n` + ps.map((p, i) => `#define ${kind}_${p.key} U_${kind}[${i >> 2}].${'xyzw'[i & 3]}`).join('\n') + '\n';
}

const FN_GRADE = (tone, hueCurves, curves) => `
uniform sampler2D uLut;
vec3 fnHueRgb(float h) { return clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0); }
vec3 fnWheel(float x, float y) { float r = min(1.0, length(vec2(x, y))); if (r < 1e-5) return vec3(0.0); vec3 h = fnHueRgb(fract(atan(y, x) / 6.2831853 + 1.0)); return (h - fnLuma(h)) * r; }
vec3 rgb2hsv(vec3 c) {
  float mx = max(c.r, max(c.g, c.b)), mn = min(c.r, min(c.g, c.b)), d = mx - mn, h = 0.0;
  if (d > 1e-6) { if (mx == c.r) h = mod((c.g - c.b) / d, 6.0); else if (mx == c.g) h = (c.b - c.r) / d + 2.0; else h = (c.r - c.g) / d + 4.0; h = fract(h / 6.0); }
  return vec3(h, mx > 1e-6 ? d / mx : 0.0, mx);
}
vec3 hsv2rgb(vec3 c) { return c.z * (1.0 - c.y + c.y * fnHueRgb(c.x)); }
float lutAt(float x, int ch, float row) { vec4 t = texture(uLut, vec2((clamp(x, 0.0, 1.0) * 255.0 + 0.5) / 256.0, (row + 0.5) / 2.0)); return ch == 0 ? t.r : ch == 1 ? t.g : ch == 2 ? t.b : t.a; }
vec3 fnGrade(vec3 orig) {
  // Each step is skipped while its controls are at rest (a branch on uniforms: every pixel takes the same way).
  vec3 c = orig;
  if (${tone === 'none' ? '' : 'true || '}grade_exposure != 0.0 || grade_temperature != 0.0 || grade_tint != 0.0) {
    vec3 x = toLin(orig) * exp2(grade_exposure);
    vec3 wb = vec3(1.0 + 0.3 * grade_temperature + 0.1 * grade_tint, 1.0 - 0.25 * grade_tint, 1.0 - 0.3 * grade_temperature + 0.1 * grade_tint);
    x *= wb / fnLuma(wb);
    ${tone === 'none' ? '' : tone === 'oklab' ? 'x = toneOkLab(x, 0.6, 0.6);' : `x = ${FN_TONE_FUNCTIONS[tone] || 'toneACES'}(x);`}
    c = toSrgb(x);
  }
  float lo = -0.15 * grade_blacks, hi = 1.0 - 0.2 * grade_whites;
  c = clamp((c - lo) / (hi - lo), 0.0, 1.0);
  if (grade_contrast != 0.0) {
    float kc = exp2(grade_contrast * 1.5);
    c = mix(1.0 - 0.5 * pow(2.0 - 2.0 * c, vec3(kc)), 0.5 * pow(2.0 * c, vec3(kc)), step(c, vec3(0.5)));
  }
  float L;
  if (grade_shadows != 0.0 || grade_highlights != 0.0) {
    L = fnLuma(c);
    float sh = 1.0 - smoothstep(0.0, 0.55, L), hl = smoothstep(0.45, 1.0, L);
    c = pow(clamp(c, 0.0, 1.0), vec3(exp2(-grade_shadows * 0.8 * sh)));
    c = 1.0 - pow(clamp(1.0 - c, 0.0, 1.0), vec3(exp2(grade_highlights * 0.8 * hl)));
  }
  if (grade_liftX != 0.0 || grade_liftY != 0.0 || grade_liftL != 0.0 || grade_gammaX != 0.0 || grade_gammaY != 0.0 || grade_gammaL != 0.0 || grade_gainX != 0.0 || grade_gainY != 0.0 || grade_gainL != 0.0) {
    vec3 lift = fnWheel(grade_liftX, grade_liftY) * 0.35 + grade_liftL * 0.25;
    vec3 gain = 1.0 + fnWheel(grade_gainX, grade_gainY) * 0.6 + grade_gainL * 0.5;
    vec3 gam = max(vec3(0.05), 1.0 + fnWheel(grade_gammaX, grade_gammaY) * 0.6 + grade_gammaL * 0.5);
    c = c + lift * (1.0 - c);
    c = c * gain;
    c = pow(max(c, 0.0), 1.0 / gam);
  }
  ${curves ? 'c = vec3(lutAt(c.r, 0, 0.0), lutAt(c.g, 1, 0.0), lutAt(c.b, 2, 0.0));' : ''}
  ${hueCurves ? `{
    vec3 hsv = rgb2hsv(clamp(c, 0.0, 1.0));
    float l = fnLuma(c);
    hsv.y = clamp(hsv.y * 2.0 * lutAt(hsv.x, 0, 1.0) * 2.0 * lutAt(l, 3, 0.0), 0.0, 1.0);
    hsv.x = fract(hsv.x + (lutAt(hsv.x, 1, 1.0) - 0.5) * 0.5 + 1.0);
    c = hsv2rgb(hsv);
  }` : ''}
  L = fnLuma(c);
  float sat = max(c.r, max(c.g, c.b)) - min(c.r, min(c.g, c.b));
  c = mix(vec3(L), c, 1.0 + grade_vibrance * (1.0 - clamp(sat * 1.5, 0.0, 1.0)));
  c = mix(vec3(L), c, 1.0 + grade_saturation);
  if (grade_splitHiSat > 0.0 || grade_splitShSat > 0.0) {
    float tb = clamp(fnLuma(c) - grade_splitBalance * 0.5, 0.0, 1.0);
    float ws = (1.0 - tb) * (1.0 - tb), wh = tb * tb;
    vec3 th = fnHueRgb(grade_splitHiHue / 360.0), ts = fnHueRgb(grade_splitShHue / 360.0);
    c += (th - fnLuma(th)) * grade_splitHiSat * wh * 0.6 + (ts - fnLuma(ts)) * grade_splitShSat * ws * 0.6;
  }
  if (grade_hslRange > 0.0) {
    vec3 hsv = rgb2hsv(clamp(c, 0.0, 1.0));
    float d = abs(fract(hsv.x - grade_hslHue / 360.0 + 0.5) - 0.5) * 360.0;
    float w = (1.0 - smoothstep(grade_hslRange * (1.0 - grade_hslSoft), grade_hslRange + 1e-3, d)) * smoothstep(0.04, 0.2, hsv.y);
    hsv.x = fract(hsv.x + grade_hslShift / 360.0 * w + 1.0);
    hsv.y = clamp(hsv.y * (1.0 + grade_hslSat * w), 0.0, 1.0);
    hsv.z = max(0.0, hsv.z * (1.0 + grade_hslLum * w * 0.6));
    c = hsv2rgb(hsv);
  }
  return mix(orig, clamp(c, 0.0, 1.0), grade_amount);
}
`;


/** Map for time displacement: 0 = now, 1 = the most frames back. */
function fnTimeMapGlsl(map) {
  switch (map) {
    case 'luma': return 'float fnTimeMap(vec2 q) { return fnLuma(scene(q).rgb); }';
    case 'noise': return 'float fnTimeMap(vec2 q) { vec2 s = q * vec2(uAspect, 1.0) * time_scale; return clamp(fnNoise(vec3(s, uTime * time_speed)) * 1.2 - 0.1, 0.0, 1.0); }';
    case 'radial': return 'float fnTimeMap(vec2 q) { return clamp(length((q - vec2(time_cx, time_cy)) * vec2(uAspect, 1.0)) / (0.5 * length(vec2(uAspect, 1.0))), 0.0, 1.0); }';
    case 'layer': return 'uniform sampler2D uMap;\nfloat fnTimeMap(vec2 q) { return texture(uMap, q).a; }';
    default: return 'float fnTimeMap(vec2 q) { float a = radians(time_angle); vec2 d = vec2(cos(a), sin(a)); vec2 v = (q - 0.5) * vec2(uAspect, 1.0); float e = 0.5 * (abs(d.x) * uAspect + abs(d.y)); return clamp(dot(v, d) / max(e, 1e-4) * 0.5 + 0.5, 0.0, 1.0); }';
  }
}

/**
 * The final pass for the effects that run (see fnRunning), as GLSL. `opts`:
 * { tone, hueCurves, timeMap, floatGlow }. Also returns what it needs:
 * { src, glow, time, lut }.
 */
export function fnBuildFinal(effects, opts = {}) {
  const kinds = effects.map(e => e.kind);
  const has = k => kinds.includes(k);
  const glow = has('bloom') || has('halation') || (has('crt'));
  const time = has('time');
  let src = FN_COMMON;
  for (const k of kinds) if (FN_EFFECTS[k]) src += fnDefines(k);
  src += `uniform float uOutFlip, uLive;\nuniform vec4 uWipe;\nout vec4 fragColor;\nvec2 gPx;\nfloat gEdge = 1.0;\n`;
  // The before/after wipe: 1 where the finished picture shows, 0 where the picture before the stack does.
  src += `float fnWipe(vec2 p) {
  float a = radians(uWipe.z);
  vec2 n = vec2(cos(a), sin(a));
  vec2 v = (p - 0.5) * vec2(uAspect, 1.0);
  float e = 0.5 * (abs(n.x) * uAspect + abs(n.y));
  float t = dot(v, n) / max(e, 1e-4) * 0.5 + 0.5;
  float s = uWipe.w * 0.5;
  return s <= 0.0 ? step(uWipe.y, t) : smoothstep(uWipe.y - s, uWipe.y + s, t);
}
`;
  if (glow) src += `uniform sampler2D uQ0, uQ1, uE0, uE1, uG0, uG1;\nuniform float uGlowFloat;\nvec3 glowDec(vec3 v) { return uGlowFloat > 0.5 ? v : v / max(vec3(1e-4), 1.0 - v); }\n`;
  if (has('halation')) src += 'uniform sampler2D uHM;\n';
  if (has('grade')) src += (opts.tone && opts.tone !== 'none' ? FN_TONE_GLSL + '\n' : '') + FN_GRADE(opts.tone || 'none', !!opts.hueCurves, opts.curves !== false || !!opts.hueCurves);
  if (has('crt')) src += FN_CRT_MASK_GLSL + '\n';
  if (time) {
    src += `uniform sampler2DArray uRing;\nuniform float uRingSize, uRingHead, uRingCount;\n${fnTimeMapGlsl(opts.timeMap)}\n`;
    src += `vec4 fnRingAt(vec2 q, float back) { return texture(uRing, vec3(q, mod(uRingHead - (back - 1.0) + uRingSize * 4.0, uRingSize))); }
vec4 fetch(vec2 q) {
  float m = fnTimeMap(q); m = mix(m, 1.0 - m, time_invert);
  float b = min(m * time_amount, uRingCount);
  if (b < 1e-3) return scene(q);
  float i0 = floor(b), f = b - i0;
  f = mix(step(0.5, f), f, time_smooth);
  vec4 a0 = i0 < 0.5 ? scene(q) : fnRingAt(q, i0);
  vec4 a1 = i0 + 1.0 <= uRingCount ? fnRingAt(q, i0 + 1.0) : a0;
  return mix(a0, a1, f);
}
`;
  } else src += 'vec4 fetch(vec2 q) { return scene(q); }\n';
  // Custom effects: each its own function (in the stack's order), called with the colour so far.
  const customs = effects.filter(e => e.kind === 'custom');
  const customCalls = new Map();
  if (customs.length) {
    src += 'vec3 fnPicture(vec2 uv) { vec4 s = scene(uv); return s.a > 1e-5 ? s.rgb / s.a : vec3(0.0); }\n';
    customs.forEach((e, i) => { const st = fnCustomStage(e, i); src += st.glsl; customCalls.set(e, st.call); });
  }
  // Geometry: each effect bends where the picture is read. Applied last-first, so the stack's first effect bends the picture first.
  const warps = [];
  for (const k of kinds) {
    if (k === 'shake') warps.push(`{
    float t = uTime * shake_speed;
    vec2 off = (vec2(fnNoise(vec3(t, 1.3, 0.0)), fnNoise(vec3(t, 7.9, 3.0))) - 0.5) * shake_amount * 0.06;
    float rot = (fnNoise(vec3(t * 0.8, 4.1, 9.0)) - 0.5) * shake_amount * shake_rotate * 0.08;
    off.x += (fnNoise(vec3(uTime * 0.7, 2.0, 5.0)) - 0.5) * shake_weave * 0.012;
    off.y += (fnHash(vec3(floor(uTime * 24.0), 3.0, 1.0)) - 0.5) * shake_weave * 0.004;
    float z = 1.0 + shake_amount * 0.07 + shake_amount * shake_rotate * 0.05 * uAspect + shake_weave * 0.014;
    vec2 v = (q - 0.5) * vec2(uAspect, 1.0);
    v = mat2(cos(rot), sin(rot), -sin(rot), cos(rot)) * v / z;
    q = v / vec2(uAspect, 1.0) + 0.5 + off;
  }`);
    if (k === 'lens') warps.push(`{
    vec2 v = (q - 0.5) * vec2(uAspect, 1.0);
    float r2 = dot(v, v) / (0.25 * (uAspect * uAspect + 1.0));
    float f = 1.0 + lens_distortion * 0.35 * r2 + lens_cubic * 0.2 * r2 * r2;
    float fc = 1.0 + lens_distortion * 0.35 + lens_cubic * 0.2;
    float z = mix(1.0, max(fc, 1.0), lens_fit);
    q = v * f / z / vec2(uAspect, 1.0) + 0.5;
  }`);
    if (k === 'crt') warps.push(`{
    vec2 v = q * 2.0 - 1.0;
    v += v * (v.yx * v.yx) * crt_curvature * 0.25;
    q = v * 0.5 + 0.5;
    vec2 e = smoothstep(vec2(0.0), vec2(0.004 + crt_curvature * 0.01), q) * smoothstep(vec2(0.0), vec2(0.004 + crt_curvature * 0.01), 1.0 - q);
    gEdge *= e.x * e.y;
  }`);
  }
  // Colour: each effect in the stack's order.
  const ops = [];
  for (const e of effects) {
    const k = e.kind;
    if (k === 'custom') ops.push(customCalls.get(e));
    if (k === 'grade') ops.push('c = fnGrade(c);');
    if (k === 'vignette') ops.push(`{
    float rr = mix(1.0, uAspect, vignette_roundness);
    vec2 v = (p - 0.5) * vec2(rr, 1.0);
    float d = length(v) / length(vec2(rr, 1.0) * 0.5);
    float s0 = mix(0.2, 1.15, vignette_size);
    float w = smoothstep(s0 - vignette_feather * 0.8 - 1e-3, s0, d);
    c = mix(c, vec3(vignette_colorR, vignette_colorG, vignette_colorB), w * vignette_amount);
  }`);
    if (k === 'crt') ops.push(`{
    float cell = crt_cell * uRes.y / 1080.0;
    vec3 m = crtMaskFn(gPx, max(cell, 1.0), 0.6 + 0.4 * crt_mask, crt_stagger, crt_scanlines);
    c *= mix(vec3(1.0), m, crt_mask);
    c *= 1.0 + crt_pulse * cos(gPx.x / (60.0 * uRes.y / 1080.0) + uTime * 20.0);
    vec3 g = glowDec(texture(uE0, p).rgb) * 0.6 + glowDec(texture(uQ0, p).rgb) * 0.4;
    c = toSrgb(toLin(c) + g * crt_glow * 0.8);
  }`);
    if (k === 'bloom') ops.push(`{
    vec3 bq = glowDec(texture(uQ0, p).rgb), be = glowDec(texture(uE0, p).rgb), bg = glowDec(texture(uG0, p).rgb);
    vec3 b = (bloom_radius < 0.5 ? mix(bq, be, bloom_radius * 2.0) : mix(be, bg, bloom_radius * 2.0 - 1.0)) * vec3(bloom_tintR, bloom_tintG, bloom_tintB);
    vec3 x = toLin(c);
    c = toSrgb(x + (1.0 - x) * (1.0 - exp(-b * bloom_amount * 1.5)));
  }`);
    if (k === 'halation') ops.push(`{
    // The tight bleed (a max-spread of the red source, half size) plus the Reach tail (a blur: the eighth level, widening to the sixteenth); fnHalPixel does the same.
    vec3 hm = glowDec(texture(uHM, p).rgb);
    float tail = mix(glowDec(texture(uE1, p).rgb).r, glowDec(texture(uG1, p).rgb).r, clamp(halation_reach * 2.0 - 1.0, 0.0, 1.0)) * min(1.0, halation_reach * 2.0);
    vec3 x = toLin(c);
    float bleed = halation_amount * (${fnGl(FN_HAL.gain)} * hm.r + ${fnGl(FN_HAL.tail)} * tail);
    float dR = max(bleed, 0.0) * (1.0 - smoothstep(${fnGl(FN_HAL.recv[0])}, ${fnGl(FN_HAL.recv[1])}, x.r));
    vec3 tint = vec3(dR, halation_warmth * dR * dR / (dR + ${fnGl(FN_HAL.greenKnee)}), max(${fnGl(FN_HAL.blue)} * dR, -0.5 * x.b));
    float thr = exp2(halation_threshold);
    float take = halation_conserve * min(halation_amount, 1.0) * fnSoft(x.r, thr, thr * ${fnGl(FN_HAL.knee)});
    x = max(x - take, 0.0) + tint;
    float w = hm.g * halation_growth * halation_amount;
    x = max(x + (1.0 - min(x, 1.0)) * (1.0 - exp(-w * vec3(1.0, 0.95, 0.9))), 0.0);
    c = toSrgb(x);
  }`);
    if (k === 'grain') ops.push(`{
    float cell = max(0.5, grain_size * uRes.y / 1080.0);
    float fr = grain_fps > 0.0 ? floor(uTime * grain_fps) : 0.0;
    vec2 g = gPx / cell + vec2(fr * 37.0, fr * 17.0);
    float m = fnNoise2(g) - 0.5;
    vec3 n = vec3(m);
    if (grain_colour > 0.0) n = mix(n, vec3(m, fnNoise2(g + 31.7) - 0.5, fnNoise2(g + 63.1) - 0.5), grain_colour);
    float L = fnLuma(c);
    float w = mix(1.0, clamp(4.0 * L * (1.0 - L) * 1.2 + 0.08, 0.0, 1.0), grain_response);
    c = c + n * grain_amount * 0.35 * w;
  }`);
    if (k === 'flicker') ops.push(`{
    float t = uTime * flicker_speed;
    float n = mix(fnHash(vec3(floor(t), 1.0, 2.0)), fnHash(vec3(floor(t) + 1.0, 1.0, 2.0)), smoothstep(0.0, 1.0, fract(t)));
    c *= 1.0 + (n - 0.5) * flicker_amount * 0.5;
  }`);
  }
  let sample = 's = fetch(q);';
  if (has('chroma')) sample = `{
    vec2 d = q - 0.5;
    float sc = chroma_amount * 0.018 * pow(length(d * vec2(uAspect, 1.0)) * 1.25, chroma_falloff) / max(length(d * vec2(uAspect, 1.0)), 1e-4) * length(d * vec2(uAspect, 1.0));
    vec2 o = normalize(d + 1e-6) * sc;
    vec4 m = fetch(q);
    s = vec4(fetch(q + o).r, m.g, fetch(q - o).b, m.a);
  }`;
  src += `void main() {
  vec2 p = gl_FragCoord.xy / uRes;
  if (uOutFlip > 0.5) p.y = 1.0 - p.y;
  gPx = p * uRes;
  float wipe = 1.0;
  if (uWipe.x > 0.5) {
    wipe = fnWipe(p);
    if (wipe <= 0.0) {
      vec4 o = scene(p);
      fragColor = uLive > 0.5 ? vec4(o.rgb, 1.0) : vec4(o.a > 0.0 ? o.rgb / o.a : vec3(0.0), o.a);
      return;
    }
  }
  vec2 q = p;
  ${warps.reverse().join('\n  ')}
  vec4 s;
  ${sample}
  float a = s.a;
  vec3 c = a > 1e-5 ? s.rgb / a : vec3(0.0);
  ${ops.join('\n  ')}
  c = clamp(c, 0.0, 1.0) * gEdge;
  if (wipe < 1.0) {
    vec4 o = scene(p);
    c = mix(o.a > 1e-5 ? o.rgb / o.a : vec3(0.0), c, wipe);
    a = mix(o.a, a, wipe);
  }
  fragColor = uLive > 0.5 ? vec4(c * a, 1.0) : vec4(c, a);
}
`;
  return { src, glow, time, lut: has('grade'), custom: customs.map(e => e.id) };
}

const FN_PREFILTER = (bloom, halation, crtGlow) => `${FN_COMMON}
layout(location = 0) out vec4 o0;
layout(location = 1) out vec4 o1;
uniform float uGlowFloat;
uniform vec4 uBloom;   // threshold, knee, -, -
uniform vec4 uHal;     // threshold stops, headroom, knee, -
vec3 enc(vec3 v) { return uGlowFloat > 0.5 ? v : v / (1.0 + v); }
void main() {
  vec2 base = floor(gl_FragCoord.xy) * 4.0;
  vec3 b = vec3(0.0), h = vec3(0.0);
  const int STEP = ${halation ? 1 : 2};
  const float N = ${halation ? '16.0' : '4.0'};
  for (int j = 0; j < 4; j += STEP) for (int i = 0; i < 4; i += STEP) {
    vec2 p = (base + vec2(float(i), float(j)) + ${halation ? '0.5' : '1.0'}) / uSrcRes;
    vec4 s = scene(p);
    vec3 x = toLin(s.a > 1e-5 ? s.rgb / s.a : vec3(0.0)) * s.a;
    ${bloom ? 'float mx = max(x.r, max(x.g, x.b)); b += x * (fnSoft(mx, uBloom.x, uBloom.x * 0.5 + 0.05) / max(mx, 1e-4));' : crtGlow ? 'b += x;' : ''}
    ${halation ? 'h += vec3(fnHalSrc(x, uHal.xyz), 0.0);' : ''}
  }
  o0 = vec4(enc(b / N), 1.0);
  o1 = vec4(enc(h / N), 1.0);
}
`;

/** Halation's half-size source: the largest red and white sources (fnHalSrc) of each 2 × 2 block, so a one-pixel glint survives. */
const FN_HAL_PRE = `${FN_COMMON}
out vec4 o0;
uniform float uGlowFloat;
uniform vec4 uHal;     // threshold stops, headroom, knee, -
void main() {
  vec2 base = floor(gl_FragCoord.xy) * 2.0;
  vec2 m = vec2(0.0);
  for (int j = 0; j < 2; j++) for (int i = 0; i < 2; i++) {
    vec4 s = scene((base + vec2(float(i), float(j)) + 0.5) / uSrcRes);
    vec3 x = toLin(s.a > 1e-5 ? s.rgb / s.a : vec3(0.0)) * s.a;
    m = max(m, fnHalSrc(x, uHal.xyz));
  }
  vec3 v = vec3(m, 0.0);
  o0 = vec4(uGlowFloat > 0.5 ? v : v / (1.0 + v), 1.0);
}
`;

/**
 * Halation's max-spread, one direction: the largest of each texel within
 * 4.5 σ times e^(−i²/2σ²). Two passes (across, then down) give the 2D
 * max-spread exactly, since the gaussian factors.
 */
const FN_HAL_MAX = `#version 300 es
precision highp float;
uniform sampler2D uA;
uniform vec2 uRes, uDir;
uniform float uSigma, uGlowFloat;
out vec4 o0;
vec3 dec(vec3 v) { return uGlowFloat > 0.5 ? v : v / max(vec3(1e-4), 1.0 - v); }
void main() {
  vec2 p = gl_FragCoord.xy / uRes;
  vec3 m = dec(texture(uA, p).rgb);
  float k = -0.5 / max(uSigma * uSigma, 1e-4), reach = uSigma * 4.5 + 0.5;
  for (int i = 1; i <= 64; i++) {
    float fi = float(i);
    if (fi > reach) break;
    m = max(m, max(dec(texture(uA, p + uDir * fi).rgb), dec(texture(uA, p - uDir * fi).rgb)) * exp(fi * fi * k));
  }
  o0 = vec4(uGlowFloat > 0.5 ? m : m / (1.0 + m), 1.0);
}
`;

/** One direction of a 9-tap Gaussian (5 bilinear reads), both attachments at once; it can also shrink as it blurs. */
const FN_BLUR = `#version 300 es
precision highp float;
uniform sampler2D uA, uB;
uniform vec2 uRes, uDir;
layout(location = 0) out vec4 o0;
layout(location = 1) out vec4 o1;
void main() {
  vec2 p = gl_FragCoord.xy / uRes, d1 = uDir * 1.3846153846, d2 = uDir * 3.2307692308;
  o0 = texture(uA, p) * 0.2270270270 + (texture(uA, p + d1) + texture(uA, p - d1)) * 0.3162162162 + (texture(uA, p + d2) + texture(uA, p - d2)) * 0.0702702703;
  o1 = texture(uB, p) * 0.2270270270 + (texture(uB, p + d1) + texture(uB, p - d1)) * 0.3162162162 + (texture(uB, p + d2) + texture(uB, p - d2)) * 0.0702702703;
}
`;

const FN_CAPTURE = `${FN_COMMON}
out vec4 fragColor;
void main() { fragColor = scene(gl_FragCoord.xy / uRes); }
`;

// ── The renderer ─────────────────────────────────────────────────────────────

/**
 * A Finish renderer on its own WebGL2 canvas (made here unless one is given).
 *
 *   draw(input) → true when it drew (false: no WebGL2, or the context is lost)
 *     input = {
 *       finish, value(effect, key)     the stack, and a number now (a mapping may drive it)
 *       picture                        the shader's canvas, or { data, width, height } (RGBA, straight alpha, row 0 at the top)
 *       layers                         the layers' canvas, or null
 *       layerAlpha(id)                 a layer drawn alone (time displacement's Layer map), or null
 *       width, height, time            output size and the clock (seconds)
 *       first                          start the time ring over (an offline render's first frame)
 *       pixels                         with a `{ data }` picture: finish it in place (straight alpha), the canvas untouched
 *     }
 *   reset()    empty the time ring        dispose()  let go of the GPU
 *
 * The before/after wipe comes from `finish.compare` ({ on, pos, angle,
 * softness }, its numbers read through `value` under the id 'compare').
 * A custom effect whose code doesn't compile is left out (its error is in
 * info().custom[effectId]) and the rest of the stack still runs.
 */
export function fnCreate(canvasIn) {
  const canvas = canvasIn || (typeof document !== 'undefined' ? document.createElement('canvas') : null);
  const gl = canvas ? canvas.getContext('webgl2', { alpha: false, antialias: false, premultipliedAlpha: true, preserveDrawingBuffer: true, depth: false, stencil: false }) : null;
  if (!gl) return { ok: false, canvas, draw() { return false; }, reset() {}, dispose() {}, info() { return null; } };
  const floatGlow = !!gl.getExtension('EXT_color_buffer_float');
  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  const programs = new Map();
  let lastError = '';
  function compile(key, fs) {
    if (programs.has(key)) return programs.get(key);
    const sh = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { lastError = gl.getShaderInfoLog(s) || 'compile failed'; gl.deleteShader(s); return null; }
      return s;
    };
    const vs = sh(gl.VERTEX_SHADER, FN_VS), f = sh(gl.FRAGMENT_SHADER, fs);
    let prog = null;
    if (vs && f) {
      prog = gl.createProgram();
      gl.attachShader(prog, vs); gl.attachShader(prog, f);
      gl.bindAttribLocation(prog, 0, 'aPos');
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { lastError = gl.getProgramInfoLog(prog) || 'link failed'; gl.deleteProgram(prog); prog = null; }
    }
    const entry = prog ? { prog, locs: new Map() } : null;
    programs.set(key, entry);
    if (programs.size > 24) { const k0 = programs.keys().next().value; const e0 = programs.get(k0); if (e0) gl.deleteProgram(e0.prog); programs.delete(k0); }
    return entry;
  }
  const loc = (e, n) => { if (!e.locs.has(n)) e.locs.set(n, gl.getUniformLocation(e.prog, n)); return e.locs.get(n); };
  // Custom effects: each one's code compiled once on its own, so a broken one is left out instead of blanking the pass.
  const customChecked = new Map();
  function customError(e) {
    const code = String(e.code || '');
    if (customChecked.has(code)) return customChecked.get(code);
    let err = fnParseCustom(code).error;
    if (!err) {
      const before = lastError;
      lastError = '';
      const ok = compile('check:' + code, fnBuildFinal([Object.assign({}, e, { id: 'check' })]).src);
      err = ok ? '' : (fnCustomErrors(lastError, 0) || lastError || 'The code doesn’t compile.');
      lastError = before;
      if (ok) { gl.deleteProgram(ok.prog); programs.delete('check:' + code); }
    }
    if (customChecked.size > 64) customChecked.delete(customChecked.keys().next().value);
    customChecked.set(code, err);
    return err;
  }

  // Textures are made and filled on a unit no pass samples from, so a pass's bindings are never disturbed.
  const scratch = () => gl.activeTexture(gl.TEXTURE15);
  function makeTex(filter) {
    scratch();
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }
  const picTex = makeTex(gl.LINEAR), layTex = makeTex(gl.LINEAR), mapTex = makeTex(gl.LINEAR), lutTex = makeTex(gl.LINEAR), clearTex = makeTex(gl.NEAREST);
  gl.bindTexture(gl.TEXTURE_2D, clearTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
  let lutKey = '';

  // Render targets: glow levels (two attachments each) and the pixels-mode output.
  function target(w, h, count, float) {
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    const texs = [];
    for (let i = 0; i < count; i++) {
      const t = makeTex(gl.LINEAR);
      gl.texImage2D(gl.TEXTURE_2D, 0, float ? gl.RGBA16F : gl.RGBA8, w, h, 0, gl.RGBA, float ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE, null);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, t, 0);
      texs.push(t);
    }
    gl.drawBuffers(texs.map((_, i) => gl.COLOR_ATTACHMENT0 + i));
    return { fb, texs, w, h };
  }
  const dropTarget = t => { if (!t) return; gl.deleteFramebuffer(t.fb); for (const x of t.texs) gl.deleteTexture(x); };
  // The glow levels: a quarter (q), an eighth (e) and a sixteenth (g) of the frame, each blurred across (…t) then down (…b).
  const GLOW_LEVELS = ['q', 'qt', 'qb', 'et', 'eb', 'gt', 'gb'];
  let glowT = null;
  // Halation's half-size levels: its source (pre), the max-spread across (t) and then down (m).
  const HAL_LEVELS = ['pre', 't', 'm'];
  let halT = null;
  let outT = null;
  let ringT = null; // { key, tex, fb, w, h, ring }

  function upload(tex, src, premultiply, flip) {
    scratch();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, flip);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, premultiply);
    if (src && src.data) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, src.width, src.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, src.data);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  }
  const bindTex = (e, name, unit, tex, target2d = gl.TEXTURE_2D) => {
    const l = loc(e, name);
    if (l === null) return;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(target2d, tex);
    gl.uniform1i(l, unit);
  };
  const common = (e, W, H, input, srcW, srcH, pixelsMode) => {
    gl.uniform2f(loc(e, 'uRes'), W, H);
    gl.uniform2f(loc(e, 'uSrcRes'), srcW, srcH);
    gl.uniform1f(loc(e, 'uAspect'), srcW / Math.max(1, srcH));
    gl.uniform1f(loc(e, 'uTime'), input.time || 0);
    gl.uniform1f(loc(e, 'uInFlip'), pixelsMode ? 1 : 0);
    gl.uniform1f(loc(e, 'uStraightIn'), pixelsMode ? 1 : 0);
    bindTex(e, 'uPic', 0, picTex);
    bindTex(e, 'uLay', 1, input.layers && !pixelsMode ? layTex : clearTex);
  };
  const draw = (fb, w, h) => { gl.bindFramebuffer(gl.FRAMEBUFFER, fb); gl.viewport(0, 0, w, h); gl.bindVertexArray(vao); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); };
  const packed = (effect, value) => {
    const ps = FN_EFFECTS[effect.kind].params;
    const out = new Float32Array(Math.ceil(ps.length / 4) * 4);
    ps.forEach((p, i) => { const v = value ? value(effect, p.key) : effect[p.key]; out[i] = typeof v === 'number' && isFinite(v) ? v : p.value; });
    return out;
  };
  const packedCustom = (effect, value) => {
    const ps = fnParseCustom(effect.code).params;
    const out = new Float32Array(Math.max(1, Math.ceil(ps.length / 4)) * 4);
    ps.forEach((p, i) => { const v = value ? value(effect, p.key) : effect[p.key]; out[i] = typeof v === 'number' && isFinite(v) ? v : p.value; });
    return out;
  };

  function glowPasses(input, effects, W, H, pixelsMode, value) {
    const bloom = effects.find(e => e.kind === 'bloom'), hal = effects.find(e => e.kind === 'halation'), crt = effects.find(e => e.kind === 'crt');
    const qw = Math.max(1, Math.ceil(W / 4)), qh = Math.max(1, Math.ceil(H / 4)), ew = Math.max(1, Math.ceil(qw / 2)), eh = Math.max(1, Math.ceil(qh / 2)), gw = Math.max(1, Math.ceil(ew / 2)), gh = Math.max(1, Math.ceil(eh / 2));
    const key = `${qw}x${qh}`;
    if (!glowT || glowT.key !== key) {
      if (glowT) for (const k of GLOW_LEVELS) dropTarget(glowT[k]);
      const t = (w, h) => target(w, h, 2, floatGlow);
      glowT = { key, q: t(qw, qh), qt: t(qw, qh), qb: t(qw, qh), et: t(ew, eh), eb: t(ew, eh), gt: t(gw, gh), gb: t(gw, gh) };
    }
    const pk = `pre:${!!bloom}:${!!hal}:${!!crt}`;
    const pre = compile(pk, FN_PREFILTER(!!bloom, !!hal, !!crt && !bloom));
    if (!pre) return false;
    gl.useProgram(pre.prog);
    common(pre, qw, qh, input, W, H, pixelsMode);
    gl.uniform1f(loc(pre, 'uGlowFloat'), floatGlow ? 1 : 0);
    const bv = (k, d) => (bloom ? (value ? value(bloom, k) : bloom[k]) : d);
    const hv = (k, d) => (hal ? (value ? value(hal, k) : hal[k]) : d);
    gl.uniform4f(loc(pre, 'uBloom'), bv('threshold', 0.7), 0, 0, 0);
    gl.uniform4f(loc(pre, 'uHal'), hv('threshold', FN_HAL.threshold), hv('headroom', FN_HAL.headroom), FN_HAL.knee, 0);
    draw(glowT.q.fb, qw, qh);
    const blur = compile('blur', FN_BLUR);
    if (!blur) return false;
    gl.useProgram(blur.prog);
    // dx, dy: the step between taps, in texels of the texture read.
    const pass = (from, to, dx, dy) => {
      gl.uniform2f(loc(blur, 'uRes'), to.w, to.h);
      gl.uniform2f(loc(blur, 'uDir'), dx / from.w, dy / from.h);
      bindTex(blur, 'uA', 0, from.texs[0]); bindTex(blur, 'uB', 1, from.texs[1]);
      draw(to.fb, to.w, to.h);
    };
    const T = glowT;
    pass(T.q, T.qt, 1, 0); pass(T.qt, T.qb, 0, 1);
    pass(T.qb, T.et, 2, 0); pass(T.et, T.eb, 0, 1.5);
    pass(T.eb, T.gt, 2, 0); pass(T.gt, T.gb, 0, 1.5);
    if (hal) return halPasses(input, W, H, pixelsMode, hv);
    return true;
  }

  // Halation's tight bleed at half size: the largest source of each 2 × 2 block, then the max-spread across and down.
  function halPasses(input, W, H, pixelsMode, hv) {
    const hw = Math.max(1, Math.ceil(W / 2)), hh = Math.max(1, Math.ceil(H / 2));
    const key = `${hw}x${hh}`;
    if (!halT || halT.key !== key) {
      if (halT) for (const k of HAL_LEVELS) dropTarget(halT[k]);
      halT = { key, pre: target(hw, hh, 1, floatGlow), t: target(hw, hh, 1, floatGlow), m: target(hw, hh, 1, floatGlow) };
    }
    const pre = compile('halpre', FN_HAL_PRE);
    if (!pre) return false;
    gl.useProgram(pre.prog);
    common(pre, hw, hh, input, W, H, pixelsMode);
    gl.uniform1f(loc(pre, 'uGlowFloat'), floatGlow ? 1 : 0);
    gl.uniform4f(loc(pre, 'uHal'), hv('threshold', FN_HAL.threshold), hv('headroom', FN_HAL.headroom), FN_HAL.knee, 0);
    draw(halT.pre.fb, hw, hh);
    const mx = compile('halmax', FN_HAL_MAX);
    if (!mx) return false;
    gl.useProgram(mx.prog);
    gl.uniform1f(loc(mx, 'uGlowFloat'), floatGlow ? 1 : 0);
    // σ in half-size texels: FN_HAL.sigma px of a 1080-line picture, scaled with this one.
    gl.uniform1f(loc(mx, 'uSigma'), FN_HAL.sigma * (H / 1080) / 2);
    const pass = (from, to, dx, dy) => {
      gl.uniform2f(loc(mx, 'uRes'), to.w, to.h);
      gl.uniform2f(loc(mx, 'uDir'), dx / from.w, dy / from.h);
      bindTex(mx, 'uA', 0, from.texs[0]);
      draw(to.fb, to.w, to.h);
    };
    pass(halT.pre, halT.t, 1, 0); pass(halT.t, halT.m, 0, 1);
    return true;
  }

  function ensureRing(effect, W, H) {
    const size = fnRingSize(effect.quality, W, H);
    const key = `${size.frames}:${size.w}x${size.h}`;
    if (ringT && ringT.key === key) return ringT;
    if (ringT) { gl.deleteTexture(ringT.tex); gl.deleteFramebuffer(ringT.fb); }
    scratch();
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RGBA8, size.w, size.h, size.frames);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    ringT = { key, tex, fb: gl.createFramebuffer(), w: size.w, h: size.h, ring: fnRing(size.frames), bytes: size.bytes };
    return ringT;
  }

  let lastInfo = null;
  function drawFrame(input) {
    if (gl.isContextLost()) return false;
    const customErr = {};
    const effects = fnRunning(input.finish).filter(e => {
      if (e.kind !== 'custom') return true;
      const err = customError(e);
      if (err) customErr[e.id] = err;
      return !err;
    });
    if (!effects.length) { lastInfo = { effects: [], glow: false, floatGlow, ring: null, custom: customErr }; return false; }
    const pixelsMode = !!(input.pixels && input.picture && input.picture.data);
    const W = Math.max(1, Math.round(input.width)), H = Math.max(1, Math.round(input.height));
    const value = input.value || null;
    if (!pixelsMode && (canvas.width !== W || canvas.height !== H)) { canvas.width = W; canvas.height = H; }
    // Sources.
    if (!input.picture) return false;
    upload(picTex, input.picture, !pixelsMode, !pixelsMode);
    if (input.layers && !pixelsMode) upload(layTex, input.layers, true, true);
    const grade = effects.find(e => e.kind === 'grade'), time = effects.find(e => e.kind === 'time');
    if (grade) {
      const k = JSON.stringify(grade.curves || null);
      if (k !== lutKey) { lutKey = k; scratch(); gl.bindTexture(gl.TEXTURE_2D, lutTex); gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 2, 0, gl.RGBA, gl.UNSIGNED_BYTE, fnBakeLut(grade.curves)); }
    }
    const opts = { tone: grade ? grade.tone || 'none' : 'none', curves: !!(grade && !fnCurvesNeutral(grade.curves)), hueCurves: !!(grade && fnHueCurvesUsed(grade.curves)), timeMap: time ? time.map || 'slit' : 'slit' };
    const keyFor = list => 'final:' + list.map(e => (e.kind === 'custom' ? 'custom:' + e.code : e.kind)).join(',') + `|${opts.tone}|${opts.curves}|${opts.hueCurves}|${opts.timeMap}`;
    let built = fnBuildFinal(effects, opts);
    let fin = compile(keyFor(effects), built.src);
    if (!fin && built.custom.length) {
      // Each custom effect compiled alone but not together: run the stack without them.
      for (const e of effects) if (e.kind === 'custom') customErr[e.id] = customErr[e.id] || 'It doesn’t compile together with the rest of the stack (a name used twice?).';
      const plain = effects.filter(e => e.kind !== 'custom');
      if (!plain.length) return false;
      built = fnBuildFinal(plain, opts);
      fin = compile(keyFor(plain), built.src);
    }
    if (!fin) return false;
    const ran = built.custom.length ? effects : effects.filter(e => e.kind !== 'custom');
    if (built.glow && !glowPasses(input, effects, W, H, pixelsMode, value)) return false;
    let ring = null;
    if (time) {
      ring = ensureRing(time, W, H);
      if (input.first) ring.ring.reset();
      if (time.map === 'layer' && input.layerAlpha) {
        const m = time.layerId ? input.layerAlpha(time.layerId) : null;
        if (m) upload(mapTex, m, false, true); else { scratch(); gl.bindTexture(gl.TEXTURE_2D, mapTex); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4)); }
      }
    }
    if (pixelsMode && (!outT || outT.w !== W || outT.h !== H)) { dropTarget(outT); outT = target(W, H, 1, false); }
    // The final pass.
    gl.useProgram(fin.prog);
    common(fin, W, H, input, W, H, pixelsMode);
    let ci = 0;
    for (const e of ran) {
      if (e.kind === 'custom') { const l = loc(fin, `U_cx${ci++}`); if (l) gl.uniform4fv(l, packedCustom(e, value)); continue; }
      const l = loc(fin, `U_${e.kind}`); if (l) gl.uniform4fv(l, packed(e, value));
    }
    gl.uniform1f(loc(fin, 'uOutFlip'), pixelsMode ? 1 : 0);
    gl.uniform1f(loc(fin, 'uLive'), pixelsMode ? 0 : 1);
    const cmp = input.finish.compare;
    if (cmp && cmp.on) {
      const host = Object.assign({ id: FN_COMPARE_ID, kind: 'compare', enabled: true }, cmp);
      const cv = (k, d) => { const v = value ? value(host, k) : cmp[k]; return typeof v === 'number' && isFinite(v) ? v : d; };
      gl.uniform4f(loc(fin, 'uWipe'), 1, Math.max(0, Math.min(1, cv('pos', 0.5))), cv('angle', 0), Math.max(0, Math.min(1, cv('softness', 0))));
    } else gl.uniform4f(loc(fin, 'uWipe'), 0, 0.5, 0, 0);
    let unit = 2;
    if (grade) bindTex(fin, 'uLut', unit++, lutTex);
    if (built.glow) {
      gl.uniform1f(loc(fin, 'uGlowFloat'), floatGlow ? 1 : 0);
      bindTex(fin, 'uQ0', unit++, glowT.qb.texs[0]); bindTex(fin, 'uQ1', unit++, glowT.qb.texs[1]);
      bindTex(fin, 'uE0', unit++, glowT.eb.texs[0]); bindTex(fin, 'uE1', unit++, glowT.eb.texs[1]);
      bindTex(fin, 'uG0', unit++, glowT.gb.texs[0]); bindTex(fin, 'uG1', unit++, glowT.gb.texs[1]);
      if (halT && effects.some(e => e.kind === 'halation')) bindTex(fin, 'uHM', unit++, halT.m.texs[0]);
    }
    if (ring) {
      bindTex(fin, 'uRing', unit++, ring.tex, gl.TEXTURE_2D_ARRAY);
      gl.uniform1f(loc(fin, 'uRingSize'), ring.ring.size);
      gl.uniform1f(loc(fin, 'uRingHead'), Math.max(0, ring.ring.head));
      gl.uniform1f(loc(fin, 'uRingCount'), ring.ring.count);
      if (time.map === 'layer') bindTex(fin, 'uMap', unit++, mapTex);
    }
    draw(pixelsMode ? outT.fb : null, W, H);
    if (pixelsMode) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, outT.fb);
      gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, input.picture.data);
    }
    // This frame into the ring, for the frames after it.
    if (ring) {
      const cap = compile('capture', FN_CAPTURE);
      if (cap) {
        gl.useProgram(cap.prog);
        common(cap, ring.w, ring.h, input, W, H, pixelsMode);
        gl.bindFramebuffer(gl.FRAMEBUFFER, ring.fb);
        gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, ring.tex, 0, ring.ring.slotForWrite());
        gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
        gl.viewport(0, 0, ring.w, ring.h);
        gl.bindVertexArray(vao);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        ring.ring.push();
      }
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    lastInfo = { effects: ran.map(e => e.kind), glow: built.glow, floatGlow, ring: ring ? { frames: ring.ring.size, w: ring.w, h: ring.h, bytes: ring.bytes, count: ring.ring.count } : null, custom: customErr };
    return true;
  }

  return {
    ok: true,
    canvas,
    draw(input) { try { return drawFrame(input); } catch (e) { lastError = String(e && e.message || e); return false; } },
    reset() { if (ringT) ringT.ring.reset(); },
    info() { return lastInfo ? Object.assign({ error: lastError }, lastInfo) : { error: lastError }; },
    error() { return lastError; },
    dispose() {
      for (const e of programs.values()) if (e) gl.deleteProgram(e.prog);
      programs.clear();
      if (glowT) for (const k of GLOW_LEVELS) dropTarget(glowT[k]);
      if (halT) for (const k of HAL_LEVELS) dropTarget(halT[k]);
      dropTarget(outT);
      if (ringT) { gl.deleteTexture(ringT.tex); gl.deleteFramebuffer(ringT.fb); }
      const lose = gl.getExtension('WEBGL_lose_context');
      if (lose) lose.loseContext();
    },
  };
}

let fnChecker = null;
/**
 * Does a custom effect's code compile? '' when it does, else its errors with
 * the snippet's own line numbers. Compiled on a small WebGL2 context of its
 * own (made on first use); without WebGL2 only the parse is checked.
 */
export function fnCheckCustom(code) {
  const parsed = fnParseCustom(code);
  if (parsed.error) return parsed.error;
  if (typeof document === 'undefined') return '';
  if (!fnChecker) {
    const c = document.createElement('canvas');
    c.width = c.height = 1;
    fnChecker = { gl: c.getContext('webgl2'), cache: new Map() };
  }
  const { gl, cache } = fnChecker;
  if (!gl || gl.isContextLost()) return '';
  if (cache.has(code)) return cache.get(code);
  const s = gl.createShader(gl.FRAGMENT_SHADER);
  gl.shaderSource(s, fnBuildFinal([{ id: 'check', kind: 'custom', enabled: true, code }]).src);
  gl.compileShader(s);
  const log = gl.getShaderParameter(s, gl.COMPILE_STATUS) ? '' : (gl.getShaderInfoLog(s) || 'The code doesn’t compile.');
  gl.deleteShader(s);
  const err = log ? (fnCustomErrors(log, 0) || log.trim()) : '';
  if (cache.size > 64) cache.delete(cache.keys().next().value);
  cache.set(code, err);
  return err;
}
