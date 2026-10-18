// @vitest-environment jsdom
/**
 * The 2D Scene builder on a phone (PhoneStudio's sheet): a card's picture sits on top of its
 * settings instead of beside them, a block's line puts its expression on a full-width row of its
 * own, a combine's modes are one even segmented row, and a place's X / Y stack. A wide window
 * keeps the side-by-side layout.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  const m = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); },
    key: () => null, get length() { return m.size; }, clear: () => m.clear(),
  });
});

import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ShapesTab, SpaceTab } from '../SceneBuilder2DModal';
import { PhoneStudioContext } from '../../builders/studio/PhoneStudio';
import { useSceneBuilder2D } from '../../../sceneBuilder2d/store';
import { emptyScene, newCombineOp, newBlockOp, newShape } from '../../../sceneBuilder2d/spec';
import { BLOCK_BY_ID, blockFromEntry } from '../../../sceneBuilder2d/blockLibrary';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
HTMLCanvasElement.prototype.getContext = (() => null) as never;

const mounted: Array<{ root: Root; host: HTMLElement }> = [];
afterEach(() => { for (const m of mounted.splice(0)) { act(() => m.root.unmount()); m.host.remove(); } });
function mount(el: ReactElement, phone: boolean) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(<PhoneStudioContext.Provider value={phone}>{el}</PhoneStudioContext.Provider>));
  mounted.push({ root, host });
  return host;
}

/** A scene like the user's: a combine of Julia and Sine shift, then a block on its own. */
function openSpaceScene() {
  const s = emptyScene();
  s.space.push(
    newCombineOp('p1', blockFromEntry(BLOCK_BY_ID.julia), blockFromEntry(BLOCK_BY_ID['sine-shift']), 'blend'),
    newBlockOp('p2', blockFromEntry(BLOCK_BY_ID.twirl)),
  );
  s.layers.push(newShape('circle', 's1'));
  useSceneBuilder2D.getState().openWith(s);
}

/** The flex row an element's direct parent lays it out in, or null when its parent stacks (column). */
const rowOf = (el: Element) => {
  const p = el.parentElement!;
  return p.style.display === 'flex' && (p.style.flexDirection || 'row') === 'row' ? p : null;
};

describe('the Space tab on a phone', () => {
  it('puts each card\'s picture on top of its settings, not beside them', () => {
    openSpaceScene();
    const host = mount(<SpaceTab />, true);
    const cards = host.querySelectorAll('[data-thumb-layout]');
    expect(cards.length).toBe(2);
    for (const c of cards) {
      expect(c.getAttribute('data-thumb-layout')).toBe('stacked');
      expect((c as HTMLElement).style.flexDirection).toBe('column');
      // The picture's row holds only the picture and its note, never the editor.
      const thumb = c.querySelector('canvas')!;
      const row = rowOf(thumb)!;
      expect(row).toBeTruthy();
      expect(row.querySelector('[data-block-editor], [data-combine-editor]')).toBeNull();
      expect(thumb.width).toBeLessThanOrEqual(56);
    }
  });

  it('gives every line\'s expression a full-width row under its target and operator', () => {
    openSpaceScene();
    const host = mount(<SpaceTab />, true);
    const lines = [...host.querySelectorAll('[data-block-line]')];
    expect(lines.length).toBeGreaterThan(2);
    for (const l of lines) {
      expect(l.getAttribute('data-line-layout')).toBe('stacked');
      const rhs = l.querySelector('[data-block-rhs]')!;
      const row = rhs.closest('[data-block-rhs-row]') as HTMLElement;
      expect(row).toBeTruthy();
      expect(row.style.width).toBe('100%');
      // Nothing else on the expression's row: the target and operator are on the row above.
      expect(row.querySelector('[aria-label$="target"], [aria-label$="operator"]')).toBeNull();
    }
    // + Line is a button of its own with the hint under it.
    const add = host.querySelector('[data-line-add-layout="stacked"]') as HTMLElement;
    expect(add.style.flexDirection).toBe('column');
    expect(add.textContent).toContain('whole numbers are fine');
  });

  it('shows the combine modes as one even segmented row', () => {
    openSpaceScene();
    const host = mount(<SpaceTab />, true);
    const modes = host.querySelector('[data-combine-modes]') as HTMLElement;
    expect(modes.getAttribute('data-combine-modes')).toBe('segmented');
    expect(modes.style.display).toBe('grid');
    expect(modes.style.gridTemplateColumns).toBe('repeat(4, minmax(0, 1fr))');
  });
});

describe('the Space tab on a wide window (unchanged)', () => {
  it('keeps the picture beside the settings and each line on one row', () => {
    openSpaceScene();
    const host = mount(<SpaceTab />, false);
    for (const c of host.querySelectorAll('[data-thumb-layout]')) {
      expect(c.getAttribute('data-thumb-layout')).toBe('beside');
      expect((c as HTMLElement).style.flexDirection).toBe('');
      expect(c.firstElementChild?.tagName).toBe('CANVAS');
      expect((c.firstElementChild as HTMLCanvasElement).width).toBe(72);
    }
    for (const l of host.querySelectorAll('[data-block-line]')) {
      expect(l.getAttribute('data-line-layout')).toBe('inline');
      expect(l.querySelector('[data-block-rhs-row]')).toBeNull();
      const rhs = l.querySelector('[data-block-rhs]')!;
      // The target select shares the expression's row.
      const row = rhs.closest('[data-block-line] > div') as HTMLElement;
      expect(row.querySelector('[aria-label$="target"]')).toBeTruthy();
    }
    expect(host.querySelector('[data-combine-modes]')?.getAttribute('data-combine-modes')).toBe('chips');
    expect(host.querySelector('[data-line-add-layout]')).toBeNull();
  });
});

describe('the Shapes tab', () => {
  it('stacks Position X over Y on a phone, side by side on a wide window', () => {
    openSpaceScene();
    useSceneBuilder2D.getState().select('s1');
    for (const phone of [true, false]) {
      const host = mount(<ShapesTab />, phone);
      const place = host.querySelector('[data-sb-card$="-place"] [aria-expanded]') as HTMLElement;
      if (place.getAttribute('aria-expanded') === 'false') act(() => place.click());
      const vec = host.querySelector('[data-vec2-layout]') as HTMLElement;
      expect(vec.getAttribute('data-vec2-layout')).toBe(phone ? 'stacked' : 'pair');
      expect(vec.style.gridTemplateColumns).toBe(phone ? 'minmax(0, 1fr)' : 'repeat(2, minmax(0, 1fr))');
      expect((host.querySelector('[data-shape-tiles]') as HTMLElement).style.display).toBe(phone ? 'grid' : 'flex');
    }
  });
});
