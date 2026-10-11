/**
 * Linked size (docs/scene-builder-3d.md, "Size"): `size` sets every dimension of a shape that has
 * several, `width` / `height` / `depth` set one each, the old vector form still reads, and the
 * printer writes `size=` when the dimensions are equal, else the ones that changed by name.
 */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});

import { parseRecipe, printRecipe } from '../recipe';
import { SHAPES, canonicalSpec, shapeDims, type ShapeSpec } from '../spec';

const shape = (src: string): ShapeSpec => {
  const r = parseRecipe(src, { seed: 1 });
  expect(r.errors.map(e => e.message), src).toEqual([]);
  return r.spec.root.children[0] as ShapeSpec;
};
const printed = (src: string) => printRecipe(parseRecipe(src, { seed: 1 }).spec);
const roundTrip = (src: string) => {
  const a = parseRecipe(src, { seed: 1 }).spec;
  const b = parseRecipe(printRecipe(a), { seed: 1 }).spec;
  expect(canonicalSpec(b), src).toEqual(canonicalSpec(a));
};

describe('linked size: parsing', () => {
  it('size=0.5 sets every dimension of a box, a box frame and an ellipsoid', () => {
    expect(shape('box size=0.7').size.size).toEqual([0.7, 0.7, 0.7]);
    expect(shape('box-frame size=0.3').size.size).toEqual([0.3, 0.3, 0.3]);
    expect(shape('ellipsoid size=0.4').size.size).toEqual([0.4, 0.4, 0.4]);
  });
  it('width, height and depth set one dimension each, from the defaults', () => {
    expect(shape('box height=1').size.size).toEqual([0.5, 1, 0.5]);
    expect(shape('box width=0.2 depth=0.3').size.size).toEqual([0.2, 0.5, 0.3]);
    expect(shape('box size=0.3 height=1').size.size).toEqual([0.3, 1, 0.3]);
    expect(shape('ellipsoid depth=0.1').size.size).toEqual([0.6, 0.3, 0.1]);
  });
  it('the old vector form still reads', () => {
    expect(shape('box size=(0.3,1,0.3)').size.size).toEqual([0.3, 1, 0.3]);
    expect(shape('box (0.3,1,0.3)').size.size).toEqual([0.3, 1, 0.3]);
    expect(shape('box 0.4').size.size).toEqual([0.4, 0.4, 0.4]);
  });
  it('a round shape\'s size sets its radius and height; width / depth its radius, height its height', () => {
    const c = shape('cylinder size=0.4').size;
    expect([c.r, c.h]).toEqual([0.4, 0.4]);
    const d = shape('cylinder width=0.2 height=0.9').size;
    expect([d.r, d.h]).toEqual([0.2, 0.9]);
    const p = shape('capsule size=0.3').size;
    expect([p.r, p.h]).toEqual([0.3, 0.3]);
    const old = shape('cylinder r=0.2 h=0.7').size;
    expect([old.r, old.h]).toEqual([0.2, 0.7]);
  });
  it('a dimension takes one number', () => {
    const r = parseRecipe('box width=(1,2,3)', { seed: 1 });
    expect(r.errors[0]?.message).toMatch(/width is one number/);
  });
  it('a shape with one dimension has no width', () => {
    const r = parseRecipe('sphere width=1', { seed: 1 });
    expect(r.errors[0]?.message).toMatch(/no setting “width”/);
  });
  it('random dimensions draw one number', () => {
    const r = parseRecipe('box height=random', { seed: 3 });
    expect(r.errors).toEqual([]);
    const v = (r.spec.root.children[0] as ShapeSpec).size.size as number[];
    expect(v[0]).toBe(0.5);
    expect(v[2]).toBe(0.5);
    expect(v[1]).toBeGreaterThan(0);
  });
});

describe('linked size: printing', () => {
  it('equal dimensions print as size=', () => {
    expect(printed('box size=(0.7,0.7,0.7)')).toContain('box size=0.7');
    expect(printed('cylinder r=0.4 h=0.4')).toContain('cylinder size=0.4');
  });
  it('unequal dimensions print the ones that changed by name', () => {
    expect(printed('box size=(0.3,1,0.3)')).toContain('box width=0.3 height=1 depth=0.3');
    expect(printed('box size=(0.5,1,0.5)')).toContain('box height=1');
    expect(printed('box size=(0.5,1,0.5)')).not.toContain('width');
    expect(printed('cylinder r=0.2 h=0.7')).toContain('cylinder radius=0.2 height=0.7');
  });
  it('shapes with a height print radius= and height=; r= and h= still read', () => {
    expect(printed('capsule r=0.3 h=0.9')).toContain('capsule height=0.9 radius=0.3');
    expect(printed('hex-prism radius=0.25')).toContain('hex-prism radius=0.25');
    expect(printed('cone h=2')).toContain('cone height=2');
    expect(printed('pyramid height=1.2')).toContain('pyramid height=1.2');
    // A sphere's and a torus's radius stay r=.
    expect(printed('sphere r=0.3')).toContain('sphere r=0.3');
    expect(printed('torus r=0.1')).toContain('torus r=0.1');
    for (const [a, b] of [['cylinder r=0.2 h=0.7', 'cylinder radius=0.2 height=0.7'], ['capsule h=0.4', 'capsule height=0.4'], ['cone h=1.5', 'cone height=1.5']]) {
      expect(shape(a).size).toEqual(shape(b).size);
    }
  });
  it('defaults print nothing', () => {
    expect(printed('box')).toBe('surface · box');
    expect(printed('box size=0.5')).toBe('surface · box');
  });
  it('round-trips the old forms, the new ones and every shape with dimensions', () => {
    for (const src of [
      'box size=(0.3,1,0.3)', 'box size=0.2', 'box height=2 round=0.1', 'box-frame width=0.1 t=0.02', 'ellipsoid size=(0.6,0.3,0.4)',
      'cylinder size=0.6', 'cylinder width=0.1 height=1', 'capsule r=0.6 h=0.6', 'cylinder radius=0.2 height=0.9', 'tri-prism radius=0.3 h=0.5', 'hex-prism size=0.3', 'tri-prism height=0.9',
      'smooth-union(box width=0.2, cylinder size=0.3 @twist(2)) k=0.2',
    ]) roundTrip(src);
    for (const s of SHAPES.filter(x => shapeDims(x))) {
      roundTrip(`${s.kind} height=0.37`);
      roundTrip(`${s.kind} size=0.41`);
      roundTrip(`${s.kind} width=0.23 depth=0.29`);
    }
  });
});
