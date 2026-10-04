/**
 * The particle forces inside an Agents group (docs/agents-plan.md §2, phase P2): each node's real
 * emitted GLSL is run on the CPU (glslEval.ts) against a plain JS reference, as agentNodes.test.ts
 * does for Sense / Steer / Move. Integrate is checked against the analytic sum of a fall (the plan's
 * "Integrate against an analytic fall"). The nodes built from the Particles engine's shared GLSL
 * pieces are checked to emit exactly the engine's text for them.
 */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});

import { getNodeDefinition } from '../../nodes/definitions';
import { n } from '../../store/graphBuilder';
import { runGlsl, type Env, type Val } from './glslEval';
import {
  GP_LIGHTS, GP_SHADERS, gpBesselGlsl, gpCrunch, gpCurlAt, gpCurlOctave2, gpCurlPlane, gpFade, gpFlowPush, gpGust, gpHandFall, gpHandPush,
  gpLevelGlsl, gpPaletteGlsl, gpPlateGlsl, gpPlateStep, gpShockPush, gpShockRing, gpSwirl, gpVibrate, gpWavePhase, gpWavePush,
} from '../../play/kit/gpuParticles.js';
import { agBeatLevel } from '../../play/kit/agentPlan.js';
import { AG_DRAW_VERT } from '../../play/kit/agentShaders.js';

const gen = (type: string, params: Record<string, unknown>, inputVars: Record<string, string>) => {
  const def = getNodeDefinition(type)!;
  return def.generateGLSL(n(type, 'N', 0, 0, params), inputVars);
};
const close = (a: number, b: number, digits = 6) => expect(a).toBeCloseTo(b, digits);
const smoothstep = (e0: number, e1: number, x: number) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
const EXTRA: Env = {
  smoothstep: (a: Val, b: Val, x: Val) => smoothstep(a as number, b as number, x as number),
  radians: (a: Val) => (a as number) * Math.PI / 180,
};
const DT = 1 / 60;

describe('Gravity, Vortex, Attract / Repel', () => {
  it('Gravity pulls along Angle by Strength, and adds Also', () => {
    const { code, outputVars } = gen('agentGravity', { strength: 2, angle: -90 }, { also: 'AL' });
    const f = runGlsl(code, { ...EXTRA, AL: [0.5, 0.25] })[outputVars.force] as number[];
    close(f[0], 0.5); close(f[1], -2 + 0.25);
  });
  it('Gravity\'s Direction socket wins over Angle', () => {
    const { code, outputVars } = gen('agentGravity', { strength: 3 }, { direction: 'D' });
    const f = runGlsl(code, { ...EXTRA, D: [0, 10] })[outputVars.force] as number[];
    close(f[0], 0); close(f[1], 3);
  });
  it('Vortex swirls counter-clockwise, strongest at Reach (the Particles node\'s Swirl at Reach 0.5)', () => {
    const at = (pos: number[], reach = 0.5) => {
      const { code, outputVars } = gen('agentVortex', { strength: 1, reach }, {});
      return runGlsl(code, { ...EXTRA, a_pos: pos })[outputVars.force] as number[];
    };
    // GP: f = s · (−d.y, d.x) / r · r / (0.25 + r²).
    const gp = (x: number, y: number) => { const r = Math.hypot(x, y) + 1e-4; const k = 1 / r * (r / (0.25 + r * r)); return [-y * k, x * k]; };
    const f = at([0.3, 0.4]);
    const g = gp(0.3, 0.4);
    close(f[0], g[0]); close(f[1], g[1]);
    // Strongest at Reach: |f| at 0.5 beats |f| at 0.2 and at 1.2.
    const mag = (x: number) => Math.hypot(...at([x, 0]));
    expect(mag(0.5)).toBeGreaterThan(mag(0.2));
    expect(mag(0.5)).toBeGreaterThan(mag(1.2));
  });
  it('Attract (Within Reach) is the Particles node\'s hand: a pull toward the point that fades past Reach; negative repels', () => {
    const at = (strength: number, pos: number[]) => {
      const { code, outputVars } = gen('agentAttract', { target: 'point', x: 0, y: 0, strength, reach: 0.35, swirl: 0 }, {});
      return runGlsl(code, { ...EXTRA, a_pos: pos })[outputVars.force] as number[];
    };
    const near = at(1, [0.2, 0]);
    expect(near[0]).toBeLessThan(0); // toward the point at the origin
    close(near[1], 0);
    const hr = 0.2 + 1e-4, fall = Math.exp(-hr * hr / (0.35 * 0.35));
    close(near[0], -0.2 / hr * Math.min(hr / (0.25 * 0.35), 1) * 3 * fall);
    expect(Math.abs(at(1, [2, 0])[0])).toBeLessThan(1e-6);
    expect(at(-1, [0.2, 0])[0]).toBeGreaterThan(0);
  });
  it('Attract\'s Target socket wins over the card', () => {
    const { code, outputVars } = gen('agentAttract', { target: 'mouse', strength: 1, reach: 1, falloff: 'far' }, { target: 'T' });
    const f = runGlsl(code, { ...EXTRA, a_pos: [0, 0], T: [0.5, 0] })[outputVars.force] as number[];
    expect(f[0]).toBeGreaterThan(0);
  });
});

