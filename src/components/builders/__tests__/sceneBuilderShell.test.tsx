// @vitest-environment jsdom
/**
 * The one Scene builder (docs/scene-builder.md):
 *  - its kind page routes each kind to its own builder, and the entry points that open one kind
 *    (the Do… bar, the hidden builder ids) still go straight there;
 *  - clear vs keep on a graph no builder made, and reopening a graph a builder made (Edit this
 *    one / Start over / Add another), for each kind;
 *  - "Scene builder" in a kind's header goes back to the kinds;
 *  - the main preview is held while a builder with its own preview is open;
 *  - the builders' slider: double-click reset, bipolar, the remembered range, the Play menu.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, useEffect, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { GraphNode } from '../../../types/nodeGraph';
import { undoManager, useNodeGraphStore } from '../../../store/useNodeGraphStore';
import { useBuilderWindows } from '../../../builders/windows';
import { useSceneBuilder } from '../../../sceneBuilder/store';
import { useSceneBuilder2D } from '../../../sceneBuilder2d/store';
import { useGridBuilder } from '../../../gridScene/store';
import { useSplatBuilder } from '../../../splatBuilder/store';
import { applySplatScene } from '../../../splatBuilder/apply';
import { starterSplatScene } from '../../../splatBuilder/spec';
import { closeSplatBuilder } from '../../../splatBuilder/actions';
import { useTimeCubeBuilder } from '../../../timeCubeBuilder/store';
import { applyTimeCube } from '../../../timeCubeBuilder/apply';
import { presetSpec } from '../../../timeCubeBuilder/presets';
import { closeTimeCubeBuilder } from '../../../timeCubeBuilder/actions';
import { applyScene } from '../../../sceneBuilder/apply';
import { templateSpec } from '../../../sceneBuilder/templates';
import { applyScene2D } from '../../../sceneBuilder2d/apply';
import { starterScene } from '../../../sceneBuilder2d/spec';
import { makeAgentGroup } from '../../../agentBuilder/actions';
import { START_CARDS } from '../../../agentBuilder/kinds';
import { openBuilder, runBuilderAction, startSceneKind, newGridRules } from '../../../builders/open';
import { builtScenes, builtSceneIds, backToSceneKinds, openSceneKind, selectedBuiltScene, SCENE_KINDS, type SceneKind } from '../../../builders/sceneKinds';
import { builderHoldsPreview, watchBuilderPreview } from '../../../builders/previewPriority';
import { previewHeld } from '../../../lib/previewHold';
import { SceneBuilderShell } from '../SceneBuilderShell';
import { SceneCrumb } from '../SceneCrumb';
import { BuilderSlider } from '../BuilderSlider';
import { resetBuilderSliderRanges } from '../builderSliderRanges';
import { paramPlayItems } from '../paramPlayMenu';
import { buildFromGridBuilder, makeSimulation, backToGridScene, gridSceneOfSimulation } from '../../../gridScene/actions';
import { GridRulesEditor } from '../../gridRules/GridRulesEditor';

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

/** The shell as BuilderWindowsHost draws it. */
function Shell() {
  const page = useBuilderWindows(s => s.sceneShell);
  return page ? <SceneBuilderShell key={`${page.page}:${page.note ?? ''}:${page.keep ? 1 : 0}`} page={page} /> : null;
}

const output = (): GraphNode => ({ id: 'out', type: 'output', position: { x: 600, y: 0 }, inputs: { color: { type: 'vec4', label: 'Color', connection: { nodeId: 'uv', outputKey: 'uv' } } } as GraphNode['inputs'], outputs: {}, params: {} });
/** A small graph no builder made: a UV into the Output. */
const handGraph = (): GraphNode[] => [{ id: 'uv', type: 'uv', position: { x: 0, y: 0 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } } as GraphNode['outputs'], params: {} }, output()];

