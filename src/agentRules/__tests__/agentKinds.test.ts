/**
 * Walker kinds in Agent Rules (docs/agent-rules.md "Kinds"): the Kind choice picks which sections,
 * conditions and actions the editor shows; the neighbour conditions and actions read Neighbours nodes
 * the rules make (one per (which walkers, radius)); the particle forces, drag, fade, orbit and
 * avoid-edges actions. Each is run on the CPU through the generated GLSL (cpuSim.ts; a brute force
 * over the walkers stands in for the Neighbours node, whose GPU query agentNeighbours.test.ts checks
 * against the same brute force). Rules → nodes keeps the Neighbours nodes, and the templates compile.
 */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});

import { compileGraph } from '../../compiler/graphCompiler';
import { n } from '../../store/graphBuilder';
import { ACTION_HELP, CONDITION_HELP } from '../../components/builders/helpContent';
import { applyRulesToGroup, backToRules, openRulesAsNodes } from '../apply';
import { generateRulesInside } from '../generate';
import { RULES_TEMPLATES, rulesTemplate, rulesTemplateNodes } from '../templates';
import {
  type AgentRule, type AgentRuleSet, type RuleAction, type RuleCondition, type WalkerKind,
  ACTION_KINDS, CONDITION_KINDS, WALKER_KINDS, WALKER_KIND_KEYS, actionKindsFor, conditionKindsFor, defaultRuleSet, describeRule,
  kindOf, neighbourReads, normalizeRuleSet, showsSection,
} from '../spec';
import { insideOf, programOf, simulate, walkersFor, type SimOptions, type Walker } from './cpuSim';

const GID = 'g';
const setOf = (rules: AgentRule[], o: Partial<AgentRuleSet> = {}, speed = 0.2): AgentRuleSet => ({
  ...defaultRuleSet(), ...o,
  species: o.species ?? [{ name: 'A', speed, states: [{ name: 's0', colour: [1, 0, 0] }, { name: 's1', colour: [0, 1, 0] }], rules }],
});
const prog = (set: AgentRuleSet, d3 = false) => programOf(generateRulesInside(set, { groupId: GID, d3 }));
const doing = (...a: RuleAction[]): AgentRule => ({ when: [{ kind: 'always' }], do: a });
const walker = (w: Partial<Walker>, i = 0, d3 = false): Walker => ({ ...walkersFor(1, { d3 })[0], index: i, pos: d3 ? [0, 0, 0] : [0, 0], heading: d3 ? [1, 0, 0] : 0, speed: 0.2, ...w });
/** Run walkers together (the first is the one we look at) for `steps` steps. */
const run = (set: AgentRuleSet, ws: Walker[], steps = 1, o: SimOptions = {}) => simulate(prog(set, o.d3), ws, steps, o);
const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

