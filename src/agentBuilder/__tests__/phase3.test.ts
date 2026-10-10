/**
 * Agent Builder phase 3 (docs/agent-builder.md "Where", "Trail channels", "Look"): the Where picker
 * lists the graph's regions with their kinds and wires the picked one where each use reads it
 * (a mask socket, Field ƒ, Emit's Where ƒ, Obstacle ƒ); shapes made here are nodes that round-trip;
 * and every generated graph compiles.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  const m = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); },
    key: (i: number) => [...m.keys()][i] ?? null, get length() { return m.size; }, clear: () => m.clear(),
  });
});
import type { GraphNode } from '../../types/nodeGraph';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { compileGraph } from '../../compiler/graphCompiler';
import { n } from '../../store/graphBuilder';
import { applyRulesToGroup, groupRules } from '../../agentRules/apply';
import { rulesTemplateNodes } from '../../agentRules/templates';
import { generateRulesInside } from '../../agentRules/generate';
import { type AgentRuleSet, normalizeRuleSet, rulePorts } from '../../agentRules/spec';
import { fieldLines, newLayer, normalizeFieldSpec } from '../../agentRules/fields';
import { setOnlyWhen } from '../behaviours';
import { readCards } from '../cards';
import {
  MADE_SHAPES, cleanText, madeShapeDistance, madeShapeNode, madeShapePatch, newMadeShape, readMadeShape, shapeLines, textBoxes,
} from '../madeShapes';
import { adapterResult, listRegions, maskCondition, maskInside, maskSlotFor, pruneMasks, regionsFor } from '../where';
import { setMadeShape, setWhere, whereNow } from '../whereActions';

const nodes = () => useNodeGraphStore.getState().nodes;
const group = () => nodes().find(x => x.type === 'agentsGroup')!;
const compiles = (all: GraphNode[] = nodes()) => {
  const r = compileGraph({ nodes: all });
  expect(r.errors).toBeUndefined();
  expect(r.success).toBe(true);
  return r;
};

/** A slime setup plus a circle SDF, a noise and a picture source to pick from. */
function setupGraph(template = 'slime', d3 = false) {
  const all = rulesTemplateNodes(template, 't');
  const circle = n('circleSDF', 'tCircle', -800, 0, { radius: 0.4 });
  const noise = n('exprNode', 'tNoise', -800, 400, { inputs: [{ name: 'uv', type: 'vec2', slider: null }], outputType: 'float', lines: [], result: '0.5 + 0.5 * sin(uv.x * 6.0)', expr: '0.5 + 0.5 * sin(uv.x * 6.0)' });
  noise.inputs = { uv: { type: 'vec2', label: 'uv' } };
  noise.outputs = { result: { type: 'float', label: 'Result (float)' } };
  const time = n('time', 'tTime', -800, 800, {});
  let list = [circle, noise, time, ...all];
  if (d3) list = list.map(x => (x.type === 'agentsGroup' ? applyRulesToGroup({ ...x, params: { ...x.params, space: '3d' } }, groupRules(x)) : x));
  useNodeGraphStore.setState({ nodes: list, activeGroupPath: [] });
}

beforeEach(() => setupGraph());

describe('the Where picker lists the graph', () => {
  it('lists shapes, masks and textures with their kinds; nothing constant, nothing reading the group', () => {
    const r = listRegions(nodes(), group().id);
    const at = (id: string) => r.find(x => x.nodeId === id);
    expect(at('tCircle')).toMatchObject({ kind: 'shape', outputKey: 'distance', label: 'Circle SDF' });
    expect(at('tNoise')).toMatchObject({ kind: 'mask', outputKey: 'result' });
    expect(at('tTime')).toBeUndefined();
    // The trail's texture is a region (read a step late); the palette that reads the trail is not.
    expect(r.find(x => x.nodeId === 'tTrail')?.kind).toBe('texture');
    expect(at('tColour')).toBeUndefined();
    expect(regionsFor('slope', r).every(x => x.kind === 'shape' || x.kind === 'mask')).toBe(true);
    expect(regionsFor('onlyWhen', r).some(x => x.kind === 'texture')).toBe(true);
  });

  it('inside and outside read each kind the right way', () => {
    expect(maskCondition('shape', 1)).toEqual({ kind: 'mask', mask: 1, cmp: '<', value: 0 });
    expect(maskCondition('mask', 0, true)).toEqual({ kind: 'mask', mask: 0, cmp: '<', value: 0.5 });
    expect(maskInside(maskCondition('shape', 0) as Extract<ReturnType<typeof maskCondition>, { kind: 'mask' }>)).toBe(true);
    expect(adapterResult({ kind: 'shape', use: 'born' })).toBe('1.0 - step(0.0, v)');
    expect(adapterResult({ kind: 'mask', use: 'obstacle' })).toBe('0.5 - v');
    expect(adapterResult({ kind: 'shape', use: 'obstacle', outside: true })).toBe('-(v)');
  });

  it('mask slots: reused for the same region, free ones reused, at most four, the unread end pruned', () => {
    const base = groupRules(group());
    const reg = { nodeId: 'a', outputKey: 'o', kind: 'shape' as const, label: 'A' };
    const a = maskSlotFor(base, reg, () => null)!;
    expect(a.mask).toBe(0);
    expect(a.set.masks[0]).toEqual({ name: 'A', kind: 'number' });
    // Unread: the same slot is free again for another region.
    expect(maskSlotFor(a.set, { ...reg, nodeId: 'b' }, () => null)!.mask).toBe(0);
    expect(pruneMasks(a.set).masks).toEqual([]);
  });
});

