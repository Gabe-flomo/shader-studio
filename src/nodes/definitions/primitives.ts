import type { NodeDefinition, GraphNode } from '../../types/nodeGraph';
import { p } from './helpers';

// ─── Legacy standalone nodes (kept for backwards compat) ─────────────────────

export const CircleSDFNode: NodeDefinition = {
  type: 'circleSDF',
  label: 'Circle SDF',
  category: '2D Primitives',
  description: 'Signed distance function for a circle.',
  inputs: {
    position: { type: 'vec2', label: 'Position' },
    radius:   { type: 'float', label: 'Radius' },
    offset:   { type: 'vec2', label: 'Offset' },
  },
  outputs: { distance: { type: 'float', label: 'Distance' } },
  defaultParams: { radius: 0.3, posX: 0.0, posY: 0.0 },
  paramDefs: {
    radius: { label: 'Radius', type: 'float', min: 0.01, max: 2, step: 0.01 },
    posX:   { label: 'X',      type: 'float', min: -1,   max: 1, step: 0.01 },
    posY:   { label: 'Y',      type: 'float', min: -1,   max: 1, step: 0.01 },
  },
  glslFunction: `float circleSDF(vec2 point, float size) { return length(point) - size; }`,
  generateGLSL: (node: GraphNode, inputVars) => {
    const outVar    = `${node.id}_dist`;
    const posVar    = inputVars.position || 'vec2(0.0)';
    const radiusVar = inputVars.radius   || p(node.params.radius, 0.3);
    const px        = p(node.params.posX, 0.0);
    const py        = p(node.params.posY, 0.0);
    const offsetVar = inputVars.offset   || `vec2(${px}, ${py})`;
    return {
      code: `    float ${outVar} = circleSDF(${posVar} - ${offsetVar}, ${radiusVar});\n`,
      outputVars: { distance: outVar },
    };
  },
};

export const BoxSDFNode: NodeDefinition = {
  type: 'boxSDF',
  label: 'Box SDF',
  category: '2D Primitives',
  description: 'Signed distance function for a box.',
  inputs: {
    position:   { type: 'vec2', label: 'Position' },
    dimensions: { type: 'vec2', label: 'Dimensions' },
    offset:     { type: 'vec2', label: 'Offset' },
  },
  outputs: { distance: { type: 'float', label: 'Distance' } },
  defaultParams: { width: 0.5, height: 0.5, posX: 0.0, posY: 0.0 },
  paramDefs: {
    width:  { label: 'Width',  type: 'float', min: 0.01, max: 2, step: 0.01 },
    height: { label: 'Height', type: 'float', min: 0.01, max: 2, step: 0.01 },
    posX:   { label: 'X',      type: 'float', min: -1,   max: 1, step: 0.01 },
    posY:   { label: 'Y',      type: 'float', min: -1,   max: 1, step: 0.01 },
  },
  glslFunction: `float boxSDF(in vec2 position, in vec2 dimensions) {
  vec2 d = abs(position) - dimensions;
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}`,
  generateGLSL: (node: GraphNode, inputVars) => {
    const outVar    = `${node.id}_dist`;
    const posVar    = inputVars.position   || 'vec2(0.0)';
    const w         = p(node.params.width,  0.5);
    const h         = p(node.params.height, 0.5);
    const dimsVar   = inputVars.dimensions || `vec2(${w}, ${h})`;
    const px        = p(node.params.posX, 0.0);
    const py        = p(node.params.posY, 0.0);
    const offsetVar = inputVars.offset || `vec2(${px}, ${py})`;
    return {
      code: `    float ${outVar} = boxSDF(${posVar} - ${offsetVar}, ${dimsVar});\n`,
      outputVars: { distance: outVar },
    };
  },
};

export const RingSDFNode: NodeDefinition = {
  type: 'ringSDF',
  label: 'Ring SDF',
  category: '2D Primitives',
  description: 'Signed distance function for a ring (absolute circle SDF).',
  inputs: {
    position: { type: 'vec2',  label: 'Position' },
    radius:   { type: 'float', label: 'Radius' },
    offset:   { type: 'vec2',  label: 'Offset' },
  },
  outputs: { distance: { type: 'float', label: 'Distance' } },
  defaultParams: { radius: 0.3, posX: 0.0, posY: 0.0 },
  paramDefs: {
    radius: { label: 'Radius', type: 'float', min: 0.01, max: 2, step: 0.01 },
    posX:   { label: 'X',      type: 'float', min: -1,   max: 1, step: 0.01 },
    posY:   { label: 'Y',      type: 'float', min: -1,   max: 1, step: 0.01 },
  },
  glslFunction: `float ringSDF(vec2 point, float size) { return abs(length(point) - size); }`,
  generateGLSL: (node: GraphNode, inputVars) => {
    const outVar    = `${node.id}_dist`;
    const posVar    = inputVars.position || 'vec2(0.0)';
    const radiusVar = inputVars.radius   || p(node.params.radius, 0.3);
    const px        = p(node.params.posX, 0.0);
    const py        = p(node.params.posY, 0.0);
    const offsetVar = inputVars.offset || `vec2(${px}, ${py})`;
    return {
      code: `    float ${outVar} = ringSDF(${posVar} - ${offsetVar}, ${radiusVar});\n`,
      outputVars: { distance: outVar },
    };
  },
};

// ─── All IQ 2D SDFs in one GLSL block ────────────────────────────────────────
// Sources: https://iquilezles.org/articles/distfunctions2d/
// GLSL ES 1.00 compatible:
//   - round(x) replaced with floor(x+0.5) where needed
//   - mat2 used instead of mat2x2

