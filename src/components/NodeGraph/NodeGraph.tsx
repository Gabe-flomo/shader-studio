import React, { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useNodeGraphStore, getActiveNodes } from '../../store/useNodeGraphStore';
import { getNodeDefinition, getNodeDefinitionFor } from '../../nodes/definitions';
import { NodeComponent } from './NodeComponent';
import { NodeSearchPalette } from './NodeSearchPalette';
import { CanvasToolbar } from '../shell/CanvasToolbar';
import { registerSocket, setLayoutZoomGetter, getSocketOffset, getDragPosition, publishView, getCardSize, isDragging, subscribeCardSizes, forgetNodeLayout, type Pt } from './socketRegistry';
import { WireLayer, type EdgeInfo } from './WireLayer';
import { buildNodeErrors } from '../../compiler/nodeErrors';
import { suggestConnections, type Suggestion } from './smartConnect';
import { suggestQuickAdds, type QuickAdd } from './quickAdds';
import { explainPreview, previewLegend } from '../../lib/previewExplain';
import { SmartConnectMenu } from './SmartConnectMenu';
import { askConfirm, askText } from '../ui/dialogStore';
import { toast } from '../ui/toastStore';
import { candidateFor, candidateLabel, collectPlayCandidates, upstreamControls } from '../../play/playControls';
import { addCandidateControl, driveWithNull, graphNullDrives } from '../play/layerOps';
import { Minimap } from './Minimap';
import { useCtp, type CtpPalette } from '../../theme/nodePalette';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import { Button, IconButton } from '../ui/Button';
import { Segmented } from '../ui/Choice';
import { Icon } from '../ui/Icon';
import { TYPE_COLORS } from './typeColors';
import { SelectionBar } from '../shell/SelectionBar';
import { GraphOutline } from './GraphOutline';
import { portalGuard } from '../ui/portalGuard';
import { removeFromPlay } from '../../play/playDriven';
import { lazyWithSuspense, type PropsOf } from '../lazyWithSuspense';
import type { OptimizeModal as OptimizeModalT } from './OptimizeModal';
const OptimizeModal = lazyWithSuspense<PropsOf<typeof OptimizeModalT>>(() => import('./OptimizeModal').then(m => ({ default: m.OptimizeModal })));

// ─── Layout constants (must match NodeComponent.tsx CSS) ────────────────────
const NODE_WIDTH = 360;

// ─── Pan/zoom constants ───────────────────────────────────────────────────────
const ZOOM_MIN = 0.15;
// How long a pan/zoom gesture may run before React state catches up (culling, zoom readout).
const VIEW_COMMIT_MS = 120;
// Viewport culling: graphs smaller than this render every card; larger ones
// skip cards further than CULL_MARGIN_PX (screen px) outside the viewport.
const CULL_MIN_NODES = 30;
const CULL_MARGIN_PX = 300;
const ZOOM_MAX = 2.5;

function groupLabel(gn: import('../../types/nodeGraph').GraphNode): string {
  if (typeof gn.params?.label === 'string') return gn.params.label;
  return gn.type === 'sceneGroup' ? 'Scene Group' : gn.type === 'spaceWarpGroup' ? 'Space Warp Group'
    : gn.type === 'marchLoopGroup' ? 'March Loop Group' : gn.type === 'giLitMarchGroup' ? 'GI Lit March Group' : 'Group';
}

// Memoised so a parent re-render (App) doesn't re-render the whole graph;
// NodeGraph reads everything it needs from the store with selectors.
/** The last focus request handled (see focusNodeRequest), across remounts. */
let handledFocus = 0;

