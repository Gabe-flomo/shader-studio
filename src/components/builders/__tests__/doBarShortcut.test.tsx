// @vitest-environment jsdom
/**
 * ⌘⇧D (Ctrl+Shift+D off a Mac): the Do… bar from any page and from a text field; inside a scene
 * builder, that builder's recipe instead (builders/windows.ts requestBuilderRecipe), shown with its
 * editor focused. The kind page has no recipe, so the Do… bar opens there.
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
import { DEFAULT_ACTIONS, displayCombo, findShortcut, normaliseCombo, type ShortcutMap } from '../../../hooks/useShortcuts';
import { useDoBar } from '../../../suggestions/doBarStore';
import { NAVIGATE_EVENT } from '../../page';
import { doBarOrRecipe, onBuilderRecipeRequest, requestBuilderRecipe, useBuilderWindows } from '../../../builders/windows';
import { useNodeGraphStore } from '../../../store/useNodeGraphStore';
import { GRID_DEFAULTS } from '../../../gridRules/spec';
import { GridRulesEditor } from '../../gridRules/GridRulesEditor';
import { AgentRulesModal } from '../../NodeGraph/AgentRulesModal';
import { AgentBuilder } from '../../agentBuilder/AgentBuilder';
import { newAgentRules } from '../../../builders/open';
import { SceneBuilderModal } from '../../sceneBuilder/SceneBuilderModal';
import { useSceneBuilder } from '../../../sceneBuilder/store';
import { templateSpec } from '../../../sceneBuilder/templates';
import { SceneBuilder2DModal } from '../../sceneBuilder2d/SceneBuilder2DModal';
import { useSceneBuilder2D } from '../../../sceneBuilder2d/store';
import { openNewSceneBuilder2D } from '../../../sceneBuilder2d/actions';
import { GridSceneBuilder } from '../../gridScene/GridSceneBuilder';
import { useGridBuilder } from '../../../gridScene/store';
import { starterGridScene } from '../../../gridScene/spec';
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
afterEach(() => {
  for (const m of mounted.splice(0)) { act(() => m.root.unmount()); m.host.remove(); }
  useSceneBuilder.getState().close();
  useSceneBuilder2D.getState().close();
  useGridBuilder.getState().close();
  vi.useRealTimers();
});
const $ = (sel: string) => document.body.querySelector(sel);
const click = (el: Element | null) => { expect(el).toBeTruthy(); act(() => { (el as HTMLElement).click(); }); };
const defaults = (): ShortcutMap => Object.fromEntries(DEFAULT_ACTIONS.map(a => [a.id, a.defaultCombo]));
/** ⌘⇧D, then the frames focusRecipeEditor waits for. */
async function pressRecipe() {
  let handled = false;
  act(() => { handled = requestBuilderRecipe(); });
  await act(async () => { for (let i = 0; i < 4; i++) await new Promise(r => requestAnimationFrame(() => r(null))); });
  return handled;
}

beforeEach(() => {
  localStorage.clear();
  useNodeGraphStore.setState({ nodes: [], activeGroupPath: [], selectedNodeId: null, selectedNodeIds: [] });
  useBuilderWindows.setState({ gridRules: null, agentRules: null, agentBuilder: null, recipe: null, sceneShell: null });
  useDoBar.setState({ open: null });
});

describe('the ⌘⇧D shortcut', () => {
  it('is registered as ⌘⇧D, normalised, clashing with no other default', () => {
    const a = DEFAULT_ACTIONS.find(x => x.id === 'doBarOrRecipe')!;
    expect(a).toBeDefined();
    expect(normaliseCombo(a.defaultCombo)).toBe('cmd+shift+d');
    expect(displayCombo(a.defaultCombo)).toBe('⌘⇧D');
    expect(a.inEditors).toBe(true);
    const combos = DEFAULT_ACTIONS.map(x => normaliseCombo(x.defaultCombo));
    expect(new Set(combos).size).toBe(combos.length);
  });

  it('fires from either modifier order, and while typing', () => {
    expect(findShortcut(defaults(), 'shift+cmd+d', false, true)).toBe('doBarOrRecipe');
    expect(findShortcut(defaults(), 'cmd+shift+d', true, true)).toBe('doBarOrRecipe');
    expect(findShortcut(defaults(), 'cmd+d', false, true)).toBe('duplicateSelected');
  });

  it('is Ctrl+Shift+D off a Mac, and only for itself (⌃K stays unbound)', () => {
    expect(findShortcut(defaults(), 'ctrl+shift+d', false, false)).toBe('doBarOrRecipe');
    expect(findShortcut(defaults(), 'ctrl+shift+d', true, false)).toBe('doBarOrRecipe');
    expect(findShortcut(defaults(), 'ctrl+shift+d', false, true)).toBeNull();
    expect(findShortcut(defaults(), 'ctrl+k', false, false)).toBeNull();
  });
});

