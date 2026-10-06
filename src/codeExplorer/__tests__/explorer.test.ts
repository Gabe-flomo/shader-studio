/**
 * Code Explorer phase 1: tokenizer and shapes, pattern levels, the plan's real
 * counts over the bundled examples, provenance, incremental updates, the
 * worker protocol (in place), free-text search with synonyms, and jump plans.
 */
import { describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import { EXAMPLE_GRAPHS } from '../../store/exampleGraphs';
import { tokenize } from '../tokenizer';
import { parseExpression, parseSource } from '../parser';
import { shapes } from '../shape';
import { mergeVariants } from '../antiUnify';
import { bundledExampleDocs } from '../exampleCorpus';
import { exprBlockSource, fileDoc, graphDoc } from '../corpus';
import { extractDoc } from '../extract';
import { CodeIndex } from '../codeIndex';
import { findIndexedUses, functionReport, searchPatterns, summarise } from '../queries';
import { createHost, type InitResult, type SyncResult, type PrebuiltIndex } from '../host';
import { idbStore, memoryStore } from '../store';
import { collectUserDocs } from '../userCorpus';
import { exprFieldLabel, offsetOf, planJump } from '../jump';
import { explainPattern } from '../explain';
import { INDEX_SCHEMA, type DocInput, type DocRecord } from '../types';

const call = (src: string) => shapes(parseExpression(src));

// The converter's test corpus (the plan's §9 numbers include it).
const corpusFiles = import.meta.glob('../../glslToGraph/__tests__/corpus/*.frag', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

const exampleDocs = bundledExampleDocs(EXAMPLE_GRAPHS as never);
const exampleRecords = exampleDocs.map(d => extractDoc(d, 0));

function indexOf(records: DocRecord[]): CodeIndex {
  const ix = new CodeIndex();
  for (const r of records) ix.put(r);
  return ix;
}

describe('tokenizer', () => {
  it('blanks comments without moving offsets and skips directives', () => {
    const src = '#define K 2.0\nfloat a = /* x( */ f(1.);  // g(2)\n';
    const toks = tokenize(src);
    expect(toks.map(t => t.v)).toEqual(['float', 'a', '=', 'f', '(', '1.', ')', ';']);
    const f = toks.find(t => t.v === 'f')!;
    expect(src.slice(f.s, f.e)).toBe('f');
  });
  it('reads numbers in all their forms', () => {
    expect(tokenize('1. .5 2.5e-3 0xff 3u').map(t => t.k)).toEqual(['num', 'num', 'num', 'num', 'num']);
  });
});

describe('shapes (L1 exact, L2 argument)', () => {
  it('matches the plan’s example', () => {
    expect(call('smoothstep(0.22, 0.28, length(cuv))')).toEqual({ l1: 'smoothstep(#, #, length(_a))', l2: 'smoothstep(#, #, length(…))' });
  });
  it('keeps a repeated name’s letter (edge plus width ≠ two edges)', () => {
    expect(call('smoothstep(t, t + 0.25, luma)').l1).toBe('smoothstep(_a, _a + #, _b)');
    expect(call('smoothstep(a, b, x)').l1).toBe('smoothstep(_a, _b, _c)');
    expect(call('smoothstep(t, t + 0.25, luma)').l2).toBe('smoothstep(_, _ + #, _)');
  });
  it('canonicalises literals, keeps signs, folds constant arithmetic', () => {
    expect(call('f(1., 1.0, 1.000)').l1).toBe('f(#, #, #)');
    expect(call('vec2(-1.0, 2.0)').l1).toBe('vec2(-#, #)');
    expect(call('sin(x * 6.2831853 / 4.0)').l1).toBe('sin(_a * # / #)');
    expect(call('sin(6.2831853 / 4.0)').l1).toBe('sin(#)');
  });
  it('keeps built-in names, reading Shadertoy’s as the Studio’s', () => {
    expect(call('sin(u_time * 2.0)').l1).toBe('sin(u_time * #)');
    expect(call('sin(iTime * 2.0)').l1).toBe('sin(u_time * #)');
  });
  it('keeps swizzles and brackets', () => {
    expect(call('fract(p.y * (a + 1.0))').l1).toBe('fract(_a.y * (_b + #))');
  });
});

describe('parser', () => {
  it('reads statements, functions, and tolerates junk', () => {
    const p = parseSource('uniform float u;\nfloat sdBox(vec2 p, vec2 b) {\n  vec2 d = abs(p) - b;\n  return length(max(d, 0.0)); }\nvoid main() { @@@; gl_FragColor = vec4(1.0); }', 'file');
    expect(p.fns.map(f => f.name)).toEqual(['sdBox', 'main']);
    expect(p.stmts.map(s => s.kind)).toEqual(['decl', 'return', 'assign']);
    expect(p.stmts[0].fn).toBe('sdBox');
  });
});

describe('pattern levels', () => {
  it('L3 merges near variants with holes', () => {
    const m = mergeVariants([{ l1: 'smoothstep(#, #, length(_a - vec2(#, #)))', count: 3 }, { l1: 'smoothstep(#, #, length(_a - _b))', count: 2 }]);
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ l3: 'smoothstep(#, #, length(_a - ?))', holes: 1, count: 5 });
  });
  it('keeps far variants apart', () => {
    const m = mergeVariants([{ l1: 'f(g(_a, _b, _c))', count: 1 }, { l1: 'f(h(#))', count: 1 }]);
    expect(m).toHaveLength(2);
  });
  it('the report groups by L2, with L1 variants and L3 merges', () => {
    const r = functionReport(indexOf(exampleRecords), 'smoothstep');
    const card = r.patterns.find(p => p.l2 === 'smoothstep(#, #, length(…))')!;
    expect(card.variants.length).toBeGreaterThan(1);
    expect(card.variants.reduce((n, v) => n + v.count, 0)).toBe(card.count);
    expect(card.merged.some(m => m.l3.includes('?'))).toBe(true);
  });
});

