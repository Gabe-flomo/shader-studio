import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { GraphNode, SubgraphData } from '../../types/nodeGraph';
import { getNodeDefinitionFor } from '../../nodes/definitions';
import { ConnectionLine } from './ConnectionLine';
import { TYPE_COLORS } from './typeColors';
import { loopWirePath } from './wirePath';
import { edgeKeyOf, useNodeDrag } from './nodeDrop';

/** A card's width (world units), for routing the trail loop over the cards it would cross. */
const CARD_W = 360;
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

  // A node dragged over a wire it would go into lights that wire.
  const dropEdge = useNodeDrag(s => s.drag?.edge ?? null);
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

      const srcDef = getNodeDefinitionFor(sourceNode);
      // The live socket first: a polymorphic card (Multiply switched to vec2) and a
      // group (dynamic ports) both carry their current type on the node, and the
      // wire should be the colour the socket is right now. The static definition
      // is the fallback for older saves that never stored socket types.
      const lineType = sourceNode.outputs[input.connection.outputKey]?.type
        ?? srcDef?.outputs[input.connection.outputKey]?.type;
      const edgeKey = edgeKeyOf(input.connection.nodeId, input.connection.outputKey, node.id, inputKey);
      // A Trail going back into its Agents group (or, inside, the group's texture port into the rule) is
      // read as it was one step before: the loop's one legal cycle (docs/agents-plan.md §12).
      const lastStep = (sourceNode.type === 'trailField' && node.type === 'agentsGroup')
        || (sourceNode.type === 'agentInputs' && lineType === 'texture');
      // The trail loop runs backward (the Trail sits right of its group): it goes over the top of the
      // cards between the two, so the wire and its "↺ last step" label sit in clear space.
      let overY: number | undefined;
      let mid = { x: (fromPos.x + toPos.x) / 2, y: (fromPos.y + toPos.y) / 2 };
      if (lastStep && sourceNode.type === 'trailField' && toPos.x < fromPos.x - 40) {
        const lo = toPos.x - 40, hi = fromPos.x + 40;
        const low = Math.max(fromPos.y, toPos.y);
        let top = Math.min(positionOf(sourceNode.id)?.y ?? fromPos.y, positionOf(node.id)?.y ?? toPos.y);
        for (const other of displayNodes) {
          const p = positionOf(other.id);
          if (!p || p.x > hi || p.x + CARD_W < lo || p.y > low || p.y < top - 900) continue;
          top = Math.min(top, p.y);
        }
        overY = top - 44;
        mid = loopWirePath(fromPos, toPos, overY).mid;
      }
      edges.set(edgeKey, {
        info: {
          fromNodeId: input.connection.nodeId, fromOutputKey: input.connection.outputKey,
          toNodeId: node.id, toInputKey: inputKey,
          fromType: lineType ?? 'float', toType: input.type as string,
        },
        mid,
      });
      wires.push(
        <ConnectionLine
          key={`${node.id}-${inputKey}`}
          from={fromPos}
          to={toPos}
          dataType={lineType}
          edgeKey={edgeKey}
          dimmed={dimming && !spotlightEdges.has(edgeKey)}
          lit={dropEdge === edgeKey}
          overY={overY}
        />,
      );
      if (lastStep) {
        const mx = mid.x, my = mid.y;
        wires.push(
          <g key={`${node.id}-${inputKey}-laststep`} transform={`translate(${mx}, ${my})`} style={{ pointerEvents: 'none', opacity: dimming && !spotlightEdges.has(edgeKey) ? 0.08 : 1 }}>
            <title>Read as it was one step before: the trail the walkers left last step.</title>
            <rect x={-38} y={-10} width={76} height={20} rx={10} fill="#1b1d24" stroke={TYPE_COLORS.texture} strokeWidth={1.5} />
            <text x={0} y={4} textAnchor="middle" fontSize={11} fontFamily="system-ui, -apple-system, sans-serif" fontWeight={600} fill="#ffd2d2">↺ last step</text>
          </g>,
        );
      }
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
  const lastPointer = useRef('mouse');
  const edgeFromEvent = (e: React.MouseEvent) => (e.target as Element).getAttribute?.('data-edge');
  const handleOver = (e: React.MouseEvent) => {
    // A tap sends a mouseover too: touch shows the badge from the click instead (handleTap below)
    if (lastPointer.current !== 'mouse') return;
    const k = edgeFromEvent(e);
    if (!k) return;
    const hit = edges.get(k);
    if (hit) onEdgeEnter(hit.info, hit.mid);
  };
  const handleOut = (e: React.MouseEvent) => {
    if (lastPointer.current !== 'mouse') return;
    if (edgeFromEvent(e)) onEdgeLeave();
  };

  // A touch screen has no hover: a tap on a wire shows its + badge (tap it: insert a node; hold it: is
  // this typical?). On the click, not the pointer up, so the badge appearing under the finger
  // doesn't take that same tap.
  const handleTap = (e: React.MouseEvent) => {
    if (lastPointer.current === 'mouse') return;
    const k = (e.target as Element).getAttribute?.('data-edge');
    const hit = k ? edges.get(k) : undefined;
    if (hit) onEdgeEnter(hit.info, hit.mid);
  };

  return (
    <svg
      onMouseOver={handleOver}
      onMouseOut={handleOut}
      onPointerDown={e => { lastPointer.current = e.pointerType; }}
      onClick={handleTap}
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
