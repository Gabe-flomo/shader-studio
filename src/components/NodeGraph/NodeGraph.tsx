import React, { useRef, useState, useEffect } from 'react';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { getNodeDefinition } from '../../nodes/definitions';
import { NodeComponent } from './NodeComponent';
import { ConnectionLine } from './ConnectionLine';
import type { DataType } from '../../types/nodeGraph';

// ─── Layout constants (must match NodeComponent.tsx CSS) ────────────────────
// Used only as fallback estimates — actual positions come from DOM when available
const NODE_WIDTH = 240;

// ─── Socket position registry ────────────────────────────────────────────────
// NodeComponent registers DOM elements for each socket dot here so NodeGraph
// can read actual pixel positions instead of computing from layout constants.
type SocketRegistry = Map<string, HTMLElement>; // key: `${nodeId}:in:${key}` or `${nodeId}:out:${key}`

export const socketRegistry: SocketRegistry = new Map();

export function registerSocket(nodeId: string, dir: 'in' | 'out', key: string, el: HTMLElement | null) {
  const k = `${nodeId}:${dir}:${key}`;
  if (el) {
    socketRegistry.set(k, el);
  } else {
    socketRegistry.delete(k);
  }
}

function getSocketPos(
  nodeId: string,
  dir: 'in' | 'out',
  key: string,
  canvasEl: HTMLElement | null,
): { x: number; y: number } | null {
  const el = socketRegistry.get(`${nodeId}:${dir}:${key}`);
  if (!el || !canvasEl) return null;
  const elRect = el.getBoundingClientRect();
  const canvasRect = canvasEl.getBoundingClientRect();
  const cx = elRect.left + elRect.width / 2 - canvasRect.left + canvasEl.scrollLeft;
  const cy = elRect.top + elRect.height / 2 - canvasRect.top + canvasEl.scrollTop;
  return { x: cx, y: cy };
}

