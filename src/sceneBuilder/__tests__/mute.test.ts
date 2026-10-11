/**
 * Muting in the 3D Scene Builder (builders/mute.ts, docs/scene-builder-3d.md, "Muting"): a muted
 * shape, group, warp, light or effect is still built, its node gated by a live uniform, so the
 * shader text is the same muted or not; Materials leaves muted shapes out; the recipe prints and
 * reads `muted`; the recogniser reads mutes back; a mute is one undo step and survives Build and
 * reopening.
 */
import { describe, expect, it, vi } from 'vitest';
vi.hoisted(() => {
  const mem = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v); }, removeItem: (k: string) => { mem.delete(k); }, key: () => null, length: 0, clear: () => mem.clear() };
});
import { compileGraph } from '../../compiler/graphCompiler';
import { buildStandaloneGraph, ROLE_KEY } from '../build';
import { autoStepScale, newGroup, newShape, newWarp, starterSpec, emptySpec, stepHints, type SceneSpec } from '../spec';
import { parseRecipe, printRecipe } from '../recipe';
import { describeGraph } from '../recognize';
import { useSceneBuilder } from '../store';
import { buildFromBuilder, editSceneInBuilder } from '../actions';
import { soloItem, toggleItemMute, toggleLookMute, toggleWarpMute } from '../edit';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { FAR, MUTE_FROM_PARAM, MUTE_PARAM, MUTE_TO_PARAM } from '../../builders/mute';
import type { GraphNode, SubgraphData } from '../../types/nodeGraph';

vi.mock('../../components/ui/dialogStore', () => ({ askChoice: async () => 'replace' }));

const idFor = (role: string) => `t_${role.replace(/[^A-Za-z0-9]/g, '_')}`;
const build = (s: SceneSpec) => buildStandaloneGraph(s, { idFor });
const inner = (n: GraphNode | undefined): GraphNode[] => ((n?.params.subgraph as SubgraphData | undefined)?.nodes ?? []);
const every = (nodes: GraphNode[]): GraphNode[] => nodes.flatMap(n => [n, ...every(inner(n))]);
const byRole = (nodes: GraphNode[], role: string) => every(nodes).find(n => n.params[ROLE_KEY] === role);
const compile = (s: SceneSpec) => {
  const r = compileGraph({ nodes: build(s).nodes });
  expect(r.success, (r.errors ?? []).join('; ')).toBe(true);
  return r;
};
const muteUniforms = (r: ReturnType<typeof compileGraph>) => Object.keys(r.paramUniforms).filter(k => k.endsWith('_mute'));

/** Two shapes (one colour each: Materials) and a twist on the second; fog and tone. */
function scene(mutes: { shape?: boolean; warp?: boolean; group?: boolean } = {}): SceneSpec {
  const s = emptySpec();
  const a = newShape('sphere', 's1', { size: { r: 0.6 }, color: [0.9, 0.3, 0.2] });
  const b = newShape('box', 's2', { at: [1, 0, 0], color: [0.2, 0.4, 0.9], warps: [newWarp('twist', 'w1', { k: 2 })] });
  const c = newShape('torus', 's3', { at: [-1, 0, 0] });
  if (mutes.shape !== undefined) b.muted = mutes.shape;
  if (mutes.warp !== undefined) b.warps[0].muted = mutes.warp;
  const g = newGroup('g2', { op: 'union', children: [b, c] });
  if (mutes.group !== undefined) g.muted = mutes.group;
  s.root.children.push(a, g);
  s.look.fog = 0.2;
  return s;
}

