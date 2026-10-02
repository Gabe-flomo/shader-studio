/**
 * LiveTrace — the last few seconds of a value as a line, read thirty times a
 * second while the window is open (its own small canvas, independent of the
 * Controls board's traces).
 */
import { useEffect, useRef, useState } from 'react';
import { useTokens } from '../../../theme/themeStore';
import { alpha, fontFamily } from '../../../theme/tokens';

const POINTS = 180;

export function LiveTrace({ read, min, max, height = 56 }: { read: () => number | null; min: number; max: number; height?: number }) {
  const tk = useTokens();
  const ref = useRef<HTMLCanvasElement>(null);
  const readRef = useRef(read);
  readRef.current = read;
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const pts: Array<number | null> = [];
    let raf = 0, last = 0;
    const tick = (t: number) => {
      raf = requestAnimationFrame(tick);
      if (t - last < 33) return;
      last = t;
      const v = readRef.current();
      pts.push(v);
      if (pts.length > POINTS) pts.shift();
      setNow(v === null ? null : Math.round(v * 1000) / 1000);
      const cv = ref.current;
      const ctx = cv?.getContext('2d');
      if (!cv || !ctx) return;
      const w = cv.clientWidth, h = cv.clientHeight, dpr = window.devicePixelRatio || 1;
      if (cv.width !== w * dpr) { cv.width = w * dpr; cv.height = h * dpr; }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.strokeStyle = tk.accent.base;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      let pen = false;
      const span = max - min || 1;
      pts.forEach((p, i) => {
        if (p === null) { pen = false; return; }
        const x = (i / (POINTS - 1)) * w, y = h - 3 - ((Math.max(min, Math.min(max, p)) - min) / span) * (h - 6);
        if (pen) ctx.lineTo(x, y); else ctx.moveTo(x, y);
        pen = true;
      });
      ctx.stroke();
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [min, max, tk.accent.base]);
  return (
    <div data-live-trace="" style={{ position: 'relative' }}>
      <canvas ref={ref} style={{ display: 'block', width: '100%', height, borderRadius: 6, background: alpha(tk.text.faint, 0.07) }} />
      <span style={{ position: 'absolute', right: 6, top: 4, font: `600 11px ${fontFamily.mono}`, color: tk.text.secondary }}>{now === null ? '—' : now}</span>
    </div>
  );
}
