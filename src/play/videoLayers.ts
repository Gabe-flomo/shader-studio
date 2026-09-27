/**
 * videoLayers.ts — the app's host for Video layers (types/playLayers.ts
 * VideoLayer). Module singleton, no React.
 *
 *   Files      each layer names a video in the backgrounds library (IndexedDB);
 *              this opens it as an object URL in a <video> of the layer's own.
 *              A file the library doesn't have (another browser) is "missing":
 *              the layer card asks for it again.
 *   Clock      like the Background's videos (play/background.ts): following the
 *              clock, frame t shows start + t × speed, so pausing the preview
 *              pauses it, ↺ starts it over, and an offline render seeks it
 *              frame by frame (`seek`). Running free, it just plays.
 *   Sound      Off: muted. Listen / Play: the element goes through one
 *              MediaElementSource (browsers allow one per element, ever) into an
 *              analyser in the shared audio context, and on to the speakers at
 *              the layer's volume (Play) or at 0 (Listen). Audio readers find
 *              the analyser through lib/videoSound.ts.
 *   Export     the file is remembered for web exports (lib/mediaSources.ts,
 *              key `vlayer:<id>`), as the Video Input node's is.
 *
 * Like songs in Audio layers, they run wherever the preview runs (the Studio
 * too): the preview claims them, and the videos (and their sound) pause when
 * it goes.
 */
import { matteUsers, videoLayerTimeAt, type PlayLayer, type VideoLayer } from '../types/playLayers';
import type { PlayRecord } from '../types/play';
import { addVideoFile, getVideo } from '../lib/backgroundLibrary';
import { audioEngine } from '../lib/audioEngine';
import { audioFxHost } from '../lib/audioFx';
import { layerChainId } from '../types/playAudioFx';
import { forgetMedia, rememberMedia } from '../lib/mediaSources';
import { videoSound, type VideoSoundState } from '../lib/videoSound';
import { playEngine } from '../lib/playEngine';

/** What the layer card shows about a layer's file. */
export type VideoFileStatus = 'none' | 'loading' | 'ready' | 'missing' | 'error';

interface Entry {
  videoId: string;
  el: HTMLVideoElement | null;
  status: VideoFileStatus;
  error: string;
  /** Running free: sent to its start once, when it first loads. */
  started: boolean;
  analyser: AnalyserNode | null;
  gain: GainNode | null;
  unplug: (() => void) | null;
  /** The Sound setting last applied. */
  sound: VideoLayer['sound'];
}

/** One MediaElementSource per element, ever: a second createMediaElementSource on the same element throws. */
const sources = new WeakMap<HTMLMediaElement, MediaElementAudioSourceNode>();
/**
 * Opened files by library id: an object URL and the file (for the web export). A file picked this
 * session is used straight away, without reading it back from the library.
 */
const files = new Map<string, { url: string; blob: Blob; name: string }>();
const mediaKey = (layerId: string) => `vlayer:${layerId}`;

class PlayVideoLayers {
  private layers: VideoLayer[] = [];
  private all: PlayLayer[] = [];
  private entries = new Map<string, Entry>();
  private claims = 0;
  private listeners = new Set<() => void>();
  /** The browser refused to start a video with its sound before a click: it plays muted until the next one. */
  private soundBlocked = false;
  private resumeArmed = false;

  constructor() {
    videoSound.setHost({ analyser: id => this.analyser(id), state: id => this.soundState(id), file: id => this.file(id) });
  }

  /** Something the card shows changed (loaded, missing, playing). Returns an unsubscribe. */
  subscribe = (fn: () => void): (() => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  private emit(): void { for (const fn of this.listeners) fn(); videoSound.changed(); }

  /** A preview is running (it keeps the videos on its clock): they run until the returned release. */
  claim(): () => void {
    this.claims++;
    this.emit();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.claims = Math.max(0, this.claims - 1);
      if (!this.claims) for (const e of this.entries.values()) e.el?.pause();
      this.emit();
    };
  }

  /** The setup that plays changed: open new files, let go of layers that left. */
  setRecord(record: Pick<PlayRecord, 'layers'>): void {
    this.all = record.layers;
    this.layers = record.layers.filter((l): l is VideoLayer => l.kind === 'video');
    let changed = false;
    for (const [id, e] of this.entries) {
      const l = this.layers.find(x => x.id === id);
      if (!l || l.videoId !== e.videoId) { this.drop(id); changed = true; }
    }
    for (const l of this.layers) {
      if (!l.videoId) continue;
      const e = this.entries.get(l.id);
      if (!e) { this.open(l); changed = true; }
      else if (this.applySound(l, e)) changed = true;
    }
    // Only real changes reach the cards: this runs on every edit of the setup.
    if (changed) this.emit();
  }

