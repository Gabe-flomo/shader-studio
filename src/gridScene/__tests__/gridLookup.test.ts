/**
 * The cell lookup (glsl.ts) against the old code (one block per drawn cell, legacyGlsl.ts): the
 * same pictures for every template (within 0.005 of a colour step) and a spread of Surprise scenes, run on the CPU (cpuGlsl.ts) at
 * a grid of points and several times. The scene function's colour and distance are composited as
 * the build does (glow, fill, ACES) and compared within a small tolerance: only far glow differs,
 * from shapes outside the search (more than a cell beyond their reach).
 *
 * Also: the draw modes' maps (repeat, mirror, rotate) match sourceCell, and a fill shape bigger
 * than its cell reaches over the cell's edge.
 */
import { motionDecls, motionLines, motionUniforms } from './motionArgs';
import { describe, expect, it } from 'vitest';
import { CpuShader } from '../../lib/guidedConvert/cpuGlsl';
import { gridProgram as legacyProgram } from './legacyGlsl';
import { GLOW_FADE, gridProgram, searchCapped, shapeArgs } from '../glsl';
import { GRID_TEMPLATES } from '../templates';
import { buildStandaloneGrid, GS_ROLE } from '../build';
import { defaultDrawnPath, generatePath } from '../paths';
import { CURVE_PRESETS, defaultMath, newMod, type ModKind } from '../pathMods';
import { surpriseGridScene } from '../surprise';
import { cellSize, emptyGridScene, newShape, placeCell, shownCells, sourceCell, starterGridScene, type GridSceneSpec } from '../spec';

type Val = number | number[];

/** The uniforms a scene's numbers come in as (what the Shape and Grid nodes hand the function). */
function uniformsOf(spec: GridSceneSpec): Record<string, Val> {
  const u: Record<string, Val> = { pt: [spec.pattern.amount, spec.pattern.freq, spec.pattern.speed, spec.pattern.arms] };
  for (const s of spec.shapes) {
    const a = shapeArgs(s.id);
    u[a.m] = [s.motion.xy[0], s.motion.xy[1], s.motion.speed, s.motion.lag];
    u[a.l] = [s.size, s.turn * Math.PI / 180, s.spin, s.pulse];
    u[a.e] = s.outline;
    u[a.c] = [...s.color];
  }
  return { ...u, ...motionUniforms(spec) };
}

function shapeDecls(spec: GridSceneSpec): string[] {
  return [...spec.shapes.flatMap(s => { const a = shapeArgs(s.id); return [`uniform vec4 ${a.m};`, `uniform vec4 ${a.l};`, `uniform float ${a.e};`, `uniform vec3 ${a.c};`]; }), ...motionDecls(spec)];
}

/**
 * A program that writes the old scene function's vec4(colour, distance) at uniform `p_uv`, time `p_t`.
 * Its pattern fill is the one change asked for: evaluated over the cells round the pixel's (the
 * lookup's fill radius) instead of only the pixel's own cell, which cut big fill shapes at the edge.
 */
function legacySource(spec: GridSceneSpec): string {
  const p = legacyProgram(spec);
  let fns = p.functions;
  if (fns.includes('vec2 id = floor(cp);')) {
    const R = gridProgram(spec).fillRadius;
    fns = fns.replace('vec2 id = floor(cp);', `for (int fj = -${R}; fj <= ${R}; fj++) for (int fi = -${R}; fi <= ${R}; fi++) { vec2 id = floor(cp) + vec2(float(fi), float(fj));`)
      .replace(/\n {2}}\n {2}return vec4\(col/, '\n  }}\n  return vec4(col');
  }
  return ['uniform vec2 p_uv;', 'uniform float p_t;', 'uniform vec4 pt;', ...shapeDecls(spec), fns,
    `void main() { gl_FragColor = ${p.name}(p_uv, p_t, pt${p.args.length ? `, ${p.args.join(', ')}` : ''}); }`].join('\n');
}

