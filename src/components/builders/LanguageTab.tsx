/**
 * LanguageTab — a builder's Recipe tab for a dialect of the Playfield language
 * (docs/playfield-language-plan.md §10.2): the builder's data as canonical text, editable.
 *
 *  - The text is printed from the data (Grid Rules params, an agent rule set) and follows the form
 *    while you aren't editing it.
 *  - Typing reads it as you go: mistakes are underlined and listed at their line and column with
 *    "did you mean"; old words get a hint and a Use… button; `random` values show what they became.
 *  - Apply (or ⌘Enter, or leaving the field) writes it into the builder as one undo step. Rules
 *    bake into GLSL, so text is not applied on every keystroke.
 *  - Type-ahead and the signature line come from the registry (lang/complete.ts langAssist).
 *
 * The Scene Builder's own Recipe tab (sceneBuilder/tabs.tsx) has rows as well and applies live.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTokens } from '../../theme/themeStore';
import { fontFamily, radius } from '../../theme/tokens';
import { Button } from '../ui/Button';
import { toast } from '../ui/toastStore';
import { CodeField } from '../code/CodeField';
import type { Completion } from '../code/glslReference';
import { BuilderLabel, BuilderNote } from './BuilderWindow';
import { AssistList, SignatureLine, useTypeAhead } from './TypeAhead';
import { recipeHtml } from '../sceneBuilder/recipeColours';
import { langAssist } from '../../lang/complete';
import { wordKindFor } from '../../lang/highlight';
import { freshSeed, type Resolved } from '../../lang/random';
import type { Diagnostic } from '../../lang/ast';
import type { Dialect } from '../../lang/registry';
import type { RecipeError } from '../../sceneBuilder/recipe';

export interface LanguageRead {
  errors: Diagnostic[];
  hints: Diagnostic[];
  resolved: Resolved[];
  /** Write what was read into the builder (one undo step). */
  apply: () => void;
  /** The text with what was drawn written in (for Keep these). */
  kept?: string;
}

const asRecipeErrors = (ds: Diagnostic[]): RecipeError[] => ds.map(d => ({ message: d.message, from: d.at, to: d.end, line: d.line, col: d.col }));
const NO_COMPLETIONS: Completion[] = [];

