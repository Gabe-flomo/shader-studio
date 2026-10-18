/**
 * A shape's gradient colour in the recipe text (recipeGradient.ts, docs/gradients.md): printed,
 * parsed back to the same spec, its mistakes reported, and Describe reads it off a built graph.
 */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});

import { parseRecipe, printRecipe } from '../recipe';
import { parseGradientText, printGradientText } from '../recipeGradient';
import { buildStandaloneGraph } from '../build';
import { describeGraph } from '../recognize';
import { allShapes, canonicalSpec } from '../spec';
import type { ColourGradient } from '../../lib/colourGradient';

const G: ColourGradient = {
  along: 'normal', interp: 'linear', from: 0.5, to: -0.5,
  stops: [{ pos: 0, color: [1, 0, 0] }, { pos: 0.4, color: [0.12, 0.3456, 0.9] }, { pos: 1, color: [0, 0, 1] }],
};

describe('gradient text', () => {
  it('prints only what differs and reads back', () => {
    expect(printGradientText({ along: 'height', interp: 'smooth', from: -1, to: 1, stops: [{ pos: 0, color: [0, 0, 0] }, { pos: 1, color: [1, 1, 1] }] }))
      .toBe('height: black 0, white 1');
    const t = printGradientText(G);
    expect(t).toMatch(/^normal linear 0\.5\.\.-0\.5: /);
    expect(parseGradientText(t)).toEqual({ gradient: G });
  });

  it('reports mistakes', () => {
    expect('error' in parseGradientText('height navy 0, orange 1')).toBe(true);
    expect('error' in parseGradientText('sideways: navy 0, orange 1')).toBe(true);
    expect('error' in parseGradientText('height: navy 0')).toBe(true);
    expect('error' in parseGradientText('height: notacolour 0, orange 1')).toBe(true);
  });
});

describe('a shape gradient in a recipe', () => {
  it('round-trips spec → recipe → spec', () => {
    const { spec, errors } = parseRecipe('surface · sphere r=0.8 color=orange gradient="height constant 0..2: #1a0f40 0, orange 0.5, (1,0.9,0.6) 1" · box at=(1.5,0,0)');
    expect(errors).toEqual([]);
    const [sphere, box] = allShapes(spec);
    expect(sphere.gradient?.along).toBe('height');
    expect(sphere.gradient?.interp).toBe('constant');
    expect(sphere.gradient?.stops).toHaveLength(3);
    expect([sphere.gradient?.from, sphere.gradient?.to]).toEqual([0, 2]);
    expect(box.gradient ?? null).toBeNull();
    const text = printRecipe(spec);
    expect(text).toContain('gradient="height constant 0..2: ');
    expect(canonicalSpec(parseRecipe(text).spec)).toEqual(canonicalSpec(spec));
  });

  it('gradient=off is the solid colour; a 2D driver is refused', () => {
    expect(allShapes(parseRecipe('sphere gradient=off').spec)[0].gradient ?? null).toBeNull();
    expect(parseRecipe('sphere gradient="uvX: red 0, blue 1"').errors).toHaveLength(1);
  });

  it('Describe reads the gradient back from a built graph', () => {
    const { spec } = parseRecipe('surface · sphere gradient="centre: navy 0, orange 1"');
    const d = describeGraph(buildStandaloneGraph(spec).nodes)!;
    expect(allShapes(d.spec)[0].gradient?.along).toBe('centre');
    expect(printRecipe(d.spec)).toBe(printRecipe(spec));
  });
});
