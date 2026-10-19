/**
 * NodeSearchPalette — the node search (Shift+Space, the A shortcut, a wire's "+", Add node…), see
 * docs/node-browser.md "Node search". A wide panel in the app's theme:
 *
 *  - Empty: the library's categories as tiles (name, colour, count, a few node names), with
 *    Builders, Usually next, Recent, Favourites and Group presets tiles first. A tile opens its
 *    nodes as a grid; Back, Esc or Backspace in the empty field goes back.
 *  - Typing: Matches (exact name, name prefix, word prefix, fuzzy, keywords), the top 8 as tiles and
 *    the rest as a list, then Related (what usually goes with the node you came from, recent ones).
 *  - The highlighted node's preview and description sit in the side panel (a footer line on a phone).
 *  - Arrows move across grids and lists, Tab jumps between groups, Enter adds (or opens).
 *
 * Adding places the node at `spawnPosition` (else the view's free centre) and calls `onNodePlaced`,
 * which wires it when the search was opened from a wire.
 */
import { useState, useEffect, useRef, useCallback, useMemo, type ReactNode } from 'react';
import { getOfferedDefinitions, getNodeDefinition } from '../../nodes/definitions';
import { useUserNodesVersion } from '../../nodes/userNodes/useUserNodes';
import type { GraphNode, NodeDefinition } from '../../types/nodeGraph';
import type { GroupPreset } from '../../types/groupPreset';
import { useNodeGraphStore, getActiveNodes } from '../../store/useNodeGraphStore';
import { affinity, rankTables } from '../../suggestions';
import { categoryFits, exampleFollowCounts, misfitBadge } from '../../structure/relevance';
import { useLibraryPrefs } from '../../structure/libraryPrefs';
import { FLOWS } from '../../structure/stages';
import { CATEGORY_ROLES, HIDDEN_TYPES } from './nodeCategoryMeta';
import { CATEGORY_GROUPS, CATEGORY_INFO, CATEGORY_SECTIONS, HIDDEN_NODES, MERGED_CATEGORIES, ROW_ADD_PARAMS, VIRTUAL_ROWS, byLabel, nodesOfRow, rowLabel } from './libraryRows';
import { useHiddenHere } from './useAddScope';
import { useLibraryContext } from './useLibraryRelevance';
import { spawnPoint } from './spawnPoint';
import {
  TOP_COUNT, SECTION_LOOK, categorySections, contextScore, defsOf, navMove, passesWireFilter, rankMatches, rankRelated,
  type NavKey, type NavPos, type RelatedContext,
} from './nodeSearchModel';
import { recentNodes, recordRecentNode, favoriteNodes, toggleFavoriteNode } from '../../nodes/recentNodes';
import { BUILDERS, matchBuilders, type BuilderInfo } from '../../builders/registry';
import { openBuilder } from '../../builders/open';
import { useTokens } from '../../theme/themeStore';
import { useCtp, type CtpPalette } from '../../theme/nodePalette';
import { alpha, fontFamily, radius, type Tokens } from '../../theme/tokens';
import { Icon } from '../ui/Icon';
import type { IconName } from '../ui/iconPaths';
import { Button, IconButton } from '../ui/Button';
import { DocText } from '../ui/DocText';
import { NodeInlineViz, INLINE_VIZ_TYPES } from './NodeInlineViz';
import { nodeBlurb } from '../../nodes/plainDescriptions';
import { ExamplesStrip } from './ExampleLinks';
import { searchFocusTypes, usingTitle } from './exampleLinksModel';
import { examplesForCategory, examplesForType, examplesForTypes } from '../../store/exampleNodeIndex';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Where to place the node — the free centre of the current view if not provided */
  spawnPosition?: { x: number; y: number };
  /** If set, only show nodes that have at least one output compatible with this type */
  filterOutputType?: string;
  /** If set, only show nodes that have at least one input compatible with this type */
  filterInputType?: string;
  /** Called after addNode with the new node's ID */
  onNodePlaced?: (nodeId: string) => void;
  /** Related results follow this node type (the wire's end). Defaults to the selected node's type. */
  boostFrom?: string;
}

export function NodeSearchPalette(props: Props) {
  // Mounted only while open, so every opening starts on the categories with an empty field.
  return props.open ? <SearchPanel {...props} /> : null;
}

// ── Items and screens ─────────────────────────────────────────────────────────

type Item =
  | { kind: 'node'; key: string; def: NodeDefinition; why?: string; badge?: string; params?: Record<string, unknown> }
  | { kind: 'tile'; key: string; title: string; count: number; preview: string[]; icon: IconName; color: string; info?: string; open: () => void }
  | { kind: 'builder'; key: string; b: BuilderInfo }
  | { kind: 'preset'; key: string; preset: GroupPreset }
  | { kind: 'action'; key: string; label: string; run: () => void };

interface Section {
  id: string;
  label?: string;
  /** A light note beside the label ("after Circle SDF"). */
  note?: string;
  layout: 'grid' | 'list';
  items: Item[];
  /** Search groups, for tests and styling. */
  group?: 'matches' | 'related';
}

type View =
  | { kind: 'home' }
  | { kind: 'row'; row: string }
  | { kind: 'favorites' }
  | { kind: 'recent' }
  | { kind: 'related' }
  | { kind: 'presets' };

const viewTitle = (v: View): string => (
  v.kind === 'row' ? rowLabel(v.row)
    : v.kind === 'favorites' ? 'Favourites'
      : v.kind === 'recent' ? 'Recent'
        : v.kind === 'related' ? 'Usually next'
          : v.kind === 'presets' ? 'Group presets' : 'Nodes'
);

