import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import ShaderCanvas from './components/ShaderCanvas';
import { NodeGraph } from './components/NodeGraph/NodeGraph';
import { NodePalette } from './components/NodeGraph/NodePalette';
import { CodePanel } from './components/CodePanel';
import { TopNav } from './components/TopNav';
import { LearnPage } from './components/LearnPage';
import { ExportModal } from './components/ExportModal';
import { KeyboardShortcutsModal } from './components/KeyboardShortcutsModal';
import { useNodeGraphStore, EXAMPLE_GRAPHS } from './store/useNodeGraphStore';
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

function App() {
  const {
    loadExampleGraph, compilationErrors, glslErrors, pixelSample, fragmentShader,
    saveGraph, getSavedGraphNames, loadSavedGraph, deleteSavedGraph, exportGraph, importGraphFromFile,
    addNode, setNodeHighlightFilter, _fitViewCallback,
  } = useNodeGraphStore();

  const bp = useBreakpoint();
  const mobile = isMobile(bp);
  const tablet = isTablet(bp);
  void isDesktop; // used implicitly via breakpoint branching

  const [showErrors, setShowErrors]     = useState(false);
  const [previewWidth, setPreviewWidth] = useState(() => getDefaultPreviewWidth(bp));
  const [isDragging, setIsDragging]     = useState(false);
  const [showCode, setShowCode]         = useState(false);
  const [page, setPage]                 = useState<'studio' | 'learn'>('studio');
  const [activeExample, setActiveExample] = useState('fractalRings');

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
  const shaderCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const handleCanvasReady = useCallback((c: HTMLCanvasElement) => { shaderCanvasRef.current = c; }, []);

  // Update preview width when breakpoint changes
  useEffect(() => {
    setPreviewWidth(getDefaultPreviewWidth(bp));
  }, [bp]);

  // ── Keyboard shortcuts ──────────────────────────────────────────────────────
  const addRandomNode = useCallback((type: string) => {
    addNode(type, { x: 200 + Math.random() * 160, y: 120 + Math.random() * 200 });
  }, [addNode]);

  const shortcutHandlers = useMemo(() => ({
    export:         () => exportGraph(),
    import:         () => importGraphFromFile(),
    fitView:        () => _fitViewCallback?.(),
    toggleCode:     () => setShowCode(v => !v),
    toggleRecord:   () => setShowExport(v => !v),
    addNode:        () => {/* palette open handled in NodeGraph via store */},
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
    shortcuts:      () => setShowShortcuts(v => !v),
  }), [addRandomNode, exportGraph, importGraphFromFile, _fitViewCallback, setNodeHighlightFilter]);

  useShortcuts(shortcutHandlers);

  const handleSave = () => {
    const name = saveNameInput.trim();
    if (!name) return;
    saveGraph(name);
    setShowSavePanel(false);
    setSaveNameInput('');
  };

  useEffect(() => {
    loadExampleGraph('fractalRings');
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

  // ── Shared toolbar (examples + save/load/export/import) ───────────────────
  const toolbar = (compact = false) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: '5px', flexWrap: 'nowrap' }}>
      {!compact && (
        <span style={{ fontSize: '11px', color: '#585b70', letterSpacing: '0.03em', whiteSpace: 'nowrap' }}>Example</span>
      )}
      <select
        value={activeExample}
        onChange={e => { setActiveExample(e.target.value); loadExampleGraph(e.target.value); }}
        style={{
          background: '#313244', border: '1px solid #45475a', color: '#cdd6f4',
          borderRadius: '6px', padding: compact ? '5px 6px' : '4px 8px',
          fontSize: '11px', cursor: 'pointer', outline: 'none',
          maxWidth: compact ? '120px' : '140px',
        }}
      >
        {Object.entries(EXAMPLE_GRAPHS).map(([key, ex]) => (
          <option key={key} value={key}>{ex.label}</option>
        ))}
      </select>

      {!compact && <div style={{ width: '1px', height: '16px', background: '#45475a', margin: '0 2px' }} />}

      {!compact && (
        <>
          <button onClick={exportGraph} style={btnStyle()}>⬇</button>
          <button onClick={importGraphFromFile} style={btnStyle()}>⬆</button>
          <button onClick={() => setShowShortcuts(true)} style={{ ...btnStyle(), color: '#89b4fa' }} title="Keyboard shortcuts">⌨</button>
        </>
      )}
    </div>
  );

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

  // ══════════════════════════════════════════════════════════════════════════
  // MOBILE LAYOUT (< 768px)
  // Preview fills entire screen, floating nav + bottom action bar
  // ══════════════════════════════════════════════════════════════════════════
  if (mobile && page === 'studio') {
    return (
      <div style={{ width: '100vw', height: '100vh', position: 'relative', overflow: 'hidden', background: '#11111b', touchAction: 'none' }}>

        {/* Full-screen shader preview as background */}
        <div style={{ position: 'absolute', inset: 0 }}>
          <ShaderCanvas onCanvasReady={handleCanvasReady} />
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

          {/* Example picker */}
          <div style={{ flex: 1, minWidth: 0 }}>
            {toolbar(true)}
          </div>

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

        {/* Pixel color info (top-right, non-intrusive) */}
        {pixelSample && (
          <div style={{
            position: 'absolute', top: 52, right: 10, zIndex: 22,
            background: 'rgba(24,24,37,0.80)', backdropFilter: 'blur(8px)',
            borderRadius: '6px', padding: '4px 8px',
            display: 'flex', alignItems: 'center', gap: '6px',
            fontSize: '10px', fontFamily: 'monospace', color: '#585b70',
            border: '1px solid #313244',
          }}>
            <div style={{ width: '10px', height: '10px', borderRadius: '2px', background: `rgb(${pixelSample[0]},${pixelSample[1]},${pixelSample[2]})`, border: '1px solid #45475a', flexShrink: 0 }} />
            <span style={{ color: '#f38ba8' }}>r</span><span style={{ color: '#cdd6f4' }}>{(pixelSample[0]/255).toFixed(2)}</span>
            <span style={{ color: '#a6e3a1' }}>g</span><span style={{ color: '#cdd6f4' }}>{(pixelSample[1]/255).toFixed(2)}</span>
            <span style={{ color: '#89b4fa' }}>b</span><span style={{ color: '#cdd6f4' }}>{(pixelSample[2]/255).toFixed(2)}</span>
          </div>
        )}

        {/* Node graph overlay — transparent bg so shader shows through */}
        {showMobileGraph && (
          <div style={{
            position: 'absolute',
            top: 44,    // below floating nav
            left: 0,
            right: 0,
            bottom: 56, // above bottom action bar
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
          <ExportModal canvas={shaderCanvasRef.current} onClose={() => setShowExport(false)} />
        )}
        {showShortcuts && <KeyboardShortcutsModal onClose={() => setShowShortcuts(false)} />}
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

  // ══════════════════════════════════════════════════════════════════════════
  // TABLET LAYOUT (768–1024px)
  // 2-panel: collapsible palette strip | graph + preview side by side
  // ══════════════════════════════════════════════════════════════════════════
  if (tablet) {
    return (
      <div style={{ width: '100vw', height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#11111b' }}>
        <TopNav page={page} onPageChange={setPage} />

        {page === 'learn' && <LearnPage onNavigateToStudio={() => setPage('studio')} />}

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
            {/* Toolbar */}
            <div style={{ position: 'absolute', top: 8, left: 8, zIndex: 15, display: 'flex', alignItems: 'center', gap: '5px' }}>
              {toolbar(false)}
              <div style={{ width: '1px', height: '16px', background: '#45475a', margin: '0 2px' }} />
              <button onClick={() => setShowExport(true)} style={{ ...btnStyle(), color: '#cba6f7', borderColor: '#cba6f744' }} title="Export animation">
                🎬 Record
              </button>
            </div>
            {savePanelEl}
            {loadPanelEl}

            {/* Code toggle */}
            <button onClick={() => setShowCode(v => !v)} style={{ position: 'absolute', bottom: showCode ? 248 : 8, right: 8, zIndex: 15, ...btnStyle(showCode) }}>
              {'{ } Code'}
            </button>

            <NodeGraph />
            {showCode && <CodePanel code={fragmentShader} onClose={() => setShowCode(false)} />}
          </div>

          {/* Divider — wider touch target for tablet */}
          <div
            onMouseDown={handleDividerMouseDown}
            onTouchStart={handleDividerTouchStart}
            style={{ width: '8px', flexShrink: 0, background: isDragging ? '#45475a' : '#313244', cursor: 'col-resize', transition: 'background 0.15s' }}
          />

          {/* Right: Preview */}
          <div style={{ width: previewWidth, flexShrink: 0, display: 'flex', flexDirection: 'column' }}>
            <div style={{ flex: 1, position: 'relative', minHeight: 0 }}><ShaderCanvas onCanvasReady={handleCanvasReady} /></div>
            <div style={{ background: '#181825', borderTop: '1px solid #313244', padding: '4px 10px', display: 'flex', alignItems: 'center', gap: '10px', fontSize: '10px', fontFamily: 'monospace', color: '#585b70', minHeight: '28px', flexShrink: 0 }}>
              {pixelSample ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <div style={{ width: '12px', height: '12px', borderRadius: '2px', flexShrink: 0, background: `rgb(${pixelSample[0]},${pixelSample[1]},${pixelSample[2]})`, border: '1px solid #45475a' }} />
                  <span style={{ color: '#f38ba8' }}>r</span><span style={{ color: '#cdd6f4' }}>{(pixelSample[0]/255).toFixed(3)}</span>
                  <span style={{ color: '#a6e3a1' }}>g</span><span style={{ color: '#cdd6f4' }}>{(pixelSample[1]/255).toFixed(3)}</span>
                  <span style={{ color: '#89b4fa' }}>b</span><span style={{ color: '#cdd6f4' }}>{(pixelSample[2]/255).toFixed(3)}</span>
                </div>
              ) : <span style={{ opacity: 0.4 }}>hover for color</span>}
              <div style={{ flex: 1 }} />
              {errorBadge}
            </div>
            {errorPopup}
          </div>
        </div>
        {showExport && <ExportModal canvas={shaderCanvasRef.current} onClose={() => setShowExport(false)} />}
        {showShortcuts && <KeyboardShortcutsModal onClose={() => setShowShortcuts(false)} />}
      </div>
  );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // DESKTOP LAYOUT (1024px+) — original 3-panel layout, responsively sized
  // ══════════════════════════════════════════════════════════════════════════
  const paletteW = getPaletteWidth(bp);

  return (
    <div style={{ width: '100vw', height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#11111b' }}>
      <TopNav page={page} onPageChange={setPage} />

      {page === 'learn' && <LearnPage onNavigateToStudio={() => setPage('studio')} />}

      <div style={{ display: page === 'studio' ? 'flex' : 'none', flex: 1, overflow: 'hidden', userSelect: isDragging ? 'none' : undefined }}>

        {/* Left: Node Palette */}
        <div style={{ width: paletteW, minWidth: paletteW, flexShrink: 0, overflow: 'hidden', height: '100%' }}>
          <NodePalette />
        </div>

        {/* Center: Node Graph Editor */}
        <div style={{ flex: 1, position: 'relative', minWidth: 0 }}>

          {/* Toolbar */}
          <div style={{ position: 'absolute', top: 8, left: 8, zIndex: 15, display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontSize: '11px', color: '#585b70', letterSpacing: '0.03em' }}>Example</span>
            <select
              value={activeExample}
              onChange={e => { setActiveExample(e.target.value); loadExampleGraph(e.target.value); }}
              style={{ background: '#313244', border: '1px solid #45475a', color: '#cdd6f4', borderRadius: '6px', padding: '4px 8px', fontSize: '11px', cursor: 'pointer', outline: 'none' }}
            >
              {Object.entries(EXAMPLE_GRAPHS).map(([key, ex]) => (
                <option key={key} value={key}>{ex.label}</option>
              ))}
            </select>
            <div style={{ width: '1px', height: '16px', background: '#45475a', margin: '0 2px' }} />
            <button onClick={exportGraph} style={btnStyle()}>⬇ Export</button>
            <button onClick={importGraphFromFile} style={btnStyle()}>⬆ Import</button>
            <div style={{ width: '1px', height: '16px', background: '#45475a', margin: '0 2px' }} />
            <button onClick={() => setShowExport(true)} style={{ ...btnStyle(), color: '#cba6f7', borderColor: '#cba6f744' }} title="Export animation as video">
              🎬 Record
            </button>
            <button onClick={() => setShowShortcuts(true)} style={{ ...btnStyle(), color: '#89b4fa', borderColor: '#89b4fa44' }} title="Keyboard shortcuts (?)">
              ⌨ Keys
            </button>
          </div>


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
          {showCode && <CodePanel code={fragmentShader} onClose={() => setShowCode(false)} />}
        </div>

        {/* Resize Divider */}
        <div
          onMouseDown={handleDividerMouseDown}
          onTouchStart={handleDividerTouchStart}
          style={{ width: '5px', flexShrink: 0, background: isDragging ? '#45475a' : '#313244', cursor: 'col-resize', transition: 'background 0.15s' }}
          onMouseEnter={e => { if (!isDragging) (e.currentTarget as HTMLDivElement).style.background = '#45475a'; }}
          onMouseLeave={e => { if (!isDragging) (e.currentTarget as HTMLDivElement).style.background = '#313244'; }}
        />

        {/* Right: Shader Preview */}
        <div style={{ width: previewWidth, flexShrink: 0, display: 'flex', flexDirection: 'column' }}>
          <div style={{ flex: 1, position: 'relative', minHeight: 0 }}><ShaderCanvas onCanvasReady={handleCanvasReady} /></div>

          {/* Status bar */}
          <div style={{ background: '#181825', borderTop: '1px solid #313244', padding: '4px 10px', display: 'flex', alignItems: 'center', gap: '10px', fontSize: '10px', fontFamily: 'monospace', color: '#585b70', minHeight: '28px', flexShrink: 0 }}>
            {pixelSample ? (
              <div title="Pixel color under cursor (0.0–1.0)" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <div style={{ width: '12px', height: '12px', borderRadius: '2px', flexShrink: 0, background: `rgb(${pixelSample[0]},${pixelSample[1]},${pixelSample[2]})`, border: '1px solid #45475a' }} />
                <span style={{ color: '#f38ba8' }}>r</span><span style={{ color: '#cdd6f4' }}>{(pixelSample[0]/255).toFixed(3)}</span>
                <span style={{ color: '#a6e3a1' }}>g</span><span style={{ color: '#cdd6f4' }}>{(pixelSample[1]/255).toFixed(3)}</span>
                <span style={{ color: '#89b4fa' }}>b</span><span style={{ color: '#cdd6f4' }}>{(pixelSample[2]/255).toFixed(3)}</span>
              </div>
            ) : <span style={{ opacity: 0.4 }}>hover for color</span>}
            <div style={{ flex: 1 }} />
            {errorBadge}
          </div>
          {errorPopup}
        </div>
      </div>
      {showExport && (
        <ExportModal canvas={shaderCanvasRef.current} onClose={() => setShowExport(false)} />
      )}
      {showShortcuts && <KeyboardShortcutsModal onClose={() => setShowShortcuts(false)} />}
    </div>
  );
}

export default App;
