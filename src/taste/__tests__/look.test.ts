/**
 * How things look (docs/taste.md): the image model's part of the taste model, with a deterministic fake
 * embedder (no model is downloaded in tests). The projection, centroid learning, cosine scoring, the
 * context box routing words to the vocabulary or to the image model, everything working with the model
 * off, and the portable export carrying the projected centroids.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  addLook, cosine, dropLookalikes, emptyLook, embOf, LOOK_DIMS, lookFeatures, lookLearn, lookNovelty, lookScore, normalised, parseLook, project,
  projectionMatrix, registerImageEmbedder, textLookScore, type LookState,
} from '../look';
import { graphFeatures, type Features } from '../features';
import { emptyModel, learnPair, learnRating, linearScore, lookPart, sampledScore, tasteScore } from '../model';
import { parseContext, withContext } from '../context';
import { defaultSteering, effectiveModel, lookTerms, scoreBreakdown } from '../steering';
import { combine, emptyLayer, localAfter, makeExport, parseExport, applyImport, emptyDormant } from '../portable';
import { emptyLog } from '../log';
import { exportTaste, importTaste, resetTaste, updateTaste, useTaste } from '../store';
import { makeRng } from '../../lib/surprise/rng';
import { scoreFrames, withNovelty } from '../../lib/surprise/score';
import { embedImage, embedText, imageModelUsable } from '../../imageModel/client';

const FULL = 512;

/** A deterministic "full embedding": a unit vector from a seed, near `base` when given (cosine ~ 1 − noise). */
function fakeFull(seed: number, base?: Float32Array, noise = 0.3): Float32Array {
  const r = makeRng(seed);
  const v = new Float32Array(FULL);
  for (let i = 0; i < FULL; i++) v[i] = (base ? base[i] : 0) + (base ? noise : 1) * (r.next() * 2 - 1) / (base ? Math.sqrt(FULL / 3) : 1);
  return normalised(v);
}

const ID = 'fake-clip+rp64.1';
const fakeEmbedder = (id = ID) => ({ id, dims: LOOK_DIMS, embed: async () => new Float32Array(LOOK_DIMS) });
const withLook = (f: Features, full: Float32Array): Features => ({ ...f, ...lookFeatures(project(full)) });

afterEach(() => registerImageEmbedder(null));

describe('the projection', () => {
  it('is fixed by its seed, 64 unit-length dims', () => {
    expect(projectionMatrix(FULL)).toBe(projectionMatrix(FULL));
    const x = fakeFull(1);
    const a = project(x), b = project(x);
    expect(a.length).toBe(LOOK_DIMS);
    expect(Array.from(a)).toEqual(Array.from(b));
    expect(Math.hypot(...a)).toBeCloseTo(1, 5);
    // Another seed is another matrix.
    expect(Array.from(project(x, LOOK_DIMS, 7))).not.toEqual(Array.from(a));
  });

  it('keeps cosines roughly (Johnson–Lindenstrauss)', () => {
    const errs: number[] = [];
    for (let i = 0; i < 40; i++) {
      const a = fakeFull(100 + i), b = i % 2 ? fakeFull(200 + i, a, 0.8) : fakeFull(300 + i);
      errs.push(Math.abs(cosine(a, b) - cosine(project(a), project(b))));
    }
    const mean = errs.reduce((s, e) => s + e, 0) / errs.length;
    expect(mean).toBeLessThan(0.12);
    expect(Math.max(...errs)).toBeLessThan(0.35);
  });

  it('rides along as emb:* features, outside the scaling of long vectors', () => {
    const p = project(fakeFull(3));
    const f = graphFeatures([], { embedding: p });
    expect(embOf(f)!.map(v => Math.round(v * 1e6))).toEqual(Array.from(p, v => Math.round(v * 1e6)));
    // 64 emb keys don't shrink the other features.
    const many: Features = graphFeatures([], { embedding: p, sources: Array.from({ length: 30 }, (_, i) => `example:x${i}`) });
    const few: Features = graphFeatures([], { sources: Array.from({ length: 30 }, (_, i) => `example:x${i}`) });
    expect(many['src:example:x0']).toBeCloseTo(few['src:example:x0'], 10);
  });
});

