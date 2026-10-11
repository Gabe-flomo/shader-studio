import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { analyse, unitsForLines, type Analysis } from '../analyse';
import { buildGuided, slidersOf, stableKeys, type GuidedBuild } from '../build';
import type { ConvertStep, GroupStep, Step } from '../stage';
import { suggestNext, guidedReducer, initialGuided } from '../session';
import { CONVERT_EXAMPLES } from '../../../glslToGraph/examples';
import type { GraphNode } from '../../../types/nodeGraph';

const CORPUS = join(__dirname, '../../../glslToGraph/__tests__/corpus');
const corpus = (f: string) => readFileSync(join(CORPUS, f), 'utf8');

function ok(src: string): Analysis { const a = analyse(src); if (!a.ok) throw new Error(a.error); return a; }
let seq = 0;
const conv = (units: number[], mode: ConvertStep['mode'] = 'nodes', chips: ConvertStep['chips'] = {}, name = 'step'): ConvertStep => ({ kind: 'convert', id: `s${++seq}`, units, mode, name, chips });
function built(a: Analysis, steps: Step[]): GuidedBuild {
  const b = buildGuided(a, steps);
  if (!b.ok) throw new Error(b.error);
  expect(b.compileErrors).toEqual([]);
  expect(b.compiled).not.toBeNull();
  return b;
}
const owned = (b: GuidedBuild, id: string) => b.nodes.filter(n => b.owner.get(n.id) === id);
const restNodes = (b: GuidedBuild) => b.nodes.filter(n => n.params.__guided === 'rest');
const linesOf = (a: Analysis, re: RegExp) => a.units.filter(u => re.test(u.text)).map(u => u.index);

