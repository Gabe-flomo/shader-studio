/**
 * The Relationship layer: forces per kind, roles and targets, sight and
 * wander, walls per role, readings, catches, the member cap, the picture
 * forces, nested relationships, and the same run twice under a seed.
 */
import { describe, it, expect } from 'vitest';
import { rlCreate, rlStep, rlPlace, rlPictureForce, rlPictureAt, RL_MAX_MEMBERS } from '../kit/relationship.js';
import { createLayerKit, type KitEnv } from '../kit/kit.js';
import { seededRandom } from '../particle-sim.js';
import { defaultLayer, parseLayer, newRelationMember, layerNumericProps, type PlayLayer, type RelationshipLayer, type RelationMember } from '../../types/playLayers';
import { emptyPlayRecord, sensorReadsFor, type PlayRecord } from '../../types/play';
import { KIT_SOURCES } from '../exportHtml';

type Member = { id: string; role: 'chaser' | 'prey' | 'member'; mass: number; base: { x: number; y: number }; group: unknown; pic?: unknown };
type Grid = { grid: Uint8ClampedArray; gw: number; gh: number; channel: string; mode: string; strength: number; radius: number };

const rel = (over: Partial<RelationshipLayer> = {}) => ({ ...defaultLayer('relationship', 'r', 'R'), ...over }) as RelationshipLayer;
const v = (l: RelationshipLayer) => (k: string) => (l as unknown as Record<string, number>)[k];
const mem = (id: string, role: Member['role'], x: number, y: number, mass = 1): Member => ({ id, role, mass, base: { x, y }, group: null });
const dist = (a: { x: number; y: number }, b: { x: number; y: number }, aspect = 1) => Math.hypot((a.x - b.x) * aspect, a.y - b.y);

/** Run a relationship for `frames` at 60 Hz; the state afterwards. */
function run(l: RelationshipLayer, members: Member[], frames: number, seed = 7, aspect = 1) {
  const st = rlCreate(), rand = seededRandom(seed);
  let caught = 0;
  for (let i = 0; i < frames; i++) if (rlStep(st, l, v(l), 1 / 60, i / 60, aspect, members, rand)) caught++;
  return { st, caught, at: (id: string) => rlPlace(st, id, aspect)! };
}

