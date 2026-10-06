/**
 * timeCubes — builds and keeps each Time Cube node's volume (docs/time-cube.md):
 * the frames of its video (or the test clip) laid out on one atlas canvas,
 * handed to the shader as the node's texture.
 *
 * - `sync(nodes)`: on every graph change (ShaderCanvas). Each Time Cube node
 *   gets the volume its settings describe. Volumes are cached by what they
 *   hold (source, video, tile size, frame times), so a re-render, an undo or
 *   a second node with the same settings never decodes again. A changed
 *   setting waits a moment (a slider drag builds once, at the end).
 * - `cancel(nodeId)` / `rebuild(nodeId)`: the card's buttons.
 * - `settled()`: offline renders wait for builds in flight.
 *
 * Textures go through the store's `nodeTextures` (keyed by node id), the
 * same path a Texture Input's take, so the preview, Pass programs, Present
 * and web exports (which encode the atlas as an image) all bind it alike.
 */
import * as THREE from 'three';
import type { GraphNode, SubgraphData } from '../../types/nodeGraph';
import { getVideo } from '../backgroundLibrary';
import { planFrameStack, stackSettingsOf, tileOrigin, type StackPlan, type VideoMeta } from './plan';
import { DEMO_META, TimeCubeCancelled, decodeVideoFrames, demoReader, openVideoReader, paintDemoFrames, probeVideo, type FrameReader } from './frames';
import { deepTexture, reorderDeep } from './deep';
import {
  combineFramesFloat, combineKey, combineSettingsOf, frameMotion, frameOrder, frameStat, orderKey, orderSettingsOf, subFrameTimes,
  type CombineSettings, type FrameStat, type OrderSettings,
} from './order';

export const TIME_CUBE_TYPE = 'timeCube';

export type TimeCubeState = 'waiting' | 'building' | 'ready' | 'missing' | 'error' | 'cancelled';

export interface TimeCubeStatus {
  state: TimeCubeState;
  done: number;
  total: number;
  message?: string;
}

/** The video a Time Cube node reads: the test clip, or a library video by id. */
export function timeCubeSource(node: GraphNode): { kind: 'demo' } | { kind: 'library'; videoId: string } | null {
  if (node.params.source !== 'library') return { kind: 'demo' };
  const id = typeof node.params.videoId === 'string' ? node.params.videoId : '';
  return id ? { kind: 'library', videoId: id } : null;
}

/** A video's size and length as the node keeps it (`_meta`, written when the video is chosen). */
export function timeCubeMeta(node: GraphNode): VideoMeta | null {
  if (node.params.source !== 'library') return DEMO_META;
  const m = node.params._meta as Partial<VideoMeta> | undefined;
  return m && typeof m.width === 'number' && m.width > 0 && typeof m.height === 'number' && m.height > 0 && typeof m.duration === 'number'
    ? { width: m.width, height: m.height, duration: m.duration } : null;
}

/** The node's frame stack, or null while its video's size is unknown. */
export function timeCubePlan(node: GraphNode): StackPlan | null {
  const meta = timeCubeMeta(node);
  return meta ? planFrameStack(meta, stackSettingsOf(node.params)) : null;
}

/** What a volume's frames are before any reordering (Frames from included): volumes with the same base share their decoding. */
export function baseVolumeKey(node: GraphNode): string | null {
  const src = timeCubeSource(node), plan = timeCubePlan(node);
  if (!src || !plan) return null;
  const who = src.kind === 'demo' ? 'demo' : `vid:${src.videoId}`;
  return `${who}|${plan.tileW}x${plan.tileH}|${plan.cols}x${plan.rows}|${plan.frames}|${plan.clipKey}${combineKey(combineSettingsOf(node.params))}${stackSettingsOf(node.params).deep ? '|16' : ''}`;
}

/** What a volume holds: two nodes with the same key share one build. The defaults (Pick, in time order) keep the old keys. */
export function volumeKey(node: GraphNode): string | null {
  const base = baseVolumeKey(node);
  return base === null ? null : base + orderKey(orderSettingsOf(node.params));
}

/** A volume's frames: each one's numbers (in time order) and which of them each tile shows. */
export interface TimeCubeFrameStats {
  stats: FrameStat[];
  /** Tile i shows time-ordered frame order[i]. */
  order: number[];
}