function lookupSource(spec: GridSceneSpec, extra: string[] = [], out = 'g', brute = false): string {
  const p = gridProgram(spec, { brute });
  const call = p.args.map(a => (a === 'rp' ? 'rpU' : a === 'rs' ? 'rsU' : a));
  return ['uniform vec2 p_uv;', 'uniform float p_t;', 'uniform vec4 pt;', 'uniform vec4 rpU;', 'uniform float rsU;', ...shapeDecls(spec), ...extra, p.functions,
    'void main() {',
    `  float gd[${p.data.length}];`,
    ...p.data.map((v, i) => `  gd[${i}] = ${v.toFixed(1)};`),
    ...motionLines(spec),
    '  vec4 hp = vec4(0.0);',
    `  vec4 g = ${p.name}(p_uv, p_t, pt, ${call.join(', ')});`,
    `  gl_FragColor = ${out};`,
    '}'].join('\n');
}

/** The glow's fade (glsl.ts GLOW_FADE) applied to a distance in picture units: what the lookup returns, for the old code's output. */
function faded(spec: GridSceneSpec, d: number): number {
  if (!spec.look.glow) return d;
  const cs = cellSize(spec), b = d / cs, [e0, e1] = GLOW_FADE;
  if (b <= e0) return d;
  if (b >= e1) return 1e5 * cs;
  const x = (b - e0) / (e1 - e0), sm = x * x * (3 - 2 * x);
  return (b / Math.max(1 - sm, 1e-5)) * cs;
}

const aces = (x: number) => Math.min(1, Math.max(0, (x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14)));

/** What the build paints from (colour, d): the glow over black, the shape filled, tone-mapped. */
function composite(spec: GridSceneSpec, g: number[]): number[] {
  const [r, gg, b, d] = g;
  const L = spec.look;
  // Soft (the default): amount ÷ (distance outside + amount), 1 at the edge; halo: the Glow Layer's amount ÷ |d|.
  const glow = !L.glow ? 0 : L.glowStyle === 'halo' ? Math.min(50, (L.glowAmount / Math.max(Math.abs(d), 1e-4)) ** L.glowFalloff)
    : (L.glowAmount / (Math.max(d, 0) + Math.max(L.glowAmount, 1e-5))) ** L.glowFalloff;
  const f = 1 - Math.min(1, Math.max(0, (d + 0.003) / 0.006));
  return [r, gg, b].map(c => aces(c * glow * (1 - f) + c * f));
}

function compare(spec: GridSceneSpec, times = [0, 0.37, 1.9], n = 14): number {
  const A = new CpuShader(legacySource(spec)), B = new CpuShader(lookupSource(spec));
  const base = uniformsOf(spec);
  let worst = 0;
  const half = spec.span * 1.05;
  for (const t of times) {
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const uv = [-half + (2 * half * (i + 0.5)) / n, -half + (2 * half * (j + 0.5)) / n];
        const inputs = { resolution: [800, 800] as [number, number], time: t, uniforms: { ...base, p_uv: uv, p_t: t } };
        const a = A.run([0, 0], inputs)!, b = B.run([0, 0], inputs)!;
        // The old code's glow reached every cell; the lookup's fades out within a cell (no patches): compare like with like.
        a[3] = faded(spec, a[3]);
        // Inside or at the edge of a shape the two agree exactly (same colour, same distance).
        if (a[3] < cellSize(spec) * 0.25) {
          for (let k = 0; k < 4; k++) worst = Math.max(worst, Math.abs(a[k] - b[k]));
        }
        const ca = composite(spec, a), cb = composite(spec, b);
        for (let k = 0; k < 3; k++) worst = Math.max(worst, Math.abs(ca[k] - cb[k]));
      }
    }
  }
  return worst;
}

