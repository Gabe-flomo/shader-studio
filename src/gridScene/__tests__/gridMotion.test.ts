/**
 * The Grid builder's motion Angle and Drawn paths (docs/grid-builder.md "Angle", "Drawn paths"):
 * the maths on the CPU, the shader's motion against it, the search's reach under a turn, that none
 * of the live numbers rebuild the code, the built nodes' inputs, and the Play menu's target.
 */
import { describe, expect, it } from 'vitest';
import { CpuShader } from '../../lib/guidedConvert/cpuGlsl';
import { gridProgram, motionExtra, searchRadiusAt, shapeArgs } from '../glsl';
import { buildStandaloneGrid, GS_ROLE } from '../build';
import { applyGridScene } from '../apply';
import {
  MOTION_PATHS, emptyGridScene, motionAt, motionTheta, newShape, pathOffsetAt, placeCell, rotate2,
  type GridSceneSpec, type Motion, type MotionPath, type Vec2,
} from '../spec';
import {
  MAX_STROKE, PATH_POINTS, chaikin, cleanStroke, defaultDrawnPath, generatePath, packPath, pathAt, pathConfig, resampleArc, samplePoints, simplify,
  type DrawnPath,
} from '../paths';
import { gridParamTarget } from '../apply';
import { motionDecls, motionLines, motionUniforms } from './motionArgs';

const near = (a: number, b: number, eps = 1e-6) => expect(Math.abs(a - b)).toBeLessThan(eps);
const len = (v: Vec2) => Math.hypot(v[0], v[1]);

function scene(motion: Motion): GridSceneSpec {
  const s = emptyGridScene();
  s.shapes = [newShape('A', { kind: 'circle', size: 0.6, motion })];
  placeCell(s, 4, 5, 'A');
  return s;
}

describe('Angle: the maths', () => {
  it('rotate2 turns counter-clockwise (y up) and keeps the length', () => {
    const r = rotate2([1, 0], Math.PI / 2);
    near(r[0], 0); near(r[1], 1);
    for (const th of [0.3, 1.7, -2.4]) near(len(rotate2([0.75, -0.65], th)), len([0.75, -0.65]));
  });
  it('the turn is Angle + spin × t, in degrees', () => {
    near(motionTheta({ angle: 90 }, 5), Math.PI / 2);
    near(motionTheta({ angle: 10, angleSpin: 20 }, 2), (50 * Math.PI) / 180);
    near(motionTheta({}, 3), 0);
  });
  it('angle 0 moves exactly as before; a turn turns the offset and keeps its length', () => {
    const g = { cols: 10, rows: 10 };
    for (const path of MOTION_PATHS.filter(p => p !== 'travel' && p !== 'hop')) {
      const m: Motion = { path, xy: [0.7, 0.4], speed: 0.6, lag: 0.1 };
      for (const t of [0.2, 1.3]) {
        expect(motionAt(g, { ...m, angle: 0, angleSpin: 0 }, 3, 4, t)).toEqual(motionAt(g, m, 3, 4, t));
        const a = motionAt(g, m, 3, 4, t), b = motionAt(g, { ...m, angle: 40 }, 3, 4, t);
        const oa: Vec2 = [a[0] - 3.5, 3.5 + 1 - a[1]], ob: Vec2 = [b[0] - 3.5, 3.5 + 1 - b[1]];
        near(len(oa), len(ob), 1e-9);
        const want = rotate2(oa, (40 * Math.PI) / 180);
        near(ob[0], want[0], 1e-9); near(ob[1], want[1], 1e-9);
      }
    }
  });
});

