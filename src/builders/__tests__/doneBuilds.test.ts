/**
 * Done builds, then closes (builders/finish.ts doneBuilding), for every builder that builds on
 * demand: the 2D, 3D and Grid Scene Builders. Edits are never lost: Done builds them (a rebuild
 * keeps the node ids), a failed build keeps the window open, ✕ with unbuilt edits asks
 * Build / Discard / Keep editing, and a draft survives a close and comes back on reopening
 * (builders/drafts.ts).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const fail = vi.hoisted(() => {
  const mem = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v); }, removeItem: (k: string) => { mem.delete(k); }, key: () => null, length: 0, clear: () => mem.clear() };
  return { on: false };
});
vi.mock('../../sceneBuilder2d/apply', async orig => {
  const m = await orig<typeof import('../../sceneBuilder2d/apply')>();
  return { ...m, applyScene2D: (...a: Parameters<typeof m.applyScene2D>) => { if (fail.on) throw new Error('boom'); return m.applyScene2D(...a); } };
});
vi.mock('../../sceneBuilder/apply', async orig => {
  const m = await orig<typeof import('../../sceneBuilder/apply')>();
  return { ...m, applyScene: (...a: Parameters<typeof m.applyScene>) => { if (fail.on) throw new Error('boom'); return m.applyScene(...a); } };
});
vi.mock('../../gridScene/apply', async orig => {
  const m = await orig<typeof import('../../gridScene/apply')>();
  return { ...m, applyGridScene: (...a: Parameters<typeof m.applyGridScene>) => { if (fail.on) throw new Error('boom'); return m.applyGridScene(...a); } };
});
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { useDialogStore } from '../../components/ui/dialogStore';
import { useToastStore } from '../../components/ui/toastStore';
import { closeBuilding, doneBuilding, type BuildingBuilder } from '../finish';
import { readDraft } from '../drafts';
import { useSceneBuilder2D } from '../../sceneBuilder2d/store';
import { editScene2DInBuilder, openNewSceneBuilder2D, scene2dBuilder } from '../../sceneBuilder2d/actions';
import { find2dBuild } from '../../sceneBuilder2d/apply';
import { useSceneBuilder, openNewSceneBuilder } from '../../sceneBuilder/store';
import { editSceneInBuilder } from '../../sceneBuilder/actions';
import { metaOf } from '../../sceneBuilder/build';
import { scene3dBuilder } from '../../components/sceneBuilder/SceneBuilderModal';
import { useGridBuilder } from '../../gridScene/store';
import { editGridSceneInBuilder, gridSceneBuilder, openNewGridScene } from '../../gridScene/actions';
import { gridMetaOf } from '../../gridScene/apply';
import type { GraphNode } from '../../types/nodeGraph';

type Vec3 = [number, number, number];
const RED: Vec3 = [1, 0, 0];
const GREEN: Vec3 = [0, 1, 0];

/** One builder, as the tests drive it. */
interface Case {
  name: string;
  kind: '2d' | '3d' | 'grid';
  b: BuildingBuilder;
  openNew: () => void;
  reopen: (id: string) => void;
  isOpen: () => boolean;
  target: () => string | null;
  /** Change the first shape's colour (one builder undo step). */
  paint: (c: Vec3) => void;
  /** The first shape's colour in the builder. */
  colour: () => Vec3;
  /** The first shape's colour as built into the graph (the build's saved spec). */
  builtColour: (id: string) => Vec3 | undefined;
}

const nodes = () => useNodeGraphStore.getState().nodes;
const topIds = () => nodes().map(n => n.id).sort();

