/**
 * blobEngine — finds and follows each Blob Track node's blobs and hands them to the shader (docs/blob-track.md).
 *
 * - `sync(nodes)`: on every graph change. Each Blob Track node gets a slot; a changed setting runs it again.
 * - `setProgram(shaders, textureUniforms)`: after each compile. Each node's code names the texture wired into it
 *   (`// blob-source <its sampler> <wired sampler>`, nodes/definitions/blobTrack.ts), or `picture`.
 * - `afterFrame(ctx)`: right after the preview draws, while playing (or once after a change while paused): the
 *   source is copied small on the GPU and read back (lib/depth/engine.ts Grabber; the picture is read from the
 *   canvas), the blobs are found and matched on the CPU (lib/blobs/track.ts), and the result is uploaded to the
 *   node's float texture (BLOB_SLOTS × BLOB_ROWS: the blobs, and where their marks are drawn in Jump / Pulse) through the store's `nodeTextures`.
 */
import * as THREE from 'three';
import type { GraphNode, SubgraphData } from '../../types/nodeGraph';
import { BLOB_SOURCE_MARK, BLOB_TRACK_TYPE, blobResolutionOf } from '../../nodes/definitions/blobTrack';
import { Grabber } from '../depth/engine';
import { BLOB_ROWS, BLOB_SLOTS, blobGrabSize, emptyMarkState, emptyTrackState, findBlobs, maskOf, packBlobs, placeMarks, trackBlobs, visibleTracks, type MarkMotion, type MarkState, type MaskChannel, type Track, type TrackState } from './track';

export type BlobState = 'idle' | 'no-source' | 'running' | 'error';

export interface BlobStatus {
  state: BlobState;
  /** Blobs seen in the last frame. */
  count: number;
  /** Last find + follow time, readback included (ms). */
  ms: number | null;
  /** The size the mask is read at. */
  w: number;
  h: number;
  message?: string;
}

export interface BlobHost {
  setTexture(nodeId: string, tex: THREE.Texture | null): void;
  requestRender(): void;
}

export interface BlobFrameContext {
  renderer: THREE.WebGLRenderer;
  uniforms: Record<string, THREE.IUniform>;
  canvas: HTMLCanvasElement;
  playing: boolean;
}

/** Every Blob Track node in a node list, inside groups too. */
export function blobNodesIn(nodes: readonly GraphNode[], out: GraphNode[] = []): GraphNode[] {
  for (const n of nodes) {
    if (n.type === BLOB_TRACK_TYPE) out.push(n);
    const sg = n.params?.subgraph as SubgraphData | undefined;
    if (sg?.nodes?.length) blobNodesIn(sg.nodes, out);
  }
  return out;
}

/** The marks a compiled shader carries: the Blob Track sampler → the sampler wired into it (or 'picture'). */
export function blobSources(shaders: readonly string[]): Map<string, string> {
  const out = new Map<string, string>();
  const re = new RegExp(`${BLOB_SOURCE_MARK.replace(/[/]/g, '\\/')}(\\w+) (\\w+)`, 'g');
  for (const fs of shaders) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(fs || ''))) if (!out.has(m[1])) out.set(m[1], m[2]);
  }
  return out;
}

/** The settings the CPU side reads, as one key: a change runs the node again even while paused. */
const settingsKey = (n: GraphNode) => JSON.stringify(['threshold', 'channel', 'invert', 'resolution', 'minSize', 'maxSize', 'maxBlobs', 'maxJump', 'memory', 'smoothing', 'motion', 'jumpRate', 'scatter', 'hold'].map(k => n.params[k]));

const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/** One frame of blob finding on a mask's RGBA bytes (rows bottom-up): the node's settings applied. */
export function stepBlobs(state: TrackState, rgba: Uint8Array, w: number, h: number, params: Record<string, unknown>): TrackState {
  const channel = (['luma', 'red', 'alpha'].includes(params.channel as string) ? params.channel : 'luma') as MaskChannel;
  const mask = maskOf(rgba, w, h, num(params.threshold, 0.5), channel, params.invert === true);
  const max = Math.max(1, Math.min(BLOB_SLOTS, Math.round(num(params.maxBlobs, BLOB_SLOTS))));
  const blobs = findBlobs(mask, w, h, { minArea: num(params.minSize, 0.002), maxArea: num(params.maxSize, 0.5), max });
  return trackBlobs(state, blobs, { maxJump: num(params.maxJump, 0.15), memory: num(params.memory, 10), smoothing: num(params.smoothing, 0.3), aspect: w / h });
}

interface Slot {
  node: GraphNode;
  status: BlobStatus;
  track: TrackState;
  visible: Track[];
  marks: MarkState;
  tex: THREE.DataTexture | null;
  key: string;
  dirty: boolean;
}

const idleStatus = (): BlobStatus => ({ state: 'idle', count: 0, ms: null, w: 0, h: 0 });

class BlobEngine {
  private host: BlobHost | null = null;
  private slots = new Map<string, Slot>();
  private samplerNode = new Map<string, string>();
  private sources = new Map<string, string>();
  private grabber: Grabber | null = null;
  private canvas2d: HTMLCanvasElement | null = null;
  private listeners = new Set<() => void>();

  contextLost(): void {
    this.grabber?.drop(); this.grabber = null;
    for (const s of this.slots.values()) { s.tex?.dispose(); s.tex = null; }
  }

  setHost(host: BlobHost | null): void {
    this.host = host;
    if (host) for (const [id, s] of this.slots) if (s.tex) host.setTexture(id, s.tex);
  }

