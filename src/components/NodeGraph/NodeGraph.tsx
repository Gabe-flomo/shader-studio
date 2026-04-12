import React, { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { getNodeDefinition } from '../../nodes/definitions';
import { NodeComponent } from './NodeComponent';
import { ConnectionLine } from './ConnectionLine';
import { socketRegistry, registerSocket } from './socketRegistry';
import { Minimap } from './Minimap';
import { collectLoopPairChains } from '../../compiler/topoSort';
import { loadShortcutMap, displayCombo } from '../../hooks/useShortcuts';
import { useBreakpoint } from '../../hooks/useBreakpoint';

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
  const bp = useBreakpoint();
  const compactToolbar = bp === 'desktop-sm';
  const nodes                 = useNodeGraphStore(s => s.nodes);
  const compilationErrors     = useNodeGraphStore(s => s.compilationErrors);
  const connectNodes          = useNodeGraphStore(s => s.connectNodes);
  const autoLayout            = useNodeGraphStore(s => s.autoLayout);
  const setPreviewNodeId      = useNodeGraphStore(s => s.setPreviewNodeId);
  const previewNodeId         = useNodeGraphStore(s => s.previewNodeId);
  const nodeHighlightFilter   = useNodeGraphStore(s => s.nodeHighlightFilter);
  const registerFitView       = useNodeGraphStore(s => s.registerFitView);
  const addNode               = useNodeGraphStore(s => s.addNode);
  const setSearchPaletteOpen  = useNodeGraphStore(s => s.setSearchPaletteOpen);

  // Detect touch device once on mount
  const isTouchDevice = useRef(
    typeof window !== 'undefined' &&
    ('ontouchstart' in window || navigator.maxTouchPoints > 0)
  );

  const previewNode  = previewNodeId ? nodes.find(n => n.id === previewNodeId) : null;
  const previewDef   = previewNode ? getNodeDefinition(previewNode.type) : null;
  const previewLabel = previewDef
    ? (previewNode?.type === 'customFn' && typeof previewNode.params.label === 'string'
        ? (previewNode.params.label as string) || previewDef.label
        : previewDef.label)
    : null;

  const setGroupOutput          = useNodeGraphStore(s => s.setGroupOutput);
  const disconnectedNotice      = useNodeGraphStore(s => s.disconnectedNotice);
  const clearDisconnectedNotice = useNodeGraphStore(s => s.clearDisconnectedNotice);

  const groupNodes          = useNodeGraphStore(s => s.groupNodes);
  const wrapInLoop          = useNodeGraphStore(s => s.wrapInLoop);
  const activeGroupId       = useNodeGraphStore(s => s.activeGroupId);
  const setActiveGroupId    = useNodeGraphStore(s => s.setActiveGroupId);
  const ungroupNode         = useNodeGraphStore(s => s.ungroupNode);
  const updateNodeParams    = useNodeGraphStore(s => s.updateNodeParams);

  // When drilling into a group, show its subgraph nodes instead
  const displayNodes = React.useMemo(() => {
    if (!activeGroupId) return nodes;
    const groupNode = nodes.find(n => n.id === activeGroupId);
    const subgraph = groupNode?.params?.subgraph as import('../../types/nodeGraph').SubgraphData | undefined;
    return subgraph?.nodes ?? nodes;
  }, [nodes, activeGroupId]);

  // When inside a group, build a map of nodeId → Set<inputKey> for sockets
  // that are driven by external (group-level) input ports. These are locked/immutable.
  const externalPortMap = React.useMemo(() => {
    if (!activeGroupId) return null;
    const groupNode = nodes.find(n => n.id === activeGroupId);
    const subgraph = groupNode?.params?.subgraph as import('../../types/nodeGraph').SubgraphData | undefined;
    if (!subgraph) return null;
    const map = new Map<string, Set<string>>();
    for (const port of subgraph.inputPorts) {
      let set = map.get(port.toNodeId);
      if (!set) { set = new Set(); map.set(port.toNodeId, set); }
      set.add(port.toInputKey);
    }
    return map;
  }, [nodes, activeGroupId]);

  // Map of innerNodeId → Set<paramKey> for params driven by external ps_ connections
  const externalParamMap = React.useMemo(() => {
    if (!activeGroupId) return null;
    const groupNode = nodes.find(n => n.id === activeGroupId);
    if (!groupNode) return null;
    const map = new Map<string, Set<string>>();
    for (const [key, socket] of Object.entries(groupNode.inputs)) {
      if (!key.startsWith('ps_') || !socket.connection) continue;
      // key format: ps_${innerNodeId}_${paramKey}
      const withoutPrefix = key.slice('ps_'.length);
      // Find the split point: innerNodeId ends where paramKey starts
      // innerNodeIds can contain underscores, so we need to match by known inner node IDs
      const sg = groupNode.params?.subgraph as import('../../types/nodeGraph').SubgraphData | undefined;
      if (sg) {
        for (const sn of sg.nodes) {
          if (withoutPrefix.startsWith(sn.id + '_')) {
            const paramKey = withoutPrefix.slice(sn.id.length + 1);
            let set = map.get(sn.id);
            if (!set) { set = new Set(); map.set(sn.id, set); }
            set.add(paramKey);
          }
        }
      }
    }
    return map;
  }, [nodes, activeGroupId]);

  // Subgraph data for the active group (used by the Group Output terminal)
  const activeSubgraph = React.useMemo(() => {
    if (!activeGroupId) return null;
    const gn = nodes.find(n => n.id === activeGroupId);
    return (gn?.params?.subgraph as import('../../types/nodeGraph').SubgraphData | undefined) ?? null;
  }, [nodes, activeGroupId]);

  // Position the Group Output terminal to the right of all subgraph nodes
  const groupOutputTerminalPos = React.useMemo(() => {
    if (!activeGroupId || displayNodes.length === 0) return null;
    const maxX = Math.max(...displayNodes.map(n => n.position.x)) + NODE_WIDTH + 80;
    const ys   = displayNodes.map(n => n.position.y);
    const midY = (Math.min(...ys) + Math.max(...ys)) / 2 - 40;
    return { x: maxX, y: midY };
  }, [activeGroupId, displayNodes]);

  // Compute loop regions for the visual overlay (dashed bounding boxes behind body nodes)
  const loopRegions = useMemo(() => {
    const chains = collectLoopPairChains(displayNodes);
    return Array.from(chains.entries()).map(([endId, chain]) => ({
      endId,
      bodyIds:    chain.bodyIds,
      iterations: chain.iterations,
      carryType:  chain.carryType,
    })).filter(r => r.bodyIds.length > 0);
  }, [displayNodes]);

  const errorNodeIds = useMemo(() => {
    const ids = new Set<string>();
    for (const err of compilationErrors) {
      // Format: "Node <id> [source:<sourceId>]: ..." or "Node <id>: ..."
      const match = err.match(/^Node (\S+?)(?:\s+\[source:(\S+?)\])?:/);
      if (match) {
        ids.add(match[1]);
        if (match[2]) ids.add(match[2]);
      }
    }
    return ids;
  }, [compilationErrors]);

  const activeGroupLabel = React.useMemo(() => {
    if (!activeGroupId) return null;
    const g = nodes.find(n => n.id === activeGroupId);
    return typeof g?.params?.label === 'string' ? g.params.label : 'Group';
  }, [nodes, activeGroupId]);

  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; nodeId: string | null } | null>(null);

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

  // Auto-clear disconnected-connection notice after 5s
  useEffect(() => {
    if (!disconnectedNotice) return;
    const t = setTimeout(clearDisconnectedNotice, 5000);
    return () => clearTimeout(t);
  }, [disconnectedNotice, clearDisconnectedNotice]);

  // ── Minimap toggle (persisted) ──────────────────────────────────────────────
  const [showMinimap, setShowMinimap] = useState(() => {
    try { return localStorage.getItem('shader-studio:minimap') !== 'false'; }
    catch { return true; }
  });
  const toggleMinimap = useCallback(() => {
    setShowMinimap(prev => {
      const next = !prev;
      try { localStorage.setItem('shader-studio:minimap', String(next)); } catch {}
      return next;
    });
  }, []);

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
        if (e.shiftKey) {
          // Shift+Space → open node search palette
          setSearchPaletteOpen(true);
          return;
        }
        spaceDown.current = true;
        if (canvasRef.current) canvasRef.current.style.cursor = 'grab';
      }
      if (e.code === 'AltLeft' || e.code === 'AltRight') {
        optionDown.current = true;
        if (canvasRef.current) canvasRef.current.style.cursor = 'grab';
      }
      // Ctrl/Cmd+G → group selected nodes
      if ((e.metaKey || e.ctrlKey) && e.key === 'g'
          && document.activeElement?.tagName !== 'INPUT'
          && document.activeElement?.tagName !== 'TEXTAREA') {
        const ids = useNodeGraphStore.getState().selectedNodeIds;
        if (ids.length >= 2) {
          e.preventDefault();
          useNodeGraphStore.getState().groupNodes(ids, 'Group');
        }
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

  // ── Prevent browser-level pinch-zoom / ctrl+wheel zoom over the canvas ──────
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const prevent = (e: WheelEvent) => { if (e.ctrlKey) e.preventDefault(); };
    el.addEventListener('wheel', prevent, { passive: false });
    return () => el.removeEventListener('wheel', prevent);
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

  // ── Mobile tap-to-connect ───────────────────────────────────────────────────
  // Two-tap flow: tap output socket → pending, tap input socket → connect.
  const [pendingMobileConnection, setPendingMobileConnection] = useState<{
    sourceNodeId: string;
    sourceOutputKey: string;
    fromPos: { x: number; y: number };
  } | null>(null);

  const pendingMobileType = pendingMobileConnection
    ? (getNodeDefinition(nodes.find(n => n.id === pendingMobileConnection.sourceNodeId)?.type ?? '')
        ?.outputs[pendingMobileConnection.sourceOutputKey]?.type ?? null)
    : null;

  const handleTapOutputSocket = useCallback((nodeId: string, outputKey: string) => {
    // Tapping same source again cancels
    if (
      pendingMobileConnection?.sourceNodeId === nodeId &&
      pendingMobileConnection?.sourceOutputKey === outputKey
    ) {
      setPendingMobileConnection(null);
      return;
    }
    const canvas = canvasRef.current;
    let fromPos = getSocketPos(nodeId, 'out', outputKey, canvas, zoomRef.current, panRef.current);
    if (!fromPos) {
      const nd = nodes.find(n => n.id === nodeId);
      if (!nd) return;
      fromPos = { x: nd.position.x + NODE_WIDTH, y: nd.position.y + 80 };
    }
    setPendingMobileConnection({ sourceNodeId: nodeId, sourceOutputKey: outputKey, fromPos });
  }, [pendingMobileConnection, nodes]);

  const handleTapInputSocket = useCallback((targetNodeId: string, targetInputKey: string) => {
    if (!pendingMobileConnection) return;
    if (targetNodeId === '__group_output__' && activeGroupId) {
      setGroupOutput(activeGroupId, targetInputKey, pendingMobileConnection.sourceNodeId, pendingMobileConnection.sourceOutputKey);
    } else {
      connectNodes(
        pendingMobileConnection.sourceNodeId,
        pendingMobileConnection.sourceOutputKey,
        targetNodeId,
        targetInputKey,
      );
    }
    setPendingMobileConnection(null);
  }, [pendingMobileConnection, connectNodes, setGroupOutput, activeGroupId]);

  // Touch pan state (single finger on canvas background)
  const touchPanStart  = useRef<{ x: number; y: number } | null>(null);
  const touchPanOrigin = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

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
      if (targetNodeId === '__group_output__' && activeGroupId) {
        setGroupOutput(activeGroupId, targetInputKey, dragConnection.sourceNodeId, dragConnection.sourceOutputKey);
      } else {
        connectNodes(dragConnection.sourceNodeId, dragConnection.sourceOutputKey, targetNodeId, targetInputKey);
      }
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

  // ── Canvas touch handlers (pan + connection cancel) ──────────────────────
  const handleCanvasTouchStart = useCallback((e: React.TouchEvent) => {
    // Don't start pan when touching a node or socket
    const target = e.target as HTMLElement;
    if (target.closest('[data-node-id]')) return;
    if (e.touches.length === 1) {
      const t = e.touches[0];
      touchPanStart.current  = { x: t.clientX, y: t.clientY };
      touchPanOrigin.current = { ...panRef.current };
    }
  }, []);

  const handleCanvasTouchMove = useCallback((e: React.TouchEvent) => {
    e.preventDefault();
    if (e.touches.length === 1 && touchPanStart.current) {
      const t = e.touches[0];
      setPan({
        x: touchPanOrigin.current.x + (t.clientX - touchPanStart.current.x),
        y: touchPanOrigin.current.y + (t.clientY - touchPanStart.current.y),
      });
    }
  }, []);

  const handleCanvasTouchEnd = useCallback((e: React.TouchEvent) => {
    // If the touch ended on the raw canvas background (not a node/socket), cancel pending
    const target = e.target as HTMLElement;
    if (!target.closest('[data-node-id]') && !target.closest('[data-socket]')) {
      setPendingMobileConnection(null);
    }
    touchPanStart.current = null;
  }, []);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    // Determine if a group node was right-clicked
    const target = e.target as HTMLElement;
    const nodeEl = target.closest('[data-node-id]') as HTMLElement | null;
    const nodeId = nodeEl?.dataset.nodeId ?? null;
    setContextMenu({ x: e.clientX, y: e.clientY, nodeId });
  }, []);

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
    for (const node of displayNodes) {
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
      onContextMenu={handleContextMenu}
      onClick={() => setContextMenu(null)}
      onTouchStart={handleCanvasTouchStart}
      onTouchMove={handleCanvasTouchMove}
      onTouchEnd={handleCanvasTouchEnd}
      onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }}
      onDrop={e => {
        e.preventDefault();
        const type = e.dataTransfer.getData('application/shader-studio-node');
        if (type) {
          const worldPos = screenToWorld(e.clientX, e.clientY);
          addNode(type, worldPos);
        }
      }}
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

      {/* Mobile pending-connection banner — shown when waiting for second tap */}
      {pendingMobileConnection && isTouchDevice.current && (
        <div
          style={{
            position: 'absolute',
            top: 54,
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'rgba(30,30,46,0.92)',
            border: `1px solid ${pendingMobileType ? ('#' + (pendingMobileType === 'float' ? 'f0a0aa' : pendingMobileType === 'vec2' ? '0af0f0' : pendingMobileType === 'vec3' ? '00fa80' : 'fa8000')) : '#89b4fa'}55`,
            color: '#cdd6f4',
            padding: '8px 16px',
            borderRadius: '10px',
            fontSize: '12px',
            zIndex: 30,
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            userSelect: 'none',
            backdropFilter: 'blur(8px)',
            WebkitBackdropFilter: 'blur(8px)',
            boxShadow: '0 2px 12px rgba(0,0,0,0.5)',
            whiteSpace: 'nowrap',
          }}
        >
          <span style={{ opacity: 0.7, fontSize: '14px' }}>⟶</span>
          <span>Tap an <strong>input</strong> to connect</span>
          <button
            onTouchEnd={e => { e.stopPropagation(); setPendingMobileConnection(null); }}
            onClick={() => setPendingMobileConnection(null)}
            style={{
              background: 'none',
              border: '1px solid #45475a',
              color: '#585b70',
              cursor: 'pointer',
              fontSize: '11px',
              padding: '2px 7px',
              borderRadius: '5px',
              touchAction: 'manipulation',
            }}
          >
            Cancel
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
        {/* Zoom control: click to reset, drag slider to zoom */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <button
            onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }}
            title="Reset zoom to 100%"
            style={isTouchDevice.current ? touchToolbarBtnStyle : toolbarBtnStyle}
            onMouseEnter={e => ((e.currentTarget as HTMLButtonElement).style.background = '#45475a')}
            onMouseLeave={e => ((e.currentTarget as HTMLButtonElement).style.background = '#313244')}
          >
            {Math.round(zoom * 100)}%
          </button>
          {!isTouchDevice.current && !compactToolbar && (
            <input
              type="range"
              min={Math.round(ZOOM_MIN * 100)}
              max={Math.round(ZOOM_MAX * 100)}
              step={5}
              value={Math.round(zoom * 100)}
              onMouseDown={e => e.stopPropagation()}
              onChange={e => setZoom(Number(e.target.value) / 100)}
              title="Zoom level"
              style={{ width: '60px', accentColor: '#89b4fa', cursor: 'pointer' }}
            />
          )}
        </div>

        <button
          onClick={handleFitView}
          title="Fit all nodes in view"
          style={isTouchDevice.current ? touchToolbarBtnStyle : toolbarBtnStyle}
          onMouseEnter={e => ((e.currentTarget as HTMLButtonElement).style.background = '#45475a')}
          onMouseLeave={e => ((e.currentTarget as HTMLButtonElement).style.background = '#313244')}
        >
          {compactToolbar ? '⊡' : '⊡ Fit'}
        </button>

        {!isTouchDevice.current && !compactToolbar && (
          <button
            onClick={autoLayout}
            title="Automatically arrange nodes left-to-right by data flow"
            style={toolbarBtnStyle}
            onMouseEnter={e => ((e.currentTarget as HTMLButtonElement).style.background = '#45475a')}
            onMouseLeave={e => ((e.currentTarget as HTMLButtonElement).style.background = '#313244')}
          >
            ⊞ Auto Layout
          </button>
        )}

        {!isTouchDevice.current && !compactToolbar && (
          <button
            onClick={toggleMinimap}
            title={showMinimap ? 'Hide minimap' : 'Show minimap'}
            style={{ ...toolbarBtnStyle, opacity: showMinimap ? 1 : 0.45 }}
            onMouseEnter={e => ((e.currentTarget as HTMLButtonElement).style.background = '#45475a')}
            onMouseLeave={e => ((e.currentTarget as HTMLButtonElement).style.background = '#313244')}
          >
            [M]
          </button>
        )}
      </div>

      {/* Breadcrumb when inside a group */}
      {activeGroupId && activeGroupLabel && (
        <div style={{
          position: 'absolute',
          top: compactToolbar ? 46 : 10,
          left: '50%', transform: 'translateX(-50%)',
          background: '#1e1e2e', border: '1px solid #cba6f755',
          color: '#cba6f7', padding: '5px 14px', borderRadius: '8px',
          fontSize: '11px', zIndex: 20, display: 'flex', alignItems: 'center',
          gap: '8px', userSelect: 'none', boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
          whiteSpace: 'nowrap',
        }}>
          <button
            onClick={() => setActiveGroupId(null)}
            style={{ background: 'none', border: 'none', color: '#89b4fa', cursor: 'pointer', fontSize: '11px', padding: 0 }}
          >
            Root
          </button>
          <span style={{ color: '#585b70' }}>›</span>
          <strong>{activeGroupLabel}</strong>
        </div>
      )}

      {/* Disconnected-connection notice — auto-hides after 5s */}
      {disconnectedNotice && (
        <div style={{
          position: 'absolute',
          top: compactToolbar ? 80 : 50,
          left: '50%', transform: 'translateX(-50%)',
          background: '#2d1b1b', border: '1px solid #f38ba855',
          color: '#f38ba8', padding: '5px 14px', borderRadius: '8px',
          fontSize: '11px', zIndex: 25, display: 'flex', alignItems: 'center',
          gap: '8px', userSelect: 'none', boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
          whiteSpace: 'nowrap',
        }}>
          <span>⚠ {disconnectedNotice}</span>
          <button
            onClick={clearDisconnectedNotice}
            style={{ background: 'none', border: '1px solid #f38ba855', color: '#f38ba8', cursor: 'pointer', fontSize: '10px', padding: '1px 6px', borderRadius: '4px' }}
          >×</button>
        </div>
      )}

      {/* Right-click context menu */}
      {contextMenu && (
        <div
          onMouseDown={e => e.stopPropagation()}
          onClick={e => e.stopPropagation()}
          style={{
            position: 'fixed', left: contextMenu.x, top: contextMenu.y,
            background: '#1e1e2e', border: '1px solid #45475a', borderRadius: '6px',
            padding: '4px 0', zIndex: 100, boxShadow: '0 4px 16px rgba(0,0,0,0.6)',
            minWidth: '160px', fontSize: '12px',
          }}
        >
          {(() => {
            const clickedNode = contextMenu.nodeId ? nodes.find(n => n.id === contextMenu.nodeId) : null;
            const isGroup = clickedNode?.type === 'group';
            const ids = useNodeGraphStore.getState().selectedNodeIds;
            const canGroup = ids.length >= 2 && !activeGroupId;
            const loopForbidden = ['output', 'vec4Output', 'loopStart', 'loopEnd'];
            const canWrap = ids.length >= 1 && !activeGroupId &&
              !ids.some(id => loopForbidden.includes(nodes.find(n => n.id === id)?.type ?? ''));
            return (
              <>
                {canGroup && (
                  <button style={ctxBtnStyle} onClick={() => {
                    groupNodes(ids, 'Group');
                    setContextMenu(null);
                  }}>
                    Group Selection <span style={{ color: '#585b70', fontSize: '10px' }}>⌘G</span>
                  </button>
                )}
                {canWrap && (
                  <button style={ctxBtnStyle} onClick={() => {
                    wrapInLoop(ids);
                    setContextMenu(null);
                  }}>
                    Wrap in Loop <span style={{ color: '#585b70', fontSize: '10px' }}>{displayCombo(loadShortcutMap()['wrapInLoop'] ?? 'cmd+l')}</span>
                  </button>
                )}
                {isGroup && clickedNode && (
                  <>
                    <button style={ctxBtnStyle} onClick={() => {
                      setActiveGroupId(clickedNode.id);
                      setContextMenu(null);
                    }}>
                      Enter Group
                    </button>
                    <button style={ctxBtnStyle} onClick={() => {
                      const label = window.prompt('Group name:', typeof clickedNode.params.label === 'string' ? clickedNode.params.label : 'Group');
                      if (label !== null) updateNodeParams(clickedNode.id, { label });
                      setContextMenu(null);
                    }}>
                      Rename Group
                    </button>
                    <div style={{ borderTop: '1px solid #313244', margin: '4px 0' }} />
                    <button style={{ ...ctxBtnStyle, color: '#f38ba8' }} onClick={() => {
                      ungroupNode(clickedNode.id);
                      setContextMenu(null);
                    }}>
                      Ungroup
                    </button>
                  </>
                )}
                {!canGroup && !canWrap && !isGroup && (
                  <div style={{ padding: '6px 12px', color: '#585b70', fontSize: '11px' }}>
                    Select nodes to group or wrap
                  </div>
                )}
              </>
            );
          })()}
        </div>
      )}

      {/* Minimap overlay — screen space, bottom-right (hidden on touch devices) */}
      {showMinimap && !isTouchDevice.current && (
        <Minimap
          nodes={nodes}
          pan={pan}
          zoom={zoom}
          viewportWidth={canvasEl?.clientWidth ?? 800}
          viewportHeight={canvasEl?.clientHeight ?? 600}
          onPanTo={(worldX, worldY) => {
            const vw = canvasEl?.clientWidth  ?? 800;
            const vh = canvasEl?.clientHeight ?? 600;
            setPan({
              x: -worldX * zoom + vw / 2,
              y: -worldY * zoom + vh / 2,
            });
          }}
        />
      )}

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
          {/* Loop region overlays — drawn behind connection lines */}
          {loopRegions.map(({ endId, bodyIds, iterations, carryType }) => {
            const bodyNodes = displayNodes.filter(n => bodyIds.includes(n.id));
            if (bodyNodes.length === 0) return null;
            const pad = 20;
            const nodeH = 180; // approximate node card height
            const xs = bodyNodes.map(n => n.position.x);
            const ys = bodyNodes.map(n => n.position.y);
            const rx = Math.min(...xs) - pad;
            const ry = Math.min(...ys) - pad;
            const rw = Math.max(...xs) + NODE_WIDTH + pad - rx;
            const rh = Math.max(...ys) + nodeH + pad - ry;
            const color =
              carryType === 'vec3' ? '#cba6f7' :
              carryType === 'float' ? '#f9e2af' :
              carryType === 'vec4' ? '#a6e3a1' :
              '#89b4fa'; // vec2
            return (
              <g key={endId}>
                <rect
                  x={rx} y={ry} width={rw} height={rh}
                  rx={10}
                  fill={color + '0d'}
                  stroke={color + '55'}
                  strokeWidth={1.5}
                  strokeDasharray="6 3"
                />
                <text
                  x={rx + 10} y={ry + 16}
                  fontSize={10}
                  fill={color + 'aa'}
                  fontFamily="monospace"
                  style={{ pointerEvents: 'none', userSelect: 'none' }}
                >
                  loop × {iterations}
                </text>
              </g>
            );
          })}

          {displayNodes.map(node =>
            Object.entries(node.inputs).map(([inputKey, input]) => {
              if (!input.connection) return null;
              const sourceNode = displayNodes.find(n => n.id === input.connection!.nodeId);
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

          {/* Group output port edges — drawn from inner node outputs to the terminal */}
          {activeSubgraph && activeSubgraph.outputPorts.map(port => {
            const fromPos = getSocketPos(port.fromNodeId, 'out', port.fromOutputKey, canvasEl, zoom, pan);
            const toPos   = getSocketPos('__group_output__', 'in', port.key, canvasEl, zoom, pan);
            if (!fromPos || !toPos) return null;
            const srcNode  = displayNodes.find(n => n.id === port.fromNodeId);
            const lineType = srcNode?.outputs[port.fromOutputKey]?.type;
            return (
              <ConnectionLine
                key={`gout-${port.key}`}
                from={fromPos}
                to={toPos}
                dataType={lineType}
              />
            );
          })}

          {dragConnection && (
            <ConnectionLine
              from={dragConnection.fromPos}
              to={dragConnection.mousePos}
              dataType={draggingType ?? undefined}
            />
          )}

          {/* Pending mobile connection — static line to a ghost endpoint near the source */}
          {pendingMobileConnection && !dragConnection && (() => {
            const toPos = {
              x: pendingMobileConnection.fromPos.x + 60,
              y: pendingMobileConnection.fromPos.y,
            };
            return (
              <ConnectionLine
                from={pendingMobileConnection.fromPos}
                to={toPos}
                dataType={pendingMobileType ?? undefined}
              />
            );
          })()}
        </svg>

        {/* Node cards — positioned in world space */}
        {displayNodes.map(node => (
          <NodeComponent
            key={node.id}
            node={node}
            onStartConnection={handleStartConnection}
            onEndConnection={handleEndConnection}
            onTapOutputSocket={handleTapOutputSocket}
            onTapInputSocket={handleTapInputSocket}
            pendingMobileConnection={pendingMobileConnection}
            pendingMobileType={pendingMobileType}
            draggingType={draggingType}
            isTouchDevice={isTouchDevice.current}
            zoom={zoom}
            dimmed={highlightedIds !== null && !highlightedIds.has(node.id)}
            onEnterGroup={setActiveGroupId}
            hasError={errorNodeIds.has(node.id)}
            externalInputKeys={externalPortMap?.get(node.id)}
            externalParamKeys={externalParamMap?.get(node.id)}
          />
        ))}

        {/* Group Output terminal — shown when inside a group view */}
        {activeGroupId && activeSubgraph && groupOutputTerminalPos && (
          <div
            data-node-id="__group_output__"
            style={{
              position: 'absolute',
              left: groupOutputTerminalPos.x,
              top: groupOutputTerminalPos.y,
              width: 170,
              background: '#1e1e2e',
              border: '1px solid #cba6f755',
              borderRadius: '8px',
              overflow: 'hidden',
              userSelect: 'none',
            }}
            onMouseDown={e => e.stopPropagation()}
          >
            {/* Header */}
            <div style={{
              background: '#2a1f3d', padding: '6px 10px',
              fontSize: '11px', color: '#cba6f7', fontWeight: 700,
              letterSpacing: '0.04em',
            }}>
              ⊳ Group Output
            </div>

            {/* One row per output port */}
            {activeSubgraph.outputPorts.map(port => {
              const TYPE_COLORS: Record<string, string> = { float: '#f0a', vec2: '#0af', vec3: '#0fa', vec4: '#fa0' };
              const srcNode  = displayNodes.find(n => n.id === port.fromNodeId);
              const srcDef   = srcNode ? getNodeDefinition(srcNode.type) : null;
              const srcLabel = typeof srcNode?.params?.label === 'string'
                ? srcNode.params.label
                : (srcDef?.label ?? srcNode?.type ?? '?');
              const isDraggingCompatible = dragConnection
                ? (() => { const src = displayNodes.find(n => n.id === dragConnection.sourceNodeId); return !!(src?.outputs[dragConnection.sourceOutputKey]); })()
                : false;
              return (
                <div
                  key={port.key}
                  style={{
                    padding: '5px 10px 5px 16px',
                    display: 'flex', alignItems: 'center', gap: '6px',
                    position: 'relative',
                    background: isDraggingCompatible ? '#cba6f711' : 'transparent',
                  }}
                >
                  {/* Input socket dot */}
                  <div
                    ref={el => { registerSocket('__group_output__', 'in', port.key, el); }}
                    onMouseUp={e => { e.stopPropagation(); handleEndConnection('__group_output__', port.key); }}
                    style={{
                      position: 'absolute', left: -5,
                      width: 10, height: 10, borderRadius: '50%',
                      background: TYPE_COLORS[port.type] ?? '#888',
                      cursor: 'crosshair',
                      border: isDraggingCompatible ? '2px solid white' : 'none',
                    }}
                  />
                  <span style={{ fontSize: '10px', color: '#a6adc8', minWidth: '30px' }}>{port.label}</span>
                  <span style={{ fontSize: '9px', color: '#585b70', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                    {srcLabel}
                  </span>
                  <span style={{ fontSize: '9px', color: TYPE_COLORS[port.type] ?? '#888', flexShrink: 0 }}>{port.type}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

const ctxBtnStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  background: 'none',
  border: 'none',
  color: '#cdd6f4',
  padding: '6px 12px',
  textAlign: 'left',
  cursor: 'pointer',
  fontSize: '12px',
};

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

// Larger touch target for toolbar buttons on touch devices
const touchToolbarBtnStyle: React.CSSProperties = {
  background: 'rgba(49,50,68,0.85)',
  border: '1px solid #45475a',
  color: '#cdd6f4',
  borderRadius: '8px',
  padding: '10px 14px',
  fontSize: '13px',
  cursor: 'pointer',
  letterSpacing: '0.02em',
  touchAction: 'manipulation',
  backdropFilter: 'blur(6px)',
  WebkitBackdropFilter: 'blur(6px)',
};
