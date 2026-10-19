import { OPEN_SAVED_SHADER, SHADERS_CHANGED } from '../library/libraryFacade';
import { offerSetExport } from './playfile/exportMenus';
import { recordActivity } from '../files/activity';
import { redactSealedCode } from '../nodes/userNodes/userNodeRegistry';
import { ProBadgeFor } from './account/ProSheet';
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
import { Icon } from './ui/Icon';
import { Menu } from './ui/Menu';
import { FitToolbar } from './ui/FitToolbar';
import { Tooltip } from './ui/Tooltip';
import { shaderFacts, type ShaderFacts } from '../glsl/shaderFacts';
import { DiscoverFunctionsModal } from './code/DiscoverFunctionsModal';
import { PageCanvas } from './shell/PageCanvas';
import { usePageCanvas } from './shell/pageCanvasStore';
import { usePhoneLayout } from '../hooks/useBreakpoint';
import { lazyWithSuspense, type PropsOf } from './lazyWithSuspense';
import type { CodeExplorerPanel as CodeExplorerPanelT } from './codeExplorer/CodeExplorerPanel';
import { takeTextJump, useCodeJump } from '../codeExplorer/jumpStore';
import { offsetOf } from '../codeExplorer/jump';

const CodeExplorerPanel = lazyWithSuspense<PropsOf<typeof CodeExplorerPanelT>>(() => import('./codeExplorer/CodeExplorerPanel').then(m => ({ default: m.CodeExplorerPanel })));
const EXPLORER_KEY = 'glsl-editor:code-explorer';
import { pickExplainSpan } from '../lib/glslPatterns/parse';
import type { GlslExplainPanel as GlslExplainPanelT } from './explain/GlslExplainPanel';

// The explainer loads when Explain is first pressed
const GlslExplainPanel = lazyWithSuspense<PropsOf<typeof GlslExplainPanelT>>(() => import('./explain/GlslExplainPanel').then(m => ({ default: m.GlslExplainPanel })));

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

interface SavedShader { id: string; name: string; code: string; /** Folder in the list; '' or missing = none. */ group?: string; /** What the shader does, in the owner's words. */ note?: string }
const GROUPS_OPEN_KEY = 'glsl-editor:groups-open';
/** Which saved shader the editor holds, so the header can name it (and the list can mark it) across reloads. */
const OPEN_KEY = 'glsl-editor:open-shader';
const NO_GROUP = '';
function loadShaders(): SavedShader[] {
  try { return JSON.parse(localStorage.getItem(SHADERS_KEY) ?? '[]'); } catch { return []; }
}
/**
 * Write the shader list to localStorage. Returns the outcome instead of
 * swallowing it: callers only update the in-memory list when the write
 * actually landed, so a full quota never shows a shader as "saved".
 */
