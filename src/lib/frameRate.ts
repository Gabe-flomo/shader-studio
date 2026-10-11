/**
 * frameRate — the canvas frame rate (docs/frame-rate.md): Auto (the screen's own refresh rate) or a
 * chosen rate such as 12 fps for a stop-motion, "posterize time" look.
 *
 * One setting, three ways to use it (`mode`):
 *   both       draw at N fps and step the time the shader sees by 1/N (the default)
 *   draw       draw at N fps only (saves GPU); the time is the real time at each drawn frame
 *   posterize  step the time by 1/N only; the canvas still draws at the screen's rate, so feedback,
 *              particles, knobs and the mouse stay smooth while time-driven motion is choppy
 *
 * Saved with the graph (PlayRecord.frameRate) so a stop-motion graph keeps its look, with a
 * remembered default for graphs that don't set their own. The screen's refresh rate is measured from
 * requestAnimationFrame intervals (lib/refreshRate.ts) and caps the choice.
 *
 * Everything here but the store is pure: the frame loop (ShaderCanvas), offline renders (exports,
 * bake) and the small web snippet (play/embedLite.ts) share the maths.
 */
import { create } from 'zustand';

export type FrameRateMode = 'both' | 'draw' | 'posterize';

export interface FrameRateSetting {
  /** Frames a second, or 'auto' (the screen's rate, time unstepped). */
  fps: number | 'auto';
  /** Absent = 'both'. */
  mode?: FrameRateMode;
}

export const FRAME_RATE_PRESETS = [6, 8, 12, 15, 24, 30, 60] as const;
export const FRAME_RATE_MODES: readonly { value: FrameRateMode; label: string; hint: string }[] = [
  { value: 'both', label: 'Both', hint: 'Draws N times a second and steps time by 1/N: the stop-motion look, and it saves GPU' },
  { value: 'draw', label: 'Draw less', hint: 'Only draws N times a second (saves GPU); time itself is not stepped' },
  { value: 'posterize', label: 'Step time', hint: 'Time moves in steps of 1/N, but the canvas draws at the screen’s rate: feedback, particles and the mouse stay smooth' },
];

/** Lowest and highest rates you can type. */
export const MIN_FPS = 1;
export const MAX_FPS = 360;
/** Refresh rates screens come in; a measurement close to one snaps to it. */
export const COMMON_REFRESH_RATES = [24, 25, 30, 48, 50, 60, 72, 75, 85, 90, 100, 120, 144, 165, 170, 175, 180, 200, 240, 280, 360] as const;
/** Assumed until a measurement comes in. */
export const DEFAULT_SCREEN_HZ = 60;
/** A step a hair early still counts (floating-point time sums). */
const STEP_EPS = 1e-6;

// ── Screen refresh ──────────────────────────────────────────────────────────

/**
 * The display's refresh rate from requestAnimationFrame intervals (ms), or null when there are too
 * few to tell. A busy page drops frames (an interval of two refreshes), so it reads a low percentile
 * of the intervals rather than the mean, then snaps to a common rate within 4%.
 */
export function estimateRefreshHz(intervalsMs: readonly number[]): number | null {
  const xs = intervalsMs.filter(x => Number.isFinite(x) && x > 1 && x < 100).sort((a, b) => a - b);
  if (xs.length < 8) return null;
  // The cluster around the 25th percentile (one refresh), averaged: dropped frames (two refreshes or
  // more) fall outside it, and the jitter either way averages out.
  const p25 = xs[Math.floor(xs.length * 0.25)];
  const cluster = xs.filter(x => x > p25 * 0.6 && x < p25 * 1.4);
  const hz = 1000 / (cluster.reduce((a, b) => a + b, 0) / cluster.length);
  let best: number | null = null;
  for (const r of COMMON_REFRESH_RATES) if (Math.abs(r - hz) / r <= 0.04 && (best === null || Math.abs(r - hz) < Math.abs(best - hz))) best = r;
  return best ?? Math.round(hz);
}

