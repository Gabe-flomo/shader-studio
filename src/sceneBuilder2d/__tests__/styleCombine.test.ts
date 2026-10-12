/**
 * Shape styles (Glow by default, Filled, Outline), combines (union … xor, smooth, colours blended by
 * the smooth weight) and the grid taken out of the 2D builder (docs/scene-builder-2d.md).
 */
import { describe, expect, it } from 'vitest';
import { compileGraph } from '../../compiler/graphCompiler';
import { buildScene2D, buildStandalone2D } from '../build';
import { parseRecipe2D, printRecipe2D } from '../recipe';
import {
  COMBINE_CHOICES_2D, canonicalScene, emptyScene, newGroup, newShape, starterScene, styleOf, withExplicitStyles, type Scene2D,
} from '../spec';
import { GRID_TEMPLATES_2D, TEMPLATES_2D, templateScene } from '../templates';
import { surpriseScene2D } from '../surprise';
import { BUILDER_2D_TABS, useSceneBuilder2D } from '../store';

const compiles = (s: Scene2D) => {
  const r = compileGraph({ nodes: buildStandalone2D(s).nodes }) as unknown as { success: boolean; fragmentShader: string; errors?: unknown };
  expect(r.success, JSON.stringify(r.errors)).toBe(true);
  // Notes become comments; what runs is the rest.
  return r.fragmentShader.replace(/\/\/[^\n]*/g, '');
};
const byRole = (s: Scene2D) => new Map(buildScene2D(s).nodes.map(n => [String(n.params._sbRole), n]));

/** Two circles side by side, joined by `op`. */
function pair(op: 'union' | 'subtract' | 'intersect' | 'xor', k: number, mix = true): Scene2D {
  const s = emptyScene();
  s.layers.push(newGroup('g1', { op, k, mix, children: [
    newShape('circle', 's1', { at: [-0.15, 0], color: [1, 0.3, 0.2], size: { r: 0.3 } }),
    newShape('circle', 's2', { at: [0.15, 0], color: [0.2, 0.5, 1], size: { r: 0.3 } }),
  ] }));
  s.look.glow.mode = 'all';
  return s;
}

/** A layer as it was saved before styles: no `style` anywhere. */
function legacy(s: Scene2D): Scene2D {
  const out = structuredClone(s);
  const strip = (items: Scene2D['layers']) => items.forEach(it => { delete it.style; if (it.type === 'group') strip(it.children); });
  strip(out.layers);
  return out;
}

describe('shape styles', () => {
  it('the default is Glow: the shape is its glow, with no flat fill painted over it', () => {
    const s = starterScene();
    expect(styleOf(s.layers[0])).toBe('glow');
    const roles = byRole(s);
    expect(roles.has('s1:fill')).toBe(false);
    expect(roles.has('s1:addglow')).toBe(false);
    const g = roles.get('s1:glow')!;
    expect(g.type).toBe('exprNode');
    expect(String(g.params.result)).toContain('max(d, 0.0)');
    // Nothing after it paints the layer over again: the glow node is what the tone map reads.
    const tone = roles.get('tone')!;
    expect(tone.inputs.color.connection?.nodeId).toBe(g.id);
    compiles(s);
  });

  it('a recipe shape is Glow too, and a picture layer is Filled', () => {
    expect(styleOf(parseRecipe2D('circle r=0.3').scene.layers[0])).toBe('glow');
    expect(styleOf(parseRecipe2D('texture p · picture p').scene.layers[0])).toBe('filled');
  });

  it('Glow on a layer that does not glow is the crisp shape alone', () => {
    const s = parseRecipe2D('circle r=0.3').scene;
    const roles = byRole(s);
    expect(roles.get('s1:fill')?.type).toBe('sdfFill');
    expect(roles.has('s1:glow')).toBe(false);
  });

  it('Filled stays available: the halo glow and the flat fill, as before', () => {
    const s = parseRecipe2D('circle r=0.3 style=filled · glow').scene;
    expect(s.layers[0].style).toBe('filled');
    const roles = byRole(s);
    expect(roles.get('s1:glow')?.type).toBe('glowLayer');
    expect(roles.get('s1:fill')?.type).toBe('sdfFill');
    compiles(s);
  });

  it('Outline is a glowing line along the edge', () => {
    const s = parseRecipe2D('star r=0.3 style=outline · glow').scene;
    const o = byRole(s).get('s1:outline')!;
    expect(String(o.params.result)).toContain('abs(d)');
    compiles(s);
  });

  it('the glow amount and falloff are live sliders: changing them recompiles nothing', () => {
    const a = starterScene(), b = starterScene();
    b.look.glow.amount = 0.03; b.look.glow.falloff = 2;
    expect(compiles(a)).toBe(compiles(b));
  });

  it('muting the glow (once muted) shows the crisp shape, live', () => {
    const s = starterScene();
    s.look.mute = { glow: true };
    const roles = byRole(s);
    expect(roles.get('s1:glow')!.inputs.crisp.connection?.nodeId).toBe(roles.get('s1:fill')!.id);
    compiles(s);
  });

  it('old scenes (no style) build exactly as before, Filled, and say so when reopened and printed', () => {
    for (const t of TEMPLATES_2D) {
      const filled = templateScene(t.key);
      filled.layers.forEach(it => { it.style = 'filled'; });
      const old = legacy(filled);
      expect(JSON.stringify(buildScene2D(old).nodes)).toBe(JSON.stringify(buildScene2D(filled).nodes));
      // Reopened: the style is written out; the recipe carries it, and reads back to the same scene.
      expect(withExplicitStyles(old).layers.every(it => it.style === 'filled')).toBe(true);
      const text = printRecipe2D(old);
      if (old.layers.length) expect(text).toContain('style=filled');
      expect(canonicalScene(parseRecipe2D(text).scene)).toEqual(canonicalScene(old));
    }
    useSceneBuilder2D.getState().openWith(legacy(starterScene()));
    expect(useSceneBuilder2D.getState().scene.layers[0].style).toBe('filled');
  });
});

