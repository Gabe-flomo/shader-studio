/** The Code page's tabs as navigation (CodeTabs.tsx draws them; the top bars and menus use these too). */
import { CODE_TABS, type CodeTab, type Page } from '../page';
import { popOutBuilder, setBuilderTab, useBuilderWindow } from '../nodePacks/builderWindow';

/** Which Code tab a page shows (Functions or Node packs: the builder's own tab). */
export function codeTabOf(page: Page, builderTab: 'functions' | 'packs'): CodeTab | null {
  if (page === 'glsl') return 'shader';
  if (page === 'convert') return 'convert';
  if (page === 'fn') return builderTab;
  return null;
}

/** Go to a Code tab. `phone`: Functions and Node packs open the builder full screen instead of a page. */
export function openCodeTab(tab: CodeTab, onPageChange: (p: Page) => void, phone = false): void {
  const def = CODE_TABS.find(t => t.id === tab)!;
  if (tab === 'functions' || tab === 'packs') {
    setBuilderTab(tab);
    // Popped out (or a phone, where it is always a full-screen window): show the window.
    if (phone || useBuilderWindow.getState().popped) { popOutBuilder(tab); return; }
  }
  onPageChange(def.page);
}

