import { useState, useLayoutEffect, useEffect, useCallback, useRef } from 'react';
import { useNodeGraphStore } from '../store/useNodeGraphStore';
import { safeSetItem } from '../utils/fileIO';
import type { FileResult } from '../utils/fileIO';
import { tokenizeLine, C, C_LIGHT } from './glslSyntax';
import { NodePalette } from './NodeGraph/NodePalette';
import { useThemeMode, useTokens } from '../theme/themeStore';
import { fontFamily, radius } from '../theme/tokens';
import { Button, IconButton } from './ui/Button';
import { Callout } from './ui/Callout';
import { Segmented } from './ui/Choice';
import { Field } from './ui/Field';

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
/**
 * Write the shader list to localStorage. Returns the outcome instead of
 * swallowing it: callers only update the in-memory list when the write
 * actually landed, so a full quota never shows a shader as "saved".
 */
function persistShaders(list: SavedShader[]): FileResult {
  return safeSetItem(SHADERS_KEY, JSON.stringify(list), 'shaders');
}

// ── Shared font/padding so overlay lines up perfectly ─────────────────────────

const EDITOR_FONT = "'Fira Code', 'JetBrains Mono', 'Cascadia Code', 'Consolas', monospace";
const EDITOR_FONT_SIZE = '12px';
const EDITOR_LINE_HEIGHT = '1.6';
const EDITOR_PADDING = '10px 12px';

// ── Component ─────────────────────────────────────────────────────────────────

