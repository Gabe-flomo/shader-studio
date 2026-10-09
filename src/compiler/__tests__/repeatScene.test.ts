/**
 * Repeat Scene (docs/repeat-scene.md): the wrapper scene function in each Neighbours mode, Repeat
 * Cell's global, and the example.
 */
import { describe, expect, it, vi } from 'vitest';
vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});
import { compileGraph } from '../graphCompiler';
import { getNodeDefinition, resolveNodeAliases } from '../../nodes/definitions';
import { EXAMPLE_GRAPHS } from '../../store/exampleGraphs';
import { REPEAT_SCENE_EXAMPLE_KEYS } from '../../store/repeatSceneExampleIndex';
import { collectPlayCandidates } from '../../play/playControls';
import type { GraphNode } from '../../types/nodeGraph';

const graph = (mode?: string): GraphNode[] => resolveNodeAliases(EXAMPLE_GRAPHS.repeatSceneBubbles.nodes, getNodeDefinition)
  .map(nd => (nd.type === 'repeatScene' && mode ? { ...nd, params: { ...nd.params, neighbours: mode } } : nd));
const fnOf = (fs: string) => fs.slice(fs.indexOf('float repScene_'), fs.indexOf('\n}', fs.indexOf('float repScene_')));

describe('Repeat Scene', () => {
  it.each(REPEAT_SCENE_EXAMPLE_KEYS)('%s compiles and its Play controls are live', key => {
    const nodes = resolveNodeAliases(EXAMPLE_GRAPHS[key].nodes, getNodeDefinition);
    const r = compileGraph({ nodes });
    expect(r.errors ?? []).toEqual([]);
    const live = new Set(collectPlayCandidates(nodes, r.paramBindings).map(c => c.target));
    for (const c of EXAMPLE_GRAPHS[key].play!.controls) expect(live.has(c.target), `${c.label} → ${c.target}`).toBe(true);
  });

  it.each(['off', 'wall', 'near8', 'skip'])('neighbours=%s compiles, sets the cell, adds the floor once', mode => {
    const r = compileGraph({ nodes: graph(mode) });
    expect(r.errors ?? []).toEqual([]);
    const fn = fnOf(r.fragmentShader);
    expect(r.fragmentShader).toContain('vec3 g_cell3 = vec3(0.0);');
    expect(fn).toContain('g_cell3 = id;');
    expect(fn.match(/mapScene_\w+\(p\)/g)?.length).toBe(1); // the floor, unrepeated
    expect(fn.includes('for (int k = 1; k < 8; k++)')).toBe(mode === 'near8' || mode === 'skip');
    expect(fn.includes('if (d > min(wl.x')).toBe(mode === 'skip');
    expect(fn.includes('0.08 * min(cs.x')).toBe(mode === 'wall');
  });

  it('Repeat Cell alone (no Repeat Scene) still compiles, reading zeros', () => {
    const nodes = graph().map(nd => (nd.type === 'marchLoopGroup' ? { ...nd, inputs: { ...nd.inputs, scene: { ...nd.inputs.scene, connection: { nodeId: 'bubble', outputKey: 'scene' } } } } : nd));
    const r = compileGraph({ nodes });
    expect(r.errors ?? []).toEqual([]);
    expect(r.fragmentShader).toContain('vec3 g_cell3 = vec3(0.0);');
  });

  it.each([
    ['union', 'd = min(d, mapScene_'],
    ['smooth', 'smin(d, dg,'],
    ['carve', 'max(d, -dg) : -smin(-d, dg,'],
    ['carveInto', 'max(dg, -d) : -smin(-dg, d,'],
    ['intersect', 'max(d, dg) : -smin(-d, -dg,'],
  ])('combine=%s with Not repeated', (combine, line) => {
    const nodes = graph().map(nd => (nd.type === 'repeatScene' ? { ...nd, params: { ...nd.params, combine } } : nd));
    const r = compileGraph({ nodes });
    expect(r.errors ?? []).toEqual([]);
    expect(fnOf(r.fragmentShader)).toContain(line);
  });

  it('Repeat Cell Centre is the cell times the spacing', () => {
    const nodes = resolveNodeAliases(EXAMPLE_GRAPHS.repeatSceneCentrepiece.nodes, getNodeDefinition);
    const r = compileGraph({ nodes });
    expect(r.errors ?? []).toEqual([]);
    expect(r.fragmentShader).toContain('vec3 g_cellSize3 = vec3(0.0);');
    expect(fnOf(r.fragmentShader)).toContain('g_cellSize3 = cs;');
    expect(r.fragmentShader).toMatch(/_ctr\s+= \w+_cell \* g_cellSize3;/);
  });
});
