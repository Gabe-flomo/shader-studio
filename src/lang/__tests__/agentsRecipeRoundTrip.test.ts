/**
 * The agents dialect reads back every recipe it prints (docs/backlog-2026-10-10.md "Do-bar
 * language"): every rules template, every Agent Builder preset (trail followers, particles,
 * flocks, crowds, orbiters), Surprise me's rule sets and the newer card features (fields, only
 * when, named memories and their operation cards, × a memory, colour by a memory, 3D collide,
 * shapes), each printed one-line, pretty, and pretty with its line breaks lost (the recipe pasted
 * into the Do… bar's one-line box), and read back to the same rule set and the same nodes.
 */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} });
});

import { parseAgents, printAgents } from '../dialects/agents';
import { readLine, readsCanonically } from '../run';
import { RULES_TEMPLATES } from '../../agentRules/templates';
import { generateRulesInside } from '../../agentRules/generate';
import { surpriseAgentsFromSeed } from '../../agentRules/surprise';
import { DEFAULT_COLLIDE, normalizeRuleSet, type AgentRule, type AgentRuleSet, type RuleCondition } from '../../agentRules/spec';
import { CROWD_PRESETS, FLOCK_PRESETS, ORBIT_PRESETS, PARTICLE_PRESETS, TRAIL_PRESETS } from '../../agentBuilder/presets';
import { OP_CARDS, addMemory, addOpCard, newMemCondition, patchMemory } from '../../agentBuilder/memory';
import { ONLY_WHEN_KINDS } from '../../agentBuilder/behaviours';
import { newOnlyWhen } from '../../agentBuilder/onlyWhen';

/** A rule set with the optional defaults spelled out, as agentsDialect.test.ts compares them. */
const canon = (set: AgentRuleSet): AgentRuleSet => {
  const s = normalizeRuleSet(JSON.parse(JSON.stringify(set)));
  for (const sp of s.species) for (const r of sp.rules) {
    if (!r.when.length) r.when = [{ kind: 'always' }];
    for (const a of r.do) if (a.kind === 'turn' && a.toward === 'trail' && a.channel === undefined) a.channel = 'own';
    // A switch written false reads as left out (away: false is toward).
    for (const x of [...r.do, ...r.when] as unknown as Array<Record<string, unknown>>) for (const k of Object.keys(x)) if (x[k] === false) delete x[k];
    if (!r.stop) delete r.stop;
    if (!r.off) delete r.off;
  }
  return JSON.parse(JSON.stringify(s));
};
const made = (set: AgentRuleSet) => JSON.stringify([generateRulesInside(set, { groupId: 'g', d3: false }), generateRulesInside(set, { groupId: 'g', d3: true })]);
/** The pretty recipe pasted into a one-line box: its line breaks become spaces. */
const flatten = (text: string) => text.replace(/\s*\n\s*/g, ' ');

function roundTrips(name: string, set: AgentRuleSet) {
  for (const form of ['one line', 'pretty', 'pasted flat'] as const) {
    const text = form === 'one line' ? printAgents(set) : form === 'pretty' ? printAgents(set, { pretty: true }) : flatten(printAgents(set, { pretty: true }));
    const r = parseAgents(text, { seed: 1 });
    expect(r.errors.map(e => `${e.line}:${e.col} ${e.message}`), `${name} (${form}):\n${text}`).toEqual([]);
    expect(canon(r.set), `${name} (${form})`).toEqual(canon(set));
    expect(made(r.set), `${name} (${form}) makes the same nodes`).toBe(made(set));
    if (form !== 'pasted flat') expect(printAgents(r.set, { pretty: form === 'pretty' }), `${name} (${form}) fixpoint`).toBe(text);
  }
}

const PRESETS = [...TRAIL_PRESETS, ...PARTICLE_PRESETS, ...FLOCK_PRESETS, ...CROWD_PRESETS, ...ORBIT_PRESETS];

describe('agents recipes read back: templates and presets', () => {
  for (const t of RULES_TEMPLATES) it(`template ${t.key}`, () => roundTrips(t.key, t.set()));
  for (const p of PRESETS) it(`Agent Builder preset ${p.key}`, () => roundTrips(p.key, p.set()));
  it('Surprise me: 60 rule sets, 2D and 3D', () => {
    for (let seed = 1; seed <= 60; seed++) roundTrips(`surprise ${seed}`, surpriseAgentsFromSeed(seed, { d3: seed % 2 === 0 }).set);
  });
});

