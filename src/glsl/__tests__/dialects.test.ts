/**
 * Pastes from other hosts read as ours: the names change, the entry point
 * becomes main(), and what a paste lacks (precision, uniforms) is added.
 */
import { describe, expect, it } from 'vitest';
import { detectDialect, translateToStudio } from '../dialects';

describe('GLSL dialects', () => {
  it('leaves a Playfield / Book of Shaders shader alone', () => {
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

describe('line map and tidy', () => {
  it('maps a translated line back to the pasted line through inserted and blanked lines', async () => {
    const src = 'float f(float x) { return x; }\nvoid mainImage(out vec4 fragColor, in vec2 fragCoord){\n  vec2 uv = fragCoord / iResolution.xy;\n  fragColor = vec4(uv, sin(iTime), 1.0);\n}';
    const t = translateToStudio(src);
    const lines = t.code.split('\n');
    const at = (needle: string) => lines.findIndex(l => l.includes(needle)) + 1;
    expect(t.toSourceLine(at('float f(float x)'))).toBe(1);
    expect(t.toSourceLine(at('void main()'))).toBe(2);
    expect(t.toSourceLine(at('vec2 fragCoord = gl_FragCoord.xy'))).toBe(2); // an inserted line points at the line before it
    expect(t.toSourceLine(at('vec2 uv = fragCoord'))).toBe(3);
    expect(t.toSourceLine(at('gl_FragColor = vec4(uv'))).toBe(4);
    const { reindent, tidyGlsl } = await import('../format');
    expect(reindent('void main(){\nfloat a=1.0;\n  if(a>0.0){\n a=2.0;\n}\n}\n\n\n')).toBe('void main(){\n    float a=1.0;\n    if(a>0.0){\n        a=2.0;\n    }\n}\n');
    const tidied = tidyGlsl(src);
    expect(tidied.changed).toBe(true);
    expect(tidied.code).toContain('    vec2 uv = fragCoord / u_resolution;');
    expect(tidyGlsl(tidied.code).changed).toBe(false);
  });

  it('renames the mainImage out parameter in mainImage only, and reads non-breaking spaces as spaces', () => {
    // `C` is the out parameter of mainImage and a local vec2 in Z(): only mainImage's C is gl_FragColor.
    const t = translateToStudio('vec2 Z(vec2 U){\n\u00a0\u00a0vec2 C = U - vec2(0.5);\n  return C / dot(C, C);\n}\nvoid mainImage(out vec4 C, in vec2 U){\n  C = vec4(Z(U), 0.0, 1.0);\n}');
    expect(t.code).toContain('vec2 C = U - vec2(0.5);');
    expect(t.code).toContain('return C / dot(C, C);');
    expect(t.code).toContain('gl_FragColor = vec4(Z(U), 0.0, 1.0);');
    expect(t.code.match(/gl_FragColor/g)).toHaveLength(1);
    expect(t.code).not.toMatch(/\u00a0/);
    expect(t.code).toContain('\n  vec2 C = U - vec2(0.5);');
  });

  it('puts for loops with several updates, and integer %, into ES 1.00 form', () => {
    const t = translateToStudio('void main(){ float a = .5; vec3 p = vec3(1.0); float v = 0.;\nfor (int i = 0; i < 9; i++, p*=2.,a/=2.) \n    v += a * length(p);\nint k = (int(v)%2)*2; for (int j = 0; j < 3; j++, k++) { v += 1.0; }\ngl_FragColor = vec4(v); }');
    expect(t.code).toMatch(/for \(int i = 0; i < 9; i\+\+\) \{ \n\s+v \+= a \* length\(p\); p\*=2\.; a\/=2\.; \}/);
    expect(t.code).toMatch(/for \(int j = 0; j < 3; j\+\+\) \{\s+v \+= 1\.0;\s+k\+\+; \}/);
    expect(t.code).toContain('int k = (int(mod(float(int(v)), float(2))))*2;');
    expect(t.notes).toContain('2 for loops put in ES 1.00 form (extra updates moved into the body)');
    expect(t.notes).toContain('1 integer % rewritten as mod()');
    expect(t.code.split('\n')).toHaveLength(6); // the added precision line, then the paste's five
  });
});
