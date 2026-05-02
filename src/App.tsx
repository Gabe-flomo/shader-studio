import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import ShaderCanvas, { type OfflineRenderHandle, type HistogramData } from './components/ShaderCanvas';
import { NodeGraph } from './components/NodeGraph/NodeGraph';
import { NodePalette } from './components/NodeGraph/NodePalette';
import { CodePanel } from './components/CodePanel';
import { TopNav } from './components/TopNav';
import { LearnPage } from './components/LearnPage';
import { ExportModal } from './components/ExportModal';
import { KeyboardShortcutsModal } from './components/KeyboardShortcutsModal';
import { ShortcutsPage } from './components/ShortcutsPage';
import { GLSLPage } from './components/GLSLPage';
import { FunctionBuilder } from './components/FunctionBuilder';
import { useFunctionBuilder } from './components/FunctionBuilder/useFunctionBuilder';
import type { Page } from './components/TopNav';
import { NodeSearchPalette } from './components/NodeGraph/NodeSearchPalette';
import { useNodeGraphStore } from './store/useNodeGraphStore';
import { audioEngine } from './lib/audioEngine';
import { useBreakpoint, isMobile, isTablet, isDesktop } from './hooks/useBreakpoint';
import { useShortcuts } from './hooks/useShortcuts';

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
  const [showToolbarMenu, setShowToolbarMenu] = useState(false);

  // Mobile/tablet drawer state
  const [drawerOpen, setDrawerOpen]         = useState(false);
  // Mobile: show node graph as overlay on top of preview
  const [showMobileGraph, setShowMobileGraph] = useState(false);
  // Tablet: palette sidebar expanded or icon-only
  const [paletteExpanded, setPaletteExpanded] = useState(false);

  // Save / Load panel state
  const [showSavePanel, setShowSavePanel] = useState(false);
  const [showLoadPanel, setShowLoadPanel] = useState(false);
  const [saveNameInput, setSaveNameInput] = useState('');
  const [savedNames, setSavedNames]       = useState<string[]>([]);
  // Export animation modal
  const [showExport, setShowExport]           = useState(false);
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
    wrapInLoop:     () => {
      const ids = useNodeGraphStore.getState().selectedNodeIds;
      if (ids.length >= 1) useNodeGraphStore.getState().wrapInLoop(ids);
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

      {/* On compact screens, Export + Record collapse into a ··· menu */}
      {compact ? (
        <div style={{ position: 'relative' }}>
          <button
            onClick={() => setShowToolbarMenu(v => !v)}
            style={{ ...btnStyle(showToolbarMenu), minWidth: 32 }}
            title="More actions"
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
      ) : (
        <>
          <button onClick={exportGraph} style={btnStyle()} title="Export graph">⬇ Export</button>
          <button onClick={importGraphFromFile} style={btnStyle()} title="Import graph">⬆ Import</button>
          <div style={{ width: '1px', height: '16px', background: '#45475a', margin: '0 1px' }} />
          <button onClick={() => setShowExport(true)} style={{ ...btnStyle(), color: '#cba6f7', borderColor: '#cba6f744' }} title="Record animation">🎬 Record</button>
        </>
      )}

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
    return (
      <div style={{ width: '100vw', height: '100vh', position: 'relative', overflow: 'hidden', background: '#11111b', touchAction: 'none' }}>

        {/* Full-screen shader preview as background */}
        <div style={{ position: 'absolute', inset: 0 }}>
          <ShaderCanvas onCanvasReady={handleCanvasReady} onRegisterOfflineRender={handleRegisterOfflineRender} />
          <AudioMasterVolumeWidget />
        </div>

        {/* Floating TopNav */}
        <TopNav page={page} onPageChange={setPage} floating />

        {/* Bottom action bar */}
        <div style={{
          position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 25,
          background: 'rgba(24,24,37,0.90)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          borderTop: '1px solid #313244',
          padding: '8px 12px',
          display: 'flex', alignItems: 'center', gap: '8px',
          minHeight: '56px',
        }}>
          {/* Graph overlay toggle */}
          <button
            onClick={() => setShowMobileGraph(v => !v)}
            style={{
              ...btnStyle(showMobileGraph),
              padding: '8px 12px',
              fontSize: '13px',
              flexShrink: 0,
            }}
            title={showMobileGraph ? 'Hide node graph' : 'Show node graph'}
          >
            {showMobileGraph ? '✕ Graph' : '◈ Graph'}
          </button>

          {/* Nodes drawer toggle */}
          <button
            onClick={() => setDrawerOpen(v => !v)}
            style={{
              ...btnStyle(drawerOpen),
              padding: '8px 12px',
              fontSize: '13px',
              flexShrink: 0,
            }}
          >
            ⬡ Nodes
          </button>

          {/* Error badge */}
          {errorBadge}

          {/* Record button */}
          <button
            onClick={() => setShowExport(true)}
            style={{ ...btnStyle(), padding: '8px 12px', fontSize: '13px', flexShrink: 0, color: '#cba6f7', borderColor: '#cba6f744' }}
            title="Export animation"
          >
            🎬
          </button>
        </div>

        {/* Error popup — sits above bottom bar */}
        {showErrors && errorCount > 0 && (
          <div style={{ position: 'absolute', bottom: 56, left: 0, right: 0, zIndex: 24 }}>
            {errorPopup}
          </div>
        )}

        {/* Pixel color info / param hint (top-right, non-intrusive) */}
        {(hoveredParamHint || pixelSample) && (
          <div style={{
            position: 'absolute', top: 52, right: 10, zIndex: 22,
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

        {/* Node graph overlay — fills entire screen, nav + bar float above */}
        {showMobileGraph && (
          <div style={{
            position: 'absolute',
            inset: 0,
            zIndex: 20,
          }}>
            <NodeGraph transparent />
          </div>
        )}

        {/* Bottom sheet drawer backdrop */}
        {drawerOpen && (
          <div
            onClick={() => setDrawerOpen(false)}
            style={{ position: 'absolute', inset: 0, zIndex: 28, background: 'rgba(0,0,0,0.5)' }}
          />
        )}

        {/* Bottom sheet drawer */}
        <div style={{
          position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 29,
          height: '72vh',
          background: '#1e1e2e',
          borderRadius: '16px 16px 0 0',
          borderTop: '1px solid #45475a',
          display: 'flex', flexDirection: 'column',
          transform: drawerOpen ? 'translateY(0)' : 'translateY(100%)',
          transition: 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
          boxShadow: '0 -8px 32px rgba(0,0,0,0.5)',
        }}>
          {/* Drag handle + header */}
          <div style={{ padding: '12px 16px 8px', flexShrink: 0, display: 'flex', alignItems: 'center' }}>
            <div style={{ width: '36px', height: '4px', borderRadius: '2px', background: '#45475a', margin: '0 auto 0 auto', position: 'absolute', left: '50%', transform: 'translateX(-50%)', top: '8px' }} />
            <span style={{ fontSize: '13px', fontWeight: 700, color: '#89b4fa', paddingTop: '4px' }}>Add Node</span>
            <button
              onClick={() => setDrawerOpen(false)}
              style={{ marginLeft: 'auto', background: 'none', border: 'none', color: '#585b70', cursor: 'pointer', fontSize: '16px', padding: '0 4px', touchAction: 'manipulation' }}
            >✕</button>
          </div>
          {/* Palette fills rest of drawer */}
          <NodePalette mode="drawer" onNodeAdded={() => setDrawerOpen(false)} />
        </div>

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
  if (mobile && page === 'learn') {
    return (
      <div style={{ width: '100vw', height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#11111b' }}>
        <TopNav page={page} onPageChange={setPage} />
        <LearnPage onNavigateToStudio={() => setPage('studio')} />
      </div>
    );
  }

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

        {page === 'learn' && <LearnPage onNavigateToStudio={() => setPage('studio')} />}
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

  const handlePaletteResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    paletteResizeRef.current = { startX: e.clientX, startW: paletteBaseW };
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
  }, [paletteBaseW]);

  return (
    <div style={{ width: '100vw', height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#11111b' }}>
      <TopNav page={page} onPageChange={setPage} />

      {page === 'learn' && <LearnPage onNavigateToStudio={() => setPage('studio')} />}
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
          onMouseUp={e => {
            // Capture resize changes via onMouseUp on the container
            const el = e.currentTarget as HTMLDivElement;
            setFloatSize({ w: el.offsetWidth, h: el.offsetHeight });
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
            <ShaderCanvas onCanvasReady={handleCanvasReady} onRegisterOfflineRender={handleRegisterOfflineRender} />
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
