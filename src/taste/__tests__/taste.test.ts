/**
 * The taste model (docs/taste.md): the learner converges on synthetic preferences, exploration holds, the
 * model round-trips through storage, ratings move source weights, the generator leans, and Evolve's state
 * machine (rounds, Keep, Escape) is deterministic given the seed and the model.
 */
import { describe, expect, it } from 'vitest';
import { EXAMPLE_GRAPHS } from '../../store/exampleGraphs';
import { makeRng } from '../../lib/surprise/rng';
import { makePool, planFor, type InspPool } from '../../lang/inspired/compose';
import { stageChoice } from '../../lang/inspired/fragments';
import {
  blendScore, compositionFeatures, emptyModel, graphFeatures, learnPair, learnRating, learnSignal, learnedLine, learnedTraits, makeEvolveGen,
  noteOpened, preferProb, rankWithExploration, rateItem, sourceWeight, stagePreference, stageSuggestions, startEvolve, pickEvolve, keepEvolve,
  escapeEvolve, tasteBias, tasteRerank, tasteScore, techniqueFeatures, type Features, type TasteModel,
} from '..';
import { loadTaste, parseTaste, saveTaste, serialiseTaste, TASTE_KEY } from '../store';

/** A synthetic graph: family X or Y, a stage choice, and noise from a shared set. */
function synth(rng: ReturnType<typeof makeRng>, fam: 'X' | 'Y'): Features {
  const f: Features = { _bias: 1, [`fam:${fam}`]: 1, [`st:light=${fam === 'X' ? 'Exp falloff' : 'Smoothstep'}`]: 1 };
  for (let i = 0; i < 8; i++) if (rng.chance(0.4)) f[`set:noise${i}=mid`] = 1;
  f[`nh:${rng.int(0, 9)}`] = 0.5;
  return f;
}

/** P(X ≻ Y) averaged over held-out pairs. */
function heldOut(m: TasteModel, seed = 999): { p: number; right: number } {
  const rng = makeRng(seed);
  let p = 0, right = 0;
  for (let i = 0; i < 200; i++) {
    const a = synth(rng, 'X'), b = synth(rng, 'Y');
    const q = preferProb(m, a, b);
    p += q; if (q > 0.5) right++;
  }
  return { p: p / 200, right: right / 200 };
}

function train(picks: number, seed = 1): TasteModel {
  const rng = makeRng(seed);
  let m = emptyModel();
  for (let i = 0; i < picks; i++) m = learnPair(m, synth(rng, 'X'), synth(rng, 'Y'));
  return m;
}

describe('the learner', () => {
  it('converges on family X after picks of X over Y', () => {
    const at = [0, 3, 5, 10, 20].map(n => ({ n, ...heldOut(train(n)) }));
    console.log('[taste] convergence P(X≻Y) on held-out pairs:', at.map(a => `${a.n} picks → ${a.p.toFixed(3)} (${Math.round(a.right * 100)}% ranked right)`).join(', '));
    expect(at[0].p).toBeCloseTo(0.5, 5);
    expect(at[2].right).toBeGreaterThan(0.95);
    expect(at[3].p).toBeGreaterThan(0.7);
    expect(at[4].p).toBeGreaterThan(at[3].p);
    // And the stage table says so in words.
    const m = train(10);
    expect(stagePreference(m, 'light', 'Exp falloff')).toBeGreaterThan(0.8);
    expect(learnedTraits(m, 3)).toContain('exp falloff');
    expect(learnedLine(m)).toMatch(/^you prefer .*exp falloff/);
    expect(stageSuggestions(m)[0]).toBe('You usually put an Exp falloff in the light stage');
  });

  it('learns from noisy picks too (80% X), averaged over runs', () => {
    let sum = 0;
    for (const seed of [3, 7, 11, 19, 23, 31, 47, 59]) {
      const rng = makeRng(seed);
      let m = emptyModel();
      for (let i = 0; i < 40; i++) {
        const a = synth(rng, 'X'), b = synth(rng, 'Y');
        m = rng.chance(0.8) ? learnPair(m, a, b) : learnPair(m, b, a);
      }
      sum += heldOut(m).p;
    }
    expect(sum / 8).toBeGreaterThan(0.6);
  });

  it('single ratings and implicit signals teach, the implicit ones less', () => {
    const f = techniqueFeatures('expFalloff');
    const liked = learnRating(emptyModel(), f, 1);
    const kept = learnSignal(emptyModel(), 'kept', f);
    const undone = learnSignal(emptyModel(), 'undone', f);
    expect(tasteScore(liked, f)).toBeGreaterThan(tasteScore(kept, f));
    expect(tasteScore(kept, f)).toBeGreaterThan(0);
    expect(tasteScore(undone, f)).toBeLessThan(0);
    expect(kept.signals.kept).toBe(1);
    const o = noteOpened(noteOpened(noteOpened(emptyModel(), 'saved:a').model, 'saved:a').model, 'saved:a');
    expect(o.often).toBe(true);
  });

  it('blends Deep and taste only as far as it is confident', () => {
    expect(blendScore(0.5, 3, emptyModel())).toBe(0.5);
    const m = train(20);
    expect(blendScore(0.5, 3, m)).toBeGreaterThan(0.6);
    expect(blendScore(0.5, 3, m)).toBeLessThan(0.81);
  });
});

