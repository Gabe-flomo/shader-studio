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
import { context, program, draw, type Side } from './sideRender';
import { useTokens } from '../../theme/themeStore';
import { fontFamily, radius } from '../../theme/tokens';

export type PairDiff = { max: number; mean: number; badPct: number } | { error: string; side: 'original' | 'graph' };

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
      draw(A, size, size, t, originalUniforms ?? {}); draw(B, size, size, t, uniforms);
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
