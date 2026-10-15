/** Text (docs/text-node.md): lines of character codes, {} as a live number, compiled from the font atlas. */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});

import { textLines } from '../text';
import { compileGraph } from '../../../compiler/graphCompiler';
import type { CompilationResult } from '../../../compiler/types';
import type { GraphNode } from '../../../types/nodeGraph';
import { getNodeDefinition } from '..';

const node = (id: string, type: string, params: Record<string, unknown> = {}, wires: Record<string, [string, string]> = {}): GraphNode => {
  const def = getNodeDefinition(type)!;
  const inputs = Object.fromEntries(Object.entries(def.inputs).map(([k, s]) => [k, { type: s.type, label: s.label, ...(wires[k] ? { connection: { nodeId: wires[k][0], outputKey: wires[k][1] } } : {}) }]));
  return { id, type, position: { x: 0, y: 0 }, outputs: { ...def.outputs }, params: { ...def.defaultParams, ...params }, inputs } as GraphNode;
};
const out = (from: string, key: string) => ({ id: 'out', type: 'output', position: { x: 0, y: 0 }, outputs: {}, params: {}, inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: from, outputKey: key } } } }) as unknown as GraphNode;

describe('Text', () => {
  it('splits lines on \\n (typed or real), {} is the number\'s place, Number width long', () => {
    expect(textLines('Hi {}!', 3)).toEqual([[72, 105, 32, -1, -2, -3, 33]]);
    expect(textLines('A\\nB', 4)).toEqual([[65], [66]]);
    expect(textLines('é', 2)).toEqual([[63]]);
  });

  it('compiles: constant arrays of codes, the number from Value (a socket), the atlas read', () => {
    const r = compileGraph({ nodes: [node('t', 'text', { text: 'Count: {}\\nok', decimals: 1, numWidth: 4 }), out('t', 'color')] }) as CompilationResult;
    expect(r.errors ?? []).toEqual([]);
    expect(r.fragmentShader).toMatch(/const int \w+_T\[13\] = int\[13\]\(67, 111, 117, 110, 116, 58, 32, -1, -2, -3, -4, 111, 107\);/);
    expect(r.fragmentShader).toMatch(/tx_numChar\(u_p_\w+_value, 1, 4, -1 - c\)/);
    expect(r.fragmentShader).toContain('textureLod(u_fontTexture');
    const lfo = node('lfo', 'lfo');
    const wired = compileGraph({ nodes: [lfo, node('t', 'text', {}, { value: ['lfo', 'value'] }), out('t', 'color')] }) as CompilationResult;
    expect(wired.errors ?? []).toEqual([]);
    expect(wired.fragmentShader).not.toMatch(/tx_numChar\(u_p_\w+_value/);
  });

  it('empty text draws nothing', () => {
    const r = compileGraph({ nodes: [node('t', 'text', { text: '' }), out('t', 'color')] }) as CompilationResult;
    expect(r.errors ?? []).toEqual([]);
  });
});
