/**
 * takes.ts — a performance, recorded as keyframes, to watch back and render
 * frame by frame.
 *
 * Playing live is real time: a video of it is only as smooth as the machine
 * was, and live input can't be rendered offline. A take separates the two.
 * While it records, every frame notes what the performance changed:
 *
 *   controls  each Play control's value as the picture saw it (mappings,
 *             triggers, envelopes, LFOs applied), layer properties and nulls
 *   bus       the MIDI Input node's outputs, as the input bus wrote them
 *   audio     Audio Input nodes' amplitudes
 *   mouse     the shader's u_mouse (the Mouse node)
 *   pointer   the pointer over the layers (Script layers, particles, brushes)
 *   events    actions that fired (bursts, drops, Next line, script buttons)
 *
 * On stop each track keeps only the keys it needs (takePlayback.ts) and the
 * take is saved with the graph's Play record. Playing it back mutes live
 * input and sets everything back frame by frame on the clock; rendering it
 * does the same for each offline frame.
 *
 * A performance runs up to a minute (TAKE_MAX_SECONDS). An opt-in rolling
 * buffer keeps the last minute of playing, to save as a take after the fact.
 */
import { create } from 'zustand';
import { inputBus, paramChannelKey, type InputSource, type InputWriter } from './inputBus';
import { audioEngine } from './audioEngine';
import { bindingKeyOf, playEngine } from './playEngine';
import { useNodeGraphStore } from '../store/useNodeGraphStore';
import { readControlValue } from '../play/playControls';
import { playOverlay } from '../play/overlay';
import { layerTarget, parseActionTarget, parseLayerTarget, TAKE_MAX_SECONDS, TAKES_MAX, type ActionKind, type PlayRecord, type PlayTake, type TakeTrack } from '../types/play';
import { encodeKeys, takeEventsBetween, takeMouseAt, takePointerAt, takeSize, trackAt } from './takePlayback';
import { toast } from '../components/ui/toastStore';

export { takeEventsBetween, takeMouseAt, takePointerAt, takeValuesAt, type Take } from './takePlayback';

/** A saved take stays under this many characters: tolerance is loosened until it fits. */
export const TAKE_BUDGET = 400_000;
/** Samples closer together than this are skipped: a take is kept at up to 60 per second. */
const MIN_GAP = 1 / 62;

// ── Capture ──────────────────────────────────────────────────────────────────

interface RawTrack { meta: Omit<TakeTrack, 'keys'>; t: number[]; v: number[] }
type KitAction = { do: ActionKind; layerId: string; amount: number };

/** The MIDI node's channel writes this frame (the bus's one tap, shared by every capture). */
const busNow = new Map<string, number>();
const tapBus: InputWriter = (key, value) => {
  if (!key.startsWith('param:') && typeof value === 'number') busNow.set(key, value);
};

/** One recording in progress: raw samples per track, turned into keys by `toTake`. */
export class TakeCapture {
  private tracks = new Map<string, RawTrack>();
  private events: { t: number; a: KitAction }[] = [];
  private pending: KitAction[] = [];
  private first: number | null = null;
  private last = -Infinity;
  private kept = -Infinity;
  private offAct: () => void;
  private lastTrim = 0;

  private play: PlayRecord;
  private keep: number;

  /** `keep`: seconds to hold (the rolling buffer); older samples are dropped. */
  constructor(play: PlayRecord, keep = Infinity) {
    this.play = play;
    this.keep = keep;
    this.offAct = playOverlay.onAct(a => this.pending.push({ do: a.do, layerId: a.layerId, amount: a.amount }));
  }

  dispose(): void { this.offAct(); }

  /** Clock time of the first sample (null before any). */
  start(): number | null { return this.first; }
  seconds(): number { return this.first === null ? 0 : this.last - this.first; }

  private reset(): void {
    this.tracks.clear(); this.events = []; this.first = null; this.last = -Infinity; this.kept = -Infinity;
  }

