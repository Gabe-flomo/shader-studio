/**
 * Muting in the 2D Scene Builder (builders/mute.ts, docs/scene-builder-2d.md, "Muting"): a muted
 * space transform, layer or effect is still built, its node gated by a live uniform, so the shader
 * text is the same muted or not; motions and rings are left out; the recipe prints and reads
 * `muted`; a mute is one undo step and survives Build and reopening.
 */
import { describe, expect, it, vi } from 'vitest';
vi.hoisted(() => {
  const mem = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v); }, removeItem: (k: string) => { mem.delete(k); }, key: () => null, length: 0, clear: () => mem.clear() };
});
import { compileGraph } from '../../compiler/graphCompiler';
import { buildStandalone2D } from '../build';
import { defaultPieces } from '../pieces';
import { emptyScene, newMotion, newShape, newSpaceOp, type Scene2D } from '../spec';
import { parseRecipe2D, printRecipe2D } from '../recipe';
import { useSceneBuilder2D } from '../store';
import { buildFromBuilder2D, editScene2DInBuilder } from '../actions';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { MUTE_FROM_PARAM, MUTE_PARAM, soloIn } from '../../builders/mute';
import { helpAt } from '../../lang/help';
import type { GraphNode } from '../../types/nodeGraph';

const idFor = (role: string) => `t_${role.replace(/[^A-Za-z0-9]/g, '_')}`;
const build = (s: Scene2D) => buildStandalone2D(s, { idFor });
const compile = (s: Scene2D) => {
  const r = compileGraph({ nodes: build(s).nodes });
  expect(r.success, (r.errors ?? []).join('; ')).toBe(true);
  return r;
};
const byRole = (nodes: GraphNode[], role: string) => nodes.find(n => n.params._sbRole === role);

function mirrorScene(muted?: boolean): Scene2D {
  const s = emptyScene();
  s.space.push(newSpaceOp('zoom', 'p1', { by: 2 }));
  s.space.push({ ...newSpaceOp('mirror', 'p2', { axes: 'xy' }), ...(muted === undefined ? {} : { muted }) });
  s.layers.push(newShape('circle', 's1', { at: [0.3, 0.2] }));
  s.look.post.bloom = 0.5;
  return s;
}

