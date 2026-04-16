/**
 * sdf3d.ts — Standalone 3D SDF primitive nodes + 3D transform nodes (Phase 2, V2)
 *
 * These nodes output a `vec3` "position" or a `float` "distance" value,
 * intended to be wired into the composable RayRender system (Phase 3).
 * Until Phase 3 lands they can also feed into the existing RaymarchNode
 * via a custom expression / ForLoop approach.
 *
 * Each primitive outputs:
 *   dist  (float) — signed distance from the primitive surface
 *
 * Transform nodes transform an incoming vec3 point and output the new vec3.
 */
import type { NodeDefinition, GraphNode } from '../../types/nodeGraph';
import { p } from './helpers';

// ─── Shared GLSL helpers ───────────────────────────────────────────────────────

const SDF3D_PRIMS_GLSL = `
float sdf3d_sphere(vec3 p, float r) { return length(p) - r; }
float sdf3d_box(vec3 p, vec3 b) {
    vec3 d = abs(p) - b;
    return length(max(d, 0.0)) + min(max(d.x, max(d.y, d.z)), 0.0);
}
float sdf3d_torus(vec3 p, float R, float r) {
    return length(vec2(length(p.xz) - R, p.y)) - r;
}
float sdf3d_capsule(vec3 p, float height, float r) {
    p.y -= clamp(p.y, 0.0, height);
    return length(p) - r;
}
float sdf3d_cylinder(vec3 p, float r, float height) {
    vec2 d = abs(vec2(length(p.xz), p.y)) - vec2(r, height);
    return min(max(d.x, d.y), 0.0) + length(max(d, 0.0));
}
float sdf3d_cone(vec3 p, float angle, float height) {
    vec2 q = vec2(length(p.xz), p.y);
    vec2 w = vec2(height * tan(angle), height);
    vec2 a = q - w * clamp(dot(q, w) / dot(w, w), 0.0, 1.0);
    vec2 b2 = q - w * vec2(clamp(q.x / w.x, 0.0, 1.0), 1.0);
    float k = sign(w.y);
    float d2 = min(dot(a, a), dot(b2, b2));
    float s = max(k * (q.x * w.y - q.y * w.x), k * (q.y - w.y));
    return sqrt(d2) * sign(s);
}
float sdf3d_octahedron(vec3 p, float s) {
    p = abs(p);
    float m = p.x + p.y + p.z - s;
    vec3 q;
    if (3.0 * p.x < m) q = p.xyz;
    else if (3.0 * p.y < m) q = p.yzx;
    else if (3.0 * p.z < m) q = p.zxy;
    else return m * 0.57735027;
    float k = clamp(0.5*(q.z-q.y+s), 0.0, s);
    return length(vec3(q.x, q.y-s+k, q.z-k));
}`;

// ─── 3D SDF Primitive Nodes ────────────────────────────────────────────────────

export const SphereSDF3DNode: NodeDefinition = {
  type: 'sphereSDF3D', label: 'Sphere SDF 3D', category: '3D Primitives',
  description: 'Signed distance to a sphere centered at origin.',
  inputs: {
    pos:    { type: 'vec3',  label: 'Position' },
    radius: { type: 'float', label: 'Radius' },
  },
  outputs: { dist: { type: 'float', label: 'Distance' } },
  defaultParams: { radius: 0.5 },
  paramDefs: { radius: { label: 'Radius', type: 'float', min: 0.01, max: 5.0, step: 0.01 } },
  glslFunction: SDF3D_PRIMS_GLSL,
  generateGLSL: (node: GraphNode, inputVars) => {
    const id = node.id;
    const pos = inputVars.pos    || 'vec3(0.0)';
    const r   = inputVars.radius || p(node.params.radius, 0.5);
    return {
      code: `    float ${id}_dist = sdf3d_sphere(${pos}, ${r});\n`,
      outputVars: { dist: `${id}_dist` },
    };
  },
};

