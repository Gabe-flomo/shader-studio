/**
 * Noise (docs/noise-node.md): one node for the classic noises, Blender's Noise Texture style. Kind (Perlin, Simplex,
 * Value, Worley) and Dimensions (2D, 3D, 4D) pick the helper functions, so changing them recompiles; every slider
 * (Scale, Detail, Roughness, Lacunarity, Distortion, Speed, Offset) is a live uniform and a socket you can wire.
 *
 * 3D and 4D spend their extra axes on time: 3D moves through the noise along z (Time × Speed), 4D goes round a
 * circle in z and w, so the picture changes in place and repeats exactly every 6.28 ÷ Speed seconds.
 *
 * The helpers are emitted per Kind and Dimensions (glslFunctionsFor), de-duplicated by the assembler, so two Noise
 * nodes of the same Kind share them. Colour and Slope call the noise again at other points (two more calls each); they
 * are plain locals, so a GPU compiler drops them when nothing reads them, and several readers share one computation.
 */
import type { NodeDefinition, GraphNode } from '../../types/nodeGraph';
import { p, withParamSockets } from './helpers';

export type NoiseKind = 'perlin' | 'simplex' | 'value' | 'worley';
export type NoiseDims = '2d' | '3d' | '4d';
export const NOISE_KINDS: readonly NoiseKind[] = ['perlin', 'simplex', 'value', 'worley'];
export const NOISE_DIMS: readonly NoiseDims[] = ['2d', '3d', '4d'];

/** The most octaves Detail reaches (Detail 8 = 9 octaves); the fractal loop's constant bound. */
export const NOISE_MAX_DETAIL = 8;

const KIND_NAME: Record<NoiseKind, string> = { perlin: 'Perlin', simplex: 'Simplex', value: 'Value', worley: 'Worley' };
const DIM_N: Record<NoiseDims, 2 | 3 | 4> = { '2d': 2, '3d': 3, '4d': 4 };
const vecT = (d: 2 | 3 | 4) => `vec${d}`;

const kindOf = (node: GraphNode): NoiseKind => (NOISE_KINDS.includes(node.params.kind as NoiseKind) ? node.params.kind as NoiseKind : 'perlin');
const dimsOf = (node: GraphNode): NoiseDims => (NOISE_DIMS.includes(node.params.dims as NoiseDims) ? node.params.dims as NoiseDims : '3d');

// ── Shared pieces ────────────────────────────────────────────────────────────

// Permutation polynomial helpers from Ashima Arts / Stefan Gustavson's webgl-noise (MIT licence,
// https://github.com/ashima/webgl-noise and https://github.com/stegu/webgl-noise).
const GLSL_PERMUTE = `vec2 nzMod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec3 nzMod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 nzMod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
float nzMod289(float x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec3 nzPermute(vec3 x) { return nzMod289(((x * 34.0) + 10.0) * x); }
vec4 nzPermute(vec4 x) { return nzMod289(((x * 34.0) + 10.0) * x); }
float nzPermute(float x) { return nzMod289(((x * 34.0) + 10.0) * x); }
vec4 nzTaylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
float nzTaylorInvSqrt(float r) { return 1.79284291400159 - 0.85373472095314 * r; }
vec2 nzFade(vec2 t) { return t * t * t * (t * (t * 6.0 - 15.0) + 10.0); }
vec3 nzFade(vec3 t) { return t * t * t * (t * (t * 6.0 - 15.0) + 10.0); }
vec4 nzFade(vec4 t) { return t * t * t * (t * (t * 6.0 - 15.0) + 10.0); }`;

// Hashes without sine (Dave Hoskins, "Hash without Sine", MIT licence, https://www.shadertoy.com/view/4djSRW):
// steady on every GPU, unlike fract(sin(…)).
const GLSL_HASH = `float nzHash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float nzHash13(vec3 p3) { p3 = fract(p3 * 0.1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
float nzHash14(vec4 p4) { p4 = fract(p4 * vec4(0.1031, 0.1030, 0.0973, 0.1099)); p4 += dot(p4, p4.wzxy + 33.33); return fract((p4.x + p4.y) * (p4.z + p4.w)); }
vec2 nzHash22(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
vec3 nzHash33(vec3 p3) { p3 = fract(p3 * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yxz + 33.33); return fract((p3.xxy + p3.yxx) * p3.zyx); }
vec4 nzHash44(vec4 p4) { p4 = fract(p4 * vec4(0.1031, 0.1030, 0.0973, 0.1099)); p4 += dot(p4, p4.wzxy + 33.33); return fract((p4.xxyz + p4.yzzw) * p4.zywx); }`;

