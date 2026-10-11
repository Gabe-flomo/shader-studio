/**
 * Muting in the Grid builder (builders/mute.ts, docs/grid-builder.md, "Muting"): a muted warp is
 * still built, its node gated by a live uniform (the same shader muted or not); a muted shape or
 * pattern is left out of the generated code; a mute is one undo step and survives Build and reopening.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});
import type { GraphNode } from '../../types/nodeGraph';
import { compileGraph } from '../../compiler/graphCompiler';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { useBuilderWindows } from '../../builders/windows';
import { editBuiltScene } from '../../builders/open';
import { BLOCK_LIBRARY, blockFromEntry } from '../../sceneBuilder2d/blockLibrary';
import { MUTE_FROM_PARAM, MUTE_PARAM, soloIn } from '../../builders/mute';
import { buildStandaloneGrid, GS_ROLE } from '../build';
import { buildFromGridBuilder } from '../actions';
import { gridMetaOf } from '../apply';
import { useGridBuilder } from '../store';
import { liveGridSpec, newShape, placeCell, starterGridScene, type GridSceneSpec } from '../spec';

const compile = (spec: GridSceneSpec) => {
  const g = buildStandaloneGrid(spec);
  const r = compileGraph({ nodes: g.nodes });
  expect(r.success, String(r.errors)).toBe(true);
  return { g, r };
};
const role = (nodes: GraphNode[], r: string) => nodes.find(n => n.params[GS_ROLE] === r);
const hasMuteParam = (nodes: GraphNode[]) => nodes.some(n => MUTE_PARAM in n.params);

function warped(muted?: boolean): GridSceneSpec {
  const s = starterGridScene();
  s.warps = [blockFromEntry(BLOCK_LIBRARY[0]), { ...blockFromEntry(BLOCK_LIBRARY[1]), ...(muted === undefined ? {} : { muted }) }];
  return s;
}

function twoShapes(): GridSceneSpec {
  const s = starterGridScene();
  s.shapes.push(newShape('B', { kind: 'star' }));
  placeCell(s, 0, 0, 'B');
  s.rules = [{ id: 'r1', on: true, when: { kind: 'column', a: 'B', x: 0 }, do: { kind: 'colour', color: [1, 0, 0] } }];
  s.pattern = { ...s.pattern, kind: 'ripple', fill: 'B' };
  return s;
}

describe('muting in the Grid builder', () => {
  it('a muted warp is bypassed by a uniform: the same shader, its point passed through', () => {
    const on = compile(warped(false));
    const off = compile(warped(true));
    expect(off.r.fragmentShader).toBe(on.r.fragmentShader);
    const u = Object.keys(off.r.paramUniforms).find(k => k.endsWith('_mute'))!;
    expect(u).toBeTruthy();
    expect(off.r.paramUniforms[u]).toBe(1);
    expect(on.r.paramUniforms[u]).toBe(0);
    expect(off.r.fragmentShader).toMatch(new RegExp(`mix\\([^;]*${u}\\)`));
    // Bypassed equals the chain without it: the second warp passes the first warp's point on.
    const w2 = role(off.g.nodes, 'w2')!;
    expect(w2.params[MUTE_PARAM]).toBe(1);
    expect(w2.params[MUTE_FROM_PARAM]).toBe('uv');
    expect(w2.inputs.uv.connection).toEqual({ nodeId: role(off.g.nodes, 'w1')!.id, outputKey: 'result' });
  });

  it('never muted: no mute params anywhere', () => {
    expect(hasMuteParam(compile(warped()).g.nodes)).toBe(false);
    expect(hasMuteParam(compile(twoShapes()).g.nodes)).toBe(false);
    expect(liveGridSpec(twoShapes())).toEqual(twoShapes());
  });

  it('a muted shape is left out: the build equals the scene without it, its settings kept', () => {
    const s = twoShapes();
    s.shapes[1].muted = true;
    const { g } = compile(s);
    expect(role(g.nodes, 'B')).toBeUndefined();
    const without = twoShapes();
    without.shapes.pop();
    without.cells = without.cells.filter(c => c.s !== 'B');
    without.rules = [];
    without.pattern.fill = null;
    const grid = role(g.nodes, 'grid')!;
    expect(grid.params.glslFunctions).toBe(role(compile(without).g.nodes, 'grid')!.params.glslFunctions);
    // The spec itself keeps B, its cells, its rule and the fill.
    expect(s.shapes).toHaveLength(2);
    expect(s.cells.some(c => c.s === 'B')).toBe(true);
    expect(s.rules).toHaveLength(1);
    expect(s.pattern.fill).toBe('B');
    // Unmuted: back as it was.
    s.shapes[1].muted = false;
    expect(role(compile(s).g.nodes, 'grid')!.params.glslFunctions).toBe(role(compile(twoShapes()).g.nodes, 'grid')!.params.glslFunctions);
  });

  it('a muted pattern builds as no pattern', () => {
    const s = twoShapes();
    s.pattern.muted = true;
    const none = twoShapes();
    none.pattern = { ...none.pattern, kind: 'none', fill: null };
    expect(role(compile(s).g.nodes, 'grid')!.params.glslFunctions).toBe(role(compile(none).g.nodes, 'grid')!.params.glslFunctions);
    expect(s.pattern.kind).toBe('ripple');
  });

  it('solo mutes the other shapes', () => {
    const s = twoShapes();
    soloIn(s.shapes, 'B');
    expect(s.shapes.map(x => !!x.muted)).toEqual([true, false]);
    compile(s);
  });
});

describe('a mute in the builder: undo, Build and reopen', () => {
  beforeEach(() => {
    useNodeGraphStore.setState({ nodes: [{ id: 'out', type: 'output', position: { x: 600, y: 0 }, inputs: { color: { type: 'vec3', label: 'Color' } } as GraphNode['inputs'], outputs: {}, params: {} }], activeGroupPath: [], selectedNodeId: null, selectedNodeIds: [] });
    useBuilderWindows.setState({ gridRules: null, sceneShell: null });
    useGridBuilder.setState({ open: false, targetSceneId: null });
  });

  it('a mute is one undo step and survives Build + reopen', () => {
    useGridBuilder.getState().openWith(warped());
    const before = useGridBuilder.getState().spec;
    useGridBuilder.getState().edit(d => { d.warps[1].muted = !d.warps[1].muted; });
    useGridBuilder.getState().edit(d => { d.shapes[0].muted = true; d.shapes.push(newShape('B')); placeCell(d, 1, 1, 'B'); });
    useGridBuilder.getState().undo();
    expect(useGridBuilder.getState().spec.warps[1].muted).toBe(true);
    useGridBuilder.getState().undo();
    expect(useGridBuilder.getState().spec).toEqual(before);
    useGridBuilder.getState().redo();

    const id = buildFromGridBuilder(false, { quiet: true });
    const nodes = useNodeGraphStore.getState().nodes;
    expect(gridMetaOf(nodes.find(n => n.id === id))?.spec.warps[1].muted).toBe(true);
    const w2 = nodes.find(n => n.params[GS_ROLE] === 'w2')!;
    expect(w2.params[MUTE_PARAM]).toBe(1);
    expect(compileGraph({ nodes }).success).toBe(true);

    useGridBuilder.setState({ open: false, spec: starterGridScene(), targetSceneId: null });
    expect(editBuiltScene({ kind: 'grid', id })).toBe(true);
    expect(useGridBuilder.getState().spec.warps[1].muted).toBe(true);

    // Unmute and rebuild: the gate stays (live), at 0.
    useGridBuilder.getState().edit(d => { d.warps[1].muted = false; });
    buildFromGridBuilder(false, { quiet: true });
    const again = useNodeGraphStore.getState().nodes.find(n => n.params[GS_ROLE] === 'w2')!;
    expect(again.id).toBe(w2.id);
    expect(again.params[MUTE_PARAM]).toBe(0);
  });
});
