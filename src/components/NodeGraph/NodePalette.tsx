import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNodeGraphStore, loadCustomFns, EXAMPLE_GRAPHS, EXAMPLE_FOLDERS, loadExprPresets, deleteExprPreset, renameExprPreset, loadTransformPresets, deleteTransformPreset, renameTransformPreset, loadKeyframePresets, deleteKeyframePreset, renameKeyframePreset } from '../../store/useNodeGraphStore';
import { NODE_REGISTRY, getNodeDefinition } from '../../nodes/definitions';
import { NodeBrowser } from './NodeBrowser';
import { ImportGlslModal } from './ImportGlslModal';
import { FolderableList } from './FolderableList';
import type { CustomFnPreset } from '../../types/customFnPreset';
import type { ExprPreset } from '../../types/exprPreset';
import type { GroupPreset } from '../../types/groupPreset';
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

// ── Types ─────────────────────────────────────────────────────────────────────
type TabId = 'nodes' | 'favorites' | 'graphs' | 'presets' | 'functions' | 'expressions' | 'keyframes';

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
  { id: 'functions',   label: 'Functions',       icon: 'fn',      color: tk => tk.kind.fn },
  { id: 'expressions', label: 'Expr Blocks',     icon: 'expr',    color: tk => tk.kind.expr },
  { id: 'keyframes',   label: 'Saved Keyframes', icon: 'kf',      color: tk => tk.status.warning },
];

// ── Saved-item row ────────────────────────────────────────────────────────────
function ItemRow({ label, icon, color, onClick, onDelete, onRename }: {
  label: string; icon: IconName; color: string;
  onClick: () => void;
  onDelete?: () => void;
  onRename?: () => void;
}) {
  const tk = useTokens();
  const [hovered, setHovered] = useState(false);
  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ height: 32, display: 'flex', alignItems: 'center', gap: 9, padding: '0 4px 0 8px', borderRadius: radius.md, background: hovered ? tk.bg.hover : 'transparent' }}
    >
      <Icon name={icon} size={15} style={{ color }} />
      <button
        type="button"
        onClick={onClick}
        title={label}
        style={{
          flex: 1, minWidth: 0, height: '100%', border: 0, background: 'none', padding: 0, textAlign: 'left', cursor: 'pointer',
          color: tk.text.secondary, font: `12.5px ${fontFamily.ui}`, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}
      >{label}</button>
      {hovered && onRename && <IconButton icon="edit" label="Rename" size="sm" onClick={e => { e.stopPropagation(); onRename(); }} />}
      {hovered && onDelete && <IconButton icon="trash" label="Delete" size="sm" tone="danger" onClick={e => { e.stopPropagation(); onDelete(); }} />}
    </div>
  );
}

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
  const {
    addNode, saveGraph, getSavedGraphNames, loadSavedGraph, deleteSavedGraph,
    deleteCustomFn, exportCustomFns, importCustomFnsFromFile, loadCustomFnsFromDisk,
    swapTargetNodeId, setSwapTargetNodeId, swapNode,
  } = useNodeGraphStore();
  const graphNodes        = useNodeGraphStore(s => s.nodes);
  const groupPresets      = useNodeGraphStore(s => s.groupPresets);
  const instantiateGroupPreset = useNodeGraphStore(s => s.instantiateGroupPreset);
  const deleteGroupPreset = useNodeGraphStore(s => s.deleteGroupPreset);
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
                {examplesExpanded && EXAMPLE_FOLDERS.filter(f => f.keys.some(k => EXAMPLE_GRAPHS[k])).map(folder => {
                  const isOpen = openFolders.has(folder.label);
                  const count = folder.keys.filter(k => EXAMPLE_GRAPHS[k]).length;
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
                          {folder.keys.filter(k => EXAMPLE_GRAPHS[k])
                            .sort((a, b) => EXAMPLE_GRAPHS[a].label.localeCompare(EXAMPLE_GRAPHS[b].label))
                            .map(k => (
                              <ItemRow key={k} label={EXAMPLE_GRAPHS[k].label} icon="graphs" color={tk.status.success}
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
                return (
                  <ItemRow label={p.label} icon="presets" color={tabColor('presets')}
                    onClick={() => { const x = 200+Math.random()*120, y = 120+Math.random()*200; instantiateGroupPreset(p.id, {x,y}); onNodeAdded?.(); }}
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
                      onClick={() => { const x = 200+Math.random()*120, y = 120+Math.random()*200; addNode('transformVec',{x,y},{outputType:p.outputType,exprX:p.exprX,exprY:p.exprY,exprZ:p.exprZ,exprW:p.exprW}); onNodeAdded?.(); }}
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
                return (
                  <ItemRow label={p.label} icon="fn" color={tabColor('functions')}
                    onClick={() => { const x = 200+Math.random()*120, y = 120+Math.random()*200; addNode('customFn',{x,y},{label:p.label,inputs:p.inputs,outputType:p.outputType,body:p.body,glslFunctions:p.glslFunctions}); onNodeAdded?.(); }}
                    onDelete={() => { deleteCustomFn(p.id); refreshPresets(); }} />
                );
              }}
              emptyHint={<EmptyHint>Open a Custom Fn node and save it as a preset.</EmptyHint>}
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
                    onClick={() => { const x = 200+Math.random()*120, y = 120+Math.random()*200; addNode('exprNode',{x,y},{label:p.label,inputs:p.inputs,outputType:p.outputType,lines:p.lines,result:p.result}); onNodeAdded?.(); }}
                    onDelete={() => { deleteExprPreset(p.id); refreshExprPresets(); }}
                    onRename={() => { setRenameExprValue(p.label); setRenamingExprId(p.id); }} />;
            }}
            emptyHint={<EmptyHint>Open an Expr Block node and save it as a preset.</EmptyHint>}
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
  const { addNode, swapTargetNodeId, swapNode } = useNodeGraphStore();
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
