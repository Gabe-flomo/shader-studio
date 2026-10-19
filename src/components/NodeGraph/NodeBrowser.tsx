import { useState, useEffect, useRef, useCallback, type ReactNode } from 'react';
import { scoreNodeDef } from '../../nodes/searchNodes';
import { createPortal } from 'react-dom';
import { InstalledPackCard, PackGlyphSmall } from '../nodePacks/InstalledPackCard';
import { packForCategory } from '../../nodePacks/installed';
import { getAllCategories, getNodesByCategory, getOfferedDefinitions, getNodeDefinition } from '../../nodes/definitions';
import { useUserNodesVersion } from '../../nodes/userNodes/useUserNodes';
import { getUserNode } from '../../nodes/userNodes/userNodeRegistry';
import { DocText } from '../ui/DocText';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { NodeInlineViz, INLINE_VIZ_TYPES } from './NodeInlineViz';
import type { GraphNode } from '../../types/nodeGraph';
import { useTokens } from '../../theme/themeStore';
import { fontFamily, radius } from '../../theme/tokens';
import { Button, IconButton } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { AddHint, CapsLabel, CategoryRow as BrowserCategoryRow, Crumb, Pill } from './browserParts';
import { BuildersSection } from '../builders/BuildersSection';
import { matchBuilders } from '../../builders/registry';
import { FLOWS } from '../../structure/stages';
import { misfitBadge, splitCategories } from '../../structure/relevance';
import { useLibraryPrefs } from '../../structure/libraryPrefs';
import { useFitsHere, useLibraryContext } from './useLibraryRelevance';
import { spawnPoint } from './spawnPoint';
import { useHiddenHere } from './useAddScope';
import { recordRecentNode } from '../../nodes/recentNodes';

import { HIDDEN_NODES, CATEGORY_SECTIONS, rowLabel, VIRTUAL_ROWS, rowOfType, MERGED_CATEGORIES, CATEGORY_INFO, ROW_ADD_PARAMS, nodesOfRow, CATEGORY_ORDER, CATEGORY_GROUPS, byLabel } from './libraryRows';
import { nodeBlurb } from '../../nodes/plainDescriptions';
import { ExamplesStrip } from './ExampleLinks';
import { searchFocusTypes, usingTitle } from './exampleLinksModel';
import { rankMatches } from './nodeSearchModel';
import { examplesForCategory, examplesForType, examplesForTypes } from '../../store/exampleNodeIndex';


// ── GLSL source extractor ─────────────────────────────────────────────────────
function getNodeGLSLSource(type: string): string {
  const def = getNodeDefinition(type);
  if (!def) return '// No definition found';
  const dummyNode: GraphNode = {
    id: 'preview',
    type,
    position: { x: 0, y: 0 },
    params: { ...(def.defaultParams ?? {}) },
    inputs: def.inputs ? Object.fromEntries(Object.entries(def.inputs).map(([k, v]) => [k, { ...v }])) : {},
    outputs: def.outputs ? Object.fromEntries(Object.entries(def.outputs).map(([k, v]) => [k, { ...v }])) : {},
  };
  const inputVars: Record<string, string> = {};
  for (const key of Object.keys(def.inputs ?? {})) inputVars[key] = key;
  const parts: string[] = [];
  const fns = def.glslFunctions ?? (def.glslFunction ? [def.glslFunction] : []);
  if (fns.length) parts.push(fns.join('\n\n').trim());
  try {
    const { code } = def.generateGLSL(dummyNode, inputVars);
    if (code.trim()) parts.push(code.trim());
  } catch { parts.push('// Error generating code'); }
  return parts.join('\n\n') || '// No GLSL source';
}

