/**
 * "Explain this node" (docs/explain-model.md): the retrieval picks only what the question needs, from fixture nodes.
 */
import { describe, expect, it } from 'vitest';
import type { GraphNode } from '../../types/nodeGraph';
import { changedParams, nodeCode, promptForNode, NODE_SYSTEM_PROMPT } from '../nodePrompt';

const node = (id: string, type: string, extra: Partial<GraphNode> = {}): GraphNode => ({
  id, type, position: { x: 0, y: 0 }, inputs: {}, outputs: {}, params: {}, ...extra,
});

const graph = (): GraphNode[] => [
  node('uv', 'uv', { outputs: { uv: { type: 'vec2', label: 'UV' } } }),
  node('ring', 'exprNode', {
    inputs: { p: { type: 'vec2', label: 'p', connection: { nodeId: 'uv', outputKey: 'uv' } } },
    params: { label: 'Ring', inputs: [{ name: 'p', type: 'vec2', slider: null }], lines: [{ lhs: 'float d', op: '=', rhs: 'abs(length(p) - 0.3)' }], result: 'exp(-d * 8.0)' },
  }),
  node('out', 'output', { inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'ring', outputKey: 'result' } } } }),
  node('blur', 'blur', { params: { radius: 12, quality: 3 } }),
];

describe('changed settings', () => {
  it('lists only what differs from a fresh node, and skips bookkeeping keys', () => {
    const c = changedParams({ radius: 12, quality: 3, label: 'x', __fold: 1 }, { radius: 4, quality: 3 });
    expect(c).toEqual(['radius = 12 (a fresh node has 4)']);
  });
  it('caps the list', () => {
    const many = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`k${i}`, i]));
    expect(changedParams(many)).toHaveLength(10);
  });
});

describe('code of code nodes', () => {
  it('an Expression Block’s lines then Return; other nodes have none', () => {
    expect(nodeCode(graph()[1])).toBe('float d = abs(length(p) - 0.3)\nreturn exp(-d * 8.0)');
    expect(nodeCode(graph()[0])).toBe('');
  });
});

describe('the node prompt', () => {
  const namer = (t: string) => ({ uv: 'UV', exprNode: 'Expression Block', output: 'Output', blur: 'Blur' } as Record<string, string>)[t];

  it('carries help, stage, neighbours, changed settings and the code, and asks for a short answer', () => {
    const g = graph();
    const p = promptForNode(g[1], g, { label: 'Expression Block', category: 'Math', help: 'Write a few lines of maths.', defaultParams: {} }, namer);
    const user = p.messages[1].content;
    expect(p.messages[0].content).toBe(NODE_SYSTEM_PROMPT);
    expect(NODE_SYSTEM_PROMPT).toMatch(/at most 3 short sentences/);
    expect(user).not.toContain('Ring'); // the user's label for the node is never told to the model
    expect(user).toContain('What the node is for (its help): Write a few lines of maths.');
    expect(user).toContain('Fed by: UV -> p');
    expect(user).toContain('Feeds: Output (from result)');
    expect(user).toContain('Its code:\nfloat d = abs(length(p) - 0.3)\nreturn exp(-d * 8.0)');
    expect(p.used.some(u => u.startsWith('Node type: Expression Block'))).toBe(true);
    expect(p.maxTokens).toBeLessThanOrEqual(200);
  });

  it('a non-code node: its changed settings and stage, no code', () => {
    const g = graph();
    const p = promptForNode(g[3], g, { label: 'Blur', category: 'Post', defaultParams: { radius: 4, quality: 3 } }, namer);
    const user = p.messages[1].content;
    expect(user).toContain('Settings changed from the defaults: radius = 12 (a fresh node has 4)');
    expect(user).toContain('Fed by: nothing wired');
    expect(user).not.toContain('Its code');
  });

  it('is deterministic', () => {
    const g = graph();
    const d = { label: 'Expression Block' };
    expect(promptForNode(g[1], g, d, namer).context).toBe(promptForNode(g[1], g, d, namer).context);
  });
});