describe('real counts over the bundled examples (docs/code-explorer-plan.md §9)', () => {
  const corpusDocs = Object.entries(corpusFiles).map(([p, code]) => fileDoc(`corpus:${p}`, 'example', p.split('/').pop()!, 'Corpus', 'corpus', code)).filter((d): d is DocInput => !!d);
  const ix = indexOf([...exampleRecords, ...corpusDocs.map(d => extractDoc(d, 0))]);
  // The examples grow over time: at least the plan's count (less a tolerance), and not wildly more.
  const near = (n: number, want: number, tol: number) => { expect(n).toBeGreaterThanOrEqual(want - tol); expect(n).toBeLessThanOrEqual(want * 2); };

  it('smoothstep: ≈55 calls in ≈30 examples, top two L2 shapes as in the plan', () => {
    const r = functionReport(ix, 'smoothstep');
    near(r.calls, 55, 8);
    near(r.docs, 30, 6);
    expect(r.patterns[0].l2).toBe('smoothstep(#, #, _)');
    expect(r.patterns[1].l2).toBe('smoothstep(#, #, length(…))');
    expect(r.chains[0].key).toBe('smoothstep');
    expect(r.chains.some(c => c.key === 'mix › smoothstep')).toBe(true);
    expect(r.flows.some(f => f.key === '· → smoothstep → mix')).toBe(true);
    expect(r.sameLine[0].key).toBe('length');
  });
  it('mix, fract and length are near the plan’s counts', () => {
    near(functionReport(ix, 'mix').calls, 89, 14);
    near(functionReport(ix, 'fract').calls, 52, 9);
    near(functionReport(ix, 'length').calls, 65, 10);
    expect(functionReport(ix, 'fract').patterns.slice(0, 3).map(p => p.l2)).toContain('fract(_ * #)');
    expect(functionReport(ix, 'length').patterns.slice(0, 2).map(p => p.l2)).toContain('length(_)');
  });
  it('step is the most-called function in written code', () => {
    expect(summarise(ix).top[0].key).toBe('step');
  });
});

