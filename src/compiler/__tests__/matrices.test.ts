/**
 * Matrix operations (matrixOps.ts) and Grid Pattern's lattices.
 */
import { describe, it, expect, vi } from 'vitest';
vi.hoisted(() => vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} }));
import { compileGraph } from '../graphCompiler';
import { n, out } from '../../store/graphBuilder';
import type { GraphNode } from '../../types/nodeGraph';
import { buildMatrixExamples } from '../../store/matrixExamples';

const mainOf = (fs: string) => fs.slice(fs.indexOf('void main()'));

describe('matrix operations', () => {
  it('compose, invert, measure and apply: Rotation × Stretch → inverse → UV → circle', () => {
    const nodes: GraphNode[] = [
      n('uv', 'uv', 0, 0),
      n('rotationMatrix', 'rot', 0, 200, { angle: 0.5 }),
      n('stretchMatrix', 'st', 0, 400, { angle: 0, amount: 2 }),
      n('mat2Mul', 'mm', 200, 300, {}, { a: ['rot', 'mat2'], b: ['st', 'mat'] }),
      n('mat2Inverse', 'inv', 400, 300, {}, { mat: ['mm', 'mat'] }),
      n('mat2MulVec', 'app', 600, 200, {}, { mat: ['inv', 'inverse'], vec: ['uv', 'uv'] }),
      n('circleSDF', 'circ', 800, 200, { radius: 0.4 }, { position: ['app', 'output'] }),
      n('sdfFill', 'fill', 1000, 200, {}, { d: ['circ', 'distance'] }),
      out(['fill', 'result'], 1200),
    ];
    const r = compileGraph({ nodes });
    expect(r.errors ?? []).toEqual([]);
    const main = mainOf(r.fragmentShader);
    expect(main).toMatch(/mat2 (\w+)_mat = rotationma_0_m2 \* (\w+)_mat;/);
    expect(main).toContain('m2Inv(');
    expect(main).toContain('determinant(');
    expect(r.fragmentShader).toMatch(/^mat2 m2Inv\(mat2 m\) \{/m);
  });

  it('every new matrix node compiles in a small graph', () => {
    const cases: GraphNode[][] = [
      [n('scaleMatrix', 'a', 0, 0), n('shearMatrix', 'b', 0, 0), n('mat2Mix', 'm', 0, 0, {}, { a: ['a', 'mat'], b: ['b', 'mat'] }), n('mat2MulVec', 'v', 0, 0, {}, { mat: ['m', 'mat'] }), n('length', 'l', 0, 0, {}, { input: ['v', 'output'] }), out(['l', 'output'], 0)],
      [n('colorMatrix', 'c', 0, 0, { hue: 1 }), n('matConst', 'k', 0, 0), n('mat3Mix', 'm', 0, 0, {}, { a: ['c', 'mat'], b: ['k', 'mat'] }), n('mat3Mul', 'mm', 0, 0, {}, { a: ['m', 'mat'], b: ['c', 'mat'] }), n('mat3Inverse', 'i', 0, 0, {}, { mat: ['mm', 'mat'] }), n('palette', 'p', 0, 0), n('mat3MulVec', 'v', 0, 0, {}, { mat: ['i', 'inverse'], vec: ['p', 'color'] }), out(['v', 'output'], 0)],
      [n('cornerPin', 'cp', 0, 0), n('mat3MulPoint', 'mp', 0, 0, {}, { mat: ['cp', 'matrix'], point: ['cp', 'uv'] }), n('length', 'l', 0, 0, {}, { input: ['mp', 'point'] }), n('multiply', 'x', 0, 0, {}, { a: ['l', 'output'], b: ['cp', 'mask'] }), out(['x', 'result'], 0)],
    ];
    for (const nodes of cases) {
      const r = compileGraph({ nodes });
      expect(r.errors ?? [], nodes.map(x => x.type).join(',')).toEqual([]);
    }
  });

  it('Corner Pin maps the canvas through the inverse of its square → quad matrix', () => {
    const r = compileGraph({ nodes: [n('cornerPin', 'cp', 0, 0), out(['cp', 'uv'], 200)] });
    const main = mainOf(r.fragmentShader);
    expect(main).toMatch(/mat3 {2}cornerpin_0_H {3}= squareToQuad\(vec2\(u_p_\w+_x0, u_p_\w+_y0\)/);
    expect(main).toContain('inverse(cornerpin_0_H) * vec3(g_uv, 1.0)');
  });
});

describe('Grid Pattern lattices', () => {
  const grid = (params: Record<string, unknown>, wires: Record<string, [string, string]> = {}, extra: GraphNode[] = []): GraphNode[] => [
    ...extra,
    n('shapeSDF', 'hexs', 0, 400, { shape: 'hexagon', r: 0.4 }),
    n('gridPattern', 'gp', 300, 0, params, wires),
    out(['gp', 'color'], 600),
  ];

  it('every lattice compiles with every overflow, with the built-in shape and with a wired one', () => {
    for (const lattice of ['square', 'hex', 'brick', 'diamond', 'triangle', 'custom'])
      for (const overflow of ['none', 'neighbours', 'far'])
        for (const wired of [false, true])
          for (const affect of ['grow', 'pull']) {
            const r = compileGraph({ nodes: grid({ lattice, overflow, affect }, wired ? { shape: ['hexs', 'distance'] } : {}) });
            expect(r.errors ?? [], `${lattice}/${overflow}/${wired}/${affect}`).toEqual([]);
          }
  });

  it('the square lattice emits exactly the grid it always did', () => {
    const main = mainOf(compileGraph({ nodes: grid({ lattice: 'square' }) }).fragmentShader);
    expect(main).toMatch(/vec2 {2}gridpatter_0_cid {2}= floor\(gridpatter_0_gp\);/);
    expect(main).not.toContain('gpNearest(');
  });

  it('hexagons: a literal basis and its inverse, cells by nearest centre', () => {
    const main = mainOf(compileGraph({ nodes: grid({ lattice: 'hex' }) }).fragmentShader);
    expect(main).toContain('mat2  gridpatter_0_B    = mat2(1.0, 0.0, 0.5, 0.8660254);');
    expect(main).toContain('mat2  gridpatter_0_Bi   = mat2(1.0, 0.0, -0.5773503, 1.1547005);');
    expect(main).toContain('gpNearest(gridpatter_0_gp, gridpatter_0_B, gridpatter_0_Bi)');
  });

  it('triangles flip every other cell and step over both triangles per rhombus when overflowing', () => {
    const main = mainOf(compileGraph({ nodes: grid({ lattice: 'triangle', overflow: 'neighbours' }) }).fragmentShader);
    expect(main).toContain('gridpatter_0_ang  = u_p_gridpatterx0_rotation + gridpatter_0_flip * 3.14159;');
    expect(main).toMatch(/for \(int gridpatter_0_t = 0; gridpatter_0_t <= 1; gridpatter_0_t\+\+\)/);
  });

  it('Custom takes the Basis input (matrix nodes) and inverts it in the shader', () => {
    const extra = [
      n('rotationMatrix', 'rot', 0, 0, { angle: 0.3 }),
      n('shearMatrix', 'sh', 0, 200, { x: 0.4 }),
      n('mat2Mul', 'mm', 150, 100, {}, { a: ['rot', 'mat2'], b: ['sh', 'mat'] }),
    ];
    const r = compileGraph({ nodes: grid({ lattice: 'custom' }, { basis: ['mm', 'mat'] }, extra) });
    expect(r.errors ?? []).toEqual([]);
    const main = mainOf(r.fragmentShader);
    expect(main).toMatch(/mat2 {2}gridpatter_0_B {4}= \w+_mat;/);
    expect(main).toContain('m2Inv(gridpatter_0_B)');
  });
});

describe('iterated groups', () => {
  it('declare Loop Carry variables before the loop opens, so they carry across passes', () => {
    const { matrixFoldFractal } = buildMatrixExamples();
    const r = compileGraph({ nodes: matrixFoldFractal.nodes });
    expect(r.errors ?? []).toEqual([]);
    const main = mainOf(r.fragmentShader);
    const decl = main.search(/vec2 \w+_lc_\w+ = uv_0_uv;/);
    const loop = main.indexOf('for (float ');
    expect(decl).toBeGreaterThan(-1);
    expect(decl).toBeLessThan(loop);
    // …and written back at the end of each pass.
    expect(main.slice(loop)).toMatch(/\w+_lc_\w+ = \w+_result;/);
  });
});
