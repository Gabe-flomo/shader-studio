/**
 * Math paths and path modifiers (docs/grid-builder.md "Math paths", "Path modifiers"): the
 * shader's motion against the CPU's, each modifier's maths, the search bound staying
 * conservative, nothing live rebuilding the code, the built nodes and the Play menu's targets.
 */
import { describe, expect, it } from 'vitest';
import { CpuShader } from '../../lib/guidedConvert/cpuGlsl';
import { generalBoundCpu, gridProgram, motionExtra, shapeArgs } from '../glsl';
import { buildStandaloneGrid, GS_ROLE } from '../build';
import { applyGridScene, gridParamTarget } from '../apply';
import { emptyGridScene, motionAt, newShape, pathOffsetAt, placeCell, type GridSceneSpec, type Motion, type MotionPath, type Vec2 } from '../spec';
import {
  CURVE_PRESETS, FORMULA_PRESETS, JUMP, MOD_DEFS, MOD_KINDS, defaultMath, formulaProblems, mathPoint, modBound, modOffset, modPhase, newMod,
  type MathPath, type ModKind, type PathMod,
} from '../pathMods';
import { defaultDrawnPath, generatePath } from '../paths';
import { motionDecls, motionLines, motionUniforms } from './motionArgs';

const near = (a: number, b: number, eps = 1e-6) => expect(Math.abs(a - b)).toBeLessThan(eps);
const len = (v: Vec2) => Math.hypot(v[0], v[1]);

function scene(motion: Motion): GridSceneSpec {
  const s = emptyGridScene();
  s.shapes = [newShape('A', { kind: 'circle', size: 0.6, motion })];
  placeCell(s, 4, 5, 'A');
  return s;
}
const mod = (kind: ModKind, v?: number[], muted?: boolean): PathMod => ({ ...newMod(kind, []), id: `m${MOD_KINDS.indexOf(kind) + 1}`, ...(v ? { v } : {}), ...(muted ? { muted } : {}) });
const formula = (key: string): MathPath => { const f = FORMULA_PRESETS.find(p => p.key === key)!; return { ...defaultMath(), kind: 'formula', x: f.x, y: f.y, params: f.params.map(p => ({ ...p })) }; };
const curve = (key: string): MathPath => ({ ...defaultMath(), kind: 'curve', curve: { ...CURVE_PRESETS.find(p => p.key === key)!.curve } });

/** The shader's gs_move (home 4, 5) and, with `bound`, its gs_bound, on the CPU shader. */
function shader(s: GridSceneSpec) {
  const p = gridProgram(s);
  const move = /vec2 gs_moveA_\w+/.exec(p.functions)![0].replace('vec2 ', '');
  const bound = /vec2 gs_boundA_\w+/.exec(p.functions)?.[0].replace('vec2 ', '');
  const m = s.shapes[0].motion;
  const mk = (expr: string) => new CpuShader(['uniform float p_t;', 'uniform vec4 mA;', ...motionDecls(s), p.functions, 'void main() {', ...motionLines(s), `  gl_FragColor = ${expr};`, '}'].join('\n'));
  const mv = mk(`vec4(${move}(vec2(4.0, 5.0), 9.0, p_t, mA, xA), 0.0, 0.0)`);
  const bd = bound ? mk(`vec4(${bound}(mA, xA, p_t), 0.0, 0.0)`) : null;
  const u = (t: number) => ({ resolution: [8, 8] as [number, number], time: t, uniforms: { p_t: t, mA: [m.xy[0], m.xy[1], m.speed, m.lag], ...motionUniforms(s) } });
  return {
    at: (t: number): Vec2 => { const g = mv.run([0, 0], u(t))!; return [g[0], g[1]]; },
    bound: (t: number): Vec2 | null => { if (!bd) return null; const g = bd.run([0, 0], u(t))!; return [g[0], g[1]]; },
  };
}