describe('Grid scene: the cell lookup draws what the per-cell code drew', () => {
  // The templates the old code could draw (no draw mode, no pictures: those are new).
  const OLD = GRID_TEMPLATES.filter(t => { const s = t.make(); return !s.draw && !s.textures?.length; });
  it('covers the templates', () => expect(OLD.length).toBeGreaterThanOrEqual(7));
  it.each(OLD.map(t => [t.key] as const))('template %s', key => {
    const spec = GRID_TEMPLATES.find(t => t.key === key)!.make();
    expect(compare(spec)).toBeLessThan(0.005);
  });

  it.each([1, 2, 3, 4, 5, 6, 7, 8].map(s => [s] as const))('surprise scene %s', seed => {
    expect(compare(surpriseGridScene(seed), [0.2, 1.3], 10)).toBeLessThan(0.03);
  }, 30_000);

  it('a shape with lag (a wave of motion) and a figure eight with a big reach', () => {
    const s = starterGridScene();
    s.shapes[0].motion = { path: 'eight', xy: [1.2, 0.8], speed: 0.4, lag: 0.15 };
    expect(compare(s, [0.3, 1.1], 12)).toBeLessThan(0.03);
  });

  it('travel and hop with lag, round the wrap', () => {
    for (const path of ['travel', 'hop'] as const) {
      const s = starterGridScene();
      s.shapes[0].motion = { path, xy: [1, -1], speed: 0.6, lag: 0.1 };
      expect(compare(s, [0.4, 2.7], 12)).toBeLessThan(0.03);
    }
  });
});

describe('Grid scene: a fill shape bigger than its cell', () => {
  it('reaches over its cell\'s edge (the old code cut it at the edge)', () => {
    const s = emptyGridScene();
    s.cols = 6; s.rows = 6;
    s.shapes = [newShape('A', { kind: 'circle', size: 1.6 })];
    s.pattern = { kind: 'checker', target: 'turn', amount: 0, freq: 4, speed: 0, arms: 3, fill: 'A' };
    s.look.glow = false;
    placeCell(s, 0, 0, 'A');
    const B = new CpuShader(lookupSource(s));
    const cs = cellSize(s);
    // Cell (2, 2)'s circle has radius 0.8 cells: 0.6 of a cell past its centre is still inside it,
    // and past the cell's edge (0.5). (Cells (3, 2) and others also cover it, so check against cell (2, 2)'s distance.)
    const cx = (2 + 0.5 - 3) * cs, cy = (3 - (2 + 0.5)) * cs;
    const at = [cx + 0.6 * cs, cy];
    const g = B.run([0, 0], { resolution: [800, 800], time: 0, uniforms: { ...uniformsOf(s), p_uv: at, p_t: 0 } })!;
    expect(g[3]).toBeLessThan(-0.15 * cs);
    expect(gridProgram(s).fillRadius).toBeGreaterThanOrEqual(1);
  });
});

