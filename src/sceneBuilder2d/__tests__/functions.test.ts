import { describe, expect, it, vi } from 'vitest';
vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});
import { compileGraph } from '../../compiler/graphCompiler';
import { buildStandalone2D } from '../build';
import { BUILT_IN_FUNCTIONS, findFunctions } from '../functions';
import { emptyScene, newShape, newSpaceOp } from '../spec';
import { parseRecipe2D, printRecipe2D } from '../recipe';

describe('functions in the 2D Scene Builder', () => {
  it.each(BUILT_IN_FUNCTIONS.map(f => [f.name, f] as const))('built-in %s compiles in its role', (_n, f) => {
    const s = emptyScene();
    if (f.role === 'space') { s.space.push(newSpaceOp('fn', 'p1', { name: f.name, code: f.code, timed: 1, from: f.from })); s.layers.push(newShape('circle', 's1')); }
    else s.layers.push(newShape('fnshape', 's1', { fn: { name: f.name, code: f.code, timed: f.timed, from: f.from } }));
    const { nodes } = buildStandalone2D(s);
    expect(nodes.some(n => n.type === 'customFn')).toBe(true);
    const r = compileGraph({ nodes });
    expect(r.success, String(r.errors)).toBe(true);
  });

  it('finds fitting functions in code, with the helpers they call', () => {
    const code = `
      float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9, 78.2))) * 43758.5); }
      vec2 jitter(vec2 p, float t) { return p + 0.05 * vec2(hash(floor(p * 8.0)), hash(floor(p * 8.0) + 1.0)); }
      float blob(vec2 p) { return length(p) - 0.3; }
      vec3 shade(vec3 c) { return c; }
      void mainImage(out vec4 O, vec2 F) { O = vec4(0.0); }`;
    const found = findFunctions([{ label: 'my shader', code }]);
    const names = found.map(f => `${f.role}:${f.name}`).sort();
    expect(names).toEqual(['shape:blob', 'shape:hash', 'space:jitter']);
    const j = found.find(f => f.name === 'jitter')!;
    expect(j.code).toContain('float hash(');
    expect(j.timed).toBe(true);
    // and it compiles as a space transform
    const s = emptyScene();
    s.space.push(newSpaceOp('fn', 'p1', { name: j.name, code: j.code, timed: 1, from: j.from }));
    s.layers.push(newShape('circle', 's1'));
    expect(compileGraph({ nodes: buildStandalone2D(s).nodes }).success).toBe(true);
  });

  it('reads and prints built-in functions in a recipe', () => {
    const r = parseRecipe2D('fn twirl · fn-shape flower color=pink · glow 0.01');
    expect(r.errors).toEqual([]);
    expect(r.scene.space[0].values.name).toBe('twirl');
    expect(r.scene.layers[0].type === 'shape' && r.scene.layers[0].fn?.name).toBe('flower');
    const again = parseRecipe2D(printRecipe2D(r.scene));
    expect(again.errors).toEqual([]);
    expect(printRecipe2D(again.scene)).toBe(printRecipe2D(r.scene));
    expect(parseRecipe2D('fn nope').errors[0].message).toMatch(/isn't a built-in space function/);
  });
});

import { EXAMPLE_GRAPHS } from '../../store/exampleGraphs';
import { functionsFromGraphs } from '../functions';

describe('functions from Custom Function nodes', () => {
  const found = functionsFromGraphs(Object.values(EXAMPLE_GRAPHS).map(g => ({ label: `example: ${g.label}`, nodes: g.nodes })));
  it('finds space and shape functions in the examples', () => {
    expect(found.filter(f => f.role === 'space').length).toBeGreaterThan(0);
    expect(found.filter(f => f.role === 'shape').length).toBeGreaterThan(0);
  });
  it('most of them compile when used in a scene', () => {
    let ok = 0;
    for (const f of found) {
      const s = emptyScene();
      if (f.role === 'space') { s.space.push(newSpaceOp('fn', 'p1', { name: f.name, code: f.code, timed: f.timed ? 1 : 0, from: f.from })); s.layers.push(newShape('circle', 's1')); }
      else s.layers.push(newShape('fnshape', 's1', { fn: f }));
      if (compileGraph({ nodes: buildStandalone2D(s).nodes }).success) ok++;
    }
    expect(ok / found.length).toBeGreaterThan(0.8);
  });
});
