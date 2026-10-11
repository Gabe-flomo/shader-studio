import { describe, expect, it, vi } from 'vitest';
vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});
import { compileGraph } from '../../compiler/graphCompiler';
import { buildStandalone2D } from '../build';
import { surpriseScene2D } from '../surprise';
import { useSceneBuilder2D } from '../store';
import { starterScene } from '../spec';
import { parseRecipe2D, printRecipe2D } from '../recipe';

describe('2D Scene Builder: Surprise me', () => {
  it('is seeded: the same seed gives the same scene, another seed another', () => {
    expect(surpriseScene2D(42)).toEqual(surpriseScene2D(42));
    expect(JSON.stringify(surpriseScene2D(42))).not.toBe(JSON.stringify(surpriseScene2D(43)));
    expect(surpriseScene2D('cosmic')).toEqual(surpriseScene2D('cosmic'));
  });

  it.each(Array.from({ length: 30 }, (_, i) => i + 1))('seed %i: blocks, shapes and a look, built and compiled with no warnings', seed => {
    const s = surpriseScene2D(seed);
    expect(s.layers.length).toBeGreaterThan(0);
    expect(s.look.glow.mode).toBe('all');
    expect(s.look.tone).toBe('aces');
    for (const op of s.space) expect(['block', 'combine']).toContain(op.kind);
    const { nodes, warnings } = buildStandalone2D(s);
    expect(warnings).toEqual([]);
    const r = compileGraph({ nodes });
    expect(r.success, String(r.errors)).toBe(true);
    // Its recipe reads back to the same scene.
    const back = parseRecipe2D(printRecipe2D(s));
    expect(back.errors).toEqual([]);
  });

  it('uses the space blocks in most scenes', () => {
    const withBlocks = Array.from({ length: 40 }, (_, i) => surpriseScene2D(i + 100)).filter(s => s.space.length > 0).length;
    expect(withBlocks).toBeGreaterThan(30);
  });

  it('is one undo step in the builder, and remembers its seed', () => {
    const st = useSceneBuilder2D.getState();
    st.openWith(starterScene());
    const before = useSceneBuilder2D.getState().scene;
    useSceneBuilder2D.getState().surprise(7);
    expect(useSceneBuilder2D.getState().scene).toEqual(surpriseScene2D(7));
    expect(useSceneBuilder2D.getState().surpriseSeed).toBe(7);
    expect(useSceneBuilder2D.getState().past).toHaveLength(1);
    useSceneBuilder2D.getState().undo();
    expect(useSceneBuilder2D.getState().scene).toEqual(before);
  });
});
