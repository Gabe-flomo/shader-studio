/**
 * Scene Builder outputs (sceneBuilder/output.ts, docs/scene-builder.md "Output"): every output
 * compiles in Surface and GI, through a palette and a ramp too; the recipe prints and reads them
 * back; Describe reads them from the built graph; type mistakes in a recipe say how to fix them.
 */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});

import type { GraphNode } from '../../types/nodeGraph';
import { compileGraph } from '../../compiler/graphCompiler';
import { parseRecipe, printRecipe } from '../recipe';
import { buildStandaloneGraph, ROLE_KEY } from '../build';
import { describeGraph } from '../recognize';
import { canonicalSpec } from '../spec';
import { OUTPUTS, PALETTES } from '../output';

const shownBy = (nodes: GraphNode[], outputId: string) => {
  const c = nodes.find(n => n.id === outputId)!.inputs.color.connection!;
  return nodes.find(n => n.id === c.nodeId)!;
};

describe('Scene Builder outputs', () => {
  it('every output compiles in Surface and GI, as itself and through a palette', () => {
    for (const mode of ['surface', 'gi']) {
      for (const o of OUTPUTS) {
        for (const clause of [`output ${o.words[0]}`, `colour by ${o.words[0]} palette sunset`]) {
          const recipe = `${mode} · sphere · sphere r=0.4 at=(1,0,0) · ${clause}`;
          const { spec, errors } = parseRecipe(recipe);
          expect(errors, recipe).toEqual([]);
          const g = buildStandaloneGraph(spec);
          const r = compileGraph({ nodes: g.nodes });
          expect(r.success, `${recipe}: ${(r.errors ?? []).join('; ')}`).toBe(true);
          if (o.show === 'picture') continue;
          const shown = shownBy(g.nodes, g.outputId);
          expect(String(shown.params[ROLE_KEY]), recipe).toMatch(/^out:/);
          expect(typeof shown.params.__comment).toBe('string');
        }
      }
    }
  });

  it('every palette compiles (cosine presets and ramps)', () => {
    for (const p of PALETTES) {
      const { spec } = parseRecipe(`sphere · colour by height palette ${p.key}`);
      const g = buildStandaloneGraph(spec);
      expect(compileGraph({ nodes: g.nodes }).success, p.key).toBe(true);
      expect(shownBy(g.nodes, g.outputId).type).toBe(p.kind === 'palette' ? 'palette' : 'colorRamp');
    }
  });

  it('depth, normal and colour by depth wire the loop\'s own sockets', () => {
    const depth = buildStandaloneGraph(parseRecipe('sphere · sphere at=(1,0,0) · output depth').spec);
    const block = shownBy(depth.nodes, depth.outputId);
    const loop = depth.nodes.find(n => n.params[ROLE_KEY] === 'march')!;
    expect(block.inputs.depth.connection).toEqual({ nodeId: loop.id, outputKey: 'depth' });
    const normal = buildStandaloneGraph(parseRecipe('sphere · output normal').spec);
    expect(shownBy(normal.nodes, normal.outputId).params.result).toBe('n * 0.5 + 0.5');
    const pal = buildStandaloneGraph(parseRecipe('sphere · colour by depth palette fire').spec);
    const palette = shownBy(pal.nodes, pal.outputId);
    expect(palette.type).toBe('palette');
    expect(palette.params.preset).toBe(String(PALETTES.find(p => p.key === 'fire')!.preset));
  });

  it('the picture stays the default: no output clause, the same graph as before', () => {
    const a = buildStandaloneGraph(parseRecipe('sphere').spec);
    const b = buildStandaloneGraph(parseRecipe('sphere · output picture').spec);
    expect(b.nodes.map(n => n.id)).toEqual(a.nodes.map(n => n.id));
    expect(printRecipe(parseRecipe('sphere · output picture').spec)).toBe('surface · sphere');
  });

  it('round-trips outputs through the recipe and through Describe', () => {
    const recipes = [
      'surface · sphere · sphere at=(1,0,0) · output depth',
      'surface · sphere · colour by depth palette sunset',
      'gi · box · output normal',
      'surface · torus · colour by height palette terrain',
      'surface · sphere · plane · output shadow',
      'gi · sphere · colour by ao palette mono',
    ];
    for (const r of recipes) {
      const { spec, errors } = parseRecipe(r);
      expect(errors, r).toEqual([]);
      const printed = printRecipe(spec);
      expect(printed, r).toBe(r);
      expect(canonicalSpec(parseRecipe(printed).spec)).toEqual(canonicalSpec(spec));
      const d = describeGraph(buildStandaloneGraph(spec).nodes)!;
      expect(d.spec.output, r).toEqual(spec.output);
      expect(printRecipe(d.spec), r).toBe(printed);
      expect(d.unknown, r).toEqual([]);
    }
  });

  it('reads "color by", "show", a default palette and suggests near misses', () => {
    expect(parseRecipe('sphere · color by distance').spec.output).toEqual({ show: 'distance', palette: 'sunset' });
    expect(parseRecipe('sphere · show normals').spec.output).toEqual({ show: 'normal' });
    const bad = parseRecipe('sphere · output dpeth');
    expect(bad.errors[0].message).toContain('Did you mean “depth”');
    expect(parseRecipe('sphere · colour by depth palette sunsett').errors[0].message).toContain('“sunset”');
  });

  it('volumetric and glass keep the picture and say why', () => {
    const vol = buildStandaloneGraph(parseRecipe('volumetric · sphere · output depth').spec);
    expect(vol.warnings.join(' ')).toMatch(/no depth/);
    expect(compileGraph({ nodes: vol.nodes }).success).toBe(true);
    const steps = buildStandaloneGraph(parseRecipe('volumetric · sphere · output steps').spec);
    expect(compileGraph({ nodes: steps.nodes }).success).toBe(true);
  });

  it('refuses a vec3 where a number goes, with the fix', () => {
    const v = parseRecipe('sphere r=(1,2,3)');
    expect(v.errors[0].message).toMatch(/three numbers \(a vec3\).*Take \.x: r=1.*Luminance/);
    const c = parseRecipe('sphere shine=red');
    expect(c.errors[0].message).toMatch(/colour \(a vec3\).*brightness \(Luminance\): shine=0\.\d+/);
  });
});