  // ── Files ──────────────────────────────────────────────────────────────────

  /**
   * Keep a picked file in the library and return what the layer records. When
   * the library can't take it (no IndexedDB, full), it plays for this session
   * only (`session:` id), and the card asks for it again after a reload.
   */
  async pick(file: File): Promise<{ videoId: string; fileName: string; bytes: number; kept: boolean }> {
    const fileName = file.name.slice(0, 120) || 'Video';
    let videoId = '', kept = true;
    try { videoId = (await addVideoFile(file)).id; } catch { videoId = `session:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`; kept = false; }
    if (!files.has(videoId)) files.set(videoId, { url: URL.createObjectURL(file), blob: file, name: fileName });
    return { videoId, fileName, bytes: file.size, kept };
  }

  private async urlFor(videoId: string): Promise<{ url: string; blob: Blob; name: string } | null> {
    const had = files.get(videoId);
    if (had) return had;
    if (videoId.startsWith('session:')) return null;
    const v = await getVideo(videoId);
    if (!v) return null;
    const got = { url: URL.createObjectURL(v.blob), blob: v.blob, name: v.name };
    files.set(videoId, got);
    return got;
  }

  private open(l: VideoLayer): void {
    const e: Entry = { videoId: l.videoId, el: null, status: 'loading', error: '', started: false, analyser: null, gain: null, unplug: null, sound: 'off' };
    this.entries.set(l.id, e);
    void this.urlFor(l.videoId).then(found => {
      if (this.entries.get(l.id) !== e) return;
      if (!found) { e.status = 'missing'; this.emit(); return; }
      rememberMedia(mediaKey(l.id), 'video', l.fileName || found.name || 'video', found.blob.type, found.blob);
      e.el = makeVideo(found.url, ok => {
        if (this.entries.get(l.id) !== e) return;
        e.status = ok ? 'ready' : 'error';
        e.error = ok ? '' : describeError(e.el?.error ?? null);
        const cur = this.layers.find(x => x.id === l.id);
        if (ok && cur) this.applySound(cur, e);
        this.emit();
      }, () => this.emit());
    }, err => {
      if (this.entries.get(l.id) !== e) return;
      e.status = 'error';
      e.error = err instanceof Error ? err.message : String(err);
      this.emit();
    });
  }

  private drop(layerId: string): void {
    const e = this.entries.get(layerId);
    if (!e) return;
    this.entries.delete(layerId);
    this.unplug(e);
    if (e.el) { e.el.pause(); e.el.removeAttribute('src'); e.el.load(); }
    forgetMedia(mediaKey(layerId));
  }

  /** The layer's opened file and its length (0 while unknown), or null while it has none (an offline render mixes its sound from it). */
  file(layerId: string): { blob: Blob; duration: number } | null {
    const e = this.entries.get(layerId);
    const f = e && e.status === 'ready' ? files.get(e.videoId) : undefined;
    return f ? { blob: f.blob, duration: this.duration(layerId) } : null;
  }

  /** The layer's element (for the kit to draw), or null while it has none. */
  element(layerId: string): HTMLVideoElement | null { return this.entries.get(layerId)?.el ?? null; }

  status(layerId: string): VideoFileStatus { return this.entries.get(layerId)?.status ?? 'none'; }
  errorText(layerId: string): string { return this.entries.get(layerId)?.error ?? ''; }
  /** Length in seconds, 0 while unknown. */
  duration(layerId: string): number { const d = this.element(layerId)?.duration ?? 0; return Number.isFinite(d) && d > 0 ? d : 0; }
  position(layerId: string): number { return this.element(layerId)?.currentTime ?? 0; }
  /** Width / height of the frame, 0 while unknown. */
  aspect(layerId: string): number { const v = this.element(layerId); return v && v.videoWidth ? v.videoWidth / Math.max(1, v.videoHeight) : 0; }

  // ── The clock ──────────────────────────────────────────────────────────────

  /** Does this layer run now: a preview is up, and it shows, is a matte, or is heard or listened to. */
  private runs(l: VideoLayer): boolean {
    return this.claims > 0 && (l.visible || l.sound !== 'off' || matteUsers(this.all, l.id).length > 0);
  }