export const NodeGraph = React.memo(function NodeGraph({ transparent = false, redesignToolbar = false, locked = false }: {
  transparent?: boolean;
  /** Desktop redesign: the top-centre CanvasToolbar (node count, zoom, fit, layout, minimap, clear) replaces the legacy corner toolbar. */
  redesignToolbar?: boolean;
  /**
   * Read-only: the cards and wires are a picture (no drags, edits, sockets or
   * menus), the canvas still pans, zooms, fits and box-selects. The Convert
   * page shows a graph-to-be this way until it's materialized.
   */
  locked?: boolean;
}) {
  const lockedRef = useRef(locked);
  useEffect(() => { lockedRef.current = locked; }, [locked]);
  const [showOptimize, setShowOptimize] = useState(false);
  const tc = useCtp();
  const tk = useTokens();
  const ctxBtnStyle = ctxBtnStyleFor(tc);
  const toolbarBtnStyle = toolbarBtnStyleFor(tc);
  const touchToolbarBtnStyle = touchToolbarBtnStyleFor(tc);
  // Group terminals (the group's inputs and output, shown inside a group)
  const terminalCard: React.CSSProperties = {
    position: 'absolute', width: 260, borderRadius: radius.card, overflow: 'visible', userSelect: 'none',
    background: tk.bg.panel, color: tk.text.primary, fontSize: 12.5, fontFamily: fontFamily.ui,
  };
  const terminalHead: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 7, padding: '10px 12px', fontWeight: 600, fontSize: 13,
    borderBottom: `1px solid ${tk.border.subtle}`,
  };
  const terminalRow: React.CSSProperties = { position: 'relative', display: 'flex', alignItems: 'center', gap: 8, height: 32 };
  const terminalDot: React.CSSProperties = {
    position: 'absolute', top: '50%', width: 12, height: 12, marginTop: -6, boxSizing: 'border-box', borderRadius: '50%', cursor: 'crosshair',
  };
  const terminalInput: React.CSSProperties = {
    width: 100, height: 24, padding: '0 6px', border: 0, outline: 'none', borderRadius: 6,
    background: tk.bg.panel, boxShadow: `inset 0 0 0 1.5px ${tk.accent.base}`, color: tk.text.primary, font: `500 12.5px ${fontFamily.ui}`,
  };
  const [canvasWidth, setCanvasWidth]   = useState(window.innerWidth);
  const [canvasHeight, setCanvasHeight] = useState(window.innerHeight);
  const compactToolbar = canvasWidth < 700;
  const nodes                 = useNodeGraphStore(s => s.nodes);
  const compilationErrors     = useNodeGraphStore(s => s.compilationErrors);
  const connectNodes          = useNodeGraphStore(s => s.connectNodes);
  const autoLayout            = useNodeGraphStore(s => s.autoLayout);
  const loadExampleGraph      = useNodeGraphStore(s => s.loadExampleGraph);
  const setPreviewNodeId      = useNodeGraphStore(s => s.setPreviewNodeId);
  const previewNodeId         = useNodeGraphStore(s => s.previewNodeId);
  const nodeHighlightFilter   = useNodeGraphStore(s => s.nodeHighlightFilter);
  const registerFitView       = useNodeGraphStore(s => s.registerFitView);
  const registerViewportCenterGetter = useNodeGraphStore(s => s.registerViewportCenterGetter);
  const registerSetView = useNodeGraphStore(s => s.registerSetView);
  const addNode               = useNodeGraphStore(s => s.addNode);
  const setSearchPaletteOpen  = useNodeGraphStore(s => s.setSearchPaletteOpen);

  // Detect touch device once on mount
  const isTouchDevice = useRef(
    typeof window !== 'undefined' &&
    ('ontouchstart' in window || navigator.maxTouchPoints > 0)
  );

  const setGroupOutput          = useNodeGraphStore(s => s.setGroupOutput);
  const addGroupOutput          = useNodeGraphStore(s => s.addGroupOutput);
  const removeGroupOutput       = useNodeGraphStore(s => s.removeGroupOutput);
  const renameGroupPort         = useNodeGraphStore(s => s.renameGroupPort);
  const addGroupInput           = useNodeGraphStore(s => s.addGroupInput);
  const rerouteGroupInput       = useNodeGraphStore(s => s.rerouteGroupInput);
  const disconnectedNotice      = useNodeGraphStore(s => s.disconnectedNotice);
  const clearDisconnectedNotice = useNodeGraphStore(s => s.clearDisconnectedNotice);

  const groupNodes          = useNodeGraphStore(s => s.groupNodes);
  const activeGroupId       = useNodeGraphStore(s => s.activeGroupId);
  const activeGroupPath     = useNodeGraphStore(s => s.activeGroupPath);
  const enterGroup          = useNodeGraphStore(s => s.enterGroup);
  const exitToRoot          = useNodeGraphStore(s => s.exitToRoot);
  const exitToDepth         = useNodeGraphStore(s => s.exitToDepth);
  const ungroupNode         = useNodeGraphStore(s => s.ungroupNode);
  const duplicateNode       = useNodeGraphStore(s => s.duplicateNode);
  const duplicateNodes      = useNodeGraphStore(s => s.duplicateNodes);
  const removeNode          = useNodeGraphStore(s => s.removeNode);
  const updateNodeParams    = useNodeGraphStore(s => s.updateNodeParams);
  const deselectAll         = useNodeGraphStore(s => s.deselectAll);
  const disconnectInput     = useNodeGraphStore(s => s.disconnectInput);

  // When drilling into a group, show its subgraph nodes instead
  const displayNodes = React.useMemo(() => {
    if (activeGroupPath.length === 0) return nodes;
    return getActiveNodes(nodes, activeGroupPath) ?? [];
  }, [nodes, activeGroupPath]);

  // Resolve the active group node regardless of nesting depth.
  // When a regular group is nested inside a scene group, it lives in the scene
  // group's subgraph and won't be found in the top-level `nodes` array.
  const activeGroupNode = React.useMemo(() => {
    if (!activeGroupId) return null;
    const topLevel = nodes.find(n => n.id === activeGroupId);
    if (topLevel) return topLevel;
    if (activeGroupPath.length >= 2) {
      const parentNodes = getActiveNodes(nodes, activeGroupPath.slice(0, -1));
      return parentNodes?.find(n => n.id === activeGroupId) ?? null;
    }
    return null;
  }, [nodes, activeGroupId, activeGroupPath]);

  // When inside a group, previewNodeId may refer to a subgraph node not in top-level `nodes`
  const previewNode  = previewNodeId ? (nodes.find(n => n.id === previewNodeId) ?? displayNodes.find(n => n.id === previewNodeId)) : null;
  const previewDef   = previewNode ? getNodeDefinitionFor(previewNode) : null;
  const previewStats = useNodeGraphStore(s => s.previewStats);
  const previewCaption = previewNode ? (explainPreview(previewNode, previewDef ?? undefined, previewStats) ?? previewLegend(previewNode, previewDef ?? undefined)) : null;
  const previewLabel = previewDef
    ? (previewNode?.type === 'customFn' && typeof previewNode.params.label === 'string'
        ? (previewNode.params.label as string) || previewDef.label
        : previewDef.label)
    : null;

  // When inside a group, build a map of nodeId → Set<inputKey> for sockets
  // that are driven by external (group-level) input ports. These are locked/immutable.
  const externalPortMap = React.useMemo(() => {
    if (!activeGroupNode) return null;
    const subgraph = activeGroupNode.params?.subgraph as import('../../types/nodeGraph').SubgraphData | undefined;
    if (!subgraph) return null;
    const map = new Map<string, Set<string>>();
    for (const port of (subgraph.inputPorts ?? [])) {
      let set = map.get(port.toNodeId);
      if (!set) { set = new Set(); map.set(port.toNodeId, set); }
      set.add(port.toInputKey);
    }
    return map;
  }, [activeGroupNode]);

  // Map of innerNodeId → Set<paramKey> for params driven by external ps_ connections
  const externalParamMap = React.useMemo(() => {
    if (!activeGroupNode) return null;
    const map = new Map<string, Set<string>>();
    for (const [key, socket] of Object.entries(activeGroupNode.inputs)) {
      if (!key.startsWith('ps_') || !socket.connection) continue;
      // key format: ps_${innerNodeId}_${paramKey}
      const withoutPrefix = key.slice('ps_'.length);
      // Find the split point: innerNodeId ends where paramKey starts
      // innerNodeIds can contain underscores, so we need to match by known inner node IDs
      const sg = activeGroupNode.params?.subgraph as import('../../types/nodeGraph').SubgraphData | undefined;
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
  }, [activeGroupNode]);

  // Subgraph data for the active group (used by the Group Output terminal)
  const activeSubgraph = React.useMemo(() => {
    if (!activeGroupNode) return null;
    return (activeGroupNode.params?.subgraph as import('../../types/nodeGraph').SubgraphData | undefined) ?? null;
  }, [activeGroupNode]);

  // True when drilled into a scene-style group (sceneGroup, spaceWarpGroup, marchLoopGroup)
  // These don't show the Group Input/Output port terminals — they manage their own body.
  const isInsideSceneGroup = React.useMemo(() => {
    if (!activeGroupNode) return false;
    return activeGroupNode.type === 'sceneGroup' || activeGroupNode.type === 'spaceWarpGroup' || activeGroupNode.type === 'marchLoopGroup' || activeGroupNode.type === 'giLitMarchGroup';
  }, [activeGroupNode]);

  // Position the Group Output terminal to the right of all subgraph nodes
  const groupOutputTerminalPos = React.useMemo(() => {
    if (!activeGroupId) return null;
    if (displayNodes.length === 0) return { x: 500, y: 160 }; // default for empty group
    const maxX = Math.max(...displayNodes.map(n => n.position.x)) + NODE_WIDTH + 80;
    const ys   = displayNodes.map(n => n.position.y);
    const midY = (Math.min(...ys) + Math.max(...ys)) / 2 - 40;
    return { x: maxX, y: midY };
  }, [activeGroupId, displayNodes]);

  // Position the Group Input terminal to the left of all subgraph nodes
  const groupInputTerminalPos = React.useMemo(() => {
    if (!activeGroupId) return null;
    if (displayNodes.length === 0) return { x: 80, y: 160 }; // default for empty group
    const minX = Math.min(...displayNodes.map(n => n.position.x)) - 220;
    const ys   = displayNodes.map(n => n.position.y);
    const midY = (Math.min(...ys) + Math.max(...ys)) / 2 - 40;
    return { x: minX, y: midY };
  }, [activeGroupId, displayNodes]);

  // Compile problems mapped onto the cards that caused them (shown on the card, not only in the error panel)
  const glslErrors      = useNodeGraphStore(s => s.glslErrors);
  const glslErrorSource = useNodeGraphStore(s => s.glslErrorSource);
  const nodeSlugMap     = useNodeGraphStore(s => s.nodeSlugMap);
  const nodeErrors = useMemo(
    () => buildNodeErrors({ compilationErrors, glslErrors, glslSource: glslErrorSource, slugs: nodeSlugMap }),
    [compilationErrors, glslErrors, glslErrorSource, nodeSlugMap],
  );

  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; nodeId: string | null; paramKey?: string } | null>(null);
  const [addingGroupInput, setAddingGroupInput] = useState<{ name: string; type: import('../../types/nodeGraph').DataType } | null>(null);
  const [editingOutputPortKey, setEditingOutputPortKey] = useState<string | null>(null);
  const [editingOutputPortLabel, setEditingOutputPortLabel] = useState('');

  // ── Feature 1: Option-click socket → filtered palette ──────────────────────
  const [pendingSocket, setPendingSocket] = useState<{
    nodeId: string; key: string; dir: 'in' | 'out'; type: string;
    screenX: number; screenY: number;
  } | null>(null);

  // ── Socket spotlight ────────────────────────────────────────────────────────
  // Hovering a wired socket lights its wires and the nodes at their other end and dims the rest.
  // Plain hover waits a beat (settledSocket) so sweeping the pointer across a graph doesn't
  // flicker; with Shift held it's immediate and works on any socket.
  type HoveredSocket = { nodeId: string; key: string; dir: 'in' | 'out' };
  const [hoveredSocket, setHoveredSocket] = useState<HoveredSocket | null>(null);
  const [settledSocket, setSettledSocket] = useState<HoveredSocket | null>(null);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleSocketHover = useCallback((sock: HoveredSocket | null) => {
    setHoveredSocket(sock);
    if (settleTimer.current) { clearTimeout(settleTimer.current); settleTimer.current = null; }
    if (!sock) { setSettledSocket(null); return; }
    settleTimer.current = setTimeout(() => setSettledSocket(sock), 120);
  }, []);
  useEffect(() => () => { if (settleTimer.current) clearTimeout(settleTimer.current); }, []);
  const [shiftHeld, setShiftHeld] = useState(false);

  // ── Feature 2: Wire hover → + badge ────────────────────────────────────────
  const [hoveredWire, setHoveredWire] = useState<{
    fromNodeId: string; fromOutputKey: string;
    toNodeId: string; toInputKey: string;
    fromType: string; toType: string;
    midX: number; midY: number;
  } | null>(null);
  const [wireInsertOpen, setWireInsertOpen] = useState(false);

  // ── Feature 3: Box/marquee select ──────────────────────────────────────────
  const [boxSelect, setBoxSelect] = useState<{
    startX: number; startY: number; curX: number; curY: number;
  } | null>(null);
  // Ref keeps latest boxSelect for window-level event handlers (avoids stale closures)
  const boxSelectRef = useRef(boxSelect);
  boxSelectRef.current = boxSelect;

  // Wire badge: prevent badge from vanishing when mouse moves from stroke to badge
  const wireLeaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const canvasRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!canvasRef.current) return;
    const ro = new ResizeObserver(entries => {
      const { width: w, height: h } = entries[0].contentRect;
      if (w > 0) setCanvasWidth(w);
      if (h > 0) setCanvasHeight(h);
    });
    ro.observe(canvasRef.current);
    return () => ro.disconnect();
  }, []);

  // Wires the app removed itself (a group output changed type) → a toast with Undo
  useEffect(() => {
    if (!disconnectedNotice) return;
    toast.warning('Connections removed', {
      message: `${disconnectedNotice}. They no longer fit the new type.`,
      action: { label: 'Undo', onClick: () => useNodeGraphStore.getState().undo() },
    });
    clearDisconnectedNotice();
  }, [disconnectedNotice, clearDisconnectedNotice]);

  // ── Minimap toggle (persisted) ──────────────────────────────────────────────
  const [showOutline, setShowOutline] = useState(() => {
    try { return localStorage.getItem('shader-studio:settings:outline') === '1'; } catch { return false; }
  });
  const toggleOutline = () => setShowOutline(v => {
    try { localStorage.setItem('shader-studio:settings:outline', v ? '0' : '1'); } catch { /* preference only */ }
    return !v;
  });
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
  // `pan` / `zoom` state is what React renders with (grid, zoom readout,
  // culling). During a gesture the transform is applied to the DOM directly
  // through applyView() and the refs are the live truth; the state commit is
  // throttled so a pan doesn't re-render the graph on every mousemove.
  const [zoom, setZoom] = useState(1);
  const [pan,  setPan]  = useState({ x: 0, y: 0 });
  const zoomRef = useRef(zoom);
  const panRef  = useRef(pan);
  const worldRef = useRef<HTMLDivElement>(null);
  const viewCommitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const commitView = useCallback(() => {
    if (viewCommitTimer.current) { clearTimeout(viewCommitTimer.current); viewCommitTimer.current = null; }
    const p = panRef.current, z = zoomRef.current;
    setPan(prev => (prev.x === p.x && prev.y === p.y) ? prev : p);
    setZoom(z);
  }, []);
  const applyView = useCallback((p: Pt, z: number, commit: 'now' | 'throttle') => {
    panRef.current = p;
    zoomRef.current = z;
    if (worldRef.current) worldRef.current.style.transform = `translate(${p.x}px, ${p.y}px) scale(${z})`;
    const c = canvasRef.current;
    if (c && !transparent) {
      const g = 24 * z;
      c.style.backgroundSize = `${g}px ${g}px`;
      c.style.backgroundPosition = `${p.x % g}px ${p.y % g}px`;
    }
    publishView(p, z);
    if (commit === 'now') commitView();
    else if (!viewCommitTimer.current) viewCommitTimer.current = setTimeout(commitView, VIEW_COMMIT_MS);
  }, [commitView, transparent]);
  useEffect(() => {
    // The layout registry converts screen measurements to world units with the live zoom.
    setLayoutZoomGetter(() => zoomRef.current);
    publishView(panRef.current, zoomRef.current);
  }, []);

  // Toolbar zoom buttons zoom around the middle of the visible canvas (the wheel zooms around the cursor).
  const zoomAroundCentre = useCallback((target: number) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    const oldZoom = zoomRef.current;
    const newZoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, target));
    const p = panRef.current;
    if (!rect) { applyView(p, newZoom, 'now'); return; }
    const cx = rect.width / 2, cy = rect.height / 2;
    applyView({ x: cx - (cx - p.x) * (newZoom / oldZoom), y: cy - (cy - p.y) * (newZoom / oldZoom) }, newZoom, 'now');
  }, [applyView]);

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
          if (!lockedRef.current) setSearchPaletteOpen(true);
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
        if (ids.length >= 2 && !lockedRef.current) {
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

  // ── Keep the browser's own wheel gestures off the canvas ──────────────────
  // Pinch / ctrl+wheel would zoom the page, and a sideways two-finger pan would trigger swipe-back
  // navigation (leaving the app). The canvas pans itself (handleWheel), so it cancels the default,
  // except inside something that scrolls sideways on its own (a code block on a card).
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const scrollsSideways = (target: EventTarget | null) => {
      for (let n = target as HTMLElement | null; n && n !== el; n = n.parentElement) {
        if (n.scrollWidth > n.clientWidth && /auto|scroll/.test(getComputedStyle(n).overflowX)) return true;
      }
      return false;
    };
    const prevent = (e: WheelEvent) => {
      if (e.ctrlKey) { e.preventDefault(); return; }
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY) && !scrollsSideways(e.target)) e.preventDefault();
    };
    el.addEventListener('wheel', prevent, { passive: false });
    return () => el.removeEventListener('wheel', prevent);
  }, []);

  // ── Non-passive touchmove: must be a native listener so preventDefault works ──
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const onTouchMove = (e: TouchEvent) => {
      e.preventDefault();
      if (e.touches.length === 1 && touchPanStart.current) {
        const t = e.touches[0];
        applyView({
          x: touchPanOrigin.current.x + (t.clientX - touchPanStart.current.x),
          y: touchPanOrigin.current.y + (t.clientY - touchPanStart.current.y),
        }, zoomRef.current, 'throttle');
      }
    };
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    return () => el.removeEventListener('touchmove', onTouchMove);
  }, [applyView]);

  // ── Shift key tracking for socket spotlight ──────────────────────────────
  useEffect(() => {
    const onDown = (e: KeyboardEvent) => { if (e.key === 'Shift') setShiftHeld(true); };
    const onUp   = (e: KeyboardEvent) => { if (e.key === 'Shift') setShiftHeld(false); };
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    return () => { window.removeEventListener('keydown', onDown); window.removeEventListener('keyup', onUp); };
  }, []);

  // ── Wheel / trackpad handler (Ableton-style) ─────────────────────────────
  // • Two-finger scroll (no ctrl) → pan X + Y
  // • Pinch gesture / ctrl+wheel  → zoom toward cursor
  // React's wheel listener is passive, so this can't cancel anything; the native listener above does.
  const handleWheel = useCallback((e: React.WheelEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // A pop-up opened from a card is portalled out of the canvas, but React still
    // bubbles its events here: only wheel over the canvas itself pans or zooms.
    if (!canvas.contains(e.target as Node)) return;

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
      applyView({
        x: mx - (mx - oldPan.x) * (newZoom / oldZoom),
        y: my - (my - oldPan.y) * (newZoom / oldZoom),
      }, newZoom, 'throttle');
    } else {
      // Two-finger scroll → pan (translate directly in screen space)
      const oldPan = panRef.current;
      applyView({
        x: oldPan.x - e.deltaX,
        y: oldPan.y - e.deltaY,
      }, zoomRef.current, 'throttle');
    }
  }, [applyView]);

  // ── Canvas mouse down — pan on middle-click, space+drag, or option+drag; box select otherwise ──
  const handleCanvasMouseDown = useCallback((e: React.MouseEvent) => {
    if (!canvasRef.current?.contains(e.target as Node)) return; // from a portalled pop-up
    const isMiddle    = e.button === 1;
    const isSpaceDrag = spaceDown.current  && e.button === 0;
    const isOptionDrag = optionDown.current && e.button === 0;
    if (isMiddle || isSpaceDrag || isOptionDrag) {
      e.preventDefault();
      isPanning.current  = true;
      panStart.current   = { x: e.clientX, y: e.clientY };
      panOrigin.current  = { ...panRef.current };
      if (canvasRef.current) canvasRef.current.style.cursor = 'grabbing';
      document.body.style.userSelect = 'none';
      (document.body.style as CSSStyleDeclaration & { webkitUserSelect: string }).webkitUserSelect = 'none';

      const onMove = (ev: MouseEvent) => {
        if (!isPanning.current) return;
        applyView({
          x: panOrigin.current.x + (ev.clientX - panStart.current.x),
          y: panOrigin.current.y + (ev.clientY - panStart.current.y),
        }, zoomRef.current, 'throttle');
      };
      const onUp = () => {
        isPanning.current = false;
        applyView(panRef.current, zoomRef.current, 'now');
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
      return;
    }

    // Feature 3: box select — left button on bare canvas (not a node/socket)
    if (e.button === 0) {
      const target = e.target as HTMLElement;
      const onNode   = !!target.closest('[data-node-id]');
      const onSocket = !!target.closest('[data-socket]');
      if (!onNode && !onSocket) {
        deselectAll();
        const startX = e.clientX, startY = e.clientY;
        setBoxSelect({ startX, startY, curX: startX, curY: startY });

        // Use window-level listeners so drag + release outside the canvas still works
        const onMove = (mv: MouseEvent) => {
          setBoxSelect(prev => prev ? { ...prev, curX: mv.clientX, curY: mv.clientY } : null);
        };
        const onUp = () => {
          window.removeEventListener('mousemove', onMove);
          window.removeEventListener('mouseup', onUp);
          const bs = boxSelectRef.current;
          setBoxSelect(null);
          if (!bs) return;
          const rectLeft   = Math.min(bs.startX, bs.curX);
          const rectTop    = Math.min(bs.startY, bs.curY);
          const rectRight  = Math.max(bs.startX, bs.curX);
          const rectBottom = Math.max(bs.startY, bs.curY);
          if (rectRight - rectLeft < 4 && rectBottom - rectTop < 4) return;
          document.querySelectorAll<HTMLElement>('[data-node-id]').forEach(el => {
            const id = el.dataset.nodeId;
            if (!id || id === '__group_output__' || id === '__group_input__') return;
            const r = el.getBoundingClientRect();
            if (r.left < rectRight && r.right > rectLeft && r.top < rectBottom && r.bottom > rectTop) {
              useNodeGraphStore.getState().selectNode(id, true);
            }
          });
        };
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
      }
    }
  }, [deselectAll, applyView]);

  // ── Connection drag ─────────────────────────────────────────────────────────
  // A press on an output socket, to tell a click (→ Smart connect) from a drag (→ wire)
  const socketPressRef = useRef<{ nodeId: string; key: string; x: number; y: number; t: number } | null>(null);
  const [smartConnect, setSmartConnect] = useState<{ nodeId: string; key: string; dir: 'in' | 'out'; x: number; y: number; justAdded?: boolean } | null>(null);
  const dragRafRef = useRef<number | null>(null);

  const [dragConnection, setDragConnection] = useState<{
    sourceNodeId: string;
    sourceOutputKey: string;
    fromPos: { x: number; y: number };   // world space
    mousePos: { x: number; y: number };  // world space
  } | null>(null);

  const draggingType = React.useMemo<import('../../types/nodeGraph').DataType | null>(() => {
    if (!dragConnection) return null;
    // Synthetic Group Input terminal
    if (dragConnection.sourceNodeId === '__group_input__' && activeSubgraph) {
      return (activeSubgraph.inputPorts ?? []).find(p => p.key === dragConnection.sourceOutputKey)?.type ?? null;
    }
    const srcNode = displayNodes.find(n => n.id === dragConnection.sourceNodeId);
    if (!srcNode) return null;
    const srcDef = getNodeDefinitionFor(srcNode);
    return (srcNode.outputs[dragConnection.sourceOutputKey]?.type ??
      srcDef?.outputs[dragConnection.sourceOutputKey]?.type ?? null) as import('../../types/nodeGraph').DataType | null;
  }, [dragConnection, displayNodes, activeSubgraph]);

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

  // The handlers below are passed to every (memoised) NodeComponent, so they
  // read changing values through refs and keep a stable identity.
  const displayNodesRef = useRef(displayNodes);
  displayNodesRef.current = displayNodes;
  const pendingMobileConnectionRef = useRef(pendingMobileConnection);
  pendingMobileConnectionRef.current = pendingMobileConnection;
  const groupOutputTerminalPosRef = useRef(groupOutputTerminalPos);
  groupOutputTerminalPosRef.current = groupOutputTerminalPos;
  const groupInputTerminalPosRef = useRef(groupInputTerminalPos);
  groupInputTerminalPosRef.current = groupInputTerminalPos;

  /** World-space centre of a socket: card position (live if dragging) + measured offset. */
  const socketWorld = useCallback((nodeId: string, dir: 'in' | 'out', key: string): Pt | null => {
    const n = displayNodesRef.current.find(nd => nd.id === nodeId);
    const p = getDragPosition(nodeId) ?? n?.position
      ?? (nodeId === '__group_output__' ? groupOutputTerminalPosRef.current
        : nodeId === '__group_input__' ? groupInputTerminalPosRef.current : null);
    const o = getSocketOffset(nodeId, dir, key);
    if (!p || !o) return null;
    return { x: p.x + o.x, y: p.y + o.y };
  }, []);

  const handleTapOutputSocket = useCallback((nodeId: string, outputKey: string) => {
    const pending = pendingMobileConnectionRef.current;
    // Tapping same source again cancels
    if (pending?.sourceNodeId === nodeId && pending?.sourceOutputKey === outputKey) {
      setPendingMobileConnection(null);
      return;
    }
    let fromPos = socketWorld(nodeId, 'out', outputKey);
    if (!fromPos) {
      const nd = displayNodesRef.current.find(n => n.id === nodeId);
      if (!nd) return;
      fromPos = { x: nd.position.x + NODE_WIDTH, y: nd.position.y + 80 };
    }
    setPendingMobileConnection({ sourceNodeId: nodeId, sourceOutputKey: outputKey, fromPos });
  }, [socketWorld]);

  const handleTapInputSocket = useCallback((targetNodeId: string, targetInputKey: string) => {
    const pending = pendingMobileConnectionRef.current;
    if (!pending) return;
    const groupId = useNodeGraphStore.getState().activeGroupId;
    if (targetNodeId === '__group_output__' && groupId) {
      setGroupOutput(groupId, targetInputKey, pending.sourceNodeId, pending.sourceOutputKey);
    } else {
      connectNodes(pending.sourceNodeId, pending.sourceOutputKey, targetNodeId, targetInputKey);
    }
    setPendingMobileConnection(null);
  }, [connectNodes, setGroupOutput]);

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

  const handleStartConnection = useCallback((
    nodeId: string,
    outputKey: string,
    event: React.MouseEvent
  ) => {
    event.stopPropagation();
    if (event.button !== 0) return; // only the left button starts a wire (or a Smart connect click)
    let fromPos = socketWorld(nodeId, 'out', outputKey);
    if (!fromPos) {
      const node = displayNodesRef.current.find(n => n.id === nodeId);
      if (!node) return;
      fromPos = { x: node.position.x + NODE_WIDTH, y: node.position.y + 80 };
    }
    setDragConnection({
      sourceNodeId:    nodeId,
      sourceOutputKey: outputKey,
      fromPos,
      mousePos: screenToWorld(event.clientX, event.clientY),
    });
    socketPressRef.current = { nodeId, key: outputKey, x: event.clientX, y: event.clientY, t: performance.now() };
  }, [socketWorld, screenToWorld]);

  const handleMouseMove = (event: React.MouseEvent) => {
    if (boxSelect) {
      setBoxSelect(prev => prev ? { ...prev, curX: event.clientX, curY: event.clientY } : null);
    }
    if (!dragConnection) return;
    const x = event.clientX;
    const y = event.clientY;
    if (dragRafRef.current !== null) return; // skip if a frame is already queued
    dragRafRef.current = requestAnimationFrame(() => {
      dragRafRef.current = null;
      setDragConnection(prev => prev ? { ...prev, mousePos: screenToWorld(x, y) } : null);
    });
  };

  const dragConnectionRef = useRef(dragConnection);
  dragConnectionRef.current = dragConnection;
  const handleEndConnection = useCallback((targetNodeId: string, targetInputKey: string) => {
    const dc = dragConnectionRef.current;
    if (!dc) return;
    const groupId = useNodeGraphStore.getState().activeGroupId;
    if (targetNodeId === '__group_output__' && groupId) {
      setGroupOutput(groupId, targetInputKey, dc.sourceNodeId, dc.sourceOutputKey);
    } else if (dc.sourceNodeId === '__group_input__' && groupId) {
      rerouteGroupInput(groupId, dc.sourceOutputKey, targetNodeId, targetInputKey);
    } else {
      connectNodes(dc.sourceNodeId, dc.sourceOutputKey, targetNodeId, targetInputKey);
    }
    setDragConnection(null);
  }, [setGroupOutput, rerouteGroupInput, connectNodes]);

  // Wire hover → badge. WireLayer reports the wire's world midpoint; convert
  // to screen here with the live view so the badge lands on the wire even
  // mid-gesture.
  const handleEdgeEnter = useCallback((edge: EdgeInfo, mid: Pt) => {
    if (wireLeaveTimerRef.current) { clearTimeout(wireLeaveTimerRef.current); wireLeaveTimerRef.current = null; }
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    setHoveredWire({
      ...edge,
      midX: mid.x * zoomRef.current + panRef.current.x + rect.left,
      midY: mid.y * zoomRef.current + panRef.current.y + rect.top,
    });
  }, []);
  const handleEdgeLeave = useCallback(() => {
    wireLeaveTimerRef.current = setTimeout(() => setHoveredWire(null), 120);
  }, []);

  const handleMinimapPanTo = useCallback((worldX: number, worldY: number) => {
    const c = canvasRef.current;
    const vw = c?.clientWidth  ?? 800;
    const vh = c?.clientHeight ?? 600;
    const z = zoomRef.current;
    applyView({ x: -worldX * z + vw / 2, y: -worldY * z + vh / 2 }, z, 'now');
  }, [applyView]);

  // Centre on a node picked from a group card (store.revealNode) once it is in the displayed level
  const focusRequest = useNodeGraphStore(s => s.focusRequest);
  useEffect(() => {
    if (!focusRequest) return;
    const target = displayNodes.find(n => n.id === focusRequest.nodeId);
    if (!target) return;
    const size = getCardSize(target.id) ?? { w: 360, h: 200 };
    handleMinimapPanTo(target.position.x + size.w / 2, target.position.y + size.h / 2);
    useNodeGraphStore.getState().clearFocusRequest();
  }, [focusRequest, displayNodes, handleMinimapPanTo]);

  const handleMouseUp = (e: React.MouseEvent) => {
    if (dragRafRef.current !== null) {
      cancelAnimationFrame(dragRafRef.current);
      dragRafRef.current = null;
    }
    // A press on an output that didn't travel is a click: offer Smart connect instead of a wire
    const press = socketPressRef.current;
    socketPressRef.current = null;
    if (press && !press.nodeId.startsWith('__')
      && Math.hypot(e.clientX - press.x, e.clientY - press.y) < 4 && performance.now() - press.t < 600) {
      // A second click is a double-click (which removes the output's wires), not a request for suggestions
      if (e.detail >= 2) setSmartConnect(null);
      else setSmartConnect({ nodeId: press.nodeId, key: press.key, dir: 'out', x: press.x, y: press.y });
    }
    setDragConnection(null);
  };

  // ── Smart connect ───────────────────────────────────────────────────────────
  // Click a socket → the three most likely places to wire it (see smartConnect.ts).
  const [ghostSuggestion, setGhostSuggestion] = useState<Suggestion | null>(null);
  const handleSuggestSocket = useCallback((nodeId: string, key: string, dir: 'in' | 'out', x: number, y: number) => {
    setSmartConnect({ nodeId, key, dir, x, y });
  }, []);
  const smartSuggestions = useMemo(() => {
    if (!smartConnect) return [];
    return suggestConnections({
      nodes: displayNodes,
      from: smartConnect,
      socketPos: socketWorld,
      labelOf: n => (typeof n.params?.label === 'string' && n.params.label) || getNodeDefinitionFor(n)?.label || n.type,
    });
  }, [smartConnect, displayNodes, socketWorld]);
  // New nodes worth adding and wiring straight to the clicked socket (see quickAdds.ts)
  const smartQuickAdds = useMemo(() => {
    if (!smartConnect) return [];
    const origin = displayNodes.find(n => n.id === smartConnect.nodeId);
    const sock = smartConnect.dir === 'out' ? origin?.outputs[smartConnect.key] : origin?.inputs[smartConnect.key];
    if (!sock) return [];
    return suggestQuickAdds({ type: sock.type, dir: smartConnect.dir, label: sock.label, key: smartConnect.key });
  }, [smartConnect, displayNodes]);
  const closeSmartConnect = useCallback(() => { setSmartConnect(null); setGhostSuggestion(null); }, []);
  const pickQuickAdd = useCallback((q: QuickAdd) => {
    if (!smartConnect) return;
    const origin = displayNodesRef.current.find(n => n.id === smartConnect.nodeId);
    if (!origin) return;
    // Beside the origin on the side data comes from, level with the clicked socket
    const sockY = socketWorld(origin.id, smartConnect.dir, smartConnect.key)?.y;
    const pos = {
      x: smartConnect.dir === 'in' ? origin.position.x - NODE_WIDTH - 90 : origin.position.x + NODE_WIDTH + 90,
      y: sockY !== undefined ? sockY - 60 : origin.position.y,
    };
    const newId = addNode(q.type, pos);
    if (newId) {
      if (smartConnect.dir === 'in') connectNodes(newId, q.key, smartConnect.nodeId, smartConnect.key);
      else connectNodes(smartConnect.nodeId, smartConnect.key, newId, q.key);
      useNodeGraphStore.getState().setSelectedNodeId(newId);
    }
    closeSmartConnect();
  }, [smartConnect, addNode, connectNodes, socketWorld, closeSmartConnect]);
  // Add-then-wire: a node just added from search gets Smart connect on its first output, once
  // its socket has been measured, and only when there is something to suggest.
  const smartConnectRequest = useNodeGraphStore(s => s.smartConnectRequest);
  useEffect(() => {
    if (!smartConnectRequest) return;
    const { nodeId, at } = smartConnectRequest;
    let tries = 0;
    let raf = 0;
    const attempt = () => {
      if (Date.now() - at > 2000) { useNodeGraphStore.getState().requestSmartConnect(null); return; }
      const node = displayNodesRef.current.find(n => n.id === nodeId);
      const key = node ? Object.keys(node.outputs)[0] : undefined;
      const pos = node && key ? socketWorld(node.id, 'out', key) : null;
      if (!pos || !node || !key) { if (tries++ < 30) raf = requestAnimationFrame(attempt); return; }
      useNodeGraphStore.getState().requestSmartConnect(null);
      // Select the node that was just added. New nodes land in the middle of the view, so the view
      // stays put; it only moves when the node is somehow off screen (you'd lose it otherwise).
      useNodeGraphStore.getState().setSelectedNodeId(nodeId);
      const size = getCardSize(nodeId) ?? { w: 360, h: 200 };
      const view = canvasRef.current?.getBoundingClientRect();
      if (view) {
        const z = zoomRef.current, pan = panRef.current;
        const left = node.position.x * z + pan.x, top = node.position.y * z + pan.y;
        const onScreen = left + size.w * z > 0 && top + size.h * z > 0 && left < view.width && top < view.height;
        if (!onScreen) handleMinimapPanTo(node.position.x + size.w / 2, node.position.y + size.h / 2);
      }
      const suggestions = suggestConnections({
        nodes: displayNodesRef.current, from: { nodeId, key, dir: 'out' }, socketPos: socketWorld,
        labelOf: n => (typeof n.params?.label === 'string' && n.params.label) || getNodeDefinitionFor(n)?.label || n.type,
      });
      const rect = canvasRef.current?.getBoundingClientRect();
      if (suggestions.length === 0 || !rect) return;
      setSmartConnect({
        nodeId, key, dir: 'out', justAdded: true,
        x: rect.left + pos.x * zoomRef.current + panRef.current.x,
        y: rect.top + pos.y * zoomRef.current + panRef.current.y,
      });
    };
    raf = requestAnimationFrame(attempt);
    return () => cancelAnimationFrame(raf);
  }, [smartConnectRequest, socketWorld, handleMinimapPanTo]);
  const pickSuggestion = useCallback((s: Suggestion) => {
    if (!smartConnect) return;
    if (smartConnect.dir === 'out') connectNodes(smartConnect.nodeId, smartConnect.key, s.nodeId, s.key);
    else connectNodes(s.nodeId, s.key, smartConnect.nodeId, smartConnect.key);
    closeSmartConnect();
  }, [smartConnect, connectNodes, closeSmartConnect]);
  const ghostWire = useMemo(() => {
    if (!smartConnect || !ghostSuggestion) return null;
    const here = socketWorld(smartConnect.nodeId, smartConnect.dir, smartConnect.key);
    const there = socketWorld(ghostSuggestion.nodeId, smartConnect.dir === 'out' ? 'in' : 'out', ghostSuggestion.key);
    if (!here || !there) return null;
    return smartConnect.dir === 'out' ? { from: here, to: there, type: ghostSuggestion.type } : { from: there, to: here, type: ghostSuggestion.type };
  }, [smartConnect, ghostSuggestion, socketWorld]);

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

const handleCanvasTouchEnd = useCallback((e: React.TouchEvent) => {
    // If the touch ended on the raw canvas background (not a node/socket), cancel pending
    const target = e.target as HTMLElement;
    if (!target.closest('[data-node-id]') && !target.closest('[data-socket]')) {
      setPendingMobileConnection(null);
    }
    if (touchPanStart.current) applyView(panRef.current, zoomRef.current, 'now');
    touchPanStart.current = null;
  }, [applyView]);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    // Ctrl+click on Mac triggers contextmenu — suppress the menu, only handle right-click
    if (e.ctrlKey || lockedRef.current) return;
    const target = e.target as HTMLElement;
    const nodeEl = target.closest('[data-node-id]') as HTMLElement | null;
    const nodeId = nodeEl?.dataset.nodeId ?? null;
    // On empty canvas the menu only has "Group selection" — with fewer than two nodes
    // selected there is nothing to show, so don't open an empty strip.
    if (!nodeId && useNodeGraphStore.getState().selectedNodeIds.length < 2) { setContextMenu(null); return; }
    // On a slider or colour row, the menu starts with making it a Play control.
    const paramKey = nodeId ? (target.closest('[data-param-key]') as HTMLElement | null)?.dataset.paramKey : undefined;
    setContextMenu({ x: e.clientX, y: e.clientY, nodeId, paramKey });
  }, []);

  // ── Feature 1: Alt-click socket handler ─────────────────────────────────────
  const handleAltClickSocket = useCallback((
    nodeId: string, key: string, dir: 'in' | 'out', type: string, e: React.MouseEvent
  ) => {
    e.stopPropagation();
    setPendingSocket({ nodeId, key, dir, type, screenX: e.clientX, screenY: e.clientY });
  }, []);

  const handleAltSocketNodePlaced = useCallback((newNodeId: string) => {
    if (!pendingSocket) return;
    const newNode = useNodeGraphStore.getState().nodes.find(n => n.id === newNodeId)
      ?? (() => {
        // also check subgraph nodes
        const { activeGroupPath } = useNodeGraphStore.getState();
        return getActiveNodes(useNodeGraphStore.getState().nodes, activeGroupPath)?.find(n => n.id === newNodeId);
      })();
    if (!newNode) return;
    const newDef = getNodeDefinitionFor(newNode);
    if (!newDef) return;

    if (pendingSocket.dir === 'in') {
      // new node → pendingSocket node
      const firstOutputKey = Object.keys(newNode.outputs)[0];
      if (firstOutputKey) {
        connectNodes(newNodeId, firstOutputKey, pendingSocket.nodeId, pendingSocket.key);
      }
    } else {
      // pendingSocket node → new node
      const firstInputKey = Object.keys(newNode.inputs)[0];
      if (firstInputKey) {
        connectNodes(pendingSocket.nodeId, pendingSocket.key, newNodeId, firstInputKey);
      }
    }
    setPendingSocket(null);
  }, [pendingSocket, connectNodes]);

  // ── Fit to screen helper ────────────────────────────────────────────────────
  const handleFitView = useCallback(() => {
    if (!displayNodes.length || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const pad = 60;
    const minX = Math.min(...displayNodes.map(n => n.position.x)) - pad;
    const minY = Math.min(...displayNodes.map(n => n.position.y)) - pad;
    const maxX = Math.max(...displayNodes.map(n => n.position.x + NODE_WIDTH)) + pad;
    const maxY = Math.max(...displayNodes.map(n => n.position.y + 200)) + pad;
    const cw = canvas.clientWidth;
    const ch = canvas.clientHeight;
    const newZoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN,
      Math.min(cw / (maxX - minX), ch / (maxY - minY))
    ));
    applyView({
      x: (cw - (maxX + minX) * newZoom) / 2,
      y: (ch - (maxY + minY) * newZoom) / 2,
    }, newZoom, 'now');
  }, [displayNodes, applyView]);

  // A focus request (a Play control's "go to source"): centre on that node. The graph may
  // mount because of the request, so a pending one is handled on mount too.
  useEffect(() => {
    const centre = (id: string) => {
      const node = useNodeGraphStore.getState().nodes.find(n => n.id === id);
      const c = canvasRef.current;
      if (!node || !c) return;
      const z = Math.max(zoomRef.current, 0.8);
      applyView({ x: c.clientWidth / 2 - (node.position.x + NODE_WIDTH / 2) * z, y: c.clientHeight / 2 - (node.position.y + 80) * z }, z, 'now');
    };
    const pending = useNodeGraphStore.getState().focusNodeRequest;
    if (pending && pending.n !== handledFocus) { handledFocus = pending.n; requestAnimationFrame(() => centre(pending.id)); }
    return useNodeGraphStore.subscribe(s => {
      const r = s.focusNodeRequest;
      if (r && r.n !== handledFocus) { handledFocus = r.n; requestAnimationFrame(() => centre(r.id)); }
    });
  }, [applyView]);

  // Register fitView with the store so shortcuts / App.tsx can call it.
  // handleFitView is re-created whenever displayNodes changes (every drag
  // mousemove), and registerFitView is a store write, so registering it
  // directly meant one extra full-tree render per mousemove. Register a
  // stable trampoline once and keep the live callback in a ref.
  const handleFitViewRef = useRef(handleFitView);
  handleFitViewRef.current = handleFitView;
  useEffect(() => { registerFitView(() => handleFitViewRef.current()); }, [registerFitView]);
  useEffect(() => { registerSetView((p, z) => applyView(p, Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z)), 'now')); }, [registerSetView, applyView]);

  useEffect(() => {
    registerViewportCenterGetter(() => {
      const el = canvasRef.current;
      if (!el) return { x: 300, y: 200 };
      const rect = el.getBoundingClientRect();
      const cx = rect.width / 2;
      const cy = rect.height / 2;
      const z = zoomRef.current;
      const p = panRef.current ?? { x: 0, y: 0 };
      return { x: (cx - p.x) / z, y: (cy - p.y) / z };
    });
  }, [registerViewportCenterGetter]);

  // ── Shift+socket spotlight — which edges are highlighted ─────────────────────
  // Each entry is { fromNodeId, fromOutputKey, toNodeId, toInputKey }
  const spotSocket = dragConnection ? null : shiftHeld ? hoveredSocket : settledSocket;
  const spotlightEdges = React.useMemo<Set<string>>(() => {
    if (!spotSocket) return new Set();
    const { nodeId, key, dir } = spotSocket;
    const result = new Set<string>();
    for (const node of displayNodes) {
      for (const [inputKey, input] of Object.entries(node.inputs)) {
        if (!input.connection) continue;
        const edgeKey = `${input.connection.nodeId}:${input.connection.outputKey}→${node.id}:${inputKey}`;
        if (dir === 'out' && input.connection.nodeId === nodeId && input.connection.outputKey === key) result.add(edgeKey);
        if (dir === 'in'  && node.id === nodeId && inputKey === key) result.add(edgeKey);
      }
    }
    return result;
  }, [spotSocket, displayNodes]);
  // Without Shift, only a socket that actually has wires spotlights
  const spotlightOn = spotSocket !== null && (shiftHeld || spotlightEdges.size > 0);

  // ── Highlight filter — compute which node IDs match the current filter ───────
  const highlightedIds: Set<string> | null = React.useMemo(() => {
    // Socket spotlight takes priority over type filter
    if (spotlightOn && spotSocket) {
      const { nodeId, key, dir } = spotSocket;
      const lit = new Set<string>([nodeId]);
      for (const node of displayNodes) {
        for (const [inputKey, input] of Object.entries(node.inputs)) {
          if (!input.connection) continue;
          if (dir === 'out' && input.connection.nodeId === nodeId && input.connection.outputKey === key) lit.add(node.id);
          if (dir === 'in'  && node.id === nodeId && inputKey === key) lit.add(input.connection.nodeId);
        }
      }
      return lit;
    }
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
  }, [nodeHighlightFilter, nodes, spotlightOn, spotSocket, displayNodes]);

  // ── Viewport culling ─────────────────────────────────────────────────────
  // Cards fully outside the visible world rect (plus a margin) aren't mounted.
  // Their wires still draw: the layout registry keeps socket offsets after a
  // card unmounts — which is also why a card is never culled before it has
  // been mounted and measured once (a fresh graph renders everything on its
  // first frame, then culls as the sizes arrive). Selected / previewed /
  // dragging cards are always kept, and small graphs skip culling entirely.
  const selectedNodeId  = useNodeGraphStore(s => s.selectedNodeId);
  const selectedNodeIds = useNodeGraphStore(s => s.selectedNodeIds);
  const [cardSizeVersion, bumpCardSizes] = useState(0);
  useEffect(() => subscribeCardSizes(() => bumpCardSizes(v => v + 1)), []);
  const visibleNodes = useMemo(() => {
    void cardSizeVersion; // re-cull when card sizes become known / change
    if (displayNodes.length < CULL_MIN_NODES) return displayNodes;
    const margin = CULL_MARGIN_PX / zoom;
    const left   = -pan.x / zoom - margin;
    const top    = -pan.y / zoom - margin;
    const right  = (canvasWidth  - pan.x) / zoom + margin;
    const bottom = (canvasHeight - pan.y) / zoom + margin;
    return displayNodes.filter(n => {
      if (n.id === selectedNodeId || n.id === previewNodeId || selectedNodeIds.includes(n.id) || isDragging(n.id)) return true;
      const size = getCardSize(n.id);
      if (!size) return true; // never measured — mount once so its sockets get offsets
      const p = n.position;
      return p.x + size.w >= left && p.x <= right && p.y + size.h >= top && p.y <= bottom;
    });
  }, [displayNodes, pan, zoom, canvasWidth, canvasHeight, selectedNodeId, selectedNodeIds, previewNodeId, cardSizeVersion]);

  // Drop layout memory for nodes that left the graph.
  const knownIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const now = new Set(nodes.map(n => n.id));
    for (const id of knownIdsRef.current) if (!now.has(id)) forgetNodeLayout(id);
    knownIdsRef.current = now;
  }, [nodes]);

  // Dot grid background size scales with zoom
  // Dot grid: 24 world units apart, doubling when zoomed out so it never turns into a haze
  let gridSize = 24 * zoom;
  while (gridSize < 14) gridSize *= 2;
  const gridOffX = pan.x % gridSize;
  const gridOffY = pan.y % gridSize;

  return (
    <div
      ref={canvasRef}
      data-node-canvas="true"
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseDown={handleCanvasMouseDown}
      onWheel={handleWheel}
      onContextMenu={handleContextMenu}
      onClick={() => setContextMenu(null)}
      onTouchStart={handleCanvasTouchStart}
      onTouchEnd={handleCanvasTouchEnd}
      onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }}
      onDrop={e => {
        e.preventDefault();
        const type = e.dataTransfer.getData('application/shader-studio-node');
        if (type && !locked) {
          const worldPos = screenToWorld(e.clientX, e.clientY);
          addNode(type, worldPos);
        }
      }}
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        backgroundColor: transparent ? 'transparent' : tc.crust,
        overflow: 'hidden',
        cursor: 'default',
        userSelect: 'none',
        backgroundImage: transparent
          ? 'none'
          : `radial-gradient(circle at 1.5px 1.5px, ${tk.text.disabled} 1.1px, transparent 1.6px)`,
        backgroundSize: `${gridSize}px ${gridSize}px`,
        backgroundPosition: `${gridOffX}px ${gridOffY}px`,
      }}
    >
      {/* Preview mode banner — below the canvas toolbar */}
      {previewNodeId && previewLabel && (
        <div
          style={{
            position: 'absolute', top: redesignToolbar ? 66 : 10, left: '50%', transform: 'translateX(-50%)', zIndex: 20,
            minHeight: 34, display: 'flex', alignItems: 'center', gap: 8, padding: '4px 4px 4px 12px', borderRadius: 10, maxWidth: 560,
            background: tk.bg.panel, boxShadow: `${tk.shadow.float}, inset 0 0 0 1px ${alpha(tk.status.success, 0.35)}`,
            color: tk.text.secondary, fontSize: 12.5, userSelect: 'none',
          }}
        >
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: tk.status.success, flexShrink: 0 }} />
          <span style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
            <span style={{ whiteSpace: 'nowrap' }}>Previewing <strong style={{ color: tk.text.primary, fontWeight: 600 }}>{previewLabel}</strong></span>
            {previewCaption && <span style={{ fontSize: 11.5, color: tk.text.muted, lineHeight: 1.35 }}>{previewCaption}</span>}
          </span>
          <Button size="sm" variant="ghost" style={{ height: 26, flexShrink: 0 }} onClick={() => setPreviewNodeId(null)}>Exit</Button>
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
            border: `1px solid ${pendingMobileType ? ('#' + (pendingMobileType === 'float' ? 'f0a0aa' : pendingMobileType === 'vec2' ? '0af0f0' : pendingMobileType === 'vec3' ? '00fa80' : 'fa8000')) : tc.blue}55`,
            color: tc.text,
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
              border: `1px solid ${tc.surface1}`,
              color: tc.surface2,
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

      {redesignToolbar && (
        <CanvasToolbar
          nodes={displayNodes}
          topLevel={activeGroupPath.length === 0}
          groupName={activeGroupNode ? groupLabel(activeGroupNode) : undefined}
          zoom={zoom}
          onZoom={zoomAroundCentre}
          onResetZoom={() => applyView({ x: 0, y: 0 }, 1, 'now')}
          onFit={handleFitView}
          onAutoLayout={autoLayout}
          showMinimap={showMinimap}
          onToggleMinimap={toggleMinimap}
          showOutline={showOutline}
          onToggleOutline={toggleOutline}
          onClear={() => loadExampleGraph('blank')}
          onClearMinimal={() => useNodeGraphStore.getState().clearToMinimal()}
          compact={compactToolbar}
          readOnly={locked}
          onOptimize={() => setShowOptimize(true)}
        />
      )}
      {showOptimize && <OptimizeModal onClose={() => setShowOptimize(false)} />}
      {redesignToolbar && !locked && <SelectionBar top={previewNodeId ? 108 : 66} />}
      {redesignToolbar && showOutline && <GraphOutline nodes={displayNodes} top={previewNodeId ? 132 : 66} onClose={() => setShowOutline(false)} />}

      {/* Toolbar — top-right, always in screen space */}
      {!redesignToolbar && <div
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
            onClick={() => applyView({ x: 0, y: 0 }, 1, 'now')}
            title="Reset zoom to 100%"
            style={isTouchDevice.current ? touchToolbarBtnStyle : toolbarBtnStyle}
            onMouseEnter={e => ((e.currentTarget as HTMLButtonElement).style.background = tc.surface1)}
            onMouseLeave={e => ((e.currentTarget as HTMLButtonElement).style.background = tc.surface0)}
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
              onChange={e => applyView(panRef.current, Number(e.target.value) / 100, 'now')}
              title="Zoom level"
              style={{ width: '60px', accentColor: tc.blue, cursor: 'pointer' }}
            />
          )}
        </div>

        <button
          onClick={handleFitView}
          title="Fit all nodes in view"
          style={isTouchDevice.current ? touchToolbarBtnStyle : toolbarBtnStyle}
          onMouseEnter={e => ((e.currentTarget as HTMLButtonElement).style.background = tc.surface1)}
          onMouseLeave={e => ((e.currentTarget as HTMLButtonElement).style.background = tc.surface0)}
        >
          {compactToolbar ? '⊡' : '⊡ Fit'}
        </button>

        {!isTouchDevice.current && !compactToolbar && (
          <button
            onClick={autoLayout}
            title="Automatically arrange nodes left-to-right by data flow"
            style={toolbarBtnStyle}
            onMouseEnter={e => ((e.currentTarget as HTMLButtonElement).style.background = tc.surface1)}
            onMouseLeave={e => ((e.currentTarget as HTMLButtonElement).style.background = tc.surface0)}
          >
            ⊞ Auto Layout
          </button>
        )}

        {!isTouchDevice.current && !compactToolbar && (
          <button
            onClick={toggleMinimap}
            title={showMinimap ? 'Hide minimap' : 'Show minimap'}
            style={{ ...toolbarBtnStyle, opacity: showMinimap ? 1 : 0.45 }}
            onMouseEnter={e => ((e.currentTarget as HTMLButtonElement).style.background = tc.surface1)}
            onMouseLeave={e => ((e.currentTarget as HTMLButtonElement).style.background = tc.surface0)}
          >
            [M]
          </button>
        )}
      </div>}

      {/* Breadcrumb when inside a group */}
      {activeGroupPath.length > 0 && (
        <div style={{
          position: 'absolute', top: redesignToolbar ? 64 : 12, left: 12, zIndex: 20,
          height: 34, display: 'flex', alignItems: 'center', gap: 6, padding: '0 12px', borderRadius: 10,
          background: tk.bg.panel, boxShadow: tk.shadow.float, color: tk.accent.text, fontSize: 12.5,
          userSelect: 'none', whiteSpace: 'nowrap',
        }}>
          <button
            onClick={() => exitToRoot()}
            style={{ background: 'none', border: 'none', color: tk.text.muted, cursor: 'pointer', padding: 0, font: `500 12.5px ${fontFamily.ui}` }}
          >Root</button>
          {activeGroupPath.map((gid, depth) => {
            // Find the group node label
            let gn: import('../../types/nodeGraph').GraphNode | undefined;
            if (depth === 0) {
              gn = nodes.find(n => n.id === gid);
            } else {
              const outer = nodes.find(n => n.id === activeGroupPath[0]);
              const outerSg = outer?.params?.subgraph as import('../../types/nodeGraph').SubgraphData | undefined;
              gn = outerSg?.nodes.find(n => n.id === gid);
            }
            const defaultLbl = gn?.type === 'sceneGroup' ? 'Scene Group' : gn?.type === 'spaceWarpGroup' ? 'Space Warp Group' : gn?.type === 'marchLoopGroup' ? 'March Loop Group' : gn?.type === 'giLitMarchGroup' ? 'GI Lit March Group' : 'Group';
            const lbl = typeof gn?.params?.label === 'string' ? gn.params.label : defaultLbl;
            const isLast = depth === activeGroupPath.length - 1;
            return (
              <React.Fragment key={gid}>
                <span style={{ color: tk.text.faint }}>›</span>
                {isLast ? (
                  <strong>{lbl}</strong>
                ) : (
                  <button
                    onClick={() => exitToDepth(depth + 1)}
                    style={{ background: 'none', border: 'none', color: tk.text.muted, cursor: 'pointer', padding: 0, font: `500 12.5px ${fontFamily.ui}` }}
                  >{lbl}</button>
                )}
              </React.Fragment>
            );
          })}
          <span style={{ marginLeft: 6, font: `500 11px ${fontFamily.mono}`, color: tk.text.faint }}>esc to exit</span>
        </div>
      )}

      {/* Right-click context menu — rendered via portal so it's outside the transformed canvas tree */}
      {contextMenu && createPortal(
        <div
          {...portalGuard}
          onClick={e => e.stopPropagation()}
          style={{
            position: 'fixed', left: contextMenu.x, top: contextMenu.y,
            background: tc.base, border: `1px solid ${tc.surface1}`, borderRadius: '6px',
            padding: '4px 0', zIndex: 10000, boxShadow: '0 4px 16px rgba(0,0,0,0.6)',
            minWidth: '160px', fontSize: '12px',
          }}
        >
          {(() => {
            const clickedNode = contextMenu.nodeId ? displayNodes.find(n => n.id === contextMenu.nodeId) : null;
            const isGroup = clickedNode?.type === 'group';
            const isSceneGroup = clickedNode?.type === 'sceneGroup';
            const isSpaceWarpGroup = clickedNode?.type === 'spaceWarpGroup';
            const isMarchLoopGroup = clickedNode?.type === 'marchLoopGroup' || clickedNode?.type === 'giLitMarchGroup';
            const ids = useNodeGraphStore.getState().selectedNodeIds;
            const canGroup = ids.length >= 2 && activeGroupPath.length < 2;
            // Wires this node used to have (disconnected or replaced this session) that can come back.
            const pastWires = clickedNode ? useNodeGraphStore.getState().pastWiresFor(clickedNode.id, displayNodes) : [];
            const nameOf = (n: import('../../types/nodeGraph').GraphNode) => (typeof n.params.label === 'string' && n.params.label.trim()) || getNodeDefinitionFor(n)?.label || n.type;
            const describeWire = (w: (typeof pastWires)[number]) => {
              const from = displayNodes.find(n => n.id === w.fromNodeId)!;
              const to = displayNodes.find(n => n.id === w.toNodeId)!;
              const outLabel = from.outputs[w.fromOutputKey]?.label ?? getNodeDefinitionFor(from)?.outputs[w.fromOutputKey]?.label ?? w.fromOutputKey;
              const inLabel = to.inputs[w.toInputKey]?.label ?? getNodeDefinitionFor(to)?.inputs[w.toInputKey]?.label ?? w.toInputKey.replace(/^__param_/, '');
              // Name the other end; this node's own socket keeps just its label.
              return w.toNodeId === clickedNode!.id
                ? `${nameOf(from)} · ${outLabel}  →  ${inLabel}`
                : `${outLabel}  →  ${nameOf(to)} · ${inLabel}`;
            };
            // The right-clicked slider as a Play control: one step, from here.
            const playParam = (() => {
              if (!contextMenu.nodeId || !contextMenu.paramKey) return null;
              const st = useNodeGraphStore.getState();
              const candidates = collectPlayCandidates(st.nodes, st.paramBindings);
              const c = candidateFor(candidates, contextMenu.nodeId, contextMenu.paramKey);
              // A slider a wire has taken over: offer the free sliders on the node the wire comes from.
              const here = displayNodes.find(n => n.id === contextMenu.nodeId);
              const up = !c && here && !contextMenu.paramKey.includes('::') ? upstreamControls(st.nodes, candidates, here, contextMenu.paramKey) : null;
              return { c, candidates, up, taken: !!c && st.play.controls.some(x => x.target === c.target) };
            })();
            const openPlay = { label: 'Open Play', onClick: () => useNodeGraphStore.setState(s => ({ playOpenRequest: s.playOpenRequest + 1 })) };
            return (
              <>
                {playParam && (
                  <>
                    <div style={{ padding: '4px 12px 2px', fontSize: '10px', letterSpacing: 0.6, textTransform: 'uppercase', color: tc.surface2 }}>Play</div>
                    {playParam.up ? (
                      <>
                        <div style={{ padding: '4px 12px 6px', fontSize: '11px', color: tc.surface2, maxWidth: 260, lineHeight: 1.4 }}>
                          Set by <b>{playParam.up.sourceLabel}</b> through the wire into {playParam.up.driver.socketLabel}, so this slider isn’t free.
                          {playParam.up.candidates.length > 0 ? ' The free sliders are there:' : playParam.up.blockedBy
                            ? ` Its ${playParam.up.blockedBy.param} is wired too, from ${playParam.up.blockedBy.from}: no free slider one step up.`
                            : ' It has no free sliders of its own.'}
                        </div>
                        {playParam.up.candidates.slice(0, 6).map(uc => {
                          const already = useNodeGraphStore.getState().play.controls.some(x => x.target === uc.target);
                          return (
                            <button key={uc.target} style={{ ...ctxBtnStyle, opacity: already ? 0.5 : 1 }} disabled={already}
                              title={already ? 'Already on the Play panel' : `A Play control for ${candidateLabel(uc)}`}
                              onClick={() => {
                                useNodeGraphStore.getState().setPlay(p => addCandidateControl(p, uc));
                                toast.success(`“${candidateLabel(uc)}” is a Play control`, { action: openPlay });
                                setContextMenu(null);
                              }}>
                              {already ? `Already a control: ${uc.paramLabel}` : `Add Play control from ${playParam.up!.sourceLabel} › ${uc.paramLabel}`}
                            </button>
                          );
                        })}
                        {playParam.up.source && (
                          <button style={ctxBtnStyle} onClick={() => { useNodeGraphStore.getState().revealNode([], playParam.up!.source!.id); setContextMenu(null); }}>
                            Go to {playParam.up.sourceLabel}
                          </button>
                        )}
                      </>
                    ) : !playParam.c ? (
                      <div style={{ padding: '4px 12px 6px', fontSize: '11px', color: tc.surface2, maxWidth: 240 }}>This param is baked into the shader, so it can't be a Play control.</div>
                    ) : (
                      <>
                        {playParam.taken ? (
                          <button style={ctxBtnStyle}
                            title="Take it off the Play panel, with the mappings that drive it: the slider here is in charge again"
                            onClick={() => {
                              const c = playParam.c!;
                              const st = useNodeGraphStore.getState();
                              const control = st.play.controls.find(x => x.target === c.target);
                              if (control) st.setPlay(p => removeFromPlay(p, control.id));
                              toast.success(`“${control?.label ?? candidateLabel(c)}” is off the Play panel`, { message: 'Its mappings went with it.' });
                              setContextMenu(null);
                            }}>
                            Remove from Play controls
                          </button>
                        ) : (
                          <button style={ctxBtnStyle}
                            title="A slider on the Play panel that MIDI, keys, the mouse and more can drive"
                            onClick={() => {
                              const c = playParam.c!;
                              useNodeGraphStore.getState().setPlay(p => addCandidateControl(p, c));
                              toast.success(`“${candidateLabel(c)}” is a Play control`, { action: openPlay });
                              setContextMenu(null);
                            }}>
                            Add to Play controls
                          </button>
                        )}
                        {playParam.c.kind === 'float' && (
                          <button style={ctxBtnStyle}
                            title="A Play control, and a null on the picture that drives it (X and Y together for a position)"
                            onClick={() => {
                              const { drives, label } = graphNullDrives(playParam.candidates, playParam.c!);
                              useNodeGraphStore.getState().setPlay(p => driveWithNull(p, drives, label).play);
                              toast.success(`Added “${label}”`, { message: 'In Play, drag the dot on the picture to change the value.', action: openPlay });
                              setContextMenu(null);
                            }}>
                            Drive with a null in Play
                          </button>
                        )}
                      </>
                    )}
                    <div style={{ borderTop: `1px solid ${tc.surface0}`, margin: '4px 0' }} />
                  </>
                )}
                {pastWires.length > 0 && (
                  <>
                    <div style={{ padding: '4px 12px 2px', fontSize: '10px', letterSpacing: 0.6, textTransform: 'uppercase', color: tc.surface2 }}>Reconnect</div>
                    {pastWires.slice(0, 6).map(w => (
                      <button key={`${w.fromNodeId}.${w.fromOutputKey}>${w.toNodeId}.${w.toInputKey}`} style={ctxBtnStyle}
                        title="Put this wire back the way it was"
                        onClick={() => { connectNodes(w.fromNodeId, w.fromOutputKey, w.toNodeId, w.toInputKey); setContextMenu(null); }}>
                        ↩ {describeWire(w)}
                      </button>
                    ))}
                    {pastWires.length > 6 && <div style={{ padding: '2px 12px 4px', fontSize: '10.5px', color: tc.surface2 }}>+{pastWires.length - 6} older</div>}
                    <div style={{ borderTop: `1px solid ${tc.surface0}`, margin: '4px 0' }} />
                  </>
                )}
                {canGroup && (
                  <>
                    <button style={ctxBtnStyle} onClick={() => {
                      groupNodes(ids, 'Group');
                      setContextMenu(null);
                    }}>
                      Group Selection <span style={{ color: tc.surface2, fontSize: '10px' }}>⌘G</span>
                    </button>
                    <button style={ctxBtnStyle} onClick={() => {
                      duplicateNodes(ids);
                      setContextMenu(null);
                    }}>
                      Duplicate Selection
                    </button>
                    <div style={{ borderTop: `1px solid ${tc.surface0}`, margin: '4px 0' }} />
                  </>
                )}
                {isSceneGroup && clickedNode && (
                  <>
                    <button style={ctxBtnStyle} onClick={() => {
                      enterGroup(clickedNode.id);
                      setContextMenu(null);
                    }}>
                      Enter Scene Group <span style={{ color: tc.surface2, fontSize: '10px' }}>↵</span>
                    </button>
                    <div style={{ borderTop: `1px solid ${tc.surface0}`, margin: '4px 0' }} />
                    <button style={{ ...ctxBtnStyle, color: tc.red }} onClick={() => {
                      removeNode(clickedNode.id);
                      setContextMenu(null);
                    }}>
                      Delete Scene Group
                    </button>
                  </>
                )}
                {isSpaceWarpGroup && clickedNode && (
                  <>
                    <button style={ctxBtnStyle} onClick={() => {
                      enterGroup(clickedNode.id);
                      setContextMenu(null);
                    }}>
                      Enter Space Warp Group <span style={{ color: tc.surface2, fontSize: '10px' }}>↵</span>
                    </button>
                    <div style={{ borderTop: `1px solid ${tc.surface0}`, margin: '4px 0' }} />
                    <button style={{ ...ctxBtnStyle, color: tc.red }} onClick={() => {
                      removeNode(clickedNode.id);
                      setContextMenu(null);
                    }}>
                      Delete Space Warp Group
                    </button>
                  </>
                )}
                {isMarchLoopGroup && clickedNode && (
                  <>
                    <button style={ctxBtnStyle} onClick={() => {
                      enterGroup(clickedNode.id);
                      setContextMenu(null);
                    }}>
                      Enter {clickedNode.type === 'giLitMarchGroup' ? 'GI Lit March Group' : 'March Loop Group'} <span style={{ color: tc.surface2, fontSize: '10px' }}>↵</span>
                    </button>
                    <div style={{ borderTop: `1px solid ${tc.surface0}`, margin: '4px 0' }} />
                    <button style={{ ...ctxBtnStyle, color: tc.red }} onClick={() => {
                      removeNode(clickedNode.id);
                      setContextMenu(null);
                    }}>
                      Delete {clickedNode.type === 'giLitMarchGroup' ? 'GI Lit March Group' : 'March Loop Group'}
                    </button>
                  </>
                )}
                {isGroup && clickedNode && (
                  <>
                    <button style={ctxBtnStyle} onClick={() => {
                      enterGroup(clickedNode.id);
                      setContextMenu(null);
                    }}>
                      Enter Group
                    </button>
                    <button style={ctxBtnStyle} onClick={() => {
                      const id = clickedNode.id;
                      setContextMenu(null);
                      askText('Rename group', { initial: typeof clickedNode.params.label === 'string' ? clickedNode.params.label : 'Group', confirmLabel: 'Rename' })
                        .then(label => { if (label) updateNodeParams(id, { label }); });
                    }}>
                      Rename Group
                    </button>
                    <div style={{ borderTop: `1px solid ${tc.surface0}`, margin: '4px 0' }} />
                    <button style={{ ...ctxBtnStyle, color: tc.red }} onClick={() => {
                      ungroupNode(clickedNode.id);
                      setContextMenu(null);
                    }}>
                      Ungroup
                    </button>
                    <button style={{ ...ctxBtnStyle, color: tc.red }} onClick={() => {
                      const id = clickedNode.id;
                      const name = typeof clickedNode.params.label === 'string' ? clickedNode.params.label : 'Group';
                      const count = ((clickedNode.params.subgraph as { nodes?: unknown[] } | undefined)?.nodes ?? []).length;
                      setContextMenu(null);
                      askConfirm(`Delete “${name}”?`, {
                        message: `This removes the group and the ${count} node${count === 1 ? '' : 's'} inside it. You can undo it.`,
                        confirmLabel: 'Delete group', danger: true,
                      }).then(ok => { if (ok) removeNode(id); });
                    }}>
                      Delete Group
                    </button>
                  </>
                )}
                {clickedNode && !isGroup && !isSceneGroup && !isSpaceWarpGroup && !isMarchLoopGroup && (
                  <>
                    <button style={ctxBtnStyle} onClick={() => {
                      duplicateNode(clickedNode.id);
                      setContextMenu(null);
                    }}>
                      Duplicate
                    </button>
                    <div style={{ borderTop: `1px solid ${tc.surface0}`, margin: '4px 0' }} />
                    <button style={{ ...ctxBtnStyle, color: tc.red }} onClick={() => {
                      removeNode(clickedNode.id);
                      setContextMenu(null);
                    }}>
                      Delete
                    </button>
                  </>
                )}
              </>
            );
          })()}
        </div>,
        document.body
      )}

      {/* Minimap overlay — screen space, bottom-right (hidden on touch devices) */}
      {showMinimap && !isTouchDevice.current && (
        <Minimap
          nodes={nodes}
          viewportWidth={canvasWidth}
          viewportHeight={canvasHeight}
          onPanTo={handleMinimapPanTo}
        />
      )}

      {/* ── World-space container — receives pan+zoom transform ── */}
      <div
        ref={worldRef}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: 0,
          height: 0,
          transformOrigin: '0 0',
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          pointerEvents: locked ? 'none' : undefined,
        }}
      >
        {/* Wires — data-derived from node positions + measured socket offsets */}
        <WireLayer
          displayNodes={displayNodes}
          activeSubgraph={activeSubgraph}
          groupOutputTerminalPos={groupOutputTerminalPos}
          groupInputTerminalPos={groupInputTerminalPos}
          spotlightEdges={spotlightEdges}
          dragConnection={dragConnection}
          draggingType={draggingType}
          pendingMobileConnection={pendingMobileConnection}
          pendingMobileType={pendingMobileType}
          onEdgeEnter={handleEdgeEnter}
          onEdgeLeave={handleEdgeLeave}
          ghostWire={ghostWire}
        />

        {/* Node cards — positioned in world space; off-screen cards are culled */}
        {visibleNodes.map(node => (
          <NodeComponent
            key={node.id}
            node={node}
            activeGroupNode={activeGroupNode}
            onStartConnection={handleStartConnection}
            onEndConnection={handleEndConnection}
            onTapOutputSocket={handleTapOutputSocket}
            onTapInputSocket={handleTapInputSocket}
            pendingMobileConnection={pendingMobileConnection}
            pendingMobileType={pendingMobileType}
            draggingType={draggingType}
            isTouchDevice={isTouchDevice.current}
            dimmed={highlightedIds !== null && !highlightedIds.has(node.id)}
            onEnterGroup={enterGroup}
            hasError={nodeErrors.has(node.id)}
            errors={nodeErrors.get(node.id)}
            externalInputKeys={externalPortMap?.get(node.id)}
            externalParamKeys={externalParamMap?.get(node.id)}
            onAltClickSocket={handleAltClickSocket}
            isConnectionDragging={dragConnection !== null}
            onSocketHover={handleSocketHover}
            onSuggestSocket={handleSuggestSocket}
          />
        ))}

        {/* Group Output terminal — shown when inside a regular group view (not sceneGroup) */}
        {activeGroupId && activeSubgraph && groupOutputTerminalPos && !isInsideSceneGroup && (
          <div
            data-node-id="__group_output__"
            style={{ ...terminalCard, left: groupOutputTerminalPos.x, top: groupOutputTerminalPos.y, boxShadow: `inset 0 0 0 1.5px ${alpha(tk.kind.expr, 0.5)}, ${tk.shadow.card}` }}
            onMouseDown={e => e.stopPropagation()}
          >
            <div style={{ ...terminalHead, color: tk.kind.expr }}>
              <Icon name="export" size={15} />Group output
            </div>

            {/* One row per output port */}
            {(activeSubgraph.outputPorts ?? []).map(port => {
              const srcNode  = displayNodes.find(n => n.id === port.fromNodeId);
              const srcDef   = srcNode ? getNodeDefinitionFor(srcNode) : null;
              const srcLabel = port.fromNodeId
                ? (typeof srcNode?.params?.label === 'string' ? srcNode.params.label : (srcDef?.label ?? srcNode?.type ?? '?'))
                : 'not connected';
              const isDraggingCompatible = dragConnection
                ? (() => { const src = displayNodes.find(n => n.id === dragConnection.sourceNodeId); return !!(src?.outputs[dragConnection.sourceOutputKey]); })()
                : false;
              const color = TYPE_COLORS[port.type] ?? tk.text.faint;
              return (
                <div
                  key={port.key}
                  style={{
                    ...terminalRow, padding: '0 6px 0 16px',
                    background: isDraggingCompatible ? alpha(tk.kind.expr, 0.08) : 'transparent',
                  }}
                >
                  {/* Input socket */}
                  <div
                    ref={el => { registerSocket('__group_output__', 'in', port.key, el); }}
                    onMouseUp={e => { e.stopPropagation(); handleEndConnection('__group_output__', port.key); }}
                    style={{
                      ...terminalDot, left: -6, border: `2px solid ${color}`,
                      background: port.fromNodeId ? color : tk.bg.panel,
                      boxShadow: isDraggingCompatible ? `0 0 0 3px ${alpha(color, 0.35)}` : port.fromNodeId ? `0 0 0 2px ${tk.bg.panel}` : undefined,
                    }}
                  />
                  {editingOutputPortKey === port.key ? (
                    <input
                      autoFocus
                      aria-label="Output name"
                      value={editingOutputPortLabel}
                      onMouseDown={e => e.stopPropagation()}
                      onChange={e => setEditingOutputPortLabel(e.target.value)}
                      onBlur={() => {
                        if (editingOutputPortLabel.trim() && activeGroupId) {
                          renameGroupPort(activeGroupId, port.key, 'out', editingOutputPortLabel.trim());
                        }
                        setEditingOutputPortKey(null);
                      }}
                      onKeyDown={e => {
                        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                        if (e.key === 'Escape') setEditingOutputPortKey(null);
                      }}
                      style={terminalInput}
                    />
                  ) : (
                    <span
                      style={{ color: tk.text.secondary, cursor: 'text', flexShrink: 0 }}
                      title="Double-click to rename"
                      onDoubleClick={() => { setEditingOutputPortKey(port.key); setEditingOutputPortLabel(port.label); }}
                    >{port.label}</span>
                  )}
                  <span style={{
                    flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 11.5,
                    color: port.fromNodeId ? tk.text.muted : tk.text.faint, fontStyle: port.fromNodeId ? 'normal' : 'italic',
                  }}>
                    {port.fromNodeId ? `← ${srcLabel}` : srcLabel}
                  </span>
                  <IconButton icon="close" label="Remove this output" size="sm" tone="danger" tooltip={false}
                    onMouseDown={e => e.stopPropagation()}
                    onClick={() => activeGroupId && removeGroupOutput(activeGroupId, port.key)} />
                </div>
              );
            })}

            <div style={{ padding: '4px 8px 8px' }}>
              <Button size="sm" variant="ghost" icon="plus" style={{ width: '100%', height: 28 }}
                onMouseDown={e => e.stopPropagation()}
                onClick={() => activeGroupId && addGroupOutput(activeGroupId)}>Add output</Button>
            </div>
          </div>
        )}

        {/* Group Input terminal — shown when inside a regular group view (not sceneGroup) */}
        {activeGroupId && activeSubgraph && groupInputTerminalPos && !isInsideSceneGroup && (
          <div
            data-node-id="__group_input__"
            style={{ ...terminalCard, left: groupInputTerminalPos.x, top: groupInputTerminalPos.y, boxShadow: `inset 0 0 0 1.5px ${alpha(tk.accent.base, 0.45)}, ${tk.shadow.card}` }}
            onMouseDown={e => e.stopPropagation()}
          >
            <div style={{ ...terminalHead, color: tk.accent.text }}>
              <Icon name="import" size={15} />Group inputs
            </div>

            {/* One row per input port */}
            {(activeSubgraph.inputPorts ?? []).map(port => {
              const isDragging = !!dragConnection;
              const color = TYPE_COLORS[port.type] ?? tk.text.faint;
              return (
                <div key={port.key} style={{ ...terminalRow, padding: '0 16px 0 14px' }}>
                  <span style={{ flex: 1, color: tk.text.secondary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{port.label}</span>
                  <span style={{ font: `500 11px ${fontFamily.mono}`, color: tk.text.faint, flexShrink: 0 }}>{port.type}</span>
                  {/* Output socket — drag FROM this to an inner node input */}
                  <div
                    ref={el => { registerSocket('__group_input__', 'out', port.key, el); }}
                    onMouseDown={e => { e.stopPropagation(); handleStartConnection('__group_input__', port.key, e); }}
                    style={{
                      ...terminalDot, right: -6, background: color, border: `2px solid ${color}`,
                      boxShadow: isDragging ? `0 0 0 3px ${alpha(color, 0.35)}` : `0 0 0 2px ${tk.bg.panel}`,
                    }}
                  />
                </div>
              );
            })}

            {/* Add input form / button */}
            <div style={{ borderTop: `1px solid ${tk.border.subtle}`, padding: 8 }}>
              {addingGroupInput ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }} onMouseDown={e => e.stopPropagation()}>
                  <input
                    autoFocus
                    aria-label="Input name"
                    placeholder="Input name"
                    value={addingGroupInput.name}
                    onChange={e => setAddingGroupInput(prev => prev ? { ...prev, name: e.target.value } : null)}
                    onKeyDown={e => e.stopPropagation()}
                    style={{ ...terminalInput, width: '100%', height: 30, boxShadow: 'none', background: tk.bg.field }}
                  />
                  <Segmented
                    fill
                    size="sm"
                    ariaLabel="Input type"
                    value={addingGroupInput.type}
                    options={(['float', 'vec2', 'vec3', 'vec4'] as const).map(t => ({ value: t, label: t }))}
                    onChange={t => setAddingGroupInput(prev => prev ? { ...prev, type: t } : null)}
                  />
                  <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                    <Button size="sm" variant="ghost" style={{ height: 28 }} onClick={() => setAddingGroupInput(null)}>Cancel</Button>
                    <Button size="sm" variant="primary" style={{ height: 28 }} disabled={!addingGroupInput.name.trim()}
                      onClick={() => {
                        if (addingGroupInput.name.trim() && activeGroupId) {
                          addGroupInput(activeGroupId, addingGroupInput.type, addingGroupInput.name.trim());
                        }
                        setAddingGroupInput(null);
                      }}>Add</Button>
                  </div>
                </div>
              ) : (
                <Button size="sm" variant="ghost" icon="plus" style={{ width: '100%', height: 28 }}
                  onClick={() => setAddingGroupInput({ name: '', type: 'float' })}>Add input</Button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Feature 3: Box/marquee select rect */}
      {boxSelect && (() => {
        const left   = Math.min(boxSelect.startX, boxSelect.curX);
        const top    = Math.min(boxSelect.startY, boxSelect.curY);
        const width  = Math.abs(boxSelect.curX - boxSelect.startX);
        const height = Math.abs(boxSelect.curY - boxSelect.startY);
        return (
          <div
            style={{
              position: 'fixed',
              left, top, width, height,
              border: `1px solid ${alpha(tk.accent.base, 0.6)}`,
              borderRadius: 4,
              background: alpha(tk.accent.base, 0.06),
              pointerEvents: 'none',
              zIndex: 50,
            }}
          />
        );
      })()}

      {/* Feature 2: Wire hover + badge */}
      {hoveredWire && !wireInsertOpen && (
        <div
          style={{
            position: 'fixed',
            left: hoveredWire.midX - 14,
            top:  hoveredWire.midY - 14,
            width: 28, height: 28, borderRadius: '50%',
            background: tc.blue,
            color: tc.base,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '16px', fontWeight: 700,
            cursor: 'pointer',
            zIndex: 60,
            boxShadow: '0 2px 8px rgba(0,0,0,0.5)',
            transition: 'transform 0.1s',
            userSelect: 'none',
          }}
          onMouseEnter={e => {
            if (wireLeaveTimerRef.current) { clearTimeout(wireLeaveTimerRef.current); wireLeaveTimerRef.current = null; }
            e.currentTarget.style.transform = 'scale(1.2)';
          }}
          onMouseLeave={e => {
            e.currentTarget.style.transform = 'scale(1)';
            setHoveredWire(null);
          }}
          onClick={() => setWireInsertOpen(true)}
        >
          +
        </div>
      )}

      {/* Feature 2: Wire insert palette */}
      {wireInsertOpen && hoveredWire && (() => {
        const wv = hoveredWire;
        return (
          <NodeSearchPalette
            open={true}
            onClose={() => { setWireInsertOpen(false); setHoveredWire(null); }}
            filterOutputType={wv.fromType}
            filterInputType={wv.toType}
            spawnPosition={screenToWorld(wv.midX, wv.midY)}
            onNodePlaced={(newNodeId) => {
              // Disconnect existing connection
              disconnectInput(wv.toNodeId, wv.toInputKey);
              // Wire: from → new node first input, new node first output → to
              const newNode = useNodeGraphStore.getState().nodes.find(n => n.id === newNodeId)
                ?? getActiveNodes(useNodeGraphStore.getState().nodes, useNodeGraphStore.getState().activeGroupPath)?.find(n => n.id === newNodeId);
              if (newNode) {
                const firstIn  = Object.keys(newNode.inputs)[0];
                const firstOut = Object.keys(newNode.outputs)[0];
                if (firstIn)  connectNodes(wv.fromNodeId, wv.fromOutputKey, newNodeId, firstIn);
                if (firstOut) connectNodes(newNodeId, firstOut, wv.toNodeId, wv.toInputKey);
              }
              setWireInsertOpen(false);
              setHoveredWire(null);
            }}
          />
        );
      })()}

      {/* Feature 1: Alt-click socket filtered palette */}
      {smartConnect && (() => {
        const origin = displayNodes.find(n => n.id === smartConnect.nodeId);
        const sock = smartConnect.dir === 'out' ? origin?.outputs[smartConnect.key] : origin?.inputs[smartConnect.key];
        if (!origin || !sock) return null;
        return (
          <SmartConnectMenu
            x={smartConnect.x}
            y={smartConnect.y}
            title={`${smartConnect.dir === 'out' ? 'CONNECT' : 'FEED'} ${sock.label.toUpperCase()} ${smartConnect.dir === 'out' ? 'TO' : 'FROM'}`}
            items={smartSuggestions}
            quickAdds={smartQuickAdds}
            onPick={pickSuggestion}
            onQuickAdd={pickQuickAdd}
            onHover={setGhostSuggestion}
            onAddNode={() => {
              setPendingSocket({ nodeId: smartConnect.nodeId, key: smartConnect.key, dir: smartConnect.dir, type: sock.type, screenX: smartConnect.x, screenY: smartConnect.y });
              closeSmartConnect();
            }}
            onClose={closeSmartConnect}
            justAdded={smartConnect.justAdded}
          />
        );
      })()}
      {pendingSocket && (() => {
        const ps = pendingSocket;
        const worldSpawn = screenToWorld(ps.screenX, ps.screenY);
        const spawnPos = ps.dir === 'in'
          ? { x: worldSpawn.x - 200, y: worldSpawn.y - 40 }
          : { x: worldSpawn.x + 150, y: worldSpawn.y - 40 };
        return (
          <NodeSearchPalette
            open={true}
            onClose={() => setPendingSocket(null)}
            spawnPosition={spawnPos}
            filterOutputType={ps.dir === 'in'  ? ps.type : undefined}
            filterInputType={ps.dir === 'out' ? ps.type : undefined}
            onNodePlaced={handleAltSocketNodePlaced}
          />
        );
      })()}
    </div>
  );
});

const ctxBtnStyleFor = (tc: CtpPalette): React.CSSProperties => ({
  display: 'block',
  width: '100%',
  background: 'none',
  border: 'none',
  color: tc.text,
  padding: '6px 12px',
  textAlign: 'left',
  cursor: 'pointer',
  fontSize: '12px',
});

const toolbarBtnStyleFor = (tc: CtpPalette): React.CSSProperties => ({
  background: tc.surface0,
  border: `1px solid ${tc.surface1}`,
  color: tc.text,
  borderRadius: '6px',
  padding: '5px 10px',
  fontSize: '11px',
  cursor: 'pointer',
  letterSpacing: '0.02em',
});

// Larger touch target for toolbar buttons on touch devices
const touchToolbarBtnStyleFor = (tc: CtpPalette): React.CSSProperties => ({
  background: 'rgba(49,50,68,0.85)',
  border: `1px solid ${tc.surface1}`,
  color: tc.text,
  borderRadius: '8px',
  padding: '10px 14px',
  fontSize: '13px',
  cursor: 'pointer',
  letterSpacing: '0.02em',
  touchAction: 'manipulation',
  backdropFilter: 'blur(6px)',
  WebkitBackdropFilter: 'blur(6px)',
});
