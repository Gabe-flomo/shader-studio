/**
 * textureToolExamples.ts — the Texture tools folder (docs/texture-tools.md): Mask, Levels, Flow,
 * Neighbours, Change, Outline (distance), Fade and Read in use, on a video, a Pass trail, an
 * Agents trail, reaction-diffusion, a photo and a jump flood. Built from the node definitions
 * (graphBuilder.ts).
 *
 * Every node carries a plain-language note saying what it does and why it is there; an
 * Expression Block's note explains each named line ("name: …"). Expression Blocks are kept only
 * where the maths is the point (the Gray-Scott step, the flood's reach): every reading and shaping
 * step is a Texture tool.
 */
import type { ExampleGraph } from './exampleIndex';
import type { GraphNode } from '../types/nodeGraph';
import type { PlayRecord } from '../types/play';
import { colourCtl, ctl, n } from './graphBuilder';
import { slimeMoldNodes } from './agentExamples';
import RIDGES_AT_DUSK from './playAssets/ridges-at-dusk.jpg?inline';

export const TEXTURE_TOOL_EXAMPLE_INDEX: Record<string, { label: string; description: string; play: true }> = {
  ttVideoOutline: {
    label: 'Texture tools 1 · Glowing outline from a video', play: true,
    description: 'A video (or the camera) becomes a glowing outline: Mask keeps its bright parts, Neighbours (Range) finds the mask\'s edge, Glow (texture) spreads it, Levels dims the video underneath. Choose a video or the camera on the Video Input.',
  },
  ttMotionTrails: {
    label: 'Texture tools 2 · Motion trails with Fade', play: true,
    description: 'Change (texture) finds where a drifting picture moves; Fade (feedback) keeps a fading trail of it, read through Read (texture) a little zoomed and turned so the trails swirl outwards; Levels rolls off the brightest overlaps.',
  },
  ttTrailFlow: {
    label: 'Texture tools 3 · A slime trail bends a picture', play: true,
    description: 'An Agents slime mold\'s Trail image goes into Flow (texture), which turns it into a direction along the veins; that flow pushes where a photo is read, so the picture is combed along the network.',
  },
  ttColourKey: {
    label: 'Texture tools 4 · Colour key on a video', play: true,
    description: 'Mask (texture) in Colour key mode picks the green out of a video (a green screen); Mix puts a drifting background where the key is. Choose a video or the camera on the Video Input.',
  },
  ttReactionLevels: {
    label: 'Texture tools 5 · Reaction-diffusion, shaped and coloured', play: true,
    description: 'Gray-Scott reaction-diffusion with Neighbours (Difference from average) as its Laplacian; Levels picks chemical B out of the Pass and shapes it, and a Stops Palette colours it.',
  },
  ttGrowShrink: {
    label: 'Texture tools 6 · Grow and shrink a mask', play: true,
    description: 'Neighbours in Max and Min mode grow and shrink the bright parts of a photo (dilate and erode); Mask thresholds each, and two Mix nodes paint the grown rim orange and the shrunk core teal over the dimmed photo.',
  },
  ttDistanceRings: {
    label: 'Texture tools 7 · Outline and rings from a jump flood', play: true,
    description: 'Mask\'s Seed output starts a jump flood of a photo\'s bright parts; Outline (distance) draws a line round them and moving rings outside them from the flood\'s Distance.',
  },
};

/** The ordered keys, for the Texture tools folder. */
export const TEXTURE_TOOL_EXAMPLE_KEYS = Object.keys(TEXTURE_TOOL_EXAMPLE_INDEX);

/** A node comment (shown on the card's Comment tab and, as // lines, in the generated code). */
const note = (text: string | string[]) => ({ __comment: Array.isArray(text) ? text.join('\n') : text });

function playRecord(controls: PlayRecord['controls'], notes: string): PlayRecord {
  return { version: 1, controls, mappings: [], layers: [], notes };
}

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

/** A Mix retyped to colours: A, B and the result are vec3 (as its type pill set to vec3). */
function colourMix(id: string, x: number, y: number, params: Record<string, unknown>, wires: Record<string, [string, string]>): GraphNode {
  const m = n('mix', id, x, y, { outputType: 'vec3', ...params }, wires);
  return { ...m, inputs: { ...m.inputs, a: { ...m.inputs.a, type: 'vec3' }, b: { ...m.inputs.b, type: 'vec3' } }, outputs: { result: { ...m.outputs.result, type: 'vec3' } } };
}

