/**
 * Rank layout: a Loop Carry's `next` wire is the feedback edge of an iterated
 * group. Following it as an upstream link made the ranks climb forever, which
 * hung auto layout (and the converter's layout) on any group with a carry.
 */
import { describe, expect, it } from 'vitest';
import type { GraphNode } from '../../types/nodeGraph';
import { computeNodeRanks, groupNodesByRank } from '../graphLayout';

const node = (id: string, type: string, inputs: GraphNode['inputs']): GraphNode =>
  ({ id, type, position: { x: 0, y: 0 }, inputs, outputs: {}, params: {} });

describe('computeNodeRanks', () => {
  it('terminates on a Loop Carry feedback cycle and ranks the carry before its body', () => {
    const nodes = [
      node('carry', 'loopCarry', { init: { type: 'float', label: 'Init' }, next: { type: 'float', label: 'Next', connection: { nodeId: 'add', outputKey: 'result' } } }),
      node('add', 'add', { a: { type: 'float', label: 'A', connection: { nodeId: 'carry', outputKey: 'value' } } }),
    ];
    const ranks = computeNodeRanks(nodes);
    expect(ranks.get('carry')).toBe(0);
    expect(ranks.get('add')).toBe(1);
    expect(groupNodesByRank(nodes).map(g => g.rank)).toEqual([0, 1]);
  });

  it('treats a node fed only by a group port as a source', () => {
    const nodes = [
      node('carry', 'loopCarry', { init: { type: 'float', label: 'Init', connection: { nodeId: '__port__', outputKey: 'in0' } }, next: { type: 'float', label: 'Next', connection: { nodeId: 'add', outputKey: 'result' } } }),
      node('add', 'add', { a: { type: 'float', label: 'A', connection: { nodeId: 'carry', outputKey: 'value' } }, b: { type: 'float', label: 'B', connection: { nodeId: '__port__', outputKey: 'in1' } } }),
      node('mul', 'multiply', { a: { type: 'float', label: 'A', connection: { nodeId: 'add', outputKey: 'result' } } }),
    ];
    const ranks = computeNodeRanks(nodes);
    expect([ranks.get('carry'), ranks.get('add'), ranks.get('mul')]).toEqual([0, 1, 2]);
  });

  it('terminates on any other cycle too', () => {
    const nodes = [
      node('a', 'add', { a: { type: 'float', label: 'A', connection: { nodeId: 'b', outputKey: 'result' } } }),
      node('b', 'add', { a: { type: 'float', label: 'A', connection: { nodeId: 'a', outputKey: 'result' } } }),
    ];
    const ranks = computeNodeRanks(nodes);
    expect([...ranks.values()].every(r => r <= nodes.length)).toBe(true);
  });
});