describe('Angle and drawn paths: the shader moves as the CPU does', () => {
  /** gs_move… on the CPU shader for a shape at home (4, 5), at time t. */
  function shaderMove(s: GridSceneSpec, t: number, angleRad?: [number, number]): Vec2 {
    const p = gridProgram(s);
    const fn = /vec2 gs_moveA_\w+/.exec(p.functions)![0].replace('vec2 ', '');
    const src = ['uniform float p_t;', 'uniform vec4 mA;', ...motionDecls(s), p.functions, 'void main() {', ...motionLines(s),
      `  gl_FragColor = vec4(${fn}(vec2(4.0, 5.0), 9.0, p_t, mA, xA), 0.0, 0.0);`, '}'].join('\n');
    const m = s.shapes[0].motion;
    const u = { p_t: t, mA: [m.xy[0], m.xy[1], m.speed, m.lag], ...motionUniforms(s), ...(angleRad ? { rA: angleRad } : {}) };
    const g = new CpuShader(src).run([0, 0], { resolution: [8, 8], time: t, uniforms: u })!;
    return [g[0], g[1]];
  }
  const drawnVariants: Array<[string, Partial<DrawnPath>]> = [
    ['closed loop', {}],
    ['open, snap back, eased', { closed: false, ends: 'snap', ease: 0.6, pts: generatePath(7, { closed: false, wiggle: 0.6, points: 9 }) }],
    ['open, ease back', { closed: false, ends: 'ease', back: 0.35, pts: generatePath(8, { closed: false, wiggle: 0.4, points: 7 }) }],
    ['open, ping-pong', { closed: false, ends: 'pingpong', pts: generatePath(9, { closed: false, wiggle: 0.8, points: 12 }) }],
  ];
  const cases: Array<[string, Motion]> = [
    ...MOTION_PATHS.filter(p => p !== 'still' && p !== 'drawn').map(p => [p, { path: p, xy: [0.7, -0.4], speed: 0.45, lag: 0.08, angle: 35, angleSpin: 25 }] as [string, Motion]),
    ...drawnVariants.map(([n, d]) => [`drawn, ${n}`, { path: 'drawn', xy: [0.8, 0.5], speed: 0.4, lag: 0.07, angle: -50, angleSpin: 15, drawn: { ...defaultDrawnPath(), ...d } }] as [string, Motion]),
  ];
  it.each(cases)('%s', (_n, motion) => {
    const s = scene(motion);
    for (const t of [0.3, 1.45, 2.9]) {
      const a = shaderMove(s, t), b = motionAt(s, motion, 4, 5, t);
      near(a[0], b[0], 1e-4); near(a[1], b[1], 1e-4);
    }
  });
  it('the angle is live: the same code turned by the uniform alone', () => {
    const m: Motion = { path: 'both', xy: [0.8, 0], speed: 0.25, lag: 0 };
    const a = shaderMove(scene(m), 1, [Math.PI / 2, 0]);
    const b = motionAt(scene(m), { ...m, angle: 90 }, 4, 5, 1);
    near(a[0], b[0], 1e-5); near(a[1], b[1], 1e-5);
  });
});

