/**
 * Expression knobs: `k` in `input * k` is a slider of the expression's own.
 * It's found as an unknown name, checked against the reserved ones, compiled
 * as one uniform per knob (so dragging it never changes the shader text),
 * saved as plain params (so a graph round-trips), and it's a Play candidate
 * and a keyframe target like any other float slider.
 */
import { describe, expect, it, vi } from 'vitest';
import type { GraphNode } from '../../types/nodeGraph';
import {
  applyInputExpressions, getInputKnobs, inputExprKey, inputExprPatch, inputExprVariables, inputKnobsKey, isKnobParamKey,
  knobCandidates, knobNameProblem, knobParamDefs, knobParamKey, knobVariables, nextKnobName, validateInputExpr,
} from '../inputExpr';
import { getNodeDefinition, getNodeDefinitionFor } from '../../nodes/definitions';
import { compileGraph } from '../../compiler/graphCompiler';
import { collectPlayCandidates, readControlValue } from '../../play/playControls';

vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} });

const node = (id: string, type: string, inputs: GraphNode['inputs'], outputs: GraphNode['outputs'], params: Record<string, unknown> = {}): GraphNode =>
  ({ id, type, position: { x: 0, y: 0 }, inputs, outputs, params });
const f = (label: string, from?: string, key = 'result'): GraphNode['inputs'][string] => ({ type: 'float', label, ...(from ? { connection: { nodeId: from, outputKey: key } } : {}) });

const sin = (params: Record<string, unknown> = {}) => node('s', 'sin', { input: f('Input', 'c', 'value'), freq: f('Freq'), amp: f('Amp') }, { output: { type: 'float', label: 'Output' } }, { freq: 2, amp: 1, outputType: 'float', ...params });

/** Constant → Sin (with an expression on Input) → Float to Vec3 → Output. */
const graph = (sinParams: Record<string, unknown>): GraphNode[] => [
  node('c', 'constant', {}, { value: { type: 'float', label: 'Value' } }, { value: 0.25 }),
  sin(sinParams),
  node('f2v', 'floatToVec3', { input: f('Float', 's', 'output') }, { rgb: { type: 'vec3', label: 'Color' } }),
  node('out', 'output', { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'f2v', outputKey: 'rgb' } } }, {}),
];
const withKnobs = (expr: string, knobs: Array<{ name: string; min: number; max: number }>, values: Record<string, number>) => ({
  [inputExprKey('input')]: expr,
  [inputKnobsKey('input')]: knobs,
  ...Object.fromEntries(Object.entries(values).map(([k, v]) => [knobParamKey('input', k), v])),
});

describe('expression knobs: parsing', () => {
  const vars = inputExprVariables(sin(), getNodeDefinition('sin'), 'input');

  it('offers unknown names as knobs, never reserved ones, siblings, sliders or functions', () => {
    expect(knobCandidates('input * k + wob * sin(t * speed)', vars)).toEqual(['k', 'wob', 'speed']);
    // Known names, constants, swizzles and calls are not candidates
    expect(knobCandidates('input * freq + uv.x + PI + sin(t)', vars)).toEqual([]);
    expect(knobNameProblem('k', vars)).toBeNull();
    expect(knobNameProblem('amount_2', vars)).toBeNull();
    for (const bad of ['input', 't', 'time', 'uv', 'res', 'mouse', 'float', 'vec2', 'sin', 'PI', 'u_x', 'gl_Pos']) expect(knobNameProblem(bad, vars), bad).toMatch(/reserved/);
    expect(knobNameProblem('freq', vars)).toMatch(/already a name/);
    expect(knobNameProblem('a__b', vars)).toMatch(/letter/);
    expect(knobNameProblem('_k', vars)).toMatch(/letter/);
    expect(knobNameProblem('k', vars, [{ name: 'k', min: 0, max: 1 }])).toMatch(/already a knob/);
  });

  it('a knob is a known name once made, and fresh names skip the taken ones', () => {
    expect(validateInputExpr('input * k', vars).error).toMatch(/k isn.t available/);
    expect(validateInputExpr('input * k', [...vars, ...knobVariables([{ name: 'k', min: 0, max: 2 }])]).ok).toBe(true);
    expect(nextKnobName(vars, [])).toBe('k');
    expect(nextKnobName(vars, [{ name: 'k', min: 0, max: 1 }])).toBe('k2');
    expect(nextKnobName(vars, [], 'input * k')).toBe('k2');
  });

  it('reads only well-formed knobs, and the patch keeps only the ones the expression uses', () => {
    const n = sin({ [inputKnobsKey('input')]: [{ name: 'k', min: -1, max: 1 }, { name: 'k' }, { name: 'bad name' }, { name: 'r', min: 2, max: 1 }, 'junk'] });
    expect(getInputKnobs(n, 'input')).toEqual([{ name: 'k', min: -1, max: 1 }, { name: 'r', min: 2, max: 3 }]);
    const before = sin(withKnobs('input * k * r', [{ name: 'k', min: 0, max: 2 }, { name: 'r', min: 0, max: 1 }], { k: 1.5, r: 0.2 }));
    const patch = inputExprPatch(before, 'input', 'input * k + j', [{ name: 'k', min: 0, max: 4 }, { name: 'r', min: 0, max: 1 }, { name: 'j', min: 0, max: 2 }]);
    expect(patch[inputKnobsKey('input')]).toEqual([{ name: 'k', min: 0, max: 4 }, { name: 'j', min: 0, max: 2 }]);
    expect(patch[knobParamKey('input', 'k')]).toBe(1.5); // kept
    expect(patch[knobParamKey('input', 'j')]).toBe(1); // new: the middle of its range
    expect(knobParamKey('input', 'r') in patch && patch[knobParamKey('input', 'r')] === undefined).toBe(true); // gone
    // Clearing the expression clears every knob
    const cleared = inputExprPatch(before, 'input', '', []);
    expect(cleared[inputExprKey('input')]).toBe('');
    expect(cleared[inputKnobsKey('input')]).toBeUndefined();
    expect(Object.keys(cleared)).toContain(knobParamKey('input', 'k'));
  });

  it('keeps the value param GLSL-safe (no double underscore) whatever the input key', () => {
    expect(knobParamKey('n_pts', 'k')).toBe('knob_nxpts_k');
    expect(knobParamKey('__param_x', 'k')).not.toMatch(/__/);
  });
});