export function GLSLPage() {
  const tk = useTokens();
  const mode = useThemeMode();
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
  // Where the caret should land after a programmatic edit (Tab, Enter, undo, insert).
  // Applied in a layout effect, straight after React writes the new value: a
  // controlled textarea jumps its caret to the end on every value change, and
  // restoring it a frame later let fast typing land at the end of the file.
  const pendingSel = useRef<{ start: number; end: number } | null>(null);
  const setSel = (start: number, end = start) => { pendingSel.current = { start, end }; };
  useLayoutEffect(() => {
    const ta = textareaRef.current;
    const sel = pendingSel.current;
    if (ta && sel) {
      pendingSel.current = null;
      ta.selectionStart = sel.start;
      ta.selectionEnd = sel.end;
    }
    syncScroll();
  }, [code, syncScroll]);

  // Compiling the shader on every keystroke stalls typing; wait for a pause.
  useEffect(() => {
    localStorage.setItem(EDITOR_KEY, code);
    const t = setTimeout(() => setRawGlslShader(code), 250);
    return () => clearTimeout(t);
  }, [code, setRawGlslShader]);

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
    setSel(cursorPos);
    setCode(newCode);
    pushHistory(newCode);
    requestAnimationFrame(() => ta.focus());
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
        setSel(Math.min(start, restored.length));
        setCode(restored);
      }
      return;
    }

    // ── Redo ────────────────────────────────────────────────────────────────
    if ((e.metaKey || e.ctrlKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
      e.preventDefault();
      if (undoIdx.current < undoStack.current.length - 1) {
        undoIdx.current++;
        const restored = undoStack.current[undoIdx.current];
        setSel(Math.min(start, restored.length));
        setCode(restored);
      }
      return;
    }

    // ── Tab → 4 spaces ──────────────────────────────────────────────────────
    if (e.key === 'Tab') {
      e.preventDefault();
      const newCode = code.slice(0, start) + '    ' + code.slice(end);
      setSel(start + 4);
      setCode(newCode);
      pushHistory(newCode);
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
      setSel(start + insertion.length);
      setCode(newCode);
      pushHistory(newCode);
      return;
    }

    // ── Bracket / quote wrap ────────────────────────────────────────────────
    if (e.key in BRACKET_PAIRS && start !== end) {
      e.preventDefault();
      const [open, close] = BRACKET_PAIRS[e.key];
      const selected = code.slice(start, end);
      const newCode  = code.slice(0, start) + open + selected + close + code.slice(end);
      setSel(start + 1, end + 1);
      setCode(newCode);
      pushHistory(newCode);
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
    // Only reflect the save in the list once it's actually in storage.
    if (!persistShaders(next).ok) return;
    setShaders(next);
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
    if (!persistShaders(next).ok) return;
    setShaders(next);
  };

  const commitRename = (id: string) => {
    if (!renameVal.trim()) { setRenamingId(null); return; }
    const next = shaders.map(s => s.id === id ? { ...s, name: renameVal.trim() } : s);
    if (persistShaders(next).ok) setShaders(next);
    setRenamingId(null);
  };

  const lineCount  = code.split('\n').length;
  const lines      = code.split('\n');

  const [paletteWidth, setPaletteWidth] = useState(320);
  // The node palette is an optional helper here: collapsed until asked for.
  const [paletteCollapsed, setPaletteCollapsed] = useState(true);
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

  const sideOpen = showPanel || showFnPanel;
  const pal = mode === 'dark' ? C : C_LIGHT;
  const panelHead = { height: 52, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6, padding: '0 8px 0 12px', borderBottom: `1px solid ${tk.border.subtle}` } as const;
  const caps = { fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' as const, color: tk.text.faint, margin: '10px 0 6px' };

  const chipRow = (entries: { label: string; insert: string }[]) => (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
      {entries.map(e => (
        <button
          key={e.label}
          onMouseDown={ev => ev.preventDefault()}
          onClick={() => insertAtCursor(e.insert)}
          title={`Insert: ${e.insert}`}
          style={{
            height: 26, padding: '0 8px', border: 0, borderRadius: radius.md - 1, cursor: 'pointer', whiteSpace: 'nowrap',
            background: tk.bg.panel, boxShadow: `inset 0 0 0 1px ${tk.border.default}`, color: tk.text.primary, font: `500 11.5px ${fontFamily.mono}`,
          }}
        >{e.label}</button>
      ))}
    </div>
  );

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', height: '100%', background: tk.bg.panel, color: tk.text.primary, font: `12.5px ${fontFamily.ui}`, overflow: 'hidden' }}>

      {/* ── Node palette sidebar ──────────────────────────────────────── */}
      {paletteCollapsed ? (
        <div style={{ width: 44, flexShrink: 0, display: 'flex', justifyContent: 'center', paddingTop: 10, background: tk.bg.subtle, borderRight: `1px solid ${tk.border.default}` }}>
          <IconButton icon="chevR" label="Expand sidebar" size="sm" onClick={() => setPaletteCollapsed(false)} />
        </div>
      ) : (
        <>
          <div style={{ width: paletteWidth, flexShrink: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', borderRight: `1px solid ${tk.border.default}` }}>
            <NodePalette
              context="glsl"
              onGlslInsert={insertAtCursor}
              onCollapse={() => setPaletteCollapsed(true)}
            />
          </div>
          <div onMouseDown={handlePaletteResizeStart} style={{ width: 4, marginLeft: -4, flexShrink: 0, cursor: 'col-resize', zIndex: 5 }} />
        </>
      )}

      {/* ── Editor pane ───────────────────────────────────────────────── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', borderRight: `1px solid ${tk.border.default}`, minWidth: 0 }}>
        <div style={{ ...panelHead, padding: '0 12px 0 16px' }}>
          <span style={{ fontWeight: 650, fontSize: 13.5, marginRight: 'auto', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>Fragment shader</span>
          {showSaveInput ? (
            <>
              <Field
                autoFocus
                value={saveNameVal}
                onChange={e => setSaveNameVal(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') commitSave(); if (e.key === 'Escape') { setShowSaveInput(false); setSaveNameVal(''); } }}
                placeholder="Shader name"
                height={30}
                style={{ width: 170 }}
              />
              <Button size="sm" variant="primary" disabled={!saveNameVal.trim()} onClick={commitSave}>Save</Button>
              <IconButton icon="close" label="Cancel" size="sm" onClick={() => { setShowSaveInput(false); setSaveNameVal(''); }} />
            </>
          ) : (
            <Button size="sm" variant="primary" icon="plus" onClick={() => { setShowSaveInput(true); setSaveNameVal(''); }}>Save</Button>
          )}
          <IconButton icon="graphs" label="Load the node graph's compiled shader into the editor" size="sm" onClick={() => setCode(nodeGraphShader || BOILERPLATE)} />
          <IconButton icon="reset" label="Reset to the blank template" size="sm" onClick={() => setCode(BOILERPLATE)} />
          {!sideOpen && <IconButton icon="popout" label="Show saved shaders and functions" size="sm" onClick={() => setShowPanel(true)} />}
        </div>

        {/* Code area */}
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
          {/* Line numbers — scroll-synced */}
          <div
            ref={lineNumRef}
            style={{
              width: 44, flexShrink: 0, background: tk.bg.subtle, borderRight: `1px solid ${tk.border.subtle}`,
              overflowY: 'hidden', paddingTop: EDITOR_PADDING.split(' ')[0], paddingRight: 10, textAlign: 'right',
              color: tk.text.disabled, fontSize: EDITOR_FONT_SIZE, lineHeight: EDITOR_LINE_HEIGHT, fontFamily: EDITOR_FONT,
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
                position: 'absolute', inset: 0, padding: EDITOR_PADDING,
                fontSize: EDITOR_FONT_SIZE, lineHeight: EDITOR_LINE_HEIGHT, fontFamily: EDITOR_FONT,
                whiteSpace: 'pre', overflowY: 'hidden', overflowX: 'hidden', pointerEvents: 'none', tabSize: 4,
                fontVariantLigatures: 'none', letterSpacing: 0,
              }}
            >
              {lines.map((line, i) => (
                <div key={i} style={{ minHeight: `calc(${EDITOR_LINE_HEIGHT} * ${EDITOR_FONT_SIZE})` }}>
                  {tokenizeLine(line || ' ', pal).map((tok, j) => (
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
              // The overlay never wraps, so the textarea must not either: a soft-wrapped long
              // line pushed every later line down and the caret no longer matched the text.
              wrap="off"
              spellCheck={false}
              autoCapitalize="none"
              autoCorrect="off"
              style={{
                position: 'absolute', inset: 0, background: 'transparent', color: 'transparent', caretColor: tk.text.primary,
                border: 'none', outline: 'none', resize: 'none', padding: EDITOR_PADDING,
                fontSize: EDITOR_FONT_SIZE, lineHeight: EDITOR_LINE_HEIGHT, fontFamily: EDITOR_FONT,
                tabSize: 4, overflowY: 'auto', overflowX: 'auto', zIndex: 1,
                whiteSpace: 'pre', fontVariantLigatures: 'none', letterSpacing: 0,
              }}
            />
          </div>
        </div>

        {/* Compile errors */}
        {glslErrors.length > 0 && (
          <div style={{ padding: '10px 12px', borderTop: `1px solid ${tk.border.subtle}`, maxHeight: 180, overflowY: 'auto', flexShrink: 0 }}>
            <Callout title={glslErrors.length === 1 ? 'Shader didn’t compile' : `Shader didn’t compile — ${glslErrors.length} errors`} details={glslErrors.join('\n')}>
              {glslErrors[0]}
            </Callout>
          </div>
        )}
      </div>

      {/* ── Side panel: saved shaders / functions reference ─────────── */}
      {sideOpen && (
        <div style={{ width: 240, flexShrink: 0, display: 'flex', flexDirection: 'column', background: tk.bg.subtle, borderRight: `1px solid ${tk.border.default}` }}>
          <div style={panelHead}>
            <div style={{ flex: 1 }}>
              <Segmented
                fill
                ariaLabel="Side panel"
                value={showFnPanel ? 'fns' : 'shaders'}
                onChange={v => { setShowPanel(v === 'shaders'); setShowFnPanel(v === 'fns'); }}
                options={[{ value: 'shaders', label: `Shaders${shaders.length ? ` · ${shaders.length}` : ''}` }, { value: 'fns', label: 'Functions' }]}
              />
            </div>
            <IconButton icon="close" label="Hide panel" size="sm" onClick={() => { setShowPanel(false); setShowFnPanel(false); }} />
          </div>

          {showFnPanel ? (
            <div style={{ flex: 1, overflowY: 'auto', padding: '4px 12px 12px' }}>
              <div style={caps}>GLSL built-ins</div>
              {BUILTIN_GROUPS.map(group => (
                <div key={group.name} style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: tk.text.muted, marginBottom: 5 }}>{group.name}</div>
                  {chipRow(group.entries)}
                </div>
              ))}
              <div style={caps}>Studio helpers</div>
              {STUDIO_GROUPS.map(group => (
                <div key={group.name} style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: tk.text.muted, marginBottom: 5 }}>{group.name}</div>
                  {chipRow(group.entries)}
                </div>
              ))}
            </div>
          ) : (
            <div style={{ flex: 1, overflowY: 'auto', padding: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {shaders.length === 0 ? (
                <div style={{ padding: '6px 4px', fontSize: 12, color: tk.text.faint, lineHeight: 1.5 }}>
                  No saved shaders yet. Click <b style={{ color: tk.text.muted }}>Save</b> to keep the current file here.
                </div>
              ) : shaders.map(s => (
                <SavedShaderCard
                  key={s.id}
                  name={s.name}
                  code={s.code}
                  renaming={renamingId === s.id}
                  renameVal={renameVal}
                  onRenameChange={setRenameVal}
                  onStartRename={() => { setRenamingId(s.id); setRenameVal(s.name); }}
                  onCommitRename={() => commitRename(s.id)}
                  onCancelRename={() => setRenamingId(null)}
                  onLoad={() => loadShader(s)}
                  onDelete={() => deleteShader(s.id)}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SavedShaderCard({ name, code, renaming, renameVal, onRenameChange, onStartRename, onCommitRename, onCancelRename, onLoad, onDelete }: {
  name: string; code: string; renaming: boolean; renameVal: string;
  onRenameChange: (v: string) => void; onStartRename: () => void; onCommitRename: () => void; onCancelRename: () => void;
  onLoad: () => void; onDelete: () => void;
}) {
  const tk = useTokens();
  const [hover, setHover] = useState(false);
  const preview = code.split('\n').slice(0, 3).join('\n') + (code.split('\n').length > 3 ? '\n…' : '');
  return (
    <div
      onDoubleClick={onLoad}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      title="Double-click to load"
      style={{ borderRadius: radius.lg - 2, background: tk.bg.panel, boxShadow: `inset 0 0 0 1px ${hover ? tk.border.strong : tk.border.default}`, cursor: 'pointer', overflow: 'hidden' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, height: 34, padding: '0 4px 0 10px' }}>
        {renaming ? (
          <Field
            autoFocus
            value={renameVal}
            height={26}
            onChange={e => onRenameChange(e.target.value)}
            onBlur={onCommitRename}
            onKeyDown={e => { if (e.key === 'Enter') onCommitRename(); if (e.key === 'Escape') onCancelRename(); }}
            onClick={e => e.stopPropagation()}
            style={{ flex: 1 }}
          />
        ) : (
          <span style={{ flex: 1, minWidth: 0, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
        )}
        {hover && !renaming && <IconButton icon="edit" label="Rename" size="sm" onClick={e => { e.stopPropagation(); onStartRename(); }} />}
        {hover && !renaming && <IconButton icon="trash" label="Delete" size="sm" tone="danger" onClick={e => { e.stopPropagation(); onDelete(); }} />}
      </div>
      <div style={{ padding: '6px 10px 8px', borderTop: `1px solid ${tk.border.subtle}`, font: `11px/1.5 ${fontFamily.mono}`, color: tk.text.muted, whiteSpace: 'pre', overflow: 'hidden', maxHeight: 52 }}>
        {preview}
      </div>
    </div>
  );
}
