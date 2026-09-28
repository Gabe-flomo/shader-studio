/**
 * Emit: Multiply (play/particle-sim.js): one particle buds until the layer's
 * count is reached, with jittered, seeded split times; the life modes
 * (annihilate pairs and kills), what happens after (loop, respawn, hold), and
 * the goo (metaball) field's threshold maths.
 */
import { describe, it, expect } from 'vitest';
import { createParticles, gooAlpha, gooField, gooKernel, seededRandom, stepParticles, type ParticleEnv, type ParticleParams, type ParticleState } from '../particle-sim.js';
import { defaultLayer, emptyPlayRecord, type ParticlesLayer } from '../../types/play';
import { PLAY_EXAMPLE_GRAPHS } from '../../store/playExamples';
import { buildPlayHtml, DEFAULT_EMBED } from '../exportHtml';

const params = (over: Partial<ParticlesLayer> = {}): ParticleParams =>
  ({ ...(defaultLayer('particles', 'p', 'P') as ParticlesLayer), emit: 'multiply', spawn: 'center', spawnRadius: 0, field: 'none', edges: 'bounce', ...over }) as ParticleParams;
const env = (over: Partial<ParticleEnv> = {}): ParticleEnv => ({ dt: 1 / 60, time: 0, aspect: 1, sample: null, sw: 16, sh: 16, attractorPoint: null, spawnPoint: null, H: 720, ...over });
const aliveCount = (st: ParticleState) => st.alive.reduce((a, b) => a + b, 0);

/** Run `seconds` at 60 fps, calling `each` after every frame. */
function run(st: ParticleState, p: ParticleParams, e: ParticleEnv, seconds: number, rand: () => number, each?: (t: number) => void) {
  const frames = Math.round(seconds * 60);
  for (let f = 0; f < frames; f++) { e.time += 1 / 60; stepParticles(st, p, e, rand); each?.(e.time); }
}

describe('multiply: growth', () => {
  it('starts from one particle and grows to the count, doubling about every 1 / splitRate s', () => {
    const rand = seededRandom(11), st = createParticles(200, rand, true), p = params({ splitRate: 1, splitJitter: 0.3, multLife: 'stay', multAfter: 'hold' }), e = env();
    const curve: number[] = [];
    run(st, p, e, 14, rand, () => curve.push(aliveCount(st)));
    expect(curve[0]).toBe(1);
    // Never shrinks (stay + hold: nothing dies) and reaches the count.
    for (let i = 1; i < curve.length; i++) expect(curve[i]).toBeGreaterThanOrEqual(curve[i - 1]);
    expect(curve[curve.length - 1]).toBe(200);
    // Exponential: about 2^3 after 3 s, about 2^5 after 5 s (jitter makes it looser).
    const at = (s: number) => curve[Math.round(s * 60) - 1];
    expect(at(3)).toBeGreaterThanOrEqual(4); expect(at(3)).toBeLessThanOrEqual(16);
    expect(at(5)).toBeGreaterThanOrEqual(14); expect(at(5)).toBeLessThanOrEqual(64);
    const full = curve.indexOf(200) / 60;
    expect(full).toBeGreaterThan(5.5); expect(full).toBeLessThan(11);
  });

  it('more buds per split fills sooner; a faster rate fills sooner', () => {
    const fillTime = (over: Partial<ParticlesLayer>) => {
      const rand = seededRandom(3), st = createParticles(150, rand, true), p = params({ multLife: 'stay', multAfter: 'hold', ...over }), e = env();
      let t = -1;
      run(st, p, e, 30, rand, now => { if (t < 0 && aliveCount(st) === 150) t = now; });
      return t;
    };
    const base = fillTime({ splitRate: 1 });
    expect(fillTime({ splitRate: 1, splitChildren: 3 })).toBeLessThan(base * 0.75);
    expect(fillTime({ splitRate: 2 })).toBeLessThan(base * 0.65);
  });

  it('a bud starts at its parent and the two are pushed apart', () => {
    const rand = seededRandom(5), st = createParticles(10, rand, true), p = params({ splitRate: 2, splitJitter: 0, multLife: 'stay', multAfter: 'hold', multSpread: 0 }), e = env();
    run(st, p, e, 0.52, rand); // the first split happens at 0.5 s
    expect(aliveCount(st)).toBe(2);
    const d = Math.hypot(st.x[1] - st.x[0], st.y[1] - st.y[0]);
    expect(d).toBeLessThan(0.02);
    // Moving apart: velocities point away from each other.
    const rel = (st.vx[1] - st.vx[0]) * (st.x[1] - st.x[0]) + (st.vy[1] - st.vy[0]) * (st.y[1] - st.y[0]);
    expect(rel).toBeGreaterThan(0);
    run(st, p, e, 0.4, rand);
    expect(Math.hypot(st.x[1] - st.x[0], st.y[1] - st.y[0])).toBeGreaterThan(d);
  });
});

