/**
 * The Agents layer: the fixed-step seeded stepper (the same seed and frame
 * times give identical frames, in the module and in the web export's inlined
 * kit), the spatial hash against brute force, the rules and presets, and the
 * layer in files, the kit and the panel.
 */
import { describe, it, expect } from 'vitest';
import { agCreate, agStep, agHashBuild, agHashQuery, agPresetLayer, AG_PRESETS, AG_RULES, AG_STEP } from '../kit/agents.js';
import { createLayerKit, type KitEnv } from '../kit/kit.js';
import { seededRandom } from '../particle-sim.js';
import { defaultLayer, parseLayer, layerNumericProps, newAgentRule, type AgentsLayer, type PlayLayer } from '../../types/playLayers';
import { emptyPlayRecord, sensorReadsFor, type PlayRecord } from '../../types/play';
import { KIT_SOURCES } from '../exportHtml';
import { PLAY_EXAMPLE_GRAPHS } from '../../store/playExamples';

type Info = { pointer?: { x: number; y: number; over: boolean } };
const layerOf = (preset = 'boids', over: Record<string, unknown> = {}) => {
  const base = defaultLayer('agents', 'a', 'A');
  const out = { ...base, ...agPresetLayer(preset, base), ...over } as Record<string, unknown>;
  for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
  return out as unknown as AgentsLayer;
};
const val = (l: AgentsLayer) => (k: string) => (l as unknown as Record<string, number>)[k];

/** Step a layer for `frames` frames of `dt`; the state afterwards. */
function run(l: AgentsLayer, frames: number, dt = 1 / 60, seed = 5, info: Info = {}, aspect = 16 / 9) {
  const st = agCreate();
  for (let f = 0; f < frames; f++) agStep(st, l, val(l), dt, aspect, () => seededRandom(seed), info);
  return st;
}
const positions = (st: ReturnType<typeof agCreate>) => Array.from({ length: st.n }, (_, i) => [st.x[i], st.y[i], st.alive[i]]);

describe('the agents stepper is deterministic', () => {
  it('two instances with the same seed and dt give identical positions', () => {
    for (const preset of Object.keys(AG_PRESETS)) {
      const l = layerOf(preset, { seed: 9 });
      const a = run(l, 150, 1 / 60, 9, { pointer: { x: 0.4, y: 0.6, over: true } });
      const b = run(l, 150, 1 / 60, 9, { pointer: { x: 0.4, y: 0.6, over: true } });
      expect(a.n, preset).toBeGreaterThan(0);
      expect(positions(a), preset).toEqual(positions(b));
      expect(a.reads, preset).toEqual(b.reads);
      for (let i = 0; i < a.n; i++) expect(Number.isFinite(a.x[i]) && Number.isFinite(a.y[i]), `${preset} agent ${i}`).toBe(true);
    }
  });

  it('a different seed gives a different run', () => {
    const l = layerOf('boids');
    expect(positions(run(l, 30, 1 / 60, 1))).not.toEqual(positions(run(l, 30, 1 / 60, 2)));
  });

  it('steps in fixed 1/60 s steps whatever the frame rate: 60 frames at 60 Hz = 30 at 30 Hz = 120 at 120 Hz', () => {
    const l = layerOf('boids', { g1_count: 120 });
    const a = run(l, 60, 1 / 60), b = run(l, 30, 1 / 30), c = run(l, 120, 1 / 120);
    expect(a.steps).toBe(60); expect(b.steps).toBe(60); expect(c.steps).toBe(60);
    // Same number of the same fixed steps: the same places (to rounding in the accumulator only).
    for (let i = 0; i < a.n; i++) { expect(b.x[i]).toBeCloseTo(a.x[i], 9); expect(c.y[i]).toBeCloseTo(a.y[i], 9); }
    expect(AG_STEP).toBeCloseTo(1 / 60, 12);
  });

  it('Speed scales simulated time; 0 pauses', () => {
    const l = layerOf('boids', { g1_count: 50 });
    expect(run({ ...l, speed: 2 } as AgentsLayer, 30).steps).toBe(60);
    const still = run({ ...l, speed: 0 } as AgentsLayer, 30), start = run({ ...l, speed: 0 } as AgentsLayer, 1);
    expect(still.steps).toBe(0);
    expect(positions(still)).toEqual(positions(start));
  });
});

