import { describe, it, expect } from 'vitest';
import { glslToGraph } from '..';
import { compileGraph } from '../../compiler/graphCompiler';
import { discoverInSource, toCustomFnPreset } from '../../glsl/discover';
import { libraryForConversion, pastedFunctions, PASTE_SOURCE_ID } from '../../components/convert/convertFunctions';
import type { CustomFnPreset } from '../../types/customFnPreset';

const PASTE = `float hash21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), u.x), mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x), u.y);
}
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord / iResolution.xy;
  float n = noise(uv * 4.0 + iTime * 0.2);
  fragColor = vec4(vec3(n), 1.0);
}`;

/** A preset as discovery saves it, from a shader where noise() was written with other spacing and a comment. */
function savedNoise(): CustomFnPreset {
  const elsewhere = `float hash21(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}
// value noise
float noise(vec2 p) { vec2 i = floor(p); vec2 f = fract(p); vec2 u = f*f*(3.0-2.0*f);
  return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), u.x), mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x), u.y); }
void main() { gl_FragColor = vec4(noise(gl_FragCoord.xy)); }`;
  const fn = discoverInSource({ id: 'x', name: 'Elsewhere', code: elsewhere }).find(f => f.name === 'noise')!;
  const prep = toCustomFnPreset(fn, 'Value noise', 'from Elsewhere');
  if (!prep.ok) throw new Error(prep.error);
  return { ...prep.data, id: 'cfp_noise', savedAt: 1 } as CustomFnPreset;
}

describe('Convert page: functions in the paste', () => {
  it('lists the paste’s helpers (not its entry point) as one source', () => {
    const r = pastedFunctions(PASTE);
    expect(r.matches.map(f => f.name)).toEqual(['hash21', 'noise']);
    expect(r.matches.every(f => f.sourceId === PASTE_SOURCE_ID)).toBe(true);
    expect(r.matches.find(f => f.name === 'noise')!.dependencies.map(d => d.name)).toEqual(['hash21']);
    expect(pastedFunctions('  ').matches).toEqual([]);
  });
});

describe('Convert page: a helper already in the library', () => {
  it('becomes the saved function’s node with its argument wired in, and still compiles', () => {
    const lib = libraryForConversion([savedNoise()]);
    const plain = glslToGraph(PASTE);
    const reused = glslToGraph(PASTE, { library: lib });
    expect(plain.report.reused).toBeUndefined();
    expect(reused.report.reused).toEqual([{ fn: 'noise', presetId: 'cfp_noise', label: 'Value noise' }]);
    const node = reused.nodes.find(n => n.params.__fromPreset === 'cfp_noise')!;
    expect(node).toBeDefined();
    expect(node.params).toMatchObject({ label: 'Value noise', body: 'noise(p)', __comment: 'from Elsewhere', outputType: 'float' });
    expect(node.inputs.p.connection).toBeDefined(); // uv * 4.0 + time * 0.2, as nodes
    // The region that carried the whole call as code is gone.
    expect(reused.report.regions.some(r => r.why === 'call to noise()')).toBe(false);
    expect(plain.report.regions.some(r => r.why === 'call to noise()')).toBe(true);
    expect(compileGraph({ nodes: reused.nodes }).success).toBe(true);
  });

  it('leaves a helper whose code differs as a region', () => {
    const p = savedNoise();
    const changed = { ...p, glslFunctions: p.glslFunctions.replace('45.32', '45.33') };
    const r = glslToGraph(PASTE, { library: libraryForConversion([changed]) });
    expect(r.report.reused).toBeUndefined();
    expect(r.report.regions.some(x => x.why === 'call to noise()')).toBe(true);
  });

  it('ignores a preset whose body isn’t a plain call of its inputs', () => {
    const p = { ...savedNoise(), body: 'noise(p * 2.0)' };
    expect(glslToGraph(PASTE, { library: libraryForConversion([p]) }).report.reused).toBeUndefined();
  });
});