describe('combines', () => {
  for (const ch of COMBINE_CHOICES_2D) {
    it(`${ch.label} compiles, its colours blend by the smooth weight, and Smooth is live`, () => {
      const k = ch.smooth ? 0.1 : 0;
      const s = pair(ch.op, k);
      const a = compiles(s);
      const roles = byRole(s);
      const op = roles.get('g1:op1')!;
      expect(op.type).toBe(ch.op === 'xor' ? 'exprNode' : { union: 'sdfUnion', subtract: 'sdfSubtract', intersect: 'sdfIntersect' }[ch.op]);
      if (ch.op !== 'subtract') {
        const col = roles.get('g1:col1')!;
        expect(col.inputs.w.connection).toEqual({ nodeId: op.id, outputKey: 'blend' });
      }
      if (ch.op !== 'xor') {
        // k is a param (a live uniform): another value, the same shader.
        expect(op.params.k).toBe(k);
        expect(compiles(pair(ch.op, k + 0.25))).toBe(a);
      }
    });
  }

  it('motion, copies and place apply before the combine', () => {
    const s = pair('union', 0.1);
    const kid = s.layers[0].type === 'group' ? s.layers[0].children[1] : null;
    kid!.motion.push({ id: 'm1', kind: 'orbit', speed: 0.2, amount: 0.1, phase: 0, dir: 0 });
    kid!.dup = { count: 4, radius: 0.3, levels: 1, factor: 1.6 };
    const roles = byRole(s);
    const op = roles.get('g1:op1')!;
    // B of the union comes from s2's distance after its Transform (placed by the orbit) and its ring.
    expect(roles.get('s2:place')!.inputs.offset.connection?.nodeId).toBe(roles.get('m1')!.id);
    expect(roles.get('s2:ring')).toBeTruthy();
    expect(op.inputs.b.connection?.nodeId).toBe(roles.get('s2')!.id);
    compiles(s);
  });

  it('a combine without mix keeps its one colour (as before)', () => {
    const roles = byRole(pair('union', 0.1, false));
    expect(roles.has('g1:col1')).toBe(false);
    expect(roles.get('g1:color')?.type).toBe('colorPicker');
  });

  it('recipe words round-trip: every op, smooth amounts, mix, styles', () => {
    const text = 'smooth-union(circle r=0.2 color=red, circle r=0.2 at=(0.3,0) color=blue) k=0.15 mix · xor(box, circle r=0.25 at=(0.2,0)) style=outline · smooth-subtract(hexagon, circle r=0.1) style=filled · smooth-intersect(circle, box) k=0.05 · glow';
    const r = parseRecipe2D(text);
    expect(r.errors).toEqual([]);
    const [a, b, c, d] = r.scene.layers;
    expect(a.type === 'group' && a.op === 'union' && a.k === 0.15 && a.mix).toBe(true);
    expect(b.type === 'group' && b.op === 'xor' && b.style === 'outline').toBe(true);
    expect(c.type === 'group' && c.op === 'subtract' && c.k > 0 && c.style === 'filled').toBe(true);
    expect(d.type === 'group' && d.op === 'intersect' && d.k === 0.05).toBe(true);
    const printed = printRecipe2D(r.scene);
    expect(printed).toContain('xor(');
    expect(printed).toContain(' mix');
    expect(canonicalScene(parseRecipe2D(printed).scene)).toEqual(canonicalScene(r.scene));
    compiles(r.scene);
  });
});

describe('the grid is out of the 2D builder', () => {
  it('there is no Grid tab', () => {
    expect(BUILDER_2D_TABS as string[]).not.toContain('grid');
  });

  it('templates and Surprise me make no grids', () => {
    expect(TEMPLATES_2D.some(t => /(^|·\s*)grid\s/.test(t.recipe))).toBe(false);
    for (let seed = 0; seed < 30; seed++) expect(surpriseScene2D(seed).grid ?? null).toBeNull();
  });

  it('old scenes with a grid still read (grid clauses) and build as before', () => {
    for (const t of GRID_TEMPLATES_2D) {
      const s = templateScene(t.key);
      expect(s.grid).toBeTruthy();
      expect(printRecipe2D(s)).toMatch(/grid \d+/);
      expect(byRole(s).get('grid')?.type).toBe('exprNode');
      compiles(s);
    }
  });
});
