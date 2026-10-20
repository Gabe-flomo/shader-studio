/**
 * blocks.ts — Texture Lab's blocks (docs/texture-lab.md): each one a Texture tools node, applied to the picture as it
 * comes in, with what it needs round it.
 *
 * A block says how the picture reaches it (`feed`):
 *   - `texture`: it reads the pixels round each one (Blur, Glow, Edges…), so it needs a texture. The source (a Texture
 *     or Video Input) is one; anything a block computed is only "this pixel", so Texture Lab puts a Pass in front of it
 *     (+1 of the pass budget);
 *   - `either`: it works on one pixel at a time (Mask, Levels, Curves, Threshold, Channel…), so a texture is read when
 *     there is one and the colour so far is wired when there isn't: never a Pass.
 * and which of its outputs is the picture (`views`: Edges' lines or the picture's colour on its edges…).
 *
 * A few need more than one node (`special`): a jump flood (seed mask → repeated Pass → flood → Outline), Change (a Pass
 * for its frame before), Flow (a Read pushed by it), Feedback (painted with the colour so far), Depth Mix (a Depth
 * node). Plumbing nodes (Data Texture, Render Targets, Read Channels, Read Neighbours, Show Data, Shuffle, Sample)
 * aren't blocks. Pure data.
 */
import type { IconName } from '../components/ui/iconPaths';
import { curvesPresetParams } from '../nodes/definitions/curves';

export type Params = Record<string, unknown>;

export type BlockGroup = 'find' | 'value' | 'neighbours' | 'bend' | 'time' | 'light' | 'lens';

export const BLOCK_GROUPS: ReadonlyArray<{ id: BlockGroup; label: string }> = [
  { id: 'find', label: 'Find' },
  { id: 'value', label: 'Shape the value' },
  { id: 'neighbours', label: 'Neighbours' },
  { id: 'bend', label: 'Bend' },
  { id: 'time', label: 'Time' },
  { id: 'light', label: 'Light & depth' },
  { id: 'lens', label: 'Lens' },
];

/** One way to show a block's result: an output of its main node, or of one of its helpers (`role.key`). */
export interface BlockView { id: string; label: string; out: string }

export type BlockSpecial = 'flood' | 'change' | 'flow' | 'feedback' | 'depthMix' | 'heightLight';

export interface BlockDef {
  /** The main node's type: its settings are the block's. */
  type: string;
  group: BlockGroup;
  /** As the stack and the menu name it (the node's own label, shortened where it reads better). */
  label: string;
  /** One short line: what it does to the picture. */
  line: string;
  icon: IconName;
  feed: 'texture' | 'either';
  /** `either`: the input the colour so far goes into when there is no texture. */
  colorIn?: string;
  /** `texture`: the input the texture goes into (default `texture`), and more inputs given the same texture. */
  texIn?: string;
  alsoTex?: string[];
  views: BlockView[];
  /** Settings it starts with, where the node's own defaults don't show it off on a picture. */
  start?: Params;
  special?: BlockSpecial;
  /** Needs the depth model (downloaded once, from the Depth card). */
  needsModel?: boolean;
}

const color: BlockView = { id: 'color', label: 'Picture', out: 'color' };