describe('multiply: jitter and determinism', () => {
  const snapshot = (seed: number, jitter: number) => {
    const rand = seededRandom(seed), st = createParticles(120, rand, true), p = params({ splitRate: 1.5, splitJitter: jitter, multLife: 'annihilate', multAfter: 'loop', pairRadius: 0.3 }), e = env();
    const births: number[] = [];
    let last = 0;
    run(st, p, e, 12, rand, t => { const n = aliveCount(st); if (n > last) births.push(Math.round(t * 60)); last = n; });
    return { x: Array.from(st.x), y: Array.from(st.y), alive: Array.from(st.alive), births };
  };

  it('the same seed replays exactly (positions, deaths, birth frames)', () => {
    expect(snapshot(42, 0.4)).toEqual(snapshot(42, 0.4));
  });

  it('a different seed grows differently', () => {
    expect(snapshot(42, 0.4).x).not.toEqual(snapshot(43, 0.4).x);
  });

  it('jitter spreads the split times; with none, siblings split in lockstep', () => {
    const intervals = (jitter: number) => {
      const rand = seededRandom(9), st = createParticles(64, rand, true), p = params({ splitRate: 1, splitJitter: jitter, multLife: 'stay', multAfter: 'hold' }), e = env();
      run(st, p, e, 0.01, rand);
      run(st, p, e, 3.5, rand);
      return Array.from(st.split).filter((_, i) => st.alive[i]);
    };
    const even = intervals(0), jittered = intervals(0.8);
    // No jitter: births land on whole seconds, so the population is a power of two.
    expect([1, 2, 4, 8, 16]).toContain(even.length);
    const spread = (a: number[]) => Math.max(...a) - Math.min(...a);
    expect(spread(jittered)).toBeGreaterThan(0.5);
    expect(new Set(jittered.map(v => v.toFixed(3))).size).toBeGreaterThan(jittered.length / 2);
  });
});

describe('multiply: annihilate', () => {
  it('pairs are mutual, seek each other and die together in a burst', () => {
    const rand = seededRandom(21), st = createParticles(30, rand, true), p = params({ splitRate: 2, multLife: 'annihilate', multAfter: 'hold', pairRadius: 0.5, seekSpeed: 0.2 }), e = env();
    // Grow until full.
    run(st, p, e, 8, rand);
    expect(st.mx?.reached).toBe(true);
    let paired = 0;
    for (let i = 0; i < st.count; i++) {
      const m = st.mate[i];
      if (m < 0 || !st.alive[i]) continue;
      paired++;
      expect(st.mate[m]).toBe(i);
      expect(m).not.toBe(i);
    }
    expect(paired).toBeGreaterThan(0);
    // Deaths come in twos, and nothing is left behind (Loop, so no splits refill the colony here).
    const loop = { ...p, multAfter: 'loop' as const };
    let deaths = 0;
    for (let f = 0; f < 120; f++) {
      const a0 = aliveCount(st);
      stepParticles(st, loop, e, rand);
      if (st.mx?.phase !== 'full') break; // cleared, and the loop started over
      const died = a0 - aliveCount(st);
      expect(died % 2).toBe(0);
      deaths += died;
    }
    expect(deaths).toBeGreaterThan(0);
    expect((st as unknown as Record<string, unknown>).fx).toBeUndefined();
  });

  it('no pairing while the colony is still growing', () => {
    const rand = seededRandom(4), st = createParticles(400, rand, true), p = params({ splitRate: 1, multLife: 'annihilate', multAfter: 'loop' }), e = env();
    run(st, p, e, 5, rand);
    expect(st.mx?.reached).toBe(false);
    expect(Array.from(st.mate).every(m => m === -1)).toBe(true);
  });
});

