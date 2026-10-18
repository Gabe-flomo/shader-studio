/**
 * The Effects page builds a Pass only where an effect reads round a pixel (docs/builder-look.md,
 * "Effects"). Moves before the first read bend the scene's own coordinates; moves after a read bend
 * the point that read works at; CRT mask works on the colour.
 */
import { describe, expect, it, vi } from 'vitest';
vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});
import type { GraphNode } from '../../types/nodeGraph';
import { compileGraph } from '../../compiler/graphCompiler';
import { CpuShader } from '../../lib/guidedConvert/cpuGlsl';
import { buildScene2D, buildStandalone2D } from '../build';
import { starterScene, type Scene2D } from '../spec';
import { TEMPLATES_2D, GRID_TEMPLATES_2D, templateScene } from '../templates';
import { FX_BY_KIND, FX_KINDS, fxClass, fxRole } from '../../builders/look/effects';
import { newStackItem, type StackItem } from '../../builders/look/stack';

function scene(kinds: string[], params: Record<string, Record<string, number>> = {}): Scene2D {
  const s = starterScene();
  s.layers[0].at = [0.3, 0.1];
  s.effects = kinds.map((k, i) => newStackItem(FX_BY_KIND[k], `fx${i + 1}`, params[k]));
  return s;
}
const build = (s: Scene2D) => {
  const nodes = buildScene2D(s).nodes;
  const role = new Map(nodes.map(n => [String(n.params._sbRole), n]));
  return { nodes, role, passes: nodes.filter(n => n.type === 'pass') };
};
const from = (n: GraphNode, key: string) => n.inputs[key]?.connection?.nodeId;
const fx = (s: Scene2D, i: number, suffix = '') => fxRole(s.effects![i]) + suffix;

describe('effects build a Pass only before a read', () => {
  it('the user\'s stack [CRT, chromatic aberration, kaleidoscope]: one Pass, before the chroma', () => {
    const s = scene(['crt', 'chroma', 'kaleido']);
    const { role, passes } = build(s);
    expect(passes).toHaveLength(1);
    const pass = role.get(fx(s, 1, ':pass'))!;
    expect(pass.type).toBe('pass');
    // The CRT's screen bends the scene's own coordinates (from the UV node): no Pass, no Sample.
    const uv = role.get('uv')!;
    const scr = role.get(fx(s, 0, ':screen'))!;
    expect(from(scr, 'uv')).toBe(uv.id);
    const mask = role.get(fx(s, 0))!;
    expect(mask.type).toBe('crtMask');
    expect(from(mask, 'uv')).toBe(uv.id);
    expect(from(mask, 'vignette')).toBe(scr.id);
    expect(from(pass, 'color')).toBe(mask.id);
    // The chroma reads the Pass at the kaleidoscope's folded point.
    const chroma = role.get(fx(s, 1))!;
    const fold = role.get(fx(s, 2, ':bend'))!;
    expect(from(chroma, 'texture')).toBe(pass.id);
    expect(from(chroma, 'uv')).toBe(fold.id);
    expect(from(fold, 'input')).toBe(uv.id);
    expect([...role.values()].some(n => n.type === 'sampleTexture' && String(n.params._sbRole).startsWith('fx:'))).toBe(false);
  });

  it('[kaleidoscope, CRT]: no Pass; the CRT screen bends the point first, the fold after it', () => {
    const s = scene(['kaleido', 'crt']);
    const { role, passes, nodes } = build(s);
    expect(passes).toHaveLength(0);
    const uv = role.get('uv')!;
    const scr = role.get(fx(s, 1, ':screen'))!;
    const fold = role.get(fx(s, 0, ':bend'))!;
    expect(from(scr, 'uv')).toBe(uv.id);
    expect(from(fold, 'input')).toBe(scr.id);
    // The scene is drawn at the folded point: something outside the effects reads it.
    expect(nodes.some(n => !String(n.params._sbRole).startsWith('fx:') && Object.values(n.inputs).some(i => i.connection?.nodeId === fold.id))).toBe(true);
    const mask = role.get(fx(s, 1))!;
    expect(from(mask, 'uv')).toBe(uv.id);
    expect(from(mask, 'vignette')).toBe(scr.id);
  });

  it('[chroma, kaleidoscope]: keeps the Pass and reads it at the folded point', () => {
    const s = scene(['chroma', 'kaleido']);
    const { role, passes } = build(s);
    expect(passes).toHaveLength(1);
    const chroma = role.get(fx(s, 0))!;
    expect(from(chroma, 'texture')).toBe(passes[0].id);
    expect(from(chroma, 'uv')).toBe(role.get(fx(s, 1, ':bend'))!.id);
  });

  it('one Pass per read and none for moves or colour, for every kind', () => {
    const kinds = FX_KINDS.map(d => d.kind);
    const items: StackItem[] = kinds.map((k, i) => newStackItem(FX_BY_KIND[k], `fx${i + 1}`));
    const reads = items.filter(it => fxClass(it) === 'read').length;
    // Six at most: take the first six reads with every move and colour effect.
    const s = starterScene();
    s.effects = items;
    const { passes } = build(s);
    expect(passes).toHaveLength(Math.min(reads, 6));
    const moves = starterScene();
    moves.effects = items.filter(it => fxClass(it) !== 'read');
    expect(build(moves).passes).toHaveLength(0);
    const c = compileGraph({ nodes: buildStandalone2D(moves).nodes });
    expect(c.success).toBe(true);
  });

  it('a scene that can\'t be bent (a field chain reads the point) reads one Pass at the bent point', () => {
    const s = templateScene('pieces');
    s.effects = [newStackItem(FX_BY_KIND.kaleido, 'fx1'), newStackItem(FX_BY_KIND.swirl, 'fx2')];
    const { role, passes } = build(s);
    expect(passes).toHaveLength(1);
    const read = role.get(fx(s, 0, ':read'))!;
    // The later move (swirl) bends the screen's point first, the fold after it.
    expect(from(read, 'uv')).toBe(role.get(fx(s, 0, ':bend'))!.id);
    expect(from(role.get(fx(s, 0, ':bend'))!, 'input')).toBe(role.get(fx(s, 1, ':bend'))!.id);
  });

  it('every template and grid template, with moves, a read and a CRT, still compiles', () => {
    for (const t of [...TEMPLATES_2D, ...GRID_TEMPLATES_2D]) {
      const s = templateScene(t.key);
      s.effects = ['crt', 'kaleido', 'blur', 'swirl'].map((k, i) => newStackItem(FX_BY_KIND[k], `fx${i + 1}`));
      const { nodes } = buildStandalone2D(s);
      const r = compileGraph({ nodes });
      expect(r.errors ?? [], t.key).toEqual([]);
      expect(r.success, t.key).toBe(true);
      const fxPasses = nodes.filter(n => n.type === 'pass' && String(n.params._sbRole).startsWith('fx:')).length;
      expect(fxPasses, t.key).toBe(t.key === 'pieces' ? 2 : 1);
    }
  });
});

