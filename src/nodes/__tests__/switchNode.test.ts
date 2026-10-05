/**
 * "Switch to": a node's like-for-like alternatives and the in-place switch
 * (nodes/switchNode.ts, store swapNode).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GraphNode, SubgraphData } from '../../types/nodeGraph';
import { GROUP_PORT_SENTINEL } from '../../types/nodeGraph';

vi.hoisted(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} });
});
import { useNodeGraphStore, switchScopeFor } from '../../store/useNodeGraphStore';
import { getNodeDefinition } from '../definitions';
import { instantiateNode } from '../scene3dDefaults';
import { canSwitchNode, planSwitch, switchFamiliesFor, switchOptions, type SwitchContext } from '../switchNode';
import { emptyPlayRecord, type PlayControl } from '../../types/play';

const mk = (id: string, type: string, params?: Record<string, unknown>, x = 0): GraphNode =>
  instantiateNode(id, type, getNodeDefinition(type)!, { x, y: 0 }, params);
const wire = (n: GraphNode, key: string, from: string, outputKey: string): GraphNode =>
  ({ ...n, inputs: { ...n.inputs, [key]: { ...n.inputs[key], connection: { nodeId: from, outputKey } } } });

/** UV → two circles → Union(a,b) → Float→Color → Output. */
function sdfGraph(): GraphNode[] {
  return [
    mk('uv', 'pixelUV'),
    wire(mk('c1', 'circleSDF', { radius: 0.3 }), 'position', 'uv', 'uv'),
    wire(mk('c2', 'boxSDF'), 'position', 'uv', 'uv'),
    wire(wire(mk('u', 'sdfUnion', { k: 0.2, __comment: 'merge them' }), 'a', 'c1', 'distance'), 'b', 'c2', 'distance'),
    wire(mk('f', 'floatToVec3'), 'input', 'u', 'dist'),
    wire(mk('out', 'output'), 'color', 'f', 'rgb'),
  ];
}

const ctxFor = (nodes: GraphNode[], id: string): { scope: GraphNode[]; node: GraphNode; ctx: SwitchContext } => {
  const r = switchScopeFor({ nodes, activeGroupPath: [] }, id)!;
  return r;
};
const okTypes = (nodes: GraphNode[], id: string): string[] => {
  const { scope, node, ctx } = ctxFor(nodes, id);
  return switchOptions(scope, node, ctx).flatMap(g => g.options.filter(o => o.ok).map(o => o.type));
};

function load(nodes: GraphNode[], path: string[] = []) {
  useNodeGraphStore.setState({ nodes, activeGroupPath: path, activeGroupId: path[path.length - 1] ?? null, play: emptyPlayRecord(), swapTargetNodeId: null });
}
const scopeNode = (id: string): GraphNode | undefined => {
  const st = useNodeGraphStore.getState();
  return switchScopeFor(st, id)?.node;
};

