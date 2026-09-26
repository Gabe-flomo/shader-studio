/**
 * Field sockets: a socket that receives the wired chain as a GLSL function
 * of position (docs/field-sockets.md). Grid Pattern's Shape / Picture, the
 * Array node, and the Cell source node.
 */
import { describe, it, expect, vi } from 'vitest';
vi.hoisted(() => vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} }));
import { compileGraph } from '../graphCompiler';
import { n, out, group } from '../../store/graphBuilder';
import { canHaveInputExpr } from '../../glsl/inputExpr';
import { getNodeDefinition } from '../../nodes/definitions';
import type { GraphNode } from '../../types/nodeGraph';

/** Every field function in a shader: return type, name, parameter list and body. */
function fieldFns(fs: string) {
  return [...fs.matchAll(/^(float|vec[234]) (fieldfn_\w+)\(([^)]*)\) \{\n([\s\S]*?)\n\}/gm)]
    .map(m => ({ ret: m[1], name: m[2], params: m[3], body: m[4] }));
}
/** The body of main(). */
const mainOf = (fs: string) => fs.slice(fs.indexOf('void main()'));

const circleIntoGrid = (extra: Partial<Record<string, unknown>> = {}, withUV = true): GraphNode[] => [
  n('uv', 'uv', 0, 0),
  n('circleSDF', 'circ', 200, 0, { radius: 0.25 }, withUV ? { position: ['uv', 'uv'] } : {}),
  n('gridPattern', 'gp', 400, 0, { columns: 6, ...extra }, { uv: ['uv', 'uv'], shape: ['circ', 'distance'] }),
  out(['gp', 'color'], 600),
];

