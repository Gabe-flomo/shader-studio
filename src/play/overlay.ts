/**
 * overlay.ts — draws the Play layers over the picture, once per rendered frame.
 *
 * A 2D canvas sits exactly over the WebGL canvas. Right after ShaderCanvas
 * draws a frame it calls `draw(glCanvas, time, dt)`: the picture is still in
 * the GL drawing buffer at that moment, so `drawImage(glCanvas)` works for
 * the mattes and for the particles' brightness readback.
 *
 *   null       a draggable point (its X/Y are sources and can be controls)
 *   text       over the picture with a blend mode, or a matte (see MatteMode)
 *   image      the same, from a data URL that travels with the play file
 *   particles  a particle system steered by the picture (play/particle-sim.js)
 *
 * Driven properties come from playEngine.layerValue(); everything else from
 * the record. Module singleton, no React.
 */

import type { BlendMode, ImageLayer, NullLayer, ParticlesLayer, PlayLayer, PlayRecord, TextLayer } from '../types/play';
import { emptyPlayRecord } from '../types/play';
import { playEngine } from '../lib/playEngine';
import { createParticles, drawParticles, stepParticles } from './particle-sim.js';
import type { ParticleEnv, ParticleParams, ParticleState as SimState } from './particle-sim.js';

const BLEND_OPS: Record<BlendMode, GlobalCompositeOperation> = {
  normal: 'source-over', multiply: 'multiply', screen: 'screen', overlay: 'overlay', lighten: 'lighten', darken: 'darken',
  difference: 'difference', exclusion: 'exclusion', add: 'lighter',
};

const FONTS = { sans: 'Inter, system-ui, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif', serif: 'Georgia, "Times New Roman", serif', mono: '"JetBrains Mono", Menlo, Consolas, monospace' };

const SAMPLE_W = 64, SAMPLE_H = 36;   // brightness grid for particles
const LUMA_W = 320, LUMA_H = 180;     // quarter-res luma matte

function css(c: [number, number, number], a = 1): string {
  return `rgba(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)},${a})`;
}

interface ParticleState { sim: SimState; trail: HTMLCanvasElement | null }

export type LayerWriter = (layerId: string, patch: Partial<NullLayer>) => void;

class PlayOverlay {
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private record: PlayRecord = emptyPlayRecord();
  private writer: LayerWriter | null = null;
  private images = new Map<string, HTMLImageElement>();
  private particles = new Map<string, ParticleState>();
  private layerCanvas: HTMLCanvasElement | null = null;   // scratch for mattes
  private lumaCanvas: HTMLCanvasElement | null = null;
  private sampleCanvas: HTMLCanvasElement | null = null;
  private sample: Uint8ClampedArray | null = null;
  private drag: { id: string; dx: number; dy: number } | null = null;
  /** The pointer over the picture (0..1, y up), for the particles' mouse attractor. */
  private pointer: { x: number; y: number } | null = null;
  private container: HTMLElement | null = null;

  setCanvas(el: HTMLCanvasElement | null): void {
    this.canvas = el;
    this.ctx = el ? el.getContext('2d') : null;
  }

  setRecord(record: PlayRecord): void {
    this.record = record;
    for (const id of [...this.particles.keys()]) if (!record.layers.some(l => l.id === id && l.kind === 'particles')) this.particles.delete(id);
  }

  /** Where null drags go (the store's setPlay). */
  setWriter(fn: LayerWriter | null): void { this.writer = fn; }

  hasLayers(): boolean { return this.record.layers.some(l => l.visible); }

  /** Particles move every frame, so the render loop must keep running while any are visible. */
  isAnimated(): boolean { return this.record.layers.some(l => l.visible && l.kind === 'particles'); }

  // ── Null dragging ──────────────────────────────────────────────────────────

