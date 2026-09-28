/**
 * audioEngineHost.ts — runs the Play record's Audio engine (types/
 * playAudioEngine.ts, docs/audio-engine.md).
 *
 * Desktop app (macOS): the racks live in the native engine
 * (src-tauri/src/audio_engine). `frame()` gets the record whenever it may
 * have changed and reconciles: racks made and removed, instruments and
 * effects loaded, moved, bypassed, their presets and parameter values put
 * back, sample player zones filled from the Library's sounds (cached for
 * the engine by id). One reconcile runs at a time; a newer record waits for
 * the one running. Spectrum frames arrive as `audio-engine://frame` events.
 *
 * Browser: a rack whose instrument is the sample player plays in Web Audio
 * (through the app's audio engine, so it's in recordings and the master
 * chain); Audio Unit slots stay silent (desktop only).
 *
 * Granulator racks (docs/granulator.md, lib/webGranulator.ts) play in Web
 * Audio everywhere, the desktop app too: through their own Sound chain
 * (`rack:<id>`), their settings driven by mappings each frame, their grains
 * reported as sensors on `ae:<rackId>`.
 *
 * MIDI: the MIDI engine's messages (hardware, the keyboard stand-in, a MIDI
 * file) go to every rack that hears them (rackHears). Notes pass through the
 * Play overlay as `pad` actions on `ae:<rackId>` so a take records them and
 * plays them back; CC and pitch bend go straight to the rack.
 *
 * Mapped parameters: each frame, every control on an `au:` target reads its
 * driven value (playEngine.layerValue) and a changed one is sent to glide
 * there (the native side smooths). A value set on the card is kept in the
 * record and sent as it is.
 *
 * Sends (`rack.source`): the rack's source is a web sound the page feeds
 * (lib/engineSend.ts) instead of an instrument. Renders and recordings:
 * `renderTake` (a take's racks rendered offline natively) and the recording
 * tap (`tapStart` / `tapStop` / `mux`), see lib/engineRender.ts.
 */
import { create } from 'zustand';
import {
  AE_INST, AE_PAD_BASE_NOTE, RACK_ACT_PREFIX, aeRack, aeSlot, isGranulatorRack, keyboardRack, leadRackId, parseAuTarget, auPropId, rackPlays, unitKey, zoneForNote,
  type AeRack, type AeSlot, type AeZone, type PlayAudioEngine,
} from '../types/playAudioEngine';
import {
  FRAME_EVENT, FRAME_STALE_MS, allNotesOff, decodeFrame, midiEventBytes, paramGlides, parseParamList, soundExt,
  type AuParam, type EngineSpectrum, type NativeFrame,
} from './audioEngineProtocol';
import { engineSound } from './engineSound';
import { engineSend, SEND_CAPACITY } from './engineSend';
import { decodeEngineRender, type EngineRender, type EngineRenderJob, type TapDone } from './engineRender';
import { midiEngine, type MidiEvent } from './midiEngine';
import { isTauri } from './midiTransport';
import { rackKeyboard } from './rackKeyboard';
import { can } from './plan';
import { WebGranulatorRack } from './webGranulator';
import type { GrPoints } from '../play/kit/granulator.js';

type Invoke = <T>(cmd: string, args?: unknown, options?: { headers?: Record<string, string> }) => Promise<T>;
type Listen = <T>(event: string, cb: (e: { payload: T }) => void) => Promise<() => void>;
type ValueOf = (id: string, key: string, base: number) => number;
type Act = (a: { do: 'pad'; layerId: string; amount: number; vel: number }) => void;

export { RACK_ACT_PREFIX } from '../types/playAudioEngine';

export interface EngineStatus {
  /** 'native': the desktop engine; 'web': the browser's sample player only; 'off': nothing to run. */
  mode: 'native' | 'web' | 'off';
  /** The native engine answered (desktop). */
  ready: boolean;
  error: string;
  sampleRate: number;
}

interface EngineUi {
  status: EngineStatus;
  /** `${rack}/${slot}` → why it didn't load. */
  errors: Record<string, string>;
  /** `${rack}/${slot}` → its parameters, once listed. */
  params: Record<string, AuParam[]>;
  /** `${rack}/${slot}` → loading now. */
  loading: Record<string, true>;
  outputs: { id: number; name: string; default: boolean }[];
}

export const useEngineUi = create<EngineUi>(() => ({
  status: { mode: 'off', ready: false, error: '', sampleRate: 48000 },
  errors: {},
  params: {},
  loading: {},
  outputs: [],
}));

const slotKey = (rack: string, slot: string) => `${rack}/${slot}`;

function setError(key: string, msg: string | null): void {
  useEngineUi.setState(s => {
    const errors = { ...s.errors };
    if (msg) errors[key] = msg; else delete errors[key];
    return { errors };
  });
}

function setLoading(key: string, on: boolean): void {
  useEngineUi.setState(s => {
    const loading = { ...s.loading };
    if (on) loading[key] = true; else delete loading[key];
    return { loading };
  });
}

// ── The selected rack card (session state: the lead unless one is locked) ──

export const useEngineSelection = create<{ selected: string; select: (rackId: string) => void }>(set => ({
  selected: '',
  select: rackId => set({ selected: rackId }),
}));

// ── Device settings (this device: output, master volume) ────────────────────

export const ENGINE_PREFS_KEY = 'shader-studio:audio:engine';
export interface EnginePrefs { output: number; volume: number; mute: boolean }
export const DEFAULT_ENGINE_PREFS: EnginePrefs = { output: 0, volume: 1, mute: false };

