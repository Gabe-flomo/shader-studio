/**
 * TypeAhead — the suggestion list and signature line the builders' text fields share (lang/complete.ts
 * makes the suggestions): the recipe, the Do… bar, the Agent Rules pickers, the Grid Rules fields.
 *
 *  - useTypeAhead: for a text field you already have. Feed it the text and caret; it gives the
 *    suggestions, a key handler (↑ ↓ to move, Tab or Enter to take one, Esc to close) and `pick`.
 *  - <AssistList>: the list (label, one-line description, signature) and the signature help line.
 *  - <TypeAheadPicker>: a combobox over a fixed list, for "+ and…" / "+ do…".
 */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import { pickerAssist, type Assist, type Completion, type Signature } from '../../lang/complete';

export function useTypeAhead(text: string, caret: number | null, compute: (text: string, caret: number) => Assist, apply: (next: string, caret: number) => void) {
  const [active, setActive] = useState(0);
  const [closed, setClosed] = useState(false);
  const assist = useMemo(() => (caret === null ? null : compute(text, caret)), [text, caret, compute]);
  useEffect(() => { setActive(0); setClosed(false); }, [text, caret]);
  const items = !closed && assist ? assist.items : [];
  const pick = (c: Completion) => {
    if (!assist) return;
    const next = c.replaceAll ? c.insert : text.slice(0, assist.from) + c.insert + text.slice(assist.to);
    apply(next, c.replaceAll ? c.insert.length : assist.from + c.insert.length);
    setClosed(true);
  };
  const onKeyDown = (e: KeyboardEvent): boolean => {
    if (!items.length) return false;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => (a + 1) % items.length); return true; }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => (a - 1 + items.length) % items.length); return true; }
    if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey)) { e.preventDefault(); pick(items[Math.min(active, items.length - 1)]); return true; }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setClosed(true); return true; }
    return false;
  };
  return { items, active, setActive, pick, onKeyDown, signature: assist?.signature ?? null, close: () => setClosed(true) };
}

const KIND_COLOUR: Record<string, 'accent' | 'faint'> = { shape: 'accent', combine: 'accent', warp: 'accent', action: 'accent', output: 'accent' };

export function SignatureLine({ sig }: { sig: Signature }) {
  const tk = useTokens();
  const p = sig.params[sig.active];
  return (
    <div data-signature style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '6px 10px', borderRadius: radius.md, background: tk.bg.subtle, font: `12px ${fontFamily.mono}`, color: tk.text.secondary }}>
      <span>
        <b style={{ color: tk.text.primary }}>{sig.head}</b>{' '}
        {sig.params.map((x, i) => (
          <span key={i} style={{ marginRight: 6, color: i === sig.active ? tk.accent.text : undefined, fontWeight: i === sig.active ? 700 : 400, textDecoration: i === sig.active ? 'underline' : 'none' }}>{x.text}</span>
        ))}
      </span>
      {p && <span style={{ font: `11.5px ${fontFamily.ui}`, color: tk.text.muted }}>{p.label}: {p.hint}</span>}
    </div>
  );
}

