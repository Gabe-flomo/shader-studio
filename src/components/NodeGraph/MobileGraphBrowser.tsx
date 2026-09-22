/**
 * MobileGraphBrowser — touch-first alternative to the spatial node-graph
 * canvas. Instead of panning/zooming/dragging connections, you drill into
 * one node at a time: Home shows the graph's Source nodes (no inputs, e.g.
 * UV) and the Output node; tapping a node focuses it and lists its inputs
 * and outputs as rows. Tapping a connected row drills into whatever it's
 * wired to; tapping an unconnected input (or "+ add consumer" on an output)
 * lets you either add a brand-new node or wire up an existing one already
 * in the graph — never by dragging, always by picking from a list.
 */

import { useMemo, useState } from 'react';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { getNodeDefinition } from '../../nodes/definitions';
import type { GraphNode } from '../../types/nodeGraph';
import { TYPE_COLORS } from './typeColors';
import { NodeSearchPalette } from './NodeSearchPalette';
import { typesCompatible } from '../../lib/typesCompatible';
import { groupNodesByRank } from '../../store/graphLayout';

function nodeDotColor(n: GraphNode): string {
  if (n.type === 'output') return '#a6e3a1';
  const outType = Object.values(n.outputs)[0]?.type;
  return TYPE_COLORS[outType ?? 'float'] ?? '#888';
}

// ── Cycle safety ──────────────────────────────────────────────────────────────
// Adding a connection sourceId.output -> targetId.input is only valid if
// sourceId isn't already downstream of targetId (i.e. targetId doesn't
// already, directly or indirectly, feed into sourceId) — otherwise the new
// edge closes a loop.
function wouldCreateCycle(nodes: GraphNode[], sourceId: string, targetId: string): boolean {
  if (sourceId === targetId) return true;
  const visited = new Set<string>();
  const stack = [targetId];
  while (stack.length) {
    const cur = stack.pop()!;
    if (cur === sourceId) return true;
    if (visited.has(cur)) continue;
    visited.add(cur);
    for (const n of nodes) {
      for (const inp of Object.values(n.inputs)) {
        if (inp.connection?.nodeId === cur) stack.push(n.id);
      }
    }
  }
  return false;
}

// `sourceType` finds a compatible INPUT on `node` — node.inputs are the sink,
// so the wire runs sourceType -> inp.type.
function firstCompatibleInputKey(node: GraphNode, sourceType: string): string | undefined {
  return Object.entries(node.inputs).find(([, inp]) => typesCompatible(sourceType, inp.type))?.[0];
}
// `targetType` finds a compatible OUTPUT on `node` — node.outputs are the
// source, so the wire runs out.type -> targetType.
function firstCompatibleOutputKey(node: GraphNode, targetType: string): string | undefined {
  return Object.entries(node.outputs).find(([, out]) => typesCompatible(out.type, targetType))?.[0];
}

type PendingSocket =
  | { dir: 'input'; nodeId: string; key: string; type: string }
  | { dir: 'output'; nodeId: string; key: string; type: string };

const rowStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: '10px',
  padding: '10px 12px', borderBottom: '1px solid #313244',
};
const dotStyle = (color: string): React.CSSProperties => ({
  width: '10px', height: '10px', borderRadius: '50%', background: color, flexShrink: 0,
});
const chipStyle: React.CSSProperties = {
  background: '#313244', border: '1px solid #45475a', borderRadius: '999px',
  padding: '4px 10px', fontSize: '12px', color: '#cdd6f4', cursor: 'pointer', touchAction: 'manipulation',
};
const addBtnStyle: React.CSSProperties = {
  marginLeft: 'auto', background: '#313244', border: '1px solid #89b4fa66', color: '#89b4fa',
  borderRadius: '6px', padding: '6px 10px', fontSize: '12px', cursor: 'pointer', touchAction: 'manipulation',
};

