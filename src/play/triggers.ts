/**
 * triggers.ts — the pure part of trigger sources: turn presses and a gate into
 * a 0..1 value, one frame at a time. Shared by the Play engine; the standalone
 * web runtime carries a line-for-line copy (runtime/play-runtime.js).
 *
 * A press is counted, not sampled, so a key tapped between two frames still
 * fires. The envelope finishes its attack even if the gate closed during it,
 * so a quick tap is a full hit rather than a flicker.
 */
import type { NoiseType, TriggerMode, TriggerSpec } from '../types/play';

export interface TriggerParams {
  mode: TriggerMode;
  attack: number;   // ms
  decay: number;    // ms
  sustain: number;  // 0..1 of the peak
  release: number;  // ms
  steps: number;
}

export type EnvStage = 'idle' | 'attack' | 'decay' | 'sustain' | 'release';

export interface TriggerState {
  /** Presses seen so far (compared with the hub's counter to find new ones). */
  seen: number;
  value: number;
  stage: EnvStage;
  peak: number;
  /** step: index of the current step. */
  index: number;
}

export function newTriggerState(seen = 0): TriggerState {
  return { seen, value: 0, stage: 'idle', peak: 1, index: -1 };
}

/** Where presses and gates are counted: one string per distinct trigger. Notes register under the exact and the any-note key. */
export function triggerKey(t: TriggerSpec): string {
  switch (t.on) {
    case 'key': return `key:${t.code}`;
    case 'note': return `note:${t.channel}:${t.note < 0 ? '*' : t.note}`;
    case 'mouse': return 'mouse';
    case 'osc': return `osc:${t.address}`;
    case 'beat': return `beat:${t.bpm}:${t.beats}`;
    case 'audio': return `audio:${t.band}:${t.threshold}`;
  }
}

/** A beat trigger's press count and gate at `time` seconds: one press per `beats` beats, gate open for the first quarter (≤ 120 ms). */
export function beatAt(bpm: number, beats: number, time: number): { count: number; gate: boolean } {
  const period = (60 / Math.max(1, bpm)) * Math.max(0.0625, beats);
  const count = Math.floor(time / period) + 1;
  const into = time - (count - 1) * period;
  return { count, gate: into < Math.min(0.12, period / 4) };
}

/**
 * Advance one frame. `presses` is the hub's running count for this trigger,
 * `gate` whether it is held now, `velocity` 0..1 of the last press (1 when the
 * trigger has none or velocity sensitivity is off). `rand` is injected for tests.
 */
export function stepTrigger(st: TriggerState, p: TriggerParams, presses: number, gate: boolean, dt: number, velocity = 1, rand: () => number = Math.random): number {
  const fresh = presses > st.seen;
  st.seen = presses;
  switch (p.mode) {
    case 'toggle':
      if (fresh) st.value = st.value >= 0.5 ? 0 : 1;
      return st.value;
    case 'step':
      if (fresh) { st.index = (st.index + 1) % Math.max(2, p.steps); st.value = st.index / (Math.max(2, p.steps) - 1); }
      return st.value;
    case 'random':
      if (fresh) st.value = rand();
      return st.value;
    case 'envelope':
      return stepEnvelope(st, p, fresh, gate, dt, velocity);
  }
}

const EPS = 1e-6;

function stepEnvelope(st: TriggerState, p: TriggerParams, fresh: boolean, gate: boolean, dt: number, velocity: number): number {
  const ms = dt * 1000;
  if (fresh) { st.stage = 'attack'; st.peak = Math.max(0, Math.min(1, velocity)); }
  const level = p.sustain * st.peak;
  switch (st.stage) {
    case 'attack':
      st.value = p.attack <= 0 ? st.peak : Math.min(st.peak, st.value + (ms / p.attack) * st.peak);
      if (st.value >= st.peak - EPS) { st.value = st.peak; st.stage = 'decay'; }
      break;
    case 'decay':
      st.value = p.decay <= 0 ? level : Math.max(level, st.value - (ms / p.decay) * (st.peak - level || st.peak));
      if (st.value <= level + EPS) { st.value = level; st.stage = 'sustain'; }
      break;
    case 'sustain':
      st.value = level;
      break;
    case 'release':
      st.value = p.release <= 0 ? 0 : Math.max(0, st.value - (ms / p.release) * Math.max(st.peak, 1e-3));
      if (st.value <= EPS) { st.value = 0; st.stage = 'idle'; }
      break;
    case 'idle':
      st.value = 0;
      break;
  }
  // Past the attack, a closed gate releases (a sustain of 0 just rides the decay to 0).
  if (!gate && (st.stage === 'decay' || st.stage === 'sustain')) st.stage = level > 0 || st.stage === 'sustain' ? 'release' : st.stage;
  if (st.stage === 'sustain' && level === 0) st.stage = 'idle';
  return st.value;
}

// ── Noise ────────────────────────────────────────────────────────────────────

/** Deterministic 0..1 for an integer lattice point and a seed. */
export function hashNoise(i: number, seed: number): number {
  const x = Math.sin(i * 127.1 + seed * 311.7) * 43758.5453;
  return x - Math.floor(x);
}

function smoothAt(t: number, seed: number): number {
  const i = Math.floor(t), f = t - i;
  const u = f * f * (3 - 2 * f);
  return hashNoise(i, seed) + (hashNoise(i + 1, seed) - hashNoise(i, seed)) * u;
}

/**
 * Noise value at `time` seconds, 0..1. `frame` feeds the per-frame random
 * type so it changes every frame without depending on the clock.
 */
export function noiseAt(type: NoiseType, time: number, rate: number, seed: number, steps: number, frame: number): number {
  const t = time * Math.max(0.01, rate);
  switch (type) {
    case 'smooth':
      return smoothAt(t, seed);
    case 'drift': {
      // Three octaves, normalised back to 0..1.
      const v = smoothAt(t, seed) * 0.57 + smoothAt(t * 2.03, seed + 17) * 0.29 + smoothAt(t * 4.11, seed + 41) * 0.14;
      return Math.max(0, Math.min(1, v));
    }
    case 'random':
      return hashNoise(frame, seed + 7);
    case 'stepped': {
      const v = hashNoise(Math.floor(t), seed + 3);
      if (steps < 2) return v;
      return Math.round(v * (steps - 1)) / (steps - 1);
    }
  }
}
