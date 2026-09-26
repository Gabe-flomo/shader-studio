import { describe, it, expect } from 'vitest';
import { discoverInSource, discoverFunctions, bundleText, toCustomFnPreset } from '../discover';

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
});
