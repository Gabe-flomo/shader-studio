/**
 * playEngine.ts — turns the graph's Play record (controls + mappings) into
 * per-frame uniform writes on the input bus. No React, no store.
 *
 *   source (MIDI / mouse / key)  →  range → curve → smoothing  →  control's uniform
 *
 * A control is a float or colour param the compiler made a live uniform. The
 * engine writes it by `param:${nodeId}::${paramKey}` and the bus translates
 * that through the compiler's binding map, so nothing here knows a slug.
 *
 * The store's param value is the control's *base*: what the picture shows
 * when no mapping drives it, and (for colours) the channels a mapping leaves
 * alone. When a control stops being driven the base is written once more, so
 * the picture snaps back to what the slider says.
 *
 * Mouse and keyboard sources only listen while the Play page is showing
 * (`setPerforming`), so they never fight the Studio's own shortcuts. MIDI
 * mappings are live everywhere.
 */

import { inputBus, paramChannelKey, type InputSource, type InputWriter } from './inputBus';
import { midiEngine, type MidiEvent } from './midiEngine';
import { keyboardClaimed } from './keyboardClaim';
import { padGrid } from './padGrid';
import { kmNoteUnit } from '../play/kit/midi.js';
import { audioEngine } from './audioEngine';
import { oscClient, oscNumber, type OscMessage } from './oscClient';
import { anchorDistance, beatAt, firesWhileHeld, newFireState, newTriggerState, noiseAt, proximityCondition, signalKey, stepFire, stepTrigger, triggerKey, type FireState, type TriggerState } from '../play/triggers';
import { sgCondNew, sgCondStep, sgParseValueRef, sgRunActions, sgScreenPoint, sgSwapNew, sgSwapStep, type SgCondState, type SgSwapState } from '../play/kit/signals.js';
import { readFinishValue } from '../types/playFinish';
import { AUDIO_FX_TARGET_PREFIX, readAudioFxValue } from '../types/playAudioFx';
import { signalNames } from '../play/signalNames';
import type { PairAxis, PlayPair, PlayPairMapping, ValueCondition } from '../types/play';
import { geoAnchor } from '../play/kit/geometry.js';
import type { TriggerSpec } from '../types/play';
import type { LfoShape, PlayAction, PlayControl, PlayCurve, PlayMapping, PlayRecord, PlaySource } from '../types/play';
import { sensorKey } from '../types/play';
import { parseGrainsTarget } from '../types/playAudioEngine';
import { CURVE_POINTS, emptyPlayRecord, parseActionTarget, parsePropTarget, parseReaderTarget } from '../types/play';
import { layerAudio } from './layerAudio';
import { bandFromSpectrum, levelFromWave, liveAudio, LIVE_BANDS, type LiveBand } from './liveAudio';
import { audioReaderBank } from './audioReaderBank';
import { pickLearned, readerGate } from '../play/audioReaders';
import { handFeed } from './handFeed';
import { readDataSource } from '../play/dataLayer';
import { hdAge, hdCreate, hdGate, hdPlacement, hdPoint, hdRead, hdTrackerOptions, hdUpdate, type HdState } from '../play/kit/hands.js';
import { DEFAULT_HANDS, PAD_ANCHOR, parseHandAnchor, usesHands, type FireMode, type HandGesture, type HandSide, type PlayLayer } from '../types/play';

/** A trigger's firing-mode state, with the mode it was made for (a changed mode starts afresh). */
interface FireSlot { mode: FireMode; st: FireState; count: number }

/** Gestures Learn listens for (coming into view and leaving are picked by hand, not learned). */
const LEARN_GESTURES: readonly HandGesture[] = ['pinch', 'pinchMiddle', 'pinchRing', 'pinchPinky', 'fist', 'open', 'point'];
/** How far a landmark has to move (0..1 of the picture) before Learn takes it. */
const HAND_LEARN_MOVE = 0.12;

/** Sensor reads that are an audio layer's bands. */
const AUDIO_READS: ReadonlySet<string> = new Set(['level', 'bass', 'lowmid', 'highmid', 'treble']);

export type ControlValue = number | number[];

/** `nodeId::paramKey`: the last two segments of a control's target path. */
export function bindingKeyOf(target: string): string {
  const parts = target.split('::');
  return parts.slice(-2).join('::');
}

/** Source unit value → 0..1 shaped by the curve. A drawn curve interpolates its samples. */
export function applyCurve(u: number, curve: PlayCurve, curveY?: number[]): number {
  const x = u < 0 ? 0 : u > 1 ? 1 : u;
  switch (curve) {
    case 'exp': return x * x;
    case 'log': return Math.sqrt(x);
    case 'custom': {
      if (!curveY || curveY.length < 2) return x;
      const pos = x * (curveY.length - 1);
      const i = Math.min(curveY.length - 2, Math.floor(pos));
      const f = pos - i;
      return curveY[i] + (curveY[i + 1] - curveY[i]) * f;
    }
    default: return x;
  }
}

/** The samples a drawn curve starts from: the current preset curve, so switching to Draw changes nothing until you draw. */
export function sampleCurve(curve: PlayCurve, curveY?: number[], n = CURVE_POINTS): number[] {
  return Array.from({ length: n }, (_, i) => applyCurve(i / (n - 1), curve, curveY));
}

/** Range + curve: the value a mapping produces for a unit source reading, before smoothing. */
export function mapValue(u: number, m: Pick<PlayMapping, 'outMin' | 'outMax' | 'curve'> & { curveY?: number[] }): number {
  return m.outMin + (m.outMax - m.outMin) * applyCurve(u, m.curve, m.curveY);
}

