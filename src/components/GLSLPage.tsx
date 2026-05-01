import { useState, useEffect, useCallback, useRef } from 'react';
import { useNodeGraphStore } from '../store/useNodeGraphStore';
import { tokenizeLine, C } from './CodePanel';
import { NodePalette } from './NodeGraph/NodePalette';

// ── Boilerplate ───────────────────────────────────────────────────────────────

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

// ── Function palette data ─────────────────────────────────────────────────────

interface FnEntry { label: string; insert: string; }
interface FnGroup { name: string; entries: FnEntry[]; }

const BUILTIN_GROUPS: FnGroup[] = [
  { name: 'Trig', entries: [
    { label: 'sin()', insert: 'sin()' },
    { label: 'cos()', insert: 'cos()' },
    { label: 'tan()', insert: 'tan()' },
    { label: 'atan(y,x)', insert: 'atan(, )' },
    { label: 'asin()', insert: 'asin()' },
    { label: 'acos()', insert: 'acos()' },
  ]},
  { name: 'Math', entries: [
    { label: 'abs()', insert: 'abs()' },
    { label: 'sign()', insert: 'sign()' },
    { label: 'floor()', insert: 'floor()' },
    { label: 'ceil()', insert: 'ceil()' },
    { label: 'fract()', insert: 'fract()' },
    { label: 'mod(f,f)', insert: 'mod(, )' },
    { label: 'min(f,f)', insert: 'min(, )' },
    { label: 'max(f,f)', insert: 'max(, )' },
    { label: 'clamp(f,0,1)', insert: 'clamp(, 0.0, 1.0)' },
    { label: 'mix(a,b,t)', insert: 'mix(, , )' },
    { label: 'step(e,x)', insert: 'step(, )' },
    { label: 'smoothstep()', insert: 'smoothstep(0.0, 1.0, )' },
    { label: 'sqrt()', insert: 'sqrt()' },
    { label: 'pow(b,e)', insert: 'pow(, )' },
    { label: 'exp()', insert: 'exp()' },
    { label: 'log()', insert: 'log()' },
  ]},
  { name: 'Vector', entries: [
    { label: 'length()', insert: 'length()' },
    { label: 'distance(a,b)', insert: 'distance(, )' },
    { label: 'dot(a,b)', insert: 'dot(, )' },
    { label: 'cross(a,b)', insert: 'cross(, )' },
    { label: 'normalize()', insert: 'normalize()' },
    { label: 'reflect(i,n)', insert: 'reflect(, )' },
    { label: 'refract(i,n,r)', insert: 'refract(, , )' },
  ]},
  { name: 'Texture', entries: [
    { label: 'texture2D(s,uv)', insert: 'texture2D(, )' },
  ]},
  { name: 'Deriv', entries: [
    { label: 'dFdx()', insert: 'dFdx()' },
    { label: 'dFdy()', insert: 'dFdy()' },
    { label: 'fwidth()', insert: 'fwidth()' },
  ]},
];

const STUDIO_GROUPS: FnGroup[] = [
  { name: 'Helpers', entries: [
    { label: 'valueNoise(uv)', insert: 'valueNoise()' },
    { label: 'noiseHash1(uv)', insert: 'noiseHash1()' },
    { label: 'noiseHash2(uv)', insert: 'noiseHash2()' },
  ]},
  { name: 'Uniforms', entries: [
    { label: 'u_time', insert: 'u_time' },
    { label: 'u_resolution', insert: 'u_resolution' },
    { label: 'u_mouse', insert: 'u_mouse' },
  ]},
  { name: 'Constants', entries: [
    { label: 'PI', insert: 'PI' },
    { label: 'TAU', insert: 'TAU' },
  ]},
];

// ── Bracket pairs ─────────────────────────────────────────────────────────────

const BRACKET_PAIRS: Record<string, [string, string]> = {
  '(': ['(', ')'],
  '[': ['[', ']'],
  '{': ['{', '}'],
  '"': ['"', '"'],
  "'": ["'", "'"],
};