describe('the search reach under a turn', () => {
  // Lag big enough that shapes overtake each other: the search is bounded by the path's range (with
  // little lag the inverse is exact and the range does not matter).
  it('a circle reach is the same at any angle; a diagonal "both" reaches √2 further on the cells at 45°', () => {
    const at = (path: MotionPath, xy: Vec2, angle: number) => {
      const s = scene({ path, xy, speed: 0.4, lag: 0.4, angle });
      s.look.glow = false;
      return searchRadiusAt(s, s.shapes[0]);
    };
    for (const a of [0, 30, 45, 90, 137]) expect(at('circle', [2, 2], a)).toBe(at('circle', [2, 2], 0));
    expect(at('both', [2, 0], 45)).toBeLessThanOrEqual(at('both', [2, 0], 0));
    expect(at('both', [2, 2], 45)).toBeGreaterThan(at('both', [2, 2], 0));
  });
  it('the bound holds the turned path: every place on it is within the reach, for every path and angle', () => {
    for (const path of MOTION_PATHS.filter(p => p !== 'still' && p !== 'travel' && p !== 'hop')) {
      for (const angle of [0, 20, 45, 110, -70]) {
        const m: Motion = { path, xy: [1.3, 0.7], speed: 0.4, lag: 0.4, angle, drawn: { ...defaultDrawnPath(), closed: false, pts: generatePath(3, { closed: false, wiggle: 0.7, points: 10 }) } };
        const s = scene(m);
        s.look.glow = false;
        const reach = 0.3; // the circle's (size 0.6)
        const R = searchRadiusAt(s, s.shapes[0]) + 0.5; // the window round the rounded home
        // The middle the search starts from is the home's own place, except for bounce (half its height).
        const mid = path === 'bounce' ? rotate2([0, 0.35], (angle * Math.PI) / 180) : [0, 0];
        for (let i = 0; i <= 200; i++) {
          const o = rotate2(pathOffsetAt(m, i / 200), (angle * Math.PI) / 180);
          expect(Math.max(Math.abs(o[0] - mid[0]), Math.abs(o[1] - mid[1]))).toBeLessThanOrEqual(R - reach + 1e-6);
        }
      }
    }
  });
  it('spinning, the reach is the worst over a turn', () => {
    const s = scene({ path: 'both', xy: [2, 2], speed: 0.4, lag: 0.4, angleSpin: 30 });
    s.look.glow = false;
    const t = scene({ path: 'both', xy: [2, 2], speed: 0.4, lag: 0.4, angle: 45 });
    t.look.glow = false;
    expect(searchRadiusAt(s, s.shapes[0])).toBe(searchRadiusAt(t, t.shapes[0]));
  });
});

describe('nothing live rebuilds the code', () => {
  it('Angle, its spin, and every drawn path setting are numbers on the nodes, not code', () => {
    const base = scene({ path: 'drawn', xy: [0.6, 0.4], speed: 0.4, lag: 0.05, drawn: defaultDrawnPath() });
    const code = gridProgram(base).functions;
    const variants: Array<(m: Motion) => void> = [
      m => { m.angle = 73; },
      m => { m.angleSpin = -40; },
      m => { m.drawn!.pts = generatePath(42, { closed: true, wiggle: 0.9, points: 20 }); },
      m => { m.drawn!.smooth = 0; },
      m => { m.drawn!.ease = 0.8; },
      m => { m.drawn!.closed = false; m.drawn!.ends = 'pingpong'; },
      m => { m.drawn!.closed = false; m.drawn!.ends = 'ease'; m.drawn!.back = 0.6; },
    ];
    for (const v of variants) {
      const s = structuredClone(base);
      v(s.shapes[0].motion);
      expect(gridProgram(s).functions).toBe(code);
      expect(motionExtra(s.shapes[0])).not.toEqual(motionExtra(base.shapes[0]));
    }
    // An angle on a built-in path: the same code too.
    const b = scene({ path: 'circle', xy: [0.6, 0.4], speed: 0.4, lag: 0.05 });
    const c = structuredClone(b); c.shapes[0].motion.angle = 30; c.shapes[0].motion.angleSpin = 12;
    expect(gridProgram(c).functions).toBe(gridProgram(b).functions);
  });

  it('the built Shape node has Angle and its spin as inputs (wireable), the Grid scene node reads them, a drawn path\'s points ride hidden on it', () => {
    const s = scene({ path: 'drawn', xy: [0.6, 0.4], speed: 0.4, lag: 0.05, angle: 25, angleSpin: 10, drawn: defaultDrawnPath() });
    const g = buildStandaloneGrid(s);
    const shapeNode = g.nodes.find(n => n.params[GS_ROLE] === 'A')!;
    expect(shapeNode.params.angle).toBe(25);
    expect(shapeNode.params.angleSpin).toBe(10);
    expect(shapeNode.inputs.angle).toBeDefined();
    expect(shapeNode.inputs.angleSpin).toBeDefined();
    expect(shapeNode.inputs.ease).toBeDefined();
    expect(shapeNode.outputs.dir).toBeDefined();
    const grid = g.nodes.find(n => n.params[GS_ROLE] === 'grid')!;
    const a = shapeArgs('A');
    expect(grid.inputs[a.r].connection).toEqual({ nodeId: shapeNode.id, outputKey: 'dir' });
    expect(grid.inputs[a.d].connection).toEqual({ nodeId: shapeNode.id, outputKey: 'path' });
    // The points: hidden (data on the node, no socket), as many as the head and the pairs.
    expect(grid.inputs.pA0).toBeUndefined();
    expect(grid.params.pA0).toBeDefined();
    expect(Object.keys(grid.params).filter(k => /^pA\d+$/.test(k))).toHaveLength(4 + 2 * PATH_POINTS);
  });
});

