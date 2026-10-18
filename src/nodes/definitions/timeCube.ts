import type { GraphNode, NodeDefinition, ParamDef } from '../../types/nodeGraph';
import { p, pv3 } from './helpers';
import { planFrameStack, stackSettingsOf, FRAME_WIDTHS, MAX_FRAMES, MIN_FRAMES } from '../../lib/timeCube/plan';
import { BALL_META, DEMO_META } from '../../lib/timeCube/frames';
import { segmentsFromStartEnd } from '../../lib/media/clip';
import { KNEE_EASE, migrateOpacity, OD_SOLID, OPACITY_KNEE, OPACITY_REF } from '../../lib/timeCube/plan';

/**
 * Time cube (docs/time-cube.md): a video as a box of time.
 *
 * - **Time Cube** (`timeCube`): picks a video (the built-in Ball action clip by default) and
 *   stacks its frames into a volume: one atlas texture (`u_tex_<slug>`,
 *   bound from the store's nodeTextures by lib/timeCube/volumes.ts) plus two
 *   defines for its layout. Its Volume output is that sampler's name.
 * - **Time Cube View** (`timeCubeView`): ray-marches the box in 3D, front to
 *   back, with a transfer function: frames before the slice are see-through,
 *   frames after it opaque, the slice itself a crisp frame; a colour key;
 *   box edges. Its own orbit camera, or a March Camera's rays.
 * - **Time Slice** (`timeSlice`): the 2D cut through the volume: a frame, a
 *   tilted plane (slit-scan), a row or column through time, or a per-pixel
 *   delay map (time displacement).
 *
 * The layout is known when the graph compiles (the plan is a pure function
 * of the node's settings and its video's size), so it is written into the
 * shader as `#define u_tex_<slug>_vol vec4(cols, rows, frames, aspect)` and
 * `_volpx` (half a texel of a tile). The atlas is read with plain bilinear
 * filtering, no mipmaps, in every host.
 */

export const TIME_CUBE_SOURCE_TYPE = 'timeCube';
export const TIME_CUBE_VIEW_TYPE = 'timeCubeView';
export const TIME_SLICE_TYPE = 'timeSlice';

/** The layout define of a volume sampler (`<sampler>_vol`): vec4(cols, rows, frames, aspect). */
export const volLayout = (sampler: string) => `${sampler}_vol`;
/** Its half-texel inset within a tile, in tile units (`<sampler>_volpx`). */
export const volPx = (sampler: string) => `${sampler}_volpx`;

const fx = (n: number) => (Number.isInteger(n) ? `${n}.0` : `${+n.toFixed(6)}`);

/** The defines a Time Cube node's volume needs, from its plan (the test clip's when its video's size isn't known yet). */
export function timeCubeDeclarations(node: GraphNode): string[] {
  const meta = node.params.source === 'library' ? (node.params._meta as { width?: number; height?: number; duration?: number } | undefined)
    : node.params.source === 'ball' ? BALL_META : DEMO_META;
  const plan = planFrameStack(
    meta && typeof meta.width === 'number' && typeof meta.height === 'number' ? { width: meta.width, height: meta.height, duration: Number(meta.duration) || 0 } : DEMO_META,
    stackSettingsOf(node.params),
  );
  const s = `u_tex_${node.id}`;
  return [
    `#define ${volLayout(s)} vec4(${fx(plan.cols)}, ${fx(plan.rows)}, ${fx(plan.frames)}, ${fx(plan.aspect)})`,
    `#define ${volPx(s)} vec2(${fx(0.5 / plan.tileW)}, ${fx(0.5 / plan.tileH)})`,
  ];
}

// ── Shared GLSL ──────────────────────────────────────────────────────────────

/** Atlas coordinate of frame f (an integer) at frame point uv. Mirrors lib/timeCube/plan.ts atlasUv. */
const TC_TILE = `vec2 tcTile(vec4 lay, float f, vec2 uv) {
    float row = floor((f + 0.5) / lay.x);
    float col = f - row * lay.x;
    return vec2((col + uv.x) / lay.x, 1.0 - (row + 1.0 - uv.y) / lay.y);
}`;

/** The volume at (u, v, t), 0–1 each: bilinear inside a frame, blended between the two nearest frames. */
const TC_SAMPLE = `vec3 tcSample(sampler2D tex, vec4 lay, vec2 inset, vec3 q) {
    vec2 uv = clamp(q.xy, inset, 1.0 - inset);
    float f = clamp(q.z, 0.0, 1.0) * (lay.z - 1.0);
    float f0 = floor(f);
    float f1 = min(f0 + 1.0, lay.z - 1.0);
    return mix(texture2D(tex, tcTile(lay, f0, uv)).rgb, texture2D(tex, tcTile(lay, f1, uv)).rgb, f - f0);
}`;

/**
 * The two frames either side of time q.z at (u, v), and how far between them (0–1). A key reads
 * each frame on its own and blends the matches, so a keyed colour fades smoothly from one frame
 * to the next instead of dropping out where its blend with the background no longer matches.
 */
const TC_FRAMES = `float tcFrames(sampler2D tex, vec4 lay, vec2 inset, vec3 q, out vec3 c0, out vec3 c1) {
    vec2 uv = clamp(q.xy, inset, 1.0 - inset);
    float f = clamp(q.z, 0.0, 1.0) * (lay.z - 1.0);
    float f0 = floor(f);
    c0 = texture2D(tex, tcTile(lay, f0, uv)).rgb;
    c1 = texture2D(tex, tcTile(lay, min(f0 + 1.0, lay.z - 1.0), uv)).rgb;
    return f - f0;
}`;

/**
 * Optical depth across the box's length in time for an opacity (plan.ts opticalDepth): up to the
 * knee the opacity is what a slab OPACITY_REF of the box thick hides, so the sliders are even; above
 * it the frames firm up evenly into the hard surface at 1.
 */
const TC_DEPTH = `float tcDepth(float o) {
    o = clamp(o, 0.0, 1.0);
    if (o >= 1.0) return ${fx(OD_SOLID)};
    if (o <= ${fx(OPACITY_KNEE)}) return -log(1.0 - o) * ${fx(1 / OPACITY_REF)};
    return ${fx(-Math.log(1 - OPACITY_KNEE) / OPACITY_REF)} * pow(${fx(OD_SOLID / (-Math.log(1 - OPACITY_KNEE) / OPACITY_REF))}, pow((o - ${fx(OPACITY_KNEE)}) / ${fx(1 - OPACITY_KNEE)}, ${fx(KNEE_EASE)}));
}`;

/**
 * The temporal feather (style.ts featherEase, featherOpacity): Before / After opacity ramping over
 * fe.x of box time instead of stepping at the slice s. fe = (width, side −1 before / 0 centred / 1
 * after, curve, wrap). gm (the step's middle) picks the side as the hard step does; g (the step's
 * jittered point) reads the ramp.
 */
const TC_FEATHER = `float tcEase(float x, float c) {
    x = clamp(x, 0.0, 1.0);
    c = clamp(c, -1.0, 1.0);
    float s = x * x * (3.0 - 2.0 * x);
    return c < 0.0 ? mix(s, x * x, -c) : mix(s, 1.0 - (1.0 - x) * (1.0 - x), c);
}
float tcFeather(float gm, float g, float s, vec4 fe, float bo, float ao) {
    float base = gm < s ? bo : ao;
    if (fe.x <= 0.0) return base;
    float w = min(fe.x, 1.0);
    float d = g - s + 0.5 * w * (1.0 - clamp(fe.y, -1.0, 1.0));
    if (fe.w > 0.5) d = fract(d);
    if (d < 0.0 || d >= w) return base;
    return mix(bo, ao, tcEase(d / w, fe.z));
}`;

const TC_HUESAT = `vec2 tcHueSat(vec3 c) {
    float mx = max(c.r, max(c.g, c.b));
    float mn = min(c.r, min(c.g, c.b));
    float d = mx - mn;
    if (d < 1e-6) return vec2(0.0);
    float h;
    if (mx == c.r) h = mod((c.g - c.b) / d, 6.0);
    else if (mx == c.g) h = (c.b - c.r) / d + 2.0;
    else h = (c.r - c.g) / d + 4.0;
    return vec2(fract(h / 6.0), d / max(mx, 1e-6));
}`;

/** Key match, 0–1 (plan.ts keyMatch). */
const TC_KEY = `float tcKeyColor(vec3 c, vec3 k, float tol, float soft) {
    return 1.0 - smoothstep(tol, tol + max(soft, 1e-3), length(c - k) / 1.7320508);
}
float tcKeyHue(vec3 c, vec3 k, float tol, float soft) {
    vec2 a = tcHueSat(c);
    vec2 b = tcHueSat(k);
    float dh = abs(fract(a.x - b.x + 1.5) - 0.5) * 2.0;
    return (1.0 - smoothstep(tol, tol + max(soft, 1e-3), dh)) * smoothstep(0.2, 0.4, a.y);
}
float tcKeyLuma(vec3 c, float lo, float hi, float soft) {
    float l = dot(c, vec3(0.299, 0.587, 0.114));
    soft = max(soft, 1e-3);
    return smoothstep(lo - soft, lo, l) * (1.0 - smoothstep(hi, hi + soft, l));
}`;

const LUMA = 'vec3(0.299, 0.587, 0.114)';

/**
 * Volume coordinate (u, v, t) of box point q (0–1³) for a stack axis, 0 depth (z), 1 width (x),
 * 2 height (y) (plan.ts boxToVolume), and back (tcBoxQ). The app's cameras (March Camera) put
 * screen right at −x looking down −z, so u runs toward −x: a frame reads the right way round from
 * the side time starts on. The axis is always a literal, so the compiler folds the choice.
 */
const TC_UVT = `vec3 tcUvt(vec3 q, float ax) {
    return ax < 0.5 ? vec3(1.0 - q.x, q.y, 1.0 - q.z) : ax < 1.5 ? vec3(q.z, q.y, 1.0 - q.x) : vec3(1.0 - q.x, 1.0 - q.z, 1.0 - q.y);
}
vec3 tcBoxQ(vec3 w, float ax) {
    return ax < 0.5 ? vec3(1.0 - w.x, w.y, 1.0 - w.z) : ax < 1.5 ? vec3(1.0 - w.z, w.y, w.x) : vec3(1.0 - w.x, 1.0 - w.z, 1.0 - w.y);
}`;

/** The shape (lib/timeCube/style.ts shapeDistance): a rounded box (rb.x) with puffed-out faces (rb.y). */
const TC_SHAPE = `float tcRoundBox(vec3 p, vec3 b, float r) {
    vec3 q = abs(p) - b + r;
    return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0) - r;
}
float tcShape(vec3 p, vec3 b, vec2 rb) {
    if (rb.y <= 0.0) return tcRoundBox(p, b, min(rb.x, min(b.x, min(b.y, b.z))));
    vec3 s = clamp(p / b, -1.0, 1.0);
    s *= s;
    vec3 bb = b + rb.y * vec3((1.0 - s.y) * (1.0 - s.z), (1.0 - s.x) * (1.0 - s.z), (1.0 - s.x) * (1.0 - s.y));
    return tcRoundBox(p, bb, min(rb.x, min(bb.x, min(bb.y, bb.z))));
}`;

/**
 * Highlights and frame motion (style.ts combDistance, bump, warpUv). hl = (start, spacing, count,
 * loop), in time; mv = (side, up, scale, turn).
 */
const TC_MOTION = `float tcComb(float g, vec4 hl) {
    float S = max(hl.y, 1e-4);
    float n = max(hl.z, 1.0);
    float x = g - hl.x;
    if (hl.w < 0.5) return x - clamp(floor(x / S + 0.5), 0.0, n - 1.0) * S;
    x = fract(x);
    float best = 1e9;
    for (int m = -1; m <= 1; m++) {
        float xm = x + float(m);
        float d = xm - clamp(floor(xm / S + 0.5), 0.0, n - 1.0) * S;
        if (abs(d) < abs(best)) best = d;
    }
    return best;
}
float tcBump(float d, float w) {
    return 0.5 + 0.5 * cos(3.14159265 * clamp(abs(d) / max(w, 1e-5), 0.0, 1.0));
}
vec3 tcWarp(vec3 w, float b, vec4 mv, float asp) {
    vec2 d = (w.xy - 0.5) * vec2(asp, 1.0) - mv.xy * b;
    d /= max(1.0 + mv.z * b, 0.05);
    float a = -mv.w * b;
    float c = cos(a), s = sin(a);
    d = vec2(c * d.x - s * d.y, s * d.x + c * d.y);
    return vec3(d / vec2(asp, 1.0) + 0.5, w.z);
}
float tcShapeAt(vec3 p, vec3 B, vec2 rb, vec4 st, vec4 hl, vec4 mw, vec4 mv, float asp, out vec3 w, out float b) {
    w = tcUvt((p + B) * (0.5 / B), st.w);
    b = 0.0;
    if (mw.w < 0.5) return tcShape(p, B, rb);
    float g = w.z - st.y * (w.x - 0.5) - st.z * (w.y - 0.5);
    if (mw.x > 0.5) b = tcBump(g - st.x, mw.z);
    if (mw.y > 0.5) b = max(b, tcBump(tcComb(g, hl), mw.z));
    w = tcWarp(w, b, mv, asp);
    return tcShape((tcBoxQ(w, st.w) * 2.0 - 1.0) * B, B, rb);
}`;

/** Turns a colour round the grey axis by `turns` of the colour wheel (the key colour's shift and drift). */
const TC_HUETURN = `vec3 tcHueTurn(vec3 c, float turns) {
    float a = 6.2831853 * turns;
    vec3 k = vec3(0.57735027);
    float cs = cos(a);
    return c * cs + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - cs);
}`;

/** Key pulse (style.ts pulseBand). pp = (count, width, softness, phase): bands of visibility along time. */
const TC_PULSE = `float tcPulse(float x, vec4 pp) {
    float d = abs(fract(x * max(pp.x, 0.0) - pp.w) - 0.5) * 2.0;
    float w = clamp(pp.y, 0.001, 1.0);
    return 1.0 - smoothstep(w * (1.0 - clamp(pp.z, 0.0, 1.0)), w + 1e-4, d);
}`;

/** Closest approach of a ray to a segment: (distance, distance along the ray). */
const TC_RAYSEG = `float tcLine(float d, float px, float ew) {
    return clamp(0.5 * ew + 0.5 - d / max(px, 1e-7), 0.0, 1.0) * min(ew, 1.0);
}
vec2 tcRaySeg(vec3 ro, vec3 rd, vec3 a, vec3 b) {
    vec3 ba = b - a, w = ro - a;
    float bb = dot(ba, ba), br = dot(ba, rd), wb = dot(w, ba), wr = dot(w, rd);
    float den = bb - br * br;
    float s = clamp(den > 1e-9 ? (wb - wr * br) / den : 0.0, 0.0, 1.0);
    float t = max(s * br - wr, 0.0);
    s = clamp((dot(ro + rd * t - a, ba)) / max(bb, 1e-9), 0.0, 1.0);
    return vec2(length(ro + rd * t - a - ba * s), t);
}`;

/**
 * The march's exact parts (lib/timeCube/march.ts): where a ray first meets a rounded box (rd of unit
 * length; -1 for a miss), after Inigo Quilez's rounded-box intersection; the next highlighted frame
 * after box time g going `dir`; and where in a step to read the volume (a free flight: near the
 * step's start when it is nearly solid, anywhere in it when thin).
 */
