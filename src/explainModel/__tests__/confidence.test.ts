/**
 * Structured answers and measured confidence (docs/explain-model.md): the tolerant JSON reader, the thinking split,
 * the grounding check, the token-probability statistics, the double-check's agreement, and how they combine
 * (the model is mocked: these are all pure functions over its text and numbers).
 */
import { describe, expect, it } from 'vitest';
import { parseExplain } from '../structured';
import { splitThinking } from '../thinking';
import {
  THRESHOLDS, agreement, assessItem, assessNode, assessPlain, combineConfidence, consistency, groundingCheck, logprobStats,
  type GroundingContext, type TokenLp,
} from '../confidence';
import { viewAnswer } from '../assess';

const OBJ = '{"line":2,"what":"A sine wave of a shifted by t.","effect":"Stripes that slide sideways.","sure":"medium","unsure_about":"how w is used"}';

describe('reading the JSON answer', () => {
  it('reads a complete object', () => {
    const p = parseExplain(OBJ);
    expect(p.structured).toBe(true);
    expect(p.items).toHaveLength(1);
    expect(p.items[0]).toMatchObject({ line: 2, what: 'A sine wave of a shifted by t.', effect: 'Stripes that slide sideways.', sure: 'medium', unsureAbout: 'how w is used', complete: true });
  });

  it('reads a half-written object while it streams, field by field', () => {
    const steps = [
      ['{"line": 2, "wh', undefined, undefined],
      ['{"line": 2, "what": "A sine wa', 'A sine wa', undefined],
      ['{"line": 2, "what": "A sine wave.", "effect": "Strip', 'A sine wave.', 'Strip'],
    ] as const;
    for (const [text, what, effect] of steps) {
      const p = parseExplain(text);
      expect(p.items[0].line).toBe(2);
      expect(p.items[0].what).toBe(what);
      expect(p.items[0].effect).toBe(effect);
      expect(p.items[0].complete).toBe(false);
      expect(p.items[0].sure).toBeUndefined();
    }
    expect(parseExplain('{"li').structured).toBe(false); // nothing readable yet
  });

  it('reads a summary then one object per line (JSON lines), with code fences and a trailing cut', () => {
    const text = '```json\n{"summary":"Draws a glow."}\n{"line":1,"what":"a","effect":"b","sure":"high","unsure_about":""}\n{"line":2,"what":"c","eff';
    const p = parseExplain(text);
    expect(p.summary).toBe('Draws a glow.');
    expect(p.items.map(i => [i.line, i.what, i.effect, i.complete])).toEqual([[1, 'a', 'b', true], [2, 'c', undefined, false]]);
    expect(p.items[0].sure).toBe('high');
  });

  it('handles escaped quotes, braces inside strings and an array wrapper', () => {
    const p = parseExplain('[{"line":1,"what":"Says \\"hi\\" and uses { braces }","effect":"x","sure":"low","unsure_about":""}]');
    expect(p.items).toHaveLength(1);
    expect(p.items[0].what).toBe('Says "hi" and uses { braces }');
    expect(p.items[0].sure).toBe('low');
  });

  it('falls back to plain text on garbage: no structure, the text kept', () => {
    for (const g of ['Makes a soft glow around the shape.', '1: a\n2: b', '', '{"unrelated": 1}', '{{{']) {
      const p = parseExplain(g);
      expect(p.structured).toBe(false);
      expect(p.items).toEqual([]);
    }
    expect(parseExplain('```\nJust prose\n```').plain).toBe('Just prose');
  });

  it('ignores an unknown sure value rather than inventing one', () => {
    expect(parseExplain('{"line":1,"what":"x","sure":"certain"}').items[0].sure).toBeUndefined();
  });

  it('reports where the words sit in the text', () => {
    const p = parseExplain(OBJ);
    const [[a, b], [c, d]] = p.items[0].spans;
    expect(OBJ.slice(a, b)).toBe('A sine wave of a shifted by t.');
    expect(OBJ.slice(c, d)).toBe('Stripes that slide sideways.');
  });
});

