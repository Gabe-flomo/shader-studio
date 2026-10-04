/**
 * Agents P3 (docs/agents-plan.md §13 "P3 Species, food and obstacles"): per-walker
 * state (state C and D), Emit's species / picture / field births, Move's Obstacle ƒ,
 * the Trail's Add / Block step program and 5×5 blur, Velocity deposits, the eye
 * preview inside a group, Show passes, and the five P3 presets.
 */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});

import { compileGraph } from '../graphCompiler';
import { agentEyeNodes, needsStateC } from '../agentGraph';
import { getNodeDefinition } from '../../nodes/definitions';
import { AG_STATE_C_GLSL } from '../../nodes/definitions/agents';
import { AG_DEPOSIT_VERT, AG_DRAW_VERT, AG_TRAIL_FRAG, AG_TRAIL_MEAN_GLSL } from '../../play/kit/agentShaders.js';
import { slimeMoldNodes } from '../../store/agentExamples';
import { antsNodes, boidsNodes, growPictureNodes, multiSlimeNodes, strandsNodes } from '../../store/agentExamplesP3';
import { n } from '../../store/graphBuilder';
import { programTints } from '../../lib/programTints';
import { runGlsl, type Env } from './glslEval';
import type { GraphNode, SubgraphData } from '../../types/nodeGraph';

const inside = (nodes: GraphNode[], id: string) => (nodes.find(x => x.id === id)!.params.subgraph as SubgraphData).nodes;
const close = (a: number, b: number) => expect(a).toBeCloseTo(b, 6);

