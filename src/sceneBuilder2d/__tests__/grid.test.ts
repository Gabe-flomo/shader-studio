import { describe, expect, it, vi } from 'vitest';
vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});
import { compileGraph } from '../../compiler/graphCompiler';
import { buildStandalone2D } from '../build';
import { emptyScene, type Scene2D } from '../spec';
import { GRID_ASSIGNS, GRID_SHAPES, GRID_TARGETS, defaultGrid, gridProgram, type GridSpec } from '../grid';
import { parseRecipe2D, printRecipe2D } from '../recipe';

const sceneWith = (g: Partial<GridSpec>): Scene2D => ({ ...emptyScene(), grid: { ...defaultGrid(), ...g } });
const compiles = (s: Scene2D) => {
  const { nodes } = buildStandalone2D(s);
  const r = compileGraph({ nodes });
  return { ok: r.success, errors: r.errors, fs: r.fragmentShader };
};

describe('the 2D Scene Builder grid', () => {
  it.each(GRID_SHAPES)('%s cells compile', shape => {
    expect(compiles(sceneWith({ shapes: [shape] })).ok).toBe(true);
  });

  it.each(GRID_ASSIGNS)('assign %s with three shapes compiles', assign => {
    expect(compiles(sceneWith({ shapes: ['circle', 'box', 'hexagon'], assign })).ok).toBe(true);
  });

  it.each(GRID_TARGETS)('the ripple changing %s compiles', target => {
    expect(compiles(sceneWith({ target, shapes: ['circle', 'triangle'] })).ok).toBe(true);
  });

  it('ripples from the corners, the mouse and a point, averaged', () => {
    const g = { ...defaultGrid(), ripples: [{ from: 'corners' as const, at: [0, 0] as [number, number] }, { from: 'mouse' as const, at: [0, 0] as [number, number] }, { from: 'point' as const, at: [0.3, -0.2] as [number, number] }] };
    const p = gridProgram(g);
    expect(p.usesMouse).toBe(true);
    expect(p.lines.filter(l => l.lhs === 'w' && l.op === '+=')).toHaveLength(3);
    expect(p.lines.some(l => l.lhs === 'w' && l.op === '/=')).toBe(true);
    const r = compiles({ ...emptyScene(), grid: g });
    expect(r.ok).toBe(true);
    const { nodes } = buildStandalone2D({ ...emptyScene(), grid: g });
    expect(nodes.some(n => n.type === 'mouse')).toBe(true);
  });

  it('colours by shape, ripple or cell', () => {
    for (const colourBy of ['shape', 'ripple', 'cell'] as const) expect(compiles(sceneWith({ colourBy })).ok, colourBy).toBe(true);
  });

  it('reads and prints in a recipe', () => {
    const src = 'grid 10 8 shape=circle shape=box assign=checker size=0.6 ripple=corners ripple=(0.3,0.2) freq=12 speed=0.5 target=morph amount=0.8 by=shape color=gold color2=pink · glow 0.01 · tone aces';
    const r = parseRecipe2D(src);
    expect(r.errors).toEqual([]);
    expect(r.scene.grid).toMatchObject({ cols: 10, rows: 8, shapes: ['circle', 'box'], assign: 'checker', target: 'morph', colourBy: 'shape' });
    expect(r.scene.grid!.ripples).toEqual([{ from: 'corners', at: [0, 0] }, { from: 'point', at: [0.3, 0.2] }]);
    const again = parseRecipe2D(printRecipe2D(r.scene));
    expect(again.errors).toEqual([]);
    expect(again.scene.grid).toEqual(r.scene.grid);
    expect(compiles(r.scene).ok).toBe(true);
  });

  it('grid on top of ordinary layers', () => {
    const r = parseRecipe2D('circle r=0.6 color=navy · grid 6 shape=ring');
    expect(r.errors).toEqual([]);
    expect(compiles(r.scene).ok).toBe(true);
  });
});
