/**
 * ScriptModal — the Sketch editor: where a Script layer's code lives. A tab
 * strip of the sketch's files (sketch.js, the main file, always first; the
 * other tabs run before it, in order, in one scope), a highlighted JavaScript
 * editor with autocomplete, undo and auto-indent, and under it the Console.
 * Beside it: a scratch run of the draft, the reference, patterns to insert
 * (each placed where it belongs) and the sketch's controls with a builder.
 *
 * Selecting a variable or a number in the code offers "Make it a control…":
 * a slider (or whole number, toggle, colour, choice) the layer's panel and
 * Play can drive; a control's name offers "Turn back into a plain value".
 * Run applies the files and starts the sketch over. Starters, your saved
 * sketches, other script layers and p5.js sketches can be loaded or imported
 * from the footer.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTokens } from '../../../theme/themeStore';
import { fontFamily, radius } from '../../../theme/tokens';
import type { ActionKind } from '../../../types/play';
import { SCRIPT_FILES_MAX, SCRIPT_FILE_NAME, SCRIPT_MAIN_FILE, type ScriptFile, type ScriptLayer, type ScriptParamDef } from '../../../types/playLayers';
import { Button, IconButton } from '../../ui/Button';
import { Segmented } from '../../ui/Choice';
import { Field } from '../../ui/Field';
import { Icon } from '../../ui/Icon';
import type { IconName } from '../../ui/iconPaths';
import { alpha } from '../../../theme/tokens';
import { Menu, type MenuItem } from '../../ui/Menu';
import { Modal } from '../../ui/Modal';
import { Select } from '../../ui/Select';
import { toast } from '../../ui/toastStore';
import { askText } from '../../ui/dialogStore';
import { CodeField } from '../../code/CodeField';
import { tokenizeJsLine } from '../../code/jsSyntax';
import { changedLines } from '../../code/lineDiff';
import { insertSnippet } from '../../code/useCompletion';
import { useNodeGraphStore } from '../../../store/useNodeGraphStore';
import { PREVIEW_ASPECTS } from '../../../utils/graphImportPlan';
import { removeScript, saveScript, scriptFunctions, useSavedScripts } from '../../../play/savedScripts';
import type { FieldKit } from './fields';
import { ScriptControls } from './ScriptControls';
import { exposeScriptParam } from './scriptExpose';
import { ScriptPreview } from './ScriptPreview';
import type { ApplyOptions } from './scriptApply';
import { scriptCompletions } from './scriptCompletions';
import { SCRIPT_EXAMPLES, SCRIPT_EXAMPLES_3D, extractScriptParams } from './scriptExamples';
import { ScriptControlBuilder, ScriptPatternList, ScriptReferenceList } from './ScriptPanels';
import type { ScriptSnippet } from './scriptSnippets';
import { controlCandidate, makeControl, placeCode, type ControlKind } from './scriptTools';
import { ScriptConsolePane } from './ScriptConsole';
import { useP5Importer } from './p5Importer';
import type { P5Candidate, P5ControlKind } from '../../../play/p5import';

type Tab = 'preview' | 'reference' | 'patterns' | 'controls';
const KIND_WORD: Record<ControlKind, string> = { slider: 'slider', toggle: 'toggle', button: 'button' };
const P5_KIND_LABEL: Record<string, string> = { slider: 'Slider', integer: 'Whole number', toggle: 'Toggle', colour: 'Colour', choice: 'Choice' };

function useNarrow(px: number) {
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && window.innerWidth < px);
  useEffect(() => { const on = () => setNarrow(window.innerWidth < px); window.addEventListener('resize', on); return () => window.removeEventListener('resize', on); }, [px]);
  return narrow;
}

/** A name for a new tab that no file has yet: file.js, file-2.js… */
function freeName(files: readonly ScriptFile[], base = 'file.js'): string {
  const taken = new Set(files.map(f => f.name.toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;
  const stem = base.replace(/\.js$/, '');
  for (let i = 2; ; i++) if (!taken.has(`${stem}-${i}.js`)) return `${stem}-${i}.js`;
}

export function ScriptModal({ l, f, act, layers, drafts, setDrafts, apply, applyError, runError, kind, onSaveAsKind, onImport, mode, onMode, onClose }: {
  l: ScriptLayer;
  f: FieldKit;
  act: (kind: ActionKind, amount?: number) => void;
  /** Every layer in the file (other script layers can be imported). */
  layers: ReadonlyArray<{ id: string; kind: string; label: string; code?: string }>;
  /** The files being edited: sketch.js first, then the other tabs (a layer kind has only sketch.js). */
  drafts: ScriptFile[];
  setDrafts: (files: ScriptFile[]) => void;
  /** Store the files on the layer; false when they do not compile. */
  apply: (files: readonly ScriptFile[], opts?: ApplyOptions) => boolean;
  applyError: string | null;
  runError: string | null;
  /** Editing a layer kind: Apply changes every layer made from it. */
  kind?: { name: string; icon: IconName; colour: string; uses: number };
  /** A plain Script layer: save the sketch as a layer kind. */
  onSaveAsKind?: () => void;
  /** A plain Script layer: bring in a p5.js sketch in place of this one. */
  onImport?: () => void;
  /** What the sketch draws with; the Controls tab can switch it. */
  mode: '2d' | '3d';
  onMode: (mode: '2d' | '3d') => void;
  onClose: () => void;
}) {
  const tk = useTokens();
  const narrow = useNarrow(860);
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const [tab, setTab] = useState<Tab>('preview');
  const [active, setActive] = useState(0);
  const at = Math.min(active, drafts.length - 1);
  const file = drafts[at] ?? { name: SCRIPT_MAIN_FILE, code: '' };
  const draft = file.code;
  const [selected, setSelected] = useState('');
  const [caret, setCaret] = useState<{ start: number; end: number } | null>(null);
  const [filter, setFilter] = useState('');
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const saved = useSavedScripts();
  const applied: ScriptFile[] = useMemo(() => [{ name: SCRIPT_MAIN_FILE, code: l.code }, ...(kind ? [] : l.files ?? [])], [l.code, l.files, kind]);
  const dirty = drafts.length !== applied.length || drafts.some((d, i) => d.name !== applied[i].name || d.code !== applied[i].code);
  const error = applyError ? `Compile: ${applyError}` : runError;
  const p5i = useP5Importer();

  // ── History of all the files (typed edits coalesce for 400 ms) ────────────
  const hist = useRef<ScriptFile[][]>([drafts]);
  const idx = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [histPos, setHistPos] = useState({ at: 0, len: 1 });
  const bump = () => setHistPos({ at: idx.current, len: hist.current.length });
  const pushNow = (files: ScriptFile[]) => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    const stack = hist.current.slice(0, idx.current + 1);
    if (stack[stack.length - 1] !== files) stack.push(files);
    if (stack.length > 200) stack.shift();
    hist.current = stack; idx.current = stack.length - 1; bump();
  };
  const withCode = (code: string, i = at): ScriptFile[] => drafts.map((d, k) => (k === i ? { ...d, code } : d));
  const typed = (code: string) => {
    const next = withCode(code);
    setDrafts(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => pushNow(next), 400);
  };
  const commitFiles = (files: ScriptFile[]) => { setDrafts(files); pushNow(files); };
  const commit = (code: string, caretAt?: number) => {
    commitFiles(withCode(code));
    if (caretAt !== undefined) requestAnimationFrame(() => { taRef.current?.focus({ preventScroll: true }); taRef.current?.setSelectionRange(caretAt, caretAt); });
  };
  // An insert: commit it, flash the lines it added and scroll them into view; the caret goes to the end of the last one.
  const [flash, setFlash] = useState<{ lines: Array<[number, number]>; key: number } | null>(null);
  const edit = (code: string, caretAt?: number) => {
    const lines = changedLines(draft, code);
    if (lines.length) setFlash(fl => ({ lines, key: (fl?.key ?? 0) + 1 }));
    const endOf = (line: number) => { let p = -1; for (let i = 0; i <= line; i++) p = code.indexOf('\n', p + 1); return p < 0 ? code.length : p; };
    commit(code, caretAt ?? (lines.length ? endOf(lines[lines.length - 1][1]) : undefined));
  };
  const undo = () => { if (timer.current) { clearTimeout(timer.current); timer.current = null; pushNow(drafts); } if (idx.current > 0) { idx.current--; setDrafts(hist.current[idx.current]); bump(); } };
  const redo = () => { if (idx.current < hist.current.length - 1) { idx.current++; setDrafts(hist.current[idx.current]); bump(); } };
  const canUndo = histPos.at > 0, canRedo = histPos.at < histPos.len - 1;

  // ── Tabs ──────────────────────────────────────────────────────────────────
  const nameProblem = (name: string, except = -1) => {
    if (!SCRIPT_FILE_NAME.test(name)) return 'Letters, digits, dots, dashes and underscores, up to 80.';
    if (drafts.some((d, i) => i !== except && d.name.toLowerCase() === name.toLowerCase())) return `There is a ${name} already.`;
    return null;
  };
  const addTab = async () => {
    if (drafts.length >= SCRIPT_FILES_MAX) { toast.error(`A sketch holds up to ${SCRIPT_FILES_MAX} files`); return; }
    const typedName = await askText('New file', { label: 'Name', initial: freeName(drafts), confirmLabel: 'Add' });
    if (!typedName) return;
    const name = /\.m?js$/.test(typedName.trim()) ? typedName.trim() : `${typedName.trim()}.js`;
    const why = nameProblem(name);
    if (why) { toast.error('Can’t add that file', { message: why }); return; }
    commitFiles([...drafts, { name, code: `// ${name}: runs before sketch.js; what it declares at the top, the other files can use.\n` }]);
    setActive(drafts.length);
  };
  const renameTab = async (i: number) => {
    if (i === 0) return;
    const typedName = await askText('Rename file', { label: 'Name', initial: drafts[i].name, confirmLabel: 'Rename' });
    if (!typedName || typedName === drafts[i].name) return;
    const name = /\.m?js$/.test(typedName.trim()) ? typedName.trim() : `${typedName.trim()}.js`;
    const why = nameProblem(name, i);
    if (why) { toast.error('Can’t rename it', { message: why }); return; }
    commitFiles(drafts.map((d, k) => (k === i ? { ...d, name } : d)));
  };
  const removeTab = (i: number) => {
    if (i === 0) return;
    commitFiles(drafts.filter((_, k) => k !== i));
    setActive(Math.max(0, Math.min(at, drafts.length - 2)));
    toast.info(`Removed ${drafts[i].name}`, { message: 'Undo (⌘Z) brings it back.' });
  };
  const moveTab = (i: number, by: -1 | 1) => {
    const j = i + by;
    if (i === 0 || j < 1 || j >= drafts.length) return;
    const next = drafts.slice(); [next[i], next[j]] = [next[j], next[i]];
    commitFiles(next); setActive(j);
  };
  const tabMenu = (e: React.MouseEvent, i: number) => {
    e.preventDefault();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setMenu({ x: r.left, y: r.bottom + 4, items: [
      { label: 'Rename…', icon: 'edit', onSelect: () => { void renameTab(i); } },
      { label: 'Run earlier', icon: 'chevL', hint: 'Files run in tab order, before sketch.js', disabled: i <= 1, onSelect: () => moveTab(i, -1) },
      { label: 'Run later', icon: 'chevR', disabled: i >= drafts.length - 1, onSelect: () => moveTab(i, 1) },
      'separator',
      { label: 'Delete file', icon: 'trash', danger: true, onSelect: () => removeTab(i) },
    ] });
  };
  // A console link: open that tab and put the caret on the line.
  const jumpTo = (name: string, line: number) => {
    const i = drafts.findIndex(d => d.name === name);
    if (i < 0) return;
    setActive(i);
    requestAnimationFrame(() => {
      const el = taRef.current; if (!el) return;
      const code = drafts[i].code;
      let p = 0; for (let k = 1; k < line && p >= 0; k++) p = code.indexOf('\n', p) + 1;
      const end = code.indexOf('\n', p);
      el.focus({ preventScroll: true });
      el.setSelectionRange(p, end < 0 ? code.length : end);
      el.scrollTop = Math.max(0, (line - 4) * 17.4);
      setFlash(fl => ({ lines: [[line - 1, line - 1]], key: (fl?.key ?? 0) + 1 }));
    });
  };
  // An error's place (Runtime (particle.js:12): …) from the status line.
  const errorAt = error ? /\(([^():]+):(\d+)\)/.exec(error) : null;

  // ── Completions and the selection ─────────────────────────────────────────
  const allCode = useMemo(() => drafts.map(d => d.code).join('\n'), [drafts]);
  const completions = useMemo(() => scriptCompletions(allCode, mode), [allCode, mode]);
  // The main file's plain candidates (the params-and-let mechanism), and the importer's for any tab and for numbers.
  const candidate = at === 0 ? controlCandidate(draft, selected) : null;
  const declared = useMemo(() => { const r = extractScriptParams(drafts[0]?.code ?? '', drafts.slice(1)); return r.ok ? r.defs : []; }, [drafts]);
  const plainFiles = useMemo(() => drafts.map(d => ({ name: d.name, code: d.code })), [drafts]);
  const fileName = file.name, hasCandidate = !!candidate, caretAt = caret ? caret.start : -1;
  // What the caret is on, as the importer reads it (parsed each render the caret is somewhere: a small file parses in a millisecond).
  let p5c: P5Candidate | null = null;
  if (p5i && caretAt >= 0 && !hasCandidate) { try { p5c = p5i.candidateAt(plainFiles, fileName, caretAt); } catch { p5c = null; } }
  const declaredHere = selected.trim() && declared.find(d => d.key === selected.trim());

  // Defs of the draft (for the scratch run), refreshed a moment after typing stops.
  const [draftDefs, setDraftDefs] = useState<ScriptParamDef[]>(l.paramDefs ?? []);
  useEffect(() => {
    const t = setTimeout(() => { const r = extractScriptParams(drafts[0]?.code ?? '', drafts.slice(1)); if (r.ok) setDraftDefs(r.defs); }, 350);
    return () => clearTimeout(t);
  }, [drafts]);
  const [previewFiles, setPreviewFiles] = useState(drafts);
  useEffect(() => { const t = setTimeout(() => setPreviewFiles(drafts), 500); return () => clearTimeout(t); }, [drafts]);
  const values = useMemo(() => { const o: Record<string, number> = {}; const raw = l as unknown as Record<string, unknown>; for (const k in raw) if (k.startsWith('p_') && typeof raw[k] === 'number') o[k.slice(2)] = raw[k] as number; return o; }, [l]);
  const aspectId = useNodeGraphStore(s => s.previewAspect);
  const ratio = PREVIEW_ASPECTS.find(a => a.id === aspectId)?.ratio ?? 16 / 9;

  // ── Edits ─────────────────────────────────────────────────────────────────
  const insertAtCaret = (text: string) => {
    const el = taRef.current;
    const a = el ? el.selectionStart : draft.length, end = el ? el.selectionEnd : draft.length;
    if (!text.includes('\n')) { const r = insertSnippet(draft, a, end, text); edit(r.next, r.caret); return; }
    // A block: on its own lines, at the caret's indent.
    const lineStart = draft.lastIndexOf('\n', a - 1) + 1;
    const prefix = draft.slice(lineStart, a);
    const indent = /^[ \t]*/.exec(prefix)?.[0] ?? '';
    let ins = text.replace(/\n(?=.)/g, `\n${indent}`);
    if (prefix.trim()) ins = `\n${indent}${ins}`;
    edit(draft.slice(0, a) + ins + draft.slice(end), a + ins.length);
  };
  // A pattern goes where it belongs (top, setup or draw) in sketch.js; the caret counts only when the editor has focus there.
  const insertPattern = (sn: ScriptSnippet) => {
    const el = taRef.current;
    const c = at === 0 && el && document.activeElement === el && el.selectionStart === el.selectionEnd ? el.selectionStart : undefined;
    const main = drafts[0].code;
    const next = placeCode(main, sn.where, sn.code, c);
    if (at !== 0) { setActive(0); commitFiles(withCode(next, 0)); return; }
    edit(next);
  };
  const appendBlock = (title: string, text: string) => {
    const next = `${draft.replace(/\s*$/, '')}\n\n// ── ${title} ──\n${text.trim()}\n`;
    edit(next, next.length);
  };
  const pendingExpose = useRef<string | null>(null);
  useEffect(() => {
    const key = pendingExpose.current; if (!key) return;
    const d = (l.paramDefs ?? []).find(x => x.key === key); if (!d) return;
    pendingExpose.current = null;
    exposeScriptParam(f, l, d);
    toast.success(`“${d.label}” is on the Play panel`);
  }, [l, f]);
  const turnInto = (alsoControl: boolean) => {
    if (!candidate) return;
    const r = makeControl(draft, candidate.name);
    if (!r) return;
    edit(r.code);
    const startAt = candidate.kind === 'slider' ? { [candidate.name]: candidate.value as number } : candidate.kind === 'toggle' ? { [candidate.name]: candidate.value ? 1 : 0 } : undefined;
    if (apply(withCode(r.code), { startAt }) && alsoControl) pendingExpose.current = candidate.name;
    setSelected('');
  };

  // ── Make it a control… (any tab, a variable or a number) ──────────────────
  const [making, setMaking] = useState<{ c: P5Candidate; kind: P5ControlKind; key: string; min?: number; max?: number; step?: number } | null>(null);
  const openMaking = (c: P5Candidate) => setMaking({ c, kind: c.kind, key: c.name, min: c.range?.min, max: c.range?.max, step: c.range?.step });
  const makeIt = (alsoControl: boolean) => {
    if (!making || !p5i) return;
    try {
      const r = p5i.applyControls(plainFiles, [{ id: making.c.id, kind: making.kind, key: making.key, min: making.min, max: making.max, step: making.step, options: making.c.options }], [making.c]);
      const byName = new Map(r.files.map(x => [x.name, x.code]));
      const next = drafts.map(d => ({ ...d, code: byName.get(d.name) ?? d.code }));
      commitFiles(next);
      const key = r.entries[0]?.key ?? making.key;
      if (apply(next, { startAt: r.startAt }) && alsoControl) pendingExpose.current = key;
      toast.success(`“${key}” is a control`, { message: making.c.setupOnly ? 'It is read only in setup, so changing it starts the sketch over.' : 'Undo (⌘Z) puts the plain value back.' });
    } catch (e) { toast.error('Couldn’t make that a control', { message: (e as Error)?.message ?? String(e) }); }
    setMaking(null); setSelected(''); setCaret(null);
  };
  const unmake = () => {
    if (!declaredHere || !p5i) return;
    const raw = (l as unknown as Record<string, unknown>)[`p_${declaredHere.key}`];
    const now = typeof raw === 'number' ? raw : declaredHere.value;
    const value = declaredHere.kind === 'toggle' ? now >= 0.5 : now;
    try {
      const out = p5i.unmakeControl(plainFiles, declaredHere.key, value);
      const byName = new Map(out.map(x => [x.name, x.code]));
      const next = drafts.map(d => ({ ...d, code: byName.get(d.name) ?? d.code }));
      commitFiles(next); apply(next);
      toast.info(`“${declaredHere.key}” is a plain value again`, { message: 'Undo (⌘Z) makes it a control again.' });
    } catch (e) { toast.error('Couldn’t turn it back', { message: (e as Error)?.message ?? String(e) }); }
    setSelected('');
  };

  // A starter or example of the other mode switches the layer's mode along with the code.
  const loadCode = (code: string, settings?: { clear: boolean; readPicture: boolean; mode?: '2d' | '3d' }, files: ScriptFile[] = []) => {
    const next = [{ name: SCRIPT_MAIN_FILE, code }, ...(kind ? [] : files)];
    commitFiles(next); setActive(0); apply(next, settings ? { settings } : undefined);
  };
  const loadExample = (sn: ScriptSnippet) => {
    loadCode(sn.example, { clear: sn.settings?.clear ?? true, readPicture: sn.settings?.readPicture ?? false, mode });
    toast.info(`Loaded “${sn.name}”`, { message: 'Undo (⌘Z) brings your sketch back.' });
  };
  const addNewControl = (code: string, key: string, startAt: number | undefined, toPanel: boolean) => {
    if (at !== 0) setActive(0);
    const next = withCode(code, 0);
    commitFiles(next);
    if (apply(next, { startAt: startAt === undefined ? undefined : { [key]: startAt } }) && toPanel) pendingExpose.current = key;
  };
  // Run: apply every file and start over from the top (tabs in order, sketch.js, then setup).
  const run = () => { if (apply(drafts)) act('script:__restart' as ActionKind, 1); };

  const openMenu = (e: React.MouseEvent, items: MenuItem[]) => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); setMenu({ x: r.left, y: r.top - 6 - Math.min(400, items.length * 34), items }); };
  const startersMenu = (): MenuItem[] => [
    ...(mode === '3d' ? SCRIPT_EXAMPLES_3D : SCRIPT_EXAMPLES).map(ex => ({ label: ex.name, hint: ex.hint, icon: (mode === '3d' ? 'cube' : 'code') as IconName, onSelect: () => loadCode(ex.code, { ...ex.settings, mode }) })),
    'separator' as const,
    ...(mode === '3d' ? SCRIPT_EXAMPLES : SCRIPT_EXAMPLES_3D).map(ex => ({ label: `${ex.name} (${mode === '3d' ? '2D' : '3D'})`, hint: `${ex.hint} Loading it switches the layer to ${mode === '3d' ? '2D' : '3D'}.`, icon: (mode === '3d' ? 'code' : 'cube') as IconName, onSelect: () => loadCode(ex.code, { ...ex.settings, mode: mode === '3d' ? '2d' : '3d' }) })),
    ...(saved.length ? ['separator' as const, ...saved.map(s => ({ label: s.mode === '3d' && mode !== '3d' ? `${s.name} (3D)` : s.mode !== '3d' && mode === '3d' ? `${s.name} (2D)` : s.name, hint: `Saved by you${s.files?.length ? ` · ${s.files.length + 1} files` : ''} · right-click a saved one in the panel to remove it`, icon: 'star' as const, onSelect: () => loadCode(s.code, { clear: s.clear, readPicture: s.readPicture, mode: s.mode }, s.files ?? []) }))] : []),
    ...(saved.length ? ['separator' as const, ...saved.map(s => ({ label: `Remove “${s.name}”`, danger: true, onSelect: () => { removeScript(s.id); toast.info(`Removed “${s.name}”`); } }))] : []),
  ];
  const importMenu = (): MenuItem[] => {
    const items: MenuItem[] = [];
    if (onImport) items.push({ label: 'Import p5.js sketch…', icon: 'import', hint: 'Paste one, or open its files, a folder or a .zip: it replaces this sketch', onSelect: onImport }, 'separator');
    const sources = [
      ...layers.filter(x => x.kind === 'script' && x.id !== l.id && typeof x.code === 'string').map(x => ({ label: x.label, code: x.code as string, what: 'layer' })),
      ...saved.map(s => ({ label: s.name, code: s.code, what: 'saved' })),
    ];
    for (const src of sources) {
      const fns = scriptFunctions(src.code).filter(fn => fn.name !== 'setup' && fn.name !== 'draw');
      items.push({ label: `${src.label}: everything`, hint: 'Append the whole sketch (its setup/draw will clash with yours: rename or merge them)', icon: src.what === 'layer' ? 'code' : 'star', onSelect: () => appendBlock(`from ${src.label}`, src.code) });
      if (fns.length) items.push({ label: `${src.label}: functions only`, hint: fns.map(fn => fn.name).join(', '), icon: 'fn', onSelect: () => appendBlock(`functions from ${src.label}`, fns.map(fn => fn.source).join('\n\n')) });
      for (const fn of fns.slice(0, 8)) items.push({ label: `    ${fn.name}()`, onSelect: () => appendBlock(`${fn.name} from ${src.label}`, fn.source) });
    }
    if (!sources.length) items.push({ label: 'No other sketches yet', hint: 'Other Script layers in this file, and sketches you save as starters, show up here.', disabled: true, onSelect: () => {} });
    return items;
  };
  const saveAsStarter = async () => {
    const name = await askText('Save as starter', { label: 'Name', initial: l.label, confirmLabel: 'Save' });
    if (!name) return;
    saveScript(name, drafts[0].code, { clear: l.clear, readPicture: l.readPicture, mode, files: drafts.slice(1), p5: l.p5 });
    toast.success(`Saved “${name}”`, { message: 'It is in Starters, and other script layers can import it.' });
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key === 'Enter') { e.preventDefault(); if (e.shiftKey) run(); else apply(drafts); return; }
    if (mod && e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); return; }
    if (mod && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) { e.preventDefault(); redo(); return; }
    if (mod && e.key === 's') { e.preventDefault(); apply(drafts); return; }
  };

  const heading = (t: string) => <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.08em', color: tk.text.faint, textTransform: 'uppercase' }}>{t}</span>;
  const sideWidth = narrow ? Math.min(360, window.innerWidth - 32) : 360;

  const side = (
    <div style={{ width: narrow ? '100%' : 360, flexShrink: 0, display: 'flex', flexDirection: 'column', minHeight: 0, background: tk.bg.subtle, borderLeft: narrow ? 'none' : `1px solid ${tk.border.subtle}`, borderTop: narrow ? `1px solid ${tk.border.subtle}` : 'none' }}>
      <div style={{ padding: '10px 12px 8px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <Segmented size="sm" fill ariaLabel="Side panel" value={tab} onChange={setTab} options={[{ value: 'preview', label: 'Run' }, { value: 'reference', label: 'Reference' }, { value: 'patterns', label: 'Patterns' }, { value: 'controls', label: 'Controls' }]} />
        {(tab === 'reference' || tab === 'patterns') && (
          <Field leading={<Icon name="search" size={15} style={{ color: tk.text.faint }} />} placeholder={tab === 'reference' ? 'Filter the reference…' : 'Filter patterns…'} aria-label={tab === 'reference' ? 'Filter the reference' : 'Filter patterns'} value={filter} onChange={e => setFilter(e.target.value)} height={30} style={{ background: tk.bg.panel, boxShadow: `inset 0 0 0 1px ${tk.border.default}` }} />
        )}
      </div>
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '0 12px 12px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {tab === 'preview' && (
          <>
            <ScriptPreview code={previewFiles[0]?.code ?? ''} files={kind ? undefined : previewFiles.slice(1)} p5={l.p5} assets={l.assets} defs={draftDefs} values={values} clear={l.clear} mode={mode} ratio={ratio} width={sideWidth - 24} />
            <span style={{ fontSize: 11.5, lineHeight: 1.45, color: tk.text.muted }}>
              {mode === '3d'
                ? <>The draft runs here on its own, as you type, with the layer’s current control values; drag in the box to orbit. A soft glow stands in for the picture (and for s.picture.texture) and there are no nulls. <b>Apply</b> puts it on the picture.</>
                : <>The draft runs here on its own, as you type, with the layer’s current control values and the mouse over this box. The picture reads as a soft glow in the middle and there are no nulls. <b>Apply</b> puts it on the picture; its console shows below the code.</>}
            </span>
          </>
        )}
        {tab === 'reference' && <ScriptReferenceList query={filter} mode={mode} onInsert={insertAtCaret} />}
        {tab === 'patterns' && <ScriptPatternList query={filter} mode={mode} previewWidth={sideWidth - 44} onInsert={insertPattern} onLoad={loadExample} />}
        {tab === 'controls' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {heading('Declared by the sketch')}
            {(l.paramDefs ?? []).length === 0 && <span style={{ fontSize: 11.5, lineHeight: 1.45, color: tk.text.muted }}>None yet. Declare a params object, or select a variable or a number in the code and use Make it a control.</span>}
            <ScriptControls f={f} l={l} act={act} />
            <div style={{ margin: '10px 0 4px' }}>{heading('New control')}</div>
            <ScriptControlBuilder draft={drafts[0]?.code ?? ''} onAdd={addNewControl} />
            <div style={{ marginTop: 10 }}>{heading('Canvas')}</div>
            {f.row('Mode', <Segmented size="sm" ariaLabel="Draw in 2D or 3D" value={mode} onChange={onMode} options={[{ value: '2d', label: '2D canvas' }, { value: '3d', label: '3D (WebGL)' }]} />, kind ? `Changes every ${kind.name} layer.` : '2D draws on a canvas (s.ctx); 3D draws with WebGL (three.js), still over the picture.')}
            {!l.p5 && f.toggle('Clear', 'clear', 'Clear every frame', 'Off keeps what was drawn, for trails.')}
            {f.toggle('Picture', 'readPicture', 'Read the picture', 'Samples the shader each frame for s.picture.brightness(x, y).')}
            {f.props('opacity')}
          </div>
        )}
      </div>
    </div>
  );

  const tabStrip = (
    <div role="tablist" aria-label="The sketch's files" style={{ display: 'flex', alignItems: 'center', gap: 2, overflowX: 'auto', minHeight: 32, borderBottom: `1px solid ${tk.border.subtle}`, flexShrink: 0 }}>
      {drafts.map((d, i) => {
        const on = i === at, changed = d.code !== applied.find(x => x.name === d.name)?.code;
        return (
          <button key={`${i}:${d.name}`} type="button" role="tab" aria-selected={on} onClick={() => setActive(i)} onDoubleClick={() => { void renameTab(i); }} onContextMenu={e => { if (i > 0) tabMenu(e, i); }}
            title={i === 0 ? 'sketch.js: the main file, run last (after the other tabs)' : `${d.name}: runs before sketch.js. Double-click to rename; right-click for more.`}
            style={{ all: 'unset', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 10px', borderRadius: `${radius.md}px ${radius.md}px 0 0`, flexShrink: 0,
              background: on ? tk.bg.field : 'transparent', boxShadow: on ? `inset 0 -2px 0 ${tk.accent.base}` : 'none', font: `500 12px ${fontFamily.mono}`, color: on ? tk.text.primary : tk.text.secondary }}>
            {d.name}
            {i === 0 && <span style={{ font: `700 9.5px ${fontFamily.ui}`, letterSpacing: '0.06em', color: tk.accent.base }}>MAIN</span>}
            {changed && <span aria-label="edited" style={{ width: 6, height: 6, borderRadius: '50%', background: tk.accent.base }} />}
            {i > 0 && on && <span role="button" aria-label={`More for ${d.name}`} onClick={e => { e.stopPropagation(); tabMenu(e, i); }} style={{ color: tk.text.faint, fontFamily: fontFamily.ui }}>⋯</span>}
          </button>
        );
      })}
      {!kind && <IconButton icon="plus" size="sm" label="Add a file: it runs before sketch.js and shares its scope" onClick={() => { void addTab(); }} />}
    </div>
  );

  const selectionBar = (
    <div style={{ minHeight: 30, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      {candidate ? (
        <>
          <span style={{ font: `500 12px ${fontFamily.mono}`, color: tk.text.secondary }}>{candidate.name}{candidate.kind === 'button' ? '()' : ` = ${String(candidate.value)}`}</span>
          <Button size="sm" icon="plus" onClick={() => turnInto(false)} title={candidate.kind === 'button' ? 'Add the function to params: a button on the layer that runs it' : `Add ${candidate.name} to params and let the ${KIND_WORD[candidate.kind]} drive the variable each frame`}>{`Make it a ${KIND_WORD[candidate.kind]}`}</Button>
          <Button size="sm" variant="ghost" onClick={() => turnInto(true)} title="The same, and put it on the Play panel right away">…and a Play control</Button>
        </>
      ) : declaredHere && !kind ? (
        <>
          <span style={{ font: `500 12px ${fontFamily.mono}`, color: tk.text.secondary }}>{declaredHere.key}</span>
          <span style={{ fontSize: 11.5, color: tk.text.muted }}>is a {declaredHere.kind ?? 'slider'} control</span>
          <Button size="sm" variant="ghost" icon="undo" onClick={unmake} disabled={!p5i} title="Remove it from params and write its current value into the code">Turn back into a plain value</Button>
        </>
      ) : p5c && !kind && !p5c.state ? (
        <>
          <span style={{ font: `500 12px ${fontFamily.mono}`, color: tk.text.secondary }}>{p5c.source === 'variable' ? p5c.name : p5c.text}</span>
          {p5c.setupOnly && <span style={{ fontSize: 11, color: tk.text.faint }}>read in setup: restarts the sketch</span>}
          <Button size="sm" icon="sliders" onClick={() => openMaking(p5c)}>Make it a control…</Button>
        </>
      ) : p5c && p5c.state ? (
        <span style={{ fontSize: 11.5, color: tk.status.warningText }}>{p5c.name} changes as the sketch runs: state, not a good control.</span>
      ) : (
        <span style={{ fontSize: 11.5, color: tk.text.faint }}>Select a variable or click a number to make it a control (slider, toggle, colour…); a function’s name becomes a button. Double-click selects a word.</span>
      )}
    </div>
  );

  const makingPanel = making && (
    <div role="dialog" aria-label="Make it a control" style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 10, borderRadius: radius.md, background: tk.bg.panel, boxShadow: `${tk.shadow.float}, inset 0 0 0 1px ${alpha(tk.accent.base, 0.35)}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <b style={{ fontSize: 12.5 }}>Make it a control</b>
        <span style={{ font: `500 11.5px ${fontFamily.mono}`, color: tk.text.muted }}>{making.c.file}:{making.c.line} · {making.c.text}</span>
        <span style={{ flex: 1 }} />
        <IconButton icon="close" size="sm" label="Cancel" onClick={() => setMaking(null)} />
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
        <Select ariaLabel="Kind of control" value={making.kind} height={28} onChange={v => setMaking(m => m && ({ ...m, kind: v as P5ControlKind, ...(v === 'integer' ? { step: 1 } : {}) }))}
          options={(making.c.kind === 'colour' ? ['colour'] : making.c.kind === 'toggle' ? ['toggle'] : making.c.kind === 'choice' ? ['choice'] : ['slider', 'integer']).map(k => ({ value: k, label: P5_KIND_LABEL[k] }))} />
        <Field aria-label="Control name" height={28} mono value={making.key} onChange={e => { const v = e.target.value.replace(/[^\w]/g, ''); setMaking(m => m && ({ ...m, key: v })); }} style={{ width: 130 }} />
        {(making.kind === 'slider' || making.kind === 'integer') && (['min', 'max', 'step'] as const).map(k => (
          <Field key={k} aria-label={k} height={28} mono type="number" value={String(making[k] ?? '')} suffix={<span style={{ fontSize: 10.5, color: tk.text.faint }}>{k}</span>}
            onChange={e => { const v = e.target.value === '' ? undefined : Number(e.target.value); setMaking(m => m && ({ ...m, [k]: v })); }} style={{ width: 96 }} />
        ))}
        {making.kind === 'choice' && <span style={{ fontSize: 11.5, color: tk.text.muted }}>{(making.c.options ?? []).join(' · ')}</span>}
      </div>
      <span style={{ fontSize: 11.5, color: making.c.setupOnly ? tk.status.warningText : tk.text.muted }}>
        {making.c.setupOnly ? 'This value is only read when the sketch starts (setup), so moving the control starts the sketch over.' : making.c.source === 'literal' ? 'The number becomes a variable at the top of its file, and the control drives it each frame.' : 'The control drives the variable each frame; the rest of the code stays as it is.'}
      </span>
      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
        <Button size="sm" variant="ghost" onClick={() => makeIt(true)}>…and a Play control</Button>
        <Button size="sm" variant="primary" icon="plus" onClick={() => makeIt(false)} disabled={!making.key}>Make it a control</Button>
      </div>
    </div>
  );

  return (
    <Modal
      title={kind ? kind.name : 'Sketch editor'}
      subtitle={kind ? `Layer kind · ${kind.uses} layer${kind.uses === 1 ? '' : 's'}${mode === '3d' ? ' · 3D' : ''}` : narrow ? l.label : `${l.label} · ${l.p5 ? 'p5.js sketch' : mode === '3d' ? 'JavaScript in 3D (WebGL)' : 'JavaScript on a canvas'} over the picture`}
      icon={kind ? kind.icon : mode === '3d' ? 'cube' : 'code'}
      iconColor={kind ? kind.colour : tk.kind.fn}
      width={1200}
      height={860}
      onClose={onClose}
      headerActions={
        <>
          <IconButton icon="undo" label="Undo" shortcut="⌘Z" disabled={!canUndo} onClick={undo} />
          <IconButton icon="redo" label="Redo" shortcut="⇧⌘Z" disabled={!canRedo} onClick={redo} />
        </>
      }
      footer={
        <>
          {narrow ? (
            <>
              <IconButton icon="code" label="Starters: built-in sketches and ones you saved" onClick={e => openMenu(e, startersMenu())} />
              <IconButton icon="import" label="Import: a p5.js sketch, another script layer or a saved sketch" onClick={e => openMenu(e, importMenu())} />
              <IconButton icon="star" label="Save as a starter of your own" onClick={saveAsStarter} />
              {onSaveAsKind && <IconButton icon="save" label="Save as a layer kind: its own entry in Add layer" onClick={onSaveAsKind} />}
            </>
          ) : (
            <>
              <Button icon="code" onClick={e => openMenu(e, startersMenu())}>Starters</Button>
              <Button icon="import" onClick={e => openMenu(e, importMenu())}>Import</Button>
              <Button icon="star" onClick={saveAsStarter} title="Keep this sketch as a starter of your own; other script layers can import it">Save as starter</Button>
              {onSaveAsKind && <Button icon="save" onClick={onSaveAsKind} title="Save this sketch as a layer kind of its own: its own entry in Add layer, its controls as the layer's properties">Save as kind</Button>}
            </>
          )}
          <span style={{ flex: 1, minWidth: 0, fontSize: 11.5, lineHeight: 1.35, color: error ? tk.status.danger : tk.text.faint, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'right', cursor: errorAt ? 'pointer' : undefined }}
            title={error ?? undefined} onClick={() => { if (errorAt) jumpTo(errorAt[1], +errorAt[2]); }}>
            {error ?? (narrow ? '' : dirty ? (kind ? `Edited · Apply changes every ${kind.name} layer (${kind.uses})` : 'Edited · Apply to run it on the picture') : `Running on the picture · ${(l.paramDefs ?? []).length} control${(l.paramDefs ?? []).length === 1 ? '' : 's'}`)}
          </span>
          {dirty && !narrow && <Button variant="ghost" onClick={() => commitFiles(applied)}>Revert</Button>}
          <Button variant="secondary" icon="reset" onClick={run} title="Apply every file and start the sketch over: the tabs in order, sketch.js, then setup (⇧⌘↵)">Run</Button>
          <Button variant={dirty ? 'primary' : 'secondary'} icon="play" disabled={!dirty} onClick={() => apply(drafts)} title="⌘/Ctrl+Enter">Apply</Button>
          <Button variant={dirty ? 'secondary' : 'primary'} onClick={() => { if (!dirty || apply(drafts)) onClose(); }}>Done</Button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: narrow ? 'column' : 'row', height: '100%', minHeight: 0 }}>
        <div style={{ flex: 1, minWidth: 0, minHeight: narrow ? 420 : 0, display: 'flex', flexDirection: 'column', padding: 12, gap: 8 }}>
          {kind && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', borderRadius: 8, background: alpha(kind.colour, 0.1), boxShadow: `inset 0 0 0 1px ${alpha(kind.colour, 0.35)}`, fontSize: 12, lineHeight: 1.4, color: tk.text.secondary }}>
              <Icon name={kind.icon} size={14} style={{ color: kind.colour, flexShrink: 0 }} />
              <span style={{ minWidth: 0 }}>You are editing the layer kind <b>{kind.name}</b>. Apply changes all {kind.uses} of its layers; each keeps its own control values.</span>
            </div>
          )}
          {tabStrip}
          {selectionBar}
          {makingPanel}
          <CodeField
            grow
            title={file.name}
            ariaLabel={`Script code: ${file.name}`}
            value={draft}
            onChange={typed}
            completions={completions.all}
            members={completions.members}
            tokenize={tokenizeJsLine}
            autoIndent
            textareaRef={el => { taRef.current = el; }}
            onSelect={el => { setSelected(el.value.slice(el.selectionStart, el.selectionEnd)); setCaret({ start: el.selectionStart, end: el.selectionEnd }); }}
            onKeyDown={onKeyDown}
            flash={flash}
            invalid={!!error}
            actions={<span style={{ fontSize: 11, color: tk.text.faint }}>{at === 0 ? 'main file · runs last' : `runs ${at === 1 ? 'first' : `${at}${at === 2 ? 'nd' : at === 3 ? 'rd' : 'th'}`}`} · ⌘↵ applies</span>}
          />
          <ScriptConsolePane layerId={l.id} onJump={jumpTo} height={narrow ? 120 : 150} />
        </div>
        {side}
      </div>
      {menu && <Menu x={menu.x} y={menu.y} items={menu.items} minWidth={260} maxWidth={420} onClose={() => setMenu(null)} />}
    </Modal>
  );
}
