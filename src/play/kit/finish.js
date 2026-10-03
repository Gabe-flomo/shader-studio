/**
 * finish.js — the Finish stack: colour grading, lens and screen effects,
 * film effects, camera shake and time displacement over the FINAL picture
 * (the shader with its layers on top), for the app (play/overlay.ts) and web
 * exports (play/runtime/play-runtime.js, through exportHtml.ts, which inlines
 * the kit files into one closure: every top-level name here starts `fn`/`FN_`).
 *
 * One pass does the work: a fragment shader built from the stack (only the
 * effects that are on, in the stack's order) reads the picture and the layers
 * as two textures and writes the finished frame. An effect that reads around
 * each point after the effects above it (FN_STAGE_KINDS: pixel sort,
 * halftone, ASCII) starts a pass of its own over the one before (fnSegments).
 * Three more things only run when an effect asks for them:
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
    colours: [{ label: 'Colour', keys: ['colorR', 'colorG', 'colorB'], hint: 'Black darkens; any colour tints the edges instead.' }],
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
    colours: [{ label: 'Tint', keys: ['tintR', 'tintG', 'tintB'], hint: 'The glow’s colour: white keeps the colours of what glows.' }],
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
  // The effects below came with the "TouchDesigner-style" pass (docs/finish-stack.md, "Warps,
  // glitches and feedback"): each is one more block of the same single pass, except Feedback,
  // which reads the last finished frame back (one copy of the output a frame).
  glitch: {
    label: 'Glitch', group: 'Glitch', icon: 'bolt',
    summary: 'Blocks that jump sideways, torn scanlines, split colour',
    params: [
      FN_P('amount', 'Amount', 0, 1, 0.01, 0.5, 'How much of the picture glitches at once.'),
      FN_P('blocks', 'Blocks', 2, 64, 1, 12, 'How many rows of blocks the picture is cut into (each twice as wide as it is tall).'),
      FN_P('speed', 'Speed', 0, 30, 0.5, 8, 'How often the glitch changes, a second. 0 holds it still.'),
      FN_P('split', 'Colour split', 0, 1, 0.01, 0.4, 'Red and blue pulled apart sideways, row by row.'),
      FN_P('tear', 'Tear', 0, 1, 0.01, 0.3, 'Thin bands of scanlines torn sideways, like a bad tape.'),
      FN_P('colour', 'Colour blocks', 0, 1, 0.01, 0.25, 'Some blocks swap their colour channels.'),
    ],
    presets: [
      { name: 'Subtle', values: { amount: 0.15, blocks: 24, speed: 4, split: 0.25, tear: 0.15, colour: 0 } },
      { name: 'Broken', values: { amount: 0.5, blocks: 12, speed: 8, split: 0.4, tear: 0.3, colour: 0.25 } },
      { name: 'Meltdown', values: { amount: 0.95, blocks: 6, speed: 14, split: 1, tear: 0.8, colour: 0.7 } },
    ],
  },
  ripple: {
    label: 'Ripple', group: 'Warp', icon: 'target',
    summary: 'Rings of waves spreading from a point',
    params: [
      FN_P('amount', 'Amount', 0, 1, 0.01, 0.3, 'How far the waves push the picture.'),
      FN_P('wavelength', 'Wavelength', 0.01, 0.5, 0.005, 0.08, 'The distance between rings, in picture heights.'),
      FN_P('speed', 'Speed', -4, 4, 0.05, 1, 'Rings a second, outward (negative: inward).'),
      FN_P('decay', 'Fade out', 0, 10, 0.1, 2, 'How quickly the waves die away from the centre.'),
      FN_P('cx', 'Centre X', 0, 1, 0.01, 0.5, 'Where the rings start. Map a hand or the pointer onto it.'),
      FN_P('cy', 'Centre Y', 0, 1, 0.01, 0.5, 'Where the rings start.'),
    ],
  },
  displace: {
    label: 'Displace', group: 'Warp', icon: 'curve',
    summary: 'Pushes the picture around by a map: noise, brightness, a layer or motion',
    params: [
      FN_P('amount', 'Amount', 0, 1, 0.01, 0.3, 'How far the picture is pushed.'),
      FN_P('angle', 'Direction', 0, 360, 1, 0, 'Brightness, layer and motion maps: which way the push goes.'),
      FN_P('scale', 'Scale', 0.5, 20, 0.1, 4, 'Noise map: the size of the ripples (larger = finer).'),
      FN_P('speed', 'Speed', 0, 2, 0.01, 0.3, 'Noise map: how fast it drifts, like heat haze.'),
    ],
    // For the Noise map (the default): the other maps don't use Scale or Speed.
    presets: [
      { name: 'Liquid', values: { amount: 0.3, scale: 4, speed: 0.3 } },
      { name: 'Heat haze', values: { amount: 0.1, scale: 14, speed: 1.5 } },
      { name: 'Marble', values: { amount: 1, scale: 1.2, speed: 0.08 } },
    ],
  },
  mosaic: {
    label: 'Mosaic', group: 'Warp', icon: 'grid',
    summary: 'Big square pixels',
    params: [
      FN_P('cells', 'Cells', 2, 200, 1, 40, 'How many cells fit down the picture.'),
    ],
  },
  mirror: {
    label: 'Mirror / kaleidoscope', group: 'Warp', icon: 'bidir',
    summary: 'Folds the picture: a mirror, or a kaleidoscope of wedges',
    params: [
      FN_P('segments', 'Segments', 1, 16, 1, 1, '1 mirrors one half onto the other; 2 and up make a kaleidoscope with that many mirrored wedges.'),
      FN_P('angle', 'Angle', 0, 360, 1, 90, 'Turns the mirror line (or the wedges) around the centre.'),
      FN_P('cx', 'Centre X', 0, 1, 0.01, 0.5, 'The fold’s centre.'),
      FN_P('cy', 'Centre Y', 0, 1, 0.01, 0.5, 'The fold’s centre.'),
      FN_P('spin', 'Spin', -1, 1, 0.01, 0, 'Turns the picture under the mirrors, in turns a second: the pattern keeps changing. 0 holds it.'),
      FN_P('zoom', 'Zoom', 0.25, 4, 0.01, 1, 'Closer in (right) or further out (left), where the picture repeats as mirrored tiles.'),
    ],
    presets: [
      { name: 'Mirror', values: { segments: 1, angle: 90, spin: 0, zoom: 1 } },
      { name: 'Mandala', values: { segments: 6, angle: 90, spin: 0.04, zoom: 1.2 } },
      { name: 'Crystal', values: { segments: 12, angle: 0, spin: -0.08, zoom: 0.6 } },
      { name: 'Butterfly', values: { segments: 2, angle: 90, spin: 0.02, zoom: 1.4 } },
    ],
  },
  gradmap: {
    label: 'Gradient map', group: 'Colour', icon: 'sliders',
    summary: 'Brightness becomes a three-colour gradient',
    params: [
      FN_P('amount', 'Amount', 0, 1, 0.01, 1, 'How much of the gradient shows over the picture.'),
      FN_P('mid', 'Midpoint', 0, 1, 0.01, 0.5, 'The brightness that gets the middle colour.'),
      FN_P('lowR', 'Shadows R', 0, 1, 0.01, 0.06, '', true), FN_P('lowG', 'Shadows G', 0, 1, 0.01, 0.02, '', true), FN_P('lowB', 'Shadows B', 0, 1, 0.01, 0.22, '', true),
      FN_P('midR', 'Midtones R', 0, 1, 0.01, 0.86, '', true), FN_P('midG', 'Midtones G', 0, 1, 0.01, 0.2, '', true), FN_P('midB', 'Midtones B', 0, 1, 0.01, 0.46, '', true),
      FN_P('highR', 'Highlights R', 0, 1, 0.01, 1, '', true), FN_P('highG', 'Highlights G', 0, 1, 0.01, 0.9, '', true), FN_P('highB', 'Highlights B', 0, 1, 0.01, 0.56, '', true),
    ],
    colours: [
      { label: 'Shadows', keys: ['lowR', 'lowG', 'lowB'] },
      { label: 'Midtones', keys: ['midR', 'midG', 'midB'] },
      { label: 'Highlights', keys: ['highR', 'highG', 'highB'] },
    ],
  },
  posterize: {
    label: 'Posterize', group: 'Stylise', icon: 'layers',
    summary: 'A few flat levels of colour, with dither',
    params: [
      FN_P('levels', 'Levels', 2, 32, 1, 5, 'How many steps each colour channel has.'),
      FN_P('dither', 'Dither', 0, 1, 0.01, 0.5, 'An ordered pattern that blends neighbouring steps, like old games.'),
      FN_P('colour', 'Colour', 0, 1, 0.01, 1, '1 keeps the picture’s colours; 0 maps its brightness between the Dark and Light palette colours.'),
      FN_P('darkR', 'Dark R', 0, 1, 0.01, 0.06, '', true), FN_P('darkG', 'Dark G', 0, 1, 0.01, 0.05, '', true), FN_P('darkB', 'Dark B', 0, 1, 0.01, 0.16, '', true),
      FN_P('lightR', 'Light R', 0, 1, 0.01, 1, '', true), FN_P('lightG', 'Light G', 0, 1, 0.01, 0.85, '', true), FN_P('lightB', 'Light B', 0, 1, 0.01, 0.6, '', true),
    ],
    colours: [
      { label: 'Dark', keys: ['darkR', 'darkG', 'darkB'], hint: 'The palette’s darkest colour, when Colour is below 1.' },
      { label: 'Light', keys: ['lightR', 'lightG', 'lightB'], hint: 'The palette’s lightest colour, when Colour is below 1.' },
    ],
    presets: [
      { name: 'Poster', values: { levels: 5, dither: 0.5, colour: 1 } },
      { name: 'Retro PC', values: { levels: 4, dither: 1, colour: 1 } },
      { name: 'Handheld', values: { levels: 4, dither: 0.8, colour: 0, darkR: 0.06, darkG: 0.22, darkB: 0.06, lightR: 0.61, lightG: 0.74, lightB: 0.06 } },
      { name: '1-bit', values: { levels: 2, dither: 1, colour: 0, darkR: 0, darkG: 0, darkB: 0, lightR: 1, lightG: 1, lightB: 1 } },
      { name: 'Sunset duo', values: { levels: 6, dither: 1, colour: 0, darkR: 0.12, darkG: 0.04, darkB: 0.24, lightR: 1, lightG: 0.62, lightB: 0.36 } },
    ],
    note: 'For chunky pixels, put a Mosaic above it.',
  },
  edges: {
    label: 'Edges', group: 'Stylise', icon: 'edit',
    summary: 'Outlines where the brightness changes',
    params: [
      FN_P('amount', 'Amount', 0, 1, 0.01, 1, 'How strongly the outlines show.'),
      FN_P('width', 'Width', 0.5, 6, 0.1, 1.5, 'Outline width, in pixels.'),
      FN_P('threshold', 'Threshold', 0, 1, 0.01, 0.1, 'How sharp a change has to be to count as an edge.'),
      FN_P('only', 'Edges only', 0, 1, 0.01, 0, '1 shows only the outlines, on black.'),
      FN_P('colorR', 'Colour R', 0, 1, 0.01, 1, '', true), FN_P('colorG', 'Colour G', 0, 1, 0.01, 1, '', true), FN_P('colorB', 'Colour B', 0, 1, 0.01, 1, '', true),
      FN_P('glow', 'Glow', 0, 2, 0.01, 0, 'A soft halo around the outlines, like neon tubes.'),
      FN_P('rainbow', 'Rainbow', 0, 1, 0.01, 0, 'Colours the outlines by their direction, cycling slowly, instead of the one colour.'),
    ],
    colours: [{ label: 'Colour', keys: ['colorR', 'colorG', 'colorB'], hint: 'The outline’s colour.' }],
    presets: [
      { name: 'Chalk', values: { amount: 1, width: 1.5, threshold: 0.1, only: 0, colorR: 1, colorG: 1, colorB: 1, glow: 0, rainbow: 0 } },
      { name: 'Neon', values: { amount: 1, width: 1.5, threshold: 0.06, only: 0.85, colorR: 0.2, colorG: 1, colorB: 0.9, glow: 1, rainbow: 0.35 } },
      { name: 'Ink outline', values: { amount: 1, width: 1, threshold: 0.08, only: 0, colorR: 0, colorG: 0, colorB: 0, glow: 0, rainbow: 0 } },
      { name: 'Laser', values: { amount: 1, width: 2.5, threshold: 0.05, only: 1, colorR: 1, colorG: 0.1, colorB: 0.3, glow: 1.6, rainbow: 1 } },
    ],
  },
  // Feedback and Echo are temporal effects (FN_TEMPORAL_KINDS): each keeps its own frames, of its Source
  // (the picture as the effects above left it, a layer, the moving or the bright parts), and lays them
  // under (or over) the live picture, which stays sharp.
  feedback: {
    label: 'Feedback', group: 'Time', icon: 'loop',
    summary: 'Trails that fade behind what moves; zoomed or turned, tunnels and spirals',
    params: [
      FN_P('amount', 'Trail', 0, 0.99, 0.01, 0.85, 'How much of the trail stays each frame: higher leaves longer trails. They always fade out completely.'),
      FN_P('zoom', 'Zoom', -0.1, 0.1, 0.001, 0, 'The trail grows (or shrinks) a little each frame: a tunnel. 0 leaves trails where things were.'),
      FN_P('rotate', 'Rotate', -10, 10, 0.1, 0, 'Degrees the trail turns each frame: a spiral.'),
      FN_P('shiftX', 'Drift X', -0.05, 0.05, 0.001, 0, 'How far the trail drifts each frame, across.'),
      FN_P('shiftY', 'Drift Y', -0.05, 0.05, 0.001, 0, 'How far the trail drifts each frame, up.'),
      FN_P('hue', 'Hue drift', -0.1, 0.1, 0.001, 0, 'The trail’s colour turns a little each frame (in turns of the colour wheel).'),
      FN_P('mode', 'Blend', 0, 4, 1, 0, '0 lighten, 1 screen, 2 blend (a smear), 3 add, 4 over (the trail behind the source, the live picture on top).', true),
    ],
    presets: [
      { name: 'Ghost trail', values: { amount: 0.85, zoom: 0, rotate: 0, shiftX: 0, shiftY: 0, hue: 0, mode: 0 } },
      { name: 'Tunnel', values: { amount: 0.94, zoom: 0.02, rotate: 0.75, shiftX: 0, shiftY: 0, hue: 0.025, mode: 0 } },
      { name: 'Spiral', values: { amount: 0.92, zoom: -0.012, rotate: 2.1, shiftX: 0, shiftY: 0, hue: -0.02, mode: 0 } },
      { name: 'Smear', values: { amount: 0.8, zoom: 0, rotate: 0, shiftX: 0, shiftY: 0, hue: 0, mode: 2 } },
    ],
  },
  echo: {
    label: 'Echo', group: 'Time', icon: 'layers',
    summary: 'Sharp copies of the last few moments, fading behind what moves',
    params: [
      FN_P('time', 'Echo time', 1, 30, 1, 4, 'Frames between one copy and the next.'),
      FN_P('count', 'Echoes', 1, 8, 1, 3, 'How many copies. Echo time × Echoes is at most 30 frames back.'),
      FN_P('start', 'Starting intensity', 0, 1, 0.01, 0.8, 'How strong the newest copy is.'),
      FN_P('decay', 'Decay', 0, 1, 0.01, 0.6, 'Each older copy is this much as strong as the one after it.'),
      FN_P('mode', 'Operator', 0, 4, 1, 0, '0 lighten, 1 add, 2 screen, 3 behind (the copies under the source), 4 in front (the copies over it).', true),
      FN_P('strobe', 'Strobe', 0, 1, 1, 0, 'The copies hold still and jump on every Echo time, instead of following smoothly.'),
    ],
    presets: [
      { name: 'Echo', values: { time: 4, count: 3, start: 0.8, decay: 0.6, mode: 0, strobe: 0 } },
      { name: 'Ghost trail', values: { time: 2, count: 8, start: 0.6, decay: 0.75, mode: 0, strobe: 0 } },
      { name: 'Strobe echo', values: { time: 6, count: 4, start: 0.9, decay: 0.7, mode: 4, strobe: 1 } },
    ],
  },
  // Pixel sort, Halftone and ASCII read the picture around each point (a run of pixels, a cell's
  // centre), so each starts a pass of its own (FN_STAGE_KINDS, fnSegments) and sees every effect above it.
  pixelsort: {
    label: 'Pixel sort', group: 'Glitch', icon: 'sliders',
    summary: 'Bright runs of pixels stretched into sorted streaks',
    params: [
      FN_P('threshold', 'Threshold', 0, 1, 0.01, 0.45, 'Only parts brighter than this are sorted: lower sorts more of the picture.'),
      FN_P('length', 'Length', 0, 1, 0.01, 0.35, 'The longest a streak can be, as a share of the picture’s height.'),
      FN_P('angle', 'Direction', 0, 360, 1, 270, 'Which way the streaks run (270 = falling down, 0 = to the right).'),
      FN_P('amount', 'Amount', 0, 1, 0.01, 1, 'How much of the sorted picture shows.'),
    ],
    presets: [
      { name: 'Drip', values: { threshold: 0.45, length: 0.35, angle: 270, amount: 1 } },
      { name: 'Sideways', values: { threshold: 0.3, length: 0.6, angle: 0, amount: 1 } },
      { name: 'Melt', values: { threshold: 0.15, length: 0.8, angle: 270, amount: 1 } },
    ],
  },
  halftone: {
    label: 'Halftone', group: 'Stylise', icon: 'grid',
    summary: 'Printed dots: newsprint black or four-colour CMYK',
    params: [
      FN_P('size', 'Dot size', 2, 60, 0.5, 9, 'The dot spacing, in pixels of a 1080p picture.'),
      FN_P('angle', 'Angle', 0, 90, 1, 45, 'The screen’s angle. The colour screens keep their offsets from it, as print does.'),
      FN_P('colour', 'Colour', 0, 1, 0.01, 1, '0 is black ink only (newsprint), 1 is cyan, magenta, yellow and black dots.'),
      FN_P('amount', 'Amount', 0, 1, 0.01, 1, 'How much of the print shows over the picture.'),
      FN_P('paperR', 'Paper R', 0, 1, 0.01, 0.97, '', true), FN_P('paperG', 'Paper G', 0, 1, 0.01, 0.95, '', true), FN_P('paperB', 'Paper B', 0, 1, 0.01, 0.9, '', true),
    ],
    colours: [{ label: 'Paper', keys: ['paperR', 'paperG', 'paperB'], hint: 'The colour the dots are printed on.' }],
    presets: [
      { name: 'Comic', values: { size: 9, angle: 45, colour: 1, amount: 1, paperR: 0.97, paperG: 0.95, paperB: 0.9 } },
      { name: 'Newsprint', values: { size: 6, angle: 45, colour: 0, amount: 1, paperR: 0.9, paperG: 0.88, paperB: 0.82 } },
      { name: 'Pop art', values: { size: 22, angle: 15, colour: 1, amount: 1, paperR: 1, paperG: 1, paperB: 1 } },
    ],
  },
  ascii: {
    label: 'ASCII', group: 'Stylise', icon: 'text',
    summary: 'The picture drawn in text characters',
    params: [
      FN_P('size', 'Character size', 4, 48, 0.5, 12, 'Height of a character cell, in pixels of a 1080p picture.'),
      FN_P('colour', 'Colour', 0, 1, 0.01, 1, '1 colours each character from the picture; 0 uses the ink colour (a terminal).'),
      FN_P('background', 'Background', 0, 1, 0.01, 0.12, 'How much of the picture shows dimly behind the characters.'),
      FN_P('contrast', 'Contrast', 0, 1, 0.01, 0.4, 'Spreads the picture across more of the characters, from sparse dots to dense blocks.'),
      FN_P('inkR', 'Ink R', 0, 1, 0.01, 0.3, '', true), FN_P('inkG', 'Ink G', 0, 1, 0.01, 1, '', true), FN_P('inkB', 'Ink B', 0, 1, 0.01, 0.5, '', true),
    ],
    colours: [{ label: 'Ink', keys: ['inkR', 'inkG', 'inkB'], hint: 'The characters’ colour when Colour is below 1.' }],
    presets: [
      { name: 'Colour', values: { size: 12, colour: 1, background: 0.12, contrast: 0.4 } },
      { name: 'Terminal', values: { size: 10, colour: 0, background: 0, contrast: 0.5, inkR: 0.3, inkG: 1, inkB: 0.5 } },
      { name: 'Big type', values: { size: 28, colour: 1, background: 0.3, contrast: 0.3 } },
    ],
  },
  leaks: {
    label: 'Light leaks', group: 'Film', icon: 'sun',
    summary: 'Warm light washing in from the edges, drifting slowly',
    params: [
      FN_P('amount', 'Amount', 0, 1, 0.01, 0.6, 'How bright the leaks are.'),
      FN_P('hue', 'Hue', 0, 360, 1, 22, 'Their colour: orange by default; 330 is a magenta leak, 200 a cool one.'),
      FN_P('size', 'Size', 0, 1, 0.01, 0.55, 'Small flares at the edges (left) or broad washes (right).'),
      FN_P('speed', 'Speed', 0, 2, 0.01, 0.3, 'How fast they drift. 0 holds them.'),
    ],
    presets: [
      { name: 'Warm', values: { amount: 0.6, hue: 22, size: 0.55, speed: 0.3 } },
      { name: 'Rose', values: { amount: 0.55, hue: 335, size: 0.7, speed: 0.2 } },
      { name: 'Burn', values: { amount: 1, hue: 12, size: 0.85, speed: 0.6 } },
    ],
  },
  // Temporal effects (FN_TEMPORAL_KINDS): each keeps frames of its own between draws and starts a pass of its
  // own, so it works on the picture as the effects above it left it. A render starts them empty on its first frame.
  datamosh: {
    label: 'Datamosh', group: 'Glitch', icon: 'grid',
    summary: 'Movement drags old pixels around in blocks, like a video with its keyframes cut out',
    params: [
      FN_P('amount', 'Amount', 0, 1, 0.01, 1, 'How much of the moshed picture shows over the live one.'),
      FN_P('bleed', 'Bleed', 0, 1, 0.01, 0.06, 'How much of each frame’s new detail gets through. 0 only drags the old pixels around; 1 is a clean picture (nothing goes wrong).'),
      FN_P('block', 'Block size', 8, 96, 1, 24, 'The size of the blocks that move together, in pixels of a 1080p picture. A video codec’s are 16.'),
      FN_P('push', 'Push', 0, 3, 0.01, 1, 'How far each block moves for the movement it sees: above 1 smears faster than things move.'),
      FN_P('sustain', 'Sustain', 0, 0.98, 0.01, 0.6, 'How much a block keeps moving after the movement stops (the classic “bloom” swell). 0 stops at once.'),
      FN_P('refresh', 'Refresh', 0, 1, 0.01, 0, 'How quickly the picture heals back to the live one, each frame. 0 never does.'),
      FN_P('every', 'Keyframe every', 0, 8, 0.05, 0, 'Snaps back to the live picture every so many seconds (a keyframe). 0 never does.'),
      FN_P('hold', 'Mosh', 0, 1, 1, 0, 'While on, nothing heals: no Refresh and no keyframes. Map a key or a rule’s signal onto it to mosh on cue.'),
    ],
    presets: [
      { name: 'Bloom', values: { amount: 1, bleed: 0.06, block: 24, push: 1, sustain: 0.6, refresh: 0, every: 0 } },
      { name: 'Melt', values: { amount: 1, bleed: 0, block: 12, push: 1.4, sustain: 0.9, refresh: 0, every: 0 } },
      { name: 'Blocky', values: { amount: 1, bleed: 0.15, block: 64, push: 1, sustain: 0.4, refresh: 0.02, every: 0 } },
      { name: 'Pulse', values: { amount: 1, bleed: 0.04, block: 32, push: 1.2, sustain: 0.75, refresh: 0, every: 1 } },
      { name: 'On cue', values: { amount: 1, bleed: 0.05, block: 24, push: 1, sustain: 0.7, refresh: 0.6, every: 0 } },
    ],
  },
  motionx: {
    label: 'Motion extract', group: 'Time', icon: 'eye',
    summary: 'Only what moves shows: the frame, inverted, over one from a moment ago',
    params: [
      FN_P('delay', 'Delay', 1, 30, 1, 3, 'How many frames ago the copy is from: longer catches slower movement and draws thicker outlines.'),
      FN_P('gain', 'Gain', 0, 8, 0.01, 1, 'Contrast of the movement: 1 is the plain trick, higher shows small movements.'),
      FN_P('colour', 'Colour', 0, 2, 0.01, 1, '0 is grey, 1 the picture’s own colour shifts, 2 more vivid.'),
      FN_P('background', 'On black', 0, 1, 0.01, 0, '0 is the classic mid-grey (still parts cancel to grey), 1 is black (only how much changed).'),
      FN_P('edges', 'Edges', 0, 1, 0.01, 0, 'Sharpens the outlines: movement along the picture’s own edges shows more, inside flat areas less.'),
      FN_P('neon', 'Neon', 0, 1, 0.01, 0, 'Two-tone: what arrives glows cyan, what leaves glows magenta.'),
      FN_P('amount', 'Amount', 0, 1, 0.01, 1, 'How much of it shows over the picture.'),
    ],
    presets: [
      { name: 'Classic grey', values: { delay: 3, gain: 1, colour: 1, background: 0, edges: 0, neon: 0, amount: 1 } },
      { name: 'On black', values: { delay: 2, gain: 3, colour: 1, background: 1, edges: 0.3, neon: 0, amount: 1 } },
      { name: 'Neon motion', values: { delay: 4, gain: 5, colour: 1.4, background: 1, edges: 0.7, neon: 0.85, amount: 1 } },
    ],
    note: 'Still parts cancel out to grey (or black), so only what moves shows, as outlines. Try it over a Camera or a Video layer.',
  },
};

/**
 * Effects that read the picture around each point, after the effects above them. Each starts a pass
 * of its own (fnSegments) that reads the pass before as a texture, so a Grade then Halftone prints
 * the graded colours. (Edges and a Brightness map read the picture as it came in, so they stay in
 * whatever pass they're in.)
 */
