import type React from 'react';
/**
 * MobileNodeBrowser — the "Nodes" tab inside the mobile Examples sheet.
 *
 * An exploratory reference with a search field on top (the same ranking as
 * NodeSearchPalette, nodeSearchModel.rankMatches): browse by category (and subcategory, for the handful of categories large
 * enough to need one — see subcategory on NodeDefinition), open a node to
 * read its description and see a live preview, then decide whether to add
 * it — disconnected, or wired to something already in the graph.
 *
 * "Add Connected" is a real picker, not a silent best-guess: pick an
 * existing node, then pick which of ITS sockets to wire to which of the
 * new node's sockets, from every type-compatible pairing in either
 * direction (an existing output feeding the new node's input, or the new
 * node's output feeding an existing input) — same typesCompatible()
 * promotion rules (float -> vec2/vec3, ...) used everywhere else.
 */
import { useMemo, useState } from 'react';
import { getNodeDefinition, getNodeDefinitionFor } from '../../nodes/definitions';
import { useUserNodesVersion } from '../../nodes/userNodes/useUserNodes';
import type { GraphNode, NodeDefinition } from '../../types/nodeGraph';
import { useNodeGraphStore, getActiveNodes } from '../../store/useNodeGraphStore';
import { typesCompatible } from '../../lib/typesCompatible';
import { HIDDEN_TYPES } from './nodeCategoryMeta';
import { libraryLayout, rowLabel, rowOfType } from './libraryRows';
import { useHiddenHere } from './useAddScope';
import { categoryColor } from '../../theme/categories';
import { useThemeMode } from '../../theme/themeStore';
import { fontFamily } from '../../theme/tokens';
import { Icon } from '../ui/Icon';
import { InlineVizFrame, GenericPreviewViz, SKIP_INLINE_PREVIEW } from './MobileGraphBrowser';
import { INLINE_VIZ_TYPES } from './NodeInlineViz';
import { useCtp, type CtpPalette } from '../../theme/nodePalette';
import { BuildersSection } from '../builders/BuildersSection';
import { rankMatches } from './nodeSearchModel';

function labelFor(n: GraphNode): string {
  return (typeof n.params.label === 'string' && n.params.label) || getNodeDefinitionFor(n)?.label || n.type;
}

// The same sections, rows, names and sub-groups as the desktop node list (libraryRows.ts).
// Rebuilt when the user-node registry changes (built-ins are static).
function buildCategories(userNodesVersion: number, hidden: ReadonlySet<string>) {
  void userNodesVersion; // the argument is what invalidates the memo below
  return libraryLayout(hidden);
}

// Full-width list row (node types, pairing targets)
const rowBtnStyleFor = (tc: CtpPalette): React.CSSProperties => ({
  display: 'flex', alignItems: 'center', gap: '8px', width: '100%', height: 44, boxSizing: 'border-box',
  background: 'none', border: 'none', padding: '0 12px', textAlign: 'left',
  font: `500 13.5px ${fontFamily.ui}`, color: tc.subtext1, cursor: 'pointer', touchAction: 'manipulation',
});
// "‹ Back to …" pill at the top of a sub-page
const backBtnStyleFor = (tc: CtpPalette): React.CSSProperties => ({
  alignSelf: 'flex-start', height: 32, display: 'inline-flex', alignItems: 'center', gap: 4, padding: '0 12px 0 8px',
  background: tc.surface0, border: 'none', borderRadius: 16, color: tc.subtext1,
  font: `500 12.5px ${fontFamily.ui}`, cursor: 'pointer', touchAction: 'manipulation',
});

