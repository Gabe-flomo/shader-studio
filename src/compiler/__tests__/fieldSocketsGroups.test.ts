/**
 * Field sockets and groups (docs/field-sockets.md): a Group as the shape, a
 * field socket inside a group, a chain crossing a group's ports, iterated and
 * nested groups. Every shader is also parsed with undeclared names treated as
 * errors, which is what a field function that reads a main() variable fails on.
 */
import { describe, it, expect, vi } from 'vitest';
vi.hoisted(() => vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} }));
import { parser } from '@shaderfrog/glsl-parser';
import preprocess from '@shaderfrog/glsl-parser/preprocessor';
import { compileGraph } from '../graphCompiler';
import { n, out, group, port } from '../../store/graphBuilder';
import type { GraphNode } from '../../types/nodeGraph';

function fieldFns(fs: string) {
  return [...fs.matchAll(/^(float|vec[234]) (fieldfn_\w+)\(([^)]*)\) \{\n([\s\S]*?)\n\}/gm)]
    .map(m => ({ ret: m[1], name: m[2], params: m[3], body: m[4] }));
}
const mainOf = (fs: string) => fs.slice(fs.indexOf('void main()'));
/** WebGL 1 built-ins the parser doesn't declare. */
const GL_BUILTINS = 'vec4 gl_FragColor;\n';

/** Compile and check the shader parses with every name declared. */
function compileOk(nodes: GraphNode[]) {
  const r = compileGraph({ nodes });
  expect(r.errors ?? []).toEqual([]);
  expect(() => parser.parse(preprocess(GL_BUILTINS + r.fragmentShader, { preserve: {} }), { quiet: true, failOnWarn: true })).not.toThrow();
  return r;
}

const shapeGroup = (id: string, extra: GraphNode[] = [], radius = 0.3) => group(id, 0, 0, {
  label: 'Shape', iterations: 1, inputs: [],
  outputs: [{ key: 'd', type: 'float', label: 'Distance', from: ['ring', 'output'] }],
  nodes: [
    n('uv', 'uv', 0, 0),
    n('circleSDF', 'circ', 100, 0, { radius }, { position: ['uv', 'uv'] }),
    n('abs', 'ring', 200, 0, {}, { input: ['circ', 'distance'] }),
    ...extra,
  ],
});

