/**
 * Send and Receive (docs/send-receive.md): a Receive compiles as a wire to its Send would, across group
 * boundaries both ways, follows the Send's type, gives zero with no Send, refuses a loop, survives a rename
 * and a save, and carries a texture.
 */
import { describe, it, expect, vi } from 'vitest';
vi.hoisted(() => vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} }));
import { compileGraph } from '../graphCompiler';
import { n, out, group, port } from '../../store/graphBuilder';
import type { GraphNode } from '../../types/nodeGraph';
import { compileFragment, type Val } from './glslRun';
import { duplicateSendIds, listSends, receiversOf, resolveSendReceive, syncSendReceiveTypes } from '../sendReceive';
import { buildSendReceiveExamples } from '../../store/sendReceiveExamples';
import { buildAgentExamples } from '../../store/agentExamples';

/** The colour one pixel gets, run on the CPU. */
function pixel(nodes: GraphNode[], t = 1.3, uv = [0.3, 0.7]): number[] {
  const r = compileGraph({ nodes });
  expect(r.errors ?? []).toEqual([]);
  const env: Record<string, Val> = { u_time: t, vUv: uv, u_resolution: [200, 100], ...(r.paramUniforms as Record<string, Val>) };
  compileFragment(r.fragmentShader).run(env as never);
  return env.gl_FragColor as number[];
}
const close = (a: number[], b: number[]) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 6));
const time = () => n('time', 'time', 0, 0);
const send = (id: string, name: string, from: [string, string]) => n('send', id, 0, 0, { name }, { value: from });
const receive = (id: string, sendId: string) => n('receive', id, 0, 0, { sendId });
/** A group of `iterations` whose inside turns a float into a colour, the float coming from `src` (a port or a Receive). */
const colourGroup = (id: string, src: GraphNode[], from: [string, string], iterations = 1, extra: Partial<Parameters<typeof group>[3]> = {}) => group(id, 0, 0, {
  label: id, iterations, inputs: [],
  outputs: [{ key: 'c', type: 'vec3', label: 'C', from: [`${id}f3`, 'rgb'] }],
  nodes: [...src, n('sin', `${id}s`, 0, 0, {}, { input: from }), n('floatToVec3', `${id}f3`, 0, 0, {}, { input: [`${id}s`, 'output'] })],
  ...extra,
});

