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

import { readsPicture } from './conditionRange';
import { playPerfOn, recordPlayLayer, recordPlayStage } from '../lib/perfStats';
import type { ActionKind, PlayLayer, PlayRecord } from '../types/play';
import { DEFAULT_HANDS, emptyPlayRecord, isLookAction } from '../types/play';
import { DEFAULT_FACE, DEFAULT_POSE } from '../types/playTracking';
import { playEngine } from '../lib/playEngine';
import { liveAudio } from '../lib/liveAudio';
import { layerAudio } from '../lib/layerAudio';
import { cameraInput } from '../lib/cameraInput';
import { createLayerKit, type KitAudio, type KitEnv, type KitPointer, type LayerKit } from './kit/kit.js';
import { loadThreeRuntime, playUses3D, threeRuntime } from './threeSource';
import { klPaintBackground } from './kit/layers.js';
import { playBackground, planShowsThis } from './background';
import { playVideoLayers } from './videoLayers';
import { playDrumPads } from './drumPads';
import { klVideoFit } from './kit/layers.js';
import type { BqPlan } from './kit/queue.js';
import { setScriptStatus } from './scriptStatus';
import { logScript } from './scriptConsole';
import { kitDataset } from './dataLayer';
import { klFontFor } from './kit/layers.js';
import { dragHandle, handleAt, handlePoints, insideBounds, layerBounds, maskBounds, maskPatchFor, outlinePoints, patchFor, type Bounds, type Handle } from './transform';
import { kmMaskLocal, kmMaskPath, kmMaskPlacement } from './kit/mattes.js';
import { matteUsers } from '../types/playLayers';
import { addMask, maskFromOutline } from './mattes';
import { fnActive, fnAnimated, fnCreate, fnLookAct, fnLookNew, fnLookReset, fnLookStep, fnLookValue, fnMapLayers, fnUsesMotion, type FnEffect, type FnRenderer } from './kit/finish.js';
import { finishPropId, renderableFinish } from '../types/playFinish';

/** `vel` and `at`: a drum pad hit's velocity (0 lets a gate pad go) and the clock time it landed (takes stamp it there). */
type KitAction = { do: ActionKind; layerId: string; amount: number; vel?: number; at?: number; key?: string; value?: number; seconds?: number };
/** A Look action's own fields (its setting, value and seconds), when it has them. */
const lookFields = (a: { key?: string; value?: number; seconds?: number }) => ({ ...(a.key !== undefined ? { key: a.key } : {}), ...(a.value !== undefined ? { value: a.value } : {}), ...(a.seconds !== undefined ? { seconds: a.seconds } : {}) });
/** An audio layer's sound from a take: a frame, null (the input was off), or undefined (not recorded: the live sound). */
export type TakeAudioSource = (l: PlayLayer) => KitAudio | null | undefined;

export type LayerWriter = (layerId: string, patch: Partial<PlayLayer>) => void;
export type { ShaderTap } from './kit/kit.js';
import type { ShaderTap } from './kit/kit.js';

/** Drawing a shape's outline on the picture: click corners (polygon) or drag freehand (lasso). With `mask`, the outline becomes a new mask on that layer. */
export interface ShapeDrawing { layerId: string; mode: 'polygon' | 'lasso'; pts: number[]; mask?: boolean }

/** The live Finish stack's most pixels a frame (about 1920 × 1080): the preview stays cheap on a retina screen. Renders use their own size. */
const FINISH_MAX_PIXELS = 2.1e6;

/** Mask outlines and handles on the picture: amber, apart from the layers' blue. */
const MASK_COLOUR = '#f5c542';

type MaskDrag = { id: string; maskId: string; handle: Handle | null; start: Bounds; layer: PlayLayer; grab: { x: number; y: number } };

/** What the overlay hands a Granulator's "Grains from" after each frame. */
export type GrainTap = (kit: LayerKit, record: PlayRecord, aspect: number, time: number, offline: boolean) => void;

/** Does any Granulator read the picture under its things (a Brightness link)? */
function grainsReadPicture(r: PlayRecord): boolean {
  return !!r.audioEngine?.racks.some(k => k.instrument?.kind === 'granulator' && k.instrument.from?.links.some(l => l.on && l.prop === 'bright'));
}

class PlayOverlay {
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private record: PlayRecord = emptyPlayRecord();
  private writer: LayerWriter | null = null;
  private images = new Map<string, HTMLImageElement>();
  private kit: LayerKit = createLayerKit();
  private pointer: KitPointer = { x: 0.5, y: 0.5, over: false, down: false };
  private drag: { id: string; dx: number; dy: number } | { id: string; handle: Handle; start: Bounds; layer: PlayLayer } | MaskDrag | null = null;
  /** The mask being edited on the selected layer ('' = the layer itself). */
  private selectedMask = '';
  private maskListeners = new Set<(layerId: string, maskId: string) => void>();
  private selectListeners = new Set<(id: string) => void>();
  private menuListeners = new Set<(m: { layerId: string; x: number; y: number }) => void>();
  private measure: CanvasRenderingContext2D | null = null;
  private pressedZone: string | null = null;
  private editing = false;
  private guides = true;
  private selectedId = '';
  private drawing: ShapeDrawing | null = null;
  private drawingListeners = new Set<(d: ShapeDrawing | null) => void>();
  private aspect = 16 / 9;
  private composite: HTMLCanvasElement | null = null;
  private shaderTap: ((tap: ShaderTap) => void) | null = null;

  constructor() {
    playEngine.onAction(a => this.fire({ do: a.do, layerId: a.layerId, amount: a.amount, ...lookFields(a) }));
    // The picture's brightness (`pic:` values): what the layer kit sampled of the last frame.
    playEngine.setPictureReader((x, y, r, ch) => this.kit.pictureAt(x, y, r, ch));
    // Drum pads: every hit goes through here (a take records it), and comes back to play.
    playDrumPads.setActor(a => this.fire(a));
    this.onPad(a => playDrumPads.play(a));
  }