describe('Integrate', () => {
  /** Run Integrate n steps from (p, v) under a constant force. */
  function run(steps: number, p: number[], v: number[], force: number[], params: Record<string, unknown> = {}) {
    const { code, outputVars } = gen('agentIntegrate', { drag: 0, maxSpeed: 0, mass: 1, edges: 'free', ...params }, { force: 'F' });
    let pos = p, vel = v, last: Env = {};
    for (let k = 0; k < steps; k++) {
      last = runGlsl(code, { ...EXTRA, a_pos: pos, a_vel: vel, a_heading: 0, a_dt: DT, u_resolution: [200, 100], F: force });
      pos = last[outputVars.position] as number[];
      vel = last[outputVars.velocity] as number[];
    }
    return { pos, vel, env: last, outputVars };
  }
  it('matches the analytic fall of semi-implicit Euler: v_n = v0 + n·g·dt, p_n = p0 + n·dt·v0 + g·dt²·n(n+1)/2', () => {
    const N = 90, g = -2;
    const { pos, vel } = run(N, [0, 0.5], [0.3, 0.1], [0, g]);
    close(vel[0], 0.3); close(vel[1], 0.1 + N * g * DT);
    close(pos[0], N * DT * 0.3, 5);
    close(pos[1], 0.5 + N * DT * 0.1 + g * DT * DT * N * (N + 1) / 2, 5);
  });
  it('Drag bleeds speed as e^(−drag·t); Mass divides the force; Max speed caps it', () => {
    close(run(60, [0, 0], [1, 0], [0, 0], { drag: 2 }).vel[0], Math.exp(-2), 5);
    close(run(1, [0, 0], [0, 0], [0, 6], { mass: 3 }).vel[1], 2 * DT);
    close(Math.hypot(...run(1, [0, 0], [10, 0], [0, 0], { maxSpeed: 4 }).vel), 4);
  });
  it('Edges: Die kills a walker that leaves the picture; Wrap brings it back; heading follows the velocity', () => {
    const die = run(1, [1.99, 0], [6, 0], [0, 0], { edges: 'kill' });
    expect(die.env[die.outputVars.alive]).toBe(0);
    const wrap = run(1, [1.99, 0], [6, 0], [0, 0], { edges: 'wrap' });
    close(wrap.pos[0], -1.91);
    close(wrap.env[wrap.outputVars.heading] as number, 0);
  });
});

describe('Age / Life', () => {
  const at = (age: number, life: number, span = 1) => {
    const { code, outputVars } = gen('agentAge', { span }, {});
    const e = runGlsl(code, { ...EXTRA, a_age: age, a_life: life });
    const val = (k: string) => runGlsl(`float out = ${outputVars[k]};`, e).out as number;
    return { alive: val('alive'), unit: val('unit'), fade: val('fade') };
  };
  it('is alive under its Life (times Live for), dead past it', () => {
    expect(at(1, 4).alive).toBe(1);
    expect(at(4.1, 4).alive).toBe(0);
    expect(at(2.5, 4, 0.5).alive).toBe(0);
  });
  it('Age 0–1 and the Particles node\'s fade; walkers that live for ever never fade', () => {
    close(at(1, 4).unit, 0.25);
    close(at(3, 4).fade, smoothstep(0, 0.06, 0.75) * (1 - smoothstep(0.5, 1, 0.75)));
    expect(at(100, 1e30).fade).toBe(1);
    expect(at(100, 1e30).unit).toBe(0);
  });
});

describe('Flow and Collide read a field through its field function', () => {
  // A field that rises to the right: f(x, y) = 2x (a field function takes (p, …)).
  const field: Env = { fieldfn_test_v: (q: Val) => 2 * (q as number[])[0] };
  it('Flow Slope pushes up the field; Around along its contours', () => {
    const slope = gen('agentFlow', { mode: 'slope', strength: 1, step: 0.01 }, { field: 'fieldfn_test_v' });
    const f = runGlsl(slope.code, { ...EXTRA, ...field, a_pos: [0.1, 0.2] })[slope.outputVars.force] as number[];
    // GP: dir / |g| · min(|g|, 3) · force · 0.8 with g = (2, 0).
    close(f[0], 2 * 0.8, 5); close(f[1], 0, 5);
    const around = gen('agentFlow', { mode: 'around', strength: 1, step: 0.01 }, { field: 'fieldfn_test_v' });
    const a = runGlsl(around.code, { ...EXTRA, ...field, a_pos: [0.1, 0.2] })[around.outputVars.force] as number[];
    close(a[0], 0, 5); close(a[1], 2 * 0.8, 5);
  });
  it('Collide puts a walker inside the shape back on its surface and drops its inward velocity', () => {
    // A wall: distance x − 0.5 (negative left of x = 0.5, "inside").
    const wall: Env = { fieldfn_wall_v: (q: Val) => (q as number[])[0] - 0.5 };
    const { code, outputVars } = gen('agentCollide', { margin: 0.01, cushion: 0.08, bounce: 0, friction: 0 }, { shape: 'fieldfn_wall_v' });
    const e = runGlsl(code, { ...EXTRA, ...wall, a_pos: [0.45, 0], a_vel: [-1, 0.5], a_dt: DT });
    const p = e[outputVars.position] as number[], v = e[outputVars.velocity] as number[];
    close(p[0], 0.51, 5);
    close(v[0], 0, 5); close(v[1], 0.5, 5);
    expect(e[outputVars.hit]).toBe(1);
  });
});

