/**
 * protocol.ts — what the main window and the output window say to each other
 * (docs/projection.md, "How the output stays in sync").
 *
 * The output runs its own renderer (the website player in follow mode) from
 * a copy of the Play, and the main window streams what changes each frame:
 *
 *   record   the Play as the web player takes it (bundle + scripts), sent when
 *            its structure changes (a new shader, a layer added), never per frame
 *   frame    ~60 times a second: the clock, the pointer, and only the uniforms
 *            and layer numbers that changed since the last frame (a `full`
 *            frame now and then, and on request, carries all of them)
 *   actions  layer actions fired (bursts, drops…), inside the frame
 *   mapping  the projection mapping and which layers each surface reads
 *   ui       edit mode (handles), the test pattern, the selected surface
 *
 * The output answers with hello (send me everything), edit (a corner or mesh
 * point dragged on the output itself), ui, undo / redo and status.
 *
 * Pure: the reducer and the encoder are tested without windows.
 */
import type { ProjectionRecord, TestPattern } from '../types/projection';

export type Value = number | number[];
export type ValueMap = Record<string, Value>;

/** A layer action for the kit: `do` on `layerId` (`vel`: a drum pad's velocity). */
export interface OutAction { do: string; layerId: string; amount: number; vel?: number }

export interface OutputRecord {
  rev: number;
  title: string;
  /** What ShaderStudioPlay.mount takes (exportHtml's playBundle). */
  bundle: unknown;
  /** The layer kit and the player (and three.js when a 3D Script layer needs it). */
  scripts: string;
  /** The picture's width / height, or null to fill the output. */
  aspect: number | null;
  /** true: values come from the main window; false: the page runs on its own (a sandboxed Present snapshot). */
  follow: boolean;
  /** What the output can't show that the main window does (camera, MIDI pad grid…). */
  notes?: string[];
}

export interface OutputUi {
  /** Handles and outlines on the output. */
  edit: boolean;
  pattern: TestPattern;
  selected: string | null;
}

export const DEFAULT_UI: OutputUi = { edit: false, pattern: 'none', selected: null };

export interface FrameMsg {
  type: 'frame';
  seq: number;
  /** The Play clock (seconds) and whether it runs. */
  t: number;
  playing: boolean;
  /** x, y (0..1, y up), down (0/1), over (0/1). */
  p?: [number, number, number, number];
  /** Uniforms that changed (or all of them when `full`). */
  u?: ValueMap;
  /** Layer / Finish numbers that changed: `<layerId>::<key>`. */
  l?: ValueMap;
  a?: OutAction[];
  full?: boolean;
}

export type DownMsg =
  | { type: 'record'; record: OutputRecord }
  /** The record waits in the desktop app (too big for an event): fetch it. */
  | { type: 'recordReady'; rev: number }
  | FrameMsg
  | { type: 'mapping'; projection: ProjectionRecord; layers: Record<string, string[]> }
  | { type: 'ui'; ui: OutputUi }
  | { type: 'bye' };

export interface OutputStatus { width: number; height: number; fullscreen: boolean; fps: number; screen?: string }

export type UpMsg =
  | { type: 'hello' }
  | { type: 'edit'; projection: ProjectionRecord; commit: boolean }
  | { type: 'ui'; ui: Partial<OutputUi> }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'status'; status: OutputStatus }
  | { type: 'closed' };

// ── The output's side: messages → state ────────────────────────────────────

export interface FollowState {
  seq: number;
  t: number;
  playing: boolean;
  /** When the last frame arrived (performance.now() ms). */
  at: number;
  pointer: [number, number, number, number];
  uniforms: ValueMap;
  layers: ValueMap;
  /** Actions not yet handed to the player. */
  actions: OutAction[];
}

export interface OutputState {
  record: OutputRecord | null;
  /** A record the desktop app holds for us, not fetched yet. */
  pendingRev: number | null;
  follow: FollowState;
  projection: ProjectionRecord | null;
  layers: Record<string, string[]>;
  ui: OutputUi;
  /** A frame went missing: ask for a full one (hello). */
  needsFull: boolean;
  /** The main window said goodbye. */
  closed: boolean;
}

export function initialOutputState(): OutputState {
  return {
    record: null, pendingRev: null,
    follow: { seq: -1, t: 0, playing: true, at: 0, pointer: [0.5, 0.5, 0, 0], uniforms: {}, layers: {}, actions: [] },
    projection: null, layers: {}, ui: { ...DEFAULT_UI }, needsFull: true, closed: false,
  };
}

const MAX_PENDING_ACTIONS = 256;

