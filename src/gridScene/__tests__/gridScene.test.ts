/**
 * The Grid builder (docs/grid-builder.md): spec → graph for every shape, motion, pattern, warp and
 * rule; drawing cells; motion on the CPU; Surprise me; reopening as built; the jump to Grid Rules
 * and back.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});
import type { GraphNode } from '../../types/nodeGraph';
import { compileGraph } from '../../compiler/graphCompiler';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { useBuilderWindows } from '../../builders/windows';
import { builtScenes, builtSceneIds } from '../../builders/sceneKinds';
import { editBuiltScene } from '../../builders/open';
import { BLOCK_LIBRARY, blockFromEntry } from '../../sceneBuilder2d/blockLibrary';
import { buildStandaloneGrid, GS_ROLE } from '../build';
import { gridProgram } from '../glsl';
import { applyGridScene, findGridBuild, gridMetaOf } from '../apply';
import { backToGridScene, buildFromGridBuilder, drawnStartOf, FROM_GRID_KEY, simulationFromGrid } from '../actions';
import { startOrigin } from '../../gridRules/startCells';
import { useGridBuilder } from '../store';
import { surpriseGridScene } from '../surprise';
import { GRID_TEMPLATES } from '../templates';
import {
  DO_KINDS, MAX_PLACED, MOTION_PATHS, PATTERN_KINDS, PATTERN_TARGETS, SHAPE_KINDS, WHEN_KINDS,
  emptyGridScene, eraseCell, motionAt, newShape, placeCell, resizeGrid, ruleProblem, starterGridScene, type GridSceneSpec,
} from '../spec';

const compiles = (spec: GridSceneSpec) => {
  const g = buildStandaloneGrid(spec);
  expect(g.warnings).toEqual([]);
  const r = compileGraph({ nodes: g.nodes });
  expect(r.success, String(r.errors)).toBe(true);
  return { g, r };
};

/** Two shapes, both drawn, B moving: something for every pattern and rule to act on. */
function twoShapes(): GridSceneSpec {
  const s = starterGridScene();
  s.shapes.push(newShape('B', { kind: 'star', motion: { path: 'travel', xy: [1, 0], speed: 0.5, lag: 0 } }));
  placeCell(s, 0, 0, 'B');
  placeCell(s, 3, 9, 'B');
  return s;
}

describe('spec → graph: everything compiles', () => {
  it.each(GRID_TEMPLATES.map(t => t.key))('template %s', key => { compiles(GRID_TEMPLATES.find(t => t.key === key)!.make()); });
  it.each([...SHAPE_KINDS])('shape %s', kind => { const s = starterGridScene(); s.shapes[0].kind = kind; s.shapes[0].outline = 0.1; compiles(s); });
  it.each([...MOTION_PATHS])('motion %s', path => { const s = starterGridScene(); s.shapes[0].motion.path = path; compiles(s); });
  it.each(PATTERN_KINDS.flatMap(k => PATTERN_TARGETS.map(t => [k, t] as const)))('pattern %s changing %s, filling the empty cells', (kind, target) => {
    const s = twoShapes();
    s.pattern = { ...s.pattern, kind, target, fill: 'B' };
    // A picture pattern reads a picture (gridTextures.test.ts covers it).
    if (kind === 'picture') { s.textures = [{ name: 'pond' }]; s.pattern.tex = 'pond'; }
    const { g } = compiles(s);
    const grid = g.nodes.find(n => n.params[GS_ROLE] === 'grid')!;
    expect(String(grid.params.glslFunctions).includes('gs_drawn_')).toBe(kind !== 'none');
  });
  it.each(BLOCK_LIBRARY.map(e => e.id))('warp %s', id => {
    const s = starterGridScene();
    s.warps = [blockFromEntry(BLOCK_LIBRARY.find(e => e.id === id)!)];
    const { g } = compiles(s);
    expect(g.nodes.some(n => n.params[GS_ROLE] === 'w1')).toBe(true);
  });
  it.each(WHEN_KINDS.flatMap(w => DO_KINDS.map(d => [w, d] as const)))('rule: when %s, do %s', (when, d) => {
    const s = twoShapes();
    s.shapes.push(newShape('C', { kind: 'heart' }));
    s.rules = [{ id: 'r1', on: true, when: { kind: when, a: 'B', b: 'A', x: 4, y: 0, dist: 1 }, do: { kind: d, shape: 'C', color: [1, 0, 0], amount: 2 } }];
    compiles(s);
    const prog = gridProgram(s).functions;
    if (!ruleProblem(s, s.rules[0])) expect(prog).toContain('// r1');
  });
  it('a swap runs both ways', () => {
    const s = twoShapes();
    s.rules = [{ id: 'r1', on: true, when: { kind: 'sameCell', a: 'B', b: 'A' }, do: { kind: 'swap' } }];
    const fns = gridProgram(s).functions;
    expect(fns).toContain('// r1~');
    expect(fns).toContain('c = cA;');
    expect(fns).toContain('c = cB;');
  });
  it('the sliders are uniforms: changing a number keeps the shader, changing a path does not', () => {
    const a = starterGridScene();
    const b = structuredClone(a); b.shapes[0].size = 0.3; b.shapes[0].motion.speed = 1.2; b.pattern.amount = 0.2;
    const c = structuredClone(a); c.shapes[0].motion.path = 'circle';
    const strip = (src: string) => src.replace(/\/\/[^\n]*/g, '');
    const fa = compiles(a).r.fragmentShader, fb = compiles(b).r.fragmentShader, fc = compiles(c).r.fragmentShader;
    expect(strip(fb)).toBe(strip(fa));
    expect(strip(fc)).not.toBe(strip(fa));
  });
  it('two grid scenes in one graph don\'t clash (each helper is named by a hash of its code)', () => {
    const one = buildStandaloneGrid(starterGridScene(), { idFor: r => `a_${r}` });
    const other = surpriseGridScene(3);
    const two = applyGridScene(one.nodes, other, { nextId: (() => { let i = 0; return () => `n${++i}`; })(), asNew: true });
    expect(compileGraph({ nodes: two.nodes }).success).toBe(true);
  });
});

