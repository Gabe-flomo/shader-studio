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
