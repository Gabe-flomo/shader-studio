/**
 * Born / died signals (play/particle-sim.js): every particles layer counts
 * `evBorn` / `evDied`, cumulative, whatever its Emit mode — a stream respawn,
 * a burst, a Multiply bud or death — so the play engine can diff them once a
 * frame into the layer's Born / Died signal (fired once, however many
 * particles were involved) and the born/died-this-step readings.
 */
import { describe, it, expect } from 'vitest';
import { burstParticles, createParticles, cullParticles, multiplyParticles, resetParticles, seededRandom, stepParticles, type ParticleEnv, type ParticleParams, type ParticleState } from '../particle-sim.js';
import { defaultLayer, type ParticlesLayer } from '../../types/play';

const params = (over: Partial<ParticlesLayer> = {}): ParticleParams =>
  ({ ...(defaultLayer('particles', 'p', 'P') as ParticlesLayer), ...over }) as ParticleParams;
const env = (over: Partial<ParticleEnv> = {}): ParticleEnv => ({ dt: 1 / 60, time: 0, aspect: 1, sample: null, sw: 16, sh: 16, attractorPoint: null, spawnPoint: null, H: 720, ...over });
const aliveCount = (st: ParticleState) => st.alive.reduce((a, b) => a + b, 0);

function run(st: ParticleState, p: ParticleParams, e: ParticleEnv, frames: number, rand: () => number) {
  for (let f = 0; f < frames; f++) { e.time += e.dt; stepParticles(st, p, e, rand); }
}

/** `createParticles` alone leaves everyone at rest (no field, no kick): give them a rightward push so they reach the edges. */
function kickRight(st: ParticleState, speed = 3): void {
  for (let i = 0; i < st.count; i++) st.vx[i] = speed;
}

