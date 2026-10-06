/**
 * bakedVideos — plays each Baked node's video (docs/bake.md) on the graph's
 * clock and hands its frames to the shader as a texture.
 *
 * - `sync(nodes)`: opens the video of every Baked node in the graph (from the
 *   video library, by `videoId`) and lets go of the ones that went.
 * - `follow(time, playing)`: once per live frame (ShaderCanvas). Frame
 *   (t − start) × fps, looped or held; while the clock runs the video plays and
 *   its speed is nudged to stay on the clock (a jump only past a quarter
 *   second), paused it sits on the exact frame.
 * - `seek(time)`: before every offline frame (exports, bakes of bakes): each
 *   video on exactly that frame, decoded, before the shader draws.
 *
 * Clip settings (`params.clip`, docs/clip-editor.md: a trim, speed, loop and
 * crop from the clip editor) change the clock's map: clock time t − start
 * plays through the playlist (play/kit/clipPlay.js cpAt), as the web page
 * plays it. Without one, nothing here changes.
 *
 * Textures go through the store's `videoTextures` (keyed by node id), the
 * same path a Video Input node's take, so the ShaderCanvas binding, Pass
 * programs and the web export (mediaSources) all treat them alike.
 */
import * as THREE from 'three';
import type { GraphNode, SubgraphData } from '../types/nodeGraph';
import { getVideo } from './backgroundLibrary';
import { forgetMedia, rememberMedia } from './mediaSources';
import { bakeFrameAt, bakeVideoTime, type BakeClock } from './bake/plan';
import { bakedInfo } from '../nodes/definitions/baked';
import { cpAt, cpFollow, cpParse, cpPlaylist, type CpSaved } from '../play/kit/clipPlay.js';

export type BakedStatus = 'loading' | 'ready' | 'missing' | 'error';

interface Entry {
  nodeId: string;
  videoId: string;
  clock: BakeClock;
  /** Clip settings from the editor, or null (plays frame (t − start) × fps). */
  clip: CpSaved | null;
  status: BakedStatus;
  el: HTMLVideoElement | null;
  tex: THREE.VideoTexture | null;
  url: string | null;
  /** The video time last handed to the texture. */
  shown: number;
  ready: Promise<void>;
}

/** Hooks the engine calls into the app (the store's texture table); set by ShaderCanvas. */
export interface BakedHost {
  setTexture(nodeId: string, tex: THREE.VideoTexture | null): void;
}

/** Every Baked node in a node list, inside groups too. */
export function bakedNodesIn(nodes: GraphNode[], out: GraphNode[] = []): GraphNode[] {
  for (const n of nodes) {
    if (n.type === 'baked') out.push(n);
    const sg = n.params?.subgraph as SubgraphData | undefined;
    if (sg?.nodes?.length) bakedNodesIn(sg.nodes, out);
  }
  return out;
}

const clockOf = (n: GraphNode): BakeClock | null => {
  const i = bakedInfo(n);
  return i ? { start: i.start, duration: i.duration, fps: i.fps, loop: i.loop } : null;
};

const waitFor = (el: HTMLVideoElement, ev: string, ms: number) => new Promise<boolean>(res => {
  const done = (ok: boolean) => { clearTimeout(timer); el.removeEventListener(ev, yes); el.removeEventListener('error', no); res(ok); };
  const yes = () => done(true), no = () => done(false);
  const timer = setTimeout(() => done(false), ms);
  el.addEventListener(ev, yes);
  el.addEventListener('error', no);
});

class BakedVideos {
  private entries = new Map<string, Entry>();
  private host: BakedHost | null = null;
  private listeners = new Set<() => void>();

  setHost(host: BakedHost | null): void {
    this.host = host;
    if (host) for (const e of this.entries.values()) if (e.tex) host.setTexture(e.nodeId, e.tex);
  }

  /** Card UIs listen for loading / missing changes. */
  onChange(fn: () => void): () => void { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }
  private changed() { for (const fn of this.listeners) fn(); }

  status(nodeId: string): BakedStatus | null { return this.entries.get(nodeId)?.status ?? null; }
  /** Any video showing (keeps the preview drawing while the clock runs). */
  active(): boolean { for (const e of this.entries.values()) if (e.status === 'ready') return true; return false; }
  element(nodeId: string): HTMLVideoElement | null { return this.entries.get(nodeId)?.el ?? null; }

  /** Open the videos these Baked nodes need; close the rest. */
  sync(nodes: GraphNode[]): void {
    const want = new Map<string, GraphNode>();
    for (const n of bakedNodesIn(nodes)) want.set(n.id, n);
    for (const [id, e] of this.entries) {
      const n = want.get(id);
      if (!n || String(n.params.videoId || '') !== e.videoId) this.close(id);
    }
    for (const [id, n] of want) {
      const clock = clockOf(n);
      const videoId = String(n.params.videoId || '');
      const had = this.entries.get(id);
      if (had) { if (clock) had.clock = clock; had.clip = cpParse(n.params.clip); continue; }
      if (!clock || !videoId) continue;
      this.open(id, videoId, clock);
      const e = this.entries.get(id);
      if (e) e.clip = cpParse(n.params.clip);
    }
  }

