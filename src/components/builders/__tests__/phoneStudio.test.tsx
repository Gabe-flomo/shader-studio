// @vitest-environment jsdom
/**
 * The builders on a phone (docs/scene-builder.md, "On a phone"):
 *  - StudioShell's phone layout (PhoneStudio): no side panels; the nav's sections are the bottom
 *    bar's tabs after Presets; tapping one selects it and the sheet shows its settings, with ‹ Presets
 *    back, a handle, and the section's help on a tap;
 *  - a builder's own nav content (the Grid builder's drawing) is a tab of its own;
 *  - BuilderSlider takes the touch size and a double tap resets;
 *  - a new graph on a phone opens the Scene builder's kind page; "Start from an empty graph" doesn't.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { GraphNode } from '../../../types/nodeGraph';
import { undoManager, useNodeGraphStore } from '../../../store/useNodeGraphStore';
import { useBuilderWindows } from '../../../builders/windows';
import { useGridBuilder } from '../../../gridScene/store';
import { openNewGridScene } from '../../../gridScene/actions';
import { StudioLabel, StudioNavItem, StudioShell } from '../studio/StudioShell';
import { PhoneStudioContext, clampSheet } from '../studio/PhoneStudio';
import { BuilderSlider } from '../BuilderSlider';
import { NewGraphSheet } from '../../shell/NewGraphSheet';
import { startNewGraph } from '../../../builders/newGraph';
import { SceneBuilderShell } from '../SceneBuilderShell';

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
afterEach(() => { for (const m of mounted.splice(0)) { act(() => m.root.unmount()); m.host.remove(); } });
const $ = (sel: string) => document.body.querySelector<HTMLElement>(sel);
const $$ = (sel: string) => Array.from(document.body.querySelectorAll<HTMLElement>(sel));
const click = (el: Element | null) => { expect(el).toBeTruthy(); act(() => { (el as HTMLElement).click(); }); };
const width = (w: number) => Object.defineProperty(window, 'innerWidth', { configurable: true, value: w });
const tabs = () => $$('[data-phone-tab]').map(t => t.dataset.phoneTab);
const shown = (sel: string) => { const el = $(sel); return !!el && el.style.display !== 'none'; };

function fire(el: EventTarget, type: string, init: Record<string, unknown> = {}) {
  const e = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, ...init });
  for (const [k, v] of Object.entries(init)) if (!(k in e) || k === 'pointerType') Object.defineProperty(e, k, { value: v });
  act(() => { el.dispatchEvent(e); });
}

const SECTIONS = [
  { id: 'shapes', label: 'Shapes', hint: 'What is drawn' },
  { id: 'look', label: 'Look', hint: 'Colour and glow' },
];

/** A builder on StudioShell, as the kinds use it: nav items that select the inspector's section. */
function Demo({ withNavTab = false }: { withNavTab?: boolean }) {
  const [section, setSection] = useState('shapes');
  return (
    <StudioShell prefsKey="demo" icon="grid" title="Demo builder" onClose={() => {}}
      phoneNav={withNavTab ? { label: 'Draw', icon: 'edit' } : undefined}
      nav={<div>
        {withNavTab && <span data-demo-draw>the drawing grid</span>}
        <StudioLabel sections>Sections</StudioLabel>
        {SECTIONS.map(s => <StudioNavItem key={s.id} id={s.id} icon="sliders" label={s.label} hint={s.hint} selected={section === s.id} onClick={() => setSection(s.id)} />)}
      </div>}
      inspector={<div data-demo-settings>settings for {section}</div>}
      presets={<div data-demo-presets>presets <button type="button">Surprise me</button></div>}>
      <div data-demo-viewport>the picture</div>
    </StudioShell>
  );
}

beforeEach(() => {
  localStorage.clear();
  undoManager.clear('test');
  useNodeGraphStore.setState({ nodes: [], activeGroupPath: [], selectedNodeId: null, selectedNodeIds: [] });
  useBuilderWindows.setState({ gridRules: null, agentRules: null, agentBuilder: null, recipe: null, sceneShell: null });
  useGridBuilder.setState({ open: false, targetSceneId: null });
});
afterEach(() => width(1440));