// ── The setting ─────────────────────────────────────────────────────────────

/** A typed or chosen rate, kept between MIN_FPS and the screen's rate, to two decimals (23.98 works). */
export function clampFps(fps: number, screenHz: number = MAX_FPS): number {
  if (!Number.isFinite(fps)) return Math.min(MAX_FPS, Math.max(MIN_FPS, screenHz));
  const top = Math.max(MIN_FPS, Math.min(MAX_FPS, screenHz));
  return Math.round(Math.min(top, Math.max(MIN_FPS, fps)) * 100) / 100;
}

/** A saved setting, checked; undefined for anything malformed (a file from elsewhere). */
export function parseFrameRate(raw: unknown): FrameRateSetting | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const mode = r.mode === 'draw' || r.mode === 'posterize' ? r.mode : undefined;
  if (r.fps === 'auto') return { fps: 'auto' };
  if (typeof r.fps !== 'number' || !Number.isFinite(r.fps)) return undefined;
  return { fps: clampFps(r.fps), ...(mode ? { mode } : {}) };
}

/** What a frame loop does with a setting. */
export interface EffectiveFrameRate {
  /** The chosen rate, or null for Auto (the screen's). */
  fps: number | null;
  /** Draw only at `fps` (skip the screen's other frames). */
  draw: boolean;
  /** The shader's time moves in steps of 1/fps. */
  posterize: boolean;
}

export const AUTO_FRAME_RATE: EffectiveFrameRate = { fps: null, draw: false, posterize: false };

/**
 * The graph's own setting, else the default, else Auto. Live (`screenHz` given): capped at the
 * screen's rate, and a rate at or above it draws every frame. Offline renders pass no screen: the
 * setting as saved (an export's frames don't depend on the monitor).
 */
export function resolveFrameRate(graph: FrameRateSetting | undefined | null, fallback: FrameRateSetting | undefined | null, screenHz?: number): EffectiveFrameRate {
  const s = graph ?? fallback;
  if (!s || s.fps === 'auto') return AUTO_FRAME_RATE;
  const fps = clampFps(s.fps, screenHz ?? MAX_FPS);
  const mode = s.mode ?? 'both';
  const drawLess = screenHz === undefined || fps < screenHz - 0.5;
  return { fps, draw: mode !== 'posterize' && drawLess, posterize: mode !== 'draw' };
}

/** Short label for buttons and readouts: "Auto", "12 fps", "23.98 fps". */
export function frameRateLabel(s: FrameRateSetting | undefined | null): string {
  if (!s || s.fps === 'auto') return 'Auto';
  return `${+s.fps.toFixed(2)} fps`;
}

// ── Time stepping ───────────────────────────────────────────────────────────

/** Which 1/fps step `t` falls in. */
export function stepIndex(t: number, fps: number): number {
  return Math.floor(t * fps + STEP_EPS);
}

/** `t` held to the start of its 1/fps step: 0, 1/12, 2/12… for 12 fps. */
export function posterizeTime(t: number, fps: number | null): number {
  if (!fps || fps <= 0) return t;
  return stepIndex(t, fps) / fps;
}

// ── Live: which screen frames draw ──────────────────────────────────────────

export interface DrawGate {
  /** When the next frame is due (ms, rAF time), or null to draw the next one. */
  next: number | null;
  /** The time step last drawn (stepped time), or null. */
  step: number | null;
}

export const newDrawGate = (): DrawGate => ({ next: null, step: null });

/**
 * Whether this screen frame goes ahead. Stepped and playing: exactly when the time step changes
 * (so each drawn frame shows a new step, none twice, none skipped), or for an edit (`wants`) once the
 * interval is up. Otherwise on an even 1/fps cadence: a schedule that carries over (24 fps on 60 Hz
 * alternates 3 and 2 frames) and starts over after a stall. `slackMs` lets a frame a little early count.
 */