  private open(nodeId: string, videoId: string, clock: BakeClock): void {
    const e: Entry = { nodeId, videoId, clock, clip: null, status: 'loading', el: null, tex: null, url: null, shown: -1, ready: Promise.resolve() };
    this.entries.set(nodeId, e);
    this.changed();
    e.ready = (async () => {
      const got = await getVideo(videoId).catch(() => null);
      if (this.entries.get(nodeId) !== e) return;
      if (!got) { e.status = 'missing'; this.changed(); return; }
      const el = document.createElement('video');
      el.muted = true; el.playsInline = true; el.preload = 'auto';
      el.setAttribute('playsinline', ''); el.setAttribute('muted', '');
      el.loop = clock.loop === 'seamless';
      e.url = URL.createObjectURL(got.blob);
      el.src = e.url;
      e.el = el;
      const ok = await waitFor(el, 'loadeddata', 20_000);
      if (this.entries.get(nodeId) !== e) return;
      if (!ok) { e.status = 'error'; this.changed(); return; }
      // Its frame size as attributes too: readers that size a texture by image.width (Particles' Emit from) see it.
      el.width = el.videoWidth; el.height = el.videoHeight;
      const tex = new THREE.VideoTexture(el);
      tex.minFilter = THREE.LinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.generateMipmaps = false;
      tex.format = THREE.RGBAFormat;
      e.tex = tex;
      e.status = 'ready';
      // Kept for web exports (lib/mediaSources.ts): the page plays it on its own clock (store webMedia).
      rememberMedia(nodeId, 'video', got.name, got.type, got.blob);
      this.host?.setTexture(nodeId, tex);
      this.changed();
    })();
  }

  private close(nodeId: string): void {
    const e = this.entries.get(nodeId);
    if (!e) return;
    this.entries.delete(nodeId);
    if (e.el) { e.el.pause(); e.el.removeAttribute('src'); e.el.load(); }
    if (e.url) URL.revokeObjectURL(e.url);
    e.tex?.dispose();
    forgetMedia(nodeId);
    this.host?.setTexture(nodeId, null);
    this.changed();
  }

  /** Close everything (tests, teardown). */
  clear(): void { for (const id of [...this.entries.keys()]) this.close(id); }

  /** Live: keep each video on the clock's frame. */
  follow(time: number, playing: boolean): void {
    for (const e of this.entries.values()) {
      const el = e.el;
      if (e.status !== 'ready' || !el || !e.tex) continue;
      const { fps, duration, loop } = e.clock;
      if (e.clip) {
        // The clip's playlist from the bake's start (before it: its first frame, held).
        const c = clipClock(e, time);
        if (c) cpFollow(el, c.at, c.seg, c.speed, playing && time >= e.clock.start);
        if (el.currentTime !== e.shown && el.readyState >= 2) { e.shown = el.currentTime; e.tex.needsUpdate = true; }
        continue;
      }
      const target = bakeVideoTime(bakeFrameAt(time, e.clock), fps);
      const d = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : duration;
      const raw = target - el.currentTime;
      // Across the loop point the short way round counts.
      const diff = loop === 'seamless' && Math.abs(raw) > d / 2 ? raw - Math.sign(raw) * d : raw;
      const runs = playing && (loop === 'seamless' || (time >= e.clock.start && time < e.clock.start + duration));
      if (runs) {
        if (el.paused) { const p = el.play(); if (p) p.catch(() => {}); }
        if (Math.abs(diff) > 0.25) { if (!el.seeking) el.currentTime = target; }
        else {
          // Within a quarter second: lean on the speed rather than jump, so playback stays smooth.
          const rate = Math.abs(diff) < 0.5 / fps ? 1 : 1 + Math.max(-0.2, Math.min(0.2, diff * 2));
          if (Math.abs(el.playbackRate - rate) > 1e-3) el.playbackRate = rate;
        }
      } else {
        if (!el.paused) el.pause();
        if (Math.abs(diff) > 0.5 / fps && !el.seeking) el.currentTime = target;
      }
      if (el.currentTime !== e.shown && el.readyState >= 2) { e.shown = el.currentTime; e.tex.needsUpdate = true; }
    }
  }

  /** Offline: every video on the frame for `time`, decoded, before the shader draws it. */
  async seek(time: number): Promise<void> {
    const jobs: Promise<void>[] = [];
    for (const e of this.entries.values()) {
      jobs.push((async () => {
        await e.ready;
        const el = e.el;
        if (e.status !== 'ready' || !el || !e.tex) return;
        if (!el.paused) el.pause();
        const c = e.clip ? clipClock(e, time) : null;
        // A clip lands on the middle of the bake's frame, as a plain bake does.
        const target = c ? bakeVideoTime(Math.min(Math.round(e.clock.duration * e.clock.fps) - 1, Math.floor(c.at.time * e.clock.fps + 1e-6)), e.clock.fps)
          : bakeVideoTime(bakeFrameAt(time, e.clock), e.clock.fps);
        if (Math.abs(el.currentTime - target) > 1e-4 || el.readyState < 2) {
          const seeked = waitFor(el, 'seeked', 4000);
          el.currentTime = target;
          await seeked;
          if (el.readyState < 2) await waitFor(el, 'loadeddata', 2000);
        }
        e.shown = el.currentTime;
        e.tex.needsUpdate = true;
      })());
    }
    await Promise.all(jobs);
  }

  /** Wait until every open video has loaded (or failed): a bake of a bake reads them. */
  async whenLoaded(): Promise<void> { await Promise.all([...this.entries.values()].map(e => e.ready)); }
}

/** Where a clipped bake is at clock `time`: its playlist from the bake's start (loop: the clip's, else a seamless bake's). */
function clipClock(e: Entry, time: number) {
  if (!e.clip) return null;
  const d = e.el && Number.isFinite(e.el.duration) && e.el.duration > 0 ? e.el.duration : e.clock.duration;
  const pl = cpPlaylist(e.clip, d, 1, e.clock.loop === 'seamless');
  if (!pl.segs.length) return null;
  const at = cpAt(pl.segs, time - e.clock.start, pl.speed, pl.loop);
  return { at, seg: pl.segs[at.k], speed: pl.speed };
}

export const bakedVideos = new BakedVideos();
