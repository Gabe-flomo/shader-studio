/**
 * convolveExamples.ts — Convolve (docs/convolve.md): every kernel filter in one node. A sharpened photo, noise
 * embossed into stone, Voronoi cells drawn as ink lines, motion blur on a swinging ball, a Custom kernel that reads
 * only the left neighbour, and unsharp-mask "clarity" on a photo read as a texture. All six are listed in the
 * Convolve folder. Built from the node definitions (graphBuilder.ts); every node carries a note.
 */
import type { ExampleGraph } from './exampleIndex';
import { ctl, n, nv, play } from './graphBuilder';
import { note } from './agentExampleKit';
import { builtinImageParams, ROOM_AND_CAT_ID, WALKWAY_CAT_ID } from '../lib/builtinImages';

export const CONVOLVE_EXAMPLE_INDEX: Record<string, { label: string; description: string; play: true }> = {
  convolveSharpenPhoto: {
    label: 'Convolve: sharpen a photo', play: true,
    description: 'The built-in Walkway cat photo through Convolve\'s Sharpen preset: each pixel is 5 × itself minus its four neighbours, so wherever it differs from them the difference is pushed further. Mix fades between the original and the sharpened photo.',
  },
  convolveEmbossStone: {
    label: 'Convolve: noise embossed into stone', play: true,
    description: 'Soft Perlin Noise through the Emboss preset becomes carved stone: the neighbours towards the light are taken away, the ones away from it added, so every rise has a lit side and a shaded side. Turn the light with Angle.',
  },
  convolveVoronoiInk: {
    label: 'Convolve: Voronoi cells drawn as ink lines', play: true,
    description: 'Voronoi\'s Cell colour is flat inside each cell, so the Outline (Laplacian) kernel finds nothing there and a jump on every border: those jumps become black ink on paper. Spacing sets how thick the lines are.',
  },
  convolveMotionBall: {
    label: 'Convolve: motion blur on a swinging ball', play: true,
    description: 'A ball and a bar swinging side to side, smeared along their path by the Motion blur preset: an average of the reads along a line at Angle. Spacing sets how long the streaks are.',
  },
  convolveCustomLeft: {
    label: 'Convolve: a Custom kernel that reads only the left neighbour', play: true,
    description: 'The grid of numbers explained: a Custom 3 × 3 kernel with a single 1 in the left middle cell. Each pixel takes the colour of the pixel to its left, so the whole picture moves right by Spacing pixels. Mix 0.5 shows it over the original.',
  },
  convolveClarityPhoto: {
    label: 'Convolve: unsharp-mask "clarity" on a photo', play: true,
    description: 'The built-in Room and cat photo read as a Texture, through the Unsharp mask preset with a wide Radius: the original plus Amount × (the original − a blur of it), which deepens the contrast of the shapes rather than of the finest grain, as a photo editor\'s Clarity does.',
  },
};
export const CONVOLVE_EXAMPLE_KEYS = Object.keys(CONVOLVE_EXAMPLE_INDEX);
/** All six are listed in the Convolve folder (the new-node folders may hold more than five: owner, 22 October 2026). */
export const CONVOLVE_SHOWCASE_KEYS = CONVOLVE_EXAMPLE_KEYS;

