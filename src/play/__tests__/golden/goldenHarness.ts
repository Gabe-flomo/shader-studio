/**
 * The golden harness (implementation guide, phase 0): run a Play record
 * through the engine for a fixed script of inputs and return every control's
 * value, frame by frame. A refactor of the engine (sources and routes, the
 * shared frame loop, signals v2) must give the same rows for the same record:
 * the snapshots in golden.test.ts are the proof.
 *
 * The script, the same for every record: 120 frames of 1/30 s from t = 1.
 *   - MIDI: every CC on channels 1 and 2 sweeps 0 → 127 → 0; note 60 (and
 *     every note the record names) plays on frames 10–25 and 70–72.
 *   - Keys and the mouse button: each key a trigger, a mapping or a signal
 *     names is held on frames 15–30 and tapped on frame 80.
 *   - The pointer circles the picture; the picture is pressed on frames
 *     40–55.
 *   - Math.random is a seeded generator, so random triggers repeat.
 * Readings that need the layer kit (sensors, hands, audio) stay empty.
 */
import { playEngine } from '../../../lib/playEngine';
import { inputBus } from '../../../lib/inputBus';
import { midiEngine } from '../../../lib/midiEngine';
import { readBaseValues } from '../../playControls';
import type { GraphNode } from '../../../types/nodeGraph';
import type { PlayRecord, TriggerSpec } from '../../../types/play';

export const GOLDEN_FRAMES = 120;
const DT = 1 / 30;

type EngineInternals = { press(key: string): void; release(key: string): void; mouseX: number; mouseY: number; mouseDown: number };

/** Keys a record listens for anywhere (trigger keys, key sources, signal definitions). */
function keysOf(play: PlayRecord): string[] {
  const out = new Set<string>();
  const trig = (t: TriggerSpec | undefined) => { if (t?.on === 'key') out.add(t.code); };
  for (const m of play.mappings) {
    if (m.source.kind === 'key') out.add(m.source.code);
    if (m.source.kind === 'trigger') trig(m.source.trigger);
    if (m.increment?.on === 'trigger') trig(m.increment.trigger);
  }
  for (const a of play.actions ?? []) trig(a.trigger);
  for (const s of play.signals ?? []) if (s.when?.kind === 'trigger') trig(s.when.trigger);
  return [...out].sort();
}

function notesOf(play: PlayRecord): number[] {
  const out = new Set<number>([60]);
  const scan = (x: unknown) => { if (x && typeof x === 'object') for (const [k, v] of Object.entries(x)) { if (k === 'note' && typeof v === 'number' && v >= 0) out.add(v); else scan(v); } };
  scan(play.mappings); scan(play.actions);
  return [...out].sort((a, b) => a - b);
}

function seeded(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

/** Each control's values over the script, rounded to 4 decimals: one comma-joined row per control ('-' while it isn't driven). */
export function goldenRun(play: PlayRecord, nodes: GraphNode[] = []): Record<string, string> {
  const eng = playEngine as unknown as EngineInternals;
  const realRandom = Math.random;
  Math.random = seeded(12345);
  const rows: Record<string, string[]> = Object.fromEntries(play.controls.map(c => [c.id, []]));
  try {
    // As in the app, where every control is bound to a uniform: the bus ticks the engine every frame.
    inputBus.setParamBindings(Object.fromEntries(play.controls.map(c => [c.target, `u_${c.id}`])));
    playEngine.setRecord(play);
    playEngine.setBaseValues(readBaseValues(nodes, play) as Map<string, number | number[]>);
    const keys = keysOf(play), notes = notesOf(play);
    let t = 1;
    for (let f = 0; f < GOLDEN_FRAMES; f++) {
      // MIDI: CCs sweep up then down; notes on and off.
      const cc = Math.round(127 * (1 - Math.abs(1 - (2 * f) / GOLDEN_FRAMES)));
      for (const ch of [0, 1]) for (let n = 0; n < 128; n += 1) if (f % 4 === n % 4) midiEngine.handleBytes(0xb0 | ch, n, cc);
      for (const n of notes) {
        if (f === 10 || f === 70) midiEngine.handleBytes(0x90, n, 100);
        if (f === 25 || f === 72) midiEngine.handleBytes(0x80, n, 0);
      }
      // Keys: held, then tapped.
      for (const k of keys) {
        if (f === 15 || f === 80) eng.press(`key:${k}`);
        if (f === 30 || f === 81) eng.release(`key:${k}`);
      }
      // The pointer circles; the picture is pressed for half a second.
      eng.mouseX = 0.5 + 0.4 * Math.cos(f / 12); eng.mouseY = 0.5 + 0.4 * Math.sin(f / 12);
      playEngine.setPicturePointer(eng.mouseX, eng.mouseY);
      if (f === 40) { eng.mouseDown = 1; eng.press('mouse'); }
      if (f === 55) { eng.mouseDown = 0; eng.release('mouse'); }
      inputBus.tick(DT, (t += DT));
      for (const c of play.controls) {
        const v = playEngine.liveValue(c.id);
        rows[c.id].push(v === undefined ? '-' : Array.isArray(v) ? v.map(x => x.toFixed(4)).join('/') : v.toFixed(4));
      }
    }
  } finally {
    Math.random = realRandom;
    // Let go of everything the script left pressed, and of the record.
    for (let ch = 0; ch < 2; ch++) for (let n = 0; n < 128; n++) midiEngine.handleBytes(0xb0 | ch, n, 0);
    playEngine.setRecord({ version: 1, controls: [], mappings: [], layers: [] });
    inputBus.setParamBindings({});
    playEngine.setBaseValues(new Map());
  }
  return Object.fromEntries(Object.entries(rows).map(([id, r]) => [id, compress(r)]));
}

/** "a x3, b" for runs of the same value, so a held value is one entry. */
function compress(r: string[]): string {
  const out: string[] = [];
  for (let i = 0; i < r.length;) {
    let j = i;
    while (j < r.length && r[j] === r[i]) j++;
    out.push(j - i > 1 ? `${r[i]} x${j - i}` : r[i]);
    i = j;
  }
  return out.join(', ');
}