export const BoxSDF3DNode: NodeDefinition = {
  type: 'boxSDF3D', label: 'Box SDF 3D', category: '3D Primitives',
  description: 'Signed distance to an axis-aligned box centered at origin.',
  inputs: {
    pos:    { type: 'vec3',  label: 'Position' },
    sizeX:  { type: 'float', label: 'Size X' },
    sizeY:  { type: 'float', label: 'Size Y' },
    sizeZ:  { type: 'float', label: 'Size Z' },
  },
  outputs: { dist: { type: 'float', label: 'Distance' } },
  defaultParams: { sizeX: 0.5, sizeY: 0.5, sizeZ: 0.5 },
  paramDefs: {
    sizeX: { label: 'Size X', type: 'float', min: 0.01, max: 5.0, step: 0.01 },
    sizeY: { label: 'Size Y', type: 'float', min: 0.01, max: 5.0, step: 0.01 },
    sizeZ: { label: 'Size Z', type: 'float', min: 0.01, max: 5.0, step: 0.01 },
  },
  glslFunction: SDF3D_PRIMS_GLSL,
  generateGLSL: (node: GraphNode, inputVars) => {
    const id = node.id;
    const pos = inputVars.pos   || 'vec3(0.0)';
    const sx  = inputVars.sizeX || p(node.params.sizeX, 0.5);
    const sy  = inputVars.sizeY || p(node.params.sizeY, 0.5);
    const sz  = inputVars.sizeZ || p(node.params.sizeZ, 0.5);
    return {
      code: `    float ${id}_dist = sdf3d_box(${pos}, vec3(${sx}, ${sy}, ${sz}));\n`,
      outputVars: { dist: `${id}_dist` },
    };
  },
};

export const TorusSDF3DNode: NodeDefinition = {
  type: 'torusSDF3D', label: 'Torus SDF 3D', category: '3D Primitives',
  description: 'Signed distance to a torus (major radius R, tube radius r) in XZ plane.',
  inputs: {
    pos:    { type: 'vec3',  label: 'Position' },
    majorR: { type: 'float', label: 'Major R' },
    minorR: { type: 'float', label: 'Tube r' },
  },
  outputs: { dist: { type: 'float', label: 'Distance' } },
  defaultParams: { majorR: 0.5, minorR: 0.2 },
  paramDefs: {
    majorR: { label: 'Major R', type: 'float', min: 0.1, max: 5.0, step: 0.01 },
    minorR: { label: 'Tube r',  type: 'float', min: 0.01, max: 2.0, step: 0.01 },
  },
  glslFunction: SDF3D_PRIMS_GLSL,
  generateGLSL: (node: GraphNode, inputVars) => {
    const id = node.id;
    const pos = inputVars.pos    || 'vec3(0.0)';
    const R   = inputVars.majorR || p(node.params.majorR, 0.5);
    const r   = inputVars.minorR || p(node.params.minorR, 0.2);
    return {
      code: `    float ${id}_dist = sdf3d_torus(${pos}, ${R}, ${r});\n`,
      outputVars: { dist: `${id}_dist` },
    };
  },
};

export const CapsuleSDF3DNode: NodeDefinition = {
  type: 'capsuleSDF3D', label: 'Capsule SDF 3D', category: '3D Primitives',
  description: 'Signed distance to a vertical capsule (hemisphere-capped cylinder) along Y axis.',
  inputs: {
    pos:    { type: 'vec3',  label: 'Position' },
    height: { type: 'float', label: 'Height' },
    radius: { type: 'float', label: 'Radius' },
  },
  outputs: { dist: { type: 'float', label: 'Distance' } },
  defaultParams: { height: 0.6, radius: 0.2 },
  paramDefs: {
    height: { label: 'Height', type: 'float', min: 0.01, max: 5.0, step: 0.01 },
    radius: { label: 'Radius', type: 'float', min: 0.01, max: 2.0, step: 0.01 },
  },
  glslFunction: SDF3D_PRIMS_GLSL,
  generateGLSL: (node: GraphNode, inputVars) => {
    const id = node.id;
    const pos = inputVars.pos    || 'vec3(0.0)';
    const h   = inputVars.height || p(node.params.height, 0.6);
    const r   = inputVars.radius || p(node.params.radius, 0.2);
    return {
      code: `    float ${id}_dist = sdf3d_capsule(${pos}, ${h}, ${r});\n`,
      outputVars: { dist: `${id}_dist` },
    };
  },
};