describe('Grid scene: draw modes', () => {
  /** What each cell shows in the shader (gs_cell through the program): a reader, parsed once. */
  function shaderShows(spec: GridSceneSpec): (x: number, y: number) => number {
    const p = gridProgram(spec);
    const fn = /float gs_cell_\w+/.exec(p.functions)![0].replace('float ', '');
    const src = ['uniform vec4 rpU;', 'uniform float rsU;', 'uniform vec2 cellU;', p.functions.replace(/vec4 gs_scene[\s\S]*$/, ''),
      'void main() {', `  float gd[${p.data.length}];`, ...p.data.map((v, i) => `  gd[${i}] = ${v.toFixed(1)};`),
      `  gl_FragColor = vec4(${fn}(gd, cellU${p.repeat ? ', rpU, rsU' : ''}));`, '}'].join('\n');
    const d = spec.draw!;
    const cpu = new CpuShader(src);
    return (x, y) => cpu.run([0, 0], { resolution: [8, 8], time: 0, uniforms: { cellU: [x, y], rpU: [d.period[0], d.period[1], d.offset[0], d.offset[1]], rsU: d.shift } })![0];
  }

  const scene = (mode: NonNullable<GridSceneSpec['draw']>['mode'], extra: Partial<NonNullable<GridSceneSpec['draw']>> = {}) => {
    const s = emptyGridScene();
    s.cols = 8; s.rows = 6;
    s.shapes = [newShape('A'), newShape('B')];
    s.draw = { mode, period: [3, 2], offset: [1, 0], shift: 0, ...extra };
    placeCell(s, 1, 0, 'A');
    placeCell(s, 2, 1, 'B');
    placeCell(s, 0, 2, 'B');
    return s;
  };

  it.each([['repeat'], ['mirrorX'], ['mirrorY'], ['mirrorXY'], ['rotate4']] as const)('%s: the shader shows what sourceCell says, cell by cell', mode => {
    const s = mode === 'rotate4' ? { ...scene(mode), cols: 6, rows: 6 } : scene(mode);
    const shown = shownCells(s);
    const shows = shaderShows(s);
    for (let y = 0; y < s.rows; y++) {
      for (let x = 0; x < s.cols; x++) {
        const id = shown[y * s.cols + x];
        expect(shows(x, y), `cell ${x}, ${y}`).toBe(id ? s.shapes.findIndex(q => q.id === id) + 1 : 0);
      }
    }
  });

  it('repeat: one drawn cell is copied every period, the rows shifted for bricks', () => {
    const s = scene('repeat', { period: [3, 2], offset: [1, 0], shift: 1 });
    s.cells = [{ x: 1, y: 0, s: 'A' }];
    const shown = shownCells(s);
    const copies = shown.flatMap((id, i) => (id ? [[i % s.cols, Math.floor(i / s.cols)]] : []));
    expect(copies).toEqual([[1, 0], [4, 0], [7, 0], [2, 2], [5, 2], [0, 4], [3, 4], [6, 4]]);
    expect(sourceCell(s, 4, 0)).toEqual([1, 0]);
  });

  it('mirror and rotate reflect and turn the drawing', () => {
    expect(sourceCell(scene('mirrorX'), 6, 0)).toEqual([1, 0]);
    expect(sourceCell(scene('mirrorY'), 2, 4)).toEqual([2, 1]);
    const r = { ...scene('rotate4'), cols: 6, rows: 6 };
    // The top-left quarter, turned three times round the middle (2.5, 2.5).
    expect(sourceCell(r, 1, 0)).toEqual([1, 0]);
    expect(sourceCell(r, 5, 1)).toEqual([1, 0]);
    expect(sourceCell(r, 4, 5)).toEqual([1, 0]);
    expect(sourceCell(r, 0, 4)).toEqual([1, 0]);
  });
});

// ── The search against brute force, live radii, copies that match ──────────────

/** The search against every cell of the grid (gridProgram's brute option), as `compare` does against the old code. */
function compareBrute(spec: GridSceneSpec, times = [0.3, 1.7], n = 12): number {
  const A = new CpuShader(lookupSource(spec, [], 'g', true)), B = new CpuShader(lookupSource(spec));
  const base = uniformsOf(spec);
  const D = spec.draw;
  const rp: Record<string, number | number[]> = D ? { rpU: [D.period[0], D.period[1], D.offset[0], D.offset[1]], rsU: D.shift } : {};
  let worst = 0;
  const half = spec.span * 1.05;
  for (const t of times) {
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const uv = [-half + (2 * half * (i + 0.5)) / n, -half + (2 * half * (j + 0.5)) / n];
        const inputs = { resolution: [800, 800] as [number, number], time: t, uniforms: { ...base, ...rp, p_uv: uv, p_t: t } };
        const a = A.run([0, 0], inputs)!, b = B.run([0, 0], inputs)!;
        if (a[3] < cellSize(spec) * 0.25) for (let k = 0; k < 4; k++) worst = Math.max(worst, Math.abs(a[k] - b[k]));
        const ca = composite(spec, a), cb = composite(spec, b);
        for (let k = 0; k < 3; k++) worst = Math.max(worst, Math.abs(ca[k] - cb[k]));
      }
    }
  }
  return worst;
}