// One type-compatible way to wire `newType` (not yet placed) to `existing`
// (a real node already in the graph) — either direction.
interface Pairing {
  direction: 'intoNew' | 'fromNew';
  newKey: string; newLabel: string;
  existingKey: string; existingLabel: string;
  exact: boolean;
}
function pairingsFor(newDef: NodeDefinition, existing: GraphNode): Pairing[] {
  const existingDef = getNodeDefinitionFor(existing);
  if (!existingDef) return [];
  const out: Pairing[] = [];
  for (const [newInKey, newIn] of Object.entries(newDef.inputs)) {
    for (const [exOutKey, exOut] of Object.entries(existingDef.outputs)) {
      if (!typesCompatible(exOut.type, newIn.type)) continue;
      out.push({ direction: 'intoNew', newKey: newInKey, newLabel: newIn.label, existingKey: exOutKey, existingLabel: exOut.label, exact: exOut.type === newIn.type });
    }
  }
  for (const [newOutKey, newOut] of Object.entries(newDef.outputs)) {
    for (const [exInKey, exIn] of Object.entries(existingDef.inputs)) {
      if (!typesCompatible(newOut.type, exIn.type)) continue;
      out.push({ direction: 'fromNew', newKey: newOutKey, newLabel: newOut.label, existingKey: exInKey, existingLabel: exIn.label, exact: newOut.type === exIn.type });
    }
  }
  return out;
}