export function AssistList({ items, active, onPick, onHover, footer }: { items: Completion[]; active: number; onPick: (c: Completion) => void; onHover?: (i: number) => void; footer?: ReactNode }) {
  const tk = useTokens();
  if (!items.length) return null;
  return (
    <div role="listbox" data-assist-list style={{
      display: 'flex', flexDirection: 'column', padding: 4, borderRadius: radius.md, background: tk.bg.panel, boxShadow: tk.shadow.popover,
      border: `1px solid ${tk.border.default}`, maxHeight: 260, overflowY: 'auto',
    }}>
      {items.map((c, i) => (
        <button key={`${c.kind}:${c.label}`} type="button" role="option" aria-selected={i === active} data-assist-item={c.label}
          onMouseDown={e => { e.preventDefault(); onPick(c); }} onMouseEnter={() => onHover?.(i)}
          style={{
            display: 'grid', gridTemplateColumns: 'minmax(90px, auto) 1fr', gap: 10, alignItems: 'baseline', textAlign: 'left', border: 0, cursor: 'pointer',
            padding: '4px 8px', borderRadius: radius.md, background: i === active ? alpha(tk.accent.base, 0.12) : 'transparent', color: tk.text.primary,
          }}>
          <span style={{ font: `600 12.5px ${fontFamily.mono}`, color: KIND_COLOUR[c.kind] === 'accent' ? tk.accent.text : tk.text.primary, whiteSpace: 'nowrap' }}>{c.label}</span>
          <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            <span style={{ font: `12px ${fontFamily.ui}`, color: tk.text.secondary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.detail}</span>
            {c.signature && <span style={{ font: `11px ${fontFamily.mono}`, color: tk.text.faint, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.signature}</span>}
          </span>
        </button>
      ))}
      {footer}
      <span style={{ padding: '3px 8px 1px', font: `10.5px ${fontFamily.ui}`, color: tk.text.faint }}>↑ ↓ to choose · Tab or Enter to take · Esc to close</span>
    </div>
  );
}

export interface PickerItem { value: string; label: string; hint?: string; example?: string; words?: string[] }

/** A combobox over a fixed list: type to filter (by name, words and hint), Enter or click to pick. */
export function TypeAheadPicker({ items, onPick, placeholder, ariaLabel, width = 150 }: { items: PickerItem[]; onPick: (value: string) => void; placeholder: string; ariaLabel: string; width?: number }) {
  const tk = useTokens();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const ref = useRef<HTMLInputElement>(null);
  const shown = pickerAssist(q, items.map(it => ({ ...it, words: [...(it.words ?? []), ...(it.hint ? it.hint.toLowerCase().split(/[^a-z]+/).filter(w => w.length > 3) : [])] })), 20);
  useEffect(() => setActive(0), [q]);
  const take = (v: string) => { onPick(v); setQ(''); setOpen(false); ref.current?.blur(); };
  return (
    <span style={{ position: 'relative', display: 'inline-flex' }}>
      <input ref={ref} value={q} placeholder={placeholder} aria-label={ariaLabel} role="combobox" aria-expanded={open} data-type-ahead={ariaLabel}
        onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 120)}
        onChange={e => { setQ(e.target.value); setOpen(true); }}
        onKeyDown={e => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, shown.length - 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)); }
          else if ((e.key === 'Enter' || e.key === 'Tab') && shown[active] && q) { e.preventDefault(); take(shown[active].value); }
          else if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); setQ(''); }
        }}
        style={{ width, height: 28, boxSizing: 'border-box', padding: '0 8px', borderRadius: radius.md, border: 0, outline: 'none', background: tk.bg.field, color: tk.text.primary, font: `12.5px ${fontFamily.ui}`, boxShadow: `inset 0 0 0 1px ${open ? tk.accent.base : tk.border.default}` }} />
      {open && shown.length > 0 && (
        <div role="listbox" data-picker-list style={{ position: 'absolute', top: 32, left: 0, zIndex: 30, width: 340, display: 'flex', flexDirection: 'column', padding: 4, borderRadius: radius.md, background: tk.bg.panel, boxShadow: tk.shadow.popover, border: `1px solid ${tk.border.default}`, maxHeight: 300, overflowY: 'auto' }}>
          {shown.map((it, i) => (
            <button key={it.value} type="button" role="option" aria-selected={i === active} data-picker-item={it.value}
              onMouseDown={e => { e.preventDefault(); take(it.value); }} onMouseEnter={() => setActive(i)}
              style={{ display: 'flex', flexDirection: 'column', gap: 1, textAlign: 'left', border: 0, cursor: 'pointer', padding: '5px 8px', borderRadius: radius.md, background: i === active ? alpha(tk.accent.base, 0.12) : 'transparent', color: tk.text.primary }}>
              <b style={{ font: `600 12.5px ${fontFamily.ui}` }}>{it.label}</b>
              {it.hint && <span style={{ font: `11.5px ${fontFamily.ui}`, color: tk.text.muted }}>{it.hint}</span>}
              {it.example && <span style={{ font: `11px ${fontFamily.mono}`, color: tk.text.faint }}>e.g. {it.example}</span>}
            </button>
          ))}
        </div>
      )}
    </span>
  );
}
