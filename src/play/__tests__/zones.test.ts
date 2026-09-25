/**
 * Zones, flocking, bursts and the layer schema: shapes as distance functions
 * that particles bump into, stay inside, vanish in, pass through, are born in
 * and swallowed by; boids that line up; burst particles that live and die;
 * every layer kind surviving a save; actions and sensors reaching the engine.
 */
import { describe, it, expect } from 'vitest';
import { geoCompile, geoFieldAt, geoFieldFromMask, sdfBox, sdfCapsule, sdfEllipse, sdfPolygon } from '../kit/geometry.js';
import { burstParticles, createParticles, resizeParticles, stepParticles, type ParticleEnv, type ParticleParams } from '../particle-sim.js';
import { LAYER_KINDS, defaultLayer, parseLayer, parsePlayRecord, type ParticlesLayer, type PlayAction } from '../../types/play';
import { playEngine } from '../../lib/playEngine';
import { inputBus } from '../../lib/inputBus';
import { midiEngine } from '../../lib/midiEngine';

function seeded(seed = 1): () => number {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const params = (over: Partial<ParticlesLayer> = {}): ParticleParams => ({ ...(defaultLayer('particles', 'p', 'P') as ParticlesLayer), field: 'none', ...over }) as ParticleParams;
const env = (zones: ReturnType<typeof geoCompile>[] = [], over: Partial<ParticleEnv> = {}): ParticleEnv => ({
  dt: 1 / 60, time: 0, aspect: 1, sample: null, sw: 64, sh: 36, attractorPoint: null, spawnPoint: null,
  zones, emitters: zones.filter(z => z.action === 'emitter'), zoneById: new Map(zones.map(z => [z.id, z])), ...over,
});
const run = (st: ReturnType<typeof createParticles>, p: ParticleParams, e: ParticleEnv, frames: number, rand = seeded(2)) => {
  for (let f = 0; f < frames; f++) { e.time = f / 60; stepParticles(st, p, e, rand); }
};
const zone = (over: Record<string, unknown>) => geoCompile({ id: 'z', shape: 'box', x: 0.5, y: 0.5, w: 0.3, h: 0.3, rotation: 0, ...over }, 1);

describe('shape distances', () => {
  it('are negative inside, zero on the edge, positive outside', () => {
    expect(sdfBox(0, 0, 1, 1, 0)).toBeCloseTo(-1);
    expect(sdfBox(2, 0, 1, 1, 0)).toBeCloseTo(1);
    expect(sdfEllipse(0.5, 0, 0.5, 0.5)).toBeCloseTo(0);
    expect(sdfCapsule(0, 0.3, 1, 0.1)).toBeCloseTo(0.2);
    const tri = [0, 0, 1, 0, 0, 1];
    expect(sdfPolygon(0.2, 0.2, tri)).toBeLessThan(0);
    expect(sdfPolygon(1, 1, tri)).toBeGreaterThan(0);
  });

  it('turn and move with the shape (clockwise on screen)', () => {
    const z = geoCompile({ id: 'l', shape: 'line', x: 0.5, y: 0.5, w: 0.4, h: 0.02, rotation: 90 }, 1);
    expect(z.dist(0.5, 0.65)).toBeLessThan(0); // turned upright
    expect(z.dist(0.65, 0.5)).toBeGreaterThan(0);
    const n = z.normal(0.6, 0.5);
    expect(n[0]).toBeGreaterThan(0.9); // points out, to the right
  });

  it('a mask becomes a distance field', () => {
    const gw = 20, gh = 20, mask = new Uint8Array(gw * gh);
    for (let y = 5; y < 15; y++) for (let x = 5; x < 15; x++) mask[y * gw + x] = 1;
    const f = geoFieldFromMask(mask, gw, gh);
    expect(geoFieldAt(f, 0.5, 0.5)).toBeLessThan(-0.15);
    expect(geoFieldAt(f, 0.05, 0.05)).toBeGreaterThan(0.1);
  });
});

describe('particles and zones', () => {
  it('a wall keeps particles out and a container keeps them in', () => {
    const wall = zone({ action: 'wall' });
    const st = createParticles(300, seeded(3));
    run(st, params({ field: 'noise', speed: 2 }), env([wall]), 180);
    let inside = 0;
    for (let i = 0; i < st.count; i++) if (wall.dist(st.x[i], st.y[i]) < -0.01) inside++;
    expect(inside).toBe(0);
    const box = zone({ action: 'container' });
    const kept = createParticles(200, seeded(4));
    for (let i = 0; i < kept.count; i++) { kept.x[i] = 0.45 + kept.r[i] * 0.1; kept.y[i] = 0.5; }
    run(kept, params({ field: 'noise', speed: 2 }), env([box]), 180);
    let out = 0;
    for (let i = 0; i < kept.count; i++) if (box.dist(kept.x[i], kept.y[i]) > 0.01) out++;
    expect(out).toBe(0);
  });

  it('a portal sends particles out of its target', () => {
    const a = geoCompile({ id: 'a', shape: 'box', x: 0.2, y: 0.5, w: 0.1, h: 0.1, action: 'portal', targetId: 'b' }, 1);
    const b = geoCompile({ id: 'b', shape: 'box', x: 0.8, y: 0.5, w: 0.1, h: 0.1, action: 'none' }, 1);
    const st = createParticles(1, seeded(5));
    st.x[0] = 0.2; st.y[0] = 0.5; st.vx[0] = 0; st.vy[0] = 0;
    stepParticles(st, params(), env([a, b]), seeded(6));
    expect(st.x[0]).toBeGreaterThan(0.7);
  });

  it('an emitter feeds an absorber: particles are born at one and swallowed by the other', () => {
    const em = geoCompile({ id: 'e', shape: 'circle', x: 0.3, y: 0.5, w: 0.06, h: 0.06, action: 'emitter', strength: 1, reach: 3 }, 1);
    const ab = geoCompile({ id: 'b', shape: 'circle', x: 0.7, y: 0.5, w: 0.06, h: 0.06, action: 'absorber', strength: 2, reach: 3 }, 1);
    const st = createParticles(300, seeded(7));
    for (let i = 0; i < st.count; i++) st.age[i] = 1000;
    run(st, params({ speed: 0.6, edges: 'respawn' }), env([em, ab]), 60 * 8);
    // Most have been reborn (swallowed or left, and every rebirth is at the emitter).
    let reborn = 0;
    for (let i = 0; i < st.count; i++) if (st.age[i] < 8) reborn++;
    expect(reborn).toBeGreaterThan(st.count * 0.5);
    expect(ab.inside).toBeGreaterThan(0);
  });

  it('a tint zone marks the particles inside it and a sensor counts them', () => {
    const t = zone({ action: 'tint', w: 1, h: 1 });
    const st = createParticles(50, seeded(8));
    stepParticles(st, params({ speed: 0 }), env([t]), seeded(9));
    expect(Array.from(st.zt).every(v => v === 0)).toBe(true);
    expect(t.inside).toBe(50);
    expect(t.total).toBe(50);
  });
});

describe('flocking, bursts and counts', () => {
  it('flocking lines particles up', () => {
    // Local order: how well each particle's neighbours agree on a heading (1 = all the same way).
    const order = (st: ReturnType<typeof createParticles>) => {
      let total = 0;
      for (let i = 0; i < st.count; i++) {
        let sx = 0, sy = 0, n = 0;
        for (let j = 0; j < st.count; j++) {
          if (Math.hypot(st.x[j] - st.x[i], st.y[j] - st.y[i]) > 0.1) continue;
          const m = Math.hypot(st.vx[j], st.vy[j]) || 1; sx += st.vx[j] / m; sy += st.vy[j] / m; n++;
        }
        total += Math.hypot(sx, sy) / n;
      }
      return total / st.count;
    };
    const st = createParticles(400, seeded(10));
    const rand = seeded(11);
    for (let i = 0; i < st.count; i++) { const a = rand() * Math.PI * 2; st.vx[i] = Math.cos(a) * 0.1; st.vy[i] = Math.sin(a) * 0.1; }
    const before = order(st);
    run(st, params({ flock: 1, flockRadius: 0.12, edges: 'wrap' }), env(), 60 * 6);
    expect(order(st)).toBeGreaterThan(0.85);
    expect(before).toBeLessThan(0.5);
  });

  it('flocks keep their personal space instead of clumping into dots', () => {
    const nearest = (st: ReturnType<typeof createParticles>) => {
      let total = 0;
      for (let i = 0; i < st.count; i++) {
        let best = 9;
        for (let j = 0; j < st.count; j++) if (j !== i) best = Math.min(best, Math.hypot(st.x[j] - st.x[i], st.y[j] - st.y[i]));
        total += best;
      }
      return total / st.count;
    };
    const free = createParticles(500, seeded(3)), flock = createParticles(500, seeded(3));
    run(free, params(), env(), 60 * 8);
    run(flock, params({ flock: 1 }), env(), 60 * 8);
    // Tighter than a random spread (they group up), but nowhere near stacked on top of each other.
    expect(nearest(flock)).toBeGreaterThan(nearest(free) * 0.5);
  });

  it('random edges put a leaving particle somewhere new, still heading the same way', () => {
    const st = createParticles(1, seeded(12));
    st.x[0] = 0.999; st.y[0] = 0.5; st.vx[0] = 0.5; st.vy[0] = 0;
    stepParticles(st, params({ edges: 'random', speed: 0 }), env([], { dt: 0.05 }), seeded(13));
    expect(st.x[0]).toBeGreaterThanOrEqual(0); expect(st.x[0]).toBeLessThanOrEqual(1);
    expect(Math.abs(st.y[0] - 0.5) + Math.abs(st.x[0] - 0.02)).toBeGreaterThan(0.05);
    expect(st.vx[0]).toBeGreaterThan(0);
  });

  it('a tilted vortex swirls in ellipses, bigger on the near side', () => {
    const spread = (tilt: number) => {
      const rand = seeded(4), st = createParticles(300, rand);
      for (let i = 0; i < st.count; i++) { const a = rand() * Math.PI * 2, r = 0.1 + rand() * 0.25; st.x[i] = 0.5 + Math.cos(a) * r; st.y[i] = 0.5 + Math.sin(a) * r; st.vx[i] = st.vy[i] = 0; }
      const z = geoCompile({ id: 'v', shape: 'circle', x: 0.5, y: 0.5, w: 0.05, h: 0.05, action: 'vortex', strength: 3, reach: 0.6, tilt }, 1);
      let sx = 0, sy = 0, near = 0, far = 0;
      const p = params({ speed: 0.5 }), e = env([z]);
      for (let f = 0; f < 400; f++) {
        stepParticles(st, p, e, rand);
        if (f > 200) for (let i = 0; i < st.count; i++) { sx += Math.abs(st.x[i] - 0.5); sy += Math.abs(st.y[i] - 0.5); if (st.y[i] < 0.45) near = Math.max(near, st.zs[i]); if (st.y[i] > 0.55) far = Math.max(far, 1 / st.zs[i]); }
      }
      return { ratio: sx / sy, near, far };
    };
    expect(spread(0).ratio).toBeCloseTo(1, 0);
    const t = spread(60);
    expect(t.ratio).toBeGreaterThan(1.4);
    expect(t.near).toBeGreaterThan(1.05);
    expect(t.far).toBeGreaterThan(1.05);
  });

  it('burst particles start unborn, appear on a burst and die with their life', () => {
    const p = params({ emit: 'burst', life: 1, spawn: 'center', spawnRadius: 0 });
    const st = createParticles(100, seeded(12), true);
    expect(Array.from(st.alive).every(a => a === 0)).toBe(true);
    burstParticles(st, p, env(), 30, seeded(13));
    expect(Array.from(st.alive).filter(Boolean).length).toBe(30);
    run(st, p, env(), 60 * 2);
    expect(Array.from(st.alive).filter(Boolean).length).toBe(0);
  });

  it('changing the count keeps the particles already moving', () => {
    const st = createParticles(10, seeded(14));
    const x3 = st.x[3];
    const bigger = resizeParticles(st, 20, seeded(15));
    expect(bigger.count).toBe(20);
    expect(bigger.x[3]).toBe(x3);
  });
});

describe('layers in files', () => {
  it('every kind survives a save and load unchanged', () => {
    for (const kind of LAYER_KINDS) {
      const l = defaultLayer(kind, `id_${kind}`, kind);
      expect(parseLayer(JSON.parse(JSON.stringify(l)))).toEqual(l);
    }
  });

  it('bad values fall back to the defaults and unknown kinds are dropped', () => {
    const l = parseLayer({ id: 's', kind: 'shape', label: 'S', action: 'explode', w: 'wide', points: [1, 2, 3] });
    expect(l).toMatchObject({ action: 'wall', w: 0.3, points: [] });
    expect(parseLayer({ id: 'x', kind: 'hologram' })).toBeNull();
  });

  it('keeps actions, sensor sources and shape triggers, and drops them when their layer is gone', () => {
    const rec = parsePlayRecord({
      version: 1,
      layers: [{ id: 'sh', kind: 'shape', label: 'Box' }, { id: 'pa', kind: 'particles', label: 'P' }],
      controls: [{ id: 'c', target: 'n::k', kind: 'float', label: 'K', min: 0, max: 1 }],
      mappings: [
        { id: 'm1', controlId: 'c', source: { kind: 'sensor', layerId: 'sh', read: 'fill' }, outMin: 0, outMax: 1, curve: 'linear', smoothMs: 0 },
        { id: 'm2', controlId: 'c', source: { kind: 'sensor', layerId: 'gone', read: 'fill' }, outMin: 0, outMax: 1, curve: 'linear', smoothMs: 0 },
      ],
      actions: [
        { id: 'a1', trigger: { on: 'zone', layerId: 'sh', event: 'fill', threshold: 0.7 }, do: 'burst', layerId: 'pa', amount: 40 },
        { id: 'a2', trigger: { on: 'key', code: 'Space' }, do: 'burst', layerId: 'gone', amount: 40 },
      ],
    });
    expect(rec.mappings.map(m => m.id)).toEqual(['m1']);
    expect(rec.actions).toEqual([{ id: 'a1', trigger: { on: 'zone', layerId: 'sh', event: 'fill', threshold: 0.7 }, do: 'burst', layerId: 'pa', amount: 40, enabled: true }]);
  });
});

describe('actions and sensors in the engine', () => {
  it('an action fires once per press, from a note, a shape click and a shape filling up', () => {
    const fired: PlayAction[] = [];
    const off = playEngine.onAction(a => fired.push(a));
    const base = { version: 1 as const, controls: [], mappings: [], layers: [defaultLayer('shape', 'sh', 'Box'), defaultLayer('particles', 'pa', 'P')] };
    playEngine.setRecord({
      ...base,
      actions: [
        { id: 'n', trigger: { on: 'note', channel: 0, note: 60 }, do: 'burst', layerId: 'pa', amount: 10, enabled: true },
        { id: 'c', trigger: { on: 'zone', layerId: 'sh', event: 'click', threshold: 0.5 }, do: 'scatter', layerId: 'pa', amount: 1, enabled: true },
        { id: 'f', trigger: { on: 'zone', layerId: 'sh', event: 'fill', threshold: 0.6 }, do: 'reset', layerId: 'pa', amount: 1, enabled: true },
      ],
    });
    inputBus.tick(1 / 60, 0); // actions start from "no presses yet"
    midiEngine.handleBytes(0x90, 60, 100);
    midiEngine.handleBytes(0x80, 60, 0);
    playEngine.pressZone('sh'); playEngine.releaseZone('sh');
    playEngine.setSensor('sh::fill', 0.9);
    inputBus.tick(1 / 60, 0);
    inputBus.tick(1 / 60, 0);
    expect(fired.map(a => a.id).sort()).toEqual(['c', 'f', 'n']);
    // Still full: no second fill press until it empties and fills again.
    inputBus.tick(1 / 60, 0);
    expect(fired.length).toBe(3);
    off();
    playEngine.setRecord({ ...base });
  });

  it('a sensor source reads what a layer measured, and a null distance', () => {
    playEngine.setRecord({ version: 1, controls: [], mappings: [], layers: [defaultLayer('null', 'a', 'A'), { ...defaultLayer('null', 'b', 'B'), x: 0.8 } as never] });
    playEngine.setAspect(1);
    playEngine.setSensor('sh::fill', 0.42);
    expect(playEngine.readSource({ kind: 'sensor', layerId: 'sh', read: 'fill', otherId: '' })).toBeCloseTo(0.42);
    expect(playEngine.readSource({ kind: 'sensor', layerId: 'a', read: 'distance', otherId: 'b' })).toBeCloseTo(0.3);
    // A following null's position wins over the record.
    playEngine.setOverride('a', 'x', 0.1);
    expect(playEngine.readSource({ kind: 'null', layerId: 'a', axis: 'x' })).toBeCloseTo(0.1);
    playEngine.setOverride('a', 'x', null);
  });
});
