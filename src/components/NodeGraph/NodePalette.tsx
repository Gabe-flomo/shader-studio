import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNodeGraphStore, SAVED_GRAPHS_CHANGED, loadCustomFns, EXAMPLE_INDEX, EXAMPLE_FOLDERS, loadExprPresets, deleteExprPreset, renameExprPreset, loadTransformPresets, deleteTransformPreset, renameTransformPreset, loadKeyframePresets, deleteKeyframePreset, renameKeyframePreset } from '../../store/useNodeGraphStore';
import { NODE_REGISTRY, getNodeDefinition } from '../../nodes/definitions';
import { NodeBrowser } from './NodeBrowser';
import { ImportGlslModal } from './ImportGlslModal';
import { FolderableList } from './FolderableList';
import type { CustomFnPreset } from '../../types/customFnPreset';
import type { GraphNode } from '../../types/nodeGraph';
import type { ExprPreset } from '../../types/exprPreset';
import type { GroupPreset } from '../../types/groupPreset';
import { useUserNodes } from '../../nodes/userNodes/useUserNodes';
import { graphToSubgraph } from '../../nodes/userNodes/graphToSubgraph';
import type { PublishSource } from '../../nodes/userNodes/publishUserNode';
import { Toggle } from '../ui/Choice';
import { lazyWithSuspense, type PropsOf } from '../lazyWithSuspense';
import type { PublishNodeModal as PublishNodeModalT } from './PublishNodeModal';
const PublishNodeModal = lazyWithSuspense<PropsOf<typeof PublishNodeModalT>>(() => import('./PublishNodeModal').then(m => ({ default: m.PublishNodeModal })));
import type { TransformPreset } from '../../types/transformPreset';
import type { KeyframePreset } from '../../types/keyframePreset';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius, type Tokens } from '../../theme/tokens';
import { Button, IconButton } from '../ui/Button';
import { Field } from '../ui/Field';
import { Icon } from '../ui/Icon';
import type { IconName } from '../ui/iconPaths';
import { Tooltip } from '../ui/Tooltip';
import { reportFileResult } from '../shell/reportFileResult';
import { toast } from '../ui/toastStore';

// ── Types ─────────────────────────────────────────────────────────────────────
type TabId = 'nodes' | 'favorites' | 'graphs' | 'presets' | 'builder' | 'functions' | 'expressions' | 'keyframes';

interface ContentPaneState {
  id: string;
  activeTab: TabId;
  flexGrow: number;
}

// Each tab's identity colour, used for its rail icon and its items' glyphs.
const SIDEBAR_TABS: Array<{ id: TabId; label: string; icon: IconName; color: (tk: Tokens) => string }> = [
  { id: 'nodes',       label: 'Nodes',           icon: 'nodes',   color: tk => tk.accent.base },
  { id: 'favorites',   label: 'Favorites',       icon: 'star',    color: tk => tk.status.warning },
  { id: 'graphs',      label: 'Saved Graphs',    icon: 'graphs',  color: tk => tk.status.success },
  { id: 'presets',     label: 'Presets',         icon: 'presets', color: tk => tk.accent.base },
  { id: 'builder',     label: 'Node Builder',    icon: 'spark',   color: tk => tk.kind.fn },
  { id: 'functions',   label: 'Functions',       icon: 'fn',      color: tk => tk.kind.fn },
  { id: 'expressions', label: 'Expression Blocks', icon: 'expr',    color: tk => tk.kind.expr },
  { id: 'keyframes',   label: 'Saved Keyframes', icon: 'kf',      color: tk => tk.status.warning },
];

