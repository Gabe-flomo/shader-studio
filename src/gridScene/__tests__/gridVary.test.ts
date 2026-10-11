/**
 * Vary per cell and shared motion (docs/grid-builder.md "Vary per cell", "Shared motion"):
 * strength and offset 0 move exactly as before, the same seed gives the same pattern, smooth vs
 * independent, the shader against the CPU, the offset spreading the shapes' phases, the shared
 * edit, nothing live rebuilding, and the built nodes and Play menu.
 */
import { describe, expect, it } from 'vitest';
import { CpuShader } from '../../lib/guidedConvert/cpuGlsl';
import { gridProgram, motionExtra, shapeArgs, shapeIndex, varyArgs } from '../glsl';
import { buildStandaloneGrid, GS_ROLE } from '../build';
import { applyGridScene, gridParamTarget } from '../apply';
import { cellSize, emptyGridScene, motionAt, motionTargets, newShape, placeCell, type GridSceneSpec, type Motion, type Vec2 } from '../spec';
import { VARY_KEYS, defaultMix, varyRandom, type Vary } from '../pathMods';
import { motionDecls, motionLines, motionUniforms } from './motionArgs';

const near = (a: number, b: number, eps = 1e-6) => expect(Math.abs(a - b)).toBeLessThan(eps);

function scene(motion: Motion, o: { two?: boolean; vary?: Vary; mix?: Partial<ReturnType<typeof defaultMix>> } = {}): GridSceneSpec {
  const s = emptyGridScene();
  s.look.glow = false;
  s.shapes = [newShape('A', { kind: 'circle', size: 0.9, motion: { ...structuredClone(motion), ...(o.vary ? { vary: o.vary } : {}) } })];
  if (o.two) s.shapes.push(newShape('B', { kind: 'circle', size: 0.9, motion: { ...structuredClone(motion), ...(o.vary ? { vary: o.vary } : {}) } }));
  if (o.mix) s.motionMix = { ...defaultMix(), ...o.mix };
  for (const [x, y] of [[2, 2], [3, 2], [6, 5], [4, 7]]) placeCell(s, x, y, 'A');
  if (o.two) for (const [x, y] of [[7, 2], [2, 6]]) placeCell(s, x, y, 'B');
  return s;
}

/** The shader's gs_move for shape `id` at home (hx, hy), on the CPU shader. */
function shaderMove(s: GridSceneSpec, id: string, hx: number, hy: number, t: number): Vec2 {
  const p = gridProgram(s);
  const fn = new RegExp(`vec2 gs_move${id}_\\w+`).exec(p.functions)![0].replace('vec2 ', '');
  const a = shapeArgs(id);
  const m = s.shapes.find(x => x.id === id)!.motion;
  const src = ['uniform float p_t;', `uniform vec4 ${a.m};`, ...motionDecls(s), p.functions, 'void main() {', ...motionLines(s),
    `  vec2 hh = vec2(${hx.toFixed(1)}, ${hy.toFixed(1)});`,
    `  gl_FragColor = vec4(${fn}(hh, ${(hx + hy).toFixed(1)}, p_t, ${a.m}, ${a.x}${varyArgs(s, s.shapes.find(x => x.id === id)!, 'hh', a.x).split('$').join(fn.slice(fn.lastIndexOf('_')))}), 0.0, 0.0);`, '}'].join('\n');
  const g = new CpuShader(src).run([0, 0], { resolution: [8, 8], time: t, uniforms: { p_t: t, [a.m]: [m.xy[0], m.xy[1], m.speed, m.lag], ...motionUniforms(s) } })!;
  return [g[0], g[1]];
}