  // ── Actions, and a take playing back ───────────────────────────────────────

  private actListeners = new Set<(a: KitAction) => void>();
  /** Set while a take plays back: the pointer it recorded, and live actions are ignored. */
  private replayPointer: KitPointer | null = null;
  private replayAudio: TakeAudioSource | null = null;
  private replaying = false;
  /** The layers' random seed (a take recording or playing back); 0 = Math.random. */
  private seed = 0;

  private fire(a: KitAction): void {
    if (this.replaying) return;
    if (a.do === 'pad') for (const cb of this.padListeners) cb(a);
    // A Look action already changed its effect's numbers (playEngine.tickActions); a take still records it.
    else if (!isLookAction(a.do)) this.kit.act(a);
    for (const cb of this.actListeners) cb(a);
  }

  private padListeners = new Set<(a: KitAction) => void>();
  /** Drum pad hits (`do: 'pad'`), live and from a take playing back (play/drumPads.ts plays them). */
  onPad(cb: (a: KitAction) => void): () => void { this.padListeners.add(cb); return () => { this.padListeners.delete(cb); }; }
  /** Is a take playing back (live pad hits wait)? */
  isReplaying(): boolean { return this.replaying; }

  /** Every action that fires on the live picture (a take records them). Returns an unsubscribe. */
  onAct(cb: (a: KitAction) => void): () => void { this.actListeners.add(cb); return () => { this.actListeners.delete(cb); }; }

  /**
   * A take plays back (true) or ends (false): its pointer drives the layers,
   * actions come only from `replayAct`, and following nulls stay where the
   * take puts them. Starting or ending clears the layers' state (particles,
   * bodies, strokes), as a render of the take starts from nothing.
   */
  setReplaying(on: boolean, seed = 0): void {
    this.replaying = on;
    // Look actions start over too: a take's own fire as it plays.
    playEngine.resetLooks();
    if (!on) { this.replayPointer = null; this.replayAudio = null; }
    this.seed = on ? seed : 0;
    this.kit.reset(this.seed);
  }
  setReplayPointer(p: KitPointer | null): void { this.replayPointer = p; }
  /** The take's audio frames for audio layers (null: the live sound). */
  setReplayAudio(fn: TakeAudioSource | null): void { this.replayAudio = fn; }
  /** An action from the take playing back. */
  replayAct(a: KitAction): void {
    if (a.do === 'pad') { for (const cb of this.padListeners) cb(a); return; }
    if (isLookAction(a.do)) { playEngine.lookAct(a); return; }
    this.kit.act(a);
  }
  /** Start the layers over (a take scrubbed backwards), with the take's seed. */
  resetLayers(): void { this.kit.reset(this.seed); }
  /**
   * A take starts recording: the layers start over with its seed, so every
   * random choice they make (unseeded particles, Script layers' random(),
   * bodies' scatter) comes out the same when it plays back or renders.
   */
  startSeeded(seed: number): void { this.seed = seed; this.kit.reset(seed); }

  private lastGl: HTMLCanvasElement | null = null;
  private stepCanvas: HTMLCanvasElement | null = null;
  /**
   * Run the layers one step without showing it: a take being scrubbed runs
   * them forward from its start to where it was sent, so bursts and strokes
   * from before that point are there. Drawn off screen, at the overlay's size
   * (a Script layer starts over when its size changes).
   */
  stepLayers(time: number, dt: number, pointer: KitPointer | null, actions: readonly KitAction[]): void {
    const gl = this.lastGl, canvas = this.canvas;
    if (!gl || !canvas) return;
    const W = canvas.width, H = canvas.height;
    const off = this.stepCanvas ?? (this.stepCanvas = document.createElement('canvas'));
    if (off.width !== W || off.height !== H) { off.width = W; off.height = H; }
    const ctx = off.getContext('2d');
    if (!ctx) return;
    for (const a of actions) { if (isLookAction(a.do)) playEngine.lookAct(a, time); else this.kit.act(a); }
    const env = this.env(gl, W, H, Math.min(2, window.devicePixelRatio || 1), time, dt, true);
    env.background = playBackground.kitBackground();
    if (pointer) env.pointer = pointer;
    this.kit.frame(ctx, this.record, env);
  }

  setCanvas(el: HTMLCanvasElement | null): void {
    this.canvas = el;
    this.ctx = el ? el.getContext('2d') : null;
    // The Finish stack's canvas and the guides above it: siblings over the layers, made when first needed.
    if (!el) { this.finishEl?.remove(); this.guidesEl?.remove(); this.finishEl = null; this.guidesEl = null; this.live?.dispose(); this.live = null; }
  }

  // ── The Finish stack ───────────────────────────────────────────────────────

  private live: FnRenderer | null = null;
  private exportFinish: FnRenderer | null = null;
  private finishEl: HTMLCanvasElement | null = null;
  private guidesEl: HTMLCanvasElement | null = null;

  /** The stack as the renderer reads it (sealed custom effects' code filled in, in memory). */
  private get finish() { return renderableFinish(this.record.finish); }
  /** Is the Finish stack doing something (on, with an effect on)? */
  hasFinish(): boolean { return fnActive(this.finish); }
  /** Does the stack change with the clock (grain, shake, flicker, time displacement)? The render loop keeps going while it plays. */
  finishMoving(): boolean { return fnAnimated(this.finish); }
  /** The live Finish renderer's state (for the panel and the browser checks). */
  finishInfo() { return this.live?.info() ?? null; }

  private finishValue = (e: FnEffect, key: string) => playEngine.layerValue(finishPropId(e.id), key, (e as Record<string, unknown>)[key] as number);