  private push(kind: TakeTrack['kind'], id: string, label: string, t: number, v: number | number[], extra: Partial<TakeTrack> = {}): void {
    const key = `${kind}\u0000${id}`;
    let tr = this.tracks.get(key);
    if (!tr) {
      tr = { meta: { kind, id, label, width: Array.isArray(v) ? 3 : 1, ...extra }, t: [], v: [] };
      this.tracks.set(key, tr);
    }
    tr.t.push(t);
    if (Array.isArray(v)) tr.v.push(v[0] ?? 0, v[1] ?? 0, v[2] ?? 0); else tr.v.push(v);
  }

  /** Note this frame. A paused clock notes nothing; a clock sent back (↺) starts over. */
  sample(time: number): void {
    if (time < this.last - 0.5) this.reset();
    if (time <= this.last) { if (this.pending.length) this.flushEvents(this.last); return; }
    this.last = time;
    if (this.first === null) this.first = time;
    this.flushEvents(time);
    if (time - this.kept < MIN_GAP) return;
    this.kept = time;
    const { nodes, play } = useNodeGraphStore.getState();
    for (const c of this.play.controls) {
      if (c.kind === 'action' || parseActionTarget(c.target)) continue;
      const lt = parseLayerTarget(c.target);
      if (lt) {
        const layer = play.layers.find(l => l.id === lt.layerId) as unknown as Record<string, number> | undefined;
        this.push('control', c.id, c.label, time, playEngine.layerValue(lt.layerId, lt.key, layer?.[lt.key] ?? 0), { target: c.target });
        continue;
      }
      const v = playEngine.liveValue(c.id) ?? readControlValue(nodes, c.target, play) ?? 0;
      this.push('control', c.id, c.label, time, Array.isArray(v) ? [...v] : v, { target: c.target });
    }
    // Nulls too: one following the pointer on a spring moves by itself, so its place is part of the performance.
    for (const l of this.play.layers) {
      if (l.kind !== 'null') continue;
      const layer = (play.layers.find(x => x.id === l.id) ?? l) as unknown as Record<string, number>;
      for (const k of ['x', 'y'] as const) {
        this.push('control', `null:${l.id}:${k}`, `${l.label} ${k}`, time, playEngine.layerValue(l.id, k, layer[k] ?? 0.5), { target: layerTarget(l.id, k) });
      }
    }
    for (const [key, v] of busNow) this.push('bus', key, key.split('::').pop() ?? key, time, v);
    for (const [name, v] of audioEngine.lastAmps()) this.push('audio', name, name, time, v);
    const m = inputBus.mouseNow();
    this.push('mouse', 'x', 'Mouse x', time, m[0]);
    this.push('mouse', 'y', 'Mouse y', time, m[1]);
    const p = playOverlay.pointerNow();
    this.push('pointer', 'x', 'Pointer x', time, p.x);
    this.push('pointer', 'y', 'Pointer y', time, p.y);
    this.push('pointer', 'over', 'Pointer over', time, p.over ? 1 : 0, { step: true });
    this.push('pointer', 'down', 'Pointer down', time, p.down ? 1 : 0, { step: true });
    if (this.keep < Infinity && time - this.lastTrim > 2) { this.lastTrim = time; this.trim(time - this.keep); }
  }

  private flushEvents(time: number): void {
    for (const a of this.pending) this.events.push({ t: time, a });
    this.pending.length = 0;
  }

  /** Drop samples before `from` (keeping one, so the values there are still known). */
  private trim(from: number): void {
    for (const tr of this.tracks.values()) {
      let i = 0;
      while (i + 1 < tr.t.length && tr.t[i + 1] <= from) i++;
      if (i > 0) { tr.t.splice(0, i); tr.v.splice(0, i * tr.meta.width); }
    }
    this.events = this.events.filter(e => e.t >= from);
    if (this.first !== null && this.first < from) this.first = from;
  }

