/**
 * Texture Lab in a Scene builder session (docs/texture-lab.md): it builds as it opens, Done leaves plain nodes without
 * the preview as one undo step, Edit this one reopens the stack as it is, the kind page lists it; the add menu says what
 * each tool costs and locks the ones past the pass lock, and a change past the lock is refused; presets and Surprise me
 * build and compile.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  const mem = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v); }, removeItem: (k: string) => { mem.delete(k); }, key: () => null, length: 0, clear: () => mem.clear() };
});

import { compileGraph } from '../../compiler/graphCompiler';
import { HARD_MAX_PASSES, passBudget } from '../../compiler/passBudget';
import type { GraphNode } from '../../types/nodeGraph';
import { undoManager, useNodeGraphStore } from '../../store/useNodeGraphStore';
import { SCENE_KINDS, builtSceneIds, builtScenes, selectedBuiltScene } from '../../builders/sceneKinds';
import { editBuiltScene, startSceneKind } from '../../builders/open';
import { applyTextureLab, specOfBuild } from '../apply';
import { TX_PRESETS, presetNow, surpriseTextureLab, withPreset } from '../presets';
import { blankSpec, newBlock, type TextureLabSpec } from '../spec';
import { useTextureLab } from '../store';
import { addBlock, addCosts, closeTextureLab, editLab, finishTextureLab, openNewTextureLab, passesWith } from '../actions';
import { EXAMPLE_GRAPHS } from '../../store/exampleGraphs';
import { labOfBuild } from '../apply';

const output = (): GraphNode => ({ id: 'out', type: 'output', position: { x: 600, y: 0 }, inputs: { color: { type: 'vec4', label: 'Color' } } as GraphNode['inputs'], outputs: {}, params: {} });
const nodes = () => useNodeGraphStore.getState().nodes;
const roles = () => nodes().map(x => String(x.params._txRole ?? '')).filter(Boolean);

beforeEach(() => {
  undoManager.clear('test');
  useNodeGraphStore.setState({ nodes: [output()], activeGroupPath: [], selectedNodeId: null, selectedNodeIds: [] });
  useTextureLab.setState({ open: false, targetId: null, past: [], future: [], upTo: null, split: 0.5 });
});

describe('Texture Lab in a session', () => {
  it('builds as it opens (with its before | after preview); Done leaves plain nodes, one undo step', () => {
    const before = nodes();
    openNewTextureLab();
    expect(useTextureLab.getState().open).toBe(true);
    expect(roles()).toContain('view:cmp');
    useTextureLab.getState().edit(d => { d.blocks.push(newBlock(d, 'glowTexture')); });
    useTextureLab.getState().setUpTo(useTextureLab.getState().spec.blocks[0].id);
    finishTextureLab();
    expect(useTextureLab.getState().open).toBe(false);
    expect(roles().some(r => r.startsWith('view:'))).toBe(false);
    const c = compileGraph({ nodes: nodes() });
    expect(c.errors ?? []).toEqual([]);
    // The Output shows the end of the stack, not the block it was shown up to.
    const last = useTextureLab.getState().spec.blocks.at(-1)!.id;
    const out = nodes().find(x => x.type === 'output')!;
    expect(nodes().find(x => x.id === out.inputs.color.connection?.nodeId)?.params._txRole).toBe(`${last}:mix`);
    useNodeGraphStore.getState().undo();
    expect(nodes()).toEqual(before);
  });

  it('Edit this one reopens the stack as it is; the kind page lists it; any node of it picks it', () => {
    expect(SCENE_KINDS.find(k => k.id === 'texture')).toMatchObject({ title: 'Texture Lab', phone: false });
    startSceneKind('texture');
    useTextureLab.getState().edit(d => { d.blocks[0].amount = 0.6; });
    const made = useTextureLab.getState().spec;
    finishTextureLab();
    const b = builtScenes(nodes()).find(x => x.kind === 'texture')!;
    expect(b.detail).toMatch(/Room and cat · 2 blocks/);
    const spec = specOfBuild(nodes(), b.id)!;
    expect(spec.blocks.map(x => [x.type, x.amount])).toEqual(made.blocks.map(x => [x.type, x.amount]));
    const anyBlock = nodes().find(x => x.params._txRole === `${made.blocks[1].id}:main`)!;
    expect(selectedBuiltScene(nodes(), [anyBlock.id])?.id).toBe(b.id);
    expect([...builtSceneIds(nodes(), b)].sort()).toEqual(nodes().filter(x => x.type !== 'output').map(x => x.id).sort());
    expect(editBuiltScene(b)).toBe(true);
    expect(useTextureLab.getState().spec.blocks.map(x => x.type)).toEqual(made.blocks.map(x => x.type));
    closeTextureLab();
  });
});

describe('the pass lock', () => {
  /** A stack using `n` passes: computed blocks with a Blur after each (a Pass each). */
  function heavy(n: number): TextureLabSpec {
    const s = blankSpec();
    for (let i = 0; i < n; i++) { s.blocks.push(newBlock(s, 'textureLevels')); s.blocks.push(newBlock(s, 'blurTexture')); }
    return s;
  }

  it('the add menu says each tool\'s cost, grace past 8, and locks what would cross 10', () => {
    openNewTextureLab(undefined, heavy(9));
    expect(passBudget(nodes()).used).toBe(9);
    const costs = addCosts(null);
    expect(costs.get('textureLevels')).toMatchObject({ adds: 0, locked: false });
    expect(costs.get('blurTexture')).toMatchObject({ adds: 1, total: 10, grace: true, locked: false });
    expect(costs.get('opticalFlow')).toMatchObject({ locked: true });
    expect(addBlock('opticalFlow', null)).toBe(false);
    expect(useTextureLab.getState().spec.blocks).toHaveLength(18);
    expect(addBlock('blurTexture', null)).toBe(true);
    expect(passesWith(useTextureLab.getState().spec)).toBe(HARD_MAX_PASSES);
    // At 10, another pass is refused; a per-pixel tool is not.
    expect(addBlock('glowTexture', null)).toBe(false);
    expect(addBlock('curves', null)).toBe(true);
    // A move that would add a Pass is refused too.
    const ok = editLab(d => { d.blocks.reverse(); }, { structural: true });
    expect(typeof ok).toBe('boolean');
    expect(passBudget(nodes()).used).toBeLessThanOrEqual(HARD_MAX_PASSES);
    closeTextureLab();
  });
});

