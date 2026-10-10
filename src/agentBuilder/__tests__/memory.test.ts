/**
 * Phase 4, Memory (docs/agent-builder.md "Memory"): the slots (state E only when used, old graphs
 * unchanged), named memories, every operation card as a rule that compiles and runs, expressions
 * (parse, typecheck, compile), memory conditions, slider × memory, Look's colour by a memory, the
 * ants preset as cards, and Under the hood's E channels.
 */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});

import { parser } from '@shaderfrog/glsl-parser';
import { compileGraph } from '../../compiler/graphCompiler';
import { getNodeDefinition, resolveNodeAliases } from '../../nodes/definitions';
import { EXAMPLE_GRAPHS } from '../../store/exampleGraphs';
import { applyRulesToGroup } from '../../agentRules/apply';
import { generateRulesInside, ruleIds } from '../../agentRules/generate';
import { RULES_TEMPLATES, rulesTemplateNodes } from '../../agentRules/templates';
import { type AgentRuleSet, type RuleAction, type RuleCondition, defaultRuleSet, describeRule, normalizeRuleSet, sensedChannels } from '../../agentRules/spec';
import { checkMemoryExpr, exprNames, memorySlots, usesMemories } from '../../agentRules/memory';
import { needsStateE } from '../../compiler/agentGraph';
import { programOf, simulate, walkersFor, type Walker } from '../../agentRules/__tests__/cpuSim';
import {
  OP_CARDS, addMemory, addOpCard, antsWithMemories, memWhenText, memorySlotNames, newMemCondition, opCardOf, opCardsFor, removeMemory, renameMemory, roomFor,
} from '../memory';
import { readCards } from '../cards';
import { readBehaviours, setMemWhen, setOnlyWhen } from '../behaviours';
import { kindCards } from '../sections';
import { trailPreset } from '../presets';
import { hoodTextures, hoodTileSpecs } from '../hood';
import { decodeMemRanges, MEM_RANGE_N, parseMemSlot } from '../../lib/agentMemoryGpu';

