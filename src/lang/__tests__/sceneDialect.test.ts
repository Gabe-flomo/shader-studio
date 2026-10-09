/**
 * The scene dialect on the shared core (docs/playfield-language-plan.md phase 2): the recipe reads
 * through the one lexer and value reader, old words still work with a hint, the printer writes
 * the canonical words, randomness, and the round trips (canonical fixpoint, spec → text → spec on
 * every template and on random specs).
 */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} });
});

import { parseRecipe, printRecipe } from '../../sceneBuilder/recipe';
import { SCENE_TEMPLATES, templateSpec } from '../../sceneBuilder/templates';
import {
  SHAPES, WARPS, canonicalSpec, emptySpec, newGroup, newShape, newWarp, allShapes, type SceneItem, type SceneSpec, type Vec3,
} from '../../sceneBuilder/spec';
import { OUTPUTS, PALETTES } from '../../sceneBuilder/output';
import { makeRng, type Rng } from '../random';
import { sceneRand } from '../sceneRand';
import { COLOUR_TABLE } from '../colours';
import strings from './goldens/recipe-strings.json';

const clean = (src: string) => {
  const r = parseRecipe(src, { seed: 1 });
  expect(r.errors.map(e => e.message), src).toEqual([]);
  return r;
};

describe('scene dialect: the plan\'s decisions', () => {
  it('D13: @move(0,1,0) and @repeat(2,100,2) read with single brackets and print that way', () => {
    const r = clean('sphere r=1 @move(0,1,0)');
    expect(r.spec.root.children[0].warps[0].values.by).toEqual([0, 1, 0]);
    expect(printRecipe(r.spec)).toBe('surface · sphere r=1 @move(0,1,0)');
    expect(printRecipe(clean('sphere @move((0,1,0))').spec)).toBe('surface · sphere @move(0,1,0)');
  });
  it('D8: the noise warp prints as warp; noise still reads, with a hint', () => {
    const r = clean('sphere · noise 0.5');
    expect(printRecipe(r.spec)).toMatch(/· warp 0\.5$/);
    expect(r.hints?.[0]).toMatchObject({ fix: 'warp', from: 9 });
    expect(printRecipe(clean('sphere @noise(0.5)').spec)).toBe('surface · sphere @warp(0.5)');
    expect(canonicalSpec(clean('sphere · warp 0.5').spec)).toEqual(canonicalSpec(r.spec));
  });
  it('D6: glow as a render mode still reads as volumetric, with a hint', () => {
    const r = clean('glow · sphere');
    expect(r.spec.look.mode).toBe('volumetric');
    expect(r.hints?.[0]).toMatchObject({ fix: 'volumetric', from: 0, to: 4 });
    expect(printRecipe(r.spec)).toBe('volumetric · sphere');
  });
  it('show, group( ) and both( ) read with hints', () => {
    expect(clean('sphere · show depth').hints?.[0].fix).toBe('output');
    expect(clean('group(sphere, box)').hints?.[0].fix).toBe('union');
    const both = clean('both(sphere, box)');
    expect(both.hints?.[0].fix).toBe('intersect');
    expect(printRecipe(both.spec)).toBe('surface · intersect(sphere, box)');
  });
  it('palettes print as palette=; the bare form still reads', () => {
    expect(printRecipe(clean('sphere · colour by depth palette fire').spec)).toBe('surface · sphere · colour by depth palette=fire');
    expect(clean('sphere · colour by depth palette=fire').spec.output).toEqual({ show: 'depth', palette: 'fire' });
  });
  it('one colour table: every colour name reads as its value', () => {
    for (const [name, rgb] of Object.entries(COLOUR_TABLE)) expect(allShapes(clean(`sphere color=${name}`).spec)[0].color, name).toEqual(rgb);
  });
  it('reports values a recipe can\'t take, and relative settings', () => {
    expect(parseRecipe('sphere r=1..2').errors[0].message).toContain('isn\'t a recipe value');
    expect(parseRecipe('sphere r*=2').errors[0].message).toContain('r*=');
  });
});

