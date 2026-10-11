/**
 * raysExamples.ts — Radial Fast Blur (Light rays) in use (docs/radial-fast-blur.md): the word
 * LIGHT throwing rays, and colourful shapes bursting outward with long zoom streaks, the two looks
 * After Effects' CC Radial Fast Blur is known for. Built from the node definitions (graphBuilder.ts);
 * the letters are the Agent Builder's stroke font (agentBuilder/strokeFont.ts), one line per stroke
 * of an Expression Block, so nothing is downloaded.
 */
import type { ExampleGraph } from './exampleIndex';
import type { GraphNode } from '../types/nodeGraph';
import { colourCtl, ctl, n, play } from './graphBuilder';
import { layoutStrokes, strokeGlsl } from '../agentBuilder/strokeFont';

export const RAYS_EXAMPLE_INDEX: Record<string, { label: string; description: string; play: true }> = {
  raysLightText: {
    label: 'Light rays 1 · LIGHT', play: true,
    description: 'The word LIGHT throws bright rays outward, like CC Radial Fast Blur on text: a Pass holds the glowing letters, Radial Fast Blur (Brightest, with a Threshold) streaks their bright parts away from a centre just below them. Move the centre in Play.',
  },
  raysColourBurst: {
    label: 'Light rays 2 · Colour burst', play: true,
    description: 'Colourful shapes fly outward from a drifting centre and Radial Fast Blur streaks them into long zoom trails behind them (Brightest, zooming in, the Centre wired to the same drifting point). Four hidden passes of 8 reads each: 4096 reads along every streak.',
  },
};

/** The ordered keys (the Effects & Lens folder lists them). */
export const RAYS_EXAMPLE_KEYS = Object.keys(RAYS_EXAMPLE_INDEX);

/** A node comment (shown on the card's Comment tab and, as // lines, in the generated code). */
const note = (text: string | string[]) => ({ __comment: Array.isArray(text) ? text.join('\n') : text });

/** An Expression Block: named inputs (wired as given), lines `type name = rhs`, a result; its note explains every named line. */
function expr(id: string, x: number, y: number, o: {
  label: string; outputType: 'float' | 'vec2' | 'vec3';
  inputs: Array<[name: string, type: 'float' | 'vec2' | 'vec3', from: [string, string]]>;
  lines: Array<[lhs: string, rhs: string]>;
  result: string; note: string[];
}): GraphNode {
  const node = n('exprNode', id, x, y, {
    label: o.label,
    inputs: o.inputs.map(([name, type]) => ({ name, type, slider: null })),
    outputType: o.outputType,
    lines: o.lines.map(([lhs, rhs]) => ({ lhs, op: '=', rhs })),
    result: o.result, expr: o.result,
    ...note(o.note),
  });
  node.inputs = Object.fromEntries(o.inputs.map(([name, type, from]) => [name, { type, label: name, connection: { nodeId: from[0], outputKey: from[1] } }]));
  node.outputs = { result: { type: o.outputType, label: 'Result' } };
  return node;
}

