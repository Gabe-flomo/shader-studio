/**
 * drumPads.ts — the app's host for Sampler layers (types/playLayers.ts
 * SamplerLayer; docs/sampler.md; the Drum pads layer before it). Module
 * singleton, no React.
 *
 *   Samples   each pad and zone names a sample in the media library
 *             (IndexedDB, the videos store: lib/backgroundLibrary.ts) or a
 *             generated drum; decoded once per sample in the audio engine's
 *             context. A sample the library doesn't have is "missing": the
 *             editor asks for it.
 *   Sound     per layer: the Sampler's engine (play/kit/sampler.js) → its
 *             effect chain (`layer:<id>`, lib/audioFx.ts) → the layer's
 *             volume → the audio engine's mix (the master chain, the speakers
 *             and the record bus). An analyser on the chain is what readers
 *             hear (`pads:<id>`, lib/padSound.ts).
 *   Hits      clicks, keys, MIDI notes, the pad grid and actions all become a
 *             `pad` action (pad N = note (base + N − 1) mod 128) through the
 *             overlay, so takes record them, stamped with the clock time they
 *             landed and the sound they picked (`slot`); the overlay hands
 *             them, live or from a take, to `play`, which schedules every
 *             voice on the AudioContext clock.
 *   Export    each sample is remembered for web exports (lib/mediaSources.ts,
 *             key `dsample:<sampleId>`).
 */
import type { PlayRecord } from '../types/play';
import { padHasSound, type DrumPad, type SamplerLayer, type SamplerZone } from '../types/playLayers';
import { addVideoFile, getVideo, videoMimeOf } from '../lib/backgroundLibrary';
import { audioEngine } from '../lib/audioEngine';
import { audioFxHost } from '../lib/audioFx';
import { layerChainId } from '../types/playAudioFx';
import { mediaSource, rememberMedia } from '../lib/mediaSources';
import { isTypingTarget, playEngine } from '../lib/playEngine';
import { keyboardClaimed } from '../lib/keyboardClaim';
import { midiEngine } from '../lib/midiEngine';
import { padGrid } from '../lib/padGrid';
import { padSound, type PadSoundState } from '../lib/padSound';
import { can } from '../lib/plan';
import { kmLayoutOf, kmPadOf } from './kit/midi.js';
import { audioAccept } from '../lib/audioAccept';
import { isLinkedRef } from '../files/linkedRefs';
import { onLinkedChange } from '../files/linkedFolders';
import { dpKey, dpPadOfCell, dpPadOfKey, dpPeaks, dpSynthBuffer } from './kit/drumPads.js';
import {
  SM_DRUM_VOICES, SM_PADS, SM_PIANO_KEYS, smCreateSampler, smHits, smKeyProp, smNumbers, smPadOfNote, smPianoOffset, type SmSampler,
} from './kit/sampler.js';

/** What the editor shows about a pad's (or zone's) sample. */
export type PadStatus = 'empty' | 'loading' | 'ready' | 'missing' | 'error';

export interface PadAction { do: 'pad'; layerId: string; amount: number; vel?: number; at?: number; /** The pad (Drum view) or zone (Keys view, round robin / random) whose sound played, 1-based. */ slot?: number }

/** A pad's or a zone's sound: a library sample or a generated drum. */
export type SoundRef = Pick<DrumPad, 'sampleId' | 'synth' | 'fileName'>;

interface Sample { status: PadStatus; buffer: AudioBuffer | null; error: string; peaks: Float32Array | null }
interface Kit { ctx: AudioContext; sampler: SmSampler; analyser: AnalyserNode; out: GainNode; vol: number; voices: number; dispose: () => void }

/** A sound's sample key: its library id, or `synth:<kind>` for a generated drum. */
export const sampleKey = (p: Partial<SoundRef> | undefined | null): string => (!p ? '' : p.sampleId ? p.sampleId : p.synth ? `synth:${p.synth}` : '');
export const sampleMediaKey = (sampleId: string) => `dsample:${sampleId}`;