describe('drawing and motion', () => {
  it('places, replaces and erases cells, within the grid and the cap', () => {
    const s = emptyGridScene();
    s.shapes.push(newShape('B'));
    expect(placeCell(s, 2, 3, 'A')).toBe(true);
    expect(placeCell(s, 2, 3, 'B')).toBe(true);
    expect(s.cells).toEqual([{ x: 2, y: 3, s: 'B' }]);
    expect(placeCell(s, 10, 0, 'A')).toBe(false);
    expect(placeCell(s, 0, 0, 'Z')).toBe(false);
    expect(eraseCell(s, 2, 3)).toBe(true);
    expect(eraseCell(s, 2, 3)).toBe(false);
    resizeGrid(s, 24, 24);
    for (let i = 0; i < 24 * 24; i++) placeCell(s, i % 24, Math.floor(i / 24), 'A');
    expect(s.cells).toHaveLength(MAX_PLACED);
    resizeGrid(s, 4, 4);
    expect(s.cells.every(c => c.x < 4 && c.y < 4)).toBe(true);
  });
  it('every drawn cell is a block of the shader, at its cell', () => {
    const s = starterGridScene();
    const p = gridProgram(s);
    expect(p.placed).toBe(s.cells.length);
    for (const c of s.cells) expect(p.functions).toContain(`// cell (${c.x}, ${c.y}): shape A`);
  });
  it('moves as the shader does: up and down, side to side, round, travelling and hopping round the grid', () => {
    const g = { cols: 10, rows: 10 };
    const m = (path: typeof MOTION_PATHS[number], xy: [number, number] = [0.5, 0.5]) => ({ path, xy, speed: 1, lag: 0 });
    const near = (a: number[], b: number[]) => expect(a.map(v => Math.round(v * 1e4) / 1e4)).toEqual(b);
    near(motionAt(g, m('still'), 3, 4, 0.37), [3.5, 4.5]);
    near(motionAt(g, m('updown'), 3, 4, 0.25), [3.5, 4]); // a quarter cycle: half a cell up (y down in cells)
    near(motionAt(g, m('sideways'), 3, 4, 0.25), [4, 4.5]);
    near(motionAt(g, m('circle'), 3, 4, 0), [4, 4.5]);
    near(motionAt(g, m('travel', [1, 0]), 9, 0, 1.5), [1, 0.5]); // 9.5 + 1.5 wraps to 1
    near(motionAt(g, m('hop', [2, 0]), 0, 0, 1.9), [2.5, 0.5]);
    // Lag: each cell a little later (x + y).
    near(motionAt(g, { ...m('sideways'), lag: 0.25 }, 1, 0, 0), [2, 0.5]);
  });
  it('a painting stroke is one undo step however long it takes', () => {
    useGridBuilder.getState().openWith(emptyGridScene());
    const st = useGridBuilder.getState();
    st.edit(d => { placeCell(d, 0, 0, 'A'); }, 'stroke:1');
    st.edit(d => { placeCell(d, 1, 0, 'A'); }, 'stroke:1');
    st.edit(d => { placeCell(d, 2, 0, 'A'); }, 'stroke:1');
    expect(useGridBuilder.getState().spec.cells).toHaveLength(3);
    expect(useGridBuilder.getState().past).toHaveLength(1);
    useGridBuilder.getState().undo();
    expect(useGridBuilder.getState().spec.cells).toHaveLength(0);
  });
});

