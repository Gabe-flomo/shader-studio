/**
 * Agents as splats (docs/splat-scene.md "Agents as splats", docs/depth-and-splats-plan.md phase 4): the Splats look
 * compiles in 2D and 3D and its maths (ellipse, order-independent resolve); Emit from a splat scan maps splat i to
 * walker i (place, colour, size, home); Return home's generated GLSL (run on the CPU) is the spring home.ts says, and
 * settles home; the Scan to walkers builder kind; determinism.
 */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});

import { compileGraph } from '../../compiler/graphCompiler';
import { BUILTINS } from '../../compiler/__tests__/glslEval';
import { getNodeDefinition, resolveNodeAliases } from '../../nodes/definitions';
import { generateRulesInside } from '../generate';
import { rulesTemplateNodes, scanWalkers } from '../templates';
import { agents3dStarter } from '../space3d';
import { type AgentRuleSet, defaultRuleSet, describeAction } from '../spec';
import { memorySlots } from '../memory';
import { homeStep, criticalDamping } from '../home';
import { parseAgents, printAgents } from '../../lang/dialects/agents';
import { type Walker, programOf, simulate, walkersFor } from './cpuSim';
import { packSplats, splatInfo } from '../../lib/splats/pack';
import { demoBlob } from '../../lib/splats/demo';
import { scanBirth, scanWalkerData } from '../../lib/splats/walkers';
import { splatResolve, walkerCovariance, walkerEllipse2d, walkerSigmas, splatSizeByIndex } from '../../lib/agentSplats';
import { START_CARDS } from '../../agentBuilder/kinds';
import { buildAgentRuleExamples } from '../../store/agentRuleExamples';
import { emitScanSource } from '../../nodes/definitions/agents';

BUILTINS.smoothstep = ((e0: number, e1: number, x: number) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); }) as unknown as typeof BUILTINS.smoothstep;

const compile = (nodes: ReturnType<typeof rulesTemplateNodes>) => compileGraph({ nodes: resolveNodeAliases(nodes, getNodeDefinition) });

describe('the Splats look', () => {
  it.each([['2D', () => rulesTemplateNodes('scanWalkers', 'sw', 0, 0, true)], ['3D', () => buildAgentRuleExamples().agentRulesScan3d.nodes]] as const)('%s: the setup compiles, draws splats and gives a Distance', (_, make) => {
    const r = compile(make());
    expect(r.errors ?? []).toEqual([]);
    const a = r.agents!;
    expect(a.draws[0].style).toBe('splats');
    expect(r.fragmentShader).toMatch(/uniform sampler2D u_agdraw_\w+_dist;/);
    // The group keeps colour (C) and the Home memory (E); its Emit reads the scan.
    const g = a.groups[0];
    expect(g.stateC && g.stateE).toBe(true);
    expect(g.scans).toEqual([expect.objectContaining({ source: 'demo:blob:250000', flip: true })]);
    expect(g.fragmentShader).toMatch(/uniform highp sampler2D u_agScan_\w+;/);
    expect(g.fragmentShader).toMatch(/o_e = \w+_em_e;/);
    expect(g.fragmentShader).toMatch(/agPackColour\(\w+_em_col\)/);
  });

  it('size by: fixed, speed, a memory; stretched along the motion', () => {
    const look = { splatSize: 0.02, stretch: 2, sizeBy: 0, memScale: 1, speedRef: 0.5 };
    expect(walkerSigmas(look, 0)).toEqual([0.02, 0.02]);
    const [a, b] = walkerSigmas(look, 0.5);
    expect(a).toBeCloseTo(0.02); expect(b).toBeCloseTo(0.06);
    expect(walkerSigmas({ ...look, sizeBy: splatSizeByIndex('memW'), memScale: 2 }, 0, [0, 0, 0, 0.01])[0]).toBeCloseTo(0.02);
    expect(walkerSigmas({ ...look, sizeBy: splatSizeByIndex('memW') }, 0, [0, 0, 0, 0])).toEqual([0, 0]);
    expect(splatSizeByIndex('speed')).toBe(1);
  });

  it('the 2D ellipse lies along the velocity, √(2λ) long', () => {
    const cov = walkerCovariance([0, 1, 0], 0.01, 0.03);
    const e = walkerEllipse2d(cov, 720);
    // Along y: sigma 0.03 picture units = 10.8 px; the quad spans √2 · σ (plus the low-pass).
    expect(Math.abs(e.major[1])).toBeCloseTo(Math.sqrt(2 * (10.8 ** 2 + 0.3)), 3);
    expect(Math.abs(e.major[0])).toBeLessThan(1e-6);
    expect(Math.hypot(...e.minor)).toBeCloseTo(Math.sqrt(2 * (3.6 ** 2 + 0.3)), 3);
  });

  it('put together without an order: any order of the same splats gives the same pixel; near ones count for more', () => {
    const frags = [
      { rgb: [1, 0, 0] as [number, number, number], alpha: 0.6, w: 4, dist: 2 },
      { rgb: [0, 0, 1] as [number, number, number], alpha: 0.6, w: 0.25, dist: 4 },
      { rgb: [0, 1, 0] as [number, number, number], alpha: 0.3, w: 1, dist: 3 },
    ];
    const a = splatResolve(frags), b = splatResolve([...frags].reverse());
    expect(a.rgb.map(v => +v.toFixed(9))).toEqual(b.rgb.map(v => +v.toFixed(9)));
    expect(a.alpha).toBeCloseTo(1 - 0.4 * 0.4 * 0.7, 9);
    expect(a.rgb[0]).toBeGreaterThan(a.rgb[2] * 5);
    expect(a.dist).toBeGreaterThan(2); expect(a.dist).toBeLessThan(3);
    expect(splatResolve([]).alpha).toBe(0);
  });
});

