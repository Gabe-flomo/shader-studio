/**
 * March Camera Lens: Smooth (compiler/smoothDofExpand.ts, nodes/definitions/lensDof.ts): the picture drawn
 * once into a hidden Pass with its CoC in alpha, then gathered in the final program. Grain compiles as before.
 */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});

import { parser } from '@shaderfrog/glsl-parser';
import { compileGraph } from '../graphCompiler';
import { getNodeDefinition, resolveNodeAliases } from '../../nodes/definitions';
import { EXAMPLE_GRAPHS } from '../../store/exampleGraphs';
import { buildStandaloneGraph } from '../../sceneBuilder/build';
import { starterSpec } from '../../sceneBuilder/spec';
import { lensCoc } from '../../nodes/definitions/lensDof';
import { dofPassId, expandSmoothDof } from '../smoothDofExpand';
import { webPasses } from '../../play/webInput';
import { migrateNodeParams, type GraphNode } from '../../types/nodeGraph';

const parses = (fs: string) => expect(() => parser.parse(fs.replace(/^#version.*$/m, ''), { quiet: true })).not.toThrow();

const orbs = () => resolveNodeAliases(structuredClone(EXAMPLE_GRAPHS.dofOrbitOrbs.nodes), getNodeDefinition);
const withLens = (nodes: GraphNode[], params: Record<string, unknown>) =>
  nodes.map(n => (n.type === 'marchCamera' ? { ...n, params: { ...n.params, ...params } } : n));

function smoothCompiles(nodes: GraphNode[]) {
  const r = compileGraph({ nodes });
  expect(r.errors ?? []).toEqual([]);
  expect(r.success).toBe(true);
  const cam = nodes.find(n => n.type === 'marchCamera')!;
  const pass = (r.passes ?? []).find(p => p.nodeId === dofPassId(cam.id));
  expect(pass).toBeTruthy();
  expect(pass!.label).toBe('Smooth lens');
  // The pass draws the scene through the pinhole, with the CoC in alpha; the final program gathers it.
  expect(pass!.fragmentShader).toContain('_dofK');
  expect(pass!.fragmentShader).not.toMatch(/_h1\s*=/);
  expect(r.fragmentShader).toContain('lensDofGather(');
  expect(r.fragmentShader).not.toContain('_dofK');
  parses(pass!.fragmentShader);
  parses(r.fragmentShader);
  return r;
}

describe('March Camera Lens: Smooth', () => {
  it('CoC: thin-lens radius in picture heights, zero at the focus, signed by side', () => {
    expect(lensCoc(0.1, 1.5, 3, 3)).toBeCloseTo(0, 10);
    // 0.5 · A · FOV · (1/f − 1/d)
    expect(lensCoc(0.1, 1.5, 3, 6)).toBeCloseTo(0.5 * 0.1 * 1.5 * (1 / 3 - 1 / 6), 10);
    expect(lensCoc(0.1, 1.5, 3, 1.5)).toBeLessThan(0);
    expect(lensCoc(0.1, 1.5, 3, 1e9)).toBeCloseTo(0.5 * 0.1 * 1.5 / 3, 6);
    // Increasing with distance (so comparing CoCs compares depths), and linear in Aperture.
    expect(lensCoc(0.1, 1.5, 3, 5)).toBeGreaterThan(lensCoc(0.1, 1.5, 3, 4));
    expect(lensCoc(0.2, 1.5, 3, 8)).toBeCloseTo(2 * lensCoc(0.1, 1.5, 3, 8), 10);
    expect(lensCoc(0, 1.5, 3, 8)).toBe(0);
  });

  it('Grain (and a camera saved before Lens) compiles exactly as before, with no pass', () => {
    const before = compileGraph({ nodes: orbs() });
    const grain = compileGraph({ nodes: withLens(orbs(), { lens: 'grain', dofSamples: '64', dofShape: 'hex' }) });
    expect(grain.fragmentShader).toBe(before.fragmentShader);
    expect(grain.paramUniforms).toEqual(before.paramUniforms);
    expect(grain.passes ?? []).toEqual([]);
    expect(expandSmoothDof(withLens(orbs(), { lens: 'grain' }))).toHaveLength(orbs().length);
  });

  it('a saved camera migrates to Grain; a new one starts on Grain too', () => {
    const cam = orbs().find(n => n.type === 'marchCamera')!;
    expect(migrateNodeParams(cam, getNodeDefinition).params.lens).toBe('grain');
    expect(migrateNodeParams({ ...cam, params: { ...cam.params, lens: 'smooth' } }, getNodeDefinition).params.lens).toBe('smooth');
    expect(getNodeDefinition('marchCamera')!.defaultParams?.lens).toBe('grain');
  });

  it('Smooth adds the hidden pass and compiles (the DoF example: Scene Group + March Loop Group)', () => {
    smoothCompiles(withLens(orbs(), { lens: 'smooth' }));
  });

  it('every quality, shape and Max blur compiles', () => {
    for (const dofSamples of ['16', '32', '64']) for (const dofShape of ['disc', 'hex', 'oct']) {
      const r = smoothCompiles(withLens(orbs(), { lens: 'smooth', dofSamples, dofShape, dofMaxBlur: 8 }));
      expect(r.fragmentShader).toContain(`, ${dofSamples});`);
    }
  });

  it('a builder-built scene (surface and GI) compiles with Smooth', () => {
    for (const mode of ['surface', 'gi'] as const) {
      const spec = starterSpec();
      spec.look.mode = mode;
      const g = buildStandaloneGraph(spec);
      const nodes = withLens(g.nodes, { lens: 'smooth', aperture: 0.1 });
      const r = smoothCompiles(nodes);
      // Everything the picture had runs once, in the pass: the final program has no march.
      expect(r.fragmentShader).not.toMatch(/mapScene_/);
    }
  });

  it('the web export carries the pass (same programs as the app and recordings)', () => {
    const r = smoothCompiles(withLens(orbs(), { lens: 'smooth' }));
    const web = webPasses(r.passes ?? []);
    expect(web.some(p => p.fragmentShader.includes('_dofK'))).toBe(true);
  });

  it('stays Grain where it can\'t open: no Output colour, or a camera wired into no march', () => {
    const noOut = withLens(orbs(), { lens: 'smooth' }).map(n => (n.type === 'output' ? { ...n, inputs: { color: { ...n.inputs.color, connection: undefined } } } : n));
    expect(expandSmoothDof(noOut)).toBe(noOut);
    const r = compileGraph({ nodes: noOut });
    expect(r.success).toBe(true);
    expect(r.passes ?? []).toEqual([]);
  });
});

describe('March Camera Lens: Soft grain, and the grain cap', () => {
  it('Soft grain keeps the grain rays and blurs over them with a lighter CoC (Softness)', () => {
    const r = compileGraph({ nodes: withLens(orbs(), { lens: 'soft', aperture: 0.12, softness: 0.4 }) });
    expect(r.errors ?? []).toEqual([]);
    const cam = orbs().find(n => n.type === 'marchCamera')!;
    const pass = (r.passes ?? []).find(p => p.nodeId === dofPassId(cam.id))!;
    expect(pass.label).toBe('Soft grain lens');
    // Grain rays (the per-pixel lens hash) AND the CoC hand-over, scaled by Softness
    expect(pass.fragmentShader).toMatch(/_h1\s*=/);
    expect(pass.fragmentShader).toMatch(/_dofK\s*=\s*min\([^;]*_softness;/);
    expect(r.fragmentShader).toContain('lensDofGather(');
    parses(pass.fragmentShader);
    parses(r.fragmentShader);
  });
  it('the grain lens is capped at 6% of Focal Dist, so a near focus no longer blows the picture into noise', () => {
    const r = compileGraph({ nodes: withLens(orbs(), { lens: 'grain', aperture: 0.5, focalDist: 0.2 }) });
    expect(r.errors ?? []).toEqual([]);
    expect(r.fragmentShader).toMatch(/_lr\s*=\s*min\([^,]+, 0\.06 \* max\(/);
  });
});
