/**
 * Modify (operations on a shape's distance, modify.ts) and glow types (combiners.ts GLOW_TYPES):
 * each compiles, its numbers are live (another value, the same shader), recipes round-trip, and
 * old scenes are unchanged (docs/scene-builder-2d.md, "Modify", "Glow types").
 */
import { describe, expect, it } from 'vitest';
import { compileGraph } from '../../compiler/graphCompiler';
import { buildScene2D, buildStandalone2D } from '../build';
import { parseRecipe2D, printRecipe2D } from '../recipe';
import { canonicalScene, starterScene, type Scene2D } from '../spec';
import { MODS, checkCustom, newMod } from '../modify';
import { GLOW_TYPES, GlowLayerNode } from '../../nodes/definitions/combiners';
import { TEMPLATES_2D, templateScene } from '../templates';
import type { GraphNode } from '../../types/nodeGraph';
import { nodeMuted } from '../../builders/mute';

const shader = (s: Scene2D) => {
  const r = compileGraph({ nodes: buildStandalone2D(s).nodes }) as unknown as { success: boolean; fragmentShader: string; errors?: unknown };
  expect(r.success, JSON.stringify(r.errors)).toBe(true);
  return r.fragmentShader.replace(/\/\/[^\n]*/g, '');
};
const byRole = (s: Scene2D) => new Map(buildScene2D(s).nodes.map(n => [String(n.params._sbRole), n]));

describe('Modify', () => {
  for (const def of MODS) {
    it(`${def.label} compiles, builds as an Expression Block on the distance, and is live`, () => {
      const s = starterScene();
      s.layers[0].mods = [newMod(def.kind, 'x1', def.kind === 'custom' ? { expr: 'd - amp * sin(x * 20.0 + t)', values: { amp: 0.05 } } : {})];
      const a = shader(s);
      const n = byRole(s).get('s1:mod:x1')!;
      expect(n.type).toBe('exprNode');
      // The layer is drawn with the modified distance.
      expect(byRole(s).get('s1:glow')!.inputs.d.connection?.nodeId).toBe(n.id);
      // Another value of each number: the same shader (sliders are uniforms).
      const b = structuredClone(s);
      const m = b.layers[0].mods![0];
      for (const k of Object.keys(m.values)) if (k !== 'count') m.values[k] = m.values[k] * 0.5 + 0.01;
      expect(shader(b)).toBe(a);
    });
  }

  it('stacks top to bottom, mutes live, and reads back from its recipe', () => {
    const text = 'circle r=0.3 @onion(0.02 count=3) @ripples(30 speed=-1) @displace(0.05 scale=6) @fd("d - amp * sin(x * 20.0 + t)" amp=0.05) @bands(0.1) @negate @abs @grow(-0.01 muted) · glow type=gauss';
    const r = parseRecipe2D(text);
    expect(r.errors).toEqual([]);
    const mods = r.scene.layers[0].mods!;
    expect(mods.map(m => m.kind)).toEqual(['onion', 'ripples', 'displace', 'custom', 'bands', 'negate', 'abs', 'grow']);
    expect(mods[0].values.count).toBe(3);
    const roles = byRole(r.scene);
    expect(roles.get('s1:mod:x2')!.inputs.d.connection?.nodeId).toBe(roles.get('s1:mod:x1')!.id);
    expect(nodeMuted(roles.get('s1:mod:x8'))).toBe(true);
    const printed = printRecipe2D(r.scene);
    expect(canonicalScene(parseRecipe2D(printed).scene)).toEqual(canonicalScene(r.scene));
    shader(r.scene);
  });

  it('a custom line is checked like a space block', () => {
    expect(checkCustom(newMod('custom', 'x', { expr: 'abs(d) - w', values: { w: 0.1 } })).ok).toBe(true);
    const bad = checkCustom(newMod('custom', 'x', { expr: 'sinn(d)' }));
    expect(bad.ok).toBe(false);
    expect(!bad.ok && bad.error).toMatch(/sin\(\)/);
    const vec = checkCustom(newMod('custom', 'x', { expr: 'uv' }));
    expect(!vec.ok && vec.error).toMatch(/one number/);
    // Left out of the build with a warning, the rest still builds.
    const s = starterScene();
    s.layers[0].mods = [newMod('custom', 'x1', { expr: 'nope(d)' })];
    expect(buildScene2D(s).warnings.join(' ')).toMatch(/left out/);
    shader(s);
  });
});

describe('glow types', () => {
  for (const type of GLOW_TYPES) {
    it(`${type}: the builder and the Glow Layer node compile it, amount and falloff live`, () => {
      const s = starterScene();
      s.look.glow.type = type;
      const a = shader(s);
      const b = structuredClone(s);
      b.look.glow.amount = 0.03; b.look.glow.falloff = 2.2;
      expect(shader(b)).toBe(a);
      // Filled layers' halo goes through the Glow Layer node with the same type.
      const f = structuredClone(s);
      f.layers[0].style = 'filled';
      const n = byRole(f).get('s1:glow')!;
      expect(n.type).toBe('glowLayer');
      expect(n.params.mode ?? 'halo').toBe(type);
      shader(f);
      // The node on its own.
      const node: GraphNode = { id: 'g', type: 'glowLayer', position: { x: 0, y: 0 }, inputs: {}, outputs: {}, params: { mode: type } };
      expect(GlowLayerNode.generateGLSL(node, { d: 'dd', intensity: 'ii', power: 'pp' }).code).toContain('dd');
    });
  }

  it('a layer can have its own type; recipes round-trip', () => {
    const r = parseRecipe2D('circle glow-type=neon · ring · glow type=exp');
    expect(r.errors).toEqual([]);
    expect(r.scene.layers[0].glowType).toBe('neon');
    expect(r.scene.look.glow.type).toBe('exp');
    expect(canonicalScene(parseRecipe2D(printRecipe2D(r.scene)).scene)).toEqual(canonicalScene(r.scene));
    shader(r.scene);
  });

  it('the Halo node code is unchanged for graphs without a type', () => {
    const node: GraphNode = { id: 'g', type: 'glowLayer', position: { x: 0, y: 0 }, inputs: {}, outputs: {}, params: {} };
    expect(GlowLayerNode.generateGLSL(node, { d: 'dd', intensity: 'ii', power: 'pp' }).code).toContain('pow(ii / max(abs(dd), 0.0001), pp)');
  });

  it('old scenes (no types, no modify) build as before', () => {
    for (const t of TEMPLATES_2D) {
      const s = templateScene(t.key);
      for (const it of s.layers) it.style = 'filled';
      expect(buildScene2D(s).nodes.filter(n => n.type === 'glowLayer').every(n => (n.params.mode ?? 'halo') === 'halo')).toBe(true);
    }
  });
});
