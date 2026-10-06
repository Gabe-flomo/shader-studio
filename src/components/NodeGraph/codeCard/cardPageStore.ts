import { create } from 'zustand';
import type { CardPageId } from './codeCardModel';

/**
 * Which carousel page each code card shows, remembered per node id. UI-only: kept outside the
 * graph (flipping a page never recompiles or lands in undo) and saved in localStorage so it
 * survives a reload. Storage can be missing or throw (private windows): then it lasts the session.
 */
export const CARD_PAGE_STORAGE_KEY = 'shader-studio:code-card-pages';
const MAX_REMEMBERED = 400;

export function loadCardPages(): Record<string, CardPageId> {
  try {
    const raw = localStorage.getItem(CARD_PAGE_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, CardPageId> = {};
    for (const [k, v] of Object.entries(parsed)) if (v === 'code' || v === 'signature' || v === 'note' || v === 'description') out[k] = v;
    return out;
  } catch { return {}; }
}

function save(pages: Record<string, CardPageId>) {
  try { localStorage.setItem(CARD_PAGE_STORAGE_KEY, JSON.stringify(pages)); } catch { /* session only */ }
}

export const useCardPages = create<{
  pages: Record<string, CardPageId>;
  setPage: (nodeId: string, page: CardPageId) => void;
  /** Re-read storage (tests, or another window). */
  reload: () => void;
}>(set => ({
  pages: loadCardPages(),
  setPage: (nodeId, page) => set(s => {
    if (s.pages[nodeId] === page) return s;
    const { [nodeId]: _old, ...rest } = s.pages;
    void _old;
    const next: Record<string, CardPageId> = { ...rest, [nodeId]: page };
    // Oldest first: drop the earliest entries past the cap
    const keys = Object.keys(next);
    for (let i = 0; i < keys.length - MAX_REMEMBERED; i++) delete next[keys[i]];
    save(next);
    return { pages: next };
  }),
  reload: () => set({ pages: loadCardPages() }),
}));