const CASES: Array<[string, Motion]> = [
  ['formula: circle', { path: 'math', xy: [0.6, 0.4], speed: 0.4, lag: 0.06, math: formula('circle') }],
  ['formula: rose (k = 3)', { path: 'math', xy: [0.7, 0.7], speed: 0.3, lag: 0.05, math: formula('rose'), angle: 20 }],
  ['formula: heart', { path: 'math', xy: [0.6, 0.6], speed: 0.3, lag: 0.05, math: formula('heart') }],
  ['formula: squircle', { path: 'math', xy: [0.6, 0.6], speed: 0.3, lag: 0.05, math: formula('squircle') }],
  ...CURVE_PRESETS.map(c => [`curve: ${c.label}`, { path: 'math' as MotionPath, xy: [0.5, 0.5] as Vec2, speed: 0.35, lag: 0.04, math: curve(c.key) }] as [string, Motion]),
  ...MOD_KINDS.map(k => [`circle + ${MOD_DEFS[k].label}`, { path: 'circle' as MotionPath, xy: [0.6, 0.3] as Vec2, speed: 0.4, lag: 0.06, angle: 25, mods: [mod(k)] }] as [string, Motion]),
  ['eight + wave, twist, repeat, ease', { path: 'eight', xy: [0.6, 0.4], speed: 0.3, lag: 0.05, mods: [mod('ease'), mod('wave'), mod('twist', [0.4, 2, 1]), mod('repeat', [3])] }],
  ['drawn + noise, scale, mirror (muted)', { path: 'drawn', xy: [0.6, 0.6], speed: 0.3, lag: 0.05, drawn: { ...defaultDrawnPath(), pts: generatePath(4, { closed: true, wiggle: 0.5, points: 9 }) }, mods: [mod('noise'), mod('scale', [1.5, -0.7]), mod('mirror', [2], true)] }],
  ['curve + rotate spinning', { path: 'math', xy: [0.5, 0.5], speed: 0.3, lag: 0, math: curve('star'), mods: [mod('rotate', [40, 90])] }],
];

describe('the shader moves as the CPU does', () => {
  it.each(CASES)('%s', (_n, motion) => {
    const s = scene(motion);
    const sh = shader(s);
    for (const t of [0.3, 1.45, 2.9]) {
      const a = sh.at(t), b = motionAt(s, motion, 4, 5, t);
      near(a[0], b[0], 1e-4); near(a[1], b[1], 1e-4);
    }
  });
});

describe('the modifiers\' maths', () => {
  const circle: Motion = { path: 'circle', xy: [1, 1], speed: 1, lag: 0 };
  const at = (mods: PathMod[], ph: number, t = 0) => pathOffsetAt({ ...circle, mods }, ph, t);
  it('Scale stretches, Rotate turns (and spins), Mirror flips', () => {
    const b = at([], 0.1);
    const s = at([mod('scale', [2, -0.5])], 0.1);
    near(s[0], 2 * b[0]); near(s[1], -0.5 * b[1]);
    const r = at([mod('rotate', [90, 0])], 0.1);
    near(r[0], -b[1]); near(r[1], b[0]);
    const r2 = at([mod('rotate', [0, 45])], 0.1, 2);
    near(r2[0], -b[1]); near(r2[1], b[0]);
    const mx = at([mod('mirror', [0])], 0.1), my = at([mod('mirror', [1])], 0.1), mb = at([mod('mirror', [2])], 0.1);
    near(mx[0], -b[0]); near(mx[1], b[1]); near(my[0], b[0]); near(my[1], -b[1]); near(mb[0], -b[0]); near(mb[1], -b[1]);
  });
  it('Repeat runs the path n times a cycle; Ease keeps the ends and the middle', () => {
    for (const ph of [0.07, 0.31, 0.62]) {
      const r = at([mod('repeat', [3])], ph), b = at([], 3 * ph);
      near(r[0], b[0]); near(r[1], b[1]);
    }
    expect(modPhase([mod('ease', [1])], 0.5)).toBeCloseTo(0.5, 12);
    expect(modPhase([mod('ease', [1])], 1.25)).toBeLessThan(1.25);
    expect(modPhase([mod('ease', [1])], 2)).toBe(2);
  });
  it('Twist swells the radius with progress, and turns it', () => {
    const tw = at([mod('twist', [0.5, 1, 0])], 0.25);
    near(len(tw), 1.5);
    const turned = at([mod('twist', [0, 1, 1])], 0.25);
    const b = at([], 0.25);
    near(len(turned), len(b));
    near(Math.atan2(turned[1], turned[0]), Math.atan2(b[1], b[0]) + Math.PI / 2 - 2 * Math.PI * (Math.atan2(b[1], b[0]) + Math.PI / 2 > Math.PI ? 1 : 0));
  });
  it('Wave along pushes across the path (its normal), by at most its amount', () => {
    const line: Motion = { path: 'sideways', xy: [1, 0], speed: 1, lag: 0 };
    for (const ph of [0.1, 0.4, 0.9]) {
      const w = pathOffsetAt({ ...line, mods: [mod('wave', [0.2, 3, 0])] }, ph), b = pathOffsetAt(line, ph);
      near(w[0], b[0], 1e-9);
      expect(Math.abs(w[1])).toBeLessThanOrEqual(0.2 + 1e-9);
    }
  });
  it('Noise wobbles by at most its amount (each way) and loops seamlessly', () => {
    const n = [mod('noise', [0.3, 5, 0, 7])];
    for (let i = 0; i <= 50; i++) {
      const o = modOffset(n, [0, 0], i / 50, 0, () => [0, 0]);
      expect(Math.abs(o[0])).toBeLessThanOrEqual(0.3 + 1e-9);
      expect(Math.abs(o[1])).toBeLessThanOrEqual(0.3 + 1e-9);
    }
    const a = modOffset(n, [0, 0], 0, 0, () => [0, 0]), b = modOffset(n, [0, 0], 0.999999, 0, () => [0, 0]);
    near(a[0], b[0], 1e-4); near(a[1], b[1], 1e-4);
  });
  it('a muted modifier does nothing', () => {
    const b = at([], 0.3), m = at([mod('scale', [3, 3], true), mod('twist', [0.5, 2, 1], true)], 0.3);
    near(m[0], b[0]); near(m[1], b[1]);
  });
});

