/**
 * The Agents nodes' maths (docs/agents-plan.md §14 "Nodes"): each node's real
 * emitted GLSL is run on the CPU (glslEval.ts) and compared with a plain JS
 * reference: Sense's three sensor points and its Channels dot, Steer's Jones
 * rule (all four branches), Move's edges, By species.
 */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});

import { getNodeDefinition } from '../../nodes/definitions';
import { n } from '../../store/graphBuilder';
import { runGlsl, type Env, type Val } from './glslEval';

const gen = (type: string, params: Record<string, unknown>, inputVars: Record<string, string>) => {
  const def = getNodeDefinition(type)!;
  const node = n(type, 'N', 0, 0, params);
  return def.generateGLSL(node, inputVars);
};
const deg = (d: number) => d * Math.PI / 180;
const close = (a: number, b: number) => expect(a).toBeCloseTo(b, 6);

describe('Steer (Jones rule)', () => {
  /** The paper's rule, in JS. */
  function jones(l: number, c: number, r: number, h: number, turn: number, u: number): number {
    if (c > l && c > r) return h;
    if (c < l && c < r) return h + (u < 0.5 ? -turn : turn);
    if (l > r) return h + turn;
    if (r > l) return h - turn;
    return h;
  }
  const run = (read: number[], h: number, u: number, params: Record<string, unknown> = {}) => {
    const { code, outputVars } = gen('agentSteer', { mode: 'jones', turn: 45, jitter: 0, ...params }, { readings: 'R', heading: 'H', random: 'U' });
    const env = runGlsl(code, { R: read, H: h, U: u });
    return env[outputVars.heading] as number;
  };
  it('goes straight when the centre is strongest', () => close(run([1, 3, 2], 0.3, 0.1), jones(1, 3, 2, 0.3, deg(45), 0.1)));
  it('turns to a random side when both sides beat the centre', () => {
    close(run([3, 1, 2], 0.3, 0.2), 0.3 - deg(45));
    close(run([3, 1, 2], 0.3, 0.7), 0.3 + deg(45));
    close(run([3, 1, 2], 0.3, 0.7), jones(3, 1, 2, 0.3, deg(45), 0.7));
  });
  it('turns toward the stronger side (left is +, counter-clockwise)', () => {
    close(run([3, 2, 1], 0, 0.5), deg(45));
    close(run([1, 2, 3], 0, 0.5), -deg(45));
  });
  it('Away runs from the strongest; Jitter wobbles by up to Jitter × Turn', () => {
    const away = (r: number[]) => {
      const { code, outputVars } = gen('agentSteer', { mode: 'away', turn: 30, jitter: 0 }, { readings: 'R', heading: 'H', random: 'U' });
      return runGlsl(code, { R: r, H: 0, U: 0.5 })[outputVars.heading] as number;
    };
    close(away([3, 2, 1]), -deg(30));
    const wob = run([1, 3, 2], 0, 25.75 / 256, { jitter: 0.5 }); // u2 = fract(u × 256) = 0.75 → +0.5 × 0.5 × turn
    close(wob, 0.5 * 0.5 * deg(45));
  });
});

describe('Move', () => {
  const env = (pos: number[], h: number): Env => ({ a_pos: pos, a_heading: h, a_dt: 1 / 60, u_resolution: [200, 100] });
  const run = (edges: string, pos: number[], h: number, speed = 60) => {
    const { code, outputVars } = gen('agentMove', { speed, edges }, {});
    const e = runGlsl(code, env(pos, h));
    return { p: e[outputVars.position] as number[], v: e[outputVars.velocity] as number[], h: e[outputVars.heading] as number, hit: e[outputVars.hit] as number };
  };
  it('steps Speed × 1/60 along the heading', () => {
    const r = run('wrap', [0, 0], 0, 6);
    close(r.p[0], 0.1); close(r.p[1], 0); expect(r.hit).toBe(0);
  });
  it('Wrap brings a walker in on the other side (the picture is ±aspect × ±1)', () => {
    const r = run('wrap', [1.95, 0], 0, 6); // aspect 2: x leaves at 2.05 → −1.95
    close(r.p[0], -1.95); expect(r.hit).toBe(1);
  });
  it('Bounce reflects position, velocity and heading', () => {
    const r = run('bounce', [0, 0.95], Math.PI / 2, 6);
    close(r.p[1], 0.95); close(r.v[1], -6); close(r.h, -Math.PI / 2); expect(r.hit).toBe(1);
  });
  it('Slide stops at the edge and keeps the along-edge motion', () => {
    const r = run('slide', [0, 0.95], Math.PI / 4, 6);
    close(r.p[1], 1); close(r.v[1], 0); close(r.v[0], 6 * Math.SQRT1_2);
  });
});

describe('Sense', () => {
  // A trail that is x + 10·y in picture units (aspect 1), in channel r; channel g is 100 everywhere.
  const trail = (_t: Val, uv: Val) => { const [u, v] = uv as number[]; return [(u - 0.5) * 2 + 10 * (v - 0.5) * 2, 100, 0, 0]; };
  const env = (): Env => ({ a_pos: [0.1, 0.2], a_heading: 0, a_ownChannels: [1, 0, 0, 0], u_resolution: [100, 100], texture: trail, textureSize: () => [64, 64], agUv: (q: Val) => (q as number[]).map(x => x * 0.5 + 0.5) });
  const field = (x: number, y: number) => x + 10 * y;
  it('reads three points Distance ahead, ±Angle, dotted with the channels', () => {
    const { code, outputVars } = gen('agentSense', { angle: 30, distance: 0.1, weight: 1, width: '1' }, { texture: 'T' });
    const e = runGlsl(code, { ...env(), T: 0 });
    const [l, c, r] = e[outputVars.readings] as number[];
    const at = (a: number) => field(0.1 + 0.1 * Math.cos(a), 0.2 + 0.1 * Math.sin(a));
    close(l, at(deg(30))); close(c, at(0)); close(r, at(-deg(30)));
    close(e[outputVars.here] as number, field(0.1, 0.2));
    const [gx, gy] = e[outputVars.gradient] as number[];
    close(gx, 1); close(gy, 10);
  });
  it('Channels picks which trail channels count; Weight scales; Also adds', () => {
    const { code, outputVars } = gen('agentSense', { angle: 30, distance: 0.1, weight: 2, width: '1' }, { texture: 'T', channels: 'CH', also: 'AL' });
    const e = runGlsl(code, { ...env(), T: 0, CH: [0, 1, 0, 0], AL: [1, 2, 3] });
    expect(e[outputVars.readings]).toEqual([201, 202, 203]);
  });
  it('reads nothing when neither a texture nor a field is wired', () => {
    const { code, outputVars } = gen('agentSense', {}, {});
    expect(runGlsl(code, env())[outputVars.readings]).toEqual([0, 0, 0]);
  });
});

describe('By species', () => {
  it('picks the value for this walker\'s species', () => {
    const { code, outputVars } = gen('agentBySpecies', { a: 1, b: 2, c: 3, d: 4 }, {});
    for (const s of [0, 1, 2, 3]) expect(runGlsl(code, { a_species: s })[outputVars.value]).toBe(s + 1);
  });
});