function persistShaders(list: SavedShader[]): FileResult {
  const r = safeSetItem(SHADERS_KEY, JSON.stringify(list), 'shaders');
  // The Library lists them too.
  if (r.ok) window.dispatchEvent(new Event(SHADERS_CHANGED));
  return r;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function GLSLPage({ onConvert }: { onConvert?: (code: string, guided?: boolean) => void }) {
  const tk = useTokens();
  const setRawGlslShader = useNodeGraphStore(s => s.setRawGlslShader);
  const nodeGraphShader  = useNodeGraphStore(s => s.fragmentShader);
  const glslErrors       = useNodeGraphStore(s => s.glslErrors);
  // Full canvas: the main preview hosted on this page, wide, with its toolbar (shell/PageCanvas.tsx); the
  // app's preview column steps aside. On a phone (which has no preview column) it sits over the editor.
  const layout = usePageCanvas(s => s.layout.glsl);
  const toggleLayout = usePageCanvas(s => s.toggleLayout);
  const full = layout === 'full';
  const { phone } = usePhoneLayout();

  const [code, setCode]         = useState<string>(() => localStorage.getItem(EDITOR_KEY) ?? BOILERPLATE);
  const [shaders, setShaders]   = useState<SavedShader[]>(loadShaders);
  // On a phone the saved-shaders panel would leave the editor a sliver: it starts closed there.
  const [showPanel, setShowPanel]   = useState(() => !phone);
  const [showFnPanel, setShowFnPanel] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameVal, setRenameVal]   = useState('');
  const [showSaveInput, setShowSaveInput] = useState(false);
  // Groups: which are folded, and the move-to menu for a card
  const [closedGroups, setClosedGroups] = useState<Set<string>>(() => { try { return new Set(JSON.parse(localStorage.getItem(GROUPS_OPEN_KEY) ?? '[]') as string[]); } catch { return new Set(); } });
  const [groupMenu, setGroupMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [newGroupFor, setNewGroupFor] = useState<string | null>(null);
  const [newGroupName, setNewGroupName] = useState('');
  const [cardMenu, setCardMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [notingId, setNotingId] = useState<string | null>(null);
  const [noteVal, setNoteVal] = useState('');
  const [filter, setFilter] = useState('');
  const [discoverOpen, setDiscoverOpen] = useState(false);
  const [explorerOpen, setExplorerOpen] = useState(() => { try { return localStorage.getItem(EXPLORER_KEY) === '1'; } catch { return false; } });
  const toggleExplorer = () => setExplorerOpen(o => { try { localStorage.setItem(EXPLORER_KEY, o ? '0' : '1'); } catch { /* preference only */ } return !o; });
  // Explain: the selection (or the statement at the caret), under the editor
  const [explainSpan, setExplainSpan] = useState<{ start: number; end: number; text: string } | null>(null);
  const explainSelection = () => {
    const sel = editorRef.current?.getSelection() ?? { start: 0, end: 0 };
    const span = pickExplainSpan(code, sel);
    setExplainSpan(span ? { ...span, text: code.slice(span.start, span.end) } : { start: sel.start, end: sel.start, text: '' });
  };
  const [openId, setOpenId] = useState<string | null>(() => { try { return localStorage.getItem(OPEN_KEY); } catch { return null; } });
  const setOpen = (id: string | null) => { setOpenId(id); try { if (id) localStorage.setItem(OPEN_KEY, id); else localStorage.removeItem(OPEN_KEY); } catch { /* preference only */ } };
  const openShader = openId ? shaders.find(s => s.id === openId) ?? null : null;
  const openEdited = !!openShader && openShader.code !== code;
  const toggleGroup = (g: string) => setClosedGroups(prev => { const n = new Set(prev); if (n.has(g)) n.delete(g); else n.add(g); try { localStorage.setItem(GROUPS_OPEN_KEY, JSON.stringify([...n])); } catch { /* preference only */ } return n; });
  const moveToGroup = (id: string, group: string) => {
    const next = shaders.map(s => (s.id === id ? { ...s, group: group || undefined } : s));
    if (persistShaders(next).ok) setShaders(next);
    setGroupMenu(null); setNewGroupFor(null); setNewGroupName('');
  };
  const renameGroup = (from: string, to: string) => {
    const t = to.trim(); if (!t || t === from) return;
    const next = shaders.map(s => (s.group === from ? { ...s, group: t } : s));
    if (persistShaders(next).ok) setShaders(next);
  };
  const groupNames = useMemo(() => [...new Set(shaders.map(s => s.group).filter((g): g is string => !!g))].sort((a, b) => a.localeCompare(b)), [shaders]);
  const shownShaders = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return shaders;
    return shaders.filter(s => [s.name, s.note ?? '', s.group ?? ''].some(x => x.toLowerCase().includes(q)));
  }, [shaders, filter]);
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
    const id = existing?.id ?? `sh_${Date.now()}`;
    const next: SavedShader[] = existing
      ? shaders.map(s => s.id === existing.id ? { ...s, code } : s)
      : [...shaders, { id, name, code }];
    // Only reflect the save in the list once it's actually in storage.
    if (!persistShaders(next).ok) return;
    recordActivity('save', name);
    setShaders(next);
    setOpen(id);
    setShowSaveInput(false);
    setSaveNameVal('');
  };

  const loadShader = (s: SavedShader) => {
    editorRef.current?.replaceAll(s.code);
    editorRef.current?.focus();
    setOpen(s.id);
  };

  // The Library renamed, deleted, imported or opened one.
  useEffect(() => {
    const reread = () => setShaders(loadShaders());
    const openOne = (e: Event) => {
      const id = (e as CustomEvent<{ id?: string }>).detail?.id;
      const s = loadShaders().find(x => x.id === id);
      if (s) { setShaders(loadShaders()); loadShader(s); }
    };
    window.addEventListener(SHADERS_CHANGED, reread);
    window.addEventListener(OPEN_SAVED_SHADER, openOne);
    return () => { window.removeEventListener(SHADERS_CHANGED, reread); window.removeEventListener(OPEN_SAVED_SHADER, openOne); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const deleteShader = (id: string) => {
    const next = shaders.filter(s => s.id !== id);
    if (!persistShaders(next).ok) return;
    setShaders(next);
    if (openId === id) setOpen(null);
  };

  /** Saved shaders plus, when the editor holds something unsaved, the editor itself. */
  const discoverSources = () => {
    const list = shaders.map(s => ({ id: s.id, name: s.name, code: s.code, group: s.group, note: s.note }));
    if (code.trim() && !(openShader && openShader.code === code)) list.unshift({ id: '__editor', name: openShader ? `${openShader.name} (edited)` : 'Current editor', code, group: undefined, note: undefined });
    return list;
  };
  const showInFile = (sourceId: string, range: { start: number; end: number }) => {
    if (sourceId !== '__editor' && sourceId !== openId) { const s = shaders.find(x => x.id === sourceId); if (!s) return; loadShader(s); }
    setDiscoverOpen(false);
    requestAnimationFrame(() => requestAnimationFrame(() => editorRef.current?.selectRange(range.start, range.end)));
  };
  // Code Explorer's jump to source: a saved shader or a linked file, opened at the line.
  const textJump = useCodeJump(s => s.text?.n ?? 0);
  useEffect(() => {
    if (!textJump) return;
    const j = takeTextJump();
    if (!j) return;
    let text: string;
    if (j.kind === 'shader') {
      const s = shaders.find(x => x.id === j.id);
      if (!s) { toast.error('That shader isn’t saved any more'); return; }
      if (openId !== s.id || code !== s.code) loadShader(s);
      text = s.code;
    } else {
      text = j.text ?? '';
      editorRef.current?.replaceAll(text);
      setOpen(null);
      toast.info(`Opened ${j.label ?? 'the file'} from its linked folder`, { message: 'Save it to keep a copy here.' });
    }
    const at = offsetOf(text, j.line, j.column);
    requestAnimationFrame(() => requestAnimationFrame(() => editorRef.current?.selectRange(at, at + j.length)));
  // eslint-disable-next-line react-hooks/exhaustive-deps -- once per request
  }, [textJump]);
  /** The source id of what the editor shows: the open saved shader when its text is unchanged, else the editor itself. */
  const currentSourceId = code.trim() ? (openShader && openShader.code === code ? openShader.id : '__editor') : undefined;

  const commitNote = (id: string) => {
    const note = noteVal.trim();
    const next = shaders.map(s => { if (s.id !== id) return s; const { note: _old, ...rest } = s; void _old; return note ? { ...rest, note } : rest; });
    if (persistShaders(next).ok) setShaders(next);
    setNotingId(null);
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
  // A phone: the Code Explorer and the saved shaders cover the editor (each has its own close)
  const phoneSheet = { position: 'absolute', inset: 0, width: 'auto', zIndex: 6 } as const;
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

  // The graph's generated code into the editor. A graph built with a sealed node pack keeps that code hidden here too.
  const openGraphShader = () => {
    if (nodeGraphShader && redactSealedCode(nodeGraphShader) !== nodeGraphShader) { toast.info('This graph uses a sealed node pack', { message: 'Its code stays hidden, so the graph’s shader can’t be opened here.' }); return; }
    setCode(nodeGraphShader || BOILERPLATE); setOpen(null);
  };

  // The way back from Full canvas sits on the canvas itself (the editor's toolbar has no room for it there).
  const smallButton = <IconButton icon="layoutCanvas" label={phone ? 'Small: hide the preview' : 'Small preview: back to the app’s preview column'} size="sm" active onClick={() => toggleLayout('glsl')} />;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', flex: 1, minWidth: 0, minHeight: 0, overflow: 'hidden' }}>
    {phone && full && <div style={{ height: '42vh', flexShrink: 0, position: 'relative' }}><PageCanvas page="glsl" phone resizable={false} tools={smallButton} /></div>}
    <div style={{ display: 'flex', flex: 1, minWidth: 0, minHeight: 0, background: tk.bg.panel, color: tk.text.primary, font: `12.5px ${fontFamily.ui}`, overflow: 'hidden', position: 'relative' }}>

      {/* ── Node palette sidebar ──────────────────────────────────────── */}
      {/* A phone has no room for the palette's 44px strip beside the editor: the Functions panel inserts code there instead. */}
      {phone ? null : paletteCollapsed ? (
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
        {/* The editor's toolbar (docs/toolbars.md): the shader's name, then Save and the everyday tools; whatever
            doesn't fit folds into the "⋯" by priority, and the rarely used ones (file actions, Step by step) live there. */}
        <div data-glsl-toolbar="" style={{ ...panelHead, padding: '0 8px 0 16px', minWidth: 0 }}>
          <span title={openShader ? `${openShader.name}${openEdited ? ' · edited since it was saved' : ' · saved'}` : 'An unsaved shader: Save gives it a name'} style={{ fontWeight: 650, fontSize: 13.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0, flex: '0 1 auto', maxWidth: phone ? 120 : 220, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{openShader ? openShader.name : 'Fragment shader'}</span>
            {openEdited && <span aria-label="Edited since it was saved" style={{ width: 7, height: 7, borderRadius: '50%', background: tk.status.warning, flexShrink: 0 }} />}
          </span>
          <FitToolbar ariaLabel="Shader tools" keepFocus moreLabel="More shader tools" style={{ marginLeft: 6 }} items={[
            ...(translation.dialect !== 'studio' ? [{
              key: 'dialect', label: `Read as ${dialectLabel(translation.dialect)}`, menu: 'never' as const, priority: 30,
              node: (
                <span
                  title={[...translation.notes, ...translation.unsupported.map(u => `⚠ ${u}`)].join('\n')}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 5, height: 22, padding: '0 8px', borderRadius: 11, whiteSpace: 'nowrap', background: translation.unsupported.length ? alpha(tk.status.warning, 0.16) : alpha(tk.accent.base, 0.14), color: translation.unsupported.length ? tk.status.warningText : tk.accent.base, font: `600 11px ${fontFamily.ui}`, cursor: 'help' }}
                >Read as {dialectLabel(translation.dialect)}</span>
              ),
            }] : []),
            { key: 'space', label: '', grow: true },
            // A phone shows no preview until asked: the way to it comes first.
            ...(phone && !full ? [{ key: 'preview', label: 'Preview', pinned: true, node: <Button size="sm" variant="ghost" icon="layoutCanvas" onClick={() => toggleLayout('glsl')} title="Show the preview above the editor">Preview</Button> }] : []),
            {
              key: 'save', label: 'Save', pinned: true,
              node: showSaveInput ? (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <Field
                    autoFocus
                    value={saveNameVal}
                    onChange={e => setSaveNameVal(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') commitSave(); if (e.key === 'Escape') { setShowSaveInput(false); setSaveNameVal(''); } }}
                    placeholder="Shader name"
                    aria-label="Shader name"
                    height={30}
                    style={{ width: phone ? 120 : 170 }}
                  />
                  <Button size="sm" variant="primary" disabled={!saveNameVal.trim()} onClick={commitSave}>Save</Button>
                  <IconButton icon="close" label="Cancel" size="sm" onClick={() => { setShowSaveInput(false); setSaveNameVal(''); }} />
                </span>
              ) : (
                <Tooltip label="Save" description="Keep this shader in your saved shaders (the panel beside the editor, and Files → Library)." placement="bottom">
                  <Button size="sm" variant="primary" icon="plus" onClick={() => { setShowSaveInput(true); setSaveNameVal(''); }}>Save</Button>
                </Tooltip>
              ),
            },
            // ── Edit
            {
              key: 'explain', group: 'Edit', label: 'Explain', hint: 'The selection, or the statement at the caret, in plain words', priority: 90,
              node: (
                <Tooltip label="Explain" description="The selection, or the statement at the caret, in plain words, under the editor." placement="bottom">
                  <Button size="sm" variant={explainSpan ? 'secondary' : 'ghost'} icon="info" data-glsl-action="explain" aria-pressed={!!explainSpan} onMouseDown={e => e.preventDefault()} onClick={explainSelection}>Explain</Button>
                </Tooltip>
              ),
              icon: 'info', active: !!explainSpan, onSelect: explainSelection,
            },
            {
              key: 'tidy', group: 'Edit', label: 'Tidy', hint: 'Even indentation, and Playfield names for time, resolution, mouse and main', priority: 85,
              node: (
                <Tooltip label="Tidy" description="Rewrite the text as Playfield GLSL: even indentation, and our names for time, resolution, mouse and the entry point. Undo brings it back." placement="bottom">
                  <Button size="sm" variant="ghost" icon="text" onClick={tidy}>Tidy</Button>
                </Tooltip>
              ),
              icon: 'text', onSelect: tidy,
            },
            { key: 'copy', group: 'Edit', label: 'Copy the shader', hint: 'The whole text, to the clipboard', icon: 'copy', priority: 40,
              onSelect: () => { navigator.clipboard?.writeText(code).then(() => toast.success('Copied'), () => toast.error('Couldn’t copy')); } },
            // ── Tools
            ...(onConvert ? [{
              key: 'convert', group: 'Tools', label: 'Convert to nodes', hint: 'Open this shader on the Convert tab and see the nodes it becomes', priority: 70,
              node: (
                <Tooltip label="Convert to nodes" description="Open this shader on the Convert tab and see the nodes it would become." placement="bottom">
                  <Button size="sm" variant="ghost" icon="nodes" onClick={() => onConvert(code)}>Convert<ProBadgeFor feature="convert" /></Button>
                </Tooltip>
              ),
              icon: 'nodes' as const, onSelect: () => onConvert(code),
            }] : []),
            { key: 'discover', group: 'Tools', label: 'Discover functions', hint: 'Find the functions in this file, or search your saved shaders', icon: 'search', priority: 50, onSelect: () => setDiscoverOpen(true) },
            { key: 'explorer', group: 'Tools', label: 'Code Explorer', hint: 'How written code uses a function, across your code and the examples', icon: 'code', active: explorerOpen, priority: 45, onSelect: toggleExplorer },
            ...(onConvert ? [{ key: 'stepByStep', group: 'Tools', label: 'Convert step by step', hint: 'Select lines, make nodes, group them (Guided Convert)', icon: 'nodes' as const, menu: 'always' as const, onSelect: () => onConvert(code, true) }] : []),
            // ── View
            ...((!sideOpen || explorerOpen) ? [{ key: 'side', group: 'View', label: 'Saved shaders and functions', hint: 'The panel beside the editor', icon: 'sidebar' as const, priority: 60, onSelect: () => { if (explorerOpen) toggleExplorer(); setShowPanel(true); } }] : []),
            ...(!full && !phone ? [{ key: 'fullCanvas', group: 'View', label: 'Full canvas', hint: 'The preview here, wide, with its toolbar (shape, full screen, Record, time)', icon: 'layoutCanvas' as const, priority: 55, onSelect: () => toggleLayout('glsl') }] : []),
            // ── File: rarely used, always in the "⋯"
            { key: 'fromGraph', group: 'File', label: 'Open the graph’s generated code', hint: 'Load the Studio graph’s compiled shader into the editor', icon: 'graphs', menu: 'always', onSelect: openGraphShader },
            { key: 'download', group: 'File', label: 'Download saved shaders…', hint: 'One .play file, or .glsl files in a ZIP, to share or to send for help', icon: 'export', menu: 'always',
              onSelect: () => offerSetExport(document.querySelector('[data-glsl-toolbar] [data-fit-more]'), 'glsl') },
            { key: 'blank', group: 'File', label: 'New blank shader', hint: 'Start again from the template', icon: 'reset', menu: 'always', onSelect: () => { setCode(BOILERPLATE); setOpen(null); } },
            { key: 'clear', group: 'File', label: 'Clear the editor', icon: 'trash', danger: true, menu: 'always', onSelect: () => { setCode(''); setOpen(null); } },
          ]} />
        </div>

        {/* Code area */}
        <GlslEditor ref={editorRef} value={code} onChange={setCode} ariaLabel="Fragment shader source" errorLines={errorLines} />
        {explainSpan && <GlslExplainPanel code={code} span={explainSpan} setCode={setCode} onClose={() => setExplainSpan(null)} />}

        {/* Compile errors */}
        {glslErrors.length > 0 && (
          <div style={{ padding: '10px 12px', borderTop: `1px solid ${tk.border.subtle}`, maxHeight: 180, overflowY: 'auto', flexShrink: 0 }}>
            <Callout title={glslErrors.length === 1 ? 'Shader didn’t compile' : `Shader didn’t compile — ${glslErrors.length} errors`} details={glslErrors.join('\n')}>
              {glslErrors[0]}
            </Callout>
          </div>
        )}
      </div>

      {explorerOpen && (
        <div style={{ width: 360, flexShrink: 0, minHeight: 0, display: 'flex', flexDirection: 'column', borderRight: `1px solid ${tk.border.default}`, position: 'relative', zIndex: 1, background: tk.bg.panel, ...(phone ? phoneSheet : null) }}>
          <div style={{ ...panelHead, padding: '0 8px 0 14px' }}>
            <span style={{ fontWeight: 650, fontSize: 13.5, flex: 1 }}>Code Explorer</span>
            <IconButton icon="close" label="Close the Code Explorer" size="sm" onClick={toggleExplorer} />
          </div>
          <div style={{ flex: 1, minHeight: 0 }}><CodeExplorerPanel compact /></div>
        </div>
      )}

      {/* ── Side panel: saved shaders / functions reference ─────────── */}
      {discoverOpen && <DiscoverFunctionsModal sources={discoverSources()} currentId={currentSourceId} onClose={() => setDiscoverOpen(false)} onShowInFile={showInFile} />}
      {groupMenu && (
        <Menu
          x={groupMenu.x} y={groupMenu.y} onClose={() => setGroupMenu(null)}
          items={[
            ...groupNames.map(g => ({ label: g, icon: 'folder' as const, hint: shaders.find(s => s.id === groupMenu.id)?.group === g ? 'here' : undefined, onSelect: () => moveToGroup(groupMenu.id, g) })),
            ...(groupNames.length ? ['separator' as const] : []),
            { label: 'New folder…', icon: 'plus' as const, onSelect: () => { setNewGroupFor(groupMenu.id); setNewGroupName(''); setGroupMenu(null); } },
            ...(shaders.find(s => s.id === groupMenu.id)?.group ? [{ label: 'Remove from folder', icon: 'unlink' as const, onSelect: () => moveToGroup(groupMenu.id, NO_GROUP) }] : []),
          ]}
        />
      )}
      {cardMenu && (() => {
        const sh = shaders.find(s => s.id === cardMenu.id);
        if (!sh) return null;
        return (
          <Menu
            x={cardMenu.x} y={cardMenu.y} onClose={() => setCardMenu(null)}
            items={[
              { label: 'Load into the editor', icon: 'import', onSelect: () => loadShader(sh) },
              { label: 'Rename', icon: 'edit', onSelect: () => { setRenamingId(sh.id); setRenameVal(sh.name); } },
              { label: sh.note ? 'Edit note' : 'Add a note', icon: 'comment', hint: sh.note ? undefined : 'What this shader does', onSelect: () => { setNotingId(sh.id); setNoteVal(sh.note ?? ''); } },
              { label: sh.group ? `Move from ${sh.group}…` : 'Move to a folder…', icon: 'folder', onSelect: () => setGroupMenu({ id: sh.id, x: cardMenu.x, y: cardMenu.y }) },
              'separator',
              { label: 'Delete', icon: 'trash', danger: true, onSelect: () => deleteShader(sh.id) },
            ]}
          />
        );
      })()}
      {/* The Code Explorer takes the side panel's place while it is open. */}
      {sideOpen && !explorerOpen && (
        <div style={{ ...(phone ? phoneSheet : null), width: phone ? 'auto' : 240, flexShrink: 0, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden', background: tk.bg.subtle, borderRight: `1px solid ${tk.border.default}` }}>
          {newGroupFor && (
            <div style={{ padding: '8px 10px', borderBottom: `1px solid ${tk.border.subtle}`, display: 'flex', gap: 6, alignItems: 'center' }}>
              <Field autoFocus value={newGroupName} placeholder="Folder name" height={28} onChange={e => setNewGroupName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && newGroupName.trim()) moveToGroup(newGroupFor, newGroupName.trim()); if (e.key === 'Escape') setNewGroupFor(null); }} style={{ flex: 1 }} aria-label="New folder name" />
              <Button size="sm" variant="primary" disabled={!newGroupName.trim()} onClick={() => moveToGroup(newGroupFor, newGroupName.trim())}>Add</Button>
              <IconButton icon="close" label="Cancel" size="sm" onClick={() => setNewGroupFor(null)} />
            </div>
          )}
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
            <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '4px 12px 12px' }}>
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
            <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {shaders.length > 5 && (
                <Field
                  aria-label="Filter shaders" placeholder="Filter by name, note or folder" height={28}
                  leading={<Icon name="search" size={13} style={{ color: tk.text.faint }} />}
                  value={filter} onChange={e => setFilter(e.target.value)} onKeyDown={e => { if (e.key === 'Escape') setFilter(''); }}
                  suffix={filter ? <IconButton icon="close" label="Clear filter" size="sm" tooltip={false} onClick={() => setFilter('')} style={{ marginRight: -6 }} /> : undefined}
                  style={{ flexShrink: 0, marginBottom: 2 }}
                />
              )}
              {shaders.length === 0 ? (
                <div style={{ padding: '6px 4px', fontSize: 12, color: tk.text.faint, lineHeight: 1.5 }}>
                  No saved shaders yet. Click <b style={{ color: tk.text.muted }}>Save</b> to keep the current file here.
                </div>
              ) : shownShaders.length === 0 ? (
                <div style={{ padding: '6px 4px', fontSize: 12, color: tk.text.faint, lineHeight: 1.5 }}>Nothing matches “{filter.trim()}”.</div>
              ) : [...groupNames, NO_GROUP].map(g => {
                const inGroup = shownShaders.filter(s => (s.group ?? NO_GROUP) === g);
                if (!inGroup.length) return null;
                const closed = closedGroups.has(g) && !filter.trim();
                const card = (s: SavedShader) => (
                  <SavedShaderCard
                    key={s.id}
                    shader={s}
                    open={s.id === openId}
                    renaming={renamingId === s.id}
                    renameVal={renameVal}
                    onRenameChange={setRenameVal}
                    onCommitRename={() => commitRename(s.id)}
                    onCancelRename={() => setRenamingId(null)}
                    noting={notingId === s.id}
                    noteVal={noteVal}
                    onNoteChange={setNoteVal}
                    onStartNote={() => { setNotingId(s.id); setNoteVal(s.note ?? ''); }}
                    onCommitNote={() => commitNote(s.id)}
                    onCancelNote={() => setNotingId(null)}
                    onLoad={() => loadShader(s)}
                    onMenu={(x, y) => setCardMenu({ id: s.id, x, y })}
                  />
                );
                if (g === NO_GROUP) return <div key="__none" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>{groupNames.length > 0 && <div style={{ ...caps, marginTop: 6 }}>No folder</div>}{inGroup.map(card)}</div>;
                return (
                  <GroupSection key={g} name={g} count={inGroup.length} closed={closed} onToggle={() => toggleGroup(g)} onRename={to => renameGroup(g, to)}>
                    {inGroup.map(card)}
                  </GroupSection>
                );
              })}
            </div>
          )}
        </div>
      )}
      {full && !phone && <PageCanvas page="glsl" defaultShare={0.42} tools={smallButton} />}
    </div>
    </div>
  );
}

/** A folder in the saved list: a header that folds it, renamed by double-clicking the name. */
function GroupSection({ name, count, closed, onToggle, onRename, children }: { name: string; count: number; closed: boolean; onToggle: () => void; onRename: (to: string) => void; children: React.ReactNode }) {
  const tk = useTokens();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, height: 28, marginTop: 2 }}>
        <IconButton icon={closed ? 'chevR' : 'chevD'} label={closed ? `Open ${name}` : `Fold ${name}`} size="sm" tooltip={false} onClick={onToggle} style={{ marginLeft: -6 }} />
        <Icon name="folder" size={13} style={{ color: tk.text.faint }} />
        {editing ? (
          <Field autoFocus value={draft} height={24} onChange={e => setDraft(e.target.value)} onBlur={() => { setEditing(false); onRename(draft); }} onKeyDown={e => { if (e.key === 'Enter') { setEditing(false); onRename(draft); } if (e.key === 'Escape') { setDraft(name); setEditing(false); } }} style={{ flex: 1 }} aria-label="Folder name" />
        ) : (
          <span onDoubleClick={() => { setDraft(name); setEditing(true); }} title="Double-click to rename the folder" style={{ flex: 1, minWidth: 0, fontWeight: 650, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'default' }}>{name}</span>
        )}
        <span style={{ color: tk.text.faint, font: `500 11px ${fontFamily.mono}`, marginRight: 4 }}>{count}</span>
      </div>
      {!closed && <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingLeft: 8, borderLeft: `2px solid ${tk.border.subtle}`, marginLeft: 4 }}>{children}</div>}
    </div>
  );
}