describe('muting in the 3D Scene Builder', () => {
  it('never muted builds exactly as before (no gate at all)', () => {
    const nodes = every(build(scene()).nodes);
    expect(nodes.some(n => MUTE_PARAM in n.params)).toBe(false);
    expect(nodes.some(n => MUTE_PARAM in n.params)).toBe(false);
    const s = starterSpec();
    s.look.mute = {};
    expect(every(build(s).nodes).some(n => MUTE_PARAM in n.params)).toBe(false);
  });

  it('a muted warp is bypassed by a uniform: the same shader, the point passes through', () => {
    const on = compile(scene({ warp: false }));
    const off = compile(scene({ warp: true }));
    expect(off.fragmentShader).toBe(on.fragmentShader);
    const u = muteUniforms(off);
    expect(u.length).toBe(1);
    expect(off.paramUniforms[u[0]]).toBe(1);
    expect(on.paramUniforms[u[0]]).toBe(0);
    expect(off.fragmentShader).toMatch(new RegExp(`mix\\([^;]*${u[0]}\\)`));
    // Bypassed equals the chain without it: the twist passes the point the shape's move reads without a twist.
    const nodes = build(scene({ warp: true })).nodes;
    const tw = byRole(nodes, 's2:w1') ?? byRole(nodes, 'w1')!;
    expect(tw.params[MUTE_PARAM]).toBe(1);
    const from = tw.params[MUTE_FROM_PARAM] as string;
    const without = scene();
    (without.root.children[1] as { children: Array<{ warps: unknown[] }> }).children[0].warps = [];
    const place = byRole(build(without).nodes, 's2:at')!;
    expect(tw.inputs[from].connection).toEqual(place.inputs.p.connection);
    // Materials (a plain group: no gates) bypasses its copy by a block with a live 0/1 slider.
    expect(byRole(nodes, 'mat:s2:w1:muted')!.params.value).toBe(1);
    expect(byRole(build(scene({ warp: false })).nodes, 'mat:s2:w1:muted')!.params.value).toBe(0);
  });

  it('a muted shape draws nothing (far distance), live; in Materials it never wins a colour', () => {
    const on = compile(scene({ shape: false }));
    const off = compile(scene({ shape: true }));
    expect(off.fragmentShader).toBe(on.fragmentShader);
    const u = muteUniforms(off);
    expect(u.length).toBe(1);
    expect(off.paramUniforms[u[0]]).toBe(1);
    expect(on.paramUniforms[u[0]]).toBe(0);
    const nodes = build(scene({ shape: true })).nodes;
    const box = byRole(nodes, 's2')!;
    expect(box.params[MUTE_PARAM]).toBe(1);
    expect(box.params[MUTE_TO_PARAM]).toBe(FAR);
    expect(byRole(nodes, 'mat:s2:s2:muted')!.params.value).toBe(1);
    expect(byRole(nodes, 'mat:s2:s2:mute')!.params.result).toBe(`mix(v, ${FAR}, m)`);
    expect(byRole(nodes, 'mat:s1:s1:mute')).toBeUndefined();
  });

  it('a muted group gates its last combine with a far distance; in Materials its shapes measure far', () => {
    const s = scene({ group: true });
    expect(compile(s).fragmentShader).toBe(compile(scene({ group: false })).fragmentShader);
    const nodes = build(s).nodes;
    const op = byRole(nodes, 'g2:op1')!;
    expect(op.params[MUTE_PARAM]).toBe(1);
    expect(op.params[MUTE_TO_PARAM]).toBe(FAR);
    expect(byRole(nodes, 'mat:s2:s2:muted')!.params.value).toBe(1);
    expect(byRole(nodes, 'mat:s3:s3:muted')!.params.value).toBe(1);
    // A one-item group: the item inside carries the mute.
    const one = scene();
    const g = one.root.children[1] as ReturnType<typeof newGroup>;
    g.children.pop();
    g.muted = true;
    expect(byRole(build(one).nodes, 's2')!.params[MUTE_PARAM]).toBe(1);
    compile(one);
  });

  it('muted lights and effects are bypassed live: shadows and AO shade 1, fog and tone pass the colour', () => {
    const s = scene();
    s.root.children[0] = { ...s.root.children[0], shine: 0.5 } as typeof s.root.children[0];
    s.look.mute = { shadows: false, ao: false, fog: false, tone: false, shine: false };
    const on = compile(s);
    s.look.mute = { shadows: true, ao: true, fog: true, tone: true, shine: true };
    const off = compile(s);
    expect(off.fragmentShader).toBe(on.fragmentShader);
    expect(muteUniforms(off).length).toBe(5);
    for (const u of muteUniforms(off)) { expect(off.paramUniforms[u]).toBe(1); expect(on.paramUniforms[u]).toBe(0); }
    const nodes = build(s).nodes;
    expect(byRole(nodes, 'shadow')!.params[MUTE_TO_PARAM]).toBe('1.0');
    expect(byRole(nodes, 'ao')!.params[MUTE_TO_PARAM]).toBe('1.0');
    expect(byRole(nodes, 'fog')!.params[MUTE_FROM_PARAM]).toBe('color');
    expect(byRole(nodes, 'tone')!.params[MUTE_FROM_PARAM]).toBe('color');
    expect(byRole(nodes, 'shine')!.params[MUTE_FROM_PARAM]).toBe('lit');
  });

  it('a muted Scale gates both halves; a muted modifier passes the distance', () => {
    const s = starterSpec();
    s.root.children[0].warps.push({ ...newWarp('scale', 'w1', { s: 2 }), muted: true }, { ...newWarp('round', 'w2', { r: 0.1 }), muted: true });
    compile(s);
    const nodes = build(s).nodes;
    expect(byRole(nodes, 'w1')!.params[MUTE_FROM_PARAM]).toBe('p');
    expect(byRole(nodes, 'w1:dist')!.params[MUTE_FROM_PARAM]).toBe('dist');
    expect(byRole(nodes, 'w2')!.params[MUTE_FROM_PARAM]).toBe('sdf');
  });

  it('prints and reads muted on shapes, groups, warps and the look, round trip', () => {
    const s = scene({ shape: true, warp: true, group: true });
    s.root.warps.push({ ...newWarp('twist', 'w9', { k: 1 }), muted: true });
    s.look.mute = { shadows: true, ao: true, fog: true, tone: true, shine: true };
    const text = printRecipe(s);
    expect(text).toContain('@twist(2 muted)');
    expect(text).toMatch(/box at=\(1,0,0\) color=\S+ muted @twist/);
    expect(text).toMatch(/union\(.*\) muted/);
    expect(text).toContain('twist 1 muted');
    for (const c of ['shadows 16 muted', 'ao 0.06 muted', 'shine muted', 'fog 0.2 muted', 'tone aces muted']) expect(text).toContain(c);
    const back = parseRecipe(text);
    expect(back.errors).toEqual([]);
    expect(printRecipe(back.spec)).toBe(text);
    expect(back.spec.look.mute).toEqual(s.look.mute);
    const g = back.spec.root.children[1] as ReturnType<typeof newGroup>;
    expect(g.muted).toBe(true);
    expect(g.children[0].muted).toBe(true);
    expect(g.children[0].warps[0].muted).toBe(true);
    expect(back.spec.root.children[0].muted).toBeUndefined();
    expect(back.spec.root.warps[0].muted).toBe(true);
    // Never muted: the recipe has no flag.
    expect(printRecipe(scene())).not.toContain('muted');
  });

  it('the recogniser reads mutes back from the graph', () => {
    const s = scene({ shape: true, warp: true, group: true });
    s.look.mute = { fog: true, tone: false };
    const d = describeGraph(build(s).nodes)!;
    const g = d.spec.root.children.find(c => c.type === 'group') as ReturnType<typeof newGroup>;
    expect(g.muted).toBe(true);
    const box = g.children.find(c => c.type === 'shape' && c.kind === 'box')!;
    expect(box.muted).toBe(true);
    expect(box.warps[0].muted).toBe(true);
    expect(d.spec.look.mute).toEqual({ fog: true, tone: false });
  });

  it('a mute is one undo step, solo mutes the rest, and it survives Build and reopening', async () => {
    useSceneBuilder.getState().openWith(scene());
    const st = () => useSceneBuilder.getState();
    st().edit(d => toggleItemMute(d, 's1'));
    expect(st().spec.root.children[0].muted).toBe(true);
    st().undo();
    expect(st().spec.root.children[0].muted).toBeUndefined();
    st().redo();
    st().edit(d => toggleWarpMute(d, 's2', 'w1'));
    st().edit(d => toggleLookMute(d, 'fog'));
    expect(st().spec.look.mute).toEqual({ fog: true });
    st().edit(d => toggleItemMute(d, st().spec.root.id));
    expect(st().spec.root.muted).toBeUndefined();
    // Solo: the others in the stack muted.
    const solo = scene();
    soloItem(solo, 's2');
    const g = solo.root.children[1] as ReturnType<typeof newGroup>;
    expect(g.children.map(c => !!c.muted)).toEqual([false, true]);

    expect(await buildFromBuilder()).toBe(true);
    const sceneId = st().targetSceneId!;
    const nodes = useNodeGraphStore.getState().nodes;
    expect(compileGraph({ nodes }).success).toBe(true);
    expect(every(nodes).some(n => n.params[ROLE_KEY] === 's1' && n.params[MUTE_PARAM] === 1)).toBe(true);
    st().close();
    expect(editSceneInBuilder(sceneId)).toBe(true);
    expect(st().spec.root.children[0].muted).toBe(true);
    expect(st().spec.look.mute).toEqual({ fog: true });
  });
});

describe('a muted warp, shape or group asks nothing of the march step', () => {
  it('a muted twist no longer makes the march take smaller steps; unmuted it does', () => {
    expect(autoStepScale(scene())).toBeLessThan(1);
    expect(autoStepScale(scene({ warp: false }))).toBeLessThan(1);
    expect(autoStepScale(scene({ warp: true }))).toBe(1);
    expect(stepHints(scene({ warp: true }))).toEqual([]);
  });
  it('nor does a twist on a muted shape, or in a muted group', () => {
    expect(autoStepScale(scene({ shape: true }))).toBe(1);
    expect(autoStepScale(scene({ group: true }))).toBe(1);
  });
});
