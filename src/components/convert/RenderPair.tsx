/**
 * RenderPair — the original shader and the converted graph's shader, side by
 * side on one clock, with how far apart their pixels are. Two small WebGL
 * canvases of their own (not the app's preview), dither off, same uniforms,
 * so a difference is the conversion's, not the renderer's. Every half second
 * both are read back and compared; `onDiff` gets the max error (0..255) or
 * the compile error of either side.
 *
 * Each canvas keeps one context for its whole life and only swaps programs
 * when a shader changes: a canvas has a single context, so losing it on
 * every change (as this once did) left both pictures black from the second
 * shader on.
 */
import { useEffect, useRef } from 'react';
import { useTokens } from '../../theme/themeStore';
import { fontFamily, radius } from '../../theme/tokens';

export type PairDiff = { max: number; mean: number; badPct: number } | { error: string; side: 'original' | 'graph' };

const VS = 'attribute vec2 p; varying vec2 vUv; void main(){ vUv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }';

interface Side { gl: WebGLRenderingContext; prog: WebGLProgram | null; error: string | null; locs: Map<string, WebGLUniformLocation | null> }

function context(canvas: HTMLCanvasElement): Side | null {
  const gl = canvas.getContext('webgl', { preserveDrawingBuffer: true, antialias: false, premultipliedAlpha: false });
  if (!gl) return null;
  const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.disable(gl.DITHER);
  return { gl, prog: null, error: null, locs: new Map() };
}

/** Compile `frag` into the side's program, replacing the previous one; null clears it. */
function program(side: Side, frag: string | null): void {
  const { gl } = side;
  if (side.prog) { gl.deleteProgram(side.prog); side.prog = null; }
  side.locs.clear(); side.error = null;
  if (!frag) return;
  const compile = (type: number, src: string) => { const s = gl.createShader(type)!; gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { const log = gl.getShaderInfoLog(s) ?? 'shader error'; gl.deleteShader(s); throw new Error(log); } return s; };
  try {
    const prog = gl.createProgram()!;
    const vs = compile(gl.VERTEX_SHADER, VS), fs = compile(gl.FRAGMENT_SHADER, frag);
    gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
    gl.deleteShader(vs); gl.deleteShader(fs);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { const log = gl.getProgramInfoLog(prog) ?? 'link error'; gl.deleteProgram(prog); throw new Error(log); }
    gl.useProgram(prog);
    const loc = gl.getAttribLocation(prog, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    side.prog = prog;
  } catch (e) { side.error = String((e as Error).message).split('\u0000').join('').trim(); }
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
    if (typeof v === 'number') gl.uniform1f(l, v); else if (v.length === 2) gl.uniform2f(l, v[0], v[1]); else if (v.length === 3) gl.uniform3f(l, v[0], v[1], v[2]); else gl.uniform4f(l, v[0], v[1], v[2], v[3]);
  }
  gl.viewport(0, 0, size, size);
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

  // One context per canvas for the component's life.
  useEffect(() => {
    const s = sides.current;
    if (a.current && !s.A) s.A = context(a.current);
    if (b.current && !s.B) s.B = context(b.current);
    return () => {
      for (const side of [s.A, s.B]) { if (side) { program(side, null); side.gl.getExtension('WEBGL_lose_context')?.loseContext(); } }
      s.A = null; s.B = null;
    };
  }, []);

  // Programs follow the shaders; the frame loop restarts with them.
  useEffect(() => {
    const { A, B } = sides.current;
    if (!A || !B) { onDiff({ error: 'WebGL isn’t available here', side: 'original' }); return; }
    program(A, original); program(B, graph);
    if (A.error) { onDiff({ error: A.error, side: 'original' }); return; }
    if (B.error) { onDiff({ error: B.error, side: 'graph' }); return; }
    if (!graph) { onDiff(null); return; }
    const t0 = performance.now();
    let raf = 0, lastCmp = 0;
    const pa = new Uint8Array(size * size * 4), pb = new Uint8Array(size * size * 4);
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const t = (now - t0) / 1000;
      draw(A, size, t, originalUniforms ?? {}); draw(B, size, t, uniforms);
      if (now - lastCmp > 500) {
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
  }, [original, graph, uniforms, originalUniforms, size, onDiff]);

  const frame = { width: size, height: size, borderRadius: radius.md, background: '#000', display: 'block' } as const;
  const cap = { color: tk.text.faint, font: `600 10px ${fontFamily.ui}`, letterSpacing: '0.06em', textTransform: 'uppercase' as const, marginTop: 4 };
  return (
    <div style={{ display: 'flex', gap: 10 }}>
      <div><canvas ref={a} width={size} height={size} style={frame} /><div style={cap}>{labels[0]}</div></div>
      <div><canvas ref={b} width={size} height={size} style={{ ...frame, opacity: graph ? 1 : 0.3 }} /><div style={cap}>{labels[1]}</div></div>
    </div>
  );
}
