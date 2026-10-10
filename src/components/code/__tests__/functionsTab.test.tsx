// @vitest-environment jsdom
/**
 * The function palette's fold tab (SidePanels.tsx FunctionsTab): a slim strip on the editor's
 * right edge instead of a header button. A click opens the palette beside it, another folds it,
 * and the choice is remembered (editorPanelPrefs.ts) for the next editor and the next session.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { FunctionsTab, useEditorSidePanels } from '../SidePanels';
import { EDITOR_PANELS_KEY, useEditorPanels } from '../editorPanelPrefs';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const PANELS = ['functions'] as const;

function Harness() {
  const { narrow, open, toggle } = useEditorSidePanels(PANELS);
  return (
    <div style={{ display: 'flex' }}>
      <div>code</div>
      {!(narrow && open.functions) && <FunctionsTab open={open.functions} onToggle={() => toggle('functions')} />}
      {open.functions && <div data-testid="palette">palette</div>}
    </div>
  );
}

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  localStorage.clear();
  useEditorPanels.getState().reload();
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1400 });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

const tab = () => host.querySelector<HTMLButtonElement>('[data-panel-tab="functions"]')!;
const palette = () => host.querySelector('[data-testid="palette"]');

describe('the Functions fold tab', () => {
  it('starts folded: a ‹ ƒ strip, no palette, no header button', () => {
    act(() => root.render(<Harness />));
    expect(tab()).not.toBeNull();
    expect(tab().getAttribute('aria-expanded')).toBe('false');
    expect(tab().textContent).toContain('Functions');
    expect(palette()).toBeNull();
    expect(host.querySelector('[data-panel-toggle]')).toBeNull();
  });

  it('opens and folds the palette, and remembers the choice', () => {
    act(() => root.render(<Harness />));
    act(() => tab().click());
    expect(palette()).not.toBeNull();
    expect(tab().getAttribute('aria-expanded')).toBe('true');
    expect(JSON.parse(localStorage.getItem(EDITOR_PANELS_KEY)!).functions).toBe(true);

    // A new editor (and a new session) opens it again
    act(() => root.unmount());
    root = createRoot(host);
    useEditorPanels.getState().reload();
    act(() => root.render(<Harness />));
    expect(palette()).not.toBeNull();

    act(() => tab().click());
    expect(palette()).toBeNull();
    expect(JSON.parse(localStorage.getItem(EDITOR_PANELS_KEY)!).functions).toBe(false);
  });

  it('⌘] still toggles it', () => {
    act(() => root.render(<Harness />));
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: ']', metaKey: true })); });
    expect(palette()).not.toBeNull();
  });
});
