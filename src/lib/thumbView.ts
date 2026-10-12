/**
 * How a Pass or Data Texture thumbnail is shown (lib/passRunner.ts drawThumbnails; docs/data-texture.md,
 * "Preview"). A card's canvas carries its view in its dataset:
 *
 *  - `view`: Raw (the stored colour, clipped to 0…1), Range (each channel from Min…Max to black…white,
 *    so negative and large numbers show), Channels (r, g, b, a side by side, each from Min…Max),
 *    Arrows (r g as a vector field: an arrow per cell over its length in grey);
 *  - `lo` / `hi`: Min…Max for Range, Channels and Arrows;
 *  - `w`: the picture's width in pixels (128 on a card, more in the big view);
 *  - `probe`: `x,y` (0…1, from the bottom left) of a texel to read at full precision; the runner
 *    writes it back as `probeValue` (`r,g,b,a`).
 */
import * as THREE from 'three';

export const THUMB_MODES = ['raw', 'range', 'channels', 'arrows'] as const;
export type ThumbMode = typeof THUMB_MODES[number];

/** The big view's canvas key: the node id with a suffix, so a card and its window both draw. */
export const bigThumbKey = (nodeId: string) => `${nodeId}#big`;

export interface ThumbView { mode: ThumbMode; lo: number; hi: number; width: number; probe: [number, number] | null }

export function thumbViewOf(d: DOMStringMap): ThumbView {
  const mode = (THUMB_MODES as readonly string[]).includes(d.view ?? '') ? (d.view as ThumbMode) : 'raw';
  const lo = Number.isFinite(Number(d.lo)) && d.lo !== undefined ? Number(d.lo) : 0;
  const hi = Number.isFinite(Number(d.hi)) && d.hi !== undefined ? Number(d.hi) : 1;
  const width = Math.max(32, Math.min(1024, Math.round(Number(d.w) || 128)));
  const pr = (d.probe ?? '').split(',').map(Number);
  const probe = pr.length === 2 && pr.every(v => Number.isFinite(v) && v >= 0 && v <= 1) ? (pr as [number, number]) : null;
  return { mode, lo, hi: hi === lo ? lo + 1 : hi, width, probe };
}

/** The thumbnail shader: one texture, drawn by the view's mode. */
export const THUMB_FS = `precision highp float;
uniform sampler2D t;
uniform float mode, lo, hi;
varying vec2 vUv;
vec4 rng(vec4 v) { return clamp((v - lo) / (hi - lo), 0.0, 1.0); }
void main() {
  if (mode < 0.5) { vec4 c = texture2D(t, vUv); gl_FragColor = vec4(clamp(c.rgb, 0.0, 1.0), 1.0); return; }
  if (mode < 1.5) { gl_FragColor = vec4(rng(texture2D(t, vUv)).rgb, 1.0); return; }
  if (mode < 2.5) {
    // r g b a side by side, each a grey from Min…Max with its channel's tint.
    float i = floor(vUv.x * 4.0);
    vec4 c = rng(texture2D(t, vec2(fract(vUv.x * 4.0), vUv.y)));
    float v = i < 0.5 ? c.r : i < 1.5 ? c.g : i < 2.5 ? c.b : c.a;
    vec3 tint = i < 0.5 ? vec3(1.0, 0.55, 0.5) : i < 1.5 ? vec3(0.55, 1.0, 0.6) : i < 2.5 ? vec3(0.55, 0.7, 1.0) : vec3(1.0);
    gl_FragColor = vec4(v * tint, 1.0);
    return;
  }
  // Arrows: r g from Min…Max into 0…1 (the canvas draws the arrows from them).
  gl_FragColor = vec4(rng(texture2D(t, vUv)).rg, 0.0, 1.0);
}`;

/**
 * Arrows: the read-back r g (Min…Max as 0…1) become vectors again. The picture is their length as a
 * dim grey, with an arrow per cell, as long as the vector is against the larger of |Min| and |Max|.
 */
export function drawArrows(ctx: CanvasRenderingContext2D, img: ImageData, view: ThumbView): void {
  const { width: W, height: H, data } = img;
  const span = view.hi - view.lo, scale = Math.max(Math.abs(view.lo), Math.abs(view.hi)) || 1;
  const vec = (i: number): [number, number] => [view.lo + (data[i] / 255) * span, view.lo + (data[i + 1] / 255) * span];
  const bg = ctx.createImageData(W, H);
  for (let i = 0; i < data.length; i += 4) {
    const [x, y] = vec(i);
    const g = Math.min(1, Math.hypot(x, y) / scale) * 70;
    bg.data[i] = g; bg.data[i + 1] = g; bg.data[i + 2] = g + 10; bg.data[i + 3] = 255;
  }
  ctx.putImageData(bg, 0, 0);
  const cell = Math.max(8, Math.round(W / 16));
  ctx.strokeStyle = 'rgba(140, 200, 255, 0.95)';
  ctx.lineWidth = Math.max(1, W / 256);
  ctx.beginPath();
  for (let cy = cell / 2; cy < H; cy += cell) {
    for (let cx = cell / 2; cx < W; cx += cell) {
      const [x, y] = vec((Math.floor(cy) * W + Math.floor(cx)) * 4);
      const len = Math.min(1, Math.hypot(x, y) / scale) * cell * 0.9;
      if (len < 0.5) continue;
      const a = Math.atan2(-y, x); // canvas y points down
      const ex = cx + Math.cos(a) * len, ey = cy + Math.sin(a) * len;
      ctx.moveTo(cx, cy); ctx.lineTo(ex, ey);
      const h = Math.min(len * 0.4, cell * 0.3);
      ctx.moveTo(ex, ey); ctx.lineTo(ex - Math.cos(a - 0.5) * h, ey - Math.sin(a - 0.5) * h);
      ctx.moveTo(ex, ey); ctx.lineTo(ex - Math.cos(a + 0.5) * h, ey - Math.sin(a + 0.5) * h);
    }
  }
  ctx.stroke();
}

/** One texel of a render target at full precision (8-bit, half or full float), as four numbers. */
export function readTexel(renderer: THREE.WebGLRenderer, rt: THREE.WebGLRenderTarget, u: number, v: number): number[] {
  const x = Math.min(rt.width - 1, Math.max(0, Math.floor(u * rt.width)));
  const y = Math.min(rt.height - 1, Math.max(0, Math.floor(v * rt.height)));
  const type = rt.texture.type;
  try {
    if (type === THREE.FloatType) {
      const b = new Float32Array(4);
      renderer.readRenderTargetPixels(rt, x, y, 1, 1, b);
      return [...b];
    }
    if (type === THREE.HalfFloatType) {
      const b = new Uint16Array(4);
      renderer.readRenderTargetPixels(rt, x, y, 1, 1, b);
      return [...b].map(h => THREE.DataUtils.fromHalfFloat(h));
    }
    const b = new Uint8Array(4);
    renderer.readRenderTargetPixels(rt, x, y, 1, 1, b);
    return [...b].map(c => c / 255);
  } catch {
    return [NaN, NaN, NaN, NaN];
  }
}
