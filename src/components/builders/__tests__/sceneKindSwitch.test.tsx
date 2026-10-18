// @vitest-environment jsdom
/**
 * Switching kind in the Scene builder: a kind picked, back to "What kind of scene?", another kind
 * picked. Only the kind you ended on is in the graph once it is built (the user's report: a Splat
 * scene, back, a Grid scene, Build → the splat was still there). The graph from before the builder
 * opened is left as it was, closing the kind page instead keeps the abandoned scene, editing a
 * scene that was already built never drops it, and undo steps back one thing at a time.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { GraphNode } from '../../../types/nodeGraph';
import { undoManager, useNodeGraphStore } from '../../../store/useNodeGraphStore';
import { openAgentBuilder, useBuilderWindows } from '../../../builders/windows';
import { useSceneBuilder } from '../../../sceneBuilder/store';
import { useSceneBuilder2D } from '../../../sceneBuilder2d/store';
import { useGridBuilder } from '../../../gridScene/store';
import { useSplatBuilder } from '../../../splatBuilder/store';
import { useTimeCubeBuilder } from '../../../timeCubeBuilder/store';
import { useWarpBuilder } from '../../../warpBuilder/store';
import { templateSpec } from '../../../sceneBuilder/templates';
import { buildFromBuilder } from '../../../sceneBuilder/actions';
import { buildFromBuilder2D } from '../../../sceneBuilder2d/actions';
import { buildFromGridBuilder } from '../../../gridScene/actions';
import { makeAgentGroup } from '../../../agentBuilder/actions';
import { START_CARDS } from '../../../agentBuilder/kinds';
import { openBuilder, editBuiltScene } from '../../../builders/open';
import { backToSceneKinds, builtScenes, closeSceneKinds, SCENE_KINDS, type SceneKind } from '../../../builders/sceneKinds';
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

function Shell() {
  const page = useBuilderWindows(s => s.sceneShell);
  return page ? <SceneBuilderShell key={`${page.page}:${page.note ?? ''}:${page.keep ? 1 : 0}`} page={page} /> : null;
}

/** A graph no builder made, there before the Scene builder opened: a UV into the Output. */
const handGraph = (): GraphNode[] => [
  { id: 'uv', type: 'uv', position: { x: 0, y: 0 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } } as GraphNode['outputs'], params: {} },
  { id: 'out', type: 'output', position: { x: 600, y: 0 }, inputs: { color: { type: 'vec4', label: 'Color', connection: { nodeId: 'uv', outputKey: 'uv' } } } as GraphNode['inputs'], outputs: {}, params: {} },
];

/** What "Build" (or picking a card) is in each kind's window; Splat, Time Cube and Grid simulation build on opening. */
async function materialize(kind: SceneKind): Promise<void> {
  if (kind === '2d') act(() => { buildFromBuilder2D(); });
  else if (kind === '3d') {
    act(() => useSceneBuilder.setState({ spec: templateSpec('twisted') }));
    await act(async () => { await buildFromBuilder(); });
  } else if (kind === 'grid') act(() => { buildFromGridBuilder(false, { quiet: true }); });
  else if (kind === 'agents') act(() => { const g = makeAgentGroup(START_CARDS[0], '2d'); openAgentBuilder(g!.groupId); });
}
/** Kinds that leave a scene in the graph without Done (Warp only builds on Done). */
const makesNodes = (k: SceneKind) => k !== 'warp';

beforeEach(() => {
  localStorage.clear();
  undoManager.clear('test');
  useNodeGraphStore.setState({ nodes: handGraph(), activeGroupPath: [], selectedNodeId: null, selectedNodeIds: [] });
  useBuilderWindows.setState({ gridRules: null, agentRules: null, agentBuilder: null, recipe: null, sceneShell: null });
  useSceneBuilder.setState({ open: false, targetSceneId: null });
  useSceneBuilder2D.setState({ open: false, targetSceneId: null });
  useGridBuilder.setState({ open: false, targetSceneId: null });
  useSplatBuilder.setState({ open: false, targetId: null });
  useTimeCubeBuilder.setState({ open: false, targetId: null });
  useWarpBuilder.setState({ open: false });
});
afterEach(() => { act(() => { closeSceneKinds(); useBuilderWindows.setState({ sceneShell: null }); }); });

