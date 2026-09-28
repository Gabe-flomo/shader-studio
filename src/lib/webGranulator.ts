/**
 * webGranulator.ts — a Granulator rack live in Web Audio (docs/granulator.md),
 * for lib/audioEngineHost.ts: the kit's granulator (an AudioWorklet, else a
 * ScriptProcessor) → the rack's own Sound chain (`rack:<id>`, Finish → Sound)
 * → the rack's volume → an analyser (its spectrum, the readers) and the app's
 * output (the master chain, recordings).
 *
 *   sample     a Library sound (decoded once, remembered for web exports under
 *              `dsample:<id>` like a drum pad's), or a generated one
 *   settings   the slot's params with mappings' driven values, every frame
 *              (only changes cross to the audio thread)
 *   readouts   the grains (count, positions, levels, pitches) as sensors on
 *              `ae:<rackId>`, for mappings (grainSensors)
 */
import { create } from 'zustand';
import { grCreate, grPeaks, grSettings, grSummary, grSynthBuffer, GR_SYNTH_NAMES, type GrLive, type GrPoints, type GrStats } from '../play/kit/granulator.js';
import { AE_INST, GRAIN_EACH, auPropId, grainSensorLayer, type AeGrainSample, type AeSlot } from '../types/playAudioEngine';
import { rackChainId } from '../types/playAudioFx';
import { audioFxHost } from './audioFx';
import { rememberMedia } from './mediaSources';

export type SoundLoader = (id: string) => Promise<{ blob: Blob; type: string; name: string } | null>;
type ValueOf = (id: string, key: string, base: number) => number;

/** What the card shows of a granulator's sample: loading, its waveform, or why not. */
export interface GrainSampleUi {
  key: string;
  status: 'none' | 'loading' | 'ready' | 'missing' | 'error';
  name: string;
  peaks: Float32Array | null;
  duration: number;
}
/** `inside`: how many things of a "Grains from" layer are inside its boundary now, by rack. */
export const useGrainUi = create<{ samples: Record<string, GrainSampleUi>; inside: Record<string, number> }>(() => ({ samples: {}, inside: {} }));

/** A sample's cache key: `synth:<kind>` or the Library id. */
export const grainSampleKey = (s: AeGrainSample | undefined) => (s?.synth ? `synth:${s.synth}` : s?.sampleId ?? '');

/** Decoded samples by key, per context (the offline mix reads them too). */
const decoded = new Map<string, AudioBuffer>();
/** A granulator sample decoded here (null until then): renders use it. */
export function grainBuffer(s: AeGrainSample | undefined): AudioBuffer | null {
  return decoded.get(grainSampleKey(s)) ?? null;
}

export class WebGranulatorRack {
  readonly kind = 'granulator' as const;
  readonly analyser: AnalyserNode;
  private ctx: AudioContext;
  private live: GrLive;
  private vol: GainNode;
  private offOut: () => void;
  private offChain: () => void;
  private sampleKey = '';
  private rackId: string;
  private params: Record<string, number> | undefined;
  private fromOn = false;

  constructor(ctx: AudioContext, connect: (n: AudioNode) => () => void, rackId: string) {
    this.ctx = ctx;
    this.rackId = rackId;
    this.live = grCreate(ctx, { seed: 1 });
    this.vol = ctx.createGain();
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.offChain = audioFxHost.attach(ctx, rackChainId(rackId), this.live.output, this.vol, null);
    this.vol.connect(this.analyser);
    this.offOut = connect(this.vol);
  }

  /** The slot as the record has it now: its sample (loaded when it changed) and its settings. */
  setSlot(slot: AeSlot, load: SoundLoader | null): void {
    this.params = slot.params;
    // No source any more: the things' grains stop.
    if (!slot.from?.source && this.fromOn) { this.live.points({ data: new Float32Array(0), n: 0, cutoff: NaN }); useGrainUi.setState(st => { const inside = { ...st.inside }; delete inside[this.rackId]; return { inside }; }); }
    this.fromOn = !!slot.from?.source;
    const key = grainSampleKey(slot.sample);
    if (key !== this.sampleKey) {
      this.sampleKey = key;
      void this.loadSample(slot.sample, key, load);
    }
    this.update();
  }