/** Phone-sized windows get the full-screen layout. */
function useNarrow(limit = 720): boolean {
  const get = () => (typeof window === 'undefined' ? false : window.innerWidth < limit);
  const [narrow, setNarrow] = useState(get);
  useEffect(() => {
    const on = () => setNarrow(get());
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return narrow;
}

function SearchPanel({ onClose, spawnPosition, filterOutputType, filterInputType, onNodePlaced, boostFrom }: Props) {
  const tk = useTokens();
  const pal = useCtp();
  const narrow = useNarrow();
  const addNode = useNodeGraphStore(s => s.addNode);
  const groupPresets = useNodeGraphStore(s => s.groupPresets);
  const instantiateGroupPreset = useNodeGraphStore(s => s.instantiateGroupPreset);
  const deleteGroupPreset = useNodeGraphStore(s => s.deleteGroupPreset);

  const [query, setQuery] = useState('');
  const [view, setView] = useState<View>({ kind: 'home' });
  const [pos, setPos] = useState<NavPos>({ s: 0, i: 0 });
  const [showOther, setShowOther] = useState(false);
  const [favorites, setFavorites] = useState<string[]>(favoriteNodes);
  const [cols, setCols] = useState(4);
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const userNodesVersion = useUserNodesVersion();
  // Scene Pos / Scene Output… only inside the group they belong to (nodes/addScope.ts).
  const hiddenSearch = useHiddenHere(HIDDEN_TYPES);
  const hiddenBrowse = useHiddenHere(HIDDEN_NODES);
  const libCtx = useLibraryContext(true);
  const relevantOnly = useLibraryPrefs(s => s.relevantOnly);
  const setRelevantOnly = useLibraryPrefs(s => s.setRelevantOnly);
  const wiring = !!(filterOutputType || filterInputType);

  const wireOk = useCallback((d: NodeDefinition) => passesWireFilter(d, filterOutputType, filterInputType), [filterOutputType, filterInputType]);
  const misfit = useCallback((d: NodeDefinition) => relevantOnly && !categoryFits(d.category, libCtx.flow), [relevantOnly, libCtx.flow]);
  const acceptBrowse = useCallback((d: NodeDefinition) => !hiddenBrowse.has(d.type) && wireOk(d), [hiddenBrowse, wireOk]);

  const searchDefs = useMemo(() => {
    void userNodesVersion; // published node types change the list
    return getOfferedDefinitions().filter(d => !hiddenSearch.has(d.type) && wireOk(d));
  }, [userNodesVersion, hiddenSearch, wireOk]);

  // ── Context: the node you came from, what usually goes with it, what you added lately ──
  // Opened from a selected node (not a wire): Related only lists what can take one of its outputs.
  const { from, outTypes } = useMemo<{ from: string | null; outTypes: string[] | null }>(() => {
    const wire = useLibraryPrefs.getState().wire;
    if (boostFrom) return { from: boostFrom, outTypes: null };
    if (wire) return { from: wire.nodeType, outTypes: null };
    const st = useNodeGraphStore.getState();
    if (!st.selectedNodeId) return { from: null, outTypes: null };
    const n = getActiveNodes(st.nodes, st.activeGroupPath)?.find(x => x.id === st.selectedNodeId) ?? st.nodes.find(x => x.id === st.selectedNodeId);
    if (!n) return { from: null, outTypes: null };
    const outs = Object.entries(n.outputs).filter(([k]) => !k.startsWith('__')).map(([, o]) => o.type as string);
    return { from: n.type, outTypes: [...new Set(outs)] };
  }, [boostFrom]);
  const affinityOf = useMemo(() => {
    if (!from) return () => 0;
    const tables = rankTables();
    const cache = new Map<string, number>();
    return (type: string) => {
      let v = cache.get(type);
      if (v === undefined) { v = affinity(from, type, tables); cache.set(type, v); }
      return v;
    };
  }, [from]);
  const [follows, setFollows] = useState<ReadonlyMap<string, number> | null>(null);
  useEffect(() => {
    if (!from) return;
    let live = true;
    exampleFollowCounts().then(c => { if (live) setFollows(c.get(from) ?? new Map()); }, () => { /* the examples are a nicety */ });
    return () => { live = false; };
  }, [from]);
  const recents = useMemo(() => recentNodes(), []);
  const ctx = useMemo<RelatedContext>(() => ({
    fromType: from, fromLabel: from ? getNodeDefinition(from)?.label ?? from : null, affinity: affinityOf, follows, recents, outTypes,
  }), [from, affinityOf, follows, recents, outTypes]);
  const offered = useMemo(() => new Set(searchDefs.map(d => d.type)), [searchDefs]);
  const fitDefs = useMemo(() => searchDefs.filter(d => !misfit(d)), [searchDefs, misfit]);
  const usuallyNext = useMemo(() => (from ? rankRelated(fitDefs, { ...ctx, recents: [] }, new Set(), 16) : []), [from, fitDefs, ctx]);

  // ── Actions ──
  const place = useCallback((type: string, params?: Record<string, unknown>) => {
    const newId = addNode(type, spawnPosition ?? spawnPoint(type), params);
    if (newId) {
      recordRecentNode(type);
      onNodePlaced?.(newId);
    }
    onClose();
  }, [addNode, spawnPosition, onClose, onNodePlaced]);

  const goTo = useCallback((v: View) => { setView(v); setPos({ s: 0, i: 0 }); scrollRef.current?.scrollTo?.({ top: 0 }); inputRef.current?.focus(); }, []);
  // Back highlights the tile you came from.
  const returnTo = useRef<string | null>(null);
  const back = useCallback(() => {
    returnTo.current = view.kind === 'row' ? `c:${view.row}` : view.kind === 'home' ? null : `t:${view.kind}`;
    goTo({ kind: 'home' });
  }, [goTo, view]);

  const nodeItem = useCallback((def: NodeDefinition, extra: Partial<Extract<Item, { kind: 'node' }>> = {}): Item => ({
    kind: 'node', key: `n:${def.type}`, def,
    badge: relevantOnly ? misfitBadge(def.category, libCtx.flow) ?? undefined : undefined, ...extra,
  }), [relevantOnly, libCtx.flow]);

  // ── The screen: its groups of items ──
  const matches = useMemo(() => {
    const q = query.trim();
    return q ? rankMatches(searchDefs, q, { context: t => contextScore(t, ctx), misfit }) : [];
  }, [query, searchDefs, ctx, misfit]);
  // Examples using the node(s) the search is about, or the open category's nodes (not while wiring).
  const examples = useMemo(() => {
    if (wiring) return null;
    if (query.trim()) {
      const focus = searchFocusTypes(matches);
      if (!focus.length) return null;
      return { id: 'search', title: usingTitle(focus.map(t => getNodeDefinition(t)?.label ?? t)), hits: examplesForTypes(focus, 12) };
    }
    if (view.kind === 'row') return { id: 'category', title: `Examples with ${rowLabel(view.row)}`, hits: examplesForCategory(nodesOfRow(view.row).map(d => d.type), 8) };
    return null;
  }, [wiring, query, matches, view]);

  const sections = useMemo<Section[]>(() => {
    const q = query.trim();
    if (q) {
      const related = rankRelated(fitDefs, ctx, new Set(matches.map(m => m.def.type)), TOP_COUNT);
      const out: Section[] = [];
      const builders = wiring ? [] : matchBuilders(q);
      if (builders.length) out.push({ id: 'builders', label: 'Builders', layout: 'list', items: builders.map(b => ({ kind: 'builder', key: `b:${b.id}`, b })) });
      const ql = q.toLowerCase();
      const presets = wiring ? [] : groupPresets.filter(p => p.label.toLowerCase().includes(ql) || p.description?.toLowerCase().includes(ql));
      if (presets.length) out.push({ id: 'presets', label: 'Group presets', layout: 'list', items: presets.map(p => ({ kind: 'preset', key: `p:${p.id}`, preset: p })) });
      out.push({ id: 'top', label: 'Matches', note: matches.length ? String(matches.length) : undefined, layout: 'grid', group: 'matches', items: matches.slice(0, TOP_COUNT).map(m => nodeItem(m.def)) });
      out.push({ id: 'more', layout: 'list', group: 'matches', items: matches.slice(TOP_COUNT).map(m => nodeItem(m.def)) });
      out.push({ id: 'related', label: 'Related', note: ctx.fromLabel && usuallyNext.length ? `with ${ctx.fromLabel}` : undefined, layout: 'grid', group: 'related', items: related.map(r => nodeItem(r.def, { why: r.why, key: `r:${r.def.type}` })) });
      return out;
    }

    if (view.kind === 'row') {
      const cat = view.row;
      const raw = nodesOfRow(cat).filter(acceptBrowse);
      const params = ROW_ADD_PARAMS[cat];
      const shown = (list: NodeDefinition[]) => [...list]
        .sort((a, b) => (a.type === 'transform' ? -1 : b.type === 'transform' ? 1 : byLabel(a.label, b.label)))
        .map(d => nodeItem(cat === 'Agent presets' ? { ...d, label: d.label.replace(/\s*\(preset\)$/i, '') } : d, { params: params?.[d.type] }));
      const listed = CATEGORY_GROUPS[cat];
      if (!listed) return [{ id: 'nodes', layout: 'grid', items: shown(raw) }];
      const sorted = [...listed].sort((a, b) => (a.label === 'Start here' ? -1 : b.label === 'Start here' ? 1 : byLabel(a.label, b.label)));
      const rowTypes = new Set(raw.map(d => d.type));
      const groups = [...sorted, ...(MERGED_CATEGORIES[cat] ?? [cat]).map(c => ({
        label: c === cat ? 'More' : c,
        types: (VIRTUAL_ROWS[cat] ? [...rowTypes] : nodesOfRow(c).map(d => d.type)).filter(t => !sorted.some(g => g.types.includes(t))),
      }))];
      return groups
        .map(g => ({ id: `g:${g.label}`, label: g.label, layout: 'grid' as const, items: shown(raw.filter(d => g.types.includes(d.type))) }))
        .filter(s => s.items.length > 0);
    }
    if (view.kind === 'favorites') return [{ id: 'nodes', layout: 'grid', items: defsOf(favorites).filter(acceptBrowse).map(d => nodeItem(d)) }];
    if (view.kind === 'recent') return [{ id: 'nodes', layout: 'grid', items: defsOf(recents).filter(d => offered.has(d.type)).map(d => nodeItem(d)) }];
    if (view.kind === 'related') return [{ id: 'nodes', layout: 'grid', note: ctx.fromLabel ?? undefined, items: usuallyNext.map(r => nodeItem(r.def, { why: r.why })) }];
    if (view.kind === 'presets') return [{ id: 'presets', layout: 'list', items: groupPresets.map(p => ({ kind: 'preset', key: `p:${p.id}`, preset: p })) }];

    // Home: the shortcuts, then the categories by section.
    const start: Item[] = [];
    if (!wiring) {
      const b = BUILDERS[0];
      if (b) start.push({ kind: 'tile', key: 't:builders', title: 'Builders', count: BUILDERS.length, preview: [b.makes], icon: b.icon, color: tk.accent.base, info: `${b.title}: ${b.description}. ${b.action}.`, open: () => { openBuilder(b.id); onClose(); } });
    }
    if (usuallyNext.length) start.push({ kind: 'tile', key: 't:related', title: 'Usually next', count: usuallyNext.length, preview: [`after ${ctx.fromLabel}`, ...usuallyNext.slice(0, 2).map(r => r.def.label)], icon: 'spark', color: pal.mauve, info: `Nodes that usually go with ${ctx.fromLabel}, in your graphs and the examples.`, open: () => goTo({ kind: 'related' }) });
    const recentDefs = defsOf(recents).filter(d => offered.has(d.type));
    if (recentDefs.length) start.push({ kind: 'tile', key: 't:recent', title: 'Recent', count: recentDefs.length, preview: recentDefs.slice(0, 3).map(d => d.label), icon: 'clock', color: pal.sky, info: 'The nodes you added most recently.', open: () => goTo({ kind: 'recent' }) });
    const favDefs = defsOf(favorites).filter(acceptBrowse);
    if (favDefs.length) start.push({ kind: 'tile', key: 't:favorites', title: 'Favourites', count: favDefs.length, preview: favDefs.slice(0, 3).map(d => d.label), icon: 'starF', color: tk.status.warning, info: 'Nodes you starred (here or in the node browser).', open: () => goTo({ kind: 'favorites' }) });
    if (groupPresets.length && !wiring) start.push({ kind: 'tile', key: 't:presets', title: 'Group presets', count: groupPresets.length, preview: groupPresets.slice(0, 3).map(p => p.label), icon: 'presets', color: pal.yellow, info: 'Groups you saved as presets.', open: () => goTo({ kind: 'presets' }) });

    const out: Section[] = [];
    if (start.length) out.push({ id: 'start', layout: 'grid', items: start });
    const other: Item[] = [];
    for (const sec of categorySections(acceptBrowse)) {
      const tiles: Item[] = [];
      for (const t of sec.tiles) {
        const item: Item = { kind: 'tile', key: `c:${t.row}`, title: rowLabel(t.row), count: t.count, preview: t.preview, icon: t.icon, color: pal[t.role], info: CATEGORY_INFO[t.row], open: () => goTo({ kind: 'row', row: t.row }) };
        (relevantOnly && !categoryFits(t.row, libCtx.flow) ? other : tiles).push(item);
      }
      if (tiles.length) out.push({ id: `s:${sec.label}`, label: sec.label, layout: 'grid', items: tiles });
    }
    if (other.length) {
      out.push({ id: 'other-toggle', layout: 'list', items: [{ kind: 'action', key: 'a:other', label: `${showOther ? 'Hide' : 'Show'} what’s not for this graph (${other.length})`, run: () => setShowOther(v => !v) }] });
      if (showOther) out.push({ id: 'other', label: 'Not for this graph', layout: 'grid', items: other });
    }
    return out;
  }, [query, matches, view, offered, fitDefs, ctx, wiring, groupPresets, nodeItem, acceptBrowse, favorites, recents, usuallyNext, tk, pal, relevantOnly, libCtx.flow, showOther, goTo, onClose]);

  const searching = query.trim().length > 0;
  const navSections = useMemo(() => sections.map(s => ({ layout: s.layout, count: s.items.length })), [sections]);
  // The highlight, kept on a real item.
  const activePos = useMemo<NavPos>(() => (sections[pos.s]?.items[pos.i] ? pos : { s: Math.max(0, sections.findIndex(s => s.items.length > 0)), i: 0 }), [sections, pos]);
  const active: Item | null = sections[activePos.s]?.items[activePos.i] ?? null;

  // Back to the first item whenever the screen changes.
  useEffect(() => {
    const want = returnTo.current;
    returnTo.current = null;
    if (want && !query) {
      for (let s = 0; s < sections.length; s++) {
        const i = sections[s].items.findIndex(it => it.key === want);
        if (i >= 0) { setPos({ s, i }); return; }
      }
    }
    setPos({ s: Math.max(0, sections.findIndex(s => s.items.length > 0)), i: 0 });
  }, [query, view]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { setTimeout(() => inputRef.current?.focus(), 0); }, []);

  // Columns follow the panel's width.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setCols(Math.max(1, Math.floor((el.clientWidth - 24 + 8) / (narrow ? 150 : 180 + 8)))));
    ro.observe(el);
    return () => ro.disconnect();
  }, [narrow]);

  useEffect(() => {
    const el = scrollRef.current?.querySelector<HTMLElement>('[data-active="true"]');
    el?.scrollIntoView?.({ block: 'nearest' });
  }, [activePos.s, activePos.i]);

  const activate = useCallback((item: Item | null) => {
    if (!item) return;
    switch (item.kind) {
      case 'node': place(item.def.type, item.params); break;
      case 'tile': item.open(); break;
      case 'builder': openBuilder(item.b.id); onClose(); break;
      case 'preset': instantiateGroupPreset(item.preset.id, spawnPosition ?? spawnPoint()); onClose(); break;
      case 'action': item.run(); break;
    }
  }, [place, onClose, instantiateGroupPreset, spawnPosition]);

  const onKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    const move = (k: NavKey) => { e.preventDefault(); setPos(navMove(navSections, activePos, k, searching ? 1 : cols)); };
    switch (e.key) {
      case 'Escape':
        e.preventDefault();
        if (query) setQuery('');
        else if (view.kind !== 'home') back();
        else onClose();
        return;
      case 'Backspace':
        if (!query && view.kind !== 'home') { e.preventDefault(); back(); }
        return;
      case 'Enter': e.preventDefault(); activate(active); return;
      case 'Tab': move(e.shiftKey ? 'shiftTab' : 'tab'); return;
      case 'ArrowDown': move('down'); return;
      case 'ArrowUp': move('up'); return;
      // While typing, left and right move the text cursor; up and down go through the results in order.
      case 'ArrowRight': if (!searching) move('right'); return;
      case 'ArrowLeft': if (!searching) move('left'); return;
    }
  }, [navSections, activePos, searching, cols, query, view.kind, back, onClose, activate, active]);

  const toggleFav = (type: string) => setFavorites(toggleFavoriteNode(type));

  // ── Render ──
  const total = searching
    ? sections.filter(s => s.group === 'matches').reduce((n, s) => n + s.items.length, 0)
    : sections.reduce((n, s) => n + s.items.filter(it => it.kind !== 'action' && !it.key.startsWith('t:')).length, 0);
  const crumb = !searching && view.kind !== 'home';

  return (
    <>
      <div data-node-search-backdrop onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 900, background: tk.bg.scrim }} />
      <div
        data-node-search
        data-view={searching ? 'search' : view.kind}
        role="dialog"
        aria-label="Add a node"
        onWheel={e => e.stopPropagation()}
        style={{
          position: 'fixed', zIndex: 901, display: 'flex', flexDirection: 'column', overflow: 'hidden',
          background: tk.bg.panel, color: tk.text.primary, font: `13px ${fontFamily.ui}`,
          ...(narrow
            // Full screen: clear of the notch / status bar and the home indicator in an installed app.
            ? { inset: 0, paddingTop: 'env(safe-area-inset-top, 0px)', paddingBottom: 'env(safe-area-inset-bottom, 0px)', boxSizing: 'border-box' }
            : {
              top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
              width: 'min(1080px, calc(100vw - 48px))', height: 'min(620px, calc(100vh - 64px))',
              border: `1px solid ${tk.border.default}`, borderRadius: radius.modal, boxShadow: tk.shadow.modal,
            }),
        }}
      >
        {/* Header: back, where you are, the field, the filters */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: narrow ? '10px 12px' : '12px 16px', borderBottom: `1px solid ${tk.border.subtle}`, flexWrap: narrow ? 'wrap' : 'nowrap' }}>
          {crumb
            ? <IconButton icon="chevL" label="Back to categories (Esc)" size="sm" onClick={back} style={{ background: tk.bg.hover, color: tk.text.secondary }} />
            : <Icon name="search" size={16} style={{ color: tk.text.faint, flexShrink: 0 }} />}
          {crumb && (
            <span data-breadcrumb style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12.5, color: tk.text.muted, whiteSpace: 'nowrap' }}>
              <button onClick={back} style={{ border: 0, background: 'none', padding: 0, cursor: 'pointer', color: tk.text.muted, font: 'inherit' }}>Nodes</button>
              <Icon name="chevR" size={12} />
              <b style={{ color: tk.text.primary, fontWeight: 600 }}>{viewTitle(view)}</b>
            </span>
          )}
          <input
            ref={inputRef}
            data-node-search-input
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={crumb ? 'Search all nodes…' : 'Search nodes, or pick a category…'}
            spellCheck={false}
            autoComplete="off"
            style={{ flex: 1, minWidth: 120, height: narrow ? 38 : 32, padding: '0 10px', borderRadius: radius.md, border: `1px solid ${tk.border.default}`, background: tk.bg.field, color: tk.text.primary, outline: 'none', font: `${narrow ? 16 : 14}px ${fontFamily.ui}` }}
          />
          {/* A phone: Cancel sits beside the field, where a thumb looks for it (not a small × after the filters). */}
          {narrow && (
            <button type="button" data-node-search-cancel onClick={onClose}
              style={{ height: 38, padding: '0 4px', border: 0, background: 'none', cursor: 'pointer', flexShrink: 0, color: tk.accent.text, font: `600 14px ${fontFamily.ui}` }}>
              Cancel
            </button>
          )}
          {wiring && (
            <span data-wire-filter title="Only nodes that fit the wire" style={chipStyle(tk)}>
              {filterInputType && <>takes {filterInputType}</>}{filterInputType && filterOutputType && ' · '}{filterOutputType && <>gives {filterOutputType}</>}
            </span>
          )}
          <RelevanceToggle tk={tk} tall={narrow} relevantOnly={relevantOnly} onChange={setRelevantOnly} flow={FLOWS[libCtx.flow].label} />
          <span style={{ fontSize: 11, color: tk.text.faint, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{total} {searching ? (total === 1 ? 'match' : 'matches') : view.kind === 'home' ? 'categories' : total === 1 ? 'node' : 'nodes'}</span>
          {!narrow && <IconButton icon="close" label="Close (Esc)" size="sm" onClick={onClose} />}
        </div>

        {/* Body: the grid or results, and the preview */}
        <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
          <div ref={scrollRef} data-node-search-results style={{ flex: 1, minWidth: 0, overflowY: 'auto', padding: narrow ? '6px 12px 16px' : '8px 16px 16px' }}>
            {crumb && view.kind === 'row' && CATEGORY_INFO[view.row] && (
              <div data-category-info style={{ color: tk.text.muted, font: `12px/1.5 ${fontFamily.ui}`, padding: '6px 2px 2px', maxWidth: 720 }}>{CATEGORY_INFO[view.row]}</div>
            )}
            {examples?.id === 'category' && (
              <ExamplesStrip id="category" hits={examples.hits} title={examples.title} show={narrow ? 2 : 4} columns={narrow ? 2 : 4} touch={narrow} onOpened={onClose} />
            )}
            {sections.map((sec, si) => (sec.items.length === 0 && !(sec.id === 'top' && searching) ? null : (
              <div key={sec.id} data-section={sec.id} data-search-group={sec.group}>
                {sec.label && <SectionLabel tk={tk} label={sec.label} note={sec.note} rule={!sec.group || sec.group === 'related'} />}
                {sec.id === 'top' && sec.items.length === 0 && (
                  <div style={{ color: tk.text.faint, fontSize: 12.5, padding: '6px 2px 10px' }}>No nodes match “{query.trim()}”</div>
                )}
                <div style={sec.layout === 'grid'
                  ? { display: 'grid', gridTemplateColumns: `repeat(${narrow ? Math.min(cols, 2) : cols}, minmax(0, 1fr))`, gap: 8 }
                  : { display: 'flex', flexDirection: 'column', gap: 1, marginTop: sec.id === 'more' ? 8 : 0 }}>
                  {sec.items.map((item, ii) => (
                    <ItemView
                      key={item.key}
                      item={item}
                      layout={sec.layout}
                      showCategory={searching || view.kind !== 'row'}
                      active={activePos.s === si && activePos.i === ii}
                      tk={tk}
                      pal={pal}
                      onHover={() => setPos({ s: si, i: ii })}
                      onActivate={() => activate(item)}
                      onDeletePreset={id => deleteGroupPreset(id)}
                    />
                  ))}
                </div>
                {sec.id === 'top' && examples?.id === 'search' && (
                  <ExamplesStrip id="search" hits={examples.hits} title={examples.title} show={narrow ? 2 : 4} columns={narrow ? 2 : 4} touch={narrow} onOpened={onClose} />
                )}
              </div>
            )))}
          </div>
          {!narrow && (
            <aside data-node-search-preview style={{ width: 300, flexShrink: 0, borderLeft: `1px solid ${tk.border.subtle}`, background: tk.bg.subtle, overflowY: 'auto', padding: 14 }}>
              <Preview item={active} tk={tk} pal={pal} favorites={favorites} onToggleFavorite={toggleFav} onActivate={() => activate(active)} onDeletePreset={id => deleteGroupPreset(id)} onExampleOpened={wiring ? undefined : onClose} />
            </aside>
          )}
        </div>

        {/* Footer: keys, or on a phone the highlighted node's line */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '7px 16px', borderTop: `1px solid ${tk.border.subtle}`, fontSize: 11, color: tk.text.faint, minHeight: 30 }}>
          {narrow
            ? <span data-node-search-footer style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{active ? footerLine(active) : ''}</span>
            : <>
              <span><Kbd tk={tk}>↑↓←→</Kbd> move</span>
              <span><Kbd tk={tk}>Tab</Kbd> next group</span>
              <span><Kbd tk={tk}>↵</Kbd> {active?.kind === 'tile' ? 'open' : 'add'}</span>
              <span><Kbd tk={tk}>Esc</Kbd> {searching ? 'clear' : crumb ? 'back' : 'close'}</span>
              {crumb && <span><Kbd tk={tk}>⌫</Kbd> back</span>}
            </>}
        </div>
      </div>
    </>
  );
}

