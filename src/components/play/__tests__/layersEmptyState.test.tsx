// @vitest-environment jsdom
/**
 * The Layers page's empty state ("No layers yet") offers its own Add layer and
 * Layer sets… buttons — not just the header's, off to the side or missing at
 * some panel widths. Both open the same Add layer menu the header's button does.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { LayersPanel } from '../LayersPanel';
import { emptyPlayRecord } from '../../../types/play';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mounted: Array<{ root: Root; host: HTMLElement }> = [];
function mount(ui: React.ReactElement) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(ui));
  mounted.push({ root, host });
  return { host };
}
afterEach(() => { for (const m of mounted.splice(0)) { act(() => m.root.unmount()); m.host.remove(); } });

function click(el: Element) { act(() => el.dispatchEvent(new MouseEvent('click', { bubbles: true }))); }
const byText = (host: HTMLElement, text: string) => Array.from(host.querySelectorAll('button')).find(b => b.textContent?.trim() === text);

describe('Layers page: empty state actions', () => {
  it('shows an Add layer button in the empty state that opens the Add layer menu', () => {
    const { host } = mount(
      <LayersPanel play={emptyPlayRecord()} touch={false} exposedTargets={new Set()} onChange={() => {}} onExpose={() => {}} />,
    );
    expect(host.textContent).toContain('No layers yet');
    const buttons = Array.from(host.querySelectorAll('button')).filter(b => b.textContent?.trim() === 'Add layer');
    // The header's, and the empty state's.
    expect(buttons.length).toBe(2);
    expect(document.querySelector('[aria-label="Layer kinds"]')).toBeFalsy();
    click(buttons[1]);
    expect(document.querySelector('[aria-label="Layer kinds"]')).toBeTruthy();
  });

  it('shows a Layer sets… button in the empty state that opens the same menu', () => {
    const { host } = mount(
      <LayersPanel play={emptyPlayRecord()} touch={false} exposedTargets={new Set()} onChange={() => {}} onExpose={() => {}} />,
    );
    const setsBtn = byText(host, 'Layer sets…');
    expect(setsBtn).toBeTruthy();
    click(setsBtn!);
    expect(document.querySelector('[aria-label="Search layers"]')).toBeTruthy();
  });

  it('adding a layer picks up the built-in kinds from the menu opened by the empty state button', () => {
    let latest = emptyPlayRecord();
    const { host, } = mount(
      <LayersPanel play={latest} touch={false} exposedTargets={new Set()} onChange={fn => { latest = fn(latest); }} onExpose={() => {}} />,
    );
    const addBtns = Array.from(host.querySelectorAll('button')).filter(b => b.textContent?.trim() === 'Add layer');
    click(addBtns[1]);
    const shapeRow = Array.from(document.querySelectorAll('button[role="menuitem"]')).find(b => b.textContent?.includes('Shape'));
    expect(shapeRow).toBeTruthy();
  });
});
