/**
 * The Convolve examples (store/convolveExamples.ts): every one builds, compiles with no errors to GLSL the parser
 * accepts, carries a note on every node, uses Convolve, and reads its neighbours the way its notes say (a field
 * function, or a texture at texel offsets).
 */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} });
});

import { parser } from '@shaderfrog/glsl-parser';
import { compileGraph } from '../graphCompiler';
import { buildConvolveExamples, CONVOLVE_EXAMPLE_KEYS, CONVOLVE_SHOWCASE_KEYS } from '../../store/convolveExamples';
import { EXAMPLE_FOLDERS, RETIRED_EXAMPLE_KEYS } from '../../store/exampleIndex';

const parses = (fs: string) => { try { parser.parse(fs.replace(/^#version.*$/m, ''), { quiet: true }); return null; } catch (e) { return (e as Error).message.split('\n')[0]; } };

describe('Convolve examples', () => {
  const ex = buildConvolveExamples();
  it('there are six, all in the Convolve folder', () => {
    expect(Object.keys(ex).sort()).toEqual([...CONVOLVE_EXAMPLE_KEYS].sort());
    expect(EXAMPLE_FOLDERS.find(f => f.label === 'Convolve')?.keys).toEqual(CONVOLVE_SHOWCASE_KEYS);
    expect(CONVOLVE_SHOWCASE_KEYS).toHaveLength(6);
    expect(CONVOLVE_EXAMPLE_KEYS.filter(k => RETIRED_EXAMPLE_KEYS.includes(k))).toEqual([]);
  });
  it('between them they use six presets and both sources', () => {
    const cv = Object.values(ex).flatMap(g => g.nodes.filter(nd => nd.type === 'convolve'));
    expect(new Set(cv.map(nd => nd.params.preset)).size).toBe(6);
    expect(cv.some(nd => nd.inputs.texture?.connection)).toBe(true);
    expect(cv.some(nd => nd.inputs.colour?.connection)).toBe(true);
  });
  for (const k of CONVOLVE_EXAMPLE_KEYS) {
    it(`${k} compiles, parses, and explains every node`, () => {
      const g = ex[k];
      const r = compileGraph({ nodes: g.nodes });
      expect(r.errors ?? [], k).toEqual([]);
      expect(parses(r.fragmentShader), k).toBeNull();
      for (const nd of g.nodes) {
        expect(typeof nd.params.__comment === 'string' && (nd.params.__comment as string).length > 10, `${k}: ${nd.id}`).toBe(true);
      }
      const cv = g.nodes.find(nd => nd.type === 'convolve')!;
      expect(cv, k).toBeTruthy();
      if (cv.inputs.texture?.connection) expect(r.fragmentShader, k).toMatch(/_px \* /);
      else expect(r.fragmentShader, k).toMatch(/^vec3 fieldfn_\w+\(vec2 g_uv/m);
      // Every Play control drives a live uniform of the graph.
      for (const c of g.play?.controls ?? []) {
        const target = (c as { target?: string }).target ?? '';
        if (target.includes('::')) expect(r.paramBindings[target], `${k}: ${target}`).toMatch(/^u_p_/);
      }
      expect(g.play?.notes, k).toContain('**What it shows.**');
    });
  }
});
