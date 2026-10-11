/**
 * recentNodes.ts — the node types you added most recently by hand (the node search and the node
 * browser), newest first. The node search shows them as a Recent tile and leans on them for its
 * Related results (docs/node-browser.md, "Node search"). Kept in this browser only.
 */
export const RECENT_NODES_KEY = 'playfield:recentNodes';
const LIMIT = 16;

export function recentNodes(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_NODES_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((t): t is string => typeof t === 'string').slice(0, LIMIT) : [];
  } catch {
    return [];
  }
}

export function recordRecentNode(type: string): void {
  const next = [type, ...recentNodes().filter(t => t !== type)].slice(0, LIMIT);
  try { localStorage.setItem(RECENT_NODES_KEY, JSON.stringify(next)); } catch { /* private mode: not remembered */ }
}

/** The favourites the node browser keeps (NodePalette.tsx), read for the node search's tile. */
export const FAVORITES_KEY = 'nodepalette_favorites';

export function favoriteNodes(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(FAVORITES_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((t): t is string => typeof t === 'string') : [];
  } catch {
    return [];
  }
}

export function toggleFavoriteNode(type: string): string[] {
  const prev = favoriteNodes();
  const next = prev.includes(type) ? prev.filter(t => t !== type) : [...prev, type];
  try { localStorage.setItem(FAVORITES_KEY, JSON.stringify(next)); } catch { /* not remembered */ }
  return next;
}
