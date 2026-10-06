/**
 * videoEngine — the Video Input node's videos: a looping, muted <video> per
 * node wrapped in a VideoTexture.
 *
 * - The file is kept in the video library (lib/backgroundLibrary.ts) when it
 *   is dropped, and the node keeps its id (`videoId`): `sync(nodes)` opens it
 *   again after a reload (before, the file was lost with the page).
 * - Without clip settings the video runs free, as it always did (play,
 *   pause, loop, speed).
 * - With them (`params.clip`, docs/clip-editor.md) it follows the graph clock
 *   through the playlist (play/kit/clipPlay.js): `follow(time, playing)` once
 *   a frame, `seek(time)` before each offline frame, exactly as a web export
 *   plays it. The crop / rotate / flip is in the node's GLSL.
 */
import * as THREE from 'three';
import { forgetMedia, rememberMedia } from './mediaSources';
import { getVideo } from './backgroundLibrary';
import { cpAt, cpFollow, cpParse, cpPlaylist, type CpSaved } from '../play/kit/clipPlay.js';
import type { GraphNode } from '../types/nodeGraph';

/** How long to wait for `loadeddata` before giving up on a video file. */
const VIDEO_LOAD_TIMEOUT_MS = 20_000;

/** Turn a MediaError into something a user can act on. */
function describeMediaError(err: MediaError | null): string {
  if (!err) return 'unknown decode error';
  switch (err.code) {
    case MediaError.MEDIA_ERR_ABORTED:           return 'loading was aborted';
    case MediaError.MEDIA_ERR_NETWORK:           return 'the file could not be read';
    case MediaError.MEDIA_ERR_DECODE:            return 'the file is corrupt or uses a codec this browser cannot decode';
    case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED: return 'this format is not supported by the browser';
    default: return err.message || `media error ${err.code}`;
  }
}

/** Hooks into the app (the store's texture table); set by ShaderCanvas. */
export interface VideoEngineHost {
  setTexture(nodeId: string, tex: THREE.VideoTexture | null): void;
  /** A node's file came back from the library (its card shows it). */
  restored?(nodeId: string, fileName: string): void;
}

interface ClipState { clip: CpSaved; speed: number; loop: boolean }

const waitFor = (el: HTMLVideoElement, ev: string, ms: number) => new Promise<boolean>(res => {
  const done = (ok: boolean) => { clearTimeout(timer); el.removeEventListener(ev, yes); el.removeEventListener('error', no); res(ok); };
  const yes = () => done(true), no = () => done(false);
  const timer = setTimeout(() => done(false), ms);
  el.addEventListener(ev, yes);
  el.addEventListener('error', no);
});

class VideoEngine {
  private videos = new Map<string, HTMLVideoElement>();
  private textures = new Map<string, THREE.VideoTexture>();
  /** Library ids by node, and the files opened for them (so the clip editor reads the same file). */
  private ids = new Map<string, string>();
  private files = new Map<string, Blob>();
  private urls = new Map<string, string>();
  private restoring = new Set<string>();
  private clips = new Map<string, ClipState>();
  /** Paused by its ▶ / ⏸ button (a clip then holds where it is). */
  private held = new Set<string>();
  private shown = new Map<string, number>();
  private host: VideoEngineHost | null = null;
  private listeners = new Set<() => void>();

  setHost(host: VideoEngineHost | null): void { this.host = host; }
  onChange(fn: () => void): () => void { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }
  private changed() { for (const fn of this.listeners) fn(); }

  /** The file a node plays (for the clip editor), or null. */
  file(nodeId: string): Blob | null { return this.files.get(nodeId) ?? null; }
  /** An object URL of the node's file (the card's thumbnail), or null. */
  url(nodeId: string): string | null { return this.urls.get(nodeId) ?? null; }
  element(nodeId: string): HTMLVideoElement | null { return this.videos.get(nodeId) ?? null; }

