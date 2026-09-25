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
import { layerAudio } from '../lib/layerAudio';
import { cameraInput } from '../lib/cameraInput';
import { createLayerKit, type KitEnv, type KitPointer, type LayerKit } from './kit/kit.js';
import { klFontFor } from './kit/layers.js';
import { dragHandle, handleAt, handlePoints, insideBounds, layerBounds, outlinePoints, patchFor, type Bounds, type Handle } from './transform';

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
  private drag: { id: string; dx: number; dy: number } | { id: string; handle: Handle; start: Bounds; layer: PlayLayer } | null = null;
  private selectListeners = new Set<(id: string) => void>();
  private menuListeners = new Set<(m: { layerId: string; x: number; y: number }) => void>();
  private measure: CanvasRenderingContext2D | null = null;
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

  /** A layer picked on the picture (a click while editing). Returns an unsubscribe. */
  onSelect(cb: (id: string) => void): () => void { this.selectListeners.add(cb); return () => { this.selectListeners.delete(cb); }; }
  /** A right-click on a layer: its id and where (page pixels). Returns an unsubscribe. */
  onContextMenu(cb: (m: { layerId: string; x: number; y: number }) => void): () => void { this.menuListeners.add(cb); return () => { this.menuListeners.delete(cb); }; }

  // ── Bounds and handles ─────────────────────────────────────────────────────

  private value = (l: PlayLayer, k: string) => playEngine.layerValue(l.id, k, (l as unknown as Record<string, number>)[k]);

  /** A layer's box on the picture (see transform.ts), or null for layers without one. */
  bounds(l: PlayLayer): Bounds | null {
    return layerBounds(l, this.value, {
      textWidth: (layer, line) => {
        const m = this.measure ?? (this.measure = document.createElement('canvas').getContext('2d'));
        if (!m) return line.length * 0.55;
        const t = layer as PlayLayer & { weight?: number };
        m.font = `${t.weight ?? 700} 100px ${klFontFor(layer as unknown as { font?: string; fontUrl?: string })}`;
        return m.measureText(line).width / 100;
      },
      mediaAspect: layer => {
        if (layer.kind === 'image') { const img = this.image(layer.src); return img ? img.naturalWidth / Math.max(1, img.naturalHeight) : 0; }
        if (layer.kind === 'camera') { const v = cameraInput.element(); return v && v.videoWidth ? v.videoWidth / Math.max(1, v.videoHeight) : 0; }
        return 0;
      },
    });
  }

  /** The top-most layer under a point: nulls first, then anything with a box, then shapes' own outlines. */
  private layerAt(u: { x: number; y: number; w: number; h: number }): PlayLayer | null {
    const layers = this.record.layers;
    for (let i = layers.length - 1; i >= 0; i--) {
      const l = layers[i];
      if (l.kind !== 'null' || !l.visible) continue;
      if (Math.hypot((u.x - this.value(l, 'x')) * u.w, (u.y - this.value(l, 'y')) * u.h) <= Math.max(l.size, 10) + 6) return l;
    }
    const px = u.x * u.w, py = (1 - u.y) * u.h;
    for (let i = layers.length - 1; i >= 0; i--) {
      const l = layers[i];
      if (!l.visible || l.kind === 'shape') continue;
      const b = this.bounds(l);
      if (b && insideBounds(b, px, py, u.w, u.h)) return l;
    }
    const id = this.kit.shapeAt(this.record, u.x, u.y, u.w / Math.max(1, u.h), this.value);
    return id ? this.record.layers.find(x => x.id === id) ?? null : null;
  }

  private drawHandles(ctx: CanvasRenderingContext2D, W: number, H: number, dpr: number): void {
    const l = this.record.layers.find(x => x.id === this.selectedId);
    const b = l && l.visible ? this.bounds(l) : null;
    if (!b) return;
    const cw = W / dpr, ch = H / dpr;
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(91,140,255,0.9)'; ctx.setLineDash([4, 3]);
    const o = outlinePoints(b, cw, ch);
    ctx.beginPath(); o.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); ctx.stroke();
    ctx.setLineDash([]);
    for (const p of handlePoints(b, cw, ch)) {
      ctx.fillStyle = '#fff'; ctx.strokeStyle = '#5b8cff'; ctx.lineWidth = 1.5;
      ctx.beginPath();
      if (p.handle.kind === 'rotate') {
        // A stem from the middle of the top edge.
        const [a, c] = o;
        ctx.moveTo((a[0] + c[0]) / 2, (a[1] + c[1]) / 2); ctx.lineTo(p.x, p.y); ctx.stroke();
        ctx.beginPath(); ctx.arc(p.x, p.y, 4.5, 0, Math.PI * 2);
      } else ctx.rect(p.x - 4, p.y - 4, 8, 8);
      ctx.fill(); ctx.stroke();
    }
    ctx.restore();
  }

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
    // Touch: holding still on a layer for a moment opens its menu (phones have no right-click).
    let hold: { timer: number; x: number; y: number } | null = null;
    const cancelHold = () => { if (hold) { window.clearTimeout(hold.timer); hold = null; } };
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const u = toUnit(e);
      cancelHold();
      if (e.pointerType === 'touch' && !this.drawing && this.menuListeners.size) {
        const hit = this.layerAt(u);
        if (hit) {
          const { clientX, clientY } = e;
          hold = {
            x: clientX, y: clientY,
            timer: window.setTimeout(() => {
              hold = null;
              this.drag = null;
              for (const cb of this.menuListeners) cb({ layerId: hit.id, x: clientX, y: clientY });
            }, 550),
          };
        }
      }
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
      // The selected layer's handles come first, while editing.
      const sel = this.editing && this.writer ? this.record.layers.find(x => x.id === this.selectedId && x.visible) : undefined;
      const sb = sel ? this.bounds(sel) : null;
      const grab = sel && sb ? handleAt(sb, u.x * u.w, (1 - u.y) * u.h, u.w, u.h, e.pointerType === 'touch' ? 20 : 9) : null;
      if (sel && sb && grab) {
        this.drag = { id: sel.id, handle: grab, start: sb, layer: sel };
      } else {
        const n = this.writer ? hitNull(u) : null;
        const hit = n ?? (this.editing && this.writer ? this.layerAt(u) : null);
        if (hit) {
          if (this.editing) for (const cb of this.selectListeners) cb(hit.id);
          this.drag = { id: hit.id, dx: this.value(hit, 'x') - u.x, dy: this.value(hit, 'y') - u.y };
        } else {
          const id = this.kit.shapeAt(this.record, u.x, u.y, u.w / Math.max(1, u.h), value);
          if (!id) return;
          this.pressedZone = id;
          playEngine.pressZone(id);
          return;
        }
      }
      container.setPointerCapture?.(e.pointerId);
      e.preventDefault(); e.stopPropagation();
    };
    const onMove = (e: PointerEvent) => {
      if (hold && Math.hypot(e.clientX - hold.x, e.clientY - hold.y) > 8) cancelHold();
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
        const dr = this.drag;
        if ('handle' in dr) {
          const b = dragHandle(dr.start, dr.handle, u.x * u.w, (1 - u.y) * u.h, u.w, u.h, { proportional: e.shiftKey, centred: e.altKey, snap: e.shiftKey });
          this.writer?.(dr.id, patchFor(dr.layer, dr.start, b, this.value) as Partial<PlayLayer>);
        } else this.writer?.(dr.id, { x: Math.max(0, Math.min(1, u.x + dr.dx)), y: Math.max(0, Math.min(1, u.y + dr.dy)) } as Partial<PlayLayer>);
        e.preventDefault(); e.stopPropagation();
        return;
      }
      if (this.drawing) { container.style.cursor = 'crosshair'; return; }
      const overNull = hitNull(u);
      const sel = this.editing ? this.record.layers.find(x => x.id === this.selectedId && x.visible) : undefined;
      const sb = sel ? this.bounds(sel) : null;
      const h = sb ? handleAt(sb, u.x * u.w, (1 - u.y) * u.h, u.w, u.h) : null;
      if (h && sb) {
        if (h.kind === 'rotate') { container.style.cursor = 'crosshair'; return; }
        // Resize cursors follow the handle's direction on screen, turned with the layer.
        const a = ((Math.atan2(h.sy, h.sx) * 180) / Math.PI + sb.rot + 360) % 180;
        container.style.cursor = a < 22.5 || a >= 157.5 ? 'ew-resize' : a < 67.5 ? 'nwse-resize' : a < 112.5 ? 'ns-resize' : 'nesw-resize';
        return;
      }
      const over = overNull ?? (this.editing ? this.layerAt(u) : null);
      container.style.cursor = over ? 'grab' : '';
    };
    const onUp = () => {
      cancelHold();
      this.pointer.down = false;
      this.drag = null;
      if (this.pressedZone) { playEngine.releaseZone(this.pressedZone); this.pressedZone = null; }
      if (this.drawing?.mode === 'lasso' && this.drawing.pts.length >= 6) this.finishDrawing();
    };
    const onLeave = () => { this.pointer.over = false; };
    const onContext = (e: MouseEvent) => {
      if (this.drawing || !this.menuListeners.size) return;
      const r = container.getBoundingClientRect();
      const u = { x: (e.clientX - r.left) / Math.max(1, r.width), y: 1 - (e.clientY - r.top) / Math.max(1, r.height), w: r.width, h: r.height };
      const hit = this.layerAt(u);
      if (!hit) return;
      e.preventDefault(); e.stopPropagation();
      for (const cb of this.menuListeners) cb({ layerId: hit.id, x: e.clientX, y: e.clientY });
    };
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
    container.addEventListener('contextmenu', onContext, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      container.removeEventListener('pointerdown', onDown, true);
      container.removeEventListener('pointermove', onMove, true);
      container.removeEventListener('pointerup', onUp, true);
      container.removeEventListener('pointercancel', onUp, true);
      container.removeEventListener('pointerleave', onLeave);
      container.removeEventListener('dblclick', onDbl, true);
      container.removeEventListener('contextmenu', onContext, true);
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
      audioFor: l => ((l as { input?: string }).input === 'file' ? layerAudio.raw(l.id) : needsAudio ? liveAudio.raw() : null),
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
    else if (this.editing && this.selectedId) this.drawHandles(ctx, W, H, dpr);
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
