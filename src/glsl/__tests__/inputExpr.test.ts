/**
 * Input expressions: a one-line expression on a float input, rooted in
 * `input`, applied where the card reads the input and nowhere else. The raw
 * input (wire, slider, keyframes) is untouched; the expression binds the
 * clock, the canvas, sibling inputs and sliders; and the compiled shader
 * carries it through every path (top level and inside a group).
 */
import { describe, expect, it } from 'vitest';
import type { GraphNode } from '../../types/nodeGraph';
import { applyInputExpressions, bindInputExpr, canHaveInputExpr, getInputExpr, inputExprKey, inputExprVariables, validateInputExpr } from '../inputExpr';
import { getNodeDefinition } from '../../nodes/definitions';
import { compileGraph } from '../../compiler/graphCompiler';

const node = (id: string, type: string, inputs: GraphNode['inputs'], outputs: GraphNode['outputs'], params: Record<string, unknown> = {}): GraphNode =>
  ({ id, type, position: { x: 0, y: 0 }, inputs, outputs, params });
const f = (label: string, from?: string, key = 'result'): GraphNode['inputs'][string] => ({ type: 'float', label, ...(from ? { connection: { nodeId: from, outputKey: key } } : {}) });

const sin = (params: Record<string, unknown> = {}) => node('s', 'sin', { input: f('Input', 'c', 'value'), freq: f('Freq'), amp: f('Amp') }, { output: { type: 'float', label: 'Output' } }, { freq: 2, amp: 1, outputType: 'float', ...params });

describe('input expressions', () => {
  it('validates: rooted in input, one expression, only known names and GLSL functions', () => {
    const vars = inputExprVariables(sin(), getNodeDefinition('sin'), 'input');
    expect(vars.map(v => v.name)).toEqual(['input', 't', 'uv', 'res', 'mouse', 'freq', 'amp']);
    expect(validateInputExpr('input * 2.0 + sin(t)', vars).ok).toBe(true);
    expect(validateInputExpr('fract(input) * freq + uv.x', vars).ok).toBe(true);
    expect(validateInputExpr('2.0 * t', vars).error).toMatch(/input/);
    expect(validateInputExpr('input = 1.0', vars).error).toMatch(/assignment/);
    expect(validateInputExpr('input; 1.0', vars).error).toMatch(/One expression/);
    expect(validateInputExpr('input * (2.0', vars).error).toMatch(/Unbalanced/);
    expect(validateInputExpr('input * nope', vars).error).toMatch(/nope isn’t|nope isn't/);
    expect(validateInputExpr('foo(input)', vars).error).toMatch(/foo\(\)/);
    expect(validateInputExpr('input >= 0.5 ? 1.0 : 0.0', vars).ok).toBe(true);
  });

  it('binds input to the raw value, the environment to uniforms, siblings to their values and sliders to their params', () => {
    const n = sin({ freq: 3 });
    const bound = bindInputExpr('input * freq + sin(t) * res.x + amp', 'c_x', n, { input: 'c_x', amp: 'k_out' });
    expect(bound).toBe('((c_x) * 3.0 + sin(u_time) * u_resolution.x + (k_out))');
    // A patched param (a uniform name) passes through
    expect(bindInputExpr('input * freq', 'c_x', sin({ freq: 'u_p_s_freq' }), {})).toBe('((c_x) * (u_p_s_freq))');
    // Only float sockets with a non-empty expression apply; an unresolved input falls back to its slider
    const n2 = sin({ [inputExprKey('input')]: 'input + 1.0', [inputExprKey('freq')]: '  ' });
    expect(applyInputExpressions(n2, { input: 'c_x' })).toEqual({ input: '((c_x) + 1.0)' });
    const unwired = { ...n2, inputs: { ...n2.inputs, input: f('Input') }, params: { ...n2.params, input: 0.5 } };
    expect(applyInputExpressions(unwired, {})).toEqual({ input: '((0.5) + 1.0)' });
    expect(getInputExpr(n2, 'input')).toBe('input + 1.0');
    expect(getInputExpr(n2, 'freq')).toBeNull();
    expect(canHaveInputExpr(n2, 'input')).toBe(true);
    expect(canHaveInputExpr(node('o', 'output', { color: { type: 'vec3', label: 'Color' } }, {}), 'color')).toBe(false);
  });

  it('compiles through the definition wrapper, at the top level and inside a group', () => {
    const graph = [
      node('c', 'constant', {}, { value: { type: 'float', label: 'Value' } }, { value: 0.25 }),
      sin({ [inputExprKey('input')]: 'input * 4.0 + t' }),
      node('f2v', 'floatToVec3', { input: f('Float', 's', 'output') }, { rgb: { type: 'vec3', label: 'Color' } }),
      node('out', 'output', { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'f2v', outputKey: 'rgb' } } }, {}),
    ];
    const c = compileGraph({ nodes: graph });
    expect(c.errors ?? []).toEqual([]);
    expect(c.success).toBe(true);
    expect(c.fragmentShader).toMatch(/sin\(\(\(\w+\) \* 4\.0 \+ u_time\) \* /);
    // The same card inside a group
    const inner = graph.slice(0, 3);
    const g = node('g', 'group', {}, { rgb: { type: 'vec3', label: 'Color' } }, { subgraph: { nodes: inner, inputPorts: [], outputPorts: [{ key: 'rgb', label: 'Color', type: 'vec3', fromNodeId: 'f2v', fromOutputKey: 'rgb' }] } });
    const c2 = compileGraph({ nodes: [g, node('out', 'output', { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'g', outputKey: 'rgb' } } }, {})] });
    expect(c2.errors ?? []).toEqual([]);
    expect(c2.fragmentShader).toMatch(/\* 4\.0 \+ u_time\)/);
  });
});
