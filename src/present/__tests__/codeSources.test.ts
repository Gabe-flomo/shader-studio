/**
 * Where a Present code block's code comes from: a node type's code (helpers,
 * its lines in main() with its defaults, sockets, how it works), the parts of
 * a generated shader the "From a shader" picker lists, a Functions-library
 * preset as a function, and the code block's new fields surviving a save.
 */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  const mem = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, String(v)); }, removeItem: (k: string) => { mem.delete(k); },
    key: (i: number) => [...mem.keys()][i] ?? null, get length() { return mem.size; }, clear: () => mem.clear(),
  });
});
import { listNodeTypes, nodeCode, nodeCodeText } from '../nodeCode';
import { shaderRegions } from '../shaderRegions';
import { analyzeSnippet } from '../snippetHarness';
import { presetFunctionCode } from '../codePick';
import { emptyPresentation, parsePresentation, type CodeBlock } from '../../types/presentation';
import { buildPresentationHtml, exportNotes } from '../exportPresentation';
import { renderMarkdown } from '../markdown';

describe('nodeCode', () => {
  it('a node’s helper function, its line in main() with its defaults, and its sockets', () => {
    const info = nodeCode('circleSDF')!;
    expect(info.label).toBe('Circle SDF');
    expect(info.functions).toContain('float circleSDF(vec2 point, float size)');
    // UV is wired (g_uv) so the line reads as it does in a graph; the radius is the default.
    expect(info.body).toBe('float node_dist = circleSDF(g_uv - vec2(0.0, 0.0), 0.3);');
    expect(info.outputVars).toEqual({ distance: 'node_dist' });
    expect(info.inputs.map(i => [i.key, i.type])).toEqual([['position', 'vec2'], ['radius', 'float'], ['offset', 'vec2']]);
    expect(info.inputs[0].value).toBe('the position (g_uv)');
    expect(info.inputs[1].value).toBe('0.3');
    expect(info.outputs).toEqual([expect.objectContaining({ key: 'distance', type: 'float', value: 'node_dist' })]);
    expect(info.howItWorks).toMatch(/^Signed distance function for a circle\. Its work is done by the function circleSDF\(\)/);
  });

  it('settings that aren’t sockets are listed with their range and hint', () => {
    const info = nodeCode('circleSDF')!;
    expect(info.params.map(p => p.key)).toEqual(['posX', 'posY']);
    expect(info.params[0]).toMatchObject({ label: 'Center X', value: '0', range: '-1 to 1' });
  });

  it('time is wired where a node reads it', () => {
    expect(nodeCode('fbm')!.body).not.toContain('vec2(0.0) *');
  });

  it('inserts all or parts', () => {
    const info = nodeCode('circleSDF')!;
    expect(nodeCodeText(info, { functions: false, body: true, sockets: false })).toBe(info.body);
    const all = nodeCodeText(info, { functions: true, body: true, sockets: true });
    expect(all.startsWith('// Circle SDF (2D Primitives)\n// Inputs:\n//   vec2  UV = the position (g_uv)')).toBe(true);
    expect(all).toContain('// Outputs:\n//   float Distance = node_dist');
    expect(all).toContain('// In main(), with its default settings:\nfloat node_dist');
    // What it inserts can be previewed: the helper and the line both show.
    const a = analyzeSnippet(all);
    expect(a.options.map(o => o.id)).toEqual(['fn:circleSDF', 'var:node_dist']);
  });

  it('unknown types have no code', () => {
    expect(nodeCode('noSuchNode')).toBeNull();
  });

  it('lists node types with code of their own; a search ranks by name', () => {
    const all = listNodeTypes();
    expect(all.length).toBeGreaterThan(100);
    expect(all.some(n => n.type === 'circleSDF')).toBe(true);
    expect(all.every(n => nodeCode(n.type) !== null)).toBe(true);
    expect(listNodeTypes('circle sdf')[0].type).toBe('circleSDF');
  });
});

const SHADER = `precision highp float;
#define PI 3.1415926538

uniform vec2 u_resolution;
uniform float u_time;
uniform float u_p_n2_radius;
varying vec2 vUv;

// ── Always-available helpers (noise, rotation) ───────────────────────────────
float noiseHash1(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}
// ─────────────────────────────────────────────────────────────────────────

float circleSDF(vec2 point, float size) { return length(point) - size; }
float ring(vec2 p, float r) {
    return abs(circleSDF(p, r)) - 0.02;
}

void main() {
    vec2 g_uv = (vUv - 0.5) * 2.0;
    g_uv.x *= u_resolution.x / u_resolution.y;
    float n2_dist = circleSDF(g_uv, u_p_n2_radius);
    float n3_ring = ring(g_uv, n2_dist);
    vec3 n4_col = vec3(n3_ring);
    gl_FragColor = vec4(n4_col, 1.0);
}`;