describe('selection → nodes', () => {
  it('step 0 is the remainder alone: one Custom Function into the Output', () => {
    const a = ok(CONVERT_EXAMPLES.rings.code);
    const b = built(a, []);
    expect(restNodes(b)).toHaveLength(1);
    expect(restNodes(b)[0].params.label).toBe('Not converted yet · lines 2–6');
    expect(b.share.done).toBe(0);
  });
  it('rings: the first two lines as nodes, the rest stays one function that reads them', () => {
    const a = ok(CONVERT_EXAMPLES.rings.code);
    const step = conv(unitsForLines(a, 2, 3, new Set()).units, 'nodes', {}, 'distance');
    const b = built(a, [step]);
    const mine = owned(b, step.id).map(n => n.type);
    expect(mine).toContain('length');
    expect(restNodes(b)).toHaveLength(1);
    const rest = restNodes(b)[0];
    // The remainder reads r (what the converted lines made) and time.
    expect(Object.keys(rest.inputs).sort()).toEqual(['r', 'time']);
    expect(rest.inputs.r.connection?.nodeId).toBe(b.nodes.find(n => n.type === 'length')!.id);
    expect(b.share.done).toBe(2);
    expect(b.share.total).toBe(5);
  });
  it('fbm (Shadertoy): converting line by line keeps the graph compiling at every step, ending with no remainder', () => {
    const a = ok(CONVERT_EXAMPLES.shadertoy.code);
    const steps: Step[] = [];
    for (const u of a.units.filter(x => !x.setup)) {
      steps.push(conv([u.index]));
      built(a, steps);
    }
    const last = built(a, steps);
    expect(restNodes(last)).toHaveLength(0);
    // The fbm() call stays code, as the automatic converter keeps it: a Custom Function named after it.
    expect(last.nodes.some(n => n.type === 'customFn' && /fbm/.test(String(n.params.label)))).toBe(true);
    expect(last.share.done).toBe(last.share.total);
  });
  it('the corpus: every shader the converter takes, cut at every statement, compiles at every step', () => {
    for (const f of ['04_helper.frag', '05_branch.frag', '06_loop.frag', '07_plasma.frag', '09_shadertoy_fbm.frag', '12_editor_style.frag', '13_two_carries.frag', '15_branch_in_loop.frag']) {
      const a = ok(corpus(f));
      const steps: Step[] = [];
      for (const u of a.units.filter(x => !x.setup)) {
        const next = [...steps, conv([u.index])];
        const b = buildGuided(a, next);
        if (!b.ok) continue; // a refused cut leaves the steps as they were
        expect(b.compileErrors, `${f} after ${u.text}`).toEqual([]);
        steps.push(next[next.length - 1]);
      }
      expect(steps.length, f).toBeGreaterThan(0);
    }
  });
  it('a loop as nodes becomes an iterated group; the lines before it stay the remainder', () => {
    const a = ok(CONVERT_EXAMPLES.loop.code);
    const step = conv(linesOf(a, /^for/));
    const b = built(a, [step]);
    expect(owned(b, step.id).some(n => n.type === 'group')).toBe(true);
    expect(restNodes(b).length).toBeGreaterThan(0);
  });
  it('One function: the lines as a Custom Function named after the step', () => {
    const a = ok(CONVERT_EXAMPLES.rings.code);
    const step = conv(linesOf(a, /rings =|glow =/), 'function', {}, 'glow rings');
    const b = built(a, [step]);
    const fn = owned(b, step.id).filter(n => n.type === 'customFn');
    expect(fn).toHaveLength(1);
    expect(fn[0].params.label).toBe('glow rings');
    expect(fn[0].params.__guided).toBe('step');
  });
  it('Expression: the step’s math folded into Expression Blocks', () => {
    const a = ok(CONVERT_EXAMPLES.rings.code);
    const plain = conv(linesOf(a, /rings =/));
    const folded = { ...plain, id: 'fold', mode: 'blocks' as const };
    const before = built(a, [plain]), after = built(a, [folded]);
    expect(owned(after, 'fold').some(n => n.type === 'exprNode')).toBe(true);
    expect(owned(after, 'fold').length).toBeLessThan(owned(before, plain.id).length);
  });
  it('a cut a matrix would cross is refused with the reason', () => {
    const a = ok('void main() {\n  vec2 uv = gl_FragCoord.xy / u_resolution;\n  mat2 m = mat2(0.8, -0.6, 0.6, 0.8);\n  uv = m * uv;\n  gl_FragColor = vec4(uv, 0.0, 1.0);\n}');
    const m = a.units.findIndex(u => u.decls.some(d => d.type.startsWith('mat')));
    expect(m).toBe(1);
    const b = buildGuided(a, [conv([m])]);
    expect(b.ok).toBe(false);
    expect(!b.ok && b.error).toMatch(/Can’t cut here/);
  });
});