describe('kinds: what the editor shows', () => {
  it('each kind offers known conditions and actions, every one with its help, and its templates exist', () => {
    for (const k of WALKER_KIND_KEYS) {
      const kind = WALKER_KINDS[k];
      expect(conditionKindsFor(k).every(Boolean), k).toBe(true);
      expect(actionKindsFor(k).every(Boolean), k).toBe(true);
      for (const c of kind.conditions) expect(CONDITION_HELP[c], `${k}: ${c}`).toBeTruthy();
      for (const a of kind.actions) expect(ACTION_HELP[a], `${k}: ${a}`).toBeTruthy();
      expect(kind.templates.length, k).toBeGreaterThan(0);
      for (const t of kind.templates) expect(rulesTemplate(t), `${k}: ${t}`).toBeTruthy();
      // Its first template is of its own kind.
      expect(kindOf(rulesTemplate(kind.templates[0])!.set()), k).toBe(k);
    }
    // Every condition and action is offered by some kind.
    for (const c of CONDITION_KINDS) if (c.kind !== 'always') expect(WALKER_KIND_KEYS.some(k => WALKER_KINDS[k].conditions.includes(c.kind)), c.kind).toBe(true);
    for (const a of ACTION_KINDS) expect(WALKER_KIND_KEYS.some(k => WALKER_KINDS[k].actions.includes(a.kind)), a.kind).toBe(true);
  });

  it('particles show no sensing; a flock shows neighbours and no trail sensors; trail followers no neighbours', () => {
    const conds = (k: WalkerKind) => conditionKindsFor(k).map(c => c.kind);
    const acts = (k: WalkerKind) => actionKindsFor(k).map(a => a.kind);
    expect(conds('particles')).not.toContain('sense');
    expect(conds('particles')).not.toContain('near');
    expect(conds('particles')).not.toContain('neighbours');
    expect(acts('particles')).toEqual(expect.arrayContaining(['force', 'bounce', 'fade', 'drag']));
    expect(acts('particles')).not.toContain('turn');
    expect(conds('flock')).toContain('neighbours');
    expect(conds('flock')).not.toContain('sense');
    expect(acts('flock')).toEqual(expect.arrayContaining(['separate', 'match', 'cohere', 'avoidEdges']));
    expect(acts('flock')).not.toContain('align');
    expect(conds('trail')).not.toContain('neighbours');
    expect(acts('trail')).not.toContain('separate');
    expect(conds('ants')).toEqual(expect.arrayContaining(['state', 'memory', 'sense']));
    expect(acts('swarm')).toEqual(expect.arrayContaining(['orbit', 'separate', 'cohere']));
    expect(acts('crowd')).toEqual(expect.arrayContaining(['slow', 'separate', 'turn', 'flow']));
    expect(conds('crowd')).toContain('neighbours');

    const particles = setOf([], { kind: 'particles', species: [{ name: 'P', speed: 1, states: [{ name: 'on', colour: [1, 1, 1] }], rules: [] }] });
    expect(showsSection(particles, 'sensors')).toBe(false);
    expect(showsSection(particles, 'channels')).toBe(false);
    expect(showsSection(particles, 'neighbours')).toBe(false);
    expect(showsSection(particles, 'states')).toBe(false);
    const flock = setOf([], { kind: 'flock' });
    expect(showsSection(flock, 'neighbours')).toBe(true);
    expect(showsSection(flock, 'sensors')).toBe(false);
    // A rule set keeps in view what it uses, whatever its kind.
    const mixed = setOf([doing({ kind: 'turn', toward: 'trail', channel: 'own', degrees: 20 }), doing({ kind: 'separate', who: 'all', degrees: 10 })], { kind: 'particles' });
    expect(showsSection(mixed, 'sensors')).toBe(true);
    expect(showsSection(mixed, 'neighbours')).toBe(true);
    // Saved sets without a kind are trail followers; the kind and view radius are read back.
    expect(kindOf(normalizeRuleSet({}))).toBe('trail');
    const back = normalizeRuleSet({ kind: 'flock', neighbours: { radius: 0.08, max: 50 }, species: [{ rules: [] }] });
    expect(kindOf(back)).toBe('flock');
    expect(back.neighbours).toEqual({ radius: 0.08, max: 50 });
    expect(kindOf(normalizeRuleSet({ kind: 'nope' }))).toBe('trail');
  });
});