describe('presets, Surprise me, examples', () => {
  it.each(TX_PRESETS.map(p => [p.key]))('%s builds and compiles, and is recognised', key => {
    const spec = withPreset(blankSpec(key === 'trails' ? { kind: 'ball' } : { kind: 'room' }), key);
    expect(presetNow(spec)).toBe(key);
    let i = 0;
    const r = applyTextureLab([output()], spec, { nextId: () => `p${++i}` });
    const c = compileGraph({ nodes: r.nodes });
    expect(c.errors ?? []).toEqual([]);
  });

  it('Surprise me: the same seed gives the same stack, 2–4 tools, a few passes, and it compiles', () => {
    for (const seed of [1, 7, 42, 999, 123456]) {
      const passes = (s: TextureLabSpec) => { let i = 0; return passBudget(applyTextureLab([output()], s, { nextId: () => `s${++i}` }).nodes).used; };
      const a = surpriseTextureLab(seed, blankSpec(), passes);
      const b = surpriseTextureLab(seed, blankSpec(), passes);
      expect(a).toEqual(b);
      expect(a.blocks.length).toBeGreaterThanOrEqual(2);
      expect(a.blocks.length).toBeLessThanOrEqual(4);
      expect(passes(a)).toBeLessThanOrEqual(4);
      let i = 0;
      expect(compileGraph({ nodes: applyTextureLab([output()], a, { nextId: () => `c${++i}` }).nodes }).success).toBe(true);
    }
  });

  it('the examples are Texture Lab builds, reopenable', () => {
    for (const key of ['texLabThermal', 'texLabTrails']) {
      const g = EXAMPLE_GRAPHS[key];
      const src = g.nodes.find(x => x.params.textureLab);
      expect(src, key).toBeDefined();
      expect(labOfBuild(g.nodes, g.nodes.find(x => x.params._txRole === 'b1:main')!.id)).toBe(src!.id);
      expect(g.nodes.every(x => typeof x.params.__comment === 'string' && x.params.__comment.length > 20)).toBe(true);
      expect(g.nodes.some(x => x.type === 'exprNode')).toBe(false);
    }
  });
});
