/**
 * overlay.ts — the app's host for the layer kit (play/kit/kit.js): it owns
 * the 2D canvas over the WebGL canvas, feeds the kit the pointer, live audio,
 * the camera and images each frame, and passes back what the layers measure
 * (sensors) and where following nulls are, to the Play engine.
 *
 * Right after ShaderCanvas draws a frame it calls `draw(glCanvas, time, dt)`:
 * the picture is still in the GL drawing buffer, so the kit can read it for
 * mattes, particles, glyphs and contours.
 *
 * Pointer: drag null markers (always) and shapes (while the Layers tab is
 * open); draw a polygon or a lasso for a shape; a click on a shape is its
 * zone trigger. Everything else passes through. Module singleton, no React.
 */

import type { PlayLayer, PlayRecord } from '../types/play';
import { emptyPlayRecord } from '../types/play';
import { playEngine } from '../lib/playEngine';
import { liveAudio } from '../lib/liveAudio';
import { cameraInput } from '../lib/cameraInput';
import { createLayerKit, type KitEnv, type KitPointer, type LayerKit } from './kit/kit.js';

export type LayerWriter = (layerId: string, patch: Partial<PlayLayer>) => void;
export type { ShaderTap } from './kit/kit.js';
import type { ShaderTap } from './kit/kit.js';

/** Drawing a shape's outline on the picture: click corners (polygon) or drag freehand (lasso). */
export interface ShapeDrawing { layerId: string; mode: 'polygon' | 'lasso'; pts: number[] }

class PlayOverlay {
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private record: PlayRecord = emptyPlayRecord();
  private writer: LayerWriter | null = null;
  private images = new Map<string, HTMLImageElement>();
  private kit: LayerKit = createLayerKit();
  private pointer: KitPointer = { x: 0.5, y: 0.5, over: false, down: false };
  private drag: { id: string; dx: number; dy: number } | null = null;
  private pressedZone: string | null = null;
  private editing = false;
  private selectedId = '';
  private drawing: ShapeDrawing | null = null;
  private drawingListeners = new Set<(d: ShapeDrawing | null) => void>();
  private aspect = 16 / 9;
  private composite: HTMLCanvasElement | null = null;
  private shaderTap: ((tap: ShaderTap) => void) | null = null;

  constructor() {
    playEngine.onAction(a => this.kit.act({ do: a.do, layerId: a.layerId, amount: a.amount }));
  }

  setCanvas(el: HTMLCanvasElement | null): void {
    this.canvas = el;
    this.ctx = el ? el.getContext('2d') : null;
  }

  setRecord(record: PlayRecord): void { this.record = record; }

  /** Fire an action now (the panel's Burst / Drop / Next / Clear buttons). */
  act(a: { do: import('../types/play').ActionKind; layerId: string; amount: number }): void { this.kit.act(a); }

  /** Where drags and drawn shapes go (the store's setPlay). */
  setWriter(fn: LayerWriter | null): void { this.writer = fn; }

  /** The Layers tab is open: shapes can be dragged and invisible zones are outlined. */
  setEditing(on: boolean, selectedId = ''): void { this.editing = on; this.selectedId = selectedId; }

  /** The graph's Layers node reads what the layers draw: receive it after every frame (null = off). */
  setShaderTap(fn: ((tap: ShaderTap) => void) | null): void { this.shaderTap = fn; }

  hasLayers(): boolean { return this.record.layers.some(l => l.visible) || this.record.display?.picture === false; }

  /** Anything moving on its own keeps the render loop running. */
  isAnimated(): boolean { return this.kit.isAnimated(this.record) || !!this.drawing; }

  // ── Drawing a shape outline ────────────────────────────────────────────────

  startDrawing(layerId: string, mode: 'polygon' | 'lasso'): void { this.drawing = { layerId, mode, pts: [] }; this.emitDrawing(); }
  cancelDrawing(): void { this.drawing = null; this.emitDrawing(); }
  onDrawing(cb: (d: ShapeDrawing | null) => void): () => void { this.drawingListeners.add(cb); return () => { this.drawingListeners.delete(cb); }; }
  private emitDrawing(): void { for (const cb of this.drawingListeners) cb(this.drawing); }