describe('expression knobs: compile', () => {
  const params = withKnobs('input * k + amt * sin(t)', [{ name: 'k', min: 0, max: 4 }, { name: 'amt', min: 0, max: 1 }], { k: 2, amt: 0.5 });

  it('declares a paramDef per knob on the instance, and the card draws it under the expression', () => {
    const n = sin(params);
    const pd = getNodeDefinitionFor(n)!.paramDefs![knobParamKey('input', 'k')];
    expect(pd).toMatchObject({ label: 'Input · k', type: 'float', min: 0, max: 4 });
    expect(isKnobParamKey(n, knobParamKey('input', 'k'))).toBe(true);
    expect(isKnobParamKey(n, 'freq')).toBe(false);
    // No expression, no knobs: the listing alone declares nothing
    expect(knobParamDefs(sin({ [inputKnobsKey('input')]: [{ name: 'k', min: 0, max: 1 }] }))).toBeNull();
    // A card without knobs keeps the shared definition
    expect(getNodeDefinitionFor(sin())).toBe(getNodeDefinition('sin'));
  });

  it('compiles each knob as a uniform, so a new value is a uniform write, not new shader text', () => {
    const c = compileGraph({ nodes: graph(params) });
    expect(c.errors ?? []).toEqual([]);
    const kU = c.paramBindings[`s::${knobParamKey('input', 'k')}`];
    const aU = c.paramBindings[`s::${knobParamKey('input', 'amt')}`];
    expect(kU).toMatch(/^u_p_\w+$/);
    expect(aU).toMatch(/^u_p_\w+$/);
    expect(kU).not.toMatch(/__/);
    expect(c.paramUniforms[kU]).toBe(2);
    expect(c.paramUniforms[aU]).toBe(0.5);
    expect(c.fragmentShader).toContain(`uniform float ${kU};`);
    expect(c.fragmentShader).toMatch(new RegExp(`\\* \\(${kU}\\) \\+ \\(${aU}\\) \\* sin\\(u_time\\)`));
    const c2 = compileGraph({ nodes: graph({ ...params, [knobParamKey('input', 'k')]: 3.25 }) });
    expect(c2.fragmentShader).toBe(c.fragmentShader);
    expect(c2.paramUniforms[kU]).toBe(3.25);
  });

  it('binds a keyframed knob to its curve, and a bare binder call to the literal', () => {
    const keyed = { ...params, [`__keyframes_${knobParamKey('input', 'k')}`]: [{ t: 0, v: 0 }, { t: 1, v: 2 }] };
    const c = compileGraph({ nodes: graph(keyed) });
    expect(c.errors ?? []).toEqual([]);
    expect(c.fragmentShader).toMatch(/\* \(kf_\w+\(u_time\)\)/);
    expect(applyInputExpressions(sin(params), { input: 'c_x' }).input).toBe('((c_x) * 2.0 + 0.5 * sin(u_time))');
  });

  it('works inside a group', () => {
    const inner = graph(params).slice(0, 3);
    const g = node('g', 'group', {}, { rgb: { type: 'vec3', label: 'Color' } }, { subgraph: { nodes: inner, inputPorts: [], outputPorts: [{ key: 'rgb', label: 'Color', type: 'vec3', fromNodeId: 'f2v', fromOutputKey: 'rgb' }] } });
    const c = compileGraph({ nodes: [g, node('out', 'output', { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'g', outputKey: 'rgb' } } }, {})] });
    expect(c.errors ?? []).toEqual([]);
    expect(Object.values(c.paramUniforms)).toContain(2);
    expect(c.fragmentShader).toMatch(/\* \(u_p_\w+\) \+ \(u_p_\w+\) \* sin\(u_time\)/);
  });
});

describe('expression knobs: saved graphs and Play', () => {
  const params = withKnobs('input * k', [{ name: 'k', min: 0, max: 4 }], { k: 1.25 });

  it('round-trips through JSON: same knobs, same shader', () => {
    const nodes = graph(params);
    const back = JSON.parse(JSON.stringify(nodes)) as GraphNode[];
    expect(getInputKnobs(back[1], 'input')).toEqual([{ name: 'k', min: 0, max: 4 }]);
    expect(compileGraph({ nodes: back }).fragmentShader).toBe(compileGraph({ nodes }).fragmentShader);
    // An old expression (no knobs) is unchanged
    const old = graph({ [inputExprKey('input')]: 'input * 2.0' });
    expect(compileGraph({ nodes: old }).fragmentShader).toMatch(/\(\(\w+\) \* 2\.0\)/);
  });

  it('is a Play candidate with its range, and a control reads its value', () => {
    const nodes = graph(params);
    const c = compileGraph({ nodes });
    const target = `s::${knobParamKey('input', 'k')}`;
    const cand = collectPlayCandidates(nodes, c.paramBindings).find(x => x.target === target);
    expect(cand).toMatchObject({ kind: 'float', paramLabel: 'Input · k', min: 0, max: 4, value: 1.25 });
    expect(readControlValue(nodes, target)).toBe(1.25);
  });
});
