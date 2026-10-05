/**
 * Ray-march banding fixes (compiler/marchJitter.ts): the even jitter's noise,
 * Volume Glow's / SDF Glow's Per distance weight, and that loops and glows
 * saved before them compile exactly as they did.
 */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});

import { compileGraph } from '../graphCompiler';
import { getNodeDefinition } from '../../nodes/definitions';
import { migrateNodeParams, type GraphNode } from '../../types/nodeGraph';
import { marchIGN, stepWeight, GLOW_UNIT_LENGTH } from '../marchJitter';
import { instantiateNode } from '../../nodes/scene3dDefaults';

const OLD_HASH = '_jh = fract(sin(dot(';

describe('even jitter noise (interleaved gradient noise)', () => {
  const N = 256;
  const vals: number[] = [];
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) vals.push(marchIGN(x + 0.5, y + 0.5));

  it('stays in 0..1', () => {
    for (const v of vals) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThan(1); }
  });

  it('is evenly distributed', () => {
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    expect(Math.abs(mean - 0.5)).toBeLessThan(0.01);
    const bins = new Array(16).fill(0);
    for (const v of vals) bins[Math.floor(v * 16)]++;
    const expected = vals.length / 16;
    for (const b of bins) expect(Math.abs(b - expected) / expected).toBeLessThan(0.1);
  });

  it('spreads over every small block of pixels (no flat patches that would read as bands)', () => {
    let worst = 1;
    for (let by = 0; by < N; by += 4) for (let bx = 0; bx < N; bx += 4) {
      let lo = 1, hi = 0;
      for (let y = by; y < by + 4; y++) for (let x = bx; x < bx + 4; x++) { const v = vals[y * N + x]; lo = Math.min(lo, v); hi = Math.max(hi, v); }
      worst = Math.min(worst, hi - lo);
    }
    expect(worst).toBeGreaterThan(0.6);
  });
});

describe('Per distance weight', () => {
  it('is 1 inside a shape at the default Passthrough, the step length in glow units outside, capped at 1 / falloff past it', () => {
    expect(stepWeight(-0.3, 0.1, 10)).toBeCloseTo(1);
    expect(stepWeight(0.05, 0.1, 10)).toBeCloseTo(1);
    expect(stepWeight(0.15, 0.1, 10)).toBeCloseTo(0.15 / GLOW_UNIT_LENGTH);
    expect(stepWeight(5, 0.1, 10)).toBeCloseTo((0.1 + 0.1) / GLOW_UNIT_LENGTH);
    // Passthrough 0 (some ports step by their own SDF): a tiny floor, never a divide by zero.
    expect(Number.isFinite(stepWeight(0, 0, 10))).toBe(true);
  });

  it('makes the glow along a ray (nearly) independent of Passthrough, where counting steps scales with 1 / Passthrough', () => {
    // The volumetric loop as compiled, in JS: a sphere, a ray through it, Volume Glow summed per step.
    const march = (pt: number, per: boolean) => {
      const density = 0.03, falloff = 10, r = 0.7;
      let t = 0.001, glow = 0;
      for (let i = 0; i < 400; i++) {
        const d = Math.hypot(0.3, -3 + t) - r;
        glow += density / (1 + falloff * Math.max(d, 0)) * (per ? stepWeight(d, pt, falloff) : 1);
        t += Math.max(d, pt);
        if (t > 8) break;
      }
      return glow;
    };
    expect(march(0.025, false) / march(0.1, false)).toBeGreaterThan(3);
    expect(Math.abs(march(0.025, true) / march(0.1, true) - 1)).toBeLessThan(0.05);
    // At the default Passthrough the brightness stays close to what counting gave.
    expect(Math.abs(march(0.1, true) / march(0.1, false) - 1)).toBeLessThan(0.1);
  });
});

// ── A volumetric loop graph ─────────────────────────────────────────────────

