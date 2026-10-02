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

import { rtCurve, rtFrame, rtNew, rtRewind, rtSourcesOf, rtTriggersOf, type RtApplyHost, type RtSource, type RtState, type RtStepHost } from '../play/kit/routes.js';
import { inputBus, paramChannelKey, type InputSource, type InputWriter } from './inputBus';
import { midiEngine, type MidiEvent } from './midiEngine';
import { keyboardClaimed } from './keyboardClaim';
import { padGrid } from './padGrid';
import { kmNoteUnit } from '../play/kit/midi.js';
import { audioEngine } from './audioEngine';
import { oscClient, oscNumber, type OscMessage } from './oscClient';
import { anchorDistance, beatAt, firesWhileHeld, newFireState, newTriggerState, noiseAt, proximityCondition, signalKey, stepFire, stepTrigger, triggerKey, type FireState, type TriggerState } from '../play/triggers';
import { incAdvance, incFold, incGlide, incGliding, incNew, incRange, incRepeat, incReset, incThreshold, type IncState } from '../play/kit/increment.js';
import { sgLevelDeps, sgPulseLinks, sgReactions, sgSignalPlan, type SgSignalPlanEntry, sgCondNew, sgCondRewind, sgCondStep, sgLinkClear, sgLinkDue, sgLinkFire, sgLinkNew, sgLinkPlan, sgLogic, type SgLinkPlan, type SgLinkState, type SgLoop, sgParseValueRef, sgShapeNew, sgShapeRewind, sgShapeStep, sgShaped, sgSignalOrder, type SgShapeState, sgRunActions, sgScreenPoint, sgSwapNew, sgSwapStep, type SgCondState, type SgSwapState } from '../play/kit/signals.js';
import { readFinishValue } from '../types/playFinish';
import { AUDIO_FX_TARGET_PREFIX, readAudioFxValue } from '../types/playAudioFx';
import { signalNames } from '../play/signalNames';
import { conditionRanges } from '../play/conditionRange';
import { playPerfOn, recordPlayCounts, recordPlayStage, type PlayStage } from './perfStats';
import type { PairAxis, PlayPair, PlayPairMapping, PlaySignal, SourceOutput, ValueCondition } from '../types/play';
import { geoAnchor } from '../play/kit/geometry.js';
import { fnEval } from '../play/kit/fn.js';
import type { TriggerSpec } from '../types/play';
import type { LfoShape, PlayAction, PlayControl, PlayCurve, PlayMapping, PlayRecord, PlaySource, SensorRead } from '../types/play';
import { sensorKey } from '../types/play';
import { parseGrainsTarget } from '../types/playAudioEngine';
import { CURVE_POINTS, emptyPlayRecord, parseActionTarget, parsePropTarget, parseReaderTarget, spreadPropId } from '../types/play';
import { spValue, spWeight } from '../play/kit/spread.js';
import { layerAudio } from './layerAudio';
import { bandFromSpectrum, levelFromWave, liveAudio, LIVE_BANDS, type LiveBand } from './liveAudio';
import { audioReaderBank } from './audioReaderBank';
import { pickLearned, readerGate } from '../play/audioReaders';
import { faceFeed, handFeed, poseFeed, trackerFeeds, type TrackerKind } from './handFeed';
import { bakeTrack, trackerOptionsFor } from './trackBakes';
import { fcCreate, fcGate, fcPoint, fcRead, fcUpdate } from '../play/kit/face.js';
import { psCreate, psGate, psPoint, psRead, psUpdate } from '../play/kit/pose.js';
import { tkDrive, tkDriver, tkHandsFrame, tkSubjectAge, tkVideoTime, type TkFrame, type TkSubject, type TkTrack } from '../play/kit/tracks.js';
import { DEFAULT_FACE, DEFAULT_POSE, bakeFor, parseTrackAnchor, usesFace, usesPose, type PlayTracker } from '../types/playTracking';
import type { VideoLayer } from '../types/playLayers';
import { readDataSource } from '../play/dataLayer';
import { hdAge, hdCreate, hdGate, hdPlacement, hdPoint, hdRead, hdTrackerOptions, hdUpdate, type HdState } from '../play/kit/hands.js';
import { CAPTURE_POS, DEFAULT_HANDS, PAD_ANCHOR, parseEventAnchor, parseHandAnchor, parseSignalAnchor, usesHands, type FireMode, type HandGesture, type HandSide, type PlayLayer } from '../types/play';

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
  // The kit's (routes.js), so the app and a website shape values the same way.
  return rtCurve(u, curve, curveY);
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

/** A Function source's `b`: quarter notes per second at a fixed 120 BPM (docs/play-v1-plan.md, "Sources"). */
export const FN_BEAT_HZ = 120 / 60;

interface PadSnapshot { axes: number[]; buttons: number[] }