describe('which switches are offered', () => {
  it('SDF combiners switch among themselves (smooth variants are their k)', () => {
    const g = sdfGraph();
    const ok = okTypes(g, 'u');
    expect(ok).toEqual(expect.arrayContaining(['sdfIntersect', 'sdfSubtract', 'minMath', 'max']));
    expect(ok).not.toContain('sdfUnion');
    // Intersect / Subtract map every key, so they rank above Min / Max.
    expect(ok.indexOf('sdfIntersect')).toBeLessThan(ok.indexOf('minMath'));
    const fromIntersect = okTypes(g.map(n => (n.id === 'u' ? { ...n, type: 'sdfIntersect' } : n)), 'u');
    expect(fromIntersect).toEqual(expect.arrayContaining(['sdfUnion', 'sdfSubtract']));
  });

  it('a wired k leaves out Min / Max (nowhere for that wire), with the reason', () => {
    const g = sdfGraph().map(n => (n.id === 'u' ? wire(n, 'k', 'c1', 'distance') : n));
    const { scope, node, ctx } = ctxFor(g, 'u');
    const all = switchOptions(scope, node, ctx).flatMap(gr => gr.options);
    const min = all.find(o => o.type === 'minMath')!;
    expect(min.ok).toBe(false);
    expect(min.reason).toMatch(/^No input for the wire into Blend radius/);
    expect(all.find(o => o.type === 'sdfSubtract')!.ok).toBe(true);
  });

  it('2D shapes: Circle → Box and back, position kept', () => {
    const g = sdfGraph();
    expect(okTypes(g, 'c1')).toEqual(expect.arrayContaining(['boxSDF', 'ringSDF', 'sdEllipse']));
    expect(okTypes(g, 'c2')).toContain('circleSDF');
    const { scope, node, ctx } = ctxFor(g, 'c1');
    const p = planSwitch(scope, node, 'boxSDF', ctx)!;
    expect(p.inputMap).toEqual({ position: 'position' });
    expect(p.outputMap).toEqual({ distance: 'distance' });
  });

  it('3D primitives: Sphere → Cone / Box / Torus', () => {
    const nodes = [mk('sp', 'scenePos'), wire(mk('s', 'sphereSDF3D'), 'pos', 'sp', 'pos'), wire(mk('so', 'sceneOutput'), 'dist', 's', 'dist')];
    const ok = okTypes(nodes, 's');
    expect(ok).toEqual(expect.arrayContaining(['coneSDF3D', 'boxSDF3D', 'torusSDF3D', 'cappedConeSDF3D']));
    // A 3D transform outputs a position, not a distance: not offered while the distance is wired.
    expect(ok).not.toContain('turbulence3D');
    expect(switchFamiliesFor('sphereSDF3D').some(f => f.types.includes('coneSDF3D'))).toBe(true);
  });

  it('trig: Sin → Cos / Tan / Tanh; rounding: Floor → Ceil / Round / Fract', () => {
    const nodes = [mk('t', 'time'), wire(mk('s', 'sin'), 'input', 't', 'time'), wire(mk('fl', 'floor'), 'input', 's', 'output'), wire(mk('n', 'negate'), 'input', 'fl', 'output')];
    expect(okTypes(nodes, 's')).toEqual(expect.arrayContaining(['cos', 'tan', 'tanh']));
    expect(okTypes(nodes, 'fl')).toEqual(expect.arrayContaining(['ceil', 'round', 'fractRaw', 'quantize']));
  });

  it('groups and engines are not switchable', () => {
    expect(canSwitchNode(mk('o', 'output'))).toBe(false);
    expect(canSwitchNode(mk('t', 'time'))).toBe(false);
    expect(canSwitchNode({ ...mk('g', 'sceneGroup'), params: { subgraph: { nodes: [], inputPorts: [], outputPorts: [] } } })).toBe(false);
    expect(canSwitchNode(mk('u', 'sdfUnion'))).toBe(true);
  });
});

