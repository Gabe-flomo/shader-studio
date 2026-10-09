/**
 * Follow a field (agentRules/fields.ts, docs/agent-builder.md "Follow a field"): each known field's
 * direction at sample points, combining and masking layers, your own expressions (parse and
 * typecheck errors), the field ↔ nodes round trip (the Field block keeps its layers), the generated
 * shader compiles in 2D and 3D, and the GPU code (run on the CPU through cpuSim) gives the same
 * velocity as the CPU function the builder draws.
 */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});

import { compileGraph } from '../../compiler/graphCompiler';
import { n } from '../../store/graphBuilder';
import { BUILTINS } from '../../compiler/__tests__/glslEval';
import { applyRulesToGroup, groupRules } from '../apply';
import { generateRulesInside, ruleIds } from '../generate';
import { rulesTemplateNodes } from '../templates';
import { type AgentRuleSet, type RuleAction, defaultRuleSet, describeAction, rulePorts } from '../spec';
import {
  type FieldLayer, type FieldSpec, FIELD_GALLERY, FIELD_KINDS, checkOwn, fieldFromText, fieldFunction, fieldLines, fieldName, fieldToText, newLayer, normalizeFieldSpec,
} from '../fields';
import { parseAgents, printAgents } from '../../lang/dialects/agents';
import { programOf, simulate, walkersFor } from './cpuSim';
import { NOUNS, phrase } from '../../agentBuilder/legend';

// glslEval lacks these two; the GPU has them.
BUILTINS.tanh = (a => (Array.isArray(a) ? a.map(Math.tanh) : Math.tanh(a as number))) as typeof BUILTINS.tanh;
BUILTINS.smoothstep = ((e0: number, e1: number, x: number) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); }) as unknown as typeof BUILTINS.smoothstep;

const one = (l: Partial<FieldLayer> & { kind: FieldLayer['kind'] }): FieldSpec => ({ layers: [{ ...newLayer(l.kind), ...l }] });
const at = (spec: FieldSpec, x: number, y: number, t = 0) => fieldFunction(spec)(x, y, t);