  /** Close the drawn outline into the shape: centred on its points, corners relative to the centre in picture heights. */
  finishDrawing(): void {
    const d = this.drawing;
    this.drawing = null;
    this.emitDrawing();
    if (!d || d.pts.length < 6 || !this.writer) return;
    let cx = 0, cy = 0, minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    const n = d.pts.length / 2;
    for (let i = 0; i < d.pts.length; i += 2) { cx += d.pts[i]; cy += d.pts[i + 1]; }
    cx /= n; cy /= n;
    const points: number[] = [];
    for (let i = 0; i < d.pts.length; i += 2) {
      const px = (d.pts[i] - cx) * this.aspect, py = d.pts[i + 1] - cy;
      points.push(Math.round(px * 1e4) / 1e4, Math.round(py * 1e4) / 1e4);
      minX = Math.min(minX, px); maxX = Math.max(maxX, px); minY = Math.min(minY, py); maxY = Math.max(maxY, py);
    }
    this.writer(d.layerId, { shape: 'polygon', x: cx, y: cy, rotation: 0, points, w: Math.max(0.01, maxX - minX), h: Math.max(0.01, maxY - minY) } as Partial<PlayLayer>);
  }

  // ── Pointer ────────────────────────────────────────────────────────────────

  /** Listen on the picture's container. Presses on markers, shapes (while editing) and drawings are taken; the rest pass through. */
  attachPointer(container: HTMLElement): () => void {
    const toUnit = (e: PointerEvent) => {
      const r = container.getBoundingClientRect();
      return { x: (e.clientX - r.left) / Math.max(1, r.width), y: 1 - (e.clientY - r.top) / Math.max(1, r.height), w: r.width, h: r.height };
    };
    const value = (l: PlayLayer, k: string) => playEngine.layerValue(l.id, k, (l as unknown as Record<string, number>)[k]);
    const hitNull = (u: { x: number; y: number; w: number; h: number }): PlayLayer | null => {
      let best: PlayLayer | null = null, bestD = Infinity;
      for (const l of this.record.layers) {
        if (l.kind !== 'null' || !l.visible) continue;
        const d = Math.hypot((u.x - value(l, 'x')) * u.w, (u.y - value(l, 'y')) * u.h);
        if (d <= Math.max(l.size, 10) + 6 && d < bestD) { best = l; bestD = d; }
      }
      return best;
    };
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const u = toUnit(e);
      this.pointer.down = true;
      const d = this.drawing;
      if (d) {
        if (d.mode === 'polygon') {
          // Near the first corner (with three or more) closes it.
          if (d.pts.length >= 6 && Math.hypot((u.x - d.pts[0]) * u.w, (u.y - d.pts[1]) * u.h) < 12) this.finishDrawing();
          else { d.pts.push(u.x, u.y); this.emitDrawing(); }
        } else { d.pts = [u.x, u.y]; }
        e.preventDefault(); e.stopPropagation();
        return;
      }
      const n = this.writer ? hitNull(u) : null;
      if (n) {
        this.drag = { id: n.id, dx: value(n, 'x') - u.x, dy: value(n, 'y') - u.y };
      } else {
        const id = this.kit.shapeAt(this.record, u.x, u.y, u.w / Math.max(1, u.h), value);
        if (id && this.editing && this.writer) {
          const l = this.record.layers.find(x => x.id === id)!;
          this.drag = { id, dx: value(l, 'x') - u.x, dy: value(l, 'y') - u.y };
        } else if (id) {
          this.pressedZone = id;
          playEngine.pressZone(id);
          return;
        } else return;
      }
      container.setPointerCapture?.(e.pointerId);
      e.preventDefault(); e.stopPropagation();
    };
    const onMove = (e: PointerEvent) => {
      const u = toUnit(e);
      this.pointer.x = u.x; this.pointer.y = u.y; this.pointer.over = u.x >= 0 && u.x <= 1 && u.y >= 0 && u.y <= 1;
      const d = this.drawing;
      if (d && d.mode === 'lasso' && this.pointer.down && d.pts.length >= 2) {
        const lx = d.pts[d.pts.length - 2], ly = d.pts[d.pts.length - 1];
        if (Math.hypot((u.x - lx) * u.w, (u.y - ly) * u.h) > 6 && d.pts.length < 400) { d.pts.push(u.x, u.y); }
        e.preventDefault(); e.stopPropagation();
        return;
      }
      if (this.drag) {
        this.writer?.(this.drag.id, { x: Math.max(0, Math.min(1, u.x + this.drag.dx)), y: Math.max(0, Math.min(1, u.y + this.drag.dy)) } as Partial<PlayLayer>);
        e.preventDefault(); e.stopPropagation();
        return;
      }
      if (this.drawing) { container.style.cursor = 'crosshair'; return; }
      const overNull = hitNull(u);
      const overShape = !overNull && this.editing ? this.kit.shapeAt(this.record, u.x, u.y, u.w / Math.max(1, u.h), value) : null;
      container.style.cursor = overNull || overShape ? 'grab' : '';
    };
    const onUp = () => {
      this.pointer.down = false;
      this.drag = null;
      if (this.pressedZone) { playEngine.releaseZone(this.pressedZone); this.pressedZone = null; }
      if (this.drawing?.mode === 'lasso' && this.drawing.pts.length >= 6) this.finishDrawing();
    };
    const onLeave = () => { this.pointer.over = false; };
    const onDbl = (e: MouseEvent) => { if (this.drawing?.mode === 'polygon') { e.preventDefault(); this.finishDrawing(); } };
    const onKey = (e: KeyboardEvent) => {
      if (!this.drawing) return;
      if (e.key === 'Enter') { e.preventDefault(); this.finishDrawing(); }
      else if (e.key === 'Escape') { e.preventDefault(); this.cancelDrawing(); }
    };
    container.addEventListener('pointerdown', onDown, true);
    container.addEventListener('pointermove', onMove, true);
    container.addEventListener('pointerup', onUp, true);
    container.addEventListener('pointercancel', onUp, true);
    container.addEventListener('pointerleave', onLeave);
    container.addEventListener('dblclick', onDbl, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      container.removeEventListener('pointerdown', onDown, true);
      container.removeEventListener('pointermove', onMove, true);
      container.removeEventListener('pointerup', onUp, true);
      container.removeEventListener('pointercancel', onUp, true);
      container.removeEventListener('pointerleave', onLeave);
      container.removeEventListener('dblclick', onDbl, true);
      window.removeEventListener('keydown', onKey, true);
      container.style.cursor = '';
    };
  }

  // ── Drawing ────────────────────────────────────────────────────────────────

  private env(gl: HTMLCanvasElement, W: number, H: number, dpr: number, time: number, dt: number, forExport = false): KitEnv {
    const needsAudio = this.record.layers.some(l => l.kind === 'audio' && l.visible);
    return {
      gl, W, H, dpr, time, dt,
      value: (l, k) => playEngine.layerValue(l.id, k, (l as unknown as Record<string, number>)[k]),
      pointer: this.pointer,
      markers: !forExport,
      editing: this.editing && !forExport,
      selectedId: this.selectedId,
      hidden: this.record.display?.picture === false,
      backdrop: this.record.display?.backdrop ?? [0, 0, 0],
      audio: needsAudio ? liveAudio.raw() : null,
      camera: cameraInput.element(),
      image: src => this.image(src),
      sensor: forExport ? () => {} : (k, v) => playEngine.setSensor(k, v),
      override: forExport ? () => {} : (id, k, v) => playEngine.setOverride(id, k, v),
      shaderTap: forExport ? undefined : this.shaderTap ?? undefined,
    };
  }

  draw(gl: HTMLCanvasElement, time: number, dt: number): void {
    const canvas = this.canvas, ctx = this.ctx;
    if (!canvas || !ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = Math.max(1, Math.round(gl.clientWidth * dpr)), H = Math.max(1, Math.round(gl.clientHeight * dpr));
    if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
    this.aspect = W / H;
    playEngine.setAspect(this.aspect);
    this.kit.frame(ctx, this.record, this.env(gl, W, H, dpr, time, dt));
    if (this.drawing) this.drawOutline(ctx, W, H, dpr);
    if (this.composite) {
      const c = this.composite;
      if (c.width !== gl.width || c.height !== gl.height) { c.width = gl.width; c.height = gl.height; }
      const x = c.getContext('2d')!;
      x.drawImage(gl, 0, 0);
      x.drawImage(canvas, 0, 0, c.width, c.height);
    }
  }

  private drawOutline(ctx: CanvasRenderingContext2D, W: number, H: number, dpr: number): void {
    const d = this.drawing!;
    if (d.pts.length < 2) return;
    ctx.save();
    ctx.strokeStyle = '#5b8cff'; ctx.fillStyle = 'rgba(91,140,255,0.15)'; ctx.lineWidth = 2 * dpr; ctx.setLineDash([6 * dpr, 4 * dpr]);
    ctx.beginPath();
    for (let i = 0; i < d.pts.length; i += 2) { const x = d.pts[i] * W, y = (1 - d.pts[i + 1]) * H; if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); }
    if (d.mode === 'polygon' && this.pointer.over) ctx.lineTo(this.pointer.x * W, (1 - this.pointer.y) * H);
    ctx.fill(); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = '#5b8cff';
    for (let i = 0; i < d.pts.length && d.mode === 'polygon'; i += 2) { ctx.beginPath(); ctx.arc(d.pts[i] * W, (1 - d.pts[i + 1]) * H, 4 * dpr, 0, Math.PI * 2); ctx.fill(); }
    ctx.restore();
  }

  // ── Recording with the layers ──────────────────────────────────────────────

  /** A canvas holding picture + layers, updated every drawn frame until stopCompositing(). Record this instead of the GL canvas. */
  startCompositing(gl: HTMLCanvasElement): HTMLCanvasElement {
    if (!this.composite) this.composite = document.createElement('canvas');
    // Sized now: a recorder started on a canvas that later changes size can fail.
    this.composite.width = gl.width; this.composite.height = gl.height;
    return this.composite;
  }

  /** Picture + layers as they are now, for a screenshot. */
  snapshot(gl: HTMLCanvasElement): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = gl.width; c.height = gl.height;
    const x = c.getContext('2d')!;
    x.drawImage(gl, 0, 0);
    if (this.canvas) x.drawImage(this.canvas, 0, 0, c.width, c.height);
    return c;
  }
  stopCompositing(): void { this.composite = null; }

  private exportKit: LayerKit | null = null;
  private exportCanvas: HTMLCanvasElement | null = null;
  private exportPicture: HTMLCanvasElement | null = null;

  /**
   * Offline export (FFmpeg path): lay the layers over one read-back frame, in
   * place. A fresh kit starts with the export so particles run the same way
   * every time (with a seed set) and the live preview's state is untouched.
   */
  compositePixels(rgba: Uint8Array, width: number, height: number, time: number, dt: number, first: boolean): void {
    if (!this.hasLayers()) return;
    if (first || !this.exportKit) this.exportKit = createLayerKit();
    const pic = this.exportPicture ?? (this.exportPicture = document.createElement('canvas'));
    const out = this.exportCanvas ?? (this.exportCanvas = document.createElement('canvas'));
    for (const c of [pic, out]) if (c.width !== width || c.height !== height) { c.width = width; c.height = height; }
    const px = pic.getContext('2d', { willReadFrequently: true })!;
    const img = px.createImageData(width, height); img.data.set(rgba); px.putImageData(img, 0, 0);
    const ox = out.getContext('2d')!;
    const dpr = Math.max(1, height / Math.max(1, this.canvas?.clientHeight || height));
    this.exportKit.frame(ox, this.record, this.env(pic, width, height, dpr, time, dt, true));
    px.drawImage(out, 0, 0);
    rgba.set(px.getImageData(0, 0, width, height).data);
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private image(src: string): HTMLImageElement | null {
    if (!src) return null;
    let img = this.images.get(src);
    if (!img) {
      img = new Image();
      img.src = src;
      this.images.set(src, img);
      if (this.images.size > 16) { const first = this.images.keys().next().value; if (first && first !== src) this.images.delete(first); }
    }
    return img.complete && img.naturalWidth > 0 ? img : null;
  }
}

export const playOverlay = new PlayOverlay();
