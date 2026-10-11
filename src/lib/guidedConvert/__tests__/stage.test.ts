import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { analyse, unitsForLines, type Analysis } from '../analyse';
import { stage, type Step, type ConvertStep } from '../stage';
import { maxDifference, CpuShader } from '../cpuGlsl';
import { CONVERT_EXAMPLES } from '../../../glslToGraph/examples';

const CORPUS = join(__dirname, '../../../glslToGraph/__tests__/corpus');
const corpus = (f: string) => readFileSync(join(CORPUS, f), 'utf8');
const INPUTS = { resolution: [64, 48] as [number, number], time: 1.3, mouse: [20, 30] as [number, number] };

function ok(src: string): Analysis {
  const a = analyse(src);
  if (!a.ok) throw new Error(a.error);
  return a;
}
let seq = 0;
const conv = (units: number[], mode: ConvertStep['mode'] = 'nodes', chips: ConvertStep['chips'] = {}, name = 'step'): ConvertStep => ({ kind: 'convert', id: `s${++seq}`, units, mode, name, chips });
function staged(a: Analysis, steps: Step[]) {
  const s = stage(a, steps);
  if ('error' in s) throw new Error(s.error);
  return s;
}
const same = (a: Analysis, steps: Step[]) => maxDifference(a.norm, staged(a, steps).code, INPUTS);

const SHADERS: Record<string, string> = {
  circle: CONVERT_EXAMPLES.circle.code,
  palette: CONVERT_EXAMPLES.palette.code,
  rings: CONVERT_EXAMPLES.rings.code,
  loop: CONVERT_EXAMPLES.loop.code,
  fbm: CONVERT_EXAMPLES.shadertoy.code,
  helper: corpus('04_helper.frag'),
  branch: corpus('05_branch.frag'),
  plasma: corpus('07_plasma.frag'),
  carries: corpus('13_two_carries.frag'),
};

describe('cpuGlsl', () => {
  it('runs a shader to a colour', () => {
    const s = new CpuShader('uniform vec2 u_resolution; void main() { vec2 uv = gl_FragCoord.xy / u_resolution; gl_FragColor = vec4(uv, 0.5, 1.0); }');
    expect(s.run([32, 12], INPUTS)).toEqual([0.5, 0.25, 0.5, 1]);
  });
  it('tells different shaders apart', () => {
    expect(maxDifference('void main() { gl_FragColor = vec4(1.0); }', 'void main() { gl_FragColor = vec4(0.5); }', INPUTS)).toBeCloseTo(0.5);
  });
  it('passes out and inout parameters back', () => {
    const src = 'void f(in float a, inout float b, out vec2 c) { b += a; c = vec2(a, b); } void main() { float b = 1.0; vec2 c; f(2.0, b, c); gl_FragColor = vec4(c, b, 1.0); }';
    expect(new CpuShader(src).run([0, 0], INPUTS)).toEqual([2, 3, 3, 1]);
  });
});