describe('the relationship simulation', () => {
  it('chase: the chaser runs at the closest prey in sight and catches it', () => {
    const l = rel({ relation: 'chase', sight: 1, speed: 0.8, accel: 4, catchRadius: 0.03, onCatch: 'none', wander: 0, flee: 0 });
    const { st, caught, at } = run(l, [mem('c', 'chaser', 0.2, 0.5), mem('near', 'prey', 0.5, 0.5), mem('far', 'prey', 0.9, 0.5)], 120);
    // It reaches the prey (and, with nothing done on a catch, overshoots and comes round again).
    expect(caught).toBeGreaterThanOrEqual(1);
    expect(st.catches).toBe(caught);
    // It went for the near one, which (not fleeing) stayed put; the far one was left alone.
    expect(dist(at('c'), { x: 0.5, y: 0.5 })).toBeLessThan(0.08);
    expect(at('far').x).toBeCloseTo(0.9, 5);
    expect(st.reads.sight).toBe(1);
    expect(st.reads.catches).toBeCloseTo(caught / 20, 5);
  });

  it('chase: prey flees a chaser within the flee distance', () => {
    const l = rel({ relation: 'chase', sight: 0, speed: 0.6, accel: 4, flee: 0.4, wander: 0 });
    const { at } = run(l, [mem('c', 'chaser', 0.3, 0.5), mem('p', 'prey', 0.5, 0.5)], 60);
    expect(at('p').x).toBeGreaterThan(0.7); // ran away from the chaser on its left
    expect(at('c').x).toBeCloseTo(0.3, 2); // no sight: the chaser doesn't move (no wander either)
  });

  it('chase: out of sight the chaser wanders (seeded, so twice the same), and not with wander at 0', () => {
    const l = rel({ relation: 'chase', sight: 0.1, speed: 0.6, accel: 4, wander: 1 });
    const a = run(l, [mem('c', 'chaser', 0.5, 0.5), mem('p', 'prey', 0.95, 0.95)], 90, 3);
    const b = run(l, [mem('c', 'chaser', 0.5, 0.5), mem('p', 'prey', 0.95, 0.95)], 90, 3);
    expect(dist(a.at('c'), { x: 0.5, y: 0.5 })).toBeGreaterThan(0.05);
    expect(a.at('c')).toEqual(b.at('c'));
    expect(a.st.reads.sight).toBe(0);
    const still = run(rel({ relation: 'chase', sight: 0.1, wander: 0 }), [mem('c', 'chaser', 0.5, 0.5), mem('p', 'prey', 0.95, 0.95)], 90);
    expect(dist(still.at('c'), { x: 0.5, y: 0.5 })).toBeLessThan(1e-6);
  });

  it('repel: members push apart when closer than the distance, heavier ones less', () => {
    const l = rel({ relation: 'repel', strength: 1, repelDistance: 0.4, damping: 0.5 });
    const { at } = run(l, [mem('a', 'member', 0.45, 0.5), mem('b', 'member', 0.55, 0.5, 4)], 60);
    expect(at('a').x).toBeLessThan(0.4);
    expect(at('b').x).toBeGreaterThan(0.55);
    expect(0.45 - at('a').x).toBeGreaterThan((at('b').x - 0.55) * 2); // the heavy one moved less
    // Beyond the distance nothing happens.
    const apart = run(l, [mem('a', 'member', 0.2, 0.5), mem('b', 'member', 0.8, 0.5)], 60);
    expect(apart.at('a').x).toBeCloseTo(0.2, 6);
  });

  it('attract: overshoot pulls them through each other; keep holds them at the boundary', () => {
    const over = rel({ relation: 'attract', attractMode: 'overshoot', strength: 1, falloff: 0.5, damping: 0 });
    const o = run(over, [mem('a', 'member', 0.3, 0.5), mem('b', 'member', 0.7, 0.5)], 200);
    let crossed = false;
    { // rerun frame by frame to see them pass
      const st = rlCreate(), rand = seededRandom(1), ms = [mem('a', 'member', 0.3, 0.5), mem('b', 'member', 0.7, 0.5)];
      for (let i = 0; i < 200; i++) { rlStep(st, over, v(over), 1 / 60, i / 60, 1, ms, rand); if (rlPlace(st, 'a', 1)!.x > rlPlace(st, 'b', 1)!.x) crossed = true; }
    }
    expect(crossed).toBe(true);
    expect(o.at('a')).toBeDefined();
    const keep = rel({ relation: 'attract', attractMode: 'keep', strength: 1, minDistance: 0.25, damping: 0.3 });
    const k = run(keep, [mem('a', 'member', 0.3, 0.5), mem('b', 'member', 0.7, 0.5)], 300);
    const d = dist(k.at('a'), k.at('b'));
    expect(d).toBeLessThan(0.4);
    expect(d).toBeGreaterThan(0.2);
  });

  it('walls, per role: bounce keeps it in, wrap brings it round, respawn and escape put it back', () => {
    const shot = (wall: RelationshipLayer['wallPrey'], over: Partial<RelationshipLayer> = {}) => {
      const l = rel({ relation: 'chase', sight: 0, speed: 1, accel: 20, flee: 0.5, wander: 0, damping: 0, wallPrey: wall, wallChaser: 'bounce', respawnAt: 'fixed', respawnDelay: 0.2, ...over });
      const st = rlCreate(), rand = seededRandom(5), ms = [mem('c', 'chaser', 0.7, 0.5), mem('p', 'prey', 0.9, 0.5)];
      const xs: number[] = [];
      for (let i = 0; i < 90; i++) { rlStep(st, l, v(l), 1 / 60, i / 60, 1, ms, rand); xs.push(rlPlace(st, 'p', 1)!.x); }
      return { xs, st };
    };
    const bounce = shot('bounce');
    expect(Math.max(...bounce.xs)).toBeLessThanOrEqual(1);
    const wrap = shot('wrap');
    expect(Math.min(...wrap.xs)).toBeLessThan(0.3); // came in from the left
    const respawn = shot('respawn');
    expect(respawn.xs.some(x => Math.abs(x - 0.9) < 1e-9)).toBe(true); // back at its own place at once
    const escape = shot('escape');
    expect(Math.max(...escape.xs)).toBeGreaterThan(1.1); // allowed out
    expect(escape.st.m.get('p')!.escaped).toBe(false); // and back after the delay, at its own place
    const gone = escape.xs.findIndex(x => x > 1.1);
    expect(escape.xs.slice(gone).some(x => Math.abs(x - 0.9) < 1e-9)).toBe(true);
    // The chaser's own wall is separate: bounce kept it in the picture all along.
    expect(rlPlace(escape.st, 'c', 1)!.x).toBeLessThanOrEqual(1);
  });

  it('reads the gap and the closing speed of the closest pair', () => {
    const l = rel({ relation: 'chase', sight: 1, speed: 0.5, accel: 8, wander: 0, flee: 0, maxSpeed: 1 });
    const { st } = run(l, [mem('c', 'chaser', 0.2, 0.5), mem('p', 'prey', 0.8, 0.5)], 30);
    expect(st.reads.gap).toBeLessThan(0.6);
    expect(st.reads.gap).toBeGreaterThan(0.2);
    expect(st.reads.closing).toBeGreaterThan(0.6); // closing in at about half the max speed
    expect(st.reads.chaseSpeed).toBeCloseTo(0.5, 1);
    // Parting reads under 0.5.
    const flee = rel({ relation: 'chase', sight: 0, speed: 0.5, accel: 8, flee: 1, wander: 0 });
    const f = run(flee, [mem('c', 'chaser', 0.3, 0.5), mem('p', 'prey', 0.5, 0.5)], 30);
    expect(f.st.reads.closing).toBeLessThan(0.4);
    // No pair: the readings rest.
    const one = run(l, [mem('c', 'chaser', 0.2, 0.5)], 5);
    expect(one.st.reads.gap).toBe(1);
    expect(one.st.reads.sinceCatch).toBe(1);
  });

  it('catch events: once per approach, a pulse and a count, then respawn or swap', () => {
    const l = rel({ relation: 'chase', sight: 1, speed: 0.8, accel: 8, catchRadius: 0.05, onCatch: 'respawn', respawnAt: 'fixed', wander: 0, flee: 0 });
    const st = rlCreate(), rand = seededRandom(9), ms = [mem('c', 'chaser', 0.4, 0.5), mem('p', 'prey', 0.6, 0.5)];
    const pulses: number[] = [];
    for (let i = 0; i < 240; i++) { rlStep(st, l, v(l), 1 / 60, i / 60, 1, ms, rand); pulses.push(st.reads.catch); }
    expect(st.catches).toBeGreaterThan(1); // the prey respawns at its place and is caught again
    expect(pulses.filter(p => p === 1).length).toBe(st.catches); // one full pulse per catch
    expect(st.reads.sinceCatch).toBeLessThan(1);
    // Swap: after the first catch the roles change hands.
    const swap = rel({ relation: 'chase', sight: 1, speed: 0.8, accel: 8, catchRadius: 0.05, onCatch: 'swap', wander: 0, flee: 0 });
    const s = run(swap, [mem('c', 'chaser', 0.4, 0.5), mem('p', 'prey', 0.6, 0.5)], 60);
    expect(s.st.swaps.get('c')).toBe('prey');
    expect(s.st.swaps.get('p')).toBe('chaser');
  });

  it('holds at most RL_MAX_MEMBERS', () => {
    const many = Array.from({ length: 40 }, (_, i) => mem('m' + i, 'member', (i % 8) / 8 + 0.05, Math.floor(i / 8) / 5 + 0.1));
    const { st } = run(rel({ relation: 'repel' }), many, 3);
    expect(st.m.size).toBe(RL_MAX_MEMBERS);
    expect(rlPlace(st, 'm39', 1)).toBeNull();
  });

  it('the same seed and clock run the same way twice; another seed differs', () => {
    const l = rel({ relation: 'chase', sight: 0.2, wander: 1, wallPrey: 'respawn', respawnAt: 'random', speed: 1, accel: 8 });
    const ms = () => [mem('c', 'chaser', 0.5, 0.5), mem('p', 'prey', 0.98, 0.5)];
    const a = run(l, ms(), 200, 42), b = run(l, ms(), 200, 42), c = run(l, ms(), 200, 43);
    expect([...a.st.m.values()].map(m => [m.x, m.y, m.vx, m.vy])).toEqual([...b.st.m.values()].map(m => [m.x, m.y, m.vx, m.vy]));
    expect(a.st.reads).toEqual(b.st.reads);
    expect(a.at('c')).not.toEqual(c.at('c'));
  });
});