describe('switching', () => {
  beforeEach(() => load(sdfGraph()));

  it('Union → Intersect: same id and place, wires, k and comment kept; one undo step', () => {
    const before = useNodeGraphStore.getState().nodes;
    const r = useNodeGraphStore.getState().swapNode('u', 'sdfIntersect');
    expect(r).toEqual({ ok: true, keptWires: 3 });
    const st = useNodeGraphStore.getState();
    const u = st.nodes.find(n => n.id === 'u')!;
    expect(u.type).toBe('sdfIntersect');
    expect(st.nodes.indexOf(u)).toBe(3);
    expect(u.inputs.a.connection).toEqual({ nodeId: 'c1', outputKey: 'distance' });
    expect(u.inputs.b.connection).toEqual({ nodeId: 'c2', outputKey: 'distance' });
    expect(u.params.k).toBe(0.2);
    expect(u.params.__comment).toBe('merge them');
    expect(st.nodes.find(n => n.id === 'f')!.inputs.input.connection).toEqual({ nodeId: 'u', outputKey: 'dist' });
    st.undo();
    expect(useNodeGraphStore.getState().nodes).toEqual(before);
  });

  it('Union → Min: the output wire moves to Min’s result', () => {
    useNodeGraphStore.getState().swapNode('u', 'minMath');
    const st = useNodeGraphStore.getState();
    expect(st.nodes.find(n => n.id === 'f')!.inputs.input.connection).toEqual({ nodeId: 'u', outputKey: 'result' });
  });

  it('carries params by meaning (Circle radius → Ring radius; Sin freq/amp → Cos)', () => {
    useNodeGraphStore.getState().swapNode('c1', 'ringSDF');
    expect(scopeNode('c1')!.params.radius).toBe(0.3);
    load([mk('t', 'time'), wire(mk('s', 'sin', { freq: 3, amp: 0.5 }), 'input', 't', 'time')]);
    useNodeGraphStore.getState().swapNode('s', 'cos');
    expect(scopeNode('s')!.params).toMatchObject({ freq: 3, amp: 0.5 });
  });

  it('keeps keyframes on sockets that still exist and Play controls on params that still exist', () => {
    const kf = [{ t: 0, v: 0.1 }, { t: 1, v: 0.4 }];
    load(sdfGraph().map(n => (n.id === 'u' ? { ...n, params: { ...n.params, __keyframes_k: kf, __kfMode_k: 'loop' } } : n)));
    const ctl = (id: string, target: string): PlayControl => ({ id, target, kind: 'float', label: id, min: 0, max: 1 } as PlayControl);
    const play = { ...emptyPlayRecord(), controls: [ctl('smooth', 'u::k')] };
    useNodeGraphStore.setState({ play });
    useNodeGraphStore.getState().swapNode('u', 'sdfSubtract');
    const st = useNodeGraphStore.getState();
    const u = scopeNode('u')!;
    expect(u.params.__keyframes_k).toEqual(kf);
    expect(u.params.__kfMode_k).toBe('loop');
    expect(st.play.controls[0].target).toBe('u::k');
    // Undo brings the Play record back with the graph.
    st.undo();
    expect(useNodeGraphStore.getState().play).toBe(play);
  });

  it('retargets a Play control on a renamed param and reports one that has nowhere to go', () => {
    load([mk('t', 'time'), wire(mk('s', 'sin', { freq: 2 }), 'input', 't', 'time')]);
    const ctl = (id: string, target: string): PlayControl => ({ id, target, kind: 'float', label: id, min: 0, max: 1 } as PlayControl);
    useNodeGraphStore.setState({ play: { ...emptyPlayRecord(), controls: [ctl('f', 's::freq')] } });
    useNodeGraphStore.getState().swapNode('s', 'tanh');
    const st = useNodeGraphStore.getState();
    expect(scopeNode('s')!.type).toBe('tanh');
    expect(st.play.controls[0].target).toBe('s::freq'); // left in place, reported in the toast
    // Circle's radius is Shape SDF's r: the control follows it.
    load(sdfGraph());
    useNodeGraphStore.setState({ play: { ...emptyPlayRecord(), controls: [ctl('rad', 'c1::radius')] } });
    useNodeGraphStore.getState().swapNode('c1', 'shapeSDF');
    expect(scopeNode('c1')!.params.r).toBe(0.3);
    expect(useNodeGraphStore.getState().play.controls[0].target).toBe('c1::r');
  });

  it('works inside a group, through its ports', () => {
    const inner: GraphNode[] = [
      wire(mk('s', 'sin'), 'input', GROUP_PORT_SENTINEL, 'x'),
      wire(mk('n', 'negate'), 'input', 's', 'output'),
    ];
    const sg: SubgraphData = {
      nodes: inner,
      inputPorts: [{ key: 'x', type: 'float', label: 'X', toNodeId: 's', toInputKey: 'input' }],
      outputPorts: [{ key: 'y', type: 'float', label: 'Y', fromNodeId: 's', fromOutputKey: 'output' }],
    };
    const group: GraphNode = { ...mk('g', 'group'), inputs: { x: { type: 'float', label: 'X' } }, outputs: { y: { type: 'float', label: 'Y' } }, params: { label: 'G', subgraph: sg } };
    load([mk('t', 'time'), wire(group, 'x', 't', 'time')], ['g']);
    const { scope, node, ctx } = switchScopeFor(useNodeGraphStore.getState(), 's')!;
    expect(switchOptions(scope, node, ctx).flatMap(gr => gr.options.filter(o => o.ok).map(o => o.type))).toContain('cos');
    useNodeGraphStore.getState().swapNode('s', 'cos');
    const g = useNodeGraphStore.getState().nodes.find(n => n.id === 'g')!;
    const after = (g.params.subgraph as SubgraphData).nodes.find(n => n.id === 's')!;
    expect(after.type).toBe('cos');
    expect(after.inputs.input.connection).toEqual({ nodeId: GROUP_PORT_SENTINEL, outputKey: 'x' });
    expect((g.params.subgraph as SubgraphData).outputPorts[0]).toMatchObject({ fromNodeId: 's', fromOutputKey: 'output' });
  });

  it('refuses a target the group rules don’t allow there', () => {
    load(sdfGraph());
    expect(useNodeGraphStore.getState().swapNode('u', 'agentSteer')).toBeUndefined();
    expect(scopeNode('u')!.type).toBe('sdfUnion');
  });

  it('the shift-click swap still takes any node, dropping wires with no place', () => {
    const r = useNodeGraphStore.getState().swapNode('u', 'colorPicker');
    expect(r?.ok).toBe(false);
    const st = useNodeGraphStore.getState();
    expect(scopeNode('u')!.type).toBe('colorPicker');
    expect(st.swapTargetNodeId).toBeNull();
  });
});