describe('Emit from a splat scan', () => {
  it('walker i is splat i: its place in the scan\'s own size (turned over), colour, size and home', () => {
    const d = demoBlob(500);
    const info = splatInfo(d);
    const w = scanWalkerData(packSplats(d), info, true);
    expect(w.count).toBe(500);
    for (const i of [0, 17, 499]) {
      const b = scanBirth(w, i, [0.1, -0.2, 0.3], 0.5)!;
      const p = [0, 1, 2].map(k => (d.positions[i * 3 + k] - info.center[k]) / info.radius);
      expect(b.pos[0]).toBeCloseTo(0.1 + 0.5 * p[0], 5);
      expect(b.pos[1]).toBeCloseTo(-0.2 - 0.5 * p[1], 5);
      expect(b.pos[2]).toBeCloseTo(0.3 - 0.5 * p[2], 5);
      expect(b.colour[0]).toBeCloseTo(d.colors[i * 4] / 255, 6);
      expect(b.home).toEqual([...b.pos, b.size]);
      expect(b.size).toBeGreaterThan(0);
    }
    expect(scanBirth(w, 500, [0, 0, 0], 1)).toBeUndefined();
    // 2D drops z.
    expect(scanBirth(w, 3, [0, 0, 0], 1, 0, false)!.pos[2]).toBe(0);
  });

  it('the Emit\'s source: a library file, else a generated scan', () => {
    expect(emitScanSource({ videoId: 'splat_1', demo: 'blob' })).toBe('splat_1');
    expect(emitScanSource({ demo: 'rings', demoCount: 1234 })).toBe('demo:rings:1234');
    expect(emitScanSource({})).toBe('');
  });

  it('a plain Emit with Remember home keeps its birth place in More memory', () => {
    const nodes = rulesTemplateNodes('scanWalkers', 'h', 0, 0, true).map(x => (x.type === 'agentEmit' ? { ...x, params: { ...x.params, shape: 'disc', home: 'on' } } : x));
    const r = compile(nodes);
    expect(r.errors ?? []).toEqual([]);
    const fs = r.agents!.groups[0].fragmentShader;
    expect(fs).toMatch(/_em_e = vec4\(vec3\(\w+_pp, 0\.0\), 0\.0\);/);
    expect(r.agents!.groups[0].scans).toBeUndefined();
  });
});

