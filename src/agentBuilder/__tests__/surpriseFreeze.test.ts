/**
 * The Agent Builder's Surprise me never leaves a frozen scene (3D slime froze after a Surprise):
 *  - a surprise never picks a preset that needs a setup of its own (Frost: its walkers stick where
 *    they touch the trail, so on a slime's trail they all stuck at once);
 *  - every surprise compiles and moves: speeds above 0, every number finite, in 2D and 3D, every kind;
 *  - the start over it asks for waits until the group's new rule has compiled and stepped
 *    (lib/agentRunner.ts settleRestarts): dropped while it compiled, the walkers carried on stuck.
 */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});

import { compileGraph } from '../../compiler/graphCompiler';
import { n } from '../../store/graphBuilder';
import { useNodeGraphStore, undoManager } from '../../store/useNodeGraphStore';
import { groupRules } from '../../agentRules/apply';
import { type AgentRuleSet, type WalkerKind, kindOf } from '../../agentRules/spec';
import { surpriseForKindFromSeed } from '../surprise';
import { makeAgentGroup } from '../actions';
import { setGroupSpace } from '../../agentRules/storeActions';
import { startCard, type StartKind } from '../kinds';
import { surpriseBuilderAction } from '../../components/surprise/surpriseActions';
import { restartAgents, restartPending, settleRestarts } from '../../lib/agentRunner';

const SEEDS = Array.from({ length: 40 }, (_, i) => i + 1);

/** Every number in the rule set is finite (no NaN speed or distance). */
const allFinite = (v: unknown): boolean =>
  typeof v === 'number' ? Number.isFinite(v) : Array.isArray(v) ? v.every(allFinite) : v && typeof v === 'object' ? Object.values(v).every(allFinite) : true;
const sticks = (set: AgentRuleSet) => set.species.some(sp => sp.rules.some(r => r.do.some(a => a.kind === 'stick')));

const fresh = () => {
  undoManager.clear('test');
  useNodeGraphStore.setState({ nodes: [n('output', 'out', 2000, 0, {})], activeGroupPath: [], selectedNodeId: null, selectedNodeIds: [] });
};

describe('Surprise me moves', () => {
  it('3D slime: 40 seeds give rule sets that move (speed > 0, finite numbers, nothing that sticks)', () => {
    for (const seed of SEEDS) {
      const s = surpriseForKindFromSeed(seed, 'trail', { d3: true });
      expect(kindOf(s.set), `seed ${seed}`).toBe('trail');
      expect(sticks(s.set), `seed ${seed}: ${s.summary}`).toBe(false);
      expect(allFinite(s.set), `seed ${seed}`).toBe(true);
      for (const sp of s.set.species) expect(sp.speed, `seed ${seed} ${sp.name}`).toBeGreaterThan(0.3);
      expect(s.set.sensor.distance).toBeGreaterThan(0);
    }
  });

  it('every kind, 2D and 3D: no Frost, speeds above 0, finite numbers', () => {
    for (const kind of ['trail', 'particles', 'flock', 'crowd', 'swarm'] as WalkerKind[]) {
      for (const d3 of [false, true]) {
        for (const seed of SEEDS.slice(0, 20)) {
          const s = surpriseForKindFromSeed(seed, kind, { d3 });
          const at = `${kind} ${d3 ? '3D' : '2D'} seed ${seed}`;
          expect(s.family, at).not.toBe('Frost (DLA)');
          expect(sticks(s.set), at).toBe(false);
          expect(allFinite(s.set), at).toBe(true);
          for (const sp of s.set.species) expect(sp.speed, at).toBeGreaterThan(0);
        }
      }
    }
  });

  it('in a slime setup switched from 2D to 3D (as reported): every surprise compiles and asks for a start over', () => {
    fresh();
    const id = makeAgentGroup(startCard('trail'), '2d')!.groupId;
    expect(setGroupSpace(id, '3d')).toBe(true);
    expect(useNodeGraphStore.getState().nodes.find(x => x.id === id)!.params.space).toBe('3d');
    for (const seed of SEEDS.slice(0, 15)) {
      settleRestarts([id], [id]);
      expect(surpriseBuilderAction(id, seed), `seed ${seed}`).toBe(true);
      const nodes = useNodeGraphStore.getState().nodes;
      const r = compileGraph({ nodes });
      expect(r.errors, `seed ${seed}`).toBeUndefined();
      const g = r.agents!.groups.find(x => x.nodeId === id)!;
      expect(g.fragmentShader.length).toBeGreaterThan(100);
      expect(sticks(groupRules(nodes.find(x => x.id === id)!)), `seed ${seed}`).toBe(false);
      expect(restartPending(id), `seed ${seed}`).toBe(true);
    }
  });

  it('every builder kind in 2D and 3D: Surprise compiles', () => {
    for (const card of ['trail', 'particles', 'flock', 'crowd', 'orbit'] as StartKind[]) {
      for (const space of ['2d', '3d'] as const) {
        fresh();
        const id = makeAgentGroup(startCard(card), space)!.groupId;
        for (const seed of [1, 2, 3, 4, 5]) {
          expect(surpriseBuilderAction(id, seed), `${card} ${space} ${seed}`).toBe(true);
          const r = compileGraph({ nodes: useNodeGraphStore.getState().nodes });
          expect(r.errors, `${card} ${space} ${seed}`).toBeUndefined();
        }
      }
    }
  });
});

describe('start over waits for the new rule', () => {
  it('a group that did not step this frame (its rule still compiling) keeps its request', () => {
    settleRestarts(['a', 'b'], ['a', 'b']);
    restartAgents('a');
    settleRestarts([], ['a']);
    expect(restartPending('a')).toBe(true);
    settleRestarts(['b'], ['a', 'b']);
    expect(restartPending('a')).toBe(true);
    settleRestarts(['a'], ['a', 'b']);
    expect(restartPending('a')).toBe(false);
  });

  it('start all over waits until every live group stepped', () => {
    restartAgents();
    settleRestarts(['a'], ['a', 'b']);
    expect(restartPending('b')).toBe(true);
    settleRestarts(['a', 'b'], ['a', 'b']);
    expect(restartPending('a')).toBe(false);
    expect(restartPending('b')).toBe(false);
  });
});