let n = 0;
const nextId = () => `t${++n}`;
/** A graph with one build of `kind` in it (and the Output). Returns the build's id. */
function buildOf(kind: SceneKind): string {
  useNodeGraphStore.setState({ nodes: [{ ...output(), inputs: { color: { type: 'vec4', label: 'Color' } } as GraphNode['inputs'] }] });
  if (kind === '3d') {
    const r = applyScene(nodes(), templateSpec('twisted'), { nextId });
    useNodeGraphStore.setState({ nodes: r.nodes });
    return r.nodes.find(x => x.type === 'sceneGroup')!.id;
  }
  if (kind === '2d') {
    const r = applyScene2D(nodes(), starterScene(), { nextId, asNew: true });
    useNodeGraphStore.setState({ nodes: r.nodes });
    return r.sceneId;
  }
  if (kind === 'simulation') { const id = newGridRules(); useBuilderWindows.setState({ gridRules: null }); return id; }
  if (kind === 'splat') {
    const r = applySplatScene(nodes(), starterSplatScene(), { nextId });
    useNodeGraphStore.setState({ nodes: r.nodes });
    return r.scanId;
  }
  if (kind === 'timecube') {
    const r = applyTimeCube(nodes(), presetSpec('box'), { nextId });
    useNodeGraphStore.setState({ nodes: r.nodes });
    return r.sourceId;
  }
  return makeAgentGroup(START_CARDS[0], '2d')!.groupId;
}

beforeEach(() => {
  localStorage.clear();
  undoManager.clear('test');
  useNodeGraphStore.setState({ nodes: [], activeGroupPath: [], selectedNodeId: null, selectedNodeIds: [] });
  useBuilderWindows.setState({ gridRules: null, agentRules: null, agentBuilder: null, recipe: null, sceneShell: null });
  useSceneBuilder.setState({ open: false, targetSceneId: null });
  useSceneBuilder2D.setState({ open: false, targetSceneId: null });
  useGridBuilder.setState({ open: false, targetSceneId: null });
  useSplatBuilder.setState({ open: false, targetId: null });
  useTimeCubeBuilder.setState({ open: false, targetId: null });
  resetBuilderSliderRanges();
});

describe('the kind page', () => {
  it('shows the five kinds, each with a picture and a line', () => {
    act(() => openBuilder('scenes'));
    mount(<Shell />);
    expect($('[data-studio-title]')?.textContent).toBe('Scene builder');
    expect($('[data-studio-kind]')?.textContent).toBe('What kind of scene?');
    const cards = [...document.querySelectorAll('[data-scene-kind]')];
    expect(cards.map(c => c.getAttribute('data-scene-kind'))).toEqual(['2d', 'agents', 'grid', 'simulation', '3d', 'splat', 'timecube', 'warp']);
    for (const c of cards) {
      expect(c.querySelector('canvas')).toBeTruthy();
      expect(c.textContent).toContain(SCENE_KINDS.find(k => k.id === c.getAttribute('data-scene-kind'))!.line);
    }
    // An empty graph has nothing to clear: no question.
    expect($('[data-scene-clear]')).toBeNull();
  });

  it.each<[SceneKind, () => boolean]>([
    ['2d', () => useSceneBuilder2D.getState().open && useSceneBuilder2D.getState().targetSceneId === null],
    ['3d', () => useSceneBuilder.getState().open && useSceneBuilder.getState().targetSceneId === null],
    // Grid scene opens the Grid builder (gridScene/); Grid Rules is its "Make it a simulation" jump.
    ['grid', () => useGridBuilder.getState().open && useGridBuilder.getState().targetSceneId === null],
    // Grid simulation opens Grid Rules straight away: a new Grid Rules node, its editor open.
    ['simulation', () => !!useBuilderWindows.getState().gridRules && nodes().some(x => x.id === useBuilderWindows.getState().gridRules && x.type === 'gridRules')],
    ['agents', () => useBuilderWindows.getState().agentBuilder?.groupId === null && useBuilderWindows.getState().agentBuilder?.fromShell === true],
    // A Splat scene is built at once (its picture is the main preview's): the builder opens on the new Splat Scene.
    ['splat', () => useSplatBuilder.getState().open && nodes().some(x => x.id === useSplatBuilder.getState().targetId && x.type === 'splatScene')],
    // A Time Cube is built at once too: the builder opens on the new Time Cube (shown by a Time Cube View).
    ['timecube', () => useTimeCubeBuilder.getState().open && nodes().some(x => x.id === useTimeCubeBuilder.getState().targetId && x.type === 'timeCube') && nodes().some(x => x.type === 'timeCubeView')],
  ])('picking %s turns the window into its builder', (kind, isOpen) => {
    act(() => openBuilder('scenes'));
    mount(<Shell />);
    click($(`[data-scene-kind="${kind}"]`));
    expect(isOpen()).toBe(true);
    expect(useBuilderWindows.getState().sceneShell).toBeNull();
    expect(openSceneKind()).toBe(kind);
  });
});

