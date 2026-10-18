import { ProBadgeFor } from '../account/ProSheet';
import { BROWSE_STAGE_EVENT } from '../../structure/browse';
import React, { useState, useEffect, useRef } from 'react';
import { ItemRow, EmptyHint, TabSectionHeader } from '../library/ItemRow';
import { Library, type LibraryFilter } from '../library/Library';
import { OPEN_LIBRARY } from '../../library/appLibrary';
import { useNodeGraphStore, switchScopeFor, SAVED_GRAPHS_CHANGED, EXAMPLE_INDEX, EXAMPLE_FOLDERS } from '../../store/useNodeGraphStore';
import { NODE_REGISTRY, getNodeDefinitionFor } from '../../nodes/definitions';
import { NodeBrowser } from './NodeBrowser';
import { ImportGlslModal } from './ImportGlslModal';
import type { GraphNode } from '../../types/nodeGraph';
import { useUserNodes } from '../../nodes/userNodes/useUserNodes';
import { graphToSubgraph } from '../../nodes/userNodes/graphToSubgraph';
import type { PublishSource } from '../../nodes/userNodes/publishUserNode';
import { Toggle } from '../ui/Choice';
import { lazyWithSuspense, type PropsOf } from '../lazyWithSuspense';
import type { PublishNodeModal as PublishNodeModalT } from './PublishNodeModal';
const PublishNodeModal = lazyWithSuspense<PropsOf<typeof PublishNodeModalT>>(() => import('./PublishNodeModal').then(m => ({ default: m.PublishNodeModal })));
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius, type Tokens } from '../../theme/tokens';
import { Button, IconButton } from '../ui/Button';
import { Field } from '../ui/Field';
import { Popover } from '../ui/Popover';
import { tidyGlsl } from '../../glsl/format';
import { Icon } from '../ui/Icon';
import type { IconName } from '../ui/iconPaths';
import { Tooltip } from '../ui/Tooltip';
import { toast } from '../ui/toastStore';
import { openTextFile } from '../../utils/fileIO';
import { convertFragmentShader } from '../../nodes/userNodes/glslImport';
import { spawnPoint } from './spawnPoint';
import { LibraryCard } from '../shell/LibraryPanel';
import { creditSentence } from '../../types/credit';
import { HistoryPanel, CountBadge, UnreadDot } from '../history/HistoryPanel';
import { useUnseenActivity } from '../ui/activityStore';
import { OPEN_WHATS_NEW, useWhatsNewUnread } from '../../changelog/releaseNotes';
import { SwapSuggestions } from './SwitchNodePicker';

/** Ask the sidebar to show one of its tabs (detail: { tab }). */
export const OPEN_SIDEBAR_TAB = 'open-sidebar-tab';

// ── Types ─────────────────────────────────────────────────────────────────────
type TabId = 'nodes' | 'favorites' | 'library' | 'builder' | 'history';

interface ContentPaneState {
  id: string;
  activeTab: TabId;
  flexGrow: number;
}

// Each tab's identity colour, used for its rail icon and its items' glyphs.
const SIDEBAR_TABS: Array<{ id: TabId; label: string; icon: IconName; color: (tk: Tokens) => string }> = [
  { id: 'nodes',       label: 'Nodes',           icon: 'nodes',   color: tk => tk.accent.base },
  { id: 'favorites',   label: 'Favorites',       icon: 'star',    color: tk => tk.status.warning },
  // Everything you save, in one place: graphs, presets, functions, Expression Blocks, keyframes, your nodes, shaders, media.
  { id: 'library',     label: 'Library',         icon: 'folder',  color: tk => tk.status.success },
  { id: 'builder',     label: 'Publish node',    icon: 'spark',   color: tk => tk.kind.fn },
  { id: 'history',     label: 'History',         icon: 'history', color: tk => tk.accent.base },
];

// ── ContentPane ───────────────────────────────────────────────────────────────
interface ContentPaneProps {
  state: ContentPaneState;
  isFocused: boolean;
  onFocus: () => void;
  onClose?: () => void;
  isOnly: boolean;
  favorites: string[];
  onToggleFavorite: (type: string) => void;
  nodeButtonRefs: React.MutableRefObject<Map<string, HTMLButtonElement>>;
  onNodeAdded?: () => void;
  flexGrow: number;
  context?: 'studio' | 'glsl';
  onGlslInsert?: (code: string) => void;
  /** Show another tab in this pane (the Library on a filter, say). */
  onShowTab: (tab: TabId, libraryFilter?: LibraryFilter) => void;
}

