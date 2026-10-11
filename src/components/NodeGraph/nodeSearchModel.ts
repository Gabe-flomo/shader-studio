/**
 * nodeSearchModel.ts — the node search's logic (NodeSearchPalette.tsx, docs/node-browser.md "Node
 * search"), kept apart from the component so it can be tested without a DOM.
 *
 *  - Categories: the library's rows (libraryRows.ts) as tiles, by section, with counts.
 *  - Matches: text matches, best first by tier: the exact name, then a name prefix, then a word
 *    prefix, then fuzzy (a substring or the letters in order), then keywords (the "leads for"
 *    words like Transform's "move", old names, the category, the description).
 *  - Related: what fits where you are, whatever you typed: nodes that usually follow the node you
 *    came from (your graphs and the examples), and nodes you added recently. Opened from a selected
 *    node, only nodes that can take one of its outputs (wireFit.canFollow).
 *  - Keyboard: arrows across tile grids and lists, Tab from one group to the next.
 */
import type { NodeDefinition } from '../../types/nodeGraph';
import type { IconName } from '../ui/iconPaths';
import type { ctp } from '../../theme/palette';
import { getAllCategories, getNodeDefinition, getNodesByCategory } from '../../nodes/definitions';
import { CATEGORY_ORDER, CATEGORY_SECTIONS, nodesOfRow } from './libraryRows';
import { CATEGORY_ROLES } from './nodeCategoryMeta';
import { DYNAMIC_SOCKET_TYPES, canFollow, fitsWireInsert } from './wireFit';

/** How many results lead, as big tiles; the rest are a list under them. */
export const TOP_COUNT = 8;

// ── Text matching ─────────────────────────────────────────────────────────────

/** Match tiers, best first. */
export const TIER = { exact: 5, prefix: 4, word: 3, fuzzy: 2, keyword: 1 } as const;
export type Tier = typeof TIER[keyof typeof TIER];

/** A label's words: spaces and punctuation split them, and so do camelCase humps ("sdBox" → sd, box). */
export function wordsOf(s: string): string[] {
  return s
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** The letters of `q` in order inside `s`, starting at a word start; how tight the run is (0…1), or 0. */
function fuzzy(s: string, q: string): number {
  if (q.length < 2) return 0;
  let best = 0;
  for (let start = s.indexOf(q[0]); start >= 0; start = s.indexOf(q[0], start + 1)) {
    if (start > 0 && /[a-z0-9]/.test(s[start - 1])) continue; // a word start only
    let i = start, k = 0;
    while (i < s.length && k < q.length) { if (s[i] === q[k]) k++; i++; }
    if (k < q.length) break;
    const span = i - start;
    if (span > Math.max(q.length * 2.5, q.length + 4)) continue;
    best = Math.max(best, q.length / span);
  }
  return best;
}

const descText = (def: NodeDefinition) => {
  const raw = def.description as string | string[] | undefined;
  return (Array.isArray(raw) ? raw.join(' ') : (raw ?? '')).toLowerCase();
};

export interface TextMatch { tier: Tier; /** Order within the tier, 0…1, higher first. */ sub: number }

/** How `def` matches `query`, or null. */
export function textMatch(def: NodeDefinition, query: string): TextMatch | null {
  const q = query.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!q) return null;
  const label = def.label.toLowerCase();
  if (label === q) return { tier: TIER.exact, sub: 1 };
  if (label.startsWith(q)) return { tier: TIER.prefix, sub: q.length / label.length };

  const words = wordsOf(def.label);
  const qWords = q.split(' ').filter(Boolean);
  // Every word typed starts a different word of the name ("blur gau" finds Gaussian Blur).
  const used = new Set<number>();
  const wordHit = qWords.every(qw => {
    const i = words.findIndex((w, j) => !used.has(j) && w.startsWith(qw));
    if (i < 0) return false;
    used.add(i);
    return true;
  });
  if (wordHit) return { tier: TIER.word, sub: 1 - Math.min(...used) / Math.max(1, words.length) };

  if (label.includes(q)) return { tier: TIER.fuzzy, sub: 1 };
  const compact = q.replace(/ /g, '');
  if (def.type.toLowerCase().includes(compact)) return { tier: TIER.fuzzy, sub: 0.9 };
  const f = fuzzy(label, compact);
  if (f > 0) return { tier: TIER.fuzzy, sub: 0.8 * f };

  // Keywords: the "leads for" words, old names, the category, the description.
  if (q.length >= 3 && def.leadsFor?.some(w => w.toLowerCase().startsWith(q))) return { tier: TIER.keyword, sub: 1 };
  const aliases = (def.aliases ?? []).map(a => a.toLowerCase());
  if (aliases.some(a => a === q || a.startsWith(q))) return { tier: TIER.keyword, sub: 0.9 };
  if (aliases.some(a => a.includes(q))) return { tier: TIER.keyword, sub: 0.7 };
  if (wordsOf(def.category ?? '').some(w => w.startsWith(q))) return { tier: TIER.keyword, sub: 0.4 };
  const desc = descText(def);
  if (desc.split(/\W+/).some(w => w === q)) return { tier: TIER.keyword, sub: 0.2 };
  // Several words, each found somewhere (name, old names, description).
  if (qWords.length > 1) {
    const hay = [label, ...aliases, desc, (def.leadsFor ?? []).join(' ').toLowerCase()].join(' ');
    if (qWords.every(w => hay.includes(w))) return { tier: TIER.keyword, sub: 0.1 };
  }
  return null;
}

