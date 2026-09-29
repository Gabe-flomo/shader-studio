/**
 * jfa.js — the Layers node's distance field on the GPU: a jump flood over
 * the layers' alpha, giving an exact Euclidean signed distance (graph UV
 * units, a picture height = 2, negative inside) in a half-float texture the
 * graph samples with linear filtering. See docs/layers-node.md.
 *
 * How it works, per frame:
 *   1. Seed: every grid texel on the alpha = 0.5 contour becomes a seed at
 *      its sub-texel edge point (alpha and its gradient place the edge
 *      within the texel), so the zero crossing sits on the anti-aliased edge,
 *      not on texel centres. A faint texel (minCover < alpha < 0.5, nothing
 *      solid next to it: a small or fading particle) seeds a disc of its
 *      covered area, as geoFieldFromCoverage does on the CPU.
 *   2. Flood: log2(N) passes with steps N/2 … 1, then one more step-1 pass
 *      (JFA+1), each texel keeping the nearest of its 9 neighbours' seeds.
 *   3. Resolve: distance to the kept seed, signed by the texel's alpha.
 *
 * One raw WebGL2 implementation serves both hosts: the app runs it on the
 * three.js renderer's context (then resets three's state) and hands the
 * result over as a THREE.ExternalTexture; the web runtime runs it on its own
 * context. Without WebGL2 or float render targets jfCreate returns null and
 * the host keeps the old CPU chamfer field.
 *
 * Part of the layer kit: exportHtml.ts inlines it into web exports, so every
 * top-level name keeps the `jf`/`JF_` prefix.
 */

/** Longest side of the grid the flood runs on (the app's default quality). */
export const JF_MAX_RES = 1024;
/** Below this coverage a texel is empty (faint trails don't count). */
export const JF_MIN_COVER = 0.04;
/** The field saturates here, in UV units (a picture height is 2). */
export const JF_FAR = 4.0;

const JF_VERT = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

// Seeds, in half floats (RGBA16F, 8 bytes a texel: the flood is bandwidth-bound): xy the seed's
// offset from THIS texel in texels, z a disc radius in texels, w = 1 when there is one. Relative
// offsets keep half-float precision where it matters: 1/32 texel within 32 texels of the seed.
const JF_SEED = `#version 300 es
precision highp float;
uniform sampler2D u_src;
uniform vec2 u_size;
uniform float u_minCover;
out vec4 o;
float A(vec2 p) { return texture(u_src, p / u_size).a; }
void main() {
  vec2 p = gl_FragCoord.xy;
  float a = A(p), l = A(p - vec2(1.0, 0.0)), r = A(p + vec2(1.0, 0.0)), d = A(p - vec2(0.0, 1.0)), u = A(p + vec2(0.0, 1.0));
  bool inside = a >= 0.5;
  bool edge = inside != (l >= 0.5) || inside != (r >= 0.5) || inside != (d >= 0.5) || inside != (u >= 0.5);
  if (edge) {
    // Per axis the steeper one-sided difference: the other side may be flat (a solid or empty texel).
    vec2 g = vec2(abs(r - a) > abs(a - l) ? r - a : a - l, abs(u - a) > abs(a - d) ? u - a : a - d);
    float gl = length(g);
    vec2 off = gl > 1e-4 ? g / gl * clamp((0.5 - a) / gl, -1.0, 1.0) : vec2(0.0);
    o = vec4(off, 0.0, 1.0);
  } else if (!inside && a > u_minCover && a >= max(max(l, r), max(d, u))) {
    // Only a faint peak: the texels of a soft edge around it are not dots of their own.
    o = vec4(0.0, 0.0, sqrt(a / 3.14159265), 1.0);
  } else {
    o = vec4(0.0);
  }
}`;

const JF_FLOOD = `#version 300 es
precision highp float;
uniform highp sampler2D u_seeds;
uniform vec2 u_size;
uniform vec2 u_texel;
uniform float u_step;
out vec4 o;
void main() {
  ivec2 ip = ivec2(gl_FragCoord.xy), sz = ivec2(u_size);
  vec4 best = vec4(0.0);
  float bd = 1e9;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    ivec2 o2 = ivec2(i, j) * int(u_step), q = ip + o2;
    if (q.x < 0 || q.y < 0 || q.x >= sz.x || q.y >= sz.y) continue;
    vec4 s = texelFetch(u_seeds, q, 0);
    if (s.w < 0.5) continue;
    vec2 rel = s.xy + vec2(o2);
    float dd = length(rel * u_texel) - s.z * u_texel.y;
    if (dd < bd) { bd = dd; best = vec4(rel, s.z, 1.0); }
  }
  o = best;
}`;