  /** Every frame: the settings with what mappings drive them to. */
  update(valueOf?: ValueOf): void {
    const prop = auPropId(this.rackId, AE_INST);
    this.live.set(grSettings(this.params, valueOf ? (a, base) => valueOf(prop, a, base) : undefined));
  }

  private async loadSample(s: AeGrainSample | undefined, key: string, load: SoundLoader | null): Promise<void> {
    const put = (o: Partial<GrainSampleUi>) => useGrainUi.setState(st => {
      const was = st.samples[this.rackId];
      const base: GrainSampleUi = was && was.key === key ? was : { key, status: 'none', name: s?.name ?? '', peaks: null, duration: 0 };
      return { samples: { ...st.samples, [this.rackId]: { ...base, ...o } } };
    });
    if (!key) { this.live.setBuffer(null); put({ status: 'none', peaks: null, name: '', duration: 0 }); return; }
    put({ status: 'loading', name: s?.name ?? '' });
    try {
      let b = decoded.get(key) ?? null;
      if (!b && s?.synth) { b = grSynthBuffer(this.ctx, s.synth); decoded.set(key, b); }
      if (!b && s?.sampleId) {
        const f = load ? await load(s.sampleId) : null;
        if (!f) { if (this.sampleKey === key) put({ status: 'missing' }); return; }
        rememberMedia(`dsample:${s.sampleId}`, 'audio', f.name || s.name || 'sample', f.type, f.blob);
        b = await this.ctx.decodeAudioData(await f.blob.arrayBuffer());
        decoded.set(key, b);
      }
      if (this.sampleKey !== key || !b) return;
      this.live.setBuffer(b);
      put({ status: 'ready', peaks: grPeaks(b.getChannelData(0), 480), duration: b.duration, name: s?.name || (s?.synth ? GR_SYNTH_NAMES[s.synth] ?? s.synth : '') });
    } catch (e) {
      if (this.sampleKey === key) put({ status: 'error', name: e instanceof Error ? e.message : 'This browser couldn’t decode that sound.' });
    }
  }

  setVolume(v: number, mute: boolean): void { this.vol.gain.setTargetAtTime(mute ? 0 : v, this.ctx.currentTime, 0.015); }

  midi(status: number, d1: number, d2: number): void {
    const kind = status & 0xf0;
    if (kind === 0x90 && d2 > 0) this.live.noteOn(d1, d2 / 127);
    else if (kind === 0x80 || kind === 0x90) this.live.noteOff(d1);
    else if (kind === 0xb0 && (d1 === 120 || d1 === 123)) this.live.allOff();
    else if (kind === 0xe0) this.live.bend((((d2 << 7) | d1) - 8192) / 8192 * 2);
  }

  /** "Grains from" a layer: this frame's things as grain points; the count inside shows on the card. */
  points(pts: GrPoints, inside: number): void {
    this.live.points(pts);
    if (useGrainUi.getState().inside[this.rackId] !== inside) useGrainUi.setState(st => ({ inside: { ...st.inside, [this.rackId]: inside } }));
  }

  /** The latest readouts (for drawing the grains on the waveform). */
  stats(): GrStats { return this.live.stats(); }
  /** 'worklet', 'script', or '' while it starts. */
  engineKind(): string { return this.live.kind; }

  /** The readouts as sensors on `ae:<rackId>` (see types/play.ts SensorRead). */
  report(set: (key: string, v: number) => void): void {
    const st = this.live.stats(), sum = grSummary(st), id = grainSensorLayer(this.rackId);
    set(`${id}::grains`, sum.grains);
    set(`${id}::grainMean`, sum.mean);
    set(`${id}::grainSpread`, sum.spread);
    set(`${id}::grainLevel`, sum.level);
    set(`${id}::grainPitch`, sum.pitch);
    for (let i = 0; i < GRAIN_EACH; i++) {
      set(`${id}::grainPos${i + 1}`, i < st.count ? st.pos[i] : 0);
      set(`${id}::grainAmp${i + 1}`, i < st.count ? Math.min(1, st.amp[i]) : 0);
    }
  }

  missing(): string[] { return []; }

  dispose(): void {
    this.live.allOff();
    this.live.dispose();
    this.offChain();
    this.offOut();
    try { this.vol.disconnect(); } catch { /* gone */ }
    useGrainUi.setState(st => { const samples = { ...st.samples }; delete samples[this.rackId]; return { samples }; });
  }
}