// ── Synthetic node for preview ────────────────────────────────────────────────
function makeSyntheticNode(type: string): GraphNode {
  const def = getNodeDefinition(type);
  return {
    id: '__palette_preview__',
    type,
    position: { x: 0, y: 0 },
    inputs: def
      ? Object.fromEntries(Object.entries(def.inputs).map(([k, v]) => [k, { ...v, connection: undefined }]))
      : {},
    outputs: def
      ? Object.fromEntries(Object.entries(def.outputs).map(([k, v]) => [k, { ...v }]))
      : {},
    params: {},
  };
}

// ── GLSL source popup (GLSL page) ─────────────────────────────────────────────
function GlslSourcePopup({ type, anchorRef, onInsert, onClose }: {
  type: string;
  anchorRef: React.RefObject<HTMLElement | null>;
  onInsert?: (code: string) => void;
  onClose: () => void;
}) {
  const tk = useTokens();
  const def = getNodeDefinition(type);
  const source = getNodeGLSLSource(type);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const copyToClipboard = () => {
    navigator.clipboard.writeText(source).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }, () => { /* clipboard blocked; the source is still selectable */ });
  };

  // Anchored to the right edge of the palette.
  const anchor = anchorRef.current?.getBoundingClientRect();
  const left = anchor ? anchor.right + 8 : 220;
  const top = anchor ? Math.max(48, anchor.top) : 48;

  return createPortal(
    <div
      style={{
        position: 'fixed', left, top, width: 380, maxHeight: 'calc(100vh - 64px)', zIndex: 500, overflow: 'hidden',
        display: 'flex', flexDirection: 'column', background: tk.bg.panel, borderRadius: radius.lg, boxShadow: tk.shadow.popover,
        font: `12.5px ${fontFamily.ui}`, color: tk.text.primary,
      }}
      onMouseDown={e => e.stopPropagation()}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 10px 10px 14px', borderBottom: `1px solid ${tk.border.subtle}`, flexShrink: 0 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{def?.label ?? type}</div>
          {nodeBlurb(def) && <div style={{ fontSize: 12, color: tk.text.muted, marginTop: 2, lineHeight: 1.45 }}>{nodeBlurb(def)}</div>}
        </div>
        <CategoryChip>{def ? rowLabel(rowOfType(def.type, def.category)) : undefined}</CategoryChip>
        <IconButton icon="close" label="Close" size="sm" onClick={onClose} />
      </div>
      <pre style={{
        flex: 1, minHeight: 0, margin: 0, padding: '12px 14px', overflow: 'auto', whiteSpace: 'pre',
        background: tk.bg.subtle, color: tk.text.secondary, font: `11.5px/1.6 ${fontFamily.mono}`,
      }}>{source}</pre>
      <div style={{ display: 'flex', gap: 6, padding: '10px 14px', borderTop: `1px solid ${tk.border.subtle}`, flexShrink: 0 }}>
        <Button size="sm" variant="primary" icon="code" style={{ flex: 1 }} onClick={() => { onInsert?.(source); onClose(); }}>Insert at cursor</Button>
        <Button size="sm" icon={copied ? 'check' : 'copy'} onClick={copyToClipboard}>{copied ? 'Copied' : 'Copy'}</Button>
      </div>
    </div>,
    document.body
  );
}

function CategoryChip({ children }: { children: ReactNode }) {
  const tk = useTokens();
  return (
    <span style={{ font: `500 10.5px ${fontFamily.mono}`, color: tk.text.muted, background: tk.bg.hover, borderRadius: radius.sm, padding: '2px 6px', flexShrink: 0, whiteSpace: 'nowrap' }}>
      {children}
    </span>
  );
}