  /**
   * The recording as a take (null when under a tenth of a second). `last`
   * keeps only the last so many seconds; `cap` cuts it at that length (a slow
   * frame can land past the stop).
   */
  toTake(name: string, last = Infinity, cap = TAKE_MAX_SECONDS): PlayTake | null {
    if (this.first === null) return null;
    const from = Math.max(this.first, this.last - last);
    const length = Math.min(cap, this.last - from);
    if (length < 0.1) return null;
    const raw = [...this.tracks.values()];
    const build = (precision: number, stride = 1): PlayTake => ({
      id: `take-${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`,
      name, from, length,
      tracks: raw.map(tr => {
        // Only the samples in the span, starting from the one at or before it.
        let i = 0;
        while (i + 1 < tr.t.length && tr.t[i + 1] <= from) i++;
        let times = tr.t.slice(i).map(t => Math.max(0, t - from));
        let values = tr.v.slice(i * tr.meta.width);
        if (stride > 1) {
          // Every stride-th sample, and the last: noise can't be simplified, only thinned.
          const w = tr.meta.width, pick = times.map((_, k) => k).filter(k => k % stride === 0 || k === times.length - 1);
          values = pick.flatMap(k => values.slice(k * w, k * w + w));
          times = pick.map(k => times[k]);
        }
        return { ...tr.meta, keys: encodeKeys(times, values, tr.meta.width, tr.meta.step, precision) };
      }),
      events: this.events.filter(e => e.t >= from && e.t <= from + length).map(e => ({ t: e.t - from, ...e.a })),
    });
    // Over budget (a lot of noise-driven controls): loosen the tolerance, then thin to 30, 15… per second.
    let take = build(1);
    for (const [p, stride] of [[4, 1], [16, 1], [16, 2], [16, 4], [16, 8], [16, 16]]) {
      if (takeSize(take) <= TAKE_BUDGET) break;
      take = build(p, stride);
    }
    return take;
  }
}

// ── Playing a take back (the live preview and offline frames) ─────────────

const num = (v: number | number[]) => (typeof v === 'number' ? v : v[0]);

/**
 * Put a take's values in place for one frame at clock `time`. `setUniform`
 * writes a uniform by name; `mousePx` turns 0..1 into u_mouse's pixels.
 * Layer properties and nulls go in as the Play engine's overrides, and are
 * listed in `layerKeys` so the caller can clear them.
 */
function applyTake(take: PlayTake, time: number, out: {
  /** Also show it on the panel (the live preview playing back). */
  show?: (controlId: string, v: number | number[]) => void;
  param: (bindingKey: string, v: number | number[]) => void;
  bus: (channelKey: string, v: number) => void;
  audio: (uniform: string, v: number) => void;
  layerKeys: Set<string>;
}): void {
  const s = time - take.from;
  for (const tr of take.tracks) {
    if (tr.kind === 'control' && tr.target) {
      const v = trackAt(tr, s);
      out.show?.(tr.id, v);
      const lt = parseLayerTarget(tr.target);
      if (lt) { playEngine.setOverride(lt.layerId, lt.key, num(v)); out.layerKeys.add(`${lt.layerId}\u0000${lt.key}`); }
      else out.param(bindingKeyOf(tr.target), v);
    } else if (tr.kind === 'bus') out.bus(tr.id, num(trackAt(tr, s)));
    else if (tr.kind === 'audio') out.audio(tr.id, num(trackAt(tr, s)));
  }
}

function releaseLayers(keys: Set<string>): void {
  for (const k of keys) { const [id, key] = k.split('\u0000'); playEngine.setOverride(id, key, null); }
  keys.clear();
}

/**
 * Offline frames (Record › Render a take): before each frame, the take's
 * values go straight into the shader's uniforms and the layers' overrides;
 * `actions` are what fired since the last frame, for the layers' compositor.
 */
export function takeApplier(take: PlayTake, handle: { setUniform: (name: string, value: number | number[]) => void; width: number; height: number }) {
  const layerKeys = new Set<string>();
  let lastTime = -Infinity;
  const out = {
    param: (key: string, v: number | number[]) => { const u = inputBus.paramUniform(key); if (u) handle.setUniform(u, v); },
    bus: (key: string, v: number) => { const u = inputBus.liveUniform(key); if (u) handle.setUniform(u, v); },
    audio: (name: string, v: number) => handle.setUniform(name, v),
    layerKeys,
  };
  return {
    apply(time: number): KitAction[] {
      applyTake(take, time, out);
      const m = takeMouseAt(take, time);
      if (m) handle.setUniform('u_mouse', [m[0] * handle.width, m[1] * handle.height]);
      const acts = takeEventsBetween(take, lastTime, time);
      lastTime = time;
      return acts;
    },
    pointer: (time: number) => takePointerAt(take, time),
    release() { releaseLayers(layerKeys); },
  };
}