describe('the spatial hash', () => {
  it('finds exactly the points a brute-force search finds', () => {
    const rand = seededRandom(42), n = 1500, aspect = 16 / 9;
    const xs = new Float64Array(n), ys = new Float64Array(n), alive = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      // Some outside the area too (they land in the edge cells).
      xs[i] = -0.1 + rand() * (aspect + 0.2); ys[i] = -0.1 + rand() * 1.2; alive[i] = rand() < 0.9 ? 1 : 0;
    }
    const out = new Int32Array(n);
    for (const cell of [0.01, 0.05, 0.13, 0.4]) {
      const hs = agHashBuild({}, xs, ys, alive, n, cell, aspect, 1);
      for (let q = 0; q < 200; q++) {
        const x = -0.05 + rand() * (aspect + 0.1), y = -0.05 + rand() * 1.1, r = rand() * 0.3;
        const k = agHashQuery(hs, x, y, r, out);
        const got = Array.from(out.subarray(0, k)).sort((a, b) => a - b);
        const want: number[] = [];
        for (let i = 0; i < n; i++) if (alive[i] && (xs[i] - x) ** 2 + (ys[i] - y) ** 2 <= r * r) want.push(i);
        expect(got, `cell ${cell} query ${q}`).toEqual(want);
      }
    }
  });

  it('lists each cell’s points in index order, so neighbour loops run the same every time', () => {
    const xs = Float64Array.from([0.5, 0.51, 0.52, 0.505]), ys = Float64Array.from([0.5, 0.5, 0.5, 0.5]);
    const hs = agHashBuild({}, xs, ys, null, 4, 0.1, 1, 1), out = new Int32Array(8);
    expect(Array.from(out.subarray(0, agHashQuery(hs, 0.5, 0.5, 0.05, out)))).toEqual([0, 1, 2, 3]);
  });
});

