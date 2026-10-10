/**
 * regionValues.ts — a region of the graph (agentBuilder/where.ts) evaluated on the GPU, for the
 * Where picker's thumbnails, the region shaded over the live picture, and a slope field's arrows.
 *
 * The region's chain (the node and everything upstream) is compiled as a node preview
 * (compileNodePreviewGraph) with its raw value written to a float target the picture's shape
 * (nodePreviewRenderer.renderValues), so a shape's distance keeps its sign and a mask its level.
 * Results are cached by the shader and its uniforms; a texture (a Pass, a Trail) has no chain to
 * run here and gives null.
 */
import * as THREE from 'three';
import type { GraphNode } from '../types/nodeGraph';
import { compileNodePreviewGraph } from './compileNodePreviewShader';
import { nodePreviewRenderer } from './nodePreviewRenderer';
import { inject } from './nodePreview/previewGlsl';
import { uniformsOf } from '../components/explain/buildUpHost';

export interface RegionField { data: Float32Array; w: number; h: number }

const cache = new Map<string, RegionField | null>();
const pending = new Map<string, Promise<RegionField | null>>();

function djb2(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h) ^ s.charCodeAt(i);
  return h >>> 0;
}

/** The raw value of `nodeId`'s `outputKey` at w × h points over the picture (row 0 at the bottom); null when it can't run here. */
export function regionField(nodes: readonly GraphNode[], nodeId: string, outputKey: string, w: number, h: number): Promise<RegionField | null> {
  const nd = nodes.find(x => x.id === nodeId);
  if (!nd || nd.outputs[outputKey]?.type !== 'float') return Promise.resolve(null);
  let compiled;
  try { compiled = compileNodePreviewGraph(nodeId, nodes as GraphNode[]); } catch { compiled = null; }
  const v = compiled?.nodeOutputVars.get(nodeId)?.[outputKey];
  if (!compiled || !v) return Promise.resolve(null);
  const fs = inject(compiled.fragmentShader, '', `  gl_FragColor = vec4(float(${v}), 0.0, 0.0, 1.0);`);
  if (!fs) return Promise.resolve(null);
  const key = `${djb2(fs)}|${w}x${h}|${JSON.stringify(compiled.paramUniforms)}`;
  if (cache.has(key)) return Promise.resolve(cache.get(key)!);
  const was = pending.get(key);
  if (was) return was;
  const p = nodePreviewRenderer.renderValues(fs, { ...uniformsOf(compiled.paramUniforms), u_time: { value: 0 }, u_resolution: { value: new THREE.Vector2(w, h) } }, w, h, 1)
    .then(r => {
      const f = r?.fields[0];
      const out: RegionField | null = f ? { data: Float32Array.from({ length: w * h }, (_, i) => f[i * 4]), w, h } : null;
      cache.set(key, out);
      if (cache.size > 64) cache.delete(cache.keys().next().value!);
      pending.delete(key);
      return out;
    }, () => { pending.delete(key); return null; });
  pending.set(key, p);
  return p;
}

/** Inside the region at a value? (a distance below 0; a mask above ½) */
export const insideAt = (kind: 'shape' | 'mask', v: number) => (kind === 'shape' ? v < 0 : v > 0.5);

/** The value at a picture point (x ±aspect, y ±1), nearest sample; NaN off the picture. */
export function fieldAt(f: RegionField, x: number, y: number, aspect: number): number {
  const u = (x / aspect) * 0.5 + 0.5, v = y * 0.5 + 0.5;
  if (u < 0 || u > 1 || v < 0 || v > 1) return NaN;
  const i = Math.min(f.w - 1, Math.floor(u * f.w)), j = Math.min(f.h - 1, Math.floor(v * f.h));
  return f.data[j * f.w + i];
}

/**
 * A picture of the region (a data URL, top row first): `thumb` draws inside in the accent over a
 * dark ground (a mask's level as grey); `shade` darkens where a card does nothing (outside, or
 * inside when `outside`) and lines the edge, transparent elsewhere, to lay over the live picture.
 */