describe('the Particles engine\'s shared GLSL', () => {
  it('GP_SIM and GP_DRAW_VERT are written with the shared pieces (so the Agents nodes use the same maths)', () => {
    const sim = GP_SHADERS.GP_SIM, draw = GP_SHADERS.GP_DRAW_VERT;
    for (const piece of [
      gpCurlAt('p', 'u_scale', 'u_noiseTime'), gpCurlOctave2('q'), gpCurlPlane('a', 'b'), gpGust('a'),
      gpSwirl('u_swirl', 'd', 'r', '0.25'), gpHandFall('hr', 'u_handReach'), gpHandPush('u_handForce', 'u_handSwirl', 'hd', 'hr', 'u_handReach', 'fall'),
      gpFlowPush('dir', 'gl', 'u_flowForce'), gpWavePhase('sr', 'u_time', 'u_waveSpeed'), gpWavePush('sdir', 'u_wave', 'lv', 'ph'),
      gpVibrate('sdir', 's', 'u_vibrate', 'lv', 'ph'), gpCrunch('s', 'u_crunch'), gpShockRing('kr', 'age', 'u_shockSpeed'),
      gpShockPush('kd', 'kr', 'u_shock[j].w', 'ring', 'age'), gpLevelGlsl('gpLevel', 'u_levels'), gpBesselGlsl('gpJ', 'u_bessel'),
      gpPlateGlsl('gpPlate', { count: 'u_plateN', modes: 'u_plateMode', shape: 'u_plate', sym: 'u_plateSym', J: 'gpJ' }),
      gpPlateStep('    ', { half: 'u_plateHalf', plate: 'gpPlate', settle: 'u_settle', shake: 'u_shake', dt: 'u_dt', shape: 'u_plate', s: 's' }),
    ]) expect(sim).toContain(piece);
    for (const piece of [GP_LIGHTS, gpPaletteGlsl('gpPalette', 'u_rainbow', 'u_pal'), gpFade('a')]) expect(draw).toContain(piece);
    // Draw agents' own vertex shader reuses the lights and palette as they are.
    expect(AG_DRAW_VERT).toContain(GP_LIGHTS);
    expect(AG_DRAW_VERT).toContain(gpPaletteGlsl('agPalette', 'u_rainbow', 'u_pal'));
  });
  it('Curl noise and Wind emit the engine\'s curl and gusts with their own names', () => {
    const curl = gen('agentCurl', {}, {}).code;
    expect(curl).toContain(gpCurlOctave2('N_q'));
    expect(curl).toContain(gpCurlPlane('N_a', 'N_b'));
    expect(getNodeDefinition('agentCurl')!.glslFunctions).toEqual([GP_SHADERS.GP_HASH, GP_SHADERS.GP_NOISE]);
    expect(gen('agentWind', {}, {}).code).toContain(gpGust('N_n'));
  });
  it('Sound kick emits the engine\'s shock ring and push; Chladni its plate and sand step', () => {
    const kick = gen('agentSoundKick', { mode: 'shock' }, {}).code;
    expect(kick).toContain('* 16.0 * N_ring * exp(-N_ring * N_ring) * exp(-N_age * 1.5)');
    expect(kick).toContain('u_agShk_N[N_j]');
    const def = getNodeDefinition('agentChladni')!;
    const node = n('agentChladni', 'N', 0, 0, { shape: 'circle' });
    expect(def.declarationsFor!(node)).toContain('uniform highp sampler2D u_agBessel;');
    expect(def.glslFunctionsFor!(node).join('\n')).toContain(gpBesselGlsl('agJ', 'u_agBessel'));
    expect(gen('agentChladni', {}, {}).code).toContain('float kick = u_agPlS_N * (0.12 * min(dist * 8.0, 1.0)');
  });
});

describe('the stand-in Beat', () => {
  it('jumps to 1 on each beat and decays before the next; 0 is off', () => {
    close(agBeatLevel(0, 120), 1);
    close(agBeatLevel(0.5, 120), 1);
    close(agBeatLevel(0.25, 120), Math.exp(-4.5), 5);
    expect(agBeatLevel(0.49, 120)).toBeLessThan(0.02);
    expect(agBeatLevel(1, 0)).toBe(0);
    expect(agBeatLevel(-1, 120)).toBe(0);
  });
});