export function buildRaysExamples(): Record<string, ExampleGraph> {
  const g: Record<string, ExampleGraph> = {};

  // ── 1 · LIGHT: stroke-font letters → Pass → Radial Fast Blur (Brightest) ──
  const strokes = layoutStrokes('LIGHT').strokes;
  g.raysLightText = {
    ...RAYS_EXAMPLE_INDEX.raysLightText,
    counter: 20,
    nodes: [
      n('uv', 'uv', 40, 300, note('UV: this pixel, centred (the frame is 2 tall).')),
      expr('word', 340, 300, {
        label: 'LIGHT', outputType: 'vec3',
        inputs: [['uv', 'vec2', ['uv', 'uv']]],
        lines: [
          ['vec2 q', 'uv * 3.4'],
          ['float d', '1e5'],
          ...strokes.map((s): [string, string] => ['d', `min(d, ${strokeGlsl(s)})`]),
          ['float ink', '1.0 - smoothstep(0.15, 0.2, d)'],
          ['float core', '1.0 - smoothstep(0.0, 0.1, d)'],
          ['float pulse', '0.85 + 0.15 * sin(t * 2.0)'],
        ],
        result: '(vec3(1.0, 0.55, 0.2) * ink + vec3(1.0, 0.95, 0.85) * core) * pulse',
        note: [
          'LIGHT: the word in the stroke font (the Agent Builder\'s), as a distance: each letter is a few strokes, and d is the nearest one.',
          'q: the picture scaled to the font\'s units (letters 2 tall), so the word is about a third of the frame high.',
          'd: the distance to the nearest stroke, one line per stroke (L, I, G, H, T).',
          'ink: 1 on the letters (strokes 0.17 thick), with a soft edge.',
          'core: a thinner white-hot line down the middle of each stroke: the part bright enough to throw rays.',
          'pulse: the letters breathe a little, so the rays flicker with them.',
          'result: orange letters with a white core on black.',
        ],
      }),
      n('pass', 'pic', 700, 300, { label: 'Pass · letters', ...note('Pass: holds the letters as a texture, so Radial Fast Blur can read them along each streak (anywhere, not only this pixel).') }, { color: ['word', 'result'] }),
      n('radialFastBlur', 'rays', 1000, 300, {
        mode: 'brightest', direction: 'out', length: 1.4, centerX: 0, centerY: -0.12, threshold: 0.5, knee: 0.25, intensity: 1.25, decay: 0.75, falloff: 0.15, tint: [1, 0.8, 0.55],
        ...note([
          'Radial Fast Blur (Light rays): the letters\' bright cores streaked out from a point just below their middle, and laid over them where the streaks are brighter (Brightest: CC Radial Fast Blur\'s light-ray mode).',
          'Threshold 0.5 keeps only the white cores, so the rays come from the light, not the orange edges. Decay fades each ray along its length; Tint warms them.',
          'Wire Mouse UV into Centre to aim the rays with the pointer.',
        ]),
      }, { texture: ['pic', 'texture'] }),
      n('output', 'out', 1300, 300, note('Output: the letters and their rays. The Pass and the four hidden streak passes draw first each frame.'), { color: ['rays', 'color'] }),
    ],
    play: play([
      ctl('len', 'rays::length', 'Ray length', 0, 4, 0.01),
      ctl('cx', 'rays::centerX', 'Centre X', -1.5, 1.5, 0.01),
      ctl('cy', 'rays::centerY', 'Centre Y', -1, 1, 0.01),
      ctl('thr', 'rays::threshold', 'Threshold', 0, 1.5, 0.01),
      ctl('int', 'rays::intensity', 'Intensity', 0, 4, 0.01),
      colourCtl('tint', 'rays::tint', 'Ray colour'),
    ], `**What it shows.** The classic “text throwing light” look of CC Radial Fast Blur. The letters go into a Pass; Radial Fast Blur reads that Pass thousands of times along a line from each pixel toward the Centre, keeps the brightest colour it meets (Brightest), and lays it over the letters.

**Try.** Drag Centre X and Y (or map the pointer onto them) to swing the rays round. Lower Threshold to let the orange edges throw rays too; raise Length for a light-speed burst. Long rays cost the same: four small passes of 8 reads, each reading the one before 8 times further apart.`),
  };

  // ── 2 · Colour burst: shapes flying outward → Pass → Radial Fast Blur (Brightest, zooming in) ──
  g.raysColourBurst = {
    ...RAYS_EXAMPLE_INDEX.raysColourBurst,
    counter: 20,
    nodes: [
      n('uv', 'uv', 40, 300, note('UV: this pixel, centred (the frame is 2 tall).')),
      expr('origin', 40, 560, {
        label: 'Burst centre', outputType: 'vec2',
        inputs: [['uv', 'vec2', ['uv', 'uv']]],
        lines: [],
        result: 'vec2(0.25 * sin(t * 0.21), 0.12 * sin(t * 0.17 + 1.0))',
        note: [
          'Burst centre: the point the shapes fly out from, drifting slowly (t is the clock). It also goes to Radial Fast Blur\'s Centre, so the streaks always point back to it.',
          'result: a slow figure-of-eight round the middle of the frame.',
        ],
      }),
      expr('shapes', 400, 300, {
        label: 'Shapes flying out', outputType: 'vec3',
        inputs: [['uv', 'vec2', ['uv', 'uv']], ['o', 'vec2', ['origin', 'result']]],
        lines: [
          ['vec2 v', 'uv - o'],
          ['float ang', 'atan(uv.y - o.y, uv.x - o.x)'],
          ['float k', 'floor(ang / 0.3926991 + 8.0)'],
          ['float h', 'fract(sin(k * 12.9898) * 43758.5453)'],
          ['float life', 'fract(t * (0.18 + 0.12 * h) + h)'],
          ['float r', '0.08 + life * life * 2.2'],
          ['float a0', '(k - 7.5) * 0.3926991 + (h - 0.5) * 0.2'],
          ['vec2 c', 'vec2(cos(a0), sin(a0)) * r'],
          ['float size', '0.03 + 0.07 * life * (0.6 + h)'],
          ['vec2 w', 'abs(v - c)'],
          ['float d', 'h > 0.5 ? length(v - c) - size : max(w.x, w.y) - size * 0.85'],
          ['float k2', 'floor(ang / 0.3926991 + 8.5)'],
          ['float h2', 'fract(sin(k2 * 78.233) * 43758.5453)'],
          ['float life2', 'fract(t * (0.15 + 0.1 * h2) + h2 + 0.5)'],
          ['float r2', '0.08 + life2 * life2 * 2.2'],
          ['float a2', '(k2 - 8.0) * 0.3926991'],
          ['float d2', 'length(v - vec2(cos(a2), sin(a2)) * r2) - (0.02 + 0.05 * life2)'],
          ['vec3 col', '0.55 + 0.45 * cos(6.2831853 * (h + vec3(0.0, 0.33, 0.67)))'],
          ['vec3 col2', '0.55 + 0.45 * cos(6.2831853 * (h2 + 0.5 + vec3(0.0, 0.33, 0.67)))'],
          ['float in1', '1.0 - smoothstep(-0.004, 0.004, d)'],
          ['float in2', '1.0 - smoothstep(-0.004, 0.004, d2)'],
        ],
        result: 'col * in1 * 1.2 + col2 * in2 * (1.0 - in1) * 1.2',
        note: [
          'Shapes flying out: two rings of shapes, one shape per wedge of the circle round the burst centre, each flying outward and starting again.',
          'v: this pixel from the burst centre. ang: its angle.',
          'k: which of the 16 wedges it is in. h: a random number for that wedge (its colour, speed and shape).',
          'life: how far through its flight the wedge\'s shape is (0 at the centre, 1 off the frame), each at its own speed.',
          'r: its distance from the centre, speeding up as it goes (life²). a0: its angle (the wedge\'s middle, nudged).',
          'c: where the shape is. size: it grows as it comes closer.',
          'w, d: a circle (h above ½) or a square, as a distance.',
          'k2 … d2: a second ring of smaller dots, in the wedges between, half a flight behind.',
          'col, col2: a bright colour for each from a cosine palette.',
          'in1, in2: 1 inside each shape.',
          'result: the shapes on black, a little brighter than 1 so their streaks stay vivid.',
        ],
      }),
      n('pass', 'pic', 760, 300, { label: 'Pass · shapes', ...note('Pass: holds the shapes as a texture for Radial Fast Blur to read along each streak.') }, { color: ['shapes', 'result'] }),
      n('radialFastBlur', 'rays', 1060, 300, {
        mode: 'brightest', direction: 'in', length: 1.1, threshold: 0, knee: 0.15, intensity: 1, decay: 0.7, falloff: 0, tint: [1, 1, 1],
        ...note([
          'Radial Fast Blur: Zoom Into the centre reads each pixel\'s line outward, so every shape leaves a trail back toward the burst centre: speed lines behind things flying out.',
          'Brightest keeps the brightest colour along each line (so the trails keep the shapes\' own colours) and Decay fades them toward their tails.',
          'Centre is wired to the burst centre, so the trails always point back to it as it drifts.',
        ]),
      }, { texture: ['pic', 'texture'], center: ['origin', 'result'] }),
      n('output', 'out', 1360, 300, note('Output: the shapes and their zoom trails.'), { color: ['rays', 'color'] }),
    ],
    play: play([
      ctl('len', 'rays::length', 'Trail length', 0, 4, 0.01),
      ctl('decay', 'rays::decay', 'Decay', 0, 1, 0.01),
      ctl('int', 'rays::intensity', 'Intensity', 0, 4, 0.01),
    ], `**What it shows.** Colourful shapes bursting outward with long zoom streaks, the other classic CC Radial Fast Blur look. The streak is the picture read thousands of times along a line through the Centre, and here the Centre is wired to the same drifting point the shapes fly out from.

**Try.** Raise Trail length toward 3 for a light-speed burst; lower Decay for even, solid trails. Switch the node's Mode to Average for a plain zoom blur, or to Add for glowing trails.`),
  };

  return g;
}
