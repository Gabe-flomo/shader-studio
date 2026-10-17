/**
 * pictureExamples.ts — the Pictures folder: one small example for each of the newer picture nodes
 * (Channel, Shuffle, Channel Colours, Height Light, Show data, Random (from ID), Curves, Threshold) and a real pixel sort,
 * each opening on one of the built-in photos (lib/builtinImages.ts): Room and cat (16:9) and Walkway
 * cat (portrait). Built from the node definitions (graphBuilder.ts).
 *
 * Every node carries a plain-language note saying what it does and why it is there; the pixel sort's
 * Expression Blocks (the compare-and-swap is the point, and no node does it) explain each named line.
 */
import type { ExampleGraph } from './exampleIndex';
import type { GraphNode } from '../types/nodeGraph';
import type { PlayRecord } from '../types/play';
import { colourCtl, ctl, n } from './graphBuilder';
import { curvesParams } from '../nodes/definitions/curves';
import { builtinImageParams, ROOM_AND_CAT_ID, WALKWAY_CAT_ID } from '../lib/builtinImages';

export const PICTURE_EXAMPLE_INDEX: Record<string, { label: string; description: string; play: true }> = {
  picChannelSplash: {
    label: 'Pictures 1 · Channel: colour only where the lamp light is', play: true,
    description: 'The built-in Room and cat photo in grey, with its colour kept only where the warm lamp light falls. Channel compares red against blue (A − B) and thresholds it into a mask of warm light; a second Channel reads the brightness for the grey. Choose your own picture on the Texture Input.',
  },
  picShuffle: {
    label: 'Pictures 2 · Shuffle: swapped channels', play: true,
    description: 'The classic channel-swap look on the built-in Room and cat photo: Shuffle builds a new picture from the old one\'s channels: red from a copy shifted sideways, blue into green, green into blue. Click its grid to try other swaps. Choose your own picture on the Texture Input.',
  },
  picChannelColours: {
    label: 'Pictures 3 · Channel Colours: a three-ink print', play: true,
    description: 'Channel Colours gives each of the built-in Walkway cat photo\'s red, green and blue channels its own ink and adds them over a dark copy of the picture: the plants glow green, skin and hat coral, the shade blue, like a print in three inks. Pick the inks on its card. Choose your own picture on the Texture Input.',
  },
  picHeightRelief: {
    label: 'Pictures 4 · Height Light: the photo as a relief', play: true,
    description: 'Height Light reads the built-in Room and cat photo\'s brightness as a height map and lights it like terrain under a slowly circling sun: an embossed bronze plaque. Choose your own picture on the Texture Input.',
  },
  picShowData: {
    label: 'Pictures 5 · Show data: brightness and its direction', play: true,
    description: 'Two views of the built-in Room and cat photo, with a sweeping divider: on the left Show data paints its brightness as a heat map (blue dark, red bright); on the right the direction the brightness rises (hue is the direction, brightness how steep), from Height Light\'s Slope. Choose your own picture on the Texture Input.',
  },
  picBlockSwap: {
    label: 'Pictures 6 · Random (from ID): block swap', play: true,
    description: 'The built-in Walkway cat photo cut into a grid of cells; twice a second Random (from ID) picks which cells swap and where each one jumps, so blocks of the picture shuffle round like a glitch. Amount sets how many cells swap. Choose your own picture on the Texture Input.',
  },
  picPixelSort: {
    label: 'Pictures 7 · Pixel sort with a feedback Pass', play: true,
    description: 'A real, progressive pixel sort of the built-in Room and cat photo: every frame each pixel compares itself with its neighbour and the two swap if they are out of order by brightness, but only where both are between Low and High. The runs of pixels sort into streaks that grow as you watch. ↺ starts again from the photo. Choose your own picture on the Texture Input.',
  },
  picCurves: {
    label: 'Pictures 8 · Curves: more contrast, then a cross-processed look', play: true,
    description: 'Two Curves nodes grade the built-in Room and cat photo: the first bends Master into an S for more contrast, the second gives Red, Green and Blue curves of their own, the cross-processed film look (green-yellow highlights, blue shadows). Drag the points on either card; Look amount fades the grade in. Choose your own picture on the Texture Input.',
  },
  picThreshold: {
    label: 'Pictures 9 · Threshold: a soft mask of the lamp light', play: true,
    description: 'Threshold makes a soft mask of the lamp light in the built-in Room and cat photo (the paper lantern, the orb lamp and the string lights) from how warm and bright each pixel is, and the rest of the room drops to a dim copy: the lamps glow out of the dark. Level sets how much lamp light counts. Choose your own picture on the Texture Input.',
  },
  picGlitch: {
    label: 'Pictures 10 · Glitch: two photos trade blocks', play: true,
    description: 'Glitch takes two pictures and gives two back: the built-in Room and cat photo (A, a texture) and Walkway cat (B, its colour) trade long bars of picture, dealt again three times a second. The left half shows A′ (the room with bars of the cat), the right half B′ (the cat with bars of the room). Try the other Modes on the Glitch card: Channel cross, Displace, Bit flips, Slice shift. Choose your own picture on the Texture Input.',
  },
};

export const PICTURE_EXAMPLE_KEYS = Object.keys(PICTURE_EXAMPLE_INDEX);

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

/** A math node (Add, Multiply, Subtract, Floor…) working on vectors: every socket and the card's type pill set to `t`. */
function vecMath(t: 'vec2' | 'vec3', type: string, id: string, x: number, y: number, params: Record<string, unknown>, wires: Record<string, [string, string]>): GraphNode {
  const node = n(type, id, x, y, { outputType: t, ...params }, wires);
  for (const k of Object.keys(node.inputs)) node.inputs[k] = { ...node.inputs[k], type: t };
  for (const k of Object.keys(node.outputs)) node.outputs[k] = { ...node.outputs[k], type: t };
  return node;
}