const TC_MARCH = `float tcRayRoundBoxIn(vec3 ro, vec3 rd, vec3 b, float r) {
    vec3 size = b - r;
    vec3 m = 1.0 / (rd + vec3(equal(rd, vec3(0.0))) * 1e-12);
    vec3 n = m * ro;
    vec3 k = abs(m) * b;
    vec3 t1 = -n - k, t2 = -n + k;
    float tN = max(max(t1.x, t1.y), t1.z);
    float tF = min(min(t2.x, t2.y), t2.z);
    if (tN > tF || tF < 0.0) return -1.0;
    vec3 s = vec3(greaterThanEqual(ro + tN * rd, vec3(0.0))) * 2.0 - 1.0;
    vec3 o = ro * s, d = rd * s;
    vec3 pos = o + tN * d - size;
    pos = max(pos.xyz, pos.yzx);
    if (min(min(pos.x, pos.y), pos.z) < 0.0) return tN;
    vec3 oc = o - size, dd = d * d, oo = oc * oc, od = oc * d;
    float ra2 = r * r, t = 1e20;
    float bb = od.x + od.y + od.z, c = oo.x + oo.y + oo.z - ra2, h = bb * bb - c;
    if (h > 0.0) t = -bb - sqrt(h);
    float a = dd.y + dd.z; bb = od.y + od.z; c = oo.y + oo.z - ra2; h = bb * bb - a * c;
    if (h > 0.0 && a > 1e-12) { h = (-bb - sqrt(h)) / a; if (h > 0.0 && h < t && abs(o.x + d.x * h) < size.x) t = h; }
    a = dd.z + dd.x; bb = od.z + od.x; c = oo.z + oo.x - ra2; h = bb * bb - a * c;
    if (h > 0.0 && a > 1e-12) { h = (-bb - sqrt(h)) / a; if (h > 0.0 && h < t && abs(o.y + d.y * h) < size.y) t = h; }
    a = dd.x + dd.y; bb = od.x + od.y; c = oo.x + oo.y - ra2; h = bb * bb - a * c;
    if (h > 0.0 && a > 1e-12) { h = (-bb - sqrt(h)) / a; if (h > 0.0 && h < t && abs(o.z + d.z * h) < size.z) t = h; }
    return t > 1e19 ? -1.0 : t;
}
float tcCombOne(float g, float dir, float base, float S, float n) {
    float x = (g - base) / S;
    if (dir > 0.0) {
        float k = max(floor(x) + 1.0, 0.0);
        if (base + k * S <= g) k += 1.0;
        return k > n - 1.0 ? 1e9 : base + k * S;
    }
    float k = min(ceil(x) - 1.0, n - 1.0);
    if (base + k * S >= g) k -= 1.0;
    return k < 0.0 ? -1e9 : base + k * S;
}
float tcCombNext(float g, float dir, vec4 hl) {
    float S = max(hl.y, 1e-4), n = max(floor(hl.z + 0.5), 1.0);
    if (hl.w < 0.5) return tcCombOne(g, dir, hl.x, S, n);
    float m0 = floor(g - hl.x);
    float best = dir * 1e9;
    for (int m = -1; m <= 1; m++) {
        float c = tcCombOne(g, dir, hl.x + m0 + float(m), S, n);
        if (dir > 0.0 ? c < best : c > best) best = c;
    }
    return best;
}
float tcFreeFlight(float j, float sigma, float len) {
    float tau = sigma * len;
    if (tau < 1e-4) return j * len;
    return min(-log(1.0 - j * (1.0 - exp(-tau))) / sigma, len);
}
float tcSide(vec3 p, vec3 B, vec4 st) {
    vec3 w = tcUvt((p + B) * (0.5 / B), st.w);
    return w.z - st.y * (w.x - 0.5) - st.z * (w.y - 0.5);
}
float tcFootprint(vec3 rd, vec3 gd, vec3 gn, float px) {
    float dn = dot(rd, gn);
    vec3 w = gd - gn * (dot(gd, rd) / (abs(dn) > 1e-4 ? dn : (dn < 0.0 ? -1e-4 : 1e-4)));
    w -= rd * dot(w, rd);
    return px * clamp(length(w), 1.0, 12.0);
}`;

/**
 * Space (docs/timecube-space.md): a hash per repeated copy, and the built-in space warps. A warp works in a frame
 * whose z is the box's time axis (ax as in tcUvt: 0 depth, 1 width, 2 height; tcTimeFrame swaps it in and back out),
 * so Twist turns the frames round the line of time and Bend curves time upward. wp = (amount, frequency, phase, 0):
 * Twist and Bend breathe with the phase, Wave and Noise travel with it. mode 1 twist, 2 bend, 3 wave, 4 noise; always
 * a literal, so the compiler folds the choice.
 */
const TC_SPACE = `float tcHash3(vec3 c) {
    return fract(sin(dot(c, vec3(127.1, 311.7, 74.7))) * 43758.5453);
}
vec3 tcTimeFrame(vec3 p, float ax) {
    return ax < 0.5 ? p : ax < 1.5 ? p.zyx : p.xzy;
}
vec3 tcSpaceWarp(vec3 p, float mode, vec4 wp, float ax) {
    vec3 q = tcTimeFrame(p, ax);
    if (mode < 1.5) {
        float a = wp.x * cos(wp.z) * 3.14159265 * wp.y * q.z;
        float c = cos(a), s = sin(a);
        q.xy = vec2(c * q.x - s * q.y, s * q.x + c * q.y);
    } else if (mode < 2.5) {
        float a = wp.x * cos(wp.z) * wp.y * q.z;
        float c = cos(a), s = sin(a);
        q.zy = vec2(c * q.z - s * q.y, s * q.z + c * q.y);
    } else if (mode < 3.5) {
        float w = 6.2831853 * wp.y * q.z + wp.z;
        q.y += 0.25 * wp.x * sin(w);
        q.x += 0.15 * wp.x * sin(0.7 * w + 1.3);
    } else {
        vec3 s = q * (2.0 * wp.y) + wp.z;
        q += 0.2 * wp.x * vec3(sin(1.7 * s.y + cos(2.3 * s.z)), sin(1.9 * s.z + cos(2.1 * s.x)), sin(2.2 * s.x + cos(1.6 * s.y)));
    }
    return tcTimeFrame(q, ax);
}`;

/**
 * The globals a Time Cube Shape (in a Scene Group wired into Time Cube View's Space) talks to the view through: the
 * view sets the box (g_tcB, g_tcR) before it measures the scene; the shape keeps the nearest box's own point (g_tcQ)
 * and its Repeat Scene cell (g_tcCell), with that box's distance (g_tcBest) to compare against.
 */
export const TC_SPACE_GLOBALS = ['g_tcB', 'g_tcR', 'g_tcBest', 'g_tcQ', 'g_tcCell'];
export const TC_SPACE_DECL = 'vec3 g_tcB = vec3(0.0);\nfloat g_tcR = 0.0;\nfloat g_tcBest = 1e9;\nvec3 g_tcQ = vec3(0.0);\nvec3 g_tcCell = vec3(0.0);';

/** A scene function's name, or '' when it is none (unwired, or an empty Scene Group's MISSING_SCENE). */
const liveScene = (name: string | undefined) => (name && !/^MISSING_SCENE/.test(name) ? name : '');

const WARP_CODE: Record<string, string> = { twist: '1.0', bend: '2.0', wave: '3.0', noise: '4.0' };
/** How far each warp can stretch space, per unit of Amount × Frequency ($_Rw: the reach from the warp's axis). */
const WARP_STRETCH: Record<string, string> = { twist: '3.14159265 * $_Rw', bend: '$_Rw', wave: '2.3', noise: '2.5' };
const REP_MASK: Record<string, string> = {
  x: 'vec3(1.0, 0.0, 0.0)', y: 'vec3(0.0, 1.0, 0.0)', z: 'vec3(0.0, 0.0, 1.0)',
  xz: 'vec3(1.0, 0.0, 1.0)', xy: 'vec3(1.0, 1.0, 0.0)', xyz: 'vec3(1.0)',
};

const axisOf = (v: unknown) =>(v === 'x' || v === 'y' ? v : 'z');
const AXIS_CODE: Record<string, string> = { z: '0.0', x: '1.0', y: '2.0' };
const STEPS: Record<string, number> = { draft: 96, good: 160, best: 288 };

// ── Time Cube (the source) ───────────────────────────────────────────────────

/** The source's schema. 2: Start / End (seconds; End 0 the end of the video) are `segments`, set in the clip editor. */
export const TIME_CUBE_SOURCE_VERSION = 2;

/** An older Time Cube's Start / End as one segment (lib/media/clip.ts); a node that has segments keeps them. */
export function migrateTimeCubeSource(params: Record<string, unknown>, fromVersion: number): Record<string, unknown> {
  if (fromVersion >= TIME_CUBE_SOURCE_VERSION) return params;
  const out = { ...params };
  if (!Array.isArray(out.segments)) out.segments = segmentsFromStartEnd(out.start, out.end);
  delete out.start; delete out.end;
  return out;
}

export const TimeCubeNode: NodeDefinition = {
  type: TIME_CUBE_SOURCE_TYPE,
  label: 'Time Cube',
  category: 'Sources',
  aliases: ['Video volume', 'Space-time cube', 'Video cube', 'Frame stack', 'Slit-scan'],
  description: 'Stacks a video\'s frames into a box of time: frame after frame, one behind the other. Wire its Volume into Time Cube View (the box in 3D) or Time Slice (a cut through it, for slit-scan). Starts with the built-in Ball action clip until you choose a video.',
  inputs: {},
  outputs: {
    volume: { type: 'volume', label: 'Volume', hint: 'The stacked frames. Wire into Time Cube View or Time Slice.' },
  },
  defaultParams: {
    source: 'ball', videoId: '', fileName: '', frames: 128, frameWidth: '256', spacing: 'count', step: 0.1,
    // The clip editor's settings (lib/media/clip.ts). An out at or before its in runs to the end of the video.
    segments: [{ in: 0, out: 0 }], clip: { distribute: 'proportional', ramp: 'none', crop: { x: 0, y: 0, w: 1, h: 1 }, rotate: 0, flipX: false, flipY: false },
    _schemaVersion: TIME_CUBE_SOURCE_VERSION,
    combine: 'pick', subFrames: 4, precision: '8', order: 'time', sortBy: 'brightness', invert: false, seed: 1, keyColor: [0.85, 0.12, 0.12], keyTolerance: 0.25,
  },
  paramDefs: {
    frames: { section: 'Stack', label: 'Frames', type: 'float', min: MIN_FRAMES, max: MAX_FRAMES, step: 1, hard: true, showWhen: { param: 'spacing', value: 'count' }, hint: 'How many frames to stack, spread through the clip (Edit clip… on the card).', help: 'How many frames to stack, spread through the clip\'s kept segments (Edit clip… on the card trims the video and adds segments). More frames make a smoother box but take longer to build and more memory (the card shows how much). Up to 256.' },
    spacing: { section: 'Stack', label: 'Spacing', type: 'select', options: [{ value: 'count', label: 'Spread a number of frames' }, { value: 'step', label: 'One frame every…' }], hint: 'Pick frames by count, or one every so many seconds.' },
    step: { section: 'Stack', label: 'Every (s)', type: 'float', min: 0.02, max: 2, step: 0.01, showWhen: { param: 'spacing', value: 'step' }, hint: 'Seconds between stacked frames.' },
    frameWidth: { section: 'Stack', label: 'Frame size', type: 'select', options: FRAME_WIDTHS.map(w => ({ value: String(w), label: `${w} px wide` })), hint: 'How wide each stacked frame is (the height follows the video\'s shape). Bigger is sharper and heavier.' },
    combine: { section: 'Frames from', label: 'Frames from', type: 'select', options: [
      { value: 'pick', label: 'Pick one frame' },
      { value: 'average', label: 'Average (long exposure)' },
      { value: 'max', label: 'Brightest (light trails)' },
      { value: 'min', label: 'Darkest' },
      { value: 'difference', label: 'Motion (only what moved)' },
      { value: 'median', label: 'Median (moving things vanish)' },
    ], hint: 'Each stacked frame is one frame of the video, or several from its slot of time combined.', help: 'Pick takes one frame per slot. The others read Sub-frames frames spread over the slot and combine them: Average is a long exposure (motion blur), Brightest keeps light trails, Darkest dark ones, Motion keeps only what changed, Median keeps what stayed put. They decode Sub-frames times as many frames (the card says how long that takes).' },
    precision: { section: 'Frames from', label: 'Precision', type: 'select', showWhen: { param: 'combine', value: ['average', 'max', 'min', 'difference', 'median'] }, options: [
      { value: '8', label: '8-bit (the video\'s own)' },
      { value: '16', label: '16-bit float' },
    ], hint: 'How finely the combined frames are kept. 16-bit keeps the in-between shades an Average or Median makes (smooth gradients, no banding) and takes twice the memory (the card shows it).' },
    subFrames: { section: 'Frames from', label: 'Sub-frames', type: 'float', min: 2, max: 16, step: 1, hard: true, showWhen: { param: 'combine', value: ['average', 'max', 'min', 'difference', 'median'] }, hint: 'Frames read for each stacked frame when combining.' },
    order: { section: 'Order', label: 'Frame order', type: 'select', options: [
      { value: 'time', label: 'Time' },
      { value: 'reverse', label: 'Reverse' },
      { value: 'shuffle', label: 'Shuffle' },
      { value: 'sort', label: 'Sort' },
    ], hint: 'The order the frames are stacked in. Changing it rearranges the frames already read: nothing is decoded again.' },
    sortBy: { section: 'Order', label: 'Sort by', type: 'select', showWhen: { param: 'order', value: 'sort' }, options: [
      { value: 'brightness', label: 'Brightness' },
      { value: 'hue', label: 'Hue' },
      { value: 'saturation', label: 'Saturation' },
      { value: 'motion', label: 'Motion (change from the frames either side)' },
      { value: 'key', label: 'Amount of a colour' },
    ], hint: 'What to sort by, lowest first.' },
    invert: { section: 'Order', label: 'Invert', type: 'bool', showWhen: { param: 'order', value: 'sort' }, hint: 'Highest first.' },
    seed: { section: 'Order', label: 'Seed', type: 'float', min: 0, max: 999, step: 1, showWhen: { param: 'order', value: 'shuffle' }, hint: 'A different seed, a different shuffle (the same seed always gives the same one).' },
    keyColor: { section: 'Order', label: 'Colour', type: 'vec3color', showWhen: { param: 'order', value: 'sort' }, hint: 'Sort by amount of a colour: the colour.' },
    keyTolerance: { section: 'Order', label: 'Colour tolerance', type: 'float', min: 0, max: 1, step: 0.01, showWhen: { param: 'order', value: 'sort' }, hint: 'Sort by amount of a colour: how close counts.' },
  },
  // Schema 2: Start / End became the clip editor's segments (one segment from Start to End).
  version: TIME_CUBE_SOURCE_VERSION,
  migrateParams: migrateTimeCubeSource,
  assignable: false,
  declarationsFor: timeCubeDeclarations,
  generateGLSL: (node: GraphNode) => ({ code: '', outputVars: { volume: `u_tex_${node.id}` } }),
};

// ── Time Cube View (3D) ──────────────────────────────────────────────────────

/** The view's defaults. The GLSL reads a missing setting (an older save) as its default. */
const VIEW_DEFAULTS = {
  timeMode: 'slice', slice: 0.5, framePos: 0.5, flowSpeed: 0.05, flowTime: 0, before: 0.25, after: 1, sliceOpacity: 1, tiltX: 0, tiltY: 0,
  timeFeather: 0, featherSide: -1, featherCurve: 0,
  roundness: 0.4, feather: 0.18, bulge: 0,
  rimStrength: 0.35, rimWidth: 0.08, rimColor: [0.78, 0.6, 1], tintAmount: 0, tintFrom: [1, 0.8, 0.55], tintTo: [0.7, 0.93, 0.75], tintAlong: 'diagonal',
  shadow: 0, shadowSoftness: 0.3, shadowGap: 0.06,
  highlights: false, motion: false,
  hlCount: 3, hlMode: 'loop', hlStart: 0, hlSpacing: 16, hlThickness: 1, hlOpacity: 0.9, hlTint: 0.25, hlColor: [1, 0.75, 0.35], hlEdge: 0.6, hlOthers: 1, sendThrough: 0,
  motionAt: 'slice', motionWidth: 10, liftUp: 0, liftSide: 0, frameScale: 0, frameTurn: 0, frameFade: 0,
  axis: 'z', depth: 1.6, size: 1, quality: 'good',
  brightness: 0, contrast: 1, darkClear: 0, background: [0.05, 0.05, 0.07],
  keyMode: 'off', keyColor: [0.85, 0.12, 0.12], keyTolerance: 0.12, lumaLo: 0.6, lumaHi: 1, keySoftness: 0.06, keyOpacity: 1, othersOpacity: 0.2, othersGrey: 0.5,
  keyAnimate: false, keyHueShift: 0, keyHueDrift: 0, pulse: 0, pulseDir: 'forward', pulseSpeed: 0.25, pulsePhase: 0, pulseCount: 3, pulseWidth: 0.15, pulseSoftness: 0.5,
  outline: 'off', edgeWidth: 1, edgeOpacity: 0.6, sliceEdge: 0, edgeColor: [0.92, 0.93, 0.96],
  camDist: 3.8, camAngle: 0.6, camElevation: 0.4, rotSpeed: 0, ortho: 0, fov: 1.8, camX: 0, camY: 0, camZ: 0,
  repeat: false, repAxes: 'xz', repGap: 0.5, repCount: 0, repMirror: false, copyTime: 0, copyTimeBy: 'step', copyHue: 0, copySpin: 0,
  warp: 'off', warpWhere: 'each', warpAmount: 0.5, warpFreq: 1, warpSpeed: 0, farDist: 30, spaceFog: 0.3, spaceStep: 0.6,
};