describe('the search bound stays conservative', () => {
  /** The largest offset and rate (cells, per cycle) along a cycle, densely sampled. */
  function measure(m: Motion, t: number): [number, number] {
    let R = 0, V = 0;
    const n = 1200;
    let prev = pathOffsetAt(m, 0, t);
    for (let i = 1; i <= n; i++) {
      const o = pathOffsetAt(m, i / n, t);
      R = Math.max(R, len(o));
      V = Math.max(V, len([o[0] - prev[0], o[1] - prev[1]]) * n);
      prev = o;
    }
    return [R, V];
  }
  it.each(CASES)('%s: the reach and rate hold the path', (_n, motion) => {
    const s = scene(motion);
    const [R, V] = generalBoundCpu(s.shapes[0]);
    for (const t of [0, 0.7, 2.3]) {
      const [r, v] = measure(motion, t);
      expect(r).toBeLessThanOrEqual(R + 1e-6);
      // Snap-like jumps (an open path's seam) only matter below JUMP.
      if (V < JUMP) expect(v).toBeLessThanOrEqual(V * 1.01 + 1e-6);
    }
  });
  it('random stacks: the bound holds', () => {
    let seed = 1;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const paths: MotionPath[] = ['updown', 'sideways', 'both', 'circle', 'eight', 'bounce'];
    for (let k = 0; k < 150; k++) {
      const kinds = Array.from({ length: 1 + Math.floor(rnd() * 3) }, () => MOD_KINDS[Math.floor(rnd() * MOD_KINDS.length)]);
      const mods = kinds.map((kd, i) => ({ id: `m${i + 1}`, kind: kd, v: MOD_DEFS[kd].params.map(p => (p.integer ? Math.round(p.min + rnd() * (p.max - p.min)) : p.min + rnd() * (p.max - p.min))) }));
      const m: Motion = { path: paths[k % paths.length], xy: [rnd() * 2 - 1, rnd() * 2 - 1], speed: 0.4, lag: 0, mods };
      const [R, V] = generalBoundCpu({ motion: m });
      const [r, v] = measure(m, rnd() * 3);
      expect(r, JSON.stringify(m)).toBeLessThanOrEqual(R + 1e-6);
      if (V < JUMP) expect(v, JSON.stringify(m)).toBeLessThanOrEqual(V * 1.02 + 1e-6);
    }
  });
  it('the shader\'s bound is the CPU\'s', () => {
    for (const [, motion] of CASES) {
      const s = scene(motion);
      const b = shader(s).bound(0.7);
      if (!b) continue;
      const [R, V] = generalBoundCpu(s.shapes[0]);
      near(b[0], R, 1e-4);
      if (V < JUMP) near(b[1], V, 1e-3 * Math.max(1, V));
    }
  });
  it('modBound on its own: scale and twist widen, rotate and mirror don\'t', () => {
    expect(modBound([mod('rotate', [33, 10]), mod('mirror', [2])], 1, 2)).toEqual([1, 2]);
    expect(modBound([mod('scale', [2, -3])], 1, 2)).toEqual([3, 6]);
    expect(modBound([mod('wave', [0.25, 4, 0])], 1, 2)).toEqual([1.25, JUMP]);
    expect(modBound([mod('repeat', [3])], 1, 2)).toEqual([1, 6]);
  });
});

