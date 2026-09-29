/**
 * samplerIndex.js — the Sample player's Sample index (docs/audio-engine.md,
 * "Sample index"): the drum pads' Sample index (drumPads.js dpPickPad) for an
 * Audio engine rack whose instrument is the sample player. A note that lands
 * in zone k plays zone (k + Index) among the zones in key order (lowest key
 * first), wrapping round, keeping the note's distance from its zone's root
 * key, so a pitched zone still pitches and a drum-rack zone (one key each)
 * simply swaps sounds.
 *
 * The rewrite happens in JS where notes enter a rack (lib/audioEngineHost.ts
 * `input`), before the native sampler (or the browser's) hears them; the
 * take and the tape record the note actually sent, so renders and replays
 * never pick again. Pure: no Web Audio, no record types. Every top-level name
 * starts `si`/`SI_`.
 *
 *   SI_PARAMS       the four settings, each with a fixed numeric address in
 *                   the sampler slot's `params` (like a granulator's
 *                   GR_PARAMS), so each is a rack control, a Configure pick
 *                   and a macro target (`au:<rack>:inst::<address>`)
 *   siPickNote      the note a note becomes
 *   siHold/siLetGo  the note sent for each note held, so its note-off matches
 */
import { DP_INDEX_MODES, dpHash01, dpPickPad } from './drumPads.js';

const SI_P = (addr, key, name, min, max, value, extra) => Object.assign({ addr: addr, key: key, name: name, min: min, max: max, value: value, unit: '', kind: 'number', step: 1, log: false, hint: '' }, extra || {});

/** How a note picks its zone (the drum pads' modes): 'index', 'random', 'spread'. */
export const SI_MODES = DP_INDEX_MODES;
export const SI_MODE_NAMES = ['Index', 'Random', 'Index ± spread'];

/** Furthest an Index or seed may be kept at (it wraps anyway). */
export const SI_INDEX_LIMIT = 1000;

export const SI_PARAMS = [
  SI_P(0, 'sampleIndex', 'Sample index', 0, 63, 0, { hint: 'Which zone a note plays: the zone it lands in, plus Index, wrapping round (zones in key order). Its distance from its zone’s root key is kept, so a pitched zone still pitches. Step it with an Increment, a beat or a signal to shuffle the sounds live.' }),
  SI_P(1, 'indexMode', 'Index mode', 0, 2, 0, { kind: 'list', values: SI_MODE_NAMES, hint: 'Index: its zone plus Index. Random: any zone each note (seeded, so it repeats). Index ± spread: its zone plus Index plus a random step of up to Index spread zones either way.' }),
  SI_P(2, 'indexSpread', 'Index spread', 0, 63, 1, { hint: 'Index ± spread: how many zones either way a note may land from Index (seeded).' }),
  SI_P(3, 'indexSeed', 'Index seed', 0, 9999, 0, { hint: 'The random picks’ seed: the same seed and the same notes pick the same zones.' }),
];

/** A setting by key or address, or null. */
export function siParam(k) {
  for (const p of SI_PARAMS) if (p.key === k || String(p.addr) === String(k)) return p;
  return null;
}

/** A setting's value kept in range: Index and Spread may go past their slider (they wrap), up to SI_INDEX_LIMIT. */
export function siClamp(k, v) {
  const p = siParam(k);
  if (!p || typeof v !== 'number' || !isFinite(v)) return p ? p.value : 0;
  if (p.key === 'sampleIndex') return Math.max(-SI_INDEX_LIMIT, Math.min(SI_INDEX_LIMIT, v));
  if (p.key === 'indexSpread') return Math.max(0, Math.min(SI_INDEX_LIMIT, v));
  return Math.max(p.min, Math.min(p.max, v));
}

/** The mode for a stored number (0 index, 1 random, 2 spread). */
export function siMode(v) { return SI_MODES[Math.max(0, Math.min(SI_MODES.length - 1, Math.round(v) || 0))]; }

/** The zone (its position in `zones`) a note plays: the last one covering it, as the sample player picks; -1 for none. */
export function siZoneOf(zones, note) {
  let hit = -1;
  for (let i = 0; i < zones.length; i++) if (note >= zones[i].lo && note <= zones[i].hi) hit = i;
  return hit;
}

/** The zones' positions in key order: lowest key first (ties keep their order). */
export function siOrder(zones) {
  return zones.map((z, i) => i).sort((a, b) => (zones[a].lo - zones[b].lo) || (a - b));
}

/**
 * The note a `note` becomes: its zone's place in key order plus `index`
 * (wrapping), or a seeded pick (`mode` 'random' / 'spread', `r` 0..1 from
 * dpHash01), at the same distance from the new zone's root as from its own.
 * If that falls outside the new zone's keys, the nearest of its keys that
 * plays it. A note in no zone, or with nothing to change, is itself.
 */
export function siPickNote(zones, note, index, mode, spread, r) {
  const from = siZoneOf(zones, note);
  if (from < 0) return note;
  const to = dpPickPad(siOrder(zones), from, index, mode, spread, r);
  if (to === from) return note;
  const z = zones[to];
  const want = Math.max(0, Math.min(127, z.root + (note - zones[from].root)));
  const inside = Math.max(z.lo, Math.min(z.hi, want));
  if (siZoneOf(zones, inside) === to) return inside;
  // Another zone covers that key and wins it: the nearest key the picked zone still plays.
  let best = -1;
  for (let k = z.lo; k <= z.hi; k++) if (siZoneOf(zones, k) === to && (best < 0 || Math.abs(k - want) < Math.abs(best - want))) best = k;
  return best < 0 ? note : best;
}

/** A note's pick with the rack's numbers: `hit` the rack's note count (1 for its first), seeded by `seed`. */
export function siPick(zones, note, index, mode, spread, seed, hit) {
  return siPickNote(zones, note, index, mode, spread, dpHash01(seed || 0, hit || 0));
}

/** Remember the note sent for a note held (`key`: the note, or channel and note), so its note-off goes to the same one. */
export function siHold(map, key, sent) {
  const list = map.get(key);
  if (list) list.push(sent); else map.set(key, [sent]);
}

/** The note sent for a note let go (the earliest still held), or undefined when it wasn't held. */
export function siLetGo(map, key) {
  const list = map.get(key);
  if (!list || !list.length) return undefined;
  const sent = list.shift();
  if (!list.length) map.delete(key);
  return sent;
}