describe('picture forces', () => {
  /** A coarse grid bright on the right, dark on the left. */
  function gradientGrid(gw = 64, gh = 36) {
    const g = new Uint8ClampedArray(gw * gh * 4);
    for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) { const i = (y * gw + x) * 4, b = Math.round((x / (gw - 1)) * 255); g[i] = b; g[i + 1] = b; g[i + 2] = b; g[i + 3] = 255; }
    return { grid: g, gw, gh };
  }
  const pic = (mode: string, over: Partial<Grid> = {}): Grid => ({ ...gradientGrid(), channel: 'brightness', mode, strength: 1, radius: 0.06, ...over });

  it('samples a channel and its gradient across a ring', () => {
    const { grid, gw, gh } = gradientGrid();
    expect(rlPictureAt(grid, gw, gh, 'brightness', 0.02, 0.5)).toBeLessThan(0.05);
    expect(rlPictureAt(grid, gw, gh, 'brightness', 0.98, 0.5)).toBeGreaterThan(0.95);
    const f = rlPictureForce(grid, gw, gh, 'brightness', 0.5, 0.5, 0.06, 16 / 9);
    expect(f.v).toBeCloseTo(0.5, 1);
    expect(f.gx).toBeGreaterThan(0.05);
    expect(Math.abs(f.gy)).toBeLessThan(1e-6);
    // Other channels: red of a red-to-black ramp; a layer's alpha.
    const red = gradientGrid(); for (let i = 0; i < red.grid.length; i += 4) { red.grid[i + 1] = 0; red.grid[i + 2] = 0; red.grid[i + 3] = 255 - red.grid[i]; }
    expect(rlPictureAt(red.grid, red.gw, red.gh, 'red', 0.9, 0.5)).toBeGreaterThan(0.8);
    expect(rlPictureAt(red.grid, red.gw, red.gh, 'green', 0.9, 0.5)).toBe(0);
    expect(rlPictureAt(red.grid, red.gw, red.gh, 'layer', 0.9, 0.5)).toBeLessThan(0.2);
    expect(rlPictureAt(red.grid, red.gw, red.gh, 'saturation', 0.9, 0.5)).toBe(1);
  });

  it('a climbing member moves toward the bright side, a descending one away; the value under it is read', () => {
    const l = rel({ relation: 'repel', strength: 0, damping: 0.2 });
    const climb = run(l, [{ ...mem('a', 'member', 0.5, 0.5), pic: pic('climb') }, mem('b', 'member', 0.5, 0.9)], 90);
    expect(climb.at('a').x).toBeGreaterThan(0.6);
    expect(climb.at('a').y).toBeCloseTo(0.5, 2);
    expect(climb.st.m.get('a')!.pv).toBeGreaterThan(0.5);
    const descend = run(l, [{ ...mem('a', 'member', 0.5, 0.5), pic: pic('descend') }, mem('b', 'member', 0.5, 0.9)], 90);
    expect(descend.at('a').x).toBeLessThan(0.4);
    // Strength scales it; off does nothing.
    const weak = run(l, [{ ...mem('a', 'member', 0.5, 0.5), pic: pic('climb', { strength: 0.2 }) }, mem('b', 'member', 0.5, 0.9)], 90);
    expect(weak.at('a').x - 0.5).toBeLessThan((climb.at('a').x - 0.5) / 2);
    const off = run(l, [{ ...mem('a', 'member', 0.5, 0.5), pic: pic('off') }, mem('b', 'member', 0.5, 0.9)], 90);
    expect(off.at('a').x).toBeCloseTo(0.5, 6);
    expect(off.st.m.get('a')!.pv).toBeCloseTo(0.5, 1); // still read
  });
});