export const CylinderSDF3DNode: NodeDefinition = {
  type: 'cylinderSDF3D', label: 'Cylinder SDF 3D', category: '3D Primitives',
  description: 'Signed distance to a finite axis-aligned cylinder along Y axis.',
  inputs: {
    pos:    { type: 'vec3',  label: 'Position' },
    radius: { type: 'float', label: 'Radius' },
    height: { type: 'float', label: 'Half Height' },
  },
  outputs: { dist: { type: 'float', label: 'Distance' } },
  defaultParams: { radius: 0.3, height: 0.5 },
  paramDefs: {
    radius: { label: 'Radius',      type: 'float', min: 0.01, max: 5.0, step: 0.01 },
    height: { label: 'Half Height', type: 'float', min: 0.01, max: 5.0, step: 0.01 },
  },
  glslFunction: SDF3D_PRIMS_GLSL,
  generateGLSL: (node: GraphNode, inputVars) => {
    const id = node.id;
    const pos = inputVars.pos    || 'vec3(0.0)';
    const r   = inputVars.radius || p(node.params.radius, 0.3);
    const h   = inputVars.height || p(node.params.height, 0.5);
    return {
      code: `    float ${id}_dist = sdf3d_cylinder(${pos}, ${r}, ${h});\n`,
      outputVars: { dist: `${id}_dist` },
    };
  },
};

export const ConeSDF3DNode: NodeDefinition = {
  type: 'coneSDF3D', label: 'Cone SDF 3D', category: '3D Primitives',
  description: 'Signed distance to a cone pointing up (angle in radians, height).',
  inputs: {
    pos:    { type: 'vec3',  label: 'Position' },
    angle:  { type: 'float', label: 'Angle (rad)' },
    height: { type: 'float', label: 'Height' },
  },
  outputs: { dist: { type: 'float', label: 'Distance' } },
  defaultParams: { angle: 0.4, height: 1.0 },
  paramDefs: {
    angle:  { label: 'Angle (rad)', type: 'float', min: 0.01, max: 1.57, step: 0.01 },
    height: { label: 'Height',      type: 'float', min: 0.1,  max: 5.0,  step: 0.05 },
  },
  glslFunction: SDF3D_PRIMS_GLSL,
  generateGLSL: (node: GraphNode, inputVars) => {
    const id = node.id;
    const pos = inputVars.pos    || 'vec3(0.0)';
    const a   = inputVars.angle  || p(node.params.angle,  0.4);
    const h   = inputVars.height || p(node.params.height, 1.0);
    return {
      code: `    float ${id}_dist = sdf3d_cone(${pos}, ${a}, ${h});\n`,
      outputVars: { dist: `${id}_dist` },
    };
  },
};

export const OctahedronSDF3DNode: NodeDefinition = {
  type: 'octahedronSDF3D', label: 'Octahedron SDF 3D', category: '3D Primitives',
  description: 'Signed distance to a regular octahedron with given size.',
  inputs: {
    pos:  { type: 'vec3',  label: 'Position' },
    size: { type: 'float', label: 'Size' },
  },
  outputs: { dist: { type: 'float', label: 'Distance' } },
  defaultParams: { size: 0.5 },
  paramDefs: { size: { label: 'Size', type: 'float', min: 0.01, max: 5.0, step: 0.01 } },
  glslFunction: SDF3D_PRIMS_GLSL,
  generateGLSL: (node: GraphNode, inputVars) => {
    const id = node.id;
    const pos  = inputVars.pos  || 'vec3(0.0)';
    const size = inputVars.size || p(node.params.size, 0.5);
    return {
      code: `    float ${id}_dist = sdf3d_octahedron(${pos}, ${size});\n`,
      outputVars: { dist: `${id}_dist` },
    };
  },
};