describe('the thinking pass', () => {
  it('splits reasoning from the answer', () => {
    const s = splitThinking('<think>\nHmm, sin of x.\n</think>\n\n{"line":1}');
    expect(s.thinking).toBe('Hmm, sin of x.');
    expect(s.answer).toBe('{"line":1}');
    expect(s.thinkingNow).toBe(false);
  });
  it('is still thinking while the tag is open, and the answer is empty', () => {
    const s = splitThinking('<think>Let me see');
    expect(s).toMatchObject({ thinking: 'Let me see', answer: '', thinkingNow: true });
  });
  it('passes text from a model that does not think straight through, and hides a half-typed tag', () => {
    expect(splitThinking('{"line":1}').answer).toBe('{"line":1}');
    expect(splitThinking('{"line":1} <thi').answer).toBe('{"line":1} ');
  });
  it('the answer is read after the reasoning, with token positions shifted', () => {
    const raw = '<think>x</think>\n' + OBJ;
    const v = viewAnswer({ kind: 'line', raw, done: true, lineNo: 2, check: ctx() });
    expect(v.split.thinking).toBe('x');
    expect(v.items[0].item.what).toBe('A sine wave of a shifted by t.');
    expect(raw.slice(v.items[0].item.spans[0][0] + v.split.answerStart, v.items[0].item.spans[0][1] + v.split.answerStart)).toBe('A sine wave of a shifted by t.');
  });
});

describe('token probabilities', () => {
  const toks = (xs: Array<[string, number]>): TokenLp[] => xs.map(([t, lp]) => ({ t, lp }));
  it('takes the mean and the weakest of the tokens inside the answer’s words only', () => {
    const t = toks([['{"what": "', -0.01], ['A ', -0.2], ['sine', -1.0], ['"}', -0.01]]);
    const text = t.map(x => x.t).join('');
    const start = text.indexOf('A ');
    const s = logprobStats(t, text, [[start, start + 6]])!;
    expect(s.n).toBe(2);
    expect(s.mean).toBeCloseTo(-0.6);
    expect(s.min).toBe(-1.0);
  });
  it('uses every token when the pieces do not line up with the text, and null when there are none', () => {
    const t = toks([['a', -0.1], ['b', -0.3]]);
    expect(logprobStats(t, 'something else', [[0, 3]])!.n).toBe(2);
    expect(logprobStats([], 'x')).toBeNull();
    expect(logprobStats(undefined, 'x')).toBeNull();
  });
});

function ctx(over: Partial<GroundingContext> = {}): GroundingContext {
  return {
    lines: ['float a = uv.x * 6.0', 'float w = sin(a - t * 2.0)', 'vec3 c = vec3(1.0, 0.8, 0.55) * w'],
    code: 'float a = uv.x * 6.0\nfloat w = sin(a - t * 2.0)\nvec3 c = vec3(1.0, 0.8, 0.55) * w',
    inputs: [{ name: 'uv', type: 'vec2', numbers: [-1, 1] }, { name: 't', type: 'float', numbers: [] }],
    inputText: 'uv: vec2, from UV: pixel position, centred, about -1..1\nt: float, built in: time in seconds',
    factsText: 'Function sin: gives the sine wave of an angle',
    colourFacts: ['vec3(1.0, 0.8, 0.55) is the colour a light warm orange (red, green, blue)'],
    ...over,
  };
}

describe('the grounding check', () => {
  it('passes an answer that only uses what is there', () => {
    expect(groundingCheck({ line: 2, what: 'A sine wave of `a` shifted by the clock t, 2 times faster.', effect: 'Stripes that slide sideways.' }, ctx(), 2)).toEqual([]);
  });

  it('flags a name that is not in the code or the inputs', () => {
    const i = groundingCheck({ line: 2, what: 'Uses `moonlight` and u_phase to shade.', effect: '' }, ctx(), 2);
    expect(i.map(x => x.kind)).toContain('identifier');
    expect(i.find(x => x.kind === 'identifier')!.detail).toMatch(/moonlight/);
  });

  it('flags a number that is not in the code, inputs or facts, and lets small counts and the code’s numbers through', () => {
    const bad = groundingCheck({ line: 1, what: 'Scales by 7 and fades 55% of the way.', effect: '' }, ctx(), 1);
    expect(bad.some(x => x.kind === 'number')).toBe(true);
    expect(groundingCheck({ line: 1, what: 'Multiplies the x position by 6.0, so 6 repeats.', effect: 'Runs from 0 to 1.' }, ctx(), 1).filter(x => x.kind === 'number')).toEqual([]);
  });

  it('says so when it names a function the code does not have (a contradiction), versus one on another line', () => {
    const none = groundingCheck({ line: 1, what: 'Takes the sine of the x position.', effect: '' }, ctx({ code: 'float a = uv.x * 6.0', lines: ['float a = uv.x * 6.0'] }), 1);
    expect(none).toContainEqual(expect.objectContaining({ kind: 'function', contradiction: true }));
    const elsewhere = groundingCheck({ line: 1, what: 'Takes the sine of the x position.', effect: '' }, ctx(), 1);
    expect(elsewhere).toContainEqual(expect.objectContaining({ kind: 'function', contradiction: false }));
    expect(groundingCheck({ line: 2, what: 'A sine wave.', effect: '' }, ctx(), 2)).toEqual([]);
  });

  it('flags a colour that contradicts the colour facts, and a colour with no colour in the code', () => {
    const wrong = groundingCheck({ line: 3, what: 'Multiplies by a bright red.', effect: '' }, ctx(), 3);
    expect(wrong).toContainEqual(expect.objectContaining({ kind: 'colour', contradiction: true }));
    expect(groundingCheck({ line: 3, what: 'A warm orange tint.', effect: '' }, ctx(), 3).filter(x => x.kind === 'colour')).toEqual([]);
    const invented = groundingCheck({ line: 1, what: 'Makes it blue.', effect: '' }, ctx({ colourFacts: [] }), 1);
    expect(invented).toContainEqual(expect.objectContaining({ kind: 'colour', contradiction: false }));
  });

  it('flags an answer about a different line than the one asked', () => {
    expect(groundingCheck({ line: 3, what: 'x', effect: 'y' }, ctx(), 2)).toContainEqual(expect.objectContaining({ kind: 'line' }));
  });
});

