import { useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import { ProBadge } from '../account/ProSheet';
import { Icon } from './Icon';
import { menuAsSheet } from './menuSheet';
import { Popover } from './Popover';
import { Sheet } from './Sheet';
import {
  SEARCH_ABOVE, countItems, filterSections, findItem, moveActive, navigableValues, typeahead,
  type NavKey, type PickerItem, type PickerSection,
} from './groupedPickerModel';

export type { PickerItem, PickerSection } from './groupedPickerModel';

const NAV_KEYS = new Set<string>(['ArrowDown', 'ArrowUp', 'Home', 'End', 'PageDown', 'PageUp']);

/**
 * A dropdown for long or grouped lists. The face is Select's (same height, font and chevron, so
 * swapping one for the other never moves a layout); it opens a popover on desktop and a bottom
 * sheet on phones with section headings, an icon, a label and a short muted line per row, the Pro
 * badge on locked rows and a check on the current one. A search field shows above `SEARCH_ABOVE`
 * items (focused on desktop, not on phones, so the keyboard doesn't jump up).
 *
 * Keyboard: ↑/↓, Home/End and Page keys move (headings are skipped), Enter picks, Esc closes,
 * typing filters (or, without a search field, jumps to the next label starting with it).
 * `onChange` gets every pick, locked ones included: the caller decides what a locked pick does.
 */
export function GroupedPicker({
  value, sections, onChange, ariaLabel, height = 30, mono = false, style, search = 'auto', title,
  placeholder, searchPlaceholder = 'Search', width = 280, sheet = 'auto',
}: {
  value: string;
  sections: readonly PickerSection[];
  onChange: (value: string) => void;
  ariaLabel: string;
  height?: number;
  mono?: boolean;
  style?: CSSProperties;
  /** 'auto': a search field above SEARCH_ABOVE items. */
  search?: boolean | 'auto';
  /** The phone sheet's title (defaults to ariaLabel). */
  title?: string;
  /** Face text when `value` isn't in the list. */
  placeholder?: string;
  searchPlaceholder?: string;
  /** Popover's least width; it is never narrower than the face. */
  width?: number;
  sheet?: boolean | 'auto';
}) {
  const tk = useTokens();
  const faceRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState<{ asSheet: boolean; width: number; query: string } | null>(null);
  const [focusRing, setFocusRing] = useState(false);
  const current = findItem(sections, value);
  const withSearch = search === 'auto' ? countItems(sections) > SEARCH_ABOVE : search;
  const listId = useId();

  const show = (query = '') => {
    const w = faceRef.current?.offsetWidth ?? 0;
    setOpen({ asSheet: menuAsSheet(window.innerWidth, sheet), width: Math.min(420, Math.max(w, width)), query });
  };
  const close = (refocus: boolean) => {
    setOpen(null);
    if (refocus) faceRef.current?.focus({ preventScroll: true });
  };

  const onFaceKey = (e: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); show(); return; }
    // Typing on the closed face opens it with the search already started.
    if (withSearch && e.key.length === 1 && e.key !== ' ' && !e.metaKey && !e.ctrlKey && !e.altKey) { e.preventDefault(); e.stopPropagation(); show(e.key); }
  };

  return (
    <>
      <button
        ref={faceRef}
        type="button"
        role="combobox"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={!!open}
        aria-controls={open ? listId : undefined}
        title={current?.label}
        onClick={() => (open ? close(false) : show())}
        onKeyDown={onFaceKey}
        onFocus={e => setFocusRing(e.currentTarget.matches(':focus-visible'))}
        onBlur={() => setFocusRing(false)}
        style={{
          position: 'relative', height, display: 'inline-flex', alignItems: 'center', gap: 6, padding: '0 6px 0 10px', minWidth: 0,
          border: 0, borderRadius: radius.md, background: tk.bg.field, color: current ? tk.text.primary : tk.text.muted, cursor: 'pointer', textAlign: 'left',
          font: `500 12.5px ${mono ? fontFamily.mono : fontFamily.ui}`, outline: 'none',
          boxShadow: focusRing || open ? `inset 0 0 0 1.5px ${alpha(tk.accent.base, open ? 0.55 : 1)}` : 'none', ...style,
        }}
      >
        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{current?.label ?? placeholder ?? value}</span>
        {current?.pro && <ProBadge />}
        <Icon name="chevD" size={14} style={{ color: tk.text.faint, flexShrink: 0 }} />
      </button>
      {open && (
        <PickerPanel
          listId={listId}
          sections={sections}
          value={value}
          ariaLabel={ariaLabel}
          title={title ?? ariaLabel}
          asSheet={open.asSheet}
          width={open.width}
          withSearch={withSearch}
          initialQuery={open.query}
          searchPlaceholder={searchPlaceholder}
          anchorRef={faceRef}
          onPick={v => { close(true); onChange(v); }}
          onClose={close}
        />
      )}
    </>
  );
}