// ── Storage keys ──────────────────────────────────────────────────────────────

const EDITOR_KEY  = 'shader-studio:glsl-editor';
const SHADERS_KEY = 'shader-studio:glsl-shaders';

interface SavedShader { id: string; name: string; code: string; }
function loadShaders(): SavedShader[] {
  try { return JSON.parse(localStorage.getItem(SHADERS_KEY) ?? '[]'); } catch { return []; }
}
function persistShaders(list: SavedShader[]) {
  try { localStorage.setItem(SHADERS_KEY, JSON.stringify(list)); } catch {}
}

// ── Shared font/padding so overlay lines up perfectly ─────────────────────────

const EDITOR_FONT = "'Fira Code', 'JetBrains Mono', 'Cascadia Code', 'Consolas', monospace";
const EDITOR_FONT_SIZE = '12px';
const EDITOR_LINE_HEIGHT = '1.6';
const EDITOR_PADDING = '10px 12px';

// ── Component ─────────────────────────────────────────────────────────────────

export function GLSLPage() {
  const setRawGlslShader = useNodeGraphStore(s => s.setRawGlslShader);
  const nodeGraphShader  = useNodeGraphStore(s => s.fragmentShader);
  const glslErrors       = useNodeGraphStore(s => s.glslErrors);

  const [code, setCode]         = useState<string>(() => localStorage.getItem(EDITOR_KEY) ?? BOILERPLATE);
  const [shaders, setShaders]   = useState<SavedShader[]>(loadShaders);
  const [showPanel, setShowPanel]   = useState(true);
  const [showFnPanel, setShowFnPanel] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameVal, setRenameVal]   = useState('');
  const [showSaveInput, setShowSaveInput] = useState(false);
  const [saveNameVal, setSaveNameVal]     = useState('');

  const textareaRef  = useRef<HTMLTextAreaElement>(null);
  const highlightRef = useRef<HTMLDivElement>(null);
  const lineNumRef   = useRef<HTMLDivElement>(null);

  // ── Undo / redo stack ──────────────────────────────────────────────────────
  const undoStack = useRef<string[]>([localStorage.getItem(EDITOR_KEY) ?? BOILERPLATE]);
  const undoIdx   = useRef<number>(0);
  const pushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const pushHistory = useCallback((value: string) => {
    if (pushTimer.current) clearTimeout(pushTimer.current);
    pushTimer.current = setTimeout(() => {
      const stack = undoStack.current.slice(0, undoIdx.current + 1);
      if (stack[stack.length - 1] === value) return;
      stack.push(value);
      if (stack.length > 100) stack.shift();
      undoStack.current = stack;
      undoIdx.current   = stack.length - 1;
    }, 400);
  }, []);

  // ── Sync overlay scroll ────────────────────────────────────────────────────
  const syncScroll = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    if (highlightRef.current) {
      highlightRef.current.scrollTop  = ta.scrollTop;
      highlightRef.current.scrollLeft = ta.scrollLeft;
    }
    if (lineNumRef.current) {
      lineNumRef.current.scrollTop = ta.scrollTop;
    }
  }, []);

  // ── Side effects ──────────────────────────────────────────────────────────
  useEffect(() => {
    setRawGlslShader(code);
    localStorage.setItem(EDITOR_KEY, code);
    // Re-sync overlay scroll after every code change — the browser silently
    // repositions the textarea on paste/undo without firing onScroll.
    requestAnimationFrame(syncScroll);
  }, [code, setRawGlslShader, syncScroll]);

  useEffect(() => () => { setRawGlslShader(null); }, [setRawGlslShader]);

  // ── Insert helper (preserves undo via manual stack) ───────────────────────
  const insertAtCursor = useCallback((text: string) => {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end   = ta.selectionEnd;
    const selected = code.slice(start, end);
    let newCode: string;
    let cursorPos: number;

    // If text ends with an empty arg slot '()' and there's a selection, wrap it
    if (selected && text.endsWith('()')) {
      newCode   = code.slice(0, start) + text.slice(0, -1) + selected + ')' + code.slice(end);
      cursorPos = start + text.length - 1 + selected.length + 1;
    } else {
      newCode   = code.slice(0, start) + text + code.slice(end);
      // Place cursor at first empty comma slot or after the insertion
      const innerOffset = text.indexOf('()') !== -1 ? text.indexOf('()') + 1 :
                          text.indexOf(', )') !== -1 ? text.indexOf(', )') + 2 :
                          text.length;
      cursorPos = start + innerOffset;
    }
    setCode(newCode);
    pushHistory(newCode);
    requestAnimationFrame(() => {
      ta.focus();
      ta.selectionStart = ta.selectionEnd = cursorPos;
    });
  }, [code, pushHistory]);

  // ── Keyboard handler ──────────────────────────────────────────────────────
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const ta = e.currentTarget;
    const start = ta.selectionStart;
    const end   = ta.selectionEnd;

    // ── Undo ────────────────────────────────────────────────────────────────
    if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey) {
      e.preventDefault();
      if (pushTimer.current) { clearTimeout(pushTimer.current); pushTimer.current = null; }
      if (undoIdx.current > 0) {
        undoIdx.current--;
        const restored = undoStack.current[undoIdx.current];
        setCode(restored);
        requestAnimationFrame(() => { ta.selectionStart = ta.selectionEnd = start; });
      }
      return;
    }

    // ── Redo ────────────────────────────────────────────────────────────────
    if ((e.metaKey || e.ctrlKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
      e.preventDefault();
      if (undoIdx.current < undoStack.current.length - 1) {
        undoIdx.current++;
        const restored = undoStack.current[undoIdx.current];
        setCode(restored);
        requestAnimationFrame(() => { ta.selectionStart = ta.selectionEnd = start; });
      }
      return;
    }

    // ── Tab → 4 spaces ──────────────────────────────────────────────────────
    if (e.key === 'Tab') {
      e.preventDefault();
      const newCode = code.slice(0, start) + '    ' + code.slice(end);
      setCode(newCode);
      pushHistory(newCode);
      requestAnimationFrame(() => { ta.selectionStart = ta.selectionEnd = start + 4; });
      return;
    }

    // ── Enter → auto-indent ─────────────────────────────────────────────────
    if (e.key === 'Enter') {
      e.preventDefault();
      const lineStart = code.lastIndexOf('\n', start - 1) + 1;
      const line      = code.slice(lineStart, start);
      const indent    = line.match(/^(\s*)/)?.[1] ?? '';
      // Also bump indent after an opening brace
      const extra     = line.trimEnd().endsWith('{') ? '    ' : '';
      const insertion = '\n' + indent + extra;
      const newCode   = code.slice(0, start) + insertion + code.slice(end);
      setCode(newCode);
      pushHistory(newCode);
      requestAnimationFrame(() => { ta.selectionStart = ta.selectionEnd = start + insertion.length; });
      return;
    }

    // ── Bracket / quote wrap ────────────────────────────────────────────────
    if (e.key in BRACKET_PAIRS && start !== end) {
      e.preventDefault();
      const [open, close] = BRACKET_PAIRS[e.key];
      const selected = code.slice(start, end);
      const newCode  = code.slice(0, start) + open + selected + close + code.slice(end);
      setCode(newCode);
      pushHistory(newCode);
      requestAnimationFrame(() => { ta.selectionStart = start + 1; ta.selectionEnd = end + 1; });
      return;
    }
  }, [code, pushHistory]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setCode(val);
    pushHistory(val);
  }, [pushHistory]);

  // ── Shader save / load ────────────────────────────────────────────────────
  const commitSave = () => {
    const name = saveNameVal.trim();
    if (!name) return;
    const existing = shaders.find(s => s.name === name);
    const next: SavedShader[] = existing
      ? shaders.map(s => s.id === existing.id ? { ...s, code } : s)
      : [...shaders, { id: `sh_${Date.now()}`, name, code }];
    setShaders(next);
    persistShaders(next);
    setShowSaveInput(false);
    setSaveNameVal('');
  };

  const loadShader = (s: SavedShader) => {
    setCode(s.code);
    // Push loaded code to undo stack
    const stack = undoStack.current.slice(0, undoIdx.current + 1);
    stack.push(s.code);
    undoStack.current = stack;
    undoIdx.current   = stack.length - 1;
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

  const lineCount  = code.split('\n').length;
  const lines      = code.split('\n');

  const [paletteWidth, setPaletteWidth] = useState(210);
  const [paletteCollapsed, setPaletteCollapsed] = useState(false);
  const paletteResizeRef = useRef<{ startX: number; startW: number } | null>(null);

  const handlePaletteResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    paletteResizeRef.current = { startX: e.clientX, startW: paletteWidth };
    const onMove = (ev: MouseEvent) => {
      if (!paletteResizeRef.current) return;
      const delta = ev.clientX - paletteResizeRef.current.startX;
      setPaletteWidth(Math.max(160, Math.min(400, paletteResizeRef.current.startW + delta)));
    };
    const onUp = () => {
      paletteResizeRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [paletteWidth]);

  const btnBase: React.CSSProperties = {
    borderRadius: '4px', padding: '2px 10px',
    fontSize: '10px', cursor: 'pointer', border: '1px solid #45475a',
  };

  // ── Fn chip style helpers ─────────────────────────────────────────────────
  const chipStyle = (accent: string): React.CSSProperties => ({
    background: '#11111b',
    border: `1px solid ${accent}44`,
    color: accent,
    borderRadius: '3px',
    padding: '2px 6px',
    fontSize: '10px',
    cursor: 'pointer',
    fontFamily: EDITOR_FONT,
    lineHeight: 1.4,
  });

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', height: '100%', background: '#11111b', fontFamily: 'monospace', overflow: 'hidden' }}>

      {/* ── Node palette sidebar ──────────────────────────────────────── */}
      {paletteCollapsed ? (
        <div style={{ width: '28px', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#1e1e2e', borderRight: '1px solid #313244', cursor: 'pointer' }}
          onClick={() => setPaletteCollapsed(false)} title="Expand palette">
          <span style={{ fontSize: '10px', color: '#45475a' }}>▶</span>
        </div>
      ) : (
        <>
          <div style={{ width: paletteWidth, flexShrink: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', borderRight: '1px solid #313244' }}>
            <NodePalette
              context="glsl"
              onGlslInsert={insertAtCursor}
              onCollapse={() => setPaletteCollapsed(true)}
            />
          </div>
          <div
            onMouseDown={handlePaletteResizeStart}
            style={{ width: '4px', flexShrink: 0, background: 'transparent', cursor: 'col-resize', borderRight: '1px solid #313244' }}
            onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.background = '#3a3a5a'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
          />
        </>
      )}

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
          {showSaveInput ? (
            <>
              <input
                autoFocus
                value={saveNameVal}
                onChange={e => setSaveNameVal(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') commitSave(); if (e.key === 'Escape') { setShowSaveInput(false); setSaveNameVal(''); } }}
                placeholder="Shader name…"
                style={{ fontSize: '11px', padding: '2px 6px', borderRadius: '4px', border: '1px solid #45475a', background: '#181825', color: '#cdd6f4', outline: 'none', width: '130px' }}
              />
              <button onClick={commitSave} disabled={!saveNameVal.trim()} style={{ ...btnBase, background: saveNameVal.trim() ? '#a6e3a1' : '#313244', color: '#1e1e2e', fontWeight: 700 }}>Save</button>
              <button onClick={() => { setShowSaveInput(false); setSaveNameVal(''); }} style={{ ...btnBase, background: 'none', color: '#585b70' }}>✕</button>
            </>
          ) : (
            <button onClick={() => { setShowSaveInput(true); setSaveNameVal(''); }} title="Save current shader" style={{ ...btnBase, background: '#1e1e2e', color: '#a6e3a1' }}>
              + Save
            </button>
          )}
          <button
            onClick={() => setCode(nodeGraphShader || BOILERPLATE)}
            title="Copy compiled node graph into editor"
            style={{ ...btnBase, background: '#313244', color: '#89b4fa' }}
          >
            ← From Graph
          </button>
          <button
            onClick={() => setCode(BOILERPLATE)}
            style={{ ...btnBase, background: 'none', color: '#585b70' }}
          >
            Reset
          </button>
          <button
            onClick={() => { setShowFnPanel(v => !v); setShowPanel(false); }}
            title="Toggle GLSL functions reference"
            style={{ ...btnBase, background: showFnPanel ? '#313244' : 'none', color: showFnPanel ? '#f9e2af' : '#585b70', padding: '2px 8px' }}
          >
            ƒ Functions
          </button>
          <button
            onClick={() => { setShowPanel(v => !v); setShowFnPanel(false); }}
            title={showPanel ? 'Hide shaders panel' : 'Show shaders panel'}
            style={{ ...btnBase, background: showPanel ? '#313244' : 'none', color: showPanel ? '#cdd6f4' : '#585b70', padding: '2px 8px' }}
          >
            {showPanel ? '▶' : '◀'} Shaders
          </button>
        </div>

        {/* Code area */}
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
          {/* Line numbers — scroll-synced */}
          <div
            ref={lineNumRef}
            style={{
              width: '40px', flexShrink: 0,
              background: '#13131f', borderRight: '1px solid #1e1e2e',
              overflowY: 'hidden', paddingTop: EDITOR_PADDING.split(' ')[0],
              color: '#3d4059', fontSize: EDITOR_FONT_SIZE, lineHeight: EDITOR_LINE_HEIGHT,
              textAlign: 'right', paddingRight: '6px',
              userSelect: 'none', pointerEvents: 'none',
            }}
          >
            {Array.from({ length: lineCount }, (_, i) => <div key={i}>{i + 1}</div>)}
          </div>

          {/* Overlay container */}
          <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>

            {/* Syntax-highlighted background */}
            <div
              ref={highlightRef}
              aria-hidden="true"
              style={{
                position: 'absolute', inset: 0,
                padding: EDITOR_PADDING,
                fontSize: EDITOR_FONT_SIZE, lineHeight: EDITOR_LINE_HEIGHT,
                fontFamily: EDITOR_FONT,
                whiteSpace: 'pre',
                overflowY: 'hidden', overflowX: 'hidden',
                pointerEvents: 'none',
                tabSize: 4,
              }}
            >
              {lines.map((line, i) => (
                <div key={i} style={{ minHeight: `calc(${EDITOR_LINE_HEIGHT} * ${EDITOR_FONT_SIZE})` }}>
                  {tokenizeLine(line || ' ').map((tok, j) => (
                    <span key={j} style={{ color: tok.color }}>{tok.text}</span>
                  ))}
                </div>
              ))}
            </div>

            {/* Transparent textarea on top */}
            <textarea
              ref={textareaRef}
              value={code}
              onChange={handleChange}
              onKeyDown={handleKeyDown}
              onScroll={syncScroll}
              spellCheck={false}
              autoCapitalize="none"
              autoCorrect="off"
              style={{
                position: 'absolute', inset: 0,
                background: 'transparent',
                color: 'transparent',
                caretColor: '#cdd6f4',
                border: 'none', outline: 'none', resize: 'none',
                padding: EDITOR_PADDING,
                fontSize: EDITOR_FONT_SIZE, lineHeight: EDITOR_LINE_HEIGHT,
                fontFamily: EDITOR_FONT,
                tabSize: 4,
                overflowY: 'auto', overflowX: 'auto',
                zIndex: 1,
              }}
            />
          </div>
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

      {/* ── Functions reference panel ─────────────────────────────────── */}
      {showFnPanel && (
        <div style={{ width: '240px', flexShrink: 0, display: 'flex', flexDirection: 'column', background: '#13131f' }}>
          <div style={{ height: '36px', flexShrink: 0, background: '#1e1e2e', borderBottom: '1px solid #313244', display: 'flex', alignItems: 'center', padding: '0 12px' }}>
            <span style={{ fontSize: '11px', color: '#f9e2af', letterSpacing: '0.06em', textTransform: 'uppercase', fontWeight: 700, flex: 1 }}>
              Functions
            </span>
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: '8px' }}>
            <div style={{ fontSize: '9px', color: '#585b70', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '6px', paddingBottom: '4px', borderBottom: '1px solid #1e1e2e' }}>
              GLSL Built-ins
            </div>
            {BUILTIN_GROUPS.map(group => (
              <div key={group.name} style={{ marginBottom: '8px' }}>
                <div style={{ fontSize: '9px', color: '#45475a', fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: '3px' }}>
                  {group.name}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px' }}>
                  {group.entries.map(e => (
                    <button
                      key={e.label}
                      onMouseDown={ev => ev.preventDefault()}
                      onClick={() => insertAtCursor(e.insert)}
                      style={chipStyle(C.builtin)}
                      onMouseEnter={ev => { (ev.currentTarget as HTMLButtonElement).style.background = '#f9e2af18'; }}
                      onMouseLeave={ev => { (ev.currentTarget as HTMLButtonElement).style.background = '#11111b'; }}
                      title={`Insert: ${e.insert}`}
                    >
                      {e.label}
                    </button>
                  ))}
                </div>
              </div>
            ))}

            <div style={{ fontSize: '9px', color: '#585b70', letterSpacing: '0.08em', textTransform: 'uppercase', margin: '10px 0 6px', paddingBottom: '4px', borderBottom: '1px solid #1e1e2e' }}>
              Studio Helpers
            </div>
            {STUDIO_GROUPS.map(group => (
              <div key={group.name} style={{ marginBottom: '8px' }}>
                <div style={{ fontSize: '9px', color: '#45475a', fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: '3px' }}>
                  {group.name}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px' }}>
                  {group.entries.map(e => (
                    <button
                      key={e.label}
                      onMouseDown={ev => ev.preventDefault()}
                      onClick={() => insertAtCursor(e.insert)}
                      style={chipStyle(C.keyword)}
                      onMouseEnter={ev => { (ev.currentTarget as HTMLButtonElement).style.background = '#cba6f718'; }}
                      onMouseLeave={ev => { (ev.currentTarget as HTMLButtonElement).style.background = '#11111b'; }}
                      title={`Insert: ${e.insert}`}
                    >
                      {e.label}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Saved shaders panel ───────────────────────────────────────── */}
      {showPanel && (
        <div style={{ width: '200px', flexShrink: 0, display: 'flex', flexDirection: 'column', background: '#13131f' }}>
          <div style={{ height: '36px', flexShrink: 0, background: '#1e1e2e', borderBottom: '1px solid #313244', display: 'flex', alignItems: 'center', padding: '0 12px' }}>
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
                style={{ marginBottom: '4px', borderRadius: '5px', background: '#1e1e2e', border: '1px solid #313244', cursor: 'pointer', overflow: 'hidden' }}
              >
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
                      style={{ flex: 1, fontSize: '11px', background: '#11111b', border: '1px solid #89b4fa', color: '#cdd6f4', borderRadius: '3px', padding: '1px 4px', outline: 'none' }}
                    />
                  ) : (
                    <span
                      onDoubleClick={e => { e.stopPropagation(); setRenamingId(s.id); setRenameVal(s.name); }}
                      title="Double-click to rename"
                      style={{ flex: 1, fontSize: '11px', color: '#cdd6f4', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
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
                <div style={{ padding: '3px 8px 6px', borderTop: '1px solid #313244', fontSize: '10px', color: '#45475a', fontFamily: EDITOR_FONT, whiteSpace: 'pre', overflow: 'hidden', maxHeight: '46px', lineHeight: 1.5 }}>
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
