import { Fragment, useCallback, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useTokens } from '../../theme/themeStore';
import { fontFamily, radius } from '../../theme/tokens';
import { IconButton } from './Button';
import { Icon } from './Icon';
import type { IconName } from './iconPaths';
import { Popover } from './Popover';
import { fitItems, type FitMeasure } from './fitLayout';

/**
 * One item on a FitToolbar. Either a plain action (`onSelect` + `icon`: drawn as an icon button on
 * the bar, a menu row in the "⋯"), or any control (`node`: drawn as it is on the bar, and beside
 * its `label` in the "⋯" — so a picker with its own popover works the same in both places).
 */
export interface FitToolbarItem {
  key: string;
  /** Plain words: the menu row's name, and the bar button's tooltip when it's a plain action. */
  label: string;
  /** A longer tooltip under the label, and a second line in the menu. */
  hint?: string;
  icon?: IconName;
  /** A plain action. */
  onSelect?: () => void;
  /** Lit (a toggle that is on). */
  active?: boolean;
  disabled?: boolean;
  danger?: boolean;
  shortcut?: string;
  /** The control on the bar (a labelled button, a picker). Without one, a plain action is an icon button. */
  node?: ReactNode;
  /** The control in the menu, beside the label (default: `node`). Not used when there is an `onSelect`: the row runs it. */
  menuNode?: ReactNode;
  /** Higher stays on the bar longer (default 50). */
  priority?: number;
  /** Never folds: the bar scrolls sideways before this goes. */
  pinned?: boolean;
  /** 'always': only ever in the "⋯" (rarely used). 'never': folding drops it (a label, a divider). */
  menu?: 'always' | 'never';
  /** A heading in the "⋯" over this item and the ones after it with the same group. */
  group?: string;
  /** Takes the free room on the bar (a spacer between the left and right ends). Never folds. */
  grow?: boolean;
  /** A thin line between groups on the bar; folds (and is dropped) with its priority. */
  divider?: boolean;
}

export interface FitToolbarProps {
  items: readonly FitToolbarItem[];
  /** The toolbar's name for assistive tech ("Preview tools"). */
  ariaLabel: string;
  gap?: number;
  /** Items sit at the right end (a leading spacer takes the free room). */
  alignEnd?: boolean;
  /** Clicks on "⋯" and its rows don't take focus (the Code editor keeps its selection for Explain). */
  keepFocus?: boolean;
  /** The "⋯" button's tooltip. */
  moreLabel?: string;
  menuWidth?: number;
  style?: CSSProperties;
  /** Small icon buttons on the bar (26px), as in panel headers. */
  size?: 'sm' | 'md';
  /**
   * Where the room comes from, when it isn't the bar's own width: a bar inside a box that is only as
   * wide as its content (the canvas's floating toolbar) measures the box's container, less `inset`.
   */
  fitTo?: (bar: HTMLElement) => { el: Element; inset: number } | null;
}

const MORE_FALLBACK_W = 28;

/**
 * FitToolbar — a toolbar that never loses a button (docs/toolbars.md). It measures itself with a
 * ResizeObserver, and when its items don't fit, the lowest-priority ones move into a "⋯" menu at
 * its end; as a last resort (pinned items alone are too wide) the bar scrolls sideways with faded
 * edges. Everything stays reachable at any width.
 */