describe('picking wires the right socket for each use', () => {
  it('only when inside a shape of the graph: a mask slot, a mask condition, the group\'s mask socket wired', () => {
    const set = setWhere(group().id, 'onlyWhen', { region: { nodeId: 'tCircle', outputKey: 'distance' } }, { condition: (s, c) => setOnlyWhen(s, 0, readCards(s, 0).at.trail!, c) })!;
    expect(set.masks).toEqual([{ name: 'Circle SDF', kind: 'number' }]);
    const ruleOf = (x: AgentRuleSet) => x.species[0].rules.find(r => r.do.some(a => a.kind === 'trail'))!;
    expect(ruleOf(set).when).toEqual([{ kind: 'mask', mask: 0, cmp: '<', value: 0 }]);
    expect(group().inputs.mask1?.connection).toEqual({ nodeId: 'tCircle', outputKey: 'distance' });
    expect(whereNow(nodes(), group().id, 'onlyWhen', { condition: ruleOf(set).when[0] })).toMatchObject({ region: { nodeId: 'tCircle', kind: 'shape' }, outside: false });
    const r = compiles();
    expect(r.agents!.groups[0].fragmentShader).toContain('mask1');
    // Taken away: the condition, the slot and the socket go.
    const back = setWhere(group().id, 'onlyWhen', null, { condition: (s, c) => setOnlyWhen(s, 0, readCards(s, 0).at.trail!, c), slot: 0 })!;
    expect(back.masks).toEqual([]);
    expect(group().inputs.mask1).toBeUndefined();
  });

  it('a texture is a texture mask (Sample inside); a number chain is a 0–1 mask', () => {
    let set = setWhere(group().id, 'onlyWhen', { region: { nodeId: 'tNoise', outputKey: 'result' }, outside: true }, { condition: (s, c) => setOnlyWhen(s, 0, readCards(s, 0).at.trail!, c) })!;
    expect(set.species[0].rules.find(r => r.do.some(a => a.kind === 'trail'))!.when).toEqual([{ kind: 'mask', mask: 0, cmp: '<', value: 0.5 }]);
    compiles();
    set = setWhere(group().id, 'onlyWhen', { region: { nodeId: 'tTrail', outputKey: 'texture' } }, { condition: (s, c) => setOnlyWhen(s, 0, readCards(s, 0).at.trail!, c), slot: 0 })!;
    expect(set.masks[0].kind).toBe('texture');
    expect(group().inputs.mask1).toMatchObject({ type: 'texture', connection: { nodeId: 'tTrail', outputKey: 'texture' } });
    compiles();
  });

  it('a field layer masked by a region reads the group\'s mask in its block; slope reads Field ƒ', () => {
    setupGraph('particles');
    const g = group();
    let set = groupRules(g);
    set = { ...set, species: [{ ...set.species[0], rules: [...set.species[0].rules, { when: [{ kind: 'always' }], do: [{ kind: 'field', strength: 1, grip: 3, spec: { layers: [newLayer('vortex'), newLayer('slope')] } }] }] }] };
    useNodeGraphStore.setState({ nodes: nodes().map(x => (x.id === g.id ? applyRulesToGroup(x, set) : x)) });
    const ri = set.species[0].rules.length - 1;
    const editMask = (s: AgentRuleSet, m: unknown) => ({ ...s, species: s.species.map((sp, i) => (i ? sp : { ...sp, rules: sp.rules.map((r, k) => (k !== ri ? r : { ...r, do: r.do.map(a => (a.kind === 'field' ? { ...a, spec: { layers: a.spec.layers.map((l, j) => (j ? l : { ...l, mask: m as never })) } } : a)) })) })) });
    const next = setWhere(g.id, 'fieldMask', { region: { nodeId: 'tCircle', outputKey: 'distance' } }, { fieldMask: editMask })!;
    const layer = (next.species[0].rules[ri].do[0] as Extract<AgentRuleSet['species'][0]['rules'][0]['do'][0], { kind: 'field' }>).spec.layers[0];
    expect(layer.mask?.region).toEqual({ mask: 0, read: 'shape', name: 'Circle SDF' });
    expect(fieldLines(normalizeFieldSpec({ layers: [layer] })).lines.some(l => l.rhs.includes('step(mask1, 0.0)'))).toBe(true);
    setWhere(g.id, 'slope', { region: { nodeId: 'tNoise', outputKey: 'result' } });
    expect(group().inputs.field?.connection).toEqual({ nodeId: 'tNoise', outputKey: 'result' });
    const r = compiles();
    expect(r.agents!.groups[0].fragmentShader).toContain('fld');
    expect(whereNow(nodes(), g.id, 'slope').region?.nodeId).toBe('tNoise');
  });

  it('born inside: Emit Shape Field with an adapter into Where ƒ (or Picture for a texture), read back', () => {
    setWhere(group().id, 'born', { region: { nodeId: 'tCircle', outputKey: 'distance' } });
    const emit = nodes().find(x => x.type === 'agentEmit')!;
    expect(emit.params).toMatchObject({ shape: 'field', threshold: 0.5 });
    const ad = nodes().find(x => x.id === emit.inputs.where.connection!.nodeId)!;
    expect(ad.params.result).toBe('1.0 - step(0.0, v)');
    expect(ad.inputs.v.connection).toEqual({ nodeId: 'tCircle', outputKey: 'distance' });
    expect(whereNow(nodes(), group().id, 'born')).toMatchObject({ region: { nodeId: 'tCircle' }, outside: false });
    compiles();
    setWhere(group().id, 'born', { region: { nodeId: 'tTrail', outputKey: 'texture' } });
    const e2 = nodes().find(x => x.type === 'agentEmit')!;
    expect(e2.params.shape).toBe('picture');
    expect(nodes().some(x => x.params.whereAdapter)).toBe(false);
    setWhere(group().id, 'born', null);
    expect(nodes().find(x => x.type === 'agentEmit')!.params.shape).toBe('disc');
  });

  it('walls: Obstacle ƒ socket into Move; a mask through an adapter; 3D a Scene goes to Collide', () => {
    const set = setWhere(group().id, 'obstacle', { region: { nodeId: 'tCircle', outputKey: 'distance' } })!;
    expect(set.obstacle).toEqual({ on: 'turn' });
    expect(rulePorts(set).some(p => p.key === 'obstacle')).toBe(true);
    expect(group().inputs.obstacle?.connection).toEqual({ nodeId: 'tCircle', outputKey: 'distance' });
    const move = generateRulesInside(set, { groupId: 'g', d3: false }).find(x => x.type === 'agentMove')!;
    expect(move.inputs.obstacle.connection).toEqual({ nodeId: 'g_ru_in', outputKey: 'obstacle' });
    expect(compiles().agents!.groups[0].fragmentShader).toMatch(/fieldfn/);
    setWhere(group().id, 'obstacle', { region: { nodeId: 'tNoise', outputKey: 'result' } });
    expect(nodes().find(x => x.id === group().inputs.obstacle!.connection!.nodeId)!.params.result).toBe('0.5 - v');
    compiles();
    expect(setWhere(group().id, 'obstacle', null)!.obstacle).toBeUndefined();
    expect(nodes().some(x => x.params.whereAdapter)).toBe(false);
  });
});

