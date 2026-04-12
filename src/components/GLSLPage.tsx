import { useState, useEffect, useCallback, useRef } from 'react';
import { useNodeGraphStore } from '../store/useNodeGraphStore';

const BOILERPLATE = `precision mediump float;
#define PI 3.1415926538
#define TAU 6.2831853072

uniform vec2 u_resolution;
uniform float u_time;
uniform vec2 u_mouse;

varying vec2 vUv;

// ── Built-in noise helpers ────────────────────────────────────────────────
vec2 noiseHash2(vec2 p) {
    p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
    return -1.0 + 2.0 * fract(sin(p) * 43758.5453123);
}
float noiseHash1(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}
float valueNoise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(noiseHash1(i), noiseHash1(i+vec2(1,0)), u.x),
               mix(noiseHash1(i+vec2(0,1)), noiseHash1(i+vec2(1,1)), u.x), u.y);
}
// ─────────────────────────────────────────────────────────────────────────

void main() {
    vec2 uv = (vUv - 0.5) * 2.0;
    uv.x *= u_resolution.x / u_resolution.y;

    gl_FragColor = vec4(vec3(0.0), 1.0);
}`;

const EDITOR_KEY  = 'shader-studio:glsl-editor';
const SHADERS_KEY = 'shader-studio:glsl-shaders';

interface SavedShader {
  id: string;
  name: string;
  code: string;
}

function loadShaders(): SavedShader[] {
  try { return JSON.parse(localStorage.getItem(SHADERS_KEY) ?? '[]'); }
  catch { return []; }
}
function persistShaders(list: SavedShader[]) {
  try { localStorage.setItem(SHADERS_KEY, JSON.stringify(list)); } catch {}
}