export function buildConvolveExamples(): Record<string, ExampleGraph> {
  return {
    convolveSharpenPhoto: {
      ...CONVOLVE_EXAMPLE_INDEX.convolveSharpenPhoto,
      counter: 20,
      nodes: [
        n('textureInput', 'photo', 40, 260, { fit: 'cover', ...builtinImageParams(WALKWAY_CAT_ID), ...note(['Texture Input: the built-in photo Walkway cat (a grey cat on a stone walkway). Choose your own picture on this card. Fit is Fill, so the tall photo covers the picture.']) }),
        n('convolve', 'sharp', 360, 260, {
          preset: 'sharpen', size: '3', spacing: 1, mix: 1,
          ...note([
            'Convolve, Sharpen: the kernel on the card is 5 in the middle and −1 above, below, left and right. Each pixel becomes 5 × itself minus its four neighbours: on a flat patch that is the same colour (5 − 4 = 1), on an edge the difference is pushed further.',
            'The photo read is wired into Colour ƒ, so Convolve reads the photo again at each neighbour, Spacing pixels away.',
          ]),
        }, { colour: ['photo', 'color'] }),
        n('output', 'out', 680, 260, note(['Output: the sharpened photo.']), { color: ['sharp', 'colour'] }),
      ],
      play: play([
        ctl('mix', 'sharp::mix', 'Sharpen mix', 0, 1, 0.01),
        ctl('spacing', 'sharp::spacing', 'Spacing (pixels)', 0.25, 4, 0.25),
      ], `**What it shows.** Sharpening is a weighted sum: the pixel counted five times, its four neighbours taken away. The weights add up to 1, so flat areas stay as they were and only the edges change.

**How it is built.** Texture Input (Walkway cat) → Convolve's Colour ƒ, Preset Sharpen, 3 × 3.

**Try.** Drag *Sharpen mix* to 0 and back to compare. Raise *Spacing* to 2 or 3 for a halo round the big shapes. Set Size to 5 × 5 on the card for a softer sharpen.`),
    },

    convolveEmbossStone: {
      ...CONVOLVE_EXAMPLE_INDEX.convolveEmbossStone,
      counter: 20,
      nodes: [
        n('uv', 'uv', 40, 260, note(['UV: this pixel\'s place in the picture.'])),
        n('noise', 'lumps', 300, 260, { kind: 'perlin', dims: '2d', scale: 3, detail: 3, roughness: 0.5, ...note(['Noise (Perlin, 2D, Detail 3): soft lumps, small ones on big ones, from 0 to 1. Convolve will read it as the height of the stone.']) }, { uv: ['uv', 'uv'] }),
        n('floatToVec3', 'grey', 560, 260, { ...note(['Float → Vec3: the noise as a grey colour, for Convolve\'s Colour.']) }, { input: ['lumps', 'value'] }),
        n('convolve', 'carve', 820, 260, {
          preset: 'emboss', size: '5', spacing: 2, angle: 135, mix: 1,
          ...note([
            'Convolve, Emboss, 5 × 5: the reads towards the light (Angle 135: the top left) count negative, the ones away from it positive, and the middle 1. Where the stone rises towards the light the sum grows (the lit side); where it falls, it shrinks (the shade).',
            'The weights add up to 1, so a flat patch keeps its own grey. Spacing 2 spreads the reads for a bolder carving.',
          ]),
        }, { colour: ['grey', 'rgb'] }),
        n('colorPicker', 'stone', 820, 560, { color: [0.86, 0.8, 0.7], ...note(['Colour: a warm sandstone.']) }),
        nv('vec3', 'multiply', 'tint', 1100, 360, note(['Multiply: the carved grey × the sandstone colour.']), { a: ['carve', 'colour'], b: ['stone', 'rgb'] }),
        n('output', 'out', 1360, 360, note(['Output: the noise as carved stone.']), { color: ['tint', 'result'] }),
      ],
      play: play([
        ctl('light', 'carve::angle', 'Light from (degrees)', 0, 360, 0.5),
        ctl('depth', 'carve::spacing', 'Carving width (pixels)', 0.25, 6, 0.25),
      ], `**What it shows.** Emboss is a kernel too: a weighted sum that takes away the neighbours on the light's side and adds the ones on the far side, so every slope gets a lit and a shaded face.

**How it is built.** UV → Noise (Perlin 2D) → Float → Vec3 → Convolve (Emboss, 5 × 5) → × a sandstone colour.

**Try.** Turn *Light from* all the way round. Raise *Carving width* for deeper, softer carving. Set Mix to 0.5 on the card to see the plain noise through it.`),
    },

    convolveVoronoiInk: {
      ...CONVOLVE_EXAMPLE_INDEX.convolveVoronoiInk,
      counter: 20,
      nodes: [
        n('uv', 'uv', 40, 260, note(['UV: this pixel\'s place in the picture.'])),
        n('voronoi', 'cells', 300, 260, { scale: 5, jitter: 0.9, ...note(['Voronoi: cells round random points. Cell colour is one flat random colour per cell, so it only changes at a border.']) }, { uv: ['uv', 'uv'] }),
        n('convolve', 'edges', 600, 260, {
          preset: 'outline', size: '3', spacing: 1.5, absolute: true, mix: 1,
          ...note([
            'Convolve, Outline (Laplacian): 8 × the pixel minus its eight neighbours. Inside a cell all nine are the same colour, so the sum is 0; on a border some neighbours differ, so it is not.',
            'Absolute value counts a step either way as positive. Spacing 1.5 makes the lines a little bolder.',
          ]),
        }, { colour: ['cells', 'cellColour'] }),
        n('smoothstep', 'ink', 900, 260, { edge0: 0.05, edge1: 0.4, ...note(['Smoothstep: the Luma of the result (how big the jump is) from 0.05 to 0.4 into 0 to 1: how much ink. Small jumps between similar colours still make a line.']) }, { value: ['edges', 'luma'] }),
        n('colorPicker', 'paper', 900, 520, { color: [0.95, 0.92, 0.84], ...note(['Colour: cream paper.']) }),
        n('colorPicker', 'inkColour', 900, 700, { color: [0.08, 0.07, 0.1], ...note(['Colour: near-black ink.']) }),
        nv('vec3', 'mix', 'drawing', 1180, 420, note(['Mix: paper where there is no ink, ink on the lines.']), { a: ['paper', 'rgb'], b: ['inkColour', 'rgb'], t: ['ink', 'result'] }),
        n('output', 'out', 1440, 420, note(['Output: the cells as an ink drawing.']), { color: ['drawing', 'result'] }),
      ],
      play: play([
        ctl('width', 'edges::spacing', 'Line width (pixels)', 0.5, 6, 0.25),
        ctl('cells', 'cells::scale', 'Cell density', 1, 15, 0.1),
      ], `**What it shows.** The Laplacian kernel adds up to 0, so anything flat vanishes and only changes are left: on a picture of flat cells, exactly their borders.

**How it is built.** UV → Voronoi's Cell colour → Convolve (Outline, Absolute value) → its Luma → Smoothstep → Mix of paper and ink.

**Try.** Raise *Line width* for a marker pen. Switch the Preset to Edge X on the card (and Absolute value on) to keep only the borders that run up and down.`),
    },

    convolveMotionBall: {
      ...CONVOLVE_EXAMPLE_INDEX.convolveMotionBall,
      counter: 20,
      nodes: [
        n('uv', 'uv', 40, 260, note(['UV: this pixel\'s place in the picture.'])),
        n('time', 'clock', 40, 560, note(['Time: seconds since the start. It swings the ball.'])),
        n('sin', 'swing', 300, 560, { freq: 2.2, amp: 0.8, ...note(['Sin: a fast swing from −0.8 to 0.8 and back, the ball\'s place across.']) }, { input: ['clock', 'time'] }),
        n('makeVec2', 'where', 540, 560, { y: 0.15, ...note(['Make Vec2: the ball\'s place: across from the swing, a little above the middle.']) }, { x: ['swing', 'output'] }),
        n('circleSDF', 'ball', 540, 260, { radius: 0.18, ...note(['Circle SDF: the ball, radius 0.18, at the swinging place.']) }, { position: ['uv', 'uv'], offset: ['where', 'xy'] }),
        n('colorPicker', 'ballCol', 540, 60, { color: [1, 0.55, 0.2], ...note(['Colour: the ball\'s orange.']) }),
        n('colorPicker', 'sky', 540, 760, { color: [0.08, 0.1, 0.18], ...note(['Colour: a dark blue background.']) }),
        n('sdfFill', 'scene', 840, 300, { aaMode: 'fixed', antialias: 0.004, ...note(['SDF Fill: the orange ball on the dark blue.']) }, { d: ['ball', 'distance'], fillColor: ['ballCol', 'rgb'], background: ['sky', 'rgb'] }),
        n('convolve', 'smear', 1140, 300, {
          preset: 'motion', size: '5', spacing: 6, angle: 0, mix: 1,
          ...note([
            'Convolve, Motion blur, 5 × 5, Angle 0: the reads on the line across through the middle count, the rest don\'t, and they add up to 1: an average along the way the ball moves.',
            'Spacing 6 puts the five reads 6 pixels apart, so the streak is about 24 pixels long. The scene is wired into Colour ƒ and drawn again at each read.',
          ]),
        }, { colour: ['scene', 'result'] }),
        n('output', 'out', 1440, 300, note(['Output: the ball, smeared along its swing.']), { color: ['smear', 'colour'] }),
      ],
      play: play([
        ctl('length', 'smear::spacing', 'Streak length', 0.25, 12, 0.25),
        ctl('angle', 'smear::angle', 'Streak angle', 0, 180, 0.5),
      ], `**What it shows.** Motion blur is an average of reads along a line: the kernel is a stripe of equal weights through the middle, at the Angle the thing is moving.

**How it is built.** Time → Sin → Make Vec2 (the ball's place) → Circle SDF → SDF Fill → Convolve (Motion blur, 5 × 5) → Output.

**Try.** Set *Streak angle* to 90 to smear across the motion instead: it looks wrong at once. Raise *Streak length* until you can see the five copies, then set Size to 3 × 3 on the card to see three.`),
    },

    convolveCustomLeft: {
      ...CONVOLVE_EXAMPLE_INDEX.convolveCustomLeft,
      counter: 20,
      nodes: [
        n('uv', 'uv', 40, 260, note(['UV: this pixel\'s place in the picture.'])),
        n('shapeSDF', 'star', 300, 260, { shape: 'star5', r: 0.45, rf: 0.5, ...note(['Shape SDF, Star: a five-pointed star\'s distance (negative inside).']) }, { p: ['uv', 'uv'] }),
        n('colorPicker', 'gold', 300, 60, { color: [1, 0.8, 0.25], ...note(['Colour: the star\'s gold.']) }),
        n('colorPicker', 'night', 300, 560, { color: [0.05, 0.06, 0.12], ...note(['Colour: the night-blue background.']) }),
        n('sdfFill', 'scene', 600, 260, { aaMode: 'fixed', antialias: 0.004, ...note(['SDF Fill: the gold star on night blue.']) }, { d: ['star', 'distance'], fillColor: ['gold', 'rgb'], background: ['night', 'rgb'] }),
        n('convolve', 'shift', 900, 260, {
          preset: 'custom', size: '3', spacing: 40, mix: 0.5, normalize: false,
          k6: 0, k7: 0, k8: 0, k11: 1, k12: 0, k13: 0, k16: 0, k17: 0, k18: 0,
          ...note([
            'Convolve, Custom 3 × 3: the grid on the card is the kernel. The middle cell is this pixel; the others are its neighbours, laid out as they sit in the picture (top row above, left column to the left).',
            'Every pixel becomes the sum of each read × the number in its cell. Here only the left middle cell is 1, all the rest 0, so each pixel simply takes the colour of the pixel to its left: the whole picture moves right.',
            'Spacing 40 makes "the pixel to the left" 40 pixels away, so the move is easy to see. Mix 0.5 shows the moved star over the original. Type other numbers into the grid: they change live.',
          ]),
        }, { colour: ['scene', 'result'] }),
        n('output', 'out', 1200, 260, note(['Output: the star and its copy, moved right.']), { color: ['shift', 'colour'] }),
      ],
      play: play([
        ctl('dist', 'shift::spacing', 'How far (pixels)', 0, 120, 1),
        ctl('mix', 'shift::mix', 'Mix', 0, 1, 0.01),
      ], `**What it shows.** What a kernel is: a little grid of weights, one for this pixel and one for each neighbour. The result is the sum of every read × its weight. A single 1 off-centre just copies that neighbour, which moves the picture the other way.

**How it is built.** UV → Shape SDF (star) → SDF Fill → Convolve (Custom 3 × 3, a 1 in the left middle cell) → Output.

**Try.** Type the 1 into the right middle cell instead (and 0 on the left): the star moves left. Put 0.5 in both: two half-bright copies. Type −1 into the left cell for a dark ghost.`),
    },

    convolveClarityPhoto: {
      ...CONVOLVE_EXAMPLE_INDEX.convolveClarityPhoto,
      counter: 20,
      nodes: [
        n('textureInput', 'photo', 40, 260, { fit: 'stretch', ...builtinImageParams(ROOM_AND_CAT_ID), ...note(['Texture Input: the built-in photo Room and cat (a warm-lit bedroom, a grey cat held close). Choose your own picture on this card. Its Texture output is the picture itself, which Convolve reads at neighbouring pixels.']) }),
        n('convolve', 'clarity', 380, 260, {
          preset: 'unsharp', size: '5', spacing: 3, amount: 1.2, radius: 1.6, mix: 1,
          ...note([
            'Convolve, Unsharp mask, 5 × 5: the original plus Amount × (the original − a Gaussian blur of it). Where a pixel is brighter than the blur round it, it gets brighter still; darker, darker still.',
            'Radius 1.6 reads and Spacing 3 pixels make the blur wide, so it lifts the contrast of the shapes (the face, the cat, the posters) rather than the grain: a photo editor\'s Clarity. The photo comes in through Texture, read at texel offsets.',
          ]),
        }, { texture: ['photo', 'texture'] }),
        n('output', 'out', 700, 260, note(['Output: the photo with more clarity.']), { color: ['clarity', 'colour'] }),
      ],
      play: play([
        ctl('amount', 'clarity::amount', 'Amount', 0, 3, 0.01),
        ctl('radius', 'clarity::radius', 'Radius (reads)', 0.25, 3, 0.05),
        ctl('spacing', 'clarity::spacing', 'Spacing (pixels)', 0.25, 8, 0.25),
      ], `**What it shows.** Unsharp mask sharpens by comparing each pixel with a blur of its surroundings. A narrow blur sharpens fine detail; a wide one adds local contrast, the Clarity slider of photo editors.

**How it is built.** Texture Input's Texture (Room and cat) → Convolve's Texture, Preset Unsharp mask, 5 × 5, Spacing 3.

**Try.** *Spacing* 1 and *Radius* 0.6 for a fine sharpen; *Amount* 3 for an over-cooked HDR look; *Amount* 0 for the original.`),
    },
  };
}