export function NodeGraph() {
  const { nodes, connectNodes, autoLayout, setPreviewNodeId } = useNodeGraphStore();
  const previewNodeId = useNodeGraphStore(s => s.previewNodeId);

  // Resolve the label for the preview banner
  const previewNode = previewNodeId ? nodes.find(n => n.id === previewNodeId) : null;
  const previewDef  = previewNode ? getNodeDefinition(previewNode.type) : null;
  const previewLabel = previewDef
    ? (previewNode?.type === 'customFn' && typeof previewNode.params.label === 'string'
        ? (previewNode.params.label as string) || previewDef.label
        : previewDef.label)
    : null;
  const canvasRef = useRef<HTMLDivElement>(null);
  // Tick forces a re-render after mount so canvasRef.current is available for SVG line calculation
  const [, setTick] = useState(0);
  useEffect(() => { setTick(t => t + 1); }, []);

  const [dragConnection, setDragConnection] = useState<{
    sourceNodeId: string;
    sourceOutputKey: string;
    fromPos: { x: number; y: number };
    mousePos: { x: number; y: number };
  } | null>(null);

  // Type of the output socket currently being dragged (for compatibility highlighting)
  const draggingType = dragConnection
    ? (getNodeDefinition(nodes.find(n => n.id === dragConnection.sourceNodeId)?.type ?? '')
        ?.outputs[dragConnection.sourceOutputKey]?.type ?? null)
    : null;

  const getCanvasOffset = () => {
    const rect = canvasRef.current?.getBoundingClientRect();
    return rect ? { x: rect.left, y: rect.top } : { x: 0, y: 0 };
  };

  const handleStartConnection = (
    nodeId: string,
    outputKey: string,
    event: React.MouseEvent
  ) => {
    event.stopPropagation();
    const offset = getCanvasOffset();
    const canvas = canvasRef.current;

    // Try to get exact DOM position first
    let fromPos = getSocketPos(nodeId, 'out', outputKey, canvas);
    if (!fromPos) {
      // Fallback: estimate from node position
      const node = nodes.find(n => n.id === nodeId);
      if (!node) return;
      fromPos = { x: node.position.x + NODE_WIDTH, y: node.position.y + 80 };
    }

    setDragConnection({
      sourceNodeId: nodeId,
      sourceOutputKey: outputKey,
      fromPos,
      mousePos: { x: event.clientX - offset.x, y: event.clientY - offset.y },
    });
  };

  const handleMouseMove = (event: React.MouseEvent) => {
    if (!dragConnection) return;
    const offset = getCanvasOffset();
    setDragConnection({
      ...dragConnection,
      mousePos: { x: event.clientX - offset.x, y: event.clientY - offset.y },
    });
  };

  const handleEndConnection = (targetNodeId: string, targetInputKey: string) => {
    if (dragConnection) {
      connectNodes(
        dragConnection.sourceNodeId,
        dragConnection.sourceOutputKey,
        targetNodeId,
        targetInputKey
      );
      setDragConnection(null);
    }
  };

  const handleMouseUp = () => {
    setDragConnection(null);
  };

  const canvas = canvasRef.current;

  return (
    <div
      ref={canvasRef}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        background: '#11111b',
        overflow: 'auto',
        backgroundImage:
          'radial-gradient(circle, #313244 1px, transparent 1px)',
        backgroundSize: '24px 24px',
      }}
    >
      {/* Preview mode banner */}
      {previewNodeId && previewLabel && (
        <div
          style={{
            position: 'absolute',
            top: 10,
            left: '50%',
            transform: 'translateX(-50%)',
            background: '#1e1e2e',
            border: '1px solid #a6e3a155',
            color: '#a6e3a1',
            padding: '5px 14px',
            borderRadius: '8px',
            fontSize: '11px',
            zIndex: 20,
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            userSelect: 'none',
            boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
          }}
        >
          <span>👁 Previewing: <strong>{previewLabel}</strong></span>
          <button
            onClick={() => setPreviewNodeId(null)}
            style={{
              background: 'none',
              border: '1px solid #a6e3a155',
              color: '#a6e3a1',
              cursor: 'pointer',
              fontSize: '10px',
              padding: '1px 6px',
              borderRadius: '4px',
            }}
          >
            exit
          </button>
        </div>
      )}

      {/* Auto Layout button */}
      <button
        onClick={autoLayout}
        title="Automatically arrange nodes left-to-right by data flow"
        style={{
          position: 'absolute',
          top: '10px',
          right: '10px',
          zIndex: 10,
          background: '#313244',
          border: '1px solid #45475a',
          color: '#cdd6f4',
          borderRadius: '6px',
          padding: '5px 10px',
          fontSize: '11px',
          cursor: 'pointer',
          letterSpacing: '0.02em',
        }}
        onMouseEnter={e => ((e.currentTarget as HTMLButtonElement).style.background = '#45475a')}
        onMouseLeave={e => ((e.currentTarget as HTMLButtonElement).style.background = '#313244')}
      >
        ⊞ Auto Layout
      </button>

      {/* SVG overlay for connection lines */}
      <svg
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          pointerEvents: 'none',
          overflow: 'visible',
        }}
      >
        {/* Existing connections — positions read from DOM via registry */}
        {nodes.map(node =>
          Object.entries(node.inputs).map(([inputKey, input]) => {
            if (!input.connection) return null;
            const sourceNode = nodes.find(n => n.id === input.connection!.nodeId);
            if (!sourceNode) return null;

            const fromPos = getSocketPos(input.connection.nodeId, 'out', input.connection.outputKey, canvas);
            const toPos   = getSocketPos(node.id, 'in', inputKey, canvas);
            if (!fromPos || !toPos) return null;

            const srcDef  = getNodeDefinition(sourceNode.type);
            const lineType = srcDef?.outputs[input.connection.outputKey]?.type;

            return (
              <ConnectionLine
                key={`${node.id}-${inputKey}`}
                from={fromPos}
                to={toPos}
                dataType={lineType}
              />
            );
          })
        )}

        {/* In-progress drag connection */}
        {dragConnection && (
          <ConnectionLine
            from={dragConnection.fromPos}
            to={dragConnection.mousePos}
            dataType={draggingType ?? undefined}
          />
        )}
      </svg>

      {/* Node cards */}
      {nodes.map(node => (
        <NodeComponent
          key={node.id}
          node={node}
          onStartConnection={handleStartConnection}
          onEndConnection={handleEndConnection}
          draggingType={draggingType}
        />
      ))}
    </div>
  );
}
