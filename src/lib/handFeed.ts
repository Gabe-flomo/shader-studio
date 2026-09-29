/**
 * handFeed.ts — the trackers' front doors (docs/tracking.md): hands, face and
 * pose, one feed each. Light on purpose: it sits in the main bundle, holds
 * each tracker's status and newest frame, and loads the tracker itself
 * (lib/trackerPump.ts, MediaPipe in a worker) only the first time someone
 * turns that tracker on. Each model loads only when its tracker is enabled.
 *
 * Frames come from the shared webcam (lib/cameraInput.ts): Enable opens it
 * from the click (browsers ask the first time), so a Camera layer and the
 * trackers never fight over it. Or from a Video layer being tracked live (the
 * Play engine sets `setVideoSource`): then no camera is needed. A Video layer
 * that has been analysed (baked) needs no feed at all: the engine reads its
 * stored frames (lib/trackBakes.ts).
 *
 * Nothing leaves the machine: the models and MediaPipe's WebAssembly are
 * served with the app, and frames go from the camera to a worker and back as
 * landmarks.
 */
import { cameraInput } from './cameraInput';
import { inputBus } from './inputBus';
import type { HdFrame } from '../play/kit/hands.js';
import type { TkFrame } from '../play/kit/tracks.js';

export type TrackerKind = 'hands' | 'face' | 'pose';
export type TrackerStatus = 'off' | 'starting' | 'on' | 'blocked' | 'error' | 'unsupported';
export type HandStatus = TrackerStatus;

export interface TrackerStats {
  /** Tracker frames a second, over the last second or so. */
  fps: number;
  /** Time the model took on the last frame (ms, in the worker). */
  inferMs: number;
  /** Frame taken → landmarks back (ms). */
  latencyMs: number;
  delegate: 'GPU' | 'CPU' | '';
}
export type HandStats = TrackerStats;

/** A frame source other than the camera: a Video layer's element, or a dev test video or image (main.tsx). */
export type TrackerSource = HTMLVideoElement | HTMLImageElement | HTMLCanvasElement;
export type HandSource = TrackerSource;

/** What a tracker hands in: hands (play/kit/hands.js), or a face or body (play/kit/tracks.js items). */
export type TrackerFrame = HdFrame | TkFrame;

/** What the lazily loaded tracker module hands back. */
export interface TrackerHandle {
  stop(): void;
  setPaused(on: boolean): void;
  setOptions(o: TrackerOptions): void;
}
export type HandTrackerHandle = TrackerHandle;

/** MediaPipe's settings: its three confidence thresholds, and hands to look for (play/kit/hands.js hdTrackerOptions). */
export interface TrackerOptions { numHands?: 1 | 2; detection: number; presence: number; tracking: number }
export interface HandOptions extends TrackerOptions { numHands: 1 | 2 }

const WHAT: Record<TrackerKind, string> = { hands: 'Hand tracking', face: 'Face tracking', pose: 'Body tracking' };

export class TrackerFeed<F extends TrackerFrame = TrackerFrame> {
  private status: TrackerStatus = typeof window !== 'undefined' && typeof Worker !== 'undefined' ? 'off' : 'unsupported';
  private message = '';
  private listeners = new Set<(s: TrackerStatus) => void>();
  private tracker: TrackerHandle | null = null;
  private starting: Promise<TrackerStatus> | null = null;
  private source: TrackerSource | null = null;
  private videoSource: (() => TrackerSource | null) | null = null;
  private paused = false;
  private latest: F | null = null;
  private seq = 0;
  private count = 0;
  private options: TrackerOptions;
  stats: TrackerStats = { fps: 0, inferMs: 0, latencyMs: 0, delegate: '' };

  readonly kind: TrackerKind;
  constructor(kind: TrackerKind) {
    this.kind = kind;
    this.options = kind === 'hands' ? { numHands: 2, detection: 0.6, presence: 0.57, tracking: 0.55 } : { detection: 0.6, presence: 0.57, tracking: 0.55 };
  }

  getStatus(): TrackerStatus { return this.status; }
  /** Why it isn't running, in plain words (a blocked camera, a model that didn't load). */
  getMessage(): string { return this.message; }
  /** Hands (or faces, bodies) in view: those the Play engine shows. */
  handCount(): number { return this.count; }
  /** The Play engine reports what it shows after each frame. */
  setCount(n: number): void {
    if (n === this.count) return;
    this.count = n;
    for (const l of this.listeners) l(this.status);
  }
  isOn(): boolean { return this.status === 'on'; }