describe('field sockets and groups', () => {
  it('the parser check catches a name the shader never declares', () => {
    expect(() => parser.parse(preprocess(GL_BUILTINS + "void main() { gl_FragColor = vec4(nope); }", { preserve: {} }), { quiet: true, failOnWarn: true })).toThrow(/nope/);
  });

  it('a Group wired into Grid Pattern’s Shape: its subgraph becomes the field function', () => {
    const r = compileOk([
      shapeGroup('g'),
      n('gridPattern', 'gp', 400, 0, {}, { shape: ['g', 'd'] }),
      out(['gp', 'color'], 600),
    ]);
    const fns = fieldFns(r.fragmentShader);
    expect(fns).toHaveLength(1);
    const [fn] = fns;
    expect(fn.name).toBe('fieldfn_shape_0_d');
    // The group's nodes, under the names main() gave them; its UV node is the call's position.
    expect(fn.body).toMatch(/vec2 shape_0_g_uv_0_uv = g_uv;/);
    expect(fn.body).toContain('float shape_0_g_circ_0_dist = circleSDF(shape_0_g_uv_0_uv');
    expect(fn.body).toMatch(/return shape_0_g_abs_0_output;$/);
    expect(mainOf(r.fragmentShader)).toContain(`${fn.name}(gridpatter_0_rq, gridpatter_0_cid, gridpatter_0_inf, 0.0)`);
    // The slider on the Circle inside the group writes the uniform the function reads.
    expect(fn.body).toContain(r.paramBindings['circ::radius']);
  });

  it('a field socket inside a group, its shape inside too', () => {
    const r = compileOk([
      group('g', 0, 0, {
        label: 'Grid', iterations: 1, inputs: [],
        outputs: [{ key: 'color', type: 'vec3', label: 'Color', from: ['gp', 'color'] }],
        nodes: [
          n('circleSDF', 'circ', 0, 0, { radius: 0.2 }),
          n('gridPattern', 'gp', 200, 0, {}, { shape: ['circ', 'distance'] }),
        ],
      }),
      out(['g', 'color'], 400),
    ]);
    const [fn] = fieldFns(r.fragmentShader);
    expect(fn.name).toBe('fieldfn_grid_0_g_circ_0_distance');
    expect(mainOf(r.fragmentShader)).toContain(`${fn.name}(grid_0_g_gridpatter_0_rq, grid_0_g_gridpatter_0_cid, grid_0_g_gridpatter_0_inf, 0.0)`);
    expect(r.fragmentShader).not.toContain('gpShape(');
  });

  it('a chain crossing into a group through typed ports (float Shape, vec3 Picture)', () => {
    const r = compileOk([
      n('uv', 'uv', 0, 0),
      n('circleSDF', 'circ', 100, 0, { radius: 0.3 }, { position: ['uv', 'uv'] }),
      n('fieldCell', 'cell', 0, 200),
      n('palette', 'pal', 100, 200, {}, { value: ['cell', 'index'] }),
      group('g', 300, 0, {
        label: 'Grid', iterations: 1,
        inputs: [
          { key: 'shape', type: 'float', label: 'Shape', from: ['circ', 'distance'] },
          { key: 'pic', type: 'vec3', label: 'Picture', from: ['pal', 'color'] },
        ],
        outputs: [{ key: 'color', type: 'vec3', label: 'Color', from: ['gp', 'color'] }],
        nodes: [n('gridPattern', 'gp', 0, 0, {}, { shape: port('shape'), picture: port('pic') })],
      }),
      out(['g', 'color'], 500),
    ]);
    const fns = fieldFns(r.fragmentShader);
    expect(fns.map(f => `${f.ret} ${f.name}`).sort()).toEqual(['float fieldfn_circ_0_distance', 'vec3 fieldfn_pal_0_color']);
    const shape = fns.find(f => f.ret === 'float')!;
    expect(shape.body).toMatch(/vec2 uv_0_uv = g_uv;/);
    const pic = fns.find(f => f.ret === 'vec3')!;
    expect(pic.body).toMatch(/float fcell_0_idx {3}= fieldIndex;/);
    for (const f of fns) expect(mainOf(r.fragmentShader)).toContain(`${f.name}(grid_0_g_gridpatter_0_`);
  });

  it('a chain crossing two group boundaries: outside → outer group → nested group → Array', () => {
    const inner = group('inner', 0, 0, {
      label: 'Inner', iterations: 1,
      inputs: [{ key: 's', type: 'float', label: 'S', from: port('s') }],
      outputs: [{ key: 'd', type: 'float', label: 'D', from: ['arr', 'distance'] }],
      nodes: [n('arrayField', 'arr', 0, 0, { layout: 'ring', count: 5 }, { shape: port('s') })],
    });
    const r = compileOk([
      n('circleSDF', 'circ', 0, 0, { radius: 0.05 }),
      group('outer', 200, 0, {
        label: 'Outer', iterations: 1,
        inputs: [{ key: 's', type: 'float', label: 'S', from: ['circ', 'distance'] }],
        outputs: [{ key: 'd', type: 'float', label: 'D', from: ['inner', 'd'] }],
        nodes: [inner],
      }),
      out(['outer', 'd'], 400),
    ]);
    const [fn] = fieldFns(r.fragmentShader);
    expect(fn.name).toBe('fieldfn_circ_0_distance');
    expect(mainOf(r.fragmentShader)).toMatch(new RegExp(`${fn.name}\\(outer_0_g_inner_0_g_arr_0_l, `));
  });

  it('a Group whose shape is built in a nested group, into Array’s Shape', () => {
    const r = compileOk([
      group('outer', 0, 0, {
        label: 'Outer', iterations: 1, inputs: [],
        outputs: [{ key: 'd', type: 'float', label: 'D', from: ['g', 'd'] }],
        nodes: [shapeGroup('g', [], 0.1)],
      }),
      n('arrayField', 'arr', 300, 0, { layout: 'grid', count: 9 }, { shape: ['outer', 'd'] }),
      out(['arr', 'color'], 500),
    ]);
    const [fn] = fieldFns(r.fragmentShader);
    expect(fn.name).toBe('fieldfn_outer_0_d');
    // The nested UV node is the function's position too.
    expect(fn.body).toMatch(/vec2 outer_0_g_shape_0_g_uv_0_uv = g_uv;/);
    expect(mainOf(r.fragmentShader)).toContain(`${fn.name}(arr_0_l, `);
  });

  it('an iterated group in the chain: its loop runs inside the field function', () => {
    const r = compileOk([
      n('time', 't', 0, 0),
      group('g', 100, 0, {
        label: 'Grow', iterations: 3,
        inputs: [{ key: 'r', type: 'float', label: 'R', from: ['t', 'time'] }],
        outputs: [{ key: 'r', type: 'float', label: 'R', from: ['add', 'result'] }],
        nodes: [n('add', 'add', 0, 0, { b: 0.05 }, { a: port('r') })],
      }),
      n('circleSDF', 'circ', 300, 0, {}, { radius: ['g', 'r'] }),
      n('gridPattern', 'gp', 500, 0, {}, { shape: ['circ', 'distance'] }),
      out(['gp', 'color'], 700),
    ]);
    const [fn] = fieldFns(r.fragmentShader);
    expect(fn.body).toMatch(/float grow_0_cr = time_0_time;/);
    expect(fn.body).toMatch(/for \(float grow_0_i = 0\.0; grow_0_i < 3\.0; grow_0_i\+\+\)/);
    expect(fn.body).toContain('circleSDF(g_uv - ');
  });

  it('inside an iterated group a shape that does not read the loop works; one that does is an error on the card', () => {
    const iter = (radiusFromPort: boolean) => [
      n('time', 't', 0, 0),
      group('g', 100, 0, {
        label: 'Loop', iterations: 2,
        inputs: [{ key: 'r', type: 'float', label: 'R', from: ['t', 'time'] }],
        outputs: [{ key: 'r', type: 'float', label: 'R', from: ['gp', 'distance'] }],
        nodes: [
          n('circleSDF', 'circ', 0, 0, { radius: 0.2 }, radiusFromPort ? { radius: port('r') } : {}),
          n('gridPattern', 'gp', 200, 0, {}, { shape: ['circ', 'distance'] }),
        ],
      }),
      out(['g', 'r'], 400),
    ];
    const ok = compileOk(iter(false));
    expect(fieldFns(ok.fragmentShader)).toHaveLength(1);
    const bad = compileGraph({ nodes: iter(true) });
    expect(bad.success).toBe(false);
    expect(bad.errors?.[0]).toMatch(/^Node circ: Circle SDF can't be part of a shape wired into Grid Pattern's Shape: it reads a value carried round an iterated group's loop\.$/);
  });

  it('a node that reads the previous frame inside a Group in the chain is reported on the group', () => {
    const r = compileGraph({ nodes: [
      shapeGroup('g', [n('echo', 'echo', 0, 200)]),
      n('gridPattern', 'gp', 400, 0, {}, { shape: ['g', 'd'] }),
      out(['gp', 'color'], 600),
    ] });
    expect(r.success).toBe(false);
    expect(r.errors?.join('\n')).toMatch(/^Node g: Shape can't be part of a shape wired into Grid Pattern's Shape: it contains Echo \(After-image\), which reads the previous frame\.$/m);
  });

  it('one Group into Shape and Picture: each function holds only the nodes feeding its output', () => {
    const r = compileOk([
      group('g', 0, 0, {
        label: 'Flower', iterations: 1, inputs: [],
        outputs: [
          { key: 'd', type: 'float', label: 'Distance', from: ['circ', 'distance'] },
          { key: 'c', type: 'vec3', label: 'Colour', from: ['pal', 'color'] },
        ],
        nodes: [
          n('fieldCell', 'cell', 0, 0),
          n('circleSDF', 'circ', 100, 0, { radius: 0.2 }),
          n('palette', 'pal', 100, 200, {}, { value: ['cell', 'index'] }),
        ],
      }),
      n('arrayField', 'arr', 300, 0, { layout: 'ring', count: 6 }, { shape: ['g', 'd'], picture: ['g', 'c'] }),
      out(['arr', 'color'], 500),
    ]);
    const fns = fieldFns(r.fragmentShader);
    const shape = fns.find(f => f.ret === 'float')!, pic = fns.find(f => f.ret === 'vec3')!;
    expect(shape.body).toContain('circleSDF(');
    expect(shape.body).not.toContain('flower_0_g_pal_0');
    expect(pic.body).toContain('flower_0_g_pal_0');
    expect(pic.body).not.toContain('circleSDF(');
  });

  it('a loose (visual-only) group changes nothing', () => {
    const plain = [shapeGroup('g'), n('gridPattern', 'gp', 400, 0, {}, { shape: ['g', 'd'] }), out(['gp', 'color'], 600)];
    const withLoose = plain.map(nd => nd.type !== 'group' ? nd : {
      ...nd,
      params: { ...nd.params, subgraph: { ...(nd.params.subgraph as object), looseGroups: [{ id: 'lg', label: 'Bits', memberIds: ['circ', 'ring'], collapsed: true, position: { x: 0, y: 0 } }] } },
    });
    expect(compileOk(withLoose).fragmentShader).toBe(compileOk(plain).fragmentShader);
  });

  it('the group’s main() copy is unchanged by the field function (same names, same uniforms)', () => {
    const nodes = [shapeGroup('g'), out(['g', 'd'], 400)];
    const alone = compileOk(nodes);
    const wired = compileOk([shapeGroup('g'), n('gridPattern', 'gp', 400, 0, {}, { shape: ['g', 'd'] }), out(['gp', 'color'], 600)]);
    expect(wired.paramBindings['circ::radius']).toBe(alone.paramBindings['circ::radius']);
    expect(mainOf(wired.fragmentShader)).toContain('float shape_0_g_circ_0_dist = circleSDF(');
    expect(wired.nodeSlugMap?.get('circ')).toBe('shape_0_g_circ_0');
  });
});
