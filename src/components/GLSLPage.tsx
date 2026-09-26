import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNodeGraphStore } from '../store/useNodeGraphStore';
import { safeSetItem } from '../utils/fileIO';
import type { FileResult } from '../utils/fileIO';
import { GlslEditor, type GlslEditorHandle } from './code/GlslEditor';
import { translateToStudio, dialectLabel } from '../glsl/dialects';
import { tidyGlsl } from '../glsl/format';
import { toast } from './ui/toastStore';
import { glslErrorLines } from '../compiler/nodeErrors';
import { NodePalette } from './NodeGraph/NodePalette';
import { useTokens } from '../theme/themeStore';
import { alpha, fontFamily, radius } from '../theme/tokens';
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

// ── Component ─────────────────────────────────────────────────────────────────

export function GLSLPage({ onConvert }: { onConvert?: (code: string) => void }) {
  const tk = useTokens();
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

  const editorRef = useRef<GlslEditorHandle>(null);

  // A paste from Shadertoy, GLSL Sandbox, twigl or an ES 3.00 file is read as ours before it compiles.
  const translation = useMemo(() => translateToStudio(code), [code]);
  // Compiling the shader on every keystroke stalls typing; wait for a pause.
  useEffect(() => {
    localStorage.setItem(EDITOR_KEY, code);
    const t = setTimeout(() => setRawGlslShader(translation.code), 250);
    return () => clearTimeout(t);
  }, [code, translation, setRawGlslShader]);

  useEffect(() => () => { setRawGlslShader(null); }, [setRawGlslShader]);

  const insertAtCursor = (text: string) => editorRef.current?.insertAtCursor(text);
  const glslErrorSource = useNodeGraphStore(s => s.glslErrorSource);
  // The driver's error lines, on the lines of the text as typed (through the translation's line map).
  const errorLines = useMemo(() => {
    const m = new Map<number, string>();
    for (const [i, msgs] of glslErrorLines(translation.code, glslErrorSource, glslErrors)) { const l = translation.toSourceLine(i + 1); m.set(l, m.has(l) ? `${m.get(l)} · ${msgs.join(' · ')}` : msgs.join(' · ')); }
    return m;
  }, [translation, glslErrorSource, glslErrors]);
  const tidy = () => {
    const t = tidyGlsl(code);
    if (!t.changed) { toast.info('Already tidy'); return; }
    editorRef.current?.replaceAll(t.code);
    toast.success(t.dialect === 'studio' ? 'Tidied' : `Tidied, read as ${dialectLabel(t.dialect)}`, { message: [...t.notes, ...t.unsupported].join(' · ') || 'Indentation and spacing made regular.' });
  };

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
    editorRef.current?.replaceAll(s.code);
    editorRef.current?.focus();
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
          <span style={{ fontWeight: 650, fontSize: 13.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>Fragment shader</span>
          {translation.dialect !== 'studio' && (
            <span
              title={[...translation.notes, ...translation.unsupported.map(u => `⚠ ${u}`)].join('\n')}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 5, height: 22, padding: '0 8px', borderRadius: 11, whiteSpace: 'nowrap', background: translation.unsupported.length ? alpha(tk.status.warning, 0.16) : alpha(tk.accent.base, 0.14), color: translation.unsupported.length ? tk.status.warningText : tk.accent.base, font: `600 11px ${fontFamily.ui}`, cursor: 'help' }}
            >Read as {dialectLabel(translation.dialect)}</span>
          )}
          <span style={{ marginRight: 'auto' }} />
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
          <Button size="sm" variant="ghost" onClick={tidy} title="Rewrite the text as Playfield GLSL: our names for time, resolution, mouse and the entry point, regular indentation">Tidy</Button>
          {onConvert && <Button size="sm" variant="ghost" icon="nodes" onClick={() => onConvert(code)} title="Open this shader on the Convert page and see the nodes it would become">Convert</Button>}
          <IconButton icon="copy" label="Copy the whole shader" size="sm" onClick={() => { navigator.clipboard?.writeText(code).then(() => toast.success('Copied'), () => toast.error('Couldn’t copy')); }} />
          <IconButton icon="graphs" label="Load the node graph's compiled shader into the editor" size="sm" onClick={() => setCode(nodeGraphShader || BOILERPLATE)} />
          <IconButton icon="reset" label="Reset to the blank template" size="sm" onClick={() => setCode(BOILERPLATE)} />
          <IconButton icon="trash" label="Clear the editor" size="sm" onClick={() => setCode('')} />
          {!sideOpen && <IconButton icon="popout" label="Show saved shaders and functions" size="sm" onClick={() => setShowPanel(true)} />}
        </div>

        {/* Code area */}
        <GlslEditor ref={editorRef} value={code} onChange={setCode} ariaLabel="Fragment shader source" errorLines={errorLines} />

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