/** A grid drawn full with one moving shape. */
function full(cols: number, path: GridSceneSpec['shapes'][number]['motion']['path'], xy: [number, number], lag: number, size = 0.5): GridSceneSpec {
  const s = emptyGridScene();
  s.cols = cols; s.rows = cols;
  s.shapes = [newShape('A', { kind: 'circle', size, motion: { path, xy, speed: 0.4, lag } })];
  for (let y = 0; y < cols; y++) for (let x = 0; x < cols; x++) s.cells.push({ x, y, s: 'A' });
  return s;
}

describe('Grid scene: big motion with lag, against brute force', () => {
  it.each([
    ['circle', [1.5, 1.5], 0.03],
    ['updown', [0, 3], 0.02],
    ['eight', [2, 1], 0.15],
    ['both', [2.5, 2.5], 0.2],
    ['bounce', [0, 2.5], 0.05],
  ] as const)('%s, reach %j, lag %s: the refined search finds what looking everywhere finds', (path, xy, lag) => {
    const s = full(8, path, [...xy] as [number, number], lag);
    expect(compareBrute(s)).toBeLessThan(0.03);
  });

  it('the fixed-point inverse keeps the search small where the path\'s range alone would need a wide one', () => {
    // Circle 3 cells round, lag 0.02: L = 2 · 0.02 · 2π · 3 ≈ 0.75, the iteration converges.
    const slow = full(24, 'circle', [3, 3], 0.02);
    slow.look.glow = false;
    expect(gridProgram(slow).radius.A).toBeLessThanOrEqual(2);
    // At lag 0.03 (L ≈ 1.13) shapes overtake each other: the range bounds the search (3 + reach).
    const fast = full(24, 'circle', [3, 3], 0.03);
    fast.look.glow = false;
    expect(gridProgram(fast).radius.A).toBeGreaterThan(2);
  });

  it('says when a setting would be cut by the cap', () => {
    const s = full(24, 'both', [6, 6], 0.3);
    expect(searchCapped(s, s.shapes[0])).toBe(true);
    const ok = full(24, 'circle', [1, 1], 0.05);
    expect(searchCapped(ok, ok.shapes[0])).toBe(false);
  });
});

describe('Grid scene: travel and hop round the wrap, against brute force (the seam bug)', () => {
  // Big reach with lag, late enough that every cell has wrapped many times. The old home estimate
  // rounded h0 / dims, which forgot that the lag couples a wrap in x to y: shapes went missing in
  // bands, cut by a straight seam.
  it.each([
    ['travel', [-0.75, 0.65], 0.4, 31],
    ['travel', [-2, 1.5], 0.2, 5.3],
    ['travel', [3, -2.2], 0.2, 31],
    ['hop', [-3, 3], 0.4, 5.3],
    ['hop', [3, -2.2], 0.2, 31],
  ] as const)('%s, reach %j, lag %s at t = %s', (path, xy, lag, t) => {
    const s = full(10, path, [...xy] as [number, number], lag, 0.6);
    expect(compareBrute(s, [t], 16)).toBeLessThan(0.03);
  }, 30_000);

  it('a sparse drawing near the seam, and the draw modes moving with travel', () => {
    const s = starterGridScene();
    s.shapes[0].motion = { path: 'travel', xy: [-3, 3], speed: 0.4, lag: 0.2 };
    expect(compareBrute(s, [0.7, 31], 14)).toBeLessThan(0.03);
    for (const mode of ['repeat', 'mirrorX'] as const) {
      const r = starterGridScene();
      r.shapes[0].motion = { path: 'travel', xy: [2, -1.5], speed: 0.4, lag: 0.15 };
      r.draw = { mode, period: [3, 3], offset: [0, 0], shift: 0 };
      expect(compareBrute(r, [5.3], 14)).toBeLessThan(0.03);
    }
  }, 30_000);
});