/** Deterministic 0..1 per cycle index, for the random (sample-and-hold) shape. */
function hash01(n: number): number {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

/** An oscillator's 0..1 value at `t` cycles (fractional part = phase within the cycle). */
export function lfoValue(shape: LfoShape, t: number): number {
  const cycle = Math.floor(t);
  const p = t - cycle;
  switch (shape) {
    case 'sine': return 0.5 - 0.5 * Math.cos(p * Math.PI * 2);
    case 'triangle': return 1 - Math.abs(2 * p - 1);
    case 'saw': return p;
    case 'square': return p < 0.5 ? 1 : 0;
    case 'random': return hash01(cycle);
  }
}

/** Cycles per second of a tempo-locked source. */
export function clockRate(bpm: number, beats: number): number {
  return bpm / 60 / Math.max(0.0625, beats);
}

interface PadSnapshot { axes: number[]; buttons: number[] }

export function isTypingTarget(el: EventTarget | null): boolean {
  const node = el as HTMLElement | null;
  const tag = node?.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !!node?.isContentEditable;
}

interface MappingState {
  /** Smoothed output, in param units. */
  value: number | undefined;
}

/** A pair mapping between frames: each axis's last driven value (held while it isn't driven), the axis swap, the per-axis conditions. */
interface PairState { a: number | undefined; b: number | undefined; swap: SgSwapState; condA: SgCondState; condB: SgCondState }

/** Does a source move on its own (so the render loop keeps drawing)? */
function sourceAnimates(s: PlaySource, triggerIdle: boolean): boolean {
  return s.kind === 'noise'
    || ((s.kind === 'live' || (s.kind === 'trigger' && s.trigger.on === 'audio')) && liveAudio.isOn())
    || ((s.kind === 'reader' || (s.kind === 'trigger' && s.trigger.on === 'reader')) && audioReaderBank.live())
    || (s.kind === 'trigger' && (s.trigger.on === 'beat' || !triggerIdle));
}

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

/** Does a condition's value path read the pointer (mouse:x|y, or a distance to or from it)? */
function readsMouse(ref: string | undefined): boolean {
  const r = ref ? sgParseValueRef(ref) : null;
  return !!r && (r.kind === 'mouse' || (r.kind === 'distance' && (r.a === 'mouse' || r.b === 'mouse')));
}

/** Does this pair mapping write this control (one of its pair's two)? A swap writes both. */
export function pairDrives(m: PlayPairMapping, p: PlayPair, controlId: string): boolean {
  if (p.a === controlId) return m.affect !== 'b' || !!m.swap;
  if (p.b === controlId) return m.affect !== 'a' || !!m.swap;
  return false;
}

/** The source a signal is as a mapping source: a trigger on it, a short envelope (Learn and the picker make this). */
export function signalSource(id: string): PlaySource {
  return { kind: 'trigger', trigger: { on: 'signal', signal: id }, mode: 'envelope', attack: 10, decay: 200, sustain: 0, release: 300, steps: 4, velocity: false };
}

class PlayEngine implements InputSource {
  private record: PlayRecord = emptyPlayRecord();
  private controls = new Map<string, PlayControl>();
  private state = new Map<string, MappingState>();
  /** Store param value per control id (what the slider says). */
  private base = new Map<string, ControlValue>();
  /** Last written value per control id, for the panel's live readout. */
  private live = new Map<string, ControlValue>();
  /** Colour buffers written each frame; owned here and mutated in place (no allocation per frame). */
  private colour = new Map<string, number[]>();
  /** Driven layer properties, keyed `${layerId}::${key}`. The overlay reads these each frame. */
  private layerLive = new Map<string, number>();
  private layerMoved = false;
  /** Controls that were driven last frame; a control that drops out gets its base written once. */
  private drivenLastFrame = new Set<string>();
  private restoreOnce = new Set<string>();

  // Mouse + keyboard sources (Play page only)
  private performing = false;
  private mouseIsBound = false;
  private mouseX = 0.5;
  private mouseY = 0.5;
  private mouseDown = 0;
  private keysHeld = new Set<string>();
  private learnCb: ((source: PlaySource) => void) | null = null;
  private learnTriggerCb: ((trigger: TriggerSpec) => void) | null = null;
  private learnOffMidi: (() => void) | null = null;
  private learnOffOsc: (() => void) | null = null;
  private frame = 0;

  // ── Trigger hub: presses are counted (a tap between frames still fires), gates are held counts ──
  private presses = new Map<string, number>();
  private held = new Map<string, number>();
  private velocities = new Map<string, number>();
  private triggerStates = new Map<string, TriggerState>();
  private triggerKeysBound = new Set<string>();
  private oscHeld = new Set<string>();

  // ── Layers talking back: sensors, following nulls, zone triggers, actions ──
  /** What layers measure (`layerId::read`), reported by the overlay each frame. */
  private sensors = new Map<string, number>();
  /** Where a following null is (`layerId::x|y`); wins over mappings and the record. */
  private overrides = new Map<string, number>();
  private aspect = 16 / 9;
  private zoneGates = new Set<string>();
  /** Each action's firing mode state (once, held, every N, on release), per action id. */
  private actionFire = new Map<string, FireSlot>();
  /** Each trigger mapping's firing mode state; its count of fires is what the envelope, toggle or step sees. */
  private mappingFire = new Map<string, FireSlot>();
  /** Condition triggers (proximity, "when a value…"): each one's gate and memory, by trigger key. */
  private condStates = new Map<string, SgCondState>();
  /** Pair controls by id, and each pair mapping's state. */
  private pairs = new Map<string, PlayPair>();
  private pairState = new Map<string, PairState>();
  private pairMoving = false;
  /** Graph clock at the last tick: a clock sent back (rewind) starts axis swaps over. */
  private lastTime = -Infinity;
  private signalListeners = new Set<(id: string) => void>();
  private actionListeners = new Set<(a: PlayAction) => void>();
  /** Action controls: the last mapped level, so a rise through 0.5 fires once. */
  private actionLevel = new Map<string, number>();

  // ── Hands (hand tracking): landmarks from handFeed, read as sources, gestures and null targets ──
  private hands: HdState = hdCreate();
  private handSeq = -1;
  private handsBound = false;
  /** Gesture triggers whose gate is open (a press was counted, the release is still to come). */
  private handGates = new Set<string>();
  /** Learn: where each landmark was when the hand was first seen, and which gestures were already held. */
  private handLearnFrom: Map<string, number> | null = null;
  private handLearnHeld: Set<string> | null = null;

  private press(key: string, velocity = 1): void {
    this.presses.set(key, (this.presses.get(key) ?? 0) + 1);
    this.held.set(key, (this.held.get(key) ?? 0) + 1);
    this.velocities.set(key, velocity);
    if (this.triggerKeysBound.has(key)) inputBus.wake();
  }

  private release(key: string): void {
    const n = (this.held.get(key) ?? 0) - 1;
    if (n > 0) this.held.set(key, n); else this.held.delete(key);
    if (this.triggerKeysBound.has(key)) inputBus.wake();
  }

  private noteKeys(channel: number, note: number): string[] {
    return [`note:0:*`, `note:0:${note}`, `note:${channel}:*`, `note:${channel}:${note}`];
  }

  private onOsc = (m: OscMessage) => {
    const v = oscNumber(m.args);
    const key = `osc:${m.address}`;
    // A message with no number is a momentary press; otherwise > 0.5 is "down".
    if (v === null) { this.press(key); this.release(key); }
    else if (v > 0.5 && !this.oscHeld.has(key)) { this.oscHeld.add(key); this.press(key); }
    else if (v <= 0.5 && this.oscHeld.has(key)) { this.oscHeld.delete(key); this.release(key); }
    if (this.oscIsBound) inputBus.wake();
    if (this.learnCb) this.finishLearn({ kind: 'osc', address: m.address, arg: 0, min: 0, max: 1 });
    else if (this.learnTriggerCb) this.finishLearnTrigger({ on: 'osc', address: m.address });
  };
  private oscIsBound = false;

  constructor() {
    midiEngine.subscribe((e: MidiEvent) => {
      if (e.kind === 'noteOn') for (const k of this.noteKeys(e.channel, e.note)) this.press(k, e.velocity / 127);
      else if (e.kind === 'noteOff') for (const k of this.noteKeys(e.channel, e.note)) this.release(k);
    });
    oscClient.subscribe(this.onOsc);
  }
  /** Graph clock at the last tick, for LFOs and the drawer's meters. */
  private time = 0;

  // Phone orientation (Play page only). Null until the first event.
  private tilt: { alpha: number; beta: number; gamma: number } | null = null;
  private onOrientation = (e: DeviceOrientationEvent) => {
    this.tilt = { alpha: e.alpha ?? 0, beta: e.beta ?? 0, gamma: e.gamma ?? 0 };
    if (this.tiltIsBound) inputBus.wake();
  };
  private tiltIsBound = false;
  private gamepadIsBound = false;
  private padSnapshots = new Map<number, PadSnapshot>();

  private onPointerMove = (e: PointerEvent) => {
    if (typeof window === 'undefined') return;
    const w = window.innerWidth || 1;
    const h = window.innerHeight || 1;
    this.mouseX = Math.max(0, Math.min(1, e.clientX / w));
    this.mouseY = Math.max(0, Math.min(1, 1 - e.clientY / h));
    if (this.mouseIsBound) inputBus.wake();
  };
  private onPointerDown = (e: PointerEvent) => {
    this.mouseDown = 1;
    // Clicks on the picture (not on the panel) are the "mouse" trigger.
    const onPicture = (e.target as Element | null)?.tagName === 'CANVAS';
    if (onPicture) {
      if (this.learnTriggerCb) { this.finishLearnTrigger({ on: 'mouse' }); return; }
      this.press('mouse');
      this.pictureDown = true;
    }
    if (this.mouseIsBound) inputBus.wake();
  };
  private pictureDown = false;
  private onPointerUp = () => {
    this.mouseDown = 0;
    if (this.pictureDown) { this.pictureDown = false; this.release('mouse'); }
    if (this.mouseIsBound) inputBus.wake();
  };
  private onKeyDown = (e: KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e.target)) return;
    // A rack playing from the keyboard (lib/rackKeyboard.ts) has every plain key; mappings wait.
    if (keyboardClaimed(e)) return;
    if (this.learnCb || this.learnTriggerCb) {
      e.preventDefault();
      e.stopPropagation();
      if (e.repeat) return;
      if (this.learnCb) this.finishLearn({ kind: 'key', code: e.code });
      else this.finishLearnTrigger({ on: 'key', code: e.code });
      return;
    }
    if (!this.keyIsBound(e.code)) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.repeat) return;
    this.keysHeld.add(e.code);
    this.press(`key:${e.code}`);
    inputBus.wake();
  };
  private onKeyUp = (e: KeyboardEvent) => {
    if (!this.keysHeld.delete(e.code)) return;
    e.preventDefault();
    e.stopPropagation();
    this.release(`key:${e.code}`);
    inputBus.wake();
  };
  private onBlur = () => {
    for (const code of this.keysHeld) this.release(`key:${code}`);
    this.keysHeld.clear();
    this.mouseDown = 0;
    if (this.pictureDown) { this.pictureDown = false; this.release('mouse'); }
  };

  // ── Configuration (from the store, via ShaderCanvas) ──────────────────────

  setRecord(record: PlayRecord): void {
    this.record = record;
    // The record's MIDI file plays through the MIDI engine, like a controller would.
    midiEngine.setFile(record.midiFile);
    padGrid.setConfig(record.padGrid);
    this.controls.clear();
    for (const c of record.controls) this.controls.set(c.id, c);
    this.pairs.clear();
    for (const p of record.pairs ?? []) this.pairs.set(p.id, p);
    signalNames.set(record.signals);
    for (const id of [...this.pairState.keys()]) if (!(record.pairMappings ?? []).some(m => m.id === id)) this.pairState.delete(id);
    this.mouseIsBound = record.mappings.some(m => m.enabled && m.source.kind === 'mouse')
      || (record.pairMappings ?? []).some(m => m.enabled && (m.source.kind === 'position' ? m.source.anchor === 'mouse' : m.source.source.kind === 'mouse'))
      || this.allTriggers().some(t => t.on === 'value' && readsMouse(t.value))
      || (record.pairMappings ?? []).some(m => m.enabled && (readsMouse(m.a.when?.value) || readsMouse(m.b.when?.value)));
    this.tiltIsBound = record.mappings.some(m => m.enabled && m.source.kind === 'tilt');
    this.gamepadIsBound = record.mappings.some(m => m.enabled && m.source.kind === 'gamepad');
    this.handsBound = usesHands(record);
    audioReaderBank.setConfig(record.audioReaders);
    handFeed.configure(hdTrackerOptions(record.hands));
    this.triggerKeysBound = new Set(this.allTriggers().map(triggerKey));
    this.oscIsBound = record.mappings.some(m => m.enabled && (m.source.kind === 'osc' || (m.source.kind === 'trigger' && m.source.trigger.on === 'osc')))
      || (record.pairMappings ?? []).some(m => m.enabled && m.source.kind === 'value' && (m.source.source.kind === 'osc' || (m.source.source.kind === 'trigger' && m.source.source.trigger.on === 'osc')))
      || (record.actions ?? []).some(a => a.enabled && a.trigger.on === 'osc');
    for (const id of [...this.actionFire.keys()]) if (!(record.actions ?? []).some(a => a.id === id)) this.actionFire.delete(id);
    for (const id of [...this.mappingFire.keys()]) if (!record.mappings.some(m => m.id === id && m.source.kind === 'trigger') && !(record.pairMappings ?? []).some(m => m.id === id)) this.mappingFire.delete(id);
    const condKeys = new Set(this.allTriggers().filter(t => t.on === 'proximity' || t.on === 'value').map(triggerKey));
    for (const [k, st] of [...this.condStates]) if (!condKeys.has(k)) { this.condStates.delete(k); if (st.open) this.release(k); }
    oscClient.setWanted(this.oscIsBound || oscClient.getStatus() === 'connected');
    for (const id of [...this.triggerStates.keys()]) if (!record.mappings.some(m => m.id === id && m.source.kind === 'trigger') && !(record.pairMappings ?? []).some(m => m.id === id && m.source.kind === 'value' && m.source.source.kind === 'trigger')) this.triggerStates.delete(id);
    // Show the new state (a mapping added, removed or disabled) even while the clock is paused.
    inputBus.wake();
    // Drop state for mappings that are gone; keep the rest so a re-label doesn't jump.
    const ids = new Set(record.mappings.map(m => m.id));
    for (const id of [...this.state.keys()]) if (!ids.has(id)) this.state.delete(id);
    for (const id of [...this.colour.keys()]) if (!this.controls.has(id)) this.colour.delete(id);
    for (const id of [...this.live.keys()]) if (!this.controls.has(id)) this.live.delete(id);
  }

  /** Current store values of the controls' params, keyed by control id. */
  setBaseValues(values: Map<string, ControlValue>): void {
    this.base = values;
  }

  getRecord(): PlayRecord {
    return this.record;
  }

  // ── Queries for the panel ─────────────────────────────────────────────────

  /** Does an enabled mapping drive this control right now? */
  isDriven(controlId: string): boolean {
    for (const m of this.record.mappings) if (m.enabled && m.controlId === controlId) return true;
    for (const m of this.record.pairMappings ?? []) {
      const p = m.enabled ? this.pairs.get(m.pairId) : undefined;
      if (p && pairDrives(m, p, controlId)) return true;
    }
    return false;
  }

  /** The value written last frame (undefined when the control isn't driven). */
  liveValue(controlId: string): ControlValue | undefined {
    return this.live.get(controlId);
  }

  /** A layer property right now: what a mapping drives it to, else the layer's own value. */
  layerValue(layerId: string, key: string, base: number): number {
    const k = `${layerId}::${key}`;
    return this.overrides.get(k) ?? this.layerLive.get(k) ?? base;
  }

  /** A layer measured something (fill, hover, speed, spread, motion). */
  setSensor(key: string, value: number): void {
    this.sensors.set(key, value);
  }

  /** What a layer last reported under `key` (a Data layer's `<id>::row`, for its panel), or undefined. */
  sensor(key: string): number | undefined {
    return this.sensors.get(key);
  }

  /** A following null moved (null clears it). */
  setOverride(layerId: string, key: string, value: number | null): void {
    const k = `${layerId}::${key}`;
    if (value === null) this.overrides.delete(k); else this.overrides.set(k, value);
  }

  /** An override as set (a take's recorded place for a driven layer), or undefined. */
  overrideOf(layerId: string, key: string): number | undefined {
    return this.overrides.get(`${layerId}::${key}`);
  }

  /** Relationship layers: each catch the kit counted (`<id>::caught`) sends the layer's catch signal. */
  private caughtSeen = new Map<string, number>();
  private tickRelationshipSignals(): void {
    for (const l of this.record.layers) {
      if (l.kind !== 'relationship') continue;
      const n = this.sensors.get(`${l.id}::caught`) ?? 0, last = this.caughtSeen.get(l.id);
      this.caughtSeen.set(l.id, n);
      if (last !== undefined && n > last && l.catchSignal) this.emitSignal(l.catchSignal);
    }
  }

  /** The picture's width / height, for distances between nulls. */
  setAspect(aspect: number): void {
    if (aspect > 0 && Number.isFinite(aspect)) this.aspect = aspect;
  }

  /** A press on a shape (the overlay calls this; release on pointer up). */
  pressZone(layerId: string): void { this.press(`zone:${layerId}:click`); }
  releaseZone(layerId: string): void { this.release(`zone:${layerId}:click`); }

  /** Listen for fired actions (the overlay hands them to the layer kit). */
  onAction(cb: (a: PlayAction) => void): () => void {
    this.actionListeners.add(cb);
    return () => { this.actionListeners.delete(cb); };
  }

  /** Fire an action control now (its button on the panel). */
  fireControl(controlId: string): void {
    const c = this.controls.get(controlId);
    const at = c ? parseActionTarget(c.target) : null;
    if (!c || !at) return;
    const a: PlayAction = { id: c.id, trigger: { on: 'mouse' }, do: at.do, layerId: at.layerId, amount: c.amount ?? 1, enabled: true };
    for (const cb of this.actionListeners) cb(a);
  }

  /** Did a driven layer property change in the last tick? (The overlay redraws.) */
  layerChanged(): boolean {
    return this.layerMoved;
  }

  private layerBase(layerId: string, key: string): number | null {
    const layer = this.record.layers.find(l => l.id === layerId);
    if (!layer) return null;
    const v = (layer as unknown as Record<string, unknown>)[key];
    return typeof v === 'number' ? v : null;
  }

  /** An audio layer's bands, measured once a frame from its song (or the live input), times its Gain. */
  private audioBands = new Map<string, { frame: number; v: Record<LiveBand, number> }>();
  private audioBand(layerId: string, band: LiveBand): number | null {
    const l = this.record.layers.find(x => x.id === layerId);
    if (!l || l.kind !== 'audio') return null;
    let c = this.audioBands.get(layerId);
    if (!c || c.frame !== this.frame) {
      const raw = l.input === 'file' ? layerAudio.raw(layerId) : liveAudio.raw();
      if (!raw) return null;
      const gain = this.layerValue(layerId, 'gain', l.gain);
      const v = { level: levelFromWave(raw.wave) } as Record<LiveBand, number>;
      for (const b of ['bass', 'lowmid', 'highmid', 'treble'] as const) v[b] = bandFromSpectrum(raw.freq, raw.sampleRate, LIVE_BANDS[b].lo, LIVE_BANDS[b].hi);
      for (const k of Object.keys(v) as LiveBand[]) v[k] = Math.max(0, Math.min(1, v[k] * gain));
      c = { frame: this.frame, v };
      this.audioBands.set(layerId, c);
    }
    return c.v[band];
  }

  /**
   * Where an anchor is on the picture now (0..1, y up): a layer's centre (see
   * geoAnchor) or a tracked hand's landmark. Null while it has none (a hand out
   * of view, particles with none alive).
   */
  anchorAt(ref: string): { x: number; y: number } | null {
    if (ref === 'mouse') return { x: this.mouseX, y: this.mouseY };
    if (ref === PAD_ANCHOR) {
      const x = padGrid.read('x', 0, 0), y = padGrid.read('y', 0, 0);
      return x === null || y === null ? null : { x, y };
    }
    const pt = sgScreenPoint(ref);
    if (pt) return pt;
    const hand = parseHandAnchor(ref);
    if (hand) return this.handPoint(hand.side, hand.point);
    const l = this.record.layers.find(x => x.id === ref);
    return l ? geoAnchor(l as unknown as PlayLayer & Record<string, unknown>, this.valueOf(l), this.aspect, this.reported, this.lookup) : null;
  }

  /** How far apart two anchors are, in picture heights, or null while either has no position. */
  anchorGap(a: string, b: string): number | null {
    const pa = this.anchorAt(a), pb = this.anchorAt(b);
    return pa && pb ? anchorDistance(pa, pb, this.aspect) : null;
  }

  private valueOf(l: PlayLayer): (key: string) => number {
    return key => this.layerValue(l.id, key, (l as unknown as Record<string, number>)[key]);
  }
  private reported = (key: string) => this.sensors.get(key);
  private lookup = (id: string) => {
    const l = this.record.layers.find(x => x.id === id);
    return l ? { layer: l as unknown as PlayLayer & Record<string, unknown>, value: this.valueOf(l) } : null;
  };

  /** Every trigger in the record: mapping triggers and action triggers. */
  private allTriggers(): TriggerSpec[] {
    const out: TriggerSpec[] = [];
    for (const m of this.record.mappings) if (m.enabled && m.source.kind === 'trigger') out.push(m.source.trigger);
    for (const a of this.record.actions ?? []) if (a.enabled) out.push(a.trigger);
    for (const m of this.record.pairMappings ?? []) if (m.enabled && m.source.kind === 'value' && m.source.source.kind === 'trigger') out.push(m.source.source.trigger);
    return out;
  }

  /**
   * A condition's value now (play/kit/signals.js sgParseValueRef): a control
   * in its own units, a layer's or a Finish effect's number, a mapping's
   * source (0..1), the pointer, or a distance in picture heights. Null while
   * it has none (a hand out of view, something deleted).
   */
  readValue(ref: string): number | null {
    const r = sgParseValueRef(ref);
    if (!r) return null;
    switch (r.kind) {
      case 'control': {
        const c = this.controls.get(r.id);
        const v = c ? this.live.get(c.id) ?? this.base.get(c.id) : undefined;
        if (v === undefined) return null;
        return Array.isArray(v) ? (v[0] + v[1] + v[2]) / 3 : v;
      }
      case 'mapping': {
        const m = this.record.mappings.find(x => x.id === r.id);
        return m ? this.readMapping(m) : null;
      }
      case 'mouse': return r.axis === 'x' ? this.mouseX : this.mouseY;
      case 'distance': return this.anchorGap(r.a, r.b);
      case 'prop': {
        const base = r.layerId.startsWith('finish:')
          ? readFinishValue(this.record.finish, `${r.layerId}::${r.key}`) ?? null
          : r.layerId.startsWith(AUDIO_FX_TARGET_PREFIX)
            ? readAudioFxValue(this.record.audioFx, `${r.layerId}::${r.key}`) ?? null
            : this.layerBase(r.layerId, r.key);
        return base === null ? null : this.layerValue(r.layerId, r.key, base);
      }
    }
  }

  /** A condition trigger's state (for the editor's meter): is it met now. */
  conditionOpen(t: TriggerSpec): boolean {
    return this.condStates.get(triggerKey(t))?.open ?? false;
  }

  /** Listen for signals as they fire (the signals list flashes). */
  onSignal(cb: (id: string) => void): () => void {
    this.signalListeners.add(cb);
    return () => { this.signalListeners.delete(cb); };
  }

  /** A signal fires: its "When signal fires" triggers see a press (and its release) at once. Learn takes it too. */
  private emitSignal(id: string): void {
    const key = signalKey(id);
    this.press(key);
    this.release(key);
    for (const cb of this.signalListeners) cb(id);
    if (this.learnTriggerCb) this.finishLearnTrigger({ on: 'signal', signal: id });
    else if (this.learnCb) this.finishLearn(signalSource(id));
  }

  /** Fire a signal by hand (its button on the signals list): what listens for it sees it on the next frame. */
  fireSignal(id: string): void {
    this.emitSignal(id);
    inputBus.wake();
  }

  /** Zone enter / fill triggers: a sensor crossing its threshold is a press; dropping below 80% of it releases. */
  private tickZoneTriggers(): void {
    for (const t of this.allTriggers()) {
      if (t.on !== 'zone' || t.event === 'click') continue;
      const key = triggerKey(t);
      const v = this.sensors.get(`${t.layerId}::${t.event === 'enter' ? 'hover' : 'fill'}`) ?? 0;
      const threshold = t.event === 'enter' ? 0.5 : t.threshold;
      const open = this.zoneGates.has(key);
      if (!open && v >= threshold) { this.zoneGates.add(key); this.press(key); }
      else if (open && v < threshold * 0.8) { this.zoneGates.delete(key); this.release(key); }
    }
  }

  /**
   * Condition triggers, proximity among them (a distance below or above, the
   * margin its hysteresis): a condition becoming true is a press, false again
   * its release; a crossing is a press and release in one frame.
   */
  private tickConditionTriggers(): void {
    const seen = new Set<string>();
    for (const t of this.allTriggers()) {
      if (t.on !== 'proximity' && t.on !== 'value') continue;
      const key = triggerKey(t);
      if (seen.has(key)) continue;
      seen.add(key);
      const c: ValueCondition = t.on === 'proximity' ? proximityCondition(t) : t;
      let st = this.condStates.get(key);
      if (!st) { st = sgCondNew(); this.condStates.set(key, st); }
      const ev = sgCondStep(st, this.readValue(c.value), c);
      if (ev === 'open') this.press(key);
      else if (ev === 'close') this.release(key);
      else if (ev === 'tap') { this.press(key); this.release(key); }
    }
  }

  /** Is this trigger held (or true) right now? For the panel's readouts. */
  isHeld(t: TriggerSpec): boolean {
    return this.triggerInput(t).gate;
  }

  /** A trigger's running press count and whether it is held now. */
  private triggerInput(t: TriggerSpec): { presses: number; gate: boolean } {
    if (t.on === 'beat') { const b = beatAt(t.bpm, t.beats, this.time); return { presses: b.count, gate: b.gate }; }
    const key = triggerKey(t);
    return { presses: this.presses.get(key) ?? 0, gate: (this.held.get(key) ?? 0) > 0 };
  }

  /** A firing-mode slot for a trigger, new when there was none or its mode changed (it starts from "nothing yet"). */
  private fireSlot(map: Map<string, FireSlot>, id: string, t: TriggerSpec, presses: number, gate: boolean): { slot: FireSlot; fresh: boolean } {
    const mode = t.fire?.mode ?? 'once';
    const slot = map.get(id);
    if (slot && slot.mode === mode) return { slot, fresh: false };
    const made = { mode, st: newFireState(presses, gate), count: 0 };
    map.set(id, made);
    return { slot: made, fresh: true };
  }

  /**
   * Fire each action by its trigger's mode: once per press (the default), every
   * frame or every N while held, or on release. Send a signal passes its signal
   * on down the chain in the same frame (sgRunActions: each signal once a
   * frame, a limited depth, so a loop can't hang).
   */
  private tickActions(dt: number): void {
    const actions = (this.record.actions ?? []).filter(a => a.enabled);
    if (!actions.length) return;
    sgRunActions(actions, a => {
      const { presses, gate } = this.triggerInput(a.trigger);
      // A new action starts from "no presses yet"; a beat that jumped (a seek) fires once.
      const { slot, fresh } = this.fireSlot(this.actionFire, a.id, a.trigger, presses, gate);
      return fresh ? 0 : Math.min(4, stepFire(slot.st, a.trigger.fire, presses, gate, dt));
    }, a => { for (const cb of this.actionListeners) cb(a); }, id => this.emitSignal(id));
  }

  // ── Hands ─────────────────────────────────────────────────────────────────

  /** Take in the tracker's newest frame (placed where the Camera layer shows the camera), and let go of hands gone too long. */
  private updateHands(): void {
    const { frame, seq } = handFeed.frame();
    if (frame && seq !== this.handSeq) {
      this.handSeq = seq;
      const settings = this.record.hands ?? DEFAULT_HANDS;
      const camAspect = frame.w > 0 && frame.h > 0 ? frame.w / frame.h : 16 / 9;
      const place = hdPlacement(this.record, (l, k) => this.layerValue(l.id, k, (l as unknown as Record<string, number>)[k]), camAspect, this.aspect, settings.mirror);
      hdUpdate(this.hands, frame, { picAspect: this.aspect, place, smoothing: settings.smoothing, responsiveness: settings.responsiveness, maxHands: settings.maxHands, swap: settings.swap });
    }
    hdAge(this.hands, typeof performance !== 'undefined' ? performance.now() : Date.now());
    handFeed.setCount(this.hands.count);
  }

  /** The hands as the engine sees them now (the overlay draws the skeleton from this). */
  handState(): HdState { return this.hands; }

  /** A landmark on the picture for a null following a hand, or null while that hand is out of view. */
  handPoint(side: HandSide, point: number): { x: number; y: number } | null {
    return hdPoint(this.hands, side, point);
  }

  /** Gesture triggers: a gesture starting is a press, ending is the release (hands.js keeps the hysteresis). */
  private tickHandTriggers(): void {
    for (const t of this.allTriggers()) {
      if (t.on !== 'hand') continue;
      const key = triggerKey(t);
      const on = hdGate(this.hands, t.side, t.gesture);
      const open = this.handGates.has(key);
      if (on && !open) { this.handGates.add(key); this.press(key); }
      else if (!on && open) { this.handGates.delete(key); this.release(key); }
    }
  }

  /**
   * Learn with hands. A source: the landmark and axis that moved furthest
   * since the hand was first seen (past HAND_LEARN_MOVE). A trigger: the
   * first gesture that starts (one already held when Learn began has to be
   * let go and made again).
   */
  private learnHands(): void {
    const h = this.hands;
    if (this.learnTriggerCb) {
      const held = new Set<string>();
      for (const side of ['right', 'left'] as const) for (const g of LEARN_GESTURES) if (hdGate(h, side, g)) held.add(`${side}:${g}`);
      const before = this.handLearnHeld;
      this.handLearnHeld = held;
      if (!before) return;
      for (const k of held) {
        if (before.has(k)) continue;
        const [side, gesture] = k.split(':') as [HandSide, HandGesture];
        this.finishLearnTrigger({ on: 'hand', side, gesture });
        return;
      }
      return;
    }
    if (!this.learnCb) return;
    const from = this.handLearnFrom ?? (this.handLearnFrom = new Map());
    let best = '', bestMove = HAND_LEARN_MOVE;
    for (const side of ['right', 'left'] as const) {
      const hand = h[side];
      if (!hand.present) continue;
      for (let i = 0; i < 21; i++) {
        for (const axis of ['x', 'y'] as const) {
          const key = `${side}:${i}:${axis}`;
          const v = hand.pts[i * 3 + (axis === 'y' ? 1 : 0)];
          const start = from.get(key);
          if (start === undefined) { from.set(key, v); continue; }
          // Fingertips win a near tie: moving a finger moves its whole chain a little.
          const move = Math.abs(v - start) * (i % 4 === 0 && i > 0 ? 1.1 : 1);
          if (move > bestMove) { bestMove = move; best = key; }
        }
      }
    }
    if (!best) return;
    const [side, point, axis] = best.split(':');
    this.finishLearn({ kind: 'hand', side: side as HandSide, read: 'point', point: Number(point), axis: axis as 'x' | 'y', gesture: 'pinch' });
  }

  /**
   * Raw unit reading of a source right now, or null while the source has never
   * produced one (a knob nobody has touched yet): such a mapping leaves its
   * control alone, so opening Play doesn't pin every mapped slider to its range
   * minimum before the performer touches anything.
   */
  readSource(source: PlaySource): number | null {
    switch (source.kind) {
      case 'midi': {
        // Locked knobs: whichever locked control moved last, on any channel setting.
        if (source.signal === 'cc' && source.locks?.length) { const v = midiEngine.readLocked(source.locks); return v === null ? null : v / 127; }
        // A note range: only notes inside it count, and a note reads 0..1 across it.
        if (source.range && (source.signal === 'note' || source.signal === 'velocity' || source.signal === 'gate')) {
          const r = midiEngine.readRange(source.channel, source.range);
          if (r.note < 0) return null;
          return source.signal === 'note' ? kmNoteUnit(source.range, r.note) : source.signal === 'velocity' ? r.vel / 127 : r.gate ? 1 : 0;
        }
        const ch = midiEngine.channelState(source.channel);
        switch (source.signal) {
          case 'note': return ch.seenNote ? ch.lastNote / 127 : null;
          case 'velocity': return ch.seenNote ? ch.lastVelocity / 127 : null;
          case 'gate': return ch.seenNote ? (ch.heldCount > 0 ? 1 : 0) : null;
          case 'bend': return ch.seenBend ? (ch.bend + 1) / 2 : null;
          // No `cc` yet: the row is waiting for its knob (lib/midiAutoLearn.ts) and leaves the control alone.
          case 'cc': { if (source.cc === undefined) return null; const n = source.cc & 127; return ch.seenCc[n] ? ch.cc[n] / 127 : null; }
        }
        return null;
      }
      case 'pad':
        return padGrid.read(source.read, source.col, source.row);
      case 'mouse':
        return source.axis === 'x' ? this.mouseX : source.axis === 'y' ? this.mouseY : this.mouseDown;
      case 'key':
        return this.keysHeld.has(source.code) ? 1 : 0;
      case 'osc': {
        const v = oscNumber(oscClient.value(source.address), source.arg);
        if (v === null) return null;
        return Math.max(0, Math.min(1, (v - source.min) / (source.max - source.min)));
      }
      case 'noise':
        return noiseAt(source.type, this.time, source.rate, source.seed, source.steps, this.frame);
      case 'live': {
        liveAudio.update(this.frame);
        const v = liveAudio.value(source.band);
        return v === null ? null : Math.max(0, Math.min(1, v * source.gain));
      }
      case 'reader':
        audioReaderBank.update();
        return audioReaderBank.value(source.readerId);
      case 'trigger':
        // Triggers keep per-mapping state; readMapping() reads it. A bare source reading is its gate.
        return (this.held.get(triggerKey(source.trigger)) ?? 0) > 0 ? 1 : 0;
      case 'lfo':
        return lfoValue(source.shape, this.time * source.rate + source.phase);
      case 'clock':
        return lfoValue(source.shape, this.time * clockRate(source.bpm, source.beats));
      case 'audio':
        return audioEngine.bandLevel(source.nodeId, source.band);
      case 'tilt': {
        if (!this.tilt) return null;
        if (source.axis === 'alpha') return ((this.tilt.alpha % 360) + 360) % 360 / 360;
        const v = Math.max(-90, Math.min(90, source.axis === 'beta' ? this.tilt.beta : this.tilt.gamma));
        return (v + 90) / 180;
      }
      case 'gamepad': {
        const pad = this.gamepad(source.pad);
        if (!pad) return null;
        if (source.control === 'axis') {
          const a = pad.axes[source.index];
          return a === undefined ? null : Math.max(0, Math.min(1, (a + 1) / 2));
        }
        const b = pad.buttons[source.index];
        return b === undefined ? null : b.value;
      }
      case 'sensor': {
        if (source.read === 'distance') {
          const d = source.otherId ? this.anchorGap(source.layerId, source.otherId) : null;
          return d === null ? null : Math.min(1, d);
        }
        if (AUDIO_READS.has(source.read)) return this.audioBand(source.layerId, source.read as LiveBand);
        return this.sensors.get(sensorKey(source)) ?? null;
      }
      case 'data':
        return readDataSource(source, k => this.sensors.get(k));
      case 'hand':
        return hdRead(this.hands, source.side, source.read, source.point, source.axis, source.gesture);
      case 'null': {
        const base = this.layerBase(source.layerId, source.axis);
        if (base === null) return null;
        return Math.max(0, Math.min(1, this.layerValue(source.layerId, source.axis, base)));
      }
      case 'control': {
        // Another control, as 0..1 across its range. What was written for it
        // this frame if it is driven (mappings run in list order; a later row
        // reads the previous frame), else the slider's value.
        const c = this.controls.get(source.controlId);
        if (!c) return null;
        const v = this.live.get(c.id) ?? this.base.get(c.id);
        if (v === undefined) return null;
        if (Array.isArray(v)) return (v[0] + v[1] + v[2]) / 3;
        const span = c.max - c.min;
        return span > 0 ? Math.max(0, Math.min(1, (v - c.min) / span)) : 0;
      }
    }
  }

  // ── Per-frame output (InputSource) ────────────────────────────────────────

  private gamepad(index: number): Gamepad | null {
    if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') return null;
    return navigator.getGamepads()[index] ?? null;
  }

  /** A mapping's 0..1 reading this frame (a trigger's envelope, toggle, step or random value), for meters. */
  readMapping(m: PlayMapping): number | null {
    if (m.source.kind === 'trigger') return this.triggerStates.get(m.id)?.value ?? 0;
    return this.readSource(m.source);
  }

  private readTrigger(m: PlayMapping, dt: number): number {
    const src = m.source as Extract<PlaySource, { kind: 'trigger' }>;
    const t = src.trigger;
    const { presses, gate } = this.triggerInput(t);
    const velocity = src.velocity && t.on !== 'beat' ? this.velocities.get(triggerKey(t)) ?? 1 : 1;
    // The firing mode turns presses and the gate into fires; the envelope, toggle or step counts those.
    // A new mapping (or a new mode) starts from "nothing yet", so it doesn't fire for presses made before it.
    const { slot, fresh } = this.fireSlot(this.mappingFire, m.id, t, presses, gate);
    let st = this.triggerStates.get(m.id);
    if (!st) { st = newTriggerState(0); this.triggerStates.set(m.id, st); }
    if (fresh) st.seen = 0;
    else slot.count += Math.min(4, stepFire(slot.st, t.fire, presses, gate, dt));
    return stepTrigger(st, src, slot.count, gate, dt, velocity);
  }

  /**
   * Audio-hit triggers: a band crossing its threshold is a press; falling below 80% of it releases (hysteresis).
   * Reader triggers: a reader crossing its threshold, letting go below threshold − hysteresis. Mappings' and actions' alike.
   */
  private audioGates = new Set<string>();
  private tickAudioTriggers(): void {
    const live = liveAudio.isOn();
    if (live) liveAudio.update(this.frame);
    if (audioReaderBank.has()) audioReaderBank.update();
    const seen = new Set<string>();
    for (const t of this.allTriggers()) {
      if (t.on !== 'audio' && t.on !== 'reader') continue;
      const key = triggerKey(t);
      if (seen.has(key)) continue;
      seen.add(key);
      const open = this.audioGates.has(key);
      if (t.on === 'audio') {
        if (!live) continue;
        const v = liveAudio.value(t.band) ?? 0;
        if (!open && v >= t.threshold) { this.audioGates.add(key); this.press(key, v); }
        else if (open && v < t.threshold * 0.8) { this.audioGates.delete(key); this.release(key); }
      } else {
        const v = audioReaderBank.value(t.readerId) ?? 0;
        const on = readerGate(open, v, t.threshold, t.hysteresis);
        if (on && !open) { this.audioGates.add(key); this.press(key, v); }
        else if (!on && open) { this.audioGates.delete(key); this.release(key); }
      }
    }
    // A trigger removed while open lets go.
    for (const k of [...this.audioGates]) if (!seen.has(k)) { this.audioGates.delete(k); this.release(k); }
  }

  /**
   * A take playing back: live input changes nothing (the take writes every
   * value), and presses made meanwhile don't fire when it ends.
   */
  private muted = false;
  setMuted(on: boolean): void {
    if (on === this.muted) return;
    this.muted = on;
    // The take has every hand-driven value: the tracker rests meanwhile instead of fighting it.
    handFeed.setPaused(on);
    // Back live: every control gets its slider's value (or its mapping's) again.
    if (!on) for (const id of this.controls.keys()) this.restoreOnce.add(id);
    inputBus.wake();
  }

  /** A take playing back shows its values on the panel's readouts (muted, nothing else writes them). */
  showLive(controlId: string, value: ControlValue): void {
    if (this.muted) this.live.set(controlId, value);
  }

  tickInputs(dt: number, time: number, write: InputWriter): void {
    this.time = time;
    this.frame++;
    if (this.muted) {
      // The take fires what was recorded. Back live, triggers start from "nothing yet": presses made meanwhile don't fire.
      this.actionFire.clear();
      this.mappingFire.clear();
      return;
    }
    if (this.handsBound || handFeed.isOn() || this.hands.live) {
      this.updateHands();
      this.tickHandTriggers();
      if (this.learnCb || this.learnTriggerCb) this.learnHands();
    }
    if (this.learnCb || this.learnTriggerCb) this.learnAudio();
    this.tickAudioTriggers();
    this.tickZoneTriggers();
    // A clock sent back (rewind): axis swaps start on A again.
    if (time < this.lastTime - 1e-6) for (const st of this.pairState.values()) st.swap = sgSwapNew();
    this.lastTime = time;
    this.tickConditionTriggers();
    this.tickRelationshipSignals();
    this.tickActions(dt);
    if (this.learnCb && this.performing) this.pollGamepadLearn();
    // Gamepads are polled, not evented: a stick moving has to draw a frame even while the clock is paused.
    if (this.gamepadIsBound && this.performing) inputBus.wake();
    const driven = new Set<string>();
    this.layerMoved = false;
    // Colour controls start each frame from their base so an un-mapped channel keeps the slider's value.
    for (const m of this.record.mappings) {
      if (!m.enabled) continue;
      const control = this.controls.get(m.controlId);
      if (!control) continue;
      const reading = m.source.kind === 'trigger' ? this.readTrigger(m, dt) : this.readSource(m.source);
      if (reading === null) continue;
      const target = mapValue(reading, m);
      let st = this.state.get(m.id);
      if (!st) { st = { value: undefined }; this.state.set(m.id, st); }
      let v: number;
      if (m.smoothMs <= 0 || st.value === undefined) {
        v = target;
      } else {
        const alpha = 1 - Math.exp(-(dt * 1000) / m.smoothMs);
        v = st.value + (target - st.value) * alpha;
        // Settle exactly so a held knob stops producing sub-epsilon churn.
        if (Math.abs(v - target) < 1e-4 * Math.max(1, Math.abs(m.outMax - m.outMin))) v = target;
      }
      st.value = v;
      if (control.kind === 'action') {
        // A button: fires once each time its mapping rises through the middle (a key down, a click, a beat).
        const was = this.actionLevel.get(control.id) ?? 0;
        this.actionLevel.set(control.id, v);
        if (v >= 0.5 && was < 0.5) this.fireControl(control.id);
        this.live.set(control.id, v);
        driven.add(control.id);
        continue;
      }
      if (control.kind !== 'color') { this.writePlain(control, v, write, driven); continue; }
      const key = paramChannelKey(bindingKeyOf(control.target));
      {
        const buf = this.colourBuffer(control.id, driven.has(control.id));
        if (m.channel === undefined) {
          // Brightness: scale the base colour.
          const base = this.baseColour(control.id);
          buf[0] = base[0] * v; buf[1] = base[1] * v; buf[2] = base[2] * v;
        } else {
          buf[m.channel] = v;
        }
        write(key, buf);
        this.live.set(control.id, buf);
      }
      driven.add(control.id);
    }
    // Pair mappings, after the plain ones: on a control both drive, the pair's wins.
    this.tickPairs(dt, write, driven);
    // A control that was driven last frame and isn't now: put the slider's value back once.
    for (const id of this.drivenLastFrame) if (!driven.has(id)) this.restoreOnce.add(id);
    for (const id of this.restoreOnce) {
      if (driven.has(id)) continue;
      this.actionLevel.delete(id);
      const control = this.controls.get(id);
      const base = this.base.get(id);
      const lt = control ? parsePropTarget(control.target) : null;
      if (lt) {
        this.layerLive.delete(`${lt.layerId}::${lt.key}`);
        this.layerMoved = true;
      } else if (control && base !== undefined && !parseReaderTarget(control.target) && !parseGrainsTarget(control.target)) {
        write(paramChannelKey(bindingKeyOf(control.target)), Array.isArray(base) ? [...base] : base);
      }
      this.live.delete(id);
    }
    this.restoreOnce.clear();
    this.drivenLastFrame = driven;
  }

  /** Write a number to a float control: a layer property or Finish number (the overlay reads it), or a uniform. */
  private writePlain(control: PlayControl, v: number, write: InputWriter, driven: Set<string>): void {
    const layerTarget = parsePropTarget(control.target);
    if (layerTarget) {
      // A layer property or a Finish effect's number: not a uniform. The overlay reads it after this tick.
      const lk = `${layerTarget.layerId}::${layerTarget.key}`;
      if (this.layerLive.get(lk) !== v) { this.layerLive.set(lk, v); this.layerMoved = true; }
    } else if (!parseReaderTarget(control.target) && !parseGrainsTarget(control.target)) {
      // A reader's level control (or a granulator's grain readout) has no uniform: the value is kept as the control's live value only.
      write(paramChannelKey(bindingKeyOf(control.target)), v);
    }
    this.live.set(control.id, v);
    driven.add(control.id);
  }

  /**
   * Pair mappings: a position drives both axes at once (x → A, y → B), a
   * single source drives A, B or both, each axis through its own range,
   * curve and smoothing. An axis whose condition doesn't hold keeps its last
   * value. With an axis swap the source drives A until A crosses the swap
   * threshold, then B until B crosses back (play/kit/signals.js sgSwapStep);
   * the axis not being driven holds where it was.
   */
  private tickPairs(dt: number, write: InputWriter, driven: Set<string>): void {
    this.pairMoving = false;
    for (const m of this.record.pairMappings ?? []) {
      if (!m.enabled) continue;
      const pair = this.pairs.get(m.pairId);
      const ca = pair && this.controls.get(pair.a), cb = pair && this.controls.get(pair.b);
      if (!ca || !cb) continue;
      let st = this.pairState.get(m.id);
      if (!st) { st = { a: undefined, b: undefined, swap: sgSwapNew(), condA: sgCondNew(), condB: sgCondNew() }; this.pairState.set(m.id, st); }
      const { ua, ub } = this.pairReading(m, dt);
      const swapping = !!m.swap && m.source.kind === 'value';
      let useA = swapping ? st.swap.axis === 'a' : m.affect !== 'b';
      let useB = swapping ? st.swap.axis === 'b' : m.affect !== 'a';
      if (m.a.when) { sgCondStep(st.condA, this.readValue(m.a.when.value), m.a.when); if (!st.condA.open) useA = false; }
      if (m.b.when) { sgCondStep(st.condB, this.readValue(m.b.when.value), m.b.when); if (!st.condB.open) useB = false; }
      if (useA && ua !== null) st.a = this.smoothAxis(st.a, mapValue(ua, m.a), m.a, dt);
      if (useB && ub !== null) st.b = this.smoothAxis(st.b, mapValue(ub, m.b), m.b, dt);
      // Only the axes this mapping drives (an edit from Both to A lets B go back to its slider).
      if (st.a !== undefined && (swapping || m.affect !== 'b')) this.writePlain(ca, st.a, write, driven);
      if (st.b !== undefined && (swapping || m.affect !== 'a')) this.writePlain(cb, st.b, write, driven);
      if (swapping && m.swap) {
        const ev = sgSwapStep(st.swap, useA && ua !== null ? st.a : null, useB && ub !== null ? st.b : null, m.swap);
        if (ev === 'toB' && m.swap.signal) this.emitSignal(m.swap.signal);
        if (ev === 'toA' && m.swap.backSignal) this.emitSignal(m.swap.backSignal);
      }
    }
  }

  /** A pair mapping's 0..1 readings this frame for A and B (a position's x and y, or one source for both). */
  private pairReading(m: PlayPairMapping, dt: number): { ua: number | null; ub: number | null } {
    if (m.source.kind === 'position') {
      const p = this.anchorAt(m.source.anchor);
      return p ? { ua: clamp01(p.x), ub: clamp01(p.y) } : { ua: null, ub: null };
    }
    const src = m.source.source;
    const u = src.kind === 'trigger' ? this.readTrigger({ id: m.id, source: src } as PlayMapping, dt) : this.readSource(src);
    return { ua: u, ub: u };
  }

  /** One axis's value after smoothing (exponential, settling exactly like a mapping's). */
  private smoothAxis(prev: number | undefined, target: number, ax: PairAxis, dt: number): number {
    if (ax.smoothMs <= 0 || prev === undefined) return target;
    const v = prev + (target - prev) * (1 - Math.exp(-(dt * 1000) / ax.smoothMs));
    if (Math.abs(v - target) < 1e-4 * Math.max(1, Math.abs(ax.outMax - ax.outMin))) return target;
    this.pairMoving = true;
    return v;
  }

  /** For the editor: a pair mapping's readings now (not advancing anything) and the axis a swap is on. */
  pairNow(m: PlayPairMapping): { ua: number | null; ub: number | null; axis: 'a' | 'b'; a: number | undefined; b: number | undefined } {
    const st = this.pairState.get(m.id);
    let ua: number | null = null, ub: number | null = null;
    if (m.source.kind === 'position') { const p = this.anchorAt(m.source.anchor); if (p) { ua = clamp01(p.x); ub = clamp01(p.y); } }
    else { ua = ub = m.source.source.kind === 'trigger' ? this.triggerStates.get(m.id)?.value ?? 0 : this.readSource(m.source.source); }
    return { ua, ub, axis: st?.swap.axis ?? 'a', a: st?.a, b: st?.b };
  }

  /** Start every axis swap on A again (the editor's button; a rewind does it too). */
  resetSwaps(): void {
    for (const st of this.pairState.values()) st.swap = sgSwapNew();
    inputBus.wake();
  }

  /** Is a pair mapping axis's condition met now (for the editor)? */
  pairCondOpen(mappingId: string, axis: 'a' | 'b'): boolean {
    const st = this.pairState.get(mappingId);
    return !!st && (axis === 'a' ? st.condA.open : st.condB.open);
  }

  private baseColour(controlId: string): number[] {
    const b = this.base.get(controlId);
    return Array.isArray(b) && b.length >= 3 ? b : ZERO3;
  }

  private colourBuffer(controlId: string, alreadyTouchedThisFrame: boolean): number[] {
    let buf = this.colour.get(controlId);
    if (!buf) { buf = [0, 0, 0]; this.colour.set(controlId, buf); }
    if (!alreadyTouchedThisFrame) {
      const base = this.baseColour(controlId);
      buf[0] = base[0]; buf[1] = base[1]; buf[2] = base[2];
    }
    return buf;
  }

  // ── Mouse + keyboard backends ─────────────────────────────────────────────

  /** Is the Play page showing (keys play)? */
  isPerforming(): boolean { return this.performing; }

  /** The Play page is showing: listen to the pointer and the keyboard. */
  setPerforming(on: boolean): void {
    if (on === this.performing || typeof window === 'undefined') return;
    this.performing = on;
    if (on) {
      window.addEventListener('pointermove', this.onPointerMove);
      window.addEventListener('pointerdown', this.onPointerDown);
      window.addEventListener('pointerup', this.onPointerUp);
      window.addEventListener('keydown', this.onKeyDown, true);
      window.addEventListener('keyup', this.onKeyUp, true);
      window.addEventListener('blur', this.onBlur);
      window.addEventListener('deviceorientation', this.onOrientation);
    } else {
      window.removeEventListener('pointermove', this.onPointerMove);
      window.removeEventListener('pointerdown', this.onPointerDown);
      window.removeEventListener('pointerup', this.onPointerUp);
      window.removeEventListener('keydown', this.onKeyDown, true);
      window.removeEventListener('keyup', this.onKeyUp, true);
      window.removeEventListener('blur', this.onBlur);
      window.removeEventListener('deviceorientation', this.onOrientation);
      this.onBlur();
      this.cancelLearn();
    }
  }

  /** iOS asks before sharing orientation; the page shows a button when this is true. */
  tiltNeedsPermission(): boolean {
    if (this.tilt) return false;
    const ctor = typeof DeviceOrientationEvent !== 'undefined' ? (DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> }) : undefined;
    return typeof ctor?.requestPermission === 'function';
  }

  /** Must be called from a user gesture. Resolves true when orientation events will arrive. */
  async requestTiltPermission(): Promise<boolean> {
    const ctor = typeof DeviceOrientationEvent !== 'undefined' ? (DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> }) : undefined;
    if (typeof ctor?.requestPermission !== 'function') return true;
    try { return (await ctor.requestPermission()) === 'granted'; } catch { return false; }
  }

  /** While learning: a stick pushed or a button pressed becomes the source. */
  private pollGamepadLearn(): void {
    if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') return;
    const pads = navigator.getGamepads();
    for (let i = 0; i < pads.length; i++) {
      const pad = pads[i];
      if (!pad) continue;
      const prev = this.padSnapshots.get(i);
      const axes = Array.from(pad.axes);
      const buttons = pad.buttons.map(b => b.value);
      this.padSnapshots.set(i, { axes, buttons });
      if (!prev) continue;
      for (let a = 0; a < axes.length; a++) {
        if (Math.abs(axes[a] - (prev.axes[a] ?? 0)) > 0.4) { this.finishLearn({ kind: 'gamepad', pad: i, control: 'axis', index: a }); return; }
      }
      for (let b = 0; b < buttons.length; b++) {
        if (buttons[b] > 0.5 && (prev.buttons[b] ?? 0) <= 0.5) { this.finishLearn({ kind: 'gamepad', pad: i, control: 'button', index: b }); return; }
      }
    }
  }

  /** A mapping, trigger or action listens to this key (so the page leaves it alone). */
  keyIsBound(code: string): boolean {
    for (const m of this.record.mappings) {
      if (!m.enabled) continue;
      if (m.source.kind === 'key' && m.source.code === code) return true;
      if (m.source.kind === 'trigger' && m.source.trigger.on === 'key' && m.source.trigger.code === code) return true;
    }
    for (const a of this.record.actions ?? []) if (a.enabled && a.trigger.on === 'key' && a.trigger.code === code) return true;
    for (const m of this.record.pairMappings ?? []) {
      const s = m.enabled && m.source.kind === 'value' ? m.source.source : null;
      if (s && ((s.kind === 'key' && s.code === code) || (s.kind === 'trigger' && s.trigger.on === 'key' && s.trigger.code === code))) return true;
    }
    return false;
  }

  /** Actions, layer-property mappings, reader controls and Learn run whatever the shader binds. */
  wantsTick(): boolean {
    return !!this.record.actions?.length || this.isLearning() || this.allTriggers().some(t => t.on === 'proximity' || t.on === 'value') || !!this.record.pairMappings?.some(m => m.enabled) || this.handsBound || handFeed.isOn() || this.record.controls.some(c => c.kind === 'action' || parsePropTarget(c.target) !== null || parseReaderTarget(c.target) !== null);
  }

  /** Something (a trigger or a noise row) moves on its own, so the render loop must keep drawing. */
  isAnimating(): boolean {
    if ((this.record.actions ?? []).some(a => a.enabled && a.trigger.on === 'beat')) return true;
    // Learning with sound listens every frame.
    if ((this.learnCb || this.learnTriggerCb) && (liveAudio.isOn() || audioReaderBank.live())) return true;
    // Sound that fires actions keeps being listened to.
    if ((this.record.actions ?? []).some(a => a.enabled && ((a.trigger.on === 'audio' && liveAudio.isOn()) || (a.trigger.on === 'reader' && audioReaderBank.live())))) return true;
    // Held, or every N while held: keeps firing without anything else moving.
    if (this.allTriggers().some(t => firesWhileHeld(t.fire) && this.triggerInput(t).gate)) return true;
    // Tracking hands: landmarks arrive about 30 times a second, and smoothing and springs ease between them.
    if (handFeed.isOn() && !handFeed.isPaused()) return true;
    // An axis mid-smoothing keeps drawing until it settles.
    if (this.pairMoving) return true;
    return this.record.mappings.some(m => m.enabled && sourceAnimates(m.source, (this.triggerStates.get(m.id)?.stage ?? 'idle') === 'idle'))
      || (this.record.pairMappings ?? []).some(m => m.enabled && m.source.kind === 'value' && sourceAnimates(m.source.source, (this.triggerStates.get(m.id)?.stage ?? 'idle') === 'idle'));
  }

  // ── Learn ─────────────────────────────────────────────────────────────────

  /**
   * Wait for the next MIDI message or key press and hand it back as a source.
   * A note → its velocity, a knob → that CC, the wheel → pitch bend. Returns a
   * cancel function; only one learn runs at a time.
   */
  /**
   * Like startLearn, but for what fires a trigger: a key, a note (with its
   * number), a click on the picture or an OSC address.
   */
  startLearnTrigger(cb: (trigger: TriggerSpec) => void): () => void {
    this.cancelLearn();
    this.learnTriggerCb = cb;
    if (this.performing) inputBus.wake();
    this.learnOffMidi = midiEngine.subscribe((e: MidiEvent) => {
      if (e.kind === 'noteOn') this.finishLearnTrigger({ on: 'note', channel: e.channel, note: e.note });
    });
    return () => this.cancelLearn();
  }

  private finishLearnTrigger(t: TriggerSpec): void {
    const cb = this.learnTriggerCb;
    this.cancelLearn();
    cb?.(t);
  }

  startLearn(cb: (source: PlaySource) => void): () => void {
    this.cancelLearn();
    this.learnCb = cb;
    this.padSnapshots.clear();
    if (this.performing) inputBus.wake();
    this.learnOffMidi = midiEngine.subscribe((e: MidiEvent) => {
      switch (e.kind) {
        case 'noteOn': this.finishLearn({ kind: 'midi', signal: 'velocity', channel: e.channel }); break;
        case 'cc': this.finishLearn({ kind: 'midi', signal: 'cc', channel: e.channel, cc: e.cc }); break;
        case 'bend': this.finishLearn({ kind: 'midi', signal: 'bend', channel: e.channel }); break;
        default: break;
      }
    });
    return () => this.cancelLearn();
  }

  isLearning(): boolean {
    return this.learnCb !== null || this.learnTriggerCb !== null;
  }

  cancelLearn(): void {
    this.learnOffMidi?.();
    this.learnOffMidi = null;
    this.learnOffOsc?.();
    this.learnOffOsc = null;
    this.learnCb = null;
    this.learnTriggerCb = null;
    this.handLearnFrom = null;
    this.handLearnHeld = null;
    this.audioLearn = null;
  }

  // ── Learn with sound ──────────────────────────────────────────────────────

  /** Learn: the lowest each band and reader read since Learn began, and frames seen. */
  private audioLearn: { low: Map<string, number>; frames: number; pick: { key: string; peak: number; frames: number } | null } | null = null;

  /**
   * Learn with sound: play something, and the band or reader that rose most
   * (readers first, as the more specific) becomes the source, or the trigger
   * at 60% of the way up its rise (followed to its peak, up to a few frames).
   * Level is left out: it moves with everything.
   */
  private learnAudio(): void {
    const live = liveAudio.isOn();
    const readers = audioReaderBank.has();
    if (!live && !readers) return;
    if (live) liveAudio.update(this.frame);
    if (readers) audioReaderBank.update();
    const now = new Map<string, number>();
    for (const r of audioReaderBank.readers()) { const v = audioReaderBank.value(r.id); if (v !== null) now.set(`reader:${r.id}`, v); }
    if (live) for (const b of ['bass', 'lowmid', 'highmid', 'treble'] as const) now.set(`band:${b}`, liveAudio.value(b) ?? 0);
    const st = this.audioLearn ?? (this.audioLearn = { low: new Map(), frames: 0, pick: null });
    st.frames++;
    if (!st.pick) for (const [k, v] of now) st.low.set(k, Math.min(st.low.get(k) ?? v, v));
    // A few frames to find the quiet first.
    if (st.frames < 6) return;
    if (!st.pick) {
      const key = pickLearned([...now].map(([k, v]) => ({ key: k, low: st.low.get(k) ?? v, now: v })));
      if (!key) return;
      st.pick = { key, peak: now.get(key) ?? 0, frames: 0 };
      return;
    }
    // Follow the rise to its peak (it stops rising, or 8 frames), so the trigger's threshold sits under the hit, not under its first frame.
    const p = st.pick;
    const cur = now.get(p.key) ?? 0;
    p.frames++;
    if (cur > p.peak + 1e-3 && p.frames < 8) { p.peak = cur; return; }
    const pick = p.key;
    const v = Math.max(p.peak, cur), low = st.low.get(pick) ?? 0;
    const threshold = Math.round(Math.max(0.05, Math.min(0.95, low + (v - low) * 0.6)) * 100) / 100;
    const [kind, id] = [pick.slice(0, pick.indexOf(':')), pick.slice(pick.indexOf(':') + 1)];
    if (this.learnTriggerCb) {
      this.finishLearnTrigger(kind === 'reader'
        ? { on: 'reader', readerId: id, threshold, hysteresis: Math.round(Math.min(threshold, 0.1) * 100) / 100 }
        : { on: 'audio', band: id as LiveBand, threshold });
    } else {
      this.finishLearn(kind === 'reader' ? { kind: 'reader', readerId: id } : { kind: 'live', band: id as LiveBand, gain: 1 });
    }
  }

  private finishLearn(source: PlaySource): void {
    const cb = this.learnCb;
    this.cancelLearn();
    cb?.(source);
  }
}

const ZERO3 = [0, 0, 0];

export const playEngine = new PlayEngine();
inputBus.addSource(playEngine);