/** The scene function's (colour, distance) at grid place g (cells, y down), time t. */
function sceneAt(s: GridSceneSpec) {
  const p = gridProgram(s);
  const decl = s.shapes.flatMap(x => { const a = shapeArgs(x.id); return [`uniform vec4 ${a.m};`, `uniform vec4 ${a.l};`, `uniform float ${a.e};`, `uniform vec3 ${a.c};`]; });
  const src = ['uniform vec2 p_uv;', 'uniform float p_t;', 'uniform vec4 pt;', ...decl, ...motionDecls(s), p.functions, 'void main() {',
    `  float gd[${p.data.length}];`, ...p.data.map((v, i) => `  gd[${i}] = ${v.toFixed(1)};`), ...motionLines(s), '  vec4 hp = vec4(0.0);',
    `  gl_FragColor = ${p.name}(p_uv, p_t, pt, ${p.args.join(', ')});`, '}'].join('\n');
  const cpu = new CpuShader(src);
  const u: Record<string, number | number[]> = { pt: [0, 0, 0, 3], ...motionUniforms(s) };
  for (const x of s.shapes) {
    const a = shapeArgs(x.id);
    u[a.m] = [x.motion.xy[0], x.motion.xy[1], x.motion.speed, x.motion.lag];
    u[a.l] = [x.size, 0, x.spin, x.pulse];
    u[a.e] = x.outline; u[a.c] = [...x.color];
  }
  const cs = cellSize(s);
  return (g: Vec2, t: number) => cpu.run([0, 0], { resolution: [800, 800], time: t, uniforms: { ...u, p_uv: [(g[0] - s.cols / 2) * cs, (s.rows / 2 - g[1]) * cs], p_t: t } })!;
}

/** The scene's brute-force reference: every cell for every shape. */
function bruteAt(s: GridSceneSpec) {
  const p = gridProgram(s, { brute: true });
  const decl = s.shapes.flatMap(x => { const a = shapeArgs(x.id); return [`uniform vec4 ${a.m};`, `uniform vec4 ${a.l};`, `uniform float ${a.e};`, `uniform vec3 ${a.c};`]; });
  const src = ['uniform vec2 p_uv;', 'uniform float p_t;', 'uniform vec4 pt;', ...decl, ...motionDecls(s), p.functions, 'void main() {',
    `  float gd[${p.data.length}];`, ...p.data.map((v, i) => `  gd[${i}] = ${v.toFixed(1)};`), ...motionLines(s), '  vec4 hp = vec4(0.0);',
    `  gl_FragColor = ${p.name}(p_uv, p_t, pt, ${p.args.join(', ')});`, '}'].join('\n');
  return { src, run: sceneAt(s) };
}

const CIRCLE: Motion = { path: 'circle', xy: [0.6, 0.4], speed: 0.4, lag: 0.08 };
const POINTS: Vec2[] = Array.from({ length: 100 }, (_, i) => [0.25 + (i % 10) * 0.97, 0.3 + Math.floor(i / 10) * 0.96]);

describe('strength and offset 0: exactly as before', () => {
  it('a vary of all zeros and a mix of zeros move every cell as with neither', () => {
    const zero: Vary = Object.fromEntries(VARY_KEYS.map(k => [k, { amt: 0, smooth: k === 'speed' }]));
    const plain = scene(CIRCLE, { two: true });
    const varied = scene(CIRCLE, { two: true, vary: zero, mix: { seed: 42 } });
    for (const t of [0.3, 2.1]) {
      for (const [x, y] of [[2, 2], [6, 5]]) {
        const a = motionAt(plain, plain.shapes[1].motion, x, y, t, 1), b = motionAt(varied, varied.shapes[1].motion, x, y, t, 1);
        near(a[0], b[0], 1e-12); near(a[1], b[1], 1e-12);
        const c = shaderMove(varied, 'B', x, y, t);
        near(c[0], a[0], 1e-5); near(c[1], a[1], 1e-5);
      }
    }
    // The whole picture too: colour and distance at a spread of points.
    const A = sceneAt(plain), B = sceneAt(varied);
    for (const g of POINTS) for (const t of [0.4, 1.7]) { const a = A(g, t), b = B(g, t); for (let k = 0; k < 4; k++) near(a[k], b[k], 1e-5); }
  });
  it('a scene without vary or a mix builds exactly the code it did', () => {
    const plain = scene(CIRCLE);
    expect(gridProgram(plain).functions).not.toContain('gs_vary');
    expect(gridProgram(plain).functions).not.toContain('mm.xy');
  });
});

