import type { GraphNode } from '../types/nodeGraph';

// ─── Keyframe data model ────────────────────────────────────────────────────
//
// Lives entirely in node.params under `__`-prefixed keys, the same "node-level
// metadata, not a real shader param" convention already used by __comment and
// __codeOverride — no changes to GraphNode/InputSocket types needed, and it
// survives save/export/import/undo for free (params is a plain unvalidated
// Record<string, unknown> everywhere it's persisted).
//
// __keyframes_<socketKey> : Keyframe[]
// __kfMode_<socketKey>    : 'once' | 'loop' | 'interpolate'   (default 'once')
// __kfLoopBack_<socketKey>: number seconds                     (default 1, 'interpolate' only)

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

export function getKeyframeConfig(node: GraphNode, socketKey: string): KeyframeConfig | null {
  const raw = node.params[`__keyframes_${socketKey}`];
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const keyframes: Keyframe[] = raw
    .filter((k): k is Keyframe => k && typeof k === 'object' && typeof (k as Keyframe).t === 'number' && typeof (k as Keyframe).v === 'number')
    .map(k => ({
      t: k.t,
      v: k.v,
      ease: k.ease && typeof k.ease === 'object' ? k.ease : EASING_PRESETS.ease,
    }))
    .sort((a, b) => a.t - b.t);
  if (keyframes.length === 0) return null;

  const modeRaw = node.params[`__kfMode_${socketKey}`];
  const mode: KeyframeLoopMode = modeRaw === 'loop' || modeRaw === 'interpolate' ? modeRaw : 'once';
  const loopBackRaw = node.params[`__kfLoopBack_${socketKey}`];
  const loopBack = typeof loopBackRaw === 'number' && loopBackRaw > 0 ? loopBackRaw : 1.0;

  return { keyframes, mode, loopBack };
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
  return clamp(kfBezXfromT(t,E,F,G,0.0),0.0,1.0);
}`;

function fnum(n: number): string {
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
  const { keyframes, mode, loopBack } = cfg;
  const t0 = keyframes[0].t;
  const duration = Math.max(keyframes[keyframes.length - 1].t - t0, 0.0001);

  // Segments: consecutive keyframe pairs, plus (for 'interpolate') a synthetic
  // final segment easing from the last keyframe's value back to the first's,
  // over loopBack seconds — the "smooth loop back" the value shifts through
  // instead of a hard cut.
  type Seg = { start: number; end: number; v0: number; v1: number; ease: KeyframeEasing };
  const segs: Seg[] = [];
  for (let i = 0; i < keyframes.length - 1; i++) {
    const a = keyframes[i], b = keyframes[i + 1];
    segs.push({ start: a.t - t0, end: b.t - t0, v0: a.v, v1: b.v, ease: a.ease });
  }
  if (mode === 'interpolate') {
    const last = keyframes[keyframes.length - 1];
    segs.push({ start: duration, end: duration + loopBack, v0: last.v, v1: keyframes[0].v, ease: last.ease });
  }

  const loopSpan = mode === 'interpolate' ? duration + loopBack : duration;
  const localTimeExpr =
    mode === 'once'
      ? `clamp(t - ${fnum(t0)}, 0.0, ${fnum(duration)})`
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
