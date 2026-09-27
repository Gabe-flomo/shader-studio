/**
 * background.ts — what is under the layers on the Play page. Module
 * singleton, no React. Two ways to set it:
 *
 *   The header's Background (PlayDisplay.source): the shader, an image, a
 *   video or a colour (flat, or a gradient or palette: PlayDisplay.fill,
 *   painted by the kit's klPaintBackground), as the setup's one picture.
 *
 *   A Background layer (types/playLayers.ts BackgroundLayer): a queue of
 *   sources, one showing at a time. While a setup has one it decides, and
 *   the header's setting waits until the layer is removed. The layer kit
 *   (kit/queue.js) works out what shows and paints it; this module keeps the
 *   queue's videos on the clock and holds the frames ShaderCanvas renders for
 *   its graph sources (`captureGraph`), live and offline.
 *
 * Either applies only while the Play page (or the Stage) is open: those claim
 * it, so the Studio always shows and runs the graph. While the graph isn't
 * what shows, ShaderCanvas skips it entirely (no draw, no probes or readbacks)
 * and the layer kit paints the background under the layers and reads it
 * wherever it would read the picture (see `planFrame`).
 *
 * A video follows the graph clock: frame t of the clock shows the video at
 * t × rate (wrapped when it loops), so pausing the preview pauses it, ↺ starts
 * it over, and an offline render seeks it frame by frame (`seek`, `seekQueue`).
 *
 * A video too big to keep in the record (BACKGROUND_VIDEO_KEEP) plays from
 * a session copy (`setSessionVideo`); the record keeps its name and size so
 * the page can ask for it again after a reload.
 */
import { activeFill, backgroundLayerOf, backgroundSource, pictureHidden, replacesShader, videoTimeAt, type BackgroundItem, type BackgroundLayer, type PlayDisplay, type PlayRecord } from '../types/play';
import type { KitBackground } from './kit/layers.js';
import type { BqPlan } from './kit/queue.js';

/**
 * One frame of the ShaderCanvas loop, decided:
 *   layersOnly  draw the background and the layers, and nothing on the GPU
 *   shader      draw the shader (then the layers over it), as always
 *   dynamic     something is moving: keep the loop running
 * `shaderMoving` is what moves the graph (the clock with u_time, particles,
 * audio, video inputs, feedback…); with a background it doesn't count.
 */
export function planFrame(o: { background: boolean; shaderMoving: boolean; layersMoving: boolean; needsRender: boolean }): { layersOnly: boolean; shader: boolean; dynamic: boolean } {
  const dynamic = o.background ? o.layersMoving : o.shaderMoving || o.layersMoving;
  const draw = dynamic || o.needsRender;
  return { layersOnly: draw && o.background, shader: draw && !o.background, dynamic };
}

/** Does a queue plan show "this graph" (so the preview's own program runs)? */
export function planShowsThis(plan: BqPlan | null): boolean {
  return !!plan && plan.items.some(i => i.item.kind === 'graph' && i.item.graph === 'this');
}

/** The graph sources other than this graph that a plan shows (the ones the preview renders as a second program). */
export function planGraphs(plan: BqPlan | null): BackgroundItem[] {
  return plan ? plan.items.map(i => i.item).filter(i => i.kind === 'graph' && i.graph !== 'this') : [];
}

type Listener = () => void;
interface VideoOpts { rate: number; loop: boolean; muted: boolean }
const sessionKey = (name: string, bytes: number) => `${name}|${bytes}`;

class PlayBackground {
  private display: PlayDisplay | undefined;
  private layer: BackgroundLayer | undefined;
  private claims = 0;
  private img: HTMLImageElement | null = null;
  private imgSrc = '';
  private video: HTMLVideoElement | null = null;
  private videoSrc = '';
  /** Videos over the keep limit, for this session: object URLs by file name and size. */
  private sessions = new Map<string, string>();
  private listeners = new Set<Listener>();
  /** The browser refused to play a video with its sound (no click yet): it plays muted until the next gesture. */
  private soundBlocked = false;
  /** The queue's videos, by source id (made when a video first shows). */
  private qVideos = new Map<string, { el: HTMLVideoElement; url: string }>();
  /** Graph sources' pictures: live (ShaderCanvas copies each one after drawing it) and offline (a render's frame). */
  private frames = new Map<string, HTMLCanvasElement>();
  private offline = new Map<string, HTMLCanvasElement>();

