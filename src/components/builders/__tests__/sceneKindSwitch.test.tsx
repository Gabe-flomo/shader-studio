// @vitest-environment jsdom
/**
 * The Scene builder works on a draft (builders/sceneDraft.ts): a scene is only added to the graph when you press Done.
 * The user's report: a 2D scene, back without saving, a 3D scene, Done → both were in the graph. Now, for every kind:
 * picking it, editing, Apply, back to the kinds, closing with × or Esc leave the graph exactly as it was (deep-equal)
 * with no new undo steps; Done adds exactly one scene as one undo step; editing a built scene and Done replaces it in
 * place; the "Discard this scene?" confirm only comes up when something changed.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { GraphNode } from '../../../types/nodeGraph';
import { undoManager, useNodeGraphStore } from '../../../store/useNodeGraphStore';
import { closeAgentBuilder, closeGridRulesEditor, useBuilderWindows } from '../../../builders/windows';
import { useSceneBuilder } from '../../../sceneBuilder/store';
import { useSceneBuilder2D } from '../../../sceneBuilder2d/store';
import { useGridBuilder } from '../../../gridScene/store';
import { useSplatBuilder } from '../../../splatBuilder/store';
import { useTimeCubeBuilder } from '../../../timeCubeBuilder/store';
import { useWarpBuilder } from '../../../warpBuilder/store';
import { templateSpec } from '../../../sceneBuilder/templates';
import { buildFromBuilder } from '../../../sceneBuilder/actions';
import { buildFromBuilder2D, scene2dBuilder } from '../../../sceneBuilder2d/actions';
import { buildFromGridBuilder, finishGridBuilder } from '../../../gridScene/actions';
import { finishSplatBuilder, syncSplatBuilder } from '../../../splatBuilder/actions';
import { finishTimeCubeBuilder, syncTimeCubeBuilder } from '../../../timeCubeBuilder/actions';
import { finishWarpBuilder } from '../../../warpBuilder/actions';
import { makeAgentGroup } from '../../../agentBuilder/actions';
import { START_CARDS } from '../../../agentBuilder/kinds';
import { openAgentBuilder } from '../../../builders/windows';
import { doneBuilding, finishBuilder } from '../../../builders/finish';
import { openBuilder, editBuiltScene } from '../../../builders/open';
import { backToSceneKinds, builtScenes, closeSceneKinds, SCENE_KINDS, type SceneKind } from '../../../builders/sceneKinds';
import { closeSceneWindow, forgetSceneDraft, sceneDraftOpen } from '../../../builders/sceneDraft';
import { useDialogStore } from '../../ui/dialogStore';
import { scene3dBuilder } from '../../sceneBuilder/SceneBuilderModal';
import { SceneBuilderShell } from '../SceneBuilderShell';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext'];

const mounted: Array<{ root: Root; host: HTMLElement }> = [];
function mount(ui: React.ReactElement) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(ui));
  mounted.push({ root, host });
  return host;
}
afterEach(() => { for (const m of mounted.splice(0)) { act(() => m.root.unmount()); m.host.remove(); } });
const $ = (sel: string) => document.body.querySelector(sel);
const click = (el: Element | null) => { expect(el).toBeTruthy(); act(() => { (el as HTMLElement).click(); }); };
const nodes = () => useNodeGraphStore.getState().nodes;
const undo = () => act(() => { useNodeGraphStore.getState().undo(); });
const kindsBuilt = () => builtScenes(nodes()).map(b => b.kind).sort();
const undoIds = () => ({ done: undoManager.done().map(e => e.id), undone: undoManager.undone().map(e => e.id) });
/** Let the window watch's microtask run. */
const settle = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

function Shell() {
  const page = useBuilderWindows(s => s.sceneShell);
  return page ? <SceneBuilderShell key={`${page.page}:${page.note ?? ''}:${page.keep ? 1 : 0}`} page={page} /> : null;
}

/** A graph no builder made, there before the Scene builder opened: a UV into the Output. */
const handGraph = (): GraphNode[] => [
  { id: 'uv', type: 'uv', position: { x: 0, y: 0 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } } as GraphNode['outputs'], params: {} },
  { id: 'out', type: 'output', position: { x: 600, y: 0 }, inputs: { color: { type: 'vec4', label: 'Color', connection: { nodeId: 'uv', outputKey: 'uv' } } } as GraphNode['inputs'], outputs: {}, params: {} },
];

