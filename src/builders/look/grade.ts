/**
 * grade.ts — the Look's colour grade as a stack (docs/builder-look.md, "Grade"): the app's own
 * colour-grading nodes as cards, built after the scene in the order shown.
 *
 *   Brightness / contrast · Levels (Tone Curve) · Saturation · Hue · Shadows / highlights ·
 *   Lift / gamma / gain · Temperature (Blackbody × Blend Modes) · Posterize · Invert ·
 *   Duotone and Gradient map (Luminance → Color Ramp, mixed back by Amount)
 *
 * Every number is a node param, so it is a live uniform after Build and right-click on its slider
 * offers the Play menu.
 */
import type { GraphNode } from '../../types/nodeGraph';
import { mk, ref, type Ctx, type Ref } from '../../sceneBuilder/build';
import { fmt } from '../../sceneBuilder/recipe';
import { colourText } from '../../lang/colours';
import type { Vec3 } from './palette';
import { numOf, stackValue, type LookParam, type StackItem, type StackKindDef } from './stack';

const AMOUNT: LookParam = { key: 'amount', label: 'Amount', hint: 'How much of it: 0 leaves the picture as it was, 1 is the full effect.', type: 'num', def: 1, min: 0, max: 1, aliases: ['mix', 'opacity'], node: ':mix', param: 't' };