export const FN_STAGE_KINDS = ['pixelsort', 'halftone', 'ascii'];
/**
 * Effects that keep frames of their own between draws (Feedback's trail, Echo's and Motion extract's
 * past frames, Datamosh's held picture). Each also starts a pass of its own (fnSegments), always at its
 * head, so what it keeps is the picture as the effects above it left it: the pass before (or the
 * picture, first in the stack).
 */
export const FN_TEMPORAL_KINDS = ['feedback', 'echo', 'datamosh', 'motionx'];
/**
 * What Feedback and Echo keep (their Source): the picture as the effects above left it, one layer
 * (drawn alone, hidden or not: only its own trail, over the untouched picture), the parts that moved
 * since the frame before, or the bright parts. Absent = the picture, as before.
 */
export const FN_SOURCE_MAPS = ['picture', 'layer', 'moving', 'bright'];
/** A Feedback or Echo effect's Source ('picture' when absent or odd). */
export function fnSourceOf(e) {
  return e && FN_SOURCE_MAPS.includes(e.map) ? e.map : 'picture';
}
/** What Datamosh's movement is measured on: the picture itself, or a layer drawn alone (a Camera layer, hidden or not). */
export const FN_MOSH_MAPS = ['picture', 'layer'];

/** Running effects split into passes: a new one at each FN_STAGE_KINDS or FN_TEMPORAL_KINDS effect (unless it is first). */
export function fnSegments(effects) {
  const out = [];
  for (const e of effects) {
    if (!out.length || ((FN_STAGE_KINDS.includes(e.kind) || FN_TEMPORAL_KINDS.includes(e.kind)) && out[out.length - 1].length)) out.push([]);
    out[out.length - 1].push(e);
  }
  return out;
}

/**
 * Halation presets for the card (they only set the sliders). Classic cine is
 * the reference's own measurement; Subtle and Strong sit either side of it.
 */
