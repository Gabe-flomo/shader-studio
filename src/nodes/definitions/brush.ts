/**
 * brush.ts — Brush: a soft round mask under the mouse pointer, for painting into grid simulations (Life, sand,
 * water, heat…). It is the chain the grid examples built by hand (docs/node-retirements.md, "Brush"): Pixel
 * Coordinates and the Mouse's pixels scaled to the Pass, a Circle SDF round the pointer, a Compare (< 0) and a
 * Play-mapped button constant, in one node that reads the mouse button itself.
 *
 *   mask = Value × (1 − smoothstep(−Softness, Softness, |Position − pointer × Scale| − Radius)) × button
 */
import type { NodeDefinition, GraphNode } from '../../types/nodeGraph';
import { p, withParamSockets } from './helpers';
import { BUTTON_DECL, MOUSE_BUTTON_UNIFORM } from './gridRules';

export const BrushNode: NodeDefinition = withParamSockets({
  type: 'brush',
  label: 'Brush',
  category: 'Sources',
  aliases: ['Paint', 'Mouse brush', 'Pointer brush', 'Draw with the mouse', 'Stamp', 'Pen', 'Pour', 'Click to paint'],
  description: 'A soft round mask under the mouse pointer: Value inside Radius, 0 outside, Softness wide at the edge. With Paint: While pressed it only paints while the mouse button (or a finger) is down. Measured in the pixels of the program it runs in: inside a Pass smaller than the picture, set Scale to the Pass\'s, so the brush stays under the pointer. Wire Mask into a grid simulation\'s step to paint cells.',
  inputs: {
    position: { type: 'vec2', label: 'Position', hint: 'Where each pixel is, in pixels. Unwired: this pixel (Pixel Coordinates).' },
  },
  outputs: { mask: { type: 'float', label: 'Mask', hint: 'Value under the brush, 0 elsewhere (and 0 while the button is up, With Paint: While pressed).' } },
  defaultParams: { radius: 6, softness: 0, value: 1, scale: 1, paint: 'pressed' },
  paramDefs: {
    radius:   { label: 'Radius', type: 'float', min: 0.5, max: 60, step: 0.1, hint: 'The brush\'s size, in pixels of the program it runs in (cells, inside a grid Pass).' },
    softness: { label: 'Softness', type: 'float', min: 0, max: 10, step: 0.05, hint: 'How soft the edge is, in the same pixels. 0 is a hard edge.' },
    value:    { label: 'Value', type: 'float', min: 0, max: 2, step: 0.01, hint: 'What the brush paints: 1 for a live cell or full heat.' },
    scale:    { label: 'Scale', type: 'float', min: 0.01, max: 1, step: 0.005, hint: 'The Pass\'s Scale when the brush runs inside a smaller Pass (⅛ for a board at ⅛ size): the pointer is scaled to its pixels. 1 on the picture itself.' },
    paint:    { label: 'Paint', type: 'select', hint: 'While pressed: only while the mouse button (or a finger) is down. Always: wherever the pointer is.', options: [
      { value: 'pressed', label: 'While pressed' }, { value: 'always', label: 'Always' },
    ] },
  },
  assignable: false,
  declarationsFor: () => [BUTTON_DECL],
  generateGLSL: (node: GraphNode, inputVars) => {
    const id = node.id;
    const pos = inputVars.position || 'gl_FragCoord.xy';
    const button = node.params.paint === 'always' ? '' : ` * ${MOUSE_BUTTON_UNIFORM}`;
    // The Compare's hard edge: a width of 0 is clamped a hair above it (a step).
    const h = `max(${p(node.params.softness, 0)}, 1e-5)`;
    return {
      code: [
        `    float ${id}_d = length(${pos} - u_mouse * ${p(node.params.scale, 1)}) - ${p(node.params.radius, 6)};\n`,
        `    float ${id}_mask = (1.0 - smoothstep(-${h}, ${h}, ${id}_d)) * ${p(node.params.value, 1)}${button};\n`,
      ].join(''),
      outputVars: { mask: `${id}_mask` },
    };
  },
}, ['radius', 'value']);