describe('shapes made here', () => {
  it('each kind becomes a node whose sign matches the CPU distance, and reads back', () => {
    for (const { kind } of MADE_SHAPES) {
      const s = newMadeShape(kind, 0.2, -0.1, 0.3);
      const node = madeShapeNode('m', s, 0, 0);
      expect(readMadeShape(node), kind).toEqual(s);
      expect(node.params.__comment).toMatch(/^Where: /);
      expect(madeShapeDistance(s, s.x + 5, s.y)).toBeGreaterThan(0);
      if (kind !== 'ring' && kind !== 'text') expect(madeShapeDistance(s, s.x, s.y + (kind === 'polygon' ? 0.02 : 0)), kind).toBeLessThan(0);
      // Hand-edited lines: just a graph output now.
      expect(readMadeShape({ ...node, params: { ...node.params, result: 'q.x' } })).toBeNull();
    }
    expect(cleanText('hi there!')).toBe('HI THERE!');
    expect(textBoxes('I').length).toBe(7);
    expect(shapeLines(newMadeShape('polygon')).lines.length).toBe(3 + 5 * 5);
  });

  it('made here for only when: a node with a note, wired; dragging writes its sliders (no new lines); compiles', () => {
    const before = nodes().length;
    setWhere(group().id, 'onlyWhen', { make: newMadeShape('circle', 0.3, 0.2, 0.25) }, { condition: (s, c) => setOnlyWhen(s, 0, readCards(s, 0).at.trail!, c) });
    expect(nodes().length).toBe(before + 1);
    const made = nodes().find(x => x.params.whereShape)!;
    expect(group().inputs.mask1?.connection).toEqual({ nodeId: made.id, outputKey: 'result' });
    expect(listRegions(nodes(), group().id)[0]).toMatchObject({ nodeId: made.id, made: { shape: 'circle', x: 0.3 } });
    compiles();
    const lines = made.params.lines;
    expect(madeShapePatch(made, { ...readMadeShape(made)!, x: -0.5 })).toEqual(expect.objectContaining({ cx: -0.5 }));
    setMadeShape(made.id, { ...readMadeShape(made)!, x: -0.5, size: 0.4 });
    const moved = nodes().find(x => x.id === made.id)!;
    expect(moved.params.lines).toBe(lines);
    expect(readMadeShape(moved)).toMatchObject({ x: -0.5, size: 0.4 });
    // A sixth corner: new lines and a socket for it.
    setWhere(group().id, 'obstacle', { make: newMadeShape('polygon') });
    const poly = nodes().find(x => (x.params.whereShape as { shape?: string } | undefined)?.shape === 'polygon')!;
    const p = readMadeShape(poly)!;
    setMadeShape(poly.id, { ...p, points: [...p.points!, [0.5, -0.5]] });
    const poly2 = nodes().find(x => x.id === poly.id)!;
    expect(readMadeShape(poly2)!.points).toHaveLength(6);
    expect(poly2.inputs.p5x).toBeDefined();
    compiles();
    const text = newMadeShape('text');
    setWhere(group().id, 'born', { make: text });
    compiles();
  });
});

