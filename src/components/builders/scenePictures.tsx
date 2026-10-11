/**
 * scenePictures — the Scene builder's kind page pictures (docs/scene-builder.md), one per kind,
 * drawn on the CPU so the page costs the GPU nothing (the main preview is held while it shows):
 *
 *  - 2D scene: a ring of stars folded round the centre, turning slowly (sceneBuilder2d's shape SDFs);
 *  - Agent scene: the Agent Builder's trail followers, moving (agentBuilder/miniSim.ts);
 *  - Grid scene: Conway's Life running on a small board (gridRules/cpu.ts);
 *  - 3D scene: a torus, a ball and a box from the 3D builder's own thumbnail marcher.
 */
import { useEffect, useRef } from 'react';
import type { SceneKind } from '../../builders/sceneKinds';
import { shapeSdf } from '../../sceneBuilder2d/thumbnails';
import { renderThumbnail } from '../../sceneBuilder/thumbnails';
import { cpuColours, cpuSeed, cpuStep, type CpuBoard } from '../../gridRules/cpu';
import { COUNT_PRESETS } from '../../gridRules/spec';
import { KindPicture } from '../agentBuilder/pictures';

const BG = '#0d0d12';

/** Run `frame` about `fps` times a second while mounted (and the page can be seen). */
function useTicker(fps: number, frame: (t: number) => void) {
  const live = useRef(frame);
  useEffect(() => { live.current = frame; });
  useEffect(() => {
    let raf = 0, last = -Infinity;
    const t0 = performance.now();
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (now - last < 1000 / fps || document.hidden) return;
      last = now;
      live.current((now - t0) / 1000);
    };
    // The first picture at once, not on the first animation frame.
    live.current(0);
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [fps]);
}

function TwoDPicture({ width, height }: { width: number; height: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const star = useRef(shapeSdf('star', { r: 0.2 }));
  const ring = useRef(shapeSdf('ring', { r: 0.62, th: 0.012 }));
  useTicker(20, t => {
    const c = ref.current, ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    const W = c.width, H = c.height, img = ctx.createImageData(W, H), px = img.data;
    const n = 6, wedge = (2 * Math.PI) / n, turn = t * 0.25;
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      const x = ((i + 0.5) - W / 2) / (H / 2) * 1.05, y = (H / 2 - (j + 0.5)) / (H / 2) * 1.05;
      // Fold into one wedge (polar repeat), then the star sits on the ring.
      const a = Math.atan2(y, x) + turn, r = Math.hypot(x, y);
      const fa = ((a % wedge) + wedge) % wedge - wedge / 2;
      const sx = Math.cos(fa) * r - 0.62, sy = Math.sin(fa) * r;
      const d = Math.min(star.current(sy, sx), ring.current(x, y), Math.abs(r - 0.22) - 0.05);
      const fill = Math.min(1, Math.max(0, 0.5 - d * (H / 2.1)));
      const glow = Math.exp(-Math.max(d, 0) * 9) * 0.35;
      const hue = r * 1.6 + t * 0.15;
      const k = (j * W + i) * 4;
      const v = Math.min(1, fill + glow);
      px[k] = 13 + v * (180 + 70 * Math.cos(6.283 * hue));
      px[k + 1] = 13 + v * (150 + 80 * Math.cos(6.283 * (hue + 0.33)));
      px[k + 2] = 18 + v * (190 + 60 * Math.cos(6.283 * (hue + 0.67)));
      px[k + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  });
  return <canvas ref={ref} width={width} height={height} style={{ width, height, display: 'block', borderRadius: 10, background: BG }} />;
}

const LIFE = { ...COUNT_PRESETS.life.params, density: 0.22 };

function GridPicture({ width, height }: { width: number; height: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const board = useRef<CpuBoard | null>(null);
  const bw = 64, bh = Math.round(64 * height / width);
  const steps = useRef(0);
  useTicker(10, () => {
    const c = ref.current, ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    // A fresh board now and then, so it never settles into still lifes.
    if (!board.current || steps.current++ > 240) { board.current = cpuSeed(LIFE, bw, bh); steps.current = 0; }
    board.current = cpuStep(LIFE, board.current);
    const img = ctx.createImageData(bw, bh);
    cpuColours(LIFE, board.current, img.data);
    const off = document.createElement('canvas');
    off.width = bw; off.height = bh;
    off.getContext('2d')?.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(off, 0, 0, c.width, c.height);
  });
  return <canvas ref={ref} width={width} height={height} style={{ width, height, display: 'block', borderRadius: 10, background: BG, imageRendering: 'pixelated' }} />;
}

function ThreeDPicture({ width, height }: { width: number; height: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current, ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, c.width, c.height);
    const put = (key: string, size: number, x: number, y: number) => {
      try {
        const tile = document.createElement('canvas');
        tile.width = size; tile.height = size;
        tile.getContext('2d')?.putImageData(new ImageData(renderThumbnail(key, size, 1), size, size), 0, 0);
        ctx.drawImage(tile, x, y);
      } catch { /* a picture is a nicety */ }
    };
    const s = Math.round(height * 0.62);
    put('sphere', Math.round(s * 0.62), Math.round(width * 0.12), Math.round(height * 0.42));
    put('rounded-box', Math.round(s * 0.62), Math.round(width * 0.66), Math.round(height * 0.4));
    put('torus', s, Math.round((width - s) / 2), Math.round(height * 0.1));
  }, [width, height]);
  return <canvas ref={ref} width={width} height={height} style={{ width, height, display: 'block', borderRadius: 10, background: BG }} />;
}

/** A kind's picture for the kind page. */
export function ScenePicture({ kind, width = 240, height = 136 }: { kind: SceneKind; width?: number; height?: number }) {
  if (kind === '2d') return <TwoDPicture width={width} height={height} />;
  if (kind === 'grid') return <GridPicture width={width} height={height} />;
  if (kind === '3d') return <ThreeDPicture width={width} height={height} />;
  return <span style={{ display: 'block', borderRadius: 10, overflow: 'hidden', width, height }}><KindPicture kind="trail" width={width} height={height} /></span>;
}