describe('two moves compose in card order, as one Pass per effect did', () => {
  const RES: [number, number] = [160, 90];
  const ASP = RES[0] / RES[1];
  // The moves by hand: card A then card B gives picture(A(B(p))).
  const pixelate = (size: number) => ([x, y]: number[]) => [Math.floor(x / size) * size, Math.floor(y / size) * size];
  const kaleido = (n: number) => ([x, y]: number[]) => {
    const s = 6.28318 / n;
    let a = Math.atan2(y, x);
    a = a - s * Math.floor(a / s);
    if (a > s * 0.5) a = s - a;
    const l = Math.hypot(x, y);
    return [Math.cos(a) * l, Math.sin(a) * l];
  };
  const colourAt = (sh: CpuShader, uniforms: Record<string, number | number[]>, p: number[]) =>
    sh.run([(p[0] / ASP * 0.5 + 0.5) * RES[0], (p[1] * 0.5 + 0.5) * RES[1]], { resolution: RES, time: 0.5, uniforms })!;
  const shader = (s: Scene2D) => {
    const r = compileGraph({ nodes: buildStandalone2D(s).nodes });
    expect(r.success).toBe(true);
    return { sh: new CpuShader(r.fragmentShader), u: r.paramUniforms };
  };

  for (const [a, b] of [['pixelate', 'kaleido'], ['kaleido', 'pixelate']] as const) {
    it(`[${a}, ${b}] is the plain scene read at ${a}(${b}(p))`, () => {
      const bends = { pixelate: pixelate(0.1), kaleido: kaleido(6) };
      const bent = shader(scene([a, b], { pixelate: { size: 0.1 } }));
      const plain = shader(scene([]));
      let maxDiff = 0, maxOther = 0;
      for (const p of [[0.213, 0.137], [-0.417, 0.273], [0.054, -0.336], [0.618, 0.117], [-0.153, -0.522], [0.337, 0.428]]) {
        const got = colourAt(bent.sh, bent.u, p);
        const want = colourAt(plain.sh, plain.u, bends[a](bends[b](p)));
        const other = colourAt(plain.sh, plain.u, bends[b](bends[a](p)));
        for (let k = 0; k < 3; k++) { maxDiff = Math.max(maxDiff, Math.abs(got[k] - want[k])); maxOther = Math.max(maxOther, Math.abs(got[k] - other[k])); }
      }
      expect(maxDiff).toBeLessThan(1e-4);
      // The other order is a different picture (so the test can tell them apart).
      expect(maxOther).toBeGreaterThan(1e-3);
    });
  }
});