describe('field sockets', () => {
  it('(a) UV → Circle SDF → Grid Pattern Shape: one field function of g_uv, called by Grid Pattern', () => {
    const r = compileGraph({ nodes: circleIntoGrid() });
    expect(r.errors ?? []).toEqual([]);
    const fns = fieldFns(r.fragmentShader);
    expect(fns).toHaveLength(1);
    expect(fns[0].ret).toBe('float');
    expect(fns[0].params).toMatch(/^vec2 g_uv, vec2 fieldCell, float fieldInfluence, float fieldIndex$/);
    // The UV node inside the chain is the function's position, not the pixel's.
    expect(fns[0].body).toMatch(/vec2 uv_0_uv = g_uv;\n\s+float circ_0_dist = circleSDF\(uv_0_uv - /);
    expect(mainOf(r.fragmentShader)).toMatch(/vec2 uv_0_uv = \(vUv - 0\.5\) \* 2\.0;/);
    expect(mainOf(r.fragmentShader)).toContain(`${fns[0].name}(gridpatter_0_rq, gridpatter_0_cid, gridpatter_0_inf, 0.0)`);
    // The built-in shape is not drawn when a shape is wired.
    expect(mainOf(r.fragmentShader)).not.toContain('gpShape(');
  });

  it('(b) a Circle SDF with nothing in its UV is still evaluated at the call’s position', () => {
    const r = compileGraph({ nodes: circleIntoGrid({}, false) });
    expect(r.errors ?? []).toEqual([]);
    const [fn] = fieldFns(r.fragmentShader);
    expect(fn.body).toMatch(/circleSDF\(g_uv - /);
  });

  it('(c) Time and a param uniform inside the chain keep working, under the uniform name the slider writes', () => {
    const nodes: GraphNode[] = [
      n('time', 'time', 0, 200),
      n('sin', 'wob', 100, 200, {}, { input: ['time', 'time'] }),
      n('circleSDF', 'circ', 200, 0, { radius: 0.25 }, { offset: ['wob', 'output'] }),
      n('gridPattern', 'gp', 400, 0, {}, { shape: ['circ', 'distance'] }),
      out(['gp', 'color'], 600),
    ];
    const r = compileGraph({ nodes });
    expect(r.errors ?? []).toEqual([]);
    const [fn] = fieldFns(r.fragmentShader);
    const radiusUniform = r.paramBindings['circ::radius'];
    expect(radiusUniform).toBe('u_p_circx0_radius');
    expect(r.paramUniforms[radiusUniform]).toBe(0.25);
    expect(fn.body).toContain(radiusUniform);
    expect(fn.body).toContain('u_time');
    // One declaration of the uniform, shared by main() and the function.
    expect(r.fragmentShader.match(new RegExp(`uniform float ${radiusUniform};`, 'g'))).toHaveLength(1);
  });

  it('(d) a node that reads the previous frame is rejected with a message on that node', () => {
    const nodes: GraphNode[] = [
      n('echo', 'echo', 0, 0),
      n('luminance', 'lum', 200, 0, {}, { color: ['echo', 'color'] }),
      n('gridPattern', 'gp', 400, 0, {}, { shape: ['lum', 'result'] }),
      out(['gp', 'color'], 600),
    ];
    const r = compileGraph({ nodes });
    expect(r.success).toBe(false);
    expect(r.errors?.join('\n')).toMatch(/^Node echo: Echo \(After-image\) can't be part of a shape wired into Grid Pattern's Shape: it reads the previous frame\.$/m);
  });

  it('(e) one chain wired into two field sockets emits one function', () => {
    const nodes: GraphNode[] = [
      n('circleSDF', 'circ', 200, 0, { radius: 0.1 }),
      n('gridPattern', 'gp', 400, 0, {}, { shape: ['circ', 'distance'] }),
      n('gridPattern', 'gp2', 400, 300, { columns: 3 }, { shape: ['circ', 'distance'] }),
      n('mix', 'mx', 600, 0, {}, { a: ['gp', 'distance'], b: ['gp2', 'distance'] }),
      out(['mx', 'result'], 800),
    ];
    const r = compileGraph({ nodes });
    expect(r.errors ?? []).toEqual([]);
    const fns = fieldFns(r.fragmentShader);
    expect(fns).toHaveLength(1);
    const calls = mainOf(r.fragmentShader).match(new RegExp(`${fns[0].name}\\(`, 'g')) ?? [];
    expect(calls.length).toBe(2);
  });

  it('(f) the Cell node is the function’s parameters inside the chain and zeros outside', () => {
    const nodes: GraphNode[] = [
      n('fieldCell', 'cell', 0, 0),
      n('noiseFloat', 'hash', 100, 0, { mode: 'hash', scale: 1, speed: 0 }, { uv: ['cell', 'cellID'] }),
      n('circleSDF', 'circ', 300, 0, {}, { radius: ['hash', 'value'] }),
      n('gridPattern', 'gp', 400, 0, {}, { shape: ['circ', 'distance'] }),
      out(['gp', 'color'], 600),
    ];
    const r = compileGraph({ nodes });
    expect(r.errors ?? []).toEqual([]);
    const [fn] = fieldFns(r.fragmentShader);
    expect(fn.body).toMatch(/vec2 {2}fcell_0_cell {2}= fieldCell;/);
    expect(fn.body).toMatch(/float fcell_0_idx {3}= fieldIndex;/);
    expect(mainOf(r.fragmentShader)).toMatch(/vec2 {2}fcell_0_cell {2}= vec2\(0\.0\);/);
    // Grid Pattern passes the cell id and influence.
    expect(mainOf(r.fragmentShader)).toContain(`${fn.name}(gridpatter_0_rq, gridpatter_0_cid, gridpatter_0_inf, 0.0)`);
  });

  it('(g) Overflow = Neighbours evaluates the shape in a 3×3 loop with literal bounds (Far: 5×5)', () => {
    const r = compileGraph({ nodes: circleIntoGrid({ overflow: 'neighbours', affect: 'pull' }) });
    expect(r.errors ?? []).toEqual([]);
    const main = mainOf(r.fragmentShader);
    expect(main).toMatch(/for \(int gridpatter_0_j = -1; gridpatter_0_j <= 1; gridpatter_0_j\+\+\)/);
    expect(main).toMatch(/for \(int gridpatter_0_i = -1; gridpatter_0_i <= 1; gridpatter_0_i\+\+\)/);
    const [fn] = fieldFns(r.fragmentShader);
    // Once per cell of the 3×3, the pixel's own included, composited in one fixed
    // (row-major) order so overlapping shapes stack the same way across a border.
    expect(main).toContain(`${fn.name}(gridpatter_0_nrq, gridpatter_0_ncid, gridpatter_0_ninf, 0.0)`);
    expect(main).not.toContain(`${fn.name}(gridpatter_0_rq,`);
    expect(main).not.toContain('continue;');
    expect(main).toMatch(/gridpatter_0_d {4}= min\(gridpatter_0_d, gridpatter_0_nd\);/);
    // Pull may move a shape a whole cell once the neighbours are drawn.
    expect(main).toMatch(/gridpatter_0_q -= gridpatter_0_dir \* gridpatter_0_inf \* 1\.0;/);

    const far = mainOf(compileGraph({ nodes: circleIntoGrid({ overflow: 'far' }) }).fragmentShader);
    expect(far).toMatch(/for \(int gridpatter_0_j = -2; gridpatter_0_j <= 2; gridpatter_0_j\+\+\)/);
    // The built-in shape overflows too.
    const builtIn = compileGraph({ nodes: [n('gridPattern', 'gp', 0, 0, { overflow: 'neighbours', size: 0.7 }), out(['gp', 'color'], 200)] });
    expect(builtIn.errors ?? []).toEqual([]);
    expect(mainOf(builtIn.fragmentShader)).toMatch(/gpShape\(gridpatter_0_nrq, /);
  });

  it('every shape / picture / overflow combination compiles', () => {
    for (const overflow of ['none', 'neighbours', 'far'])
      for (const wires of [{ shape: true }, { picture: true }, { shape: true, picture: true }])
        for (const affect of ['grow', 'pull', 'hide', 'spin']) {
          const nodes: GraphNode[] = [
            n('circleSDF', 'circ', 0, 0, { radius: 0.3 }),
            n('palette', 'pal', 0, 200, {}, { value: ['circ', 'distance'] }),
            n('gridPattern', 'gp', 400, 0, { overflow, affect }, {
              ...(wires.shape ? { shape: ['circ', 'distance'] as [string, string] } : {}),
              ...(wires.picture ? { picture: ['pal', 'color'] as [string, string] } : {}),
            }),
            out(['gp', 'color'], 600),
          ];
          const r = compileGraph({ nodes });
          const tag = `${overflow}/${JSON.stringify(wires)}/${affect}`;
          expect(r.errors ?? [], tag).toEqual([]);
          expect(fieldFns(r.fragmentShader).length, tag).toBe(Object.keys(wires).length);
          if (wires.picture) expect(fieldFns(r.fragmentShader).some(f => f.ret === 'vec3'), tag).toBe(true);
        }
  });

  it('(h) the Array node compiles a ring of 12 copies of a wired shape', () => {
    const nodes: GraphNode[] = [
      n('fieldCell', 'cell', 0, 0),
      n('circleSDF', 'circ', 200, 0, { radius: 0.06 }),
      n('arrayField', 'arr', 400, 0, { layout: 'ring', count: 12, radius: 0.6, combine: 'smin' }, { shape: ['circ', 'distance'] }),
      out(['arr', 'color'], 600),
    ];
    const r = compileGraph({ nodes });
    expect(r.errors ?? []).toEqual([]);
    const [fn] = fieldFns(r.fragmentShader);
    const main = mainOf(r.fragmentShader);
    expect(main).toMatch(/for \(int arr_0_i = 0; arr_0_i < 64; arr_0_i\+\+\)/);
    expect(main).toMatch(/float arr_0_n {4}= clamp\(floor\(12\.0 \+ 0\.5\), 1\.0, 64\.0\);/);
    expect(main).toContain(`${fn.name}(arr_0_l, arr_0_cid, 0.0, arr_0_fi)`);
    expect(main).toContain('smin(arr_0_d, arr_0_dn');
  });

  it('the Array node compiles every layout and combine, with and without a shape', () => {
    for (const layout of ['line', 'grid', 'ring'])
      for (const combine of ['min', 'smin', 'add', 'max'])
        for (const wired of [false, true]) {
          const nodes: GraphNode[] = [
            n('circleSDF', 'circ', 0, 0, { radius: 0.05 }),
            n('palette', 'pal', 0, 200),
            n('arrayField', 'arr', 400, 0, { layout, combine, count: 7 }, wired ? { shape: ['circ', 'distance'], picture: ['pal', 'color'] } : {}),
            out(['arr', 'color'], 600),
          ];
          const r = compileGraph({ nodes });
          expect(r.errors ?? [], `${layout}/${combine}/${wired}`).toEqual([]);
          expect(fieldFns(r.fragmentShader).length).toBe(wired ? 2 : 0);
        }
  });

  it('an Array wired into Grid Pattern’s Shape nests: the inner function is defined before the outer one', () => {
    const nodes: GraphNode[] = [
      n('fieldCell', 'cell', 0, 0),
      n('circleSDF', 'circ', 100, 0, { radius: 0.04 }),
      n('arrayField', 'arr', 250, 0, { layout: 'ring', count: 6, radius: 0.25 }, { shape: ['circ', 'distance'] }),
      n('gridPattern', 'gp', 400, 0, { columns: 5 }, { shape: ['arr', 'distance'] }),
      out(['gp', 'color'], 600),
    ];
    const r = compileGraph({ nodes });
    expect(r.errors ?? []).toEqual([]);
    const fns = fieldFns(r.fragmentShader);
    expect(fns.map(f => f.name)).toEqual(['fieldfn_circ_0_distance', 'fieldfn_arr_0_distance']);
    // The Array inside the outer function calls the inner one, at the cell's coordinates.
    expect(fns[1].body).toContain('fieldfn_circ_0_distance(arr_0_l, ');
    expect(fns[1].body).toMatch(/vec2 {2}arr_0_p {4}= g_uv;/);
  });

  it('inside a group a field socket falls back to the built-in shape instead of breaking the shader', () => {
    const inner: GraphNode[] = [
      n('circleSDF', 'circ', 0, 0, { radius: 0.2 }),
      n('gridPattern', 'gp', 200, 0, {}, { shape: ['circ', 'distance'] }),
    ];
    const nodes: GraphNode[] = [
      group('g1', 0, 0, { label: 'Grid', iterations: 1, inputs: [], outputs: [{ key: 'color', type: 'vec3', label: 'Color', from: ['gp', 'color'] }], nodes: inner }),
      out(['g1', 'color'], 400),
    ];
    const r = compileGraph({ nodes });
    expect(r.errors ?? []).toEqual([]);
    expect(r.fragmentShader).toContain('gpShape(');
    expect(fieldFns(r.fragmentShader)).toHaveLength(0);
  });

  it('a field socket takes no input expression', () => {
    const gp = n('gridPattern', 'gp', 0, 0);
    const def = getNodeDefinition('gridPattern')!;
    expect(canHaveInputExpr(gp, 'shape', def)).toBe(false);
    expect(canHaveInputExpr(gp, 'columns', def)).toBe(true);
    // Even one stored on the card by hand is ignored rather than wrapping the function name.
    const nodes = circleIntoGrid();
    nodes[2] = { ...nodes[2], params: { ...nodes[2].params, __inExpr_shape: 'input * 2.0' } };
    const r = compileGraph({ nodes });
    expect(r.errors ?? []).toEqual([]);
    expect(mainOf(r.fragmentShader)).toContain('fieldfn_circ_0_distance(gridpatter_0_rq');
  });

  it('a bypassed Grid Pattern does not pass the function name through', () => {
    const nodes = circleIntoGrid();
    nodes[2] = { ...nodes[2], bypassed: true };
    const r = compileGraph({ nodes });
    expect(r.errors ?? []).toEqual([]);
    expect(fieldFns(r.fragmentShader)).toHaveLength(0);
  });
});
