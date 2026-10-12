/**
 * Effect order matters (docs/builder-look.md, "Effects"): light rays then a kaleidoscope folds the
 * rays' picture (a new Pass holds it and the fold reads that), while a kaleidoscope then light rays
 * streaks the folded picture (the folded picture goes into a new Pass, and the rays read that).
 * Before, a read after a move read the old Pass at the bent point: the rays were folded either way.
 */
import { describe, expect, it } from 'vitest';
import { compileGraph } from '../../compiler/graphCompiler';
import { buildScene2D, buildStandalone2D } from '../build';
import { starterScene, type Scene2D } from '../spec';
import { FX_BY_KIND, fxRole } from '../../builders/look/effects';
import { newStackItem } from '../../builders/look/stack';

function scene(order: Array<'rays' | 'kaleido'>): Scene2D {
  const s = starterScene();
  s.layers[0].at = [0.3, 0.1];
  s.effects = order.map((k, i) => newStackItem(FX_BY_KIND[k], `fx${i + 1}`));
  return s;
}
const roles = (s: Scene2D) => new Map(buildScene2D(s).nodes.map(n => [String(n.params._sbRole), n]));

describe('effect order', () => {
  it('rays → kaleidoscope: the fold reads a new Pass holding the rays', () => {
    const s = scene(['rays', 'kaleido']);
    const r = roles(s);
    const rays = r.get(fxRole(s.effects![0]))!;
    const second = r.get(`${fxRole(s.effects![1])}:pass`)!;
    expect(second.type).toBe('pass');
    expect(second.inputs.color.connection?.nodeId).toBe(rays.id);
    const read = r.get(`${fxRole(s.effects![1])}:read`)!;
    expect(read.inputs.texture.connection?.nodeId).toBe(second.id);
    expect(read.inputs.uv.connection?.nodeId).toBe(r.get(`${fxRole(s.effects![1])}:bend`)!.id);
    expect([...r.values()].filter(n => n.type === 'pass')).toHaveLength(2);
  });

  it('kaleidoscope → rays: the rays streak the folded picture (a new Pass holds it)', () => {
    const s = scene(['kaleido', 'rays']);
    const r = roles(s);
    const rays = r.get(fxRole(s.effects![1]))!;
    // The folded picture: the first Pass read at the folded point…
    const read = r.get(`${fxRole(s.effects![0])}:read`)!;
    expect(read.inputs.uv.connection?.nodeId).toBe(r.get(`${fxRole(s.effects![0])}:bend`)!.id);
    // …drawn into a Pass of its own, which the rays streak (read at the plain point).
    const second = r.get(`${fxRole(s.effects![1])}:pass`)!;
    expect(second.inputs.color.connection?.nodeId).toBe(read.id);
    expect(rays.inputs.texture.connection?.nodeId).toBe(second.id);
    expect(rays.inputs.uv.connection).toBeUndefined();
    expect([...r.values()].filter(n => n.type === 'pass')).toHaveLength(2);
  });

  it('the two orders compile to different programs', () => {
    const shaderOf = (s: Scene2D) => {
      const c = compileGraph({ nodes: buildStandalone2D(s).nodes }) as unknown as { success: boolean; fragmentShader: string; passes?: unknown[] };
      expect(c.success).toBe(true);
      return JSON.stringify([c.fragmentShader.replace(/\/\/[^\n]*/g, ''), c.passes ?? []]);
    };
    expect(shaderOf(scene(['rays', 'kaleido']))).not.toBe(shaderOf(scene(['kaleido', 'rays'])));
  });
});
