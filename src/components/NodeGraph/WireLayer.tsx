import React, { useEffect, useMemo, useState } from 'react';
import type { GraphNode, SubgraphData } from '../../types/nodeGraph';
import { getNodeDefinition } from '../../nodes/definitions';
import { ConnectionLine } from './ConnectionLine';
import { getDragPosition, getSocketElement, getSocketOffset, subscribeLayout, type Pt } from './socketRegistry';

export interface EdgeInfo {
  fromNodeId: string;
  fromOutputKey: string;
  toNodeId: string;
  toInputKey: string;
  fromType: string;
  toType: string;
}

interface Props {
  /** Nodes in the current scope (top level, or the active group's subgraph). */
  displayNodes: GraphNode[];
  activeSubgraph: SubgraphData | null;
  groupOutputTerminalPos: Pt | null;
  groupInputTerminalPos: Pt | null;
  /** Edge keys lit by the Shift+socket spotlight; everything else is dimmed when non-empty. */
  spotlightEdges: Set<string>;
  /** In-progress mouse connection drag, world space. */
  dragConnection: { fromPos: Pt; mousePos: Pt } | null;
  draggingType: string | null;
  /** Mobile two-tap connection: a short stub from the source socket. */
  pendingMobileConnection: { fromPos: Pt } | null;
  pendingMobileType: string | null;
  /** Smart connect: the wire the hovered suggestion would make */
  ghostWire?: { from: Pt; to: Pt; type: string } | null;
  onEdgeEnter: (edge: EdgeInfo, midWorld: Pt) => void;
  onEdgeLeave: () => void;
}

// Same format NodeGraph uses for spotlightEdges.
const edgeKeyOf = (fromNodeId: string, fromOutputKey: string, toNodeId: string, toInputKey: string) =>
  `${fromNodeId}:${fromOutputKey}→${toNodeId}:${toInputKey}`;

/**
 * Draws every wire in the current scope from *data*: a wire's endpoint is the
 * owning card's position plus the socket's measured offset inside that card
 * (see socketRegistry). No layout reads, no dependence on pan/zoom, and while
 * a card is being dragged the live position comes from the registry — the
 * store isn't touched until release.
 *
 * Re-renders on: its props changing, or a registry notification (a socket
 * mounted, a card resized, a drag moved) — at most once per frame. Individual
 * <ConnectionLine>s are memoised on their endpoints, so a drag re-renders only
 * the wires attached to the moving card.
 */