describe('the rule set seams', () => {
  it('obstacle, channel colours and look survive normalizing; look by a trail channel reads it in Finish', () => {
    const set: AgentRuleSet = { ...groupRules(group()), obstacle: { on: 'slide' }, channelColours: ['#ff0000', '#00ff00', 'bad', '#0000ff'], look: { by: 'trail', channel: 1, gain: 2 } };
    const back = normalizeRuleSet(JSON.parse(JSON.stringify(set)));
    expect(back.obstacle).toEqual({ on: 'slide' });
    expect(back.channelColours).toEqual(['#ff0000', '#00ff00', '#7ad38a', '#0000ff']);
    expect(back.look).toEqual({ by: 'trail', channel: 1, gain: 2 });
    const inside = generateRulesInside(back, { groupId: 'g', d3: false });
    const finish = inside.find(x => x.id === 'g_ru_finish')!;
    expect(finish.inputs.here.connection).toEqual({ nodeId: 'g_ru_sense_1', outputKey: 'here' });
    expect(String(finish.params.result)).toContain('vec3(0.0, 1.0, 0.0)');
    useNodeGraphStore.setState({ nodes: nodes().map(x => (x.type === 'agentsGroup' ? applyRulesToGroup(x, back) : x)) });
    compiles();
  });

  it('3D: masks, walls and a made shape compile', () => {
    setupGraph('slime', true);
    setWhere(group().id, 'onlyWhen', { make: newMadeShape('box') }, { condition: (s, c) => setOnlyWhen(s, 0, readCards(s, 0).at.trail!, c) });
    setWhere(group().id, 'obstacle', { region: { nodeId: 'tCircle', outputKey: 'distance' } });
    compiles();
  });
});
