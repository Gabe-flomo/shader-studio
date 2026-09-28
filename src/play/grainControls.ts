/**
 * grainControls.ts — a Granulator rack's grains as controls and nulls
 * (docs/granulator.md). The rack reports its grains as sensors on
 * `ae:<rackId>` (lib/webGranulator.ts); these helpers wire them into the
 * record, each one undo step:
 *
 *   addGrainReadouts   controls for the grain count, mean position and spread
 *                      (targets `grains:<rack>::<read>`, which write nothing),
 *                      each driven by a sensor mapping, in "Grains · <rack>"
 *   addGrainNulls      null layers that ride grains 1..n: x is where the grain
 *                      reads in the sample, y its level (sensor mappings on
 *                      the nulls' x and y), for particles, paths and the rest
 *
 * Pure: record in, record out.
 */
import { defaultLayer, layerTarget, type PlayControl, type PlayMapping, type PlayRecord, type SensorRead } from '../types/play';
import { GRAIN_EACH, GRAIN_READ_LABELS, aeRack, grainSensorLayer, grainsTarget, type GrainRead } from '../types/playAudioEngine';
import { playId } from './playControls';

export const GRAIN_GROUP_PREFIX = 'Grains · ';
const READOUTS: ReadonlyArray<{ read: GrainRead; max: number }> = [
  { read: 'grains', max: 64 },
  { read: 'grainMean', max: 1 },
  { read: 'grainSpread', max: 1 },
];

const mapping = (controlId: string, layerId: string, read: SensorRead, outMin: number, outMax: number, otherId = '', smoothMs = 0): PlayMapping => ({
  id: playId('map'), controlId, source: { kind: 'sensor', layerId, read, otherId }, outMin, outMax, curve: 'linear', smoothMs, enabled: true,
});

/** Controls for the grain count (0..64), mean position and spread, each with its sensor mapping. Ones already there are kept. */
export function addGrainReadouts(p: PlayRecord, rackId: string): PlayRecord {
  const rack = aeRack(p.audioEngine, rackId);
  if (!rack) return p;
  const controls: PlayControl[] = [], mappings: PlayMapping[] = [];
  for (const { read, max } of READOUTS) {
    const target = grainsTarget(rackId, read);
    if (p.controls.some(c => c.target === target)) continue;
    const control: PlayControl = { id: playId('ctl'), target, kind: 'float', label: GRAIN_READ_LABELS[read], min: 0, max, group: `${GRAIN_GROUP_PREFIX}${rack.name}` };
    controls.push(control);
    mappings.push(mapping(control.id, grainSensorLayer(rackId), read, 0, max));
  }
  if (!controls.length) return p;
  return { ...p, controls: [...p.controls, ...controls], mappings: [...p.mappings, ...mappings] };
}

/** `n` null layers riding grains 1..n (x: the grain's place in the sample, y: its level), with their mappings. */
export function addGrainNulls(p: PlayRecord, rackId: string, n = 8): PlayRecord {
  const rack = aeRack(p.audioEngine, rackId);
  if (!rack) return p;
  const count = Math.max(1, Math.min(GRAIN_EACH, Math.round(n)));
  const layers = [...p.layers], controls: PlayControl[] = [], mappings: PlayMapping[] = [];
  const src = grainSensorLayer(rackId);
  for (let i = 1; i <= count; i++) {
    const id = playId('layer');
    const l = { ...defaultLayer('null', id, `${rack.name} · grain ${i}`), x: 0.5, y: 0.2, size: 8 } as typeof layers[number];
    layers.push(l);
    const cx: PlayControl = { id: playId('ctl'), target: layerTarget(id, 'x'), kind: 'float', label: `Grain ${i} · x`, min: 0, max: 1, group: `${GRAIN_GROUP_PREFIX}${rack.name} · nulls` };
    const cy: PlayControl = { id: playId('ctl'), target: layerTarget(id, 'y'), kind: 'float', label: `Grain ${i} · y`, min: 0, max: 1, group: `${GRAIN_GROUP_PREFIX}${rack.name} · nulls` };
    controls.push(cx, cy);
    mappings.push(mapping(cx.id, src, 'grainPos', 0.05, 0.95, String(i)), mapping(cy.id, src, 'grainAmp', 0.15, 0.85, String(i), 30));
  }
  return { ...p, layers, controls: [...p.controls, ...controls], mappings: [...p.mappings, ...mappings] };
}
