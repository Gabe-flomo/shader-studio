/**
 * Play mappings: a source reading goes through range, curve and smoothing and
 * lands on the control's param uniform by the compiler's binding key, never a
 * hand-built name. Colour controls start from the slider's colour each frame.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { compileGraph } from '../../compiler/graphCompiler';
import { inputBus } from '../inputBus';
import { midiEngine } from '../midiEngine';
import { applyCurve, mapValue, playEngine, bindingKeyOf } from '../playEngine';
import { emptyPlayRecord, parsePlayRecord, type PlayRecord } from '../../types/play';
import { bakeControlValues, collectPlayCandidates, readBaseValues, readControlValue, targetParts } from '../../play/playControls';
import type { GraphNode } from '../../types/nodeGraph';

function floatNode(id: string, value: number): GraphNode {
  return { id, type: 'constant', position: { x: 0, y: 0 }, inputs: { value: { type: 'float', label: 'Value' } }, outputs: { value: { type: 'float', label: 'Value' } }, params: { value, x: 0, y: 0, z: 0, w: 1, outputType: 'float' } } as GraphNode;
}
function colorNode(id: string, color: number[]): GraphNode {
  return { id, type: 'colorRamp', position: { x: 0, y: 0 }, inputs: { t: { type: 'float', label: 'T' } }, outputs: { color: { type: 'vec3', label: 'Color' } }, params: { stops: 2, color0: color, color1: [1, 1, 1] } } as GraphNode;
}
function outputNode(fromId: string, outKey: string): GraphNode {
  return {
    id: 'out', type: 'output', position: { x: 600, y: 0 },
    inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: fromId, outputKey: outKey } } },
    outputs: {}, params: {},
  } as GraphNode;
}

const RECORD: PlayRecord = {
  version: 1,
  controls: [
    { id: 'c1', target: 'node_3::value', kind: 'float', label: 'Amount', min: 0, max: 10 },
    { id: 'c2', target: 'node_4::color0', kind: 'color', label: 'Tint', min: 0, max: 1 },
  ],
  mappings: [
    { id: 'm1', controlId: 'c1', source: { kind: 'midi', signal: 'cc', channel: 0, cc: 74 }, outMin: 2, outMax: 4, curve: 'linear', smoothMs: 0, enabled: true },
    { id: 'm2', controlId: 'c2', source: { kind: 'midi', signal: 'velocity', channel: 0 }, outMin: 0, outMax: 1, curve: 'linear', smoothMs: 0, channel: 0, enabled: true },
  ],
};

afterEach(() => {
  playEngine.setRecord(emptyPlayRecord());
  playEngine.setBaseValues(new Map());
  inputBus.setBindings({});
  inputBus.setParamBindings({});
  midiEngine.handleBytes(0xb0, 74, 0);
});

describe('mapping math', () => {
  it('shapes 0..1 by curve and clamps', () => {
    expect(applyCurve(0.5, 'linear')).toBe(0.5);
    expect(applyCurve(0.5, 'exp')).toBeCloseTo(0.25);
    expect(applyCurve(0.25, 'log')).toBeCloseTo(0.5);
    expect(applyCurve(1.5, 'linear')).toBe(1);
    expect(applyCurve(-1, 'exp')).toBe(0);
  });
  it('maps into the output range, inverted ranges included', () => {
    expect(mapValue(0.5, { outMin: 2, outMax: 4, curve: 'linear' })).toBe(3);
    expect(mapValue(1, { outMin: 4, outMax: 2, curve: 'linear' })).toBe(2);
  });
  it('binding key is the last two segments of a target path', () => {
    expect(bindingKeyOf('node_3::value')).toBe('node_3::value');
    expect(bindingKeyOf('group_1::node_3::value')).toBe('node_3::value');
    expect(targetParts('group_1::node_3::value')).toEqual({ nodeId: 'group_1', paramKey: 'node_3::value' });
  });
});

describe('play engine on the bus', () => {
  it('writes a mapped float to the compiled param uniform and restores the slider when unmapped', () => {
    const nodes = [floatNode('node_3', 1), outputNode('node_3', 'value')];
    const r = compileGraph({ nodes });
    expect(r.success).toBe(true);
    const uniform = r.paramBindings['node_3::value'];
    expect(uniform).toBeDefined();
    inputBus.setParamBindings(r.paramBindings);
    playEngine.setRecord({ ...RECORD, controls: [RECORD.controls[0]], mappings: [RECORD.mappings[0]] });
    playEngine.setBaseValues(readBaseValues(nodes, RECORD));

    midiEngine.handleBytes(0xb0, 74, 127); // CC 74 at max → outMax
    let values = inputBus.tick(1 / 60, 0);
    expect(values.get(uniform)).toBeCloseTo(4);
    expect(playEngine.liveValue('c1')).toBeCloseTo(4);
    expect(inputBus.changed()).toBe(true);

    // Same reading again: written again, but nothing moved.
    values = inputBus.tick(1 / 60, 0);
    expect(values.get(uniform)).toBeCloseTo(4);
    expect(inputBus.changed()).toBe(false);

    // Disable the mapping: the slider's value (1) is written once, then nothing.
    playEngine.setRecord({ ...RECORD, controls: [RECORD.controls[0]], mappings: [{ ...RECORD.mappings[0], enabled: false }] });
    values = inputBus.tick(1 / 60, 0);
    expect(values.get(uniform)).toBe(1);
    expect(playEngine.liveValue('c1')).toBeUndefined();
    values = inputBus.tick(1 / 60, 0);
    expect(values.has(uniform)).toBe(false);
  });

  it('smooths toward the target and settles exactly', () => {
    const r = compileGraph({ nodes: [floatNode('node_3', 0), outputNode('node_3', 'value')] });
    inputBus.setParamBindings(r.paramBindings);
    const uniform = r.paramBindings['node_3::value'];
    playEngine.setRecord({ ...RECORD, controls: [RECORD.controls[0]], mappings: [{ ...RECORD.mappings[0], smoothMs: 100 }] });
    midiEngine.handleBytes(0xb0, 74, 0);
    inputBus.tick(1 / 60, 0); // first frame snaps to the start value (2)
    midiEngine.handleBytes(0xb0, 74, 127);
    const first = inputBus.tick(1 / 60, 0).get(uniform) as number;
    expect(first).toBeGreaterThan(2);
    expect(first).toBeLessThan(4);
    for (let i = 0; i < 200; i++) inputBus.tick(1 / 60, 0);
    expect(inputBus.tick(1 / 60, 0).get(uniform)).toBe(4);
  });

  it('writes one colour channel over the slider colour, in place', () => {
    const nodes = [colorNode('node_4', [0.2, 0.4, 0.6]), outputNode('node_4', 'color')];
    const r = compileGraph({ nodes });
    expect(r.success).toBe(true);
    const uniform = r.paramBindings['node_4::color0'];
    expect(uniform).toBeDefined();
    inputBus.setParamBindings(r.paramBindings);
    playEngine.setRecord({ ...RECORD, controls: [RECORD.controls[1]], mappings: [RECORD.mappings[1]] });
    playEngine.setBaseValues(readBaseValues(nodes, RECORD));
    midiEngine.handleBytes(0x90, 60, 127);
    const a = inputBus.tick(1 / 60, 0).get(uniform) as number[];
    expect(a[0]).toBeCloseTo(1);
    expect(a[1]).toBeCloseTo(0.4);
    expect(a[2]).toBeCloseTo(0.6);
    const b = inputBus.tick(1 / 60, 0).get(uniform) as number[];
    expect(b).toBe(a); // same buffer, no per-frame allocation
    midiEngine.handleBytes(0x80, 60, 0);
  });

  it('leaves a control alone until its source has produced a reading', () => {
    const nodes = [floatNode('node_3', 1), outputNode('node_3', 'value')];
    const r = compileGraph({ nodes });
    inputBus.setParamBindings(r.paramBindings);
    const uniform = r.paramBindings['node_3::value'];
    // CC 9 has never been received in this process.
    playEngine.setRecord({ ...RECORD, controls: [RECORD.controls[0]], mappings: [{ ...RECORD.mappings[0], source: { kind: 'midi', signal: 'cc', channel: 0, cc: 9 } }] });
    playEngine.setBaseValues(readBaseValues(nodes, RECORD));
    expect(playEngine.readSource({ kind: 'midi', signal: 'cc', channel: 0, cc: 9 })).toBeNull();
    expect(inputBus.tick(1 / 60, 0).has(uniform)).toBe(false);
    expect(playEngine.liveValue('c1')).toBeUndefined();
    midiEngine.handleBytes(0xb0, 9, 0);
    expect(inputBus.tick(1 / 60, 0).get(uniform)).toBeCloseTo(2);
  });

  it('lets one control drive another across its range', () => {
    const nodes = [floatNode('node_3', 1), floatNode('node_5', 0.5), outputNode('node_3', 'value')];
    const r = compileGraph({ nodes });
    inputBus.setParamBindings(r.paramBindings);
    const target = r.paramBindings['node_3::value'];
    const record: PlayRecord = {
      version: 1,
      controls: [
        { id: 'a', target: 'node_5::value', kind: 'float', label: 'A', min: 0, max: 1 },
        { id: 'b', target: 'node_3::value', kind: 'float', label: 'B', min: 0, max: 10 },
      ],
      mappings: [{ id: 'm', controlId: 'b', source: { kind: 'control', controlId: 'a' }, outMin: 0, outMax: 10, curve: 'linear', smoothMs: 0, enabled: true }],
    };
    playEngine.setRecord(record);
    playEngine.setBaseValues(readBaseValues(nodes, record));
    // A's slider sits at 0.5 of its range → B at 5.
    expect(inputBus.tick(1 / 60, 0).get(target)).toBeCloseTo(5);
    // Dragging A (a store write → new base values) moves B.
    playEngine.setBaseValues(new Map([['a', 0.25], ['b', 1]]));
    expect(inputBus.tick(1 / 60, 0).get(target)).toBeCloseTo(2.5);
  });

  it('reads a unit value per source kind', () => {
    midiEngine.handleBytes(0xe0, 0, 64); // bend centre
    expect(playEngine.readSource({ kind: 'midi', signal: 'bend', channel: 0 })).toBeCloseTo(0.5);
    expect(playEngine.readSource({ kind: 'key', code: 'KeyD' })).toBe(0);
    expect(playEngine.readSource({ kind: 'mouse', axis: 'down' })).toBe(0);
  });
});

describe('controls and the record', () => {
  it('offers only params the compiler made live uniforms', () => {
    const nodes = [floatNode('node_3', 1), colorNode('node_4', [0, 0, 0]), outputNode('node_3', 'value')];
    const r = compileGraph({ nodes });
    const all = collectPlayCandidates(nodes, r.paramBindings);
    expect(all.map(c => `${c.kind}:${c.target}`).sort()).toEqual(['color:node_4::color0', 'color:node_4::color1', 'float:node_3::value']);
    // Nothing compiled → nothing to expose.
    expect(collectPlayCandidates(nodes, {})).toEqual([]);
    expect(readControlValue(nodes, 'node_4::color0')).toEqual([0, 0, 0]);
    expect(readControlValue(nodes, 'node_9::value')).toBeUndefined();
  });

  it('bakes live values into a copy of the graph for an instrument export', () => {
    const nodes = [floatNode('node_3', 1), colorNode('node_4', [0, 0, 0])];
    const baked = bakeControlValues(nodes, RECORD, new Map<string, number | number[]>([['c1', 7], ['c2', [1, 0.5, 0]]]));
    expect(readControlValue(baked, 'node_3::value')).toBe(7);
    expect(readControlValue(baked, 'node_4::color0')).toEqual([1, 0.5, 0]);
    expect(readControlValue(nodes, 'node_3::value')).toBe(1); // the original is untouched
    expect(bakeControlValues(nodes, RECORD, new Map())).toBe(nodes);
  });

  it('parses a saved record, dropping what is malformed, and round-trips a good one', () => {
    expect(parsePlayRecord(undefined)).toEqual(emptyPlayRecord());
    expect(parsePlayRecord(JSON.parse(JSON.stringify(RECORD)))).toEqual(RECORD);
    const messy = parsePlayRecord({
      controls: [
        { id: 'a', target: 'n::k', min: 5, max: 1 },        // swapped range, no label → fixed up
        { id: 'a', target: 'dup::k' },                       // duplicate id → dropped
        { target: 'no-id::k' },                              // no id → dropped
      ],
      mappings: [
        { id: 'm', controlId: 'a', source: { kind: 'midi', signal: 'cc', cc: 300 }, curve: 'bogus' },
        { id: 'gone', controlId: 'zzz', source: { kind: 'key', code: 'KeyA' } }, // control missing → dropped
        { id: 'bad', controlId: 'a', source: { kind: 'laser' } },                // unknown source → dropped
      ],
    });
    expect(messy.controls).toEqual([{ id: 'a', target: 'n::k', kind: 'float', label: 'n::k', min: 1, max: 5 }]);
    expect(messy.mappings).toHaveLength(1);
    // A control source must name another existing control.
    const self = parsePlayRecord({ controls: [{ id: 'a', target: 'n::k' }, { id: 'b', target: 'n::j' }], mappings: [
      { id: 'ok', controlId: 'a', source: { kind: 'control', controlId: 'b' } },
      { id: 'self', controlId: 'a', source: { kind: 'control', controlId: 'a' } },
      { id: 'gone', controlId: 'a', source: { kind: 'control', controlId: 'zzz' } },
    ] });
    expect(self.mappings.map(m => m.id)).toEqual(['ok']);
    expect(messy.mappings[0]).toMatchObject({ id: 'm', curve: 'linear', enabled: true, smoothMs: 0, source: { kind: 'midi', signal: 'cc', channel: 0, cc: 127 } });
  });
});