export interface RankedMatch { def: NodeDefinition; tier: Tier; sub: number }

export interface RankOptions {
  /** How well a type fits where you are, 0…1 (usually-next, recent): orders within a tier. */
  context?: (type: string) => number;
  /** A node for another kind of graph (2D in 3D…): last within its tier. */
  misfit?: (def: NodeDefinition) => boolean;
}

/** The text matches for `query`, best first: by tier, then closeness, then fit, then name. */
export function rankMatches(defs: readonly NodeDefinition[], query: string, opts: RankOptions = {}): RankedMatch[] {
  const out: Array<RankedMatch & { key: number }> = [];
  for (const def of defs) {
    const m = textMatch(def, query);
    if (!m) continue;
    const key = m.sub + 0.5 * Math.min(1, opts.context?.(def.type) ?? 0) - (opts.misfit?.(def) ? 2 : 0);
    out.push({ def, ...m, key });
  }
  return out
    .sort((a, b) => b.tier - a.tier || b.key - a.key || a.def.label.localeCompare(b.def.label))
    .map(({ def, tier, sub }) => ({ def, tier, sub }));
}

// ── Related ───────────────────────────────────────────────────────────────────

export interface RelatedContext {
  /** The node you came from: the wire's end, or the selected node. */
  fromType?: string | null;
  fromLabel?: string | null;
  /** How strongly a type goes with `fromType` in your graphs and the examples' prior, 0…1 (suggestions/rank affinity). */
  affinity?: (type: string) => number;
  /** How often each type follows `fromType` in the examples (structure/relevance follow counts). */
  follows?: ReadonlyMap<string, number> | null;
  /** Recently added types, newest first. */
  recents?: readonly string[];
  /**
   * The selected node's output types, when the search was opened from a node (not a wire): only
   * nodes that can take one of them are related (wireFit.canFollow — float broadcasts, genType
   * nodes take the vector type).
   */
  outTypes?: readonly string[] | null;
}

export interface RelatedPick { def: NodeDefinition; score: number; why: string }

const maxes = new WeakMap<ReadonlyMap<string, number>, number>();
const maxOf = (m: ReadonlyMap<string, number>) => {
  let v = maxes.get(m);
  if (v === undefined) { v = Math.max(0, ...m.values()); maxes.set(m, v); }
  return v;
};

