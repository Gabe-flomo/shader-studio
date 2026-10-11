/**
 * shaders.ts — the splat raster pass's GLSL (docs/splat-scene.md "How it draws"; the maths in math.ts, tested there).
 *
 * One instanced quad per splat, in back-to-front order (the `splatIndex` attribute). The vertex shader:
 *  1. reads the splat (pack.ts layout) and the probe's 8 texels (the camera's eye and three rays; the model's columns,
 *     Splat size, Opacity and offset: compiler/splatGraph.ts);
 *  2. rebuilds the camera: forward is the centre ray, right / up the parts of the side rays across it, and the lens
 *     from how far across they lean (math.ts cameraFromProbe);
 *  3. places the centre and the covariance in the world (M Σ Mᵀ), projects them (EWA: J W Σ Wᵀ Jᵀ + 0.3 px²), and
 *     spans the quad √(2λ) along the ellipse's axes;
 *  4. with SH degree > 0 adds the view-dependent colour (the 3DGS basis, the view direction in the scan's own space).
 * The fragment shader weighs exp(−|v|²) and writes the premultiplied colour and, to the second target, the distance
 * weighted the same way (Σ αᵢ Tᵢ dᵢ: divided by alpha it is the splats' distance at the pixel).
 *
 * Per-splat modifiers (docs/splat-scene.md): SPLAT_VERT_MOD is the same shader with SPLAT_MOD defined, reading each
 * splat's moved centre, size (or dot radius), colour and opacity from the modifier program's two targets; a splat with
 * no opacity or size left is skipped before projecting. A dot (Splat Points) is a round quad with a crisp edge.
 * SPLAT_DEPTH_FRAG works out the moved splats' depths for the sort.
 */