/** An edit in each kind's window, then its Apply (the builders that write as you edit write here). */
async function editAndApply(kind: SceneKind, seed = 3): Promise<void> {
  if (kind === '2d') act(() => { useSceneBuilder2D.getState().surprise(seed); buildFromBuilder2D(); });
  else if (kind === '3d') {
    act(() => useSceneBuilder.getState().replace(templateSpec('twisted')));
    if (seed !== 3) act(() => useSceneBuilder.getState().edit(sp => { sp.camera = { ...sp.camera, dist: sp.camera.dist + seed }; }));
    await act(async () => { await buildFromBuilder(); });
  } else if (kind === 'grid') act(() => { useGridBuilder.getState().surprise(seed); buildFromGridBuilder(false, { quiet: true }); });
  else if (kind === 'splat') act(() => { useSplatBuilder.getState().surprise(seed); syncSplatBuilder(); });
  else if (kind === 'timecube') act(() => { useTimeCubeBuilder.getState().surprise(seed); syncTimeCubeBuilder(); });
  else if (kind === 'warp') act(() => { useWarpBuilder.getState().surprise(seed); });
  else if (kind === 'agents') act(() => { const g = makeAgentGroup(START_CARDS[0], '2d'); openAgentBuilder(g!.groupId, { fromShell: true }); });
  else if (kind === 'simulation') {
    const id = useBuilderWindows.getState().gridRules!;
    act(() => useNodeGraphStore.getState().updateNodeParams(id, { label: 'My rules' }));
  }
}

/** Each kind's Done. */
async function done(kind: SceneKind): Promise<void> {
  if (kind === '2d') await act(async () => { await doneBuilding(scene2dBuilder); });
  else if (kind === '3d') await act(async () => { await doneBuilding(scene3dBuilder); });
  else if (kind === 'grid') await act(async () => { await finishGridBuilder(); });
  else if (kind === 'splat') act(() => finishSplatBuilder());
  else if (kind === 'timecube') act(() => finishTimeCubeBuilder());
  else if (kind === 'warp') act(() => finishWarpBuilder());
  else if (kind === 'agents') act(() => finishBuilder(closeAgentBuilder));
  else act(() => finishBuilder(closeGridRulesEditor));
}

/** What Done leaves in the graph for each kind (the Warp builder builds a small 2D scene). */
const madeKind = (k: SceneKind): SceneKind => (k === 'warp' ? '2d' : k);

/** Answer the open "Discard this scene?" (failing when there is none). */
async function answer(id: 'discard' | 'keep'): Promise<void> {
  const cur = useDialogStore.getState().current;
  expect(cur?.kind).toBe('choice');
  expect((cur as { title: string }).title).toBe('Discard this scene?');
  await act(async () => { (cur as { resolve: (v: string) => void }).resolve(id); useDialogStore.setState({ current: null }); await Promise.resolve(); });
}

beforeEach(() => {
  localStorage.clear();
  forgetSceneDraft();
  useDialogStore.setState({ current: null });
  useBuilderWindows.setState({ gridRules: null, agentRules: null, agentBuilder: null, recipe: null, sceneShell: null });
  useSceneBuilder.setState({ open: false, targetSceneId: null });
  useSceneBuilder2D.setState({ open: false, targetSceneId: null });
  useGridBuilder.setState({ open: false, targetSceneId: null });
  useSplatBuilder.setState({ open: false, targetId: null });
  useTimeCubeBuilder.setState({ open: false, targetId: null });
  useWarpBuilder.setState({ open: false });
  forgetSceneDraft();
  useNodeGraphStore.setState({ nodes: handGraph(), activeGroupPath: [], selectedNodeId: null, selectedNodeIds: [] });
  undoManager.clear('test');
  // One step of the user's own, so "the undo stack is unchanged" means something.
  undoManager.push(handGraph(), { label: 'Earlier edit' });
});
afterEach(() => { act(() => { closeSceneKinds(); useBuilderWindows.setState({ sceneShell: null }); }); forgetSceneDraft(); });

// Combine builds nothing of its own until a layer is added: its session is covered in src/combine/__tests__/combineSession.test.ts.
const kinds = SCENE_KINDS.map(k => k.id).filter(k => k !== 'combine');

