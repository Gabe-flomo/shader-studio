/**
 * segmentEngine — runs each Segment node's model and hands its mask to the shader (docs/segment-node.md).
 *
 * - `sync(nodes)`: on every graph change. Each Segment node gets a slot; a new mode, kinds or point runs it again.
 * - `setProgram(shaders, textureUniforms)`: after each compile. Each node's code names the texture wired into it
 *   (`// segment-source <its sampler> <wired sampler>`, nodes/definitions/segment.ts), or `picture`.
 * - `afterFrame(ctx)`: right after the preview draws. For each node not waiting on the worker (and due, with Every
 *   Nth frame; while paused only after a change) a frame of its source is copied at the model's size on the GPU
 *   (the Depth engine's Grabber; the picture is read from the canvas) and sent to the worker (segmentWorker.ts).
 *   The picture never waits: the last mask stays until the next arrives, then it is smoothed and uploaded to the
 *   node's 8-bit texture through the store's `nodeTextures`. Click with Follow moves its point to the mask's middle.
 *
 * The worker starts the first time a Segment node has a picture to segment (never at app start); its models
 * are served by the app (public/mediapipe/) and each loads the first time its mode is used.
 */
import * as THREE from 'three';
import type { GraphNode, SubgraphData } from '../../types/nodeGraph';
import { SEGMENT_SOURCE_MARK, SEGMENT_TYPE, segmentClassesOf, segmentModeOf, segmentSideOf, type SegmentModeName } from '../../nodes/definitions/segment';
import { Grabber } from '../depth/engine';

export interface SegmentStatus {
  state: 'idle' | 'loading' | 'no-source' | 'running' | 'error';
  ms: number | null;
  w: number;
  h: number;
  delegate: 'GPU' | 'CPU' | null;
  /** How much of the frame the mask covers (above 0.5), 0–1. */
  cover: number;
  message?: string;
}

export interface SegmentHost {
  setTexture(nodeId: string, tex: THREE.Texture | null): void;
  requestRender(): void;
}

export interface SegmentFrameContext {
  renderer: THREE.WebGLRenderer;
  uniforms: Record<string, THREE.IUniform>;
  canvas: HTMLCanvasElement;
  playing: boolean;
}

/** Every Segment node in a node list, inside groups too. */
export function segmentNodesIn(nodes: readonly GraphNode[], out: GraphNode[] = []): GraphNode[] {
  for (const n of nodes) {
    if (n.type === SEGMENT_TYPE) out.push(n);
    const sg = n.params?.subgraph as SubgraphData | undefined;
    if (sg?.nodes?.length) segmentNodesIn(sg.nodes, out);
  }
  return out;
}

/** The marks a compiled shader carries: the Segment sampler → the sampler wired into it (or 'picture'). */
export function segmentSources(shaders: readonly string[]): Map<string, string> {
  const out = new Map<string, string>();
  const re = new RegExp(`${SEGMENT_SOURCE_MARK.replace(/[/]/g, '\\/')}(\\w+) (\\w+)`, 'g');
  for (const fs of shaders) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(fs || ''))) if (!out.has(m[1])) out.set(m[1], m[2]);
  }
  return out;
}

/** The size to read a source at: `side` on its long side, its shape kept. */
export function segmentGrabSize(w: number, h: number, side: number): { w: number; h: number } {
  if (!(w > 0 && h > 0)) return { w: side, h: Math.round(side * 9 / 16) };
  const s = side / Math.max(w, h);
  return { w: Math.max(8, Math.round(w * s)), h: Math.max(8, Math.round(h * s)) };
}

/** The mask's middle (where it is above 0.5), top-down 0–1 coordinates, and how much of the frame it covers. */
export function maskCentre(mask: Float32Array, w: number, h: number): { x: number; y: number; cover: number } | null {
  let n = 0, sx = 0, sy = 0;
  for (let i = 0; i < mask.length; i++) if (mask[i] > 0.5) { const x = i % w; n++; sx += x; sy += (i - x) / w; }
  return n ? { x: (sx / n + 0.5) / w, y: (sy / n + 0.5) / h, cover: n / (w * h) } : null;
}

