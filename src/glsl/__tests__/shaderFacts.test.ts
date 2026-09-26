import { describe, it, expect } from 'vitest';
import { shaderFacts, describeFacts } from '../shaderFacts';

const FLAT = `precision mediump float;
uniform vec2 u_resolution;
uniform float u_time;
void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  gl_FragColor = vec4(uv, 0.5 + 0.5 * sin(u_time), 1.0);
}
`;

const WIGGLE_2D = `precision mediump float;
uniform vec2 u_resolution; uniform float u_time;
float wave(vec2 p, float k) { return sin(p.x * k + u_time) * 0.5; }
void main() {
  vec2 uv = (gl_FragCoord.xy * 2.0 - u_resolution) / u_resolution.y;
  float a = 0.0;
  for (int i = 0; i < 8; i++) { a += wave(uv, float(i)); uv *= 1.1; }
  gl_FragColor = vec4(vec3(a), 1.0);
}`;

const MARCH = `precision mediump float;
uniform vec2 u_resolution; uniform float u_time;
float sdSphere(vec3 p, float r) { return length(p) - r; }
float map(vec3 p) { return sdSphere(p - vec3(0.0, 0.0, 3.0), 1.0); }
vec3 calcNormal(vec3 p) { vec2 e = vec2(0.001, 0.0); return normalize(vec3(map(p + e.xyy) - map(p - e.xyy), map(p + e.yxy) - map(p - e.yxy), map(p + e.yyx) - map(p - e.yyx))); }
void main() {
  vec2 uv = (gl_FragCoord.xy * 2.0 - u_resolution) / u_resolution.y;
  vec3 ro = vec3(0.0), rd = normalize(vec3(uv, 1.5));
  float t = 0.0;
  for (int i = 0; i < 64; i++) { float d = map(ro + rd * t); if (d < 0.001) break; t += d; }
  vec3 n = calcNormal(ro + rd * t);
  gl_FragColor = vec4(n * 0.5 + 0.5, 1.0);
}`;

// Only the loop tells: no ro/rd names, no helpers, a field called `scene`.
const MARCH_PLAIN = `float scene(vec3 q) { return length(q) - 1.0; }
void main() {
  vec3 o = vec3(0.0), d = vec3(0.0, 0.0, 1.0);
  float t = 0.0;
  for (int i = 0; i < 32; i++) { t += scene(o + d * t); }
  gl_FragColor = vec4(t);
}`;

describe('shaderFacts', () => {
  it('counts lines without a trailing blank line, and functions', () => {
    const f = shaderFacts(FLAT);
    expect(f.lines).toBe(7);
    expect(f.functions).toBe(1);
    expect(shaderFacts('').lines).toBe(0);
  });
  it('reads a uv-only shader as 2D', () => {
    expect(shaderFacts(FLAT).dimension).toBe('2d');
    expect(shaderFacts(FLAT).reasons).toEqual([]);
  });
  it('keeps a 2D shader with loops and vec2 helpers as 2D', () => {
    expect(shaderFacts(WIGGLE_2D).dimension).toBe('2d');
  });
  it('reads a ray marcher as 3D and says why', () => {
    const f = shaderFacts(MARCH);
    expect(f.dimension).toBe('3d');
    expect(f.reasons).toContain('ray-march loop');
    expect(f.reasons).toContain('vec3 ro');
    expect(f.reasons).toContain('calcNormal');
    expect(f.reasons).toContain('sdSphere');
  });
  it('spots a march loop from the loop alone (a float function of a vec3 called inside it)', () => {
    const f = shaderFacts(MARCH_PLAIN);
    expect(f.dimension).toBe('3d');
    expect(f.reasons).toEqual(['ray-march loop']);
  });
  it('does not mistake an fbm over 3D noise for a marcher', () => {
    const fbm = `float noise(vec3 p) { return fract(sin(dot(p, vec3(12.9, 78.2, 37.7))) * 43758.5); }
float fbm(vec3 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.0; a *= 0.5; } return v; }
void main() { vec2 uv = gl_FragCoord.xy / 400.0; gl_FragColor = vec4(vec3(fbm(vec3(uv, 0.3))), 1.0); }`;
    expect(shaderFacts(fbm).dimension).toBe('2d');
  });
  it('ignores 3D words that only appear in comments', () => {
    const f = shaderFacts(`// a ray-march loop with vec3 ro, rd and calcNormal, sdSphere, MAX_STEPS\n${FLAT}`);
    expect(f.dimension).toBe('2d');
  });
  it('describes the facts as one line', () => {
    expect(describeFacts(shaderFacts(FLAT))).toBe('2D · 7 lines');
    expect(describeFacts(shaderFacts(MARCH))).toBe('3D · 13 lines · 4 functions');
  });
});
