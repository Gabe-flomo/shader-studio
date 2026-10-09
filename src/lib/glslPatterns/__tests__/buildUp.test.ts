/**
 * The build-up rows (buildUp.ts): inputs, then steps in GLSL's order, then the result; which
 * rows vary across the screen; what each draws, and when pictures fall back to strips.
 */
import { describe, expect, it } from 'vitest';
import { buildUpRows, cpuStrip, cpuValue, explainLine, isFlat, pictureBudget, pictureKind, spanOf, workedVars, type BuildUpRow, type LineExplanation, type TypeEnv } from '..';

const line = (text: string, types: TypeEnv = {}): LineExplanation => {
  const r = explainLine(text, { types });
  if (!r.ok) throw new Error(r.error);
  return r;
};
const brief = (rows: BuildUpRow[]) => rows.map(r => [r.key, r.code, r.expr, r.type, r.varies]);

describe('rows', () => {
  it('inputs, then each step inside-out, then the result', () => {
    const ex = line('float v = sin(uv.x * 3.0) * r', { uv: 'vec2', r: 'float' });
    const rows = buildUpRows(ex);
    expect(rows.map(r => r.kind)).toEqual(['input', 'input', 'step', 'step', 'step', 'result']);
    expect(brief(rows)).toEqual([
      ['in:uv', 'uv', 'uv', 'vec2', true],
      ['in:r', 'r', 'r', 'float', false],
      ['step:A', 'uv.x * 3.0', 'uv.x * 3.0', 'float', true],
      ['step:B', 'sin(A)', 'sin(uv.x * 3.0)', 'float', true],
      ['step:C', 'B * r', 'sin(uv.x * 3.0) * r', 'float', true],
      ['result', 'C', 'sin(uv.x * 3.0) * r', 'float', true],
    ]);
    // The result is the line's target; spans point into the line
    expect(rows[5].label).toBe('v');
    expect(ex.source.slice(rows[3].start, rows[3].end)).toBe('sin(uv.x * 3.0)');
  });

  it('a known idiom is one step (a circle’s distance: length(A) - r)', () => {
    const rows = buildUpRows(line('float d = length(uv - 0.5) - r', { uv: 'vec2', r: 'float' }));
    expect(brief(rows).slice(2)).toEqual([
      ['step:A', 'uv - 0.5', 'uv - 0.5', 'vec2', true],
      ['step:B', 'length(A) - r', 'length(uv - 0.5) - r', 'float', true],
      ['result', 'B', 'length(uv - 0.5) - r', 'float', true],
    ]);
  });

  it('a compound line computes its target from its parts', () => {
    const rows = buildUpRows(line('p *= 2.0', { p: 'vec2' }));
    const res = rows[rows.length - 1];
    expect(res.expr).toBe('(p) * (2.0)');
    expect(res.label).toBe('p');
  });

  it('Return is the result; a plain name has no steps', () => {
    const rows = buildUpRows(line('return col', { col: 'vec3' }));
    expect(brief(rows)).toEqual([['in:col', 'col', 'col', 'vec3', false], ['result', 'col', 'col', 'vec3', false]]);
    expect(rows[1].label).toBe('result');
  });

  it('a step varies only when it reads something that varies (the host decides the names)', () => {
    const ex = line('vec3 c = vec3(0.2, 0.4, 0.8) * sin(t) + w', { t: 'float', w: 'float' });
    const rows = buildUpRows(ex, n => n === 'w');
    const byCode = Object.fromEntries(rows.map(r => [r.code, r.varies]));
    expect(byCode['sin(t)']).toBe(false);
    expect(rows.find(r => r.key === 'in:t')!.varies).toBe(false);
    expect(rows.find(r => r.key === 'result')!.varies).toBe(true);
  });

  it('by default screen coordinates and space vary; the clock and numbers do not', () => {
    const rows = buildUpRows(line('float v = sin(gl_FragCoord.x * 0.1 + u_time)'));
    expect(rows.find(r => r.key === 'in:gl_FragCoord')!.varies).toBe(true);
    expect(rows.find(r => r.key === 'in:u_time')!.varies).toBe(false);
  });
});

describe('pictures', () => {
  const ex = line('float d = length(uv - 0.5) - r', { uv: 'vec2', r: 'float' });
  const rows = buildUpRows(ex);
  const step = rows.find(r => r.key === 'step:B')!;
  const radius = rows.find(r => r.key === 'in:r')!;

  it('the same everywhere: a constant; varying: a render when affordable', () => {
    const ok = pictureBudget({ nodes: 3, heavyTypes: [], textures: 0 });
    expect(ok.render).toBe(true);
    expect(pictureKind(radius, ok, true, true)).toBe('constant');
    expect(pictureKind(step, ok, true, true)).toBe('render');
  });

  it('falls back to a CPU strip when a render per row would cost too much, else one rendered row', () => {
    for (const cost of [
      { nodes: 3, heavyTypes: ['marchLoopGroup'], textures: 0 },
      { nodes: 3, heavyTypes: [], textures: 1 },
      { nodes: 400, heavyTypes: [], textures: 0 },
      { nodes: 3, heavyTypes: [], textures: 0, lastMs: 500 },
    ]) {
      const b = pictureBudget(cost);
      expect(b.render).toBe(false);
      expect(b.why).toBeTruthy();
      expect(pictureKind(step, b, true, true)).toBe('strip-cpu');
      expect(pictureKind(step, b, false, true)).toBe('strip-render');
    }
    // Nowhere to render (the GLSL page): CPU only
    expect(pictureBudget(null).render).toBe(false);
    expect(pictureKind(step, pictureBudget(null), true, false)).toBe('strip-cpu');
    expect(pictureKind(step, pictureBudget(null), false, false)).toBe('none');
  });

  it('a CPU strip runs the varying names along the screen and keeps the rest', () => {
    const vars = workedVars(ex);
    const strip = cpuStrip(step, vars, n => n === 'uv', 9)!;
    expect(strip).toHaveLength(9);
    // length(uv - 0.5) with uv.x from −1 to 1, uv.y at the middle (0): smallest near x = 0.5
    const vals = strip as number[];
    const min = Math.min(...vals);
    expect(vals.indexOf(min)).toBeGreaterThan(4);
    expect(vals[0]).toBeGreaterThan(vals[6]);
    // The constant r doesn't move along it
    expect(isFlat(spanOf(cpuStrip(radius, vars, n => n === 'uv', 9) as number[]))).toBe(true);
    expect(cpuValue(radius, vars)).toBe(0.1);
  });

  it('flatness and spans', () => {
    expect(isFlat([0.5, 0.5])).toBe(true);
    expect(isFlat([0, 0.01])).toBe(false);
    expect(spanOf(new Float32Array([1, 9, 9, 9, -2, 9, 9, 9]), 4, 1)).toEqual([-2, 1]);
    expect(spanOf([])).toBeNull();
  });
});