  /** Listen on the picture's container: press on a null marker to drag it. Other presses pass through. */
  attachPointer(container: HTMLElement): () => void {
    this.container = container;
    const toUnit = (e: PointerEvent) => {
      const r = container.getBoundingClientRect();
      return { x: (e.clientX - r.left) / Math.max(1, r.width), y: 1 - (e.clientY - r.top) / Math.max(1, r.height), w: r.width, h: r.height };
    };
    const hit = (e: PointerEvent): NullLayer | null => {
      const u = toUnit(e);
      let best: NullLayer | null = null, bestD = Infinity;
      for (const l of this.record.layers) {
        if (l.kind !== 'null' || !l.visible) continue;
        const x = playEngine.layerValue(l.id, 'x', l.x), y = playEngine.layerValue(l.id, 'y', l.y);
        const d = Math.hypot((u.x - x) * u.w, (u.y - y) * u.h);
        const r = Math.max(l.size, 10) + 6;
        if (d <= r && d < bestD) { best = l; bestD = d; }
      }
      return best;
    };
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0 || !this.writer) return;
      const l = hit(e);
      if (!l) return;
      const u = toUnit(e);
      this.drag = { id: l.id, dx: l.x - u.x, dy: l.y - u.y };
      container.setPointerCapture?.(e.pointerId);
      e.preventDefault(); e.stopPropagation();
    };
    const onMove = (e: PointerEvent) => {
      const u = toUnit(e);
      this.pointer = { x: u.x, y: u.y };
      if (this.drag) {
        this.writer?.(this.drag.id, { x: Math.max(0, Math.min(1, u.x + this.drag.dx)), y: Math.max(0, Math.min(1, u.y + this.drag.dy)) });
        e.preventDefault(); e.stopPropagation();
        return;
      }
      if (this.record.layers.some(l => l.kind === 'null' && l.visible)) container.style.cursor = hit(e) ? 'grab' : '';
    };
    const onUp = () => { this.drag = null; };
    const onLeave = () => { this.pointer = null; };
    container.addEventListener('pointerdown', onDown, true);
    container.addEventListener('pointerleave', onLeave);
    container.addEventListener('pointermove', onMove, true);
    container.addEventListener('pointerup', onUp, true);
    container.addEventListener('pointercancel', onUp, true);
    return () => {
      container.removeEventListener('pointerdown', onDown, true);
      container.removeEventListener('pointermove', onMove, true);
      container.removeEventListener('pointerup', onUp, true);
      container.removeEventListener('pointercancel', onUp, true);
      container.removeEventListener('pointerleave', onLeave);
      container.style.cursor = '';
      if (this.container === container) this.container = null;
    };
  }

  // ── Drawing ────────────────────────────────────────────────────────────────

  draw(gl: HTMLCanvasElement, time: number, dt: number): void {
    const canvas = this.canvas, ctx = this.ctx;
    if (!canvas || !ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = Math.max(1, Math.round(gl.clientWidth * dpr)), H = Math.max(1, Math.round(gl.clientHeight * dpr));
    if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const layers = this.record.layers;
    // Picture hidden: the overlay covers it with the backdrop. The shader
    // still renders underneath, so mattes and particles can still read it.
    const hidden = this.record.display?.picture === false;
    if (hidden) { ctx.fillStyle = css(this.record.display!.backdrop); ctx.fillRect(0, 0, W, H); }
    if (!layers.some(l => l.visible)) return;
    let sampled = false, lumaReady = false;
    for (const layer of layers) {
      if (!layer.visible) continue;
      ctx.save();
      try {
        switch (layer.kind) {
          case 'null': this.drawNull(ctx, layer, W, H, dpr); break;
          case 'text':
          case 'image': {
            if (layer.matte === 'luma' && !lumaReady) { this.buildLuma(gl); lumaReady = true; }
            this.drawShape(ctx, layer, gl, W, H, hidden);
            break;
          }
          case 'particles': {
            if (!sampled) { this.sampleBrightness(gl); sampled = true; }
            this.drawParticles(ctx, layer, gl, W, H, dpr, time, dt);
            break;
          }
        }
      } finally { ctx.restore(); }
    }
  }

  private num(layer: PlayLayer, key: string, base: number): number {
    return playEngine.layerValue(layer.id, key, base);
  }

  private drawNull(ctx: CanvasRenderingContext2D, l: NullLayer, W: number, H: number, dpr: number): void {
    const x = this.num(l, 'x', l.x) * W, y = (1 - this.num(l, 'y', l.y)) * H;
    const r = this.num(l, 'size', l.size) * dpr;
    if (r <= 0) return;
    ctx.globalAlpha = 0.95;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = l.color; ctx.fill();
    ctx.lineWidth = 2 * dpr; ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.stroke();
    ctx.beginPath(); ctx.arc(x, y, Math.max(1, r * 0.25), 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill();
    ctx.font = `600 ${11 * dpr}px ${FONTS.sans}`; ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.textBaseline = 'middle';
    ctx.fillText(l.label, x + r + 6 * dpr, y);
  }

  /** Text and image share the matte pipeline: paint the shape into a scratch canvas, then composite. */
  private drawShape(ctx: CanvasRenderingContext2D, l: TextLayer | ImageLayer, gl: HTMLCanvasElement, W: number, H: number, hidden: boolean): void {
    const opacity = this.num(l, 'opacity', l.opacity);
    if (opacity <= 0) return;
    const scratch = this.scratch(W, H);
    const s = scratch.getContext('2d')!;
    s.setTransform(1, 0, 0, 1, 0, 0);
    s.clearRect(0, 0, W, H);
    const x = this.num(l, 'x', l.x) * W, y = (1 - this.num(l, 'y', l.y)) * H;
    const rot = this.num(l, 'rotation', l.rotation) * Math.PI / 180;
    // 1. The shape, in the layer's colour (text) or its pixels (image).
    s.save(); s.translate(x, y); s.rotate(rot);
    if (l.kind === 'text') {
      s.font = `${l.weight} ${Math.max(1, this.num(l, 'size', l.size) * H)}px ${FONTS[l.font]}`;
      s.textAlign = 'center'; s.textBaseline = 'middle';
      s.fillStyle = l.matte === 'over' ? css(l.color) : '#fff';
      const lines = l.text.split('\n');
      const lh = this.num(l, 'size', l.size) * H * 1.15;
      lines.forEach((line, i) => s.fillText(line, 0, (i - (lines.length - 1) / 2) * lh));
    } else {
      const img = this.image(l.src);
      if (!img) { s.restore(); return; }
      const h = this.num(l, 'scale', l.scale) * H, w = h * (img.naturalWidth / Math.max(1, img.naturalHeight));
      s.drawImage(img, -w / 2, -h / 2, w, h);
    }
    s.restore();
    // 2. The matte.
    if (l.matte === 'reveal' && hidden) {
      // Picture hidden: paint the picture into the shape; the backdrop stays around it.
      s.globalCompositeOperation = 'source-in';
      s.drawImage(gl, 0, 0, W, H);
      s.globalCompositeOperation = 'source-over';
    } else if (l.matte === 'reveal') {
      // Picture inside the shape, colour everywhere else: colour plate minus the shape.
      s.globalCompositeOperation = 'source-out';
      s.fillStyle = css(l.color); s.fillRect(0, 0, W, H);
      s.globalCompositeOperation = 'source-over';
    } else if (l.matte === 'luma' && this.lumaCanvas) {
      s.globalCompositeOperation = 'destination-in';
      s.drawImage(this.lumaCanvas, 0, 0, W, H);
      s.globalCompositeOperation = 'source-over';
    }
    // 3. Composite onto the overlay.
    ctx.globalAlpha = opacity;
    ctx.globalCompositeOperation = l.matte === 'over' ? BLEND_OPS[l.blend] : 'source-over';
    ctx.drawImage(scratch, 0, 0);
  }

  private drawParticles(ctx: CanvasRenderingContext2D, l: ParticlesLayer, gl: HTMLCanvasElement, W: number, H: number, dpr: number, time: number, dt: number): void {
    const n = (key: keyof ParticlesLayer & string) => this.num(l, key, l[key] as number);
    const p: ParticleParams = {
      ...l,
      speed: n('speed'), steer: n('steer'), turns: n('turns'), noiseScale: n('noiseScale'), noiseEvolve: n('noiseEvolve'),
      strength: n('strength'), catchRadius: n('catchRadius'), spawnRadius: n('spawnRadius'), life: n('life'),
      size: n('size'), sizeJitter: n('sizeJitter'), sizeAmount: n('sizeAmount'), opacityAmount: n('opacityAmount'), falloff: n('falloff'),
    };
    const nul = l.nullId ? this.nullPoint(l.nullId) : null;
    const env: ParticleEnv & { W: number; H: number } = {
      dt, time, aspect: W / H, sample: this.sample, sw: SAMPLE_W, sh: SAMPLE_H,
      attractorPoint: l.attractor === 'mouse' ? this.pointer : l.attractor === 'null' ? nul : null,
      spawnPoint: nul, modPoint: nul,
      W, H, dpr, alpha: 1,
      sprite: l.shape === 'image' ? this.image(l.sprite) : null,
    };
    const st = this.particleState(l);
    stepParticles(st.sim, p, env);
    const opacity = n('opacity'), trail = n('trail');
    // Particles draw into their own canvas: it keeps the trail, and lets
    // `reveal` turn them into a mask the picture shows through.
    const useLayer = trail > 0 || l.reveal;
    if (!useLayer) {
      ctx.globalCompositeOperation = BLEND_OPS[l.blend];
      env.alpha = opacity;
      drawParticles(ctx, st.sim, p, env);
      return;
    }
    const t = this.trailCtx(st, W, H, trail);
    drawParticles(t, st.sim, p, env);
    let out: HTMLCanvasElement = st.trail!;
    if (l.reveal) {
      const scratch = this.scratch(W, H), s = scratch.getContext('2d')!;
      s.setTransform(1, 0, 0, 1, 0, 0);
      s.globalCompositeOperation = 'source-over'; s.globalAlpha = 1;
      s.clearRect(0, 0, W, H);
      s.drawImage(st.trail!, 0, 0);
      s.globalCompositeOperation = 'source-in';
      s.drawImage(gl, 0, 0, W, H);
      s.globalCompositeOperation = 'source-over';
      out = scratch;
    }
    ctx.globalAlpha = opacity;
    ctx.globalCompositeOperation = BLEND_OPS[l.blend];
    ctx.drawImage(out, 0, 0);
  }

  /** A null's current position (driven X/Y included), or null when it is missing or hidden. */
  private nullPoint(id: string): { x: number; y: number } | null {
    const l = this.record.layers.find(x => x.id === id);
    if (!l || l.kind !== 'null') return null;
    return { x: playEngine.layerValue(l.id, 'x', l.x), y: playEngine.layerValue(l.id, 'y', l.y) };
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private scratch(W: number, H: number): HTMLCanvasElement {
    if (!this.layerCanvas) this.layerCanvas = document.createElement('canvas');
    if (this.layerCanvas.width !== W || this.layerCanvas.height !== H) { this.layerCanvas.width = W; this.layerCanvas.height = H; }
    return this.layerCanvas;
  }

  private image(src: string): HTMLImageElement | null {
    if (!src) return null;
    let img = this.images.get(src);
    if (!img) {
      img = new Image();
      img.src = src;
      this.images.set(src, img);
      if (this.images.size > 12) { const first = this.images.keys().next().value; if (first && first !== src) this.images.delete(first); }
    }
    return img.complete && img.naturalWidth > 0 ? img : null;
  }

  private particleState(l: ParticlesLayer): ParticleState {
    let st = this.particles.get(l.id);
    if (!st || st.sim.count !== l.count) {
      st = { sim: createParticles(l.count), trail: st?.trail ?? null };
      this.particles.set(l.id, st);
    }
    return st;
  }

  private trailCtx(st: ParticleState, W: number, H: number, trail: number): CanvasRenderingContext2D {
    if (!st.trail) st.trail = document.createElement('canvas');
    if (st.trail.width !== W || st.trail.height !== H) { st.trail.width = W; st.trail.height = H; }
    const t = st.trail.getContext('2d')!;
    t.setTransform(1, 0, 0, 1, 0, 0);
    t.globalAlpha = 1;
    if (trail <= 0) t.clearRect(0, 0, W, H);
    else {
      t.globalCompositeOperation = 'destination-out';
      // Long trails fade slowly: trail 1 → 2% per frame, trail 0.1 → ~60%.
      t.fillStyle = `rgba(0,0,0,${Math.max(0.02, 1 - Math.pow(trail, 0.6))})`;
      t.fillRect(0, 0, W, H);
    }
    t.globalCompositeOperation = 'source-over';
    return t;
  }

  private sampleBrightness(gl: HTMLCanvasElement): void {
    if (!this.sampleCanvas) { this.sampleCanvas = document.createElement('canvas'); this.sampleCanvas.width = SAMPLE_W; this.sampleCanvas.height = SAMPLE_H; }
    const c = this.sampleCanvas.getContext('2d', { willReadFrequently: true })!;
    try {
      c.drawImage(gl, 0, 0, SAMPLE_W, SAMPLE_H);
      this.sample = c.getImageData(0, 0, SAMPLE_W, SAMPLE_H).data;
    } catch { this.sample = null; }
  }

  /** Quarter-res copy of the picture turned into an alpha matte: alpha = luminance. */
  private buildLuma(gl: HTMLCanvasElement): void {
    if (!this.lumaCanvas) { this.lumaCanvas = document.createElement('canvas'); this.lumaCanvas.width = LUMA_W; this.lumaCanvas.height = LUMA_H; }
    const c = this.lumaCanvas.getContext('2d', { willReadFrequently: true })!;
    try {
      c.globalCompositeOperation = 'source-over';
      c.drawImage(gl, 0, 0, LUMA_W, LUMA_H);
      const img = c.getImageData(0, 0, LUMA_W, LUMA_H);
      const d = img.data;
      for (let i = 0; i < d.length; i += 4) {
        d[i + 3] = Math.round(d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114);
        d[i] = d[i + 1] = d[i + 2] = 255;
      }
      c.putImageData(img, 0, 0);
    } catch { /* tainted or lost context: the layer just shows unmatted */ }
  }
}

export const playOverlay = new PlayOverlay();