export const WireLayer = React.memo(function WireLayer({
  displayNodes, activeSubgraph, groupOutputTerminalPos, groupInputTerminalPos, spotlightEdges,
  dragConnection, draggingType, pendingMobileConnection, pendingMobileType, onEdgeEnter, onEdgeLeave, ghostWire = null,
}: Props) {
  const [, bump] = useState(0);
  useEffect(() => subscribeLayout(() => bump(t => t + 1)), []);

  const byId = useMemo(() => new Map(displayNodes.map(n => [n.id, n])), [displayNodes]);

  const positionOf = (nodeId: string): Pt | null => {
    const live = getDragPosition(nodeId);
    if (live) return live;
    const n = byId.get(nodeId);
    if (n) return n.position;
    if (nodeId === '__group_output__') return groupOutputTerminalPos;
    if (nodeId === '__group_input__')  return groupInputTerminalPos;
    return null;
  };
  const socketWorld = (nodeId: string, dir: 'in' | 'out', key: string): Pt | null => {
    const p = positionOf(nodeId);
    const o = getSocketOffset(nodeId, dir, key);
    if (!p || !o) return null;
    return { x: p.x + o.x, y: p.y + o.y };
  };

  // Rebuilt every render; the delegated hover handlers below close over it.
  const edges = new Map<string, { info: EdgeInfo; mid: Pt }>();

  const dimming = spotlightEdges.size > 0;
  const wires: React.ReactNode[] = [];
  for (const node of displayNodes) {
    for (const [inputKey, input] of Object.entries(node.inputs)) {
      if (!input.connection) continue;
      const sourceNode = byId.get(input.connection.nodeId);
      if (!sourceNode) continue;
      const fromPos = socketWorld(input.connection.nodeId, 'out', input.connection.outputKey);
      const toPos   = socketWorld(node.id, 'in', inputKey);
      if (!fromPos || !toPos) continue;

      const srcDef = getNodeDefinition(sourceNode.type);
      // For group nodes the static def has empty outputs (they're dynamic);
      // fall back to the live node's outputs so wires get the right colour.
      const lineType = srcDef?.outputs[input.connection.outputKey]?.type
        ?? sourceNode.outputs[input.connection.outputKey]?.type;
      const edgeKey = edgeKeyOf(input.connection.nodeId, input.connection.outputKey, node.id, inputKey);
      edges.set(edgeKey, {
        info: {
          fromNodeId: input.connection.nodeId, fromOutputKey: input.connection.outputKey,
          toNodeId: node.id, toInputKey: inputKey,
          fromType: lineType ?? 'float', toType: input.type as string,
        },
        mid: { x: (fromPos.x + toPos.x) / 2, y: (fromPos.y + toPos.y) / 2 },
      });
      wires.push(
        <ConnectionLine
          key={`${node.id}-${inputKey}`}
          from={fromPos}
          to={toPos}
          dataType={lineType}
          edgeKey={edgeKey}
          dimmed={dimming && !spotlightEdges.has(edgeKey)}
        />,
      );
    }
  }

  // Group port edges — only while the terminal card is actually mounted
  // (regular groups; scene-style groups manage their own body and show none).
  if (activeSubgraph) {
    for (const port of (activeSubgraph.outputPorts ?? [])) {
      if (!getSocketElement('__group_output__', 'in', port.key)) continue;
      const fromPos = socketWorld(port.fromNodeId, 'out', port.fromOutputKey);
      const toPos   = socketWorld('__group_output__', 'in', port.key);
      if (!fromPos || !toPos) continue;
      const lineType = byId.get(port.fromNodeId)?.outputs[port.fromOutputKey]?.type;
      wires.push(<ConnectionLine key={`gout-${port.key}`} from={fromPos} to={toPos} dataType={lineType} />);
    }
    for (const port of (activeSubgraph.inputPorts ?? [])) {
      if (!port.toNodeId || !port.toInputKey) continue;
      if (!getSocketElement('__group_input__', 'out', port.key)) continue;
      const fromPos = socketWorld('__group_input__', 'out', port.key);
      const toPos   = socketWorld(port.toNodeId, 'in', port.toInputKey);
      if (!fromPos || !toPos) continue;
      wires.push(<ConnectionLine key={`gin-${port.key}`} from={fromPos} to={toPos} dataType={port.type} />);
    }
  }

  // One listener pair on the <svg> instead of a closure per wire. mouseover /
  // mouseout bubble (mouseenter / mouseleave don't), and the hit path is a
  // single element, so they fire exactly on entering and leaving a wire.
  const edgeFromEvent = (e: React.MouseEvent) => (e.target as Element).getAttribute?.('data-edge');
  const handleOver = (e: React.MouseEvent) => {
    const k = edgeFromEvent(e);
    if (!k) return;
    const hit = edges.get(k);
    if (hit) onEdgeEnter(hit.info, hit.mid);
  };
  const handleOut = (e: React.MouseEvent) => {
    if (edgeFromEvent(e)) onEdgeLeave();
  };

  return (
    <svg
      onMouseOver={handleOver}
      onMouseOut={handleOut}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100000px',
        height: '100000px',
        overflow: 'visible',
      }}
    >
      {wires}
      {dragConnection && (
        <ConnectionLine from={dragConnection.fromPos} to={dragConnection.mousePos} dataType={draggingType ?? undefined} />
      )}
      {ghostWire && (
        <g style={{ opacity: 0.55 }}>
          <ConnectionLine from={ghostWire.from} to={ghostWire.to} dataType={ghostWire.type} />
        </g>
      )}
      {/* Pending mobile connection — static stub to a ghost endpoint near the source */}
      {pendingMobileConnection && !dragConnection && (
        <ConnectionLine
          from={pendingMobileConnection.fromPos}
          to={{ x: pendingMobileConnection.fromPos.x + 60, y: pendingMobileConnection.fromPos.y }}
          dataType={pendingMobileType ?? undefined}
        />
      )}
    </svg>
  );
});
