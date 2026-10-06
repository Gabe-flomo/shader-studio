/**
 * moves.ts — the moves library (docs/suggestions.md): small node snippets keyed by value kind.
 *
 * A move works on one socket of one node:
 *  - a TRANSFORM keeps the type (a distance stays a distance, a space a space…). After an output
 *    it goes in place: everything the output fed now reads the move's result. In front of an
 *    input it goes between the input and what fed it (a UV node is added when nothing did).
 *  - a BRANCH makes something new from the value (light from a distance, a mask…); `show` says
 *    what happens with it: laid over the picture, put on the Output, or only shown when the
 *    Output shows nothing yet.
 *  - a PARAM move changes the node itself (its settings, or a wire into it).
 *
 * Builds are pure. They return nodes with temporary ids laid out to the right of the node (x in
 * columns of 420), wired with the placeholders IN (the value), SELF (the node) and PICTURE (what
 * the Output shows); applyMove.ts gives them real ids, places them and wires them in. Every node a
 * move adds carries a note: what it does and why the move added it.
 *
 * Where a starter recipe already does the job round a fresh node (a Pass's Glow, Blur, Outlines;
 * Trails through Fade), the move hands over to it instead of duplicating it. The generic "add a
 * node here" moves come from the quick-add rules (quickAdds.ts), not a second list.
 */
import type { GraphNode } from '../types/nodeGraph';
import { n } from '../store/graphBuilder';
import { getNodeDefinition } from '../nodes/definitions';
import { suggestQuickAdds } from '../components/NodeGraph/quickAdds';
import { standInPicture } from '../nodes/recipes/kit';
import type { ValueKind } from './kinds';

export type Wire = [nodeId: string, outputKey: string];
export type RGB = [number, number, number];

/** The value the move works on: the output itself, or what fed the input. */
export const IN = '$in';
/** The node the move is for. */
export const SELF = '$self';
/** What the Output shows now (resolved by applyMove; moves that need one ask `picture()`). */
export const PICTURE = '$picture';
/** A second node the move works with (args.other / args.otherKey: the Do… bar's "these"). */
export const OTHER = '$other';

export type MoveShape = 'transform' | 'branch' | 'param';
export type ShowMode = 'layer' | 'replace' | 'ifEmpty' | 'none';

export interface MoveArg {
  name: string;
  label: string;
  kind: 'number' | 'count' | 'colour' | 'word';
  default: number | RGB | string;
  /** Words for the Do… bar that fill this slot ("falloff", "spacing"…). */
  words?: string[];
}

export interface MoveContext {
  self: GraphNode;
  /** The socket the move works on. */
  key: string;
  side: 'in' | 'out';
  /** The socket's type. */
  type: string;
  /** The graph level the node is in. */
  nodes: GraphNode[];
  /** Filled slots (Do… bar) and output-rule values, else each arg's default. */
  args: Record<string, unknown>;
  /** Whether the Output shows something (PICTURE resolves to it). */
  hasPicture: boolean;
}

export interface MoveBuild {
  nodes: GraphNode[];
  /** The move's result. */
  result?: Wire;
  /** What happens with a branch's result. */
  show?: ShowMode;
  /** Settings changed on the node itself (param moves). */
  selfParams?: Record<string, unknown>;
  /** Wires made into the node itself (param moves). */
  selfWires?: Record<string, Wire>;
  /** Hand the rest to a starter recipe of one of the added nodes (its temp id) after placing. */
  thenRecipe?: { nodeId: string; recipeId: string };
}