describe('Grid scene: Angle and drawn paths, against brute force', () => {
  // The search's reach and inverse under a turn (and a turn that spins), and along drawn paths with
  // each end mode: the refined search finds what looking at every cell finds.
  it.each([
    ['both', [2, 1.2], 0.03, 45, 0],
    ['eight', [1.4, 0.8], 0.12, 120, 0],
    ['bounce', [0, 2], 0.05, -60, 0],
    ['updown', [0, 2.5], 0.3, 30, 25],
    ['circle', [1.6, 0.6], 0.02, 0, 40],
    ['travel', [-2, 1.5], 0.2, 70, 15],
  ] as const)('%s, reach %j, lag %s, angle %s°, spinning %s°/s', (path, xy, lag, angle, spin) => {
    const s = full(10, path, [...xy] as [number, number], lag, 0.6);
    s.shapes[0].motion.angle = angle;
    s.shapes[0].motion.angleSpin = spin;
    expect(compareBrute(s, [0.6, 5.3], 14)).toBeLessThan(0.03);
  }, 30_000);

  it.each([
    ['closed', { closed: true }],
    ['open, snap back', { closed: false, ends: 'snap' }],
    ['open, ease back', { closed: false, ends: 'ease', back: 0.3 }],
    ['open, ping-pong', { closed: false, ends: 'pingpong', ease: 0.5 }],
  ] as const)('drawn path, %s, with lag and an angle', (_n, d) => {
    const s = full(10, 'drawn', [1.5, 1], 0.1, 0.6);
    s.shapes[0].motion.angle = 35;
    s.shapes[0].motion.drawn = { ...defaultDrawnPath(), ...d, pts: generatePath(17, { closed: d.closed, wiggle: 0.7, points: 9 }) };
    expect(compareBrute(s, [0.6, 5.3], 14)).toBeLessThan(0.03);
  }, 30_000);
});

describe('Grid scene: math paths and path modifiers, against brute force', () => {
  // The general bound (a reach and a rate from the live numbers) keeps the search finding every
  // shape, with lag (the fixed-point inverse, or the reach when the path can jump).
  const mods = (...ks: Array<[ModKind, number[]?]>) => ks.map(([k, v], i) => ({ ...newMod(k, []), id: `m${i + 1}`, ...(v ? { v } : {}) }));
  it.each([
    ['formula rose', { path: 'math', xy: [1.2, 1.2], math: { ...defaultMath(), kind: 'formula', x: 'cos(k * TAU * t) * cos(TAU * t)', y: 'cos(k * TAU * t) * sin(TAU * t)', params: [{ name: 'k', value: 3, min: 1, max: 9 }] } }],
    ['curve star', { path: 'math', xy: [1.4, 1.4], math: { ...defaultMath(), kind: 'curve', curve: { ...CURVE_PRESETS.find(c => c.key === 'star')!.curve } } }],
    ['circle + twist + noise', { path: 'circle', xy: [1, 0.6], mods: mods(['twist', [0.5, 2, 1]], ['noise', [0.4, 5, 0.3, 3]]) }],
    ['both + wave + scale', { path: 'both', xy: [1.2, 0.4], mods: mods(['wave', [0.3, 4, 0.5]], ['scale', [1.5, -1]]) }],
    ['eight + repeat + ease + rotate', { path: 'eight', xy: [1, 0.7], mods: mods(['repeat', [2]], ['ease', [1]], ['rotate', [30, 60]]) }],
  ] as const)('%s with lag', (_n, m) => {
    const s = full(10, m.path, [...m.xy] as [number, number], 0.12, 0.6);
    Object.assign(s.shapes[0].motion, structuredClone(m));
    expect(compareBrute(s, [0.6, 5.3], 14)).toBeLessThan(0.03);
  }, 30_000);
});