describe('known fields point the right way', () => {
  it('vortex: anticlockwise round its centre, fastest at its core; clockwise when flipped', () => {
    const v = one({ kind: 'vortex', weight: 1, size: 0.3 });
    const [x, y] = at(v, 0.3, 0);
    expect(x).toBeCloseTo(0, 6); expect(y).toBeCloseTo(1, 6);
    expect(at(v, 0, 0.3)[0]).toBeCloseTo(-1, 6);
    expect(Math.hypot(...at(v, 0.9, 0).slice(0, 2))).toBeLessThan(0.7);
    expect(at(one({ kind: 'vortex', weight: 1, flip: true }), 0.3, 0)[1]).toBeCloseTo(-1, 6);
    // Off centre.
    expect(at(one({ kind: 'vortex', weight: 1, x: 0.5, y: 0.2 }), 0.8, 0.2)[1]).toBeCloseTo(1, 6);
  });
  it('source out, sink in; spiral round and in', () => {
    expect(at(one({ kind: 'source', weight: 1 }), 0.3, 0)[0]).toBeCloseTo(1, 6);
    expect(at(one({ kind: 'source', weight: 1, flip: true }), 0.3, 0)[0]).toBeCloseTo(-1, 6);
    const s = at(one({ kind: 'spiral', weight: 1 }), 0.3, 0);
    expect(s[1]).toBeGreaterThan(0.5); expect(s[0]).toBeLessThan(-0.2);
  });
  it('saddle: out along its direction, in across it; turned by Direction', () => {
    const s = one({ kind: 'saddle', weight: 1 });
    expect(at(s, 0.3, 0)[0]).toBeGreaterThan(0); expect(at(s, 0, 0.3)[1]).toBeLessThan(0);
    const r = one({ kind: 'saddle', weight: 1, angle: 90 });
    expect(at(r, 0, 0.3)[1]).toBeGreaterThan(0); expect(at(r, 0.3, 0)[0]).toBeLessThan(0);
  });
  it('dipole flows from one pole to the other through the middle; waves go along; wind is the same everywhere', () => {
    expect(at(one({ kind: 'dipole', weight: 1 }), 0, 0)[0]).toBeGreaterThan(0.5);
    expect(at(one({ kind: 'dipole', weight: 1, flip: true }), 0, 0)[0]).toBeLessThan(-0.5);
    const w = one({ kind: 'waves', weight: 1, size: 0.6 });
    expect(at(w, 0, 0)[0]).toBeGreaterThan(0); expect(at(w, 0, 0)[1]).toBeGreaterThan(1);
    expect(at(w, 0.3, 0)[1]).toBeLessThan(-1); // half a wavelength on: the other way
    const up = one({ kind: 'wind', weight: 0.5, angle: 90 });
    for (const [x, y] of [[0, 0], [1, -0.7], [-1.5, 0.9]]) { const v = at(up, x, y); expect(v[0]).toBeCloseTo(0, 6); expect(v[1]).toBeCloseTo(0.5, 6); }
  });
  it('shear: one way above its line, the other below', () => {
    const s = one({ kind: 'shear', weight: 1, size: 0.2 });
    expect(at(s, 0, 0.5)[0]).toBeGreaterThan(0.9); expect(at(s, 0, -0.5)[0]).toBeLessThan(-0.9);
    expect(at(s, 0, 0)[0]).toBeCloseTo(0, 6);
  });
  it('curl noise swirls without bunching up: no divergence, and a real flow', () => {
    const c = one({ kind: 'curl', weight: 1, size: 0.4 });
    const e = 1e-4;
    let speed = 0;
    for (const [x, y] of [[0.1, 0.2], [-0.7, 0.4], [1.2, -0.5]]) {
      const div = (at(c, x + e, y)[0] - at(c, x - e, y)[0] + at(c, x, y + e)[1] - at(c, x, y - e)[1]) / (2 * e);
      expect(Math.abs(div)).toBeLessThan(1e-4);
      speed += Math.hypot(...at(c, x, y).slice(0, 2));
    }
    expect(speed).toBeGreaterThan(0.3);
  });
  it('every gallery kind has a label and a hint, and every drawable one moves', () => {
    for (const k of FIELD_GALLERY) {
      expect(FIELD_KINDS[k].label && FIELD_KINDS[k].hint, k).toBeTruthy();
      if (k === 'slope') continue;
      const f = fieldFunction(one({ kind: k }));
      const m = [[0.2, 0.1], [-0.4, 0.3], [0.7, -0.6]].reduce((s, [x, y]) => s + Math.hypot(...f(x, y).slice(0, 2)), 0);
      expect(m, k).toBeGreaterThan(0.05);
    }
  });
});

