/**
 * Convert keeps the shader's own names: a card made for `vec3 electricField = …` is titled
 * electricField, the Expression Block the page folds a chain into names its locals and knobs
 * after them, and the compiled code uses them where it can. Numbers keep their ranges.
 */
import { describe, expect, it } from 'vitest';
import { glslToGraph } from '..';
import { optimizeGraph } from '../../optimize/optimizeGraph';
import { compileGraph } from '../../compiler/graphCompiler';
import type { GraphNode } from '../../types/nodeGraph';

const SRC = `
uniform vec2 u_resolution;
uniform float u_time;
uniform float chargeScale;
const float electricFieldRadius = 107.0;
void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution.xy;
  float chargeStrength = 2.5;
  vec3 electricField = vec3(uv.x * chargeStrength, uv.y, 0.5);
  float fieldFalloff = length(uv - 0.5) * electricFieldRadius;
  float pulse = sin(u_time * 3.0 + fieldFalloff * chargeScale);
  pulse = pulse * 0.5 + 0.5;
  vec3 glowColour = electricField * pulse + vec3(0.1, 0.2, 0.3);
  gl_FragColor = vec4(glowColour, 1.0);
}`;

const titles = (nodes: GraphNode[]) => nodes.map(n => n.params.label).filter((l): l is string => typeof l === 'string');

describe('Convert keeps the shader’s names', () => {
  const r = glslToGraph(SRC);

  it('titles the card each named variable came out of', () => {
    expect(r.report.unsupported).toEqual([]);
    const byTitle = new Map(r.nodes.filter(n => typeof n.params.label === 'string').map(n => [n.params.label as string, n]));
    expect(byTitle.get('uv')?.type).toBe('divide');
    expect(byTitle.get('electricField')?.type).toBe('makeVec3');
    expect(byTitle.get('fieldFalloff')?.type).toBe('multiply');
    expect(byTitle.get('glowColour')?.type).toBe('add');
    expect(byTitle.has('pulse')).toBe(true);
  });

  it('keeps titles unique: a reassigned name gets a suffix', () => {
    const t = titles(r.nodes);
    expect(new Set(t).size).toBe(t.length);
    expect(t).toContain('pulse_2');
  });

  it('keeps named numbers and uniforms as named Constants entries and Play controls', () => {
    const keys = r.nodes.filter(n => n.type === 'constants').flatMap(n => (n.params.items as Array<{ key: string }>).map(i => i.key));
    expect(keys).toEqual(expect.arrayContaining(['chargeScale', 'chargeStrength', 'electricFieldRadius']));
    expect(r.controls?.map(c => c.label)).toEqual(['chargeScale']);
  });

  it('leaves shared sources untitled (a Time card read everywhere is not "t")', () => {
    const r2 = glslToGraph('uniform float u_time; void main(){ float t = u_time; float wave = sin(t * 2.0) + cos(u_time); gl_FragColor = vec4(vec3(wave), 1.0); }');
    expect(r2.nodes.find(n => n.type === 'time')?.params.label).toBeUndefined();
    expect(titles(r2.nodes)).toContain('wave');
  });

  it('folded into a block, the names are its locals and its knobs, the result names the block, and it compiles', () => {
    const opt = optimizeGraph(r.nodes, { minChain: 3, keepSliders: true }).nodes;
    const block = opt.find(n => n.type === 'exprNode')!;
    const lines = block.params.lines as Array<{ lhs: string; rhs: string }>;
    const locals = lines.map(l => l.lhs.split(' ')[1]);
    expect(locals).toEqual(expect.arrayContaining(['uv', 'electricField', 'fieldFalloff', 'glowColour']));
    expect(block.params.result).toBe('glowColour');
    expect(block.params.label).toBe('glowColour');
    const knobs = (block.params.inputs as Array<{ name: string; slider: unknown }>).filter(i => i.slider).map(i => i.name);
    expect(knobs).toContain('electricField_b'); // the 0.5 in vec3(…, 0.5): not "make_vec3_b"
    // Every name in the block is unique and an identifier.
    const names = [...(block.params.inputs as Array<{ name: string }>).map(i => i.name), ...locals];
    expect(new Set(names).size).toBe(names.length);
    for (const n of names) expect(n).toMatch(/^[A-Za-z_]\w*$/);
    const c = compileGraph({ nodes: opt });
    expect(c.errors ?? []).toEqual([]);
    expect(c.fragmentShader).toMatch(/vec3 electricField = /);
    expect(c.fragmentShader).toMatch(/\bglowColour_\d+_result\b/);
  });

  it('as written (not folded), the compiled variables carry the names', () => {
    const c = compileGraph({ nodes: r.nodes });
    expect(c.success).toBe(true);
    expect(c.fragmentShader).toMatch(/\belectricField_\d+_/);
    expect(c.fragmentShader).toMatch(/\bfieldFalloff_\d+_result\b/);
  });

  it('a name the block’s code already uses (a function it calls, t) is not taken', () => {
    const src = 'uniform float u_time; void main(){ vec2 p = gl_FragCoord.xy * 0.01; float t = length(p) * 2.0 + 1.0; float s = t * t - 0.5; gl_FragColor = vec4(vec3(s), 1.0); }';
    const opt = optimizeGraph(glslToGraph(src).nodes, { minChain: 3, keepSliders: true }).nodes;
    const c = compileGraph({ nodes: opt });
    expect(c.errors ?? []).toEqual([]);
    for (const b of opt.filter(n => n.type === 'exprNode')) {
      const locals = (b.params.lines as Array<{ lhs: string }>).map(l => l.lhs.split(' ')[1]);
      const ins = (b.params.inputs as Array<{ name: string }>).map(i => i.name);
      expect(new Set([...locals, ...ins]).size).toBe(locals.length + ins.length);
      // The block declares its own t and p unless an input has the name: a local may not.
      expect(locals).not.toContain('t');
      expect(locals).not.toContain('p');
    }
  });
});

describe('Convert’s ranges hold the shader’s numbers', () => {
  it('a folded card’s slider holds its value (Multiply B = 107 on a −10–10 param)', () => {
    const src = 'void main(){ vec2 uv = gl_FragCoord.xy * 0.01; float v = sin(uv.x * 107.0) + uv.y; gl_FragColor = vec4(vec3(v), 1.0); }';
    const opt = optimizeGraph(glslToGraph(src).nodes, { minChain: 3, keepSliders: true }).nodes;
    const sliders = opt.filter(n => n.type === 'exprNode').flatMap(b => (b.params.inputs as Array<{ name: string; slider: { min: number; max: number } | null }>)
      .filter(i => i.slider).map(i => ({ v: b.params[i.name] as number, ...i.slider! })));
    expect(sliders.some(s => s.v === 107)).toBe(true);
    for (const s of sliders) { expect(s.min).toBeLessThanOrEqual(s.v); expect(s.max).toBeGreaterThanOrEqual(s.v); }
  });

});