/** The open list: mounted only while open, so a closed picker costs a button. */
function PickerPanel({
  listId, sections, value, ariaLabel, title, asSheet, width, withSearch, initialQuery, searchPlaceholder, anchorRef, onPick, onClose,
}: {
  listId: string;
  sections: readonly PickerSection[];
  value: string;
  ariaLabel: string;
  title: string;
  asSheet: boolean;
  width: number;
  withSearch: boolean;
  initialQuery: string;
  searchPlaceholder: string;
  anchorRef: React.RefObject<HTMLButtonElement | null>;
  onPick: (value: string) => void;
  onClose: (refocus: boolean) => void;
}) {
  const tk = useTokens();
  const [query, setQuery] = useState(initialQuery);
  const shown = filterSections(sections, query);
  const values = navigableValues(shown);
  const [active, setActive] = useState<string | null>(() => (values.includes(value) ? value : values[0] ?? null));
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const typed = useRef({ text: '', at: 0 });
  const optId = (v: string) => `${listId}-o-${values.indexOf(v)}`;
  // The active row stays in view as the keys move it; the mouse moving it mustn't scroll.
  const scrollOnMove = useRef(true);

  // A search that hides the active row moves it to the first match.
  const activeNow = active !== null && values.includes(active) ? active : values[0] ?? null;

  useLayoutEffect(() => {
    // Opening: the current row in the middle of the list, focus in the search (desktop) or the list.
    const list = listRef.current;
    const row = list?.querySelector<HTMLElement>('[aria-selected="true"]');
    // The sheet scrolls as a whole (its body is the scroller); the popover's list scrolls itself.
    if (row && asSheet) row.scrollIntoView({ block: 'center' });
    else if (list && row) list.scrollTop = row.offsetTop - list.clientHeight / 2 + row.offsetHeight / 2;
    // The list keeps its opening height while a search shortens it, so the panel doesn't jump.
    if (list && !asSheet) list.style.minHeight = `${Math.min(list.offsetHeight, list.scrollHeight)}px`;
    const body = bodyRef.current;
    const scroller = body?.parentElement;
    if (body && scroller && asSheet) body.style.minHeight = `${Math.min(body.offsetHeight, scroller.clientHeight - 20)}px`;
    if (withSearch && !asSheet) inputRef.current?.focus({ preventScroll: true });
    else bodyRef.current?.focus({ preventScroll: true });
    if (initialQuery && inputRef.current) {
      const n = initialQuery.length;
      inputRef.current.setSelectionRange(n, n);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useLayoutEffect(() => {
    if (!scrollOnMove.current || activeNow === null) return;
    const list = listRef.current;
    const row = list?.querySelector<HTMLElement>(`[data-value="${CSS.escape(activeNow)}"]`);
    if (!list || !row) return;
    if (asSheet) { row.scrollIntoView({ block: 'nearest' }); return; }
    const top = row.offsetTop;
    const bottom = top + row.offsetHeight;
    // A section's first row brings its heading along.
    const prev = row.previousElementSibling as HTMLElement | null;
    const head = prev?.hasAttribute('data-heading') ? prev.offsetHeight : 0;
    if (top - head < list.scrollTop) list.scrollTop = top - head;
    else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight;
  }, [activeNow, asSheet]);

  const onKeyDown = (e: ReactKeyboardEvent) => {
    // Keys belong to the picker while it's open: the app's shortcuts and Play's key sources listen
    // on window and would otherwise fire on the letters typed here (Esc is the Popover's, in capture).
    if (!e.metaKey && !e.ctrlKey) e.stopPropagation();
    if (NAV_KEYS.has(e.key)) {
      // Home/End stay with the text when there is some to move through.
      if ((e.key === 'Home' || e.key === 'End') && e.target === inputRef.current && query) return;
      e.preventDefault();
      scrollOnMove.current = true;
      setActive(moveActive(values, activeNow, e.key as NavKey));
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (activeNow !== null) onPick(activeNow);
      return;
    }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(true); return; }
    if (e.key === 'Tab') { e.preventDefault(); onClose(true); return; }
    if (e.target === inputRef.current) return;
    const printable = e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey;
    if (withSearch && (printable || e.key === 'Backspace')) {
      // Typing in the list goes to the search.
      e.preventDefault();
      setQuery(q => (e.key === 'Backspace' ? q.slice(0, -1) : q + e.key));
      inputRef.current?.focus({ preventScroll: true });
      return;
    }
    if (printable && e.key !== ' ') {
      e.preventDefault();
      const now = performance.now();
      const t = typed.current;
      t.text = now - t.at > 700 ? e.key : t.text + e.key;
      t.at = now;
      const hit = typeahead(shown, activeNow, t.text);
      if (hit !== null) { scrollOnMove.current = true; setActive(hit); }
    }
  };

  const rowH = asSheet ? 46 : 30;
  const body = (
    <div
      ref={bodyRef}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      style={{ display: 'flex', flexDirection: 'column', minHeight: 0, outline: 'none', flex: asSheet ? 1 : undefined }}
    >
      {withSearch && (
        <div style={{ padding: asSheet ? '0 0 8px' : 4, flexShrink: 0, ...(asSheet ? { position: 'sticky', top: 0, zIndex: 1, background: tk.bg.panel } : null) }}>
          <label style={{
            height: asSheet ? 40 : 30, display: 'flex', alignItems: 'center', gap: 7, padding: '0 9px', borderRadius: radius.md,
            background: tk.bg.field, cursor: 'text',
          }}>
            <Icon name="search" size={asSheet ? 15 : 13} style={{ color: tk.text.faint, flexShrink: 0 }} />
            <input
              ref={inputRef}
              type="text"
              role="searchbox"
              aria-label={`Search ${ariaLabel.toLowerCase()}`}
              aria-controls={listId}
              aria-activedescendant={activeNow !== null ? optId(activeNow) : undefined}
              autoComplete="off"
              spellCheck={false}
              placeholder={searchPlaceholder}
              value={query}
              onChange={e => { scrollOnMove.current = true; setQuery(e.target.value); if (listRef.current) listRef.current.scrollTop = 0; }}
              style={{ flex: 1, minWidth: 0, border: 0, outline: 'none', background: 'transparent', padding: 0, color: tk.text.primary, font: `500 ${asSheet ? 15 : 12.5}px ${fontFamily.ui}` }}
            />
            {query && (
              <button type="button" aria-label="Clear search" onClick={() => { setQuery(''); inputRef.current?.focus(); }}
                style={{ width: 18, height: 18, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: 0, borderRadius: 9, padding: 0, background: 'transparent', color: tk.text.faint, cursor: 'pointer' }}>
                <Icon name="close" size={12} />
              </button>
            )}
          </label>
        </div>
      )}
      <div
        ref={listRef}
        id={listId}
        role="listbox"
        aria-label={ariaLabel}
        aria-activedescendant={!withSearch && activeNow !== null ? optId(activeNow) : undefined}
        style={{
          position: 'relative', overflowY: 'auto', overscrollBehavior: 'contain', minHeight: 0,
          maxHeight: asSheet ? undefined : 'min(380px, calc(100dvh - 120px))', flex: asSheet ? 1 : undefined,
          padding: asSheet ? '0 0 8px' : '0 4px 4px', paddingTop: withSearch ? 0 : 4,
        }}
      >
        {shown.length === 0 && (
          <div style={{ padding: asSheet ? '18px 12px' : '12px 10px', color: tk.text.faint, font: `${asSheet ? 14 : 12}px ${fontFamily.ui}` }}>No matches for “{query}”</div>
        )}
        {shown.map((s, si) => (
          <div key={`${s.heading ?? ''}${si}`} role="group" aria-label={s.heading} style={{ display: 'contents' }}>
            {s.heading && (
              <div data-heading="" role="presentation" style={{
                padding: asSheet ? '12px 12px 4px' : si === 0 && !withSearch ? '4px 10px 3px' : '8px 10px 3px',
                color: tk.text.faint, font: `700 ${asSheet ? 11 : 10}px ${fontFamily.ui}`, letterSpacing: '0.07em', textTransform: 'uppercase',
              }}>{s.heading}</div>
            )}
            {s.items.map(it => (
                <Row
                  key={it.value}
                  id={optId(it.value)}
                  item={it}
                  selected={it.value === value}
                  active={it.value === activeNow}
                  asSheet={asSheet}
                  height={rowH}
                  onHover={() => { if (!it.disabled) { scrollOnMove.current = false; setActive(it.value); } }}
                  onPick={() => { if (!it.disabled) onPick(it.value); }}
                />
            ))}
          </div>
        ))}
      </div>
    </div>
  );

  if (asSheet) {
    return (
      <Sheet title={title} onClose={() => onClose(false)} zIndex={9000} maxHeight="80dvh">
        {body}
      </Sheet>
    );
  }
  return (
    <Popover anchorRef={anchorRef} onClose={() => onClose(document.activeElement === document.body || !!bodyRef.current?.contains(document.activeElement))} width={width} padding={0}>
      {body}
    </Popover>
  );
}

function Row({ id, item: it, selected, active, asSheet, height, onHover, onPick }: {
  id: string;
  item: PickerItem;
  selected: boolean;
  active: boolean;
  asSheet: boolean;
  height: number;
  onHover: () => void;
  onPick: () => void;
}) {
  const tk = useTokens();
  return (
    <div
      id={id}
      data-value={it.value}
      role="option"
      aria-selected={selected}
      aria-disabled={it.disabled || undefined}
      onMouseMove={onHover}
      // Keep focus in the search/list, so the keys keep working after a hover.
      onPointerDown={e => e.preventDefault()}
      onClick={onPick}
      style={{
        minHeight: height, display: 'flex', alignItems: 'center', gap: asSheet ? 12 : 9, padding: asSheet ? '6px 12px' : '4px 10px',
        borderRadius: asSheet ? radius.lg : radius.md - 1, cursor: it.disabled ? 'default' : 'pointer', boxSizing: 'border-box',
        background: active ? (selected ? tk.bg.selected : tk.bg.field) : 'transparent', opacity: it.disabled ? 0.45 : 1,
        color: tk.text.primary,
      }}
    >
      {it.icon && <Icon name={it.icon} size={asSheet ? 18 : 15} style={{ color: selected ? tk.accent.base : tk.text.muted, flexShrink: 0 }} />}
      <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
        <span style={{
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          font: `${selected ? 600 : 500} ${asSheet ? 15 : 12.5}px ${fontFamily.ui}`, color: selected ? tk.accent.text : tk.text.primary,
        }}>{it.label}</span>
        {it.description && (
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', font: `${asSheet ? 12.5 : 11}px/1.3 ${fontFamily.ui}`, color: tk.text.faint }}>{it.description}</span>
        )}
      </span>
      {it.pro && <ProBadge />}
      <span style={{ width: asSheet ? 18 : 14, flexShrink: 0, display: 'inline-flex' }}>
        {selected && <Icon name="check" size={asSheet ? 18 : 14} style={{ color: tk.accent.base }} />}
      </span>
    </div>
  );
}