describe('Grid simulation: its own kind, and the jumps to and from a Grid scene', () => {
  const rulesWindow = () => {
    const id = useBuilderWindows.getState().gridRules!;
    return mount(<GridRulesEditor nodeId={id} onClose={() => {}} />);
  };
  it('the kind page opens Grid Rules directly; its header names the kind', () => {
    useNodeGraphStore.setState({ nodes: [output()] });
    act(() => openBuilder('scenes'));
    mount(<Shell />);
    click($('[data-scene-kind="simulation"]'));
    expect(useGridBuilder.getState().open).toBe(false);
    expect(openSceneKind()).toBe('simulation');
    const id = useBuilderWindows.getState().gridRules!;
    expect(builtScenes(nodes()).map(b => [b.kind, b.id])).toEqual([['simulation', id]]);
    rulesWindow();
    expect($('[data-scene-crumb="simulation"] [data-scene-crumb-kind]')?.textContent).toBe('Grid simulation');
    // Nothing drawn to go back to.
    expect($('[data-grid-back]')).toBeNull();
    act(() => useBuilderWindows.setState({ gridRules: null }));
  });
  it('a Grid scene still jumps to its simulation ("Make it a simulation") and back ("Pattern grid")', () => {
    useNodeGraphStore.setState({ nodes: [{ ...output(), inputs: { color: { type: 'vec4', label: 'Color' } } as GraphNode['inputs'] }] });
    act(() => startSceneKind('grid'));
    act(() => { buildFromGridBuilder(false, { quiet: true }); });
    let simId: string | null = null;
    act(() => { simId = makeSimulation(); });
    expect(simId).toBeTruthy();
    expect(useBuilderWindows.getState().gridRules).toBe(simId);
    expect(gridSceneOfSimulation(nodes(), simId!)).toBeTruthy();
    rulesWindow();
    expect($('[data-scene-crumb="grid"]')?.textContent).toContain('Simulation');
    expect($('[data-grid-back]')).toBeTruthy();
    act(() => { expect(backToGridScene(simId!)).toBe(true); });
    expect(useGridBuilder.getState().open).toBe(true);
    expect(useBuilderWindows.getState().gridRules).toBeNull();
    act(() => useGridBuilder.getState().close());
  });
});

describe('entry points that open one kind go straight to it', () => {
  it('the Do… bar and the hidden builder ids open their kind, not the kind page', () => {
    runBuilderAction({ kind: 'new-scene2d' });
    expect(useSceneBuilder2D.getState().open).toBe(true);
    expect(useBuilderWindows.getState().sceneShell).toBeNull();
    useSceneBuilder2D.getState().close();
    runBuilderAction({ kind: 'new-scene' });
    expect(useSceneBuilder.getState().open).toBe(true);
    useSceneBuilder.getState().close();
    runBuilderAction({ kind: 'new-agents' });
    expect(useBuilderWindows.getState().agentBuilder).toEqual({ groupId: null });
    openBuilder('grid');
    expect(useBuilderWindows.getState().gridRules).toBeTruthy();
    expect(useBuilderWindows.getState().sceneShell).toBeNull();
  });
  it('startSceneKind (what the kind page calls) closes the kind page first', () => {
    useBuilderWindows.setState({ sceneShell: { page: 'kinds' } });
    startSceneKind('3d');
    expect(useBuilderWindows.getState().sceneShell).toBeNull();
    expect(useSceneBuilder.getState().open).toBe(true);
  });
});

