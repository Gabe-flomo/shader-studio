/**
 * Input names on a placed node: a name and a description of its own for any
 * input, the code untouched; publishing the node starts from them.
 */
import { describe, it, expect, vi } from 'vitest';
vi.hoisted(() => vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} }));
import type { GraphNode } from '../../types/nodeGraph';
import { compileGraph } from '../graphCompiler';
import { describeSource } from '../../nodes/userNodes/publishUserNode';
import { inputHintOf, inputLabelOf, inputTextPatch, inputTexts } from '../../lib/inputNames';

function exprBlock(params: Record<string, unknown> = {}): GraphNode {
  return {
    id: 'ex1', type: 'exprNode', position: { x: 0, y: 0 },
    inputs: { amp: { type: 'float', label: 'amp' } },
    outputs: { result: { type: 'float', label: 'Result' } },
    params: { inputs: [{ name: 'amp', type: 'float', slider: { min: 0, max: 2 } }], amp: 0.5, outputType: 'float', lines: [], result: 'amp', ...params },
  };
}

describe('input names', () => {
  it('a name and a description are set and cleared per input; the default name shows otherwise', () => {
    let n = exprBlock();
    expect(inputLabelOf(n, 'amp', 'amp')).toBe('amp');
    n = { ...n, params: { ...n.params, ...inputTextPatch(n, 'label', 'amp', 'Ripple height') } };
    n = { ...n, params: { ...n.params, ...inputTextPatch(n, 'hint', 'amp', 'How tall the ripples get') } };
    expect(inputLabelOf(n, 'amp', 'amp')).toBe('Ripple height');
    expect(inputHintOf(n, 'amp')).toBe('How tall the ripples get');
    expect(inputTexts(n)).toEqual({ amp: { label: 'Ripple height', hint: 'How tall the ripples get' } });
    n = { ...n, params: { ...n.params, ...inputTextPatch(n, 'label', 'amp', '  ') } };
    expect(inputLabelOf(n, 'amp', 'amp')).toBe('amp');
    expect(n.params.__inputLabels).toBeUndefined();
  });

  it('the code is untouched: the shader is the same with or without names', () => {
    const out = (ex: GraphNode): GraphNode[] => [ex, { id: 'o', type: 'output', position: { x: 300, y: 0 }, inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'ex1', outputKey: 'result' } } }, outputs: {}, params: {} }];
    const plain = compileGraph({ nodes: out(exprBlock()) }).fragmentShader;
    const named = compileGraph({ nodes: out(exprBlock({ __inputLabels: { amp: 'Ripple height' }, __inputHints: { amp: 'How tall' } })) }).fragmentShader;
    expect(named).toBe(plain);
  });

  it('publishing starts from the chosen names and descriptions (a node, and code from a Custom Function)', () => {
    const ports = describeSource({ kind: 'node', node: exprBlock({ __inputLabels: { amp: 'Ripple height' }, __inputHints: { amp: 'How tall' } }) });
    expect(ports.inputs[0]).toMatchObject({ portKey: 'amp', label: 'Ripple height', hint: 'How tall' });
    const code = describeSource({ kind: 'code', code: 'float f(float amp) { return amp; }', entry: 'f', label: 'F', inputText: { amp: { label: 'Ripple height' } } });
    expect(code.inputs[0]).toMatchObject({ portKey: 'amp', label: 'Ripple height' });
    expect(describeSource({ kind: 'node', node: exprBlock() }).inputs[0].label).toBe('amp');
  });
});
