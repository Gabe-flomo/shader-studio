/**
 * Agent Rules (docs/agent-rules.md): rule sets → the inside of an Agents group → per-agent GLSL.
 * The generated code is run on the CPU through glslEval (cpuSim.ts), so these tests check the
 * GLSL the GPU runs: each condition and action, state transitions, the frame-rate independence
 * of a chance a second, determinism, Open as nodes (the same state after N steps, the same
 * shader), the templates and examples compiling in 2D and 3D, and spawn's Births Emit.
 */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});

import { compileGraph } from '../../compiler/graphCompiler';
import { getNodeDefinition, resolveNodeAliases } from '../../nodes/definitions';
import { n } from '../../store/graphBuilder';
import type { GraphNode } from '../../types/nodeGraph';
import { EXAMPLE_GRAPHS } from '../../store/exampleGraphs';
import { EXAMPLE_FOLDERS, EXAMPLE_INDEX } from '../../store/exampleIndex';
import { AGENT_RULE_EXAMPLE_KEYS } from '../../store/agentRuleExamples';
import { applyRulesToGroup, backToRules, ensureBirthEmit, isRulesGroup, openRulesAsNodes, rulesNeedRegenerating } from '../apply';
import { generateRulesInside, ruleIds } from '../generate';
import { rulesStarter } from '../starter';
import { RULES_TEMPLATES, rulesTemplateNodes } from '../templates';
import {
  type AgentRule, type AgentRuleSet, type RuleAction, type RuleCondition,
  chancePerStep, defaultRuleSet, describeRule, normalizeRuleSet, rulePorts,
} from '../spec';
import { insideOf, programOf, simulate, stepWalkers, walkersFor, type SimOptions, type Walker } from './cpuSim';

const GID = 'g';
const setOf = (rules: AgentRule[], o: Partial<AgentRuleSet> = {}, speed = 0.2): AgentRuleSet => ({
  ...defaultRuleSet(), ...o,
  species: o.species ?? [{ name: 'A', speed, states: [{ name: 's0', colour: [1, 0, 0] }, { name: 's1', colour: [0, 1, 0] }, { name: 's2', colour: [0, 0, 1] }], rules }],
});
const prog = (set: AgentRuleSet, d3 = false) => programOf(generateRulesInside(set, { groupId: GID, d3 }));
const one = (set: AgentRuleSet, w: Partial<Walker> = {}, o: SimOptions = {}, steps = 1) => simulate(prog(set, o.d3), [{ ...walkersFor(1, { d3: o.d3 })[0], pos: o.d3 ? [0, 0, 0] : [0, 0], heading: o.d3 ? [1, 0, 0] : 0, speed: 0.2, ...w }], steps, o)[0];
const ruleLines = (set: AgentRuleSet, sp = 0, ri = 0) => {
  const b = generateRulesInside(set, { groupId: GID, d3: false }).find(x => x.id === ruleIds(GID).rule(sp, ri))!;
  return ((b.params.lines ?? []) as Array<{ lhs: string; op: string; rhs: string }>).map(l => `${l.lhs} ${l.op} ${l.rhs}`).join('\n');
};
const when = (c: RuleCondition, ...more: RuleCondition[]): AgentRule => ({ when: [c, ...more], do: [{ kind: 'state', state: 1 }] });
const doing = (...a: RuleAction[]): AgentRule => ({ when: [{ kind: 'always' }], do: a });
const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const groupWith = (set: AgentRuleSet, space: '2d' | '3d' = '2d') => applyRulesToGroup(n('agentsGroup', GID, 0, 0, { space, subgraph: { nodes: [], inputPorts: [], outputPorts: [] } }), set);

