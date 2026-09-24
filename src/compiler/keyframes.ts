import type { GraphNode } from '../types/nodeGraph';

// ─── Keyframe data model ────────────────────────────────────────────────────
//
// Lives entirely in node.params under `__`-prefixed keys, the same "node-level
// metadata, not a real shader param" convention already used by __comment and
// __codeOverride — no changes to GraphNode/InputSocket types needed, and it
// survives save/export/import/undo for free (params is a plain unvalidated
// Record<string, unknown> everywhere it's persisted).
//
// __keyframes_<socketKey>      : Keyframe[]                          (float sockets)
// __keyframes_<socketKey>_x/y/z: Keyframe[]                          (vec2/vec3 sockets, per axis)
// __kfMode_<socketKey>         : 'once' | 'loop' | 'interpolate'      (default 'once', shared across axes)
// __kfLoopBack_<socketKey>     : number seconds                      (default 1, 'interpolate' only, shared across axes)
// __kfBypass_<socketKey>       : boolean                             (default false — data stays, compiler ignores it)
// __kfOffset_<socketKey>       : number seconds                      (default 0 — global-time delay before this track starts)
// __kfLoopCount_<socketKey>    : number | undefined                  (default undefined = loop forever; 'loop'/'interpolate' only)
//
// Vector (vec2/vec3) keyframing only applies to a socket whose InputSocket
// declares `axisParams` — the float param names backing each axis's static
// fallback (e.g. UvTransform2D's `translate` socket, axisParams: ['tx','ty']).
// Each axis is otherwise an independent float keyframe track reusing every
// helper below; mode/loopBack/bypass are shared per-socket, not per-axis.

export const VECTOR_AXES: Record<'vec2' | 'vec3', readonly string[]> = {
  vec2: ['x', 'y'],
  vec3: ['x', 'y', 'z'],
};

export interface KeyframeEasing {
  a: number; b: number; c: number; d: number; // CSS cubic-bezier() convention
}

export interface Keyframe {
  t: number; // seconds, relative to the graph's global clock (u_time)
  v: number;
  /** Eases the segment FROM this keyframe TO the next one. Unused on the last
   *  keyframe except in 'interpolate' mode, where it eases the synthetic
   *  loop-back segment back to the first keyframe's value. */
  ease: KeyframeEasing;
}

export type KeyframeLoopMode = 'once' | 'loop' | 'interpolate';

export interface KeyframeConfig {
  keyframes: Keyframe[];
  mode: KeyframeLoopMode;
  loopBack: number;
  /** Global-time delay before this track starts playing — shifts the whole
   *  track without moving any keyframe. */
  offset: number;
  /** For 'loop'/'interpolate': stop after this many cycles and hold the
   *  final value, instead of looping forever. null = loop forever. */
  loopCount: number | null;
}

export const EASING_PRESETS: Record<string, KeyframeEasing> = {
  linear:    { a: 0.00, b: 0.00, c: 1.00, d: 1.00 },
  ease:      { a: 0.25, b: 0.10, c: 0.25, d: 1.00 }, // CSS default `ease`
  easeIn:    { a: 0.42, b: 0.00, c: 1.00, d: 1.00 },
  easeOut:   { a: 0.00, b: 0.00, c: 0.58, d: 1.00 },
  easeInOut: { a: 0.42, b: 0.00, c: 0.58, d: 1.00 },
};

export function socketHasKeyframes(node: GraphNode, socketKey: string): boolean {
  const kf = node.params[`__keyframes_${socketKey}`];
  return Array.isArray(kf) && kf.length > 0;
}

export function isKeyframeBypassed(node: GraphNode, socketKey: string): boolean {
  return node.params[`__kfBypass_${socketKey}`] === true;
}

function parseKeyframeArray(raw: unknown): Keyframe[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((k): k is Keyframe => k && typeof k === 'object' && typeof (k as Keyframe).t === 'number' && typeof (k as Keyframe).v === 'number')
    .map(k => ({
      t: k.t,
      v: k.v,
      ease: k.ease && typeof k.ease === 'object' ? k.ease : EASING_PRESETS.ease,
    }))
    .sort((a, b) => a.t - b.t);
}

