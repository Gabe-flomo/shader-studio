/**
 * Guided Convert: recognised patterns as library nodes (docs/guided-convert.md, "Recognised patterns").
 * The Explain panel's matcher finds the idioms in a selection; each becomes its library node, or a
 * plain block when turned down; the picture stays the same (the CPU pixel check), and a node that would
 * change it (the FBM node's own noise) isn't offered.
 */
import { describe, expect, it } from 'vitest';
import { analyse, type Analysis } from '../analyse';
import { buildGuided, type GuidedBuild } from '../build';
import { graphDifference, SAME } from '../check';
import { maxDifference } from '../cpuGlsl';
import { offersFor, recognisedChoices } from '../offers';
import { recognise } from '../recognise';
import { stage, type ConvertStep, type Step } from '../stage';
import { CONVERT_EXAMPLES } from '../../../glslToGraph/examples';
import type { GraphNode } from '../../../types/nodeGraph';

const INPUTS = { resolution: [64, 48] as [number, number], time: 1.3, mouse: [20, 30] as [number, number] };
function ok(src: string): Analysis { const a = analyse(src); if (!a.ok) throw new Error(a.error); return a; }
let seq = 0;
const nodesStep = (units: number[], recognised: ConvertStep['recognised'] = {}): ConvertStep => ({ kind: 'convert', id: `s${++seq}`, units, mode: 'nodes', name: 'step', chips: {}, recognised });
const all = (a: Analysis) => a.units.filter(u => !u.setup).map(u => u.index);
const kinds = (a: Analysis) => a.units.flatMap(u => recognise(a, u)).map(r => r.kind);
function built(a: Analysis, steps: Step[]): GuidedBuild {
  const b = buildGuided(a, steps);
  if (!b.ok) throw new Error(b.error);
  expect(b.compileErrors).toEqual([]);
  return b;
}
const types = (b: GuidedBuild): string[] => {
  const out: string[] = [];
  const walk = (list: GraphNode[]) => { for (const n of list) { out.push(n.type); const sg = n.params.subgraph as { nodes: GraphNode[] } | undefined; if (sg) walk(sg.nodes); } };
  walk(b.nodes);
  return out;
};
const shader = (lines: string, helpers = '') => `${helpers}\nvoid main() {\n  vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution.xy) / u_resolution.y;\n${lines}\n}`;