describe('Grid scene: the glow is continuous (no cell-shaped patches)', () => {
  /** The composited picture along a row of points, `step` cells apart, from cell x0 to x1 at row y (cells). */
  function row(spec: GridSceneSpec, y: number, x0: number, x1: number, step: number, t = 0.4): number[][] {
    const cpu = new CpuShader(lookupSource(spec));
    const cs = cellSize(spec);
    const out: number[][] = [];
    for (let x = x0; x <= x1 + 1e-9; x += step) {
      const uv = [(x - spec.cols / 2) * cs, (spec.rows / 2 - y) * cs];
      const g = cpu.run([0, 0], { resolution: [800, 800], time: t, uniforms: { ...uniformsOf(spec), p_uv: uv, p_t: t } })!;
      out.push(composite(spec, g));
    }
    return out;
  }
  const worstJump = (px: number[][]) => px.slice(1).reduce((w, p, i) => Math.max(w, ...p.map((v, k) => Math.abs(v - px[i][k]))), 0);

  it.each([
    ['still', 'still', [0, 0]],
    ['up and down', 'updown', [0, 0.25]],
    ['travel with lag', 'travel', [-0.75, 0.65]],
  ] as const)('%s: across cell borders far from the shapes the glow changes smoothly', (_n, path, xy) => {
    const s = emptyGridScene();
    s.shapes = [newShape('A', { kind: 'circle', size: 0.6, motion: { path, xy: [...xy] as [number, number], speed: 0.4, lag: 0.08 } })];
    for (const [x, y] of [[2, 2], [7, 3], [4, 7], [8, 8], [1, 6]]) placeCell(s, x, y, 'A');
    // Rows between the shapes, crossing every column border, sampled 0.005 of a cell apart (both glow styles).
    for (const y of [0.3, 4.5, 5.2, 9.7]) {
      s.look.glowStyle = y > 5 ? 'halo' : undefined;
      const j = worstJump(row(s, y, 0.05, 9.95, 0.005));
      expect(j, `row ${y}`).toBeLessThan(4e-4);
    }
  }, 30_000);
});

describe('Grid scene: the default glow and the shape read as one shape', () => {
  it('soft glow is the shape\'s own colour at its edge, so the fill meets it without a rim; halo keeps the bright rim', () => {
    const s = starterGridScene();
    const g = buildStandaloneGrid(s);
    const glow = g.nodes.find(n => n.params[GS_ROLE] === 'glow')!;
    expect(glow.type).toBe('exprNode');
    expect(String(glow.params.result)).toContain('max(d, 0.0)');
    const L = s.look;
    const soft = (d: number) => (L.glowAmount / (Math.max(d, 0) + L.glowAmount)) ** L.glowFalloff;
    expect(soft(0)).toBe(1);
    expect(soft(-0.1)).toBe(1);
    // Far from the edge it is the old halo's strength (amount ÷ d)^falloff, within a few percent.
    const d = 0.05, halo = (L.glowAmount / d) ** L.glowFalloff;
    expect(soft(d) / halo).toBeGreaterThan(0.85);
    s.look.glowStyle = 'halo';
    expect(buildStandaloneGrid(s).nodes.find(n => n.params[GS_ROLE] === 'glow')!.type).toBe('glowLayer');
  });
});