/** The Space section's settings (docs/timecube-space.md): off, the view compiles exactly as it did without them. */
export const SPACE_PARAM_KEYS = ['repeat', 'repAxes', 'repGap', 'repCount', 'repMirror', 'copyTime', 'copyTimeBy', 'copyHue', 'copySpin',
  'warp', 'warpWhere', 'warpAmount', 'warpFreq', 'warpSpeed', 'farDist', 'spaceFog', 'spaceStep'];

/** Is the view drawing in space (repeated, warped, or through a wired Space scene)? Then it marches the space, not one box. */
export function spaceOn(P: Record<string, unknown>, spaceWired = false): boolean {
  return P.repeat === true || (typeof P.warp === 'string' && P.warp in WARP_CODE) || spaceWired;
}

const VIEW_PARAMS: Record<string, ParamDef> = {
  timeMode:     { section: 'Slice', label: 'Time', type: 'select', options: [{ value: 'slice', label: 'Slice (Offset scans the box)' }, { value: 'flow', label: 'Flow (the video flows through the box)' }], hint: 'Slice: the box stands still and Offset moves the crisp frame through it. Flow: the crisp frame stays at Frame position and the video flows through the box past it, wrapping round.' },
  slice:        { section: 'Slice', label: 'Offset', type: 'float', min: 0, max: 1, step: 0.001, hint: 'Where the slice sits in time: 0 the first frame, 1 the last. Wire Time or an LFO into it to sweep.' },
  framePos:     { section: 'Slice', label: 'Frame position', type: 'float', min: 0, max: 1, step: 0.001, showWhen: { param: 'timeMode', value: 'flow' }, hint: 'Flow: where the crisp frame sits in the box, 0 the front (where time starts) to 1 the back.' },
  flowSpeed:    { section: 'Slice', label: 'Flow speed', type: 'float', min: -1, max: 1, step: 0.005, showWhen: { param: 'timeMode', value: 'flow' }, hint: 'Flow: how fast the video moves through the box, in clip lengths a second (0.05 plays the whole clip at the frame every 20 s). Negative runs it backwards.' },
  flowTime:     { section: 'Slice', label: 'Flow time', type: 'float', min: 0, max: 1, step: 0.001, showWhen: { param: 'timeMode', value: 'flow' }, hint: 'Flow: an offset added to the flow, in clip lengths. Wire Time, an LFO or a Play control into it to drive the flow yourself (set Flow speed 0).' },
  before:       { section: 'Slice', label: 'Before opacity', type: 'float', min: 0, max: 1, step: 0.01, hint: 'How solid the frames before the slice are: what half the box\'s length of them hides, looking straight through. 0.5 lets half of what is behind through; 0.25 is a light haze.' },
  after:        { section: 'Slice', label: 'After opacity', type: 'float', min: 0, max: 1, step: 0.01, hint: 'How solid the frames after the slice are, measured the same way. 1 is a solid block whose sides show each frame\'s edge pixels through time.' },
  timeFeather:  { section: 'Slice', label: 'Feather (frames)', type: 'float', min: 0, max: 64, step: 0.5, hint: 'Softens the line between Before and After: the opacity fades from one to the other over this many frames, instead of changing at once at the slice. 0 is the hard line; 12 fades over about a tenth of a 128-frame box.' },
  featherSide:  { section: 'Slice', label: 'Feather side', type: 'float', min: -1, max: 1, step: 0.05, hint: 'Where the fade sits: −1 before the slice (the frames leading up to it fade in), 0 centred on it, 1 after it.' },
  featherCurve: { section: 'Slice', label: 'Feather curve', type: 'float', min: -1, max: 1, step: 0.05, hint: 'The fade\'s shape: 0 smooth at both ends, −1 eases in (stays see-through longer, then firms up near the end), 1 eases out (firms up early).' },
  sliceOpacity: { section: 'Slice', label: 'Slice face', type: 'float', min: 0, max: 1, step: 0.01, hint: 'How solid the frame at the slice is: 1 shows that frame crisply. Lower it with a Feather for an entirely soft look.' },
  tiltX:        { section: 'Slice', label: 'Tilt X°', type: 'float', min: -75, max: 75, step: 0.5, hint: 'Tilts the slice so time runs across the frame from left to right: the slit-scan look.' },
  tiltY:        { section: 'Slice', label: 'Tilt Y°', type: 'float', min: -75, max: 75, step: 0.5, hint: 'Tilts the slice so time runs from bottom to top.' },

  roundness:    { section: 'Shape', label: 'Corner roundness', type: 'float', min: 0, max: 1, step: 0.01, hint: 'Rounds the box\'s corners and edges: 0 a sharp box, 1 a pill.' },
  feather:      { section: 'Shape', label: 'Edge softness', type: 'float', min: 0, max: 1, step: 0.01, hint: 'Feathers the box\'s silhouette and the slice frame\'s border: 0 a crisp edge, higher a soft, blurry one.' },
  bulge:        { section: 'Shape', label: 'Bulge', type: 'float', min: 0, max: 1, step: 0.01, hint: 'Puffs the faces out at their middles, like a cushion.' },

  rimStrength:  { section: 'Glow', label: 'Rim glow', type: 'float', min: 0, max: 1.5, step: 0.01, hint: 'A soft glow of the rim colour round the box\'s silhouette, inside and out. 0 turns it off.' },
  rimWidth:     { section: 'Glow', label: 'Rim width', type: 'float', min: 0.005, max: 0.5, step: 0.005, hint: 'How far the rim glow spreads, in frame heights.' },
  rimColor:     { section: 'Glow', label: 'Rim colour', type: 'vec3color', hint: 'The glow\'s colour.' },
  tintAmount:   { section: 'Glow', label: 'Side tint', type: 'float', min: 0, max: 1, step: 0.01, hint: 'Mixes a two-colour gradient into the frames (not the slice frame): pastel sides with the picture crisp on the face.' },
  tintFrom:     { section: 'Glow', label: 'Tint from', type: 'vec3color', hint: 'The gradient\'s first colour.' },
  tintTo:       { section: 'Glow', label: 'Tint to', type: 'vec3color', hint: 'The gradient\'s second colour.' },
  tintAlong:    { section: 'Glow', label: 'Tint along', type: 'select', options: [{ value: 'diagonal', label: 'Diagonal' }, { value: 'time', label: 'Time (first to last frame)' }, { value: 'height', label: 'Height (bottom to top)' }], hint: 'Which way the tint\'s gradient runs.' },
  shadow:       { section: 'Glow', label: 'Shadow', type: 'float', min: 0, max: 1, step: 0.01, hint: 'A soft shadow on the ground beneath the box. 0 turns it off.' },
  shadowSoftness: { section: 'Glow', label: 'Shadow softness', type: 'float', min: 0.01, max: 1.5, step: 0.01, hint: 'How blurred the shadow is, in frame heights.' },
  shadowGap:    { section: 'Glow', label: 'Shadow gap', type: 'float', min: 0, max: 2, step: 0.01, hint: 'How far below the box the ground is, in frame heights.' },

  highlights:   { section: 'Highlights', label: 'Highlight frames', type: 'bool', hint: 'Turns highlighted frames on (one recompile; the sliders below are then live).' },
  hlCount:      { section: 'Highlights', label: 'Count', type: 'float', showWhen: { param: 'highlights', value: 'true' }, min: 0, max: 32, step: 1, hint: 'How many frames to highlight. 0 turns highlights off.' },
  hlMode:       { section: 'Highlights', label: 'Highlights move', type: 'select', showWhen: { param: 'highlights', value: 'true' }, options: [{ value: 'loop', label: 'With the slice, looping round' }, { value: 'follow', label: 'With the slice' }, { value: 'fixed', label: 'Fixed (from the first frame)' }], hint: 'Whether the highlighted frames travel with Offset; looping, they wrap round the box so as you scan they come round again and again.' },
  hlStart:      { section: 'Highlights', label: 'Start (frames)', type: 'float', showWhen: { param: 'highlights', value: 'true' }, min: -128, max: 128, step: 1, hint: 'The first highlighted frame: frames from the slice (or from the first frame, when Fixed).' },
  hlSpacing:    { section: 'Highlights', label: 'Spacing (frames)', type: 'float', showWhen: { param: 'highlights', value: 'true' }, min: 1, max: 128, step: 1, hint: 'Frames from one highlighted frame to the next.' },
  hlThickness:  { section: 'Highlights', label: 'Thickness (frames)', type: 'float', showWhen: { param: 'highlights', value: 'true' }, min: 0.25, max: 16, step: 0.05, hint: 'How many frames thick each highlight is.' },
  hlOpacity:    { section: 'Highlights', label: 'Opacity', type: 'float', showWhen: { param: 'highlights', value: 'true' }, min: 0, max: 1, step: 0.01, hint: 'How solid a highlighted frame is, as a sheet: 1 hides what is behind it.' },
  hlTint:       { section: 'Highlights', label: 'Tint', type: 'float', showWhen: { param: 'highlights', value: 'true' }, min: 0, max: 1, step: 0.01, hint: 'Mixes the highlight colour into the highlighted frames.' },
  hlColor:      { section: 'Highlights', label: 'Colour', type: 'vec3color', showWhen: { param: 'highlights', value: 'true' }, hint: 'The highlight colour (tint and outline).' },
  hlEdge:       { section: 'Highlights', label: 'Outline', type: 'float', showWhen: { param: 'highlights', value: 'true' }, min: 0, max: 1, step: 0.01, hint: 'A line round each highlighted frame, in the highlight colour.' },
  hlOthers:     { section: 'Highlights', label: 'Others', type: 'float', showWhen: { param: 'highlights', value: 'true' }, min: 0, max: 1, step: 0.01, hint: 'Opacity of the frames that are not highlighted, times Before / After: lower makes the highlights stand alone.' },
  sendThrough:  { section: 'Highlights', label: 'Send through', type: 'float', showWhen: { param: 'highlights', value: 'true' }, min: 0, max: 1, step: 0.01, hint: 'Sends the first highlighted frame\'s picture through the whole box: at 1 every frame is that one (a slit-scan of a single frame).' },

  motion:       { section: 'Frame motion', label: 'Move frames', type: 'bool', whenOn: { liftUp: 0.3, frameScale: 0.25 }, hint: 'Turns frame motion on (one recompile; the sliders below are then live). Starts with a gentle lift and grow, so you can see it.' },
  motionAt:     { section: 'Frame motion', label: 'Moves frames near', type: 'select', showWhen: { param: 'motion', value: 'true' }, options: [{ value: 'slice', label: 'The slice' }, { value: 'highlights', label: 'The highlighted frames' }, { value: 'both', label: 'Both' }], hint: 'Where the wave that moves frames sits. It travels with Offset.' },
  motionWidth:  { section: 'Frame motion', label: 'Falloff (frames)', type: 'float', showWhen: { param: 'motion', value: 'true' }, min: 0.5, max: 128, step: 0.5, hint: 'How many frames either side the wave reaches, easing off.' },
  liftUp:       { section: 'Frame motion', label: 'Lift', type: 'float', showWhen: { param: 'motion', value: 'true' }, min: -1, max: 1, step: 0.01, hint: 'Lifts the frames in the wave up (frame heights).' },
  liftSide:     { section: 'Frame motion', label: 'Lift sideways', type: 'float', showWhen: { param: 'motion', value: 'true' }, min: -1, max: 1, step: 0.01, hint: 'Moves them sideways (frame heights).' },
  frameScale:   { section: 'Frame motion', label: 'Scale', type: 'float', showWhen: { param: 'motion', value: 'true' }, min: -0.9, max: 2, step: 0.01, hint: 'Grows (or shrinks) them: 0.5 makes the frame at the top of the wave half as big again.' },
  frameTurn:    { section: 'Frame motion', label: 'Turn°', type: 'float', showWhen: { param: 'motion', value: 'true' }, min: -180, max: 180, step: 0.5, hint: 'Turns them in their own plane.' },
  frameFade:    { section: 'Frame motion', label: 'Fade', type: 'float', showWhen: { param: 'motion', value: 'true' }, min: 0, max: 1, step: 0.01, hint: 'Fades them out: 1 makes the frame at the top of the wave clear.' },


  axis:         { section: 'Box', label: 'Stack along', type: 'select', options: [{ value: 'z', label: 'Depth (frames one behind another)' }, { value: 'x', label: 'Width (frames side by side)' }, { value: 'y', label: 'Height (frames stacked up)' }], hint: 'Which way time runs through the box.' },
  depth:        { section: 'Box', label: 'Time stretch', type: 'float', min: 0.1, max: 6, step: 0.01, hint: 'How long the box is in time, against the frame\'s height of 1.' },
  size:         { section: 'Box', label: 'Box size', type: 'float', min: 0.1, max: 4, step: 0.01, hint: 'Scales the whole box.' },
  quality:      { section: 'Box', label: 'Quality', type: 'select', options: [{ value: 'draft', label: 'Draft (96 steps)' }, { value: 'good', label: 'Good (160 steps)' }, { value: 'best', label: 'Best (288 steps)' }], hint: 'Samples along each ray. More is smoother through time and slower.' },

  brightness:   { section: 'Look', label: 'Brightness', type: 'float', min: -1, max: 1, step: 0.01, hint: 'Added to every frame\'s colour.' },
  contrast:     { section: 'Look', label: 'Contrast', type: 'float', min: 0, max: 3, step: 0.01, hint: 'Spreads the colours away from mid grey (1 = as they are).' },
  darkClear:    { section: 'Look', label: 'Dark is clear', type: 'float', min: -1, max: 1, step: 0.01, hint: 'Above 0 makes dark pixels see-through (footage on black); below 0 makes light pixels see-through (footage on white, or a light background).' },
  background:   { section: 'Look', label: 'Background', type: 'vec3color', hint: 'Behind the box (unless something is wired to Background).' },

  // The colour key, in three parts: what to keep, what happens to everything else, and the animation.
  keyMode:      { section: 'Colour key', label: 'Keep', type: 'select', options: [{ value: 'off', label: 'Off' }, { value: 'color', label: 'A colour' }, { value: 'hue', label: 'A hue (any shade of it)' }, { value: 'luma', label: 'A brightness range' }], hint: 'Keep one colour solid through time and fade everything else. The card shows how much of the video it keeps; pick a colour from the slice frame there.' },
  keyColor:     { section: 'Colour key', label: 'Colour', type: 'vec3color', showWhen: { param: 'keyMode', value: ['color', 'hue'] }, hint: 'The colour to keep. Click a swatch under the settings to take one from the slice frame.' },
  keyTolerance: { section: 'Colour key', label: 'How close', type: 'float', min: 0, max: 1, step: 0.005, showWhen: { param: 'keyMode', value: ['color', 'hue'] }, hint: 'How far from the colour still counts: about 0.1 keeps close shades only, 0.3 a broad range. Raise it if the card says it keeps nothing.' },
  lumaLo:       { section: 'Colour key', label: 'Brightness from', type: 'float', min: 0, max: 1, step: 0.01, showWhen: { param: 'keyMode', value: 'luma' }, pair: { with: 'lumaHi', label: 'Brightness range' }, hint: 'The darkest brightness kept.' },
  lumaHi:       { section: 'Colour key', label: 'Brightness to', type: 'float', min: 0, max: 1, step: 0.01, showWhen: { param: 'keyMode', value: 'luma' }, hint: 'The brightest brightness kept.' },
  keySoftness:  { section: 'Colour key', label: 'Soft edge', type: 'float', min: 0, max: 0.5, step: 0.005, showWhen: { param: 'keyMode', value: ['color', 'hue', 'luma'] }, hint: 'Fades the match in over this much more, instead of a hard cut.' },
  keyOpacity:   { section: 'Colour key', label: 'Kept opacity', type: 'float', min: 0, max: 1, step: 0.01, showWhen: { param: 'keyMode', value: ['color', 'hue', 'luma'] }, hint: 'How solid what is kept is, before and after the slice alike: 1 leaves a solid trail through time.' },
  keyHueShift:  { section: 'Colour key', label: 'Shift the colour', type: 'float', min: -1, max: 1, step: 0.005, showWhen: { param: 'keyMode', value: ['color', 'hue'] }, hint: 'Turns the colour to keep round the colour wheel (1 = once round). Map it to an LFO or a knob on Play to sweep which colour is kept.' },

  othersOpacity:{ section: 'Key: everything else', label: 'Opacity', type: 'float', min: 0, max: 1, step: 0.01, showWhen: { param: 'keyMode', value: ['color', 'hue', 'luma'] }, hint: 'How solid everything that is not kept is, times Before / After: 0 hides it, low makes it a ghost.' },
  othersGrey:   { section: 'Key: everything else', label: 'Drain colour', type: 'float', min: 0, max: 1, step: 0.01, showWhen: { param: 'keyMode', value: ['color', 'hue', 'luma'] }, hint: 'Turns everything that is not kept grey: 1 fully.' },

  keyAnimate:   { section: 'Key: animate', label: 'Animate the key', type: 'bool', whenOn: { pulse: 1 }, hint: 'Makes what is kept pulse through the box or drift round the colour wheel (needs Keep set above). Starts with pulses, so you can see it.' },
  keyHueDrift:  { section: 'Key: animate', label: 'Colour drift', type: 'float', min: -1, max: 1, step: 0.005, showWhen: { param: 'keyAnimate', value: 'true' }, hint: 'Turns the colour to keep round the wheel on its own, in turns a second (a colour or hue key).' },
  pulse:        { section: 'Key: animate', label: 'Pulse', type: 'float', min: 0, max: 1, step: 0.01, showWhen: { param: 'keyAnimate', value: 'true' }, hint: 'Shows what is kept only in bands that travel through time: 1 fully, 0 no pulse (all of it shows).' },
  pulseDir:     { section: 'Key: animate', label: 'Pulse direction', type: 'select', options: [{ value: 'forward', label: 'Forward (first to last frame)' }, { value: 'backward', label: 'Backward' }, { value: 'bounce', label: 'Back and forth' }, { value: 'outward', label: 'Out from the slice' }], showWhen: { param: 'keyAnimate', value: 'true' }, hint: 'Which way the bands travel.' },
  pulseSpeed:   { section: 'Key: animate', label: 'Pulse speed', type: 'float', min: -4, max: 4, step: 0.01, showWhen: { param: 'keyAnimate', value: 'true' }, hint: 'Bands a second.' },
  pulsePhase:   { section: 'Key: animate', label: 'Pulse position', type: 'float', min: 0, max: 1, step: 0.001, showWhen: { param: 'keyAnimate', value: 'true' }, hint: 'Moves the bands by hand (or from an LFO or Play): one band spacing across 0–1.' },
  pulseCount:   { section: 'Key: animate', label: 'Bands', type: 'float', min: 1, max: 16, step: 1, showWhen: { param: 'keyAnimate', value: 'true' }, hint: 'How many bands at once along the box.' },
  pulseWidth:   { section: 'Key: animate', label: 'Band width', type: 'float', min: 0.01, max: 1, step: 0.01, showWhen: { param: 'keyAnimate', value: 'true' }, hint: 'How much of the space between bands each band fills.' },
  pulseSoftness:{ section: 'Key: animate', label: 'Band softness', type: 'float', min: 0, max: 1, step: 0.01, showWhen: { param: 'keyAnimate', value: 'true' }, hint: 'Soft (1) or hard (0) band edges.' },

  outline:      { section: 'Outline', label: 'Outline', type: 'select', options: [{ value: 'off', label: 'Off' }, { value: 'silhouette', label: 'Silhouette (follows the soft shape)' }, { value: 'edges', label: 'Box edges (wireframe)' }], hint: 'A thin line round the box: its outer silhouette, or all twelve edges (the back ones behind the frames).' },
  edgeWidth:    { section: 'Outline', label: 'Line width', type: 'float', min: 0, max: 6, step: 0.1, hint: 'Thickness of the lines in pixels (the outline, the slice outline and the highlight outlines). 0 hides them.' },
  edgeOpacity:  { section: 'Outline', label: 'Line opacity', type: 'float', min: 0, max: 1, step: 0.01, hint: 'How strong the outline is.' },
  sliceEdge:    { section: 'Outline', label: 'Slice outline', type: 'float', min: 0, max: 1, step: 0.01, hint: 'A line round the slice frame.' },
  edgeColor:    { section: 'Outline', label: 'Line colour', type: 'vec3color', hint: 'Colour of the outline and the slice outline.' },


  camDist:      { section: 'Camera', label: 'Cam Distance', type: 'float', min: 0.5, max: 20, step: 0.05, hint: 'How far the built-in camera is from the box (when Ray Origin / Ray Dir are not wired).' },
  camAngle:     { section: 'Camera', label: 'Angle', type: 'float', min: -6.28, max: 6.28, step: 0.01, hint: 'Orbit angle round the box, in radians.' },
  camElevation: { section: 'Camera', label: 'Elevation', type: 'float', min: -1.5, max: 1.5, step: 0.01, hint: 'Height of the camera: 0 level, up to 1.5 looking straight down. 0.62 is the isometric angle.' },
  rotSpeed:     { section: 'Camera', label: 'Orbit speed', type: 'float', min: -2, max: 2, step: 0.01, hint: 'Turns the camera round the box over time (radians a second).' },
  camX:         { section: 'Camera', label: 'Translate X', type: 'float', min: -5, max: 5, step: 0.01, hint: 'Moves the camera, and the point it looks at, sideways (world units: the frame is 1 high). Angle, Elevation and Orbit still turn round the moved point. Map it on Play to fly past the box.' },
  camY:         { section: 'Camera', label: 'Translate Y', type: 'float', min: -5, max: 5, step: 0.01, hint: 'Moves the camera and the point it looks at up or down.' },
  camZ:         { section: 'Camera', label: 'Translate Z', type: 'float', min: -5, max: 5, step: 0.01, hint: 'Moves the camera and the point it looks at along the box\'s depth (time, when frames stack in depth): fly through the box.' },
  ortho:        { section: 'Camera', label: 'Flatten (isometric)', type: 'float', min: 0, max: 1, step: 0.01, hint: 'From perspective (0) to orthographic (1): parallel edges stay parallel, like an isometric drawing.' },
  fov:          { section: 'Camera', label: 'Zoom', type: 'float', min: 0.5, max: 5, step: 0.01, hint: 'Lens length: higher is zoomed in, with less perspective. With a March Camera wired, set it to that camera\'s FOV so lines stay the same width.' },

  // Space (docs/timecube-space.md): the box in repeated or warped space. Repeat and Warp are switches (one recompile);
  // their sliders are then live. Off, and with nothing wired into Space, the view is drawn exactly as before.
  repeat: { section: 'Repeat', label: 'Repeat the box', type: 'bool', hint: 'Copies of the box on a grid, as far as you can see or a set number each side (one recompile; the sliders below are then live). Highlights, Frame motion, the shadow and box-edge outlines are left out in space.' },
  repAxes: { section: 'Repeat', label: 'Repeat along', type: 'select', showWhen: { param: 'repeat', value: 'true' }, options: [
    { value: 'xz', label: 'A floor (X and Z)' }, { value: 'x', label: 'A row (X, side to side)' }, { value: 'z', label: 'A line into the distance (Z)' },
    { value: 'y', label: 'A tower (Y, up)' }, { value: 'xy', label: 'A wall (X and Y)' }, { value: 'xyz', label: 'Everywhere (X, Y and Z)' },
  ], hint: 'Which ways the copies go.' },
  repGap: { section: 'Repeat', label: 'Gap', type: 'float', min: 0, max: 6, step: 0.01, showWhen: { param: 'repeat', value: 'true' }, hint: 'Space between neighbouring boxes, in frame heights (times Box size). 0 packs them edge to edge.' },
  repCount: { section: 'Repeat', label: 'Copies each side', type: 'float', min: 0, max: 20, step: 1, showWhen: { param: 'repeat', value: 'true' }, hint: 'How many copies each side of the middle one. 0 goes on forever (up to Far).' },
  repMirror: { section: 'Repeat', label: 'Mirror every other', type: 'bool', showWhen: { param: 'repeat', value: 'true' }, hint: 'Flips every other copy, so neighbours face each other: a kaleidoscope hall.' },
  copySpin: { section: 'Repeat', label: 'Turn per copy°', type: 'float', min: 0, max: 180, step: 0.5, showWhen: { param: 'repeat', value: 'true' }, hint: 'Turns each copy round its upright axis by a random angle up to this either way. The grid spaces out to fit the turned boxes. (With a Repeat Scene in Space, turn copies inside its Scene Group: a Rotate driven by Repeat Cell.)' },
  // Per copy: the view's own Repeat, or a Repeat Scene in the wired Space (its cell).
  copyTime: { section: 'Copies', label: 'Time per copy', type: 'float', min: -1, max: 1, step: 0.005, hint: 'Moves each copy\'s slice (in Flow, its flow) along by this much of the clip, so each copy shows a different moment. Copies of Repeat the box, or of a Repeat Scene wired into Space.' },
  copyTimeBy: { section: 'Copies', label: 'Time steps by', type: 'select', options: [
    { value: 'step', label: 'Place (one step per copy)' }, { value: 'distance', label: 'Distance from the middle' }, { value: 'random', label: 'Random per copy' },
  ], hint: 'How Time per copy is shared out: copy by copy across the grid, in rings out from the middle copy, or at random.' },
  copyHue: { section: 'Copies', label: 'Hue per copy', type: 'float', min: 0, max: 1, step: 0.01, hint: 'Turns each copy\'s colours round the colour wheel by a random amount up to this (1 = all the way round).' },
  warp: { section: 'Warp', label: 'Warp', type: 'select', options: [
    { value: 'off', label: 'Off' }, { value: 'twist', label: 'Twist (frames turn along time)' }, { value: 'bend', label: 'Bend (time curves up)' },
    { value: 'wave', label: 'Wave (time snakes)' }, { value: 'noise', label: 'Noise (wobbly space)' },
  ], hint: 'Warps the space the box is in (one recompile; the sliders below are then live). For any other warp, wire a Scene Group with a Time Cube Shape into Space.' },
  warpWhere: { section: 'Warp', label: 'Warp what', type: 'select', showWhen: { param: 'warp', value: ['twist', 'bend', 'wave', 'noise'] }, options: [
    { value: 'each', label: 'Each box (every copy the same)' }, { value: 'space', label: 'The whole space (copies differ)' },
  ], hint: 'Each box: every copy is warped alike, round its own middle. The whole space: the warp runs through the grid, so copies far from the middle are warped most.' },
  warpAmount: { section: 'Warp', label: 'Warp amount', type: 'float', min: -2, max: 2, step: 0.01, showWhen: { param: 'warp', value: ['twist', 'bend', 'wave', 'noise'] }, hint: 'How strong the warp is. Twist 1 turns half a turn per frame height of time.' },
  warpFreq: { section: 'Warp', label: 'Warp frequency', type: 'float', min: 0.05, max: 6, step: 0.01, showWhen: { param: 'warp', value: ['twist', 'bend', 'wave', 'noise'] }, hint: 'How tightly it repeats along time: more waves, a tighter twist.' },
  warpSpeed: { section: 'Warp', label: 'Warp speed', type: 'float', min: -4, max: 4, step: 0.01, showWhen: { param: 'warp', value: ['twist', 'bend', 'wave', 'noise'] }, hint: 'Animates it: Twist and Bend breathe back and forth, Wave and Noise travel along time (radians a second).' },
  farDist:      { section: 'Space', label: 'Far', type: 'float', min: 2, max: 120, step: 0.5, hint: 'In space (Repeat, a Warp or Space wired): how far rays look, in frame heights. Further shows more copies and costs more.' },
  spaceFog:     { section: 'Space', label: 'Fog', type: 'float', min: 0, max: 2, step: 0.01, hint: 'In space: fades far copies into the Background, so an endless grid fades out instead of turning to grain.' },
  spaceStep:    { section: 'Space', label: 'Step (wired Space)', type: 'float', min: 0.1, max: 1, step: 0.01, hint: 'With a Scene Group wired into Space: how far the ray steps of the distance its warps report, like a March Loop\'s Step Scale. Lower it if a strong warp tears or speckles the boxes; higher is faster.' },
};