export const GRADE_KINDS: StackKindDef[] = [
  {
    kind: 'brightness', label: 'Brightness / contrast', words: ['brightness', 'contrast', 'exposure'], nodes: ['brightnessContrast'],
    blurb: 'Lifts or lowers everything, and pushes the darks and lights apart.',
    params: [
      { key: 'brightness', label: 'Brightness', hint: 'Added to every colour: above 0 lighter, below darker.', type: 'num', def: 0, min: -1, max: 1, node: '', param: 'brightness', aliases: ['b'] },
      { key: 'contrast', label: 'Contrast', hint: 'Pushes colours away from mid-grey (above 1) or toward it (below 1).', type: 'num', def: 1.15, min: 0, max: 3, primary: true, node: '', param: 'contrast', aliases: ['c'] },
    ],
  },
  {
    kind: 'levels', label: 'Levels', words: ['levels', 'curve', 'curves', 'tone-curve'], nodes: ['toneCurve'],
    blurb: 'Sets the black and white points, with a soft S-curve between.',
    params: [
      { key: 'blacks', label: 'Black point', hint: 'Colours this dark and below go black. Below 0 lifts the blacks to grey (a faded look).', type: 'num', def: 0.03, min: -0.5, max: 0.5, node: '', param: 'blacks', aliases: ['black', 'low'] },
      { key: 'whites', label: 'White point', hint: 'Colours this bright and above go white. Above 1 dims the whites.', type: 'num', def: 0.97, min: 0.5, max: 2, node: '', param: 'whites', aliases: ['white', 'high'] },
      { key: 'curve', label: 'S-curve', hint: '0 is a straight line between the points; 1 a full S-curve (more contrast in the mids).', type: 'num', def: 0.5, min: 0, max: 1, node: '', param: 'strength', aliases: ['strength', 's'] },
    ],
  },
  {
    kind: 'saturation', label: 'Saturation', words: ['saturation', 'sat', 'vibrance'], nodes: ['colorSaturation'],
    blurb: 'More colour (above 1) or less (below 1, 0 is grey).',
    params: [{ key: 'amount', label: 'Saturation', hint: '1 is as it is, 0 grey, 2 twice as colourful.', type: 'num', def: 1.3, min: 0, max: 3, primary: true, node: '', param: 'amount', aliases: ['sat'] }],
  },
  {
    kind: 'hue', label: 'Hue shift', words: ['hue', 'hue-shift', 'hue-rotate'], nodes: ['hueRotate'],
    blurb: 'Turns every colour round the colour wheel.',
    params: [{ key: 'angle', label: 'Turn', hint: 'Degrees round the colour wheel: 120 turns red to green.', type: 'num', def: 30, min: -180, max: 180, step: 1, deg: true, primary: true, node: '', param: 'angle', aliases: ['deg', 'shift'] }],
  },
  {
    kind: 'shadows', label: 'Shadows / highlights', words: ['shadows', 'highlights', 'shadows-highlights'], nodes: ['shadowsHighlights'],
    blurb: 'Opens up the darks and holds back the lights, each on its own.',
    params: [
      { key: 'shadows', label: 'Shadows', hint: 'Above 0 lifts the darks; below 0 deepens them.', type: 'num', def: 0.2, min: -1, max: 1, primary: true, node: '', param: 'shadows', aliases: ['dark'] },
      { key: 'highlights', label: 'Highlights', hint: 'Below 0 holds back the brights; above 0 pushes them.', type: 'num', def: -0.1, min: -1, max: 1, node: '', param: 'highlights', aliases: ['light'] },
      { key: 'pivot', label: 'Pivot', hint: 'Where the darks end and the lights begin.', type: 'num', def: 0.5, min: 0.1, max: 0.9, node: '', param: 'pivot' },
    ],
  },
  {
    kind: 'lgg', label: 'Lift / gamma / gain', words: ['lgg', 'lift-gamma-gain', 'wheels'], nodes: ['liftGammaGain'],
    blurb: 'The colourist\'s three wheels: tint the darks (lift), the mids (gamma) and the lights (gain).',
    params: [
      { key: 'lift', label: 'Lift', hint: 'Added to the darks, per channel: a little blue lifts the shadows cool.', type: 'rgb', def: [0, 0, 0.03], min: -0.5, max: 0.5, node: '', param: 'lift' },
      { key: 'gamma', label: 'Gamma', hint: 'Bends the mid-tones, per channel: above 1 brighter mids.', type: 'rgb', def: [1, 1, 1], min: 0.2, max: 3, node: '', param: 'gamma' },
      { key: 'gain', label: 'Gain', hint: 'Multiplies the lights, per channel: a little red and green warms the highlights.', type: 'rgb', def: [1.04, 1.01, 0.96], min: 0, max: 2, node: '', param: 'gain' },
    ],
  },
  {
    kind: 'temperature', label: 'Temperature', words: ['temperature', 'temp', 'white-balance', 'warmth'], nodes: ['blackbody', 'blendModes'],
    blurb: 'Warms or cools the picture, like a photo filter: the light of a colour temperature multiplied over it.',
    params: [
      { key: 'kelvin', label: 'Kelvin', hint: 'The light\'s temperature: 2000 candle-warm, 6500 daylight (no change), 10000 cool blue sky.', type: 'num', def: 4500, min: 1500, max: 12000, step: 50, primary: true, node: ':light', param: 'kelvin', aliases: ['k'] },
      { ...AMOUNT, def: 0.5, node: '', param: 'opacity' },
    ],
  },
  {
    kind: 'posterize', label: 'Posterize', words: ['posterize', 'poster', 'bands'], nodes: ['posterize'],
    blurb: 'Rounds every colour to a few steps: flat bands like a screen print.',
    params: [{ key: 'levels', label: 'Steps', hint: 'Steps per channel: 2 is stark, 8 subtle.', type: 'num', def: 6, min: 2, max: 32, step: 1, integer: true, primary: true, node: '', param: 'levels', aliases: ['steps'] }],
  },
  {
    kind: 'invert', label: 'Invert', words: ['invert', 'negative'], nodes: ['invert', 'mix'],
    blurb: 'A negative: dark becomes light and every colour its opposite.',
    params: [{ ...AMOUNT }],
  },
  {
    kind: 'duotone', label: 'Duotone', words: ['duotone', 'two-tone'], nodes: ['luminance', 'colorRamp', 'mix'],
    blurb: 'The picture in two colours: its darks in one, its lights in the other.',
    params: [
      { key: 'dark', label: 'Darks', hint: 'The colour the darks become.', type: 'colour', def: [0.1, 0.05, 0.25], node: ':ramp', param: 'color0', aliases: ['a', 'low'] },
      { key: 'light', label: 'Lights', hint: 'The colour the lights become.', type: 'colour', def: [1, 0.8, 0.45], node: ':ramp', param: 'color1', aliases: ['b', 'high'] },
      { ...AMOUNT },
    ],
  },
  {
    kind: 'gradient-map', label: 'Gradient map', words: ['gradient-map', 'map', 'palette-map'], nodes: ['luminance', 'colorRamp', 'mix'],
    blurb: 'The picture\'s brightness read through the scene\'s palette: darks take its first colour, lights its last.',
    params: [{ ...AMOUNT, def: 0.85 }],
  },
];

