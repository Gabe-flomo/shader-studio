/**
 * Data Texture and Read channels (nodes/definitions/dataTexture.ts, compiler/dataTextureExpand.ts).
 */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});

import { compileGraph } from '../graphCompiler';
import type { CompilationResult } from '../types';
import type { GraphNode } from '../../types/nodeGraph';
import { n } from '../../store/graphBuilder';
import { isFrameDelayWire, loopIfWired } from '../graphLoops';
import { dataPackId, dataReadId, expandDataTextures } from '../dataTextureExpand';
import { getNodeDefinition } from '../../nodes/definitions';
import {
  fieldsOf, packCode, readCode, readsOf, retypeDataTexture, shortFields, typeForWidth,
} from '../../nodes/definitions/dataTexture';

const compile = (nodes: GraphNode[]) => compileGraph({ nodes }) as CompilationResult;
const dt = (params: Record<string, unknown> = {}, wires: Record<string, [string, string]> = {}) =>
  retypeDataTexture(n('dataTexture', 'dt', 0, 0, params, wires));

describe('Data Texture: fields and reads', () => {
  it('defaults: position (vec2 → rg) and value (vec2 → ba), read back the same', () => {
    const node = dt();
    expect(fieldsOf(node)).toEqual([{ name: 'position', type: 'vec2', channels: 'rg' }, { name: 'value', type: 'vec2', channels: 'ba' }]);
    expect(node.inputs.in0.type).toBe('vec2');
    expect(node.outputs.out0.type).toBe('vec2');
    expect(node.outputs.texture.type).toBe('texture');
    expect(node.outputs.previous.type).toBe('texture');
    expect(node.params.format).toBe('float');
    expect(node.params.read).toBe('exact');
  });

  it('at most four inputs, each as many channels as it is wide; taken channels are not reused', () => {
    const f = fieldsOf({ params: { fields: [
      { name: 'a', type: 'float', channels: 'g' },
      { name: 'b', type: 'vec2', channels: 'gg' },
      { name: 'c', type: 'float', channels: '' },
      { name: 'd', type: 'float', channels: 'r' },
      { name: 'e', type: 'float', channels: 'r' },
    ] } });
    expect(f.map(x => x.channels)).toEqual(['g', 'rb', 'a', '']);
    expect(shortFields({ params: { fields: f } })).toEqual(['d']);
  });

  it('a float and a vec3, two vec2s, four floats all fit', () => {
    expect(fieldsOf({ params: { fields: [{ name: 'f', type: 'float', channels: 'a' }, { name: 'v', type: 'vec3', channels: 'rgb' }] } }).map(x => x.channels)).toEqual(['a', 'rgb']);
    expect(fieldsOf({ params: { fields: ['r', 'g', 'b', 'a'].map(c => ({ name: c, type: 'float', channels: c })) } }).map(x => x.channels)).toEqual(['r', 'g', 'b', 'a']);
  });

  it('an output is as wide as its channels, whichever they are', () => {
    const node = dt({ reads: [{ name: 'x', channels: 'b' }, { name: 'xy', channels: 'rb' }, { name: 'xyz', channels: 'agr' }, { name: 'all', channels: 'abgr' }] });
    expect(['out0', 'out1', 'out2', 'out3'].map(k => node.outputs[k].type)).toEqual(['float', 'vec2', 'vec3', 'vec4']);
    expect(readsOf(node).map(r => r.channels)).toEqual(['b', 'rb', 'agr', 'abgr']);
  });

  it('retyping keeps wires that still fit and drops ones that do not', () => {
    const node = dt({}, { in0: ['src', 'out'], in1: ['src', 'out'] });
    const changed = retypeDataTexture({ ...node, params: { ...node.params, fields: [{ name: 'p', type: 'vec2', channels: 'rg' }, { name: 'q', type: 'float', channels: 'b' }] } });
    expect(changed.inputs.in0.connection).toEqual({ nodeId: 'src', outputKey: 'out' });
    expect(changed.inputs.in1.type).toBe('float');
    expect(changed.inputs.in1.connection).toBeUndefined();
  });

  it('Read channels: output type follows the pattern', () => {
    const rc = retypeDataTexture(n('readChannels', 'rc', 0, 0, { channels: 'rgb' }));
    expect(rc.outputs.value.type).toBe('vec3');
    expect(retypeDataTexture({ ...rc, params: { channels: 'a' } }).outputs.value.type).toBe('float');
    expect(typeForWidth(4)).toBe('vec4');
  });
});

describe('Data Texture: GLSL', () => {
  it('pack writes each field into its channels; Range squeezes; unused alpha is 1', () => {
    const node = dt({ storage: 'range', rangeMin: -2, rangeMax: 2, fields: [{ name: 'p', type: 'vec2', channels: 'ga' }] });
    const { code } = packCode(node, { in0: 'pos' });
    expect(code).toContain('dt_d.ga = (pos);');
    expect(code).toContain('/ max(2.0 - -2.0, 1e-6)');
    expect(packCode(dt(), { in0: 'pos' }).code).not.toContain('_d.a = 1.0');
    expect(packCode(dt({ fields: [{ name: 'p', type: 'vec2', channels: 'rg' }] }), {}).code).toContain('_d.a = 1.0');
  });

  it('exact reads use texelFetch; smooth reads filter; the range is undone', () => {
    const exact = readCode('r', 'u_tex', undefined, { read: 'exact' }, 'rb');
    expect(exact.code).toContain('texelFetch(u_tex');
    expect(exact.code).toContain('vec2 r_v = r_s.rb;');
    const smooth = readCode('r', 'u_tex', 'myUv', { read: 'smooth', storage: 'range', rangeMin: 0, rangeMax: 4 }, 'g');
    expect(smooth.code).toContain('texture2D(u_tex');
    expect(smooth.code).toContain('r_s = r_s * (4.0 - 0.0) + 0.0;');
    expect(smooth.type).toBe('float');
  });
});