describe('agreement between samples', () => {
  const a = { what: 'A sine wave of the x position shifted by the clock.', effect: 'Stripes slide sideways over time.' };
  it('is high for the same meaning in other words and low for a different one', () => {
    const b = { what: 'Sine wave of x position, shifted by the clock.', effect: 'Moving stripes sliding sideways.' };
    const c = { what: 'Blends two colours by a mask.', effect: 'A pink and blue gradient.' };
    expect(agreement(a, b)).toBeGreaterThan(0.5);
    expect(agreement(a, c)).toBeLessThan(THRESHOLDS.agreeLow);
  });
  it('averages every pair; one answer alone has none', () => {
    expect(consistency([a])).toBeNull();
    expect(consistency([a, a, a])).toBe(1);
  });
});

describe('combining the signals', () => {
  const steady = { mean: -0.1, min: -0.8, n: 20 };

  it('is high only when everything agrees, and says what it checked', () => {
    const c = combineConfidence({ sure: 'high', unsureAbout: '', logprob: steady, grounding: [] });
    expect(c.level).toBe('high');
    expect(c.notSure).toBeNull();
    expect(c.reasons.join(' ')).toMatch(/steady/);
    expect(c.reasons.join(' ')).toMatch(/every name and number/);
  });

  it('the model saying "low" is low and always carries the tag, with its own reason first', () => {
    const c = combineConfidence({ sure: 'low', unsureAbout: 'what t is', logprob: steady, grounding: [] });
    expect(c.level).toBe('low');
    expect(c.notSure).toBe('what t is');
  });

  it('a non-empty unsure_about is at most medium and shows the tag', () => {
    const c = combineConfidence({ sure: 'high', unsureAbout: 'how w is used', logprob: steady, grounding: [] });
    expect(c.level).toBe('medium');
    expect(c.notSure).toBe('how w is used');
  });

  it('measured signals beat a confident self-report: low probabilities → low, with a tag', () => {
    const c = combineConfidence({ sure: 'high', logprob: { mean: THRESHOLDS.meanLow - 0.1, min: -2, n: 10 }, grounding: [] });
    expect(c.level).toBe('low');
    expect(c.notSure).toMatch(/low-probability/);
    expect(combineConfidence({ sure: 'high', logprob: { mean: THRESHOLDS.meanMedium - 0.05, min: -2, n: 10 }, grounding: [] }).level).toBe('medium');
    expect(combineConfidence({ sure: 'high', logprob: { mean: -0.1, min: THRESHOLDS.minMedium - 1, n: 10 }, grounding: [] }).level).toBe('medium');
  });

  it('one unbacked name is medium; a contradiction, or two problems, is low', () => {
    const inv = { kind: 'identifier' as const, detail: 'mentions `moon`', contradiction: false };
    const num = { kind: 'number' as const, detail: 'says 7', contradiction: false };
    const bad = { kind: 'function' as const, detail: 'talks about sin, but there is no sin in the code', contradiction: true };
    expect(combineConfidence({ sure: 'high', logprob: steady, grounding: [inv] }).level).toBe('medium');
    expect(combineConfidence({ sure: 'high', logprob: steady, grounding: [inv, num] }).level).toBe('low');
    const c = combineConfidence({ sure: 'high', logprob: steady, grounding: [bad] });
    expect(c.level).toBe('low');
    expect(c.notSure).toMatch(/no sin/);
  });

  it('a disagreeing double-check marks it low; agreement alone does not raise a doubtful answer', () => {
    expect(combineConfidence({ sure: 'high', logprob: steady, grounding: [], consistency: 0.1 }).level).toBe('low');
    expect(combineConfidence({ sure: 'high', logprob: steady, grounding: [], consistency: 0.9 }).level).toBe('high');
    expect(combineConfidence({ sure: 'low', logprob: steady, grounding: [], consistency: 0.9 }).level).toBe('low');
  });

  it('a missing self-report is at most medium; a node explanation has none to read', () => {
    expect(combineConfidence({ logprob: steady, grounding: [] }).level).toBe('medium');
    expect(assessNode({ tokens: [{ t: 'a', lp: -0.05 }, { t: 'b', lp: -0.1 }], raw: 'ab' }).level).toBe('high');
    expect(assessNode({ tokens: [{ t: 'a', lp: -2 }], raw: 'a' }).level).toBe('low');
  });

  it('never presents a low-confidence answer without the tag', () => {
    const cases = [
      combineConfidence({ sure: 'low' }),
      combineConfidence({ sure: 'high', logprob: { mean: -2, min: -5, n: 3 } }),
      combineConfidence({ sure: 'high', grounding: [{ kind: 'function', detail: 'x', contradiction: true }] }),
      combineConfidence({ sure: 'high', consistency: 0 }),
      assessPlain('prose', { raw: 'prose' }),
    ];
    for (const c of cases) { expect(c.level).toBe('low'); expect(c.notSure).toBeTruthy(); }
  });
});