  /**
   * The graph's Video Input nodes as they are now: open a kept file that is not open yet (a reload,
   * a graph loaded), and take each node's clip settings, speed and loop.
   */
  sync(nodes: readonly GraphNode[]): void {
    const here = new Set(nodes.filter(n => n.type === 'videoInput').map(n => n.id));
    for (const id of [...this.clips.keys()]) if (!here.has(id)) { this.clips.delete(id); this.held.delete(id); }
    for (const n of nodes) {
      if (n.type !== 'videoInput') continue;
      const p = n.params;
      const clip = cpParse(p.clip);
      const speed = typeof p._speed === 'number' && p._speed > 0 ? p._speed : 1, loop = p._loop !== false;
      if (clip) this.clips.set(n.id, { clip, speed, loop }); else if (this.clips.delete(n.id)) {
        // Back to running free, as it always did.
        const v = this.videos.get(n.id);
        if (v) { v.loop = loop; v.playbackRate = speed; if (!this.held.has(n.id) && v.paused) void v.play().catch(() => {}); }
      }
      const id = typeof p.videoId === 'string' ? p.videoId : '';
      if (id && !this.videos.has(n.id) && !this.restoring.has(n.id)) void this.restore(n.id, id, typeof p._fileName === 'string' ? p._fileName : '', p._isPlaying !== false);
    }
  }

  private async restore(nodeId: string, videoId: string, name: string, play: boolean): Promise<void> {
    this.restoring.add(nodeId);
    try {
      const got = await getVideo(videoId).catch(() => null);
      if (!got || this.videos.has(nodeId)) return;
      const file = new File([got.blob], name || got.name, { type: got.type || got.blob.type });
      await this.loadVideo(nodeId, file).catch(() => {});
      if (!this.videos.has(nodeId)) return;
      this.ids.set(nodeId, videoId);
      this.host?.setTexture(nodeId, this.getTexture(nodeId));
      if (play) this.play(nodeId); else this.pause(nodeId);
      this.host?.restored?.(nodeId, file.name);
      this.changed();
    } finally { this.restoring.delete(nodeId); }
  }

  /** Keep the library id a node's file is under (after a drop). */
  setLibraryId(nodeId: string, videoId: string): void { this.ids.set(nodeId, videoId); }

  /** Is the node's video moving (a clip follows the clock until its button pauses it)? */
  active(nodeId: string): boolean {
    if (!this.videos.has(nodeId)) return false;
    return this.clips.has(nodeId) ? !this.held.has(nodeId) : this.isPlaying(nodeId);
  }

  /** Live: every clipped video on its playlist for clock `time`. */
  follow(time: number, playing: boolean): void {
    for (const [id, c] of this.clips) {
      const v = this.videos.get(id), tex = this.textures.get(id);
      if (!v || v.readyState < 1) continue;
      if (v.loop) v.loop = false;
      const pl = cpPlaylist(c.clip, v.duration, c.speed, c.loop);
      if (!pl.segs.length) continue;
      const at = cpAt(pl.segs, time, pl.speed, pl.loop);
      if (this.held.has(id)) { if (!v.paused) v.pause(); }
      else cpFollow(v, at, pl.segs[at.k], pl.speed, playing);
      // A seeked frame (a reversed stretch, a jump) reaches the texture too.
      if (tex && v.readyState >= 2 && this.shown.get(id) !== v.currentTime) { this.shown.set(id, v.currentTime); tex.needsUpdate = true; }
    }
  }

  /** Offline: every clipped video on its frame for `time`, decoded, before the shader draws. */
  async seek(time: number): Promise<void> {
    await Promise.all([...this.clips].map(async ([id, c]) => {
      const v = this.videos.get(id), tex = this.textures.get(id);
      if (!v) return;
      if (v.readyState < 1) await waitFor(v, 'loadedmetadata', 4000);
      if (!v.paused) v.pause();
      const pl = cpPlaylist(c.clip, v.duration, c.speed, c.loop);
      if (!pl.segs.length) return;
      const t = cpAt(pl.segs, time, pl.speed, pl.loop).time;
      if (Math.abs(v.currentTime - t) > 1e-4 || v.readyState < 2) {
        const seeked = waitFor(v, 'seeked', 4000);
        v.currentTime = t;
        await seeked;
        if (v.readyState < 2) await waitFor(v, 'loadeddata', 2000);
      }
      this.shown.set(id, v.currentTime);
      if (tex) tex.needsUpdate = true;
    }));
  }

