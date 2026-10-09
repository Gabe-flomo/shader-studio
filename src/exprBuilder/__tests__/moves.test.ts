/**
 * The Expression Builder's move catalogue (docs/expression-builder-plan.md, phase 1).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import raw from '../prebuilt/moves.json?raw';
import { EXAMPLE_GRAPHS } from '../../store/exampleGraphs';
import { parseExpr, inferTypes, typesFromCode, type GlslType } from '../../lib/glslPatterns';
import { fileDoc, graphDoc } from '../../codeExplorer/corpus';
import { ALWAYS_HELPERS_GLSL } from '../../compiler/shaderAssembler';
import type { GraphNode } from '../../types/nodeGraph';
import type { KV } from '../../utils/library';
import {
  applyMove, buildCatalogue, followers, mergeCatalogues, movesFor, sourceLabel, templateEnv, typeOfExpr,
  type Catalogue, type Dimension, type Move, type MoveDoc,
} from '../moves';
import { exampleMoveDocs } from '../exampleMoves';
import { packCatalogue, unpackCatalogue, type PackedCatalogue } from '../pack';
import { generatedMoves } from '../generated';
import { HELPER_TYPES } from '../shared';
import { LocalMoves, userMoveDocs } from '../localMoves';

const corpusFiles = import.meta.glob('../../glslToGraph/__tests__/corpus/*.frag', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

let cat: Catalogue;
let mined: Move[];
beforeAll(() => {
  cat = unpackCatalogue(JSON.parse(raw) as PackedCatalogue);
  mined = cat.moves.filter(m => !m.generated);
});

// ── Small graphs, hand-checked ────────────────────────────────────────────────

let uid = 0;
function node(id: string, type: string, inputs: Record<string, { type: string; from?: [string, string] }> = {}, outputs: Record<string, string> = {}, params: Record<string, unknown> = {}): GraphNode {
  return {
    id, type, position: { x: uid++, y: 0 },
    inputs: Object.fromEntries(Object.entries(inputs).map(([k, v]) => [k, { type: v.type, label: k, ...(v.from ? { connection: { nodeId: v.from[0], outputKey: v.from[1] } } : {}) }])),
    outputs: Object.fromEntries(Object.entries(outputs).map(([k, t]) => [k, { type: t, label: k }])),
    params,
  } as GraphNode;
}
function block(id: string, inputs: Record<string, { type: string; from?: [string, string] }>, lines: Array<[string, string, string?]>, result: string, outputType = 'vec3'): GraphNode {
  return node(id, 'exprNode', inputs, { result: outputType }, {
    inputs: Object.entries(inputs).map(([name, v]) => ({ name, type: v.type })),
    outputType,
    lines: lines.map(([lhs, rhs, op]) => ({ lhs, op: op ?? '=', rhs })),
    result,
  });
}
function graphCatalogue(nodes: GraphNode[], id = 'saved:test'): Catalogue {
  const doc = graphDoc(id, 'saved', 'Test', 'Saved graphs', nodes)!;
  return buildCatalogue([{ doc, nodes }], { generated: false });
}
const find = (c: Catalogue, template: string, inType?: GlslType) => c.moves.find(m => m.template === template && (!inType || m.sig.in === inType));

const SEED: Record<string, { expr: string; env: Record<string, GlslType> }> = {
  float: { expr: 'd', env: { d: 'float' } },
  int: { expr: 'i', env: { i: 'int' } },
  vec2: { expr: 'uv * 2.0 - 1.0', env: { uv: 'vec2' } },
  vec3: { expr: 'p', env: { p: 'vec3' } },
  vec4: { expr: 'c', env: { c: 'vec4' } },
};

describe('the catalogue', () => {
  it('has at least 150 distinct mined moves across 2D, 3D and 1D, each with a signature, contexts and sources', () => {
    expect(mined.length).toBeGreaterThanOrEqual(150);
    expect(new Set(mined.map(m => m.key)).size).toBe(mined.length);
    expect(new Set(cat.moves.map(m => m.id)).size).toBe(cat.moves.length);
    for (const m of mined) {
      expect(['float', 'vec2', 'vec3', 'vec4']).toContain(m.sig.in);
      expect(['float', 'vec2', 'vec3', 'vec4']).toContain(m.sig.out);
      expect(m.sig.role).toBeTruthy();
      expect(m.contexts.length).toBeGreaterThan(0);
      expect(m.sources.length).toBeGreaterThan(0);
      expect(m.count).toBeGreaterThan(0);
      for (const s of m.sources) expect(cat.docs[s.doc]).toBeTruthy();
    }
    const byDim = (d: Dimension) => mined.filter(m => m.contexts.some(c => c.dim === d)).length;
    expect(byDim('2d')).toBeGreaterThanOrEqual(150);
    expect(byDim('3d-world')).toBeGreaterThanOrEqual(30);
    expect(byDim('3d-surface')).toBeGreaterThanOrEqual(30);
    expect(byDim('1d-time')).toBeGreaterThanOrEqual(30);
  });

  it('records holes: numbers with defaults and ranges from the values seen, names typed', () => {
    const zoom = find(cat, 'x * #a', 'vec2')!;
    expect(zoom.family).toBe('scale');
    const k = zoom.holes[0];
    expect(k.kind).toBe('number');
    if (k.kind === 'number') {
      expect(k.vals.length).toBeGreaterThan(1);
      // The usual values (10th–90th percentile), not the far-off ones, kept to a zoom's size.
      expect(k.range.min).toBeLessThanOrEqual(k.default);
      expect(k.range.max).toBeGreaterThanOrEqual(k.default);
      expect(k.range.max).toBeLessThanOrEqual(64);
      const used = k.vals.reduce((s, [, n]) => s + n, 0);
      const inside = k.vals.filter(([v]) => v >= k.range.min && v <= k.range.max).reduce((s, [, n]) => s + n, 0);
      expect(inside / used).toBeGreaterThan(0.75);
      expect(k.default).toBe(k.vals[0][0]);
    }
    for (const m of mined) for (const h of m.holes) {
      if (h.kind === 'number') { expect(Number.isFinite(h.default)).toBe(true); expect(h.range.max).toBeGreaterThanOrEqual(h.range.min); }
      else { expect(h.type).not.toBe('unknown'); expect(h.default).toBeTruthy(); }
    }
  });

  it('names sources: examples by label, the user’s code as theirs, with node paths to jump to', () => {
    const m = mined.find(x => x.sources.some(s => s.path?.length))!;
    const s = m.sources.find(x => x.path?.length)!;
    expect(cat.docs[s.doc].id).toMatch(/^example:/);
    expect(sourceLabel(cat, s)).toBe(cat.docs[s.doc].label);
    expect(s.field).toBeTruthy();
    expect(s.line).toBeGreaterThan(0);
    const mine: Catalogue = { ...cat, docs: [{ id: 'shader:abc', label: 'Tunnel', origin: 'saved' }] };
    expect(sourceLabel(mine, { doc: 0 })).toBe('your import: Tunnel');
  });

  it('knows its techniques (the pattern index) where code sits in a graph', () => {
    expect(mined.some(m => m.contexts.some(c => c.techniques.length > 0))).toBe(true);
  });

  it('mines the expected families', () => {
    const fams = new Set(mined.map(m => m.family));
    for (const f of ['scale', 'offset', 'repeat', 'fold', 'wave', 'distance', 'colour', 'cell', 'mask', 'warp']) expect(fams, f).toContain(f);
    expect(find(cat, 'fract(x)', 'vec2')?.family).toBe('repeat');
    expect(find(cat, 'abs(x)', 'vec2')?.family).toBe('fold');
    expect(find(cat, 'length(x)', 'vec2')?.sig.out).toBe('float');
  });
});

describe('applyMove', () => {
  it('parses and type-checks for every move, on a seed of its input type', () => {
    for (const m of cat.moves) {
      const seed = SEED[m.sig.in];
      const out = applyMove(seed.expr, m);
      const r = parseExpr(out);
      expect(r.ok, `${m.template} → ${out}`).toBe(true);
      expect(typeOfExpr(out, seed.env), `${m.template} → ${out}`).toBe(m.sig.out);
    }
  });

  it('fills holes from values, names and defaults, with parentheses where needed', () => {
    const repeat: Pick<Move, 'template' | 'holes'> = {
      template: 'fract(x * #a) - #b',
      holes: [
        { name: '#a', kind: 'number', type: 'float', default: 4, range: { min: 0, max: 8 }, seenMin: 4, seenMax: 4, vals: [] },
        { name: '#b', kind: 'number', type: 'float', default: 0.5, range: { min: 0, max: 1 }, seenMin: 0.5, seenMax: 0.5, vals: [] },
      ],
    };
    expect(applyMove('uv + 1.0', repeat)).toBe('fract((uv + 1.0) * 4.0) - 0.5');
    expect(applyMove('uv', repeat, { '#a': 3, b: 0.25 })).toBe('fract(uv * 3.0) - 0.25');
    const warp: Pick<Move, 'template' | 'holes'> = {
      template: 'x + #a * sin(x.yx * #b + $t)',
      holes: [
        { name: '#a', kind: 'number', type: 'float', default: 0.1, range: { min: 0, max: 1 }, seenMin: 0.1, seenMax: 0.1, vals: [] },
        { name: '#b', kind: 'number', type: 'float', default: 3, range: { min: 0, max: 10 }, seenMin: 3, seenMax: 3, vals: [] },
        { name: '$t', kind: 'var', type: 'float', role: 'time', names: ['t'], default: 'u_time' },
      ],
    };
    expect(applyMove('uv * 2.0', warp)).toBe('uv * 2.0 + 0.1 * sin((uv * 2.0).yx * 3.0 + u_time)');
    expect(applyMove('p', warp, { $t: 'time * 0.5', '#a': -0.2 })).toBe('p + -0.2 * sin(p.yx * 3.0 + time * 0.5)');
    expect(typeOfExpr(applyMove('uv', warp), { uv: 'vec2' })).toBe('vec2');
  });
});

describe('generated moves', () => {
  it('cover swizzles, coupling, products and rotations, for vec2 and vec3', () => {
    const gen = generatedMoves();
    for (const fam of ['swizzle', 'couple', 'product', 'rotate'] as const) {
      for (const t of ['vec2', 'vec3'] as const) expect(gen.some(m => m.family === fam && m.sig.in === t), `${fam} ${t}`).toBe(true);
    }
    for (const m of gen) {
      expect(m.generated).toBe(true);
      const env = templateEnv(m);
      const r = parseExpr(m.template);
      expect(r.ok).toBe(true);
      if (r.ok) expect(inferTypes(r.expr, { ...env, 'rotate()': 'vec2' }).get(r.expr.id)).toBe(m.sig.out);
    }
    // Rotations in each plane of 3D
    const rot3 = gen.filter(m => m.family === 'rotate' && m.sig.in === 'vec3').map(m => m.template);
    expect(rot3.some(t => t.includes('x.xy'))).toBe(true);
    expect(rot3.some(t => t.includes('x.xz'))).toBe(true);
    expect(rot3.some(t => t.includes('x.yz'))).toBe(true);
    // In the catalogue, and found for a seed of their type
    expect(cat.moves.filter(m => m.generated).length).toBeGreaterThan(20);
    const for3 = movesFor({ type: 'vec3', role: 'space', dimension: '3d-world' }, cat);
    expect(for3.some(m => m.generated && m.template === 'x.zxy')).toBe(true);
  });

  it('the helper table matches the helpers every shader has', () => {
    const env = typesFromCode(ALWAYS_HELPERS_GLSL());
    for (const [name, type] of Object.entries(HELPER_TYPES)) expect(env[`${name}()`], name).toBe(type);
  });
});

describe('contexts', () => {
  it('tags a UV move 2D, a March Loop world-space move 3D world, a normal move 3D surface, a time move 1D', () => {
    const nodes: GraphNode[] = [
      node('uvn', 'uv', {}, { uv: 'vec2' }),
      node('tm', 'time', {}, { time: 'float' }),
      block('tiles', { uv: { type: 'vec2', from: ['uvn', 'uv'] } }, [['vec2 q', 'fract(uv * 4.0) - 0.5']], 'q', 'vec2'),
      block('pulse', { time: { type: 'float', from: ['tm', 'time'] } }, [], 'sin(time * 2.0) * 0.5 + 0.5', 'float'),
      node('pal', 'palette', { t: { type: 'float', from: ['pulse', 'result'] } }, { color: 'vec3' }),
      node('ml', 'marchLoopGroup', {}, { normal: 'vec3', pos: 'vec3', color: 'vec3' }, {
        subgraph: {
          nodes: [
            node('mli', 'marchLoopInputs', {}, { marchPos: 'vec3', marchDist: 'float', rd: 'vec3', ro: 'vec3' }),
            block('fold', { p: { type: 'vec3', from: ['mli', 'marchPos'] } }, [['p', 'abs(p) - 0.7']], 'p'),
          ],
          inputPorts: [], outputPorts: [],
        },
      }),
      block('shade', { n: { type: 'vec3', from: ['ml', 'normal'] } }, [], 'n * 0.5 + 0.5'),
    ];
    const c = graphCatalogue(nodes);
    const dims = (m: Move | undefined) => new Set(m?.contexts.map(x => x.dim));
    const feeds = (m: Move | undefined) => new Set(m?.contexts.map(x => x.feed));

    const repeat = find(c, 'fract(x * #a) - #b', 'vec2');
    expect(dims(repeat)).toEqual(new Set(['2d']));
    expect(feeds(repeat)).toEqual(new Set(['uv']));
    expect(repeat?.sig.role).toBe('space');

    const fold = find(c, 'abs(x) - #a', 'vec3');
    expect(dims(fold)).toEqual(new Set(['3d-world']));
    expect(feeds(fold)).toEqual(new Set(['position']));

    // `n * 0.5 + 0.5` on the March Loop's normal: on the surface.
    const normal = c.moves.find(m => m.sig.in === 'vec3' && m.contexts.some(x => x.feed === 'normal') && m.template.includes('+'));
    expect(normal?.template).toMatch(/^x \* #[ab] \+ #[ab]$/);
    expect(dims(normal)).toEqual(new Set(['3d-surface']));
    expect(normal?.sig.role).toBe('direction');

    const wave = find(c, 'sin(x * #a)', 'float');
    expect(dims(wave)).toEqual(new Set(['1d-time']));
    expect(wave?.sig.role).toBe('time');
    // …and what it went into: the Palette's t.
    const whole = c.moves.find(m => m.sig.in === 'float' && /^sin\(x \* #\w\) \* #\w \+ #\w$/.test(m.template));
    expect(whole?.contexts.map(x => x.into)).toEqual(['palette']);
  });

  it('tags real March Loop code in the examples as 3D world', () => {
    let checked = 0;
    for (const [key, g] of Object.entries(EXAMPLE_GRAPHS)) {
      const loops = (g.nodes as GraphNode[]).filter(n => n.type === 'marchLoopGroup');
      const hasCode = loops.some(l => ((l.params.subgraph as { nodes: GraphNode[] }).nodes ?? []).some(n => n.type === 'exprNode' && Object.values(n.inputs).some(i => i.connection?.outputKey === 'marchPos')));
      if (!hasCode) continue;
      const docs = exampleMoveDocs({ [key]: g } as never);
      const c = buildCatalogue(docs, { generated: false });
      const fromPos = c.moves.flatMap(m => m.contexts).filter(x => x.feed === 'position');
      expect(fromPos.length, key).toBeGreaterThan(0);
      for (const x of fromPos) expect(x.dim, key).toBe('3d-world');
      if (++checked >= 3) break;
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('mines imported GLSL whole: helper functions with their local variables', () => {
    const docs: MoveDoc[] = Object.entries(corpusFiles).map(([path, code]) => ({ doc: fileDoc(`file:test/${path.split('/').pop()}`, 'linked', path, 'Linked files', 'file', code)! }));
    const c = buildCatalogue(docs, { generated: false });
    expect(c.moves.length).toBeGreaterThan(50);
    // hash21's `p = fract(p * vec2(123.34, 456.21))`: a local in a helper function, typed from its parameter.
    const hash = c.moves.find(m => m.template === 'fract(x * vec2(#a, #b))' && m.sig.in === 'vec2');
    expect(hash).toBeTruthy();
    expect(sourceLabel(c, hash!.sources[0])).toMatch(/^your import: /);
    expect(hash!.sources[0].field).toBe('code');
    // noise's `vec2 u = f * f * (3.0 - 2.0 * f)` (the smoothstep curve) on a local made by fract.
    expect(c.moves.some(m => m.sig.in === 'vec2' && /x \* x \* \(#a - #b \* x\)/.test(m.template))).toBe(true);
  });
});

describe('order statistics', () => {
  it('collects which move follows which, across the corpus', () => {
    expect(cat.order.length).toBeGreaterThan(300);
    expect(new Set(cat.order.map(o => o.dim)).size).toBeGreaterThanOrEqual(3);
    // A fract repeat is followed by a centring move.
    const fr = cat.moves.filter(m => m.template === 'fract(x)');
    const next = fr.flatMap(m => followers(m, cat)).filter(f => f.move.template === 'x - #a');
    expect(next.reduce((n, f) => n + f.n, 0)).toBeGreaterThanOrEqual(2);
    // A compound is followed by what follows its last step.
    const compound = cat.moves.find(m => m.template === 'fract(x * #a)' && m.steps?.length === 2);
    expect(compound).toBeTruthy();
    expect(followers(compound!, cat).length).toBeGreaterThan(0);
  });

  it('chains steps inside a statement, across statements, and across wires', () => {
    const nodes: GraphNode[] = [
      node('uvn', 'uv', {}, { uv: 'vec2' }),
      block('a', { uv: { type: 'vec2', from: ['uvn', 'uv'] } }, [['vec2 q', 'fract(uv * 4.0)'], ['q', '0.5', '-=']], 'q', 'vec2'),
      block('b', { q: { type: 'vec2', from: ['a', 'result'] } }, [], 'length(q)', 'float'),
    ];
    const c = graphCatalogue(nodes);
    const id = (t: string, inType: GlslType) => find(c, t, inType)!.id;
    const pair = (from: string, to: string) => c.order.find(o => o.from === from && o.to === to);
    expect(pair(id('x * #a', 'vec2'), id('fract(x)', 'vec2'))).toBeTruthy(); // in a statement
    expect(pair(id('fract(x)', 'vec2'), id('x - #a', 'vec2'))).toBeTruthy(); // across statements
    expect(pair(id('x - #a', 'vec2'), id('length(x)', 'vec2'))).toBeTruthy(); // across a wire
    expect(c.order.every(o => o.dim === '2d')).toBe(true);
  });
});

describe('movesFor', () => {
  it('filters by type, role and dimension, and narrows by feeds / into / techniques', () => {
    const uv = movesFor({ type: 'vec2', role: 'space', dimension: '2d' }, cat);
    expect(uv.length).toBeGreaterThan(50);
    for (const m of uv) {
      expect(m.sig.in).toBe('vec2');
      expect(['space', 'unknown']).toContain(m.sig.role);
      expect(m.contexts.some(c => c.dim === '2d')).toBe(true);
    }
    const fromUv = movesFor({ type: 'vec2', role: 'space', dimension: '2d', feeds: 'uv' }, cat);
    expect(fromUv.length).toBeLessThan(uv.length);
    expect(fromUv.filter(m => !m.generated).every(m => m.contexts.some(c => c.dim === '2d' && c.feed === 'uv'))).toBe(true);
    const world = movesFor({ type: 'vec3', dimension: '3d-world' }, cat);
    expect(world.filter(m => !m.generated).length).toBeGreaterThan(10);
    const time = movesFor({ type: 'float', role: 'time', dimension: '1d-time' }, cat);
    expect(time.filter(m => !m.generated).length).toBeGreaterThan(10);
    const intoDist = movesFor({ type: 'vec2', dimension: '2d', into: 'distance' }, cat);
    expect(intoDist.some(m => m.template.startsWith('length('))).toBe(true);
  });
});

describe('packing and local updates', () => {
  it('packs and unpacks to the same catalogue', () => {
    const docs = exampleMoveDocs(Object.fromEntries(Object.entries(EXAMPLE_GRAPHS).slice(0, 60)) as never);
    const c = buildCatalogue(docs);
    expect(unpackCatalogue(packCatalogue(c, 'h'))).toEqual(c);
    expect(mergeCatalogues(c)).toEqual(c);
  });

  it('mines the user’s saved graphs and shaders locally, and keeps them current', () => {
    const store = new Map<string, string>();
    const kv: KV = { keys: () => [...store.keys()], get: k => store.get(k) ?? null, set: (k, v) => { store.set(k, v); } };
    const nodes = [
      node('uvn', 'uv', {}, { uv: 'vec2' }),
      block('k', { uv: { type: 'vec2', from: ['uvn', 'uv'] } }, [['vec2 p', 'abs(uv) - 0.3'], ['p', 'p * 1.7']], 'length(p)', 'float'),
    ];
    store.set('shader-studio:My kaleido', JSON.stringify({ nodes, connections: [] }));
    store.set('shader-studio:glsl-shaders', JSON.stringify([{ id: 's1', name: 'Tunnel', code: 'vec2 tunnel(vec2 p) { float a = atan(p.y, p.x); float r = length(p); return vec2(a / 3.1416, 0.3 / r); }' }]));
    const local = new LocalMoves(cat);
    const docs = userMoveDocs(kv, null);
    expect(docs.map(d => d.doc.docId).sort()).toEqual(['saved:My kaleido', 'shader:s1']);
    expect(docs.find(d => d.doc.docId === 'saved:My kaleido')?.nodes).toBeTruthy();
    expect(local.sync(['saved:', 'shader:'], docs)).toMatchObject({ added: 2 });
    const merged = local.catalogue();
    const fold = merged.moves.find(m => m.template === 'abs(x) - #a' && m.sig.in === 'vec2')!;
    const mineSrc = fold.sources.find(s => merged.docs[s.doc].id === 'saved:My kaleido')!;
    expect(mineSrc.path).toEqual(['k']);
    expect(fold.contexts.some(c => c.feed === 'uv' && c.dim === '2d')).toBe(true);
    const polar = merged.moves.find(m => m.template === 'atan(x.y, x.x)' && m.sources.some(s => merged.docs[s.doc].id === 'shader:s1'));
    expect(polar).toBeTruthy();
    expect(sourceLabel(merged, polar!.sources.find(s => merged.docs[s.doc].id === 'shader:s1')!)).toBe('your import: Tunnel');
    // Counts add to the examples'
    expect(fold.count).toBeGreaterThan(find(cat, 'abs(x) - #a', 'vec2')?.count ?? 0);
    // Unchanged: nothing re-mined; removed: gone.
    expect(local.sync(['saved:', 'shader:'], userMoveDocs(kv, null))).toMatchObject({ unchanged: 2, added: 0, updated: 0 });
    store.delete('shader-studio:glsl-shaders');
    const rev = local.revision;
    expect(local.sync(['saved:', 'shader:'], userMoveDocs(kv, null))).toMatchObject({ removed: 1 });
    expect(local.revision).toBe(rev + 1);
    expect(local.catalogue().docs.some(d => d.id === 'shader:s1' && local.catalogue().moves.some(m => m.sources.some(s => local.catalogue().docs[s.doc] === d)))).toBe(false);
  });
});