describe('StudioShell on a phone', () => {
  it('puts the sections in the bottom bar as tabs after Presets, with no side panels', () => {
    width(375);
    mount(<Demo />);
    expect($('[data-phone-studio="demo"]')).toBeTruthy();
    expect(tabs()).toEqual(['__presets', 'shapes', 'look']);
    // The nav's rows aren't drawn: the items registered as tabs. No drawers, no fold buttons.
    expect($$('[data-studio-section]')).toHaveLength(0);
    expect($('[data-studio-toggle]')).toBeNull();
    expect($('[data-studio-drawer]')).toBeNull();
    // The viewport is on top; the presets show first.
    expect($('[data-demo-viewport]')?.closest('[data-studio-viewport]')).toBeTruthy();
    expect(shown('[data-phone-presets]')).toBe(true);
    expect(shown('[data-phone-settings]')).toBe(false);
    expect($('[data-phone-presets]')?.textContent).toContain('Surprise me');
  });

  it('turns the sheet into a section\'s settings on a tap, with a way back to the presets', () => {
    width(375);
    mount(<Demo />);
    click($('[data-phone-tab="look"]'));
    expect(shown('[data-phone-settings]')).toBe(true);
    expect(shown('[data-phone-presets]')).toBe(false);
    expect($('[data-phone-settings]')?.textContent).toBe('settings for look');
    expect($('[data-phone-sheet-title]')?.textContent).toBe('Look');
    expect($('[data-phone-tab="look"]')?.getAttribute('aria-selected')).toBe('true');
    expect($('[data-phone-handle]')).toBeTruthy();
    // Help is a tap, not a hover.
    expect($('[data-phone-help-text]')).toBeNull();
    click($('[data-phone-help]'));
    expect($('[data-phone-help-text]')?.textContent).toBe('Colour and glow');
    click($('[data-phone-back]'));
    expect(shown('[data-phone-presets]')).toBe(true);
    expect(shown('[data-phone-settings]')).toBe(false);
  });

  it('resizes the sheet from its handle, within limits', () => {
    width(375);
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 });
    mount(<Demo />);
    click($('[data-phone-tab="shapes"]'));
    const before = parseFloat($('[data-phone-settings]')!.style.height);
    fire($('[data-phone-handle]')!, 'pointerdown', { clientY: 500, pointerId: 1 });
    fire($('[data-phone-handle]')!, 'pointermove', { clientY: 400, pointerId: 1 });
    fire($('[data-phone-handle]')!, 'pointerup', { clientY: 400, pointerId: 1 });
    expect(parseFloat($('[data-phone-settings]')!.style.height)).toBe(clampSheet(before + 100, 800));
    expect(clampSheet(5000, 800)).toBeLessThan(800 - 200);
    expect(clampSheet(0, 800)).toBe(120);
  });

  it('gives a nav with more than sections a tab of its own, without its Sections heading', () => {
    width(375);
    mount(<Demo withNavTab />);
    expect(tabs()).toEqual(['__presets', '__nav', 'shapes', 'look']);
    click($('[data-phone-tab="__nav"]'));
    expect(shown('[data-phone-panel="__nav"]')).toBe(true);
    expect($('[data-phone-panel="__nav"]')?.textContent).toContain('the drawing grid');
    expect($('[data-phone-panel="__nav"]')?.textContent).not.toContain('Sections');
  });

  it('keeps the side panels on a wide window', () => {
    width(1440);
    mount(<Demo />);
    expect($('[data-phone-studio]')).toBeNull();
    expect($$('[data-studio-section]').map(b => b.dataset.studioSection)).toEqual(['shapes', 'look']);
    expect($('[data-studio-panel="presets"]')).toBeTruthy();
  });

  it('applies to a real kind: the Grid builder\'s sections and its drawing are tabs', async () => {
    width(375);
    act(() => openNewGridScene());
    const { GridSceneBuilder } = await import('../../gridScene/GridSceneBuilder');
    mount(<GridSceneBuilder />);
    const t = tabs();
    expect(t.slice(0, 2)).toEqual(['__presets', '__nav']);
    expect(t.length).toBeGreaterThan(4);
    expect($$('[data-studio-section]')).toHaveLength(0);
    click($(`[data-phone-tab="${t[3]}"]`));
    expect(shown('[data-phone-settings]')).toBe(true);
    expect($('[data-phone-settings]')?.textContent?.length).toBeGreaterThan(20);
    act(() => useGridBuilder.getState().close());
  });
});