// ── Pieces ────────────────────────────────────────────────────────────────────

const descOf = (def: NodeDefinition): string => nodeBlurb(def) ?? '';
const firstLine = (s: string) => s.split(/\n|(?<=\.)\s/)[0] ?? '';

function footerLine(item: Item): string {
  switch (item.kind) {
    case 'node': return `${item.def.label}${item.why ? ` · ${item.why}` : ''} — ${firstLine(descOf(item.def))}`;
    case 'tile': return item.info ?? item.title;
    case 'builder': return item.b.description;
    case 'preset': return item.preset.description ?? item.preset.label;
    case 'action': return item.label;
  }
}

const chipStyle = (tk: Tokens): React.CSSProperties => ({
  font: `500 11px ${fontFamily.mono}`, color: tk.text.muted, background: tk.bg.hover, borderRadius: radius.sm, padding: '3px 7px', whiteSpace: 'nowrap', flexShrink: 0,
});

function Kbd({ tk, children }: { tk: Tokens; children: ReactNode }) {
  return <kbd style={{ display: 'inline-block', background: tk.bg.field, border: `1px solid ${tk.border.default}`, borderRadius: radius.xs, padding: '0 5px', marginRight: 3, font: `10.5px ${fontFamily.ui}`, color: tk.text.secondary }}>{children}</kbd>;
}

