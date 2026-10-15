/**
 * lookPresets.ts — the standard Looks (docs/look-presets.md): the finishing touches the examples kept
 * writing by hand in an Expression Block called "Look" (lay one thing over another, a glowing line,
 * a cosine palette, colour pop, vignette, grain…), as built-in Expression Block presets. Each opens as
 * an ordinary Expression Block, so its code is there to read and change; every line is explained in
 * its note. They are listed under Looks in the library (Expressions) and found by the node search.
 *
 * Built in, so they can't be deleted or renamed; place one and save it as your own to keep a change.
 */
import type { ExprPreset } from '../types/exprPreset';
import type { NodeDefinition } from '../types/nodeGraph';

type Line = [string, string];
type In = ExprPreset['inputs'][number];
const f = (name: string, slider?: [number, number]): In => ({ name, type: 'float', slider: slider ? { min: slider[0], max: slider[1] } : null });
const v3 = (name: string): In => ({ name, type: 'vec3', slider: null });

function look(id: string, label: string, o: { inputs: In[]; lines: Line[]; result: string; values?: Record<string, number>; note: string[]; outputType?: ExprPreset['outputType'] }): ExprPreset {
  return {
    id: `look_${id}`, label, inputs: o.inputs, outputType: o.outputType ?? 'vec3',
    lines: o.lines.map(([lhs, rhs]) => ({ lhs, op: '=', rhs })), result: o.result,
    comment: o.note.join('\n'), values: o.values, savedAt: 0,
  };
}

