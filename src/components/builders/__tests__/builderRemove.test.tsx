// @vitest-environment jsdom
/**
 * Anything a builder lets you add can be taken away again (builders/removable.ts): a visible remove control at the
 * end of its header, Delete / Backspace while the card has focus, one undo step. For each builder: add an item, remove
 * it, and the spec is what it was before.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  const m = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); },
    key: () => null, get length() { return m.size; }, clear: () => m.clear(),
  });
});

import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useNodeGraphStore } from '../../../store/useNodeGraphStore';
import { useBuilderWindows } from '../../../builders/windows';
import { removeKeys } from '../removable';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext'];
if (!HTMLElement.prototype.setPointerCapture) HTMLElement.prototype.setPointerCapture = () => {};

const mounted: Array<{ root: Root; host: HTMLElement }> = [];
function mount(ui: React.ReactElement) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(ui));
  mounted.push({ root, host });
  return host;
}
afterEach(() => { for (const m of mounted.splice(0)) { act(() => m.root.unmount()); m.host.remove(); } vi.useRealTimers(); });
const $ = (sel: string) => document.body.querySelector<HTMLElement>(sel);
const $$ = (sel: string) => Array.from(document.body.querySelectorAll<HTMLElement>(sel));
const click = (el: Element | null) => { expect(el).toBeTruthy(); act(() => { (el as HTMLElement).click(); }); };
const key = (el: Element | null, k = 'Delete') => { expect(el).toBeTruthy(); act(() => { el!.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })); }); };
const output = () => ({ id: 'out', type: 'output', position: { x: 600, y: 0 }, inputs: { color: { type: 'vec4', label: 'Color' } }, outputs: {}, params: {} });

beforeEach(() => {
  localStorage.clear();
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 });
  useNodeGraphStore.setState({ nodes: [output() as never], activeGroupPath: [], selectedNodeId: null, selectedNodeIds: [] });
  useBuilderWindows.setState({ gridRules: null, agentRules: null, agentBuilder: null, recipe: null });
});

describe('removeKeys', () => {
  it('Delete or Backspace on the card removes it; typed in one of its fields, never', () => {
    const onRemove = vi.fn();
    mount(<div data-c {...removeKeys(onRemove)}><input data-f /><span role="slider" tabIndex={0} data-s /></div>);
    key($('[data-f]'), 'Backspace');
    key($('[data-s]'), 'Delete');
    expect(onRemove).not.toHaveBeenCalled();
    key($('[data-c]'), 'Backspace');
    key($('[data-c]'), 'Delete');
    expect(onRemove).toHaveBeenCalledTimes(2);
  });
});

describe('Grid scene builder', () => {
  it('a rule and a warp: added, then removed (button and Delete), back to the spec before, one undo step each', async () => {
    const { openNewGridScene } = await import('../../../gridScene/actions');
    const { useGridBuilder } = await import('../../../gridScene/store');
    act(() => openNewGridScene());
    act(() => useGridBuilder.getState().edit(d => { d.shapes.push({ ...structuredClone(d.shapes[0]), id: 'B' }); }));
    const { GridSceneBuilder } = await import('../../gridScene/GridSceneBuilder');
    mount(<GridSceneBuilder />);
    act(() => useGridBuilder.getState().setSection('rules'));
    const before = JSON.stringify(useGridBuilder.getState().spec);
    click($('[data-add-rule]'));
    expect(useGridBuilder.getState().spec.rules).toHaveLength(JSON.parse(before).rules.length + 1);
    key($('[data-sb-card^="gs-rule-"]'));
    expect(JSON.stringify(useGridBuilder.getState().spec)).toBe(before);
    click($('[data-add-rule]'));
    click($('[data-sb-card^="gs-rule-"] [data-card-remove]'));
    expect(JSON.stringify(useGridBuilder.getState().spec)).toBe(before);
    // Undo brings the rule back in one step.
    act(() => useGridBuilder.getState().undo());
    expect(useGridBuilder.getState().spec.rules).toHaveLength(JSON.parse(before).rules.length + 1);
    act(() => useGridBuilder.getState().redo());
    // A warp.
    act(() => useGridBuilder.getState().setSection('patterns'));
    const before2 = JSON.stringify(useGridBuilder.getState().spec);
    act(() => useGridBuilder.getState().edit(d => { d.warps.push({ name: 'Twist', lines: [], params: [] } as unknown as typeof d.warps[number]); }));
    click($('[data-warp-remove="0"]'));
    expect(JSON.stringify(useGridBuilder.getState().spec)).toBe(before2);
    act(() => useGridBuilder.getState().close());
  });
});

describe('Grid Rules: stacked cards', () => {
  it('a card added on top of the base is removed by its trash and by Delete', async () => {
    const { StackForm } = await import('../../gridRules/StackForm');
    const { GRID_DEFAULTS } = await import('../../../gridRules/spec');
    let latest: Record<string, unknown> = {};
    function Host() {
      const [p, setP] = useState<Record<string, unknown>>({ ...GRID_DEFAULTS });
      latest = p;
      return <StackForm p={p} set={patch => setP(x => ({ ...x, ...patch }))} />;
    }
    mount(<Host />);
    const before = JSON.stringify(latest.stack ?? []);
    click($('[data-stack-add-kind]'));
    expect((latest.stack as unknown[]).length).toBe(1);
    click($('[data-rule-card="0"] [data-rule-remove="0"]'));
    expect(JSON.stringify(latest.stack ?? [])).toBe(before);
    click($('[data-stack-add-kind]'));
    key($('[data-rule-card="0"]'));
    expect(JSON.stringify(latest.stack ?? [])).toBe(before);
  });
});

describe('3D Scene builder', () => {
  it('a shape added to the tree is removed with Delete on its row', async () => {
    const { useSceneBuilder } = await import('../../../sceneBuilder/store');
    const { parseRecipe } = await import('../../../sceneBuilder/recipe');
    const { addShape } = await import('../../../sceneBuilder/edit');
    const { SceneBuilderModal } = await import('../../sceneBuilder/SceneBuilderModal');
    act(() => useSceneBuilder.getState().openWith(parseRecipe('sphere r=0.6').spec, { tab: 'combine' }));
    mount(<SceneBuilderModal />);
    const before = JSON.stringify(useSceneBuilder.getState().spec.root.children.map(c => c.id));
    let id = '';
    act(() => useSceneBuilder.getState().edit(d => { id = addShape(d, 'box', null).id; }));
    act(() => useSceneBuilder.getState().select(id));
    key($(`[data-tree-item="${id}"]`));
    expect(JSON.stringify(useSceneBuilder.getState().spec.root.children.map(c => c.id))).toBe(before);
    act(() => useSceneBuilder.getState().close());
  });
});

describe('2D Scene builder', () => {
  it('every layer has a remove on its row; a space op is removed by Delete on its card', async () => {
    const { useSceneBuilder2D } = await import('../../../sceneBuilder2d/store');
    const { starterScene, newShape, nextId, newSpaceOp } = await import('../../../sceneBuilder2d/spec');
    const { SceneBuilder2DModal } = await import('../../sceneBuilder2d/SceneBuilder2DModal');
    act(() => useSceneBuilder2D.getState().openWith(starterScene()));
    mount(<SceneBuilder2DModal />);
    const before = JSON.stringify(useSceneBuilder2D.getState().scene.layers);
    let id = '';
    act(() => useSceneBuilder2D.getState().edit(d => { const s = newShape('circle', nextId(d, 's')); id = s.id; d.layers.push(s); }));
    click($(`[data-layer-remove="${id}"]`));
    expect(JSON.stringify(useSceneBuilder2D.getState().scene.layers)).toBe(before);
    const sp = JSON.stringify(useSceneBuilder2D.getState().scene.space);
    act(() => useSceneBuilder2D.getState().edit(d => { d.space.push(newSpaceOp('zoom', nextId(d, 'p'))); }));
    act(() => useSceneBuilder2D.getState().setTab('space'));
    const card = $$('[data-sb-card^="sp2-"][data-removable]').at(-1)!;
    key(card);
    expect(JSON.stringify(useSceneBuilder2D.getState().scene.space)).toBe(sp);
    act(() => useSceneBuilder2D.getState().close());
  });
});

describe('Splat builder', () => {
  it('an effect added to the stack is removed by its trash and by Delete', async () => {
    const { useSplatBuilder } = await import('../../../splatBuilder/store');
    const { starterSplatScene } = await import('../../../splatBuilder/spec');
    const { EffectsSection } = await import('../../splatBuilder/panels');
    act(() => useSplatBuilder.getState().openWith(starterSplatScene()));
    mount(<EffectsSection />);
    const before = JSON.stringify(useSplatBuilder.getState().spec.effects);
    click($('[data-splat-add]'));
    expect(useSplatBuilder.getState().spec.effects.length).toBe(JSON.parse(before).length + 1);
    click($$('[data-effect-remove]').at(-1)!);
    expect(JSON.stringify(useSplatBuilder.getState().spec.effects)).toBe(before);
    click($('[data-splat-add]'));
    key($$('[data-splat-effect]').at(-1)!);
    expect(JSON.stringify(useSplatBuilder.getState().spec.effects)).toBe(before);
    act(() => useSplatBuilder.getState().close());
  });
});

describe('Agent Builder', () => {
  it('a behaviour card added from its chip is removed by Delete on the card; an advanced rule by its ×', async () => {
    vi.useFakeTimers();
    Element.prototype.getBoundingClientRect = function () { return { x: 0, y: 0, left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, toJSON: () => ({}) } as DOMRect; };
    const { AgentBuilder } = await import('../../agentBuilder/AgentBuilder');
    const { groupRules } = await import('../../../agentRules/apply');
    mount(<AgentBuilder groupId={null} onClose={() => {}} />);
    click($('[data-start-kind="particles"]'));
    const settle = () => act(() => { vi.advanceTimersByTime(400); });
    const rules = () => JSON.stringify(groupRules(useNodeGraphStore.getState().nodes.find(n => n.type === 'agentsGroup')!));
    // The first section that offers a card to add.
    let chip: HTMLElement | null = null;
    for (const s of $$('[data-studio-section]').map(b => b.getAttribute('data-studio-section'))) {
      click($(`[data-studio-section="${s}"]`));
      chip = $('[data-card-add]');
      if (chip) break;
    }
    expect(chip).toBeTruthy();
    const added = chip!.getAttribute('data-card-add')!;
    settle();
    const before = rules();
    click(chip);
    settle();
    expect(rules()).not.toBe(before);
    const card = $$('[data-card-slot] [data-card]').find(c => c.querySelector(`[data-card-remove]`) && c.getAttribute('data-card')?.startsWith(added));
    expect(card).toBeTruthy();
    key(card!);
    settle();
    expect(rules()).toBe(before);
    // Advanced rules.
    click($('[data-studio-section="advanced"]'));
    settle();
    const before2 = rules();
    click($('[data-add-rule]'));
    settle();
    expect(rules()).not.toBe(before2);
    click($$('[data-rule-remove]').at(-1)!);
    settle();
    expect(rules()).toBe(before2);
  });
});