// ── Perlin (gradient) ────────────────────────────────────────────────────────
// 2D and 3D: classic Perlin noise as in webgl-noise (Stefan Gustavson, MIT licence). 4D: the same idea written as a
// loop over the 16 corners of the cell, each with a hashed unit gradient. All return about −1…1.

const GLSL_PERLIN: Record<2 | 3 | 4, string> = {
  2: `float nzPerlin2(vec2 P) {
    vec4 Pi = floor(P.xyxy) + vec4(0.0, 0.0, 1.0, 1.0);
    vec4 Pf = fract(P.xyxy) - vec4(0.0, 0.0, 1.0, 1.0);
    Pi = nzMod289(Pi);
    vec4 ix = Pi.xzxz; vec4 iy = Pi.yyww;
    vec4 fx = Pf.xzxz; vec4 fy = Pf.yyww;
    vec4 i = nzPermute(nzPermute(ix) + iy);
    vec4 gx = fract(i * (1.0 / 41.0)) * 2.0 - 1.0;
    vec4 gy = abs(gx) - 0.5;
    vec4 tx = floor(gx + 0.5);
    gx = gx - tx;
    vec2 g00 = vec2(gx.x, gy.x); vec2 g10 = vec2(gx.y, gy.y);
    vec2 g01 = vec2(gx.z, gy.z); vec2 g11 = vec2(gx.w, gy.w);
    vec4 norm = nzTaylorInvSqrt(vec4(dot(g00, g00), dot(g01, g01), dot(g10, g10), dot(g11, g11)));
    g00 *= norm.x; g01 *= norm.y; g10 *= norm.z; g11 *= norm.w;
    float n00 = dot(g00, vec2(fx.x, fy.x));
    float n10 = dot(g10, vec2(fx.y, fy.y));
    float n01 = dot(g01, vec2(fx.z, fy.z));
    float n11 = dot(g11, vec2(fx.w, fy.w));
    vec2 fxy = nzFade(Pf.xy);
    vec2 nx = mix(vec2(n00, n01), vec2(n10, n11), fxy.x);
    return 2.3 * mix(nx.x, nx.y, fxy.y);
}`,
  3: `float nzPerlin3(vec3 P) {
    vec3 Pi0 = floor(P); vec3 Pi1 = Pi0 + vec3(1.0);
    Pi0 = nzMod289(Pi0); Pi1 = nzMod289(Pi1);
    vec3 Pf0 = fract(P); vec3 Pf1 = Pf0 - vec3(1.0);
    vec4 ix = vec4(Pi0.x, Pi1.x, Pi0.x, Pi1.x);
    vec4 iy = vec4(Pi0.yy, Pi1.yy);
    vec4 iz0 = Pi0.zzzz; vec4 iz1 = Pi1.zzzz;
    vec4 ixy = nzPermute(nzPermute(ix) + iy);
    vec4 ixy0 = nzPermute(ixy + iz0);
    vec4 ixy1 = nzPermute(ixy + iz1);
    vec4 gx0 = ixy0 * (1.0 / 7.0);
    vec4 gy0 = fract(floor(gx0) * (1.0 / 7.0)) - 0.5;
    gx0 = fract(gx0);
    vec4 gz0 = vec4(0.5) - abs(gx0) - abs(gy0);
    vec4 sz0 = step(gz0, vec4(0.0));
    gx0 -= sz0 * (step(0.0, gx0) - 0.5);
    gy0 -= sz0 * (step(0.0, gy0) - 0.5);
    vec4 gx1 = ixy1 * (1.0 / 7.0);
    vec4 gy1 = fract(floor(gx1) * (1.0 / 7.0)) - 0.5;
    gx1 = fract(gx1);
    vec4 gz1 = vec4(0.5) - abs(gx1) - abs(gy1);
    vec4 sz1 = step(gz1, vec4(0.0));
    gx1 -= sz1 * (step(0.0, gx1) - 0.5);
    gy1 -= sz1 * (step(0.0, gy1) - 0.5);
    vec3 g000 = vec3(gx0.x, gy0.x, gz0.x); vec3 g100 = vec3(gx0.y, gy0.y, gz0.y);
    vec3 g010 = vec3(gx0.z, gy0.z, gz0.z); vec3 g110 = vec3(gx0.w, gy0.w, gz0.w);
    vec3 g001 = vec3(gx1.x, gy1.x, gz1.x); vec3 g101 = vec3(gx1.y, gy1.y, gz1.y);
    vec3 g011 = vec3(gx1.z, gy1.z, gz1.z); vec3 g111 = vec3(gx1.w, gy1.w, gz1.w);
    vec4 norm0 = nzTaylorInvSqrt(vec4(dot(g000, g000), dot(g010, g010), dot(g100, g100), dot(g110, g110)));
    g000 *= norm0.x; g010 *= norm0.y; g100 *= norm0.z; g110 *= norm0.w;
    vec4 norm1 = nzTaylorInvSqrt(vec4(dot(g001, g001), dot(g011, g011), dot(g101, g101), dot(g111, g111)));
    g001 *= norm1.x; g011 *= norm1.y; g101 *= norm1.z; g111 *= norm1.w;
    float n000 = dot(g000, Pf0);
    float n100 = dot(g100, vec3(Pf1.x, Pf0.yz));
    float n010 = dot(g010, vec3(Pf0.x, Pf1.y, Pf0.z));
    float n110 = dot(g110, vec3(Pf1.xy, Pf0.z));
    float n001 = dot(g001, vec3(Pf0.xy, Pf1.z));
    float n101 = dot(g101, vec3(Pf1.x, Pf0.y, Pf1.z));
    float n011 = dot(g011, vec3(Pf0.x, Pf1.yz));
    float n111 = dot(g111, Pf1);
    vec3 fxyz = nzFade(Pf0);
    vec4 nz = mix(vec4(n000, n100, n010, n110), vec4(n001, n101, n011, n111), fxyz.z);
    vec2 nyz = mix(nz.xy, nz.zw, fxyz.y);
    return 2.2 * mix(nyz.x, nyz.y, fxyz.x);
}`,
  4: `float nzPerlin4(vec4 P) {
    vec4 i = floor(P); vec4 f = fract(P); vec4 u = nzFade(f);
    float n = 0.0;
    for (int k = 0; k < 16; k++) {
        vec4 c = mod(floor(float(k) / vec4(1.0, 2.0, 4.0, 8.0)), 2.0);
        vec4 g = nzHash44(i + c) * 2.0 - 1.0;
        g *= inversesqrt(max(dot(g, g), 1e-4));
        vec4 w = mix(1.0 - u, u, c);
        n += w.x * w.y * w.z * w.w * dot(g, f - c);
    }
    return 1.6 * n;
}`,
};