describe('per-walker state (state C and D)', () => {
  it('is off for one species and nothing remembered: the P1 slime is two outputs, species from the index', () => {
    const r = compileGraph({ nodes: slimeMoldNodes(0, 0) });
    const [g] = r.agents!.groups;
    expect(g.stateC).toBeUndefined();
    expect(g.fragmentShader).not.toContain('o_c');
    expect(g.fragmentShader).toContain('a_species = mod(a_index, a_speciesCount);');
  });

  it('is on with species > 1, or when Agent Output sets Memory / Deposit / Colour, or Memory is read', () => {
    const ms = multiSlimeNodes(0, 0);
    const g = ms.find(x => x.id === 'multiSlime')!;
    expect(needsStateC(g, inside(ms, 'multiSlime'), inside(ms, 'multiSlime').find(x => x.type === 'agentOutput'))).toBe(true);
    const r = compileGraph({ nodes: ms });
    expect(r.errors).toBeUndefined();
    const fs = r.agents!.groups[0].fragmentShader;
    expect(r.agents!.groups[0].stateC).toBe(true);
    for (const s of ['layout(location = 2) out highp vec4 o_c;', 'layout(location = 3) out highp vec4 o_d;', 'a_species = a_sC.x; a_mem = a_sC.yz;', 'o_c = a_sC; o_d = a_sD; return;']) expect(fs).toContain(s);
    // The born walker takes its Emit's species (three chained Emits: 0, 1, 2), its deposit one-hot.
    for (const sp of ['0.0', '1.0', '2.0']) expect(fs).toMatch(new RegExp(`float agentemit\\w*_em_sp = ${sp.replace('.', '\\.')};`));
    expect(fs).toContain('o_d = agOneHot(');
    const ants = compileGraph({ nodes: antsNodes(0, 0) });
    expect(ants.errors).toBeUndefined();
    const afs = ants.agents!.groups[0].fragmentShader;
    expect(ants.agents!.groups[0].stateC).toBe(true);
    expect(afs).toMatch(/o_c = vec4\(a_species, ant_rule\w*_result, agPackColour\(ant_rule\w*_colour\)\);/);
    expect(afs).toMatch(/o_d = ant_rule\w*_deposit;/);
  });

  it('packs a colour into one float exactly (8 bits a channel) and back', () => {
    // The helpers' own bodies, run on the CPU.
    const body = (name: string) => AG_STATE_C_GLSL.split('\n').find(l => l.includes(` ${name}(`))!.replace(/^[^{]*\{/, '').replace(/\}\s*$/, '').replace(/return ([^;]+);/, `vec4 OUT = vec4($1);`);
    const pack = (c: number[]) => (runGlsl(body('agPackColour').replace('vec4 OUT = vec4(', 'float OUT = ('), { c }).OUT as number);
    const unpack = (f: number) => runGlsl(body('agUnpackColour').replace('vec4 OUT = vec4(', 'vec3 OUT = vec3('), { f }).OUT as number[];
    for (const c of [[0, 0, 0], [1, 1, 1], [0.62, 0.42, 0.3], [1, 0.86, 0.25]]) {
      const f = pack(c);
      expect(Number.isInteger(f)).toBe(true);
      expect(f).toBeLessThan(2 ** 24);
      unpack(f).forEach((x, i) => expect(Math.abs(x - c[i])).toBeLessThanOrEqual(0.5 / 255 + 1e-9));
    }
    expect(pack([1, 1, 1])).toBe(16777215);
  });

  it('the engine shaders read state C / D only with per-walker state', () => {
    expect(AG_DEPOSIT_VERT).toContain('else if (u_stateC == 1) v_dep = texelFetch(u_d, t, 0) * u_amount;');
    expect(AG_DEPOSIT_VERT).toContain('if (u_what == 1) v_dep = vec4(B.xy, 1.0, 0.0) * u_amount;');
    expect(AG_DRAW_VERT).toContain('vec4 C = u_stateC == 1 ? texelFetch(u_c, t, 0)');
  });
});

describe('Emit: species, picture and field', () => {
  it('a Field shape tries 8 hashed places, keeps the first taken (or the best), through Where ƒ', () => {
    const r = compileGraph({ nodes: growPictureNodes(0, 0) });
    expect(r.errors).toBeUndefined();
    const fs = r.agents!.groups[0].fragmentShader;
    expect(fs).toMatch(/for \(int \w+_k = 0; \w+_k < 8; \w+_k\+\+\)/);
    expect(fs).toMatch(/float \w+_w = fieldfn_\w+\(\w+_q, vec2\(0\.0\), 1\.0, 0\.0\);/);
  });
  it('a Picture shape weighs each try by the texture\'s brightness', () => {
    const def = getNodeDefinition('agentEmit')!;
    const { code } = def.generateGLSL(n('agentEmit', 'E', 0, 0, { shape: 'picture', threshold: 0.3 }), { picture: 'u_trail_t' });
    expect(code).toContain('dot(texture(u_trail_t, agUv(E_q)).rgb, vec3(0.299, 0.587, 0.114))');
    expect(code).toContain('E_w > 0.3 ? clamp(E_w, 0.0, 1.0) : 0.0');
    expect(def.glslFunctionsFor!(n('agentEmit', 'E', 0, 0, { shape: 'picture' })).join('')).toContain('agUv');
  });
});

describe('Move: Obstacle ƒ', () => {
  // A round obstacle of radius 0.3 at the centre; the walker at x 0.31 steps 0.1 left, into it.
  const env = (): Env => ({ a_pos: [0.31, 0], a_heading: Math.PI, a_dt: 1 / 60, a_random: 0.5 / 4096, u_resolution: [200, 100], fieldfn_o: (q: unknown) => Math.hypot(...(q as number[])) - 0.3 });
  const run = (onObstacle: string) => {
    const { code, outputVars } = getNodeDefinition('agentMove')!.generateGLSL(n('agentMove', 'M', 0, 0, { speed: 6, edges: 'wrap', onObstacle }), { obstacle: 'fieldfn_o' });
    const e = runGlsl(code, env());
    return { p: e[outputVars.position] as number[], v: e[outputVars.velocity] as number[], h: e[outputVars.heading] as number, hit: e[outputVars.hit] as number };
  };
  it('Turn back: stays where it stood and turns round', () => {
    const r = run('turn');
    close(r.p[0], 0.31); close(r.p[1], 0); close(r.h, 2 * Math.PI); close(r.v[0], 6); expect(r.hit).toBe(1);
  });
  it('Slide: pushed back onto the edge, the inward velocity dropped', () => {
    const r = run('slide');
    close(r.p[0], 0.3); close(r.v[0], 0); expect(r.hit).toBe(1);
  });
});

describe('Trail: Add / Block, 5×5, signed', () => {
  it('a Trail with Add or Block wired gets a step program of its own; its chain stays out of the picture', () => {
    const r = compileGraph({ nodes: growPictureNodes(0, 0) });
    const [t] = r.agents!.trails;
    expect(t.stepShader).toBeDefined();
    expect(t.stepShader).toContain(`uniform sampler2D u_trSrc_${t.slug};`);
    expect(t.stepShader).toContain('agTrailMean(');
    expect(t.stepShader).toMatch(/_t \+= food_to_trail\w*_result \* u_trStep_\w+\.w;/);
    expect(t.stepNodeIds).toEqual(expect.arrayContaining(['gpFoodTrail', 'gpFood']));
    // Food to trail is only needed by the trail's step: not compiled into the picture.
    expect(r.fragmentShader).not.toContain('food_to_trail');
    const ants = compileGraph({ nodes: antsNodes(0, 0) });
    expect(ants.agents!.trails[0].stepShader).toMatch(/_t \*= 1\.0 - clamp\(rock_mask\w*_result, 0\.0, 1\.0\);/);
  });
  it('the 3×3 mean is the P1 step exactly; 5×5 is a 1-4-6-4-1 blur; a Velocity deposit makes the trail signed', () => {
    expect(AG_TRAIL_MEAN_GLSL).toContain('return m / 9.0;');
    expect(AG_TRAIL_MEAN_GLSL).toContain('return m / 256.0;');
    expect(AG_TRAIL_FRAG).toContain('o = u_signed == 1 ? t : max(t, vec4(0.0));');
    const r = compileGraph({ nodes: boidsNodes(0, 0) });
    expect(r.errors).toBeUndefined();
    expect(r.agents!.trails[0]).toMatchObject({ kernel: 5, signed: true });
    expect(r.agents!.deposits[0].what).toBe('velocity');
    // A sampling node on the trail inside the group reads the trail's pixel size.
    expect(r.agents!.groups[0].fragmentShader).toMatch(/uniform vec2 u_trail_\w+_px;/);
  });
});

describe('ordinary nodes read the agent\'s place', () => {
  it('vUv (the UV node) is the agent\'s position in an update shader, not its state texel', () => {
    const fs = compileGraph({ nodes: antsNodes(0, 0) }).agents!.groups[0].fragmentShader;
    expect(fs).toContain('a_vUv = a_pos / vec2(u_resolution.x / u_resolution.y, 1.0) * 0.5 + 0.5;');
    expect(fs.split('\n').filter(l => /\bvUv\b/.test(l))).toEqual(['varying vec2 vUv;']);
  });
});

describe('eye preview inside a group', () => {
  it('compiles the inside chain into the picture with the agent at each pixel; the simulation stays', () => {
    const nodes = multiSlimeNodes(0, 0);
    const eye = agentEyeNodes(nodes, 'multiSlime', 'msSense')!;
    expect(eye.copies.map(c => c.id).sort()).toEqual(['msIn', 'msSense']);
    // Sense's Texture, wired to the group's Trail port, now reads the Trail outside.
    expect(eye.copies.find(c => c.id === 'msSense')!.inputs.texture.connection).toEqual({ nodeId: 'msTrail', outputKey: 'texture' });
    const out: GraphNode = { id: 'eyeOut', type: 'output', position: { x: 0, y: 0 }, params: {}, outputs: {}, inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'msSense', outputKey: 'readings' } } } };
    const r = compileGraph({ nodes: [...eye.rest, ...eye.copies, out] });
    expect(r.errors).toBeUndefined();
    expect(r.fragmentShader).toContain('a_pos = g_uv; a_vel = vec2(0.0); a_heading = 0.0;');
    expect(r.agents!.groups[0].live).toBe(true);
    expect(agentEyeNodes(nodes, 'multiSlime', 'nope')).toBeNull();
  });
});