// ── Saved-item row ────────────────────────────────────────────────────────────
function ItemRow({ label, icon, color, onClick, onDoubleClick, selected = false, preview, onDelete, onRename, onEdit, editLabel = 'Edit', onExport }: {
  label: string; icon: IconName; color: string;
  onClick: () => void;
  /** Saved items: click selects (showing `preview`), double-click places */
  onDoubleClick?: () => void;
  selected?: boolean;
  preview?: React.ReactNode;
  onDelete?: () => void;
  onRename?: () => void;
  /** Open the item for editing (distinct from renaming). */
  onEdit?: () => void;
  editLabel?: string;
  /** Save the item as a shareable file. */
  onExport?: () => void;
}) {
  const tk = useTokens();
  const [hovered, setHovered] = useState(false);
  const row = (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        height: 32, display: 'flex', alignItems: 'center', gap: 9, padding: '0 4px 0 8px', borderRadius: radius.md,
        background: selected ? tk.bg.selected : hovered ? tk.bg.hover : 'transparent',
      }}
    >
      <Icon name={icon} size={15} style={{ color }} />
      <button
        type="button"
        // The second click of a double-click shouldn't collapse the preview it just opened
        onClick={e => { if (onDoubleClick && e.detail > 1) return; onClick(); }}
        onDoubleClick={onDoubleClick}
        aria-expanded={preview !== undefined ? selected : undefined}
        title={onDoubleClick ? `${label} · double-click to add` : label}
        style={{
          flex: 1, minWidth: 0, height: '100%', border: 0, background: 'none', padding: 0, textAlign: 'left', cursor: 'pointer',
          color: tk.text.secondary, font: `12.5px ${fontFamily.ui}`, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}
      >{label}</button>
      {(hovered || selected) && onExport && <IconButton icon="export" label="Export as a file" size="sm" onClick={e => { e.stopPropagation(); onExport(); }} />}
      {(hovered || selected) && onEdit && <IconButton icon="layoutGraph" label={editLabel} size="sm" onClick={e => { e.stopPropagation(); onEdit(); }} />}
      {(hovered || selected) && onRename && <IconButton icon="edit" label="Rename" size="sm" onClick={e => { e.stopPropagation(); onRename(); }} />}
      {(hovered || selected) && onDelete && <IconButton icon="trash" label="Delete" size="sm" tone="danger" onClick={e => { e.stopPropagation(); onDelete(); }} />}
    </div>
  );
  if (!selected || !preview) return row;
  return <div>{row}{preview}</div>;
}

/**
 * Card under a selected saved item: its name and kind, a one-line signature, the comment it was
 * saved with, and Add to graph (double-clicking the row does the same).
 */
function SavedItemPreview({ name, kind, signature, comment, onAdd }: {
  name: string; kind: string; signature?: string; comment?: string; onAdd: () => void;
}) {
  const tk = useTokens();
  return (
    <div style={{ margin: '4px 2px 8px', padding: '10px 12px', borderRadius: radius.md, background: tk.bg.panel, boxShadow: `inset 0 0 0 1px ${tk.border.default}`, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <b style={{ fontWeight: 600, fontSize: 13, color: tk.text.primary, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</b>
        <span style={{ fontSize: 11, color: tk.text.faint }}>{kind}</span>
      </div>
      {signature && (
        <code style={{ font: `11.5px/1.5 ${fontFamily.mono}`, color: tk.text.secondary, background: tk.bg.field, borderRadius: 6, padding: '5px 8px', overflowWrap: 'anywhere' }}>{signature}</code>
      )}
      {comment ? (
        <div style={{ display: 'flex', gap: 7, fontSize: 12, lineHeight: 1.45, color: tk.text.secondary }}>
          <Icon name="comment" size={14} style={{ color: tk.text.faint, flexShrink: 0, marginTop: 1 }} />
          <span style={{ whiteSpace: 'pre-wrap' }}>{comment}</span>
        </div>
      ) : (
        <span style={{ fontSize: 11.5, color: tk.text.faint }}>No comment. Add one on the node before saving to see it here.</span>
      )}
      <Button size="sm" variant="primary" icon="plus" onClick={onAdd} style={{ alignSelf: 'flex-start' }}>Add to graph</Button>
    </div>
  );
}

const signatureOf = (name: string, outputType: string, inputs: Array<{ name: string; type: string }>) =>
  `${outputType} ${name.replace(/\s+/g, '_')}(${inputs.map(i => `${i.type} ${i.name}`).join(', ')})`;

function RenameField({ value, onChange, onCommit, onCancel }: {
  value: string; onChange: (v: string) => void; onCommit: () => void; onCancel: () => void;
}) {
  return (
    <Field
      autoFocus
      value={value}
      height={30}
      onChange={e => onChange(e.target.value)}
      onBlur={onCommit}
      onKeyDown={e => { if (e.key === 'Enter') onCommit(); if (e.key === 'Escape') onCancel(); e.stopPropagation(); }}
    />
  );
}

// ── EmptyHint ─────────────────────────────────────────────────────────────────
function EmptyHint({ children }: { children: React.ReactNode }) {
  const tk = useTokens();
  return <div style={{ fontSize: 12, color: tk.text.faint, padding: '2px 4px', lineHeight: 1.5 }}>{children}</div>;
}

// ── TabSectionHeader ──────────────────────────────────────────────────────────
function TabSectionHeader({ label, action }: { label: string; action?: React.ReactNode }) {
  const tk = useTokens();
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '10px 0 4px' }}>
      <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: tk.text.faint }}>{label}</span>
      <div style={{ flex: 1, height: 1, background: tk.border.subtle }} />
      {action}
    </div>
  );
}


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
}