describe('scene dialect: randomness', () => {
  it('r=random draws from the setting\'s interesting range, the same for a seed', () => {
    const a = clean('sphere r=random · seed=42'), b = parseRecipe('sphere r=random · seed=42');
    expect(allShapes(a.spec)[0].size.r).toEqual(allShapes(b.spec)[0].size.r);
    expect(a.seed).toBe(42);
    const p = SHAPES.find(s => s.kind === 'sphere')!.params[0];
    const rand = sceneRand(p);
    for (let seed = 1; seed < 60; seed++) {
      const r = allShapes(parseRecipe('sphere r=random', { seed }).spec)[0].size.r as number;
      expect(rand.kind === 'num' && r >= rand.lo && r <= rand.hi, String(r)).toBe(true);
    }
    expect(a.resolved).toEqual([expect.objectContaining({ key: 'sphere.r', from: 'random' })]);
  });
  it('random(lo..hi) and random(choices)', () => {
    for (let seed = 1; seed < 40; seed++) {
      const r = parseRecipe('box size=random(0.2..0.4) color=random(red, teal)', { seed });
      const sh = allShapes(r.spec)[0];
      expect((sh.size.size as Vec3)[0]).toBeGreaterThanOrEqual(0.2);
      expect((sh.size.size as Vec3)[0]).toBeLessThanOrEqual(0.4);
      expect([COLOUR_TABLE.red, COLOUR_TABLE.teal]).toContainEqual(sh.color);
      expect(r.resolved!.map(x => x.from)).toEqual(['random(0.2..0.4)', 'random(red, teal)']);
    }
  });
  it('without a seed each run differs; a seed repeats it', () => {
    const runs = new Set(Array.from({ length: 8 }, () => String(allShapes(parseRecipe('sphere r=random').spec)[0].size.r)));
    expect(runs.size).toBeGreaterThan(1);
    const s1 = printRecipe(parseRecipe('random sphere · box', { seed: 9 }).spec);
    expect(printRecipe(parseRecipe('random sphere · box', { seed: 9 }).spec)).toBe(s1);
    expect(printRecipe(parseRecipe('random sphere · box', { seed: 10 }).spec)).not.toBe(s1);
  });
  it('a leading random draws every unset setting and keeps the ones given', () => {
    const r = clean('random sphere r=0.5 · box · twist · smooth-union(torus, cone)');
    const [sphere, box] = allShapes(r.spec);
    expect(sphere.size.r).toBe(0.5);
    expect(box.size.size).not.toEqual([0.5, 0.5, 0.5]);
    expect(r.resolved!.some(x => x.key === 'twist.k')).toBe(true);
    expect(r.resolved!.some(x => x.key === 'smooth-union.k')).toBe(true);
    expect(r.resolved!.some(x => x.key === 'sphere.r')).toBe(false);
    // What was drawn prints as a plain recipe that reads back to the same scene.
    const kept = printRecipe(r.spec);
    expect(kept).not.toContain('random');
    expect(canonicalSpec(clean(kept).spec)).toEqual(canonicalSpec(r.spec));
  });
});