/** Audio files a pad or zone takes. */
export const SAMPLE_ACCEPT = audioAccept();
export { isAudioFile } from '../lib/audioAccept';

/** Every sound a Sampler layer names (its pads' and zones'). */
export const layerSounds = (l: SamplerLayer): SoundRef[] => [...l.pads.filter(padHasSound), ...l.zones.filter(padHasSound)];

class PlayDrumPads {
  private layers: SamplerLayer[] = [];
  private samples = new Map<string, Sample>();
  /** Files picked this session, used straight away (and the only copy of a `session:` one). */
  private blobs = new Map<string, Blob>();
  private kits = new Map<string, Kit>();
  private listeners = new Set<() => void>();
  /** layerId:pad → when it was last hit (performance.now) and how hard, for the editor's lights. */
  private lit = new Map<string, { at: number; vel: number }>();
  private clock = { time: 0, wall: 0, playing: false };
  private actor: ((a: PadAction) => void) | null = null;
  /** Per layer: hits so far (the random picks and round robin draw from it) and the last note's pitch (glide). */
  private states = new Map<string, { hits: number; lastPitch: number | null }>();
  private heldKeys = new Map<string, { pad: number; layers: string[] }>();
  /** Keys view: the computer keyboard's octave shift per layer (Z / X), on top of the layer's octave. */
  private octaveShift = new Map<string, number>();

  constructor() {
    padSound.setHost({ analyser: id => this.analyser(id), state: id => this.soundState(id), buffer: p => this.buffer(p) });
    // A sample from a linked folder that changed on disk plays the new one; one that came back (folder plugged in, allowed again) loads.
    onLinkedChange(refs => {
      for (const [key, s] of [...this.samples]) {
        if (!isLinkedRef(key) || (refs ? !refs.includes(key) : s.status === 'ready' || s.status === 'loading')) continue;
        this.samples.delete(key);
        void this.load(key, { sampleId: key, synth: '', fileName: '' });
      }
    });
    if (typeof window === 'undefined') return;
    window.addEventListener('keydown', this.onKeyDown, true);
    window.addEventListener('keyup', this.onKeyUp, true);
    midiEngine.subscribe(e => {
      if (e.kind !== 'noteOn' && e.kind !== 'noteOff') return;
      for (const l of this.layers) {
        if (!l.visible || !l.midi || (l.channel && l.channel !== e.channel)) continue;
        if (l.grid && this.gridClaims(e.note, e.channel, e.device ?? '')) continue;
        const pad = smPadOfNote(e.note, l.baseNote);
        if (e.kind === 'noteOn') this.trigger(l.id, pad, e.velocity / 127); else this.letGo(l.id, pad);
      }
    });
    midiEngine.subscribeRaw((status, d1, d2, device) => {
      const type = status & 0xf0;
      if (type !== 0x90 && type !== 0x80) return;
      const pg = padGrid.config();
      if (!pg || !this.gridClaims(d1, (status & 0x0f) + 1, device)) return;
      const cell = kmPadOf(kmLayoutOf(pg), d1);
      if (cell) this.gridHit(cell.col, cell.row, type === 0x90 ? d2 / 127 : 0);
    });
    padGrid.onPress((col, row, vel) => this.gridHit(col, row, vel));
  }

  /** The overlay sends hits through itself (takes record them), and hands them back to `play`. */
  setActor(fn: ((a: PadAction) => void) | null): void { this.actor = fn; }

