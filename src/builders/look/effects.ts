/**
 * effects.ts — the scene builders' Effects page (docs/builder-look.md, "Effects"): shader effects on
 * the finished picture, as stacked cards built after the scene in the order shown.
 *
 *   Displace (by noise, or by a picture) · Swirl · Ripple · Lens · Pixelate · Kaleidoscope ·
 *   Blur · Glow · Light rays / Radial blur · Chromatic aberration (spectral) · CRT mask
 *
 * How they build. An effect that moves the picture (Displace, Swirl, Pixelate, Kaleidoscope, CRT
 * curvature…) changes WHERE the picture is read: the picture so far goes into a Pass, and the next
 * read of it (Sample (texture)) is at the bent point. Runs of such effects bend one point in turn
 * and share one Pass and one read. An effect that reads round a pixel (Blur, Glow, Chromatic
 * aberration, Displace by a picture) reads the Pass with its own node. CRT mask then works on the
 * colour. So a stack of N effects costs at most one Pass per effect that needs one, never more.
 */
import type { GraphNode } from '../../types/nodeGraph';
import { mk, ref, type Ctx, type Ref } from '../../sceneBuilder/build';
import { fmt } from '../../sceneBuilder/recipe';
import { numOf, stackValue, type LookParam, type StackItem, type StackKindDef } from './stack';

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
    kind: 'swirl', label: 'Swirl', words: ['swirl', 'twirl', 'vortex'], nodes: ['swirlSpace'],
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
    params: [
      { key: 'intensity', label: 'Intensity', hint: 'How bright the glow is.', type: 'num', def: 0.8, min: 0, max: 4, primary: true, node: '', param: 'intensity', aliases: ['amount'] },
      { key: 'threshold', label: 'Threshold', hint: 'How bright a part must be to glow: 0 everything, 0.8 only the brightest.', type: 'num', def: 0.6, min: 0, max: 2, node: '', param: 'threshold' },
      { key: 'radius', label: 'Radius', hint: 'How far the glow spreads, in screen pixels (its tail reaches further).', type: 'num', def: 16, min: 1, max: 64, step: 0.5, node: '', param: 'radius', aliases: ['r'] },
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

/** Does the item need its picture as a texture (a Pass)? */
export function fxNeedsPass(it: StackItem): boolean {
  if (!it.on) return false;
  if (it.kind === 'crt') return numOf(it, FX_BY_KIND.crt.params.find(p => p.key === 'curve')!) > 0;
  return FX_BY_KIND[it.kind] !== undefined;
}

/** The effects stack after `color`, in order. */
export function emitEffects(c: Ctx, items: readonly StackItem[] | undefined, color: Ref, opts: FxOpts): Ref {
  const list = (items ?? []).filter(it => it.on && FX_BY_KIND[it.kind]);
  let cur = color;
  /** The Pass holding `cur` (made when an effect first needs it), and where it will be read (null: here). */
  let pass: Ref | null = null;
  let point: Ref | null = null;
  let passes = 0;
  let firstBend = '';
  const passFor = (role: string, what: string): Ref | null => {
    if (pass) return pass;
    if (passes >= MAX_FX_PASSES) { c.warnings.push(`${what} needs a Pass and the effects already use ${MAX_FX_PASSES}: it is left out. Fewer effects that move or blur the picture, or put them together.`); return null; }
    passes++;
    const p = mk(c, 'pass', `${role}:pass`, { scale: '1', format: 'half' }, { color: cur },
      `Pass: draws the picture so far into a texture of its own, so the effects after it (${what}…) can read it anywhere, not only at this pixel.`);
    pass = ref(p, 'texture');
    return pass;
  };
  /** The picture read at the bent point (if anything bent it): the colour the next effect works on. */
  const flush = () => {
    if (pass && point) {
      const s = mk(c, 'sampleTexture', `${firstBend}:read`, {}, { texture: pass, uv: point },
        'Reads the picture (the Pass before) at the bent point: every move above (swirl, ripple, pixelate…) is where this reads.');
      cur = ref(s, 'color');
      pass = null;
    }
    point = null;
  };
  list.forEach((it, i) => {
    const def = FX_BY_KIND[it.kind];
    const role = fxRole(it);
    const P = (key: string) => def.params.find(p => p.key === key) as LookParam;
    const n = (key: string) => numOf(it, P(key));
    const s = (key: string) => String(stackValue(it, P(key)));
    const step = `Effect ${i + 1} of ${list.length}, ${def.label}`;
    const at = () => point ?? opts.screen;
    const bend = (type: string, params: Record<string, unknown>, wires: Record<string, Ref | null>, inKey: string, outKey: string, note: string) => {
      if (!passFor(role, def.label.toLowerCase())) return;
      if (!point) firstBend = role;
      const node = mk(c, type, `${role}:bend`, params, { ...wires, [inKey]: at() }, `${step}: ${note} It bends the point the picture is read at.`);
      point = ref(node, outKey);
    };
    let node: GraphNode;
    switch (it.kind) {
      case 'displace': {
        if (s('by') === 'picture') {
          const map = it.tex ? opts.texture(it.tex, 'Displace') : null;
          if (!map) { if (!it.tex) c.warnings.push('Displace by a picture has no picture: pick one on its card.'); break; }
          const tex = passFor(role, 'displace');
          if (!tex) break;
          node = mk(c, 'displaceTexture', role, { amount: n('pixels') }, { texture: tex, map, uv: point },
            `${step}: the picture read where the picture “${it.tex}” pushes it: its red sideways, its green up and down (mid-grey stays), up to ${fmt(n('pixels'))} pixels.`);
          cur = ref(node, 'color'); pass = null; point = null;
        } else {
          const noise = mk(c, 'domainWarp', `${role}:noise`, { strength: 1, scale: n('scale'), time_scale: n('speed') }, { uv: at(), time: n('speed') ? opts.getTime() : null },
            `Noise for ${step}: its Offset is a soft, swirling push (scale ${fmt(n('scale'))}${n('speed') ? `, drifting at ${fmt(n('speed'))}` : ''}).`);
          bend('displace', { amount: n('strength') }, { offset: ref(noise, 'offset') }, 'input', 'output', `each point pushed by the noise's Offset × ${fmt(n('strength'))}.`);
        }
        break;
      }
      case 'swirl': bend('swirlSpace', { strength: n('strength'), falloff: n('falloff') }, {}, 'input', 'output', `a twist of ${fmt(n('strength'))} radians at the centre, fading out at ${fmt(n('falloff'))}.`); break;
      case 'ripple': bend('rippleSpace', { freqX: n('freq'), freqY: n('freq'), ampX: n('amp'), ampY: n('amp') }, { time: opts.getTime() }, 'input', 'output', `${fmt(n('freq'))} waves of ${fmt(n('amp'))}, moving with time.`); break;
      case 'lens': bend('lensDistortion', { k1: n('bend'), zoom: n('zoom') }, {}, 'input', 'output', `a lens bend of ${fmt(n('bend'))}${n('zoom') !== 1 ? `, zoomed ${fmt(n('zoom'))}` : ''}.`); break;
      case 'pixelate': bend('pixelate', { pixelSize: n('size') }, {}, 'uv', 'uv', `blocks ${fmt(n('size'))} across.`); break;
      case 'kaleido': bend('kaleidoSpace', { segments: Math.round(n('segments')), rotate: rad(n('rotate')) }, {}, 'input', 'output', `${Math.round(n('segments'))} mirrored wedges${n('rotate') ? `, turned ${fmt(n('rotate'))}°` : ''}.`); break;
      case 'rays': {
        const tex = passFor(role, 'light rays');
        if (!tex) break;
        const mode = s('mode');
        node = mk(c, 'radialFastBlur', role, {
          mode, direction: s('direction'), length: n('length'), centerX: n('cx'), centerY: n('cy'), threshold: n('threshold'), knee: 0.15,
          intensity: n('intensity'), opacity: n('opacity'), decay: n('decay'), falloff: n('falloff'), tint: stackValue(it, P('tint')),
        }, { texture: tex, uv: point },
          `${step}: streaks ${s('direction') === 'in' ? 'into' : 'out from'} the centre, Length ${fmt(n('length'))}${mode === 'average' ? ' (a zoom blur)' : mode === 'add' ? ', added as light' : ', the brightest along each (light rays)'}${n('threshold') > 0 ? `, from the parts brighter than ${fmt(n('threshold'))}` : ''}. Four small hidden passes, so long streaks stay cheap.`);
        cur = ref(node, 'color');
        pass = null; point = null;
        break;
      }
      case 'blur': case 'glow': case 'chroma': {
        const tex = passFor(role, def.label.toLowerCase());
        if (!tex) break;
        if (it.kind === 'blur') {
          node = mk(c, 'blurTexture', role, { method: 'smooth', radius: n('radius') }, { texture: tex, uv: point }, `${step}: a Gaussian blur of ${fmt(n('radius'))} pixels over the whole picture.`);
          cur = ref(node, 'color');
        } else if (it.kind === 'chroma') {
          // The builder's Direction (radial / axial / directional, as recipes have always said it) is the node's Geometry.
          const geometry = s('mode') === 'directional' ? 'directional' : s('mode') === 'axial' ? 'axial' : 'lateral';
          node = mk(c, 'chromaLens', role, {
            mode: s('look'), geometry, amount: n('amount'), samples: Math.round(n('samples')), blur: n('blur'), falloff: n('falloff'),
            centerX: n('cx'), centerY: n('cy'), angle: n('angle'), distortion: n('distortion'),
          }, { texture: tex, uv: point },
            `${step}: ${s('look') === 'split' ? 'red and blue copies' : `${Math.round(n('samples'))} taps across the spectrum`} ${geometry === 'axial' ? `defocused up to ${fmt(n('amount'))} pixels round the highlights` : `moved ${fmt(n('amount'))} pixels${geometry === 'lateral' ? ', outward from the centre' : `, at ${fmt(n('angle'))}°`}`}${n('blur') > 0 ? `, each softened by ${fmt(n('blur'))} × how far it moved` : ''}.`);
          cur = ref(node, 'color');
        } else {
          const here = point ? ref(mk(c, 'sampleTexture', `${role}:here`, {}, { texture: tex, uv: point }, 'The picture at the bent point: what the glow is added to.'), 'color') : cur;
          node = mk(c, 'glowTexture', role, { method: 'bloom', threshold: n('threshold'), knee: 0.2, radius: n('radius'), intensity: n('intensity'), tail: 0.4 }, { texture: tex, uv: point },
            `${step}: the parts brighter than ${fmt(n('threshold'))} spread ${fmt(n('radius'))} pixels (a Bloom chain), at ${fmt(n('intensity'))}. Same frame: nothing lags or smears.`);
          cur = ref(mk(c, 'addColor', `${role}:add`, {}, { a: here, b: ref(node, 'glow') }, 'Adds the glow over the picture: light adds up, so it can pass 1.'), 'result');
        }
        pass = null; point = null;
        break;
      }
      case 'crt': {
        const curve = n('curve'), vig = n('vignette');
        let vignette: Ref | null = null;
        if (curve > 0) {
          if (passFor(role, 'CRT')) {
            if (!point) firstBend = role;
            const scr = mk(c, 'crtScreen', `${role}:screen`, { curvature: curve, snap: 'off', vignettePower: Math.max(vig, 0.02) }, { uv: at() },
              `${step}: bows the screen like a tube's glass (curvature ${fmt(curve)}); outside the tube is black. Vignette darkens toward the bent edges.`);
            point = ref(scr, 'uv');
            vignette = ref(scr, 'vignette');
          }
        } else if (vig > 0) {
          const scr = mk(c, 'crtScreen', `${role}:screen`, { curvature: 0, snap: 'off', vignettePower: vig }, { uv: opts.screen }, `${step}: the tube's vignette, darker toward the edges (the screen is flat: Curvature 0).`);
          vignette = ref(scr, 'vignette');
        }
        flush();
        node = mk(c, 'crtMask', role, { maskType: s('mask'), cellSize: n('size'), strength: n('strength'), scanlines: n('scanlines') }, { color: cur, uv: opts.screen, vignette },
          `${step}: the ${P('mask').options!.find(o => o.value === s('mask'))?.label.toLowerCase()} of a tube, ${fmt(n('size'))}-pixel cells at ${fmt(n('strength'))}${n('scanlines') ? `, scanlines ${fmt(n('scanlines'))}` : ''}.`);
        cur = ref(node, 'result');
        break;
      }
    }
    // A run of bends stays one bent point: the next bend bends it further, Blur, Glow, Chromatic
    // aberration and Displace by a picture read the Pass there themselves, CRT mask reads it first.
  });
  flush();
  return cur;
}

/** The node and param an effect setting sets, by role (for the Play menu). */
export function fxParamTarget(it: StackItem, key: string): { role: string; param: string } | null {
  const p = FX_BY_KIND[it.kind]?.params.find(q => q.key === key);
  if (!p || p.param === undefined) return null;
  // The moves' bend nodes, the read, the CRT screen: their suffixes; the rest the item's main node.
  return { role: fxRole(it) + (p.node ?? ''), param: p.param };
}