export interface Move {
  id: string;
  label: string;
  kinds: ValueKind[];
  shape: MoveShape;
  /** Which side of a socket it goes on: after an output, in front of an input, or both. */
  sides: Array<'in' | 'out'>;
  /** The node it adds next to the socket, for ranking by usage: `key` its input fed by IN, `out` its output that goes on. */
  anchor?: { type: string; key: string; out: string };
  /** The kind reason, one line ("lights the edge"). */
  why: string;
  args?: MoveArg[];
  /** When it applies at all (beyond its kinds). */
  when?: (ctx: MoveContext) => boolean;
  /** A starter recipe of the node itself that does this when the socket feeds nothing yet. */
  recipe?: string;
  /** Not offered in the strip (the Do… bar's two-node moves). */
  hidden?: boolean;
  build: (ctx: MoveContext) => MoveBuild;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

export const note = (...lines: string[]) => ({ __comment: lines.join('\n') });
const C = (i: number) => i * 420;
const num = (ctx: MoveContext, name: string, d: number) => (typeof ctx.args[name] === 'number' && Number.isFinite(ctx.args[name]) ? ctx.args[name] as number : d);
const rgb = (ctx: MoveContext, name: string, d: RGB): RGB => {
  const v = ctx.args[name];
  return Array.isArray(v) && v.length === 3 && v.every(x => typeof x === 'number') ? v as RGB : d;
};
const str = (ctx: MoveContext, name: string, d: string) => (typeof ctx.args[name] === 'string' ? ctx.args[name] as string : d);
const fmt = (x: number) => String(Math.round(x * 1000) / 1000);
export const labelOf = (nd: GraphNode) => (typeof nd.params.label === 'string' && nd.params.label) || getNodeDefinition(nd.type)?.label || nd.type;

/** An Expression Block with the given inputs; `ins` wires them. */
export function exprBlock(id: string, x: number, y: number, o: {
  label: string; inputs: Array<{ name: string; type: 'float' | 'vec2' | 'vec3'; slider?: [number, number]; value?: number }>;
  lines?: Array<[string, string]>; result: string; outputType: 'float' | 'vec2' | 'vec3'; wires?: Record<string, Wire>; comment: string;
}): GraphNode {
  const e = n('exprNode', id, x, y, {
    label: o.label,
    inputs: o.inputs.map(i => ({ name: i.name, type: i.type, slider: i.slider ? { min: i.slider[0], max: i.slider[1] } : null })),
    outputType: o.outputType,
    lines: (o.lines ?? []).map(([lhs, rhs]) => ({ lhs, op: '=', rhs })),
    result: o.result,
    expr: o.result,
    ...Object.fromEntries(o.inputs.filter(i => i.value !== undefined).map(i => [i.name, i.value])),
    __comment: o.comment,
  });
  e.inputs = Object.fromEntries(o.inputs.map(i => [i.name, {
    type: i.type, label: `${i.name} (${i.type})`,
    ...(o.wires?.[i.name] ? { connection: { nodeId: o.wires[i.name][0], outputKey: o.wires[i.name][1] } } : {}),
  }]));
  e.outputs = { result: { type: o.outputType, label: `Result (${o.outputType})` } };
  return e;
}

/** The picture to work with: PICTURE when the Output shows one, else a stand-in (slow noise through a palette). */
function picture(ctx: MoveContext, prefix: string, x: number, y: number): { nodes: GraphNode[]; out: Wire } {
  return ctx.hasPicture ? { nodes: [], out: [PICTURE, ''] } : standInPicture(prefix, x, y);
}

// ── Distance ────────────────────────────────────────────────────────────────

const DISTANCE: Move[] = [
  {
    id: 'glow', label: 'Glow', kinds: ['distance'], shape: 'branch', sides: ['out'],
    anchor: { type: 'light', key: 'distance', out: 'tinted' },
    why: 'a distance: light that is brightest at the edge',
    args: [
      { name: 'falloff', label: 'Falloff', kind: 'number', default: 10, words: ['falloff', 'fall off', 'tightness', 'sharpness'] },
      { name: 'colour', label: 'Colour', kind: 'colour', default: [1, 0.6, 0.3] },
    ],
    build: ctx => ({
      nodes: [n('light', 'glow', C(1), 0, { mode: 'glow', brightness: num(ctx, 'falloff', 10), tint: rgb(ctx, 'colour', [1, 0.6, 0.3]), ...note(
        'SDF Glow: light that is brightest where the distance is 0 (the edge) and fades away from it. Tinted is the light times Tint.',
        `Why: the Glow suggestion. Falloff (${fmt(num(ctx, 'falloff', 10))}) sets how tight it is: lower for a wider halo.`,
      ) }, { distance: [IN, ''] })],
      result: ['glow', 'tinted'],
      show: 'layer',
    }),
  },
  {
    id: 'rings', label: 'Rings', kinds: ['distance'], shape: 'branch', sides: ['out'],
    anchor: { type: 'distanceShape', key: 'distance', out: 'light' },
    why: 'a distance: lines at every step away from the shape',
    args: [
      { name: 'count', label: 'Rings', kind: 'count', default: 10, words: ['rings', 'lines', 'times'] },
      { name: 'speed', label: 'Speed', kind: 'number', default: 0.4, words: ['speed'] },
      { name: 'colour', label: 'Colour', kind: 'colour', default: [1, 0.5, 0.8] },
    ],
    build: ctx => {
      const spacing = 0.8 / Math.max(1, num(ctx, 'count', 10));
      return {
        nodes: [n('distanceShape', 'rings', C(1), 0, { mode: 'rings', spacing: Math.round(spacing * 1000) / 1000, thickness: 0.01, softness: 0.004, fade: 3, speed: num(ctx, 'speed', 0.4), tint: rgb(ctx, 'colour', [1, 0.5, 0.8]), ...note(
          'Outline (distance) in Rings mode: a line every Spacing away from the shape, moving outwards with Speed.',
          'Why: the Rings suggestion. Its Light output (Tint where the rings are) is added over the picture.',
        ) }, { distance: [IN, ''] })],
        result: ['rings', 'light'],
        show: 'layer',
      };
    },
  },
  {
    id: 'outline', label: 'Outline', kinds: ['distance'], shape: 'branch', sides: ['out'],
    anchor: { type: 'distanceShape', key: 'distance', out: 'light' },
    why: 'a distance: a line along the edge',
    args: [
      { name: 'width', label: 'Width', kind: 'number', default: 0.012, words: ['width', 'thickness', 'thick'] },
      { name: 'colour', label: 'Colour', kind: 'colour', default: [1, 0.85, 0.5] },
    ],
    build: ctx => ({
      nodes: [n('distanceShape', 'line', C(1), 0, { mode: 'outline', offset: 0, width: num(ctx, 'width', 0.012), softness: 0.004, tint: rgb(ctx, 'colour', [1, 0.85, 0.5]), ...note(
        'Outline (distance): a line Width wide along the edge (Offset moves it out).',
        'Why: the Outline suggestion. Its Light output is added over the picture.',
      ) }, { distance: [IN, ''] })],
      result: ['line', 'light'],
      show: 'layer',
    }),
  },
  {
    id: 'onion', label: 'Onion', kinds: ['distance'], shape: 'transform', sides: ['out'],
    anchor: { type: 'sdfOnion', key: 'dist', out: 'dist' },
    why: 'a distance: a hollow shell of the shape',
    args: [{ name: 'thickness', label: 'Thickness', kind: 'number', default: 0.02, words: ['thickness', 'thick', 'width', 'shell'] }],
    build: ctx => ({
      nodes: [n('sdfOnion', 'onion', C(1), 0, { r: num(ctx, 'thickness', 0.02), ...note(
        'Onion: turns the shape into a shell Thickness wide (abs(d) − r).',
        'Why: the Onion suggestion, in place: what read the shape now reads the shell.',
      ) }, { dist: [IN, ''] })],
      result: ['onion', 'dist'],
    }),
  },
  {
    id: 'round', label: 'Grow / round', kinds: ['distance'], shape: 'transform', sides: ['out'],
    anchor: { type: 'sdfOffset', key: 'sdf', out: 'result' },
    why: 'a distance: grows the shape and rounds its corners',
    args: [{ name: 'amount', label: 'Amount', kind: 'number', default: 0.03, words: ['amount', 'by', 'radius'] }],
    build: ctx => ({
      nodes: [n('sdfOffset', 'grow', C(1), 0, { amount: -num(ctx, 'amount', 0.03), ...note(
        'Offset: moves the edge out (a negative Amount) or in (positive). Growing rounds every corner by the same amount.',
        'Why: the Grow / round suggestion, in place.',
      ) }, { sdf: [IN, ''] })],
      result: ['grow', 'result'],
    }),
  },
  {
    id: 'blend', label: 'Smooth blend', kinds: ['distance'], shape: 'transform', sides: ['out'],
    anchor: { type: 'sdfUnion', key: 'a', out: 'dist' },
    why: 'a distance: melts another shape into it',
    args: [
      { name: 'smoothness', label: 'Smoothness', kind: 'number', default: 0.15, words: ['smoothness', 'smooth', 'k', 'blend', 'softness'] },
      { name: 'shape', label: 'Other shape', kind: 'word', default: 'circle', words: ['with'] },
    ],
    build: ctx => {
      const box = /box|square/.test(str(ctx, 'shape', 'circle'));
      return {
        nodes: [
          box
            ? n('boxSDF', 'other', C(1), 300, { width: 0.18, height: 0.18, posX: 0.25, posY: -0.05, ...note('Box SDF: the second shape, melted into the first.', 'Why: something to blend with. Move it with Center X / Y, or swap it for any shape.') })
            : n('circleSDF', 'other', C(1), 300, { radius: 0.18, posX: 0.25, posY: -0.05, ...note('Circle SDF: the second shape, melted into the first.', 'Why: something to blend with. Move it with Center X / Y, or swap it for any shape.') }),
          n('sdfUnion', 'melt', C(2), 0, { k: num(ctx, 'smoothness', 0.15), ...note(
            'Union with K: the two shapes as one, melted together over K.',
            'Why: the Smooth blend suggestion, in place: what read the first shape now reads both.',
          ) }, { a: [IN, ''], b: ['other', 'distance'] }),
        ],
        result: ['melt', 'dist'],
      };
    },
  },
  {
    id: 'mask-from', label: 'Mask from it', kinds: ['distance'], shape: 'branch', sides: ['out'],
    anchor: { type: 'sdfMask', key: 'sdf', out: 'mask' },
    why: 'a distance: 1 inside, 0 outside, soft at the edge',
    args: [{ name: 'softness', label: 'Softness', kind: 'number', default: 0.01, words: ['softness', 'soft', 'edge'] }],
    build: ctx => ({
      nodes: [n('sdfMask', 'mask', C(1), 0, { threshold: 0, softness: num(ctx, 'softness', 0.01), ...note(
        'SDF Mask: 1 inside the shape, 0 outside, with a soft edge Softness wide.',
        'Why: the Mask suggestion. A mask mixes two pictures, cuts a texture, or drives anything by "inside or not".',
      ) }, { sdf: [IN, ''] })],
      result: ['mask', 'mask'],
      show: 'ifEmpty',
    }),
  },
];

// ── Space ───────────────────────────────────────────────────────────────────

const twist = (id: string, x: number, amount: number) => exprBlock(id, x, 0, {
  label: 'Twist',
  inputs: [{ name: 'p', type: 'vec2' }, { name: 'amount', type: 'float', slider: [-10, 10], value: amount }],
  lines: [['float a', 'length(p) * amount']],
  result: 'mat2(cos(a), sin(a), -sin(a), cos(a)) * p',
  outputType: 'vec2',
  wires: { p: [IN, ''] },
  comment: `Twist (Expression Block): turns the space more the further it is from the centre: by length(p) × amount radians.\nWhy: the Twist suggestion. Amount (${fmt(amount)}) sets how hard it twists; negative turns the other way.`,
});

const SPACE: Move[] = [
  {
    id: 'warp', label: 'Warp (noise)', kinds: ['space'], shape: 'transform', sides: ['in', 'out'],
    anchor: { type: 'domainWarp', key: 'uv', out: 'uv' },
    why: 'a space: noise pushes it about, for organic shapes',
    args: [{ name: 'amount', label: 'Strength', kind: 'number', default: 0.4, words: ['strength', 'amount', 'by'] }],
    build: ctx => ({
      nodes: [n('domainWarp', 'warp', C(1), 0, { strength: num(ctx, 'amount', 0.4), scale: 2, ...note(
        'Domain Warp: pushes the space about with layered noise.',
        'Why: the Warp suggestion. Strength sets how far: 0.5 is marbled, 2+ is soup. Wire Time into it to make it move.',
      ) }, { uv: [IN, ''] })],
      result: ['warp', 'uv'],
    }),
  },
  {
    id: 'swirl', label: 'Swirl', kinds: ['space'], shape: 'transform', sides: ['in', 'out'],
    anchor: { type: 'swirlSpace', key: 'input', out: 'output' },
    why: 'a space: a vortex round the centre',
    args: [{ name: 'amount', label: 'Strength', kind: 'number', default: 2, words: ['strength', 'amount', 'by'] }],
    build: ctx => ({
      nodes: [n('swirlSpace', 'swirl', C(1), 0, { strength: num(ctx, 'amount', 2), falloff: 1, ...note(
        'Swirl / Vortex: twists the space round the centre, most at the middle.',
        'Why: the Swirl suggestion. Strength is the twist at the centre, in radians.',
      ) }, { input: [IN, ''] })],
      result: ['swirl', 'output'],
    }),
  },
  {
    id: 'twist', label: 'Twist', kinds: ['space'], shape: 'transform', sides: ['in', 'out'],
    anchor: { type: 'exprNode', key: 'p', out: 'result' },
    why: 'a space: turns it more further out',
    args: [{ name: 'amount', label: 'Amount', kind: 'number', default: 3, words: ['amount', 'by', 'strength'] }],
    build: ctx => ({ nodes: [twist('twist', C(1), num(ctx, 'amount', 3))], result: ['twist', 'result'] }),
  },
  {
    id: 'polar', label: 'Polar', kinds: ['space'], shape: 'transform', sides: ['in', 'out'],
    anchor: { type: 'polarSpace', key: 'input', out: 'output' },
    why: 'a space: straight lines become rings and rays',
    args: [{ name: 'twist', label: 'Twist', kind: 'number', default: 0, words: ['twist', 'spiral'] }],
    build: ctx => ({
      nodes: [n('polarSpace', 'polar', C(1), 0, { twist: num(ctx, 'twist', 0), ...note(
        'Polar Space: x becomes the angle round the centre and y the distance from it.',
        'Why: the Polar suggestion. Stripes become rays, a row becomes a ring; Twist makes a spiral.',
      ) }, { input: [IN, ''] })],
      result: ['polar', 'output'],
    }),
  },
  {
    id: 'mirror', label: 'Mirror', kinds: ['space'], shape: 'transform', sides: ['in', 'out'],
    anchor: { type: 'exprNode', key: 'p', out: 'result' },
    why: 'a space: the left half is the right half, mirrored',
    args: [{ name: 'axis', label: 'Axis', kind: 'word', default: 'x', words: ['axis'] }],
    build: ctx => {
      const both = /both|xy/.test(str(ctx, 'axis', 'x'));
      const y = /^y$|vertical|top|bottom/.test(str(ctx, 'axis', 'x'));
      const result = both ? 'abs(p)' : y ? 'vec2(p.x, abs(p.y))' : 'vec2(abs(p.x), p.y)';
      return {
        nodes: [exprBlock('mirror', C(1), 0, {
          label: 'Mirror', inputs: [{ name: 'p', type: 'vec2' }], result, outputType: 'vec2', wires: { p: [IN, ''] },
          comment: `Mirror (Expression Block): ${result}: one side of the centre line reflects the other.\nWhy: the Mirror suggestion. abs(p) mirrors both ways.`,
        })],
        result: ['mirror', 'result'],
      };
    },
  },
  {
    id: 'repeat', label: 'Repeat', kinds: ['space'], shape: 'transform', sides: ['in', 'out'],
    anchor: { type: 'fract', key: 'input', out: 'output' },
    why: 'a space: the same tile over and over',
    args: [{ name: 'count', label: 'Tiles across', kind: 'count', default: 4, words: ['times', 'tiles', 'count', 'by'] }],
    build: ctx => ({
      nodes: [n('fract', 'tile', C(1), 0, { scale: num(ctx, 'count', 4), ...note(
        'Tile: repeats the space Scale times across, each tile centred on (0, 0).',
        'Why: the Repeat suggestion: whatever reads this space is drawn once in every tile. Shapes may need a smaller size to fit a tile.',
      ) }, { input: [IN, ''] })],
      result: ['tile', 'output'],
    }),
  },
  {
    id: 'repeat-around', label: 'Repeat around', kinds: ['space'], shape: 'transform', sides: ['in', 'out'],
    anchor: { type: 'angularRepeat2D', key: 'input', out: 'output' },
    why: 'a space: copies round the centre, like a flower',
    args: [{ name: 'count', label: 'Copies', kind: 'count', default: 6, words: ['times', 'copies', 'count', 'petals'] }],
    build: ctx => ({
      nodes: [n('angularRepeat2D', 'around', C(1), 0, { count: num(ctx, 'count', 6), ...note(
        'Angular Repeat: cuts the space into Count wedges round the centre, each a copy of the first.',
        'Why: the Repeat around suggestion. A shape off the centre becomes a ring of them.',
      ) }, { input: [IN, ''] })],
      result: ['around', 'output'],
    }),
  },
  {
    id: 'zoom-rotate', label: 'Zoom / rotate', kinds: ['space'], shape: 'transform', sides: ['in', 'out'],
    anchor: { type: 'uvTransform2d', key: 'uv', out: 'result' },
    why: 'a space: scale and turn it',
    args: [
      { name: 'zoom', label: 'Zoom', kind: 'number', default: 1.5, words: ['zoom', 'scale', 'by'] },
      { name: 'angle', label: 'Angle (rad)', kind: 'number', default: 0.4, words: ['angle', 'rotate', 'turn'] },
    ],
    build: ctx => {
      const s = 1 / Math.max(0.01, num(ctx, 'zoom', 1.5));
      return {
        nodes: [n('uvTransform2d', 'view', C(1), 0, { sx: Math.round(s * 1000) / 1000, sy: Math.round(s * 1000) / 1000, angle: num(ctx, 'angle', 0.4), ...note(
          'UV Transform 2D: moves, turns and scales the space.',
          `Why: the Zoom / rotate suggestion: zoomed ×${fmt(num(ctx, 'zoom', 1.5))} (Scale ${fmt(s)}: below 1 zooms in) and turned ${fmt(num(ctx, 'angle', 0.4))} rad.`,
        ) }, { uv: [IN, ''] })],
        result: ['view', 'result'],
      };
    },
  },
  {
    id: 'code-here', label: 'Custom code here', kinds: ['space', 'colour', 'mask', 'scalar', 'distance'], shape: 'transform', sides: ['in', 'out'],
    anchor: { type: 'exprNode', key: 'p', out: 'result' },
    why: 'an Expression Block between, to write your own line',
    when: ctx => ['float', 'vec2', 'vec3'].includes(ctx.type),
    build: ctx => {
      const t = ctx.type as 'float' | 'vec2' | 'vec3';
      return {
        nodes: [exprBlock('code', C(1), 0, {
          label: 'Custom code', inputs: [{ name: 'p', type: t }], result: 'p', outputType: t, wires: { p: [IN, ''] },
          comment: `Custom code (Expression Block): p is the ${t} coming in; the result goes on unchanged until you write something.\nWhy: the "Custom code here" suggestion. Open it (⟴) and add lines, e.g. p = p * 2.0, or use a snippet.`,
        })],
        result: ['code', 'result'],
      };
    },
  },
];

// ── Colour ──────────────────────────────────────────────────────────────────

const COLOUR: Move[] = [
  {
    id: 'mix-with', label: 'Mix with…', kinds: ['colour'], shape: 'transform', sides: ['out', 'in'],
    anchor: { type: 'oklabMix', key: 'a', out: 'result' },
    why: 'a colour: blends it toward another',
    args: [
      { name: 'colour', label: 'Colour', kind: 'colour', default: [0.2, 0.5, 1] },
      { name: 'amount', label: 'Amount', kind: 'number', default: 0.5, words: ['amount', 'by'] },
    ],
    build: ctx => ({
      nodes: [
        n('colorPicker', 'other', C(1), 300, { color: rgb(ctx, 'colour', [0.2, 0.5, 1]), ...note('Color: the colour it is mixed with. Click the swatch to change it, or wire any picture in its place.') }),
        n('oklabMix', 'mixed', C(2), 0, { t: num(ctx, 'amount', 0.5), ...note(
          'OkLab Mix: blends A toward B by T, through a perceptual colour space (no muddy middle).',
          'Why: the Mix with… suggestion, in place.',
        ) }, { a: [IN, ''], b: ['other', 'rgb'] }),
      ],
      result: ['mixed', 'result'],
    }),
  },
  {
    id: 'palette', label: 'Palette', kinds: ['colour'], shape: 'transform', sides: ['out', 'in'],
    anchor: { type: 'luminance', key: 'color', out: 'result' },
    why: 'a colour: recolour it by brightness',
    build: () => ({
      nodes: [
        n('luminance', 'bright', C(1), 0, note('Luminance: how bright each pixel is, 0…1.', 'Why: the Palette suggestion recolours by brightness.'), { color: [IN, ''] }),
        n('palette', 'recolour', C(2), 0, { preset: '0', ...note('Palette: brightness → colour along a cosine gradient. Pick a preset or change Scale for more bands.', 'Why: the Palette suggestion, in place.') }, { value: ['bright', 'result'] }),
      ],
      result: ['recolour', 'color'],
    }),
  },
  {
    id: 'tone-map', label: 'Tone map', kinds: ['colour'], shape: 'transform', sides: ['out', 'in'],
    anchor: { type: 'toneMap', key: 'color', out: 'color' },
    why: 'a colour: brings bright parts back into range with their detail',
    build: () => ({
      nodes: [n('toneMap', 'tone', C(1), 0, { mode: 'aces', ...note(
        'Tone Map (ACES): squeezes values above 1 back into range, smoothly, so bright parts keep their detail instead of clipping to white.',
        'Why: the Tone map suggestion, in place.',
      ) }, { color: [IN, ''] })],
      result: ['tone', 'color'],
    }),
  },
  {
    id: 'grade', label: 'Grade', kinds: ['colour'], shape: 'transform', sides: ['out', 'in'],
    anchor: { type: 'liftGammaGain', key: 'color', out: 'color' },
    why: 'a colour: shadows, midtones and highlights',
    build: () => ({
      nodes: [n('liftGammaGain', 'grade', C(1), 0, { lift: [0.02, 0.0, 0.04], gamma: [1, 1, 1], gain: [1.05, 1.0, 0.95], ...note(
        'Lift / Gamma / Gain: Lift tints the shadows, Gamma the midtones, Gain the highlights.',
        'Why: the Grade suggestion, in place, starting from a gentle cool-shadow / warm-highlight look.',
      ) }, { color: [IN, ''] })],
      result: ['grade', 'color'],
    }),
  },
  {
    id: 'brighten', label: 'Brighter', kinds: ['colour'], shape: 'transform', sides: ['out', 'in'],
    anchor: { type: 'brightnessContrast', key: 'color', out: 'result' },
    why: 'a colour: lifts brightness',
    args: [{ name: 'amount', label: 'Brightness', kind: 'number', default: 0.15, words: ['by', 'amount', 'brightness'] }],
    build: ctx => ({
      nodes: [n('brightnessContrast', 'bright', C(1), 0, { brightness: num(ctx, 'amount', 0.15), contrast: 1, ...note(
        'Brightness / Contrast: adds Brightness to every pixel and scales the contrast round mid-grey.',
        'Why: the Brighter suggestion, in place.',
      ) }, { color: [IN, ''] })],
      result: ['bright', 'result'],
    }),
  },
  {
    id: 'glow-colour', label: 'Glow', kinds: ['colour'], shape: 'transform', sides: ['out'],
    anchor: { type: 'bloom', key: 'color', out: 'result' },
    why: 'a colour: bright parts bleed light round them',
    args: [{ name: 'amount', label: 'Intensity', kind: 'number', default: 1.2, words: ['intensity', 'amount', 'by'] }],
    build: ctx => ({
      nodes: [n('bloom', 'bloom', C(1), 0, { intensity: num(ctx, 'amount', 1.2), ...note(
        'Bloom: the bright parts spread a soft glow round themselves (a post effect on the colour coming in).',
        'Why: the Glow suggestion, in place. Threshold picks how bright a pixel must be to glow.',
      ) }, { color: [IN, ''] })],
      result: ['bloom', 'result'],
    }),
  },
  {
    id: 'grain', label: 'Grain', kinds: ['colour'], shape: 'transform', sides: ['out', 'in'],
    anchor: { type: 'grain', key: 'color', out: 'color' },
    why: 'a colour: film grain, which also hides banding',
    args: [{ name: 'amount', label: 'Amount', kind: 'number', default: 0.05, words: ['amount', 'by'] }],
    build: ctx => ({
      nodes: [n('grain', 'grain', C(1), 0, { amount: num(ctx, 'amount', 0.05), ...note(
        'Grain: adds fine noise to the colour, different every frame.',
        'Why: the Grain suggestion, in place. A little grain also breaks up banding in smooth gradients.',
      ) }, { color: [IN, ''] })],
      result: ['grain', 'color'],
    }),
  },
  {
    id: 'blend-with', label: 'Blend', kinds: ['colour'], shape: 'transform', sides: ['out', 'in'],
    anchor: { type: 'blendModes', key: 'base', out: 'result' },
    why: 'a colour: layer another picture over it',
    args: [{ name: 'mode', label: 'Mode', kind: 'word', default: 'screen', words: ['mode'] }],
    build: ctx => {
      const other = standInPicture('other', C(1), 360);
      return {
        nodes: [
          ...other.nodes.map(nd => (nd.id === 'otherNoise' ? { ...nd, params: { ...nd.params, __comment: `${String(nd.params.__comment)}\nWhy: the second picture for Blend. Swap it for anything.` } } : nd)),
          n('blendModes', 'blend', C(3), 0, { mode: str(ctx, 'mode', 'screen'), opacity: 0.6, ...note(
            'Blend Modes: lays Blend over Base with a Photoshop-style mode (Screen lightens, Multiply darkens, Overlay adds contrast).',
            'Why: the Blend suggestion, in place. Opacity sets how much of the second picture shows.',
          ) }, { base: [IN, ''], blend: other.out }),
        ],
        result: ['blend', 'result'],
      };
    },
  },
];

// ── Mask ────────────────────────────────────────────────────────────────────

const SOFT_PARAMS = ['softness', 'smoothing', 'edge', 'antialias', 'aa', 'edgeSoftness'];

const MASK: Move[] = [
  {
    id: 'soft-edge', label: 'Soft edge', kinds: ['mask', 'scalar'], shape: 'transform', sides: ['out'],
    anchor: { type: 'smoothstep', key: 'value', out: 'result' },
    why: 'a smooth edge instead of a hard step',
    args: [{ name: 'amount', label: 'Softness', kind: 'number', default: 0.2, words: ['softness', 'by', 'amount'] }],
    build: ctx => {
      // A node with its own softness setting: raise it rather than adding a node.
      const own = SOFT_PARAMS.find(k => typeof ctx.self.params[k] === 'number' && getNodeDefinition(ctx.self.type)?.paramDefs?.[k]);
      if (own && ctx.side === 'out') {
        const v = ctx.self.params[own] as number;
        return { nodes: [], selfParams: { [own]: Math.max(v * 3, 0.02) } };
      }
      const s = num(ctx, 'amount', 0.2);
      return {
        nodes: [n('smoothstep', 'soft', C(1), 0, { edge0: Math.round((0.5 - s) * 1000) / 1000, edge1: Math.round((0.5 + s) * 1000) / 1000, ...note(
          'Smoothstep: 0 below Edge 0, 1 above Edge 1, an S-curve between.',
          'Why: the Soft edge suggestion, in place: the edge eases in instead of stepping.',
        ) }, { value: [IN, ''] })],
        result: ['soft', 'result'],
      };
    },
  },
  {
    id: 'invert', label: 'Invert', kinds: ['mask'], shape: 'transform', sides: ['out', 'in'],
    anchor: { type: 'remap', key: 'value', out: 'result' },
    why: 'a mask: inside becomes outside',
    build: () => ({
      nodes: [n('remap', 'flip', C(1), 0, { inMin: 0, inMax: 1, outMin: 1, outMax: 0, ...note('Remap 0…1 → 1…0: one minus the mask.', 'Why: the Invert suggestion, in place.') }, { value: [IN, ''] })],
      result: ['flip', 'result'],
    }),
  },
  {
    id: 'grow-mask', label: 'Grow / shrink', kinds: ['mask'], shape: 'transform', sides: ['out'],
    anchor: { type: 'smoothstep', key: 'value', out: 'result' },
    why: 'a mask: moves where it counts as inside',
    args: [{ name: 'amount', label: 'Grow by', kind: 'number', default: 0.2, words: ['by', 'amount'] }],
    build: ctx => {
      const a = num(ctx, 'amount', 0.2);
      const mid = Math.min(0.95, Math.max(0.05, 0.5 - a));
      return {
        nodes: [n('smoothstep', 'grow', C(1), 0, { edge0: Math.round((mid - 0.05) * 1000) / 1000, edge1: Math.round((mid + 0.05) * 1000) / 1000, ...note(
          'Smoothstep: re-thresholds the mask: anything above Edge 0…Edge 1 counts as inside.',
          'Why: the Grow / shrink suggestion. Lower edges grow a soft mask, higher ones shrink it (a hard 0/1 mask needs its shape grown instead).',
        ) }, { value: [IN, ''] })],
        result: ['grow', 'result'],
      };
    },
  },
  {
    id: 'mix-two', label: 'Mix two pictures', kinds: ['mask'], shape: 'branch', sides: ['out'],
    anchor: { type: 'mask', key: 'mask', out: 'result' },
    why: 'a mask: one picture inside, another outside',
    build: ctx => {
      const a = picture(ctx, 'first', C(0), 420);
      const b = standInPicture('second', C(1), 760);
      return {
        nodes: [
          ...a.nodes,
          ...b.nodes,
          n('mask', 'cut', C(3), 0, { threshold: 0.5, edge: 0.05, ...note(
            'Mask: A where the mask is low, B where it is high, cut at Threshold (Edge softens the cut).',
            `Why: the Mix two pictures suggestion. A is ${ctx.hasPicture ? 'what the Output showed' : 'a stand-in picture'}, B a second stand-in: swap either for anything.`,
          ) }, { a: a.out, b: b.out, mask: [IN, ''] }),
        ],
        result: ['cut', 'result'],
        show: 'replace',
      };
    },
  },
];

// ── Texture ─────────────────────────────────────────────────────────────────

const TEXTURE: Move[] = [
  {
    id: 'blur-texture', label: 'Blur', kinds: ['texture'], shape: 'branch', sides: ['out'],
    anchor: { type: 'blurTexture', key: 'texture', out: 'color' }, recipe: 'pass-blur',
    why: 'a texture: a soft Gaussian blur',
    args: [{ name: 'amount', label: 'Radius (px)', kind: 'number', default: 8, words: ['radius', 'by', 'amount'] }],
    build: ctx => ({
      nodes: [n('blurTexture', 'blur', C(1), 0, { radius: num(ctx, 'amount', 8), ...note('Blur (texture): averages the texture round each pixel, Radius pixels wide.', 'Why: the Blur suggestion, on the Output.') }, { texture: [IN, ''] })],
      result: ['blur', 'color'],
      show: 'replace',
    }),
  },
  {
    id: 'glow-texture', label: 'Glow', kinds: ['texture'], shape: 'branch', sides: ['out'],
    anchor: { type: 'glowTexture', key: 'texture', out: 'glow' }, recipe: 'pass-glow',
    why: 'a texture: its bright parts spread a halo',
    build: () => ({
      nodes: [n('glowTexture', 'glow', C(1), 0, { threshold: 0.6, radius: 16, intensity: 0.8, ...note('Glow (texture): keeps what is brighter than Threshold and spreads it Radius pixels.', 'Why: the Glow suggestion, added over the picture.') }, { texture: [IN, ''] })],
      result: ['glow', 'glow'],
      show: 'layer',
    }),
  },
  {
    id: 'trails', label: 'Trails', kinds: ['texture', 'colour'], shape: 'branch', sides: ['out'],
    anchor: { type: 'textureFade', key: 'fresh', out: 'color' },
    why: 'feedback: whatever moves leaves a fading trail',
    when: ctx => ctx.nodes.some(nd => nd.type === 'output'),
    build: () => ({
      nodes: [n('textureFade', 'fade', C(1), 0, note('Fade (feedback): last frame, faded, with the picture painted on top.', 'Why: the Trails suggestion (the Fade node\'s own Trails setup).'))],
      thenRecipe: { nodeId: 'fade', recipeId: 'fade-trails' },
    }),
  },
  {
    id: 'outline-texture', label: 'Outline', kinds: ['texture'], shape: 'branch', sides: ['out'],
    anchor: { type: 'edgesTexture', key: 'texture', out: 'color' }, recipe: 'pass-edges',
    why: 'a texture: lines where it changes fast',
    build: () => ({
      nodes: [n('edgesTexture', 'edges', C(1), 0, { strength: 3, width: 1.5, ...note('Edges (texture): bright where the texture changes fast.', 'Why: the Outline suggestion, added over the picture.') }, { texture: [IN, ''] })],
      result: ['edges', 'color'],
      show: 'layer',
    }),
  },
  {
    id: 'flow', label: 'Flow', kinds: ['texture'], shape: 'branch', sides: ['out'],
    anchor: { type: 'textureFlow', key: 'texture', out: 'flow' },
    why: 'a texture: smears it along its own slopes',
    build: () => ({
      nodes: [
        n('textureFlow', 'flow', C(1), 300, { strength: 0.05, ...note('Flow (texture): a direction at every pixel, along the texture\'s brightness slopes.', 'Why: the Flow suggestion: the direction Read follows.') }, { texture: [IN, ''] }),
        n('readTexture', 'read', C(2), 0, { flowAmount: 1, ...note('Read (texture): the texture read a little along the flow, so it streams along its own shapes.', 'Why: the Flow suggestion, on the Output. Flow amount for more or less.') }, { texture: [IN, ''], flow: ['flow', 'flow'] }),
      ],
      result: ['read', 'color'],
      show: 'replace',
    }),
  },
];

// ── Numbers ─────────────────────────────────────────────────────────────────

const SCALAR: Move[] = [
  {
    id: 'colour-it', label: 'Palette', kinds: ['scalar', 'mask'], shape: 'branch', sides: ['out'],
    anchor: { type: 'palette', key: 'value', out: 'color' },
    why: 'a number: as colour through a palette',
    build: () => ({
      nodes: [n('palette', 'colour', C(1), 0, { preset: '0', ...note('Palette: the number as colour along a cosine gradient.', 'Why: the Palette suggestion, on the Output.') }, { value: [IN, ''] })],
      result: ['colour', 'color'],
      show: 'replace',
    }),
  },
  {
    id: 'remap', label: 'Remap', kinds: ['scalar'], shape: 'transform', sides: ['out', 'in'],
    anchor: { type: 'remap', key: 'value', out: 'result' },
    why: 'a number: from one range into another',
    args: [
      { name: 'inMin', label: 'From min', kind: 'number', default: 0 },
      { name: 'inMax', label: 'From max', kind: 'number', default: 1 },
    ],
    build: ctx => ({
      nodes: [n('remap', 'range', C(1), 0, { inMin: num(ctx, 'inMin', 0), inMax: num(ctx, 'inMax', 1), outMin: 0, outMax: 1, ...note(
        `Remap: ${fmt(num(ctx, 'inMin', 0))}…${fmt(num(ctx, 'inMax', 1))} → 0…1.`,
        'Why: the Remap suggestion, in place: the value lands in the range the next node expects.',
      ) }, { value: [IN, ''] })],
      result: ['range', 'result'],
    }),
  },
];

// ── Output fixes (outputRules.ts picks them from the preview's measurements) ─

const INTENSITY_PARAMS = ['intensity', 'gain', 'exposure', 'amount', 'strength', 'brightness', 'scale'];

/** The node's own "how bright" setting, and which way is brighter. */
export function intensityParam(node: GraphNode): { key: string; brighterUp: boolean } | null {
  const defs = getNodeDefinition(node.type)?.paramDefs ?? {};
  // SDF Glow's Brightness is its Falloff: higher is tighter and dimmer.
  if (node.type === 'light' && typeof node.params.brightness === 'number') return { key: 'brightness', brighterUp: false };
  for (const k of INTENSITY_PARAMS) if (typeof node.params[k] === 'number' && defs[k]?.type === 'float') return { key: k, brighterUp: true };
  if (node.type === 'multiply' && typeof node.params.b === 'number') return { key: 'b', brighterUp: true };
  return null;
}

const FIXES: Move[] = [
  {
    id: 'dimmer', label: 'Lower intensity', kinds: ['colour', 'scalar', 'distance', 'mask'], shape: 'param', sides: ['out'],
    why: 'clipping: a smaller value keeps the highlights',
    when: ctx => !!intensityParam(ctx.self),
    build: ctx => {
      const p = intensityParam(ctx.self)!;
      const v = ctx.self.params[p.key] as number;
      return { nodes: [], selfParams: { [p.key]: Math.round((p.brighterUp ? v * 0.6 : v * 1.6) * 1000) / 1000 } };
    },
  },
  {
    id: 'brighter-param', label: 'Raise intensity', kinds: ['colour', 'scalar', 'distance', 'mask'], shape: 'param', sides: ['out'],
    why: 'mostly black: a bigger value brings it up',
    when: ctx => !!intensityParam(ctx.self),
    build: ctx => {
      const p = intensityParam(ctx.self)!;
      const v = ctx.self.params[p.key] as number;
      return { nodes: [], selfParams: { [p.key]: Math.round((p.brighterUp ? (v || 0.5) * 1.6 : v * 0.6) * 1000) / 1000 } };
    },
  },
  {
    id: 'feed-uv', label: 'Wire UV in', kinds: ['colour', 'scalar', 'distance', 'mask', 'space'], shape: 'param', sides: ['out'],
    why: 'flat: nothing position-dependent reaches it',
    when: ctx => Object.entries(ctx.self.inputs).some(([k, s]) => s.type === 'vec2' && !s.connection && /uv|position|^p$|input/i.test(k)),
    build: ctx => {
      const key = Object.entries(ctx.self.inputs).find(([k, s]) => s.type === 'vec2' && !s.connection && /uv|position|^p$|input/i.test(k))![0];
      return {
        nodes: [n('uv', 'uv', -C(1), 0, note('UV: the position of each pixel, (0, 0) in the middle.', 'Why: the node was one flat value everywhere; with UV it changes across the picture.'))],
        selfWires: { [key]: ['uv', 'uv'] },
      };
    },
  },
  {
    id: 'add-noise', label: 'Add noise', kinds: ['scalar', 'mask'], shape: 'transform', sides: ['out'],
    anchor: { type: 'add', key: 'a', out: 'result' },
    why: 'flat: noise gives it something to vary',
    build: () => ({
      nodes: [
        n('noiseFloat', 'noise', C(1), 300, { scale: 4, outMin: -0.25, outMax: 0.25, ...note('Noise Float: smooth noise, −0.25…0.25.', 'Why: something that changes across the picture.')}),
        n('add', 'plus', C(2), 0, note('Add: the value plus the noise.', 'Why: the Add noise suggestion, in place.'), { a: [IN, ''], b: ['noise', 'value'] }),
      ],
      result: ['plus', 'result'],
    }),
  },
  {
    id: 'add-gradient', label: 'Add a gradient', kinds: ['colour'], shape: 'transform', sides: ['out'],
    anchor: { type: 'blendModes', key: 'base', out: 'result' },
    why: 'flat: a gradient gives it depth',
    build: () => ({
      nodes: [
        n('gradient', 'grad', C(1), 300, note('Gradient: a smooth blend between two colours across the picture.', 'Why: something that changes across the picture.')),
        n('blendModes', 'over', C(2), 0, { mode: 'overlay', opacity: 0.7, ...note('Blend Modes (Overlay): the gradient laid over the colour.', 'Why: the Add a gradient suggestion, in place.') }, { base: [IN, ''], blend: ['grad', 'color'] }),
      ],
      result: ['over', 'result'],
    }),
  },
  {
    id: 'jitter', label: 'Turn on Jitter', kinds: ['colour', 'scene3d'], shape: 'param', sides: ['out'],
    why: 'banding: jitter staggers the march steps',
    when: ctx => typeof ctx.self.params.jitter === 'number' && !!getNodeDefinition(ctx.self.type)?.paramDefs?.jitter,
    build: () => ({ nodes: [], selfParams: { jitter: 1, jitterNoise: 'even' } }),
  },
  {
    id: 'dither', label: 'Dither', kinds: ['scalar', 'mask', 'distance'], shape: 'transform', sides: ['out'],
    anchor: { type: 'exprNode', key: 'p', out: 'result' },
    why: 'banding: a tiny per-pixel offset hides the steps',
    build: () => ({
      nodes: [exprBlock('dither', C(1), 0, {
        label: 'Dither', inputs: [{ name: 'p', type: 'float' }],
        lines: [['float h', 'fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453)']],
        result: 'p + (h - 0.5) / 255.0', outputType: 'float', wires: { p: [IN, ''] },
        comment: 'Dither (Expression Block): adds a different tiny offset (under one 8-bit step) to every pixel.\nWhy: the Dither suggestion: smooth gradients stop showing stair-step bands.',
      })],
      result: ['dither', 'result'],
    }),
  },
];

// ── Two nodes (the Do… bar: "blend these", "mix these colours") ─────────────

const hasOther = (ctx: MoveContext) => typeof ctx.args.other === 'string' && typeof ctx.args.otherKey === 'string' && ctx.args.other !== ctx.self.id;

const PAIR: Move[] = [
  {
    id: 'blend-pair', label: 'Smooth blend', kinds: ['distance'], shape: 'transform', sides: ['out'], hidden: true,
    anchor: { type: 'sdfUnion', key: 'a', out: 'dist' },
    why: 'two distances melted into one',
    args: [{ name: 'smoothness', label: 'Smoothness', kind: 'number', default: 0.15, words: ['smoothness', 'smooth', 'k'] }],
    when: hasOther,
    build: ctx => ({
      nodes: [n('sdfUnion', 'melt', C(1), 0, { k: num(ctx, 'smoothness', 0.15), ...note(
        'Union with K: the two shapes as one, melted together over K.',
        'Why: "blend these": what read the first shape now reads both.',
      ) }, { a: [IN, ''], b: [OTHER, ''] })],
      result: ['melt', 'dist'],
    }),
  },
  {
    id: 'mix-pair', label: 'Mix', kinds: ['colour'], shape: 'transform', sides: ['out'], hidden: true,
    anchor: { type: 'oklabMix', key: 'a', out: 'result' },
    why: 'two colours mixed',
    args: [{ name: 'amount', label: 'Amount', kind: 'number', default: 0.5, words: ['amount', 'by'] }],
    when: hasOther,
    build: ctx => ({
      nodes: [n('oklabMix', 'mixed', C(1), 0, { t: num(ctx, 'amount', 0.5), ...note(
        'OkLab Mix: A toward B by T, through a perceptual colour space.',
        'Why: "mix these": what read the first colour now reads the mix.',
      ) }, { a: [IN, ''], b: [OTHER, ''] })],
      result: ['mixed', 'result'],
    }),
  },
];

export const MOVES: readonly Move[] = [...DISTANCE, ...SPACE, ...COLOUR, ...MASK, ...TEXTURE, ...SCALAR, ...FIXES, ...PAIR];
export const MOVES_BY_ID: ReadonlyMap<string, Move> = new Map(MOVES.map(m => [m.id, m]));

/** Moves made elsewhere (taught.ts: moves you taught the Do… bar), offered with the built-in ones. */
let extraMoves: () => readonly Move[] = () => [];
export function setExtraMoves(fn: () => readonly Move[]): void { extraMoves = fn; }
export function allMoves(): readonly Move[] { return [...MOVES, ...extraMoves()]; }
/** A move by id: built-in or taught. */
export function moveById(id: string): Move | undefined { return MOVES_BY_ID.get(id) ?? extraMoves().find(m => m.id === id); }
/** Moves only the output rules offer (they say "clips 6%", not "you often…"). */
export const FIX_IDS = new Set(FIXES.map(m => m.id));

/** The moves for a kind on one side of a socket (the fixes excluded: outputRules picks those). */
export function movesFor(kind: ValueKind, side: 'in' | 'out'): Move[] {
  return allMoves().filter(m => !FIX_IDS.has(m.id) && !m.hidden && m.kinds.includes(kind) && m.sides.includes(side));
}

/**
 * The quick-add rules (quickAdds.ts) for an output, as branch moves "Add <node>": the generic
 * "this usually goes next" adds, so they rank with the rest without a second list.
 */
export function quickAddMoves(node: GraphNode, key: string, kind: ValueKind): Move[] {
  const s = node.outputs[key];
  if (!s) return [];
  return suggestQuickAdds({ type: s.type, dir: 'out', label: s.label, key, nodeType: node.type }).map(q => {
    const def = getNodeDefinition(q.type)!;
    const out = Object.keys(def.outputs)[0];
    const outType = def.outputs[out]?.type;
    return {
      id: `qa:${q.type}`, label: q.label, kinds: [kind], shape: 'branch' as const, sides: ['out' as const],
      anchor: { type: q.type, key: q.key, out },
      why: `${q.note}`,
      build: (): MoveBuild => ({
        nodes: [n(q.type, 'added', C(1), 0, note(`${q.label}: ${q.note}.`, `Why: added from the suggestions, wired from ${labelOf(node)}.`), { [q.key]: [IN, ''] })],
        result: ['added', out],
        show: outType === 'vec3' ? 'ifEmpty' : 'none',
      }),
    };
  });
}