const JF_RESOLVE = `#version 300 es
precision highp float;
uniform highp sampler2D u_seeds;
uniform sampler2D u_src;
uniform vec2 u_size;
uniform vec2 u_texel;
uniform float u_far;
out vec4 o;
void main() {
  vec2 p = gl_FragCoord.xy;
  vec4 s = texelFetch(u_seeds, ivec2(p), 0);
  float d = s.w > 0.5 ? length(s.xy * u_texel) - s.z * u_texel.y : u_far;
  if (texture(u_src, p / u_size).a >= 0.5) d = -d;
  o = vec4(clamp(d, -u_far, u_far), 0.0, 0.0, 1.0);
}`;

/** The grid for a source of w × h pixels: its long side at most maxRes, never larger than the source. */
export function jfGridSize(w, h, maxRes) {
  const s = Math.min(1, (maxRes || JF_MAX_RES) / Math.max(w, h, 1));
  return { gw: Math.max(1, Math.round(w * s)), gh: Math.max(1, Math.round(h * s)) };
}

/** The flood's steps for a gw × gh grid: N/2 … 1 (N the next power of two), then 1 again (JFA+1). */
export function jfSteps(gw, gh) {
  let n = 1;
  while (n < Math.max(gw, gh)) n *= 2;
  const out = [];
  for (let k = n / 2; k >= 1; k /= 2) out.push(k);
  out.push(1);
  return out;
}

/**
 * The same seed / flood / resolve on the CPU, for tests and as the
 * reference the shaders follow. `alpha` is gw × gh, row 0 at the BOTTOM,
 * sampled at texel centres (no filtering). Returns signed distances in UV
 * units for a picture of the given aspect.
 */
export function jfReference(alpha, gw, gh, aspect, minCover) {
  const tx = 2 * aspect / gw, ty = 2 / gh, n = gw * gh;
  // As the GPU stores them: offsets from each texel, rounded to half floats.
  const abs = jfSeedGrid(alpha, gw, gh, minCover);
  let seeds = new Float32Array(n * 4);
  for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
    const i = (y * gw + x) * 4;
    if (abs[i + 3] < 0.5) continue;
    seeds[i] = jfHalf(abs[i] - x - 0.5); seeds[i + 1] = jfHalf(abs[i + 1] - y - 0.5); seeds[i + 2] = jfHalf(abs[i + 2]); seeds[i + 3] = 1;
  }
  const metric = (rx, ry, r) => Math.hypot(rx * tx, ry * ty) - r * ty;
  for (const k of jfSteps(gw, gh)) {
    const next = new Float32Array(n * 4);
    for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
      const o = (y * gw + x) * 4;
      let bd = 1e9;
      for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
        const qx = x + i * k, qy = y + j * k;
        if (qx < 0 || qy < 0 || qx >= gw || qy >= gh) continue;
        const q = (qy * gw + qx) * 4;
        if (seeds[q + 3] < 0.5) continue;
        const rx = seeds[q] + i * k, ry = seeds[q + 1] + j * k, dd = metric(rx, ry, seeds[q + 2]);
        if (dd < bd) { bd = dd; next[o] = jfHalf(rx); next[o + 1] = jfHalf(ry); next[o + 2] = seeds[q + 2]; next[o + 3] = 1; }
      }
    }
    seeds = next;
  }
  const out = new Float32Array(n);
  for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
    const i = y * gw + x;
    let d = seeds[i * 4 + 3] > 0.5 ? metric(seeds[i * 4], seeds[i * 4 + 1], seeds[i * 4 + 2]) : JF_FAR;
    if (alpha[i] >= 0.5) d = -d;
    out[i] = Math.max(-JF_FAR, Math.min(JF_FAR, d));
  }
  return out;
}

/** x rounded to the nearest half float (11 significant bits), as an RGBA16F texture stores it. */
export function jfHalf(x) {
  if (x === 0 || !isFinite(x)) return x;
  const e = Math.max(-14, Math.floor(Math.log2(Math.abs(x)))), ulp = Math.pow(2, e - 10);
  return Math.round(x / ulp) * ulp;
}

