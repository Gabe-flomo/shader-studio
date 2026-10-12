/**
 * The Warp Builder's empty-slot menu (right-click) and the palette's static graphs
 * (docs/warp-builder.md, "Filling a slot from a menu" and "The palette").
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  const mem = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v); }, removeItem: (k: string) => { mem.delete(k); }, key: () => null, length: 0, clear: () => mem.clear() };
});

import { COND_GLYPHS, FN_GLYPHS } from '../glyphs';
import { applyTile, slotMenuGroups } from '../slotMenu';
import { newWarpBlock, rowTile, setRowTile, starterWarp, type TileTarget, type WarpSpec } from '../spec';
import { FN_TILES, VAR_TILES, textToTile, tileText } from '../tiles';
import { useWarpBuilder } from '../store';

/** One block, one row `exp(y) + _ * y`: the empty slot is at [1, 0]. */
function withHole(loop = false): { spec: WarpSpec; to: TileTarget } {
  const spec = starterWarp();
  spec.blocks = [{ id: 'w1', block: newWarpBlock() }];
  const b = spec.blocks[0].block;
  b.lines = [{ target: 'uv.x', op: '+=', rhs: '' }];
  if (loop) b.loop = true;
  setRowTile(b, 0, textToTile('exp(y) + _ * y')!);
  return { spec, to: { block: 0, line: 0, path: [1, 0] } };
}

const labels = () => slotMenuGroups(withHole().to).flatMap(g => g.options.map(o => o.label));

beforeEach(() => {
  const { spec } = withHole();
  useWarpBuilder.getState().openWith(spec);
});

describe('the empty-slot menu', () => {
  it('the hole is where the test says it is', () => {
    const { spec, to } = withHole();
    expect(tileText(rowTile(spec.blocks[0].block, 0))).toContain('_');
    expect(to.path).toEqual([1, 0]);
  });

  it('lists Number first, then x, y, uv, time, then the rest in palette order', () => {
    const l = labels();
    expect(l.slice(0, 5)).toEqual(['Number', 'x', 'y', 'uv', 'time']);
    const groups = slotMenuGroups(withHole().to);
    expect(groups.map(g => g.heading)).toEqual([null, 'Variables', 'Operators', 'Functions', 'If']);
    // The variables are the builder's own, in its order (the loop ones only in a looped block).
    const vars = groups[1].options.map(o => o.label);
    expect(vars).toEqual(VAR_TILES.filter(v => !v.loop).map(v => (v.name === 't' ? 'time' : v.label)));
    expect(groups[3].options.map(o => o.label)).toEqual(FN_TILES.map(f => f.label));
  });

  it('offers the loop variables in a looped block', () => {
    const { spec, to } = withHole(true);
    useWarpBuilder.getState().openWith(spec);
    expect(slotMenuGroups(to)[1].options.map(o => o.label)).toContain('uv0');
  });

  it('a condition slot lists only conditions', () => {
    const spec = starterWarp();
    spec.blocks = [{ id: 'w1', block: newWarpBlock() }];
    spec.blocks[0].block.lines[0].rhs = '_ > 0 ? 1 : 0';
    useWarpBuilder.getState().openWith(spec);
    const only = slotMenuGroups({ block: 0, line: 0, path: [0] });
    expect(only.map(g => g.heading)).toEqual(['Compare']);
  });

  it('picking an item fills the slot as a drop would, in one undo step', () => {
    const { to } = withHole();
    const y = slotMenuGroups(to).flatMap(g => g.options).find(o => o.label === 'y')!;
    const before = useWarpBuilder.getState().spec;
    const pastBefore = useWarpBuilder.getState().past.length;
    applyTile(to, y.drag);
    const s = useWarpBuilder.getState();
    expect(tileText(rowTile(s.spec.blocks[0].block, 0))).toBe('exp(y) + y * y');
    expect(s.past.length).toBe(pastBefore + 1);
    s.undo();
    expect(useWarpBuilder.getState().spec).toEqual(before);
    expect(tileText(rowTile(useWarpBuilder.getState().spec.blocks[0].block, 0))).toContain('_');
  });

  it('Number makes a slider in the slot and picks it', () => {
    const { to } = withHole();
    const n = slotMenuGroups(to)[0].options[0];
    const sel = applyTile(to, n.drag);
    const b = useWarpBuilder.getState().spec.blocks[0].block;
    expect(b.params).toHaveLength(1);
    expect(tileText(rowTile(b, 0))).toContain(b.params[0].name);
    expect(sel).not.toBeNull();
  });
});

describe('the palette graphs', () => {
  it('every function has a static plot, and every condition a step', () => {
    for (const f of FN_TILES) {
      const g = FN_GLYPHS[f.fn];
      expect(g, f.fn).toBeDefined();
      expect(g.path.length).toBeGreaterThan(10);
      expect(g.path).not.toContain('NaN');
    }
    for (const c of ['if', '>', '<', '>=', '<=', '==', '!=', '&&', '||', '!'] as const) expect(COND_GLYPHS[c]).toMatch(/^M/);
  });

  it('sin is a wave and exp a curve going up', () => {
    const ys = (d: string) => [...d.matchAll(/[ML]([\d.-]+) ([\d.-]+)/g)].map(m => Number(m[2]));
    const sin = ys(FN_GLYPHS.sin.path);
    expect(Math.min(...sin)).toBeLessThan(10);
    expect(Math.max(...sin)).toBeGreaterThan(30);
    const exp = ys(FN_GLYPHS.exp.path);
    // Screen y falls as the curve rises: never goes down the screen.
    expect(exp.every((v, i) => i === 0 || v <= exp[i - 1] + 0.05)).toBe(true);
    expect(exp[exp.length - 1]).toBeLessThan(exp[0] - 20);
  });
});