describe('the staged shader computes what the original does', () => {
  for (const [name, src] of Object.entries(SHADERS)) {
    it(`${name}: at every step, converting statement by statement`, () => {
      const a = ok(src);
      const free = a.units.filter(u => !u.setup).map(u => u.index);
      expect(same(a, [])).toBeLessThan(1e-9);
      const steps: Step[] = [];
      for (const i of free) {
        steps.push(conv([i]));
        expect(same(a, steps)).toBeLessThan(1e-9);
      }
    });
    it(`${name}: every other statement converted, the rest wrapped between them`, () => {
      const a = ok(src);
      const free = a.units.filter(u => !u.setup).map(u => u.index);
      const r = stage(a, [conv(free.filter((_, k) => k % 2 === 1))]);
      if ('error' in r) return; // a matrix crossing the cut is refused, which is fine
      expect(maxDifference(a.norm, r.code, INPUTS)).toBeLessThan(1e-9);
    });
    it(`${name}: the middle as one function with its numbers as parameters`, () => {
      const a = ok(src);
      const free = a.units.filter(u => !u.setup).map(u => u.index);
      const mid = free.slice(1, Math.max(2, free.length - 1));
      const chips = Object.fromEntries(mid.flatMap(i => a.units[i].literals.map(l => [l.id, 'slider' as const])));
      const r = stage(a, [conv(mid, 'function', chips, 'middle part')]);
      if ('error' in r) return;
      expect(r.code).toMatch(/middlePart\(/);
      expect(maxDifference(a.norm, r.code, INPUTS)).toBeLessThan(1e-9);
    });
  }
});

describe('stage', () => {
  it('at step 0 the whole of main() is one remainder function returning the colour', () => {
    const a = ok(CONVERT_EXAMPLES.circle.code);
    const s = staged(a, []);
    expect(s.runs).toHaveLength(1);
    expect(s.runs[0].owner).toBe('rest:0');
    expect(s.colour).toBe('color_');
    // The run sets the colour without reading it: it is the function's own local, returned.
    expect(s.code).toMatch(/vec4 rest\(in vec2 u_resolution\) \{\n {2}vec4 color_ = vec4\(0\.0\);/);
    expect(s.code).toMatch(/color_ = rest\(u_resolution\);/);
  });
  it('passes what crosses the cut: in for what the rest reads, out for what later lines read', () => {
    const a = ok(CONVERT_EXAMPLES.rings.code);
    // Convert the first line (uv) and the last (the colour): r, rings, glow stay code.
    const s = staged(a, [conv([0, 4])]);
    expect(s.runs).toHaveLength(1);
    expect(s.runs[0].inputs.map(p => p.name)).toEqual(['uv', 'u_time']);
    expect(s.runs[0].outputs).toEqual([{ name: 'glow', type: 'float' }]);
    expect(s.code).toMatch(/float glow = rest\(uv, u_time\);/);
  });
  it('gives several values back through out parameters', () => {
    const a = ok(CONVERT_EXAMPLES.loop.code);
    // Only the loop converted: uv, v, a, p are made by the remainder before it.
    const loop = a.units.findIndex(u => u.ast.type === 'for_statement');
    const s = staged(a, [conv([loop])]);
    const first = s.runs[0];
    expect(first.outputs.map(p => p.name).sort()).toEqual(['a', 'p', 'v']);
    expect(s.code).toMatch(/void rest\(.*out float v.*\)/);
    expect(same(a, [conv([loop])])).toBeLessThan(1e-9);
  });
  it('refuses a cut a matrix would cross', () => {
    const a = ok(corpus('10_rotate_inline.frag'));
    const m = a.units.findIndex(u => u.decls.some(d => d.type.startsWith('mat')));
    if (m < 0) return;
    const r = stage(a, [conv([m])]);
    expect('error' in r && r.error).toMatch(/Can’t cut here/);
  });
  it('fixed numbers in Nodes mode are named, so they land on the Constants card', () => {
    const a = ok(CONVERT_EXAMPLES.circle.code);
    const smooth = a.units.find(u => /smoothstep/.test(u.text))!;
    const lit = smooth.literals[0];
    expect(lit.name).toBe('edge0');
    const s = staged(a, [conv([smooth.index], 'nodes', { [lit.id]: 'fixed' })]);
    expect(s.code).toMatch(/float edge0 = 0\.31;/);
    expect(s.code).toMatch(/smoothstep\(edge0, 0\.3, d\)/);
  });
  it('a selection in a helper takes the lines of main() that call it', () => {
    const a = ok(CONVERT_EXAMPLES.shadertoy.code);
    const r = unitsForLines(a, 2, 3, new Set());
    expect(r.via).toBe('noise');
    expect(r.units.map(i => a.units[i].text)).toEqual(['float n = fbm(uv * 4.0 + u_time * 0.2);']);
  });
  it('a Shadertoy paste: its fragCoord line is setup, converted from the start', () => {
    const a = ok(CONVERT_EXAMPLES.shadertoy.code);
    expect(a.units.filter(u => u.setup).map(u => u.text)).toEqual(['vec2 fragCoord = gl_FragCoord.xy;']);
    expect(a.units.find(u => /uv =/.test(u.text))!.lines).toEqual([13, 13]);
  });
});

describe('the user corpus (50 pasted shaders)', () => {
  it('stays the same picture on the CPU at every step, wherever the interpreter can run it', async () => {
    const { readdirSync } = await import('fs');
    const dir = join(CORPUS, 'user');
    let checked = 0;
    const failures: string[] = [];
    for (const f of readdirSync(dir)) {
      const a = analyse(readFileSync(join(dir, f), 'utf8'));
      if (!a.ok) continue;
      const t0 = performance.now();
      try { new CpuShader(a.norm).run([10, 10], INPUTS); } catch { continue; } // matrices, textures…
      if (performance.now() - t0 > 30) continue; // a long raymarch: too slow on the CPU for a unit test
      const free = a.units.filter(u => !u.setup).map(u => u.index);
      const cuts = [...new Set([1, Math.ceil(free.length / 3), Math.ceil(free.length / 2), free.length - 1])].filter(k => k > 0);
      const plans: Step[][] = [[], ...cuts.map(k => [conv(free.slice(0, k))]), [conv(free.filter((_, k) => k % 2 === 0))], [conv(free.slice(1, -1), 'function', {}, 'mid')]];
      for (const steps of plans) {
        const r = stage(a, steps);
        if ('error' in r) continue;
        let d: number;
        try { d = maxDifference(a.norm, r.code, INPUTS, [4, 3]); } catch (e) { failures.push(`${f}: ${(e as Error).message}\n${r.code}`); break; }
        if (!(d < 1e-6)) { failures.push(`${f}: differs by ${d}\n${r.code}`); break; }
      }
      checked++;
    }
    expect(failures).toEqual([]);
    expect(checked).toBeGreaterThanOrEqual(15);
  }, 60_000);
});
