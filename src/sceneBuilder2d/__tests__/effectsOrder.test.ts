/**
 * Effect order matters (docs/builder-look.md, "Effects"): light rays then a kaleidoscope folds the
 * rays' picture (the rays read their Pass at the folded point), while a kaleidoscope then light rays
 * streaks the folded picture (the scene is drawn folded, and the rays read a Pass of that).
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
  it('rays → kaleidoscope: the rays read the picture in a Pass, at the folded point', () => {
    const s = scene(['rays', 'kaleido']);
    const r = roles(s);
    const rays = r.get(fxRole(s.effects![0]))!;
    const pass = r.get(`${fxRole(s.effects![0])}:pass`)!;
    expect(pass.type).toBe('pass');
    expect(rays.inputs.texture.connection?.nodeId).toBe(pass.id);
    // The fold bends the point the rays' picture is read at: the folded rays.
    expect(rays.inputs.uv.connection?.nodeId).toBe(r.get(`${fxRole(s.effects![1])}:bend`)!.id);
    expect([...r.values()].filter(n => n.type === 'pass')).toHaveLength(1);
  });

  it('kaleidoscope → rays: the scene is drawn folded, and the rays streak it (a Pass holds it)', () => {
    const s = scene(['kaleido', 'rays']);
    const r = roles(s);
    const rays = r.get(fxRole(s.effects![1]))!;
    const fold = r.get(`${fxRole(s.effects![0])}:bend`)!;
    expect(fold.inputs.input.connection?.nodeId).toBe(r.get('uv')!.id);
    const pass = r.get(`${fxRole(s.effects![1])}:pass`)!;
    expect(rays.inputs.texture.connection?.nodeId).toBe(pass.id);
    expect(rays.inputs.uv.connection).toBeUndefined();
    expect(r.has(`${fxRole(s.effects![0])}:read`)).toBe(false);
    expect([...r.values()].filter(n => n.type === 'pass')).toHaveLength(1);
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