describe('rules', () => {
  const one = (rules: Record<string, unknown>[], over: Record<string, unknown> = {}) => {
    const l = { ...defaultLayer('agents', 'a', 'A'), rules: [], groups: 1, g1_count: 1, spawn: 'centre', spawnRadius: 0, startSpeed: 0, ...over } as unknown as AgentsLayer & Record<string, unknown>;
    rules.forEach((r, i) => {
      const { rule, numbers } = newAgentRule(l, r.type as never);
      const id = `r${i + 1}`;
      l.rules = [...l.rules, { ...rule, id, ...Object.fromEntries(Object.entries(r).filter(([, v]) => typeof v !== 'number')) } as never];
      for (const [k, v] of Object.entries(numbers)) l[k.replace(rule.id, id)] = v;
      for (const [k, v] of Object.entries(r)) if (typeof v === 'number') l[`${id}_${k}`] = v;
    });
    return l;
  };

  it('seek a point gets there; flee from it runs away', () => {
    const seek = run(one([{ type: 'seek', target: 'point', x: 0.8, y: 0.8, speed: 0.5 }, { type: 'drag', weight: 1 }]), 240, 1 / 60, 1, {}, 1);
    expect(Math.hypot(seek.x[0] - 0.8, seek.y[0] - 0.8)).toBeLessThan(0.05);
    const flee = run(one([{ type: 'flee', target: 'point', x: 0.4, y: 0.5, radius: 0.5 }]), 60, 1 / 60, 1, {}, 1);
    expect(flee.x[0]).toBeGreaterThan(0.55);
  });

  it('the pointer is a target only while it is over the picture', () => {
    const l = one([{ type: 'seek', target: 'pointer', speed: 0.5 }]);
    expect(run(l, 30, 1 / 60, 1, { pointer: { x: 0.9, y: 0.5, over: false } }, 1).x[0]).toBeCloseTo(0.5, 6);
    expect(run(l, 30, 1 / 60, 1, { pointer: { x: 0.9, y: 0.5, over: true } }, 1).x[0]).toBeGreaterThan(0.52);
  });

  it('boundary wrap, bounce and kill', () => {
    const moving = (mode: string) => one([{ type: 'boundary', mode, weight: 1 }], { startSpeed: 0, spawn: 'centre' });
    const push = (l: AgentsLayer) => { const st = agCreate(); agStep(st, l, val(l), 0, 1, () => seededRandom(1), {}); st.vx[0] = 1; st.vy[0] = 0; for (let f = 0; f < 45; f++) agStep(st, l, val(l), 1 / 60, 1, () => seededRandom(1), {}); return st; };
    const w = push(moving('wrap')); expect(w.x[0]).toBeGreaterThan(0); expect(w.x[0]).toBeLessThan(0.5);
    const b = push(moving('bounce')); expect(b.vx[0]).toBeLessThan(0); expect(b.x[0]).toBeLessThanOrEqual(1);
    const k = push(moving('kill')); expect(k.alive[0]).toBe(0); expect(k.reads.alive).toBe(0);
  });

  it('max speed caps, and its minimum keeps them moving', () => {
    const l = one([{ type: 'seek', target: 'point', x: 1, y: 0.5, speed: 2, weight: 5 }, { type: 'maxSpeed', weight: 0.2 }], {}), st = run(l, 60, 1 / 60, 1, {}, 2);
    expect(Math.hypot(st.vx[0], st.vy[0])).toBeLessThanOrEqual(0.2 + 1e-9);
    const slow = run(one([{ type: 'maxSpeed', weight: 1, min: 0.3 }], { startSpeed: 0.01 }), 10, 1 / 60, 1, {}, 1);
    expect(Math.hypot(slow.vx[0], slow.vy[0])).toBeCloseTo(0.3, 6);
  });

  it('springs hold a grid at its rest length', () => {
    const l = one([{ type: 'springs', mode: 'grid', weight: 60, damp: 2 }], { g1_count: 36, spawn: 'grid', spawnRadius: 0.3, startSpeed: 0.3 });
    const st = run(l, 240, 1 / 60, 1, {}, 1);
    const L = [...st.links.values()][0];
    expect(L.a.length).toBeGreaterThan(36);
    let err = 0;
    for (let s = 0; s < L.a.length; s++) err += Math.abs(Math.hypot(st.x[L.b[s]] - st.x[L.a[s]], st.y[L.b[s]] - st.y[L.a[s]]) - L.rest[s]);
    expect(err / L.a.length).toBeLessThan(0.01);
  });

  it('catch: predators catch prey, gain energy and the catches are counted', () => {
    const st = run(layerOf('predatorPrey', { seed: 4 }), 600, 1 / 60, 4);
    expect(st.catches).toBeGreaterThan(0);
    expect(st.reads.catches).toBeCloseTo(Math.min(1, st.catches / 20), 9);
    expect(st.reads.group1).toBeGreaterThan(0.5); // prey respawn
  });

  it('born/died signals: a catch counts a death, a prey respawn counts a birth', () => {
    const st = run(layerOf('predatorPrey', { seed: 4 }), 600, 1 / 60, 4);
    // Predator–prey catches and respawns prey the whole run: both counters move, and every catch
    // (each kills the caught prey once) is at most matched by a later revive, never the reverse this early.
    expect(st.evDied).toBeGreaterThan(0);
    expect(st.evDied).toBeGreaterThanOrEqual(st.catches);
    expect(st.evBorn).toBeGreaterThan(0);
  });

  it('energy drain starves a group (each a death); respawn brings it back (each a birth)', () => {
    const l = layerOf('boids', { g1_count: 20, g1_drain: 2 });
    const starved = run(l, 40);
    expect(starved.reads.alive).toBe(0);
    expect(starved.evDied).toBe(20);
    expect(starved.evBorn).toBe(0);
    const revived = run({ ...l, g1_respawn: 50 } as AgentsLayer, 40);
    expect(revived.reads.alive).toBeGreaterThan(0);
    expect(revived.evBorn).toBeGreaterThan(0);
  });

  it('two runs with the same seed give the same born/died counts (determinism)', () => {
    const once = () => { const st = run(layerOf('predatorPrey', { seed: 6 }), 400, 1 / 60, 6); return { born: st.evBorn, died: st.evDied }; };
    expect(once()).toEqual(once());
  });

  it('every rule type runs without NaN', () => {
    for (const type of Object.keys(AG_RULES)) {
      const def = AG_RULES[type];
      for (const mode of def.modes ?? ['']) {
        const l = one([{ type, mode, target: 'point' }, { type: 'boundary', mode: 'bounce' }], { g1_count: 60, spawn: 'random', startSpeed: 0.3 });
        const st = run(l, 30, 1 / 60, 2);
        for (let i = 0; i < st.n; i++) expect(Number.isFinite(st.x[i]) && Number.isFinite(st.vx[i]), `${type}/${mode}`).toBe(true);
      }
    }
  });
});