export function parseEnginePrefs(raw: string | null): EnginePrefs {
  try {
    const o = raw ? JSON.parse(raw) as Record<string, unknown> : null;
    if (!o || typeof o !== 'object') return { ...DEFAULT_ENGINE_PREFS };
    return {
      output: typeof o.output === 'number' && Number.isInteger(o.output) && o.output >= 0 ? o.output : 0,
      volume: typeof o.volume === 'number' && Number.isFinite(o.volume) ? Math.max(0, Math.min(2, o.volume)) : 1,
      mute: o.mute === true,
    };
  } catch { return { ...DEFAULT_ENGINE_PREFS }; }
}

export const useEnginePrefs = create<EnginePrefs & { set: (p: Partial<EnginePrefs>) => void }>((set, get) => ({
  ...(() => { try { return parseEnginePrefs(localStorage.getItem(ENGINE_PREFS_KEY)); } catch { return { ...DEFAULT_ENGINE_PREFS }; } })(),
  set: p => {
    set(p);
    const { output, volume, mute } = get();
    try { localStorage.setItem(ENGINE_PREFS_KEY, JSON.stringify({ output, volume, mute })); } catch { /* preference only */ }
    audioEngineHost.applyPrefs();
  },
}));

// ── What the native engine has (the mirror reconcile diffs against) ─────────

interface NativeSlot {
  id: string;
  /** unitKey, 'sampler', or '' for none. */
  key: string;
  bypass: boolean;
  /** Parameter values sent from the record (address → value). */
  params: Record<string, number>;
  /** The zones it has, as sent (JSON), for the sample player. */
  zones: string;
  /** It failed to load: not tried again until the record changes it (or Retry). */
  failed: boolean;
}

interface NativeRack { inst: NativeSlot | null; effects: NativeSlot[]; volume: number; mute: boolean }

function desiredKey(s: AeSlot | null): string {
  if (!s) return '';
  return s.kind === 'sampler' ? 'sampler' : s.unit ? unitKey(s.unit) : '';
}

// ── The browser's sample player ─────────────────────────────────────────────

type SoundLoader = (id: string) => Promise<{ blob: Blob; type: string; name: string } | null>;

/** A sample player rack in Web Audio: zones' buffers, voices through a gain, an analyser. */
class WebRack {
  readonly kind = 'sampler' as const;
  private ctx: AudioContext;
  private out: GainNode;
  readonly analyser: AnalyserNode;
  private off: () => void;
  private buffers = new Map<string, AudioBuffer | 'loading' | 'error'>();
  private zones: AeZone[] = [];
  private voices = new Map<number, { src: AudioBufferSourceNode; g: GainNode; rate: number }>();
  private bend = 0;
  constructor(ctx: AudioContext, connect: (n: AudioNode) => () => void) {
    this.ctx = ctx;
    this.out = ctx.createGain();
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.out.connect(this.analyser);
    this.off = connect(this.out);
  }
  setZones(zones: AeZone[], load: SoundLoader): void {
    this.zones = zones;
    for (const z of zones) {
      if (this.buffers.has(z.sampleId)) continue;
      this.buffers.set(z.sampleId, 'loading');
      void load(z.sampleId).then(async f => {
        if (!f) { this.buffers.set(z.sampleId, 'error'); return; }
        const b = await this.ctx.decodeAudioData(await f.blob.arrayBuffer());
        this.buffers.set(z.sampleId, b);
      }).catch(() => this.buffers.set(z.sampleId, 'error'));
    }
  }
  missing(): string[] { return this.zones.filter(z => this.buffers.get(z.sampleId) === 'error').map(z => z.sampleId); }
  /** The zones and their decoded sounds (the tape's lane previews render with them). */
  loaded(): { zones: AeZone[]; buffers: Map<string, AudioBuffer> } {
    const buffers = new Map<string, AudioBuffer>();
    for (const [id, b] of this.buffers) if (b instanceof AudioBuffer) buffers.set(id, b);
    return { zones: this.zones, buffers };
  }
  setVolume(v: number, mute: boolean): void { this.out.gain.setTargetAtTime(mute ? 0 : v, this.ctx.currentTime, 0.015); }
  midi(status: number, d1: number, d2: number): void {
    const kind = status & 0xf0;
    if (kind === 0x90 && d2 > 0) this.note(d1, d2);
    else if (kind === 0xb0 && (d1 === 120 || d1 === 123)) { for (const v of this.voices.values()) try { v.src.stop(); } catch { /* ended */ } this.voices.clear(); }
    else if (kind === 0xe0) {
      this.bend = (((d2 << 7) | d1) - 8192) / 8192 * 2;
      for (const v of this.voices.values()) v.src.playbackRate.setTargetAtTime(v.rate * Math.pow(2, this.bend / 12), this.ctx.currentTime, 0.01);
    }
  }
  private note(note: number, vel: number): void {
    const z = zoneForNote(this.zones, note);
    const b = z && this.buffers.get(z.sampleId);
    if (!z || !(b instanceof AudioBuffer)) return;
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    const src = this.ctx.createBufferSource();
    src.buffer = b;
    const rate = Math.max(0.25, Math.min(4, Math.pow(2, (note - z.root) / 12)));
    src.playbackRate.value = rate * Math.pow(2, this.bend / 12);
    const g = this.ctx.createGain();
    g.gain.value = z.gain * (vel / 127);
    src.connect(g).connect(this.out);
    const id = Math.random();
    this.voices.set(id, { src, g, rate });
    src.onended = () => { this.voices.delete(id); g.disconnect(); };
    src.start();
  }
  dispose(): void {
    this.midi(0xb0, 123, 0);
    this.off();
    try { this.out.disconnect(); } catch { /* gone */ }
  }
}

