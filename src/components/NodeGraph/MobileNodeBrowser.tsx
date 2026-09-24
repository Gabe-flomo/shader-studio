/**
 * MobileNodeBrowser — the "Nodes" tab inside the mobile Examples sheet.
 *
 * Deliberately NOT another search-and-place picker (that's NodeSearchPalette,
 * reachable everywhere else in the app) — this is an exploratory reference:
 * browse by category (and subcategory, for the handful of categories large
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
import { useState } from 'react';
import { NODE_REGISTRY, getNodeDefinition } from '../../nodes/definitions';
import type { GraphNode, NodeDefinition } from '../../types/nodeGraph';
import { useNodeGraphStore, getActiveNodes } from '../../store/useNodeGraphStore';
import { typesCompatible } from '../../lib/typesCompatible';
import { CATEGORY_COLORS, HIDDEN_TYPES } from './nodeCategoryMeta';
import { InlineVizFrame, GenericPreviewViz, SKIP_INLINE_PREVIEW } from './MobileGraphBrowser';
import { INLINE_VIZ_TYPES } from './NodeInlineViz';
import { ctp } from '../../theme/palette';

function labelFor(n: GraphNode): string {
  return (typeof n.params.label === 'string' && n.params.label) || getNodeDefinition(n.type)?.label || n.type;
}

// Built once at module load — the registry doesn't change at runtime.
// Types with no subcategory land in a single unnamed group per category;
// most categories are small enough that this is the only group they get.
interface SubGroup { name: string | null; types: string[] }
interface CategoryGroup { name: string; subgroups: SubGroup[] }

const CATEGORIES: CategoryGroup[] = (() => {
  const catMap = new Map<string, Map<string | null, string[]>>();
  for (const [type, def] of Object.entries(NODE_REGISTRY)) {
    if (HIDDEN_TYPES.has(type) || def.deprecated) continue; // deprecated: loadable, not offered
    if (!catMap.has(def.category)) catMap.set(def.category, new Map());
    const subMap = catMap.get(def.category)!;
    const sub = def.subcategory ?? null;
    const arr = subMap.get(sub) ?? [];
    arr.push(type);
    subMap.set(sub, arr);
  }
  const byLabel = (a: string, b: string) => (getNodeDefinition(a)?.label ?? a).localeCompare(getNodeDefinition(b)?.label ?? b);
  return Array.from(catMap.entries())
    .map(([name, subMap]) => ({
      name,
      subgroups: Array.from(subMap.entries())
        .map(([subName, types]) => ({ name: subName, types: types.sort(byLabel) }))
        .sort((a, b) => {
          if (a.name === null) return b.name === null ? 0 : 1;   // unnamed group last
          if (b.name === null) return -1;
          return a.name.localeCompare(b.name);
        }),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
})();

const rowBtnStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: '8px', width: '100%',
  background: 'none', border: 'none', padding: '8px 4px', textAlign: 'left',
  fontSize: '13px', color: ctp.text, cursor: 'pointer', touchAction: 'manipulation',
};
const backBtnStyle: React.CSSProperties = {
  alignSelf: 'flex-start', background: 'none', border: 'none', color: ctp.blue,
  fontSize: '12px', cursor: 'pointer', padding: '2px 0', touchAction: 'manipulation',
};

// One type-compatible way to wire `newType` (not yet placed) to `existing`
// (a real node already in the graph) — either direction.
interface Pairing {
  direction: 'intoNew' | 'fromNew';
  newKey: string; newLabel: string;
  existingKey: string; existingLabel: string;
  exact: boolean;
}
function pairingsFor(newDef: NodeDefinition, existing: GraphNode): Pairing[] {
  const existingDef = getNodeDefinition(existing.type);
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
  const [openCategory, setOpenCategory] = useState<string | null>(null);
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
          <button onClick={() => setConnectTargetId(null)} style={backBtnStyle}>‹ Back to node list</button>
          <div style={{ fontSize: '13px', color: ctp.subtext0 }}>
            Wire <span style={{ color: ctp.text, fontWeight: 700 }}>{def.label}</span> to <span style={{ color: ctp.text, fontWeight: 700 }}>{labelFor(target)}</span>
          </div>
          {into.length > 0 && (
            <div>
              <div style={{ fontSize: '10px', fontWeight: 700, color: ctp.surface2, letterSpacing: '0.05em', marginBottom: '4px' }}>INTO THE NEW NODE</div>
              <div style={{ background: ctp.base, border: `1px solid ${ctp.surface0}`, borderRadius: '8px', overflow: 'hidden' }}>
                {into.map((p, i) => (
                  <button key={i} onClick={() => place(p)} style={{ ...rowBtnStyle, borderBottom: i === into.length - 1 ? 'none' : '1px solid #24243a' }}>
                    <span style={{ flex: 1 }}>{labelFor(target)}.{p.existingLabel} → {def.label}.{p.newLabel}</span>
                    {!p.exact && <span style={{ fontSize: '9px', color: ctp.surface2 }}>promoted</span>}
                  </button>
                ))}
              </div>
            </div>
          )}
          {from.length > 0 && (
            <div>
              <div style={{ fontSize: '10px', fontWeight: 700, color: ctp.surface2, letterSpacing: '0.05em', marginBottom: '4px' }}>FROM THE NEW NODE</div>
              <div style={{ background: ctp.base, border: `1px solid ${ctp.surface0}`, borderRadius: '8px', overflow: 'hidden' }}>
                {from.map((p, i) => (
                  <button key={i} onClick={() => place(p)} style={{ ...rowBtnStyle, borderBottom: i === from.length - 1 ? 'none' : '1px solid #24243a' }}>
                    <span style={{ flex: 1 }}>{def.label}.{p.newLabel} → {labelFor(target)}.{p.existingLabel}</span>
                    {!p.exact && <span style={{ fontSize: '9px', color: ctp.surface2 }}>promoted</span>}
                  </button>
                ))}
              </div>
            </div>
          )}
          {pairings.length === 0 && (
            <div style={{ fontSize: '11px', color: ctp.surface2 }}>No compatible sockets between these two after all.</div>
          )}
        </div>
      );
    }

    // ── Step 1: pick which existing node to connect to ──────────────────
    if (connectTargetId === '') {
      const candidates = scopedNodes.filter(n => pairingsFor(def, n).length > 0);
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <button onClick={() => setConnectTargetId(null)} style={backBtnStyle}>‹ Back</button>
          <div style={{ fontSize: '13px', color: ctp.subtext0 }}>
            Connect <span style={{ color: ctp.text, fontWeight: 700 }}>{def.label}</span> to which node?
          </div>
          {candidates.length === 0 ? (
            <div style={{ fontSize: '11px', color: ctp.surface2 }}>Nothing in the current graph has a compatible input or output.</div>
          ) : (
            <div style={{ background: ctp.base, border: `1px solid ${ctp.surface0}`, borderRadius: '8px', overflow: 'hidden' }}>
              {candidates.map((n, i) => (
                <button key={n.id} onClick={() => setConnectTargetId(n.id)} style={{ ...rowBtnStyle, borderBottom: i === candidates.length - 1 ? 'none' : '1px solid #24243a' }}>
                  <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{labelFor(n)}</span>
                  <span style={{ fontSize: '11px', color: ctp.surface1, flexShrink: 0 }}>›</span>
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
        <button onClick={closeDetail} style={backBtnStyle}>‹ Back to categories</button>

        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: CATEGORY_COLORS[def.category] ?? '#888', flexShrink: 0 }} />
            <span style={{ fontSize: '16px', fontWeight: 700, color: ctp.text }}>{def.label}</span>
          </div>
          <div style={{ fontSize: '10px', color: ctp.overlay0, letterSpacing: '0.05em', marginTop: '2px', marginLeft: '18px' }}>
            {def.category.toUpperCase()}{def.subcategory ? ` · ${def.subcategory}` : ''}
          </div>
        </div>

        {!SKIP_INLINE_PREVIEW.has(selectedType) && (
          INLINE_VIZ_TYPES.has(selectedType)
            ? <InlineVizFrame node={previewNode} />
            : <GenericPreviewViz node={previewNode} nodes={[previewNode]} />
        )}

        {def.description && (
          <div style={{ fontSize: '12px', color: ctp.subtext0, lineHeight: 1.5 }}>{def.description}</div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '4px' }}>
          <button
            onClick={() => setConnectTargetId('')}
            style={{
              padding: '10px', borderRadius: '8px', border: `1px solid ${ctp.blue}66`, background: `${ctp.blue}18`,
              color: ctp.blue, fontSize: '13px', fontWeight: 600, cursor: 'pointer', touchAction: 'manipulation',
            }}
          >+ Add Connected…</button>
          <button
            onClick={() => place()}
            style={{
              padding: '10px', borderRadius: '8px', border: `1px solid ${ctp.surface1}`, background: 'none',
              color: ctp.text, fontSize: '13px', fontWeight: 600, cursor: 'pointer', touchAction: 'manipulation',
            }}
          >+ Add Disconnected</button>
        </div>
      </div>
    );
  }

  // ── Category accordion ─────────────────────────────────────────────────
  return (
    <div>
      {CATEGORIES.map(cat => {
        const isOpen = openCategory === cat.name;
        const flat = cat.subgroups.length === 1 && cat.subgroups[0].name === null;
        const total = cat.subgroups.reduce((n, g) => n + g.types.length, 0);
        return (
          <div key={cat.name} style={{ marginBottom: '10px' }}>
            <button
              onClick={() => setOpenCategory(o => (o === cat.name ? null : cat.name))}
              style={{
                display: 'flex', alignItems: 'center', gap: '6px', width: '100%',
                background: 'none', border: 'none', padding: 0, marginBottom: isOpen ? '6px' : 0,
                cursor: 'pointer', touchAction: 'manipulation',
              }}
            >
              <span style={{ fontSize: '9px', color: CATEGORY_COLORS[cat.name] ?? '#888' }}>{isOpen ? '▾' : '▸'}</span>
              <span style={{ fontSize: '10px', fontWeight: 700, color: CATEGORY_COLORS[cat.name] ?? '#888', letterSpacing: '0.05em' }}>
                {cat.name.toUpperCase()}
              </span>
              <span style={{ fontSize: '10px', color: ctp.surface2 }}>({total})</span>
            </button>
            {isOpen && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {cat.subgroups.map(group => (
                  <div key={group.name ?? '__none__'}>
                    {!flat && group.name && (
                      <div style={{ fontSize: '10px', fontWeight: 700, color: '#7d8296', letterSpacing: '0.04em', margin: '0 0 4px 2px' }}>
                        {group.name.toUpperCase()}
                      </div>
                    )}
                    <div style={{ background: ctp.base, border: `1px solid ${ctp.surface0}`, borderRadius: '8px', overflow: 'hidden' }}>
                      {group.types.map((type, i) => {
                        const d = getNodeDefinition(type)!;
                        return (
                          <button
                            key={type}
                            onClick={() => openDetail(type)}
                            style={{ ...rowBtnStyle, borderBottom: i === group.types.length - 1 ? 'none' : '1px solid #24243a' }}
                          >
                            <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.label}</span>
                            <span style={{ fontSize: '11px', color: ctp.surface1, flexShrink: 0 }}>›</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