/** Blend the new mask with the last (same size) by `k`. */
export function smoothMask(prev: Float32Array | null, next: Float32Array, k: number): Float32Array {
  const m = Math.max(0, Math.min(0.95, k));
  if (!prev || prev.length !== next.length || m === 0) return next;
  const out = new Float32Array(next.length);
  for (let i = 0; i < next.length; i++) out[i] = prev[i] * m + next[i] * (1 - m);
  return out;
}

const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const settingsKey = (n: GraphNode) => JSON.stringify([segmentModeOf(n), segmentClassesOf(n), n.params.pointX, n.params.pointY, n.params.resolution, n.params.follow]);

interface Slot {
  node: GraphNode;
  status: SegmentStatus;
  busy: boolean;
  framesSince: number;
  key: string;
  dirty: boolean;
  mask: Float32Array | null;
  mw: number;
  mh: number;
  tex: THREE.DataTexture | null;
  /** Click: where to look next frame (top-down 0–1), moved by Follow. */
  point: [number, number];
}

const idleStatus = (): SegmentStatus => ({ state: 'idle', ms: null, w: 0, h: 0, delegate: null, cover: 0 });

type WorkerOut =
  | { type: 'ready' }
  | { type: 'failed'; message: string }
  | { type: 'mask'; job: number; mask: Float32Array; w: number; h: number; ms: number; delegate: 'GPU' | 'CPU' }
  | { type: 'error'; job: number; message: string };

class SegmentEngine {
  private host: SegmentHost | null = null;
  private slots = new Map<string, Slot>();
  private samplerNode = new Map<string, string>();
  private sources = new Map<string, string>();
  private grabber: Grabber | null = null;
  private canvas2d: HTMLCanvasElement | null = null;
  private listeners = new Set<() => void>();
  /** One worker per mode: MediaPipe builds one kind of task per WASM instance (a second fails: "ModuleFactory not set"). */
  private workers = new Map<SegmentModeName, Worker>();
  private jobs = new Map<number, (r: WorkerOut) => void>();
  private nextJob = 1;
  private lastNotify = 0;

  contextLost(): void {
    this.grabber?.drop(); this.grabber = null;
    for (const s of this.slots.values()) { s.tex?.dispose(); s.tex = null; }
  }

  setHost(host: SegmentHost | null): void {
    this.host = host;
    if (host) for (const [id, s] of this.slots) if (s.tex) host.setTexture(id, s.tex);
  }

  onChange(fn: () => void): () => void { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }
  private changed() { for (const fn of this.listeners) fn(); }

  status(nodeId: string): SegmentStatus { return this.slots.get(nodeId)?.status ?? idleStatus(); }

  sync(nodes: readonly GraphNode[]): void {
    const want = new Map(segmentNodesIn(nodes).map(n => [n.id, n]));
    for (const [id, s] of this.slots) if (!want.has(id)) { s.tex?.dispose(); this.slots.delete(id); this.host?.setTexture(id, null); }
    let rerun = false;
    for (const [id, n] of want) {
      let s = this.slots.get(id);
      const point: [number, number] = [num(n.params.pointX, 0.5), 1 - num(n.params.pointY, 0.5)];
      if (!s) { s = { node: n, status: idleStatus(), busy: false, framesSince: 0, key: '', dirty: true, mask: null, mw: 0, mh: 0, tex: null, point }; this.slots.set(id, s); rerun = true; }
      s.node = n;
      const key = settingsKey(n);
      if (key !== s.key) { s.key = key; s.dirty = true; s.point = point; s.mask = null; rerun = true; }
    }
    if (rerun) this.host?.requestRender();
  }

  setProgram(shaders: readonly string[], textureUniforms: Record<string, string>): void {
    this.sources = segmentSources(shaders);
    this.samplerNode.clear();
    for (const sampler of this.sources.keys()) { const id = textureUniforms[sampler]; if (id) this.samplerNode.set(sampler, id); }
    for (const s of this.slots.values()) s.dirty = true;
    // Paused, nothing else draws a frame: ask for one so a still is segmented.
    if (this.samplerNode.size) this.host?.requestRender();
  }

