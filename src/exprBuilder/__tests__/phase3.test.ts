/**
 * Expression Builder phase 3 (docs/expression-builder-plan.md): the stricter type check over the
 * whole catalogue, generated moves' roles, hole ranges, the dull-move filter, naming, provenance
 * and Surprise me.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} });
});
import { parser } from '@shaderfrog/glsl-parser';
import raw from '../prebuilt/moves.json?raw';
import { checkTypes, parseExpr, type GlslType } from '../../lib/glslPatterns';
import { compileGraph } from '../../compiler/graphCompiler';
import { unpackCatalogue, type PackedCatalogue } from '../pack';
import { ROLE_MAGNITUDE, HELPER_ENV } from '../shared';
import { generatedMoves } from '../generated';
import type { Catalogue, Move } from '../moves';
import {
  TIME_SEED, UV_SEED, WORLD_SEED, chainEnd, nextMoves, stepCode, stepFromMove, tileSteps, variableSeed,
  type Chain, type ChainStep, type ExprSeed,
} from '../chain';
import { previewGraph } from '../block';
import { applyVerdicts, chainSamples, judgeSteps, judgeTiles } from '../dull';
import { chainNames, currentName, finishingBoost, FINISH_BOOST } from '../naming';
import { seededRandom, surpriseSteps } from '../surprise';
import { sourceProvenance, templatePattern } from '../provenance';
import { resolveTemplateSteps } from '../examples';

let cat: Catalogue;
beforeAll(() => { cat = unpackCatalogue(JSON.parse(raw) as PackedCatalogue); });

const SEEDS: ExprSeed[] = [UV_SEED, WORLD_SEED, TIME_SEED, variableSeed('float'), variableSeed('vec2'), variableSeed('vec3')];

describe('every move type-checks strictly on every seed type it claims', () => {
  it('as its template, and as the code a step writes on each seed', () => {
    const bad: string[] = [];
    let checked = 0;
    for (const m of cat.moves) {
      for (const seed of SEEDS.filter(s => s.type === m.sig.in)) {
        // The code the block writes: holes as numbers (or a time, or their default code), on the seed's name.
        const step = stepFromMove(m, cat);
        const code = stepCode(step, seed.name);
        const r = parseExpr(code);
        const res = r.ok ? checkTypes(r.expr, { ...HELPER_ENV, [seed.name]: seed.type, t: 'float' }) : null;
        checked++;
        if (!res?.ok || res.type !== m.sig.out) bad.push(`${seed.label}: ${code} → ${res?.errors.join('; ') || res?.type} (says ${m.sig.out})`);
      }
    }
    expect(checked).toBeGreaterThan(1500);
    expect(bad).toEqual([]);
  });

  it('never offers phase 2\'s invalid moves (vec4(x, #a) on a float, step(x, $u) on a vec3)', () => {
    expect(cat.moves.some(m => m.sig.in === 'float' && m.template === 'vec4(x, #a)')).toBe(false);
    expect(cat.moves.some(m => m.sig.in === 'vec3' && m.template === 'step(x, $u)')).toBe(false);
    for (const seed of SEEDS) {
      const g = nextMoves({ seed, steps: [] }, cat);
      for (const t of [...g.same, ...g.changing, ...g.recipes]) {
        const r = parseExpr(tileSteps(t, cat).reduce((e, s) => stepCode(s, `(${e})`), seed.name));
        expect(r.ok && checkTypes(r.expr, { ...HELPER_ENV, [seed.name]: seed.type, t: 'float' }).ok, `${seed.label}: ${t.template}`).toBe(true);
      }
    }
  });

  it('a step acts on what it follows: after length(x) comes a float move', () => {
    const after = cat.order.filter(o => cat.moves.find(m => m.id === o.from)?.template === 'length(x)');
    expect(after.length).toBeGreaterThan(3);
    for (const o of after) expect(cat.moves.find(m => m.id === o.to)!.sig.in).toBe('float');
  });
});

describe('the catalogue tidied', () => {
  it('generated moves have real roles: a swizzle keeps the role, rotations and couplings act on space', () => {
    const gen = generatedMoves();
    for (const m of gen) {
      if (m.family === 'swizzle') expect(m.sig, m.template).toMatchObject({ role: 'unknown', keep: true });
      if (m.family === 'rotate' || m.family === 'couple') expect(m.sig, m.template).toMatchObject({ role: 'space', outRole: 'space' });
    }
    // A swizzle of a colour is still a colour
    const col: Chain = { seed: { ...variableSeed('vec3'), role: 'colour' }, steps: [stepFromMove(gen.find(m => m.template === 'x.zxy')!, cat)] };
    expect(chainEnd(col).role).toBe('colour');
  });

  it('number holes have sane ranges: the usual values, within the role\'s magnitude', () => {
    for (const m of cat.moves) for (const h of m.holes) {
      if (h.kind !== 'number') continue;
      const M = Math.max(ROLE_MAGNITUDE[m.sig.role] ?? 100, Math.abs(h.default));
      expect(h.range.min, m.template).toBeGreaterThanOrEqual(-M);
      expect(h.range.max, m.template).toBeLessThanOrEqual(M);
      expect(h.range.max).toBeGreaterThanOrEqual(h.range.min);
    }
  });
});

// ── The dull-move filter ──────────────────────────────────────────────────────

const step = (template: string, values: Record<string, number> = {}): Pick<ChainStep, 'template' | 'holes'> => ({
  template, holes: Object.entries(values).map(([name, value]) => ({ name, kind: 'number', value, min: 0, max: 1 })),
});

describe('the dull-move filter', () => {
  const uv = () => chainSamples({ seed: UV_SEED, steps: [] }, 0);
  it('flags constant, NaN, unchanged and too-fine moves, and passes the rest', () => {
    expect(judgeSteps(uv(), [step('x * 0.0')]).dull).toBe('constant');
    expect(judgeSteps(uv(), [step('step(#a, length(x))', { '#a': 10 })]).dull).toBe('constant');
    expect(judgeSteps(uv(), [step('sqrt(x)')]).dull).toBe('nan');
    expect(judgeSteps(uv(), [step('x / (x - x)')]).dull).toBe('nan');
    expect(judgeSteps(uv(), [step('x * #a', { '#a': 1 })]).dull).toBe('same');
    expect(judgeSteps(uv(), [step('noiseHash1(x)')]).dull).toBe('alias');
    expect(judgeSteps(uv(), [step('sin(x * #a)', { '#a': 300 })]).dull).toBe('alias');
    expect(judgeSteps(uv(), [step('fract(x * #a)', { '#a': 40 })]).dull).toBe('alias');
    for (const [t, v] of [['fract(x * #a)', 4], ['sin(x * #a)', 30], ['length(x)', 0], ['step(#a, x.x)', 0.2], ['abs(x)', 0]] as const) {
      const r = judgeSteps(uv(), [step(t, { '#a': v })]);
      expect(r, t).toMatchObject({ dull: null, evaluated: true });
      expect(r.change).toBeGreaterThan(0);
    }
  });

  it('says when it can\'t judge (then nothing is hidden)', () => {
    expect(judgeSteps(uv(), [step('fwidth(x)')])).toMatchObject({ evaluated: false, dull: null });
  });

  it('judges along time for a time seed, and in 3D a move that bends along z isn\'t "no change"', () => {
    const t = chainSamples({ seed: TIME_SEED, steps: [] }, 0);
    expect(judgeSteps(t, [step('sin(x)')]).dull).toBe(null);
    expect(judgeSteps(t, [step('x - x')]).dull).toBe('constant');
    expect(judgeSteps(t, [step('fract(sin(x * #a) * 43758.5453)', { '#a': 1000 })]).dull).toBe('alias');
    expect(judgeSteps(t, [step('sin(x * #a)', { '#a': 10 })]).dull).toBe(null);
    const w = chainSamples({ seed: WORLD_SEED, steps: [] }, 0);
    expect(judgeSteps(w, [step('vec3(x.x + #a * sin(x.z * #b), x.y, x.z)', { '#a': 0.2, '#b': 3 })]).dull).toBe(null);
  });

  it('hides dull tiles from the grid and lifts the ones that change the picture most', () => {
    const chain: Chain = { seed: UV_SEED, steps: [] };
    const g = nextMoves(chain, cat);
    const v = judgeTiles(chain, 0, g.same, cat);
    const { shown, hidden } = applyVerdicts(g.same, v);
    expect(shown.length + hidden.length).toBe(g.same.length);
    expect(hidden.length).toBeGreaterThan(0);
    for (const h of hidden) expect(v.get(h.tile.key)?.dull).toBe(h.reason);
    expect(shown.some(t => v.get(t.key)?.dull)).toBe(false);
    // With no verdicts yet, nothing moves
    expect(applyVerdicts(g.same, null).shown).toEqual(g.same);
  });

  it('costs a few milliseconds per tile at most (the window slices it)', () => {
    const chain: Chain = { seed: UV_SEED, steps: [] };
    const g = nextMoves(chain, cat);
    const tiles = [...g.same, ...g.changing, ...g.recipes];
    judgeTiles(chain, 0, tiles, cat); // warm: parse and compile each step once
    const t0 = performance.now();
    judgeTiles({ seed: UV_SEED, steps: [] }, 0, tiles, cat);
    const ms = performance.now() - t0;
    console.log(`[dull] ${tiles.length} UV tiles judged in ${ms.toFixed(1)} ms (${(ms / tiles.length).toFixed(3)} ms per tile)`);
    expect(ms / tiles.length).toBeLessThan(2);
  });
});

// ── Naming ────────────────────────────────────────────────────────────────────

const build = (seed: ExprSeed, templates: Array<string | [string, Record<string, number>]>): Chain => ({
  seed, steps: resolveTemplateSteps(templates.map(t => (typeof t === 'string' ? { template: t } : { template: t[0], values: t[1] })), seed, cat),
});

describe('naming the chain as it grows', () => {
  it('names the grid of dots step by step', () => {
    const c = build(UV_SEED, [['fract(x * #a)', { '#a': 4 }], ['x - #a', { '#a': 0.5 }], 'length(x)', ['smoothstep(#a, #b, x)', { '#a': 0.3, '#b': 0.25 }]]);
    expect(c.steps).toHaveLength(4);
    expect(chainNames(c).map(n => n?.name ?? null)).toEqual(['cell repeat', 'centred cells', 'grid of circles', 'grid of dots']);
    expect(currentName(c, 1)?.id).toBe('cell-repeat');
  });

  it('names a domain warp, a kaleidoscope fold, polar coordinates, rings', () => {
    expect(chainNames(build(UV_SEED, ['vec2(x.x + #a * sin(x.y * #b), x.y)']))[0]?.name).toBe('domain warp');
    expect(chainNames(build(UV_SEED, ['rotate(x, #a)', 'abs(x)'])).map(n => n?.name ?? null)).toEqual([null, 'kaleidoscope fold']);
    expect(chainNames(build(UV_SEED, ['abs(x)']))[0]?.name).toBe('mirror fold');
    expect(chainNames(build(UV_SEED, ['vec2(atan(x.y, x.x), length(x))']))[0]?.name).toBe('polar coordinates');
    expect(chainNames(build(UV_SEED, ['length(x)', ['fract(x * #a)', { '#a': 5 }]])).map(n => n?.name ?? null)).toEqual(['distance field', 'rings']);
  });

  it('falls back to glslPatterns idioms on the inlined chain (1 − x is an invert)', () => {
    const c = build(TIME_SEED, [['#a - x', { '#a': 1 }]]);
    const n = chainNames(c)[0];
    expect(n?.source).toBe('idiom');
    expect(n?.name).toMatch(/invert/i);
    // A cosine palette from time is a chain idiom (a colour ramp)
    expect(chainNames(build(TIME_SEED, ['#a + #b * cos(#c * (x + vec3(#d, #e, #f)))']))[0]?.name).toBe('colour ramp');
  });

  it('lifts a name\'s finishing moves in the grid', () => {
    const c = build(UV_SEED, [['fract(x * #a)', { '#a': 4 }]]);
    const g = nextMoves(c, cat);
    expect(g.name?.id).toBe('cell-repeat');
    const pool = [...g.same, ...g.changing].map(t => t.move);
    const boost = finishingBoost(g.name, pool);
    expect([...boost.values()].every(v => v === FINISH_BOOST)).toBe(true);
    expect(pool.filter(m => boost.has(m.id)).map(m => m.family)).toEqual(expect.arrayContaining(['offset', 'distance']));
    // A centre (x - #a) is among the first few same-type moves after a cell repeat
    expect(g.same.slice(0, 6).some(t => t.move.family === 'offset')).toBe(true);
  });
});

// ── Provenance ────────────────────────────────────────────────────────────────

describe('provenance links', () => {
  it('a source opens its graph at the node and line; a template becomes a Find uses pattern', () => {
    const t = nextMoves({ seed: UV_SEED, steps: [] }, cat).same.find(x => x.sourceRefs.some(r => r.nodePath?.length))!;
    const ref = t.sourceRefs.find(r => r.nodePath?.length)!;
    expect(ref.docId).toMatch(/^example:/);
    expect(t.sources).toContain(ref.label);
    const p = sourceProvenance(ref);
    expect(p).toMatchObject({ docId: ref.docId, nodeId: ref.nodePath![ref.nodePath!.length - 1], nodePath: ref.nodePath, line: ref.line ?? 1 });
    if (/^lines\[|^result$/.test(ref.field ?? '')) expect(p).toMatchObject({ sourceKind: 'expr', nodeType: 'exprNode' });
    expect(templatePattern('fract(x * #a) - #b')).toBe('fract($x * #a) - #b');
    expect(templatePattern('vec2(x.y, -x.x)')).toBe('vec2($x.y, -$x.x)');
    expect(templatePattern('x + $u * sin(x.yx * #b)')).toBe('$x + $u * sin($x.yx * #b)');
  });
});

// ── Surprise me ───────────────────────────────────────────────────────────────

function compiles(chain: Chain) {
  const g = previewGraph(chain);
  const r = compileGraph({ nodes: g.nodes });
  expect(r.success, `${chain.steps.map(s => s.template).join(' → ')}: ${(r.errors ?? []).join('; ')}`).toBe(true);
  expect(() => parser.parse(r.fragmentShader.replace(/^#version.*$/m, ''), { quiet: true })).not.toThrow();
}

describe('Surprise me', () => {
  it('the seeded RNG repeats', () => {
    const a = seededRandom(42), b = seededRandom(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
    expect(seededRandom(43)()).not.toBe(seededRandom(42)());
  });

  it('is deterministic for a seed, 2–5 moves, none dull, and always compiles', () => {
    const t0 = performance.now();
    let runs = 0;
    for (const seed of [UV_SEED, WORLD_SEED, TIME_SEED]) {
      const chain: Chain = { seed, steps: [] };
      const distinct = new Set<string>();
      for (let s = 1; s <= 12; s++) {
        const steps = surpriseSteps(chain, cat, { seed: s });
        runs++;
        expect(surpriseSteps(chain, cat, { seed: s }).map(x => x.template)).toEqual(steps.map(x => x.template));
        expect(steps.length, `${seed.label} #${s}`).toBeGreaterThanOrEqual(2);
        expect(steps.length).toBeLessThanOrEqual(5);
        const c: Chain = { seed, steps };
        // Every step showed something when it was picked
        for (let i = 0; i < steps.length; i++) {
          const v = judgeSteps(chainSamples(c, i), [steps[i]]);
          expect(v.dull, `${seed.label} #${s} step ${i + 1}: ${steps[i].template}`).toBe(null);
        }
        if (seed.kind !== 'time') compiles(c);
        distinct.add(steps.map(x => x.template).join('|'));
      }
      expect(distinct.size, seed.label).toBeGreaterThan(6);
    }
    console.log(`[surprise] ${runs} chains in ${(performance.now() - t0).toFixed(0)} ms (with compiles), ≈${((performance.now() - t0) / runs).toFixed(0)} ms each`);
  }, 60000);

  it('grows from the cursor, keeping the steps before it', () => {
    const c = build(UV_SEED, [['fract(x * #a)', { '#a': 4 }], ['x - #a', { '#a': 0.5 }]]);
    const steps = surpriseSteps(c, cat, { seed: 7, at: 1 });
    expect(steps[0].sig.in).toBe(chainEnd(c, 1).type);
    const t: GlslType = steps[steps.length - 1].sig.out;
    expect(['float', 'vec2', 'vec3', 'vec4']).toContain(t);
  });
});

export type { Move };
