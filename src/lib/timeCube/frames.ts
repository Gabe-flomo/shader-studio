/**
 * Filling a Time cube's atlas (docs/time-cube.md): a video's frames, seeked
 * and drawn one by one, or the built-in test clip, painted.
 *
 * Video frames are read the way Bake's offline render reads a Baked node's
 * video (lib/bakedVideos.ts seek): a muted <video>, `currentTime` set, wait
 * for `seeked`, then draw. That works in every browser and the desktop app's
 * WKWebView, needs no WebCodecs and no demuxer, and lands on the frame shown
 * at that time. Each frame is drawn straight into its tile, scaled.
 */
import { tileOrigin, type StackPlan, type VideoMeta } from './plan';
import { drawClipFrame, isIdentity, type ClipTransform } from '../media/clip';

export class TimeCubeCancelled extends Error {
  constructor() { super('Cancelled'); this.name = 'TimeCubeCancelled'; }
}

const waitFor = (el: HTMLVideoElement, ev: string, ms: number) => new Promise<boolean>(res => {
  const done = (ok: boolean) => { clearTimeout(timer); el.removeEventListener(ev, yes); el.removeEventListener('error', no); res(ok); };
  const yes = () => done(true), no = () => done(false);
  const timer = setTimeout(() => done(false), ms);
  el.addEventListener(ev, yes);
  el.addEventListener('error', no);
});

function videoElement(url: string): HTMLVideoElement {
  const el = document.createElement('video');
  el.muted = true; el.playsInline = true; el.preload = 'auto';
  el.setAttribute('playsinline', ''); el.setAttribute('muted', '');
  el.src = url;
  return el;
}

function release(el: HTMLVideoElement, url: string) {
  el.pause(); el.removeAttribute('src'); el.load();
  URL.revokeObjectURL(url);
}

/** A video file's size and length. */
export async function probeVideo(blob: Blob): Promise<VideoMeta | null> {
  const url = URL.createObjectURL(blob);
  const el = videoElement(url);
  try {
    if (!(await waitFor(el, 'loadedmetadata', 15_000))) return null;
    if (!el.videoWidth || !el.videoHeight) return null;
    // A WebM straight from a recorder often has no length in its header: seeking far past the end makes the browser find it.
    if (!Number.isFinite(el.duration) || el.duration <= 0) {
      const found = waitFor(el, 'durationchange', 8000);
      el.currentTime = 1e7;
      await found;
      if (!Number.isFinite(el.duration)) await waitFor(el, 'seeked', 4000);
    }
    return { width: el.videoWidth, height: el.videoHeight, duration: Number.isFinite(el.duration) ? el.duration : 0 };
  } finally { release(el, url); }
}

/** Draw every planned frame of a video into `ctx` (an atlas canvas the plan's size). */
export async function decodeVideoFrames(blob: Blob, plan: StackPlan, ctx: CanvasRenderingContext2D, onFrame: (done: number) => void, signal: AbortSignal): Promise<void> {
  const url = URL.createObjectURL(blob);
  const el = videoElement(url);
  try {
    if (!(await waitFor(el, 'loadeddata', 20_000))) throw new Error('This video could not be opened here.');
    for (let i = 0; i < plan.frames; i++) {
      if (signal.aborted) throw new TimeCubeCancelled();
      const t = Math.min(plan.times[i], Math.max(0, (Number.isFinite(el.duration) ? el.duration : plan.times[i]) - 1e-3));
      if (Math.abs(el.currentTime - t) > 1e-4 || el.readyState < 2) {
        const seeked = waitFor(el, 'seeked', 5000);
        el.currentTime = t;
        await seeked;
        if (el.readyState < 2) await waitFor(el, 'loadeddata', 2000);
      }
      if (signal.aborted) throw new TimeCubeCancelled();
      const { x, y } = tileOrigin(plan, i);
      drawClipFrame(ctx, el, el.videoWidth, el.videoHeight, plan.xf, x, y, plan.tileW, plan.tileH);
      onFrame(i + 1);
    }
  } finally { release(el, url); }
}

// ── The test clip ────────────────────────────────────────────────────────────

/** The built-in clip: a street, 4 seconds, 16:9. Painted, not decoded, so examples work offline and in tests. */
export const DEMO_META: VideoMeta = { width: 640, height: 360, duration: 4 };
export const DEMO_LABEL = 'Test clip: a red car crossing a street (built in)';

