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
import { describe, expect, it } from 'vitest';
import { CpuShader } from '../../lib/guidedConvert/cpuGlsl';
import { gridProgram as legacyProgram } from './legacyGlsl';
import { gridProgram, shapeArgs } from '../glsl';
import { GRID_TEMPLATES } from '../templates';
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
  return u;
}

function shapeDecls(spec: GridSceneSpec): string[] {
  return spec.shapes.flatMap(s => { const a = shapeArgs(s.id); return [`uniform vec4 ${a.m};`, `uniform vec4 ${a.l};`, `uniform float ${a.e};`, `uniform vec3 ${a.c};`]; });
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

function lookupSource(spec: GridSceneSpec, extra: string[] = [], out = 'g'): string {
  const p = gridProgram(spec);
  const call = p.args.map(a => (a === 'rp' ? 'rpU' : a === 'rs' ? 'rsU' : a));
  return ['uniform vec2 p_uv;', 'uniform float p_t;', 'uniform vec4 pt;', 'uniform vec4 rpU;', 'uniform float rsU;', ...shapeDecls(spec), ...extra, p.functions,
    'void main() {',
    `  float gd[${p.data.length}];`,
    ...p.data.map((v, i) => `  gd[${i}] = ${v.toFixed(1)};`),
    '  vec4 hp = vec4(0.0);',
    `  vec4 g = ${p.name}(p_uv, p_t, pt, ${call.join(', ')});`,
    `  gl_FragColor = ${out};`,
    '}'].join('\n');
}

const aces = (x: number) => Math.min(1, Math.max(0, (x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14)));

/** What the build paints from (colour, d): the glow over black, the shape filled, tone-mapped. */
function composite(spec: GridSceneSpec, g: number[]): number[] {
  const [r, gg, b, d] = g;
  const glow = spec.look.glow ? Math.min(50, (spec.look.glowAmount / Math.max(Math.abs(d), 1e-4)) ** spec.look.glowFalloff) : 0;
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
  });

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
  /** What cell (x, y) shows in the shader (gs_cell through the program). */
  function shaderShows(spec: GridSceneSpec, x: number, y: number): number {
    const p = gridProgram(spec);
    const fn = /float gs_cell_\w+/.exec(p.functions)![0].replace('float ', '');
    const src = ['uniform vec4 rpU;', 'uniform float rsU;', p.functions.replace(/vec4 gs_scene[\s\S]*$/, ''),
      'void main() {', `  float gd[${p.data.length}];`, ...p.data.map((v, i) => `  gd[${i}] = ${v.toFixed(1)};`),
      `  gl_FragColor = vec4(${fn}(gd, vec2(${x.toFixed(1)}, ${y.toFixed(1)})${p.repeat ? ', rpU, rsU' : ''}));`, '}'].join('\n');
    const d = spec.draw!;
    return new CpuShader(src).run([0, 0], { resolution: [8, 8], time: 0, uniforms: { rpU: [d.period[0], d.period[1], d.offset[0], d.offset[1]], rsU: d.shift } })![0];
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
    for (let y = 0; y < s.rows; y++) {
      for (let x = 0; x < s.cols; x++) {
        const id = shown[y * s.cols + x];
        expect(shaderShows(s, x, y), `cell ${x}, ${y}`).toBe(id ? s.shapes.findIndex(q => q.id === id) + 1 : 0);
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