// ── In the kit and the export ────────────────────────────────────────────────

function fakeCanvas(): HTMLCanvasElement {
  const target: Record<string, unknown> = {
    canvas: null, measureText: (s: string) => ({ width: String(s).length * 6 }),
    getImageData: (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4).fill(128) }),
    createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
    createLinearGradient: () => ({ addColorStop() {} }), createRadialGradient: () => ({ addColorStop() {} }),
  };
  const ctx: unknown = new Proxy(target, { get(t, k: string) { return k in t ? t[k] : () => {}; }, set(t, k: string, v) { t[k] = v; return true; } });
  return { width: 160, height: 90, getContext: () => ctx } as unknown as HTMLCanvasElement;
}
function kitRun(make: () => { frame: (c: CanvasRenderingContext2D, r: PlayRecord, e: KitEnv) => void; reset: (s: number) => void }, layers: PlayLayer[], frames: number, seed = 0) {
  const g = globalThis as { document?: unknown; Path2D?: unknown };
  const had = [g.document, g.Path2D];
  g.document = { createElement: () => fakeCanvas() };
  g.Path2D = class { moveTo() {} lineTo() {} closePath() {} rect() {} arcTo() {} addPath() {} };
  try {
    const kit = make();
    kit.reset(seed);
    const record: PlayRecord = { ...emptyPlayRecord(), layers };
    const at = new Map<string, number>(), sensors = new Map<string, number>();
    const out = fakeCanvas().getContext('2d')!;
    for (let i = 0; i < frames; i++) kit.frame(out, record, {
      gl: fakeCanvas(), W: 160, H: 90, dpr: 1, time: i / 60, dt: 1 / 60,
      value: (l, k) => at.get(`${l.id}::${k}`) ?? (l as unknown as Record<string, number>)[k],
      pointer: { x: 0.3, y: 0.6, over: true, down: false }, markers: false, editing: false, hidden: false, backdrop: [0, 0, 0], audio: null, camera: null, image: () => null,
      sensor: (k, v) => sensors.set(k, v),
      override: (id, k, v) => { if (v === null) at.delete(`${id}::${k}`); else at.set(`${id}::${k}`, v); },
    } as KitEnv);
    return { at, sensors };
  } finally { [g.document, g.Path2D] = had; }
}