function readSharedSettings(node: GraphNode, socketKey: string): { mode: KeyframeLoopMode; loopBack: number; offset: number; loopCount: number | null } {
  const modeRaw = node.params[`__kfMode_${socketKey}`];
  const mode: KeyframeLoopMode = modeRaw === 'loop' || modeRaw === 'interpolate' ? modeRaw : 'once';
  const loopBackRaw = node.params[`__kfLoopBack_${socketKey}`];
  const loopBack = typeof loopBackRaw === 'number' && loopBackRaw > 0 ? loopBackRaw : 1.0;
  const offsetRaw = node.params[`__kfOffset_${socketKey}`];
  const offset = typeof offsetRaw === 'number' ? offsetRaw : 0;
  const loopCountRaw = node.params[`__kfLoopCount_${socketKey}`];
  const loopCount = typeof loopCountRaw === 'number' && loopCountRaw > 0 ? loopCountRaw : null;
  return { mode, loopBack, offset, loopCount };
}

export function getKeyframeConfig(node: GraphNode, socketKey: string): KeyframeConfig | null {
  const keyframes = parseKeyframeArray(node.params[`__keyframes_${socketKey}`]);
  if (keyframes.length === 0) return null;
  return { keyframes, ...readSharedSettings(node, socketKey) };
}

/** Same as getKeyframeConfig, but for one axis of a vec2/vec3 socket —
 *  keyframes are read per-axis (`__keyframes_<socketKey>_<axis>`) while
 *  mode/loopBack/offset/loopCount are read from the socket itself (shared
 *  across axes). */
export function getAxisKeyframeConfig(node: GraphNode, socketKey: string, axis: string): KeyframeConfig | null {
  const keyframes = parseKeyframeArray(node.params[`__keyframes_${socketKey}_${axis}`]);
  if (keyframes.length === 0) return null;
  return { keyframes, ...readSharedSettings(node, socketKey) };
}

export function socketHasVectorKeyframes(node: GraphNode, socketKey: string, axes: readonly string[]): boolean {
  return axes.some(axis => {
    const kf = node.params[`__keyframes_${socketKey}_${axis}`];
    return Array.isArray(kf) && kf.length > 0;
  });
}

// ─── JS evaluation ───────────────────────────────────────────────────────────

/** Mirrors kfCubicBezier (CSS cubic-bezier, Newton solve, output unclamped for overshoot). */
function cubicBezier(x: number, a: number, b: number, c: number, d: number): number {
  const A = 1 - 3 * c + 3 * a, B = 3 * c - 6 * a, C = 3 * a;
  let t = Math.min(1, Math.max(0, x));
  for (let i = 0; i < 5; i++) {
    const cx = A * t * t * t + B * t * t + C * t;
    t -= (cx - x) / (3 * A * t * t + 2 * B * t + C || 1e-6);
    t = Math.min(1, Math.max(0, t));
  }
  const E = 1 - 3 * d + 3 * b, F = 3 * d - 6 * b, G = 3 * b;
  return E * t * t * t + F * t * t + G * t;
}

/** The value a keyframe track has at global time `t` — the same maths as generateKeyframeGLSL. */
export function evaluateKeyframes(cfg: KeyframeConfig, t: number): number {
  const { keyframes, mode, loopBack, offset, loopCount } = cfg;
  const t0 = keyframes[0].t + offset;
  const duration = Math.max(keyframes[keyframes.length - 1].t - keyframes[0].t, 0.0001);
  const loopSpan = mode === 'interpolate' ? duration + loopBack : duration;
  const glslMod = (x: number, y: number) => x - y * Math.floor(x / y);
  const lt = mode === 'once' ? Math.min(duration, Math.max(0, t - t0))
    : loopCount != null && t - t0 >= loopCount * loopSpan ? loopSpan
      : glslMod(t - t0, loopSpan);
  const segs: { start: number; end: number; v0: number; v1: number; ease: KeyframeEasing }[] = [];
  for (let i = 0; i < keyframes.length - 1; i++) {
    const a = keyframes[i], b = keyframes[i + 1];
    segs.push({ start: a.t - keyframes[0].t, end: b.t - keyframes[0].t, v0: a.v, v1: b.v, ease: a.ease });
  }
  if (mode === 'interpolate') {
    const last = keyframes[keyframes.length - 1];
    segs.push({ start: duration, end: duration + loopBack, v0: last.v, v1: keyframes[0].v, ease: last.ease });
  }
  if (segs.length === 0) return keyframes[0].v;
  for (const seg of segs) {
    if (lt < seg.end) {
      const st = Math.min(1, Math.max(0, (lt - seg.start) / Math.max(seg.end - seg.start, 0.0001)));
      return seg.v0 + (seg.v1 - seg.v0) * cubicBezier(st, seg.ease.a, seg.ease.b, seg.ease.c, seg.ease.d);
    }
  }
  return segs[segs.length - 1].v1;
}

