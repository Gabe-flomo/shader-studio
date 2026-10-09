/**
 * The Expression Builder's chain (docs/expression-builder-plan.md, phase 2): seeds, applying
 * moves, the grid of next moves, and the chain as an Expression Block that compiles.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} });
});
import { parser } from '@shaderfrog/glsl-parser';
import raw from '../prebuilt/moves.json?raw';
import { compileGraph } from '../../compiler/graphCompiler';
import { typeOfExpr, type Catalogue, type Move } from '../moves';
import { unpackCatalogue, type PackedCatalogue } from '../pack';
import {
  TIME_SEED, UV_SEED, WORLD_SEED, chainEnd, inlineSteps, nextMoves, plotChain, simpleRank, seedForMoves, stepCode, stepFromMove, tileSteps, variableSeed,
  type Chain, type ChainStep, type Tile,
} from '../chain';
import { CHAIN_KEY, chainBlock, chainBlockParams, chainGraph, chainOfBlock, previewGraph } from '../block';
import { resolveTemplateSteps, WORKED_EXAMPLE } from '../examples';
import { addChain } from '../actions';

let cat: Catalogue;
beforeAll(() => { cat = unpackCatalogue(JSON.parse(raw) as PackedCatalogue); });

const pick = (tiles: Tile[], template: string) => {
  const t = tiles.find(x => x.template === template);
  expect(t, template).toBeTruthy();
  return t!;
};
const apply = (chain: Chain, tile: Tile, values?: Record<string, number>): Chain => ({ ...chain, steps: [...chain.steps, ...tileSteps(tile, cat, values)] });

/** The block compiled in a graph with an Output: compileGraph succeeds and the shader parses. */
function compiles(chain: Chain) {
  const g = previewGraph(chain);
  const r = compileGraph({ nodes: g.nodes });
  expect(r.success, (r.errors ?? []).join('; ')).toBe(true);
  expect(() => parser.parse(r.fragmentShader.replace(/^#version.*$/m, ''), { quiet: true })).not.toThrow();
  return r;
}

describe('seeds', () => {
  it('carry type, role, dimension and context (the seam for a socket seed)', () => {
    expect(seedForMoves({ seed: UV_SEED, steps: [] })).toEqual({ type: 'vec2', dimension: '2d', role: 'space' });
    expect(seedForMoves({ seed: WORLD_SEED, steps: [] })).toEqual({ type: 'vec3', dimension: '3d-world', role: 'space' });
    expect(seedForMoves({ seed: TIME_SEED, steps: [] })).toEqual({ type: 'float', dimension: '1d-time', role: 'time' });
    expect(seedForMoves({ seed: variableSeed('float'), steps: [] })).toEqual({ type: 'float', dimension: '2d' });
    for (const s of [UV_SEED, WORLD_SEED, TIME_SEED]) {
      const g = nextMoves({ seed: s, steps: [] }, cat);
      expect(g.same.length + g.changing.length, s.label).toBeGreaterThan(10);
    }
  });
});

describe('the grid of next moves', () => {
  it('groups type-preserving and type-changing moves, and recipes on their own', () => {
    const g = nextMoves({ seed: UV_SEED, steps: [] }, cat);
    expect(g.same.length).toBeGreaterThan(20);
    expect(g.changing.length).toBeGreaterThan(5);
    expect(g.recipes.length).toBeGreaterThan(5);
    for (const t of g.same) { expect(t.kind).toBe('step'); expect(t.outType).toBe('vec2'); expect(t.move.sig.in).toBe('vec2'); }
    for (const t of g.changing) { expect(t.kind).toBe('step'); expect(t.outType).not.toBe('vec2'); }
    for (const t of g.recipes) {
      expect(t.moves.length).toBeGreaterThanOrEqual(2);
      expect(t.moves[0].sig.in).toBe('vec2');
      expect(t.moves[t.moves.length - 1].sig.out).toBe(t.outType);
    }
    expect(g.changing.map(t => t.template)).toEqual(expect.arrayContaining(['x.x', 'length(x)']));
    // No template twice
    const all = [...g.same, ...g.changing, ...g.recipes].map(t => t.template);
    expect(new Set(all).size).toBe(all.length);
  });

  it('phase 2\'s baseline ranks context matches first, then by count; the ranker is replaceable', () => {
    const ms = cat.moves.filter(m => m.sig.in === 'vec2').slice(0, 200);
    const ranked = simpleRank(ms, { dimension: '2d', feeds: ['uv'] }, cat).map(s => s.move);
    expect(ranked.length).toBe(ms.length);
    const hit = (m: Move) => !m.generated && m.contexts.some(c => c.dim === '2d' && c.feed === 'uv');
    const firstMiss = ranked.findIndex(m => !hit(m));
    if (firstMiss >= 0) expect(ranked.slice(firstMiss).some(hit)).toBe(false);
    const hits = ranked.filter(hit);
    for (let i = 1; i < hits.length; i++) expect(hits[i - 1].count).toBeGreaterThanOrEqual(hits[i].count);
    // A different ranking plugs in
    const rev = nextMoves({ seed: UV_SEED, steps: [] }, cat, 0, moves => [...moves].reverse().map((move, i) => ({ move, score: -i, follow: 0 })));
    expect(rev.same[0].key).not.toBe(nextMoves({ seed: UV_SEED, steps: [] }, cat).same[0].key);
  });

  it('a tile shows the move applied to the expression so far', () => {
    let chain: Chain = { seed: UV_SEED, steps: [] };
    chain = apply(chain, pick(nextMoves(chain, cat).same, 'fract(x)'));
    const zoom = pick(nextMoves(chain, cat).same, 'x * #a');
    const [s] = tileSteps(zoom, cat, { '0:#a': 3 });
    expect(inlineSteps([s], chainEnd(chain).name)).toEqual({ expr: 's1 * 3.0', type: 'vec2' });
    // A recipe inlines its steps
    const r = nextMoves({ seed: UV_SEED, steps: [] }, cat).recipes.find(t => t.template === 'length(x - vec2(#a, #b))')!;
    expect(r).toBeTruthy();
    expect(inlineSteps(tileSteps(r, cat), 'uv').expr).toMatch(/^length\(uv - vec2\(/);
  });
});

describe('a chain as an Expression Block', () => {
  it('UV → 3 moves → a block that compiles, with the right output type', () => {
    let chain: Chain = { seed: UV_SEED, steps: [] };
    chain = apply(chain, pick(nextMoves(chain, cat).same, 'x * #a'), { '0:#a': 4 });
    chain = apply(chain, pick(nextMoves(chain, cat).same, 'fract(x)'));
    chain = apply(chain, pick(nextMoves(chain, cat).changing, 'length(x)'));
    expect(chainEnd(chain)).toEqual({ type: 'float', role: 'distance', name: 's3' });
    const block = chainBlock(chain, { id: 'b1', seedFrom: { nodeId: 'u1', outputKey: 'uv' } });
    expect(block.params.outputType).toBe('float');
    expect(block.outputs.result.type).toBe('float');
    expect(block.params.result).toBe('s3');
    const lines = block.params.lines as Array<{ lhs: string; rhs: string }>;
    expect(lines.map(l => l.lhs)).toEqual(['vec2 s1', 'vec2 s2', 'float s3']);
    expect(lines[0].rhs).toMatch(/^uv \* s1_a \/\* zoom: scales it \(from .+\) \*\/$/);
    expect(lines[1].rhs).toMatch(/^fract\(s1\) \/\* repeat: repeats it in cells/);
    expect(lines[2].rhs).toMatch(/^length\(s2\) \/\* distance: measures a distance/);
    // Each line types as its declaration says
    const env: Record<string, 'vec2' | 'float'> = { uv: 'vec2', s1_a: 'float', s1: 'vec2', s2: 'vec2' };
    for (const l of lines) expect(typeOfExpr(l.rhs, env), l.rhs).toBe(l.lhs.split(' ')[0]);
    // The seed wired, the chain kept for phase 5
    expect(block.inputs.uv.connection).toEqual({ nodeId: 'u1', outputKey: 'uv' });
    expect(chainOfBlock(block)?.steps.map(s => s.template)).toEqual(['x * #a', 'fract(x)', 'length(x)']);
    expect((block.params[CHAIN_KEY] as { v: number }).v).toBe(1);
    expect(String(block.params.__comment)).toMatch(/s1 = zoom/);
    compiles(chain);
    // Add to graph: a UV node wired into the block
    let n = 0;
    const g = chainGraph(chain, { nextId: () => `n${++n}` });
    expect(g.nodes.map(x => x.type)).toEqual(['uv', 'exprNode']);
    expect(g.nodes[1].inputs.uv.connection).toEqual({ nodeId: 'n1', outputKey: 'uv' });
  });

  it('the preview renders the same block that is added', () => {
    let chain: Chain = { seed: UV_SEED, steps: [] };
    chain = apply(chain, pick(nextMoves(chain, cat).same, 'fract(x)'));
    const pv = previewGraph(chain).nodes.find(x => x.id === 'xb_block')!;
    const added = chainGraph(chain, { nextId: (() => { let i = 0; return () => `k${++i}`; })() }).nodes[1];
    expect(pv.params.lines).toEqual(added.params.lines);
    expect(pv.params.inputs).toEqual(added.params.inputs);
  });

  it('slider holes round-trip into the block', () => {
    let chain: Chain = { seed: UV_SEED, steps: [] };
    chain = apply(chain, pick(nextMoves(chain, cat).same, 'x - vec2(#a, #b)'), { '0:#a': 0.25, '0:#b': -0.75 });
    chain = apply(chain, pick(nextMoves(chain, cat).same, 'x * #a'), { '0:#a': 12 });
    const p = chainBlockParams(chain);
    expect(p.inputs.map(i => i.name)).toEqual(['uv', 's1_a', 's1_b', 's2_a']);
    expect(p.values).toEqual({ s1_a: 0.25, s1_b: -0.75, s2_a: 12 });
    // A value typed past the range widens it (no clamping, no min/max editors)
    expect(p.inputs[3].slider!.max).toBeGreaterThanOrEqual(12);
    expect(p.lines[0].rhs).toMatch(/^uv - vec2\(s1_a, s1_b\)/);
    const block = chainBlock(chain, { id: 'b' });
    expect(block.params.s1_b).toBe(-0.75);
    const back = chainOfBlock(block)!;
    expect(back.steps[0].holes).toEqual(chain.steps[0].holes);
    expect(chainBlockParams(back)).toEqual(p);
    // The slider is a uniform: the compiled program reads it, with the value set
    const r = compiles(chain);
    expect(Object.values(r.paramUniforms ?? {})).toEqual(expect.arrayContaining([12, -0.75]));
  });

  it('World position stays an input; Time is wired from a Time node; every seed compiles after a move', () => {
    const w: Chain = { seed: WORLD_SEED, steps: [] };
    const w1 = apply(w, nextMoves(w, cat).same[0]);
    let n = 0;
    const g = chainGraph(w1, { nextId: () => `w${++n}` });
    expect(g.nodes.map(x => x.type)).toEqual(['exprNode']);
    expect(g.nodes[0].inputs.p.connection).toBeUndefined();
    compiles(w1);
    const t: Chain = { seed: TIME_SEED, steps: [] };
    const t1 = apply(t, pick(nextMoves(t, cat).same, 'x * #a'));
    expect(chainGraph(t1, { nextId: () => `t${++n}` }).nodes.map(x => x.type)).toEqual(['time', 'exprNode']);
    compiles(t1);
    for (const ty of ['float', 'vec2', 'vec3'] as const) {
      const v: Chain = { seed: variableSeed(ty), steps: [] };
      compiles(apply(v, nextMoves(v, cat).same[0]));
    }
  });

  it('every first move from UV compiles (holes, var holes, recipes)', () => {
    const g = nextMoves({ seed: UV_SEED, steps: [] }, cat);
    for (const tile of [...g.same.slice(0, 40), ...g.changing.slice(0, 30), ...g.recipes.slice(0, 30)]) {
      const chain = apply({ seed: UV_SEED, steps: [] }, tile);
      const p = chainBlockParams(chain);
      const env: Record<string, string> = { uv: 'vec2', t: 'float' };
      for (const i of p.inputs) env[i.name] = i.type;
      p.lines.forEach((l, i) => {
        const [type, name] = l.lhs.split(' ');
        const got = typeOfExpr(l.rhs, env as never);
        expect(got === type || got === 'unknown', `${tile.template}: ${l.rhs} is ${got}, not ${type}`).toBe(true);
        env[name] = type;
        void i;
      });
      const r = compileGraph({ nodes: previewGraph(chain).nodes });
      expect(r.success, tile.template).toBe(true);
    }
  });

  it('a time seed plots on the CPU', () => {
    const t: Chain = { seed: TIME_SEED, steps: [] };
    const sin = nextMoves(t, cat).same.find(x => x.template === 'sin(x)') ?? nextMoves(t, cat).same.find(x => x.template === 'x * #a')!;
    const plot = plotChain(t, 0, tileSteps(sin, cat));
    expect(plot).toBeTruthy();
    expect(plot!.samples.length).toBeGreaterThan(20);
    expect(plot!.type).toBe('float');
  });

  it('step code with literals and with sliders', () => {
    const m = cat.moves.find(x => x.template === 'smoothstep(#a, #b, x)' && x.sig.in === 'float')!;
    const s: ChainStep = stepFromMove(m, cat);
    expect(stepCode(s, 'd')).toMatch(/^smoothstep\(-?[\d.]+, -?[\d.]+, d\)$/);
    expect(stepCode(s, 'd', { sliders: true, index: 2 })).toBe('smoothstep(s3_a, s3_b, d)');
  });
});

describe('Add to graph', () => {
  it('places the nodes beside the graph and wires a colour result into a free Output', () => {
    const out = { id: 'o', type: 'output', position: { x: 0, y: 0 }, inputs: { color: { type: 'vec3', label: 'Color' } }, outputs: {}, params: {} } as never;
    let chain: Chain = { seed: WORLD_SEED, steps: [] };
    chain = apply(chain, nextMoves(chain, cat).same.find(t => t.kind === 'step' && t.move.sig.out === 'vec3')!);
    let n = 0;
    const r = addChain([out], chain, { nextId: () => `a${++n}` });
    expect(r.wiredOutput).toBe(true);
    expect(r.nodes.find(x => x.id === 'o')!.inputs.color.connection).toEqual({ nodeId: r.blockId, outputKey: 'result' });
    // A float result leaves the Output alone
    const f = apply(chain, pick(nextMoves(chain, cat).changing, 'length(x)'));
    const r2 = addChain([out], f, { nextId: () => `b${++n}` });
    expect(r2.wiredOutput).toBe(false);
    // Only the first `upTo` steps
    const r3 = addChain([], f, { nextId: () => `c${++n}`, upTo: 1 });
    expect(chainOfBlock(r3.nodes.find(x => x.id === r3.blockId)!)!.steps).toHaveLength(1);
  });
});

describe('the worked example', () => {
  it('UV → Repeat → Centre → Circle: a grid of dots, that compiles', () => {
    const steps = resolveTemplateSteps(WORKED_EXAMPLE.steps, UV_SEED, cat);
    expect(steps.map(s => s.template)).toEqual(WORKED_EXAMPLE.steps.map(s => s.template));
    const chain: Chain = { seed: UV_SEED, steps };
    expect(chainEnd(chain).type).toBe('float');
    compiles(chain);
  });
});