  /** Keep the videos on the graph clock (the live preview, once a frame). */
  follow(time: number, clockPlaying: boolean): void {
    for (const l of this.layers) {
      const e = this.entries.get(l.id), v = e?.el;
      if (!e || !v || v.readyState < 1) continue;
      if (!this.runs(l)) { if (!v.paused) v.pause(); continue; }
      const rate = l.speed > 0 ? l.speed : 1;
      if (v.playbackRate !== rate) v.playbackRate = rate;
      if (e.gain) {
        const vol = l.sound === 'play' ? Math.max(0, Math.min(1, playEngine.layerValue(l.id, 'volume', l.volume))) : 0;
        if (Math.abs(e.gain.gain.value - vol) > 1e-3) e.gain.gain.value = vol;
      }
      if (!l.follow) {
        if (v.loop !== l.loop) v.loop = l.loop;
        if (!e.started) { e.started = true; if (l.start > 0) v.currentTime = l.start; }
        if (l.playing && v.paused && !v.ended) this.play(v);
        else if (!l.playing && !v.paused) v.pause();
        continue;
      }
      // Looping on its own too, so it never stops at the end between two frames (the clock keeps it in line).
      if (v.loop !== l.loop) v.loop = l.loop;
      const d = v.duration, known = Number.isFinite(d) && d > 0;
      const run = clockPlaying && l.playing;
      const target = videoLayerTimeAt(l.playing ? time : 0, d, rate, l.loop, l.start);
      const diff = Math.abs(v.currentTime - target);
      const off = !known ? 0 : l.loop ? Math.min(diff, d - diff) : diff;
      const atEnd = known && !l.loop && target >= d - 0.01;
      if (run && !atEnd) {
        if (v.paused) this.play(v);
        if (off > 0.3 && !v.seeking) v.currentTime = target;
      } else {
        if (!v.paused) v.pause();
        if (off > 0.02 && !v.seeking) v.currentTime = target;
      }
    }
  }

  private play(v: HTMLVideoElement): void {
    const p = v.play();
    if (p) p.catch(err => {
      // Sound needs a click first: play muted now, and try the sound again on the next click.
      if ((err as DOMException)?.name === 'NotAllowedError' && !v.muted) {
        this.soundBlocked = true;
        v.muted = true;
        this.armResume();
        void v.play().catch(() => {});
      }
    });
  }

  /**
   * An offline render's frame: each running video exactly at `time`, decoded,
   * before the layers read it. A free-running video renders as if it followed
   * the clock (the only way a render can be the same every time).
   */
  async seek(time: number): Promise<void> {
    for (const l of this.layers) {
      const v = this.entries.get(l.id)?.el;
      if (!v || !(l.visible || matteUsers(this.all, l.id).length > 0)) continue;
      if (v.readyState < 1) await waitFor(v, 'loadedmetadata', 4000);
      if (!v.paused) v.pause();
      const target = videoLayerTimeAt(l.playing ? time : 0, v.duration, l.speed, l.loop, l.start);
      if (Math.abs(v.currentTime - target) < 0.0005 && v.readyState >= 2) continue;
      const done = waitFor(v, 'seeked', 3000);
      v.currentTime = target;
      await done;
      if (v.readyState < 2) await waitFor(v, 'loadeddata', 2000);
    }
  }

  // ── Sound ──────────────────────────────────────────────────────────────────

  /** Resume the audio context (call from a click or key: browsers start sound only after one). */
  resumeAudio(): void {
    let ctx: AudioContext;
    try { ctx = audioEngine.context(); } catch { return; }
    if (ctx.state === 'suspended') void ctx.resume().then(() => this.emit(), () => {});
    if (this.soundBlocked) {
      this.soundBlocked = false;
      for (const l of this.layers) { const e = this.entries.get(l.id); if (e?.el && l.sound !== 'off') e.el.muted = false; }
    }
  }

  /** On the next click or key anywhere, resume the sound. */
  private armResume(): void {
    if (this.resumeArmed || typeof window === 'undefined') return;
    this.resumeArmed = true;
    const go = () => { this.resumeArmed = false; window.removeEventListener('pointerdown', go, true); window.removeEventListener('keydown', go, true); this.resumeAudio(); };
    window.addEventListener('pointerdown', go, true);
    window.addEventListener('keydown', go, true);
  }

