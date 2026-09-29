/**
 * drumPads.ts — the app's host for Drum pad layers (types/playLayers.ts
 * DrumPadLayer; docs/drum-pads.md). Module singleton, no React.
 *
 *   Samples   each pad names a sample in the media library (IndexedDB, the
 *             videos store: lib/backgroundLibrary.ts) or a generated drum;
 *             decoded once per sample in the audio engine's context. A sample
 *             the library doesn't have is "missing": the card asks for it.
 *   Sound     per layer: the kit's sampler (play/kit/drumPads.js) → its effect
 *             chain (`layer:<id>`, lib/audioFx.ts) → the layer's volume → the
 *             audio engine's mix (the master chain, the speakers and the
 *             record bus). An analyser on the chain is what readers hear
 *             (`pads:<id>`, lib/padSound.ts).
 *   Hits      clicks on the card, keys, MIDI notes, the pad grid and actions
 *             all become a `pad` action through the overlay (so takes record
 *             them, stamped with the clock time they landed); the overlay
 *             hands them, live or from a take, to `play`.
 *   Export    each sample is remembered for web exports (lib/mediaSources.ts,
 *             key `dsample:<sampleId>`).
 */
import type { PlayRecord } from '../types/play';
import { padHasSound, type DrumPad, type DrumPadLayer } from '../types/playLayers';
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
import {
  DP_PADS, dpCreateSampler, dpHitNumbers, dpKey, dpPadOfCell, dpPadOfKey, dpPadOfNote, dpPeaks, dpSynthBuffer, type DpSampler, dpHash01, dpPickPad, dpSlots } from './kit/drumPads.js';

/** What the card shows about a pad's sample. */
export type PadStatus = 'empty' | 'loading' | 'ready' | 'missing' | 'error';

export interface PadAction { do: 'pad'; layerId: string; amount: number; vel?: number; at?: number; /** The pad (1-based) whose sound played, after the sample index (docs/drum-pads.md). */ slot?: number }

interface Sample { status: PadStatus; buffer: AudioBuffer | null; error: string; peaks: Float32Array | null }
interface Kit { ctx: AudioContext; sampler: DpSampler; analyser: AnalyserNode; out: GainNode; vol: number; dispose: () => void }

/** A pad's sample key: its library id, or `synth:<kind>` for a generated drum. */
export const sampleKey = (p: DrumPad | undefined): string => (!p ? '' : p.sampleId ? p.sampleId : p.synth ? `synth:${p.synth}` : '');
export const sampleMediaKey = (sampleId: string) => `dsample:${sampleId}`;

/** Audio files a pad takes. */
export const SAMPLE_ACCEPT = audioAccept();
export { isAudioFile } from '../lib/audioAccept';

class PlayDrumPads {
  private layers: DrumPadLayer[] = [];
  private samples = new Map<string, Sample>();
  /** Files picked this session, used straight away (and the only copy of a `session:` one). */
  private blobs = new Map<string, Blob>();
  private kits = new Map<string, Kit>();
  private listeners = new Set<() => void>();
  /** layerId:pad → when it was last hit (performance.now) and how hard, for the card's lights. */
  private lit = new Map<string, { at: number; vel: number }>();
  private clock = { time: 0, wall: 0, playing: false };
  private actor: ((a: PadAction) => void) | null = null;
  /** Hits so far per layer: the random index modes draw from the seed and this count, so a take repeats them. */
  private hits = new Map<string, number>();
  private heldKeys = new Map<string, number>();

