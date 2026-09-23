import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import ShaderCanvas, { type OfflineRenderHandle, type HistogramData } from './components/ShaderCanvas';
import { NodeGraph } from './components/NodeGraph/NodeGraph';
import { NodePalette } from './components/NodeGraph/NodePalette';
import { MobileGraphBrowser, MobileNodeGraphOverlay } from './components/NodeGraph/MobileGraphBrowser';
import { CodePanel, tokenizeLine } from './components/CodePanel';
import { TopNav } from './components/TopNav';
import { ExportModal } from './components/ExportModal';
import { KeyboardShortcutsModal } from './components/KeyboardShortcutsModal';
import { ShortcutsPage } from './components/ShortcutsPage';
import { GLSLPage } from './components/GLSLPage';
import { TimeControlsStrip } from './components/TimeControlsStrip';
import { FunctionBuilder } from './components/FunctionBuilder';
import { useFunctionBuilder } from './components/FunctionBuilder/useFunctionBuilder';
import type { Page } from './components/TopNav';
import { NodeSearchPalette } from './components/NodeGraph/NodeSearchPalette';
import { useNodeGraphStore, EXAMPLE_GRAPHS, EXAMPLE_FOLDERS } from './store/useNodeGraphStore';
import { audioEngine } from './lib/audioEngine';
import { useBreakpoint, isMobile, isTablet, isDesktop } from './hooks/useBreakpoint';
import { useShortcuts } from './hooks/useShortcuts';
import { useTimeHotkeys } from './hooks/useTimeHotkeys';

// ── Responsive sizing helpers ─────────────────────────────────────────────────
function getDefaultPreviewWidth(bp: ReturnType<typeof useBreakpoint>) {
  if (bp === 'desktop-lg') return Math.max(Math.floor(window.innerWidth * 0.38), 420);
  if (bp === 'desktop-sm') return Math.max(Math.floor(window.innerWidth * 0.35), 300);
  if (bp === 'tablet')     return Math.max(Math.floor(window.innerWidth * 0.45), 280);
  return window.innerWidth; // mobile: full width (canvas is background)
}

function getPaletteWidth(bp: ReturnType<typeof useBreakpoint>) {
  if (bp === 'desktop-lg') return 210;
  if (bp === 'desktop-sm') return 180;
  return 0; // tablet/mobile: no fixed palette sidebar
}

const MIN_PREVIEW = 200;
const MIN_GRAPH   = 280;

// ── Button style helper ───────────────────────────────────────────────────────
const btnStyle = (active = false): React.CSSProperties => ({
  background: active ? '#89b4fa22' : '#313244',
  border: `1px solid ${active ? '#89b4fa55' : '#45475a'}`,
  color: active ? '#89b4fa' : '#cdd6f4',
  borderRadius: '6px',
  padding: '4px 10px',
  fontSize: '11px',
  cursor: 'pointer',
  touchAction: 'manipulation' as const,
  whiteSpace: 'nowrap' as const,
});

// ── Audio master volume widget — shown when any audioInput node is in the graph ─
function AudioMasterVolumeWidget() {
  const nodes        = useNodeGraphStore(s => s.nodes);
  const masterVolume = useNodeGraphStore(s => s.audioMasterVolume);
  const setVolume    = useNodeGraphStore(s => s.setAudioMasterVolume);
  const hasAudio     = nodes.some(n => n.type === 'audioInput');
  const [paused, setPaused] = useState(false);
  if (!hasAudio) return null;

  const togglePause = () => {
    if (paused) {
      audioEngine.resumeAll();
      setPaused(false);
    } else {
      audioEngine.pauseAll();
      setPaused(true);
    }
  };

  return (
    <div style={{
      position: 'absolute', bottom: 12, right: 12, zIndex: 20,
      background: 'rgba(17,17,27,0.92)', border: '1px solid #45475a',
      borderRadius: '8px', padding: '6px 10px',
      display: 'flex', alignItems: 'center', gap: '8px',
      backdropFilter: 'blur(8px)',
      boxShadow: '0 2px 12px rgba(0,0,0,0.5)',
    }}>
      <span style={{ fontSize: '11px', color: '#89dceb' }}>♫</span>
      <button
        onClick={togglePause}
        title={paused ? 'Resume all audio' : 'Pause all audio'}
        style={{ background: 'none', border: 'none', color: paused ? '#f38ba8' : '#a6e3a1', cursor: 'pointer', fontSize: '12px', padding: '0 2px', lineHeight: 1 }}
      >{paused ? '▶' : '⏸'}</button>
      <input
        type="range"
        min={0} max={1} step={0.01}
        value={masterVolume}
        onChange={e => setVolume(parseFloat(e.target.value))}
        style={{ width: 72, accentColor: '#89dceb', cursor: 'pointer', opacity: paused ? 0.4 : 1 }}
      />
      <span style={{ fontSize: '10px', color: '#6c7086', fontFamily: 'monospace', width: '30px', textAlign: 'right' }}>
        {Math.round(masterVolume * 100)}%
      </span>
    </div>
  );
}

// Mobile's own read-only generated-code view — desktop's CodePanel is a
// draggable-height floating panel with mouse-based resize, not a fit for a
// fullscreen mobile pane, so this reuses just its tokenizer/palette for the
// same syntax highlighting rather than the whole component.
function MobileCodeView({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const lines = code ? code.split('\n') : ['// No shader compiled yet'];
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* silent */ }
  };
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0, background: '#181825' }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '8px 12px', background: '#1e1e2e', borderBottom: '1px solid #313244', flexShrink: 0,
      }}>
        <span style={{ fontSize: '11px', fontWeight: 700, color: '#89b4fa', letterSpacing: '0.04em' }}>FRAGMENT SHADER</span>
        <button
          onClick={handleCopy}
          style={{ background: 'none', border: '1px solid #45475a', color: copied ? '#a6e3a1' : '#a6adc8', borderRadius: '5px', padding: '3px 8px', fontSize: '11px', cursor: 'pointer', touchAction: 'manipulation' }}
        >{copied ? 'Copied' : 'Copy'}</button>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '8px 12px', fontFamily: 'monospace', fontSize: '11px', lineHeight: 1.6 }}>
        {lines.map((line, i) => (
          <div key={i} style={{ whiteSpace: 'pre' }}>
            <span style={{ color: '#45475a', userSelect: 'none', marginRight: '10px' }}>{String(i + 1).padStart(3, ' ')}</span>
            {tokenizeLine(line).map((tok, j) => <span key={j} style={{ color: tok.color }}>{tok.text}</span>)}
          </div>
        ))}
      </div>
    </div>
  );
}

type HistChannel = 'luma' | 'r' | 'g' | 'b';

const HIST_CH_COLORS: Record<HistChannel, string> = {
  luma: '#cdd6f4', r: '#f38ba8', g: '#a6e3a1', b: '#89b4fa',
};
const HIST_CH_LABELS: Record<HistChannel, string> = {
  luma: 'L', r: 'R', g: 'G', b: 'B',
};

