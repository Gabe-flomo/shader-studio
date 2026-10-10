import { describe, expect, it } from 'vitest';
import { groupAddable, groupCardPorts, portKeyFor } from '../groupPorts';
import { getNodeDefinition } from '../definitions';
import type { GraphNode } from '../../types/nodeGraph';

describe('groupPorts', () => {
  it('a port key is GLSL-safe and new', () => {
    expect(portKeyFor('Speed', [])).toBe('Speed');
    expect(portKeyFor('My speed!', [])).toBe('My_speed');
    expect(portKeyFor('2nd', [])).toBe('in_2nd');
    expect(portKeyFor('', [])).toBe('in');
    expect(portKeyFor('ro', ['ro'])).toBe('ro2');
  });

  it('a March Loop: definition sockets built in, extra inputs added (store: extra), hidden outputs left out', () => {
    const def = getNodeDefinition('marchLoopGroup')!;
    const node: GraphNode = {
      id: 'l', type: 'marchLoopGroup', position: { x: 0, y: 0 },
      inputs: { ...Object.fromEntries(Object.entries(def.inputs).map(([k, v]) => [k, { type: v.type, label: v.label }])), amt: { type: 'float', label: 'Amount' }, ps_x_y: { type: 'float', label: 'p' } },
      outputs: { ...def.outputs, acc0: { type: 'float', label: 'Acc' } },
      params: { hiddenOutputs: ['iter'], subgraph: { nodes: [{ id: 'i', type: 'marchLoopInputs', position: { x: 0, y: 0 }, inputs: {}, outputs: {}, params: { extraInputs: [{ key: 'amt', type: 'float', label: 'Amount' }] } }], inputPorts: [], outputPorts: [] } },
    };
    const p = groupCardPorts(node, def);
    expect(p.inputs.find(x => x.key === 'ro')?.origin).toBe('built-in');
    expect(p.inputs.find(x => x.key === 'amt')).toMatchObject({ origin: 'added', store: 'extra', label: 'Amount' });
    expect(p.inputs.some(x => x.key.startsWith('ps_'))).toBe(false);
    expect(p.outputs.some(x => x.key === 'iter')).toBe(false);
    expect(p.outputs.find(x => x.key === 'acc0')?.origin).toBe('built-in');
  });

  it('what each group lets you add', () => {
    expect(groupAddable('group').outputs).toBeTruthy();
    expect(groupAddable('marchLoopGroup').inputs).toContain('texture');
    expect(groupAddable('agentsGroup').inputs).toContain('scene3d');
    expect(groupAddable('sceneGroup')).toEqual({ inputs: null, outputs: null });
  });
});