describe('the agents layer in the kit', () => {
  it('reports its readings and anchor, and the same twice under its seed', () => {
    const layers = () => [layerOf('predatorPrey', { seed: 3, look: 'goo', links: 'near', trail: 0.5 }) as unknown as PlayLayer];
    const one = kitRun(createLayerKit, layers(), 90), two = kitRun(createLayerKit, layers(), 90);
    expect([...one.sensors]).toEqual([...two.sensors]);
    for (const r of sensorReadsFor({ kind: 'agents' })) if (r !== 'distance') expect(one.sensors.has(`a::${r}`), r).toBe(true);
    expect(one.sensors.get('a::alive')).toBeGreaterThan(0.5);
    expect(one.sensors.get('a::ax')).toBeGreaterThan(0);
  });

  it('reports its cumulative born/died counts (for the play engine’s born/died signals)', () => {
    const layers = () => [layerOf('predatorPrey', { seed: 3 }) as unknown as PlayLayer];
    const { sensors } = kitRun(createLayerKit, layers(), 400);
    expect(sensors.get('a::bornCount')).toBeGreaterThan(0);
    expect(sensors.get('a::diedCount')).toBeGreaterThan(0);
  });

  it('an unseeded layer follows a take’s session seed', () => {
    const layers = () => [layerOf('boids', { seed: 0 }) as unknown as PlayLayer];
    expect([...kitRun(createLayerKit, layers(), 40, 77).sensors]).toEqual([...kitRun(createLayerKit, layers(), 40, 77).sensors]);
  });

  it('a null can follow one agent', () => {
    const nul = { ...defaultLayer('null', 'n', 'N'), follow: 'agent', followId: 'a', agentIndex: 3, spring: 1, wobble: 0 } as PlayLayer;
    const { at } = kitRun(createLayerKit, [layerOf('boids', { seed: 2 }) as unknown as PlayLayer, nul], 60);
    expect(at.has('n::x')).toBe(true);
    expect(at.get('n::x')).not.toBeCloseTo(0.5, 3);
  });

  it('the web export’s inlined kit runs the same frames as the app’s', () => {
    const body = KIT_SOURCES.map(src => src.replace(/^import .*$/gm, '').replace(/^export /gm, '')).join('\n');
    expect(body).toContain('function agStep(');
    const lib = new Function(`${body}; return { createLayerKit };`)() as { createLayerKit: typeof createLayerKit };
    const layers = () => [layerOf('predatorPrey', { seed: 8 }) as unknown as PlayLayer];
    expect([...kitRun(lib.createLayerKit, layers(), 120).sensors]).toEqual([...kitRun(createLayerKit, layers(), 120).sensors]);
  });
});

describe('the agents layer in files and the panel', () => {
  it('survives a save and load, keeps its rule numbers and drops bad rules', () => {
    const l = layerOf('predatorPrey');
    expect(parseLayer(JSON.parse(JSON.stringify(l)))).toEqual(l);
    const raw = { ...l, rules: [...l.rules, { id: 'r1', type: 'seek' }, { id: 'x9', type: 'seek' }, { id: 'r40', type: 'nope' }, { id: 'r41', type: 'orbit', mode: 'sideways', group: 9 }], r41_weight: 'x' };
    const back = parseLayer(JSON.parse(JSON.stringify(raw))) as AgentsLayer & Record<string, unknown>;
    expect(back.rules.length).toBe(l.rules.length + 1);
    const orbit = back.rules[back.rules.length - 1];
    expect(orbit).toMatchObject({ id: 'r41', type: 'orbit', mode: 'ccw', group: 4 });
    expect(back.r41_weight).toBe(AG_RULES.orbit.params[0].value);
  });

  it('offers every rule number and group number as a control', () => {
    const l = layerOf('predatorPrey');
    const keys = layerNumericProps(l).map(p => p.key);
    expect(keys).toContain('speed');
    expect(keys).toContain('r4_weight');
    expect(keys).toContain('g2_drain');
    expect(keys).toContain('r6_speed');
    expect(sensorReadsFor({ kind: 'agents' })).toContain('alive');
  });

  it('bundles the Boids and Predator–prey examples', () => {
    const boids = PLAY_EXAMPLE_GRAPHS.playBoids.play!.layers[0] as AgentsLayer;
    expect(boids).toMatchObject({ kind: 'agents', preset: 'boids' });
    expect(boids.rules.map(r => r.type)).toEqual(['align', 'cohere', 'separate', 'wander', 'maxSpeed', 'boundary', 'flee']);
    const pp = PLAY_EXAMPLE_GRAPHS.playPredatorPrey.play!.layers[0] as AgentsLayer;
    expect(pp).toMatchObject({ kind: 'agents', groups: 2, preset: 'predatorPrey' });
  });
});
