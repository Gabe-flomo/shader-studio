/**
 * toneSynth.ts — a small polyphonic Web Audio synth that plays whatever the
 * MIDI engine hears, so the keyboard stand-in (or a silent controller) makes
 * a sound. No samples, no assets: sine plus a quiet triangle an octave up,
 * a velocity-tracking lowpass, an attack/decay/release envelope, and a soft
 * feedback delay as the "internal post-processing". None of that is surfaced;
 * the only control is on/off (persisted).
 *
 * Module singleton. Subscribes to midiEngine lazily on first enable; the
 * AudioContext is created on the first note (a key press counts as the user
 * gesture browsers require).
 */

import { midiEngine, type MidiEvent } from './midiEngine';

const STORAGE_KEY = 'shader-studio:midiSound';

interface Voice {
  osc1: OscillatorNode;
  osc2: OscillatorNode;
  filter: BiquadFilterNode;
  gain: GainNode;
}

function mtof(note: number): number {
  return 440 * Math.pow(2, (note - 69) / 12);
}

class ToneSynth {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private voices = new Map<number, Voice>(); // note → voice
  private enabled: boolean;
  private unsubscribe: (() => void) | null = null;
  private listeners = new Set<(on: boolean) => void>();

  constructor() {
    let stored: string | null = null;
    try { stored = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null; } catch { /* private mode */ }
    this.enabled = stored === null ? true : stored === '1';
    if (this.enabled) this.attach();
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(on: boolean): void {
    if (on === this.enabled) return;
    this.enabled = on;
    try { localStorage.setItem(STORAGE_KEY, on ? '1' : '0'); } catch { /* ignore */ }
    if (on) this.attach(); else this.detach();
    for (const l of this.listeners) l(on);
  }

  /** UI hook: notified when the toggle changes from anywhere. */
  subscribe(listener: (on: boolean) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private attach(): void {
    if (this.unsubscribe) return;
    this.unsubscribe = midiEngine.subscribe(this.onMidi);
  }

  private detach(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    for (const note of [...this.voices.keys()]) this.noteOff(note);
  }

  private onMidi = (e: MidiEvent) => {
    if (e.kind === 'noteOn') this.noteOn(e.note, e.velocity / 127);
    else if (e.kind === 'noteOff') this.noteOff(e.note);
  };

  private graph(): { ctx: AudioContext; master: GainNode } | null {
    if (typeof window === 'undefined') return null;
    if (!this.ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      const ctx = new AC();
      const master = ctx.createGain();
      master.gain.value = 0.22;
      // Post: a soft feedback delay, mixed in quietly, so single notes have some air.
      const delay = ctx.createDelay(1);
      delay.delayTime.value = 0.28;
      const feedback = ctx.createGain();
      feedback.gain.value = 0.28;
      const wet = ctx.createGain();
      wet.gain.value = 0.18;
      const tone = ctx.createBiquadFilter();
      tone.type = 'lowpass';
      tone.frequency.value = 1800;
      master.connect(ctx.destination);
      master.connect(delay);
      delay.connect(tone);
      tone.connect(feedback);
      feedback.connect(delay);
      tone.connect(wet);
      wet.connect(ctx.destination);
      this.ctx = ctx;
      this.master = master;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return { ctx: this.ctx, master: this.master! };
  }

  private noteOn(note: number, velocity: number): void {
    const g = this.graph();
    if (!g) return;
    const { ctx, master } = g;
    if (this.voices.has(note)) this.noteOff(note);
    const t = ctx.currentTime;
    const freq = mtof(note);
    const osc1 = ctx.createOscillator();
    osc1.type = 'sine';
    osc1.frequency.value = freq;
    const osc2 = ctx.createOscillator();
    osc2.type = 'triangle';
    osc2.frequency.value = freq * 2;
    const osc2Gain = ctx.createGain();
    osc2Gain.gain.value = 0.12;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 600 + 4000 * velocity * velocity;
    filter.Q.value = 0.7;
    const gain = ctx.createGain();
    const peak = 0.15 + 0.85 * velocity;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(peak, t + 0.008);          // attack
    gain.gain.exponentialRampToValueAtTime(peak * 0.65, t + 0.16); // decay to sustain
    osc1.connect(filter);
    osc2.connect(osc2Gain);
    osc2Gain.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    osc1.start(t);
    osc2.start(t);
    this.voices.set(note, { osc1, osc2, filter, gain });
  }

  private noteOff(note: number): void {
    const v = this.voices.get(note);
    if (!v || !this.ctx) return;
    this.voices.delete(note);
    const t = this.ctx.currentTime;
    v.gain.gain.cancelScheduledValues(t);
    v.gain.gain.setValueAtTime(v.gain.gain.value, t);
    v.gain.gain.exponentialRampToValueAtTime(0.0005, t + 0.25); // release
    v.osc1.stop(t + 0.3);
    v.osc2.stop(t + 0.3);
    const cleanup = () => { v.gain.disconnect(); v.filter.disconnect(); };
    v.osc1.onended = cleanup;
  }
}

export const toneSynth = new ToneSynth();
