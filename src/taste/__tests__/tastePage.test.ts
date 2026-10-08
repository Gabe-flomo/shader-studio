/**
 * The Taste page's model side (docs/taste.md): the summary (deterministic text from fixture models), the
 * context box (chips, unknown words), steering apart from learning (score = learned + steering, learned
 * weights never touched), bans in generation, the signal log (cap, migration, traces that add up), and
 * portable profiles (export → import, dormant sources, learning on top of a prior, merge math).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { EXAMPLE_GRAPHS } from '../../store/exampleGraphs';
import { makeRng } from '../../lib/surprise/rng';
import { makePool, planFor, type InspPool } from '../../lang/inspired/compose';
import { emptyModel, learnPair, learnRating, learnSignal, rateItem, tasteScore, type TasteModel } from '../model';
import type { Features } from '../features';
import { summarise, surenessOf } from '../summary';
import { parseContext, withContext } from '../context';
import { chipWanted, defaultSteering, effectiveModel, scoreBreakdown, steeringWeights, type Steering } from '../steering';
import { steeredBias } from '../bias';
import { appendLog, emptyLog, LOG_CAP, traceOf } from '../log';
import { exportTaste, importTaste, parseTaste, resetTaste, serialiseTaste, updateSteering, updateTaste, useTaste } from '../store';
import { applyImport, combine, emptyDormant, emptyLayer, isPortable, makeExport, mergeLayers, parseExport, reactivate, type Layer } from '../portable';

/** A fixture model: liked exp falloff + dark vivid palettes + an Expression Block in space; disliked fBm. */
function fixture(): TasteModel {
  return {
    ...emptyModel(),
    w: { 'fam:lightFalloff': 0.9, 'tech:falloff-exp': 0.7, 'img:contrast': 0.5, 'pal:dark': 0.4, 'pal:vivid': 0.3, 'tech:fbm': -0.6, 'set:falloff=hi': 0.35, _bias: 0.1 },
    n: { 'fam:lightFalloff': 12, 'tech:falloff-exp': 9, 'img:contrast': 6, 'pal:dark': 5, 'pal:vivid': 5, 'tech:fbm': 2, 'set:falloff=hi': 4 },
    stages: { space: { 'Expression Block': 6, 'Polar coordinates': 1 }, light: { 'Exponential falloff': 5, 'Smoothstep falloff': 2 } },
    signals: { pick: 14, rating: 3 },
  };
}

describe('the summary', () => {
  it('is deterministic text built from the weights and the stage table', () => {
    const a = summarise(fixture());
    expect(a.text).toBe(summarise(fixture()).text);
    expect(a.sentences.map(s => s.text)).toEqual([
      'You like glowing, high-contrast pictures with exponential falloff and dark, vivid palettes.',
      'In the space stage you usually reach for an Expression Block.',
      'For light, it’s mostly an exponential falloff (71% of the time).',
      'You tend to set falloff high.',
      'You rarely keep layered noise (fBm).',
    ]);
    expect(a.sentences[0].sure).toBe('sure');
    expect(a.sentences[4].sure).toBe('still learning');
    expect(a.sure.word).toBe('fairly sure');
    expect(a.text).toContain('(sure).');
  });

  it('differs per user and says when it knows nothing', () => {
    const other = { ...fixture(), w: { 'img:motion': 0.8, 'pal:muted': 0.5, 'code:yes': 0.4 }, stages: {} };
    expect(summarise(other).sentences[0].text).toBe('You like moving pictures with muted palettes and code in the graph.');
    expect(summarise(emptyModel()).text).toMatch(/^Nothing learned yet/);
    expect([surenessOf(1), surenessOf(5), surenessOf(20)]).toEqual(['still learning', 'fairly sure', 'sure']);
  });

  it('says your steering apart', () => {
    const s = withContext(defaultSteering(), 'dark, no fbm');
    const t = summarise(fixture(), s);
    expect(t.sentences[t.sentences.length - 1]).toEqual({ text: 'You asked for more dark pictures and palettes and less Layered noise (fBm).', sure: 'sure', steer: true });
  });
});

