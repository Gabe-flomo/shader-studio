import { describe, expect, it } from 'vitest';
import type { GraphNode } from '../../types/nodeGraph';
import { literalAt } from '../../lib/glslPatterns/literalSlider';
import { customFnMakeSlider, exprBlockMakeSlider, namesInCodeNode } from '../codeSlider';
import { exprBlockFunctionText, exprBlockLinesText, exprBlockToCustomFn } from '../exprToCustomFn';
import { madeByFunctionBuilder } from '../../components/NodeGraph/codeCard/codeCardModel';
import { CustomFnNode, ExprBlockNode } from '../definitions/effects';

function block(params: Record<string, unknown>, inputs: GraphNode['inputs'] = {}): GraphNode {
  return { id: 'b1', type: 'exprNode', position: { x: 0, y: 0 }, inputs, outputs: { result: { type: 'float', label: 'Result' } }, params } as GraphNode;
}

describe('Make a slider on an Expression Block', () => {
  const node = block({
    inputs: [{ name: 'd', type: 'float', slider: null }], outputType: 'float',
    lines: [{ lhs: 'float g', op: '=', rhs: 'smoothstep(0.6, 0.62, d)' }], result: 'g * 0.5',
  });

  it('a number in a line becomes a float input with a slider at its value, and the line reads it', () => {
    const rhs = 'smoothstep(0.6, 0.62, d)';
    const r = exprBlockMakeSlider(node, { kind: 'line', index: 0, field: 'rhs' }, literalAt(rhs, 12)!)!;
    expect(r.name).toBe('edge0');
    expect(r.params.lines).toEqual([{ lhs: 'float g', op: '=', rhs: 'smoothstep(edge0, 0.62, d)' }]);
    expect(r.params.edge0).toBe(0.6);
    expect(r.inputs.at(-1)).toEqual({ name: 'edge0', type: 'float', slider: { min: 0, max: 1 } });
    expect(r.params.result).toBeUndefined();
  });

  it('in Return too, named uniquely against the block (inputs, lines, t, p)', () => {
    const r = exprBlockMakeSlider(node, { kind: 'return' }, literalAt('g * 0.5', 5)!)!;
    expect(r.params.result).toBe('g * scale');
    const taken = namesInCodeNode(node);
    for (const n of ['d', 'g', 't', 'p', 'smoothstep']) expect(taken.has(n)).toBe(true);
  });

  it('the compiled block gives the same value: the slider holds the number', () => {
    const rhs = 'smoothstep(0.6, 0.62, d)';
    const r = exprBlockMakeSlider(node, { kind: 'line', index: 0, field: 'rhs' }, literalAt(rhs, 12)!)!;
    const after = block({ ...node.params, ...r.params });
    const glsl = ExprBlockNode.generateGLSL(after, { d: 'v_d', edge0: 'u_edge0' }).code;
    expect(glsl).toContain('float edge0 = u_edge0;');
    expect(glsl).toContain('g = smoothstep(edge0, 0.62, d);');
  });

  it('refuses a stale offer (the text moved on)', () => {
    expect(exprBlockMakeSlider(node, { kind: 'return' }, literalAt('x + 0.25', 5)!)).toBeNull();
  });
});

describe('Make a slider on a Custom Function', () => {
  it('a number in the body becomes an input', () => {
    const body = 'float r = length(uv);\nreturn smoothstep(0.3, 0.31, r);';
    const node = { id: 'f', type: 'customFn', position: { x: 0, y: 0 }, inputs: {}, outputs: {}, params: { inputs: [{ name: 'uv', type: 'vec2', slider: null }], outputType: 'float', body } } as unknown as GraphNode;
    const r = customFnMakeSlider(node, literalAt(body, body.indexOf('0.31') + 1)!)!;
    expect(r.name).toBe('edge1');
    expect(r.params.body).toBe('float r = length(uv);\nreturn smoothstep(0.3, edge1, r);');
    expect(r.params.edge1).toBe(0.31);
  });
});

