/**
 * Rule steps (nodes/definitions/agentRuleSteps.ts): the builder's common actions as real nodes.
 * A rule set made with them moves its walkers exactly as the one-Expression-Block-per-rule version
 * did (both run on the CPU through their own GLSL), every preset, 2D and 3D; and the builder's
 * presets use them.
 */
import { describe, expect, it } from 'vitest';
import { TRAIL_PRESETS, PARTICLE_PRESETS, FLOCK_PRESETS, CROWD_PRESETS, ORBIT_PRESETS } from '../../agentBuilder/presets';
import { generateRulesInside, ruleHasNodes } from '../generate';
import { programOf, simulate, walkersFor, type Walker } from './cpuSim';
import { RULE_STEP_TYPES } from '../../nodes/definitions/agentRuleSteps';
import type { AgentRuleSet } from '../spec';

const PRESETS = [...TRAIL_PRESETS, ...PARTICLE_PRESETS, ...FLOCK_PRESETS, ...CROWD_PRESETS, ...ORBIT_PRESETS];
const trail = (uv: number[]) => [Math.sin(uv[0] * 23) * 0.5 + 0.5, Math.cos(uv[1] * 17) * 0.5 + 0.5, Math.sin((uv[0] + uv[1]) * 11) * 0.5 + 0.5, 0.2];
const flow = (q: number[]) => (q.length === 3 ? [Math.sin(q[1] * 5), Math.cos(q[0] * 5), 0.3] : [Math.sin(q[1] * 5), Math.cos(q[0] * 5)]);
const run = (set: AgentRuleSet, d3: boolean, ruleNodes: boolean): Walker[] => {
  const ws = walkersFor(24, { d3, species: set.species.length, speed: 0.3 }).map((w, i) => ({ ...w, age: (i % 7) * 0.9, mem2: [0, 0, 0, 0] }));
  return simulate(programOf(generateRulesInside(set, { groupId: 'g', d3, ruleNodes })), ws, 6, { d3, trail, flow, mouse: [300, 500] });
};
const close = (a: unknown, b: unknown, path: string, bad: string[]) => {
  if (typeof a === 'number' && typeof b === 'number') { if (Math.abs(a - b) > 1e-6 && bad.length < 8) bad.push(`${path}: ${a} vs ${b}`); return; }
  if (Array.isArray(a) && Array.isArray(b)) { a.forEach((x, i) => close(x, b[i], `${path}[${i}]`, bad)); return; }
  if (a !== b && bad.length < 8) bad.push(`${path}: ${String(a)} vs ${String(b)}`);
};

describe('rule steps as nodes', () => {
  for (const pr of PRESETS) for (const d3 of [false, true]) {
    it(`${pr.key}${d3 ? ' (3D)' : ''}: the nodes move the walkers as the blocks did`, () => {
      const set = pr.set();
      const a = run(set, d3, true), b = run(set, d3, false);
      const bad: string[] = [];
      a.forEach((w, i) => (['pos', 'heading', 'speed', 'alive', 'dep', 'colour', 'mem', 'mem2'] as const).forEach(k => close(w[k], b[i][k], `${i}.${k}`, bad)));
      expect(bad).toEqual([]);
    });
  }

  it('the presets use the rule-step nodes, with names from what the rules do', () => {
    const types = new Set<string>();
    const labels: string[] = [];
    for (const pr of PRESETS) for (const nd of generateRulesInside(pr.set(), { groupId: 'g', d3: false })) {
      if (RULE_STEP_TYPES.includes(nd.type)) types.add(nd.type);
      if (typeof nd.params.label === 'string') labels.push(nd.params.label);
    }
    expect([...types].sort()).toEqual([...RULE_STEP_TYPES].sort());
    expect(labels.filter(l => /^Rule \d/.test(l))).toEqual([]);
    expect(labels).toEqual(expect.arrayContaining(['Follow trail', 'Keep apart', 'Align with neighbours', 'Stay together', 'Wander', 'Gravity', 'Curl noise', 'Drag', 'Fade with age', 'Orbit centre', 'Avoid walls', 'Die when older than 6 s']));
  });

  it('a rule with conditions gets a When block wired into its steps; one with a memory or stop stays a block', () => {
    const set = PARTICLE_PRESETS.find(p => p.key === 'smoke')!.set();
    set.species[0].rules.push({ when: [{ kind: 'age', cmp: '>', seconds: 2 }], do: [{ kind: 'drag', amount: 3 }] });
    const inside = generateRulesInside(set, { groupId: 'g', d3: false });
    const whenBlock = inside.find(nd => nd.id === 'g_ru_r1_3')!;
    expect(whenBlock.type).toBe('exprNode');
    expect(whenBlock.params.label).toBe('When older than 2 s');
    const drag = inside.find(nd => nd.id === 'g_ru_r1_3_a1')!;
    expect(drag.type).toBe('agentDrag');
    expect(drag.inputs.when.connection).toEqual({ nodeId: 'g_ru_r1_3', outputKey: 'result' });
    expect(String(drag.params.__comment)).toMatch(/Part of "Drag when older than 2 s"/);
    expect(ruleHasNodes({ when: [], do: [{ kind: 'drag', amount: 1 }], stop: true })).toBe(false);
    expect(ruleHasNodes({ when: [], do: [{ kind: 'drag', amount: 1, times: { memory: 'm' } }] })).toBe(false);
    expect(ruleHasNodes({ when: [], do: [{ kind: 'die' }] })).toBe(false);
  });
});