  onChange(fn: () => void): () => void { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }
  private changed() { for (const fn of this.listeners) fn(); }

  status(nodeId: string): BlobStatus { return this.slots.get(nodeId)?.status ?? idleStatus(); }
  /** The blobs seen in the node's last frame, oldest ID first. */
  blobs(nodeId: string): readonly Track[] { return this.slots.get(nodeId)?.visible ?? []; }

  sync(nodes: readonly GraphNode[]): void {
    const want = new Map(blobNodesIn(nodes).map(n => [n.id, n]));
    for (const [id, s] of this.slots) if (!want.has(id)) { s.tex?.dispose(); this.slots.delete(id); this.host?.setTexture(id, null); }
    let rerun = false;
    for (const [id, n] of want) {
      let s = this.slots.get(id);
      if (!s) { s = { node: n, status: idleStatus(), track: emptyTrackState(), visible: [], marks: emptyMarkState(), tex: null, key: '', dirty: true }; this.slots.set(id, s); rerun = true; }
      s.node = n;
      const key = settingsKey(n);
      if (key !== s.key) { s.key = key; s.dirty = true; rerun = true; }
    }
    if (rerun) this.host?.requestRender();
  }

  setProgram(shaders: readonly string[], textureUniforms: Record<string, string>): void {
    this.sources = blobSources(shaders);
    this.samplerNode.clear();
    for (const sampler of this.sources.keys()) { const id = textureUniforms[sampler]; if (id) this.samplerNode.set(sampler, id); }
    for (const s of this.slots.values()) s.dirty = true;
  }

  /** Any node to run this frame (ShaderCanvas skips afterFrame otherwise). */
  wants(playing: boolean): boolean {
    if (!this.samplerNode.size) return false;
    if (playing) return true;
    for (const s of this.slots.values()) if (s.dirty) return true;
    return false;
  }

  afterFrame(ctx: BlobFrameContext): void {
    for (const [sampler, id] of this.samplerNode) {
      const s = this.slots.get(id);
      if (!s || (!ctx.playing && !s.dirty)) continue;
      s.dirty = false;
      const t0 = performance.now();
      const src = this.sources.get(sampler) ?? 'picture';
      const tex = src === 'picture' ? null : (ctx.uniforms[src]?.value as THREE.Texture | null | undefined) ?? null;
      const img = tex?.image as { width?: number; height?: number; videoWidth?: number; videoHeight?: number } | undefined;
      const sw = tex ? img?.videoWidth || img?.width || 0 : ctx.canvas.width;
      const sh = tex ? img?.videoHeight || img?.height || 0 : ctx.canvas.height;
      if (src !== 'picture' && (!tex || !(sw > 0 && sh > 0))) {
        if (s.status.state !== 'no-source') { s.status = { ...idleStatus(), state: 'no-source', message: 'Its texture has no picture yet.' }; this.changed(); }
        continue;
      }
      const { w, h } = blobGrabSize(sw, sh, blobResolutionOf(s.node));
      let rgba: Uint8Array;
      try {
        if (tex) {
          this.grabber ??= new Grabber();
          rgba = this.grabber.grab(ctx.renderer, tex, w, h);
        } else {
          const c = (this.canvas2d ??= document.createElement('canvas'));
          if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
          const g = c.getContext('2d', { willReadFrequently: true });
          if (!g) continue;
          g.drawImage(ctx.canvas, 0, 0, w, h);
          rgba = flipRows(new Uint8Array(g.getImageData(0, 0, w, h).data.buffer), w, h);
        }
      } catch (e) {
        s.status = { ...s.status, state: 'error', message: e instanceof Error ? e.message : String(e) };
        this.changed();
        continue;
      }
      s.track = stepBlobs(s.track, rgba, w, h, s.node.params);
      s.visible = visibleTracks(s.track, num(s.node.params.maxBlobs, BLOB_SLOTS));
      this.upload(id, s);
      const before = s.status;
      s.status = { state: 'running', count: s.visible.length, ms: performance.now() - t0, w, h };
      // The card shows the count: tell it when that (or the state) changes, not every frame.
      if (before.state !== 'running' || before.count !== s.status.count || before.w !== w || before.h !== h) this.changed();
      if (!ctx.playing) this.host?.requestRender();
    }
  }

  private upload(id: string, s: Slot): void {
    let tex = s.tex;
    if (!tex) {
      tex = new THREE.DataTexture(new Float32Array(BLOB_SLOTS * BLOB_ROWS * 4), BLOB_SLOTS, BLOB_ROWS, THREE.RGBAFormat, THREE.FloatType);
      tex.minFilter = THREE.NearestFilter; tex.magFilter = THREE.NearestFilter;
      tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
      tex.generateMipmaps = false;
      tex.flipY = false;
      // Web pages find no blobs yet: the export encodes this blank in its place.
      tex.userData.canvas8 = blankCanvas();
      s.tex = tex;
      this.host?.setTexture(id, tex);
    }
    const P = s.node.params;
    const motion: MarkMotion = P.motion === 'jump' || P.motion === 'pulse' ? P.motion : 'follow';
    const marks = placeMarks(s.marks, s.visible, motion, performance.now() / 1000, { jumpRate: num(P.jumpRate, 4), scatter: num(P.scatter, 0.15), hold: num(P.hold, 2) });
    packBlobs(s.visible, tex.image.data as Float32Array<ArrayBuffer>, marks);
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

export const blobEngine = new BlobEngine();

/** For checking in dev: `window.__blobEngine`. */
if (import.meta.env?.DEV && typeof window !== 'undefined') (window as unknown as { __blobEngine?: unknown }).__blobEngine = blobEngine;