describe('Copy as code', () => {
  const node = block({
    label: 'Ring Glow',
    inputs: [{ name: 'uv', type: 'vec2', slider: null }, { name: 'r', type: 'float', slider: { min: 0, max: 1 } }], r: 0.4, outputType: 'float',
    lines: [{ lhs: 'float d', op: '=', rhs: 'length(uv) - r' }, { lhs: 'd', op: '*=', rhs: '2.0', off: true }], result: '0.01 / abs(d)',
  });

  it('copies the lines as they compile, off lines as comments, then return', () => {
    expect(exprBlockLinesText(node)).toBe('float d = length(uv) - r;\n// off: d *= 2.0\nreturn 0.01 / abs(d);');
  });

  it('copies a whole GLSL function with its inputs as parameters and the slider values', () => {
    expect(exprBlockFunctionText(node)).toBe(
      '// r = 0.4\nfloat ring_glow(vec2 uv, float r) {\n  float d = length(uv) - r;\n  // off: d *= 2.0\n  return 0.01 / abs(d);\n}');
  });
});

describe('Turn into a Custom Function', () => {
  it('keeps the id, inputs, slider values, note and wires; the lines become the body', () => {
    const node = block({
      label: 'Warp', __comment: 'why',
      inputs: [{ name: 'uv', type: 'vec2', slider: null }, { name: 'amt', type: 'float', slider: { min: 0, max: 2 } }], amt: 0.7, outputType: 'vec2',
      lines: [{ lhs: 'uv', op: '+=', rhs: 'sin(uv.yx * 4.0 + t) * amt' }], result: 'uv', fnBuilderFns: [],
    }, { uv: { type: 'vec2', label: 'uv', connection: { nodeId: 'src', outputKey: 'uv' } } });
    const r = exprBlockToCustomFn(node);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const fn = r.node;
    expect(fn.id).toBe('b1');
    expect(fn.type).toBe('customFn');
    expect(fn.inputs.uv.connection).toEqual({ nodeId: 'src', outputKey: 'uv' });
    expect(fn.params).toMatchObject({ label: 'Warp', __comment: 'why', amt: 0.7, outputType: 'vec2', inputs: node.params.inputs });
    // `t` is written out, and the input a line writes to gets a local copy
    expect(fn.params.body).toBe('float t = u_time;\nvec2 uv_v = uv;\nuv_v += sin(uv_v.yx * 4.0 + t) * amt;\nreturn uv_v;');
    expect('lines' in fn.params).toBe(false);
    expect('fnBuilderFns' in fn.params).toBe(false);
    // It compiles: the body runs with the upstream value in place of the input
    const code = CustomFnNode.generateGLSL(fn, { uv: 'src_uv', amt: 'u_amt' }).code;
    expect(code).toContain('vec2 uv_v = src_uv;');
    expect(code).toContain('{ b1_result = uv_v; break; }');
  });

  it('exposed locals become extra outputs, declared outside', () => {
    const node = block({ inputs: [{ name: 'x', type: 'float', slider: null }], outputType: 'float', outputs: ['d'], lines: [{ lhs: 'float d', op: '=', rhs: 'x * 2.0' }], result: 'd + 1.0' });
    const r = exprBlockToCustomFn(node);
    expect(r.ok && r.node.params.outputs).toEqual([{ name: 'd', type: 'float' }]);
    expect(r.ok && r.node.params.body).toBe('d = x * 2.0;\nreturn d + 1.0;');
  });

  it('a block that carries between loop iterations, or outputs an input, stays a block', () => {
    expect(exprBlockToCustomFn(block({ inputs: [{ name: 'x', type: 'float', slider: null, carry: true }], result: 'x' })).ok).toBe(false);
    expect(exprBlockToCustomFn(block({ inputs: [{ name: 'x', type: 'float', slider: null }], outputs: ['x'], result: 'x' })).ok).toBe(false);
  });
});

describe('Edit in Function Builder', () => {
  it('only on a block the Builder made, while it has no lines of its own', () => {
    expect(madeByFunctionBuilder(block({ lines: [], result: 'sin(x)' }))).toBe(false);
    expect(madeByFunctionBuilder(block({ lines: [], result: 'sin(x)', fnBuilderFns: [] }))).toBe(false);
    const made = block({ lines: [], result: 'sin(x)', fnBuilderFns: [{ name: 'f1', returnType: 'float', body: 'sin(x)' }] });
    expect(madeByFunctionBuilder(made)).toBe(true);
    expect(madeByFunctionBuilder({ ...made, params: { ...made.params, lines: [{ lhs: 'x', op: '*=', rhs: '2.0' }] } })).toBe(false);
    expect(madeByFunctionBuilder({ ...made, params: { ...made.params, lines: [{ lhs: 'x', op: '=', rhs: '' }] } })).toBe(true);
  });
});