/** The live preview playing a take back: an input source that writes after the Play engine. */
class Replay implements InputSource {
  private lastTime = -Infinity;
  private layerKeys = new Set<string>();
  private detach: () => void;
  readonly take: PlayTake;
  constructor(take: PlayTake) {
    this.take = take;
    playEngine.setMuted(true);
    playOverlay.setReplaying(true);
    this.detach = inputBus.addSource(this);
  }
  wantsTick() { return true; }
  /** Seconds into the take at the last frame. */
  position(): number { return Number.isFinite(this.lastTime) ? this.lastTime - this.take.from : 0; }
  tickInputs(_dt: number, time: number, write: InputWriter): void {
    const take = this.take;
    // Sent back (a scrub, Play from the top): the layers start over from there.
    if (time < this.lastTime - 1e-6) { playOverlay.resetLayers(); this.lastTime = time - take.from < 0.02 ? -Infinity : time; }
    applyTake(take, time, {
      show: (id, v) => playEngine.showLive(id, v),
      param: (key, v) => write(paramChannelKey(key), v),
      bus: (key, v) => write(key, v),
      audio: (name, v) => inputBus.writeUniform(name, v),
      layerKeys: this.layerKeys,
    });
    inputBus.setMouseOverride(takeMouseAt(take, time));
    playOverlay.setReplayPointer(takePointerAt(take, time));
    for (const e of takeEventsBetween(take, this.lastTime, time)) playOverlay.replayAct(e);
    this.lastTime = time;
    if (time >= take.from + take.length && useNodeGraphStore.getState().timePlaying) {
      // The end: stop the clock there (after this frame, not inside the tick).
      queueMicrotask(() => { if (replay === this) { useNodeGraphStore.getState().setTimePlaying(false); useTakes.setState({ replayPlaying: false }); } });
    }
  }
  end(): void {
    this.detach();
    releaseLayers(this.layerKeys);
    inputBus.setMouseOverride(null);
    playOverlay.setReplaying(false);
    playEngine.setMuted(false);
  }
}

function seekClock(time: number): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('seek-time', { detail: { time } }));
}

// ── The store: recording, playing back, the takes list ─────────────────────

export type TakePhase = 'idle' | 'countdown' | 'recording' | 'replay';

export interface PerformanceSettings {
  /** Seconds to record, up to a minute. */
  seconds: number;
  /** Stop by hand instead (still stops at a minute). */
  manual: boolean;
  /** Count 3, 2, 1 before recording. */
  countIn: boolean;
}

interface TakeState {
  phase: TakePhase;
  /** Seconds left of the count-in. */
  countdown: number;
  settings: PerformanceSettings;
  /** The take being played back. */
  replayId: string | null;
  replayPlaying: boolean;
  /** Keep the last minute of playing (opt-in, remembered on this device). */
  rolling: boolean;
  /** A take the Record dialog should open with (Render… on a take). */
  pending: string | null;
  /** The Record dialog should open on Performance. */
  openOnPerformance: boolean;
  setSettings: (s: Partial<PerformanceSettings>) => void;
  /** Start recording (after the count-in, if on). */
  begin: () => void;
  /** Stop: keep the take and play it back. */
  stop: () => void;
  /** Stop without keeping anything. */
  cancel: () => void;
  replay: (id: string) => void;
  setReplayPlaying: (on: boolean) => void;
  /** Move the playback to `s` seconds into the take. */
  seekReplay: (s: number) => void;
  endReplay: () => void;
  remove: (id: string) => void;
  rename: (id: string, name: string) => void;
  /** Open Record set to render this take. */
  renderTake: (id: string | null) => void;
  /** Open Record on Performance. */
  openPerformance: () => void;
  setRolling: (on: boolean) => void;
  /** Save the rolling buffer's last minute as a take. */
  saveRolling: () => PlayTake | null;
}

