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
import { curlSmokeNodes, particlesNodes, slimeMoldNodes, soundBurstNodes } from '../../store/agentExamples';
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
    expect(g).toMatchObject({ nodeId: 'slime', side: 512, species: 1, emit: { mode: 'fill' }, live: true }); // the preset ships at 256k
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
    expect(fs).toContain('const int a_side = 512;');
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

describe('Agents compile: particles (P2)', () => {
  it('compiles the Particles, Curl smoke and Sound burst examples', () => {
    for (const nodes of [particlesNodes(0, 0), curlSmokeNodes(0, 0), soundBurstNodes(0, 0)]) {
      const r = compileGraph({ nodes });
      expect(r.errors).toBeUndefined();
      expect(r.success).toBe(true);
      expect(r.agents!.groups).toHaveLength(1);
      expect(r.agents!.draws).toHaveLength(1);
      expect(r.agents!.deposits).toHaveLength(0);
    }
  });

  it('Keep full: the prelude also gives a dead walker a new life, and the first births come at every age', () => {
    const r = compileGraph({ nodes: particlesNodes(0, 0) });
    const g = r.agents!.groups[0];
    expect(g.emit).toEqual({ mode: 'respawn', rate: r.paramBindings['ptEmit::rate'], burst: r.paramBindings['ptEmit::burst'] });
    const fs = g.fragmentShader;
    expect(fs).toMatch(/a_born = mod\(a_index - u_agWin_\w+\.x \+ a_count, a_count\) < u_agWin_\w+\.y \|\| a_sB\.w <= 0\.0;/);
    expect(fs).toContain(`a_step = u_agStep_${g.slug};`);
    expect(fs).toMatch(/_age0 = a_step == 0u && \w+_life < 1\.0e29 \? \w+_r7 \* \w+_life : 0\.0;/);
    // Slime (Fill) keeps the plain window.
    expect(compileGraph({ nodes: slime() }).agents!.groups[0].fragmentShader).not.toContain('|| a_sB.w <= 0.0');
  });

  it('forces chain through Also into Integrate, and Integrate into Agent Output', () => {
    const r = compileGraph({ nodes: particlesNodes(0, 0) });
    const fs = r.agents!.groups[0].fragmentShader;
    const main = fs.slice(fs.indexOf('void main()'));
    const curl = main.match(/vec2 (\w+)_f = \(vec3\(\w+_a\.z/)![1];
    const swirl = main.match(new RegExp(`vec2 (\\w+)_f = [^;]* \\+ ${curl}_f;`))![1];
    const mouse = main.match(new RegExp(`vec2 (\\w+)_f = \\([^;]*\\)\\.xy \\+ ${swirl}_f;`))![1];
    expect(main).toMatch(new RegExp(`vec2 \\w+_v = a_vel \\+ ${mouse}_f / max\\(`));
    expect(main).toContain('u_mouse / u_resolution.y');
  });

  it('a group with a Sound kick or Chladni lists it as a listener, with its uniforms by its slug', () => {
    const r = compileGraph({ nodes: soundBurstNodes(0, 0) });
    const g = r.agents!.groups[0];
    expect(g.listeners).toHaveLength(1);
    const l = g.listeners[0];
    expect(l).toMatchObject({ nodeId: 'sbKick', kind: 'kick', soundFrom: 'graph' });
    expect(l.slug).toBe(r.nodeSlugMap!.get('sbKick'));
    expect(l.params.beat).toBe(r.paramBindings['sbKick::beat']);
    expect(g.fragmentShader).toContain(`uniform vec4 u_agShk_${l.slug}[4];`);
    expect(g.fragmentShader).toContain(`uniform vec4 u_agSnd_${l.slug};`);
    // A plate inside: its modes, count and shake; a round one, the Bessel table.
    const nodes = soundBurstNodes(0, 0).map(x => x.id !== 'burst' ? x : {
      ...x, params: { ...x.params, subgraph: { ...(x.params.subgraph as SubgraphData), nodes: [
        ...(x.params.subgraph as SubgraphData).nodes.map(m => m.id === 'sbOut' ? { ...m, inputs: { ...m.inputs, position: { ...m.inputs.position, connection: { nodeId: 'plate', outputKey: 'position' } } } } : m),
        n('agentChladni', 'plate', 0, 0, { shape: 'circle', modeFrom: 'sound' }, { position: ['sbMove', 'position'], velocity: ['sbMove', 'velocity'] }),
      ] } },
    });
    const r2 = compileGraph({ nodes });
    expect(r2.errors).toBeUndefined();
    const g2 = r2.agents!.groups[0];
    expect(g2.listeners.map(x => x.kind).sort()).toEqual(['kick', 'plate']);
    expect(g2.listeners.find(x => x.kind === 'plate')).toMatchObject({ shape: 'circle', modeFrom: 'sound', symmetry: 'minus' });
    expect(g2.fragmentShader).toContain('uniform highp sampler2D u_agBessel;');
  });

  it('Draw agents: the style, palette, lights and Ink\'s paper reach the engine and the picture', () => {
    const r = compileGraph({ nodes: particlesNodes(0, 0) });
    expect(r.agents!.draws[0]).toMatchObject({ style: 'glow', colorBy: 'age', palette: 'ember', lights: 4, lightMotion: 'orbit', fade: true, scaleBy: 'crowd' });
    const smoke = compileGraph({ nodes: curlSmokeNodes(0, 0) });
    expect(smoke.agents!.draws[0]).toMatchObject({ style: 'ink', lights: 0 });
    // Ink covers the paper (premultiplied); light adds to the picture.
    expect(smoke.fragmentShader).toMatch(/\* \(1\.0 - clamp\(\w+_s\.a, 0\.0, 1\.0\)\) \+ max\(/);
    expect(r.fragmentShader).not.toContain('1.0 - clamp(');
  });

  it('the new inside nodes refuse to go outside a group', () => {
    const r = compileGraph({ nodes: [...particlesNodes(0, 0), n('agentCurl', 'strayCurl', 0, 0)] });
    expect(r.success).toBe(false);
    expect(r.errors!.join('\n')).toMatch(/Node strayCurl: Curl noise goes inside an Agents group\./);
  });
});
