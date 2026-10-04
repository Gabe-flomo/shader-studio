/**
 * passExamples.ts — examples for the Pass node (render to texture), built
 * from the node definitions (graphBuilder.ts). See docs/pass-node-plan.md.
 *
 * Every node carries a comment saying what it does and why it is there; the
 * comments also land in the generated code, above each node's lines.
 */
import type { ExampleGraph } from './exampleIndex';
import type { PlayRecord } from '../types/play';
import { ctl, n } from './graphBuilder';
import { buildPassExamplesMore, PASS_EXAMPLE_INDEX_MORE } from './passExamplesMore';
import { buildPassExamplesP7, PASS_EXAMPLE_INDEX_P7 } from './passExamplesP7';
import { buildDisplacementExamples, DISPLACEMENT_EXAMPLE_INDEX } from './displacementExamples';

export const PASS_EXAMPLE_INDEX: Record<string, { label: string; description: string; play: true }> = {
  passEdgeGlow: {
    label: 'Passes 1 · Edge glow', play: true,
    description: 'Render to texture, chained: a picture is drawn into a Pass, Edges (texture) finds its outlines by reading the pixels around each one, a second Pass at half size holds the edges, Blur (texture) spreads them into a glow, and an Expression Block lays the glow over the original. Every step is in the same frame.',
  },
  // Passes 2 to 5 (passExamplesMore.ts): particles born on edges, feedback trails, reaction-diffusion, glow the bright parts.
  ...PASS_EXAMPLE_INDEX_MORE,
  // Passes 7 to 9 (passExamplesP7.ts): a repeated jump-flood Pass, Edges straight from a picture, a blur group.
  ...PASS_EXAMPLE_INDEX_P7,
  // The Displacement Map node (displacementExamples.ts).
  ...DISPLACEMENT_EXAMPLE_INDEX,
};

/** The ordered keys, for the Passes folder. */
export const PASS_EXAMPLE_KEYS = Object.keys(PASS_EXAMPLE_INDEX);

/** A node comment (shown on the card's Comment tab and, as // lines, in the generated code). */
const note = (text: string) => ({ __comment: text });

function playRecord(controls: PlayRecord['controls'], notes: string): PlayRecord {
  return { version: 1, controls, mappings: [], layers: [], notes };
}

