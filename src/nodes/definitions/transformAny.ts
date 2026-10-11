/**
 * transformAny.ts — Transform: move, turn and scale a point in 2D, 3D or 4D, in one node.
 *
 * The same idea as Transform 2D (the 2D Scene Builder's placer) for every dimension: it does not move
 * the shape, it gives the shape a new view of space (the point as the shape sees it), so wire its
 * Local output into a shape's Position. Scaling shrinks the shape's units, so the Scale output is what
 * the shape's distance is multiplied by to get back to true units (as Scale 3D's Corrected Dist does).
 *
 *   2D   Move X/Y, one Rotate (degrees), Scale. The same maths as Transform 2D.
 *   3D   Move X/Y/Z, Rotate about X, Y and Z (degrees, applied X then Y then Z), Scale.
 *   4D   Move X/Y/Z/W, a turn in each of the six planes (XY XZ XW YZ YW ZW), Scale.
 *
 * Dimension is a setting on the card: the sockets follow it (retypeTransform, run when the setting
 * changes and when a graph loads), and a wire that no longer fits is dropped, as the type pills do.
 * The older single-purpose nodes (Transform 2D, Translate/Rotate/Scale 3D, the 4D transforms) stay.
 */
import type { DataType, GraphNode, InputSocket, NodeDefinition, OutputSocket } from '../../types/nodeGraph';
import { p } from './helpers';

const DEG = '0.017453292519943295';

export type TransformDim = '2' | '3' | '4';

export function transformDim(node: GraphNode): TransformDim {
  const d = String(node.params.dim ?? '2');
  return d === '3' || d === '4' ? d : '2';
}

const VEC: Record<TransformDim, DataType> = { 2: 'vec2', 3: 'vec3', 4: 'vec4' };

/** The sockets a Transform of dimension `dim` has. */
export function transformSockets(dim: TransformDim): { inputs: Record<string, InputSocket>; outputs: Record<string, OutputSocket> } {
  const v = VEC[dim];
  const inputs: Record<string, InputSocket> = {
    p:      { type: v, label: 'Position', hint: 'The space to place the shape in: UV (2D), a scene position (3D) or a 4D point. Unwired in 2D it is the picture\'s UV.' },
    offset: { type: v, label: 'Offset', hint: 'Added to Move: wire a motion here for a shape that drifts or orbits.' },
    grow:   { type: 'float', label: 'Grow', hint: 'Multiplies Scale: wire a motion here for a shape that pulses. Leave empty for 1.' },
  };
  if (dim === '2') inputs.turn = { type: 'float', label: 'Turn (rad)', hint: 'Added to Rotate, in radians: wire a motion here for a shape that spins.' };
  if (dim === '3') inputs.turn = { type: 'vec3', label: 'Turn (rad)', hint: 'Added to Rotate X, Y and Z, in radians.' };
  return {
    inputs,
    outputs: {
      p:     { type: v, label: 'Local', hint: 'The point as the placed shape sees it. Wire into a shape\'s Position.' },
      scale: { type: 'float', label: 'Scale', hint: 'How much bigger the shape is drawn (Scale × Grow). Multiply the shape\'s distance by it.' },
    },
  };
}

/** A Transform's sockets after its Dimension changed: wires whose type still fits are kept. */
export function retypeTransform(n: GraphNode): GraphNode {
  if (n.type !== 'transform') return n;
  const want = transformSockets(transformDim(n));
  const same = Object.keys(want.inputs).length === Object.keys(n.inputs).length
    && Object.entries(want.inputs).every(([k, s]) => n.inputs[k]?.type === s.type)
    && Object.entries(want.outputs).every(([k, s]) => n.outputs[k]?.type === s.type);
  if (same) return n;
  const inputs: Record<string, InputSocket> = {};
  for (const [k, s] of Object.entries(want.inputs)) {
    const old = n.inputs[k];
    inputs[k] = { ...s, ...(old?.connection && old.type === s.type ? { connection: old.connection } : {}) };
  }
  return { ...n, inputs, outputs: want.outputs };
}

const ROT_GLSL = `// Transform: undo a turn of angle a in one plane (the point as the turned shape sees it).
vec2 trfUnturn(vec2 v, float a) { float c = cos(a), s = sin(a); return vec2(c * v.x + s * v.y, -s * v.x + c * v.y); }`;

const PLANES_4D = ['xy', 'xz', 'xw', 'yz', 'yw', 'zw'] as const;
const s3 = { showWhen: { param: 'dim', value: ['3', '4'] } };
const s4 = { showWhen: { param: 'dim', value: '4' } };

const base = transformSockets('2');