  /**
   * Decode `file` into a looping, muted <video> and wrap it in a VideoTexture.
   * Rejects — instead of hanging forever — when the browser can't decode the
   * file (unsupported codec/container, corrupt data) or when `loadeddata`
   * never arrives within `timeoutMs`.
   */
  loadVideo(nodeId: string, file: File, timeoutMs = VIDEO_LOAD_TIMEOUT_MS): Promise<void> {
    return new Promise((resolve, reject) => {
      this.disposeNode(nodeId);
      const video = document.createElement('video');
      video.loop = true;
      video.muted = true;
      video.playsInline = true;
      const url = URL.createObjectURL(file);
      video.src = url;

      // Exactly one of onloadeddata / onerror / the timer settles the promise;
      // the rest become no-ops.
      let settled = false;
      const settle = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        video.onloadeddata = null;
        video.onerror = null;
        fn();
      };
      const fail = (reason: string) => settle(() => {
        // Stop the decoder and drop the blob URL; the element was never
        // registered so disposeNode() won't find it.
        video.removeAttribute('src');
        video.load();
        URL.revokeObjectURL(url);
        const error = new Error(`Could not load video "${file.name}": ${reason}`);
        console.error('[videoEngine]', error.message);
        reject(error);
      });

      const timer = setTimeout(
        () => fail(`no video data after ${Math.round(timeoutMs / 1000)}s (the file may be in a format this browser can't play)`),
        timeoutMs,
      );
      video.onerror = () => fail(describeMediaError(video.error));
      video.onloadeddata = () => settle(() => {
        const tex = new THREE.VideoTexture(video);
        tex.minFilter = THREE.LinearFilter;
        tex.magFilter = THREE.LinearFilter;
        tex.format = THREE.RGBAFormat;
        this.videos.set(nodeId, video);
        this.textures.set(nodeId, tex);
        this.files.set(nodeId, file);
        this.urls.set(nodeId, url);
        // Kept for web exports (see mediaSources.ts).
        rememberMedia(nodeId, 'video', file.name, file.type, file);
        resolve();
      });
      video.load();
    });
  }

  getTexture(nodeId: string): THREE.VideoTexture | null {
    return this.textures.get(nodeId) ?? null;
  }

  play(nodeId: string) {
    this.held.delete(nodeId);
    // With a clip, follow() starts it on the clock.
    if (!this.clips.has(nodeId)) void this.videos.get(nodeId)?.play()?.catch(() => {});
  }
  pause(nodeId: string) { this.held.add(nodeId); this.videos.get(nodeId)?.pause(); }
  isLoaded(nodeId: string) { return this.videos.has(nodeId); }
  isPlaying(nodeId: string) { return !(this.videos.get(nodeId)?.paused ?? true); }

  setLoop(nodeId: string, loop: boolean) {
    const c = this.clips.get(nodeId);
    if (c) { c.loop = loop; return; }
    const v = this.videos.get(nodeId);
    if (v) v.loop = loop;
  }

  setSpeed(nodeId: string, rate: number) {
    const c = this.clips.get(nodeId);
    if (c) { c.speed = rate; return; }
    const v = this.videos.get(nodeId);
    if (v) v.playbackRate = rate;
  }

  disposeNode(nodeId: string) {
    const v = this.videos.get(nodeId);
    if (v) { v.pause(); URL.revokeObjectURL(v.src); }
    this.textures.get(nodeId)?.dispose();
    this.videos.delete(nodeId);
    this.textures.delete(nodeId);
    this.files.delete(nodeId);
    this.urls.delete(nodeId);
    this.shown.delete(nodeId);
    forgetMedia(nodeId);
  }

  disposeAll() {
    for (const id of [...this.videos.keys()]) this.disposeNode(id);
  }
}

export const videoEngine = new VideoEngine();