function ContentPane({ state, isFocused, onFocus, onClose, isOnly, favorites, onToggleFavorite, nodeButtonRefs, onNodeAdded, flexGrow, context, onGlslInsert, onShowTab }: ContentPaneProps) {
  const tk = useTokens();
  const addNode                 = useNodeGraphStore(s => s.addNode);
  const getSavedGraphNames      = useNodeGraphStore(s => s.getSavedGraphNames);
  const savedGraphHasPlay       = useNodeGraphStore(s => s.savedGraphHasPlay);
  const swapTargetNodeId        = useNodeGraphStore(s => s.swapTargetNodeId);
  const setSwapTargetNodeId     = useNodeGraphStore(s => s.setSwapTargetNodeId);
  const swapNode                = useNodeGraphStore(s => s.swapNode);
  const graphNodes        = useNodeGraphStore(s => s.nodes);
  const readSavedGraphNodes = useNodeGraphStore(s => s.readSavedGraphNodes);
  const [publishSource, setPublishSource] = useState<PublishSource | null>(null);
  const [publishExisting, setPublishExisting] = useState<string | undefined>(undefined);
  const [exposeUv, setExposeUv] = useState(true);
  const savedPickRef = useRef<HTMLSpanElement>(null);
  const [savedPickOpen, setSavedPickOpen] = useState(false);
  const [savedPickQ, setSavedPickQ] = useState('');
  const [exposeTime, setExposeTime] = useState(false);
  const openPublishFor = (nodes: GraphNode[] | null, label: string) => {
    if (!nodes) { toast.error(`Couldn’t read “${label}”`); return; }
    const r = graphToSubgraph(nodes, { exposeUv, exposeTime });
    if (!r.ok) { toast.error(`Can’t publish “${label}”`, { message: r.error }); return; }
    setPublishSource({ kind: 'subgraph', subgraph: r.subgraph, label });
  };
  const userNodes          = useUserNodes();
  const loadExampleGraph  = useNodeGraphStore(s => s.loadExampleGraph);

  const [query, setQuery]                           = useState('');
  const [savedNames, setSavedNames]                 = useState<string[]>(() => getSavedGraphNames());
  const [examplesExpanded, setExamplesExpanded]     = useState(false);
  const [openFolders, setOpenFolders]               = useState<Set<string>>(new Set());
  const [showImport, setShowImport]                 = useState(false);

  const { activeTab } = state;

  // Saves and deletes from anywhere (the top bar too) keep the Publish node panel's saved-graph picker current
  useEffect(() => {
    const onChange = () => setSavedNames(useNodeGraphStore.getState().getSavedGraphNames());
    window.addEventListener(SAVED_GRAPHS_CHANGED, onChange);
    return () => window.removeEventListener(SAVED_GRAPHS_CHANGED, onChange);
  }, []);

  const handleAdd = (type: string, params?: Record<string, unknown>) => {
    if (swapTargetNodeId) { swapNode(swapTargetNodeId, type); onNodeAdded?.(); return; }
    addNode(type, spawnPoint(type), params);
    onNodeAdded?.();
  };

  const swapTargetLabel = swapTargetNodeId
    ? (() => { const n = graphNodes.find(nd => nd.id === swapTargetNodeId) ?? switchScopeFor(useNodeGraphStore.getState(), swapTargetNodeId)?.node; if (!n) return null; return getNodeDefinitionFor(n)?.label ?? n.type; })()
    : null;

  const toggleFolder = (label: string) =>
    setOpenFolders(prev => { const n = new Set(prev); if (n.has(label)) n.delete(label); else n.add(label); return n; });


  const tabInfo = SIDEBAR_TABS.find(t => t.id === activeTab)!;
  const tabColor = (id: TabId) => SIDEBAR_TABS.find(t => t.id === id)!.color(tk);
  const foldRow = { height: 30, width: '100%', display: 'flex', alignItems: 'center', gap: 6, padding: '0 6px', border: 0, borderRadius: radius.md, background: 'none', cursor: 'pointer', textAlign: 'left' as const };

  // ── Tab content ───────────────────────────────────────────────────────────
  const renderContent = () => {
    switch (activeTab) {
      case 'nodes':
        return (
          <>
            <Field
              placeholder="Search nodes…"
              value={query}
              onChange={e => setQuery(e.target.value)}
              leading={<Icon name="search" size={15} style={{ color: tk.text.faint }} />}
              style={{ flexShrink: 0, marginBottom: 6 }}
            />
            <NodeBrowser onAdd={handleAdd} onDragAdd={(type, pos, params) => addNode(type, pos, params)} onDragDone={onNodeAdded} swapTargetNodeId={swapTargetNodeId} favorites={favorites} onToggleFavorite={onToggleFavorite} nodeButtonRefs={nodeButtonRefs} searchQuery={query} context={context} onGlslInsert={onGlslInsert} onBuilderOpened={onNodeAdded} />
            {query.trim().length > 0 && (() => {
              // Examples that match the search too, under their own heading: "blur" finds the
              // Blur & Lens folder, "3D" the 3D examples, "midi" the MIDI one.
              const words = query.trim().toLowerCase().split(/\s+/);
              const hits = EXAMPLE_FOLDERS.flatMap(f => f.keys.filter(k => EXAMPLE_INDEX[k]).map(k => ({ k, folder: f.label })))
                .filter(({ k, folder }) => {
                  const e = EXAMPLE_INDEX[k];
                  const hay = `${e.label} ${e.description ?? ''} ${folder} ${e.source ? creditSentence(e.source) : ''}`.toLowerCase();
                  return words.every(w => hay.includes(w));
                })
                .sort((a, b) => {
                  // Label matches first, then folder matches, then descriptions
                  const rank = ({ k, folder }: { k: string; folder: string }) =>
                    words.every(w => EXAMPLE_INDEX[k].label.toLowerCase().includes(w)) ? 0 : words.every(w => folder.toLowerCase().includes(w)) ? 1 : 2;
                  return rank(a) - rank(b) || EXAMPLE_INDEX[a.k].label.localeCompare(EXAMPLE_INDEX[b.k].label);
                });
              if (hits.length === 0) return null;
              return (
                <div style={{ marginTop: 8, borderTop: `1px solid ${tk.border.subtle}`, paddingTop: 6 }}>
                  <div style={{ ...foldRow, color: tk.text.muted, fontWeight: 600, fontSize: 12, cursor: 'default' }}>
                    <Icon name="graphs" size={14} style={{ color: tk.status.success }} />
                    Examples
                    <span style={{ fontSize: 11, color: tk.text.faint, fontWeight: 500 }}>{hits.length}</span>
                  </div>
                  <div style={{ paddingLeft: 14, display: 'flex', flexDirection: 'column', gap: 1 }}>
                    {hits.slice(0, 15).map(({ k, folder }) => (
                      <ItemRow key={k} label={EXAMPLE_INDEX[k].label} icon="graphs" color={tk.status.success} source={EXAMPLE_INDEX[k].source}
                        hint={`${folder}${EXAMPLE_INDEX[k].description ? ` · ${EXAMPLE_INDEX[k].description}` : ''}`}
                        onClick={() => { loadExampleGraph(k); onNodeAdded?.(); }} />
                    ))}
                    {hits.length > 15 && <div style={{ fontSize: 11.5, color: tk.text.faint, padding: '4px 10px' }}>{hits.length - 15} more — narrow the search</div>}
                  </div>
                </div>
              );
            })()}
            {query.trim().length === 0 && (
              <div style={{ marginTop: 8, borderTop: `1px solid ${tk.border.subtle}`, paddingTop: 6 }}>
                <button onClick={() => setExamplesExpanded(v => !v)} style={{ ...foldRow, color: tk.text.muted, fontWeight: 600, fontSize: 12 }}>
                  <Icon name={examplesExpanded ? 'chevD' : 'chevR'} size={14} />
                  Examples
                </button>
                {examplesExpanded && EXAMPLE_FOLDERS.filter(f => f.keys.some(k => EXAMPLE_INDEX[k])).map(folder => {
                  const isOpen = openFolders.has(folder.label);
                  const count = folder.keys.filter(k => EXAMPLE_INDEX[k]).length;
                  return (
                    <div key={folder.label}>
                      <button onClick={() => toggleFolder(folder.label)} style={{ ...foldRow, paddingLeft: 14, color: tk.text.secondary, fontSize: 12.5 }}>
                        <Icon name={isOpen ? 'chevD' : 'chevR'} size={14} style={{ color: tk.text.faint }} />
                        <Icon name="folder" size={15} style={{ color: tk.status.success }} />
                        <span style={{ flex: 1 }}>{folder.label}</span>
                        <span style={{ fontSize: 11, color: tk.text.faint }}>{count}</span>
                      </button>
                      {isOpen && (
                        <div style={{ paddingLeft: 28, display: 'flex', flexDirection: 'column', gap: 1 }}>
                          {folder.keys.filter(k => EXAMPLE_INDEX[k])
                            .sort((a, b) => EXAMPLE_INDEX[a].label.localeCompare(EXAMPLE_INDEX[b].label))
                            .map(k => (
                              <ItemRow key={k} label={EXAMPLE_INDEX[k].label} icon="graphs" color={tk.status.success} hint={EXAMPLE_INDEX[k].description} source={EXAMPLE_INDEX[k].source} tag={EXAMPLE_INDEX[k].play ? 'Play' : undefined}
                                onClick={() => { loadExampleGraph(k); onNodeAdded?.(); }} />
                            ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        );

      case 'favorites':
        return favorites.length === 0
          ? <EmptyHint>Star a node in the Nodes tab to add it here.</EmptyHint>
          : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              {favorites.map(t => {
                const def = NODE_REGISTRY[t];
                if (!def) return null;
                return <ItemRow key={t} label={def.label} icon="starF" color={tabColor('favorites')} onClick={() => handleAdd(t)} drag={swapTargetNodeId ? null : { label: def.label, type: t, place: pos => addNode(t, pos) }} onDragDone={onNodeAdded} onDelete={() => onToggleFavorite(t)} />;
              })}
            </div>
          );

      case 'library':
        return (
          <>
            <Library size="rail" onOpened={onNodeAdded} />
            <div style={{ marginTop: 10 }}><LibraryCard /></div>
          </>
        );

      case 'builder':
        return (
          <>
            <div style={{ fontSize: 12, color: tk.text.muted, lineHeight: 1.5, padding: '2px 2px 6px' }}>
              Turn a whole graph into a single node. Whatever is wired into the graph’s Output becomes the node’s output. Every slider in the graph can stay adjustable on the new node or be frozen at its current value.
            </div>
            <TabSectionHeader label="Inputs on the new node" />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '2px 2px 8px' }}>
              <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', cursor: 'pointer' }}>
                <Toggle checked={exposeUv} onChange={setExposeUv} />
                <span style={{ fontSize: 12, lineHeight: 1.45, color: tk.text.secondary }}>
                  <b style={{ color: tk.text.primary }}>UV socket.</b> The graph’s UV nodes are replaced by one input. Wire anything into it (a warp, a tiling, another node) or leave it empty to use the screen, like the graph did.
                </span>
              </label>
              <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', cursor: 'pointer' }}>
                <Toggle checked={exposeTime} onChange={setExposeTime} />
                <span style={{ fontSize: 12, lineHeight: 1.45, color: tk.text.secondary }}>
                  <b style={{ color: tk.text.primary }}>Time socket.</b> The graph’s Time nodes are replaced by one input, so the node can run on its own clock. Off: it follows the global time.
                </span>
              </label>
            </div>
            <div style={{ display: 'flex', gap: 6, marginBottom: 6, flexWrap: 'wrap' }}>
              <Button size="sm" variant="primary" icon="spark"
                disabled={graphNodes.length === 0}
                onClick={() => openPublishFor(graphNodes, 'Current graph')}>Publish current graph…<ProBadgeFor feature="nodes.publish" /></Button>
              <Button size="sm" icon="code" title="Write a GLSL function and publish it as a node"
                onClick={() => setPublishSource({ kind: 'code', code: '', label: 'My Node' })}>Write GLSL…<ProBadgeFor feature="nodes.publish" /></Button>
              <Button size="sm" icon="import" title="Open a fragment shader (Shadertoy or raw) and turn it into a node"
                onClick={async () => {
                  let code: string | null;
                  try { code = await openTextFile('.glsl,.frag,.fs,.fsh,.shader,.txt'); } catch (e) { toast.error('Couldn’t read that file', { message: e instanceof Error ? e.message : String(e) }); return; }
                  if (code === null) return;
                  // The same reading a paste gets on the GLSL and Convert pages: dialect shims, ES 1.00 form, indentation.
                  const tidy = tidyGlsl(code);
                  const r = convertFragmentShader(tidy.code, { label: 'Imported shader' });
                  if (!r.ok) { toast.error('Couldn’t convert that shader', { message: r.error }); return; }
                  const notes = [...tidy.notes, ...r.notes];
                  if (notes.length) toast.info('Check the converted code', { message: notes.join(' ') });
                  setPublishSource({ kind: 'code', code: r.code, entry: r.entry, label: 'Imported shader' });
                }}>Import GLSL…<ProBadgeFor feature="nodes.publish" /></Button>
            </div>
            <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap', alignItems: 'center' }}>
              <span ref={savedPickRef} style={{ display: 'inline-flex' }}>
                <Button size="sm" icon="graphs" title="Publish a saved graph as a node without opening it" disabled={savedNames.length === 0}
                  onClick={() => { setSavedPickOpen(o => !o); setSavedPickQ(''); }}>Start from a saved graph…<ProBadgeFor feature="nodes.publish" /></Button>
              </span>
              {savedPickOpen && (
                <Popover anchorRef={savedPickRef} onClose={() => setSavedPickOpen(false)} align="start" width={300} padding={8}>
                  <Field autoFocus aria-label="Search saved graphs" placeholder="Search saved graphs" height={30} value={savedPickQ} onChange={e => setSavedPickQ(e.target.value)} />
                  <div style={{ maxHeight: 320, overflowY: 'auto', marginTop: 6 }}>
                    {savedNames.filter(n => !savedPickQ.trim() || n.toLowerCase().includes(savedPickQ.trim().toLowerCase())).map(name => (
                      <ItemRow key={name} label={name} icon="graphs" color={tk.status.success} tag={savedGraphHasPlay(name) ? 'Play' : undefined}
                        onClick={() => { setSavedPickOpen(false); openPublishFor(readSavedGraphNodes(name), name); }} />
                    ))}
                    {savedNames.length > 0 && savedNames.every(n => savedPickQ.trim() && !n.toLowerCase().includes(savedPickQ.trim().toLowerCase())) && <EmptyHint>Nothing matches “{savedPickQ}”.</EmptyHint>}
                  </div>
                </Popover>
              )}
            </div>
            <TabSectionHeader label="My nodes" />
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '2px 2px 8px' }}>
              <span style={{ fontSize: 12, color: tk.text.muted, lineHeight: 1.45, flex: 1, minWidth: 160 }}>
                {userNodes.length ? `${userNodes.length} node type${userNodes.length === 1 ? '' : 's'} published.` : 'Nothing published yet.'} They are in the Library, with your other saved work, and in Nodes › My nodes.
              </span>
              <Button size="sm" icon="folder" onClick={() => onShowTab('library', 'nodes')}>Show in the Library</Button>
            </div>
            {publishSource && <PublishNodeModal source={publishSource} existingId={publishExisting} onClose={() => { setPublishSource(null); setPublishExisting(undefined); }} />}
          </>
        );

      case 'history':
        return <HistoryPanel />;

      default: return null;
    }
  };

  return (
    <div
      onMouseDown={onFocus}
      style={{ flex: `${flexGrow} ${flexGrow} 0`, minHeight: 80, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
    >
      {/* Pane header: tab name + close button */}
      <div style={{ height: 44, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8, padding: '0 8px 0 14px' }}>
        {!isOnly && <Icon name={tabInfo.icon} size={15} style={{ color: isFocused ? tabInfo.color(tk) : tk.text.faint }} />}
        <span style={{ flex: 1, minWidth: 0, fontWeight: 650, fontSize: 14, color: isFocused || isOnly ? tk.text.primary : tk.text.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {tabInfo.label}
        </span>
        {!isOnly && <IconButton icon="close" label="Close pane" size="sm" onMouseDown={e => e.stopPropagation()} onClick={onClose} />}
      </div>

      {/* Swap banner */}
      {swapTargetNodeId && (
        <div style={{ margin: '0 12px 8px 14px', padding: '6px 6px 6px 10px', borderRadius: radius.md, background: alpha(tk.status.warning, 0.14), color: tk.status.warningText, fontSize: 12, display: 'flex', flexDirection: 'column', gap: 6, flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ flex: 1, minWidth: 0 }}>Replacing <strong>{swapTargetLabel}</strong> — pick a node</span>
            <IconButton icon="close" label="Cancel replace" size="sm" onClick={() => setSwapTargetNodeId(null)} />
          </div>
          <SwapSuggestions key={swapTargetNodeId} nodeId={swapTargetNodeId} />
        </div>
      )}

      {/* Scrollable content */}
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '0 12px 12px 14px', display: 'flex', flexDirection: 'column', gap: 4 }}>
        {renderContent()}
      </div>

      {showImport && <ImportGlslModal onClose={() => setShowImport(false)} />}
    </div>
  );
}

// ── NodePalette ───────────────────────────────────────────────────────────────
interface NodePaletteProps {
  mode?: 'full' | 'drawer';
  onNodeAdded?: () => void;
  onCollapse?: () => void;
  context?: 'studio' | 'glsl';
  onGlslInsert?: (code: string) => void;
}

function mkPane(activeTab: TabId = 'nodes'): ContentPaneState {
  return { id: `pane-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, activeTab, flexGrow: 1 };
}

export function NodePalette(props: NodePaletteProps) {
  return <PaletteBody {...props} />;
}

function PaletteBody({ mode = 'full', onNodeAdded, onCollapse, context, onGlslInsert }: NodePaletteProps) {
  // All hooks must be at the top — no hooks after conditional returns
  const tk = useTokens();
  const addNode          = useNodeGraphStore(s => s.addNode);
  const swapTargetNodeId = useNodeGraphStore(s => s.swapTargetNodeId);
  const swapNode         = useNodeGraphStore(s => s.swapNode);

  const [favorites, setFavorites] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('nodepalette_favorites') ?? '[]'); } catch { return []; }
  });
  const [drawerQuery, setDrawerQuery] = useState('');
  const unseen = useUnseenActivity();
  const unreadRelease = useWhatsNewUnread();
  const [panes, setPanes]             = useState<ContentPaneState[]>(() => [mkPane('nodes')]);
  const [focusedPaneId, setFocusedPaneId] = useState(() => panes[0].id);
  // "What's new" on the Updated notice: show the History tab (the panel picks What's new itself).
  useEffect(() => {
    if (mode === 'drawer') return;
    const open = () => setPanes(prev => (prev.some(p => p.activeTab === 'history') ? prev : prev.map(p => (p.id === focusedPaneId ? { ...p, activeTab: 'history' } : p))));
    window.addEventListener(OPEN_WHATS_NEW, open);
    return () => window.removeEventListener(OPEN_WHATS_NEW, open);
  }, [mode, focusedPaneId]);
  // A stage clicked on the flow strip: show the Nodes tab (the browser then shows that stage).
  useEffect(() => {
    if (mode === 'drawer') return;
    const open = () => setPanes(prev => (prev.some(p => p.activeTab === 'nodes') ? prev : prev.map(p => (p.id === focusedPaneId ? { ...p, activeTab: 'nodes' } : p))));
    window.addEventListener(BROWSE_STAGE_EVENT, open);
    return () => window.removeEventListener(BROWSE_STAGE_EVENT, open);
  }, [mode, focusedPaneId]);

  // "Show in the Library" (a filter), and a request for one of the sidebar's tabs (the Library's "Publish node…").
  useEffect(() => {
    if (mode === 'drawer') return;
    const show = (tab: TabId) => setPanes(prev => (prev.some(p => p.activeTab === tab) ? prev : prev.map(p => (p.id === focusedPaneId ? { ...p, activeTab: tab } : p))));
    const lib = () => show('library');
    const tab = (e: Event) => { const t = (e as CustomEvent<{ tab?: string }>).detail?.tab; if (t && SIDEBAR_TABS.some(x => x.id === t)) show(t as TabId); };
    window.addEventListener(OPEN_LIBRARY, lib);
    window.addEventListener(OPEN_SIDEBAR_TAB, tab);
    return () => { window.removeEventListener(OPEN_LIBRARY, lib); window.removeEventListener(OPEN_SIDEBAR_TAB, tab); };
  }, [mode, focusedPaneId]);

  const nodeButtonRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const panesContainerRef = useRef<HTMLDivElement>(null);
  const dragState = useRef<{ startY: number; idxA: number; idxB: number; heightA: number; heightB: number } | null>(null);

  const toggleFavorite = (type: string) => {
    setFavorites(prev => {
      const next = prev.includes(type) ? prev.filter(t => t !== type) : [...prev, type];
      localStorage.setItem('nodepalette_favorites', JSON.stringify(next));
      return next;
    });
  };

  // ── Drawer mode ───────────────────────────────────────────────────────────
  if (mode === 'drawer') {
    const handleAdd = (type: string, params?: Record<string, unknown>) => {
      if (swapTargetNodeId) { swapNode(swapTargetNodeId, type); onNodeAdded?.(); return; }
      addNode(type, spawnPoint(type), params);
      onNodeAdded?.();
    };
    return (
      <div style={{ width: '100%', background: tk.bg.panel, color: tk.text.primary, padding: '4px 12px 20px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minHeight: 0, boxSizing: 'border-box' }}>
        <Field placeholder="Search nodes…" value={drawerQuery} onChange={e => setDrawerQuery(e.target.value)} style={{ marginBottom: 6 }} />
        <NodeBrowser onAdd={handleAdd} swapTargetNodeId={swapTargetNodeId} favorites={favorites} onToggleFavorite={toggleFavorite} nodeButtonRefs={nodeButtonRefs} searchQuery={drawerQuery} onBuilderOpened={onNodeAdded} />
      </div>
    );
  }

  // ── Full mode: icon rail + stacked panes ─────────────────────────────────

  const focusedPane = panes.find(p => p.id === focusedPaneId) ?? panes[0];

  const updatePane = (id: string, updates: Partial<ContentPaneState>) =>
    setPanes(prev => prev.map(p => p.id === id ? { ...p, ...updates } : p));

  const addPane = () => {
    const newPane = mkPane(focusedPane.activeTab);
    setPanes(prev => [...prev, newPane]);
    setFocusedPaneId(newPane.id);
  };

  const closePane = (id: string) => {
    const idx = panes.findIndex(p => p.id === id);
    const newPanes = panes.filter(p => p.id !== id);
    if (focusedPaneId === id) {
      setFocusedPaneId(newPanes[Math.min(idx, newPanes.length - 1)]?.id ?? '');
    }
    setPanes(newPanes);
  };

  const startPaneResize = (e: React.MouseEvent, idxA: number) => {
    e.preventDefault();
    const container = panesContainerRef.current;
    if (!container) return;
    const children = Array.from(container.children) as HTMLElement[];
    // children alternate: pane, handle, pane, handle, pane ...
    const elA = children[idxA * 2];
    const elB = children[idxA * 2 + 2];
    if (!elA || !elB) return;
    dragState.current = {
      startY: e.clientY,
      idxA,
      idxB: idxA + 1,
      heightA: elA.getBoundingClientRect().height,
      heightB: elB.getBoundingClientRect().height,
    };

    const onMove = (ev: MouseEvent) => {
      const ds = dragState.current;
      if (!ds) return;
      const delta = ev.clientY - ds.startY;
      const MIN_H = 80;
      const combined = ds.heightA + ds.heightB;
      const newHeightA = Math.max(MIN_H, Math.min(combined - MIN_H, ds.heightA + delta));
      const newHeightB = combined - newHeightA;
      const totalFlex = panes.reduce((s, p) => s + p.flexGrow, 0);
      const containerH = container.getBoundingClientRect().height;
      const flexPerPx = totalFlex / containerH;
      setPanes(prev => prev.map((p, i) => {
        if (i === ds.idxA) return { ...p, flexGrow: Math.max(0.1, newHeightA * flexPerPx) };
        if (i === ds.idxB) return { ...p, flexGrow: Math.max(0.1, newHeightB * flexPerPx) };
        return p;
      }));
    };

    const onUp = () => {
      dragState.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  return (
    <div style={{ display: 'flex', height: '100%', width: '100%', overflow: 'hidden', background: tk.bg.panel, color: tk.text.primary, font: `12.5px ${fontFamily.ui}` }}>

      {/* Icon rail */}
      <div style={{ width: 52, flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, padding: '10px 0', borderRight: `1px solid ${tk.border.subtle}`, background: tk.bg.subtle }}>
        {SIDEBAR_TABS.map(({ id, label, icon }) => (
          <RailButton key={id} icon={icon} label={label} active={focusedPane.activeTab === id}
            badge={id === 'history' && unseen.count > 0 ? unseen : undefined}
            dot={id === 'history' && unreadRelease}
            onClick={() => updatePane(focusedPane.id, { activeTab: id })} />
        ))}
        {onCollapse && (
          <div style={{ marginTop: 'auto' }}>
            <RailButton icon="chevL" label="Collapse sidebar" active={false} onClick={onCollapse} />
          </div>
        )}
      </div>

      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Content panes — stacked vertically */}
        <div ref={panesContainerRef} style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 }}>
          {panes.map((pane, idx) => (
            <React.Fragment key={pane.id}>
              {idx > 0 && <PaneHandle onMouseDown={e => startPaneResize(e, idx - 1)} />}
              <ContentPane
                state={pane}
                isFocused={pane.id === focusedPaneId}
                onFocus={() => setFocusedPaneId(pane.id)}
                onClose={panes.length > 1 ? () => closePane(pane.id) : undefined}
                isOnly={panes.length === 1}
                favorites={favorites}
                onToggleFavorite={toggleFavorite}
                nodeButtonRefs={nodeButtonRefs}
                onNodeAdded={onNodeAdded}
                flexGrow={pane.flexGrow}
                context={context}
                onGlslInsert={onGlslInsert}
                onShowTab={(tab, filter) => { updatePane(pane.id, { activeTab: tab }); if (filter) setTimeout(() => window.dispatchEvent(new CustomEvent(OPEN_LIBRARY, { detail: { filter } })), 0); }}
              />
            </React.Fragment>
          ))}
        </div>

        {/* Add pane — up to four stacked panes */}
        {panes.length < 4 && (
          <div style={{ flexShrink: 0, borderTop: `1px solid ${tk.border.subtle}` }}>
            <Tooltip label="Split the sidebar to show two tabs at once">
              <button
                onClick={addPane}
                style={{ width: '100%', height: 38, border: 0, background: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, color: tk.text.muted, font: `500 12px ${fontFamily.ui}` }}
              >
                <Icon name="plus" size={14} />Pane
              </button>
            </Tooltip>
          </div>
        )}
      </div>
    </div>
  );
}

function RailButton({ icon, label, active, onClick, badge, dot = false }: {
  icon: IconName; label: string; active: boolean; onClick: () => void;
  /** New notices in the Activity log (History tab). */
  badge?: { count: number; error: boolean };
  /** Release notes not seen yet (History tab's What's new); the count badge wins when both. */
  dot?: boolean;
}) {
  const tk = useTokens();
  const [hover, setHover] = useState(false);
  return (
    <Tooltip label={label} placement="right">
      <button
        onClick={onClick}
        aria-label={`${label}${badge ? `, ${badge.count} new ${badge.count === 1 ? 'notice' : 'notices'}` : ''}${dot ? ', new release notes' : ''}`}
        aria-pressed={active}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        style={{
          width: 36, height: 36, border: 0, borderRadius: 10, padding: 0, cursor: 'pointer', position: 'relative',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: active ? tk.bg.selected : hover ? tk.bg.hover : 'transparent',
          color: active ? tk.accent.base : hover ? tk.text.secondary : tk.text.faint,
        }}
      >
        <Icon name={icon} />
        {badge && <CountBadge count={badge.count} error={badge.error} style={{ position: 'absolute', top: 1, right: 0, boxShadow: `0 0 0 2px ${tk.bg.subtle}` }} />}
        {dot && !badge && <UnreadDot label="" style={{ position: 'absolute', top: 5, right: 5, width: 8, height: 8, boxShadow: `0 0 0 2px ${tk.bg.subtle}` }} />}
      </button>
    </Tooltip>
  );
}

function PaneHandle({ onMouseDown }: { onMouseDown: (e: React.MouseEvent) => void }) {
  const tk = useTokens();
  const [hover, setHover] = useState(false);
  return (
    <div
      onMouseDown={onMouseDown}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{ height: 8, flexShrink: 0, cursor: 'ns-resize', display: 'flex', alignItems: 'center', justifyContent: 'center', borderTop: `1px solid ${tk.border.subtle}` }}
    >
      <span style={{ width: 36, height: 3, borderRadius: 2, background: hover ? tk.accent.base : tk.border.strong }} />
    </div>
  );
}
