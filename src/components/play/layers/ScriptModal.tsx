/**
 * ScriptModal — the Script layer's big editor, like the Custom Function
 * window: a highlighted JavaScript editor with autocomplete, undo and
 * auto-indent; beside it a scratch run of the draft, the reference, a library
 * of patterns to insert, and the sketch's controls. The selection offers to
 * turn a variable into a slider, toggle or button (and a Play control in one
 * go). Starters, your saved sketches and other script layers can be loaded
 * or imported from the footer.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTokens } from '../../../theme/themeStore';
import { fontFamily, radius } from '../../../theme/tokens';
import type { ActionKind } from '../../../types/play';
import type { ScriptLayer, ScriptParamDef } from '../../../types/playLayers';
import { Button, IconButton } from '../../ui/Button';
import { Segmented } from '../../ui/Choice';
import { Field } from '../../ui/Field';
import { Icon } from '../../ui/Icon';
import { Menu, type MenuItem } from '../../ui/Menu';
import { Modal } from '../../ui/Modal';
import { toast } from '../../ui/toastStore';
import { askText } from '../../ui/dialogStore';
import { CodeField } from '../../code/CodeField';
import { tokenizeJsLine } from '../../code/jsSyntax';
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
import { SCRIPT_EXAMPLES, extractScriptParams } from './scriptExamples';
import { SCRIPT_REFERENCE } from './scriptReference';
import { SCRIPT_SNIPPETS, SNIPPET_GROUPS } from './scriptSnippets';
import { controlCandidate, makeControl, type ControlKind } from './scriptTools';

type Tab = 'preview' | 'reference' | 'patterns' | 'controls';
const KIND_WORD: Record<ControlKind, string> = { slider: 'slider', toggle: 'toggle', button: 'button' };

function Chip({ label, title, onClick }: { label: ReactNode; title?: string; onClick: () => void }) {
  const tk = useTokens();
  return (
    <button type="button" title={title} onMouseDown={e => e.preventDefault()} onClick={onClick}
      style={{ height: 26, display: 'inline-flex', alignItems: 'center', gap: 6, padding: '0 8px', border: 0, borderRadius: 7, cursor: 'pointer', background: tk.bg.panel, boxShadow: `inset 0 0 0 1px ${tk.border.default}`, color: tk.text.primary, font: `500 11.5px ${fontFamily.mono}`, whiteSpace: 'nowrap', flexShrink: 0 }}>
      {label}
    </button>
  );
}

function useNarrow(px: number) {
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && window.innerWidth < px);
  useEffect(() => { const on = () => setNarrow(window.innerWidth < px); window.addEventListener('resize', on); return () => window.removeEventListener('resize', on); }, [px]);
  return narrow;
}

export function ScriptModal({ l, f, act, layers, draft, setDraft, apply, applyError, runError, onClose }: {
  l: ScriptLayer;
  f: FieldKit;
  act: (kind: ActionKind, amount?: number) => void;
  /** Every layer in the file (other script layers can be imported). */
  layers: ReadonlyArray<{ id: string; kind: string; label: string; code?: string }>;
  draft: string;
  setDraft: (code: string) => void;
  /** Store the code on the layer; false when it does not compile. */
  apply: (code: string, opts?: ApplyOptions) => boolean;
  applyError: string | null;
  runError: string | null;
  onClose: () => void;
}) {
  const tk = useTokens();
  const narrow = useNarrow(860);
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const [tab, setTab] = useState<Tab>('preview');
  const [selected, setSelected] = useState('');
  const [filter, setFilter] = useState('');
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const saved = useSavedScripts();
  const dirty = draft !== l.code;
  const error = applyError ? `Compile: ${applyError}` : runError;

  // ── History (typed edits coalesce for 400 ms) ─────────────────────────────
  const hist = useRef<string[]>([draft]);
  const idx = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [histPos, setHistPos] = useState({ at: 0, len: 1 });
  const bump = () => setHistPos({ at: idx.current, len: hist.current.length });
  const pushNow = (code: string) => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    const stack = hist.current.slice(0, idx.current + 1);
    if (stack[stack.length - 1] !== code) stack.push(code);
    if (stack.length > 200) stack.shift();
    hist.current = stack; idx.current = stack.length - 1; bump();
  };
  const typed = (code: string) => {
    setDraft(code);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => pushNow(code), 400);
  };
  const commit = (code: string, caret?: number) => {
    setDraft(code); pushNow(code);
    if (caret !== undefined) requestAnimationFrame(() => { taRef.current?.focus(); taRef.current?.setSelectionRange(caret, caret); });
  };
  const undo = () => { if (timer.current) { clearTimeout(timer.current); timer.current = null; pushNow(draft); } if (idx.current > 0) { idx.current--; setDraft(hist.current[idx.current]); bump(); } };
  const redo = () => { if (idx.current < hist.current.length - 1) { idx.current++; setDraft(hist.current[idx.current]); bump(); } };
  const canUndo = histPos.at > 0, canRedo = histPos.at < histPos.len - 1;

  // ── Completions and the selection ─────────────────────────────────────────
  const completions = useMemo(() => scriptCompletions(draft), [draft]);
  const candidate = controlCandidate(draft, selected);

  // Defs of the draft (for the scratch run), refreshed a moment after typing stops.
  const [draftDefs, setDraftDefs] = useState<ScriptParamDef[]>(l.paramDefs ?? []);
  useEffect(() => {
    const t = setTimeout(() => { const r = extractScriptParams(draft); if (r.ok) setDraftDefs(r.defs); }, 350);
    return () => clearTimeout(t);
  }, [draft]);
  const [previewCode, setPreviewCode] = useState(draft);
  useEffect(() => { const t = setTimeout(() => setPreviewCode(draft), 500); return () => clearTimeout(t); }, [draft]);
  const values = useMemo(() => { const o: Record<string, number> = {}; const raw = l as unknown as Record<string, unknown>; for (const k in raw) if (k.startsWith('p_') && typeof raw[k] === 'number') o[k.slice(2)] = raw[k] as number; return o; }, [l]);
  const aspectId = useNodeGraphStore(s => s.previewAspect);
  const ratio = PREVIEW_ASPECTS.find(a => a.id === aspectId)?.ratio ?? 16 / 9;

  // ── Edits ─────────────────────────────────────────────────────────────────
  const insertAtCaret = (text: string) => {
    const el = taRef.current;
    const at = el ? el.selectionStart : draft.length, end = el ? el.selectionEnd : draft.length;
    if (!text.includes('\n')) { const r = insertSnippet(draft, at, end, text); commit(r.next, r.caret); return; }
    // A block: on its own lines, at the caret's indent.
    const lineStart = draft.lastIndexOf('\n', at - 1) + 1;
    const prefix = draft.slice(lineStart, at);
    const indent = /^[ \t]*/.exec(prefix)?.[0] ?? '';
    let ins = text.replace(/\n(?=.)/g, `\n${indent}`);
    if (prefix.trim()) ins = `\n${indent}${ins}`;
    const next = draft.slice(0, at) + ins + draft.slice(end);
    commit(next, at + ins.length);
  };
  const insertPattern = (sn: { where: string; code: string }) => {
    const el = taRef.current;
    if (sn.where === 'top' && el && el.selectionStart === 0) commit(sn.code + '\n' + draft, sn.code.length + 1);
    else insertAtCaret(sn.code);
  };
  const appendBlock = (title: string, text: string) => {
    const next = `${draft.replace(/\s*$/, '')}\n\n// ── ${title} ──\n${text.trim()}\n`;
    commit(next, next.length);
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
    commit(r.code);
    const startAt = candidate.kind === 'slider' ? { [candidate.name]: candidate.value as number } : candidate.kind === 'toggle' ? { [candidate.name]: candidate.value ? 1 : 0 } : undefined;
    if (apply(r.code, { startAt }) && alsoControl) pendingExpose.current = candidate.name;
    setSelected('');
  };
  const loadCode = (code: string, settings?: { clear: boolean; readPicture: boolean }) => { commit(code, 0); apply(code, settings ? { settings } : undefined); };

  const openMenu = (e: React.MouseEvent, items: MenuItem[]) => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); setMenu({ x: r.left, y: r.top - 6 - Math.min(400, items.length * 34), items }); };
  const startersMenu = (): MenuItem[] => [
    ...SCRIPT_EXAMPLES.map(ex => ({ label: ex.name, hint: ex.hint, icon: 'code' as const, onSelect: () => loadCode(ex.code, ex.settings) })),
    ...(saved.length ? ['separator' as const, ...saved.map(s => ({ label: s.name, hint: 'Saved by you · right-click a saved one in the panel to remove it', icon: 'star' as const, onSelect: () => loadCode(s.code, { clear: s.clear, readPicture: s.readPicture }) }))] : []),
    ...(saved.length ? ['separator' as const, ...saved.map(s => ({ label: `Remove “${s.name}”`, danger: true, onSelect: () => { removeScript(s.id); toast.info(`Removed “${s.name}”`); } }))] : []),
  ];
  const importMenu = (): MenuItem[] => {
    const items: MenuItem[] = [];
    const sources = [
      ...layers.filter(x => x.kind === 'script' && x.id !== l.id && typeof x.code === 'string').map(x => ({ label: x.label, code: x.code as string, what: 'layer' })),
      ...saved.map(s => ({ label: s.name, code: s.code, what: 'saved' })),
    ];
    for (const src of sources) {
      const fns = scriptFunctions(src.code).filter(fn => fn.name !== 'setup' && fn.name !== 'draw');
      items.push({ label: `${src.label}: everything`, hint: `Append the whole sketch (its setup/draw will clash with yours: rename or merge them)`, icon: src.what === 'layer' ? 'code' : 'star', onSelect: () => appendBlock(`from ${src.label}`, src.code) });
      if (fns.length) items.push({ label: `${src.label}: functions only`, hint: fns.map(fn => fn.name).join(', '), icon: 'fn', onSelect: () => appendBlock(`functions from ${src.label}`, fns.map(fn => fn.source).join('\n\n')) });
      for (const fn of fns.slice(0, 8)) items.push({ label: `    ${fn.name}()`, onSelect: () => appendBlock(`${fn.name} from ${src.label}`, fn.source) });
    }
    if (!items.length) items.push({ label: 'Nothing to import yet', hint: 'Other Script layers in this file, and sketches you save as starters, show up here.', disabled: true, onSelect: () => {} });
    return items;
  };
  const saveAsStarter = async () => {
    const name = await askText('Save as starter', { label: 'Name', initial: l.label, confirmLabel: 'Save' });
    if (!name) return;
    saveScript(name, draft, { clear: l.clear, readPicture: l.readPicture });
    toast.success(`Saved “${name}”`, { message: 'It is in Starters, and other script layers can import it.' });
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key === 'Enter') { e.preventDefault(); apply(draft); return; }
    if (mod && e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); return; }
    if (mod && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) { e.preventDefault(); redo(); return; }
    if (mod && e.key === 's') { e.preventDefault(); apply(draft); return; }
  };

  const heading = (t: string) => <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.08em', color: tk.text.faint, textTransform: 'uppercase' }}>{t}</span>;
  const q = filter.trim().toLowerCase();

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
            <ScriptPreview code={previewCode} defs={draftDefs} values={values} clear={l.clear} ratio={ratio} width={narrow ? Math.min(336, window.innerWidth - 56) : 336} />
            <span style={{ fontSize: 11.5, lineHeight: 1.45, color: tk.text.muted }}>
              The draft runs here on its own, as you type, with the layer’s current control values and the mouse over this box. The picture reads as a soft glow in the middle and there are no nulls. <b>Apply</b> puts it on the picture.
            </span>
          </>
        )}
        {tab === 'reference' && SCRIPT_REFERENCE.map(group => {
          const rows = q ? group.items.filter(it => `${it.name} ${it.doc}`.toLowerCase().includes(q)) : group.items;
          if (!rows.length) return null;
          return (
            <div key={group.title} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {heading(group.title)}
              {rows.map(it => (
                <div key={it.name} style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                  <Chip label={it.name} title="Insert at the caret" onClick={() => insertAtCaret(it.insert ?? it.name)} />
                  <span style={{ fontSize: 11.5, lineHeight: 1.35, color: tk.text.muted }}>{it.doc}</span>
                </div>
              ))}
            </div>
          );
        })}
        {tab === 'patterns' && SNIPPET_GROUPS.map(g => {
          const rows = SCRIPT_SNIPPETS.filter(sn => sn.group === g && (!q || `${sn.name} ${sn.doc}`.toLowerCase().includes(q)));
          if (!rows.length) return null;
          return (
            <div key={g} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {heading(g)}
              {rows.map(sn => (
                <div key={sn.name} style={{ padding: '8px 10px', borderRadius: radius.md, background: tk.bg.panel, boxShadow: `inset 0 0 0 1px ${tk.border.subtle}`, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <b style={{ flex: 1, fontSize: 12.5 }}>{sn.name}</b>
                    <span style={{ font: `600 10px ${fontFamily.ui}`, color: tk.text.faint, letterSpacing: '0.04em', textTransform: 'uppercase' }}>{sn.where === 'top' ? 'top of file' : `in ${sn.where}`}</span>
                    <Button size="sm" icon="plus" onMouseDown={e => e.preventDefault()} onClick={() => insertPattern(sn)}>Insert</Button>
                  </div>
                  <span style={{ fontSize: 11.5, lineHeight: 1.4, color: tk.text.muted }}>{sn.doc}</span>
                </div>
              ))}
            </div>
          );
        })}
        {tab === 'controls' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {heading('Declared by the sketch')}
            {(l.paramDefs ?? []).length === 0 && <span style={{ fontSize: 11.5, lineHeight: 1.45, color: tk.text.muted }}>None yet. Declare a params object, or select a variable in the code and turn it into one.</span>}
            <ScriptControls f={f} l={l} act={act} />
            <div style={{ marginTop: 8 }}>{heading('Canvas')}</div>
            {f.toggle('Clear', 'clear', 'Clear every frame', 'Off keeps what was drawn, for trails.')}
            {f.toggle('Picture', 'readPicture', 'Read the picture', 'Samples the shader each frame for s.picture.brightness(x, y).')}
            {f.props('opacity')}
          </div>
        )}
      </div>
    </div>
  );

  return (
    <Modal
      title="Script editor"
      subtitle={`${l.label} · JavaScript on a canvas over the picture`}
      icon="code"
      iconColor={tk.kind.fn}
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
              <IconButton icon="import" label="Import from another script layer or a saved sketch" onClick={e => openMenu(e, importMenu())} />
              <IconButton icon="star" label="Save as a starter of your own" onClick={saveAsStarter} />
            </>
          ) : (
            <>
              <Button icon="code" onClick={e => openMenu(e, startersMenu())}>Starters</Button>
              <Button icon="import" onClick={e => openMenu(e, importMenu())}>Import</Button>
              <Button icon="star" onClick={saveAsStarter} title="Keep this sketch as a starter of your own; other script layers can import it">Save as starter</Button>
            </>
          )}
          <span style={{ flex: 1, minWidth: 0, fontSize: 11.5, lineHeight: 1.35, color: error ? tk.status.danger : tk.text.faint, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'right' }} title={error ?? undefined}>
            {error ?? (narrow ? '' : dirty ? 'Edited · Apply to run it on the picture' : `Running on the picture · ${(l.paramDefs ?? []).length} control${(l.paramDefs ?? []).length === 1 ? '' : 's'}`)}
          </span>
          {dirty && !narrow && <Button variant="ghost" onClick={() => commit(l.code)}>Revert</Button>}
          <Button variant={dirty ? 'primary' : 'secondary'} icon="play" disabled={!dirty} onClick={() => apply(draft)} title="⌘/Ctrl+Enter">Apply</Button>
          <Button variant={dirty ? 'secondary' : 'primary'} onClick={() => { if (!dirty || apply(draft)) onClose(); }}>Done</Button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: narrow ? 'column' : 'row', height: '100%', minHeight: 0 }}>
        <div style={{ flex: 1, minWidth: 0, minHeight: narrow ? 320 : 0, display: 'flex', flexDirection: 'column', padding: 12, gap: 8 }}>
          {/* The selection: a variable that can become a control */}
          <div style={{ minHeight: 30, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {candidate ? (
              <>
                <span style={{ font: `500 12px ${fontFamily.mono}`, color: tk.text.secondary }}>{candidate.name}{candidate.kind === 'button' ? '()' : ` = ${String(candidate.value)}`}</span>
                <Button size="sm" icon="plus" onClick={() => turnInto(false)} title={candidate.kind === 'button' ? 'Add the function to params: a button on the layer that runs it' : `Add ${candidate.name} to params and let the ${KIND_WORD[candidate.kind]} drive the variable each frame`}>{`Make it a ${KIND_WORD[candidate.kind]}`}</Button>
                <Button size="sm" variant="ghost" onClick={() => turnInto(true)} title="The same, and put it on the Play panel right away">…and a Play control</Button>
              </>
            ) : (
              <span style={{ fontSize: 11.5, color: tk.text.faint }}>Select a variable set to a number or true/false, or a function’s name, to turn it into a slider, toggle or button. Double-click selects a word.</span>
            )}
          </div>
          <CodeField
            grow
            title="sketch.js"
            ariaLabel="Script code"
            value={draft}
            onChange={typed}
            completions={completions.all}
            members={completions.members}
            tokenize={tokenizeJsLine}
            autoIndent
            textareaRef={el => { taRef.current = el; }}
            onSelect={el => setSelected(el.value.slice(el.selectionStart, el.selectionEnd))}
            onKeyDown={onKeyDown}
            invalid={!!error}
            actions={<span style={{ fontSize: 11, color: tk.text.faint }}>Tab · 2 spaces · ⌘↵ applies</span>}
          />
        </div>
        {side}
      </div>
      {menu && <Menu x={menu.x} y={menu.y} items={menu.items} minWidth={300} maxWidth={420} onClose={() => setMenu(null)} />}
    </Modal>
  );
}