function HistogramOverlay({ data }: { data: HistogramData }) {
  const [active, setActive] = React.useState<Set<HistChannel>>(new Set(['luma']));
  const [hoverInfo, setHoverInfo] = React.useState<{ x: number; binIdx: number } | null>(null);

  const toggle = (ch: HistChannel) => {
    setActive(prev => {
      const next = new Set(prev);
      if (next.has(ch)) { if (next.size > 1) next.delete(ch); }
      else next.add(ch);
      return next;
    });
  };

  const channels = (['luma', 'r', 'g', 'b'] as HistChannel[]).filter(ch => active.has(ch));
  const allBins = channels.map(ch => data[ch]);
  const globalMax = Math.max(...allBins.flatMap(b => Array.from(b)), 0.001);

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const t = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const binIdx = Math.min(data.luma.length - 1, Math.floor(t * data.luma.length));
    setHoverInfo({ x: t, binIdx });
  };

  const btnStyle = (ch: HistChannel): React.CSSProperties => ({
    padding: '1px 6px', fontSize: '9px', borderRadius: '3px', cursor: 'pointer',
    fontFamily: 'monospace', letterSpacing: '0.04em',
    background: active.has(ch) ? `${HIST_CH_COLORS[ch]}22` : 'transparent',
    border: `1px solid ${active.has(ch) ? HIST_CH_COLORS[ch] : '#45475a'}`,
    color: active.has(ch) ? HIST_CH_COLORS[ch] : '#585b70',
  });

  return (
    <div style={{
      position: 'absolute', bottom: 0, left: 0, right: 0, height: '84px',
      background: 'rgba(17,17,27,0.92)', backdropFilter: 'blur(4px)',
      borderTop: '1px solid #31324466',
      display: 'flex', flexDirection: 'column',
      padding: '5px 8px 3px',
      zIndex: 5,
    }}>
      {/* Header row: channel toggles + fps + hover readout */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '4px' }}>
        {(['luma', 'r', 'g', 'b'] as HistChannel[]).map(ch => (
          <button key={ch} style={btnStyle(ch)} onClick={() => toggle(ch)}>
            {HIST_CH_LABELS[ch]}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        {hoverInfo !== null && (
          <span style={{ fontSize: '9px', color: '#cdd6f4', fontFamily: 'monospace' }}>
            {(hoverInfo.binIdx / (data.luma.length - 1)).toFixed(3)}
            {channels.map(ch => (
              <span key={ch} style={{ color: HIST_CH_COLORS[ch], marginLeft: '5px' }}>
                {(data[ch][hoverInfo.binIdx] * 100).toFixed(1)}%
              </span>
            ))}
          </span>
        )}
        {data.fps > 0 && (
          <span style={{ fontSize: '9px', color: '#585b70', fontFamily: 'monospace', marginLeft: '6px' }}>
            {data.fps}<span style={{ color: '#45475a' }}>fps</span>
          </span>
        )}
      </div>

      {/* Histogram bars — overlapping, one layer per active channel */}
      <div
        style={{ flex: 1, position: 'relative', cursor: 'crosshair' }}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHoverInfo(null)}
      >
        {channels.map(ch => (
          <div key={ch} style={{
            position: 'absolute', inset: 0,
            display: 'flex', alignItems: 'flex-end', gap: '1px',
            pointerEvents: 'none',
          }}>
            {Array.from(data[ch]).map((v, i) => (
              <div key={i} style={{
                flex: 1,
                height: `${Math.round((v / globalMax) * 100)}%`,
                minHeight: v > 0 ? '1px' : '0',
                background: HIST_CH_COLORS[ch],
                opacity: hoverInfo?.binIdx === i ? 0.95 : 0.45,
              }} />
            ))}
          </div>
        ))}
        {/* Hover cursor line */}
        {hoverInfo !== null && (
          <div style={{
            position: 'absolute', top: 0, bottom: 0,
            left: `${hoverInfo.x * 100}%`,
            width: '1px', background: 'rgba(255,255,255,0.3)',
            pointerEvents: 'none',
          }} />
        )}
      </div>

      {/* Scale labels */}
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '8px', color: '#45475a', marginTop: '2px' }}>
        <span>0</span><span>0.5</span><span>1.0</span>
      </div>
    </div>
  );
}

