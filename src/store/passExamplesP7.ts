/**
 * passExamplesP7.ts — Passes 7 to 9 (docs/pass-node-plan.md, phase 7): a jump-flood
 * distance field from a repeated Pass, Edges straight from a picture (no copy
 * Pass), and a blur group with a Pass inside, used twice. Built from the node
 * definitions (graphBuilder.ts) and listed in the Passes folder after Passes 6.
 *
 * Every node carries a plain-language comment saying what it does and why it
 * is there; an Expression Block's comment explains each named line
 * ("name: …"). The comments land in the generated code too.
 */
import type { ExampleGraph } from './exampleIndex';
import type { GraphNode } from '../types/nodeGraph';
import type { PlayRecord } from '../types/play';
import { ctl, group, n, port } from './graphBuilder';
import RIDGES_AT_DUSK from './playAssets/ridges-at-dusk.jpg?inline';

export const PASS_EXAMPLE_INDEX_P7: Record<string, { label: string; description: string; play: true }> = {
  passJumpFlood: {
    label: 'Passes 7 · Jump-flood distance field', play: true,
    description: 'A Pass set to Repeat 10 runs ten times a frame, each time reading its own last result: the jump flood. It turns a few moving shapes into a distance field (every pixel learns how far the nearest shape is), drawn as glowing contour rings.',
  },
  passEdgesFromPicture: {
    label: 'Passes 8 · Edges straight from a picture', play: true,
    description: 'A Texture Input\'s new Texture output goes straight into Edges (texture) and Blur (texture), with no copy Pass in between: the photo\'s outlines glow over a soft, dimmed copy of it. Load your own picture on the Texture Input.',
  },
  passBlurGroup: {
    label: 'Passes 9 · A reusable blur group', play: true,
    description: 'A plain group holding a Pass and a Blur (texture): a soft glow you can copy. It is used twice on a neon sign: once at ½ size for a tight halo, then again on that halo at ⅛ size for a wide bloom, both added over the tubes.',
  },
};

/** A node comment (shown on the card's Comment tab and, as // lines, in the generated code). */
const note = (text: string | string[]) => ({ __comment: Array.isArray(text) ? text.join('\n') : text });

function playRecord(controls: PlayRecord['controls'], notes: string): PlayRecord {
  return { version: 1, controls, mappings: [], layers: [], notes };
}

/**
 * An Expression Block: named inputs (wired as given), lines `type name = rhs`, a result. Its note
 * must explain every named line as "name: …" (the examples test checks it).
 */
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

const uvNode = (id: string, x: number, y: number, what: string) => n('uv', id, x, y, note(`UV: this pixel's place in the picture (centred: a picture height is 2, x runs across by the aspect). ${what}`));

/**
 * The blur group of Passes 9: a Pass (at `scale`) of what comes in, blurred by `radius` picture
 * pixels. `id` keeps each copy's inner ids its own (as copying a group does).
 */
function softGlowGroup(id: string, x: number, y: number, o: { label: string; scale: string; radius: number; from: [string, string]; why: string }): GraphNode {
  const inner = [
    n('pass', `${id}Pass`, 260, 0, { label: 'Pass · held', scale: o.scale,
      ...note([
        `Pass (inside the group): draws whatever comes into the group into a texture of its own, at ${o.scale === '0.125' ? '⅛' : o.scale === '0.25' ? '¼' : '½'} size, so the Blur next to it can read the pixels round each one.`,
        'A Pass can sit in a plain group (one run, Iterations 1): the group is opened for the cut, so its Pass draws like any other. Not in an iterated, sealed or 3D group.',
      ]) },
      { color: port('c') }),
    n('blurTexture', `${id}Blur`, 560, 0, { method: 'smooth', radius: o.radius,
      ...note(`Blur (texture): spreads the Pass's picture over ${o.radius} picture pixels, a smooth Gaussian (Method Smooth: hidden passes across and down, on a smaller copy when the Radius is wide). A smaller Pass makes it cheaper still: a quarter or a sixty-fourth of the pixels.`) },
      { texture: [`${id}Pass`, 'texture'] }),
  ];
  const g = group(id, x, y, {
    label: o.label, iterations: 1,
    inputs: [{ key: 'c', type: 'vec3', label: 'Colour', from: o.from }],
    outputs: [{ key: 'o', type: 'vec3', label: 'Glow', from: [`${id}Blur`, 'color'] }],
    nodes: inner,
  });
  g.params.__comment = [
    `${o.label} (a group): a Pass and a Blur (texture) packed as one card: colour in, its soft glow out. ${o.why}`,
    'Open it (double-click) to see the two nodes; copy the card to reuse it, each copy draws a Pass of its own.',
  ].join('\n');
  return g;
}