describe('Data Texture: compiles into a Pass', () => {
  const base = (extra: GraphNode[] = [], out: [string, string] = ['use', 'output']) => [
    n('uv', 'uvn', 0, 0),
    dt({}, { in0: ['uvn', 'uv'] }),
    ...extra,
    n('output', 'out', 0, 0, {}, { color: out }),
  ];

  it('opens into a pack, a Pass with the node id, and a Read channels for the output in use', () => {
    const nodes = base([n('swizzle', 'use', 0, 0, { inputType: 'vec2', pattern: 'xyx' }, { input: ['dt', 'out0'] })]);
    const open = expandDataTextures(nodes);
    expect(open.find(x => x.id === 'dt')!.type).toBe('pass');
    expect(open.find(x => x.id === dataPackId('dt'))!.type).toBe('dataTexturePack');
    expect(open.find(x => x.id === dataReadId('dt', 0, false))!.type).toBe('readChannels');
    expect(open.find(x => x.id === 'dt')!.params).toMatchObject({ format: 'float', filter: 'nearest' });
  });

  it('compiles: a full-float pass, its program packs the field', () => {
    const r = compile(base([n('swizzle', 'use', 0, 0, { inputType: 'vec2', pattern: 'xyx' }, { input: ['dt', 'out0'] })]));
    expect(r.errors ?? []).toEqual([]);
    expect(r.success).toBe(true);
    const pass = r.passes!.find(pp => pp.nodeId === 'dt')!;
    expect(pass.format).toBe('float');
    expect(pass.filter).toBe('nearest');
    expect(pass.fragmentShader).toContain('.rg = (');
    expect(r.fragmentShader).toContain('texelFetch(');
  });

  it('a read that feeds the node is last frame (a simulation), and wiring it is not a loop', () => {
    // The position read back, turned (yx), written again: dt.out0 → swizzle → dt.in0.
    const nodes: GraphNode[] = [
      n('swizzle', 'add', 0, 0, { inputType: 'vec2', pattern: 'yx' }, { input: ['dt', 'out0'] }),
      dt({}, { in0: ['add', 'output'] }),
      n('swizzle', 'use', 0, 0, { inputType: 'vec2', pattern: 'xyx' }, { input: ['dt', 'out0'] }),
      n('output', 'out', 0, 0, {}, { color: ['use', 'output'] }),
    ];
    const byId = new Map(nodes.map(x => [x.id, x]));
    expect(isFrameDelayWire({ nodeId: 'dt', outputKey: 'out0' }, byId)).toBe(true);
    expect(loopIfWired(nodes, 'dt', 'out0', 'add', 'input')).toBeNull();
    const open = expandDataTextures(nodes);
    expect(open.find(x => x.id === 'add')!.inputs.input.connection).toEqual({ nodeId: dataReadId('dt', 0, true), outputKey: 'value' });
    expect(open.find(x => x.id === dataReadId('dt', 0, true))!.inputs.texture.connection).toEqual({ nodeId: 'dt', outputKey: 'previous' });
    expect(open.find(x => x.id === 'use')!.inputs.input.connection).toEqual({ nodeId: dataReadId('dt', 0, false), outputKey: 'value' });
    const r = compile(nodes);
    expect(r.errors ?? []).toEqual([]);
    expect(r.success).toBe(true);
  });

  it('Read channels reads any Pass', () => {
    const r = compile([
      n('colorPicker', 'paint', 0, 0, { color: [0.6, 0.3, 0.1] }),
      n('pass', 'src', 0, 0, { label: 'Source', format: 'float' }, { color: ['paint', 'rgb'] }),
      retypeDataTexture(n('readChannels', 'rc', 0, 0, { channels: 'bgr' }, { texture: ['src', 'texture'] })),
      n('output', 'out', 0, 0, {}, { color: ['rc', 'value'] }),
    ]);
    expect(r.errors ?? []).toEqual([]);
    expect(r.fragmentShader).toContain('.bgr;');
    expect(r.passes!.find(pp => pp.nodeId === 'src')!.format).toBe('float');
  });

  it('Texture tools 11 compiles, Step reads last frame and Look this frame', async () => {
    const { buildTextureToolExamples } = await import('../../store/textureToolExamples');
    const ex = buildTextureToolExamples().ttDataAdvect;
    const r = compile(ex.nodes);
    expect(r.errors ?? []).toEqual([]);
    expect(r.success).toBe(true);
    const open = expandDataTextures(ex.nodes);
    expect(open.find(x => x.id === 'advect')!.inputs.prev.connection!.nodeId).toBe(dataReadId('data', 0, true));
    expect(open.find(x => x.id === 'look')!.inputs.p.connection!.nodeId).toBe(dataReadId('data', 0, false));
  });

  it('is in the library with the texture tools; the pack is hidden', () => {
    expect(getNodeDefinition('dataTexture')!.category).toBe('Texture tools');
    expect(getNodeDefinition('readChannels')!.category).toBe('Texture tools');
    expect(getNodeDefinition('dataTexturePack')).toBeDefined();
  });
});