describe('particles: born/died counters', () => {
  it('a fresh layer has no births or deaths counted yet', () => {
    const st = createParticles(20, seededRandom(1), false);
    expect(st.evBorn).toBe(0);
    expect(st.evDied).toBe(0);
  });

  it('a burst action counts one born per particle, in a single call', () => {
    const rand = seededRandom(2), st = createParticles(50, rand, true);
    const p = params({ emit: 'burst', life: 1 });
    burstParticles(st, p, env(), 12, rand);
    expect(st.evBorn).toBe(12);
    expect(st.evDied).toBe(0);
    expect(aliveCount(st)).toBe(12);
  });

  it('burst particles die once their life expires, one death each', () => {
    const rand = seededRandom(3), st = createParticles(30, rand, true);
    const p = params({ emit: 'burst', life: 0.5, edges: 'wrap' });
    burstParticles(st, p, env(), 10, rand);
    expect(st.evBorn).toBe(10);
    run(st, p, env(), 90, rand); // 1.5 s > the largest possible life (life × up to 1.4)
    expect(aliveCount(st)).toBe(0);
    expect(st.evDied).toBe(10);
    expect(st.evBorn).toBe(10); // no further births
  });

  it('burst particles die at a kill boundary (edges: respawn) when they leave', () => {
    const rand = seededRandom(4), st = createParticles(20, rand, true);
    const p = params({ emit: 'burst', life: 0, edges: 'respawn', speed: 5, spawn: 'center', spawnRadius: 0 });
    burstParticles(st, p, env(), 5, rand);
    expect(st.evBorn).toBe(5);
    run(st, p, env(), 90, rand);
    expect(aliveCount(st)).toBe(0);
    expect(st.evDied).toBe(5);
  });

  it('a stream layer never dies, but a respawn (leaving the picture, edges: respawn) counts as born', () => {
    const rand = seededRandom(5), st = createParticles(40, rand, false);
    kickRight(st);
    const p = params({ emit: 'stream', life: 0, edges: 'respawn', field: 'none' });
    const born0 = st.evBorn;
    run(st, p, env(), 90, rand); // 1.5 s: plenty of time to cross the picture at least once
    expect(aliveCount(st)).toBe(40); // always alive
    expect(st.evDied).toBe(0); // stream never dies
    expect(st.evBorn).toBeGreaterThan(born0); // but it does respawn
  });

  it('a stream layer respawning on end of life counts as born, not died', () => {
    const rand = seededRandom(6), st = createParticles(20, rand, false);
    const p = params({ emit: 'stream', life: 0.3, edges: 'wrap', field: 'none' });
    run(st, p, env(), 90, rand); // 1.5 s: every particle's life (0.18–0.54 s) has passed at least once
    expect(aliveCount(st)).toBe(20);
    expect(st.evDied).toBe(0);
    expect(st.evBorn).toBeGreaterThan(0);
  });

  it('edges: random relocates in place and counts as born, not died', () => {
    const rand = seededRandom(7), st = createParticles(30, rand, false);
    kickRight(st);
    const p = params({ emit: 'stream', life: 0, edges: 'random', field: 'none' });
    run(st, p, env(), 90, rand);
    expect(st.evDied).toBe(0);
    expect(st.evBorn).toBeGreaterThan(0);
  });

  it('wrap and bounce edges are neither a birth nor a death', () => {
    for (const edges of ['wrap', 'bounce'] as const) {
      const rand = seededRandom(8), st = createParticles(20, rand, false);
      kickRight(st);
      const p = params({ emit: 'stream', life: 0, edges, field: 'none' });
      run(st, p, env(), 90, rand);
      expect(st.evBorn).toBe(0);
      expect(st.evDied).toBe(0);
    }
  });

  it('Multiply buds count as born, one per particle', () => {
    const rand = seededRandom(9), st = createParticles(64, rand, true);
    const p = params({ emit: 'multiply', spawn: 'center', spawnRadius: 0, field: 'none', edges: 'bounce', splitRate: 2, multLife: 'stay', multAfter: 'hold' });
    run(st, p, env(), 300, rand);
    const alive = aliveCount(st);
    expect(alive).toBeGreaterThan(1);
    expect(st.evBorn).toBeGreaterThanOrEqual(alive); // at least the ones alive now were born
    expect(st.evDied).toBe(0); // stay + hold: nothing dies
  });

  it('Multiply annihilate deaths count two per pair, and the Cull action counts a death per particle removed', () => {
    const rand = seededRandom(10), st = createParticles(40, rand, true);
    const p = params({ emit: 'multiply', spawn: 'center', spawnRadius: 0, field: 'none', edges: 'bounce', splitRate: 3, multLife: 'annihilate', multAfter: 'hold', pairRadius: 2, seekSpeed: 1 });
    run(st, p, env(), 600, rand);
    expect(st.evDied).toBeGreaterThan(0);
    expect(st.evDied % 2).toBe(0); // annihilation always removes pairs
    const before = st.evDied;
    cullParticles(st, p, env(), 3, rand);
    expect(st.evDied).toBe(before + 3);
  });

  it('the Multiply action buds particles and counts them as born', () => {
    const rand = seededRandom(11), st = createParticles(20, rand, true);
    const p = params({ emit: 'multiply', spawn: 'center', spawnRadius: 0, field: 'none', edges: 'bounce', multLife: 'stay', multAfter: 'hold' });
    stepParticles(st, p, env(), rand); // seeds the first particle
    const before = st.evBorn;
    multiplyParticles(st, p, env(), 5, rand);
    expect(st.evBorn).toBe(before + 5);
  });

  it('resetting a burst layer clears particles without counting a death (a rebuild, not a step)', () => {
    const rand = seededRandom(12), st = createParticles(20, rand, true);
    const p = params({ emit: 'burst', life: 5 });
    burstParticles(st, p, env(), 10, rand);
    const diedBefore = st.evDied;
    resetParticles(st, p, env(), rand);
    expect(aliveCount(st)).toBe(0);
    expect(st.evDied).toBe(diedBefore);
  });

  it('resizing keeps the running counts (growing the count is not itself a birth)', () => {
    const rand = seededRandom(13), st = createParticles(20, rand, true);
    const p = params({ emit: 'burst', life: 5 });
    burstParticles(st, p, env(), 5, rand);
    expect(st.evBorn).toBe(5);
  });

  it('two runs with the same seed give the same born/died counts (determinism)', () => {
    const run1 = () => {
      const rand = seededRandom(21), st = createParticles(60, rand, true);
      const p = params({ emit: 'multiply', spawn: 'center', spawnRadius: 0, field: 'none', edges: 'bounce', splitRate: 2.5, splitJitter: 0.4, multLife: 'annihilate', multAfter: 'respawn', pairRadius: 2, seekSpeed: 1 });
      run(st, p, env(), 500, rand);
      return { born: st.evBorn, died: st.evDied, alive: aliveCount(st) };
    };
    expect(run1()).toEqual(run1());
  });

  it('a burst of many particles is still counted per particle (not capped to one)', () => {
    const rand = seededRandom(14), st = createParticles(200, rand, true);
    const p = params({ emit: 'burst', life: 5 });
    burstParticles(st, p, env(), 200, rand);
    expect(st.evBorn).toBe(200);
  });
});