/** One message from the main window. `now` is when it arrived. New objects for what changed; the rest shared. */
export function reduceOutput(s: OutputState, m: DownMsg, now: number): OutputState {
  switch (m.type) {
    case 'record':
      if (s.record && m.record.rev <= s.record.rev) return s;
      return { ...s, record: m.record, pendingRev: null, closed: false };
    case 'recordReady':
      if (s.record && m.rev <= s.record.rev) return s;
      return { ...s, pendingRev: m.rev };
    case 'frame': {
      const f = s.follow;
      // A delta only makes sense on top of the frame before it; otherwise wait for a full one.
      const gap = !m.full && f.seq >= 0 && m.seq !== f.seq + 1;
      // Once one went missing, every delta waits for the full frame asked for.
      if (!m.full && (f.seq < 0 || gap || s.needsFull)) {
        return { ...s, needsFull: true, follow: { ...f, seq: m.seq, t: m.t, playing: m.playing, at: now, pointer: m.p ?? f.pointer, actions: m.a ? [...f.actions, ...m.a].slice(-MAX_PENDING_ACTIONS) : f.actions } };
      }
      const uniforms = m.full ? { ...(m.u ?? {}) } : m.u ? { ...f.uniforms, ...m.u } : f.uniforms;
      const layers = m.full ? { ...(m.l ?? {}) } : m.l ? { ...f.layers, ...m.l } : f.layers;
      return {
        ...s,
        needsFull: m.full ? false : s.needsFull,
        closed: false,
        follow: { seq: m.seq, t: m.t, playing: m.playing, at: now, pointer: m.p ?? f.pointer, uniforms, layers, actions: m.a ? [...f.actions, ...m.a].slice(-MAX_PENDING_ACTIONS) : f.actions },
      };
    }
    case 'mapping':
      return { ...s, projection: m.projection, layers: m.layers };
    case 'ui':
      return { ...s, ui: m.ui };
    case 'bye':
      return { ...s, closed: true };
    default:
      return s;
  }
}

/** Take the actions waiting for the player (the state keeps none). */
export function takeActions(s: OutputState): { state: OutputState; actions: OutAction[] } {
  if (!s.follow.actions.length) return { state: s, actions: [] };
  return { state: { ...s, follow: { ...s.follow, actions: [] } }, actions: s.follow.actions };
}

// ── The main window's side: only what changed ──────────────────────────────

const sameValue = (a: Value | undefined, b: Value): boolean => {
  if (a === undefined) return false;
  if (typeof a === 'number' || typeof b === 'number') return a === b;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
};

/** Every so many frames a full frame goes out anyway, so a missed one heals by itself. */
export const FULL_EVERY = 120;

/**
 * Turns this frame's values into a frame message carrying only what changed.
 * `forceFull()` after a hello; the first frame is always full.
 */
export class FrameEncoder {
  private seq = -1;
  private sentU: ValueMap = {};
  private sentL: ValueMap = {};
  private wantFull = true;

  forceFull(): void { this.wantFull = true; }

  encode(t: number, playing: boolean, uniforms: ValueMap, layers: ValueMap, pointer?: [number, number, number, number], actions?: OutAction[]): FrameMsg {
    this.seq++;
    const full = this.wantFull || this.seq % FULL_EVERY === 0;
    this.wantFull = false;
    const msg: FrameMsg = { type: 'frame', seq: this.seq, t, playing };
    if (pointer) msg.p = pointer;
    if (actions && actions.length) msg.a = actions;
    if (full) {
      msg.full = true;
      msg.u = copyMap(uniforms);
      msg.l = copyMap(layers);
      this.sentU = copyMap(uniforms);
      this.sentL = copyMap(layers);
      return msg;
    }
    const du = diff(this.sentU, uniforms), dl = diff(this.sentL, layers);
    if (du) msg.u = du;
    if (dl) msg.l = dl;
    return msg;
  }
}

function copyMap(m: ValueMap): ValueMap {
  const o: ValueMap = {};
  for (const k in m) { const v = m[k]; o[k] = typeof v === 'number' ? v : v.slice(); }
  return o;
}

/** What changed from `sent` to `now` (updating `sent`), or null. */
function diff(sent: ValueMap, now: ValueMap): ValueMap | null {
  let out: ValueMap | null = null;
  for (const k in now) {
    const v = now[k];
    if (sameValue(sent[k], v)) continue;
    const c = typeof v === 'number' ? v : v.slice();
    (out ??= {})[k] = c;
    sent[k] = typeof c === 'number' ? c : c.slice();
  }
  return out;
}

// ── The output's clock ─────────────────────────────────────────────────────

/**
 * The main window's clock, run on in between its frames: an offset to this
 * window's own clock, eased towards each frame's time (so a frame arriving a
 * little late doesn't jerk the picture), snapped when it's far off (a seek).
 */
export class ClockFollower {
  private offset: number | null = null;
  private playing = true;
  private held = 0;

  /** A frame said the clock read `t` at local time `nowMs`. */
  update(t: number, playing: boolean, nowMs: number): void {
    this.playing = playing;
    if (!playing) { this.held = t; this.offset = null; return; }
    const target = t - nowMs / 1000;
    if (this.offset === null || Math.abs(target - this.offset) > 0.25) this.offset = target;
    else this.offset += (target - this.offset) * 0.1;
  }

  /** The clock now. */
  at(nowMs: number): number {
    if (!this.playing || this.offset === null) return this.held;
    return Math.max(0, nowMs / 1000 + this.offset);
  }
}