describe('the context box', () => {
  it('reads known phrases into chips with signs, and lists what it did not understand', () => {
    const p = parseContext('I like dark minimal pieces with lots of motion, no fBm, more code, zorblax glitter');
    expect(p.chips.map(c => [c.id, c.sign])).toEqual([
      ['syn:dark', 1], ['syn:minimal', -1], ['syn:moving', 1], ['tech:fbm', -1], ['syn:code', 1],
    ]);
    expect(p.chips.find(c => c.id === 'syn:minimal')!.features).toEqual(['img:detail']);
    expect(p.unknown).toEqual(['zorblax', 'glitter']);
    // “minimal” is wanted as written (simple shapes); “no fBm” is wanted less.
    expect(p.chips.filter(chipWanted).map(c => c.id)).toEqual(['syn:dark', 'syn:minimal', 'syn:moving', 'syn:code']);
  });

  it('knows the catalogue, settings with high / low, and negation', () => {
    const p = parseContext('exponential falloff, high falloff, without domain warp, vivid, not still');
    expect(p.chips.map(c => [c.id, c.sign])).toEqual([['tech:falloff-exp', 1], ['set:falloff=hi', 1], ['tech:domain-warp', -1], ['syn:vivid', 1], ['syn:still', 1]]);
    // “not still”: the still chip (less motion) flipped, so more motion.
    expect(steeringWeights({ ...defaultSteering(), chips: p.chips })['img:motion']).toBeGreaterThan(0);
    expect(p.unknown).toEqual([]);
  });

  it('keeps your flips and removals when the text changes', () => {
    let s = withContext(defaultSteering(), 'dark, busy');
    s = { ...s, chips: s.chips.map(c => (c.id === 'syn:dark' ? { ...c, flipped: true } : { ...c, off: true })) };
    s = withContext(s, 'dark, busy, vivid');
    expect(s.chips.map(c => [c.id, !!c.flipped, !!c.off])).toEqual([['syn:dark', true, false], ['syn:busy', false, true], ['syn:vivid', false, false]]);
    expect(steeringWeights(s)['look:dark']).toBeLessThan(0);
    expect(steeringWeights(s)['img:detail']).toBeUndefined();
  });
});

describe('steering sits on top of what was learned', () => {
  it('never changes the learned weights, and score = learned + steering', () => {
    const m = fixture();
    const before = JSON.stringify(m);
    const s: Steering = { ...withContext(defaultSteering(), 'dark, no fbm, more code'), pins: { 'fam:noise': 'avoid', 'tech:sdf-smooth': 'boost' } };
    const eff = effectiveModel(m, s);
    expect(JSON.stringify(m)).toBe(before);
    const f: Features = { _bias: 1, 'tech:fbm': 1, 'fam:noise': 1, 'pal:dark': 1, 'code:yes': 1, 'tech:sdf-smooth': 0.5 };
    const b = scoreBreakdown(m, s, f);
    const sw = steeringWeights(s);
    expect(b.learned).toBeCloseTo(tasteScore(m, f), 10);
    expect(b.steering).toBeCloseTo(Object.entries(f).reduce((acc, [k, x]) => acc + (sw[k] ?? 0) * x, 0), 10);
    expect(b.total).toBeCloseTo(b.learned + b.steering, 12);
    expect(tasteScore(eff, f)).toBeCloseTo(b.total, 10);
    // The store: steering changes leave the learned model alone.
    resetTaste('both');
    updateTaste(() => m);
    const learned = useTaste.getState().model;
    updateSteering(x => withContext(x, 'bright, busy'));
    expect(useTaste.getState().model).toBe(learned);
  });

  it('a lean of 0 is no lean at all', () => {
    expect(steeredBias(fixture(), { ...defaultSteering(), lean: 0 })).toBeUndefined();
  });
});

const examplePool = (() => {
  let pool: InspPool | null = null;
  return () => (pool ??= makePool(Object.entries(EXAMPLE_GRAPHS).filter(([k]) => k !== 'blank').map(([k, g]) => ({ id: `example:${k}`, label: g.label, kind: 'graph' as const, nodes: g.nodes }))));
})();

describe('a ban', () => {
  it('removes a family from generation', () => {
    const pool = examplePool();
    const used = (bias?: ReturnType<typeof steeredBias>) => {
      let n = 0;
      for (let s = 1; s <= 150; s++) for (const f of planFor(pool, s, bias).assign.values()) if (f.family === 'lightFalloff') n++;
      return n;
    };
    expect(used()).toBeGreaterThan(5);
    const ban: Steering = { ...defaultSteering(), pins: { 'fam:lightFalloff': 'ban' } };
    expect(used(steeredBias(emptyModel(), ban))).toBe(0);
  });

  it('removes a technique and a source', () => {
    const pool = examplePool();
    const counts = new Map<string, number>();
    for (let s = 1; s <= 120; s++) for (const id of planFor(pool, s).sources) counts.set(id, (counts.get(id) ?? 0) + 1);
    const [src] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    const bias = steeredBias(fixture(), { ...defaultSteering(), pins: { [`src:${src}`]: 'ban', 'tech:falloff-exp': 'ban' } });
    for (let s = 1; s <= 120; s++) {
      const p = planFor(pool, s, bias);
      expect(p.sources).not.toContain(src);
      for (const f of p.assign.values()) expect(f.what).not.toBe('Exponential falloff');
    }
  });
});