const SHAPE_SDF_GLSL = `
float dot2(vec2 v) { return dot(v, v); }

// ── Basic ──
float sdCircle2(vec2 p, float r) { return length(p) - r; }

float sdBox(in vec2 p, in vec2 b) {
  vec2 d = abs(p) - b;
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}
float sdRoundedBox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}
float sdChamferBox(in vec2 p, in vec2 b, in float chamfer) {
  p = abs(p) - b;
  p = (p.y > p.x) ? p.yx : p.xy;
  p.y += chamfer;
  float k = 1.0 - sqrt(2.0);
  if (p.y < 0.0 && p.y + p.x * k < 0.0) return p.x;
  if (p.x < p.y) return (p.x + p.y) * sqrt(0.5);
  return length(p);
}
float sdCross(in vec2 p, in vec2 b, float r) {
  p = abs(p); p = (p.y > p.x) ? p.yx : p.xy;
  vec2  q = p - b;
  float k = max(q.y, q.x);
  vec2  w = (k > 0.0) ? q : vec2(b.y - p.x, -k);
  return sign(k) * length(max(w, 0.0)) + r;
}
float sdRoundedX(in vec2 p, in float w, in float r) {
  p = abs(p);
  return length(p - min(p.x + p.y, w) * 0.5) - r;
}

// ── Polygons ──
float sdEquilateralTriangle(in vec2 p, in float r) {
  const float k = sqrt(3.0);
  p.x = abs(p.x) - r;
  p.y = p.y + r / k;
  if (p.x + k * p.y > 0.0) p = vec2(p.x - k * p.y, -k * p.x - p.y) / 2.0;
  p.x -= clamp(p.x, -2.0 * r, 0.0);
  return -length(p) * sign(p.y);
}
float sdTriangleIsosceles(in vec2 p, in vec2 q) {
  p.x = abs(p.x);
  vec2 a = p - q * clamp(dot(p, q) / dot(q, q), 0.0, 1.0);
  vec2 b = p - q * vec2(clamp(p.x / q.x, 0.0, 1.0), 1.0);
  float s = -sign(q.y);
  vec2 d = min(vec2(dot(a, a), s * (p.x * q.y - p.y * q.x)),
               vec2(dot(b, b), s * (p.y - q.y)));
  return -sqrt(d.x) * sign(d.y);
}
float sdRhombus(in vec2 p, in vec2 b) {
  b.y = -b.y;
  p = abs(p);
  float h = clamp((dot(b, p) + b.y * b.y) / dot(b, b), 0.0, 1.0);
  p -= b * vec2(h, h - 1.0);
  return length(p) * sign(p.x);
}
float sdTrapezoid(in vec2 p, in float r1, float r2, float he) {
  vec2 k1 = vec2(r2, he);
  vec2 k2 = vec2(r2 - r1, 2.0 * he);
  p.x = abs(p.x);
  vec2 ca = vec2(p.x - min(p.x, (p.y < 0.0) ? r1 : r2), abs(p.y) - he);
  vec2 cb = p - k1 + k2 * clamp(dot(k1 - p, k2) / dot2(k2), 0.0, 1.0);
  float s = (cb.x < 0.0 && ca.y < 0.0) ? -1.0 : 1.0;
  return s * sqrt(min(dot2(ca), dot2(cb)));
}
float sdParallelogram(in vec2 p, float wi, float he, float sk) {
  vec2 e = vec2(sk, he);
  p = (p.y < 0.0) ? -p : p;
  vec2 w = p - e; w.x -= clamp(w.x, -wi, wi);
  vec2 d = vec2(dot(w, w), -w.y);
  float s = p.x * e.y - p.y * e.x;
  p = (s < 0.0) ? -p : p;
  vec2 v = p - vec2(wi, 0.0);
  v -= e * clamp(dot(v, e) / dot(e, e), -1.0, 1.0);
  d = min(d, vec2(dot(v, v), wi * he - abs(s)));
  return sqrt(d.x) * sign(-d.y);
}

// ── Regular polygons ──
float sdPentagon(in vec2 p, in float r) {
  const vec3 k = vec3(0.809016994, 0.587785252, 0.726542528);
  p.x = abs(p.x);
  p -= 2.0 * min(dot(vec2(-k.x, k.y), p), 0.0) * vec2(-k.x, k.y);
  p -= 2.0 * min(dot(vec2( k.x, k.y), p), 0.0) * vec2( k.x, k.y);
  p -= vec2(clamp(p.x, -r * k.z, r * k.z), r);
  return length(p) * sign(p.y);
}
float sdHexagon(in vec2 p, in float r) {
  const vec3 k = vec3(-0.866025404, 0.5, 0.577350269);
  p = abs(p);
  p -= 2.0 * min(dot(k.xy, p), 0.0) * k.xy;
  p -= vec2(clamp(p.x, -k.z * r, k.z * r), r);
  return length(p) * sign(p.y);
}
float sdOctogon(in vec2 p, in float r) {
  const vec3 k = vec3(-0.9238795325, 0.3826834323, 0.4142135623);
  p = abs(p);
  p -= 2.0 * min(dot(vec2( k.x, k.y), p), 0.0) * vec2( k.x, k.y);
  p -= 2.0 * min(dot(vec2(-k.x, k.y), p), 0.0) * vec2(-k.x, k.y);
  p -= vec2(clamp(p.x, -k.z * r, k.z * r), r);
  return length(p) * sign(p.y);
}
float sdHexagram(in vec2 p, in float r) {
  const vec4 k = vec4(-0.5, 0.8660254038, 0.5773502692, 1.7320508076);
  p = abs(p);
  p -= 2.0 * min(dot(k.xy, p), 0.0) * k.xy;
  p -= 2.0 * min(dot(k.yx, p), 0.0) * k.yx;
  p -= vec2(clamp(p.x, r * k.z, r * k.w), r);
  return length(p) * sign(p.y);
}
float sdPentagram(in vec2 p, in float r) {
  const float k1x =  0.809016994;
  const float k2x =  0.309016994;
  const float k1y =  0.587785252;
  const float k2y =  0.951056516;
  const float k1z =  0.726542528;
  const vec2  v1  = vec2( k1x, -k1y);
  const vec2  v2  = vec2(-k1x, -k1y);
  const vec2  v3  = vec2( k2x, -k2y);
  p.x = abs(p.x);
  p -= 2.0 * max(dot(v1, p), 0.0) * v1;
  p -= 2.0 * max(dot(v2, p), 0.0) * v2;
  p.x = abs(p.x);
  p.y -= r;
  return length(p - v3 * clamp(dot(p, v3), 0.0, k1z * r)) * sign(p.y * v3.x - p.x * v3.y);
}

// ── Stars ──
float sdStar5(vec2 p, float r, float rf) {
  const vec2 k1 = vec2( 0.809016994375, -0.587785252192);
  const vec2 k2 = vec2(-0.809016994375, -0.587785252192);
  p.x = abs(p.x);
  p -= 2.0 * max(dot(k1, p), 0.0) * k1;
  p -= 2.0 * max(dot(k2, p), 0.0) * k2;
  p.x = abs(p.x);
  p.y -= r;
  vec2 ba = rf * vec2(-k1.y, k1.x) - vec2(0.0, 1.0);
  float h = clamp(dot(p, ba) / dot(ba, ba), -r, 0.0);
  return length(p - ba * h) * sign(p.x * ba.y - p.y * ba.x);
}
float sdStarN(in vec2 p, in float r, in float nf, in float m) {
  float an = 3.141593 / nf;
  float en = 3.141593 / m;
  vec2 acs = vec2(cos(an), sin(an));
  vec2 ecs = vec2(cos(en), sin(en));
  float bn = mod(atan(p.x, p.y), 2.0 * an) - an;
  p = length(p) * vec2(cos(bn), abs(sin(bn)));
  p -= r * acs;
  p += ecs * clamp(-dot(p, ecs), 0.0, r * acs.y / ecs.y);
  return length(p) * sign(p.x);
}

// ── Segments / curves ──
float sdSegment(in vec2 p, in vec2 a, in vec2 b) {
  vec2 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h);
}
float sdEllipse(in vec2 p, in vec2 ab) {
  p = abs(p);
  if (p.x > p.y) { p = p.yx; ab = ab.yx; }
  float l  = ab.y * ab.y - ab.x * ab.x;
  float m  = ab.x * p.x / l;   float m2 = m * m;
  float n  = ab.y * p.y / l;   float n2 = n * n;
  float c  = (m2 + n2 - 1.0) / 3.0;
  float c3 = c * c * c;
  float q  = c3 + m2 * n2 * 2.0;
  float d  = c3 + m2 * n2;
  float g  = m + m * n2;
  float co;
  if (d < 0.0) {
    float h2 = acos(q / c3) / 3.0;
    float s  = cos(h2);
    float t  = sin(h2) * sqrt(3.0);
    float rx = sqrt(-c * (s + t + 2.0) + m2);
    float ry = sqrt(-c * (s - t + 2.0) + m2);
    co = (ry + sign(l) * rx + abs(g) / (rx * ry) - m) / 2.0;
  } else {
    float hh = 2.0 * m * n * sqrt(d);
    float s  = sign(q + hh) * pow(abs(q + hh), 1.0 / 3.0);
    float u  = sign(q - hh) * pow(abs(q - hh), 1.0 / 3.0);
    float rx = -s - u - c * 4.0 + 2.0 * m2;
    float ry = (s - u) * sqrt(3.0);
    float rm = sqrt(rx * rx + ry * ry);
    co = (ry / sqrt(rm - rx) + 2.0 * g / rm - m) / 2.0;
  }
  vec2 rr = ab * vec2(co, sqrt(1.0 - co * co));
  return length(rr - p) * sign(p.y - rr.y);
}
float sdParabola(in vec2 pos, in float k) {
  pos.x = abs(pos.x);
  float ik = 1.0 / k;
  float pp = ik * (pos.y - 0.5 * ik) / 3.0;
  float q  = 0.25 * ik * ik * pos.x;
  float h  = q * q - pp * pp * pp;
  float x;
  if (h > 0.0) {
    float r = pow(q + sqrt(h), 1.0 / 3.0);
    x = r + pp / r;
  } else {
    float r = sqrt(pp);
    x = 2.0 * r * cos(acos(q / (pp * r)) / 3.0);
  }
  return length(pos - vec2(x, k * x * x)) * sign(pos.x - x);
}
float sdParabolaSeg(in vec2 pos, in float wi, in float he) {
  pos.x = abs(pos.x);
  float ik = wi * wi / he;
  float pp = ik * (he - pos.y - 0.5 * ik) / 3.0;
  float q  = pos.x * ik * ik / 4.0;
  float h  = q * q - pp * pp * pp;
  float x;
  if (h > 0.0) {
    float r = pow(q + sqrt(h), 1.0 / 3.0);
    x = r + pp / r;
  } else {
    float r = sqrt(pp);
    x = 2.0 * r * cos(acos(q / (pp * r)) / 3.0);
  }
  x = min(x, wi);
  return length(pos - vec2(x, he - x * x / ik)) * sign(ik * (pos.y - he) + pos.x * pos.x);
}
float sdHyperbola(in vec2 p, in float k, in float he) {
  p = abs(p);
  p = vec2(p.x - p.y, p.x + p.y) / sqrt(2.0);
  float x2 = p.x * p.x / 16.0;
  float y2 = p.y * p.y / 16.0;
  float r  = k * (4.0 * k - p.x * p.y) / 12.0;
  float q  = (x2 - y2) * k * k;
  float h  = q * q + r * r * r;
  float u;
  if (h < 0.0) {
    float m2 = sqrt(-r);
    u = m2 * cos(acos(q / (r * m2)) / 3.0);
  } else {
    float mv = sqrt(h) - q;
    float m2 = mv >= 0.0 ? pow(mv, 1.0 / 3.0) : -pow(-mv, 1.0 / 3.0);
    u = (m2 - r / m2) / 2.0;
  }
  float w  = sqrt(u + x2);
  float b  = k * p.y - x2 * p.x * 2.0;
  float t  = p.x / 4.0 - w + sqrt(2.0 * x2 - u + b / w / 4.0);
  t = max(t, sqrt(he * he * 0.5 + k) - he / sqrt(2.0));
  float dist = length(p - vec2(t, k / t));
  return p.x * p.y < k ? dist : -dist;
}

// ── Capsules / arcs ──
float sdUnevenCapsule(in vec2 p, in float r1, in float r2, in float h) {
  p.x = abs(p.x);
  float b = (r1 - r2) / h;
  float a = sqrt(1.0 - b * b);
  float k = dot(p, vec2(-b, a));
  if (k < 0.0) return length(p) - r1;
  if (k > a * h) return length(p - vec2(0.0, h)) - r2;
  return dot(p, vec2(a, b)) - r1;
}
float sdCutDisk(in vec2 p, in float r, in float h) {
  float w = sqrt(r * r - h * h);
  p.x = abs(p.x);
  float s = max((h - r) * p.x * p.x + w * w * (h + r - 2.0 * p.y),
                h * p.x - w * p.y);
  return (s < 0.0)  ? length(p) - r :
         (p.x < w)  ? h - p.y       :
                      length(p - vec2(w, h));
}
float sdPie(in vec2 p, in vec2 c, in float r) {
  p.x = abs(p.x);
  float l = length(p) - r;
  float m = length(p - c * clamp(dot(p, c), 0.0, r));
  return max(l, m * sign(c.y * p.x - c.x * p.y));
}
float sdArc(in vec2 p, in vec2 sc, in float ra, float rb) {
  p.x = abs(p.x);
  return ((sc.y * p.x > sc.x * p.y) ? length(p - sc * ra) :
                                       abs(length(p) - ra)) - rb;
}
float sdRing2(in vec2 p, in vec2 n, in float r, float th) {
  p.x = abs(p.x);
  p = mat2(n.x, n.y, -n.y, n.x) * p;
  return max(abs(length(p) - r) - th * 0.5,
             length(vec2(p.x, max(0.0, abs(r - p.y) - th * 0.5))) * sign(p.x));
}
float sdVesicaShape(in vec2 p, in float w, in float h) {
  float d = 0.5 * (w * w - h * h) / h;
  p = abs(p);
  vec3 c = (w * p.y < d * (p.x - w)) ? vec3(0.0, w, 0.0) : vec3(-d, 0.0, d + h);
  return length(p - c.yx) - c.z;
}
float sdMoon(in vec2 p, in float d, in float ra, in float rb) {
  p.y = abs(p.y);
  float a = (ra * ra - rb * rb + d * d) / (2.0 * d);
  float b = sqrt(max(ra * ra - a * a, 0.0));
  if (d * (p.x * b - p.y * a) > d * d * max(b - p.y, 0.0))
    return length(p - vec2(a, b));
  return max(length(p) - ra, -(length(p - vec2(d, 0.0)) - rb));
}
float sdHorseshoe(in vec2 p, in vec2 c, in float r, in vec2 w) {
  p.x = abs(p.x);
  float l = length(p);
  p = mat2(-c.x, c.y, c.y, c.x) * p;
  p = vec2((p.y > 0.0 || p.x > 0.0) ? p.x : l * sign(-c.x),
           (p.x > 0.0) ? p.y : l);
  p = vec2(p.x, abs(p.y - r)) - w;
  return length(max(p, 0.0)) + min(0.0, max(p.x, p.y));
}

// ── Organic / special ──
float sdRoundedCross(in vec2 p, in float h) {
  float k = 0.5 * (h + 1.0 / h);
  p = abs(p);
  return (p.x < 1.0 && p.y < p.x * (k - h) + h)
    ? k - sqrt(dot2(p - vec2(1.0, k)))
    : sqrt(min(dot2(p - vec2(0.0, h)),
               dot2(p - vec2(1.0, 0.0))));
}
float sdBlobbyCross(in vec2 pos, float he) {
  pos = abs(pos);
  pos = vec2(abs(pos.x - pos.y), 1.0 - pos.x - pos.y) / sqrt(2.0);
  float pp = (he - pos.y - 0.25 / he) / (6.0 * he);
  float q  = pos.x / (he * he * 16.0);
  float h  = q * q - pp * pp * pp;
  float x;
  if (h > 0.0) {
    float rr = sqrt(h);
    x = pow(q + rr, 1.0 / 3.0) - pow(abs(q - rr), 1.0 / 3.0) * sign(rr - q);
  } else {
    float rr = sqrt(pp);
    x = 2.0 * rr * cos(acos(q / (pp * rr)) / 3.0);
  }
  x = min(x, sqrt(2.0) / 2.0);
  vec2 z = vec2(x, he * (1.0 - 2.0 * x * x)) - pos;
  return length(z) * sign(z.y);
}
float sdTunnel(in vec2 p, in vec2 wh) {
  p.x = abs(p.x); p.y = -p.y;
  vec2 q  = p - wh;
  float d1 = dot2(vec2(max(q.x, 0.0), q.y));
  q.x = (p.y > 0.0) ? q.x : length(p) - wh.x;
  float d2 = dot2(vec2(q.x, max(q.y, 0.0)));
  float d  = sqrt(min(d1, d2));
  return (max(q.x, q.y) < 0.0) ? -d : d;
}
float sdStairs(in vec2 p, in vec2 wh, in float n) {
  vec2 ba = wh * n;
  float d = min(dot2(p - vec2(clamp(p.x, 0.0, ba.x), 0.0)),
                dot2(p - vec2(ba.x, clamp(p.y, 0.0, ba.y))));
  float s = sign(max(-p.y, p.x - ba.x));
  float dia = length(wh);
  p = mat2(wh.x, -wh.y, wh.y, wh.x) * p / dia;
  float id = clamp(floor(p.x / dia + 0.5), 0.0, n - 1.0);
  p.x = p.x - id * dia;
  p = mat2(wh.x, wh.y, -wh.y, wh.x) * p / dia;
  float hh = wh.y / 2.0;
  p.y -= hh;
  if (p.y > hh * sign(p.x)) s = 1.0;
  p = (id < 0.5 || p.x > 0.0) ? p : -p;
  d = min(d, dot2(p - vec2(0.0, clamp(p.y, -hh, hh))));
  d = min(d, dot2(p - vec2(clamp(p.x, 0.0, wh.x), hh)));
  return sqrt(d) * s;
}
float sdHeart(in vec2 p) {
  p.x = abs(p.x);
  if (p.y + p.x > 1.0)
    return sqrt(dot2(p - vec2(0.25, 0.75))) - sqrt(2.0) / 4.0;
  return sqrt(min(dot2(p - vec2(0.0, 1.0)),
                  dot2(p - 0.5 * max(p.x + p.y, 0.0)))) * sign(p.x - p.y);
}
float sdQuadraticCircle(in vec2 p) {
  p = abs(p); if (p.y > p.x) p = p.yx;
  float a = p.x - p.y;
  float b = p.x + p.y;
  float c = (2.0 * b - 1.0) / 3.0;
  float h = a * a + c * c * c;
  float t;
  if (h >= 0.0) {
    h = sqrt(h);
    t = sign(h - a) * pow(abs(h - a), 1.0 / 3.0) - pow(h + a, 1.0 / 3.0);
  } else {
    float z = sqrt(-c);
    float v = acos(a / (c * z)) / 3.0;
    t = -z * (cos(v) + sin(v) * 1.732050808);
  }
  t *= 0.5;
  vec2 w = vec2(-t, t) + 0.75 - t * t - p;
  return length(w) * sign(a * a * 0.5 + b - 1.5);
}
float sdCoolS(in vec2 p) {
  float six = (p.y < 0.0) ? -p.x : p.x;
  p.x = abs(p.x);
  p.y = abs(p.y) - 0.2;
  float rex = p.x - min(floor(p.x / 0.4 + 0.5), 0.4);
  float aby = abs(p.y - 0.2) - 0.6;
  float d = dot2(vec2(six, -p.y) - clamp(0.5 * (six - p.y), 0.0, 0.2));
  d = min(d, dot2(vec2(p.x, -aby) - clamp(0.5 * (p.x - aby), 0.0, 0.4)));
  d = min(d, dot2(vec2(rex, p.y - clamp(p.y, 0.0, 0.4))));
  float s = 2.0 * p.x + aby + abs(aby + 0.4) - 0.4;
  return sqrt(d) * sign(s);
}
float sdCircleWave(in vec2 p, in float tb, in float ra) {
  tb = 3.1415927 * 5.0 / 6.0 * max(tb, 0.0001);
  vec2 co = ra * vec2(sin(tb), cos(tb));
  p.x = abs(mod(p.x, co.x * 4.0) - co.x * 2.0);
  vec2 p1 = p;
  vec2 p2 = vec2(abs(p.x - 2.0 * co.x), -p.y + 2.0 * co.y);
  float d1 = ((co.y * p1.x > co.x * p1.y) ? length(p1 - co) : abs(length(p1) - ra));
  float d2 = ((co.y * p2.x > co.x * p2.y) ? length(p2 - co) : abs(length(p2) - ra));
  return min(d1, d2);
}
`;