describe('neighbour conditions and actions', () => {
  it('make one Neighbours node per (which walkers, radius), with the rule set\'s Max and edges', () => {
    const set = setOf([
      { when: [{ kind: 'neighbours', who: 'all', cmp: '>', count: 3 }], do: [{ kind: 'separate', who: 'all', degrees: 10 }, { kind: 'match', who: 'own', degrees: 5 }] },
      doing({ kind: 'slow', who: 'others', jam: 10, radius: 0.02 }, { kind: 'cohere', who: 'all', degrees: 3 }),
    ], { kind: 'flock', neighbours: { radius: 0.06, max: 50 }, edges: 'bounce' });
    expect(neighbourReads(set).map(r => [r.who, r.radius])).toEqual([['all', 0.06], ['own', 0.06], ['others', 0.02]]);
    const inside = generateRulesInside(set, { groupId: GID, d3: false });
    const nb = inside.filter(x => x.type === 'agentNeighbours');
    expect(nb.map(x => [x.params.species, x.params.radius, x.params.max, x.params.edges])).toEqual([['all', 0.06, 50, 'stop'], ['own', 0.06, 50, 'stop'], ['others', 0.02, 50, 'stop']]);
    for (const x of nb) expect(String(x.params.__comment).length).toBeGreaterThan(40);
    expect(describeRule(set, 0, set.species[0].rules[0])).toBe('When more than 3 neighbours within 0.06 → steer away from neighbours within 0.06 (10°), match the heading of its own kind within 0.06 (5°)');
  });

  it('"more than N neighbours within r" counts the walkers round it', () => {
    const set = setOf([{ when: [{ kind: 'neighbours', who: 'all', cmp: '>', count: 1 }], do: [{ kind: 'state', state: 1 }] }], { neighbours: { radius: 0.05, max: 36 } });
    const near = [walker({}), walker({ pos: [0.02, 0] }, 1), walker({ pos: [0, 0.03] }, 2), walker({ pos: [0.5, 0.5] }, 3)];
    const after = run(set, near);
    expect(after[0].mem[0]).toBe(1); // two within 0.05
    expect(after[3].mem[0]).toBe(0); // none
    expect(after[1].mem[0]).toBe(1); // the other two
    const fewer = run(setOf([{ when: [{ kind: 'neighbours', who: 'all', cmp: '<', count: 1 }], do: [{ kind: 'state', state: 1 }] }]), near);
    expect(fewer.map(w => w.mem[0])).toEqual([0, 0, 0, 1]);
  });

  it('steer away (separation), match heading (alignment), move to their centre (cohesion), each at most its degrees', () => {
    const deg = 10, max = deg * Math.PI / 180;
    // A neighbour ahead and to the left: separation turns right.
    const sep = run(setOf([doing({ kind: 'separate', who: 'all', degrees: deg })]), [walker({}), walker({ pos: [0.02, 0.01] }, 1)]);
    expect(sep[0].heading as number).toBeLessThan(0);
    expect(sep[0].heading as number).toBeGreaterThanOrEqual(-max - 1e-6);
    // A neighbour flying straight up: alignment turns left, toward 90°.
    const ali = run(setOf([doing({ kind: 'match', who: 'all', degrees: deg })]), [walker({}), walker({ pos: [0.02, 0], heading: Math.PI / 2, speed: 0.3 }, 1)]);
    expect(ali[0].heading as number).toBeCloseTo(max, 6);
    // A neighbour above: cohesion turns toward it.
    const coh = run(setOf([doing({ kind: 'cohere', who: 'all', degrees: deg })]), [walker({}), walker({ pos: [0, 0.03] }, 1)]);
    expect(coh[0].heading as number).toBeCloseTo(max, 6);
    // Alone: none of them turns it.
    for (const a of ['separate', 'match', 'cohere'] as const) expect(run(setOf([doing({ kind: a, who: 'all', degrees: deg })]), [walker({})])[0].heading, a).toBe(0);
  });

  it('which walkers: its own kind, or other kinds', () => {
    const two = (who: 'own' | 'others') => setOf([], {
      species: [0, 1].map(i => ({ name: `S${i}`, speed: 0.2, states: [{ name: 'a', colour: [1, 1, 1] as [number, number, number] }], rules: [{ when: [{ kind: 'neighbours' as const, who, cmp: '>' as const, count: 0 }], do: [{ kind: 'state' as const, state: 1 }] }] })),
    });
    // Walker 0 (species 0) has a species-1 walker near; walker 2 (species 0) a species-0 walker near.
    const ws = [walker({ species: 0 }), walker({ species: 1, pos: [0.02, 0] }, 1), walker({ species: 0, pos: [1, 0] }, 2), walker({ species: 0, pos: [1.02, 0] }, 3)];
    expect(run(two('others'), ws).map(w => Math.floor(w.mem[0]))).toEqual([1, 1, 0, 0]);
    expect(run(two('own'), ws).map(w => Math.floor(w.mem[0]))).toEqual([0, 0, 1, 1]);
  });

  it('slow down in a crowd: Speed × (1 − count / jam)', () => {
    const set = setOf([doing({ kind: 'slow', who: 'all', jam: 8 })], {}, 0.4);
    const crowd = [walker({ speed: 0.4 }), ...[1, 2, 3, 4].map(i => walker({ pos: [0.01 * i, 0] }, i))];
    expect(run(set, crowd)[0].speed).toBeCloseTo(0.4 * (1 - 4 / 8), 6);
    expect(run(set, [walker({ speed: 0.4 })])[0].speed).toBeCloseTo(0.4, 6);
  });

  it('works in 3D: neighbours round it in depth too', () => {
    const set = setOf([{ when: [{ kind: 'neighbours', who: 'all', cmp: '>', count: 0 }], do: [{ kind: 'state', state: 1 }, { kind: 'cohere', who: 'all', degrees: 10 }] }]);
    const ws = [walker({}, 0, true), walker({ pos: [0, 0, 0.03] }, 1, true), walker({ pos: [0, 0, 0.3] }, 2, true)];
    const after = run(set, ws, 1, { d3: true });
    expect(after[0].mem[0]).toBe(1);
    expect(after[2].mem[0]).toBe(0);
    // Cohesion turned it toward +z.
    expect((after[0].heading as number[])[2]).toBeGreaterThan(0.1);
  });
});