const photo = (id: string, x: number, y: number, why: string, wires: Record<string, [string, string]> = {}) =>
  n('textureInput', id, x, y, { fit: 'stretch', ...note([
    'Texture Input: a photo (ridges at dusk, until you load your own with Load image).',
    `Its Texture output is the image itself as a texture. ${why}`,
  ]) }, wires);

export function buildTextureToolExamples(): Record<string, ExampleGraph> {
  const g: Record<string, ExampleGraph> = {};

  // ── 1 · Video → Mask → Pass → Neighbours (Range) → Pass → Glow, over the dimmed video ──
  g.ttVideoOutline = {
    ...TEXTURE_TOOL_EXAMPLE_INDEX.ttVideoOutline,
    counter: 40,
    nodes: [
      n('videoInput', 'vid', 40, 300, note([
        'Video Input: the moving picture. Press Choose video (or the camera) on this card: until then it is black.',
        'Its Texture output is the video itself as a texture, read by Mask and Levels without a copy Pass.',
      ])),
      n('textureMask', 'vidMask', 340, 160, { source: 'brightness', threshold: 'soft', level: 0.45, width: 0.15,
        ...note('Mask (texture): 1 where the video is brighter than Level, fading in over Width (a soft threshold, so the mask doesn\'t flicker). Raise Level to keep only the brightest parts (a lit face in front of a dark room).') },
        { texture: ['vid', 'texture'] }),
      n('pass', 'maskPass', 640, 160, { label: 'Pass · mask', scale: '0.5',
        ...note('Pass: holds the mask as a texture at ½ size, so Neighbours can look round each pixel of it (a mask from a node is only this pixel; a Pass makes all of it readable).') },
        { color: ['vidMask', 'mask'] }),
      n('textureNeighbours', 'edge', 940, 160, { mode: 'range', size: '5', spacing: 1.5, strength: 1,
        ...note('Neighbours (texture), Range: the brightest minus the darkest pixel in a small disc round each one. Inside or outside the mask that is 0; across its edge it is 1: an outline of any shape. Spacing makes it thicker.') },
        { texture: ['maskPass', 'texture'] }),
      n('colorPicker', 'tint', 940, 440, { color: [0.35, 0.85, 1.0], ...note('Color: the outline\'s colour. Click the swatch to change it.') }),
      n('addColor', 'lines', 1240, 160, { scale: 1, ...note('Add Colors, used as tint × amount: B (the colour) times Scale (the outline) on black. The coloured outline.') },
        { b: ['tint', 'rgb'], scale: ['edge', 'value'] }),
      n('pass', 'linePass', 1540, 160, { label: 'Pass · lines', scale: '0.5',
        ...note('Pass: holds the coloured lines so Glow can blur round them. Half size keeps the wide glow cheap.') },
        { color: ['lines', 'result'] }),
      n('glowTexture', 'glow', 1840, 160, { threshold: 0.05, radius: 18, intensity: 2.2,
        ...note('Glow (texture): spreads the lines into a soft halo (Radius in picture pixels). Threshold low, so every line glows.') },
        { texture: ['linePass', 'texture'] }),
      n('textureLevels', 'back', 1840, 460, { outWhite: 0.3,
        ...note('Levels (texture): the video itself, Out white 0.3: the same picture at under a third of its brightness, a dim backdrop for the glow.') },
        { texture: ['vid', 'texture'] }),
      n('addColor', 'withGlow', 2140, 300, note('Add Colors: the dim video plus the glow (light only adds).'), { a: ['back', 'color'], b: ['glow', 'glow'] }),
      n('addColor', 'withLines', 2440, 300, note('Add Colors: plus the sharp lines on top, so the glow keeps a bright core.'), { a: ['withGlow', 'result'], b: ['linePass', 'color'] }),
      n('output', 'out', 2740, 300, note('Output: the video, dimmed, with its glowing outline. The two Passes draw first each frame.'), { color: ['withLines', 'result'] }),
    ],
    play: playRecord([
      ctl('level', 'vidMask::level', 'What counts as bright', 0, 1, 0.005),
      ctl('spacing', 'edge::spacing', 'Line thickness', 0.5, 6, 0.25),
      ctl('glow', 'glow::intensity', 'Glow', 0, 6, 0.05),
      colourCtl('tint', 'tint::color', 'Line colour'),
    ], `**What it shows.** Turning a raw video read into an outline, with Texture tools only. Mask picks the bright parts, Neighbours (Range) finds the edge of that mask, and Glow (texture) makes it light.

**How it is built.** Video → Mask (soft threshold) → Pass (½) → Neighbours, Range → tint → Pass (½) → Glow (texture). Levels on the same video makes the dim backdrop; two Add Colors lay the glow and the lines over it.

**Try.** Choose the camera on the Video Input. Move *What counts as bright* until only you are kept. Switch Mask's Source to Colour key to outline a coloured object instead.`),
  };

  // ── 2 · Drifting picture → Pass → Change → Fade (read through Read) → trails Pass → Levels ──
  g.ttMotionTrails = {
    ...TEXTURE_TOOL_EXAMPLE_INDEX.ttMotionTrails,
    counter: 40,
    nodes: [
      n('uv', 'uv', 40, 160, note('UV: this pixel\'s place in the picture. The noise is read at it.')),
      n('time', 'time', 40, 400, note('Time: seconds since the start. It drifts the noise, so the picture keeps moving.')),
      n('fbm', 'noise', 300, 220, { scale: 2.2, time_scale: 0.3, octaves: 4, ...note('Fractal Noise: slow, cloudy noise drifting with Time: the moving picture whose motion is traced. Any picture works: a video drawn into the Pass, particles, a 3D scene.') },
        { uv: ['uv', 'uv'], time: ['time', 'time'] }),
      n('palette', 'paint', 560, 220, { scale: 1.4, phase: [0.0, 0.15, 0.3], ...note('Palette: colours the noise, so the motion has colour to carry.') }, { value: ['noise', 'value'] }),
      n('posterize', 'bands', 820, 220, { levels: 4, ...note('Posterize: cuts the colours into 4 flat bands. Hard band edges are what moves visibly from frame to frame.') }, { color: ['paint', 'color'] }),
      n('pass', 'picPass', 1080, 220, { label: 'Pass · picture', scale: '0.5',
        ...note('Pass: holds the picture as a texture, and last frame\'s as its Previous: the two Change compares.') },
        { color: ['bands', 'color'] }),
      n('textureChange', 'moved', 1340, 220, { measure: 'colour', amount: 3, level: 0.15, width: 0.3,
        ...note('Change (texture): the picture now against a frame ago. Motion is bright where it changed; Color keeps the picture\'s own colour there. Amount for faint motion, Threshold to ignore flicker.') },
        { texture: ['picPass', 'texture'], before: ['picPass', 'previous'] }),
      n('readTexture', 'drift', 1340, 560, { zoom: 1.008, turn: 0.4,
        ...note('Read (texture): last frame of the trails, read 0.8% zoomed and turned 0.4°. Its UV output (the bent place) goes into Fade, so every frame the old trails grow outwards in a slow swirl.') },
        { texture: ['trails', 'previous'] }),
      n('textureFade', 'fade', 1640, 300, { tail: 1.5, clean: 0.05, tint: [0.55, 0.85, 1], combine: 'add',
        ...note([
          'Fade (feedback): last frame of the trails (read at Read\'s UV) faded, with the fresh motion added on top.',
          'Tail 1.5: seconds for a trail to fade to 1%, the same at any frame rate. Tint fades red fastest, so old trails cool to blue.',
        ]) },
        { texture: ['trails', 'previous'], uv: ['drift', 'uv'], fresh: ['moved', 'color'] }),
      n('pass', 'trails', 1940, 300, { label: 'Pass · trails',
        ...note('Pass: holds the trails. Its Previous goes back to Read and Fade, closing the feedback loop. Half float keeps stacked light above 1.') },
        { color: ['fade', 'color'] }),
      n('textureLevels', 'tone', 2200, 300, { gain: 1.4, rollOff: 0.5,
        ...note('Levels (texture): Gain 1.4 brightens the trails, Roll-off 0.5 bends the brightest overlaps down (x / (1 + 0.5x)) so they don\'t clip to flat white.') },
        { color: ['trails', 'color'] }),
      n('output', 'out', 2460, 300, note('Output: the motion trails.'), { color: ['tone', 'color'] }),
    ],
    play: playRecord([
      ctl('tail', 'fade::tail', 'Trail length (s)', 0.1, 8, 0.05),
      ctl('zoom', 'drift::zoom', 'Drift outwards', 0.98, 1.03, 0.0005),
      ctl('turn', 'drift::turn', 'Swirl', -3, 3, 0.05),
      ctl('amount', 'moved::amount', 'Motion gain', 0, 20, 0.1),
    ], `**What it shows.** The feedback-trail recipe (guide 1.11) without Expression Blocks: Change finds what moved, Read bends where last frame is read, and Fade dims it with a tail in seconds.

**How it is built.** Noise → Palette → Posterize is the moving picture, held in a Pass. Change compares the Pass with its Previous. Fade reads the trails Pass's Previous at Read's bent UV, fades it and adds the motion; the result goes back into the trails Pass. Levels rolls off the brightest overlaps.

**Try.** Trail length 6 for comet tails, 0.3 for sparks. Swirl negative to spin the other way. Set Read's Zoom below 1 for trails that sink inwards.`),
  };

  // ── 3 · Slime mold → Trail image → Flow (along the veins) → a photo read at the pushed UV ──
  const slime = slimeMoldNodes(0, 0, false);
  g.ttTrailFlow = {
    ...TEXTURE_TOOL_EXAMPLE_INDEX.ttTrailFlow,
    counter: 60,
    images: { tfPhoto: RIDGES_AT_DUSK },
    nodes: [
      ...slime,
      n('textureFlow', 'tfFlow', 1260, 420, { channel: 'red', direction: 'along', length: 'unit', strength: 0.025, reach: 4,
        ...note([
          'Flow (texture): reads the Trail field\'s Image and works out, at every pixel, the direction along its veins (Along the contours: the slope turned 90°).',
          'Unit length: every arrow is Strength long wherever there is trail, so thin and thick veins push alike. Reach 4: the slope is measured 4 pixels apart, smoothing the grain.',
        ]) },
        { texture: ['slimeTrail', 'texture'] }),
      photo('tfPhoto', 1680, 420, 'Its UV input is Flow\'s UV: each pixel reads the photo a little further along the nearest vein, so the picture is combed along the network.', { uv: ['tfFlow', 'uv'] }),
      n('constant', 'tfVeins', 1680, 720, { value: 0.5, label: 'Veins', ...note('How strongly the coloured veins show over the combed photo. A constant so Play can drive it.') }),
      n('addColor', 'tfOver', 2100, 300, note('Add Colors: the combed photo plus the coloured veins (Stops Palette), Veins times as bright.'), { a: ['tfPhoto', 'color'], b: ['slimeColour', 'color'], scale: ['tfVeins', 'value'] }),
      n('output', 'tfOut', 2400, 300, note('Output: the photo combed along the slime mold\'s veins, with the veins over it.'), { color: ['tfOver', 'result'] }),
    ],
    play: playRecord([
      ctl('strength', 'tfFlow::strength', 'Comb strength', -0.1, 0.1, 0.001),
      ctl('reach', 'tfFlow::reach', 'Smoothing', 0.5, 16, 0.5),
      ctl('veins', 'tfVeins::value', 'Veins', 0, 1.5, 0.01),
    ], `**What it shows.** An Agents trail is a texture like any other: Flow (texture) turns it into a direction field you can push anything with.

**How it is built.** The Slime mold preset (Emit → Agents → Deposit → Trail field). The Trail field's Image goes into Flow, set to Along the contours; Flow's UV output (this pixel moved along the flow) is the photo's UV. Add Colors lays the coloured trail over it.

**Try.** Set Flow's Direction to Uphill and the photo is pulled into the veins instead of along them. Raise Comb strength for a liquid smear; negative turns the flow round.`),
  };

  // ── 4 · Video → Mask (Colour key) → Mix with a background ──
  g.ttColourKey = {
    ...TEXTURE_TOOL_EXAMPLE_INDEX.ttColourKey,
    counter: 40,
    nodes: [
      n('videoInput', 'vid', 40, 200, note([
        'Video Input: a video shot against a green screen (or the camera in front of anything green). Press Choose video on this card: until then it is black.',
        'Its Texture output goes to Mask; its Color output to Mix.',
      ])),
      n('textureMask', 'key', 340, 200, { source: 'key', key: [0.1, 0.75, 0.2], tolerance: 0.3, softness: 0.15, threshold: 'off',
        ...note([
          'Mask (texture), Colour key: how close each pixel is to the Key colour. 1 within Tolerance, fading to 0 over Key softness (soft hair and motion blur keep their fringe).',
          'Threshold Off: the soft match is the mask as it is. Pick the screen\'s own green with the Key colour swatch.',
        ]) },
        { texture: ['vid', 'texture'] }),
      n('uv', 'uv', 40, 520, note('UV: this pixel\'s place, for the background noise.')),
      n('time', 'time', 40, 700, note('Time: drifts the background.')),
      n('fbm', 'bgNoise', 340, 560, { scale: 1.6, time_scale: 0.2, ...note('Fractal Noise: a drifting backdrop to put behind the person (any picture works: a Texture Input, a 3D scene).') }, { uv: ['uv', 'uv'], time: ['time', 'time'] }),
      n('palette', 'bg', 640, 560, { scale: 1.2, phase: [0.6, 0.7, 0.8], ...note('Palette: colours the backdrop.') }, { value: ['bgNoise', 'value'] }),
      colourMix('comp', 940, 260, { t: 0.5, ...note('Mix: the video where the key is 0, the backdrop where it is 1 (Blend is the key mask).') }, { a: ['vid', 'color'], b: ['bg', 'color'], t: ['key', 'mask'] }),
      n('output', 'out', 1240, 260, note('Output: the video with the green swapped for the backdrop.'), { color: ['comp', 'result'] }),
    ],
    play: playRecord([
      ctl('tol', 'key::tolerance', 'Tolerance', 0, 1, 0.005),
      ctl('soft', 'key::softness', 'Key softness', 0, 0.6, 0.005),
      colourCtl('keyColour', 'key::key', 'Key colour'),
    ], `**What it shows.** A green screen with one node: Mask (texture) in Colour key mode gives a soft mask of the key colour.

**How it is built.** The Video Input's Texture goes into Mask (Colour key); its Color and a noise backdrop go into Mix, with the mask as the blend.

**Try.** Choose a video or the camera. Pick the key colour from your screen, then raise Tolerance until the green is gone and Key softness until the edges look natural. Turn on Invert to keep only the green.`),
  };

  // ── 5 · Reaction-diffusion with Neighbours (Difference) → Levels → Stops Palette ──
  g.ttReactionLevels = {
    ...TEXTURE_TOOL_EXAMPLE_INDEX.ttReactionLevels,
    counter: 40,
    nodes: [
      n('uv', 'uv', 40, 560, note('UV: this pixel\'s place. The seed is placed with it.')),
      n('sampleTexture', 'state', 300, 160, {
        ...note('Sample (texture): this pixel\'s chemicals from the frame before (the Reaction-diffusion Pass\'s Previous). Red holds 1 − A (an empty texture means A = 1), green holds B.') },
        { texture: ['rd', 'previous'] }),
      n('textureNeighbours', 'lap', 300, 360, { mode: 'difference', size: '3', spacing: 2, strength: 1,
        ...note('Neighbours (texture), Difference from average: the 3 × 3 average round this pixel minus the pixel itself, per channel. That is the Laplacian, how the chemicals spread: positive in dips, negative on bumps. Spacing 2 picture pixels is one texel of the ½-size Pass: the next pixel over.') },
        { texture: ['rd', 'previous'] }),
      expr('seed', 300, 620, {
        label: 'Seed', outputType: 'float',
        inputs: [['uv', 'vec2', ['uv', 'uv']]],
        lines: [
          ['vec2 at', 'vec2(sin(t * 0.31), sin(t * 0.43 + 1.0)) * vec2(0.8, 0.45)'],
          ['float wander', 'smoothstep(0.035, 0.02, length(uv - at))'],
          ['float still', 'smoothstep(0.03, 0.015, length(uv - vec2(-0.5, 0.1))) + smoothstep(0.03, 0.015, length(uv - vec2(0.55, -0.2)))'],
        ],
        result: 'max(wander, still)',
        note: [
          'Seed: where chemical B is added, so the pattern has somewhere to start (an empty texture stays empty). t is the clock.',
          'at: a point wandering slowly round the picture.',
          'wander: a small dot at that point.',
          'still: two dots that stay put.',
          'result: 1 inside any of them.',
        ],
      }),
      n('constant', 'feed', 600, 640, { value: 0.0545, label: 'Feed', ...note('Feed: how fast A is topped up. With Kill it picks the pattern (0.0545 / 0.062 coral). A constant so Play can drive it.') }),
      n('constant', 'kill', 600, 800, { value: 0.062, label: 'Kill', ...note('Kill: how fast B is removed. Try steps of 0.001. A constant so Play can drive it.') }),
      expr('step', 860, 300, {
        label: 'Gray-Scott step', outputType: 'vec3',
        inputs: [
          ['prev', 'vec3', ['state', 'color']], ['lap', 'vec3', ['lap', 'color']], ['seed', 'float', ['seed', 'result']],
          ['feed', 'float', ['feed', 'value']], ['kill', 'float', ['kill', 'value']],
        ],
        lines: [
          ['float a', '1.0 - prev.r'],
          ['float b', 'prev.g'],
          ['float react', 'a * b * b'],
          ['float na', 'a - lap.r - react + feed * (1.0 - a)'],
          ['float nb', 'b + 0.5 * lap.g + react - (kill + feed) * b + seed * 0.5'],
        ],
        result: 'vec3(1.0 - clamp(na, 0.0, 1.0), clamp(nb, 0.0, 1.0), 0.0)',
        note: [
          'Gray-Scott step: one step of the model (guide 1.12). The spreading comes from Neighbours, so only the reaction is written here.',
          'a: chemical A (stored as 1 − A in red).',
          'b: chemical B (green).',
          'react: B turns A into more B, a·b·b of it.',
          'na: next A. lap.r is the spread of 1 − A, so A spreads by minus it; used by the reaction, topped up by Feed.',
          'nb: next B: spreads at half speed, grows by the reaction, dies at Kill + Feed, and is added where Seed is.',
          'result: both kept in 0–1, packed back as (1 − A, B, 0).',
        ],
      }),
      n('pass', 'rd', 1160, 300, { label: 'Reaction-diffusion', scale: '0.5',
        ...note('Reaction-diffusion: the Pass holding the two chemicals at ½ size. Its Previous hands the state back next frame. Half float keeps the small differences the model needs.') },
        { color: ['step', 'result'] }),
      n('textureLevels', 'shape', 1440, 300, { channel: 'green', inBlack: 0.08, inWhite: 0.38, gamma: 0.8, clamp: true,
        ...note([
          'Levels (texture): reads only the green channel (chemical B) of the Pass, so the stored red doesn\'t muddy the colour.',
          'In range 0.08–0.38: thin B becomes 0, thick B 1. Gamma 0.8 lifts the thin rims a little; Clamp keeps it in 0–1 for the palette.',
        ]) },
        { texture: ['rd', 'texture'] }),
      n('stopPalette', 'colour', 1720, 300, {
        stops: '5', wrap: 'clamp', blend: 'smooth', scale: 1, speed: 0,
        color0: [0.01, 0.02, 0.06], color1: [0.03, 0.25, 0.35], color2: [0.1, 0.62, 0.62], color3: [1.0, 0.5, 0.36], color4: [1.0, 0.9, 0.78],
        ...note('Stops Palette: the shaped B as colour: deep water, teal on the growing rims, coral in the body, pale where it is thickest.') },
        { value: ['shape', 'value'] }),
      n('output', 'out', 2000, 300, note('Output: the coloured pattern. The Reaction-diffusion Pass steps first each frame.'), { color: ['colour', 'color'] }),
    ],
    play: playRecord([
      ctl('feed', 'feed::value', 'Feed', 0.01, 0.1, 0.0005),
      ctl('kill', 'kill::value', 'Kill', 0.04, 0.075, 0.0005),
      ctl('gamma', 'shape::gamma', 'Rim lift (gamma)', 0.2, 3, 0.01),
    ], `**What it shows.** Passes 4 rebuilt with Texture tools: Neighbours gives the Laplacian, Levels picks and shapes one channel, a palette colours it.

**How it is built.** Sample (texture) and Neighbours (Difference from average) both read the Pass's Previous. The Gray-Scott step adds the reaction and the seed; the result goes back into the Pass. Levels (Channel: Green) shapes chemical B and Stops Palette colours it.

**Try.** Feed 0.0367 / Kill 0.0649 for dots that split; 0.078 / 0.061 for worms. Move Levels' In range to change how much of the pattern counts as "body". Set Neighbours' Spacing to 3 for bigger, softer cells.`),
  };

  // ── 6 · Photo → Neighbours Max / Min → Mask → two Mixes over the dimmed photo ──
  g.ttGrowShrink = {
    ...TEXTURE_TOOL_EXAMPLE_INDEX.ttGrowShrink,
    counter: 40,
    images: { gsPhoto: RIDGES_AT_DUSK },
    nodes: [
      photo('gsPhoto', 40, 300, 'Neighbours and Levels read it directly: no Pass needed, because the photo is already a texture.'),
      n('textureNeighbours', 'grow', 340, 120, { mode: 'max', size: '7', spacing: 2,
        ...note('Neighbours (texture), Max around: the brightest pixel in a disc round each one (7 reads across, 2 pixels apart). Bright parts grow by about 6 pixels: a dilate.') },
        { texture: ['gsPhoto', 'texture'] }),
      n('textureNeighbours', 'shrink', 340, 440, { mode: 'min', size: '7', spacing: 2,
        ...note('Neighbours (texture), Min around: the darkest pixel round each one. Bright parts shrink by the same amount: an erode.') },
        { texture: ['gsPhoto', 'texture'] }),
      n('textureMask', 'grownMask', 640, 120, { threshold: 'soft', level: 0.5, width: 0.04,
        ...note('Mask, on a plain Value (the grown brightness): 1 where it is above Level. Thresholding a grown brightness is the same as growing the mask.') },
        { value: ['grow', 'value'] }),
      n('textureMask', 'shrunkMask', 640, 440, { threshold: 'soft', level: 0.5, width: 0.04,
        ...note('Mask, on the shrunk brightness: the same threshold, so the core of the same shapes.') },
        { value: ['shrink', 'value'] }),
      n('textureLevels', 'dim', 640, 760, { outWhite: 0.3, ...note('Levels (texture): the photo at 30% brightness, the backdrop.') }, { texture: ['gsPhoto', 'texture'] }),
      n('colorPicker', 'rimColour', 940, 760, { color: [1.0, 0.55, 0.2], ...note('Color: the grown rim.') }),
      n('colorPicker', 'coreColour', 1240, 760, { color: [0.15, 0.75, 0.75], ...note('Color: the shrunk core.') }),
      colourMix('rim', 940, 300, { t: 0.5, ...note('Mix: orange wherever the grown mask is.') }, { a: ['dim', 'color'], b: ['rimColour', 'rgb'], t: ['grownMask', 'mask'] }),
      colourMix('core', 1240, 300, { t: 0.5, ...note('Mix: teal over the shrunk core. What stays orange is the rim between the grown and the shrunk shapes: twice the reach wide, centred on the original edge.') }, { a: ['rim', 'result'], b: ['coreColour', 'rgb'], t: ['shrunkMask', 'mask'] }),
      n('output', 'out', 1540, 300, note('Output: the photo\'s bright shapes, grown (orange rim) and shrunk (teal core).'), { color: ['core', 'result'] }),
    ],
    play: playRecord([
      ctl('grow', 'grow::spacing', 'Grow by', 0.5, 8, 0.25),
      ctl('shrink', 'shrink::spacing', 'Shrink by', 0.5, 8, 0.25),
      ctl('level', 'grownMask::level', 'Rim threshold', 0, 1, 0.005),
      ctl('levelCore', 'shrunkMask::level', 'Core threshold', 0, 1, 0.005),
    ], `**What it shows.** Thickening and thinning a mask (dilate and erode) with Neighbours in Max and Min mode.

**How it is built.** The photo's Texture goes into two Neighbours nodes; each result is thresholded by a Mask on its plain Value input. Two Mix nodes paint the grown shape orange and the shrunk shape teal over the photo dimmed by Levels.

**Try.** Raise Grow by: the rim widens without costing more reads. Set Size to 9 × 9 for a rounder reach (the Performance panel shows the loop's reads). Max then Min with the same reach closes small holes (a "closing").`),
  };

  // ── 7 · Photo → Mask (Seed) → jump flood (Pass, Repeat 10) → Outline (distance) ×2 ──
  g.ttDistanceRings = {
    ...TEXTURE_TOOL_EXAMPLE_INDEX.ttDistanceRings,
    counter: 40,
    images: { drPhoto: RIDGES_AT_DUSK },
    nodes: [
      photo('drPhoto', 40, 300, 'Mask reads it directly for the shapes to flood from.'),
      n('textureMask', 'drShape', 340, 160, { source: 'brightness', threshold: 'hard', level: 0.62,
        ...note('Mask (texture): 1 where the photo is brighter than Level (the sky and the lit ridges). Its Seed output is what the jump flood starts from: each pixel inside stores its own place.') },
        { texture: ['drPhoto', 'texture'] }),
      expr('drReach', 640, 480, {
        label: 'Reach this round', outputType: 'float',
        inputs: [['stepNow', 'float', ['drFlood', 'step']], ['stepCount', 'float', ['drFlood', 'steps']]],
        lines: [],
        result: 'exp2(stepCount - stepNow)',
        note: ['Reach this round: how far the flood looks, in picture pixels. stepNow is the Pass\'s Step, stepCount its Steps (Repeat).', 'result: 1024 pixels on the first round, halving every round down to 2.'],
      }),
      n('jumpFloodTexture', 'drStep', 940, 400, { ...note('Jump flood (texture): one round of the flood on the Pass\'s Previous (the round before): keeps the nearest seed any of 9 reads knows.') },
        { texture: ['drFlood', 'previous'], reach: ['drReach', 'result'] }),
      expr('drStart', 940, 160, {
        label: 'Start, then flood', outputType: 'vec3',
        inputs: [['seed', 'vec3', ['drShape', 'seed']], ['found', 'vec3', ['drStep', 'seed']], ['stepNow', 'float', ['drFlood', 'step']]],
        lines: [],
        result: 'stepNow < 0.5 ? seed : found',
        note: ['Start, then flood: what the Pass stores each round.', 'result: the seeds on round 0, the nearest seed found on every later round.'],
      }),
      n('pass', 'drFlood', 1240, 160, { label: 'Pass · jump flood', scale: '0.5', format: 'half', filter: 'nearest', repeat: 10,
        ...note('Pass, Repeat 10: drawn ten times a frame, each reading the round before through Previous. Nearest keeps the stored places exact; Half float keeps them signed.') },
        { color: ['drStart', 'result'] }),
      n('jumpFloodTexture', 'drRead', 1540, 160, { reach: 2, ...note('Jump flood (texture), once more on the finished field: Distance is how far each pixel is from the nearest bright shape, in picture units.') },
        { texture: ['drFlood', 'texture'] }),
      n('distanceShape', 'drLine', 1840, 60, { mode: 'outline', offset: 0.025, width: 0.008, softness: 0.004, tint: [1, 0.85, 0.5],
        ...note('Outline (distance): a line 0.025 out from the shapes, 0.008 wide: an outline of any width, from the distance alone. Offset moves it.') },
        { distance: ['drRead', 'distance'] }),
      n('distanceShape', 'drRings', 1840, 400, { mode: 'rings', offset: 0.06, spacing: 0.05, thickness: 0.006, softness: 0.004, fade: 4, speed: 0.4, tint: [0.4, 0.75, 1],
        ...note('Outline (distance), Rings: contour lines every 0.05 beyond the outline, moving outwards 0.4 rings a second and fading with distance.') },
        { distance: ['drRead', 'distance'] }),
      n('textureLevels', 'drDim', 1840, 720, { outWhite: 0.25, ...note('Levels (texture): the photo at a quarter of its brightness, under the lines.') }, { texture: ['drPhoto', 'texture'] }),
      n('addColor', 'drSum1', 2140, 300, note('Add Colors: the dim photo plus the rings.'), { a: ['drDim', 'color'], b: ['drRings', 'light'] }),
      n('addColor', 'drSum2', 2440, 300, note('Add Colors: plus the outline.'), { a: ['drSum1', 'result'], b: ['drLine', 'light'] }),
      n('output', 'drOut', 2740, 300, note('Output: the photo\'s bright shapes with an outline and moving rings, all from one distance field.'), { color: ['drSum2', 'result'] }),
    ],
    play: playRecord([
      ctl('level', 'drShape::level', 'Shape threshold', 0, 1, 0.005),
      ctl('offset', 'drLine::offset', 'Outline distance', -0.05, 0.3, 0.001),
      ctl('speed', 'drRings::speed', 'Ring speed', -2, 2, 0.01),
      ctl('spacing', 'drRings::spacing', 'Ring spacing', 0.01, 0.3, 0.001),
    ], `**What it shows.** Distance tools: once a jump flood has given every pixel its distance to a shape, Outline (distance) draws outlines, glows, rings or grown shapes from it, at any width, for the price of one read.

**How it is built.** Mask's Seed output starts the flood in a Pass repeated 10 times (guide 1.13). A last Jump flood reads the finished Distance; two Outline (distance) nodes draw a line and moving rings from it, added over the dimmed photo.

**Try.** Switch the rings node to Glow or Inside (grown shape). Move the outline further out with Outline distance. Change the Mask's Level to flood from other parts of the photo.`),
  };

  return g;
}
