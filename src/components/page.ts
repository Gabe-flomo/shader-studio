/** The app's top-level pages, switched from the top bar. */
export type Page = 'studio' | 'play' | 'present' | 'shortcuts' | 'glsl' | 'fn' | 'convert' | 'files';

/** Ask the app to show a page (App listens). For code with no navigate callback at hand. */
export const NAVIGATE_EVENT = 'playfield-navigate';
export function requestPage(page: Page): void {
  try { window.dispatchEvent(new CustomEvent<Page>(NAVIGATE_EVENT, { detail: page })); } catch { /* no window in tests */ }
}