  /** Route the layer's sound as its Sound setting says. True when that changed what the readers can hear. */
  private applySound(l: VideoLayer, e: Entry): boolean {
    const v = e.el;
    if (!v || e.status !== 'ready') return false;
    const was = e.sound;
    e.sound = l.sound;
    if (l.sound === 'off') {
      v.muted = true;
      if (e.gain) e.gain.gain.value = 0;
      return was !== 'off';
    }
    if (!e.analyser) {
      let ctx: AudioContext;
      try { ctx = audioEngine.context(); } catch { return false; }
      let src = sources.get(v);
      if (!src) {
        try { src = ctx.createMediaElementSource(v); } catch { return false; }
        sources.set(v, src);
      }
      const an = ctx.createAnalyser();
      an.fftSize = 2048; an.smoothingTimeConstant = 0.8;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      // The sound → its effect chain → the layer's volume → the mix; the analyser taps the chain (lib/audioFx.ts).
      const inlet = ctx.createGain();
      src.connect(inlet);
      const unFx = audioFxHost.attach(ctx, layerChainId(l.id), inlet, gain, an);
      e.analyser = an; e.gain = gain;
      const unOut = audioEngine.connectOutside(gain);
      e.unplug = () => { unOut(); unFx(); };
      if (ctx.state === 'suspended') { void ctx.resume().then(() => this.emit(), () => {}); this.armResume(); }
    }
    v.volume = 1;
    v.muted = this.soundBlocked;
    if (e.gain) e.gain.gain.value = l.sound === 'play' ? Math.max(0, Math.min(1, l.volume)) : 0;
    return was !== l.sound;
  }

  private unplug(e: Entry): void {
    e.unplug?.();
    e.unplug = null;
    try { e.analyser?.disconnect(); } catch { /* already off */ }
    if (e.el) { const src = sources.get(e.el); try { src?.disconnect(); } catch { /* already off */ } }
    e.analyser = null; e.gain = null;
  }

  analyser(layerId: string): AnalyserNode | null {
    const l = this.layers.find(x => x.id === layerId), e = this.entries.get(layerId);
    return l && l.sound !== 'off' && e?.status === 'ready' ? e.analyser : null;
  }

  soundState(layerId: string): VideoSoundState {
    const l = this.layers.find(x => x.id === layerId);
    if (!l) return 'gone';
    if (l.sound === 'off') return 'off';
    const e = this.entries.get(layerId);
    if (!l.videoId || !e || e.status === 'missing' || e.status === 'error' || e.status === 'none') return 'no-file';
    if (e.status === 'loading' || !e.el) return 'loading';
    return e.el.paused ? 'paused' : 'playing';
  }

  /** Is the audio context waiting for a click before it makes sound? */
  audioSuspended(): boolean {
    try { return audioEngine.context().state === 'suspended'; } catch { return false; }
  }
}

function makeVideo(url: string, onReady: (ok: boolean) => void, onChange: () => void): HTMLVideoElement {
  const v = document.createElement('video');
  v.playsInline = true; v.preload = 'auto'; v.muted = true; v.loop = false;
  v.setAttribute('playsinline', '');
  let settled = false;
  const settle = (ok: boolean) => { if (settled) { onChange(); return; } settled = true; onReady(ok); };
  v.addEventListener('loadeddata', () => settle(true));
  v.addEventListener('loadedmetadata', () => {
    // Videos recorded in a browser often say their length is Infinity until played through:
    // a seek past the end makes it work it out, then back to the start.
    if (v.duration === Infinity) {
      const back = () => { v.removeEventListener('durationchange', back); v.currentTime = 0; onChange(); };
      v.addEventListener('durationchange', back);
      v.currentTime = 1e7;
    }
    onChange();
  });
  v.addEventListener('play', onChange);
  v.addEventListener('pause', onChange);
  v.addEventListener('error', () => settle(false));
  v.src = url;
  return v;
}

function describeError(err: MediaError | null): string {
  if (!err) return 'This browser couldn’t open that video.';
  if (err.code === 4) return 'This browser can’t play that format (MP4 with H.264, or WebM, work everywhere).';
  if (err.code === 3) return 'The file is corrupt or uses a codec this browser can’t decode.';
  return 'This browser couldn’t read that video.';
}

function waitFor(el: HTMLElement, event: string, ms: number): Promise<void> {
  return new Promise(resolve => {
    const done = () => { el.removeEventListener(event, done); clearTimeout(timer); resolve(); };
    const timer = setTimeout(done, ms);
    el.addEventListener(event, done);
  });
}

export const playVideoLayers = new PlayVideoLayers();
