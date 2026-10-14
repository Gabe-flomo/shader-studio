/**
 * Built-in compound effects (docs/compound-effects.md): ready-made groups from the "Textures That
 * Remember" guide's recipes, offered in the node palette's Presets tab next to your saved group
 * presets. Each is a plain group (colour in, colour out, or colour out only) holding Passes, a
 * Feedback (texture) or a Data Texture; the compiler opens the group before it cuts the passes, so
 * they work like any graph. Their sliders show on the group card; open the group to see how.
 */
import type { GraphNode, SubgraphData } from '../types/nodeGraph';
import { n, port } from './graphBuilder';

export interface CompoundEffect {
  id: string;
  label: string;
  description: string;
  make: () => SubgraphData;
}

const note = (text: string | string[]) => ({ __comment: Array.isArray(text) ? text.join('\n') : text });

/** An Expression Block: named inputs (wired as given), lines `type name = rhs`, a result. */
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

const colourIn = (to: string, key: string) => [{ key: 'c', type: 'vec3' as const, label: 'Colour', toNodeId: to, toInputKey: key }];
const colourOut = (from: string, key: string, label = 'Colour') => [{ key: 'o', type: 'vec3' as const, label, fromNodeId: from, fromOutputKey: key }];

/** A source Pass of what comes in: its Texture now and Previous a frame ago. */
const source = (id: string) => n('pass', id, 0, 0, { label: 'Pass · picture in', ...note('Pass: what comes into the group, as a texture (now) with its frame before (Previous).') }, { color: port('c') });

