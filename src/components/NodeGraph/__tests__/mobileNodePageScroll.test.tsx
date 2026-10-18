// @vitest-environment jsdom
/**
 * A phone's node page is ONE scroller: the flow chip, breadcrumb, card face, Inputs/Output tabs and
 * the rows all scroll together, only the node's own header row (48px) sticks, and nothing inside
 * scrolls on its own (a scroller in a scroller traps the finger in a thin strip).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} });
});

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useNodeGraphStore } from '../../../store/useNodeGraphStore';
import { MobileGraphBrowser } from '../MobileGraphBrowser';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext'];
if (!('ResizeObserver' in globalThis)) vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });

let root: Root | null = null;
let host: HTMLDivElement;

beforeEach(() => {
  host = document.createElement('div');
  host.style.height = '400px';
  document.body.appendChild(host);
});
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host.remove();
});

const scrolls = (el: Element) => /(auto|scroll)/.test((el as HTMLElement).style.overflowY) || /(auto|scroll)/.test((el as HTMLElement).style.overflow);

function openNode(label: string) {
  const btn = [...host.querySelectorAll('button')].find(b => b.textContent?.trim() === label);
  expect(btn, `a button for ${label} on the phone's graph list`).toBeTruthy();
  act(() => { btn!.click(); });
}

describe('phone node page', () => {
  it('is one scroller with only the node header sticky', () => {
    const id = useNodeGraphStore.getState().addNode('exprNode', { x: 0, y: 0 }, { label: 'Side by side' });
    expect(id).toBeTruthy();
    root = createRoot(host);
    act(() => root!.render(<MobileGraphBrowser top={<div data-test-top>flow</div>} />));
    openNode('Side by side');

    const scroller = host.querySelector<HTMLElement>('[data-phone-page-scroll]');
    expect(scroller).toBeTruthy();
    expect(scroller!.style.overflowY).toBe('auto');
    expect(scroller!.style.flex).toMatch(/^1/);

    // The flow chip and the breadcrumb are inside the scroller (they scroll away), before the page.
    expect(scroller!.querySelector('[data-test-top]')).toBeTruthy();
    expect(scroller!.textContent).toContain('Home');
    const page = scroller!.querySelector<HTMLElement>('[data-node-page]');
    expect(page).toBeTruthy();

    // Nothing inside the page scrolls vertically on its own (the CodeCard's capped code box aside).
    const inner = [...page!.querySelectorAll<HTMLElement>('*')].filter(el => scrolls(el) && !el.closest('[data-code-card], pre'));
    const vertical = inner.filter(el => el.style.overflowY === 'auto' || el.style.overflowY === 'scroll' || el.style.overflow === 'auto');
    expect(vertical.map(el => el.outerHTML.slice(0, 80))).toEqual([]);

    // Exactly one sticky row: the node header, 48px.
    const sticky = [...scroller!.querySelectorAll<HTMLElement>('*')].filter(el => el.style.position === 'sticky');
    expect(sticky).toHaveLength(1);
    expect(sticky[0].hasAttribute('data-node-page-header')).toBe(true);
    expect(sticky[0].firstElementChild && (sticky[0].firstElementChild as HTMLElement).style.height).toBe('48px');
    expect(sticky[0].textContent).toContain('Side by side');
  });
});
