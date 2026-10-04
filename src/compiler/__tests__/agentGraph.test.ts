/**
 * The Agents family's compile (docs/agents-plan.md §3, §4, §14): the programs a
 * graph with an Agents group becomes, the update shader's prelude and sink,
 * the Trail → group loop, slug stability, and the rules for the inside.
 * Graphs without one are covered by goldenShaders.test.ts.
 */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});

import { compileGraph } from '../graphCompiler';
import { hasAgentsNode } from '../agentGraph';
import { slimeMoldNodes } from '../../store/agentExamples';
import { n } from '../../store/graphBuilder';
import type { GraphNode, SubgraphData } from '../../types/nodeGraph';

const slime = () => slimeMoldNodes(0, 0);
const inside = (nodes: GraphNode[], groupId = 'slime') => (nodes.find(x => x.id === groupId)!.params.subgraph as SubgraphData).nodes;
/** Replace the group's inside. */
function withInside(nodes: GraphNode[], f: (inner: GraphNode[]) => GraphNode[]): GraphNode[] {
  return nodes.map(x => x.id === 'slime' ? { ...x, params: { ...x.params, subgraph: { ...(x.params.subgraph as SubgraphData), nodes: f(inside(nodes)) } } } : x);
}

describe('Agents compile', () => {
  it('finds the family at any depth', () => {
    expect(hasAgentsNode(slime())).toBe(true);
    expect(hasAgentsNode([n('uv', 'u', 0, 0)])).toBe(false);
  });

  it('makes one update shader, a deposit, a trail and a final picture that samples the trail', () => {
    const r = compileGraph({ nodes: slime() });
    expect(r.errors).toBeUndefined();
    expect(r.success).toBe(true);
    const a = r.agents!;
    expect(a.groups).toHaveLength(1);
    expect(a.deposits).toHaveLength(1);
    expect(a.trails).toHaveLength(1);
    expect(a.draws).toHaveLength(0);
    const [g] = a.groups;
    const [t] = a.trails;
    expect(g).toMatchObject({ nodeId: 'slime', side: 1024, species: 1, emit: { mode: 'fill' }, live: true });
    expect(g.readsTrails).toEqual([t.slug]);
    expect(a.deposits[0]).toMatchObject({ group: g.slug, trail: t.slug });
    expect(t).toMatchObject({ scale: null, rows: 1024, edges: 'wrap', live: true });
    // The final picture samples the trail and compiles neither the group nor the Deposit nor the Emit.
    expect(r.fragmentShader).toContain(`uniform sampler2D u_trail_${t.slug};`);
    expect(r.fragmentShader).not.toContain('agentStepOut');
    expect(r.fragmentShader).not.toContain('o_a');
    // The engine's settings are the uniforms the sliders write.
    expect(t.params.halfLife).toBe(r.paramBindings['slimeTrail::halfLife']);
    expect(g.params.stepsPerFrame).toBe(r.paramBindings['slime::stepsPerFrame']);
    expect(a.deposits[0].params.amount).toBe(r.paramBindings['slimeDeposit::amount']);
  });

  it('compiles the inside as a GLSL 3 update shader with the agent prelude, the birth block and the rule', () => {
    const r = compileGraph({ nodes: slime() });
    const fs = r.agents!.groups[0].fragmentShader;
    const slug = r.agents!.groups[0].slug;
    expect(fs).toMatch(/^precision highp float;\nprecision highp int;/);
    expect(fs).toContain('layout(location = 0) out highp vec4 o_a;');
    expect(fs).toContain('layout(location = 1) out highp vec4 o_b;');
    expect(fs).toContain(`uniform sampler2D u_agA_${slug};`);
    expect(fs).toContain(`uniform highp uint u_agStep_${slug};`);
    expect(fs).toContain('const int a_side = 1024;');
    expect(fs).not.toContain('g_uv = (vUv - 0.5) * 2.0');
    expect(fs).toContain('vec2 g_uv = a_pos;');
    expect(fs).not.toContain('gl_FragColor');
    // The prelude skips the dead before any of the rule runs.
    const main = fs.slice(fs.indexOf('void main()'));
    expect(main.indexOf('if (!a_born && a_sB.w <= 0.0)')).toBeLessThan(main.indexOf('slimeSense') === -1 ? main.length : main.indexOf('agDir('));
    // The rule: three sensor points on the trail texture, the Jones branches, the move, the writes.
    const t = r.agents!.trails[0].slug;
    expect((main.match(new RegExp(`texture\\(u_trail_${t}, agUv\\(`, 'g')) ?? []).length).toBeGreaterThanOrEqual(3);
    expect(main).toContain('else if (');
    expect(main).toContain('if (a_born) {');
    expect(main).toMatch(/o_a = agentemit\w*_em_a; o_b = agentemit\w*_em_b;/);
    expect(main).toContain('o_b = vec4(');
    // The trail read inside the group is the same sampler the picture reads (bound to the step before by the engine).
    expect(fs).toContain(`uniform sampler2D u_trail_${t};`);
  });

  it('names a node\'s uniforms the same in every program it lands in', () => {
    const r = compileGraph({ nodes: slime() });
    const angle = r.paramBindings['slimeSense::angle'];
    expect(angle).toBeTruthy();
    expect(r.agents!.groups[0].fragmentShader).toContain(`uniform float ${angle};`);
    const seed = r.paramBindings['slime::seed'];
    expect(r.agents!.groups[0].fragmentShader).toContain(`uniform float ${seed};`);
    expect(r.nodeSlugMap?.get('slimeSense')).toBeTruthy();
  });

  it('an empty group compiles to "keep state" (stand still)', () => {
    const nodes = withInside(slime(), inner => inner.filter(x => x.type === 'agentInputs' || x.type === 'agentOutput').map(x =>
      x.type === 'agentOutput' ? { ...x, inputs: Object.fromEntries(Object.entries(x.inputs).map(([k, i]) => [k, { type: i.type, label: i.label }])) } : x));
    const r = compileGraph({ nodes });
    expect(r.errors).toBeUndefined();
    const main = r.agents!.groups[0].fragmentShader.slice(r.agents!.groups[0].fragmentShader.indexOf('void main()'));
    expect(main).toMatch(/vec2 \w+_p = a_pos;/);
    expect(main).toMatch(/float \w+_h = a_heading;/);
  });

  it('rejects nodes that read the previous frame, or the pixel, inside the group', () => {
    const echoInside = withInside(slime(), inner => [...inner, n('echo', 'badEcho', 0, 0)]);
    const r1 = compileGraph({ nodes: echoInside });
    expect(r1.success).toBe(false);
    expect(r1.errors!.join('\n')).toMatch(/Node badEcho: Echo .* can't go inside an Agents group: it reads the previous frame\./);
    // Found by scanning the emitted code, not a list: Pixel UV reads gl_FragCoord.
    const pixel = withInside(slime(), inner => [...inner, n('pixelUV', 'badPixel', 0, 0)]);
    const r2 = compileGraph({ nodes: pixel });
    expect(r2.success).toBe(false);
    expect(r2.errors!.join('\n')).toMatch(/Node badPixel: .* can't go inside an Agents group: its code reads the pixel it is drawn at/);
    // A Pass, another group, a Trail or the Particles node inside: programs of their own.
    const pass = withInside(slime(), inner => [...inner, n('gpuParticles', 'badParts', 0, 0)]);
    expect(compileGraph({ nodes: pass }).errors!.join('\n')).toMatch(/Node badParts: Particles (goes at the top level|can't go inside)/);
  });

  it('rejects the inside nodes outside a group', () => {
    const r = compileGraph({ nodes: [...slime(), n('agentSense', 'strayLoose', 0, 0)] });
    expect(r.success).toBe(false);
    expect(r.errors!.join('\n')).toMatch(/Node strayLoose: Sense goes inside an Agents group\./);
  });

  it('Sense reads any chain through its Field ƒ socket, at the sensor points', () => {
    const nodes = withInside(slime(), inner => [
      ...inner.map(x => x.id === 'slimeSense' ? { ...x, inputs: { ...x.inputs, field: { type: 'float' as const, label: 'Field ƒ', connection: { nodeId: 'food', outputKey: 'distance' } } } } : x),
      n('circleSDF', 'food', 0, 0, { radius: 0.3 }),
    ]);
    const r = compileGraph({ nodes });
    expect(r.errors).toBeUndefined();
    const fs = r.agents!.groups[0].fragmentShader;
    const fn = fs.match(/^float (fieldfn_\w+)\(vec2 g_uv/m)?.[1];
    expect(fn).toBeTruthy();
    const main = fs.slice(fs.indexOf('void main()'));
    for (const q of ['qL', 'qC', 'qR']) expect(main).toMatch(new RegExp(`${fn}\\(agentsense_0_${q}, `));
  });

  it('noise inside the rule is evaluated where the agent stands (g_uv = a_pos)', () => {
    const nodes = withInside(slime(), inner => [
      ...inner.map(x => x.id === 'slimeSteer' ? { ...x, inputs: { ...x.inputs, jitter: { type: 'float' as const, label: 'Jitter', connection: { nodeId: 'wob', outputKey: 'value' } } } } : x),
      n('noiseFloat', 'wob', 0, 0),
    ]);
    const r = compileGraph({ nodes });
    expect(r.errors).toBeUndefined();
    const main = r.agents!.groups[0].fragmentShader.slice(r.agents!.groups[0].fragmentShader.indexOf('void main()'));
    expect(main.indexOf('vec2 g_uv = a_pos;')).toBeLessThan(main.indexOf('wob'));
  });
});
