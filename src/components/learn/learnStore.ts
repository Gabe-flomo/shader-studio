/**
 * learnStore — the desktop Start sheet and the Learn lessons (UX audit §3.2):
 *
 * - Start: the first time Playfield opens on a desktop (or a tablet), a sheet offers the ways in:
 *   Examples, the Scene builder, the "Getting started" lesson, or a blank graph. Once per device,
 *   skippable; Help → Start… opens it again.
 * - Learn: the lessons on using Playfield itself ("Learn the app"), moved out of Present (which
 *   keeps authoring). Opened from Help → Learn the app…, the Start sheet, Present's menu and the
 *   phone's More menu.
 *
 * Storage that throws (private mode) never shows the Start sheet twice in a session and never
 * breaks the page (the phone welcome's rule, shell/phoneWelcome.ts).
 */
import { create } from 'zustand';

export const START_SHEET_KEY = 'playfield.startSheetShown';

interface LearnUi {
  startOpen: boolean;
  learnOpen: boolean;
  openStart: () => void;
  closeStart: () => void;
  openLearn: () => void;
  closeLearn: () => void;
}

export const useLearnUi = create<LearnUi>(set => ({
  startOpen: false,
  learnOpen: false,
  openStart: () => set({ startOpen: true, learnOpen: false }),
  closeStart: () => set({ startOpen: false }),
  openLearn: () => set({ learnOpen: true, startOpen: false }),
  closeLearn: () => set({ learnOpen: false }),
}));

type Store = Pick<Storage, 'getItem' | 'setItem'>;

function defaultStore(): Store | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
}

let shownThisSession = false;

/** Whether to offer the Start sheet now: not a phone (it has its own welcome), on the Studio, never shown on this device. */
export function shouldShowStartSheet(opts: { phone: boolean; page: string }, store: Store | null = defaultStore()): boolean {
  if (opts.phone || opts.page !== 'studio' || shownThisSession) return false;
  try { return !store || store.getItem(START_SHEET_KEY) == null; } catch { return true; }
}

/** Remember it was shown (and, whatever the storage does, don't show it again this session). */
export function markStartSheetShown(store: Store | null = defaultStore()): void {
  shownThisSession = true;
  try { store?.setItem(START_SHEET_KEY, '1'); } catch { /* private mode: the session flag covers it */ }
}

/** Tests only. */
export function resetStartSheetSession(): void { shownThisSession = false; }