export function GLSLPage() {
  const setRawGlslShader = useNodeGraphStore(s => s.setRawGlslShader);
  const nodeGraphShader  = useNodeGraphStore(s => s.fragmentShader);
  const glslErrors       = useNodeGraphStore(s => s.glslErrors);

  const [code, setCode]         = useState<string>(() => localStorage.getItem(EDITOR_KEY) ?? BOILERPLATE);
  const [shaders, setShaders]   = useState<SavedShader[]>(loadShaders);
  const [showPanel, setShowPanel] = useState(true);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameVal, setRenameVal]   = useState('');

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Apply code to live preview whenever it changes
  useEffect(() => {
    setRawGlslShader(code);
    localStorage.setItem(EDITOR_KEY, code);
  }, [code, setRawGlslShader]);

  // Clear override on unmount so node graph resumes
  useEffect(() => () => { setRawGlslShader(null); }, [setRawGlslShader]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const ta = e.currentTarget;
      const start = ta.selectionStart;
      const end   = ta.selectionEnd;
      setCode(code.slice(0, start) + '    ' + code.slice(end));
      requestAnimationFrame(() => { ta.selectionStart = ta.selectionEnd = start + 4; });
    }
  }, [code]);

  // ── Shader save / load ───────────────────────────────────────────────────

  const saveShader = () => {
    const name = window.prompt('Shader name:');
    if (!name?.trim()) return;
    // Update existing entry with same name, or append
    const existing = shaders.find(s => s.name === name.trim());
    const next: SavedShader[] = existing
      ? shaders.map(s => s.id === existing.id ? { ...s, code } : s)
      : [...shaders, { id: `sh_${Date.now()}`, name: name.trim(), code }];
    setShaders(next);
    persistShaders(next);
  };

  const loadShader = (s: SavedShader) => {
    setCode(s.code);
    textareaRef.current?.focus();
  };

  const deleteShader = (id: string) => {
    const next = shaders.filter(s => s.id !== id);
    setShaders(next);
    persistShaders(next);
  };

  const commitRename = (id: string) => {
    if (!renameVal.trim()) { setRenamingId(null); return; }
    const next = shaders.map(s => s.id === id ? { ...s, name: renameVal.trim() } : s);
    setShaders(next);
    persistShaders(next);
    setRenamingId(null);
  };

  const lineCount = code.split('\n').length;

  const btnBase: React.CSSProperties = {
    borderRadius: '4px', padding: '2px 10px',
    fontSize: '10px', cursor: 'pointer', border: '1px solid #45475a',
  };

  return (
    <div style={{ display: 'flex', height: '100%', background: '#11111b', fontFamily: 'monospace', overflow: 'hidden' }}>

      {/* ── Editor pane ───────────────────────────────────────────────── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', borderRight: '1px solid #313244', minWidth: 0 }}>

        {/* Header */}
        <div style={{
          height: '36px', flexShrink: 0,
          background: '#1e1e2e', borderBottom: '1px solid #313244',
          display: 'flex', alignItems: 'center', gap: '8px', padding: '0 12px',
        }}>
          <span style={{ fontSize: '11px', color: '#585b70', letterSpacing: '0.06em', textTransform: 'uppercase', fontWeight: 700 }}>
            Fragment Shader
          </span>
          <div style={{ flex: 1 }} />

          <button onClick={saveShader} title="Save current shader" style={{ ...btnBase, background: '#1e1e2e', color: '#a6e3a1' }}>
            + Save
          </button>
          <button
            onClick={() => setCode(nodeGraphShader || BOILERPLATE)}
            title="Copy compiled node graph into editor"
            style={{ ...btnBase, background: '#313244', color: '#89b4fa' }}
          >
            ← From Graph
          </button>
          <button
            onClick={() => { if (window.confirm('Reset to boilerplate?')) setCode(BOILERPLATE); }}
            style={{ ...btnBase, background: 'none', color: '#585b70' }}
          >
            Reset
          </button>
          <button
            onClick={() => setShowPanel(v => !v)}
            title={showPanel ? 'Hide shaders panel' : 'Show shaders panel'}
            style={{ ...btnBase, background: showPanel ? '#313244' : 'none', color: showPanel ? '#cdd6f4' : '#585b70', padding: '2px 8px' }}
          >
            {showPanel ? '▶' : '◀'} Shaders
          </button>
        </div>

        {/* Code area */}
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
          {/* Line numbers */}
          <div style={{
            width: '40px', flexShrink: 0,
            background: '#13131f', borderRight: '1px solid #1e1e2e',
            overflowY: 'hidden', paddingTop: '10px',
            color: '#3d4059', fontSize: '12px', lineHeight: '1.6',
            textAlign: 'right', paddingRight: '6px',
            userSelect: 'none', pointerEvents: 'none',
          }}>
            {Array.from({ length: lineCount }, (_, i) => <div key={i}>{i + 1}</div>)}
          </div>

          <textarea
            ref={textareaRef}
            value={code}
            onChange={e => setCode(e.target.value)}
            onKeyDown={handleKeyDown}
            spellCheck={false}
            style={{
              flex: 1, background: '#13131f', color: '#cdd6f4',
              border: 'none', outline: 'none', resize: 'none',
              padding: '10px 12px', fontSize: '12px', lineHeight: '1.6',
              fontFamily: "'Fira Code', 'JetBrains Mono', 'Cascadia Code', 'Consolas', monospace",
              tabSize: 4,
            }}
          />
        </div>

        {/* Error bar */}
        {glslErrors.length > 0 && (
          <div style={{ background: '#2d1b1b', borderTop: '1px solid #f38ba833', padding: '6px 12px', maxHeight: '120px', overflowY: 'auto' }}>
            {glslErrors.map((err, i) => (
              <div key={i} style={{ fontSize: '11px', color: '#f38ba8', fontFamily: 'monospace', lineHeight: 1.5 }}>{err}</div>
            ))}
          </div>
        )}
      </div>

      {/* ── Saved shaders panel ───────────────────────────────────────── */}
      {showPanel && (
        <div style={{
          width: '200px', flexShrink: 0,
          display: 'flex', flexDirection: 'column',
          background: '#13131f',
        }}>
          <div style={{
            height: '36px', flexShrink: 0,
            background: '#1e1e2e', borderBottom: '1px solid #313244',
            display: 'flex', alignItems: 'center', padding: '0 12px',
          }}>
            <span style={{ fontSize: '11px', color: '#585b70', letterSpacing: '0.06em', textTransform: 'uppercase', fontWeight: 700, flex: 1 }}>
              Shaders
            </span>
            <span style={{ fontSize: '10px', color: '#45475a' }}>{shaders.length}</span>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: '6px' }}>
            {shaders.length === 0 ? (
              <div style={{ padding: '12px 8px', fontSize: '11px', color: '#45475a', lineHeight: 1.6 }}>
                No saved shaders.<br />Click <strong style={{ color: '#585b70' }}>+ Save</strong> to save the current file.
              </div>
            ) : shaders.map(s => (
              <div
                key={s.id}
                onDoubleClick={() => loadShader(s)}
                title="Double-click to load"
                style={{
                  marginBottom: '4px', borderRadius: '5px',
                  background: '#1e1e2e', border: '1px solid #313244',
                  cursor: 'pointer', overflow: 'hidden',
                }}
              >
                {/* Name row */}
                <div style={{ display: 'flex', alignItems: 'center', padding: '6px 8px', gap: '4px' }}>
                  {renamingId === s.id ? (
                    <input
                      autoFocus
                      value={renameVal}
                      onChange={e => setRenameVal(e.target.value)}
                      onBlur={() => commitRename(s.id)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') commitRename(s.id);
                        if (e.key === 'Escape') setRenamingId(null);
                      }}
                      onClick={e => e.stopPropagation()}
                      style={{
                        flex: 1, fontSize: '11px', background: '#11111b',
                        border: '1px solid #89b4fa', color: '#cdd6f4',
                        borderRadius: '3px', padding: '1px 4px', outline: 'none',
                      }}
                    />
                  ) : (
                    <span
                      onDoubleClick={e => { e.stopPropagation(); setRenamingId(s.id); setRenameVal(s.name); }}
                      title="Double-click to rename"
                      style={{
                        flex: 1, fontSize: '11px', color: '#cdd6f4',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}
                    >
                      {s.name}
                    </span>
                  )}
                  <button
                    onClick={e => { e.stopPropagation(); deleteShader(s.id); }}
                    title="Delete"
                    style={{ fontSize: '10px', color: '#585b70', background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px', flexShrink: 0 }}
                  >×</button>
                </div>

                {/* Code preview */}
                <div style={{
                  padding: '3px 8px 6px', borderTop: '1px solid #313244',
                  fontSize: '10px', color: '#45475a',
                  fontFamily: "'Fira Code', 'Consolas', monospace",
                  whiteSpace: 'pre', overflow: 'hidden', maxHeight: '46px', lineHeight: 1.5,
                }}>
                  {s.code.split('\n').slice(0, 3).join('\n')}
                  {s.code.split('\n').length > 3 ? '\n…' : ''}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