export function regionImage(f: RegionField, kind: 'shape' | 'mask', mode: 'thumb' | 'shade', o: { accent?: [number, number, number]; outside?: boolean } = {}): string {
  if (typeof document === 'undefined') return '';
  const c = document.createElement('canvas');
  c.width = f.w; c.height = f.h;
  const ctx = c.getContext('2d');
  if (!ctx) return '';
  const img = ctx.createImageData(f.w, f.h);
  const [ar, ag, ab] = o.accent ?? [58, 111, 247];
  const at = (i: number, j: number) => insideAt(kind, f.data[Math.min(f.h - 1, Math.max(0, j)) * f.w + Math.min(f.w - 1, Math.max(0, i))]);
  for (let y = 0; y < f.h; y++) {
    const j = f.h - 1 - y;
    for (let i = 0; i < f.w; i++) {
      const v = f.data[j * f.w + i];
      const inside = insideAt(kind, v);
      const edge = inside !== at(i + 1, j) || inside !== at(i, j + 1) || inside !== at(i - 1, j) || inside !== at(i, j - 1);
      const k = (y * f.w + i) * 4;
      if (mode === 'thumb') {
        const g = kind === 'mask' ? 30 + Math.max(0, Math.min(1, v)) * 60 : 26 + 10 * (0.5 + 0.5 * Math.cos(Math.min(Math.abs(v), 1) * 40));
        const px = edge ? [235, 240, 255] : inside ? [ar * 0.75 + g * 0.25, ag * 0.75 + g * 0.25, ab * 0.75 + g * 0.25] : [g, g, g + 4];
        img.data.set([px[0], px[1], px[2], 255], k);
      } else {
        const idle = o.outside ? inside : !inside;
        img.data.set(idle ? [8, 8, 12, 150] : [0, 0, 0, 0], k);
      }
    }
  }
  ctx.putImageData(img, 0, 0);
  return c.toDataURL('image/png');
}

/**
 * The region's edge as line segments (marching squares on the values, interpolated), each end in
 * 0–1 of the picture across and down (top 0): a smooth outline to draw over the picture.
 */
export function regionEdge(f: RegionField, kind: 'shape' | 'mask'): Array<[number, number, number, number]> {
  const lvl = kind === 'shape' ? 0 : 0.5;
  const v = (i: number, j: number) => f.data[j * f.w + i] - lvl;
  const out: Array<[number, number, number, number]> = [];
  const X = (i: number) => (i + 0.5) / f.w, Y = (j: number) => 1 - (j + 0.5) / f.h;
  for (let j = 0; j < f.h - 1; j++) for (let i = 0; i < f.w - 1; i++) {
    const a = v(i, j), b = v(i + 1, j), c = v(i + 1, j + 1), d = v(i, j + 1);
    const pts: Array<[number, number]> = [];
    const cross = (p: number, q: number, x0: number, y0: number, x1: number, y1: number) => {
      if ((p < 0) === (q < 0)) return;
      const t = p / (p - q);
      pts.push([x0 + (x1 - x0) * t, y0 + (y1 - y0) * t]);
    };
    cross(a, b, X(i), Y(j), X(i + 1), Y(j));
    cross(b, c, X(i + 1), Y(j), X(i + 1), Y(j + 1));
    cross(c, d, X(i + 1), Y(j + 1), X(i), Y(j + 1));
    cross(d, a, X(i), Y(j + 1), X(i), Y(j));
    if (pts.length >= 2) out.push([pts[0][0], pts[0][1], pts[1][0], pts[1][1]]);
    if (pts.length === 4) out.push([pts[2][0], pts[2][1], pts[3][0], pts[3][1]]);
  }
  return out;
}

/**
 * The slope of a field (a region's raw values) at grid points: which way is downhill, unit length
 * times how steep it is relative to the steepest (0–1). For drawing a slope layer's arrows.
 */
export function slopeArrows(f: RegionField, aspect: number, cols = 16): Array<{ x: number; y: number; dx: number; dy: number; k: number }> {
  const rows = Math.max(2, Math.round(cols / aspect));
  const val = (i: number, j: number) => f.data[Math.min(f.h - 1, Math.max(0, j)) * f.w + Math.min(f.w - 1, Math.max(0, i))];
  const out: Array<{ x: number; y: number; dx: number; dy: number; k: number }> = [];
  let max = 1e-9;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const u = (c + 0.5) / cols, v = (r + 0.5) / rows;
    const i = Math.floor(u * f.w), j = Math.floor(v * f.h);
    const gx = (val(i + 1, j) - val(i - 1, j)) / (2 * 2 * aspect / f.w);
    const gy = (val(i, j + 1) - val(i, j - 1)) / (2 * 2 / f.h);
    const m = Math.hypot(gx, gy);
    if (!isFinite(m)) continue;
    max = Math.max(max, m);
    out.push({ x: (u * 2 - 1) * aspect, y: v * 2 - 1, dx: m > 1e-9 ? -gx / m : 0, dy: m > 1e-9 ? -gy / m : 0, k: m });
  }
  return out.map(a => ({ ...a, k: Math.min(1, a.k / max) }));
}
