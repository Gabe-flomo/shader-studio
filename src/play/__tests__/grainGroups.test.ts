/**
 * Grains → nulls sit in their own sealed folder (docs/granulator.md): layers
 * added later land at the top level (or the nearest open group around it),
 * never inside, even while the list shows that folder; a drop still puts one
 * in; the flag survives a save.
 */
import { describe, expect, it } from 'vitest';
import { addGrainNulls } from '../grainControls';
import { AE_INST, type PlayAudioEngine } from '../../types/playAudioEngine';
import { defaultLayer, parsePlayRecord, type PlayRecord } from '../../types/play';
import { groupOfLayer, newLayerHome } from '../../types/layerGroups';
import { addToGroup, createGroup, placeNewLayer } from '../../components/play/groupOps';

const engine = (): PlayAudioEngine => ({
  racks: [{ id: 'gr', name: 'Grains', effects: [], keyboard: false, midi: '', channel: 0, volume: 1, mute: false, instrument: { id: AE_INST, kind: 'granulator', sample: { synth: 'pad', name: 'Pad chord' } } }],
} as PlayAudioEngine);

const base = (): PlayRecord => ({ version: 1, controls: [], mappings: [], layers: [defaultLayer('shape', 'shape1', 'Shape 1')], audioEngine: engine() });
/** A shape added the way the Layers list adds one (appended, then placed for the group the list shows). */
const addShape = (p: PlayRecord, id: string, entered = '') => placeNewLayer({ ...p, layers: [...p.layers, defaultLayer('shape', id, id)] }, id, entered);

describe('Grains → nulls: a sealed folder', () => {
  it('makes a folder holding just the nulls, at the top level, sealed', () => {
    const p = addGrainNulls(base(), 'gr', 8);
    expect(p.groups).toHaveLength(1);
    const g = p.groups![0];
    expect(g.label).toBe('Grains · Grains');
    expect(g.sealed).toBe(true);
    expect(g.parent).toBeUndefined();
    expect(g.layers).toHaveLength(8);
    for (const id of g.layers) expect(p.layers.find(l => l.id === id)?.kind).toBe('null');
    expect(groupOfLayer(p.groups).has('shape1')).toBe(false);
    // Twice: a second folder, named apart.
    const twice = addGrainNulls(p, 'gr', 2);
    expect(twice.groups!.map(x => x.label)).toEqual(['Grains · Grains', 'Grains · Grains (2)']);
  });

  it('a layer added later stays outside it: at the top level, even while the list shows the folder', () => {
    const p = addGrainNulls(base(), 'gr', 8);
    const folder = p.groups![0].id;
    const after = addShape(p, 'later');
    expect(groupOfLayer(after.groups).get('later')).toBeUndefined();
    const inside = addShape(p, 'while-in', folder);
    expect(groupOfLayer(inside.groups).get('while-in')).toBeUndefined();
    expect(inside.groups![0].layers).toHaveLength(8);
    expect(newLayerHome(p.groups, folder)).toBe('');
  });

  it('in an open group around it, a new layer goes to that group instead', () => {
    let p = addGrainNulls(base(), 'gr', 3);
    const folder = p.groups![0].id;
    const made = createGroup(p, [{ kind: 'group', id: folder }, { kind: 'layer', id: 'shape1' }], { label: 'Scene' });
    p = made.play;
    expect(p.groups!.find(g => g.id === folder)!.parent).toBe(made.id);
    expect(newLayerHome(p.groups, folder)).toBe(made.id);
    const next = addShape(p, 'new', folder);
    expect(groupOfLayer(next.groups).get('new')).toBe(made.id);
    // An open group takes new layers as before.
    expect(groupOfLayer(addShape(p, 'direct', made.id).groups).get('direct')).toBe(made.id);
  });

  it('a drop still puts a layer inside, and the seal survives a save', () => {
    const p = addGrainNulls(base(), 'gr', 2);
    const folder = p.groups![0].id;
    const dropped = addToGroup(p, 'shape1', folder);
    expect(groupOfLayer(dropped.groups).get('shape1')).toBe(folder);
    const saved = parsePlayRecord(JSON.parse(JSON.stringify(p)));
    expect(saved.groups?.[0].sealed).toBe(true);
    expect(saved.groups?.[0].layers).toEqual(p.groups![0].layers);
  });
});
