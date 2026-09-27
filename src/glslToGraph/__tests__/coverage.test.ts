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
  it('writes more than one component at a time (vec3 and vec4 through Split and Make)', () => {
    const { r } = ok('void main(){ vec3 col = vec3(0.1); vec2 uv = gl_FragCoord.xy / u_resolution.xy; col.rb = uv; col.xy += 0.2; vec4 o = vec4(col, 1.0); o.g = sqrt(o.g); gl_FragColor = o; }');
    expect(r.nodes.some(n => n.type === 'makeVec3')).toBe(true);
    expect(r.nodes.filter(n => n.type === 'makeVec4')).toHaveLength(2);
    expect(r.report.blocks).toEqual([]);
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

describe('phase 2: what used to be kept as code', () => {
  const types = (nodes: GraphNode[]) => nodes.map(n => n.type);
  it('vec4 arithmetic, vec4 constructors of every shape, and a final colour with its own alpha are nodes', () => {
    const { r } = ok('void main(){ vec2 u = gl_FragCoord.xy / u_resolution.xy; vec4 a = vec4(u, u.yx) * 2.0 + vec4(0.5); vec4 b = vec4(u.x, vec3(0.2, u)) - a / vec4(1.0, 2.0, 3.0, 4.0); gl_FragColor = vec4(b.rgb, u.y); }');
    expect(r.report.blocks).toEqual([]);
    expect(r.nodes.some(n => n.type === 'add' && n.params.outputType === 'vec4')).toBe(true);
    expect(types(r.nodes)).toContain('makeVec4');
    expect(types(r.nodes)).toContain('vec4Output');
  });
  it('abs, ceil, tanh, min, max, pow and step work on vectors; length, dot and normalize on any vector', () => {
    const { r } = ok('void main(){ vec2 u = gl_FragCoord.xy / u_resolution.xy - 0.5; vec3 p = vec3(u, 0.3); vec3 q = abs(p) + ceil(p * 2.0) + tanh(p) + min(p, 0.2) + max(p, vec3(0.1)) + pow(abs(p), vec3(1.5)) + step(0.1, p); float d = length(p) + dot(p, q) + normalize(q).x + length(vec4(p, 1.0)); gl_FragColor = vec4(q * d, 1.0); }');
    expect(r.report.blocks).toEqual([]);
    expect(r.nodes.find(n => n.type === 'abs')!.params.outputType).toBe('vec3');
    expect(r.nodes.find(n => n.type === 'pow')!.inputs.exponent.type).toBe('vec3');
    expect(r.nodes.filter(n => n.type === 'length').map(n => n.params.outputType).sort()).toEqual(['vec3', 'vec4']);
    expect(r.nodes.find(n => n.type === 'dot')!.inputs.a.type).toBe('vec3');
  });
  it('a swizzle of any pattern is a Swizzle node', () => {
    const { r } = ok('void main(){ vec2 u = gl_FragCoord.xy / u_resolution.xy; vec4 w = vec4(u, 0.2, 0.9); vec3 c = u.xyx + w.zwx + w.bgr; gl_FragColor = vec4(c, 1.0).zwxy; }');
    expect(r.report.blocks).toEqual([]);
    expect(r.nodes.filter(n => n.type === 'swizzle').map(n => n.params.pattern).sort()).toEqual(['xyx', 'zwxy', 'zwx', 'zyx'].sort());
  });
  it('mat2(c, -s, s, c) * v, v * mat2(…), a mat2 variable and a rot() helper are Rotate 2D nodes', () => {
    const { r } = ok('mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }\nvoid main(){ vec2 u = gl_FragCoord.xy / u_resolution.xy - 0.5; float a = u_time; u = mat2(cos(a), -sin(a), sin(a), cos(a)) * u; mat2 m = mat2(cos(a), sin(a), -sin(a), cos(a)); u = u * m; u *= rot(0.3); gl_FragColor = vec4(u, 0.0, 1.0); }');
    expect(r.nodes.filter(n => n.type === 'rotate2d')).toHaveLength(3);
    expect(r.report.blocks).toEqual([]);
    expect(r.report.regions).toEqual([]);
    // m * v with mat2(c, -s, s, c) turns by -a, v * m with mat2(c, s, -s, c) by -a, v * rot(t) by +t.
    expect(r.nodes.filter(n => n.type === 'negate')).toHaveLength(2);
    expect(r.nodes.find(n => n.type === 'rotate2d' && n.params.angle === 0.3)).toBeTruthy();
  });
  it('a matrix that is not a rotation stays code', () => {
    const { r } = ok('void main(){ vec2 u = gl_FragCoord.xy / u_resolution.xy; float a = u_time; u = mat2(cos(a), sin(a), sin(a), cos(a)) * u; gl_FragColor = vec4(u, 0.0, 1.0); }');
    expect(r.nodes.some(n => n.type === 'rotate2d')).toBe(false);
    expect(r.report.blocks.length).toBeGreaterThan(0);
  });
});

describe('discard', () => {
  it('`if (c) discard;` multiplies the colour by 0 there, through an RGBA Output', () => {
    const { r } = ok('void main(){ vec2 u = gl_FragCoord.xy / u_resolution.xy; if (u.x > 0.5) discard; gl_FragColor = vec4(u, 0.0, 1.0); }');
    const out = r.nodes.find(n => n.type === 'vec4Output')!;
    const mul = r.nodes.find(n => n.id === out.inputs.color.connection!.nodeId)!;
    expect(mul.type).toBe('multiply');
    const keep = r.nodes.find(n => n.id === mul.inputs.b.connection!.nodeId)!;
    expect(String(keep.params.expr)).toMatch(/\? thenV : elseV/);
    expect(r.report.notes.join(' ')).toMatch(/discard/);
  });
  it('a discard in no branch at all makes every pixel transparent black', () => {
    const { r } = ok('void main(){ discard; gl_FragColor = vec4(1.0); }');
    expect(r.nodes.find(n => n.type === 'multiply')!.params.b).toBe(0);
  });
});

describe('uniforms no node stands for', () => {
  it('become live Constants entries and Play controls, with defaults from their names', () => {
    const { r } = ok('uniform float u_speed; uniform float amount0; uniform float shift; uniform int steps; uniform vec2 offset; uniform vec3 tint;\nvoid main(){ vec2 u = gl_FragCoord.xy / u_resolution.xy + offset; float v = sin(u.x * float(steps) + u_time * u_speed + shift) * amount0; gl_FragColor = vec4(tint * v, 1.0); }');
    const card = r.nodes.find(n => n.type === 'constants')!;
    const items = card.params.items as Array<{ key: string; type: string; value: unknown; slider: boolean }>;
    expect(items.every(i => i.slider)).toBe(true);
    expect(Object.fromEntries(items.map(i => [i.key, [i.type, i.value]]))).toEqual({ u_speed: ['float', 1], amount0: ['float', 1], shift: ['float', 0], steps: ['float', 4], offset: ['vec2', [0, 0]], tint: ['color', [0.5, 0.5, 0.5]] });
    expect(r.report.uniforms!.map(u => u.name)).toEqual(['u_speed', 'amount0', 'shift', 'steps', 'offset', 'tint']);
    expect(r.controls!.map(c => c.target)).toEqual(['u_speed', 'amount0', 'shift', 'steps', 'offset_x', 'offset_y', 'tint'].map(k => `${card.id}::${k}`));
    expect(r.controls!.find(c => c.label === 'tint')!.kind).toBe('color');
  });
  it('one a helper function reads is still refused, with the reason the fix-up is offered for', () => {
    const r = glslToGraph('uniform float k;\nfloat f(float x) { return x * k; }\nvoid main(){ gl_FragColor = vec4(vec3(f(gl_FragCoord.x)), 1.0); }');
    expect(r.report.unsupported.join(' ')).toMatch(/read inside f\(\), which can’t reach a Play control/);
  });
});