export function MobileGraphBrowser() {
  const nodes = useNodeGraphStore(s => s.nodes);
  const connectNodes = useNodeGraphStore(s => s.connectNodes);
  const disconnectInput = useNodeGraphStore(s => s.disconnectInput);
  const removeNode = useNodeGraphStore(s => s.removeNode);

  const [focusStack, setFocusStack] = useState<string[]>([]);
  const [pending, setPending] = useState<PendingSocket | null>(null);
  const [connectPicker, setConnectPicker] = useState<PendingSocket | null>(null);

  const focusedId = focusStack[focusStack.length - 1];
  const focusedNode = focusedId ? nodes.find(n => n.id === focusedId) : undefined;

  // Same rank assignment the desktop "Auto Layout" button uses for spatial
  // x position — reused here as row index, so a node's row in this grid
  // always matches the column it would land in on the canvas.
  const rankedRows = useMemo(() => groupNodesByRank(nodes), [nodes]);

  const pushFocus = (id: string) => setFocusStack(stack => [...stack, id]);
  const jumpTo = (index: number) => setFocusStack(stack => stack.slice(0, index + 1));
  const goHome = () => setFocusStack([]);

  const downstreamConsumers = (nodeId: string, outputKey: string) =>
    nodes.filter(n => Object.values(n.inputs).some(inp => inp.connection?.nodeId === nodeId && inp.connection.outputKey === outputKey));

  const labelFor = (n: GraphNode) => getNodeDefinition(n.type)?.label ?? n.type;

  const handleNodePlacedForInput = (newId: string, socket: Extract<PendingSocket, { dir: 'input' }>) => {
    const newNode = useNodeGraphStore.getState().nodes.find(n => n.id === newId);
    if (!newNode) return;
    const outKey = firstCompatibleOutputKey(newNode, socket.type);
    if (outKey) connectNodes(newId, outKey, socket.nodeId, socket.key);
    pushFocus(newId);
  };

  const handleNodePlacedForOutput = (newId: string, socket: Extract<PendingSocket, { dir: 'output' }>) => {
    const newNode = useNodeGraphStore.getState().nodes.find(n => n.id === newId);
    if (!newNode) return;
    const inKey = firstCompatibleInputKey(newNode, socket.type);
    if (inKey) connectNodes(socket.nodeId, socket.key, newId, inKey);
    pushFocus(newId);
  };

  // ── Connect-existing candidate list ──────────────────────────────────────
  const connectCandidates = useMemo(() => {
    if (!connectPicker) return [];
    if (connectPicker.dir === 'input') {
      // picking a node whose OUTPUT will feed this input
      return nodes.filter(n =>
        n.id !== connectPicker.nodeId &&
        Object.values(n.outputs).some(o => typesCompatible(o.type, connectPicker.type)) &&
        !wouldCreateCycle(nodes, n.id, connectPicker.nodeId),
      );
    }
    // picking a node whose INPUT will consume this output
    return nodes.filter(n =>
      n.id !== connectPicker.nodeId &&
      Object.values(n.inputs).some(i => typesCompatible(connectPicker.type, i.type)) &&
      !wouldCreateCycle(nodes, connectPicker.nodeId, n.id),
    );
  }, [connectPicker, nodes]);

  const commitConnectExisting = (otherId: string) => {
    if (!connectPicker) return;
    const other = nodes.find(n => n.id === otherId);
    if (!other) return;
    if (connectPicker.dir === 'input') {
      const outKey = firstCompatibleOutputKey(other, connectPicker.type);
      if (outKey) connectNodes(otherId, outKey, connectPicker.nodeId, connectPicker.key);
    } else {
      const inKey = firstCompatibleInputKey(other, connectPicker.type);
      if (inKey) connectNodes(connectPicker.nodeId, connectPicker.key, otherId, inKey);
    }
    setConnectPicker(null);
    pushFocus(otherId);
  };

  // ── Node detail (focused) view ───────────────────────────────────────────
  function renderNodeDetail(node: GraphNode) {
    const def = getNodeDefinition(node.type);
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
        <div style={{ padding: '12px', borderBottom: '1px solid #313244', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{ fontWeight: 700, fontSize: '15px', color: '#cdd6f4', flex: 1 }}>{labelFor(node)}</div>
          {node.type !== 'output' && focusStack.length > 0 && (
            <button
              onClick={() => { removeNode(node.id); setFocusStack(stack => stack.slice(0, -1)); }}
              style={{ background: 'none', border: '1px solid #f38ba866', color: '#f38ba8', borderRadius: '6px', padding: '4px 8px', fontSize: '11px', cursor: 'pointer', touchAction: 'manipulation' }}
            >
              Remove
            </button>
          )}
        </div>

        <div style={{ flex: 1, overflowY: 'auto' }}>
          {Object.keys(node.inputs).length > 0 && (
            <>
              <div style={{ padding: '8px 12px 4px', fontSize: '11px', fontWeight: 700, color: '#585b70', letterSpacing: '0.05em' }}>INPUTS</div>
              {Object.entries(node.inputs).map(([key, inp]) => {
                const upstream = inp.connection ? nodes.find(n => n.id === inp.connection!.nodeId) : undefined;
                return (
                  <div key={key} style={rowStyle}>
                    <div style={dotStyle(TYPE_COLORS[inp.type] ?? '#888')} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '13px', color: '#cdd6f4' }}>{inp.label}</div>
                      <div style={{ fontSize: '10px', color: '#585b70' }}>{inp.type}</div>
                    </div>
                    {upstream ? (
                      <>
                        <button style={chipStyle} onClick={() => pushFocus(upstream.id)}>{labelFor(upstream)} ›</button>
                        <button
                          onClick={() => disconnectInput(node.id, key)}
                          style={{ background: 'none', border: 'none', color: '#585b70', fontSize: '14px', cursor: 'pointer', padding: '4px', touchAction: 'manipulation' }}
                          title="Disconnect"
                        >✕</button>
                      </>
                    ) : (
                      <button style={addBtnStyle} onClick={() => setPending({ dir: 'input', nodeId: node.id, key, type: inp.type })}>+ Add</button>
                    )}
                  </div>
                );
              })}
            </>
          )}

          {Object.keys(node.outputs).length > 0 && (
            <>
              <div style={{ padding: '8px 12px 4px', fontSize: '11px', fontWeight: 700, color: '#585b70', letterSpacing: '0.05em' }}>OUTPUTS</div>
              {Object.entries(node.outputs).map(([key, out]) => {
                const consumers = downstreamConsumers(node.id, key);
                return (
                  <div key={key} style={{ ...rowStyle, flexWrap: 'wrap' }}>
                    <div style={dotStyle(TYPE_COLORS[out.type] ?? '#888')} />
                    <div style={{ flex: '1 1 auto', minWidth: 0 }}>
                      <div style={{ fontSize: '13px', color: '#cdd6f4' }}>{out.label}</div>
                      <div style={{ fontSize: '10px', color: '#585b70' }}>{out.type}</div>
                    </div>
                    <button style={addBtnStyle} onClick={() => setPending({ dir: 'output', nodeId: node.id, key, type: out.type })}>+ Add consumer</button>
                    {consumers.length > 0 && (
                      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', width: '100%', paddingLeft: '20px' }}>
                        {consumers.map(c => (
                          <button key={c.id} style={chipStyle} onClick={() => pushFocus(c.id)}>{labelFor(c)} ›</button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </>
          )}

          {def?.description && (
            <div style={{ padding: '12px', fontSize: '11px', color: '#585b70', lineHeight: 1.5 }}>{def.description}</div>
          )}
        </div>

        {/* Add New / Connect Existing action sheet */}
        {pending && pending.nodeId === node.id && (
          <div
            onClick={() => setPending(null)}
            style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 40, display: 'flex', alignItems: 'flex-end' }}
          >
            <div onClick={e => e.stopPropagation()} style={{ width: '100%', background: '#1e1e2e', borderRadius: '16px 16px 0 0', border: '1px solid #45475a', padding: '16px' }}>
              <div style={{ fontSize: '13px', fontWeight: 700, color: '#89b4fa', marginBottom: '12px' }}>
                {pending.dir === 'input' ? 'Feed this input' : 'Consume this output'}
              </div>
              <button
                style={{ width: '100%', padding: '12px', marginBottom: '8px', background: '#313244', border: '1px solid #45475a', borderRadius: '8px', color: '#cdd6f4', fontSize: '13px', cursor: 'pointer', touchAction: 'manipulation' }}
                onClick={() => { setConnectPicker(pending); setPending(null); }}
              >
                Connect Existing Node
              </button>
              <button
                style={{ width: '100%', padding: '12px', background: '#313244', border: '1px solid #45475a', borderRadius: '8px', color: '#cdd6f4', fontSize: '13px', cursor: 'pointer', touchAction: 'manipulation' }}
                onClick={() => {
                  const socket = pending;
                  setPending({ ...socket, key: `__search__${socket.key}` });
                }}
              >
                Add New Node
              </button>
            </div>
          </div>
        )}

        {/* NodeSearchPalette for "Add New Node" */}
        {pending && pending.nodeId === node.id && pending.key.startsWith('__search__') && (
          <NodeSearchPalette
            open
            onClose={() => setPending(null)}
            filterOutputType={pending.dir === 'input' ? pending.type : undefined}
            filterInputType={pending.dir === 'output' ? pending.type : undefined}
            onNodePlaced={(newId) => {
              const socket = { ...pending, key: pending.key.replace('__search__', '') } as PendingSocket;
              if (socket.dir === 'input') handleNodePlacedForInput(newId, socket as Extract<PendingSocket, { dir: 'input' }>);
              else handleNodePlacedForOutput(newId, socket as Extract<PendingSocket, { dir: 'output' }>);
              setPending(null);
            }}
          />
        )}

        {/* Connect Existing picker */}
        {connectPicker && connectPicker.nodeId === node.id && (
          <div
            onClick={() => setConnectPicker(null)}
            style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 40, display: 'flex', alignItems: 'flex-end' }}
          >
            <div onClick={e => e.stopPropagation()} style={{ width: '100%', maxHeight: '70vh', overflowY: 'auto', background: '#1e1e2e', borderRadius: '16px 16px 0 0', border: '1px solid #45475a', padding: '16px' }}>
              <div style={{ fontSize: '13px', fontWeight: 700, color: '#89b4fa', marginBottom: '12px' }}>Choose a node to connect</div>
              {connectCandidates.length === 0 && (
                <div style={{ fontSize: '12px', color: '#585b70' }}>No compatible nodes yet — try "Add New Node" instead.</div>
              )}
              {connectCandidates.map(c => (
                <button
                  key={c.id}
                  onClick={() => commitConnectExisting(c.id)}
                  style={{ display: 'block', width: '100%', textAlign: 'left', padding: '10px 12px', marginBottom: '6px', background: '#313244', border: '1px solid #45475a', borderRadius: '8px', color: '#cdd6f4', fontSize: '13px', cursor: 'pointer', touchAction: 'manipulation' }}
                >
                  {labelFor(c)}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── Home view: graph-shape grid ──────────────────────────────────────────
  // Rows = rank (left-to-right depth in the node editor, top-to-bottom
  // here); cells within a row = sibling nodes at that same depth. Same
  // ranking the desktop "Auto Layout" button uses, so this grid always
  // matches that arrangement.
  function renderHome() {
    if (nodes.length === 0) {
      return <div style={{ flex: 1, padding: '16px 12px', fontSize: '12px', color: '#585b70' }}>No nodes yet.</div>;
    }
    return (
      <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
        {rankedRows.map(({ rank, nodes: rowNodes }) => (
          <div key={rank} style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', padding: '8px 12px', borderBottom: '1px solid #24243a' }}>
            <div style={{ width: '14px', flexShrink: 0, fontSize: '10px', color: '#45475a', paddingTop: '9px', textAlign: 'right' }}>{rank}</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', flex: 1 }}>
              {rowNodes.map(n => (
                <button
                  key={n.id}
                  onClick={() => pushFocus(n.id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '6px',
                    background: '#1e1e2e', border: '1px solid #313244', borderRadius: '8px',
                    padding: '8px 10px', fontSize: '12px', color: '#cdd6f4', cursor: 'pointer', touchAction: 'manipulation',
                  }}
                >
                  <div style={dotStyle(nodeDotColor(n))} />
                  {labelFor(n)}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', height: '100%', background: '#181825', color: '#cdd6f4', fontFamily: 'system-ui, sans-serif' }}>
      {/* Breadcrumb */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '8px 12px', borderBottom: '1px solid #313244', overflowX: 'auto', flexShrink: 0 }}>
        <button onClick={goHome} style={{ background: 'none', border: 'none', color: focusStack.length === 0 ? '#89b4fa' : '#585b70', fontSize: '12px', fontWeight: 700, cursor: 'pointer', touchAction: 'manipulation', whiteSpace: 'nowrap' }}>
          Home
        </button>
        {focusStack.map((id, i) => {
          const n = nodes.find(nn => nn.id === id);
          if (!n) return null;
          return (
            <span key={id} style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
              <span style={{ color: '#585b70', fontSize: '12px' }}>›</span>
              <button
                onClick={() => jumpTo(i)}
                style={{ background: 'none', border: 'none', color: i === focusStack.length - 1 ? '#89b4fa' : '#585b70', fontSize: '12px', fontWeight: 700, cursor: 'pointer', touchAction: 'manipulation', whiteSpace: 'nowrap' }}
              >
                {labelFor(n)}
              </button>
            </span>
          );
        })}
      </div>

      {focusedNode ? renderNodeDetail(focusedNode) : renderHome()}
    </div>
  );
}