export const GRADE_BY_KIND: Record<string, StackKindDef> = Object.fromEntries(GRADE_KINDS.map(d => [d.kind, d]));
export const GRADE_WORDS: Record<string, string> = Object.fromEntries(GRADE_KINDS.flatMap(d => d.words.map(w => [w, d.kind])));

/** The node a grade item's setting sets: its role (the item's role plus the param's suffix) and key. */
export const gradeRole = (it: StackItem) => `grade:${it.id}`;

const rad = (deg: number) => Math.round(deg * Math.PI / 180 * 1e6) / 1e6;
const v3 = (v: unknown, d: Vec3): Vec3 => (Array.isArray(v) && v.length === 3 ? [v[0], v[1], v[2]] : d);

/** A Mix of two colours with t as its own (live) Blend. */
function mixColours(c: Ctx, role: string, a: Ref, b: Ref, t: number, note: string): Ref {
  const n = mk(c, 'mix', role, { outputType: 'vec3', t }, { a, b }, note);
  for (const k of ['a', 'b']) n.inputs[k] = { ...n.inputs[k], type: 'vec3' };
  for (const k of Object.keys(n.outputs)) n.outputs[k] = { ...n.outputs[k], type: 'vec3' };
  return ref(n, 'result');
}

/** A ramp from colours (evenly spaced), as the Color Ramp node takes them. */
const rampParams = (cols: readonly Vec3[]) => ({ stops: String(Math.max(2, Math.min(8, cols.length))), ...Object.fromEntries(cols.slice(0, 8).map((col, i) => [`color${i}`, [...col]])) });

export interface GradeOpts {
  /** The scene palette's colours (Gradient map). */
  swatches: readonly Vec3[];
}

