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
import { audioEngine } from './audioEngine';
import { oscClient, oscNumber, type OscMessage } from './oscClient';
import { liveAudio } from './liveAudio';
import { beatAt, newTriggerState, noiseAt, stepTrigger, triggerKey, type TriggerState } from '../play/triggers';
import type { TriggerSpec } from '../types/play';
import type { LfoShape, PlayControl, PlayCurve, PlayMapping, PlayRecord, PlaySource } from '../types/play';
import { CURVE_POINTS, emptyPlayRecord, parseLayerTarget } from '../types/play';

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

function isTypingTarget(el: EventTarget | null): boolean {
  const node = el as HTMLElement | null;
  const tag = node?.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !!node?.isContentEditable;
}

interface MappingState {
  /** Smoothed output, in param units. */
  value: number | undefined;
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
    this.controls.clear();
    for (const c of record.controls) this.controls.set(c.id, c);
    this.mouseIsBound = record.mappings.some(m => m.enabled && m.source.kind === 'mouse');
    this.tiltIsBound = record.mappings.some(m => m.enabled && m.source.kind === 'tilt');
    this.gamepadIsBound = record.mappings.some(m => m.enabled && m.source.kind === 'gamepad');
    this.triggerKeysBound = new Set(record.mappings.filter(m => m.enabled && m.source.kind === 'trigger').map(m => triggerKey((m.source as Extract<PlaySource, { kind: 'trigger' }>).trigger)));
    this.oscIsBound = record.mappings.some(m => m.enabled && (m.source.kind === 'osc' || (m.source.kind === 'trigger' && m.source.trigger.on === 'osc')));
    oscClient.setWanted(this.oscIsBound || oscClient.getStatus() === 'connected');
    for (const id of [...this.triggerStates.keys()]) if (!record.mappings.some(m => m.id === id && m.source.kind === 'trigger')) this.triggerStates.delete(id);
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
    return false;
  }

  /** The value written last frame (undefined when the control isn't driven). */
  liveValue(controlId: string): ControlValue | undefined {
    return this.live.get(controlId);
  }

  /** A layer property right now: what a mapping drives it to, else the layer's own value. */
  layerValue(layerId: string, key: string, base: number): number {
    return this.layerLive.get(`${layerId}::${key}`) ?? base;
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

  /**
   * Raw unit reading of a source right now, or null while the source has never
   * produced one (a knob nobody has touched yet): such a mapping leaves its
   * control alone, so opening Play doesn't pin every mapped slider to its range
   * minimum before the performer touches anything.
   */
  readSource(source: PlaySource): number | null {
    switch (source.kind) {
      case 'midi': {
        const ch = midiEngine.channelState(source.channel);
        switch (source.signal) {
          case 'note': return ch.seenNote ? ch.lastNote / 127 : null;
          case 'velocity': return ch.seenNote ? ch.lastVelocity / 127 : null;
          case 'gate': return ch.seenNote ? (ch.heldCount > 0 ? 1 : 0) : null;
          case 'bend': return ch.seenBend ? (ch.bend + 1) / 2 : null;
          case 'cc': { const n = (source.cc ?? 1) & 127; return ch.seenCc[n] ? ch.cc[n] / 127 : null; }
        }
        return null;
      }
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
    let presses: number, gate: boolean, velocity = 1;
    if (t.on === 'beat') {
      const b = beatAt(t.bpm, t.beats, this.time);
      presses = b.count; gate = b.gate;
    } else {
      const key = triggerKey(t);
      presses = this.presses.get(key) ?? 0;
      gate = (this.held.get(key) ?? 0) > 0;
      if (src.velocity) velocity = this.velocities.get(key) ?? 1;
    }
    let st = this.triggerStates.get(m.id);
    // A new mapping starts from "no presses yet", so it doesn't fire for presses made before it existed.
    if (!st) { st = newTriggerState(presses); this.triggerStates.set(m.id, st); }
    return stepTrigger(st, src, presses, gate, dt, velocity);
  }

  /** Audio-hit triggers: a band crossing its threshold is a press; falling below 80% of it releases (hysteresis). */
  private audioGates = new Set<string>();
  private tickAudioTriggers(): void {
    if (!liveAudio.isOn()) return;
    liveAudio.update(this.frame);
    for (const m of this.record.mappings) {
      if (!m.enabled || m.source.kind !== 'trigger' || m.source.trigger.on !== 'audio') continue;
      const t = m.source.trigger;
      const key = triggerKey(t);
      const v = liveAudio.value(t.band) ?? 0;
      const open = this.audioGates.has(key);
      if (!open && v >= t.threshold) { this.audioGates.add(key); this.press(key, v); }
      else if (open && v < t.threshold * 0.8) { this.audioGates.delete(key); this.release(key); }
    }
  }

  tickInputs(dt: number, time: number, write: InputWriter): void {
    this.time = time;
    this.frame++;
    this.tickAudioTriggers();
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
      const layerTarget = parseLayerTarget(control.target);
      if (layerTarget) {
        // A layer property: not a uniform. The overlay reads it after this tick.
        const lk = `${layerTarget.layerId}::${layerTarget.key}`;
        if (this.layerLive.get(lk) !== v) { this.layerLive.set(lk, v); this.layerMoved = true; }
        this.live.set(control.id, v);
        driven.add(control.id);
        continue;
      }
      const key = paramChannelKey(bindingKeyOf(control.target));
      if (control.kind === 'color') {
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
      } else {
        write(key, v);
        this.live.set(control.id, v);
      }
      driven.add(control.id);
    }
    // A control that was driven last frame and isn't now: put the slider's value back once.
    for (const id of this.drivenLastFrame) if (!driven.has(id)) this.restoreOnce.add(id);
    for (const id of this.restoreOnce) {
      if (driven.has(id)) continue;
      const control = this.controls.get(id);
      const base = this.base.get(id);
      const lt = control ? parseLayerTarget(control.target) : null;
      if (lt) {
        this.layerLive.delete(`${lt.layerId}::${lt.key}`);
        this.layerMoved = true;
      } else if (control && base !== undefined) {
        write(paramChannelKey(bindingKeyOf(control.target)), Array.isArray(base) ? [...base] : base);
      }
      this.live.delete(id);
    }
    this.restoreOnce.clear();
    this.drivenLastFrame = driven;
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

  private keyIsBound(code: string): boolean {
    for (const m of this.record.mappings) {
      if (!m.enabled) continue;
      if (m.source.kind === 'key' && m.source.code === code) return true;
      if (m.source.kind === 'trigger' && m.source.trigger.on === 'key' && m.source.trigger.code === code) return true;
    }
    return false;
  }

  /** Something (a trigger or a noise row) moves on its own, so the render loop must keep drawing. */
  isAnimating(): boolean {
    return this.record.mappings.some(m => m.enabled && (
      m.source.kind === 'noise' ||
      ((m.source.kind === 'live' || (m.source.kind === 'trigger' && m.source.trigger.on === 'audio')) && liveAudio.isOn()) ||
      (m.source.kind === 'trigger' && (m.source.trigger.on === 'beat' || (this.triggerStates.get(m.id)?.stage ?? 'idle') !== 'idle'))
    ));
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