describe('centroids', () => {
  it('learn weighted means of liked, disliked and seen looks', () => {
    let s = emptyLook(ID, 3);
    s = lookLearn(s, [1, 0, 0], 1, 1);
    s = lookLearn(s, [0, 1, 0], 1, 3);
    s = lookLearn(s, [0, 0, 1], -1, 2);
    expect(s.likeW).toBe(4);
    expect(s.like).toEqual([0.25, 0.75, 0]);
    expect(s.dislikeW).toBe(2);
    expect(s.dislike).toEqual([0, 0, 1]);
    expect(s.seenW).toBe(6);
    expect(s.seen.map(v => +v.toFixed(4))).toEqual([0.1667, 0.5, 0.3333]);
  });

  it('add up across layers (weighted by evidence) and take a lesson away exactly', () => {
    const a = lookLearn(emptyLook(ID, 2), [1, 0], 1, 2);
    const b = lookLearn(emptyLook(ID, 2), [0, 1], 1, 6);
    const ab = addLook(a, b)!;
    expect(ab.likeW).toBe(8);
    expect(ab.like).toEqual([0.25, 0.75]);
    const back = addLook(ab, b, -1)!;
    expect(back.likeW).toBe(2);
    expect(back.like.map(v => +v.toFixed(9))).toEqual([1, 0]);
    // Another embedder's look counts for nothing: the newer one wins.
    expect(addLook(a, lookLearn(emptyLook('other', 2), [0, 1], 1, 1))!.embedder).toBe('other');
  });

  it('a lesson on the combined model goes to the local layer only', () => {
    registerImageEmbedder(fakeEmbedder());
    const x = withLook({ _bias: 1 }, fakeFull(9));
    const prior = { ...emptyLayer(), look: lookLearn(emptyLook(ID), embOf(x)!, 1, 3) };
    const local = emptyModel();
    const before = combine(prior, local);
    const after = learnRating(before, withLook({ _bias: 1 }, fakeFull(10)), 1);
    const loc = localAfter(prior, local, before, after);
    expect(loc.look!.likeW).toBeCloseTo(1, 9);
    expect(prior.look.likeW).toBe(3);
    // prior + local = what the lesson made.
    const again = combine(prior, loc);
    expect(again.look!.likeW).toBeCloseTo(after.look!.likeW, 9);
    again.look!.like.forEach((v, i) => expect(v).toBeCloseTo(after.look!.like[i], 9));
  });
});

describe('cosine scoring', () => {
  const liked = fakeFull(21), disliked = fakeFull(22);
  let s: LookState;
  beforeEach(() => {
    s = emptyLook(ID);
    for (let i = 0; i < 4; i++) s = lookLearn(s, project(fakeFull(30 + i, liked, 0.4)), 1, 1);
    for (let i = 0; i < 4; i++) s = lookLearn(s, project(fakeFull(40 + i, disliked, 0.4)), -1, 1);
  });

  it('is positive near the liked looks and negative near the disliked ones', () => {
    expect(lookScore(s, project(fakeFull(50, liked, 0.4)))).toBeGreaterThan(0.3);
    expect(lookScore(s, project(fakeFull(51, disliked, 0.4)))).toBeLessThan(-0.3);
    expect(Math.abs(lookScore(s, project(fakeFull(52))))).toBeLessThan(0.4);
  });

  it('is 0 with nothing learned, no picture, or another size', () => {
    expect(lookScore(emptyLook(ID), project(liked))).toBe(0);
    expect(lookScore(s, null)).toBe(0);
    expect(lookScore(undefined, project(liked))).toBe(0);
    expect(lookScore(s, [1, 0, 0])).toBe(0);
  });

  it('one like is enough to mean something (the mean is shrunk)', () => {
    const one = lookLearn(emptyLook(ID), project(liked), 1, 1);
    expect(lookScore(one, project(fakeFull(60, liked, 0.3)))).toBeGreaterThan(lookScore(one, project(fakeFull(61))));
  });
});