const CASES: Case[] = [
  {
    name: '2D Scene Builder', kind: '2d', b: scene2dBuilder,
    openNew: () => openNewSceneBuilder2D(),
    reopen: id => { editScene2DInBuilder(id); },
    isOpen: () => useSceneBuilder2D.getState().open,
    target: () => useSceneBuilder2D.getState().targetSceneId,
    paint: c => useSceneBuilder2D.getState().edit(d => { (d.layers[0] as { color: Vec3 }).color = c; }),
    colour: () => (useSceneBuilder2D.getState().scene.layers[0] as { color: Vec3 }).color,
    builtColour: id => (find2dBuild(nodes(), id)?.meta.spec.layers[0] as { color: Vec3 } | undefined)?.color,
  },
  {
    name: '3D Scene Builder', kind: '3d', b: scene3dBuilder,
    openNew: () => openNewSceneBuilder(),
    reopen: id => { editSceneInBuilder(id); },
    isOpen: () => useSceneBuilder.getState().open,
    target: () => useSceneBuilder.getState().targetSceneId,
    paint: c => { const s = structuredClone(useSceneBuilder.getState().spec); (s.root.children[0] as { color: Vec3 }).color = c; useSceneBuilder.getState().replace(s); },
    colour: () => (useSceneBuilder.getState().spec.root.children[0] as { color: Vec3 }).color,
    builtColour: id => (metaOf(nodes().find(n => n.id === id))?.spec.root.children[0] as { color: Vec3 } | undefined)?.color,
  },
  {
    name: 'Grid builder', kind: 'grid', b: gridSceneBuilder,
    openNew: () => openNewGridScene(),
    reopen: id => { editGridSceneInBuilder(id); },
    isOpen: () => useGridBuilder.getState().open,
    target: () => useGridBuilder.getState().targetSceneId,
    paint: c => useGridBuilder.getState().edit(d => { d.shapes[0].color = c; }),
    colour: () => useGridBuilder.getState().spec.shapes[0].color as Vec3,
    builtColour: id => gridMetaOf(nodes().find(n => n.id === id))?.spec.shapes[0].color as Vec3 | undefined,
  },
];

/** Answer the dialog that is up (Build / Discard / Keep editing). */
function answer(id: string | null): void {
  const d = useDialogStore.getState().current;
  expect(d?.kind).toBe('choice');
  useDialogStore.setState({ current: null });
  (d as { resolve: (v: string | null) => void }).resolve(id);
}

beforeEach(() => {
  fail.on = false;
  globalThis.localStorage.clear();
  useSceneBuilder2D.setState({ open: false });
  useSceneBuilder.setState({ open: false });
  useGridBuilder.setState({ open: false });
  globalThis.localStorage.clear();
  useDialogStore.setState({ current: null });
  useToastStore.setState({ toasts: [] });
  useNodeGraphStore.setState({
    nodes: [{ id: 'out', type: 'output', position: { x: 600, y: 0 }, inputs: { color: { type: 'vec3', label: 'Color' } } as GraphNode['inputs'], outputs: {}, params: {} }],
    activeGroupPath: [], selectedNodeId: null, selectedNodeIds: [], _fitViewCallback: null,
  });
});
afterEach(() => { fail.on = false; });