/** The seed pass on the CPU: (x, y, disc radius, is-a-seed) per texel, in texels, ABSOLUTE positions (JF_SEED stores them relative to the texel). */
export function jfSeedGrid(alpha, gw, gh, minCover) {
  const mc = minCover ?? JF_MIN_COVER, n = gw * gh;
  const A = (x, y) => alpha[Math.min(gh - 1, Math.max(0, y)) * gw + Math.min(gw - 1, Math.max(0, x))];
  const seeds = new Float32Array(n * 4);
  for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
    const a = A(x, y), l = A(x - 1, y), r = A(x + 1, y), d = A(x, y - 1), u = A(x, y + 1);
    const inside = a >= 0.5, px = x + 0.5, py = y + 0.5, i = (y * gw + x) * 4;
    const edge = inside !== (l >= 0.5) || inside !== (r >= 0.5) || inside !== (d >= 0.5) || inside !== (u >= 0.5);
    if (edge) {
      const gx = Math.abs(r - a) > Math.abs(a - l) ? r - a : a - l, gy = Math.abs(u - a) > Math.abs(a - d) ? u - a : a - d, g = Math.hypot(gx, gy);
      const t = g > 1e-4 ? Math.max(-1, Math.min(1, (0.5 - a) / g)) : 0;
      seeds[i] = px + (g > 1e-4 ? gx / g * t : 0); seeds[i + 1] = py + (g > 1e-4 ? gy / g * t : 0); seeds[i + 3] = 1;
    } else if (!inside && a > mc && a >= Math.max(l, r, d, u)) {
      seeds[i] = px; seeds[i + 1] = py; seeds[i + 2] = Math.sqrt(a / Math.PI); seeds[i + 3] = 1;
    }
  }
  return seeds;
}

/**
 * A GPU field builder on `gl`, or null when it can't run there (WebGL1, no
 * float render targets, shaders that don't compile). `run` returns the
 * field texture (R16F, linear, row 0 at the bottom) and its size, or null.
 * It leaves the context's bindings as it found them, except that a
 * three.js host must still call renderer.resetState().
 */