describe('combine, turn, mask, animate', () => {
  it('layers add with their weights', () => {
    const both: FieldSpec = { layers: [{ ...newLayer('vortex'), weight: 0.6 }, { ...newLayer('curl'), weight: 0.3 }] };
    const a = at(one({ kind: 'vortex', weight: 0.6 }), 0.2, 0.1), b = at(one({ kind: 'curl', weight: 0.3 }), 0.2, 0.1), s = at(both, 0.2, 0.1);
    expect(s[0]).toBeCloseTo(a[0] + b[0], 6); expect(s[1]).toBeCloseTo(a[1] + b[1], 6);
    // A layer switched off adds nothing.
    const off = at({ layers: [both.layers[0], { ...both.layers[1], off: true }] }, 0.2, 0.1);
    expect(off[0]).toBeCloseTo(a[0], 6);
  });
  it('a mask keeps a layer inside (or outside) its shape', () => {
    const inside = one({ kind: 'wind', weight: 1, mask: { shape: 'circle', x: 0, y: 0, size: 0.5 } });
    expect(at(inside, 0.1, 0)[0]).toBeCloseTo(1, 6); expect(at(inside, 0.9, 0)[0]).toBeCloseTo(0, 6);
    const outside = one({ kind: 'wind', weight: 1, mask: { shape: 'box', x: 0, y: 0, size: 0.5, outside: true } });
    expect(at(outside, 0.1, 0.4)[0]).toBeCloseTo(0, 6); expect(at(outside, 0.9, 0.1)[0]).toBeCloseTo(1, 6);
  });
  it('rotate turns its velocity: a vortex turned −60° spirals in', () => {
    const r = at(one({ kind: 'wind', weight: 1, rotate: 90 }), 0, 0);
    expect(r[0]).toBeCloseTo(0, 6); expect(r[1]).toBeCloseTo(1, 6);
    const v = at(one({ kind: 'vortex', weight: 1, rotate: 60 }), 0.3, 0);
    expect(v[0]).toBeLessThan(-0.5);
  });
  it('animate: a drifting vortex moves its centre; a spinning saddle turns', () => {
    const d = one({ kind: 'vortex', weight: 1, animate: { mode: 'drift', speed: 0.2, angle: 0 } });
    expect(at(d, 0.5, 0, 1)[1]).toBeCloseTo(1, 4); // centre at (0.2, 0) after 1 s: 0.3 out on the right
    const s = one({ kind: 'saddle', weight: 1, animate: { mode: 'spin', speed: 90 } });
    expect(at(s, 0, 0.3, 1)[1]).toBeGreaterThan(0); // after 1 s its out-line points up
  });
});