/** Every Time Cube node in a node list, inside groups too. */
export function timeCubeNodesIn(nodes: readonly GraphNode[], out: GraphNode[] = []): GraphNode[] {
  for (const n of nodes) {
    if (n.type === TIME_CUBE_TYPE) out.push(n);
    const sg = n.params?.subgraph as SubgraphData | undefined;
    if (sg?.nodes?.length) timeCubeNodesIn(sg.nodes, out);
  }
  return out;
}

interface Volume {
  key: string;
  baseKey: string;
  plan: StackPlan;
  canvas: HTMLCanvasElement | null;
  /** The frames in time order (the same canvas as `canvas` when they are in time order). */
  base: HTMLCanvasElement | null;
  /** Per-frame numbers, worked out when first needed (sorting, frameStats). */
  stats: FrameStat[] | null;
  order: number[] | null;
  /** A 16-bit volume's frames in time order, unrounded (RGBA, 0–255): `base`'s pixels before they were rounded to bytes. */
  deep: Float32Array | null;
  tex: THREE.Texture | null;
  status: TimeCubeStatus;
  abort: AbortController | null;
  done: Promise<void>;
  /** Last time a node let go of it (for the keep-a-few cache). */
  freedAt: number;
}

export interface TimeCubeHost {
  setTexture(nodeId: string, tex: THREE.Texture | null): void;
  /** A library video's size, found while building, for a node that had none. */
  setMeta(nodeId: string, meta: VideoMeta): void;
}

/** Unused volumes kept for undo / redo and switching back. */
const KEEP_UNUSED = 3;
/** A changed setting waits this long for the next change before building. */
const SETTLE_MS = 350;

class TimeCubes {
  private host: TimeCubeHost | null = null;
  private volumes = new Map<string, Volume>();
  /** nodeId → the key of the volume it shows. */
  private nodeKey = new Map<string, string>();
  private pending = new Map<string, { key: string; timer: ReturnType<typeof setTimeout> }>();
  private probing = new Set<string>();
  private listeners = new Set<() => void>();
  private nodes = new Map<string, GraphNode>();

  setHost(host: TimeCubeHost | null): void {
    this.host = host;
    if (host) for (const [id, key] of this.nodeKey) { const v = this.volumes.get(key); if (v?.tex) host.setTexture(id, v.tex); }
  }

  onChange(fn: () => void): () => void { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }
  private changed() { for (const fn of this.listeners) fn(); }

  /** What the card shows for a node. */
  status(nodeId: string): TimeCubeStatus | null {
    const p = this.pending.get(nodeId);
    if (p) return this.volumes.get(p.key)?.status ?? { state: 'waiting', done: 0, total: 0 };
    const key = this.nodeKey.get(nodeId);
    return key ? this.volumes.get(key)?.status ?? null : null;
  }

  /**
   * A node's frames' numbers (brightness, hue, saturation, motion, key) and their order: worked out
   * once from the built frames and kept with the volume. Null until it is built.
   */
  frameStats(nodeId: string): TimeCubeFrameStats | null {
    const key = this.nodeKey.get(nodeId);
    const v = key ? this.volumes.get(key) : undefined;
    const node = this.nodes.get(nodeId);
    if (!v || v.status.state !== 'ready' || !(v.base ?? v.canvas)) return null;
    if (!v.stats) v.stats = computeStats(v.base ?? v.canvas!, v.plan, orderSettingsOf(node?.params ?? {}));
    return { stats: v.stats, order: v.order ?? Array.from({ length: v.plan.frames }, (_, i) => i) };
  }

  /** The atlas canvas a node shows (the card's strip of frames). */
  canvas(nodeId: string): HTMLCanvasElement | null {
    const key = this.nodeKey.get(nodeId);
    const v = key ? this.volumes.get(key) : undefined;
    return v?.status.state === 'ready' ? v.canvas : null;
  }