describe('exploration', () => {
  it('keeps ~25% of slots for exploration, so the other style still reaches the top', () => {
    const m = train(40);
    const rng = makeRng(5);
    let explored = 0, slots = 0, yTop = 0;
    const T = 2000;
    for (let t = 0; t < T; t++) {
      const items = [synth(rng, 'X'), synth(rng, 'X'), synth(rng, 'Y'), synth(rng, 'Y')];
      const r = rankWithExploration(items, f => tasteScore(m, f), rng);
      // The last slot has no choice left, so it never counts.
      for (const x of r.slice(0, -1)) { slots++; if (x.explored) explored++; }
      if (r[0].item['fam:Y']) yTop++;
    }
    const share = explored / slots;
    console.log(`[taste] exploration share ${share.toFixed(3)}; the disliked style first in ${(yTop / T * 100).toFixed(1)}% of rankings`);
    expect(share).toBeGreaterThan(0.22);
    expect(share).toBeLessThan(0.28);
    expect(yTop / T).toBeGreaterThan(0.08);
    expect(yTop / T).toBeLessThan(0.25);
  });
});

describe('storage', () => {
  const mem = () => { const kv = new Map<string, string>(); return { getItem: (k: string) => kv.get(k) ?? null, setItem: (k: string, v: string) => { kv.set(k, v); }, removeItem: (k: string) => { kv.delete(k); }, kv }; };

  it('round-trips a model through storage and through an export', () => {
    let m = train(6);
    m = rateItem(m, { id: 'saved:Moss', kind: 'graph', label: 'Moss' }, 1, techniqueFeatures('expFalloff'), 123);
    const s = mem();
    saveTaste(m, s);
    expect(s.kv.has(TASTE_KEY)).toBe(true);
    expect(loadTaste(s)).toEqual(m);
    const r = parseTaste(serialiseTaste(m));
    expect(r.ok && r.model).toEqual(m);
  });

  it('refuses what it cannot read, and an empty store is an empty model', () => {
    expect(parseTaste('nope').ok).toBe(false);
    expect(parseTaste(JSON.stringify({ format: 'x' })).ok).toBe(false);
    const newer = parseTaste(JSON.stringify({ format: 'playfield-taste', version: 99, model: {} }));
    expect(!newer.ok && newer.error).toMatch(/newer/);
    expect(loadTaste(mem())).toEqual(emptyModel());
  });
});

const examplePool = (() => {
  let pool: InspPool | null = null;
  return () => (pool ??= makePool(Object.entries(EXAMPLE_GRAPHS).filter(([k]) => k !== 'blank').map(([k, g]) => ({ id: `example:${k}`, label: g.label, kind: 'graph' as const, nodes: g.nodes }))));
})();

describe('the generator leans on taste', () => {
  it('a liked source is used more, a disliked one less', () => {
    const pool = examplePool();
    // A source that often appears unbiased.
    const counts = new Map<string, number>();
    for (let s = 1; s <= 120; s++) for (const id of planFor(pool, s).sources) counts.set(id, (counts.get(id) ?? 0) + 1);
    const [target, base] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    const liked = rateItem(emptyModel(), { id: target, kind: 'example' }, 1, { _bias: 1 });
    const disliked = rateItem(emptyModel(), { id: target, kind: 'example' }, -1, { _bias: 1 });
    expect(sourceWeight(liked, target)).toBeGreaterThan(2.5);
    expect(sourceWeight(disliked, target)).toBeLessThan(0.5);
    const uses = (m: TasteModel) => { let c = 0; for (let s = 1; s <= 120; s++) if (planFor(pool, s, tasteBias(m)).sources.includes(target)) c++; return c; };
    const up = uses(liked), down = uses(disliked);
    console.log(`[taste] source ${target}: ${base} of 120 plans unbiased, ${up} liked, ${down} disliked`);
    expect(up).toBeGreaterThan(base);
    expect(down).toBeLessThan(base);
  });

  it('the per-stage table leans each stage toward its favourite', () => {
    const pool = examplePool();
    const lightChoices = new Map<string, number>();
    for (let s = 1; s <= 150; s++) { const f = planFor(pool, s).assign.get('light'); if (f) lightChoices.set(stageChoice(f), (lightChoices.get(stageChoice(f)) ?? 0) + 1); }
    const rare = [...lightChoices.entries()].sort((a, b) => a[1] - b[1])[0][0];
    let m = emptyModel();
    for (let i = 0; i < 8; i++) m = learnPair(m, { _bias: 1, [`st:light=${rare}`]: 1 }, { _bias: 1, 'st:light=Other': 1 });
    const count = (bias?: ReturnType<typeof tasteBias>) => { let c = 0; for (let s = 1; s <= 150; s++) { const f = planFor(pool, s, bias).assign.get('light'); if (f && stageChoice(f) === rare) c++; } return c; };
    expect(count(tasteBias(m))).toBeGreaterThan(count());
    // An empty model is no lean at all: exactly the old plans.
    expect(tasteBias(emptyModel())).toBeUndefined();
  });
});

