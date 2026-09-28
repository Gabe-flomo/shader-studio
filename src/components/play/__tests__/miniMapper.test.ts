/**
 * miniMapperCore.ts — the mini mapper's wiring: "Control only" makes the
 * control alone, a picked source makes the control (if needed) and a
 * mapping across its whole range, Increment adds its defaults on top, and
 * the categories are gated on MIDI devices and a Camera layer for Hands.
 */
import { describe, it, expect } from 'vitest';
import { emptyPlayRecord, defaultIncrement, type PlayLayer, type PlayRecord } from '../../../types/play';
import { defaultLayer } from '../../../types/playLayers';
import {
  CONTROL_ONLY, INCREMENT, MIDI_LEARN, miniMapperSections, wireControlOnly, wireIncrement, wireMiniMapperPick, wireSource,
} from '../miniMapperCore';

const shapeLayer = (id: string, label: string): PlayLayer => defaultLayer('shape', id, label) as PlayLayer;
const cameraLayer = (id: string, label: string): PlayLayer => defaultLayer('camera', id, label) as PlayLayer;

describe('wireControlOnly', () => {
  it('adds the control with no mapping', () => {
    const play = emptyPlayRecord();
    const layers = [shapeLayer('l1', 'Circle')];
    const p: PlayRecord = { ...play, layers };
    const r = wireControlOnly(p, { layerId: 'l1', key: 'w' });
    expect(r.control).toBeDefined();
    expect(r.play.mappings).toHaveLength(0);
    expect(r.play.controls).toHaveLength(1);
    expect(r.play.controls[0].target).toBe('layer:l1::w');
  });

  it('is unchanged when the target does not resolve to a control', () => {
    const p = emptyPlayRecord();
    const r = wireControlOnly(p, { layerId: 'missing', key: 'w' });
    expect(r.control).toBeUndefined();
    expect(r.play.controls).toHaveLength(0);
  });
});

describe('wireSource', () => {
  it('makes the control and a mapping across its whole range', () => {
    const layers = [shapeLayer('l1', 'Circle')];
    const p: PlayRecord = { ...emptyPlayRecord(), layers };
    const r = wireSource(p, { kind: 'lfo', shape: 'sine', rate: 0.5, phase: 0 }, { layerId: 'l1', key: 'w' });
    expect(r.control).toBeDefined();
    expect(r.mapping).toBeDefined();
    expect(r.mapping!.source).toEqual({ kind: 'lfo', shape: 'sine', rate: 0.5, phase: 0 });
    expect(r.mapping!.outMin).toBe(r.control!.min);
    expect(r.mapping!.outMax).toBe(r.control!.max);
    expect(r.play.controls).toHaveLength(1);
    expect(r.play.mappings).toHaveLength(1);
  });

  it('reuses the control already on the panel instead of adding a second one', () => {
    const layers = [shapeLayer('l1', 'Circle')];
    const p: PlayRecord = { ...emptyPlayRecord(), layers };
    const first = wireSource(p, { kind: 'mouse', axis: 'x' }, { layerId: 'l1', key: 'w' });
    const second = wireSource(first.play, { kind: 'mouse', axis: 'y' }, { layerId: 'l1', key: 'w' });
    expect(second.play.controls).toHaveLength(1);
    expect(second.play.mappings).toHaveLength(2);
    expect(second.mapping!.controlId).toBe(first.control!.id);
  });
});