  subscribe = (fn: () => void): (() => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  private emit(): void { for (const fn of this.listeners) fn(); }

  /** The setup that plays changed: load new samples, let go of layers that left. */
  setRecord(record: Pick<PlayRecord, 'layers'>): void {
    this.layers = can('play.layers') ? record.layers.filter((l): l is SamplerLayer => l.kind === 'sampler') : [];
    for (const [id, k] of this.kits) if (!this.layers.some(l => l.id === id)) { k.dispose(); this.kits.delete(id); }
    for (const l of this.layers) {
      for (const p of layerSounds(l)) {
        const key = sampleKey(p);
        if (key && !this.samples.has(key)) void this.load(key, p);
      }
    }
  }

  // ── Samples ────────────────────────────────────────────────────────────────

  private context(): AudioContext | null {
    if (typeof window === 'undefined' || !(window.AudioContext || (window as unknown as { webkitAudioContext?: unknown }).webkitAudioContext)) return null;
    return audioEngine.context();
  }

  private async load(key: string, p: SoundRef): Promise<void> {
    const s: Sample = { status: 'loading', buffer: null, error: '', peaks: null };
    this.samples.set(key, s);
    this.emit();
    const ctx = this.context();
    try {
      if (!ctx) throw new Error('No Web Audio here');
      if (key.startsWith('synth:')) s.buffer = dpSynthBuffer(ctx, key.slice(6));
      else {
        let blob = this.blobs.get(key) ?? null;
        let name = p.fileName;
        if (!blob && !key.startsWith('session:')) { const v = await getVideo(key); if (v) { blob = v.blob; name = name || v.name; } }
        if (!blob) { s.status = 'missing'; this.emit(); return; }
        rememberMedia(sampleMediaKey(key), 'audio', name || 'sample', blob.type || videoMimeOf(name), blob);
        s.buffer = await ctx.decodeAudioData(await blob.arrayBuffer());
      }
      s.peaks = dpPeaks(s.buffer.getChannelData(0), 240);
      s.status = 'ready';
    } catch (e) {
      s.status = 'error';
      s.error = e instanceof Error && e.message ? e.message : 'This browser couldn’t decode that sound.';
    }
    if (this.samples.get(key) === s) this.emit();
  }

  /**
   * Keep a picked file in the library and return what the pad records. When
   * the library can't take it, it plays for this session only (`session:` id).
   * Rejects when the browser can't decode it.
   */
  async pick(file: File): Promise<{ sampleId: string; fileName: string; bytes: number; kept: boolean }> {
    const fileName = file.name.slice(0, 120) || 'Sample';
    const typed = file.type ? file : new File([file], fileName, { type: videoMimeOf(fileName) || 'audio/wav' });
    let sampleId = '', kept = true;
    try { sampleId = (await addVideoFile(typed, { name: fileName })).id; } catch { sampleId = `session:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`; kept = false; }
    this.blobs.set(sampleId, typed);
    this.samples.delete(sampleId);
    await this.load(sampleId, { sampleId, synth: '', fileName });
    const s = this.samples.get(sampleId);
    if (s?.status !== 'ready') throw new Error(s?.error || 'Couldn’t open that sound.');
    return { sampleId, fileName, bytes: file.size, kept };
  }

  /**
   * Use a file from a linked folder (docs/linked-folders.md): nothing is copied
   * into the library, the pad names it by its `linked:` reference. Rejects when
   * it can't be read or decoded.
   */
  async useLinked(ref: string, fileName: string, bytes: number): Promise<{ sampleId: string; fileName: string; bytes: number }> {
    this.samples.delete(ref);
    await this.load(ref, { sampleId: ref, synth: '', fileName });
    const s = this.samples.get(ref);
    if (s?.status !== 'ready') throw new Error(s?.error || (s?.status === 'missing' ? 'That file couldn’t be read from its folder.' : 'Couldn’t open that sound.'));
    return { sampleId: ref, fileName: fileName.slice(0, 120), bytes };
  }

  status(p: Partial<SoundRef> | undefined): PadStatus { const k = sampleKey(p); return k ? this.samples.get(k)?.status ?? 'loading' : 'empty'; }
  errorText(p: Partial<SoundRef> | undefined): string { return this.samples.get(sampleKey(p))?.error ?? ''; }
  peaks(p: Partial<SoundRef> | undefined): Float32Array | null { return this.samples.get(sampleKey(p))?.peaks ?? null; }
  duration(p: Partial<SoundRef> | undefined): number { return this.samples.get(sampleKey(p))?.buffer?.duration ?? 0; }
  /** The decoded sample (offline mixes play it; the editor draws it). */
  buffer(p: Partial<SoundRef> | undefined | null): AudioBuffer | null { return this.samples.get(sampleKey(p))?.buffer ?? null; }
  /** A sample's file as a data URL for a web export (null: too big, or not open here). */
  exportSource(p: SoundRef & { bytes: number }): { src: string | null; bytes: number } {
    if (!p.sampleId) return { src: null, bytes: 0 };
    const m = mediaSource(sampleMediaKey(p.sampleId));
    return { src: m?.dataUrl ?? null, bytes: m?.dataUrl?.length ?? (m?.tooBig ? m.bytes : p.bytes) };
  }

  // ── Sound ──────────────────────────────────────────────────────────────────

  private volumeOf(l: SamplerLayer): number { return Math.max(0, playEngine.layerValue(l.id, 'volume', l.volume)); }
  private voicesOf(l: SamplerLayer): number { return l.view === 'keys' ? l.inst.voices : SM_DRUM_VOICES; }

  private kit(l: SamplerLayer): Kit | null {
    const had = this.kits.get(l.id);
    if (had) {
      const v = this.voicesOf(l);
      if (v !== had.voices) { had.voices = v; had.sampler.setVoices(v); }
      return had;
    }
    const ctx = this.context();
    if (!ctx) return null;
    const voices = this.voicesOf(l);
    const sampler = smCreateSampler(ctx, { voices });
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.8;
    const out = ctx.createGain();
    const vol = this.volumeOf(l);
    out.gain.value = vol;
    // sampler → its chain → the volume → the mix; the readers tap the chain.
    const unplug = audioFxHost.attach(ctx, layerChainId(l.id), sampler.output, out, analyser);
    const off = audioEngine.connectOutside(out);
    const k: Kit = { ctx, sampler, analyser, out, vol, voices, dispose: () => { sampler.stopAll(); unplug(); off(); } };
    this.kits.set(l.id, k);
    return k;
  }

  /** The graph clock now, between frames (a hit is stamped with it). */
  clockNow(): number {
    const c = this.clock;
    return c.playing && c.wall ? c.time + Math.min(0.25, (performance.now() - c.wall) / 1000) : c.time;
  }

  /** Once a frame: the clock, and mapped numbers on sounding voices (only what changed reaches them). */
  follow(time: number, playing: boolean): void {
    this.clock.time = time;
    this.clock.playing = playing;
    this.clock.wall = typeof performance !== 'undefined' ? performance.now() : 0;
    for (const l of this.layers) {
      const k = this.kits.get(l.id);
      if (!k) continue;
      const vol = this.volumeOf(l);
      if (vol !== k.vol) { k.vol = vol; k.out.gain.setTargetAtTime(vol, k.ctx.currentTime, 0.015); }
      if (!k.sampler.playing()) continue;
      if (l.view === 'keys') {
        // The instrument's filter and LFO move with their mappings; pitch and level stay each zone's.
        const o = { cutoff: this.num(l, smKeyProp('cutoff')), lfoAmt: this.num(l, smKeyProp('lfoAmt')) };
        for (let i = 0; i < SM_PADS; i++) if (k.sampler.playing(i)) k.sampler.setLive(i, o);
        continue;
      }
      for (let i = 0; i < l.pads.length; i++) {
        if (!k.sampler.playing(i)) continue;
        k.sampler.setLive(i, smNumbers(key => this.num(l, dpKey(i, key))));
      }
    }
  }

  private num(l: SamplerLayer, key: string): number | undefined {
    const v = playEngine.layerValue(l.id, key, (l as unknown as Record<string, number>)[key]);
    return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
  }

  private stateOf(id: string) {
    let s = this.states.get(id);
    if (!s) { s = { hits: 0, lastPitch: null }; this.states.set(id, s); }
    return s;
  }

  /** Hit a pad (0-based; in the Keys view, the note's pad) with velocity 0..1: recorded in a take when one is recording. */
  trigger(layerId: string, pad: number, vel = 1): void {
    const l = this.layers.find(x => x.id === layerId);
    const v = Math.max(0.01, Math.min(1, vel));
    // Pick now (the Sample index, round robin, random), so the take records what played.
    const slot = l ? this.pickSlot(l, pad, v) : 0;
    const a: PadAction = { do: 'pad', layerId, amount: pad + 1, vel: v, at: this.clockNow(), ...(slot ? { slot } : {}) };
    if (this.actor) this.actor(a); else this.play(a);
  }

  /** What a hit on `pad` picks (1-based pad or zone; 0 when nothing to pick): counts the hit. */
  pickSlot(l: SamplerLayer, pad: number, vel = 1): number {
    const DRY = {} as AudioBuffer;
    return smHits(l, pad, vel, { num: k => this.num(l, k), buffer: () => DRY, state: this.stateOf(l.id), dry: true }).slot;
  }

  /** Let a pad go: a Classic pad, or any note of the Keys view (one-shots ignore it). */
  letGo(layerId: string, pad: number): void {
    const l = this.layers.find(x => x.id === layerId);
    if (!l) return;
    if (l.view === 'keys' ? l.inst.mode === 'oneshot' || (l.inst.mode === 'slice' && !l.inst.sliceGate) : l.pads[pad]?.mode !== 'gate') return;
    const a: PadAction = { do: 'pad', layerId, amount: pad + 1, vel: 0, at: this.clockNow() };
    if (this.actor) this.actor(a); else this.play(a);
  }

  /** A hit (live, or from a take playing back): every voice it starts, on the AudioContext clock now. */
  play(a: { layerId: string; amount: number; vel?: number; slot?: number }): void {
    const l = this.layers.find(x => x.id === a.layerId);
    const pad = Math.round(a.amount) - 1;
    if (!l || !l.visible || pad < 0 || pad >= SM_PADS) return;
    const k = this.kit(l);
    if (!k) return;
    if (k.ctx.state === 'suspended') void k.ctx.resume();
    const vel = a.vel ?? 1;
    if (vel <= 0) { k.sampler.release(pad); return; }
    this.lit.set(`${l.id}:${pad}`, { at: performance.now(), vel });
    this.emit();
    const hits = smHits(l, pad, vel, { num: key => this.num(l, key), buffer: s => this.buffer(s as SoundRef), state: this.stateOf(l.id) }, a.slot);
    for (const h of hits.voices) k.sampler.hit(h.group, h.o);
  }

  /** When a pad was last hit (performance.now) and how hard, for the editor; null before any. */
  lastHit(layerId: string, pad: number): { at: number; vel: number } | null { return this.lit.get(`${layerId}:${pad}`) ?? null; }

  /** Everything sounding stops (the editor's Stop), with the short fade. */
  stopAll(layerId: string): void { this.kits.get(layerId)?.sampler.stopAll(); }

  /** Keys view: the computer keyboard's octave now (the layer's plus Z / X). */
  octave(l: Pick<SamplerLayer, 'id' | 'octave'>): number { return Math.max(-2, Math.min(8, l.octave + (this.octaveShift.get(l.id) ?? 0))); }
  shiftOctave(layerId: string, by: number): void {
    const l = this.layers.find(x => x.id === layerId);
    if (!l) return;
    const next = Math.max(-2 - l.octave, Math.min(8 - l.octave, (this.octaveShift.get(layerId) ?? 0) + by));
    this.octaveShift.set(layerId, next);
    this.emit();
  }

  analyser(layerId: string): AnalyserNode | null {
    const l = this.layers.find(x => x.id === layerId);
    return l ? this.kit(l)?.analyser ?? null : null;
  }

  soundState(layerId: string): PadSoundState {
    const l = this.layers.find(x => x.id === layerId);
    if (!l) return 'gone';
    if (!l.visible) return 'off';
    if (!layerSounds(l).some(p => this.status(p) === 'ready')) return 'no-file';
    return this.kits.get(l.id)?.sampler.playing() ? 'playing' : 'paused';
  }

  // ── Keys, MIDI, the pad grid ───────────────────────────────────────────────

  private keysOn(): boolean { return playEngine.isPerforming() && !playEngine.isLearning(); }

  /** The pad a computer key plays on a layer, or -1: the Drum view's window, or the Keys view's piano. */
  padOfKey(l: SamplerLayer, code: string): number {
    if (l.view === 'keys') {
      const off = smPianoOffset(code);
      if (off < 0) return -1;
      const note = (this.octave(l) + 2) * 12 + off;
      return note >= 0 && note <= 127 ? smPadOfNote(note, l.baseNote) : -1;
    }
    const i = dpPadOfKey(code);
    return i < 0 ? -1 : smPadOfNote(l.bank + i, l.baseNote);
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.metaKey || e.ctrlKey || e.altKey || e.repeat || isTypingTarget(e.target) || !this.keysOn() || keyboardClaimed(e)) return;
    const hitLayers: string[] = [];
    let pad = -1;
    for (const l of this.layers) {
      if (!l.keys || !l.visible) continue;
      // Keys view: Z and X move the keyboard's octave, like Live's.
      if (l.view === 'keys' && (e.code === 'KeyZ' || e.code === 'KeyX')) { this.shiftOctave(l.id, e.code === 'KeyZ' ? -1 : 1); continue; }
      const p = this.padOfKey(l, e.code);
      if (p < 0) continue;
      this.trigger(l.id, p, l.view === 'keys' ? 0.8 : 1);
      hitLayers.push(l.id);
      pad = p;
    }
    if (hitLayers.length) this.heldKeys.set(e.code, { pad, layers: hitLayers });
  };
  private onKeyUp = (e: KeyboardEvent): void => {
    const held = this.heldKeys.get(e.code);
    if (!held) return;
    this.heldKeys.delete(e.code);
    for (const id of held.layers) {
      const l = this.layers.find(x => x.id === id);
      if (l) this.letGo(id, this.padOfKey(l, e.code) >= 0 ? this.padOfKey(l, e.code) : held.pad);
    }
  };

