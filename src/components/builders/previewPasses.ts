/**
 * previewPasses.ts — Pass programs in a builder's own preview (useBuilderPreview). A builder's
 * graph is normally one program; one that has Pass nodes (the Grid builder's rule memory, docs/
 * grid-builder.md "Rules that stay changed") also compiles a program per Pass, drawn into its own
 * texture before the picture, with its Previous kept (ping-pong), as the app's pass runner does
 * (lib/passRunner.ts) but small: a fixed size or a scale of the canvas, Nearest or Linear, half
 * float when the GPU can draw into it (else 8-bit). A pass program's pictures (Texture nodes) are
 * not bound here: only the passes' own samplers.
 */
import { makeProgram } from '../sceneBuilder/previewGl';

/** One Pass of a compiled preview: its program and texture settings (compiler PassProgram). */
export interface PreviewPass {
  slug: string;
  fs: string;
  /** A fixed square size in pixels; else `scale` × the canvas. */
  size?: number;
  scale: number;
  filter: 'linear' | 'nearest';
  format: 'half' | 'byte';
}

type Uniforms = Record<string, number | number[]>;

interface Live {
  spec: PreviewPass;
  prog: WebGLProgram;
  vao: WebGLVertexArrayObject | null;
  locs: Map<string, WebGLUniformLocation | null>;
  /** Two targets (this frame's and the last), and which one was drawn last. */
  tex: [WebGLTexture, WebGLTexture];
  fb: [WebGLFramebuffer, WebGLFramebuffer];
  cur: number;
  w: number;
  h: number;
}

/** The first texture unit the passes use (pictures take the ones below). */
const UNIT0 = 8;

const passU = (slug: string) => `u_pass_${slug}`;
const prevU = (slug: string) => `u_passprev_${slug}`;

export interface PreviewPasses {
  /** Draw every pass for a w × h canvas at time t (uniforms set when `values` is given). */
  draw: (values: Uniforms | null, t: number, w: number, h: number) => void;
  /** Bind the passes' textures for the final program. */
  bindFinal: (prog: WebGLProgram) => void;
  /** Start every pass's memory over (a true reset, lib/runtimeReset.ts): both targets are made again, cleared, at the next draw. */
  reset: () => void;
  dispose: () => void;
}

