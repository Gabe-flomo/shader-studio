/**
 * scenePictures — the Scene builder's kind page pictures (docs/scene-builder.md), one per kind,
 * drawn on the CPU so the page costs the GPU nothing (the main preview is held while it shows):
 *
 *  - 2D scene: a ring of stars folded round the centre, turning slowly (sceneBuilder2d's shape SDFs);
 *  - Agent scene: the Agent Builder's trail followers, moving (agentBuilder/miniSim.ts);
 *  - Grid scene: shapes on cells, breathing in a wave across the grid;
 *  - Grid simulation: Conway's Life running on a small board (gridRules/cpu.ts);
 *  - 3D scene: a torus, a ball and a box from the 3D builder's own thumbnail marcher;
 *  - Splat scene: a point cloud dissolving and coming back (the Splat builder's own mini cloud);
 *  - Time Cube: frames of the Ball action clip stacked into a box, the slice sweeping through (timeCubeBuilder/picture.ts);
 *  - Warp: a grid bent by a moving sine warp (the Warp Builder's warped-grid picture).
 */
import { useEffect, useRef } from 'react';
import type { SceneKind } from '../../builders/sceneKinds';
import { renderWarpThumbnail, shapeSdf } from '../../sceneBuilder2d/thumbnails';
import { renderThumbnail } from '../../sceneBuilder/thumbnails';
import { cpuColours, cpuSeed, cpuStep, type CpuBoard } from '../../gridRules/cpu';
import { COUNT_PRESETS } from '../../gridRules/spec';
import { KindPicture } from '../agentBuilder/pictures';
import { MiniCloud } from '../splatBuilder/MiniCloud';
import { animateFor, newEffect } from '../../splatBuilder/spec';
import { drawTimeCube } from '../../timeCubeBuilder/picture';
import { presetSpec } from '../../timeCubeBuilder/presets';

/** The Splat scene's picture: a dissolve sweeping through the cloud, with a glowing edge. */
const SPLAT_PICTURE = [{ ...newEffect('dissolve', 'k1', { edge: 0.08, glow: 5, drift: 0.4 }), animate: animateFor('dissolve', 'amount', 0.12) }];

function SplatPicture({ width, height }: { width: number; height: number }) {
  return (
    <span style={{ display: 'block', width: '100%', maxWidth: width, aspectRatio: `${width} / ${height}`, borderRadius: 10, overflow: 'hidden', background: BG }}>
      <MiniCloud effects={SPLAT_PICTURE} bg={[13 / 255, 13 / 255, 18 / 255]} width={width} height={height} fps={20} fluid label="A splat scan dissolving" />
    </span>
  );
}

const BG = '#0d0d12';

/** A picture as wide as its card allows, up to its own size, keeping its shape. */
const fluid = (width: number, height: number) => ({ width: '100%', maxWidth: width, height: 'auto', aspectRatio: `${width} / ${height}`, display: 'block', borderRadius: 10, background: BG }) as const;

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
  return <canvas ref={ref} width={width} height={height} style={fluid(width, height)} />;
}

const LIFE = { ...COUNT_PRESETS.life.params, density: 0.22 };

/** Shapes drawn on cells (circles, squares, diamonds), sized by a wave that runs across the grid. */
function GridScenePicture({ width, height }: { width: number; height: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const cols = 12, rows = Math.max(1, Math.round(12 * height / width));
  useTicker(20, t => {
    const c = ref.current, ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, c.width, c.height);
    const cw = c.width / cols, ch = c.height / rows;
    ctx.strokeStyle = 'rgba(120, 140, 190, 0.35)';
    ctx.lineWidth = 1;
    for (let i = 1; i < cols; i++) { ctx.beginPath(); ctx.moveTo(i * cw, 0); ctx.lineTo(i * cw, c.height); ctx.stroke(); }
    for (let j = 1; j < rows; j++) { ctx.beginPath(); ctx.moveTo(0, j * ch); ctx.lineTo(c.width, j * ch); ctx.stroke(); }
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      const k = (i * 7 + j * 3) % 5;
      if (k === 4) continue;
      const wave = 0.5 + 0.5 * Math.sin(t * 2.2 - (i + j) * 0.55);
      const r = Math.min(cw, ch) * (0.14 + 0.24 * wave);
      const x = (i + 0.5) * cw, y = (j + 0.5) * ch;
      ctx.fillStyle = `hsl(${190 + 40 * wave}, 80%, ${55 + 15 * wave}%)`;
      ctx.beginPath();
      if (k === 0 || k === 3) ctx.arc(x, y, r, 0, Math.PI * 2);
      else if (k === 1) ctx.rect(x - r, y - r, r * 2, r * 2);
      else { ctx.moveTo(x, y - r * 1.2); ctx.lineTo(x + r * 1.2, y); ctx.lineTo(x, y + r * 1.2); ctx.lineTo(x - r * 1.2, y); ctx.closePath(); }
      ctx.fill();
    }
  });
  return <canvas ref={ref} width={width} height={height} style={fluid(width, height)} />;
}

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
  return <canvas ref={ref} width={width} height={height} style={{ ...fluid(width, height), imageRendering: 'pixelated' }} />;
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
  return <canvas ref={ref} width={width} height={height} style={fluid(width, height)} />;
}

/** A grid bent by a travelling sine warp: x moves with a wave of y, y with a wave of x. */
function WarpPicture({ width, height }: { width: number; height: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useTicker(12, t => {
    const c = ref.current, ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    const s = c.width;
    const px = renderWarpThumbnail((x, y) => [x + 0.12 * Math.sin(y * 6 + t * 1.4), y + 0.1 * Math.sin(x * 5 - t)], s, 2.6);
    try {
      ctx.putImageData(new ImageData(new Uint8ClampedArray(px), s, s), 0, Math.round((c.height - s) / 2));
    } catch { /* a picture is a nicety */ }
  });
  return <canvas ref={ref} width={width} height={height} style={fluid(width, height)} />;
}

/** A box of time: the Ball action clip's frames stacked, the slice sweeping there and back. */
function TimeCubePicture({ width, height }: { width: number; height: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const spec = useRef(presetSpec('box'));
  useTicker(12, t => {
    const g = ref.current?.getContext('2d');
    if (!g) return;
    try { drawTimeCube(g, width, height, spec.current, 0.5 - 0.45 * Math.cos(t * 0.6)); } catch { /* a picture is a nicety */ }
  });
  return <canvas ref={ref} width={width} height={height} style={fluid(width, height)} />;
}

/** A kind's picture for the kind page. */
export function ScenePicture({ kind, width = 240, height = 136 }: { kind: SceneKind; width?: number; height?: number }) {
  if (kind === '2d') return <TwoDPicture width={width} height={height} />;
  if (kind === 'grid') return <GridScenePicture width={width} height={height} />;
  if (kind === 'simulation') return <GridPicture width={width} height={height} />;
  if (kind === '3d') return <ThreeDPicture width={width} height={height} />;
  if (kind === 'splat') return <SplatPicture width={width} height={height} />;
  if (kind === 'timecube') return <TimeCubePicture width={width} height={height} />;
  if (kind === 'warp') return <WarpPicture width={width} height={height} />;
  return <span style={{ display: 'block', borderRadius: 10, overflow: 'hidden', width: '100%', maxWidth: width }}><KindPicture kind="trail" width={width} height={height} /></span>;
}