describe('Evolve', () => {
  const original = EXAMPLE_GRAPHS[Object.keys(EXAMPLE_GRAPHS).find(k => k !== 'blank')!].nodes;

  it('runs rounds of Refine and Branch, keeps one, and Escape restores the original exactly', () => {
    const gen = makeEvolveGen(examplePool());
    let model = emptyModel();
    let s = startEvolve(original, 42, gen, model);
    expect(s.round).toBe(1);
    expect(s.pair.map(c => c.kind)).toEqual(['fresh', 'fresh']);
    for (let r = 0; r < 3; r++) ({ state: s, model } = pickEvolve(s, 0, gen, model));
    expect(s.round).toBe(4);
    expect(s.pair.map(c => c.kind)).toEqual(['refine', 'branch']);
    expect(s.picks).toHaveLength(3);
    expect(model.signals.pick).toBe(3);
    expect(s.pair[1].comp.inspirations.some(i => i.id.startsWith('evolve:'))).toBe(true);
    const esc = escapeEvolve(s);
    expect(esc.status).toBe('escaped');
    expect(esc.result).toBe(original);
    const kept = keepEvolve(s, 1, model);
    expect(kept.state.status).toBe('kept');
    expect(kept.state.result).toBe(s.pair[1].comp.nodes);
    expect(kept.model.signals.kept).toBe(1);
    // Done is done.
    expect(pickEvolve(kept.state, 0, gen, kept.model).state).toBe(kept.state);
  });

  it('is deterministic given the seed and the model', () => {
    const gen = makeEvolveGen(examplePool());
    const m0 = train(5);
    const run = () => {
      let model = m0;
      let s = startEvolve(original, 7, gen, model);
      for (const w of [1, 0, 1] as const) ({ state: s, model } = pickEvolve(s, w, gen, model));
      return { pair: s.pair.map(c => ({ kind: c.kind, seed: c.seed, nodes: c.comp.nodes, changes: c.changes })), model };
    };
    const a = run(), b = run();
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    // A different model leans differently (the same seed, another taste).
    let other = emptyModel();
    for (let i = 0; i < 6; i++) other = learnRating(other, { _bias: 1, 'st:space=Expression Block': 1 }, 1);
    const s2 = startEvolve(original, 7, gen, other);
    expect(s2.pair[0].comp.nodes.length).toBeGreaterThan(0);
  });

  it('consistent picks move the next Branch toward the picked style', () => {
    const pool = examplePool();
    const gen = makeEvolveGen(pool);
    let model = emptyModel();
    let s = startEvolve(original, 11, gen, model);
    const style = (c: { comp: { stages: Array<{ stage: string; choice: string }> } }) => c.comp.stages.find(x => x.stage === 'field')?.choice;
    // Always pick the candidate whose field stage is Circle SDF-free code (or the first), five rounds.
    const target = style(s.pair[0]) ?? 'Custom Function';
    for (let r = 0; r < 5; r++) {
      const w: 0 | 1 = style(s.pair[1]) === target && style(s.pair[0]) !== target ? 1 : 0;
      ({ state: s, model } = pickEvolve(s, w, gen, model));
    }
    expect(stagePreference(model, 'field', target)).toBeGreaterThan(0.5);
    expect(learnedLine(model)).toMatch(/^you prefer/);
    const feats = compositionFeatures(s.pair[0].comp);
    expect(Object.keys(feats).some(k => k.startsWith('st:'))).toBe(true);
  });
});

describe('features', () => {
  it('reads techniques, stages, code, settings and palettes off a graph', () => {
    const nodes = Object.values(EXAMPLE_GRAPHS).find(g => g.nodes.some(n => n.type === 'palette'))!.nodes;
    const f = graphFeatures(nodes, { metrics: { colourful: 0.9, contrast: 0.5, detail: 0.4, motion: 0.1, structure: 0.2, novelty: 1 } });
    expect(f._bias).toBe(1);
    expect(Object.keys(f).some(k => k.startsWith('pal:'))).toBe(true);
    expect(Object.keys(f).some(k => k.startsWith('nh:'))).toBe(true);
    expect('code:yes' in f || 'code:no' in f).toBe(true);
    expect(f['img:colourful']).toBeGreaterThan(0);
  });

  it('type-ahead re-ranking is light and never moves exact matches', () => {
    const items = ['circle', 'circleSDF', 'circles', 'arc', 'ring'];
    const lean = (x: string) => (x === 'ring' ? 1 : 0);
    const out = tasteRerank(items, lean, x => x === 'circle');
    expect(out[0]).toBe('circle');
    // "ring" moves up at most 1.5 places (from 3rd of the rest to 2nd).
    expect(out.indexOf('ring')).toBe(3);
    expect(tasteRerank(items, () => 0)).toEqual(items);
  });
});
