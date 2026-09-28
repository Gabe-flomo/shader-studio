/**
 * sideRender.ts — a small WebGL canvas of its own for one fragment shader
 * (not the app's preview), dither off: RenderPair draws two of them side by
 * side and compares their pixels; SplitOverlay draws one over the main
 * canvas under the A|B wipe.
 *
 * The context is WebGL2 with the prefix three.js puts on a ShaderMaterial
 * (`#version 300 es`, gl_FragColor and texture2D mapped to their ES 3.00
 * forms), so a shader is judged the way the app's preview renders it: fwidth,
 * loops with a variable bound and the like compile here as they do there.
 * WebGL1 only where WebGL2 isn't available.
 *
 * A canvas keeps one context for its whole life and only swaps programs when
 * a shader changes: a canvas has a single context, so losing it on every
 * change (as this once did) left the picture black from the second shader on.
 */
const VS = 'attribute vec2 p; varying vec2 vUv; void main(){ vUv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }';
const VS2 = '#version 300 es\nin vec2 p; out vec2 vUv; void main(){ vUv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }';
/** What three.js puts before a ShaderMaterial's fragment shader (WebGLProgram, not a RawShaderMaterial). */
const ES3_PREFIX = ['#version 300 es', 'precision highp float;', 'precision highp int;', '#define varying in', 'layout(location = 0) out highp vec4 pc_fragColor;', '#define gl_FragColor pc_fragColor', '#define texture2D texture', '#define textureCube texture', '#define texture2DLodEXT textureLod', '#define textureCubeLodEXT textureLod', ''].join('\n');
/** The prefix's lines come before line 1 of the shader: error lines are given back in the shader's own numbering. */
const PREFIX_LINES = ES3_PREFIX.split('\n').length - 1;

export interface Side { gl: WebGLRenderingContext | WebGL2RenderingContext; es3: boolean; buf: WebGLBuffer | null; prog: WebGLProgram | null; error: string | null; locs: Map<string, WebGLUniformLocation | null>; ints: Set<string> }

export function context(canvas: HTMLCanvasElement): Side | null {
  const opts: WebGLContextAttributes = { preserveDrawingBuffer: true, antialias: false, premultipliedAlpha: false };
  const gl2 = canvas.getContext('webgl2', opts);
  const gl = gl2 ?? canvas.getContext('webgl', opts);
  if (!gl) return null;
  const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.disable(gl.DITHER);
  return { gl, es3: !!gl2, buf, prog: null, error: null, locs: new Map(), ints: new Set() };
}

/** Compile `frag` into the side's program, replacing the previous one; null clears it. */
export function program(side: Side, frag: string | null): void {
  const { gl } = side;
  if (side.prog) { gl.deleteProgram(side.prog); side.prog = null; }
  side.locs.clear(); side.ints.clear(); side.error = null;
  gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); // no leftover picture from the previous shader
  if (!frag) return;
  const compile = (type: number, src: string) => { const s = gl.createShader(type)!; gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { const log = gl.getShaderInfoLog(s) ?? 'shader error'; gl.deleteShader(s); throw new Error(log); } return s; };
  try {
    const prog = gl.createProgram()!;
    const vs = compile(gl.VERTEX_SHADER, side.es3 ? VS2 : VS), fs = compile(gl.FRAGMENT_SHADER, side.es3 ? ES3_PREFIX + frag : frag);
    gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
    gl.deleteShader(vs); gl.deleteShader(fs);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { const log = gl.getProgramInfoLog(prog) ?? 'link error'; gl.deleteProgram(prog); throw new Error(log); }
    gl.useProgram(prog);
    const loc = gl.getAttribLocation(prog, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    side.prog = prog;
    // int and bool uniforms (a pasted shader's own, now Play controls) are set with uniform1i.
    for (let i = 0, k = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS) as number; i < k; i++) { const a = gl.getActiveUniform(prog, i); if (a && (a.type === gl.INT || a.type === gl.BOOL)) side.ints.add(a.name); }
  } catch (e) {
    const msg = String((e as Error).message).split('\u0000').join('').trim();
    // `ERROR: 0:12:` counts the prefix's lines too.
    side.error = side.es3 ? msg.replace(/\b0:(\d+):/g, (_m, l: string) => `0:${Math.max(1, Number(l) - PREFIX_LINES)}:`) : msg;
  }
}

export function draw(side: Side, width: number, height: number, time: number, uniforms: Record<string, number | number[]>, mouse: [number, number] = [0.3 * width, 0.6 * height]): void {
  const { gl, prog } = side; if (!prog) return;
  const u = (n: string) => { if (!side.locs.has(n)) side.locs.set(n, gl.getUniformLocation(prog, n)); return side.locs.get(n)!; };
  gl.useProgram(prog);
  if (u('u_resolution')) gl.uniform2f(u('u_resolution')!, width, height);
  if (u('u_time')) gl.uniform1f(u('u_time')!, time);
  if (u('u_mouse')) gl.uniform2f(u('u_mouse')!, mouse[0], mouse[1]);
  for (const [n, v] of Object.entries(uniforms)) {
    const l = u(n); if (!l) continue;
    if (typeof v === 'number') { if (side.ints.has(n)) gl.uniform1i(l, Math.round(v)); else gl.uniform1f(l, v); } else if (v.length === 2) gl.uniform2f(l, v[0], v[1]); else if (v.length === 3) gl.uniform3f(l, v[0], v[1], v[2]); else gl.uniform4f(l, v[0], v[1], v[2], v[3]);
  }
  gl.viewport(0, 0, width, height);
  // Cleared each frame: a pixel the shader discards is transparent black, as the graph's discard → alpha 0 gives it.
  gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}
