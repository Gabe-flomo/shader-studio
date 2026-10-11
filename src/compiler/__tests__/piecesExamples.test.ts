/**
 * The Pieces examples (store/piecesExamples.ts, docs/pieces.md) compile, their Play controls are live,
 * and the 3D one reads the picture inside the repeated scene.
 */
import { describe, expect, it, vi } from 'vitest';
vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});
import { compileGraph } from '../graphCompiler';
import { getNodeDefinition, resolveNodeAliases } from '../../nodes/definitions';
import { EXAMPLE_GRAPHS } from '../../store/exampleGraphs';
import { PIECES_EXAMPLE_KEYS } from '../../store/piecesExampleIndex';
import { collectPlayCandidates } from '../../play/playControls';

describe('Pieces examples', () => {
  it.each(PIECES_EXAMPLE_KEYS)('%s compiles and its Play controls are live', key => {
    const nodes = resolveNodeAliases(EXAMPLE_GRAPHS[key].nodes, getNodeDefinition);
    const r = compileGraph({ nodes });
    expect(r.errors ?? []).toEqual([]);
    const live = new Set(collectPlayCandidates(nodes, r.paramBindings).map(c => c.target));
    for (const c of EXAMPLE_GRAPHS[key].play!.controls) expect(live.has(c.target), `${c.label} → ${c.target}`).toBe(true);
    expect(EXAMPLE_GRAPHS[key].images?.photo).toMatch(/^data:image\//);
  });

  it('the balls read the picture inside the repeated scene function', () => {
    const r = compileGraph({ nodes: resolveNodeAliases(EXAMPLE_GRAPHS.piecesBalls3D.nodes, getNodeDefinition) });
    const fs = r.fragmentShader;
    const fn = fs.slice(fs.indexOf('float mapScene_'), fs.indexOf('\n}', fs.indexOf('float mapScene_')));
    expect(fn).toMatch(/textureLod\(u_tex_\w+, clamp\(/);
    // The sampler is a global, never a parameter of the scene function.
    expect(fn.split('\n')[0]).not.toMatch(/texture|sampler/);
    expect(fs).toContain('g_cell3 = id;');
  });
});