describe('switching kind on the kind page', () => {
  it('Splat scene → back → Grid scene → Build: only the grid is in the graph', async () => {
    act(() => openBuilder('scenes'));
    mount(<Shell />);
    click($('[data-scene-kind="splat"]'));
    expect(kindsBuilt()).toEqual(['splat']);
    act(() => backToSceneKinds());
    expect($('[data-scene-replaces="splat"]')).toBeTruthy();
    // The clear/keep question is about the graph without the splat: the hand-made UV only.
    expect($('[data-scene-clear]')?.textContent).toContain('1 node');
    click($('[data-scene-kind="grid"]'));
    await materialize('grid');
    expect(kindsBuilt()).toEqual(['grid']);
    expect(nodes().some(n => n.type === 'splatScene')).toBe(false);
    // The graph from before is still there, as it was.
    expect(nodes().find(n => n.id === 'uv')).toEqual(handGraph()[0]);
    // Undo: the grid build, then the dropped splat comes back.
    act(() => closeSceneKinds());
    undo();
    expect(nodes()).toEqual(handGraph());
    undo();
    expect(kindsBuilt()).toEqual(['splat']);
  });

  const kinds = SCENE_KINDS.map(k => k.id);
  const pairs = kinds.flatMap(a => kinds.filter(b => b !== a).map(b => [a, b] as [SceneKind, SceneKind]));
  it.each(pairs)('%s → back → %s: only the second kind is built; the first graph is untouched', async (a, b) => {
    act(() => openBuilder('scenes'));
    mount(<Shell />);
    click($(`[data-scene-kind="${a}"]`));
    await materialize(a);
    if (makesNodes(a)) expect(kindsBuilt()).toEqual([a]);
    act(() => backToSceneKinds());
    click($(`[data-scene-kind="${b}"]`));
    await materialize(b);
    expect(kindsBuilt()).toEqual(makesNodes(b) ? [b] : []);
    expect(nodes().find(n => n.id === 'uv')).toEqual(handGraph()[0]);
    // One build = one undo step: back to the graph from before, the first kind gone.
    act(() => closeSceneKinds());
    if (makesNodes(b)) { undo(); expect(nodes()).toEqual(handGraph()); }
  }, 20_000);

  it('closing the kind page instead keeps the scene', () => {
    act(() => openBuilder('scenes'));
    mount(<Shell />);
    click($('[data-scene-kind="splat"]'));
    act(() => backToSceneKinds());
    act(() => useBuilderWindows.setState({ sceneShell: null }));
    expect(kindsBuilt()).toEqual(['splat']);
    // Opened again later (Add another), picking a kind adds beside it.
    act(() => useBuilderWindows.setState({ sceneShell: { page: 'kinds', keep: true } }));
    click($('[data-scene-kind="timecube"]'));
    expect(kindsBuilt()).toEqual(['splat', 'timecube']);
  });

  it('back from editing a scene already built never drops it', () => {
    act(() => openBuilder('scenes'));
    mount(<Shell />);
    click($('[data-scene-kind="splat"]'));
    act(() => closeSceneKinds());
    const id = builtScenes(nodes())[0].id;
    act(() => { editBuiltScene({ kind: 'splat', id }); });
    act(() => backToSceneKinds());
    expect($('[data-scene-replaces]')).toBeNull();
    click($('[data-scene-kind="timecube"]'));
    expect(kindsBuilt()).toEqual(['splat', 'timecube']);
  });

  it('Done and a later back from a kind opened elsewhere drops nothing', () => {
    act(() => openBuilder('scenes'));
    mount(<Shell />);
    click($('[data-scene-kind="timecube"]'));
    act(() => closeSceneKinds());
    act(() => { openBuilder('scene2d'); });
    act(() => backToSceneKinds());
    click($('[data-scene-kind="grid"]'));
    expect(kindsBuilt()).toEqual(['timecube']);
  });
});
