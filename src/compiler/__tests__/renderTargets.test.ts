/**
 * Render Targets (MRT) (nodes/definitions/renderTargets.ts, compiler/renderTargetsExpand.ts): several
 * textures from one draw: one Pass with extra targets, its sink writing pc_mrt<k>.
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
import { expandRenderTargets, targetsPackId } from '../renderTargetsExpand';
import { getNodeDefinition } from '../../nodes/definitions';
import { asVec4, retypeRenderTargets, targetsOf } from '../../nodes/definitions/renderTargets';
import { retypeDataTexture } from '../../nodes/definitions/dataTexture';
import { passExtraTargets } from '../../nodes/definitions/passes';
import { webPasses } from '../../play/webInput';
import { ppTargetKey } from '../../play/kit/passPlan.js';

const compile = (nodes: GraphNode[]) => compileGraph({ nodes }) as CompilationResult;
const rt = (params: Record<string, unknown> = {}, wires: Record<string, [string, string]> = {}) =>
  retypeRenderTargets(n('renderTargets', 'rt', 0, 0, params, wires));
const read = (id: string, from: [string, string], channels = 'rgb') => retypeDataTexture(n('readChannels', id, 0, 0, { channels }, { texture: from }));

describe('Render Targets: the node', () => {
  it('defaults to two targets: state (vec4, full float, exact) and colour (vec3, half, smooth)', () => {
    const node = rt();
    expect(targetsOf(node).map(t => [t.name, t.type, t.format, t.read])).toEqual([['state', 'vec4', 'float', 'exact'], ['colour', 'vec3', 'half', 'smooth']]);
    expect(Object.keys(node.inputs)).toEqual(['in0', 'in1']);
    expect(Object.keys(node.outputs)).toEqual(['texture', 'previous', 'texture1', 'previous1']);
    expect(node.inputs.in1.type).toBe('vec3');
  });

  it('one to four targets; sockets follow them', () => {
    const four = rt({ targets: Array.from({ length: 6 }, (_, i) => ({ name: `t${i}`, type: 'float' })) });
    expect(targetsOf(four)).toHaveLength(4);
    expect(Object.keys(four.outputs)).toContain('previous3');
    expect(targetsOf(rt({ targets: [] }))).toHaveLength(2);
  });

  it('pads each target to a vec4: unused channels 0, alpha 1', () => {
    expect(asVec4('v', 'float')).toBe('vec4(v, 0.0, 0.0, 1.0)');
    expect(asVec4('v', 'vec3')).toBe('vec4(v, 1.0)');
    expect(asVec4('v', 'vec4')).toBe('(v)');
  });

  it('is in the library with the texture tools', () => {
    expect(getNodeDefinition('renderTargets')!.category).toBe('Texture tools');
    expect(getNodeDefinition('renderTargets')!.aliases).toContain('MRT');
  });
});

describe('Render Targets: compiles to one Pass that draws every target at once', () => {
  const graph = (): GraphNode[] => [
    n('uv', 'uvn', 0, 0),
    n('swizzle', 'col', 0, 0, { inputType: 'vec2', pattern: 'xyx' }, { input: ['uvn', 'uv'] }),
    rt({}, { in1: ['col', 'output'] }),
    read('show', ['rt', 'texture1']),
    n('output', 'out', 0, 0, {}, { color: ['show', 'value'] }),
  ];

  it('opens into a pack and a Pass with one extra target', () => {
    const open = expandRenderTargets(graph());
    const pass = open.find(x => x.id === 'rt')!;
    expect(pass.type).toBe('pass');
    expect(passExtraTargets(pass.params)).toEqual([{ format: 'half', filter: 'linear' }]);
    expect(pass.params).toMatchObject({ format: 'float', filter: 'nearest' });
    expect(pass.inputs.mrt1.connection).toEqual({ nodeId: targetsPackId('rt'), outputKey: 'mrt1' });
  });

  it('the pass program writes both targets; the picture samples target 2', () => {
    const r = compile(graph());
    expect(r.errors ?? []).toEqual([]);
    expect(r.success).toBe(true);
    const p = r.passes!.find(x => x.nodeId === 'rt')!;
    expect(p.extra).toEqual([{ format: 'half', filter: 'linear' }]);
    expect(p.fragmentShader).toContain('layout(location = 1) out highp vec4 pc_mrt1;');
    expect(p.fragmentShader).toMatch(/pc_mrt1 = rt__pack_\w*t1|pc_mrt1 = \w+_t1;/);
    expect(p.fragmentShader).toContain('gl_FragColor = vec4(');
    expect(r.fragmentShader).toMatch(/uniform sampler2D u_pass_\w+_1;/);
  });

  it('reading a target a frame ago in what feeds it is not a loop; reading it this frame is', () => {
    const nodes: GraphNode[] = [
      read('last', ['rt', 'previous1']),
      rt({}, { in1: ['last', 'value'] }),
      read('show', ['rt', 'texture1']),
      n('output', 'out', 0, 0, {}, { color: ['show', 'value'] }),
    ];
    const byId = new Map(nodes.map(x => [x.id, x]));
    expect(isFrameDelayWire({ nodeId: 'rt', outputKey: 'previous1' }, byId)).toBe(true);
    expect(isFrameDelayWire({ nodeId: 'rt', outputKey: 'texture1' }, byId)).toBe(false);
    expect(loopIfWired(nodes, 'rt', 'previous1', 'last', 'texture')).toBeNull();
    const r = compile(nodes);
    expect(r.errors ?? []).toEqual([]);
    const p = r.passes!.find(x => x.nodeId === 'rt')!;
    expect(p.previous).toBe(true);
    expect(p.fragmentShader).toMatch(/u_passprev_\w+_1/);
  });

  it('the exported page gets every target and its sampler names', () => {
    const r = compile(graph());
    const w = webPasses(r.passes!).find(x => x.slug === r.passes!.find(p => p.nodeId === 'rt')!.slug)!;
    expect(w.extra).toHaveLength(1);
    expect(w.u.extra![0].tex).toMatch(/^u_pass_\w+_1$/);
    expect(w.u.extra![0].prev).toMatch(/^u_passprev_\w+_1$/);
  });

  it('a target\'s settings change the texture key, so the targets are made again', () => {
    const base = { scale: 1, format: 'half', filter: 'linear', wrap: 'clamp', previous: false };
    expect(ppTargetKey({ ...base, extra: [{ format: 'half', filter: 'linear' }] }, 100, 100))
      .not.toBe(ppTargetKey({ ...base, extra: [{ format: 'float', filter: 'nearest' }] }, 100, 100));
    expect(ppTargetKey(base, 100, 100)).toBe('100x100:half:linear:clamp:1');
  });
});

describe('Render Targets: the example', () => {
  it('Texture tools 12 compiles into one pass with two targets, reading both a frame ago', async () => {
    const { buildTextureToolExamples } = await import('../../store/textureToolExamples');
    const ex = buildTextureToolExamples().ttRenderTargets;
    const r = compile(ex.nodes);
    expect(r.errors ?? []).toEqual([]);
    expect(r.success).toBe(true);
    const p = r.passes!.find(x => x.nodeId === 'rt')!;
    expect(p.format).toBe('float');
    expect(p.extra).toEqual([{ format: 'half', filter: 'linear' }]);
    expect(p.previous).toBe(true);
    expect(r.passes!.filter(x => !x.hidden)).toHaveLength(1);
  });
});