describe('assessing a streamed answer (the model mocked)', () => {
  const raw = (sure: string, what: string, unsure = '') => `{"line":2,"what":"${what}","effect":"Stripes slide sideways.","sure":"${sure}","unsure_about":"${unsure}"}`;
  const tokensFor = (text: string, lp: number): TokenLp[] => [...text.matchAll(/.{1,4}/g)].map(m => ({ t: m[0], lp }));

  it('a steady, grounded, confident answer is a high dot with no tag', () => {
    const text = raw('high', 'A sine wave of a shifted by the clock t.');
    const v = viewAnswer({ kind: 'line', raw: text, tokens: tokensFor(text, -0.05), check: ctx(), lineNo: 2, done: true });
    expect(v.items[0].confidence!.level).toBe('high');
    expect(v.items[0].confidence!.notSure).toBeNull();
  });

  it('a confident answer with a made-up function and shaky tokens is low and tagged', () => {
    const text = raw('high', 'Takes the cosine of `moonphase` and adds 99.');
    const v = viewAnswer({ kind: 'line', raw: text, tokens: tokensFor(text, -1.5), check: ctx(), lineNo: 2, done: true });
    const c = v.items[0].confidence!;
    expect(c.level).toBe('low');
    expect(c.notSure).toBeTruthy();
  });

  it('gives no confidence while it is still streaming, and falls back to a tagged plain text on garbage', () => {
    const partial = viewAnswer({ kind: 'line', raw: '{"line":2,"what":"A sine', done: false, check: ctx(), lineNo: 2 });
    expect(partial.items[0].confidence).toBeNull();
    const garbage = viewAnswer({ kind: 'line', raw: 'It makes a nice glow around everything on the screen.', done: true, check: ctx(), lineNo: 2 });
    expect(garbage.plain?.text).toMatch(/nice glow/);
    expect(garbage.plain?.confidence?.level).toBe('low');
    expect(garbage.plain?.confidence?.notSure).toBeTruthy();
  });

  it('the double-check’s samples feed the dot: a different answer lowers it', () => {
    const text = raw('high', 'A sine wave of a shifted by the clock t.');
    const same = raw('high', 'A sine wave of a shifted by the clock t.');
    const other = '{"line":2,"what":"Blends pink and blue by a mask.","effect":"A gradient.","sure":"high","unsure_about":""}';
    const base = { kind: 'line' as const, raw: text, tokens: tokensFor(text, -0.05), check: ctx(), lineNo: 2, done: true };
    expect(viewAnswer({ ...base, samples: [same, same] }).items[0].confidence!.level).toBe('high');
    const v = viewAnswer({ ...base, samples: [other, other] }).items[0].confidence!;
    expect(v.level).toBe('low');
    expect(v.notSure).toMatch(/different answer/);
  });

  it('assessItem works straight from an item', () => {
    const p = parseExplain(raw('high', 'A sine wave of a shifted by t.')).items[0];
    expect(assessItem(p, { g: ctx(), askedLine: 2, raw: '' }).level).toBe('high');
  });
});
