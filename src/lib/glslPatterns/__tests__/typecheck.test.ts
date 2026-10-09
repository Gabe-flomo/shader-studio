/**
 * The strict GLSL ES 3.0 type check (typecheck.ts): constructor sizes, built-in overloads, no
 * implicit int → float, swizzles only on vectors. And, against a fixture of real WebGL 2 compile
 * results (captured in a browser: fixtures/webglCompile.json), the check agrees with the GPU.
 */
import { describe, expect, it } from 'vitest';
import { checkTypes, compileExpr, evaluate, parseExpr, type GlslType, type TypeEnv } from '..';
import fixture from './fixtures/webglCompile.json';

const check = (code: string, env: TypeEnv = {}) => {
  const r = parseExpr(code);
  if (!r.ok) throw new Error(r.error);
  return checkTypes(r.expr, env);
};
const ok = (code: string, env: TypeEnv, type: GlslType) => {
  const c = check(code, env);
  expect(c.errors, code).toEqual([]);
  expect(c.type, code).toBe(type);
};
const bad = (code: string, env: TypeEnv, why: RegExp) => {
  const c = check(code, env);
  expect(c.ok, code).toBe(false);
  expect(c.errors.join('; '), code).toMatch(why);
};

const F: TypeEnv = { x: 'float', y: 'float' };
const V2: TypeEnv = { x: 'vec2', u: 'float', v: 'vec2' };
const V3: TypeEnv = { x: 'vec3', u: 'float', v: 'vec2' };

describe('constructors: component counts', () => {
  it('fills a vector from parts, or one number', () => {
    ok('vec3(x, 1.0)', V2, 'vec3');
    ok('vec4(x, x)', V2, 'vec4');
    ok('vec3(u)', V2, 'vec3');
    ok('vec2(x)', V3, 'vec2'); // one bigger vector: truncated
    ok('vec2(1, 2)', {}, 'vec2'); // ints convert inside a constructor
    ok('mat2(1.0)', {}, 'mat2');
    ok('mat2(x, x)', V2, 'mat2');
    ok('float(x)', V3, 'float');
  });
  it('rejects too few components and arguments left over', () => {
    bad('vec4(x, 1.0)', F, /2 components, 4 needed/);
    bad('vec3(x)', V2, /2 components, 3 needed/);
    bad('vec2(x, 1.0)', V2, /too many arguments/);
    bad('vec2(1.0, 2.0, 3.0)', {}, /too many arguments/);
    bad('mat2(x)', V3, /matrix is built from/);
    bad('float(x, x)', F, /one argument/);
  });
});

describe('built-ins: genType overloads', () => {
  it('takes matching genTypes, or a float where the overload says float', () => {
    ok('step(0.5, x)', V3, 'vec3');
    ok('step(v, x)', V2, 'vec2');
    ok('smoothstep(0.0, 1.0, x)', V3, 'vec3');
    ok('mix(x, x, 0.5)', V3, 'vec3');
    ok('mix(x, x, x)', V3, 'vec3');
    ok('clamp(x, 0.0, 1.0)', V2, 'vec2');
    ok('min(x, 0.5)', V3, 'vec3');
    ok('max(x, y)', F, 'float');
    ok('pow(x, x)', V3, 'vec3');
    ok('mod(x, 2.0)', V2, 'vec2');
    ok('atan(x.y, x.x)', V2, 'float');
    ok('length(x)', V3, 'float');
    ok('dot(x, x)', V2, 'float');
    ok('rotate(x, 0.5)', V2, 'vec2');
    ok('noiseHash1(x)', V2, 'float');
  });
  it('rejects mismatched genTypes', () => {
    bad('step(x, u)', V3, /no overload of step\(vec3, float\)/);
    bad('step(x, 0.5)', V2, /no overload of step\(vec2, float\)/);
    bad('pow(x, 2.0)', V3, /no overload of pow\(vec3, float\)/);
    bad('mix(x, vec3(1.0), u)', { x: 'float', u: 'float' }, /no overload of mix\(float, vec3, float\)/);
    bad('mix(vec3(1.0), vec3(0.0), x)', V2, /no overload of mix\(vec3, vec3, vec2\)/);
    bad('max(u, x)', V2, /no overload of max\(float, vec2\)/);
    bad('clamp(u, x, x)', V2, /no overload of clamp/);
    bad('length(x, x)', V2, /no overload of length/);
    bad('rotate(x, 0.5)', V3, /no overload of rotate\(vec3, float\)/);
  });
});

