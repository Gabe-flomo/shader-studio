/**
 * snippetRenderer.ts — draws code-block previews without a WebGL context
 * each. One offscreen WebGL canvas compiles the harnesses (cached by source)
 * and draws each preview in turn, copied onto the preview's own 2D canvas.
 * A page with twenty code blocks costs one context, not twenty, and never
 * crowds out the Plays' canvases.
 *
 * Previews register a draw callback; one animation loop runs the ones that
 * are on screen and move (read the time, or were just changed), and none
 * while the tab is hidden. A lost context is made again on the next draw.
 */

const VERT = 'attribute vec2 a; varying vec2 vUv; void main(){ vUv = a * 0.5 + 0.5; gl_Position = vec4(a, 0.0, 1.0); }';
const VERT3 = '#version 300 es\nin vec2 a; out vec2 vUv; void main(){ vUv = a * 0.5 + 0.5; gl_Position = vec4(a, 0.0, 1.0); }';
/**
 * WebGL 2 runs the harness as GLSL ES 3.00 the way the app's canvas runs its
 * shaders (three.js does the same): texture2D, gl_FragColor and varying map to
 * their new names, so tanh(), round(), inverse() and friends work here too.
 */
const ES3_PREFIX = ['#version 300 es', '#define varying in', '#define texture2D texture', '#define textureCube texture', 'out highp vec4 pc_fragColor;', '#define gl_FragColor pc_fragColor'];
function toEs3(source: string): string {
  // #extension lines go (derivatives are built in), leaving their line so the numbers stay put.
  return `${ES3_PREFIX.join('\n')}\n${source.replace(/^[ \t]*#extension[^\n]*/gm, '')}`;
}
/** A GLSL ES 3.00 log in the harness's own line numbers. */
const fromEs3Log = (log: string) => log.replace(/(\d+):(\d+):/g, (_m, file, line) => `${file}:${Math.max(1, Number(line) - ES3_PREFIX.length)}:`);
let gl2 = false;

interface Program { prog: WebGLProgram | null; error: string | null; locs: Map<string, WebGLUniformLocation | null>; attrib: number }

let canvas: HTMLCanvasElement | null = null;
let gl: WebGLRenderingContext | null = null;
let buffer: WebGLBuffer | null = null;
let vert: WebGLShader | null = null;
const programs = new Map<string, Program>();
const MAX_PROGRAMS = 48;

function context(): WebGLRenderingContext | null {
  if (gl && !gl.isContextLost()) return gl;
  programs.clear();
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.width = 2; canvas.height = 2;
    canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); gl = null; programs.clear(); });
  }
  const opts = { antialias: true, premultipliedAlpha: false, preserveDrawingBuffer: false };
  gl = canvas.getContext('webgl2', opts) as WebGLRenderingContext | null;
  gl2 = !!gl;
  gl ??= canvas.getContext('webgl', opts) as WebGLRenderingContext | null;
  if (!gl) return null;
  if (!gl2) gl.getExtension('OES_standard_derivatives');
  buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  vert = gl.createShader(gl.VERTEX_SHADER)!;
  gl.shaderSource(vert, gl2 ? VERT3 : VERT);
  gl.compileShader(vert);
  return gl;
}

function program(g: WebGLRenderingContext, source: string): Program {
  const hit = programs.get(source);
  if (hit) { programs.delete(source); programs.set(source, hit); return hit; }
  const fs = g.createShader(g.FRAGMENT_SHADER)!;
  g.shaderSource(fs, gl2 ? toEs3(source) : source);
  g.compileShader(fs);
  let out: Program;
  if (!g.getShaderParameter(fs, g.COMPILE_STATUS)) {
    const log = g.getShaderInfoLog(fs) || 'The shader didn’t compile.';
    out = { prog: null, error: gl2 ? fromEs3Log(log) : log, locs: new Map(), attrib: -1 };
    g.deleteShader(fs);
  } else {
    const prog = g.createProgram()!;
    g.attachShader(prog, vert!);
    g.attachShader(prog, fs);
    g.linkProgram(prog);
    g.deleteShader(fs);
    out = g.getProgramParameter(prog, g.LINK_STATUS)
      ? { prog, error: null, locs: new Map(), attrib: g.getAttribLocation(prog, 'a') }
      : { prog: null, error: g.getProgramInfoLog(prog) || 'The shader didn’t link.', locs: new Map(), attrib: -1 };
    if (!out.prog) g.deleteProgram(prog);
  }
  programs.set(source, out);
  if (programs.size > MAX_PROGRAMS) {
    const [oldest, p] = programs.entries().next().value as [string, Program];
    if (p.prog) g.deleteProgram(p.prog);
    programs.delete(oldest);
  }
  return out;
}