/** A type's fit where you are, 0…1 (no text involved). */
export function contextScore(type: string, ctx: RelatedContext): number {
  const aff = ctx.fromType ? Math.min(1, (ctx.affinity?.(type) ?? 0) * 3) : 0;
  let follow = 0;
  if (ctx.fromType && ctx.follows && ctx.follows.size) {
    // Square root: the examples' long tail still counts (2 of 20 is a real habit, not noise).
    const max = maxOf(ctx.follows);
    follow = max > 0 ? Math.sqrt((ctx.follows.get(type) ?? 0) / max) : 0;
  }
  const r = ctx.recents?.indexOf(type) ?? -1;
  const recent = r >= 0 ? 1 - r / Math.max(8, ctx.recents!.length) : 0;
  return Math.min(1, 0.6 * Math.max(aff, follow) + 0.25 * Math.min(aff, follow) + 0.3 * recent);
}

/** Related nodes, best first: usually next after the node you came from, then recent ones. Leaves out `exclude`. */
export function rankRelated(defs: readonly NodeDefinition[], ctx: RelatedContext, exclude: ReadonlySet<string> = new Set(), limit = 12): RelatedPick[] {
  const out: RelatedPick[] = [];
  for (const def of defs) {
    if (exclude.has(def.type) || (ctx.fromType && def.type === ctx.fromType && !ctx.recents?.includes(def.type))) continue;
    if (ctx.outTypes && !canFollow(def, ctx.outTypes)) continue;
    const score = contextScore(def.type, ctx);
    if (score < 0.08) continue;
    const aff = ctx.fromType ? (ctx.affinity?.(def.type) ?? 0) : 0;
    const fol = ctx.fromType ? (ctx.follows?.get(def.type) ?? 0) : 0;
    const why = (aff > 0.02 || fol > 0) && ctx.fromLabel ? `Usually goes with ${ctx.fromLabel}` : 'Used recently';
    out.push({ def, score, why });
  }
  return out.sort((a, b) => b.score - a.score || a.def.label.localeCompare(b.def.label)).slice(0, limit);
}

// ── Wire filters ──────────────────────────────────────────────────────────────

/**
 * A node that can feed a socket of `filterOutputType` and/or take a wire of `filterInputType`
 * (a float goes anywhere). With both, it is the insert-on-wire picker (wire from `filterInputType`
 * to `filterOutputType`), which also takes genType nodes in the wire's type (wireFit.ts).
 */
export function passesWireFilter(def: NodeDefinition, filterOutputType?: string, filterInputType?: string): boolean {
  if (filterOutputType && filterInputType) return fitsWireInsert(def, filterInputType, filterOutputType);
  if (filterOutputType && !Object.values(def.outputs).some(o => o.type === filterOutputType || o.type === 'float')) return false;
  if (filterInputType && !DYNAMIC_SOCKET_TYPES.has(def.type)
    && !Object.values(def.inputs).some(i => i.type === filterInputType || filterInputType === 'float')) return false;
  return true;
}

// ── Categories ────────────────────────────────────────────────────────────────

type Role = keyof typeof ctp;

/** Each library section's icon and colour (a Catppuccin role, resolved by the theme). */
export const SECTION_LOOK: Record<string, { icon: IconName; role: Role }> = {
  '2D tools': { icon: 'grid', role: 'yellow' },
  '3D tools': { icon: 'cube', role: 'blue' },
  'Shape operations': { icon: 'mask', role: 'pink' },
  Colour: { icon: 'sun', role: 'peach' },
  Effects: { icon: 'bolt', role: 'red' },
  Agents: { icon: 'swarm', role: 'green' },
  Generators: { icon: 'wave', role: 'sapphire' },
  'Math & Logic': { icon: 'hash', role: 'lavender' },
  Functions: { icon: 'fn', role: 'sky' },
  Utility: { icon: 'sliders', role: 'teal' },
  More: { icon: 'nodes', role: 'overlay1' },
};

export interface CategoryTile {
  row: string;
  section: string;
  count: number;
  /** A few of its node names, for the tile's preview line. */
  preview: string[];
  role: Role;
  icon: IconName;
}

