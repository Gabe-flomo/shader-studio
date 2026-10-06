/**
 * The function card's model (functions.ts, fnAt.ts, fnCard.ts): which function is at a caret or
 * click, its signatures, its meaning, its plot with the call's literals, and what this call does.
 */
import { describe, it, expect } from 'vitest';
import {
  FUNCTION_REGISTRY, BUILTIN_FUNCTION_NAMES, functionInfo, signatureText, functionAt, functionsIn, declaredFunctions,
  functionCard, plotForCall, explainCall, snippetFor, toPlainText,
} from '..';
import { BUILTINS } from '../../../components/glslSyntax';
import { ALWAYS_HELPERS_GLSL } from '../../../compiler/shaderAssembler';
import { GLSL_REFERENCE } from '../../../components/code/glslReference';

describe('the registry', () => {
  it('every built-in the highlighter colours has an entry with a meaning', () => {
    const missing = [...BUILTINS].filter(n => !functionInfo(n)?.meaning);
    expect(missing).toEqual([]);
  });

  it.each(FUNCTION_REGISTRY.map(f => [f.name, f] as const))('%s has a meaning, overloads and typed parameters', (_, f) => {
    expect(f.meaning.length).toBeGreaterThan(12);
    expect(f.meaning).not.toMatch(/\.$/); // a noun phrase, not a sentence
    expect(f.overloads.length).toBeGreaterThan(0);
    for (const ov of f.overloads) {
      expect(ov.returns).toMatch(/^\w+$/);
      for (const p of ov.params) { expect(p.type).toMatch(/^\w+$/); expect(p.name).toMatch(/^\w+$/); }
    }
  });

  it('covers the GLSL ES 3.0 groups: math, geometric, common, texture sampling, derivatives', () => {
    for (const n of ['sin', 'atan', 'pow', 'exp2', 'inversesqrt', 'abs', 'fract', 'mod', 'mix', 'step', 'smoothstep', 'clamp',
      'length', 'distance', 'dot', 'cross', 'normalize', 'reflect', 'refract', 'faceforward',
      'texture', 'textureLod', 'texelFetch', 'textureSize', 'textureGrad', 'dFdx', 'dFdy', 'fwidth',
      'transpose', 'inverse', 'determinant', 'lessThan', 'any', 'all', 'not', 'isnan', 'floatBitsToUint']) {
      expect(BUILTIN_FUNCTION_NAMES, n).toContain(n);
    }
  });

  it('every function in the shader prelude is a helper with a meaning', () => {
    const names = [...ALWAYS_HELPERS_GLSL().matchAll(/\b(?:float|vec[234]|mat[234])\s+([A-Za-z_]\w*)\s*\(/g)].map(m => m[1]);
    expect(names.length).toBeGreaterThan(8);
    for (const n of names) {
      const f = functionInfo(n);
      expect(f?.kind, n).toBe('helper');
      expect(f?.meaning, n).toBeTruthy();
    }
  });

  it('the prelude helpers’ signatures match their GLSL', () => {
    for (const d of declaredFunctions(ALWAYS_HELPERS_GLSL())) {
      const f = functionInfo(d.name)!;
      expect(f.overloads.map(o => signatureText(d.name, o)), d.name).toContain(signatureText(d.name, d.overload));
    }
  });

  it('every function in the editors’ reference panel is known', () => {
    for (const r of GLSL_REFERENCE.filter(x => x.sig)) {
      // smin is in the reference, the prelude and the registry
      expect(functionInfo(r.name), r.name).toBeDefined();
    }
  });

  it('signatures read like GLSL', () => {
    expect(signatureText('smoothstep', functionInfo('smoothstep')!.overloads[1])).toBe('genType smoothstep(float edge0, float edge1, genType x)');
    expect(signatureText('modf', functionInfo('modf')!.overloads[0])).toBe('genType modf(genType x, out genType i)');
  });

  it('atan has both overloads, mix three', () => {
    expect(functionInfo('atan')!.overloads.map(o => o.params.length)).toEqual([2, 1]);
    expect(functionInfo('mix')!.overloads.map(o => o.params[2].type)).toEqual(['genType', 'float', 'genBType']);
  });

  it('snippets: an explicit link, or a snippet whose helper declares the name', () => {
    expect(snippetFor('smin', functionInfo('smin'))?.id).toBe('smin');
    expect(snippetFor('palette', functionInfo('palette'))?.id).toBe('cosPalette');
    expect(snippetFor('sminPoly')?.id).toBe('smin');
    expect(snippetFor('gain')?.id).toBe('gain');
    expect(snippetFor('sqrt', functionInfo('sqrt'))).toBeUndefined();
  });
});

describe('functionAt: the function at a caret or a click', () => {
  const code = 'float e = smoothstep(0.3, 0.35, length(p - vec2(0.5)));';
  const at = (s: string, i: number, opts = {}) => functionAt(s, i, opts)?.name ?? null;

  it('anywhere in the name, and right after it', () => {
    const s = code.indexOf('smoothstep');
    for (let i = s; i <= s + 'smoothstep'.length; i++) expect(at(code, i)).toBe('smoothstep');
    const l = code.indexOf('length');
    expect(at(code, l + 3)).toBe('length');
    expect(at(code, code.indexOf('vec2') + 1)).toBe('vec2');
  });

  it('not on a variable, a number, an operator or a type in a declaration', () => {
    expect(at(code, 0)).toBeNull(); // float
    expect(at(code, 6)).toBeNull(); // e
    expect(at(code, code.indexOf('0.35') + 1)).toBeNull();
    expect(at(code, code.indexOf('p -'))).toBeNull();
    expect(at(code, code.indexOf(' - '))).toBeNull();
  });

  it('with enclosing, a caret in the arguments finds the innermost call', () => {
    expect(at(code, code.indexOf('0.35'), { enclosing: true })).toBe('smoothstep');
    expect(at(code, code.indexOf('p -') + 1, { enclosing: true })).toBe('length');
    expect(at(code, code.indexOf('0.5)') + 1, { enclosing: true })).toBe('vec2');
    expect(at(code, 7, { enclosing: true })).toBeNull(); // before any call
  });

  it('spaces before the parenthesis', () => {
    expect(at('x = sin (t);', 5)).toBe('sin');
  });

  it('skips comments, members, preprocessor lines and keywords', () => {
    expect(at('// sin(x) here\nfloat y = 1.0;', 4)).toBeNull();
    expect(at('/* mix(a, b, t) */ a', 4)).toBeNull();
    expect(at('ctx.fill(1)', 5)).toBeNull();
    expect(at('#define SQ(x) ((x)*(x))', 9)).toBeNull();
    expect(at('if (a > 0.0) b = 1.0;', 1)).toBeNull();
    expect(at('for (int i = 0; i < 3; i++) {}', 1)).toBeNull();
  });

  it('arguments, their positions and the closing parenthesis', () => {
    const h = functionAt(code, code.indexOf('smoothstep'))!;
    expect(h.args).toEqual(['0.3', '0.35', 'length(p - vec2(0.5))']);
    expect(code.slice(h.argStarts[2], h.argStarts[2] + 6)).toBe('length');
    expect(code[h.close]).toBe(')');
    expect(code.slice(h.start, h.close + 1)).toBe('smoothstep(0.3, 0.35, length(p - vec2(0.5)))');
    expect(functionAt('f()', 0)!.args).toEqual([]);
  });

  it('across lines and tokens', () => {
    const multi = 'vec3 c = mix(\n  vec3(0.1),\n  palette(t, vec3(0.5), vec3(0.5), vec3(1.0), vec3(0.0, 0.33, 0.67)),\n  0.5);';
    const h = functionAt(multi, multi.indexOf('mix') + 1)!;
    expect(h.args).toHaveLength(3);
    expect(h.args[2]).toBe('0.5');
    expect(at(multi, multi.indexOf('palette') + 7)).toBe('palette');
    expect(at(multi, multi.indexOf('0.33'), { enclosing: true })).toBe('vec3');
  });

  it('declarations are marked', () => {
    const src = 'float circle(vec2 p, float r) {\n  return length(p) - r;\n}';
    expect(functionAt(src, 8)!.declaration).toBe(true);
    expect(functionAt(src, src.indexOf('length'))!.declaration).toBe(false);
  });

  it('functionsIn lists every call in order', () => {
    expect(functionsIn(code).map(h => h.name)).toEqual(['smoothstep', 'length', 'vec2']);
  });
});

describe('declaredFunctions: user functions from the source', () => {
  const src = [
    '// A ring around the origin.',
    '// r: its radius',
    'float ring(vec2 p, float r, float w) {',
    '  return abs(length(p) - r) - w;',
    '}',
    '',
    '/* Turn p. */',
    'vec2 turn(in vec2 p, float a) { return rotate(p, a); }',
    'void split(float x, out float i, out float f) { i = floor(x); f = x - i; }',
  ].join('\n');

  it('signatures with types, qualifiers and the comment above', () => {
    const fns = declaredFunctions(src);
    expect(fns.map(f => f.name)).toEqual(['ring', 'turn', 'split']);
    expect(signatureText('ring', fns[0].overload)).toBe('float ring(vec2 p, float r, float w)');
    expect(fns[0].doc).toBe('A ring around the origin. r: its radius');
    expect(fns[1].doc).toBe('Turn p.');
    expect(signatureText('turn', fns[1].overload)).toBe('vec2 turn(vec2 p, float a)');
    expect(signatureText('split', fns[2].overload)).toBe('void split(float x, out float i, out float f)');
  });

  it('calls are not declarations', () => {
    expect(declaredFunctions('float y = ring(p, 0.3, 0.01);\nreturn mix(a, b, t);')).toEqual([]);
  });
});

describe('the card', () => {
  it('smoothstep: built-in, overload table, meaning, a plot with the call’s literals and this call', () => {
    const code = 'float e = smoothstep(0.3, 0.35, d);';
    const card = functionCard(code, code.indexOf('smooth') + 2, { types: { d: 'float' } })!;
    expect(card.kind).toBe('builtin');
    expect(card.kindLabel).toBe('GLSL built-in · Common');
    expect(card.overloads).toHaveLength(2);
    expect(card.legend.map(l => l.type)).toEqual(['genType']);
    expect(card.meaning).toMatch(/soft ramp from 0 to 1 as x goes from edge0 to edge1/);
    expect(card.plotFromCall).toBe(true);
    expect(card.plotExpr).toBe('smoothstep(0.3, 0.35, x)');
    expect(card.plot!.edges).toEqual([0.3, 0.35]);
    expect(card.call).toBe('smoothstep(0.3, 0.35, d)');
    expect(card.hereText).toMatch(/0\.3/);
    expect(card.hereText).toMatch(/0\.35/);
    expect(card.docs).toMatch(/khronos.*smoothstep/);
  });

  it('a call without literals plots the defaults', () => {
    const p = plotForCall(functionInfo('smoothstep')!, ['a', 'b', 'x'])!;
    expect(p.fromCall).toBe(false);
    expect(p.expr).toBe('smoothstep(0.0, 1.0, x)');
    expect(plotForCall(functionInfo('pow')!, ['v', '3.0'])!.expr).toBe('pow(x, 3.0)');
    expect(plotForCall(functionInfo('mix')!, ['0.2', '0.8', 'k'])!.expr).toBe('mix(0.2, 0.8, a)');
    expect(plotForCall(functionInfo('step')!, ['0.25', 'q'])!.plot.edges).toEqual([0.25]);
  });

  it('every function with a plot spec plots', () => {
    for (const f of FUNCTION_REGISTRY.filter(x => x.plot)) {
      expect(plotForCall(f, []), f.name).not.toBeNull();
    }
  });

  it('no plot for functions of a vector', () => {
    const code = 'float d = length(p);';
    expect(functionCard(code, 12)!.plot).toBeUndefined();
  });

  it('per-call explanations', () => {
    expect(toPlainText(explainCall('step(0.02, a)', { types: { a: 'float' } })!)).toMatch(/0\.02/);
    expect(toPlainText(explainCall('mix(col, vec3(1.0), 0.25)', { types: { col: 'vec3' } })!)).toMatch(/mostly `col`/);
    expect(toPlainText(explainCall('mix(a, b, 0.25)', { types: { a: 'float', b: 'float' }, noIdioms: true })!)).toMatch(/25%/);
    expect(toPlainText(explainCall('sin(u_time * 2.0)')!)).toMatch(/^Takes the sine/);
    const hash = toPlainText(explainCall('fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453)', { types: { p: 'vec2' } })!);
    expect(hash).toMatch(/random/);
    expect(explainCall('a + b')).toBeNull();
    expect(explainCall('mystery(p, 2.0)')).toBeNull();
    expect(toPlainText(explainCall('smin(d1, d2, 0.1)')!)).toMatch(/melting them together over 0\.1/);
  });

  it('a helper: Playfield helper with its snippet', () => {
    const code = 'float d = smin(d1, d2, 0.1);';
    const card = functionCard(code, 11)!;
    expect(card.kind).toBe('helper');
    expect(card.snippet?.id).toBe('smin');
    expect(card.plotExpr).toBe('smin(a, 0.5, 0.1)');
    expect(card.docs).toMatch(/iquilezles/);
  });

  it('a user function: signature parsed from the source, its comment as the doc', () => {
    const source = '// A ring of radius r.\nfloat ring(vec2 p, float r) { return abs(length(p) - r); }';
    const card = functionCard('float d = ring(uv, 0.3);', 12, { source })!;
    expect(card.kind).toBe('user');
    expect(card.kindLabel).toBe('Your function');
    expect(card.overloads.map(o => signatureText('ring', o))).toEqual(['float ring(vec2 p, float r)']);
    expect(card.doc).toBe('A ring of radius r.');
    expect(card.plot).toBeUndefined();
    expect(card.here).toBeUndefined();
  });

  it('a snippet helper in the user’s code reads with the snippet’s words', () => {
    const source = 'float gain(float x, float k) {\n  float a = 0.5 * pow(2.0 * ((x < 0.5) ? x : 1.0 - x), k);\n  return (x < 0.5) ? a : 1.0 - a;\n}';
    const card = functionCard('return gain(v, 2.0);', 8, { source })!;
    expect(card.kind).toBe('user');
    expect(card.snippet?.id).toBe('gain');
    expect(card.meaning).toMatch(/^an S-curve/);
  });

  it('an unknown function says so', () => {
    const card = functionCard('x = mystery(1.0);', 6)!;
    expect(card.kind).toBe('unknown');
    expect(card.meaning).toBeUndefined();
  });

  it('a declaration shows the function, not a call', () => {
    const src = 'float ring(vec2 p, float r) { return 0.0; }';
    const card = functionCard(src, 7)!;
    expect(card.kind).toBe('user');
    expect(card.call).toBeUndefined();
  });

  it('nothing on a variable', () => {
    expect(functionCard('float d = a;', 10)).toBeNull();
  });
});