describe('the generated inside', () => {
  it('is ordinary nodes: Agent Inputs, Start, a block per rule, Finish, Move, Agent Output, each with a note', () => {
    const set = setOf([doing({ kind: 'wander', degrees: 10 }), doing({ kind: 'trail', channel: 'own', amount: 1 })]);
    const inside = generateRulesInside(set, { groupId: GID, d3: false });
    expect(inside.map(x => x.type)).toEqual(['agentInputs', 'exprNode', 'exprNode', 'exprNode', 'exprNode', 'agentMove', 'agentOutput']);
    for (const x of inside) {
      expect(getNodeDefinition(x.type), x.type).toBeTruthy();
      expect(String(x.params.__comment ?? '').length, x.id).toBeGreaterThan(20);
      if (x.type !== 'exprNode') continue;
      const note = String(x.params.__comment);
      for (const l of (x.params.lines ?? []) as Array<{ lhs: string }>) {
        const name = l.lhs.trim().split(/\s+/).pop()!;
        expect(note, `${x.id}: ${name}`).toMatch(new RegExp(`(^|\\W)${name.replace('.', '\\.')}:`, 'm'));
      }
    }
    // Deterministic: the same set and group id give the same nodes.
    expect(JSON.stringify(generateRulesInside(set, { groupId: GID, d3: false }))).toBe(JSON.stringify(inside));
  });

  it('adds a Sense (and its channel weights) per trail channel the rules read, and ports for the trail and masks', () => {
    const set = setOf([when({ kind: 'sense', channel: 1, where: 'ahead', cmp: '>', value: 0.3 }), doing({ kind: 'turn', toward: 'trail', channel: 'own', degrees: 20 })], { masks: [{ name: 'Food', kind: 'number' }, { name: 'Pic', kind: 'texture' }] });
    const inside = generateRulesInside(set, { groupId: GID, d3: false });
    expect(inside.filter(x => x.type === 'agentSense').map(x => x.id)).toEqual([`${GID}_ru_sense_own`, `${GID}_ru_sense_1`]);
    expect(inside.filter(x => x.type === 'sampleTexture').length).toBe(1);
    expect(rulePorts(set)).toEqual([{ key: 'trail', type: 'texture', label: 'Trail' }, { key: 'mask1', type: 'float', label: 'Food' }, { key: 'mask2', type: 'texture', label: 'Pic' }]);
    const g = groupWith(set);
    expect(Object.keys(g.inputs)).toEqual(['emit', 'trail', 'mask1', 'mask2']);
    expect(g.params.species).toBe('1');
    expect(isRulesGroup(g)).toBe(true);
  });
});