export function LanguageTab({ dialect, printed, read, title = 'Recipe', note, examples }: {
  dialect: Dialect;
  /** The data as canonical text (pretty form). */
  printed: string;
  /** Read text (with a seed for random values). */
  read: (text: string, seed: number) => LanguageRead;
  title?: string;
  note?: string;
  examples?: Array<{ label: string; text: string }>;
}) {
  const tk = useTokens();
  const [text, setText] = useState(printed);
  const [dirty, setDirty] = useState(false);
  const [focused, setFocused] = useState(false);
  const [caret, setCaret] = useState<number | null>(null);
  const [seed, setSeed] = useState(freshSeed);
  const area = useRef<HTMLTextAreaElement | null>(null);
  // While you aren't editing, the text follows the form.
  useEffect(() => { if (!dirty) setText(printed); }, [printed, dirty]);
  const r = useMemo(() => read(text, seed), [text, seed, read]);
  const wordKind = useMemo(() => wordKindFor(dialect), [dialect]);
  const errors = useMemo(() => asRecipeErrors(r.errors), [r.errors]);
  const assist = useMemo(() => (t: string, c: number) => langAssist(t, c, dialect), [dialect]);
  const change = (v: string) => { setText(v); setDirty(true); };
  const ta = useTypeAhead(text, focused ? caret : null, assist, (next, at) => {
    change(next);
    requestAnimationFrame(() => { area.current?.focus(); area.current?.setSelectionRange(at, at); setCaret(at); });
  });
  const apply = () => {
    if (r.errors.length) return;
    r.apply();
    setDirty(false);
  };
  const danger = tk.status.danger;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }} data-language-tab={dialect}>
      <BuilderLabel meta="type or paste; Apply writes it into the form">{title}</BuilderLabel>
      {note && <BuilderNote>{note}</BuilderNote>}
      <CodeField value={text} onChange={change} completions={NO_COMPLETIONS} ariaLabel={`${title} text`} title={title}
        textareaRef={el => { area.current = el; if (el) el.dataset.languageText = dialect; }}
        highlight={(v, pal) => recipeHtml(v, pal, danger, errors, wordKind)}
        keyFirst={e => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); apply(); return true; }
          return ta.onKeyDown(e);
        }}
        onFocus={el => { setFocused(true); setCaret(el.selectionStart); }}
        onBlur={() => { setFocused(false); setCaret(null); if (dirty && !r.errors.length) apply(); }}
        onSelect={el => setCaret(el.selectionStart)}
        invalid={r.errors.length > 0} minHeight={140} maxHeight={420} />
      {focused && ta.signature && <SignatureLine sig={ta.signature} />}
      {ta.items.length > 0 && <AssistList items={ta.items} active={ta.active} onPick={ta.pick} onHover={ta.setActive} />}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <Button size="sm" variant="primary" icon="check" disabled={!dirty || r.errors.length > 0} onClick={apply} data-language-apply title="Write the text into the form (⌘Enter)">Apply</Button>
        {dirty && <Button size="sm" variant="ghost" icon="undo" onClick={() => { setText(printed); setDirty(false); }}>Back to the form</Button>}
        <Button size="sm" variant="ghost" icon="copy" onClick={() => { void navigator.clipboard?.writeText(text).then(() => toast.success('Copied')).catch(() => {}); }}>Copy</Button>
        <span style={{ flex: 1 }} />
        <BuilderNote>{r.errors.length ? `${r.errors.length} mistake${r.errors.length === 1 ? '' : 's'}` : dirty ? 'Reads cleanly: Apply to use it' : 'The form as text'}</BuilderNote>
      </div>
      {r.errors.map((e, i) => (
        <button key={i} type="button" data-language-error onClick={() => requestAnimationFrame(() => { area.current?.focus(); area.current?.setSelectionRange(e.at, e.end); })}
          style={{ textAlign: 'left', border: 0, borderRadius: radius.md, padding: '6px 10px', background: tk.bg.field, color: tk.text.primary, cursor: 'pointer', font: `12px ${fontFamily.ui}` }}>
          <b style={{ color: tk.status.danger, font: `600 11px ${fontFamily.mono}` }}>{e.line}:{e.col}</b>&nbsp; {e.message}
          {e.fixes?.map(f => <span key={f} style={{ marginLeft: 8, font: `11.5px ${fontFamily.mono}`, color: tk.accent.text }}>{f}</span>)}
        </button>
      ))}
      {r.hints.map((h, i) => (
        <span key={`h${i}`} data-language-hint style={{ display: 'flex', alignItems: 'center', gap: 8, font: `12px ${fontFamily.ui}`, color: tk.text.secondary }}>
          <b style={{ font: `600 11px ${fontFamily.mono}`, color: tk.text.muted }}>{h.line}:{h.col}</b>{h.message}
          {h.fixes?.[0] && <Button size="sm" variant="ghost" onClick={() => change(`${text.slice(0, h.at)}${h.fixes![0]}${text.slice(h.end)}`)}>Use {h.fixes[0]}</Button>}
        </span>
      ))}
      {r.resolved.length > 0 && (
        <div data-language-random style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '8px 10px', borderRadius: radius.md, background: tk.bg.field }}>
          <span style={{ display: 'flex', flexWrap: 'wrap', gap: 6, font: `11.5px ${fontFamily.mono}` }}>
            {r.resolved.map((x, i) => <span key={i} style={{ padding: '1px 6px', borderRadius: 6, background: tk.bg.subtle }}>{x.key}={x.from} → <b>{x.to}</b></span>)}
          </span>
          <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <Button size="sm" variant="secondary" icon="dice" onClick={() => setSeed(freshSeed())}>Roll again</Button>
            {r.kept && <Button size="sm" variant="ghost" icon="check" onClick={() => change(r.kept!)}>Keep these</Button>}
            <BuilderNote>{/seed\s*=?\s*\d/i.test(text) ? 'Random values' : `Random values (seed ${seed}: add seed=${seed} to repeat them)`}</BuilderNote>
          </span>
        </div>
      )}
      {examples && examples.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
          <BuilderNote>Try:</BuilderNote>
          {examples.map(x => <Button key={x.label} size="sm" variant="ghost" onClick={() => change(x.text)} title={x.text}>{x.label}</Button>)}
        </div>
      )}
    </div>
  );
}