/**
 * Paint frame time `t` (seconds, 0–4) of the test clip into a w × h box at (x, y). Designed for
 * the time cube: a red car (the only red thing) drives left to right, a blue ball bounces the other
 * way, a cloud drifts, the sun climbs, a tree sways and street lamps blink. The car's path
 * makes a clean diagonal trail through time; the ball a zigzag.
 */
export function paintDemoFrame(g: CanvasRenderingContext2D, t: number, x: number, y: number, w: number, h: number): void {
  const T = DEMO_META.duration, k = t / T;
  g.save();
  g.beginPath(); g.rect(x, y, w, h); g.clip();
  g.translate(x, y);
  g.scale(w / 640, h / 360);
  // Sky
  const sky = g.createLinearGradient(0, 0, 0, 230);
  sky.addColorStop(0, '#2b5fa8'); sky.addColorStop(1, '#a9cbe8');
  g.fillStyle = sky; g.fillRect(0, 0, 640, 240);
  // Sun, climbing
  g.fillStyle = '#ffd84a';
  g.beginPath(); g.arc(520 - 40 * k, 150 - 90 * k, 26, 0, Math.PI * 2); g.fill();
  // Cloud, drifting left
  g.fillStyle = 'rgba(255,255,255,0.92)';
  const cx = 700 - 820 * k;
  for (const [dx, dy, r] of [[0, 0, 22], [24, -8, 26], [52, 0, 20], [26, 8, 20]] as const) { g.beginPath(); g.arc(cx + dx, 70 + dy, r, 0, Math.PI * 2); g.fill(); }
  // Hills
  g.fillStyle = '#4c8a4f';
  g.beginPath(); g.moveTo(0, 240);
  for (let i = 0; i <= 32; i++) { const px = i * 20; g.lineTo(px, 205 - 22 * Math.sin(px * 0.012) - 10 * Math.sin(px * 0.031 + 1)); }
  g.lineTo(640, 240); g.closePath(); g.fill();
  // Pavement and road
  g.fillStyle = '#9a9a92'; g.fillRect(0, 232, 640, 22);
  g.fillStyle = '#3a3b3f'; g.fillRect(0, 254, 640, 86);
  g.fillStyle = '#e8e4d0';
  for (let i = 0; i < 8; i++) g.fillRect(i * 90 + 15, 295, 46, 5);
  g.fillStyle = '#7d7d76'; g.fillRect(0, 340, 640, 20);
  // Street lamps, blinking in turn
  for (let i = 0; i < 3; i++) {
    const lx = 100 + i * 220;
    g.fillStyle = '#2d2d2d'; g.fillRect(lx, 150, 5, 84);
    const on = Math.sin(t * 5 + i * 2.1) > 0;
    g.fillStyle = on ? '#fff6b0' : '#55524a';
    g.beginPath(); g.arc(lx + 2.5, 148, 8, 0, Math.PI * 2); g.fill();
  }
  // Tree, swaying
  const sway = 10 * Math.sin(t * 2.4);
  g.fillStyle = '#6b4a2b'; g.fillRect(268, 165, 10, 70);
  g.fillStyle = '#2f7d3a';
  g.beginPath(); g.ellipse(273 + sway, 150, 34, 42, sway * 0.01, 0, Math.PI * 2); g.fill();
  // Blue ball: bounces right to left
  const bx = 600 - 560 * k, by = 318 - 120 * Math.abs(Math.sin(t * Math.PI * 1.5));
  g.fillStyle = '#2a6fe0';
  g.beginPath(); g.arc(bx, by, 15, 0, Math.PI * 2); g.fill();
  g.fillStyle = 'rgba(255,255,255,0.5)';
  g.beginPath(); g.arc(bx - 5, by - 5, 4, 0, Math.PI * 2); g.fill();
  // Red car: left to right, the only red in the clip
  const carX = -110 + 860 * k, bob = 1.5 * Math.sin(t * 18);
  g.fillStyle = '#d81e1e';
  roundRect(g, carX, 262 + bob, 120, 30, 8); g.fill();
  roundRect(g, carX + 26, 242 + bob, 62, 26, 9); g.fill();
  g.fillStyle = '#bfe3ff';
  g.fillRect(carX + 34, 247 + bob, 22, 16); g.fillRect(carX + 60, 247 + bob, 22, 16);
  g.fillStyle = '#151515';
  for (const wx of [24, 96]) { g.beginPath(); g.arc(carX + wx, 293, 12, 0, Math.PI * 2); g.fill(); }
  g.fillStyle = '#bdbdbd';
  for (const wx of [24, 96]) { g.beginPath(); g.arc(carX + wx, 293, 5, 0, Math.PI * 2); g.fill(); }
  g.fillStyle = '#fff3a0'; g.fillRect(carX + 114, 268 + bob, 6, 7);
  g.restore();
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.quadraticCurveTo(x + w, y, x + w, y + r);
  g.lineTo(x + w, y + h - r); g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  g.lineTo(x + r, y + h); g.quadraticCurveTo(x, y + h, x, y + h - r);
  g.lineTo(x, y + r); g.quadraticCurveTo(x, y, x + r, y);
  g.closePath();
}

