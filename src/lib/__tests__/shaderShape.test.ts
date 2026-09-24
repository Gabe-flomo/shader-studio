import { describe, expect, it } from 'vitest';
import { shaderShape } from '../shaderShape';

const FS = `precision highp float;
uniform float u_time;
uniform sampler2D u_tex;
float helper(float x) { return sin(x) * pow(x, 2.0); }
void main() {
  float a = 0.0;
  for (int i = 0; i < 8; i++) {
    for (int j = 0; j <= 3; j++) { a += sqrt(float(i)); }
  }
  if (a > 1.0) a = texture2D(u_tex, vec2(0.5)).r;
  gl_FragColor = vec4(a);
}`;

describe('shaderShape', () => {
  it('counts loops with bounds, samples, transcendentals, branches, uniforms and functions', () => {
    const s = shaderShape(FS);
    expect(s.loops).toBe(2);
    expect(s.loopBounds).toEqual([8, 4]);
    expect(s.maxLoopDepth).toBe(2);
    expect(s.textureSamples).toBe(1);
    expect(s.transcendentals).toBe(3);
    expect(s.branches).toBe(1);
    expect(s.uniforms).toBe(2);
    expect(s.functions).toBe(1);
    expect(s.mainLines).toBe(8);
  });
  it('handles an empty shader', () => {
    expect(shaderShape('')).toMatchObject({ lines: 0, mainLines: 0, loops: 0 });
  });
});