describe('nothing is in the graph until Done', () => {
  it.each(kinds)('%s: pick, edit, Apply, back, pick again, ×: the graph and the undo stack are as they were', async kind => {
    const before = structuredClone(nodes());
    const steps = undoIds();
    act(() => openBuilder('scenes'));
    mount(<Shell />);
    click($(`[data-scene-kind="${kind}"]`));
    await editAndApply(kind);
    // Back: there were changes, so it asks first.
    let back: Promise<boolean> | null = null;
    act(() => { back = backToSceneKinds(); });
    await answer('discard');
    expect(await back).toBe(true);
    await settle();
    expect(nodes()).toEqual(before);
    expect(undoIds()).toEqual(steps);
    expect($('[data-scene-kinds]')).toBeTruthy();
    expect(sceneDraftOpen()).toBe(true);
    // The same kind again, then × with changes: Discard.
    click($(`[data-scene-kind="${kind}"]`));
    await editAndApply(kind);
    let closed: Promise<boolean> | null = null;
    act(() => { closed = closeSceneWindow(closeSceneKinds); });
    await answer('discard');
    expect(await closed).toBe(true);
    await settle();
    expect(nodes()).toEqual(before);
    expect(undoIds()).toEqual(steps);
    expect(sceneDraftOpen()).toBe(false);
  }, 20_000);

  it.each(kinds)('%s: Done adds exactly one scene, as one undo step', async kind => {
    const before = structuredClone(nodes());
    const steps = undoIds();
    act(() => openBuilder('scenes'));
    mount(<Shell />);
    click($(`[data-scene-kind="${kind}"]`));
    await editAndApply(kind);
    await done(kind);
    await settle();
    expect(kindsBuilt()).toEqual([madeKind(kind)]);
    expect(undoIds().done).toEqual([...steps.done, undoManager.top()!.id]);
    expect(undoManager.top()!.label).toBe(`Scene builder: ${SCENE_KINDS.find(k => k.id === kind)!.title}`);
    // The graph from before is still there.
    expect(nodes().find(n => n.id === 'uv')).toEqual(before[0]);
    undo();
    expect(nodes()).toEqual(before);
    expect(sceneDraftOpen()).toBe(false);
  }, 20_000);

  const pairs = kinds.flatMap(a => kinds.filter(b => b !== a).map(b => [a, b] as [SceneKind, SceneKind]));
  it.each(pairs)('%s → back → %s → Done: only the second kind is in the graph, one undo step', async (a, b) => {
    const before = structuredClone(nodes());
    const steps = undoIds();
    act(() => openBuilder('scenes'));
    mount(<Shell />);
    click($(`[data-scene-kind="${a}"]`));
    await editAndApply(a);
    let back: Promise<boolean> | null = null;
    act(() => { back = backToSceneKinds(); });
    await answer('discard');
    await back;
    click($(`[data-scene-kind="${b}"]`));
    await editAndApply(b);
    await done(b);
    await settle();
    expect(kindsBuilt()).toEqual([madeKind(b)]);
    expect(undoIds().done.length).toBe(steps.done.length + 1);
    undo();
    expect(nodes()).toEqual(before);
  }, 20_000);
});

describe("the user's flow", () => {
  it('2D, edit, back, 3D, Done: only the 3D scene', async () => {
    act(() => openBuilder('scenes'));
    mount(<Shell />);
    click($('[data-scene-kind="2d"]'));
    await editAndApply('2d');
    expect(kindsBuilt()).toEqual(['2d']);  // the draft has it…
    let back: Promise<boolean> | null = null;
    act(() => { back = backToSceneKinds(); });
    await answer('discard');
    await back;
    expect(kindsBuilt()).toEqual([]);      // …and back drops it
    click($('[data-scene-kind="3d"]'));
    await editAndApply('3d');
    await done('3d');
    expect(kindsBuilt()).toEqual(['3d']);
  });

  it('2D, edit, close without Done: the graph is unchanged', async () => {
    const before = structuredClone(nodes());
    act(() => openBuilder('scenes'));
    mount(<Shell />);
    click($('[data-scene-kind="2d"]'));
    act(() => { useSceneBuilder2D.getState().surprise(5); });
    let closed: Promise<boolean> | null = null;
    act(() => { closed = closeSceneWindow(closeSceneKinds); });
    await answer('discard');
    await closed;
    await settle();
    expect(nodes()).toEqual(before);
    expect(useSceneBuilder2D.getState().open).toBe(false);
  });
});