// ─── 3D Transform Nodes ────────────────────────────────────────────────────────

export const Translate3DNode: NodeDefinition = {
  type: 'translate3D', label: 'Translate 3D', category: '3D Transforms',
  description: 'Translate a 3D point (subtract offset to move SDF origin).',
  inputs: {
    pos: { type: 'vec3',  label: 'Position' },
    tx:  { type: 'float', label: 'X' },
    ty:  { type: 'float', label: 'Y' },
    tz:  { type: 'float', label: 'Z' },
  },
  outputs: { pos: { type: 'vec3', label: 'Translated Pos' } },
  defaultParams: { tx: 0.0, ty: 0.0, tz: 0.0 },
  paramDefs: {
    tx: { label: 'X', type: 'float', min: -10.0, max: 10.0, step: 0.01 },
    ty: { label: 'Y', type: 'float', min: -10.0, max: 10.0, step: 0.01 },
    tz: { label: 'Z', type: 'float', min: -10.0, max: 10.0, step: 0.01 },
  },
  generateGLSL: (node: GraphNode, inputVars) => {
    const id  = node.id;
    const pos = inputVars.pos || 'vec3(0.0)';
    const tx  = inputVars.tx  || p(node.params.tx, 0.0);
    const ty  = inputVars.ty  || p(node.params.ty, 0.0);
    const tz  = inputVars.tz  || p(node.params.tz, 0.0);
    return {
      code: `    vec3 ${id}_pos = ${pos} - vec3(${tx}, ${ty}, ${tz});\n`,
      outputVars: { pos: `${id}_pos` },
    };
  },
};

export const Rotate3DNode: NodeDefinition = {
  type: 'rotate3D', label: 'Rotate 3D', category: '3D Transforms',
  description: 'Rotate a 3D point around X, Y, or Z axis.',
  inputs: {
    pos:   { type: 'vec3',  label: 'Position' },
    angle: { type: 'float', label: 'Angle (rad)' },
  },
  outputs: { pos: { type: 'vec3', label: 'Rotated Pos' } },
  defaultParams: { axis: 'y', angle: 0.0 },
  paramDefs: {
    axis:  { label: 'Axis', type: 'select', options: [
      { value: 'x', label: 'X' },
      { value: 'y', label: 'Y' },
      { value: 'z', label: 'Z' },
    ]},
    angle: { label: 'Angle (rad)', type: 'float', min: -6.2832, max: 6.2832, step: 0.01 },
  },
  generateGLSL: (node: GraphNode, inputVars) => {
    const id    = node.id;
    const pos   = inputVars.pos   || 'vec3(0.0)';
    const angle = inputVars.angle || p(node.params.angle, 0.0);
    const axis  = String(node.params.axis || 'y');
    const axisExprs: Record<string, string> = {
      x: [
        `    float ${id}_c   = cos(${angle}); float ${id}_s = sin(${angle});\n`,
        `    vec3  ${id}_pos = vec3(${pos}.x, ${id}_c * (${pos}).y - ${id}_s * (${pos}).z, ${id}_s * (${pos}).y + ${id}_c * (${pos}).z);\n`,
      ].join(''),
      y: [
        `    float ${id}_c   = cos(${angle}); float ${id}_s = sin(${angle});\n`,
        `    vec3  ${id}_pos = vec3(${id}_c * (${pos}).x + ${id}_s * (${pos}).z, (${pos}).y, -${id}_s * (${pos}).x + ${id}_c * (${pos}).z);\n`,
      ].join(''),
      z: [
        `    float ${id}_c   = cos(${angle}); float ${id}_s = sin(${angle});\n`,
        `    vec3  ${id}_pos = vec3(${id}_c * (${pos}).x - ${id}_s * (${pos}).y, ${id}_s * (${pos}).x + ${id}_c * (${pos}).y, (${pos}).z);\n`,
      ].join(''),
    };
    return {
      code: axisExprs[axis] || axisExprs['y'],
      outputVars: { pos: `${id}_pos` },
    };
  },
};