export function MobileNodeBrowser({ onClose }: { onClose: () => void }) {
  const tc = useCtp();
  const userNodesVersion = useUserNodesVersion();
  // Scene Pos / Scene Output… only inside the group they belong to (nodes/addScope.ts).
  const hidden = useHiddenHere(HIDDEN_TYPES);
  const CATEGORIES = useMemo(() => buildCategories(userNodesVersion, hidden), [userNodesVersion, hidden]);
  const mode = useThemeMode();
  const pairHeadStyle: React.CSSProperties = { fontSize: 10.5, fontWeight: 700, color: tc.overlay0, letterSpacing: '0.08em', margin: '4px 0 6px' };
  const promotedStyle: React.CSSProperties = { font: `500 11px ${fontFamily.ui}`, color: '#a8720a', background: 'rgba(217,154,30,0.14)', borderRadius: 6, padding: '2px 7px' };
  const [openCategory, setOpenCategory] = useState<string | null>(null);
  // Search: the nodes offered here (hidden ones stay hidden), best match first.
  const [query, setQuery] = useState('');
  const matches = useMemo(() => {
    const q = query.trim();
    if (!q) return null;
    const defs = CATEGORIES.flatMap(sec => sec.rows.flatMap(r => r.groups.flatMap(g => g.types)))
      .map(t => getNodeDefinition(t)).filter((d): d is NodeDefinition => !!d);
    return rankMatches(defs, q).slice(0, 40).map(m => m.def);
  }, [query, CATEGORIES]);
  const [selectedType, setSelectedType] = useState<string | null>(null);
  // "Add Connected" sub-flow: pick an existing node, then pick one of its
  // compatible socket pairings with selectedType. Reset whenever the detail
  // page's own selectedType changes (see setSelectedType wrapper below).
  const [connectTargetId, setConnectTargetId] = useState<string | null>(null);

  const addNode = useNodeGraphStore(s => s.addNode);
  const connectNodes = useNodeGraphStore(s => s.connectNodes);
  const allNodes = useNodeGraphStore(s => s.nodes);
  const activeGroupPath = useNodeGraphStore(s => s.activeGroupPath);
  const scopedNodes = activeGroupPath.length > 0 ? (getActiveNodes(allNodes, activeGroupPath) ?? allNodes) : allNodes;

  const openDetail = (type: string) => { setConnectTargetId(null); setSelectedType(type); };
  const closeDetail = () => { setConnectTargetId(null); setSelectedType(null); };

  // ── Node detail page ───────────────────────────────────────────────────
  if (selectedType) {
    const def = getNodeDefinition(selectedType);
    if (!def) return null;

    const previewNode: GraphNode = {
      id: '__browse_preview__', type: selectedType, position: { x: 0, y: 0 },
      inputs: { ...def.inputs }, outputs: { ...def.outputs }, params: { ...(def.defaultParams ?? {}) },
    };

    const place = (pairing?: Pairing) => {
      // Fixed spawn spot, not NodeSearchPalette's randomized one — that
      // exists to keep several quick FAB-adds from stacking exactly on top
      // of each other, not a concern for this one-at-a-time browse flow.
      let spawnPos = { x: 300, y: 200 };
      if (!pairing) {
        // Disconnected: (300, 200) tends to land right in the middle of the
        // existing wired chain (same row, between two connected nodes),
        // which visually reads as connected even though it isn't. Land it
        // in the same column as — and below — the graph's other unwired
        // nodes (UV, Time, ...) instead, clearly outside the wired flow.
        const unwired = scopedNodes.filter(n => !Object.values(n.inputs).some(inp => inp?.connection != null));
        const basis = unwired.length > 0 ? unwired : scopedNodes;
        if (basis.length > 0) {
          spawnPos = {
            x: Math.min(...basis.map(n => n.position.x)),
            y: Math.max(...basis.map(n => n.position.y)) + 160,
          };
        }
      }
      const id = addNode(selectedType, spawnPos);
      if (id && pairing && connectTargetId) {
        if (pairing.direction === 'intoNew') connectNodes(connectTargetId, pairing.existingKey, id, pairing.newKey);
        else connectNodes(id, pairing.newKey, connectTargetId, pairing.existingKey);
      }
      onClose();
    };

    // ── Step 2: pick which pairing to wire, for the already-picked target ──
    if (connectTargetId) {
      const target = scopedNodes.find(n => n.id === connectTargetId);
      if (!target) { setConnectTargetId(null); return null; }
      const pairings = pairingsFor(def, target);
      const into = pairings.filter(p => p.direction === 'intoNew');
      const from = pairings.filter(p => p.direction === 'fromNew');
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <button onClick={() => setConnectTargetId(null)} style={backBtnStyleFor(tc)}><Icon name="chevL" size={14} />Back to node list</button>
          <div style={{ fontSize: '13px', color: tc.subtext0 }}>
            Wire <span style={{ color: tc.text, fontWeight: 700 }}>{def.label}</span> to <span style={{ color: tc.text, fontWeight: 700 }}>{labelFor(target)}</span>
          </div>
          {into.length > 0 && (
            <div>
              <div style={pairHeadStyle}>INTO THE NEW NODE</div>
              <div style={{ background: tc.base, borderRadius: 14, boxShadow: `0 0 0 1px ${tc.surface1}`, overflow: 'hidden' }}>
                {into.map((p, i) => (
                  <button key={i} onClick={() => place(p)} style={{ ...rowBtnStyleFor(tc), height: 'auto', minHeight: 50, font: `500 12.5px ${fontFamily.mono}`, borderBottom: i === into.length - 1 ? 'none' : `1px solid ${tc.surface0}` }}>
                    <span style={{ flex: 1 }}>{labelFor(target)}.{p.existingLabel} → {def.label}.{p.newLabel}</span>
                    {!p.exact && <span style={promotedStyle}>promoted</span>}
                  </button>
                ))}
              </div>
            </div>
          )}
          {from.length > 0 && (
            <div>
              <div style={pairHeadStyle}>FROM THE NEW NODE</div>
              <div style={{ background: tc.base, borderRadius: 14, boxShadow: `0 0 0 1px ${tc.surface1}`, overflow: 'hidden' }}>
                {from.map((p, i) => (
                  <button key={i} onClick={() => place(p)} style={{ ...rowBtnStyleFor(tc), height: 'auto', minHeight: 50, font: `500 12.5px ${fontFamily.mono}`, borderBottom: i === from.length - 1 ? 'none' : `1px solid ${tc.surface0}` }}>
                    <span style={{ flex: 1 }}>{def.label}.{p.newLabel} → {labelFor(target)}.{p.existingLabel}</span>
                    {!p.exact && <span style={promotedStyle}>promoted</span>}
                  </button>
                ))}
              </div>
            </div>
          )}
          {pairings.length === 0 && (
            <div style={{ fontSize: '11px', color: tc.surface2 }}>No compatible sockets between these two after all.</div>
          )}
        </div>
      );
    }

    // ── Step 1: pick which existing node to connect to ──────────────────
    if (connectTargetId === '') {
      const candidates = scopedNodes.filter(n => pairingsFor(def, n).length > 0);
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <button onClick={() => setConnectTargetId(null)} style={backBtnStyleFor(tc)}><Icon name="chevL" size={14} />Back</button>
          <div style={{ fontSize: '13px', color: tc.subtext0 }}>
            Connect <span style={{ color: tc.text, fontWeight: 700 }}>{def.label}</span> to which node?
          </div>
          {candidates.length === 0 ? (
            <div style={{ fontSize: '11px', color: tc.surface2 }}>Nothing in the current graph has a compatible input or output.</div>
          ) : (
            <div style={{ background: tc.base, borderRadius: 14, boxShadow: `0 0 0 1px ${tc.surface1}`, overflow: 'hidden' }}>
              {candidates.map((n, i) => (
                <button key={n.id} onClick={() => setConnectTargetId(n.id)} style={{ ...rowBtnStyleFor(tc), borderBottom: i === candidates.length - 1 ? 'none' : `1px solid ${tc.surface0}` }}>
                  <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{labelFor(n)}</span>
                  <span style={{ fontSize: '11px', color: tc.surface1, flexShrink: 0 }}>›</span>
                </button>
              ))}
            </div>
          )}
        </div>
      );
    }

    // ── Detail page itself ────────────────────────────────────────────
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <button onClick={closeDetail} style={backBtnStyleFor(tc)}><Icon name="chevL" size={14} />{query.trim() ? 'Back to results' : 'Back to categories'}</button>

        <div>
          <div style={{ font: `650 22px ${fontFamily.ui}`, letterSpacing: '-0.01em', color: tc.text }}>{def.label}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4, fontSize: 10.5, fontWeight: 700, color: tc.overlay0, letterSpacing: '0.08em' }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: categoryColor(def.category, mode) }} />
            {rowLabel(rowOfType(def.type, def.category)).toUpperCase()}{def.subcategory ? ` · ${def.subcategory.toUpperCase()}` : ''}
          </div>
        </div>

        {!SKIP_INLINE_PREVIEW.has(selectedType) && (
          INLINE_VIZ_TYPES.has(selectedType)
            ? <InlineVizFrame node={previewNode} />
            : <GenericPreviewViz node={previewNode} nodes={[previewNode]} />
        )}

        {def.description && (
          <div style={{ fontSize: 13, color: tc.subtext0, lineHeight: 1.5 }}>{def.description}</div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '4px' }}>
          <button
            onClick={() => setConnectTargetId('')}
            style={{
              height: 46, borderRadius: 12, border: 'none', background: tc.text, color: tc.base,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
              font: `600 14px ${fontFamily.ui}`, cursor: 'pointer', touchAction: 'manipulation',
            }}
          ><Icon name="plus" size={15} />Add connected…</button>
          <button
            onClick={() => place()}
            style={{
              height: 46, borderRadius: 12, border: 'none', background: tc.base, boxShadow: `0 0 0 1px ${tc.surface1}`,
              color: tc.text, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
              font: `500 14px ${fontFamily.ui}`, cursor: 'pointer', touchAction: 'manipulation',
            }}
          ><Icon name="plus" size={15} />Add disconnected</button>
        </div>
      </div>
    );
  }

  // ── Category accordion ─────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <label data-browse-search="" style={{
        display: 'flex', alignItems: 'center', gap: 8, height: 44, padding: '0 12px', marginBottom: 6, borderRadius: 12,
        background: tc.mantle, boxShadow: `0 0 0 1px ${tc.surface0}`, color: tc.overlay0,
      }}>
        <Icon name="search" size={16} />
        <input
          type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search nodes"
          aria-label="Search nodes" autoCapitalize="off" autoCorrect="off" spellCheck={false} enterKeyHint="search"
          style={{ flex: 1, minWidth: 0, border: 'none', outline: 'none', background: 'transparent', color: tc.text, font: `500 16px ${fontFamily.ui}` }}
        />
        {query && (
          <button type="button" aria-label="Clear search" onClick={() => setQuery('')}
            style={{ border: 'none', background: 'none', padding: 4, color: tc.overlay0, cursor: 'pointer', display: 'flex' }}>
            <Icon name="close" size={14} />
          </button>
        )}
      </label>
      {matches ? (
        matches.length === 0
          ? <div style={{ fontSize: 13, color: tc.overlay0, padding: '12px' }}>No nodes match “{query.trim()}”.</div>
          : matches.map(d => (
            <button key={d.type} data-browse-result={d.type} onClick={() => openDetail(d.type)} style={{ ...rowBtnStyleFor(tc), height: 'auto', minHeight: 46, padding: '6px 12px', borderRadius: 10, gap: 10 }}>
              <span style={{ width: 9, height: 9, borderRadius: '50%', background: categoryColor(d.category, mode), flexShrink: 0 }} />
              <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.label}</span>
                <span style={{ fontSize: 11.5, fontWeight: 500, color: tc.overlay0 }}>{rowLabel(rowOfType(d.type, d.category))}</span>
              </span>
              <Icon name="chevR" size={14} style={{ color: tc.surface2, flexShrink: 0 }} />
            </button>
          ))
      ) : <>
      {/* The builders: the 3D Scene Builder, Grid Rules, Agent Rules (docs/node-browser.md) */}
      <BuildersSection touch onOpened={onClose} />
      {CATEGORIES.map(sec => (
        <div key={sec.label} data-browse-section={sec.label}>
          <div style={{ fontSize: 10.5, fontWeight: 700, color: tc.overlay0, letterSpacing: '0.08em', padding: '12px 12px 4px' }}>{sec.label.toUpperCase()}</div>
          {sec.rows.map(cat => {
            const isOpen = openCategory === cat.row;
            const flat = cat.groups.length === 1 && cat.groups[0].label === null;
            const total = cat.groups.reduce((n, g) => n + g.types.length, 0);
            return (
              <div key={cat.row}>
                <button
                  aria-expanded={isOpen}
                  data-browse-row={cat.row}
                  onClick={() => setOpenCategory(o => (o === cat.row ? null : cat.row))}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10, width: '100%', height: 46, padding: '0 12px', border: 'none',
                    borderRadius: 12, background: isOpen ? tc.mantle : 'none', cursor: 'pointer', touchAction: 'manipulation', textAlign: 'left',
                    color: tc.text, font: `600 13.5px ${fontFamily.ui}`,
                  }}
                >
                  <Icon name={isOpen ? 'chevD' : 'chevR'} size={14} style={{ color: tc.overlay0 }} />
                  <span style={{ width: 9, height: 9, borderRadius: '50%', background: categoryColor(cat.row, mode) }} />
                  <span style={{ flex: 1 }}>{cat.label}</span>
                  <span style={{ fontSize: 12, fontWeight: 500, color: tc.overlay0, background: tc.surface0, borderRadius: 7, padding: '2px 7px' }}>{total}</span>
                </button>
                {isOpen && cat.groups.map(group => (
                  <div key={group.label ?? '__none__'}>
                    {!flat && group.label && (
                      <div style={{ fontSize: 10.5, fontWeight: 700, color: tc.overlay0, letterSpacing: '0.08em', padding: '8px 12px 2px 43px' }}>
                        {group.label.toUpperCase()}
                      </div>
                    )}
                    {group.types.map(type => {
                      const d = getNodeDefinition(type);
                      if (!d) return null;
                      return (
                        <button key={type} onClick={() => openDetail(type)} style={{ ...rowBtnStyleFor(tc), height: 40, padding: '0 12px 0 43px', borderRadius: 10 }}>
                          <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.label}</span>
                          <Icon name="chevR" size={14} style={{ color: tc.surface2, flexShrink: 0 }} />
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      ))}
      </>}
    </div>
  );
}
