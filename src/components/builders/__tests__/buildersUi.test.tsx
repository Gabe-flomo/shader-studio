// @vitest-environment jsdom
/**
 * The Builders section and the Recipe chip as drawn: each entry opens its builder, the section
 * folds and remembers it, a search shows only the builders it finds; the chip shows a built
 * scene's recipe (collapsed, then whole with Copy and Open in Scene Builder), says "edited since
 * build", and isn't there on a hand-made Scene Group.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  const m = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); },
    key: () => null, get length() { return m.size; }, clear: () => m.clear(),
  });
});

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { GraphNode } from '../../../types/nodeGraph';
import { useNodeGraphStore } from '../../../store/useNodeGraphStore';
import { useSceneBuilder } from '../../../sceneBuilder/store';
import { applyScene } from '../../../sceneBuilder/apply';
import { ROLE_KEY } from '../../../sceneBuilder/build';
import { printRecipe } from '../../../sceneBuilder/recipe';
import { templateSpec } from '../../../sceneBuilder/templates';
import { useBuilderWindows, showRecipeOf } from '../../../builders/windows';
import { BuildersSection } from '../BuildersSection';
import { useBuildersFold } from '../../../builders/fold';
import { RecipeChip } from '../RecipeChip';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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
const click = (el: Element | null) => { expect(el).toBeTruthy(); act(() => { (el as HTMLElement).click(); }); };

beforeEach(() => {
  useNodeGraphStore.setState({ nodes: [], activeGroupPath: [], selectedNodeId: null, selectedNodeIds: [] });
  useBuilderWindows.setState({ gridRules: null, agentRules: null, recipe: null });
  useSceneBuilder.setState({ open: false, targetSceneId: null });
  if (useBuildersFold.getState().folded) useBuildersFold.getState().toggle();
});

describe('BuildersSection', () => {
  it('shows the three builders, each opening its own', () => {
    const opened = vi.fn();
    const host = mount(<BuildersSection onOpened={opened} />);
    expect([...host.querySelectorAll('[data-builder]')].map(b => b.getAttribute('data-builder'))).toEqual(['scene', 'grid', 'agents']);
    expect(host.textContent).toContain('shapes, combine, bend space, look, outputs');
    expect(host.textContent).toContain('Life, sand, heat, waves, Wireworld…');
    expect(host.textContent).toContain('slime, ants, flocks, infection…');

    click(host.querySelector('[data-builder="scene"]'));
    expect(useSceneBuilder.getState().open).toBe(true);
    expect(useSceneBuilder.getState().targetSceneId).toBeNull();

    click(host.querySelector('[data-builder="grid"]'));
    const g = useNodeGraphStore.getState().nodes.find(n => n.type === 'gridRules');
    expect(useBuilderWindows.getState().gridRules).toBe(g?.id);

    click(host.querySelector('[data-builder="agents"]'));
    const a = useNodeGraphStore.getState().nodes.find(n => n.type === 'agentsGroup');
    expect(a?.params.ruleMode).toBe('rules');
    expect(useBuilderWindows.getState().agentRules).toBe(a?.id);
    expect(opened).toHaveBeenCalledTimes(3);
  });
  it('folds, and remembers it', () => {
    const host = mount(<BuildersSection />);
    click(host.querySelector('[data-builders-toggle]'));
    expect(host.querySelectorAll('[data-builder]')).toHaveLength(0);
    expect(localStorage.getItem('nodeBrowser.buildersFolded')).toBe('1');
    click(host.querySelector('[data-builders-toggle]'));
    expect(host.querySelectorAll('[data-builder]')).toHaveLength(3);
    expect(localStorage.getItem('nodeBrowser.buildersFolded')).toBe('0');
  });
  it('while searching: only the builders found, unfolded; nothing when none', () => {
    act(() => useBuildersFold.getState().toggle());
    const host = mount(<BuildersSection query="rules" />);
    expect([...host.querySelectorAll('[data-builder]')].map(b => b.getAttribute('data-builder'))).toEqual(['grid', 'agents']);
    const none = mount(<BuildersSection query="voronoi" />);
    expect(none.querySelector('[data-builders-section]')).toBeNull();
  });
});

describe('RecipeChip', () => {
  const built = () => applyScene([], templateSpec('twisted'), { nextId: (() => { let i = 0; return () => `n${++i}`; })() }).nodes;
  it('shows a built scene\'s recipe, then the whole of it with Copy and Open in Scene Builder', () => {
    const graph = built();
    useNodeGraphStore.setState({ nodes: graph });
    const scene = graph.find(n => n.type === 'sceneGroup')!;
    const host = mount(<RecipeChip node={scene} />);
    const chip = host.querySelector('[data-recipe-chip="scene"]')!;
    expect(chip.textContent).toContain(printRecipe(templateSpec('twisted')));
    expect(host.querySelector('[data-recipe-edited]')).toBeNull();
    expect(host.querySelector('[data-recipe-full]')).toBeNull();
    click(chip.querySelector('button'));
    expect(host.querySelector('[data-recipe-full]')?.textContent).toBe(printRecipe(templateSpec('twisted'), { pretty: true }));
    expect(host.querySelector('[data-recipe-token="shape"]')).toBeTruthy();
    expect(host.querySelector('[data-recipe-copy]')).toBeTruthy();
    click(host.querySelector('[data-recipe-open]'));
    expect(useSceneBuilder.getState().open).toBe(true);
    expect(useSceneBuilder.getState().targetSceneId).toBe(scene.id);
  });
  it('says "edited since build" when the scene was changed by hand', () => {
    const graph = built();
    const shadow = graph.find(n => n.params[ROLE_KEY] === 'shadow')!;
    const edited = graph.map(n => (n.id === shadow.id ? { ...n, params: { ...n.params, k: 40 } } : n));
    useNodeGraphStore.setState({ nodes: edited });
    const host = mount(<RecipeChip node={edited.find(n => n.type === 'sceneGroup')!} />);
    expect(host.querySelector('[data-recipe-edited]')?.textContent).toContain('edited since build');
  });
  it('is not there on a hand-made Scene Group', () => {
    const hand: GraphNode = { id: 'hand', type: 'sceneGroup', position: { x: 0, y: 0 }, inputs: {}, outputs: {}, params: { subgraph: { nodes: [] } } };
    useNodeGraphStore.setState({ nodes: [hand] });
    const host = mount(<RecipeChip node={hand} />);
    expect(host.querySelector('[data-recipe-chip]')).toBeNull();
  });
  it('opens when the Do… bar asks ("show the recipe")', () => {
    const g: GraphNode = { id: 'g1', type: 'gridRules', position: { x: 0, y: 0 }, inputs: {}, outputs: {}, params: {} };
    useNodeGraphStore.setState({ nodes: [g] });
    const host = mount(<RecipeChip node={g} />);
    expect(host.querySelector('[data-recipe-full]')).toBeNull();
    act(() => showRecipeOf('g1'));
    expect(host.querySelector('[data-recipe-full]')?.textContent).toBe('grid life');
    expect(host.querySelector('[data-recipe-chip]')?.textContent).toMatch(/B3\/S23 · 240×135 · wrap/);
    click(host.querySelector('[data-recipe-open]'));
    expect(useBuilderWindows.getState().gridRules).toBe('g1');
  });
});