function graph(loopParams: Record<string, unknown>, glowParams: Record<string, unknown>, glowType: 'volumeGlow' | 'light' = 'volumeGlow'): GraphNode[] {
  const loopDef = getNodeDefinition('marchLoopGroup')!;
  const scene: GraphNode = {
    id: 'scene', type: 'sceneGroup', position: { x: 0, y: 0 }, inputs: {}, outputs: { scene: { type: 'scene3d', label: 'Scene' } },
    params: { subgraph: { nodes: [
      { id: 'sp', type: 'scenePos', position: { x: 0, y: 0 }, inputs: {}, outputs: { pos: { type: 'vec3', label: 'Position' } }, params: {} },
      { id: 'sph', type: 'sphereSDF3D', position: { x: 0, y: 0 }, inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'sp', outputKey: 'pos' } } }, outputs: { dist: { type: 'float', label: 'Distance' } }, params: { radius: 0.7 } },
    ], outputNodeId: 'sph', outputKey: 'dist', inputPorts: [], outputPorts: [] } },
  };
  const glow: GraphNode = glowType === 'volumeGlow'
    ? { id: 'vg', type: 'volumeGlow', position: { x: 0, y: 0 }, inputs: { dist: { type: 'float', label: 'Distance', connection: { nodeId: 'msd', outputKey: 'rawDist' } } }, outputs: { glow: { type: 'float', label: 'Glow' } }, params: glowParams, assignOp: '+=' }
    : { id: 'vg', type: 'light', position: { x: 0, y: 0 }, inputs: { distance: { type: 'float', label: 'Distance', connection: { nodeId: 'msd', outputKey: 'rawDist' } } }, outputs: { glow: { type: 'float', label: 'Glow' } }, params: glowParams, assignOp: '+=' };
  const loop: GraphNode = {
    id: 'mlg', type: 'marchLoopGroup', position: { x: 0, y: 0 },
    inputs: Object.fromEntries(Object.entries(loopDef.inputs).map(([k, v]) => [k, { type: v.type, label: v.label, ...(k === 'scene' ? { connection: { nodeId: 'scene', outputKey: 'scene' } } : {}) }])),
    outputs: { ...Object.fromEntries(Object.entries(loopDef.outputs).map(([k, v]) => [k, { type: v.type, label: v.label }])), acc0: { type: 'float', label: 'Glow' } },
    params: { maxSteps: 96, maxDist: 8, stepScale: 1, passthrough: 0.1, bg: [0, 0, 0], ...loopParams, subgraph: { nodes: [
      { id: 'mli', type: 'marchLoopInputs', position: { x: 0, y: 0 }, inputs: {}, outputs: { ro: { type: 'vec3', label: 'Ray Origin' }, rd: { type: 'vec3', label: 'Ray Dir' }, marchPos: { type: 'vec3', label: 'March Pos' }, marchDist: { type: 'float', label: 'March Dist' } }, params: { extraInputs: [] } },
      { id: 'msd', type: 'marchSceneDist', position: { x: 0, y: 0 }, inputs: { pos: { type: 'vec3', label: 'Position', connection: { nodeId: 'mli', outputKey: 'marchPos' } } }, outputs: { dist: { type: 'float', label: 'Distance' }, rawDist: { type: 'float', label: 'Raw Distance (unclipped)' } }, params: {} },
      glow,
    ], inputPorts: [], outputPorts: [] } },
  };
  const out: GraphNode = { id: 'out', type: 'output', position: { x: 0, y: 0 }, inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'mlg', outputKey: 'color' } } }, outputs: {}, params: {} };
  return [scene, loop, out];
}
const fs = (nodes: GraphNode[]) => { const r = compileGraph({ nodes }); expect(r.success, JSON.stringify(r.errors)).toBe(true); return r.fragmentShader; };