const GID = 'g';
const withMem = (o: Partial<AgentRuleSet> = {}): AgentRuleSet => ({ ...defaultRuleSet(), ...o });
const energySet = (): AgentRuleSet => {
  const a = addMemory(withMem(), 'level', 'energy')!;
  return a.set;
};
const nodesWith = (set: AgentRuleSet, space: '2d' | '3d' = '2d') => {
  const nodes = rulesTemplateNodes('slime', `m${space}`);
  const gi = nodes.findIndex(x => x.type === 'agentsGroup');
  nodes[gi] = applyRulesToGroup({ ...nodes[gi], params: { ...nodes[gi].params, space } }, set);
  return nodes;
};
const compiles = (set: AgentRuleSet, space: '2d' | '3d' = '2d') => {
  const r = compileGraph({ nodes: nodesWith(set, space) });
  expect(r.errors, space).toBeUndefined();
  const fs = r.agents!.groups[0].fragmentShader;
  expect(() => parser.parse(fs.replace(/^#version.*$/m, ''), { quiet: true })).not.toThrow();
  return r;
};
const run = (set: AgentRuleSet, steps: number, w: Partial<Walker> = {}, trail?: (uv: number[]) => number[]) =>
  simulate(programOf(generateRulesInside(set, { groupId: GID, d3: false })), [{ ...walkersFor(1)[0], pos: [0, 0], heading: 0, speed: 0.2, mem2: [0, 0, 0, 0], age: 0, ...w }], steps, { trail })[0];

describe('memory slots (state E)', () => {
  it('a group gets More memory only when something reads or sets it: every example compiles as before', () => {
    for (const t of RULES_TEMPLATES) {
      const inside = generateRulesInside(t.set(), { groupId: GID, d3: false });
      const out = inside.find(x => x.type === 'agentOutput')!;
      expect(out.inputs.moreMemory?.connection, t.key).toBeUndefined();
      expect(needsStateE(inside, out), t.key).toBe(false);
    }
    for (const [k, g] of Object.entries(EXAMPLE_GRAPHS)) {
      if (!g.nodes.some(n => n.type === 'agentsGroup')) continue;
      const r = compileGraph({ nodes: resolveNodeAliases(g.nodes, getNodeDefinition) });
      for (const grp of r.agents?.groups ?? []) {
        expect(grp.stateE, k).toBeUndefined();
        expect(grp.fragmentShader, k).not.toContain('o_e');
      }
    }
  });

  it('memories take E\'s numbers in order (a place two); a fifth number has no room', () => {
    let set = withMem();
    for (const t of ['flag', 'position', 'timer'] as const) set = addMemory(set, t)!.set;
    expect([...memorySlots(set).values()]).toEqual(['x', 'yz', 'w']);
    expect(roomFor(set, 'counter')).toBe(false);
    expect(addMemory(set, 'counter')).toBeNull();
    expect(memorySlotNames(set)).toEqual(['carrying', 'home x', 'home y', 'away']);
    expect(usesMemories(set)).toBe(true);
    expect(usesMemories(withMem())).toBe(false);
  });

  it('with memories the group has a fifth output and sampler, born at 0, kept for the dead (2D and 3D)', () => {
    const set = energySet();
    for (const sp of ['2d', '3d'] as const) {
      const r = compiles(set, sp);
      const g = r.agents!.groups[0];
      expect(g.stateC && g.stateE).toBe(true);
      const fs = g.fragmentShader;
      expect(fs).toContain('layout(location = 4) out highp vec4 o_e;');
      expect(fs).toMatch(/uniform sampler2D u_agE_/);
      expect(fs).toContain('a_mem2 = a_sE;');
      expect(fs).toContain('o_e = vec4(0.0);');
      expect(fs).toContain('o_e = a_sE;');
    }
  });

  it('survives saving: normalizeRuleSet keeps memories and colour by', () => {
    const set = { ...energySet(), colourBy: { memory: 'm1', lo: 0, hi: 2 } };
    const back = normalizeRuleSet(JSON.parse(JSON.stringify(set)));
    expect(back.memories).toEqual(set.memories);
    expect(back.colourBy).toEqual({ memory: 'm1', lo: 0, hi: 2 });
  });
});

describe('operation cards', () => {
  it('every card maps to a rule action that compiles and describes itself', () => {
    let first = withMem({ channels: ['food', '', '', ''] });
    for (const t of ['counter', 'flag', 'position'] as const) first = addMemory(first, t)!.set;
    let more = withMem({ channels: ['food', '', '', ''] });
    for (const t of ['timer', 'level', 'value'] as const) more = addMemory(more, t)!.set;
    for (const [set, m] of [...first.memories!.map(m => [first, m] as const), ...more.memories!.map(m => [more, m] as const)]) {
      for (const op of opCardsFor(m)) {
        const added = addOpCard(set, 0, op.id, m.id)!;
        const a = added.set.species[0].rules[added.at.rule].do[0] as Extract<RuleAction, { kind: 'mem' }>;
        expect(opCardOf(a, m), `${m.type} ${op.id}`).toBe(op.id);
        expect(describeRule(added.set, 0, added.set.species[0].rules[added.at.rule])).toMatch(/^When always → /);
        compiles(added.set);
      }
    }
    expect(OP_CARDS.map(o => o.id)).toEqual(['countUp', 'countDown', 'startTimer', 'toggle', 'setOn', 'setOff', 'setTo', 'place', 'smell', 'sum', 'decay', 'reset', 'expr']);
  });

  it('counts, toggles, remembers, adds up and decays on the walker (the generated GLSL run on the CPU)', () => {
    let set = withMem({ channels: ['food', '', '', ''] });
    set = addMemory(set, 'counter', 'count')!.set;
    set = addMemory(set, 'flag', 'lit')!.set;
    set = addMemory(set, 'position', 'home')!.set;
    const rules = set.species[0].rules = [];
    const add = (a: RuleAction, when: RuleCondition[] = [{ kind: 'always' }]) => rules.push({ when, do: [a] } as never);
    add({ kind: 'mem', memory: 'm1', op: 'add', value: 1 });
    add({ kind: 'mem', memory: 'm2', op: 'toggle' });
    add({ kind: 'mem', memory: 'm3', op: 'place' }, [{ kind: 'age', cmp: '<', seconds: 0.03 }]);
    const w = run(set, 3, { pos: [0.3, -0.2] });
    expect(w.mem2![0]).toBeCloseTo(3);
    expect(w.mem2![1]).toBe(1); // off → on → off → on
    expect(w.mem2![2]).toBeCloseTo(0.3, 1);
    expect(w.mem2![3]).toBeCloseTo(-0.2, 1);
    // Add up what it smells (food here 0.6): a second's worth a second.
    const sum = addMemory(withMem({ channels: ['food', '', '', ''] }), 'value', 'got')!.set;
    sum.species[0].rules = [{ when: [{ kind: 'always' }], do: [{ kind: 'mem', memory: 'm1', op: 'sum', channel: 0, value: 1 }] }];
    expect(sensedChannels(sum)).toEqual(['0']);
    expect(run(sum, 60, {}, () => [0.6, 0, 0, 0]).mem2![0]).toBeCloseTo(0.6, 1);
    // Decay: e^(−0.5) after a second.
    const dec = addMemory(withMem(), 'value', 'v')!.set;
    dec.memories![0].start = 1;
    dec.species[0].rules = [{ when: [{ kind: 'always' }], do: [{ kind: 'mem', memory: 'm1', op: 'decay', value: 0.5 }] }];
    expect(run(dec, 61).mem2![0]).toBeCloseTo(Math.exp(-0.5), 1);
  });

  it('a timer counts by itself and a level fades by itself', () => {
    let set = addMemory(withMem(), 'timer')!.set;
    set = addMemory(set, 'level', 'energy')!.set;
    set.species[0].rules = [];
    const w = run(set, 61);
    expect(w.mem2![0]).toBeCloseTo(61 / 60, 2);
    expect(w.mem2![1]).toBeCloseTo(Math.exp(-0.3 * 60 / 60), 1); // starts full (1), fades 0.3 a second
  });
});

describe('expressions', () => {
  const set = (() => { let s = withMem({ channels: ['food', '', '', ''] }); s = addMemory(s, 'value', 'food')!.set; s = addMemory(s, 'position', 'home')!.set; return s; })();
  it('names come from its senses, memories, age, speed, random', () => {
    const names = exprNames(set).map(n => n.name);
    for (const k of ['here.own', 'here.food', 'here.trail2', 'food', 'home', 'age', 'speed', 'random', 'dt']) expect(names).toContain(k);
  });
  it('parse and typecheck, with plain errors', () => {
    expect(checkMemoryExpr(set, 'm1', 'food * 0.98 + here.food').ok).toBe(true);
    expect(checkMemoryExpr(set, 'm1', 'food + 1').ok).toBe(true); // whole numbers are floats here
    expect(checkMemoryExpr(set, 'm1', 'food * ').error).toBeTruthy();
    expect(checkMemoryExpr(set, 'm1', 'fuel * 2.0').error).toMatch(/fuel isn't known/);
    expect(checkMemoryExpr(set, 'm1', 'here.water').error).toMatch(/isn't a trail/);
    expect(checkMemoryExpr(set, 'm1', 'home').error).toMatch(/vec2/);
    expect(checkMemoryExpr(set, 'm2', 'mix(home, pos, 0.1)').ok).toBe(true);
    expect(checkMemoryExpr(set, 'm1', 'step(vec3(1.0), food)').ok).toBe(false);
  });
  it('compile into the rule\'s Expression Block and run', () => {
    const s: AgentRuleSet = { ...set, species: [{ ...set.species[0], rules: [{ when: [{ kind: 'always' }], do: [{ kind: 'mem', memory: 'm1', op: 'expr', expr: 'food * 0.5 + here.food' }] }] }] };
    const block = generateRulesInside(s, { groupId: GID, d3: false }).find(x => x.id === ruleIds(GID).rule(0, 0))!;
    expect(JSON.stringify(block.params.lines)).toContain('mem2.x * 0.5 + here1');
    compiles(s);
    compiles(s, '3d');
    const w = run(s, 2, {}, () => [0.4, 0, 0, 0]);
    expect(w.mem2![0]).toBeCloseTo(0.4 * 0.5 + 0.4, 2);
  });
  it('renaming a memory renames it in its expressions', () => {
    const s: AgentRuleSet = { ...set, species: [{ ...set.species[0], rules: [{ when: [{ kind: 'always' }], do: [{ kind: 'mem', memory: 'm1', op: 'expr', expr: 'food * 0.5 + here.food' }] }] }] };
    const r = renameMemory(s, 'm1', 'fuel');
    expect((r.species[0].rules[0].do[0] as { expr: string }).expr).toBe('fuel * 0.5 + here.food');
    expect(checkMemoryExpr(r, 'm1', 'fuel * 0.5 + here.food').ok).toBe(true);
  });
});

describe('memory everywhere', () => {
  it('in "only when": on / off, a timer after N s, a level above, a place within', () => {
    let set = addMemory(withMem(), 'flag', 'lit')!.set;
    set = addMemory(set, 'timer', 'clock')!.set;
    expect(memWhenText(set, newMemCondition(set.memories![0]))).toBe('lit is on');
    expect(memWhenText(set, newMemCondition(set.memories![1]))).toBe('2 s after clock started');
    // After 0.5 s of the clock, switch lit on.
    set.species[0].rules = [{ when: [{ kind: 'mem', memory: 'm2', cmp: '>', value: 0.5 }], do: [{ kind: 'mem', memory: 'm1', op: 'set', value: 1 }] }];
    expect(run(set, 20).mem2![0]).toBe(0);
    expect(run(set, 40).mem2![0]).toBe(1);
    compiles(set);
  });
  it('a card keeps its only when and its memory condition apart', () => {
    let set = addMemory(withMem(), 'flag', 'lit')!.set;
    const c = newMemCondition(set.memories![0]);
    set = setMemWhen(set, 0, { rule: 0, action: 1 }, c);
    set = setOnlyWhen(set, 0, { rule: 1, action: 0 }, { kind: 'age', cmp: '>', seconds: 2 });
    const r = set.species[0].rules[1];
    expect(r.when).toEqual([{ kind: 'age', cmp: '>', seconds: 2 }, c]);
    const cards = readCards(set, 0);
    expect(cards.when.wobble).toEqual({ kind: 'age', cmp: '>', seconds: 2 });
    expect(cards.memWhen.wobble).toEqual(c);
    expect(cards.advanced).toEqual([]);
  });
  it('slider × memory: speed × energy moves it by its energy; the speed it keeps is unchanged', () => {
    const set = energySet();
    set.memories![0].fade = 0;
    set.memories![0].start = 0.5;
    set.species[0].speedTimes = { memory: 'm1' };
    set.species[0].rules = [];
    const w = run(set, 61, { pos: [0, 0], heading: 0 });
    expect(w.pos[0]).toBeCloseTo(0.25 * 0.5 * 61 / 60, 2);
    expect(w.speed).toBeCloseTo(0.25, 3);
    compiles(set);
    // An action's number × a memory: wander, trail amount (× fading with a timer).
    const t = addMemory(energySet(), 'timer')!.set;
    t.species[0].rules = [{ when: [{ kind: 'always' }], do: [{ kind: 'trail', channel: 'own', amount: 2, times: { memory: 'm2', fade: 0.15 } }, { kind: 'wander', degrees: 10, times: { memory: 'm1' } }] }];
    const lines = JSON.stringify(generateRulesInside(t, { groupId: GID, d3: false }).find(x => x.id === ruleIds(GID).rule(0, 0))!.params.lines);
    expect(lines).toContain('(2.0 * exp(-0.15 * mem2.y))');
    expect(lines).toContain('radians((10.0 * mem2.x))');
    expect(describeRule(t, 0, t.species[0].rules[0])).toContain('× fading with away');
    compiles(t);
  });
  it('Look\'s colour by a memory: the heat map in Finish', () => {
    const set = { ...energySet(), colourBy: { memory: 'm1', lo: 0, hi: 2 } };
    const fin = generateRulesInside(set, { groupId: GID, d3: false }).find(x => x.id === ruleIds(GID).finish)!;
    expect(JSON.stringify(fin.params.lines)).toContain('(mem2.x - 0.0) / 2.0');
    expect(String(fin.params.result)).toContain('heat * 3.0');
    compiles(set);
  });
  it('taking a memory away takes its cards, conditions and multipliers with it', () => {
    let set = addMemory(energySet(), 'flag', 'lit')!.set;
    set.species[0].speedTimes = { memory: 'm1' };
    set.colourBy = { memory: 'm1', lo: 0, hi: 1 };
    set = addOpCard(set, 0, 'decay', 'm1')!.set;
    set.species[0].rules[0] = { ...set.species[0].rules[0], when: [{ kind: 'mem', memory: 'm1', cmp: '>', value: 0.2 }] };
    const r = removeMemory(set, 'm1');
    expect(r.memories!.map(m => m.name)).toEqual(['lit']);
    expect(r.species[0].speedTimes).toBeUndefined();
    expect(r.colourBy).toBeUndefined();
    expect(JSON.stringify(r.species[0].rules)).not.toContain('"m1"');
    expect(r.species[0].rules[0].when).toEqual([{ kind: 'always' }]);
  });
});

describe('the ants, rebuilt with named memories', () => {
  it('are cards: no Advanced rules, and the builder\'s Ants preset is this', () => {
    const set = antsWithMemories();
    expect(trailPreset('ants')!.set()).toEqual(set);
    const cards = readCards(set, 0);
    expect(cards.advanced).toEqual([]);
    expect(cards.senses.channel).toBe(1);
    expect(cards.memWhen.senses).toEqual({ kind: 'mem', memory: 'm1', cmp: '<', value: 0.5 });
    expect(cards.extras.map(c => c.card)).toEqual(['senses', 'goal', 'trail', 'turnRound', 'turnRound']);
    const b = readBehaviours(set, 0, kindCards('ants'));
    expect(b.cards.filter(c => c.card === 'memory')).toHaveLength(4);
    expect(b.advanced).toEqual([]);
  });
  it('compile in the ants\' own setup, with More memory', () => {
    const nodes = rulesTemplateNodes('ants', 'an');
    const gi = nodes.findIndex(x => x.type === 'agentsGroup');
    nodes[gi] = applyRulesToGroup(nodes[gi], antsWithMemories());
    const r = compileGraph({ nodes });
    expect(r.errors).toBeUndefined();
    expect(r.agents!.groups[0].stateE).toBe(true);
  });
  it('carry food home: pick up at the food (carrying on, away restarted), drop at the nest', () => {
    const set = antsWithMemories();
    const p = programOf(generateRulesInside(set, { groupId: GID, d3: false }));
    const at = (food: number, nest: number, mem2: number[]) => simulate(p, [{ ...walkersFor(1)[0], pos: [0, 0], heading: 0, speed: 0.3, mem2, age: 1 }], 1, { masks: () => [food, nest] })[0];
    const picked = at(1, 0, [0, 5, 0, 0]);
    expect(picked.mem2![0]).toBe(1);
    expect(picked.mem2![1]).toBeLessThan(0.05);
    expect(Math.abs(Math.cos(picked.heading as number) + 1)).toBeLessThan(0.3); // turned round
    const dropped = at(0, 1, [1, 5, 0, 0]);
    expect(dropped.mem2![0]).toBe(0);
    const walking = at(0, 0, [1, 5, 0, 0]);
    expect(walking.mem2![0]).toBe(1);
    expect(walking.mem2![1]).toBeCloseTo(5 + 1 / 60, 3);
  });
  it('old ants sets open as they were (states and the Memory number, Advanced rules)', () => {
    const old = RULES_TEMPLATES.find(t => t.key === 'ants')!.set();
    expect(old.memories).toBeUndefined();
    expect(readCards(old, 0).advanced.length).toBeGreaterThan(0);
  });
});

describe('Under the hood and the lens', () => {
  it('shows E\'s channels with the memories\' names, sampled from source 5', () => {
    const ctx = { d3: false, stateC: true, stateE: true, memoryNames: ['carrying', 'away', '', ''], aspect: 1.6, speedMax: 1, lifeMax: 0, species: [{ name: 'Ants', colour: [1, 1, 1] as [number, number, number] }], trailColours: [] };
    const tex = hoodTextures(ctx);
    const e = tex.find(t => t.id === 'E')!;
    expect(e.channels.map(c => c.label)).toEqual(['carrying', 'away', 'more memory z', 'more memory w']);
    expect(hoodTileSpecs(tex, []).filter(s => s.source === 5)).toHaveLength(4);
    expect(hoodTextures({ ...ctx, stateE: false }).some(t => t.id === 'E')).toBe(false);
  });
  it('the lens reads a slot and the range decodes the live walkers only', () => {
    expect(parseMemSlot('E:2')).toEqual({ src: 1, comp: 2 });
    expect(parseMemSlot('')).toBeNull();
    const N = MEM_RANGE_N;
    const px = new Float32Array(N * N * 2 * 4);
    const put = (i: number, alive: number, e: number[]) => { px.set(e, i * 4); px.set([alive, 0, 0, 0], (N * N + i) * 4); };
    put(0, 1, [0.2, 3, 0, 0]); put(1, 1, [0.8, 1, 0, 0]); put(2, 0, [99, 99, 99, 99]);
    const r = decodeMemRanges(px)!;
    expect(r[2]).toEqual([expect.closeTo(0.2), expect.closeTo(0.8)]);
    expect(r[3]).toEqual([1, 3]);
    expect(decodeMemRanges(new Float32Array(N * N * 8))).toBeNull();
  });
});
