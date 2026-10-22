/**
 * The Advect examples (store/advectExamples.ts): every one builds, compiles with no errors to GLSL the parser
 * accepts (the picture and every Pass, Advect's own buffer among them), carries a note on every node, uses Advect,
 * and every Play control drives a live uniform.
 */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} });
});

import { parser } from '@shaderfrog/glsl-parser';
import { compileGraph } from '../graphCompiler';
import { buildAdvectExamples, ADVECT_EXAMPLE_KEYS, ADVECT_SHOWCASE_KEYS } from '../../store/advectExamples';
import { EXAMPLE_FOLDERS, EXAMPLE_INDEX, RETIRED_EXAMPLE_KEYS } from '../../store/exampleIndex';

const parses = (fs: string) => { try { parser.parse(fs.replace(/^#version.*$/m, ''), { quiet: true }); return null; } catch (e) { return (e as Error).message.split('\n')[0]; } };

describe('Advect examples', () => {
  const ex = buildAdvectExamples();
  it('there are six, all in the Advect folder and the example index', () => {
    expect(Object.keys(ex).sort()).toEqual([...ADVECT_EXAMPLE_KEYS].sort());
    expect(EXAMPLE_FOLDERS.find(f => f.label === 'Advect')?.keys).toEqual(ADVECT_SHOWCASE_KEYS);
    expect(ADVECT_SHOWCASE_KEYS).toHaveLength(6);
    for (const k of ADVECT_EXAMPLE_KEYS) expect(EXAMPLE_INDEX[k]?.label, k).toBe(ex[k].label);
    expect(ADVECT_EXAMPLE_KEYS.filter(k => RETIRED_EXAMPLE_KEYS.includes(k))).toEqual([]);
  });
  it('between them they use every Mode, a texture and a colour Source, a wired and the built-in Flow, and a mask', () => {
    const av = Object.values(ex).flatMap(g => g.nodes.filter(nd => nd.type === 'advect'));
    expect(new Set(av.map(nd => nd.params.mode))).toEqual(new Set(['mix', 'add', 'max']));
    expect(av.some(nd => nd.inputs.texture?.connection)).toBe(true);
    expect(av.some(nd => nd.inputs.colour?.connection)).toBe(true);
    expect(av.some(nd => nd.inputs.flow?.connection)).toBe(true);
    expect(av.some(nd => !nd.inputs.flow?.connection)).toBe(true);
    expect(av.some(nd => nd.inputs.mask?.connection)).toBe(true);
  });
  for (const k of ADVECT_EXAMPLE_KEYS) {
    it(`${k} compiles, parses, and explains every node`, () => {
      const g = ex[k];
      const r = compileGraph({ nodes: g.nodes });
      expect(r.errors ?? [], k).toEqual([]);
      expect(parses(r.fragmentShader), k).toBeNull();
      for (const p of r.passes ?? []) expect(parses(p.fragmentShader), `${k}: pass ${p.slug}`).toBeNull();
      for (const nd of g.nodes) {
        expect(typeof nd.params.__comment === 'string' && (nd.params.__comment as string).length > 10, `${k}: ${nd.id}`).toBe(true);
      }
      const av = g.nodes.find(nd => nd.type === 'advect')!;
      expect(av, k).toBeTruthy();
      // Advect is its own buffer Pass that keeps its Previous.
      const pass = r.passes!.find(p => p.nodeId === av.id)!;
      expect(pass.previous, k).toBe(true);
      expect(pass.readsPrevious, k).toContain(pass.slug);
      // Every Play control drives a live uniform of the graph.
      for (const c of g.play?.controls ?? []) {
        const target = (c as { target?: string }).target ?? '';
        if (target.includes('::')) expect(r.paramBindings[target], `${k}: ${target}`).toMatch(/^u_p_/);
      }
      expect(g.play?.notes, k).toContain('**What it shows.**');
    });
  }
});
