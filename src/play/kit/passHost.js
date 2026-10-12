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
import { ppDrawn, ppKeeps, ppPixel, ppPrevBound, ppRepeat, ppSize, ppSplitsForParticles, ppStaged, ppTargetKey } from './passPlan.js';

/** A pass's texture settings as GL enums. */
function phWrap(gl, w) {
  return w === 'repeat' ? gl.REPEAT : w === 'mirror' ? gl.MIRRORED_REPEAT : gl.CLAMP_TO_EDGE;
}

/** Every sampler name a pass has: its texture and frame before, and each extra target's (MRT). */
function phNames(e) {
  const out = [e.u.tex, e.u.prev];
  for (const x of e.u.extra || []) out.push(x.tex, x.prev);
  return out;
}

/**
 * passes: the bundle's graphPasses, in drawing order: { slug, label, fragmentShader, scale,
 * format, filter, wrap, previous, live, afterAgents?, beforeParticles?, repeat?, size?, update?, reads?, u: { tex, prev, iter? } } (u: the sampler names;
 * iter, a repeated pass's step uniform).
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
    for (const n of phNames(e)) { env.textures.set(n, null); env.vec2s.set(n + '_px', [1, 1]); }
    // Repeat: its step ([step, count]), only for a repeated pass (it alone declares it).
    if (e.u.iter) env.vec2s.set(e.u.iter, [0, ppRepeat(e)]);
  }
  const targets = new Map();

  /** One texture of a target, with its own precision and filter. */
  const makeTex = (p, w, h) => {
    const byte = p.format === 'byte' || !env.halfFloat;
    // Full float (32-bit, for data) where the GPU can draw into it, else half; exact texels without float filtering.
    const full = !byte && p.format === 'float' && !!gl.getExtension('EXT_color_buffer_float');
    const smooth = p.filter !== 'nearest' && (!full || !!gl.getExtension('OES_texture_float_linear'));
    const filter = smooth ? gl.LINEAR : gl.NEAREST, wrap = phWrap(gl, p.wrap);
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
    gl.texImage2D(gl.TEXTURE_2D, 0, byte ? gl.RGBA8 : full ? gl.RGBA32F : gl.RGBA16F, w, h, 0, gl.RGBA, byte ? gl.UNSIGNED_BYTE : full ? gl.FLOAT : gl.HALF_FLOAT, null);
    return tex;
  };
  /** A target: its first texture, and (MRT, docs/render-targets.md) one more per extra target, all drawn at once. */
  const makeTarget = (p, w, h) => {
    const tex = makeTex(p, w, h);
    const extra = (p.extra || []).map(x => makeTex({ ...p, format: x.format, filter: x.filter }, w, h));
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    extra.forEach((x, i) => gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i + 1, gl.TEXTURE_2D, x, 0));
    if (extra.length) gl.drawBuffers([gl.COLOR_ATTACHMENT0, ...extra.map((_, i) => gl.COLOR_ATTACHMENT0 + i + 1)]);
    gl.viewport(0, 0, w, h); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    return { tex, extra, fb };
  };
  const drop = t => { for (const rt of [t.cur, t.prev]) if (rt) { gl.deleteFramebuffer(rt.fb); gl.deleteTexture(rt.tex); rt.extra.forEach(x => gl.deleteTexture(x)); } };
  /** A target's textures as a pass's samplers (cur: Texture outputs, prev: Previous outputs). */
  const bind = (d, rt, which) => {
    env.textures.set(which === 'prev' ? d.u.prev : d.u.tex, rt ? rt.tex : null);
    (d.u.extra || []).forEach((x, i) => env.textures.set(which === 'prev' ? x.prev : x.tex, rt ? rt.extra[i] : null));
  };
  /** A pass's targets for a picture of w × h, made (cleared) when its size or settings change. */
  const ensure = (p, w, h) => {
    const key = ppTargetKey(p, w, h);
    let t = targets.get(p.slug);
    if (t && t.key === key) return t;
    if (t) drop(t);
    const [tw, th] = ppSize(w, h, p.scale, p.size);
    t = { key, w: tw, h: th, cur: makeTarget(p, tw, th), prev: p.previous ? makeTarget(p, tw, th) : null };
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    targets.set(p.slug, t);
    return t;
  };

  return {
    /** Some pass keeps its previous frame (the page keeps drawing it like feedback). */
    hasPrevious: entries.some(e => e.live && e.previous),
    /** Some pass the frame draws is read by the Particles nodes: run part 'particles' before them, then 'rest'. */
    splitsForParticles: ppSplitsForParticles(ppDrawn(entries)),
    /**
     * Draw the passes the picture needs for a picture of w × h (the stage's, with agents; the
     * part's, round the particles), and leave their textures in env.textures for every program after them.
     */
    run(w, h, stage, part) {
      const drawn = ppDrawn(entries);
      const keep = new Set(drawn.map(d => d.slug));
      for (const [slug, t] of targets) if (!keep.has(slug)) { drop(t); targets.delete(slug); }
      const px = ppPixel(w, h);
      // Every pass's previous frame first: a pass earlier in the order may read a later one's Previous.
      // (Not a pass an earlier call this frame drew: its sampler keeps the frame before: ppPrevBound.)
      const fresh = new Set(ppPrevBound(drawn, stage, part).map(d => d.slug));
      for (const d of drawn) {
        const t = ensure(d, w, h);
        if (t.prev && fresh.has(d.slug)) bind(d, t.prev, 'prev');
        for (const n of phNames(d)) env.vec2s.set(n + '_px', px.slice());
      }
      for (const d of ppStaged(drawn, stage, part)) {
        const t = targets.get(d.slug);
        if (!d.program) { bind(d, null, 'cur'); continue; }
        // A Shader Texture on Update Once keeps its picture once drawn (its target is made again on a resize
        // or settings change, and starts over). On a page On change draws every frame: the page has no cheap
        // view of the values a program reads, so it never risks a stale texture.
        const sig = d.update === 'once' ? 'once' : undefined;
        if (sig && ppKeeps(d, t.drawn, sig)) { bind(d, t.cur, 'cur'); continue; }
        // Repeat (phase 7): N draws, each reading the one before through Previous.
        const n = ppRepeat(d);
        for (let i = 0; i < n; i++) {
          if (d.u.iter) env.vec2s.set(d.u.iter, [i, n]);
          if (i > 0 && t.prev) bind(d, t.prev, 'prev');
          gl.bindFramebuffer(gl.FRAMEBUFFER, t.cur.fb);
          gl.viewport(0, 0, t.w, t.h);
          env.use(d.program, t.w, t.h);
          env.quad();
          env.done();
          bind(d, t.cur, 'cur');
          // Ping-pong: this frame's picture is the next frame's Previous (and the next repeat's).
          if (t.prev) { const c = t.cur; t.cur = t.prev; t.prev = c; }
        }
        t.drawn = sig;
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    },
    /** Start every Previous over (black): a new render. */
    clearPrevious() {
      gl.clearColor(0, 0, 0, 0);
      for (const t of targets.values()) t.drawn = undefined;
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
