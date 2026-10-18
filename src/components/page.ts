/**
 * The app's top-level pages, switched from the top bar: Studio · Play · Present · Code · Files
 * (docs/glossary.md). The Code page has four tabs, and three of them keep the page ids they had
 * when they were pages of their own (`glsl`, `convert`, `fn`), so every deep link, saved state and
 * `requestPage` call still lands in the right place. `code` asks for the Code page on the tab used
 * last. `shortcuts` is the keyboard shortcuts page, reached from Help.
 */
export type Page = 'studio' | 'play' | 'present' | 'shortcuts' | 'code' | 'glsl' | 'fn' | 'convert' | 'files';

/** A tab of the Code page. Functions and Node packs are both the `fn` page (the builder's own tab picks which). */
export type CodeTab = 'shader' | 'convert' | 'functions' | 'packs';

/** The pages the Code page shows, one per tab (Functions and Node packs share `fn`). */
export const CODE_PAGES: readonly Page[] = ['glsl', 'convert', 'fn'];

export function isCodePage(p: Page): boolean {
  return p === 'code' || CODE_PAGES.includes(p);
}

/** The Code page's tabs, in order, with the page each shows. */
export const CODE_TABS: ReadonlyArray<{ id: CodeTab; page: Page; label: string; hint: string }> = [
  { id: 'shader', page: 'glsl', label: 'Shader', hint: 'Write a fragment shader by hand, run it, explain it, discover functions in it' },
  { id: 'convert', page: 'convert', label: 'Convert', hint: 'Paste GLSL, preview the nodes it becomes, make it real' },
  { id: 'functions', page: 'fn', label: 'Functions', hint: 'Plot and compose functions, then send them to the graph' },
  { id: 'packs', page: 'fn', label: 'Node packs', hint: 'Make and share packs of node types' },
];

const LAST_CODE_KEY = 'playfield:codePage';

/** The Code page tab last shown on this device (`glsl`, `convert` or `fn`), the shader editor at first. */
export function lastCodePage(): Page {
  try {
    const v = localStorage.getItem(LAST_CODE_KEY);
    if (v && CODE_PAGES.includes(v as Page)) return v as Page;
  } catch { /* blocked storage: the default */ }
  return 'glsl';
}

export function rememberCodePage(p: Page): void {
  if (!CODE_PAGES.includes(p)) return;
  try { localStorage.setItem(LAST_CODE_KEY, p); } catch { /* not remembered */ }
}

/** The page to show for a request: `code` becomes the Code page's last tab; anything else is itself. */
export function resolvePage(p: Page): Page {
  return p === 'code' ? lastCodePage() : p;
}

/** Ask the app to show a page (App listens). For code with no navigate callback at hand. */
export const NAVIGATE_EVENT = 'playfield-navigate';
export function requestPage(page: Page): void {
  try { window.dispatchEvent(new CustomEvent<Page>(NAVIGATE_EVENT, { detail: page })); } catch { /* no window in tests */ }
}
