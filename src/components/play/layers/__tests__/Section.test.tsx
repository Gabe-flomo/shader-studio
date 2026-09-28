// @vitest-environment jsdom
/**
 * Section: folds by default so an editor opens uncluttered, except the one
 * `primary` section per editor kind; folding is remembered per `<kind>:<title>`
 * (localStorage), and Expand all / Collapse all flips every registered
 * Section of a kind at once (docs/editor-layout.md).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Section } from '../Section';
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
  try { localStorage.clear(); } catch { /* ignore */ }
  usePlayUi.setState({ folded: {} });
});

describe('Section default fold', () => {
  it('a non-primary section starts folded', () => {
    const host = mount(<Section kind="widget" title="Extra"><div data-testid="body">stuff</div></Section>);
    expect(host.querySelector('[data-testid="body"]')).toBeNull();
    expect(host.querySelector('button')?.getAttribute('aria-expanded')).toBe('false');
  });

  it('the primary section starts open', () => {
    const host = mount(<Section kind="widget" title="Main" primary><div data-testid="body">stuff</div></Section>);
    expect(host.querySelector('[data-testid="body"]')).not.toBeNull();
    expect(host.querySelector('button')?.getAttribute('aria-expanded')).toBe('true');
  });

  it('a folded section with a summary shows it instead of the body', () => {
    const host = mount(<Section kind="widget" title="Extra" summary="2 things set"><div data-testid="body">stuff</div></Section>);
    expect(host.textContent).toContain('2 things set');
    expect(host.querySelector('[data-testid="body"]')).toBeNull();
  });
});

describe('Section folding is remembered', () => {
  it('clicking the heading flips it, and a fresh mount of the same kind:title reads it back', () => {
    const host = mount(<Section kind="widget" title="Extra"><div data-testid="body">stuff</div></Section>);
    const btn = host.querySelector('button')!;
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    act(() => btn.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(host.querySelector('button')?.getAttribute('aria-expanded')).toBe('true');

    // A second, independent mount of the same kind:title (a different layer of the same kind) reads the same state.
    const host2 = mount(<Section kind="widget" title="Extra"><div data-testid="body">stuff</div></Section>);
    expect(host2.querySelector('button')?.getAttribute('aria-expanded')).toBe('true');
  });

  it('a different kind keeps its own fold state', () => {
    mount(<Section kind="widget" title="Extra"><div>a</div></Section>);
    const btn = document.querySelector('button')!;
    act(() => btn.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    // widget:Extra is now open; gadget:Extra is unrelated and still folded.
    const host2 = mount(<Section kind="gadget" title="Extra"><div data-testid="body">b</div></Section>);
    expect(host2.querySelector('[data-testid="body"]')).toBeNull();
  });
});

describe('Expand all / Collapse all', () => {
  it('expandAllSections opens every registered Section of that kind', () => {
    mount(
      <>
        <Section kind="stack" title="One"><div>a</div></Section>
        <Section kind="stack" title="Two"><div>b</div></Section>
        <Section kind="stack" title="Three" primary><div>c</div></Section>
      </>,
    );
    expect(usePlayUi.getState().folded['stack:One']).toBeUndefined();
    act(() => usePlayUi.getState().expandAllSections('stack'));
    expect(usePlayUi.getState().folded['stack:One']).toBe(false);
    expect(usePlayUi.getState().folded['stack:Two']).toBe(false);
  });

  it('collapseAllSections folds every registered Section of that kind, including the primary one', () => {
    mount(
      <>
        <Section kind="stack2" title="One" primary><div>a</div></Section>
        <Section kind="stack2" title="Two"><div>b</div></Section>
      </>,
    );
    act(() => usePlayUi.getState().collapseAllSections('stack2'));
    expect(usePlayUi.getState().folded['stack2:One']).toBe(true);
    expect(usePlayUi.getState().folded['stack2:Two']).toBe(true);
  });

  it('does nothing for a kind with no mounted Section', () => {
    expect(() => usePlayUi.getState().expandAllSections('nobody-here')).not.toThrow();
  });
});
