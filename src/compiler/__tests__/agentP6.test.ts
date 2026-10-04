/**
 * Agents P6 (docs/agents-plan.md §13 "P6 More", without 3D): Open as nodes on the Particles
 * node, readings back into Play, Emit's Line shape / Up facing / "not born this time", Draw
 * agents' Particles-node colour orders, and the Galaxy, Mycelium and Sand on a plate presets.
 */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});

import { compileGraph } from '../graphCompiler';
import { getNodeDefinition } from '../../nodes/definitions';
import { AG_DRAW_VERT, AG_READ_FRAG, AG_SUM_FRAG } from '../../play/kit/agentShaders.js';
import { AG_COLOR_BY, AG_GROUP_READS, agReadDecode, agReadPlan } from '../../play/kit/agentPlan.js';
import { GP_DEFAULTS, gpPreset } from '../../play/kit/gpuParticles.js';
import { galaxyNodes, myceliumNodes, sandPlateNodes } from '../../store/agentExamplesP6';
import { particlesAsNodes } from '../../store/particlesAsNodes';
import { n } from '../../store/graphBuilder';
import { agentReading, agentReadingsWanted, publishAgentReadings, wantAgentReadings } from '../../lib/agentReadings';
import { parsePlayRecord, sensorReadsFor } from '../../types/play';
import { webAgents } from '../../play/webInput';
import type { GraphNode, SubgraphData } from '../../types/nodeGraph';

const inside = (g: GraphNode) => (g.params.subgraph as SubgraphData).nodes;
const close = (a: number, b: number) => expect(a).toBeCloseTo(b, 6);

describe('P6 presets', () => {
  it.each([['galaxy', galaxyNodes], ['mycelium', myceliumNodes], ['sand on a plate', sandPlateNodes]] as const)('%s compiles, every program live', (_name, build) => {
    const r = compileGraph({ nodes: build(0, 0) });
    expect(r.errors).toBeUndefined();
    expect(r.success).toBe(true);
    expect(r.agents!.groups.every(g => g.live)).toBe(true);
    expect(r.agents!.trails.every(t => t.live)).toBe(true);
  });
  it('galaxy: each star keeps its orbit in Memory (per-walker state) and is drawn in its own colour', () => {
    const r = compileGraph({ nodes: galaxyNodes(0, 0) });
    expect(r.agents!.groups[0].stateC).toBe(true);
    expect(r.agents!.draws[0].colorBy).toBe('agent');
  });
  it('mycelium: tips sprout on the trail\'s young threads (Emit Field on the Trail, not born when no try lands)', () => {
    const r = compileGraph({ nodes: myceliumNodes(0, 0) });
    const fs = r.agents!.groups[0].fragmentShader;
    expect(fs).toMatch(/bool \w+_miss = false;/);
    expect(fs).toMatch(/if \(\w+_miss\) \w+_em_b = vec4\(0\.0\);/);
    // The field reads the trail (as the step before left it) at each try.
    expect(fs).toMatch(/uniform sampler2D u_trail_\w+;/);
    expect(r.agents!.groups[0].emit.mode).toBe('rate');
  });
  it('sand on a plate: one Chladni plate that hears the group\'s silent Beat', () => {
    const r = compileGraph({ nodes: sandPlateNodes(0, 0) });
    const g = r.agents!.groups[0];
    expect(g.listeners).toHaveLength(1);
    expect(g.listeners[0]).toMatchObject({ kind: 'plate', modeFrom: 'sound', soundFrom: 'graph' });
    // The group's Beat (20) reaches the plate as the group's own uniform.
    expect(g.listeners[0].params.beat).toMatch(/^u_p_sand\w*_beat$/);
  });
});