describe('conditions', () => {
  const trailAt = (left: number, ahead: number, right: number, here = 0) => (uv: number[]) => {
    // The walker stands at the middle facing right: sensors ahead of it are to the right of 0.5.
    const x = uv[0] - 0.5, y = uv[1] - 0.5;
    if (Math.hypot(x, y) < 1e-4) return [here, here, here, here];
    const v = y > 1e-4 ? left : y < -1e-4 ? right : ahead;
    return [v, v, v, v];
  };
  const cases: Array<[string, RuleCondition, string, Partial<Walker>, SimOptions, number]> = [
    ['always', { kind: 'always' }, 'float go = 1.0', {}, {}, 1],
    ['trail ahead >', { kind: 'sense', channel: 0, where: 'ahead', cmp: '>', value: 0.3 }, 'float(smell1.y > 0.3)', {}, { trail: trailAt(0, 0.5, 0) }, 1],
    ['trail ahead > (not met)', { kind: 'sense', channel: 0, where: 'ahead', cmp: '>', value: 0.3 }, 'float(smell1.y > 0.3)', {}, { trail: trailAt(0, 0.2, 0) }, 0],
    ['trail left <', { kind: 'sense', channel: 0, where: 'left', cmp: '<', value: 0.3 }, 'float(smell1.x < 0.3)', {}, { trail: trailAt(0.1, 1, 1) }, 1],
    ['trail right >', { kind: 'sense', channel: 2, where: 'right', cmp: '>', value: 0.3 }, 'float(smell3.z > 0.3)', {}, { trail: trailAt(0, 0, 0.9) }, 1],
    ['trail anywhere', { kind: 'sense', channel: 'own', where: 'any', cmp: '>', value: 0.3 }, 'float(max(smellOwn.x, max(smellOwn.y, smellOwn.z)) > 0.3)', {}, { trail: trailAt(0, 0, 0.9) }, 1],
    ['trail here', { kind: 'sense', channel: 0, where: 'here', cmp: '>', value: 0.3 }, 'float(here1 > 0.3)', {}, { trail: trailAt(0, 0, 0, 0.8) }, 1],
    ['near another species', { kind: 'near', species: 1, value: 0.2 }, 'float(max(max(smell2.x, smell2.y), max(smell2.z, here2)) > 0.2)', {}, { trail: trailAt(0, 0, 0, 0.5) }, 1],
    ['age >', { kind: 'age', cmp: '>', seconds: 1 }, 'float(age > 1.0)', { age: 2 }, {}, 1],
    ['age > (young)', { kind: 'age', cmp: '>', seconds: 1 }, 'float(age > 1.0)', { age: 0.5 }, {}, 0],
    ['in state', { kind: 'state', state: 2 }, 'float(floor(mem.x + 0.01) == 2.0)', { mem: [2, 0] }, {}, 1],
    ['in state (stuck counts)', { kind: 'state', state: 2 }, 'float(floor(mem.x + 0.01) == 2.0)', { mem: [2.5, 0] }, {}, 1],
    ['not in state', { kind: 'state', state: 2, not: true }, 'float(floor(mem.x + 0.01) != 2.0)', { mem: [2, 0] }, {}, 0],
    ['Memory number >', { kind: 'memory', cmp: '>', value: 1.5 }, 'float(mem.y > 1.5)', { mem: [0, 2] }, {}, 1],
    ['Memory number =', { kind: 'memory', cmp: '=', value: 3 }, 'float(abs(mem.y - 3.0) < 0.001)', { mem: [0, 3] }, {}, 1],
    ['inside a mask', { kind: 'mask', mask: 0, cmp: '>', value: 0.5 }, 'float(mask1 > 0.5)', {}, { masks: () => [1, 0] }, 1],
    ['outside a mask', { kind: 'mask', mask: 0, cmp: '>', value: 0.5 }, 'float(mask1 > 0.5)', {}, { masks: () => [0, 0] }, 0],
    ['chance 100% a second', { kind: 'chance', perSecond: 1 }, 'float odds1 = 1.0 - pow(1.0 - 1.0, a_dt)', {}, {}, 1],
    ['chance 0%', { kind: 'chance', perSecond: 0 }, 'float(dice1 < odds1)', {}, {}, 0],
  ];
  for (const [name, c, glsl, w, o, expected] of cases) {
    it(`${name}: ${glsl}`, () => {
      const set = setOf([when(c)], { masks: [{ name: 'M', kind: 'number' }] });
      expect(ruleLines(set)).toContain(glsl);
      const after = one(set, w, o);
      // The rule's action (become state 1) shows whether its When held.
      expect(Math.floor(after.mem[0] + 0.01), name).toBe(expected ? 1 : Math.floor((w.mem?.[0] ?? 0) + 0.01));
    });
  }

  it('a texture mask is read through Sample (texture) as brightness', () => {
    const set = setOf([when({ kind: 'mask', mask: 0, cmp: '>', value: 0.5 })], { masks: [{ name: 'Pic', kind: 'texture' }] });
    expect(ruleLines(set)).toContain('float(dot(mask1, vec3(0.299, 0.587, 0.114)) > 0.5)');
  });

  it('conditions are joined with and; a species gate and "stop after this rule" gate the rules below', () => {
    const set = setOf([
      { when: [{ kind: 'age', cmp: '>', seconds: 1 }], do: [{ kind: 'state', state: 1 }], stop: true },
      { when: [{ kind: 'always' }], do: [{ kind: 'state', state: 2 }] },
    ]);
    expect(ruleLines(set, 0, 1)).toContain('float go = (1.0 - done)');
    expect(Math.floor(one(set, { age: 2 }).mem[0])).toBe(1); // the first applied and stopped: the second skipped
    expect(Math.floor(one(set, { age: 0 }).mem[0])).toBe(2); // the first didn't apply: the second ran
    const two: AgentRuleSet = { ...setOf([]), species: [
      { name: 'A', speed: 0.2, states: [{ name: 'a', colour: [1, 0, 0] }, { name: 'b', colour: [0, 1, 0] }], rules: [doing({ kind: 'state', state: 1 })] },
      { name: 'B', speed: 0.3, states: [{ name: 'c', colour: [0, 0, 1] }], rules: [doing({ kind: 'speed', mode: 'set', value: 0.9 })] },
    ] };
    expect(ruleLines(two, 0, 0)).toContain('float go = float(sp == 0.0)');
    expect(ruleLines(two, 1, 0)).toContain('float go = float(sp == 1.0)');
    const [a, b] = simulate(prog(two), walkersFor(2, { species: 2 }), 1);
    expect([Math.floor(a.mem[0]), a.speed]).toEqual([1, 0.2]);
    expect(Math.floor(b.mem[0])).toBe(0);
    expect(b.speed).toBeCloseTo(0.9, 6);
    expect(b.colour).toEqual([0, 0, 1]);
  });
});

