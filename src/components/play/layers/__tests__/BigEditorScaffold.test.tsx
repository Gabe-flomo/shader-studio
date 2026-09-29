// @vitest-environment jsdom
/**
 * BigEditorScaffold: the shared layout for editors with many settings, in
 * the split view's big Layers panel (docs/editor-layout.md). The jump strip
 * only earns its place once there's something to jump between; below that
 * it would just be one more row of chrome above a couple of cards.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Section } from '../Section';
import { BigEditorScaffold } from '../BigEditorScaffold';
import { DrumPadEditor } from '../DrumPadEditor';
import { ParticlesEditor, RelationshipEditor } from '../editors';
import { VideoEditor } from '../VideoEditor';
import { makeFieldKit } from '../fields';
import type { EditorContext } from '../editors';
import { THEMES } from '../../../../theme/tokens';
import { defaultLayer, emptyPlayRecord, type PlayLayer, type PlayLayerKind } from '../../../../types/play';
import { DEFAULT_SPLIT, usePlaySplit } from '../../playSplit';
import { usePlayUi } from '../../playUi';

vi.hoisted(() => {
  const m = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); },
    key: () => null, get length() { return m.size; }, clear: () => m.clear(),
  });
});

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

beforeEach(() => {
  usePlaySplit.setState({ ...DEFAULT_SPLIT, available: false });
  usePlayUi.setState({ selected: '' });
});

function ctxFor(kind: PlayLayerKind, id: string): { f: ReturnType<typeof makeFieldKit>; ctx: EditorContext } {
  const layer = defaultLayer(kind, id, 'L') as PlayLayer;
  const f = makeFieldKit({ l: layer, tk: THEMES.light, touch: false, exposedTargets: new Set(), set: () => {}, onExpose: () => {}, onExposeControl: () => {}, onDriveNull: () => {}, onPairXY: () => {} });
  const ctx: EditorContext = {
    layers: [layer], act: () => {}, drawing: null, startDrawing: () => {}, cancelDrawing: () => {}, createNull: () => {},
    play: { ...emptyPlayRecord(), layers: [layer] }, changePlay: () => {}, big: true,
  };
  return { f, ctx };
}

describe('BigEditorScaffold', () => {
  it('shows a tab strip once two or more Sections are inside; one section shows plainly', () => {
    const one = mount(<BigEditorScaffold kind="t1" sections={[{ id: 'a', label: 'A' }]}><Section kind="t1" id="a" title="A" primary><div>body a</div></Section></BigEditorScaffold>);
    expect(one.querySelector('[role="tablist"]')).toBeNull();
    expect(one.textContent).toContain('body a');

    const two = mount(<BigEditorScaffold kind="t2" sections={[{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }]}>
      <Section kind="t2" id="a" title="A" primary><div>body a</div></Section>
      <Section kind="t2" id="b" title="B"><div>body b</div></Section>
    </BigEditorScaffold>);
    const strip = two.querySelector('[role="tablist"]');
    expect(strip).not.toBeNull();
    expect(strip!.querySelectorAll('[role="tab"]').length).toBe(2);
    // One section at a time: the primary is open, the other is a hidden panel.
    expect(two.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toContain('A');
    const panels = Array.from(two.querySelectorAll('[role="tabpanel"]'));
    expect(panels.filter(p => !p.hasAttribute('hidden')).map(p => p.getAttribute('aria-label'))).toEqual(['A']);
  });

  it('always renders its children, strip or not', () => {
    const host = mount(<BigEditorScaffold sections={[{ id: 'a', label: 'A' }]}><div data-testid="body">hi</div></BigEditorScaffold>);
    expect(host.textContent).toContain('hi');
  });
});

describe('big editors mount without console errors', () => {
  const kinds: Array<[string, () => React.ReactElement]> = [
    ['drum pads', () => { const { f, ctx } = ctxFor('drumpad', 'dp1'); return <DrumPadEditor f={f} ctx={ctx} />; }],
    ['particles', () => { const { f, ctx } = ctxFor('particles', 'pt1'); return <ParticlesEditor f={f} ctx={ctx} />; }],
    ['relationship', () => { const { f, ctx } = ctxFor('relationship', 'rl1'); return <RelationshipEditor f={f} ctx={ctx} />; }],
    ['video', () => { const { f, ctx } = ctxFor('video', 'vd1'); return <VideoEditor f={f} ctx={ctx} pictureHidden={false} />; }],
  ];

  for (const [name, make] of kinds) {
    it(`${name} editor mounts cleanly`, () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        const host = mount(make());
        expect(host.children.length).toBeGreaterThan(0);
      } finally {
        expect(spy).not.toHaveBeenCalled();
        spy.mockRestore();
      }
    });
  }
});

describe('a big editor opens on its primary section, as tabs', () => {
  beforeEach(() => usePlayUi.setState({ folded: {}, sectionTabs: {}, sectionsShowAll: false }));

  const activeTab = (host: HTMLElement) => host.querySelector('[role="tab"][aria-selected="true"]')?.textContent?.trim();
  const tabNamed = (host: HTMLElement, name: string) => Array.from(host.querySelectorAll<HTMLElement>('[role="tab"]')).find(b => b.textContent?.trim().startsWith(name));

  it('the relationship editor mounts on Members, with only that panel showing', () => {
    const { f, ctx } = ctxFor('relationship', 'rl1');
    const host = mount(<RelationshipEditor f={f} ctx={ctx} />);
    expect(activeTab(host)).toContain('Members');
    const shown = Array.from(host.querySelectorAll('[role="tabpanel"]')).filter(p => !p.hasAttribute('hidden')).map(p => p.getAttribute('aria-label'));
    expect(shown).toEqual(['Members']);
  });

  it('opening Walls is remembered', () => {
    const { f, ctx } = ctxFor('relationship', 'rl2');
    const host = mount(<RelationshipEditor f={f} ctx={ctx} />);
    const walls = tabNamed(host, 'Walls');
    expect(walls).toBeTruthy();
    act(() => walls!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(activeTab(host)).toContain('Walls');

    // Mounted again ("switch layers and back"): still on Walls. (Under a LayerRow the memory is per layer; an editor on its own remembers per kind.)
    const again = mount(<RelationshipEditor f={f} ctx={ctx} />);
    expect(activeTab(again)).toContain('Walls');
  });

  it('Show all stacks the sections (folded, with Expand all / Collapse all) for every editor', () => {
    const { f, ctx } = ctxFor('relationship', 'rl4');
    const host = mount(<RelationshipEditor f={f} ctx={ctx} />);
    const showAll = Array.from(host.querySelectorAll('button')).find(b => b.textContent === 'Show all')!;
    expect(showAll).toBeTruthy();
    act(() => showAll.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(host.querySelector('[role="tablist"]')).toBeNull();
    const buttons = Array.from(host.querySelectorAll('button')).map(b => b.textContent);
    expect(buttons).toContain('Expand all');
    expect(buttons).toContain('Collapse all');
    const headings = () => Array.from(host.querySelectorAll('button[aria-expanded]'));
    expect(headings().filter(b => b.getAttribute('aria-expanded') === 'true').map(b => b.textContent?.trim())).toEqual(['Members']);
    const expandAll = Array.from(host.querySelectorAll('button')).find(b => b.textContent === 'Expand all')!;
    act(() => expandAll.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(headings().every(b => b.getAttribute('aria-expanded') === 'true')).toBe(true);
  });
});