let capture: TakeCapture | null = null;
let rolling: TakeCapture | null = null;
let replay: Replay | null = null;
let countTimer: ReturnType<typeof setInterval> | undefined;
let stopping = false;

const ROLLING_KEY = 'shader-studio:performance-rolling';
function readRolling(): boolean {
  try { return localStorage.getItem(ROLLING_KEY) === '1'; } catch { return false; }
}

/** The one source that samples every capture after the Play engine has run. */
const recorder: InputSource = {
  wantsTick: () => capture !== null || rolling !== null,
  tickInputs(_dt, time) {
    if (replay) { busNow.clear(); return; }
    if (capture) {
      capture.sample(time);
      const st = useTakes.getState();
      const limit = st.settings.manual ? TAKE_MAX_SECONDS : Math.min(TAKE_MAX_SECONDS, st.settings.seconds);
      if (!stopping && capture.seconds() >= limit) { stopping = true; queueMicrotask(() => useTakes.getState().stop()); }
    }
    rolling?.sample(time);
    busNow.clear();
  },
};
let recorderAttached: (() => void) | null = null;
function syncRecorder(): void {
  const want = capture !== null || rolling !== null;
  if (want && !recorderAttached) { inputBus.tap(tapBus); recorderAttached = inputBus.addSource(recorder); }
  else if (!want && recorderAttached) { recorderAttached(); recorderAttached = null; inputBus.tap(null); busNow.clear(); }
  if (want) inputBus.wake();
}

/** Clock time the recording in progress started at (null before its first frame), for the bar's readout. */
export function recordingStart(): number | null { return capture?.start() ?? null; }
/** Seconds the rolling buffer holds now. */
export function rollingSeconds(): number { return rolling ? Math.min(TAKE_MAX_SECONDS, rolling.seconds()) : 0; }

function nextName(takes: PlayTake[]): string {
  let n = 0;
  for (const t of takes) { const m = /^Take (\d+)$/.exec(t.name); if (m) n = Math.max(n, Number(m[1])); }
  return `Take ${Math.max(n, takes.length) + 1}`;
}

function keepTake(take: PlayTake): void {
  const store = useNodeGraphStore.getState();
  const had = store.play.takes ?? [];
  if (had.length >= TAKES_MAX) toast.info(`${had[0].name} was removed`, { message: `A setup keeps its last ${TAKES_MAX} takes.` });
  store.setPlay(p => ({ ...p, takes: [...(p.takes ?? []), take].slice(-TAKES_MAX) }));
}

function startRolling(): void {
  rolling?.dispose();
  rolling = new TakeCapture(useNodeGraphStore.getState().play, TAKE_MAX_SECONDS + 1);
  syncRecorder();
}
function stopRolling(): void {
  rolling?.dispose();
  rolling = null;
  syncRecorder();
}