export function jfCreate(gl, opts) {
  const maxRes = (opts && opts.maxRes) || JF_MAX_RES;
  if (!gl || typeof WebGL2RenderingContext === 'undefined' || !(gl instanceof WebGL2RenderingContext)) return null;
  // Half-float render targets: core-renderable only with one of these (checked again by framebuffer status).
  if (!gl.getExtension('EXT_color_buffer_float') && !gl.getExtension('EXT_color_buffer_half_float')) return null;
  const compile = (type, src) => {
    const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { gl.deleteShader(s); return null; }
    return s;
  };
  const vs = compile(gl.VERTEX_SHADER, JF_VERT);
  const link = src => {
    const fs = compile(gl.FRAGMENT_SHADER, src);
    if (!vs || !fs) return null;
    const p = gl.createProgram(); gl.attachShader(p, vs); gl.attachShader(p, fs); gl.linkProgram(p); gl.deleteShader(fs);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) { gl.deleteProgram(p); return null; }
    const u = {}, count = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < count; i++) { const info = gl.getActiveUniform(p, i); u[info.name] = gl.getUniformLocation(p, info.name); }
    return { p, u };
  };
  const seedP = link(JF_SEED), floodP = link(JF_FLOOD), resolveP = link(JF_RESOLVE);
  if (vs) gl.deleteShader(vs);
  if (!seedP || !floodP || !resolveP) { for (const x of [seedP, floodP, resolveP]) if (x) gl.deleteProgram(x.p); return null; }
  const vao = gl.createVertexArray();
  const fbo = gl.createFramebuffer();
  let src = null, ping = null, pong = null, out = null, gw = 0, gh = 0, broken = false;

  const tex = (internal, format, type, filter, w, h) => {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (w) gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, type, null);
    return t;
  };
  const complete = t => {
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
    return gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
  };
  const freeGrid = () => { for (const t of [ping, pong, out]) if (t) gl.deleteTexture(t); ping = pong = out = null; gw = gh = 0; };

  function run(source) {
    if (broken) return null;
    const sw = source.width, sh = source.height;
    if (!(sw > 0 && sh > 0)) return null;
    const aspect = source.aspect || sw / sh;
    const size = jfGridSize(sw, sh, maxRes);
    // Save what the host may rely on.
    const saved = {
      fb: gl.getParameter(gl.FRAMEBUFFER_BINDING), vp: gl.getParameter(gl.VIEWPORT), prog: gl.getParameter(gl.CURRENT_PROGRAM),
      vao: gl.getParameter(gl.VERTEX_ARRAY_BINDING), active: gl.getParameter(gl.ACTIVE_TEXTURE),
      blend: gl.isEnabled(gl.BLEND), depth: gl.isEnabled(gl.DEPTH_TEST), scissor: gl.isEnabled(gl.SCISSOR_TEST), cull: gl.isEnabled(gl.CULL_FACE),
    };
    gl.activeTexture(gl.TEXTURE0); const t0 = gl.getParameter(gl.TEXTURE_BINDING_2D);
    gl.activeTexture(gl.TEXTURE1); const t1 = gl.getParameter(gl.TEXTURE_BINDING_2D);
    let result = null;
    try {
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      if (size.gw !== gw || size.gh !== gh) {
        freeGrid();
        gl.activeTexture(gl.TEXTURE0);
        ping = tex(gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, gl.NEAREST, size.gw, size.gh);
        pong = tex(gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, gl.NEAREST, size.gw, size.gh);
        out = tex(gl.R16F, gl.RED, gl.HALF_FLOAT, gl.LINEAR, size.gw, size.gh);
        if (!complete(ping) || !complete(out)) { broken = true; freeGrid(); return null; }
        gw = size.gw; gh = size.gh;
      }
      // The source: the host's texture, or a canvas uploaded here (row 0 at the bottom).
      let srcTex = source.texture;
      if (!srcTex) {
        gl.activeTexture(gl.TEXTURE0);
        if (!src) src = tex(gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, gl.LINEAR, 0, 0);
        gl.bindTexture(gl.TEXTURE_2D, src);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
        // A tainted canvas (a cross-origin picture) can't be uploaded: no field this frame, try again the next.
        let ok = true;
        try { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, source.canvas); } catch (e) { ok = false; }
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        if (!ok) return null;
        srcTex = src;
      }
      gl.disable(gl.BLEND); gl.disable(gl.DEPTH_TEST); gl.disable(gl.SCISSOR_TEST); gl.disable(gl.CULL_FACE);
      gl.viewport(0, 0, gw, gh);
      gl.bindVertexArray(vao);
      const texel = [2 * aspect / gw, 2 / gh];
      // 1. Seed.
      gl.useProgram(seedP.p);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, srcTex);
      gl.uniform1i(seedP.u.u_src, 0); gl.uniform2f(seedP.u.u_size, gw, gh); gl.uniform1f(seedP.u.u_minCover, JF_MIN_COVER);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, ping, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      // 2. Flood, ping-ponging.
      gl.useProgram(floodP.p);
      gl.uniform1i(floodP.u.u_seeds, 0); gl.uniform2f(floodP.u.u_size, gw, gh); gl.uniform2f(floodP.u.u_texel, texel[0], texel[1]);
      let a = ping, b = pong;
      for (const k of jfSteps(gw, gh)) {
        gl.bindTexture(gl.TEXTURE_2D, a);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, b, 0);
        gl.uniform1f(floodP.u.u_step, k);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        const t = a; a = b; b = t;
      }
      // 3. Resolve into the half-float field.
      gl.useProgram(resolveP.p);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, a);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, srcTex);
      gl.uniform1i(resolveP.u.u_seeds, 0); gl.uniform1i(resolveP.u.u_src, 1);
      gl.uniform2f(resolveP.u.u_size, gw, gh); gl.uniform2f(resolveP.u.u_texel, texel[0], texel[1]); gl.uniform1f(resolveP.u.u_far, JF_FAR);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, out, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, null, 0);
      result = { texture: out, width: gw, height: gh };
    } catch (e) {
      broken = true;
    } finally {
      gl.bindFramebuffer(gl.FRAMEBUFFER, saved.fb);
      gl.viewport(saved.vp[0], saved.vp[1], saved.vp[2], saved.vp[3]);
      gl.useProgram(saved.prog); gl.bindVertexArray(saved.vao);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, t1);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, t0);
      gl.activeTexture(saved.active);
      for (const [cap, on] of [[gl.BLEND, saved.blend], [gl.DEPTH_TEST, saved.depth], [gl.SCISSOR_TEST, saved.scissor], [gl.CULL_FACE, saved.cull]]) if (on) gl.enable(cap); else gl.disable(cap);
    }
    return result;
  }

  function dispose() {
    freeGrid();
    if (src) gl.deleteTexture(src);
    src = null;
    for (const x of [seedP, floodP, resolveP]) gl.deleteProgram(x.p);
    gl.deleteVertexArray(vao); gl.deleteFramebuffer(fbo);
    broken = true;
  }

  return { run, dispose, maxRes };
}