  /** The layers the Finish stack reads as maps (Time's or Displace's Layer map, an effect's Where), drawn alone by the kit. */
  private alphaLayers(): string[] | null {
    if (!this.hasFinish()) return null;
    const ids = fnMapLayers(this.finish);
    return ids.length ? ids : null;
  }

  private ensureFinishCanvases(): boolean {
    const el = this.canvas;
    if (!el || !el.parentElement) return false;
    if (!this.live) {
      const f = document.createElement('canvas');
      f.setAttribute('aria-hidden', 'true');
      f.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;display:none';
      const g = document.createElement('canvas');
      g.setAttribute('aria-hidden', 'true');
      g.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;display:none';
      el.after(f, g);
      this.finishEl = f; this.guidesEl = g;
      this.live = fnCreate(f);
    }
    return this.live.ok;
  }

  private showFinish(on: boolean): void {
    if (this.finishEl) this.finishEl.style.display = on ? 'block' : 'none';
    if (this.guidesEl) this.guidesEl.style.display = on ? 'block' : 'none';
  }

  setRecord(record: PlayRecord): void {
    this.record = record;
    playBackground.setRecord(record);
    playVideoLayers.setRecord(record);
    playDrumPads.setRecord(record);
    // Example graphs in a Background queue compile from the examples' chunk: load it now, so the picture and exports have them.
    // (Imported when needed: queueGraphs brings the graph store along.)
    if (record.layers[0]?.kind === 'background' && record.layers[0].sources.some(x => x.kind === 'graph' && x.graph?.startsWith('example:'))) void import('./queueGraphs').then(m => m.preloadQueueExamples());
    // A 3D sketch: load three.js (the script exported pages carry), so the layer draws and a later export has it at hand.
    if (!threeRuntime() && playUses3D(record)) void loadThreeRuntime().catch(() => {});
  }

  /**
   * The Background layer's plan for the live frame at `time` (null without
   * one, or off the Play page): ShaderCanvas asks before it draws, to render
   * the graph sources that show and keep the showing videos on the clock.
   */
  queuePlan(time: number): BqPlan | null {
    if (!playBackground.layerActive()) { this.lastQueue = null; return null; }
    this.lastQueue = this.kit.background(this.record, { time, value: this.value, allowDirect: true });
    return this.lastQueue;
  }
  private lastQueue: BqPlan | null = null;
  /** What the Background layer shows now (for its panel): the source showing and the one fading out, or null off the Play page. */
  queueShowing(): { toId: string; fromId: string } | null {
    const q = this.lastQueue;
    if (!q) return null;
    const to = q.items[q.items.length - 1]?.item.id ?? '';
    return { toId: to, fromId: q.items.length > 1 ? q.items[0].item.id : '' };
  }
  /** The Background layer's source ids (ShaderCanvas lets go of programs for the others). */
  queueSourceIds(): string[] { const l = this.record.layers[0]; return l?.kind === 'background' ? l.sources.map(s => s.id) : []; }

  /**
   * An offline frame's Background plan (null without a Background layer): the
   * export's own kit, started fresh on the first frame with the take's seed,
   * gets this frame's actions first. compositePixels then draws the same
   * frame without applying them again.
   */
  exportQueuePlan(time: number, first: boolean, actions: readonly KitAction[], seed = 0): BqPlan | null {
    if (!playBackground.layerActive()) return null;
    if (first || !this.exportKit) { this.exportKit = createLayerKit(); this.exportKit.reset(seed); }
    for (const a of actions) this.exportKit.act(a);
    this.exportPrepared = true;
    return this.exportKit.background(this.record, { time, value: this.value, allowDirect: false });
  }
  private exportPrepared = false;

  /**
   * After every frame the layers step (live, and each offline frame of a render): a Granulator
   * reading a layer's things takes them here (lib/grainFrom.ts). `offline` for a render's frames.
   */
  private grainTap: GrainTap | null = null;
  setGrainTap(fn: GrainTap | null): void { this.grainTap = fn; }

  /** Fire an action now (the panel's Burst / Drop / Next / Clear buttons). */
  act(a: KitAction): void { this.fire(a); }

  /** Where drags and drawn shapes go (the store's setPlay). */
  setWriter(fn: LayerWriter | null): void { this.writer = fn; }

  /** The Layers tab is open: shapes can be dragged and invisible zones are outlined. `maskId`: that mask of the selected layer gets the handles. */
  setEditing(on: boolean, selectedId = '', maskId = ''): void { this.editing = on; this.selectedId = selectedId; this.selectedMask = maskId; }

  /** A mask picked on the picture (a press on its outline) or made by drawing. Returns an unsubscribe. */
  onMaskSelect(cb: (layerId: string, maskId: string) => void): () => void { this.maskListeners.add(cb); return () => { this.maskListeners.delete(cb); }; }
  private emitMask(layerId: string, maskId: string): void { this.selectedMask = maskId; for (const cb of this.maskListeners) cb(layerId, maskId); }

  /** Can this layer be picked and dragged on the picture: shown, or hidden because it is another layer's matte. */
  private handled(l: PlayLayer): boolean { return l.visible || matteUsers(this.record.layers, l.id).length > 0; }

  /** Draw the guides (null markers, handles, zone outlines, fields) or just the picture. */
  setGuides(on: boolean): void { this.guides = on; }

  /** The graph's Layers node reads what the layers draw: receive it after every frame (null = off). */
  setShaderTap(fn: ((tap: ShaderTap) => void) | null): void { this.shaderTap = fn; }

  /** Is there anything on the overlay: a visible layer, Layers only, or a background in place of the shader? */
  hasLayers(): boolean { return this.record.layers.some(l => l.visible) || playBackground.hidden() || playBackground.active() || playBackground.layerActive(); }