describe('particles, swarms and crowds: forces, drag, fade, orbit, edges', () => {
  it('gravity: a constant force changes the velocity by force × time, at any step length', () => {
    // A particles set: its speed is the Emit's from the first step (other kinds start at their Speed for 0.025 s).
    const set = setOf([doing({ kind: 'force', field: 'gravity', strength: 0.6, angle: -90 })], { kind: 'particles' }, 0.5);
    for (const dt of [1 / 60, 1 / 120]) {
      const w = run(set, [walker({ speed: 0.5 })], Math.round(1 / dt), { dt })[0];
      const vx = Math.cos(w.heading as number) * w.speed, vy = Math.sin(w.heading as number) * w.speed;
      expect(vx).toBeCloseTo(0.5, 5);
      expect(vy).toBeCloseTo(-0.6, 4);
    }
  });

  it('a pull toward a point (or a push away), curl noise as a force, and drag', () => {
    const pull = run(setOf([doing({ kind: 'force', field: 'point', strength: 1, x: 0, y: 1 })], {}, 0.2), [walker({})])[0];
    expect(Math.sin(pull.heading as number)).toBeGreaterThan(0);
    const push = run(setOf([doing({ kind: 'force', field: 'point', strength: -1, x: 0, y: 1 })], {}, 0.2), [walker({})])[0];
    expect(Math.sin(push.heading as number)).toBeLessThan(0);
    const curl = run(setOf([doing({ kind: 'force', field: 'curl', strength: 2 })], {}, 0.2), [walker({})], 1, { flow: () => [0, 1] })[0];
    expect(Math.sin(curl.heading as number) * curl.speed).toBeCloseTo(2 / 60, 6);
    for (const dt of [1 / 60, 1 / 120]) {
      const d = run(setOf([doing({ kind: 'drag', amount: 0.5 })], {}, 0.4), [walker({ speed: 0.4, age: 1 })], Math.round(1 / dt), { dt })[0];
      expect(d.speed).toBeCloseTo(0.4 * Math.exp(-0.5), 6);
    }
  });

  it('fade with age dims its colour from 1 at birth to 0 at the seconds given', () => {
    const set = setOf([doing({ kind: 'fade', seconds: 2 })]);
    const w = run(set, [walker({ age: 1 - 1 / 60 })])[0];
    expect(w.colour[0]).toBeCloseTo(0.5, 6);
    expect(run(set, [walker({ age: 5 })])[0].colour[0]).toBe(0);
  });

  it('orbit turns along the circle (and in toward it from outside); avoid edges turns back inward', () => {
    const orbit = setOf([doing({ kind: 'orbit', target: 'centre', distance: 0.5, degrees: 10 })]);
    // On the circle at (0.5, 0) heading right: counter-clockwise is up.
    expect(run(orbit, [walker({ pos: [0.5, 0], heading: 0 })])[0].heading as number).toBeCloseTo(10 * Math.PI / 180, 6);
    const cw = setOf([doing({ kind: 'orbit', target: 'centre', distance: 0.5, degrees: 10, cw: true })]);
    expect(run(cw, [walker({ pos: [0.5, 0], heading: 0 })])[0].heading as number).toBeCloseTo(-10 * Math.PI / 180, 6);
    // Far outside, heading along the tangent: it also turns inward (the radial part).
    const out = run(orbit, [walker({ pos: [1.4, 0], heading: Math.PI / 2 })])[0];
    expect(wrapAngle((out.heading as number) - Math.PI / 2)).toBeGreaterThan(0);
    const edges = setOf([doing({ kind: 'avoidEdges', margin: 0.1, degrees: 15 })]);
    const nearRight = run(edges, [walker({ pos: [16 / 9 - 0.05, 0], heading: 0.1 })])[0];
    expect(nearRight.heading as number).toBeGreaterThan(0.1);
    expect(run(edges, [walker({ pos: [0, 0], heading: 0.1 })])[0].heading).toBeCloseTo(0.1, 9);
  });

  it('particles start at the speed their Emit gave them', () => {
    const set = setOf([doing({ kind: 'drag', amount: 0 })], { kind: 'particles' }, 0.3);
    expect(run(set, [walker({ speed: 0.9, age: 0 })])[0].speed).toBeCloseTo(0.9, 6);
    expect(run(set, [walker({ speed: 0, age: 0 })])[0].speed).toBeCloseTo(0.3, 6);
  });
});