export const BLOCKS: readonly BlockDef[] = [
  // ── Find ──
  { type: 'segment', group: 'find', label: 'Segment', line: 'Cuts out people, objects or what you click', icon: 'body', feed: 'texture',
    views: [{ id: 'cutout', label: 'Cut-out', out: 'cutout' }, { id: 'mask', label: 'Mask', out: 'mask' }, { id: 'edge', label: 'Edge', out: 'edge' }] },
  { type: 'depth', group: 'find', label: 'Depth', line: 'How far away each part is (near is bright)', icon: 'layers', feed: 'texture', needsModel: true,
    views: [{ id: 'depth', label: 'Depth', out: 'depth' }, { id: 'near', label: 'Near mask', out: 'nearMask' }, { id: 'normal', label: 'Normals', out: 'normal' }] },
  { type: 'blobTrack', group: 'find', label: 'Blob Track', line: 'Finds bright shapes and follows them, with marks', icon: 'target', feed: 'texture',
    start: { boxStyle: 'brackets', labels: 'xy', connect: 'chain', threshold: 0.6 },
    views: [{ id: 'overlay', label: 'Overlay', out: 'overlay' }, { id: 'marks', label: 'Marks only', out: 'marks' }] },
  { type: 'analyze', group: 'find', label: 'Analyze', line: 'Measures the picture: its average colour, brightness', icon: 'table', feed: 'texture',
    views: [{ id: 'color', label: 'Average colour', out: 'color' }, { id: 'brightness', label: 'Brightness', out: 'brightness' }] },
  { type: 'opticalFlow', group: 'find', label: 'Optical Flow', line: 'Which way each part moves (hue is the direction)', icon: 'motion', feed: 'texture',
    views: [{ id: 'color', label: 'Flow colours', out: 'color' }, { id: 'speed', label: 'Speed', out: 'speed' }] },

  // ── Shape the value ──
  { type: 'textureMask', group: 'value', label: 'Mask', line: 'Keeps the bright parts, a hue or a key colour', icon: 'mask', feed: 'either', colorIn: 'color',
    views: [{ id: 'color', label: 'Kept colour', out: 'color' }, { id: 'mask', label: 'Mask', out: 'mask' }] },
  { type: 'textureLevels', group: 'value', label: 'Levels', line: 'Gain, gamma, in and out ranges', icon: 'sliders', feed: 'either', colorIn: 'color', views: [color] },
  { type: 'curves', group: 'value', label: 'Curves', line: 'Reshapes the tones (an S for contrast)', icon: 'curve', feed: 'either', colorIn: 'color',
    start: curvesPresetParams('contrast') ?? {}, views: [color] },
  { type: 'threshold', group: 'value', label: 'Threshold', line: 'Black and white at a level, hard or soft', icon: 'contours', feed: 'either', colorIn: 'color',
    start: { colorOut: 'bw', softness: 0.08 }, views: [color, { id: 'mask', label: 'Mask', out: 'mask' }] },
  { type: 'channelPick', group: 'value', label: 'Channel', line: 'One channel, as a grey value', icon: 'hash', feed: 'either', colorIn: 'channels',
    start: { channel: 'bright', shape: 'remap' }, views: [{ id: 'value', label: 'Value', out: 'value' }] },
  { type: 'channelColours', group: 'value', label: 'Channel Colours', line: 'Red, green and blue each a colour of their own', icon: 'droplet', feed: 'either', colorIn: 'channels',
    start: { on4: false, exposure1: 2, exposure2: 2, exposure3: 2 }, views: [color] },

  // ── Neighbours ──
  { type: 'blurTexture', group: 'neighbours', label: 'Blur', line: 'A soft Gaussian blur', icon: 'droplet', feed: 'texture', views: [color] },
  { type: 'glowTexture', group: 'neighbours', label: 'Glow', line: 'The bright parts glow', icon: 'sun', feed: 'texture',
    start: { threshold: 0.55, intensity: 1.2 }, views: [{ id: 'color', label: 'With glow', out: 'color' }, { id: 'glow', label: 'Glow only', out: 'glow' }] },
  { type: 'edgesTexture', group: 'neighbours', label: 'Edges', line: 'Finds the outlines', icon: 'brush', feed: 'texture',
    views: [{ id: 'edges', label: 'Lines', out: 'edges' }, { id: 'color', label: 'Colour on edges', out: 'color' }] },
  { type: 'textureNeighbours', group: 'neighbours', label: 'Neighbours', line: 'Average, grow, shrink or outline round each pixel', icon: 'grid', feed: 'texture',
    start: { mode: 'max', size: '5', spacing: 2 }, views: [color] },
  { type: 'distanceShape', group: 'neighbours', label: 'Outline (jump flood)', line: 'A line, glow or rings round the bright shapes', icon: 'target', feed: 'either', colorIn: 'color',
    special: 'flood', start: { mode: 'rings', offset: 0, spacing: 0.06, thickness: 0.008, softness: 0.004, fade: 3, speed: 0.3, tint: [1, 0.55, 0.85] },
    views: [{ id: 'over', label: 'Over the picture', out: 'over.result' }, { id: 'light', label: 'Lines only', out: 'light' }, { id: 'mask', label: 'Mask', out: 'mask' }] },

  // ── Bend ──
  { type: 'readTexture', group: 'bend', label: 'Read', line: 'Zoom, turn and move the picture', icon: 'rebuild', feed: 'texture',
    start: { zoom: 1.15, turn: 8, edges: 'mirror' }, views: [color] },
  { type: 'displaceTexture', group: 'bend', label: 'Displace', line: 'Pushed about by its own colours', icon: 'wave', feed: 'texture', alsoTex: ['map'],
    start: { amount: 24 }, views: [color] },
  { type: 'displacementMap', group: 'bend', label: 'Displacement Map', line: 'Pushed by its channels, as in After Effects', icon: 'wave', feed: 'texture', texIn: 'sourceTex', alsoTex: ['mapTex'],
    start: { hChan: 'luminance', vChan: 'saturation', maxH: 40, maxV: 30, edges: 'wrap' }, views: [color] },
  { type: 'textureFlow', group: 'bend', label: 'Flow', line: 'Combed along its own contours', icon: 'motion', feed: 'texture',
    special: 'flow', start: { direction: 'along', strength: 0.04, reach: 4 }, views: [{ id: 'color', label: 'Combed', out: 'read.color' }] },

  // ── Time ──
  { type: 'textureFeedback', group: 'time', label: 'Feedback', line: 'Trails: last frame kept, faded, drifting', icon: 'loop', feed: 'texture',
    special: 'feedback', start: { tail: 1.2, zoom: 1.006, turn: 0.4 }, views: [color] },
  { type: 'textureChange', group: 'time', label: 'Change', line: 'What moved since the last frame', icon: 'motion', feed: 'texture',
    special: 'change', start: { measure: 'colour', amount: 6, level: 0.06 }, views: [{ id: 'color', label: 'Moving colour', out: 'color' }, { id: 'motion', label: 'Motion', out: 'motion' }] },
  { type: 'cache', group: 'time', label: 'Cache', line: 'A delay: the picture a few frames ago', icon: 'history', feed: 'texture',
    start: { delay: 12 }, views: [color] },

  // ── Light & depth ──
  { type: 'heightLight', group: 'light', label: 'Height Light', line: 'Lit like a relief, brightness as height', icon: 'sun', feed: 'texture',
    special: 'heightLight', start: { channel: 'bright', relief: 0.1, sunHeight: 30, ambient: 0.35 }, views: [{ id: 'color', label: 'Lit', out: 'color' }, { id: 'shade', label: 'Light only', out: 'shade' }] },
  { type: 'depthMix', group: 'light', label: 'Depth fog', line: 'Haze in the far part (Depth Mix)', icon: 'layers', feed: 'either', colorIn: 'picture',
    special: 'depthMix', needsModel: true, start: { mode: 'fog', haze: 0.6 }, views: [color] },
  { type: 'dofTexture', group: 'light', label: 'Depth of Field', line: 'A lens focused on a point', icon: 'eye', feed: 'texture',
    start: { focus: 'point', focus_distance: 0.3, maxBlur: 10 }, views: [color] },
  { type: 'tiltShiftTexture', group: 'light', label: 'Tilt-Shift', line: 'The miniature look: a sharp band', icon: 'eye', feed: 'texture', views: [color] },

  // ── Lens ──
  { type: 'chromaLens', group: 'lens', label: 'Chromatic Aberration', line: 'Rainbow fringes towards the edges', icon: 'spark', feed: 'texture',
    start: { amount: 8 }, views: [color] },
  { type: 'radialFastBlur', group: 'lens', label: 'Radial Blur', line: 'Zoom streaks and light rays', icon: 'spark', feed: 'texture', views: [color] },
];

const BY_TYPE = new Map(BLOCKS.map(b => [b.type, b]));
export const blockDef = (type: string): BlockDef | undefined => BY_TYPE.get(type);

/** The view a block shows (its first when the one asked for isn't there). */
export function viewOf(def: BlockDef, view: string | undefined): BlockView {
  return def.views.find(v => v.id === view) ?? def.views[0];
}

/** Every node type Texture Lab builds a block with (main and helpers), plus the Pass it inserts. */
export const LAB_NODE_TYPES: readonly string[] = [
  ...BLOCKS.map(b => b.type), 'jumpFloodTexture', 'pass', 'textureMask', 'addColor', 'depth', 'readTexture', 'mix',
].filter((t, i, a) => a.indexOf(t) === i);