// ── Simplex ──────────────────────────────────────────────────────────────────
// Simplex noise 2D, 3D and 4D by Ian McEwan and Stefan Gustavson (Ashima Arts, webgl-noise, MIT licence).

const GLSL_SIMPLEX: Record<2 | 3 | 4, string> = {
  2: `float nzSimplex2(vec2 v) {
    const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
    vec2 i = floor(v + dot(v, C.yy));
    vec2 x0 = v - i + dot(i, C.xx);
    vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
    vec4 x12 = x0.xyxy + C.xxzz;
    x12.xy -= i1;
    i = nzMod289(i);
    vec3 p = nzPermute(nzPermute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
    vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
    m = m * m; m = m * m;
    vec3 x = 2.0 * fract(p * C.www) - 1.0;
    vec3 h = abs(x) - 0.5;
    vec3 ox = floor(x + 0.5);
    vec3 a0 = x - ox;
    m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
    vec3 g;
    g.x = a0.x * x0.x + h.x * x0.y;
    g.yz = a0.yz * x12.xz + h.yz * x12.yw;
    return 130.0 * dot(m, g);
}`,
  3: `float nzSimplex3(vec3 v) {
    const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
    const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
    vec3 i = floor(v + dot(v, C.yyy));
    vec3 x0 = v - i + dot(i, C.xxx);
    vec3 g = step(x0.yzx, x0.xyz);
    vec3 l = 1.0 - g;
    vec3 i1 = min(g.xyz, l.zxy);
    vec3 i2 = max(g.xyz, l.zxy);
    vec3 x1 = x0 - i1 + C.xxx;
    vec3 x2 = x0 - i2 + C.yyy;
    vec3 x3 = x0 - D.yyy;
    i = nzMod289(i);
    vec4 p = nzPermute(nzPermute(nzPermute(
                i.z + vec4(0.0, i1.z, i2.z, 1.0))
              + i.y + vec4(0.0, i1.y, i2.y, 1.0))
              + i.x + vec4(0.0, i1.x, i2.x, 1.0));
    float n_ = 0.142857142857;
    vec3 ns = n_ * D.wyz - D.xzx;
    vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
    vec4 x_ = floor(j * ns.z);
    vec4 y_ = floor(j - 7.0 * x_);
    vec4 x = x_ * ns.x + ns.yyyy;
    vec4 y = y_ * ns.x + ns.yyyy;
    vec4 h = 1.0 - abs(x) - abs(y);
    vec4 b0 = vec4(x.xy, y.xy);
    vec4 b1 = vec4(x.zw, y.zw);
    vec4 s0 = floor(b0) * 2.0 + 1.0;
    vec4 s1 = floor(b1) * 2.0 + 1.0;
    vec4 sh = -step(h, vec4(0.0));
    vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
    vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
    vec3 p0 = vec3(a0.xy, h.x);
    vec3 p1 = vec3(a0.zw, h.y);
    vec3 p2 = vec3(a1.xy, h.z);
    vec3 p3 = vec3(a1.zw, h.w);
    vec4 norm = nzTaylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
    p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
    vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
    m = m * m;
    return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}`,
  4: `vec4 nzGrad4(float j, vec4 ip) {
    const vec4 ones = vec4(1.0, 1.0, 1.0, -1.0);
    vec4 p, s;
    p.xyz = floor(fract(vec3(j) * ip.xyz) * 7.0) * ip.z - 1.0;
    p.w = 1.5 - dot(abs(p.xyz), ones.xyz);
    s = vec4(lessThan(p, vec4(0.0)));
    p.xyz = p.xyz + (s.xyz * 2.0 - 1.0) * s.www;
    return p;
}
float nzSimplex4(vec4 v) {
    const vec4 C = vec4(0.138196601125011, 0.276393202250021, 0.414589803375032, -0.447213595499958);
    vec4 i = floor(v + dot(v, vec4(0.309016994374947451)));
    vec4 x0 = v - i + dot(i, C.xxxx);
    vec4 i0;
    vec3 isX = step(x0.yzw, x0.xxx);
    vec3 isYZ = step(x0.zww, x0.yyz);
    i0.x = isX.x + isX.y + isX.z;
    i0.yzw = 1.0 - isX;
    i0.y += isYZ.x + isYZ.y;
    i0.zw += 1.0 - isYZ.xy;
    i0.z += isYZ.z;
    i0.w += 1.0 - isYZ.z;
    vec4 i3 = clamp(i0, 0.0, 1.0);
    vec4 i2 = clamp(i0 - 1.0, 0.0, 1.0);
    vec4 i1 = clamp(i0 - 2.0, 0.0, 1.0);
    vec4 x1 = x0 - i1 + C.xxxx;
    vec4 x2 = x0 - i2 + C.yyyy;
    vec4 x3 = x0 - i3 + C.zzzz;
    vec4 x4 = x0 + C.wwww;
    i = nzMod289(i);
    float j0 = nzPermute(nzPermute(nzPermute(nzPermute(i.w) + i.z) + i.y) + i.x);
    vec4 j1 = nzPermute(nzPermute(nzPermute(nzPermute(
                 i.w + vec4(i1.w, i2.w, i3.w, 1.0))
               + i.z + vec4(i1.z, i2.z, i3.z, 1.0))
               + i.y + vec4(i1.y, i2.y, i3.y, 1.0))
               + i.x + vec4(i1.x, i2.x, i3.x, 1.0));
    vec4 ip = vec4(1.0 / 294.0, 1.0 / 49.0, 1.0 / 7.0, 0.0);
    vec4 p0 = nzGrad4(j0, ip);
    vec4 p1 = nzGrad4(j1.x, ip);
    vec4 p2 = nzGrad4(j1.y, ip);
    vec4 p3 = nzGrad4(j1.z, ip);
    vec4 p4 = nzGrad4(j1.w, ip);
    vec4 norm = nzTaylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
    p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
    p4 *= nzTaylorInvSqrt(dot(p4, p4));
    vec3 m0 = max(0.6 - vec3(dot(x0, x0), dot(x1, x1), dot(x2, x2)), 0.0);
    vec2 m1 = max(0.6 - vec2(dot(x3, x3), dot(x4, x4)), 0.0);
    m0 = m0 * m0; m1 = m1 * m1;
    return 49.0 * (dot(m0 * m0, vec3(dot(p0, x0), dot(p1, x1), dot(p2, x2))) + dot(m1 * m1, vec2(dot(p3, x3), dot(p4, x4))));
}`,
};