describe('the taste model with a look', () => {
  const liked = fakeFull(71), other = fakeFull(72);
  const fx = (full: Float32Array): Features => withLook({ _bias: 1, 'fam:noise': 1 }, full);

  it('learns the look in centroids, never in the linear weights', () => {
    registerImageEmbedder(fakeEmbedder());
    let m = emptyModel();
    for (let i = 0; i < 5; i++) m = learnPair(m, fx(fakeFull(80 + i, liked, 0.3)), fx(fakeFull(90 + i, other, 0.3)));
    expect(Object.keys(m.w).some(k => k.startsWith('emb:'))).toBe(false);
    expect(m.look!.embedder).toBe(ID);
    expect(m.embedder).toBe(ID);
    expect(m.look!.likeW).toBe(5);
    expect(m.look!.dislikeW).toBe(2.5);
    // The look part ranks a new liked-looking graph above a new other-looking one.
    expect(tasteScore(m, fx(fakeFull(100, liked, 0.3)))).toBeGreaterThan(tasteScore(m, fx(fakeFull(101, other, 0.3))) + 0.3);
    expect(lookPart(m, fx(fakeFull(100, liked, 0.3)))).toBeGreaterThan(0);
  });

  it('a change of embedder resets only the look', () => {
    registerImageEmbedder(fakeEmbedder());
    let m = learnRating(emptyModel(), fx(liked), 1);
    m = learnRating(m, { _bias: 1, 'tech:fbm': 1 }, 1);
    const w = { ...m.w };
    registerImageEmbedder(fakeEmbedder('another-model+rp64.1'));
    // The old look counts for nothing now…
    expect(lookPart(m, fx(liked))).toBe(0);
    // …and learning starts a new one, the weights carrying on.
    const m2 = learnRating(m, fx(other), 1);
    expect(m2.look!.embedder).toBe('another-model+rp64.1');
    expect(m2.look!.likeW).toBe(1);
    expect(m2.w['tech:fbm']).toBeCloseTo(w['tech:fbm'], 10);
  });

  it('works exactly as before with the model off (no embedder)', () => {
    const plain: Features = { _bias: 1, 'fam:noise': 1, 'pal:dark': 1 };
    const looked = withLook(plain, liked);
    let a = emptyModel(), b = emptyModel();
    for (let i = 0; i < 6; i++) { a = learnPair(a, plain, { _bias: 1, 'fam:waves': 1 }); b = learnPair(b, looked, { _bias: 1, 'fam:waves': 1 }); }
    expect(b.w).toEqual(a.w);
    expect(b.look).toBeUndefined();
    expect(tasteScore(b, looked)).toBe(linearScore(a, plain));
    // Thompson sampling draws the same numbers (emb:* keys take no noise).
    expect(sampledScore(b, looked, makeRng(5))).toBe(sampledScore(a, plain, makeRng(5)));
  });

  it('the score breakdown shows the look apart', () => {
    registerImageEmbedder(fakeEmbedder());
    const m = learnRating(emptyModel(), fx(liked), 1);
    const br = scoreBreakdown(m, defaultSteering(), fx(fakeFull(110, liked, 0.2)), 8, 0.25);
    expect(br.look).toBeGreaterThan(0);
    expect(br.lookText).toBe(0.25);
    expect(br.total).toBeCloseTo(br.learned + br.steering + br.look + br.lookText, 12);
    expect(br.top.some(c => c.key.startsWith('emb:'))).toBe(false);
  });
});

