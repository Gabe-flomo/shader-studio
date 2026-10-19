// @vitest-environment jsdom
/**
 * The Play page's picture is always on the right, the panel (with the rail) on its left, in every
 * sidebar mode (Play audit, user decision 2026-10-18); the preview's header and footer ride with
 * the picture; and Free never crops on Play (it letterboxes to square when the area is narrower).
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

vi.hoisted(() => {
  const m = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); },
    key: () => null, get length() { return m.size; }, clear: () => m.clear(),
  });
  class RO { observe() {} unobserve() {} disconnect() {} }
  vi.stubGlobal('ResizeObserver', RO);
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: false, media: q, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false }));
});

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PlaySplitArea } from '../PlaySplitArea';
import { DEFAULT_SPLIT, usePlaySplit, type SidebarMode } from '../playSplit';
import { PLAY_FREE_MIN_RATIO, fitAspect, playFreeFit } from '../../../utils/graphImportPlan';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;
beforeAll(() => { usePlaySplit.setState({ ...DEFAULT_SPLIT }); });
afterEach(() => { act(() => root?.unmount()); host?.remove(); root = null; host = null; });

function mount(sidebar: SidebarMode): HTMLDivElement {
  usePlaySplit.setState({ ...DEFAULT_SPLIT, on: true, sidebar });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(<PlaySplitArea active><div data-testid="header" /><div data-testid="picture" /><div data-testid="footer" /></PlaySplitArea>));
  return host;
}

const orderOf = (el: Element | null | undefined) => Number((el as HTMLElement | null)?.style.order ?? NaN);

describe('the picture is on the right', () => {
  for (const sidebar of ['rail', 'full', 'hidden'] as SidebarMode[]) {
    it(`with the sidebar ${sidebar}: the panel first (left), then the divider, then the picture`, () => {
      const h = mount(sidebar);
      const area = h.querySelector('[data-play-split-area]') as HTMLElement;
      expect(area.style.flexDirection).toBe('row');
      const picture = h.querySelector('[data-split-picture]');
      const panel = h.querySelector('[data-split-panel]')?.parentElement;
      const divider = h.querySelector('[role="separator"]');
      expect(orderOf(panel)).toBeLessThan(orderOf(divider));
      expect(orderOf(divider)).toBeLessThan(orderOf(picture));
      // The preview's header, picture and footer all sit in the picture's column.
      expect([...picture!.children].map(c => c.getAttribute('data-testid'))).toEqual(['header', 'picture', 'footer']);
      // The panel takes the default share (about a third).
      expect((panel as HTMLElement).style.flex).toContain('35.00%');
      // The layout menu offers no way to move the panel to another side.
      expect(h.querySelector('[data-play-layout]')?.getAttribute('aria-label')).not.toMatch(/where the panel sits/);
    });
  }

  it('the canvas stays the area’s first child (never remounted by the split), drawn last by order', () => {
    const h = mount('rail');
    const area = h.querySelector('[data-play-split-area]')!;
    expect(area.firstElementChild?.hasAttribute('data-split-picture')).toBe(true);
  });

  it('App puts the preview header and footer inside the split, beside the panel', () => {
    const src = readFileSync(join(__dirname, '../../../App.tsx'), 'utf8');
    const desk = src.slice(src.indexOf('data-preview-column=""'));
    const split = desk.indexOf('<PlaySplitArea active={page === \'play\'}>');
    expect(split).toBeGreaterThan(-1);
    expect(desk.indexOf('<PreviewHeader>')).toBeGreaterThan(split);
    expect(desk.indexOf('<PreviewFooter')).toBeLessThan(desk.indexOf('</PlaySplitArea>'));
    // Tablets reach Stage from the top bar.
    expect(readFileSync(join(__dirname, '../../shell/DesktopTopNav.tsx'), 'utf8')).toMatch(/compact && page === 'play' && <IconButton icon="play" label="Stage/);
  });
});

describe('Free on the Play page letterboxes instead of cropping', () => {
  it('fills an area at least square', () => {
    expect(playFreeFit(935, 756)).toBeNull();
    expect(playFreeFit(800, 800)).toBeNull();
    expect(playFreeFit(1600, 400)).toBeNull();
  });

  it('holds a narrower area to square, centred (no sides cut off)', () => {
    expect(PLAY_FREE_MIN_RATIO).toBe(1);
    expect(playFreeFit(490, 1150)).toEqual({ width: 490, height: 490 });
    expect(playFreeFit(520, 1096)).toEqual(fitAspect(520, 1096, 1));
    expect(playFreeFit(500, 700, 4 / 3)).toEqual({ width: 500, height: 375 });
  });

  it('leaves an unmeasured area alone', () => {
    expect(playFreeFit(0, 500)).toBeNull();
    expect(playFreeFit(500, 0)).toBeNull();
  });
});
