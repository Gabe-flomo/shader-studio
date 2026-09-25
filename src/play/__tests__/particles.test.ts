/**
 * The particles layer's system (play/particle-sim.js): fields, the flat-area
 * choice (wander keeps moving, settle freezes into patterns), attractors,
 * respawning at edges / end of life / when caught, what size and opacity can
 * follow, and old files' `mode` / `colorFromPicture` carried over.
 */
import { describe, it, expect } from 'vitest';
import { brightnessAt, createParticles, modulator, paletteColour, PARTICLE_PALETTES, stepParticles, type ParticleEnv, type ParticleParams } from '../particle-sim.js';
import { buildPlayHtml, DEFAULT_EMBED } from '../exportHtml';
import { defaultLayer, emptyPlayRecord, parsePlayRecord, type ParticlesLayer } from '../../types/play';

/** Seeded random so runs repeat. */
function seeded(seed = 1): () => number {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** An sw × sh RGBA grid whose grey level is f(x, y) with x, y in 0..1, y up. */
function picture(f: (x: number, y: number) => number, sw = 16, sh = 16): Uint8ClampedArray {
  const d = new Uint8ClampedArray(sw * sh * 4);
  for (let py = 0; py < sh; py++) for (let px = 0; px < sw; px++) {
    const v = Math.round(f((px + 0.5) / sw, 1 - (py + 0.5) / sh) * 255), k = (py * sw + px) * 4;
    d[k] = d[k + 1] = d[k + 2] = v; d[k + 3] = 255;
  }
  return d;
}

const params = (over: Partial<ParticlesLayer> = {}): ParticleParams => ({ ...(defaultLayer('particles', 'p', 'P') as ParticlesLayer), ...over });
const env = (over: Partial<ParticleEnv> = {}): ParticleEnv => ({ dt: 1 / 60, time: 0, aspect: 1, sample: null, sw: 16, sh: 16, attractorPoint: null, spawnPoint: null, ...over });
const run = (st: ReturnType<typeof createParticles>, p: ParticleParams, e: ParticleEnv, frames: number, rand = seeded(2)) => {
  for (let f = 0; f < frames; f++) { e.time = f / 60; stepParticles(st, p, e, rand); }
};
const meanSpeed = (st: ReturnType<typeof createParticles>) => { let s = 0; for (let i = 0; i < st.count; i++) s += Math.hypot(st.vx[i], st.vy[i]); return s / st.count; };

describe('particle fields', () => {
  it('flow on black heads right (heading 0)', () => {
    const st = createParticles(50, seeded());
    const x0 = Array.from(st.x);
    run(st, params({ field: 'flow', edges: 'bounce', speed: 1, steer: 1 }), env({ sample: picture(() => 0) }), 30);
    let right = 0;
    for (let i = 0; i < st.count; i++) if (st.vx[i] > 0 && Math.abs(st.vy[i]) < st.vx[i]) right++;
    expect(right).toBeGreaterThan(st.count * 0.7);
    expect(Array.from(st.x).some((x, i) => x !== x0[i])).toBe(true);
  });

  it('climb moves toward the light, descend toward the dark', () => {
    const ramp = picture(x => x); // brighter to the right
    const up = createParticles(200, seeded(3)), down = createParticles(200, seeded(3));
    run(up, params({ field: 'climb', steer: 1 }), env({ sample: ramp }), 20);
    run(down, params({ field: 'descend', steer: 1 }), env({ sample: ramp }), 20);
    const mvx = (st: typeof up) => Array.from(st.vx).reduce((a, b) => a + b, 0) / st.count;
    expect(mvx(up)).toBeGreaterThan(0.05);
    expect(mvx(down)).toBeLessThan(-0.05);
  });

  it('on flat areas, wander keeps moving and settle slows to a stop', () => {
    const flat = picture(() => 0.5);
    const wander = createParticles(100, seeded(4)), settle = createParticles(100, seeded(4));
    // Give both a push first so "settle" has something to lose.
    for (const st of [wander, settle]) for (let i = 0; i < st.count; i++) { st.vx[i] = 0.1; st.vy[i] = 0; }
    run(wander, params({ field: 'climb', flat: 'wander' }), env({ sample: flat }), 120);
    run(settle, params({ field: 'climb', flat: 'settle' }), env({ sample: flat }), 120);
    expect(meanSpeed(wander)).toBeGreaterThan(0.05);
    expect(meanSpeed(settle)).toBeLessThan(0.001);
  });

  it('the noise field moves particles without a picture', () => {
    const st = createParticles(100, seeded(5));
    run(st, params({ field: 'noise' }), env(), 60);
    expect(meanSpeed(st)).toBeGreaterThan(0.05);
  });
});

describe('attractor and respawning', () => {
  it('gravitate pulls particles in', () => {
    const st = createParticles(200, seeded(6));
    const dist = () => Array.from(st.x).reduce((a, x, i) => a + Math.hypot(x - 0.5, st.y[i] - 0.5), 0) / st.count;
    const before = dist();
    run(st, params({ field: 'none', attractor: 'mouse', strength: 2, catchRadius: 0, edges: 'bounce' }), env({ attractorPoint: { x: 0.5, y: 0.5 } }), 60);
    expect(dist()).toBeLessThan(before * 0.8);
  });

  it('a caught particle respawns where particles are born', () => {
    const st = createParticles(1, seeded(7));
    st.x[0] = 0.5; st.y[0] = 0.505;
    stepParticles(st, params({ field: 'none', attractor: 'null', catchRadius: 0.05, spawn: 'edges' }), env({ attractorPoint: { x: 0.5, y: 0.5 } }), seeded(8));
    const onEdge = st.x[0] === 0 || st.x[0] === 1 || st.y[0] === 0 || st.y[0] === 1;
    expect(onEdge).toBe(true);
    expect(st.age[0]).toBe(0);
  });

  it('edges: wrap comes back on the other side, respawn starts again at the spawn point', () => {
    const p = params({ field: 'none', speed: 1 });
    const a = createParticles(1, seeded(9));
    a.x[0] = 0.999; a.y[0] = 0.5; a.vx[0] = 1; a.vy[0] = 0;
    stepParticles(a, { ...p, edges: 'wrap' }, env({ dt: 0.05 }));
    expect(a.x[0]).toBeLessThan(0.1);
    const b = createParticles(1, seeded(9));
    b.x[0] = 0.999; b.y[0] = 0.5; b.vx[0] = 1; b.vy[0] = 0;
    stepParticles(b, { ...p, edges: 'respawn', spawn: 'null', spawnRadius: 0 }, env({ dt: 0.05, spawnPoint: { x: 0.25, y: 0.75 } }));
    expect(b.x[0]).toBeCloseTo(0.25, 5);
    expect(b.y[0]).toBeCloseTo(0.75, 5);
  });

  it('a particle respawns when its life runs out', () => {
    const st = createParticles(1, seeded(10));
    st.x[0] = 0.3; st.y[0] = 0.3; st.age[0] = 5; st.life[0] = 1;
    stepParticles(st, params({ field: 'none', life: 2, spawn: 'center', spawnRadius: 0 }), env());
    expect(st.x[0]).toBeCloseTo(0.5, 5);
    expect(st.age[0]).toBe(0);
  });
});

describe('what size and opacity follow', () => {
  it('nearness to a null is 1 at the null and 0 past the falloff', () => {
    const st = createParticles(2, seeded(11));
    st.x[0] = 0.5; st.y[0] = 0.5; st.x[1] = 0.9; st.y[1] = 0.5;
    const p = params({ falloff: 0.2 }), e = env({ modPoint: { x: 0.5, y: 0.5 } });
    expect(modulator('null', st, 0, p, e)).toBeCloseTo(1, 5);
    expect(modulator('null', st, 1, p, e)).toBe(0);
  });

  it('brightness is sampled smoothly between pixels', () => {
    const d = new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255]); // 2 × 1: black, white
    expect(brightnessAt(d, 2, 1, 0.5, 0.5)).toBeCloseTo(0.5, 2);
    expect(brightnessAt(d, 2, 1, 0.25, 0.5)).toBeCloseTo(0, 2);
  });

  it('palettes stay in range', () => {
    for (let i = 0; i < PARTICLE_PALETTES.length; i++) for (const t of [0, 0.3, 0.7, 1]) {
      for (const c of paletteColour(i, t)) { expect(c).toBeGreaterThanOrEqual(0); expect(c).toBeLessThanOrEqual(1); }
    }
  });
});

