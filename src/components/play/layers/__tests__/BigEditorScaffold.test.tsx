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
  it('shows the jump strip only with 4 or more sections', () => {
    const three = mount(<BigEditorScaffold sections={[{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C' }]}><div>body</div></BigEditorScaffold>);
    expect(three.querySelector('[role="tablist"]')).toBeNull();

    const four = mount(<BigEditorScaffold sections={[{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C' }, { id: 'd', label: 'D' }]}><div>body</div></BigEditorScaffold>);
    const strip = four.querySelector('[role="tablist"]');
    expect(strip).not.toBeNull();
    expect(strip!.querySelectorAll('[role="tab"]').length).toBe(4);
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