describe('Show passes', () => {
  it('tags each node with the programs it runs in', () => {
    const r = compileGraph({ nodes: antsNodes(0, 0) });
    const tags = programTints(r.passes ?? null, r.agents ?? null, r.finalNodeIds ?? null);
    expect(tags.get('ants')?.[0]).toMatchObject({ kind: 'agents', label: 'Ants' });
    expect(tags.get('antSense')?.[0].kind).toBe('agents');
    expect(tags.get('antTrail')?.[0].kind).toBe('agents');
    // Nest and food runs in the group (each ant) and in the picture (each pixel).
    expect(tags.get('antPlaces')!.map(t => t.kind).sort()).toEqual(['agents', 'final']);
    expect(tags.get('antGround')!.map(t => t.kind)).toEqual(['final']);
    expect(programTints(null, null, null).size).toBe(0);
  });
});

describe('P3 presets', () => {
  it.each([
    ['multi-species slime', multiSlimeNodes], ['ants', antsNodes], ['boids', boidsNodes], ['strands', strandsNodes], ['grow toward a picture', growPictureNodes],
  ] as const)('%s compiles, every program live', (_name, build) => {
    const r = compileGraph({ nodes: build(0, 0) });
    expect(r.errors).toBeUndefined();
    expect(r.success).toBe(true);
    expect(r.agents!.groups.every(g => g.live)).toBe(true);
    expect(r.agents!.trails.every(t => t.live)).toBe(true);
  });
});