function ContentPane({ state, isFocused, onFocus, onClose, isOnly, favorites, onToggleFavorite, nodeButtonRefs, onNodeAdded, flexGrow, context, onGlslInsert }: ContentPaneProps) {
  const tk = useTokens();
  // Saved items: the one showing its preview card
  const [selectedSaved, setSelectedSaved] = useState<string | null>(null);
  const toggleSaved = (id: string) => setSelectedSaved(cur => (cur === id ? null : id));
  /** Where a saved item lands: the middle of the view (a card's top-left, so offset by half a card) */
  const placeAt = () => {
    const c = useNodeGraphStore.getState()._viewportCenterGetter?.();
    return c ? { x: c.x - 180, y: c.y - 90 } : { x: 200 + Math.random() * 120, y: 120 + Math.random() * 200 };
  };
  const addNode                 = useNodeGraphStore(s => s.addNode);
  const saveGraph               = useNodeGraphStore(s => s.saveGraph);
  const getSavedGraphNames      = useNodeGraphStore(s => s.getSavedGraphNames);
  const loadSavedGraph          = useNodeGraphStore(s => s.loadSavedGraph);
  const deleteSavedGraph        = useNodeGraphStore(s => s.deleteSavedGraph);
  const deleteCustomFn          = useNodeGraphStore(s => s.deleteCustomFn);
  const exportCustomFns         = useNodeGraphStore(s => s.exportCustomFns);
  const importCustomFnsFromFile = useNodeGraphStore(s => s.importCustomFnsFromFile);
  const loadCustomFnsFromDisk   = useNodeGraphStore(s => s.loadCustomFnsFromDisk);
  const swapTargetNodeId        = useNodeGraphStore(s => s.swapTargetNodeId);
  const setSwapTargetNodeId     = useNodeGraphStore(s => s.setSwapTargetNodeId);
  const swapNode                = useNodeGraphStore(s => s.swapNode);
  const graphNodes        = useNodeGraphStore(s => s.nodes);
  const groupPresets      = useNodeGraphStore(s => s.groupPresets);
  const instantiateGroupPreset = useNodeGraphStore(s => s.instantiateGroupPreset);
  const deleteGroupPreset = useNodeGraphStore(s => s.deleteGroupPreset);
  const deleteUserNode     = useNodeGraphStore(s => s.deleteUserNode);
  const openUserNodeSource = useNodeGraphStore(s => s.openUserNodeSource);
  const exportUserNodes    = useNodeGraphStore(s => s.exportUserNodes);
  const readSavedGraphNodes = useNodeGraphStore(s => s.readSavedGraphNodes);
  const [publishSource, setPublishSource] = useState<PublishSource | null>(null);
  const [publishExisting, setPublishExisting] = useState<string | undefined>(undefined);
  const [exposeUv, setExposeUv] = useState(true);
  const [exposeTime, setExposeTime] = useState(false);
  const openPublishFor = (nodes: GraphNode[] | null, label: string) => {
    if (!nodes) { toast.error(`Couldn’t read “${label}”`); return; }
    const r = graphToSubgraph(nodes, { exposeUv, exposeTime });
    if (!r.ok) { toast.error(`Can’t publish “${label}”`, { message: r.error }); return; }
    setPublishSource({ kind: 'subgraph', subgraph: r.subgraph, label });
  };
  const importUserNodesFromFile = useNodeGraphStore(s => s.importUserNodesFromFile);
  const importUserNodes = async () => {
    const r = await importUserNodesFromFile();
    if (!r.ok) { reportFileResult(r, { failTitle: 'Couldn’t import node types' }); return; }
    const parts = [
      r.imported?.length ? `${r.imported.length} new: ${r.imported.join(', ')}` : '',
      r.replaced?.length ? `${r.replaced.length} updated: ${r.replaced.join(', ')}` : '',
    ].filter(Boolean);
    toast.success('Node types imported', { message: parts.join(' · ') });
  };
  const userNodes          = useUserNodes();
  const getViewportCenter = useNodeGraphStore(s => s._viewportCenterGetter);
  const loadExampleGraph  = useNodeGraphStore(s => s.loadExampleGraph);

  const [query, setQuery]                           = useState('');
  const [savedNames, setSavedNames]                 = useState<string[]>(() => getSavedGraphNames());
  const [graphSaveInput, setGraphSaveInput]         = useState('');
  const [showGraphSaveInput, setShowGraphSaveInput] = useState(false);
  const [userPresets, setUserPresets]               = useState<CustomFnPreset[]>(() => loadCustomFns());
  const [exprPresets, setExprPresets]               = useState<ExprPreset[]>(() => loadExprPresets());
  const [transformPresets, setTransformPresets]     = useState<TransformPreset[]>(() => loadTransformPresets());
  const [renamingExprId, setRenamingExprId]         = useState<string | null>(null);
  const [renameExprValue, setRenameExprValue]       = useState('');
  const [renamingTransformId, setRenamingTransformId] = useState<string | null>(null);
  const [renameTransformValue, setRenameTransformValue] = useState('');
  const [keyframePresets, setKeyframePresets]       = useState<KeyframePreset[]>(() => loadKeyframePresets());
  const [renamingKeyframeId, setRenamingKeyframeId] = useState<string | null>(null);
  const [renameKeyframeValue, setRenameKeyframeValue] = useState('');
  const [examplesExpanded, setExamplesExpanded]     = useState(false);
  const [openFolders, setOpenFolders]               = useState<Set<string>>(new Set());
  const [showImport, setShowImport]                 = useState(false);

  const { activeTab } = state;

  const refreshSavedNames     = () => setSavedNames(getSavedGraphNames());
  // Saves and deletes from anywhere (the top bar too) keep this list current
  useEffect(() => {
    const onChange = () => setSavedNames(useNodeGraphStore.getState().getSavedGraphNames());
    window.addEventListener(SAVED_GRAPHS_CHANGED, onChange);
    return () => window.removeEventListener(SAVED_GRAPHS_CHANGED, onChange);
  }, []);
  const refreshExprPresets    = () => setExprPresets(loadExprPresets());
  const refreshTransformPresets = () => setTransformPresets(loadTransformPresets());
  const refreshKeyframePresets = () => setKeyframePresets(loadKeyframePresets());

  const refreshPresets = useCallback(async () => {
    const local = loadCustomFns();
    const disk  = await loadCustomFnsFromDisk();
    const seen  = new Set<string>();
    const merged: CustomFnPreset[] = [];
    for (const p of [...disk, ...local]) {
      if (!seen.has(p.id)) { seen.add(p.id); merged.push(p); }
    }
    merged.sort((a, b) => a.savedAt - b.savedAt);
    setUserPresets(merged);
  }, [loadCustomFnsFromDisk]);

  useEffect(() => {
    refreshPresets();
    window.addEventListener('focus', refreshPresets);
    window.addEventListener('customfn-changed', refreshPresets);
    return () => { window.removeEventListener('focus', refreshPresets); window.removeEventListener('customfn-changed', refreshPresets); };
  }, [refreshPresets]);

  useEffect(() => {
    refreshExprPresets();
    window.addEventListener('exprpreset-changed', refreshExprPresets);
    return () => window.removeEventListener('exprpreset-changed', refreshExprPresets);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    refreshTransformPresets();
    window.addEventListener('transformpreset-changed', refreshTransformPresets);
    return () => window.removeEventListener('transformpreset-changed', refreshTransformPresets);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    refreshKeyframePresets();
    window.addEventListener('keyframepreset-changed', refreshKeyframePresets);
    return () => window.removeEventListener('keyframepreset-changed', refreshKeyframePresets);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleAdd = (type: string) => {
    if (swapTargetNodeId) { swapNode(swapTargetNodeId, type); onNodeAdded?.(); return; }
    const center = getViewportCenter?.() ?? { x: 300, y: 200 };
    addNode(type, { x: center.x + (Math.random() - 0.5) * 60, y: center.y + (Math.random() - 0.5) * 60 });
    onNodeAdded?.();
  };

  const swapTargetLabel = swapTargetNodeId
    ? (() => { const n = graphNodes.find(nd => nd.id === swapTargetNodeId); if (!n) return null; return getNodeDefinition(n.type)?.label ?? n.type; })()
    : null;

  const toggleFolder = (label: string) =>
    setOpenFolders(prev => { const n = new Set(prev); if (n.has(label)) n.delete(label); else n.add(label); return n; });

  const saveCurrentGraph = async () => {
    const name = graphSaveInput.trim();
    if (!name) return;
    const ok = reportFileResult(await saveGraph(name), { failTitle: `Couldn’t save “${name}”`, success: `Saved “${name}”` });
    refreshSavedNames();
    if (!ok) return;
    setShowGraphSaveInput(false);
    setGraphSaveInput('');
  };

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
            <NodeBrowser onAdd={handleAdd} swapTargetNodeId={swapTargetNodeId} favorites={favorites} onToggleFavorite={onToggleFavorite} nodeButtonRefs={nodeButtonRefs} searchQuery={query} context={context} onGlslInsert={onGlslInsert} />
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
                              <ItemRow key={k} label={EXAMPLE_INDEX[k].label} icon="graphs" color={tk.status.success}
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
                return <ItemRow key={t} label={def.label} icon="starF" color={tabColor('favorites')} onClick={() => handleAdd(t)} onDelete={() => onToggleFavorite(t)} />;
              })}
            </div>
          );

      case 'graphs':
        return (
          <>
            {showGraphSaveInput ? (
              <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                <Field autoFocus value={graphSaveInput} onChange={e => setGraphSaveInput(e.target.value)} placeholder="Graph name" height={30}
                  onKeyDown={e => { if (e.key === 'Enter') saveCurrentGraph(); if (e.key === 'Escape') setShowGraphSaveInput(false); }}
                  style={{ flex: 1 }} />
                <Button size="sm" variant="primary" disabled={!graphSaveInput.trim()} onClick={saveCurrentGraph}>Save</Button>
              </div>
            ) : (
              <Button size="sm" icon="save" style={{ alignSelf: 'flex-start', marginBottom: 6 }}
                onClick={() => { setShowGraphSaveInput(true); setGraphSaveInput(''); }}>Save current graph</Button>
            )}
            <FolderableList
              scopeKey="graphs"
              color={tabColor('graphs')}
              items={savedNames.map(name => ({ id: name, label: name }))}
              renderItem={(item) => (
                <ItemRow label={item.label} icon="graphs" color={tabColor('graphs')}
                  onClick={() => { if (reportFileResult(loadSavedGraph(item.id), { failTitle: `Couldn’t open “${item.label}”` })) onNodeAdded?.(); }}
                  onDelete={() => { deleteSavedGraph(item.id); refreshSavedNames(); }} />
              )}
              emptyHint={!showGraphSaveInput && <EmptyHint>Save the current graph to keep it here.</EmptyHint>}
            />
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
                onClick={() => openPublishFor(graphNodes, 'Current graph')}>Publish current graph…</Button>
              <Button size="sm" icon="code" title="Write a GLSL function and publish it as a node"
                onClick={() => setPublishSource({ kind: 'code', code: '', label: 'My Node' })}>Write GLSL…</Button>
            </div>
            <TabSectionHeader label="From a saved graph" />
            <FolderableList
              scopeKey="builder:saved"
              color={tabColor('graphs')}
              items={savedNames.map(name => ({ id: name, label: name }))}
              renderItem={(item) => (
                <ItemRow label={item.label} icon="graphs" color={tabColor('graphs')}
                  onClick={() => openPublishFor(readSavedGraphNodes(item.id), item.label)} />
              )}
              emptyHint={<EmptyHint>Save a graph (Saved Graphs tab) and it can be published from here without opening it.</EmptyHint>}
            />
            <TabSectionHeader label="My nodes" action={
              <span style={{ display: 'flex', gap: 2 }}>
                <IconButton icon="import" label="Import node types from a .json file" size="sm" onClick={importUserNodes} />
                {userNodes.length > 0 && (
                  <IconButton icon="export" label="Export all node types as one .json file" size="sm"
                    onClick={async () => reportFileResult(await exportUserNodes(), { failTitle: 'Couldn’t export node types' })} />
                )}
              </span>
            } />
            <FolderableList
              scopeKey="presets:usernodes"
              color={tabColor('presets')}
              items={userNodes.map(d => ({ id: d.id, label: d.label }))}
              renderItem={(item) => {
                const d = userNodes.find(u => u.id === item.id);
                if (!d) return null;
                return (
                  <ItemRow label={d.label} icon="spark" color={tk.kind.fn}
                    onClick={() => { const x = 200+Math.random()*120, y = 120+Math.random()*200; addNode(d.id, {x,y}); onNodeAdded?.(); }}
                    onEdit={d.source ? () => {
                      if (d.source?.kind === 'code') { setPublishExisting(d.id); setPublishSource({ kind: 'code', code: d.source.code, entry: d.source.entry, label: d.label }); return; }
                      const x = 200+Math.random()*120, y = 120+Math.random()*200;
                      if (openUserNodeSource(d.id, {x,y})) onNodeAdded?.();
                    } : undefined}
                    editLabel={d.source?.kind === 'code' ? 'Edit the GLSL (publish again to update)' : 'Open source graph (publish again to update)'}
                    onExport={async () => reportFileResult(await exportUserNodes([d.id]), { failTitle: `Couldn’t export “${d.label}”` })}
                    onDelete={() => { if (window.confirm(`Delete node type “${d.label}”? Placed instances will stop compiling.`)) deleteUserNode(d.id); }} />
                );
              }}
              emptyHint={<EmptyHint>Publish a group as a node (the ✦ button on a group card) and it appears here — and in Nodes › My Nodes. Or import a .json someone shared.</EmptyHint>}
            />
            {publishSource && <PublishNodeModal source={publishSource} existingId={publishExisting} onClose={() => { setPublishSource(null); setPublishExisting(undefined); }} />}
          </>
        );

      case 'presets':
        return (
          <>
            <TabSectionHeader label="Group presets" />
            <FolderableList
              scopeKey="presets:group"
              color={tabColor('presets')}
              items={(groupPresets as GroupPreset[]).map(p => ({ id: p.id, label: p.label, _preset: p }))}
              renderItem={(item) => {
                const p = (item as typeof item & { _preset: GroupPreset })._preset;
                const place = () => { instantiateGroupPreset(p.id, placeAt()); onNodeAdded?.(); };
                const sub = p.subgraph;
                return (
                  <ItemRow label={p.label} icon="presets" color={tabColor('presets')}
                    selected={selectedSaved === p.id} onClick={() => toggleSaved(p.id)} onDoubleClick={place}
                    preview={<SavedItemPreview name={p.label} kind="Group"
                      signature={`${sub.nodes.length} nodes · ${sub.inputPorts.length} in · ${sub.outputPorts.length} out`}
                      comment={p.description} onAdd={place} />}
                    onDelete={() => deleteGroupPreset(p.id)} />
                );
              }}
              emptyHint={<EmptyHint>Select a group node and save it to create a preset.</EmptyHint>}
            />
            <TabSectionHeader label="Transform Vec" />
            <FolderableList
              scopeKey="presets:transform"
              color={tabColor('presets')}
              items={(transformPresets as TransformPreset[]).map(p => ({ id: p.id, label: p.label, _preset: p }))}
              renderItem={(item) => {
                const p = (item as typeof item & { _preset: TransformPreset })._preset;
                return renamingTransformId === p.id
                  ? <RenameField value={renameTransformValue} onChange={setRenameTransformValue}
                      onCommit={() => { renameTransformPreset(p.id, renameTransformValue); setRenamingTransformId(null); refreshTransformPresets(); }}
                      onCancel={() => setRenamingTransformId(null)} />
                  : <ItemRow label={p.label} icon="layout" color={tabColor('presets')}
                      selected={selectedSaved === p.id} onClick={() => toggleSaved(p.id)}
                      onDoubleClick={() => { addNode('transformVec', placeAt(), { outputType: p.outputType, exprX: p.exprX, exprY: p.exprY, exprZ: p.exprZ, exprW: p.exprW, ...(p.comment ? { __comment: p.comment } : {}) }); onNodeAdded?.(); }}
                      preview={<SavedItemPreview name={p.label} kind="Transform Vec"
                        signature={`${p.outputType}(${[p.exprX, p.exprY, p.outputType !== 'vec2' ? p.exprZ : null, p.outputType === 'vec4' ? p.exprW : null].filter(Boolean).join(', ')})`}
                        comment={p.comment}
                        onAdd={() => { addNode('transformVec', placeAt(), { outputType: p.outputType, exprX: p.exprX, exprY: p.exprY, exprZ: p.exprZ, exprW: p.exprW, ...(p.comment ? { __comment: p.comment } : {}) }); onNodeAdded?.(); }} />}
                      onDelete={() => { deleteTransformPreset(p.id); refreshTransformPresets(); }}
                      onRename={() => { setRenameTransformValue(p.label); setRenamingTransformId(p.id); }} />;
              }}
              emptyHint={<EmptyHint>Open a Transform Vec node and save a preset.</EmptyHint>}
            />
          </>
        );

      case 'functions':
        return (
          <>
            <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
              {userPresets.length > 0 && <Button size="sm" icon="export" onClick={() => exportCustomFns()}>Export</Button>}
              <Button size="sm" icon="import" onClick={async () => { await importCustomFnsFromFile(); await refreshPresets(); }}>Import</Button>
            </div>
            <FolderableList
              scopeKey="functions"
              color={tabColor('functions')}
              items={(userPresets as CustomFnPreset[]).map(p => ({ id: p.id, label: p.label, _preset: p }))}
              renderItem={(item) => {
                const p = (item as typeof item & { _preset: CustomFnPreset })._preset;
                const place = () => {
                  addNode('customFn', placeAt(), { label: p.label, inputs: p.inputs, outputType: p.outputType, body: p.body, glslFunctions: p.glslFunctions, ...(p.comment ? { __comment: p.comment } : {}) });
                  onNodeAdded?.();
                };
                return (
                  <ItemRow label={p.label} icon="fn" color={tabColor('functions')}
                    selected={selectedSaved === p.id} onClick={() => toggleSaved(p.id)} onDoubleClick={place}
                    preview={<SavedItemPreview name={p.label} kind="Custom Function" signature={signatureOf(p.label, p.outputType, p.inputs)} comment={p.comment} onAdd={place} />}
                    onDelete={() => { deleteCustomFn(p.id); refreshPresets(); }} />
                );
              }}
              emptyHint={<EmptyHint>Open a Custom Function node and save it as a preset.</EmptyHint>}
            />
          </>
        );

      case 'expressions':
        return (
          <FolderableList
            scopeKey="expressions"
            color={tabColor('expressions')}
            items={(exprPresets as ExprPreset[]).map(p => ({ id: p.id, label: p.label, _preset: p }))}
            renderItem={(item) => {
              const p = (item as typeof item & { _preset: ExprPreset })._preset;
              return renamingExprId === p.id
                ? <RenameField value={renameExprValue} onChange={setRenameExprValue}
                    onCommit={() => { renameExprPreset(p.id, renameExprValue); setRenamingExprId(null); refreshExprPresets(); }}
                    onCancel={() => setRenamingExprId(null)} />
                : <ItemRow label={p.label} icon="expr" color={tabColor('expressions')}
                    selected={selectedSaved === p.id} onClick={() => toggleSaved(p.id)}
                    onDoubleClick={() => { addNode('exprNode', placeAt(), { label: p.label, inputs: p.inputs, outputType: p.outputType, lines: p.lines, result: p.result, ...(p.comment ? { __comment: p.comment } : {}) }); onNodeAdded?.(); }}
                    preview={<SavedItemPreview name={p.label} kind="Expression Block"
                      signature={`${signatureOf(p.label, p.outputType, p.inputs)} = ${p.result}`}
                      comment={p.comment}
                      onAdd={() => { addNode('exprNode', placeAt(), { label: p.label, inputs: p.inputs, outputType: p.outputType, lines: p.lines, result: p.result, ...(p.comment ? { __comment: p.comment } : {}) }); onNodeAdded?.(); }} />}
                    onDelete={() => { deleteExprPreset(p.id); refreshExprPresets(); }}
                    onRename={() => { setRenameExprValue(p.label); setRenamingExprId(p.id); }} />;
            }}
            emptyHint={<EmptyHint>Open an Expression Block node and save it as a preset.</EmptyHint>}
          />
        );

      case 'keyframes':
        return (
          <FolderableList
            scopeKey="keyframes"
            color={tabColor('keyframes')}
            items={(keyframePresets as KeyframePreset[]).map(p => ({ id: p.id, label: p.label, _preset: p }))}
            renderItem={(item) => {
              const p = (item as typeof item & { _preset: KeyframePreset })._preset;
              return renamingKeyframeId === p.id
                ? <RenameField value={renameKeyframeValue} onChange={setRenameKeyframeValue}
                    onCommit={() => { renameKeyframePreset(p.id, renameKeyframeValue); setRenamingKeyframeId(null); refreshKeyframePresets(); }}
                    onCancel={() => setRenamingKeyframeId(null)} />
                : <ItemRow label={p.label} icon="kf" color={tabColor('keyframes')}
                    onClick={() => window.dispatchEvent(new CustomEvent('apply-keyframe-preset', { detail: { keyframes: p.keyframes } }))}
                    onDelete={() => { deleteKeyframePreset(p.id); refreshKeyframePresets(); }}
                    onRename={() => { setRenameKeyframeValue(p.label); setRenamingKeyframeId(p.id); }} />;
            }}
            emptyHint={<EmptyHint>Save a curve from the keyframe editor. Click a saved curve here to apply it to whichever editor is open.</EmptyHint>}
          />
        );

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
        <div style={{ margin: '0 12px 8px 14px', padding: '6px 6px 6px 10px', borderRadius: radius.md, background: alpha(tk.status.warning, 0.14), color: tk.status.warningText, fontSize: 12, display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          <span style={{ flex: 1 }}>Replacing <strong>{swapTargetLabel}</strong> — pick a node</span>
          <IconButton icon="close" label="Cancel replace" size="sm" onClick={() => setSwapTargetNodeId(null)} />
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
  const getViewportCenter = useNodeGraphStore(s => s._viewportCenterGetter);

  const [favorites, setFavorites] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('nodepalette_favorites') ?? '[]'); } catch { return []; }
  });
  const [drawerQuery, setDrawerQuery] = useState('');
  const [panes, setPanes]             = useState<ContentPaneState[]>(() => [mkPane('nodes')]);
  const [focusedPaneId, setFocusedPaneId] = useState(() => panes[0].id);

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
    const handleAdd = (type: string) => {
      if (swapTargetNodeId) { swapNode(swapTargetNodeId, type); onNodeAdded?.(); return; }
      const center = getViewportCenter?.() ?? { x: 300, y: 200 };
      addNode(type, { x: center.x + (Math.random()-0.5)*60, y: center.y + (Math.random()-0.5)*60 });
      onNodeAdded?.();
    };
    return (
      <div style={{ width: '100%', background: tk.bg.panel, color: tk.text.primary, padding: '4px 12px 20px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minHeight: 0, boxSizing: 'border-box' }}>
        <Field placeholder="Search nodes…" value={drawerQuery} onChange={e => setDrawerQuery(e.target.value)} style={{ marginBottom: 6 }} />
        <NodeBrowser onAdd={handleAdd} swapTargetNodeId={swapTargetNodeId} favorites={favorites} onToggleFavorite={toggleFavorite} nodeButtonRefs={nodeButtonRefs} searchQuery={drawerQuery} />
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

function RailButton({ icon, label, active, onClick }: { icon: IconName; label: string; active: boolean; onClick: () => void }) {
  const tk = useTokens();
  const [hover, setHover] = useState(false);
  return (
    <Tooltip label={label} placement="right">
      <button
        onClick={onClick}
        aria-label={label}
        aria-pressed={active}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        style={{
          width: 36, height: 36, border: 0, borderRadius: 10, padding: 0, cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: active ? tk.bg.selected : hover ? tk.bg.hover : 'transparent',
          color: active ? tk.accent.base : hover ? tk.text.secondary : tk.text.faint,
        }}
      >
        <Icon name={icon} />
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