describe('agents recipes read back: the card features', () => {
  const base = (): AgentRuleSet => structuredClone(TRAIL_PRESETS.find(p => p.key === 'slime')!.set());

  it('every memory type and every operation card, with memory conditions as their only when', () => {
    let set = base();
    set.channels = ['home', 'food', '', ''];
    const ids: string[] = [];
    for (const [type, name] of [['counter', 'visits'], ['timer', 'away'], ['flag', 'carrying'], ['level', 'energy']] as const) {
      const r = addMemory(set, type, name)!;
      set = r.set;
      ids.push(r.id);
    }
    set = patchMemory(set, ids[3], { start: 1, fade: 0.3 });
    for (const id of ids) {
      const m = set.memories!.find(x => x.id === id)!;
      for (const op of OP_CARDS.filter(o => o.types.includes(m.type))) {
        const r = addOpCard(set, 0, op.id, id)!;
        set = r.set;
        const rules = set.species[0].rules;
        rules[rules.length - 1] = { ...rules[rules.length - 1], when: [newMemCondition(m)] };
      }
    }
    // A smell from a named channel, a count a second, an expression with quotes in it.
    const rules = set.species[0].rules;
    rules.push({ when: [{ kind: 'always' }], do: [{ kind: 'mem', memory: ids[0], op: 'sum', channel: 1, value: 0.5 }] });
    rules.push({ when: [{ kind: 'always' }], do: [{ kind: 'mem', memory: ids[3], op: 'add', value: -0.1, perSecond: true }] });
    rules.push({ when: [{ kind: 'mem', memory: ids[2], cmp: '=', value: 1 }], do: [{ kind: 'mem', memory: ids[0], op: 'expr', expr: 'visits * 0.98 + here.food' }] });
    roundTrips('memories', set);
    expect(printAgents(set)).toContain('remember energy level start=1 fade=0.3');
  });

  it('a place memory, × a memory on actions and on the speed, colour by a memory', () => {
    let set = base();
    const p = addMemory(set, 'position', 'home')!; set = p.set;
    const e = addMemory(set, 'level', 'energy')!; set = e.set;
    set.species[0].speedTimes = { memory: e.id };
    set.species[0].rules[0].do = set.species[0].rules[0].do.map((a, i) => (i === 0 ? { ...a, times: { memory: e.id, fade: 0.2 } } : i === 1 ? { ...a, times: { memory: e.id } } : a));
    set.species[0].rules.push({ when: [{ kind: 'mem', memory: p.id, cmp: '<', value: 0.1 }], do: [{ kind: 'mem', memory: p.id, op: 'place' }] });
    set.colourBy = { memory: e.id, lo: -0.5, hi: 2 };
    roundTrips('times', set);
    const s2 = structuredClone(set);
    s2.species[0].speedTimes = { memory: e.id, fade: 0.4 };
    roundTrips('speed times fade', s2);
  });

  it('memory ids out of order (one taken away) keep their ids', () => {
    let set = base();
    set = addMemory(set, 'flag', 'a')!.set;
    set = addMemory(set, 'flag', 'b')!.set;
    set = { ...set, memories: set.memories!.filter(m => m.name === 'b') };
    set.species[0].rules.push({ when: [{ kind: 'mem', memory: 'm2', cmp: '>', value: 0.5 }], do: [{ kind: 'stop' }] });
    roundTrips('ids', set);
    expect(printAgents(set)).toContain('remember b flag id=m2');
  });

  it('every "only when" kind on a card', () => {
    const set = base();
    set.kind = 'flock';
    set.neighbours = { radius: 0.06, max: 24 };
    set.species[0].states = [...set.species[0].states, { name: 'tired', colour: [0.2, 0.3, 0.4] }];
    for (const k of ONLY_WHEN_KINDS) {
      const c: RuleCondition = newOnlyWhen(k);
      set.species[0].rules.push({ when: [c], do: [{ kind: 'wander', degrees: 4 }] });
    }
    set.species[0].rules.push({ when: [{ kind: 'shape', shape: 'box', x: 0.2, y: -0.3, size: 0.25, outside: true }], do: [{ kind: 'separate', who: 'others', degrees: 8, radius: 0.04 }] });
    roundTrips('only when', set);
  });

  it('fields (Follow a field), forces and 3D collide', () => {
    const set = structuredClone(PARTICLE_PRESETS.find(p => p.key === 'whirlpool')!.set());
    set.collide = { ...DEFAULT_COLLIDE, reach: 2 };
    const r: AgentRule = { when: [{ kind: 'always' }], do: [{ kind: 'field', strength: 0.7, spec: { layers: [{ kind: 'curl', weight: 1, size: 0.3 }] } }, { kind: 'force', field: 'mouse', strength: -1 }] };
    set.species[0].rules.push(r);
    roundTrips('fields', set);
  });
});

describe('the Do… bar reads a pasted recipe as agents', () => {
  it('the screenshot\'s line: particles with flow settings, one line, reads with no errors', () => {
    const set = structuredClone(PARTICLE_PRESETS.find(p => p.key === 'particles')!.set());
    set.flow = { size: 1.95, evolve: 0.3 };
    const text = flatten(printAgents(set, { pretty: true }));
    expect(text.startsWith('agents kind=particles edges=bounce flow size=1.95')).toBe(true);
    const r = readLine(text, { seed: 1 });
    expect(r.dialect).toBe('agents');
    expect(r.errors).toEqual([]);
    expect(readsCanonically(r)).toBeTruthy();
    // "flow" is the agents' own flow field, not the Pass Flow node.
    expect(r.agents!.flow).toEqual({ size: 1.95, evolve: 0.3 });
  });
  it('a pasted multi-line recipe has a one-line canonical form', () => {
    for (const p of PRESETS) {
      const r = readLine(printAgents(p.set(), { pretty: true }), { seed: 1 });
      expect(r.canonical, p.key).toBe(printAgents(p.set()));
    }
  });
  it('"follow flow" in a rule stays an action; "when always" stays a rule', () => {
    const s = parseAgents('agents flow size=1.5 evolve=0.2 species A: when always do follow flow 10deg', { seed: 1 });
    expect(s.errors).toEqual([]);
    expect(s.set.flow.size).toBe(1.5);
    expect(s.set.species[0].rules[0].do).toEqual([{ kind: 'flow', degrees: 10 }]);
  });
  it('a memory name it doesn\'t know is reported with a suggestion', () => {
    const r = parseAgents('remember carrying flag · species A: when mem carying > 0.5 do stop');
    expect(r.errors[0].message).toContain('“carrying”');
  });
});
