/**
 * phoneWelcome — the first time Playfield opens on a phone, the Browse sheet opens on Examples with
 * a short welcome (what's where, and a "Start a new scene" button), so a first visit doesn't land on
 * an unexplained graph. Once per device; a storage that throws (private mode) never shows it twice
 * in a session either, and never breaks the page.
 */

export const PHONE_WELCOME_KEY = 'shader-studio:phone-welcomed';

type Store = Pick<Storage, 'getItem' | 'setItem'>;

function defaultStore(): Store | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
}

let shownThisSession = false;

/** Whether to show the welcome now (a phone, on the Studio, never welcomed on this device). */
export function shouldWelcomePhone(opts: { phone: boolean; page: string }, store: Store | null = defaultStore()): boolean {
  if (!opts.phone || opts.page !== 'studio' || shownThisSession) return false;
  try { return !store || store.getItem(PHONE_WELCOME_KEY) == null; } catch { return true; }
}

/** Remember the welcome was shown (and, whatever the storage does, don't show it again this session). */
export function markPhoneWelcomed(store: Store | null = defaultStore()): void {
  shownThisSession = true;
  try { store?.setItem(PHONE_WELCOME_KEY, '1'); } catch { /* private mode: the session flag covers it */ }
}

/** Tests only. */
export function resetPhoneWelcomeSession(): void { shownThisSession = false; }