describe('actions', () => {
  it('turn toward / away from the trail (the slime-mold rule)', () => {
    const left = (uv: number[]) => { const v = uv[1] > 0.5 + 1e-4 ? 1 : 0; return [v, 0, 0, 0]; };
    const set = setOf([doing({ kind: 'turn', toward: 'trail', channel: 0, degrees: 30 })]);
    expect(ruleLines(set)).toContain('h += go * radians(30.0) * turn1');
    expect(one(set, {}, { trail: left }).heading as number).toBeCloseTo(Math.PI / 6, 5);
    const away = setOf([doing({ kind: 'turn', toward: 'trail', channel: 0, away: true, degrees: 30 })]);
    expect(one(away, {}, { trail: left }).heading as number).toBeCloseTo(-Math.PI / 6, 5);
    // Strongest ahead: straight on.
    const ahead = (uv: number[]) => [Math.abs(uv[1] - 0.5) < 1e-4 && uv[0] > 0.5 ? 1 : 0, 0, 0, 0];
    expect(one(set, {}, { trail: ahead }).heading as number).toBeCloseTo(0, 6);
  });

  it('turn toward a point, the centre, the mouse (at most its degrees a step), away from them', () => {
    const point = setOf([doing({ kind: 'turn', toward: 'point', x: 0, y: 1, degrees: 10 })]);
    expect(one(point, { pos: [0, 0] }).heading as number).toBeCloseTo(Math.PI / 18, 5); // 90° away: 10° this step
    const near = setOf([doing({ kind: 'turn', toward: 'point', x: 1, y: 0.01, degrees: 10 })]);
    expect(one(near, { pos: [0, 0] }).heading as number).toBeCloseTo(Math.atan2(0.01, 1), 5); // less than 10°: all the way
    const centre = setOf([doing({ kind: 'turn', toward: 'centre', degrees: 180 })]);
    expect(wrapAngle(one(centre, { pos: [0.5, 0.5], heading: 0 }).heading as number)).toBeCloseTo(-3 * Math.PI / 4, 5);
    const away = setOf([doing({ kind: 'turn', toward: 'centre', away: true, degrees: 180 })]);
    expect(wrapAngle(one(away, { pos: [0.5, 0.5], heading: 0 }).heading as number)).toBeCloseTo(Math.PI / 4, 5);
    // The mouse at the picture's top-left corner (pixels; y up as gl's).
    const mouse = setOf([doing({ kind: 'turn', toward: 'mouse', degrees: 180 })]);
    const h = one(mouse, { pos: [0, 0] }, { mouse: [0, 720] }).heading as number;
    expect(h).toBeCloseTo(Math.atan2(1, -16 / 9), 4);
  });

  it('wander turns at random within its degrees, the same for the same step and seed', () => {
    const set = setOf([doing({ kind: 'wander', degrees: 20 })]);
    const ws = simulate(prog(set), walkersFor(200), 1);
    const turns = ws.map((w, i) => (w.heading as number) - (walkersFor(200)[i].heading as number));
    expect(Math.max(...turns.map(Math.abs))).toBeLessThanOrEqual(20 * Math.PI / 180 + 1e-9);
    expect(Math.max(...turns)).toBeGreaterThan(0.25);
    expect(Math.min(...turns)).toBeLessThan(-0.25);
  });

  it('set speed / accelerate; stop; stick (for good); bounce; die', () => {
    expect(one(setOf([doing({ kind: 'speed', mode: 'set', value: 0.7 })])).speed).toBeCloseTo(0.7, 6);
    expect(one(setOf([doing({ kind: 'speed', mode: 'add', value: 6 })]), { speed: 0.2, age: 1 }).speed).toBeCloseTo(0.3, 6);
    expect(one(setOf([doing({ kind: 'stop' })])).speed).toBe(0);
    // Stick: Memory x gains a half; speed stays 0 even when a later rule sets it.
    const stick = setOf([{ when: [{ kind: 'age', cmp: '<', seconds: 0.02 }], do: [{ kind: 'stick' }] }, doing({ kind: 'speed', mode: 'set', value: 0.5 })]);
    const stuck = one(stick, { age: 0 }, {}, 10);
    expect(stuck.mem[0]).toBeCloseTo(0.5, 6);
    expect(stuck.speed).toBe(0);
    expect(stuck.pos).toEqual([0, 0]);
    const b = one(setOf([doing({ kind: 'bounce' })]), { heading: 0.3 });
    expect(b.heading as number).toBeCloseTo(0.3 + Math.PI, 5);
    expect(one(setOf([doing({ kind: 'die' })])).alive).toBe(0);
    expect(one(setOf([doing({ kind: 'wander', degrees: 1 })])).alive).toBe(1);
  });

  it('leave trail (own channel, a channel, fading with Memory) and spawn (a birth mark in channel 4)', () => {
    expect(one(setOf([doing({ kind: 'trail', channel: 'own', amount: 2 })])).dep).toEqual([2, 0, 0, 0]);
    expect(one(setOf([doing({ kind: 'trail', channel: 2, amount: 0.5 })])).dep).toEqual([0, 0, 0.5, 0]);
    const fade = one(setOf([doing({ kind: 'trail', channel: 1, amount: 1, fade: 0.5 })]), { mem: [0, 2] }).dep;
    expect(fade[1]).toBeCloseTo(Math.exp(-1), 6);
    expect(one(setOf([doing({ kind: 'spawn', amount: 3 })])).dep).toEqual([0, 0, 0, 3]);
    // Two species: the own channel is the walker's species'.
    const two: AgentRuleSet = { ...setOf([]), species: [0, 1].map(i => ({ name: `S${i}`, speed: 0.2, states: [{ name: 'x', colour: [1, 1, 1] as [number, number, number] }], rules: [doing({ kind: 'trail', channel: 'own', amount: 1 })] })) };
    expect(simulate(prog(two), walkersFor(2, { species: 2 }), 1).map(w => w.dep)).toEqual([[1, 0, 0, 0], [0, 1, 0, 0]]);
  });

  it('change state and the Memory number (set, add, count a second, random)', () => {
    expect(one(setOf([doing({ kind: 'state', state: 2 })])).mem).toEqual([2, 0]);
    expect(one(setOf([doing({ kind: 'state', state: 1 })]), { mem: [0.5, 0] }).mem[0]).toBeCloseTo(1.5, 6); // stuck stays stuck
    expect(one(setOf([doing({ kind: 'memory', mode: 'set', value: 4 })])).mem[1]).toBe(4);
    expect(one(setOf([doing({ kind: 'memory', mode: 'add', value: 0.25 })]), { mem: [0, 1] }).mem[1]).toBeCloseTo(1.25, 6);
    expect(one(setOf([doing({ kind: 'memory', mode: 'perSecond', value: 1 })]), {}, {}, 60).mem[1]).toBeCloseTo(1, 5);
    const r = simulate(prog(setOf([doing({ kind: 'memory', mode: 'random', value: 10 })])), walkersFor(300), 1).map(w => w.mem[1]);
    expect(Math.min(...r)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...r)).toBeLessThan(10);
    expect(Math.max(...r) - Math.min(...r)).toBeGreaterThan(8);
  });

  it('follow / go against a flow field (Curl noise, read as a direction)', () => {
    const set = setOf([doing({ kind: 'flow', degrees: 180 })]);
    expect(generateRulesInside(set, { groupId: GID, d3: false }).some(x => x.type === 'agentCurl')).toBe(true);
    expect(one(set, { heading: 0 }, { flow: () => [0, 1] }).heading as number).toBeCloseTo(Math.PI / 2, 5);
    const against = setOf([doing({ kind: 'flow', degrees: 180, away: true })]);
    expect(one(against, { heading: 0 }, { flow: () => [0, 1] }).heading as number).toBeCloseTo(-Math.PI / 2, 5);
  });

  it('align with the crowd turns toward a velocity trail\'s flow where it stands', () => {
    const set = setOf([doing({ kind: 'align', degrees: 30 })]);
    expect(ruleLines(set)).toContain('vec2 to1 = crowd.xy');
    const flowUp = () => [0, 3, 2, 0];
    expect(one(set, { heading: 0 }, { trail: flowUp }).heading as number).toBeCloseTo(Math.PI / 6, 5);
    expect(one(setOf([doing({ kind: 'align', degrees: 180 })]), { heading: 0 }, { trail: flowUp }).heading as number).toBeCloseTo(Math.PI / 2, 5);
  });

  it('Finish colours each walker by its state, and Move takes the rules\' heading and speed', () => {
    const set = setOf([doing({ kind: 'state', state: 2 }, { kind: 'speed', mode: 'set', value: 0.6 })]);
    const w = one(set, { pos: [0, 0], heading: 0 });
    expect(w.colour).toEqual([0, 0, 1]);
    expect(w.pos[0]).toBeCloseTo(0.6 / 60, 6);
  });
});

