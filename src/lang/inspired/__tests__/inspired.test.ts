/**
 * "Inspired by" (docs/surprise.md): lifting and namespacing GLSL, fragments, a seed that repeats, history
 * steering, the fallback, and the variety over 50 rolls of the examples.
 */
import { describe, expect, it } from 'vitest';
import { parser } from '@shaderfrog/glsl-parser';
import preprocess from '@shaderfrog/glsl-parser/preprocessor';
import type { GraphNode } from '../../../types/nodeGraph';
import { EXAMPLE_GRAPHS } from '../../../store/exampleGraphs';
import { CONVERT_EXAMPLES } from '../../../glslToGraph/examples';
import { compileGraph } from '../../../compiler/graphCompiler';
import { analyseGraph } from '../../../patterns/patternIndex';
import { TECHNIQUE_BY_ID } from '../../../patterns/catalogue';
import { n } from '../../../store/graphBuilder';
import { glslFunctions, liftFunction } from '../lift';
import { fragmentsFromCode, type InspSource } from '../fragments';
import { inspire, lineGraph, makePool, planFor, realise, remember, repetition, steerSeed, type RollMemory } from '../compose';

/** The fragment shader parses, every function and variable declared (a stand-in for the GPU compile). */
function parses(nodes: GraphNode[]): string | null {
  const r = compileGraph({ nodes });
  if (!r.success) return (r.errors ?? []).join('; ');
  try { parser.parse(preprocess('vec4 gl_FragColor;\n' + r.fragmentShader, { preserve: {} }), { quiet: true, failOnWarn: true }); return null; } catch (e) { return String(e).slice(0, 300); }
}

const SHADER_A = `#define PI 3.14159
const float K = 0.5;
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
float blob(vec2 p, float t) { return length(p) - K - 0.1 * sin(t + PI * hash(floor(p * 4.0))); }
vec3 tint(float v) { return vec3(v, v * v, 1.0 - v); }
void mainImage(out vec4 fragColor, in vec2 fragCoord) { fragColor = vec4(tint(blob(fragCoord, iTime)), 1.0); }`;
const SHADER_B = `float hash(vec2 p) { return fract(sin(dot(p, vec2(3.1, 7.7))) * 1234.5); }
float stripes(vec2 p) { return sin(p.x * 20.0 + hash(p) + iTime); }
float uses(vec2 p) { return texture(iChannel0, p).r; }`;

const src = (id: string, code: string): InspSource => ({ id, label: id, kind: 'glsl', code });

const examplePool = () => makePool([
  ...Object.entries(EXAMPLE_GRAPHS).filter(([k]) => k !== 'blank').map(([k, g]) => ({ id: `example:${k}`, label: g.label, kind: 'graph' as const, nodes: g.nodes })),
  ...Object.entries(CONVERT_EXAMPLES).map(([k, c]) => ({ id: `example-convert:${k}`, label: c.label, kind: 'glsl' as const, code: c.code })),
]);

