/**
 * grainFrom.ts — "Grains from" a layer (docs/granulator.md): after every
 * frame the layers step, each Granulator rack with a source reads its things
 * (the kit's grainThings: particles, bodies, a null, a Relationship's
 * members), keeps the ones inside its boundary, and turns them into grain
 * points through its links (kit/granulator.js grFromPoints).
 *
 *   live      the points go to the rack's live granulator (audioEngineHost)
 *   offline   a render's frames are logged by time (`grainLog`), so the
 *             offline mix plays the same points on the same frames: the
 *             layers are deterministic in a render (a take's seed), and the
 *             grains are seeded, so a render comes out the same every time
 *
 * The tap is wired once (audioEngineWire.ts → playOverlay.setGrainTap).
 */
import { AE_INST, auPropId, isGranulatorRack } from '../types/playAudioEngine';
import type { PlayLayer, PlayRecord } from '../types/play';
import { grFromPoints, grSettings, type GrPoints } from '../play/kit/granulator.js';
import type { LayerKit } from '../play/kit/kit.js';
import { playEngine } from './playEngine';

export interface GrainFrame { t: number; pts: GrPoints; inside: number }

/** A render's points, by rack, in time order (cleared when a render starts over). */
const log = new Map<string, GrainFrame[]>();

export const grainLog = {
  /** The points in force at `t` (the last frame at or before it), or null. */
  at(rackId: string, t: number): GrPoints | null {
    const list = log.get(rackId);
    if (!list?.length) return null;
    let lo = 0, hi = list.length - 1, hit = -1;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (list[m].t <= t + 1e-9) { hit = m; lo = m + 1; } else hi = m - 1; }
    return hit >= 0 ? list[hit].pts : null;
  },
  has(rackId: string): boolean { return !!log.get(rackId)?.length; },
  /** For tests, and when a render starts. */
  clear(): void { log.clear(); },
  put(rackId: string, f: GrainFrame): void {
    let list = log.get(rackId);
    if (!list) { list = []; log.set(rackId, list); }
    // A render starting over (time went back) replaces what an earlier one left.
    if (list.length && f.t < list[list.length - 1].t - 1e-9) list.length = 0;
    list.push(f);
  },
};

/** This frame's points for one rack, from the kit's things. */
export function grainPointsOf(kit: LayerKit, record: PlayRecord, rackId: string, aspect: number, valueOf = (id: string, k: string, b: number) => playEngine.layerValue(id, k, b)): { pts: GrPoints; inside: number } | null {
  const rack = record.audioEngine?.racks.find(r => r.id === rackId);
  const slot = rack?.instrument;
  if (!rack || !isGranulatorRack(rack) || !slot?.from?.source) return null;
  const value = (l: PlayLayer, k: string) => valueOf(l.id, k, (l as unknown as Record<string, number>)[k]);
  const got = kit.grainThings(record, slot.from.source, slot.from.boundary, value, aspect);
  const prop = auPropId(rackId, AE_INST);
  const settings = grSettings(slot.params, (a, base) => valueOf(prop, a, base));
  return { pts: grFromPoints(got.things, got.cx, got.cy, slot.from, settings), inside: got.things.length };
}

type Live = (rackId: string, pts: GrPoints, inside: number) => void;

/** The overlay's tap: every Granulator with a source, live or logged for a render. */
export function makeGrainTap(live: Live) {
  return (kit: LayerKit, record: PlayRecord, aspect: number, time: number, offline: boolean): void => {
    for (const r of record.audioEngine?.racks ?? []) {
      if (!r.instrument?.from?.source || !isGranulatorRack(r)) continue;
      const got = grainPointsOf(kit, record, r.id, aspect);
      if (!got) continue;
      if (offline) grainLog.put(r.id, { t: time, pts: got.pts, inside: got.inside });
      else live(r.id, got.pts, got.inside);
    }
  };
}
