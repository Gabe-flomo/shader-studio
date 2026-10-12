/**
 * The Generated code panel's Readable view (compiler/readableGlsl.ts, docs/readable-code.md):
 * names from the graph (deterministic, clash-free, never a GLSL word), single-use copies folded
 * only where safe, the line ↔ node map, and every bundled example's Readable program parses like its
 * Exact one and, where the CPU runner can run it, draws the same pixels.
 */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});

import { parser } from '@shaderfrog/glsl-parser';
import { compileGraph } from '../graphCompiler';
import { EXAMPLE_GRAPHS } from '../../store/exampleGraphs';
import { n } from '../../store/graphBuilder';
import type { GraphNode } from '../../types/nodeGraph';
import {
  buildRenames, dropUnusedFunctions, inlineTrivialCopies, isSafeName, readableGlsl, shaderLineNodes, tidy, trimFloat, type ReadableMeta,
} from '../readableGlsl';
import { compileFragment, type Env } from './glslRun';

const metaOf = (nodes: GraphNode[]) => {
  const r = compileGraph({ nodes } as never);
  expect(r.success).toBe(true);
  const meta: ReadableMeta = { nodes, nodeSlugMap: r.nodeSlugMap!, paramBindings: r.paramBindings, nodeOutputVars: r.nodeOutputVars };
  return { r, meta };
};
const parses = (fs: string) => {
  try { parser.parse(fs.replace(/^#version.*$/m, ''), { quiet: true }); return null; } catch (e) { return (e as Error).message.split('\n')[0]; }
};
/** The parser's scope warnings (undeclared names and functions, missing overloads, duplicates), or null if it can't parse. */
function scopeWarnings(fs: string): Set<string> | null {
  const got: string[] = [];
  const spy = vi.spyOn(console, 'warn').mockImplementation((m: unknown) => { got.push(String(m)); });
  try { parser.parse(fs.replace(/^#version.*$/m, ''), { quiet: false }); } catch { return null; } finally { spy.mockRestore(); }
  return new Set(got);
}

/** A small graph: two circles of the same kind (a label clash) mixed and shown. */
function twoCircles() {
  return [
    n('uv', 'uv_1', 0, 0),
    n('circleSDF', 'c_2', 0, 0, { radius: 0.3 }, { position: ['uv_1', 'uv'] }),
    n('circleSDF', 'c_3', 0, 0, { radius: 0.5 }, { position: ['uv_1', 'uv'] }),
    n('minMath', 'm_4', 0, 0, {}, { a: ['c_2', 'distance'], b: ['c_3', 'distance'] }),
    n('floatToVec3', 'f_6', 0, 0, {}, { input: ['m_4', 'result'] }),
    n('output', 'o_5', 0, 0, {}, { color: ['f_6', 'rgb'] }),
  ];
}

describe('names', () => {
  it('renames from labels, numbers clashes, and is deterministic', () => {
    const nodes = twoCircles();
    const { r, meta } = metaOf(nodes);
    const one = readableGlsl(r.fragmentShader, meta);
    const two = readableGlsl(r.fragmentShader, meta);
    expect(one.code).toBe(two.code);
    const names = [...one.renames.values()];
    expect(new Set(names).size).toBe(names.length);
    // Both circles' variables are renamed, the second with a short suffix.
    const slugA = r.nodeSlugMap!.get('c_2')!, slugB = r.nodeSlugMap!.get('c_3')!;
    const fromA = [...one.renames].filter(([k]) => k.startsWith(`${slugA}_`)).map(([, v]) => v);
    const fromB = [...one.renames].filter(([k]) => k.startsWith(`${slugB}_`)).map(([, v]) => v);
    expect(fromA.length).toBeGreaterThan(0);
    expect(fromB.length).toBeGreaterThan(0);
    expect(fromA.every(v => !/\d_/.test(v.split('_')[0]))).toBe(true);
    expect(fromB.some(v => /^circle\w*2/.test(v))).toBe(true);
    // Slider uniforms take their labels; two Radius sliders clash, so both carry their node's name.
    const radA = r.paramBindings['c_2::radius'], radB = r.paramBindings['c_3::radius'];
    expect(one.renames.get(radA)).toMatch(/radius$/);
    expect(one.renames.get(radB)).toMatch(/radius$/);
    expect(one.renames.get(radA)).not.toBe(one.renames.get(radB));
    expect(one.renames.get('u_time')).toBe('time');
    expect(one.renames.get('u_resolution')).toBe('resolution');
  });

  it('a user-given label names the node', () => {
    const nodes = twoCircles();
    nodes[1].params.label = 'Sun disc';
    const { r, meta } = metaOf(nodes);
    const out = readableGlsl(r.fragmentShader, meta);
    expect(out.code).toMatch(/\bsun_disc_\w+/);
    expect(out.code).toContain('// Sun disc → ');
  });

  it('never picks a keyword, builtin, gl_ name, double underscore or a name already in the program', () => {
    expect(isSafeName('float')).toBe(false);
    expect(isSafeName('texture')).toBe(false);
    expect(isSafeName('smoothstep')).toBe(false);
    expect(isSafeName('gl_thing')).toBe(false);
    expect(isSafeName('a__b')).toBe(false);
    expect(isSafeName('main')).toBe(false);
    expect(isSafeName('radius')).toBe(true);
    // Labels that would become GLSL words, and a slider whose label is a name the program uses.
    const code = 'uniform float u_p_ax1_k;\nuniform float u_p_bx2_k;\nfloat radius(float x) { return x; }\nvoid main() { float a_1_v = radius(u_p_ax1_k); float b_2_v = u_p_bx2_k; gl_FragColor = vec4(a_1_v + b_2_v); }\n';
    const node = (id: string, label: string): GraphNode => ({ id, type: 'add', position: { x: 0, y: 0 }, inputs: {}, outputs: {}, params: { label } });
    const meta: ReadableMeta = {
      nodes: [node('A', 'float'), node('B', 'texture')],
      nodeSlugMap: new Map([['A', 'a_1'], ['B', 'b_2']]),
      paramBindings: { 'A::radius': 'u_p_ax1_k', 'B::smoothstep': 'u_p_bx2_k' },
    };
    const ren = buildRenames(code, meta);
    for (const v of ren.values()) expect(isSafeName(v)).toBe(true);
    expect(ren.get('u_p_ax1_k')).not.toBe('radius');
    expect(ren.get('u_p_bx2_k')).not.toBe('smoothstep');
    expect(ren.get('a_1_v')).not.toBe('float_v'.replace('_v', ''));
    expect(parses(readableGlsl(code, meta).code)).toBeNull();
  });
});

describe('inlining', () => {
  const wrap = (body: string, pre = '') => `uniform vec2 u_res;\n${pre}void main() {\n${body}\n}\n`;
  it('folds a single-use copy and a single-use literal', () => {
    const out = inlineTrivialCopies(wrap('    vec2 t = u_res;\n    float k = 1.0;\n    gl_FragColor = vec4(t, k, 1.0);'));
    expect(out).not.toMatch(/vec2 t =/);
    expect(out).not.toMatch(/float k =/);
    expect(out).toContain('vec4(u_res, 1.0, 1.0)');
  });
  it('keeps a copy used twice, one written later, one whose source changes, and one passed to a user function', () => {
    const cases = [
      '    vec2 t = u_res;\n    gl_FragColor = vec4(t, t);',
      '    vec2 t = u_res;\n    t.x += 1.0;\n    gl_FragColor = vec4(t, 0.0, 1.0);',
      '    vec2 s = u_res;\n    vec2 t = s;\n    s.x = 2.0;\n    gl_FragColor = vec4(t, s);',
      '    vec2 s = u_res;\n    vec2 t = s;\n    for (int i = 0; i < 3; i++) { s *= 0.5; }\n    gl_FragColor = vec4(t, s);',
    ];
    for (const c of cases) expect(inlineTrivialCopies(wrap(c))).toContain('vec2 t =');
    const pre = 'void bump(inout vec2 p) { p += 1.0; }\n';
    expect(inlineTrivialCopies(wrap('    vec2 t = u_res;\n    bump(t);\n    gl_FragColor = vec4(t, 0.0, 1.0);', pre))).toContain('vec2 t =');
    // A copy with an expression, a loop declaration or a trailing comment is left alone.
    expect(inlineTrivialCopies(wrap('    vec2 t = u_res * 2.0;\n    gl_FragColor = vec4(t, 0.0, 1.0);'))).toContain('vec2 t =');
    expect(inlineTrivialCopies(wrap('    vec2 t = u_res; // note\n    gl_FragColor = vec4(t, 0.0, 1.0);'))).toContain('vec2 t =');
    expect(inlineTrivialCopies(wrap('    for (int i = 0; i < 2; i++) { float q = 1.0; gl_FragColor = vec4(q); }'))).toContain('float q =');
  });
});

describe('tidying', () => {
  it('trims float literals', () => {
    expect(trimFloat('1.00000')).toBe('1.0');
    expect(trimFloat('0.2500')).toBe('0.25');
    expect(trimFloat('3.1415926538')).toBe('3.1415926538');
    expect(trimFloat('1e5')).toBe('1e5');
    expect(trimFloat('10')).toBe('10');
  });
  it('indents by brace depth, collapses spaces and blank runs', () => {
    expect(tidy('void main() {\nfloat  a   = 1.000;\n\n\n  if (a > 0.0) {\na = 2.0;\n}\n}\n')).toBe('void main() {\n    float a = 1.0;\n\n    if (a > 0.0) {\n        a = 2.0;\n    }\n}\n');
  });
  it('leaves out helpers main() never reaches, keeping the ones it does', () => {
    const code = 'float used(float x) { return helper(x); }\nfloat helper(float x) { return x; }\n\n// Doubles x.\n// (Its note goes too.)\nfloat unused(float x) { return x * 2.0; }\nvoid main() { gl_FragColor = vec4(used(1.0)); }\n';
    const out = dropUnusedFunctions(code);
    expect(out).not.toContain('Doubles');
    expect(out).not.toContain('note goes');
    expect(out).toContain('float used(');
    expect(out).toContain('float helper(');
    expect(out).not.toContain('unused');
    expect(parses(out)).toBeNull();
  });
});

describe('line ↔ node', () => {
  it('each node has a header and its lines; the Output owns the gl_FragColor line', () => {
    const nodes = twoCircles();
    const { r, meta } = metaOf(nodes);
    const out = readableGlsl(r.fragmentShader, meta);
    const lines = out.code.split('\n');
    expect(out.lineNodes.length).toBe(lines.filter((_, i) => i < out.lineNodes.length).length);
    expect(out.sourceLines.length).toBe(out.lineNodes.length);
    const mainAt = lines.findIndex(l => l.startsWith('void main'));
    for (const id of ['c_2', 'c_3', 'm_4']) {
      const idx = out.lineNodes.map((x, i) => (x === id && i > mainAt ? i : -1)).filter(i => i >= 0);
      expect(idx.length, id).toBeGreaterThan(0);
      expect(lines[idx[0]].trim().startsWith('//'), id).toBe(true); // its header
    }
    const fc = lines.findIndex(l => l.includes('gl_FragColor ='));
    expect(out.lineNodes[fc]).toBe('o_5');
    // The Exact code's own map agrees on which node writes each node's variable.
    const exact = r.fragmentShader.split('\n');
    const exactOwners = shaderLineNodes(r.fragmentShader, meta);
    const slugA = r.nodeSlugMap!.get('c_2')!;
    const decl = exact.findIndex(l => new RegExp(`^\\s*\\w+ ${slugA}_\\w+ =`).test(l));
    expect(exactOwners[decl]).toBe('c_2');
    // Renaming keeps lines in place: the source line under a renamed line names the same node.
    lines.forEach((l, i) => { if (out.lineNodes[i] === 'c_2' && !l.trim().startsWith('//') && l.includes('circle')) expect(out.sourceLines[i]).toMatch(new RegExp(`${slugA}_|${slugA.replace("_", "x")}_`)); });
  });
});

// ── Every bundled example ──────────────────────────────────────────────────────────────────────

const near = (a: number[], b: number[]) => a.every((x, i) => Math.abs(x - b[i]) < 1e-5 || (Number.isNaN(x) && Number.isNaN(b[i])));

describe('every example', () => {
  const keys = Object.keys(EXAMPLE_GRAPHS);
  let ran = 0, compared = 0, renamedTotal = 0, strict = 0;
  it.each(keys)('%s: Readable parses wherever Exact does, and draws the same', key => {
    const g = EXAMPLE_GRAPHS[key];
    const r = compileGraph(g);
    if (!r.success || !r.nodeSlugMap) return;
    const meta: ReadableMeta = { nodes: g.nodes, nodeSlugMap: r.nodeSlugMap, paramBindings: r.paramBindings, nodeOutputVars: r.nodeOutputVars };
    const out = readableGlsl(r.fragmentShader, meta);
    ran++;
    renamedTotal += out.renames.size;
    expect(out.lineNodes.length).toBe(out.code.replace(/\n$/, '').split('\n').length);
    // Undeclared names (a broken rename) warn; where Exact passes with warnings as errors, Readable must.
    // A broken rename would leave an undeclared name: every scope warning on Readable (named back to
    // Exact) must already be one on Exact (gl_FragColor and friends are "undefined" to the parser).
    const exactW = scopeWarnings(r.fragmentShader);
    if (exactW) {
      const readW = scopeWarnings(out.code);
      expect(readW, `${key} parses`).not.toBeNull();
      const back = new Map([...out.renames].map(([a, b]) => [b, a]));
      for (const w of readW!) expect(exactW, `${key}: ${w}`).toContain(w.replace(/"(\w+)"/g, (_m, id: string) => `"${back.get(id) ?? id}"`));
      strict++;
    }
    // The CPU runner (a GLSL subset) draws a few pixels of both where it can run Exact.
    let exactProg;
    try { exactProg = compileFragment(r.fragmentShader); } catch { return; }
    const uniforms: Env = { u_time: 1.3, u_resolution: [64, 48], u_mouse: [0.2, 0.3], PI: Math.PI, TAU: Math.PI * 2 };
    for (const [k, v] of Object.entries(r.paramUniforms)) uniforms[k] = v as number | number[];
    const renamed = (env: Env) => { const o: Env = {}; for (const [k, v] of Object.entries(env)) o[out.renames.get(k) ?? k] = v; return o; };
    for (const uv of [[0.31, 0.62], [0.8, 0.15], [0.5, 0.5]]) {
      const base: Env = { ...uniforms, vUv: uv, gl_FragCoord: [uv[0] * 64, uv[1] * 48, 0, 1] };
      let a: number[];
      try { a = compileFragment(r.fragmentShader).run({ ...base }).gl_FragColor as number[]; } catch { return; }
      if (!Array.isArray(a)) return;
      const b = compileFragment(out.code).run(renamed(base)).gl_FragColor as number[];
      expect(near(a, b), `${key} at ${uv}`).toBe(true);
    }
    void exactProg;
    compared++;
  });
  it('ran over the examples and compared pixels for a good share of them', () => {
    expect(ran).toBeGreaterThan(300);
    expect(renamedTotal).toBeGreaterThan(ran);
    expect(compared).toBeGreaterThan(15);
    expect(strict).toBeGreaterThan(100);
    process.stdout.write(`readable: ${ran} examples, ${strict} scope-checked, ${compared} pixel-compared\n`);
  });
});
