/**
 * engineOps.ts — record edits the Audio engine's cards make: the engine put
 * back into the record (the key left out when there are no racks), taking
 * with it the controls on slots that are gone and the mappings onto them;
 * and a rack made from a Drum pad layer's pads.
 */
import type { PlayRecord } from '../../../types/play';
import type { DrumPadLayer } from '../../../types/playLayers';
import { AE_INST, AE_PAD_BASE_NOTE, controlsKeptFor, newRack, type AeRack, type AeZone, type PlayAudioEngine } from '../../../types/playAudioEngine';

let seq = 0;
/** An id for a rack (`rk`) or an effect (`fx`). */
export function engineId(prefix: 'rk' | 'fx'): string {
  seq += 1;
  return `${prefix}_${Date.now().toString(36)}${seq.toString(36)}`;
}

/** The record with this engine: controls on removed slots, and their mappings, go too. */
export function withEngine(p: PlayRecord, ae: PlayAudioEngine): PlayRecord {
  const out: PlayRecord = { ...p };
  if (ae.racks.length) out.audioEngine = ae; else delete out.audioEngine;
  const kept = controlsKeptFor(p.controls, out.audioEngine);
  if (kept.length !== p.controls.length) {
    const ids = new Set(kept.map(c => c.id));
    out.controls = kept;
    out.mappings = p.mappings.filter(m => ids.has(m.controlId));
  }
  // Readers listening to a rack that is gone keep listening to nothing (the panel says so), as with a deleted layer.
  return out;
}

/** A rack whose sample player has the pads' own samples (pad N on note 36 + N), following the layer's hits. */
export function rackFromPads(id: string, layer: DrumPadLayer, existing: readonly AeRack[]): AeRack {
  const zones: AeZone[] = [];
  layer.pads.forEach((p, i) => {
    if (!p.sampleId) return;
    const n = AE_PAD_BASE_NOTE + i;
    zones.push({ sampleId: p.sampleId, name: p.name || p.fileName || `Pad ${i + 1}`, lo: n, hi: n, root: n, gain: 1 });
  });
  return { ...newRack(id, existing), name: `${layer.label} · pads`, instrument: { id: AE_INST, kind: 'sampler', zones }, keyboard: false, midi: 'off', pads: layer.id };
}