describe('rules → nodes, templates', () => {
  it('Open as nodes keeps the Neighbours nodes: the same inside, the same shader, the same walkers after N steps', () => {
    for (const key of ['boids', 'swarm', 'crowd']) {
      const nodes = rulesTemplateNodes(key, 'nb');
      const g = nodes.find(x => x.type === 'agentsGroup')!;
      const opened = openRulesAsNodes(g);
      expect(insideOf(opened).filter(x => x.type === 'agentNeighbours').length, key).toBe(neighbourReads(rulesTemplate(key)!.set()).length);
      expect(insideOf(opened).filter(x => x.type === 'agentNeighbours').length, key).toBeGreaterThan(0);
      const r1 = compileGraph({ nodes }), r2 = compileGraph({ nodes: nodes.map(x => (x === g ? opened : x)) });
      expect(r1.errors, key).toBeUndefined();
      expect(r2.agents!.groups[0].fragmentShader, key).toBe(r1.agents!.groups[0].fragmentShader);
      expect(r1.agents!.groups[0].neighbours, key).toBeTruthy();
      expect(r2.agents!.groups[0].neighbours, key).toEqual(r1.agents!.groups[0].neighbours);
      const species = rulesTemplate(key)!.set().species.length;
      const a = simulate(programOf(insideOf(g)), walkersFor(48, { species }), 30);
      const b = simulate(programOf(insideOf(opened)), walkersFor(48, { species }), 30);
      expect(b, key).toEqual(a);
      expect(JSON.stringify(insideOf(backToRules(opened)))).toBe(JSON.stringify(insideOf(g)));
    }
  });

  it('the new templates compile in 2D and 3D, deterministically, and move', () => {
    for (const key of ['boids', 'particles', 'swarm', 'crowd']) {
      for (const space of ['2d', '3d'] as const) {
        const nodes = rulesTemplateNodes(key, 'kt').map(x => (x.type === 'agentsGroup' ? backToRules({ ...x, params: { ...x.params, space } }) : x));
        const r = compileGraph({ nodes });
        expect(r.errors, `${key} ${space}`).toBeUndefined();
        expect(r.success).toBe(true);
      }
      const set = rulesTemplate(key)!.set();
      const g = applyRulesToGroup(n('agentsGroup', GID, 0, 0, { subgraph: { nodes: [], inputPorts: [], outputPorts: [] } }), set);
      const ws = walkersFor(40, { species: set.species.length, speed: 0.3 });
      const a = simulate(programOf(insideOf(g)), ws, 20), b = simulate(programOf(insideOf(g)), ws, 20);
      expect(b, key).toEqual(a);
      expect(a.some((w, i) => Math.hypot(w.pos[0] - ws[i].pos[0], w.pos[1] - ws[i].pos[1]) > 0.01), key).toBe(true);
    }
    expect(RULES_TEMPLATES.filter(t => ['particles', 'swarm', 'crowd', 'boids'].includes(t.key)).map(t => kindOf(t.set()))).toEqual(['flock', 'particles', 'swarm', 'crowd']);
  });

  it('every new condition and action reads as a sentence', () => {
    const set = setOf([], { neighbours: { radius: 0.05, max: 36 } });
    const c: RuleCondition = { kind: 'neighbours', who: 'others', cmp: '<', count: 4, radius: 0.02 };
    expect(describeRule(set, 0, { when: [c], do: [{ kind: 'force', field: 'mouse', strength: -1 }, { kind: 'drag', amount: 0.2 }, { kind: 'fade', seconds: 3 }] }))
      .toBe('When fewer than 4 of other kinds within 0.02 → apply a push away from the mouse 1, drag 0.2 a second, fade with age over 3 s');
    expect(describeRule(set, 0, doing({ kind: 'orbit', target: 'point', x: 0.2, y: -0.1, distance: 0.4, degrees: 5, cw: true }, { kind: 'avoidEdges', margin: 0.1, degrees: 12 }, { kind: 'force', field: 'gravity', strength: 0.5, angle: -90 })))
      .toBe('When always → orbit the point (0.2, -0.1) at 0.4 clockwise (5°), avoid the edges (within 0.1, 12°), apply gravity 0.5 at -90°');
  });
});