describe('Return home', () => {
  const set = (strength: number, damping: number, delay = 0, d3 = false): AgentRuleSet => ({
    ...defaultRuleSet(), kind: 'particles', edges: 'slide',
    memories: [{ id: 'm1', name: 'home', type: 'home' }],
    species: [{ name: 'P', speed: 0, states: [{ name: 'a', colour: [1, 1, 1] }], rules: [{ when: [{ kind: 'always' }], do: [{ kind: 'home', memory: 'm1', strength, damping, delay }] }] }],
    ...(d3 ? {} : {}),
  });

  it('a Home always takes x, y, z, first', () => {
    const s: AgentRuleSet = { ...set(1, 1), memories: [{ id: 'a', name: 'energy', type: 'level' }, { id: 'b', name: 'home', type: 'home' }] };
    expect(memorySlots(s).get('b')).toBe('xyz');
    expect(memorySlots(s).get('a')).toBe('w');
  });

  it.each([false, true])('the GPU code (3D: %s) is home.ts\'s spring, and it settles at home', d3 => {
    const k = 9, c = criticalDamping(9), dt = 1 / 60;
    const prog = programOf(generateRulesInside(set(k, c, 0.1), { groupId: 'g', d3 }));
    const home = d3 ? [0.2, -0.1, 0.3] : [0.2, -0.1];
    const start = d3 ? [0.6, 0.3, -0.2] : [0.6, 0.3];
    const w0 = walkersFor(1, { d3 })[0];
    const walker = { ...w0, pos: start, speed: 0, mem2: [home[0], home[1], d3 ? home[2] : 0, 0] };
    let ws: Walker[] = [walker];
    let cpu = { pos: start, vel: start.map(() => 0) };
    for (let step = 0; step < 90; step++) {
      ws = simulate(prog, ws, 1, { d3, dt });
      cpu = homeStep(cpu.pos, cpu.vel, home, { strength: k, damping: c, delay: 0.1 }, (step + 1) * dt, dt);
      for (let a = 0; a < home.length; a++) expect(ws[0].pos[a]).toBeCloseTo(cpu.pos[a], 4);
    }
    const after = simulate(prog, ws, 400, { d3, dt });
    for (let a = 0; a < home.length; a++) expect(after[0].pos[a]).toBeCloseTo(home[a], 3);
    // The same run twice is the same (determinism).
    const again = simulate(prog, [walker], 120, { d3, dt });
    expect(again[0].pos).toEqual(simulate(prog, [walker], 120, { d3, dt })[0].pos);
  });

  it('waits out its delay', () => {
    const r = homeStep([1, 0], [0, 0], [0, 0], { strength: 10, delay: 1 }, 0.5, 1 / 60);
    expect(r.pos).toEqual([1, 0]);
  });

  it('reads as a sentence and round-trips through the agents language', () => {
    const s = set(6, 3, 1);
    expect(describeAction(s, 0, s.species[0].rules[0].do[0])).toBe('return home to home (spring 6, damping 3, after 1 s)');
    const back = parseAgents(printAgents(s));
    expect(back.errors).toEqual([]);
    expect(back.set.species[0].rules[0].do[0]).toEqual({ kind: 'home', memory: 'm1', strength: 6, delay: 1, damping: 3 });
  });
});

describe('Scan to walkers', () => {
  it('is a start card with a 2D and a 3D setup', () => {
    const c = START_CARDS.find(x => x.id === 'scan')!;
    expect(c.kind).toBe('particles');
    expect(rulesTemplateNodes(c.template, 'x').some(x => x.type === 'agentEmit' && x.params.shape === 'splats')).toBe(true);
    const s3 = agents3dStarter(c.template3d);
    expect(s3.nodes.find(x => x.type === 'drawAgents')!.params.style).toBe('splats');
  });

  it('blows the scan apart, then brings it home (its own colour kept)', () => {
    const s = scanWalkers(false);
    expect(s.look).toEqual({ by: 'birth' });
    const inside = generateRulesInside(s, { groupId: 'g', d3: false });
    const out = inside.find(x => x.type === 'agentOutput')!;
    expect(out.inputs.colour?.connection).toBeUndefined();
    const prog = programOf(inside);
    const home = [0.3, 0.2];
    const w = { ...walkersFor(1)[0], pos: [...home], speed: 0, mem2: [home[0], home[1], 0, 0.01] };
    const flown = simulate(prog, [w], 72, { dt: 1 / 60 });
    const away = Math.hypot(flown[0].pos[0] - home[0], flown[0].pos[1] - home[1]);
    expect(away).toBeGreaterThan(0.1);
    const back = simulate(prog, flown, 600, { dt: 1 / 60 });
    expect(Math.hypot(back[0].pos[0] - home[0], back[0].pos[1] - home[1])).toBeLessThan(0.01);
  });
});