describe('BuilderSlider on a phone', () => {
  it('takes the touch size, follows a finger drag and resets on a double tap', () => {
    width(375);
    const onChange = vi.fn();
    mount(<PhoneStudioContext.Provider value={true}><BuilderSlider value={0.5} min={0} max={1} ariaLabel="Size" defaultValue={0.25} onChange={onChange} /></PhoneStudioContext.Provider>);
    const track = $('[data-ruler-track]')!;
    expect(track.style.height).toBe('40px');
    fire(track, 'pointerdown', { pointerType: 'touch', clientX: 100, pointerId: 1, timeStamp: 1000 });
    fire(track, 'pointermove', { pointerType: 'touch', clientX: 160, pointerId: 1 });
    fire(track, 'pointerup', { pointerType: 'touch', clientX: 160, pointerId: 1 });
    expect(onChange).toHaveBeenCalled();
    expect(onChange.mock.calls.at(-1)![0]).not.toBe(0.5);
    onChange.mockClear();
    // Two still taps close together: back to the default.
    fire(track, 'pointerdown', { pointerType: 'touch', clientX: 100, pointerId: 2 });
    fire(track, 'pointerup', { pointerType: 'touch', clientX: 100, pointerId: 2 });
    fire(track, 'pointerdown', { pointerType: 'touch', clientX: 100, pointerId: 3 });
    expect(onChange).toHaveBeenLastCalledWith(0.25);
  });
});

describe('a new graph on a phone', () => {
  const output = (): GraphNode => ({ id: 'out', type: 'output', position: { x: 0, y: 0 }, inputs: {}, outputs: {}, params: {} } as GraphNode);
  const busy = (): GraphNode[] => [{ id: 'uv', type: 'uv', position: { x: 0, y: 0 }, inputs: {}, outputs: {}, params: {} } as GraphNode, output()];
  let original: ReturnType<typeof useNodeGraphStore.getState>['loadExampleGraph'];
  beforeEach(() => {
    original = useNodeGraphStore.getState().loadExampleGraph;
    useNodeGraphStore.setState({ nodes: busy(), loadExampleGraph: async () => { useNodeGraphStore.setState({ nodes: [output()] }); } });
  });
  afterEach(() => useNodeGraphStore.setState({ loadExampleGraph: original }));

  it('starts from the Scene builder\'s kind page', async () => {
    width(375);
    let open = true;
    mount(<NewGraphSheet onClose={() => { open = false; }} />);
    await act(async () => { $('[data-new-graph="builder"]')!.click(); });
    expect(open).toBe(false);
    expect(useNodeGraphStore.getState().nodes.map(n => n.id)).toEqual(['out']);
    expect(useBuilderWindows.getState().sceneShell).toMatchObject({ page: 'kinds' });
    // The kind page, with the empty graph a tap away.
    mount(<SceneBuilderShell page={useBuilderWindows.getState().sceneShell!} />);
    expect($$('[data-scene-kind]').length).toBeGreaterThanOrEqual(5);
    click($('[data-scene-empty]'));
    expect(useBuilderWindows.getState().sceneShell).toBeNull();
  });

  it('"Start from an empty graph" leaves the builders closed', async () => {
    width(375);
    mount(<NewGraphSheet onClose={() => {}} />);
    await act(async () => { $('[data-new-graph="empty"]')!.click(); });
    expect(useNodeGraphStore.getState().nodes.map(n => n.id)).toEqual(['out']);
    expect(useBuilderWindows.getState().sceneShell).toBeNull();
    await act(async () => { await startNewGraph(); });
    expect(useBuilderWindows.getState().sceneShell).toMatchObject({ page: 'kinds' });
  });
});
