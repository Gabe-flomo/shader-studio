/**
 * Scene Builder surprises (docs/surprise.md): Surprise me is repeatable by seed, stays in its
 * bands, never puts a cut or an overlap on shapes that don't touch, and every scene it makes
 * compiles; Random shape and Randomise this change one item.
 */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});

import { compileGraph } from '../../compiler/graphCompiler';
import { makeRng } from '../../lib/surprise';
import { buildStandaloneGraph } from '../build';
import { parseRecipe, printRecipe } from '../recipe';
import { addRandomShape, randomiseItem, surpriseScene } from '../surprise';
import { SHAPE_BY_KIND, allShapes, canonicalSpec, starterSpec, walkItems, type SceneSpec, type ShapeSpec } from '../spec';

const SEEDS = Array.from({ length: 30 }, (_, i) => 1000 + i * 7919);

describe('Surprise me (Scene Builder)', () => {
  it('the same seed makes the same scene; another seed another', () => {
    expect(surpriseScene(makeRng(321))).toEqual(surpriseScene(makeRng(321)));
    expect(surpriseScene(makeRng(321))).not.toEqual(surpriseScene(makeRng(322)));
  });

  it('2–6 shapes (plus a floor), unique ids, sizes and blends within their ranges', () => {
    const modes = new Set<string>();
    for (const seed of SEEDS) {
      const spec = surpriseScene(makeRng(seed));
      modes.add(spec.look.mode);
      const shapes = allShapes(spec).filter(s => s.kind !== 'plane');
      expect(shapes.length, String(seed)).toBeGreaterThanOrEqual(2);
      expect(shapes.length, String(seed)).toBeLessThanOrEqual(6);
      const ids: string[] = [];
      walkItems(spec.root, it => { ids.push(it.id); for (const w of it.warps) ids.push(w.id); });
      expect(new Set(ids).size, String(seed)).toBe(ids.length);
      walkItems(spec.root, it => {
        if (it.type === 'group' && it !== spec.root) {
          expect(it.k).toBeGreaterThanOrEqual(0);
          expect(it.k).toBeLessThanOrEqual(0.4);
          // A cut or an overlap holds shapes only, sitting on the first one.
          if (it.op !== 'union') for (const c of it.children) {
            expect(c.type).toBe('shape');
            const first = it.children[0] as ShapeSpec;
            expect(Math.hypot(...(c as ShapeSpec).at.map((v, i) => v - first.at[i]))).toBeLessThan(0.5);
          }
        }
        if (it.type === 'shape') {
          const def = SHAPE_BY_KIND[it.kind];
          for (const p of def.params) {
            const v = it.size[p.key];
            for (const x of Array.isArray(v) ? v : [v]) { expect(x, `${it.kind}.${p.key}`).toBeGreaterThanOrEqual(p.min); expect(x, `${it.kind}.${p.key}`).toBeLessThanOrEqual(p.max); }
          }
          for (const c of it.color) expect(c >= 0 && c <= 1).toBe(true);
        }
      });
      expect(spec.camera.dist).toBeGreaterThanOrEqual(2.6);
    }
    expect(modes.size).toBeGreaterThanOrEqual(3);
  });

  it('every surprise scene builds and compiles', () => {
    for (const seed of SEEDS) {
      const spec = surpriseScene(makeRng(seed));
      const g = buildStandaloneGraph(spec, { idFor: role => `t_${role.replace(/[^A-Za-z0-9]/g, '_')}` });
      const r = compileGraph({ nodes: g.nodes });
      expect(r.errors, `seed ${seed}: ${printRecipe(spec)}`).toBeUndefined();
      expect(r.success, String(seed)).toBe(true);
    }
  });

  it('reads back through the recipe language unchanged', () => {
    for (const seed of SEEDS.slice(0, 10)) {
      const spec = surpriseScene(makeRng(seed));
      const back = parseRecipe(printRecipe(spec));
      expect(back.errors, String(seed)).toEqual([]);
    }
  });
});

describe('Random shape and Randomise this', () => {
  it('Random shape adds one shape, repeatably', () => {
    const a = starterSpec(), b = starterSpec();
    const id = addRandomShape(a, null, makeRng(5));
    addRandomShape(b, null, makeRng(5));
    expect(canonicalSpec(a)).toEqual(canonicalSpec(b));
    expect(allShapes(a)).toHaveLength(2);
    expect(allShapes(a).some(s => s.id === id)).toBe(true);
  });

  it('Randomise this changes the selected shape only; on the root, the look and camera', () => {
    const spec: SceneSpec = surpriseScene(makeRng(77));
    const target = allShapes(spec)[0];
    const others = JSON.stringify(allShapes(spec).slice(1));
    const before = JSON.stringify(target);
    expect(randomiseItem(spec, target.id, makeRng(8))).toBe(true);
    expect(JSON.stringify(allShapes(spec)[0])).not.toBe(before);
    expect(JSON.stringify(allShapes(spec).slice(1))).toBe(others);
    const cam = JSON.stringify(spec.camera);
    randomiseItem(spec, spec.root.id, makeRng(9));
    expect(JSON.stringify(spec.camera)).not.toBe(cam);
    expect(randomiseItem(spec, 'nope', makeRng(1))).toBe(false);
  });
});