describe('muting in the 2D Scene Builder', () => {
  it('a muted space transform is bypassed by a uniform: the same shader, the chain as if it were not there', () => {
    const on = compile(mirrorScene(false));
    const off = compile(mirrorScene(true));
    // No recompile: the shader text is the same, only the uniform moves.
    expect(off.fragmentShader).toBe(on.fragmentShader);
    const u = Object.keys(off.paramUniforms).find(k => k.endsWith('_mute'))!;
    expect(u).toBeTruthy();
    expect(off.paramUniforms[u]).toBe(1);
    expect(on.paramUniforms[u]).toBe(0);
    expect(off.fragmentShader).toMatch(new RegExp(`mix\\([^;]*${u}\\)`));

    // Bypassed equals the chain without it: the mirror passes the zoom's point, which is what the
    // shape reads when there is no mirror at all.
    const muted = build(mirrorScene(true)).nodes;
    const mirror = byRole(muted, 'p2')!;
    expect(mirror.params[MUTE_PARAM]).toBe(1);
    const from = mirror.params[MUTE_FROM_PARAM] as string;
    const without = mirrorScene();
    without.space.splice(1, 1);
    const place = byRole(build(without).nodes, 's1:place')!;
    expect(mirror.inputs[from].connection).toEqual(place.inputs.p.connection);
  });

  it('never muted builds exactly as before (no gate at all)', () => {
    const plain = build(mirrorScene());
    expect(plain.nodes.some(n => MUTE_PARAM in n.params)).toBe(false);
  });

  it('a muted layer draws nothing (far distance, the picture behind passes), live', () => {
    const s = mirrorScene();
    s.layers.push(newShape('box', 's2', { muted: false }));
    const on = compile(s);
    s.layers[1].muted = true;
    const off = compile(s);
    expect(off.fragmentShader).toBe(on.fragmentShader);
    const nodes = build(s).nodes;
    const fill = byRole(nodes, 's2:fill')!;
    expect(fill.params[MUTE_PARAM]).toBe(1);
    expect(fill.params[MUTE_FROM_PARAM]).toBe('background');
    expect(fill.inputs.background.connection?.nodeId).toBe(byRole(nodes, 's1:fill')!.id);
  });

  it('a muted look effect is bypassed live; a muted motion or ring is left out', () => {
    const s = mirrorScene();
    s.look.mute = { bloom: false };
    const on = compile(s);
    s.look.mute = { bloom: true };
    const off = compile(s);
    expect(off.fragmentShader).toBe(on.fragmentShader);
    expect(byRole(build(s).nodes, 'bloom')!.params[MUTE_PARAM]).toBe(1);

    const m = mirrorScene();
    m.layers[0].motion.push(newMotion('orbit', 'm1', { muted: true }));
    m.layers[0].dup = { count: 6, radius: 0.5, levels: 1, factor: 1.6, muted: true };
    const nodes = build(m).nodes;
    expect(nodes.some(n => n.type === 'motion2D')).toBe(false);
    expect(nodes.some(n => n.type === 'angularRepeat2D')).toBe(false);
    compile(m);
  });

  it('prints and reads muted on every clause, round trip', () => {
    const s = mirrorScene(true);
    s.layers[0].muted = true;
    s.layers[0].motion.push(newMotion('spin', 'm1', { muted: true }));
    s.look.tone = 'aces';
    s.look.mute = { tone: true, bloom: true };
    const text = printRecipe2D(s);
    expect(text).toContain('mirror xy muted');
    expect(text).toContain('@spin(0.25 muted)');
    expect(text).toContain('tone aces muted');
    expect(text).toContain('bloom 0.5 muted');
    const back = parseRecipe2D(text);
    expect(back.errors).toEqual([]);
    expect(back.scene.space[1].muted).toBe(true);
    expect(back.scene.space[0].muted).toBeUndefined();
    expect(back.scene.layers[0].muted).toBe(true);
    expect(back.scene.layers[0].motion[0].muted).toBe(true);
    expect(back.scene.look.mute).toEqual({ tone: true, bloom: true });
    expect(printRecipe2D(back.scene)).toBe(text);
    // The hover help explains the flag.
    const h = helpAt('picture', 'mirror xy muted', 12);
    expect(h?.entry.title).toBe('Muted');
  });

  it('solo mutes the rest of the stack; soloing again brings them all back', () => {
    const ops = [{ id: 'a' }, { id: 'b', muted: true }, { id: 'c' }] as Array<{ id: string; muted?: boolean }>;
    soloIn(ops, 'b');
    expect(ops.map(o => !!o.muted)).toEqual([true, false, true]);
    soloIn(ops, 'b');
    expect(ops.map(o => !!o.muted)).toEqual([false, false, false]);
  });

  it('a mute is one undo step and survives Build and reopening', () => {
    useSceneBuilder2D.getState().openWith(mirrorScene());
    useSceneBuilder2D.getState().edit(d => { d.space[1].muted = true; });
    expect(useSceneBuilder2D.getState().scene.space[1].muted).toBe(true);
    useSceneBuilder2D.getState().undo();
    expect(useSceneBuilder2D.getState().scene.space[1].muted).toBeUndefined();
    useSceneBuilder2D.getState().redo();
    expect(buildFromBuilder2D()).toBe(true);
    const sceneId = useSceneBuilder2D.getState().targetSceneId!;
    const nodes = useNodeGraphStore.getState().nodes;
    expect(compileGraph({ nodes }).success).toBe(true);
    // The graph's node shows the mute (the bypass style reads it).
    expect(nodes.some(n => n.type === 'mirror2D' && n.params[MUTE_PARAM] === 1)).toBe(true);
    useSceneBuilder2D.getState().close();
    expect(editScene2DInBuilder(sceneId)).toBe(true);
    expect(useSceneBuilder2D.getState().scene.space[1].muted).toBe(true);
  });

  it('the picture in pieces mutes live; Look grade and Effects cards read `muted` as off', () => {
    const s = mirrorScene();
    s.textures = [{ name: 'brick' }];
    s.pieces = { ...defaultPieces('brick'), muted: false };
    const on = compile(s);
    s.pieces.muted = true;
    const off = compile(s);
    expect(off.fragmentShader).toBe(on.fragmentShader);
    const text = printRecipe2D(s);
    expect(text).toMatch(/pieces brick[^·]* muted/);
    expect(parseRecipe2D(text).scene.pieces?.muted).toBe(true);
    const g = parseRecipe2D('circle · grade saturation 1.3 muted');
    expect(g.errors).toEqual([]);
    expect(g.scene.look.grade?.[0].on).toBe(false);
  });
});