describe('state machines', () => {
  // healthy → sick at 0.1 s; sick counts up its Memory number and leaves trail; recovered after 0.5 s of it; stays recovered.
  const sir = setOf([
    { when: [{ kind: 'state', state: 0 }, { kind: 'age', cmp: '>', seconds: 0.1 }], do: [{ kind: 'state', state: 1 }, { kind: 'memory', mode: 'set', value: 0 }], stop: true },
    { when: [{ kind: 'state', state: 1 }], do: [{ kind: 'memory', mode: 'perSecond', value: 1 }, { kind: 'trail', channel: 0, amount: 1 }] },
    { when: [{ kind: 'state', state: 1 }, { kind: 'memory', cmp: '>', value: 0.5 }], do: [{ kind: 'state', state: 2 }] },
  ]);
  it('moves through its states in order, at the right steps', () => {
    const p = prog(sir);
    let ws = walkersFor(1);
    const seen: number[] = [];
    for (let k = 0; k < 60; k++) { ws = stepWalkers(p, ws, k); seen.push(Math.floor(ws[0].mem[0] + 0.01)); }
    // Age passes 0.1 s on step 6 (age 7/60): sick from then; 0.5 s of Memory later (31 steps), recovered.
    expect(seen.indexOf(1)).toBe(6);
    expect(seen.indexOf(2)).toBe(6 + 31);
    expect(seen.slice(37).every(s => s === 2)).toBe(true);
    expect(ws[0].colour).toEqual([0, 0, 1]);
    // It left trail only while sick.
    const dep = (k: number) => stepWalkers(p, simulate(p, walkersFor(1), k), k)[0].dep[0];
    expect([dep(3), dep(20), dep(50)]).toEqual([0, 1, 0]);
  });

  it('runs the same on Open as nodes: the same shader, and the same state after N steps', () => {
    const g = groupWith(sir);
    const opened = openRulesAsNodes(g);
    expect(isRulesGroup(opened)).toBe(false);
    expect(insideOf(opened)).toBe(insideOf(g));
    const a = simulate(programOf(insideOf(g)), walkersFor(64), 120);
    const b = simulate(programOf(insideOf(opened)), walkersFor(64), 120);
    expect(b).toEqual(a);
    expect(a.some(w => Math.floor(w.mem[0]) === 2)).toBe(true);
    // And the compiled update shader is the same text, template by template.
    for (const t of RULES_TEMPLATES) {
      const nodes = rulesTemplateNodes(t.key, 'eq');
      const asNodes = nodes.map(x => (x.type === 'agentsGroup' ? openRulesAsNodes(x) : x));
      const r1 = compileGraph({ nodes }), r2 = compileGraph({ nodes: asNodes });
      expect(r1.success && r2.success, t.key).toBe(true);
      expect(r2.agents!.groups[0].fragmentShader, t.key).toBe(r1.agents!.groups[0].fragmentShader);
      // Back to rules makes the same inside again.
      expect(JSON.stringify(insideOf(backToRules(asNodes.find(x => x.type === 'agentsGroup')!)))).toBe(JSON.stringify(insideOf(nodes.find(x => x.type === 'agentsGroup')!)));
    }
  });
});