export const LOOK_PRESETS: ExprPreset[] = [
  look('layOver', 'Lay over', {
    inputs: [v3('back'), v3('front'), f('amount', [0, 1])],
    lines: [['float a', 'clamp(amount, 0.0, 1.0)']],
    result: 'mix(back, front, a)',
    values: { amount: 1 },
    note: [
      'Lay over (a Look): one picture over another, by a mask. Wire Back (what is behind), Front (what goes on top) and Amount (a mask: 1 shows Front, 0 shows Back).',
      'a: the mask kept between 0 and 1, so a bright mask can\'t push past Front.',
      'Result: mix() blends Back into Front by a: the same as alpha over, with the mask as the alpha.',
    ],
  }),
  look('glowLine', 'Glowing line', {
    inputs: [f('d'), v3('colour'), f('width', [0.001, 0.1]), f('glow', [0, 2]), f('falloff', [1, 60])],
    lines: [
      ['float core', '1.0 - smoothstep(0.0, width, abs(d))'],
      ['float halo', 'exp(-abs(d) * falloff) * glow'],
      ['vec3 tint', 'length(colour) > 0.0 ? colour : vec3(1.0, 0.6, 0.25)'],
    ],
    result: 'tint * (core + halo)',
    values: { width: 0.01, glow: 0.6, falloff: 12 },
    note: [
      'Glowing line (a Look): any shape\'s outline as a bright line with a soft glow round it. Wire a distance into d (an SDF\'s Distance, a Lissajous Curve) and a Colour (unwired: warm orange).',
      'core: 1 on the outline, fading to 0 Width away on either side (abs(d): inside and outside alike).',
      'halo: the glow, falling off exponentially with distance: Falloff higher is a tighter glow, Glow how bright.',
      'tint: Colour, or orange while nothing is wired.',
      'Result: the colour, lit by the line and its glow. Add it over a background with Add, or use Lay over.',
    ],
  }),
  look('glowRing', 'Glow ring', {
    inputs: [f('radius', [0, 1]), f('thickness', [0.001, 0.1]), f('glow', [0, 2]), v3('colour')],
    lines: [
      ['vec2 q', 'g_uv'],
      ['float d', 'abs(length(q) - radius)'],
      ['float ring', '1.0 - smoothstep(thickness * 0.5, thickness, d)'],
      ['float halo', 'exp(-d * 8.0) * glow'],
      ['vec3 tint', 'length(colour) > 0.0 ? colour : vec3(0.4, 0.8, 1.0)'],
    ],
    result: 'tint * (ring + halo)',
    values: { radius: 0.4, thickness: 0.012, glow: 0.5 },
    note: [
      'Glow ring (a Look): a thin ring with a halo, round the middle of the picture. Wire Radius from a Memory or a beat to make it pulse.',
      'q: this pixel\'s place in the picture (g_uv: 0 in the middle, 1 at the top).',
      'd: how far the pixel is from the ring (its distance from the middle, minus Radius, either side).',
      'ring: 1 within Thickness of the ring, softened at its edge.',
      'halo: a glow fading away from the ring.',
      'tint: Colour, or ice blue while nothing is wired.',
      'Result: the ring and its halo in that colour, on black.',
    ],
  }),
  look('palette', 'Cosine palette', {
    inputs: [f('t'), f('shift', [0, 1]), f('cycles', [0, 4])],
    lines: [
      ['vec3 base', 'vec3(0.5, 0.5, 0.5)'],
      ['vec3 swing', 'vec3(0.5, 0.5, 0.5)'],
      ['vec3 freq', 'vec3(1.0, 1.0, 1.0)'],
      ['vec3 phase', 'vec3(0.0, 0.33, 0.67)'],
    ],
    result: 'base + swing * cos(6.2831853 * (freq * t * cycles + phase + shift))',
    values: { shift: 0, cycles: 1 },
    note: [
      'Cosine palette (a Look): turns any number into a colour (Inigo Quilez\'s palette): a value 0 → 1 runs once round a rainbow. Wire T (a distance, noise, Along, time).',
      'base: the middle colour every channel swings around.',
      'swing: how far each channel swings either side of base (0.5: all the way from black to full).',
      'freq: how many times each channel goes round for one turn of T.',
      'phase: where each channel starts its swing. Red, green and blue a third apart make a rainbow; try (0.0, 0.1, 0.2) for warm, (0.5, 0.2, 0.25) for sunset.',
      'Result: each channel a cosine wave of T. Shift turns the palette; Cycles repeats it.',
    ],
  }),
  look('colourPop', 'Colour pop', {
    inputs: [v3('picture'), f('mask'), f('grey', [0, 1]), f('rim', [0, 2]), v3('rimColour')],
    lines: [
      ['float lum', 'dot(picture, vec3(0.2126, 0.7152, 0.0722))'],
      ['vec3 dull', 'mix(picture, vec3(lum), grey) * 0.8'],
      ['float edge', 'clamp(4.0 * mask * (1.0 - mask), 0.0, 1.0)'],
      ['vec3 rimTint', 'length(rimColour) > 0.0 ? rimColour : vec3(1.0, 0.6, 0.2)'],
    ],
    result: 'mix(dull, picture * 1.1, clamp(mask, 0.0, 1.0)) + edge * rim * rimTint',
    values: { grey: 1, rim: 0.6 },
    note: [
      'Colour pop (a Look): keeps the colour inside a mask and greys out the rest, with a glowing rim on the mask\'s edge. Wire Picture (a video, a picture) and Mask (Segment\'s Mask, a shape\'s mask).',
      'lum: how bright the picture is, as people see it (green counts most, blue least).',
      'dull: the picture drained of colour by Grey (1: black and white), a little darker.',
      'edge: bright where the mask is half way (its soft edge), 0 well inside or outside it.',
      'rimTint: Rim colour, or orange while nothing is wired.',
      'Result: the full colour inside the mask, the dull one outside, and the rim on top.',
    ],
  }),
  look('vignette', 'Vignette', {
    inputs: [v3('colour'), f('amount', [0, 1]), f('size', [0.2, 2]), f('softness', [0.01, 1.5])],
    lines: [
      ['vec2 q', 'g_uv'],
      ['float fall', 'smoothstep(size, size - softness, length(q))'],
    ],
    result: 'colour * mix(1.0, fall, amount)',
    values: { amount: 0.6, size: 1.2, softness: 0.8 },
    note: [
      'Vignette (a Look): darkens the picture towards its corners, drawing the eye to the middle. Wire Colour (the finished picture).',
      'q: this pixel\'s place in the picture (0 in the middle).',
      'fall: 1 in the middle, falling to 0 between Size − Softness and Size away from it.',
      'Result: the colour dimmed by fall, by Amount (0: none).',
    ],
  }),
  look('toneMap', 'Tone map (filmic)', {
    inputs: [v3('colour'), f('exposure', [0, 4]), f('gamma', [1, 3])],
    lines: [
      ['vec3 x', 'max(colour * exposure, 0.0)'],
      ['vec3 film', 'clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0)'],
    ],
    result: 'pow(film, vec3(1.0 / gamma))',
    values: { exposure: 1, gamma: 1 },
    note: [
      'Tone map (a Look): brings very bright colours (glows added together, light over 1) back into range the way film does, instead of clipping them to flat white. Wire Colour last, just before Output.',
      'x: the colour times Exposure (brighter or darker before the curve), never below 0.',
      'film: the ACES filmic curve (Krzysztof Narkowicz\'s fit): a gentle toe in the darks, a soft shoulder that rolls highlights off towards white.',
      'Result: film with Gamma (1: as it is; 2.2 brightens the darks, for colours worked out in linear light).',
    ],
  }),
  look('grain', 'Film grain', {
    inputs: [v3('colour'), f('amount', [0, 0.5]), f('size', [0.5, 4])],
    lines: [
      ['vec2 cell', 'floor(gl_FragCoord.xy / size)'],
      ['float n', 'fract(sin(dot(cell + floor(u_time * 24.0) * 17.0, vec2(12.9898, 78.233))) * 43758.5453)'],
    ],
    result: 'colour + (n - 0.5) * amount',
    values: { amount: 0.08, size: 1 },
    note: [
      'Film grain (a Look): fine noise over the picture that changes every frame, like film. Wire Colour.',
      'cell: which grain this pixel is in (Size pixels across).',
      'n: a random number 0–1 for that grain, new 24 times a second (a hash of the cell and the time).',
      'Result: the colour nudged up or down by the grain, by Amount.',
    ],
  }),
  look('posterize', 'Posterize', {
    inputs: [v3('colour'), f('levels', [2, 16])],
    lines: [['float k', 'max(floor(levels), 1.0)']],
    result: 'floor(colour * k + 0.5) / k',
    values: { levels: 5 },
    note: [
      'Posterize (a Look): flattens smooth colour into a few bands, like a screen print. Wire Colour.',
      'k: the number of steps per channel, a whole number.',
      'Result: each channel rounded to the nearest step.',
    ],
  }),
  look('duotone', 'Duotone', {
    inputs: [v3('colour'), f('contrast', [0.2, 3])],
    lines: [
      ['vec3 dark', 'vec3(0.10, 0.05, 0.25)'],
      ['vec3 light', 'vec3(1.0, 0.75, 0.45)'],
      ['float lum', 'dot(colour, vec3(0.2126, 0.7152, 0.0722))'],
      ['float t', 'clamp((lum - 0.5) * contrast + 0.5, 0.0, 1.0)'],
    ],
    result: 'mix(dark, light, t)',
    values: { contrast: 1.2 },
    note: [
      'Duotone (a Look): the picture in two colours, dark for its shadows, light for its highlights. Wire Colour.',
      'dark: the shadow colour (deep violet). Change it to taste.',
      'light: the highlight colour (peach).',
      'lum: how bright the pixel is, as people see it.',
      't: that brightness with Contrast round the middle grey.',
      'Result: dark blended into light by t.',
    ],
  }),
  look('grade', 'Colour grade', {
    inputs: [v3('colour'), f('brightness', [-0.5, 0.5]), f('contrast', [0, 2]), f('saturation', [0, 2]), f('warmth', [-0.5, 0.5])],
    lines: [
      ['vec3 c', 'colour + brightness'],
      ['vec3 k', '(c - 0.5) * contrast + 0.5'],
      ['float lum', 'dot(k, vec3(0.2126, 0.7152, 0.0722))'],
      ['vec3 s', 'mix(vec3(lum), k, saturation)'],
    ],
    result: 's * vec3(1.0 + warmth * 0.3, 1.0, 1.0 - warmth * 0.3)',
    values: { brightness: 0, contrast: 1, saturation: 1, warmth: 0 },
    note: [
      'Colour grade (a Look): the four everyday adjustments in one block. Wire Colour.',
      'c: Brightness added to every channel.',
      'k: Contrast pushes colours away from middle grey (above 1) or towards it (below 1).',
      'lum: how bright the pixel is, as people see it.',
      's: Saturation: 0 is black and white, 1 as it was, 2 twice as colourful.',
      'Result: Warmth tints towards orange (above 0) or blue (below 0).',
    ],
  }),
  look('scanlines', 'Scanlines', {
    inputs: [v3('colour'), f('count', [50, 600]), f('strength', [0, 1]), f('roll', [0, 2])],
    lines: [
      ['float y', 'gl_FragCoord.y / u_resolution.y'],
      ['float band', '0.5 + 0.5 * sin((y + u_time * roll * 0.05) * count * 3.1415926)'],
    ],
    result: 'colour * (1.0 - strength * band)',
    values: { count: 240, strength: 0.25, roll: 0 },
    note: [
      'Scanlines (a Look): dark lines across the picture like an old screen. Wire Colour.',
      'y: how far up the picture this pixel is, 0 at the bottom, 1 at the top.',
      'band: a wave up the picture, Count dark lines tall, rolling slowly up with Roll.',
      'Result: the colour darkened along the lines by Strength.',
    ],
  }),
];

export const LOOK_PRESET_IDS = new Set(LOOK_PRESETS.map(p => p.id));

/** The Looks matching what was typed in the node search: by name, or all of them for "look". */
export function matchLooks(q: string): ExprPreset[] {
  const ql = q.trim().toLowerCase();
  if (!ql) return [];
  if ('looks'.startsWith(ql) && ql.length >= 3) return LOOK_PRESETS;
  return LOOK_PRESETS.filter(p => p.label.toLowerCase().includes(ql));
}

/** A Look as the node search shows it: the Expression Block's definition with the Look's name, note and sockets. */
export function lookDef(base: NodeDefinition, p: ExprPreset): NodeDefinition {
  return {
    ...base, label: p.label, description: p.comment ?? base.description,
    inputs: Object.fromEntries(p.inputs.map(i => [i.name, { type: i.type, label: i.name }])),
    outputs: { result: { type: p.outputType, label: 'Result' } },
  };
}