describe.each(CASES)('$name: Done builds, then closes', c => {
  it('edit → Done: the graph has the built nodes, with the edit', async () => {
    c.openNew();
    c.paint(RED);
    expect(await doneBuilding(c.b)).toBe(true);
    expect(c.isOpen()).toBe(false);
    const id = c.target()!;
    expect(id).toBeTruthy();
    expect(nodes().some(n => n.id === id)).toBe(true);
    expect(c.builtColour(id)).toEqual(RED);
    expect(readDraft(c.kind, null)).toBeNull();
    expect(readDraft(c.kind, id)).toBeNull();
  });

  it('a new scene opened and Done straight away is built too', async () => {
    c.openNew();
    expect(await doneBuilding(c.b)).toBe(true);
    expect(nodes().some(n => n.id === c.target())).toBe(true);
  });

  it('edit a built scene → Done: rebuilt with the edit, keeping the node ids', async () => {
    c.openNew();
    await doneBuilding(c.b);
    const id = c.target()!;
    const before = topIds();
    c.reopen(id);
    expect(c.isOpen()).toBe(true);
    c.paint(GREEN);
    expect(c.b.needsBuild()).toBe(true);
    expect(await doneBuilding(c.b)).toBe(true);
    expect(c.isOpen()).toBe(false);
    expect(c.target()).toBe(id);
    expect(topIds()).toEqual(before);
    expect(c.builtColour(id)).toEqual(GREEN);
  });

  it('a failing build keeps the window open, with the edits, and says why', async () => {
    c.openNew();
    c.paint(RED);
    fail.on = true;
    expect(await doneBuilding(c.b)).toBe(false);
    expect(c.isOpen()).toBe(true);
    expect(c.colour()).toEqual(RED);
    expect(useToastStore.getState().toasts.some(t => t.tone === 'danger' && /Couldn't build/.test(t.title))).toBe(true);
    fail.on = false;
    expect(await doneBuilding(c.b)).toBe(true);
    expect(c.builtColour(c.target()!)).toEqual(RED);
  });

  it('✕ with unbuilt edits asks: Keep editing stays open, Build builds and closes', async () => {
    c.openNew();
    c.paint(RED);
    let closing = closeBuilding(c.b);
    answer('keep');
    expect(await closing).toBe(false);
    expect(c.isOpen()).toBe(true);
    closing = closeBuilding(c.b);
    answer(null); // dismissed: keep editing
    expect(await closing).toBe(false);
    expect(c.isOpen()).toBe(true);
    closing = closeBuilding(c.b);
    answer('build');
    expect(await closing).toBe(true);
    expect(c.isOpen()).toBe(false);
    expect(c.builtColour(c.target()!)).toEqual(RED);
  });

  it('✕ → Discard closes without them and forgets the draft', async () => {
    c.openNew();
    await doneBuilding(c.b);
    const id = c.target()!;
    c.reopen(id);
    c.paint(GREEN);
    const closing = closeBuilding(c.b);
    answer('discard');
    expect(await closing).toBe(true);
    expect(c.isOpen()).toBe(false);
    expect(c.builtColour(id)).not.toEqual(GREEN);
    expect(readDraft(c.kind, id)).toBeNull();
    c.reopen(id);
    expect(c.colour()).not.toEqual(GREEN);
  });

  it('✕ with nothing unbuilt just closes, no question', async () => {
    c.openNew();
    expect(await closeBuilding(c.b)).toBe(true);
    expect(useDialogStore.getState().current).toBeNull();
    expect(c.isOpen()).toBe(false);
  });

  it('a draft survives a close and reopening: a new scene', () => {
    c.openNew();
    c.paint(RED);
    c.b.close(); // closed some other way (the crumb, another builder opening)
    expect(readDraft(c.kind, null)).not.toBeNull();
    c.openNew();
    expect(c.isOpen()).toBe(true);
    expect(c.colour()).toEqual(RED);
    expect(c.b.unbuiltEdits()).toBe(true);
    expect(useToastStore.getState().toasts.some(t => /is back/.test(t.title))).toBe(true);
  });

  it('a draft survives a close and reopening: a built scene, one undo from as built', async () => {
    c.openNew();
    await doneBuilding(c.b);
    const id = c.target()!;
    c.reopen(id);
    c.paint(GREEN);
    c.b.close();
    expect(c.builtColour(id)).not.toEqual(GREEN);
    c.reopen(id);
    expect(c.colour()).toEqual(GREEN);
    expect(c.target()).toBe(id);
    // Done builds the restored draft; the draft is gone after.
    expect(await doneBuilding(c.b)).toBe(true);
    expect(c.builtColour(id)).toEqual(GREEN);
    expect(readDraft(c.kind, id)).toBeNull();
  });

  it('the draft is written while editing (a crash keeps it)', async () => {
    vi.useFakeTimers();
    try {
      c.openNew();
      c.paint(RED);
      vi.advanceTimersByTime(1000);
      expect((readDraft(c.kind, null)?.spec as unknown)).toBeTruthy();
      expect(c.isOpen()).toBe(true);
    } finally { vi.useRealTimers(); }
  });
});