// ── In the kit: members are driven, readings reported, nesting, the export ──

function fakeCanvas(): HTMLCanvasElement {
  const target: Record<string, unknown> = {
    canvas: null, measureText: (s: string) => ({ width: String(s).length * 6 }),
    getImageData: (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4).fill(128) }),
    createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
    createLinearGradient: () => ({ addColorStop() {} }), createRadialGradient: () => ({ addColorStop() {} }),
  };
  const ctx: unknown = new Proxy(target, { get(t, k: string) { return k in t ? t[k] : () => {}; }, set(t, k: string, val) { t[k] = val; return true; } });
  return { width: 160, height: 90, getContext: () => ctx } as unknown as HTMLCanvasElement;
}
function withCanvas<T>(fn: () => T): T {
  const g = globalThis as { document?: unknown; Path2D?: unknown };
  const had = [g.document, g.Path2D];
  g.document = { createElement: () => fakeCanvas() };
  g.Path2D = class { moveTo() {} lineTo() {} closePath() {} rect() {} arcTo() {} addPath() {} };
  try { return fn(); } finally { [g.document, g.Path2D] = had; }
}
function kitRun(layers: PlayLayer[], frames: number, seed = 11, placed?: (id: string, k: string) => number | undefined, before?: (record: PlayRecord, i: number) => void) {
  return withCanvas(() => {
    const kit = createLayerKit();
    kit.reset(seed);
    const record: PlayRecord = { ...emptyPlayRecord(), layers };
    const at = new Map<string, number>(), sensors = new Map<string, number>();
    const env = (i: number): KitEnv => ({
      gl: fakeCanvas(), W: 160, H: 90, dpr: 1, time: i / 60, dt: 1 / 60,
      value: (l, k) => at.get(`${l.id}::${k}`) ?? (l as unknown as Record<string, number>)[k],
      pointer: { x: 0.5, y: 0.5, over: false, down: false }, markers: true, editing: false, hidden: false, backdrop: [0, 0, 0], audio: null, camera: null, image: () => null,
      sensor: (k, val) => sensors.set(k, val),
      override: (id, k, val) => { if (val === null) at.delete(`${id}::${k}`); else at.set(`${id}::${k}`, val); },
      placed,
    });
    const out = fakeCanvas().getContext('2d')!;
    for (let i = 0; i < frames; i++) { before?.(record, i); kit.frame(out, record, env(i)); }
    return { at, sensors, kit, record };
  });
}
const rmem = (id: string, role: RelationMember['role'] = 'member', over: Partial<RelationMember> = {}): RelationMember => ({ ...newRelationMember(id, role), ...over });