export function buildPassExamples(): Record<string, ExampleGraph> {
  const graphs: Record<string, ExampleGraph> = {};

  // ── 1 · Edge glow: picture → Pass → Edges → Pass (½) → Blur → over the picture ──
  const composite = n('exprNode', 'glowOver', 2380, 300, {
    label: 'Glow over picture',
    inputs: [
      { name: 'picture', type: 'vec3', slider: null },
      { name: 'glow', type: 'vec3', slider: null },
      { name: 'edges', type: 'vec3', slider: null },
      { name: 'gain', type: 'float', slider: null },
    ],
    outputType: 'vec3',
    lines: [
      { lhs: 'vec3 base', op: '=', rhs: 'picture * 0.6' },
      { lhs: 'vec3 halo', op: '=', rhs: 'glow * gain' },
      { lhs: 'vec3 lit', op: '=', rhs: 'base + halo + edges * 0.5' },
    ],
    result: 'lit / (1.0 + lit * 0.25)',
    expr: 'lit / (1.0 + lit * 0.25)',
    ...note([
      'What: lays the blurred edges over the original picture as a glow (the composite).',
      'Why an Expression Block: four small steps read better as code than as four Add / Multiply cards.',
      'base = picture * 0.6: dim the picture a little so the glow stands out against it.',
      'halo = glow * gain: the blurred edges, as bright as the Glow gain constant says (above 1 is fine: Pass B is half float).',
      'lit = base + halo + edges * 0.5: add the glow, plus half of the sharp edges so the outlines keep a crisp core.',
      'result = lit / (1 + lit * 0.25): a soft roll-off so the brightest overlaps don\'t clip to flat white.',
    ].join('\n')),
  });
  composite.inputs = {
    picture: { type: 'vec3', label: 'picture', connection: { nodeId: 'passPicture', outputKey: 'color' } },
    glow: { type: 'vec3', label: 'glow', connection: { nodeId: 'blur', outputKey: 'color' } },
    edges: { type: 'vec3', label: 'edges', connection: { nodeId: 'sharpEdges', outputKey: 'color' } },
    gain: { type: 'float', label: 'gain', connection: { nodeId: 'glowGain', outputKey: 'value' } },
  };
  composite.outputs = { result: { type: 'vec3', label: 'Result' } };

  graphs.passEdgeGlow = {
    ...PASS_EXAMPLE_INDEX.passEdgeGlow,
    counter: 40,
    nodes: [
      n('uv', 'uv', 40, 160, note('UV: this pixel\'s place in the picture (centred, a picture height is 2). The noise below is read at it.')),
      n('time', 'time', 40, 400, note('Time: seconds since the clock started. It drifts the noise, so the bands and their edges keep moving.')),
      n('fbm', 'noise', 300, 220, { scale: 2.2, time_scale: 0.12, octaves: 4,
        ...note('The picture to outline, made in the graph so the example needs no image: slow fractal noise drifting with Time. Any picture works here: a Texture Input, a Video, a 3D scene.') },
        { uv: ['uv', 'uv'], time: ['time', 'time'] }),
      n('palette', 'colour', 560, 220, { scale: 1.4, phase: [0.0, 0.15, 0.3],
        ...note('Colours the noise with a cosine palette, so each band of the noise gets its own hue.') },
        { value: ['noise', 'value'] }),
      n('posterize', 'bands', 820, 220, { levels: 5,
        ...note('Cuts the colours into 5 flat bands. Hard steps between bands are what Edges finds below; smooth noise would have almost no edges.') },
        { color: ['colour', 'color'] }),
      n('pass', 'passPicture', 1080, 220, { label: 'Pass A · picture',
        ...note('Pass A draws the picture into a texture of its own first. That is what lets Edges look at the pixels next to each one: inside one shader, a node can only see its own pixel. Scale 1 keeps it sharp.') },
        { color: ['bands', 'color'] }),
      n('edgesTexture', 'edges', 1340, 220, { strength: 3, width: 1.5,
        ...note('Edges (texture) reads Pass A at the 8 pixels around this one (a 3×3 Sobel on brightness) and keeps the picture\'s colour where it changes fast: the outlines of the bands. Width is how far apart the reads are, in picture pixels.') },
        { texture: ['passPicture', 'texture'] }),
      n('pass', 'passEdges', 1600, 220, { label: 'Pass B · edges', scale: '0.5',
        ...note('Pass B holds the edges in a second texture so the blur after it can read around them too. Scale ½: a quarter of the pixels, so the wide blur below costs a quarter as much and comes out softer. Half float keeps the glow from clipping.') },
        { color: ['edges', 'color'] }),
      n('blurTexture', 'blur', 1860, 220, { radius: 14, quality: '24',
        ...note('Blur (texture) spreads Pass B\'s edges into a soft halo: 24 reads in a disc 14 picture pixels wide. This is the glow. Unlike the older Gaussian Blur, it blurs this frame, not the last one.') },
        { texture: ['passEdges', 'texture'] }),
      n('sampleTexture', 'sharpEdges', 1860, 460, {
        ...note('Sample (texture) reads Pass B at this pixel, unblurred: the sharp outline, added back on top of the glow so the edges keep a bright core.') },
        { texture: ['passEdges', 'texture'] }),
      n('constant', 'glowGain', 1860, 640, { value: 2.2, label: 'Glow gain',
        ...note('How bright the glow is. A constant (not a slider inside the Expression Block) so Play can drive it: see the Glow control.') }),
      composite,
      n('output', 'out', 2640, 300, note('Output: the final picture, the glow laid over the picture. This program runs last, after Pass A and Pass B have drawn their textures.'), { color: ['glowOver', 'result'] }),
    ],
    play: playRecord([
      ctl('gain', 'glowGain::value', 'Glow', 0, 6, 0.05),
      ctl('radius', 'blur::radius', 'Glow width', 0, 40, 0.5),
      ctl('strength', 'edges::strength', 'Edge strength', 0, 8, 0.05),
      ctl('width', 'edges::width', 'Edge width', 0.5, 6, 0.25),
    ], `**What it shows.** Render to texture, chained like TouchDesigner TOPs. A shader can't normally look at the pixel next to the one it is drawing, so it can't find edges and then blur them. Pass nodes fix that: whatever is wired into a Pass is drawn into a texture first, and the nodes after it can read that texture anywhere.

**How it is built.** Noise → Palette → Posterize makes the picture. Pass A stores it. Edges (texture) reads Pass A around each pixel and keeps the outlines. Pass B (at ½ size) stores the outlines. Blur (texture) spreads them into a glow, Sample (texture) reads them sharp, and an Expression Block adds both over the picture (read back from Pass A, so the noise isn't computed twice). Texture wires are dashed.

**Try.** Raise Glow width: at ½ size it stays cheap. Set Pass B's Scale to ¼ for a softer, cheaper glow, or to 1 for a tighter one. Wire Pass A's Color straight to the Output to see the picture alone, or Pass B's to see just the edges. Swap the noise for a Texture Input to outline a photo.`),
  };

  Object.assign(graphs, buildPassExamplesMore(), buildDisplacementExamples());
  Object.assign(graphs, buildPassExamplesP7());
  return graphs;
}