export function buildPassExamplesP7(): Record<string, ExampleGraph> {
  const graphs: Record<string, ExampleGraph> = {};

  // ── 7 · Jump-flood distance field: shapes → seeds → Pass (Repeat 10) ↺ Jump flood → contour rings ──
  graphs.passJumpFlood = {
    ...PASS_EXAMPLE_INDEX_P7.passJumpFlood,
    counter: 40,
    nodes: [
      uvNode('uv', 40, 260, 'The shapes are drawn at it, and every seed stores it.'),
      expr('jfShape', 300, 120, {
        label: 'Shapes', outputType: 'float',
        inputs: [['uv', 'vec2', ['uv', 'uv']]],
        lines: [
          ['vec2 toRing', 'uv - vec2(0.35 * sin(t * 0.4), 0.2 * cos(t * 0.3))'],
          ['float ring', 'abs(length(toRing) - 0.35) - 0.025'],
          ['vec2 toDot', 'uv - vec2(-1.0 + 0.25 * sin(t * 0.7), -0.5)'],
          ['float blob', 'length(toDot) - 0.07'],
          ['float bar', 'max(abs(uv.x - 1.05) - 0.02, abs(uv.y - 0.3 * sin(t * 0.5)) - 0.3)'],
          ['float nearest', 'min(min(ring, blob), bar)'],
        ],
        result: 'step(nearest, 0.0)',
        note: [
          'What: the shapes whose distance field is built: a drifting ring, a small dot and a sliding bar. 1 inside a shape, 0 outside. Any mask works here: text, a thresholded picture, a 3D render.',
          't is the clock (the block reads Time itself), so the shapes move and the field follows them every frame.',
          'toRing: this pixel seen from the ring\'s centre, which wanders slowly.',
          'ring: the distance to the ring\'s line, minus its half-thickness (below 0 on the ring).',
          'toDot: this pixel seen from the dot\'s centre, low on the left.',
          'blob: the distance to the dot (below 0 inside it).',
          'bar: the distance to a thin upright bar on the right that slides up and down.',
          'nearest: the nearest of the three: below 0 inside any shape.',
          'result: 1 inside a shape, 0 outside (a hard edge: the seeds are the shape\'s pixels).',
        ],
      }),
      expr('jfSeed', 620, 120, {
        label: 'Seeds', outputType: 'vec3',
        inputs: [['inside', 'float', ['jfShape', 'result']], ['uv', 'vec2', ['uv', 'uv']]],
        lines: [],
        result: 'inside > 0.5 ? vec3(uv, 1.0) : vec3(0.0)',
        note: [
          'Seeds: what the jump flood starts from. A pixel inside a shape stores its own place (x, y in red and green) and 1 in blue ("I know a seed"); every other pixel stores 0 ("none known yet").',
          'result: the seed colour. It needs the half-float Pass: places can be negative or above 1, which 8-bit would clip.',
        ],
      }),
      expr('jfReach', 620, 420, {
        label: 'Reach this step', outputType: 'float',
        inputs: [['stepNow', 'float', ['jfPass', 'step']], ['stepCount', 'float', ['jfPass', 'steps']]],
        lines: [],
        result: 'exp2(stepCount - stepNow)',
        note: [
          'Reach this step: how far the jump flood looks on each repeat, in picture pixels. stepNow is the Pass\'s Step output (which repeat is drawing, 0 to 9) and stepCount its Steps output (its Repeat, 10).',
          'result: 2 to the power (stepCount − stepNow): 512 picture pixels on step 1, then 256, 128 … down to 2 on step 9 (one texel of the ½-size Pass). Halving the reach each time is the "jump" in jump flood: ten steps cover a picture a thousand pixels across.',
        ],
      }),
      n('jumpFloodTexture', 'jfFlood', 900, 360, {
        ...note([
          'Jump flood (texture): one step of the flood. It reads the Pass\'s Previous (its own last repeat) here and at 8 places Reach pixels away, and keeps the nearest seed any of them knows.',
          'After the reach has halved down to one texel, every pixel holds the nearest point of the shapes.',
        ]) },
        { texture: ['jfPass', 'previous'], reach: ['jfReach', 'result'] }),
      expr('jfStep', 1180, 200, {
        label: 'Start, then flood', outputType: 'vec3',
        inputs: [['seed', 'vec3', ['jfSeed', 'result']], ['flood', 'vec3', ['jfFlood', 'seed']], ['stepNow', 'float', ['jfPass', 'step']]],
        lines: [],
        result: 'stepNow < 0.5 ? seed : flood',
        note: [
          'Start, then flood: what the Pass stores on each repeat. On step 0 the seeds (the shapes as they are this frame), on every later step the flood\'s result.',
          'result: the seeds on the first repeat, the nearest seed found after it.',
        ],
      }),
      n('pass', 'jfPass', 1460, 200, {
        label: 'Pass · jump flood', scale: '0.5', format: 'half', filter: 'nearest', repeat: 10,
        ...note([
          'Pass with Repeat 10: drawn ten times each frame, and each time its Previous output is the repeat just before (on the first, the last repeat of the frame before). Its Step output says which repeat is drawing.',
          'Half size: the flood runs on a quarter of the pixels; Filter Nearest keeps the stored places exact (Linear would blend two places into a wrong one); Half float keeps them signed. The card shows 10 × the time of one draw.',
        ]) },
        { color: ['jfStep', 'result'] }),
      n('jumpFloodTexture', 'jfRead', 1740, 200, { reach: 2,
        ...note('Jump flood (texture), once more in the picture: reads the finished field at full size with a reach of one texel, so the distance is smooth instead of blocky. Distance is how far this pixel is from the nearest shape, in picture units.') },
        { texture: ['jfPass', 'texture'] }),
      n('constant', 'jfWidth', 1740, 520, { value: 1, label: 'Glow width',
        ...note('How far the glow reaches round the shapes. A constant so Play can drive it: see the Glow width control.') }),
      expr('jfLook', 2020, 260, {
        label: 'Contour glow', outputType: 'vec3',
        inputs: [['d', 'float', ['jfRead', 'distance']], ['width', 'float', ['jfWidth', 'value']], ['inside', 'float', ['jfShape', 'result']]],
        lines: [
          ['float glow', 'exp(-d * 9.0 / max(width, 0.05))'],
          ['float rings', '0.5 + 0.5 * cos(d * 60.0 - t * 4.0)'],
          ['float fade', 'exp(-d * 2.2)'],
          ['vec3 hue', '0.5 + 0.5 * cos(6.2832 * (d * 0.7 + vec3(0.0, 0.33, 0.67)) - t * 0.3)'],
        ],
        result: 'mix(hue * (glow * 1.3 + rings * fade * 0.3), vec3(1.0), inside)',
        note: [
          'Contour glow: draws the distance field. Every effect here only needs the distance, which is what the jump flood gave each pixel.',
          'glow: a soft light falling off with the distance; Glow width stretches it.',
          'rings: contour lines every 0.1 of distance, moving outwards with the clock (t).',
          'fade: the rings dim far from the shapes.',
          'hue: the colour cycles with the distance, so each ring has its own.',
          'result: the coloured glow and rings, and the shapes themselves in white (inside is the Shapes mask at full size, sharper than the field\'s ½-size seeds).',
        ],
      }),
      n('output', 'out', 2300, 260, note('Output: the distance field drawn as glowing contour rings. This program runs after the Pass has drawn its ten repeats.'), { color: ['jfLook', 'result'] }),
    ],
    play: playRecord([
      ctl('width', 'jfWidth::value', 'Glow width', 0.2, 4, 0.05),
    ], `**What it shows.** A Pass that repeats. With **Repeat** above 1 a Pass draws several times each frame, and each draw reads the one before through its **Previous** output; its **Step** output says which repeat is drawing. That is what a jump flood needs: ten rounds of "look further away, keep the nearest seed".

**How it is built.** Shapes → Seeds (each shape pixel stores its own place). The Pass (½ size, Nearest, Repeat 10) stores the seeds on step 0, then Jump flood (texture) reads its Previous at a reach that halves every step (Reach this step, from the Pass's Step and Steps). Afterwards every pixel knows the nearest shape point; Jump flood once more at full size gives the distance, and Contour glow draws it.

**Try.** Set the Pass's Repeat to 5: the reach no longer covers the picture and the field breaks into blocks far from the shapes. Set its Filter to Linear to see why Nearest matters. Swap Shapes for your own mask (a Texture Input's alpha, text, a 3D render) to give anything a distance glow.`),
  };

  // ── 8 · Edges straight from a picture: Texture Input → Edges / Blur (texture), no copy Pass ──
  graphs.passEdgesFromPicture = {
    ...PASS_EXAMPLE_INDEX_P7.passEdgesFromPicture,
    counter: 40,
    images: { epImage: RIDGES_AT_DUSK },
    nodes: [
      uvNode('uv', 40, 300, 'The pulse along the outlines spreads out from the centre with it.'),
      n('textureInput', 'epImage', 300, 300, { fit: 'stretch',
        ...note([
          'Texture Input: the picture (ridges at dusk, until you load your own with Load image).',
          'Its Texture output is the image itself as a texture, so Edges and Blur (texture) can read the pixels round each one without a Pass copying it first. Before, this needed Texture Input → Pass → Edges.',
        ]) }),
      n('edgesTexture', 'epEdges', 600, 160, { strength: 3, width: 1.5,
        ...note('Edges (texture): reads the picture at the 8 pixels round this one (a 3×3 Sobel on brightness). Edges is 1 on outlines, Color the picture\'s own colour kept on them. Width is in picture pixels: raise it for bolder lines on a busy photo.') },
        { texture: ['epImage', 'texture'] }),
      n('blurTexture', 'epSoft', 600, 460, { method: 'smooth', radius: 14,
        ...note('Blur (texture): a soft copy of the picture, read straight from its texture too, as the dim backdrop under the lines.') },
        { texture: ['epImage', 'texture'] }),
      n('constant', 'epGain', 900, 620, { value: 1.6, label: 'Line glow',
        ...note('How bright the outlines glow. A constant so Play can drive it: see the Line glow control.') }),
      expr('epLook', 900, 300, {
        label: 'Glowing outlines', outputType: 'vec3',
        inputs: [['soft', 'vec3', ['epSoft', 'color']], ['edges', 'float', ['epEdges', 'edges']], ['tint', 'vec3', ['epEdges', 'color']], ['uv', 'vec2', ['uv', 'uv']], ['gain', 'float', ['epGain', 'value']]],
        lines: [
          ['float pulse', '0.65 + 0.35 * sin(t * 2.0 - length(uv) * 5.0)'],
          ['vec3 back', 'soft * 0.35'],
          ['float keep', 'smoothstep(0.2, 0.6, edges)'],
          ['vec3 line', '(tint * 1.6 + vec3(1.0, 0.8, 0.55) * 0.7) * keep * pulse'],
        ],
        result: 'back + line * gain',
        note: [
          'Glowing outlines: lays the picture\'s outlines, lit, over a dim soft copy of it.',
          'pulse: a slow wave of brightness travelling out from the centre (t is the clock).',
          'back: the blurred picture, darkened, so the lines stand out.',
          'keep: 1 on clear outlines, 0 on faint ones, so the photo\'s grain and soft gradients don\'t light up.',
          'line: the kept outlines in the picture\'s own colours plus a warm white, pulsing.',
          'result: the backdrop with the lines added, Line glow times as bright.',
        ],
      }),
      n('output', 'out', 1180, 300, note('Output: the picture\'s outlines glowing over its blurred copy. One program: no Pass is drawn at all.'), { color: ['epLook', 'result'] }),
    ],
    play: playRecord([
      ctl('gain', 'epGain::value', 'Line glow', 0, 4, 0.05),
      ctl('strength', 'epEdges::strength', 'Edge strength', 0, 8, 0.05),
      ctl('soft', 'epSoft::radius', 'Backdrop blur', 0, 40, 0.5),
    ], `**What it shows.** A Texture Input (and a Video Input) has a **Texture** output: the image itself, ready for Sample, Edges, Blur, Glow and Displace (texture) and for Particles' Emit from. No copy Pass is needed in between, so this graph is a single program.

**How it is built.** The picture's Texture goes into Edges (texture), which reads the pixels round each one, and into Blur (texture) for a soft backdrop. An Expression Block lays the lit outlines over the dimmed blur.

**Try.** Load your own picture on the Texture Input. Raise Edges' Width for a busy photo. Swap the Texture Input for a Video Input and wire its Texture the same way for moving outlines.`),
  };

  // ── 9 · A reusable blur group: a plain group holding a Pass, used twice (tight halo + wide bloom) ──
  graphs.passBlurGroup = {
    ...PASS_EXAMPLE_INDEX_P7.passBlurGroup,
    counter: 40,
    nodes: [
      uvNode('uv', 40, 300, 'The tubes of the sign are drawn at it.'),
      expr('bgSign', 300, 300, {
        label: 'Neon sign', outputType: 'vec3',
        inputs: [['uv', 'vec2', ['uv', 'uv']]],
        lines: [
          ['float ringD', 'abs(length(uv - vec2(-0.6, 0.05)) - 0.32)'],
          ['float squareD', 'abs(max(abs(uv.x - 0.3), abs(uv.y - 0.05)) - 0.3)'],
          ['float waveD', 'abs(uv.y + 0.55 + 0.04 * sin(uv.x * 9.0 + t * 2.0))'],
          ['float flick', '0.8 + 0.2 * step(0.3, fract(sin(floor(t * 8.0) * 12.9898) * 43758.5453))'],
          ['vec3 tubes', 'vec3(1.0, 0.25, 0.6) * smoothstep(0.012, 0.0, ringD) + vec3(0.2, 0.8, 1.0) * smoothstep(0.012, 0.0, squareD) * flick + vec3(1.0, 0.7, 0.2) * smoothstep(0.01, 0.0, waveD) * step(abs(uv.x), 1.0)'],
        ],
        result: 'tubes * 1.6',
        note: [
          'Neon sign: three thin tubes of light on black: a pink ring, a blue square and a gold wave. They are what the two glow groups blur.',
          'ringD: the distance to the ring\'s line.',
          'squareD: the distance to the square\'s outline.',
          'waveD: the distance to a wavy line along the bottom, rippling with the clock (t).',
          'flick: the blue tube flickers now and then, like a failing neon.',
          'tubes: each tube\'s colour where its distance is under about a pixel; the wave stops at the sides.',
          'result: the tubes, brighter than white (1.6), so the glows have light to spread.',
        ],
      }),
      softGlowGroup('bgTight', 640, 160, { label: 'Soft glow · tight', scale: '0.5', radius: 6, from: ['bgSign', 'result'], why: 'This copy holds the sign at ½ size and blurs it 6 pixels: the halo hugging the tubes.' }),
      softGlowGroup('bgWide', 940, 560, { label: 'Soft glow · wide', scale: '0.125', radius: 48, from: ['bgTight', 'o'], why: 'The same group again, fed the tight halo, at ⅛ size and 48 pixels: the wide bloom round the whole sign. (For one node that does both, try Glow (texture) with its Bloom chain.)' }),
      n('constant', 'bgGain', 1240, 620, { value: 6, label: 'Bloom',
        ...note('How strong the wide bloom is. A constant so Play can drive it: see the Bloom control.') }),
      expr('bgMix', 1240, 300, {
        label: 'Tubes and glows', outputType: 'vec3',
        inputs: [['neon', 'vec3', ['bgSign', 'result']], ['tight', 'vec3', ['bgTight', 'o']], ['wide', 'vec3', ['bgWide', 'o']], ['gain', 'float', ['bgGain', 'value']]],
        lines: [],
        result: 'neon + tight * 2.0 + wide * gain',
        note: [
          'Tubes and glows: adds the two glows over the sharp tubes: light only adds, so nothing is hidden.',
          'result: the sign, its tight halo (twice) and the wide bloom (times Bloom: a blur of a thin tube is faint, so it needs a big gain).',
        ],
      }),
      n('output', 'out', 1520, 300, note('Output: the sign with both glows. The two groups\' Passes draw first (Show passes tints them), then this picture.'), { color: ['bgMix', 'result'] }),
    ],
    play: playRecord([
      ctl('bloom', 'bgGain::value', 'Bloom', 0, 16, 0.1),
    ], `**What it shows.** A Pass can live inside a plain group: a group run once (Iterations 1), not sealed and not 3D. Here a Pass and a Blur (texture) make one card, Soft glow, used twice with different settings.

**How it is built.** The sign goes into the first group, which draws it into its own Pass at ½ size and blurs it 6 pixels; its halo goes into the second copy, at ⅛ size and 48 pixels. An Expression Block adds both glows over the tubes. Texture wires can also go in and out of a plain group: give it a texture input from inside (Add input → texture).

**Try.** Open a group and change its Blur's Radius or its Pass's Scale. Copy a group card for a third glow. Set a group's Iterations to 2 to see the error: a Pass would be drawn again on every repeat, so use the Pass's own Repeat instead.`),
  };

  return graphs;
}
