/**
 * The Normal from Height and Dither examples (store/surfaceExamples.ts): every one builds, compiles with no errors
 * to GLSL the parser accepts, carries a note on every node, and uses the node it is about; the height chains that
 * can be functions are read through a field function.
 */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} });
});

import { parser } from '@shaderfrog/glsl-parser';
import { compileGraph } from '../graphCompiler';
import { buildSurfaceExamples, SURFACE_EXAMPLE_KEYS, SURFACE_SHOWCASE_KEYS } from '../../store/surfaceExamples';
import { EXAMPLE_FOLDERS, RETIRED_EXAMPLE_KEYS } from '../../store/exampleIndex';

const parses = (fs: string) => { try { parser.parse(fs.replace(/^#version.*$/m, ''), { quiet: true }); return null; } catch (e) { return (e as Error).message.split('\n')[0]; } };

describe('Normal from Height and Dither examples', () => {
  const ex = buildSurfaceExamples();
  it('there are eight, all in the Bump & Dither folder', () => {
    expect(Object.keys(ex).sort()).toEqual([...SURFACE_EXAMPLE_KEYS].sort());
    expect(EXAMPLE_FOLDERS.find(f => f.label === 'Bump & Dither')?.keys).toEqual(SURFACE_SHOWCASE_KEYS);
    expect(SURFACE_SHOWCASE_KEYS).toHaveLength(8);
    expect(SURFACE_EXAMPLE_KEYS.filter(k => RETIRED_EXAMPLE_KEYS.includes(k))).toEqual([]);
  });
  for (const k of SURFACE_EXAMPLE_KEYS) {
    it(`${k} compiles, parses, and explains every node`, () => {
      const g = ex[k];
      const r = compileGraph({ nodes: g.nodes });
      expect(r.errors ?? [], k).toEqual([]);
      expect(parses(r.fragmentShader), k).toBeNull();
      for (const nd of g.nodes) {
        if (nd.type === 'output') continue;
        expect(typeof nd.params.__comment === 'string' && (nd.params.__comment as string).length > 10, `${k}: ${nd.id}`).toBe(true);
      }
      const about = k.startsWith('bump') ? 'normalFromHeight' : 'dither';
      expect(g.nodes.some(nd => nd.type === about), k).toBe(true);
      // Every bump example's height chain is a pure function of position (noise, rings, a picture, a shape).
      if (about === 'normalFromHeight') {
        expect(r.fragmentShader, k).toMatch(/^float fieldfn_\w+\(vec2 g_uv/m);
        expect(r.fragmentShader, k).not.toContain('dFdx');
      }
      expect(g.play?.notes, k).toContain('**What it shows.**');
    });
  }
});