// ── Value ────────────────────────────────────────────────────────────────────
// A random number at each lattice point, blended smoothly between them. −1…1.

const GLSL_VALUE: Record<2 | 3 | 4, string> = {
  2: `float nzValue2(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float a = mix(nzHash12(i), nzHash12(i + vec2(1.0, 0.0)), u.x);
    float b = mix(nzHash12(i + vec2(0.0, 1.0)), nzHash12(i + vec2(1.0, 1.0)), u.x);
    return mix(a, b, u.y) * 2.0 - 1.0;
}`,
  3: `float nzValue3(vec3 p) {
    vec3 i = floor(p); vec3 f = fract(p);
    vec3 u = f * f * (3.0 - 2.0 * f);
    float a = mix(nzHash13(i), nzHash13(i + vec3(1.0, 0.0, 0.0)), u.x);
    float b = mix(nzHash13(i + vec3(0.0, 1.0, 0.0)), nzHash13(i + vec3(1.0, 1.0, 0.0)), u.x);
    float c = mix(nzHash13(i + vec3(0.0, 0.0, 1.0)), nzHash13(i + vec3(1.0, 0.0, 1.0)), u.x);
    float d = mix(nzHash13(i + vec3(0.0, 1.0, 1.0)), nzHash13(i + vec3(1.0, 1.0, 1.0)), u.x);
    return mix(mix(a, b, u.y), mix(c, d, u.y), u.z) * 2.0 - 1.0;
}`,
  4: `float nzValue4Slice(vec4 i, vec3 u) {
    float a = mix(nzHash14(i), nzHash14(i + vec4(1.0, 0.0, 0.0, 0.0)), u.x);
    float b = mix(nzHash14(i + vec4(0.0, 1.0, 0.0, 0.0)), nzHash14(i + vec4(1.0, 1.0, 0.0, 0.0)), u.x);
    float c = mix(nzHash14(i + vec4(0.0, 0.0, 1.0, 0.0)), nzHash14(i + vec4(1.0, 0.0, 1.0, 0.0)), u.x);
    float d = mix(nzHash14(i + vec4(0.0, 1.0, 1.0, 0.0)), nzHash14(i + vec4(1.0, 1.0, 1.0, 0.0)), u.x);
    return mix(mix(a, b, u.y), mix(c, d, u.y), u.z);
}
float nzValue4(vec4 p) {
    vec4 i = floor(p); vec4 f = fract(p);
    vec4 u = f * f * (3.0 - 2.0 * f);
    return mix(nzValue4Slice(i, u.xyz), nzValue4Slice(i + vec4(0.0, 0.0, 0.0, 1.0), u.xyz), u.w) * 2.0 - 1.0;
}`,
};

