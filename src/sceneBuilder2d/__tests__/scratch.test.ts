import { describe, expect, it, vi } from 'vitest';
vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});
import { compileGraph } from '../../compiler/graphCompiler';
import { buildStandalone2D } from '../build';
import { TEMPLATES_2D, templateScene } from '../templates';
import { parseRecipe2D, printRecipe2D } from '../recipe';
describe('scratch', () => {
  for (const t of TEMPLATES_2D) it(t.key, () => {
    const p = parseRecipe2D(t.recipe);
    expect(p.errors).toEqual([]);
    console.log(printRecipe2D(p.scene));
    const { nodes } = buildStandalone2D(templateScene(t.key));
    const ids = nodes.map(n => n.id);
    expect(new Set(ids).size).toBe(ids.length);
    const r = compileGraph({ nodes });
    console.log(t.key, nodes.length, r.success, r.errors);
    expect(r.success).toBe(true);
  });
});