  /** Would the pad grid take this note (its device, channel and layout)? */
  private gridClaims(note: number, channel: number, device: string): boolean {
    const pg = padGrid.config();
    if (!pg || (pg.device && device && pg.device !== device) || (pg.channel && pg.channel !== channel)) return false;
    return !!kmPadOf(kmLayoutOf(pg), note);
  }

  private gridHit(col: number, row: number, vel: number): void {
    const i = dpPadOfCell(col, row);
    if (i < 0) return;
    for (const l of this.layers) {
      if (!l.grid || !l.visible) continue;
      const pad = smPadOfNote(l.bank + i, l.baseNote);
      if (vel > 0) this.trigger(l.id, pad, vel); else this.letGo(l.id, pad);
    }
  }
}

export const playDrumPads = new PlayDrumPads();
/** The same host under its new name. */
export const playSampler = playDrumPads;

/** Does any pad or zone of the layer play something? */
export const layerHasSound = (l: SamplerLayer): boolean => l.pads.some(padHasSound) || l.zones.some((z: SamplerZone) => padHasSound(z));
/** The piano keys' labels, for the editor (A W S E…). */
export const PIANO_KEY_LABELS = SM_PIANO_KEYS.map(c => c.replace(/^Key/, '').replace('Semicolon', ';').replace('Quote', '\''));