describe('the discard confirm', () => {
  it('only asks when something changed; Keep editing keeps the window and the draft', async () => {
    const before = structuredClone(nodes());
    act(() => openBuilder('scenes'));
    mount(<Shell />);
    click($('[data-scene-kind="splat"]'));   // built as it opens: not a change of yours
    let closed: Promise<boolean> | null = null;
    act(() => { closed = closeSceneWindow(closeSceneKinds); });
    expect(useDialogStore.getState().current).toBeNull();
    expect(await closed).toBe(true);
    await settle();
    expect(nodes()).toEqual(before);

    act(() => openBuilder('scenes'));
    click($('[data-scene-kind="2d"]'));
    // Back with no changes: no question.
    let back: Promise<boolean> | null = null;
    act(() => { back = backToSceneKinds(); });
    expect(useDialogStore.getState().current).toBeNull();
    expect(await back).toBe(true);
    click($('[data-scene-kind="2d"]'));
    await editAndApply('2d');
    act(() => { closed = closeSceneWindow(closeSceneKinds); });
    await answer('keep');
    expect(await closed).toBe(false);
    expect(useSceneBuilder2D.getState().open).toBe(true);
    expect(kindsBuilt()).toEqual(['2d']);
    await done('2d');
    expect(kindsBuilt()).toEqual(['2d']);
  });

  it('the kind page × closes without asking and leaves the graph as it was', async () => {
    const before = structuredClone(nodes());
    const steps = undoIds();
    act(() => openBuilder('scenes'));
    mount(<Shell />);
    click($('[data-studio-close]'));
    await settle();
    expect(useDialogStore.getState().current).toBeNull();
    expect(useBuilderWindows.getState().sceneShell).toBeNull();
    expect(nodes()).toEqual(before);
    expect(undoIds()).toEqual(steps);
    expect(sceneDraftOpen()).toBe(false);
  });
});

describe('editing a built scene', () => {
  it.each(['2d', '3d', 'grid', 'splat', 'timecube'] as SceneKind[])('%s: Edit this one, change, Done: replaced in place, one undo step; × instead: as it was', async kind => {
    act(() => openBuilder('scenes'));
    mount(<Shell />);
    click($(`[data-scene-kind="${kind}"]`));
    await editAndApply(kind);
    await done(kind);
    const built = builtScenes(nodes());
    expect(built.map(b => b.kind)).toEqual([kind]);
    const withScene = structuredClone(nodes());
    const steps = undoIds();

    // × without Done: as it was.
    act(() => { editBuiltScene(built[0]); });
    await editAndApply(kind, 7);
    let closed: Promise<boolean> | null = null;
    act(() => { closed = closeSceneWindow(closeSceneKinds); });
    await answer('discard');
    await closed;
    await settle();
    expect(nodes()).toEqual(withScene);
    expect(undoIds()).toEqual(steps);

    // Done: the same scene (same id), changed, one step.
    act(() => { editBuiltScene(built[0]); });
    if (kind === '2d') act(() => { useSceneBuilder2D.getState().surprise(11); });
    else if (kind === '3d') act(() => useSceneBuilder.getState().edit(sp => { sp.camera = { ...sp.camera, dist: sp.camera.dist + 1 }; }));
    else if (kind === 'grid') act(() => { useGridBuilder.getState().surprise(11); });
    else if (kind === 'splat') act(() => { useSplatBuilder.getState().surprise(11); syncSplatBuilder(); });
    else act(() => { useTimeCubeBuilder.getState().surprise(11); syncTimeCubeBuilder(); });
    await done(kind);
    const after = builtScenes(nodes());
    expect(after.map(b => b.kind)).toEqual([kind]);
    expect(after[0].id).toBe(built[0].id);
    expect(undoIds().done.length).toBe(steps.done.length + 1);
    undo();
    expect(nodes()).toEqual(withScene);
  }, 20_000);
});

describe('Start over', () => {
  it('back from the next kind keeps the scene gone; closing without Done brings it back', async () => {
    act(() => openBuilder('scenes'));
    mount(<Shell />);
    click($('[data-scene-kind="splat"]'));
    await done('splat');
    const withSplat = structuredClone(nodes());
    act(() => openBuilder('scenes'));
    expect($('[data-scene-existing]')).toBeTruthy();
    click($('[data-existing-over]'));
    expect(kindsBuilt()).toEqual([]);
    click($('[data-scene-kind="2d"]'));
    await editAndApply('2d');
    let back: Promise<boolean> | null = null;
    act(() => { back = backToSceneKinds(); });
    await answer('discard');
    await back;
    expect(kindsBuilt()).toEqual([]);
    act(() => { void closeSceneWindow(() => useBuilderWindows.setState({ sceneShell: null })); });
    await settle();
    expect(nodes()).toEqual(withSplat);
  });
});