/**
 * Is the key's animation (pulse, colour drift) on? Its switch; a save from before the switch
 * counts as on when it animates (a pulse or drift set).
 */
export function keyAnimOn(P: Record<string, unknown>): boolean {
  if (P.keyAnimate !== undefined) return P.keyAnimate === true;
  const num = (v: unknown) => (typeof v === 'number' ? v : 0);
  return num(P.pulse) > 0 || num(P.keyHueDrift) !== 0;
}

/**
 * Settings Time Cube View no longer has (schema 2): the camera's Swing, the key's Lightning, the Focus
 * (depth of field) and Frame effects sections. A graph saved with them loads without them (and
 * their keyframes); a swinging camera becomes the nearest plain one (swingToOrbit).
 */
export const REMOVED_VIEW_PARAMS = [
  'swing', 'lightning', 'lightningRate', 'lightningWidth', 'lightningSeed',
  'dof', 'blur', 'focus', 'maxBlur', 'blurQuality', 'effects', 'fxHue', 'fxPosterize', 'fxAgeGrey',
];

/**
 * The plain camera nearest a swinging one. Swing rocked the angle by ± Swing radians round Angle,
 * Orbit speed setting how fast (angle = Angle + Swing × sin(Orbit speed × t)). A small swing stays
 * near Angle: a still camera there. A wide one (more than about a quarter turn each way) went most
 * of the way round: an orbit at its average speed, 2 / π × Swing × Orbit speed radians a second.
 */
export function swingToOrbit(swing: number, rotSpeed: number): number {
  if (!(swing > 0) || rotSpeed === 0) return rotSpeed;
  return swing < 1.5 ? 0 : (2 / Math.PI) * swing * rotSpeed;
}

function dropRemovedViewParams(params: Record<string, unknown>): Record<string, unknown> {
  const out = { ...params };
  if (typeof out.swing === 'number' && out.swing > 0) {
    out.rotSpeed = swingToOrbit(out.swing, typeof out.rotSpeed === 'number' ? out.rotSpeed : 0);
  }
  for (const k of REMOVED_VIEW_PARAMS) { delete out[k]; delete out[`__keyframes_${k}`]; }
  // The settings added with schema 2, at values that change nothing, so they are live uniforms (and
  // on Play's list) straight away: a setting missing from a node is baked in, not a uniform.
  for (const [k, v] of Object.entries(ADDED_VIEW_PARAMS)) if (typeof out[k] !== 'number') out[k] = v;
  return out;
}
const ADDED_VIEW_PARAMS = { camX: 0, camY: 0, camZ: 0, timeFeather: 0, featherSide: -1, featherCurve: 0 };

/**
 * Time Cube View's schema. 2: the opacity sliders (Before, After, Kept) are what half the box's
 * length hides (plan.ts OPACITY_REF), even from 0 to 1; before, they were what the whole box hid and
 * jumped to solid above 0.95. Loading an older graph converts them (plan.ts migrateOpacity), and
 * drops the settings the view no longer has (REMOVED_VIEW_PARAMS).
 */
export const TIME_CUBE_VIEW_VERSION = 2;
const OPACITY_PARAMS = new Set(['before', 'after', 'keyOpacity']);

/** The axes across a frame (not time), per stack axis: the march's box grows along them for moved frames. */
const PERP: Record<string, string> = { z: 'vec3(1.0, 1.0, 0.0)', x: 'vec3(0.0, 1.0, 1.0)', y: 'vec3(1.0, 0.0, 1.0)' };