  wants(playing: boolean): boolean {
    if (!this.samplerNode.size) return false;
    for (const id of this.samplerNode.values()) {
      const s = this.slots.get(id);
      if (s && !s.busy && (playing || s.dirty)) return true;
    }
    return false;
  }

  private ensureWorker(mode: SegmentModeName): Worker {
    const had = this.workers.get(mode);
    if (had) return had;
    const base = `${import.meta.env.BASE_URL}mediapipe/`;
    const abs = (p: string) => new URL(p, window.location.href).href;
    const w = new Worker(new URL('./segmentWorker.ts', import.meta.url), { type: 'module', name: `segment-${mode}` });
    w.addEventListener('message', (e: MessageEvent<WorkerOut>) => {
      const d = e.data;
      if (d.type === 'failed') { for (const s of this.slots.values()) if (segmentModeOf(s.node) === mode) s.status = { ...s.status, state: 'error', message: d.message }; this.changed(); return; }
      if (d.type === 'mask' || d.type === 'error') { const cb = this.jobs.get(d.job); this.jobs.delete(d.job); cb?.(d); }
    });
    w.addEventListener('error', e => { for (const s of this.slots.values()) if (segmentModeOf(s.node) === mode) { s.busy = false; s.status = { ...s.status, state: 'error', message: e.message || 'The segmentation worker failed to load' }; } this.changed(); });
    w.postMessage({
      type: 'init',
      wasmJs: abs(`${base}wasm/vision_wasm_module_internal.js`),
      wasmBin: abs(`${base}wasm/vision_wasm_module_internal.wasm`),
      models: { people: abs(`${base}selfie_segmenter.tflite`), objects: abs(`${base}deeplab_v3.tflite`), click: abs(`${base}magic_touch.tflite`) },
    });
    this.workers.set(mode, w);
    return w;
  }

  afterFrame(ctx: SegmentFrameContext): void {
    for (const [sampler, id] of this.samplerNode) {
      const s = this.slots.get(id);
      if (!s || s.busy) continue;
      s.framesSince++;
      const every = s.node.params.update === 'every' ? Math.max(1, Math.round(num(s.node.params.every, 2))) : 1;
      if (!ctx.playing && !s.dirty) continue;
      if (ctx.playing && !s.dirty && s.framesSince < every) continue;
      const src = this.sources.get(sampler) ?? 'picture';
      const tex = src === 'picture' ? null : (ctx.uniforms[src]?.value as THREE.Texture | null | undefined) ?? null;
      const img = tex?.image as { width?: number; height?: number; videoWidth?: number; videoHeight?: number } | undefined;
      const sw = tex ? img?.videoWidth || img?.width || 0 : ctx.canvas.width;
      const sh = tex ? img?.videoHeight || img?.height || 0 : ctx.canvas.height;
      if (src !== 'picture' && (!tex || !(sw > 0 && sh > 0))) {
        if (s.status.state !== 'no-source') { s.status = { ...idleStatus(), state: 'no-source', message: 'Its texture has no picture yet.' }; this.changed(); }
        continue;
      }
      const { w, h } = segmentGrabSize(sw, sh, segmentSideOf(s.node));
      let rgba: Uint8ClampedArray<ArrayBuffer>;
      try {
        if (tex) {
          this.grabber ??= new Grabber();
          rgba = new Uint8ClampedArray(flipRows(this.grabber.grab(ctx.renderer, tex, w, h), w, h).buffer as ArrayBuffer);
        } else {
          const c = (this.canvas2d ??= document.createElement('canvas'));
          if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
          const g = c.getContext('2d', { willReadFrequently: true });
          if (!g) continue;
          g.drawImage(ctx.canvas, 0, 0, w, h);
          rgba = g.getImageData(0, 0, w, h).data as Uint8ClampedArray<ArrayBuffer>;
        }
      } catch (e) {
        s.status = { ...s.status, state: 'error', message: e instanceof Error ? e.message : String(e) };
        this.changed();
        continue;
      }
      s.busy = true; s.dirty = false; s.framesSince = 0;
      if (s.status.state === 'idle' || s.status.state === 'no-source') { s.status = { ...s.status, state: 'loading', message: undefined }; this.changed(); }
      const mode: SegmentModeName = segmentModeOf(s.node);
      const job = this.nextJob++;
      const playing = ctx.playing;
      this.jobs.set(job, r => this.received(id, s, r, playing));
      this.ensureWorker(mode).postMessage({ type: 'segment', job, mode, classes: segmentClassesOf(s.node), point: s.point, t: performance.now(), image: new ImageData(rgba, w, h) }, [rgba.buffer]);
    }
  }

