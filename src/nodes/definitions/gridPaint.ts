import type { NodeDefinition, GraphNode } from '../../types/nodeGraph';
import { p, pv3 } from './helpers';

/**
 * Grid Paint — the other end of Grid Pattern, for shapes of your own.
 *
 * Grid Pattern hands out a Cell UV that already carries the pattern's
 * effects (jitter, and the affect point's grow, shrink, pull, push and
 * spin). Put anything between the two nodes that turns a vec2 into a
 * distance or a colour: Circle SDF, Shape SDF, a Custom Function, a
 * Palette, a texture. This node takes the result back, gates it by the
 * pattern's Placed (so cells the pattern leaves empty stay empty), and
 * paints it over a background.
 *
 *   - Distance wired: the shape's inside is painted with Colour (a flat
 *     colour, or a per-cell picture wired into Colour).
 *   - Only Colour wired: the whole cell shows the colour.
 *   - Distance is measured in Cell UV units, like Grid Pattern's own.
 */
export const GridPaintNode: NodeDefinition = {
  type: 'gridPaint',
  label: 'Grid Paint',
  category: 'Grid',
  description: 'Paints a shape of your own on Grid Pattern’s cells. Wire Grid Pattern’s Cell UV into any SDF (or anything that makes a colour), bring the Distance or Colour here, and wire Placed across so the pattern’s empty cells stay empty. Distance wired: its inside is painted with Colour; Colour alone: the whole cell shows it.',
  inputs: {
    distance:   { type: 'float', label: 'Distance', hint: 'An SDF measured in Cell UV units (Circle SDF, Shape SDF, a Custom Function…). Negative is inside.' },
    color:      { type: 'vec3',  label: 'Colour', hint: 'What the shape is painted with: a flat colour, a Palette, or a picture computed per cell.' },
    placed:     { type: 'float', label: 'Placed', hint: 'Grid Pattern’s Placed output: 1 where the pattern puts a shape, 0 where the cell stays empty.' },
    background: { type: 'vec3',  label: 'Background' },
  },
  outputs: {
    color: { type: 'vec3',  label: 'Color' },
    mask:  { type: 'float', label: 'Mask', hint: '1 inside the painted shape, 0 outside, soft at the edge.' },
  },
  defaultParams: { antialias: 0.02, strokeWidth: 0.0, color: [0.95, 0.85, 0.6], background: [0.06, 0.06, 0.09] },
  paramDefs: {
    antialias:   { label: 'Edge', type: 'float', min: 0.002, max: 0.2, step: 0.002, hint: 'Softness of the shape edge, in cell units.' },
    strokeWidth: { label: 'Outline', type: 'float', min: 0.0, max: 0.3, step: 0.005, hint: 'Above 0, only a band this wide around the edge is painted.' },
    color:       { label: 'Colour',     type: 'vec3color' },
    background:  { label: 'Background', type: 'vec3color' },
  },
  generateGLSL: (node: GraphNode, inputVars) => {
    const id = node.id;
    const aa = p(node.params.antialias, 0.02);
    const sw = p(node.params.strokeWidth, 0.0);
    const on = inputVars.placed ?? '1.0';
    const col = inputVars.color ?? pv3(node.params.color, [0.95, 0.85, 0.6]);
    const bg = inputVars.background ?? pv3(node.params.background, [0.06, 0.06, 0.09]);
    const lines: string[] = [];
    if (inputVars.distance) {
      // An outline paints the band |d| < width/2 instead of the inside.
      lines.push(`    float ${id}_d    = ${sw} > 0.0 ? abs(${inputVars.distance}) - ${sw} * 0.5 : ${inputVars.distance};`);
      lines.push(`    float ${id}_mask = (1.0 - smoothstep(-${aa}, ${aa}, ${id}_d)) * ${on};`);
    } else {
      lines.push(`    float ${id}_mask = ${on} + 0.0 * (${aa} + ${sw});`);
    }
    lines.push(`    vec3  ${id}_col  = mix(${bg}, ${col}, ${id}_mask);`);
    return { code: lines.join('\n') + '\n', outputVars: { color: `${id}_col`, mask: `${id}_mask` } };
  },
};
