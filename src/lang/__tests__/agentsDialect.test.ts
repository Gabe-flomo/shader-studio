/**
 * The Agent Rules dialect (docs/playfield-language-plan.md §4.4, phase 4): text ⇄ AgentRuleSet.
 * Every template round-trips (one line and pretty) to a rule set that generates exactly the same
 * nodes; random rule sets round-trip; the plan's examples read; one-liners need a colon (§13
 * decision 7); names, mistakes and randomness.
 */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} });
});

import { parseAgents, printAgents } from '../dialects/agents';
import { RULES_TEMPLATES } from '../../agentRules/templates';
import { generateRulesInside } from '../../agentRules/generate';
import { ACTION_KINDS, CONDITION_KINDS, DEFAULT_STATE_COLOURS, newAction, newCondition, normalizeRuleSet, type AgentRuleSet, type RuleAction, type RuleCondition } from '../../agentRules/spec';
import { makeRng } from '../random';
import { COLOUR_TABLE } from '../colours';

const read = (src: string) => {
  const r = parseAgents(src, { seed: 1 });
  expect(r.errors.map(e => `${e.line}:${e.col} ${e.message}`), src).toEqual([]);
  return r.set;
};
/** What a rule set makes: the generated inside, 2D and 3D. */
const made = (set: AgentRuleSet) => JSON.stringify([generateRulesInside(set, { groupId: 'g', d3: false }), generateRulesInside(set, { groupId: 'g', d3: true })]);
/** A rule set with the optional defaults spelled out (an empty When is always; a trail turn reads its own channel). */
const canon = (set: AgentRuleSet): AgentRuleSet => {
  const s = normalizeRuleSet(JSON.parse(JSON.stringify(set)));
  for (const sp of s.species) for (const r of sp.rules) {
    if (!r.when.length) r.when = [{ kind: 'always' }];
    for (const a of r.do) if (a.kind === 'turn' && a.toward === 'trail' && a.channel === undefined) a.channel = 'own';
    if (!r.stop) delete r.stop;
    if (!r.off) delete r.off;
  }
  return JSON.parse(JSON.stringify(s));
};

describe('agents dialect: templates', () => {
  for (const t of RULES_TEMPLATES) {
    it(`${t.key}: text → rule set makes the same nodes, one line and pretty`, () => {
      const set = t.set();
      for (const pretty of [false, true]) {
        const text = printAgents(set, { pretty });
        const back = read(text);
        expect(canon(back), text).toEqual(canon(set));
        expect(made(back)).toBe(made(set));
        expect(printAgents(back, { pretty }), 'fixpoint').toBe(text);
      }
    });
  }
});

