/**
 * The code-block preview's harness: what a snippet is (functions, body,
 * both, a whole shader), what it can show and how (plot or field), which
 * numbers become sliders, which names it reads are given or filled in, and
 * the wrapper it gets, with errors mapped back to the snippet's lines.
 */
import { describe, expect, it } from 'vitest';
import { analyzeSnippet, buildHarness, contextFromShader, mapErrors, sliderRange } from '../snippetHarness';

describe('analyzeSnippet: plot or field', () => {
  it('a float function of x is plotted', () => {
    const a = analyzeSnippet('float f(float x) {\n  return x * x;\n}');
    expect(a.kind).toBe('functions');
    expect(a.options.map(o => o.id)).toEqual(['fn:f']);
    expect(a.options[0]).toMatchObject({ type: 'float', plottable: true });
    expect(a.defaultShow).toBe('fn:f');
    expect(a.defaultMode).toBe('plot');
  });

  it('f(x, t) is plotted and animates; t gets the time', () => {
    const a = analyzeSnippet('float f(float x, float t) { return sin(x * 6.0 + t); }');
    expect(a.defaultMode).toBe('plot');
    const h = buildHarness('float f(float x, float t) { return sin(x * 6.0 + t); }');
    expect(h.source).toContain('f(x, u_time)');
    expect(h.sliders).toEqual([]);
  });

  it('a function returning a colour or a vec2 is a field', () => {
    const a = analyzeSnippet('vec3 palette(float t) { return 0.5 + 0.5 * cos(6.2831 * (t + vec3(0.0, 0.33, 0.67))); }');
    expect(a.options[0]).toMatchObject({ id: 'fn:palette', type: 'vec3', plottable: false });
    expect(a.defaultMode).toBe('field');
    const w = analyzeSnippet('vec2 warp(vec2 p) { return p + 0.1 * sin(p.yx * 4.0); }');
    expect(w.options[0]).toMatchObject({ type: 'vec2', plottable: false });
    expect(w.defaultMode).toBe('field');
  });

  it('a float of a position (an SDF) is a field, not a plot', () => {
    const a = analyzeSnippet('float circle(vec2 p, float r) { return length(p) - r; }');
    expect(a.options[0]).toMatchObject({ type: 'float', plottable: false });
    expect(a.defaultMode).toBe('field');
    const h = buildHarness('float circle(vec2 p, float r) { return length(p) - r; }');
    // The position gets uv; the radius is a slider.
    expect(h.source).toContain('circle(uv, _pf_circle_r)');
    expect(h.sliders.map(s => [s.label, s.kind])).toEqual([['r', 'param']]);
  });

  it('a body snippet shows its colour variable, or gl_FragColor when it writes it', () => {
    const body = 'float d = length(uv) - 0.3;\nvec3 col = vec3(smoothstep(0.01, 0.0, d));';
    const a = analyzeSnippet(body);
    expect(a.kind).toBe('body');
    expect(a.vars.map(v => `${v.type} ${v.name}`)).toEqual(['float d', 'vec3 col']);
    expect(a.options.map(o => o.id)).toEqual(['var:d', 'var:col']);
    expect(a.defaultShow).toBe('var:col');
    expect(a.provided.map(p => p.name)).toEqual(['uv']);
    const frag = analyzeSnippet('vec2 st = gl_FragCoord.xy / u_resolution;\ngl_FragColor = vec4(st, 0.0, 1.0);');
    expect(frag.defaultShow).toBe('frag');
  });

  it('a Book of Shaders line that reads x is plotted', () => {
    const a = analyzeSnippet('float y = smoothstep(0.1, 0.9, x);');
    expect(a.defaultShow).toBe('var:y');
    expect(a.defaultMode).toBe('plot');
  });

  it('variables inside loops and ifs are not offered', () => {
    const a = analyzeSnippet('float acc = 0.0;\nfor (int i = 0; i < 4; i++) {\n  float w = float(i);\n  acc += w;\n}');
    expect(a.vars.map(v => v.name)).toEqual(['acc']);
  });

  it('helpers and the body together: both kinds of option, the body first to show', () => {
    const code = 'float circleSDF(vec2 p, float r) { return length(p) - r; }\nfloat n_dist = circleSDF(g_uv, 0.3);';
    const a = analyzeSnippet(code);
    expect(a.kind).toBe('mixed');
    expect(a.options.map(o => o.id)).toEqual(['fn:circleSDF', 'var:n_dist']);
    expect(a.defaultShow).toBe('var:n_dist');
  });

  it('a whole shader shows its own colour, including Shadertoy’s mainImage', () => {
    const a = analyzeSnippet('precision mediump float;\nuniform float u_time;\nvoid main() { gl_FragColor = vec4(1.0); }');
    expect(a.kind).toBe('shader');
    expect(a.options.map(o => o.id)).toEqual(['frag']);
    const h = buildHarness('void main() { gl_FragColor = vec4(1.0); }');
    expect(h.source).toContain('void _pf_main(');
    expect(h.source).toContain('_pf_main();');
    const st = buildHarness('void mainImage(out vec4 c, in vec2 f) { c = vec4(f / iResolution.xy, 0.5 + 0.5 * sin(iTime), 1.0); }');
    expect(st.source).toContain('#define iTime u_time');
    expect(st.source).toContain('#define iResolution vec3(u_resolution, 1.0)');
    expect(st.source).toContain('mainImage(_pf_c, gl_FragCoord.xy);');
  });

  it('an empty snippet has nothing to show', () => {
    expect(analyzeSnippet('  \n').kind).toBe('empty');
  });
});