describe('the randomness', () => {
  it('the same seed gives the same pattern; another seed another', () => {
    const a = Array.from({ length: 20 }, (_, i) => varyRandom(i % 5, Math.floor(i / 5), 7, 'reach', { amt: 1 }));
    expect(Array.from({ length: 20 }, (_, i) => varyRandom(i % 5, Math.floor(i / 5), 7, 'reach', { amt: 1 }))).toEqual(a);
    expect(Array.from({ length: 20 }, (_, i) => varyRandom(i % 5, Math.floor(i / 5), 8, 'reach', { amt: 1 }))).not.toEqual(a);
    // Keys differ from each other (an angle isn't the reach's twin).
    expect(varyRandom(3, 4, 7, 'angle', { amt: 1 })).not.toBe(varyRandom(3, 4, 7, 'reach', { amt: 1 }));
  });
  it('± spans −1 … 1, up only 0 … 1', () => {
    const pm = Array.from({ length: 400 }, (_, i) => varyRandom(i % 20, Math.floor(i / 20), 3, 'phase', { amt: 1 }));
    const up = Array.from({ length: 400 }, (_, i) => varyRandom(i % 20, Math.floor(i / 20), 3, 'phase', { amt: 1, up: true }));
    expect(Math.min(...pm)).toBeLessThan(-0.8); expect(Math.max(...pm)).toBeGreaterThan(0.8);
    expect(Math.min(...up)).toBeGreaterThanOrEqual(0); expect(Math.max(...up)).toBeLessThanOrEqual(1);
  });
  it('smooth: neighbouring cells get similar numbers; independent: they don\'t', () => {
    const step = (smooth: boolean) => {
      let d = 0;
      for (let y = 0; y < 16; y++) for (let x = 0; x < 15; x++) d += Math.abs(varyRandom(x + 1, y, 5, 'reach', { amt: 1, smooth }) - varyRandom(x, y, 5, 'reach', { amt: 1, smooth }));
      return d / (16 * 15);
    };
    expect(step(true)).toBeLessThan(0.3);
    expect(step(false)).toBeGreaterThan(0.5);
  });
});

describe('the shader varies as the CPU does', () => {
  it.each([
    ['reach ±', { reach: { amt: 0.6 } }],
    ['angle smooth', { angle: { amt: 0.5, smooth: true } }],
    ['speed up', { speed: { amt: 0.7, up: true } }],
    ['phase', { phase: { amt: 0.8 } }],
    ['all together', { reach: { amt: 0.3 }, angle: { amt: 0.2 }, speed: { amt: 0.3, smooth: true }, phase: { amt: 0.5, up: true } }],
  ] as Array<[string, Vary]>)('%s', (_n, vary) => {
    const s = scene({ ...CIRCLE, mods: [{ id: 'm1', kind: 'wave', v: [0.2, 3, 0.4] }] }, { two: true, vary, mix: { seed: 13, offPhase: 0.2, offAngle: 30, offReach: 0.3 } });
    for (const [x, y] of [[2, 2], [7, 2], [4, 7]]) for (const t of [0.6, 2.4]) {
      for (const sh of s.shapes) {
        const a = shaderMove(s, sh.id, x, y, t), b = motionAt(s, sh.motion, x, y, t, shapeIndex(sh));
        near(a[0], b[0], 1e-4); near(a[1], b[1], 1e-4);
      }
    }
  });
  it('the modifiers\' strength scales Wave along\'s amount per cell', () => {
    const s = scene({ path: 'sideways', xy: [1, 0], speed: 0.3, lag: 0, mods: [{ id: 'm1', kind: 'wave', v: [0.3, 2, 0] }] }, { vary: { mods: { amt: 1 } }, mix: { seed: 5 } });
    const a = shaderMove(s, 'A', 3, 2, 0.7), b = motionAt(s, s.shapes[0].motion, 3, 2, 0.7);
    near(a[0], b[0], 1e-4); near(a[1], b[1], 1e-4);
  });
});