export const FN_HALATION_PRESETS = [
  { name: 'Subtle', values: { amount: 0.6, reach: 0.3, threshold: -0.9, headroom: 5, warmth: 0.15, growth: 0.1, conserve: 0.03 } },
  { name: 'Classic cine', values: { amount: FN_HAL.amount, reach: FN_HAL.reach, threshold: FN_HAL.threshold, headroom: FN_HAL.headroom, warmth: FN_HAL.warmth, growth: FN_HAL.growth, conserve: FN_HAL.conserve } },
  { name: 'Strong', values: { amount: 1.6, reach: 0.8, threshold: -1.5, headroom: 8, warmth: 0.35, growth: 0.5, conserve: 0.15 } },
];
FN_EFFECTS.halation.presets = FN_HALATION_PRESETS;

/** The kinds in the Add menu's order. Each kind appears at most once in a stack. */
export const FN_KINDS = ['grade', 'lens', 'chroma', 'vignette', 'crt', 'bloom', 'halation', 'grain', 'flicker', 'shake', 'time',
  'glitch', 'ripple', 'displace', 'mosaic', 'mirror', 'gradmap', 'posterize', 'edges', 'feedback', 'echo', 'pixelsort', 'halftone', 'ascii', 'leaks',
  'datamosh', 'motionx'];
export const FN_TONE_MODES = ['none', 'aces', 'agx', 'hable', 'reinhard2', 'unreal', 'lottes', 'uchimura', 'tanh', 'oklab'];
export const FN_TIME_MAPS = ['slit', 'luma', 'noise', 'radial', 'layer'];
/**
 * Where an effect shows (every effect, custom ones too): everywhere, or weighted by a map (0..1)
 * read at each point of the picture: a layer's alpha (the layer drawn alone, hidden or not), the
 * picture's own brightness, or where the camera sees movement (the kit's motion map). `whereInvert`
 * swaps in and out. Absent = everywhere, so older records are unchanged.
 */
export const FN_WHERE = ['all', 'layer', 'picture', 'motion'];
/** What pushes the picture in Displace. */
export const FN_DISPLACE_MAPS = ['noise', 'picture', 'layer', 'motion'];
/** The most map textures (layers drawn alone, the motion map) one pass reads. */
export const FN_MAP_MAX = 4;
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
  if (kind === 'displace') { e.map = 'noise'; e.layerId = ''; }
  if (kind === 'datamosh' || kind === 'feedback' || kind === 'echo') { e.map = 'picture'; e.layerId = ''; }
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
  return fnRunning(finish).some(e => (e.kind === 'grain' && e.fps > 0) || e.kind === 'shake' || e.kind === 'flicker' || e.kind === 'time' || (e.kind === 'crt' && e.pulse > 0) || (e.kind === 'custom' && /\btime\b/.test(e.code))
    || (e.kind === 'glitch' && e.speed > 0 && e.amount > 0) || (e.kind === 'ripple' && e.speed !== 0) || (e.kind === 'displace' && (e.map === 'motion' || ((e.map || 'noise') === 'noise' && e.speed > 0)))
    || e.kind === 'feedback' || FN_TEMPORAL_KINDS.includes(e.kind) || fnWhereOf(e) === 'motion'
    || (e.kind === 'mirror' && (+e.spin || 0) !== 0) || (e.kind === 'edges' && e.rainbow > 0) || (e.kind === 'leaks' && e.speed > 0 && e.amount > 0));
}

// ── Maps: what an effect's Where (and Displace, and Time's Layer map) reads ────

/** An effect's Where ('all' when absent or odd). */
export function fnWhereOf(e) {
  const w = e && e.where;
  return w === 'layer' || w === 'picture' || w === 'motion' ? w : 'all';
}
function fnMapKey(kind, layerId) {
  if (kind === 'motion') return 'motion';
  return kind === 'layer' && typeof layerId === 'string' && layerId ? 'layer:' + layerId : null;
}
/**
 * The map textures a list of running effects reads, in a fixed order (the pass names them uM0..):
 * 'layer:<id>' (that layer drawn alone, its alpha) and 'motion' (the camera's motion map). At most
 * FN_MAP_MAX; an effect whose map didn't fit reads nothing there (0).
 */
