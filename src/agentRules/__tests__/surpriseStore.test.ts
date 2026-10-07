/**
 * Agent Rules' Surprise me on the graph (agentRules/storeActions.ts surpriseGroupRules): one undo
 * step, the Trail field and palette set with the rules, and the group's Trail wire put back when
 * a rule set that senses nothing (a crowd, a flock) is followed by one that smells the trail.
 */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});

import { useNodeGraphStore, undoManager } from '../../store/useNodeGraphStore';
import { makeRng } from '../../lib/surprise';
import { rulesStarter } from '../starter';
import { surpriseGroupRules } from '../storeActions';
import { surpriseAgents } from '../surprise';

const findSeed = (want: (s: ReturnType<typeof surpriseAgents>) => boolean) => {
  for (let seed = 1; seed < 500; seed++) if (want(surpriseAgents(makeRng(seed)))) return surpriseAgents(makeRng(seed));
  throw new Error('no seed');
};

describe('surpriseGroupRules', () => {
  it('is one undo step, sets the trail and palette, and keeps the Trail wired across kinds', () => {
    const s = rulesStarter(null);
    useNodeGraphStore.setState({ nodes: s.nodes });
    const group = () => useNodeGraphStore.getState().nodes.find(x => x.id === s.groupId)!;
    expect(group().inputs.trail.connection?.nodeId).toBe('slTrail');

    const crowd = findSeed(x => x.kind === 'crowd');
    const steps = undoManager.canUndo;
    expect(surpriseGroupRules(s.groupId, crowd)).toBe(true);
    expect(undoManager.canUndo).toBe(steps + 1);
    expect(group().params.agentRules).toEqual(crowd.set);
    const trail = useNodeGraphStore.getState().nodes.find(x => x.id === 'slTrail')!;
    expect(trail.params.halfLife).toBe(crowd.trail.halfLife);
    const palette = useNodeGraphStore.getState().nodes.find(x => x.type === 'stopPalette')!;
    expect(palette.params.color4).toEqual(crowd.palette[4]);

    const tracker = findSeed(x => x.style === 'tracker');
    surpriseGroupRules(s.groupId, tracker);
    expect(group().inputs.trail?.connection?.nodeId).toBe('slTrail');
  });
});