export const useTakes = create<TakeState>((set, get) => ({
  phase: 'idle',
  countdown: 0,
  settings: { seconds: 15, manual: false, countIn: true },
  replayId: null,
  replayPlaying: false,
  rolling: false,
  pending: null,
  openOnPerformance: false,
  setSettings: s => set(st => ({ settings: { ...st.settings, ...s, seconds: Math.max(1, Math.min(TAKE_MAX_SECONDS, Math.round(s.seconds ?? st.settings.seconds))) } })),
  begin() {
    const st = get();
    if (st.phase === 'replay') st.endReplay();
    if (st.phase === 'recording' || st.phase === 'countdown') return;
    const go = () => {
      clearInterval(countTimer);
      capture?.dispose();
      capture = new TakeCapture(useNodeGraphStore.getState().play);
      stopping = false;
      syncRecorder();
      useNodeGraphStore.getState().setTimePlaying(true);
      set({ phase: 'recording', countdown: 0 });
    };
    if (!st.settings.countIn) { go(); return; }
    set({ phase: 'countdown', countdown: 3 });
    clearInterval(countTimer);
    countTimer = setInterval(() => {
      const left = get().countdown - 1;
      if (left <= 0) go(); else set({ countdown: left });
    }, 1000);
  },
  stop() {
    const st = get();
    if (st.phase === 'countdown') { st.cancel(); return; }
    if (!capture) return;
    const c = capture;
    capture = null;
    stopping = false;
    syncRecorder();
    const limit = st.settings.manual ? TAKE_MAX_SECONDS : Math.min(TAKE_MAX_SECONDS, st.settings.seconds);
    const take = c.toTake(nextName(useNodeGraphStore.getState().play.takes ?? []), Infinity, limit);
    c.dispose();
    set({ phase: 'idle' });
    if (!take) { toast.info('Nothing was recorded', { message: 'The clock has to run while you play. Press Play on the clock and try again.' }); return; }
    keepTake(take);
    get().replay(take.id);
  },
  cancel() {
    clearInterval(countTimer);
    capture?.dispose();
    capture = null;
    stopping = false;
    syncRecorder();
    set({ phase: 'idle', countdown: 0 });
  },
  replay(id) {
    const take = (useNodeGraphStore.getState().play.takes ?? []).find(t => t.id === id);
    if (!take) return;
    if (get().phase === 'recording' || get().phase === 'countdown') get().cancel();
    replay?.end();
    replay = new Replay(take);
    seekClock(take.from);
    useNodeGraphStore.getState().setTimePlaying(true);
    set({ phase: 'replay', replayId: id, replayPlaying: true });
  },
  setReplayPlaying(on) {
    if (!replay) return;
    const t = replay.take;
    // Play from the end starts from the top.
    if (on && replay.position() >= t.length - 0.02) seekClock(t.from);
    useNodeGraphStore.getState().setTimePlaying(on);
    set({ replayPlaying: on });
  },
  seekReplay(s) {
    if (!replay) return;
    seekClock(replay.take.from + Math.max(0, Math.min(replay.take.length, s)));
  },
  endReplay() {
    if (!replay) return;
    replay.end();
    replay = null;
    useNodeGraphStore.getState().setTimePlaying(false);
    set({ phase: 'idle', replayId: null, replayPlaying: false });
  },
  remove(id) {
    if (get().replayId === id) get().endReplay();
    useNodeGraphStore.getState().setPlay(p => {
      const takes = (p.takes ?? []).filter(t => t.id !== id);
      const next: PlayRecord = { ...p, takes };
      if (!takes.length) delete next.takes;
      return next;
    });
  },
  rename(id, name) {
    const n = name.trim().slice(0, 80);
    if (!n) return;
    useNodeGraphStore.getState().setPlay(p => ({ ...p, takes: (p.takes ?? []).map(t => (t.id === id ? { ...t, name: n } : t)) }));
  },
  renderTake(id) {
    if (id && get().phase === 'replay') get().endReplay();
    set({ pending: id });
    if (id && typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('open-record'));
  },
  openPerformance() {
    set({ openOnPerformance: true });
    window.dispatchEvent(new CustomEvent('open-record'));
  },
  setRolling(on) {
    try { localStorage.setItem(ROLLING_KEY, on ? '1' : '0'); } catch { /* private window: on for this session only */ }
    if (on) startRolling(); else stopRolling();
    set({ rolling: on });
  },
  saveRolling() {
    if (!rolling) return null;
    const take = rolling.toTake(nextName(useNodeGraphStore.getState().play.takes ?? []), TAKE_MAX_SECONDS);
    if (!take) { toast.info('Nothing to save yet', { message: 'The last minute is kept while the clock runs.' }); return null; }
    keepTake(take);
    return take;
  },
}));

// The rolling buffer: on when the setting says so, and started over when the
// setup's controls or layers change (its tracks are fixed when it starts).
if (typeof window !== 'undefined' && readRolling()) {
  useTakes.setState({ rolling: true });
  queueMicrotask(startRolling);
}
{
  let last = useNodeGraphStore.getState().play;
  useNodeGraphStore.subscribe(s => {
    const p = s.play;
    if (p === last) return;
    const changed = p.controls !== last.controls || p.layers !== last.layers;
    last = p;
    if (changed && rolling) startRolling();
    // The take playing back was deleted (undo, another window): stop.
    const id = useTakes.getState().replayId;
    if (id && !(p.takes ?? []).some(t => t.id === id)) useTakes.getState().endReplay();
  });
}