export const Repeat3DNode: NodeDefinition = {
  type: 'repeat3D', label: 'Repeat 3D', category: '3D Transforms',
  description: 'Infinitely repeat 3D space with given cell size (domain repetition for SDFs).',
  inputs: {
    pos:   { type: 'vec3',  label: 'Position' },
    cellX: { type: 'float', label: 'Cell X' },
    cellY: { type: 'float', label: 'Cell Y' },
    cellZ: { type: 'float', label: 'Cell Z' },
  },
  outputs: { pos: { type: 'vec3', label: 'Repeated Pos' } },
  defaultParams: { cellX: 2.0, cellY: 2.0, cellZ: 2.0 },
  paramDefs: {
    cellX: { label: 'Cell X', type: 'float', min: 0.1, max: 10.0, step: 0.1 },
    cellY: { label: 'Cell Y', type: 'float', min: 0.1, max: 10.0, step: 0.1 },
    cellZ: { label: 'Cell Z', type: 'float', min: 0.1, max: 10.0, step: 0.1 },
  },
  generateGLSL: (node: GraphNode, inputVars) => {
    const id  = node.id;
    const pos = inputVars.pos   || 'vec3(0.0)';
    const cx  = inputVars.cellX || p(node.params.cellX, 2.0);
    const cy  = inputVars.cellY || p(node.params.cellY, 2.0);
    const cz  = inputVars.cellZ || p(node.params.cellZ, 2.0);
    return {
      code: `    vec3 ${id}_pos = mod(${pos} + 0.5 * vec3(${cx}, ${cy}, ${cz}), vec3(${cx}, ${cy}, ${cz})) - 0.5 * vec3(${cx}, ${cy}, ${cz});\n`,
      outputVars: { pos: `${id}_pos` },
    };
  },
};

export const Twist3DNode: NodeDefinition = {
  type: 'twist3D', label: 'Twist 3D', category: '3D Transforms',
  description: 'Twist 3D space around the Y axis by a given amount. Wire MarchDist → angle for depth-dependent twist.',
  inputs: {
    pos:   { type: 'vec3',  label: 'Position' },
    k:     { type: 'float', label: 'Twist Amount' },
    angle: { type: 'float', label: 'Angle (override)' },
  },
  outputs: { pos: { type: 'vec3', label: 'Twisted Pos' } },
  defaultParams: { k: 2.0 },
  paramDefs: { k: { label: 'Twist Amount', type: 'float', min: -10.0, max: 10.0, step: 0.1 } },
  generateGLSL: (node: GraphNode, inputVars) => {
    const id  = node.id;
    const pos = inputVars.pos || 'vec3(0.0)';
    const k   = inputVars.k   || p(node.params.k, 2.0);
    // angle input overrides the default k * pos.y computation when wired
    const twAngle = inputVars.angle ?? `${k} * (${pos}).y`;
    return {
      code: [
        `    float ${id}_twA = ${twAngle};\n`,
        `    float ${id}_twC = cos(${id}_twA); float ${id}_twS = sin(${id}_twA);\n`,
        `    vec3  ${id}_pos = vec3(${id}_twC * (${pos}).x - ${id}_twS * (${pos}).z, (${pos}).y, ${id}_twS * (${pos}).x + ${id}_twC * (${pos}).z);\n`,
      ].join(''),
      outputVars: { pos: `${id}_pos` },
    };
  },
};

