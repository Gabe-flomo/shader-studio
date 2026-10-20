/**
 * raysExamples.ts — Radial Fast Blur (Light rays) in use (docs/radial-fast-blur.md): the word
 * LIGHT throwing rays, and colourful shapes bursting outward with long zoom streaks, the two looks
 * After Effects' CC Radial Fast Blur is known for. Built from the node definitions (graphBuilder.ts);
 * the word is the Text node (the preview's font atlas), so nothing is downloaded.
 */
import type { ExampleGraph } from './exampleIndex';
import type { GraphNode } from '../types/nodeGraph';
import { colourCtl, ctl, n, nv, play } from './graphBuilder';

export const RAYS_EXAMPLE_INDEX: Record<string, { label: string; description: string; play: true }> = {
  raysLightText: {
    label: 'Light rays 1 · LIGHT', play: true,
    description: 'Light shafts through a word, lit like a film title: a lamp drifts behind LIGHT and only the light that gets through the letters is drawn. A Pass holds it, Radial Fast Blur (Add) fans it out from the lamp into soft shafts, and a grade tone-maps, vignettes and grains the frame.',
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

  // ── 1 · LIGHT: a lamp behind the word → letters lit through → Pass → Radial Fast Blur (Add) → grade ──
  g.raysLightText = {
    ...RAYS_EXAMPLE_INDEX.raysLightText,
    counter: 20,
    nodes: [
      n('uv', 'uv', 40, 300, note('UV: this pixel, centred (the frame is 2 tall). The word, the lamp\'s light and the grade all read it.')),
      n('time', 'time', 40, 620, note('Time: the clock that drifts the lamp.')),
      n('motion2D', 'sway', 340, 620, { mode: 'bob', speed: 0.0175, amount: 0.42, direction: 0, ...note([
        'Motion 2D (Bob): the lamp behind the word slides slowly from side to side, 0.42 each way, about once a minute.',
        'Why a motion and not a fixed point: the shafts swing as the lamp moves, which is what makes the light feel real.',
      ]) }, { time: ['time', 'time'] }),
      n('motion2D', 'lamp', 620, 620, { mode: 'bob', speed: 0.037, amount: 0.05, direction: 90, phase: 75, ...note([
        'Motion 2D (Bob, up and down): a second, slower drift added to the first (its Offset in), so the lamp never retraces the same line.',
        'Its Offset is the lamp: it goes to the light on the letters and to Radial Fast Blur\'s Centre, so the shafts always fan out from the lamp.',
      ]) }, { time: ['time', 'time'], offset: ['sway', 'offset'] }),
      n('text', 'word', 340, 140, { text: 'LIGHT', size: 0.42, spacing: 1.25, align: 'center', posX: 0, posY: 0.21, color: [1, 1, 1], ...note([
        'Text: the word, drawn in the shader from the font atlas. Its Mask is 1 inside the letters: the cuts in a dark panel that the lamp shines through.',
        'Size 0.42 makes the word about a fifth of the frame high; Position Y 0.21 is the top of the line, so the word sits on the middle.',
      ]) }, { uv: ['uv', 'uv'] }),
      n('circleSDF', 'reach', 620, 380, { radius: 0, ...note('Circle SDF, radius 0: simply how far this pixel is from the lamp (its Center is wired to the lamp).') }, { position: ['uv', 'uv'], offset: ['lamp', 'offset'] }),
      n('light', 'lampLight', 900, 380, { mode: 'glow', brightness: 2.6, tint: [3.2, 2.3, 1.4], ...note([
        'SDF Glow: the lamp\'s light at each pixel, e^(−2.6 × distance): bright on top of the lamp, fading over about half the frame, so letters near it burn and far ones stay dim.',
        'Tinted is that light times a warm tungsten colour, set well over 1 (3.2, 2.3, 1.4) so the nearest letters burn and the tone map rolls them off.',
      ]) }, { distance: ['reach', 'distance'] }),
      nv('vec3', 'multiply', 'lit', 1180, 300, note('Multiply: the lamp\'s light, only where the letters let it through (times the Text Mask). Everything else stays black.'), { a: ['lampLight', 'tinted'], b: ['word', 'mask'] }),
      n('pass', 'pic', 1440, 300, { label: 'Pass · letters', ...note('Pass: holds the lit letters as a texture, so Radial Fast Blur can read them anywhere along each shaft, not only at this pixel.') }, { color: ['lit', 'result'] }),
      n('radialFastBlur', 'rays', 1720, 300, {
        mode: 'add', direction: 'out', length: 3.2, centerX: 0, centerY: 0, threshold: 0.1, knee: 0.2, intensity: 0.9, opacity: 1, decay: 0.7, falloff: 0.25, tint: [0.95, 0.82, 0.7],
        ...note([
          'Radial Fast Blur (Add): the light through the letters smeared outward from the lamp and added up, which is how light shafts in haze look: long, soft, brightest at their roots.',
          'Centre is wired to the lamp, so the shafts swing as it drifts. Length 3.2 lets them reach the frame\'s edge; Intensity 0.9 and Decay fairly high (0.7) so they read as haze, not a glow. The tint is a touch cooler than the letters, so the letters stay the warmest thing in frame.',
          'Only the Rays output is used: Add Colours puts them under the letters.',
        ]),
      }, { texture: ['pic', 'texture'], center: ['lamp', 'offset'] }),
      n('addColor', 'both', 2000, 300, note('Add Colours: the letters plus their shafts.'), { a: ['lit', 'result'], b: ['rays', 'rays'] }),
      n('toneMap', 'tone', 2240, 300, { mode: 'tanh', ...note('Tone Map (Tanh): a soft curve, so where shafts pile up on a letter nothing clips to white.') }, { color: ['both', 'result'] }),
      n('vignette', 'vig', 2480, 300, { radius: 0.7, softness: 0.6, strength: 0.6, ...note('Vignette: darkens the corners, like a lens, to hold the eye on the word.') }, { color: ['tone', 'color'], uv: ['uv', 'uv'] }),
      n('grain', 'grain', 2720, 300, { mode: 'temporal', amount: 0.012, ...note('Grain: fine film noise that changes every frame, so the long soft gradients of the shafts don\'t band.') }, { color: ['vig', 'result'], uv: ['uv', 'uv'], time: ['time', 'time'] }),
      n('output', 'out', 2960, 300, note('Output: the graded frame. The Pass and the hidden shaft passes draw first each frame.'), { color: ['grain', 'color'] }),
    ],
    play: play([
      ctl('len', 'rays::length', 'Shaft length', 0, 4, 0.01),
      ctl('int', 'rays::intensity', 'Shaft strength', 0, 2, 0.01),
      ctl('decay', 'rays::decay', 'Decay', 0, 1, 0.01),
      ctl('thr', 'rays::threshold', 'Threshold', 0, 1.5, 0.01),
      colourCtl('tint', 'rays::tint', 'Shaft colour'),
    ], `**What it shows.** Light shafts through a word, the way a title is lit in film: a lamp drifts behind the letters, and only the light that gets through them is drawn. Radial Fast Blur (Add) smears that light outward from the lamp, so it fans into soft shafts; a grade tone-maps, vignettes and grains it.

**How it's built.** Two **Motion 2D** nodes drift the lamp. Their Offset goes to the lamp's light (Circle SDF → **SDF Glow**: how bright each part of the word is) and to Radial Fast Blur's Centre (where the shafts come from). The **Text** node's Mask lets the light through only inside the letters. The lit letters go into a Pass so the blur can read them along each shaft; Add Colours puts the Rays under the letters, and Tone Map, Vignette and Grain grade the frame.

**Try.** Raise Shaft strength for a smokier room; lower Decay for long, even shafts. Set the node's Mode to Brightest for the harder "text throwing light" look. Wire Mouse UV into the blur's Centre and the Circle SDF's Center to carry the lamp with the pointer. Type any word into the Text node.`),
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
