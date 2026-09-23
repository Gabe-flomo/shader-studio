/**
 * MobileNodeBrowser — the "Nodes" tab inside the mobile Examples sheet.
 *
 * Deliberately NOT another search-and-place picker (that's NodeSearchPalette,
 * reachable everywhere else in the app) — this is an exploratory reference:
 * browse by category, open a node to read its description and see a live
 * preview, then decide whether to add it. Placing from here is the same
 * addNode()/connectNodes() every other flow uses; the only new behavior is
 * offering to auto-wire the new node's first input to the best existing
 * match, same "best candidate" logic the Wiring section's own ghost hints
 * use, so a purely exploratory add can still land pre-wired when there's an
 * obvious match instead of always starting disconnected.
 */
import { useState } from 'react';
import { NODE_REGISTRY, getNodeDefinition } from '../../nodes/definitions';
import type { GraphNode } from '../../types/nodeGraph';
import { useNodeGraphStore, getActiveNodes } from '../../store/useNodeGraphStore';
import { typesCompatible } from '../../lib/typesCompatible';
import { CATEGORY_COLORS, HIDDEN_TYPES } from './nodeCategoryMeta';
import { InlineVizFrame, GenericPreviewViz, SKIP_INLINE_PREVIEW } from './MobileGraphBrowser';
import { INLINE_VIZ_TYPES } from './NodeInlineViz';

function labelFor(n: GraphNode): string {
  return (typeof n.params.label === 'string' && n.params.label) || getNodeDefinition(n.type)?.label || n.type;
}

// Built once at module load — the registry doesn't change at runtime.
const CATEGORIES: Array<{ name: string; types: string[] }> = (() => {
  const map = new Map<string, string[]>();
  for (const [type, def] of Object.entries(NODE_REGISTRY)) {
    if (HIDDEN_TYPES.has(type)) continue;
    const arr = map.get(def.category) ?? [];
    arr.push(type);
    map.set(def.category, arr);
  }
  return Array.from(map.entries())
    .map(([name, types]) => ({
      name,
      types: types.sort((a, b) => (getNodeDefinition(a)?.label ?? a).localeCompare(getNodeDefinition(b)?.label ?? b)),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
})();

const rowBtnStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: '8px', width: '100%',
  background: 'none', border: 'none', padding: '8px 4px', textAlign: 'left',
  fontSize: '13px', color: '#cdd6f4', cursor: 'pointer', touchAction: 'manipulation',
};

export function MobileNodeBrowser({ onClose }: { onClose: () => void }) {
  const [openCategory, setOpenCategory] = useState<string | null>(null);
  const [selectedType, setSelectedType] = useState<string | null>(null);

  const addNode = useNodeGraphStore(s => s.addNode);
  const connectNodes = useNodeGraphStore(s => s.connectNodes);
  const allNodes = useNodeGraphStore(s => s.nodes);
  const activeGroupPath = useNodeGraphStore(s => s.activeGroupPath);
  const scopedNodes = activeGroupPath.length > 0 ? (getActiveNodes(allNodes, activeGroupPath) ?? allNodes) : allNodes;

  // ── Node detail page ───────────────────────────────────────────────────
  if (selectedType) {
    const def = getNodeDefinition(selectedType);
    if (!def) return null;

    const previewNode: GraphNode = {
      id: '__browse_preview__', type: selectedType, position: { x: 0, y: 0 },
      inputs: { ...def.inputs }, outputs: { ...def.outputs }, params: { ...(def.defaultParams ?? {}) },
    };

    // Best existing match for this type's FIRST declared input — same
    // exact-match-preferred, promotion-allowed rule bestConnectCandidate
    // uses for the Wiring section's ghost hints, just scanning this node
    // type's static definition instead of a live node's sockets since
    // nothing has been placed yet.
    const firstInputEntry = Object.entries(def.inputs)[0] as [string, { type: string }] | undefined;
    let candidate: { node: GraphNode; outKey: string; exact: boolean } | undefined;
    if (firstInputEntry) {
      const [, inputSocket] = firstInputEntry;
      for (const n of scopedNodes) {
        for (const [outKey, outSock] of Object.entries(n.outputs)) {
          if (!typesCompatible(outSock.type, inputSocket.type)) continue;
          const exact = outSock.type === inputSocket.type;
          if (!candidate || (exact && !candidate.exact)) candidate = { node: n, outKey, exact };
        }
      }
    }

    const place = (autoWire: boolean) => {
      // Fixed spawn spot rather than NodeSearchPalette's randomized one —
      // that randomization exists to avoid several quick FAB-adds stacking
      // exactly on top of each other, not a concern for this one-at-a-time
      // browse-then-add flow, and a plain literal here (vs. a impure
      // Math.random() call inside the component body) keeps this an
      // ordinary event handler with nothing render-purity rules flag.
      const id = addNode(selectedType, { x: 300, y: 200 });
      if (id && autoWire && candidate && firstInputEntry) {
        connectNodes(candidate.node.id, candidate.outKey, id, firstInputEntry[0]);
      }
      onClose();
    };

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <button
          onClick={() => setSelectedType(null)}
          style={{ alignSelf: 'flex-start', background: 'none', border: 'none', color: '#89b4fa', fontSize: '12px', cursor: 'pointer', padding: '2px 0', touchAction: 'manipulation' }}
        >‹ Back to categories</button>

        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: CATEGORY_COLORS[def.category] ?? '#888', flexShrink: 0 }} />
            <span style={{ fontSize: '16px', fontWeight: 700, color: '#cdd6f4' }}>{def.label}</span>
          </div>
          <div style={{ fontSize: '10px', color: '#6c7086', letterSpacing: '0.05em', marginTop: '2px', marginLeft: '18px' }}>
            {def.category.toUpperCase()}
          </div>
        </div>

        {!SKIP_INLINE_PREVIEW.has(selectedType) && (
          INLINE_VIZ_TYPES.has(selectedType)
            ? <InlineVizFrame node={previewNode} />
            : <GenericPreviewViz node={previewNode} nodes={[previewNode]} />
        )}

        {def.description && (
          <div style={{ fontSize: '12px', color: '#a6adc8', lineHeight: 1.5 }}>{def.description}</div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '4px' }}>
          {candidate && (
            <button
              onClick={() => place(true)}
              style={{
                padding: '10px', borderRadius: '8px', border: '1px solid #89b4fa66', background: '#89b4fa18',
                color: '#89b4fa', fontSize: '13px', fontWeight: 600, cursor: 'pointer', touchAction: 'manipulation',
              }}
            >+ Add &amp; Connect to {labelFor(candidate.node)}</button>
          )}
          <button
            onClick={() => place(false)}
            style={{
              padding: '10px', borderRadius: '8px', border: '1px solid #45475a', background: 'none',
              color: '#cdd6f4', fontSize: '13px', fontWeight: 600, cursor: 'pointer', touchAction: 'manipulation',
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
              <span style={{ fontSize: '10px', color: '#585b70' }}>({cat.types.length})</span>
            </button>
            {isOpen && (
              <div style={{ background: '#1e1e2e', border: '1px solid #313244', borderRadius: '8px', overflow: 'hidden' }}>
                {cat.types.map((type, i) => {
                  const d = getNodeDefinition(type)!;
                  return (
                    <button
                      key={type}
                      onClick={() => setSelectedType(type)}
                      style={{ ...rowBtnStyle, borderBottom: i === cat.types.length - 1 ? 'none' : '1px solid #24243a' }}
                    >
                      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.label}</span>
                      <span style={{ fontSize: '11px', color: '#45475a', flexShrink: 0 }}>›</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