export const TimeCubeViewNode: NodeDefinition = {
  type: TIME_CUBE_VIEW_TYPE,
  label: 'Time Cube View',
  category: '3D Scene',
  simpleParams: ['timeMode', 'before', 'after', 'timeFeather', 'roundness', 'feather', 'rimStrength', 'rimWidth', 'depth', 'quality', 'background', 'camDist', 'camAngle', 'camElevation', 'rotSpeed'],
  aliases: ['Video volume render', 'Space-time cube', 'Volume render', 'Time box', 'Video pill'],
  description: 'Draws a Time Cube as a soft, rounded box in 3D: earlier frames see-through, later ones solid, the frame at the slice crisp. Rim glow, side tint and shadow; highlighted frames that travel and loop as you scan; frames that lift, scale and fade as the slice passes. Has its own orbit camera, or takes a March Camera\'s rays to sit in a 3D scene.',
  brief: {
    summary: 'A video as a box of time, ray-marched front to back. The slice (Offset) splits it: frames before it are see-through, frames after it solid, and the frame at the slice shows crisply. Shape and Glow set the look; Highlights pick out frames; Frame motion lifts frames as the slice passes.',
    start: [
      'Wire a Time Cube\'s Volume in and the Color out to the Output.',
      'Drag Offset, or wire an LFO (amplitude 0.5, offset 0.5) into it to sweep through time.',
      'Before / After opacity: 0.5 is half see-through, 1 solid. Feather (frames) fades the line at the slice into a gradient over that many frames.',
      'Shape: Corner roundness and Edge softness. Glow: a rim, a pastel side tint, a shadow; set Background light for the soft-pill look.',
      'Highlights: Count above 0 picks out frames Spacing apart; they travel with Offset and loop round. Frame motion: Lift moves frames up as the slice passes.',
      'To place it in a raymarched scene: wire a March Camera\'s Ray Origin and Ray Dir in, the March Loop\'s Color into Background and its Distance into Scene distance.',
    ],
  },
  inputs: {
    volume: { type: 'volume', label: 'Volume', hint: 'A Time Cube\'s Volume.' },
    slice: { type: 'float', label: 'Offset', hint: 'Where the slice is in time, 0–1. Wire Time or an LFO here to sweep.' },
    flowTime: { type: 'float', label: 'Flow time', hint: 'Flow mode: drives the flow (in clip lengths), added to Flow speed × time.' },
    ro: { type: 'vec3', label: 'Ray Origin', hint: 'A March Camera\'s Ray Origin. Unwired: the built-in orbit camera.' },
    rd: { type: 'vec3', label: 'Ray Dir', hint: 'A March Camera\'s Ray Dir.' },
    background: { type: 'vec3', label: 'Background', hint: 'What is behind the box: e.g. a March Loop\'s Color, so the box sits in that scene.' },
    sceneDist: { type: 'float', label: 'Scene distance', hint: 'A March Loop\'s Distance (with the same camera): scene surfaces nearer than the box hide it.' },
    space: { type: 'scene3d', label: 'Space', hint: 'A Scene Group with a Time Cube Shape in it: the box drawn wherever that shape is, through the group\'s warps (Twist, Bend, the Warp Builder…) and a Repeat Scene. See docs/timecube-space.md.' },
  },
  outputs: {
    color: { type: 'vec3', label: 'Color', hint: 'The box over the background.' },
    alpha: { type: 'float', label: 'Alpha', hint: 'How much of this pixel the box covers, with its glow, outline and shadow.' },
  },
  // Schema 2: Before / After / Kept opacity are measured over half the box (plan.ts OPACITY_REF), so
  // the sliders are even; graphs saved before are converted on load to look as they did.
  defaultParams: { ...VIEW_DEFAULTS, _schemaVersion: TIME_CUBE_VIEW_VERSION },
  version: TIME_CUBE_VIEW_VERSION,
  migrateParamValue: (key, value, fromVersion) =>
    fromVersion < TIME_CUBE_VIEW_VERSION && OPACITY_PARAMS.has(key) && typeof value === 'number' ? migrateOpacity(value) : value,
  migrateParams: (params, fromVersion) => {
    if (fromVersion >= TIME_CUBE_VIEW_VERSION) return params;
    const out = dropRemovedViewParams(params);
    for (const k of OPACITY_PARAMS) {
      // A node saved without the setting drew the old default.
      const v = typeof out[k] === 'number' ? out[k] as number : (k === 'before' ? 0.45 : 1);
      out[k] = migrateOpacity(v);
      const kf = out[`__keyframes_${k}`];
      if (Array.isArray(kf)) {
        out[`__keyframes_${k}`] = kf.map(e => (e && typeof e === 'object' && typeof (e as { v?: unknown }).v === 'number'
          ? { ...e, v: migrateOpacity((e as { v: number }).v) } : e));
      }
    }
    return out;
  },
  paramDefs: VIEW_PARAMS,
  assignable: false,
  glslFunctions: [TC_TILE, TC_SAMPLE, TC_FRAMES, TC_DEPTH, TC_FEATHER, TC_HUESAT, TC_KEY, TC_UVT, TC_SHAPE, TC_MOTION, TC_HUETURN, TC_PULSE, TC_RAYSEG, TC_MARCH, TC_SPACE],
  // The globals a Time Cube Shape in the wired Space scene writes (the compiler also adds them when only a shape is used).
  declarationsFor: (node: GraphNode) => (node.inputs?.space?.connection ? [TC_SPACE_DECL] : []),
  generateGLSL: (node: GraphNode, inputVars) => {
    const id = node.id, P = node.params;
    const D = VIEW_DEFAULTS as Record<string, unknown>;
    const f = (k: string) => p(P[k], D[k] as number);
    const c3 = (k: string) => pv3(P[k], D[k] as number[]);
    const V = inputVars.volume;
    const bg = inputVars.background ?? c3('background');
    if (!V) {
      return { code: `    vec3 ${id}_color = ${bg};\n    float ${id}_alpha = 0.0;\n`, outputVars: { color: `${id}_color`, alpha: `${id}_alpha` } };
    }
    const axis = axisOf(P.axis);
    const AX = AXIS_CODE[axis];
    const steps = STEPS[String(P.quality)] ?? STEPS.good;
    const keyMode = P.keyMode === 'color' || P.keyMode === 'hue' || P.keyMode === 'luma' ? P.keyMode : 'off';
    const hlMode = P.hlMode === 'follow' || P.hlMode === 'fixed' ? P.hlMode : 'loop';
    const motionAt = P.motionAt === 'highlights' || P.motionAt === 'both' ? P.motionAt : 'slice';
    const tintAlong = P.tintAlong === 'time' || P.tintAlong === 'height' ? P.tintAlong : 'diagonal';
    const outline = P.outline === 'silhouette' || P.outline === 'edges' ? P.outline : 'off';
    const flow = P.timeMode === 'flow';
    const pulseDir = P.pulseDir === 'backward' || P.pulseDir === 'bounce' || P.pulseDir === 'outward' ? P.pulseDir : 'forward';
    // Optional features are switched on by a toggle (one recompile); their sliders are then live. Off,
    // their code is left out of the march, which keeps the plain view as fast as it was.
    const ANIM = keyAnimOn(P);
    // Space (docs/timecube-space.md): repeated or warped, or through a wired Space scene, the view marches the space
    // instead of one box. Highlights and Frame motion are left out there (their exact per-box sheets need the box).
    const spaceFn = liveScene(inputVars.space);
    const SPACE = spaceOn(P, !!spaceFn);
    const HL = P.highlights === true && !SPACE, MOT = P.motion === true && !SPACE;
    const lay = volLayout(V), inset = volPx(V);
    const slice = inputVars.slice ?? f('slice');
    const wired = !!(inputVars.ro && inputVars.rd);
    const look = (c: string) => `clamp((${c} - 0.5) * ${f('contrast')} + 0.5 + ${f('brightness')}, 0.0, 1.0)`;
    const edgeCol = c3('edgeColor');
    const timeLen = axis === 'x' ? '$_B.x' : axis === 'y' ? '$_B.y' : '$_B.z';
    const half = axis === 'x' ? 'vec3($_dep, 1.0, $_asp)' : axis === 'y' ? 'vec3($_asp, $_dep, 1.0)' : 'vec3($_asp, 1.0, $_dep)';
    /** The shape at a point, with frame motion; `w` (the volume point to read) and `b` (the bump) must be declared. */
    const shapeAt = (pt: string, w: string, b: string) => `tcShapeAt(${pt}, $_B, $_rb, $_st, $_hl, $_mw, $_mv, $_asp, ${w}, ${b})`;
    /** A pixel's width in world units at distance t along the ray (perspective, or flat when orthographic). */
    const pixAt = (t: string) => `($_pix * (${t} * (1.0 - $_or) + $_cd * $_or))`;
    /** The clip time read at box time z: z itself, or in Flow the video moved through the box (style.ts flowTime). */
    const tmap = (z: string) => (flow ? `fract(${z} + $_fsh)` : z);
    /** The time to read at box time z: mapped (Flow), then sent through (the first highlighted frame's picture). */
    const timeAt = (z: string) => (HL ? `mix(${tmap(z)}, $_sendT, $_send)` : tmap(z));
    /** The volume at a frame point `w`. */
    const sampleAt = (w: string) => `tcSample(${V}, ${lay}, ${inset}, vec3(${w}.xy, ${timeAt(`${w}.z`)}))`;
    /** Frame motion's fade, when on. */
    const fadeBy = (b: string) => (MOT ? ` * (1.0 - $_fade * ${b})` : '');
    /**
     * Where the ray meets a box of half size `bx`, into `en` / `ex` (lib/timeCube/march.ts). A plain
     * rounded box seen from outside its bounds is met exactly (tcRayRoundBoxIn, and the same test from
     * beyond the box looking back for the exit): sphere tracing ran out of steps on rays that skim a
     * face, which cut wedges and flat bevels out of the box and left curved sheets over moved frames.
     * A bulging box, or a camera inside the bounds, is sphere traced (64 steps). With `md` / `tS`, also
     * the least distance to it along the ray (minus how deep, when the ray goes in): a miss finds it by
     * golden-section search over the search box (the distance along a line to a convex shape has one
     * minimum); a ray that goes in only shallowly (near the silhouette) refines it the same way between
     * entry and exit. Deep rays need no more.
     */
    const trace = (bx: string, en: string, ex: string, md?: string, tS?: string) => {
      const at = (t: string) => `tcShape($_ro + $_rd * ${t}, ${bx}, $_rb)`;
      const golden = (lo: string, hi: string, n: number, ind: string) => [
        `float $_ga = ${lo}, $_gb = ${hi};\n`,
        'float $_gc = $_gb - 0.618034 * ($_gb - $_ga), $_gd = $_ga + 0.618034 * ($_gb - $_ga);\n',
        `float $_fc = ${at('$_gc')}, $_fd = ${at('$_gd')};\n`,
        `for (int $_i = 0; $_i < ${n}; $_i++) {\n`,
        `    if ($_fc < $_fd) { $_gb = $_gd; $_gd = $_gc; $_fd = $_fc; $_gc = $_gb - 0.618034 * ($_gb - $_ga); $_fc = ${at('$_gc')}; }\n`,
        `    else { $_ga = $_gc; $_gc = $_gd; $_fc = $_fd; $_gd = $_ga + 0.618034 * ($_gb - $_ga); $_fd = ${at('$_gd')}; }\n`,
        '}\n',
        `${tS} = $_fc < $_fd ? $_gc : $_gd;\n`,
        `${md} = min($_fc, $_fd);\n`,
      ].map(l => ind + l);
      return [
        '    {\n',
        `        float $_rr = min($_rb.x, min(${bx}.x, min(${bx}.y, ${bx}.z)));\n`,
        `        vec3 $_ab = abs($_ro) - ${bx};\n`,
        '        bool $_hit = false;\n',
        '        float $_mn = 1e3, $_tn = $_t0;\n',
        '        if ($_rb.y <= 0.0 && max($_ab.x, max($_ab.y, $_ab.z)) > 0.0) {\n',
        `            float $_te = tcRayRoundBoxIn($_ro, $_rd, ${bx}, $_rr);\n`,
        '            if ($_te >= 0.0) {\n',
        '                float $_tB = $_t1 + 1.0;\n',
        `                float $_tx = tcRayRoundBoxIn($_ro + $_rd * $_tB, -$_rd, ${bx}, $_rr);\n`,
        `                ${en} = $_te; ${ex} = max($_tB - max($_tx, 0.0), $_te); $_hit = true;\n`,
        '            }\n',
        '        } else {\n',
        '            float $_t = $_t0;\n',
        '            for (int $_i = 0; $_i < 64; $_i++) {\n',
        `                float $_d = ${at('$_t')};\n`,
        '                if ($_d < $_mn) { $_mn = $_d; $_tn = $_t; }\n',
        '                if ($_d < 1e-4 || $_t > $_t1) break;\n',
        '                $_t += max($_d * $_ks, 1e-4);\n',
        '            }\n',
        '            if ($_mn < 1e-4) {\n',
        `                ${en} = $_t;\n`,
        '                float $_u = $_t1;\n',
        '                for (int $_i = 0; $_i < 64; $_i++) {\n',
        `                    float $_d = ${at('$_u')};\n`,
        `                    if ($_d < 1e-4 || $_u < ${en}) break;\n`,
        '                    $_u -= max($_d * $_ks, 1e-4);\n',
        '                }\n',
        `                ${ex} = max($_u, ${en});\n`,
        '                $_hit = true;\n',
        '            }\n',
        '        }\n',
        ...(md ? [
          '        if ($_hit) {\n',
          `            ${tS} = 0.5 * (${en} + ${ex});\n`,
          `            ${md} = ${at(tS!)};\n`,
          `            if (-${md} < $_mg) {\n`,
          ...golden(en, ex, 10, '                '),
          '            }\n',
          '        } else if ($_mn < 1e3) {\n',
          `            ${md} = $_mn; ${tS} = $_tn;\n`,
          '        } else {\n',
          ...golden('$_t0', '$_t1', 18, '            '),
          '        }\n',
        ] : []),
        '    }\n',
      ].join('');
    };
    /** The soft-edge weight of a point with frames moved: the box's coverage inside the box, 1 for frames moved out of it. */
    const coverAt = (pt: string) => (MOT ? `($_cvIn < 0.999 && tcShape(${pt}, $_B, $_rb) >= 0.0 ? 1.0 : $_cvIn)` : '1.0');
    const camera = wired
      ? [
        `    vec3 $_ro = ${inputVars.ro};\n`,
        `    vec3 $_rd = normalize(${inputVars.rd});\n`,
        '    float $_or = 0.0;\n',
        '    float $_cd = 0.0;\n',
      ]
      : [
        // The March Camera's orbit, aimed at the box's centre (moved by Translate X / Y / Z, below).
        `    float $_ang = ${f('camAngle')} + u_time * ${f('rotSpeed')};\n`,
        `    float $_elev = ${f('camElevation')};\n`,
        '    vec3 $_hz = vec3(sin($_ang), 0.0, cos($_ang));\n',
        `    float $_cd = ${f('camDist')};\n`,
        '    vec3 $_ro = $_cd * (cos($_elev) * $_hz + sin($_elev) * vec3(0.0, 1.0, 0.0));\n',
        '    vec3 $_fw = normalize(-$_ro);\n',
        '    vec3 $_cu = normalize(-sin($_elev) * $_hz + cos($_elev) * vec3(0.0, 1.0, 0.0));\n',
        '    vec3 $_rt = normalize(cross($_cu, $_fw));\n',
        `    vec3 $_lat = ${inputVars.uv ?? 'g_uv'}.x * $_rt + ${inputVars.uv ?? 'g_uv'}.y * cross($_fw, $_rt);\n`,
        // Flatten: the rays' origins spread across the picture and their directions close up; the box keeps its size.
        `    float $_or = clamp(${f('ortho')}, 0.0, 1.0);\n`,
        `    $_ro += $_or * $_cd / max(${f('fov')}, 0.05) * $_lat;\n`,
        `    vec3 $_rd = normalize(max(${f('fov')}, 0.05) * $_fw + (1.0 - $_or) * $_lat);\n`,
        // Translate: the camera and the point it looks at move together, so the orbit turns round the moved point.
        `    $_ro += vec3(${f('camX')}, ${f('camY')}, ${f('camZ')});\n`,
      ];
    const keyOf = (c: string) => keyMode === 'color' ? `tcKeyColor(${c}, $_kc, ${f('keyTolerance')}, ${f('keySoftness')})`
      : keyMode === 'hue' ? `tcKeyHue(${c}, $_kc, ${f('keyTolerance')}, ${f('keySoftness')})`
      : `tcKeyLuma(${c}, ${f('lumaLo')}, ${f('lumaHi')}, ${f('keySoftness')})`;
    const keyLines = keyMode === 'off' ? '' : [
      // Each frame keyed on its own, the matches blended (tcFrames).
      `            float $_k = mix(${keyOf('$_c0')}, ${keyOf('$_c1')}, $_fwt);\n`,
      // Pulse: the keyed colour shows in bands travelling through time.
      `            float $_kv = mix(1.0, tcPulse(${pulseDir === 'backward' ? '1.0 - $_gv' : pulseDir === 'outward' ? 'abs($_gv - $_sl0)' : '$_gv'}, $_pp), $_pls);\n`,
      `            $_op = $_op * ${f('othersOpacity')} * (1.0 - $_k) + ${f('keyOpacity')} * $_kv * $_k;\n`,
      `            $_c = mix($_c, vec3(dot($_c, ${LUMA})), ${f('othersGrey')} * (1.0 - $_k));\n`,
    ].join('');
    const tintCoord = tintAlong === 'time' ? '$_wv.z' : tintAlong === 'height' ? '$_qv.y' : 'clamp(0.5 * ($_qv.y + $_wv.z), 0.0, 1.0)';
    /**
     * How wide a pixel is across a sheet's border (lib/timeCube/march.ts sheetFootprint): a pixel's
     * width, stretched as much as the sheet is turned away from the camera, in the units of the
     * sheet's shape distance `dvar` at `pt` (its gradient by small differences). A sheet seen nearly
     * edge-on squeezes its border into less than a pixel, so a pixel-wide ramp in the sheet's own
     * plane stepped and dotted; this keeps borders and outlines one pixel soft on screen. Worked out
     * only near the border (deep inside the sheet it changes nothing), so it costs only edge pixels.
     */
    const footprint = (pt: string, dvar: string, px: string, out: string) => [
      `            float ${out} = ${px};\n`,
      `            if (abs(${dvar}) < 16.0 * ${out}) {\n`,
      '                vec3 $_wq; float $_bq;\n',
      '                float $_he = 1e-3 * $_mnB;\n',
      `                vec3 $_gd = (vec3(${shapeAt(`${pt} + vec3($_he, 0.0, 0.0)`, '$_wq', '$_bq')}, ${shapeAt(`${pt} + vec3(0.0, $_he, 0.0)`, '$_wq', '$_bq')}, ${shapeAt(`${pt} + vec3(0.0, 0.0, $_he)`, '$_wq', '$_bq')}) - ${dvar}) / $_he;\n`,
      `                float $_g0 = tcSide(${pt}, $_B, $_st);\n`,
      `                vec3 $_gn = vec3(tcSide(${pt} + vec3(1.0, 0.0, 0.0), $_B, $_st), tcSide(${pt} + vec3(0.0, 1.0, 0.0), $_B, $_st), tcSide(${pt} + vec3(0.0, 0.0, 1.0), $_B, $_st)) - $_g0;\n`,
      `                ${out} = tcFootprint($_rd, $_gd, $_gn, ${out});\n`,
      '            }\n',
    ].join('');
    // The frame at the slice, where the ray crosses the plane (exactly, not at a step): worked out once,
    // before the march, as premultiplied colour and alpha; the march composites it in order, between
    // the stretch of the ray in front of the plane and the stretch behind it.
    const sliceFacePre = [
      '        vec4 $_sf = vec4(0.0);\n',
      '        if ($_ls >= 0.0) {\n',
      '            vec3 $_ps = $_ro + $_rd * $_ls;\n',
      '            vec3 $_ws; float $_bs;\n',
      `            float $_ds = ${shapeAt('$_ps', '$_ws', '$_bs')};\n`,
      `            vec3 $_sc = ${look(sampleAt('$_ws'))};\n`,
      footprint('$_ps', '$_ds', pixAt('$_ls'), '$_spx'),
      // Inside the shape, its border feathered by the Edge softness: the frame fades into the sides.
      `            float $_sin = 1.0 - smoothstep(-max($_fe, $_spx), 0.5 * $_spx, $_ds);\n`,
      `            float $_so = $_ew > 0.0 ? clamp(${f('sliceEdge')}, 0.0, 1.0) * (1.0 - smoothstep(0.5 * $_ew * $_spx, (0.5 * $_ew + 1.0) * $_spx, abs($_ds))) : 0.0;\n`,
      `            float $_sa = max(clamp(${f('sliceOpacity')}, 0.0, 1.0) * $_sin${fadeBy('$_bs')}, $_so) * ${coverAt('$_ps')};\n`,
      `            $_sf = vec4(mix($_sc, ${edgeCol}, $_so / max($_sa, 1e-4)) * $_sa, $_sa);\n`,
      '        }\n',
    ].join('');
    // Highlighted frames: the part of a stretch of the ray inside the nearest one dims Others less
    // (lib/timeCube/style.ts stepInHighlight); the march stops on each one's plane and draws it there
    // as a sheet, read crisply at its own time, between the stretches in front of it and behind it.
    const hlDim = !HL ? '' : [
      '            if ($_hlOn > 0.5) {\n',
      '                float $_g1 = $_gA + $_gS * ($_ta - $_en);\n',
      '                float $_g2 = $_gA + $_gS * ($_tb - $_en);\n',
      '                float $_lo = min($_g1, $_g2), $_hi = max($_g1, $_g2), $_gm = 0.5 * ($_lo + $_hi);\n',
      '                float $_cg = $_gm - tcComb($_gm, $_hl);\n',
      '                float $_ov = max(min($_hi, $_cg + $_hw) - max($_lo, $_cg - $_hw), 0.0);\n',
      '                float $_fr = $_hi - $_lo > 1e-6 ? $_ov / ($_hi - $_lo) : step(abs($_gm - $_cg), $_hw);\n',
      `                $_ob *= mix(clamp(${f('hlOthers')}, 0.0, 1.0), 1.0, $_fr);\n`,
      '            }\n',
    ].join('');
    const hlSheet = !HL ? '' : [
      '            if ($_ev == 2) {\n',
      '                vec3 $_pc = $_ro + $_rd * $_th;\n',
      '                vec3 $_wc; float $_bc;\n',
      `                float $_dc = ${shapeAt('$_pc', '$_wc', '$_bc')};\n`,
      `                vec3 $_hc = mix(${look(sampleAt('$_wc'))}, ${c3('hlColor')}, clamp(${f('hlTint')}, 0.0, 1.0));\n`,
      footprint('$_pc', '$_dc', pixAt('$_th'), '$_cpx').replace(/^ {12}/gm, '                '),
      '                float $_hin = 1.0 - smoothstep(-0.5 * $_cpx, 0.5 * $_cpx, $_dc);\n',
      `                float $_hol = $_ew > 0.0 ? clamp(${f('hlEdge')}, 0.0, 1.0) * (1.0 - smoothstep(0.5 * $_ew * $_cpx, (0.5 * $_ew + 1.0) * $_cpx, abs($_dc))) : 0.0;\n`,
      `                $_hc = mix($_hc, ${c3('hlColor')}, $_hol);\n`,
      `                float $_ah = max(clamp(${f('hlOpacity')}, 0.0, 1.0) * $_hin, $_hol)${fadeBy('$_bc')} * ${coverAt('$_pc')};\n`,
      '                $_acc.rgb += (1.0 - $_acc.a) * $_ah * $_hc;\n',
      '                $_acc.a += (1.0 - $_acc.a) * $_ah;\n',
      '            }\n',
    ].join('');
    const edgesBlock = outline !== 'edges' ? '' : [
      // The twelve edges (through the middle of each rounded edge), as lines a set number of pixels wide
      // wherever they are: anti-aliased, steady as the camera turns. Behind the box's middle, a back edge.
      '    {\n',
      '        float $_er = min($_rb.x, $_mnB);\n',
      '        vec3 $_EL = $_B - 0.6 * $_er;\n',
      '        vec3 $_EX = $_B - 0.29289322 * $_er;\n',
      '        float $_tmid = 0.5 * ($_en + $_ex);\n',
      '        for (int $_k = 0; $_k < 12; $_k++) {\n',
      '            int $_kj = $_k - 4 * ($_k / 4);\n',
      '            float $_s1 = ($_kj == 1 || $_kj == 3) ? -1.0 : 1.0;\n',
      '            float $_s2 = $_kj >= 2 ? -1.0 : 1.0;\n',
      '            vec3 $_e0, $_e1;\n',
      '            if ($_k < 4) { $_e0 = vec3(-$_EL.x, $_s1 * $_EX.y, $_s2 * $_EX.z); $_e1 = vec3($_EL.x, $_s1 * $_EX.y, $_s2 * $_EX.z); }\n',
      '            else if ($_k < 8) { $_e0 = vec3($_s1 * $_EX.x, -$_EL.y, $_s2 * $_EX.z); $_e1 = vec3($_s1 * $_EX.x, $_EL.y, $_s2 * $_EX.z); }\n',
      '            else { $_e0 = vec3($_s1 * $_EX.x, $_s2 * $_EX.y, -$_EL.z); $_e1 = vec3($_s1 * $_EX.x, $_s2 * $_EX.y, $_EL.z); }\n',
      '            vec2 $_sg = tcRaySeg($_ro, $_rd, $_e0, $_e1);\n',
      `            float $_lc = $_sg.y > $_scn ? 0.0 : tcLine($_sg.x, ${pixAt('$_sg.y')}, $_ew);\n`,
      '            if ($_md >= 0.0 || $_sg.y < $_tmid) $_eF = max($_eF, $_lc); else $_eB = max($_eB, $_lc);\n',
      '        }\n',
      '    }\n',
    ].join('');
    /**
     * The march through space (docs/timecube-space.md). Each step maps the ray's point into a box's own space: the
     * whole-space warp, the repeat (which copy, mirrored, turned), the per-box warp, then the shape (the box, or the
     * wired Space scene's Time Cube Shape). Outside a box it sphere-traces (steps shortened by how much the warps
     * stretch space, and by half a cell when repeated, so a turned or warped neighbour is never stepped over); inside
     * it steps through the frames front to back as the plain view does, reading each sample at its own box point, so
     * twist, bend and any wired warp bend the frames too. The slice frame is drawn where a box's side of the slice flips
     * between two samples. Bounded: Quality's steps plus 160 for the gaps.
     */
    function spaceMarch(): string[] {
      const REP = P.repeat === true;
      const warp = typeof P.warp === 'string' && P.warp in WARP_CODE ? P.warp : 'off';
      const where = P.warpWhere === 'space' ? 'space' : 'each';
      const mask = REP_MASK[String(P.repAxes)] ?? REP_MASK.xz;
      const by = P.copyTimeBy === 'random' ? 'tcHash3($_cv)' : P.copyTimeBy === 'distance' ? 'length($_cv)' : '($_cv.x + $_cv.y + $_cv.z)';
      const warpAt = (w: string) => (warp !== 'off' && where === w ? [`        $_mp = tcSpaceWarp($_mp, ${WARP_CODE[warp]}, $_wp, ${AX});\n`] : []);
      // The clip time read at box time z, per copy: in Flow each copy's flow is moved along by its time.
      const tAt = (z: string) => (flow ? `fract(${z} + $_fsh + $_vt)` : z);
      const sampleSp = (w: string) => `tcSample(${V}, ${lay}, ${inset}, vec3(${w}.xy, ${tAt(`${w}.z`)}))`;
      const tintSp = `            $_col = mix($_col, mix(${c3('tintFrom')}, ${c3('tintTo')}, smoothstep(0.0, 1.0, ${tintCoord})), clamp(${f('tintAmount')}, 0.0, 1.0));\n`;
      /** A colour turned round the wheel by its copy's hue, then fogged toward the background by distance. */
      const finish = (c: string, ind: string) => [
        `${ind}${c} = mix(clamp(tcHueTurn(${c}, $_hu), 0.0, 1.0), $_bgc, $_fg);\n`,
      ].join('');
      return [
        `    vec3 $_bgc = ${bg};\n`,
        // A bulge makes the box's distance overshoot; so do the warps, by how much they can stretch space.
        '    float $_ks = 1.0 / (1.0 + 2.0 * $_rb.y / $_mnB);\n',
        ...(warp !== 'off' ? [
          `    vec4 $_wp = vec4(${f('warpAmount')}, max(${f('warpFreq')}, 0.01), u_time * ${f('warpSpeed')}, 0.0);\n`,
          `    float $_Rw = ${where === 'space' ? '3.0 * length($_B)' : 'length($_B)'};\n`,
          `    $_ks /= 1.0 + abs($_wp.x) * $_wp.y * ${WARP_STRETCH[warp]};\n`,
        ] : []),
        '    float $_mxs = 1e3;\n',
        ...(REP ? [
          `    float $_spin = radians(${f('copySpin')});\n`,
          '    vec3 $_Bc = $_B + $_rb.y;\n',
          // Turned copies need room for their corners: a cell as wide as the box's diagonal across X and Z.
          '    if ($_spin != 0.0) $_Bc.xz = vec2(length($_Bc.xz));\n',
          `    vec3 $_cell = 2.0 * $_Bc + max(${f('repGap')}, 0.0) * $_sz;\n`,
          `    float $_rn = max(floor(${f('repCount')} + 0.5), 0.0);\n`,
          `    vec3 $_cm = $_cell + (1.0 - ${mask}) * 1e3;\n`,
          '    $_mxs = 0.5 * min($_cm.x, min($_cm.y, $_cm.z));\n',
        ] : []),
        ...(warp !== 'off' ? ['    $_mxs = min($_mxs, length($_B));\n'] : []),
        ...(spaceFn ? ['    g_tcB = $_B;\n', '    g_tcR = min($_rb.x, $_mnB);\n', `    $_ks *= clamp(${f('spaceStep')}, 0.05, 1.0);\n`] : []),
        `    float $_far = min(max(${f('farDist')}, 0.1), $_scn);\n`,
        `    float $_fog = 0.1 * max(${f('spaceFog')}, 0.0);\n`,
        `    float $_dl = length(2.0 * $_B) / ${steps}.0;\n`,
        `    float $_tl = 2.0 * ${timeLen};\n`,
        '    float $_j = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));\n',
        `    float $_dc0 = clamp(${f('darkClear')}, -1.0, 1.0);\n`,
        '    vec4 $_acc = vec4(0.0);\n',
        '    float $_md = 1e3, $_tS = 0.0, $_t = 0.0;\n',
        '    bool $_in = false;\n',
        '    vec3 $_wP = vec3(0.0), $_cP = vec3(0.0);\n',
        '    float $_gP = 0.0, $_dP = 0.0;\n',
        `    for (int $_i = 0; $_i < ${steps + 160}; $_i++) {\n`,
        '        if ($_t > $_far || $_acc.a > 0.995) break;\n',
        '        vec3 $_mp = $_ro + $_rd * $_t;\n',
        ...warpAt('space'),
        '        vec3 $_cv = vec3(0.0);\n',
        ...(REP ? [
          `        $_cv = floor($_mp / $_cell + 0.5) * ${mask};\n`,
          '        if ($_rn > 0.5) $_cv = clamp($_cv, -$_rn, $_rn);\n',
          '        $_mp -= $_cv * $_cell;\n',
          ...(P.repMirror === true ? ['        $_mp *= 1.0 - 2.0 * mod($_cv, 2.0);\n'] : []),
          '        if ($_spin != 0.0) {\n',
          '            float $_sa = $_spin * (2.0 * tcHash3($_cv + 3.17) - 1.0);\n',
          '            float $_sc = cos($_sa), $_ss = sin($_sa);\n',
          '            $_mp.xz = vec2($_sc * $_mp.x - $_ss * $_mp.z, $_ss * $_mp.x + $_sc * $_mp.z);\n',
          '        }\n',
        ] : []),
        ...warpAt('each'),
        ...(spaceFn ? [
          // The wired scene: its Time Cube Shape keeps the nearest box's own point and its Repeat Scene cell.
          '        g_tcBest = 1e9; g_tcQ = $_mp; g_tcCell = vec3(0.0);\n',
          `        ${spaceFn}($_mp);\n`,
          '        float $_d = g_tcBest;\n',
          '        vec3 $_q = g_tcQ;\n',
          '        $_cv += g_tcCell;\n',
        ] : [
          '        float $_d = tcShape($_mp, $_B, $_rb);\n',
          '        vec3 $_q = $_mp;\n',
        ]),
        // The distance as measured sets the rim, the skin and inside / outside; the step is shortened (ks) for warps.
        '        if ($_d < $_md) { $_md = $_d; $_tS = $_t; }\n',
        `        float $_px = ${pixAt('$_t')};\n`,
        // Outside every box: step toward the nearest one.
        '        if ($_d > 0.5 * $_px) { $_in = false; $_t += clamp($_d * $_ks, 0.5 * $_px, $_mxs); continue; }\n',
        // Inside: a stretch of frames. The first stretch into a box is a random part of a step, so neighbouring rays
        // read at different depths (fine grain, not rings).
        '        float $_len = $_in ? $_dl : (0.2 + 0.8 * $_j) * $_dl;\n',
        '        vec3 $_qv = ($_q + $_B) * $_iB;\n',
        `        vec3 $_wv = tcUvt($_qv, ${AX});\n`,
        `        float $_vt = ${f('copyTime')} * ${by};\n`,
        flow ? '        float $_slc = $_sl0;\n' : '        float $_slc = $_vt == 0.0 ? $_sl0 : fract($_sl0 + $_vt);\n',
        '        float $_g = $_wv.z - $_kx * ($_wv.x - 0.5) - $_ky * ($_wv.y - 0.5);\n',
        '        float $_gv = $_g;\n',
        `        float $_hu = ${f('copyHue')} * tcHash3($_cv + 7.31);\n`,
        '        float $_fg = 1.0 - exp(-$_fog * $_t);\n',
        // The slice frame, where this box's side of the slice flips since the last sample.
        '        if ($_in && $_cv == $_cP && ($_gP - $_slc) * ($_g - $_slc) < 0.0) {\n',
        '            float $_u = ($_gP - $_slc) / ($_gP - $_g);\n',
        '            vec3 $_ws = mix($_wP, $_wv, $_u);\n',
        '            float $_ds = mix($_dP, $_d, $_u);\n',
        `            vec3 $_sc = ${look(sampleSp('$_ws'))};\n`,
        finish('$_sc', '            '),
        '            float $_sin = 1.0 - smoothstep(-max($_fe, $_px), 0.5 * $_px, $_ds);\n',
        `            float $_so = $_ew > 0.0 ? clamp(${f('sliceEdge')}, 0.0, 1.0) * (1.0 - smoothstep(0.5 * $_ew * $_px, (0.5 * $_ew + 1.0) * $_px, abs($_ds))) : 0.0;\n`,
        `            float $_sa = max(clamp(${f('sliceOpacity')}, 0.0, 1.0) * $_sin, $_so);\n`,
        `            $_sc = mix($_sc, ${edgeCol}, $_so / max($_sa, 1e-4));\n`,
        '            $_acc.rgb += (1.0 - $_acc.a) * $_sa * $_sc;\n',
        '            $_acc.a += (1.0 - $_acc.a) * $_sa;\n',
        '        }\n',
        `        float $_ob = tcFeather($_g, $_g, $_slc, $_tf, ${f('before')}, ${f('after')});\n`,
        `        vec3 $_sq = vec3($_wv.xy, ${tAt('$_wv.z')});\n`,
        ...(keyMode === 'off'
          ? [`        vec3 $_c = tcSample(${V}, ${lay}, ${inset}, $_sq);\n`]
          : [
            '        vec3 $_c0, $_c1;\n',
            `        float $_fwt = tcFrames(${V}, ${lay}, ${inset}, $_sq, $_c0, $_c1);\n`,
            '        vec3 $_c = mix($_c0, $_c1, $_fwt);\n',
          ]),
        '        float $_op = $_ob;\n',
        `        float $_lv = dot($_c, ${LUMA});\n`,
        '        $_op *= 1.0 - abs($_dc0) + abs($_dc0) * ($_dc0 >= 0.0 ? smoothstep(0.02, 0.4, $_lv) : 1.0 - smoothstep(0.6, 0.98, $_lv));\n',
        keyLines.replace(/^ {12}/gm, '        '),
        // The box's skin: soft over Edge softness (at least a pixel), so its surface is anti-aliased.
        '        float $_al = (1.0 - exp(-tcDepth($_op) * $_len / $_tl)) * smoothstep(-0.5 * $_px, max($_fe, $_px), -$_d);\n',
        `        vec3 $_col = ${look('$_c')};\n`,
        tintSp.replace(/^ {12}/gm, '        '),
        finish('$_col', '        '),
        '        $_acc.rgb += (1.0 - $_acc.a) * $_al * $_col;\n',
        '        $_acc.a += (1.0 - $_acc.a) * $_al;\n',
        '        $_in = true; $_wP = $_wv; $_gP = $_g; $_dP = $_d; $_cP = $_cv;\n',
        '        $_t += $_len;\n',
        '    }\n',
        '    vec3 $_color = $_acc.rgb + (1.0 - $_acc.a) * $_bgc;\n',
        '    float $_alpha = $_acc.a;\n',
        // The rim glow round the nearest box the ray passes (or the shallowest it goes into), faded by the fog.
        '    float $_rim = $_tS > $_scn ? 0.0 : clamp($_rimS * exp(-abs($_md) / $_rw), 0.0, 1.0) * exp(-$_fog * $_tS);\n',
        `    $_color = mix($_color, ${c3('rimColor')}, $_rim);\n`,
        '    $_alpha = max($_alpha, $_rim);\n',
        ...(outline === 'silhouette' ? [
          `    float $_eo = clamp(${f('edgeOpacity')}, 0.0, 1.0) * tcLine(abs($_md), ${pixAt('$_tS')}, $_ew) * exp(-$_fog * $_tS);\n`,
          `    $_color = mix($_color, ${edgeCol}, $_eo);\n`,
          '    $_alpha = max($_alpha, $_eo);\n',
        ] : []),
      ];
    }
    const head = [
      ...camera,
      `    float $_pix = 2.0 / (u_resolution.y * max(${f('fov')}, 0.05));\n`,
      `    float $_asp = ${lay}.w;\n`,
      `    float $_dep = max(${f('depth')}, 0.01);\n`,
      `    float $_sz = max(${f('size')}, 0.01);\n`,
      `    vec3 $_B = 0.5 * $_sz * ${half};\n`,
      '    vec3 $_iB = 0.5 / $_B;\n',
      '    float $_mnB = min($_B.x, min($_B.y, $_B.z));\n',
      `    vec2 $_rb = vec2(clamp(${f('roundness')}, 0.0, 1.0), max(${f('bulge')}, 0.0)) * $_mnB;\n`,
      `    float $_fe = max(${f('feather')}, 0.0) * $_mnB;\n`,
      ...(flow
        ? [
          // Flow: the crisp frame stays at Frame position; the clip moves through the box past it.
          `    float $_tau = ${inputVars.flowTime ?? f('flowTime')} + u_time * ${f('flowSpeed')};\n`,
          `    float $_sl0 = clamp(${f('framePos')}, 0.0, 1.0);\n`,
          '    float $_fsh = $_tau - $_sl0;\n',
        ]
        : [`    float $_sl0 = ${slice};\n`]),
      `    float $_kx = tan(radians(clamp(${f('tiltX')}, -85.0, 85.0)));\n`,
      `    float $_ky = tan(radians(clamp(${f('tiltY')}, -85.0, 85.0)));\n`,
      `    vec4 $_st = vec4($_sl0, $_kx, $_ky, ${AX});\n`,
      // Temporal feather (style.ts featherOpacity): its width in box time, side, curve; in Flow it wraps round.
      `    vec4 $_tf = vec4(max(${f('timeFeather')}, 0.0) / max(${lay}.z - 1.0, 1.0), ${f('featherSide')}, ${f('featherCurve')}, ${flow ? '1.0' : '0.0'});\n`,
      // Highlights: a comb of frames in time (style.ts highlightComb).
      `    float $_fs = 1.0 / max(${lay}.z - 1.0, 1.0);\n`,
      ...(HL ? [`    float $_hlOn = step(1.0, ${f('hlCount')});\n`] : ['    float $_hlOn = 0.0;\n']),
      ...(!HL ? ['    vec4 $_hl = vec4(0.0, 1.0, 1.0, 0.0);\n'] : flow
        ? [
          // In Flow the highlighted frames are frames of the clip: they travel through the box with it.
          `    float $_h0 = ${f('hlStart')} * $_fs - $_fsh;\n`,
          `    vec4 $_hl = vec4($_h0, max(${f('hlSpacing')}, 0.25) * $_fs, max(floor(${f('hlCount')} + 0.5), 1.0), 1.0);\n`,
          `    float $_sendT = fract($_tau + ${f('hlStart')} * $_fs);\n`,
        ]
        : [
          `    float $_h0 = ${hlMode === 'fixed' ? '0.0' : '$_sl0'} + ${f('hlStart')} * $_fs;\n`,
          `    vec4 $_hl = vec4($_h0, max(${f('hlSpacing')}, 0.25) * $_fs, max(floor(${f('hlCount')} + 0.5), 1.0), ${hlMode === 'loop' ? '1.0' : '0.0'});\n`,
          `    float $_sendT = ${hlMode === 'loop' ? 'fract($_h0)' : 'clamp($_h0, 0.0, 1.0)'};\n`,
        ]),
      ...(HL ? [
        `    float $_hw = 0.5 * max(${f('hlThickness')}, 0.05) * $_fs;\n`,
        `    float $_send = clamp(${f('sendThrough')}, 0.0, 1.0);\n`,
      ] : []),
      // Frame motion: a bump round the slice (or the highlights) moves the frames in it.
      ...(MOT ? [
        `    vec4 $_mv = vec4(${f('liftSide')}, ${f('liftUp')}, ${f('frameScale')}, radians(${f('frameTurn')}));\n`,
        `    float $_fade = clamp(${f('frameFade')}, 0.0, 1.0);\n`,
        `    vec4 $_mw = vec4(${motionAt === 'highlights' ? '0.0' : '1.0'}, ${motionAt === 'slice' ? '0.0' : '$_hlOn'}, max(${f('motionWidth')}, 0.05) * $_fs, abs($_mv.x) + abs($_mv.y) + abs($_mv.z) + abs($_mv.w) + $_fade > 0.0 ? 1.0 : 0.0);\n`,
        '    float $_wide = max($_asp, 1.0);\n',
        '    float $_grow = $_mw.w > 0.5 ? $_sz * (abs($_mv.x) + abs($_mv.y) + max($_mv.z, 0.0) * 0.5 * $_wide + ($_mv.w != 0.0 ? 0.25 * $_wide : 0.0)) : 0.0;\n',
        `    vec3 $_Bx = $_B + $_grow * ${PERP[axis]};\n`,
      ] : [
        '    vec4 $_mv = vec4(0.0);\n',
        '    vec4 $_mw = vec4(0.0);\n',
        '    vec3 $_Bx = $_B;\n',
      ]),
      `    float $_ew = max(${f('edgeWidth')}, 0.0);\n`,
      `    float $_rimS = max(${f('rimStrength')}, 0.0);\n`,
      `    float $_rw = max(${f('rimWidth')}, 1e-3) * $_sz;\n`,
      `    float $_scn = ${inputVars.sceneDist ? `max(${inputVars.sceneDist}, 0.0)` : '1e9'};\n`,
      // Key colour turned round the wheel (by hand, or drifting); the pulse.
      ...(keyMode === 'color' || keyMode === 'hue' ? [`    vec3 $_kc = clamp(tcHueTurn(${c3('keyColor')}, ${f('keyHueShift')}${ANIM ? ` + u_time * ${f('keyHueDrift')}` : ''}), 0.0, 1.0);\n`] : []),
      ...(keyMode === 'off' ? [] : [
        `    float $_pls = ${ANIM ? `clamp(${f('pulse')}, 0.0, 1.0)` : '0.0'};\n`,
        `    float $_pph = ${f('pulsePhase')} + u_time * ${f('pulseSpeed')};\n`,
        ...(pulseDir === 'bounce' ? [`    $_pph = (1.0 - abs(1.0 - mod($_pph, 2.0))) * max(${f('pulseCount')}, 1.0);\n`] : []),
        `    vec4 $_pp = vec4(max(floor(${f('pulseCount')} + 0.5), 1.0), ${f('pulseWidth')}, ${f('pulseSoftness')}, $_pph);\n`,
      ]),
    ];
    if (SPACE) return { code: [...head, ...spaceMarch()].join('').replace(/\$_/g, `${id}_`), outputVars: { color: `${id}_color`, alpha: `${id}_alpha` } };
    const lines = [
      ...head,
      '    vec4 $_acc = vec4(0.0);\n',
      '    float $_eF = 0.0, $_eB = 0.0;\n',
      // The search box: the shape's reach plus room (mg) for its soft edge, glow and outline.
      `    float $_mg = max(max($_fe, $_rimS > 0.0 ? 4.0 * $_rw : 0.0), ($_ew + 2.0) * ${pixAt('length($_ro)')});\n`,
      '    vec3 $_Bs = $_Bx + $_rb.y + $_mg;\n',
      // Sphere-tracing step: the distance is exact for a rounded box; a bulge makes it overshoot, so step shorter.
      '    float $_ks = 1.0 / (1.0 + 2.0 * $_rb.y / $_mnB);\n',
      '    vec3 $_inv = 1.0 / ($_rd + vec3(equal($_rd, vec3(0.0))) * 1e-7);\n',
      '    vec3 $_ta0 = (-$_Bs - $_ro) * $_inv;\n',
      '    vec3 $_tb0 = ($_Bs - $_ro) * $_inv;\n',
      '    vec3 $_tmn = min($_ta0, $_tb0);\n',
      '    vec3 $_tmx = max($_ta0, $_tb0);\n',
      '    float $_t0 = max(max(max($_tmn.x, $_tmn.y), $_tmn.z), 0.0);\n',
      '    float $_t1 = min(min($_tmx.x, $_tmx.y), $_tmx.z);\n',
      // md (the least distance to the box along the ray, minus how deep when it goes in) sets the soft
      // edge, the rim glow and the silhouette; they follow the box, not frames moved out of it. The
      // march runs from where the ray enters the shape to where it leaves, so its surface is exact.
      '    float $_md = 1e3, $_tS = 0.0, $_en = 0.0, $_ex = -1.0, $_enB = 0.0, $_exB = -1.0;\n',
      '    if ($_t1 > $_t0) {\n',
      trace('$_B', '$_enB', '$_exB', '$_md', '$_tS'),
      // Moved frames reach out of the box: the march runs through the box grown to hold them.
      ...(MOT ? [
        '    if ($_mw.w > 0.5) {\n',
        trace('$_Bx', '$_en', '$_ex'),
        '    } else { $_en = $_enB; $_ex = $_exB; }\n',
      ] : ['    $_en = $_enB; $_ex = $_exB;\n']),
      '    }\n',
      '    float $_far = min($_ex, $_scn);\n',
      `    float $_pxS = ${pixAt('$_tS')};\n`,
      // Edge softness: a ray that only grazes the box covers little of its pixel (style.ts coverage).
      // With frames moved, only what is still inside the box is softened, step by step.
      `    float $_cov = smoothstep(-0.5 * $_pxS, max($_fe, $_pxS), -$_md);\n`,
      ...(MOT ? ['    float $_cvEnd = $_mw.w > 0.5 ? 1.0 : $_cov;\n', '    float $_cvIn = $_mw.w > 0.5 ? $_cov : 1.0;\n'] : ['    float $_cvEnd = $_cov;\n']),
      '    float $_cvF = 0.0;\n',
      '    if ($_ex > $_en && $_far > $_en) {\n',
      // The slice plane: where along the ray it is crossed, if it is (the side function is linear along the ray).
      `        vec3 $_wA = tcUvt(($_ro + $_rd * $_en + $_B) * $_iB, ${AX});\n`,
      `        vec3 $_wB = tcUvt(($_ro + $_rd * $_far + $_B) * $_iB, ${AX});\n`,
      '        float $_gA = $_wA.z - $_kx * ($_wA.x - 0.5) - $_ky * ($_wA.y - 0.5);\n',
      '        float $_gB = $_wB.z - $_kx * ($_wB.x - 0.5) - $_ky * ($_wB.y - 0.5);\n',
      '        float $_len = $_far - $_en;\n',
      '        float $_gS = ($_gB - $_gA) / max($_len, 1e-6);\n',
      '        float $_f0 = $_gA - $_sl0, $_f1 = $_gB - $_sl0;\n',
      '        float $_ls = $_f0 * $_f1 < 0.0 ? $_en + $_len * $_f0 / ($_f0 - $_f1) : -1.0;\n',
      sliceFacePre,
      `        float $_dl = length(2.0 * $_Bx) / ${steps}.0;\n`,
      // Where in each stretch to read, per pixel (interleaved gradient noise): fine grain instead of the bands a fixed step draws.
      '        float $_j = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));\n',
      `        float $_tl = 2.0 * ${timeLen};\n`,
      // The march goes in steps of dl, but stops exactly on the slice plane and on each highlighted
      // frame's plane (lib/timeCube/march.ts): each is drawn there, between the stretch in front of it
      // and the stretch behind it, so nothing about them depends on where the steps happen to fall.
      '        bool $_sDone = $_ls < 0.0;\n',
      '        float $_ta = $_en;\n',
      ...(HL ? [
        '        float $_dir = $_gS >= 0.0 ? 1.0 : -1.0;\n',
        '        float $_gH = -1e9 * $_dir;\n',
        '        bool $_hOn = $_hlOn > 0.5 && abs($_gS) > 1e-6;\n',
        '        bool $_hNeed = $_hOn;\n',
        '        float $_th = 1e9, $_cn = 0.0;\n',
      ] : []),
      `        for (int $_i = 0; $_i < ${steps + 2 + (HL ? 40 : 0)}; $_i++) {\n`,
      '            if ($_ta >= $_far || $_acc.a > 0.995) break;\n',
      '            float $_tb = min($_ta + $_dl, $_far);\n',
      '            int $_ev = 0;\n',
      '            if (!$_sDone && $_ls <= $_tb) { $_tb = max($_ls, $_ta); $_ev = 1; }\n',
      ...(HL ? [
        // The next highlighted frame's plane along the ray: found once, then again only after it is drawn.
        '            if ($_hNeed) {\n',
        '                float $_gt = $_gA + $_gS * ($_ta - $_en);\n',
        '                float $_gf = $_dir > 0.0 ? max($_gt - 1e-5, $_gH + 1e-5) : min($_gt + 1e-5, $_gH - 1e-5);\n',
        '                $_cn = tcCombNext($_gf, $_dir, $_hl);\n',
        '                $_th = abs($_cn) < 1e8 ? $_en + ($_cn - $_gA) / $_gS : 1e9;\n',
        '                $_hNeed = false;\n',
        '            }\n',
        // A highlighted frame on the slice is drawn first (it is the slice frame's outline and tint),
        // even when rounding puts its plane a hair behind the slice's: else pixels flip between the two.
        '            if ($_th <= $_tb + 1e-4) { $_tb = max($_th, $_ta); $_ev = 2; $_gH = $_cn; $_hNeed = $_hOn; }\n',
      ] : []),
      // The stretch [ta, tb] lies on one side of the slice: its opacity before the picture is read. With a
      // feather, the ramp is read at the stretch's jittered point, so it shows as fine grain, not bands.
      '            float $_gmid = $_gA + $_gS * (0.5 * ($_ta + $_tb) - $_en);\n',
      '            float $_gj = $_gA + $_gS * ($_ta + $_j * ($_tb - $_ta) - $_en);\n',
      `            float $_ob = tcFeather($_gmid, $_gj, $_sl0, $_tf, ${f('before')}, ${f('after')});\n`,
      hlDim,
      // Read where a ray through this stuff would most likely stop: at the start of a nearly solid stretch (its surface), anywhere in a thin one.
      '            float $_tm = $_ta + tcFreeFlight($_j, tcDepth($_ob) / $_tl, $_tb - $_ta);\n',
      '            vec3 $_pm = $_ro + $_rd * $_tm;\n',
      '            vec3 $_qv = ($_pm + $_B) * $_iB;\n',
      ...(MOT ? [
        '            vec3 $_wv; float $_bv;\n',
        '            float $_mk = 1.0;\n',
        // Moved frames: read each sample from where its frame came from (the inverse of the move), inside the moved shape.
        `            if ($_mw.w > 0.5) { float $_dv = ${shapeAt('$_pm', '$_wv', '$_bv')}; $_mk = 1.0 - smoothstep(-0.5 * $_dl, 0.5 * $_dl, $_dv); }\n`,
        `            else { $_wv = tcUvt($_qv, ${AX}); $_bv = 0.0; }\n`,
      ] : [`            vec3 $_wv = tcUvt($_qv, ${AX});\n`]),
      '            float $_gv = $_gA + $_gS * ($_tm - $_en);\n',
      `            vec3 $_sq = vec3($_wv.xy, ${timeAt('$_wv.z')});\n`,
      ...(keyMode === 'off'
        ? [`            vec3 $_c = tcSample(${V}, ${lay}, ${inset}, $_sq);\n`]
        : [
          '            vec3 $_c0, $_c1;\n',
          `            float $_fwt = tcFrames(${V}, ${lay}, ${inset}, $_sq, $_c0, $_c1);\n`,
          '            vec3 $_c = mix($_c0, $_c1, $_fwt);\n',
        ]),
      // Transfer function (lib/timeCube/plan.ts voxelOpacity): before / after the slice, dark (or light) is clear, the key.
      '            float $_op = $_ob;\n',
      `            float $_dc0 = clamp(${f('darkClear')}, -1.0, 1.0);\n`,
      `            float $_lv = dot($_c, ${LUMA});\n`,
      '            $_op *= 1.0 - abs($_dc0) + abs($_dc0) * ($_dc0 >= 0.0 ? smoothstep(0.02, 0.4, $_lv) : 1.0 - smoothstep(0.6, 0.98, $_lv));\n',
      keyLines,
      ...(MOT ? ['            $_op *= $_mk * (1.0 - $_fade * $_bv);\n'] : []),
      `            float $_al = (1.0 - exp(-tcDepth($_op) * ($_tb - $_ta) / $_tl))${MOT ? ` * ${coverAt('$_pm')}` : ''};\n`,
      `            vec3 $_col = ${look('$_c')};\n`,
      `            $_col = mix($_col, mix(${c3('tintFrom')}, ${c3('tintTo')}, smoothstep(0.0, 1.0, ${tintCoord})), clamp(${f('tintAmount')}, 0.0, 1.0));\n`,
      '            $_acc.rgb += (1.0 - $_acc.a) * $_al * $_col;\n',
      '            $_acc.a += (1.0 - $_acc.a) * $_al;\n',
      '            if ($_ev == 1) { $_cvF = (1.0 - $_acc.a) * $_sf.a; $_acc.rgb += (1.0 - $_acc.a) * $_sf.rgb; $_acc.a += $_cvF; $_sDone = true; }\n',
      hlSheet,
      '            $_ta = $_tb;\n',
      '        }\n',
      '    }\n',
      // The edge softness fades the box near its silhouette, but not the slice frame: it has its own rounded, feathered border.
      '    $_cvEnd = max($_cvEnd, $_cvF);\n',
      edgesBlock,
      outline === 'silhouette'
        ? `    $_eF = $_tS > $_scn ? 0.0 : tcLine(abs($_md), $_pxS, $_ew);\n`
        : '',
      // Back edges, behind the frames.
      `    float $_eo = clamp(${f('edgeOpacity')}, 0.0, 1.0);\n`,
      `    $_acc.rgb += (1.0 - $_acc.a) * $_eB * $_eo * ${edgeCol};\n`,
      '    $_acc.a += (1.0 - $_acc.a) * $_eB * $_eo;\n',
      // A soft shadow on the ground below the box.
      `    float $_shA = max(${f('shadow')}, 0.0);\n`,
      '    float $_sh = 0.0;\n',
      '    if ($_shA > 0.0 && $_rd.y < -1e-4) {\n',
      `        float $_tg = (-($_Bx.y + $_rb.y) - ${f('shadowGap')} * $_sz - $_ro.y) / $_rd.y;\n`,
      '        if ($_tg > 0.0 && $_tg < $_scn) {\n',
      '            vec2 $_gq = abs(($_ro + $_rd * $_tg).xz) - $_Bx.xz + $_rb.x;\n',
      '            float $_gsd = length(max($_gq, 0.0)) + min(max($_gq.x, $_gq.y), 0.0) - $_rb.x;\n',
      `            float $_gw = max(${f('shadowSoftness')}, 0.01) * $_sz;\n`,
      '            $_sh = clamp($_shA, 0.0, 1.0) * (1.0 - smoothstep(-0.5 * $_gw, $_gw, $_gsd));\n',
      '        }\n',
      '    }\n',
      `    vec3 $_color = $_acc.rgb * $_cvEnd + (1.0 - $_acc.a * $_cvEnd) * (${bg}) * (1.0 - $_sh);\n`,
      '    float $_alpha = max($_acc.a * $_cvEnd, $_sh);\n',
      // The rim glow, brightest on the silhouette, inside and out (style.ts rimGlow).
      '    float $_rim = $_tS > $_scn ? 0.0 : clamp($_rimS * exp(-abs($_md) / $_rw), 0.0, 1.0);\n',
      `    $_color = mix($_color, ${c3('rimColor')}, $_rim);\n`,
      '    $_alpha = max($_alpha, $_rim);\n',
      // Front edges (or the silhouette), over everything.
      `    $_color = mix($_color, ${edgeCol}, $_eF * $_eo);\n`,
      '    $_alpha = max($_alpha, $_eF * $_eo);\n',
    ];
    return { code: lines.join('').replace(/\$_/g, `${id}_`), outputVars: { color: `${id}_color`, alpha: `${id}_alpha` } };
  },
};