  /** Anything moving on its own keeps the render loop running. */
  isAnimated(): boolean { return this.kit.isAnimated(this.record) || !!this.drawing; }

  /** A layer picked on the picture (a click while editing). Returns an unsubscribe. */
  onSelect(cb: (id: string) => void): () => void { this.selectListeners.add(cb); return () => { this.selectListeners.delete(cb); }; }
  /** A right-click on a layer: its id and where (page pixels). Returns an unsubscribe. */
  onContextMenu(cb: (m: { layerId: string; x: number; y: number }) => void): () => void { this.menuListeners.add(cb); return () => { this.menuListeners.delete(cb); }; }

  // ── Bounds and handles ─────────────────────────────────────────────────────

  private value = (l: PlayLayer, k: string) => playEngine.layerValue(l.id, k, (l as unknown as Record<string, number>)[k]);

  /** A layer's box on the picture (see transform.ts), or null for layers without one. */
  /** Width / height of the picture as last drawn. */
  pictureAspect(): number { return this.aspect; }

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
        if (layer.kind === 'video') return playVideoLayers.aspect(layer.id);
        return 0;
      },
      fitHeight: layer => (layer.kind === 'video' ? klVideoFit(layer.fit, playVideoLayers.aspect(layer.id), this.aspect) : 1),
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

  /**
   * A press on one of the layer's masks: a handle or the inside of the mask
   * being edited, or the outline of another (which picks it). Null elsewhere.
   */
  private maskPress(l: PlayLayer, u: { x: number; y: number; w: number; h: number }, radius: number): { maskId: string; handle: Handle | null; bounds: Bounds } | null {
    if (!l.masks?.length) return null;
    const aspect = u.w / Math.max(1, u.h), px = u.x * u.w, py = (1 - u.y) * u.h;
    const active = this.activeMask(l);
    if (active) {
      const b = maskBounds(l, active, this.value, aspect);
      const handle = handleAt(b, px, py, u.w, u.h, radius);
      if (handle || insideBounds(b, px, py, u.w, u.h)) return { maskId: active.id, handle, bounds: b };
    }
    const m = this.measure ?? (this.measure = document.createElement('canvas').getContext('2d'));
    if (!m) return null;
    m.lineWidth = radius * 1.4;
    for (let i = l.masks.length - 1; i >= 0; i--) {
      const mk = l.masks[i];
      if (mk === active) continue;
      const path = kmMaskPath(mk, kmMaskPlacement(l as never, mk, k => this.value(l, k), aspect), u.w, u.h);
      if (m.isPointInStroke(path, px, py)) return { maskId: mk.id, handle: null, bounds: maskBounds(l, mk, this.value, aspect) };
    }
    return null;
  }

  /** The selected layer's mask being edited, if any. */
  private activeMask(l: PlayLayer | undefined) { return l && this.selectedMask ? l.masks?.find(m => m.id === this.selectedMask) : undefined; }

  private drawHandles(ctx: CanvasRenderingContext2D, W: number, H: number, dpr: number): void {
    const l = this.record.layers.find(x => x.id === this.selectedId);
    if (!l || !this.handled(l)) return;
    const active = this.activeMask(l);
    // The layer's masks: every outline in amber, the one being edited solid.
    if (l.masks?.length) {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      for (const m of l.masks) {
        const path = kmMaskPath(m, kmMaskPlacement(l as never, m, k => this.value(l, k), W / H), W, H);
        ctx.lineWidth = (m === active ? 1.5 : 1.25) * dpr; ctx.strokeStyle = MASK_COLOUR; ctx.globalAlpha = m === active ? 1 : 0.75;
        ctx.setLineDash(m === active ? [] : [5 * dpr, 4 * dpr]);
        ctx.stroke(path);
      }
      ctx.restore();
    }
    const b = active ? maskBounds(l, active, this.value, W / H) : this.bounds(l);
    if (!b) return;
    const accent = active ? MASK_COLOUR : '#5b8cff';
    const cw = W / dpr, ch = H / dpr;
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineWidth = 1; ctx.strokeStyle = active ? 'rgba(245,197,66,0.9)' : 'rgba(91,140,255,0.9)'; ctx.setLineDash([4, 3]);
    const o = outlinePoints(b, cw, ch);
    ctx.beginPath(); o.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); ctx.stroke();
    ctx.setLineDash([]);
    for (const p of handlePoints(b, cw, ch)) {
      ctx.fillStyle = '#fff'; ctx.strokeStyle = accent; ctx.lineWidth = 1.5;
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

  startDrawing(layerId: string, mode: 'polygon' | 'lasso', mask = false): void { this.drawing = { layerId, mode, pts: [], ...(mask ? { mask: true } : {}) }; this.emitDrawing(); }
  cancelDrawing(): void { this.drawing = null; this.emitDrawing(); }
  onDrawing(cb: (d: ShapeDrawing | null) => void): () => void { this.drawingListeners.add(cb); return () => { this.drawingListeners.delete(cb); }; }
  private emitDrawing(): void { for (const cb of this.drawingListeners) cb(this.drawing); }

  /** Close the drawn outline into the shape: centred on its points, corners relative to the centre in picture heights. */
  finishDrawing(): void {
    const d = this.drawing;
    this.drawing = null;
    this.emitDrawing();
    if (!d || d.pts.length < 6 || !this.writer) return;
    if (d.mask) {
      // A mask on the layer: its box around the outline, in the layer's own frame.
      const l = this.record.layers.find(x => x.id === d.layerId);
      if (!l) return;
      const place = maskFromOutline(d.pts, this.aspect, (x, y, r) => kmMaskLocal(l as never, k => this.value(l, k), this.aspect, x, y, r));
      if (!place) return;
      const r = addMask(this.record, d.layerId, 'polygon', place);
      const made = r.play.layers.find(x => x.id === d.layerId);
      if (!r.maskId || !made) return;
      const patch: Record<string, unknown> = { masks: made.masks };
      for (const [k, v] of Object.entries(made)) if (k.startsWith(`mask_${r.maskId}_`)) patch[k] = v;
      this.writer(d.layerId, patch as Partial<PlayLayer>);
      this.emitMask(d.layerId, r.maskId);
      return;
    }
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
      // Where it went down, for the engine's `pointer` anchor (a capture on the press reads it).
      this.pointer.x = u.x; this.pointer.y = u.y; this.pointer.over = true;
      playEngine.setPicturePointer(u.x, u.y);
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
      // The selected layer's handles come first, while editing: its mask being edited, a press on another mask's
      // outline (which picks that mask), then the layer's own.
      const sel = this.editing && this.writer ? this.record.layers.find(x => x.id === this.selectedId && this.handled(x)) : undefined;
      const onMask = sel ? this.maskPress(sel, u, e.pointerType === 'touch' ? 20 : 9) : null;
      const sb = sel && !onMask && !this.activeMask(sel) ? this.bounds(sel) : null;
      const grab = sel && sb ? handleAt(sb, u.x * u.w, (1 - u.y) * u.h, u.w, u.h, e.pointerType === 'touch' ? 20 : 9) : null;
      if (sel && onMask) {
        if (onMask.maskId !== this.selectedMask) this.emitMask(sel.id, onMask.maskId);
        this.drag = { id: sel.id, maskId: onMask.maskId, handle: onMask.handle, start: onMask.bounds, layer: sel, grab: { x: u.x, y: u.y } };
      } else if (sel && sb && grab) {
        this.drag = { id: sel.id, handle: grab, start: sb, layer: sel };
      } else if (sel && sb && !sel.visible && insideBounds(sb, u.x * u.w, (1 - u.y) * u.h, u.w, u.h)) {
        // A hidden matte can't be clicked on the picture, but once it is selected, dragging inside its box moves it.
        this.drag = { id: sel.id, dx: this.value(sel, 'x') - u.x, dy: this.value(sel, 'y') - u.y };
      } else {
        // Anywhere else lets go of the mask being edited.
        if (sel && this.selectedMask) this.emitMask(sel.id, '');
        const n = this.writer ? hitNull(u) : null;
        const hit = n ?? (this.editing && this.writer ? this.layerAt(u) : null);
        if (hit) {
          if (this.editing) for (const cb of this.selectListeners) cb(hit.id);
          // A path is placed by its nulls: a press picks it, and dragging moves nothing (drag its nulls).
          if (!(hit.kind === 'shape' && hit.shape === 'path')) this.drag = { id: hit.id, dx: this.value(hit, 'x') - u.x, dy: this.value(hit, 'y') - u.y };
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
      if (this.pointer.over) playEngine.setPicturePointer(u.x, u.y);
      const d = this.drawing;
      if (d && d.mode === 'lasso' && this.pointer.down && d.pts.length >= 2) {
        const lx = d.pts[d.pts.length - 2], ly = d.pts[d.pts.length - 1];
        if (Math.hypot((u.x - lx) * u.w, (u.y - ly) * u.h) > 6 && d.pts.length < 400) { d.pts.push(u.x, u.y); }
        e.preventDefault(); e.stopPropagation();
        return;
      }
      if (this.drag) {
        const dr = this.drag;
        if ('maskId' in dr) {
          const m = dr.layer.masks?.find(x => x.id === dr.maskId);
          if (m) {
            const b = dr.handle
              ? dragHandle(dr.start, dr.handle, u.x * u.w, (1 - u.y) * u.h, u.w, u.h, { proportional: e.shiftKey, centred: e.altKey, snap: e.shiftKey })
              : { ...dr.start, x: dr.start.x + u.x - dr.grab.x, y: dr.start.y + u.y - dr.grab.y };
            this.writer?.(dr.id, maskPatchFor(dr.layer, m, b, this.value, u.w / Math.max(1, u.h)) as Partial<PlayLayer>);
          }
        } else if ('handle' in dr) {
          const b = dragHandle(dr.start, dr.handle, u.x * u.w, (1 - u.y) * u.h, u.w, u.h, { proportional: e.shiftKey, centred: e.altKey, snap: e.shiftKey });
          this.writer?.(dr.id, patchFor(dr.layer, dr.start, b, this.value) as Partial<PlayLayer>);
        } else this.writer?.(dr.id, { x: Math.max(0, Math.min(1, u.x + dr.dx)), y: Math.max(0, Math.min(1, u.y + dr.dy)) } as Partial<PlayLayer>);
        e.preventDefault(); e.stopPropagation();
        return;
      }
      if (this.drawing) { container.style.cursor = 'crosshair'; return; }
      const overNull = hitNull(u);
      const sel = this.editing ? this.record.layers.find(x => x.id === this.selectedId && this.handled(x)) : undefined;
      const am = this.activeMask(sel);
      const sb = sel ? (am ? maskBounds(sel, am, this.value, u.w / Math.max(1, u.h)) : this.bounds(sel)) : null;
      const h = sb ? handleAt(sb, u.x * u.w, (1 - u.y) * u.h, u.w, u.h) : null;
      if (sel && !h && sel.masks?.length && this.maskPress(sel, u, 9)) { container.style.cursor = 'move'; return; }
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

  /** Where the pointer is over the picture now (a copy), for recording a take. */
  pointerNow(): KitPointer { return { ...this.pointer }; }

  // ── Drawing ────────────────────────────────────────────────────────────────

  private env(gl: HTMLCanvasElement, W: number, H: number, dpr: number, time: number, dt: number, forExport = false): KitEnv {
    const needsAudio = this.record.layers.some(l => l.kind === 'audio' && l.visible);
    return {
      gl, W, H, dpr, time, dt,
      needCoarse: grainsReadPicture(this.record) || readsPicture(this.record),
      // The Finish stack reads where the camera sees movement (an effect's Where, or Displace).
      needMotion: this.hasFinish() && fnUsesMotion(this.finish),
      value: (l, k) => playEngine.layerValue(l.id, k, (l as unknown as Record<string, number>)[k]),
      pointer: this.replayPointer ?? this.pointer,
      markers: !forExport && this.guides,
      editing: this.editing && !forExport && this.guides,
      selectedId: this.selectedId,
      hidden: playBackground.hidden(),
      backdrop: this.record.display?.backdrop ?? [0, 0, 0],
      // An offline frame gets its background painted in by compositePixels (the video seeked to the frame).
      background: forExport ? null : playBackground.kitBackground(),
      // A Background layer: its graph sources as ShaderCanvas drew them (live) or an offline render did, its videos on the clock.
      graphFrame: item => (forExport ? playBackground.offlineGraphFrame(item) : playBackground.graphFrame(item)),
      video: item => playBackground.queueVideo(item),
      allowDirect: !forExport,
      audio: needsAudio ? liveAudio.raw() : null,
      audioFor: l => {
        // A take playing back: the sound it recorded, where it has it.
        const fromTake = this.replayAudio?.(l);
        if (fromTake !== undefined) return fromTake;
        return (l as { input?: string }).input === 'file' ? layerAudio.raw(l.id) : needsAudio ? liveAudio.raw() : null;
      },
      camera: cameraInput.element(),
      layerVideo: l => playVideoLayers.element(l.id),
      image: src => this.image(src),
      sensor: forExport ? () => {} : (k, v) => playEngine.setSensor(k, v),
      override: forExport || this.replaying ? () => {} : (id, k, v) => playEngine.setOverride(id, k, v),
      // A take's recorded places for a relationship's members win over the simulation while it plays back or renders.
      placed: forExport || this.replaying ? (id, k) => playEngine.overrideOf(id, k) : undefined,
      // Hands: live only. A take playing back or rendering puts following nulls where it recorded them.
      hand: forExport || this.replaying ? undefined : (side, point) => playEngine.handPoint(side as 'left' | 'right' | 'any', point),
      handsLive: !forExport && !this.replaying && playEngine.handState().live,
      hands: this.handsOverlay(forExport),
      // Face and body tracking, the same way.
      track: forExport || this.replaying ? undefined : (kind, point) => playEngine.trackPoint(kind, point),
      trackLive: kind => !forExport && !this.replaying && playEngine.trackLive(kind),
      tracks: this.tracksOverlay(forExport),
      // The graph's Layers node can't read the layers while the graph isn't running.
      shaderTap: forExport || playBackground.active() || (playBackground.layerActive() && !planShowsThis(this.lastQueue)) ? undefined : this.shaderTap ?? undefined,
      scriptStatus: forExport ? undefined : setScriptStatus,
      readValue: path => playEngine.readValue(path),
      // A sketch's console goes to the Sketch editor's Console (and nowhere while rendering an export).
      scriptLog: forExport ? () => {} : logScript,
      // three.js for 3D Script layers, once loaded (they wait until then).
      three: threeRuntime(),
      // Datasets for Data layers and s.data() in sketches (their frozen results, Normalize applied).
      data: kitDataset,
    };
  }

  /**
   * The hands' skeleton over the picture: live, with the setup's Show hand on
   * picture on. Its own switch, apart from the guides: H hides the guides and
   * leaves the hands to it, so they can be shown just for a moment.
   */
  private handsOverlay(forExport: boolean): KitEnv['hands'] {
    if (forExport || this.replaying) return null;
    const st = playEngine.handState();
    if (!st.live) return null;
    const h = this.record.hands ?? DEFAULT_HANDS;
    return h.overlay ? { state: st, colour: h.colour } : null;
  }

  /** The face and the body over the picture, each with its own Show on picture switch and colour. */
  private tracksOverlay(forExport: boolean): KitEnv['tracks'] {
    if (forExport || this.replaying) return null;
    const out: NonNullable<KitEnv['tracks']> = [];
    for (const kind of ['face', 'pose'] as const) {
      const st = playEngine.trackState(kind);
      const s = this.record[kind] ?? (kind === 'face' ? DEFAULT_FACE : DEFAULT_POSE);
      if (st.live && s.overlay) out.push({ kind, state: st, colour: s.colour });
    }
    return out.length ? out : null;
  }

  draw(gl: HTMLCanvasElement, time: number, dt: number): void {
    const canvas = this.canvas, ctx = this.ctx;
    if (!canvas || !ctx) return;
    this.lastGl = gl;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = Math.max(1, Math.round(gl.clientWidth * dpr)), H = Math.max(1, Math.round(gl.clientHeight * dpr));
    if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
    this.aspect = W / H;
    playEngine.setAspect(this.aspect);
    // The Finish stack: the layers draw as usual, their guides go on a canvas of their own above the finished picture.
    const finishing = this.hasFinish() && this.ensureFinishCanvases();
    let gx: CanvasRenderingContext2D | null = null;
    if (finishing && this.guidesEl) {
      const g = this.guidesEl;
      if (g.width !== W || g.height !== H) { g.width = W; g.height = H; }
      gx = g.getContext('2d');
      gx?.clearRect(0, 0, W, H);
    }
    const env = this.env(gl, W, H, dpr, time, dt);
    if (gx) env.guides = gx;
    env.alphaLayers = this.alphaLayers();
    // The Performance panel is open: time the whole overlay and each layer.
    const timing = playPerfOn();
    const t0 = timing ? performance.now() : 0;
    if (timing) env.layerTime = recordPlayLayer;
    this.kit.frame(ctx, this.record, env);
    if (timing) recordPlayStage('overlay', performance.now() - t0);
    this.grainTap?.(this.kit, this.record, this.aspect, time, false);
    const top = gx ?? ctx;
    if (this.drawing) this.drawOutline(top, W, H, dpr);
    else if (this.editing && this.guides && this.selectedId) this.drawHandles(top, W, H, dpr);
    // The finished frame is drawn at the overlay's size, up to about 1080p's worth of pixels (a retina preview would be 3 to 4 times that).
    const fs = Math.min(1, Math.sqrt(FINISH_MAX_PIXELS / (W * H)));
    const finished = finishing && !!this.live?.draw({
      finish: this.finish!, value: this.finishValue, picture: gl, layers: canvas,
      layerAlpha: id => this.kit.layerCanvas(id), motion: this.kit.motionMap(), width: Math.round(W * fs), height: Math.round(H * fs), time,
    });
    this.showFinish(finished);
    // Copied here, in the same animation frame the picture was drawn: the GL canvas keeps no
    // drawing buffer between frames, so a copy taken from another loop reads black.
    if (this.composite) this.fillComposite(this.composite, gl, canvas, finished);
    if (this.livePicture) this.fillComposite(this.livePicture, gl, canvas, finished);
  }

  private fillComposite(c: HTMLCanvasElement, gl: HTMLCanvasElement, canvas: HTMLCanvasElement, finished: boolean): void {
    if (c.width !== gl.width || c.height !== gl.height) { c.width = gl.width; c.height = gl.height; }
    const x = c.getContext('2d')!;
    if (finished && this.finishEl) x.drawImage(this.finishEl, 0, 0, c.width, c.height);
    else { x.drawImage(gl, 0, 0); x.drawImage(canvas, 0, 0, c.width, c.height); }
  }

  private drawOutline(ctx: CanvasRenderingContext2D, W: number, H: number, dpr: number): void {
    const d = this.drawing!;
    if (d.pts.length < 2) return;
    ctx.save();
    ctx.strokeStyle = d.mask ? MASK_COLOUR : '#5b8cff'; ctx.fillStyle = d.mask ? 'rgba(245,197,66,0.15)' : 'rgba(91,140,255,0.15)'; ctx.lineWidth = 2 * dpr; ctx.setLineDash([6 * dpr, 4 * dpr]);
    ctx.beginPath();
    for (let i = 0; i < d.pts.length; i += 2) { const x = d.pts[i] * W, y = (1 - d.pts[i + 1]) * H; if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); }
    if (d.mode === 'polygon' && this.pointer.over) ctx.lineTo(this.pointer.x * W, (1 - this.pointer.y) * H);
    ctx.fill(); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = d.mask ? MASK_COLOUR : '#5b8cff';
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

  /** The WebGL canvas the last frame was drawn on. */
  pictureCanvas(): HTMLCanvasElement | null { return this.lastGl; }

  // ── The live picture (the Mapping editor's preview) ────────────────────────

  private livePicture: HTMLCanvasElement | null = null;
  private livePictureRefs = 0;
  private wake: (() => void) | null = null;

  /** ShaderCanvas: how to draw a frame now (the live picture asks for one when first taken). */
  setWake(fn: (() => void) | null): void { this.wake = fn; }

  /**
   * A canvas holding the finished picture (shader, layers, Finish) as of the
   * last frame drawn, refreshed inside the render loop every time it draws.
   * Draw it as a texture every frame; never copy the GL canvas from outside
   * the loop. Release when done (shared between takers).
   */
  acquirePicture(): { canvas: HTMLCanvasElement; release: () => void } {
    if (!this.livePicture) this.livePicture = document.createElement('canvas');
    this.livePictureRefs++;
    // A paused, still picture hasn't been drawn since the last change: ask for one frame so the canvas fills.
    this.wake?.();
    let released = false;
    return {
      canvas: this.livePicture,
      release: () => {
        if (released) return;
        released = true;
        if (--this.livePictureRefs <= 0) { this.livePictureRefs = 0; this.livePicture = null; }
      },
    };
  }

  /** Picture + layers as they are now, for a screenshot. */
  snapshot(gl: HTMLCanvasElement): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = gl.width; c.height = gl.height;
    const x = c.getContext('2d')!;
    // With the Finish stack on, its canvas holds the finished frame (the picture and the layers).
    if (this.hasFinish() && this.finishEl && this.finishEl.style.display !== 'none') { x.drawImage(this.finishEl, 0, 0, c.width, c.height); return c; }
    x.drawImage(gl, 0, 0);
    if (this.canvas) x.drawImage(this.canvas, 0, 0, c.width, c.height);
    return c;
  }
  stopCompositing(): void { this.composite = null; }

  private exportKit: LayerKit | null = null;
  private exportCanvas: HTMLCanvasElement | null = null;
  private exportPicture: HTMLCanvasElement | null = null;

  /**
   * Offline export (FFmpeg path, PNG sequence, transparent stills): lay the
   * layers over one read-back frame, in place. A fresh kit starts with the
   * export so particles run the same way every time (with a seed set) and the
   * live preview's state is untouched.
   *
   * Transparent: no backdrop, and the picture as `picture` says:
   *   'own'   its own alpha (the graph ends in Output (RGBA))
   *   'luma'  black turns clear: alpha from brightness, colour un-darkened to
   *           match, so light on black (glows, particles) keys cleanly and
   *           composites like Screen/Add
   *   'drop'  left out: only the layers, over nothing
   */
  compositePixels(rgba: Uint8Array, width: number, height: number, time: number, dt: number, first: boolean, opts: CompositeOptions = {}): void {
    // A take's Look actions (Mosh, Pulse a setting…) on the render's own state, from its first frame.
    if (first) fnLookReset(this.exportLooks);
    fnLookStep(this.exportLooks, time);
    for (const a of opts.actions ?? []) if (isLookAction(a.do)) fnLookAct(this.exportLooks, a, time);
    this.layPixels(rgba, width, height, time, dt, first, opts);
    this.finishPixels(rgba, width, height, time, first);
  }
  /** An offline render's Look actions (its take's, frame by frame): the live ones stay out of it. */
  private exportLooks = fnLookNew();
  private exportFinishValue = (e: FnEffect, key: string) => {
    const id = finishPropId(e.id);
    return fnLookValue(this.exportLooks, id, key) ?? playEngine.layerValueNoLooks(id, key, (e as Record<string, unknown>)[key] as number);
  };

  /**
   * The Finish stack over one offline frame, in place (straight alpha, row 0
   * at the top). Its own renderer, so the live picture's time ring is left
   * alone; `first` starts that renderer's ring over, and every later frame
   * adds to it in order, so a render is the same every time.
   */
  finishPixels(rgba: Uint8Array, width: number, height: number, time: number, first: boolean): void {
    if (!this.hasFinish()) return;
    if (!this.exportFinish) this.exportFinish = fnCreate(null);
    if (!this.exportFinish.ok) return;
    this.exportFinish.draw({
      finish: this.finish!, value: this.exportFinishValue, picture: { data: rgba, width, height }, pixels: true,
      layerAlpha: id => this.exportKit?.layerCanvas(id) ?? null, motion: this.exportKit?.motionMap() ?? null, width, height, time, first,
    });
  }

  private layPixels(rgba: Uint8Array, width: number, height: number, time: number, dt: number, first: boolean, opts: CompositeOptions): void {
    // The Play page's "Layers only" hides the picture as well: transparent, that means none.
    const queue = playBackground.layerActive();
    const dropPicture = !!opts.transparent && (opts.picture === 'drop' || (!queue && this.record.display?.picture === false));
    const luma = !!opts.transparent && opts.picture === 'luma' && !dropPicture;
    if (!this.hasLayers() && !this.alphaLayers()) { if (dropPicture) rgba.fill(0); else if (luma) lumaKey(rgba); return; }
    // A take's seed: the render's random choices are the ones made when it played back.
    // exportQueuePlan may have started this frame already (a Background layer), actions and all.
    if (!this.exportPrepared) {
      if (first || !this.exportKit) { this.exportKit = createLayerKit(); this.exportKit.reset(opts.seed ?? 0); }
      // A take's actions that fired by this frame (bursts, Next line, script buttons).
      for (const a of opts.actions ?? []) this.exportKit.act(a);
    }
    this.exportPrepared = false;
    const kit = this.exportKit!;
    const pic = this.exportPicture ?? (this.exportPicture = document.createElement('canvas'));
    const out = this.exportCanvas ?? (this.exportCanvas = document.createElement('canvas'));
    for (const c of [pic, out]) if (c.width !== width || c.height !== height) { c.width = width; c.height = height; }
    const px = pic.getContext('2d', { willReadFrequently: true })!;
    const img = px.createImageData(width, height);
    const bg = playBackground.kitBackground();
    if (bg) {
      // An image, a video (seeked to this frame by the caller) or a colour is the picture: the frame the GPU read back (if any) is ignored.
      klPaintBackground(pic, bg, width, height);
      rgba.set(px.getImageData(0, 0, width, height).data);
    }
    img.data.set(rgba); px.putImageData(img, 0, 0);
    const ox = out.getContext('2d')!;
    const dpr = Math.max(1, height / Math.max(1, this.canvas?.clientHeight || height));
    const env = this.env(pic, width, height, dpr, time, dt, true);
    env.alphaLayers = this.alphaLayers();
    if (opts.pointer) env.pointer = opts.pointer; // a take's pointer, frame by frame
    const takeAudio = opts.audio;
    if (takeAudio) {
      // A take's audio frames for its audio layers (the live sound where it has none).
      const live = env.audioFor;
      env.audioFor = l => { const a = takeAudio(l); return a !== undefined ? a : live ? live(l) : env.audio; };
    }
    if (opts.transparent) { env.transparent = true; if (dropPicture) env.hidden = true; }
    // A Background layer is the picture: with a transparent export it stays in unless the picture is dropped.
    if (queue && opts.transparent && !dropPicture) env.transparent = false;
    kit.frame(ox, this.record, env);
    this.grainTap?.(kit, this.record, width / height, time, true);
    if (dropPicture) { rgba.set(ox.getImageData(0, 0, width, height).data); return; }
    // Keyed after the layers have read the picture (their mattes and colours see it as it is).
    if (luma) { lumaKey(rgba); img.data.set(rgba); px.putImageData(img, 0, 0); }
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

type CompositeOptions = { transparent?: boolean; picture?: TransparentPicture; pointer?: KitPointer | null; actions?: readonly KitAction[]; seed?: number; audio?: TakeAudioSource | null };

/** What a transparent export does with the shader's picture (see compositePixels). */
export type TransparentPicture = 'own' | 'luma' | 'drop';

/** Alpha from brightness, in place: a = max(r, g, b), colour divided by it (straight alpha). */
export function lumaKey(rgba: Uint8Array): void {
  for (let i = 0; i < rgba.length; i += 4) {
    const m = Math.max(rgba[i], rgba[i + 1], rgba[i + 2]);
    if (m === 0) { rgba[i + 3] = 0; continue; }
    const k = 255 / m;
    rgba[i] = Math.min(255, Math.round(rgba[i] * k));
    rgba[i + 1] = Math.min(255, Math.round(rgba[i + 1] * k));
    rgba[i + 2] = Math.min(255, Math.round(rgba[i + 2] * k));
    rgba[i + 3] = Math.round(m * (rgba[i + 3] / 255));
  }
}