describe('a graph no builder made: clear by default, or keep it', () => {
  it.each<SceneKind>(['2d', 'agents', 'grid', 'simulation', '3d', 'splat', 'timecube'])('%s: Clear and start over is the default; the clear is an undo step of its own', kind => {
    useNodeGraphStore.setState({ nodes: handGraph() });
    act(() => openBuilder('scenes'));
    expect(useBuilderWindows.getState().sceneShell).toEqual({ page: 'kinds' });
    mount(<Shell />);
    expect($('[data-scene-clear]')?.getAttribute('data-scene-clear')).toBe('clear');
    expect($('[data-scene-clear]')?.textContent).toContain('Your graph has 1 node');
    click($(`[data-scene-kind="${kind}"]`));
    expect(nodes().some(x => x.id === 'uv')).toBe(false);
    expect(nodes().some(x => x.id === 'out')).toBe(true);
    // Undo steps back through what the kind made (if anything) and then the clear.
    for (let i = 0; i < 3 && !nodes().some(x => x.id === 'uv'); i++) undo();
    expect(nodes().map(x => x.id).sort()).toEqual(['out', 'uv']);
  });
  it.each<SceneKind>(['2d', 'agents', 'grid', 'simulation', '3d', 'splat', 'timecube'])('%s: Keep my graph keeps it', kind => {
    useNodeGraphStore.setState({ nodes: handGraph() });
    act(() => openBuilder('scenes'));
    mount(<Shell />);
    click($('[aria-label="Clear the current graph first?"] button:last-child'));
    expect($('[data-scene-clear]')?.getAttribute('data-scene-clear')).toBe('keep');
    click($(`[data-scene-kind="${kind}"]`));
    expect(nodes().some(x => x.id === 'uv')).toBe(true);
  });
});