  sync(nodes: readonly GraphNode[]): void {
    const want = new Map<string, GraphNode>();
    for (const n of timeCubeNodesIn(nodes)) want.set(n.id, n);
    this.nodes = want;
    for (const id of [...this.nodeKey.keys()]) if (!want.has(id)) this.detach(id);
    for (const [id, p] of this.pending) if (!want.has(id)) { clearTimeout(p.timer); this.pending.delete(id); }
    for (const [id, n] of want) {
      const key = volumeKey(n);
      if (!key) { this.detach(id); this.needMeta(n); continue; }
      if (this.nodeKey.get(id) === key && !this.pending.has(id)) continue;
      const p = this.pending.get(id);
      if (p?.key === key) continue;
      if (p) { clearTimeout(p.timer); this.pending.delete(id); }
      const have = this.volumes.get(key);
      // Already built (or building): show it now. A first build starts at once; a change waits a moment.
      if (have || !this.nodeKey.has(id)) { this.attach(id, key, n); continue; }
      // The shader already has the new layout: show nothing rather than the old frames laid out wrong.
      this.host?.setTexture(id, null);
      this.pending.set(id, { key, timer: setTimeout(() => { this.pending.delete(id); const cur = this.nodes.get(id); if (cur && volumeKey(cur) === key) this.attach(id, key, cur); }, SETTLE_MS) });
      this.changed();
    }
    this.trim();
  }

  private attach(nodeId: string, key: string, node: GraphNode): void {
    const prev = this.nodeKey.get(nodeId);
    this.nodeKey.set(nodeId, key);
    if (prev && prev !== key) this.release(prev);
    let v = this.volumes.get(key);
    if (!v) { v = this.start(key, node); }
    this.host?.setTexture(nodeId, v.tex);
    this.changed();
  }

  private detach(nodeId: string): void {
    const key = this.nodeKey.get(nodeId);
    if (!key) return;
    this.nodeKey.delete(nodeId);
    this.host?.setTexture(nodeId, null);
    this.release(key);
    this.changed();
  }

  private users(key: string): string[] { return [...this.nodeKey].filter(([, k]) => k === key).map(([id]) => id); }

  private release(key: string): void {
    const v = this.volumes.get(key);
    if (!v || this.users(key).length) return;
    v.freedAt = performance.now();
    // A build nobody wants any more stops.
    if (v.status.state === 'building') { v.abort?.abort(); this.volumes.delete(key); }
  }

  /** Keep only a few unused volumes. */
  private trim(): void {
    const unused = [...this.volumes.values()].filter(v => !this.users(v.key).length && v.status.state !== 'building').sort((a, b) => b.freedAt - a.freedAt);
    for (const v of unused.slice(KEEP_UNUSED)) this.drop(v);
  }

  private drop(v: Volume): void {
    v.abort?.abort();
    v.tex?.dispose();
    this.volumes.delete(v.key);
    // A reordered volume shares its time-ordered frames with others of the same base: free a canvas only when nothing else holds it.
    const held = new Set<HTMLCanvasElement>();
    for (const o of this.volumes.values()) { if (o.canvas) held.add(o.canvas); if (o.base) held.add(o.base); }
    for (const c of new Set([v.canvas, v.base])) if (c && !held.has(c)) { c.width = 0; c.height = 0; }
  }

