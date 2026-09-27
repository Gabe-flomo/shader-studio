/**
 * background.ts — what stands in for the shader on the Play page: an image,
 * a video or a flat colour (PlayDisplay.source). Module singleton, no React.
 *
 * It applies only while the Play page (or the Stage) is open: those claim it,
 * so the Studio always shows and runs the graph. While it applies,
 * ShaderCanvas skips the shader entirely (no draw, no probes or readbacks)
 * and the layer kit paints the background under the layers and reads it
 * wherever it would read the picture (see `planFrame`).
 *
 * A video follows the graph clock: frame t of the clock shows the video at
 * t × rate (wrapped when it loops), so pausing the preview pauses it, ↺ starts
 * it over, and an offline render seeks it frame by frame (`seek`).
 *
 * A video too big to keep in the record (BACKGROUND_VIDEO_KEEP) plays from
 * a session copy (`setSessionVideo`); the record keeps its name and size so
 * the page can ask for it again after a reload.
 */
import { backgroundSource, pictureHidden, replacesShader, videoTimeAt, type PlayDisplay } from '../types/play';
import type { KitBackground } from './kit/layers.js';

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

type Listener = () => void;

class PlayBackground {
  private display: PlayDisplay | undefined;
  private claims = 0;
  private img: HTMLImageElement | null = null;
  private imgSrc = '';
  private video: HTMLVideoElement | null = null;
  private videoSrc = '';
  /** A video over the keep limit, for this session: its object URL, by file name and size. */
  private session: { name: string; bytes: number; url: string } | null = null;
  private listeners = new Set<Listener>();
  /** The browser refused to play the video with its sound (no click yet): it plays muted until the next gesture. */
  private soundBlocked = false;

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
      if (!this.claims) this.video?.pause();
      this.emit();
    };
  }

  setDisplay(d: PlayDisplay | undefined): void {
    if (d === this.display) return;
    this.display = d;
    this.sync();
    this.emit();
  }

  /** Does something other than the shader show now (the Play page is open and its source isn't the shader)? */
  active(): boolean { return this.claims > 0 && replacesShader(this.display); }

  /** "Layers only" for the kit: the legacy shader switch everywhere, any source's while the background applies. */
  hidden(): boolean {
    if (this.active()) return pictureHidden(this.display);
    return backgroundSource(this.display) === 'shader' && this.display?.picture === false;
  }

  /** What the kit paints and reads in place of the shader, or null for the shader. */
  kitBackground(): KitBackground | null {
    if (!this.active()) return null;
    const d = this.display!;
    const src = backgroundSource(d);
    const el = src === 'image' ? this.readyImage() : src === 'video' ? this.video : null;
    return { el, fit: d.fit ?? 'cover', colour: d.backdrop };
  }

  /** The video element playing now (for the panel: its duration, whether it loaded). */
  videoElement(): HTMLVideoElement | null { return backgroundSource(this.display) === 'video' ? this.video : null; }

  /** A video too big to keep plays from this copy for the rest of the session. */
  setSessionVideo(file: File): void {
    if (this.session) URL.revokeObjectURL(this.session.url);
    this.session = { name: file.name, bytes: file.size, url: URL.createObjectURL(file) };
    this.sync();
    this.emit();
  }

  /** Is the session copy the one the record names? (After a reload it isn't there: the panel asks for it again.) */
  hasSessionVideo(name: string, bytes: number): boolean { return !!this.session && this.session.name === name && this.session.bytes === bytes; }

  /** A playing video keeps the loop running; so does a video still loading its first frame. */
  moving(playing: boolean): boolean {
    if (!this.active() || backgroundSource(this.display) !== 'video' || !this.video) return false;
    return playing || this.video.readyState < 2 || this.video.seeking;
  }

  /** Keep the video on the graph clock (the live preview, once a frame). */
  follow(time: number, playing: boolean): void {
    const v = this.active() && backgroundSource(this.display) === 'video' ? this.video : null;
    const opts = this.display?.video;
    if (!v || !opts || v.readyState < 1) return;
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

  /** An offline render's frame: the video exactly at `time`, decoded, before the layers read it. */
  async seek(time: number): Promise<void> {
    const v = this.active() && backgroundSource(this.display) === 'video' ? this.video : null;
    const opts = this.display?.video;
    if (!v || !opts) return;
    if (v.readyState < 1) await waitFor(v, 'loadedmetadata', 4000);
    if (!v.paused) v.pause();
    const target = Number.isFinite(v.duration) ? videoTimeAt(time, v.duration, opts.rate, opts.loop) : Math.max(0, time) * opts.rate;
    if (Math.abs(v.currentTime - target) < 0.0005 && v.readyState >= 2) return;
    const done = waitFor(v, 'seeked', 3000);
    v.currentTime = target;
    await done;
    if (v.readyState < 2) await waitFor(v, 'loadeddata', 2000);
  }

  // ── Elements ───────────────────────────────────────────────────────────────

  private readyImage(): HTMLImageElement | null {
    const img = this.img;
    return img && img.complete && img.naturalWidth > 0 ? img : null;
  }

  /** The URL the video plays from: the kept data URL, or the session copy of a big one. */
  private videoUrl(): string {
    const v = this.display?.video;
    if (!v) return '';
    if (v.src) return v.src;
    return this.session && this.session.name === v.name && this.session.bytes === v.bytes ? this.session.url : '';
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
      if (this.video) { this.video.pause(); this.video.removeAttribute('src'); this.video.load(); this.video = null; }
      if (url) {
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
        this.video = v;
      }
    }
  }
}

function waitFor(el: HTMLElement, event: string, ms: number): Promise<void> {
  return new Promise(resolve => {
    const done = () => { el.removeEventListener(event, done); clearTimeout(timer); resolve(); };
    const timer = setTimeout(done, ms);
    el.addEventListener(event, done);
  });
}

export const playBackground = new PlayBackground();