// ── Preview card ──────────────────────────────────────────────────────────────
function NodePreviewCard({ type, onAdd, isFavorite, onToggleFavorite, context, onGlslInsert, swapMode, onDismiss, onExampleOpened }: {
  type: string; onAdd: () => void;
  isFavorite: boolean; onToggleFavorite: () => void;
  context?: 'studio' | 'glsl';
  onGlslInsert?: (code: string) => void;
  swapMode: boolean;
  /** Close the preview (after the previewed type was deleted). */
  onDismiss?: () => void;
  /** After one of its "Used in" examples opened. */
  onExampleOpened?: () => void;
}) {
  const tk = useTokens();
  const def = getNodeDefinition(type);
  // User-published node types can be re-opened for editing or deleted from here.
  const userNode = getUserNode(type);
  const deleteUserNode = useNodeGraphStore(s => s.deleteUserNode);
  const openUserNodeSource = useNodeGraphStore(s => s.openUserNodeSource);
  const exportUserNodes = useNodeGraphStore(s => s.exportUserNodes);
  const node = makeSyntheticNode(type);
  const hasViz = INLINE_VIZ_TYPES.has(type);
  const isGlsl = context === 'glsl';
  const glslSource = isGlsl ? getNodeGLSLSource(type) : null;

  return (
    <div style={{ marginTop: 8, padding: 10, display: 'flex', flexDirection: 'column', gap: 8, border: `1px solid ${tk.border.default}`, borderRadius: radius.lg, background: tk.bg.panel }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ flex: 1, minWidth: 0, fontWeight: 600, fontSize: 13, color: tk.text.primary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{def?.label ?? type}</span>
        <IconButton
          icon={isFavorite ? 'starF' : 'star'}
          label={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
          size="sm"
          style={isFavorite ? { color: tk.status.warning } : undefined}
          onMouseDown={e => { e.preventDefault(); e.stopPropagation(); onToggleFavorite(); }}
        />
        <CategoryChip>{def ? rowLabel(rowOfType(def.type, def.category)) : undefined}</CategoryChip>
      </div>

      {isGlsl ? (
        <pre style={{
          margin: 0, padding: '6px 8px', maxHeight: 110, overflow: 'auto', whiteSpace: 'pre-wrap', borderRadius: radius.md - 1,
          background: tk.bg.field, color: tk.text.secondary, font: `11.5px/1.55 ${fontFamily.mono}`,
        }}>{glslSource}</pre>
      ) : hasViz ? (
        // The thumbnail is a render surface, so it keeps its own dark look in both themes.
        <div style={{ borderRadius: radius.md, overflow: 'hidden' }}><NodeInlineViz node={node} /></div>
      ) : null}
      {!isGlsl && nodeBlurb(def) && (
        <DocText text={nodeBlurb(def)!} style={{ fontSize: 12, color: tk.text.muted }} />
      )}
      {!isGlsl && userNode && (() => {
        const rows = [
          ...userNode.inputs.map(i => ({ kind: 'in', label: i.label, type: i.type, hint: i.hint })),
          ...userNode.params.map(p => ({ kind: 'param', label: p.label, type: `${p.min} – ${p.max}`, hint: p.hint })),
          ...(userNode.iterations ? [{ kind: 'param', label: userNode.iterations.label, type: `${userNode.iterations.min} – ${userNode.iterations.max} passes`, hint: undefined as string | undefined }] : []),
          ...userNode.outputs.map(o => ({ kind: 'out', label: o.label, type: o.type, hint: o.hint })),
        ];
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, padding: '6px 8px', borderRadius: radius.md, background: tk.bg.subtle, fontSize: 11.5 }}>
            {rows.map((r, i) => (
              <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'baseline', flexWrap: 'wrap' }}>
                <span style={{ color: tk.text.faint, fontSize: 10, width: 34, flexShrink: 0, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{r.kind}</span>
                <span style={{ fontFamily: fontFamily.mono, color: tk.text.primary }}>{r.label}</span>
                <span style={{ fontFamily: fontFamily.mono, color: tk.text.faint }}>{r.type}</span>
                {r.hint && <DocText text={r.hint} style={{ color: tk.text.muted, flexBasis: '100%', paddingLeft: 40, fontSize: 11.5 }} />}
              </div>
            ))}
          </div>
        );
      })()}

      {isGlsl ? (
        <Button size="sm" variant="primary" icon="code" onClick={() => { if (glslSource) onGlslInsert?.(glslSource); }}>Insert at cursor</Button>
      ) : (
        <Button size="sm" variant="primary" icon="plus" onClick={onAdd}>{swapMode ? 'Replace with this' : 'Add to graph'}</Button>
      )}
      {!isGlsl && !swapMode && <ExamplesStrip key={type} id="used-in" hits={examplesForType(type, 3)} title="Used in" layout="list" show={3} hideTypes onOpened={onExampleOpened} />}
      {userNode && !isGlsl && (
        <div style={{ display: 'flex', gap: 6, paddingTop: 6, borderTop: `1px solid ${tk.border.subtle}`, flexWrap: 'wrap' }}>
          {userNode.sealed ? (
            <span title="From a sealed node pack: its GLSL is encrypted and never shown" style={{ flexBasis: '100%', color: tk.text.faint, fontSize: 11.5 }}>
              Sealed node pack{userNode.signedBy ? `, signed by ${userNode.signedBy.name} (${userNode.signedBy.fingerprint})` : ''}: it can be used, not opened or shared unsealed.
            </span>
          ) : userNode.sourceHidden && (
            <span title="Published without its source graph: it can be used, not opened" style={{ flexBasis: '100%', color: tk.text.faint, fontSize: 11.5 }}>
              Source not included: this node can be used but not opened.
            </span>
          )}
          {userNode.source && (
            <Button size="sm" icon="layoutGraph" style={{ flex: 1 }} title="Place the node's source graph as a group; publish it again to update this node type"
              onClick={() => openUserNodeSource(userNode.id, spawnPoint())}>
              Open source graph
            </Button>
          )}
          <Button size="sm" icon="export" title="Save this node type as a signed node pack (.playfile), optionally sealed, to share or import into another project"
            onClick={() => exportUserNodes([userNode.id])}>
            Export
          </Button>
          <Button size="sm" variant="danger" icon="trash" title="Delete this node type. Placed instances stop compiling."
            onClick={() => {
              if (window.confirm(`Delete node type “${userNode.label}”?\n\nAny placed instances will stop compiling until they're removed.`)) {
                deleteUserNode(userNode.id);
                onDismiss?.();
              }
            }}>
            Delete node type
          </Button>
        </div>
      )}
    </div>
  );
}