  private start(key: string, node: GraphNode): Volume {
    const plan = timeCubePlan(node)!;
    const comb = combineSettingsOf(node.params), ord = orderSettingsOf(node.params);
    const total = plan.frames * comb.sub;
    const v: Volume = { key, baseKey: baseVolumeKey(node) ?? key, plan, canvas: null, base: null, stats: null, order: null, deep: null, tex: null, status: { state: 'building', done: 0, total }, abort: new AbortController(), done: Promise.resolve(), freedAt: 0 };
    this.volumes.set(key, v);
    const src = timeCubeSource(node)!;
    const signal = v.abort!.signal;
    v.done = (async () => {
      let last = 0;
      const progress = (done: number) => {
        v.status = { ...v.status, done };
        const now = performance.now();
        if (now - last > 80 || done === total) { last = now; this.changed(); }
      };
      // The frames in time order: from a volume already built with the same frames (a reorder decodes nothing), or built now.
      const donor = [...this.volumes.values()].find(o => o !== v && o.baseKey === v.baseKey && o.status.state === 'ready' && (o.base ?? o.canvas));
      let base: HTMLCanvasElement;
      if (donor) { base = (donor.base ?? donor.canvas)!; v.stats = donor.stats; v.deep = donor.deep; }
      else {
        base = document.createElement('canvas');
        base.width = plan.atlasW; base.height = plan.atlasH;
        const ctx = base.getContext('2d', { willReadFrequently: false });
        if (!ctx) throw new Error('No 2D canvas here.');
        ctx.fillStyle = '#000'; ctx.fillRect(0, 0, base.width, base.height);
        if (comb.combine === 'pick') {
          if (src.kind === 'demo') await paintDemoFrames(plan, ctx, progress, signal);
          else {
            const got = await getVideo(src.videoId).catch(() => null);
            if (!got) { v.status = { state: 'missing', done: 0, total, message: 'This video is not in this browser\'s Library. Choose it again.' }; return; }
            await decodeVideoFrames(got.blob, plan, ctx, progress, signal);
          }
        } else {
          let reader: FrameReader;
          if (src.kind === 'demo') reader = demoReader();
          else {
            const got = await getVideo(src.videoId).catch(() => null);
            if (!got) { v.status = { state: 'missing', done: 0, total, message: 'This video is not in this browser\'s Library. Choose it again.' }; return; }
            reader = await openVideoReader(got.blob);
          }
          if (plan.bytes > plan.atlasW * plan.atlasH * 4) v.deep = new Float32Array(plan.atlasW * plan.atlasH * 4);
          try { await combineInto(reader, plan, comb, timeCubeMeta(node)?.duration ?? 0, ctx, progress, signal, v.deep); }
          finally { reader.close(); }
        }
      }
      v.base = base;
      // Frame order: rewrite the tiles from the time-ordered frames (the atlas's layout stays the same).
      let canvas = base;
      if (ord.order !== 'time') {
        if (ord.order === 'sort' && !v.stats) v.stats = computeStats(base, plan, ord);
        v.order = frameOrder(plan.frames, ord, v.stats ?? undefined);
        canvas = reorderAtlas(base, plan, v.order);
      }
      // Precision 16-bit: a half-float texture of the unrounded frames (the 8-bit canvas stays for the card, stats and web exports).
      const deep = v.deep ? (v.order ? reorderDeep(v.deep, plan, v.order) : v.deep) : null;
      const tex: THREE.Texture = deep ? deepTexture(deep, plan.atlasW, plan.atlasH, canvas) : new THREE.CanvasTexture(canvas);
      // Read with plain bilinear: no mipmaps (the shader steps through tiles, and mip levels would bleed one frame into the next).
      tex.minFilter = THREE.LinearFilter; tex.magFilter = THREE.LinearFilter; tex.generateMipmaps = false;
      tex.wrapS = THREE.ClampToEdgeWrapping; tex.wrapT = THREE.ClampToEdgeWrapping;
      tex.needsUpdate = true;
      v.canvas = canvas; v.tex = tex;
      v.status = { state: 'ready', done: total, total };
      v.abort = null;
      if (this.volumes.get(key) !== v) { tex.dispose(); return; }
      for (const id of this.users(key)) this.host?.setTexture(id, tex);
    })().catch(err => {
      if (err instanceof TimeCubeCancelled) v.status = { ...v.status, state: 'cancelled' };
      else v.status = { ...v.status, state: 'error', message: err instanceof Error ? err.message : String(err) };
      v.abort = null;
    }).finally(() => { this.changed(); this.trim(); });
    return v;
  }

  /** A library node without its video's size: find it, then the host writes it into the node. */
  private needMeta(node: GraphNode): void {
    const src = timeCubeSource(node);
    if (!src || src.kind !== 'library' || this.probing.has(node.id)) return;
    this.probing.add(node.id);
    void (async () => {
      const got = await getVideo(src.videoId).catch(() => null);
      const meta = got ? await probeVideo(got.blob).catch(() => null) : null;
      this.probing.delete(node.id);
      if (meta) this.host?.setMeta(node.id, meta);
    })();
  }

  /** Stop a node's build. Its volume stays cancelled until Rebuild. */
  cancel(nodeId: string): void {
    const p = this.pending.get(nodeId);
    if (p) { clearTimeout(p.timer); this.pending.delete(nodeId); this.changed(); return; }
    const key = this.nodeKey.get(nodeId);
    const v = key ? this.volumes.get(key) : undefined;
    if (v?.status.state === 'building') v.abort?.abort();
  }

  /** Build a node's volume again (after Cancel, an error, or a video put back in the Library). */
  rebuild(nodeId: string): void {
    const node = this.nodes.get(nodeId);
    const key = this.nodeKey.get(nodeId) ?? (node ? volumeKey(node) : null);
    if (!node || !key) return;
    const v = this.volumes.get(key);
    if (v) { if (v.status.state === 'building') return; this.drop(v); }
    for (const id of this.users(key)) this.nodeKey.delete(id);
    this.attach(nodeId, key, node);
    for (const [id, n] of this.nodes) if (id !== nodeId && volumeKey(n) === key) this.attach(id, key, n);
  }