// ── Time Cube Shape (in a Scene Group) ───────────────────────────────────────

export const TIME_CUBE_SHAPE_TYPE = 'timeCubeShape';

/**
 * The Time Cube View's box as a shape for a Scene Group (docs/timecube-space.md). Wire the group into the view's Space
 * socket: the view then draws its box wherever this shape is, through every warp before it in the group (Twist 3D,
 * Bend 3D, a Warp Builder group…) and a Repeat Scene round the group. The view sets the box's size (g_tcB) before it
 * measures the scene; the shape keeps the point it measured at (the box's own point, g_tcQ) and its Repeat Scene cell
 * when it is the nearest box so far. Measured by anything else (a March Loop), it is a rounded box of its own Size.
 */
export const TimeCubeShapeNode: NodeDefinition = {
  type: TIME_CUBE_SHAPE_TYPE,
  label: 'Time Cube Shape',
  category: '3D Primitives',
  aliases: ['Time box shape', 'Time cube in a scene', 'Video box shape', 'Time cube SDF'],
  description: 'A Time Cube View\'s box as a shape in a Scene Group. Warp its Position (Twist 3D, Bend 3D, Noise, a Warp Builder group…) and repeat the group (Repeat Scene), then wire the Scene Group into the Time Cube View\'s Space socket: the view draws the box of frames wherever this shape is, bent and copied as the scene is.',
  brief: {
    summary: 'The box of time as a shape for the 3D tools: whatever the Scene Group does to space, the Time Cube View draws its frames through.',
    start: [
      'Inside a Scene Group: Scene Pos → (any warps) → Time Cube Shape → Scene Output.',
      'Wire the Scene Group (or a Repeat Scene round it) into a Time Cube View\'s Space socket.',
      'The view sets the box\'s size (its Time stretch, Box size and Corner roundness); this card\'s Size is only used when something else measures the scene.',
    ],
  },
  inputs: {
    pos: { type: 'vec3', label: 'Position', hint: 'The point to measure, warped as you like: Scene Pos, or a warp\'s output.' },
  },
  outputs: {
    dist: { type: 'float', label: 'Distance', hint: 'The distance to the box. Wire it into Scene Output.' },
  },
  defaultParams: { size: 1, roundness: 0.4 },
  paramDefs: {
    size: { label: 'Size (alone)', type: 'float', min: 0.1, max: 4, step: 0.01, hint: 'The box\'s size when no Time Cube View sets it (in a March Loop on its own). Wired into a Time Cube View\'s Space, the view\'s Box settings win.' },
    roundness: { label: 'Roundness (alone)', type: 'float', min: 0, max: 1, step: 0.01, hint: 'Corner roundness when no Time Cube View sets it.' },
  },
  assignable: false,
  glslFunctions: [TC_SHAPE],
  declarationsFor: () => [TC_SPACE_DECL],
  generateGLSL: (node: GraphNode, inputVars) => {
    const id = node.id;
    const pos = inputVars.pos || 'vec3(0.0)';
    const size = p(node.params.size, 1), round = p(node.params.roundness, 0.4);
    return {
      code: [
        // The view's box (its 16:9 default, Time stretch 1.6, when no view has set it).
        `    vec3 ${id}_B = g_tcB.x > 0.0 ? g_tcB : 0.5 * ${size} * vec3(1.7777778, 1.0, 1.6);\n`,
        `    float ${id}_r = g_tcB.x > 0.0 ? g_tcR : clamp(${round}, 0.0, 1.0) * min(${id}_B.x, min(${id}_B.y, ${id}_B.z));\n`,
        `    float ${id}_dist = tcRoundBox(${pos}, ${id}_B, ${id}_r);\n`,
        // The nearest box so far keeps its own point and its copy (Repeat Scene's cell), for the view to read.
        `    if (${id}_dist < g_tcBest) { g_tcBest = ${id}_dist; g_tcQ = ${pos}; g_tcCell = g_cell3; }\n`,
      ].join(''),
      outputVars: { dist: `${id}_dist` },
    };
  },
};