/** Each snippet: what the matcher should find in it, and the library node that should end up in the graph. */
const SNIPPETS: { name: string; src: string; kind: string; node: string }[] = [
  { name: 'soft disc', kind: 'softDisc', node: 'sdfMask', src: shader('  float m = 1.0 - smoothstep(0.3, 0.32, length(uv));\n  gl_FragColor = vec4(vec3(m), 1.0);') },
  { name: 'soft disc, edges reversed', kind: 'softDisc', node: 'circleSDF', src: shader('  float m = smoothstep(0.32, 0.3, length(uv - vec2(0.1, 0.0)));\n  gl_FragColor = vec4(vec3(m), 1.0);') },
  { name: 'soft circle', kind: 'softCircle', node: 'smoothstep', src: shader('  float m = smoothstep(0.25, 0.25 + 0.05, length(uv));\n  gl_FragColor = vec4(vec3(m), 1.0);') },
  { name: 'circle SDF', kind: 'circle', node: 'circleSDF', src: shader('  float d = length(uv) - 0.3;\n  gl_FragColor = vec4(vec3(abs(d) * 2.0), 1.0);') },
  { name: 'ring', kind: 'ring', node: 'ringSDF', src: shader('  float d = abs(length(uv) - 0.3) - 0.02;\n  gl_FragColor = vec4(vec3(smoothstep(0.01, 0.0, d)), 1.0);') },
  { name: 'box helper', kind: 'box', node: 'boxSDF', src: shader('  float d = box(uv, vec2(0.3, 0.2));\n  gl_FragColor = vec4(vec3(smoothstep(0.01, 0.0, d)), 1.0);', 'float box(vec2 p, vec2 b) {\n  vec2 d = abs(p) - b;\n  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);\n}') },
  { name: 'rotation inline', kind: 'rotate', node: 'transform', src: shader('  float a = u_time * 0.5;\n  vec2 p = mat2(cos(a), -sin(a), sin(a), cos(a)) * uv;\n  gl_FragColor = vec4(fract(p * 3.0), 0.0, 1.0);') },
  { name: 'rotation, *=', kind: 'rotate', node: 'transform', src: shader('  float a = 0.7;\n  uv *= mat2(cos(a), sin(a), -sin(a), cos(a));\n  gl_FragColor = vec4(fract(uv * 3.0), 0.0, 1.0);') },
  { name: 'tiles, centred', kind: 'tileCentred', node: 'fract', src: shader('  vec2 g = fract(uv * 4.0) - 0.5;\n  gl_FragColor = vec4(abs(g), 0.0, 1.0);') },
  { name: 'tiles', kind: 'tile', node: 'gridUV', src: shader('  vec2 g = fract(uv * 5.0);\n  gl_FragColor = vec4(g, 0.0, 1.0);') },
  { name: 'cell id', kind: 'cellId', node: 'fract', src: shader('  vec2 id = floor(uv * 6.0);\n  gl_FragColor = vec4(fract(id * 0.13), 0.0, 1.0);') },
  { name: 'iq palette', kind: 'palette', node: 'palette', src: shader('  float t = length(uv) + u_time * 0.1;\n  vec3 col = vec3(0.5) + vec3(0.5) * cos(6.28318 * (vec3(1.0) * t + vec3(0.0, 0.33, 0.67)));\n  gl_FragColor = vec4(col, 1.0);') },
  { name: 'palette helper', kind: 'palette', node: 'palette', src: shader('  vec3 col = pal(length(uv) * 2.0);\n  gl_FragColor = vec4(col, 1.0);', 'vec3 pal(float t) {\n  vec3 a = vec3(0.5, 0.5, 0.5);\n  vec3 b = vec3(0.5, 0.5, 0.5);\n  vec3 c = vec3(1.0, 1.0, 1.0);\n  vec3 d = vec3(0.0, 0.1, 0.2);\n  return a + b * cos(6.28318 * (c * t + d));\n}') },
  { name: 'remap', kind: 'remap', node: 'remap', src: shader('  float r = length(uv);\n  float lo = 0.2 + 0.1 * sin(u_time);\n  float k = (r - lo) / (0.6 - lo);\n  gl_FragColor = vec4(vec3(k), 1.0);') },
  { name: 'clamped remap', kind: 'saturateRemap', node: 'remap', src: shader('  float r = length(uv);\n  float edge = 0.1;\n  float k = clamp((r - edge) / (0.5 - edge), 0.0, 1.0);\n  gl_FragColor = vec4(vec3(k), 1.0);') },
  { name: 'smoothstep by hand', kind: 'smoothCurve', node: 'smoothstep', src: shader('  float x = clamp(length(uv) * 1.5, 0.0, 1.0);\n  float s = x * x * (3.0 - 2.0 * x);\n  gl_FragColor = vec4(vec3(s), 1.0);') },
  { name: 'mix by hand', kind: 'lerp', node: 'mix', src: shader('  float t = clamp(uv.x + 0.5, 0.0, 1.0);\n  vec3 col = vec3(0.1, 0.2, 0.3) + (vec3(0.9, 0.6, 0.2) - vec3(0.1, 0.2, 0.3)) * t;\n  gl_FragColor = vec4(col, 1.0);') },
  { name: 'clamp by min and max', kind: 'clamp01', node: 'clamp', src: shader('  float v = min(max(uv.x * 2.0, 0.0), 1.0);\n  gl_FragColor = vec4(vec3(v), 1.0);') },
];