export const TransformNode: NodeDefinition = {
  type: 'transform',
  label: 'Transform',
  category: '2D Space', subcategory: 'Basic',
  aliases: ['transform 3d', 'transform 4d', 'move rotate scale', 'translate rotate scale', 'place', 'position rotation scale'],
  description:
    'Moves, turns and scales a point in 2D, 3D or 4D (pick the Dimension on the card; the sockets follow it). Like Transform 2D, it gives the shape a new view of space, so wire Local into the shape\'s Position. ' +
    'When it scales, multiply the shape\'s distance by the Scale output to get it back to true units.',
  inputs: base.inputs,
  outputs: base.outputs,
  defaultParams: {
    dim: '2', x: 0.0, y: 0.0, z: 0.0, w: 0.0,
    rotate: 0.0, rx: 0.0, ry: 0.0, rz: 0.0,
    rxy: 0.0, rxz: 0.0, rxw: 0.0, ryz: 0.0, ryw: 0.0, rzw: 0.0,
    scale: 1.0,
  },
  paramDefs: {
    dim: { label: 'Dimension', type: 'select', options: [
      { value: '2', label: '2D (UV)' }, { value: '3', label: '3D (scene position)' }, { value: '4', label: '4D' },
    ], hint: 'What it transforms: a 2D point, a 3D scene position or a 4D point. The sockets change to match; wires that no longer fit come off.' },
    x: { label: 'Move X', type: 'float', min: -2, max: 2, step: 0.01, hint: 'Where the shape\'s centre sits along X.' },
    y: { label: 'Move Y', type: 'float', min: -2, max: 2, step: 0.01, hint: 'Where the shape\'s centre sits along Y.' },
    z: { label: 'Move Z', type: 'float', min: -2, max: 2, step: 0.01, hint: 'Where the shape\'s centre sits along Z.', ...s3 },
    w: { label: 'Move W', type: 'float', min: -2, max: 2, step: 0.01, hint: 'Where the shape\'s centre sits along W, the fourth axis.', ...s4 },
    rotate: { label: 'Rotate (deg)', type: 'float', min: -360, max: 360, step: 0.5, hint: 'Turns the shape counter-clockwise about its centre.', showWhen: { param: 'dim', value: '2' } },
    rx: { label: 'Rotate X (deg)', type: 'float', min: -360, max: 360, step: 0.5, hint: 'Turns the shape about the X axis (first).', showWhen: { param: 'dim', value: '3' } },
    ry: { label: 'Rotate Y (deg)', type: 'float', min: -360, max: 360, step: 0.5, hint: 'Turns the shape about the Y axis (after X).', showWhen: { param: 'dim', value: '3' } },
    rz: { label: 'Rotate Z (deg)', type: 'float', min: -360, max: 360, step: 0.5, hint: 'Turns the shape about the Z axis (last).', showWhen: { param: 'dim', value: '3' } },
    ...Object.fromEntries(PLANES_4D.map(pl => [`r${pl}`, {
      label: `Turn ${pl.toUpperCase()} (deg)`, type: 'float' as const, min: -360, max: 360, step: 0.5,
      hint: `Turns the shape in the ${pl.toUpperCase()} plane${pl.includes('w') ? ' (through the fourth dimension)' : ''}.`, ...s4,
    }])),
    scale: { label: 'Scale', type: 'float', min: 0.05, max: 8, step: 0.01, hint: 'Makes the shape bigger (above 1) or smaller. Multiply its distance by the Scale output afterwards.' },
  },
  glslFunction: ROT_GLSL,
  syncSockets: retypeTransform,
  generateGLSL: (node: GraphNode, inputVars) => {
    const id = node.id;
    const dim = transformDim(node);
    const v = VEC[dim];
    const pr = node.params;
    const moves = [p(pr.x, 0), p(pr.y, 0), p(pr.z, 0), p(pr.w, 0)].slice(0, Number(dim));
    const pos = inputVars.p ?? (dim === '2' ? 'g_uv' : `${v}(0.0)`);
    const off = inputVars.offset ? ` + ${inputVars.offset}` : '';
    const grow = inputVars.grow ? ` * max(${inputVars.grow}, 0.0001)` : '';
    const lines = [
      `    ${v} ${id}_q = ${pos} - (${v}(${moves.join(', ')})${off});\n`,
      `    float ${id}_scale = max(${p(pr.scale, 1)}, 0.0001)${grow};\n`,
    ];
    if (dim === '2') {
      const turn = inputVars.turn ? ` + ${inputVars.turn}` : '';
      lines.push(`    ${id}_q = trfUnturn(${id}_q, ${p(pr.rotate, 0)} * ${DEG}${turn});\n`);
    } else if (dim === '3') {
      const turn = inputVars.turn ? ` + ${inputVars.turn}` : '';
      // The shape turns about X, then Y, then Z; the point is turned back in the opposite order.
      lines.push(`    vec3 ${id}_a = vec3(${p(pr.rx, 0)}, ${p(pr.ry, 0)}, ${p(pr.rz, 0)}) * ${DEG}${turn};\n`);
      lines.push(`    ${id}_q.xy = trfUnturn(${id}_q.xy, ${id}_a.z);\n`);
      lines.push(`    ${id}_q.zx = trfUnturn(${id}_q.zx, ${id}_a.y);\n`);
      lines.push(`    ${id}_q.yz = trfUnturn(${id}_q.yz, ${id}_a.x);\n`);
    } else {
      // Six plane turns, XY first; undone last to first.
      for (const pl of [...PLANES_4D].reverse()) {
        lines.push(`    ${id}_q.${pl} = trfUnturn(${id}_q.${pl}, ${p(pr[`r${pl}`], 0)} * ${DEG});\n`);
      }
    }
    lines.push(`    ${v} ${id}_p = ${id}_q / ${id}_scale;\n`);
    return { code: lines.join(''), outputVars: { p: `${id}_p`, scale: `${id}_scale` } };
  },
};