  onStatus(cb: (s: TrackerStatus) => void): () => void {
    this.listeners.add(cb);
    return () => { this.listeners.delete(cb); };
  }

  private setStatus(s: TrackerStatus, message = ''): void {
    this.status = s;
    this.message = message;
    for (const l of this.listeners) l(s);
    inputBus.wake();
  }

  /** The newest frame and its number (a new number = new landmarks to take in). */
  frame(): { frame: F | null; seq: number } { return { frame: this.latest, seq: this.seq }; }

  /** The tracker (or a test) delivers a frame. */
  push(frame: F): void {
    this.latest = frame;
    this.seq++;
    inputBus.wake();
  }

  /** Where frames come from: a dev source, else the Video layer being tracked, else the camera. */
  currentSource(): TrackerSource | null { return this.source ?? (this.videoSource ? this.videoSource() : cameraInput.element()); }
  /** Feed a video, image or canvas instead of the camera (dev and tests); null goes back to the camera. */
  useSource(el: TrackerSource | null): void { this.source = el; }
  /** Track a Video layer live (its element, while it has one) instead of the camera; null goes back to the camera. */
  setVideoSource(get: (() => TrackerSource | null) | null): void {
    if (get === this.videoSource) return;
    this.videoSource = get;
    this.latest = null;
    this.seq++;
    for (const l of this.listeners) l(this.status);
  }
  /** Is it tracking a video (not the camera)? */
  tracksVideo(): boolean { return !!this.videoSource; }

  /**
   * Turn the tracker on. Call from a click: the camera opens first, inside
   * the gesture (unless it tracks a video), then the tracker loads (the first
   * time) and starts.
   */
  start(): Promise<TrackerStatus> {
    if (this.status === 'on' || this.status === 'unsupported') return Promise.resolve(this.status);
    if (this.starting) return this.starting;
    const cam = this.source || this.videoSource ? Promise.resolve('on' as const) : cameraInput.start();
    this.setStatus('starting');
    this.starting = (async () => {
      const c = await cam;
      if (c !== 'on') {
        this.setStatus(c === 'unsupported' ? 'unsupported' : 'blocked', c === 'unsupported' ? 'This browser has no camera access.' : 'The camera is blocked or missing. Allow it in the browser (or System Settings → Privacy → Camera for the desktop app) and try again.');
        return this.status;
      }
      try {
        const { startTracker } = await import('./trackerPump');
        this.tracker = await startTracker({
          kind: this.kind,
          source: () => this.currentSource(),
          push: f => this.push(f as F),
          stats: s => { this.stats = s; },
          options: this.options,
        });
        this.tracker.setPaused(this.paused);
        this.setStatus('on');
      } catch (e) {
        console.warn(`[${this.kind}] could not start tracking`, e);
        this.tracker = null;
        this.setStatus('error', `${WHAT[this.kind]} couldn’t start here. It needs WebAssembly and module workers (a current Chrome, Edge, Firefox or Safari 17+).`);
      }
      return this.status;
    })().finally(() => { this.starting = null; });
    return this.starting;
  }

  /** The setup's thresholds (and Max hands): kept for the next start, and passed to a running tracker. */
  configure(o: TrackerOptions): void {
    const c = this.options;
    if (c.numHands === o.numHands && c.detection === o.detection && c.presence === o.presence && c.tracking === o.tracking) return;
    this.options = { ...o };
    this.tracker?.setOptions(this.options);
  }
  getOptions(): TrackerOptions { return this.options; }

  /** Stop tracking. The camera turns off too unless a layer still uses it (lib/cameraKeeper.ts). */
  stop(): void {
    this.tracker?.stop();
    this.tracker = null;
    this.latest = null;
    this.count = 0;
    this.seq++;
    if (this.status !== 'unsupported') this.setStatus('off');
  }

  /** A take playing back: the tracker rests (the take has every value), and picks up again after. */
  setPaused(on: boolean): void {
    if (on === this.paused) return;
    this.paused = on;
    this.tracker?.setPaused(on);
    for (const l of this.listeners) l(this.status);
  }
  isPaused(): boolean { return this.paused; }
}

export const handFeed = new TrackerFeed<HdFrame>('hands');
export const faceFeed = new TrackerFeed<TkFrame>('face');
export const poseFeed = new TrackerFeed<TkFrame>('pose');
export const trackerFeeds = { hands: handFeed, face: faceFeed, pose: poseFeed } as const;