// ── The host ────────────────────────────────────────────────────────────────

class AudioEngineHost {
  private invoke: Invoke | null = null;
  private listen: Listen | null = null;
  private connecting: Promise<boolean> | null = null;
  private unlisten: (() => void) | null = null;
  private target: PlayAudioEngine | undefined;
  private controls: ReadonlyArray<{ target: string }> = [];
  private mirror = new Map<string, NativeRack>();
  private running: Promise<void> | null = null;
  private again = false;
  private spectra = new Map<string, EngineSpectrum>();
  private web = new Map<string, WebRack | WebGranulatorRack>();
  private sensor: ((key: string, value: number) => void) | null = null;
  private webCtx: { ctx: () => AudioContext; connect: (n: AudioNode) => () => void } | null = null;
  private soundLoader: SoundLoader | null = null;
  /** au target → the value last sent from a mapping (so a changed one is sent once). */
  private driven = new Map<string, number>();
  private offMidi: (() => void) | null = null;
  private act: Act | null = null;
  /** Notes sent to each rack and not let go, so a rack removed or re-routed stops cleanly. */
  private held = new Map<string, Set<number>>();

  constructor() {
    engineSound.setHost({ spectrum: id => this.spectrum(id), has: id => this.has(id) });
    // The rack holding the computer keyboard plays through the same door as MIDI (so takes record it).
    rackKeyboard.configure({ send: (rackId, bytes) => this.input(rackId, bytes) });
    // A send's chunks go to the rack's input as raw bytes.
    engineSend.configure({ feed: (rackId, pcm) => { void this.invoke?.('ae_rack_feed', new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength), { headers: { 'x-rack': rackId } }).catch(() => {}); } });
  }

  /** For tests and the browser build: the Tauri bridge, the Web Audio context, the Library's sounds. */
  configure(o: { invoke?: Invoke | null; listen?: Listen | null; webAudio?: AudioEngineHost['webCtx']; sounds?: SoundLoader; act?: Act | null; sensor?: ((key: string, value: number) => void) | null }): void {
    if (o.sensor !== undefined) this.sensor = o.sensor;
    if (o.invoke !== undefined) this.invoke = o.invoke;
    if (o.listen !== undefined) this.listen = o.listen;
    if (o.webAudio !== undefined) this.webCtx = o.webAudio;
    if (o.sounds !== undefined) this.soundLoader = o.sounds;
    if (o.act !== undefined) this.act = o.act;
  }

  /** Is the native engine here (the desktop app)? */
  native(): boolean { return !!this.invoke || isTauri(); }

  private async bridge(): Promise<boolean> {
    if (this.invoke) return true;
    if (!isTauri()) return false;
    this.connecting ??= (async () => {
      try {
        const [{ invoke }, { listen }] = await Promise.all([import('@tauri-apps/api/core'), import('@tauri-apps/api/event')]);
        this.invoke = invoke as Invoke;
        this.listen = listen as Listen;
        return true;
      } catch (e) {
        useEngineUi.setState(s => ({ status: { ...s.status, error: e instanceof Error ? e.message : String(e) } }));
        return false;
      }
    })();
    return this.connecting;
  }

  /** The Tauri invoke, once connected (the Plugins setting rescans with it). */
  async bridgeInvoke(): Promise<Invoke | null> { return (await this.bridge()) ? this.invoke : null; }

  private async startNative(): Promise<boolean> {
    if (!(await this.bridge()) || !this.invoke) return false;
    if (useEngineUi.getState().status.ready) return true;
    try {
      const st = await this.invoke<{ available: boolean; sampleRate: number }>('ae_status');
      if (!st.available) { useEngineUi.setState({ status: { mode: 'off', ready: false, error: 'Audio Units are hosted on macOS only.', sampleRate: st.sampleRate } }); return false; }
      if (!this.unlisten && this.listen) this.unlisten = await this.listen<NativeFrame>(FRAME_EVENT, e => this.onFrame(e.payload));
      useEngineUi.setState({ status: { mode: 'native', ready: true, error: '', sampleRate: st.sampleRate } });
      this.applyPrefs();
      return true;
    } catch (e) {
      useEngineUi.setState(s => ({ status: { ...s.status, ready: false, error: e instanceof Error ? e.message : String(e) } }));
      return false;
    }
  }

  private onFrame(f: NativeFrame): void {
    if (!f || typeof f.rack !== 'string') return;
    const prev = this.spectra.get(f.rack);
    const next = decodeFrame(f, now(), prev);
    if (next) this.spectra.set(f.rack, next);
  }

  /** A rack's latest spectrum (null: silent for a while, or no such rack). */
  spectrum(rackId: string): EngineSpectrum | null {
    const w = this.web.get(rackId);
    if (w) { const s = webSpectrum(w.analyser, rackId); return s.peak > 1e-6 ? s : null; }
    const s = this.spectra.get(rackId);
    return s && now() - s.at < FRAME_STALE_MS ? s : null;
  }

  has(rackId: string): boolean { return this.mirror.has(rackId) || this.web.has(rackId); }

  applyPrefs(): void {
    const p = useEnginePrefs.getState();
    if (!this.invoke || !useEngineUi.getState().status.ready) return;
    void this.invoke('ae_master', { volume: p.volume, mute: p.mute }).catch(() => {});
    void this.invoke('ae_set_output', { device: p.output }).catch(e => setError('engine/output', String(e)));
  }

  async refreshOutputs(): Promise<void> {
    if (!(await this.startNative()) || !this.invoke) return;
    try {
      const raw = await this.invoke<unknown>('ae_outputs');
      const outputs = Array.isArray(raw) ? raw.filter((o): o is { id: number; name: string; default: boolean } => !!o && typeof o.id === 'number' && typeof o.name === 'string').map(o => ({ id: o.id, name: o.name, default: o.default === true })) : [];
      useEngineUi.setState({ outputs });
    } catch { /* keep the old list */ }
  }

  /**
   * The record's engine (the plan's copy: undefined on Free) and its controls,
   * whenever the record may have changed, and every frame with how mappings
   * drive the parameters now.
   */
  frame(ae: PlayAudioEngine | undefined, controls: ReadonlyArray<{ target: string }>, valueOf?: ValueOf): void {
    const on = can('audio.engine') ? ae : undefined;
    if (on !== this.target) {
      this.target = on;
      this.syncMidi();
      const kb = keyboardRack(on);
      rackKeyboard.setTarget(kb?.id ?? '', kb?.name ?? '');
      this.kick();
    }
    this.controls = controls;
    if (valueOf) this.drive(valueOf);
    // Granulators: settings with their mappings, and the grains out as sensors.
    for (const w of this.web.values()) {
      if (w.kind !== 'granulator') continue;
      w.update(valueOf);
      if (this.sensor) w.report(this.sensor);
    }
  }

  /** "Grains from" a layer: this frame's points for a granulator rack (lib/grainFrom.ts), and how many things are inside. */
  granulatorPoints(rackId: string, pts: GrPoints, inside: number): void {
    const w = this.web.get(rackId);
    if (w && w.kind === 'granulator') w.points(pts, inside);
  }

  /** A browser sample player rack's zones and decoded sounds, or null (not running here). */
  webSampler(rackId: string): { zones: AeZone[]; buffers: Map<string, AudioBuffer> } | null {
    const w = this.web.get(rackId);
    return w && w.kind === 'sampler' ? w.loaded() : null;
  }

  /** A granulator rack running here (the card draws its grains), or null. */
  granulator(rackId: string): WebGranulatorRack | null {
    const w = this.web.get(rackId);
    return w && w.kind === 'granulator' ? w : null;
  }

  /** Mapped parameters: send what changed. */
  private drive(valueOf: ValueOf): void {
    if (!this.invoke || !this.target) return;
    const seen = new Set<string>();
    for (const c of this.controls) {
      const t = parseAuTarget(c.target);
      if (!t) continue;
      const rack = aeRack(this.target, t.rackId), slot = aeSlot(rack, t.slotId);
      const nat = this.mirror.get(t.rackId);
      const ns = t.slotId === AE_INST ? nat?.inst : nat?.effects.find(e => e.id === t.slotId);
      if (!slot || slot.kind !== 'au' || !ns || ns.failed) continue;
      seen.add(c.target);
      const v = valueOf(auPropId(t.rackId, t.slotId), t.address, Number.NaN);
      if (Number.isNaN(v)) {
        // Not driven (any more): back to the record's value, once.
        if (this.driven.has(c.target)) {
          this.driven.delete(c.target);
          const base = slot.params?.[t.address];
          if (base !== undefined) this.sendParam(t.rackId, t.slotId, t.address, base, true);
        }
        continue;
      }
      if (this.driven.get(c.target) === v) continue;
      this.driven.set(c.target, v);
      const p = useEngineUi.getState().params[slotKey(t.rackId, t.slotId)]?.find(x => x.address === t.address);
      this.sendParam(t.rackId, t.slotId, t.address, v, p ? paramGlides(p) : true);
    }
    for (const k of this.driven.keys()) if (!seen.has(k)) this.driven.delete(k);
  }

  private sendParam(rack: string, slot: string, address: string, value: number, smooth: boolean): void {
    void this.invoke?.('ae_param_set', { rack, slot, address, value, smooth }).catch(() => {});
  }

  /** Reconcile now, or after the one running. */
  private kick(): void {
    if (this.running) { this.again = true; return; }
    this.running = (async () => {
      do {
        this.again = false;
        try { await this.reconcile(this.target); } catch (e) { console.warn('[audio engine]', e); }
      } while (this.again);
      this.running = null;
    })();
  }

  /** The page's Web Audio arrived (it's wired when the picture first loads): racks reconciled before it get their web instruments now. */
  webAudioReady(): void { if (this.target?.racks.length) this.kick(); }

  /** Wait for reconciling to settle (tests, and the card's Retry). */
  async settled(): Promise<void> { while (this.running) await this.running; }

  /** Try a slot that failed again. */
  retry(rack: string, slot: string): void {
    const n = this.mirror.get(rack);
    if (n) {
      if (slot === AE_INST && n.inst?.failed) n.inst = { ...n.inst, key: '__retry', failed: false };
      n.effects = n.effects.filter(e => !(e.id === slot && e.failed));
    }
    setError(slotKey(rack, slot), null);
    this.kick();
  }

  private async reconcile(ae: PlayAudioEngine | undefined): Promise<void> {
    // Granulators run in Web Audio everywhere; the rest natively where the engine is.
    const all = ae?.racks ?? [];
    const racks = all.filter(r => !isGranulatorRack(r) || !!r.source);
    const grains = all.filter(r => isGranulatorRack(r) && !r.source);
    const wantNative = racks.length > 0 && (await this.startNative());
    if (!wantNative && racks.length && !this.native()) { this.reconcileWeb([...racks, ...grains]); return; }
    this.reconcileWeb(grains);
    const inv = this.invoke;
    if (!inv) return;
    for (const id of [...this.mirror.keys()]) {
      if (racks.some(r => r.id === id)) continue;
      this.releaseHeld(id);
      engineSend.stop(id);
      await inv('ae_rack_remove', { rack: id }).catch(() => {});
      this.mirror.delete(id);
      this.spectra.delete(id);
    }
    if (!wantNative) return;
    useEngineUi.setState(s => (s.status.mode === 'native' ? s : { status: { ...s.status, mode: 'native' } }));
    for (const r of racks) {
      let n = this.mirror.get(r.id);
      if (!n) {
        try { await inv('ae_rack_create', { rack: r.id }); setError(slotKey(r.id, 'rack'), null); }
        catch (e) { setError(slotKey(r.id, 'rack'), String(e)); continue; }
        n = { inst: null, effects: [], volume: 1, mute: false };
        this.mirror.set(r.id, n);
      }
      await this.syncInstrument(inv, r, n);
      await this.syncEffects(inv, r, n);
      if (n.volume !== r.volume || n.mute !== r.mute) {
        await inv('ae_rack_volume', { rack: r.id, volume: r.volume, mute: r.mute }).catch(() => {});
        n.volume = r.volume; n.mute = r.mute;
      }
    }
  }

  private async loadSlotState(inv: Invoke, rack: string, s: AeSlot, n: NativeSlot): Promise<void> {
    if (s.state) await inv('ae_state_set', { rack, slot: s.id, state: s.state }).catch(e => setError(slotKey(rack, s.id), `Its saved settings didn’t load: ${e}`));
    n.params = {};
    await this.syncParams(inv, rack, s, n);
    void this.listParams(rack, s.id);
  }

  private async syncParams(inv: Invoke, rack: string, s: AeSlot, n: NativeSlot): Promise<void> {
    for (const [address, value] of Object.entries(s.params ?? {})) {
      if (n.params[address] === value) continue;
      await inv('ae_param_set', { rack, slot: s.id, address, value, smooth: false }).catch(() => {});
      n.params[address] = value;
    }
  }

  private async syncInstrument(inv: Invoke, r: AeRack, n: NativeRack): Promise<void> {
    if (r.source) { await this.syncSend(inv, r, n); return; }
    if (n.inst?.key.startsWith('input:')) engineSend.stop(r.id);
    const s = r.instrument && (r.instrument.kind === 'sampler' || can('audio.plugins')) ? r.instrument : null;
    const key = desiredKey(s);
    const k = slotKey(r.id, AE_INST);
    if ((n.inst?.key ?? '') !== key) {
      this.releaseHeld(r.id);
      setLoading(k, true);
      try {
        if (!s) await inv('ae_set_instrument', { rack: r.id, unit: null });
        else if (s.kind === 'sampler') await inv('ae_set_sampler', { rack: r.id });
        else await inv('ae_set_instrument', { rack: r.id, unit: { type: s.unit!.type, subtype: s.unit!.subtype, manufacturer: s.unit!.manufacturer } });
        n.inst = s ? { id: AE_INST, key, bypass: false, params: {}, zones: '', failed: false } : null;
        setError(k, null);
        useEngineUi.setState(st => { const params = { ...st.params }; delete params[k]; return { params }; });
        if (s?.kind === 'au') await this.loadSlotState(inv, r.id, s, n.inst!);
      } catch (e) {
        n.inst = { id: AE_INST, key, bypass: false, params: {}, zones: '', failed: true };
        setError(k, String(e));
      } finally { setLoading(k, false); }
    } else if (s && n.inst && !n.inst.failed && s.kind === 'au') {
      await this.syncParams(inv, r.id, s, n.inst);
    }
    if (s?.kind === 'sampler' && n.inst && !n.inst.failed) await this.syncZones(inv, r.id, s.zones ?? [], n.inst);
  }

  /** A send: the rack's source is a web sound the page feeds (engineSend.ts). */
  private async syncSend(inv: Invoke, r: AeRack, n: NativeRack): Promise<void> {
    const source = r.source!;
    const key = `input:${source}`;
    const k = slotKey(r.id, AE_INST);
    if (n.inst?.key === key && !n.inst.failed) return;
    this.releaseHeld(r.id);
    setLoading(k, true);
    try {
      await inv('ae_rack_input', { rack: r.id, capacity: SEND_CAPACITY });
      n.inst = { id: AE_INST, key, bypass: false, params: {}, zones: '', failed: false };
      useEngineUi.setState(st => { const params = { ...st.params }; delete params[k]; return { params }; });
      const wa = this.webCtx ?? defaultWebAudio();
      const why = wa ? await engineSend.start(wa.ctx(), r.id, source, useEngineUi.getState().status.sampleRate) : 'The page’s sound isn’t running yet.';
      setError(k, why);
      if (why) n.inst.failed = true;
    } catch (e) {
      n.inst = { id: AE_INST, key, bypass: false, params: {}, zones: '', failed: true };
      setError(k, String(e));
    } finally { setLoading(k, false); }
  }

  /** How a send's input is doing (frames queued, render cycles that ran dry). */
  async inputStats(rack: string): Promise<{ queued: number; underruns: number } | null> {
    if (!this.invoke) return null;
    try { return await this.invoke<{ queued: number; underruns: number }>('ae_rack_input_stats', { rack }); } catch { return null; }
  }

  private async syncZones(inv: Invoke, rack: string, zones: AeZone[], n: NativeSlot): Promise<void> {
    const want = JSON.stringify(zones);
    if (n.zones === want) return;
    const had: AeZone[] = n.zones ? JSON.parse(n.zones) : [];
    const missing: string[] = [];
    for (let i = 0; i < zones.length; i++) {
      const z = zones[i];
      if (JSON.stringify(had[i]) === JSON.stringify(z)) continue;
      try {
        if (!(await inv<boolean>('ae_sound_has', { id: z.sampleId }))) {
          const f = await this.soundLoader?.(z.sampleId);
          if (!f) { missing.push(z.name); continue; }
          await inv('ae_sound_put', new Uint8Array(await f.blob.arrayBuffer()), { headers: { 'x-sound-id': z.sampleId, 'x-sound-ext': soundExt(f.type, f.name) } });
        }
        await inv('ae_sampler_zone', { rack, index: i, sound: z.sampleId, lo: z.lo, hi: z.hi, root: z.root, gain: z.gain });
      } catch (e) { missing.push(`${z.name} (${e})`); }
    }
    for (let i = zones.length; i < had.length; i++) await inv('ae_sampler_zone', { rack, index: i, sound: null, lo: 0, hi: 0, root: 60, gain: 0 }).catch(() => {});
    n.zones = want;
    setError(slotKey(rack, AE_INST), missing.length ? `Not in this app’s Library: ${missing.join(', ')}. Upload the sound again.` : null);
  }

  private async syncEffects(inv: Invoke, r: AeRack, n: NativeRack): Promise<void> {
    const want = can('audio.plugins') ? r.effects.filter(e => e.kind === 'au' && e.unit) : [];
    // Gone, or a different unit under the same id: out.
    for (const e of [...n.effects]) {
      const w = want.find(x => x.id === e.id);
      if (w && desiredKey(w) === e.key) continue;
      if (!e.failed) await inv('ae_effect_remove', { rack: r.id, slot: e.id }).catch(() => {});
      n.effects = n.effects.filter(x => x !== e);
      setError(slotKey(r.id, e.id), null);
    }
    // New ones in, at their place among the loaded.
    for (const w of want) {
      if (n.effects.some(e => e.id === w.id)) continue;
      const k = slotKey(r.id, w.id);
      const index = n.effects.filter(e => !e.failed).length;
      setLoading(k, true);
      try {
        await inv('ae_effect_insert', { rack: r.id, slot: w.id, index, unit: { type: w.unit!.type, subtype: w.unit!.subtype, manufacturer: w.unit!.manufacturer } });
        const ns: NativeSlot = { id: w.id, key: desiredKey(w), bypass: false, params: {}, zones: '', failed: false };
        n.effects.push(ns);
        setError(k, null);
        await this.loadSlotState(inv, r.id, w, ns);
      } catch (e) {
        n.effects.push({ id: w.id, key: desiredKey(w), bypass: false, params: {}, zones: '', failed: true });
        setError(k, String(e));
      } finally { setLoading(k, false); }
    }
    // Order: the loaded ones as the record has them.
    const order = want.map(w => w.id).filter(id => n.effects.some(e => e.id === id && !e.failed));
    const loaded = () => n.effects.filter(e => !e.failed).map(e => e.id);
    for (let i = 0; i < order.length; i++) {
      if (loaded()[i] === order[i]) continue;
      await inv('ae_effect_move', { rack: r.id, slot: order[i], index: i }).catch(() => {});
      const e = n.effects.find(x => x.id === order[i])!;
      const rest = n.effects.filter(x => x !== e);
      const live = rest.filter(x => !x.failed);
      const before = live[i];
      rest.splice(before ? rest.indexOf(before) : rest.length, 0, e);
      n.effects = rest;
    }
    for (const w of want) {
      const e = n.effects.find(x => x.id === w.id);
      if (!e || e.failed) continue;
      if (e.bypass !== !!w.bypass) { await inv('ae_bypass', { rack: r.id, slot: w.id, bypass: !!w.bypass }).catch(() => {}); e.bypass = !!w.bypass; }
      await this.syncParams(inv, r.id, w, e);
    }
  }

  private reconcileWeb(racks: readonly AeRack[]): void {
    const want = racks.filter(r => !r.source && (r.instrument?.kind === 'sampler' || r.instrument?.kind === 'granulator'));
    for (const [id, w] of this.web) if (!want.some(r => r.id === id && r.instrument?.kind === w.kind)) { this.releaseHeld(id); w.dispose(); this.web.delete(id); }
    if (!want.length) return;
    const wa = this.webCtx ?? defaultWebAudio();
    if (!wa) return;
    if (!this.mirror.size) useEngineUi.setState(s => (s.status.mode === 'web' ? s : { status: { ...s.status, mode: 'web' } }));
    for (const r of want) {
      let w = this.web.get(r.id);
      if (r.instrument!.kind === 'granulator') {
        if (!w) { w = new WebGranulatorRack(wa.ctx(), wa.connect, r.id); this.web.set(r.id, w); }
        (w as WebGranulatorRack).setSlot(r.instrument!, this.soundLoader ?? defaultSounds);
      } else {
        if (!w) { w = new WebRack(wa.ctx(), wa.connect); this.web.set(r.id, w); }
        (w as WebRack).setZones(r.instrument?.zones ?? [], this.soundLoader ?? defaultSounds);
      }
      w.setVolume(r.volume, r.mute);
    }
  }

  /** List a slot's parameters (the card shows them; mappings need their ranges). */
  async listParams(rack: string, slot: string): Promise<AuParam[]> {
    if (!this.invoke) return [];
    try {
      const params = parseParamList(await this.invoke<unknown>('ae_params', { rack, slot }));
      useEngineUi.setState(s => ({ params: { ...s.params, [slotKey(rack, slot)]: params } }));
      return params;
    } catch { return []; }
  }

  /** A slot's parameters as they are now, without touching the card's list (Configure watches the plug-in's window with it). */
  async readParams(rack: string, slot: string): Promise<AuParam[] | null> {
    if (!this.invoke) return null;
    try { return parseParamList(await this.invoke<unknown>('ae_params', { rack, slot })); } catch { return null; }
  }

  /** A slot's whole state, to keep in the record. */
  async slotState(rack: string, slot: string): Promise<string | null> {
    if (!this.invoke) return null;
    return (await this.invoke<string | null>('ae_state_get', { rack, slot }).catch(() => null)) ?? null;
  }

  /** The card moved a parameter: sent at once (the record keeps it too). */
  setParamNow(rack: string, slot: string, address: string, value: number): void {
    const n = this.mirror.get(rack);
    const ns = slot === AE_INST ? n?.inst : n?.effects.find(e => e.id === slot);
    if (ns) ns.params[address] = value;
    this.sendParam(rack, slot, address, value, false);
  }

  async openUi(rack: string, slot: string, title: string): Promise<string | null> {
    if (!this.invoke) return 'The plug-in’s own window opens in the desktop app.';
    try { await this.invoke('ae_open_ui', { rack, slot, title }); return null; } catch (e) { return String(e); }
  }

  // ── Renders and recordings (engineRender.ts) ───────────────────────────────

  /** Can the engine's sound be rendered or recorded here (the desktop engine, running racks)? */
  renders(): boolean { return !!this.invoke && useEngineUi.getState().status.mode === 'native' && this.mirror.size > 0; }

  /**
   * Render a take's racks offline natively (render.rs). `inputs`: the web
   * sounds of sends, interleaved stereo at the job's rate, by rack id. Throws
   * with the engine's reason; null when there's no engine here.
   */
  async renderTake(job: EngineRenderJob, inputs: ReadonlyMap<string, Float32Array> = new Map()): Promise<EngineRender | null> {
    if (!(await this.startNative()) || !this.invoke) return null;
    for (const [rack, pcm] of inputs) await this.invoke('ae_render_input', new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength), { headers: { 'x-rack': rack } });
    const raw = await this.invoke<ArrayBuffer | Uint8Array>('ae_render_take', { job });
    const out = decodeEngineRender(raw);
    if (!out) throw new Error('The engine’s render came back unreadable');
    return out;
  }

  /** Start the recording tap (the engine's sound into a WAV); null when there's no engine here. */
  async tapStart(): Promise<{ path: string; sampleRate: number } | null> {
    if (!this.renders() || !this.invoke) return null;
    return this.invoke<{ path: string; sampleRate: number }>('ae_tap_start');
  }

  async tapStop(): Promise<TapDone | null> {
    if (!this.invoke) return null;
    return this.invoke<TapDone>('ae_tap_stop');
  }

  /** Put the tap's WAV under a saved recording, `offset` seconds later than the picture, mixed with its own sound when `mix`. */
  async mux(video: string, wav: string, offset: number, mix: boolean): Promise<void> {
    if (!this.invoke) throw new Error('No desktop engine');
    await this.invoke('mux_recording_audio', { video, wav, offset, mix });
  }

  async tapDiscard(path: string): Promise<void> {
    await this.invoke?.('ae_tap_discard', { path }).catch(() => {});
  }

  // ── MIDI in ────────────────────────────────────────────────────────────────

  private syncMidi(): void {
    const want = !!this.target?.racks.length;
    if (want && !this.offMidi) this.offMidi = midiEngine.subscribe(e => this.onMidi(e));
    else if (!want && this.offMidi) { this.offMidi(); this.offMidi = null; }
  }

  private onMidi(e: MidiEvent): void {
    if (e.kind === 'devices' || !this.target) return;
    const bytes = midiEventBytes(e);
    if (!bytes) return;
    // Racks with their own routing play what it sends; the rest only while they lead (docs/audio-engine.md, "The lead rack").
    const lead = leadRackId(this.target, useEngineSelection.getState().selected);
    for (const r of this.target.racks) if (rackPlays(r, lead, e.device ?? '', e.channel)) this.input(r.id, bytes);
  }

  /** Listeners for what's played live into racks (the tape records from here; lib/tape.ts). */
  private inputTaps = new Set<(rackId: string, bytes: number[]) => void>();
  onInput(fn: (rackId: string, bytes: number[]) => void): () => void {
    this.inputTaps.add(fn);
    return () => { this.inputTaps.delete(fn); };
  }

  /**
   * A message for a rack from its input (MIDI, the keyboard, the card's keys),
   * or from the tape playing (`fromTape`: not heard by the input taps, so the
   * tape doesn't record itself). Notes go through a take.
   */
  input(rackId: string, bytes: number[], fromTape = false): void {
    if (!fromTape) for (const fn of this.inputTaps) fn(rackId, bytes);
    const kind = bytes[0] & 0xf0;
    if ((kind === 0x90 || kind === 0x80) && this.act) {
      const on = kind === 0x90 && bytes[2] > 0;
      this.act({ do: 'pad', layerId: `${RACK_ACT_PREFIX}${rackId}`, amount: bytes[1] + 1, vel: on ? Math.max(0.01, bytes[2] / 127) : 0 });
      return;
    }
    this.send(rackId, bytes);
  }

  /** A pad action (live, or from a take): a rack's own note, or a drum pad hit a rack follows. */
  onPad(a: { layerId: string; amount: number; vel?: number }): void {
    const vel = a.vel ?? 1;
    if (a.layerId.startsWith(RACK_ACT_PREFIX)) {
      const note = Math.round(a.amount) - 1;
      if (note < 0 || note > 127) return;
      this.send(a.layerId.slice(RACK_ACT_PREFIX.length), vel > 0 ? [0x90, note, Math.max(1, Math.round(vel * 127))] : [0x80, note, 0]);
      return;
    }
    for (const r of this.target?.racks ?? []) {
      if (r.pads !== a.layerId) continue;
      const note = AE_PAD_BASE_NOTE + Math.round(a.amount) - 1;
      this.send(r.id, vel > 0 ? [0x90, note, Math.max(1, Math.round(vel * 127))] : [0x80, note, 0]);
    }
  }

  private send(rackId: string, bytes: number[]): void {
    const kind = bytes[0] & 0xf0;
    const held = this.held.get(rackId) ?? new Set<number>();
    if (kind === 0x90 && bytes[2] > 0) held.add(bytes[1]); else if (kind === 0x80 || kind === 0x90) held.delete(bytes[1]);
    this.held.set(rackId, held);
    const w = this.web.get(rackId);
    if (w) { w.midi(bytes[0], bytes[1] ?? 0, bytes[2] ?? 0); return; }
    if (!this.mirror.has(rackId)) return;
    void this.invoke?.('ae_midi', { rack: rackId, bytes }).catch(() => {});
  }

  /** Let go of every note a rack was sent (its input or instrument changed, it was removed). */
  releaseHeld(rackId: string): void {
    const held = this.held.get(rackId);
    this.held.delete(rackId);
    if (!held?.size) return;
    const w = this.web.get(rackId);
    if (w) { w.midi(0xb0, 123, 0); return; }
    if (this.mirror.has(rackId)) void this.invoke?.('ae_midi', { rack: rackId, bytes: allNotesOff() }).catch(() => {});
  }

  /** For tests: forget everything. */
  resetForTests(): void {
    engineSend.stopAll();
    for (const w of this.web.values()) w.dispose();
    this.web.clear(); this.mirror.clear(); this.spectra.clear(); this.driven.clear(); this.held.clear();
    this.target = undefined; this.controls = []; this.running = null; this.again = false;
    rackKeyboard.setTarget('');
    this.offMidi?.(); this.offMidi = null;
    this.unlisten?.(); this.unlisten = null;
    useEngineUi.setState({ status: { mode: 'off', ready: false, error: '', sampleRate: 48000 }, errors: {}, params: {}, loading: {}, outputs: [] });
  }

  /** For tests: a native frame arriving. */
  frameForTests(f: NativeFrame): void { this.onFrame(f); }
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