describe('Grid scene: the search follows the live sliders', () => {
  it('a shape dragged far past its built size is not cut (the radius is worked out from the slider)', () => {
    const s = emptyGridScene();
    s.look.glow = false;
    s.shapes = [newShape('A', { kind: 'circle', size: 0.5 })];
    placeCell(s, 5, 5, 'A');
    const cpu = new CpuShader(lookupSource(s));
    const u = uniformsOf(s);
    const cs = cellSize(s);
    // 2 cells right of cell (5, 5)'s centre; built at size 0.5 the search is a cell either side.
    const uv = [(5.5 + 2 - 5) * cs, (5 - 5.5) * cs];
    const at = (size: number) => cpu.run([0, 0], { resolution: [800, 800], time: 0, uniforms: { ...u, lA: [size, 0, 0, 0], p_uv: uv, p_t: 0 } })![3];
    expect(gridProgram(s).radius.A).toBeLessThan(2);
    expect(at(0.5)).toBeGreaterThan(0);
    expect(at(4.4)).toBeLessThan(0);
  });

  it('the fill too', () => {
    const s = emptyGridScene();
    s.look.glow = false;
    s.cols = 6; s.rows = 6;
    s.shapes = [newShape('A', { kind: 'circle', size: 0.4 }), newShape('B', { kind: 'circle', size: 0.01 })];
    s.pattern = { kind: 'checker', target: 'turn', amount: 0, freq: 4, speed: 0, arms: 3, fill: 'A' };
    // Only cell (2, 2) is empty, so only it holds a fill shape; the point is 1.8 cells right of it.
    for (let y = 0; y < 6; y++) for (let x = 0; x < 6; x++) if (!(x === 2 && y === 2)) s.cells.push({ x, y, s: 'B' });
    const cpu = new CpuShader(lookupSource(s));
    const cs = cellSize(s);
    const uv = [(2.5 + 1.8 - 3) * cs, (3 - 2.5) * cs];
    const at = (size: number) => cpu.run([0, 0], { resolution: [800, 800], time: 0, uniforms: { ...uniformsOf(s), lA: [size, 0, 0, 0], p_uv: uv, p_t: 0 } })![3];
    expect(at(0.4)).toBeGreaterThan(0);
    expect(at(4)).toBeLessThan(0);
  });
});

describe('Grid scene: copies match the drawn cell', () => {
  const tiled = (copies: 'shown' | 'source') => {
    const s = emptyGridScene();
    s.cols = 8; s.rows = 8;
    s.look.glow = false;
    s.shapes = [newShape('A', { kind: 'circle', size: 0.5, motion: { path: 'circle', xy: [0.3, 0.3], speed: 0.4, lag: 0.12 } })];
    s.draw = { mode: 'repeat', period: [2, 2], offset: [0, 0], shift: 0, copies };
    s.cells = [{ x: 0, y: 0, s: 'A' }];
    return s;
  };
  /** (home.x, home.y, distance) at a point `d` from cell (x, y)'s centre, at time t. */
  const probe = (s: GridSceneSpec, x: number, y: number, d: [number, number], t: number) => {
    const cpu = new CpuShader(lookupSource(s, [], 'vec4(hp.xy, g.w, 0.0)'));
    const cs = cellSize(s);
    const uv = [(x + 0.5 + d[0] - s.cols / 2) * cs, (s.rows / 2 - (y + 0.5 + d[1])) * cs];
    const D = s.draw!;
    return cpu.run([0, 0], { resolution: [800, 800], time: t, uniforms: { ...uniformsOf(s), rpU: [D.period[0], D.period[1], D.offset[0], D.offset[1]], rsU: D.shift, p_uv: uv, p_t: t } })!;
  };

  it('every copy moves as the drawn cell does; by default the lag ripples across them', () => {
    const d: [number, number] = [0.2, -0.1];
    const t = 0.9;
    const a = probe(tiled('source'), 0, 0, d, t), b = probe(tiled('source'), 4, 6, d, t);
    expect(b[2]).toBeCloseTo(a[2], 6);
    const c = probe(tiled('shown'), 0, 0, d, t), e = probe(tiled('shown'), 4, 6, d, t);
    expect(Math.abs(e[2] - c[2])).toBeGreaterThan(1e-3);
  });

  it('and carries the drawn cell\'s piece of a picture (its home is the drawn cell)', () => {
    const cs = cellSize(tiled('source'));
    const g = probe(tiled('source'), 4, 6, [0, 0], 0);
    expect(g[0]).toBeCloseTo((0.5 - 4) * cs, 5);
    expect(g[1]).toBeCloseTo((4 - 0.5) * cs, 5);
    const shown = probe(tiled('shown'), 4, 6, [0, 0], 0);
    expect(shown[0]).toBeCloseTo((4.5 - 4) * cs, 5);
  });

  it('matches brute force with the copies matching', () => {
    expect(compareBrute(tiled('source'))).toBeLessThan(0.03);
  });
});