export const Fold3DNode: NodeDefinition = {
  type: 'fold3D', label: 'Fold 3D', category: '3D Transforms',
  description: 'Fold 3D space across X, Y, and/or Z planes (abs fold for fractal geometry).',
  inputs: {
    pos: { type: 'vec3', label: 'Position' },
  },
  outputs: { pos: { type: 'vec3', label: 'Folded Pos' } },
  defaultParams: { foldX: true, foldY: false, foldZ: true },
  paramDefs: {
    foldX: { label: 'Fold X', type: 'bool' },
    foldY: { label: 'Fold Y', type: 'bool' },
    foldZ: { label: 'Fold Z', type: 'bool' },
  },
  generateGLSL: (node: GraphNode, inputVars) => {
    const id     = node.id;
    const pos    = inputVars.pos || 'vec3(0.0)';
    const doX    = node.params.foldX !== false;
    const doY    = node.params.foldY === true;
    const doZ    = node.params.foldZ !== false;
    const xExpr  = doX ? `abs(${id}_pf.x)` : `${id}_pf.x`;
    const yExpr  = doY ? `abs(${id}_pf.y)` : `${id}_pf.y`;
    const zExpr  = doZ ? `abs(${id}_pf.z)` : `${id}_pf.z`;
    return {
      code: [
        `    vec3 ${id}_pf  = ${pos};\n`,
        `    vec3 ${id}_pos = vec3(${xExpr}, ${yExpr}, ${zExpr});\n`,
      ].join(''),
      outputVars: { pos: `${id}_pos` },
    };
  },
};

// ─── New 3D Nodes ─────────────────────────────────────────────────────────────

export const PlaneSDF3DNode: NodeDefinition = {
  type: 'planeSDF3D',
  label: 'Plane 3D',
  category: '3D Primitives',
  description: 'Infinite horizontal plane. Distance = p.y - height. Use as ground or ceiling.',
  inputs: {
    p:      { type: 'vec3',  label: 'Position' },
    height: { type: 'float', label: 'Height'   },
  },
  outputs: { dist: { type: 'float', label: 'Distance' } },
  defaultParams: { height: -0.75 },
  paramDefs: {
    height: { label: 'Height (Y)', type: 'float', min: -5, max: 5, step: 0.01 },
  },
  generateGLSL: (node: GraphNode, inputVars) => {
    const pVar = inputVars.p      ?? 'vec3(0.0)';
    const h    = inputVars.height ?? String(node.params.height ?? -0.75);
    const id   = node.id;
    return {
      code: `    float ${id}_dist = ${pVar}.y - (${h});\n`,
      outputVars: { dist: `${id}_dist` },
    };
  },
};

export const Scale3DNode: NodeDefinition = {
  type: 'scale3d',
  label: 'Scale 3D',
  category: '3D Transforms',
  description: 'Scale a 3D position for SDF evaluation with automatic metric correction. Wire scaled position into SDF nodes, then wire their distance output back into the dist input.',
  inputs: {
    p:     { type: 'vec3',  label: 'Position (in)' },
    dist:  { type: 'float', label: 'SDF Dist (in)' },
    scale: { type: 'float', label: 'Scale'         },
  },
  outputs: {
    p:    { type: 'vec3',  label: 'Scaled Position' },
    dist: { type: 'float', label: 'Corrected Dist'  },
  },
  defaultParams: { scale: 2.0 },
  paramDefs: {
    scale: { label: 'Scale', type: 'float', min: 0.01, max: 10.0, step: 0.01 },
  },
  generateGLSL: (node: GraphNode, inputVars) => {
    const pVar  = inputVars.p     ?? 'vec3(0.0)';
    const dVar  = inputVars.dist  ?? '0.0';
    const s     = inputVars.scale ?? String(node.params.scale ?? 2.0);
    const id    = node.id;
    return {
      code: [
        `    vec3  ${id}_p    = ${pVar} * ${s};\n`,
        `    float ${id}_dist = ${dVar} / ${s};\n`,
      ].join(''),
      outputVars: { p: `${id}_p`, dist: `${id}_dist` },
    };
  },
};