/** The grade stack after `color`, in order; items that are off are left out. */
export function emitGrades(c: Ctx, items: readonly StackItem[] | undefined, color: Ref, opts: GradeOpts): Ref {
  let cur = color;
  const list = (items ?? []).filter(it => it.on && GRADE_BY_KIND[it.kind]);
  list.forEach((it, i) => {
    const def = GRADE_BY_KIND[it.kind];
    const role = gradeRole(it);
    const P = (key: string) => def.params.find(p => p.key === key)!;
    const n = (key: string) => numOf(it, P(key));
    const step = `Grade ${i + 1} of ${list.length}`;
    let node: GraphNode;
    switch (it.kind) {
      case 'brightness':
        node = mk(c, 'brightnessContrast', role, { brightness: n('brightness'), contrast: n('contrast') }, { color: cur }, `${step}, Brightness / contrast: brightness ${fmt(n('brightness'))}, contrast ${fmt(n('contrast'))}. Built by the builder's Look → Grade.`);
        cur = ref(node, 'result');
        break;
      case 'levels':
        node = mk(c, 'toneCurve', role, { blacks: n('blacks'), whites: n('whites'), strength: n('curve') }, { color: cur }, `${step}, Levels: colours below ${fmt(n('blacks'))} go black, above ${fmt(n('whites'))} white, an S-curve of ${fmt(n('curve'))} between.`);
        cur = ref(node, 'color');
        break;
      case 'saturation':
        node = mk(c, 'colorSaturation', role, { amount: n('amount') }, { color: cur }, `${step}, Saturation × ${fmt(n('amount'))}: 1 is as it was, 0 grey.`);
        cur = ref(node, 'color');
        break;
      case 'hue':
        node = mk(c, 'hueRotate', role, { angle: rad(n('angle')) }, { color: cur }, `${step}, Hue shift: every colour turned ${fmt(n('angle'))}° round the colour wheel (the node takes radians).`);
        cur = ref(node, 'color');
        break;
      case 'shadows':
        node = mk(c, 'shadowsHighlights', role, { shadows: n('shadows'), highlights: n('highlights'), pivot: n('pivot') }, { color: cur }, `${step}, Shadows / highlights: the darks ${n('shadows') >= 0 ? 'lifted' : 'deepened'} by ${fmt(Math.abs(n('shadows')))}, the lights by ${fmt(n('highlights'))}.`);
        cur = ref(node, 'color');
        break;
      case 'lgg': {
        const lift = v3(stackValue(it, P('lift')), [0, 0, 0]), gamma = v3(stackValue(it, P('gamma')), [1, 1, 1]), gain = v3(stackValue(it, P('gain')), [1, 1, 1]);
        node = mk(c, 'liftGammaGain', role, { lift, gamma, gain }, { color: cur }, `${step}, Lift / gamma / gain: the darks plus (${lift.map(fmt).join(', ')}), the mids to the power of (${gamma.map(fmt).join(', ')}), the lights times (${gain.map(fmt).join(', ')}).`);
        cur = ref(node, 'color');
        break;
      }
      case 'temperature': {
        const light = mk(c, 'blackbody', `${role}:light`, { kelvin: n('kelvin') }, {}, `The colour of light at ${fmt(n('kelvin'))} K for the Temperature grade: below 6500 K warm, above cool.`);
        node = mk(c, 'blendModes', role, { mode: 'multiply', opacity: n('amount') }, { base: cur, blend: ref(light, 'color') }, `${step}, Temperature: the picture multiplied by that light, at ${fmt(n('amount'))} (a photo filter).`);
        cur = ref(node, 'result');
        break;
      }
      case 'posterize':
        node = mk(c, 'posterize', role, { levels: Math.round(n('levels')) }, { color: cur }, `${step}, Posterize: ${Math.round(n('levels'))} steps per channel.`);
        cur = ref(node, 'color');
        break;
      case 'invert': {
        node = mk(c, 'invert', role, {}, { color: cur }, `${step}, Invert: a negative of the picture.`);
        cur = mixColours(c, `${role}:mix`, cur, ref(node, 'color'), n('amount'), `Mixes the negative back over the picture: Blend ${fmt(n('amount'))} (1 all negative).`);
        break;
      }
      case 'duotone': case 'gradient-map': {
        const cols = it.kind === 'duotone' ? [v3(stackValue(it, P('dark')), [0, 0, 0]), v3(stackValue(it, P('light')), [1, 1, 1])] : opts.swatches.slice(0, 8);
        const luma = mk(c, 'luminance', `${role}:luma`, {}, { color: cur }, `How bright each pixel is (0 black, 1 white): what the ${def.label.toLowerCase()} reads.`);
        node = mk(c, 'colorRamp', `${role}:ramp`, rampParams(cols), { t: ref(luma, 'result') },
          it.kind === 'duotone' ? `${step}, Duotone: the darks become ${colourText(cols[0])}, the lights ${colourText(cols[1])}.` : `${step}, Gradient map: the brightness through the scene's palette (${cols.length} colours, darks first). Change the palette in the builder to change it.`);
        cur = mixColours(c, `${role}:mix`, cur, ref(node, 'color'), n('amount'), `Mixes the ${def.label.toLowerCase()} over the picture: Blend ${fmt(n('amount'))}.`);
        break;
      }
    }
  });
  return cur;
}

/** The node and param a grade setting sets, by role (for the Play menu). */
export function gradeParamTarget(it: StackItem, key: string): { role: string; param: string } | null {
  const p = GRADE_BY_KIND[it.kind]?.params.find(q => q.key === key);
  return p && p.param !== undefined ? { role: gradeRole(it) + (p.node ?? ''), param: p.param } : null;
}