describe('Emit: Line, Up, and "not born this time"', () => {
  const emit = (params: Record<string, unknown>, v: Record<string, string> = {}) => getNodeDefinition('agentEmit')!.generateGLSL(n('agentEmit', 'E', 0, 0, params), v).code;
  it('Line: born across, Size each way from the centre; Up faces straight up', () => {
    const code = emit({ shape: 'line', heading: 'up', size: 0.5 });
    expect(code).toContain('E_pp = E_c + vec2((E_r1 * 2.0 - 1.0) * 0.5, 0.0); E_out = vec2(0.0, 1.0);');
    expect(code).toContain('float E_hd = 1.5707963;');
  });
  it('the defaults write what they did (no miss flag), and Not born this time only on a picture or a field', () => {
    expect(emit({ shape: 'field', threshold: 0.3 }, { where: 'fieldfn_w' })).not.toContain('_miss');
    expect(emit({ shape: 'disc', miss: 'skip' })).not.toContain('_miss');
    const code = emit({ shape: 'field', threshold: 0.3, miss: 'skip' }, { where: 'fieldfn_w' });
    expect(code).toContain('bool E_miss = false;');
    expect(code).toContain('E_miss = true;');
    expect(code).toContain('E_bq = E_q; E_miss = false; break;');
    expect(code).toContain('if (E_miss) E_em_b = vec4(0.0);');
  });
});

describe('Draw agents: the Particles node\'s colour orders', () => {
  it('Speed, fast first and Heading, once round are the Particles engine\'s formulas', () => {
    expect(AG_COLOR_BY.indexOf('speedFast')).toBe(6);
    expect(AG_COLOR_BY.indexOf('headingRound')).toBe(7);
    expect(AG_DRAW_VERT).toContain('else if (u_colorBy == 6) k = 1.0 - clamp(B.z / max(u_speedRef, 1e-4), 0.0, 1.0);');
    expect(AG_DRAW_VERT).toContain('else if (u_colorBy == 7) k = fract(atan(B.y, B.x) / 6.2831853 + 0.5);');
  });
});