describe('the relationship layer in the kit', () => {
  it('drives its members through override, reports its readings and its anchor, and lets go of a member that leaves', () => {
    const shape = { ...defaultLayer('shape', 's', 'S'), x: 0.7, y: 0.5, action: 'none' } as PlayLayer;
    const nul = { ...defaultLayer('null', 'n', 'N'), x: 0.2, y: 0.5 } as PlayLayer;
    const r = rel({ relation: 'chase', members: [rmem('n', 'chaser'), rmem('s', 'prey')], sight: 1, speed: 0.6, accel: 4, wander: 0, flee: 0, catchRadius: 0.03, onCatch: 'none' }) as PlayLayer;
    let left = false;
    const { at, sensors } = kitRun([shape, nul, r], 92, 11, undefined, (record, i) => {
      // On the last frame the shape leaves the relationship.
      if (i === 91) { (record.layers[2] as RelationshipLayer).members = [rmem('n', 'chaser')]; left = true; }
    });
    expect(left).toBe(true);
    expect(at.get('n::x')).toBeGreaterThan(0.5); // the null ran at the shape
    expect(sensors.get('r::sight')).toBe(0); // no prey left on the last frame
    expect(sensors.get('r::caught')).toBeGreaterThanOrEqual(1);
    expect(sensors.get('r::catch')).toBeGreaterThanOrEqual(0);
    expect(sensors.get('r::ax')).toBeGreaterThan(0.5);
    expect(sensors.get('r::picture')).toBeCloseTo(128 / 255, 2); // the (flat grey) picture under them
    expect(sensors.get('n::picture')).toBeCloseTo(128 / 255, 2);
    // The shape left the relationship: its override is cleared; the null's stays.
    expect(at.has('s::x')).toBe(false);
    expect(at.has('n::x')).toBe(true);
  });

  it('a recorded place (a take playing back) wins over the simulation', () => {
    const shape = { ...defaultLayer('shape', 's', 'S'), x: 0.7, y: 0.5, action: 'none' } as PlayLayer;
    const nul = { ...defaultLayer('null', 'n', 'N'), x: 0.2, y: 0.5 } as PlayLayer;
    const r = rel({ relation: 'chase', members: [rmem('n', 'chaser'), rmem('s', 'prey')], sight: 1, speed: 0.6, accel: 4, wander: 0, flee: 0 }) as PlayLayer;
    let seen = 0;
    const { sensors } = kitRun([shape, nul, r], 30, 11, (id, k) => { if (id === 'n') { seen++; return k === 'x' ? 0.1 : 0.9; } return undefined; });
    expect(seen).toBeGreaterThan(0);
    expect(sensors.get('r::sight')).toBe(1);
  });

  it('a relationship can be a member of another: it stands at its centroid and its members move as a group', () => {
    const a = { ...defaultLayer('null', 'a', 'A'), x: 0.2, y: 0.2 } as PlayLayer;
    const b = { ...defaultLayer('null', 'b', 'B'), x: 0.3, y: 0.2 } as PlayLayer;
    const c = { ...defaultLayer('null', 'c', 'C'), x: 0.8, y: 0.8 } as PlayLayer;
    const inner = { ...rel({ relation: 'repel', strength: 0, members: [rmem('a'), rmem('b')] }), id: 'inner', label: 'Inner' } as PlayLayer;
    const outer = { ...rel({ relation: 'attract', attractMode: 'overshoot', strength: 2, falloff: 0, damping: 0.2, members: [rmem('inner'), rmem('c')] }), id: 'outer', label: 'Outer' } as PlayLayer;
    const { at, sensors } = kitRun([a, b, c, inner, outer], 120);
    // The group was pulled toward c, keeping its shape.
    expect(at.get('a::x')).toBeGreaterThan(0.25);
    expect(at.get('b::x')! - at.get('a::x')!).toBeCloseTo(0.1, 2);
    expect(at.get('b::y')! - at.get('a::y')!).toBeCloseTo(0, 2);
    expect(sensors.get('inner::ax')).toBeCloseTo((at.get('a::x')! + at.get('b::x')!) / 2, 5);
    expect(at.get('c::x')).toBeLessThan(0.8);
  });

  it('a cycle of relationships runs each once and moves nothing twice', () => {
    const a = { ...defaultLayer('null', 'a', 'A'), x: 0.2, y: 0.2 } as PlayLayer;
    const p = { ...rel({ relation: 'repel', members: [rmem('a'), rmem('q')] }), id: 'p', label: 'P' } as PlayLayer;
    const q = { ...rel({ relation: 'repel', members: [rmem('p')] }), id: 'q', label: 'Q' } as PlayLayer;
    expect(() => kitRun([a, p, q], 10)).not.toThrow();
  });

  it('runs the same twice under a seed', () => {
    const layers = () => [
      { ...defaultLayer('null', 'n', 'N'), x: 0.5, y: 0.5 } as PlayLayer,
      { ...defaultLayer('shape', 's', 'S'), x: 0.9, y: 0.9, action: 'none' } as PlayLayer,
      rel({ relation: 'chase', members: [rmem('n', 'chaser'), rmem('s', 'prey')], sight: 0.2, wander: 1, wallPrey: 'respawn', respawnAt: 'random', speed: 1, accel: 8 }) as PlayLayer,
    ];
    const one = kitRun(layers(), 120, 5), two = kitRun(layers(), 120, 5);
    expect([...one.at]).toEqual([...two.at]);
    expect([...one.sensors]).toEqual([...two.sensors]);
  });

  it('is in the web export kit, with distinct top-level names', () => {
    const body = KIT_SOURCES.map(src => src.replace(/^import .*$/gm, '').replace(/^export /gm, '')).join('\n');
    expect(body).toContain('function rlStep(');
    const lib = new Function(`${body}; return { createLayerKit, rlStep };`)() as { createLayerKit: () => unknown; rlStep: unknown };
    expect(typeof lib.rlStep).toBe('function');
  });
});