describe('arithmetic, swizzles, conditions', () => {
  it('scalar ⊕ vector and same-size vectors, matrix × vector', () => {
    ok('x * 2.0 + v', V2, 'vec2');
    ok('mat2(1.0) * x', V2, 'vec2');
    ok('x * mat2(1.0)', V2, 'vec2');
    bad('x + vec3(1.0)', V2, /sizes differ/);
    bad('mat2(1.0) * x', V3, /sizes differ/);
  });
  it('has no int → float', () => {
    bad('x * 2', V2, /doesn't convert int to float/);
    bad('x + 1', F, /doesn't convert int to float/);
    ok('1 + 2', {}, 'int');
    bad('pow(x, 2)', F, /no overload/);
  });
  it('swizzles vectors only, within their size', () => {
    ok('x.yx', V2, 'vec2');
    ok('x.zxy', V3, 'vec3');
    ok('x.rgb', { x: 'vec4' }, 'vec3');
    bad('x.z', V2, /only 2 components/);
    bad('x.x', F, /only vectors/);
    bad('x.xg', V2, /isn't a swizzle/);
  });
  it('conditions are bools; both branches one type', () => {
    ok('x > 0.5 ? x : y', F, 'float');
    bad('x ? 1.0 : 2.0', F, /condition is a float/);
    bad('u > 0.5 ? x : u', V2, /both sides/);
    bad('x < v', V2, /compares numbers only/);
  });
  it('lets unknown names through (it only reports what is certainly wrong)', () => {
    ok('foo(x) * 2.0', V2, 'unknown');
    ok('p * 2.0', {}, 'unknown');
    ok('vec3(q, 1.0)', {}, 'vec3');
  });
});

describe('agrees with the GPU (WebGL 2 compile results captured in a browser)', () => {
  const cases = fixture.cases as unknown as Array<{ code: string; env: Record<string, GlslType>; compiles: boolean; out?: string; error?: string }>;
  it('has a fixture with both kinds', () => {
    expect(cases.length).toBeGreaterThan(100);
    expect(cases.some(c => c.compiles)).toBe(true);
    expect(cases.some(c => !c.compiles)).toBe(true);
  });
  it('accepts what compiled and rejects what didn\'t, on every case', () => {
    const wrong: string[] = [];
    for (const c of cases) {
      const r = parseExpr(c.code);
      const res = r.ok ? checkTypes(r.expr, c.env) : null;
      // A case declares its result type: `<out> r = code;`, so the check must also give that type.
      const passes = !!res && res.ok && (!c.out || res.type === c.out);
      if (passes !== c.compiles) wrong.push(`${c.compiles ? 'compiled' : 'failed'} on the GPU: ${c.out ?? ''} = ${c.code} with ${JSON.stringify(c.env)} → ${res?.errors.join('; ') || res?.type}${c.error ? ` (GPU: ${c.error})` : ''}`);
    }
    expect(wrong).toEqual([]);
  });
});

describe('the compiled evaluator', () => {
  it('gives what evaluate gives', () => {
    for (const [code, env] of [
      ['fract(x * 4.0) - 0.5', { x: [0.3, -0.7] }], ['length(x) > 0.5 ? 1.0 : 0.0', { x: [0.3, 0.6] }], ['rotate(x, 0.5).yx * vec2(2.0, 3.0)', { x: [1, 2] }],
      ['smoothstep(0.1, 0.4, abs(x.x))', { x: [0.25, 0] }], ['mat2(1.0, 2.0, 3.0, 4.0) * x', { x: [1, 1] }], ['noiseHash1(x) + valueNoise(x * 3.0)', { x: [0.2, 0.9] }],
    ] as const) {
      const r = parseExpr(code);
      if (!r.ok) throw new Error(code);
      expect(compileExpr(r.expr)(env as never), code).toEqual(evaluate(r.expr, env as never));
    }
  });
});