  /** Builds in flight finished (offline renders wait on this before their first frame). */
  async settled(): Promise<void> {
    for (const p of this.pending.values()) clearTimeout(p.timer);
    const flush = [...this.pending.entries()];
    this.pending.clear();
    for (const [id, p] of flush) { const n = this.nodes.get(id); if (n) this.attach(id, p.key, n); }
    await Promise.all([...this.volumes.values()].map(v => v.done.catch(() => {})));
  }

  /** Let go of everything (tests, teardown). */
  clear(): void {
    for (const p of this.pending.values()) clearTimeout(p.timer);
    this.pending.clear();
    for (const id of [...this.nodeKey.keys()]) this.detach(id);
    for (const v of [...this.volumes.values()]) this.drop(v);
  }
}

export const timeCubes = new TimeCubes();

/** Fill a time-ordered atlas with tiles combined from `comb.sub` sub-frames each (Frames from). */
async function combineInto(reader: FrameReader, plan: StackPlan, comb: CombineSettings, duration: number, ctx: CanvasRenderingContext2D, progress: (done: number) => void, signal: AbortSignal, deep: Float32Array | null = null): Promise<void> {
  const scratch = document.createElement('canvas');
  scratch.width = plan.tileW; scratch.height = plan.tileH;
  const sg = scratch.getContext('2d', { willReadFrequently: true });
  if (!sg) throw new Error('No 2D canvas here.');
  let done = 0;
  for (let i = 0; i < plan.frames; i++) {
    const frames: Uint8ClampedArray[] = [];
    for (const t of subFrameTimes(plan.times[i], plan.slots[i] ?? plan.every, comb.sub, duration)) {
      if (signal.aborted) throw new TimeCubeCancelled();
      await reader.draw(t, sg, 0, 0, plan.tileW, plan.tileH, signal, plan.xf);
      frames.push(sg.getImageData(0, 0, plan.tileW, plan.tileH).data);
      progress(++done);
    }
    const { x, y } = tileOrigin(plan, i);
    const img = sg.createImageData(plan.tileW, plan.tileH);
    const f = combineFramesFloat(frames, comb.combine);
    for (let p = 0; p < f.length; p++) img.data[p] = Math.round(f[p]);
    ctx.putImageData(img, x, y);
    // 16-bit: the tile unrounded, into the float atlas (rows top down, as on the canvas).
    if (deep) for (let r = 0; r < plan.tileH; r++) deep.set(f.subarray(r * plan.tileW * 4, (r + 1) * plan.tileW * 4), ((y + r) * plan.atlasW + x) * 4);
    if (i % 8 === 7) await new Promise(r => setTimeout(r, 0));
  }
}

/** Each frame's numbers, read from a time-ordered atlas. */
function computeStats(atlas: HTMLCanvasElement, plan: StackPlan, ord: OrderSettings): FrameStat[] {
  const g = atlas.getContext('2d');
  if (!g) return [];
  const rows = Array.from({ length: plan.frames }, (_, i) => {
    const { x, y } = tileOrigin(plan, i);
    return frameStat(g.getImageData(x, y, plan.tileW, plan.tileH).data, { color: ord.keyColor, tolerance: ord.keyTolerance }, 5);
  });
  const motion = frameMotion(rows.map(r => r.luma));
  return rows.map((r, i) => ({ ...r.stat, motion: motion[i] }));
}

/** A new atlas whose tile i is tile order[i] of `base`. */
function reorderAtlas(base: HTMLCanvasElement, plan: StackPlan, order: readonly number[]): HTMLCanvasElement {
  const out = document.createElement('canvas');
  out.width = base.width; out.height = base.height;
  const g = out.getContext('2d');
  if (!g) return base;
  g.fillStyle = '#000'; g.fillRect(0, 0, out.width, out.height);
  for (let i = 0; i < plan.frames; i++) {
    const s = tileOrigin(plan, order[i]), d = tileOrigin(plan, i);
    g.drawImage(base, s.x, s.y, plan.tileW, plan.tileH, d.x, d.y, plan.tileW, plan.tileH);
  }
  return out;
}