  /** Something changed that the picture or the panel shows (a claim, a loaded frame). Returns an unsubscribe. */
  onChange(cb: Listener): () => void { this.listeners.add(cb); return () => { this.listeners.delete(cb); }; }
  private emit(): void { for (const cb of this.listeners) cb(); }

  /** The Play page or the Stage is showing: the background applies until the returned release. */
  claim(): () => void {
    this.claims++;
    this.emit();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.claims = Math.max(0, this.claims - 1);
      if (!this.claims) { this.video?.pause(); for (const v of this.qVideos.values()) v.el.pause(); }
      this.emit();
    };
  }

  /** The setup changed: its display and its Background layer (if any). */
  setRecord(record: Pick<PlayRecord, 'display' | 'layers'>): void {
    const layer = backgroundLayerOf(record);
    if (record.display === this.display && layer === this.layer) return;
    this.display = record.display;
    this.layer = layer;
    this.sync();
    this.syncQueue();
    this.emit();
  }

  /** The header's setting alone (tests, and callers without layers). */
  setDisplay(d: PlayDisplay | undefined): void { this.setRecord({ display: d, layers: this.layer ? [this.layer] : [] }); }

  /** Is a Background layer deciding the picture now (the Play page is open and the setup has one)? */
  layerActive(): boolean { return this.claims > 0 && !!this.layer; }

  /** Does the header's image, video or colour show in place of the shader (the Play page is open, no Background layer)? */
  active(): boolean { return this.claims > 0 && !this.layer && replacesShader(this.display); }

  /** "Layers only" for the kit: the legacy shader switch everywhere, any source's while the background applies. A Background layer has no such switch. */
  hidden(): boolean {
    if (this.layerActive()) return false;
    if (this.active()) return pictureHidden(this.display);
    return backgroundSource(this.display) === 'shader' && this.display?.picture === false;
  }

  /** What the kit paints and reads in place of the shader, or null for the shader (or a Background layer, which the kit paints itself). */
  kitBackground(): KitBackground | null {
    if (!this.active()) return null;
    const d = this.display!;
    const src = backgroundSource(d);
    const el = src === 'image' ? this.readyImage() : src === 'video' ? this.video : null;
    return { el, fit: d.fit ?? 'cover', colour: d.backdrop, fill: activeFill(d) };
  }

  /** The video element playing now (for the panel: its duration, whether it loaded). */
  videoElement(): HTMLVideoElement | null { return backgroundSource(this.display) === 'video' ? this.video : null; }

  /** A video too big to keep plays from this copy for the rest of the session (the header's, or a queue's). */
  setSessionVideo(file: File): void {
    const k = sessionKey(file.name.slice(0, 120), file.size);
    const old = this.sessions.get(k);
    if (old) URL.revokeObjectURL(old);
    this.sessions.set(k, URL.createObjectURL(file));
    this.sync();
    this.syncQueue();
    this.emit();
  }

  /** Is the session copy the one the record names? (After a reload it isn't there: the panel asks for it again.) */
  hasSessionVideo(name: string, bytes: number): boolean { return this.sessions.has(sessionKey(name, bytes)); }

  /** A playing video keeps the loop running; so does a video still loading its first frame. */
  moving(playing: boolean): boolean {
    if (!this.active() || backgroundSource(this.display) !== 'video' || !this.video) return false;
    return playing || this.video.readyState < 2 || this.video.seeking;
  }

  /** Keep the video on the graph clock (the live preview, once a frame). */
  follow(time: number, playing: boolean): void {
    const v = this.active() && backgroundSource(this.display) === 'video' ? this.video : null;
    const opts = this.display?.video;
    if (v && opts) this.followVideo(v, opts, time, playing);
  }

  /** An offline render's frame: the video exactly at `time`, decoded, before the layers read it. */
  async seek(time: number): Promise<void> {
    const v = this.active() && backgroundSource(this.display) === 'video' ? this.video : null;
    const opts = this.display?.video;
    if (v && opts) await seekVideo(v, opts, time);
  }

  // ── The Background layer's queue ─────────────────────────────────────────

  /** A video source's element (made when it first shows), or null when it has no file this session. */
  queueVideo(item: BackgroundItem): HTMLVideoElement | null {
    const url = this.queueVideoUrl(item);
    if (!url) return null;
    let e = this.qVideos.get(item.id);
    if (!e || e.url !== url) {
      if (e) dropVideo(e.el);
      e = { el: this.makeVideo(url), url };
      this.qVideos.set(item.id, e);
    }
    return e.el;
  }

  /** Is a video source's file here (kept in the record, or loaded again this session)? */
  queueVideoMissing(item: BackgroundItem): boolean { return item.kind === 'video' && !this.queueVideoUrl(item); }

  /** The showing videos follow the clock; the others wait, paused (only what shows runs). */
  followQueue(plan: BqPlan, time: number, playing: boolean): void {
    const showing = new Map(plan.items.filter(i => i.item.kind === 'video').map(i => [i.item.id, i.item]));
    for (const [id, e] of this.qVideos) {
      const item = showing.get(id);
      if (item) this.followVideo(e.el, videoOpts(item), time, playing);
      else if (!e.el.paused) e.el.pause();
    }
  }

  /** An offline render's frame: each showing video exactly at `time`. */
  async seekQueue(plan: BqPlan, time: number): Promise<void> {
    for (const { item } of plan.items) {
      if (item.kind !== 'video') continue;
      const v = this.queueVideo(item);
      if (v) await seekVideo(v, videoOpts(item), time);
    }
  }

  /** Does the queue need frames drawn: a crossfade, a sketch, a playing video or graph (this graph moves with the shader's own rules). */
  queueMoving(plan: BqPlan, playing: boolean): boolean {
    if (plan.fading) return true;
    for (const { item } of plan.items) {
      if (item.kind === 'script') return true;
      if (item.kind === 'graph' && item.graph !== 'this' && playing) return true;
      if (item.kind === 'video') {
        const e = this.qVideos.get(item.id)?.el;
        if (playing || (e && (e.readyState < 2 || e.seeking))) return true;
      }
    }
    return false;
  }

  /** ShaderCanvas drew a graph source: keep a copy of the picture for the kit to compose (a crossfade, a transform). */
  captureGraph(id: string, src: HTMLCanvasElement): void {
    let c = this.frames.get(id);
    if (!c) { c = document.createElement('canvas'); this.frames.set(id, c); }
    if (c.width !== src.width || c.height !== src.height) { c.width = src.width; c.height = src.height; }
    const x = c.getContext('2d');
    if (!x) return;
    x.clearRect(0, 0, c.width, c.height);
    try { x.drawImage(src, 0, 0); } catch { /* a lost context */ }
  }

  /** A graph source's last captured picture (live), or null (this graph straight from the GL canvas). */
  graphFrame(item: BackgroundItem): HTMLCanvasElement | null { return this.frames.get(item.id) ?? null; }

  /** An offline render drew a graph source for this frame: its pixels (RGBA, top-down). */
  setOfflineGraph(id: string, rgba: Uint8Array, width: number, height: number): void {
    let c = this.offline.get(id);
    if (!c) { c = document.createElement('canvas'); this.offline.set(id, c); }
    if (c.width !== width || c.height !== height) { c.width = width; c.height = height; }
    const x = c.getContext('2d');
    if (!x) return;
    const img = x.createImageData(width, height);
    img.data.set(rgba.subarray(0, width * height * 4));
    x.putImageData(img, 0, 0);
  }

  /** A graph source's picture in an offline frame (this graph: null, it is the frame the GPU read back). */
  offlineGraphFrame(item: BackgroundItem): HTMLCanvasElement | null { return item.graph === 'this' ? null : this.offline.get(item.id) ?? null; }

  // ── Elements ───────────────────────────────────────────────────────────────

  private followVideo(v: HTMLVideoElement, opts: VideoOpts, time: number, playing: boolean): void {
    if (v.readyState < 1) return;
    if (v.playbackRate !== opts.rate) v.playbackRate = opts.rate;
    if (v.loop !== opts.loop) v.loop = opts.loop;
    const muted = opts.muted || this.soundBlocked;
    if (v.muted !== muted) v.muted = muted;
    const target = videoTimeAt(time, v.duration, opts.rate, opts.loop);
    const d = v.duration, diff = Math.abs(v.currentTime - target);
    // Without a duration (yet) it just plays: there is nowhere sure to seek to.
    const known = Number.isFinite(d) && d > 0;
    const off = !known ? 0 : opts.loop ? Math.min(diff, d - diff) : diff;
    const atEnd = known && !opts.loop && target >= d - 0.01;
    if (playing && !atEnd) {
      if (v.paused) {
        const p = v.play();
        if (p) p.catch(e => {
          // Sound needs a click first: play muted now, and try the sound again on the next click.
          if ((e as DOMException)?.name === 'NotAllowedError' && !v.muted) {
            this.soundBlocked = true;
            window.addEventListener('pointerdown', () => { this.soundBlocked = false; }, { once: true, capture: true });
          }
        });
      }
      if (off > 0.3 && !v.seeking) v.currentTime = target;
    } else {
      if (!v.paused) v.pause();
      if (off > 0.02 && !v.seeking) v.currentTime = target;
    }
  }

  private readyImage(): HTMLImageElement | null {
    const img = this.img;
    return img && img.complete && img.naturalWidth > 0 ? img : null;
  }

  /** The URL the header's video plays from: the kept data URL, or the session copy of a big one. */
  private videoUrl(): string {
    const v = this.display?.video;
    if (!v) return '';
    if (v.src) return v.src;
    return this.sessions.get(sessionKey(v.name, v.bytes)) ?? '';
  }

  private queueVideoUrl(item: BackgroundItem): string {
    if (item.kind !== 'video') return '';
    if (item.src) return item.src;
    return this.sessions.get(sessionKey(item.name, item.bytes ?? 0)) ?? '';
  }

  private makeVideo(url: string): HTMLVideoElement {
    const v = document.createElement('video');
    v.playsInline = true; v.preload = 'auto'; v.muted = true; v.loop = false;
    v.setAttribute('playsinline', '');
    v.addEventListener('loadeddata', () => this.emit());
    v.addEventListener('loadedmetadata', () => {
      // Videos recorded in a browser often say their length is Infinity until played through:
      // a seek past the end makes it work it out, then back to the start.
      if (v.duration === Infinity) {
        const back = () => { v.removeEventListener('durationchange', back); v.currentTime = 0; this.emit(); };
        v.addEventListener('durationchange', back);
        v.currentTime = 1e7;
      }
      this.emit();
    });
    v.addEventListener('error', () => this.emit());
    v.src = url;
    return v;
  }

  private sync(): void {
    if (typeof document === 'undefined') return;
    const imgSrc = this.display?.image?.src ?? '';
    if (imgSrc !== this.imgSrc) {
      this.imgSrc = imgSrc;
      this.img = null;
      if (imgSrc) {
        const img = new Image();
        img.onload = () => this.emit();
        img.src = imgSrc;
        this.img = img;
      }
    }
    const url = this.videoUrl();
    if (url !== this.videoSrc) {
      this.videoSrc = url;
      if (this.video) { dropVideo(this.video); this.video = null; }
      if (url) this.video = this.makeVideo(url);
    }
  }

  /** Sources that left the queue let go of their video and their captured picture. */
  private syncQueue(): void {
    const ids = new Set((this.layer?.sources ?? []).map(s => s.id));
    for (const [id, e] of this.qVideos) {
      const item = this.layer?.sources.find(s => s.id === id);
      if (!ids.has(id) || !item || this.queueVideoUrl(item) !== e.url) { dropVideo(e.el); this.qVideos.delete(id); }
    }
    for (const m of [this.frames, this.offline]) for (const id of [...m.keys()]) if (!ids.has(id)) m.delete(id);
  }
}