describe('the handler', () => {
  it('opens the Do… bar when no builder is open', () => {
    doBarOrRecipe(true);
    expect(useDoBar.getState().open).toEqual({});
  });

  it('asks the open builder for its recipe instead (the topmost one)', () => {
    const a = vi.fn(), b = vi.fn();
    const offA = onBuilderRecipeRequest(a);
    const offB = onBuilderRecipeRequest(b);
    doBarOrRecipe(true);
    expect(b).toHaveBeenCalledTimes(1);
    expect(a).not.toHaveBeenCalled();
    expect(useDoBar.getState().open).toBeNull();
    offB(); offA();
    expect(requestBuilderRecipe()).toBe(false);
  });

  it('off the Studio, switches to it first, then opens the Do… bar', () => {
    vi.useFakeTimers();
    const pages: string[] = [];
    const go = (e: Event) => pages.push((e as CustomEvent<string>).detail);
    window.addEventListener(NAVIGATE_EVENT, go);
    doBarOrRecipe(false);
    expect(pages).toEqual(['studio']);
    expect(useDoBar.getState().open).toBeNull();
    vi.advanceTimersByTime(60);
    expect(useDoBar.getState().open).toEqual({});
    window.removeEventListener(NAVIGATE_EVENT, go);
  });
});

describe('each builder shows its recipe', () => {
  it('Grid Rules: As text, its text focused', async () => {
    const grid: GraphNode = { id: 'g1', type: 'gridRules', position: { x: 0, y: 0 }, inputs: {}, outputs: {}, params: { ...GRID_DEFAULTS, ruleType: 'count' } };
    useNodeGraphStore.setState({ nodes: [grid] });
    mount(<GridRulesEditor nodeId="g1" onClose={() => {}} />);
    expect($('[data-language-tab="grid"]')).toBeNull();
    expect(await pressRecipe()).toBe(true);
    expect($('[data-language-tab="grid"]')).toBeTruthy();
    expect(document.activeElement).toBe($('[data-language-tab="grid"] textarea'));
  });

  it('Agent Rules window: the Recipe tab, its text focused', async () => {
    newAgentRules();
    const group = useNodeGraphStore.getState().nodes.find(n => n.type === 'agentsGroup')!;
    mount(<AgentRulesModal node={group} onClose={() => {}} />);
    expect(await pressRecipe()).toBe(true);
    expect($('[data-agent-tab]')?.getAttribute('data-agent-tab')).toBe('recipe');
    expect(document.activeElement).toBe($('[data-language-tab="agents"] textarea'));
  });

  it('Agent Builder: Advanced rules on Every rule; its start page has no recipe', async () => {
    mount(<AgentBuilder groupId={null} onClose={() => {}} />);
    expect(await pressRecipe()).toBe(false);
    click($('[data-start-kind="trail"]'));
    expect(await pressRecipe()).toBe(true);
    expect($('[data-advanced-rules]')?.getAttribute('data-advanced-rules')).toBe('all');
    expect($('[data-advanced-rules="all"]')?.contains(document.activeElement)).toBe(true);
  });

  it('3D Scene Builder: Under the hood, its recipe focused', async () => {
    useSceneBuilder.getState().openWith(templateSpec('blobs'));
    mount(<SceneBuilderModal />);
    expect($('[data-inspector="recipe"]')).toBeNull();
    expect(await pressRecipe()).toBe(true);
    expect($('[data-inspector="recipe"]')).toBeTruthy();
    expect(document.activeElement).toBe($('[data-inspector="recipe"] textarea'));
  });

  it('2D Scene Builder: the Recipe tab, its text focused', async () => {
    openNewSceneBuilder2D();
    mount(<SceneBuilder2DModal />);
    expect(await pressRecipe()).toBe(true);
    expect(useSceneBuilder2D.getState().tab).toBe('recipe');
    expect(document.activeElement).toBe($('textarea[aria-label="2D scene recipe"]'));
  });

  it('Grid scene builder: its Rules (it has no recipe text)', async () => {
    useGridBuilder.getState().openWith(starterGridScene());
    mount(<GridSceneBuilder />);
    expect(await pressRecipe()).toBe(true);
    expect(useGridBuilder.getState().section).toBe('rules');
  });

  it('the Scene builder kind page has no recipe: it steps aside and the Do… bar opens', () => {
    useBuilderWindows.setState({ sceneShell: { page: 'kinds' } });
    mount(<SceneBuilderShell page={{ page: 'kinds' }} />);
    doBarOrRecipe(true);
    expect(useDoBar.getState().open).toEqual({});
    expect(useBuilderWindows.getState().sceneShell).toBeNull();
  });
});