export function gateFrame(g: DrawGate, o: { now: number; fps: number; time: number; stepped: boolean; playing: boolean; wants: boolean; slackMs?: number }): boolean {
  const interval = 1000 / o.fps;
  const slack = o.slackMs ?? 2;
  const due = g.next === null || o.now >= g.next - slack;
  const take = () => {
    g.next = g.next === null || o.now - g.next > interval ? o.now + interval : g.next + interval;
    if (o.stepped) g.step = stepIndex(o.time, o.fps);
    return true;
  };
  if (o.stepped && o.playing) {
    const step = stepIndex(o.time, o.fps);
    if (step !== g.step) { g.step = step; g.next = o.now + interval; return true; }
    return o.wants && due ? take() : false;
  }
  return due ? take() : false;
}

// ── Offline: exports, recordings and bakes ──────────────────────────────────

export interface OfflineHold { step: number | null; time: number }
export const newOfflineHold = (): OfflineHold => ({ step: null, time: 0 });

/**
 * One frame of an offline render (an export at 30 or 60 fps, a bake) of a graph at `fr`: whether to
 * render it, at what time, and with what frame step. Drawing less (both, draw): a frame in the same
 * 1/fps step as the last one is held (not rendered: the last picture is read again), and a rendered
 * one steps feedback and particles by the time since the last, so simulations step once per drawn
 * frame, as live. Step time only: every frame renders at its stepped time with the export's own step.
 * `first` starts a render (a still: no `opts` at all).
 */
export function offlineFrame(h: OfflineHold, t: number, fr: EffectiveFrameRate, opts?: { dt?: number; first?: boolean }): { render: boolean; time: number; dt?: number } {
  const dt = opts?.dt;
  if (!fr.fps) return { render: true, time: t, dt };
  const fps = fr.fps;
  const step = stepIndex(t, fps);
  const time = fr.posterize || fr.draw ? step / fps : t;
  const first = !opts || !!opts.first || h.step === null;
  if (!fr.draw) { h.step = step; h.time = time; return { render: true, time, dt }; }
  if (!first && step === h.step) return { render: false, time: h.time };
  const stepDt = first ? dt : Math.max(1, step - (h.step as number)) / fps;
  h.step = opts ? step : null;
  h.time = time;
  return { render: true, time, dt: stepDt };
}

/** How many distinct pictures a render of `frames` frames at `exportFps` holds (tests, the export dialog's note). */
export function distinctFrames(frames: number, exportFps: number, fr: EffectiveFrameRate): number {
  const h = newOfflineHold();
  let n = 0;
  for (let i = 0; i < frames; i++) if (offlineFrame(h, i / exportFps, fr, { dt: 1 / exportFps, first: i === 0 }).render) n++;
  return n;
}

// ── The store: the screen's rate and the default ────────────────────────────

const DEFAULT_KEY = 'shader-studio:frame-rate-default';
const loadDefault = (): FrameRateSetting | null => {
  try { const raw = localStorage.getItem(DEFAULT_KEY); return raw ? parseFrameRate(JSON.parse(raw)) ?? null : null; } catch { return null; }
};

interface FrameRateState {
  /** The display's refresh rate as measured (lib/refreshRate.ts); DEFAULT_SCREEN_HZ until then. */
  screenHz: number;
  /** Whether screenHz was measured, not assumed. */
  measured: boolean;
  /** For graphs without their own setting. Null = Auto. */
  fallback: FrameRateSetting | null;
  setScreenHz: (hz: number) => void;
  setFallback: (s: FrameRateSetting | null) => void;
}

export const useFrameRate = create<FrameRateState>((set, get) => ({
  screenHz: DEFAULT_SCREEN_HZ,
  measured: false,
  fallback: loadDefault(),
  setScreenHz: hz => { if (get().screenHz !== hz || !get().measured) set({ screenHz: hz, measured: true }); },
  setFallback: fallback => {
    try { if (fallback) localStorage.setItem(DEFAULT_KEY, JSON.stringify(fallback)); else localStorage.removeItem(DEFAULT_KEY); } catch { /* preference only */ }
    set({ fallback });
  },
}));
