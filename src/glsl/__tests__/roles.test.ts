import { describe, it, expect } from 'vitest';
import { discoverInSource } from '../discover';
import { inferParamRoles, inferReturnRole } from '../roles';
import { previewShaderFor, defaultBinding } from '../previewShader';

const SRC = `#define TAU 6.2831
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9, 78.2))) * 43758.5); }
float noise(vec2 p) { vec2 i = floor(p), f = fract(p); return mix(hash(i), hash(i + 1.0), f.x); }
vec3 palette(float t) { return 0.5 + 0.5 * cos(TAU * (vec3(t) + vec3(0.0, 0.33, 0.67))); }
vec2 rot(vec2 p, float a) { return mat2(cos(a), -sin(a), sin(a), cos(a)) * p; }
float sdCircle(vec2 p, float r) { return length(p) - r; }
float glow(float d, float k) { return exp(-d * k); }
void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution.xy;
  float n = noise(uv * 4.0);
  vec2 q = rot(uv, u_time);
  float d = sdCircle(q, 0.3);
  vec3 col = palette(n + u_time * 0.1) * glow(d, 8.0);
  gl_FragColor = vec4(col, 1.0);
}`;
const fns = discoverInSource({ id: 's', name: 'S', code: SRC });
const by = (n: string) => fns.find(f => f.name === n)!;

describe('call sites', () => {
  it('records where the file calls a function, with the arguments and the enclosing function', () => {
    const n = by('noise');
    expect(n.callSites).toHaveLength(1);
    expect(n.callSites[0]).toMatchObject({ line: 10, inFn: 'main', args: ['uv * 4.0'] });
    expect(n.callSites[0].text).toBe('float n = noise(uv * 4.0);');
    expect(by('hash').callSites.map(c => c.inFn)).toEqual(['noise', 'noise']);
    expect(by('rot').callSites[0].args).toEqual(['uv', 'u_time']);
  });
});

describe('value roles', () => {
  it('reads positions, time, angles, distances and amounts from names, use and call sites', () => {
    expect(inferParamRoles(by('noise'))[0]).toMatchObject({ name: 'p', role: 'position' });
    const r = inferParamRoles(by('rot'));
    expect(r[0].role).toBe('position');
    expect(r[1].role).toBe('angle');
    expect(r[1].because.join(' ')).toMatch(/named a|cos\(a\)|called with u_time/);
    const c = inferParamRoles(by('sdCircle'));
    expect(c[0].role).toBe('position');
    expect(c[1].role).toBe('scale');
    const g = inferParamRoles(by('glow'));
    expect(g[0].role).toBe('distance');
    expect(g[1].role).toBe('scale');
    expect(inferParamRoles(by('palette'))[0].role).toBe('time');
  });
  it('reads what a function returns', () => {
    expect(inferReturnRole(by('sdCircle')).role).toBe('distance');
    expect(inferReturnRole(by('palette')).role).toBe('colour');
    expect(inferReturnRole(by('rot')).role).toBe('position');
    expect(inferReturnRole(by('noise')).role).toBe('scalar');
  });
});

describe('preview shader', () => {
  it('feeds each parameter from its role and paints by the return role', () => {
    const fn = by('sdCircle');
    const roles = inferParamRoles(fn), ret = inferReturnRole(fn);
    const b = roles.map(defaultBinding);
    expect(b.map(x => x.kind)).toEqual(['uv', 'const']);
    const r = previewShaderFor(fn, roles, ret, b);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.source).toContain('float pv_v = sdCircle(pv_uv, 1.0);');
      expect(r.source).toContain('vec3(1.0, 0.6, 0.25)'); // the signed-field paint
      expect(r.source.indexOf('float sdCircle')).toBeLessThan(r.source.indexOf('void main'));
    }
    const pal = by('palette');
    const pr = previewShaderFor(pal, inferParamRoles(pal), inferReturnRole(pal), inferParamRoles(pal).map(defaultBinding));
    if (pr.ok) { expect(pr.source).toContain('palette(u_time)'); expect(pr.source).toContain('#define TAU'); }
  });
  it('refuses what it can’t run and says why', () => {
    const g = discoverInSource({ id: 'g', name: 'G', code: 'uniform sampler2D tex;\nvec4 tap(vec2 uv) { return texture2D(tex, uv); }\nvoid split(vec2 p, out float a) { a = p.x; }' });
    const tap = g[0], split = g[1];
    const r1 = previewShaderFor(tap, inferParamRoles(tap), inferReturnRole(tap), []);
    expect(r1.ok).toBe(false);
    const r2 = previewShaderFor(split, inferParamRoles(split), inferReturnRole(split), []);
    expect(r2.ok).toBe(false);
  });
});