export function fnMapKeys(effects) {
  const keys = [];
  const add = k => { if (k && !keys.includes(k) && keys.length < FN_MAP_MAX) keys.push(k); };
  for (const e of effects) {
    if (e.kind === 'time' && e.map === 'layer') add(fnMapKey('layer', e.layerId));
    if (e.kind === 'displace') add(fnMapKey(e.map, e.layerId));
    if ((e.kind === 'datamosh' || e.kind === 'feedback' || e.kind === 'echo') && e.map === 'layer') add(fnMapKey('layer', e.layerId));
    add(fnMapKey(fnWhereOf(e), e.whereLayer));
  }
  return keys;
}
/** The layers a stack reads drawn alone (the host asks the kit for them: env.alphaLayers). */
export function fnMapLayers(finish) {
  return fnMapKeys(fnRunning(finish)).filter(k => k.startsWith('layer:')).map(k => k.slice(6));
}
/** Does the stack read the camera's motion map (so the kit keeps one)? */
export function fnUsesMotion(finish) {
  return fnMapKeys(fnRunning(finish)).includes('motion');
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
export const FN_CUSTOM_RESERVED = ['id', 'kind', 'enabled', 'name', 'code', 'defId', 'sealed', 'source', 'look', 'tone', 'curves', 'map', 'layerId', 'quality', 'where', 'whereLayer', 'whereInvert', 'uv', 'color', 'effect', 'picture', 'px', 'time', 'resolution', 'aspect', 'main'];
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

// ── Datamosh and Motion extract (the temporal effects) ───────────────────────

/** Motion is measured on a copy at this fraction of the frame's size (a quarter: 480 × 270 for 1080p). */
export const FN_MOSH_LOW = 4;
/** The farthest a block's match is looked for, each frame, in quarter-size pixels (±60 px of the full frame). */
export const FN_MOSH_REACH = 15;
/**
 * Datamosh's grid at a frame size: the quarter-size copy motion is measured on (lowW × lowH), a block's
 * side there (bl, whole quarter-size pixels, at least 2) and in the frame (px), and how many blocks
 * across and down (gw × gh). `block` is in pixels of a 1080-line picture, scaled with this one.
 */
export function fnMoshGrid(block, W, H) {
  const lowW = Math.max(1, Math.ceil(W / FN_MOSH_LOW)), lowH = Math.max(1, Math.ceil(H / FN_MOSH_LOW));
  const bl = Math.max(2, Math.round((+block || 24) * (H / 1080) / FN_MOSH_LOW));
  return { lowW, lowH, bl, px: bl * W / lowW, gw: Math.ceil(lowW / bl), gh: Math.ceil(lowH / bl) };
}
/**
 * Datamosh's keyframes: every `every` seconds (0 never) the held picture snaps back to the live one.
 * `last` is the keyframe count at the frame before (-1 before the first frame). Returns this frame's
 * count and whether it is a keyframe. Driven by the clock, so a render's keyframes land on the same frames.
 */
export function fnMoshKeyframe(every, time, last) {
  if (!(every > 0)) return { idx: -1, key: false };
  const idx = Math.floor(Math.max(0, time) / every + 1e-6);
  return { idx, key: last >= 0 && idx !== last };
}
/** A motion vector (quarter-size pixels, ±64) as 16 bits a channel pair, the way the vector texture keeps it (RGBA8). */
export function fnMoshEncode(v) {
  return v.map(c => { const u = Math.round(Math.max(0, Math.min(1, (c + 64) / 128)) * 65535); return [Math.floor(u / 256), u % 256]; }).flat();
}
export function fnMoshDecode(b) {
  return [0, 2].map(i => (b[i] * 256 + b[i + 1]) / 65535 * 128 - 64);
}

/**
 * Echo's copies this frame: how many frames back each one is (index 0 is now: 1), Echo time apart, and
 * the deepest frame read. With Strobe they hold still between steps (the newest copy is the last frame
 * on a multiple of Echo time). Never more than FN_ECHO_MAX_DELAY frames back: fewer copies when Echo
 * time × Echoes would go past it. `n`: frames drawn since the start (1 on the first). `moving` (the
 * Moving parts source) reads the frame before each copy too.
 */
export function fnEchoPlan(time, count, strobe, n, moving = false) {
  const t = Math.max(1, Math.min(FN_ECHO_MAX_DELAY, Math.round(+time || 1)));
  const off = strobe ? Math.max(0, (Math.max(1, n | 0) - 1) % t) : 0;
  const room = FN_ECHO_MAX_DELAY - off - (moving ? 1 : 0);
  const k = Math.max(0, Math.min(8, Math.max(1, Math.round(+count || 1)), Math.floor(room / t)));
  const backs = [1];
  for (let i = 1; i <= k; i++) backs.push(1 + off + i * t);
  return { backs, deepest: backs[backs.length - 1] + (moving ? 1 : 0) };
}

/** How far back Motion extract and Echo reach (frames); a ring keeps the next power of two above what it needs, 4 to 32 frames. */
export const FN_ECHO_MAX_DELAY = 30;
/** The most graphics memory Motion extract's ring takes; past it the frames are kept smaller. */
export const FN_ECHO_CAP = 64e6;
/** Echo's: more, as its copies are shown as they are (a smaller ring would soften them). */
export const FN_ECHO_COPIES_CAP = 128e6;
/**
 * A ring of past frames (Motion extract's, Echo's) reaching `delay` frames back, at a frame size: enough
 * frames (4, 8, 16 or 32; never fewer than `have`, so mapping a number back and forth doesn't start the
 * ring over), at the frame's size unless that passes `cap` bytes. Motion extract compares two frames
 * from the ring, so a smaller ring still cancels still parts exactly.
 */
export function fnEchoRingSize(delay, W, H, have = 0, cap = FN_ECHO_CAP) {
  const need = Math.min(FN_ECHO_MAX_DELAY, Math.max(1, Math.round(+delay || 1))) + 1;
  let frames = 4;
  while (frames < need) frames *= 2;
  frames = Math.min(32, Math.max(frames, have | 0));
  const s = Math.min(1, Math.sqrt(cap / (frames * Math.max(1, W) * Math.max(1, H) * 4)));
  const w = Math.max(1, Math.floor(W * s)), h = Math.max(1, Math.floor(H * s));
  return { frames, w, h, bytes: frames * w * h * 4 };
}
/**
 * One pixel of Motion extract (the shader's maths, without Edges): `now` and `then` (RGB 0..1, the frame
 * and the one Delay frames before). The classic trick, the frame inverted at 50 % over the old one, is
 * 0.5 + (then − now) / 2: still parts are mid-grey. On black it is |then − now|.
 */
export function fnEchoPixel(now, then, p = {}) {
  const v = k => (typeof p[k] === 'number' ? p[k] : FN_EFFECTS.motionx.params.find(x => x.key === k).value);
  let d = [0, 1, 2].map(i => (then[i] - now[i]) * v('gain'));
  const l = fnLuma(d), col = v('colour');
  d = d.map(x => l + (x - l) * col);
  // Neon: what arrives (brighter now than then) cyan, what leaves magenta, by how much the brightness changed.
  const tone = l < 0 ? [0.1, 0.95, 1] : [1, 0.15, 0.85];
  d = d.map((x, i) => fnMix(x, tone[i] * l * 1.6, v('neon')));
  const out = d.map(x => fnMix(0.5 + 0.5 * x, Math.abs(x), v('background')));
  return out.map(x => fnClamp01(x));
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
vec3 fnHueC(float h) { return clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0); }
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


/** Map for time displacement: 0 = now, 1 = the most frames back. `mapRead` reads its Layer map (a uM sampler), or null. */
function fnTimeMapGlsl(map, mapRead) {
  switch (map) {
    case 'luma': return 'float fnTimeMap(vec2 q) { return fnLuma(scene(q).rgb); }';
    case 'noise': return 'float fnTimeMap(vec2 q) { vec2 s = q * vec2(uAspect, 1.0) * time_scale; return clamp(fnNoise(vec3(s, uTime * time_speed)) * 1.2 - 0.1, 0.0, 1.0); }';
    case 'radial': return 'float fnTimeMap(vec2 q) { return clamp(length((q - vec2(time_cx, time_cy)) * vec2(uAspect, 1.0)) / (0.5 * length(vec2(uAspect, 1.0))), 0.0, 1.0); }';
    case 'layer': return `float fnTimeMap(vec2 q) { return ${mapRead ? mapRead('q') : '0.0'}; }`;
    default: return 'float fnTimeMap(vec2 q) { float a = radians(time_angle); vec2 d = vec2(cos(a), sin(a)); vec2 v = (q - 0.5) * vec2(uAspect, 1.0); float e = 0.5 * (abs(d.x) * uAspect + abs(d.y)); return clamp(dot(v, d) / max(e, 1e-4) * 0.5 + 0.5, 0.0, 1.0); }';
  }
}

/** A 4 × 4 ordered-dither threshold (0..1) at a pixel, and a hue turn (in turns) for Feedback's drift. */
const FN_HELPERS = `
float fnBayer(vec2 px) {
  const float m[16] = float[16](0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
  ivec2 i = ivec2(mod(floor(px), 4.0));
  return (m[i.x + i.y * 4] + 0.5) / 16.0;
}
vec3 fnHueTurn(vec3 c, float t) {
  const mat3 toYiq = mat3(0.299, 0.596, 0.211, 0.587, -0.274, -0.523, 0.114, -0.322, 0.312);
  const mat3 fromYiq = mat3(1.0, 1.0, 1.0, 0.956, -0.272, -1.106, 0.621, -0.647, 1.703);
  vec3 y = toYiq * c;
  float a = t * 6.2831853;
  y.yz = mat2(cos(a), sin(a), -sin(a), cos(a)) * y.yz;
  return fromYiq * y;
}
`;

/**
 * ASCII's characters, darkest first: 5 × 5 bitmaps, bit (column + 5 × row),
 * row 0 at the bottom. ' ', '.', ':', '-', '+', 'o', '%', '#', '*', '@'.
 */
export const FN_ASCII_GLYPHS = [0, 4, 131200, 14336, 145536, 476718, 20288345, 11512810, 22511061, 15652782];

/** Helpers a pass's stage effects need (`kinds`: the pass's own). They read around a point with fnRead. */
function fnStageGlsl(kinds) {
  let g = '';
  if (kinds.includes('halftone')) g += `// One screen of a halftone: the centre (pixels) of the cell P is in, at angle ang, and P from that centre.
vec2 fnHtCell(vec2 P, float ang, float sz, out vec2 local) {
  float cs = cos(ang), sn = sin(ang);
  vec2 r = vec2(cs * P.x + sn * P.y, -sn * P.x + cs * P.y);
  vec2 cc = (floor(r / sz) + 0.5) * sz;
  local = r - cc;
  return vec2(cs * cc.x - sn * cc.y, sn * cc.x + cs * cc.y);
}
// A dot's cover at a point: area grows with the ink, with a pixel of smoothing.
float fnHtDot(float ink, vec2 local, float sz) { float r = sqrt(clamp(ink, 0.0, 1.0)) * sz * 0.72; return clamp(r - length(local) + 0.5, 0.0, 1.0) * step(0.004, ink); }
vec4 fnCmyk(vec3 c) { float k = 1.0 - max(c.r, max(c.g, c.b)); return vec4((1.0 - c - k) / max(1.0 - k, 1e-4), k); }
float fnHtInk(vec2 P, float ang, float sz, int ch) {
  vec2 l; vec2 cc = fnHtCell(P, ang, sz, l);
  vec4 k = fnCmyk(fnRead(cc / uRes));
  return fnHtDot(ch == 0 ? k.x : ch == 1 ? k.y : ch == 2 ? k.z : k.w, l, sz);
}
`;
  if (kinds.includes('ascii')) g += `const int FN_GLYPHS[${FN_ASCII_GLYPHS.length}] = int[${FN_ASCII_GLYPHS.length}](${FN_ASCII_GLYPHS.join(', ')});
// Is the point l (0..1 in a cell) on glyph g's 5 × 5 bitmap (with a column and a row of space)?
float fnGlyph(int g, vec2 l) {
  ivec2 b = ivec2(floor(l * 6.0)) - ivec2(1, 1);
  if (b.x < 0 || b.y < 0 || b.x > 4 || b.y > 4) return 0.0;
  return float((FN_GLYPHS[g] >> (b.x + 5 * b.y)) & 1);
}
`;
  return g;
}

/**
 * The stage effects' colour steps. `c` is the colour so far, `gQ` the point read (after any bending,
 * in the first pass), and fnRead(uv) the colour the pass reads elsewhere: the pass before, or in the
 * first pass the picture as sampled there.
 */
const FN_STAGE_OPS = {
  pixelsort: `{
    // Each line along the direction is cut into intervals (staggered and of varied length per line, so
    // neighbouring lines streak differently). In each, the samples brighter than the threshold are
    // sorted by brightness, dark to bright, into the bright places; the dark ones stay where they are.
    float thr = pixelsort_threshold;
    if (fnLuma(c) >= thr && pixelsort_amount > 0.0) {
      float an = radians(pixelsort_angle);
      vec2 dir = vec2(cos(an), sin(an)), nrm = vec2(-dir.y, dir.x);
      vec2 P = gQ * uRes;
      float along = dot(P, dir), across = floor(dot(P, nrm));
      float Ls = max(8.0, pixelsort_length * uRes.y) * (0.45 + 0.55 * fnHash(vec3(across, 3.1, 7.7)));
      float t = fract((along + fnHash(vec3(across, 9.2, 1.3)) * Ls) / Ls);
      vec2 P0 = P - dir * t * Ls;
      const int M = 24;
      float lum[M]; vec3 col[M];
      float tpos = t * float(M) - 0.5, cnt = 0.0;
      int nb = 0;
      for (int i = 0; i < M; i++) {
        col[i] = fnRead((P0 + dir * (float(i) + 0.5) / float(M) * Ls) / uRes);
        lum[i] = fnLuma(col[i]);
        if (lum[i] >= thr) { nb++; if (float(i) < tpos) cnt += 1.0; }
      }
      if (nb > 1) {
        float kf = clamp(cnt - 1.0 + fract(tpos), 0.0, float(nb - 1));
        int k0 = int(kf), k1 = min(k0 + 1, nb - 1);
        vec3 s0 = c, s1 = c;
        for (int i = 0; i < M; i++) {
          if (lum[i] < thr) continue;
          int r = 0;
          for (int j = 0; j < M; j++) if (lum[j] >= thr && (lum[j] < lum[i] || (lum[j] == lum[i] && j < i))) r++;
          if (r == k0) s0 = col[i];
          if (r == k1) s1 = col[i];
        }
        c = mix(c, mix(s0, s1, fract(kf)), pixelsort_amount);
      }
    }
  }`,
  halftone: `{
    float sz = max(2.0, halftone_size * uRes.y / 1080.0);
    vec2 P = gQ * uRes;
    float a0 = radians(halftone_angle);
    vec3 paper = vec3(halftone_paperR, halftone_paperG, halftone_paperB);
    vec2 l; vec2 cc = fnHtCell(P, a0, sz, l);
    vec3 mono = paper * (1.0 - 0.92 * fnHtDot(1.0 - fnLuma(fnRead(cc / uRes)), l, sz));
    vec3 cmyk = paper;
    if (halftone_colour > 0.0) {
      cmyk *= mix(vec3(1.0), vec3(0.0, 0.68, 0.94), fnHtInk(P, a0 - 0.5236, sz, 0));
      cmyk *= mix(vec3(1.0), vec3(0.93, 0.0, 0.55), fnHtInk(P, a0 + 0.5236, sz, 1));
      cmyk *= mix(vec3(1.0), vec3(1.0, 0.93, 0.0), fnHtInk(P, a0 - 0.7854, sz, 2));
      cmyk *= mix(vec3(1.0), vec3(0.08), fnHtInk(P, a0, sz, 3));
    }
    c = mix(c, mix(mono, cmyk, halftone_colour), halftone_amount);
  }`,
  ascii: `{
    float cell = max(4.0, ascii_size * uRes.y / 1080.0);
    vec2 P = gQ * uRes;
    vec2 ci = floor(P / cell);
    vec3 src = fnRead((ci + 0.5) * cell / uRes);
    float L = fnLuma(src);
    float g = clamp((L - 0.5) * (1.0 + ascii_contrast * 2.0) + 0.5 + ascii_contrast * 0.1, 0.0, 1.0);
    int gi = int(clamp(floor(g * ${FN_ASCII_GLYPHS.length}.0), 0.0, ${FN_ASCII_GLYPHS.length - 1}.0));
    float on = fnGlyph(gi, fract(P / cell));
    float mx = max(src.r, max(src.g, src.b));
    vec3 lit = src / max(mx, 1e-3) * (0.55 + 0.45 * smoothstep(0.0, 0.6, mx));
    vec3 ink = mix(vec3(ascii_inkR, ascii_inkG, ascii_inkB) * (0.45 + 0.55 * g), lit, ascii_colour);
    c = mix(src * ascii_background, ink, on);
  }`,
};

/**
 * The final pass for the effects that run (see fnRunning), as GLSL. `opts`:
 * { tone, hueCurves, timeMap, floatGlow }. Also returns what it needs:
 * { src, glow, time, lut, feedback, maps } (`maps`: fnMapKeys, the uM samplers in order).
 *
 * An effect with a Where (fnWhereOf) other than everywhere is mixed in by its map's weight at the
 * point: a warp moves `q` only that much, a colour step changes `c` only that much, a colour split
 * splits only that much, and Time displacement looks back only that far.
 *
 * A stack with a stage effect (FN_STAGE_KINDS) runs as several passes (fnSegments); `opts.segment`
 * picks one. The first bends and samples the picture (every warp, split and Time displacement in
 * the stack happen there); later ones read the pass before as `uStage`; only the last draws the
 * wipe. Each pass runs its own effects' colour steps. Also returns `segments` (how many passes).
 */
export function fnBuildFinal(effects, opts = {}) {
  const segs = fnSegments(effects);
  const si = Math.max(0, Math.min(segs.length - 1, opts.segment | 0));
  const first = si === 0, last = si === segs.length - 1;
  const mine = segs[si] || [];
  const kinds = effects.map(e => e.kind);
  const own = mine.map(e => e.kind);
  const has = k => own.includes(k);
  const glow = has('bloom') || has('halation') || (has('crt'));
  const time = first && kinds.includes('time');
  const feedback = has('feedback');
  const stage = own.some(k => FN_STAGE_KINDS.includes(k));
  const maps = fnMapKeys(effects);
  // Reads map `key` at the point `p` (a GLSL expression), 0 when the map isn't there.
  const mapRead = key => {
    const i = key ? maps.indexOf(key) : -1;
    return i < 0 ? null : p => `fnM${i}(${p})`;
  };
  let src = FN_COMMON;
  for (const k of kinds) if (FN_EFFECTS[k]) src += fnDefines(k);
  src += `uniform float uOutFlip, uLive;\nuniform vec4 uWipe;\nout vec4 fragColor;\nvec2 gPx;\nfloat gEdge = 1.0;\n`;
  if (stage) src += 'vec2 gQ, gP;\n';
  // The picture's own brightness (straight colour) at a point: the Brightness map, Displace and Edges.
  src += 'float fnPicLuma(vec2 p) { vec4 s = scene(p); return s.a > 1e-5 ? fnLuma(s.rgb / s.a) : 0.0; }\n';
  // The map textures: a layer drawn alone (its alpha) or the motion map (its brightness).
  maps.forEach((k, i) => { src += `uniform sampler2D uM${i};\nfloat fnM${i}(vec2 p) { return texture(uM${i}, p).${k === 'motion' ? 'r' : 'a'}; }\n`; });
  if (has('posterize') || feedback) src += FN_HELPERS;
  // The temporal effects' own frames (drawn by the renderer before this pass: see fnCreate's temporalPass).
  const mosh = has('datamosh'), mx = has('motionx'), echo = has('echo');
  if (feedback) {
    const fe = mine.find(e => e.kind === 'feedback');
    src += '// Feedback: its history before this frame (uFbPrev) and after it (uFbNow), its Source now and the frame before (raw), and whether it had a history.\n'
      + 'uniform sampler2D uFbPrev, uFbNow, uFbRaw, uFbRawPrev;\nuniform float uFbOn;\n' + fnSourceMaskGlsl(fnSourceOf(fe), 'fnFbMask') + FN_FB_TRAIL;
  }
  if (echo) {
    const ee = mine.find(e => e.kind === 'echo');
    src += '// Echo: the ring of its Source\'s past frames; for each copy (0 = now) the layer holding it and the frame before that one, and how many copies there are yet.\n'
      + 'uniform sampler2DArray uEcR;\nuniform float uEcL[9], uEcM[9];\nuniform float uEcN;\n' + fnSourceMaskGlsl(fnSourceOf(ee), 'fnEcMask')
      + 'vec4 fnEcAt(vec2 q, int k) { return fnEcMask(texture(uEcR, vec3(q, uEcL[k])), texture(uEcR, vec3(q, uEcM[k]))); }\n';
  }
  if (mosh) src += '// Datamosh: the held picture, moved block by block this frame (premultiplied).\nuniform sampler2D uMosh;\n';
  if (mx) src += '// Motion extract: the ring of past frames, the layers holding now and Delay frames ago, and its size.\nuniform sampler2DArray uMxRing;\nuniform vec2 uMxAt, uMxTex;\n';
  // Each masked effect's weight at a point: its map (or 0 when the map is missing), maybe inverted.
  const weight = new Map();
  effects.forEach((e, i) => {
    const w = fnWhereOf(e);
    if (w === 'all') return;
    const read = w === 'picture' ? (p => `fnPicLuma(${p})`) : mapRead(fnMapKey(w, e.whereLayer));
    const m = read ? read('p') : '0.0';
    src += `float fnW${i}(vec2 p) { float m = clamp(${m}, 0.0, 1.0); return ${e.whereInvert ? '1.0 - m' : 'm'}; }\n`;
    weight.set(e, `fnW${i}`);
  });
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
    const te = effects.find(e => e.kind === 'time');
    const tw = weight.get(te);
    src += `uniform sampler2DArray uRing;\nuniform float uRingSize, uRingHead, uRingCount;\n${fnTimeMapGlsl(opts.timeMap, mapRead(fnMapKey('layer', te.layerId)))}\n`;
    src += `vec4 fnRingAt(vec2 q, float back) { return texture(uRing, vec3(q, mod(uRingHead - (back - 1.0) + uRingSize * 4.0, uRingSize))); }
vec4 fetch(vec2 q) {
  float m = fnTimeMap(q); m = mix(m, 1.0 - m, time_invert);${tw ? `\n  m *= ${tw}(q);` : ''}
  float b = min(m * time_amount, uRingCount);
  if (b < 1e-3) return scene(q);
  float i0 = floor(b), f = b - i0;
  f = mix(step(0.5, f), f, time_smooth);
  vec4 a0 = i0 < 0.5 ? scene(q) : fnRingAt(q, i0);
  vec4 a1 = i0 + 1.0 <= uRingCount ? fnRingAt(q, i0 + 1.0) : a0;
  return mix(a0, a1, f);
}
`;
  } else if (first) src += 'vec4 fetch(vec2 q) { return scene(q); }\n';
  else src += '// The pass before (premultiplied).\nuniform sampler2D uStage;\nvec4 fetch(vec2 q) { return texture(uStage, q); }\n';
  // Custom effects: each its own function (in the stack's order), called with the colour so far.
  // Numbered across the whole stack, so each keeps its uniform's name in whichever pass it lands.
  const customs = effects.filter(e => e.kind === 'custom');
  const customCalls = new Map();
  if (customs.some(e => mine.includes(e))) {
    src += 'vec3 fnPicture(vec2 uv) { vec4 s = scene(uv); return s.a > 1e-5 ? s.rgb / s.a : vec3(0.0); }\n';
    customs.forEach((e, i) => { if (!mine.includes(e)) return; const st = fnCustomStage(e, i); src += st.glsl; customCalls.set(e, st.call); });
  }
  // Geometry: each effect bends where the picture is read. Applied last-first, so the stack's first effect bends the picture first. First pass only.
  const warps = [];
  const warp = (e, body) => {
    const w = weight.get(e);
    warps.push(w ? `{\n    vec2 q0 = q;\n    ${body}\n    q = mix(q0, q, ${w}(p));\n  }` : body);
  };
  for (const e of first ? effects : []) {
    const k = e.kind;
    if (k === 'shake') warp(e, `{
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
    if (k === 'lens') warp(e, `{
    vec2 v = (q - 0.5) * vec2(uAspect, 1.0);
    float r2 = dot(v, v) / (0.25 * (uAspect * uAspect + 1.0));
    float f = 1.0 + lens_distortion * 0.35 * r2 + lens_cubic * 0.2 * r2 * r2;
    float fc = 1.0 + lens_distortion * 0.35 + lens_cubic * 0.2;
    float z = mix(1.0, max(fc, 1.0), lens_fit);
    q = v * f / z / vec2(uAspect, 1.0) + 0.5;
  }`);
    if (k === 'crt') warp(e, `{
    vec2 v = q * 2.0 - 1.0;
    v += v * (v.yx * v.yx) * crt_curvature * 0.25;
    q = v * 0.5 + 0.5;
    vec2 e = smoothstep(vec2(0.0), vec2(0.004 + crt_curvature * 0.01), q) * smoothstep(vec2(0.0), vec2(0.004 + crt_curvature * 0.01), 1.0 - q);
    gEdge *= e.x * e.y;
  }`);
    if (k === 'glitch') warp(e, `{
    float s = floor(uTime * glitch_speed);
    vec2 cell = floor(vec2(q.x * glitch_blocks * 0.5, q.y * glitch_blocks));
    float hit = step(fnHash(vec3(cell, s)), glitch_amount * 0.35);
    q.x += hit * (fnHash(vec3(cell, s + 3.0)) - 0.5) * 0.25 * glitch_amount;
    float band = step(1.0 - glitch_tear * 0.25, fnHash(vec3(floor(q.y * 24.0), s, 7.0)));
    q.x += band * (fnNoise(vec3(q.y * 90.0, s * 0.37, 3.0)) - 0.5) * 0.08 * glitch_tear;
  }`);
    if (k === 'ripple') warp(e, `{
    vec2 v = (q - vec2(ripple_cx, ripple_cy)) * vec2(uAspect, 1.0);
    float r = length(v);
    float k = sin((r / max(ripple_wavelength, 1e-3) - uTime * ripple_speed) * 6.2831853) * exp(-r * ripple_decay);
    vec2 dir = r > 1e-5 ? v / r : vec2(0.0);
    q += dir * k * ripple_amount * 0.03 / vec2(uAspect, 1.0);
  }`);
    if (k === 'displace') {
      const map = FN_DISPLACE_MAPS.includes(e.map) ? e.map : 'noise';
      const read = map === 'picture' ? null : mapRead(fnMapKey(map, e.layerId));
      const d = map === 'noise'
        ? `vec2 s = q * vec2(uAspect, 1.0) * displace_scale;
    vec2 d = (vec2(fnNoise(vec3(s, uTime * displace_speed)), fnNoise(vec3(s + 17.3, uTime * displace_speed + 5.1))) - 0.5) * 2.0;`
        : `float a = radians(displace_angle);
    vec2 d = vec2(cos(a), sin(a)) * ${map === 'picture' ? '(fnPicLuma(q) - 0.5) * 2.0' : (read ? read('q') : '0.0')};`;
      warp(e, `{
    ${d}
    q += d * displace_amount * 0.08 / vec2(uAspect, 1.0);
  }`);
    }
    if (k === 'mosaic') warp(e, `{
    vec2 n = max(vec2(1.0), vec2(floor(mosaic_cells * uAspect + 0.5), mosaic_cells));
    q = (floor(q * n) + 0.5) / n;
  }`);
    if (k === 'mirror') warp(e, `{
    vec2 c0 = vec2(mirror_cx, mirror_cy);
    vec2 v = (q - c0) * vec2(uAspect, 1.0);
    float rot = radians(mirror_angle);
    float n = max(1.0, floor(mirror_segments + 0.5));
    if (n < 1.5) {
      vec2 nrm = vec2(-sin(rot), cos(rot));
      float sd = dot(v, nrm);
      if (sd < 0.0) v -= 2.0 * sd * nrm;
    } else {
      float seg = 6.2831853 / n;
      float a = mod(atan(v.y, v.x) - rot, seg);
      a = abs(a - seg * 0.5);
      v = length(v) * vec2(cos(a + rot), sin(a + rot));
    }
    if (mirror_spin != 0.0) { float sa = uTime * mirror_spin * 6.2831853; v = mat2(cos(sa), sin(sa), -sin(sa), cos(sa)) * v; }
    v /= max(mirror_zoom, 0.05);
    q = v / vec2(uAspect, 1.0) + c0;
    // Spun or zoomed, the picture repeats as mirrored tiles past its edges.
    if (mirror_spin != 0.0 || mirror_zoom != 1.0) q = 1.0 - abs(1.0 - mod(q, 2.0));
  }`);
  }
  // Colour: each effect in the stack's order.
  const ops = [];
  const op = (e, body) => {
    const w = weight.get(e);
    ops.push(w ? `{\n    vec3 c0 = c;\n    ${body}\n    c = mix(c0, c, ${w}(p));\n  }` : body);
  };
  for (const e of mine) {
    const k = e.kind;
    if (k === 'custom') op(e, customCalls.get(e));
    if (FN_STAGE_OPS[k]) op(e, FN_STAGE_OPS[k]);
    if (k === 'leaks') op(e, `{
    float t = uTime * leaks_speed;
    vec2 v = (p - 0.5) * vec2(uAspect, 1.0);
    vec3 add = vec3(0.0);
    for (int i = 0; i < 3; i++) {
      float fi = float(i);
      float ang = t * (0.21 + 0.07 * fi) + fi * 2.4 + 0.6 * sin(t * 0.31 + fi * 1.9);
      vec2 at = vec2(cos(ang) * (0.5 * uAspect + 0.1), sin(ang * 1.21 + fi) * 0.6);
      float rad = mix(0.22, 0.85, leaks_size) * (0.75 + 0.25 * sin(t * 0.53 + fi * 3.1));
      vec2 d = v - at;
      float w = exp(-dot(d, d) / (rad * rad));
      w *= 0.65 + 0.35 * fnNoise(vec3(v * 2.2, t * 0.4 + fi * 7.0));
      // Hotter (toward white and yellow) in the middle, redder at the fringe, as light through film's base is.
      vec3 col = fnHueC(fract(leaks_hue / 360.0 + (fi - 1.0) * 0.04 - (1.0 - w) * 0.05 + 1.0));
      add += mix(col, vec3(1.0, 0.95, 0.85), w * w * 0.35) * w * 1.4;
    }
    c = 1.0 - (1.0 - c) * (1.0 - clamp(add * leaks_amount, 0.0, 1.0));
  }`);
    if (k === 'datamosh') op(e, `{
    vec4 m = texture(uMosh, q);
    c = mix(c, m.a > 1e-5 ? m.rgb / m.a : vec3(0.0), datamosh_amount);
  }`);
    if (k === 'motionx') op(e, `{
    // The frame inverted at 50 % over the one Delay frames ago: 0.5 + (then - now) / 2, so still parts are mid-grey (fnEchoPixel).
    vec3 now = texture(uMxRing, vec3(q, uMxAt.x)).rgb, then = texture(uMxRing, vec3(q, uMxAt.y)).rgb;
    vec3 d = (then - now) * motionx_gain;
    if (motionx_edges > 0.0) {
      // Edges: movement along the picture's own edges (now or then) shows more, inside flat areas less.
      vec2 t = 1.5 / uMxTex;
      vec2 gN = vec2(fnLuma(texture(uMxRing, vec3(q + vec2(t.x, 0.0), uMxAt.x)).rgb - texture(uMxRing, vec3(q - vec2(t.x, 0.0), uMxAt.x)).rgb),
                     fnLuma(texture(uMxRing, vec3(q + vec2(0.0, t.y), uMxAt.x)).rgb - texture(uMxRing, vec3(q - vec2(0.0, t.y), uMxAt.x)).rgb));
      vec2 gT = vec2(fnLuma(texture(uMxRing, vec3(q + vec2(t.x, 0.0), uMxAt.y)).rgb - texture(uMxRing, vec3(q - vec2(t.x, 0.0), uMxAt.y)).rgb),
                     fnLuma(texture(uMxRing, vec3(q + vec2(0.0, t.y), uMxAt.y)).rgb - texture(uMxRing, vec3(q - vec2(0.0, t.y), uMxAt.y)).rgb));
      float ed = smoothstep(0.03, 0.35, max(length(gN), length(gT)));
      d *= mix(1.0, 0.2 + 2.2 * ed, motionx_edges);
    }
    float l = fnLuma(d);
    d = l + (d - l) * motionx_colour;
    // Neon: what arrives (brighter now) cyan, what leaves magenta.
    d = mix(d, (l < 0.0 ? vec3(0.1, 0.95, 1.0) : vec3(1.0, 0.15, 0.85)) * l * 1.6, motionx_neon);
    c = mix(c, clamp(mix(0.5 + 0.5 * d, abs(d), motionx_background), 0.0, 1.0), motionx_amount);
  }`);
    if (k === 'grade') op(e, 'c = fnGrade(c);');
    if (k === 'vignette') op(e, `{
    float rr = mix(1.0, uAspect, vignette_roundness);
    vec2 v = (p - 0.5) * vec2(rr, 1.0);
    float d = length(v) / length(vec2(rr, 1.0) * 0.5);
    float s0 = mix(0.2, 1.15, vignette_size);
    float w = smoothstep(s0 - vignette_feather * 0.8 - 1e-3, s0, d);
    c = mix(c, vec3(vignette_colorR, vignette_colorG, vignette_colorB), w * vignette_amount);
  }`);
    if (k === 'crt') op(e, `{
    float cell = crt_cell * uRes.y / 1080.0;
    vec3 m = crtMaskFn(gPx, max(cell, 1.0), 0.6 + 0.4 * crt_mask, crt_stagger, crt_scanlines);
    c *= mix(vec3(1.0), m, crt_mask);
    c *= 1.0 + crt_pulse * cos(gPx.x / (60.0 * uRes.y / 1080.0) + uTime * 20.0);
    vec3 g = glowDec(texture(uE0, p).rgb) * 0.6 + glowDec(texture(uQ0, p).rgb) * 0.4;
    c = toSrgb(toLin(c) + g * crt_glow * 0.8);
  }`);
    if (k === 'bloom') op(e, `{
    vec3 bq = glowDec(texture(uQ0, p).rgb), be = glowDec(texture(uE0, p).rgb), bg = glowDec(texture(uG0, p).rgb);
    vec3 b = (bloom_radius < 0.5 ? mix(bq, be, bloom_radius * 2.0) : mix(be, bg, bloom_radius * 2.0 - 1.0)) * vec3(bloom_tintR, bloom_tintG, bloom_tintB);
    vec3 x = toLin(c);
    c = toSrgb(x + (1.0 - x) * (1.0 - exp(-b * bloom_amount * 1.5)));
  }`);
    if (k === 'halation') op(e, `{
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
    if (k === 'grain') op(e, `{
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
    if (k === 'flicker') op(e, `{
    float t = uTime * flicker_speed;
    float n = mix(fnHash(vec3(floor(t), 1.0, 2.0)), fnHash(vec3(floor(t) + 1.0, 1.0, 2.0)), smoothstep(0.0, 1.0, fract(t)));
    c *= 1.0 + (n - 0.5) * flicker_amount * 0.5;
  }`);
    if (k === 'glitch') op(e, `{
    float s = floor(uTime * glitch_speed);
    vec2 cell = floor(vec2(p.x * glitch_blocks * 0.5, p.y * glitch_blocks));
    float swap = step(fnHash(vec3(cell, s + 11.0)), glitch_colour * glitch_amount * 0.3);
    c = mix(c, c.brg, swap);
  }`);
    if (k === 'gradmap') op(e, `{
    float L = clamp(fnLuma(c), 0.0, 1.0);
    float m = clamp(gradmap_mid, 0.02, 0.98);
    vec3 lo = vec3(gradmap_lowR, gradmap_lowG, gradmap_lowB), mi = vec3(gradmap_midR, gradmap_midG, gradmap_midB), hi = vec3(gradmap_highR, gradmap_highG, gradmap_highB);
    vec3 g = L < m ? mix(lo, mi, L / m) : mix(mi, hi, (L - m) / (1.0 - m));
    c = mix(c, g, gradmap_amount);
  }`);
    if (k === 'posterize') op(e, `{
    float lv = max(2.0, floor(posterize_levels + 0.5)) - 1.0;
    float b = (fnBayer(gPx) - 0.5) * posterize_dither;
    float tone = clamp(floor(clamp(fnLuma(c), 0.0, 1.0) * lv + 0.5 + b) / lv, 0.0, 1.0);
    c = clamp(floor(c * lv + 0.5 + b) / lv, 0.0, 1.0);
    if (posterize_colour < 1.0) c = mix(mix(vec3(posterize_darkR, posterize_darkG, posterize_darkB), vec3(posterize_lightR, posterize_lightG, posterize_lightB), tone), c, posterize_colour);
  }`);
    if (k === 'edges') op(e, `{
    vec2 o = vec2(edges_width) / uRes;
    float gx = fnPicLuma(q + vec2(o.x, 0.0)) - fnPicLuma(q - vec2(o.x, 0.0));
    float gy = fnPicLuma(q + vec2(0.0, o.y)) - fnPicLuma(q - vec2(0.0, o.y));
    float ed = smoothstep(edges_threshold, edges_threshold + 0.1, length(vec2(gx, gy)));
    vec3 ec = vec3(edges_colorR, edges_colorG, edges_colorB);
    // Rainbow: the line's colour by its direction, turning slowly.
    if (edges_rainbow > 0.0) ec = mix(ec, fnHueC(fract(atan(gy, gx) / 6.2831853 + uTime * 0.05 + 1.0)), edges_rainbow);
    // Glow: a soft halo, from brightness differences across four directions at four times the width.
    float halo = 0.0;
    if (edges_glow > 0.0) {
      for (int i = 0; i < 4; i++) { float an = float(i) * 0.7853982; vec2 d = vec2(cos(an), sin(an)) * o * 4.0; halo += abs(fnPicLuma(q + d) - fnPicLuma(q - d)); }
      halo = smoothstep(0.02, 0.8, halo * 0.5) * edges_glow * 0.6;
    }
    c = mix(mix(c, vec3(0.0), edges_only), ec, ed * edges_amount);
    c += ec * halo * edges_amount;
  }`);
    if (k === 'feedback') op(e, `{
    // The trail (the history before this frame, moved and faded) under the live picture, which stays sharp.
    float mode = floor(feedback_mode + 0.5);
    ivec2 iq = ivec2(clamp(floor(q * uRes), vec2(0.0), uRes - 1.0));
    if (mode > 1.5 && mode < 2.5) {
      // Blend: the smear itself (the source mixed into its own moved past), over the picture.
      vec4 h = texelFetch(uFbNow, iq, 0);
      c = c * (1.0 - clamp(h.a, 0.0, 1.0)) + h.rgb;
    } else {
      vec4 tr = max(fnFbTrail(q) * feedback_amount - ${FN_FB_FLOOR}, 0.0) * uFbOn;
      if (mode < 0.5) c = max(c, tr.rgb);
      else if (mode < 1.5) c = 1.0 - (1.0 - c) * (1.0 - clamp(tr.rgb, 0.0, 1.0));
      else if (mode < 3.5) c += tr.rgb;
      else {
        // Over: the trail over the picture, under where the source is now.
        vec4 sNow = fnFbMask(texelFetch(uFbRaw, iq, 0), texelFetch(uFbRawPrev, iq, 0));
        c = mix(c * (1.0 - clamp(tr.a, 0.0, 1.0)) + tr.rgb, c, clamp(sNow.a, 0.0, 1.0));
      }
    }
  }`);
    if (k === 'echo') op(e, `{
    // After Effects' Echo: up to eight earlier frames of the source, Echo time apart, the newest at Starting intensity and
    // each older one Decay times the one after it, laid oldest first under (or over) the live picture.
    int n = int(uEcN + 0.5);
    float mode = floor(echo_mode + 0.5);
    vec3 ct = c;
    for (int k = 8; k >= 1; k--) {
      if (k > n) continue;
      vec4 ec = fnEcAt(q, k) * (echo_start * pow(echo_decay, float(k - 1)));
      if (mode < 0.5) ct = max(ct, ec.rgb);
      else if (mode < 1.5) ct += ec.rgb;
      else if (mode < 2.5) ct = 1.0 - (1.0 - ct) * (1.0 - clamp(ec.rgb, 0.0, 1.0));
      else ct = ct * (1.0 - clamp(ec.a, 0.0, 1.0)) + ec.rgb;
    }
    // Behind: the source as it is now stays on top.
    if (mode > 2.5 && mode < 3.5) ct = mix(ct, c, clamp(fnEcAt(q, 0).a, 0.0, 1.0));
    c = ct;
  }`);
  }
  // What is read at q: chromatic aberration and Glitch's colour split pull red and blue apart.
  const splits = [];
  for (const e of first ? effects : []) {
    const w = weight.get(e);
    const ww = w ? ` * ${w}(p)` : '';
    if (e.kind === 'chroma') splits.push(`{
    vec2 d = q - 0.5;
    float sc = chroma_amount * 0.018 * pow(length(d * vec2(uAspect, 1.0)) * 1.25, chroma_falloff) / max(length(d * vec2(uAspect, 1.0)), 1e-4) * length(d * vec2(uAspect, 1.0));
    vec2 o = normalize(d + 1e-6) * sc${ww};
    oR += o; oB -= o;
  }`);
    if (e.kind === 'glitch') splits.push(`{
    float s = floor(uTime * glitch_speed);
    vec2 o = vec2((fnHash(vec3(floor(q.y * glitch_blocks), s, 9.0)) - 0.5) * glitch_split * glitch_amount * 0.06, 0.0)${ww};
    oR += o; oB -= o;
  }`);
  }
  const sample = splits.length
    ? `{
    vec2 oR = vec2(0.0), oB = vec2(0.0);
    ${splits.join('\n    ')}
    vec4 m = fetch(q);
    s = vec4(fetch(q + oR).r, m.g, fetch(q + oB).b, m.a);
  }`
    : 's = fetch(q);';
  // Stage effects read elsewhere: what this pass reads there (the same splits), as straight colour.
  if (stage) src += `vec4 fnSample(vec2 q, vec2 p) {\n  vec4 s;\n  ${sample}\n  return s;\n}\nvec3 fnRead(vec2 q) { vec4 s = fnSample(q, gP); return s.a > 1e-5 ? s.rgb / s.a : vec3(0.0); }\n` + fnStageGlsl(own);
  src += `void main() {
  vec2 p = gl_FragCoord.xy / uRes;
  if (uOutFlip > 0.5) p.y = 1.0 - p.y;
  gPx = p * uRes;
  float wipe = 1.0;
  ${last ? `if (uWipe.x > 0.5) {
    wipe = fnWipe(p);
    if (wipe <= 0.0) {
      vec4 o = scene(p);
      fragColor = uLive > 0.5 ? vec4(o.rgb, 1.0) : vec4(o.a > 0.0 ? o.rgb / o.a : vec3(0.0), o.a);
      return;
    }
  }` : ''}
  vec2 q = p;
  ${warps.reverse().join('\n  ')}${stage ? '\n  gQ = q; gP = p;' : ''}
  vec4 s;
  ${sample}
  float a = s.a;
  vec3 c = a > 1e-5 ? s.rgb / a : vec3(0.0);
  ${ops.join('\n  ')}
  c = clamp(c, 0.0, 1.0) * gEdge;${feedback || echo ? '\n  a = max(a, step(1e-4, max(c.r, max(c.g, c.b))));' : ''}
  ${last ? `if (wipe < 1.0) {
    vec4 o = scene(p);
    c = mix(o.a > 1e-5 ? o.rgb / o.a : vec3(0.0), c, wipe);
    a = mix(o.a, a, wipe);
  }
  fragColor = uLive > 0.5 ? vec4(c * a, 1.0) : vec4(c, a);` : `// A pass before the last: premultiplied, upright, for the next pass to read.
  fragColor = vec4(c * a, a);`}
}
`;
  return { src, glow, time, feedback, echo, mosh, mx, maps, lut: has('grade'), custom: customs.filter(e => mine.includes(e)).map(e => e.id), segments: segs.length };
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

// ── The temporal effects' own passes ─────────────────────────────────────────

/**
 * What a temporal effect keeps: the pass before (uFromStage), or in the first pass the picture itself
 * (scene); or a layer drawn alone (uFromMap: a map texture, straight colour). Premultiplied.
 */
const FN_TMP_SRC = `
uniform sampler2D uSrcTex, uMap;
uniform float uFromStage, uFromMap;
vec4 fnSrc(vec2 p) { return uFromStage > 0.5 ? texture(uSrcTex, p) : scene(p); }
vec4 fnRaw(vec2 p) { if (uFromMap > 0.5) { vec4 m = texture(uMap, p); return vec4(m.rgb * m.a, m.a); } return fnSrc(p); }
`;

/** One frame into a ring of past frames (Motion extract's, Echo's), at the ring's size. */
const FN_TMP_CAPTURE = `${FN_COMMON}${FN_TMP_SRC}
out vec4 fragColor;
void main() { fragColor = fnRaw(gl_FragCoord.xy / uRes); }
`;

/** Feedback's floor: each frame the trail loses this much as well as its share, so it fades out completely (never a haze). */
const FN_FB_FLOOR = '0.003';
/**
 * Feedback's and Echo's Source, from a raw sample `r` (premultiplied: the picture, or a layer drawn
 * alone) and the same point a frame earlier `r0`: all of it, the parts that changed (moving), or the
 * bright parts. A function named `name`.
 */
function fnSourceMaskGlsl(map, name) {
  const body = map === 'moving' ? 'return r * smoothstep(0.03, 0.15, abs(fnLuma(r.rgb) - fnLuma(r0.rgb)));'
    : map === 'bright' ? 'return r * smoothstep(0.5, 0.8, r.a > 1e-5 ? fnLuma(r.rgb / r.a) : 0.0);'
      : 'return r;';
  return `vec4 ${name}(vec4 r, vec4 r0) { ${body} }\n`;
}
/**
 * Feedback's trail at a point, before it fades: the history from the frame before (uFbPrev), moved by
 * Zoom, Rotate and Drift and turned by Hue drift. With no move it is read exactly (texelFetch), so a
 * plain trail stays as sharp as the picture however long it lasts.
 */
const FN_FB_TRAIL = `
vec4 fnFbTrail(vec2 p) {
  vec4 t;
  if (feedback_zoom == 0.0 && feedback_rotate == 0.0 && feedback_shiftX == 0.0 && feedback_shiftY == 0.0) {
    t = texelFetch(uFbPrev, ivec2(clamp(floor(p * uRes), vec2(0.0), uRes - 1.0)), 0);
  } else {
    vec2 v = (p - 0.5) * vec2(uAspect, 1.0);
    float a = radians(feedback_rotate);
    v = mat2(cos(a), sin(a), -sin(a), cos(a)) * v / (1.0 + feedback_zoom);
    vec2 fq = v / vec2(uAspect, 1.0) + 0.5 - vec2(feedback_shiftX, feedback_shiftY);
    float inside = step(0.0, fq.x) * step(fq.x, 1.0) * step(0.0, fq.y) * step(fq.y, 1.0);
    t = texture(uFbPrev, fq) * inside;
  }
  if (feedback_hue != 0.0) t.rgb = max(fnHueTurn(t.rgb, feedback_hue), 0.0);
  return t;
}
`;
/**
 * Feedback's history, one frame on (two outputs, full size): its Source now (oRaw keeps the raw sample
 * for the next frame's Moving parts), and the history: the source combined with the trail (faded by
 * Trail and the floor) by the Blend: lighten (and over) keep the brighter, screen and add add light,
 * blend mixes the source into its own past (a smear). Half-float when the GPU can draw it.
 */
function fnFbUpdateGlsl(map) {
  return `${FN_COMMON}${FN_TMP_SRC}${fnDefines('feedback')}
uniform sampler2D uFbPrev, uFbRawPrev;
uniform float uValid;
layout(location = 0) out vec4 oHist;
layout(location = 1) out vec4 oRaw;
${FN_HELPERS}${fnSourceMaskGlsl(map, 'fnFbMask')}${FN_FB_TRAIL}
void main() {
  vec2 fc = floor(gl_FragCoord.xy), p = (fc + 0.5) / uRes;
  vec4 raw = fnRaw(p);
  oRaw = raw;
  vec4 S = fnFbMask(raw, uValid > 0.5 ? texelFetch(uFbRawPrev, ivec2(fc), 0) : raw);
  if (uValid < 0.5) { oHist = S; return; }
  vec4 T = fnFbTrail(p);
  float mode = floor(feedback_mode + 0.5);
  if (mode > 1.5 && mode < 2.5) { oHist = mix(S, max(T - ${FN_FB_FLOOR}, 0.0), feedback_amount); return; }
  vec4 tr = max(T * feedback_amount - ${FN_FB_FLOOR}, 0.0);
  oHist = mode < 0.5 || mode > 3.5 ? max(S, tr) : mode < 1.5 ? 1.0 - (1.0 - S) * (1.0 - clamp(tr, 0.0, 1.0)) : min(S + tr, vec4(4.0));
}
`;
}

/** Datamosh, step 1: the brightness motion is measured on, at a quarter size (each texel the mean of 4 × 4 pixels). */
const FN_MOSH_LUMA = `${FN_COMMON}${FN_TMP_SRC}
uniform sampler2D uMoshTex;
uniform float uMoshMap;
out vec4 o0;
float fnL(vec2 p) {
  if (uMoshMap > 0.5) { vec4 m = texture(uMoshTex, p); return fnLuma(m.rgb) * m.a; }
  return fnLuma(fnSrc(p).rgb);
}
void main() {
  vec2 p = gl_FragCoord.xy / uRes, h = 1.0 / uSrcRes;
  float l = 0.25 * (fnL(p - h) + fnL(p + vec2(h.x, -h.y)) + fnL(p + vec2(-h.x, h.y)) + fnL(p + h));
  o0 = vec4(vec3(l), 1.0);
}
`;

/** A motion vector (quarter-size pixels, ±64) in an RGBA8 texel, 16 bits an axis (fnMoshEncode / fnMoshDecode). */
const FN_MOSH_CODEC = `
vec2 fnDec(vec4 t) { vec4 b = floor(t * 255.0 + 0.5); return vec2(b.r * 256.0 + b.g, b.b * 256.0 + b.a) / 65535.0 * 128.0 - 64.0; }
vec4 fnEnc(vec2 v) { vec2 u = floor(clamp((v + 64.0) / 128.0, 0.0, 1.0) * 65535.0 + 0.5); vec2 hi = floor(u / 256.0); return vec4(hi.x, u.x - hi.x * 256.0, hi.y, u.y - hi.y * 256.0) / 255.0; }
`;

/**
 * Datamosh, step 2: one texel per block, where the block came from in the frame before (a P-frame's
 * motion vector). Block matching on the quarter-size brightness: 16 samples a block, compared at the
 * last vector (the predictor) and then a step search of 8, 4, 2 and 1 pixels around the best so far
 * (±15 quarter-size pixels a frame, FN_MOSH_REACH). A small cost per pixel moved and a nudge toward
 * none keep still parts still, and a flat block (nothing to match) doesn't move. Sustain: a block
 * keeps the larger of its new vector and what is left of its last one.
 */
const FN_MOSH_VEC = `#version 300 es
precision highp float;
uniform sampler2D uCur, uPrev, uVecPrev;
uniform vec2 uLow;
uniform float uBl, uSustain, uValid;
out vec4 o0;
${FN_MOSH_CODEC}
float gCur[16];
vec2 gMed;
vec2 fnAt(vec2 o, int i) { return o + (vec2(float(i & 3), float(i >> 2)) + 0.5) * uBl * 0.25; }
// The match's cost, a little per pixel moved, and a little per pixel away from the neighbours' movement (as an encoder
// prefers vectors near its neighbours'): on repeating textures, where many matches are as good, the blocks agree.
float fnCost(vec2 o, vec2 v) {
  float s = 0.0;
  for (int i = 0; i < 16; i++) s += abs(gCur[i] - texture(uPrev, (fnAt(o, i) - v) / uLow).r);
  return s / 16.0 + 0.0015 * length(v) + 0.004 * length(v - gMed);
}
float fnMed3(float a, float b, float c) { return max(min(a, b), min(max(a, b), c)); }
void main() {
  vec2 g = floor(gl_FragCoord.xy), o = g * uBl;
  if (uValid < 0.5) { o0 = fnEnc(vec2(0.0)); return; }
  float lo = 1.0, hi = 0.0;
  for (int i = 0; i < 16; i++) { gCur[i] = texture(uCur, fnAt(o, i) / uLow).r; lo = min(lo, gCur[i]); hi = max(hi, gCur[i]); }
  ivec2 gi = ivec2(g), gm = ivec2(ceil(uLow / uBl)) - 1;
  vec2 last = fnDec(texelFetch(uVecPrev, gi, 0));
  vec2 vl = fnDec(texelFetch(uVecPrev, clamp(gi - ivec2(1, 0), ivec2(0), gm), 0));
  vec2 vr = fnDec(texelFetch(uVecPrev, clamp(gi + ivec2(1, 0), ivec2(0), gm), 0));
  vec2 vu = fnDec(texelFetch(uVecPrev, clamp(gi + ivec2(0, 1), ivec2(0), gm), 0));
  // The neighbours' movement last frame (left, right and above): its median, per axis.
  gMed = vec2(fnMed3(vl.x, vr.x, vu.x), fnMed3(vl.y, vr.y, vu.y));
  vec2 pv = last * uSustain;
  vec2 best = vec2(0.0);
  if (hi - lo > 0.03) {
    float bc = fnCost(o, best) - 0.004;
    vec2 pr = floor(pv + 0.5);
    float pc = fnCost(o, pr);
    if (pc < bc) { best = pr; bc = pc; }
    pr = floor(gMed + 0.5);
    pc = fnCost(o, pr);
    if (pc < bc) { best = pr; bc = pc; }
    const vec2 D[8] = vec2[8](vec2(-1.0, -1.0), vec2(0.0, -1.0), vec2(1.0, -1.0), vec2(-1.0, 0.0), vec2(1.0, 0.0), vec2(-1.0, 1.0), vec2(0.0, 1.0), vec2(1.0, 1.0));
    for (int k = 0; k < 4; k++) {
      float st = float(8 >> k);
      vec2 c0 = best;
      for (int j = 0; j < 8; j++) {
        vec2 v = clamp(c0 + D[j] * st, vec2(-40.0), vec2(40.0));
        float cc = fnCost(o, v);
        if (cc < bc) { best = v; bc = cc; }
      }
    }
  }
  o0 = fnEnc(dot(best, best) >= dot(pv, pv) ? best : pv);
}
`;

/**
 * Datamosh, step 3 (full size, two outputs): the held picture moved by its block's vector (a whole
 * number of pixels, read without filtering, so it never blurs however long it is held), plus Bleed ×
 * this frame's residual (what a codec would add: the frame minus the frame before, moved the same
 * way), healed toward the live picture by uHeal; a keyframe, or no held picture yet, takes the live
 * picture as it is. The second output keeps this frame for the next one's residual.
 */
const FN_MOSH_ADV = `${FN_COMMON}${FN_TMP_SRC}
layout(location = 0) out vec4 oHeld;
layout(location = 1) out vec4 oSrc;
uniform sampler2D uHeld, uPrevSrc, uVec;
uniform vec2 uLow;
uniform float uBl, uValid, uKey, uBleed, uPush, uHeal;
${FN_MOSH_CODEC}
void main() {
  vec2 fc = floor(gl_FragCoord.xy), p = (fc + 0.5) / uRes;
  vec4 cur = fnSrc(p);
  oSrc = cur;
  if (uValid < 0.5 || uKey > 0.5) { oHeld = cur; return; }
  vec2 v = fnDec(texelFetch(uVec, ivec2(floor(p * uLow / uBl)), 0)) * uPush;
  vec2 q = (fc - floor(v * uRes / uLow + 0.5) + 0.5) / uRes;
  vec4 h = texture(uHeld, q) + uBleed * (cur - texture(uPrevSrc, q));
  oHeld = clamp(mix(h, cur, uHeal), 0.0, 1.0);
}
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
 *       layerAlpha(id)                 a layer drawn alone (a Layer map: Time, Displace, an effect's Where), or null
 *       motion                         the camera's motion map (the kit's motionMap()), or null
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
  const picTex = makeTex(gl.LINEAR), layTex = makeTex(gl.LINEAR), lutTex = makeTex(gl.LINEAR), clearTex = makeTex(gl.NEAREST);
  // The map textures (fnMapKeys: layers drawn alone, the motion map), uploaded each frame they're read.
  const mapTexs = Array.from({ length: FN_MAP_MAX }, () => makeTex(gl.LINEAR));
  gl.bindTexture(gl.TEXTURE_2D, clearTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
  let lutKey = '';

  // Render targets: glow levels (two attachments each) and the pixels-mode output.
  function target(w, h, count, float, filter = gl.LINEAR) {
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    const texs = [];
    for (let i = 0; i < count; i++) {
      const t = makeTex(filter);
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
  let stageT = null; // two full-size targets for the passes before the last (fnSegments)
  let ringT = null; // { key, tex, fb, w, h, ring }

  const clearMap = tex => { scratch(); gl.bindTexture(gl.TEXTURE_2D, tex); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4)); };
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

  // ── The temporal effects' frames (FN_TEMPORAL_KINDS) ──
  // Datamosh: two full-size pairs (held picture, last frame), used in turn; the quarter-size brightness and
  // the block vectors, two of each (the frame before's are read). Motion extract: a ring of past frames.
  let moshT = null; // { key, st, low, vec, i, valid, kf, out, bytes }
  const rings = new Map(); // 'motionx' | 'echo' → { key, W, H, tex, fb, w, h, ring, n, at, L, M, copies, bytes }
  let fbT = null; // Feedback: { key, st, i, valid, on, prev, now, raw, rawPrev, bytes }
  function dropMosh() { if (!moshT) return; for (const t of [...moshT.st, ...moshT.low, ...moshT.vec]) dropTarget(t); moshT = null; }
  function dropRing(kind) { const R = rings.get(kind); if (!R) return; gl.deleteTexture(R.tex); gl.deleteFramebuffer(R.fb); rings.delete(kind); }
  function dropFb() { if (!fbT) return; for (const t of fbT.st) dropTarget(t); fbT = null; }
  // Feedback's two full-size pairs, used in turn: its history (half-float when the GPU can draw it) and its raw source (8-bit).
  function ensureFb(W, H) {
    const key = `${W}x${H}`;
    if (fbT && fbT.key === key) return fbT;
    dropFb();
    const pair = () => {
      const fb = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      const texs = [floatGlow, false].map((fl, i) => {
        const t = makeTex(gl.LINEAR);
        gl.texImage2D(gl.TEXTURE_2D, 0, fl ? gl.RGBA16F : gl.RGBA8, W, H, 0, gl.RGBA, fl ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE, null);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, t, 0);
        return t;
      });
      gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
      return { fb, texs, w: W, h: H };
    };
    fbT = { key, st: [pair(), pair()], i: 0, valid: false, on: false, prev: null, now: null, raw: null, rawPrev: null, bytes: 2 * W * H * ((floatGlow ? 8 : 4) + 4) };
    return fbT;
  }
  function ensureMosh(W, H) {
    const key = `${W}x${H}`;
    if (moshT && moshT.key === key) return moshT;
    dropMosh();
    const g = fnMoshGrid(24, W, H);
    // The vector targets are a texel per quarter-size pixel (room for the smallest blocks); a frame draws only gw × gh of it.
    moshT = {
      key, i: 0, valid: false, kf: -1, out: null,
      st: [target(W, H, 2, false, gl.NEAREST), target(W, H, 2, false, gl.NEAREST)],
      low: [target(g.lowW, g.lowH, 1, false), target(g.lowW, g.lowH, 1, false)],
      vec: [target(g.lowW, g.lowH, 1, false, gl.NEAREST), target(g.lowW, g.lowH, 1, false, gl.NEAREST)],
      bytes: 4 * W * H * 4 + 4 * g.lowW * g.lowH * 4,
    };
    return moshT;
  }
  /** A ring of past frames for `kind` (Motion extract's, Echo's), deep enough for `back` frames back; it grows, never shrinks, while the size stays. */
  function ensureFrameRing(kind, back, W, H) {
    const old = rings.get(kind);
    const size = fnEchoRingSize(back, W, H, old && old.W === W && old.H === H ? old.ring.size : 0, kind === 'echo' ? FN_ECHO_COPIES_CAP : FN_ECHO_CAP);
    const key = `${W}x${H}:${size.frames}:${size.w}x${size.h}`;
    if (old && old.key === key) return old;
    dropRing(kind);
    scratch();
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RGBA8, size.w, size.h, size.frames);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const R = { key, W, H, tex, fb: gl.createFramebuffer(), w: size.w, h: size.h, ring: fnRing(size.frames), n: 0, at: [0, 0], L: new Float32Array(9), M: new Float32Array(9), copies: 0, bytes: size.bytes };
    rings.set(kind, R);
    return R;
  }
  /** This pass's input (or a layer drawn alone) into a ring's next slot. */
  function captureInto(R, input, W, H, pixelsMode, setSrc) {
    const cap = compile('tmpcap', FN_TMP_CAPTURE);
    if (!cap) return false;
    gl.useProgram(cap.prog);
    common(cap, R.w, R.h, input, W, H, pixelsMode);
    setSrc(cap);
    gl.bindFramebuffer(gl.FRAMEBUFFER, R.fb);
    gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, R.tex, 0, R.ring.slotForWrite());
    gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
    gl.viewport(0, 0, R.w, R.h);
    gl.bindVertexArray(vao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    R.ring.push();
    R.n++;
    return true;
  }
  /**
   * A temporal effect's frames for this draw, just before the pass it heads (`pi`): what it keeps is
   * that pass's input, the pass before (a stage target) or, heading the first pass, the picture.
   */
  function temporalPass(e, pi, input, W, H, pixelsMode, value, maps) {
    const v = (k, d) => { const x = value ? value(e, k) : e[k]; return typeof x === 'number' && isFinite(x) ? x : d; };
    const fromStage = pi > 0 && !!stageT;
    const srcTex = fromStage ? stageT[(pi - 1) % 2].texs[0] : clearTex;
    // A layer as the Source (Feedback, Echo; Datamosh's Motion from reads it on its own): its map texture, drawn alone by the kit.
    const mi = e.map === 'layer' ? maps.indexOf('layer:' + (e.layerId || '')) : -1;
    const fromLayer = mi >= 0 && e.kind !== 'datamosh';
    const setSrc = prog => {
      gl.uniform1f(loc(prog, 'uFromStage'), fromStage ? 1 : 0); bindTex(prog, 'uSrcTex', 2, srcTex);
      gl.uniform1f(loc(prog, 'uFromMap'), fromLayer ? 1 : 0); bindTex(prog, 'uMap', 3, fromLayer ? mapTexs[mi] : clearTex);
    };
    if (e.kind === 'motionx') {
      const delay = Math.max(1, Math.min(FN_ECHO_MAX_DELAY, Math.round(v('delay', 3))));
      const R = ensureFrameRing('motionx', delay, W, H);
      if (input.first) { R.ring.reset(); R.n = 0; }
      if (!captureInto(R, input, W, H, pixelsMode, setSrc)) return false;
      // Now, and Delay frames back (the oldest kept until the ring has that many: the first frame shows no movement).
      R.at = [R.ring.slotFor(1), R.ring.slotFor(Math.min(R.ring.count, delay + 1))];
      return true;
    }
    if (e.kind === 'echo') {
      const moving = fnSourceOf(e) === 'moving';
      const strobe = v('strobe', 0) >= 0.5;
      const time = v('time', 4), count = v('count', 3);
      // Deep enough for the copies at their most (with Strobe, a whole step more), so the ring keeps its size as it steps.
      const R = ensureFrameRing('echo', fnEchoPlan(time, count, false, 1, moving).deepest + (strobe ? Math.max(0, Math.round(time) - 1) : 0) - 1, W, H);
      if (input.first) { R.ring.reset(); R.n = 0; }
      if (!captureInto(R, input, W, H, pixelsMode, setSrc)) return false;
      const plan = fnEchoPlan(time, count, strobe, R.n, moving);
      const at = back => R.ring.slotFor(Math.max(1, Math.min(R.ring.count, back)));
      R.L.fill(0); R.M.fill(0);
      let copies = 0;
      plan.backs.forEach((back, i) => {
        // A copy older than anything kept yet isn't drawn (the first frames of a render have fewer).
        if (i > 0 && back > R.ring.count) return;
        R.L[i] = at(back); R.M[i] = at(back + 1);
        if (i > 0) copies = i;
      });
      R.copies = copies;
      return true;
    }
    if (e.kind === 'feedback') {
      const F = ensureFb(W, H);
      if (input.first) F.valid = false;
      const map = fnSourceOf(e);
      const up = compile('fbupd:' + map, fnFbUpdateGlsl(map));
      if (!up) return false;
      const cur = F.i, prev = 1 - F.i;
      gl.useProgram(up.prog);
      common(up, W, H, input, W, H, pixelsMode);
      setSrc(up);
      const ul = loc(up, 'U_feedback'); if (ul) gl.uniform4fv(ul, packed(e, value));
      gl.uniform1f(loc(up, 'uValid'), F.valid ? 1 : 0);
      bindTex(up, 'uFbPrev', 4, F.st[prev].texs[0]); bindTex(up, 'uFbRawPrev', 5, F.st[prev].texs[1]);
      draw(F.st[cur].fb, W, H);
      F.on = F.valid;
      F.prev = F.st[prev].texs[0]; F.rawPrev = F.st[prev].texs[1];
      F.now = F.st[cur].texs[0]; F.raw = F.st[cur].texs[1];
      F.valid = true;
      F.i = prev;
      return true;
    }
    const M = ensureMosh(W, H);
    if (input.first) { M.valid = false; M.kf = -1; }
    const g = fnMoshGrid(v('block', 24), W, H);
    const cur = M.i, prev = 1 - M.i;
    // 1. The brightness motion is measured on, at a quarter size: this pass's input, or a layer drawn alone (a camera).
    const lum = compile('moshlum', FN_MOSH_LUMA);
    if (!lum) return false;
    gl.useProgram(lum.prog);
    common(lum, g.lowW, g.lowH, input, W, H, pixelsMode);
    setSrc(lum);
    gl.uniform1f(loc(lum, 'uMoshMap'), mi >= 0 ? 1 : 0);
    bindTex(lum, 'uMoshTex', 4, mi >= 0 ? mapTexs[mi] : clearTex);
    draw(M.low[cur].fb, g.lowW, g.lowH);
    // 2. Each block's vector.
    const vec = compile('moshvec', FN_MOSH_VEC);
    if (!vec) return false;
    gl.useProgram(vec.prog);
    gl.uniform2f(loc(vec, 'uLow'), g.lowW, g.lowH);
    gl.uniform1f(loc(vec, 'uBl'), g.bl);
    gl.uniform1f(loc(vec, 'uSustain'), Math.max(0, Math.min(0.98, v('sustain', 0.6))));
    gl.uniform1f(loc(vec, 'uValid'), M.valid ? 1 : 0);
    bindTex(vec, 'uCur', 0, M.low[cur].texs[0]); bindTex(vec, 'uPrev', 1, M.low[prev].texs[0]); bindTex(vec, 'uVecPrev', 2, M.vec[prev].texs[0]);
    draw(M.vec[cur].fb, g.gw, g.gh);
    // 3. The held picture moved along them (and healed, or a keyframe); this frame kept for the next.
    const hold = v('hold', 0) >= 0.5;
    const kf = fnMoshKeyframe(v('every', 0), input.time || 0, M.kf);
    M.kf = kf.idx;
    const refresh = Math.max(0, Math.min(1, v('refresh', 0)));
    const adv = compile('moshadv', FN_MOSH_ADV);
    if (!adv) return false;
    gl.useProgram(adv.prog);
    common(adv, W, H, input, W, H, pixelsMode);
    setSrc(adv);
    gl.uniform2f(loc(adv, 'uLow'), g.lowW, g.lowH);
    gl.uniform1f(loc(adv, 'uBl'), g.bl);
    gl.uniform1f(loc(adv, 'uValid'), M.valid ? 1 : 0);
    gl.uniform1f(loc(adv, 'uKey'), kf.key && !hold ? 1 : 0);
    gl.uniform1f(loc(adv, 'uBleed'), Math.max(0, Math.min(1, v('bleed', 0.06))));
    gl.uniform1f(loc(adv, 'uPush'), Math.max(0, Math.min(3, v('push', 1))));
    gl.uniform1f(loc(adv, 'uHeal'), hold ? 0 : refresh * refresh);
    bindTex(adv, 'uHeld', 3, M.st[prev].texs[0]); bindTex(adv, 'uPrevSrc', 4, M.st[prev].texs[1]); bindTex(adv, 'uVec', 5, M.vec[cur].texs[0]);
    draw(M.st[cur].fb, W, H);
    M.out = M.st[cur].texs[0];
    M.valid = true;
    M.i = prev;
    return true;
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
    // The pass's structure: kinds (and custom code), each effect's Where, Displace's map, and the map textures.
    const shapeOf = e => (e.kind === 'custom' ? 'custom:' + e.code : e.kind)
      + (fnWhereOf(e) === 'all' ? '' : `@${fnWhereOf(e)}:${fnWhereOf(e) === 'layer' ? e.whereLayer || '' : ''}${e.whereInvert ? '!' : ''}`)
      + (e.kind === 'displace' ? `~${e.map || 'noise'}:${e.map === 'layer' ? e.layerId || '' : ''}` : '')
      + (e.kind === 'time' && e.map === 'layer' ? `~${e.layerId || ''}` : '')
      + (e.kind === 'datamosh' && e.map === 'layer' ? `~${e.layerId || ''}` : '')
      + ((e.kind === 'feedback' || e.kind === 'echo') ? `~${fnSourceOf(e)}:${e.map === 'layer' ? e.layerId || '' : ''}` : '');
    const keyFor = (list, i) => `final:${i}:` + list.map(shapeOf).join(',') + `|${opts.tone}|${opts.curves}|${opts.hueCurves}|${opts.timeMap}`;
    // One pass, or one per stage effect (fnSegments): every one has to compile.
    const buildAll = list => {
      const out = [];
      for (let i = 0, n = fnSegments(list).length; i < n; i++) {
        const b = fnBuildFinal(list, Object.assign({ segment: i }, opts));
        const prog = compile(keyFor(list, i), b.src);
        if (!prog) return null;
        out.push({ built: b, fin: prog });
      }
      return out;
    };
    let ran = effects;
    let passes = buildAll(effects);
    if (!passes && effects.some(e => e.kind === 'custom')) {
      // Each custom effect compiled alone but not together: run the stack without them.
      for (const e of effects) if (e.kind === 'custom') customErr[e.id] = customErr[e.id] || 'It doesn’t compile together with the rest of the stack (a name used twice?).';
      ran = effects.filter(e => e.kind !== 'custom');
      if (!ran.length) return false;
      passes = buildAll(ran);
    }
    if (!passes) return false;
    const built = { glow: passes.some(x => x.built.glow), feedback: passes.some(x => x.built.feedback), maps: passes[0].built.maps };
    // A temporal effect gone from the stack lets go of its frames (Datamosh's are four full-size textures).
    if (!ran.some(e => e.kind === 'datamosh')) dropMosh();
    if (!ran.some(e => e.kind === 'motionx')) dropRing('motionx');
    if (!ran.some(e => e.kind === 'echo')) dropRing('echo');
    if (!ran.some(e => e.kind === 'feedback')) dropFb();
    const segs = fnSegments(ran);
    if (built.glow && !glowPasses(input, ran, W, H, pixelsMode, value)) return false;
    let ring = null;
    if (time) {
      ring = ensureRing(time, W, H);
      if (input.first) ring.ring.reset();
    }
    // The maps the pass reads: a layer drawn alone, or the camera's motion map; nothing there reads 0.
    built.maps.forEach((key, i) => {
      const m = key === 'motion' ? input.motion || null : input.layerAlpha ? input.layerAlpha(key.slice(6)) : null;
      if (m) upload(mapTexs[i], m, false, true); else clearMap(mapTexs[i]);
    });
    if (pixelsMode && (!outT || outT.w !== W || outT.h !== H)) { dropTarget(outT); outT = target(W, H, 1, false); }
    // Passes before the last (a stack with stage effects): two full-size targets, used in turn.
    if (passes.length > 1 && (!stageT || stageT[0].w !== W || stageT[0].h !== H)) {
      if (stageT) for (const t of stageT) dropTarget(t);
      stageT = [target(W, H, 1, false), target(W, H, 1, false)];
    }
    const cmp = input.finish.compare;
    const host = cmp && cmp.on ? Object.assign({ id: FN_COMPARE_ID, kind: 'compare', enabled: true }, cmp) : null;
    const cv = (k, d) => { const v = value ? value(host, k) : cmp[k]; return typeof v === 'number' && isFinite(v) ? v : d; };
    passes.forEach(({ built: b, fin }, pi) => {
      const lastPass = pi === passes.length - 1;
      // A temporal effect heads its pass: its frames first, from what this pass reads.
      const head = segs[pi] && segs[pi][0];
      if (head && FN_TEMPORAL_KINDS.includes(head.kind)) temporalPass(head, pi, input, W, H, pixelsMode, value, built.maps);
      gl.useProgram(fin.prog);
      common(fin, W, H, input, W, H, pixelsMode);
      let ci = 0;
      for (const e of ran) {
        if (e.kind === 'custom') { const l = loc(fin, `U_cx${ci++}`); if (l) gl.uniform4fv(l, packedCustom(e, value)); continue; }
        const l = loc(fin, `U_${e.kind}`); if (l) gl.uniform4fv(l, packed(e, value));
      }
      // Passes before the last draw upright into a target; only the last flips for a render's read-back.
      gl.uniform1f(loc(fin, 'uOutFlip'), pixelsMode && lastPass ? 1 : 0);
      gl.uniform1f(loc(fin, 'uLive'), pixelsMode ? 0 : 1);
      if (host) gl.uniform4f(loc(fin, 'uWipe'), 1, Math.max(0, Math.min(1, cv('pos', 0.5))), cv('angle', 0), Math.max(0, Math.min(1, cv('softness', 0))));
      else gl.uniform4f(loc(fin, 'uWipe'), 0, 0.5, 0, 0);
      let unit = 2;
      if (b.lut) bindTex(fin, 'uLut', unit++, lutTex);
      if (b.glow) {
        gl.uniform1f(loc(fin, 'uGlowFloat'), floatGlow ? 1 : 0);
        bindTex(fin, 'uQ0', unit++, glowT.qb.texs[0]); bindTex(fin, 'uQ1', unit++, glowT.qb.texs[1]);
        bindTex(fin, 'uE0', unit++, glowT.eb.texs[0]); bindTex(fin, 'uE1', unit++, glowT.eb.texs[1]);
        bindTex(fin, 'uG0', unit++, glowT.gb.texs[0]); bindTex(fin, 'uG1', unit++, glowT.gb.texs[1]);
        if (halT && effects.some(e => e.kind === 'halation')) bindTex(fin, 'uHM', unit++, halT.m.texs[0]);
      }
      if (ring && b.time) {
        bindTex(fin, 'uRing', unit++, ring.tex, gl.TEXTURE_2D_ARRAY);
        gl.uniform1f(loc(fin, 'uRingSize'), ring.ring.size);
        gl.uniform1f(loc(fin, 'uRingHead'), Math.max(0, ring.ring.head));
        gl.uniform1f(loc(fin, 'uRingCount'), ring.ring.count);
      }
      // A later pass has no ring, so the pass before takes that unit (never more than 16 in all).
      if (pi > 0) bindTex(fin, 'uStage', unit++, stageT[(pi - 1) % 2].texs[0]);
      b.maps.forEach((_, i) => bindTex(fin, `uM${i}`, unit++, mapTexs[i]));
      if (b.mosh) bindTex(fin, 'uMosh', unit++, moshT && moshT.out ? moshT.out : clearTex);
      const mxR = rings.get('motionx'), ecR = rings.get('echo');
      if (b.mx && mxR) {
        bindTex(fin, 'uMxRing', unit++, mxR.tex, gl.TEXTURE_2D_ARRAY);
        gl.uniform2f(loc(fin, 'uMxAt'), Math.max(0, mxR.at[0]), Math.max(0, mxR.at[1]));
        gl.uniform2f(loc(fin, 'uMxTex'), mxR.w, mxR.h);
      }
      if (b.echo && ecR) {
        bindTex(fin, 'uEcR', unit++, ecR.tex, gl.TEXTURE_2D_ARRAY);
        gl.uniform1fv(loc(fin, 'uEcL'), ecR.L);
        gl.uniform1fv(loc(fin, 'uEcM'), ecR.M);
        gl.uniform1f(loc(fin, 'uEcN'), ecR.copies);
      }
      if (b.feedback && fbT) {
        bindTex(fin, 'uFbPrev', unit++, fbT.prev); bindTex(fin, 'uFbNow', unit++, fbT.now);
        bindTex(fin, 'uFbRaw', unit++, fbT.raw); bindTex(fin, 'uFbRawPrev', unit++, fbT.rawPrev);
        gl.uniform1f(loc(fin, 'uFbOn'), fbT.on ? 1 : 0);
      }
      draw(lastPass ? (pixelsMode ? outT.fb : null) : stageT[pi % 2].fb, W, H);
    });
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
    lastInfo = {
      effects: ran.map(e => e.kind), glow: built.glow, passes: passes.length, floatGlow, ring: ring ? { frames: ring.ring.size, w: ring.w, h: ring.h, bytes: ring.bytes, count: ring.ring.count } : null, custom: customErr,
      mosh: moshT ? { bytes: moshT.bytes } : null,
      rings: Object.fromEntries([...rings].map(([k, R]) => [k, { frames: R.ring.size, w: R.w, h: R.h, bytes: R.bytes, count: R.ring.count }])),
      feedback: fbT ? { bytes: fbT.bytes, float: floatGlow } : null,
    };
    return true;
  }

  return {
    ok: true,
    canvas,
    draw(input) { try { return drawFrame(input); } catch (e) { lastError = String(e && e.message || e); return false; } },
    reset() { if (ringT) ringT.ring.reset(); if (fbT) fbT.valid = false; if (moshT) { moshT.valid = false; moshT.kf = -1; } for (const R of rings.values()) { R.ring.reset(); R.n = 0; } },
    info() { return lastInfo ? Object.assign({ error: lastError }, lastInfo) : { error: lastError }; },
    error() { return lastError; },
    dispose() {
      for (const e of programs.values()) if (e) gl.deleteProgram(e.prog);
      programs.clear();
      if (glowT) for (const k of GLOW_LEVELS) dropTarget(glowT[k]);
      if (halT) for (const k of HAL_LEVELS) dropTarget(halT[k]);
      dropTarget(outT);
      if (stageT) for (const t of stageT) dropTarget(t);
      if (ringT) { gl.deleteTexture(ringT.tex); gl.deleteFramebuffer(ringT.fb); }
      dropMosh(); dropFb(); for (const k of [...rings.keys()]) dropRing(k);
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