describe('Surprise me', () => {
  it('is seeded', () => {
    expect(surpriseGridScene(42)).toEqual(surpriseGridScene(42));
    expect(JSON.stringify(surpriseGridScene(42))).not.toBe(JSON.stringify(surpriseGridScene(43)));
  });
  it.each(Array.from({ length: 24 }, (_, i) => i + 1))('seed %i draws cells and compiles', seed => {
    const s = surpriseGridScene(seed);
    expect(s.cells.length).toBeGreaterThan(0);
    compiles(s);
  });
  it('is one undo step and remembers its seed', () => {
    useGridBuilder.getState().openWith(starterGridScene());
    const before = useGridBuilder.getState().spec;
    useGridBuilder.getState().surprise(7);
    expect(useGridBuilder.getState().spec).toEqual(surpriseGridScene(7));
    expect(useGridBuilder.getState().surpriseSeed).toBe(7);
    expect(useGridBuilder.getState().past).toHaveLength(1);
    useGridBuilder.getState().undo();
    expect(useGridBuilder.getState().spec).toEqual(before);
  });
});

const output = (): GraphNode => ({ id: 'out', type: 'output', position: { x: 600, y: 0 }, inputs: { color: { type: 'vec3', label: 'Color' } } as GraphNode['inputs'], outputs: {}, params: {} });
const outWire = () => useNodeGraphStore.getState().nodes.find(n => n.id === 'out')!.inputs.color.connection;