describe('Open as nodes (the Particles node)', () => {
  let k = 0;
  const ids = () => `n${k++}`;
  const particles = (params: Record<string, unknown> = {}, wires: Record<string, [string, string]> = {}) =>
    n('gpuParticles', 'gp', 100, 100, params, wires);
  const groupOf = (nodes: GraphNode[]) => nodes.find(x => x.type === 'agentsGroup')!;
  const typesInside = (nodes: GraphNode[]) => inside(groupOf(nodes)).map(x => x.type);

  it('the defaults: a ring, curl and swirl, drag, glow with four orbiting lights; every node has a note', () => {
    const r = particlesAsNodes(particles(), ids, { x: 0, y: 0 });
    expect(typesInside(r.nodes)).toEqual(['agentInputs', 'agentCurl', 'agentVortex', 'agentIntegrate', 'agentAge', 'agentOutput']);
    const emit = r.nodes.find(x => x.type === 'agentEmit')!;
    expect(emit.params).toMatchObject({ mode: 'respawn', shape: 'ring', heading: 'outward', size: 0.4, life: 4, lifeVar: 0.5, speed: 0.08, speedVar: 0.45, spread: 0.4 });
    const g = groupOf(r.nodes);
    expect(g.params).toMatchObject({ tier: '256k', stepsPerFrame: 1, preroll: 6 });
    const curl = inside(g).find(x => x.type === 'agentCurl')!;
    expect(curl.params).toMatchObject({ strength: 0.4, size: 1, evolve: 0.15 });
    expect(inside(g).find(x => x.type === 'agentIntegrate')!.params).toMatchObject({ drag: 1, maxSpeed: 0, edges: 'free' });
    const draw = r.nodes.find(x => x.type === 'drawAgents')!;
    expect(draw.params).toMatchObject({ style: 'glow', colorBy: 'age', palette: 'ember', lights: '4', lightOrbit: 0.48, brightness: 0.7 });
    expect(r.missing).toEqual([]);
    const walk = (list: GraphNode[]): GraphNode[] => list.flatMap(x => [x, ...(x.params.subgraph ? walk(inside(x)) : [])]);
    for (const x of walk(r.nodes)) expect(String(x.params.__comment ?? '').length, `${x.type} ${x.id}`).toBeGreaterThan(20);
    // It compiles, wired into an Output.
    const out = n('output', 'out', 0, 0, {}, { color: [r.outputs.color!.nodeId, r.outputs.color!.outputKey] });
    const c = compileGraph({ nodes: [...r.nodes, out] });
    expect(c.errors).toBeUndefined();
  });
  it('every preset of the Particles node opens and compiles; what can\'t be carried is listed', () => {
    for (const name of ['ink', 'embers', 'dust', 'dissolve', 'sound', 'launch', 'chladni', 'singing', 'cymatics', 'hands']) {
      const r = particlesAsNodes(particles({ ...GP_DEFAULTS, ...gpPreset(name)! }), ids, { x: 0, y: 0 });
      const out = n('output', 'out', 0, 0, {}, { color: [r.outputs.color!.nodeId, r.outputs.color!.outputKey] });
      const c = compileGraph({ nodes: [...r.nodes, out] });
      expect(c.errors, name).toBeUndefined();
      if (name === 'ink' || name === 'dust') expect(r.missing.join(' '), name).toContain('3D');
      if (name === 'launch') expect(r.missing.join(' '), name).toMatch(/Jet.*|Gust/);
      if (name === 'dissolve') { expect(r.imageId, name).toBeDefined(); expect(r.missing.join(' ')).toContain('Image emitter'); }
      if (name === 'chladni' || name === 'singing' || name === 'cymatics') expect(typesInside(r.nodes), name).toContain('agentChladni');
      if (name === 'sound') expect(typesInside(r.nodes).filter(t => t === 'agentSoundKick'), name).toHaveLength(3);
      if (name === 'hands') expect(inside(groupOf(r.nodes)).filter(x => x.type === 'agentAttract' && x.params.target === 'hand'), name).toHaveLength(2);
    }
  });
  it('wired sockets come along: Over into Draw agents, the Emitter into Emit, settings and shapes through ports', () => {
    const r = particlesAsNodes(particles({ obstacleMode: 'mask' }, {
      over: ['bg', 'color'], emitAt: ['pos', 'uv'], turbulence: ['lfo', 'value'], obstacle: ['shape', 'mask'], flow: ['noise', 'value'], uv: ['warp', 'uv'],
    }), ids, { x: 0, y: 0 });
    const g = groupOf(r.nodes);
    expect(Object.keys(g.inputs)).toEqual(expect.arrayContaining(['emitter', 'p_turbulence', 'obstacle', 'flow']));
    expect(g.inputs.p_turbulence.connection).toEqual({ nodeId: 'lfo', outputKey: 'value' });
    expect(r.nodes.find(x => x.type === 'agentEmit')!.inputs.position.connection).toEqual({ nodeId: 'pos', outputKey: 'uv' });
    expect(r.nodes.find(x => x.type === 'drawAgents')!.inputs.over.connection).toEqual({ nodeId: 'bg', outputKey: 'color' });
    const ins = inside(g);
    const agIn = ins.find(x => x.type === 'agentInputs')!;
    expect(ins.find(x => x.type === 'agentCurl')!.inputs.strength.connection).toEqual({ nodeId: agIn.id, outputKey: 'p_turbulence' });
    expect(ins.find(x => x.type === 'agentVortex')!.inputs.centre.connection).toEqual({ nodeId: agIn.id, outputKey: 'emitter' });
    const mask = ins.find(x => x.type === 'exprNode')!;
    expect(ins.find(x => x.type === 'agentCollide')!.inputs.shape.connection).toEqual({ nodeId: mask.id, outputKey: 'result' });
    expect(ins.find(x => x.type === 'agentFlow')!.inputs.field.connection).toEqual({ nodeId: agIn.id, outputKey: 'flow' });
    // Its Particles output (the particles alone) has no match with Over wired; UV is listed.
    expect(r.outputs.particles).toBeNull();
    expect(r.missing.join(' ')).toContain('UV');
    expect(String(g.params.__comment)).toContain('Not carried over from the Particles node yet');
  });
  it('a Particles node next to its copy compiles: what it reads stays in the picture program', () => {
    const src = particles({}, { emitAt: ['pos', 'uv'] });
    const pos = n('mouse', 'pos', 0, 0);
    const r = particlesAsNodes(src, ids, { x: 0, y: 0 });
    const out = n('output', 'out', 0, 0, {}, { color: [r.outputs.color!.nodeId, r.outputs.color!.outputKey] });
    const c = compileGraph({ nodes: [pos, src, ...r.nodes, out] });
    expect(c.errors).toBeUndefined();
    expect(c.fragmentShader).not.toContain('undefined');
  });
});

