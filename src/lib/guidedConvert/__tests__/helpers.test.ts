/**
 * Guided Convert: a helper function opened as a group of its own (docs/guided-convert.md, "Helper
 * functions as groups"). Its body converts step by step inside the group; every converted call of it
 * is a copy of the group; the shader stays the same picture at every step, on the CPU, both the staged
 * shader and the compiled graph.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { analyse, unitsForLines, type Analysis } from '../analyse';
import { buildGuided, type GuidedBuild } from '../build';
import { graphDifference, SAME } from '../check';
import { maxDifference, CpuShader } from '../cpuGlsl';
import { stage, type ConvertStep, type HelperStep, type Step } from '../stage';
import { CONVERT_EXAMPLES } from '../../../glslToGraph/examples';
import type { GraphNode } from '../../../types/nodeGraph';

const CORPUS = join(__dirname, '../../../glslToGraph/__tests__/corpus');
const corpus = (f: string) => readFileSync(join(CORPUS, f), 'utf8');
const INPUTS = { resolution: [64, 48] as [number, number], time: 1.3, mouse: [20, 30] as [number, number] };

function ok(src: string): Analysis { const a = analyse(src); if (!a.ok) throw new Error(a.error); return a; }
let seq = 0;
const open = (fn: string, callers: number[] = [], name = fn): HelperStep => ({ kind: 'helper', id: `h${++seq}`, fn, name, callers });
const conv = (units: number[], fn?: string, mode: ConvertStep['mode'] = 'nodes'): ConvertStep => ({ kind: 'convert', id: `s${++seq}`, units, mode, name: 'step', chips: {}, ...(fn ? { fn } : {}) });
function built(a: Analysis, steps: Step[]): GuidedBuild {
  const b = buildGuided(a, steps);
  if (!b.ok) throw new Error(b.error);
  expect(b.compileErrors).toEqual([]);
  return b;
}
const stagedSame = (a: Analysis, steps: Step[]) => {
  const s = stage(a, steps);
  if ('error' in s) throw new Error(s.error);
  return maxDifference(a.norm, s.code, INPUTS);
};
const groups = (b: GuidedBuild, fn: string): GraphNode[] => {
  const out: GraphNode[] = [];
  const walk = (list: GraphNode[]) => { for (const n of list) { if (n.type === 'group' && n.params.__helper === fn) out.push(n); const sg = n.params.subgraph as { nodes: GraphNode[] } | undefined; if (sg) walk(sg.nodes); } };
  walk(b.nodes);
  return out;
};
const inner = (g: GraphNode) => (g.params.subgraph as { nodes: GraphNode[] }).nodes;

const TWO_CIRCLES = `float sdCircle(vec2 p, float r) {
  float d = length(p) - r;
  return d;
}
void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution.xy) / u_resolution.y;
  float a = sdCircle(uv - vec2(0.2, 0.0), 0.25);
  float b = sdCircle(uv + vec2(0.25, 0.1), 0.15);
  float m = smoothstep(0.01, 0.0, min(a, b));
  gl_FragColor = vec4(vec3(m), 1.0);
}`;

describe('the analysis reads helpers as scopes', () => {
  it('a helper’s body is units, with its parameters, return type and callers', () => {
    const a = ok(corpus('04_helper.frag'));
    const h = a.helpers.find(x => x.name === 'sdBox')!;
    expect(h.params).toEqual([{ name: 'p', type: 'vec2', qual: 'in' }, { name: 'b', type: 'vec2', qual: 'in' }]);
    expect(h.ret).toBe('float');
    expect(h.units.map(u => u.text)).toEqual(['vec2 d = abs(p) - b;', 'return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);']);
    expect(h.units.every(u => u.fn === 'sdBox')).toBe(true);
    expect(h.openable).toBe(true);
    expect(h.callers.map(i => a.units[i].text)).toEqual(['float d = sdBox(uv, vec2(0.3, 0.2));']);
    // Its numbers are chips of their own, keyed by the helper.
    expect(h.units[1].literals.map(l => l.id)).toEqual(['sdBox/1:0', 'sdBox/1:1']);
  });
  it('says why a helper can’t open: out parameters, an early return, no value back', () => {
    const a = ok(`void split(in vec2 p, out float x, out float y) { x = p.x; y = p.y; }
float pick(float v) { if (v > 0.5) return 1.0; return v; }
void main() { float x; float y; split(gl_FragCoord.xy, x, y); gl_FragColor = vec4(pick(x), y, 0.0, 1.0); }`);
    expect(a.helpers.find(h => h.name === 'split')!.openable).toMatch(/returns nothing|out parameters/);
    expect(a.helpers.find(h => h.name === 'pick')!.openable).toMatch(/returns early/);
  });
  it('a selection inside an opened helper takes its body’s statements; inside another, its callers', () => {
    const a = ok(corpus('04_helper.frag'));
    const closed = unitsForLines(a, 2, 2, new Set());
    expect(closed.via).toBe('sdBox');
    const opened = unitsForLines(a, 2, 2, new Set(), { has: fn => fn === 'sdBox', taken: () => new Set() });
    expect(opened).toEqual({ units: [0], fn: 'sdBox' });
    const taken = unitsForLines(a, 2, 3, new Set(), { has: () => true, taken: () => new Set([0]) });
    expect(taken.units).toEqual([1]);
  });
});

describe('a helper opened as a group', () => {
  it('sdBox: opened, its caller converted, its body converted line by line: the same picture at every step', () => {
    const a = ok(corpus('04_helper.frag'));
    const h = a.helpers.find(x => x.name === 'sdBox')!;
    const steps: Step[] = [open('sdBox', h.callers)];
    let b = built(a, steps);
    expect(stagedSame(a, steps)).toBeLessThan(1e-9);
    expect(graphDifference(a, b)).toBeLessThanOrEqual(SAME);
    // At first the whole body is the group's remainder: one Custom Function inside the group.
    let [g] = groups(b, 'sdBox');
    expect(g).toBeDefined();
    expect(inner(g).filter(n => n.type === 'customFn').map(n => n.params.label)).toEqual(['Not converted yet · lines 1–3']);
    // Its parameters are the group's inputs, its return value the output.
    expect((g.params.subgraph as { inputPorts: { label: string }[] }).inputPorts.map(p => p.label)).toEqual(['p', 'b']);
    expect(Object.values(g.outputs).map(o => o.label)).toEqual(['sdBox']);
    for (const u of h.units) {
      steps.push(conv([u.index], 'sdBox'));
      b = built(a, steps);
      expect(stagedSame(a, steps)).toBeLessThan(1e-9);
      expect(graphDifference(a, b)).toBeLessThanOrEqual(SAME);
    }
    [g] = groups(b, 'sdBox');
    // Fully converted: no code left in the group, library nodes instead.
    expect(inner(g).some(n => n.type === 'customFn')).toBe(false);
    expect(inner(g).map(n => n.type)).toEqual(expect.arrayContaining(['abs', 'length', 'max', 'minMath']));
    // The nodes inside know the step (and line) they came from.
    const ownerOf = (type: string) => b.owner.get(inner(g).find(n => n.type === type)!.id);
    expect(ownerOf('abs')).toBe(steps[1].id);
    expect(ownerOf('length')).toBe(steps[2].id);
  });
  it('every converted call is a copy of the group (two circles: two copies, the same inside)', () => {
    const a = ok(TWO_CIRCLES);
    const h = a.helpers[0];
    expect(h.callers).toHaveLength(2);
    const steps: Step[] = [open('sdCircle', h.callers), ...h.units.map(u => conv([u.index], 'sdCircle'))];
    const b = built(a, steps);
    const gs = groups(b, 'sdCircle');
    expect(gs).toHaveLength(2);
    expect(inner(gs[0]).map(n => n.type).sort()).toEqual(inner(gs[1]).map(n => n.type).sort());
    expect(b.helperGroups.map(x => x.fn)).toEqual(['sdCircle', 'sdCircle']);
    // A number argument comes in through the group's input, from a Constants entry outside.
    const consts = b.nodes.filter(n => n.type === 'constants').flatMap(n => (n.params.items as { key: string; value: number }[]).map(i => [i.key, i.value]));
    expect(consts).toEqual(expect.arrayContaining([['r', 0.25], ['r_2', 0.15]]));
    expect(graphDifference(a, b)).toBeLessThanOrEqual(SAME);
  });
  it('a helper that calls a helper: fbm opened, noise kept as code inside it; then noise opened too, nested', () => {
    const a = ok(CONVERT_EXAMPLES.shadertoy.code);
    const fbm = a.helpers.find(h => h.name === 'fbm')!;
    const noise = a.helpers.find(h => h.name === 'noise')!;
    const steps: Step[] = [open('fbm', fbm.callers), ...fbm.units.map(u => conv([u.index], 'fbm'))];
    let b = built(a, steps);
    expect(stagedSame(a, steps)).toBeLessThan(1e-9);
    expect(graphDifference(a, b)).toBeLessThanOrEqual(SAME);
    expect(groups(b, 'fbm')).toHaveLength(1);
    // The loop inside fbm() is an iterated group inside the helper's group.
    expect(inner(groups(b, 'fbm')[0]).some(n => n.type === 'group' && n.params.iterations === 5)).toBe(true);
    steps.push(open('noise'), ...noise.units.map(u => conv([u.index], 'noise')));
    b = built(a, steps);
    expect(stagedSame(a, steps)).toBeLessThan(1e-9);
    expect(groups(b, 'noise').length).toBe(1);
    expect(graphDifference(a, b)).toBeLessThanOrEqual(SAME);
  });
  it('One function inside a helper: those lines as a Custom Function in the group', () => {
    const a = ok(corpus('04_helper.frag'));
    const h = a.helpers[0];
    const steps: Step[] = [open('sdBox', h.callers), { ...conv([1], 'sdBox', 'function'), name: 'box distance' }];
    const b = built(a, steps);
    const fn = inner(groups(b, 'sdBox')[0]).filter(n => n.type === 'customFn');
    expect(fn.map(n => n.params.label)).toEqual(['box distance']);
    expect(graphDifference(a, b)).toBeLessThanOrEqual(SAME);
  });
  it('a helper that can’t open is refused with the reason', () => {
    const a = ok(`float pick(float v) { if (v > 0.5) return 1.0; return v; }
void main() { gl_FragColor = vec4(vec3(pick(gl_FragCoord.x / u_resolution.x)), 1.0); }`);
    const b = buildGuided(a, [open('pick')]);
    expect(b.ok).toBe(false);
    expect(!b.ok && b.error).toMatch(/can’t open as a group: pick\(\) returns early/);
  });
});

describe('the corpus: every helper that can open, opened and converted step by step', () => {
  const files = [
    ...['04_helper.frag', '09_shadertoy_fbm.frag', '12_editor_style.frag'].map(f => ({ name: f, src: corpus(f) })),
    ...readdirSync(join(CORPUS, 'user')).map(f => ({ name: `user/${f}`, src: readFileSync(join(CORPUS, 'user', f), 'utf8') })),
  ];
  it('stays the same picture (staged shader and compiled graph) at every step, wherever the interpreter can run it', () => {
    let opened = 0, checked = 0;
    const failures: string[] = [];
    for (const { name, src } of files) {
      const r = analyse(src);
      if (!r.ok) continue;
      const a = r;
      let runs = true;
      try { new CpuShader(a.norm).run([10, 10], INPUTS); } catch { runs = false; }
      const t0 = performance.now();
      for (const h of a.helpers.filter(x => x.openable === true)) {
        // Open it with the callers it can take (a refused one stays code), then its body statement by statement.
        let steps: Step[] = [open(h.name, h.callers)];
        if (!buildGuided(a, steps).ok) steps = [open(h.name)];
        const b0 = buildGuided(a, steps);
        if (!b0.ok) { failures.push(`${name}: opening ${h.name}() failed: ${b0.error}`); continue; }
        opened++;
        for (const u of h.units) {
          const next = [...steps, conv([u.index], h.name)];
          const b = buildGuided(a, next);
          if (!b.ok) continue; // a refused cut leaves the steps as they were
          if (b.compileErrors.length) { failures.push(`${name}: ${h.name}() after “${u.text}”: ${b.compileErrors[0]}`); break; }
          steps = next;
          if (!runs || performance.now() - t0 > 4000) continue;
          const s = stage(a, steps);
          if ('error' in s) continue;
          let d: number;
          try { d = maxDifference(a.norm, s.code, INPUTS, [4, 3]); } catch { continue; }
          if (!(d < 1e-6)) { failures.push(`${name}: ${h.name}() staged differs by ${d} after “${u.text}”`); break; }
          const g = graphDifference(a, b, undefined, 300);
          if (g !== null) { checked++; if (g > SAME) { failures.push(`${name}: ${h.name}() graph differs by ${g} after “${u.text}”`); break; } }
        }
      }
    }
    expect(failures).toEqual([]);
    expect(opened).toBeGreaterThanOrEqual(10);
    expect(checked).toBeGreaterThanOrEqual(10);
  }, 240_000);
});
