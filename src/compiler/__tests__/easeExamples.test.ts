/**
 * The Ease & Motion folder (store/easeExamples.ts, docs/ease-node.md): every example is listed and registered,
 * uses Ease, compiles to GLSL the parser accepts, carries a note on every node, and its Play controls aim at
 * live params of its own graph.
 */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} });
});

import { parser } from '@shaderfrog/glsl-parser';
import { compileGraph } from '../graphCompiler';
import type { CompilationResult } from '../types';
import { buildEaseExamples, EASE_EXAMPLE_KEYS } from '../../store/easeExamples';
import { unfiledIn } from '../../store/exampleIndex';
import { EXAMPLE_GRAPHS } from '../../store/exampleGraphs';

const parses = (fs: string) => { try { parser.parse(fs.replace(/^#version.*$/m, ''), { quiet: true }); return null; } catch (e) { return (e as Error).message.split('\n')[0]; } };

describe('the Ease & Motion examples', () => {
  const built = buildEaseExamples();
  it('are a folder of their own, all registered', () => {
    expect(EASE_EXAMPLE_KEYS.length).toBeGreaterThanOrEqual(6);
    expect(unfiledIn('Ease & Motion', EASE_EXAMPLE_KEYS)).toEqual([]);
    expect(Object.keys(built)).toEqual(EASE_EXAMPLE_KEYS);
    for (const k of EASE_EXAMPLE_KEYS) expect(EXAMPLE_GRAPHS[k]).toBeDefined();
  });
  it.each(EASE_EXAMPLE_KEYS)('%s uses Ease, compiles and parses, and every node has a note', key => {
    const g = built[key];
    expect(g.nodes.some(nd => nd.type === 'ease')).toBe(true);
    const r = compileGraph({ nodes: g.nodes }) as CompilationResult;
    expect(r.errors ?? []).toEqual([]);
    expect(r.success).toBe(true);
    expect(parses(r.fragmentShader)).toBeNull();
    for (const nd of g.nodes) expect(typeof nd.params.__comment === 'string' && (nd.params.__comment as string).length > 10, nd.id).toBe(true);
    // Play controls aim at live params of nodes that exist.
    for (const c of g.play?.controls ?? []) {
      const [id, param] = c.target.split('::');
      const nd = g.nodes.find(x => x.id === id);
      expect(nd, c.target).toBeDefined();
      expect(r.paramBindings[`${id}::${param}`], c.target).toBeTruthy();
    }
  });
});
