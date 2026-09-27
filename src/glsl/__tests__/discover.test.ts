import { describe, it, expect } from 'vitest';
import { discoverInSource, discoverFunctions, bundleText, toCustomFnPreset } from '../discover';

const corpus = import.meta.glob('../../glslToGraph/__tests__/corpus/user/*.glsl', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const user = (name: string) => corpus[`../../glslToGraph/__tests__/corpus/user/${name}.glsl`];

const SRC = `#define PI 3.14159
#define TAU (2.0 * PI)
#define SQ(x) ((x)*(x))
uniform float u_time;
uniform sampler2D tex;
float time;
const float K = 2.0;

// float commented(vec2 p) { return 0.0; }
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9, 78.2))) * 43758.5); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  float a = hash(i), b = hash(i + vec2(1.0, 0.0)); /* braces { } in a comment */
  return mix(a, b, f.x);
}
float fbm(vec2 p) { float v = 0.0; for (int k = 0; k < 4; k++) { v += noise(p) * 0.5; p *= 2.0; } return v; }
vec3 palette(float t) { return 0.5 + 0.5 * cos(TAU * (vec3(t) + vec3(0.0, 0.33, 0.67))); }
vec2 rot(vec2 p, float a) { return mat2(cos(a), -sin(a), sin(a), cos(a)) * p; }
vec2 rot(vec2 p) { return rot(p, time); }
float wobble(vec2 p) { return sin(p.x + u_time) * K; }
vec4 sampleIt(vec2 uv) { return texture2D(tex, uv); }
void split(vec2 p, out float a, out float b) { a = p.x; b = p.y; }
float rec(float x) { return x > 1.0 ? rec(x * 0.5) : x; }
void main() { gl_FragColor = vec4(palette(fbm(gl_FragCoord.xy))), 1.0); }
`;

describe('function discovery', () => {
  const fns = discoverInSource({ id: 's', name: 'Test', code: SRC });
  const by = (n: string, i = 0) => fns.filter(f => f.name === n)[i];

  it('finds every definition, skipping comments and prototypes, with lines', () => {
    expect(fns.map(f => f.name)).toEqual(['hash', 'noise', 'fbm', 'palette', 'rot', 'rot', 'wobble', 'sampleIt', 'split', 'rec', 'main']);
    expect(by('hash').startLine).toBe(10);
    expect(by('noise').startLine).toBe(11);
    expect(by('noise').endLine).toBe(15);
    expect(by('noise').text.startsWith('float noise(vec2 p) {')).toBe(true);
    expect(by('noise').text.endsWith('}')).toBe(true);
  });

  it('works out calls, levels and dependency closures in file order', () => {
    expect(by('hash').level).toBe(0);
    expect(by('noise').level).toBe(1);
    expect(by('noise').calls).toEqual(['hash']);
    expect(by('fbm').level).toBe(2);
    expect(by('fbm').dependencies.map(d => d.name)).toEqual(['hash', 'noise']);
    expect(by('rec').level).toBe(-1);
  });

  it('marks functions that read the file’s globals, but not the Studio uniforms or const globals', () => {
    expect(by('wobble').globals).toEqual([]);
    expect(by('wobble').selfContained).toBe(true);
    expect(by('rot', 1).globals).toEqual(['time']);
    expect(by('rot', 1).selfContained).toBe(false);
    expect(by('sampleIt').globals).toEqual(['tex']);
  });

  it('collects the #defines a function (or its dependency) uses, not function-like macros', () => {
    expect(by('palette').defines).toEqual(['#define PI 3.14159', '#define TAU (2.0 * PI)']);
    expect(bundleText(by('palette')).startsWith('#define PI 3.14159\n\n#define TAU (2.0 * PI)\n\nvec3 palette')).toBe(true);
    expect(by('hash').defines).toEqual([]);
  });

  it('signature keeps out qualifiers and reads params with qualifiers and precision', () => {
    expect(by('split').signature).toBe('void split(vec2 p, out float a, out float b)');
    const f = discoverInSource({ id: 'q', name: 'Q', code: 'float f(const in highp vec2 p, mediump float k) { return p.x * k; }' })[0];
    expect(f.params).toEqual([{ type: 'vec2', name: 'p', qualifier: 'in' }, { type: 'float', name: 'k', qualifier: 'in' }]);
  });

  it('filters by level, return type, parameter count and types, and drops main', () => {
    const r0 = discoverFunctions([{ id: 's', name: 'Test', code: SRC }], { maxLevel: 0 });
    expect(r0.matches.map(f => f.name)).toEqual(['hash', 'palette', 'rot', 'wobble', 'split']);
    const r1 = discoverFunctions([{ id: 's', name: 'Test', code: SRC }], { maxLevel: 1, returnTypes: ['float'] });
    expect(r1.matches.map(f => f.name)).toEqual(['hash', 'noise', 'wobble']);
    const r2 = discoverFunctions([{ id: 's', name: 'Test', code: SRC }], { paramTypes: ['vec2'], maxParams: 1 });
    expect(r2.matches.map(f => f.name)).toEqual(['hash', 'noise', 'fbm', 'wobble']);
    const r3 = discoverFunctions([{ id: 's', name: 'Test', code: SRC }], { allowGlobals: true, nameContains: 'rot' });
    expect(r3.matches.map(f => f.name)).toEqual(['rot', 'rot']);
    expect(r3.total).toBe(11);
  });

  it('drops byte-identical repeats across shaders and counts them', () => {
    const a = { id: 'a', name: 'A', code: 'float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9, 78.2))) * 43758.5); }' };
    const b = { id: 'b', name: 'B', code: 'float hash(vec2 p) {\n  return fract(sin(dot(p, vec2(12.9, 78.2))) * 43758.5);\n}\nfloat other(float x) { return x; }' };
    const r = discoverFunctions([a, b]);
    expect(r.matches.map(f => `${f.sourceId}:${f.name}`)).toEqual(['a:hash', 'b:other']);
    expect(r.duplicates.get('hash')).toBe(1);
  });

  it('turns a function into a Custom Function preset, with its dependencies as helpers', () => {
    const p = toCustomFnPreset(by('fbm'), 'FBM', 'from Test');
    expect(p.ok).toBe(true);
    if (p.ok) {
      expect(p.data.inputs).toEqual([{ name: 'p', type: 'vec2', slider: null }]);
      expect(p.data.outputType).toBe('float');
      expect(p.data.body).toBe('fbm(p)');
      expect(p.data.glslFunctions).toContain('float hash(vec2 p)');
      expect(p.data.glslFunctions.indexOf('float noise')).toBeLessThan(p.data.glslFunctions.indexOf('float fbm'));
    }
    expect(toCustomFnPreset(by('split')).ok).toBe(false);
    expect(toCustomFnPreset(by('sampleIt')).ok).toBe(false);
  });

  it('carries the const globals a function (or a dependency, or another const) uses, in file order', () => {
    expect(by('wobble').consts).toEqual(['const float K = 2.0;']);
    expect(by('hash').consts).toEqual([]);
    const code = `const float A = 1.0, B = 2.0;
const vec2 OFF = vec2(A, 0.0);
const float UNUSED = 9.0;
#define S (C * 2.0)
const float C = 3.0;
float f(vec2 p) { return p.x + OFF.y; }
float g(vec2 p) { return f(p) * S; }
float h(float B) { return B; }`;
    const fs = discoverInSource({ id: 'c', name: 'C', code });
    const [f, g, h] = fs;
    expect(f.consts).toEqual(['const float A = 1.0, B = 2.0;', 'const vec2 OFF = vec2(A, 0.0);']);
    expect(g.consts).toEqual(['const float A = 1.0, B = 2.0;', 'const vec2 OFF = vec2(A, 0.0);', 'const float C = 3.0;']);
    expect(g.selfContained).toBe(true);
    expect(bundleText(g)).toBe(['#define S (C * 2.0)', 'const float A = 1.0, B = 2.0;', 'const vec2 OFF = vec2(A, 0.0);', 'const float C = 3.0;', f.text, g.text].join('\n\n'));
    expect(h.consts).toEqual([]); // B is its parameter
  });

  it('bundles simplex3d with F3 and G3, and noise3d with its rotation matrices (haltone nose)', () => {
    const code = user('haltone nose');
    const all = discoverInSource({ id: 'h', name: 'haltone nose', code });
    const simplex = all.find(f => f.name === 'simplex3d')!;
    expect(simplex.consts.map(c => c.match(/const \w+ (\w+)/)![1])).toEqual(['F3', 'G3']);
    expect(simplex.selfContained).toBe(true);
    const noise = all.find(f => f.name === 'noise3d')!;
    expect(noise.consts.map(c => c.match(/const \w+ (\w+)/)![1])).toEqual(['F3', 'G3', 'rot1', 'rot2']);
    const p = toCustomFnPreset(noise);
    expect(p.ok).toBe(true);
    if (p.ok) {
      const t = p.data.glslFunctions;
      expect(t.indexOf('const float F3')).toBeLessThan(t.indexOf('const float G3'));
      expect(t.indexOf('const mat3 rot2')).toBeLessThan(t.indexOf('vec3 random3'));
      expect(t.indexOf('vec3 random3')).toBeLessThan(t.indexOf('float simplex3d'));
    }
  });

  it('translates undeclared Shadertoy uniforms to the Studio names in the bundle (dipole magnet)', () => {
    const code = user('dipole magnet');
    const field = discoverInSource({ id: 'd', name: 'dipole magnet', code }).find(f => f.name === 'magneticField')!;
    expect(field.shadertoy).toEqual(['iTime']);
    expect(field.selfContained).toBe(true);
    const p = toCustomFnPreset(field);
    expect(p.ok).toBe(true);
    if (p.ok) {
      expect(p.data.glslFunctions).not.toMatch(/\biTime\b/);
      expect(p.data.glslFunctions).toContain('u_time * 0.5');
    }
    expect(field.text).toContain('iTime'); // the source text itself is untouched
  });

  it('rewrites each Shadertoy uniform, through dependencies and defines; textures and declared ones stay globals', () => {
    const code = `#define T iTime
float a(vec2 p) { return p.x / iResolution.x + iResolution.y + T; }
vec2 b(vec2 p) { return p + iMouse.xy + iResolution.xy + vec2(float(iFrame)); }
float c(vec2 p) { return a(p) + b(p).x; }
vec4 tex(vec2 uv) { return texture(iChannel0, uv); }`;
    const [a, b, c, tex] = discoverInSource({ id: 's', name: 'S', code });
    expect(a.shadertoy).toEqual(['iResolution', 'iTime']);
    expect(bundleText(a)).toBe('#define T u_time\n\nfloat a(vec2 p) { return p.x / u_resolution.x + u_resolution.y + T; }');
    expect(bundleText(b)).toBe('vec2 b(vec2 p) { return p + u_mouse + u_resolution + vec2(float(int(u_time * 60.0))); }');
    expect(c.shadertoy).toEqual(['iFrame', 'iMouse', 'iResolution', 'iTime']);
    expect(bundleText(c)).not.toMatch(/\bi[A-Z]/);
    expect(tex.globals).toEqual(['iChannel0']);
    expect(tex.selfContained).toBe(false);
    const declared = discoverInSource({ id: 'u', name: 'U', code: 'uniform float iTime;\nfloat w(float x) { return x * iTime; }' })[0];
    expect(declared.globals).toEqual(['iTime']);
    expect(declared.shadertoy).toEqual([]);
  });
});