export const SPLAT_VERT = /* glsl */ `precision highp float;
precision highp int;
precision highp usampler2D;
precision highp sampler2D;

uniform usampler2D u_data;
uniform usampler2D u_sh;
uniform sampler2D u_probe;
uniform int u_shDeg;
uniform vec2 u_view;
#ifdef SPLAT_MOD
// The modifier program's targets (one texel per splat, 2048 a row): centre and size (negative: a dot's radius in
// pixels), and colour and opacity.
uniform sampler2D u_modA;
uniform sampler2D u_modB;
#endif
in vec3 position;
in uint splatIndex;
out vec4 vColor;
out vec2 vPos;
out float vDist;
out float vDot;

const float SH_C1 = 0.4886025119029199;
const float SH_C2[5] = float[](1.0925484305920792, -1.0925484305920792, 0.31539156525252005, -1.0925484305920792, 0.5462742152960396);
const float SH_C3[7] = float[](-0.5900435899266435, 2.890611442640554, -0.4570457994644658, 0.3731763325901154, -0.4570457994644658, 1.445305721320277, -0.5900435899266435);

vec3 shAt(uint i, int k) {
  // Coefficient k (0-based past the zeroth) of splat i: 3 bytes at byte 3k of its texels.
  int per = u_shDeg == 1 ? 1 : u_shDeg == 2 ? 2 : 3;
  int perRow = 2046 / per;
  int si = int(i);
  ivec2 base = ivec2((si % perRow) * per, si / perRow);
  vec3 c;
  for (int ch = 0; ch < 3; ch++) {
    int b = k * 3 + ch;
    uvec4 t = texelFetch(u_sh, base + ivec2(b / 16, 0), 0);
    int w = (b % 16) / 4;
    uint word = w == 0 ? t.x : w == 1 ? t.y : w == 2 ? t.z : t.w;
    c[ch] = (float((word >> (8u * uint(b % 4))) & 255u) - 128.0) / 128.0;
  }
  return c;
}

void main() {
  uint i = splatIndex;
  uvec4 a = texelFetch(u_data, ivec2(int((i & 1023u) << 1), int(i >> 10)), 0);
  uvec4 b = texelFetch(u_data, ivec2(int(((i & 1023u) << 1) | 1u), int(i >> 10)), 0);
  vec3 p = uintBitsToFloat(a.xyz);

  vec3 eye = texelFetch(u_probe, ivec2(0, 0), 0).xyz;
  vec3 F = normalize(texelFetch(u_probe, ivec2(1, 0), 0).xyz);
  vec3 rx = texelFetch(u_probe, ivec2(2, 0), 0).xyz;
  vec3 ry = texelFetch(u_probe, ivec2(3, 0), 0).xyz;
  vec3 px = rx - F * dot(rx, F), py = ry - F * dot(ry, F);
  float lx = max(length(px), 1e-9), ly = max(length(py), 1e-9);
  vec3 R = px / lx, U = py / ly;
  float fx = 0.5 * dot(rx, F) / lx, fy = 0.5 * dot(ry, F) / ly;
  vec4 c0 = texelFetch(u_probe, ivec2(4, 0), 0), c1 = texelFetch(u_probe, ivec2(5, 0), 0), c2 = texelFetch(u_probe, ivec2(6, 0), 0);
  mat3 M = mat3(c0.xyz, c1.xyz, c2.xyz);
  vec3 T = texelFetch(u_probe, ivec2(7, 0), 0).xyz;
  float sizeMul = c0.w, opacityMul = c1.w;

  vec3 w = M * p + T;
  vec4 col = vec4(float(a.w & 255u), float((a.w >> 8) & 255u), float((a.w >> 16) & 255u), float(a.w >> 24)) / 255.0;
  float sMul = 1.0, dotPx = 0.0;
#ifdef SPLAT_MOD
  ivec2 mt = ivec2(int(i & 2047u), int(i >> 11));
  vec4 ma = texelFetch(u_modA, mt, 0), mb = texelFetch(u_modB, mt, 0);
  w = ma.xyz;
  if (ma.w < 0.0) dotPx = -ma.w; else sMul = ma.w;
  col = mb;
  // Gone (no opacity, no size) or broken: skip it before any of the projection.
  if (col.a * opacityMul < 1.0 / 255.0 || (dotPx == 0.0 && sMul <= 0.0) || any(isnan(w)) || any(isinf(w))) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }
#endif
  vec3 t = w - eye;
  float x = dot(t, R), y = dot(t, U), z = dot(t, F);
  if (z < 0.05) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }
  vec2 uv = vec2(fx * x, fy * y) / z;
  vec2 ndc = vec2(uv.x * u_view.y / u_view.x, uv.y);
  if (abs(ndc.x) > 1.3 || abs(ndc.y) > 1.3) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }

  vec2 u1 = unpackHalf2x16(b.x), u2 = unpackHalf2x16(b.y), u3 = unpackHalf2x16(b.z);
  mat3 S = mat3(u1.x, u1.y, u2.x, u1.y, u2.y, u3.x, u2.x, u3.x, u3.y) * (0.25 * sizeMul * sizeMul * sMul * sMul);
  mat3 Sw = M * S * transpose(M);
  float k = 0.5 * u_view.y;
  vec3 j0 = k * fx * (R / z - x * F / (z * z));
  vec3 j1 = k * fy * (U / z - y * F / (z * z));
  float ca = dot(j0, Sw * j0) + 0.3, cb = dot(j0, Sw * j1), cc = dot(j1, Sw * j1) + 0.3;
  float mid = 0.5 * (ca + cc), rad = length(vec2(0.5 * (ca - cc), cb));
  float l1 = mid + rad, l2 = max(mid - rad, 0.1);
  vec2 dv = vec2(cb, l1 - ca);
  dv = length(dv) > 1e-12 ? normalize(dv) : (ca >= cc ? vec2(1.0, 0.0) : vec2(0.0, 1.0));
  vec2 major = min(sqrt(2.0 * l1), 1024.0) * dv;
  vec2 minor = min(sqrt(2.0 * l2), 1024.0) * vec2(dv.y, -dv.x);
  // A crisp dot (Splat Points): a round quad dotPx in radius (the fragment's edge is at |vPos| = 2).
  if (dotPx > 0.0) { major = vec2(0.5 * dotPx, 0.0); minor = vec2(0.0, 0.5 * dotPx); }

  if (u_shDeg > 0) {
    // The view direction in the scan's own space (M may scale and flip).
    vec3 d = normalize(inverse(M) * normalize(t));
    float dx = d.x, dy = d.y, dz = d.z;
    vec3 add = SH_C1 * (-dy * shAt(i, 0) + dz * shAt(i, 1) - dx * shAt(i, 2));
    if (u_shDeg > 1) {
      float xx = dx * dx, yy = dy * dy, zz = dz * dz;
      add += SH_C2[0] * dx * dy * shAt(i, 3) + SH_C2[1] * dy * dz * shAt(i, 4) + SH_C2[2] * (2.0 * zz - xx - yy) * shAt(i, 5)
        + SH_C2[3] * dx * dz * shAt(i, 6) + SH_C2[4] * (xx - yy) * shAt(i, 7);
      if (u_shDeg > 2) {
        add += SH_C3[0] * dy * (3.0 * xx - yy) * shAt(i, 8) + SH_C3[1] * dx * dy * dz * shAt(i, 9)
          + SH_C3[2] * dy * (4.0 * zz - xx - yy) * shAt(i, 10) + SH_C3[3] * dz * (2.0 * zz - 3.0 * xx - 3.0 * yy) * shAt(i, 11)
          + SH_C3[4] * dx * (4.0 * zz - xx - yy) * shAt(i, 12) + SH_C3[5] * dz * (xx - yy) * shAt(i, 13)
          + SH_C3[6] * dx * (xx - 3.0 * yy) * shAt(i, 14);
      }
    }
    col.rgb = max(col.rgb + add, 0.0);
  }
  col.a = min(col.a * opacityMul, 1.0);
  vColor = col;
  vPos = position.xy;
  vDist = length(t);
  vDot = dotPx;
  vec2 off = (position.x * major + position.y * minor) * 2.0 / u_view;
  gl_Position = vec4(ndc + off, 0.0, 1.0);
}
`;