/** A random rule set from the condition and action kinds, with random numbers and names. */
function randomSet(seed: number): AgentRuleSet {
  const rng = makeRng(seed);
  const nSpecies = rng.int(1, 3);
  const set: AgentRuleSet = {
    v: 1, kind: rng.pick(['trail', 'ants', 'flock', 'particles', 'swarm', 'crowd'] as const), channels: ['home', '', 'big food', ''], masks: rng.chance(0.5) ? [{ name: 'Food', kind: 'number' }, { name: 'Nest', kind: 'texture' }] : [],
    edges: rng.pick(['wrap', 'bounce', 'slide'] as const), sensor: { distance: 0.04, angle: 30 }, flow: { size: 1, evolve: 0.15 }, species: [],
    ...(rng.chance(0.5) ? { neighbours: { radius: 0.06, max: 24 } } : {}),
  };
  for (let i = 0; i < nSpecies; i++) {
    const states = Array.from({ length: rng.int(1, 3) }, (_, j) => ({ name: ['calm', 'busy', 'tired'][j], colour: rng.chance(0.5) ? DEFAULT_STATE_COLOURS[j] : rng.pick(Object.values(COLOUR_TABLE)) }));
    set.species.push({ name: ['Ants', 'Big Bugs', 'Cats'][i], speed: Math.round(rng.float(0.1, 1) * 100) / 100, states, rules: [] });
  }
  set.species.forEach(sp => {
    for (let r = 0; r < rng.int(1, 4); r++) {
      const when: RuleCondition[] = rng.chance(0.3) ? [{ kind: 'always' }] : Array.from({ length: rng.int(1, 3) }, () => {
        const k = rng.pick(CONDITION_KINDS.filter(x => x.kind !== 'always' && (x.kind !== 'mask' || set.masks.length))).kind;
        const c = newCondition(k);
        if (c.kind === 'state') { c.state = rng.int(0, sp.states.length - 1); if (rng.chance(0.3)) c.not = true; }
        if (c.kind === 'sense') { c.channel = rng.pick(['own', 0, 2] as const); c.where = rng.pick(['ahead', 'left', 'right', 'any', 'here'] as const); c.cmp = rng.pick(['>', '<'] as const); }
        if (c.kind === 'near') c.species = rng.int(0, set.species.length - 1);
        if (c.kind === 'mask') c.mask = rng.int(0, set.masks.length - 1);
        if (c.kind === 'memory') c.cmp = rng.pick(['>', '<', '='] as const);
        if (c.kind === 'neighbours') { c.who = rng.pick(['all', 'own', 'others'] as const); if (rng.chance(0.5)) c.radius = 0.08; }
        return c;
      });
      const acts: RuleAction[] = Array.from({ length: rng.int(1, 4) }, () => {
        const a = newAction(rng.pick(ACTION_KINDS).kind);
        if (a.kind === 'turn') { const t = rng.pick(['trail', 'point', 'centre', 'mouse'] as const); a.toward = t; if (t === 'trail') a.channel = rng.pick(['own', 0, 2] as const); else delete a.channel; if (t === 'point') { a.x = -0.2; a.y = 0.3; } if (rng.chance(0.4)) a.away = true; }
        if (a.kind === 'state') a.state = rng.int(0, sp.states.length - 1);
        if (a.kind === 'memory') a.mode = rng.pick(['set', 'add', 'perSecond', 'random'] as const);
        if (a.kind === 'speed') a.mode = rng.pick(['set', 'add'] as const);
        if (a.kind === 'trail') { a.channel = rng.pick(['own', 0, 2] as const); if (rng.chance(0.4)) a.fade = 0.2; }
        if (a.kind === 'force') { a.field = rng.pick(['gravity', 'wind', 'curl', 'point', 'mouse'] as const); if (a.field === 'point') { a.x = 0.1; a.y = -0.4; } if (a.field === 'mouse' || a.field === 'point' || a.field === 'curl') delete a.angle; if (rng.chance(0.4)) a.strength = -a.strength; }
        if (a.kind === 'orbit' && rng.chance(0.5)) { a.target = 'point'; a.x = 0.2; a.y = 0.1; a.cw = true; }
        if (a.kind === 'flow' && rng.chance(0.5)) a.away = true;
        return a;
      });
      // A force's strength is written unsigned with toward/away; gravity, wind and curl keep the sign.
      sp.rules.push({ when, do: acts, ...(rng.chance(0.3) ? { stop: true } : {}), ...(rng.chance(0.2) ? { off: true } : {}) });
    }
  });
  return set;
}

describe('agents dialect: random rule sets round-trip', () => {
  it('200 random rule sets: text → the same rule set, the same nodes', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const set = randomSet(seed);
      const text = printAgents(set, { pretty: seed % 2 === 0 });
      const back = read(text);
      expect(canon(back), text).toEqual(canon(set));
      expect(made(back), text).toBe(made(set));
    }
  });
});