describe('particles in play files and web exports', () => {
  it('old layers keep their look: mode becomes the field, climb/descend settle, picture colour carries over', () => {
    const rec = parsePlayRecord({ version: 1, controls: [], mappings: [], layers: [{ id: 'd', kind: 'particles', label: 'Dust', visible: true, count: 300, mode: 'descend', colorFromPicture: true, speed: 1, size: 2, opacity: 1, color: [1, 1, 1], turns: 1, trail: 0.5, blend: 'normal' }] });
    const l = rec.layers[0] as ParticlesLayer;
    expect(l.field).toBe('descend');
    expect(l.flat).toBe('settle');
    expect(l.colour).toBe('picture');
    expect(l.sizeJitter).toBe(0);
  });

  it('keeps the hidden-picture setting', () => {
    const rec = parsePlayRecord({ version: 1, controls: [], mappings: [], layers: [], display: { picture: false, backdrop: [1, 1, 1] } });
    expect(rec.display).toEqual({ picture: false, backdrop: [1, 1, 1] });
    expect(parsePlayRecord({ version: 1, controls: [], mappings: [], layers: [] }).display).toBeUndefined();
  });

  it('the web export carries the particle system as a plain script', () => {
    const html = buildPlayHtml({ title: 'P', fragmentShader: 'void main(){}', uniforms: {}, paramBindings: {}, play: emptyPlayRecord(), aspect: 'free' }, DEFAULT_EMBED);
    const start = html.indexOf('var SSParticles = (function () {');
    expect(start).toBeGreaterThan(-1);
    const block = html.slice(start, html.indexOf('})();', start) + 5);
    expect(block).not.toMatch(/^export /m);
    const lib = new Function(`${block}; return SSParticles;`)() as Record<string, unknown>;
    expect(typeof lib.createParticles).toBe('function');
    expect(typeof lib.stepParticles).toBe('function');
    expect(typeof lib.drawParticles).toBe('function');
    // The whole runtime script parses (compiling it runs nothing).
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
    expect(() => new Function(scripts[scripts.length - 1])).not.toThrow();
  });
});
