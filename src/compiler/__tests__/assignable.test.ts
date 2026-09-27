/**
 * Which cards offer the assign operator (nodes/assignable.ts), and graphs that
 * set one on a card that no longer offers it still compile with it.
 */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} });
});
import type { GraphNode } from '../../types/nodeGraph';
import { compileGraph } from '../graphCompiler';
import { getNodeDefinition, NODE_REGISTRY, resolveNodeAliases } from '../../nodes/definitions';
import { isAssignable, isAssignableDef, legacyAssignOp } from '../../nodes/assignable';
import { EXAMPLE_GRAPHS } from '../../store/exampleGraphs';

const bare = (type: string, extra: Partial<GraphNode> = {}): GraphNode => {
  const def = getNodeDefinition(type)!;
  return { id: 'n', type, position: { x: 0, y: 0 }, inputs: {}, outputs: def.outputs, params: { ...(def.defaultParams ?? {}) }, ...extra };
};

describe('assign operator menu', () => {
  it.each(['add', 'subtract', 'multiply', 'divide', 'sin', 'mix', 'smoothstep', 'palette', 'light', 'volumeGlow', 'sdfCircle'].filter(t => getNodeDefinition(t)))('%s offers it', type => {
    expect(isAssignable(bare(type))).toBe(true);
  });

  it.each(['exprNode', 'customFn', 'floatWarp', 'gridLayout', 'gridPattern', 'constants', 'data', 'uv', 'time', 'mandelbrot', 'rayMarch', 'group', 'output', 'loopIndex', 'loopCarry'])('%s does not', type => {
    expect(isAssignable(bare(type))).toBe(false);
  });

  it('every multi-output card is left out unless it says otherwise', () => {
    const offered = Object.values(NODE_REGISTRY).filter(d => Object.keys(d.outputs).length > 1 && isAssignableDef(d)).map(d => d.type);
    expect(offered).toEqual(['light']);
  });

  it('a stored operator on a card without the menu is kept and reported for the badge', () => {
    expect(legacyAssignOp(bare('exprNode', { assignOp: '+=' }))).toBe('+=');
    expect(legacyAssignOp(bare('exprNode', { assignOp: '=' }))).toBeNull();
    expect(legacyAssignOp(bare('multiply', { assignOp: '+=' }))).toBeNull();
    expect(legacyAssignOp(bare('output', { assignOp: '+=' }))).toBeNull();
  });
});

describe('bundled examples with += on an Expression Block', () => {
  const walk = (nodes: GraphNode[], visit: (n: GraphNode) => void) => {
    for (const n of nodes) { visit(n); const sg = n.params?.subgraph as { nodes?: GraphNode[] } | undefined; if (sg?.nodes) walk(sg.nodes, visit); }
  };
  it.each(['fcTheScreen', 'fcAtlantic'])('%s still accumulates', key => {
    const g = EXAMPLE_GRAPHS[key];
    const acc: GraphNode[] = [];
    walk(g.nodes, n => { if (n.type === 'exprNode' && n.assignOp === '+=') acc.push(n); });
    expect(acc.length).toBeGreaterThan(0);
    expect(acc.every(n => legacyAssignOp(n) === '+=')).toBe(true);
    const r = compileGraph({ nodes: resolveNodeAliases(g.nodes, getNodeDefinition) });
    expect(r.success).toBe(true);
    expect(r.fragmentShader).toMatch(/\w+ \+= \w+;/);
  });
});
