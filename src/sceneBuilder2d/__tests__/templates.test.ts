import { describe, expect, it, vi } from 'vitest';
vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});
import { compileGraph } from '../../compiler/graphCompiler';
import { buildStandalone2D } from '../build';
import { TEMPLATES_2D, templateScene } from '../templates';
import { parseRecipe2D, printRecipe2D } from '../recipe';
describe('2D Scene Builder templates: parse, print, build and compile', () => {
  for (const t of TEMPLATES_2D) it(t.key, () => {
    const p = parseRecipe2D(t.recipe);
    expect(p.errors).toEqual([]);
    expect(parseRecipe2D(printRecipe2D(p.scene)).errors).toEqual([]);
    const { nodes } = buildStandalone2D(templateScene(t.key));
    const ids = nodes.map(n => n.id);
    expect(new Set(ids).size).toBe(ids.length);
    const r = compileGraph({ nodes });
    expect(r.success).toBe(true);
  });
});
