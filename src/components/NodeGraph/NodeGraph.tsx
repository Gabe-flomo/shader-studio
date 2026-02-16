import React, { useRef, useState, useEffect, useCallback } from 'react';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { getNodeDefinition } from '../../nodes/definitions';
import { NodeComponent } from './NodeComponent';
import { ConnectionLine } from './ConnectionLine';
import { socketRegistry } from './socketRegistry';

// ─── Layout constants (must match NodeComponent.tsx CSS) ────────────────────
const NODE_WIDTH = 240;

// Returns socket position in *world space* (pre-transform canvas coords),
// accounting for the current pan/zoom so connection lines stay accurate.
function getSocketPos(
  nodeId: string,
  dir: 'in' | 'out',
  key: string,
  canvasEl: HTMLElement | null,
  zoom: number,
  pan: { x: number; y: number },
): { x: number; y: number } | null {
  const el = socketRegistry.get(`${nodeId}:${dir}:${key}`);
  if (!el || !canvasEl) return null;
  const elRect    = el.getBoundingClientRect();
  const canvasRect = canvasEl.getBoundingClientRect();
  // Screen-space position relative to canvas origin
  const sx = elRect.left + elRect.width  / 2 - canvasRect.left;
  const sy = elRect.top  + elRect.height / 2 - canvasRect.top;
  // Unproject to world space: world = (screen - pan) / zoom
  return {
    x: (sx - pan.x) / zoom,
    y: (sy - pan.y) / zoom,
  };
}

// ─── Pan/zoom constants ───────────────────────────────────────────────────────
const ZOOM_MIN = 0.15;
const ZOOM_MAX = 2.5;