export function isTypingTarget(el: EventTarget | null): boolean {
  const node = el as HTMLElement | null;
  const tag = node?.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !!node?.isContentEditable;
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

/** A signal's default seed for its rolls, from its id (the same setup rolls the same way). */
export function seedOf(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** How far around a position the picture's brightness is read, in picture heights. */
export const PICTURE_PATCH = 0.05;

/** Does a condition's value path read the pointer (mouse:x|y, or a distance to or from it)? */
function readsMouse(ref: string | undefined): boolean {
  const r = ref ? sgParseValueRef(ref) : null;
  const ptr = (a: string) => a === 'mouse' || a === 'pointer';
  return !!r && (r.kind === 'mouse' || (r.kind === 'distance' && (ptr(r.a) || ptr(r.b))) || (r.kind === 'axis' && ptr(r.anchor)));
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
  /** Reset-mode Spreads whose signal fired (play/spreadReset.ts writes their members' minimums). */
  private spreadResetListeners = new Set<(spreadId: string) => void>();
  private actionListeners = new Set<(a: PlayAction) => void>();
  /** Action controls: the last mapped level, so a rise through 0.5 fires once. */
  private actionLevel = new Map<string, number>();
  /** Increment mappings: each one's steps (play/kit/increment.js), its trigger's and its reset signal's firing state, and its repeat condition. */
  private incStates = new Map<string, IncState>();
  private incFire = new Map<string, FireSlot>();
  private incCond = new Map<string, SgCondState>();
  private incMoving = false;

  // ── Hands (hand tracking): landmarks from handFeed, read as sources, gestures and null targets ──
  private hands: HdState = hdCreate();
  private handSeq = -1;
  private handsBound = false;
  /** Gesture triggers whose gate is open (a press was counted, the release is still to come). */
  private handGates = new Set<string>();
  /** Learn: where each landmark was when the hand was first seen, and which gestures were already held. */
  private handLearnFrom: Map<string, number> | null = null;
  private handLearnHeld: Set<string> | null = null;

  // ── Face and pose tracking, and tracking a Video layer (docs/tracking.md) ──
  private face: TkSubject = fcCreate();
  private pose: TkSubject = psCreate();
  private faceSeq = -1;
  private poseSeq = -1;
  private faceBound = false;
  private poseBound = false;
  /** Where each tracker last read its baked track (a jump replays the moments before, tracks.js tkDrive). */
  private drivers: Record<TrackerKind, ReturnType<typeof tkDriver>> = { hands: tkDriver(), face: tkDriver(), pose: tkDriver() };
  /** The Video layer each live feed tracks ('' the camera), so the feed is only told when it changes. */
  private feedVideo: Record<TrackerKind, string> = { hands: '', face: '', pose: '' };
  /** Video layers' elements (play/videoLayers.ts registers itself: it imports this module, not the other way round). */
  private videoHost: { element(layerId: string): HTMLVideoElement | null } | null = null;

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
    if (this.learnMove && this.learnTriggerCb) this.learnPointer(e);
    if (this.mouseIsBound) inputBus.wake();
  };
  /** Learn anything: where the pointer was first seen over the picture since it began (null until then). */
  private learnMove: { from: { x: number; y: number } | null } | null = null;
  /** Learn anything: the pointer moving well across the picture becomes "the pointer moves to the left (right, top, bottom) half". */
  private learnPointer(e: PointerEvent): void {
    const st = this.learnMove!;
    const el = e.target as Element | null;
    if (el?.tagName !== 'CANVAS') return;
    const r = el.getBoundingClientRect();
    if (!st.from) { st.from = { x: e.clientX, y: e.clientY }; return; }
    // As a share of the picture (y up), whatever its size in the window.
    const dx = (e.clientX - st.from.x) / (r.width || 1), dy = (st.from.y - e.clientY) / (r.height || 1);
    if (Math.max(Math.abs(dx), Math.abs(dy)) < LEARN_POINTER_MOVE) return;
    const x = Math.abs(dx) >= Math.abs(dy);
    this.finishLearnTrigger({ on: 'value', value: x ? 'ax:x:pointer' : 'ax:y:pointer', cmp: (x ? dx : dy) > 0 ? 'above' : 'below', threshold: 0.5, unit: 'pct', hysteresis: 0.05, tolerance: 0.01 });
  }
  private onPointerDown = (e: PointerEvent) => {
    // Where it went down (a tap on a touch screen has no move first): a capture on the press reads here.
    this.onPointerMove(e);
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
  private picturePointer: { x: number; y: number } | null = null;
  private pictureReader: ((x: number | null, y: number | null, r: number, ch: 'lum' | 'r' | 'g' | 'b') => number | null) | null = null;
  /** The overlay hands over its layer kit's picture reader (kit.pictureAt): `pic:` values read through it. */
  setPictureReader(fn: typeof this.pictureReader): void {
    this.pictureReader = fn;
  }
  /** The overlay reports where the pointer is on the picture (the `pointer` anchor; `mouse` is the whole window). */
  setPicturePointer(x: number, y: number): void {
    this.picturePointer = { x, y };
    if (this.mouseIsBound) inputBus.wake();
  }
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
    // What every source reads (old mappings and the record's own).
    const srcs = rtSourcesOf(record).filter(x => x.enabled).map(x => x.source);
    this.mouseIsBound = srcs.some(x => x.kind === 'mouse')
      || (record.pairMappings ?? []).some(m => m.enabled && (m.source.kind === 'position' ? m.source.anchor === 'mouse' || m.source.anchor === 'pointer' : m.source.source.kind === 'mouse'))
      || this.allTriggers().some(t => t.on === 'value' && readsMouse(t.value))
      || (record.pairMappings ?? []).some(m => m.enabled && (readsMouse(m.a.when?.value) || readsMouse(m.b.when?.value)));
    this.tiltIsBound = srcs.some(x => x.kind === 'tilt');
    this.gamepadIsBound = srcs.some(x => x.kind === 'gamepad');
    this.handsBound = usesHands(record);
    this.faceBound = usesFace(record);
    this.poseBound = usesPose(record);
    audioReaderBank.setConfig(record.audioReaders);
    handFeed.configure(hdTrackerOptions(record.hands));
    faceFeed.configure(trackerOptionsFor('face', record.face));
    poseFeed.configure(trackerOptionsFor('pose', record.pose));
    this.syncFeedSources();
    this.triggerKeysBound = new Set(this.allTriggers().map(triggerKey));
    this.oscIsBound = srcs.some(x => x.kind === 'osc' || (x.kind === 'trigger' && x.trigger.on === 'osc'))
      || (record.pairMappings ?? []).some(m => m.enabled && m.source.kind === 'value' && (m.source.source.kind === 'osc' || (m.source.source.kind === 'trigger' && m.source.source.trigger.on === 'osc')))
      || (record.actions ?? []).some(a => a.enabled && a.trigger.on === 'osc');
    for (const id of [...this.actionFire.keys()]) if (!(record.actions ?? []).some(a => a.id === id)) this.actionFire.delete(id);
    for (const id of [...this.mappingFire.keys()]) if (!record.mappings.some(m => m.id === id && m.source.kind === 'trigger') && !(record.pairMappings ?? []).some(m => m.id === id)) this.mappingFire.delete(id);
    // A signal that lost its definition (or went) lets go of its key.
    const defined = new Set(this.signalOrder.map(s => s.id));
    for (const id of [...this.sigShape.keys()]) if (!defined.has(id) || !sgShaped(this.signalById.get(id))) this.sigShape.delete(id);
    // Route state (smoothing, delay lines) for routes that are gone.
    { const routes = new Set(rtSourcesOf(record).flatMap(x => x.outputs.flatMap(o => o.routes.map(r => r.id)))); for (const m of [this.rt.smooth, this.rt.lag]) for (const id of [...m.keys()]) if (!routes.has(id)) m.delete(id); }
    for (const [id, on] of [...this.sigLevels]) if (!defined.has(id)) { this.sigLevels.delete(id); this.sigSeen.delete(id); if (on) this.release(signalKey(id)); }
    // A signal that went (or stopped capturing) forgets what it captured.
    for (const id of [...this.sigPayload.keys()]) if (!this.signalById.get(id)?.capture) this.sigPayload.delete(id);
    const condKeys = new Set(this.allTriggers().filter(t => t.on === 'proximity' || t.on === 'value').map(triggerKey));
    for (const [k, st] of [...this.condStates]) if (!condKeys.has(k)) { this.condStates.delete(k); if (st.open) this.release(k); }
    oscClient.setWanted(this.oscIsBound || oscClient.getStatus() === 'connected');
    for (const id of [...this.triggerStates.keys()]) if (!record.mappings.some(m => m.id === id && m.source.kind === 'trigger') && !(record.pairMappings ?? []).some(m => m.id === id && m.source.kind === 'value' && m.source.source.kind === 'trigger')) this.triggerStates.delete(id);
    // Show the new state (a mapping added, removed or disabled) even while the clock is paused.
    inputBus.wake();
    // Increments start over when they are switched off (or stop being increments); an explicit start moves with its field.
    for (const [id, st] of [...this.incStates]) {
      const m = record.mappings.find(x => x.id === id);
      if (!m || !m.enabled || !m.increment) { this.incStates.delete(id); this.incCond.delete(id); this.incFire.delete(id); this.incFire.delete(`${id}:reset`); }
      else if (m.increment.start === 'value') st.start = m.increment.startValue;
    }
    // Drop state for mappings that are gone; keep the rest so a re-label doesn't jump.
    const ids = new Set(record.mappings.map(m => m.id));
    for (const id of [...this.rt.values.keys()]) if (!ids.has(id) && !(record.sources ?? []).some(x => x.id === id)) this.rt.values.delete(id);
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
    // A source's route onto it.
    for (const s of this.record.sources ?? []) if (s.enabled && s.outputs.some(o => o.routes.some(r => r.enabled && r.to === controlId))) return true;
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

  /** What a mapping drives a layer property to right now, without overrides (undefined: not driven). The tape's touch detection reads it. */
  drivenValue(layerId: string, key: string): number | undefined {
    return this.layerLive.get(`${layerId}::${key}`);
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

  /** Multiply layers: each split, full, annihilate and cleared the kit counted sends the layer's matching signal. */
  private multiplySeen = new Map<string, { split: number; full: number; annihilate: number; cleared: number }>();
  private tickMultiplySignals(): void {
    for (const l of this.record.layers) {
      if (l.kind !== 'particles' || l.emit !== 'multiply') continue;
      const split = this.sensors.get(`${l.id}::split`) ?? 0, full = this.sensors.get(`${l.id}::full`) ?? 0;
      const annihilate = this.sensors.get(`${l.id}::annihilate`) ?? 0, cleared = this.sensors.get(`${l.id}::cleared`) ?? 0;
      const last = this.multiplySeen.get(l.id);
      this.multiplySeen.set(l.id, { split, full, annihilate, cleared });
      if (!last) continue;
      if (split > last.split && l.splitSignal) this.emitSignal(l.splitSignal);
      if (full > last.full && l.fullSignal) this.emitSignal(l.fullSignal);
      if (annihilate > last.annihilate && l.annihilateSignal) this.emitSignal(l.annihilateSignal);
      if (cleared > last.cleared && l.clearedSignal) this.emitSignal(l.clearedSignal);
    }
  }

  /**
   * Every particles layer (any Emit mode) and every Agents layer: the kit counts how many were born and
   * how many died, cumulative (`<id>::bornCount` / `<id>::diedCount`; the kit itself reports the delta as
   * the `born` / `died` this-step readings). A rise in either since last tick sends the layer's Born /
   * Died signal — once a tick, however many were involved (a burst of 200 fires once).
   */
  private bornDiedSeen = new Map<string, { born: number; died: number }>();
  private tickBornDiedSignals(): void {
    for (const l of this.record.layers) {
      if (l.kind !== 'particles' && l.kind !== 'agents') continue;
      const born = this.sensors.get(`${l.id}::bornCount`) ?? 0, died = this.sensors.get(`${l.id}::diedCount`) ?? 0;
      const last = this.bornDiedSeen.get(l.id);
      this.bornDiedSeen.set(l.id, { born, died });
      if (!last) continue;
      if (born > last.born && l.bornSignal) this.emitSignal(l.bornSignal);
      if (died > last.died && l.diedSignal) this.emitSignal(l.diedSignal);
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
    const layer = this.layerOf(layerId);
    if (!layer) return null;
    const v = (layer as unknown as Record<string, unknown>)[key];
    return typeof v === 'number' ? v : null;
  }

  /** An audio layer's bands, measured once a frame from its song (or the live input), times its Gain. */
  private audioBands = new Map<string, { frame: number; v: Record<LiveBand, number> }>();
  private audioBand(layerId: string, band: LiveBand): number | null {
    const l = this.layerOf(layerId);
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
    // The pointer on the picture (0..1, y up), as the overlay last saw it over the picture.
    if (ref === 'pointer') return this.picturePointer;
    // Where a particles layer's latest birth, death or annihilation was (reported by the kit).
    const ev = parseEventAnchor(ref);
    if (ev) {
      const x = this.sensors.get(`${ev.layerId}::${ev.event}X`), y = this.sensors.get(`${ev.layerId}::${ev.event}Y`);
      return x !== undefined && y !== undefined && Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
    }
    // A signal's captured position (sig:<id>, or sig:<id>:held only while the signal is true).
    const sa = parseSignalAnchor(ref);
    if (sa) {
      const p = this.sigPayload.get(sa.id);
      return p && typeof p === 'object' && (!sa.held || this.signalLevel(sa.id)) ? p : null;
    }
    if (ref === PAD_ANCHOR) {
      const x = padGrid.read('x', 0, 0), y = padGrid.read('y', 0, 0);
      return x === null || y === null ? null : { x, y };
    }
    const pt = sgScreenPoint(ref);
    if (pt) return pt;
    const hand = parseHandAnchor(ref);
    if (hand) return this.handPoint(hand.side, hand.point);
    const tr = parseTrackAnchor(ref);
    if (tr) return this.trackPoint(tr.kind, tr.point);
    const l = this.layerOf(ref);
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
    const l = this.layerOf(id);
    return l ? { layer: l as unknown as PlayLayer & Record<string, unknown>, value: this.valueOf(l) } : null;
  };

  /**
   * Lookups built once per record (setRecord hands over a new one on every
   * change): the triggers, the enabled actions, and layers and mappings by id.
   * The per-frame ticks read these instead of rebuilding or searching.
   */
  private indexed: PlayRecord | null = null;
  private triggerList: TriggerSpec[] = [];
  private enabledActions: PlayAction[] = [];
  /** Signals with a definition of their own, in dependency order; the ones in a loop (read a frame late). */
  private signalOrder: PlaySignal[] = [];
  private signalById = new Map<string, PlaySignal>();
  private signalWorked = new Set<string>();
  private signalPlan = new Map<string, SgSignalPlanEntry>();
  private levelBuf: boolean[] = [];
  /** Does a signal have level inputs (a trigger, a signal mirrored), so its level is worked out each frame? */
  private hasLevel(id: string): boolean {
    this.index();
    return (this.signalPlan.get(id)?.level.length ?? 0) > 0;
  }
  private linkPlan: SgLinkPlan = sgLinkPlan([]);
  private links: SgLinkState = sgLinkNew();
  /** True while a link's pulse is being sent (it isn't a new start of a loop). */
  private linkArriving = false;
  /** Sent-with-timing signals a link brought this frame (their rise, worked out below, isn't a new start). */
  private linkSent = new Set<string>();
  private sigShape = new Map<string, SgShapeState>();
  private signalCycles = new Set<string>();
  /** Condition and audio triggers, one per key, with their keys worked out. */
  private condTriggers: { t: TriggerSpec; key: string }[] = [];
  private audioTriggers: { t: TriggerSpec; key: string }[] = [];
  private audioKeys = new Set<string>();
  /** Percent conditions' ranges by value path (play/conditionRange.ts). */
  private condRanges: Record<string, [number, number]> = {};
  private layersById = new Map<string, PlayLayer>();
  private mappingsById = new Map<string, PlayMapping>();
  private index(): void {
    if (this.indexed === this.record) return;
    const r = this.record;
    this.indexed = r;
    const out: TriggerSpec[] = [];
    for (const m of r.mappings) if (m.enabled && m.source.kind === 'trigger') out.push(m.source.trigger);
    for (const m of r.mappings) {
      if (!m.enabled || !m.increment) continue;
      if (m.increment.on === 'trigger') out.push(m.increment.trigger);
      if (m.increment.resetOn) out.push({ on: 'signal', signal: m.increment.resetOn });
    }
    for (const a of r.actions ?? []) if (a.enabled) out.push(a.trigger);
    for (const m of r.pairMappings ?? []) if (m.enabled && m.source.kind === 'value' && m.source.source.kind === 'trigger') out.push(m.source.source.trigger);
    // A record's own sources' triggers (a trigger source, a Step's), like mappings'.
    for (const t of rtTriggersOf(r.sources)) out.push(t);
    // Signals as rules (play/kit/signals.js sgSignalPlan): their level inputs (triggers, signals mirrored) and how they combine.
    const sigs = r.signals ?? [];
    const plan = sgSignalPlan(sigs);
    this.signalPlan = new Map(plan.map(p => [p.id, p]));
    // A trigger input listens like any other trigger (its keys bound, its condition ticked); so do the reactions.
    for (const p of plan) for (const x of p.level) if (x.kind === 'trigger') out.push(x.trigger);
    const reactions = sgReactions(sigs);
    for (const a of reactions) if (a.enabled) out.push(a.trigger);
    this.triggerList = out;
    // Signals in the order their levels are worked out: one that mirrors another after it.
    const { order, cyclic } = sgSignalOrder(sgLevelDeps(plan));
    const byId = new Map(sigs.map(s => [s.id, s]));
    // Worked out each frame: level inputs, or timing and chance on a sent one.
    this.signalOrder = order.map(id => byId.get(id)!).filter(s => this.signalPlan.get(s.id)!.level.length > 0 || sgShaped(s));
    this.signalWorked = new Set(this.signalOrder.map(s => s.id));
    // Links between signals (and the rise and fall inputs, which are links read the other way), and the loops they make.
    this.linkPlan = sgLinkPlan(sgPulseLinks(sigs), r.loops);
    // A stopped loop cuts what it had going round.
    for (const l of this.linkPlan.loops) if (!l.running) sgLinkClear(this.links, l.key);
    // Pulses on their way to a signal or round a loop the record no longer has (another setup opened) are dropped.
    const loopKeys = new Set(this.linkPlan.loops.map(l => l.key));
    for (const k of [...this.links.inFlight.keys()]) if (!loopKeys.has(k)) sgLinkClear(this.links, k);
    this.links.q = this.links.q.filter(p => byId.has(p.to) && (!p.loop || loopKeys.has(p.loop)));
    this.signalCycles = cyclic;
    this.signalById = byId;
    const unique = (want: (t: TriggerSpec) => boolean) => {
      const seen = new Set<string>(), list: { t: TriggerSpec; key: string }[] = [];
      for (const t of out) { if (!want(t)) continue; const key = triggerKey(t); if (!seen.has(key)) { seen.add(key); list.push({ t, key }); } }
      return list;
    };
    this.condTriggers = unique(t => t.on === 'proximity' || t.on === 'value');
    this.audioTriggers = unique(t => t.on === 'audio' || t.on === 'reader');
    this.audioKeys = new Set(this.audioTriggers.map(a => a.key));
    this.condRanges = conditionRanges(r);
    // Actions, then signals' reactions (actions on their signal): one runner for both.
    this.enabledActions = [...(r.actions ?? []).filter(a => a.enabled), ...reactions.filter(a => a.enabled)];
    this.layersById = new Map(r.layers.map(l => [l.id, l]));
    this.sources = rtSourcesOf(r);
    this.mappingsById = new Map(r.mappings.map(m => [m.id, m]));
  }
  /** The range a percent condition measures against (null: raw, or the range seen so far). */
  private rangeFor(c: Pick<ValueCondition, 'unit' | 'value'>): [number, number] | null {
    if (c.unit !== 'pct') return null;
    this.index();
    return this.condRanges[c.value] ?? null;
  }
  private layerOf(id: string): PlayLayer | undefined { this.index(); return this.layersById.get(id); }
  private mappingOf(id: string): PlayMapping | undefined { this.index(); return this.mappingsById.get(id); }

  /** Every trigger in the record: mapping triggers and action triggers. */
  private allTriggers(): TriggerSpec[] {
    this.index();
    return this.triggerList;
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
        const m = this.mappingOf(r.id);
        return m ? this.readMapping(m) : null;
      }
      case 'mouse': return r.axis === 'x' ? this.mouseX : this.mouseY;
      case 'distance': return this.anchorGap(r.a, r.b);
      case 'reading': return this.readSource({ kind: 'sensor', layerId: r.layerId, read: r.read as SensorRead, otherId: '' });
      // A source's reading this frame (an old mapping's too, by its id).
      case 'source': return this.sourceValue(r.id);
      case 'axis': { const p = this.anchorAt(r.anchor); return p ? (r.axis === 'x' ? p.x : p.y) : null; }
      case 'picture': {
        // The overlay's layer kit reads last frame's picture (its coarse grid); around a position, a small patch.
        if (!this.pictureReader) return null;
        if (r.region === 'all') return this.pictureReader(null, null, 0, r.ch);
        const p = this.anchorAt(r.region);
        return p ? this.pictureReader(p.x, p.y, PICTURE_PATCH, r.ch) : null;
      }
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

  /** Listen for Reset-mode Spreads' signals: the listener puts their members back to their minimums. */
  onSpreadReset(cb: (spreadId: string) => void): () => void {
    this.spreadResetListeners.add(cb);
    return () => { this.spreadResetListeners.delete(cb); };
  }

  // ── Level signals ─────────────────────────────────────────────────────────

  /** Each defined signal's level (true now); what was sent this frame by an action or a layer (a one-frame level). */
  private sigLevels = new Map<string, boolean>();
  private sigSent = new Set<string>();
  private sigSeen = new Map<string, number>();
  /** What each signal captured (a number, or a position 0..1 with y up): PlaySignal.capture. */
  private sigPayload = new Map<string, number | { x: number; y: number }>();

  /** A signal's captured value (for the editor and Set), or undefined before its first capture. */
  signalPayload(id: string): number | { x: number; y: number } | undefined {
    return this.sigPayload.get(id);
  }

  /** Sample what the signal captures, now. */
  private capture(s: PlaySignal): void {
    const c = s.capture;
    if (!c) return;
    let v: number | { x: number; y: number } | null;
    if (c.what.startsWith(CAPTURE_POS)) { const p = this.anchorAt(c.what.slice(CAPTURE_POS.length)); v = p ? { x: p.x, y: p.y } : null; }
    else v = this.readValue(c.what);
    // Nothing to read (a hand out of view): the last capture stays.
    if (v !== null) this.sigPayload.set(s.id, v);
  }

  /** Is a signal true now: its own definition (and timing), or sent this frame. */
  signalLevel(id: string): boolean {
    this.index();
    return this.signalWorked.has(id) ? this.sigLevels.get(id) ?? false : this.sigSent.has(id);
  }

  /** The loops the links make (members, period, settings), for the Rules page. */
  loops(): readonly SgLoop[] {
    this.index();
    return this.linkPlan.loops;
  }

  /** A loop now: pulses going round and laps done. */
  loopNow(key: string): { inFlight: number; laps: number } {
    return { inFlight: this.links.inFlight.get(key) ?? 0, laps: this.links.laps.get(key) ?? 0 };
  }

  /** Reset a loop: drop what it has going round and start its laps over. */
  resetLoop(key: string): void {
    sgLinkClear(this.links, key);
  }

  /** Is a signal part of a loop of combinations (each reads the others a frame late)? For the editor. */
  signalInLoop(id: string): boolean {
    this.index();
    return this.signalCycles.has(id);
  }

  /**
   * Work out each defined signal's level (play/kit/signals.js sgLogic for
   * combinations), in dependency order: rising presses its key and holds it,
   * falling lets go, so "When a signal fires" fires on the rise, Continuously
   * while it is true and When it stops on the fall. A combination reads what
   * other signals were sent this frame so far and what was sent last frame.
   */
  private tickSignalLevels(): void {
    this.index();
    // Links arriving now: their signals are sent (a loop going round).
    for (const id of sgLinkDue(this.links, this.time)) {
      this.linkArriving = true;
      try { this.emitSignal(id); } finally { this.linkArriving = false; }
    }
    const sent = this.sigSent;
    // A signal worked out here reads its level; any other is true in the frame it was sent.
    const lvl = (i: string) => (this.signalWorked.has(i) ? this.sigLevels.get(i) ?? false : sent.has(i));
    for (const s of this.signalOrder) {
      const p = this.signalPlan.get(s.id)!;
      let level: boolean;
      if (p.level.length) {
        // Each input's level: a trigger true while held or met (a tap for its frame), a signal's own level; then combined.
        const levels = this.levelBuf;
        levels.length = 0;
        for (let i = 0; i < p.level.length; i++) {
          const x = p.level[i];
          if (x.kind === 'signal') { levels.push(lvl(x.signal)); continue; }
          const { presses, gate } = this.triggerInput(x.trigger);
          const k = i ? `${s.id}#${i}` : s.id;
          const seen = this.sigSeen.get(k) ?? presses;
          this.sigSeen.set(k, presses);
          levels.push(gate || presses > seen);
        }
        level = sgLogic(p.op, levels);
      } else {
        // Sent, with timing or chance: what was sent since the last frame.
        level = sent.has(s.id);
      }
      // Hold for, Linger, Chance and Delay (sgShapeStep), on the setup's clock.
      if (sgShaped(s)) {
        let st = this.sigShape.get(s.id);
        if (!st) { st = sgShapeNew(); this.sigShape.set(s.id, st); }
        level = sgShapeStep(st, level, this.time, { hold: s.hold, linger: s.linger, chance: s.chance, delay: s.delay, seed: s.seed ?? seedOf(s.id) });
      }
      const was = this.sigLevels.get(s.id) ?? false;
      this.sigLevels.set(s.id, level);
      // Capture before anything hears the rise, so a Set on it moves in the same frame.
      const at = s.capture?.at;
      if ((at === 'rise' && level && !was) || (at === 'fall' && !level && was) || (at === 'held' && level)) this.capture(s);
      const key = signalKey(s.id);
      if (level && !was) {
        this.press(key);
        this.linkArriving = !this.hasLevel(s.id) && this.linkSent.has(s.id);
        try { this.signalRose(s.id); } finally { this.linkArriving = false; }
      }
      else if (!level && was) { this.release(key); sgLinkFire(this.links, this.linkPlan, s.id, this.time, 'fall', true); }
    }
    // One-frame levels of sent signals last until the next frame's combinations have read them.
    sent.clear();
    this.linkSent.clear();
  }

  /** A signal rose (or was sent): the list flashes, Spreads set to reset hear it, Learn takes it. */
  private signalRose(id: string): void {
    this.signalCount++;
    // Its links send on (a start of its loop, unless a link brought it).
    sgLinkFire(this.links, this.linkPlan, id, this.time, 'rise', !this.linkArriving);
    for (const cb of this.signalListeners) cb(id);
    for (const sp of this.record.spreads ?? []) if (sp.mode === 'reset' && sp.resetOn === id) for (const cb of this.spreadResetListeners) cb(sp.id);
    if (this.learnTriggerCb) this.finishLearnTrigger({ on: 'signal', signal: id });
    else if (this.learnCb) this.finishLearn(signalSource(id));
  }

  /** A signal is sent (by an action, a layer, the Fire button): its "When signal fires" triggers see a press (and its release) at once. */
  private emitSignal(id: string): void {
    this.sigSent.add(id);
    const s = this.signalById.get(id);
    // With timing or chance it goes out when the next frame works it out (tickSignalLevels), not now.
    if (s && !this.hasLevel(id) && sgShaped(s)) { if (this.linkArriving) this.linkSent.add(id); inputBus.wake(); return; }
    // A sent signal captures when it is sent (its one-frame rise).
    if (s?.capture && !this.hasLevel(id)) this.capture(s);
    const key = signalKey(id);
    this.press(key);
    this.release(key);
    this.signalRose(id);
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
  private tickConditionTriggers(dt: number): void {
    this.index();
    for (const { t, key } of this.condTriggers) {
      if (t.on !== 'proximity' && t.on !== 'value') continue;
      this.condCount++;
      const c: ValueCondition = t.on === 'proximity' ? proximityCondition(t) : t;
      let st = this.condStates.get(key);
      if (!st) { st = sgCondNew(); this.condStates.set(key, st); }
      const ev = sgCondStep(st, this.readValue(c.value), c, this.rangeFor(c), dt);
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
  private steppedActions = new Set<string>();
  private tickActions(dt: number): void {
    this.index();
    const actions = this.enabledActions;
    if (!actions.length) return;
    // A chain looks at signal-fired actions again in the same frame: their clocks (Every N, N within T) move once a frame.
    const stepped = this.steppedActions;
    stepped.clear();
    sgRunActions(actions, a => {
      const { presses, gate } = this.triggerInput(a.trigger);
      // A new action starts from "no presses yet"; a beat that jumped (a seek) fires once.
      const { slot, fresh } = this.fireSlot(this.actionFire, a.id, a.trigger, presses, gate);
      // Looked at again in the same frame (a chain's later pass): only new presses count, so Every N and Continuously don't fire twice.
      const again = stepped.has(a.id);
      stepped.add(a.id);
      if (again && presses <= slot.st.seen) return 0;
      return fresh ? 0 : Math.min(4, stepFire(slot.st, a.trigger.fire, presses, gate, again ? 0 : dt, this.time));
    }, a => { for (const cb of this.actionListeners) cb(a); }, id => this.emitSignal(id), this.chainStats);
  }

  // ── Hands ─────────────────────────────────────────────────────────────────

  /**
   * Take in the tracker's newest frame (placed where the Camera layer shows
   * the camera, or where the tracked Video layer shows its video), and let go
   * of hands gone too long. A Video layer that has been analysed is read from
   * its baked track at the video's own time instead (deterministic: takes,
   * offline renders and scrubbing read the same landmarks every time).
   */
  private updateHands(): void {
    const settings = this.record.hands ?? DEFAULT_HANDS;
    const update = (frame: Parameters<typeof hdUpdate>[1]) => {
      const camAspect = frame.w > 0 && frame.h > 0 ? frame.w / frame.h : 16 / 9;
      const place = hdPlacement(this.record, this.layerValueOf, camAspect, this.aspect, settings.mirror, settings.source);
      hdUpdate(this.hands, frame, { picAspect: this.aspect, place, smoothing: settings.smoothing, responsiveness: settings.responsiveness, maxHands: settings.maxHands, swap: settings.swap });
    };
    const baked = this.bakedTrack('hands');
    if (baked) {
      const vt = this.videoTimeOf(baked.layer, baked.track);
      tkDrive(this.drivers.hands, baked.track, vt, () => { this.hands = hdCreate(); }, f => update(tkHandsFrame(f)));
      hdAge(this.hands, vt * 1000);
    } else {
      this.drivers.hands.has = false;
      const { frame, seq } = handFeed.frame();
      if (frame && seq !== this.handSeq) { this.handSeq = seq; update(frame); }
      hdAge(this.hands, typeof performance !== 'undefined' ? performance.now() : Date.now());
    }
    handFeed.setCount(this.hands.count);
  }

  private layerValueOf = (l: PlayLayer, k: string) => this.layerValue(l.id, k, (l as unknown as Record<string, number>)[k]);

  /** Play/videoLayers.ts hands over the Video layers' elements (a free-running video's time, a live-tracked video's frames). */
  setVideoHost(host: { element(layerId: string): HTMLVideoElement | null } | null): void { this.videoHost = host; this.syncFeedSources(); }

  private trackerSettings(kind: TrackerKind): PlayTracker {
    if (kind === 'hands') return this.record.hands ?? DEFAULT_HANDS;
    return (kind === 'face' ? this.record.face : this.record.pose) ?? (kind === 'face' ? DEFAULT_FACE : DEFAULT_POSE);
  }

  /** The Video layer a tracker follows instead of the camera, or null. */
  trackerVideo(kind: TrackerKind): VideoLayer | null {
    const id = this.trackerSettings(kind).source;
    const l = id ? this.layerOf(id) : undefined;
    return l && l.kind === 'video' ? l : null;
  }

  /** The baked track a tracker reads now (its Video layer analysed, for the file it has now, loaded), or null: live. */
  bakedTrack(kind: TrackerKind): { track: TkTrack; layer: VideoLayer } | null {
    const layer = this.trackerVideo(kind);
    if (!layer || !layer.videoId) return null;
    const b = bakeFor(this.trackerSettings(kind).bakes, layer.id, layer.videoId, '');
    const track = b ? bakeTrack(b.bake.key) : null;
    return track && track.kind === kind ? { track, layer } : null;
  }

  /** Where a tracked Video layer is now (s): on the clock (exact in renders), or where its element is when it runs free. */
  private videoTimeOf(layer: VideoLayer, track: TkTrack): number {
    const el = layer.follow ? null : this.videoHost?.element(layer.id);
    return tkVideoTime(layer, this.time, track.duration, el ? el.currentTime : null);
  }

  /** Point each live feed at its Video layer's element (tracking it live, before it is analysed), or back at the camera. */
  private syncFeedSources(): void {
    if (!this.record) return;
    for (const kind of ['hands', 'face', 'pose'] as const) {
      const id = this.trackerVideo(kind)?.id ?? '';
      if (id === this.feedVideo[kind]) continue;
      this.feedVideo[kind] = id;
      trackerFeeds[kind].setVideoSource(id ? () => this.videoHost?.element(id) ?? null : null);
    }
  }

  /** A face or body landmark on the picture (a null following it, an anchor), or null while it is out of view. */
  trackPoint(kind: 'face' | 'pose', point: number): { x: number; y: number } | null {
    return kind === 'face' ? fcPoint(this.face, point) : psPoint(this.pose, point);
  }
  /** Has the face or pose tracker seen anything (a null following it is then lost while nothing is in view)? */
  trackLive(kind: 'face' | 'pose'): boolean { return (kind === 'face' ? this.face : this.pose).live; }
  /** The face or body as the engine sees it now (the overlay draws it from this). */
  trackState(kind: 'face' | 'pose'): TkSubject { return kind === 'face' ? this.face : this.pose; }

  /** Face or pose: its baked track or its feed's newest frame, like updateHands. */
  private updateSubject(kind: 'face' | 'pose'): void {
    const settings = this.trackerSettings(kind);
    const feed = kind === 'face' ? faceFeed : poseFeed;
    const update = (frame: TkFrame) => {
      const camAspect = frame.w > 0 && frame.h > 0 ? frame.w / frame.h : 16 / 9;
      const place = hdPlacement(this.record, this.layerValueOf, camAspect, this.aspect, settings.mirror, settings.source);
      const o = { picAspect: this.aspect, place, smoothing: settings.smoothing, responsiveness: settings.responsiveness };
      if (kind === 'face') fcUpdate(this.face, frame, o); else psUpdate(this.pose, frame, o);
    };
    const reset = () => { if (kind === 'face') this.face = fcCreate(); else this.pose = psCreate(); };
    const baked = this.bakedTrack(kind);
    const st = () => (kind === 'face' ? this.face : this.pose);
    if (baked) {
      const vt = this.videoTimeOf(baked.layer, baked.track);
      tkDrive(this.drivers[kind], baked.track, vt, reset, update);
      tkSubjectAge(st(), vt * 1000);
    } else {
      this.drivers[kind].has = false;
      const { frame, seq } = feed.frame();
      const last = kind === 'face' ? this.faceSeq : this.poseSeq;
      if (frame && seq !== last) { if (kind === 'face') this.faceSeq = seq; else this.poseSeq = seq; update(frame); }
      tkSubjectAge(st(), typeof performance !== 'undefined' ? performance.now() : Date.now());
    }
    feed.setCount(st().present ? 1 : 0);
  }

  /** Face and pose gesture triggers: a press when a gesture starts, the release when it ends. */
  private tickTrackTriggers(): void {
    for (const t of this.allTriggers()) {
      if (t.on !== 'face' && t.on !== 'pose') continue;
      const key = triggerKey(t);
      const on = t.on === 'face' ? fcGate(this.face, t.gesture) : psGate(this.pose, t.gesture);
      const open = this.handGates.has(key);
      if (on && !open) { this.handGates.add(key); this.press(key); }
      else if (!on && open) { this.handGates.delete(key); this.release(key); }
    }
  }

  /** Does a tracker read anything now: bound by the setup, its feed on, or state from before? */
  private trackerActive(kind: 'face' | 'pose'): boolean {
    return kind === 'face' ? this.faceBound || faceFeed.isOn() || this.face.live : this.poseBound || poseFeed.isOn() || this.pose.live;
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
      case 'fn': {
        const { value } = fnEval(source.expr, { t: this.time, b: this.time * FN_BEAT_HZ });
        return Math.max(0, Math.min(1, (value - source.min) / (source.max - source.min)));
      }
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
      case 'captured': {
        // Set: the number the signal took, as it is; after it lets go, stay, go back (nothing written) or go to a value.
        const v = this.sigPayload.get(source.signal);
        if (typeof v !== 'number') return null;
        if (source.release === 'stay' || this.signalLevel(source.signal)) return v;
        return source.release === 'value' ? source.rest ?? 0 : null;
      }
      case 'hand':
        return hdRead(this.hands, source.side, source.read, source.point, source.axis, source.gesture);
      case 'face':
        return fcRead(this.face, source.read, source.point, source.axis, source.gesture);
      case 'pose':
        return psRead(this.pose, source.read, source.point, source.axis, source.gesture);
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
    if (m.increment) {
      // An increment: where it is across its range, 0..1.
      const st = this.incStates.get(m.id);
      if (!st) return null;
      const [lo, hi] = incRange(m.outMin, m.outMax);
      return hi > lo ? clamp01((incFold(st.p, lo, hi, m.increment.limit) - lo) / (hi - lo)) : 0;
    }
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
    else slot.count += Math.min(4, stepFire(slot.st, t.fire, presses, gate, dt, this.time));
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
    this.index();
    for (const { t, key } of this.audioTriggers) {
      if (t.on !== 'audio' && t.on !== 'reader') continue;
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
    if (this.audioGates.size) for (const k of [...this.audioGates]) if (!this.audioKeys.has(k)) { this.audioGates.delete(k); this.release(k); }
  }

  /**
   * A take playing back: live input changes nothing (the take writes every
   * value), and presses made meanwhile don't fire when it ends.
   */
  private muted = false;
  setMuted(on: boolean): void {
    if (on === this.muted) return;
    this.muted = on;
    // The take has every hand-driven value: the trackers rest meanwhile instead of fighting it.
    for (const f of Object.values(trackerFeeds)) f.setPaused(on);
    // Back live: every control gets its slider's value (or its mapping's) again.
    if (!on) for (const id of this.controls.keys()) this.restoreOnce.add(id);
    inputBus.wake();
  }

  /** A take playing back shows its values on the panel's readouts (muted, nothing else writes them). */
  showLive(controlId: string, value: ControlValue): void {
    if (this.muted) this.live.set(controlId, value);
  }

  /** Per-frame counts for the Performance panel (lib/perfStats.ts), kept only while it is open. */
  private condCount = 0;
  private signalCount = 0;
  private chainStats = { depth: 0, tripped: false };

  tickInputs(dt: number, time: number, write: InputWriter): void {
    if (!playPerfOn()) { this.tickInputsInner(dt, time, write, null); return; }
    this.condCount = 0; this.signalCount = 0; this.chainStats.depth = 0; this.chainStats.tripped = false;
    let t = performance.now();
    const lap = (stage: PlayStage) => { const now = performance.now(); recordPlayStage(stage, now - t); t = now; };
    this.tickInputsInner(dt, time, write, lap);
    recordPlayCounts({ conditions: this.condCount, signals: this.signalCount, depth: this.chainStats.depth, guardTripped: this.chainStats.tripped });
  }

  private tickInputsInner(dt: number, time: number, write: InputWriter, lap: ((stage: PlayStage) => void) | null): void {
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
    const faceOn = this.trackerActive('face'), poseOn = this.trackerActive('pose');
    if (faceOn) this.updateSubject('face');
    if (poseOn) this.updateSubject('pose');
    if (faceOn || poseOn) this.tickTrackTriggers();
    if (this.learnCb || this.learnTriggerCb) this.learnAudio();
    this.tickAudioTriggers();
    this.tickZoneTriggers();
    // A clock sent back (rewind): axis swaps start on A again.
    if (time < this.lastTime - 1e-6) {
      for (const st of this.pairState.values()) st.swap = sgSwapNew();
      // Increments start over from their start, so the same timeline steps the same way again.
      for (const [id, st] of this.incStates) { const m = this.mappingOf(id); incReset(st, m ? this.incStart(m) : st.start, true); }
      // Conditions forget the lowest and highest seen (has never reached, percent of the range seen).
      for (const st of this.condStates.values()) sgCondRewind(st);
      for (const st of this.incCond.values()) sgCondRewind(st);
      for (const st of this.pairState.values()) { sgCondRewind(st.condA); sgCondRewind(st.condB); }
      // Captures, rolls and signals on their way are forgotten, so the same timeline plays the same way again.
      this.sigPayload.clear();
      sgLinkClear(this.links);
      for (const st of this.sigShape.values()) sgShapeRewind(st);
      rtRewind(this.rt);
    }
    this.lastTime = time;
    lap?.('inputs');
    this.tickConditionTriggers(dt);
    this.tickRelationshipSignals();
    this.tickMultiplySignals();
    this.tickBornDiedSignals();
    this.tickSignalLevels();
    lap?.('conditions');
    this.tickActions(dt);
    lap?.('actions');
    if (this.learnCb && this.performing) this.pollGamepadLearn();
    // Gamepads are polled, not evented: a stick moving has to draw a frame even while the clock is paused.
    if (this.gamepadIsBound && this.performing) inputBus.wake();
    const driven = new Set<string>();
    this.layerMoved = false;
    this.incMoving = false;
    // Sources and routes (play/kit/routes.js, shared with the web runtime): each source read once, then its routes written.
    this.index();
    this.curWrite = write; this.curDriven = driven;
    rtFrame(this.rt, this.sources, this.rtStepHost, this.rtApplyHost, dt, this.time);
    // Pair mappings, after the plain ones: on a control both drive, the pair's wins.
    this.tickPairs(dt, write, driven);
    // Spreads, last: each member's value so far (a mapping's, else its slider's) plus the group's offset.
    this.tickSpreads(write, driven);
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
    lap?.('mappings');
  }

  // ── Sources and routes: the engine's side of play/kit/routes.js ───────────

  private rt: RtState = rtNew();
  private sources: RtSource[] = [];
  private curWrite: InputWriter = () => {};
  private curDriven = new Set<string>();
  /** A Step output of a record's own source, as the increment code reads it (a mapping's shape: its first route is where it starts from). */
  private stepShapes = new WeakMap<object, PlayMapping>();
  private stepShape(s: RtSource, o: Extract<SourceOutput, { kind: 'step' }>): PlayMapping {
    if (s.fromMapping) return s.fromMapping;
    let m = this.stepShapes.get(o);
    if (!m) {
      const r = o.routes[0];
      m = { id: s.id, controlId: r?.to ?? '', source: s.source, outMin: o.lo, outMax: o.hi, curve: 'linear', smoothMs: 0, enabled: true, increment: o.step, ...(r?.channel !== undefined ? { channel: r.channel } : {}) };
      this.stepShapes.set(o, m);
    }
    return m;
  }
  private rtStepHost: RtStepHost = {
    has: id => this.controls.has(id),
    read: (s, dt) => (s.source.kind === 'trigger' ? this.readTrigger(s.fromMapping ?? ({ id: s.id, source: s.source } as PlayMapping), dt) : this.readSource(s.source)),
    step: (s, o, dt) => this.tickIncrement(this.stepShape(s, o), dt),
  };
  private rtApplyHost: RtApplyHost = {
    kind: id => this.controls.get(id)?.kind ?? 'float',
    base: id => this.base.get(id),
    range: id => { const c = this.controls.get(id); return c ? [c.min, c.max] : [0, 1]; },
    write: (id, route, v) => {
      const control = this.controls.get(id);
      if (!control) return;
      const write = this.curWrite, driven = this.curDriven;
      if (control.kind === 'action') {
        // A button: fires once each time what drives it rises through the middle (a key down, a click, a beat).
        const was = this.actionLevel.get(control.id) ?? 0;
        this.actionLevel.set(control.id, v);
        if (v >= 0.5 && was < 0.5) this.fireControl(control.id);
        this.live.set(control.id, v);
        driven.add(control.id);
        return;
      }
      if (control.kind !== 'color') { this.writePlain(control, v, write, driven); return; }
      // Colour controls start each frame from their base so an unmapped channel keeps the slider's value.
      const buf = this.colourBuffer(control.id, driven.has(control.id));
      if (route?.channel === undefined) {
        // Brightness: scale the base colour.
        const base = this.baseColour(control.id);
        buf[0] = base[0] * v; buf[1] = base[1] * v; buf[2] = base[2] * v;
      } else buf[route.channel] = v;
      write(paramChannelKey(bindingKeyOf(control.target)), buf);
      this.live.set(control.id, buf);
      driven.add(control.id);
    },
  };

  /** A source's reading this frame (0..1; `src:<id>`), or null while it has none. */
  sourceValue(id: string): number | null {
    return this.rt.values.get(id) ?? null;
  }

  /** Where an increment starts: its explicit start, else the control's value now (a colour: its channel, or full brightness). */
  private incStart(m: PlayMapping): number {
    const inc = m.increment;
    if (inc?.start === 'value') return inc.startValue;
    const b = this.base.get(m.controlId);
    if (Array.isArray(b)) return m.channel === undefined ? 1 : b[m.channel] ?? 0;
    if (typeof b === 'number' && Number.isFinite(b)) return b;
    return incRange(m.outMin, m.outMax)[0];
  }

  /** How many times a trigger fires this frame for an increment (its own firing-mode slot under `slotId`). */
  private incFires(slotId: string, t: TriggerSpec, dt: number): number {
    const { presses, gate } = this.triggerInput(t);
    const { slot, fresh } = this.fireSlot(this.incFire, slotId, t, presses, gate);
    return fresh ? 0 : stepFire(slot.st, t.fire, presses, gate, dt, this.time);
  }

  /**
   * One frame of an Increment mapping (play/kit/increment.js): count what
   * fired it (a trigger, a threshold, a repeat), take that many steps, send
   * its step and wrap-back signals, and return the value to write.
   */
  private tickIncrement(m: PlayMapping, dt: number): number {
    const inc = m.increment!;
    const [lo, hi] = incRange(m.outMin, m.outMax);
    let st = this.incStates.get(m.id);
    if (!st) { st = incNew(this.incStart(m)); this.incStates.set(m.id, st); }
    if (inc.resetOn && this.incFires(`${m.id}:reset`, { on: 'signal', signal: inc.resetOn }, dt) > 0) incReset(st, this.incStart(m), false);
    let count = 0;
    if (inc.on === 'trigger') count = this.incFires(m.id, inc.trigger, dt);
    else if (inc.on === 'threshold') count = incThreshold(st, m.source.kind === 'trigger' ? this.readTrigger(m, dt) : this.readSource(m.source), inc);
    else {
      let open = true;
      if (inc.when) {
        let c = this.incCond.get(m.id);
        if (!c) { c = sgCondNew(); this.incCond.set(m.id, c); }
        sgCondStep(c, this.readValue(inc.when.value), inc.when, this.rangeFor(inc.when), dt);
        open = c.open;
      }
      count = incRepeat(st, this.time, inc, open);
    }
    if (count > 0) {
      for (const ev of incAdvance(st, inc, lo, hi, count)) {
        const sig = ev === 'step' ? inc.stepSignal : inc.resetSignal;
        if (sig) this.emitSignal(sig);
      }
    }
    const v = incGlide(st, inc, lo, hi, dt);
    if (incGliding(st)) this.incMoving = true;
    return v;
  }

  /** For the editor: an increment's steps so far (since the last wrap-back, and in all). Null before it has run. */
  incrementNow(mappingId: string): { n: number; count: number } | null {
    const st = this.incStates.get(mappingId);
    return st ? { n: st.n, count: st.count } : null;
  }

  /** Is an increment's repeat condition met now (for the editor)? */
  incrementCondOpen(mappingId: string): boolean {
    return this.incCond.get(mappingId)?.open ?? false;
  }

  /** The editor's Reset: back to the start (the control's value now, or the explicit start), growth and direction too. */
  resetIncrement(mappingId: string): void {
    const st = this.incStates.get(mappingId);
    const m = this.mappingOf(mappingId);
    if (st && m) incReset(st, this.incStart(m), false);
    else this.incStates.delete(mappingId);
    inputBus.wake();
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
      if (m.a.when) { sgCondStep(st.condA, this.readValue(m.a.when.value), m.a.when, this.rangeFor(m.a.when), dt); if (!st.condA.open) useA = false; }
      if (m.b.when) { sgCondStep(st.condB, this.readValue(m.b.when.value), m.b.when, this.rangeFor(m.b.when), dt); if (!st.condB.open) useB = false; }
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

  /**
   * Spreads (docs/spread-control.md, play/kit/spread.js): each member is
   * source → its base → + Amount × curve(its place, rotated by Shift) × its
   * range → clamped to its range. Amount and Shift are the Spread's own
   * controls (a mapping or a take moves them like layer numbers). A member
   * with no offset and nothing driving it is left to its slider.
   */
  private tickSpreads(write: InputWriter, driven: Set<string>): void {
    for (const sp of this.record.spreads ?? []) {
      const n = sp.members.length;
      if (!n) continue;
      const pid = spreadPropId(sp.id);
      const amount = this.layerValue(pid, 'amount', sp.amount);
      const shift = this.layerValue(pid, 'shift', sp.shift);
      for (let i = 0; i < n; i++) {
        const c = this.controls.get(sp.members[i]);
        if (!c || c.kind !== 'float') continue;
        const w = spWeight(i, n, shift, sp.curve, sp.curveY, !!sp.invert);
        const was = driven.has(c.id);
        if (!was && (amount === 0 || w === 0)) continue;
        const b = was ? this.live.get(c.id) : this.base.get(c.id);
        if (typeof b !== 'number') continue;
        this.writePlain(c, spValue(b, c.min, c.max, amount, w), write, driven);
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
      if (m.increment?.on === 'trigger' && m.increment.trigger.on === 'key' && m.increment.trigger.code === code) return true;
    }
    for (const a of this.record.actions ?? []) if (a.enabled && a.trigger.on === 'key' && a.trigger.code === code) return true;
    // A rule's or a level signal's own key, a record source's key.
    for (const s of this.record.signals ?? []) {
      if (s.when?.kind === 'trigger' && s.when.trigger.on === 'key' && s.when.trigger.code === code) return true;
      if (s.inputs?.some(x => x.kind === 'trigger' && x.trigger.on === 'key' && x.trigger.code === code)) return true;
    }
    for (const x of this.record.sources ?? []) {
      if (!x.enabled) continue;
      if (x.source.kind === 'key' && x.source.code === code) return true;
      if (x.source.kind === 'trigger' && x.source.trigger.on === 'key' && x.source.trigger.code === code) return true;
    }
    for (const m of this.record.pairMappings ?? []) {
      const s = m.enabled && m.source.kind === 'value' ? m.source.source : null;
      if (s && ((s.kind === 'key' && s.code === code) || (s.kind === 'trigger' && s.trigger.on === 'key' && s.trigger.code === code))) return true;
    }
    return false;
  }

  /** Actions, layer-property mappings, reader controls and Learn run whatever the shader binds. */
  wantsTick(): boolean {
    // A signal with a definition (its level) or a capture works every frame, even with nothing on it yet.
    return !!this.record.actions?.length || !!this.record.signals?.some(s => s.when || s.capture || sgShaped(s) || !!s.links?.length || !!s.inputs?.length || !!s.do?.length) || this.isLearning() || this.record.mappings.some(m => m.enabled && !!m.increment) || this.allTriggers().some(t => t.on === 'proximity' || t.on === 'value') || !!this.record.pairMappings?.some(m => m.enabled) || !!this.record.spreads?.some(sp => sp.members.length > 0) || this.handsBound || handFeed.isOn() || this.faceBound || this.poseBound || faceFeed.isOn() || poseFeed.isOn() || this.record.controls.some(c => c.kind === 'action' || parsePropTarget(c.target) !== null || parseReaderTarget(c.target) !== null);
  }

  /** Something (a trigger or a noise row) moves on its own, so the render loop must keep drawing. */
  isAnimating(): boolean {
    // A link's pulse on its way (a loop going round).
    if (this.links.q.length) return true;
    // A signal on its way (a delay) or held on (a hold or a linger counting) needs the next frames.
    for (const st of this.sigShape.values()) if (st.q.length || st.onAt >= 0 || st.held) return true;
    // A mapping's delay line still catching up.
    for (const st of this.rt.lag.values()) if (st.t.length > 1 && st.v[st.v.length - 1] !== st.v[0]) return true;
    if ((this.record.actions ?? []).some(a => a.enabled && a.trigger.on === 'beat')) return true;
    // Learning with sound listens every frame.
    if ((this.learnCb || this.learnTriggerCb) && (liveAudio.isOn() || audioReaderBank.live())) return true;
    // Sound that fires actions keeps being listened to.
    if ((this.record.actions ?? []).some(a => a.enabled && ((a.trigger.on === 'audio' && liveAudio.isOn()) || (a.trigger.on === 'reader' && audioReaderBank.live())))) return true;
    // Held, or every N while held: keeps firing without anything else moving.
    if (this.allTriggers().some(t => firesWhileHeld(t.fire) && this.triggerInput(t).gate)) return true;
    // Tracking hands: landmarks arrive about 30 times a second, and smoothing and springs ease between them.
    if (Object.values(trackerFeeds).some(f => f.isOn() && !f.isPaused())) return true;
    // A baked track on a playing Video layer: the landmarks move with the video.
    if ((['hands', 'face', 'pose'] as const).some(k => { const l = this.trackerVideo(k); return !!l && l.playing && (k === 'hands' ? this.handsBound : k === 'face' ? this.faceBound : this.poseBound); })) return true;
    // An axis mid-smoothing keeps drawing until it settles; so does an increment mid-glide, and a repeating one.
    if (this.pairMoving || this.incMoving) return true;
    if (this.record.mappings.some(m => m.enabled && m.increment?.on === 'repeat')) return true;
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

  /**
   * Learn anything (Quick rule, implementation guide 6.2): what startLearnTrigger
   * hears (a key, a note, a click on the picture, OSC, a signal, a sound, a
   * hand gesture), or the pointer moving well across the picture, as a value
   * condition on that axis.
   */
  learnAny(cb: (trigger: TriggerSpec) => void): () => void {
    const cancel = this.startLearnTrigger(cb);
    this.learnMove = { from: null };
    return cancel;
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
    this.learnMove = null;
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
/** Learn anything: how far (a share of the picture) the pointer must travel across it to count. */
const LEARN_POINTER_MOVE = 0.3;

export const playEngine = new PlayEngine();
inputBus.addSource(playEngine);