// ─── Shape SDF Node ───────────────────────────────────────────────────────────
// All shapes in one dropdown — irrelevant params hidden via showWhen.

// Shapes that show each param group:
const WITH_R    = ['circle','pentagon','octagon','hexagram','pentagram','triangle','hexagon','star5','starN','pie','ring','unevenCapsule','cutDisk','moon','arc','horseshoe','circleWave','roundedCross'];
const WITH_R2   = ['unevenCapsule','moon','trapezoid'];
const WITH_RXRY = ['box','roundedBox','chamferBox','cross','rhombus','ellipse','tunnel','stairs','isoTriangle','horseshoe','vesica','roundedX'];
const WITH_RY   = ['box','roundedBox','chamferBox','cross','rhombus','ellipse','tunnel','stairs'];
const WITH_RND  = ['roundedBox','cross','roundedX'];
const WITH_RF   = ['star5'];
const WITH_TH   = ['ring','arc'];
const WITH_N    = ['ring'];
const WITH_CXY  = ['pie','arc','horseshoe'];
const WITH_HE   = ['isoTriangle','unevenCapsule','trapezoid','parallelogram','parabolaSeg','blobbyCross','vesica'];
const WITH_SK   = ['parallelogram'];
const WITH_K    = ['parabola','hyperbola'];
const WITH_D    = ['moon'];
const WITH_TB   = ['circleWave'];
const WITH_NPTS = ['starN','stairs'];
const WITH_MPTS = ['starN'];
const WITH_CHF  = ['chamferBox'];