describe('the search finds every varied shape (against brute force)', () => {
  it.each([
    ['reach and angle', { reach: { amt: 0.8 }, angle: { amt: 0.6 } }, 0.1],
    ['phase and speed, smooth', { phase: { amt: 1, smooth: true }, speed: { amt: 0.8 } }, 0.05],
    ['size and pulse', { size: { amt: 0.9, up: true }, pulse: { amt: 1 } }, 0],
    ['modifiers', { mods: { amt: 1 } }, 0.1],
  ] as Array<[string, Vary, number]>)('%s', (_n, vary, lag) => {
    const s = scene({ path: 'eight', xy: [1.2, 0.8], speed: 0.4, lag, mods: [{ id: 'm1', kind: 'twist', v: [0.4, 2, 0] }] }, { two: true, vary, mix: { seed: 3, offPhase: 0.3, offReach: 0.4, offAngle: 50 } });
    s.shapes[0].pulse = 0.4;
    const fast = sceneAt(s);
    const brute = new CpuShader(bruteAt(s).src);
    const cs = cellSize(s);
    const u: Record<string, number | number[]> = { pt: [0, 0, 0, 3], ...motionUniforms(s) };
    for (const x of s.shapes) {
      const a = shapeArgs(x.id);
      u[a.m] = [x.motion.xy[0], x.motion.xy[1], x.motion.speed, x.motion.lag];
      u[a.l] = [x.size, 0, x.spin, x.pulse];
      u[a.e] = x.outline; u[a.c] = [...x.color];
    }
    let worst = 0, inside = 0;
    for (const g of POINTS) for (const t of [0.5, 2.6]) {
      const a = fast(g, t);
      const b = brute.run([0, 0], { resolution: [800, 800], time: t, uniforms: { ...u, p_uv: [(g[0] - s.cols / 2) * cs, (s.rows / 2 - g[1]) * cs], p_t: t } })!;
      // Inside a shape (glow off: outside, the search needn't know the exact distance) the two agree exactly.
      if (b[3] < 0) { inside++; for (let k = 0; k < 4; k++) worst = Math.max(worst, Math.abs(a[k] - b[k])); }
    }
    expect(inside).toBeGreaterThan(4);
    expect(worst).toBeLessThan(1e-4);
  }, 60_000);
});

describe('shared motion and the offset', () => {
  it('Shared: an edit reaches every shape; off: only the one edited', () => {
    const s = scene(CIRCLE, { two: true });
    expect(motionTargets(s, 'A').map(x => x.id)).toEqual(['A']);
    s.motionMix = { ...defaultMix(), shared: true };
    expect(motionTargets(s, 'A').map(x => x.id)).toEqual(['A', 'B']);
    // Shared motion is identical per-shape motions: the same cell moves the same for A and B (offset 0).
    for (const t of [0.3, 1.9]) expect(motionAt(s, s.shapes[1].motion, 3, 3, t, 1)).toEqual(motionAt(s, s.shapes[0].motion, 3, 3, t, 0));
  });
  it('the offset spreads the shapes: B runs offPhase of a cycle after A, turned offAngle more, its reach 1 + offReach', () => {
    const m: Motion = { path: 'circle', xy: [0.5, 0.5], speed: 0.25, lag: 0 };
    const s = scene(m, { two: true, mix: { offPhase: 0.25 } });
    const a = motionAt(s, m, 3, 3, 1 + 0.25 / 0.25, 0), b = motionAt(s, m, 3, 3, 1, 1);
    near(a[0], b[0], 1e-9); near(a[1], b[1], 1e-9);
    const r = scene(m, { two: true, mix: { offReach: 1 } });
    const o0 = motionAt(r, m, 3, 3, 0.3, 0), o1 = motionAt(r, m, 3, 3, 0.3, 1);
    near(Math.hypot(o1[0] - 3.5, o1[1] - 3.5), 2 * Math.hypot(o0[0] - 3.5, o0[1] - 3.5), 1e-9);
    // And the shader agrees for B.
    const g = scene(m, { two: true, mix: { offPhase: 0.3, offAngle: 40, offReach: 0.5 } });
    const sb = shaderMove(g, 'B', 3, 3, 0.8), cb = motionAt(g, m, 3, 3, 0.8, 1);
    near(sb[0], cb[0], 1e-5); near(sb[1], cb[1], 1e-5);
  });
  it('travel with an offset: still found round the wrap (against brute force)', () => {
    const s = scene({ path: 'travel', xy: [-1.5, 1], speed: 0.4, lag: 0.1 }, { two: true, mix: { offPhase: 0.35, offAngle: 30, offReach: 0.5 } });
    const fast = sceneAt(s);
    const brute = new CpuShader(bruteAt(s).src);
    const cs = cellSize(s);
    const u: Record<string, number | number[]> = { pt: [0, 0, 0, 3], ...motionUniforms(s) };
    for (const x of s.shapes) {
      const a = shapeArgs(x.id);
      u[a.m] = [x.motion.xy[0], x.motion.xy[1], x.motion.speed, x.motion.lag];
      u[a.l] = [x.size, 0, x.spin, x.pulse]; u[a.e] = x.outline; u[a.c] = [...x.color];
    }
    let worst = 0, inside = 0;
    for (const g of POINTS) for (const t of [0.5, 7.6]) {
      const a = fast(g, t);
      const b = brute.run([0, 0], { resolution: [800, 800], time: t, uniforms: { ...u, p_uv: [(g[0] - s.cols / 2) * cs, (s.rows / 2 - g[1]) * cs], p_t: t } })!;
      if (b[3] < 0) { inside++; for (let k = 0; k < 4; k++) worst = Math.max(worst, Math.abs(a[k] - b[k])); }
    }
    expect(inside).toBeGreaterThan(4);
    expect(worst).toBeLessThan(1e-4);
  }, 60_000);
});

