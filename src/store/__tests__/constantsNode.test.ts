/**
 * The Constants card: entries become outputs and params, fixed ones are baked
 * while live ones are uniforms, and rewriting the entries drops wires to
 * outputs that went away.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GraphNode } from '../../types/nodeGraph';

vi.hoisted(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} });
});
import { useNodeGraphStore } from '../useNodeGraphStore';
import { getNodeDefinitionFor } from '../../nodes/definitions';
import { constantsOutputs, paramsFor, type ConstantsItem } from '../../nodes/definitions/constants';
import { collectPlayCandidates } from '../../play/playControls';

const items: ConstantsItem[] = [
  { key: 'speed', label: 'speed', type: 'float', value: 2, slider: true, min: 0, max: 10, step: 0.1 },
  { key: 'SIZE', label: 'SIZE', type: 'float', value: 0.3, slider: false },
  { key: 'tint', label: 'tint', type: 'color', value: [0.2, 0.4, 0.6], slider: false },
];
const card = (): GraphNode => ({ id: 'consts', type: 'constants', position: { x: 0, y: 0 }, inputs: {}, outputs: constantsOutputs(items), params: { items, ...paramsFor(items) } });
const graph = (): GraphNode[] => [
  card(),
  { id: 'mul', type: 'multiply', position: { x: 0, y: 0 }, inputs: { a: { type: 'float', label: 'A', connection: { nodeId: 'consts', outputKey: 'speed' } }, b: { type: 'float', label: 'B', connection: { nodeId: 'consts', outputKey: 'SIZE' } } }, outputs: { result: { type: 'float', label: 'Result' } }, params: { outputType: 'float' } },
  { id: 'f2v', type: 'floatToVec3', position: { x: 0, y: 0 }, inputs: { input: { type: 'float', label: 'Float', connection: { nodeId: 'mul', outputKey: 'result' } } }, outputs: { rgb: { type: 'vec3', label: 'Color' } }, params: {} },
  { id: 'out', type: 'output', position: { x: 0, y: 0 }, inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'f2v', outputKey: 'rgb' } } }, outputs: {}, params: {} },
];

describe('Constants card', () => {
  beforeEach(() => { useNodeGraphStore.getState().replaceGraph(graph()); });

  it('has a param definition for each live entry only', () => {
    const def = getNodeDefinitionFor(useNodeGraphStore.getState().nodes[0])!;
    expect(Object.keys(def.paramDefs ?? {})).toEqual(['speed']);
    expect(def.paramDefs!.speed).toMatchObject({ type: 'float', min: 0, max: 10 });
    expect(Object.keys(def.outputs)).toEqual(['speed', 'SIZE', 'tint']);
  });

  it('bakes fixed entries and makes live ones uniforms; only live ones are Play candidates', () => {
    const s = useNodeGraphStore.getState();
    expect(s.fragmentShader).toMatch(/float \w+_SIZE = 0\.3;/);
    expect(s.fragmentShader).toMatch(/vec3 \w+_tint = vec3\(0\.2, 0\.4, 0\.6\);/);
    expect(s.fragmentShader).toMatch(/float \w+_speed = u_p_\w+_speed;/);
    expect(Object.entries(s.paramUniforms).find(([k]) => k.endsWith('_speed'))?.[1]).toBe(2);
    const cands = collectPlayCandidates(s.nodes, s.paramBindings).filter(c => c.target.startsWith('consts::'));
    expect(cands.map(c => c.target)).toEqual(['consts::speed']);
  });

  it('rewriting the entries updates outputs and params and drops wires to removed outputs', () => {
    const next: ConstantsItem[] = [{ key: 'speed', label: 'speed', type: 'float', value: 3, slider: false }, { key: 'size2', label: 'size2', type: 'vec2', value: [1, 2], slider: true }];
    useNodeGraphStore.getState().setConstantsItems('consts', next);
    const s = useNodeGraphStore.getState();
    const c = s.nodes.find(n => n.id === 'consts')!;
    expect(Object.keys(c.outputs)).toEqual(['speed', 'size2']);
    expect(c.params).toMatchObject({ speed: 3, size2_x: 1, size2_y: 2 });
    expect(c.params.SIZE).toBeUndefined();
    const mul = s.nodes.find(n => n.id === 'mul')!;
    expect(mul.inputs.a.connection).toEqual({ nodeId: 'consts', outputKey: 'speed' });
    expect(mul.inputs.b.connection).toBeUndefined();
    expect(s.fragmentShader).toMatch(/vec2 \w+_size2 = vec2\(u_p_\w+_size2_x, u_p_\w+_size2_y\);/);
    expect(s.fragmentShader).toMatch(/float \w+_speed = 3\.0;/);
  });
});
