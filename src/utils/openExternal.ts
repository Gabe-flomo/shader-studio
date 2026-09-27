/**
 * openExternal — follow an https:// link out of the app. In a browser the
 * link's own target="_blank" does it; the desktop app's webview ignores that,
 * so there the link asks the app to open the system browser (open_url).
 */
const isDesktopApp = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/** Call from a link's onClick: in the desktop app it stops the click and opens the system browser instead. */
export function openExternal(url: string, e?: { preventDefault(): void }): void {
  if (!isDesktopApp() || !/^https:\/\//.test(url)) return;
  e?.preventDefault();
  void import('@tauri-apps/api/core')
    .then(({ invoke }) => invoke('open_url', { url }))
    .catch(() => { window.open(url, '_blank', 'noopener'); });
}
