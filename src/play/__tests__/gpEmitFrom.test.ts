/**
 * Particles born from a Pass (docs/pass-node-plan.md, phase 6): the Particles
 * node's Emit from socket. Unwired, the node compiles exactly as before (its
 * declaration line, GP_MARK, is the same text and no other line is added);
 * wired, one comment names the texture, the engine finds it, the passes it
 * reads draw before the particles step, and births land only where the
 * texture is bright (gpFromBirth, the simulation's search in JS).
 */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});

import { compileGraph } from '../../compiler/graphCompiler';
import { EXAMPLE_GRAPHS } from '../../store/exampleGraphs';
import { getNodeDefinition, resolveNodeAliases } from '../../nodes/definitions';
import { n } from '../../store/graphBuilder';
import { GP_FROM_MARK, GP_FROM_TRIES, GP_SHADERS, GP_SIM_FROM_SHADER, gpBindings, gpFromBirth } from '../kit/gpuParticles.js';
import type { GraphNode } from '../../types/nodeGraph';

/** uv → circle → Pass A → Edges → Pass B (½) → Particles (Emit from), over Pass A's picture. */
function edgesGraph(wired = true): GraphNode[] {
  return [
    n('uv', 'node_1', 0, 0),
    n('circleSDF', 'node_2', 0, 0, { radius: 0.4 }, { position: ['node_1', 'uv'] }),
    n('floatToVec3', 'node_3', 0, 0, {}, { input: ['node_2', 'distance'] }),
    n('pass', 'node_4', 0, 0, {}, { color: ['node_3', 'rgb'] }),
    n('edgesTexture', 'node_5', 0, 0, {}, { texture: ['node_4', 'texture'] }),
    n('floatToVec3', 'node_6', 0, 0, {}, { input: ['node_5', 'edges'] }),
    n('pass', 'node_7', 0, 0, { scale: '0.5' }, { color: ['node_6', 'rgb'] }),
    n('gpuParticles', 'node_8', 0, 0, { count: '64k' }, { over: ['node_4', 'color'], ...(wired ? { emitFrom: ['node_7', 'texture'] } : {}) }),
    n('output', 'node_9', 0, 0, {}, { color: ['node_8', 'color'] }),
  ];
}

const markLines = (fs: string) => fs.split('\n').filter(l => l.includes('// gpu-particles'));