// ── Worley (cells) ───────────────────────────────────────────────────────────
// F1: the distance to the nearest of one random point per cell (Steven Worley, 1996), as 2 × F1 − 1 so it sums like
// the others. It searches the cells around: 9 in 2D, 27 in 3D, 81 in 4D (exact, but the heaviest choice; a 16-cell
// shortcut left visible seams).

const GLSL_WORLEY: Record<2 | 3 | 4, string> = {
  2: `float nzWorley2(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p);
    float d = 8.0;
    for (int y = -1; y <= 1; y++) {
        for (int x = -1; x <= 1; x++) {
            vec2 g = vec2(float(x), float(y));
            vec2 r = g + nzHash22(i + g) - f;
            d = min(d, dot(r, r));
        }
    }
    return 2.0 * sqrt(d) - 1.0;
}`,
  3: `float nzWorley3(vec3 p) {
    vec3 i = floor(p); vec3 f = fract(p);
    float d = 8.0;
    for (int z = -1; z <= 1; z++) {
        for (int y = -1; y <= 1; y++) {
            for (int x = -1; x <= 1; x++) {
                vec3 g = vec3(float(x), float(y), float(z));
                vec3 r = g + nzHash33(i + g) - f;
                d = min(d, dot(r, r));
            }
        }
    }
    return 2.0 * sqrt(d) - 1.0;
}`,
  4: `float nzWorley4(vec4 p) {
    vec4 i = floor(p); vec4 f = fract(p);
    float d = 8.0;
    for (int k = 0; k < 81; k++) {
        vec4 g = mod(floor(float(k) / vec4(1.0, 3.0, 9.0, 27.0)), 3.0) - 1.0;
        vec4 r = g + nzHash44(i + g) - f;
        d = min(d, dot(r, r));
    }
    return 2.0 * sqrt(d) - 1.0;
}`,
};