describe('number chips', () => {
  const a = ok(CONVERT_EXAMPLES.rings.code);
  const unit = a.units.find(u => /rings =/.test(u.text))!;
  const [freq, speed] = unit.literals;
  it('names numbers from where they sit', () => {
    expect(unit.literals.map(l => [l.raw, l.name])).toEqual([['40.0', 'rScale'], ['3.0', 'timeScale']]);
  });
  it('One function: a slider chip is a slider input on the function, with a range around the value', () => {
    const step = conv([unit.index], 'function', { [freq.id]: 'slider', [speed.id]: 'fixed' }, 'rings');
    const b = built(a, [step]);
    const fn = owned(b, step.id).find(n => n.type === 'customFn')!;
    const ins = fn.params.inputs as Array<{ name: string; slider: { min: number; max: number } | null }>;
    expect(ins.find(i => i.name === 'rScale')?.slider).toEqual({ min: 0, max: 100 });
    expect(fn.params.rScale).toBe(40);
    expect(fn.inputs.rScale.connection).toBeUndefined();
    expect(String(fn.params.glslFunctions)).toMatch(/u_time \* 3\.0/); // fixed: kept in the text
    expect(String(fn.params.glslFunctions)).toMatch(/r \* rScale/);
    expect(b.nodes.some(n => n.type === 'constants')).toBe(false);
    expect(b.compiled?.fragmentShader).toBeTruthy();
  });
  it('One function: an input chip is a socket fed from a named constant', () => {
    const step = conv([unit.index], 'function', { [freq.id]: 'input', [speed.id]: 'fixed' }, 'rings');
    const b = built(a, [step]);
    const fn = owned(b, step.id).find(n => n.type === 'customFn')!;
    const src = fn.inputs.rScale.connection!;
    const card = b.nodes.find(n => n.id === src.nodeId)!;
    expect(card.type).toBe('constants');
    expect(card.params.rScale).toBe(40);
  });
  it('Nodes: slider is the node’s own slider, fixed is a named constant on the Constants card', () => {
    const sliders = built(a, [conv([unit.index], 'nodes', {})]);
    expect(sliders.nodes.some(n => n.type === 'constants')).toBe(false);
    const fixed = built(a, [conv([unit.index], 'nodes', { [freq.id]: 'fixed' })]);
    const card = fixed.nodes.find(n => n.type === 'constants')!;
    expect((card.params.items as Array<{ key: string; value: number; slider: boolean }>).map(i => [i.key, i.value, i.slider])).toEqual([['rScale', 40, false]]);
  });
});

describe('grouping', () => {
  const a = ok(CONVERT_EXAMPLES.rings.code);
  const s1 = conv([0], 'nodes', {}, 'centre');
  const s2 = conv([1], 'nodes', {}, 'distance');
  const s3 = conv([2], 'nodes', {}, 'rings');
  it('groups the nodes of the chosen steps, wires crossing it become its sockets', () => {
    const g: GroupStep = { kind: 'group', id: 'g1', name: 'Rings', members: [s2.id, s3.id], hidden: [] };
    const b = built(a, [s1, s2, s3, g]);
    const group = b.nodes.find(n => n.type === 'group' && n.params.label === 'Rings')!;
    expect(group).toBeTruthy();
    expect(b.owner.get(group.id)).toBe('g1');
    const inner = (group.params.subgraph as { nodes: GraphNode[] }).nodes.map(n => n.type);
    expect(inner).toContain('length');
    expect(inner).toContain('sin');
    // Time is shared: it stays outside and comes in through a socket.
    expect(inner).not.toContain('time');
    expect(Object.values(group.inputs).some(i => i.connection && b.nodes.find(n => n.id === i.connection!.nodeId)?.type === 'time')).toBe(true);
    // The remainder reads the group's output, named after the value it carries.
    expect(Object.values(restNodes(b)[0].inputs).some(i => i.connection?.nodeId === group.id)).toBe(true);
    expect(Object.values(group.outputs).map(o => o.label)).toContain('rings');
  });
  it('hides the sliders the group step says to, by keys that survive later steps', () => {
    const before = built(a, [s1, s2, s3]);
    const keys = stableKeys(before.nodes, before.owner);
    const all = slidersOf(before.nodes.filter(n => n.id !== '' && [s2.id, s3.id].includes(before.owner.get(n.id)!)), keys);
    expect(all.length).toBeGreaterThan(0);
    const hide = all.slice(0, 1).map(s => s.key);
    const g: GroupStep = { kind: 'group', id: 'g2', name: 'Rings', members: [s2.id, s3.id], hidden: hide };
    const later = conv([3], 'nodes', {}, 'glow');
    const b = built(a, [s1, s2, s3, g, later]);
    const group = b.nodes.find(n => n.type === 'group' && n.params.label === 'Rings')!;
    expect((group.params.hiddenParams as string[])).toHaveLength(1);
  });
  it('refuses a group that the remainder sits in the middle of', () => {
    const gap: GroupStep = { kind: 'group', id: 'g3', name: 'Split', members: [s1.id, s3.id], hidden: [] };
    const b = built(a, [s1, s3, gap]);
    expect(b.notes[0]).toMatch(/can’t be one group/);
    expect(b.nodes.some(n => n.type === 'group' && n.params.label === 'Split')).toBe(false);
  });
});