/** The compile log for a harness (empty when it compiles), without drawing. */
export function compileLog(source: string): string {
  const g = context();
  if (!g) return 'WebGL isn’t available here.';
  return program(g, source).error ?? '';
}

export interface DrawJob {
  source: string;
  width: number;
  height: number;
  uniforms: Record<string, number | number[]>;
  time: number;
  /** In pixels from the bottom left. */
  mouse?: [number, number];
  dpr?: number;
}

function setUniform(g: WebGLRenderingContext, p: Program, name: string, v: number | number[]) {
  let loc = p.locs.get(name);
  if (loc === undefined) { loc = g.getUniformLocation(p.prog!, name); p.locs.set(name, loc); }
  if (!loc) return;
  if (typeof v === 'number') g.uniform1f(loc, v);
  else if (v.length === 2) g.uniform2f(loc, v[0], v[1]);
  else if (v.length === 3) g.uniform3f(loc, v[0], v[1], v[2]);
  else if (v.length >= 4) g.uniform4f(loc, v[0], v[1], v[2], v[3]);
}

/** Draws a harness onto the shared canvas; returns the error when it doesn't compile. */
function drawShared(job: DrawJob): { g: WebGLRenderingContext; error: string | null } | null {
  const g = context();
  if (!g || !canvas) return null;
  const p = program(g, job.source);
  if (!p.prog) return { g, error: p.error };
  const w = Math.max(1, Math.round(job.width)), h = Math.max(1, Math.round(job.height));
  if (canvas.width < w || canvas.height < h) { canvas.width = Math.max(canvas.width, w); canvas.height = Math.max(canvas.height, h); }
  g.viewport(0, 0, w, h);
  g.useProgram(p.prog);
  g.bindBuffer(g.ARRAY_BUFFER, buffer);
  g.enableVertexAttribArray(p.attrib);
  g.vertexAttribPointer(p.attrib, 2, g.FLOAT, false, 0, 0);
  setUniform(g, p, 'u_resolution', [w, h]);
  setUniform(g, p, 'u_time', job.time);
  setUniform(g, p, 'u_mouse', job.mouse ?? [w / 2, h / 2]);
  setUniform(g, p, 'u_pf_dpr', job.dpr ?? 1);
  for (const [k, v] of Object.entries(job.uniforms)) setUniform(g, p, k, v);
  g.clearColor(0, 0, 0, 1);
  g.clear(g.COLOR_BUFFER_BIT);
  g.drawArrays(g.TRIANGLES, 0, 3);
  return { g, error: null };
}

/** Draw into a preview's 2D canvas (sized to the job). Returns the compile error, or null. */
export function drawInto(target: HTMLCanvasElement, job: DrawJob): string | null {
  const r = drawShared(job);
  if (!r) return 'WebGL isn’t available here.';
  if (r.error) return r.error;
  const w = Math.max(1, Math.round(job.width)), h = Math.max(1, Math.round(job.height));
  if (target.width !== w || target.height !== h) { target.width = w; target.height = h; }
  const ctx = target.getContext('2d');
  // The drawing sits at the shared canvas's bottom left.
  ctx?.drawImage(canvas!, 0, canvas!.height - h, w, h, 0, 0, w, h);
  return null;
}

/** A still, as a PNG data URL (for exported pages), or null when it doesn't compile. */
export function renderStill(job: DrawJob): string | null {
  const c = document.createElement('canvas');
  return drawInto(c, job) ? null : c.toDataURL('image/png');
}

// ── The loop ────────────────────────────────────────────────────────────────

type Tick = (now: number) => void;
const ticks = new Set<Tick>();
let raf = 0;
function loop(now: number) {
  raf = 0;
  if (!document.hidden) for (const t of ticks) t(now);
  if (ticks.size) raf = requestAnimationFrame(loop);
}

/** Run `tick` every frame (while the tab shows) until the returned function is called. */
export function onFrame(tick: Tick): () => void {
  ticks.add(tick);
  if (!raf) raf = requestAnimationFrame(loop);
  return () => { ticks.delete(tick); if (!ticks.size && raf) { cancelAnimationFrame(raf); raf = 0; } };
}