/** A random scene: shapes with sizes from their ranges, warps, combines nested up to depth 3. */
function randomSpec(rng: Rng): SceneSpec {
  const spec = emptySpec();
  let ids = 0;
  const v3 = (lo: number, hi: number): Vec3 => [0, 1, 2].map(() => Math.round(rng.float(lo, hi) * 100) / 100 + 0) as Vec3;
  const shape = (): SceneItem => {
    const def = rng.pick(SHAPES.filter(s => s.kind !== 'custom'));
    const sh = newShape(def.kind, `s${++ids}`);
    for (const p of def.params) {
      const r = sceneRand(p);
      if (r.kind === 'num') sh.size[p.key] = r.int ? Math.round(rng.float(r.lo, r.hi)) : Math.round(rng.float(r.lo, r.hi) * 100) / 100 + 0;
      else if (r.kind === 'vec') sh.size[p.key] = v3(r.lo, r.hi);
    }
    if (rng.chance(0.5)) sh.at = v3(-1, 1);
    if (rng.chance(0.3)) sh.rot = v3(-90, 90).map(x => Math.round(x) + 0) as Vec3;
    if (rng.chance(0.5)) sh.color = rng.pick(Object.values(COLOUR_TABLE));
    if (rng.chance(0.2)) sh.shine = 0.5;
    if (rng.chance(0.2)) sh.name = `Part${ids}`;
    if (rng.chance(0.4)) sh.warps.push(warp());
    return sh;
  };
  const warp = () => {
    const def = rng.pick(WARPS);
    const w = newWarp(def.kind, `w${++ids}`);
    for (const p of def.params) {
      const r = sceneRand(p);
      if (r.kind === 'num') w.values[p.key] = r.int ? Math.round(rng.float(r.lo, r.hi)) : Math.round(rng.float(r.lo, r.hi) * 100) / 100 + 0;
      else if (r.kind === 'vec') w.values[p.key] = v3(r.lo, r.hi);
    }
    return w;
  };
  const group = (depth: number): SceneItem => {
    const g = newGroup(`g${++ids}`, { op: rng.pick(['union', 'subtract', 'intersect'] as const), k: rng.chance(0.5) ? Math.round(rng.float(0.1, 0.5) * 100) / 100 : 0 });
    const n = rng.int(2, 3);
    for (let i = 0; i < n; i++) g.children.push(depth < 3 && rng.chance(0.3) ? group(depth + 1) : shape());
    if (rng.chance(0.3)) g.warps.push(warp());
    return g;
  };
  const n = rng.int(1, 4);
  for (let i = 0; i < n; i++) spec.root.children.push(rng.chance(0.35) ? group(1) : shape());
  if (rng.chance(0.3)) spec.root.warps.push(warp());
  // The recipe's rule: one combine on its own is the scene's root.
  const only = spec.root.children[0];
  if (spec.root.children.length === 1 && only.type === 'group') spec.root = { ...only, warps: [...spec.root.warps, ...only.warps], name: only.name || 'Scene' };
  spec.look.mode = rng.pick(['surface', 'gi', 'volumetric'] as const);
  if (rng.chance(0.4)) spec.look.fog = 0.3;
  if (rng.chance(0.3)) spec.camera.dist = 5;
  if (rng.chance(0.3)) { const o = rng.pick(OUTPUTS.filter(x => x.show !== 'picture')); spec.output = rng.chance(0.5) ? { show: o.show, palette: rng.pick(PALETTES).key } : { show: o.show }; }
  return spec;
}

describe('scene dialect: round trips', () => {
  const texts = [...SCENE_TEMPLATES.map(t => t.recipe), ...(strings as string[])];
  it('canonical fixpoint: print(parse(print(parse(x)))) = print(parse(x))', () => {
    for (const t of texts) {
      const once = printRecipe(parseRecipe(t).spec);
      expect(printRecipe(parseRecipe(once).spec), t).toBe(once);
    }
  });
  it('spec → text → spec on every template, in all three forms', () => {
    for (const t of SCENE_TEMPLATES) {
      const spec = templateSpec(t.key);
      for (const opts of [{}, { multiline: true }, { pretty: true }]) expect(canonicalSpec(clean(printRecipe(spec, opts)).spec), t.key).toEqual(canonicalSpec(spec));
    }
  });
  it('spec → text → spec on 300 random scenes', () => {
    const rng = makeRng(2026);
    for (let i = 0; i < 300; i++) {
      const spec = randomSpec(rng);
      const text = printRecipe(spec);
      const back = parseRecipe(text);
      expect(back.errors.map(e => e.message), text).toEqual([]);
      // Volumetric drops an output it can't show only in the graph, not in the spec.
      expect(canonicalSpec(back.spec), text).toEqual(canonicalSpec(spec));
    }
  });
});