function SectionLabel({ tk, label, note, rule }: { tk: Tokens; label: string; note?: string; rule: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '14px 2px 8px' }}>
      <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: tk.text.faint }}>{label}</span>
      {note && <span style={{ fontSize: 11, color: tk.text.faint }}>{note}</span>}
      {rule && <span style={{ flex: 1, height: 1, background: tk.border.subtle }} />}
    </div>
  );
}

function RelevanceToggle({ tk, relevantOnly, onChange, flow, tall = false }: { tk: Tokens; relevantOnly: boolean; onChange: (v: boolean) => void; flow: string; /** A phone: thumb-sized. */ tall?: boolean }) {
  const seg = (on: boolean, label: string, value: boolean) => (
    <button key={label} onClick={() => onChange(value)} aria-pressed={on}
      style={{ height: tall ? 32 : 24, padding: '0 9px', border: 0, borderRadius: radius.sm, cursor: 'pointer', whiteSpace: 'nowrap', font: `${on ? 600 : 500} 11.5px ${fontFamily.ui}`,
        background: on ? tk.bg.selected : 'transparent', color: on ? tk.accent.text : tk.text.muted }}>{label}</button>
  );
  return (
    <div data-library-relevance title={`This graph is ${flow}: Relevant only puts nodes for other kinds of graph last`} style={{ display: 'flex', gap: 2, padding: 2, borderRadius: radius.md, background: tk.bg.field, flexShrink: 0 }}>
      {seg(relevantOnly, 'Relevant only', true)}
      {seg(!relevantOnly, 'Show all', false)}
    </div>
  );
}

