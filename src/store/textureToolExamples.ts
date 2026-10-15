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
import { retypeDataTexture } from '../nodes/definitions/dataTexture';
import { slimeMoldNodes } from './agentExamples';
import RIDGES_AT_DUSK from './playAssets/ridges-at-dusk.jpg?inline';
import { BALL_VIDEO } from '../lib/builtinVideos';

/** A Video Input's params playing the built-in Ball action clip (lib/builtinVideos.ts), looping. */
const BALL_VIDEO_PARAMS = { videoId: BALL_VIDEO.id, _fileName: BALL_VIDEO.name, _hasFile: true, _isPlaying: true, _loop: true, _speed: 1 };

export const TEXTURE_TOOL_EXAMPLE_INDEX: Record<string, { label: string; description: string; play: true }> = {
  ttVideoOutline: {
    label: 'Texture tools 1 · Glowing outline from a video', play: true,
    description: 'A video (the built-in Ball action clip, or yours, or the camera) becomes a glowing outline: Mask keeps its bright parts, Neighbours (Range) finds the mask\'s edge, Glow (texture) spreads it, Levels dims the video underneath. Choose another video or the camera on the Video Input.',
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
    description: 'Mask (texture) in Colour key mode picks one colour out of a video: here the black behind the built-in Ball action clip\'s glowing balls, so a drifting background shows through the gaps. Pick green and choose a green-screen video (or the camera) for the classic key.',
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
  ttFeedbackTunnel: {
    label: 'Texture tools 8 · Zoom tunnel with Feedback', play: true,
    description: 'The classic video-feedback tunnel in one node: Feedback (texture) keeps the Ball action clip\'s last frames, each a little zoomed and turned, so the balls stream outwards in a spiral and drift through the hues as they fade.',
  },
  ttFeedbackFlow: {
    label: 'Texture tools 9 · Trails pushed by their own flow', play: true,
    description: 'Feedback (texture) on the Ball action clip, with Flow (texture) reading the trail itself and pushing it along its own contours every frame: the trails curl into smoke. The loop back into the node reads its buffer a frame ago.',
  },
  ttFeedbackCamera: {
    label: 'Texture tools 10 · Camera echo trails', play: true,
    description: 'Echo trails for a camera: Feedback (texture) on a Video Input rising slowly and shifting hue, screened over the live picture. Plays the Ball action clip until you set the Video Input\'s Source to Webcam.',
  },
  ttDataAdvect: {
    label: 'Texture tools 11 · Data Texture: positions that drift', play: true,
    description: 'A simulation kept in a Data Texture: every texel stores a position (full float, exact reads). Each frame an Expression Block reads last frame\'s position, pushes it along a swirling flow and writes it back; a second one draws a checkerboard at the stored positions, so the board is smeared by the flow. ↺ starts it over.',
  },
  ttRenderTargets: {
    label: 'Texture tools 12 · Render Targets: motion and paint in one draw', play: true,
    description: 'Two textures from one draw (multiple render targets): a state target holds each texel\'s position and velocity at full float, a paint target a colour trail. Step works out the new motion, Paint colours it by direction, and both are written together by Render Targets. Each reads its own target a frame ago.',
  },
  ttBlobTrack: {
    label: 'Texture tools 13 · Blob Track: a tracking overlay', play: true,
    description: 'Blob Track finds the separate bright shapes in a video\'s mask and follows them, each with an ID that stays with it, and draws the tracking-overlay look: corner brackets, crosses, x / y labels and curved arrows connecting the blobs in ID order. Set the Video Input to the camera and hold up a light.',
  },
  ttBlobStamp: {
    label: 'Texture tools 14 · Blob Track: a picture on every blob', play: true,
    description: 'Blob Track\'s Stamp puts a picture on every blob it follows, cut round and turned a different way for each ID, over the dimmed video; Nearest rings them. Wire any texture into Stamp: a photo, a video, a Shader Texture, a sprite sheet with Sheet cells.',
  },
  ttCacheTimeRgb: {
    label: 'Texture tools 15 · Cache: red now, green and blue from the past', play: true,
    description: 'A Cache keeps the last 32 frames of a video on the GPU; two Cache Reads take frames 8 and 16 back from the same recording. Red is now, green a moment ago, blue longer ago: whatever moves splits into colours, whatever stays put stays white.',
  },
  ttCacheTimeMachine: {
    label: 'Texture tools 16 · Cache: Time Machine', play: true,
    description: 'A Cache with a Delay map (TouchDesigner\'s Time Machine): every pixel is read from its own moment. Here the centre is now and the picture reaches further into the past towards the edges, so motion bends and smears outwards.',
  },
  ttAnalyze: {
    label: 'Texture tools 17 · Analyze: a video steers a shape', play: true,
    description: 'Analyze measures the Ball action clip every frame: its average colour paints the backdrop, the middle of its bright part (Centre) moves a ring, how much is lit (Coverage) sizes it, and how much changed (Motion) makes it flare. Choose the camera and wave a light.',
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
  label: string; outputType: 'float' | 'vec2' | 'vec3' | 'vec4';
  inputs: Array<[name: string, type: 'float' | 'vec2' | 'vec3' | 'vec4', from: [string, string]]>;
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
      n('videoInput', 'vid', 40, 300, { ...BALL_VIDEO_PARAMS, ...note([
        'Video Input: the moving picture, here the built-in Ball action clip (glowing balls swirling into mandalas), looping. Press Choose video (or the camera) on this card for yours.',
        'Its Texture output is the video itself as a texture, read by Mask and Levels without a copy Pass.',
      ]) }),
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
      n('glowTexture', 'glow', 1840, 160, { method: 'bloom', threshold: 0.05, radius: 18, intensity: 3,
        ...note('Glow (texture): spreads the lines into a soft halo (Radius in picture pixels). Threshold low, so every line glows. Method Bloom chain: the lines halved again and again, then built back up, so the halo has a bright core and a long, soft tail.') },
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
      n('videoInput', 'vid', 40, 200, { ...BALL_VIDEO_PARAMS, ...note([
        'Video Input: the built-in Ball action clip, glowing balls on black, looping. Press Choose video on this card for a green-screen video of yours (or the camera in front of anything green).',
        'Its Texture output goes to Mask; its Color output to Mix.',
      ]) }),
      n('textureMask', 'key', 340, 200, { source: 'key', key: [0, 0, 0], tolerance: 0.3, softness: 0.15, threshold: 'off',
        ...note([
          'Mask (texture), Colour key: how close each pixel is to the Key colour. 1 within Tolerance, fading to 0 over Key softness (soft hair and motion blur keep their fringe).',
          'Key colour black: the clip\'s dark background is keyed out, the bright balls kept. Threshold Off: the soft match is the mask as it is. For a green screen, pick the screen\'s own green with the Key colour swatch.',
        ]) },
        { texture: ['vid', 'texture'] }),
      n('uv', 'uv', 40, 520, note('UV: this pixel\'s place, for the background noise.')),
      n('time', 'time', 40, 700, note('Time: drifts the background.')),
      n('fbm', 'bgNoise', 340, 560, { scale: 1.6, time_scale: 0.2, ...note('Fractal Noise: a drifting backdrop to put behind what the key keeps (any picture works: a Texture Input, a 3D scene).') }, { uv: ['uv', 'uv'], time: ['time', 'time'] }),
      n('palette', 'bg', 640, 560, { scale: 1.2, phase: [0.6, 0.7, 0.8], ...note('Palette: colours the backdrop.') }, { value: ['bgNoise', 'value'] }),
      colourMix('comp', 940, 260, { t: 0.5, ...note('Mix: the video where the key is 0, the backdrop where it is 1 (Blend is the key mask).') }, { a: ['vid', 'color'], b: ['bg', 'color'], t: ['key', 'mask'] }),
      n('output', 'out', 1240, 260, note('Output: the video with the keyed colour (here the black) swapped for the backdrop.'), { color: ['comp', 'result'] }),
    ],
    play: playRecord([
      ctl('tol', 'key::tolerance', 'Tolerance', 0, 1, 0.005),
      ctl('soft', 'key::softness', 'Key softness', 0, 0.6, 0.005),
      colourCtl('keyColour', 'key::key', 'Key colour'),
    ], `**What it shows.** A colour key with one node: Mask (texture) in Colour key mode gives a soft mask of the key colour. Here it keys the black behind the Ball action clip, so the balls float over a drifting backdrop.

**How it is built.** The Video Input's Texture goes into Mask (Colour key); its Color and a noise backdrop go into Mix, with the mask as the blend.

**Try.** Raise Tolerance to eat into the dim balls too. Choose a green-screen video or the camera, pick the key colour from your screen, then raise Tolerance until the green is gone and Key softness until the edges look natural. Turn on Invert to keep only the keyed colour.`),
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

  // ── 8 · Video → Feedback (zoom + turn + hue drift) → Levels ──
  g.ttFeedbackTunnel = {
    ...TEXTURE_TOOL_EXAMPLE_INDEX.ttFeedbackTunnel,
    counter: 20,
    nodes: [
      n('videoInput', 'vid', 40, 300, { ...BALL_VIDEO_PARAMS, ...note([
        'Video Input: the built-in Ball action clip (glowing balls on black), looping. Choose a video or the camera on this card for yours.',
        'Its Texture output goes straight into Feedback: no Pass of your own needed.',
      ]) }),
      n('textureFeedback', 'tunnel', 340, 300, { label: 'Tunnel', tail: 2.5, clean: 0.03, tint: [0.8, 0.95, 1], amount: 1, blend: 'max',
        zoom: 1.025, turn: 1.2, hueDrift: 45, ...note([
          'Feedback (texture): keeps last frame in a buffer of its own and lays the video over it, every frame.',
          'Zoom 1.025 and Turn 1.2°: each frame the old picture grows 2.5% and turns a little round the Pivot (the centre), so the trails stream outwards in a spiral: the tunnel.',
          'Tail 2.5: seconds for a trail to fade to 1% (the same at any frame rate). Tint fades red a little faster. Blend Max keeps the brighter of trail and video, so the balls stay crisp on top. Hue drift 45: older trails turn through the colours.',
          'Press ↺ to clear the buffer.',
        ]) },
        { texture: ['vid', 'texture'] }),
      n('textureLevels', 'tone', 640, 300, { gain: 1.2, rollOff: 0.4,
        ...note('Levels (texture): reads Feedback\'s Texture output like any texture. Gain 1.2 brightens the trail; Roll-off 0.4 bends the brightest overlaps down so they don\'t clip.') },
        { texture: ['tunnel', 'texture'] }),
      n('output', 'out', 940, 300, note('Output: the tunnel, drawn after the Feedback buffer each frame.'), { color: ['tone', 'color'] }),
    ],
    play: playRecord([
      ctl('zoom', 'tunnel::zoom', 'Zoom', 0.95, 1.06, 0.0005),
      ctl('turn', 'tunnel::turn', 'Turn', -6, 6, 0.05),
      ctl('tail', 'tunnel::tail', 'Trail length (s)', 0.1, 8, 0.05),
      ctl('hue', 'tunnel::hueDrift', 'Hue drift', -180, 180, 1),
    ], `**What it shows.** Video feedback in one node. Feedback (texture) is a Pass, a Fade and a Read wired for you: last frame is kept, drifted (zoom, turn, move), faded with a tail in seconds, and the new picture laid over it.

**How it is built.** Video Input → Feedback (texture) → Levels → Output. Feedback's Texture output is a texture like any other, so Levels (or Glow, Mask, another Feedback) reads it.

**Try.** Zoom below 1 for a tunnel that sinks inwards. Turn 0 and Move Y 2 for trails that rise. Blend Add for light that builds up. Move the Pivot off-centre. Press ↺ to start the trail over.`),
  };

  // ── 9 · Video → Feedback, with Flow (texture) on the Feedback's own Texture pushing it ──
  g.ttFeedbackFlow = {
    ...TEXTURE_TOOL_EXAMPLE_INDEX.ttFeedbackFlow,
    counter: 20,
    nodes: [
      n('videoInput', 'vid', 40, 300, { ...BALL_VIDEO_PARAMS, ...note('Video Input: the built-in Ball action clip, looping. Choose a video or the camera on this card for yours.') }),
      n('textureFlow', 'curl', 340, 560, { channel: 'brightness', direction: 'along', length: 'unit', strength: 0.004, reach: 3,
        ...note([
          'Flow (texture): reads the trail itself (Feedback\'s Texture) and gives the direction along its contours (Along: the slope turned 90°), Strength long.',
          'Wired back into the same Feedback this is a loop, and that is fine: a loop into Feedback reads its buffer as it was a frame ago.',
        ]) },
        { texture: ['smoke', 'texture'] }),
      n('textureFeedback', 'smoke', 640, 300, { label: 'Smoke', tail: 3, clean: 0.02, tint: [1, 0.8, 0.6], amount: 0.6, blend: 'add',
        zoom: 1.004, flowAmount: 1, hueDrift: -20, ...note([
          'Feedback (texture): the video laid over last frame, which is pushed along Flow every frame (Flow strength 1: as Flow gives it) and grown 0.4% by Zoom.',
          'Pushed along its own contours, the trail swirls round itself and curls like smoke. Tail 3 s; Tint fades blue and green first, so old smoke warms to orange. Fresh 0.6 keeps the added light from blowing out.',
        ]) },
        { texture: ['vid', 'texture'], flow: ['curl', 'flow'] }),
      n('textureLevels', 'tone', 940, 300, { gain: 1, rollOff: 0.6,
        ...note('Levels (texture): Roll-off 0.6 tames the brightest stacked smoke (x / (1 + 0.6x)).') },
        { texture: ['smoke', 'texture'] }),
      n('output', 'out', 1240, 300, note('Output: the smoke trails.'), { color: ['tone', 'color'] }),
    ],
    play: playRecord([
      ctl('push', 'smoke::flowAmount', 'Flow strength', -4, 4, 0.01),
      ctl('curl', 'curl::strength', 'Curl', 0, 0.02, 0.0002),
      ctl('tail', 'smoke::tail', 'Trail length (s)', 0.1, 8, 0.05),
      ctl('fresh', 'smoke::amount', 'Fresh', 0, 2, 0.01),
    ], `**What it shows.** Feedback (texture)'s Flow input: a direction that pushes the whole trail every frame. Here the direction comes from the trail itself, through Flow (texture), so the trails curl along their own contours.

**How it is built.** Video Input → Feedback (texture) → Levels → Output. Feedback's Texture also goes to Flow (texture), Along the contours, whose Flow comes back into Feedback's Flow. A loop into Feedback is allowed: it reads the buffer a frame ago.

**Try.** Flow strength negative to curl the other way. Set Flow's Direction to Uphill and the trails gather into ridges. Wire a noise's vec2 into Flow instead for wind.`),
  };

  // ── 10 · Camera (Video Input) → Feedback (rise + hue drift) → Screen over the live picture ──
  g.ttFeedbackCamera = {
    ...TEXTURE_TOOL_EXAMPLE_INDEX.ttFeedbackCamera,
    counter: 20,
    nodes: [
      n('videoInput', 'cam', 40, 300, { ...BALL_VIDEO_PARAMS, ...note([
        'Video Input: plays the built-in Ball action clip. Set Source to Webcam on this card to use your camera instead: the trails follow you.',
      ]) }),
      n('textureFeedback', 'echo', 340, 300, { label: 'Echo', tail: 1.2, clean: 0.05, tint: [0.7, 0.9, 1], amount: 0.8, blend: 'screen',
        moveY: 1.5, zoom: 0.998, hueDrift: 120, ...note([
          'Feedback (texture): the camera\'s last frames, each moved up 1.5 picture pixels and shrunk a hair, so echoes rise and gather.',
          'Blend Screen lays the fresh picture over the echoes softly (it never passes white). Hue drift 120°/s: each echo is a different colour from the one before. Tail 1.2 s keeps the echoes short.',
        ]) },
        { texture: ['cam', 'texture'] }),
      n('textureLevels', 'echoes', 640, 300, { outWhite: 0.85,
        ...note('Levels (texture): the echoes a little dimmer (Out white 0.85), so the live picture stands out on top.') },
        { texture: ['echo', 'texture'] }),
      n('blendModes', 'over', 940, 300, { mode: 'screen', opacity: 1,
        ...note('Blend: the live camera screened over the echoes, so you stay sharp in front of your own trail.') },
        { base: ['echoes', 'color'], blend: ['cam', 'color'] }),
      n('output', 'out', 1240, 300, note('Output: you, with rising rainbow echoes.'), { color: ['over', 'result'] }),
    ],
    play: playRecord([
      ctl('tail', 'echo::tail', 'Echo length (s)', 0.1, 6, 0.05),
      ctl('rise', 'echo::moveY', 'Rise', -6, 6, 0.05),
      ctl('hue', 'echo::hueDrift', 'Hue drift', -360, 360, 1),
      colourCtl('tint', 'echo::tint', 'Fade tint'),
    ], `**What it shows.** Echo trails on a live camera: Feedback (texture) keeps the frames before, moved and recoloured, and the live picture is laid over them.

**How it is built.** Video Input → Feedback (texture) (Move Y, Hue drift, Blend Screen) → Levels → Blend (Screen) with the live video → Output.

**Try.** Set the Video Input's Source to Webcam and wave. Rise 0 and Zoom 1.02 for a tunnel behind you. Tail 4 for long ghosts. Blend Over on the Feedback keeps only the brightest echo.`),
  };



  // ── 12 · Render Targets: state (position + velocity) and paint, written in one draw ──
  g.ttRenderTargets = {
    ...TEXTURE_TOOL_EXAMPLE_INDEX.ttRenderTargets,
    counter: 20,
    nodes: [
      n('uv', 'uvn', 40, 160, note('UV: this pixel\'s place. Every texel starts holding its own place, at rest.')),
      n('time', 'clock', 40, 340, note('Time: turns the pull slowly, so the swirls change.')),
      n('constant', 'pullAmt', 40, 520, { label: 'Pull', value: 0.0015, ...note('Pull: how hard the swirl pulls each texel\'s position every frame. A Play control.') }),
      retypeDataTexture(n('readChannels', 'readState', 40, 700, { channels: 'rgba', read: 'exact',
        ...note('Read channels: the state target as it was last frame (Render Targets\' state (last frame) output), all four channels: position in r g, velocity in b a. Exact, so two texels never blend.') },
        { texture: ['rt', 'previous'] })),
      retypeDataTexture(n('readChannels', 'readPaint', 40, 900, { channels: 'rgb', read: 'smooth',
        ...note('Read channels: the paint target as it was last frame (its paint (last frame) output), as a colour.') },
        { texture: ['rt', 'previous1'] })),
      expr('stepMotion', 380, 300, {
        label: 'Step', outputType: 'vec4',
        inputs: [['s', 'vec4', ['readState', 'value']], ['uv', 'vec2', ['uvn', 'uv']], ['t', 'float', ['clock', 'time']], ['k', 'float', ['pullAmt', 'value']]],
        lines: [
          ['vec2 pos', 's.xy'],
          ['vec2 vel', 's.zw'],
          ['float fresh', 'step(dot(pos, pos), 1e-10)'],
          ['vec2 pull', 'vec2(sin(pos.y * 2.5 + t * 0.6), cos(pos.x * 2.5 - t * 0.4))'],
          ['vec2 v2', 'vel * 0.96 + pull * k'],
        ],
        result: 'mix(vec4(pos + v2, v2), vec4(uv, 0.0, 0.0), fresh)',
        note: [
          'Expression Block: one step of motion for every texel, from last frame\'s state.',
          'pos: where the texel\'s point is (r g). vel: how fast it moves (b a).',
          'fresh: 1 where nothing is stored yet (the targets start at 0, and ↺ clears them), so the first frame starts every point at its own place, at rest.',
          'pull: a swirl that depends on where the point is, turning slowly with time.',
          'v2: the velocity, slowed a little (0.96) and pulled by the swirl times Pull.',
          'Result: the new position and velocity together, one vec4 for the state target.',
        ],
      }),
      expr('paint', 380, 760, {
        label: 'Paint', outputType: 'vec3',
        inputs: [['next', 'vec4', ['stepMotion', 'result']], ['prev', 'vec3', ['readPaint', 'value']]],
        lines: [
          ['float speed', 'clamp(length(next.zw) * 25.0, 0.0, 1.0)'],
          ['float stripe', 'smoothstep(0.35, 0.5, abs(fract((next.x + next.y) * 5.0) - 0.5))'],
          ['float turn', 'atan(next.w, next.z) / 6.2832'],
          ['vec3 hue', '0.5 + 0.5 * cos(6.2832 * (turn + vec3(0.0, 0.33, 0.67)))'],
        ],
        result: 'max(prev * 0.96, hue * speed * stripe * 0.9)',
        note: [
          'Expression Block: the paint target, from the motion Step just worked out (in the same draw, so it is worked out once for both targets).',
          'speed: how fast the point moves, 0 to 1. turn: its direction as a fraction of a full turn.',
          'stripe: thin diagonal stripes drawn at each point\'s position, so the motion carries them and you see the flow.',
          'hue: a colour for that direction, round the colour wheel.',
          'Result: last frame\'s paint fading (0.96), or the new striped colour where it is brighter.',
        ],
      }),
      { ...n('renderTargets', 'rt', 760, 500, {
        label: 'Motion + paint',
        targets: [
          { name: 'state', type: 'vec4', format: 'float', read: 'exact' },
          { name: 'paint', type: 'vec3', format: 'half', read: 'smooth' },
        ],
        ...note([
          'Render Targets: two textures written in one draw (multiple render targets).',
          'Target 1, state: a vec4 (position, velocity) at full float with exact reads: positions must stay exact frame after frame.',
          'Target 2, paint: a colour at half float, read smoothly: it is a picture.',
          'Everything feeding the node (both Expression Blocks, the reads) is worked out once per pixel for both targets. Its last-frame outputs feed Step and Paint, which is how it keeps state.',
        ]) }, { in0: ['stepMotion', 'result'], in1: ['paint', 'result'] }) },
      retypeDataTexture(n('readChannels', 'readOut', 1100, 500, { channels: 'rgb', read: 'smooth',
        ...note('Read channels: the paint target this frame, as a colour for the Output.') },
        { texture: ['rt', 'texture1'] })),
      n('output', 'out', 1400, 500, note('Output: the paint trails.'), { color: ['readOut', 'value'] }),
    ],
    play: playRecord([
      ctl('pull', 'pullAmt::value', 'Pull', 0, 0.006, 0.0001),
    ], `**What it shows.** Multiple render targets: one Render Targets node writes two textures in the same draw, a state (position and velocity, full float) and a paint colour (half float).

**How it is built.** Read channels nodes read each target as it was last frame. Step works out the new motion; Paint colours it by direction and fades the old paint. Both feed Render Targets, which draws them together. A third Read channels shows the paint.

**Try.** ↺ to start over. Turn up Pull. Change the paint target to 8-bit and watch the faint trails band.`),
  };

  // ── 11 · Data Texture: a position per texel, advected by a flow, drawn as a smeared checkerboard ──
  g.ttDataAdvect = {
    ...TEXTURE_TOOL_EXAMPLE_INDEX.ttDataAdvect,
    counter: 20,
    nodes: [
      n('uv', 'uvn', 40, 200, note('UV: this pixel\'s place in the picture. The simulation starts with every texel holding its own place.')),
      n('time', 'clock', 40, 420, note('Time: turns the flow slowly, so the swirls change.')),
      n('constant', 'speed', 40, 600, { label: 'Speed', value: 0.004, ...note('Speed: how far each position moves along the flow every frame (picture units). A Play control.') }),
      expr('advect', 340, 300, {
        label: 'Step', outputType: 'vec2',
        inputs: [['prev', 'vec2', ['data', 'out0']], ['uv', 'vec2', ['uvn', 'uv']], ['t', 'float', ['clock', 'time']], ['speed', 'float', ['speed', 'value']]],
        lines: [
          ['vec2 flow', 'vec2(sin(prev.y * 3.0 + t * 0.7), cos(prev.x * 3.0 - t * 0.5))'],
          ['float fresh', 'step(dot(prev, prev), 1e-10)'],
        ],
        result: 'mix(prev + speed * flow, uv, fresh)',
        note: [
          'Expression Block: one step of the simulation.',
          'prev is the Data Texture\'s position output; this block feeds the Data Texture, so prev is last frame\'s value (the loop is a frame delay).',
          'flow: a swirl that depends on where the position is (sin and cos of its other coordinate) and slowly on time.',
          'fresh: 1 where nothing is stored yet (the texture starts at 0, and ↺ clears it), so the first frame writes this pixel\'s own place.',
          'Result: last position pushed along the flow by Speed (or the start).',
        ],
      }),
      { ...n('dataTexture', 'data', 640, 300, {
        label: 'Positions', fields: [{ name: 'position', type: 'vec2', channels: 'rg' }], reads: [{ name: 'position', channels: 'rg' }],
        format: 'float', read: 'exact', previewView: 'range', previewMin: -2, previewMax: 2,
        ...note([
          'Data Texture: one vec2 per texel, written into r and g, kept at full float so the positions stay exact frame after frame (half float would drift in steps).',
          'Read: Exact texel, so a read never blends two positions.',
          'Its position output read by Step (which feeds it) is last frame; read by Look it is this frame.',
        ]) }, { in0: ['advect', 'result'] }) },
      expr('look', 940, 300, {
        label: 'Look', outputType: 'vec3',
        inputs: [['p', 'vec2', ['data', 'out0']], ['uv', 'vec2', ['uvn', 'uv']]],
        lines: [
          ['vec2 c', 'step(0.5, fract(p * 4.0))'],
          ['float board', 'abs(c.x - c.y)'],
          ['float moved', 'smoothstep(0.0, 0.4, length(p - uv))'],
        ],
        result: 'mix(vec3(0.07, 0.08, 0.16), vec3(1.0, 0.72, 0.3), board) * (0.55 + 0.45 * moved)',
        note: [
          'Expression Block: draws a checkerboard at each stored position, so the board is carried by the flow.',
          'c: for x and y, 1 in the upper half of each of 4 squares per unit along that axis, 0 in the lower half.',
          'board: 1 on the light squares, where the two halves differ.',
          'moved: brighter where the position has travelled far from its pixel.',
        ],
      }),
      n('output', 'out', 1240, 300, note('Output: the smeared checkerboard.'), { color: ['look', 'result'] }),
    ],
    play: playRecord([
      ctl('speed', 'speed::value', 'Speed', 0, 0.02, 0.0005),
    ], `**What it shows.** A Data Texture keeping a simulation's state: a position per texel, stored exactly (full float) and read back as a vec2.

**How it is built.** UV and Time → Step (Expression Block) → Data Texture (position → r g) → Look (Expression Block) → Output. Step also reads the Data Texture's position output: because it feeds the node, that read is last frame's, so each frame moves every position a little further.

**Try.** ↺ to start over. Set Precision to Half float and watch the motion turn steppy. Turn up Speed, or change 4.0 in Look for a finer board.`),
  };

  // ── 13 · Video → Mask → Pass → Blob Track (brackets, crosses, x / y labels, curved arrows) over the video ──
  g.ttBlobTrack = {
    ...TEXTURE_TOOL_EXAMPLE_INDEX.ttBlobTrack,
    counter: 40,
    nodes: [
      n('videoInput', 'vid', 40, 300, { ...BALL_VIDEO_PARAMS, ...note([
        'Video Input: the built-in Ball action clip, looping. Choose the camera on this card to track yourself (a torch, a lit hand, a bright object on a dark wall).',
        'Its Texture output feeds Mask and Levels.',
      ]) }),
      n('textureMask', 'vidMask', 340, 160, { source: 'brightness', threshold: 'soft', level: 0.35, width: 0.1,
        ...note('Mask (texture): 1 where the video is brighter than Level. This is what Blob Track looks at: each separate white shape becomes a blob. Raise Level to split shapes that touch.') },
        { texture: ['vid', 'texture'] }),
      n('pass', 'maskPass', 640, 160, { label: 'Pass · mask', scale: '0.5',
        ...note('Pass: holds the mask as a texture (Blob Track reads a texture, not one pixel). Half size is plenty: Blob Track reads it back at 160 px anyway.') },
        { color: ['vidMask', 'mask'] }),
      n('textureLevels', 'back', 940, 560, { outWhite: 0.6,
        ...note('Levels (texture): the video a little dimmed, a backdrop for the tracking.') },
        { texture: ['vid', 'texture'] }),
      n('blobTrack', 'blobs', 940, 160, { minSize: 0.002, maxSize: 0.4, maxBlobs: 10, maxJump: 0.15, memory: 10, smoothing: 0.5,
        boxStyle: 'brackets', boxColour: 'line', marker: 'cross', markerColor: [0, 0, 0], labels: 'xy', labelColor: [1, 0.2, 0.38], textSize: 13, lineWidth: 2, lineColor: [0.78, 1, 0.22],
        connect: 'chain', bend: 0.45, arrows: true, flow: 0, motion: 'jump', jumpRate: 5, scatter: 0.15, flicker: 0.15,
        ...note([
          'Blob Track: reads the mask back small each frame, splits it into separate blobs and follows them, so each keeps its ID while it moves.',
          'Min size drops specks; Max jump is how far a blob may move in a frame and keep its ID; Memory keeps a lost blob\'s ID for a few frames.',
          'Marks: Boxes Corner brackets, Centre Cross, Labels x / y (the centre in preview pixels), and Connect Chain: a curved arrow from each blob to the next newer one. Bend arcs the curves; Flow runs dots along them.',
          'Motion Jump: each mark holds, then snaps to its blob at random moments (Scatter lands it a little off), flickers out now and then, and its connection re-picks a partner each step. Try Pulse (marks parked, packets flowing) or Follow (gliding).',
          'Marks is the drawing, Marks alpha where it is: Look lays them over the video.',
        ]) },
        { texture: ['maskPass', 'texture'] }),
      expr('look', 1260, 360, {
        label: 'Look', outputType: 'vec3',
        inputs: [['back', 'vec3', ['back', 'color']], ['marks', 'vec3', ['blobs', 'marks']], ['a', 'float', ['blobs', 'marksAlpha']]],
        lines: [],
        result: 'mix(back, marks, a)',
        note: [
          'Expression Block: the marks over the video.',
          'Result: the dimmed video, mixed to the marks by Marks alpha (1 on a line, a bracket, a cross or a label).',
        ],
      }),
      n('output', 'out', 1560, 360, note('Output: the video with its blobs bracketed, labelled and linked.'), { color: ['look', 'result'] }),
    ],
    play: playRecord([
      ctl('level', 'vidMask::level', 'What counts as bright', 0, 1, 0.005),
      ctl('bend', 'blobs::bend', 'Curve bend', -1, 1, 0.01),
      ctl('lines', 'blobs::lineWidth', 'Line width', 0.5, 8, 0.5),
    ], `**What it shows.** Blob tracking as TouchDesigner's Blob Track TOP does it, drawn as a jumpy tracking overlay: separate shapes in a mask found and followed, each with an ID that stays with it.

**How it is built.** Video → Mask → Pass (½) → Blob Track. Blob Track reads the mask back at 160 px each frame, splits it into 8-connected blobs on the CPU and matches them to last frame's by nearest centre. Its Marks (corner brackets, crosses, x / y labels, curved arrows in ID order) are mixed over the video by Marks alpha.

**Try.** Choose the camera on the Video Input and hold up a light. Move *What counts as bright* until each shape is its own bracket. On Blob Track: Motion Pulse for data flowing between parked marks, Line colour by Gradient, Line style Dashed, Labels Hex code, Wobble.`),
  };

  // ── 14 · Video → Mask → Pass → Blob Track with a photo stamped on every blob ──
  g.ttBlobStamp = {
    ...TEXTURE_TOOL_EXAMPLE_INDEX.ttBlobStamp,
    counter: 40,
    images: { bsPhoto: RIDGES_AT_DUSK },
    nodes: [
      n('videoInput', 'vid', 40, 300, { ...BALL_VIDEO_PARAMS, ...note([
        'Video Input: the built-in Ball action clip, looping. Choose the camera on this card to track yourself (a torch, a lit hand, a bright object on a dark wall).',
        'Its Texture output feeds Mask and Levels.',
      ]) }),
      n('textureMask', 'vidMask', 340, 160, { source: 'brightness', threshold: 'soft', level: 0.35, width: 0.1,
        ...note('Mask (texture): 1 where the video is brighter than Level. This is what Blob Track looks at: each separate white shape becomes a blob. Raise Level to split shapes that touch.') },
        { texture: ['vid', 'texture'] }),
      n('pass', 'maskPass', 640, 160, { label: 'Pass · mask', scale: '0.5',
        ...note('Pass: holds the mask as a texture (Blob Track reads a texture, not one pixel). Half size is plenty: Blob Track reads it back at 160 px anyway.') },
        { color: ['vidMask', 'mask'] }),
      n('textureLevels', 'back', 940, 560, { outWhite: 0.6,
        ...note('Levels (texture): the video a little dimmed, a backdrop for the tracking.') },
        { texture: ['vid', 'texture'] }),
      photo('bsPhoto', 640, 420, 'Blob Track\'s Stamp: the picture put on every blob. Load your own image, or wire a video, a Pass or a Shader Texture into Stamp instead.'),
      n('blobTrack', 'blobs', 940, 160, { minSize: 0.002, maxSize: 0.4, maxBlobs: 16, maxJump: 0.15, memory: 10, smoothing: 0.5,
        boxStyle: 'none', marker: 'none', stampFit: 'circle', stampScale: 1.25, stampSpin: 1,
        ...note([
          'Blob Track: reads the mask back small each frame, splits it into separate blobs and follows them, so each keeps its ID while it moves.',
          'Min size drops specks; Max jump is how far a blob may move in a frame and keep its ID; Memory keeps a lost blob\'s ID for a few frames.',
          'Stamp: the photo on every blob. Fit Circle keeps its shape and cuts it round; Scale 1.25 makes it a little bigger than the blob; Spin by ID turns each one differently (and keeps it turned while it is followed).',
          'Stamped is the pictures, Stamp alpha where they are. Sheet cells splits a sprite sheet so each blob shows its own cell.',
        ]) },
        { texture: ['maskPass', 'texture'], stamp: ['bsPhoto', 'texture'] }),
      n('time', 'clock', 940, 820, note('Time: seconds, to move the rings outwards.')),
      expr('look', 1260, 360, {
        label: 'Look', outputType: 'vec3',
        inputs: [
          ['back', 'vec3', ['back', 'color']], ['stamped', 'vec3', ['blobs', 'stamped']], ['a', 'float', ['blobs', 'stampAlpha']],
          ['near', 'float', ['blobs', 'nearest']], ['t', 'float', ['clock', 'time']],
        ],
        lines: [
          ['float rings', '(0.5 + 0.5 * cos(near * 40.0 - t * 6.0)) * exp(-near * 5.0) * (1.0 - a)'],
        ],
        result: 'mix(back * 0.6, stamped, a) + rings * vec3(1.0, 0.55, 0.25) * 0.35',
        note: [
          'Expression Block: the stamps over the video, ringed.',
          'rings: ripples moving outwards from every blob, from Nearest (the distance to the nearest blob\'s centre), fading with distance, not over the stamps.',
          'Result: the video darker, the stamped photos over it by Stamp alpha, and warm rings added.',
        ],
      }),
      n('output', 'out', 1560, 360, note('Output: a photo riding on every ball.'), { color: ['look', 'result'] }),
    ],
    play: playRecord([
      ctl('level', 'vidMask::level', 'What counts as bright', 0, 1, 0.005),
      ctl('scale', 'blobs::stampScale', 'Stamp size', 0.1, 4, 0.01),
      ctl('spin', 'blobs::stampSpin', 'Spin by ID', 0, 1, 0.01),
    ], `**What it shows.** Blob Track's Stamp: a picture on every followed blob, sized to it, each turned its own way by its ID.

**How it is built.** Video → Mask → Pass (½) → Blob Track, with a photo wired into Stamp. Look mixes Stamped over the dimmed video by Stamp alpha and adds rings from Nearest.

**Try.** Load your own image on the photo node. Wire a Video Input or a Shader Texture into Stamp instead. Set Fit to Box to stretch each picture to its blob.`),
  };

  // ── 15 · Video → Cache (32 frames) → two Cache Reads: R now, G 8 frames back, B 16 back ──
  g.ttCacheTimeRgb = {
    ...TEXTURE_TOOL_EXAMPLE_INDEX.ttCacheTimeRgb,
    counter: 40,
    nodes: [
      n('videoInput', 'vid', 40, 300, { ...BALL_VIDEO_PARAMS, ...note([
        'Video Input: the built-in Ball action clip, looping. Choose the camera on this card to see yourself in time.',
        'Its Texture output is what the Cache records.',
      ]) }),
      n('cache', 'ca', 340, 300, { frames: '32', size: '512', record: true, every: 1, delay: 0, smooth: true,
        ...note([
          'Cache: keeps the last 32 frames of the video on the GPU (one 512 px wide tile each, in one texture, about 21 MB), recording a frame every frame while the clock runs.',
          'Its Color is the newest frame (Delay 0). Its Cache output is the whole recording, for the Cache Reads.',
          'Record off freezes what it has; Delay reads further back; Clear on the card forgets it.',
        ]) }, { texture: ['vid', 'texture'] }),
      n('cacheRead', 'past1', 640, 160, { delay: 8, smooth: true, ...note('Cache Read: the same recording, 8 frames back (about a seventh of a second at 60 fps). Nothing is recorded twice.') }, { cache: ['ca', 'cache'] }),
      n('cacheRead', 'past2', 640, 460, { delay: 16, smooth: true, ...note('Cache Read: 16 frames back.') }, { cache: ['ca', 'cache'] }),
      expr('look', 940, 300, {
        label: 'Look', outputType: 'vec3',
        inputs: [['now', 'vec3', ['ca', 'color']], ['a', 'vec3', ['past1', 'color']], ['b', 'vec3', ['past2', 'color']]],
        lines: [],
        result: 'vec3(now.r, a.g, b.b)',
        note: [
          'Expression Block: one colour channel from each moment.',
          'Result: red from now, green from 8 frames back, blue from 16 back. Where nothing moved the three agree and the picture keeps its colour; where something moved, it splits into red, green and blue ghosts.',
        ],
      }),
      n('output', 'out', 1240, 300, note('Output: the video split in time.'), { color: ['look', 'result'] }),
    ],
    play: playRecord([
      ctl('g', 'past1::delay', 'Green delay (frames)', 0, 31, 0.1),
      ctl('b', 'past2::delay', 'Blue delay (frames)', 0, 31, 0.1),
    ], `**What it shows.** A live frame buffer (TouchDesigner's Cache TOP and Cache Select): the last frames of a video kept on the GPU and read back by how long ago.

**How it is built.** Video → Cache (32 frames) → two Cache Reads at 8 and 16 frames back, from the same recording. Look takes red from now, green and blue from the past.

**Try.** Choose the camera and wave. Turn the delays up for wider ghosts. Turn Record off on the Cache to freeze it, then wire an LFO into Delay to loop through the frozen frames.`),
  };

  // ── 16 · Video → Cache with a Delay map: centre now, edges further back (Time Machine) ──
  g.ttCacheTimeMachine = {
    ...TEXTURE_TOOL_EXAMPLE_INDEX.ttCacheTimeMachine,
    counter: 40,
    nodes: [
      n('videoInput', 'vid', 40, 300, { ...BALL_VIDEO_PARAMS, ...note([
        'Video Input: the built-in Ball action clip, looping. Choose the camera on this card to see yourself in time.',
        'Its Texture output is what the Cache records.',
      ]) }),
      n('uv', 'uv', 40, 620, note('UV: this pixel\'s place in the picture, for the delay map.')),
      expr('map', 340, 620, {
        label: 'Delay map', outputType: 'float',
        inputs: [['uv', 'vec2', ['uv', 'uv']]],
        lines: [],
        result: 'clamp(length(uv) * 0.75, 0.0, 1.0)',
        note: [
          'Expression Block: how far back each pixel is read, 0–1.',
          'Result: 0 at the centre (now), growing with the distance from it, 1 a little past the top and bottom edges (the oldest frame). Any grey picture works: a gradient, noise, a Depth, a mask.',
        ],
      }),
      n('cache', 'ca', 640, 300, { frames: '64', size: '384', record: true, every: 1, delay: 0, reach: 1, smooth: true,
        ...note([
          'Cache: the last 64 frames of the video. With a Delay map wired, each pixel is read Delay plus map × Map reach × 63 frames back: Time Machine.',
          'Smooth blends between frames, so the delay changes smoothly across the picture instead of in bands.',
        ]) }, { texture: ['vid', 'texture'], delayMap: ['map', 'result'] }),
      n('output', 'out', 940, 300, note('Output: the video, now in the middle and the past at the edges.'), { color: ['ca', 'color'] }),
    ],
    play: playRecord([
      ctl('reach', 'ca::reach', 'How far back the edges reach', 0, 1, 0.01),
      ctl('delay', 'ca::delay', 'Delay everything (frames)', 0, 63, 0.1),
    ], `**What it shows.** Time Machine: every pixel of a video read from its own moment, by a grey map.

**How it is built.** Video → Cache (64 frames) with a Delay map: the distance from the centre. The centre is now; the edges are up to 63 frames back.

**Try.** Choose the camera and move: you bend outwards in time. Change the map (a horizontal gradient for a slit-scan sweep, Fractal Noise for a time-melt).`),
  };

  // ── 17 · Video → Analyze → a ring at the light's centre, sized by coverage, flaring with motion ──
  g.ttAnalyze = {
    ...TEXTURE_TOOL_EXAMPLE_INDEX.ttAnalyze,
    counter: 40,
    nodes: [
      n('videoInput', 'vid', 40, 300, { ...BALL_VIDEO_PARAMS, ...note([
        'Video Input: the built-in Ball action clip, looping. Choose the camera on this card to steer the ring with a light or your hand.',
        'Its Texture output is what Analyze measures.',
      ]) }),
      n('analyze', 'an', 340, 300, { resolution: '64', threshold: 0.45, smoothing: 0.6, motionGain: 12, ...note([
        'Analyze: reads the video back at 64 px each frame and measures it into numbers, one for the whole picture.',
        'Colour: the average colour. Centre: the middle of the part brighter than Threshold. Coverage: how much is that bright. Motion: how much changed since the last frame (times Motion gain).',
        'Smoothing 0.6 calms the numbers so the ring glides instead of jittering.',
      ]) }, { texture: ['vid', 'texture'] }),
      n('textureLevels', 'back', 340, 620, { outWhite: 0.35, ...note('Levels (texture): the video dimmed, to show what is being measured.') }, { texture: ['vid', 'texture'] }),
      n('uv', 'uv', 340, 860, note('UV: this pixel\'s place in the picture.')),
      expr('look', 700, 400, {
        label: 'Look', outputType: 'vec3',
        inputs: [
          ['uv', 'vec2', ['uv', 'uv']], ['video', 'vec3', ['back', 'color']], ['avg', 'vec3', ['an', 'color']],
          ['c', 'vec2', ['an', 'centre']], ['cover', 'float', ['an', 'coverage']], ['mo', 'float', ['an', 'motion']],
        ],
        lines: [
          ['float r', '0.08 + sqrt(cover) * 0.6'],
          ['float ring', '1.0 - smoothstep(0.006, 0.012 + mo * 0.02, abs(length(uv - c) - r))'],
          ['float flare', 'exp(-abs(length(uv - c) - r) * 10.0) * clamp(mo, 0.0, 2.0)'],
          ['vec3 tint', 'normalize(avg + 0.001) * 1.2'],
        ],
        result: 'avg * 0.6 + video * 0.5 + (ring + flare * 0.6) * tint',
        note: [
          'Expression Block: the numbers drawn.',
          'r: the ring\'s radius grows with Coverage (its square root, so a little light already shows).',
          'ring: a ring round Centre, thicker while things move.',
          'flare: a glow round it, as bright as Motion.',
          'tint: the average colour at full strength, so the ring takes the video\'s colour.',
          'Result: the average colour as a backdrop, the dimmed video, and the ring over both.',
        ],
      }),
      n('output', 'out', 1000, 400, note('Output: the video measured and drawn as a ring.'), { color: ['look', 'result'] }),
    ],
    play: playRecord([
      ctl('gain', 'an::motionGain', 'Motion gain', 0, 40, 0.5),
    ], `**What it shows.** Analyze (TouchDesigner's Analyze TOP and TOP to CHOP): a whole picture measured into numbers you wire like any other.

**How it is built.** Video → Analyze → Look. The average colour fills the backdrop, the lit part's Centre places a ring, Coverage sizes it, Motion makes it flare.

**Try.** Choose the camera: hold up a light and move it, the ring follows. Wire Brightness into a Lag, then into anything, for a smooth light meter. Wire Motion into an Envelope's Gate to flash on movement.`),
  };

  return g;
}
