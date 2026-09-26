/**
 * Shapes the user corpus showed the converter getting wrong or refusing: each
 * one small, with what it must become.
 */
import { describe, it, expect } from 'vitest';
import { glslToGraph, normaliseHostShader, resolveConditionals } from '..';
import { compileGraph } from '../../compiler/graphCompiler';
import { threadGlobals } from '../threadGlobals';
import { blackTextures, translateToStudio } from '../../glsl/dialects';
import type { GraphNode } from '../../types/nodeGraph';

const ok = (src: string) => {
  const r = glslToGraph(src);
  expect(r.report.unsupported).toEqual([]);
  const c = compileGraph({ nodes: r.nodes });
  expect(c.errors ?? []).toEqual([]);
  return { r, c };
};
const code = (nodes: GraphNode[]) => nodes.map(n => `${n.params.body ?? ''}\n${n.params.expr ?? ''}\n${JSON.stringify(n.params.lines ?? [])}`).join('\n');

describe('the preprocessor, as the preprocessor does it', () => {
  it('leaves a statement macro a statement (no parentheses around it)', () => {
    const { r } = ok('#define S(x) col += sin(x) * 0.1;\nvoid main(){ vec3 col = vec3(0.0); vec2 uv = gl_FragCoord.xy / u_resolution.xy; S(uv.x) S(uv.y) gl_FragColor = vec4(col, 1.0); }');
    expect(r.nodes.length).toBeGreaterThan(0);
  });
  it('keeps a macro from gluing onto its neighbour', () => {
    expect(normaliseHostShader('#define N -1.\nvoid main(){ float a = -N; gl_FragColor = vec4(a); }').code).toMatch(/- -1\./);
  });
  it('an empty statement (`;;`, or a macro ending in `;` before a `;`) is nothing', () => {
    ok('#define Z d = 0.5;\nvoid main(){ float d = 1.0; Z; ; gl_FragColor = vec4(vec3(d), 1.0); }');
  });
  it('resolves #ifdef / #ifndef / #else / #endif and #if 0, blanking lines so they still count', () => {
    const src = '#define A\n#ifdef A\nfloat k = 1.0;\n#else\nfloat k = 2.0;\n#endif\n#ifndef A\nx\n#endif\n#if 0\ny\n#elif defined(A)\nfloat j;\n#endif';
    const out = resolveConditionals(src);
    expect(out.split('\n')).toHaveLength(src.split('\n').length);
    expect(out).toContain('float k = 1.0;');
    expect(out).not.toContain('2.0');
    expect(out).not.toMatch(/\bx\b|\by\b/);
    expect(out).toContain('float j;');
    ok('#define ROUND\nvoid main(){ vec2 uv = gl_FragCoord.xy / u_resolution.xy;\n#ifdef ROUND\nfloat d = length(uv - 0.5);\n#else\nfloat d = uv.x;\n#endif\ngl_FragColor = vec4(vec3(d), 1.0); }');
  });
});

describe('Shadertoy pastes', () => {
  it('blacks out a whole texture(iChannel…) call, parentheses and all, keeping its lines', () => {
    expect(blackTextures('float n = texture(iChannel0, uv*.2+vec2(t,0.)).x;')).toBe('float n = vec4(0.0).x;');
    expect(blackTextures('v = texture(iChannel1,\n  p).rgb;')).toBe('v = vec4(0.0)\n.rgb;');
    expect(translateToStudio('void mainImage(out vec4 O, vec2 u){ O = vec4(texture(iChannel0, u / iResolution.xy + vec2(iTime, 0.)).x); }').code).toMatch(/vec4\(vec4\(0\.0\)\.x\)/);
  });
  it('gives a forward declaration the parameters its definition gains', () => {
    const { code } = threadGlobals('float t;\nfloat f(vec2 p);\nvoid main(){ t = u_time; gl_FragColor = vec4(f(gl_FragCoord.xy)); }\nfloat f(vec2 p) { return p.x * t; }');
    expect(code).toContain('float f(vec2 p, float t);');
    expect(code).toContain('float f(vec2 p, float t) {');
  });
  it('reads u_mouse in pixels, like gl_FragCoord', () => {
    const { r } = ok('void main(){ float d = length(gl_FragCoord.xy - u_mouse); gl_FragColor = vec4(vec3(d / 100.0), 1.0); }');
    const m = r.nodes.find(n => n.type === 'mouse')!;
    const reader = r.nodes.find(n => Object.values(n.inputs).some(i => i.connection?.nodeId === m.id))!;
    expect(Object.values(reader.inputs).find(i => i.connection?.nodeId === m.id)!.connection!.outputKey).toBe('px');
  });
});