const BASE_GLSL: Record<NoiseKind, Record<2 | 3 | 4, string>> = { perlin: GLSL_PERLIN, simplex: GLSL_SIMPLEX, value: GLSL_VALUE, worley: GLSL_WORLEY };

/** The single-octave noise function's name: nzPerlin3, nzWorley2… */
export const baseNoiseFn = (kind: NoiseKind, d: 2 | 3 | 4) => `nz${KIND_NAME[kind]}${d}`;
/** The node's whole noise (distortion, then the octaves): nzNoisePerlin3, or nzNoisePerlin3D with Distortion on. */
export const noiseFn = (kind: NoiseKind, d: 2 | 3 | 4, distort: boolean) => `nzNoise${KIND_NAME[kind]}${d}${distort ? 'D' : ''}`;

/** Constant offsets that decorrelate the distortion axes and the colour channels (any far-apart numbers will do). */
const OFFSETS = [[12.7, 31.1, 47.3, 5.9], [-23.9, 8.3, 17.7, 61.3], [39.1, -14.5, 3.7, 29.9], [7.3, 53.9, -31.3, 11.1]];
const vecLit = (d: 2 | 3 | 4, o: number[]) => `${vecT(d)}(${o.slice(0, d).map(x => x.toFixed(1)).join(', ')})`;

/** The fractal sum (Blender's fBM: Detail octaves, the last one blended in by Detail's fraction) and its distorted form. */
function fractalGlsl(kind: NoiseKind, d: 2 | 3 | 4): string {
  const T = vecT(d);
  const base = baseNoiseFn(kind, d);
  const warp = Array.from({ length: d }, (_, k) => `${base}(p * 0.5 + ${vecLit(d, OFFSETS[k])})`).join(', ');
  return `float ${noiseFn(kind, d, false)}(${T} p, float detail, float roughness, float lacunarity) {
    float dt = clamp(detail, 0.0, ${NOISE_MAX_DETAIL}.0);
    float whole = floor(dt);
    float sum = 0.0;
    float amp = 1.0;
    float norm = 0.0;
    for (int i = 0; i <= ${NOISE_MAX_DETAIL}; i++) {
        if (float(i) > whole) break;
        sum += amp * ${base}(p);
        norm += amp;
        amp *= roughness;
        p *= lacunarity;
    }
    float part = dt - whole;
    if (part > 0.0) {
        float more = sum + amp * ${base}(p);
        return mix(sum / norm, more / (norm + amp), part);
    }
    return sum / norm;
}
float ${noiseFn(kind, d, true)}(${T} p, float detail, float roughness, float lacunarity, float distortion) {
    p += distortion * ${T}(${warp});
    return ${noiseFn(kind, d, false)}(p, detail, roughness, lacunarity);
}`;
}