describe('provenance', () => {
  it('every example site points at its call in the field’s own text', () => {
    // Re-read each field straight from the graph and check the callee is at (line, column).
    const fieldText = (docId: string, nodePath: string[] | undefined, field: string): string | null => {
      type N = { id: string; params: Record<string, unknown> };
      let nodes: N[] | undefined = (EXAMPLE_GRAPHS as unknown as Record<string, { nodes: N[] }>)[docId.slice('example:'.length)]?.nodes;
      let node: N | undefined;
      for (const id of nodePath ?? []) { node = nodes?.find(n => n.id === id); nodes = (node?.params.subgraph as { nodes?: N[] } | undefined)?.nodes; }
      if (!node) return null;
      const m = /^lines\[(\d+)\]\.rhs$/.exec(field);
      if (m) return String((node.params.lines as Array<{ rhs: string }>)[+m[1]].rhs);
      return typeof node.params[field] === 'string' ? node.params[field] as string : null;
    };
    let checked = 0, ok = 0;
    for (const rec of exampleRecords.filter(r => r.docId.startsWith('example:'))) {
      for (const s of rec.sites) {
        const src = rec.sources[s.src];
        const text = fieldText(rec.docId, src.nodePath, s.field);
        if (text == null) continue;
        checked++;
        // Expression Block lines and bare Custom Function bodies are one field per line.
        const lineText = s.field.startsWith('lines[') || s.field === 'result' ? text : text.split('\n')[s.line - 1] ?? '';
        if (lineText.slice(s.col - 1).startsWith(s.callee)) ok++;
      }
    }
    expect(checked).toBeGreaterThan(800);
    expect(ok / checked).toBeGreaterThan(0.99);
  });
  it('carries graph, node, label, field and position', () => {
    const r = functionReport(indexOf(exampleRecords), 'smoothstep');
    const inst = r.patterns.flatMap(p => p.variants.flatMap(v => v.instances)).find(i => i.prov.docId === 'example:gridDensityWave')!;
    expect(inst.prov).toMatchObject({ sourceKind: 'expr', origin: 'example', field: 'result', nodeType: 'exprNode' });
    expect(inst.prov.nodeId).toBeTruthy();
    expect(inst.text.slice(inst.hs, inst.he)).toMatch(/^smoothstep\(/);
  });
});

const doc = (id: string, lines: Array<[string, string]>, result: string): DocInput => {
  const s = exprBlockSource(lines.map(([lhs, rhs]) => ({ lhs, op: '=', rhs })), result)!;
  return { docId: id, origin: 'saved', label: id, group: 'Saved graphs', sources: [{ sourceKind: 'expr', mode: 'body', field: 'lines', text: s.text, lineFields: s.lineFields, nodeId: 'n1', nodePath: ['n1'], nodeLabel: 'Block', nodeType: 'exprNode' }] };
};

describe('incremental index (host, in place)', () => {
  const prebuilt: PrebuiltIndex = { schema: INDEX_SCHEMA, hash: 'h1', builtAt: 0, docs: exampleRecords.slice(0, 5) };

  it('re-indexes only what changed, and counts change by exactly the delta', async () => {
    const store = memoryStore();
    const host = createHost({ store: async () => store, prebuilt: async () => prebuilt });
    const init = await host.handle({ t: 'init' }) as InitResult;
    expect(init.fromPrebuilt).toBe(5);
    const a = doc('saved:a', [['float d', 'length(p)']], '1.0 - smoothstep(0.2, 0.3, d)');
    const b = doc('saved:b', [['float t', 'fract(u_time)']], 'vec3(t)');
    let r = await host.handle({ t: 'sync', prefixes: ['saved:'], docs: [a, b] }) as SyncResult;
    expect(r).toMatchObject({ added: 2, updated: 0, unchanged: 0, removed: 0 });
    const before = host.index.sitesOf('smoothstep').length;
    const l2Before = host.index.l2Counts.get('smoothstep(#, #, _)') ?? 0;

    const a2 = doc('saved:a', [['float d', 'length(p)'], ['float e', 'smoothstep(0.0, 1.0, d)']], '1.0 - smoothstep(0.2, 0.3, e)');
    r = await host.handle({ t: 'sync', prefixes: ['saved:'], docs: [a2, b] }) as SyncResult;
    expect(r).toMatchObject({ added: 0, updated: 1, unchanged: 1, removed: 0 });
    expect(host.index.sitesOf('smoothstep').length).toBe(before + 1);
    expect(host.index.l2Counts.get('smoothstep(#, #, _)')).toBe(l2Before + 1);

    r = await host.handle({ t: 'sync', prefixes: ['saved:'], docs: [b] }) as SyncResult;
    expect(r.removed).toBe(1);
    expect(host.index.sitesOf('smoothstep').length).toBe(before - 1);
    expect(store.docs.has('saved:a')).toBe(false);
    // Docs of other kinds are left alone.
    expect(host.index.size).toBe(6);
  });

  it('answers queries through the protocol, and rebuilds', async () => {
    const host = createHost({ store: async () => memoryStore(), prebuilt: async () => ({ ...prebuilt, docs: exampleRecords }) });
    const q = await host.handle({ t: 'query', query: { q: 'function', fn: 'smoothstep' } }) as { result: { calls: number }; ms: number };
    expect(q.result.calls).toBeGreaterThan(40);
    const re = await host.handle({ t: 'rebuild' }) as InitResult;
    expect(re.docs).toBe(exampleRecords.length);
  });

  it('keeps the index in IndexedDB between sessions', async () => {
    const s1 = (await idbStore(indexedDB, 'ce-test'))!;
    const h1 = createHost({ store: async () => s1, prebuilt: async () => null });
    await h1.handle({ t: 'sync', prefixes: ['saved:'], docs: [doc('saved:x', [['float d', 'length(p)']], 'd')] });
    const s2 = (await idbStore(indexedDB, 'ce-test'))!;
    const h2 = createHost({ store: async () => s2, prebuilt: async () => null });
    const init = await h2.handle({ t: 'init' }) as InitResult;
    expect(init.docs).toBe(1);
    expect(h2.index.sitesOf('length')).toHaveLength(1);
  });
});

describe('free-text search with synonyms', () => {
  const ix = indexOf(exampleRecords);
  it('“soft circle edge” finds the soft disc edge', () => {
    const hits = searchPatterns(ix, 'soft circle edge');
    expect(hits[0]).toMatchObject({ callee: 'smoothstep', l2: 'smoothstep(#, #, length(…))' });
  });
  it('“random” finds the hash', () => {
    const hits = searchPatterns(ix, 'random');
    expect(hits.slice(0, 3).some(h => h.callee === 'fract' && h.l2 === 'fract(sin(…) * #)')).toBe(true);
  });
  it('“repeat tile” finds repetition (fract, floor, mod)', () => {
    expect(searchPatterns(ix, 'repeat tile').slice(0, 4).every(h => /fract|floor|mod/.test(h.l2))).toBe(true);
  });
  it('names a pattern by the library’s idiom when it matches the whole call', () => {
    const r = functionReport(ix, 'smoothstep');
    const card = r.patterns.find(p => p.l2 === 'smoothstep(#, #, length(…))')!;
    const info = explainPattern({ callee: 'smoothstep', l2: card.l2, sample: card.sample });
    expect(info?.name).toBe('Soft circle');
    expect(info?.phrase).toMatch(/circle/i);
  });
});

describe('find uses through the index', () => {
  it('finds a library idiom in saved code, with provenance and the matched span', () => {
    const ix = indexOf([extractDoc(doc('saved:mine', [['float d', 'length(uv)']], 'smoothstep(0.3, 0.35, length(uv))'))]);
    const hits = findIndexedUses(ix, { idiomId: 'soft-circle' });
    expect(hits).toHaveLength(1);
    expect(hits[0].prov).toMatchObject({ docId: 'saved:mine', field: 'result', nodeId: 'n1' });
    expect(hits[0].text.slice(hits[0].hs, hits[0].he)).toBe('smoothstep(0.3, 0.35, length(uv))');
  });
});

describe('user corpus', () => {
  it('reads saved graphs, presets, shaders and presentations from a KV', () => {
    const m = new Map<string, string>([
      ['shader-studio:My graph', JSON.stringify({ nodes: [{ id: 'e1', type: 'exprNode', params: { lines: [{ lhs: 'float d', op: '=', rhs: 'length(p)' }], result: 'd' } }] })],
      ['shader-studio:cfp:1', JSON.stringify({ label: 'Hash', body: 'fract(sin(x) * 43758.5)', glslFunctions: '' })],
      ['shader-studio:glsl-shaders', JSON.stringify([{ id: 's1', name: 'Rings', code: 'void main(){ gl_FragColor = vec4(sin(length(vUv))); }' }])],
      ['shader-studio-presentation:Lesson', JSON.stringify({ title: 'Lesson', steps: [{ title: 'One', blocks: [{ type: 'code', id: 'b1', language: 'glsl', code: 'float d = abs(x);' }] }] })],
    ]);
    const kv = { keys: () => [...m.keys()], get: (k: string) => m.get(k) ?? null, set: (k: string, v: string) => { m.set(k, v); } };
    const docs = collectUserDocs(kv, { nodes: [{ id: 'z', type: 'exprNode', params: { lines: [], result: 'mix(a, b, t)' } }], label: 'Open graph' });
    expect(docs.map(d => d.docId).sort()).toEqual(['open:', 'present:Lesson', 'preset:shader-studio:cfp:1', 'saved:My graph', 'shader:s1']);
  });
  it('groups give provenance down a group path', () => {
    const d = graphDoc('saved:g', 'saved', 'g', 'Saved graphs', [{ id: 'grp', type: 'group', params: { subgraph: { nodes: [{ id: 'in', type: 'circleSDF', params: { __inExpr_radius: '0.1 + sin(u_time)' } }] } } }])!;
    const rec = extractDoc(d);
    expect(rec.sources[0]).toMatchObject({ nodeId: 'in', nodePath: ['grp', 'in'], sourceKind: 'inputExpr', field: '__inExpr_radius' });
    expect(rec.sites[0]).toMatchObject({ callee: 'sin', line: 1, col: 7 });
  });
});

describe('jump to source', () => {
  const base = { sourceKind: 'expr' as const, origin: 'example' as const, docLabel: 'X', line: 3, column: 7 };
  it('an example Expression Block line: load, enter groups, open the editor at the line', () => {
    const p = planJump({ ...base, docId: 'example:passGlowBright', nodeId: 'b', nodePath: ['grp', 'b'], nodeType: 'exprNode', field: 'lines[2].rhs' });
    expect(p).toEqual({ to: 'graph', graph: { kind: 'example', key: 'passGlowBright' }, groupPath: ['grp'], nodeId: 'b', editor: 'exprBlock', field: 'lines[2].rhs', line: 3, column: 7 });
    expect(exprFieldLabel('lines[2].rhs')).toBe('Line 3 expression');
    expect(exprFieldLabel('result')).toBe('Return expression');
  });
  it('saved graphs, input expressions, custom functions, shaders, files and presentations', () => {
    expect(planJump({ ...base, docId: 'saved:Mine', nodeId: 'n', nodeType: 'circleSDF', field: '__inExpr_radius' })).toMatchObject({ to: 'graph', graph: { kind: 'saved', name: 'Mine' }, editor: 'inputExpr', groupPath: [] });
    expect(planJump({ ...base, docId: 'open:', nodeId: 'n', nodeType: 'customFn', field: 'body' })).toMatchObject({ graph: { kind: 'open' }, editor: 'customFn' });
    expect(planJump({ ...base, docId: 'shader:s1', field: 'code' })).toEqual({ to: 'shader', id: 's1', line: 3, column: 7 });
    expect(planJump({ ...base, docId: 'file:lf_1/shaders/a.frag', field: 'code' })).toMatchObject({ to: 'file', folderId: 'lf_1', path: 'shaders/a.frag' });
    expect(planJump({ ...base, docId: 'present:Lesson', field: 'steps[0].blocks[1]' })).toEqual({ to: 'present', name: 'Lesson' });
    expect(planJump({ ...base, docId: 'example-convert:circle', field: 'code' })).toEqual({ to: 'convert', key: 'circle' });
  });
  it('a real example instance resolves to its node and line', () => {
    const r = functionReport(indexOf(exampleRecords), 'smoothstep');
    const inst = r.patterns[0].variants[0].instances[0];
    const p = planJump(inst.prov);
    expect(p.to).toBe('graph');
    if (p.to !== 'graph') return;
    const g = (EXAMPLE_GRAPHS as Record<string, { nodes: Array<{ id: string }> }>)[(p.graph as { key: string }).key];
    const all: Array<{ id: string; params?: { subgraph?: { nodes: unknown[] } } }> = [];
    const walk = (ns: unknown[]) => { for (const n of ns as typeof all) { all.push(n); if (n.params?.subgraph) walk(n.params.subgraph.nodes); } };
    walk(g.nodes);
    expect(all.some(n => n.id === p.nodeId)).toBe(true);
  });
  it('offsetOf finds a line and column', () => {
    expect(offsetOf('ab\ncdef\ng', 2, 3)).toBe(5);
  });
});