describe('readings back into Play', () => {
  it('the reduction: 8 × 8 blocks a pass, two halves side by side, down to one texel each', () => {
    expect(agReadPlan(1024)).toEqual([[128, 128], [16, 16], [2, 2], [1, 1]]);
    expect(agReadPlan(256)).toEqual([[32, 32], [4, 4], [1, 1]]);
    expect(agReadPlan(2048)).toEqual([[256, 256], [32, 32], [4, 4], [1, 1]]);
    expect(AG_READ_FRAG).toContain('s += vec4(1.0, q, dot(q, q));');
    expect(AG_READ_FRAG).toContain('if (B.w <= 0.0) continue;');
    expect(AG_SUM_FRAG).toContain('texelFetch(u_src, ivec2(t.x + half_ * u_inW, t.y), 0)');
  });
  it('decodes the sums: alive share, mean speed, spread, centre, species shares', () => {
    // 4 live walkers of 8 at (±1, ±1) in a square picture, speed 1 each, species 0, 0, 1, 2.
    const r = agReadDecode([4, 0, 0, 8, 4, 2, 1, 1], 8, 1);
    expect(r.alive).toBe(0.5);
    close(r.speed, 0.5);
    close(r.spread, 1);
    expect([r.centroidX, r.centroidY]).toEqual([0.5, 0.5]);
    expect([r.group1, r.group2, r.group3, r.group4]).toEqual([0.5, 0.25, 0.25, 0]);
    // Two at (1, 0.5) in a 2:1 picture: the centre at three quarters across and up, no spread.
    const s = agReadDecode([2, 2, 1, 2.5, 0, 2, 0, 0], 4, 2);
    close(s.centroidX, 0.75); close(s.centroidY, 0.75); close(s.spread, 0);
    // Nobody alive: the centre stays in the middle.
    expect(agReadDecode([0, 0, 0, 0, 0, 0, 0, 0], 4, 1)).toMatchObject({ alive: 0, centroidX: 0.5, centroidY: 0.5, spread: 0 });
    expect(Object.keys(r)).toEqual([...AG_GROUP_READS]);
  });
  it('a read marks its group wanted; values arrive when the runner publishes them', () => {
    expect(agentReadingsWanted('gX')).toBe(false);
    expect(agentReading('ag:gX', 'alive')).toBeUndefined();
    expect(agentReadingsWanted('gX')).toBe(true);
    publishAgentReadings('gX', agReadDecode([1, 0, 0, 0, 0, 1, 0, 0], 2, 1));
    expect(agentReading('ag:gX', 'alive')).toBe(0.5);
    expect(agentReading('layer1', 'alive')).toBeUndefined();
    wantAgentReadings('gY');
    expect(agentReadingsWanted('gY')).toBe(true);
  });
  it('Play keeps sensors on a group (`ag:<id>`) and lists its readings like an Agents layer\'s', () => {
    expect(sensorReadsFor({ kind: 'agentsGroup' })).toEqual([...AG_GROUP_READS]);
    const rec = parsePlayRecord({
      version: 1, layers: [],
      controls: [{ id: 'c', target: 'draw::brightness', kind: 'float', label: 'B', min: 0, max: 2 }],
      mappings: [{ id: 'm', controlId: 'c', source: { kind: 'sensor', layerId: 'ag:slime', read: 'centroidX', otherId: '' }, outMin: 0, outMax: 1, curve: 'linear', smoothMs: 0, enabled: true }],
    });
    expect(rec?.mappings.map(m => m.source)).toEqual([{ kind: 'sensor', layerId: 'ag:slime', read: 'centroidX', otherId: '' }]);
  });
  it('a web page sums only the groups its Play reads', () => {
    const r = compileGraph({ nodes: sandPlateNodes(0, 0) });
    expect(webAgents(r.agents!).groups[0].readAs).toBeUndefined();
    const play = { version: 1, layers: [], controls: [], mappings: [{ id: 'm', controlId: 'c', source: { kind: 'sensor', layerId: 'ag:sand', read: 'alive', otherId: '' } }] };
    expect(webAgents(r.agents!, play as never).groups[0].readAs).toBe('ag:sand');
    const rule = { version: 1, layers: [], controls: [], mappings: [], signals: [{ id: 's', when: { value: 'read:ag:sand::centroidX' } }] };
    expect(webAgents(r.agents!, rule as never).groups[0].readAs).toBe('ag:sand');
  });
});