export const ShapeSDFNode: NodeDefinition = {
  type: 'shapeSDF',
  label: 'Shape SDF',
  category: '2D Primitives',
  description: 'Exact signed distance function — pick any of 35 IQ primitives from the dropdown.',
  inputs: {
    p:  { type: 'vec2',  label: 'Position' },
    r:  { type: 'float', label: 'Radius / Size' },
    b:  { type: 'vec2',  label: 'Half-size (box)' },
    a:  { type: 'vec2',  label: 'Point A (segment)' },
    b2: { type: 'vec2',  label: 'Point B (segment)' },
    rf: { type: 'float', label: 'Inner ratio (star5)' },
    c:  { type: 'vec2',  label: 'Angle vec (pie/arc)' },
    th: { type: 'float', label: 'Thickness (ring/arc)' },
    n:  { type: 'vec2',  label: 'Normal (ring)' },
  },
  outputs: { distance: { type: 'float', label: 'Distance' } },
  defaultParams: {
    shape: 'circle',
    // radius
    r: 0.3, r2: 0.15,
    // box half-sizes
    rx: 0.3, ry: 0.3,
    // style
    roundness: 0.05, chamfer: 0.05, rf: 0.5,
    // ring / arc
    th: 0.05, nx: 0.0, ny: 1.0,
    // pie / arc / horseshoe angle
    cx: 0.866, cy: 0.5,
    // various heights / widths
    he: 0.3, sk: 0.2,
    // parabola / hyperbola
    k: 2.0,
    // moon separation
    d: 0.3,
    // circle wave
    tb: 0.5,
    // star N
    n_pts: 5.0, m_pts: 2.0,
  },
  paramDefs: {
    shape: {
      label: 'Shape', type: 'select',
      options: [
        // Basic
        { value: 'circle',        label: 'Circle'           },
        { value: 'heart',         label: 'Heart'            },
        { value: 'roundedCross',  label: 'Circle Cross'     },
        { value: 'quadCircle',    label: 'Quadratic Circle' },
        { value: 'coolS',         label: 'Cool S'           },
        // Boxes
        { value: 'box',           label: 'Box'              },
        { value: 'roundedBox',    label: 'Rounded Box'      },
        { value: 'chamferBox',    label: 'Chamfer Box'      },
        { value: 'cross',         label: 'Cross'            },
        { value: 'roundedX',      label: 'Rounded X'        },
        // Polygons
        { value: 'triangle',      label: 'Equilateral Triangle' },
        { value: 'isoTriangle',   label: 'Isosceles Triangle'   },
        { value: 'pentagon',      label: 'Pentagon'         },
        { value: 'hexagon',       label: 'Hexagon'          },
        { value: 'octagon',       label: 'Octagon'          },
        { value: 'hexagram',      label: 'Hexagram'         },
        { value: 'pentagram',     label: 'Pentagram'        },
        { value: 'rhombus',       label: 'Rhombus'          },
        { value: 'trapezoid',     label: 'Trapezoid'        },
        { value: 'parallelogram', label: 'Parallelogram'    },
        // Stars
        { value: 'star5',         label: 'Star (5-pt)'      },
        { value: 'starN',         label: 'Star (N-pt)'      },
        // Curves & segments
        { value: 'segment',       label: 'Segment'          },
        { value: 'ellipse',       label: 'Ellipse'          },
        { value: 'parabola',      label: 'Parabola'         },
        { value: 'parabolaSeg',   label: 'Parabola Segment' },
        { value: 'hyperbola',     label: 'Hyperbola'        },
        // Arcs / rings / slices
        { value: 'pie',           label: 'Pie'              },
        { value: 'arc',           label: 'Arc'              },
        { value: 'ring',          label: 'Ring'             },
        { value: 'circleWave',    label: 'Circle Wave'      },
        // Compound
        { value: 'unevenCapsule', label: 'Uneven Capsule'   },
        { value: 'cutDisk',       label: 'Cut Disk'         },
        { value: 'moon',          label: 'Moon'             },
        { value: 'vesica',        label: 'Vesica'           },
        { value: 'horseshoe',     label: 'Horseshoe'        },
        // Structural
        { value: 'tunnel',        label: 'Tunnel'           },
        { value: 'stairs',        label: 'Stairs'           },
        // Decorative
        { value: 'blobbyCross',   label: 'Bobbly Cross'     },
      ],
    },
    r:        { label: 'Radius',       type: 'float', min: 0.01, max: 2.0,  step: 0.01,  showWhen: { param: 'shape', value: WITH_R    } },
    r2:       { label: 'Radius 2',     type: 'float', min: 0.01, max: 2.0,  step: 0.01,  showWhen: { param: 'shape', value: WITH_R2   } },
    rx:       { label: 'Width / 2',    type: 'float', min: 0.01, max: 2.0,  step: 0.01,  showWhen: { param: 'shape', value: WITH_RXRY } },
    ry:       { label: 'Height / 2',   type: 'float', min: 0.01, max: 2.0,  step: 0.01,  showWhen: { param: 'shape', value: WITH_RY   } },
    roundness:{ label: 'Roundness',    type: 'float', min: 0.0,  max: 0.5,  step: 0.005, showWhen: { param: 'shape', value: WITH_RND  } },
    chamfer:  { label: 'Chamfer',      type: 'float', min: 0.0,  max: 0.5,  step: 0.005, showWhen: { param: 'shape', value: WITH_CHF  } },
    rf:       { label: 'Inner ratio',  type: 'float', min: 0.1,  max: 0.9,  step: 0.01,  showWhen: { param: 'shape', value: WITH_RF   } },
    th:       { label: 'Thickness',    type: 'float', min: 0.001,max: 0.5,  step: 0.001, showWhen: { param: 'shape', value: WITH_TH   } },
    nx:       { label: 'Normal X',     type: 'float', min: -1.0, max: 1.0,  step: 0.01,  showWhen: { param: 'shape', value: WITH_N    } },
    ny:       { label: 'Normal Y',     type: 'float', min: -1.0, max: 1.0,  step: 0.01,  showWhen: { param: 'shape', value: WITH_N    } },
    cx:       { label: 'Angle cos',    type: 'float', min: -1.0, max: 1.0,  step: 0.01,  showWhen: { param: 'shape', value: WITH_CXY  } },
    cy:       { label: 'Angle sin',    type: 'float', min: -1.0, max: 1.0,  step: 0.01,  showWhen: { param: 'shape', value: WITH_CXY  } },
    he:       { label: 'Height',       type: 'float', min: 0.01, max: 2.0,  step: 0.01,  showWhen: { param: 'shape', value: WITH_HE   } },
    sk:       { label: 'Skew',         type: 'float', min: -1.0, max: 1.0,  step: 0.01,  showWhen: { param: 'shape', value: WITH_SK   } },
    k:        { label: 'Curvature',    type: 'float', min: 0.1,  max: 5.0,  step: 0.05,  showWhen: { param: 'shape', value: WITH_K    } },
    d:        { label: 'Distance',     type: 'float', min: 0.0,  max: 2.0,  step: 0.01,  showWhen: { param: 'shape', value: WITH_D    } },
    tb:       { label: 'Wave',         type: 'float', min: 0.01, max: 1.0,  step: 0.01,  showWhen: { param: 'shape', value: WITH_TB   } },
    n_pts:    { label: 'Count / Pts',  type: 'float', min: 3.0,  max: 12.0, step: 1.0,   showWhen: { param: 'shape', value: WITH_NPTS } },
    m_pts:    { label: 'Inner pts',    type: 'float', min: 2.0,  max: 6.0,  step: 0.1,   showWhen: { param: 'shape', value: WITH_MPTS } },
  },
  glslFunction: SHAPE_SDF_GLSL,
  generateGLSL: (node: GraphNode, inputVars) => {
    const outVar = `${node.id}_distance`;
    const posVar = inputVars.p  ?? 'vec2(0.0)';
    const shape  = (node.params.shape as string) ?? 'circle';

    // Resolve all params
    const r    = inputVars.r  ?? p(node.params.r,  0.3);
    const r2   = p(node.params.r2,  0.15);
    const rx   = p(node.params.rx,  0.3);
    const ry   = p(node.params.ry,  0.3);
    const rnd  = p(node.params.roundness, 0.05);
    const chf  = p(node.params.chamfer,   0.05);
    const rf   = inputVars.rf ?? p(node.params.rf, 0.5);
    const th   = inputVars.th ?? p(node.params.th, 0.05);
    const nx   = p(node.params.nx, 0.0);
    const ny   = p(node.params.ny, 1.0);
    const cx   = p(node.params.cx, 0.866);
    const cy   = p(node.params.cy, 0.5);
    const he   = p(node.params.he, 0.3);
    const sk   = p(node.params.sk, 0.2);
    const k    = p(node.params.k,  2.0);
    const d    = p(node.params.d,  0.3);
    const tb   = p(node.params.tb, 0.5);
    const npts = p(node.params.n_pts, 5.0);
    const mpts = p(node.params.m_pts, 2.0);

    const bVec  = inputVars.b  ?? `vec2(${rx}, ${ry})`;
    const aVec  = inputVars.a  ?? 'vec2(-0.5, 0.0)';
    const b2Vec = inputVars.b2 ?? 'vec2( 0.5, 0.0)';
    const cVec  = inputVars.c  ?? `vec2(${cx}, ${cy})`;
    const nVec  = inputVars.n  ?? `vec2(${nx}, ${ny})`;

    let call: string;
    switch (shape) {
      // Basic
      case 'heart':         call = `sdHeart(${posVar})`;                                              break;
      case 'roundedCross':  call = `sdRoundedCross(${posVar}, ${he})`;                                break;
      case 'quadCircle':    call = `sdQuadraticCircle(${posVar})`;                                    break;
      case 'coolS':         call = `sdCoolS(${posVar})`;                                              break;
      // Boxes
      case 'box':           call = `sdBox(${posVar}, ${bVec})`;                                       break;
      case 'roundedBox':    call = `sdRoundedBox(${posVar}, ${bVec}, ${rnd})`;                        break;
      case 'chamferBox':    call = `sdChamferBox(${posVar}, ${bVec}, ${chf})`;                        break;
      case 'cross':         call = `sdCross(${posVar}, ${bVec}, ${rnd})`;                             break;
      case 'roundedX':      call = `sdRoundedX(${posVar}, ${rx}, ${rnd})`;                            break;
      // Polygons
      case 'triangle':      call = `sdEquilateralTriangle(${posVar}, ${r})`;                          break;
      case 'isoTriangle':   call = `sdTriangleIsosceles(${posVar}, vec2(${rx}, ${he}))`;              break;
      case 'pentagon':      call = `sdPentagon(${posVar}, ${r})`;                                     break;
      case 'hexagon':       call = `sdHexagon(${posVar}, ${r})`;                                      break;
      case 'octagon':       call = `sdOctogon(${posVar}, ${r})`;                                      break;
      case 'hexagram':      call = `sdHexagram(${posVar}, ${r})`;                                     break;
      case 'pentagram':     call = `sdPentagram(${posVar}, ${r})`;                                    break;
      case 'rhombus':       call = `sdRhombus(${posVar}, ${bVec})`;                                   break;
      case 'trapezoid':     call = `sdTrapezoid(${posVar}, ${r}, ${r2}, ${he})`;                      break;
      case 'parallelogram': call = `sdParallelogram(${posVar}, ${rx}, ${he}, ${sk})`;                 break;
      // Stars
      case 'star5':         call = `sdStar5(${posVar}, ${r}, ${rf})`;                                 break;
      case 'starN':         call = `sdStarN(${posVar}, ${r}, ${npts}, ${mpts})`;                      break;
      // Curves & segments
      case 'segment':       call = `sdSegment(${posVar}, ${aVec}, ${b2Vec})`;                         break;
      case 'ellipse':       call = `sdEllipse(${posVar}, ${bVec})`;                                   break;
      case 'parabola':      call = `sdParabola(${posVar}, ${k})`;                                     break;
      case 'parabolaSeg':   call = `sdParabolaSeg(${posVar}, ${rx}, ${he})`;                          break;
      case 'hyperbola':     call = `sdHyperbola(${posVar}, ${k}, ${he})`;                             break;
      // Arcs / rings
      case 'pie':           call = `sdPie(${posVar}, ${cVec}, ${r})`;                                 break;
      case 'arc':           call = `sdArc(${posVar}, ${cVec}, ${r}, ${th})`;                          break;
      case 'ring':          call = `sdRing2(${posVar}, ${nVec}, ${r}, ${th})`;                        break;
      case 'circleWave':    call = `sdCircleWave(${posVar}, ${tb}, ${r})`;                            break;
      // Compound
      case 'unevenCapsule': call = `sdUnevenCapsule(${posVar}, ${r}, ${r2}, ${he})`;                  break;
      case 'cutDisk':       call = `sdCutDisk(${posVar}, ${r}, ${he})`;                               break;
      case 'moon':          call = `sdMoon(${posVar}, ${d}, ${r}, ${r2})`;                            break;
      case 'vesica':        call = `sdVesicaShape(${posVar}, ${rx}, ${he})`;                          break;
      case 'horseshoe':     call = `sdHorseshoe(${posVar}, ${cVec}, ${r}, vec2(${rx}, ${ry}))`;       break;
      // Structural
      case 'tunnel':        call = `sdTunnel(${posVar}, ${bVec})`;                                    break;
      case 'stairs':        call = `sdStairs(${posVar}, ${bVec}, ${npts})`;                           break;
      // Decorative
      case 'blobbyCross':   call = `sdBlobbyCross(${posVar}, ${he})`;                                 break;
      // Default
      default:              call = `sdCircle2(${posVar}, ${r})`;                                      break;
    }

    return {
      code: `    float ${outVar} = ${call};\n`,
      outputVars: { distance: outVar },
    };
  },
};