describe('formulas: checked as typed, and nothing live rebuilds', () => {
  it('a formula that doesn\'t check says why, and moves round a circle meanwhile', () => {
    const bad: MathPath = { ...formula('circle'), x: 'cos(TAU * t) * kk' };
    expect(formulaProblems(bad)[0]).toMatch(/kk/);
    expect(formulaProblems(formula('rose'))).toEqual([]);
    const p = mathPoint(bad, 0.25);
    near(p[0], 0, 1e-9); near(p[1], 1, 1e-9);
    expect(gridProgram(scene({ path: 'math', xy: [0.5, 0.5], speed: 0.3, lag: 0, math: bad })).functions).toContain('cos(6.2831853 * t)');
  });
  it('the y line can read x (the x just worked out)', () => {
    const m: MathPath = { ...formula('circle'), x: '0.5', y: 'x * 2' };
    expect(mathPoint(m, 0.3)).toEqual([0.5, 1]);
    const s = scene({ path: 'math', xy: [1, 1], speed: 0.3, lag: 0, math: m });
    const a = shader(s).at(0.4);
    near(a[0], 4.5 + 0.5, 1e-5); near(a[1], 5.5 - 1, 1e-5);
  });
  it('sliders, curve numbers, modifier numbers and mutes are numbers, not code; the text, the kinds and the order are code', () => {
    const base: Motion = { path: 'math', xy: [0.5, 0.5], speed: 0.3, lag: 0.05, math: formula('wobble'), mods: [mod('wave'), mod('twist')] };
    const code = gridProgram(scene(base)).functions;
    const live: Array<(m: Motion) => void> = [
      m => { m.math!.params[0].value = 0.5; },
      m => { m.mods![0].v[0] = 0.4; },
      m => { m.mods![1].muted = true; },
      m => { m.angle = 30; },
    ];
    for (const v of live) {
      const m = structuredClone(base); v(m);
      expect(gridProgram(scene(m)).functions).toBe(code);
      expect(motionExtra({ motion: m })).not.toEqual(motionExtra({ motion: base }));
    }
    const c: Motion = { path: 'math', xy: [0.5, 0.5], speed: 0.3, lag: 0, math: curve('lissajous') };
    const cc = structuredClone(c); cc.math!.curve.freqX = 7; cc.math!.curve.damping = 0.3;
    expect(gridProgram(scene(cc)).functions).toBe(gridProgram(scene(c)).functions);
    const structural: Array<(m: Motion) => void> = [
      m => { m.math!.x = 'sin(TAU * t)'; },
      m => { m.mods!.reverse(); },
      m => { m.mods![0] = { ...mod('noise'), id: m.mods![0].id }; },
    ];
    for (const v of structural) { const m = structuredClone(base); v(m); expect(gridProgram(scene(m)).functions).not.toBe(code); }
  });
});

describe('the built nodes and the Play menu', () => {
  it('a curve\'s numbers and the modifiers\' are sliders on the Shape node (wireable), packed into lp… for the Grid scene', () => {
    const s = scene({ path: 'math', xy: [0.5, 0.5], speed: 0.3, lag: 0, math: curve('star'), mods: [mod('wave'), mod('scale', [1, 2], true)] });
    const g = buildStandaloneGrid(s);
    const shapeNode = g.nodes.find(n => n.params[GS_ROLE] === 'A')!;
    expect(shapeNode.params.curveFreqY).toBe(3);
    expect(shapeNode.inputs.curveFreqY).toBeDefined();
    expect(shapeNode.inputs.m1amp).toBeDefined();
    expect(shapeNode.params.m3on).toBe(0); // the muted Scale (its id from its kind's place)
    expect(shapeNode.inputs.m3on).toBeUndefined(); // the mute is hidden: the card's switch
    const grid = g.nodes.find(n => n.params[GS_ROLE] === 'grid')!;
    expect(grid.inputs.lpA0.connection).toEqual({ nodeId: shapeNode.id, outputKey: 'lp0' });
    const a = shapeArgs('A');
    expect(grid.inputs[a.r]).toBeDefined();
  });
  it('the Play menu finds them on the built node', () => {
    const s = scene({ path: 'math', xy: [0.5, 0.5], speed: 0.3, lag: 0, math: formula('rose'), mods: [mod('noise')] });
    let n = 0;
    const r = applyGridScene([], s, { nextId: () => `n${n++}` });
    const id = r.nodes.find(x => x.params[GS_ROLE] === 'A')!.id;
    expect(gridParamTarget(r.nodes, r.sceneId, 'A', 'f_k')).toEqual({ nodeId: id, key: 'f_k' });
    expect(gridParamTarget(r.nodes, r.sceneId, 'A', 'm2amp')).toEqual({ nodeId: id, key: 'm2amp' });
  });
});