describe('random chance a second', () => {
  it('is frame-rate independent: the same share fires within a second at any step length', () => {
    for (const p of [0.1, 0.5, 0.9]) for (const dt of [1 / 30, 1 / 60, 1 / 120, 1 / 240]) {
      const steps = Math.round(1 / dt);
      expect(1 - Math.pow(1 - chancePerStep(p, dt), steps)).toBeCloseTo(p, 9);
    }
    // The generated GLSL, run: 4000 walkers for one second at 60 and at 120 steps a second.
    const set = setOf([when({ kind: 'chance', perSecond: 0.5 })]);
    const program = prog(set);
    const N = 1500;
    const share = (dt: number) => simulate(program, walkersFor(N), Math.round(1 / dt), { dt }).filter(w => Math.floor(w.mem[0]) === 1).length / N;
    const a = share(1 / 60), b = share(1 / 120);
    // 0.5 ± 3.5σ (σ = √(0.25 / N) ≈ 0.013).
    expect(Math.abs(a - 0.5)).toBeLessThan(0.045);
    expect(Math.abs(b - 0.5)).toBeLessThan(0.045);
  }, 120000);
});

describe('determinism', () => {
  it('the same seed gives the same run; another seed another', () => {
    const set = RULES_TEMPLATES.find(t => t.key === 'sir')!.set();
    const p = prog(set);
    const trail = (uv: number[]) => [Math.sin(uv[0] * 40) > 0.6 ? 1 : 0, 0, 0, 0];
    const a = simulate(p, walkersFor(100), 60, { trail });
    const b = simulate(p, walkersFor(100), 60, { trail });
    expect(b).toEqual(a);
    const c = simulate(p, walkersFor(100), 60, { trail, seed: 7 });
    expect(c).not.toEqual(a);
    // Rule sets with chance, wander and random Memory don't depend on anything but the seed and the step.
    expect(JSON.stringify(generateRulesInside(set, { groupId: 'x', d3: false }))).not.toMatch(/u_time|Math\.random/);
  }, 120000);
});

