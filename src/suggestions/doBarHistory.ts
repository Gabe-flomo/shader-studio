/**
 * doBarHistory.ts — what you typed in the Do… bar, newest last (§13 decision 5: history keeps what
 * was typed, not its canonical line). ↑ and ↓ in the bar walk it. Kept in this browser; at most 60.
 */
const KEY = 'playfield:dobar:history';
const MAX = 60;

export function readHistory(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch { return []; }
}

export function pushHistory(text: string): void {
  const t = text.trim();
  if (!t) return;
  const list = readHistory().filter(x => x !== t);
  list.push(t);
  try { localStorage.setItem(KEY, JSON.stringify(list.slice(-MAX))); } catch { /* per session */ }
}

/** The entry `step` back from `index` (index = list length: the line being typed). */
export function historyAt(list: readonly string[], index: number): string | null {
  return index >= 0 && index < list.length ? list[index] : null;
}
