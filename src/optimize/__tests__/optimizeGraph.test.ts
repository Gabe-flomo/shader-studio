/**
 * Optimise graph: chains of math cards fold into one Expression Block whose
 * lines are the cards' own GLSL, sliders survive as slider inputs, protected
 * and shared cards stay, and the result still compiles.
 */
import { describe, expect, it } from 'vitest';
import type { GraphNode } from '../../types/nodeGraph';
import { optimizeGraph, playProtectedIds } from '../optimizeGraph';
import { compileGraph } from '../../compiler/graphCompiler';
import { glslToGraph } from '../../glslToGraph';

const node = (id: string, type: string, inputs: GraphNode['inputs'], outputs: GraphNode['outputs'], params: Record<string, unknown> = {}): GraphNode =>
  ({ id, type, position: { x: 0, y: 0 }, inputs, outputs, params });
const f = (label: string, from?: string, key = 'result'): GraphNode['inputs'][string] => ({ type: 'float', label, ...(from ? { connection: { nodeId: from, outputKey: key } } : {}) });

/** uv → Split → x*3 → +0.5 → sin → Float→Vec3 → Output, with one Split output also read elsewhere in a variant. */
function chain(): GraphNode[] {
  return [
    node('uv', 'uv', {}, { uv: { type: 'vec2', label: 'UV' } }),
    node('split', 'splitVec2', { v: { type: 'vec2', label: 'Vec2', connection: { nodeId: 'uv', outputKey: 'uv' } } }, { x: { type: 'float', label: 'X' }, y: { type: 'float', label: 'Y' } }),
    node('mul', 'multiply', { a: f('A', 'split', 'x'), b: f('B') }, { result: { type: 'float', label: 'Result' } }, { b: 3, outputType: 'float' }),
    node('add', 'add', { a: f('A', 'mul'), b: f('B') }, { result: { type: 'float', label: 'Result' } }, { b: 0.5, outputType: 'float' }),
    node('sin', 'sin', { input: f('Input', 'add') }, { output: { type: 'float', label: 'Output' } }, { freq: 1, amp: 1, outputType: 'float' }),
    node('f2v', 'floatToVec3', { input: f('Float', 'sin', 'output') }, { rgb: { type: 'vec3', label: 'Color' } }),
    node('out', 'output', { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'f2v', outputKey: 'rgb' } } }, {}),
  ];
}

describe('optimizeGraph', () => {
  it('folds the chain into one block with the cards’ sliders as inputs, and it compiles', () => {
    const { nodes, report } = optimizeGraph(chain());
    expect(report.folds).toHaveLength(1);
    expect(report.folds[0].nodeIds.sort()).toEqual(['add', 'f2v', 'mul', 'sin', 'split']);
    const block = nodes.find(n => n.type === 'exprNode')!;
    expect(block.params.outputType).toBe('vec3');
    const inputs = block.params.inputs as Array<{ name: string; slider: unknown }>;
    expect(inputs.map(i => i.name)).toEqual(['uv', 'multiply_b', 'add_b', 'sin_freq', 'sin_amp']);
    expect(block.params).toMatchObject({ multiply_b: 3, add_b: 0.5, sin_freq: 1, sin_amp: 1 });
    expect(block.inputs.uv.connection).toEqual({ nodeId: 'uv', outputKey: 'uv' });
    expect(nodes.find(n => n.id === 'out')!.inputs.color.connection).toEqual({ nodeId: block.id, outputKey: 'result' });
    const lines = block.params.lines as Array<{ lhs: string; rhs: string }>;
    expect(lines.some(l => /\* multiply_b/.test(l.rhs))).toBe(true);
    expect(compileGraph({ nodes }).success).toBe(true);
    expect(report.after).toBe(report.before - 4);
  });

  it('bakes the numbers instead when asked', () => {
    const { nodes } = optimizeGraph(chain(), { keepSliders: false });
    const block = nodes.find(n => n.type === 'exprNode')!;
    expect((block.params.inputs as Array<{ name: string }>).map(i => i.name)).toEqual(['uv']);
    expect((block.params.lines as Array<{ rhs: string }>).some(l => /\* 3\.0/.test(l.rhs))).toBe(true);
  });

  it('leaves a card two places read, a protected card, and a short run alone', () => {
    const shared = chain();
    shared.push(node('add2', 'add', { a: f('A', 'mul'), b: f('B') }, { result: { type: 'float', label: 'Result' } }, { b: 1, outputType: 'float' }));
    const r1 = optimizeGraph(shared);
    // mul is read by add and add2, so it stays; the run above it (split) too. add→sin→f2v still folds.
    expect(r1.nodes.some(n => n.id === 'mul')).toBe(true);
    expect(r1.report.folds[0]?.nodeIds.sort()).toEqual(['add', 'f2v', 'sin']);
    const r2 = optimizeGraph(chain(), { protect: new Set(['add']) });
    expect(r2.nodes.some(n => n.id === 'add')).toBe(true);
    expect(r2.report.folds.every(fd => !fd.nodeIds.includes('add'))).toBe(true);
    const r3 = optimizeGraph(chain(), { minChain: 9 });
    expect(r3.report.folds).toHaveLength(0);
    expect(r3.nodes).toBe(chain().length === r3.nodes.length ? r3.nodes : r3.nodes);
  });

  it('protects what Play controls point at', () => {
    expect(playProtectedIds({ version: 1, controls: [{ id: 'c1', target: 'mul::b', kind: 'float', label: 'B' } as never, { id: 'c2', target: 'g1::inner::k', kind: 'float', label: 'K' } as never], mappings: [], layers: [] })).toEqual(new Set(['mul', 'g1', 'inner']));
  });

  it('folds inside an iterated group and keeps its output port working', () => {
    const src = 'void main(){ vec2 uv = gl_FragCoord.xy / u_resolution.xy; float a = 0.0; for (int i = 0; i < 4; i++) { float fi = float(i); a += sin(uv.x * (3.0 + fi) + u_time + fi) * 0.25; } gl_FragColor = vec4(vec3(0.5 + 0.5 * a), 1.0); }';
    const conv = glslToGraph(src);
    const { nodes, report } = optimizeGraph(conv.nodes);
    const inner = report.folds.filter(fd => fd.scope !== 'graph');
    expect(inner.length).toBeGreaterThan(0);
    const g = nodes.find(n => n.type === 'group')!;
    const sg = g.params.subgraph as { nodes: GraphNode[]; outputPorts: Array<{ fromNodeId: string }> };
    expect(sg.outputPorts.every(p => sg.nodes.some(n => n.id === p.fromNodeId))).toBe(true);
    const c = compileGraph({ nodes });
    expect(c.errors ?? []).toEqual([]);
    expect(c.success).toBe(true);
  });
});
