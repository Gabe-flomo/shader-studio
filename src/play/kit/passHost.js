// passHost.js — Pass node programs on a web page (docs/pass-node-plan.md, phase 5).
//
// The page's own WebGL2 context, no three.js. The runtime (play-runtime.js) hands it the
// compiled pass programs the export carries (bundle.graphPasses) and a few hooks into its
// own uniform binding, so every pass program reads the same uniforms, images, videos, Data
// textures and feedback the picture does (as the app's pass programs share the preview's
// uniform table). The schedule (which passes draw, in what order, their sizes, Previous
// ping-pong and when targets are made again) is passPlan.js, which the app's
// lib/passRunner.ts runs too, so the two can't drift.
//
// Top-level names start with `ph` (the kit's one-scope rule).
import { ppDrawn, ppPixel, ppSize, ppStaged, ppTargetKey } from './passPlan.js';

/** A pass's texture settings as GL enums. */
function phWrap(gl, w) {
  return w === 'repeat' ? gl.REPEAT : w === 'mirror' ? gl.MIRRORED_REPEAT : gl.CLAMP_TO_EDGE;
}

/**
 * passes: the bundle's graphPasses, in drawing order: { slug, label, fragmentShader, scale,
 * format, filter, wrap, previous, live, afterAgents?, u: { tex, prev } } (u: the sampler names).
 * env: {
 *   link(fragmentShader) → WebGLProgram: compiled as the page compiles its picture (throws on error),
 *   use(program, w, h): make it current with every input the picture has, u_resolution = w × h,
 *   done(): after a program drew,
 *   quad(): draw the full-picture quad,
 *   textures: Map sampler name → texture (null: blank), bound in every program the page draws,
 *   vec2s: Map uniform name → [x, y], set in every program the page draws,
 *   halfFloat: whether half-float targets can be drawn into,
 * }
 */
export function phCreate(gl, passes, env) {
  const entries = (passes || []).map(spec => {
    let program = null;
    try { program = env.link(spec.fragmentShader); } catch (e) {
      if (typeof console !== 'undefined') console.warn('[Playfield] The pass "' + (spec.label || spec.slug) + '" did not compile here: ' + (e && e.message ? e.message : e));
    }
    return Object.assign({}, spec, { program });
  });
  // Every pass's sampler starts blank (as an empty texture in the app), its `_px` at one pixel.
  for (const e of entries) {
    env.textures.set(e.u.tex, null); env.textures.set(e.u.prev, null);
    env.vec2s.set(e.u.tex + '_px', [1, 1]); env.vec2s.set(e.u.prev + '_px', [1, 1]);
  }
  const targets = new Map();

  const makeTarget = (p, w, h) => {
    const byte = p.format === 'byte' || !env.halfFloat;
    const filter = p.filter === 'nearest' ? gl.NEAREST : gl.LINEAR, wrap = phWrap(gl, p.wrap);
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
    gl.texImage2D(gl.TEXTURE_2D, 0, byte ? gl.RGBA8 : gl.RGBA16F, w, h, 0, gl.RGBA, byte ? gl.UNSIGNED_BYTE : gl.HALF_FLOAT, null);
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.viewport(0, 0, w, h); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    return { tex, fb };
  };
  const drop = t => { for (const rt of [t.cur, t.prev]) if (rt) { gl.deleteFramebuffer(rt.fb); gl.deleteTexture(rt.tex); } };
  /** A pass's targets for a picture of w × h, made (cleared) when its size or settings change. */
  const ensure = (p, w, h) => {
    const key = ppTargetKey(p, w, h);
    let t = targets.get(p.slug);
    if (t && t.key === key) return t;
    if (t) drop(t);
    const [tw, th] = ppSize(w, h, p.scale);
    t = { key, w: tw, h: th, cur: makeTarget(p, tw, th), prev: p.previous ? makeTarget(p, tw, th) : null };
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    targets.set(p.slug, t);
    return t;
  };

  return {
    /** Some pass keeps its previous frame (the page keeps drawing it like feedback). */
    hasPrevious: entries.some(e => e.live && e.previous),
    /**
     * Draw the passes the picture needs for a picture of w × h (the stage's, with agents),
     * and leave their textures in env.textures for every program after them.
     */
    run(w, h, stage) {
      const drawn = ppDrawn(entries);
      const keep = new Set(drawn.map(d => d.slug));
      for (const [slug, t] of targets) if (!keep.has(slug)) { drop(t); targets.delete(slug); }
      const px = ppPixel(w, h);
      // Every pass's previous frame first: a pass earlier in the order may read a later one's Previous.
      for (const d of drawn) {
        const t = ensure(d, w, h);
        if (t.prev) env.textures.set(d.u.prev, t.prev.tex);
        env.vec2s.set(d.u.tex + '_px', px.slice());
        env.vec2s.set(d.u.prev + '_px', px.slice());
      }
      for (const d of ppStaged(drawn, stage)) {
        const t = targets.get(d.slug);
        if (!d.program) { env.textures.set(d.u.tex, null); continue; }
        gl.bindFramebuffer(gl.FRAMEBUFFER, t.cur.fb);
        gl.viewport(0, 0, t.w, t.h);
        env.use(d.program, t.w, t.h);
        env.quad();
        env.done();
        env.textures.set(d.u.tex, t.cur.tex);
        // Ping-pong: this frame's picture is the next frame's Previous.
        if (t.prev) { const c = t.cur; t.cur = t.prev; t.prev = c; }
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    },
    /** Start every Previous over (black): a new render. */
    clearPrevious() {
      gl.clearColor(0, 0, 0, 0);
      for (const t of targets.values()) for (const rt of [t.cur, t.prev]) {
        if (!rt) continue;
        gl.bindFramebuffer(gl.FRAMEBUFFER, rt.fb); gl.viewport(0, 0, t.w, t.h); gl.clear(gl.COLOR_BUFFER_BIT);
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    },
    dispose() {
      for (const t of targets.values()) drop(t);
      targets.clear();
      for (const e of entries) if (e.program) gl.deleteProgram(e.program);
    },
  };
}