describe('multiply: after the count is reached', () => {
  it('loop: annihilate clears the colony, then it starts again from one', () => {
    const rand = seededRandom(8), st = createParticles(24, rand, true), p = params({ splitRate: 2, multLife: 'annihilate', multAfter: 'loop', pairRadius: 0.3, seekSpeed: 0.3 }), e = env();
    let restarts = 0, prevCycles = 0, sawOneAfter = false;
    run(st, p, e, 40, rand, () => {
      const c = st.mx?.cycles ?? 0;
      if (c > prevCycles) { restarts++; prevCycles = c; if (aliveCount(st) === 1) sawOneAfter = true; }
    });
    expect(restarts).toBeGreaterThanOrEqual(2);
    expect(sawOneAfter).toBe(true);
  });

  it('loop: no splitting once full; Loop hold restarts a colony that never dies', () => {
    const rand = seededRandom(8), st = createParticles(16, rand, true), p = params({ splitRate: 2, multLife: 'stay', multAfter: 'loop', loopHold: 2 }), e = env();
    let cycles = 0;
    run(st, p, e, 12, rand, () => { cycles = st.mx?.cycles ?? 0; });
    expect(cycles).toBeGreaterThanOrEqual(1);
  });

  it('respawn: the dead come back at the origin and the colony refills', () => {
    const rand = seededRandom(13), st = createParticles(20, rand, true), p = params({ splitRate: 2, multLife: 'annihilate', multAfter: 'respawn', pairRadius: 0.5, seekSpeed: 0.3 }), e = env();
    run(st, p, e, 6, rand);
    expect(st.mx?.reached).toBe(true);
    let min = Infinity, reborn = false;
    run(st, p, e, 15, rand, () => {
      min = Math.min(min, aliveCount(st));
      for (let i = 0; i < st.count; i++) if (st.alive[i] && st.age[i] < 0.02 && st.x[i] === 0.5 && st.y[i] === 0.5) reborn = true;
    });
    expect(min).toBeLessThan(20);
    expect(reborn).toBe(true);
    expect(aliveCount(st)).toBeGreaterThan(0);
  });

  it('hold: survivors keep splitting to stay at the full count', () => {
    const rand = seededRandom(17), st = createParticles(20, rand, true), p = params({ splitRate: 2, multLife: 'stay', multAfter: 'hold', life: 3 }), e = env();
    run(st, p, e, 30, rand);
    // Lives run out (3 s ± 40%), yet the colony stays near full.
    expect(aliveCount(st)).toBeGreaterThanOrEqual(12);
  });

  it('flow: particles follow the field, and ones leaving the picture die instead of respawning', () => {
    const rand = seededRandom(2), st = createParticles(30, rand, true), p = params({ splitRate: 2, multLife: 'flow', multAfter: 'loop', loopHold: 0, field: 'noise', speed: 3, edges: 'respawn' }), e = env();
    let drops = 0, prev = 1, moved = 0;
    run(st, p, e, 10, rand, () => {
      const n = aliveCount(st);
      if (n < prev) drops++;
      prev = n;
      for (let i = 0; i < st.count; i++) if (st.alive[i] && Math.hypot(st.vx[i], st.vy[i]) > 0.3) moved++;
    });
    expect(drops).toBeGreaterThan(0);
    expect(moved).toBeGreaterThan(0); // the noise field at speed 3 (0.54 heights/s) takes over from the gentle bud push
  });
});