function App() {
  const {
    loadExampleGraph, compilationErrors, glslErrors, pixelSample, hoveredParamHint, fragmentShader,
    saveGraph, getSavedGraphNames, loadSavedGraph, deleteSavedGraph, exportGraph, importGraphFromFile,
    addNode, setNodeHighlightFilter, _fitViewCallback, undo,
    nodeProbeValues, selectedNodeId, nodes: graphNodes,
    groupNodes, deselectAll,
    searchPaletteOpen, setSearchPaletteOpen,
    nodeSlugMap,
    mobileKeyframeEditor, mobileKeyframeTool, setMobileKeyframeTool,
    mobileNodeOverlayOpen, setMobileNodeOverlayOpen,
  } = useNodeGraphStore();

  // Build probe display for selected node — shown in status bar instead of "hover for color"
  const selectedNode = selectedNodeId ? graphNodes.find(n => n.id === selectedNodeId) : null;
  const probeDisplay = selectedNode && nodeProbeValues
    ? Object.entries(nodeProbeValues).map(([outKey, vals]) => {
        const outSocket = selectedNode.outputs[outKey];
        const label = outSocket?.label ?? outKey;
        const type  = outSocket?.type ?? 'float';
        const COLOR_MAP: Record<string, string> = { float: '#f0a', vec2: '#0af', vec3: '#0fa', vec4: '#fa0' };
        const col = COLOR_MAP[type] || '#cdd6f4';
        const formatted = vals.map(v => v.toFixed(3)).join(', ');
        return { label, col, formatted, type };
      })
    : null;

  const bp = useBreakpoint();
  const mobile = isMobile(bp);
  const tablet = isTablet(bp);
  void isDesktop; // used implicitly via breakpoint branching

  const [showErrors, setShowErrors]     = useState(false);
  const [previewWidth, setPreviewWidth] = useState(() => getDefaultPreviewWidth(bp));
  const [isDragging, setIsDragging]     = useState(false);
  const [showCode, setShowCode]         = useState(false);
  const [page, setPage]                 = useState<Page>('studio');

  // Navigate to Function Builder when an ExprBlock requests it
  useEffect(() => {
    return useFunctionBuilder.subscribe((s) => {
      if (s.requestNavToBuilder) {
        setPage('fn');
        useFunctionBuilder.getState().clearNavRequest();
      }
    });
  }, []);
  const [previewFloated, setPreviewFloated] = useState(false);
  const [floatPos, setFloatPos]   = useState({ x: 40, y: 60 });
  const [floatSize, setFloatSize] = useState({ w: 480, h: 360 });
  const floatDragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const floatContainerRef = useRef<HTMLDivElement>(null);
  const [showToolbarMenu, setShowToolbarMenu] = useState(false);

  // Mobile: canvas-only / split / graph-only layout mode
  const [mobileLayout, setMobileLayout] = useState<'canvas' | 'split' | 'graph' | 'code'>('split');
  // Tablet: palette sidebar expanded or icon-only
  const [paletteExpanded, setPaletteExpanded] = useState(false);

  // Save / Load panel state
  const [showSavePanel, setShowSavePanel] = useState(false);
  const [showLoadPanel, setShowLoadPanel] = useState(false);
  const [saveNameInput, setSaveNameInput] = useState('');
  const [savedNames, setSavedNames]       = useState<string[]>([]);
  // Export animation modal
  const [showExport, setShowExport]           = useState(false);
  // Mobile: the record button opens a menu (Record / Reset / Import / Export)
  // instead of jumping straight into the export modal, and a separate
  // Examples button opens a browsable gallery of starter graphs.
  const [showMobileActionMenu, setShowMobileActionMenu] = useState(false);
  const [showMobileExamples, setShowMobileExamples]     = useState(false);
  // Reset's own confirm step, in-app rather than window.confirm() — a native
  // confirm dialog is unreliable (sometimes silently a no-op) inside a Tauri
  // webview, which would make Reset look broken with no error or feedback.
  const [showMobileResetConfirm, setShowMobileResetConfirm] = useState(false);
  // Examples browser: which category folders are expanded — starts empty
  // (all collapsed) since the full list is long enough to need scrolling
  // past just the first one or two categories otherwise.
  const [expandedExampleFolders, setExpandedExampleFolders] = useState<Set<string>>(new Set());
  // Keyboard shortcuts modal
  const [showShortcuts, setShowShortcuts]     = useState(false);
  // Node search palette
  // showSearchPalette is now in the store (searchPaletteOpen / setSearchPaletteOpen)
  const shaderCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const offlineRenderRef = useRef<OfflineRenderHandle | null>(null);
  const handleCanvasReady = useCallback((c: HTMLCanvasElement) => { shaderCanvasRef.current = c; }, []);
  const handleRegisterOfflineRender = useCallback((handle: OfflineRenderHandle) => { offlineRenderRef.current = handle; }, []);

  const [showHistogram, setShowHistogram] = useState(false);
  const [histData, setHistData]           = useState<HistogramData | null>(null);
  const handleHistogram = useCallback((data: HistogramData) => { setHistData(data); }, []);
  const [paletteCollapsed, setPaletteCollapsed] = useState(false);
  const [paletteUserW, setPaletteUserW] = useState<number | null>(null);
  const paletteResizeRef = useRef<{ startX: number; startW: number } | null>(null);

  // Update preview width when breakpoint changes
  useEffect(() => {
    setPreviewWidth(getDefaultPreviewWidth(bp));
  }, [bp]);

  // ── Keyboard shortcuts ──────────────────────────────────────────────────────
  const addRandomNode = useCallback((type: string) => {
    addNode(type, { x: 200 + Math.random() * 160, y: 120 + Math.random() * 200 });
  }, [addNode]);

  const shortcutHandlers = useMemo(() => ({
    undo:           () => undo(),
    export:         () => exportGraph(),
    import:         () => importGraphFromFile(),
    fitView:        () => _fitViewCallback?.(),
    toggleCode:     () => setShowCode(v => !v),
    toggleRecord:   () => setShowExport(v => !v),
    addNode:        () => setSearchPaletteOpen(true),
    groupSelected:  () => {
      const ids = useNodeGraphStore.getState().selectedNodeIds;
      if (ids.length >= 2) { groupNodes(ids); deselectAll(); }
    },
    addUV:          () => addRandomNode('uv'),
    addTime:        () => addRandomNode('time'),
    addFloat:       () => addRandomNode('float'),
    addOutput:      () => addRandomNode('output'),
    addMix:         () => addRandomNode('mix'),
    addColor:       () => addRandomNode('color'),
    selectAll:      () => setNodeHighlightFilter(null),
    filterFloat:    () => setNodeHighlightFilter('float'),
    filterVec2:     () => setNodeHighlightFilter('vec2'),
    filterVec3:     () => setNodeHighlightFilter('vec3'),
    filterUVInputs: () => setNodeHighlightFilter('uv-in'),
    filterUVOutputs:() => setNodeHighlightFilter('uv-out'),
    shortcuts:      () => setPage(p => p === 'shortcuts' ? 'studio' : 'shortcuts'),
  }), [undo, addRandomNode, exportGraph, importGraphFromFile, _fitViewCallback, setNodeHighlightFilter, groupNodes, deselectAll]);

  const HOLD_FILTER_IDS = useMemo(() => new Set(['filterFloat', 'filterVec2', 'filterVec3', 'filterUVInputs', 'filterUVOutputs']), []);
  const holdHandlers = useMemo(() => ({
    ids: HOLD_FILTER_IDS,
    onRelease: () => setNodeHighlightFilter(null),
  }), [HOLD_FILTER_IDS, setNodeHighlightFilter]);

  useShortcuts(shortcutHandlers, holdHandlers);
  useTimeHotkeys();

  const handleSave = () => {
    const name = saveNameInput.trim();
    if (!name) return;
    saveGraph(name);
    setShowSavePanel(false);
    setSaveNameInput('');
  };

  useEffect(() => {
    loadExampleGraph('blank');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Desktop divider drag (mouse + touch) ──────────────────────────────────
  const handleDividerMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    const onMove = (ev: MouseEvent) => {
      const newWidth = window.innerWidth - ev.clientX;
      setPreviewWidth(Math.max(MIN_PREVIEW, Math.min(newWidth, window.innerWidth - MIN_GRAPH)));
    };
    const onUp = () => {
      setIsDragging(false);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, []);

  const handleDividerTouchStart = useCallback((_e: React.TouchEvent) => {
    setIsDragging(true);
    const onMove = (ev: TouchEvent) => {
      const touch = ev.touches[0];
      const newWidth = window.innerWidth - touch.clientX;
      setPreviewWidth(Math.max(MIN_PREVIEW, Math.min(newWidth, window.innerWidth - MIN_GRAPH)));
    };
    const onEnd = () => {
      setIsDragging(false);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onEnd);
    };
    window.addEventListener('touchmove', onMove, { passive: true });
    window.addEventListener('touchend', onEnd);
  }, []);


  // ── Float preview drag ────────────────────────────────────────────────────
  const handleFloatHeaderMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    floatDragRef.current = { startX: e.clientX, startY: e.clientY, origX: floatPos.x, origY: floatPos.y };
    const onMove = (ev: MouseEvent) => {
      if (!floatDragRef.current) return;
      const dx = ev.clientX - floatDragRef.current.startX;
      const dy = ev.clientY - floatDragRef.current.startY;
      setFloatPos({ x: floatDragRef.current.origX + dx, y: floatDragRef.current.origY + dy });
    };
    const onUp = () => {
      floatDragRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [floatPos.x, floatPos.y]);

  // Track float window size via ResizeObserver so canvas always knows its container dims.
  // Must use borderBoxSize (includes borders) not contentRect (excludes borders) — contentRect
  // creates a feedback loop: we read N-2, write N-2 as width, read N-4, write N-4... collapses to minWidth.
  useEffect(() => {
    const el = floatContainerRef.current;
    if (!el || !previewFloated) return;
    const ro = new ResizeObserver(entries => {
      const box = entries[0].borderBoxSize?.[0];
      const width  = box ? box.inlineSize : entries[0].contentRect.width;
      const height = box ? box.blockSize  : entries[0].contentRect.height;
      if (width > 0 && height > 0) setFloatSize({ w: width, h: height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [previewFloated]);

  // Hoisted before any early returns to keep hook call count stable across all breakpoints
  const _paletteBaseWForHook = paletteUserW ?? getPaletteWidth(bp);
  const handlePaletteResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    paletteResizeRef.current = { startX: e.clientX, startW: _paletteBaseWForHook };
    const onMove = (ev: MouseEvent) => {
      if (!paletteResizeRef.current) return;
      const delta = ev.clientX - paletteResizeRef.current.startX;
      setPaletteUserW(Math.max(160, Math.min(480, paletteResizeRef.current.startW + delta)));
    };
    const onUp = () => {
      paletteResizeRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [_paletteBaseWForHook]);

  // ── Error badge ───────────────────────────────────────────────────────────
  const errorCount = compilationErrors.length + glslErrors.length;
  const errorBadge = errorCount > 0 ? (
    <button
      onClick={() => setShowErrors(v => !v)}
      style={{
        background: showErrors ? '#f38ba822' : 'none',
        border: `1px solid ${showErrors ? '#f38ba855' : '#f38ba844'}`,
        color: '#f38ba8', borderRadius: '4px',
        padding: '3px 8px', fontSize: '10px', cursor: 'pointer',
        display: 'flex', alignItems: 'center', gap: '5px',
        fontFamily: 'monospace', touchAction: 'manipulation',
      }}
    >
      <span style={{ display: 'inline-block', width: '6px', height: '6px', borderRadius: '50%', background: '#f38ba8' }} />
      {errorCount} err
    </button>
  ) : null;

  // ── Error popup ───────────────────────────────────────────────────────────
  const errorPopup = showErrors && errorCount > 0 ? (
    <div style={{
      background: '#1e1e2e', border: '1px solid #f38ba8', borderBottom: 'none',
      padding: '8px 12px', fontSize: '11px', color: '#f38ba8',
      maxHeight: '160px', overflowY: 'auto', fontFamily: 'monospace', flexShrink: 0,
    }}>
      {compilationErrors.length > 0 && (
        <div style={{ marginBottom: glslErrors.length > 0 ? '6px' : 0 }}>
          <span style={{ color: '#f38ba888', fontSize: '10px', letterSpacing: '0.05em' }}>GRAPH</span>
          {compilationErrors.map((err, i) => <div key={i} style={{ paddingLeft: '6px' }}>{err}</div>)}
        </div>
      )}
      {glslErrors.length > 0 && (
        <div>
          <span style={{ color: '#f38ba888', fontSize: '10px', letterSpacing: '0.05em' }}>GLSL</span>
          {glslErrors.map((err, i) => <div key={i} style={{ paddingLeft: '6px' }}>{err}</div>)}
        </div>
      )}
    </div>
  ) : null;

  // ── Save / Load panels (shared) ───────────────────────────────────────────
  const savePanelEl = showSavePanel ? (
    <div style={{
      position: 'absolute', top: 36, left: 8, zIndex: 20,
      background: '#1e1e2e', border: '1px solid #45475a', borderRadius: '6px',
      padding: '8px', display: 'flex', gap: '6px', alignItems: 'center',
      boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
    }}>
      <input autoFocus value={saveNameInput} onChange={e => setSaveNameInput(e.target.value)}
        placeholder="Graph name..."
        onKeyDown={e => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') setShowSavePanel(false); }}
        style={{ background: '#313244', border: '1px solid #45475a', color: '#cdd6f4', borderRadius: '4px', padding: '3px 8px', fontSize: '11px', outline: 'none', width: '150px' }}
      />
      <button onClick={handleSave} disabled={!saveNameInput.trim()} style={btnStyle(!!saveNameInput.trim())}>Save</button>
      <button onClick={() => setShowSavePanel(false)} style={{ background: 'none', border: 'none', color: '#585b70', cursor: 'pointer', fontSize: '12px', padding: '2px 4px' }}>✕</button>
    </div>
  ) : null;

  const loadPanelEl = showLoadPanel ? (
    <div style={{
      position: 'absolute', top: 36, left: 8, zIndex: 20,
      background: '#1e1e2e', border: '1px solid #45475a', borderRadius: '6px',
      padding: '4px', minWidth: '200px', boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
    }}>
      {savedNames.length === 0 ? (
        <div style={{ padding: '8px 10px', fontSize: '11px', color: '#585b70' }}>No saved graphs yet</div>
      ) : savedNames.map(name => (
        <div key={name} style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '3px 6px', borderRadius: '4px' }}
          onMouseEnter={e => (e.currentTarget as HTMLDivElement).style.background = '#313244'}
          onMouseLeave={e => (e.currentTarget as HTMLDivElement).style.background = 'transparent'}
        >
          <span style={{ flex: 1, fontSize: '11px', color: '#cdd6f4', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
          <button onClick={() => { loadSavedGraph(name); setShowLoadPanel(false); }} style={{ background: '#313244', border: '1px solid #45475a', color: '#89b4fa', borderRadius: '4px', padding: '1px 7px', fontSize: '10px', cursor: 'pointer' }}>Load</button>
          <button onClick={() => { deleteSavedGraph(name); setSavedNames(getSavedGraphNames()); }} style={{ background: 'none', border: 'none', color: '#585b70', cursor: 'pointer', fontSize: '11px', padding: '1px 3px' }} title="Delete">✕</button>
        </div>
      ))}
    </div>
  ) : null;

  // ── Graph toolbar — shared by tablet + desktop layouts ────────────────────
  const compact = bp === 'desktop-sm';
  const graphToolbarEl = (
    <div style={{ position: 'absolute', top: 8, left: 8, zIndex: 15, display: 'flex', alignItems: 'center', gap: '4px' }}>

      {/* Export / Import / Record always collapsed into a ··· menu */}
      <div style={{ position: 'relative' }}>
        <button
          onClick={() => setShowToolbarMenu(v => !v)}
          style={{ ...btnStyle(showToolbarMenu), minWidth: 32 }}
          title="Export, Import, Record"
        >···</button>
        {showToolbarMenu && (
          <div
            style={{
              position: 'absolute', top: 'calc(100% + 4px)', left: 0,
              background: '#1e1e2e', border: '1px solid #45475a',
              borderRadius: '8px', padding: '4px',
              display: 'flex', flexDirection: 'column', gap: '3px',
              boxShadow: '0 4px 16px rgba(0,0,0,0.5)', zIndex: 100,
              minWidth: '130px',
            }}
            onMouseLeave={() => setShowToolbarMenu(false)}
          >
            <button onClick={() => { exportGraph(); setShowToolbarMenu(false); }} style={{ ...btnStyle(), textAlign: 'left', width: '100%' }}>⬇ Export</button>
            <button onClick={() => { importGraphFromFile(); setShowToolbarMenu(false); }} style={{ ...btnStyle(), textAlign: 'left', width: '100%' }}>⬆ Import</button>
            <div style={{ height: '1px', background: '#313244', margin: '2px 0' }} />
            <button onClick={() => { setShowExport(true); setShowToolbarMenu(false); }} style={{ ...btnStyle(), color: '#cba6f7', borderColor: '#cba6f744', textAlign: 'left', width: '100%' }}>🎬 Record</button>
          </div>
        )}
      </div>

      <button onClick={() => setShowShortcuts(true)} style={{ ...btnStyle(), color: '#89b4fa', borderColor: '#89b4fa44' }} title="Keyboard shortcuts">
        {compact ? '⌨' : '⌨ Keys'}
      </button>
      <button
        onClick={() => loadExampleGraph('blank')}
        style={{ ...btnStyle(), color: '#f38ba8' }}
        title="Clear all nodes"
      >✕</button>
    </div>
  );

  // ══════════════════════════════════════════════════════════════════════════
  // MOBILE LAYOUT (< 768px)
  // Preview fills entire screen, floating nav + bottom action bar
  // ══════════════════════════════════════════════════════════════════════════
  if (mobile && page === 'studio') {
    const showCanvasPane = mobileLayout !== 'graph' && mobileLayout !== 'code';
    const showGraphPane  = mobileLayout !== 'canvas' && mobileLayout !== 'code';
    const showCodePane   = mobileLayout === 'code';
    return (
      <div style={{ width: '100vw', height: '100vh', position: 'relative', overflow: 'hidden', background: '#11111b', touchAction: 'none', display: 'flex', flexDirection: 'column' }}>

        {/* Floating TopNav */}
        <TopNav page={page} onPageChange={setPage} floating />

        {/* Split content: canvas pane (top) + drill-down graph browser (bottom) */}
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', paddingTop: 'calc(44px + env(safe-area-inset-top, 0px))' }}>
          {showCanvasPane && (
            <div style={{
              position: 'relative',
              flex: mobileLayout === 'canvas' ? 1 : '0 0 auto',
              height: mobileLayout === 'canvas' ? undefined : '42vh',
              minHeight: 0,
              background: '#000',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              overflow: 'hidden',
            }}>
              <div style={{
                position: 'relative',
                width: mobileLayout === 'canvas' ? '100%' : 'min(100%, 42vh)',
                height: mobileLayout === 'canvas' ? '100%' : 'min(100%, 42vh)',
              }}>
                <ShaderCanvas onCanvasReady={handleCanvasReady} onRegisterOfflineRender={handleRegisterOfflineRender} />
                <AudioMasterVolumeWidget />
              </div>

              {/* Pixel color info / param hint, pinned to the canvas pane */}
              {(hoveredParamHint || pixelSample) && (
                <div style={{
                  position: 'absolute', top: 8, right: 8, zIndex: 22,
                  background: 'rgba(24,24,37,0.80)', backdropFilter: 'blur(8px)',
                  borderRadius: '6px', padding: '4px 8px',
                  display: 'flex', alignItems: 'center', gap: '6px',
                  fontSize: '10px', fontFamily: 'monospace', color: '#585b70',
                  border: '1px solid #313244',
                  maxWidth: '320px',
                }}>
                  {hoveredParamHint ? (
                    <>
                      <span style={{ color: '#cba6f7', fontSize: '11px', flexShrink: 0 }}>?</span>
                      <span style={{ color: '#cdd6f4', whiteSpace: 'normal', lineHeight: '1.4', fontFamily: 'system-ui, sans-serif' }}>{hoveredParamHint}</span>
                    </>
                  ) : pixelSample ? (
                    <>
                      <div style={{ width: '10px', height: '10px', borderRadius: '2px', background: `rgb(${pixelSample[0]},${pixelSample[1]},${pixelSample[2]})`, border: '1px solid #45475a', flexShrink: 0 }} />
                      <span style={{ color: '#f38ba8' }}>r</span><span style={{ color: '#cdd6f4' }}>{(pixelSample[0]/255).toFixed(2)}</span>
                      <span style={{ color: '#a6e3a1' }}>g</span><span style={{ color: '#cdd6f4' }}>{(pixelSample[1]/255).toFixed(2)}</span>
                      <span style={{ color: '#89b4fa' }}>b</span><span style={{ color: '#cdd6f4' }}>{(pixelSample[2]/255).toFixed(2)}</span>
                    </>
                  ) : null}
                </div>
              )}

              {/* Play/pause + reset, bottom-center of the canvas pane —
                  mobile has no side dock to float this beside (unlike
                  desktop's TimeControlsStrip next to the divider), so it
                  overlays the canvas here instead. Node-graph toggle rides
                  alongside it — same "floats on the canvas" idea, a
                  read-only mirror of the real node layout while you watch
                  the render, not another editor. */}
              <div style={{ position: 'absolute', bottom: 8, left: '50%', transform: 'translateX(-50%)', zIndex: 22, display: 'flex', alignItems: 'center', gap: '6px' }}>
                <TimeControlsStrip />
                <button
                  onClick={() => setMobileNodeOverlayOpen(!mobileNodeOverlayOpen)}
                  title="Show the node graph over the canvas (read-only)"
                  style={{
                    background: mobileNodeOverlayOpen ? '#89b4fa22' : 'rgba(24,24,37,0.7)',
                    border: `1px solid ${mobileNodeOverlayOpen ? '#89b4fa' : '#45475a'}`,
                    color: mobileNodeOverlayOpen ? '#89b4fa' : '#a6adc8',
                    borderRadius: '6px', width: '30px', height: '30px', fontSize: '13px', cursor: 'pointer', touchAction: 'manipulation',
                  }}
                >⊞</button>
              </div>

              <MobileNodeGraphOverlay />
            </div>
          )}

          {showGraphPane && (
            <div style={{ flex: 1, minHeight: 0, borderTop: showCanvasPane ? '1px solid #313244' : undefined }}>
              <MobileGraphBrowser />
            </div>
          )}

          {showCodePane && (
            <div style={{ flex: 1, minHeight: 0 }}>
              <MobileCodeView code={fragmentShader} />
            </div>
          )}
        </div>

        {/* Error popup — sits above bottom bar (whose own height now grows
            with the home-indicator inset, so this has to match). */}
        {showErrors && errorCount > 0 && (
          <div style={{ position: 'absolute', bottom: 'calc(56px + env(safe-area-inset-bottom, 0px))', left: 0, right: 0, zIndex: 24 }}>
            {errorPopup}
          </div>
        )}

        {/* Bottom action bar — bottom/side padding grows with the home-
            indicator/notch-side insets (0 in a plain browser tab, real on
            an installed/full-screen mobile app) so it isn't flush against
            the edge the OS itself draws over. */}
        <div style={{
          flexShrink: 0, zIndex: 25,
          background: 'rgba(24,24,37,0.90)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          borderTop: '1px solid #313244',
          padding: '8px calc(12px + env(safe-area-inset-right, 0px)) calc(8px + env(safe-area-inset-bottom, 0px)) calc(12px + env(safe-area-inset-left, 0px))',
          display: 'flex', alignItems: 'center', gap: '8px',
          minHeight: '56px',
          boxSizing: 'border-box',
        }}>
          {/* Layout mode: canvas-only / split / graph-only */}
          <div style={{ display: 'flex', border: '1px solid #45475a', borderRadius: '8px', overflow: 'hidden', flexShrink: 0 }}>
            <button
              onClick={() => setMobileLayout('canvas')}
              style={{ ...btnStyle(mobileLayout === 'canvas'), border: 'none', borderRadius: 0, padding: '8px 10px', fontSize: '13px' }}
              title="Canvas fullscreen"
            >▣</button>
            <button
              onClick={() => setMobileLayout('split')}
              style={{ ...btnStyle(mobileLayout === 'split'), border: 'none', borderRadius: 0, padding: '8px 10px', fontSize: '13px', borderLeft: '1px solid #45475a', borderRight: '1px solid #45475a' }}
              title="Split view"
            >▥</button>
            <button
              onClick={() => setMobileLayout('graph')}
              style={{ ...btnStyle(mobileLayout === 'graph'), border: 'none', borderRadius: 0, padding: '8px 10px', fontSize: '13px', borderRight: '1px solid #45475a' }}
              title="Graph fullscreen"
            >☰</button>
            <button
              onClick={() => setMobileLayout('code')}
              style={{ ...btnStyle(mobileLayout === 'code'), border: 'none', borderRadius: 0, padding: '8px 10px', fontSize: '13px' }}
              title="Generated code"
            >{'{}'}</button>
          </div>

          {/* Error badge */}
          {errorBadge}

          {/* Keyframe editor tool modes — only shown while
              MobileGraphBrowser's keyframe editor is open for some node's
              socket. No keyboard here for desktop's V/C/X/D shortcuts, so
              these live as buttons instead — mirrors desktop's own
              Select/Add/Delete/Draw toolbar (KeyframeEditorModal.tsx) one
              for one, just relocated to the bottom bar. */}
          {mobileKeyframeEditor && (
            <div style={{ display: 'flex', border: '1px solid #45475a', borderRadius: '8px', overflow: 'hidden', flexShrink: 0 }}>
              {([
                { id: 'select', icon: '↖' },
                // Plain "+" rather than a pencil glyph (✏) — the pencil
                // renders as a full-color emoji in Chromium even with the
                // U+FE0E text-presentation selector appended, looking like a
                // stray colored blob next to its monochrome siblings.
                { id: 'add', icon: '+' },
                { id: 'delete', icon: '✕' },
                { id: 'draw', icon: '∿' },
              ] as const).map((m, i) => (
                <button
                  key={m.id}
                  onClick={() => setMobileKeyframeTool(m.id)}
                  style={{
                    ...btnStyle(mobileKeyframeTool === m.id), border: 'none', borderRadius: 0, padding: '8px 10px', fontSize: '13px',
                    borderLeft: i > 0 ? '1px solid #45475a' : undefined,
                  }}
                  title={m.id}
                >{m.icon}</button>
              ))}
            </div>
          )}

          {/* Examples button — browse starter graphs; picking one loads it
              in place (loadExampleGraph replaces the current graph), tapping
              the button again just closes the browser and keeps whatever's
              currently on screen. */}
          <button
            onClick={() => setShowMobileExamples(true)}
            style={{ ...btnStyle(), padding: '8px 12px', fontSize: '13px', flexShrink: 0, color: '#a6e3a1', borderColor: '#a6e3a144', marginLeft: 'auto' }}
            title="Browse examples"
          >
            ✦
          </button>

          {/* Action menu — was a direct-to-record button; now Record sits
              alongside Reset/Import/Export since they're all "whole graph"
              actions and none of them need to be one tap away. */}
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => setShowMobileActionMenu(v => !v)}
              style={{ ...btnStyle(showMobileActionMenu), padding: '8px 12px', fontSize: '13px', flexShrink: 0, color: '#cba6f7', borderColor: '#cba6f744' }}
              title="Record, reset, import, export"
            >
              🎬
            </button>
            {showMobileActionMenu && (
              <div
                onMouseLeave={() => setShowMobileActionMenu(false)}
                style={{
                  position: 'absolute', bottom: 'calc(100% + 4px)', right: 0,
                  background: '#1e1e2e', border: '1px solid #45475a', borderRadius: '8px', padding: '4px',
                  display: 'flex', flexDirection: 'column', gap: '3px', minWidth: '140px',
                  boxShadow: '0 4px 16px rgba(0,0,0,0.5)', zIndex: 100,
                }}
              >
                <button
                  onClick={() => { setShowMobileActionMenu(false); setShowExport(true); }}
                  style={{ ...btnStyle(), textAlign: 'left', width: '100%', color: '#cba6f7', borderColor: '#cba6f744' }}
                >🎬 Record</button>
                <button
                  onClick={() => { setShowMobileActionMenu(false); setShowMobileResetConfirm(true); }}
                  style={{ ...btnStyle(), textAlign: 'left', width: '100%', color: '#f38ba8', borderColor: '#f38ba844' }}
                >✕ Reset</button>
                <div style={{ height: '1px', background: '#313244', margin: '2px 0' }} />
                <button onClick={() => { setShowMobileActionMenu(false); importGraphFromFile(); }} style={{ ...btnStyle(), textAlign: 'left', width: '100%' }}>⬆ Import</button>
                <button onClick={() => { setShowMobileActionMenu(false); exportGraph(); }} style={{ ...btnStyle(), textAlign: 'left', width: '100%' }}>⬇ Export</button>
              </div>
            )}
          </div>
        </div>

        {/* Examples browser */}
        {showMobileExamples && (
          <div
            onClick={() => setShowMobileExamples(false)}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 60, display: 'flex', alignItems: 'flex-end' }}
          >
            <div
              onClick={e => e.stopPropagation()}
              style={{
                width: '100%', maxHeight: '75vh', overflowY: 'auto', background: '#181825',
                borderRadius: '16px 16px 0 0', border: '1px solid #313244',
                padding: '12px 12px calc(12px + env(safe-area-inset-bottom, 0px)) 12px',
                boxSizing: 'border-box',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', marginBottom: '10px' }}>
                <div style={{ flex: 1, fontSize: '14px', fontWeight: 700, color: '#cdd6f4' }}>Examples</div>
                <button
                  onClick={() => setShowMobileExamples(false)}
                  style={{ background: 'none', border: 'none', color: '#585b70', fontSize: '18px', lineHeight: 1, cursor: 'pointer', padding: '4px', touchAction: 'manipulation' }}
                  title="Close"
                >✕</button>
              </div>
              {EXAMPLE_FOLDERS.filter(f => f.keys.some(k => EXAMPLE_GRAPHS[k])).map(folder => {
                const isOpen = expandedExampleFolders.has(folder.label);
                return (
                  <div key={folder.label} style={{ marginBottom: '12px' }}>
                    <button
                      onClick={() => setExpandedExampleFolders(s => {
                        const next = new Set(s);
                        if (next.has(folder.label)) next.delete(folder.label); else next.add(folder.label);
                        return next;
                      })}
                      style={{
                        display: 'flex', alignItems: 'center', gap: '6px', width: '100%',
                        background: 'none', border: 'none', padding: 0, marginBottom: isOpen ? '6px' : 0,
                        cursor: 'pointer', touchAction: 'manipulation',
                      }}
                    >
                      <span style={{ fontSize: '9px', color: folder.color }}>{isOpen ? '▾' : '▸'}</span>
                      <span style={{ fontSize: '10px', fontWeight: 700, color: folder.color, letterSpacing: '0.05em' }}>
                        {folder.label.toUpperCase()}
                      </span>
                    </button>
                    {isOpen && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                        {folder.keys.filter(k => EXAMPLE_GRAPHS[k]).map(k => (
                          <button
                            key={k}
                            onClick={() => { loadExampleGraph(k); setShowMobileExamples(false); }}
                            style={{
                              background: '#1e1e2e', border: '1px solid #313244', borderRadius: '8px',
                              padding: '8px 10px', fontSize: '12px', color: '#cdd6f4',
                              cursor: 'pointer', touchAction: 'manipulation',
                            }}
                          >
                            {EXAMPLE_GRAPHS[k].label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Reset confirm — a custom modal instead of window.confirm(), which
            is unreliable inside a Tauri webview. */}
        {showMobileResetConfirm && (
          <div
            onClick={() => setShowMobileResetConfirm(false)}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 70, display: 'flex', alignItems: 'flex-end' }}
          >
            <div
              onClick={e => e.stopPropagation()}
              style={{
                width: '100%', background: '#1e1e2e', borderRadius: '16px 16px 0 0',
                border: '1px solid #45475a', padding: '16px 16px calc(16px + env(safe-area-inset-bottom, 0px)) 16px',
                boxSizing: 'border-box',
              }}
            >
              <div style={{ fontSize: '14px', fontWeight: 700, color: '#cdd6f4', marginBottom: '6px' }}>Clear all nodes?</div>
              <div style={{ fontSize: '12px', color: '#a6adc8', marginBottom: '16px' }}>This starts over from a blank graph. This can't be undone.</div>
              <button
                onClick={() => { setShowMobileResetConfirm(false); loadExampleGraph('blank'); }}
                style={{
                  width: '100%', padding: '12px', marginBottom: '8px', background: '#f38ba822',
                  border: '1px solid #f38ba866', borderRadius: '8px', color: '#f38ba8', fontSize: '13px',
                  fontWeight: 600, cursor: 'pointer', touchAction: 'manipulation',
                }}
              >
                ✕ Reset
              </button>
              <button
                onClick={() => setShowMobileResetConfirm(false)}
                style={{
                  width: '100%', padding: '12px', background: '#313244', border: '1px solid #45475a',
                  borderRadius: '8px', color: '#cdd6f4', fontSize: '13px', cursor: 'pointer', touchAction: 'manipulation',
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Export modal */}
        {showExport && (
          <ExportModal canvas={shaderCanvasRef.current} offlineRender={offlineRenderRef.current} onClose={() => setShowExport(false)} />
        )}
        {showShortcuts && <KeyboardShortcutsModal onClose={() => setShowShortcuts(false)} />}
        <NodeSearchPalette open={searchPaletteOpen} onClose={() => setSearchPaletteOpen(false)} />
      </div>
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // MOBILE LEARN PAGE
  // ══════════════════════════════════════════════════════════════════════════

  if (mobile && page === 'shortcuts') {
    return (
      <div style={{ width: '100vw', height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#11111b' }}>
        <TopNav page={page} onPageChange={setPage} />
        <ShortcutsPage />
      </div>
    );
  }

  if (mobile && page === 'glsl') {
    return (
      <div style={{ width: '100vw', height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#11111b' }}>
        <TopNav page={page} onPageChange={setPage} />
        <GLSLPage />
      </div>
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // TABLET LAYOUT (768–1024px)
  // 2-panel: collapsible palette strip | graph + preview side by side
  // ══════════════════════════════════════════════════════════════════════════
  if (tablet) {
    return (
      <div style={{ width: '100vw', height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#11111b' }}>
        <TopNav page={page} onPageChange={setPage} />

        {page === 'shortcuts' && <ShortcutsPage />}
        {page === 'glsl' && <GLSLPage />}

        <div style={{ display: page === 'studio' ? 'flex' : 'none', flex: 1, overflow: 'hidden' }}>

          {/* Collapsible palette — icon strip when collapsed, 200px when expanded */}
          <div style={{
            width: paletteExpanded ? '200px' : '36px',
            flexShrink: 0,
            background: '#1e1e2e',
            borderRight: '1px solid #313244',
            transition: 'width 0.2s ease',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
          }}>
            {/* Toggle button */}
            <button
              onClick={() => setPaletteExpanded(v => !v)}
              title={paletteExpanded ? 'Collapse palette' : 'Expand palette'}
              style={{
                background: 'none', border: 'none',
                color: '#89b4fa', cursor: 'pointer',
                padding: '10px 0', fontSize: '16px',
                width: '100%', flexShrink: 0,
                touchAction: 'manipulation',
              }}
            >
              {paletteExpanded ? '◀' : '⬡'}
            </button>
            {/* Full palette only when expanded */}
            {paletteExpanded && (
              <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                <NodePalette mode="drawer" onNodeAdded={() => setPaletteExpanded(false)} />
              </div>
            )}
          </div>

          {/* Center: Node Graph */}
          <div style={{ flex: 1, position: 'relative', minWidth: 0, userSelect: isDragging ? 'none' : undefined }}>
            {/* Toolbar — collapses to icon-only on small screens */}
            {graphToolbarEl}
            {savePanelEl}
            {loadPanelEl}

            {/* Code toggle */}
            <button onClick={() => setShowCode(v => !v)} style={{ position: 'absolute', bottom: showCode ? 248 : 8, right: 8, zIndex: 15, ...btnStyle(showCode) }}>
              {'{ } Code'}
            </button>

            <NodeGraph />
            {showCode && <CodePanel code={fragmentShader} onClose={() => setShowCode(false)} highlightNodeId={selectedNodeId} nodeSlugMap={nodeSlugMap} />}
            {/* Time controls: floating dock on the node-graph side of the
                divider, vertically centered — never overlapping the render
                canvas on the other side of it. */}
            <div style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', zIndex: 10 }}>
              <TimeControlsStrip direction="column" />
            </div>
          </div>

          {/* Divider — wider touch target for tablet */}
          <div
            onMouseDown={handleDividerMouseDown}
            onTouchStart={handleDividerTouchStart}
            style={{ width: '8px', flexShrink: 0, background: isDragging ? '#45475a' : '#313244', cursor: 'col-resize', transition: 'background 0.15s' }}
          />

          {/* Right: Preview */}
          <div style={{ width: previewWidth, flexShrink: 0, display: 'flex', flexDirection: 'column' }}>
            <div style={{ flex: 1, position: 'relative', minHeight: 0 }}><ShaderCanvas onCanvasReady={handleCanvasReady} onRegisterOfflineRender={handleRegisterOfflineRender} /><AudioMasterVolumeWidget /></div>
            <div style={{ background: '#181825', borderTop: '1px solid #313244', padding: '4px 10px', display: 'flex', alignItems: 'center', gap: '10px', fontSize: '10px', fontFamily: 'monospace', color: '#585b70', minHeight: '28px', flexShrink: 0 }}>
              {pixelSample ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <div style={{ width: '12px', height: '12px', borderRadius: '2px', flexShrink: 0, background: `rgb(${pixelSample[0]},${pixelSample[1]},${pixelSample[2]})`, border: '1px solid #45475a' }} />
                  <span style={{ color: '#f38ba8' }}>r</span><span style={{ color: '#cdd6f4' }}>{(pixelSample[0]/255).toFixed(3)}</span>
                  <span style={{ color: '#a6e3a1' }}>g</span><span style={{ color: '#cdd6f4' }}>{(pixelSample[1]/255).toFixed(3)}</span>
                  <span style={{ color: '#89b4fa' }}>b</span><span style={{ color: '#cdd6f4' }}>{(pixelSample[2]/255).toFixed(3)}</span>
                </div>
              ) : probeDisplay ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', overflow: 'hidden' }}>
                  {probeDisplay.map(({ label, col, formatted }) => (
                    <span key={label} style={{ display: 'flex', alignItems: 'center', gap: '3px', flexShrink: 0 }}>
                      <span style={{ color: col, fontWeight: 700 }}>{label}</span>
                      <span style={{ color: '#cdd6f4' }}>{formatted}</span>
                    </span>
                  ))}
                </div>
              ) : <span style={{ opacity: 0.4 }}>{selectedNodeId ? 'computing…' : 'hover for color · click node to probe'}</span>}
              <div style={{ flex: 1 }} />
              {errorBadge}
            </div>
            {errorPopup}
          </div>
        </div>
        {showExport && <ExportModal canvas={shaderCanvasRef.current} offlineRender={offlineRenderRef.current} onClose={() => setShowExport(false)} />}
        {showShortcuts && <KeyboardShortcutsModal onClose={() => setShowShortcuts(false)} />}
        <NodeSearchPalette open={searchPaletteOpen} onClose={() => setSearchPaletteOpen(false)} />
      </div>
  );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // DESKTOP LAYOUT (1024px+) — original 3-panel layout, responsively sized
  // ══════════════════════════════════════════════════════════════════════════
  const paletteW = getPaletteWidth(bp);
  const paletteBaseW = paletteUserW ?? paletteW;
  const effectivePaletteW = paletteBaseW === 0 ? 0 : paletteCollapsed ? 28 : paletteBaseW;

  return (
    <div style={{ width: '100vw', height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#11111b' }}>
      <TopNav page={page} onPageChange={setPage} />

      {page === 'shortcuts' && <ShortcutsPage />}
      {page === 'fn' && (
        <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <FunctionBuilder onNavigateToStudio={() => setPage('studio')} />
        </div>
      )}

      <div style={{ display: (page === 'studio' || page === 'glsl') ? 'flex' : 'none', flex: 1, overflow: 'hidden', userSelect: isDragging ? 'none' : undefined as undefined }}>

        {/* Left: Node Palette — hidden on GLSL page */}
        {page === 'studio' && paletteBaseW > 0 && (
          <div style={{ width: effectivePaletteW, minWidth: effectivePaletteW, flexShrink: 0, overflow: 'hidden', height: '100%', position: 'relative', background: '#181825', borderRight: '1px solid #313244' }}>
            {/* Collapsed state: show only an expand button */}
            {paletteCollapsed ? (
              <button
                onClick={() => setPaletteCollapsed(false)}
                title="Expand palette"
                style={{
                  position: 'absolute', top: '8px', left: '50%', transform: 'translateX(-50%)',
                  zIndex: 10, background: 'none', border: '1px solid #313244',
                  color: '#45475a', cursor: 'pointer', borderRadius: '3px',
                  fontSize: '10px', padding: '2px 4px', lineHeight: 1,
                  transition: 'color 0.1s',
                }}
                onMouseEnter={e => ((e.currentTarget as HTMLButtonElement).style.color = '#cdd6f4')}
                onMouseLeave={e => ((e.currentTarget as HTMLButtonElement).style.color = '#45475a')}
              >▶</button>
            ) : (
              <>
                <NodePalette onCollapse={() => setPaletteCollapsed(true)} />
                {/* Resize handle */}
                <div
                  onMouseDown={handlePaletteResizeStart}
                  title="Drag to resize"
                  style={{
                    position: 'absolute', right: 0, top: 0, bottom: 0, width: '4px',
                    cursor: 'col-resize', zIndex: 20, background: 'transparent',
                    transition: 'background 0.15s',
                  }}
                  onMouseEnter={e => ((e.currentTarget as HTMLDivElement).style.background = '#45475a')}
                  onMouseLeave={e => ((e.currentTarget as HTMLDivElement).style.background = 'transparent')}
                />
              </>
            )}
          </div>
        )}

        {/* Center content */}
        <div style={{ flex: 1, position: 'relative', minWidth: 0 }}>
          {page === 'studio' && (
            <>
              {/* Toolbar — collapses to icon-only on small screens */}
              {graphToolbarEl}

              {/* Code toggle */}
              <button
                onClick={() => setShowCode(v => !v)}
                style={{ position: 'absolute', bottom: showCode ? 248 : 8, right: 8, zIndex: 15, ...btnStyle(showCode), fontFamily: 'monospace' }}
                onMouseEnter={e => { if (!showCode) (e.currentTarget as HTMLButtonElement).style.background = '#45475a'; }}
                onMouseLeave={e => { if (!showCode) (e.currentTarget as HTMLButtonElement).style.background = '#313244'; }}
              >
                {'{ } Code'}
              </button>

              <NodeGraph />
              {showCode && <CodePanel code={fragmentShader} onClose={() => setShowCode(false)} highlightNodeId={selectedNodeId} nodeSlugMap={nodeSlugMap} />}
              {/* Time controls: floating dock on the node-graph side of the
                  divider, vertically centered — never overlapping the
                  render canvas on the other side of it. */}
              {!previewFloated && (
                <div style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', zIndex: 10 }}>
                  <TimeControlsStrip direction="column" />
                </div>
              )}
            </>
          )}
          {page === 'glsl' && <GLSLPage />}
        </div>

        {/* Resize Divider — hidden when preview is floated */}
        {!previewFloated && (
          <div
            onMouseDown={handleDividerMouseDown}
            onTouchStart={handleDividerTouchStart}
            style={{ width: '5px', flexShrink: 0, background: isDragging ? '#45475a' : '#313244', cursor: 'col-resize', transition: 'background 0.15s' }}
            onMouseEnter={e => { if (!isDragging) (e.currentTarget as HTMLDivElement).style.background = '#45475a'; }}
            onMouseLeave={e => { if (!isDragging) (e.currentTarget as HTMLDivElement).style.background = '#313244'; }}
          />
        )}

        {/* Right: Shader Preview — hidden when floated */}
        {!previewFloated && (
          <div style={{ width: previewWidth, flexShrink: 0, display: 'flex', flexDirection: 'column' }}>
            <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
              <ShaderCanvas onCanvasReady={handleCanvasReady} onRegisterOfflineRender={handleRegisterOfflineRender} onHistogram={showHistogram ? handleHistogram : undefined} />
              {showHistogram && histData && <HistogramOverlay data={histData} />}
              {/* Overlay controls: histogram toggle + float */}
              <div style={{ position: 'absolute', top: 8, right: 8, zIndex: 10, display: 'flex', gap: '4px' }}>
                <button
                  onClick={() => setShowHistogram(v => !v)}
                  title="Toggle brightness histogram"
                  style={{ background: showHistogram ? '#cba6f722' : '#1e1e2e99', border: `1px solid ${showHistogram ? '#cba6f7' : '#45475a'}`, color: showHistogram ? '#cba6f7' : '#585b70', borderRadius: '4px', padding: '3px 7px', fontSize: '11px', cursor: 'pointer', backdropFilter: 'blur(4px)' }}
                  onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = '#cba6f7'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = showHistogram ? '#cba6f7' : '#585b70'; }}
                >∿</button>
                <button
                  onClick={() => { setPreviewFloated(true); setFloatPos({ x: window.innerWidth - floatSize.w - 20, y: 60 }); }}
                  title="Float preview"
                  style={{ background: '#1e1e2e99', border: '1px solid #45475a', color: '#585b70', borderRadius: '4px', padding: '3px 7px', fontSize: '11px', cursor: 'pointer', backdropFilter: 'blur(4px)' }}
                  onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = '#cdd6f4'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = '#585b70'; }}
                >⊞</button>
              </div>
            </div>
            {/* Status bar */}
            <div style={{ background: '#181825', borderTop: '1px solid #313244', padding: '4px 10px', display: 'flex', alignItems: 'center', gap: '10px', fontSize: '10px', fontFamily: 'monospace', color: '#585b70', minHeight: '28px', flexShrink: 0 }}>
              {pixelSample ? (
                <div title="Pixel color under cursor (0.0–1.0)" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <div style={{ width: '12px', height: '12px', borderRadius: '2px', flexShrink: 0, background: `rgb(${pixelSample[0]},${pixelSample[1]},${pixelSample[2]})`, border: '1px solid #45475a' }} />
                  <span style={{ color: '#f38ba8' }}>r</span><span style={{ color: '#cdd6f4' }}>{(pixelSample[0]/255).toFixed(3)}</span>
                  <span style={{ color: '#a6e3a1' }}>g</span><span style={{ color: '#cdd6f4' }}>{(pixelSample[1]/255).toFixed(3)}</span>
                  <span style={{ color: '#89b4fa' }}>b</span><span style={{ color: '#cdd6f4' }}>{(pixelSample[2]/255).toFixed(3)}</span>
                </div>
              ) : probeDisplay ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', overflow: 'hidden' }}>
                  {probeDisplay.map(({ label, col, formatted }) => (
                    <span key={label} style={{ display: 'flex', alignItems: 'center', gap: '3px', flexShrink: 0 }}>
                      <span style={{ color: col, fontWeight: 700 }}>{label}</span>
                      <span style={{ color: '#cdd6f4' }}>{formatted}</span>
                    </span>
                  ))}
                </div>
              ) : <span style={{ opacity: 0.4 }}>{selectedNodeId ? 'computing…' : 'hover for color · click node to probe'}</span>}
              <div style={{ flex: 1 }} />
              {errorBadge}
            </div>
            {errorPopup}
          </div>
        )}
      </div>

      {/* Floating preview window */}
      {previewFloated && (
        <div
          ref={floatContainerRef}
          style={{
            position: 'fixed',
            left: floatPos.x,
            top: floatPos.y,
            width: floatSize.w,
            height: floatSize.h,
            zIndex: 500,
            display: 'flex',
            flexDirection: 'column',
            background: '#181825',
            border: '1px solid #45475a',
            borderRadius: '8px',
            boxShadow: '0 8px 32px rgba(0,0,0,0.7)',
            overflow: 'hidden',
            resize: 'both',
            minWidth: 240,
            minHeight: 180,
          }}
        >
          {/* Drag handle / title bar */}
          <div
            onMouseDown={handleFloatHeaderMouseDown}
            style={{
              background: '#1e1e2e',
              borderBottom: '1px solid #313244',
              padding: '4px 8px',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              cursor: 'grab',
              flexShrink: 0,
              userSelect: 'none',
            }}
          >
            <span style={{ fontSize: '10px', color: '#585b70', letterSpacing: '0.06em', flex: 1 }}>PREVIEW</span>
            <span onMouseDown={e => e.stopPropagation()}><TimeControlsStrip /></span>
            <button
              onMouseDown={e => e.stopPropagation()}
              onClick={() => setShowHistogram(v => !v)}
              title="Toggle brightness histogram"
              style={{ background: 'none', border: 'none', color: showHistogram ? '#cba6f7' : '#585b70', cursor: 'pointer', fontSize: '13px', lineHeight: 1, padding: '0 2px' }}
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = '#cba6f7'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = showHistogram ? '#cba6f7' : '#585b70'; }}
            >∿</button>
            <button
              onMouseDown={e => e.stopPropagation()}
              onClick={() => setPreviewFloated(false)}
              title="Dock preview"
              style={{ background: 'none', border: 'none', color: '#585b70', cursor: 'pointer', fontSize: '13px', lineHeight: 1, padding: '0 2px' }}
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = '#cdd6f4'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = '#585b70'; }}
            >⊟</button>
          </div>

          {/* Canvas */}
          <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
            <ShaderCanvas onCanvasReady={handleCanvasReady} onRegisterOfflineRender={handleRegisterOfflineRender} onHistogram={showHistogram ? handleHistogram : undefined} />
            {showHistogram && histData && <HistogramOverlay data={histData} />}
          </div>

          {/* Status bar */}
          <div style={{ background: '#181825', borderTop: '1px solid #313244', padding: '4px 10px', display: 'flex', alignItems: 'center', gap: '10px', fontSize: '10px', fontFamily: 'monospace', color: '#585b70', minHeight: '24px', flexShrink: 0 }}>
            {pixelSample ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <div style={{ width: '10px', height: '10px', borderRadius: '2px', background: `rgb(${pixelSample[0]},${pixelSample[1]},${pixelSample[2]})`, border: '1px solid #45475a' }} />
                <span style={{ color: '#f38ba8' }}>r</span><span style={{ color: '#cdd6f4' }}>{(pixelSample[0]/255).toFixed(3)}</span>
                <span style={{ color: '#a6e3a1' }}>g</span><span style={{ color: '#cdd6f4' }}>{(pixelSample[1]/255).toFixed(3)}</span>
                <span style={{ color: '#89b4fa' }}>b</span><span style={{ color: '#cdd6f4' }}>{(pixelSample[2]/255).toFixed(3)}</span>
              </div>
            ) : probeDisplay ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', overflow: 'hidden' }}>
                {probeDisplay.map(({ label, col, formatted }) => (
                  <span key={label} style={{ display: 'flex', alignItems: 'center', gap: '3px', flexShrink: 0 }}>
                    <span style={{ color: col, fontWeight: 700 }}>{label}</span>
                    <span style={{ color: '#cdd6f4' }}>{formatted}</span>
                  </span>
                ))}
              </div>
            ) : <span style={{ opacity: 0.4 }}>{selectedNodeId ? 'computing…' : 'hover to probe'}</span>}
            <div style={{ flex: 1 }} />
            {errorBadge}
          </div>
          {errorPopup}
        </div>
      )}

      {showExport && (
        <ExportModal canvas={shaderCanvasRef.current} offlineRender={offlineRenderRef.current} onClose={() => setShowExport(false)} />
      )}
      {showShortcuts && <KeyboardShortcutsModal onClose={() => setShowShortcuts(false)} />}
      <NodeSearchPalette open={searchPaletteOpen} onClose={() => setSearchPaletteOpen(false)} />
    </div>
  );
}

export default App;
