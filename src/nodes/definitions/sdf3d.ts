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
}
float sdf3d_roundedBox(vec3 p, vec3 b, float r) {
    vec3 q = abs(p) - b + r;
    return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0) - r;
}
float sdf3d_boxFrame(vec3 p, vec3 b, float e) {
    p = abs(p) - b;
    vec3 q = abs(p + e) - e;
    return min(min(
        length(max(vec3(p.x, q.y, q.z), 0.0)) + min(max(p.x, max(q.y, q.z)), 0.0),
        length(max(vec3(q.x, p.y, q.z), 0.0)) + min(max(q.x, max(p.y, q.z)), 0.0)),
        length(max(vec3(q.x, q.y, p.z), 0.0)) + min(max(q.x, max(q.y, p.z)), 0.0));
}
float sdf3d_ellipsoid(vec3 p, vec3 r) {
    float k0 = length(p / r);
    float k1 = length(p / (r * r));
    return k0 * (k0 - 1.0) / k1;
}
float sdf3d_cappedTorus(vec3 p, vec2 sc, float ra, float rb) {
    p.x = abs(p.x);
    float k = (sc.y * p.x > sc.x * p.y) ? dot(p.xy, sc) : length(p.xy);
    return sqrt(dot(p, p) + ra * ra - 2.0 * ra * k) - rb;
}
float sdf3d_link(vec3 p, float le, float r1, float r2) {
    vec3 q = vec3(p.x, max(abs(p.y) - le, 0.0), p.z);
    return length(vec2(length(q.xy) - r1, q.z)) - r2;
}
float sdf3d_pyramid(vec3 p, float h) {
    float m2 = h * h + 0.25;
    p.xz = abs(p.xz);
    p.xz = (p.z > p.x) ? p.zx : p.xz;
    p.xz -= 0.5;
    vec3 q = vec3(p.z, h * p.y - 0.5 * p.x, h * p.x + 0.5 * p.y);
    float s = max(-q.x, 0.0);
    float t = clamp((q.y - 0.5 * p.z) / (m2 + 0.25), 0.0, 1.0);
    float a = m2 * (q.x + s) * (q.x + s) + q.y * q.y;
    float b = m2 * (q.x + 0.5 * t) * (q.x + 0.5 * t) + (q.y - m2 * t) * (q.y - m2 * t);
    float d = min(q.y, -q.x * m2 - q.y * 0.5) > 0.0 ? 0.0 : min(a, b);
    return sqrt((d + q.z * q.z) / m2) * sign(max(q.z, -p.y));
}
float sdf3d_hexPrism(vec3 p, vec2 h) {
    vec3 k = vec3(-0.8660254, 0.5, 0.57735);
    p = abs(p);
    p.xy -= 2.0 * min(dot(k.xy, p.xy), 0.0) * k.xy;
    vec2 d = vec2(
        length(p.xy - vec2(clamp(p.x, -k.z * h.x, k.z * h.x), h.x)) * sign(p.y - h.x),
        p.z - h.y);
    return min(max(d.x, d.y), 0.0) + length(max(d, 0.0));
}
float sdf3d_triPrism(vec3 p, vec2 h) {
    vec3 q = abs(p);
    return max(q.z - h.y, max(q.x * 0.866025 + p.y * 0.5, -p.y) - h.x * 0.5);
}
float sdf3d_cappedCone(vec3 p, float h, float r1, float r2) {
    vec2 q = vec2(length(p.xz), p.y);
    vec2 k1 = vec2(r2, h);
    vec2 k2 = vec2(r2 - r1, 2.0 * h);
    vec2 ca = vec2(q.x - min(q.x, (q.y < 0.0) ? r1 : r2), abs(q.y) - h);
    vec2 cb = q - k1 + k2 * clamp(dot(k1 - q, k2) / dot(k2, k2), 0.0, 1.0);
    float s = (cb.x < 0.0 && ca.y < 0.0) ? -1.0 : 1.0;
    return s * sqrt(min(dot(ca, ca), dot(cb, cb)));
}
float sdf3d_roundedCylinder(vec3 p, float ra, float rb, float h) {
    vec2 d = vec2(length(p.xz) - 2.0 * ra + rb, abs(p.y) - h);
    return min(max(d.x, d.y), 0.0) + length(max(d, 0.0)) - rb;
}
float sdf3d_solidAngle(vec3 p, vec2 c, float ra) {
    vec2 q = vec2(length(p.xz), p.y);
    float l = length(q) - ra;
    float m = length(q - c * clamp(dot(q, c), 0.0, ra));
    return max(l, m * sign(c.y * q.x - c.x * q.y));
}
float sdf3d_vertCapsule(vec3 p, float h, float r) {
    p.y -= clamp(p.y, 0.0, h);
    return length(p) - r;
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
    const h    = inputVars.height ?? p(node.params.height, -0.75);
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
    const ang   = inputVars.angle ?? p(node.params.angle, 0.0);
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

// ─── New 3D SDF Primitive Nodes ───────────────────────────────────────────────

export const RoundedBoxSDF3DNode: NodeDefinition = {
  type: 'roundedBoxSDF3D', label: 'Rounded Box', category: '3D Primitives',
  description: 'Box SDF with rounded corners and edges. radius=0 is a plain box.',
  inputs: { pos: { type: 'vec3', label: 'Position' }, radius: { type: 'float', label: 'Radius' } },
  outputs: { dist: { type: 'float', label: 'Distance' } },
  defaultParams: { sizeX: 0.4, sizeY: 0.4, sizeZ: 0.4, radius: 0.1 },
  paramDefs: {
    sizeX:  { label: 'Size X',  type: 'float', min: 0.01, max: 5.0, step: 0.01 },
    sizeY:  { label: 'Size Y',  type: 'float', min: 0.01, max: 5.0, step: 0.01 },
    sizeZ:  { label: 'Size Z',  type: 'float', min: 0.01, max: 5.0, step: 0.01 },
    radius: { label: 'Radius',  type: 'float', min: 0.0,  max: 1.0, step: 0.01 },
  },
  glslFunction: SDF3D_PRIMS_GLSL,
  generateGLSL: (node, inputVars) => {
    const id = node.id;
    const pos = inputVars.pos || 'vec3(0.0)';
    const sx  = p(node.params.sizeX, 0.4);
    const sy  = p(node.params.sizeY, 0.4);
    const sz  = p(node.params.sizeZ, 0.4);
    const r   = inputVars.radius || p(node.params.radius, 0.1);
    return { code: `    float ${id}_dist = sdf3d_roundedBox(${pos}, vec3(${sx}, ${sy}, ${sz}), ${r});\n`, outputVars: { dist: `${id}_dist` } };
  },
};

export const BoxFrameSDF3DNode: NodeDefinition = {
  type: 'boxFrameSDF3D', label: 'Box Frame', category: '3D Primitives',
  description: 'Wireframe box — only the 12 edges, not the faces. Good for grid aesthetics.',
  inputs: { pos: { type: 'vec3', label: 'Position' } },
  outputs: { dist: { type: 'float', label: 'Distance' } },
  defaultParams: { sizeX: 0.4, sizeY: 0.4, sizeZ: 0.4, thickness: 0.05 },
  paramDefs: {
    sizeX:     { label: 'Size X',     type: 'float', min: 0.01, max: 5.0, step: 0.01 },
    sizeY:     { label: 'Size Y',     type: 'float', min: 0.01, max: 5.0, step: 0.01 },
    sizeZ:     { label: 'Size Z',     type: 'float', min: 0.01, max: 5.0, step: 0.01 },
    thickness: { label: 'Thickness',  type: 'float', min: 0.005, max: 0.5, step: 0.005 },
  },
  glslFunction: SDF3D_PRIMS_GLSL,
  generateGLSL: (node, inputVars) => {
    const id = node.id;
    const pos = inputVars.pos || 'vec3(0.0)';
    const sx = p(node.params.sizeX, 0.4);
    const sy = p(node.params.sizeY, 0.4);
    const sz = p(node.params.sizeZ, 0.4);
    const th = p(node.params.thickness, 0.05);
    return { code: `    float ${id}_dist = sdf3d_boxFrame(${pos}, vec3(${sx}, ${sy}, ${sz}), ${th});\n`, outputVars: { dist: `${id}_dist` } };
  },
};

export const EllipsoidSDF3DNode: NodeDefinition = {
  type: 'ellipsoidSDF3D', label: 'Ellipsoid', category: '3D Primitives',
  description: 'Sphere stretched per-axis. Approximate SDF — use stepScale 0.8 in MLG.',
  inputs: { pos: { type: 'vec3', label: 'Position' } },
  outputs: { dist: { type: 'float', label: 'Distance' } },
  defaultParams: { rx: 0.6, ry: 0.3, rz: 0.4 },
  paramDefs: {
    rx: { label: 'Radius X', type: 'float', min: 0.01, max: 5.0, step: 0.01 },
    ry: { label: 'Radius Y', type: 'float', min: 0.01, max: 5.0, step: 0.01 },
    rz: { label: 'Radius Z', type: 'float', min: 0.01, max: 5.0, step: 0.01 },
  },
  glslFunction: SDF3D_PRIMS_GLSL,
  generateGLSL: (node, inputVars) => {
    const id = node.id;
    const pos = inputVars.pos || 'vec3(0.0)';
    const rx = p(node.params.rx, 0.6);
    const ry = p(node.params.ry, 0.3);
    const rz = p(node.params.rz, 0.4);
    return { code: `    float ${id}_dist = sdf3d_ellipsoid(${pos}, vec3(${rx}, ${ry}, ${rz}));\n`, outputVars: { dist: `${id}_dist` } };
  },
};

export const CappedTorusSDF3DNode: NodeDefinition = {
  type: 'cappedTorusSDF3D', label: 'Capped Torus', category: '3D Primitives',
  description: 'Partial torus (arc). angle controls how much of the ring is visible (0=line, π=full ring).',
  inputs: { pos: { type: 'vec3', label: 'Position' } },
  outputs: { dist: { type: 'float', label: 'Distance' } },
  defaultParams: { majorR: 0.5, minorR: 0.1, angle: 1.2 },
  paramDefs: {
    majorR: { label: 'Major R', type: 'float', min: 0.05, max: 3.0, step: 0.01 },
    minorR: { label: 'Minor R', type: 'float', min: 0.01, max: 1.0, step: 0.01 },
    angle:  { label: 'Arc Angle', type: 'float', min: 0.01, max: 3.14159, step: 0.01 },
  },
  glslFunction: SDF3D_PRIMS_GLSL,
  generateGLSL: (node, inputVars) => {
    const id = node.id;
    const pos = inputVars.pos || 'vec3(0.0)';
    const ra = p(node.params.majorR, 0.5);
    const rb = p(node.params.minorR, 0.1);
    const ang = p(node.params.angle, 1.2);
    return {
      code: `    float ${id}_dist = sdf3d_cappedTorus(${pos}, vec2(sin(${ang}), cos(${ang})), ${ra}, ${rb});\n`,
      outputVars: { dist: `${id}_dist` },
    };
  },
};

export const LinkSDF3DNode: NodeDefinition = {
  type: 'linkSDF3D', label: 'Chain Link', category: '3D Primitives',
  description: 'Chain link shape — two cylinders connected by half-tori.',
  inputs: { pos: { type: 'vec3', label: 'Position' } },
  outputs: { dist: { type: 'float', label: 'Distance' } },
  defaultParams: { length: 0.3, r1: 0.25, r2: 0.08 },
  paramDefs: {
    length: { label: 'Half Length', type: 'float', min: 0.0, max: 2.0, step: 0.01 },
    r1:     { label: 'Ring Radius', type: 'float', min: 0.05, max: 2.0, step: 0.01 },
    r2:     { label: 'Wire Radius', type: 'float', min: 0.01, max: 0.5, step: 0.005 },
  },
  glslFunction: SDF3D_PRIMS_GLSL,
  generateGLSL: (node, inputVars) => {
    const id = node.id;
    const pos = inputVars.pos || 'vec3(0.0)';
    const le = p(node.params.length, 0.3);
    const r1 = p(node.params.r1, 0.25);
    const r2 = p(node.params.r2, 0.08);
    return { code: `    float ${id}_dist = sdf3d_link(${pos}, ${le}, ${r1}, ${r2});\n`, outputVars: { dist: `${id}_dist` } };
  },
};

export const PyramidSDF3DNode: NodeDefinition = {
  type: 'pyramidSDF3D', label: 'Pyramid', category: '3D Primitives',
  description: 'Square-base pyramid pointing upward. Great for fractal iteration.',
  inputs: { pos: { type: 'vec3', label: 'Position' } },
  outputs: { dist: { type: 'float', label: 'Distance' } },
  defaultParams: { height: 0.8 },
  paramDefs: { height: { label: 'Height', type: 'float', min: 0.05, max: 5.0, step: 0.01 } },
  glslFunction: SDF3D_PRIMS_GLSL,
  generateGLSL: (node, inputVars) => {
    const id = node.id;
    const pos = inputVars.pos || 'vec3(0.0)';
    const h = inputVars.height || p(node.params.height, 0.8);
    return { code: `    float ${id}_dist = sdf3d_pyramid(${pos}, ${h});\n`, outputVars: { dist: `${id}_dist` } };
  },
};

export const HexPrismSDF3DNode: NodeDefinition = {
  type: 'hexPrismSDF3D', label: 'Hex Prism', category: '3D Primitives',
  description: 'Hexagonal prism. Good for honeycomb patterns.',
  inputs: { pos: { type: 'vec3', label: 'Position' } },
  outputs: { dist: { type: 'float', label: 'Distance' } },
  defaultParams: { radius: 0.4, height: 0.2 },
  paramDefs: {
    radius: { label: 'Hex Radius', type: 'float', min: 0.01, max: 3.0, step: 0.01 },
    height: { label: 'Half Height', type: 'float', min: 0.01, max: 3.0, step: 0.01 },
  },
  glslFunction: SDF3D_PRIMS_GLSL,
  generateGLSL: (node, inputVars) => {
    const id = node.id;
    const pos = inputVars.pos || 'vec3(0.0)';
    const r = p(node.params.radius, 0.4);
    const h = p(node.params.height, 0.2);
    return { code: `    float ${id}_dist = sdf3d_hexPrism(${pos}, vec2(${r}, ${h}));\n`, outputVars: { dist: `${id}_dist` } };
  },
};

export const TriPrismSDF3DNode: NodeDefinition = {
  type: 'triPrismSDF3D', label: 'Tri Prism', category: '3D Primitives',
  description: 'Triangular prism.',
  inputs: { pos: { type: 'vec3', label: 'Position' } },
  outputs: { dist: { type: 'float', label: 'Distance' } },
  defaultParams: { radius: 0.4, height: 0.2 },
  paramDefs: {
    radius: { label: 'Tri Radius', type: 'float', min: 0.01, max: 3.0, step: 0.01 },
    height: { label: 'Half Height', type: 'float', min: 0.01, max: 3.0, step: 0.01 },
  },
  glslFunction: SDF3D_PRIMS_GLSL,
  generateGLSL: (node, inputVars) => {
    const id = node.id;
    const pos = inputVars.pos || 'vec3(0.0)';
    const r = p(node.params.radius, 0.4);
    const h = p(node.params.height, 0.2);
    return { code: `    float ${id}_dist = sdf3d_triPrism(${pos}, vec2(${r}, ${h}));\n`, outputVars: { dist: `${id}_dist` } };
  },
};

export const CappedConeSDF3DNode: NodeDefinition = {
  type: 'cappedConeSDF3D', label: 'Capped Cone', category: '3D Primitives',
  description: 'Frustum/truncated cone. r1=bottom radius, r2=top radius.',
  inputs: { pos: { type: 'vec3', label: 'Position' } },
  outputs: { dist: { type: 'float', label: 'Distance' } },
  defaultParams: { height: 0.5, r1: 0.4, r2: 0.1 },
  paramDefs: {
    height: { label: 'Height',        type: 'float', min: 0.01, max: 5.0, step: 0.01 },
    r1:     { label: 'Bottom Radius', type: 'float', min: 0.0,  max: 3.0, step: 0.01 },
    r2:     { label: 'Top Radius',    type: 'float', min: 0.0,  max: 3.0, step: 0.01 },
  },
  glslFunction: SDF3D_PRIMS_GLSL,
  generateGLSL: (node, inputVars) => {
    const id = node.id;
    const pos = inputVars.pos || 'vec3(0.0)';
    const h  = p(node.params.height, 0.5);
    const r1 = p(node.params.r1, 0.4);
    const r2 = p(node.params.r2, 0.1);
    return { code: `    float ${id}_dist = sdf3d_cappedCone(${pos}, ${h}, ${r1}, ${r2});\n`, outputVars: { dist: `${id}_dist` } };
  },
};

export const RoundedCylinderSDF3DNode: NodeDefinition = {
  type: 'roundedCylinderSDF3D', label: 'Rounded Cylinder', category: '3D Primitives',
  description: 'Cylinder with rounded top/bottom edges (hockey puck with bevels).',
  inputs: { pos: { type: 'vec3', label: 'Position' } },
  outputs: { dist: { type: 'float', label: 'Distance' } },
  defaultParams: { radius: 0.35, edgeRadius: 0.05, height: 0.4 },
  paramDefs: {
    radius:     { label: 'Radius',      type: 'float', min: 0.01, max: 3.0, step: 0.01 },
    edgeRadius: { label: 'Edge Radius', type: 'float', min: 0.005, max: 0.5, step: 0.005 },
    height:     { label: 'Half Height', type: 'float', min: 0.01, max: 3.0, step: 0.01 },
  },
  glslFunction: SDF3D_PRIMS_GLSL,
  generateGLSL: (node, inputVars) => {
    const id = node.id;
    const pos = inputVars.pos || 'vec3(0.0)';
    const ra = p(node.params.radius, 0.35);
    const rb = p(node.params.edgeRadius, 0.05);
    const h  = p(node.params.height, 0.4);
    return { code: `    float ${id}_dist = sdf3d_roundedCylinder(${pos}, ${ra}, ${rb}, ${h});\n`, outputVars: { dist: `${id}_dist` } };
  },
};

export const SolidAngleSDF3DNode: NodeDefinition = {
  type: 'solidAngleSDF3D', label: 'Solid Angle', category: '3D Primitives',
  description: 'Sphere with a cone-shaped bite removed — pac-man wedge in 3D.',
  inputs: { pos: { type: 'vec3', label: 'Position' } },
  outputs: { dist: { type: 'float', label: 'Distance' } },
  defaultParams: { radius: 0.6, angle: 1.0 },
  paramDefs: {
    radius: { label: 'Radius',        type: 'float', min: 0.05, max: 3.0, step: 0.01 },
    angle:  { label: 'Opening Angle', type: 'float', min: 0.01, max: 3.14, step: 0.01 },
  },
  glslFunction: SDF3D_PRIMS_GLSL,
  generateGLSL: (node, inputVars) => {
    const id = node.id;
    const pos = inputVars.pos || 'vec3(0.0)';
    const ra  = p(node.params.radius, 0.6);
    const ang = p(node.params.angle, 1.0);
    return {
      code: `    float ${id}_dist = sdf3d_solidAngle(${pos}, vec2(sin(${ang}), cos(${ang})), ${ra});\n`,
      outputVars: { dist: `${id}_dist` },
    };
  },
};

export const VerticalCapsuleSDF3DNode: NodeDefinition = {
  type: 'verticalCapsuleSDF3D', label: 'Vertical Capsule', category: '3D Primitives',
  description: 'Axis-aligned capsule centered at origin, extends along Y.',
  inputs: { pos: { type: 'vec3', label: 'Position' } },
  outputs: { dist: { type: 'float', label: 'Distance' } },
  defaultParams: { height: 0.5, radius: 0.2 },
  paramDefs: {
    height: { label: 'Half Height', type: 'float', min: 0.0, max: 5.0, step: 0.01 },
    radius: { label: 'Radius',      type: 'float', min: 0.01, max: 3.0, step: 0.01 },
  },
  glslFunction: SDF3D_PRIMS_GLSL,
  generateGLSL: (node, inputVars) => {
    const id = node.id;
    const pos = inputVars.pos || 'vec3(0.0)';
    const h = p(node.params.height, 0.5);
    const r = p(node.params.radius, 0.2);
    return { code: `    float ${id}_dist = sdf3d_vertCapsule(${pos}, ${h}, ${r});\n`, outputVars: { dist: `${id}_dist` } };
  },
};

// ─── SDF Boolean Ops ──────────────────────────────────────────────────────────

export const SDFUnionNode: NodeDefinition = {
  type: 'sdfUnion', label: 'SDF Union', category: '3D Boolean Ops',
  description: 'Nearest of two distances — standard union. Equivalent to min(a, b).',
  inputs: { a: { type: 'float', label: 'A' }, b: { type: 'float', label: 'B' } },
  outputs: { dist: { type: 'float', label: 'Distance' } },
  defaultParams: {},
  paramDefs: {},
  generateGLSL: (node, inputVars) => {
    const id = node.id;
    const a = inputVars.a || '0.0';
    const b = inputVars.b || '0.0';
    return { code: `    float ${id}_dist = min(${a}, ${b});\n`, outputVars: { dist: `${id}_dist` } };
  },
};

export const SDFSubtractNode: NodeDefinition = {
  type: 'sdfSubtract', label: 'SDF Subtract', category: '3D Boolean Ops',
  description: 'Carve "cut" out of "base". cut=shape being removed, base=main shape.',
  inputs: { cut: { type: 'float', label: 'Cut' }, base: { type: 'float', label: 'Base' } },
  outputs: { dist: { type: 'float', label: 'Distance' } },
  defaultParams: {},
  paramDefs: {},
  generateGLSL: (node, inputVars) => {
    const id = node.id;
    const cut  = inputVars.cut  || '0.0';
    const base = inputVars.base || '0.0';
    return { code: `    float ${id}_dist = max(-${cut}, ${base});\n`, outputVars: { dist: `${id}_dist` } };
  },
};

export const SDFIntersectNode: NodeDefinition = {
  type: 'sdfIntersect', label: 'SDF Intersect', category: '3D Boolean Ops',
  description: 'Keep only where both shapes overlap.',
  inputs: { a: { type: 'float', label: 'A' }, b: { type: 'float', label: 'B' } },
  outputs: { dist: { type: 'float', label: 'Distance' } },
  defaultParams: {},
  paramDefs: {},
  generateGLSL: (node, inputVars) => {
    const id = node.id;
    const a = inputVars.a || '0.0';
    const b = inputVars.b || '0.0';
    return { code: `    float ${id}_dist = max(${a}, ${b});\n`, outputVars: { dist: `${id}_dist` } };
  },
};

export const SDFSmoothUnionNode: NodeDefinition = {
  type: 'sdfSmoothUnion', label: 'Smooth Union', category: '3D Boolean Ops',
  description: 'Blend two shapes together with a smooth transition of width k. k=0.1 tight, k=0.5 blobby.',
  inputs: { a: { type: 'float', label: 'A' }, b: { type: 'float', label: 'B' }, k: { type: 'float', label: 'Blend' } },
  outputs: { dist: { type: 'float', label: 'Distance' } },
  defaultParams: { k: 0.15 },
  paramDefs: { k: { label: 'Blend k', type: 'float', min: 0.001, max: 1.0, step: 0.005 } },
  generateGLSL: (node, inputVars) => {
    const id = node.id;
    const a = inputVars.a || '0.0';
    const b = inputVars.b || '0.0';
    const k = inputVars.k || p(node.params.k, 0.15);
    return {
      code: `    float ${id}_h = clamp(0.5 + 0.5*(${b}-${a})/${k}, 0.0, 1.0);\n    float ${id}_dist = mix(${b}, ${a}, ${id}_h) - ${k}*${id}_h*(1.0-${id}_h);\n`,
      outputVars: { dist: `${id}_dist` },
    };
  },
};

export const SDFSmoothSubtractNode: NodeDefinition = {
  type: 'sdfSmoothSubtract', label: 'Smooth Subtract', category: '3D Boolean Ops',
  description: 'Smooth subtraction — rounds the carved edge. cut=shape removed, base=main.',
  inputs: { cut: { type: 'float', label: 'Cut' }, base: { type: 'float', label: 'Base' }, k: { type: 'float', label: 'Blend' } },
  outputs: { dist: { type: 'float', label: 'Distance' } },
  defaultParams: { k: 0.1 },
  paramDefs: { k: { label: 'Blend k', type: 'float', min: 0.001, max: 1.0, step: 0.005 } },
  generateGLSL: (node, inputVars) => {
    const id = node.id;
    const cut  = inputVars.cut  || '0.0';
    const base = inputVars.base || '0.0';
    const k    = inputVars.k    || p(node.params.k, 0.1);
    return {
      code: `    float ${id}_h = clamp(0.5 - 0.5*(${base}+${cut})/${k}, 0.0, 1.0);\n    float ${id}_dist = mix(${base}, -${cut}, ${id}_h) + ${k}*${id}_h*(1.0-${id}_h);\n`,
      outputVars: { dist: `${id}_dist` },
    };
  },
};

export const SDFSmoothIntersectNode: NodeDefinition = {
  type: 'sdfSmoothIntersect', label: 'Smooth Intersect', category: '3D Boolean Ops',
  description: 'Smooth intersection — rounds the overlap edge.',
  inputs: { a: { type: 'float', label: 'A' }, b: { type: 'float', label: 'B' }, k: { type: 'float', label: 'Blend' } },
  outputs: { dist: { type: 'float', label: 'Distance' } },
  defaultParams: { k: 0.1 },
  paramDefs: { k: { label: 'Blend k', type: 'float', min: 0.001, max: 1.0, step: 0.005 } },
  generateGLSL: (node, inputVars) => {
    const id = node.id;
    const a = inputVars.a || '0.0';
    const b = inputVars.b || '0.0';
    const k = inputVars.k || p(node.params.k, 0.1);
    return {
      code: `    float ${id}_h = clamp(0.5 - 0.5*(${b}-${a})/${k}, 0.0, 1.0);\n    float ${id}_dist = mix(${b}, ${a}, ${id}_h) + ${k}*${id}_h*(1.0-${id}_h);\n`,
      outputVars: { dist: `${id}_dist` },
    };
  },
};

export const SDFRoundNode: NodeDefinition = {
  type: 'sdfRound', label: 'SDF Round', category: '3D Boolean Ops',
  description: 'Inflate any SDF outward by r. Applied after the SDF node.',
  inputs: { dist: { type: 'float', label: 'Distance' }, r: { type: 'float', label: 'Radius' } },
  outputs: { dist: { type: 'float', label: 'Distance' } },
  defaultParams: { r: 0.05 },
  paramDefs: { r: { label: 'Round Radius', type: 'float', min: 0.0, max: 1.0, step: 0.005 } },
  generateGLSL: (node, inputVars) => {
    const id = node.id;
    const d = inputVars.dist || '0.0';
    const r = inputVars.r || p(node.params.r, 0.05);
    return { code: `    float ${id}_dist = ${d} - ${r};\n`, outputVars: { dist: `${id}_dist` } };
  },
};

export const SDFOnionNode: NodeDefinition = {
  type: 'sdfOnion', label: 'SDF Onion', category: '3D Boolean Ops',
  description: 'Makes any solid SDF into a hollow shell. Combine with Intersect+Plane to reveal interior.',
  inputs: { dist: { type: 'float', label: 'Distance' }, r: { type: 'float', label: 'Thickness' } },
  outputs: { dist: { type: 'float', label: 'Distance' } },
  defaultParams: { r: 0.05 },
  paramDefs: { r: { label: 'Shell Thickness', type: 'float', min: 0.001, max: 1.0, step: 0.005 } },
  generateGLSL: (node, inputVars) => {
    const id = node.id;
    const d = inputVars.dist || '0.0';
    const r = inputVars.r || p(node.params.r, 0.05);
    return { code: `    float ${id}_dist = abs(${d}) - ${r};\n`, outputVars: { dist: `${id}_dist` } };
  },
};

// ─── New 3D Transform Nodes ───────────────────────────────────────────────────

export const Bend3DNode: NodeDefinition = {
  type: 'bend3D', label: 'Bend 3D', category: '3D Transforms',
  description: 'Bends space along X axis. Non-isometric — use stepScale 0.7–0.8 in MLG.',
  inputs: { pos: { type: 'vec3', label: 'Position' }, k: { type: 'float', label: 'Bend Amount' } },
  outputs: { pos: { type: 'vec3', label: 'Bent Pos' } },
  defaultParams: { k: 0.5 },
  paramDefs: { k: { label: 'Bend Amount', type: 'float', min: -5.0, max: 5.0, step: 0.01 } },
  generateGLSL: (node, inputVars) => {
    const id = node.id;
    const pv = inputVars.pos || 'vec3(0.0)';
    const k  = inputVars.k  || p(node.params.k, 0.5);
    return {
      code: [
        `    float ${id}_c = cos(${k} * (${pv}).x);\n`,
        `    float ${id}_s = sin(${k} * (${pv}).x);\n`,
        `    vec3 ${id}_pos = vec3(${id}_c*(${pv}).x - ${id}_s*(${pv}).y, ${id}_s*(${pv}).x + ${id}_c*(${pv}).y, (${pv}).z);\n`,
      ].join(''),
      outputVars: { pos: `${id}_pos` },
    };
  },
};

export const LimitedRepeat3DNode: NodeDefinition = {
  type: 'limitedRepeat3D', label: 'Limited Repeat 3D', category: '3D Transforms',
  description: 'Repeat geometry N times in each direction — does not go to infinity.',
  inputs: { pos: { type: 'vec3', label: 'Position' } },
  outputs: { pos: { type: 'vec3', label: 'Repeated Pos' } },
  defaultParams: { cellX: 1.0, cellY: 1.0, cellZ: 1.0, limX: 2.0, limY: 2.0, limZ: 2.0 },
  paramDefs: {
    cellX: { label: 'Cell X',  type: 'float', min: 0.1,  max: 10.0, step: 0.1 },
    cellY: { label: 'Cell Y',  type: 'float', min: 0.1,  max: 10.0, step: 0.1 },
    cellZ: { label: 'Cell Z',  type: 'float', min: 0.1,  max: 10.0, step: 0.1 },
    limX:  { label: 'Count X', type: 'float', min: 0.0,  max: 20.0, step: 1.0 },
    limY:  { label: 'Count Y', type: 'float', min: 0.0,  max: 20.0, step: 1.0 },
    limZ:  { label: 'Count Z', type: 'float', min: 0.0,  max: 20.0, step: 1.0 },
  },
  generateGLSL: (node, inputVars) => {
    const id = node.id;
    const pv = inputVars.pos || 'vec3(0.0)';
    const cx = p(node.params.cellX, 1.0);
    const cy = p(node.params.cellY, 1.0);
    const cz = p(node.params.cellZ, 1.0);
    const lx = p(node.params.limX, 2.0);
    const ly = p(node.params.limY, 2.0);
    const lz = p(node.params.limZ, 2.0);
    return {
      code: `    vec3 ${id}_pos = ${pv} - vec3(${cx}, ${cy}, ${cz}) * clamp(round(${pv} / vec3(${cx}, ${cy}, ${cz})), vec3(-${lx}, -${ly}, -${lz}), vec3(${lx}, ${ly}, ${lz}));\n`,
      outputVars: { pos: `${id}_pos` },
    };
  },
};

export const PolarRepeat3DNode: NodeDefinition = {
  type: 'polarRepeat3D', label: 'Polar Repeat 3D', category: '3D Transforms',
  description: 'Repeats geometry N times radially around an axis. Creates gears, flowers, clock-face symmetry.',
  inputs: { pos: { type: 'vec3', label: 'Position' } },
  outputs: { pos: { type: 'vec3', label: 'Repeated Pos' } },
  defaultParams: { count: 6.0, axis: 'y' },
  paramDefs: {
    count: { label: 'Repeat Count', type: 'float', min: 2.0, max: 32.0, step: 1.0 },
    axis:  { label: 'Axis', type: 'select', options: [
      { value: 'y', label: 'Y Axis' },
      { value: 'x', label: 'X Axis' },
      { value: 'z', label: 'Z Axis' },
    ]},
  },
  generateGLSL: (node, inputVars) => {
    const id = node.id;
    const pv    = inputVars.pos || 'vec3(0.0)';
    const count = p(node.params.count, 6.0);
    const axis  = (node.params.axis as string) ?? 'y';
    let code: string;
    if (axis === 'y') {
      code = [
        `    float ${id}_ang = atan((${pv}).z, (${pv}).x);\n`,
        `    float ${id}_sec = 6.2832 / ${count};\n`,
        `    ${id}_ang = mod(${id}_ang + ${id}_sec * 0.5, ${id}_sec) - ${id}_sec * 0.5;\n`,
        `    vec3 ${id}_pos = vec3(length((${pv}).xz) * cos(${id}_ang), (${pv}).y, length((${pv}).xz) * sin(${id}_ang));\n`,
      ].join('');
    } else if (axis === 'x') {
      code = [
        `    float ${id}_ang = atan((${pv}).z, (${pv}).y);\n`,
        `    float ${id}_sec = 6.2832 / ${count};\n`,
        `    ${id}_ang = mod(${id}_ang + ${id}_sec * 0.5, ${id}_sec) - ${id}_sec * 0.5;\n`,
        `    vec3 ${id}_pos = vec3((${pv}).x, length((${pv}).yz) * cos(${id}_ang), length((${pv}).yz) * sin(${id}_ang));\n`,
      ].join('');
    } else {
      code = [
        `    float ${id}_ang = atan((${pv}).y, (${pv}).x);\n`,
        `    float ${id}_sec = 6.2832 / ${count};\n`,
        `    ${id}_ang = mod(${id}_ang + ${id}_sec * 0.5, ${id}_sec) - ${id}_sec * 0.5;\n`,
        `    vec3 ${id}_pos = vec3(length((${pv}).xy) * cos(${id}_ang), length((${pv}).xy) * sin(${id}_ang), (${pv}).z);\n`,
      ].join('');
    }
    return { code, outputVars: { pos: `${id}_pos` } };
  },
};

export const Displace3DNode: NodeDefinition = {
  type: 'displace3D', label: 'Displace 3D', category: '3D Transforms',
  description: 'Sine-based surface displacement added to an SDF. Creates bumpy/organic texture.',
  inputs: {
    pos:  { type: 'vec3',  label: 'Position' },
    dist: { type: 'float', label: 'Distance' },
    freq: { type: 'float', label: 'Frequency' },
    amp:  { type: 'float', label: 'Amplitude' },
  },
  outputs: { dist: { type: 'float', label: 'Displaced Dist' } },
  defaultParams: { freq: 8.0, amp: 0.05 },
  paramDefs: {
    freq: { label: 'Frequency', type: 'float', min: 0.1,  max: 40.0, step: 0.1 },
    amp:  { label: 'Amplitude', type: 'float', min: 0.0,  max: 0.5,  step: 0.005 },
  },
  generateGLSL: (node, inputVars) => {
    const id   = node.id;
    const pv   = inputVars.pos  || 'vec3(0.0)';
    const d    = inputVars.dist || '0.0';
    const freq = inputVars.freq || p(node.params.freq, 8.0);
    const amp  = inputVars.amp  || p(node.params.amp,  0.05);
    return {
      code: `    float ${id}_disp = sin(${freq}*(${pv}).x)*sin(${freq}*(${pv}).y)*sin(${freq}*(${pv}).z);\n    float ${id}_dist = ${d} + ${amp}*${id}_disp;\n`,
      outputVars: { dist: `${id}_dist` },
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

// ─── Domain Repetition / Fractal SDF Nodes (IQ articles) ─────────────────────

/**
 * Mirrored Repeat 3D
 * Infinite repetition with mirror-flip on every other cell. Produces valid SDF
 * distances for symmetric primitives — no discontinuities at tile boundaries.
 * (From Inigo Quilez "Domain Repetition" article.)
 */
export const MirroredRepeat3DNode: NodeDefinition = {
  type: 'mirroredRepeat3D',
  label: 'Mirrored Repeat 3D',
  category: '3D Transforms',
  description: 'Infinite 3D domain repetition with mirror flip on every other cell. SDF-correct for symmetric shapes. Outputs warped position + integer cell ID. Use instead of Repeat 3D when shapes vary from tile to tile.',
  inputs: {
    pos:   { type: 'vec3',  label: 'Position' },
    cellX: { type: 'float', label: 'Cell X' },
    cellY: { type: 'float', label: 'Cell Y' },
    cellZ: { type: 'float', label: 'Cell Z' },
  },
  outputs: {
    pos:    { type: 'vec3', label: 'Mirrored Pos' },
    cellID: { type: 'vec3', label: 'Cell ID' },
  },
  defaultParams: { cellX: 2.0, cellY: 2.0, cellZ: 2.0 },
  paramDefs: {
    cellX: { label: 'Cell X', type: 'float', min: 0.1, max: 10.0, step: 0.1 },
    cellY: { label: 'Cell Y', type: 'float', min: 0.1, max: 10.0, step: 0.1 },
    cellZ: { label: 'Cell Z', type: 'float', min: 0.1, max: 10.0, step: 0.1 },
  },
  generateGLSL: (node: GraphNode, inputVars) => {
    const id  = node.id;
    const pv  = inputVars.pos   || 'vec3(0.0)';
    const cx  = inputVars.cellX || p(node.params.cellX, 2.0);
    const cy  = inputVars.cellY || p(node.params.cellY, 2.0);
    const cz  = inputVars.cellZ || p(node.params.cellZ, 2.0);
    return {
      code: [
        `    vec3 ${id}_s      = vec3(${cx}, ${cy}, ${cz});\n`,
        `    vec3 ${id}_cellID = round(${pv} / ${id}_s);\n`,
        `    vec3 ${id}_r      = ${pv} - ${id}_s * ${id}_cellID;\n`,
        // step(0.5, mod(abs(id), 2.0)) → 0 for even cell, 1 for odd → flip sign
        `    vec3 ${id}_odd    = step(vec3(0.5), mod(abs(${id}_cellID), vec3(2.0)));\n`,
        `    vec3 ${id}_pos    = mix(${id}_r, -${id}_r, ${id}_odd);\n`,
      ].join(''),
      outputVars: { pos: `${id}_pos`, cellID: `${id}_cellID` },
    };
  },
};

/**
 * SD Cross 3D
 * Union of three infinite square bars intersecting at the origin — the
 * building block of the Menger Sponge and a useful standalone primitive.
 * (From Inigo Quilez "Menger Sponge" article.)
 */
export const SdCrossNode: NodeDefinition = {
  type: 'sdCross3D',
  label: 'SD Cross 3D',
  category: '3D Primitives',
  description: 'Union of three infinite square bars along each axis — the cross shape used to build Menger Sponge. size = bar half-thickness.',
  inputs: {
    pos:  { type: 'vec3',  label: 'Position' },
    size: { type: 'float', label: 'Size' },
  },
  outputs: { dist: { type: 'float', label: 'Distance' } },
  defaultParams: { size: 0.3 },
  paramDefs: {
    size: { label: 'Bar Half-size', type: 'float', min: 0.01, max: 2.0, step: 0.01 },
  },
  generateGLSL: (node: GraphNode, inputVars) => {
    const id   = node.id;
    const pv   = inputVars.pos  || 'vec3(0.0)';
    const sz   = inputVars.size || p(node.params.size, 0.3);
    return {
      code: [
        `    vec3  ${id}_q    = abs(${pv});\n`,
        `    float ${id}_da   = max(${id}_q.x, ${id}_q.y);\n`,
        `    float ${id}_db   = max(${id}_q.y, ${id}_q.z);\n`,
        `    float ${id}_dc   = max(${id}_q.z, ${id}_q.x);\n`,
        `    float ${id}_dist = min(${id}_da, min(${id}_db, ${id}_dc)) - ${sz};\n`,
      ].join(''),
      outputVars: { dist: `${id}_dist` },
    };
  },
};

/**
 * Menger Sponge SDF
 * Classic fractal formed by iteratively subtracting a cross-shaped hole from
 * a cube. Each iteration triples the frequency of detail. 1–4 iterations.
 * (From Inigo Quilez "Menger Sponge" article.)
 */
export const MengerSpongeNode: NodeDefinition = {
  type: 'mengerSponge',
  label: 'Menger Sponge',
  category: '3D Primitives',
  description: 'Iterative fractal SDF: a cube with cross-shaped holes drilled at every scale. iterations=1 is a simple drilled cube; 3–4 gives full fractal detail. size scales the unit cube.',
  inputs: {
    pos:  { type: 'vec3',  label: 'Position' },
    size: { type: 'float', label: 'Size' },
  },
  outputs: { dist: { type: 'float', label: 'Distance' } },
  defaultParams: { size: 1.0, iterations: 3 },
  paramDefs: {
    size:       { label: 'Size',       type: 'float',  min: 0.1, max: 5.0, step: 0.05 },
    iterations: { label: 'Iterations', type: 'select', options: [1,2,3,4].map(n => ({ value: String(n), label: String(n) })) },
  },
  glslFunction: SDF3D_PRIMS_GLSL,
  generateGLSL: (node: GraphNode, inputVars) => {
    const id    = node.id;
    const pv    = inputVars.pos  || 'vec3(0.0)';
    const sz    = inputVars.size || p(node.params.size, 1.0);
    const iters = Math.max(1, Math.min(4, Number(node.params.iterations) || 3));
    const lines: string[] = [
      // Normalize to unit cube, evaluate box SDF, then iterate
      `    vec3  ${id}_p = ${pv} / ${sz};\n`,
      `    float ${id}_d = sdf3d_box(${id}_p, vec3(1.0));\n`,
      `    float ${id}_s = 1.0;\n`,
    ];
    for (let m = 0; m < iters; m++) {
      lines.push(`    { // menger iter ${m + 1}\n`);
      lines.push(`    vec3  ${id}_a${m} = mod(${id}_p * ${id}_s, 2.0) - 1.0;\n`);
      lines.push(`    ${id}_s *= 3.0;\n`);
      lines.push(`    vec3  ${id}_r${m} = abs(1.0 - 3.0 * abs(${id}_a${m}));\n`);
      lines.push(`    float ${id}_da${m} = max(${id}_r${m}.x, ${id}_r${m}.y);\n`);
      lines.push(`    float ${id}_db${m} = max(${id}_r${m}.y, ${id}_r${m}.z);\n`);
      lines.push(`    float ${id}_dc${m} = max(${id}_r${m}.z, ${id}_r${m}.x);\n`);
      lines.push(`    float ${id}_c${m}  = (min(${id}_da${m}, min(${id}_db${m}, ${id}_dc${m})) - 1.0) / ${id}_s;\n`);
      lines.push(`    ${id}_d = max(${id}_d, ${id}_c${m}); }\n`);
    }
    // Scale distance back to world space
    lines.push(`    float ${id}_dist = ${id}_d * ${sz};\n`);
    return { code: lines.join(''), outputVars: { dist: `${id}_dist` } };
  },
};