/** The splat shader with the modifier program's targets read for each splat (docs/splat-scene.md "Per-splat modifiers"). */
export const SPLAT_VERT_MOD = `#define SPLAT_MOD\n${SPLAT_VERT}`;

/**
 * The moved splats' depths, for the sort (docs/splat-scene.md "Sorting moved splats"): four splats a texel, each the
 * distance of its moved centre (the modifier's target A) along the camera's forward ray (the probe). A quarter of the
 * centres' bytes to read back, and the worker sorts the numbers as they are.
 */
export const SPLAT_DEPTH_VERT = /* glsl */ `in vec3 position;
void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }
`;
export const SPLAT_DEPTH_FRAG = /* glsl */ `precision highp float;
precision highp int;
uniform sampler2D u_modA;
uniform sampler2D u_probe;
uniform int u_count;
out vec4 outDepth;

void main() {
  int t = int(gl_FragCoord.y) * 2048 + int(gl_FragCoord.x);
  vec3 eye = texelFetch(u_probe, ivec2(0, 0), 0).xyz;
  vec3 F = normalize(texelFetch(u_probe, ivec2(1, 0), 0).xyz);
  vec4 d = vec4(0.0);
  for (int k = 0; k < 4; k++) {
    int i = t * 4 + k;
    vec3 w = texelFetch(u_modA, ivec2(i & 2047, i >> 11), 0).xyz;
    d[k] = i < u_count ? dot(w - eye, F) : 0.0;
  }
  outDepth = d;
}
`;

export const SPLAT_FRAG = /* glsl */ `precision highp float;
in vec4 vColor;
in vec2 vPos;
in float vDist;
in float vDot;
layout(location = 0) out vec4 outColor;
layout(location = 1) out vec4 outDepth;

void main() {
  float q = dot(vPos, vPos);
  if (q > 4.0) discard;
  // A dot: solid to its rim (|vPos| = 2), a pixel of antialiasing; else the Gaussian.
  float alpha = vDot > 0.0
    ? min(0.99, (1.0 - smoothstep(1.0 - 1.0 / max(vDot, 1.0), 1.0, 0.5 * sqrt(q))) * vColor.a)
    : min(0.99, exp(-q) * vColor.a);
  if (alpha < 1.0 / 255.0) discard;
  outColor = vec4(vColor.rgb * alpha, alpha);
  outDepth = vec4(vDist * alpha, 0.0, 0.0, alpha);
}
`;
