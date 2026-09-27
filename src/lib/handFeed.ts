/**
 * handFeed.ts — hand tracking's front door (docs/hand-tracking.md). Light on
 * purpose: it sits in the main bundle, holds the status and the newest
 * tracker frame, and loads the tracker itself (lib/handTracker.ts, MediaPipe
 * in a worker) only the first time someone turns hands on.
 *
 * The camera is the shared webcam (lib/cameraInput.ts): Enable opens it from
 * the click (browsers ask the first time), so a Camera layer and hand
 * tracking never fight over it, and tracking works with no Camera layer.
 *
 * Nothing leaves the machine: the model and MediaPipe's WebAssembly are
 * served with the app, and frames go from the camera to a worker and back as
 * landmarks.
 */
import { cameraInput } from './cameraInput';
import { inputBus } from './inputBus';
import type { HdFrame } from '../play/kit/hands.js';

export type HandStatus = 'off' | 'starting' | 'on' | 'blocked' | 'error' | 'unsupported';

export interface HandStats {
  /** Tracker frames a second, over the last second or so. */
  fps: number;
  /** Time the model took on the last frame (ms, in the worker). */
  inferMs: number;
  /** Camera frame taken → landmarks back (ms). */
  latencyMs: number;
  delegate: 'GPU' | 'CPU' | '';
}

/** A frame source other than the camera (a dev test video or image, see main.tsx). */
export type HandSource = HTMLVideoElement | HTMLImageElement | HTMLCanvasElement;

/** What the lazily loaded tracker module hands back. */
export interface HandTrackerHandle {
  stop(): void;
  setPaused(on: boolean): void;
}

class HandFeed {
  private status: HandStatus = typeof window !== 'undefined' && typeof Worker !== 'undefined' ? 'off' : 'unsupported';
  private message = '';
  private listeners = new Set<(s: HandStatus) => void>();
  private tracker: HandTrackerHandle | null = null;
  private starting: Promise<HandStatus> | null = null;
  private source: HandSource | null = null;
  private paused = false;
  private latest: HdFrame | null = null;
  private seq = 0;
  private count = 0;
  stats: HandStats = { fps: 0, inferMs: 0, latencyMs: 0, delegate: '' };

  getStatus(): HandStatus { return this.status; }
  /** Why it isn't running, in plain words (a blocked camera, a model that didn't load). */
  getMessage(): string { return this.message; }
  /** Hands in view in the newest frame. */
  handCount(): number { return this.count; }
  isOn(): boolean { return this.status === 'on'; }

  onStatus(cb: (s: HandStatus) => void): () => void {
    this.listeners.add(cb);
    return () => { this.listeners.delete(cb); };
  }

  private setStatus(s: HandStatus, message = ''): void {
    this.status = s;
    this.message = message;
    for (const l of this.listeners) l(s);
    inputBus.wake();
  }

  /** The newest frame and its number (a new number = new landmarks to take in). */
  frame(): { frame: HdFrame | null; seq: number } { return { frame: this.latest, seq: this.seq }; }

  /** The tracker (or a test) delivers a frame. */
  push(frame: HdFrame): void {
    this.latest = frame;
    this.seq++;
    const n = frame.hands.length;
    if (n !== this.count) { this.count = n; for (const l of this.listeners) l(this.status); }
    inputBus.wake();
  }

  /** Where frames come from: the camera, unless a dev source is set. */
  currentSource(): HandSource | null { return this.source ?? cameraInput.element(); }
  /** Feed a video, image or canvas instead of the camera (dev and tests); null goes back to the camera. */
  useSource(el: HandSource | null): void { this.source = el; }

  /**
   * Turn hand tracking on. Call from a click: the camera opens first, inside
   * the gesture, then the tracker loads (the first time) and starts.
   */
  start(): Promise<HandStatus> {
    if (this.status === 'on' || this.status === 'unsupported') return Promise.resolve(this.status);
    if (this.starting) return this.starting;
    const cam = this.source ? Promise.resolve('on' as const) : cameraInput.start();
    this.setStatus('starting');
    this.starting = (async () => {
      const c = await cam;
      if (c !== 'on') {
        this.setStatus(c === 'unsupported' ? 'unsupported' : 'blocked', c === 'unsupported' ? 'This browser has no camera access.' : 'The camera is blocked or missing. Allow it in the browser (or System Settings → Privacy → Camera for the desktop app) and try again.');
        return this.status;
      }
      try {
        const { startHandTracker } = await import('./handTracker');
        this.tracker = await startHandTracker({
          source: () => this.currentSource(),
          push: f => this.push(f),
          stats: s => { this.stats = s; },
        });
        this.tracker.setPaused(this.paused);
        this.setStatus('on');
      } catch (e) {
        console.warn('[hands] could not start hand tracking', e);
        this.tracker = null;
        this.setStatus('error', 'Hand tracking couldn’t start here. It needs WebAssembly and module workers (a current Chrome, Edge, Firefox or Safari 17+).');
      }
      return this.status;
    })().finally(() => { this.starting = null; });
    return this.starting;
  }

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

export const handFeed = new HandFeed();