describe('shaderRegions', () => {
  const nodes = [{ id: 'n2', label: 'Circle SDF', slug: 'n2' }, { id: 'n3', label: 'Ring', slug: 'n3' }, { id: 'n9', label: 'Gone', slug: 'n9' }];
  const regions = shaderRegions(SHADER, nodes);

  it('lists the whole shader, its declarations, its functions, main() and main() by node', () => {
    expect(regions.map(r => r.id)).toEqual(['whole', 'header', 'fn:noiseHash1:9', 'fn:circleSDF:14', 'fn:ring:15', 'main', 'node:n2', 'node:n3']);
    expect(regions.find(r => r.id === 'whole')!.text).toBe(SHADER);
  });

  it('marks the app’s own helpers', () => {
    expect(regions.find(r => r.label === 'noiseHash1()')!.builtin).toBe(true);
    expect(regions.find(r => r.label === 'ring()')!.builtin).toBeUndefined();
  });

  it('a function is its lines, with its signature', () => {
    const ring = regions.find(r => r.label === 'ring()')!;
    expect(ring.text).toBe('float ring(vec2 p, float r) {\n    return abs(circleSDF(p, r)) - 0.02;\n}');
    expect(ring.detail).toBe('float ring(vec2 p, float r) · 3 lines');
  });

  it('declarations stop before the first function', () => {
    const head = regions.find(r => r.kind === 'header')!;
    expect(head.text.startsWith('precision highp float;')).toBe(true);
    expect(head.text.endsWith('varying vec2 vUv;')).toBe(true);
  });

  it('a node’s lines within main() (the ones naming it, as the code panel marks them), a level of indent taken off', () => {
    const n3 = regions.find(r => r.id === 'node:n3')!;
    expect(n3.text).toBe('float n3_ring = ring(g_uv, n2_dist);\nvec3 n4_col = vec3(n3_ring);');
    expect(n3.label).toBe('Ring');
    // A node with no lines isn't offered.
    expect(regions.some(r => r.id === 'node:n9')).toBe(false);
  });

  it('main() is the whole function', () => {
    const main = regions.find(r => r.id === 'main')!;
    expect(main.text.startsWith('void main() {')).toBe(true);
    expect(main.text.endsWith('}')).toBe(true);
    expect(main.lines.length).toBe(8);
  });
});

describe('a Functions-library preset as a function', () => {
  const base = { id: 'cfp_1', savedAt: 1, inputs: [{ name: 'p', type: 'vec2' as const }], outputType: 'float' as const };
  it('a preset that calls its helper is its helpers', () => {
    const r = presetFunctionCode({ ...base, label: 'Blob', body: 'blob(p)', glslFunctions: 'float blob(vec2 p) {\n  return length(p);\n}' });
    expect(r).toEqual({ code: 'float blob(vec2 p) {\n  return length(p);\n}', name: 'blob', signature: 'float blob(vec2 p)' });
  });
  it('a preset with an expression body becomes a function of its inputs', () => {
    const r = presetFunctionCode({ ...base, label: 'Soft ring', body: 'abs(length(p) - 0.5)', glslFunctions: '' });
    expect(r.code).toBe('float Soft_ring(vec2 p) {\n  return abs(length(p) - 0.5);\n}');
    expect(analyzeSnippet(r.code).options[0].id).toBe('fn:Soft_ring');
  });
});

describe('the exported page', () => {
  const doc = () => {
    const p = emptyPresentation('Lesson', 0);
    p.steps[0].blocks.push({
      type: 'code', id: 'b1', language: 'glsl', code: 'float f(float x) { return x; }',
      origin: { kind: 'discovery', label: 'f() · Waves', note: 'Found in “Waves”, lines 3–5' },
      preview: { mode: 'plot' },
    });
    return p;
  };
  it('shows a preview as a still beside the code, with the credit under both', () => {
    const html = buildPresentationHtml(doc(), renderMarkdown, { layout: 'scroll', math: 'mathml', stills: { b1: 'data:image/png;base64,AAAA' } });
    expect(html).toContain('<div class="pp-code-pair"><figure class="pp-code">');
    expect(html).toContain('<img src="data:image/png;base64,AAAA" alt="What the code draws"');
    expect(html).toContain('<p class="pp-code-note">Found in “Waves”, lines 3–5</p>');
    expect(html).toContain('<span>f() · Waves</span>');
  });
  it('without a still the code stands alone; the notes say previews are stills', () => {
    const html = buildPresentationHtml(doc(), renderMarkdown, { layout: 'slides', math: 'mathml' });
    expect(html).not.toContain('<div class="pp-code-pair">');
    expect(exportNotes(doc())).toEqual([expect.objectContaining({ what: 'The code block’s preview' })]);
  });
});

describe('a code block’s origin and preview survive a save', () => {
  it('round-trips through parsePresentation, dropping what’s malformed', () => {
    const doc = emptyPresentation('Lesson', 0);
    const block: CodeBlock = {
      type: 'code', id: 'b1', language: 'glsl', code: 'float f(float x) { return x; }',
      origin: { kind: 'node', label: 'Circle SDF · node', note: 'The Circle SDF node’s code', nodeType: 'circleSDF', credit: { title: 'The Book of Shaders', url: 'https://thebookofshaders.com/07/' } },
      preview: { mode: 'plot', show: 'fn:f', range: { x: [-1, 1], y: [0, 2] }, values: { k: 0.5 } },
    };
    doc.steps[0].blocks.push(block, { ...block, id: 'b2', origin: { kind: 'bogus' } as never, preview: { mode: 'plot', range: { x: [2, 1], y: [0, 1] }, values: { 'bad name': 1 } } });
    const back = parsePresentation(JSON.parse(JSON.stringify(doc)));
    expect(back).not.toBeNull();
    const [b1, b2] = back!.steps[0].blocks as CodeBlock[];
    expect(b1.origin).toEqual(block.origin);
    expect(b1.preview).toEqual(block.preview);
    expect(b2.origin).toBeUndefined();
    expect(b2.preview).toEqual({ mode: 'plot' });
  });
});