// ── Time Slice (2D) ──────────────────────────────────────────────────────────

export const TimeSliceNode: NodeDefinition = {
  type: TIME_SLICE_TYPE,
  label: 'Time Slice',
  category: 'Sources',
  aliases: ['Slit-scan', 'Time displacement', 'Time cut', 'Space-time slice', 'Video volume slice'],
  description: 'A flat cut through a Time Cube, as a picture: one frame, a tilted plane (time runs across the picture: slit-scan), one row or column of the video through time, or each pixel at its own moment (wire a Delay map).',
  inputs: {
    volume: { type: 'volume', label: 'Volume', hint: 'A Time Cube\'s Volume.' },
    uv: { type: 'vec2', label: 'UV', hint: 'Where to read. Unwired, the cut fills the picture.' },
    slice: { type: 'float', label: 'Offset', hint: 'Where the cut is in time (or which row / column), 0–1. Wire Time or an LFO here.' },
    delay: { type: 'float', label: 'Delay map', hint: 'A value per pixel (0–1, e.g. a gradient or noise): pushes each pixel that far back in time, times Delay amount.' },
  },
  outputs: {
    color: { type: 'vec3', label: 'Color', hint: 'The cut at this pixel.' },
    value: { type: 'float', label: 'Value', hint: 'Its brightness.' },
    time: { type: 'float', label: 'Time', hint: 'Where in the volume (0–1 in time) this pixel was read.' },
  },
  defaultParams: { slice: 0.5, mode: 'plane', tiltX: 0, tiltY: 0, delayAmount: 0.5, timeEdge: 'hold', brightness: 0, contrast: 1 },
  paramDefs: {
    slice: { label: 'Offset', type: 'float', min: 0, max: 1, step: 0.001, hint: 'Where the cut is in time (Plane), or which row (Row through time) or column (Column through time).' },
    mode: { label: 'Cut', type: 'select', options: [
      { value: 'plane', label: 'Plane (a frame, tilt for slit-scan)' },
      { value: 'row', label: 'Row through time (time runs up)' },
      { value: 'column', label: 'Column through time (time runs right)' },
    ], hint: 'Which way to cut the box.' },
    tiltX: { label: 'Tilt X°', type: 'float', min: -75, max: 75, step: 0.5, showWhen: { param: 'mode', value: 'plane' }, hint: 'Time runs across the picture, left to right: each column from its own moment.' },
    tiltY: { label: 'Tilt Y°', type: 'float', min: -75, max: 75, step: 0.5, showWhen: { param: 'mode', value: 'plane' }, hint: 'Time runs from bottom to top.' },
    delayAmount: { label: 'Delay amount', type: 'float', min: -1, max: 1, step: 0.01, hint: 'How far back in time the Delay map pushes each pixel (only when a Delay map is wired).' },
    timeEdge: { label: 'Past the ends', type: 'select', options: [{ value: 'hold', label: 'Hold the first / last frame' }, { value: 'loop', label: 'Loop' }, { value: 'bounce', label: 'Bounce' }], hint: 'What a time before 0 or after 1 reads.' },
    brightness: { label: 'Brightness', type: 'float', min: -1, max: 1, step: 0.01, hint: 'Added to the colour.' },
    contrast: { label: 'Contrast', type: 'float', min: 0, max: 3, step: 0.01, hint: 'Spreads the colours from mid grey.' },
  },
  assignable: false,
  glslFunctions: [TC_TILE, TC_SAMPLE],
  generateGLSL: (node: GraphNode, inputVars) => {
    const id = node.id, P = node.params;
    const V = inputVars.volume;
    if (!V) return { code: `    vec3 ${id}_color = vec3(0.0);\n    float ${id}_value = 0.0;\n    float ${id}_t = 0.0;\n`, outputVars: { color: `${id}_color`, value: `${id}_value`, time: `${id}_t` } };
    const slice = inputVars.slice ?? p(P.slice, 0.5);
    const mode = P.mode === 'row' || P.mode === 'column' ? P.mode : 'plane';
    const delay = inputVars.delay ? ` + ${inputVars.delay} * ${p(P.delayAmount, 0.5)}` : '';
    const edge = P.timeEdge === 'loop' ? `fract(${id}_t0)` : P.timeEdge === 'bounce' ? `1.0 - abs(1.0 - mod(${id}_t0, 2.0))` : `clamp(${id}_t0, 0.0, 1.0)`;
    const where = mode === 'row'
      ? [`    vec2 ${id}_fv = vec2(${id}_st.x, ${slice});\n`, `    float ${id}_t0 = ${id}_st.y${delay};\n`]
      : mode === 'column'
        ? [`    vec2 ${id}_fv = vec2(${slice}, ${id}_st.y);\n`, `    float ${id}_t0 = ${id}_st.x${delay};\n`]
        : [
          `    vec2 ${id}_fv = ${id}_st;\n`,
          `    float ${id}_t0 = ${slice} + tan(radians(clamp(${p(P.tiltX, 0)}, -85.0, 85.0))) * (${id}_st.x - 0.5) + tan(radians(clamp(${p(P.tiltY, 0)}, -85.0, 85.0))) * (${id}_st.y - 0.5)${delay};\n`,
        ];
    const code = [
      // Centred picture coordinates back to 0–1 over the frame (as Texture Input reads).
      `    vec2 ${id}_st = clamp(${inputVars.uv ?? 'g_uv'} / vec2(u_resolution.x / u_resolution.y, 1.0) * 0.5 + 0.5, 0.0, 1.0);\n`,
      ...where,
      `    float ${id}_t = ${edge};\n`,
      `    vec3 ${id}_color = clamp((tcSample(${V}, ${volLayout(V)}, ${volPx(V)}, vec3(${id}_fv, ${id}_t)) - 0.5) * ${p(P.contrast, 1)} + 0.5 + ${p(P.brightness, 0)}, 0.0, 1.0);\n`,
      `    float ${id}_value = dot(${id}_color, ${LUMA});\n`,
    ].join('');
    return { code, outputVars: { color: `${id}_color`, value: `${id}_value`, time: `${id}_t` } };
  },
};