describe('sliders', () => {
  it('uniforms, float consts, float #defines and a function’s top-level floats become sliders', () => {
    const code = [
      'uniform float u_freq;',
      'const float AMP = 0.25;',
      '#define SPEED 2.0',
      'float bias = 0.1;',
      'float wave(float x) { return AMP * sin(x * u_freq + u_time * SPEED) + bias; }',
    ].join('\n');
    const a = analyzeSnippet(code, { uniforms: { u_freq: 8 } });
    expect(a.sliders.map(s => [s.uniform, s.kind, s.value])).toEqual([
      ['u_freq', 'uniform', 8], ['AMP', 'const', 0.25], ['SPEED', 'define', 2], ['bias', 'global', 0.1],
    ]);
    const h = buildHarness(code, {}, { uniforms: { u_freq: 8 } });
    expect(h.source).toContain('uniform float AMP;');
    expect(h.source).not.toContain('const float AMP');
    expect(h.source).not.toMatch(/#define SPEED/);
    expect(h.uniforms).toMatchObject({ u_freq: 8, AMP: 0.25, SPEED: 2, bias: 0.1 });
  });

  it('constants a loop or another constant needs stay constant', () => {
    const code = 'const float STEPS = 32.0;\nconst float HALF = STEPS * 0.5;\n#define N 5\nfloat f(float x) { float s = 0.0; for (float i = 0.0; i < STEPS; i++) s += x; return s / HALF; }';
    expect(analyzeSnippet(code).sliders).toEqual([]);
  });

  it('PI and the like are never sliders', () => {
    expect(analyzeSnippet('#define PI 3.14159\nconst float TAU = 6.28318;\nfloat f(float x) { return sin(x * PI) + TAU; }').sliders).toEqual([]);
  });

  it('names nothing declares become sliders, with the source’s value when it has one', () => {
    const a = analyzeSnippet('float d = length(uv) - radius;', { uniforms: { radius: 0.4 } });
    expect(a.sliders).toEqual([expect.objectContaining({ uniform: 'radius', kind: 'free', value: 0.4 })]);
  });

  it('ranges put the value somewhere sensible', () => {
    expect(sliderRange(0)).toEqual([-1, 1]);
    expect(sliderRange(0.3)).toEqual([0, 1]);
    expect(sliderRange(8)).toEqual([0, 16]);
    expect(sliderRange(-0.5)).toEqual([-1, 1]);
    expect(sliderRange(-4)).toEqual([-8, 8]);
  });
});

describe('the harness', () => {
  it('declares the names a body reads (and only those), and keeps a body’s own uv', () => {
    const h = buildHarness('float d = length(st - 0.5);');
    expect(h.source).toContain('vec2 st = _q;');
    expect(h.source).not.toContain('float t = u_time;');
    const own = buildHarness('vec2 uv = gl_FragCoord.xy / u_resolution;\nfloat v = uv.x;');
    // Its own uv sits in a block of its own, shadowing the harness's.
    expect(own.source).toMatch(/\{\n\s*vec2 uv = gl_FragCoord/);
  });

  it('drops what the harness declares itself', () => {
    const h = buildHarness('#version 100\nprecision mediump float;\nuniform vec2 u_resolution;\nuniform float u_time;\nvarying vec2 vUv;\nvoid main() { gl_FragColor = vec4(vUv, 0.0, 1.0); }');
    expect(h.source.match(/uniform vec2 u_resolution;/g)).toHaveLength(1);
    expect(h.source.match(/varying vec2 vUv;/g)).toHaveLength(1);
    expect(h.source).not.toContain('#version');
  });

  it('brings in the app’s helpers a snippet calls without defining (and what they call)', () => {
    const a = analyzeSnippet('float n = valueNoise(uv * 8.0);');
    expect(a.borrowed).toEqual(expect.arrayContaining(['valueNoise', 'noiseHash1']));
    const h = buildHarness('float n = valueNoise(uv * 8.0);');
    expect(h.source).toContain('float valueNoise(vec2 p)');
    expect(h.source).toContain('float noiseHash1(vec2 p)');
    expect(h.source).not.toContain('vec2 noiseHash2');
    // A snippet that defines its own copy keeps it.
    const own = buildHarness('float valueNoise(vec2 p) { return 0.5; }\nfloat n = valueNoise(uv);');
    expect(own.source.match(/float valueNoise\(vec2 p\)/g)).toHaveLength(1);
  });

  it('borrows from the source shader and fills in its other variables by type', () => {
    const shader = 'uniform float u_p_n1_radius;\nfloat circleSDF(vec2 point, float size) { return length(point) - size; }\nvoid main() {\n  vec2 n0_uv = g_uv * 2.0;\n  float n1_dist = circleSDF(n0_uv, u_p_n1_radius);\n  vec3 n2_col = vec3(n1_dist);\n}';
    const ctx = contextFromShader(shader, { u_p_n1_radius: 0.3 });
    const slice = 'float n1_dist = circleSDF(n0_uv, u_p_n1_radius);';
    const a = analyzeSnippet(slice, ctx);
    expect(a.borrowed).toEqual(['circleSDF']);
    expect(a.filled).toEqual([{ name: 'n0_uv', type: 'vec2', as: 'the position', expr: 'uv' }]);
    expect(a.sliders).toEqual([expect.objectContaining({ uniform: 'u_p_n1_radius', value: 0.3 })]);
    const h = buildHarness(slice, {}, ctx);
    expect(h.source).toContain('vec2 n0_uv = uv;');
    expect(h.source).toContain('float circleSDF(vec2 point, float size)');
  });

  it('a name the lines write to, or hand to a function, is a variable, not a slider', () => {
    const ctx = contextFromShader('float acc_0 = 0.0;\nvoid march(inout float g) { g += 1.0; }\nvoid main() { march(acc_0); }');
    const a = analyzeSnippet('acc_0 += 0.5;\nfloat v = acc_0;', ctx);
    expect(a.sliders).toEqual([]);
    expect(a.filled).toEqual([expect.objectContaining({ name: 'acc_0', type: 'float', expr: '0.0' })]);
    const b = analyzeSnippet('march(acc_0);\nfloat v = acc_0;', ctx);
    expect(b.sliders).toEqual([]);
  });

  it('a variable named for the time runs with the clock; a colour stands in as a colour', () => {
    const ctx = contextFromShader('void main() { float time_0_time = u_time; vec3 tint_col = vec3(1.0); }');
    const a = analyzeSnippet('vec3 c = tint_col * sin(time_0_time);', ctx);
    expect(a.filled).toEqual([
      expect.objectContaining({ name: 'tint_col', expr: 'vec3(0.95, 0.55, 0.2)' }),
      expect.objectContaining({ name: 'time_0_time', expr: 'u_time' }),
    ]);
    expect(a.usesTime).toBe(true);
  });

  it('what a borrowed function reads comes too: its #defines, and the shader’s uniforms with their values', () => {
    const shader = '#define STEPS 4\nuniform vec2 u_size;\nuniform float u_gain;\nfloat f(vec2 p) { float s = 0.0; for (int i = 0; i < STEPS; i++) s += length(p * u_size) * u_gain; return s; }\nvoid main() {}';
    const ctx = contextFromShader(shader, { u_size: [2, 3], u_gain: 0.25 });
    const h = buildHarness('float d = f(uv);', {}, ctx);
    expect(h.source).toContain('#define STEPS 4');
    expect(h.source).toContain('uniform vec2 u_size;');
    expect(h.uniforms).toMatchObject({ u_size: [2, 3], u_gain: 0.25 });
    expect(h.sliders.map(s => s.uniform)).toEqual(['u_gain']);
  });

  it('a function whose name starts with an underscore gets slider names GLSL allows', () => {
    const h = buildHarness('float _shape(vec2 p, float k) { return length(p) * k; }');
    expect(h.source).not.toMatch(/__/);
  });

  it('plots with the range as a uniform; draws a vec2 as a grid or arrows', () => {
    const h = buildHarness('float f(float x) { return x; }', { range: { x: [-1, 2], y: [0, 3] } });
    expect(h.mode).toBe('plot');
    expect(h.uniforms.u_pf_range).toEqual([-1, 2, 0, 3]);
    expect(h.source).toContain('dFdx(e)');
    const g = buildHarness('vec2 w(vec2 p) { return p * 2.0; }', { view: 'grid' });
    expect(g.source).toContain('fract(w - 0.5)');
    const arrows = buildHarness('vec2 w(vec2 p) { return p * 2.0; }', { view: 'arrows' });
    // Each arrow evaluates the snippet at its cell's centre.
    expect(arrows.source).toContain('_pf_eval(cell / cells)');
  });

  it('a plot asked of something that can’t be plotted falls back to a field', () => {
    expect(buildHarness('vec3 c(vec2 p) { return vec3(p, 0.0); }', { mode: 'plot' }).mode).toBe('field');
    expect(buildHarness('float d = length(uv);', { mode: 'plot' }).mode).toBe('plot');
  });

  it('shows the chosen variable', () => {
    const h = buildHarness('float d = length(uv);\nvec3 col = vec3(d);', { show: 'var:d' });
    expect(h.show?.id).toBe('var:d');
    expect(h.source).toContain('return vec4(d, 0.0, 0.0, 1.0);');
  });

  it('maps compile errors back to the snippet’s lines', () => {
    const code = 'float d = length(uv);\nvec3 col = vec3(nope);';
    const h = buildHarness(code);
    const line = h.source.split('\n').findIndex(l => l.includes('vec3(nope)')) + 1;
    const errs = mapErrors(`ERROR: 0:${line}: 'nope' : undeclared identifier\nERROR: 0:1: '' : compilation terminated`, h.lineMap);
    expect(errs[0]).toEqual({ line: 2, message: "'nope' : undeclared identifier" });
    expect(errs[1].line).toBe(0);
  });
});