describe('wireMiniMapperPick', () => {
  const base = (): PlayRecord => ({ ...emptyPlayRecord(), layers: [shapeLayer('l1', 'Circle')] });

  it('CONTROL_ONLY adds the control without a mapping', () => {
    const r = wireMiniMapperPick(base(), CONTROL_ONLY, { layerId: 'l1', key: 'w' });
    expect(r.control).toBeDefined();
    expect(r.mapping).toBeUndefined();
    expect(r.play.mappings).toHaveLength(0);
  });

  it('a generator value (lfo, noise, clock, fn) wires that source', () => {
    const r = wireMiniMapperPick(base(), 'clock', { layerId: 'l1', key: 'w' });
    expect(r.mapping!.source.kind).toBe('clock');
  });

  it('a mouse/keys value wires that source', () => {
    const r = wireMiniMapperPick(base(), 'mouse:y', { layerId: 'l1', key: 'w' });
    expect(r.mapping!.source).toEqual({ kind: 'mouse', axis: 'y' });
  });

  it('a midi value (note, velocity, gate, bend) wires that source', () => {
    const r = wireMiniMapperPick(base(), 'midi:velocity', { layerId: 'l1', key: 'w' });
    expect(r.mapping!.source).toMatchObject({ kind: 'midi', signal: 'velocity' });
  });

  it('a hand value wires that source', () => {
    const r = wireMiniMapperPick(base(), 'hand:pinch', { layerId: 'l1', key: 'w' });
    expect(r.mapping!.source).toMatchObject({ kind: 'hand', read: 'pinch' });
  });

  it('a sensor:<layerId>:<read> value wires a layer sensor onto the target', () => {
    const layers = [shapeLayer('src', 'Source'), shapeLayer('dst', 'Dest')];
    const p: PlayRecord = { ...emptyPlayRecord(), layers };
    const r = wireMiniMapperPick(p, 'sensor:src:fill', { layerId: 'dst', key: 'w' });
    expect(r.mapping!.source).toEqual({ kind: 'sensor', layerId: 'src', read: 'fill', otherId: '' });
  });

  it('a control:<id> value follows that control', () => {
    const p = base();
    const withCtl = wireControlOnly(p, { layerId: 'l1', key: 'w' }).play;
    const ctl = withCtl.controls[0];
    const layers = [...withCtl.layers, shapeLayer('l2', 'Second')];
    const r = wireMiniMapperPick({ ...withCtl, layers }, `control:${ctl.id}`, { layerId: 'l2', key: 'w' });
    expect(r.mapping!.source).toEqual({ kind: 'control', controlId: ctl.id });
  });

  it('a reader:<id> value wires that audio reader', () => {
    const r = wireMiniMapperPick(base(), 'reader:kick', { layerId: 'l1', key: 'w' });
    expect(r.mapping!.source).toEqual({ kind: 'reader', readerId: 'kick' });
  });

  it('INCREMENT adds increment defaults and a harmless placeholder source', () => {
    const r = wireMiniMapperPick(base(), INCREMENT, { layerId: 'l1', key: 'w' });
    expect(r.mapping).toBeDefined();
    expect(r.mapping!.increment).toBeDefined();
    expect(r.mapping!.increment!.on).toBe(defaultIncrement().on);
  });

  it('never dispatches MIDI_LEARN itself (MiniMapper.tsx drives that one, since it waits for an input)', () => {
    expect(() => wireMiniMapperPick(base(), MIDI_LEARN, { layerId: 'l1', key: 'w' })).not.toThrow();
  });
});

describe('wireIncrement', () => {
  it('sizes the default step to an eighth of the control range', () => {
    const layers = [shapeLayer('l1', 'Circle')];
    const p: PlayRecord = { ...emptyPlayRecord(), layers };
    const r = wireIncrement(p, { layerId: 'l1', key: 'w' });
    const ctl = r.control!;
    const expected = Math.round(((ctl.max - ctl.min) / 8) * 1000) / 1000;
    expect(r.mapping!.increment!.step).toBe(expected);
  });
});

describe('miniMapperSections', () => {
  const play = (): PlayRecord => ({ ...emptyPlayRecord(), layers: [shapeLayer('l1', 'Circle')] });

  it('always has Control only, Mouse & keys, Audio, Generators and Increment', () => {
    const headings = miniMapperSections({ play: play(), midiDevices: [], hasCamera: false }).map(s => s.heading);
    expect(headings).toEqual(expect.arrayContaining(['Control only', 'Mouse & keys', 'Audio', 'Generators', 'Increment']));
    expect(headings).not.toContain('MIDI');
    expect(headings).not.toContain('Hands');
  });

  it('shows MIDI only when a device has been seen', () => {
    const withDevice = miniMapperSections({ play: play(), midiDevices: ['MPK mini'], hasCamera: false });
    expect(withDevice.find(s => s.heading === 'MIDI')?.items.map(i => i.value)).toContain(MIDI_LEARN);
    expect(miniMapperSections({ play: play(), midiDevices: [], hasCamera: false }).find(s => s.heading === 'MIDI')).toBeUndefined();
  });

  it('shows Hands only when a Camera layer exists', () => {
    const layers = [shapeLayer('l1', 'Circle'), cameraLayer('cam', 'Camera')];
    const p: PlayRecord = { ...emptyPlayRecord(), layers };
    expect(miniMapperSections({ play: p, midiDevices: [], hasCamera: true }).find(s => s.heading === 'Hands')).toBeDefined();
    expect(miniMapperSections({ play: play(), midiDevices: [], hasCamera: false }).find(s => s.heading === 'Hands')).toBeUndefined();
  });

  it('lists each layer’s sensor reads under Layers', () => {
    const sections = miniMapperSections({ play: play(), midiDevices: [], hasCamera: false });
    const layersSection = sections.find(s => s.heading === 'Layers');
    expect(layersSection?.items.some(i => i.value.startsWith('sensor:l1:'))).toBe(true);
  });

  it('lists existing controls under Controls only once there is one', () => {
    const empty = miniMapperSections({ play: play(), midiDevices: [], hasCamera: false });
    expect(empty.find(s => s.heading === 'Controls')).toBeUndefined();
    const withCtl = wireControlOnly(play(), { layerId: 'l1', key: 'w' }).play;
    const sections = miniMapperSections({ play: withCtl, midiDevices: [], hasCamera: false });
    expect(sections.find(s => s.heading === 'Controls')?.items[0].value).toBe(`control:${withCtl.controls[0].id}`);
  });
});