function videoOpts(item: BackgroundItem): VideoOpts {
  return { rate: item.rate ?? 1, loop: item.loop !== false, muted: item.muted !== false };
}

function dropVideo(v: HTMLVideoElement): void { v.pause(); v.removeAttribute('src'); v.load(); }

async function seekVideo(v: HTMLVideoElement, opts: VideoOpts, time: number): Promise<void> {
  if (v.readyState < 1) await waitFor(v, 'loadedmetadata', 4000);
  if (!v.paused) v.pause();
  const target = Number.isFinite(v.duration) ? videoTimeAt(time, v.duration, opts.rate, opts.loop) : Math.max(0, time) * opts.rate;
  if (Math.abs(v.currentTime - target) < 0.0005 && v.readyState >= 2) return;
  const done = waitFor(v, 'seeked', 3000);
  v.currentTime = target;
  await done;
  if (v.readyState < 2) await waitFor(v, 'loadeddata', 2000);
}

function waitFor(el: HTMLElement, event: string, ms: number): Promise<void> {
  return new Promise(resolve => {
    const done = () => { el.removeEventListener(event, done); clearTimeout(timer); resolve(); };
    const timer = setTimeout(done, ms);
    el.addEventListener(event, done);
  });
}

export const playBackground = new PlayBackground();