describe('the Play menu on the Grid builder\'s sliders', () => {
  it('finds the built node\'s param by role; says why when there is none', () => {
    const s = scene({ path: 'circle', xy: [0.5, 0.5], speed: 0.4, lag: 0, angle: 10 });
    let n = 0;
    const r = applyGridScene([], s, { nextId: () => `n${n++}` });
    const shapeNode = r.nodes.find(x => x.params[GS_ROLE] === 'A')!;
    expect(gridParamTarget(r.nodes, r.sceneId, 'A', 'angle')).toEqual({ nodeId: shapeNode.id, key: 'angle' });
    expect(gridParamTarget(r.nodes, r.sceneId, 'A', 'angleSpin')).toEqual({ nodeId: shapeNode.id, key: 'angleSpin' });
    expect(gridParamTarget(r.nodes, r.sceneId, 'grid', 'amount')).toMatchObject({ key: 'amount' });
    expect(gridParamTarget(r.nodes, null, 'A', 'angle')).toHaveProperty('missing');
    expect(gridParamTarget(r.nodes, r.sceneId, 'B', 'angle')).toHaveProperty('missing');
    expect(gridParamTarget(r.nodes, r.sceneId, 'A', 'ease')).toHaveProperty('missing');
  });
});

describe('drawn paths: sampling, smoothing, end modes, generate', () => {
  it('arc-length resampling spaces the points evenly, however unevenly the stroke was drawn', () => {
    const stroke: Vec2[] = [[-1, 0], [-0.9, 0], [-0.85, 0], [1, 0], [1, 1]];
    const q = resampleArc(stroke, 16, false);
    expect(q[0]).toEqual([-1, 0]);
    near(q[15][0], 1); near(q[15][1], 1);
    const d = q.slice(1).map((p, i) => Math.hypot(p[0] - q[i][0], p[1] - q[i][1]));
    for (const x of d) near(x, d[0], 1e-9);
    // Closed: the step back to the start is the same length too.
    const sq: Vec2[] = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    const c = resampleArc(sq, 8, true);
    const dc = c.map((p, i) => Math.hypot(c[(i + 1) % 8][0] - p[0], c[(i + 1) % 8][1] - p[1]));
    for (const x of dc) near(x, 1, 1e-9);
  });

  it('smoothing rounds corners; auto smooth thins a shaky stroke to its turning points; strokes are capped', () => {
    const sq: Vec2[] = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    const r = chaikin(sq, true, 2);
    expect(r.length).toBe(16);
    // The corners are cut: no point reaches one.
    for (const p of r) expect(Math.abs(p[0]) + Math.abs(p[1])).toBeLessThan(2 - 0.2);
    // A straight line drawn with a shaky hand: 200 points thin to its two ends.
    const shaky: Vec2[] = Array.from({ length: 200 }, (_, i) => [-1 + i / 100, 0.004 * Math.sin(i * 7.1)]);
    expect(simplify(shaky, 0.02)).toHaveLength(2);
    expect(cleanStroke(shaky, true)).toHaveLength(2);
    // Off: kept (capped), and inside −1 … 1.
    const kept = cleanStroke(shaky.map(([x, y]) => [x * 1.5, y] as Vec2), false);
    expect(kept.length).toBeLessThanOrEqual(MAX_STROKE);
    expect(kept.length).toBeGreaterThan(20);
    expect(Math.max(...kept.map(p => Math.abs(p[0])))).toBeLessThanOrEqual(1);
  });

  const line: DrawnPath = { ...defaultDrawnPath(), closed: false, smooth: 0, pts: [[-1, 0], [1, 0]] };
  const at = (p: DrawnPath, u: number) => pathAt(samplePoints(p), pathConfig(p), u);

  it('open, snap back: start to end over the cycle, then back at the start', () => {
    near(at(line, 0)[0], -1); near(at(line, 0.5)[0], 0, 1e-9); near(at(line, 0.999)[0], 0.998, 1e-6); near(at(line, 1)[0], -1);
  });
  it('open, ease back: out over (1 − back), then an eased glide home', () => {
    const p = { ...line, ends: 'ease' as const, back: 0.25 };
    near(at(p, 0.375)[0], 0, 1e-9);
    near(at(p, 0.75)[0], 1, 1e-9);
    near(at(p, 0.875)[0], 0, 1e-9); // half way home, the ease symmetric
    expect(at(p, 0.8)[0]).toBeGreaterThan(0.75); // slow to leave the end (straight would be 0.6)
    near(at(p, 0.99999)[0], -1, 1e-6);
  });
  it('open, ping-pong: out and back along the path', () => {
    const p = { ...line, ends: 'pingpong' as const };
    near(at(p, 0.5)[0], 1); near(at(p, 0.25)[0], 0, 1e-9); near(at(p, 0.75)[0], 0, 1e-9); near(at(p, 0)[0], -1);
  });
  it('ease slows the ends of the progress and keeps the middle', () => {
    const p = { ...line, ease: 1 };
    near(at(p, 0.5)[0], 0, 1e-9);
    expect(at(p, 0.1)[0]).toBeLessThan(at(line, 0.1)[0]);
  });
  it('a closed path loops seamlessly', () => {
    const p = defaultDrawnPath();
    const a = at(p, 0), b = at(p, 0.99999);
    near(a[0], b[0], 1e-3); near(a[1], b[1], 1e-3);
  });

  it('generate: the same seed, the same path; open or closed; inside the pad', () => {
    const o = { closed: true, wiggle: 0.6, points: 12 };
    expect(generatePath(123, o)).toEqual(generatePath(123, o));
    expect(generatePath(124, o)).not.toEqual(generatePath(123, o));
    expect(generatePath(123, o)).toHaveLength(12);
    const open = generatePath(5, { closed: false, wiggle: 0.8, points: 9 });
    expect(open[0][0]).toBeLessThan(open[8][0]);
    for (const p of [...generatePath(123, o), ...open]) { expect(Math.abs(p[0])).toBeLessThanOrEqual(0.95 + 1e-9); expect(Math.abs(p[1])).toBeLessThanOrEqual(0.95 + 1e-9); }
  });

  it('packPath: the bounds hold every point, the rates every step', () => {
    const p: DrawnPath = { ...defaultDrawnPath(), closed: false, pts: generatePath(11, { closed: false, wiggle: 0.7, points: 10 }) };
    const [bx, by, gx, gy, ...pts] = packPath(p);
    expect(pts).toHaveLength(2 * PATH_POINTS);
    for (let i = 0; i < PATH_POINTS; i++) {
      expect(Math.abs(pts[2 * i])).toBeLessThanOrEqual(bx + 1e-9);
      expect(Math.abs(pts[2 * i + 1])).toBeLessThanOrEqual(by + 1e-9);
      if (i) {
        expect(Math.abs(pts[2 * i] - pts[2 * i - 2]) * (PATH_POINTS - 1)).toBeLessThanOrEqual(gx + 1e-4);
        expect(Math.abs(pts[2 * i + 1] - pts[2 * i - 1]) * (PATH_POINTS - 1)).toBeLessThanOrEqual(gy + 1e-4);
      }
    }
  });
});
