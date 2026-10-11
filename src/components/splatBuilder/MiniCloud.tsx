/**
 * MiniCloud — the Splat builder's small pictures (docs/splat-builder.md): a point cloud on the CPU
 * (splatBuilder/miniCloud.ts) turning slowly, with effects applied: an effect card's live mini preview, the
 * template cards, the kind page's picture. Costs the GPU nothing (the main preview is the builder's picture).
 */
import { useEffect, useRef } from 'react';
import type { EffectSpec, Vec3 } from '../../splatBuilder/spec';
import { cloudPoints, cloudWith, type Pt } from '../../splatBuilder/miniCloud';

const BASE = cloudPoints(700);
const SMALL = cloudPoints(420);
const css = (c: readonly number[], a = 1) => `rgba(${c.map(v => Math.round(Math.max(0, Math.min(1, v)) * 255)).join(',')},${Math.max(0, Math.min(1, a)).toFixed(3)})`;

/** Draw the cloud on a 2D context (CSS pixels w × h), turned `yaw` radians. */
export function drawCloud(ctx: CanvasRenderingContext2D, w: number, h: number, pts: readonly Pt[], yaw: number, bg: Vec3 | null): void {
  if (bg) { ctx.fillStyle = css(bg); ctx.fillRect(0, 0, w, h); } else ctx.clearRect(0, 0, w, h);
  const cs = Math.cos(yaw), sn = Math.sin(yaw), tilt = 0.25, ct = Math.cos(tilt), st = Math.sin(tilt);
  const f = Math.min(w, h) * 1.15, camZ = 3.4;
  const proj = pts.map(q => {
    const x = q.p[0] * cs - q.p[2] * sn, z0 = q.p[0] * sn + q.p[2] * cs;
    const y = q.p[1] * ct - z0 * st, z = q.p[1] * st + z0 * ct;
    const k = f / (camZ - z);
    return { q, x: w / 2 + x * k, y: h / 2 - y * k, z, k };
  }).sort((a, b) => a.z - b.z);
  for (const { q, x, y, k } of proj) {
    if (q.a <= 0.01 || q.s <= 0.01) continue;
    if (q.dot) {
      ctx.fillStyle = css(q.c, q.a);
      ctx.beginPath(); ctx.arc(x, y, Math.max(0.6, q.s * 1.1), 0, Math.PI * 2); ctx.fill();
    } else {
      const r = Math.max(0.8, q.s * k * 0.045);
      ctx.fillStyle = css(q.c, q.a * 0.55);
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }
  }
}

/** A still picture of the cloud with `effects` (a data URL), for preset cards. */
export function cloudPicture(effects: readonly EffectSpec[], bg: Vec3, w = 264, h = 152, t = 0): string | null {
  if (typeof document === 'undefined') return null;
  try {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    if (!ctx) return null;
    drawCloud(ctx, w, h, cloudWith(BASE, effects, t), 0.6, bg);
    return c.toDataURL('image/png');
  } catch { return null; }
}

/** The cloud, live: `effects` (read every frame, so sliders show at once) on `bg`, turning. */
export function MiniCloud({ effects, bg = [0.05, 0.055, 0.07], width = 120, height = 72, fps = 24, small = false, label, fluid = false }: {
  effects: readonly EffectSpec[]; bg?: Vec3 | null; width?: number; height?: number; fps?: number; small?: boolean; label?: string;
  /** Fill the parent's width (keeping the picture's shape) instead of `width` CSS pixels. */
  fluid?: boolean;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const live = useRef({ effects, bg });
  live.current = { effects, bg };
  useEffect(() => {
    const c = ref.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = Math.round(width * dpr); c.height = Math.round(height * dpr);
    let raf = 0, last = -Infinity;
    const t0 = performance.now();
    const draw = (now: number) => {
      // Effects start mid-sweep (an animated amount at half), the cloud a little turned.
      const t = (now - t0) / 1000;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawCloud(ctx, width, height, cloudWith(small ? SMALL : BASE, live.current.effects, t), 0.6 + t * 0.35, live.current.bg);
    };
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (now - last < 1000 / fps || document.hidden) return;
      last = now;
      draw(now);
    };
    draw(t0);
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [width, height, fps, small]);
  return <canvas ref={ref} data-mini-cloud aria-label={label ?? 'A small preview of the effect on a point cloud'} style={{ width: fluid ? '100%' : width, height: fluid ? '100%' : height, display: 'block', borderRadius: fluid ? 0 : 8, flexShrink: 0 }} />;
}
