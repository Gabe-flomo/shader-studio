/** Rule names from what the rules do (ruleNames.ts): every action kind, conditions, and the user's own names kept. */
import { describe, expect, it } from 'vitest';
import type { AgentRuleSet, RuleAction } from '../spec';
import { actionTitle, ruleTitle } from '../ruleNames';

const set: AgentRuleSet = {
  v: 1, channels: ['food', '', '', ''], masks: [{ name: 'Nest', kind: 'number' }], edges: 'wrap', sensor: { distance: 0.03, angle: 40 }, flow: { size: 1, evolve: 0.15 },
  memories: [{ id: 'm1', name: 'energy', type: 'level' }],
  species: [{ name: 'Ants', speed: 0.3, states: [{ name: 'searching', colour: [1, 1, 1] }, { name: 'carrying', colour: [1, 0, 0] }], rules: [] }],
};
const named = (a: RuleAction) => actionTitle(set, 0, a);

describe('rule names', () => {
  it('names every kind of action from what it does', () => {
    const cases: Array<[RuleAction, string]> = [
      [{ kind: 'turn', toward: 'trail', channel: 'own', degrees: 45 }, 'Follow trail'],
      [{ kind: 'turn', toward: 'trail', channel: 0, degrees: 45 }, 'Follow food trail'],
      [{ kind: 'turn', toward: 'trail', channel: 'own', away: true, degrees: 45 }, 'Avoid trail'],
      [{ kind: 'turn', toward: 'mouse', degrees: 10 }, 'Seek mouse'],
      [{ kind: 'turn', toward: 'mouse', away: true, degrees: 10 }, 'Flee mouse'],
      [{ kind: 'turn', toward: 'centre', degrees: 10 }, 'Head to centre'],
      [{ kind: 'turn', toward: 'point', x: 1, y: 0, degrees: 10 }, 'Head to point'],
      [{ kind: 'wander', degrees: 5 }, 'Wander'],
      [{ kind: 'speed', mode: 'set', value: 0.5 }, 'Speed 0.5'],
      [{ kind: 'speed', mode: 'add', value: 0.5 }, 'Speed up'],
      [{ kind: 'speed', mode: 'add', value: -0.5 }, 'Slow down'],
      [{ kind: 'trail', channel: 'own', amount: 1 }, 'Leave trail'],
      [{ kind: 'trail', channel: 0, amount: 1 }, 'Leave food trail'],
      [{ kind: 'state', state: 1 }, 'Become carrying'],
      [{ kind: 'memory', mode: 'add', value: 1 }, 'Count memory'],
      [{ kind: 'stop' }, 'Stop'], [{ kind: 'stick' }, 'Stick'], [{ kind: 'die' }, 'Die'], [{ kind: 'spawn', amount: 1 }, 'Spawn'], [{ kind: 'bounce' }, 'Turn round'],
      [{ kind: 'flow', degrees: 10 }, 'Follow flow'],
      [{ kind: 'align', degrees: 10 }, 'Fly with crowd'],
      [{ kind: 'separate', who: 'all', degrees: 10 }, 'Keep apart'],
      [{ kind: 'separate', who: 'others', degrees: 10 }, 'Avoid other kinds'],
      [{ kind: 'match', who: 'all', degrees: 10 }, 'Align with neighbours'],
      [{ kind: 'cohere', who: 'all', degrees: 10 }, 'Stay together'],
      [{ kind: 'slow', who: 'all', jam: 10 }, 'Slow in a crowd'],
      [{ kind: 'avoidEdges', margin: 0.2, degrees: 10 }, 'Avoid walls'],
      [{ kind: 'orbit', target: 'mouse', distance: 0.2, degrees: 7 }, 'Orbit mouse'],
      [{ kind: 'force', field: 'gravity', strength: 0.4 }, 'Gravity'],
      [{ kind: 'force', field: 'gravity', strength: 0.4, angle: 90 }, 'Rise'],
      [{ kind: 'force', field: 'wind', strength: 0.4 }, 'Wind'],
      [{ kind: 'force', field: 'curl', strength: 0.4 }, 'Curl noise'],
      [{ kind: 'force', field: 'mouse', strength: 0.4 }, 'Pull to mouse'],
      [{ kind: 'force', field: 'mouse', strength: -0.4 }, 'Push from mouse'],
      [{ kind: 'force', field: 'point', strength: 0.4 }, 'Pull to point'],
      [{ kind: 'drag', amount: 1 }, 'Drag'],
      [{ kind: 'fade', seconds: 3 }, 'Fade with age'],
      [{ kind: 'home', memory: 'm1', strength: 1 }, 'Return home'],
      [{ kind: 'mem', memory: 'm1', op: 'decay', value: 1 }, 'Decay energy'],
    ];
    expect(cases.map(([a]) => named(a))).toEqual(cases.map(([, n]) => n));
  });

  it('a rule: its actions, then its conditions; the user\'s name wins', () => {
    expect(ruleTitle(set, 0, { when: [{ kind: 'always' }], do: [{ kind: 'wander', degrees: 5 }] })).toBe('Wander');
    expect(ruleTitle(set, 0, { when: [{ kind: 'age', cmp: '>', seconds: 6 }], do: [{ kind: 'die' }] })).toBe('Die when older than 6 s');
    expect(ruleTitle(set, 0, { when: [{ kind: 'state', state: 1 }, { kind: 'mask', mask: 0, cmp: '>', value: 0.5 }], do: [{ kind: 'state', state: 0 }] })).toBe('Become searching when carrying and in Nest');
    expect(ruleTitle(set, 0, { when: [], do: [{ kind: 'separate', who: 'all', degrees: 8 }, { kind: 'match', who: 'all', degrees: 8 }] })).toBe('Keep apart & align with neighbours');
    expect(ruleTitle(set, 0, { when: [], do: [{ kind: 'force', field: 'gravity', strength: 1 }, { kind: 'drag', amount: 1 }, { kind: 'fade', seconds: 2 }, { kind: 'wander', degrees: 2 }] })).toBe('Gravity, drag + 2 more');
    expect(ruleTitle(set, 0, { name: '  Get sick ', when: [], do: [{ kind: 'die' }] })).toBe('Get sick');
  });
});