export function FitToolbar({ items, ariaLabel, gap = 2, alignEnd = false, keepFocus = false, moreLabel = 'More', menuWidth = 280, style, size = 'sm', fitTo }: FitToolbarProps) {
  const tk = useTokens();
  const barRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLSpanElement>(null);
  const widths = useRef(new Map<string, number>());
  const moreW = useRef(MORE_FALLBACK_W);
  const [folded, setFolded] = useState<ReadonlySet<string>>(() => new Set(items.filter(i => i.menu === 'always').map(i => i.key)));
  const [open, setOpen] = useState(false);
  const [fade, setFade] = useState({ left: false, right: false });
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const fitToRef = useRef(fitTo);
  fitToRef.current = fitTo;

  const fit = useCallback(() => {
    const bar = barRef.current;
    if (!bar) return;
    for (const el of bar.querySelectorAll<HTMLElement>('[data-fit-key]')) {
      const w = el.getBoundingClientRect().width;
      if (w > 0 || !widths.current.has(el.dataset.fitKey!)) widths.current.set(el.dataset.fitKey!, w);
    }
    const mw = moreRef.current?.getBoundingClientRect().width;
    if (mw) moreW.current = mw;
    const cs = getComputedStyle(bar);
    const pad = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
    const outer = fitToRef.current?.(bar);
    const avail = (outer ? outer.el.clientWidth - outer.inset : bar.clientWidth) - pad;
    const list: FitMeasure[] = itemsRef.current.filter(i => !i.grow).map(i => ({
      key: i.key, width: widths.current.get(i.key) ?? 0, priority: i.priority ?? 50,
      pinned: i.pinned, alwaysMenu: i.menu === 'always', noMenu: i.menu === 'never' || i.divider,
    }));
    const next = fitItems(list, avail, moreW.current, gap).folded;
    setFolded(prev => (prev.size === next.size && [...next].every(k => prev.has(k)) ? prev : next));
    // The last resort: the bar scrolls sideways; fade whichever end has more.
    const left = bar.scrollLeft > 1, right = bar.scrollLeft + bar.clientWidth < bar.scrollWidth - 1;
    setFade(f => (f.left === left && f.right === right ? f : { left, right }));
  }, [gap]);

  // After every render: new items, or a label that changed width (the fps readout), are measured.
  useLayoutEffect(fit);
  useLayoutEffect(() => {
    const bar = barRef.current;
    if (!bar || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => fit());
    ro.observe(bar);
    const outer = fitToRef.current?.(bar);
    if (outer) ro.observe(outer.el);
    for (const el of bar.querySelectorAll('[data-fit-key]')) ro.observe(el);
    return () => ro.disconnect();
  });

  // A divider only between two items still on the bar.
  const onBar = items.filter(i => !folded.has(i.key)).filter((i, n, list) => !i.divider
    || (n > 0 && n < list.length - 1 && !list[n - 1].divider && !list[n - 1].grow && !list[n + 1].divider && !list[n + 1].grow));
  const inMenu = items.filter(i => folded.has(i.key) && i.menu !== 'never' && !i.divider);
  const iconSize = size;
  const keep = keepFocus ? { onMouseDown: (e: React.MouseEvent) => e.preventDefault() } : {};

  const barNode = (i: FitToolbarItem) => i.divider
    ? <span aria-hidden style={{ width: 1, height: 18, margin: '0 4px', background: tk.border.subtle }} />
    : i.node ?? (
    <IconButton icon={i.icon ?? 'more'} label={i.hint ? `${i.label}: ${i.hint}` : i.label} shortcut={i.shortcut} size={iconSize}
      active={i.active} disabled={i.disabled} tone={i.danger ? 'danger' : 'default'} onClick={i.onSelect} {...keep} />
  );

  const mask = fade.left || fade.right
    ? `linear-gradient(to right, ${fade.left ? 'transparent 0, #000 24px' : '#000 0'}, ${fade.right ? '#000 calc(100% - 24px), transparent 100%' : '#000 100%'})`
    : undefined;

  const row: CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 10, minHeight: 32, padding: '3px 10px', borderRadius: radius.md, textAlign: 'left', width: '100%', boxSizing: 'border-box',
  };
  let lastGroup: string | undefined;

  return (
    <div
      ref={barRef}
      role="toolbar"
      aria-label={ariaLabel}
      data-fit-toolbar=""
      data-fit-folded={inMenu.length || undefined}
      onScroll={fit}
      style={{
        flex: fitTo ? '0 1 auto' : '1 1 0', minWidth: 0, display: 'flex', alignItems: 'center', gap, overflowX: 'auto', overflowY: 'hidden', scrollbarWidth: 'none',
        WebkitMaskImage: mask, maskImage: mask, ...style,
      }}
    >
      {alignEnd && <span aria-hidden style={{ flex: '1 0 0' }} />}
      {onBar.map(i => i.grow
        ? <span key={i.key} aria-hidden data-fit-grow="" style={{ flex: '1 0 0', minWidth: 0 }} />
        : <span key={i.key} data-fit-key={i.key} style={{ display: 'inline-flex', alignItems: 'center', flexShrink: 0 }}>{barNode(i)}</span>)}
      {inMenu.length > 0 && (
        <span ref={moreRef} data-fit-more="" style={{ display: 'inline-flex', flexShrink: 0 }}>
          <IconButton icon="more" size={iconSize} label={`${moreLabel}: ${inMenu.map(i => i.label).join(', ')}`} active={open}
            aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(o => !o)} {...keep} />
        </span>
      )}
      {open && inMenu.length > 0 && (
        <Popover anchorRef={moreRef} onClose={() => setOpen(false)} align="end" width={menuWidth} padding={6}>
          <div role="menu" aria-label={moreLabel} data-fit-menu="" style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            {inMenu.map(i => {
              const heading = i.group && i.group !== lastGroup ? i.group : null;
              const sep = !heading && lastGroup !== undefined && i.group !== lastGroup;
              lastGroup = i.group;
              const head = heading ? (
                <div style={{ padding: '8px 10px 3px', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: tk.text.faint }}>{heading}</div>
              ) : sep ? <div style={{ height: 1, margin: '4px 6px', background: tk.border.subtle }} /> : null;
              const text = (
                <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                  <span style={{ font: `500 12.5px ${fontFamily.ui}`, color: i.danger ? tk.status.danger : i.active ? tk.accent.text : tk.text.primary }}>{i.label}</span>
                  {i.hint && <span style={{ fontSize: 11, lineHeight: 1.35, color: tk.text.faint }}>{i.hint}</span>}
                </span>
              );
              const body = i.onSelect ? (
                <button type="button" role="menuitem" disabled={i.disabled} data-fit-row={i.key} aria-pressed={i.active || undefined}
                  onClick={() => { setOpen(false); i.onSelect!(); }} {...keep}
                  style={{ ...row, border: 0, cursor: i.disabled ? 'default' : 'pointer', opacity: i.disabled ? 0.45 : 1, background: i.active ? tk.bg.selected : 'transparent', color: tk.text.primary }}
                  onMouseEnter={e => { if (!i.active) e.currentTarget.style.background = tk.bg.hover; }}
                  onMouseLeave={e => { e.currentTarget.style.background = i.active ? tk.bg.selected : 'transparent'; }}>
                  {i.icon && <Icon name={i.icon} size={15} style={{ flexShrink: 0, color: i.active ? tk.accent.base : tk.text.muted }} />}
                  {text}
                  {i.shortcut && <span style={{ font: `500 11px ${fontFamily.mono}`, color: tk.text.faint }}>{i.shortcut}</span>}
                </button>
              ) : (
                <div data-fit-row={i.key} style={row}>
                  {text}
                  <span style={{ display: 'inline-flex', alignItems: 'center', flexShrink: 0 }}>{i.menuNode ?? i.node ?? barNode(i)}</span>
                </div>
              );
              return <Fragment key={i.key}>{head}{body}</Fragment>;
            })}
          </div>
        </Popover>
      )}
    </div>
  );
}