describe('in the graph: reopen as built, rebuild, the jump to Grid Rules and back', () => {
  beforeEach(() => {
    useNodeGraphStore.setState({ nodes: [output()], activeGroupPath: [], selectedNodeId: null, selectedNodeIds: [] });
    useBuilderWindows.setState({ gridRules: null, sceneShell: null });
    useGridBuilder.setState({ open: false, targetSceneId: null });
  });

  it('Build puts it in the graph; the Scene builder finds it and Edit this one reopens it as built', () => {
    const spec = surpriseGridScene(11);
    useGridBuilder.getState().openWith(spec);
    const id = buildFromGridBuilder(false, { quiet: true });
    const nodes = useNodeGraphStore.getState().nodes;
    expect(gridMetaOf(nodes.find(n => n.id === id))?.spec).toEqual(spec);
    expect(outWire()?.nodeId).toBe(findGridBuild(nodes, id)!.byRole.get('tone')!.id);
    expect(builtScenes(nodes).map(b => [b.kind, b.id])).toEqual([['grid', id]]);
    expect(builtSceneIds(nodes, { kind: 'grid', id }).size).toBe(findGridBuild(nodes, id)!.byRole.size);
    useGridBuilder.setState({ open: false, spec: starterGridScene(), targetSceneId: null });
    expect(editBuiltScene({ kind: 'grid', id })).toBe(true);
    expect(useGridBuilder.getState().open).toBe(true);
    expect(useGridBuilder.getState().targetSceneId).toBe(id);
    expect(useGridBuilder.getState().spec).toEqual(spec);
  });

  it('a rebuild keeps node ids and a slider changed on a node by hand', () => {
    useGridBuilder.getState().openWith(starterGridScene());
    const id = buildFromGridBuilder(false, { quiet: true });
    const shapeA = findGridBuild(useNodeGraphStore.getState().nodes, id)!.byRole.get('A')!;
    useNodeGraphStore.setState({ nodes: useNodeGraphStore.getState().nodes.map(n => (n.id === shapeA.id ? { ...n, params: { ...n.params, spin: 0.7 } } : n)) });
    useGridBuilder.getState().edit(d => { placeCell(d, 0, 0, 'A'); });
    buildFromGridBuilder(false, { quiet: true });
    const again = findGridBuild(useNodeGraphStore.getState().nodes, id)!;
    expect(again.byRole.get('A')!.id).toBe(shapeA.id);
    expect(again.byRole.get('A')!.params.spin).toBe(0.7);
    expect(again.meta.spec.cells).toContainEqual({ x: 0, y: 0, s: 'A' });
  });

  it('Make it a simulation: Grid Rules starts from the drawing, compiles, is reused, and goes back', () => {
    useGridBuilder.getState().openWith(starterGridScene());
    const sceneId = buildFromGridBuilder(false, { quiet: true });
    let n = 0;
    const r = simulationFromGrid(useNodeGraphStore.getState().nodes, sceneId, () => `sim${++n}`)!;
    const nodes = r.nodes;
    const gr = nodes.find(x => x.id === r.gridRulesId)!;
    expect(gr.type).toBe('gridRules');
    expect(gr.params.start).toBe('cells');
    expect(gr.params[FROM_GRID_KEY]).toBe(sceneId);
    const spec = findGridBuild(nodes, sceneId)!.meta.spec;
    const sc = gr.params.startCells as { w: number; h: number; rows: string[] };
    expect(sc.rows.join('').replace(/\./g, '').length).toBe(new Set(spec.cells.map(c => `${c.x},${c.y}`)).size);
    expect(sc).toEqual(drawnStartOf(spec));
    expect(nodes.some(x => x.type === 'pass')).toBe(false);
    expect(nodes.find(x => x.id === 'out')!.inputs.color.connection).toEqual({ nodeId: gr.id, outputKey: 'color' });
    expect(compileGraph({ nodes }).success).toBe(true);
    // Again: the same one, not a second.
    const r2 = simulationFromGrid(nodes, sceneId, () => `sim${++n}`)!;
    expect(r2.gridRulesId).toBe(gr.id);
    expect(r2.nodes.filter(x => x.type === 'gridRules')).toHaveLength(1);
    // A second jump after a change updates the drawing on the same node.
    useNodeGraphStore.setState({ nodes: r2.nodes });
    useGridBuilder.getState().edit(d => { placeCell(d, 0, 0, 'A'); });
    const id3 = buildFromGridBuilder(false, { quiet: true, keepOutput: true });
    const r3 = simulationFromGrid(useNodeGraphStore.getState().nodes, id3, () => `sim${++n}`)!;
    expect(r3.gridRulesId).toBe(gr.id);
    expect(r3.nodes.filter(x => x.type === 'gridRules')).toHaveLength(1);
    expect(r3.nodes.find(x => x.id === gr.id)!.params.startCells).toEqual(drawnStartOf(findGridBuild(r3.nodes, id3)!.meta.spec));
    expect(r3.nodes.find(x => x.id === gr.id)!.params.startCells).not.toEqual(sc);
    // An older jumped node (image start through a Pass) keeps working and switches to the drawn start.
    const old = r2.nodes.map(x => (x.id === gr.id ? { ...x, params: { ...x.params, start: 'image', startCells: undefined } } : x));
    const r4 = simulationFromGrid(old, sceneId, () => `sim${++n}`)!;
    expect(r4.nodes.find(x => x.id === gr.id)!.params.start).toBe('cells');
    expect(compileGraph({ nodes: r4.nodes }).success).toBe(true);
    // Back: the Output on the drawing, the Grid builder on it.
    useNodeGraphStore.setState({ nodes: r2.nodes });
    useGridBuilder.setState({ open: false });
    useBuilderWindows.setState({ gridRules: gr.id });
    expect(backToGridScene(gr.id)).toBe(true);
    expect(useBuilderWindows.getState().gridRules).toBeNull();
    expect(useGridBuilder.getState().open).toBe(true);
    expect(useGridBuilder.getState().targetSceneId).toBe(sceneId);
    expect(outWire()?.nodeId).toBe(findGridBuild(useNodeGraphStore.getState().nodes, sceneId)!.byRole.get('tone')!.id);
  });
});

describe('the drawn start of the jump', () => {
  it('is the drawn cells as state 1, and sits in the middle of a board of another size', () => {
    const s = emptyGridScene();
    placeCell(s, 2, 3, 'A'); placeCell(s, 3, 3, 'A'); placeCell(s, 3, 4, 'A');
    const sc = drawnStartOf(s)!;
    expect(sc.rows).toEqual(['11', '.1']);
    expect([sc.w, sc.h]).toEqual([2, 2]);
    expect(startOrigin(sc, 20, 10)).toEqual([9, 4]);
    expect(drawnStartOf(emptyGridScene())).toBeNull();
  });
});