describe('3D', () => {
  it('turns a direction (a vec3) toward a point and the trail, wanders and bounces in 3D, keeping it unit length', () => {
    const point = setOf([doing({ kind: 'turn', toward: 'point', x: 0, y: 1, degrees: 10 })]);
    const w = one(point, { pos: [0, 0, 0], heading: [1, 0, 0] }, { d3: true });
    const h = w.heading as number[];
    expect(Math.hypot(...h)).toBeCloseTo(1, 6);
    expect(Math.acos(h[0])).toBeCloseTo(Math.PI / 18, 5);
    expect(h[1]).toBeGreaterThan(0);
    const b = one(setOf([doing({ kind: 'bounce' })]), { heading: [0, 0, 1] }, { d3: true });
    (b.heading as number[]).forEach((x, i) => expect(x).toBeCloseTo([0, 0, -1][i], 9));
    const wander = simulate(prog(setOf([doing({ kind: 'wander', degrees: 30 })]), true), walkersFor(50, { d3: true }), 3, { d3: true });
    for (const x of wander) expect(Math.hypot(...(x.heading as number[]))).toBeCloseTo(1, 6);
  });

  it('every template compiles in 3D; a rules group whose Space changed is generated again', () => {
    for (const t of RULES_TEMPLATES) {
      const nodes = rulesTemplateNodes(t.key, 'd3').map(x => (x.type === 'agentsGroup' ? { ...x, params: { ...x.params, space: '3d' } } : x));
      const g = nodes.find(x => x.type === 'agentsGroup')!;
      expect(rulesNeedRegenerating(g), t.key).toBe(true);
      const fixed = nodes.map(x => (x === g ? backToRules(x) : x));
      expect(rulesNeedRegenerating(fixed.find(x => x.type === 'agentsGroup')!)).toBe(false);
      const r = compileGraph({ nodes: fixed });
      expect(r.errors, t.key).toBeUndefined();
      expect(r.agents!.groups[0].fragmentShader, t.key).toContain('agTurn3');
    }
  });
});

