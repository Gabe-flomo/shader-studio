/**
 * ScriptPreview — runs a sketch on its own small canvas, apart from the
 * picture: the draft as you type, with the layer's current control values,
 * the mouse over the preview, and its buttons pressable underneath. Uses the
 * same compile and step as the layer kit, so what runs here runs there.
 */
import { useEffect, useRef, useState } from 'react';
import { klSketchCompile, klSketchDispose, klSketchPress, klSketchStep, type KlSketchState } from '../../../play/kit/layers.js';
import { k3PictureTexture, k3Render, k3Renderer } from '../../../play/kit/sketch3d.js';
import { useThreeRuntime } from '../../../play/threeSource';
import { useTokens } from '../../../theme/themeStore';
import { fontFamily, radius } from '../../../theme/tokens';
import type { ScriptParamDef } from '../../../types/playLayers';
import { Button, IconButton } from '../../ui/Button';

/** No shader here: a soft glow stands in for the picture (its brightness, and in 3D its texture). */
let glow: HTMLCanvasElement | null = null;
function glowCanvas(): HTMLCanvasElement {
  if (glow) return glow;
  glow = document.createElement('canvas'); glow.width = 256; glow.height = 144;
  const x = glow.getContext('2d')!;
  const g = x.createRadialGradient(128, 72, 4, 128, 72, 150);
  g.addColorStop(0, '#ffe3a3'); g.addColorStop(0.35, '#e0609a'); g.addColorStop(0.7, '#3a3a9a'); g.addColorStop(1, '#0b0b10');
  x.fillStyle = g; x.fillRect(0, 0, 256, 144);
  return glow;
}