/** Every helper a Noise of this Kind and Dimensions calls, in define-before-use order. */
export function noiseHelpers(kind: NoiseKind, dims: NoiseDims): string[] {
  const d = DIM_N[dims];
  const permute = kind === 'perlin' || kind === 'simplex' ? [GLSL_PERMUTE] : [];
  const hash = kind === 'value' || kind === 'worley' || (kind === 'perlin' && d === 4) ? [GLSL_HASH] : [];
  return [...permute, ...hash, BASE_GLSL[kind][d], fractalGlsl(kind, d)];
}

/** The finite-difference step for Slope, in noise units. */
const SLOPE_STEP = 0.002;

export const NoiseNode: NodeDefinition = withParamSockets({
  type: 'noise',
  label: 'Noise',
  aliases: ['Noise Texture'],
  category: 'Noise',
  description: 'One noise node with the classic kinds: Perlin, Simplex, Value and Worley (cells), in 2D, 3D or 4D. Detail adds finer layers, Roughness and Lacunarity shape them, Distortion swirls the pattern with more of the same noise. 3D and 4D change in place over time instead of sliding; 4D repeats seamlessly. Value is 0–1; Colour is three different noises; Slope says which way the noise rises, for flow and displacement.',
  inputs: {
    uv:   { type: 'vec2',  label: 'UV' },
    time: { type: 'float', label: 'Time', hint: 'The clock the noise moves with (Speed sets how fast). Unwired it is the shader clock.' },
  },
  outputs: {
    value:  { type: 'float', label: 'Value (0–1)' },
    signed: { type: 'float', label: 'Signed (−1–1)' },
    colour: { type: 'vec3',  label: 'Colour' },
    slope:  { type: 'vec2',  label: 'Slope' },
  },
  glslFunctionsFor: node => noiseHelpers(kindOf(node), dimsOf(node)),
  defaultParams: { kind: 'perlin', dims: '3d', scale: 4.0, detail: 2.0, roughness: 0.5, lacunarity: 2.0, distortion: 0, speed: 0.0, offsetX: 0.0, offsetY: 0.0 },
  paramDefs: {
    kind: {
      label: 'Kind', type: 'select', hint: 'Which noise. Perlin is smooth and natural, Simplex is similar with fewer grid lines, Value is softer and blobbier, Worley makes cells.',
      options: [
        { value: 'perlin',  label: 'Perlin (gradient)' },
        { value: 'simplex', label: 'Simplex' },
        { value: 'value',   label: 'Value' },
        { value: 'worley',  label: 'Worley (cells)' },
      ],
    },
    dims: {
      label: 'Dimensions', type: 'select', hint: '2D slides the pattern when Speed is on; 3D changes it in place; 4D changes it in place and repeats every 6.28 ÷ Speed seconds. Higher costs more.',
      options: [
        { value: '2d', label: '2D' },
        { value: '3d', label: '3D (changes in place)' },
        { value: '4d', label: '4D (changes in place, loops)' },
      ],
    },
    scale:      { label: 'Scale',      type: 'float', min: 0.1, max: 40.0, step: 0.1,  hint: 'How many noise features fit across the picture. Higher = smaller, busier features.' },
    detail:     { label: 'Detail',     type: 'float', min: 0.0, max: NOISE_MAX_DETAIL, step: 0.01, hint: 'Layers of finer noise on top (0 is one smooth layer, 8 adds eight more). Fractions blend the last layer in, so it can move smoothly. Each layer costs GPU time.' },
    roughness:  { label: 'Roughness',  type: 'float', min: 0.0, max: 1.0,  step: 0.01, hint: 'How strong each finer layer is. 0.5 is natural; higher is grainier, lower is smoother.' },
    lacunarity: { label: 'Lacunarity', type: 'float', min: 1.0, max: 4.0,  step: 0.01, hint: 'How much finer each layer is than the one before. 2 is standard; higher jumps to fine grain sooner.' },
    distortion: { label: 'Distortion', type: 'float', min: 0.0, max: 5.0,  step: 0.01, literalAt: 0, hint: 'Pushes the pattern around by a broader noise of the same kind, for marble and smoke swirls. 0 is off (and costs nothing).' },
    speed:      { label: 'Speed',      type: 'float', min: -2.0, max: 2.0, step: 0.01, hint: 'How fast the noise changes over time. 0 holds it still; negative runs it backwards.' },
    offsetX:    { label: 'Offset X',   type: 'float', min: -10.0, max: 10.0, step: 0.01, hint: 'Slides the pattern sideways, in picture units.' },
    offsetY:    { label: 'Offset Y',   type: 'float', min: -10.0, max: 10.0, step: 0.01, hint: 'Slides the pattern up and down, in picture units.' },
  },
  generateGLSL: (node: GraphNode, inputVars) => {
    const id = node.id;
    const kind = kindOf(node);
    const d = DIM_N[dimsOf(node)];
    const T = vecT(d);
    const uv = inputVars.uv ?? 'g_uv';
    const time = inputVars.time ?? 'u_time';
    const scale = `(${p(node.params.scale, 4.0)})`;
    const detail = p(node.params.detail, 2.0);
    const rough = p(node.params.roughness, 0.5);
    const lac = p(node.params.lacunarity, 2.0);
    const speed = p(node.params.speed, 0.0);
    const offset = `vec2(${p(node.params.offsetX, 0.0)}, ${p(node.params.offsetY, 0.0)})`;
    const dist = node.params.distortion;
    // Distortion at a plain 0 (or absent) leaves the warp out of the shader altogether.
    const distort = dist !== undefined && dist !== null && dist !== 0;
    const fn = noiseFn(kind, d, distort);
    const args = `${detail}, ${rough}, ${lac}${distort ? `, ${p(dist, 0)}` : ''}`;
    const t = `(${time}) * (${speed})`;
    const at = `(${uv} + ${offset}) * ${scale}`;
    const P = d === 2
      ? `${at} + ${t} * vec2(0.31, 0.17)`
      : d === 3
        ? `vec3(${at}, ${t})`
        : `vec4(${at}, cos(${t}), sin(${t}))`;
    const unit = (k: number) => `${T}(${Array.from({ length: d }, (_, j) => (j === k ? SLOPE_STEP.toFixed(3) : '0.0')).join(', ')})`;
    const off = (k: number) => vecLit(d, OFFSETS[k].map(x => x * 3.0));
    const code = [
      `    ${T} ${id}_P = ${P};\n`,
      `    float ${id}_signed = ${fn}(${id}_P, ${args});\n`,
      `    float ${id}_value = clamp(${id}_signed * 0.5 + 0.5, 0.0, 1.0);\n`,
      // Colour: Value plus two more noises at far-off points, so green and blue are unrelated to red.
      `    vec3 ${id}_colour = clamp(vec3(${id}_signed, ${fn}(${id}_P + ${off(1)}, ${args}), ${fn}(${id}_P + ${off(2)}, ${args})) * 0.5 + 0.5, 0.0, 1.0);\n`,
      // Slope: how fast Value rises along the picture's x and y (forward differences, times Scale back into UV units).
      `    vec2 ${id}_slope = (vec2(${fn}(${id}_P + ${unit(0)}, ${args}), ${fn}(${id}_P + ${unit(1)}, ${args})) - ${id}_signed) * (${(0.5 / SLOPE_STEP).toFixed(1)} * ${scale});\n`,
    ].join('');
    return {
      code,
      outputVars: { value: `${id}_value`, signed: `${id}_signed`, colour: `${id}_colour`, slope: `${id}_slope` },
    };
  },
}, ['scale', 'detail', 'roughness', 'lacunarity', 'distortion', 'speed', 'offsetX', 'offsetY'], ['scale']);