describe('words: the vocabulary or the image model', () => {
  it('without the model, unknown words are listed', () => {
    const p = parseContext('underwater stained glass, dark, no fbm');
    expect(p.unknown).toEqual(['underwater', 'stained', 'glass']);
    expect(p.chips.map(c => c.id)).toEqual(['syn:dark', 'tech:fbm']);
    expect(p.chips.some(c => c.look)).toBe(false);
  });

  it('with the model, they become chips by look (runs of words are one phrase)', () => {
    const p = parseContext('underwater stained glass, dark, no fbm', { byLook: true });
    expect(p.unknown).toEqual([]);
    const look = p.chips.filter(c => c.look);
    expect(look.map(c => c.look)).toEqual(['underwater stained glass', 'dark']);
    // The vocabulary still reads what it knows.
    expect(p.chips.find(c => c.id === 'syn:dark')?.features).toEqual(['look:dark', 'pal:dark']);
    expect(p.chips.find(c => c.id === 'tech:fbm')?.sign).toBe(-1);
    expect(p.chips.find(c => c.id === 'tech:fbm')?.look).toBeUndefined();
  });

  it('look words go to both; structural words only to the vocabulary', () => {
    const p = parseContext('neon city, more code', { byLook: true });
    expect(p.chips.find(c => c.id === 'syn:vivid')).toBeTruthy();
    expect(p.chips.find(c => c.look === 'neon city')).toBeTruthy();
    expect(p.chips.find(c => c.id === 'syn:code')?.look).toBeUndefined();
    expect(p.chips.filter(c => c.look).map(c => c.look)).toEqual(['neon city']);
  });

  it('negation turns a look phrase round; only what neither can use is unknown', () => {
    const p = parseContext('no underwater, xq 42 ok', { byLook: true });
    const u = p.chips.find(c => c.look === 'underwater')!;
    expect(u.sign).toBe(-1);
    expect(u.negated).toBe(true);
    expect(p.unknown).toEqual(['xq', 'ok']);
  });

  it('look terms come from chips that aren\'t removed, and count as steering', () => {
    let s = withContext(defaultSteering(), 'stained glass, no neon', { byLook: true });
    expect(lookTerms(s)).toEqual([{ text: 'stained glass', sign: 1 }, { text: 'neon', sign: -1 }]);
    s = { ...s, chips: s.chips.map(c => (c.look === 'neon' ? { ...c, off: true } : c)) };
    expect(lookTerms(s)).toEqual([{ text: 'stained glass', sign: 1 }]);
    expect(effectiveModel(emptyModel(), withContext(defaultSteering(), 'underwater', { byLook: true })).steered).toBe(1);
    // Without the model the same text steers nothing.
    expect(effectiveModel(emptyModel(), withContext(defaultSteering(), 'underwater')).steered ?? 0).toBe(0);
  });

  it('candidates are scored by image–text similarity against a neutral prompt', () => {
    const neon = fakeFull(201), neutral = fakeFull(202);
    const neonPic = fakeFull(203, neon, 0.5), otherPic = fakeFull(204);
    const terms = [{ text: 'neon', sign: 1, emb: neon }];
    expect(textLookScore(neonPic, terms, neutral)).toBeGreaterThan(textLookScore(otherPic, terms, neutral));
    expect(textLookScore(neonPic, [{ ...terms[0], sign: -1 }], neutral)).toBeLessThan(0);
    expect(textLookScore(null, terms, neutral)).toBe(0);
    expect(textLookScore(neonPic, [], neutral)).toBe(0);
  });
});

describe('novelty by look', () => {
  it('is the distance to the closest kept look', () => {
    const a = fakeFull(301);
    expect(lookNovelty(a, [])).toBe(1);
    expect(lookNovelty(a, [a])).toBe(0);
    expect(lookNovelty(a, [fakeFull(302)])).toBeGreaterThan(0.9);
  });

  it('drops near-identical candidates, keeping order', () => {
    const a = fakeFull(311), b = fakeFull(312);
    const items = [{ n: 'a', v: a }, { n: 'a2', v: fakeFull(313, a, 0.01) }, { n: 'b', v: b }, { n: 'none', v: null }];
    const r = dropLookalikes(items, x => x.v);
    expect(r.kept.map(x => x.n)).toEqual(['a', 'b', 'none']);
    expect(r.dropped.map(x => x.n)).toEqual(['a2']);
  });

  it('a new novelty moves Deep\'s score by its weight', () => {
    const f = { rgba: new Uint8Array(64 * 40 * 4).map((_, i) => (i * 37) % 256), w: 64, h: 40 };
    const sc = scoreFrames([f, f]);
    const lower = withNovelty(sc, 0);
    expect(lower.metrics.novelty).toBe(0);
    expect(sc.score - lower.score).toBeCloseTo(0.22 * sc.metrics.novelty, 10);
  });
});

