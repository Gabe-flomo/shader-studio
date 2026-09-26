/**
 * Fix-ups: offered only for a refusal they take away, and the rewrite then
 * converts. (That the picture stays the same is the browser check's to say:
 * tools/g2n-corpus.mts --fixups; the user corpus's four are Same.)
 */
import { describe, it, expect } from 'vitest';
import { glslToGraph } from '..';
import { compileGraph } from '../../compiler/graphCompiler';
import { suggestFixups, hoistWrites, arrayToFunction, uniformsToConsts, floatHash } from '../fixups';

const converts = (src: string) => {
  const r = glslToGraph(src);
  expect(r.report.unsupported).toEqual([]);
  expect(compileGraph({ nodes: r.nodes }).errors ?? []).toEqual([]);
};

describe('fix-ups', () => {
  it('offers nothing for a shader that converts', () => {
    expect(suggestFixups('void main(){ gl_FragColor = vec4(gl_FragCoord.xy / u_resolution.xy, 0.0, 1.0); }')).toEqual([]);
  });

  it('gives each write in an expression a line of its own, keeping what an earlier operand read in a temporary', () => {
    const src = '#define D length(mod(U += T, T) - 1.0)\nvoid mainImage(out vec4 O, vec2 U) { vec2 T = vec2(3.0, 5.0); O = vec4(min(D, D)); O.g = U.x * 0.001; }';
    expect(glslToGraph(src).report.unsupported.join(' ')).toMatch(/U changes inside an expression/);
    const [f] = suggestFixups(src);
    expect(f).toMatchObject({ id: 'hoist-writes', samePicture: true });
    // The first D is worked out before the second write changes U.
    expect(f.code.replace(/\s+/g, ' ')).toContain('U += T; float _w1 = length(mod(U , T) - 1.0); U += T; gl_FragColor = vec4(min(_w1, length(mod(U , T) - 1.0)));');
    converts(f.code);
  });

  it('hoists a prefix increment and a write in a parenthesis, and splits a golfed comma statement', () => {
    const code = hoistWrites('void main(){ vec4 h = vec4(0.1); vec4 O = ++h; vec2 U = gl_FragCoord.xy; U = (U + U - (O.xy = u_resolution)) / O.y; float a = 0.0, A; O += cos(A = a + 1.0) * sin(A), a += 2.0; gl_FragColor = O + h + a; }')!;
    const flat = code.replace(/\s+/g, ' ');
    expect(flat).toContain('++h; vec4 O = h;');
    expect(flat).toContain('O.xy = u_resolution; U = (U + U - (O.xy )) / O.y;');
    expect(flat).toContain('A = a + 1.0; O += cos(A ) * sin(A); a += 2.0;');
    converts(code);
  });

  it('leaves a write it can’t move safely (one side of && or of a ternary)', () => {
    expect(hoistWrites('void main(){ float a = 0.0; float b = (gl_FragCoord.x > 1.0 && (a += 1.0) > 0.0) ? 1.0 : 0.0; gl_FragColor = vec4(a + b); }')).toBeNull();
  });

  it('turns a global array helpers read and main() fills with numbers into a function', () => {
    const src = 'vec3 pal[3];\nvec3 pick(float c) { vec3 r = vec3(0.0); for (int i = 0; i < 3; i++) if (float(i) <= c) r = pal[i]; return r; }\nvoid main() {\n  pal[0] = vec3(1, 0, 0);\n  pal[2] = vec3(0, 0, 255) / 255.;\n  gl_FragColor = vec4(pick(gl_FragCoord.x / u_resolution.x * 3.0), 1.0);\n}';
    expect(glslToGraph(src).report.unsupported.join(' ')).toMatch(/Global pal/);
    const a = arrayToFunction(src)!;
    expect(a.names).toEqual(['pal']);
    expect(a.code).toContain('vec3 pal(int i) {');
    expect(a.code).toContain('if (i == 1) return vec3(0.0);');
    expect(a.code).toContain('r = pal(i);');
    expect(a.code).not.toMatch(/pal\[/);
    expect(a.code.split('\n')).toHaveLength(src.split('\n').length + 5);
    converts(a.code);
    expect(suggestFixups(src).map(f => f.id)).toEqual(['array-function']);
    // Filled from something that changes: no fix.
    expect(arrayToFunction('vec3 pal[2];\nvec3 f(int i) { return pal[i]; }\nvoid main(){ pal[0] = vec3(u_time); gl_FragColor = vec4(f(0), 1.0); }')).toBeNull();
  });

  it('makes a uniform with no source a const holding 0, and a texture black', () => {
    const src = 'uniform float speed;\nuniform sampler2D tex;\nvoid main(){ vec2 uv = gl_FragCoord.xy / u_resolution.xy; gl_FragColor = vec4(uv * speed + texture2D(tex, uv).rg, 0.0, 1.0); }';
    const u = uniformsToConsts(src)!;
    expect(u.names).toEqual(['speed', 'tex']);
    expect(u.code).toMatch(/const float speed = 0\.0;/);
    expect(u.code).toMatch(/vec4\(0\.0\)\.rg/);
    converts(u.code);
    expect(suggestFixups(src)[0]).toMatchObject({ id: 'uniform-consts', samePicture: true });
  });

  it('puts a float hash where a uint one was, and says the picture changes', () => {
    const src = 'uint h(uint x) { x ^= x >> 16u; x *= 0x7feb352du; return x; }\nfloat hash21(vec2 p) { uvec2 q = uvec2(ivec2(floor(p))); return float(h(q.x + h(q.y))) / 4294967295.0; }\nvoid main(){ gl_FragColor = vec4(vec3(hash21(floor(gl_FragCoord.xy / 8.0))), 1.0); }';
    const h = floatHash(src)!;
    expect(h.names).toEqual(['hash21']);
    expect(h.code).not.toMatch(/uint|>>/);
    converts(h.code);
    expect(suggestFixups(src)[0]).toMatchObject({ id: 'float-hash', samePicture: false });
  });
});

describe('#define over several lines', () => {
  it('is one macro, and the lines it took still count', () => {
    const r = glslToGraph('#define WAVE(x) \\\n  sin(x * 3.0) \\\n  * 0.5\nvoid main(){\n  float v = WAVE(gl_FragCoord.x);\n  gl_FragColor = vec4(vec3(v), 1.0);\n}');
    expect(r.report.unsupported).toEqual([]);
    expect(glslToGraph('#define A \\\n 1.0\nvoid main(){\n  float v = A;\n  gl_FragColor = vec4(v) +;\n}').report.errorLine).toBe(5);
  });
});