describe('Particles: Emit from a Pass', () => {
  it('unwired, the node writes exactly what it wrote before (no Emit from line)', () => {
    const r = compileGraph({ nodes: edgesGraph(false) });
    expect(r.errors).toBeUndefined();
    expect(r.fragmentShader).not.toContain(GP_FROM_MARK);
    expect(gpBindings(r.fragmentShader)[0]).not.toHaveProperty('from');
    // And the passes draw as before: nothing is marked to draw before the particles.
    expect(r.passes!.some(p => 'beforeParticles' in p)).toBe(false);
  });

  it('wired, one comment names the texture; the declaration line is unchanged', () => {
    const off = compileGraph({ nodes: edgesGraph(false) });
    const on = compileGraph({ nodes: edgesGraph(true) });
    expect(on.errors).toBeUndefined();
    const passB = on.passes!.find(p => p.nodeId === 'node_7')!;
    const lines = markLines(on.fragmentShader);
    expect(lines.filter(l => l.includes(GP_FROM_MARK))).toEqual([`    ${GP_FROM_MARK}u_gpup_gpuparticlx8 u_pass_${passB.slug}`]);
    // The GP_MARK declaration (settings, picture, probe) is the same text either way.
    expect(lines.filter(l => !l.includes(GP_FROM_MARK))).toEqual(markLines(off.fragmentShader));
    const [b] = gpBindings(on.fragmentShader);
    expect(b.from).toBe(`u_pass_${passB.slug}`);
    // The final program declares the sampler the engine samples.
    expect(on.fragmentShader).toContain(`uniform sampler2D u_pass_${passB.slug};`);
  });

  it('the passes the particles read (and what those read) draw before them', () => {
    const r = compileGraph({ nodes: edgesGraph(true) });
    expect(r.passes!.map(p => [p.nodeId, !!p.beforeParticles])).toEqual([['node_4', true], ['node_7', true]]);
  });

  it('a pass that has a Particles node in it draws after them (it reads them)', () => {
    const nodes = edgesGraph(true);
    // A second Particles node feeding Pass A: Pass A (and B, which reads it) can't draw before the particles.
    nodes.push(n('gpuParticles', 'node_10', 0, 0, { count: '64k' }));
    nodes[3] = n('pass', 'node_4', 0, 0, {}, { color: ['node_10', 'color'] });
    const r = compileGraph({ nodes });
    expect(r.errors).toBeUndefined();
    expect(r.passes!.some(p => p.beforeParticles)).toBe(false);
    // Its Particles node is in Pass A's program, where the engine now finds it too.
    expect(r.passes![0].fragmentShader).toContain('// gpu-particles {');
  });

  it('births land only where the texture is bright, more where it is brighter', () => {
    // A texture bright (1) on a thin ring, dim (0.4) in a square, black elsewhere.
    const sample = (u: number, v: number) => {
      const r = Math.hypot(u - 0.5, v - 0.5);
      if (Math.abs(r - 0.3) < 0.02) return [1, 1, 1, 1];
      if (u < 0.2 && v < 0.2) return [0.4, 0.4, 0.4, 1];
      return [0, 0, 0, 1];
    };
    let ring = 0, square = 0, none = 0;
    for (let i = 0; i < 4000; i++) {
      const at = gpFromBirth(sample, i, 7, 0.1);
      if (!at) { none++; continue; }
      const c = sample(at[0], at[1]);
      expect(c[0]).toBeGreaterThanOrEqual(0.4);
      if (c[0] === 1) ring++; else square++;
    }
    expect(ring + square + none).toBe(4000);
    // The ring is about 3.8% of the picture and the square 4%, but the ring is kept 2.5 times as often.
    expect(ring).toBeGreaterThan(square * 1.8);
    // Above the dim square's brightness, only the ring gets births.
    for (let i = 0; i < 2000; i++) {
      const at = gpFromBirth(sample, i, 3, 0.5);
      if (at) expect(sample(at[0], at[1])[0]).toBe(1);
    }
    // A black texture: nobody is born.
    expect(gpFromBirth(() => [0, 0, 0, 1], 5, 1, 0.1)).toBeNull();
    // Deterministic: the same particle and substep land in the same place.
    expect(gpFromBirth(sample, 123, 9, 0.1)).toEqual(gpFromBirth(sample, 123, 9, 0.1));
  });

  it('the Emit from simulation is GP_SIM with only its births changed', () => {
    expect(GP_SIM_FROM_SHADER).not.toBe(GP_SHADERS.GP_SIM);
    expect(GP_SIM_FROM_SHADER).toContain('void gpSpawnShape(float i, vec4 H, out vec4 P, out vec4 V) {');
    expect(GP_SIM_FROM_SHADER).toContain(`for (int k = 0; k < ${GP_FROM_TRIES}; k++)`);
    // Everything before the births and the whole step after them are GP_SIM's own text.
    const sim = GP_SHADERS.GP_SIM;
    const cut = sim.indexOf('void gpSpawn(');
    expect(GP_SIM_FROM_SHADER.startsWith(sim.slice(0, cut))).toBe(true);
    expect(GP_SIM_FROM_SHADER.endsWith(sim.slice(sim.indexOf('\nvoid main() {')))).toBe(true);
  });

  it('an Agents group\'s Emit takes a Pass texture as its Picture, and the pass draws before the agents', () => {
    const nodes = resolveNodeAliases(structuredClone(EXAMPLE_GRAPHS.passSlimeEdges.nodes), getNodeDefinition);
    const emit = nodes.find(nd => nd.id === 'gpEmit')!;
    emit.params = { ...emit.params, shape: 'picture' };
    emit.inputs = { ...emit.inputs, where: { ...emit.inputs.where, connection: undefined }, picture: { ...emit.inputs.picture, connection: { nodeId: 'gpPass', outputKey: 'texture' } } };
    const r = compileGraph({ nodes });
    expect(r.errors).toBeUndefined();
    const pass = r.passes!.find(p => p.nodeId === 'gpPass')!;
    expect(r.agents!.groups[0].readsPasses).toContain(pass.slug);
    expect(pass.afterAgents).toBe(false);
    expect(r.agents!.groups[0].fragmentShader).toContain(`u_pass_${pass.slug}`);
  });

  it('Passes 6 · Slime along edges: the trail\'s Add and the births read the pass, drawn before the agents', () => {
    const r = compileGraph({ nodes: resolveNodeAliases(EXAMPLE_GRAPHS.passSlimeEdges.nodes, getNodeDefinition) });
    expect(r.errors).toBeUndefined();
    const pass = r.passes!.find(p => p.nodeId === 'gpPass')!;
    expect(pass.afterAgents).toBe(false);
    expect(r.agents!.trails[0].readsPasses).toContain(pass.slug);
    expect(r.agents!.groups[0].readsPasses).toContain(pass.slug);
  });
});
