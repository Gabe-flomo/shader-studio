import { describe, expect, it, vi } from 'vitest';
vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});
import { compileGraph } from '../../compiler/graphCompiler';
import { ROLE_KEY, buildStandalone2D } from '../build';
import { emptyScene, type Scene2D } from '../spec';
import { GRID_ASSIGNS, GRID_PIC_MODES, GRID_SHAPES, GRID_TARGETS, defaultGrid, gridProgram, type GridSpec } from '../grid';
import { CpuShader } from '../../lib/guidedConvert/cpuGlsl';
import { parseRecipe2D, printRecipe2D } from '../recipe';

const sceneWith = (g: Partial<GridSpec>): Scene2D => ({ ...emptyScene(), grid: { ...defaultGrid(), ...g } });
const compiles = (s: Scene2D) => {
  const { nodes } = buildStandalone2D(s);
  const r = compileGraph({ nodes });
  return { ok: r.success, errors: r.errors, fs: r.fragmentShader };
};

describe('the 2D Scene Builder grid', () => {
  it.each(GRID_SHAPES)('%s cells compile', shape => {
    expect(compiles(sceneWith({ shapes: [shape] })).ok).toBe(true);
  });

  it.each(GRID_ASSIGNS)('assign %s with three shapes compiles', assign => {
    expect(compiles(sceneWith({ shapes: ['circle', 'box', 'hexagon'], assign })).ok).toBe(true);
  });

  it.each(GRID_TARGETS)('the ripple changing %s compiles', target => {
    expect(compiles(sceneWith({ target, shapes: ['circle', 'triangle'] })).ok).toBe(true);
  });

  it('ripples from the corners, the mouse and a point, averaged', () => {
    const g = { ...defaultGrid(), ripples: [{ from: 'corners' as const, at: [0, 0] as [number, number] }, { from: 'mouse' as const, at: [0, 0] as [number, number] }, { from: 'point' as const, at: [0.3, -0.2] as [number, number] }] };
    const p = gridProgram(g);
    expect(p.usesMouse).toBe(true);
    expect(p.lines.filter(l => l.lhs === 'w' && l.op === '+=')).toHaveLength(3);
    expect(p.lines.some(l => l.lhs === 'w' && l.op === '/=')).toBe(true);
    const r = compiles({ ...emptyScene(), grid: g });
    expect(r.ok).toBe(true);
    const { nodes } = buildStandalone2D({ ...emptyScene(), grid: g });
    expect(nodes.some(n => n.type === 'mouse')).toBe(true);
  });

  it('colours by shape, ripple or cell', () => {
    for (const colourBy of ['shape', 'ripple', 'cell'] as const) expect(compiles(sceneWith({ colourBy })).ok, colourBy).toBe(true);
  });

  it('reads and prints in a recipe', () => {
    const src = 'grid 10 8 shape=circle shape=box assign=checker size=0.6 ripple=corners ripple=(0.3,0.2) freq=12 speed=0.5 target=morph amount=0.8 by=shape color=gold color2=pink · glow 0.01 · tone aces';
    const r = parseRecipe2D(src);
    expect(r.errors).toEqual([]);
    expect(r.scene.grid).toMatchObject({ cols: 10, rows: 8, shapes: ['circle', 'box'], assign: 'checker', target: 'morph', colourBy: 'shape' });
    expect(r.scene.grid!.ripples).toEqual([{ from: 'corners', at: [0, 0] }, { from: 'point', at: [0.3, 0.2] }]);
    const again = parseRecipe2D(printRecipe2D(r.scene));
    expect(again.errors).toEqual([]);
    expect(again.scene.grid).toEqual(r.scene.grid);
    expect(compiles(r.scene).ok).toBe(true);
  });

  it('grid on top of ordinary layers', () => {
    const r = parseRecipe2D('circle r=0.6 color=navy · grid 6 shape=ring');
    expect(r.errors).toEqual([]);
    expect(compiles(r.scene).ok).toBe(true);
  });

  describe('a picture cut up into the grid (picture-mode)', () => {
    const withPic = (mode: typeof GRID_PIC_MODES[number], g: Partial<GridSpec> = {}): Scene2D => ({
      ...emptyScene(), textures: [{ name: 'pond', aspect: 1.5 }], grid: { ...defaultGrid(), pic: { tex: 'pond', mode }, ...g },
    });

    it.each(GRID_TARGETS.flatMap(t => GRID_PIC_MODES.map(m => [t, m] as const)))('target %s, mode %s compiles', (target, mode) => {
      const r = compiles(withPic(mode, { target, shapes: ['circle', 'hexagon'] }));
      expect(r.ok, String(r.errors)).toBe(true);
    });

    it('mask reads the screen; the others read the grid block\'s place', () => {
      const { nodes } = buildStandalone2D(withPic('mask'));
      const fit = nodes.find(n => n.params[ROLE_KEY] === 'grid:pic:fit')!;
      const uv = nodes.find(n => n.type === 'uv')!;
      expect(fit.inputs.q.connection?.nodeId).toBe(uv.id);
      const piece = buildStandalone2D(withPic('piece')).nodes;
      const grid = piece.find(n => n.type === 'exprNode' && n.params.label === 'Grid')!;
      expect(piece.some(n => n.inputs?.q?.connection?.nodeId === grid.id && n.inputs.q.connection.outputKey === 'place')).toBe(true);
    });

    /** The grid block's `place` on the CPU at point uv (time t). */
    const placeAt = (g: GridSpec, uv: [number, number], t: number) => {
      const p = gridProgram(g);
      const src = ['uniform vec2 p_uv;', 'uniform float p_t;', 'void main() {', '  vec2 uv = p_uv; float t = p_t;',
        `  float size = ${g.size.toFixed(3)}; float amount = ${g.amount.toFixed(3)}; float freq = ${g.freq.toFixed(3)}; float speed = ${g.speed.toFixed(3)};`,
        ...p.lines.map(l => `  ${l.lhs} ${l.op} ${l.rhs};`), '  gl_FragColor = vec4(place, d, 0.0);', '}'].join('\n');
      return new CpuShader(src).run([0, 0], { resolution: [100, 100], time: t, uniforms: { p_uv: uv, p_t: t } })!;
    };

    it('matte reads the cell\'s centre; piece the centre plus the point, turned and pushed with the shape', () => {
      const base = { ...defaultGrid(), cols: 10, rows: 10, span: 1, size: 0.8 };
      // A cell is 0.2 across; cell (6, 6) has its centre at (0.3, 0.3).
      const at: [number, number] = [0.33, 0.28];
      const matte = placeAt({ ...base, pic: { tex: 'pond', mode: 'matte' } }, at, 0.7);
      expect(matte[0]).toBeCloseTo(0.3, 5); expect(matte[1]).toBeCloseTo(0.3, 5);
      // At rest (amount 0) the pieces make up the picture: piece = the point itself.
      const rest = placeAt({ ...base, amount: 0, pic: { tex: 'pond', mode: 'piece' } }, at, 0.7);
      expect(rest[0]).toBeCloseTo(at[0], 5); expect(rest[1]).toBeCloseTo(at[1], 5);
      // Pushed by the ripple: the point measured from the pushed shape, so the piece goes with it.
      const pushed = placeAt({ ...base, amount: 0.8, target: 'offset', pic: { tex: 'pond', mode: 'piece' } }, at, 0.7);
      const w = Math.sin(Math.hypot(0.3, 0.3) * base.freq - 0.7 * base.speed * Math.PI * 2);
      const m = 0.1 * base.size;
      const push = [Math.cos(w * Math.PI) * 0.8 * m * 0.6, Math.sin(w * Math.PI) * 0.8 * m * 0.6];
      expect(pushed[0]).toBeCloseTo(at[0] - push[0], 5); expect(pushed[1]).toBeCloseTo(at[1] - push[1], 5);
      // Grown by the ripple: m / s undoes it, so the piece grows with the shape.
      const grown = placeAt({ ...base, amount: 0.5, target: 'size', pic: { tex: 'pond', mode: 'piece' } }, at, 0.7);
      const k = Math.min(2, Math.max(0.05, 1 + 0.5 * w));
      expect(grown[0]).toBeCloseTo(0.3 + 0.03 / k, 5); expect(grown[1]).toBeCloseTo(0.3 - 0.02 / k, 5);
    });

    it('reads and prints picture= and picture-mode= in the recipe, both ways', () => {
      for (const mode of GRID_PIC_MODES) {
        const text = printRecipe2D(withPic(mode));
        expect(text).toContain(`picture=pond picture-mode=${mode}`);
        const back = parseRecipe2D(text);
        expect(back.errors).toEqual([]);
        expect(back.scene.grid?.pic).toEqual({ tex: 'pond', mode });
        expect(printRecipe2D(back.scene)).toBe(text);
      }
      const bad = parseRecipe2D('texture pond · grid 8 picture=pond picture-mode=blur');
      expect(bad.errors.map(e => e.message).join(' ')).toMatch(/picture-mode is one of cell, mask, matte, piece/);
      expect(parseRecipe2D('grid 8 picture-mode=matte').warnings.join(' ')).toMatch(/picture=/);
    });
  });
});
