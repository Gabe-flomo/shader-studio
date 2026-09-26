/**
 * The GLSL → node graph experiment: every corpus shader either converts to a
 * graph the compiler accepts, or is refused up front with a reason. Pixel
 * equivalence needs a browser: see tools/g2n-roundtrip.ts + g2n-pixel-compare.mjs
 * (as of writing, 10 of 11 render identically; 08 is refused for `discard`).
 */
import { describe, it, expect } from 'vitest';
import { glslToGraph } from '..';
import { compileGraph } from '../../compiler/graphCompiler';

const files = import.meta.glob('./corpus/*.frag', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const corpus = Object.entries(files).map(([p, src]) => [p.split('/').pop()!, src] as const).sort((a, b) => a[0].localeCompare(b[0]));

describe('GLSL → node graph', () => {
  it.each(corpus.filter(([f]) => !f.startsWith('08')))('%s converts to a graph the compiler accepts', (_f, src) => {
    const r = glslToGraph(src);
    expect(r.report.unsupported).toEqual([]);
    expect(r.nodes.some(n => n.type === 'output' || n.type === 'vec4Output')).toBe(true);
    const c = compileGraph({ nodes: r.nodes });
    expect(c.errors ?? []).toEqual([]);
    expect(c.success).toBe(true);
  });

  it('refuses what a graph can’t hold, and says why', () => {
    const r = glslToGraph(corpus.find(([f]) => f.startsWith('08'))![1]);
    expect(r.nodes).toEqual([]);
    expect(r.report.unsupported.join(' ')).toMatch(/discard/);
    // The preview still says what would have become code, so the user knows before committing.
    expect(r.report.regions.map(x => x.why).join(' ')).toMatch(/rot\(\) returns a mat2/);
  });

  it('is deterministic', () => {
    for (const [, src] of corpus) expect(JSON.stringify(glslToGraph(src))).toBe(JSON.stringify(glslToGraph(src)));
  });

  it('turns literals into sliders and keeps the rest as nodes', () => {
    const r = glslToGraph(corpus.find(([f]) => f.startsWith('01'))![1]);
    const kinds = r.nodes.map(n => n.type);
    expect(kinds).toEqual(expect.arrayContaining(['fragCoord', 'resolution', 'divide', 'subtract', 'length', 'smoothstep', 'floatToVec3', 'output']));
    expect(r.report.stats).toMatchObject({ blocks: 0, regions: 0, sliders: 3 });
    const smooth = r.nodes.find(n => n.type === 'smoothstep')!;
    expect(smooth.params).toMatchObject({ edge0: 0.31, edge1: 0.3 });
  });

  it('reads a Shadertoy shader, carrying helper functions into a region', () => {
    const r = glslToGraph(corpus.find(([f]) => f.startsWith('09'))![1]);
    expect(r.report.notes.join(' ')).toMatch(/mainImage/);
    const fn = r.nodes.find(n => n.type === 'customFn')!;
    expect(String(fn.params.glslFunctions)).toMatch(/float hash21/);
    expect(String(fn.params.glslFunctions)).toMatch(/float fbm/);
  });
});

describe('for loops become iterated groups', () => {
  const by = (prefix: string) => corpus.find(([f]) => f.startsWith(prefix))![1];
  const groupsOf = (src: string) => { const r = glslToGraph(src); return { r, groups: r.nodes.filter(n => n.type === 'group') }; };

  it('a constant loop is one group running that many times, with a Loop Carry per changed variable and a Loop Index', () => {
    const { r, groups } = groupsOf(by('06'));
    expect(groups).toHaveLength(1);
    const g = groups[0];
    expect(g.params.iterations).toBe(4);
    const sg = g.params.subgraph as { nodes: { type: string }[]; inputPorts: { label: string; type: string }[]; outputPorts: { label: string }[] };
    expect(sg.nodes.filter(n => n.type === 'loopCarry')).toHaveLength(1);
    expect(sg.nodes.filter(n => n.type === 'loopIndex')).toHaveLength(1);
    expect(sg.outputPorts.map(p => p.label)).toEqual(['a']);
    // Carry init ports come first, in the output ports' order (the compiler pairs them by position).
    expect(sg.inputPorts[0]).toMatchObject({ label: 'a', type: 'float' });
    expect(r.report.stats.loops).toBe(1);
    expect(r.report.notes.join(' ')).toMatch(/iterated group carrying a/);
    const c = compileGraph({ nodes: r.nodes });
    expect(c.success).toBe(true);
    expect(c.fragmentShader).toMatch(/for \(float \w+ = 0\.0; \w+ < 4\.0; \w+\+\+\)/);
  });

  it('carries every variable the body changes, in any type', () => {
    const { groups } = groupsOf(by('13'));
    const sg = groups[0].params.subgraph as { outputPorts: { label: string; type: string }[] };
    expect(sg.outputPorts.map(p => `${p.label}:${p.type}`)).toEqual(['v:float', 'p:vec2', 'a:float']);
  });

  it('a stepped counter is the index scaled and offset', () => {
    const { r, groups } = groupsOf(by('14'));
    expect(groups[0].params.iterations).toBe(4);
    const sg = groups[0].params.subgraph as { nodes: { type: string; params: Record<string, unknown> }[] };
    expect(sg.nodes.find(n => n.type === 'multiply')?.params.b).toBe(2);
    expect(sg.nodes.find(n => n.type === 'add')?.params.b).toBe(1);
    expect(compileGraph({ nodes: r.nodes }).success).toBe(true);
  });

  it('a branch inside the loop is a ternary block inside the group', () => {
    const { groups } = groupsOf(by('15'));
    const sg = groups[0].params.subgraph as { nodes: { type: string }[]; outputPorts: { label: string }[] };
    expect(sg.nodes.some(n => n.type === 'exprNode')).toBe(true);
    expect(sg.outputPorts.map(p => p.label).sort()).toEqual(['col', 'w']);
  });

  it('a loop with an early exit, or too many iterations, stays code', () => {
    const { r, groups } = groupsOf(by('11'));
    expect(groups).toHaveLength(0);
    expect(r.report.regions.map(x => x.why).join(' ')).toMatch(/loop/);
    const many = glslToGraph('void main(){ float s = 0.0; for (int i = 0; i < 40; i++) { s += 0.01; } gl_FragColor = vec4(vec3(s), 1.0); }');
    expect(many.nodes.filter(n => n.type === 'group')).toHaveLength(0);
    expect(many.report.regions).toHaveLength(1);
  });
});

describe('inexact nodes are offered with a warning, or kept as code on request', () => {
  const src = 'void main(){ vec2 uv = gl_FragCoord.xy / u_resolution.xy; float k = uv.x - 0.5; float v = 0.1 / k; gl_FragColor = vec4(vec3(v), 1.0); }';
  it('warns and marks the node', () => {
    const r = glslToGraph(src);
    expect(r.report.warnings).toHaveLength(1);
    expect(r.report.warnings[0].why).toMatch(/Divide node guards/);
    const n = r.nodes.find(x => x.id === r.report.warnings[0].nodeId)!;
    expect(n.type).toBe('divide');
    expect(n.params.__importWarning).toBeTruthy();
    expect(r.report.blocks).toHaveLength(0);
  });
  it('becomes a block when asked, keeping the same warning id', () => {
    const first = glslToGraph(src);
    const r = glslToGraph(src, { asBlock: new Set([first.report.warnings[0].id]) });
    expect(r.report.warnings[0].id).toBe(first.report.warnings[0].id);
    expect(r.report.warnings[0].nodeId).toBeUndefined();
    expect(r.report.blocks.map(b => b.code)).toEqual(['0.1 / k']);
    expect(r.nodes.find(n => n.type === 'exprNode')!.params.__importedCode).toBe('block');
    expect(compileGraph({ nodes: r.nodes }).success).toBe(true);
  });
});