export function ScriptPreview({ code, files, p5, assets, defs, values, clear, mode = '2d', ratio = 16 / 9, width = 320, onLog }: {
  /** The main file (sketch.js). */
  code: string;
  /** The sketch's other files, run first in the same scope. */
  files?: ReadonlyArray<{ name: string; code: string }>;
  /** Run the p5 way (its own canvas, fitted in). */
  p5?: boolean;
  /** Files an imported p5 project loads (images, JSON…). */
  assets?: ReadonlyArray<{ name: string; kind: string; data: string }>;
  /** Where its console goes; without it, nowhere (the layer's own run fills the Console). */
  onLog?: (level: string, args: unknown[]) => void;
  /** 3D: the sketch draws with three.js (a shared WebGL renderer), copied onto this canvas each frame. */
  mode?: '2d' | '3d';
  defs: ScriptParamDef[];
  /** Current control values by key (the layer's `p_` values); a missing key uses the declared value. */
  values: Record<string, number>;
  clear: boolean;
  ratio?: number;
  width?: number;
}) {
  const tk = useTokens();
  const ref = useRef<HTMLCanvasElement>(null);
  const stRef = useRef<KlSketchState | null>(null);
  const latest = useRef({ defs, values, clear });
  latest.current = { defs, values, clear };
  const mouse = useRef({ x: 0, y: 0, over: false, down: false });
  const [error, setError] = useState<string | null>(null);
  const [run, setRun] = useState(0);
  const filesKey = JSON.stringify(files ?? []);
  const logRef = useRef(onLog);
  logRef.current = onLog;
  const height = Math.round(width / ratio);
  // 3D: three.js loads on first use; the run starts once it is here.
  const three = useThreeRuntime(mode === '3d');
  const waiting = mode === '3d' && !three;

  useEffect(() => {
    const canvas = ref.current; if (!canvas || waiting) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = Math.round(width * dpr), H = Math.round(height * dpr);
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d'); if (!ctx) return;
    const st = klSketchCompile(code, { mode, three, files: JSON.parse(filesKey), p5: !!p5, assets: assets as never, log: (level, args) => { if (logRef.current) logRef.current(level, args); } });
    stRef.current = st;
    setError(st.error);
    if (st.error) return;
    const t0 = performance.now();
    let last = t0, raf = 0, alive = true;
    const tick = (now: number) => {
      if (!alive) return;
      const dt = Math.min(0.1, (now - last) / 1000); last = now;
      const { defs, values, clear } = latest.current;
      // A control marked restart moved (or Run): start over.
      if (st.wantRestart) { setRun(n => n + 1); return; }
      const params: Record<string, number> = {};
      for (const d of defs) { const v = values[d.key]; params[d.key] = typeof v === 'number' && Number.isFinite(v) ? v : d.value; }
      const m = mouse.current;
      const s: Record<string, unknown> = {
        ctx, width: W, height: H, dpr, time: (now - t0) / 1000, dt, frame: st.frame, params, state: (st as unknown as { state: unknown }).state,
        mouse: { x: m.x * dpr, y: m.y * dpr, over: m.over, down: m.down },
        // No shader here: the picture reads as a soft glow in the middle, so picture-reading sketches show something.
        picture: {
          brightness: (x: number, y: number) => Math.max(0, 1 - Math.hypot((x - W / 2) / (W / 2), (y - H / 2) / (H / 2))),
          get texture() { return st.g3 ? k3PictureTexture(three, glowCanvas(), 0) : null; },
        },
        null: () => null, random: Math.random,
      };
      const err = klSketchStep(st, s, defs, clear);
      if (err) { setError(err); return; }
      if (st.g3) {
        // A p5 sketch renders at its own canvas's shape, fitted in.
        const v = st.p5 && st.p5.view;
        const vw = v ? Math.max(1, Math.round(v.w)) : W, vh = v ? Math.max(1, Math.round(v.h)) : H;
        const out = st.waiting ? null : k3Render(st.g3, k3Renderer(three, vw, vh), vw, vh);
        if (clear || st.frame <= 1 || st.p5) ctx.clearRect(0, 0, W, H);
        if (out) ctx.drawImage(out, v ? Math.round(v.x) : 0, v ? Math.round(v.y) : 0);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { alive = false; cancelAnimationFrame(raf); klSketchDispose(st); };
  }, [code, filesKey, p5, assets, mode, three, waiting, width, height, run]);

  const buttons = defs.filter(d => d.kind === 'button');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ position: 'relative', width, height, borderRadius: radius.md, overflow: 'hidden', background: '#0b0b10', boxShadow: `inset 0 0 0 1px ${tk.border.subtle}` }}>
        <canvas
          ref={ref} aria-label="Scratch run of the sketch" style={{ display: 'block', width, height }}
          onPointerMove={e => { const r = e.currentTarget.getBoundingClientRect(); mouse.current = { ...mouse.current, x: e.clientX - r.left, y: e.clientY - r.top, over: true }; }}
          onPointerEnter={() => { mouse.current.over = true; }}
          onPointerLeave={() => { mouse.current.over = false; mouse.current.down = false; }}
          onPointerDown={() => { mouse.current.down = true; }}
          onPointerUp={() => { mouse.current.down = false; }}
        />
        {waiting && !error && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', font: `500 11.5px ${fontFamily.ui}`, color: 'rgba(255,255,255,0.6)' }}>Loading three.js…</div>
        )}
        {error && (
          <div style={{ position: 'absolute', inset: 0, padding: 10, overflow: 'auto', font: `500 11px/1.4 ${fontFamily.mono}`, color: '#ffb4a2', background: 'rgba(11,11,16,0.9)' }}>{error}</div>
        )}
        <div style={{ position: 'absolute', top: 6, right: 6 }}>
          <IconButton icon="reset" label="Restart the sketch (runs setup again)" size="sm" onClick={() => setRun(n => n + 1)} style={{ background: 'rgba(0,0,0,0.4)', color: '#fff' }} />
        </div>
      </div>
      {buttons.length > 0 && (
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {buttons.map(d => <Button key={d.key} size="sm" icon="play" onClick={() => { if (stRef.current) klSketchPress(stRef.current, d.key, 1); }}>{d.label}</Button>)}
        </div>
      )}
    </div>
  );
}
