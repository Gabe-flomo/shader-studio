/**
 * The Kuwahara examples (store/kuwaharaExamples.ts): every one builds, compiles with no errors to GLSL the parser
 * accepts, carries a note on every node, uses Kuwahara, reads the way its notes say (a texture at texel offsets, or
 * a field function), and its Play controls drive live uniforms.
 */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} });
});

import { parser } from '@shaderfrog/glsl-parser';
import { compileGraph } from '../graphCompiler';
import { buildKuwaharaExamples, KUWAHARA_EXAMPLE_KEYS, KUWAHARA_SHOWCASE_KEYS } from '../../store/kuwaharaExamples';
import { EXAMPLE_FOLDERS, RETIRED_EXAMPLE_KEYS } from '../../store/exampleIndex';

const parses = (fs: string) => { try { parser.parse(fs.replace(/^#version.*$/m, ''), { quiet: true }); return null; } catch (e) { return (e as Error).message.split('\n')[0]; } };

describe('Kuwahara examples', () => {
  const ex = buildKuwaharaExamples();
  it('there are six, all in the Painterly folder', () => {
    expect(Object.keys(ex).sort()).toEqual([...KUWAHARA_EXAMPLE_KEYS].sort());
    expect(EXAMPLE_FOLDERS.find(f => f.label === 'Painterly')?.keys).toEqual(KUWAHARA_SHOWCASE_KEYS);
    expect(KUWAHARA_SHOWCASE_KEYS).toHaveLength(6);
    expect(KUWAHARA_EXAMPLE_KEYS.filter(k => RETIRED_EXAMPLE_KEYS.includes(k))).toEqual([]);
  });
  it('between them they use every Kind and both sources', () => {
    const kw = Object.values(ex).flatMap(g => g.nodes.filter(nd => nd.type === 'kuwahara'));
    expect(new Set(kw.map(nd => nd.params.kind))).toEqual(new Set(['classic', 'generalised', 'anisotropic']));
    expect(kw.some(nd => nd.inputs.texture?.connection)).toBe(true);
    expect(kw.some(nd => nd.inputs.colour?.connection)).toBe(true);
  });
  for (const k of KUWAHARA_EXAMPLE_KEYS) {
    it(`${k} compiles, parses, and explains every node`, () => {
      const g = ex[k];
      const r = compileGraph({ nodes: g.nodes });
      expect(r.errors ?? [], k).toEqual([]);
      expect(parses(r.fragmentShader), k).toBeNull();
      for (const nd of g.nodes) {
        expect(typeof nd.params.__comment === 'string' && (nd.params.__comment as string).length > 10, `${k}: ${nd.id}`).toBe(true);
      }
      const kws = g.nodes.filter(nd => nd.type === 'kuwahara');
      expect(kws.length, k).toBeGreaterThan(0);
      for (const kw of kws) {
        if (kw.inputs.texture?.connection) expect(r.fragmentShader, k).toMatch(/_px \* /);
        else expect(r.fragmentShader, k).toMatch(/^vec3 fieldfn_\w+\(vec2 g_uv/m);
      }
      // Every Play control drives a live uniform of the graph.
      expect(g.play?.controls.length, k).toBeGreaterThan(0);
      for (const c of g.play?.controls ?? []) {
        const target = (c as { target?: string }).target ?? '';
        if (target.includes('::')) expect(r.paramBindings[target], `${k}: ${target}`).toMatch(/^u_p_/);
      }
      expect(g.play?.notes, k).toContain('**What it shows.**');
    });
  }
});