describe('saved graphs compile as before', () => {
  const OLD_LOOP = { volumetric: true, jitter: 0 };
  const OLD_GLOW = { density: 0.03, falloff: 10, shell: 0 };

  it('an old loop and glow: the old start, no even noise, no weight', () => {
    const s = fs(graph(OLD_LOOP, OLD_GLOW));
    expect(s).toContain(OLD_HASH);
    expect(s).not.toContain('marchIGN');
    expect(s).not.toMatch(/clamp\([^;]*\* 10\.0\)/);
  });

  it('migrating an old loop (v2, no jitter pattern) keeps the old pattern and the same GLSL', () => {
    const nodes = graph({ ...OLD_LOOP, _schemaVersion: 2 }, OLD_GLOW);
    const migrated = nodes.map(n => migrateNodeParams(n, getNodeDefinition));
    expect(migrated[1].params.jitterNoise).toBe('random');
    expect(fs(migrated)).toBe(fs(nodes));
  });

  it('an old loop with jitter keeps its sine-hash jitter', () => {
    const s = fs(graph({ volumetric: true, jitter: 0.5 }, OLD_GLOW));
    expect(s).toContain(OLD_HASH);
    expect(s).not.toContain('marchIGN');
  });

  it('a migrated new loop keeps the even jitter', () => {
    const nodes = graph({ volumetric: true, jitter: 1, jitterNoise: 'even' }, OLD_GLOW);
    expect(migrateNodeParams(nodes[1], getNodeDefinition).params.jitterNoise).toBe('even');
  });
});

describe('new loops and glows', () => {
  it('a newly added loop has the even jitter on; a newly added Volume Glow / SDF Glow has Per distance on', () => {
    const loop = instantiateNode('l', 'marchLoopGroup', getNodeDefinition('marchLoopGroup')!, { x: 0, y: 0 });
    expect(loop.params.jitter).toBe(1);
    expect(loop.params.jitterNoise).toBe('even');
    expect(loop.params.animateJitter).toBe(false);
    expect(instantiateNode('g', 'volumeGlow', getNodeDefinition('volumeGlow')!, { x: 0, y: 0 }).params.perDistance).toBe(true);
    expect(instantiateNode('s', 'light', getNodeDefinition('light')!, { x: 0, y: 0 }).params.perDistance).toBe(true);
  });

  it('even jitter: interleaved gradient noise on the pixel, spread over one Passthrough step in volumetric mode', () => {
    const s = fs(graph({ volumetric: true, jitter: 1, jitterNoise: 'even' }, { density: 0.03, falloff: 10, shell: 0 }));
    expect(s).toContain('float marchIGN(vec2 px)');
    expect(s).toMatch(/_jh = marchIGN\(gl_FragCoord\.xy\);/);
    expect(s).not.toContain(OLD_HASH);
    expect(s).toMatch(/> 0\.0 \?/); // Passthrough, or the average step when it is 0
  });

  it('Animate jitter moves the pattern every frame', () => {
    const s = fs(graph({ volumetric: true, jitter: 1, jitterNoise: 'even', animateJitter: true }, { density: 0.03, falloff: 10, shell: 0 }));
    expect(s).toContain('marchIGN(gl_FragCoord.xy + 5.588238 * mod(floor(u_time * 60.0), 64.0))');
  });

  it('Per distance weights Volume Glow by the step in a volumetric loop only', () => {
    const glow = { density: 0.03, falloff: 10, shell: 0, perDistance: true };
    const vol = fs(graph({ volumetric: true, jitter: 0 }, glow));
    expect(vol).toMatch(/_glow = .*\/ \(1\.0 \+ .*\) \* \(clamp\(.*_passthrough.*\* 10\.0\);/);
    const surf = fs(graph({ volumetric: false, jitter: 0 }, glow));
    expect(surf).not.toMatch(/_glow = .*\* \(clamp\(/);
    // Off: exactly the old line.
    const off = fs(graph({ volumetric: true, jitter: 0 }, { ...glow, perDistance: false }));
    expect(off).toBe(fs(graph({ volumetric: true, jitter: 0 }, { density: 0.03, falloff: 10, shell: 0 })));
  });

  it('Per distance on SDF Glow in a volumetric loop', () => {
    const s = fs(graph({ volumetric: true, jitter: 0 }, { mode: 'glow', brightness: 10, perDistance: true }, 'light'));
    expect(s).toMatch(/_glow \*= \(clamp\(/);
    const off = fs(graph({ volumetric: true, jitter: 0 }, { mode: 'glow', brightness: 10 }, 'light'));
    expect(off).not.toMatch(/_glow \*= /);
  });
});