describe('goo field', () => {
  it('kernel: 1 at the middle, 0 at the reach, smooth in between', () => {
    expect(gooKernel(0, 10)).toBe(1);
    expect(gooKernel(10, 10)).toBe(0);
    expect(gooKernel(15, 10)).toBe(0);
    expect(gooKernel(5, 10)).toBeCloseTo(0.5625, 6); // (1 - 1/4)^2
  });

  it('threshold: hard edge at soft 0, a smooth band otherwise', () => {
    expect(gooAlpha(0.49, 0.5, 0)).toBe(0);
    expect(gooAlpha(0.5, 0.5, 0)).toBe(1);
    expect(gooAlpha(0.5, 0.5, 0.4)).toBeCloseTo(0.5, 6);
    expect(gooAlpha(0.3, 0.5, 0.4)).toBe(0); // below the band: 0.5 × (1 − 0.4) = 0.3
    expect(gooAlpha(0.7, 0.5, 0.4)).toBe(1); // above: 0.5 + 0.5 × 0.4 = 0.7
    let prev = -1;
    for (let v = 0; v <= 1; v += 0.02) { const a = gooAlpha(v, 0.5, 0.4); expect(a).toBeGreaterThanOrEqual(prev); prev = a; }
  });

  it('a lone blob has radius R·√(1 − √threshold)', () => {
    const R = 20, t = 0.5, r = R * Math.sqrt(1 - Math.sqrt(t));
    expect(gooAlpha(gooKernel(r - 0.01, R), t, 0)).toBe(1);
    expect(gooAlpha(gooKernel(r + 0.01, R), t, 0)).toBe(0);
  });

  /** Two particles `apart` pixels apart across a 200 × 100 picture; the field's value halfway between them. */
  const midpoint = (apart: number) => {
    const st = createParticles(2, seededRandom(1));
    const W = 200, H = 100;
    st.x[0] = (100 - apart / 2) / W; st.x[1] = (100 + apart / 2) / W; st.y[0] = st.y[1] = 0.5;
    const p = params({ size: 10, sizeJitter: 0, gooBlend: 2 });
    const { v, rgb } = gooField(st, p, env({ W, H } as Partial<ParticleEnv>) as ParticleEnv & { W: number; H: number }, W, H, 1);
    const k = 50 * W + 99; // cell centre (99.5, 50.5), next to the middle
    return { v: v[k], rgb: [rgb[k * 3], rgb[k * 3 + 1], rgb[k * 3 + 2]], R: 20 };
  };

  it('two touching particles merge: the sum between them passes the threshold, far apart it does not', () => {
    const t = 0.5, R = 20, lone = R * Math.sqrt(1 - Math.sqrt(t)); // each blob alone: ~10.8 px
    // Just past touching (their lone blobs would not overlap) they still join with a neck.
    const near = midpoint(lone * 2 + 4);
    expect(near.v).toBeGreaterThan(t);
    expect(gooAlpha(near.v, t, 0)).toBe(1);
    // Far apart: nothing between them.
    const far = midpoint(36);
    expect(gooAlpha(far.v, t, 0)).toBe(0);
    // The sum is exact: two bumps at half the spacing.
    const d = 30;
    expect(midpoint(d).v).toBeCloseTo(gooKernel(Math.hypot(d / 2 - 0.5, 0.5), R) + gooKernel(Math.hypot(d / 2 + 0.5, 0.5), R), 4);
  });

  it('colour is the field-weighted blend (divide rgb by v)', () => {
    const m = midpoint(20);
    const white = params().color; // default tint is white
    expect(m.rgb[0] / m.v).toBeCloseTo(white[0], 5);
  });
});

describe('the Multiply example', () => {
  it('buds 200 particles in goo, annihilating and looping', () => {
    const ex = PLAY_EXAMPLE_GRAPHS.playMultiply;
    expect(ex).toBeTruthy();
    const l = ex.play!.layers[0] as ParticlesLayer;
    expect(l).toMatchObject({ kind: 'particles', count: 200, emit: 'multiply', goo: true, multLife: 'annihilate', multAfter: 'loop' });
  });
});

describe('website exports', () => {
  it('carry Multiply and Goo in the inlined kit', () => {
    const html = buildPlayHtml({ title: 'P', fragmentShader: 'void main(){}', uniforms: {}, paramBindings: {}, play: emptyPlayRecord(), aspect: 'free' }, DEFAULT_EMBED);
    expect(html).toContain('function multiplyLife(');
    expect(html).toContain('function drawGoo(');
  });
});
