/**
 * RenderPair — the original shader and the converted graph's shader, side by
 * side on one clock, with how far apart their pixels are. Two small WebGL
 * canvases of their own (not the app's preview), dither off, same uniforms,
 * so a difference is the conversion's, not the renderer's. Every half second
 * both are read back and compared; `onDiff` gets the max error (0..255) or
 * the compile error of either side.
 *
 * The contexts are WebGL2 with the prefix three.js puts on a ShaderMaterial
 * (`#version 300 es`, gl_FragColor and texture2D mapped to their ES 3.00
 * forms), so a shader is judged the way the app's preview renders it: fwidth,
 * loops with a variable bound and the like compile here as they do there.
 * WebGL1 only where WebGL2 isn't available.
 *
 * Each canvas keeps one context for its whole life and only swaps programs
 * when a shader changes: a canvas has a single context, so losing it on
 * every change (as this once did) left both pictures black from the second
 * shader on.
 */
import { useEffect, useRef, useState } from 'react';
import { onRebuild } from '../../lib/rebuild';
import { useTokens } from '../../theme/themeStore';
import { fontFamily, radius } from '../../theme/tokens';

export type PairDiff = { max: number; mean: number; badPct: number } | { error: string; side: 'original' | 'graph' };

const VS = 'attribute vec2 p; varying vec2 vUv; void main(){ vUv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }';
const VS2 = '#version 300 es\nin vec2 p; out vec2 vUv; void main(){ vUv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }';
/** What three.js puts before a ShaderMaterial's fragment shader (WebGLProgram, not a RawShaderMaterial). */
const ES3_PREFIX = ['#version 300 es', 'precision highp float;', 'precision highp int;', '#define varying in', 'layout(location = 0) out highp vec4 pc_fragColor;', '#define gl_FragColor pc_fragColor', '#define texture2D texture', '#define textureCube texture', '#define texture2DLodEXT textureLod', '#define textureCubeLodEXT textureLod', ''].join('\n');
/** The prefix's lines come before line 1 of the shader: error lines are given back in the shader's own numbering. */
const PREFIX_LINES = ES3_PREFIX.split('\n').length - 1;

interface Side { gl: WebGLRenderingContext | WebGL2RenderingContext; es3: boolean; buf: WebGLBuffer | null; prog: WebGLProgram | null; error: string | null; locs: Map<string, WebGLUniformLocation | null>; ints: Set<string> }

function context(canvas: HTMLCanvasElement): Side | null {
  const opts: WebGLContextAttributes = { preserveDrawingBuffer: true, antialias: false, premultipliedAlpha: false };
  const gl2 = canvas.getContext('webgl2', opts);
  const gl = gl2 ?? canvas.getContext('webgl', opts);
  if (!gl) return null;
  const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.disable(gl.DITHER);
  return { gl, es3: !!gl2, buf, prog: null, error: null, locs: new Map(), ints: new Set() };
}

