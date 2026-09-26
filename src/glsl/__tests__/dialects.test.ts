/**
 * Pastes from other hosts read as ours: the names change, the entry point
 * becomes main(), and what a paste lacks (precision, uniforms) is added.
 */
import { describe, expect, it } from 'vitest';
import { detectDialect, translateToStudio } from '../dialects';

describe('GLSL dialects', () => {
  it('leaves a Shader Studio / Book of Shaders shader alone', () => {
    const src = 'precision mediump float;\nuniform float u_time;\nuniform vec2 u_resolution;\nvoid main(){ gl_FragColor = vec4(vec3(sin(u_time)), 1.0); }';
    const t = translateToStudio(src);
    expect(t.dialect).toBe('studio');
    expect(t.code).toBe(src);
    expect(t.notes).toEqual([]);
  });

  it('reads Shadertoy: iTime, iResolution (by component too), iMouse, mainImage', () => {
    const t = translateToStudio('void mainImage(out vec4 fragColor, in vec2 fragCoord){ vec2 uv = fragCoord / iResolution.y; float a = iResolution.x / iResolution.y; vec2 m = iMouse.xy; fragColor = vec4(uv, sin(iTime), 1.0); }');
    expect(t.dialect).toBe('shadertoy');
    expect(t.code).toMatch(/void main\(\) \{\n\s*vec2 fragCoord = gl_FragCoord\.xy;/);
    expect(t.code).toContain('fragCoord / u_resolution.y');
    expect(t.code).toContain('u_resolution.x / u_resolution.y');
    expect(t.code).toContain('vec2 m = u_mouse;');
    expect(t.code).toContain('gl_FragColor = vec4(uv, sin(u_time), 1.0)');
    expect(t.code).not.toMatch(/\bfragColor\b/);
    // The paste declared nothing: precision and the uniforms it uses are added, once each.
    expect(t.code.match(/precision highp float;/g)).toHaveLength(1);
    expect(t.code).toContain('uniform vec2 u_resolution;');
    expect(t.code).toContain('uniform float u_time;');
    expect(t.code).toContain('uniform vec2 u_mouse;');
    expect(t.notes.join(' ')).toMatch(/mainImage/);
  });

  it('reads GLSL Sandbox: time, resolution, mouse, surfacePosition', () => {
    const t = translateToStudio('#ifdef GL_ES\nprecision mediump float;\n#endif\nuniform float time;\nuniform vec2 mouse;\nuniform vec2 resolution;\nvarying vec2 surfacePosition;\nvoid main(){ vec2 p = gl_FragCoord.xy / resolution; float timer = time; gl_FragColor = vec4(p, surfacePosition.x, 1.0); }');
    expect(t.dialect).toBe('glslsandbox');
    expect(t.code).not.toMatch(/uniform float time;/);
    expect(t.code).toContain('gl_FragCoord.xy / u_resolution');
    expect(t.code).toContain('float timer = u_time;'); // `timer` is not `time`
    expect(t.code).toContain('(gl_FragCoord.xy / u_resolution * 2.0 - 1.0).x');
    expect(t.code).toContain('uniform float u_time;');
  });

  it('wraps twigl geekest code in main() with r, t, m, FC and o', () => {
    const t = translateToStudio('vec2 p = (FC.xy * 2. - r) / r.y; o = vec4(vec3(length(p) - .5 + sin(t)), 1.);');
    expect(t.dialect).toBe('twigl');
    expect(t.code).toMatch(/void main\(\) \{\n\s*vec2 r = u_resolution;\n\s*float t = u_time;\n\s*vec2 m = u_mouse;\n\s*vec4 FC = gl_FragCoord;\n\s*vec4 o = vec4\(0\.0\);/);
    expect(t.code).toMatch(/gl_FragColor = o;\n\}/);
  });

  it('reads GLSL ES 3.00: the out variable, in varyings, texture()', () => {
    const t = translateToStudio('#version 300 es\nprecision highp float;\nin vec2 vUv;\nout vec4 outColor;\nuniform sampler2D tex;\nvoid main(){ outColor = texture(tex, vUv); }');
    expect(t.dialect).toBe('es300');
    expect(t.code).not.toMatch(/#version/);
    expect(t.code).toContain('varying vec2 vUv;');
    expect(t.code).toContain('gl_FragColor = texture2D(tex, vUv);');
    expect(t.code).not.toMatch(/out vec4/);
  });

  it('says when a paste has no entry point at all', () => {
    const t = translateToStudio('float f(float x) { return x; }');
    expect(t.unsupported.join(' ')).toMatch(/No main/);
  });

  it('detects each dialect', () => {
    expect(detectDialect('void main(){ gl_FragColor = vec4(1.0); }')).toBe('studio');
    expect(detectDialect('void mainImage(out vec4 c, in vec2 p){}')).toBe('shadertoy');
    expect(detectDialect('#version 300 es\nout vec4 c; void main(){}')).toBe('es300');
    expect(detectDialect('uniform vec2 resolution; void main(){}')).toBe('glslsandbox');
    expect(detectDialect('o = vec4(FC.xy / r, 0., 1.);')).toBe('twigl');
  });
});
