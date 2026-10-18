// @vitest-environment jsdom
/**
 * Fewer top-level pages (docs/glossary.md): Studio · Play · Present · Code · Files. The old page
 * ids still work: `glsl`, `convert` and `fn` are the Code page's tabs, `code` opens it on the tab
 * used last, and the top bar lights Code for all of them. App settings and the Nodes reference are
 * windows now (the ⋯ menu and Help), not Files pages.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  const m = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); },
    key: () => null, get length() { return m.size; }, clear: () => m.clear(),
  });
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: false, media: q, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false }));
});

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { CODE_PAGES, CODE_TABS, isCodePage, lastCodePage, rememberCodePage, resolvePage, type Page } from '../../page';
import { DesktopTopNav } from '../DesktopTopNav';
import { CodeTabs } from '../CodeTabs';
import { codeTabOf, openCodeTab } from '../codeTabNav';
import { useBuilderWindow } from '../../nodePacks/builderWindow';
import { useAppDialogs } from '../appDialogStore';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLElement | null = null;
afterEach(() => { act(() => root?.unmount()); host?.remove(); root = null; host = null; });
beforeEach(() => { localStorage.clear(); useBuilderWindow.setState({ popped: false, tab: 'functions' }); });

function mount(node: React.ReactNode) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(node));
  return host;
}

describe('page ids', () => {
  it('the old pages are the Code page’s tabs', () => {
    for (const p of ['glsl', 'convert', 'fn', 'code'] as Page[]) expect(isCodePage(p), p).toBe(true);
    for (const p of ['studio', 'play', 'present', 'files', 'shortcuts'] as Page[]) expect(isCodePage(p), p).toBe(false);
    expect(CODE_TABS.map(t => t.label)).toEqual(['Shader', 'Convert', 'Functions', 'Node packs']);
    expect(CODE_TABS.map(t => t.page)).toEqual(['glsl', 'convert', 'fn', 'fn']);
  });

  it('`code` opens the tab used last (the shader editor at first); every other id is itself', () => {
    expect(resolvePage('code')).toBe('glsl');
    rememberCodePage('convert');
    expect(resolvePage('code')).toBe('convert');
    rememberCodePage('fn');
    expect(lastCodePage()).toBe('fn');
    // Only Code tabs are remembered.
    rememberCodePage('studio');
    expect(lastCodePage()).toBe('fn');
    for (const p of ['studio', 'play', 'present', 'files', 'shortcuts', ...CODE_PAGES] as Page[]) expect(resolvePage(p)).toBe(p);
  });

  it('a stored value that is not a Code tab falls back to the shader editor', () => {
    localStorage.setItem('playfield:codePage', 'studio');
    expect(lastCodePage()).toBe('glsl');
  });
});

describe('the top bar', () => {
  it('lights Code on every Code tab, and asks for `code` when clicked', () => {
    for (const page of ['glsl', 'convert', 'fn'] as Page[]) {
      const asked: Page[] = [];
      const el = mount(<DesktopTopNav page={page} onPageChange={p => asked.push(p)} onRecord={() => {}} />);
      const on = Array.from(el.querySelectorAll('[role="tab"][aria-selected="true"]')).map(t => t.textContent);
      expect(on, page).toEqual(['Code']);
      act(() => { (el.querySelector('[data-page-tab="code"]') as HTMLButtonElement).click(); });
      expect(asked).toEqual(['code']);
      act(() => root?.unmount()); host?.remove(); root = null;
    }
  });

  it('Help has the Nodes reference and ⋯ has App settings', () => {
    const el = mount(<DesktopTopNav page="studio" onPageChange={() => {}} onRecord={() => {}} />);
    act(() => { (el.querySelector('button[aria-label^="Help"]') as HTMLButtonElement).click(); });
    const help = Array.from(document.querySelectorAll('[role="menuitem"], [role="menu"] button')).map(b => b.textContent ?? '');
    expect(help.some(t => t.includes('Nodes reference'))).toBe(true);
    const nodes = Array.from(document.querySelectorAll('[role="menu"] button')).find(b => b.textContent?.includes('Nodes reference')) as HTMLButtonElement;
    act(() => { nodes.click(); });
    expect(useAppDialogs.getState().nodes).toEqual({ type: null });

    act(() => { (el.querySelector('button[aria-label^="More: App settings"]') as HTMLButtonElement).click(); });
    const settings = Array.from(document.querySelectorAll('[data-app-menu] button')).find(b => b.textContent?.includes('App settings')) as HTMLButtonElement;
    expect(settings).toBeTruthy();
    act(() => { settings.click(); });
    expect(useAppDialogs.getState().settings).toBe(true);
  });
});

describe('the Code page’s tabs', () => {
  it('know which tab a page is', () => {
    expect(codeTabOf('glsl', 'functions')).toBe('shader');
    expect(codeTabOf('convert', 'packs')).toBe('convert');
    expect(codeTabOf('fn', 'functions')).toBe('functions');
    expect(codeTabOf('fn', 'packs')).toBe('packs');
    expect(codeTabOf('studio', 'packs')).toBeNull();
  });

  it('go to the page, or set the builder’s tab (popping it out on a phone or when it is out)', () => {
    const asked: Page[] = [];
    openCodeTab('shader', p => asked.push(p));
    openCodeTab('packs', p => asked.push(p));
    expect(asked).toEqual(['glsl', 'fn']);
    expect(useBuilderWindow.getState().tab).toBe('packs');
    openCodeTab('functions', p => asked.push(p), true);
    expect(asked).toEqual(['glsl', 'fn']);
    expect(useBuilderWindow.getState()).toMatchObject({ popped: true, tab: 'functions' });
  });

  it('draw the four tabs with the current one on', () => {
    useBuilderWindow.setState({ tab: 'packs' });
    const el = mount(<CodeTabs page="fn" onPageChange={() => {}} />);
    const tabs = Array.from(el.querySelectorAll('[data-code-tabs] button')).map(b => ({ t: b.textContent, on: b.getAttribute('aria-checked') ?? b.getAttribute('aria-pressed') ?? b.getAttribute('aria-selected') }));
    expect(tabs.map(t => t.t?.replace(' · Pro', ''))).toEqual(['Shader', 'Convert', 'Functions', 'Node packs']);
    expect(tabs.find(t => t.on === 'true')?.t).toBe('Node packs');
  });
});
