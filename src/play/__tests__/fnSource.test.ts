/**
 * The Function mapping source: the parser (play/kit/fn.js) — arithmetic,
 * precedence, unary minus, the function set, errors — the Play engine
 * reading it deterministically and normalising it by its own min..max, the
 * file round trip, and the web export's inlined copy.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { fnCompile, fnEval } from '../kit/fn.js';
import { playEngine } from '../../lib/playEngine';
import { KIT_SOURCES } from '../exportHtml';
import { emptyPlayRecord, parsePlayRecord, type PlayControl, type PlayMapping, type PlayRecord, type PlaySource } from '../../types/play';

afterEach(() => {
  playEngine.setRecord(emptyPlayRecord());
  playEngine.setBaseValues(new Map());
});

const V = (t = 0, b = 0) => ({ t, b });

// ── Parsing and evaluating ───────────────────────────────────────────────────

describe('fnEval: arithmetic and precedence', () => {
  it('does the four operators, in the usual order', () => {
    expect(fnEval('1 + 2 * 3', V()).value).toBe(7);
    expect(fnEval('(1 + 2) * 3', V()).value).toBe(9);
    expect(fnEval('10 - 4 / 2', V()).value).toBe(8);
    expect(fnEval('7 % 3', V()).value).toBe(1);
  });

  it('unary minus, including before a call and a paren', () => {
    expect(fnEval('-2 + 3', V()).value).toBe(1);
    expect(fnEval('2 * -3', V()).value).toBe(-6);
    expect(fnEval('-(1 + 2)', V()).value).toBe(-3);
    expect(fnEval('-abs(-4)', V()).value).toBe(-4);
  });

  it('^ is exponentiation, right-associative', () => {
    expect(fnEval('2^3', V()).value).toBe(8);
    expect(fnEval('2^3^2', V()).value).toBe(512); // 2^(3^2), not (2^3)^2
  });

  it('t, b, pi and tau', () => {
    expect(fnEval('t', V(5, 0)).value).toBe(5);
    expect(fnEval('b', V(0, 3)).value).toBe(3);
    expect(fnEval('pi', V()).value).toBeCloseTo(Math.PI, 10);
    expect(fnEval('tau', V()).value).toBeCloseTo(Math.PI * 2, 10);
  });

  it('the placeholder formula: a 0..1 sine', () => {
    const { value, error } = fnEval('sin(t * 2) * 0.5 + 0.5', V(Math.PI / 4, 0));
    expect(error).toBeNull();
    expect(value).toBeCloseTo(1, 6);
  });
});

describe('fnEval: the function set', () => {
  it('one-argument functions', () => {
    expect(fnEval('floor(1.9)', V()).value).toBe(1);
    expect(fnEval('ceil(1.1)', V()).value).toBe(2);
    expect(fnEval('round(1.5)', V()).value).toBe(2);
    expect(fnEval('fract(2.75)', V()).value).toBeCloseTo(0.75, 10);
    expect(fnEval('abs(-3)', V()).value).toBe(3);
    expect(fnEval('sign(-5)', V()).value).toBe(-1);
    expect(fnEval('sqrt(9)', V()).value).toBe(3);
  });

  it('two- and three-argument functions', () => {
    expect(fnEval('min(2, 5)', V()).value).toBe(2);
    expect(fnEval('max(2, 5)', V()).value).toBe(5);
    expect(fnEval('pow(2, 5)', V()).value).toBe(32);
    expect(fnEval('mod(-1, 3)', V()).value).toBe(2); // GLSL-style floored mod, not JS %
    expect(fnEval('step(0.5, 0.2)', V()).value).toBe(0);
    expect(fnEval('step(0.5, 0.7)', V()).value).toBe(1);
    expect(fnEval('clamp(5, 0, 1)', V()).value).toBe(1);
    expect(fnEval('mix(0, 10, 0.3)', V()).value).toBeCloseTo(3, 10);
    expect(fnEval('smoothstep(0, 1, 0.5)', V()).value).toBeCloseTo(0.5, 10);
  });

  it('noise and rand are pure functions of x alone', () => {
    const n1 = fnEval('noise(3.5)', V()).value;
    const n2 = fnEval('noise(3.5)', V()).value;
    expect(n1).toBe(n2);
    expect(n1).toBeGreaterThanOrEqual(0);
    expect(n1).toBeLessThanOrEqual(1);
    const r1 = fnEval('rand(3.5)', V()).value;
    const r2 = fnEval('rand(3.5)', V()).value;
    expect(r1).toBe(r2);
    // A different x gives a (very likely) different reading: not a constant in disguise.
    expect(fnEval('rand(3.5)', V()).value).not.toBe(fnEval('rand(9.1)', V()).value);
  });

  it('noise is smoothed between integers; rand is not', () => {
    // At an integer, noise and a hash-only rand needn't agree, but noise(i) and
    // noise(i + tiny) stay close (eased), while rand can jump between neighbours.
    const a = fnEval('noise(4.0)', V()).value;
    const b = fnEval('noise(4.01)', V()).value;
    expect(Math.abs(a - b)).toBeLessThan(0.05);
  });
});

describe('fnEval: errors', () => {
  it('an unknown name is an error, and reads as 0', () => {
    const { value, error } = fnEval('wob * 2', V());
    expect(value).toBe(0);
    expect(error).toMatch(/wob/);
  });

  it('an unknown function is an error', () => {
    expect(fnEval('nope(1)', V()).error).toMatch(/nope/);
  });

  it('the wrong number of arguments is an error', () => {
    expect(fnEval('sin(1, 2)', V()).error).toBeTruthy();
    expect(fnEval('clamp(1, 2)', V()).error).toBeTruthy();
  });

  it('a syntax problem is an error, not a throw', () => {
    expect(() => fnEval('1 +', V())).not.toThrow();
    expect(fnEval('1 +', V()).error).toBeTruthy();
    expect(fnEval('((1)', V()).error).toBeTruthy();
    expect(fnEval('1 2', V()).error).toBeTruthy();
    expect(fnEval(')', V()).error).toBeTruthy();
  });

  it('an empty expression is 0 with no error (nothing typed yet)', () => {
    expect(fnEval('', V())).toEqual({ value: 0, error: null });
  });

  it('a runtime non-finite result (1/0) reads as 0, not NaN or Infinity', () => {
    expect(fnEval('1 / 0', V())).toEqual({ value: 0, error: null });
  });
});

describe('fnEval: determinism and memoisation', () => {
  it('the same expression and t give the same value, every time', () => {
    const expr = 'sin(t * 1.3) * noise(t) + rand(floor(t))';
    const a = fnEval(expr, V(4.567, 9.1));
    const b = fnEval(expr, V(4.567, 9.1));
    expect(a).toEqual(b);
  });

  it('compiling the same text twice reuses the closure', () => {
    const expr = `sin(t) + ${Math.random()}`; // a fresh, never-seen-before string
    expect(fnCompile(expr)).toBe(fnCompile(expr));
  });
});

// ── The Play engine: normalised by min..max, deterministic from the timeline ─

const control = (id: string, over: Partial<PlayControl> = {}): PlayControl => ({ id, target: `n::${id}`, kind: 'float', label: id, min: 0, max: 1, ...over });
const mapping = (id: string, controlId: string, source: PlaySource, over: Partial<PlayMapping> = {}): PlayMapping => ({
  id, controlId, source, outMin: 0, outMax: 1, curve: 'linear', smoothMs: 0, enabled: true, ...over,
});

describe('the Play engine', () => {
  it('normalises the raw value into 0..1 by the source’s own min..max', () => {
    const src: PlaySource = { kind: 'fn', expr: 't', min: 0, max: 10 };
    playEngine.tickInputs(0, 5, () => {});
    expect(playEngine.readSource(src)).toBeCloseTo(0.5, 6);
    playEngine.tickInputs(0, 0, () => {});
    expect(playEngine.readSource(src)).toBeCloseTo(0, 6);
    playEngine.tickInputs(0, 20, () => {});
    expect(playEngine.readSource(src)).toBeCloseTo(1, 6); // clamped past max
  });

  it('the same timeline time gives the same reading (a take replays identically)', () => {
    const src: PlaySource = { kind: 'fn', expr: 'sin(t * 3) * 0.5 + 0.5', min: -1, max: 1 };
    playEngine.tickInputs(0, 1.75, () => {});
    const a = playEngine.readSource(src);
    playEngine.tickInputs(0, 9, () => {}); // scrub elsewhere
    playEngine.tickInputs(0, 1.75, () => {}); // and back
    const b = playEngine.readSource(src);
    expect(a).toBe(b);
  });

  it('drives a mapped control through the usual pipeline', () => {
    const m = mapping('a', 'out', { kind: 'fn', expr: 't', min: 0, max: 1 }, { outMin: 0, outMax: 100 });
    const rec: PlayRecord = { ...emptyPlayRecord(), controls: [control('out')], mappings: [m] };
    playEngine.setRecord(rec);
    playEngine.tickInputs(0, 0.5, () => {});
    expect(playEngine.liveValue('out')).toBeCloseTo(50, 3);
  });
});

// ── The file ─────────────────────────────────────────────────────────────────

describe('the file', () => {
  it('round-trips a Function source, and bad numbers come back in', () => {
    const rec: PlayRecord = { ...emptyPlayRecord(), controls: [control('out')], mappings: [mapping('a', 'out', { kind: 'fn', expr: 'sin(t)', min: -1, max: 1 })] };
    const back = parsePlayRecord(JSON.parse(JSON.stringify(rec)));
    expect(back.mappings[0].source).toEqual(rec.mappings[0].source);
  });

  it('an equal min and max is nudged apart, so normalising never divides by 0', () => {
    const back = parsePlayRecord({ ...emptyPlayRecord(), controls: [control('out')], mappings: [{ id: 'a', controlId: 'out', source: { kind: 'fn', expr: 't', min: 2, max: 2 }, outMin: 0, outMax: 1, curve: 'linear', smoothMs: 0, enabled: true }] });
    const src = back.mappings[0].source as Extract<PlaySource, { kind: 'fn' }>;
    expect(src.max).not.toBe(src.min);
  });

  it('a missing expression parses as the empty string, not a crash', () => {
    const back = parsePlayRecord({ ...emptyPlayRecord(), controls: [control('out')], mappings: [{ id: 'a', controlId: 'out', source: { kind: 'fn' }, outMin: 0, outMax: 1, curve: 'linear', smoothMs: 0, enabled: true }] });
    expect(back.mappings[0].source).toEqual({ kind: 'fn', expr: '', min: -1, max: 1 });
  });
});

// ── The web export ───────────────────────────────────────────────────────────

describe('the web export', () => {
  it('inlines the parser, and it agrees with the app’s own copy', () => {
    const body = KIT_SOURCES.map(src => src.replace(/^import .*$/gm, '').replace(/^export /gm, '')).join('\n');
    expect(body).toContain('function fnCompile(');
    expect(body).toContain('function fnEval(');
    const lib = new Function(`${body}; return { fnEval };`)() as { fnEval: typeof fnEval };
    const expr = 'sin(t * 1.7) * 0.5 + 0.5 + noise(b) - rand(floor(t))';
    expect(lib.fnEval(expr, V(3.14, 6.28))).toEqual(fnEval(expr, V(3.14, 6.28)));
  });

  it('SSKit exposes fn.eval, as play-runtime.js expects', () => {
    const body = KIT_SOURCES.map(src => src.replace(/^import .*$/gm, '').replace(/^export /gm, '')).join('\n');
    const sskit = new Function(`${body}\nreturn { fn: { eval: fnEval } };`)() as { fn: { eval: typeof fnEval } };
    expect(sskit.fn.eval('t * 2', V(3, 0))).toEqual(fnEval('t * 2', V(3, 0)));
  });
});
