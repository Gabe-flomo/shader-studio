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

const STORAGE_KEY   = 'shader-studio:glsl-editor';
const SNIPPETS_KEY  = 'shader-studio:glsl-snippets';

interface Snippet {
  id: string;
  name: string;
  code: string;
}

function loadSnippets(): Snippet[] {
  try { return JSON.parse(localStorage.getItem(SNIPPETS_KEY) ?? '[]'); }
  catch { return []; }
}
function persistSnippets(s: Snippet[]) {
  try { localStorage.setItem(SNIPPETS_KEY, JSON.stringify(s)); } catch {}
}

export function GLSLPage() {
  const setRawGlslShader = useNodeGraphStore(s => s.setRawGlslShader);
  const nodeGraphShader  = useNodeGraphStore(s => s.fragmentShader);
  const glslErrors       = useNodeGraphStore(s => s.glslErrors);

  const [code, setCode]           = useState<string>(() => localStorage.getItem(STORAGE_KEY) ?? BOILERPLATE);
  const [snippets, setSnippets]   = useState<Snippet[]>(loadSnippets);
  const [showSnippets, setShowSnippets] = useState(true);
  const [renamingId, setRenamingId]     = useState<string | null>(null);
  const [renameVal, setRenameVal]       = useState('');

  const textareaRef  = useRef<HTMLTextAreaElement>(null);
  // Store last known selection so button clicks (which blur the textarea) can still read it
  const selectionRef = useRef<{ start: number; end: number }>({ start: 0, end: 0 });

  // Apply the current code on mount and whenever it changes
  useEffect(() => {
    setRawGlslShader(code);
    localStorage.setItem(STORAGE_KEY, code);
  }, [code, setRawGlslShader]);

  // Clear override on unmount so node graph resumes
  useEffect(() => {
    return () => { setRawGlslShader(null); };
  }, [setRawGlslShader]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const ta = e.currentTarget;
      const start = ta.selectionStart;
      const end   = ta.selectionEnd;
      const next  = code.slice(0, start) + '    ' + code.slice(end);
      setCode(next);
      requestAnimationFrame(() => { ta.selectionStart = ta.selectionEnd = start + 4; });
    }
  }, [code]);

  // ── Snippet actions ──────────────────────────────────────────────────────

  const saveSnippet = () => {
    const { start, end } = selectionRef.current;
    const sel = code.slice(start, end).trim();
    const snippetCode = sel || code;
    const name = window.prompt('Snippet name:', sel ? 'Selection' : 'My Snippet');
    if (!name?.trim()) return;
    const next: Snippet[] = [...snippets, { id: `snip_${Date.now()}`, name: name.trim(), code: snippetCode }];
    setSnippets(next);
    persistSnippets(next);
  };

  const insertSnippet = (s: Snippet) => {
    const ta = textareaRef.current;
    if (!ta) { setCode(c => c + '\n' + s.code); return; }
    const start = ta.selectionStart;
    const end   = ta.selectionEnd;
    const insert = (start === end ? '\n' : '') + s.code;
    const next = code.slice(0, start) + insert + code.slice(end);
    setCode(next);
    requestAnimationFrame(() => {
      ta.selectionStart = ta.selectionEnd = start + insert.length;
      ta.focus();
    });
  };

  const deleteSnippet = (id: string) => {
    const next = snippets.filter(s => s.id !== id);
    setSnippets(next);
    persistSnippets(next);
  };

  const commitRename = (id: string) => {
    if (!renameVal.trim()) { setRenamingId(null); return; }
    const next = snippets.map(s => s.id === id ? { ...s, name: renameVal.trim() } : s);
    setSnippets(next);
    persistSnippets(next);
    setRenamingId(null);
  };

  const lineCount = code.split('\n').length;

  // ── Shared button styles ──────────────────────────────────────────────────
  const btnBase: React.CSSProperties = {
    borderRadius: '4px', padding: '2px 10px',
    fontSize: '10px', cursor: 'pointer', border: '1px solid #45475a',
  };

  return (
    <div style={{ display: 'flex', height: '100%', background: '#11111b', fontFamily: 'monospace', overflow: 'hidden' }}>

      {/* ── Editor pane ─────────────────────────────────────────────────── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', borderRight: '1px solid #313244', minWidth: 0 }}>

        {/* Header bar */}
        <div style={{
          height: '36px', flexShrink: 0,
          background: '#1e1e2e', borderBottom: '1px solid #313244',
          display: 'flex', alignItems: 'center', gap: '8px', padding: '0 12px',
        }}>
          <span style={{ fontSize: '11px', color: '#585b70', letterSpacing: '0.06em', textTransform: 'uppercase', fontWeight: 700 }}>
            Fragment Shader
          </span>
          <div style={{ flex: 1 }} />

          {/* Save snippet / full shader */}
          <button
            onClick={saveSnippet}
            title="Save selected text as a snippet — or whole shader if nothing is selected"
            style={{ ...btnBase, background: '#1e1e2e', color: '#a6e3a1' }}
          >
            + Save
          </button>

          {/* From Graph */}
          <button
            onClick={() => setCode(nodeGraphShader || BOILERPLATE)}
            title="Copy current node graph output into editor"
            style={{ ...btnBase, background: '#313244', color: '#89b4fa' }}
          >
            ← From Graph
          </button>

          {/* Reset */}
          <button
            onClick={() => { if (window.confirm('Reset to boilerplate?')) setCode(BOILERPLATE); }}
            style={{ ...btnBase, background: 'none', color: '#585b70' }}
          >
            Reset
          </button>

          {/* Toggle snippets panel */}
          <button
            onClick={() => setShowSnippets(v => !v)}
            title={showSnippets ? 'Hide snippets' : 'Show snippets'}
            style={{ ...btnBase, background: showSnippets ? '#313244' : 'none', color: showSnippets ? '#cdd6f4' : '#585b70', padding: '2px 8px' }}
          >
            {showSnippets ? '▶' : '◀'} Snippets
          </button>
        </div>

        {/* Code editor area */}
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden', position: 'relative' }}>
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

          {/* Textarea */}
          <textarea
            ref={textareaRef}
            value={code}
            onChange={e => setCode(e.target.value)}
            onKeyDown={handleKeyDown}
            onSelect={e => {
              const ta = e.currentTarget;
              selectionRef.current = { start: ta.selectionStart, end: ta.selectionEnd };
            }}
            onKeyUp={e => {
              const ta = e.currentTarget;
              selectionRef.current = { start: ta.selectionStart, end: ta.selectionEnd };
            }}
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

      {/* ── Snippets panel ──────────────────────────────────────────────── */}
      {showSnippets && (
        <div style={{
          width: '220px', flexShrink: 0,
          display: 'flex', flexDirection: 'column',
          background: '#13131f', borderLeft: '1px solid #313244',
        }}>
          {/* Panel header */}
          <div style={{
            height: '36px', flexShrink: 0,
            background: '#1e1e2e', borderBottom: '1px solid #313244',
            display: 'flex', alignItems: 'center', padding: '0 12px', gap: '6px',
          }}>
            <span style={{ fontSize: '11px', color: '#585b70', letterSpacing: '0.06em', textTransform: 'uppercase', fontWeight: 700, flex: 1 }}>
              Snippets
            </span>
            <span style={{ fontSize: '10px', color: '#45475a' }}>{snippets.length}</span>
          </div>

          {/* Snippet list */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '6px' }}>
            {snippets.length === 0 && (
              <div style={{ padding: '12px 8px', fontSize: '11px', color: '#45475a', lineHeight: 1.5 }}>
                Nothing saved yet.<br /><br />
                Click <strong style={{ color: '#585b70' }}>+ Save</strong> to save the whole shader as a file, or select a portion of code first to save just that as a reusable snippet.
              </div>
            )}
            {snippets.map(s => (
              <div
                key={s.id}
                style={{
                  marginBottom: '4px', borderRadius: '5px',
                  background: '#1e1e2e', border: '1px solid #313244',
                  overflow: 'hidden',
                }}
              >
                {/* Snippet header row */}
                <div style={{ display: 'flex', alignItems: 'center', padding: '5px 8px', gap: '4px' }}>
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
                      style={{
                        flex: 1, fontSize: '11px', background: '#11111b',
                        border: '1px solid #89b4fa', color: '#cdd6f4',
                        borderRadius: '3px', padding: '1px 4px', outline: 'none',
                      }}
                    />
                  ) : (
                    <span
                      title="Double-click to rename"
                      onDoubleClick={() => { setRenamingId(s.id); setRenameVal(s.name); }}
                      style={{ flex: 1, fontSize: '11px', color: '#cdd6f4', cursor: 'default', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                    >
                      {s.name}
                    </span>
                  )}
                  <button
                    onClick={() => deleteSnippet(s.id)}
                    title="Delete snippet"
                    style={{ fontSize: '10px', color: '#585b70', background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px', lineHeight: 1, flexShrink: 0 }}
                  >×</button>
                </div>

                {/* Code preview */}
                <div style={{
                  padding: '4px 8px 6px',
                  borderTop: '1px solid #313244',
                  fontSize: '10px', color: '#585b70',
                  fontFamily: "'Fira Code', 'Consolas', monospace",
                  whiteSpace: 'pre', overflow: 'hidden',
                  maxHeight: '52px',
                  lineHeight: 1.5,
                  textOverflow: 'ellipsis',
                }}>
                  {s.code.split('\n').slice(0, 3).join('\n')}
                  {s.code.split('\n').length > 3 ? '\n…' : ''}
                </div>

                {/* Action buttons */}
                <div style={{ display: 'flex', borderTop: '1px solid #313244' }}>
                  <button
                    onClick={() => insertSnippet(s)}
                    title="Insert at current cursor position"
                    style={{
                      flex: 1, padding: '4px 6px',
                      background: 'none', border: 'none', borderRight: '1px solid #313244',
                      color: '#89b4fa', fontSize: '10px', cursor: 'pointer',
                      fontFamily: 'inherit',
                    }}
                    onMouseEnter={e => (e.currentTarget.style.background = '#313244')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                  >
                    ↵ Insert
                  </button>
                  <button
                    onClick={() => {
                      if (code.trim() && !window.confirm('Replace editor content with this shader?')) return;
                      setCode(s.code);
                      textareaRef.current?.focus();
                    }}
                    title="Replace editor with this full shader"
                    style={{
                      flex: 1, padding: '4px 6px',
                      background: 'none', border: 'none',
                      color: '#a6e3a1', fontSize: '10px', cursor: 'pointer',
                      fontFamily: 'inherit',
                    }}
                    onMouseEnter={e => (e.currentTarget.style.background = '#313244')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                  >
                    ↺ Load
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