describe('Send and Receive', () => {
  it('at one level: the same picture as a wire', () => {
    const wired = [time(), n('sin', 's', 0, 0, {}, { input: ['time', 'time'] }), n('floatToVec3', 'f3', 0, 0, {}, { input: ['s', 'output'] }), out(['f3', 'rgb'], 0)];
    const wireless = [time(), send('snd', 'beat', ['time', 'time']), receive('rcv', 'snd'), n('sin', 's', 0, 0, {}, { input: ['rcv', 'value'] }), n('floatToVec3', 'f3', 0, 0, {}, { input: ['s', 'output'] }), out(['f3', 'rgb'], 0)];
    close(pixel(wireless), pixel(wired));
    expect(pixel(wireless)[0]).toBeCloseTo(Math.sin(1.3), 6);
  });

  it('into an iterated group: the same as a group input port', () => {
    const viaPort = [time(), { ...colourGroup('g', [], port('t'), 3), inputs: { t: { type: 'float' as const, label: 't', connection: { nodeId: 'time', outputKey: 'time' } } } }, out(['g', 'c'], 0)];
    (viaPort[1].params.subgraph as { inputPorts: unknown[] }).inputPorts = [{ key: 't', type: 'float', label: 't', toNodeId: 'gs', toInputKey: 'input' }];
    const wireless = [time(), send('snd', 'beat', ['time', 'time']), colourGroup('g', [receive('rcv', 'snd')], ['rcv', 'value'], 3), out(['g', 'c'], 0)];
    close(pixel(wireless), pixel(viaPort));
    expect(pixel(wireless)[1]).toBeCloseTo(Math.sin(1.3), 6);
  });

  it('out of a group, and from one group into another nested two deep', () => {
    // The Send is inside group A (fed by Time there); one Receive is at the top, one inside C inside B.
    const a = group('A', 0, 0, { label: 'A', iterations: 1, inputs: [], outputs: [], nodes: [n('time', 'at', 0, 0), n('multiply', 'm', 0, 0, { b: 2 }, { a: ['at', 'time'] }), send('snd', 'beat', ['m', 'result'])] });
    const c = colourGroup('C', [receive('rcvC', 'snd')], ['rcvC', 'value']);
    const b = group('B', 0, 0, { label: 'B', iterations: 1, inputs: [], outputs: [{ key: 'c', type: 'vec3', label: 'C', from: ['C', 'c'] }], nodes: [c] });
    const top = [a, b, receive('rcvTop', 'snd'), n('floatToVec3', 'tf', 0, 0, {}, { input: ['rcvTop', 'value'] }),
      n('add', 'sum', 0, 0, { outputType: 'vec3' }, { a: ['tf', 'rgb'], b: ['B', 'c'] }), out(['sum', 'rgb'], 0)];
    top[4].outputs = { result: { type: 'vec3', label: 'Result' } };
    top[4].inputs.a.type = 'vec3'; top[4].inputs.b.type = 'vec3';
    top[5].inputs.color.connection = { nodeId: 'sum', outputKey: 'result' };
    const px = pixel(top);
    expect(px[0]).toBeCloseTo(2.6 + Math.sin(2.6), 5);
    // Routed through ports added for the compile only: the stored graph is untouched.
    const { nodes } = resolveSendReceive(top);
    expect((nodes[0].params.subgraph as { outputPorts: Array<{ key: string }> }).outputPorts.map(p => p.key)).toEqual(['sr_snd']);
    expect(Object.keys(nodes[1].inputs)).toEqual(['sr_snd']);
    expect((top[0].params.subgraph as { outputPorts: unknown[] }).outputPorts).toEqual([]);
    expect(top[1].inputs).toEqual({});
  });

  it('out of an iterated group: the value after the last iteration', () => {
    // Inside A (3 iterations) a Loop Index is sent; read outside it is the last index, 2.
    const a = group('A', 0, 0, { label: 'A', iterations: 3, inputs: [], outputs: [], nodes: [n('loopIndex', 'li', 0, 0), send('snd', 'i', ['li', 'i'])] });
    const r = compileGraph({ nodes: [a, receive('rcv', 'snd'), n('floatToVec3', 'f3', 0, 0, {}, { input: ['rcv', 'value'] }), out(['f3', 'rgb'], 0)] });
    expect(r.errors ?? []).toEqual([]);
    const env: Record<string, Val> = { u_time: 0, vUv: [0.5, 0.5], u_resolution: [1, 1], ...(r.paramUniforms as Record<string, Val>) };
    compileFragment(r.fragmentShader).run(env as never);
    expect((env.gl_FragColor as number[])[0]).toBeCloseTo(2, 6);
  });

  it('follows the type of what is sent, and the Receive follows the Send', () => {
    const nodes = [n('uv', 'uv', 0, 0), send('snd', 'p', ['uv', 'uv']), receive('rcv', 'snd'), out(['rcv', 'value'], 0)];
    const synced = syncSendReceiveTypes(nodes);
    expect(synced[1].inputs.value.type).toBe('vec2');
    expect(synced[1].outputs.value.type).toBe('vec2');
    expect(synced[2].outputs.value.type).toBe('vec2');
    expect(synced[2].params.name).toBe('p');
    expect(syncSendReceiveTypes(synced)).toBe(synced); // settled: the same array back
    const r = compileGraph({ nodes });
    expect(r.errors ?? []).toEqual([]);
    expect(r.fragmentShader).toMatch(/vec2 receive_\w+ = send_\w+;/);
    expect(listSends(synced)[0]).toMatchObject({ id: 'snd', name: 'p', type: 'vec2', where: 'Top level' });
  });

  it('with no Send (none picked, or deleted) the Value is zero', () => {
    for (const sendId of ['', 'gone']) {
      const r = compileGraph({ nodes: [receive('rcv', sendId), n('floatToVec3', 'f3', 0, 0, {}, { input: ['rcv', 'value'] }), out(['f3', 'rgb'], 0)] });
      expect(r.errors ?? []).toEqual([]);
      expect(r.fragmentShader).toMatch(/float receive_\w+ = 0\.0;/);
    }
  });

  it('refuses a loop: a Receive feeding its own Send, or a group both sending and receiving through the level above', () => {
    const own = compileGraph({ nodes: [receive('rcv', 'snd'), n('sin', 's', 0, 0, {}, { input: ['rcv', 'value'] }), send('snd', 'beat', ['s', 'output']), out(['snd', 'value'], 0)] });
    expect(own.success).toBe(false);
    expect(own.errors?.[0]).toMatch(/^Send "beat" and its Receive make a loop: .*Receive.*Sin.*Send.*can’t use its own result/);
    // Inside a group too (the store refuses such a wire; the link is caught the same way).
    const inner = group('G', 0, 0, { label: 'G', iterations: 1, inputs: [], outputs: [{ key: 'v', type: 'float', label: 'v', from: ['snd', 'value'] }], nodes: [receive('rcv', 'snd'), send('snd', 'beat', ['rcv', 'value'])] });
    expect(compileGraph({ nodes: [inner, out(['G', 'v'], 0)] }).errors?.[0]).toMatch(/make a loop/);
    // G sends; a Receive at the top feeds G: the group would need its own result.
    const g = colourGroup('G', [time(), send('snd', 'beat', ['time', 'time'])], port('x'));
    g.inputs = { x: { type: 'float', label: 'x', connection: { nodeId: 'rcv', outputKey: 'value' } } };
    (g.params.subgraph as { inputPorts: unknown[] }).inputPorts = [{ key: 'x', type: 'float', label: 'x', toNodeId: 'Gs', toInputKey: 'input' }];
    const r = compileGraph({ nodes: [g, receive('rcv', 'snd'), out(['G', 'c'], 0)] });
    expect(r.errors?.[0]).toMatch(/^Send "beat" and its Receive make a loop: G → Receive → G/);
  });

  it('into an Agents group: through its Agent Inputs, into the walkers\' update program', () => {
    const nodes = structuredClone(buildAgentExamples().slimeMold.nodes);
    const sg = nodes.find(x => x.type === 'agentsGroup')!.params.subgraph as { nodes: GraphNode[] };
    const sense = sg.nodes.find(x => x.type === 'agentSense')!;
    sense.inputs.angle = { ...sense.inputs.angle, connection: { nodeId: 'rcv', outputKey: 'value' } };
    sg.nodes.push(receive('rcv', 'snd'));
    nodes.push(time(), send('snd', 'beat', ['time', 'time']));
    const r = compileGraph({ nodes });
    expect(r.errors ?? []).toEqual([]);
    const step = r.agents!.groups[0].fragmentShader;
    expect(step).toMatch(/float (send_\w+) = time_\w+;[\s\S]*float receive_\w+ = \1;/);
  });

  it('a group kind it cannot cross gets a message naming it', () => {
    const sg = n('sceneGroup', 'sg', 0, 0, { label: 'Shapes', subgraph: { nodes: [receive('rcv', 'snd')], inputPorts: [], outputPorts: [] } });
    const r = compileGraph({ nodes: [time(), send('snd', 'beat', ['time', 'time']), sg, out(['snd', 'value'], 0)] });
    expect(r.errors?.[0]).toMatch(/A Receive of "beat" is inside Shapes .* can't reach into/);
  });

  it('a rename changes nothing in the picture: the Receive keeps the Send by id', () => {
    const nodes = (name: string) => [time(), send('snd', name, ['time', 'time']), receive('rcv', 'snd'), n('floatToVec3', 'f3', 0, 0, {}, { input: ['rcv', 'value'] }), out(['f3', 'rgb'], 0)];
    expect(compileGraph({ nodes: nodes('warp') }).fragmentShader).toBe(compileGraph({ nodes: nodes('beat') }).fragmentShader);
    expect(syncSendReceiveTypes(nodes('warp'))[2].params.name).toBe('warp');
  });

  it('carries a texture: the same shader as the wire', () => {
    const pic = [n('uv', 'uv', 0, 0), n('circleSDF', 'circ', 0, 0, { radius: 0.4 }, { position: ['uv', 'uv'] }), n('floatToVec3', 'rgb', 0, 0, {}, { input: ['circ', 'distance'] }), n('pass', 'pa', 0, 0, {}, { color: ['rgb', 'rgb'] })];
    const wired = compileGraph({ nodes: [...pic, n('sampleTexture', 'samp', 0, 0, {}, { texture: ['pa', 'texture'] }), out(['samp', 'color'], 0)] });
    const wireless = compileGraph({ nodes: [...pic, send('snd', 'picture', ['pa', 'texture']), receive('rcv', 'snd'), n('sampleTexture', 'samp', 0, 0, {}, { texture: ['rcv', 'value'] }), out(['samp', 'color'], 0)] });
    expect(wireless.errors ?? []).toEqual([]);
    expect(wireless.fragmentShader).toBe(wired.fragmentShader);
    expect(wireless.passes?.map(p => p.fragmentShader)).toEqual(wired.passes?.map(p => p.fragmentShader));
    // Into a group: the sampler reaches the Sample inside.
    const inGroup = compileGraph({ nodes: [...pic, send('snd', 'picture', ['pa', 'texture']), group('G', 0, 0, {
      label: 'G', iterations: 1, inputs: [], outputs: [{ key: 'c', type: 'vec3', label: 'C', from: ['samp', 'color'] }],
      nodes: [receive('rcv', 'snd'), n('sampleTexture', 'samp', 0, 0, {}, { texture: ['rcv', 'value'] })],
    }), out(['G', 'c'], 0)] });
    expect(inGroup.errors ?? []).toEqual([]);
    expect(inGroup.fragmentShader).toMatch(/texture2D\(u_pass_\w+,/);
  });

  it('a Receive feeding a Pass, and a Pass inside a group: the Send reaches that Pass\'s program', () => {
    const top = compileGraph({ nodes: [time(), send('snd', 'beat', ['time', 'time']), receive('rcv', 'snd'), n('floatToVec3', 'f3', 0, 0, {}, { input: ['rcv', 'value'] }),
      n('pass', 'pa', 0, 0, {}, { color: ['f3', 'rgb'] }), n('sampleTexture', 'samp', 0, 0, {}, { texture: ['pa', 'texture'] }), out(['samp', 'color'], 0)] });
    expect(top.errors ?? []).toEqual([]);
    expect(top.passes?.[0].fragmentShader).toMatch(/float (send_\w+) = time_\w+;[\s\S]*= \1;/);
    const inGroup = compileGraph({ nodes: [time(), send('snd', 'beat', ['time', 'time']), group('G', 0, 0, {
      label: 'G', iterations: 1, inputs: [], outputs: [{ key: 'c', type: 'vec3', label: 'C', from: ['samp', 'color'] }],
      nodes: [receive('rcv', 'snd'), n('floatToVec3', 'f3', 0, 0, {}, { input: ['rcv', 'value'] }), n('pass', 'pa', 0, 0, {}, { color: ['f3', 'rgb'] }), n('sampleTexture', 'samp', 0, 0, {}, { texture: ['pa', 'texture'] })],
    }), out(['G', 'c'], 0)] });
    expect(inGroup.errors ?? []).toEqual([]);
    expect(inGroup.passes?.[0].fragmentShader).toMatch(/float (send_\w+) = time_\w+;[\s\S]*= \1;/);
  });

  it('saves and loads: the same shader after a JSON round trip', () => {
    const nodes = [time(), send('snd', 'beat', ['time', 'time']), colourGroup('g', [receive('rcv', 'snd')], ['rcv', 'value']), out(['g', 'c'], 0)];
    const back = JSON.parse(JSON.stringify(nodes)) as GraphNode[];
    expect(compileGraph({ nodes: back }).fragmentShader).toBe(compileGraph({ nodes }).fragmentShader);
  });

  it('lists receivers and duplicate names', () => {
    const nodes = [time(), send('a', 'beat', ['time', 'time']), send('b', 'beat', ['time', 'time']), colourGroup('g', [receive('rcv', 'a')], ['rcv', 'value']), receive('r2', 'a')];
    expect(receiversOf(nodes, 'a')).toEqual([{ id: 'rcv', path: ['g'] }, { id: 'r2', path: [] }]);
    expect([...duplicateSendIds(nodes)].sort()).toEqual(['a', 'b']);
  });

  it('the example compiles: a beat into two groups and a picture across', () => {
    const ex = buildSendReceiveExamples().sendReceiveBeat;
    const r = compileGraph({ nodes: ex.nodes });
    expect(r.errors ?? []).toEqual([]);
    expect(r.passes?.length).toBe(1);
    // Both groups read the one LFO.
    const sent = r.fragmentShader.match(/float (send_\w+) = lfo_\w+;/)![1];
    expect(r.fragmentShader.match(new RegExp(`= ${sent};`, 'g'))?.length).toBeGreaterThanOrEqual(2);
  });
});