// ── Reading frames one at a time (Frames from, Frame order) ─────────────────

/** Draws the frame at a video time into a box, cropped / rotated / flipped by `xf` when given. */
export interface FrameReader {
  draw(t: number, g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, signal: AbortSignal, xf?: ClipTransform): Promise<void>;
  close(): void;
}

/**
 * The test clip at time t, with a clip transform: painted whole on a scratch canvas (sharp enough
 * for the crop to fill the tile), then drawn through the transform.
 */
export function paintDemoFrameXf(g: CanvasRenderingContext2D, t: number, xf: ClipTransform | undefined, x: number, y: number, w: number, h: number, scratch?: { c?: HTMLCanvasElement }): void {
  if (!xf || isIdentity(xf)) { paintDemoFrame(g, t, x, y, w, h); return; }
  const k = Math.min(4, Math.max(1, Math.max(w, h) / Math.min(xf.crop.w * DEMO_META.width, xf.crop.h * DEMO_META.height)));
  const sw = Math.round(DEMO_META.width * k), sh = Math.round(DEMO_META.height * k);
  const c = scratch?.c ?? document.createElement('canvas');
  if (scratch) scratch.c = c;
  if (c.width !== sw || c.height !== sh) { c.width = sw; c.height = sh; }
  const sg = c.getContext('2d');
  if (!sg) return;
  paintDemoFrame(sg, t, 0, 0, sw, sh);
  drawClipFrame(g, c, sw, sh, xf, x, y, w, h);
}

/** The test clip, painted at any time. */
export function demoReader(): FrameReader {
  const scratch: { c?: HTMLCanvasElement } = {};
  return { draw: async (t, g, x, y, w, h, _signal, xf) => paintDemoFrameXf(g, t, xf, x, y, w, h, scratch), close: () => {} };
}

/** A video, seeked frame by frame (as decodeVideoFrames). */
export async function openVideoReader(blob: Blob): Promise<FrameReader> {
  const url = URL.createObjectURL(blob);
  const el = videoElement(url);
  if (!(await waitFor(el, 'loadeddata', 20_000))) { release(el, url); throw new Error('This video could not be opened here.'); }
  return {
    async draw(time, g, x, y, w, h, signal, xf) {
      if (signal.aborted) throw new TimeCubeCancelled();
      const t = Math.min(time, Math.max(0, (Number.isFinite(el.duration) ? el.duration : time) - 1e-3));
      if (Math.abs(el.currentTime - t) > 1e-4 || el.readyState < 2) {
        const seeked = waitFor(el, 'seeked', 5000);
        el.currentTime = t;
        await seeked;
        if (el.readyState < 2) await waitFor(el, 'loadeddata', 2000);
      }
      if (signal.aborted) throw new TimeCubeCancelled();
      if (xf) drawClipFrame(g, el, el.videoWidth, el.videoHeight, xf, x, y, w, h);
      else g.drawImage(el, x, y, w, h);
    },
    close: () => release(el, url),
  };
}

/** Paint every planned frame of the test clip into the atlas. Yields to the page now and then. */
export async function paintDemoFrames(plan: StackPlan, ctx: CanvasRenderingContext2D, onFrame: (done: number) => void, signal: AbortSignal): Promise<void> {
  const scratch: { c?: HTMLCanvasElement } = {};
  for (let i = 0; i < plan.frames; i++) {
    if (signal.aborted) throw new TimeCubeCancelled();
    const { x, y } = tileOrigin(plan, i);
    paintDemoFrameXf(ctx, plan.times[i], plan.xf, x, y, plan.tileW, plan.tileH, scratch);
    onFrame(i + 1);
    if (i % 16 === 15) await new Promise(r => setTimeout(r, 0));
  }
}