describe('agents dialect: the plan\'s examples', () => {
  it('slime mold on one line, with a colon (decision 7)', () => {
    const s = read('agents · sensors ahead=0.035 angle=22.5deg · species Slime speed=0.22: always do turn toward trail 45deg, wander 7deg, leave trail 1');
    expect(s.sensor).toEqual({ distance: 0.035, angle: 22.5 });
    expect(s.species[0].rules[0].do.map(a => a.kind)).toEqual(['turn', 'wander', 'trail']);
  });
  it('ants: names tell states, channels and masks apart (channel food, mask Food)', () => {
    const s = read(`agents kind=ants edges=bounce
sensors ahead=0.04 angle=35deg
channels home, food
masks Food, Nest
species Ants speed=0.3 states=searching,carrying
  always do memory += 1/s, wander 5deg
  when searching and mask Food > 0.5 do become carrying, turn around, memory = 0 @last
  when searching and food anywhere > 0.05 do turn toward food 20deg
  when carrying do leave food 1 fade=0.15, turn toward home 20deg, turn toward (-0.15,-0.1) 2deg`);
    const r = s.species[0].rules;
    expect(r[0].do).toEqual([{ kind: 'memory', mode: 'perSecond', value: 1 }, { kind: 'wander', degrees: 5 }]);
    expect(r[1]).toEqual({ when: [{ kind: 'state', state: 0 }, { kind: 'mask', mask: 0, cmp: '>', value: 0.5 }], do: [{ kind: 'state', state: 1 }, { kind: 'bounce' }, { kind: 'memory', mode: 'set', value: 0 }], stop: true });
    expect(r[2].when[1]).toEqual({ kind: 'sense', channel: 1, where: 'any', cmp: '>', value: 0.05 });
    expect(r[3].do[2]).toEqual({ kind: 'turn', toward: 'point', x: -0.15, y: -0.1, degrees: 2 });
  });
  it('the SIR template reads from the plan\'s text', () => {
    const s = read(`agents
sensors ahead=0.02 angle=40deg
channels germs
species People speed=0.12 states=healthy,sick,recovered
  always do wander 30deg
  when healthy and age < 0.3s and chance 0.2% do become sick, memory = 0
  when healthy and germs here > 0.3 and chance 60% do become sick, memory = 0
  when sick do memory += 1/s, leave germs 1
  when sick and memory > 5 do become recovered, memory = 0
  when recovered do memory += 1/s
  when recovered and memory > 20 do become healthy, memory = 0`);
    const sir = RULES_TEMPLATES.find(t => t.key === 'sir')!.set();
    expect(s.species[0].rules).toEqual(sir.species[0].rules);
  });
});

describe('agents dialect: names, mistakes, one-liners, randomness', () => {
  it('rules on one line need the colon; on lines of their own, an indent', () => {
    expect(parseAgents('species Ants · always do wander 7deg').errors[0].message).toMatch(/species Ants: always/);
    expect(read('species Ants:  always do wander 7deg · when walking do stop').species[0].rules).toHaveLength(2);
    expect(read('always do wander 7deg').species[0].rules).toHaveLength(1);
    const two = read('species A: always do wander 5deg · species B: always do stop');
    expect(two.species.map(s => s.rules.length)).toEqual([1, 1]);
  });
  it('quotes names with spaces or that are keywords', () => {
    const set = RULES_TEMPLATES.find(t => t.key === 'termites')!.set();
    expect(printAgents(set)).toContain('channels "wood chips"');
    expect(printAgents(set)).toContain('leave "wood chips" -1');
  });
  it('mistakes at their place with "did you mean"', () => {
    const r = parseAgents('species Ants states=searching,carrying\n  when serching do wander 5deg');
    expect(r.errors[0]).toMatchObject({ line: 2 });
    expect(r.errors[0].message).toContain('“searching”');
    expect(parseAgents('species Ants: always do wandr 5deg').errors[0].message).toContain('“wander”');
    expect(parseAgents('channels home · species Ants: always do turn toward hoem 10deg').errors[0].message).toContain('“home”');
  });
  it('random numbers in rules and a leading random, repeatable with a seed', () => {
    const a = parseAgents('species Slime: always do wander random, turn toward trail random(20..40) · seed=5');
    const b = parseAgents('species Slime: always do wander random, turn toward trail random(20..40) · seed=5');
    expect(a.set).toEqual(b.set);
    const [w, t] = a.set.species[0].rules[0].do as Array<{ degrees: number }>;
    expect(w.degrees).toBeGreaterThanOrEqual(3);
    expect(t.degrees).toBeGreaterThanOrEqual(20);
    expect(t.degrees).toBeLessThanOrEqual(40);
    const r = parseAgents('random species Slime: always do wander 7deg', { seed: 3 });
    expect(r.errors).toEqual([]);
    expect(r.resolved.map(x => x.key)).toEqual(expect.arrayContaining(['sensors.ahead', 'sensors.angle', 'Slime.speed', 'walking.color']));
  });
});