  constructor() {
    padSound.setHost({ analyser: id => this.analyser(id), state: id => this.soundState(id), buffer: p => this.buffer(p) });
    // A sample from a linked folder that changed on disk plays the new one; one that came back (folder plugged in, allowed again) loads.
    onLinkedChange(refs => {
      for (const [key, s] of [...this.samples]) {
        if (!isLinkedRef(key) || (refs ? !refs.includes(key) : s.status === 'ready' || s.status === 'loading')) continue;
        this.samples.delete(key);
        void this.load(key, { ...emptyPad(), sampleId: key });
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
        const pad = dpPadOfNote(e.note, l.baseNote);
        if (pad < 0) continue;
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
    this.layers = can('play.layers') ? record.layers.filter((l): l is DrumPadLayer => l.kind === 'drumpad') : [];
    for (const [id, k] of this.kits) if (!this.layers.some(l => l.id === id)) { k.dispose(); this.kits.delete(id); }
    for (const l of this.layers) {
      for (const p of l.pads) {
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

  private async load(key: string, p: DrumPad): Promise<void> {
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
    await this.load(sampleId, { ...emptyPad(), sampleId, fileName });
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
    await this.load(ref, { ...emptyPad(), sampleId: ref, fileName });
    const s = this.samples.get(ref);
    if (s?.status !== 'ready') throw new Error(s?.error || (s?.status === 'missing' ? 'That file couldn’t be read from its folder.' : 'Couldn’t open that sound.'));
    return { sampleId: ref, fileName: fileName.slice(0, 120), bytes };
  }

  status(p: DrumPad | undefined): PadStatus { const k = sampleKey(p); return k ? this.samples.get(k)?.status ?? 'loading' : 'empty'; }
  errorText(p: DrumPad | undefined): string { return this.samples.get(sampleKey(p))?.error ?? ''; }
  peaks(p: DrumPad | undefined): Float32Array | null { return this.samples.get(sampleKey(p))?.peaks ?? null; }
  duration(p: DrumPad | undefined): number { return this.samples.get(sampleKey(p))?.buffer?.duration ?? 0; }
  /** The decoded sample (offline mixes play it). */
  buffer(p: DrumPad | undefined): AudioBuffer | null { return this.samples.get(sampleKey(p))?.buffer ?? null; }
  /** A sample's file as a data URL for a web export (null: too big, or not open here). */
  exportSource(p: DrumPad): { src: string | null; bytes: number } {
    if (!p.sampleId) return { src: null, bytes: 0 };
    const m = mediaSource(sampleMediaKey(p.sampleId));
    return { src: m?.dataUrl ?? null, bytes: m?.dataUrl?.length ?? (m?.tooBig ? m.bytes : p.bytes) };
  }

  // ── Sound ──────────────────────────────────────────────────────────────────

  private volumeOf(l: DrumPadLayer): number { return Math.max(0, playEngine.layerValue(l.id, 'volume', l.volume)); }

  private kit(l: DrumPadLayer): Kit | null {
    const had = this.kits.get(l.id);
    if (had) return had;
    const ctx = this.context();
    if (!ctx) return null;
    const sampler = dpCreateSampler(ctx);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.8;
    const out = ctx.createGain();
    const vol = this.volumeOf(l);
    out.gain.value = vol;
    // sampler → its chain → the volume → the mix; the readers tap the chain.
    const unplug = audioFxHost.attach(ctx, layerChainId(l.id), sampler.output, out, analyser);
    const off = audioEngine.connectOutside(out);
    const k: Kit = { ctx, sampler, analyser, out, vol, dispose: () => { sampler.stopAll(); unplug(); off(); } };
    this.kits.set(l.id, k);
    return k;
  }

  /** The graph clock now, between frames (a hit is stamped with it). */
  clockNow(): number {
    const c = this.clock;
    return c.playing && c.wall ? c.time + Math.min(0.25, (performance.now() - c.wall) / 1000) : c.time;
  }

  /** Once a frame: the clock, and mapped pitch, volume and pan on sounding pads. */
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
      for (let i = 0; i < DP_PADS; i++) {
        if (!k.sampler.playing(i)) continue;
        k.sampler.setLive(i, dpHitNumbers(key => this.num(l, i, key)));
      }
    }
  }

  private num(l: DrumPadLayer, pad: number, key: string): number {
    const k = dpKey(pad, key);
    return playEngine.layerValue(l.id, k, l[k as `pad${number}_${string}`]);
  }

  /** Hit a pad (velocity 0..1): recorded in a take when one is recording. */
  trigger(layerId: string, pad: number, vel = 1): void {
    const l = this.layers.find(x => x.id === layerId);
    const slot = l ? this.pickSlot(l, pad) + 1 : undefined;
    const a: PadAction = { do: 'pad', layerId, amount: pad + 1, vel: Math.max(0.01, Math.min(1, vel)), at: this.clockNow(), ...(slot ? { slot } : {}) };
    if (this.actor) this.actor(a); else this.play(a);
  }

  /**
   * The pad (0-based) whose sound a hit on `pad` plays, after the layer's
   * sample index (docs/drum-pads.md "Sample index"): its place among the pads
   * with sounds plus Index (wrapping), or a seeded random pad. Counts the hit.
   */
  pickSlot(l: DrumPadLayer, pad: number): number {
    const slots = dpSlots((i: number) => padHasSound(l.pads[i]), DP_PADS);
    const n = (this.hits.get(l.id) ?? 0) + 1;
    this.hits.set(l.id, n);
    const index = playEngine.layerValue(l.id, 'sampleIndex', l.sampleIndex ?? 0);
    const spread = playEngine.layerValue(l.id, 'indexSpread', l.indexSpread ?? 0);
    return dpPickPad(slots, pad, index, l.indexMode ?? 'index', spread, dpHash01(l.indexSeed ?? 0, n));
  }

  /** Let a pad go: only gate pads care (they fade over their release). */
  letGo(layerId: string, pad: number): void {
    const l = this.layers.find(x => x.id === layerId);
    if (l?.pads[pad]?.mode !== 'gate') return;
    const a: PadAction = { do: 'pad', layerId, amount: pad + 1, vel: 0, at: this.clockNow() };
    if (this.actor) this.actor(a); else this.play(a);
  }

  /** A hit (live, or from a take playing back): play it. */
  play(a: { layerId: string; amount: number; vel?: number; slot?: number }): void {
    const l = this.layers.find(x => x.id === a.layerId);
    const pad = Math.round(a.amount) - 1;
    if (!l || !l.visible || pad < 0 || pad >= DP_PADS) return;
    const k = this.kit(l);
    if (!k) return;
    if (k.ctx.state === 'suspended') void k.ctx.resume();
    const vel = a.vel ?? 1;
    if (vel <= 0) { k.sampler.release(pad); return; }
    // The sound comes from the indexed pad (recorded in the take as `slot`; older takes pick again).
    const src = a.slot && a.slot >= 1 && a.slot <= DP_PADS ? a.slot - 1 : this.pickSlot(l, pad);
    const p = l.pads[src] ?? l.pads[pad];
    this.lit.set(`${l.id}:${pad}`, { at: performance.now(), vel });
    this.emit();
    const buffer = this.buffer(p);
    if (!buffer) return;
    k.sampler.hit(pad, { ...dpHitNumbers(key => this.num(l, src, key)), buffer, mode: p.mode, loop: p.loop, reverse: p.reverse, choke: p.choke, velocity: vel });
  }

  /** When a pad was last hit (performance.now) and how hard, for the card; null before any. */
  lastHit(layerId: string, pad: number): { at: number; vel: number } | null { return this.lit.get(`${layerId}:${pad}`) ?? null; }

  /** Everything sounding stops (the card's Stop). */
  stopAll(layerId: string): void { this.kits.get(layerId)?.sampler.stopAll(); }

  analyser(layerId: string): AnalyserNode | null {
    const l = this.layers.find(x => x.id === layerId);
    return l ? this.kit(l)?.analyser ?? null : null;
  }

  soundState(layerId: string): PadSoundState {
    const l = this.layers.find(x => x.id === layerId);
    if (!l) return 'gone';
    if (!l.visible) return 'off';
    if (!l.pads.some(p => this.status(p) === 'ready')) return 'no-file';
    return this.kits.get(l.id)?.sampler.playing() ? 'playing' : 'paused';
  }

  // ── Keys, MIDI, the pad grid ───────────────────────────────────────────────

  private keysOn(): boolean { return playEngine.isPerforming() && !playEngine.isLearning(); }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.metaKey || e.ctrlKey || e.altKey || e.repeat || isTypingTarget(e.target) || !this.keysOn() || keyboardClaimed(e)) return;
    const pad = dpPadOfKey(e.code);
    if (pad < 0) return;
    let hit = false;
    for (const l of this.layers) if (l.keys && l.visible) { this.trigger(l.id, pad, 1); hit = true; }
    if (hit) this.heldKeys.set(e.code, pad);
  };
  private onKeyUp = (e: KeyboardEvent): void => {
    const pad = this.heldKeys.get(e.code);
    if (pad === undefined) return;
    this.heldKeys.delete(e.code);
    for (const l of this.layers) if (l.keys && l.visible) this.letGo(l.id, pad);
  };

  /** Would the pad grid take this note (its device, channel and layout)? */
  private gridClaims(note: number, channel: number, device: string): boolean {
    const pg = padGrid.config();
    if (!pg || (pg.device && device && pg.device !== device) || (pg.channel && pg.channel !== channel)) return false;
    return !!kmPadOf(kmLayoutOf(pg), note);
  }

  private gridHit(col: number, row: number, vel: number): void {
    const pad = dpPadOfCell(col, row);
    if (pad < 0) return;
    for (const l of this.layers) {
      if (!l.grid || !l.visible) continue;
      if (vel > 0) this.trigger(l.id, pad, vel); else this.letGo(l.id, pad);
    }
  }
}

const emptyPad = (): DrumPad => ({ sampleId: '', fileName: '', bytes: 0, synth: '', name: '', mode: 'oneshot', loop: false, reverse: false, choke: 0 });

export const playDrumPads = new PlayDrumPads();

/** Does any pad of the layer play something? */
export const layerHasSound = (l: DrumPadLayer): boolean => l.pads.some(padHasSound);