/** The passes of a preview, or a GL error. `buf` is the quad (x, y, z, u, v). */
export function makePreviewPasses(gl: WebGL2RenderingContext, vs: string, specs: PreviewPass[], buf: WebGLBuffer | null): PreviewPasses | string {
  const half = !!gl.getExtension('EXT_color_buffer_float');
  const live: Live[] = [];
  const dispose = () => {
    for (const p of live) {
      gl.deleteProgram(p.prog);
      if (p.vao) gl.deleteVertexArray(p.vao);
      p.tex.forEach(t => gl.deleteTexture(t));
      p.fb.forEach(f => gl.deleteFramebuffer(f));
    }
    live.length = 0;
  };
  for (const spec of specs) {
    const prog = makeProgram(gl, vs, spec.fs);
    if (typeof prog === 'string') { dispose(); return `Pass: ${prog}`; }
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    const posLoc = gl.getAttribLocation(prog, 'position');
    const uvLoc = gl.getAttribLocation(prog, 'uv');
    if (posLoc >= 0) { gl.enableVertexAttribArray(posLoc); gl.vertexAttribPointer(posLoc, 3, gl.FLOAT, false, 20, 0); }
    if (uvLoc >= 0) { gl.enableVertexAttribArray(uvLoc); gl.vertexAttribPointer(uvLoc, 2, gl.FLOAT, false, 20, 12); }
    const mk = () => gl.createTexture()!;
    const fb = () => gl.createFramebuffer()!;
    live.push({ spec, prog, vao, locs: new Map(), tex: [mk(), mk()], fb: [fb(), fb()], cur: 0, w: 0, h: 0 });
  }
  gl.bindVertexArray(null);

  /** (Re)make a pass's two targets at w × h, cleared (a new size starts its memory over). */
  const size = (p: Live, w: number, h: number) => {
    if (p.w === w && p.h === h) return;
    p.w = w; p.h = h;
    const f = p.spec.filter === 'nearest' ? gl.NEAREST : gl.LINEAR;
    for (let i = 0; i < 2; i++) {
      gl.bindTexture(gl.TEXTURE_2D, p.tex[i]);
      if (half && p.spec.format === 'half') gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
      else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, f);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.bindFramebuffer(gl.FRAMEBUFFER, p.fb[i]);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, p.tex[i], 0);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  };

  const locOf = (p: { locs: Map<string, WebGLUniformLocation | null> }, prog: WebGLProgram, name: string) => {
    if (!p.locs.has(name)) p.locs.set(name, gl.getUniformLocation(prog, name));
    return p.locs.get(name) ?? null;
  };
  /** Bind every pass's samplers for `prog`: this frame's texture and the last (`self` reads only its Previous). */
  const finalLocs = new WeakMap<WebGLProgram, { locs: Map<string, WebGLUniformLocation | null> }>();
  const bindAll = (prog: WebGLProgram, cache: { locs: Map<string, WebGLUniformLocation | null> }, self: Live | null) => {
    live.forEach((q, i) => {
      // The pass drawing now reads only what it drew last (never the target it is drawing into).
      const now = q.tex[q.cur];
      const before = q === self ? q.tex[q.cur] : q.tex[q.cur ^ 1];
      const set = (name: string, tex: WebGLTexture, unit: number) => {
        const l = locOf(cache, prog, name);
        if (!l) return;
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.uniform1i(l, unit);
        const px = locOf(cache, prog, `${name}_px`);
        if (px) gl.uniform2f(px, 1 / Math.max(1, q.w), 1 / Math.max(1, q.h));
      };
      set(passU(q.spec.slug), now, UNIT0 + 2 * i);
      set(prevU(q.spec.slug), before, UNIT0 + 2 * i + 1);
    });
  };

  return {
    draw: (values, t, w, h) => {
      for (const p of live) {
        const tw = p.spec.size ?? Math.max(1, Math.round(w * p.spec.scale));
        const th = p.spec.size ?? Math.max(1, Math.round(h * p.spec.scale));
        size(p, tw, th);
        gl.useProgram(p.prog);
        gl.bindVertexArray(p.vao);
        if (values) {
          for (const [name, v] of Object.entries(values)) {
            const l = locOf(p, p.prog, name);
            if (!l) continue;
            if (typeof v === 'number') gl.uniform1f(l, v);
            else if (v.length === 2) gl.uniform2f(l, v[0], v[1]);
            else if (v.length === 3) gl.uniform3f(l, v[0], v[1], v[2]);
            else if (v.length === 4) gl.uniform4f(l, v[0], v[1], v[2], v[3]);
          }
        }
        const res = locOf(p, p.prog, 'u_resolution');
        if (res) gl.uniform2f(res, p.w, p.h);
        const time = locOf(p, p.prog, 'u_time');
        if (time) gl.uniform1f(time, t);
        // Its own Previous is the target drawn last; it draws into the other one.
        bindAll(p.prog, p, p);
        gl.bindFramebuffer(gl.FRAMEBUFFER, p.fb[p.cur ^ 1]);
        gl.viewport(0, 0, p.w, p.h);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        p.cur ^= 1;
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    },
    bindFinal: prog => {
      let cache = finalLocs.get(prog);
      if (!cache) { cache = { locs: new Map() }; finalLocs.set(prog, cache); }
      bindAll(prog, cache, null);
    },
    reset: () => { for (const p of live) { p.w = 0; p.h = 0; p.cur = 0; } },
    dispose,
  };
}

/** A compile's Pass programs as a preview draws them (the live ones, in order): a builder's effects stack makes these. */
export function previewPassesOf(passes: ReadonlyArray<{ slug: string; fragmentShader: string; scale: number; filter: 'linear' | 'nearest'; format: 'half' | 'byte'; live: boolean; size?: number }> | undefined): PreviewPass[] | undefined {
  const out = (passes ?? []).filter(p => p.live).map(p => ({ slug: p.slug, fs: p.fragmentShader, scale: p.scale, filter: p.filter, format: p.format, ...(p.size ? { size: p.size } : {}) }));
  return out.length ? out : undefined;
}
