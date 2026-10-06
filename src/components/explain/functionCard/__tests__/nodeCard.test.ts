/**
 * The node card (the ⓘ on a canvas node): the description, plus a plain-meaning line from the
 * node's main idiom when one applies.
 */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} });
});
import type { GraphNode } from '../../../../types/nodeGraph';
import { getNodeDefinition } from '../../../../nodes/definitions';
import { mainExpression, nodeCardModel } from '../nodeCard';

const node = (type: string, params: Record<string, unknown> = {}): GraphNode => ({ id: 'n1', type, position: { x: 0, y: 0 }, inputs: {}, outputs: {}, params } as unknown as GraphNode);

describe('node cards', () => {
  it('a node that is one GLSL function: its description and that function’s meaning', () => {
    const m = nodeCardModel(node('smoothstep'), getNodeDefinition('smoothstep')!);
    expect(m.title).toBe('Smoothstep');
    expect(m.description).toMatch(/smoothstep/);
    expect(m.meaning).toMatch(/^Gives a soft ramp from 0 to 1/);
    expect(m.fnName).toBe('smoothstep');
  });

  it('an Expression Block: the idiom it returns, followed back to its line', () => {
    const n = node('exprNode', {
      inputs: [{ name: 'a', type: 'float' }],
      lines: [{ lhs: 'float silent', op: '=', rhs: '1.0 - step(0.02, a)' }],
      result: 'silent', outputType: 'float',
    });
    expect(mainExpression(n)).toBe('1.0 - step(0.02, a)');
    const m = nodeCardModel(n, getNodeDefinition('exprNode')!);
    expect(m.meaning).toMatch(/0\.02/);
    expect(m.meaningOf).toBe('1.0 - step(0.02, a)');
    expect(m.use).toBeTruthy();
  });

  it('an Expression Block whose return is no idiom: its last line that is one', () => {
    const n = node('exprNode', {
      inputs: [{ name: 'uv', type: 'vec2' }],
      lines: [{ lhs: 'float d', op: '=', rhs: 'length(uv - 0.5)' }, { lhs: 'float edge', op: '=', rhs: 'smoothstep(0.3, 0.32, d)' }],
      result: 'vec3(1.0 - edge)', outputType: 'vec3',
    });
    const m = nodeCardModel(n, getNodeDefinition('exprNode')!);
    expect(m.meaningOf).toBe('float edge = smoothstep(0.3, 0.32, d)');
    expect(m.meaning).toBeTruthy();
  });

  it('a Custom Function: its return expression', () => {
    const n = node('customFn', { inputs: [{ name: 'x', type: 'float' }], body: 'float y = x * 2.0;\nreturn sin(y) * 0.5 + 0.5;' });
    expect(mainExpression(n)).toBe('sin(y) * 0.5 + 0.5');
    expect(nodeCardModel(n, getNodeDefinition('customFn')!).meaning).toMatch(/0…1|0 to 1|0 and 1/);
  });

  it('no meaning line when nothing applies', () => {
    const m = nodeCardModel(node('uv'), getNodeDefinition('uv')!);
    expect(m.meaning).toBeUndefined();
    expect(m.description).toBeTruthy();
  });
});