describe('live, built and in the Play menu', () => {
  it('strengths, modes, the seed and the offsets are numbers, not code', () => {
    const base = scene(CIRCLE, { two: true, vary: { reach: { amt: 0.2 } }, mix: {} });
    const code = gridProgram(base).functions;
    const live: Array<(s: GridSceneSpec) => void> = [
      s => { s.shapes[0].motion.vary!.reach = { amt: 0.7, smooth: true, up: true }; },
      s => { s.shapes[0].motion.vary!.size = { amt: 0.4 }; },
      s => { s.motionMix!.seed = 99; },
      s => { s.motionMix!.offPhase = 0.4; s.motionMix!.offAngle = 20; s.motionMix!.offReach = -0.3; },
    ];
    for (const v of live) {
      const s = structuredClone(base); v(s);
      expect(gridProgram(s).functions).toBe(code);
      expect(motionExtra(s.shapes[0], s)).not.toEqual(motionExtra(base.shapes[0], base));
    }
  });
  it('a Motion node carries the offsets and the seed for every shape; the strengths are Shape node sliders', () => {
    const s = scene(CIRCLE, { two: true, vary: { angle: { amt: 0.3 } }, mix: { offPhase: 0.2, seed: 9 } });
    const g = buildStandaloneGrid(s);
    const motion = g.nodes.find(n => n.params[GS_ROLE] === 'motion')!;
    expect(motion.params.offPhase).toBe(0.2);
    expect(motion.params.seed).toBe(9);
    const grid = g.nodes.find(n => n.params[GS_ROLE] === 'grid')!;
    expect(grid.inputs.mmix.connection).toEqual({ nodeId: motion.id, outputKey: 'result' });
    const shapeA = g.nodes.find(n => n.params[GS_ROLE] === 'A')!;
    expect(shapeA.params.v_angle).toBe(0.3);
    expect(shapeA.inputs.v_angle).toBeDefined();
    let n = 0;
    const r = applyGridScene([], s, { nextId: () => `n${n++}` });
    const mid = r.nodes.find(x => x.params[GS_ROLE] === 'motion')!.id;
    expect(gridParamTarget(r.nodes, r.sceneId, 'motion', 'offPhase')).toEqual({ nodeId: mid, key: 'offPhase' });
    expect(gridParamTarget(r.nodes, r.sceneId, 'A', 'v_angle')).toMatchObject({ key: 'v_angle' });
  });
  it('without a mix there is no Motion node (old scenes build as they did)', () => {
    expect(buildStandaloneGrid(scene(CIRCLE)).nodes.some(n => n.params[GS_ROLE] === 'motion')).toBe(false);
  });
});
