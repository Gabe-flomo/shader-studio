import { useEffect, useState, useCallback, useRef } from 'react';
import ShaderCanvas from './components/ShaderCanvas';
import { NodeGraph } from './components/NodeGraph/NodeGraph';
import { NodePalette } from './components/NodeGraph/NodePalette';
import { CodePanel } from './components/CodePanel';
import { TopNav } from './components/TopNav';
import { LearnPage } from './components/LearnPage';
import { useNodeGraphStore, EXAMPLE_GRAPHS } from './store/useNodeGraphStore';

const DEFAULT_PREVIEW_WIDTH = Math.max(Math.floor(window.innerWidth * 0.38), 420);
const MIN_PREVIEW = 250;
const MIN_GRAPH = 350;

function App() {
  const {
    loadExampleGraph, compilationErrors, glslErrors, pixelSample, fragmentShader,
    saveGraph, getSavedGraphNames, loadSavedGraph, deleteSavedGraph, exportGraph, importGraph,
  } = useNodeGraphStore();
  const [showErrors, setShowErrors] = useState(false);
  const [previewWidth, setPreviewWidth] = useState(DEFAULT_PREVIEW_WIDTH);
  const [isDragging, setIsDragging] = useState(false);
  const [showCode, setShowCode] = useState(false);

  const [page, setPage] = useState<'studio' | 'learn'>('studio');
  const [activeExample, setActiveExample] = useState('fractalRings');

  // Save / Load panel state
  const [showSavePanel, setShowSavePanel] = useState(false);
  const [showLoadPanel, setShowLoadPanel] = useState(false);
  const [saveNameInput, setSaveNameInput] = useState('');
  const [savedNames, setSavedNames] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleSave = () => {
    const name = saveNameInput.trim();
    if (!name) return;
    saveGraph(name);
    setShowSavePanel(false);
    setSaveNameInput('');
  };

  const handleOpenLoad = () => {
    setSavedNames(getSavedGraphNames());
    setShowLoadPanel(v => !v);
    setShowSavePanel(false);
  };

  const handleOpenSave = () => {
    setShowSavePanel(v => !v);
    setShowLoadPanel(false);
  };

  useEffect(() => {
    loadExampleGraph('fractalRings');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleDividerMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);

    const onMove = (ev: MouseEvent) => {
      // previewWidth = distance from right edge of window to mouse
      const newWidth = window.innerWidth - ev.clientX;
      const clamped = Math.max(MIN_PREVIEW, Math.min(newWidth, window.innerWidth - MIN_GRAPH));
      setPreviewWidth(clamped);
    };

    const onUp = () => {
      setIsDragging(false);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, []);

  return (
    <div
      style={{
        width: '100vw',
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        background: '#11111b',
      }}
    >
      {/* Top navigation bar */}
      <TopNav page={page} onPageChange={setPage} />

      {/* Learn page */}
      {page === 'learn' && (
        <LearnPage onNavigateToStudio={() => setPage('studio')} />
      )}

      {/* Studio layout */}
      <div
        style={{
          display: page === 'studio' ? 'flex' : 'none',
          flex: 1,
          overflow: 'hidden',
          // Prevent text selection while dragging divider
          userSelect: isDragging ? 'none' : undefined,
        }}
      >
      {/* Left: Node Palette */}
      <NodePalette />

      {/* Center: Node Graph Editor */}
      <div style={{ flex: 1, position: 'relative', minWidth: 0 }}>

        {/* Examples dropdown */}
        <div
          style={{
            position: 'absolute',
            top: 8,
            left: 8,
            zIndex: 15,
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
          }}
        >
          <span style={{ fontSize: '11px', color: '#585b70', letterSpacing: '0.03em' }}>Example</span>
          <select
            value={activeExample}
            onChange={e => {
              const key = e.target.value;
              setActiveExample(key);
              loadExampleGraph(key);
            }}
            style={{
              background: '#313244',
              border: '1px solid #45475a',
              color: '#cdd6f4',
              borderRadius: '6px',
              padding: '4px 8px',
              fontSize: '11px',
              cursor: 'pointer',
              outline: 'none',
            }}
          >
            {Object.entries(EXAMPLE_GRAPHS).map(([key, ex]) => (
              <option key={key} value={key}>{ex.label}</option>
            ))}
          </select>

          {/* Save / Load / Export / Import buttons */}
          <div style={{ width: '1px', height: '16px', background: '#45475a', margin: '0 2px' }} />

          {/* 💾 Save */}
          <button
            onClick={handleOpenSave}
            title="Save current graph to browser storage"
            style={{
              background: showSavePanel ? '#89b4fa22' : '#313244',
              border: `1px solid ${showSavePanel ? '#89b4fa55' : '#45475a'}`,
              color: showSavePanel ? '#89b4fa' : '#cdd6f4',
              borderRadius: '6px', padding: '4px 8px', fontSize: '11px', cursor: 'pointer',
            }}
          >💾 Save</button>

          {/* 📂 Load */}
          <button
            onClick={handleOpenLoad}
            title="Load a saved graph"
            style={{
              background: showLoadPanel ? '#89b4fa22' : '#313244',
              border: `1px solid ${showLoadPanel ? '#89b4fa55' : '#45475a'}`,
              color: showLoadPanel ? '#89b4fa' : '#cdd6f4',
              borderRadius: '6px', padding: '4px 8px', fontSize: '11px', cursor: 'pointer',
            }}
          >📂 Load</button>

          {/* ⬇ Export */}
          <button
            onClick={exportGraph}
            title="Export graph as JSON file"
            style={{
              background: '#313244', border: '1px solid #45475a', color: '#cdd6f4',
              borderRadius: '6px', padding: '4px 8px', fontSize: '11px', cursor: 'pointer',
            }}
          >⬇ Export</button>

          {/* ⬆ Import */}
          <label
            title="Import graph from JSON file"
            style={{
              background: '#313244', border: '1px solid #45475a', color: '#cdd6f4',
              borderRadius: '6px', padding: '4px 8px', fontSize: '11px', cursor: 'pointer',
              display: 'inline-flex', alignItems: 'center',
            }}
          >
            ⬆ Import
            <input
              ref={fileInputRef}
              type="file"
              accept=".json"
              style={{ display: 'none' }}
              onChange={e => {
                const file = e.target.files?.[0];
                if (!file) return;
                file.text().then(json => importGraph(json));
                // Reset so the same file can be re-imported
                if (fileInputRef.current) fileInputRef.current.value = '';
              }}
            />
          </label>
        </div>

        {/* Save panel */}
        {showSavePanel && (
          <div style={{
            position: 'absolute', top: 36, left: 8, zIndex: 20,
            background: '#1e1e2e', border: '1px solid #45475a', borderRadius: '6px',
            padding: '8px', display: 'flex', gap: '6px', alignItems: 'center',
            boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
          }}>
            <input
              autoFocus
              value={saveNameInput}
              onChange={e => setSaveNameInput(e.target.value)}
              placeholder="Graph name..."
              onKeyDown={e => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') setShowSavePanel(false); }}
              style={{
                background: '#313244', border: '1px solid #45475a', color: '#cdd6f4',
                borderRadius: '4px', padding: '3px 8px', fontSize: '11px', outline: 'none', width: '150px',
              }}
            />
            <button
              onClick={handleSave}
              disabled={!saveNameInput.trim()}
              style={{
                background: saveNameInput.trim() ? '#89b4fa22' : '#313244',
                border: `1px solid ${saveNameInput.trim() ? '#89b4fa55' : '#45475a'}`,
                color: saveNameInput.trim() ? '#89b4fa' : '#585b70',
                borderRadius: '4px', padding: '3px 10px', fontSize: '11px', cursor: saveNameInput.trim() ? 'pointer' : 'default',
              }}
            >Save</button>
            <button
              onClick={() => setShowSavePanel(false)}
              style={{
                background: 'none', border: 'none', color: '#585b70', cursor: 'pointer', fontSize: '12px', padding: '2px 4px',
              }}
            >✕</button>
          </div>
        )}

        {/* Load panel */}
        {showLoadPanel && (
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
                <button
                  onClick={() => { loadSavedGraph(name); setShowLoadPanel(false); }}
                  style={{ background: '#313244', border: '1px solid #45475a', color: '#89b4fa', borderRadius: '4px', padding: '1px 7px', fontSize: '10px', cursor: 'pointer' }}
                >Load</button>
                <button
                  onClick={() => { deleteSavedGraph(name); setSavedNames(getSavedGraphNames()); }}
                  style={{ background: 'none', border: 'none', color: '#585b70', cursor: 'pointer', fontSize: '11px', padding: '1px 3px' }}
                  title="Delete this save"
                >✕</button>
              </div>
            ))}
          </div>
        )}

        {/* Code toggle button */}
        <button
          onClick={() => setShowCode(v => !v)}
          title={showCode ? 'Hide shader code' : 'Show compiled shader code'}
          style={{
            position: 'absolute',
            bottom: showCode ? 248 : 8,
            right: 8,
            zIndex: 15,
            background: showCode ? '#89b4fa22' : '#313244',
            border: `1px solid ${showCode ? '#89b4fa55' : '#45475a'}`,
            color: showCode ? '#89b4fa' : '#cdd6f4',
            borderRadius: '6px',
            padding: '5px 10px',
            fontSize: '11px',
            cursor: 'pointer',
            letterSpacing: '0.02em',
            fontFamily: 'monospace',
          }}
          onMouseEnter={e => {
            if (!showCode) (e.currentTarget as HTMLButtonElement).style.background = '#45475a';
          }}
          onMouseLeave={e => {
            if (!showCode) (e.currentTarget as HTMLButtonElement).style.background = '#313244';
          }}
        >
          {'{ } Code'}
        </button>

        <NodeGraph />

        {/* Full shader code panel */}
        {showCode && (
          <CodePanel
            code={fragmentShader}
            onClose={() => setShowCode(false)}
          />
        )}
      </div>

      {/* Resize Divider */}
      <div
        onMouseDown={handleDividerMouseDown}
        style={{
          width: '5px',
          flexShrink: 0,
          background: isDragging ? '#45475a' : '#313244',
          cursor: 'col-resize',
          transition: 'background 0.15s',
        }}
        onMouseEnter={e => { if (!isDragging) (e.currentTarget as HTMLDivElement).style.background = '#45475a'; }}
        onMouseLeave={e => { if (!isDragging) (e.currentTarget as HTMLDivElement).style.background = '#313244'; }}
      />

      {/* Right: Shader Preview */}
      <div style={{ width: previewWidth, flexShrink: 0, display: 'flex', flexDirection: 'column' }}>
        {/* Canvas fills remaining space */}
        <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
          <ShaderCanvas />
        </div>

        {/* ── Status bar ── */}
        <div style={{
          background: '#181825',
          borderTop: '1px solid #313244',
          padding: '4px 10px',
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          fontSize: '10px',
          fontFamily: 'monospace',
          color: '#585b70',
          minHeight: '28px',
          flexShrink: 0,
        }}>
          {/* Pixel color swatch + values (shown when hovering canvas) */}
          {pixelSample ? (
            <div
              title="Pixel color under cursor (0.0–1.0)"
              style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
            >
              <div style={{
                width: '12px', height: '12px', borderRadius: '2px', flexShrink: 0,
                background: `rgb(${pixelSample[0]},${pixelSample[1]},${pixelSample[2]})`,
                border: '1px solid #45475a',
              }} />
              <span style={{ color: '#f38ba8' }}>r</span><span style={{ color: '#cdd6f4' }}>{(pixelSample[0] / 255).toFixed(3)}</span>
              <span style={{ color: '#a6e3a1' }}>g</span><span style={{ color: '#cdd6f4' }}>{(pixelSample[1] / 255).toFixed(3)}</span>
              <span style={{ color: '#89b4fa' }}>b</span><span style={{ color: '#cdd6f4' }}>{(pixelSample[2] / 255).toFixed(3)}</span>
            </div>
          ) : (
            <span style={{ opacity: 0.4 }}>hover for color</span>
          )}

          {/* Spacer */}
          <div style={{ flex: 1 }} />

          {/* Error badge — click to toggle error popup */}
          {(compilationErrors.length > 0 || glslErrors.length > 0) && (
            <button
              onClick={() => setShowErrors(v => !v)}
              title={showErrors ? 'Hide errors' : 'Show errors'}
              style={{
                background: showErrors ? '#f38ba822' : 'none',
                border: `1px solid ${showErrors ? '#f38ba855' : '#f38ba844'}`,
                color: '#f38ba8',
                borderRadius: '4px',
                padding: '1px 7px',
                fontSize: '10px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
                fontFamily: 'monospace',
              }}
            >
              <span style={{
                display: 'inline-block', width: '6px', height: '6px', borderRadius: '50%',
                background: '#f38ba8',
              }} />
              {compilationErrors.length + glslErrors.length} error{compilationErrors.length + glslErrors.length !== 1 ? 's' : ''}
            </button>
          )}
        </div>

        {/* Error popup (shown when badge is clicked) */}
        {showErrors && (compilationErrors.length > 0 || glslErrors.length > 0) && (
          <div style={{
            background: '#1e1e2e',
            border: '1px solid #f38ba8',
            borderBottom: 'none',
            padding: '8px 12px',
            fontSize: '11px',
            color: '#f38ba8',
            maxHeight: '160px',
            overflowY: 'auto',
            fontFamily: 'monospace',
            flexShrink: 0,
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
        )}
      </div>
      </div>
    </div>
  );
}

export default App;