// ── Props ─────────────────────────────────────────────────────────────────────
interface NodeBrowserProps {
  /** `params`: a row's starting settings for the node (a Transform added from the 3D row is 3D). */
  onAdd: (type: string, params?: Record<string, unknown>) => void;
  /** Add `type` at a graph position (a pill dragged onto the graph). Left out: pills don't drag. */
  onDragAdd?: (type: string, position: { x: number; y: number }, params?: Record<string, unknown>) => string | undefined;
  /** After a drop, e.g. to close a drawer. */
  onDragDone?: () => void;
  swapTargetNodeId: string | null;
  favorites: string[];
  onToggleFavorite: (type: string) => void;
  nodeButtonRefs: React.MutableRefObject<Map<string, HTMLButtonElement>>;
  searchQuery: string;
  context?: 'studio' | 'glsl';
  onGlslInsert?: (code: string) => void;
  /** After a builder in the Builders section opened, e.g. to close a drawer. */
  onBuilderOpened?: () => void;
}

// ── Main component ────────────────────────────────────────────────────────────
export function NodeBrowser({
  onAdd, onDragAdd, onDragDone, swapTargetNodeId, favorites, onToggleFavorite, nodeButtonRefs, searchQuery,
  context, onGlslInsert, onBuilderOpened,
}: NodeBrowserProps) {
  const tk = useTokens();
  const [path, setPath] = useState<string[]>([]);
  const [previewType, setPreviewType] = useState<string | null>(null);
  const [highlightType, setHighlightType] = useState<string | null>(null);
  const [glslPopupType, setGlslPopupType] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isGlsl = context === 'glsl';
  // The Builders section (docs/node-browser.md): not in the GLSL page's browser, nor while picking a node to switch to.
  const showBuilders = !isGlsl && !swapTargetNodeId;

  const isSearching = searchQuery.trim().length > 0;
  // What is relevant to this graph (structure/relevance.ts); not for the GLSL page's browser or a node switch.
  const relevanceOn = !isGlsl && !swapTargetNodeId;
  const relevantOnly = useLibraryPrefs(s => s.relevantOnly);
  const setRelevantOnly = useLibraryPrefs(s => s.setRelevantOnly);
  const libCtx = useLibraryContext(relevanceOn);
  // Scene Pos / Scene Output… only inside the group they belong to (nodes/addScope.ts).
  const hidden = useHiddenHere(HIDDEN_NODES);
  const fits = useFitsHere(relevanceOn && relevantOnly, hidden);
  const [showOther, setShowOther] = useState(false);

  useUserNodesVersion(); // re-render when a node type is published or deleted
  const allCats = getAllCategories();
  const categories = [
    ...CATEGORY_ORDER.filter(c => allCats.includes(c)),
    ...allCats.filter(c => !CATEGORY_ORDER.includes(c)).sort(),
  ];

  useEffect(() => {
    const handler = (e: Event) => {
      const { nodeType } = (e as CustomEvent<{ nodeType: string }>).detail;
      const def = getNodeDefinition(nodeType);
      if (!def) return;
      setPath([rowOfType(def.type, def.category)]);
      setPreviewType(nodeType);
      setHighlightType(nodeType);
      setTimeout(() => {
        const btn = nodeButtonRefs.current.get(nodeType);
        btn?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        setTimeout(() => setHighlightType(null), 2000);
      }, 80);
    };
    window.addEventListener('palette-navigate', handler);
    return () => window.removeEventListener('palette-navigate', handler);
  }, [nodeButtonRefs]);

  const handleNodeClick = useCallback((type: string) => {
    if (clickTimerRef.current) clearTimeout(clickTimerRef.current);
    if (isGlsl) {
      setGlslPopupType(prev => prev === type ? null : type);
      return;
    }
    clickTimerRef.current = setTimeout(() => {
      setPreviewType(prev => prev === type ? null : type);
      clickTimerRef.current = null;
    }, 220);
  }, [isGlsl]);

  const handleNodeDblClick = useCallback((type: string) => {
    if (clickTimerRef.current) { clearTimeout(clickTimerRef.current); clickTimerRef.current = null; }
    if (isGlsl) {
      const src = getNodeGLSLSource(type);
      onGlslInsert?.(src);
      setGlslPopupType(null);
      return;
    }
    onAdd(type, ROW_ADD_PARAMS[path[0] ?? '']?.[type]);
    if (!swapTargetNodeId) recordRecentNode(type);
    setPreviewType(null);
  }, [isGlsl, onAdd, onGlslInsert, path, swapTargetNodeId]);

  // A wrap of node pills, with the preview card for the selected one underneath.
  const renderPills = (nodes: Array<{ type: string; label: string; description?: string; badge?: string }>) => (
    <>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {nodes.map(def => (
          <Pill
            key={def.type}
            label={def.label} description={def.description} badge={def.badge}
            isSelected={previewType === def.type}
            isHighlighted={highlightType === def.type}
            onSingleClick={() => handleNodeClick(def.type)}
            onDoubleClick={() => handleNodeDblClick(def.type)}
            swapMode={!!swapTargetNodeId}
            drag={onDragAdd && !isGlsl ? { label: def.label, type: def.type, place: pos => onDragAdd(def.type, pos, ROW_ADD_PARAMS[path[0] ?? '']?.[def.type]) } : null}
            onDragEnd={() => { setPreviewType(null); onDragDone?.(); }}
            btnRef={el => { if (el) nodeButtonRefs.current.set(def.type, el); else nodeButtonRefs.current.delete(def.type); }}
          />
        ))}
      </div>
      {previewType && nodes.some(d => d.type === previewType) && (
        <NodePreviewCard
          type={previewType}
          onAdd={() => handleNodeDblClick(previewType)}
          isFavorite={favorites.includes(previewType)}
          onToggleFavorite={() => onToggleFavorite(previewType)}
          context={context}
          onGlslInsert={onGlslInsert}
          swapMode={!!swapTargetNodeId}
          onDismiss={() => setPreviewType(null)}
          onExampleOpened={onBuilderOpened}
        />
      )}
    </>
  );

  const crumb = (label: ReactNode, count: number) => <Crumb label={label} count={count} onBack={() => { setPath([]); setPreviewType(null); }} />;

  // ── Compute content ────────────────────────────────────────────────────────
  let innerContent: React.ReactNode;

  if (isSearching) {
    const trimmed = searchQuery.trim().toLowerCase();
    const results = getOfferedDefinitions()
      .filter(def => !hidden.has(def.type))
      .map(def => ({ def, score: scoreNodeDef(def, trimmed) }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score || a.def.label.localeCompare(b.def.label))
      .map(({ def }) => ({ type: def.type, label: def.label, description: nodeBlurb(def), badge: relevanceOn ? misfitBadge(def.category, libCtx.flow) ?? undefined : undefined }));
    const builderHits = showBuilders ? matchBuilders(trimmed).length : 0;
    // Examples using the node(s) the search is about (docs/node-browser.md, "Examples using a node").
    const focus = isGlsl || swapTargetNodeId ? [] : searchFocusTypes(rankMatches(getOfferedDefinitions().filter(d => !hidden.has(d.type)), trimmed));
    innerContent = (
      <>
        {builderHits > 0 && <BuildersSection query={trimmed} onOpened={onBuilderOpened} />}
        {results.length === 0
          ? (builderHits ? null : <div style={{ color: tk.text.faint, fontSize: 12, padding: '4px 2px' }}>No matches</div>)
          : <div>{renderPills(results)}</div>}
        {focus.length > 0 && (
          <ExamplesStrip key={focus.join('|')} id="search" hits={examplesForTypes(focus, 10)} title={usingTitle(focus.map(t => getNodeDefinition(t)?.label ?? t))} layout="list" show={3} onOpened={onBuilderOpened} />
        )}
      </>
    );

  } else if (path.length === 0) {
    const filtering = relevanceOn && relevantOnly;
    const countOf = (cat: string) => nodesOfRow(cat).filter(d => !hidden.has(d.type)).length;
    const live = (cat: string) => countOf(cat) > 0;
    const fitsOn = filtering;
    const otherCats: string[] = [];
    const sections = (libCtx.flow === '3d' && filtering
      ? [...CATEGORY_SECTIONS.filter(x => x.label === '3D tools'), ...CATEGORY_SECTIONS.filter(x => x.label !== '3D tools')]
      : CATEGORY_SECTIONS
    ).map(section => {
      const have = section.categories.filter(live);
      if (!filtering) return { label: section.label, cats: have };
      const { fit, other } = splitCategories(have, libCtx.flow);
      otherCats.push(...other);
      return { label: section.label, cats: fit };
    }).filter(s => s.cats.length > 0);
    const favCount = favorites.filter(t => getNodeDefinition(t) && !hidden.has(t)).length;
    innerContent = (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        {libCtx && relevanceOn && (
          <RelevanceBar relevantOnly={relevantOnly} onChange={setRelevantOnly} flowLabel={FLOWS[libCtx.flow].label} flowTitle={libCtx.inside ? `Inside ${getNodeDefinition(libCtx.inside)?.label ?? libCtx.inside}` : `This graph is ${FLOWS[libCtx.flow].label}`} />
        )}
        {fitsOn && fits.defs.length > 0 && (
          <div data-fits-here>
            <CapsLabel rule>Fits here{fits.from ? ` · after ${fits.from}` : ''}</CapsLabel>
            {renderPills(fits.defs)}
          </div>
        )}
        {showBuilders && <BuildersSection onOpened={onBuilderOpened} />}
        {favCount > 0 && (
          <CategoryRow
            key="__favorites__"
            cat="Favorites"
            icon={<Icon name="starF" size={14} style={{ color: tk.status.warning }} />}
            count={favCount}
            onClick={() => { setPath(['__favorites__']); setPreviewType(null); }}
          />
        )}
        {sections.map(section => (
          <div key={section.label}>
            <CapsLabel rule>{section.label}</CapsLabel>
            {section.cats.map(cat => (
              <CategoryRow key={cat} cat={cat} count={countOf(cat)} onClick={() => { setPath([cat]); setPreviewType(null); }} />
            ))}
          </div>
        ))}
        {/* Any categories not covered by sections (My Nodes, node packs by name) */}
        {categories.filter(cat => !CATEGORY_ORDER.includes(cat)).map(cat => {
          const n = getNodesByCategory(cat).filter(d => !hidden.has(d.type)).length;
          if (n === 0) return null;
          const pack = packForCategory(cat);
          return (
            <CategoryRow
              key={cat}
              cat={cat}
              icon={pack ? <PackGlyphSmall pack={pack} /> : undefined}
              count={n}
              onClick={() => { setPath([cat]); setPreviewType(null); }}
            />
          );
        })}
        {otherCats.length > 0 && (
          <div data-not-for-graph>
            <button onClick={() => setShowOther(v => !v)} aria-expanded={showOther}
              style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 6, padding: '12px 2px 4px', border: 0, background: 'transparent', cursor: 'pointer', color: tk.text.faint, font: `700 10px ${fontFamily.ui}`, letterSpacing: '0.08em', textTransform: 'uppercase', textAlign: 'left' }}>
              <Icon name={showOther ? 'chevD' : 'chevR'} size={12} />
              <span>Not for this graph ({otherCats.reduce((n, c) => n + countOf(c), 0)})</span>
              <span style={{ flex: 1, height: 1, background: tk.border.subtle }} />
            </button>
            {showOther && otherCats.map(cat => (
              <CategoryRow key={cat} cat={cat} count={countOf(cat)} onClick={() => { setPath([cat]); setPreviewType(null); }} />
            ))}
          </div>
        )}
      </div>
    );

  } else if (path[0] === '__favorites__') {
    const favDefs = favorites
      .map(t => getNodeDefinition(t))
      .filter((d): d is NonNullable<typeof d> => !!d && !hidden.has(d.type));
    innerContent = (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {crumb('Favorites', favDefs.length)}
        {favDefs.length === 0
          ? <div style={{ color: tk.text.faint, fontSize: 12 }}>No favorites yet</div>
          : renderPills(favDefs)}
      </div>
    );

  } else {
    const cat = path[0];
    const rawNodes = nodesOfRow(cat).filter(d => !hidden.has(d.type));
    // Nodes no group lists still show, under More (and a merged row's other categories by name).
    const listed = CATEGORY_GROUPS[cat];
    const rowTypes = new Set(rawNodes.map(d => d.type));
    const sortedListed = listed ? [...listed].sort((a, b) => (a.label === 'Start here' ? -1 : b.label === 'Start here' ? 1 : byLabel(a.label, b.label))) : undefined;
    const groups = sortedListed ? [...sortedListed, ...((MERGED_CATEGORIES[cat] ?? [cat]).map(c => ({
      label: c === cat ? 'More' : c,
      types: (VIRTUAL_ROWS[cat] ? [...rowTypes] : getNodesByCategory(c).map(d => d.type)).filter(t => !sortedListed.some(g => g.types.includes(t))),
    })))] : undefined;
    // In Agent presets every node is a preset: no need to say so on each.
    const shown = (list: typeof rawNodes) => [...list]
      .map(d => (cat === 'Agent presets' ? { ...d, label: d.label.replace(/\s*\(preset\)$/i, '') } : d))
      // The universal Transform leads its group; the rest are alphabetical.
      .sort((a, b) => (a.type === 'transform' ? -1 : b.type === 'transform' ? 1 : byLabel(a.label, b.label)));
    const info = CATEGORY_INFO[cat];
    innerContent = (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {crumb(rowLabel(cat), rawNodes.length)}
        {info && <div data-category-info style={{ color: tk.text.muted, font: `12px/1.5 ${fontFamily.ui}`, padding: '0 2px 4px' }}>{info}</div>}
        {!isGlsl && <InstalledPackCard category={cat} />}
        {groups ? (
          groups.map(group => {
            const groupNodes = shown(rawNodes.filter(d => group.types.includes(d.type)));
            if (groupNodes.length === 0) return null;
            return (
              <div key={group.label}>
                <CapsLabel>{group.label}</CapsLabel>
                {renderPills(groupNodes)}
              </div>
            );
          })
        ) : (
          <div style={{ marginTop: 4 }}>{renderPills(shown(rawNodes))}</div>
        )}
        {!isGlsl && !swapTargetNodeId && (
          <ExamplesStrip key={cat} id="category" hits={examplesForCategory(rawNodes.map(d => d.type), 8)} title={`Examples with ${rowLabel(cat)}`} layout="list" show={4} onOpened={onBuilderOpened} />
        )}
      </div>
    );
  }

  // Where nodes are listed, how to add one is always on screen (not only in a tooltip).
  const showsPills = !isGlsl && (isSearching || path.length > 0);
  return (
    <>
      {showsPills && <AddHint swap={!!swapTargetNodeId} />}
      <div ref={containerRef}>{innerContent}</div>
      {isGlsl && glslPopupType && (
        <GlslSourcePopup
          type={glslPopupType}
          anchorRef={containerRef}
          onInsert={onGlslInsert}
          onClose={() => setGlslPopupType(null)}
        />
      )}
    </>
  );
}