/** Compile `frag` into the side's program, replacing the previous one; null clears it. */
function program(side: Side, frag: string | null): void {
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

function draw(side: Side, size: number, time: number, uniforms: Record<string, number | number[]>): void {
  const { gl, prog } = side; if (!prog) return;
  const u = (n: string) => { if (!side.locs.has(n)) side.locs.set(n, gl.getUniformLocation(prog, n)); return side.locs.get(n)!; };
  gl.useProgram(prog);
  if (u('u_resolution')) gl.uniform2f(u('u_resolution')!, size, size);
  if (u('u_time')) gl.uniform1f(u('u_time')!, time);
  if (u('u_mouse')) gl.uniform2f(u('u_mouse')!, 0.3, 0.6);
  for (const [n, v] of Object.entries(uniforms)) {
    const l = u(n); if (!l) continue;
    if (typeof v === 'number') { if (side.ints.has(n)) gl.uniform1i(l, Math.round(v)); else gl.uniform1f(l, v); } else if (v.length === 2) gl.uniform2f(l, v[0], v[1]); else if (v.length === 3) gl.uniform3f(l, v[0], v[1], v[2]); else gl.uniform4f(l, v[0], v[1], v[2], v[3]);
  }
  gl.viewport(0, 0, size, size);
  // Cleared each frame: a pixel the shader discards is transparent black, as the graph's discard → alpha 0 gives it.
  gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}

export function RenderPair({ original, graph, uniforms, originalUniforms, onDiff, size = 168, labels = ['Original', 'As nodes'] }: {
  original: string; graph: string | null; uniforms: Record<string, number | number[]>;
  /** Uniform values for the original side too (when it is a compiled graph rather than a pasted shader). */
  originalUniforms?: Record<string, number | number[]>;
  onDiff: (d: PairDiff | null) => void; size?: number; labels?: [string, string];
}) {
  const tk = useTokens();
  const a = useRef<HTMLCanvasElement>(null), b = useRef<HTMLCanvasElement>(null);
  const sides = useRef<{ A: Side | null; B: Side | null }>({ A: null, B: null });

  // Bumped when both sides are built again from scratch (Rebuild, or a lost context coming back):
  // the programs below follow it.
  const [generation, setGeneration] = useState(0);

  // One context per canvas for the component's life.
  useEffect(() => {
    const s = sides.current;
    if (a.current && !s.A) s.A = context(a.current);
    if (b.current && !s.B) s.B = context(b.current);
    // Everything made on a context (buffer, program) is made again; the context itself is kept.
    const renew = () => {
      for (const [key, canvas] of [['A', a.current], ['B', b.current]] as const) {
        const old = s[key];
        if (old && !old.gl.isContextLost()) { program(old, null); old.gl.deleteBuffer(old.buf); }
        s[key] = canvas && !(old?.gl.isContextLost()) ? context(canvas) : old;
      }
      setGeneration(g => g + 1);
    };
    const unregister = onRebuild(() => { renew(); return ['the side-by-side previews']; });
    // A lost context comes back only when the loss is prevented; then everything is made again.
    const lost = (e: Event) => {
      e.preventDefault();
      // Its buffer and program went with the context: nothing to delete on restore.
      for (const side of [s.A, s.B]) if (side && side.gl.canvas === e.target) { side.prog = null; side.buf = null; }
    };
    const canvases = [a.current, b.current].filter((c): c is HTMLCanvasElement => !!c);
    for (const c of canvases) { c.addEventListener('webglcontextlost', lost); c.addEventListener('webglcontextrestored', renew); }
    return () => {
      unregister();
      for (const c of canvases) { c.removeEventListener('webglcontextlost', lost); c.removeEventListener('webglcontextrestored', renew); }
      for (const side of [s.A, s.B]) { if (side) { program(side, null); side.gl.getExtension('WEBGL_lose_context')?.loseContext(); } }
      s.A = null; s.B = null;
    };
  }, []);

  // Programs follow the shaders; the frame loop restarts with them. Each side draws whenever it compiled, so the
  // original still renders when there is no graph (a refused shader) or the graph doesn't compile; the pixels are
  // compared only when both render. A side that can't render says so over its canvas instead of staying black.
  // (Written straight to the notes over the canvases: they follow the compile, which happens here.)
  const noteA = useRef<HTMLDivElement>(null), noteB = useRef<HTMLDivElement>(null);
  const say = (el: HTMLDivElement | null, text: string | null) => { if (el) { el.textContent = text ?? ''; el.style.display = text ? 'flex' : 'none'; } };
  useEffect(() => {
    const { A, B } = sides.current;
    if (!A || !B) { onDiff({ error: 'WebGL isn’t available here', side: 'original' }); say(noteA.current, 'No WebGL here'); say(noteB.current, 'No WebGL here'); return; }
    program(A, original); program(B, graph);
    say(noteA.current, A.error ? 'Doesn’t compile here' : null);
    say(noteB.current, B.error ? 'Doesn’t compile' : graph ? null : 'No graph');
    if (b.current) b.current.style.opacity = graph && !B.error ? '1' : '0.3';
    if (A.error) onDiff({ error: A.error, side: 'original' });
    else if (B.error) onDiff({ error: B.error, side: 'graph' });
    else if (!graph) onDiff(null);
    const compare = !A.error && !B.error && !!graph;
    if (!A.prog && !B.prog) return;
    const t0 = performance.now();
    let raf = 0, lastCmp = 0;
    const pa = new Uint8Array(size * size * 4), pb = new Uint8Array(size * size * 4);
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const t = (now - t0) / 1000;
      draw(A, size, t, originalUniforms ?? {}); draw(B, size, t, uniforms);
      if (compare && now - lastCmp > 500) {
        lastCmp = now;
        A.gl.readPixels(0, 0, size, size, A.gl.RGBA, A.gl.UNSIGNED_BYTE, pa);
        B.gl.readPixels(0, 0, size, size, B.gl.RGBA, B.gl.UNSIGNED_BYTE, pb);
        let max = 0, sum = 0, bad = 0, n = 0;
        for (let i = 0; i < pa.length; i++) { if ((i & 3) === 3) continue; const d = Math.abs(pa[i] - pb[i]); if (d > max) max = d; sum += d; if (d > 8) bad++; n++; }
        onDiff({ max, mean: sum / n, badPct: (100 * bad) / n });
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [original, graph, uniforms, originalUniforms, size, onDiff, generation]);

  const frame = { width: size, height: size, borderRadius: radius.md, background: '#000', display: 'block' } as const;
  const cap = { color: tk.text.faint, font: `600 10px ${fontFamily.ui}`, letterSpacing: '0.06em', textTransform: 'uppercase' as const, marginTop: 4 };
  const note = (ref: React.RefObject<HTMLDivElement | null>) => (
    <div ref={ref} style={{ position: 'absolute', inset: 0, display: 'none', alignItems: 'center', justifyContent: 'center', padding: 6, textAlign: 'center', color: '#fff', font: `600 10.5px/1.3 ${fontFamily.ui}`, pointerEvents: 'none' }} />
  );
  return (
    <div style={{ display: 'flex', gap: 10 }}>
      <div><div style={{ position: 'relative' }}><canvas ref={a} width={size} height={size} style={frame} />{note(noteA)}</div><div style={cap}>{labels[0]}</div></div>
      <div><div style={{ position: 'relative' }}><canvas ref={b} width={size} height={size} style={frame} />{note(noteB)}</div><div style={cap}>{labels[1]}</div></div>
    </div>
  );
}