describe('templates, examples and the starter', () => {
  it('every template is a few readable lines and compiles in 2D, with Draw\'s Colour by State as the walker\'s own colour', () => {
    expect(RULES_TEMPLATES.map(t => t.key)).toEqual(['slime', 'ants', 'boids', 'particles', 'swarm', 'crowd', 'predatorPrey', 'sir', 'termites', 'fireflies', 'dla']);
    for (const t of RULES_TEMPLATES) {
      const set = t.set();
      set.species.forEach((sp, s) => sp.rules.forEach(r => expect(describeRule(set, s, r)).toMatch(/^When .+ → .+/)));
      expect(set.species.reduce((k, sp) => k + sp.rules.length, 0), t.key).toBeLessThanOrEqual(t.key === 'termites' ? 11 : 8);
      const r = compileGraph({ nodes: rulesTemplateNodes(t.key, 'tp') });
      expect(r.errors, t.key).toBeUndefined();
      expect(r.success, t.key).toBe(true);
      const draw = r.agents!.draws[0];
      if (draw) expect(['agent', 'heading']).toContain(draw.colorBy);
    }
    expect(describeRule(RULES_TEMPLATES[1].set(), 0, RULES_TEMPLATES[1].set().species[0].rules[4])).toBe('When searching and food trail anywhere ahead > 0.05 → turn toward food trail (20°)');
  });

  it('the Agents: rules folder holds every template as an example, each compiling, with notes everywhere', () => {
    expect(EXAMPLE_FOLDERS.find(f => f.label === 'Agents: rules')?.keys).toEqual(AGENT_RULE_EXAMPLE_KEYS);
    expect(AGENT_RULE_EXAMPLE_KEYS.length).toBe(11);
    const walk = (nodes: GraphNode[], f: (x: GraphNode) => void) => { for (const x of nodes) { f(x); const sg = x.params.subgraph as { nodes?: GraphNode[] } | undefined; if (sg?.nodes) walk(sg.nodes, f); } };
    for (const k of AGENT_RULE_EXAMPLE_KEYS) {
      expect(EXAMPLE_INDEX[k]?.label, k).toMatch(/^Agent rules \d+ · /);
      const r = compileGraph({ nodes: resolveNodeAliases(EXAMPLE_GRAPHS[k].nodes, getNodeDefinition) });
      expect(r.errors, k).toBeUndefined();
      walk(EXAMPLE_GRAPHS[k].nodes, x => expect(String(x.params.__comment ?? '').length, `${k}/${x.id}`).toBeGreaterThan(20));
      expect(isRulesGroup(EXAMPLE_GRAPHS[k].nodes.find(x => x.type === 'agentsGroup'))).toBe(true);
    }
  });

  it('the starter (Add an Agents group → Rules) moves at once: wander + trail, wired to its Trail', () => {
    const s = rulesStarter(null);
    const g = s.nodes.find(x => x.id === s.groupId)!;
    expect(isRulesGroup(g)).toBe(true);
    expect(g.inputs.trail.connection?.nodeId).toBe('slTrail');
    const r = compileGraph({ nodes: [...s.nodes, n('output', 'out', 2000, 0, {}, { color: [s.out.nodeId, s.out.outputKey] })] });
    expect(r.errors).toBeUndefined();
    const w = simulate(programOf(insideOf(g)), walkersFor(8), 5);
    expect(w.every(x => x.dep[0] === 1 && x.speed > 0)).toBe(true);
  });

  it('a rules group\'s walkers lay no trail on the step they are born; node-built groups are as they were', () => {
    const r = compileGraph({ nodes: rulesTemplateNodes('dla', 'qb') });
    expect(r.agents!.groups[0].fragmentShader).toMatch(/o_c = vec4\(\w+_bs, 0\.0, 0\.0, 16777215\.0\); o_d = vec4\(0\.0\);/);
    const ants = compileGraph({ nodes: EXAMPLE_GRAPHS.agentAnts.nodes });
    expect(ants.agents!.groups[0].fragmentShader).toMatch(/o_d = agOneHot\(\w+_bs\);/);
  });

  it('spawn a child chains a Births Emit (born where the Trail\'s channel 4 has marks) and compiles', () => {
    const nodes = rulesTemplateNodes('slime', 'sp');
    const gi = nodes.findIndex(x => x.type === 'agentsGroup');
    const set = RULES_TEMPLATES[0].set();
    set.species[0].rules.push({ when: [{ kind: 'chance', perSecond: 0.05 }], do: [{ kind: 'spawn', amount: 1 }] });
    nodes[gi] = applyRulesToGroup(nodes[gi], set);
    let k = 0;
    const r = ensureBirthEmit(nodes, nodes[gi].id, () => `born${k++}`);
    expect(r.added).toBe(true);
    const g = r.nodes.find(x => x.type === 'agentsGroup')!;
    const birth = r.nodes.find(x => x.id === g.inputs.emit.connection!.nodeId)!;
    expect(birth.params.__rulesBirth).toBe(true);
    expect(birth.inputs.also.connection?.nodeId).toBe('spEmit');
    expect(ensureBirthEmit(r.nodes, g.id, () => 'x').added).toBe(false);
    const c = compileGraph({ nodes: r.nodes });
    expect(c.errors).toBeUndefined();
  });

  it('a saved rule set with missing parts is read safely', () => {
    expect(normalizeRuleSet(undefined).species.length).toBe(1);
    const odd = normalizeRuleSet({ species: [{ rules: [] }], edges: 'nope', masks: [1, 2, 3] });
    expect(odd.edges).toBe('wrap');
    expect(odd.masks.length).toBe(2);
    expect(odd.species[0].states.length).toBe(1);
  });
});
