/**
 * transformAny.ts — Transform: move, turn and scale a point in 2D, 3D or 4D, in one node.
 *
 * The universal transform (docs/transform-node.md). New things that place or turn something make
 * this node (the builders, recipes, the Do bar, smart 3D placement); the single-purpose nodes
 * (Transform 2D, UV Transform 2D, Rotate 2D, Translate/Rotate/Scale 3D, the 4D transforms) are
 * retired (still registered for saved graphs, switched on load where exact: toTransform.ts).
 * Transform covers what each of them does:
 *
 *   Mode Place (default)  the shape is moved, turned and scaled: the point is moved back, turned back
 *                         and divided by the scale (Transform 2D, Translate 3D/4D, Rotate 4D, Scale 4D).
 *   Mode Apply            the point itself is scaled, turned about the Pivot, then moved (UV Transform
 *                         2D, Rotate 2D, Rotate 3D, Scale 3D): what those nodes do to the UV / position.
 *
 *   2D   Move X/Y, one Rotate (degrees), Scale.
 *   3D   Move X/Y/Z, Rotate about X, Y and Z (degrees, applied X then Y then Z), Scale.
 *   4D   Move X/Y/Z/W, a turn in each of the six planes (XY XZ XW YZ YW ZW), Scale.
 *
 * Also: Spin (degrees a second, about one axis / in one plane), Stretch (a scale per axis), a Pivot
 * (Apply mode), and Distance (in) → Distance, the distance put back in true units (Scale 3D/4D's
 * correction; on a second Transform, since one node can't sit on both sides of a shape).
 *
 * Dimension is a setting on the card: the sockets follow it (retypeTransform, run when the setting
 * changes and when a graph loads), and a wire that no longer fits is dropped, as the type pills do.
 * The card shows Position open and Rotate / Scale folded to a one-line summary.
 */
import type { DataType, GraphNode, InputSocket, NodeDefinition, OutputSocket, ParamDef } from '../../types/nodeGraph';
import { p } from './helpers';
import { COLOR_PICKER_GRADIENT_INPUTS } from './color';
import { gradientOn } from '../../lib/colourGradient';

const DEG = '0.017453292519943295';

export type TransformDim = '2' | '3' | '4';

export function transformDim(node: { params: Record<string, unknown> }): TransformDim {
  const d = String(node.params.dim ?? '2');
  return d === '3' || d === '4' ? d : '2';
}

const VEC: Record<TransformDim, DataType> = { 2: 'vec2', 3: 'vec3', 4: 'vec4' };
const AXES = ['x', 'y', 'z', 'w'] as const;

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
  if (dim === '4') inputs.turn = { type: 'float', label: 'Turn (rad)', hint: 'Added to the turn in the Spin plane, in radians.' };
  inputs.dist = { type: 'float', label: 'Distance (in)', hint: 'A shape\'s distance, measured through a Transform with the same Scale: Distance gives it back in true units. Use a second Transform for this (one node can\'t be on both sides of a shape).' };
  return {
    inputs,
    outputs: {
      p:     { type: v, label: 'Local', hint: 'The point as the placed shape sees it. Wire into a shape\'s Position.' },
      scale: { type: 'float', label: 'Scale', hint: 'How much bigger the shape is drawn (Scale × Grow). Multiply the shape\'s distance by it.' },
      dist:  { type: 'float', label: 'Distance', hint: 'Distance (in) × Scale: the distance in true units, so the march and outlines stay right.' },
    },
  };
}