function SavedShaderCard({ shader, open, renaming, renameVal, onRenameChange, onCommitRename, onCancelRename, noting, noteVal, onNoteChange, onStartNote, onCommitNote, onCancelNote, onLoad, onMenu }: {
  shader: SavedShader; open: boolean;
  renaming: boolean; renameVal: string; onRenameChange: (v: string) => void; onCommitRename: () => void; onCancelRename: () => void;
  noting: boolean; noteVal: string; onNoteChange: (v: string) => void; onStartNote: () => void; onCommitNote: () => void; onCancelNote: () => void;
  onLoad: () => void; onMenu: (x: number, y: number) => void;
}) {
  const tk = useTokens();
  const [hover, setHover] = useState(false);
  const facts = useMemo(() => shaderFacts(shader.code), [shader.code]);
  const openMenu = (x: number, y: number) => onMenu(x, y);
  return (
    <div
      onDoubleClick={onLoad}
      onContextMenu={e => { e.preventDefault(); openMenu(e.clientX, e.clientY); }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      title={open ? 'Open in the editor' : 'Double-click to load · right-click for more'}
      style={{ borderRadius: radius.lg - 2, background: tk.bg.panel, boxShadow: `inset 0 0 0 1px ${open ? tk.accent.base : hover ? tk.border.strong : tk.border.default}`, cursor: 'pointer', overflow: 'hidden', padding: '6px 4px 7px 10px' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, minHeight: 24 }}>
        {renaming ? (
          <Field
            autoFocus
            aria-label="Shader name"
            value={renameVal}
            height={26}
            onChange={e => onRenameChange(e.target.value)}
            onBlur={onCommitRename}
            onKeyDown={e => { if (e.key === 'Enter') onCommitRename(); if (e.key === 'Escape') onCancelRename(); }}
            onClick={e => e.stopPropagation()}
            onDoubleClick={e => e.stopPropagation()}
            style={{ flex: 1 }}
          />
        ) : (
          <span style={{ flex: 1, minWidth: 0, fontWeight: 600, fontSize: 12.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 6 }}>
            {open && <span aria-label="Open in the editor" style={{ width: 6, height: 6, borderRadius: 3, background: tk.accent.base, flexShrink: 0 }} />}
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{shader.name}</span>
          </span>
        )}
        {!renaming && (
          <IconButton
            icon="more" label="Shader actions" size="sm"
            style={{ opacity: hover ? 1 : 0.45 }}
            onClick={e => { e.stopPropagation(); const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); openMenu(r.left, r.bottom + 4); }}
            onDoubleClick={e => e.stopPropagation()}
          />
        )}
      </div>
      <FactsLine facts={facts} />
      {noting ? (
        <textarea
          autoFocus
          aria-label="Shader note"
          rows={2}
          value={noteVal}
          placeholder="What this shader does"
          onChange={e => onNoteChange(e.target.value)}
          onBlur={onCommitNote}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onCommitNote(); } if (e.key === 'Escape') onCancelNote(); }}
          onClick={e => e.stopPropagation()}
          onDoubleClick={e => e.stopPropagation()}
          style={{ display: 'block', width: 'calc(100% - 6px)', boxSizing: 'border-box', marginTop: 6, resize: 'none', border: 0, outline: 'none', borderRadius: radius.sm, background: tk.bg.field, color: tk.text.primary, font: `500 12px/1.4 ${fontFamily.ui}`, padding: '5px 7px', boxShadow: `inset 0 0 0 1.5px ${tk.accent.base}` }}
        />
      ) : shader.note ? (
        <div
          onClick={e => { e.stopPropagation(); onStartNote(); }}
          onDoubleClick={e => e.stopPropagation()}
          title={`${shader.note}\n\nClick to edit the note`}
          style={{ marginTop: 4, paddingRight: 6, font: `12px/1.4 ${fontFamily.ui}`, color: tk.text.secondary, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden', whiteSpace: 'pre-wrap', cursor: 'text' }}
        >{shader.note}</div>
      ) : null}
    </div>
  );
}

/** "3D · 120 lines · 4 functions", the dimension as a small tag that says why on hover. */
function FactsLine({ facts }: { facts: ShaderFacts }) {
  const tk = useTokens();
  const is3d = facts.dimension === '3d';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3, color: tk.text.faint, font: `500 11px ${fontFamily.ui}` }}>
      <span
        title={is3d ? `Reads as 3D: ${facts.reasons.join(', ')}` : 'Reads as 2D: no ray marching found'}
        style={{ display: 'inline-flex', alignItems: 'center', height: 16, padding: '0 5px', borderRadius: radius.sm, font: `700 10px ${fontFamily.mono}`, letterSpacing: '0.04em', background: is3d ? alpha(tk.accent.base, 0.16) : tk.bg.field, color: is3d ? tk.accent.base : tk.text.muted }}
      >{is3d ? '3D' : '2D'}</span>
      <span>{facts.lines} {facts.lines === 1 ? 'line' : 'lines'}</span>
      {facts.functions > 1 && <span>· {facts.functions} functions</span>}
    </div>
  );
}