describe('recognised patterns', () => {
  it('finds the idiom in each snippet', () => {
    for (const s of SNIPPETS) expect(kinds(ok(s.src)), s.name).toContain(s.kind);
  });
  it('finds nothing in a plain line', () => {
    expect(kinds(ok(shader('  float v = uv.x * uv.y + sin(u_time);\n  gl_FragColor = vec4(vec3(v), 1.0);')))).toEqual([]);
  });
  it('the cut-out call keeps the staged shader the same picture', () => {
    for (const s of SNIPPETS) {
      const a = ok(s.src);
      const recs = a.units.flatMap(u => recognise(a, u));
      const st = stage(a, [nodesStep(all(a), Object.fromEntries(recs.map(r => [r.id, 'node' as const])))]);
      if ('error' in st) throw new Error(`${s.name}: ${st.error}`);
      expect(st.calls.length, s.name).toBe(recs.length);
      expect(maxDifference(a.norm, st.code, INPUTS), s.name).toBeLessThan(1e-9);
    }
  });
  it('becomes its library node, and the graph is the same picture as the shader', () => {
    for (const s of SNIPPETS) {
      const a = ok(s.src);
      const draft = nodesStep(all(a));
      const offers = offersFor(a, [], draft);
      const offer = offers.find(o => o.rec.kind === s.kind)!;
      expect(offer, s.name).toBeDefined();
      expect(offer.ok, `${s.name}: ${offer.why}`).toBe(true);
      const b = built(a, [{ ...draft, recognised: recognisedChoices(offers, new Set()) }]);
      expect(types(b), s.name).toContain(s.node);
      expect(b.recognised.find(r => r.id === offer.rec.id)?.as, s.name).toBe('node');
      expect(graphDifference(a, b), s.name).toBeLessThanOrEqual(SAME);
    }
  }, 60_000);
  it('turned down, it is one plain Expression Block holding the pattern, still the same picture', () => {
    const a = ok(SNIPPETS[0].src);
    const [rec] = a.units.flatMap(u => recognise(a, u));
    const b = built(a, [nodesStep(all(a), { [rec.id]: 'block' })]);
    const block = b.nodes.find(n => n.id === b.recognised[0].nodeId)!;
    expect(block.type).toBe('exprNode');
    expect(String(block.params.expr)).toMatch(/smoothstep\(r, 0\.32, length\(p\)\)/);
    expect(types(b)).not.toContain('circleSDF');
    expect(graphDifference(a, b)).toBeLessThanOrEqual(SAME);
  });
  it('says what it found, in words, with its line', () => {
    const a = ok(SNIPPETS[0].src);
    const [rec] = a.units.flatMap(u => recognise(a, u));
    expect([rec.what, rec.node, rec.line, rec.code]).toEqual(['a soft disc', 'Circle SDF + SDF Mask', 4, '1.0 - smoothstep(0.3, 0.32, length(uv))']);
    // The numbers it swallows aren't chips any more; the radius and softness come in as its arguments.
    expect(rec.params.map(p => p.name)).toEqual(['p', 'r', 'w']);
  });
  it('a helper call whose body is fractal noise is recognised, but the FBM node isn’t offered: its noise differs', () => {
    const a = ok(CONVERT_EXAMPLES.shadertoy.code);
    const unit = a.units.find(u => /fbm\(/.test(u.text))!;
    const recs = recognise(a, unit);
    expect(recs.map(r => [r.kind, r.what, r.fbm])).toEqual([['fbm', 'fbm() is fractal noise (fbm)', { octaves: 5, gain: 0.5, lacunarity: 2 }]]);
    const [offer] = offersFor(a, [], nodesStep([unit.index]));
    expect(offer.ok).toBe(false);
    expect(offer.why).toMatch(/the picture would change/);
  });
  it('a pattern inside an opened helper’s body becomes the node inside its group', () => {
    const src = shader('  float d = circ(uv, 0.3);\n  gl_FragColor = vec4(vec3(smoothstep(0.01, 0.0, d)), 1.0);', 'float circ(vec2 p, float r) {\n  return length(p) - r;\n}');
    const a = ok(src);
    const h = a.helpers[0];
    const draft: ConvertStep = { ...nodesStep([0]), fn: h.name };
    const steps: Step[] = [{ kind: 'helper', id: 'h', fn: h.name, name: h.name, callers: h.callers }];
    const offers = offersFor(a, steps, draft);
    expect(offers.map(o => [o.rec.kind, o.ok])).toEqual([['circle', true]]);
    const b = built(a, [...steps, { ...draft, recognised: recognisedChoices(offers, new Set()) }]);
    const group = b.nodes.find(n => n.type === 'group')!;
    expect((group.params.subgraph as { nodes: GraphNode[] }).nodes.map(n => n.type)).toContain('circleSDF');
    expect(graphDifference(a, b)).toBeLessThanOrEqual(SAME);
  });
  it('the Convert examples: every offered pattern keeps the picture', () => {
    for (const [name, ex] of Object.entries(CONVERT_EXAMPLES)) {
      const a = ok(ex.code);
      const draft = nodesStep(all(a));
      const offers = offersFor(a, [], draft);
      const b = buildGuided(a, [{ ...draft, recognised: recognisedChoices(offers, new Set()) }]);
      expect(b.ok, name).toBe(true);
      if (b.ok) { const d = graphDifference(a, b); if (d !== null) expect(d, name).toBeLessThanOrEqual(SAME); }
    }
  }, 60_000);
});