/** A Transform's sockets after its Dimension changed: wires whose type still fits are kept. */
export function retypeTransform(n: GraphNode): GraphNode {
  if (n.type !== 'transform') return n;
  const want = transformSockets(transformDim(n));
  const same = Object.keys(want.inputs).length === Object.keys(n.inputs).length
    && Object.keys(want.outputs).length === Object.keys(n.outputs).length
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

import { dataTextureSockets } from './dataTexture';
import { renderTargetsSockets } from './renderTargets';

/**
 * The sockets a new node of `type` should start with, given its params: a Transform's follow its
 * Dimension, everything else has its definition's. For node factories (builders, recipes, the Do
 * bar), which wire the new node straight away, before any load-time sync would run.
 */
export function startingSockets(type: string, def: Pick<NodeDefinition, 'inputs' | 'outputs'>, params: Record<string, unknown>): { inputs: Record<string, InputSocket>; outputs: Record<string, OutputSocket> } {
  if (type === 'dataTexture') return dataTextureSockets({ params });
  if (type === 'renderTargets') return renderTargetsSockets({ params });
  if (type === 'colorPicker' && gradientOn(params, 'color')) return { inputs: { ...def.inputs, ...COLOR_PICKER_GRADIENT_INPUTS }, outputs: def.outputs };
  return type === 'transform' ? transformSockets(transformDim({ params })) : { inputs: def.inputs, outputs: def.outputs };
}

const HELPERS_GLSL = `// Transform: undo a turn of angle a in one plane (the point as the turned shape sees it), or make one.
vec2 trfUnturn(vec2 v, float a) { float c = cos(a), s = sin(a); return vec2(c * v.x + s * v.y, -s * v.x + c * v.y); }
vec2 trfTurn(vec2 v, float a) { float s = sin(a), c = cos(a); return vec2(v.x * c - v.y * s, v.x * s + v.y * c); }`;

export const PLANES_4D = ['xy', 'xz', 'xw', 'yz', 'yw', 'zw'] as const;
const dims = (v: TransformDim[]) => ({ param: 'dim', value: v as string[] });
const s3 = { showWhen: dims(['3', '4']) };
const s4 = { showWhen: dims(['4']) };
const apply = (d: TransformDim[]) => ({ showWhen: { param: 'mode', value: 'space', and: dims(d) } });
const stretched = (d: TransformDim[]) => ({ showWhen: { param: 'stretch', value: 'true', and: dims(d) } });

const base = transformSockets('2');

const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const short = (v: number) => (Number.isInteger(v) ? v.toFixed(1) : String(Math.round(v * 1000) / 1000));
const degs = (v: number) => `${Math.round(v * 10) / 10}°`;

/** "Rotate 30°", "Rotate X 30°, Z 10°", "Turn XW 45°", "Scale 1.0": what a folded section holds. */
export function transformSectionSummary(section: string, params: Record<string, unknown>): string | undefined {
  const dim = transformDim({ params });
  if (section === 'Rotate') {
    const spin = num(params.spin, 0);
    const spinText = spin ? ` · spin ${degs(spin)}/s` : '';
    if (dim === '2') return `Rotate ${degs(num(params.rotate, 0))}${spinText}`;
    const keys = dim === '3' ? ['rx', 'ry', 'rz'] : PLANES_4D.map(pl => `r${pl}`);
    const set = keys.filter(k => num(params[k], 0) !== 0);
    if (!set.length) return `Rotate 0°${spinText}`;
    const name = (k: string) => (dim === '3' ? k.slice(1).toUpperCase() : k.slice(1).toUpperCase());
    return `${dim === '3' ? 'Rotate' : 'Turn'} ${set.map(k => `${name(k)} ${degs(num(params[k], 0))}`).join(', ')}${spinText}`;
  }
  if (section === 'Scale') {
    const s = `Scale ${short(num(params.scale, 1))}`;
    if (params.stretch !== true && params.stretch !== 'true') return s;
    const each = AXES.slice(0, Number(dim)).map(a => short(num(params[`s${a}`], 1))).join(', ');
    return `${s} · stretch ${each}`;
  }
  return undefined;
}

const PLANE_OPTIONS = PLANES_4D.map(v => ({ value: v, label: v.toUpperCase() }));

const paramDefs: Record<string, ParamDef> = {
  dim: { label: 'Dimension', type: 'select', options: [
    { value: '2', label: '2D (UV)' }, { value: '3', label: '3D (scene position)' }, { value: '4', label: '4D' },
  ], hint: 'What it transforms: a 2D point, a 3D scene position or a 4D point. The sockets change to match; wires that no longer fit come off.' },
  mode: { label: 'Mode', type: 'select', options: [
    { value: 'place', label: 'Place the shape' }, { value: 'space', label: 'Apply to the point' },
  ], hint: 'Place moves, turns and scales the shape. Apply does it to the point itself (scale, turn about the Pivot, then move), which moves the picture the opposite way: what UV Transform 2D, Rotate 2D/3D and Scale 3D do.' },
  x: { section: 'Position', label: 'Move X', type: 'float', min: -2, max: 2, step: 0.01, hint: 'Where the shape\'s centre sits along X.' },
  y: { section: 'Position', label: 'Move Y', type: 'float', min: -2, max: 2, step: 0.01, hint: 'Where the shape\'s centre sits along Y.' },
  z: { section: 'Position', label: 'Move Z', type: 'float', min: -2, max: 2, step: 0.01, hint: 'Where the shape\'s centre sits along Z.', ...s3 },
  w: { section: 'Position', label: 'Move W', type: 'float', min: -2, max: 2, step: 0.01, hint: 'Where the shape\'s centre sits along W, the fourth axis.', ...s4 },
  px: { section: 'Position', label: 'Pivot X', type: 'float', min: -2, max: 2, step: 0.01, hint: 'The point turning and scaling happen around (Apply mode).', ...apply(['2', '3', '4']) },
  py: { section: 'Position', label: 'Pivot Y', type: 'float', min: -2, max: 2, step: 0.01, hint: 'The point turning and scaling happen around (Apply mode).', ...apply(['2', '3', '4']) },
  pz: { section: 'Position', label: 'Pivot Z', type: 'float', min: -2, max: 2, step: 0.01, hint: 'The point turning and scaling happen around (Apply mode).', ...apply(['3', '4']) },
  pw: { section: 'Position', label: 'Pivot W', type: 'float', min: -2, max: 2, step: 0.01, hint: 'The point turning and scaling happen around (Apply mode).', ...apply(['4']) },
  rotate: { section: 'Rotate', label: 'Rotate (deg)', type: 'float', min: -360, max: 360, step: 0.5, hint: 'Turns the shape counter-clockwise about its centre.', showWhen: dims(['2']) },
  rx: { section: 'Rotate', label: 'Rotate X (deg)', type: 'float', min: -360, max: 360, step: 0.5, hint: 'Turns the shape about the X axis (first).', showWhen: dims(['3']) },
  ry: { section: 'Rotate', label: 'Rotate Y (deg)', type: 'float', min: -360, max: 360, step: 0.5, hint: 'Turns the shape about the Y axis (after X).', showWhen: dims(['3']) },
  rz: { section: 'Rotate', label: 'Rotate Z (deg)', type: 'float', min: -360, max: 360, step: 0.5, hint: 'Turns the shape about the Z axis (last).', showWhen: dims(['3']) },
  ...Object.fromEntries(PLANES_4D.map(pl => [`r${pl}`, {
    section: 'Rotate', label: `Turn ${pl.toUpperCase()} (deg)`, type: 'float' as const, min: -360, max: 360, step: 0.5,
    hint: `Turns the shape in the ${pl.toUpperCase()} plane${pl.includes('w') ? ' (through the fourth dimension)' : ''}.`, ...s4,
  }])),
  spin: { section: 'Rotate', label: 'Spin (deg/s)', type: 'float', min: -180, max: 180, step: 0.5, hint: 'Keeps turning over time at this many degrees a second, on top of the turn. 0 holds still.' },
  spinAxis: { section: 'Rotate', label: 'Spin about', type: 'select', options: [{ value: 'x', label: 'X' }, { value: 'y', label: 'Y' }, { value: 'z', label: 'Z' }], hint: 'The axis Spin turns about.', showWhen: dims(['3']) },
  spinPlane: { section: 'Rotate', label: 'Spin plane', type: 'select', options: PLANE_OPTIONS, hint: 'The plane Spin (and the Turn socket) turn in. Any plane with W morphs the slice.', showWhen: dims(['4']) },
  scale: { section: 'Scale', label: 'Scale', type: 'float', min: 0.05, max: 8, step: 0.01, hint: 'Makes the shape bigger (above 1) or smaller. Multiply its distance by the Scale output afterwards.' },
  stretch: { section: 'Scale', label: 'Stretch per axis', type: 'bool', hint: 'A scale for each axis on top of Scale. The Scale output then keeps the distance a safe estimate.' },
  sx: { section: 'Scale', label: 'Scale X', type: 'float', min: 0.05, max: 8, step: 0.01, hint: 'Stretch along X.', ...stretched(['2', '3', '4']) },
  sy: { section: 'Scale', label: 'Scale Y', type: 'float', min: 0.05, max: 8, step: 0.01, hint: 'Stretch along Y.', ...stretched(['2', '3', '4']) },
  sz: { section: 'Scale', label: 'Scale Z', type: 'float', min: 0.05, max: 8, step: 0.01, hint: 'Stretch along Z.', ...stretched(['3', '4']) },
  sw: { section: 'Scale', label: 'Scale W', type: 'float', min: 0.05, max: 8, step: 0.01, hint: 'Stretch along W.', ...stretched(['4']) },
};

export const TransformNode: NodeDefinition = {
  type: 'transform',
  label: 'Transform',
  category: '2D Space', subcategory: 'Basic',
  aliases: [
    'translate', 'move', 'rotate', 'turn', 'scale', 'place', 'position',
    'transform 2d', 'transform 3d', 'transform 4d', 'move rotate scale', 'translate rotate scale', 'position rotation scale',
  ],
  leadsFor: ['transform', 'move', 'translate', 'place', 'position', 'rotate', 'rotation', 'turn', 'scale', 'offset'],
  description:
    'Moves, turns and scales a point in 2D, 3D or 4D (pick the Dimension on the card; the sockets follow it). Place mode gives the shape a new view of space, so wire Local into the shape\'s Position; Apply mode does it to the point itself, like UV Transform 2D or Rotate 3D. ' +
    'When it scales, multiply the shape\'s distance by the Scale output (or wire it through Distance) to get it back to true units.',
  inputs: base.inputs,
  outputs: base.outputs,
  defaultParams: {
    dim: '2', mode: 'place', x: 0.0, y: 0.0, z: 0.0, w: 0.0,
    px: 0.0, py: 0.0, pz: 0.0, pw: 0.0,
    rotate: 0.0, rx: 0.0, ry: 0.0, rz: 0.0,
    rxy: 0.0, rxz: 0.0, rxw: 0.0, ryz: 0.0, ryw: 0.0, rzw: 0.0,
    spin: 0.0, spinAxis: 'y', spinPlane: 'xw',
    scale: 1.0, stretch: false, sx: 1.0, sy: 1.0, sz: 1.0, sw: 1.0,
  },
  paramDefs,
  pinnedSection: 'Position',
  sectionSummary: transformSectionSummary,
  glslFunction: HELPERS_GLSL,
  syncSockets: retypeTransform,
  generateGLSL: (node: GraphNode, inputVars) => {
    const id = node.id;
    const dim = transformDim(node);
    const n = Number(dim);
    const v = VEC[dim];
    const pr = node.params;
    const space = pr.mode === 'space';
    const stretch = pr.stretch === true || pr.stretch === 'true';
    const vecOf = (keys: string[], d: number) => `${v}(${keys.slice(0, n).map(k => p(pr[k], d)).join(', ')})`;
    const move = vecOf(['x', 'y', 'z', 'w'], 0);
    const pos = inputVars.p ?? (dim === '2' ? 'g_uv' : `${v}(0.0)`);
    const grow = inputVars.grow ? ` * max(${inputVars.grow}, 0.0001)` : '';
    const turnIn = inputVars.turn ? ` + ${inputVars.turn}` : '';
    const spin = p(pr.spin, 0);
    const lines: string[] = [];
    // The size: one factor, or one per axis (Stretch). `k` is what the point is divided (Place) or multiplied (Apply) by.
    const sName = space ? `${id}_s` : `${id}_scale`;
    lines.push(`    float ${sName} = max(${p(pr.scale, 1)}, 0.0001)${grow};\n`);
    let k = sName;
    if (stretch) {
      lines.push(`    ${v} ${id}_k = ${sName} * max(${vecOf(['sx', 'sy', 'sz', 'sw'], 1)}, ${v}(0.0001));\n`);
      k = `${id}_k`;
    }
    // The turn angles (radians), with Spin added on its axis / plane.
    const angles: Array<{ pl: string; a: string }> = [];
    if (dim === '2') {
      angles.push({ pl: 'xy', a: `${id}_a` });
      lines.push(`    float ${id}_a = (${p(pr.rotate, 0)} + ${spin} * u_time) * ${DEG}${turnIn};\n`);
    } else if (dim === '3') {
      const ax = String(pr.spinAxis ?? 'y');
      const mask = ['x', 'y', 'z'].map(a => (a === ax ? '1.0' : '0.0')).join(', ');
      lines.push(`    vec3 ${id}_a = (vec3(${p(pr.rx, 0)}, ${p(pr.ry, 0)}, ${p(pr.rz, 0)}) + vec3(${mask}) * ${spin} * u_time) * ${DEG}${turnIn};\n`);
      // The shape turns about X, then Y, then Z.
      angles.push({ pl: 'yz', a: `${id}_a.x` }, { pl: 'zx', a: `${id}_a.y` }, { pl: 'xy', a: `${id}_a.z` });
    } else {
      const sp = (PLANES_4D as readonly string[]).includes(String(pr.spinPlane)) ? String(pr.spinPlane) : 'xw';
      for (const pl of PLANES_4D) {
        const a = pl === sp ? `(${p(pr[`r${pl}`], 0)} + ${spin} * u_time) * ${DEG}${turnIn}` : `${p(pr[`r${pl}`], 0)} * ${DEG}`;
        angles.push({ pl, a });
      }
    }
    if (!space) {
      // Place: the point is moved back, turned back (last turn first) and divided by the size.
      const off = inputVars.offset ? ` + ${inputVars.offset}` : '';
      lines.splice(0, 0, `    ${v} ${id}_q = ${pos} - (${move}${off});\n`);
      for (const { pl, a } of [...angles].reverse()) lines.push(dim === '2' ? `    ${id}_q = trfUnturn(${id}_q, ${a});\n` : `    ${id}_q.${pl} = trfUnturn(${id}_q.${pl}, ${a});\n`);
      lines.push(`    ${v} ${id}_p = ${id}_q / ${k};\n`);
      if (stretch) lines.push(`    float ${id}_scale = ${minOf(`${id}_k`, n)};\n`);
    } else {
      // Apply: the point is scaled and turned about the pivot, then moved.
      const pivot = vecOf(['px', 'py', 'pz', 'pw'], 0);
      const off = inputVars.offset ? ` + ${inputVars.offset}` : '';
      lines.push(`    ${v} ${id}_q = (${pos} - ${pivot}) * ${k};\n`);
      for (const { pl, a } of angles) lines.push(dim === '2' ? `    ${id}_q = trfTurn(${id}_q, ${a});\n` : `    ${id}_q.${pl} = trfTurn(${id}_q.${pl}, ${a});\n`);
      lines.push(`    ${v} ${id}_p = ${id}_q + (${pivot} + ${off ? `(${move}${off})` : move});\n`);
      // The shape is drawn smaller by the size: its distance is divided by it (the largest stretch, to stay safe).
      lines.push(`    float ${id}_scale = 1.0 / ${stretch ? maxOf(`${id}_k`, n) : sName};\n`);
    }
    let dist = '0.0';
    if (inputVars.dist) {
      lines.push(space && !stretch
        ? `    float ${id}_dist = ${inputVars.dist} / ${sName};\n`
        : `    float ${id}_dist = ${inputVars.dist} * ${id}_scale;\n`);
      dist = `${id}_dist`;
    }
    return { code: lines.join(''), outputVars: { p: `${id}_p`, scale: `${id}_scale`, dist } };
  },
};

function minOf(k: string, n: number): string {
  const c = AXES.slice(0, n).map(a => `${k}.${a}`);
  return c.slice(1).reduce((acc, x) => `min(${acc}, ${x})`, c[0]);
}
function maxOf(k: string, n: number): string {
  const c = AXES.slice(0, n).map(a => `${k}.${a}`);
  return c.slice(1).reduce((acc, x) => `max(${acc}, ${x})`, c[0]);
}

/** The Transform for a dimension, as a definition: its sockets and category, for 3D placement (smart3d, sceneRole). */
export function transformDefFor(dim: TransformDim): NodeDefinition {
  if (dim === '2') return TransformNode;
  const s = transformSockets(dim);
  return {
    ...TransformNode,
    category: dim === '3' ? '3D Transforms' : '4D',
    inputs: s.inputs, outputs: s.outputs,
    defaultParams: { ...TransformNode.defaultParams, dim },
  };
}