// ─── GLSL codegen ────────────────────────────────────────────────────────────
//
// Reuses the exact cubic-bezier-with-Newton's-method solve already proven out
// by CubicBezierShaperNode (shapers.ts) — same CSS cubic-bezier() convention,
// so easing presets are directly portable — but under a distinct function
// name (kfCubicBezier) so it never collides with that node's own glslFunction
// string if both end up in the same shader (this.functions dedupes by exact
// string match, not by name, so two *different* bodies sharing a name would
// be a GLSL redefinition error).
const KF_BEZIER_GLSL = `float kfBezXfromT(float t,float A,float B,float C,float D){return A*(t*t*t)+B*(t*t)+C*t+D;}
float kfBezSlope(float t,float A,float B,float C){return 1.0/(3.0*A*t*t+2.0*B*t+C);}
float kfCubicBezier(float x,float a,float b,float c,float d){
  float A=1.0-3.0*c+3.0*a,B=3.0*c-6.0*a,C=3.0*a;
  float t=clamp(x,0.0,1.0);
  for(int i=0;i<5;i++){
    float cx=kfBezXfromT(t,A,B,C,0.0);
    t-=(cx-x)*kfBezSlope(t,A,B,C);
    t=clamp(t,0.0,1.0);
  }
  float E=1.0-3.0*d+3.0*b,F=3.0*d-6.0*b,G=3.0*b;
  // NOT clamped to [0,1] — an ease handle dragged past the segment's normal
  // value range (b/d unbounded, unlike a/c) is how you author a bounce/
  // overshoot effect; clamping here would silently discard exactly that,
  // playing back a flattened curve while the editor's own JS preview
  // (evalCubicBezier in KeyframeEditorModal.tsx, deliberately unclamped to
  // match) kept showing the real, unflattened shape.
  return kfBezXfromT(t,E,F,G,0.0);
}`;

export function fnum(n: number): string {
  return Number.isInteger(n) ? `${n}.0` : `${n}`;
}

/**
 * Generates a standalone GLSL function evaluating a keyframe curve against
 * u_time, plus the call expression to use as the resolved input variable.
 * The whole curve is baked into one function body (unrolled if/else per
 * segment) rather than passed as runtime arrays — GLSL ES 1.00 array-param
 * indexing is a portability risk this sidesteps entirely, and the keyframe
 * data is known at graph-compile time anyway (same reasoning Chladni
 * Superposition already uses for its variable Terms count).
 */