export const COMPOUND_EFFECTS: CompoundEffect[] = [
  {
    id: 'cx_longExposure', label: 'Long exposure',
    description: 'A running average of what comes in: moving things blur into streaks, still things stay sharp. Frames sets how many frames it averages over (30 ≈ half a second at 60 fps). Unlike a fading trail it never brightens past the true colour.',
    make: () => ({
      nodes: [
        n('constant', 'frames', 0, 300, { label: 'Frames', value: 30, ...note('Frames: how many frames the average spans. More is a longer exposure.') }),
        n('sampleTexture', 'mean', 300, 300, note('Sample (texture): the average so far (the Pass\'s Previous: last frame\'s average).'), { texture: ['acc', 'previous'] }),
        expr('blend', 600, 150, {
          label: 'Average', outputType: 'vec3',
          inputs: [['now', 'vec3', port('c')], ['before', 'vec3', ['mean', 'color']], ['n', 'float', ['frames', 'value']]],
          lines: [['float k', '1.0 / max(n, 1.0)']],
          result: 'mix(before, now, k)',
          note: ['Expression Block: a step of the running average.', 'k: this frame\'s share, one over Frames.', 'Result: last average moved a k-th of the way to now.'],
        }),
        n('pass', 'acc', 900, 150, { label: 'Pass · average', format: 'half', ...note('Pass: keeps the average, read back through Previous next frame.') }, { color: ['blend', 'result'] }),
      ],
      inputPorts: colourIn('blend', 'now'),
      outputPorts: colourOut('acc', 'color'),
    }),
  },
  {
    id: 'cx_motionTrails', label: 'Trails where it moves',
    description: 'Feedback trails that only start where something moves: Change (texture) finds the motion, and only moving parts are laid into the trail. Still things stay out of it. Feedback\'s Tail, Hue drift and Blend are on the card.',
    make: () => ({
      nodes: [
        source('src'),
        n('textureChange', 'moved', 300, 0, { amount: 6, level: 0.04, ...note('Change (texture): Motion is bright where the picture changed since last frame.') }, { texture: ['src', 'texture'], before: ['src', 'previous'] }),
        expr('fresh', 600, 0, {
          label: 'Only what moves', outputType: 'vec3',
          inputs: [['c', 'vec3', port('c')], ['m', 'float', ['moved', 'motion']]],
          lines: [], result: 'c * m',
          note: ['Expression Block: the picture where it moved, black elsewhere: what the trail is painted with.'],
        }),
        n('textureFeedback', 'trail', 900, 0, { label: 'Trail', tail: 2, blend: 'max', hueDrift: 30, ...note('Feedback (texture): keeps the moving parts and fades them with Tail; Hue drift turns old trails through the colours.') }, { texture: ['src', 'texture'], fresh: ['fresh', 'result'] }),
      ],
      inputPorts: colourIn('src', 'color'),
      outputPorts: colourOut('trail', 'color'),
    }),
  },
  {
    id: 'cx_datamosh', label: 'Datamosh',
    description: 'A broken-codec look: where the picture moves, last frame is dragged along the motion instead of being replaced, so old frames smear through the new. Still parts update as normal. Push sets how far the motion drags.',
    make: () => ({
      nodes: [
        source('src'),
        n('textureChange', 'moved', 300, 0, { amount: 6, level: 0.04, ...note('Change (texture): Motion (how much moved) and Direction (which way), from now against last frame.') }, { texture: ['src', 'texture'], before: ['src', 'previous'] }),
        n('constant', 'push', 300, 300, { label: 'Push', value: 1.5, ...note('Push: how far the motion drags the old picture each frame.') }),
        expr('flow', 600, 200, {
          label: 'Drag', outputType: 'vec2',
          inputs: [['d', 'vec2', ['moved', 'direction']], ['k', 'float', ['push', 'value']]],
          lines: [], result: 'd * k * 0.004',
          note: ['Expression Block: the motion direction (picture pixels a frame) as a push in picture units, times Push.'],
        }),
        expr('fresh', 600, 0, {
          label: 'Keep where still', outputType: 'vec3',
          inputs: [['c', 'vec3', port('c')], ['m', 'float', ['moved', 'motion']]],
          lines: [], result: 'c * (1.0 - m)',
          note: ['Expression Block: the new picture only where nothing moved; where it moved, the dragged old frame shows.'],
        }),
        n('textureFeedback', 'mosh', 900, 0, { label: 'Mosh', tail: 8, clean: 0, blend: 'max', ...note('Feedback (texture): last frame pushed along Drag, with the still parts laid over it. A long Tail keeps the smear.') }, { texture: ['src', 'texture'], fresh: ['fresh', 'result'], flow: ['flow', 'result'] }),
      ],
      inputPorts: colourIn('src', 'color'),
      outputPorts: colourOut('mosh', 'color'),
    }),
  },
  {
    id: 'cx_kaleidoFeedback', label: 'Kaleidoscope feedback',
    description: 'Feedback read through a kaleidoscope fold: every frame reads a folded copy of the last, so the symmetry compounds into crystals. Segments sets the fold; Feedback\'s Zoom, Turn and Hue drift are on the card.',
    make: () => ({
      nodes: [
        source('src'),
        n('uv', 'uvn', 0, 300, note('UV: this pixel\'s place.')),
        n('constant', 'segs', 0, 450, { label: 'Segments', value: 6, ...note('Segments: how many mirrored wedges round the centre.') }),
        expr('fold', 300, 300, {
          label: 'Fold', outputType: 'vec2',
          inputs: [['uv', 'vec2', ['uvn', 'uv']], ['n', 'float', ['segs', 'value']]],
          lines: [['float wedge', '6.2831853 / max(n, 1.0)'], ['float a', 'abs(mod(atan(uv.y, uv.x), wedge) - wedge * 0.5)'], ['float r', 'length(uv)']],
          result: 'r * vec2(cos(a), sin(a))',
          note: ['Expression Block: folds the picture into mirrored wedges.', 'wedge: the angle of one wedge.', 'a: the angle folded into half a wedge, mirrored.', 'r: the distance from the centre, kept.'],
        }),
        n('textureFeedback', 'kal', 600, 0, { label: 'Crystal', tail: 3, zoom: 1.01, turn: 0.6, hueDrift: 20, blend: 'max', ...note('Feedback (texture): reads last frame through the fold, a little zoomed and turned, so the symmetry builds on itself.') }, { texture: ['src', 'texture'], uv: ['fold', 'result'] }),
      ],
      inputPorts: colourIn('src', 'color'),
      outputPorts: colourOut('kal', 'color'),
    }),
  },
  {
    id: 'cx_ripples', label: 'Ripples (waves)',
    description: 'A water surface that carries waves: the wave equation on a Data Texture (height now and a frame ago, full float). Drops fall at random places; they spread, cross and interfere. Speed and Damping on the card.',
    make: () => ({
      nodes: [
        n('uv', 'uvn', 0, 0, note('UV: this pixel\'s place.')),
        n('time', 'clock', 0, 150, note('Time: picks where and when drops fall.')),
        n('constant', 'speed', 0, 300, { label: 'Speed', value: 0.35, ...note('Speed: how fast waves travel (keep under 0.5, or the waves blow up).') }),
        n('constant', 'damping', 0, 450, { label: 'Damping', value: 0.996, ...note('Damping: how much of a wave is kept each frame (1 never calms down).') }),
        n('readNeighbours', 'nb', 300, 300, { channels: 'r', distance: 1,
          ...note('Read neighbours (texture): the height one texel left, right, up and down, last frame, read exactly. Laplacian is how curved the surface is (what makes the waves travel); Gradient is which way it tilts (for the shading).') },
          { texture: ['wave', 'previous'] }),
        expr('step', 600, 150, {
          label: 'Wave step', outputType: 'vec2',
          inputs: [['s', 'vec2', ['wave', 'out0']], ['lap', 'float', ['nb', 'laplacian']],
            ['uv', 'vec2', ['uvn', 'uv']], ['t', 'float', ['clock', 'time']], ['c2', 'float', ['speed', 'value']], ['damp', 'float', ['damping', 'value']]],
          lines: [
            ['float k', 'floor(t * 1.5)'],
            ['vec2 at', '(fract(sin(vec2(k * 12.9898, k * 78.233)) * 43758.5453) * 2.0 - 1.0) * vec2(1.4, 0.8)'],
            ['float r2', 'dot(uv - at, uv - at) * 1500.0'],
            ['float drop', '(1.0 - r2) * exp(-r2) * step(fract(t * 1.5), 0.03)'],
          ],
          result: 'vec2((2.0 * s.x - s.y + c2 * lap) * damp + drop * 0.25, s.x)',
          note: [
            'Expression Block: one step of the wave equation. s is (height now, height a frame ago) from last frame; lap comes from Read neighbours.',
            'k, at: every two thirds of a second a drop falls at a random place.',
            'r2, drop: the drop\'s shape, up in the middle and down round it. It adds no water overall, so no raised patch is left inside the ring as it spreads.',
            'Result: next height = 2·now − before + Speed·curvature, damped, plus the drop; and now becomes before.',
          ],
        }),
        n('dataTexture', 'wave', 900, 150, { label: 'Wave', fields: [{ name: 'height', type: 'vec2', channels: 'rg' }], reads: [{ name: 'height', channels: 'rg' }], format: 'float', read: 'exact', previewView: 'range', previewMin: -0.2, previewMax: 0.2,
          ...note('Data Texture: the surface, height now (r) and a frame ago (g), full float so small waves stay exact. Read by Wave step (which feeds it) it is last frame.') }, { in0: ['step', 'result'] }),
        expr('look', 1200, 150, {
          label: 'Water', outputType: 'vec3',
          inputs: [['g', 'vec2', ['nb', 'gradient']]],
          lines: [
            ['vec3 nrm', 'normalize(vec3(-g * 40.0, 1.0))'],
            ['vec3 sun', 'normalize(vec3(0.4, 0.5, 0.75))'],
            ['float diff', 'clamp(dot(nrm, sun), 0.0, 1.0)'],
            ['float spec', 'pow(clamp(reflect(-sun, nrm).z, 0.0, 1.0), 60.0)'],
          ],
          result: 'mix(vec3(0.02, 0.07, 0.13), vec3(0.18, 0.45, 0.62), diff) + vec3(0.9, 0.95, 1.0) * spec * 0.8',
          note: [
            'Expression Block: lights the surface from its tilt only, so flat water is the same colour wherever it sits.',
            'nrm: the surface\'s normal from the Gradient (40: how steep the waves look).',
            'sun: where the light comes from. diff: how much the surface faces it.',
            'spec: a small sharp highlight where the surface mirrors the light toward you.',
          ],
        }),
      ],
      inputPorts: [],
      outputPorts: colourOut('look', 'result', 'Water'),
    }),
  },
];

/** A compound's subgraph, fresh each time (placing it gives every node new ids). */
export const compoundSubgraph = (c: CompoundEffect): SubgraphData => c.make();