  private received(id: string, s: Slot, r: WorkerOut, playing: boolean): void {
    s.busy = false;
    if (this.slots.get(id) !== s) return;
    if (r.type === 'error') { s.status = { ...idleStatus(), state: 'error', message: r.message }; this.changed(); return; }
    if (r.type !== 'mask') return;
    const same = s.mw === r.w && s.mh === r.h;
    s.mask = smoothMask(same ? s.mask : null, r.mask, num(s.node.params.smoothing, 0.3));
    s.mw = r.w; s.mh = r.h;
    const c = maskCentre(s.mask, r.w, r.h);
    // Click, Follow: look next frame where the object is now.
    if (segmentModeOf(s.node) === 'click' && s.node.params.follow !== false && c) s.point = [c.x, c.y];
    this.upload(id, s);
    const first = s.status.state !== 'running';
    s.status = { state: 'running', ms: r.ms, w: r.w, h: r.h, delegate: r.delegate, cover: c?.cover ?? 0 };
    // The card's live numbers: a few times a second, not every frame.
    const now = performance.now();
    if (first || now - this.lastNotify > 250) { this.lastNotify = now; this.changed(); }
    if (!playing) this.host?.requestRender();
  }

  private upload(id: string, s: Slot): void {
    if (!s.mask) return;
    const w = s.mw, h = s.mh;
    let tex = s.tex;
    if (!tex || tex.image.width !== w || tex.image.height !== h) {
      tex?.dispose();
      tex = new THREE.DataTexture(new Uint8Array(w * h), w, h, THREE.RedFormat, THREE.UnsignedByteType);
      tex.minFilter = THREE.LinearFilter; tex.magFilter = THREE.LinearFilter;
      tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
      tex.generateMipmaps = false;
      tex.flipY = false;
      tex.unpackAlignment = 1;
      // Web pages don't segment yet: the export encodes this blank in its place.
      tex.userData.canvas8 = blankCanvas();
      s.tex = tex;
      this.host?.setTexture(id, tex);
    }
    const data = tex.image.data as Uint8Array;
    // Rows bottom-up, as texture coordinates run.
    for (let y = 0; y < h; y++) {
      const src = (h - 1 - y) * w, dst = y * w;
      for (let x = 0; x < w; x++) data[dst + x] = Math.round(Math.max(0, Math.min(1, s.mask[src + x])) * 255);
    }
    tex.needsUpdate = true;
  }
}

let blank: HTMLCanvasElement | null = null;
function blankCanvas(): HTMLCanvasElement | undefined {
  if (typeof document === 'undefined') return undefined;
  if (!blank) { blank = document.createElement('canvas'); blank.width = blank.height = 1; const g = blank.getContext('2d'); if (g) { g.fillStyle = '#000'; g.fillRect(0, 0, 1, 1); } }
  return blank;
}

function flipRows(rgba: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(rgba.length), row = w * 4;
  for (let y = 0; y < h; y++) out.set(rgba.subarray((h - 1 - y) * row, (h - y) * row), y * row);
  return out;
}

export const segmentEngine = new SegmentEngine();

/** For checking in dev: `window.__segmentEngine`. */
if (import.meta.env?.DEV && typeof window !== 'undefined') (window as unknown as { __segmentEngine?: unknown }).__segmentEngine = segmentEngine;