describe('the portable profile', () => {
  beforeEach(() => resetTaste('both'));

  it('exports the projected centroids (never pictures) and imports them back', () => {
    registerImageEmbedder(fakeEmbedder());
    const liked = fakeFull(401);
    for (let i = 0; i < 3; i++) updateTaste(m => learnRating(m, withLook({ _bias: 1, 'fam:noise': 1 }, fakeFull(410 + i, liked, 0.3)), 1), { kind: 'rating' });
    updateTaste(m => learnRating(m, withLook({ _bias: 1 }, fakeFull(420)), -1), { kind: 'rating' });
    // The log notes the look's change apart from the weights.
    expect(useTaste.getState().log.entries.at(-1)!.lk).toEqual({ like: 0, dislike: 1 });
    const file = JSON.parse(exportTaste('profile'));
    const look = file.profile.look;
    expect(look.embedder).toBe(ID);
    expect(look.dims).toBe(LOOK_DIMS);
    expect(look.like).toHaveLength(LOOK_DIMS);
    expect(look.likeW).toBe(3);
    expect(look.dislikeW).toBe(1);
    expect(Object.keys(look).sort()).toEqual(['dims', 'dislike', 'dislikeW', 'embedder', 'like', 'likeW', 'seen', 'seenW']);
    // The centroid points at the liked looks.
    expect(cosine(look.like, project(liked))).toBeGreaterThan(0.8);
    const before = lookScore(useTaste.getState().model.look, project(fakeFull(430, liked, 0.3)));
    resetTaste('both');
    expect(useTaste.getState().model.look).toBeUndefined();
    expect(importTaste(JSON.stringify(file), { mode: 'replace' }).ok).toBe(true);
    expect(useTaste.getState().prior.look!.likeW).toBe(3);
    expect(lookScore(useTaste.getState().model.look, project(fakeFull(430, liked, 0.3)))).toBeCloseTo(before, 4);
  });

  it('merging adds the looks weighted by evidence', () => {
    const a = { ...emptyLayer(), look: lookLearn(emptyLook(ID, 2), [1, 0], 1, 1) };
    const file = makeExport({ prior: emptyLayer(), local: { ...emptyModel(), look: lookLearn(emptyLook(ID, 2), [0, 1], 1, 3) }, dormant: emptyDormant(), log: emptyLog(), steering: defaultSteering(), summary: '', present: [] }, 'profile');
    const parsed = parseExport(JSON.parse(JSON.stringify(file)))!;
    expect(parsed.profile.look!.likeW).toBe(3);
    const out = applyImport({ prior: a, local: emptyModel(), dormant: emptyDormant(), log: emptyLog(), steering: defaultSteering() }, parsed, 'merge', []);
    expect(out.prior.look!.likeW).toBe(4);
    expect(out.prior.look!.like).toEqual([0.25, 0.75]);
    expect(parseLook({ embedder: ID, dims: 2, like: [1], dislike: [0, 0], seen: [0, 0] })).toBeUndefined();
  });
});

describe('the image model, off', () => {
  it('is off without a setting or a download, and embeds nothing (no worker, no network)', async () => {
    expect(imageModelUsable()).toBe(false);
    expect(await embedImage({ rgba: new Uint8Array(16), w: 2, h: 2 })).toBeNull();
    expect(await embedText('neon')).toBeNull();
  });
});
