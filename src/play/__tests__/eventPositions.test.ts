/**
 * Where particle events happen (simplification plan, phase 7): the
 * simulation remembers the latest birth, death and annihilation (the last in
 * a step wins), the kit reports them, and the anchor `ev:<layer>:<event>`
 * lets a signal capture the spot ("when a particle annihilates, move the
 * circle to where it happened") in the app and on a website.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});
import { burstParticles, createParticles, cullParticles, resizeParticles, seededRandom, stepParticles, type ParticleEnv, type ParticleParams, type ParticleState } from '../particle-sim.js';
import { mapAnchor } from '../playRefs';
import { anchorLabel } from '../playSources';
import { playEngine } from '../../lib/playEngine';
import { inputBus } from '../../lib/inputBus';
import { defaultLayer, emptyPlayRecord, parseEventAnchor, type ParticlesLayer, type PlayLayer } from '../../types/play';

afterEach(() => { playEngine.setRecord(emptyPlayRecord()); });

const params = (over: Partial<ParticlesLayer> = {}): ParticleParams => ({ ...(defaultLayer('particles', 'p', 'P') as ParticlesLayer), ...over }) as ParticleParams;
const env = (over: Partial<ParticleEnv> = {}): ParticleEnv => ({ dt: 1 / 60, time: 0, aspect: 1, sample: null, sw: 16, sh: 16, attractorPoint: null, spawnPoint: null, H: 720, ...over });
function run(st: ParticleState, p: ParticleParams, e: ParticleEnv, frames: number, rand: () => number) {
  for (let f = 0; f < frames; f++) { e.time += e.dt; stepParticles(st, p, e, rand); }
}

describe('the simulation', () => {
  it('knows nothing before the first event', () => {
    const st = createParticles(10, seededRandom(1), true);
    expect([st.bornX, st.diedX, st.annX].every(Number.isNaN)).toBe(true);
  });

  it('a burst remembers where the last particle was born; a death where it went', () => {
    const rand = seededRandom(2), st = createParticles(30, rand, true);
    const p = params({ emit: 'burst', spawn: 'center', spawnRadius: 0, life: 0.2 });
    burstParticles(st, p, env(), 5, rand);
    expect(st.bornX).toBeCloseTo(0.5, 1); expect(st.bornY).toBeCloseTo(0.5, 1);
    run(st, p, env(), 30, rand);
    expect(Number.isFinite(st.diedX)).toBe(true);
    cullParticles(st, p, env(), 1, rand);
    expect(st.diedX).toBeGreaterThanOrEqual(0);
  });

  it('an annihilation is halfway between the two that met, and also a death there', () => {
    const rand = seededRandom(10), st = createParticles(40, rand, true);
    const p = params({ emit: 'multiply', spawn: 'center', spawnRadius: 0, field: 'none', edges: 'bounce', splitRate: 3, multLife: 'annihilate', multAfter: 'hold', pairRadius: 2, seekSpeed: 1 });
    run(st, p, env(), 600, rand);
    expect(Number.isFinite(st.annX)).toBe(true);
    expect(st.annX).toBeGreaterThanOrEqual(0); expect(st.annX).toBeLessThanOrEqual(1);
    // Keeps them through a resize.
    const bigger = resizeParticles(st, 60, rand);
    expect([bigger.annX, bigger.annY]).toEqual([st.annX, st.annY]);
  });
});

describe('the anchor', () => {
  it('parses, names and renames', () => {
    expect(parseEventAnchor('ev:layer_1:annihilate')).toEqual({ layerId: 'layer_1', event: 'annihilate' });
    expect(parseEventAnchor('ev:layer_1:split')).toBeNull();
    expect(anchorLabel('ev:p:born', [{ id: 'p', label: 'Sparks' }])).toBe('Sparks · latest birth');
    expect(mapAnchor('ev:p:died', (_k, id) => `${id}2`)).toBe('ev:p2:died');
  });

  it('the engine reads it from what the kit reports, and a sent signal captures it', () => {
    const sparks = { ...defaultLayer('particles', 'p', 'Sparks'), emit: 'multiply', annihilateSignal: 's' } as PlayLayer;
    playEngine.setRecord({ ...emptyPlayRecord(), layers: [sparks], signals: [{ id: 's', name: 'Met', capture: { what: 'pos:ev:p:annihilate', at: 'rise' } }] });
    expect(playEngine.anchorAt('ev:p:annihilate')).toBeNull();
    let t = 1;
    const tick = () => inputBus.tick(1 / 60, (t += 1 / 60));
    // The kit's report, as a frame of the overlay sends it: no annihilation yet, then one at (0.3, 0.7).
    playEngine.setSensor('p::annihilate', 0); tick();
    playEngine.setSensor('p::annihilateX', 0.3); playEngine.setSensor('p::annihilateY', 0.7); playEngine.setSensor('p::annihilate', 1); tick();
    expect(playEngine.anchorAt('ev:p:annihilate')).toEqual({ x: 0.3, y: 0.7 });
    expect(playEngine.signalPayload('s')).toEqual({ x: 0.3, y: 0.7 });
  });
});