describe('the signal log', () => {
  it('keeps the newest entries, folding older ones into carried', () => {
    let log = emptyLog();
    for (let i = 0; i < 25; i++) log = appendLog(log, { at: i, kind: 'pick', delta: { a: 0.01 } }, 10);
    expect(log.entries).toHaveLength(10);
    expect(log.entries[0].id).toBe(16);
    expect(log.dropped).toBe(15);
    expect(traceOf(log, 'a').sum).toBeCloseTo(0.25, 10);
    expect(LOG_CAP).toBe(1000);
  });

  it('migrates a version-1 file: its weights carried, steering at the defaults', () => {
    const m = fixture();
    const v1 = JSON.stringify({ format: 'playfield-taste', version: 1, model: m });
    const r = parseTaste(v1);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.model.w).toEqual(m.w);
    expect(r.log.entries).toEqual([]);
    expect(r.log.carried).toEqual(m.w);
    expect(r.steering).toEqual(defaultSteering());
    // And it round-trips as version 2.
    const again = parseTaste(serialiseTaste(r.model, { log: r.log, steering: withContext(r.steering, 'dark') }));
    expect(again.ok && again.steering.chips.map(c => c.id)).toEqual(['syn:dark']);
  });

  it('traces add up to the weights (L2 decay included in each change)', () => {
    resetTaste('both');
    const rng = makeRng(7);
    const g = (fam: string): Features => ({ _bias: 1, [`fam:${fam}`]: 1, [`set:x${rng.int(0, 3)}=mid`]: 1, [`st:light=${fam}`]: 1 });
    for (let i = 0; i < 60; i++) {
      updateTaste(m => learnPair(m, g('A'), g('B')), { ref: { via: 'evolve', seed: 100 + i, pair: { round: i + 1, chosen: 'a', other: 'b' } } });
      if (i % 5 === 0) updateTaste(m => learnRating(m, g('A'), 1), { ref: { item: 'example:x', value: 1 } });
      if (i % 7 === 0) updateTaste(m => learnSignal(m, 'undone', g('B')), { ref: { seed: i } });
    }
    const { log, local } = useTaste.getState();
    expect(log.entries.length).toBeGreaterThan(60);
    for (const k of Object.keys(local.w)) expect(Math.abs(traceOf(log, k).sum - local.w[k])).toBeLessThan(1e-9);
    const t = traceOf(log, 'fam:A');
    expect(t.byKind.pick).toBeGreaterThan(0);
    expect(t.items[0].entry.ref?.seed).toBe(159);
  });
});

