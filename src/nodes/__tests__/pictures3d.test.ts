/**
 * Pictures in 3D (nodes/definitions/pictures3d.ts, docs/pictures-in-3d.md): Picture Card and Texture
 * Material compile into real ray-marched scenes (every mapping, the cutouts, billboards), their GLSL
 * parses, the mapping maths gives the right place on the picture for known points (run on the CPU),
 * the march reads the picture only for a cutout, and the nodes are registered and found by search.
 */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});

import { parser } from '@shaderfrog/glsl-parser';
import { CpuShader } from '../../lib/guidedConvert/cpuGlsl';
import { compileGraph } from '../../compiler/graphCompiler';
import { getNodeDefinition, resolveNodeAliases, NODE_REGISTRY } from '../definitions';
import { PICTURES_3D_GLSL, TEXTURE_MAPPINGS } from '../definitions/pictures3d';
import { EXAMPLE_GRAPHS } from '../../store/exampleGraphs';
import { EXAMPLE_FOLDERS } from '../../store/exampleIndex';
import { PICTURES_3D_EXAMPLE_KEYS } from '../../store/pictures3dExamples';
import { CATEGORY_GROUPS } from '../../components/NodeGraph/libraryRows';
import { n } from '../../store/graphBuilder';
import { expr } from '../../store/agentExampleKit';
import type { GraphNode } from '../../types/nodeGraph';

/** Runs `expr` (a vec4) after the helpers on the CPU. */
function cpu(lines: string, expr: string): number[] {
  const src = ['uniform vec2 X;', PICTURES_3D_GLSL, 'void main() {', lines, `  gl_FragColor = ${expr};`, '}'].join('\n');
  return new CpuShader(src).run([0, 0], { resolution: [8, 8], time: 0, uniforms: { X: [0, 0] } })!;
}
const close = (a: number[], b: number[], d = 1e-4) => b.forEach((v, i) => expect(a[i]).toBeCloseTo(v, -Math.log10(d)));

/** Colour + glow, the two colour outputs, into one. */
const sum = (a: [string, string], b: [string, string]) => expr('sum', 0, 0, {
  label: 'Sum', inputs: [{ name: 'a', type: 'vec3' }, { name: 'b', type: 'vec3' }], lines: [], result: 'a + b', outputType: 'vec3', wires: { a, b }, note: ['Sum.'],
});

/** A small scene: a Scene Group with `inner` (Scene Pos is `sp`; the last float is the distance), a camera, a loop, `after` nodes and the Output. */
function scene(inner: GraphNode[], after: GraphNode[], ports: Array<{ key: string; type: 'texture' | 'vec3' | 'float'; to: [string, string]; from: [string, string] }> = [], outFrom: [string, string]): GraphNode[] {
  const sg = n('sceneGroup', 'sg', 0, 0, {
    subgraph: {
      nodes: [n('scenePos', 'sp', 0, 0, { _groupOriginal: true }), ...inner],
      inputPorts: ports.map(p => ({ key: p.key, type: p.type, label: p.key, toNodeId: p.to[0], toInputKey: p.to[1] })),
      outputPorts: [],
    },
  });
  for (const p of ports) sg.inputs[p.key] = { type: p.type, label: p.key, connection: { nodeId: p.from[0], outputKey: p.from[1] } };
  const body = { nodes: [
    n('marchLoopInputs', 'mi', 0, 0, { _groupOriginal: true }),
    n('marchLoopOutput', 'mo', 0, 0, { _groupOriginal: true }, { pos: ['mi', 'marchPos'] }),
  ], inputPorts: [], outputPorts: [] };
  return [
    n('textureInput', 'pic', 0, 0),
    n('marchCamera', 'cam', 0, 0),
    sg,
    n('marchLoopGroup', 'march', 0, 0, { subgraph: body }, { ro: ['cam', 'ro'], rd: ['cam', 'rd'], scene: ['sg', 'scene'] }),
    ...after,
    n('output', 'out', 0, 0, {}, { color: outFrom }),
  ];
}

function compile(nodes: GraphNode[]) {
  const r = compileGraph({ nodes: resolveNodeAliases(nodes, getNodeDefinition) });
  expect(r.errors ?? [], (r.errors ?? []).join('; ')).toEqual([]);
  expect(r.success).toBe(true);
  expect(() => parser.parse(r.fragmentShader, { quiet: true })).not.toThrow();
  return r.fragmentShader;
}

/** The scene function's body (the `float mapScene…(vec3 p…) { … }` the march calls). */
const sceneFn = (frag: string) => frag.match(/float \w+\(vec3 p[^)]*\) \{[\s\S]*?\n\}/g)?.find(f => f.includes('pt3_box')) ?? '';