describe('a graph a builder made: reopen it as it was built', () => {
  it.each<SceneKind>(['2d', 'agents', 'simulation', '3d', 'splat', 'timecube'])('%s: found, and Edit this one opens its builder on the build', kind => {
    const id = buildOf(kind);
    expect(builtScenes(nodes()).map(b => [b.kind, b.id])).toEqual([[kind, id]]);
    act(() => openBuilder('scenes'));
    expect(useBuilderWindows.getState().sceneShell).toEqual({ page: 'existing' });
    mount(<Shell />);
    expect($(`[data-existing-scene="${id}"]`)?.getAttribute('data-existing-kind')).toBe(kind);
    click($('[data-existing-edit]'));
    expect(useBuilderWindows.getState().sceneShell).toBeNull();
    if (kind === '3d') {
      expect(useSceneBuilder.getState().open).toBe(true);
      expect(useSceneBuilder.getState().targetSceneId).toBe(id);
      expect(useSceneBuilder.getState().spec).toEqual(templateSpec('twisted'));
    } else if (kind === '2d') {
      expect(useSceneBuilder2D.getState().open).toBe(true);
      expect(useSceneBuilder2D.getState().targetSceneId).toBe(id);
      expect(useSceneBuilder2D.getState().scene).toEqual(starterScene());
    } else if (kind === 'simulation') {
      expect(useBuilderWindows.getState().gridRules).toBe(id);
    } else if (kind === 'splat') {
      expect(useSplatBuilder.getState().open).toBe(true);
      expect(useSplatBuilder.getState().targetId).toBe(id);
      expect(useSplatBuilder.getState().spec).toEqual(starterSplatScene());
      closeSplatBuilder();
    } else if (kind === 'timecube') {
      expect(useTimeCubeBuilder.getState().open).toBe(true);
      expect(useTimeCubeBuilder.getState().targetId).toBe(id);
      expect(useTimeCubeBuilder.getState().spec).toEqual(presetSpec('box'));
      closeTimeCubeBuilder();
    } else {
      expect(useBuilderWindows.getState().agentBuilder).toEqual({ groupId: id });
    }
  });
  it.each<SceneKind>(['2d', 'agents', 'simulation', '3d', 'splat', 'timecube'])('%s: Start over takes the build away (one undo step), then the kinds', kind => {
    const id = buildOf(kind);
    const before = nodes().map(x => x.id).sort();
    act(() => openBuilder('scenes'));
    mount(<Shell />);
    click($('[data-existing-over]'));
    expect(nodes().some(x => x.id === id)).toBe(false);
    expect(nodes().map(x => x.type)).toEqual(['output']);
    expect(useBuilderWindows.getState().sceneShell?.page).toBe('kinds');
    expect($('[data-scene-note]')?.textContent).toContain('Started over');
    undo();
    expect(nodes().map(x => x.id).sort()).toEqual(before);
  });
  it.each<SceneKind>(['2d', 'agents', 'simulation', '3d', 'splat', 'timecube'])('%s: Add another goes to the kinds, keeping the graph', kind => {
    const id = buildOf(kind);
    act(() => openBuilder('scenes'));
    mount(<Shell />);
    click($('[data-existing-add]'));
    expect(useBuilderWindows.getState().sceneShell).toEqual({ page: 'kinds', keep: true });
    expect($('[data-scene-clear]')?.getAttribute('data-scene-clear')).toBe('keep');
    click($('[data-scene-kind="2d"]'));
    expect(nodes().some(x => x.id === id)).toBe(true);
  });
  it('a selected node of a build picks that build first', () => {
    const id = buildOf('3d');
    const g = applyScene2D(nodes(), starterScene(), { nextId, asNew: true });
    useNodeGraphStore.setState({ nodes: g.nodes });
    expect(builtScenes(nodes()).map(b => b.kind)).toEqual(['2d', '3d']);
    expect(selectedBuiltScene(nodes(), [g.sceneId])?.kind).toBe('2d');
    expect(selectedBuiltScene(nodes(), [id])?.kind).toBe('3d');
    useNodeGraphStore.setState({ selectedNodeId: id, selectedNodeIds: [id] });
    act(() => openBuilder('scenes'));
    mount(<Shell />);
    expect($('[data-existing-scene][aria-checked="true"]')?.getAttribute('data-existing-scene')).toBe(id);
  });
  it('Start over never takes the Output, nor nodes outside the build', () => {
    const id = buildOf('2d');
    const extra: GraphNode = { id: 'lonely', type: 'uv', position: { x: -500, y: 0 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } } as GraphNode['outputs'], params: {} };
    useNodeGraphStore.setState({ nodes: [...nodes(), extra] });
    const gone = builtSceneIds(nodes(), { kind: '2d', id });
    expect(gone.has('out')).toBe(false);
    expect(gone.has('lonely')).toBe(false);
    expect(gone.has(id)).toBe(true);
  });
});

describe('finding your way', () => {
  it('"Scene builder" in a kind\'s header goes back to the kinds; what was built stays (keep by default)', () => {
    buildOf('3d');
    useSceneBuilder.getState().openWith(templateSpec('twisted'));
    mount(<><SceneCrumb kind="3d" /><Shell /></>);
    expect($('[data-scene-crumb-kind]')?.textContent).toBe('3D scene');
    click($('[data-scene-crumb-back]'));
    expect(useSceneBuilder.getState().open).toBe(false);
    expect(useBuilderWindows.getState().sceneShell).toEqual({ page: 'kinds', keep: true });
    expect($('[data-scene-clear]')?.getAttribute('data-scene-clear')).toBe('keep');
  });
  it('back from a kind on a graph no builder made clears by default again', () => {
    useNodeGraphStore.setState({ nodes: handGraph() });
    useBuilderWindows.setState({ agentBuilder: { groupId: null, fromShell: true } });
    act(() => backToSceneKinds());
    expect(useBuilderWindows.getState().agentBuilder).toBeNull();
    expect(useBuilderWindows.getState().sceneShell).toEqual({ page: 'kinds', keep: false });
  });
});