const ROTATE_AXIS_3D_GLSL = `
vec3 rotateAxis3d_fn(vec3 p, vec3 axis, float angle) {
    float c = cos(angle); float s = sin(angle);
    return p * c + cross(axis, p) * s + axis * dot(axis, p) * (1.0 - c);
}`;

export const RotateAxis3DNode: NodeDefinition = {
  type: 'rotateAxis3D',
  label: 'Rotate Axis 3D',
  category: '3D Transforms',
  description: 'Rotate a 3D position around an arbitrary normalized axis (Rodrigues formula).',
  inputs: {
    p:     { type: 'vec3',  label: 'Position' },
    axis:  { type: 'vec3',  label: 'Axis (normalized)' },
    angle: { type: 'float', label: 'Angle (radians)'   },
  },
  outputs: { p: { type: 'vec3', label: 'Rotated' } },
  defaultParams: { ax: 0.0, ay: 1.0, az: 0.0, angle: 0.0 },
  paramDefs: {
    ax:    { label: 'Axis X', type: 'float', min: -1, max: 1, step: 0.01 },
    ay:    { label: 'Axis Y', type: 'float', min: -1, max: 1, step: 0.01 },
    az:    { label: 'Axis Z', type: 'float', min: -1, max: 1, step: 0.01 },
    angle: { label: 'Angle',  type: 'float', min: -6.283, max: 6.283, step: 0.01 },
  },
  glslFunction: ROTATE_AXIS_3D_GLSL,
  generateGLSL: (node: GraphNode, inputVars) => {
    const pVar  = inputVars.p     ?? 'vec3(0.0)';
    const ax    = node.params.ax  ?? 0.0;
    const ay    = node.params.ay  ?? 1.0;
    const az    = node.params.az  ?? 0.0;
    const axisV = inputVars.axis  ?? `normalize(vec3(${ax},${ay},${az}))`;
    const ang   = inputVars.angle ?? String(node.params.angle ?? 0.0);
    const id    = node.id;
    return {
      code: `    vec3 ${id}_p = rotateAxis3d_fn(${pVar}, ${axisV}, ${ang});\n`,
      outputVars: { p: `${id}_p` },
    };
  },
};

export const SinWarp3DNode: NodeDefinition = {
  type: 'sinWarp3D',
  label: 'Sin Warp 3D',
  category: '3D Transforms',
  description: 'Sinusoidal domain warp. Distorts one axis by sin(another axis * frequency + time) * amplitude. Keep amplitude < 0.15 to avoid SDF metric artifacts.',
  inputs: {
    p:         { type: 'vec3',  label: 'Position'   },
    time:      { type: 'float', label: 'Time'        },
    frequency: { type: 'float', label: 'Frequency'   },
    amplitude: { type: 'float', label: 'Amplitude'   },
  },
  outputs: { p: { type: 'vec3', label: 'Warped Position' } },
  defaultParams: {
    distort_axis: 'y',
    source_axis:  'x',
    frequency: 2.0,
    amplitude: 0.1,
  },
  paramDefs: {
    distort_axis: { label: 'Distort Axis', type: 'select', options: [
      { value: 'x', label: 'X' }, { value: 'y', label: 'Y' }, { value: 'z', label: 'Z' },
    ]},
    source_axis: { label: 'Source Axis', type: 'select', options: [
      { value: 'x', label: 'X' }, { value: 'y', label: 'Y' }, { value: 'z', label: 'Z' },
    ]},
    frequency: { label: 'Frequency', type: 'float', min: 0.01, max: 20.0, step: 0.1 },
    amplitude: { label: 'Amplitude', type: 'float', min: 0.0,  max: 2.0,  step: 0.01 },
  },
  generateGLSL: (node: GraphNode, inputVars) => {
    const pVar = inputVars.p         ?? 'vec3(0.0)';
    const t    = inputVars.time      ?? 'u_time';
    const freq = inputVars.frequency ?? p(node.params.frequency, 2.0);
    const amp  = inputVars.amplitude ?? p(node.params.amplitude, 0.1);
    const da   = (node.params.distort_axis as string) ?? 'y';
    const sa   = (node.params.source_axis  as string) ?? 'x';
    const id   = node.id;
    return {
      code: [
        `    vec3 ${id}_p = ${pVar};\n`,
        `    ${id}_p.${da} += sin(${id}_p.${sa} * ${freq} + ${t}) * ${amp};\n`,
      ].join(''),
      outputVars: { p: `${id}_p` },
    };
  },
};