describe('portable profiles', () => {
  beforeEach(() => resetTaste('both'));

  const learnSome = () => {
    for (let i = 0; i < 12; i++) updateTaste(m => learnPair(m, { _bias: 1, 'fam:lightFalloff': 1, 'pal:dark': 1, 'src:saved:Moss': 1 }, { _bias: 1, 'fam:noise': 1, 'pal:light': 1 }), { ref: { seed: i } });
    updateTaste(m => rateItem(m, { id: 'saved:Moss', kind: 'graph', label: 'Moss' }, 1, { _bias: 1, 'fam:lightFalloff': 1 }), { ref: { item: 'saved:Moss' } });
  };

  it('splits portable from local features', () => {
    expect(['fam:noise', 'tech:fbm', 'pal:dark', 'set:falloff=hi', 'code:yes', 'img:motion', 'look:dark', 'src:example:neon', 'st:light=Exponential falloff', 'st:space=Expression Block', 'nh:3'].every(isPortable)).toBe(true);
    expect(['src:saved:Moss', 'src:shader:abc', 'st:space=myWarpFn'].some(isPortable)).toBe(false);
  });

  it('export → import into an empty store keeps portable scores; foreign sources go dormant, not lost', () => {
    learnSome();
    const before = useTaste.getState().model;
    const f: Features = { _bias: 1, 'fam:lightFalloff': 1, 'pal:dark': 1, 'fam:noise': 1 };
    const scoreBefore = tasteScore(before, f);
    const text = exportTaste('everything', 'summary', [{ id: 'saved:Moss', hash: 'nabc', label: 'Moss' }]);
    resetTaste('both');
    const r = importTaste(text, { mode: 'replace', present: [] });
    expect(r.ok).toBe(true);
    const after = useTaste.getState();
    expect(tasteScore(after.model, f)).toBeCloseTo(scoreBefore, 9);
    expect(after.local.w).toEqual({});
    expect(after.dormant.w['src:saved:Moss']).toBeCloseTo(before.w['src:saved:Moss'], 9);
    expect(after.dormant.ratings['saved:Moss']?.v).toBe(1);
    expect(after.model.w['src:saved:Moss']).toBeUndefined();
    // It wakes when the same graph appears under another name (by content hash).
    const woke = reactivate(after.prior, after.dormant, [{ id: 'saved:Moss copy', hash: 'nabc' }]);
    expect(woke.woke).toEqual(['saved:Moss copy']);
    expect(woke.prior.w['src:saved:Moss copy']).toBeCloseTo(before.w['src:saved:Moss'], 9);
    expect(woke.prior.ratings['saved:Moss copy']?.v).toBe(1);
  });

  it('a profile export strips your own items', () => {
    learnSome();
    const s = useTaste.getState();
    const file = makeExport({ prior: s.prior, local: s.local, dormant: s.dormant, log: s.log, steering: s.steering, summary: '', present: [] }, 'profile');
    expect(Object.keys(file.profile.w).some(k => k.startsWith('src:saved:'))).toBe(false);
    expect(file.local).toBeUndefined();
    expect(file.log.every(e => !Object.keys(e.d).some(k => k.startsWith('src:saved:')))).toBe(true);
    expect(parseExport(JSON.parse(JSON.stringify(file)))?.profile.w['fam:lightFalloff']).toBeCloseTo(s.model.w['fam:lightFalloff'], 9);
  });

  it('learning after an import goes to the local layer; the prior stays as imported', () => {
    learnSome();
    const text = exportTaste('profile');
    resetTaste('both');
    importTaste(text, { mode: 'replace' });
    const prior = JSON.stringify(useTaste.getState().prior);
    for (let i = 0; i < 5; i++) updateTaste(m => learnPair(m, { _bias: 1, 'fam:noise': 1 }, { _bias: 1, 'fam:lightFalloff': 1 }));
    const st = useTaste.getState();
    expect(JSON.stringify(st.prior)).toBe(prior);
    expect(st.local.w['fam:noise']).toBeGreaterThan(0);
    expect(st.model.w['fam:lightFalloff']).toBeCloseTo((st.prior.w['fam:lightFalloff'] ?? 0) + (st.local.w['fam:lightFalloff'] ?? 0), 12);
    for (const k of Object.keys(st.local.w)) expect(Math.abs(traceOf(st.log, k).sum - st.local.w[k])).toBeLessThan(1e-9);
  });

  it('merges by evidence', () => {
    const a: Layer = { ...emptyLayer(), w: { x: 1, y: 0.5 }, n: { x: 3, y: 2 }, signals: { pick: 3 } };
    const b: Layer = { ...emptyLayer(), w: { x: -1, z: 0.2 }, n: { x: 1, z: 4 }, signals: { pick: 1, rating: 2 } };
    const m = mergeLayers(a, b);
    expect(m.w.x).toBeCloseTo((1 * 3 - 1 * 1) / 4, 12);
    expect(m.w.y).toBeCloseTo(0.5, 12);
    expect(m.w.z).toBeCloseTo(0.2, 12);
    expect(m.n).toEqual({ x: 4, y: 2, z: 4 });
    expect(m.signals).toEqual({ pick: 4, rating: 2 });
    // Merge keeps this install's learning and its log.
    const local = { ...emptyModel(), w: { q: 0.3 } };
    const out = applyImport({ prior: a, local, dormant: emptyDormant(), log: emptyLog(), steering: defaultSteering() }, { kind: 'profile', exportedAt: 0, summary: '', profile: b, steering: defaultSteering(), log: [] }, 'merge', []);
    expect(out.local).toBe(local);
    expect(combine(out.prior, out.local).w.x).toBeCloseTo(0.5, 12);
  });
});