// ─── Simple SDF Node (quick 3-shape picker) ───────────────────────────────────

export const SimpleSDFNode: NodeDefinition = {
  type: 'simpleSDF',
  label: 'Simple SDF',
  category: '2D Primitives',
  description: 'Fast SDF for circle, box, or ring — each with just 1–2 clean params.',
  inputs: {
    p: { type: 'vec2',  label: 'Position' },
    r: { type: 'float', label: 'Radius'   },
    b: { type: 'vec2',  label: 'Half-size (box)' },
  },
  outputs: { distance: { type: 'float', label: 'Distance' } },
  glslFunction: SHAPE_SDF_GLSL,
  defaultParams: { shape: 'circle', r: 0.3, wx: 0.3, wy: 0.3 },
  paramDefs: {
    shape: {
      label: 'Shape', type: 'select',
      options: [
        { value: 'circle', label: 'Circle' },
        { value: 'box',    label: 'Box'    },
        { value: 'ring',   label: 'Ring'   },
      ],
    },
    r:  { label: 'Radius',   type: 'float', min: 0.01, max: 2.0, step: 0.01, showWhen: { param: 'shape', value: ['circle','ring'] } },
    wx: { label: 'Width/2',  type: 'float', min: 0.01, max: 2.0, step: 0.01, showWhen: { param: 'shape', value: 'box' } },
    wy: { label: 'Height/2', type: 'float', min: 0.01, max: 2.0, step: 0.01, showWhen: { param: 'shape', value: 'box' } },
  },
  generateGLSL: (node: GraphNode, inputVars) => {
    const outVar = `${node.id}_distance`;
    const posVar = inputVars.p ?? 'vec2(0.0)';
    const shape  = (node.params.shape as string) ?? 'circle';
    const r      = inputVars.r ?? p(node.params.r, 0.3);
    const wx     = p(node.params.wx, 0.3);
    const wy     = p(node.params.wy, 0.3);
    const bVec   = inputVars.b ?? `vec2(${wx}, ${wy})`;

    let call: string;
    switch (shape) {
      case 'box':  call = `sdBox(${posVar}, ${bVec})`;     break;
      case 'ring': call = `abs(length(${posVar}) - ${r})`; break;
      default:     call = `length(${posVar}) - ${r}`;      break;
    }
    return {
      code: `    float ${outVar} = ${call};\n`,
      outputVars: { distance: outVar },
    };
  },
};