/** Mix on colours (its sockets typed vec3): a picture blended into another by a 0–1 mask. */
function mixColour(id: string, x: number, y: number, params: Record<string, unknown>, wires: Record<string, [string, string]>): GraphNode {
  const node = n('mix', id, x, y, { outputType: 'vec3', ...params }, wires);
  node.inputs.a = { ...node.inputs.a, type: 'vec3' };
  node.inputs.b = { ...node.inputs.b, type: 'vec3' };
  node.outputs = { result: { type: 'vec3', label: 'Result' } };
  return node;
}

/** A Texture node showing a built-in photo (choose your own on its card: Upload, Library, a link). */
function photo(id: string, x: number, y: number, which: string, fit: 'stretch' | 'cover', why: string, wires: Record<string, [string, string]> = {}): GraphNode {
  const name = which === ROOM_AND_CAT_ID ? 'Room and cat (a warm-lit bedroom, a grey cat held close)' : 'Walkway cat (a grey cat on a stone walkway, a portrait photo)';
  return n('textureInput', id, x, y, { fit, ...builtinImageParams(which), ...note([
    `Texture Input: the built-in photo ${name}. Choose your own picture on this card (Upload, Library, or paste a link).`,
    fit === 'cover' ? `Fit is Fill, so the tall photo covers the wide picture without stretching (the top and bottom are cropped). ${why}` : why,
  ]) }, wires);
}