/** A category of the node list (browserParts' row, with the category's own label and note). */
function CategoryRow({ cat, icon, count, onClick }: { cat: string; icon?: ReactNode; count: number; onClick: () => void }) {
  return <BrowserCategoryRow label={rowLabel(cat)} title={CATEGORY_INFO[cat]} icon={icon} count={count} onClick={onClick} />;
}

// ── Relevant only / Show all ──────────────────────────────────────────────────
function RelevanceBar({ relevantOnly, onChange, flowLabel, flowTitle }: { relevantOnly: boolean; onChange: (v: boolean) => void; flowLabel: string; flowTitle: string }) {
  const tk = useTokens();
  const seg = (on: boolean, label: string, value: boolean) => (
    <button key={label} onClick={() => onChange(value)} aria-pressed={on}
      style={{ flex: 1, height: 24, border: 0, borderRadius: radius.sm, cursor: 'pointer', whiteSpace: 'nowrap', font: `${on ? 600 : 500} 11.5px ${fontFamily.ui}`,
        background: on ? tk.bg.selected : 'transparent', color: on ? tk.accent.text : tk.text.muted }}>{label}</button>
  );
  return (
    <div data-library-relevance style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
      <div style={{ flex: 1, display: 'flex', gap: 2, padding: 2, borderRadius: radius.md, background: tk.bg.field }}>
        {seg(relevantOnly, 'Relevant only', true)}
        {seg(!relevantOnly, 'Show all', false)}
      </div>
      <span title={flowTitle} style={{ fontSize: 10.5, color: tk.text.faint, whiteSpace: 'nowrap' }}>{flowLabel}</span>
    </div>
  );
}
