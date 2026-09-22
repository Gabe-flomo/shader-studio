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
import type { GraphNode, DataType } from '../../types/nodeGraph';
import { TYPE_COLORS } from './typeColors';
import { NodeSearchPalette } from './NodeSearchPalette';

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

function typesCompatible(a: DataType | string, b: DataType | string): boolean {
  if (a === b) return true;
  // float is universally compatible as either a source or a sink, matching
  // resolveInputVars' implicit float->vecN promotion.
  if (a === 'float' || b === 'float') return true;
  // vec2<->vec3 are mutually convertible too (promote with z=0, or truncate
  // .xy) — resolveInputVars handles both directions, just with different
  // emitted GLSL.
  const pair = new Set([a, b]);
  if (pair.has('vec2') && pair.has('vec3')) return true;
  return false;
}

function firstCompatibleInputKey(node: GraphNode, type: string): string | undefined {
  return Object.entries(node.inputs).find(([, inp]) => typesCompatible(inp.type, type))?.[0];
}
function firstCompatibleOutputKey(node: GraphNode, type: string): string | undefined {
  return Object.entries(node.outputs).find(([, out]) => typesCompatible(out.type, type))?.[0];
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

  const sources = useMemo(() => nodes.filter(n => Object.keys(n.inputs).length === 0), [nodes]);
  const outputNode = useMemo(() => nodes.find(n => n.type === 'output'), [nodes]);

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
      Object.values(n.inputs).some(i => typesCompatible(i.type, connectPicker.type)) &&
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

  // ── Home view ─────────────────────────────────────────────────────────────
  function renderHome() {
    return (
      <div style={{ flex: 1, overflowY: 'auto' }}>
        <div style={{ padding: '8px 12px 4px', fontSize: '11px', fontWeight: 700, color: '#585b70', letterSpacing: '0.05em' }}>SOURCES</div>
        {sources.map(n => (
          <div key={n.id} style={rowStyle} onClick={() => pushFocus(n.id)}>
            <div style={dotStyle(TYPE_COLORS[Object.values(n.outputs)[0]?.type ?? 'float'] ?? '#888')} />
            <div style={{ fontSize: '13px', color: '#cdd6f4', flex: 1 }}>{labelFor(n)}</div>
            <div style={{ color: '#585b70' }}>›</div>
          </div>
        ))}
        {sources.length === 0 && <div style={{ padding: '10px 12px', fontSize: '12px', color: '#585b70' }}>No source nodes yet.</div>}

        <div style={{ padding: '12px 12px 4px', fontSize: '11px', fontWeight: 700, color: '#585b70', letterSpacing: '0.05em' }}>OUTPUT</div>
        {outputNode ? (
          <div style={rowStyle} onClick={() => pushFocus(outputNode.id)}>
            <div style={dotStyle('#a6e3a1')} />
            <div style={{ fontSize: '13px', color: '#cdd6f4', flex: 1 }}>{labelFor(outputNode)}</div>
            <div style={{ color: '#585b70' }}>›</div>
          </div>
        ) : (
          <div style={{ padding: '10px 12px', fontSize: '12px', color: '#585b70' }}>No Output node found.</div>
        )}
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