export function buildPictureExamples(): Record<string, ExampleGraph> {
  const g: Record<string, ExampleGraph> = {};

  // ── 1 · Channel: grey photo, colour kept where red beats blue (the warm lamp light) ──
  g.picChannelSplash = {
    ...PICTURE_EXAMPLE_INDEX.picChannelSplash,
    counter: 40,
    nodes: [
      photo('photo', 40, 300, ROOM_AND_CAT_ID, 'stretch', 'Its Color goes into both Channel nodes (as four channels: red, green, blue and an alpha of 1) and into the Mix as the coloured picture.'),
      n('channelPick', 'warm', 340, 40, { channel: '1', compare: 'minus', channelB: '3', shape: 'threshold', threshold: 0.26, softness: 0.12,
        ...note([
          'Channel: red (channel 1) minus blue (channel 3). Lamp light is warm, so it is much redder than it is blue; daylight and grey walls are about even, so they come out near 0.',
          'Shape Threshold turns that difference into a mask: 0 below Threshold, 1 above it, with a soft edge (Softness) so the edge of the light fades instead of cutting.',
        ]) },
        { channels: ['photo', 'color'] }),
      n('channelPick', 'grey', 340, 500, { channel: 'bright', shape: 'raw',
        ...note('Channel: the brightness of the photo (red, green and blue weighted as the eye sees them), Raw, so it is the plain grey picture.') },
        { channels: ['photo', 'color'] }),
      mixColour('splash', 660, 300, { ...note('Mix: the grey picture (A) where the mask is 0, the photo\'s own colour (B) where the warm-light mask is 1. A colour splash that follows the light.') },
        { a: ['grey', 'value'], b: ['photo', 'color'], t: ['warm', 'mask'] }),
      n('output', 'out', 960, 300, note('Output: grey everywhere except where the lamp light falls.'), { color: ['splash', 'result'] }),
    ],
    play: playRecord([
      ctl('thr', 'warm::threshold', 'How warm counts', -0.2, 0.5, 0.005),
      ctl('soft', 'warm::softness', 'Edge softness', 0, 0.5, 0.005),
    ], `**What it shows.** Channel reads one channel of a picture, or compares two. Here red − blue finds warm light: the lamp-lit parts of the room are far redder than they are blue.

**How it is built.** Texture Input → Channel (Compare A − B, red minus blue, Shape Threshold) for the mask, and Channel (Brightness, Raw) for the grey. Mix chooses grey or colour by the mask.

**Try.** Lower *How warm counts* to spread the colour, raise it to keep only the lamp. Set the first Channel's Compare to Off and Channel to 2 (green) for a mask of green things instead. Choose your own picture on the Texture Input.`),
  };

  // ── 2 · Shuffle: red from a shifted copy, green and blue swapped ──
  g.picShuffle = {
    ...PICTURE_EXAMPLE_INDEX.picShuffle,
    counter: 40,
    nodes: [
      photo('photo', 40, 300, ROOM_AND_CAT_ID, 'stretch', 'Its Color is Shuffle\'s A; its Texture output lets Sample read a shifted copy for B.'),
      n('sampleTexture', 'shifted', 340, 460, { offsetX: 14, offsetY: 0,
        ...note('Sample (texture): the same photo read 14 pixels to the side. Shuffle takes its red, so the red layer slides off the others, like a misprinted poster.') },
        { texture: ['photo', 'texture'] }),
      n('channelShuffle', 'swap', 640, 300, { r: 'b1', g: 'a3', b: 'a2', a: 'a4',
        ...note([
          'Shuffle: builds a new picture from the channels of A (the photo) and B (the shifted copy). Click the grid on the card to choose.',
          'Red ← B channel 1 (the shifted copy\'s red); Green ← A channel 3 (blue); Blue ← A channel 2 (green). Skin and lamp light stay warm-ish, but greens and blues trade places.',
        ]) },
        { a: ['photo', 'color'], b: ['shifted', 'color'] }),
      n('output', 'out', 940, 300, note('Output: the swapped-channel picture.'), { color: ['swap', 'color'] }),
    ],
    play: playRecord([
      ctl('shift', 'shifted::offsetX', 'Red layer shift (pixels)', -50, 50, 0.5),
    ], `**What it shows.** Shuffle rebuilds a picture from the channels of one or two others: the "channel swap" look of glitch art and misprinted posters.

**How it is built.** Texture Input → Shuffle's A; Sample (texture) reads the photo shifted sideways → Shuffle's B. Red comes from B, green from A's blue, blue from A's green.

**Try.** Click the cells of Shuffle's grid: put channel 3 into red for a cold, moonlit room, or 1 into all three for the red channel alone in grey. Move *Red layer shift* to 0 for a clean swap. Choose your own picture on the Texture Input.`),
  };

  // ── 3 · Channel Colours: each channel its own ink over near-black ──
  g.picChannelColours = {
    ...PICTURE_EXAMPLE_INDEX.picChannelColours,
    counter: 40,
    nodes: [
      photo('photo', 40, 300, WALKWAY_CAT_ID, 'cover', 'Its Color goes to Channel (for the grey) and to Subtract (for how far each channel is from that grey).'),
      n('channelPick', 'grey', 340, 500, { channel: 'bright', shape: 'raw',
        ...note('Channel: the photo\'s brightness (Brightness, Raw): the grey picture.') },
        { channels: ['photo', 'color'] }),
      vecMath('vec3', 'subtract', 'chroma', 640, 300, { ...note([
        'Subtract: the photo\'s colour minus its grey. What is left is how much more red, green or blue each pixel has than grey: the plants are mostly "more green", skin and the hat "more red", shadows and stone a little "more blue".',
        'A photo\'s three channels mostly rise and fall together; taking the grey away leaves only where they differ, so each ink lands somewhere of its own.',
      ]) }, { a: ['photo', 'color'], b: ['grey', 'value'] }),
      n('multiply', 'dim', 640, 640, { b: 0.22, ...note('Multiply: the grey × 0.22, a dark copy of the picture for the inks to glow over.') }, { a: ['grey', 'value'] }),
      n('channelColours', 'inks', 940, 300, {
        mode: 'glow',
        colour1: [1, 0.36, 0.3], exposure1: 9,
        colour2: [0.2, 0.9, 0.55], exposure2: 9,
        colour3: [0.35, 0.4, 1], exposure3: 9,
        on4: false,
        ...note([
          'Channel Colours: each channel gets its own ink, added like light (Glow) over the Background (the dark grey picture). Negative amounts count as none.',
          'Channel 1 (more red than grey) → coral, channel 2 (more green) → green, channel 3 (more blue) → blue-violet. Channel 4 is off: it is 1 everywhere and would wash it all out.',
          'Exposure 9: the differences are small (a few tenths at most), so each ink reaches full strength fast.',
        ]) },
        { channels: ['chroma', 'result'], background: ['dim', 'result'] }),
      n('output', 'out', 1240, 300, note('Output: the three-ink picture.'), { color: ['inks', 'color'] }),
    ],
    play: playRecord([
      colourCtl('c1', 'inks::colour1', 'Red channel ink'),
      colourCtl('c2', 'inks::colour2', 'Green channel ink'),
      colourCtl('c3', 'inks::colour3', 'Blue channel ink'),
      ctl('e1', 'inks::exposure1', 'Red ink strength', 0, 20, 0.01),
      ctl('e2', 'inks::exposure2', 'Green ink strength', 0, 20, 0.01),
    ], `**What it shows.** Channel Colours gives each channel of its input a colour: made for a Trail field's species, it is just as good as a false-colour print of a photo. Fed the photo's colour minus its grey, each ink lands where that channel stands out: the plants glow green, skin and hat coral, the shade blue.

**How it is built.** Texture Input (Fill) → Channel (Brightness) for the grey; Subtract (colour − grey) → Channel Colours, Glow mode, channel 4 off, over the grey × 0.22.

**Try.** Wire the photo's Color straight into Channels and lower the Exposures to 1 to see why the Subtract is there (everything comes out a pale tint). Give two channels the same ink for a duotone. Choose your own picture on the Texture Input.`),
  };

  // ── 4 · Height Light: brightness as height, lit by a circling sun ──
  g.picHeightRelief = {
    ...PICTURE_EXAMPLE_INDEX.picHeightRelief,
    counter: 40,
    nodes: [
      photo('photo', 40, 300, ROOM_AND_CAT_ID, 'stretch', 'Its Texture output is the height map: Height Light reads it a little to each side of every pixel to find the slope.'),
      n('time', 'clock', 40, 720, note('Time: seconds since the start. It turns the sun.')),
      n('multiply', 'turn', 300, 720, { b: 25, ...note('Multiply: Time × 25, the sun\'s direction in degrees: once round every 14 seconds or so.') }, { a: ['clock', 'time'] }),
      n('heightLight', 'relief', 600, 300, {
        channel: 'bright', low: 0, high: 0.65, relief: 0.06, spacing: 1.5, sunHeight: 30, ambient: 0.25,
        lowColour: [0.22, 0.12, 0.06], highColour: [0.95, 0.72, 0.4],
        ...note([
          'Height Light: the photo\'s brightness is the height (bright is high), lit like terrain under a sun.',
          'Relief: how tall the brightest parts stand. Sun height 30°: a low sun that rakes across, so every edge in the photo casts a highlight on one side and a shadow on the other. Sun from is wired: it circles.',
          'The surface runs from dark bronze (low) to gold (high), so it reads as a metal plaque. Range high is 0.65 because the room is dim: its brightest parts are about that bright, so they reach full gold.',
        ]) },
        { texture: ['photo', 'texture'], sunAngle: ['turn', 'result'] }),
      n('output', 'out', 900, 300, note('Output: the lit relief.'), { color: ['relief', 'color'] }),
    ],
    play: playRecord([
      ctl('relief', 'relief::relief', 'Relief', 0, 0.3, 0.001),
      ctl('amb', 'relief::ambient', 'Ambient light', 0, 1, 0.01),
    ], `**What it shows.** Height Light turns any height map into a lit surface. A photo's brightness makes a fine one: the cat, the face and the posters stand out like a coin.

**How it is built.** Texture Input → Height Light (Channel Brightness). Time × 25 turns the sun.

**Try.** Wire the photo's Color into Height Light's Colour to light the photo in its own colours. Raise Spacing for a softer, smoother relief. Choose your own picture on the Texture Input.`),
  };

  // ── 5 · Show data: brightness as heat, its slope as direction, a sweeping divider ──
  g.picShowData = {
    ...PICTURE_EXAMPLE_INDEX.picShowData,
    counter: 40,
    nodes: [
      photo('photo', 40, 300, ROOM_AND_CAT_ID, 'stretch', 'Its Color gives the brightness, its Texture the slope (Height Light reads round each pixel).'),
      n('channelPick', 'bright', 340, 40, { channel: 'bright', shape: 'raw',
        ...note('Channel: the photo\'s brightness, 0 (black) to 1 (white), as a plain number.') },
        { channels: ['photo', 'color'] }),
      n('showData', 'heat', 640, 40, { mode: 'heat', low: 0, high: 0.6,
        ...note('Show data, Heat: the brightness as false colour, dark blue at Low (0) through green and yellow to red at High (0.6: the room is dim, so its brightest parts are about 0.6). Easier to read than grey: the lamp and the window jump out as red.') },
        { value: ['bright', 'value'] }),
      n('heightLight', 'slope', 340, 500, { channel: 'bright', relief: 0.08, spacing: 2,
        ...note('Height Light: used here only for its Slope output, which way the brightness rises at each pixel and how fast (it reads the photo 2 pixels to each side).') },
        { texture: ['photo', 'texture'] }),
      n('showData', 'dir', 640, 500, { mode: 'direction', scale: 0.25,
        ...note('Show data, Direction: the slope as a colour. Hue is the direction the brightness rises (red to the right, yellow-green up, cyan left, violet down); brightness is how steep. Flat parts are black, so the edges of things glow.') },
        { vector: ['slope', 'slope'] }),
      n('fragCoord', 'pix', 40, 900, note('Pixel Coordinates: this pixel\'s place, counted in pixels from the left edge. Its X decides which side of the divider it is on.')),
      n('splitVec2', 'split', 300, 900, note('Split Vec2: just the X of Pixel Coordinates.'), { v: ['pix', 'coord'] }),
      n('lfo', 'sweep', 40, 1080, { waveform: 'sine', freq: 0.07, amplitude: 0.45, offset: 0.5,
        ...note('LFO: a slow wave from 0.05 to 0.95: where the divider is, as a share of the width. It slides across and back about every 14 seconds.') }),
      n('resolution', 'size', 40, 1260, note('Resolution: the picture\'s size in pixels; its Width turns the LFO\'s share into pixels.')),
      n('multiply', 'edgeAt', 300, 1120, { ...note('Multiply: the share × the width: the divider\'s place in pixels, on a picture of any shape.') }, { a: ['sweep', 'value'], b: ['size', 'width'] }),
      n('step', 'side', 640, 960, { ...note('Step: 0 left of the divider, 1 right of it (X at or past it).') }, { edge: ['edgeAt', 'result'], x: ['split', 'x'] }),
      mixColour('both', 940, 300, { ...note('Mix: the heat map (A) left of the divider, the direction view (B) right of it.') },
        { a: ['heat', 'color'], b: ['dir', 'color'], t: ['side', 'result'] }),
      n('output', 'out', 1240, 300, note('Output: the two views, side by side.'), { color: ['both', 'result'] }),
    ],
    play: playRecord([
      ctl('lo', 'heat::low', 'Heat low', -1, 1, 0.01),
      ctl('hi', 'heat::high', 'Heat high', 0, 2, 0.01),
      ctl('sc', 'dir::scale', 'Direction brightness', 0, 2, 0.005),
    ], `**What it shows.** Show data is a viewer: any number as a heat map, any direction as a colour. Two views of one photo: how bright each pixel is, and which way the brightness rises.

**How it is built.** Channel (Brightness) → Show data (Heat). Height Light's Slope → Show data (Direction). A Step of the pixel's X against a slow LFO (× the width) picks between them.

**Try.** Narrow the heat range (Low 0.3, High 0.7) to see the midtones split apart. Wire Show data into any number in your own graphs before deciding what to do with it. Choose your own picture on the Texture Input.`),
  };

  // ── 6 · Random (from ID): cells of the picture swap places, re-dealt twice a second ──
  g.picBlockSwap = {
    ...PICTURE_EXAMPLE_INDEX.picBlockSwap,
    counter: 40,
    nodes: [
      n('uv', 'uv', 40, 300, note('UV: this pixel\'s place in the picture. The grid is laid over it, and the photo is read at a moved copy of it.')),
      n('gridLayout', 'grid', 300, 300, { columns: 12, ...note('Grid: cuts the picture into 12 columns of square cells. Cell ID numbers each cell; Cell Size is how big one is (in UV units).') }, { uv: ['uv', 'uv'] }),
      n('time', 'clock', 40, 640, note('Time: seconds since the start.')),
      n('multiply', 'rate', 300, 640, { b: 2, ...note('Multiply: Time × 2, so the count below goes up twice a second.') }, { a: ['clock', 'time'] }),
      n('floor', 'tick', 560, 640, note('Floor: rounds down to whole numbers, 0, 1, 2…: a Seed that jumps twice a second instead of sliding, so the swaps hold still between jumps.'), { input: ['rate', 'result'] }),
      n('randomFromId', 'chance', 600, 160, { ...note('Random (from ID): one steady random number 0–1 per cell (from its Cell ID), dealt again whenever the Seed (the tick) changes.') },
        { id2: ['grid', 'cellID'], seed: ['tick', 'output'] }),
      n('constant', 'amount', 600, 0, { label: 'Amount', value: 0.3, ...note('Amount: the share of cells that swap, 0 (none) to 1 (all). A Play control.') }),
      n('step', 'swaps', 900, 80, { ...note('Step: 1 when this cell\'s random number is below Amount (so about Amount of the cells swap), else 0.') }, { edge: ['chance', 'value'], x: ['amount', 'value'] }),
      n('add', 'tick2', 600, 800, { b: 0.5, ...note('Add: the tick + 0.5, a different Seed for the second Random, so where a cell jumps has nothing to do with whether it swaps.') }, { a: ['tick', 'output'] }),
      n('randomFromId', 'where', 900, 440, { ...note('Random (from ID): three more random numbers per cell (its Random colour output). The first two pick the jump across and up.') },
        { id2: ['grid', 'cellID'], seed: ['tick2', 'result'] }),
      vecMath('vec2', 'subtract', 'centre', 1200, 440, { b: 0.5, ...note('Subtract: the two random numbers minus 0.5, so the jump can go either way (−0.5 to 0.5).') }, { a: ['where', 'colour'] }),
      n('constant', 'reach', 1200, 640, { label: 'Reach', value: 8, ...note('Reach: how far a cell can jump, in cells (8: up to 4 either way). A Play control.') }),
      vecMath('vec2', 'multiply', 'far', 1480, 440, { ...note('Multiply: the jump × Reach, in cells.') }, { a: ['centre', 'result'], b: ['reach', 'value'] }),
      vecMath('vec2', 'floor', 'whole', 1760, 440, { ...note('Floor: whole cells only, so a cell lands exactly on another cell and the grid stays crisp.') }, { input: ['far', 'result'] }),
      vecMath('vec2', 'multiply', 'onOff', 2040, 300, { ...note('Multiply: the jump × Step: cells that don\'t swap jump nowhere.') }, { a: ['whole', 'output'], b: ['swaps', 'result'] }),
      vecMath('vec2', 'multiply', 'inUv', 2320, 300, { ...note('Multiply: × Cell Size: the jump from cells into picture units.') }, { a: ['onOff', 'result'], b: ['grid', 'cell_size'] }),
      vecMath('vec2', 'add', 'readAt', 2600, 300, { ...note('Add: this pixel\'s place plus the jump: where the photo is read. A swapped cell shows a piece of the picture from somewhere else.') }, { a: ['uv', 'uv'], b: ['inUv', 'result'] }),
      photo('photo', 2880, 300, WALKWAY_CAT_ID, 'cover', 'Its UV input is wired: it is read at the moved place, so whole cells of it show up elsewhere.', { uv: ['readAt', 'result'] }),
      n('output', 'out', 3180, 300, note('Output: the photo with its blocks shuffled.'), { color: ['photo', 'color'] }),
    ],
    play: playRecord([
      ctl('amount', 'amount::value', 'Amount (cells that swap)', 0, 1, 0.01),
      ctl('reach', 'reach::value', 'Reach (cells)', 1, 30, 1),
    ], `**What it shows.** Random (from ID) gives every cell of a grid its own steady random number. Here two of them decide, per cell, whether it swaps and where it jumps, and a Seed that steps twice a second deals them again: a block-swap glitch.

**How it is built.** UV → Grid (Cell ID). Time × 2 → Floor is the Seed. Random → Step against Amount: does this cell swap? A second Random (Seed + 0.5) → − 0.5 → × Reach → Floor → × the Step → × Cell Size: the jump, added to UV where the photo is read.

**Try.** Amount 1 shuffles every cell; Reach 1 makes small, nervous jitters. Raise Grid's Columns for finer blocks, or change Multiply's 2 to slow the dealing. Choose your own picture on the Texture Input.`),
  };

  // ── 7 · Pixel sort: odd-even transposition in a feedback Pass, exact texel reads ──
  const LUMA = 'vec3(0.299, 0.587, 0.114)';
  g.picPixelSort = {
    ...PICTURE_EXAMPLE_INDEX.picPixelSort,
    counter: 40,
    nodes: [
      photo('photo', 40, 40, ROOM_AND_CAT_ID, 'stretch', 'The Sort step copies it into the Pass on the first frame (and after ↺); after that the Pass sorts its own pixels.'),
      n('fragCoord', 'pix', 40, 480, note('Pixel Coordinates: which pixel this is, counted in whole pixels. Whether it is even or odd decides which neighbour it pairs with.')),
      n('sampleTexture', 'here', 380, 40, { offsetX: 0, offsetY: 0,
        ...note('Sample (texture): this pixel in the Pass\'s last result (its Previous). The Pass is Nearest, so this is exactly one stored pixel, never a blend. Its alpha holds the step count (see Next step).') },
        { texture: ['sort', 'previous'] }),
      n('sampleTexture', 'left', 380, 300, { offsetX: -1, offsetY: 0, ...note('Sample (texture): the pixel to the left, exactly one pixel over.') }, { texture: ['sort', 'previous'] }),
      n('sampleTexture', 'right', 380, 560, { offsetX: 1, offsetY: 0, ...note('Sample (texture): the pixel to the right.') }, { texture: ['sort', 'previous'] }),
      n('sampleTexture', 'down', 380, 820, { offsetX: 0, offsetY: -1, ...note('Sample (texture): the pixel below (for sorting up and down).') }, { texture: ['sort', 'previous'] }),
      n('sampleTexture', 'up', 380, 1080, { offsetX: 0, offsetY: 1, ...note('Sample (texture): the pixel above.') }, { texture: ['sort', 'previous'] }),
      n('constant', 'low', 40, 700, { label: 'Low', value: 0.12, ...note('Low: pixels darker than this stay where they are. A Play control.') }),
      n('constant', 'high', 40, 860, { label: 'High', value: 0.6, ...note('High: pixels brighter than this stay where they are. Only runs of pixels between Low and High sort, which is what makes the classic streaks. A Play control.') }),
      n('constant', 'vertical', 40, 1020, { label: 'Vertical', value: 0, ...note('Vertical: 0 sorts along rows (left to right), 1 along columns (bottom to top). A Play control.') }),
      expr('sortStep', 760, 300, {
        label: 'Sort step', outputType: 'vec3',
        inputs: [
          ['here', 'vec3', ['here', 'color']], ['hereA', 'float', ['here', 'alpha']],
          ['left', 'vec3', ['left', 'color']], ['right', 'vec3', ['right', 'color']],
          ['down', 'vec3', ['down', 'color']], ['up', 'vec3', ['up', 'color']],
          ['photo', 'vec3', ['photo', 'color']], ['pix', 'vec2', ['pix', 'coord']],
          ['low', 'float', ['low', 'value']], ['high', 'float', ['high', 'value']], ['vertical', 'float', ['vertical', 'value']],
        ],
        lines: [
          ['float fresh', 'hereA < 0.25 || (dot(here, vec3(1.0)) <= 0.0 && dot(photo, vec3(1.0)) > 0.0) ? 1.0 : 0.0'],
          ['float phase', 'hereA > 0.75 ? 1.0 : 0.0'],
          ['float vert', 'vertical > 0.5 ? 1.0 : 0.0'],
          ['float pos', 'floor(vert > 0.5 ? pix.y : pix.x)'],
          ['float first', 'mod(pos + phase, 2.0) < 0.5 ? 1.0 : 0.0'],
          ['vec3 partner', 'vert > 0.5 ? (first > 0.5 ? up : down) : (first > 0.5 ? right : left)'],
          ['float a', `dot(here, ${LUMA})`],
          ['float b', `dot(partner, ${LUMA})`],
          ['float inside', 'a >= low && a <= high && b >= low && b <= high ? 1.0 : 0.0'],
          ['float wrong', 'first > 0.5 ? (b < a ? 1.0 : 0.0) : (b > a ? 1.0 : 0.0)'],
        ],
        result: 'fresh > 0.5 ? photo : (inside * wrong > 0.5 ? partner : here)',
        note: [
          'Sort step: one step of an odd-even sort. Every pixel pairs with one neighbour; if the pair is in the wrong order (the darker one should come first), both take each other\'s colour, so the pair swaps. Repeated, every run of pixels ends up sorted dark to bright.',
          'fresh: 1 when the Pass is empty (the first frame, or after ↺), or when it kept pure black where the photo isn\'t black (the photo was still loading when the Pass started): then the photo is copied in instead.',
          'phase: which pairing this step uses, read from the alpha (Next step flips it every step), so pixels pair with the right neighbour on one step and the left on the next.',
          'vert: sort up and down instead of across.',
          'pos: this pixel\'s column (or row), a whole number.',
          'first: 1 if this pixel is the first of its pair (its partner is after it), 0 if it is the second.',
          'partner: the neighbour it pairs with this step.',
          'a, b: the brightness of this pixel and of its partner.',
          'inside: 1 only if both are between Low and High. A swap never moves a pixel out of that range, so the runs stay put and each sorts on its own.',
          'wrong: 1 if the pair is out of order: the first one brighter than the second.',
          'result: the photo when fresh; else the partner\'s colour when they swap, this pixel\'s own when they don\'t. A copy, never a blend, so no colour is ever invented or lost.',
        ],
      }),
      expr('nextStep', 760, 1000, {
        label: 'Next step', outputType: 'float',
        inputs: [['hereA', 'float', ['here', 'alpha']]],
        lines: [],
        result: 'hereA > 0.75 ? 0.5 : 1.0',
        note: [
          'Next step: the Pass\'s alpha is a step counter that only remembers odd or even: 1 and 0.5 take turns (0 is an empty Pass). Every pixel holds the same value, so they all agree which pairing comes next.',
          'result: 0.5 after 1, else 1 (an empty Pass becomes 1 when the photo is copied in).',
        ],
      }),
      n('pass', 'sort', 1140, 400, { label: 'Pixel sort', scale: '1', format: 'half', filter: 'nearest', wrap: 'clamp', repeat: 4,
        ...note([
          'Pixel sort: the Pass holding the picture as it is being sorted. Its Previous output hands it back to the Sort step for the next step.',
          'Filter Nearest: every read is one exact stored pixel (Linear would blend neighbours and smear the colours). Scale 1: one stored pixel per picture pixel. Half float stores the colours exactly as they are copied.',
          'Repeat 4: four sort steps each frame, each reading the one before. Raise it to sort faster (each step costs one draw).',
        ]) },
        { color: ['sortStep', 'result'], alpha: ['nextStep', 'result'] }),
      n('output', 'out', 1440, 400, note('Output: the picture as sorted so far. Press ↺ to start again from the photo.'), { color: ['sort', 'color'] }),
    ],
    play: playRecord([
      ctl('low', 'low::value', 'Low (darker pixels stay)', 0, 1, 0.01),
      ctl('high', 'high::value', 'High (brighter pixels stay)', 0, 1, 0.01),
      ctl('vert', 'vertical::value', 'Vertical (0 rows, 1 columns)', 0, 1, 1),
    ], `**What it shows.** A real pixel sort, done a step at a time so you can watch it: runs of pixels with brightness between Low and High sort themselves dark to bright, and the streaks grow frame by frame. The walls and the lamp light smear into bands, while the darkest and brightest parts hold still.

**How it is built.** An odd-even transposition sort in a feedback Pass. Each step, every pixel pairs with its left or right neighbour (which one alternates, kept in the Pass's alpha) and the two swap if the brighter comes first and both are inside the range. Five Sample (texture) nodes read the Pass's Previous exactly (the Pass is Nearest, full size): this pixel and its four neighbours. Repeat 4 does four steps a frame. On the first frame the Pass is empty, so the photo is copied in; ↺ empties it again.

**Try.** Move Low and High while it runs: new runs start sorting from where they are. Set Vertical to 1 and press ↺ for streaks up and down. Raise the Pass's Repeat for a faster sort. Choose your own picture on the Texture Input, then press ↺.`),
  };

  // ── 8 · Curves: an S on Master, then a cross-process on Red, Green and Blue ──
  g.picCurves = {
    ...PICTURE_EXAMPLE_INDEX.picCurves,
    counter: 40,
    nodes: [
      photo('photo', 40, 300, ROOM_AND_CAT_ID, 'stretch', 'Its Texture goes to the first Curves; its Color is the ungraded photo the Mix starts from.'),
      n('curves', 'contrast', 340, 300, {
        ...curvesParams({ m: [[0, 0], [0.25, 0.15], [0.72, 0.86], [1, 1]] }),
        ...note([
          'Curves (contrast): only Master is bent, into a gentle S. The bottom of the graph is the photo\'s brightness coming in, its height what goes out.',
          'The point at 0.25 is pulled down (shadows darker), the one at 0.72 pushed up (highlights brighter): the middle of the curve gets steeper, and a steeper curve is more contrast. The ends stay at black and white.',
          'Drag the points on the card: a flatter S is subtler; pull the 0.25 point up for a faded, matte look.',
        ]) },
        { texture: ['photo', 'texture'] }),
      n('curves', 'cross', 680, 300, {
        ...curvesParams({
          r: [[0, 0], [0.25, 0.18], [0.75, 0.86], [1, 1]],
          g: [[0, 0.04], [0.3, 0.26], [0.7, 0.8], [1, 0.96]],
          b: [[0, 0.16], [0.5, 0.48], [1, 0.82]],
        }),
        ...note([
          'Curves (cross-process): Master is left straight; Red, Green and Blue each get a different curve, so the colours shift differently in the shadows and the highlights. That is the look of slide film developed in the wrong chemicals.',
          'Red: an S, punchier reds. Green: a softer S, lifted a touch at the bottom. Blue: the black end raised to 0.16 and the white end lowered to 0.82, so the shadows turn blue and the highlights yellow.',
          'Click the Red, Green or Blue tab on the card to see each one; the others show faintly behind.',
        ]) },
        { color: ['contrast', 'color'] }),
      n('constant', 'amount', 680, 40, { label: 'Look amount', value: 1, ...note('Look amount: 0 is the photo as it was, 1 the full grade. A Play control.') }),
      mixColour('blend', 980, 300, { ...note('Mix: the photo (A) to the graded picture (B) by Look amount.') },
        { a: ['photo', 'color'], b: ['cross', 'color'], t: ['amount', 'value'] }),
      n('output', 'out', 1260, 300, note('Output: the graded photo.'), { color: ['blend', 'result'] }),
    ],
    play: playRecord([
      ctl('amount', 'amount::value', 'Look amount', 0, 1, 0.01),
    ], `**What it shows.** Curves reshapes the tones of a picture by a curve you draw: what comes in along the bottom, what goes out up the side. An S curve adds contrast; a different curve for each colour shifts the colours, here the cross-processed film look.

**How it is built.** Texture Input → Curves (Master in an S) → Curves (Red, Green and Blue curves) → Mix with the photo by Look amount.

**Try.** Drag points on the cards: click the curve to add one, drag one out of the box to remove it. Pick a preset (Invert, Posterize, Brighten) from Presets. Switch a curve to Linear for hard-edged steps. Choose your own picture on the Texture Input.`),
  };

  // ── 9 · Threshold: the lamp light kept, softly, the room dimmed ──
  g.picThreshold = {
    ...PICTURE_EXAMPLE_INDEX.picThreshold,
    counter: 40,
    nodes: [
      photo('photo', 40, 300, ROOM_AND_CAT_ID, 'stretch', 'Its Color goes to the two Channel nodes (how warm, how bright), to Levels for the dimmed room, and to the Mix for the lamps in full.'),
      n('channelPick', 'warm', 340, 40, { channel: '1', compare: 'minus', channelB: '3', shape: 'raw',
        ...note('Channel: red minus blue (Compare A − B), Raw. Lamp light is warm, much redder than it is blue; the white door and the bluish walls come out near 0.') },
        { channels: ['photo', 'color'] }),
      n('channelPick', 'bright', 340, 300, { channel: 'bright', shape: 'raw',
        ...note('Channel: the brightness of the photo, Raw.') },
        { channels: ['photo', 'color'] }),
      n('multiply', 'glowAmt', 640, 160, { ...note([
        'Multiply: warm × bright, how much lamp light each pixel has. In this photo the lamps are not the brightest things (the door and the white stick are as bright), and the shadows of a warm room are warm too; together the two pick out the lamps.',
      ]) }, { a: ['warm', 'value'], b: ['bright', 'value'] }),
      n('threshold', 'lamps', 920, 160, { mode: 'brightness', level: 0.2, softness: 0.12, colorOut: 'masked',
        ...note([
          'Threshold: 1 where the lamp light (its Value) is above Level (0.2), 0 below. The paper lantern, the orb and the string lights pass; so does some of the warm yellow hat.',
          'Softness 0.12 fades the cut over a range centred on Level (0.14 to 0.26), so the glow round each lamp fades out instead of ending at a hard edge. Read is ignored here: a plain Value is wired.',
        ]) },
        { value: ['glowAmt', 'result'] }),
      n('textureLevels', 'dim', 920, 520, { outWhite: 0.22, ...note('Levels (texture): the photo with Out white at 0.22, a dark copy of the room for the lamps to glow out of.') },
        { color: ['photo', 'color'] }),
      mixColour('glow', 1220, 300, { ...note('Mix: the dark room (A) where the mask is 0, the photo itself (B) where Threshold\'s Mask is 1, and in between on the soft edge.') },
        { a: ['dim', 'color'], b: ['photo', 'color'], t: ['lamps', 'mask'] }),
      n('output', 'out', 1500, 300, note('Output: the lamps lit, the room in the dark.'), { color: ['glow', 'result'] }),
    ],
    play: playRecord([
      ctl('level', 'lamps::level', 'Level (how much lamp light counts)', 0, 0.5, 0.005),
      ctl('soft', 'lamps::softness', 'Softness', 0, 0.5, 0.005),
    ], `**What it shows.** Threshold splits a number into what is above Level and what is below. With Softness the split is a gentle fade, so it makes a soft mask: here, of the lamp light.

**How it is built.** Two Channel nodes read how warm (red − blue) and how bright each pixel is; Multiply gives how much lamp light it has. Threshold (Level 0.2, Softness 0.12) turns that into the Mask. Levels (texture) makes a dark copy of the photo; Mix picks the dark copy or the photo by the Mask.

**Try.** Lower Level to 0.1 and the warm walls light up; Softness 0 cuts hard edges. Wire the photo's Texture into Threshold instead (it then reads Brightness) to see why brightness alone doesn't find these lamps. Set Color out to Black and white and wire Threshold's Color to the Output to see the mask itself. Choose your own picture on the Texture Input.`),
  };

  // ── 10 · Glitch: two photos in, two out; bars of each swapped into the other ──
  g.picGlitch = {
    ...PICTURE_EXAMPLE_INDEX.picGlitch,
    counter: 40,
    nodes: [
      photo('room', 40, 60, ROOM_AND_CAT_ID, 'stretch', 'Its Texture is Glitch\'s A (A is: Texture), so Glitch can read it anywhere, which Displace and Slice shift need.'),
      photo('walk', 40, 460, WALKWAY_CAT_ID, 'cover', 'Its Color is Glitch\'s B (B is: Colour): this pixel of the cat. A colour can be swapped and crossed but not pushed; Displace and Slice shift turn its hue instead.'),
      n('glitch', 'glitch', 380, 200, { mode: 'swap', amount: 0.3, blocks: 14, blockWidth: 4, rate: 3, seed: 0, aIs: 'texture', bIs: 'colour',
        ...note([
          'Glitch, Mode Swap blocks: the picture is cut into blocks (14 rows, each block 4 times as wide as it is tall, so long bars), and Amount (0.3) of them are hit. In a hit block A′ is exactly B and B′ is exactly A: the two photos trade the bar.',
          'Rate 3 deals the blocks again three times a second (the same hash as Random (from ID), with Seed picking another set). Hit is 1 in the hit blocks.',
        ]) },
        { a: ['room', 'texture'], b: ['walk', 'color'] }),
      expr('split', 700, 200, {
        label: 'Side by side', outputType: 'vec3',
        inputs: [['a', 'vec3', ['glitch', 'outA']], ['b', 'vec3', ['glitch', 'outB']], ['hit', 'float', ['glitch', 'hit']], ['uv', 'vec2', ['uvS', 'uv']]],
        lines: [
          ['vec3 both', 'uv.x < 0.0 ? a : b'],
          ['float line', '1.0 - smoothstep(0.0, 0.006, abs(uv.x))'],
        ],
        result: 'mix(both, vec3(1.0), line)',
        note: [
          'Side by side: both outputs at once, to show the node gives two pictures back.',
          'both: A′ (the room, with bars of the cat) left of the middle, B′ (the cat, with bars of the room) right of it.',
          'line: a thin white divider down the middle. hit is wired so you can try mix(both, vec3(1.0, 0.0, 0.3), hit * 0.3) to see the hit blocks.',
        ],
      }),
      n('uv', 'uvS', 380, 600, note('UV: this pixel\'s place; Side by side uses its X (negative on the left) to choose A′ or B′.')),
      n('output', 'out', 1000, 200, note('Output: A′ on the left, B′ on the right.'), { color: ['split', 'result'] }),
    ],
    play: playRecord([
      ctl('amount', 'glitch::amount', 'Amount (share of blocks hit)', 0, 1, 0.01),
      ctl('rate', 'glitch::rate', 'Rate (deals a second)', 0, 20, 0.1),
      ctl('blocks', 'glitch::blocks', 'Blocks (rows)', 1, 60, 1),
      ctl('wide', 'glitch::blockWidth', 'Block width', 0.25, 20, 0.05),
    ], `**What it shows.** Glitch is two in, two out: A and B damage each other. In Swap blocks mode the hit blocks of A′ are B and the hit blocks of B′ are A, exactly, so the two photos trade bars of picture.

**How it is built.** Texture Input (Room and cat) → Glitch's A as a Texture; Texture Input (Walkway cat) → B as a Colour. Glitch → Side by side (A′ left, B′ right) → Output.

**Try.** Change Mode on the Glitch card: **Channel cross** swaps some colour channels per block, **Displace** pushes the room by the cat's brightness (and turns the cat's hue by the room's), **Bit flips** cuts both to a few bits and flips some, **Slice shift** slides rows. Amount 0 leaves both untouched. Choose your own picture on the Texture Input.`),
  };

  return g;
}