export const SpiralWarp3DNode: NodeDefinition = {
  type: 'spiralWarp3D',
  label: 'Spiral Warp 3D',
  category: '3D Transforms',
  description: 'Rotate a 3D position around an axis by an angle proportional to distance from origin. Creates spiral/vortex distortion. Keep frequency < 1.5 to avoid artifacts. Wire MarchDist → angle for depth-driven spiral.',
  inputs: {
    p:         { type: 'vec3',  label: 'Position'          },
    time:      { type: 'float', label: 'Time'               },
    frequency: { type: 'float', label: 'Spiral Freq'        },
    angle:     { type: 'float', label: 'Angle (override)'   },
  },
  outputs: { p: { type: 'vec3', label: 'Spiraled Position' } },
  defaultParams: {
    rotation_plane: 'xy',
    frequency: 0.5,
  },
  paramDefs: {
    rotation_plane: { label: 'Rotation Plane', type: 'select', options: [
      { value: 'xy', label: 'XY (around Z)' },
      { value: 'xz', label: 'XZ (around Y)' },
      { value: 'yz', label: 'YZ (around X)' },
    ]},
    frequency: { label: 'Frequency', type: 'float', min: -5.0, max: 5.0, step: 0.01 },
  },
  generateGLSL: (node: GraphNode, inputVars) => {
    const pVar  = inputVars.p         ?? 'vec3(0.0)';
    const t     = inputVars.time      ?? 'u_time';
    const freq  = inputVars.frequency ?? String(node.params.frequency ?? 0.5);
    const plane = (node.params.rotation_plane as string) ?? 'xy';
    const id    = node.id;
    // Use the 2D length in the rotation plane (axis-correct, keeps Lipschitz constant ≈ 1)
    const radLen = plane === 'xy' ? `length(${pVar}.xy)` : plane === 'xz' ? `length(${pVar}.xz)` : `length(${pVar}.yz)`;
    // angle input overrides the default radial * freq + time computation when wired
    const angleExpr = inputVars.angle ?? `(${radLen} * ${freq} + ${t})`;
    const c = `cos(${angleExpr})`, s = `sin(${angleExpr})`;
    let rotLine: string;
    if (plane === 'xy')
      rotLine = `    ${id}_p.xy = vec2(${c}*${id}_p.x - ${s}*${id}_p.y, ${s}*${id}_p.x + ${c}*${id}_p.y);\n`;
    else if (plane === 'xz')
      rotLine = `    ${id}_p.xz = vec2(${c}*${id}_p.x - ${s}*${id}_p.z, ${s}*${id}_p.x + ${c}*${id}_p.z);\n`;
    else
      rotLine = `    ${id}_p.yz = vec2(${c}*${id}_p.y - ${s}*${id}_p.z, ${s}*${id}_p.y + ${c}*${id}_p.z);\n`;
    return {
      code: [`    vec3 ${id}_p = ${pVar};\n`, rotLine].join(''),
      outputVars: { p: `${id}_p` },
    };
  },
};