describe('lifting GLSL', () => {
  it('finds the functions, and lifts one with its helpers, consts and defines renamed', () => {
    expect(glslFunctions(SHADER_A).map(f => f.name)).toEqual(['hash', 'blob', 'tint', 'mainImage']);
    expect(liftFunction(SHADER_B, 'stripes', 'b')!.code).toContain('u_time');
    const l = liftFunction(SHADER_A, 'blob', 'ns1')!;
    expect(l.fn).toBe('ns1_blob');
    expect(l.code).toContain('#define ns1_PI');
    expect(l.code).toContain('const float ns1_K');
    expect(l.code).toContain('float ns1_hash(vec2 p)');
    expect(l.code).not.toMatch(/\bhash\(/);
    expect(l.code).not.toContain('tint');
  });
  it('leaves what reads a texture or the frame', () => {
    expect(liftFunction(SHADER_B, 'uses', 'x')).toBeNull();
    expect(liftFunction(SHADER_A, 'mainImage', 'x')).toBeNull();
  });
  it('two sources that both define hash() compile side by side', () => {
    const a = fragmentsFromCode(src('shader:a', SHADER_A), SHADER_A).find(f => f.what === 'blob()')!;
    const b = fragmentsFromCode(src('shader:b', SHADER_B), SHADER_B).find(f => f.what === 'stripes()')!;
    expect(a.stage).toBe('field');
    expect(b.stage).toBe('field');
    const place = (f: typeof a, id: string) => ({ ...f.nodes[0], id, inputs: { ...f.nodes[0].inputs, p: { ...f.nodes[0].inputs.p, connection: { nodeId: 'u', outputKey: 'uv' } } } });
    const nodes: GraphNode[] = [
      n('uv', 'u', 0, 0), place(a, 'fa'), place(b, 'fb'),
      { id: 'sum', type: 'customFn', position: { x: 0, y: 0 }, inputs: { x: { type: 'float', label: 'x', connection: { nodeId: 'fa', outputKey: 'result' } }, y: { type: 'float', label: 'y', connection: { nodeId: 'fb', outputKey: 'result' } } }, outputs: { result: { type: 'vec3', label: 'R' } }, params: { inputs: [{ name: 'x', type: 'float', slider: null }, { name: 'y', type: 'float', slider: null }], outputType: 'vec3', body: 'vec3(x, y, 0.0)', glslFunctions: '' } },
      n('output', 'o', 0, 0, {}, { color: ['sum', 'result'] }),
    ];
    expect(parses(nodes)).toBeNull();
  });
});

describe('inspired by: composing', () => {
  const pool = examplePool();

  it('the same seed and sources make the same graph; another seed another', () => {
    const k = () => { let i = 0; return () => `n${++i}`; };
    const a = realise(pool, 4242, k())!, b = realise(pool, 4242, k())!;
    expect(JSON.stringify(a.nodes)).toBe(JSON.stringify(b.nodes));
    expect(a.inspirations.length).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(realise(pool, 4243, k())!.nodes)).not.toBe(JSON.stringify(a.nodes));
    // A pool listed in another order is the same pool.
    const shuffled = makePool([...pool.sources].reverse());
    expect(JSON.stringify(realise(shuffled, 4242, k())!.nodes)).toBe(JSON.stringify(a.nodes));
  });

  it('every node it copies carries a note saying where it came from, and there is one Output', () => {
    const c = realise(pool, 77, (() => { let i = 0; return () => `n${++i}`; })())!;
    for (const nd of c.nodes) expect(typeof nd.params.__comment, nd.type).toBe('string');
    expect(c.nodes.filter(nd => nd.type === 'output')).toHaveLength(1);
    const names = c.inspirations.map(i => i.label);
    expect(c.nodes.some(nd => names.some(l => String(nd.params.__comment).includes(l)))).toBe(true);
  });

  it('history steers a fresh roll away from the last ones; a typed seed is not steered', () => {
    let steered = 0, plain = 0;
    let hist: RollMemory[] = [];
    let histPlain: RollMemory[] = [];
    for (let r = 0; r < 30; r++) {
      const cands = Array.from({ length: 6 }, (_, i) => 1000 + r * 10 + i);
      const s = steerSeed(pool, cands, hist);
      steered += repetition(pool, s, hist);
      hist = remember(hist, realise(pool, s, (() => { let i = 0; return () => `x${++i}`; })())!);
      plain += repetition(pool, cands[0], histPlain);
      histPlain = remember(histPlain, realise(pool, cands[0], (() => { let i = 0; return () => `x${++i}`; })())!);
    }
    expect(steered).toBeLessThan(plain);
    expect(steerSeed(pool, [5, 6, 7], [])).toBe(5);
    expect(planFor(pool, 5).sources).toEqual(planFor(pool, 5).sources);
  });

  it('falls back to the old line generator when nothing passes', () => {
    const r = inspire({ pool, seed: 99, tries: 3, check: () => 'blank' });
    expect(r.fallback).toBe(true);
    expect(r.rejected).toHaveLength(3);
    expect(r.line).toBeTruthy();
    expect(compileGraph({ nodes: r.nodes }).success).toBe(true);
    // And with no sources at all.
    expect(inspire({ pool: makePool([]), seed: 3, tries: 2 }).fallback).toBe(true);
  });

  it('variety over 50 rolls: many combinations, no family everywhere, ≥ 90% compile', () => {
    const familiesOf = (nodes: GraphNode[]) => [...new Set(analyseGraph({ id: 'roll', label: 'roll', origin: 'open', nodes }).techniques.map(t => TECHNIQUE_BY_ID.get(t)!.family))].sort();
    const measure = (make: (seed: number) => GraphNode[] | null) => {
      const combos = new Set<string>();
      const famCount = new Map<string, number>();
      let ok = 0;
      for (let s = 1; s <= 50; s++) {
        const nodes = make(s);
        if (!nodes || parses(nodes)) continue;
        ok++;
        const fams = familiesOf(nodes);
        combos.add(fams.join('+'));
        for (const f of fams) famCount.set(f, (famCount.get(f) ?? 0) + 1);
      }
      return { ok, combos: combos.size, maxShare: Math.max(...famCount.values()) / Math.max(1, ok), fams: Object.fromEntries(famCount) };
    };
    const next = () => { let i = 0; return () => `v${++i}`; };
    const now = measure(s => { const r = inspire({ pool, seed: s, check: parses }); return r.fallback ? null : r.nodes; });
    const old = measure(s => lineGraph(s, next())?.nodes ?? null);
    // At the time of writing: 50/50 compile, 42 combinations, colour mapping in 70% (old: 12, 100%).
    expect(now.ok).toBeGreaterThanOrEqual(45);
    expect(now.combos).toBeGreaterThanOrEqual(30);
    expect(now.combos).toBeGreaterThan(old.combos);
    expect(now.maxShare).toBeLessThanOrEqual(0.75);
    expect(now.maxShare).toBeLessThan(old.maxShare);
  }, 60_000);
});