describe('the relationship layer in files and the panel', () => {
  it('survives a save and load, drops bad members, and caps them', () => {
    const l = rel({ members: [rmem('a', 'chaser', { mass: 3, picture: 'climb', channel: 'hue', radius: 0.1 }), rmem('b', 'prey')] });
    expect(parseLayer(JSON.parse(JSON.stringify(l)))).toEqual(l);
    const raw = { ...l, members: [{ id: 'a', role: 'nope', mass: 'x' }, { id: 'a' }, { nope: 1 }, ...Array.from({ length: 40 }, (_, i) => ({ id: 'm' + i }))] };
    const back = parseLayer(JSON.parse(JSON.stringify(raw))) as RelationshipLayer;
    expect(back.members[0]).toEqual(rmem('a'));
    expect(back.members.length).toBe(RL_MAX_MEMBERS);
  });

  it('offers its readings and, per member reading the picture, a strength target', () => {
    expect(sensorReadsFor({ kind: 'relationship' })).toContain('closing');
    expect(sensorReadsFor({ kind: 'null' })).toContain('picture');
    const l = rel({ members: [rmem('a'), rmem('b', 'member', { picture: 'climb' })] });
    const keys = layerNumericProps(l).map(d => d.key);
    expect(keys).toContain('m2_picture');
    expect(keys).not.toContain('m1_picture');
    expect(keys).toContain('speed');
  });
});