describe('the output', () => {
  it('a local named fragColor is a variable, and only the last write to the output counts', () => {
    const { r } = ok('void mainImage(out vec4 fragColor, in vec2 fragCoord){ fragColor = vec4(0.0); fragColor.r = fragCoord.x / iResolution.x; fragColor += 0.1; }');
    expect(r.nodes.filter(n => n.type === 'output' || n.type === 'vec4Output')).toHaveLength(1);
  });
  it('writes to part of gl_FragColor after the whole', () => {
    const { r } = ok('void main(){ gl_FragColor = vec4(vec3(0.5), 1.0); gl_FragColor.a = 0.25; }');
    expect(r.nodes.filter(n => n.type === 'vec4Output')).toHaveLength(1);
    expect(r.nodes.filter(n => n.type === 'output')).toHaveLength(0);
  });
});

describe('expressions', () => {
  it('knows tanh and friends, and keeps a matrix product as code', () => {
    ok('void main(){ vec2 uv = gl_FragCoord.xy / u_resolution.xy; vec3 c = tanh(vec3(uv, 0.5) * 3.0); gl_FragColor = vec4(c, 1.0); }');
    const { r } = ok('void main(){ vec2 uv = gl_FragCoord.xy / u_resolution.xy; mat3 m = mat3(0.5); vec3 c = vec3(uv, 1.0) * m; gl_FragColor = vec4(c, 1.0); }');
    expect(r.nodes.some(n => n.type === 'multiply' && n.params.outputType === 'mat3')).toBe(false);
  });
  it('writes more than one component at a time (vec3 through nodes, vec4 through a block)', () => {
    const { r } = ok('void main(){ vec3 col = vec3(0.1); vec2 uv = gl_FragCoord.xy / u_resolution.xy; col.rb = uv; col.xy += 0.2; vec4 o = vec4(col, 1.0); o.g = sqrt(o.g); gl_FragColor = o; }');
    expect(r.nodes.some(n => n.type === 'makeVec3')).toBe(true);
    expect(code(r.nodes)).toMatch(/vec4\(v\.x, x, v\.z, v\.w\)/);
  });
  it('splits `a = x, b += y;` into two statements', () => {
    ok('void main(){ float a = 0.0, b = 1.0; a = 0.5, b += a; gl_FragColor = vec4(vec3(a * b), 1.0); }');
  });
  it('keeps int arithmetic as int: integer division, int() that drops a fraction, int variables in code', () => {
    const { r } = ok('int f(int n, float x) { return n * 2 + int(x); }\nvoid main(){ vec2 uv = gl_FragCoord.xy / u_resolution.xy; int n = int(floor(uv.x * 8.0)); int h = n / 3; float v = float(f(h, uv.y * 4.0)) + float(int(uv.y * 5.0)); gl_FragColor = vec4(vec3(v / 8.0), 1.0); }');
    const all = code(r.nodes);
    expect(all).toMatch(/int h = int\(h_in\)|int n = int\(n_in\)/);
    expect(all).toMatch(/float\(n \/ 3\)/);
    expect(all).toMatch(/float\(int\(/);
  });
});

describe('loops', () => {
  it('a loop kept as code that changes several variables returns them packed', () => {
    const { r } = ok('void main(){ vec2 uv = gl_FragCoord.xy / u_resolution.xy; vec2 z = uv; float m = 0.0; vec3 c = vec3(0.0); for (int i = 0; i < 40; i++) { z = vec2(z.x * z.x - z.y * z.y, 2.0 * z.x * z.y) + uv; m += length(z); c += 0.01; if (m > 10.0) break; } gl_FragColor = vec4(c + m * 0.01 + z.x, 1.0); }');
    const regions = r.nodes.filter(n => n.type === 'customFn');
    expect(regions).toHaveLength(2); // z, m (vec3 packed) and c (vec3)
    expect(String(regions[0].params.body)).toMatch(/return vec3\(z, m\);/);
    expect(r.report.regions[0].why).toMatch(/changes z, m, c/);
  });
  it('an int a loop reads comes in as an int', () => {
    const { r } = ok('void main(){ vec2 uv = gl_FragCoord.xy / u_resolution.xy; int lo = int(floor(uv.x * 4.0)); int hi = lo + 30; float s = 0.0; for (int n = lo; n <= hi; n++) { s += 0.01 * float(n); } gl_FragColor = vec4(vec3(s), 1.0); }');
    expect(String(r.nodes.find(n => n.type === 'customFn')!.params.body)).toMatch(/int lo = int\(lo_in\);/);
  });
  it('counts what the header writes (a golf loop updating its colour there)', () => {
    const { r } = ok('void main(){ vec4 O = vec4(0.0); float l = 1.0; for (float i = 7.0; i > 0.0; O += 0.1 * l) { l -= 0.1; i -= 1.0; } gl_FragColor = O; }');
    expect(r.report.regions[0].why).toMatch(/changes .*O/);
  });
  it('a while loop is kept as code', () => {
    const { r } = ok('void main(){ float x = gl_FragCoord.x; float n = 0.0; while (x > 1.0) { x *= 0.5; n += 1.0; } gl_FragColor = vec4(vec3(n / 10.0), 1.0); }');
    expect(r.report.regions[0].why).toMatch(/while loop/);
  });
  it('reads ++i and a bound held by a constant as a countable loop (a group)', () => {
    const { r } = ok('const int STEPS = 5;\nvoid main(){ float s = 0.0; for (int i = 0; i < STEPS; ++i) { s += 0.1 * float(i); } gl_FragColor = vec4(vec3(s), 1.0); }');
    expect(r.nodes.find(n => n.type === 'group')?.params.iterations).toBe(5);
  });
  it('an int counter in a group reaches code as an int', () => {
    const { r } = ok('void main(){ float s = 0.0; for (int i = 0; i < 4; i++) { s += sin(float(100 * i) + gl_FragCoord.x); } gl_FragColor = vec4(vec3(s), 1.0); }');
    expect(r.nodes.some(n => n.type === 'group')).toBe(true);
  });
});

describe('writes inside an expression', () => {
  it('refuses one a later line reads (the picture would silently differ)', () => {
    const r = glslToGraph('void main(){ vec2 U = gl_FragCoord.xy; float d = length(mod(U += 3.0, 7.0)); float e = U.x; gl_FragColor = vec4(vec3(d + e), 1.0); }');
    expect(r.nodes).toEqual([]);
    expect(r.report.unsupported.join(' ')).toMatch(/U changes inside an expression .* is read afterwards/);
    expect(glslToGraph('void main(){ vec4 h = vec4(0.0); vec4 O = ++h; gl_FragColor = O + h; }').report.unsupported.join(' ')).toMatch(/h changes inside an expression/);
  });
  it('allows one nothing reads afterwards (the block holds the whole story)', () => {
    ok('void main(){ vec2 U = gl_FragCoord.xy; float d = length(mod(U += 3.0, 7.0)); U = vec2(1.0); gl_FragColor = vec4(vec3(d + U.x), 1.0); }');
    // In a loop: written before it's read, each time round.
    ok('void main(){ float v = 0.0, a = 0.0, A; for (int i = 0; i < 3; i++) v = max(v, cos(A = a + gl_FragCoord.x) * sin(A)), a += 1.0; gl_FragColor = vec4(vec3(v), 1.0); }');
  });
});
