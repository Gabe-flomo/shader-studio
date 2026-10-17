/**
 * cardFolds.ts — which of the Agent Builder's behaviour cards are folded to their one-line summary
 * (docs/agent-builder.md, "Folding"). The app's collapsed-by-default rule: in a section the primary
 * card starts open (the first card, or the section's own settings card when it has one) and every
 * other card starts folded, showing "Gravity · 0.4 down". What you open or fold is remembered per
 * section and card (`gravity#0` in Forces), for the session and, where the browser allows, between
 * sessions (localStorage). UI only: folding never touches the rules or the graph.
 */
import { create } from 'zustand';

const STORE_KEY = 'agentBuilder:cardFolds';

/** The key a card's fold is remembered by: its section and its stable card key (behaviours.ts `gravity#0`). */
export const cardFoldKey = (section: string, cardKey: string): string => `${section}:${cardKey}`;

/**
 * Whether a card is open: what was chosen for it, else its start (the section's first card open when
 * `firstOpen`, every other one folded).
 */
export function cardIsOpen(stored: boolean | undefined, index: number, firstOpen = true): boolean {
  if (stored !== undefined) return stored;
  return firstOpen && index === 0;
}

/** A folded card's one line: its name and what it does with its key numbers ("Gravity · 0.4 down"); muted cards say so. */
export function foldedLine(title: string, summary: string | undefined, on = true): string {
  return [title, summary, on ? '' : 'muted'].filter(Boolean).join(' · ');
}

/** For card summaries (SectionCards.tsx cardSummary): a direction in degrees as a word where there is one (−90: down, 90: up, 0: right, 180: left), else "at 30°". */
export function directionWord(deg: number): string {
  const d = ((Math.round(deg) % 360) + 540) % 360 - 180;
  if (d === -90) return 'down';
  if (d === 90) return 'up';
  if (d === 0) return 'right';
  if (d === -180) return 'left';
  return `at ${d}°`;
}

function load(): Record<string, boolean> {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(STORE_KEY) : null;
    const v = raw ? JSON.parse(raw) as unknown : null;
    return v && typeof v === 'object' ? v as Record<string, boolean> : {};
  } catch { return {}; }
}
function save(open: Record<string, boolean>): void {
  try { if (typeof localStorage !== 'undefined') localStorage.setItem(STORE_KEY, JSON.stringify(open)); } catch { /* private window: this session only */ }
}

export const useCardFolds = create<{
  open: Record<string, boolean>;
  /** Open (true) or fold (false) these cards. */
  set: (keys: string | readonly string[], open: boolean) => void;
}>(set => ({
  open: load(),
  set: (keys, open) => set(s => {
    const next = { ...s.open };
    for (const k of typeof keys === 'string' ? [keys] : keys) next[k] = open;
    save(next);
    return { open: next };
  }),
}));