export function NodeGraph({ transparent = false }: { transparent?: boolean }) {
  const nodes                 = useNodeGraphStore(s => s.nodes);
  const connectNodes          = useNodeGraphStore(s => s.connectNodes);
  const autoLayout            = useNodeGraphStore(s => s.autoLayout);
  const setPreviewNodeId      = useNodeGraphStore(s => s.setPreviewNodeId);
  const previewNodeId         = useNodeGraphStore(s => s.previewNodeId);
  const nodeHighlightFilter   = useNodeGraphStore(s => s.nodeHighlightFilter);
  const registerFitView       = useNodeGraphStore(s => s.registerFitView);

  const previewNode  = previewNodeId ? nodes.find(n => n.id === previewNodeId) : null;
  const previewDef   = previewNode ? getNodeDefinition(previewNode.type) : null;
  const previewLabel = previewDef
    ? (previewNode?.type === 'customFn' && typeof previewNode.params.label === 'string'
        ? (previewNode.params.label as string) || previewDef.label
        : previewDef.label)
    : null;

  const canvasRef = useRef<HTMLDivElement>(null);
  // canvasEl is stored in state so getSocketPos always has a stable reference.
  // It's set once after mount via useEffect and never changes.
  const [canvasEl, setCanvasEl] = useState<HTMLDivElement | null>(null);
  const [, setTick] = useState(0);

  useEffect(() => {
    setCanvasEl(canvasRef.current);
    if (!canvasRef.current) return;
    const ro = new ResizeObserver(() => setTick(t => t + 1));
    ro.observe(canvasRef.current);
    return () => ro.disconnect();
  }, []);

  // After nodes change, wait one rAF for the browser to paint new DOM positions,
  // then trigger a re-render so connection lines read fresh getBoundingClientRect.
  useEffect(() => {
    const id = requestAnimationFrame(() => setTick(t => t + 1));
    return () => cancelAnimationFrame(id);
  }, [nodes]);

  // ── Pan / zoom state ────────────────────────────────────────────────────────
  const [zoom, setZoom] = useState(1);
  const [pan,  setPan]  = useState({ x: 0, y: 0 });
  // Refs mirror state so event handlers always see current values without stale closure
  const zoomRef = useRef(zoom);
  const panRef  = useRef(pan);
  useEffect(() => { zoomRef.current = zoom; }, [zoom]);
  useEffect(() => { panRef.current  = pan;  }, [pan]);

  // ── Pan mode tracking ───────────────────────────────────────────────────────
  // Pan is triggered by: middle-mouse drag, Space+drag, or Option+drag (Ableton-style)
  const isPanning   = useRef(false);
  const panStart    = useRef({ x: 0, y: 0 });
  const panOrigin   = useRef({ x: 0, y: 0 });
  const spaceDown   = useRef(false);
  const optionDown  = useRef(false);

  // Keyboard: Space or Option to enter pan mode
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && document.activeElement?.tagName !== 'INPUT'
          && document.activeElement?.tagName !== 'TEXTAREA') {
        e.preventDefault();
        spaceDown.current = true;
        if (canvasRef.current) canvasRef.current.style.cursor = 'grab';
      }
      if (e.code === 'AltLeft' || e.code === 'AltRight') {
        optionDown.current = true;
        if (canvasRef.current) canvasRef.current.style.cursor = 'grab';
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        spaceDown.current = false;
        if (!optionDown.current && canvasRef.current)
          canvasRef.current.style.cursor = 'default';
      }
      if (e.code === 'AltLeft' || e.code === 'AltRight') {
        optionDown.current = false;
        if (!spaceDown.current && canvasRef.current)
          canvasRef.current.style.cursor = 'default';
      }
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup',   onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup',   onKeyUp);
    };
  }, []);

  // ── Wheel / trackpad handler (Ableton-style) ─────────────────────────────
  // • Two-finger scroll (no ctrl) → pan X + Y
  // • Pinch gesture / ctrl+wheel  → zoom toward cursor
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;

    if (e.ctrlKey) {
      // Pinch-to-zoom (trackpad) or ctrl+scroll (mouse wheel)
      const rect    = canvas.getBoundingClientRect();
      const mx      = e.clientX - rect.left;
      const my      = e.clientY - rect.top;
      const oldZoom = zoomRef.current;
      // ctrlKey pinch: deltaY is in "zoom units" (~small floats), scale accordingly
      const delta   = -e.deltaY * (e.deltaMode === 0 ? 0.008 : 0.3);
      const newZoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, oldZoom * (1 + delta)));
      const oldPan  = panRef.current;
      setZoom(newZoom);
      setPan({
        x: mx - (mx - oldPan.x) * (newZoom / oldZoom),
        y: my - (my - oldPan.y) * (newZoom / oldZoom),
      });
    } else {
      // Two-finger scroll → pan (translate directly in screen space)
      const oldPan = panRef.current;
      setPan({
        x: oldPan.x - e.deltaX,
        y: oldPan.y - e.deltaY,
      });
    }
  }, []);

  // ── Canvas mouse down — pan on middle-click, space+drag, or option+drag ──
  const handleCanvasMouseDown = useCallback((e: React.MouseEvent) => {
    const isMiddle    = e.button === 1;
    const isSpaceDrag = spaceDown.current  && e.button === 0;
    const isOptionDrag = optionDown.current && e.button === 0;
    if (!isMiddle && !isSpaceDrag && !isOptionDrag) return;
    e.preventDefault();
    isPanning.current  = true;
    panStart.current   = { x: e.clientX, y: e.clientY };
    panOrigin.current  = { ...panRef.current };
    if (canvasRef.current) canvasRef.current.style.cursor = 'grabbing';
    document.body.style.userSelect = 'none';
    (document.body.style as CSSStyleDeclaration & { webkitUserSelect: string }).webkitUserSelect = 'none';

    const onMove = (ev: MouseEvent) => {
      if (!isPanning.current) return;
      setPan({
        x: panOrigin.current.x + (ev.clientX - panStart.current.x),
        y: panOrigin.current.y + (ev.clientY - panStart.current.y),
      });
    };
    const onUp = () => {
      isPanning.current = false;
      document.body.style.userSelect = '';
      (document.body.style as CSSStyleDeclaration & { webkitUserSelect: string }).webkitUserSelect = '';
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup',   onUp);
      if (canvasRef.current)
        canvasRef.current.style.cursor =
          spaceDown.current || optionDown.current ? 'grab' : 'default';
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup',   onUp);
  }, []);

  // ── Connection drag ─────────────────────────────────────────────────────────
  const dragRafRef = useRef<number | null>(null);

  const [dragConnection, setDragConnection] = useState<{
    sourceNodeId: string;
    sourceOutputKey: string;
    fromPos: { x: number; y: number };   // world space
    mousePos: { x: number; y: number };  // world space
  } | null>(null);

  const draggingType = dragConnection
    ? (getNodeDefinition(nodes.find(n => n.id === dragConnection.sourceNodeId)?.type ?? '')
        ?.outputs[dragConnection.sourceOutputKey]?.type ?? null)
    : null;

  // Convert screen coords to world space
  const screenToWorld = useCallback((sx: number, sy: number) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return { x: sx, y: sy };
    return {
      x: (sx - rect.left  - panRef.current.x) / zoomRef.current,
      y: (sy - rect.top   - panRef.current.y) / zoomRef.current,
    };
  }, []);

  const handleStartConnection = (
    nodeId: string,
    outputKey: string,
    event: React.MouseEvent
  ) => {
    event.stopPropagation();
    const canvas = canvasRef.current;
    let fromPos = getSocketPos(nodeId, 'out', outputKey, canvas, zoomRef.current, panRef.current);
    if (!fromPos) {
      const node = nodes.find(n => n.id === nodeId);
      if (!node) return;
      fromPos = { x: node.position.x + NODE_WIDTH, y: node.position.y + 80 };
    }
    setDragConnection({
      sourceNodeId:    nodeId,
      sourceOutputKey: outputKey,
      fromPos,
      mousePos: screenToWorld(event.clientX, event.clientY),
    });
  };

  const handleMouseMove = (event: React.MouseEvent) => {
    if (!dragConnection) return;
    const x = event.clientX;
    const y = event.clientY;
    if (dragRafRef.current !== null) return; // skip if a frame is already queued
    dragRafRef.current = requestAnimationFrame(() => {
      dragRafRef.current = null;
      setDragConnection(prev => prev ? { ...prev, mousePos: screenToWorld(x, y) } : null);
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
    if (dragRafRef.current !== null) {
      cancelAnimationFrame(dragRafRef.current);
      dragRafRef.current = null;
    }
    setDragConnection(null);
  };

  // ── Fit to screen helper ────────────────────────────────────────────────────
  const handleFitView = useCallback(() => {
    if (!nodes.length || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const pad = 60;
    const minX = Math.min(...nodes.map(n => n.position.x)) - pad;
    const minY = Math.min(...nodes.map(n => n.position.y)) - pad;
    const maxX = Math.max(...nodes.map(n => n.position.x + NODE_WIDTH)) + pad;
    const maxY = Math.max(...nodes.map(n => n.position.y + 200)) + pad;
    const cw = canvas.clientWidth;
    const ch = canvas.clientHeight;
    const newZoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN,
      Math.min(cw / (maxX - minX), ch / (maxY - minY))
    ));
    setPan({
      x: (cw - (maxX + minX) * newZoom) / 2,
      y: (ch - (maxY + minY) * newZoom) / 2,
    });
    setZoom(newZoom);
  }, [nodes]);

  // Register fitView with the store so shortcuts / App.tsx can call it
  useEffect(() => { registerFitView(handleFitView); }, [registerFitView, handleFitView]);

  // ── Highlight filter — compute which node IDs match the current filter ───────
  const highlightedIds: Set<string> | null = React.useMemo(() => {
    if (!nodeHighlightFilter) return null;
    const matching = new Set<string>();
    for (const node of nodes) {
      const outputs = Object.values(node.outputs);
      const inputs  = Object.values(node.inputs);
      switch (nodeHighlightFilter) {
        case 'float':   if (outputs.some(o => o.type === 'float'))  matching.add(node.id); break;
        case 'vec2':    if (outputs.some(o => o.type === 'vec2'))   matching.add(node.id); break;
        case 'vec3':    if (outputs.some(o => o.type === 'vec3'))   matching.add(node.id); break;
        case 'uv-out':  if (outputs.some(o => o.type === 'vec2'))   matching.add(node.id); break;
        case 'uv-in':   if (inputs.some(i => i.type === 'vec2'))    matching.add(node.id); break;
      }
    }
    return matching;
  }, [nodeHighlightFilter, nodes]);

  // Dot grid background size scales with zoom
  const gridSize = 24 * zoom;
  const gridOffX = pan.x % gridSize;
  const gridOffY = pan.y % gridSize;

  return (
    <div
      ref={canvasRef}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseDown={handleCanvasMouseDown}
      onWheel={handleWheel}
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        background: transparent ? 'transparent' : '#11111b',
        overflow: 'hidden',
        cursor: 'default',
        userSelect: 'none',
        backgroundImage: transparent
          ? 'none'
          : 'radial-gradient(circle, #313244 1px, transparent 1px)',
        backgroundSize: `${gridSize}px ${gridSize}px`,
        backgroundPosition: `${gridOffX}px ${gridOffY}px`,
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

      {/* Toolbar — top-right, always in screen space */}
      <div
        style={{
          position: 'absolute',
          top: '10px',
          right: '10px',
          zIndex: 10,
          display: 'flex',
          gap: '6px',
          alignItems: 'center',
        }}
      >
        {/* Zoom indicator + reset */}
        <button
          onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }}
          title="Reset zoom to 100%"
          style={toolbarBtnStyle}
          onMouseEnter={e => ((e.currentTarget as HTMLButtonElement).style.background = '#45475a')}
          onMouseLeave={e => ((e.currentTarget as HTMLButtonElement).style.background = '#313244')}
        >
          {Math.round(zoom * 100)}%
        </button>

        <button
          onClick={handleFitView}
          title="Fit all nodes in view"
          style={toolbarBtnStyle}
          onMouseEnter={e => ((e.currentTarget as HTMLButtonElement).style.background = '#45475a')}
          onMouseLeave={e => ((e.currentTarget as HTMLButtonElement).style.background = '#313244')}
        >
          ⊡ Fit
        </button>

        <button
          onClick={autoLayout}
          title="Automatically arrange nodes left-to-right by data flow"
          style={toolbarBtnStyle}
          onMouseEnter={e => ((e.currentTarget as HTMLButtonElement).style.background = '#45475a')}
          onMouseLeave={e => ((e.currentTarget as HTMLButtonElement).style.background = '#313244')}
        >
          ⊞ Auto Layout
        </button>
      </div>

      {/* ── World-space container — receives pan+zoom transform ── */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: 0,
          height: 0,
          transformOrigin: '0 0',
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
        }}
      >
        {/* SVG overlay for connection lines — drawn in world space */}
        <svg
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100000px',
            height: '100000px',
            pointerEvents: 'none',
            overflow: 'visible',
          }}
        >
          {nodes.map(node =>
            Object.entries(node.inputs).map(([inputKey, input]) => {
              if (!input.connection) return null;
              const sourceNode = nodes.find(n => n.id === input.connection!.nodeId);
              if (!sourceNode) return null;

              const fromPos = getSocketPos(input.connection.nodeId, 'out', input.connection.outputKey, canvasEl, zoom, pan);
              const toPos   = getSocketPos(node.id, 'in', inputKey, canvasEl, zoom, pan);
              if (!fromPos || !toPos) return null;

              const srcDef   = getNodeDefinition(sourceNode.type);
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

          {dragConnection && (
            <ConnectionLine
              from={dragConnection.fromPos}
              to={dragConnection.mousePos}
              dataType={draggingType ?? undefined}
            />
          )}
        </svg>

        {/* Node cards — positioned in world space */}
        {nodes.map(node => (
          <NodeComponent
            key={node.id}
            node={node}
            onStartConnection={handleStartConnection}
            onEndConnection={handleEndConnection}
            draggingType={draggingType}
            zoom={zoom}
            dimmed={highlightedIds !== null && !highlightedIds.has(node.id)}
          />
        ))}
      </div>
    </div>
  );
}

const toolbarBtnStyle: React.CSSProperties = {
  background: '#313244',
  border: '1px solid #45475a',
  color: '#cdd6f4',
  borderRadius: '6px',
  padding: '5px 10px',
  fontSize: '11px',
  cursor: 'pointer',
  letterSpacing: '0.02em',
};