describe('the session: steps, undo, suggestions', () => {
  const a = ok(CONVERT_EXAMPLES.rings.code);
  it('undo drops the last step, redo brings it back, a new step clears redo', () => {
    let s = initialGuided(a.source);
    s = guidedReducer(s, { type: 'add', step: conv([0]) });
    s = guidedReducer(s, { type: 'add', step: conv([1]) });
    expect(s.steps).toHaveLength(2);
    s = guidedReducer(s, { type: 'undo' });
    expect(s.steps).toHaveLength(1);
    expect(s.redo).toHaveLength(1);
    s = guidedReducer(s, { type: 'redo' });
    expect(s.steps).toHaveLength(2);
    s = guidedReducer(s, { type: 'undo' });
    s = guidedReducer(s, { type: 'add', step: conv([2]) });
    expect(s.redo).toHaveLength(0);
    // Back to a step: everything after it is undone (and can be redone).
    s = guidedReducer(s, { type: 'back', to: 0 });
    expect(s.steps).toHaveLength(0);
    expect(s.redo).toHaveLength(2);
  });
  it('undoing a step a group used takes the group with it', () => {
    const s1 = conv([0]), s2 = conv([1]);
    let s = initialGuided(a.source);
    s = guidedReducer(s, { type: 'add', step: s1 });
    s = guidedReducer(s, { type: 'add', step: s2 });
    s = guidedReducer(s, { type: 'add', step: { kind: 'group', id: 'g', name: 'G', members: [s1.id, s2.id], hidden: [] } });
    expect(s.steps).toHaveLength(3);
    s = guidedReducer(s, { type: 'undo' });
    expect(s.steps.map(x => x.kind)).toEqual(['convert', 'convert']);
  });
  it('suggests the next cut: the shader’s next paragraph', () => {
    const fbm = ok(CONVERT_EXAMPLES.shadertoy.code);
    const n = suggestNext(fbm, []);
    expect(n?.units.map(i => fbm.units[i].text)).toEqual(['vec2 uv = fragCoord / u_resolution;', 'float n = fbm(uv * 4.0 + u_time * 0.2);', 'vec3 col = mix(vec3(0.05, 0.1, 0.2), vec3(0.9, 0.7, 0.4), n);', 'gl_FragColor = vec4(col, 1.0);']);
    const later = suggestNext(fbm, [conv(n!.units.slice(0, 1))]);
    expect(later?.units[0]).toBe(n!.units[1]);
    expect(later?.label).toMatch(/fbm\(\)/);
  });
  it('a paragraph break (a blank line) ends a suggestion', () => {
    const src = 'void main() {\n  vec2 uv = gl_FragCoord.xy / u_resolution;\n  float d = length(uv);\n\n  vec3 col = vec3(d);\n  gl_FragColor = vec4(col, 1.0);\n}';
    const p = ok(src);
    expect(suggestNext(p, [])?.lines).toEqual([2, 3]);
  });
});

describe('the selection’s picture', () => {
  it('shows the last value the selection makes, the shader cut off after it', async () => {
    const { probeShader } = await import('../probe');
    const a = ok(CONVERT_EXAMPLES.rings.code);
    const p = probeShader(a, [1, 2])!;
    expect(p.name).toBe('rings');
    expect(p.type).toBe('float');
    expect(p.code).toMatch(/float rings = sin\(r \* 40\.0 - u_time \* 3\.0\);\n {2}gl_FragColor = vec4\(vec3\(rings\), 1\.0\);\n\}/);
    expect(p.code).not.toMatch(/glow/);
    // A selection that only writes the colour shows the colour.
    expect(probeShader(a, [4])!.name).toBe('the colour');
  });
});