export interface CategorySection { label: string; tiles: CategoryTile[] }

/** The library's rows as tiles, by section, counting only the nodes `accept` lets through. */
export function categorySections(accept: (def: NodeDefinition) => boolean): CategorySection[] {
  const tile = (row: string, section: string, defs: NodeDefinition[]): CategoryTile | null => {
    const list = defs.filter(accept);
    if (!list.length) return null;
    const look = SECTION_LOOK[section] ?? SECTION_LOOK.More;
    return {
      row, section, count: list.length,
      preview: [...list].sort((a, b) => a.label.localeCompare(b.label)).slice(0, 3).map(d => d.label),
      role: CATEGORY_ROLES[row] ?? look.role, icon: look.icon,
    };
  };
  const out: CategorySection[] = CATEGORY_SECTIONS.map(sec => ({
    label: sec.label,
    tiles: sec.categories.map(c => tile(c, sec.label, nodesOfRow(c))).filter((t): t is CategoryTile => !!t),
  }));
  // Categories no section lists (node packs by name, new ones).
  const extra = getAllCategories().filter(c => !CATEGORY_ORDER.includes(c)).sort()
    .map(c => tile(c, 'More', getNodesByCategory(c))).filter((t): t is CategoryTile => !!t);
  out.push({ label: 'More', tiles: extra });
  return out.filter(s => s.tiles.length > 0);
}

/** Definitions for a list of types, skipping unknown ones. */
export function defsOf(types: readonly string[]): NodeDefinition[] {
  return types.map(t => getNodeDefinition(t)).filter((d): d is NodeDefinition => !!d);
}

// ── Keyboard ──────────────────────────────────────────────────────────────────

export interface NavSection { layout: 'grid' | 'list'; count: number }
export interface NavPos { s: number; i: number }
export type NavKey = 'up' | 'down' | 'left' | 'right' | 'tab' | 'shiftTab' | 'home' | 'end';

/**
 * The next highlighted item. Grids move by `cols` up and down and by one sideways; lists by one.
 * Off the end of a group goes into the next one (or the previous); Tab and Shift+Tab jump to the
 * next or previous group's first item, round the end.
 */
export function navMove(sections: readonly NavSection[], pos: NavPos, key: NavKey, cols: number): NavPos {
  const live = sections.map((s, idx) => ({ ...s, idx })).filter(s => s.count > 0);
  if (!live.length) return pos;
  let li = live.findIndex(s => s.idx === pos.s);
  if (li < 0) return { s: live[0].idx, i: 0 };
  const cur = live[li];
  const i = Math.min(pos.i, cur.count - 1);
  const c = cur.layout === 'grid' ? Math.max(1, cols) : 1;
  const next = () => (li + 1 < live.length ? { s: live[li + 1].idx, i: 0 } : { s: cur.idx, i });
  const prevLast = () => (li > 0 ? { s: live[li - 1].idx, i: live[li - 1].count - 1 } : { s: cur.idx, i });
  switch (key) {
    case 'tab': li = (li + 1) % live.length; return { s: live[li].idx, i: 0 };
    case 'shiftTab': li = (li - 1 + live.length) % live.length; return { s: live[li].idx, i: 0 };
    case 'home': return { s: live[0].idx, i: 0 };
    case 'end': return { s: live[live.length - 1].idx, i: live[live.length - 1].count - 1 };
    case 'right': return i + 1 < cur.count ? { s: cur.idx, i: i + 1 } : next();
    case 'left': return i > 0 ? { s: cur.idx, i: i - 1 } : prevLast();
    case 'down': {
      if (i + c < cur.count) return { s: cur.idx, i: i + c };
      // Not on the last row of a grid yet: its last item.
      if (Math.floor(i / c) < Math.floor((cur.count - 1) / c)) return { s: cur.idx, i: cur.count - 1 };
      return next();
    }
    case 'up': return i - c >= 0 ? { s: cur.idx, i: i - c } : prevLast();
  }
}