describe('Picture Card', () => {
  const card = (params: Record<string, unknown> = {}, extra: Record<string, [string, string]> = {}) => scene(
    [n('pictureCard', 'card', 0, 0, params, { pos: ['sp', 'pos'], ...extra }), n('sceneOutput', 'so', 0, 0, { _groupOriginal: true }, { dist: ['card', 'dist'] })],
    [
      n('pictureCard', 'cardHit', 0, 0, params, { pos: ['march', 'pos'], picture: ['pic', 'texture'], ...(params.facing && params.facing !== 'fixed' ? { camera: ['cam', 'ro'] } : {}) }),
      sum(['cardHit', 'color'], ['cardHit', 'glow']),
    ],
    [{ key: 'picture', type: 'texture', to: ['card', 'picture'], from: ['pic', 'texture'] },
      ...(params.facing && params.facing !== 'fixed' ? [{ key: 'camera', type: 'vec3' as const, to: ['card', 'camera'] as [string, string], from: ['cam', 'ro'] as [string, string] }] : [])],
    ['sum', 'result'],
  );

  it('is registered in 3D Primitives, listed in the library, and found by its other names', () => {
    const def = getNodeDefinition('pictureCard')!;
    expect(def.category).toBe('3D Primitives');
    expect(NODE_REGISTRY.pictureCard?.type).toBe('pictureCard');
    expect(CATEGORY_GROUPS['3D Primitives'].flatMap(g => g.types)).toContain('pictureCard');
    expect(def.aliases).toEqual(expect.arrayContaining(['Billboard', 'Video card', 'Image plane']));
  });

  it.each([
    ['plain', {}],
    ['emissive, back colour', { emissive: 0.6, back: 'colour' }],
    ['readable back', { back: 'readable' }],
    ['custom aspect', { aspectFrom: 'custom', aspect: 0.75 }],
    ['alpha cutout', { cutout: 'alpha' }],
    ['bright cutout', { cutout: 'bright', threshold: 0.2 }],
    ['dark cutout', { cutout: 'dark' }],
    ['billboard', { facing: 'camera' }],
    ['upright billboard', { facing: 'upright', cutout: 'bright' }],
  ])('compiles in a ray-marched scene (%s)', (_, params) => {
    compile(card(params));
  });

  it('the march reads the picture only for a cutout, and only near the card', () => {
    const plain = sceneFn(compile(card()));
    expect(plain).toMatch(/pt3_box/);
    expect(plain).not.toMatch(/texture(Lod|Grad)?\(|pt3_read/);
    const cut = sceneFn(compile(card({ cutout: 'alpha' })));
    expect(cut.match(/textureLod\(/g)?.length).toBe(1);
    expect(cut).toMatch(/if \(\w+_dist < /);
    expect(cut).not.toMatch(/pt3_read|textureGrad/);
  });

  it('after the march the colour is read with textureGrad (screen derivatives), and the aspect comes from the picture', () => {
    const frag = compile(card());
    expect(frag).toMatch(/pt3_read\(u_tex_\w+, \w+_cuv, \w+_dx, \w+_dy, 0\.0\)/);
    expect(frag).toMatch(/textureGrad\(t, s, pt3_cap\(dx\), pt3_cap\(dy\)\)/);
    expect(frag).toMatch(/pt3_half\([^;]*pt3_aspect\(u_tex_/);
  });

  it('a card at 0 faces +Z and reads the right way round from a camera at Angle 0 (u along −X)', () => {
    // A 2 × 1 card (Size 2, aspect 2): its corners on the picture
    const hs = 'vec2 hs = pt3_half(2.0, 2.0);';
    close(cpu(hs, 'vec4(hs, 0.0, 0.0)'), [1, 0.5]);
    close(cpu(hs, 'vec4(pt3_cardUv(vec3(0.0), hs), 0.0, 0.0)'), [0.5, 0.5]);
    close(cpu(hs, 'vec4(pt3_cardUv(vec3(-1.0, 0.5, 0.0), hs), 0.0, 0.0)'), [1, 1]); // screen right (−X), top
    close(cpu(hs, 'vec4(pt3_cardUv(vec3(1.0, -0.5, 0.0), hs), 0.0, 0.0)'), [0, 0]);
    // A portrait picture: Size is the longer side
    close(cpu('', 'vec4(pt3_half(2.0, 0.5), 0.0, 0.0)'), [0.5, 1]);
    // Its distance: on the face 0, 1 in front of it 1 (thickness 0)
    close(cpu(hs, 'vec4(pt3_box(vec3(0.3, 0.2, 0.0), vec3(hs, 0.0)), pt3_box(vec3(0.3, 0.2, 1.0), vec3(hs, 0.0)), 0.0, 0.0)'), [0, 1]);
  });

  it('turns X, then Y, then Z (the Transform node\'s order), and a billboard faces the camera', () => {
    // Turned 90° about Y, the card faces +X: a point 1 along +X is 1 in front of its face (local +Z)
    close(cpu('vec3 q = pt3_unturn(vec3(1.0, 0.0, 0.0), vec3(0.0, 1.5707963, 0.0));', 'vec4(q, 0.0)'), [0, 0, 1]);
    // 90° about X, then 90° about Y: local +Y goes to +Z, then to +X (the other order would leave it at +Y)
    close(cpu('vec3 q = pt3_unturn(vec3(1.0, 0.0, 0.0), vec3(1.5707963, 1.5707963, 0.0));', 'vec4(q, 0.0)'), [0, 1, 0]);
    // Billboard with the camera along +X: towards it is local +Z; world +Z is local −X (the camera's right, where u grows)
    close(cpu('vec3 q = pt3_face(vec3(0.0, 0.0, 1.0), vec3(5.0, 0.0, 0.0), 0.0);', 'vec4(q, 0.0)'), [-1, 0, 0]);
    close(cpu('vec3 q = pt3_face(vec3(1.0, 0.0, 0.0), vec3(5.0, 3.0, 0.0), 1.0);', 'vec4(q, 0.0)'), [0, 0, 1]);
  });

  it('cutout keys: alpha, bright, dark', () => {
    close(cpu('vec4 c = vec4(1.0, 1.0, 1.0, 0.25);', 'vec4(pt3_key(c, 0.0), pt3_key(c, 1.0), pt3_key(c, 2.0), 0.0)'), [0.25, 0.25, 0]);
    close(cpu('vec4 c = vec4(0.0, 0.0, 0.0, 1.0);', 'vec4(pt3_key(c, 0.0), pt3_key(c, 1.0), pt3_key(c, 2.0), 0.0)'), [1, 0, 1]);
  });
});

describe('Texture Material', () => {
  const mat = (params: Record<string, unknown>, wires: Record<string, [string, string]> = {}) => scene(
    [n('sphereSDF3D', 'ball', 0, 0, {}, { pos: ['sp', 'pos'] }), n('sceneOutput', 'so', 0, 0, { _groupOriginal: true }, { dist: ['ball', 'dist'] })],
    [n('textureMaterial', 'tm', 0, 0, params, { pos: ['march', 'pos'], picture: ['pic', 'texture'], ...wires }), sum(['tm', 'color'], ['tm', 'glow'])],
    [], ['sum', 'result'],
  );

  it('is registered in 3D Lighting, listed under Surface, and found by its other names', () => {
    const def = getNodeDefinition('textureMaterial')!;
    expect(def.category).toBe('3D Lighting');
    expect(CATEGORY_GROUPS['3D Lighting'].flatMap(g => g.types)).toContain('textureMaterial');
    expect(def.aliases).toEqual(expect.arrayContaining(['Triplanar', 'Box mapping']));
  });

  it.each(TEXTURE_MAPPINGS.flatMap(m => ['replace', 'multiply', 'emissive'].map(c => [m, c] as const)))('compiles: %s, %s', (mapping, combine) => {
    const frag = compile(mat({ mapping, combine }, { normal: ['march', 'normal'], base: ['march', 'color'], mask: ['march', 'hit'] }));
    expect(frag.match(/pt3_read\(u_tex_/g)?.length).toBe(mapping === 'triplanar' ? 3 : 1);
  });

  it.each(TEXTURE_MAPPINGS)('compiles with the normal worked out from Position, Edges: Once, custom aspect (%s)', mapping => {
    const frag = compile(mat({ mapping, edges: 'once', aspectFrom: 'custom', aspect: 0.75 }));
    expect(frag).toMatch(/-normalize\(cross\(\w+_dpx, \w+_dpy\)/);
  });

  it('unwired, it shows a checker and still compiles', () => {
    const nodes = mat({ mapping: 'box' }).map(x => (x.id === 'tm' ? { ...x, inputs: { ...x.inputs, picture: { ...x.inputs.picture, connection: undefined } } } : x));
    expect(compile(nodes)).toMatch(/pt3_checker\(/);
  });

  // ── The mapping maths for known points ──
  const flat = (c: string) => `(pt3_flat(${c}, 1.0, 1.0) + 0.5)`;
  it('planar X / Y / Z: a unit picture centred on the axis, read the right way round from that side', () => {
    // Planar Z from a camera at Angle 0 (+Z): screen right is −X, so x −0.5 is the picture's right edge
    close(cpu('', `vec4(${flat('pt3_projZ(vec3(-0.5, 0.5, 3.0), 1.0)')}, 0.0, 0.0)`), [1, 1]);
    // Planar X seen from +X (Angle 90°): screen right is +Z
    close(cpu('', `vec4(${flat('pt3_projX(vec3(7.0, -0.5, 0.5), 1.0)')}, 0.0, 0.0)`), [1, 0]);
    // Planar Y seen from above: screen right is −X, screen up is −Z
    close(cpu('', `vec4(${flat('pt3_projY(vec3(-0.5, 2.0, -0.5), 1.0)')}, 0.0, 0.0)`), [1, 1]);
    // Size 2 and aspect 2: a 4 × 2 picture
    close(cpu('', 'vec4(pt3_flat(vec2(2.0, 1.0), 2.0, 2.0) + 0.5, 0.0, 0.0)'), [1, 1]);
  });

  it('box and triplanar: each side reads the right way round from outside (the face sign)', () => {
    close(cpu('vec3 s = pt3_faceSign(vec3(-0.9, 0.1, 0.0));', 'vec4(s, 0.0)'), [-1, 1, 1]);
    // From −X the screen's right is −Z: z −0.5 is the right edge
    close(cpu('vec3 s = pt3_faceSign(vec3(-1.0, 0.0, 0.0));', `vec4(${flat('pt3_projX(vec3(-1.0, 0.0, -0.5), s.x)')}, 0.0, 0.0)`), [1, 0.5]);
  });

  it('sphere: the front (+Z) is the picture\'s middle, the right (−X) a quarter round, the top its top edge', () => {
    close(cpu('', 'vec4(pt3_sphereSt(vec3(0.0, 0.0, 2.0)), 0.0, 0.0)'), [0.5, 0.5]);
    close(cpu('', 'vec4(pt3_sphereSt(vec3(-1.0, 0.0, 0.0)), 0.0, 0.0)'), [0.75, 0.5]);
    close(cpu('', 'vec4(pt3_sphereSt(vec3(1.0, 0.0, 0.0)), 0.0, 0.0)'), [0.25, 0.5]);
    expect(cpu('', 'vec4(pt3_sphereSt(vec3(0.0, 1.0, 0.0)), 0.0, 0.0)')[1]).toBeCloseTo(1, 3);
    // The jump at the seam is taken out of the derivative (Repeat round 2: a jump of 2)
    close(cpu('', 'vec4(pt3_dewrap(vec2(0.98, 0.1), 1.0), pt3_dewrap(vec2(-1.97, 0.0), 2.0))'), [-0.02, 0.1, 0.03, 0]);
  });

  it('offset slides the picture and turn turns it about its middle', () => {
    // Offset +0.25 across: the picture's middle is now read at the place 0.75
    close(cpu('', 'vec4(pt3_place(vec2(0.75, 0.5), 0.0, vec2(0.25, 0.0)), 0.0, 0.0)'), [0.5, 0.5]);
    // Turned 90°: the picture's right-hand middle (1, 0.5) now shows at the top middle (0.5, 1)
    close(cpu('', 'vec4(pt3_place(vec2(0.5, 1.0), 1.5707963, vec2(0.0)), 0.0, 0.0)'), [1, 0.5]);
  });
});

describe('the 3D: Pictures examples', () => {
  it('are in their folder, and every node has a note', () => {
    expect(EXAMPLE_FOLDERS.find(f => f.label === '3D: Pictures')?.keys).toEqual(PICTURES_3D_EXAMPLE_KEYS);
    const all = (nodes: GraphNode[]): GraphNode[] => nodes.flatMap(x => [x, ...all(((x.params.subgraph as { nodes?: GraphNode[] } | undefined)?.nodes) ?? [])]);
    for (const k of PICTURES_3D_EXAMPLE_KEYS) {
      for (const x of all(EXAMPLE_GRAPHS[k].nodes)) {
        if (x.type === 'output') continue;
        expect(typeof x.params.__comment, `${k}: ${x.id}`).toBe('string');
      }
    }
  });

  it.each(PICTURES_3D_EXAMPLE_KEYS)('%s compiles and parses', k => {
    const frag = compile(EXAMPLE_GRAPHS[k].nodes);
    expect(frag).toMatch(/pt3_/);
  });
});
