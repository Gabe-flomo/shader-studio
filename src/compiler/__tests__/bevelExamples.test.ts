/**
 * The SDF Bevel examples (store/bevelExamples.ts): every one builds, compiles with no errors to GLSL the parser
 * accepts, carries a note on every node, uses SDF Bevel, and reads its Distance through a field function (so the
 * slope is exact and the drop shadow is drawn), never through dFdx.
 */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} });
});

import { parser } from '@shaderfrog/glsl-parser';
import { compileGraph } from '../graphCompiler';
import { buildBevelExamples, BEVEL_EXAMPLE_KEYS, BEVEL_SHOWCASE_KEYS } from '../../store/bevelExamples';
import { EXAMPLE_FOLDERS, EXAMPLE_INDEX, RETIRED_EXAMPLE_KEYS } from '../../store/exampleIndex';
import { EXAMPLE_GRAPHS } from '../../store/exampleGraphs';

const parses = (fs: string) => { try { parser.parse(fs.replace(/^#version.*$/m, ''), { quiet: true }); return null; } catch (e) { return (e as Error).message.split('\n')[0]; } };

describe('SDF Bevel examples', () => {
  const ex = buildBevelExamples();
  it('there are six, all in the Bevel folder, indexed and in the example graphs', () => {
    expect(Object.keys(ex).sort()).toEqual([...BEVEL_EXAMPLE_KEYS].sort());
    expect(BEVEL_SHOWCASE_KEYS).toHaveLength(6);
    expect(EXAMPLE_FOLDERS.find(f => f.label === 'Bevel')?.keys).toEqual(BEVEL_SHOWCASE_KEYS);
    for (const k of BEVEL_EXAMPLE_KEYS) {
      expect(EXAMPLE_INDEX[k], k).toBeTruthy();
      expect(EXAMPLE_GRAPHS[k], k).toBeTruthy();
    }
    expect(BEVEL_EXAMPLE_KEYS.filter(k => RETIRED_EXAMPLE_KEYS.includes(k))).toEqual([]);
  });
  it('between them they use Chamfer, Round, Pillow, Steps and Invert', () => {
    const bevels = Object.values(ex).flatMap(g => g.nodes.filter(nd => nd.type === 'sdfBevel'));
    const profiles = new Set(bevels.map(b => b.params.profile));
    for (const pr of ['chamfer', 'round', 'pillow', 'steps']) expect(profiles.has(pr), pr).toBe(true);
    expect(bevels.some(b => b.params.invert === true)).toBe(true);
  });
  for (const k of BEVEL_EXAMPLE_KEYS) {
    it(`${k} compiles, parses, and explains every node`, () => {
      const g = ex[k];
      const r = compileGraph({ nodes: g.nodes });
      expect(r.errors ?? [], k).toEqual([]);
      expect(parses(r.fragmentShader), k).toBeNull();
      for (const nd of g.nodes) {
        if (nd.type === 'output') continue;
        expect(typeof nd.params.__comment === 'string' && (nd.params.__comment as string).length > 10, `${k}: ${nd.id}`).toBe(true);
      }
      expect(g.nodes.some(nd => nd.type === 'sdfBevel'), k).toBe(true);
      expect(r.fragmentShader, k).toMatch(/^float fieldfn_\w+\(vec2 g_uv/m);
      expect(r.fragmentShader, k).not.toContain('dFdx');
      expect(g.play?.notes, k).toContain('**What it shows.**');
      for (const c of g.play?.controls ?? []) expect(r.paramBindings[c.target], `${k}: ${c.target}`).toMatch(/^u_p_/);
    });
  }
});