function ItemView({ item, layout, showCategory, active, tk, pal, onHover, onActivate, onDeletePreset }: {
  item: Item; layout: 'grid' | 'list'; showCategory: boolean; active: boolean; tk: Tokens; pal: CtpPalette;
  onHover: () => void; onActivate: () => void; onDeletePreset: (id: string) => void;
}) {
  const base: React.CSSProperties = {
    border: 0, cursor: 'pointer', textAlign: 'left', color: tk.text.primary, font: `13px ${fontFamily.ui}`, minWidth: 0,
    background: active ? tk.bg.selected : layout === 'grid' ? tk.bg.field : 'transparent',
    boxShadow: active ? `inset 0 0 0 1.5px ${tk.accent.base}` : layout === 'grid' ? `inset 0 0 0 1px ${tk.border.subtle}` : 'none',
    borderRadius: layout === 'grid' ? radius.lg : radius.md, transition: 'background 0.08s',
  };
  const common = {
    'data-item-kind': item.kind,
    'data-active': active ? 'true' : undefined,
    onMouseMove: active ? undefined : onHover,
    onClick: onActivate,
  };

  if (item.kind === 'tile') {
    return (
      <button {...common} data-tile={item.key} title={item.info} style={{ ...base, display: 'flex', gap: 10, alignItems: 'flex-start', padding: 10, minHeight: 76 }}>
        <span style={{ width: 34, height: 34, borderRadius: radius.md, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: alpha(item.color, 0.16), color: item.color }}>
          <Icon name={item.icon} size={17} />
        </span>
        <span style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0, flex: 1 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <b style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }}>{item.title}</b>
            <span data-count style={{ fontSize: 11, color: tk.text.faint, background: tk.bg.hover, borderRadius: radius.sm, padding: '0 6px', fontVariantNumeric: 'tabular-nums' }}>{item.count}</span>
          </span>
          <span style={{ fontSize: 11.5, color: tk.text.muted, lineHeight: 1.35, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{item.preview.join(' · ')}</span>
        </span>
      </button>
    );
  }
  if (item.kind === 'node') {
    const accent = nodeAccent(item.def, pal);
    if (layout === 'grid') {
      return (
        <button {...common} data-type={item.def.type} style={{ ...base, display: 'flex', flexDirection: 'column', gap: 4, padding: '9px 10px', minHeight: 76 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%' }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: accent, flexShrink: 0 }} />
            <b style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }}>{item.def.label}</b>
            {item.badge && <Badge tk={tk}>{item.badge}</Badge>}
          </span>
          <span style={{ fontSize: 11.5, color: tk.text.muted, lineHeight: 1.35, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
            {item.why ? <span style={{ color: tk.accent.text }}>{item.why}. </span> : null}{firstLine(descOf(item.def))}
          </span>
          {showCategory && <span style={{ fontSize: 10.5, color: tk.text.faint, marginTop: 'auto' }}>{rowLabel(item.def.category)}</span>}
        </button>
      );
    }
    return (
      <button {...common} data-type={item.def.type} style={{ ...base, display: 'flex', alignItems: 'center', gap: 10, padding: '6px 10px', height: 32 }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: accent, flexShrink: 0 }} />
        <span style={{ fontWeight: 500, whiteSpace: 'nowrap' }}>{item.def.label}</span>
        {item.badge && <Badge tk={tk}>{item.badge}</Badge>}
        <span style={{ flex: 1, minWidth: 0, fontSize: 11.5, color: tk.text.faint, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.why ?? firstLine(descOf(item.def))}</span>
        <span style={{ fontSize: 10.5, color: tk.text.faint, whiteSpace: 'nowrap' }}>{rowLabel(item.def.category)}</span>
      </button>
    );
  }
  if (item.kind === 'builder') {
    return (
      <button {...common} data-builder={item.b.id} style={{ ...base, display: 'flex', alignItems: 'center', gap: 10, padding: '6px 10px', minHeight: 34 }}>
        <Icon name={item.b.icon} size={15} style={{ color: tk.accent.base }} />
        <b style={{ fontWeight: 600 }}>{item.b.title}</b>
        <span style={{ flex: 1, minWidth: 0, fontSize: 11.5, color: tk.text.faint, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.b.description}</span>
      </button>
    );
  }
  if (item.kind === 'preset') {
    return (
      <div {...common} role="button" data-preset={item.preset.id} style={{ ...base, display: 'flex', alignItems: 'center', gap: 10, padding: '6px 6px 6px 10px', minHeight: 34 }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: pal.yellow, flexShrink: 0 }} />
        <span style={{ fontWeight: 500 }}>{item.preset.label}</span>
        <span style={{ flex: 1, minWidth: 0, fontSize: 11.5, color: tk.text.faint, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.preset.description}</span>
        <span style={{ fontSize: 10.5, color: tk.text.faint }}>{item.preset.subgraph.nodes.length} nodes</span>
        <IconButton icon="trash" label="Delete preset" size="sm" tone="danger" onClick={e => { e.stopPropagation(); onDeletePreset(item.preset.id); }} />
      </div>
    );
  }
  return (
    <button {...common} data-action={item.key} style={{ ...base, display: 'flex', alignItems: 'center', gap: 6, padding: '8px 4px', color: tk.text.faint, font: `700 10.5px ${fontFamily.ui}`, letterSpacing: '0.06em', textTransform: 'uppercase', marginTop: 8 }}>
      <Icon name="chevD" size={12} /> {item.label}
    </button>
  );
}

function Badge({ tk, children }: { tk: Tokens; children: ReactNode }) {
  return <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: tk.text.faint, background: tk.bg.hover, borderRadius: radius.sm, padding: '1px 5px', whiteSpace: 'nowrap' }}>{children}</span>;
}

/** Each category's library section, for a node's dot colour. */
const SECTION_OF = new Map(CATEGORY_SECTIONS.flatMap(sec => sec.categories.flatMap(c => [c, ...(MERGED_CATEGORIES[c] ?? []), ...(VIRTUAL_ROWS[c] ? [VIRTUAL_ROWS[c].from] : [])].map(x => [x, sec.label] as const))));

/** A node's dot colour: its category's, else its library section's. */
function nodeAccent(def: NodeDefinition, pal: CtpPalette): string {
  const role = CATEGORY_ROLES[def.category] ?? SECTION_LOOK[SECTION_OF.get(def.category) ?? 'More']?.role ?? 'overlay1';
  return pal[role];
}

function syntheticNode(def: NodeDefinition): GraphNode {
  return {
    id: '__search_preview__', type: def.type, position: { x: 0, y: 0 }, params: {},
    inputs: Object.fromEntries(Object.entries(def.inputs).map(([k, v]) => [k, { ...v, connection: undefined }])),
    outputs: Object.fromEntries(Object.entries(def.outputs).map(([k, v]) => [k, { ...v }])),
  };
}

function Preview({ item, tk, pal, favorites, onToggleFavorite, onActivate, onDeletePreset, onExampleOpened }: {
  item: Item | null; tk: Tokens; pal: CtpPalette; favorites: string[]; onToggleFavorite: (type: string) => void; onActivate: () => void; onDeletePreset: (id: string) => void;
  /** Set: the node's "Used in" examples show (not while wiring), and this runs after one opened. */
  onExampleOpened?: () => void;
}) {
  if (!item) return <div style={{ color: tk.text.faint, fontSize: 12 }}>Nothing here.</div>;
  const title = (t: ReactNode, extra?: ReactNode) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
      <b style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t}</b>
      {extra}
    </div>
  );
  if (item.kind === 'node') {
    const def = item.def;
    const fav = favorites.includes(def.type);
    const ins = Object.values(def.inputs), outs = Object.values(def.outputs);
    return (
      <div data-preview-type={def.type} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {title(def.label, <>
          <IconButton icon={fav ? 'starF' : 'star'} label={fav ? 'Remove from favourites' : 'Add to favourites'} size="sm" style={fav ? { color: tk.status.warning } : undefined}
            onMouseDown={e => e.preventDefault()} onClick={() => onToggleFavorite(def.type)} />
          <span style={chipStyle(tk)}>{rowLabel(def.category)}</span>
        </>)}
        {INLINE_VIZ_TYPES.has(def.type) && (
          // A render surface: keeps its own dark look in both themes.
          <div style={{ borderRadius: radius.md, overflow: 'hidden' }}><NodeInlineViz node={syntheticNode(def)} /></div>
        )}
        {item.why && <div style={{ fontSize: 12, color: tk.accent.text }}>{item.why}</div>}
        {descOf(def) && <DocText text={descOf(def)} style={{ fontSize: 12, color: tk.text.muted }} />}
        {(ins.length > 0 || outs.length > 0) && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, padding: '6px 8px', borderRadius: radius.md, background: tk.bg.field, fontSize: 11.5 }}>
            {ins.slice(0, 6).map((s, i) => <SocketRow key={`i${i}`} tk={tk} kind="in" label={s.label} type={s.type} />)}
            {outs.slice(0, 4).map((s, i) => <SocketRow key={`o${i}`} tk={tk} kind="out" label={s.label} type={s.type} />)}
          </div>
        )}
        <Button size="sm" variant="primary" icon="plus" onClick={onActivate}>Add to graph</Button>
        {onExampleOpened && <ExamplesStrip key={def.type} id="used-in" hits={examplesForType(def.type, 3)} title="Used in" layout="list" show={3} hideTypes onOpened={onExampleOpened} />}
      </div>
    );
  }
  if (item.kind === 'tile') {
    return (
      <div data-preview-tile={item.key} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {title(<span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Icon name={item.icon} size={16} style={{ color: item.color }} />{item.title}</span>, <span style={chipStyle(tk)}>{item.count}</span>)}
        {item.info && <div style={{ fontSize: 12, color: tk.text.muted, lineHeight: 1.5 }}>{item.info}</div>}
        <div style={{ fontSize: 11.5, color: tk.text.faint, lineHeight: 1.6 }}>{item.preview.join(' · ')}</div>
        <Button size="sm" icon="chevR" onClick={onActivate}>Open</Button>
      </div>
    );
  }
  if (item.kind === 'builder') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {title(item.b.title)}
        <div style={{ fontSize: 12, color: tk.text.muted, lineHeight: 1.5 }}>{item.b.description}</div>
        <div style={{ fontSize: 12, color: tk.text.faint }}>Make: <span style={{ color: tk.text.secondary }}>{item.b.makes}</span></div>
        <Button size="sm" variant="primary" icon={item.b.icon} onClick={onActivate}>Open</Button>
      </div>
    );
  }
  if (item.kind === 'preset') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {title(item.preset.label, <span style={{ ...chipStyle(tk), color: pal.yellow }}>preset</span>)}
        {item.preset.description && <div style={{ fontSize: 12, color: tk.text.muted }}>{item.preset.description}</div>}
        <div style={{ fontSize: 12, color: tk.text.faint }}>{item.preset.subgraph.nodes.length} nodes</div>
        <Button size="sm" variant="primary" icon="plus" onClick={onActivate}>Add to graph</Button>
        <Button size="sm" variant="danger" icon="trash" onClick={() => onDeletePreset(item.preset.id)}>Delete preset</Button>
      </div>
    );
  }
  return <div style={{ color: tk.text.faint, fontSize: 12 }}>{item.label}</div>;
}

function SocketRow({ tk, kind, label, type }: { tk: Tokens; kind: 'in' | 'out'; label: string; type: string }) {
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
      <span style={{ color: tk.text.faint, fontSize: 10, width: 26, flexShrink: 0, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{kind}</span>
      <span style={{ color: tk.text.primary, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
      <span style={{ fontFamily: fontFamily.mono, color: tk.text.faint }}>{type}</span>
    </div>
  );
}