describe('your own', () => {
  it('reads x, y and t; the weight scales it', () => {
    const f = one({ kind: 'own', weight: 2, vx: '-y', vy: 'x + t' });
    const v = at(f, 0.3, 0.2, 0.5);
    expect(v[0]).toBeCloseTo(-0.4, 6); expect(v[1]).toBeCloseTo(1.6, 6);
  });
  it('errors: parse, ints, unknown names, z in 2D, not a float, unknown functions', () => {
    expect(checkOwn('-y').ok).toBe(true);
    expect(checkOwn('sin(x * 3.0) + PI').ok).toBe(true);
    expect(checkOwn('').error).toMatch(/Write an expression/);
    expect(checkOwn('sin(x').ok).toBe(false);
    expect(checkOwn('x * 2').error).toMatch(/2\.0/);
    expect(checkOwn('foo + x').error).toMatch(/foo isn't known/);
    expect(checkOwn('z').error).toMatch(/only there in 3D/);
    expect(checkOwn('z', true).ok).toBe(true);
    expect(checkOwn('vec2(x, y)').error).toMatch(/vec2/);
    expect(checkOwn('valueNoise(vec2(x, y))').error).toMatch(/valueNoise\(\) isn't available/);
  });
  it('a layer that doesn\'t check is left out of the shader (the rest still runs)', () => {
    const spec: FieldSpec = { layers: [{ ...newLayer('own'), vx: 'x * 2' }, { ...newLayer('wind'), weight: 1 }] };
    const { lines } = fieldLines(spec);
    expect(lines.some(l => l.rhs.includes('* 2)'))).toBe(false);
    expect(at(spec, 0.4, 0)[0]).toBeCloseTo(1, 6);
  });
});

const fieldAction = (spec: FieldSpec, o: Partial<Extract<RuleAction, { kind: 'field' }>> = {}): Extract<RuleAction, { kind: 'field' }> => ({ kind: 'field', strength: 1, grip: 3, spec, ...o });
const particles = (a: RuleAction): AgentRuleSet => ({ ...defaultRuleSet(), kind: 'particles', species: [{ name: 'P', speed: 0.2, states: [{ name: 'moving', colour: [1, 1, 1] }], rules: [{ when: [{ kind: 'always' }], do: [a] }] }] });
const MIXED: FieldSpec = { layers: [{ ...newLayer('vortex'), weight: 0.6 }, { ...newLayer('curl'), weight: 0.3, mask: { shape: 'circle', x: 0, y: 0, size: 0.6 } }, { ...newLayer('own'), weight: 0.2, vx: 'sin(y * 4.0 + t)', vy: '0.0' }] };

describe('the field becomes nodes', () => {
  it('an Expression Block returns the field, keeping its layers on its params; the rule rides it', () => {
    const set = particles(fieldAction(MIXED));
    const inside = generateRulesInside(set, { groupId: 'g', d3: false });
    const block = inside.find(x => x.id === ruleIds('g').field(0, 0, 1))!;
    expect(block.type).toBe('exprNode');
    expect(block.params.outputType).toBe('vec2');
    expect(normalizeFieldSpec(block.params.fieldSpec)).toEqual(normalizeFieldSpec(MIXED));
    expect(block.params.fieldOf).toMatchObject({ species: 0, rule: 0, action: 0, strength: 1, grip: 3 });
    expect(block.inputs.pos.connection).toEqual({ nodeId: ruleIds('g').inputs, outputKey: 'position' });
    const rule = inside.find(x => x.id === ruleIds('g').rule(0, 0))!;
    expect(rule.inputs.fld1.connection).toEqual({ nodeId: block.id, outputKey: 'result' });
    expect(String(block.params.__comment)).toMatch(/fieldSpec/);
    // Read back through the group: the same rule set.
    const g = applyRulesToGroup(n('agentsGroup', 'g', 0, 0, { subgraph: { nodes: [], inputPorts: [], outputPorts: [] } }), set);
    expect(groupRules(g).species[0].rules[0].do[0]).toEqual(fieldAction(MIXED));
  });

  it('the GPU code gives the same velocity as the CPU function the builder draws', () => {
    // A strong grip: after one step its velocity is the field (× strength).
    const set = particles(fieldAction(MIXED, { strength: 1, grip: 1e6 }));
    const prog = programOf(generateRulesInside(set, { groupId: 'g', d3: false }));
    const ws = walkersFor(6, { speed: 0.1 });
    const after = simulate(prog, ws, 1);
    const fn = fieldFunction(MIXED);
    after.forEach((w, i) => {
      const [fx, fy] = fn(ws[i].pos[0], ws[i].pos[1], 0);
      expect(w.speed).toBeCloseTo(Math.hypot(fx, fy), 4);
      if (w.speed > 1e-3) expect(Math.cos(w.heading as number) * w.speed).toBeCloseTo(fx, 4);
    });
    // As a force: the velocity changes by strength × field × dt.
    const push = programOf(generateRulesInside(particles(fieldAction(one({ kind: 'wind', weight: 1, angle: 90 }), { strength: 2, grip: undefined })), { groupId: 'g', d3: false }));
    const w0 = walkersFor(1, { speed: 0.3 }).map(w => ({ ...w, heading: 0 }));
    const w1 = simulate(push, w0, 1)[0];
    expect(Math.sin(w1.heading as number) * w1.speed).toBeCloseTo(2 / 60, 5);
  });

  it('compiles in 2D and 3D (and with a slope layer, with a chain wired into Field ƒ)', () => {
    for (const space of ['2d', '3d'] as const) {
      for (const spec of [MIXED, { layers: [...MIXED.layers, { ...newLayer('slope'), around: true }] }]) {
        const nodes = rulesTemplateNodes('particles', 'fx');
        const gi = nodes.findIndex(x => x.type === 'agentsGroup');
        const set = { ...groupRules(nodes[gi]) };
        set.species = [{ ...set.species[0], rules: [...set.species[0].rules, { when: [{ kind: 'always' }], do: [fieldAction(spec)] }] }];
        let g = applyRulesToGroup({ ...nodes[gi], params: { ...nodes[gi].params, space } }, set);
        const slope = spec.layers.some(l => l.kind === 'slope');
        const extra = [];
        if (slope) {
          expect(rulePorts(set).some(p => p.key === 'field')).toBe(true);
          extra.push(n('exprNode', 'fxShape', -400, 0, { inputs: [{ name: 'uv', type: 'vec2', slider: null }], outputType: 'float', lines: [], result: 'length(uv) - 0.5', expr: 'length(uv) - 0.5' }, { }));
          extra[0].inputs = { uv: { type: 'vec2', label: 'uv' } };
          extra[0].outputs = { result: { type: 'float', label: 'Result' } };
          g = { ...g, inputs: { ...g.inputs, field: { ...g.inputs.field, connection: { nodeId: 'fxShape', outputKey: 'result' } } } };
          expect(g.params.subgraph && (g.params.subgraph as { nodes: Array<{ type: string }> }).nodes.some(x => x.type === 'agentFlow')).toBe(true);
        }
        const all = [...extra, ...nodes.map((x, i) => (i === gi ? g : x))];
        const r = compileGraph({ nodes: all });
        expect(r.errors, `${space} slope=${slope}`).toBeUndefined();
        expect(r.success).toBe(true);
        expect(r.agents!.groups[0].fragmentShader).toContain('fld1');
      }
    }
  });
});

describe('words and text', () => {
  it('a field has a short name and a sentence', () => {
    expect(fieldName(MIXED)).toBe('vortex + curl noise × 0.5 + your own × 0.33, inside a circle');
    expect(describeAction(defaultRuleSet(), 0, fieldAction(one({ kind: 'vortex' })))).toBe('follow a field (vortex) ×1, riding it (grip 3)');
  });
  it('the agents language carries the layers: text → the same rule set', () => {
    const set = particles(fieldAction(MIXED, { strength: 0.8, grip: 2 }));
    const text = printAgents(set);
    expect(text).toContain('field 0.8 grip=2 layers="');
    const back = parseAgents(text);
    expect(back.errors).toEqual([]);
    expect(back.set.species[0].rules[0].do[0]).toEqual(fieldAction(normalizeFieldSpec(MIXED), { strength: 0.8, grip: 2 }));
    expect(fieldFromText(fieldToText(MIXED))).toEqual(normalizeFieldSpec(MIXED));
  });
});

describe('legend phrases, one a layer', () => {
  const N = NOUNS.particles;
  it('say each field from its values', () => {
    expect(phrase.fieldLayer(N, newLayer('vortex'))).toBe('Vortex at the centre, strength 0.6: particles circle anticlockwise, faster near the middle (fastest 0.3 out).');
    expect(phrase.fieldLayer(N, { ...newLayer('vortex'), flip: true, x: 0.5 })).toMatch(/^Vortex at \(0.5, 0\).*circle clockwise/);
    expect(phrase.fieldLayer(N, { ...newLayer('source'), flip: true })).toMatch(/^Sink at the centre.*stream in to it/);
    expect(phrase.fieldLayer(N, newLayer('saddle'))).toMatch(/come in from up and down and leave to the right and left/);
    expect(phrase.fieldLayer(N, { ...newLayer('wind'), angle: -90 })).toMatch(/blowing down/);
    expect(phrase.fieldLayer(N, newLayer('slope'))).toMatch(/downhill/);
    expect(phrase.fieldLayer(N, { ...newLayer('curl'), mask: { shape: 'circle', x: 0, y: 0, size: 0.5 }, animate: { mode: 'drift', speed: 0.1, angle: 0 } }))
      .toMatch(/never bunch them up; only inside a circle radius 0.5 round \(0, 0\), drifting right at 0.1 a second\.$/);
    expect(phrase.fieldLayer(N, { ...newLayer('own'), vx: 'x * 2' })).toBe('Your own field: not running yet; fix vx in its card.');
    expect(phrase.fieldHow(N, 1, 3)).toMatch(/rides the field × 1/);
    expect(phrase.fieldHow(N, 0.5, undefined)).toMatch(/is a force/);
  });
});