export function generateKeyframeGLSL(
  fnName: string,
  cfg: KeyframeConfig,
): { glslFunction: string; sharedFunction: string; expr: string } {
  const { keyframes, mode, loopBack, offset, loopCount } = cfg;
  // offset shifts the whole track in global time without moving any
  // keyframe: t0 is "when local time 0 happens", so the track's first
  // keyframe plays at global time (t0 + offset), not just t0.
  const t0 = keyframes[0].t + offset;
  const duration = Math.max(keyframes[keyframes.length - 1].t - keyframes[0].t, 0.0001);

  // Segments: consecutive keyframe pairs, plus (for 'interpolate') a synthetic
  // final segment easing from the last keyframe's value back to the first's,
  // over loopBack seconds — the "smooth loop back" the value shifts through
  // instead of a hard cut.
  type Seg = { start: number; end: number; v0: number; v1: number; ease: KeyframeEasing };
  const segs: Seg[] = [];
  for (let i = 0; i < keyframes.length - 1; i++) {
    const a = keyframes[i], b = keyframes[i + 1];
    segs.push({ start: a.t - keyframes[0].t, end: b.t - keyframes[0].t, v0: a.v, v1: b.v, ease: a.ease });
  }
  if (mode === 'interpolate') {
    const last = keyframes[keyframes.length - 1];
    segs.push({ start: duration, end: duration + loopBack, v0: last.v, v1: keyframes[0].v, ease: last.ease });
  }

  const loopSpan = mode === 'interpolate' ? duration + loopBack : duration;
  const localTimeExpr =
    mode === 'once'
      ? `clamp(t - ${fnum(t0)}, 0.0, ${fnum(duration)})`
      : loopCount != null
        ? `((t - ${fnum(t0)}) >= ${fnum(loopCount * loopSpan)} ? ${fnum(loopSpan)} : mod(t - ${fnum(t0)}, ${fnum(loopSpan)}))`
        : `mod(t - ${fnum(t0)}, ${fnum(loopSpan)})`;

  const lines: string[] = [`float ${fnName}(float t) {`, `    float lt = ${localTimeExpr};`];
  if (segs.length === 0) {
    lines.push(`    return ${fnum(keyframes[0].v)};`);
  } else {
    segs.forEach((seg, i) => {
      const keyword = i === 0 ? 'if' : 'else if';
      const segDur = Math.max(seg.end - seg.start, 0.0001);
      lines.push(`    ${keyword} (lt < ${fnum(seg.end)}) {`);
      lines.push(`        float st = clamp((lt - ${fnum(seg.start)}) / ${fnum(segDur)}, 0.0, 1.0);`);
      lines.push(`        return mix(${fnum(seg.v0)}, ${fnum(seg.v1)}, kfCubicBezier(st, ${fnum(seg.ease.a)}, ${fnum(seg.ease.b)}, ${fnum(seg.ease.c)}, ${fnum(seg.ease.d)}));`);
      lines.push(`    }`);
    });
    lines.push(`    return ${fnum(segs[segs.length - 1].v1)};`);
  }
  lines.push(`}`);

  return {
    // Kept separate from the shared bezier-solve helper below so multiple
    // keyframed sockets — each with their own uniquely-named wrapper here —
    // don't cause that shared helper to be registered under several different
    // (prefix+wrapper) strings; this.functions dedupes by exact string match,
    // so baking it into every wrapper made the helper's own function
    // definitions collide the moment two sockets were both keyframed.
    glslFunction: lines.join('\n'),
    sharedFunction: KF_BEZIER_GLSL,
    expr: `${fnName}(u_time)`,
  };
}

/**
 * vec2/vec3 counterpart to generateKeyframeGLSL — one axis at a time reuses
 * that same per-axis function, then combines the per-axis expressions (or,
 * for an axis with no keyframes, its current static value) into a single
 * vecN(...) constructor expression.
 */
export function generateVectorKeyframeGLSL(
  fnPrefix: string,
  axisConfigs: (KeyframeConfig | null)[],
  staticFallbacks: number[],
  vecType: 'vec2' | 'vec3',
): { glslFunctions: string[]; sharedFunction: string | null; expr: string } {
  const glslFunctions: string[] = [];
  let sharedFunction: string | null = null;
  const axes = VECTOR_AXES[vecType];
  const parts = axes.map((axis, i) => {
    const cfg = axisConfigs[i];
    if (!cfg) return fnum(staticFallbacks[i] ?? 0);
    const { glslFunction, sharedFunction: shared, expr } = generateKeyframeGLSL(`${fnPrefix}_${axis}`, cfg);
    glslFunctions.push(glslFunction);
    sharedFunction = shared;
    return expr;
  });
  return { glslFunctions, sharedFunction, expr: `${vecType}(${parts.join(', ')})` };
}