const webBufs = new Map<string, EngineSpectrum>();
function webSpectrum(an: AnalyserNode, rackId: string): EngineSpectrum {
  let s = webBufs.get(rackId);
  if (!s || s.freq.length !== an.frequencyBinCount) {
    s = { freq: new Float32Array(an.frequencyBinCount), wave: new Float32Array(an.fftSize), sampleRate: an.context.sampleRate, rms: 0, peak: 0, at: 0 };
    webBufs.set(rackId, s);
  }
  const t = now();
  if (t - s.at > 8) {
    s.at = t;
    an.getFloatFrequencyData(s.freq as Float32Array<ArrayBuffer>);
    an.getFloatTimeDomainData(s.wave as Float32Array<ArrayBuffer>);
    let sum = 0, peak = 0;
    for (const v of s.wave) { sum += v * v; peak = Math.max(peak, Math.abs(v)); }
    s.rms = Math.sqrt(sum / Math.max(1, s.wave.length)); s.peak = peak;
  }
  return s;
}

let webAudioImpl: AudioEngineHost['webCtx'] = null;
/** The browser sample player plays through the app's audio engine (the master chain, recordings). Set by the app. */
export function setEngineWebAudio(w: NonNullable<AudioEngineHost['webCtx']>): void { webAudioImpl = w; audioEngineHost.webAudioReady(); }
function defaultWebAudio() { return webAudioImpl; }

let soundsImpl: SoundLoader | null = null;
export function setEngineSounds(s: SoundLoader): void { soundsImpl = s; audioEngineHost.configure({ sounds: s }); }
const defaultSounds: SoundLoader = id => soundsImpl ? soundsImpl(id) : Promise.resolve(null);

export const audioEngineHost = new AudioEngineHost();