describe('the builder preview comes first', () => {
  it('holds the main preview while the kind page, the 2D or 3D Scene Builder or Grid Rules is open; never for the Agent Builder', () => {
    const stop = watchBuilderPreview();
    expect(previewHeld()).toBe(false);
    act(() => openBuilder('scenes'));
    expect(previewHeld()).toBe(true);
    startSceneKind('3d');
    expect(previewHeld()).toBe(true);
    useSceneBuilder.getState().close();
    expect(previewHeld()).toBe(false);
    useSceneBuilder2D.getState().openWith(starterScene());
    expect(previewHeld()).toBe(true);
    useSceneBuilder2D.getState().close();
    useBuilderWindows.setState({ gridRules: 'g1' });
    expect(builderHoldsPreview()).toBe(true);
    expect(previewHeld()).toBe(true);
    useBuilderWindows.setState({ gridRules: null });
    // The Agent Builder's picture is the main preview, mirrored: never held.
    startSceneKind('agents', { fromShell: true });
    expect(previewHeld()).toBe(false);
    useSceneBuilder.getState().openWith(templateSpec('twisted'));
    stop();
    // Stopping lets go of the hold it had.
    expect(previewHeld()).toBe(false);
    useSceneBuilder.getState().close();
  });
});

describe('the builders\' slider', () => {
  const track = (host: HTMLElement) => host.querySelector('[role="slider"]') as HTMLElement;
  const dbl = (el: Element) => act(() => { el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); });
  it('double-click resets to the default', () => {
    const got: number[] = [];
    const host = mount(<BuilderSlider ariaLabel="Distance" value={7} min={0.3} max={20} defaultValue={4} onChange={v => got.push(v)} />);
    dbl(track(host));
    expect(got).toEqual([4]);
  });
  it('without a default, double-click goes back to the value it came into view with', () => {
    const got: number[] = [];
    const handle: { set: (v: number) => void } = { set: () => {} };
    function Live() {
      const [v, setV] = useState(0.5);
      useEffect(() => { handle.set = setV; }, []);
      return <BuilderSlider ariaLabel="Speed" value={v} min={0} max={1} onChange={x => { got.push(x); setV(x); }} />;
    }
    const host = mount(<Live />);
    act(() => handle.set(0.9));
    dbl(track(host));
    expect(got).toEqual([0.5]);
  });
  it('a range symmetric about zero is bipolar (zero marked, the stretch tinted); a one-way range is not', () => {
    const sym = mount(<BuilderSlider ariaLabel="Speed" value={1} min={-2} max={2} onChange={() => {}} />);
    expect(sym.querySelector('[data-ruler-bipolar]')).toBeTruthy();
    expect(sym.querySelector('[data-ruler-zero]')).toBeTruthy();
    const one = mount(<BuilderSlider ariaLabel="Scale" value={1} min={0.05} max={4} onChange={() => {}} />);
    expect(one.querySelector('[data-ruler-bipolar]')).toBeNull();
  });
  it('a real node param gets the Play menu: Add to Play controls, then Remove', () => {
    useNodeGraphStore.setState({ nodes: [{ id: 'c1', type: 'circleSDF', position: { x: 0, y: 0 }, inputs: {}, outputs: {}, params: { radius: 0.3 } }], paramBindings: { 'c1::radius': 'u_c1_radius' } });
    const add = paramPlayItems('c1', 'radius');
    const item = add.find(i => typeof i === 'object' && 'label' in i && i.label === 'Add to Play controls');
    expect(item).toBeTruthy();
    act(() => (item as { onSelect: () => void }).onSelect());
    expect(useNodeGraphStore.getState().play.controls.some(c => c.target === 'c1::radius')).toBe(true);
    const again = paramPlayItems('c1', 'radius');
    expect(again.some(i => typeof i === 'object' && 'label' in i && i.label === 'Remove from Play controls')).toBe(true);
    const host = mount(<BuilderSlider ariaLabel="Radius" value={0.3} min={0} max={1} onChange={() => {}} param={{ nodeId: 'c1', key: 'radius' }} />);
    act(() => { host.querySelector('[data-builder-param]')!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 10, clientY: 10 })); });
    expect(document.body.textContent).toContain('Remove from Play controls');
  });
});

