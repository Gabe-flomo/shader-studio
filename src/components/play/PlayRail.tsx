/**
 * PlayRail — the split view's sidebar folded into a rail of icons, one per
 * category (railPages.ts). Clicking an icon opens a small drawer beside the
 * rail with that category's pages (name, one line, count); picking one shows
 * it full width in the big panel. A category with a single page opens it
 * straight away. Clicking the open category's icon again closes its drawer;
 * Esc or a click elsewhere does too; arrows and Enter move and pick.
 *
 * Phones get the same categories as a bottom row (PlayRailBar) whose drawer
 * is a sheet.
 */
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { useCan } from '../../lib/plan';
import { Icon } from '../ui/Icon';
import { Popover } from '../ui/Popover';
import { Sheet } from '../ui/Sheet';
import { Tooltip } from '../ui/Tooltip';
import { RAIL_PX, usePlaySplit } from './playSplit';
import { usePlayUi } from './playUi';
import { RAIL_CATEGORIES, RAIL_PAGES, categoryBadge, categoryOf, pageCount, phonePageShown, stepIndex, type RailCategory, type RailCategoryDef, type RailPage } from './railPages';

/** Categories that need Pro, and the plan feature that unlocks each. */
function useLocked(): (cat: RailCategory) => boolean {
  const layers = useCan('play.layers'), finish = useCan('play.finish'), engine = useCan('audio.engine');
  return cat => (cat === 'layers' && !layers) || (cat === 'finish' && !finish) || (cat === 'engine' && !engine);
}

/** The rail on the big panel's left edge (desktop and tablet split view). */
export function PlayRail() {
  const tk = useTokens();
  const play = useNodeGraphStore(s => s.play);
  const page = usePlaySplit(s => s.railPage);
  const setPage = usePlaySplit(s => s.setRailPage);
  const locked = useLocked();
  const railRef = useRef<HTMLDivElement>(null);
  const buttons = useRef<Partial<Record<RailCategory, HTMLButtonElement | null>>>({});
  const [open, setOpen] = useState<RailCategory | null>(null);
  const active = categoryOf(page);

  const pressIcon = (c: RailCategoryDef) => {
    if (c.pages.length === 1) { setPage(c.pages[0]); setOpen(null); return; }
    setOpen(o => (o === c.id ? null : c.id));
  };
  // Up and down move between the rail's icons.
  const onRailKey = (e: ReactKeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const i = RAIL_CATEGORIES.findIndex(c => buttons.current[c.id] === document.activeElement);
    if (i < 0) return;
    e.preventDefault();
    buttons.current[RAIL_CATEGORIES[stepIndex(i, e.key, RAIL_CATEGORIES.length)].id]?.focus();
  };
  const openDef = open ? RAIL_CATEGORIES.find(c => c.id === open) : undefined;
  const anchor = useRef<HTMLElement | null>(null);
  anchor.current = open ? buttons.current[open] ?? null : null;

  return (
    <nav
      ref={railRef}
      data-play-rail=""
      aria-label="Play sections"
      onKeyDown={onRailKey}
      style={{
        width: RAIL_PX, flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, padding: '8px 0',
        background: tk.bg.panel, borderRight: `1px solid ${tk.border.default}`, overflowY: 'auto', boxSizing: 'border-box',
      }}
    >
      {RAIL_CATEGORIES.map(c => (
        <RailButton
          key={c.id}
          def={c}
          refFn={el => { buttons.current[c.id] = el; }}
          active={active === c.id}
          open={open === c.id}
          badge={categoryBadge(c.id, play)}
          locked={locked(c.id)}
          onPress={() => pressIcon(c)}
        />
      ))}
      {openDef && (
        <Popover anchorRef={anchor} clearRef={railRef} onClose={() => setOpen(null)} width={288} padding={6}>
          <RailPageList def={openDef} current={page} play={play} autoFocus onPick={p => { setPage(p); setOpen(null); }} />
        </Popover>
      )}
    </nav>
  );
}

function RailButton({ def, refFn, active, open, badge, locked, onPress, phone = false }: {
  def: RailCategoryDef;
  refFn?: (el: HTMLButtonElement | null) => void;
  active: boolean;
  open: boolean;
  badge?: number;
  locked: boolean;
  onPress: () => void;
  /** The phone's bottom row: a label under the icon, no tooltip. */
  phone?: boolean;
}) {
  const tk = useTokens();
  const [hover, setHover] = useState(false);
  const lit = active || open;
  const button = (
    <button
      ref={refFn}
      type="button"
      data-rail-category={def.id}
      aria-label={`${def.label}${locked ? ' (Pro)' : ''}`}
      aria-current={active ? 'page' : undefined}
      aria-expanded={def.pages.length > 1 ? open : undefined}
      aria-haspopup={def.pages.length > 1 ? 'menu' : undefined}
      onClick={onPress}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        position: 'relative', border: 0, cursor: 'pointer', padding: 0, flexShrink: 0,
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3,
        ...(phone ? { flex: 1, minWidth: 0, height: 52, borderRadius: radius.md } : { width: 44, height: 44, borderRadius: radius.control }),
        background: lit ? tk.bg.selected : hover ? tk.bg.hover : 'transparent',
        color: lit ? tk.accent.base : hover ? tk.text.secondary : tk.text.muted,
        opacity: locked && !lit ? 0.7 : 1, transition: 'background 0.12s, color 0.12s',
      }}
    >
      {/* The open category: a bar on the rail's edge (phones: along the top). */}
      {active && <span aria-hidden style={{ position: 'absolute', background: tk.accent.base, borderRadius: 2, ...(phone ? { top: 0, left: '30%', right: '30%', height: 2 } : { left: -8, top: 10, bottom: 10, width: 3 }) }} />}
      <Icon name={def.icon} size={phone ? 18 : 19} />
      {phone && <span style={{ font: `600 10px ${fontFamily.ui}`, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%' }}>{def.label}</span>}
      {badge !== undefined && (
        <span aria-hidden style={{
          position: 'absolute', top: phone ? 4 : 3, ...(phone ? { left: 'calc(50% + 6px)' } : { right: 2 }), minWidth: 16, height: 15, padding: '0 4px', boxSizing: 'border-box',
          borderRadius: 8, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          background: lit ? tk.accent.base : tk.bg.field, color: lit ? '#fff' : tk.text.secondary,
          boxShadow: `0 0 0 2px ${tk.bg.panel}`, font: `600 9.5px ${fontFamily.mono}`,
        }}>{badge > 99 ? '99+' : badge}</span>
      )}
      {locked && <span aria-hidden style={{ position: 'absolute', bottom: phone ? 20 : 4, right: phone ? 'calc(50% - 16px)' : 4, color: tk.text.faint, display: 'inline-flex' }}><Icon name="lock" size={9} /></span>}
    </button>
  );
  if (phone) return button;
  return (
    <Tooltip placement="right" label={`${def.label}${locked ? ' · Pro' : ''}`} description={def.description}>
      {button}
    </Tooltip>
  );
}

/** A category's pages: name, one line and count. Arrows move, Enter picks. */
export function RailPageList({ def, current, play, onPick, autoFocus = false, touch = false }: {
  def: RailCategoryDef;
  current: RailPage;
  play: Parameters<typeof pageCount>[1];
  onPick: (page: RailPage) => void;
  autoFocus?: boolean;
  touch?: boolean;
}) {
  const tk = useTokens();
  const items = useRef<Array<HTMLButtonElement | null>>([]);
  useEffect(() => {
    if (!autoFocus) return;
    const i = Math.max(0, def.pages.indexOf(current));
    items.current[i]?.focus();
  }, [autoFocus, def, current]);
  const onKey = (e: ReactKeyboardEvent) => {
    const i = items.current.findIndex(el => el === document.activeElement);
    const next = stepIndex(i < 0 ? 0 : i, e.key, def.pages.length);
    if (next === i || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    items.current[next]?.focus();
  };
  return (
    <div role="menu" aria-label={`${def.label} pages`} onKeyDown={onKey} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {!touch && <div style={{ padding: '4px 8px 6px', color: tk.text.faint, font: `600 10px ${fontFamily.ui}`, letterSpacing: '0.05em', textTransform: 'uppercase' }}>{def.label}</div>}
      {def.pages.map((p, i) => {
        const d = RAIL_PAGES[p];
        const n = pageCount(p, play);
        const on = p === current;
        return (
          <button
            key={p}
            ref={el => { items.current[i] = el; }}
            type="button"
            role="menuitem"
            data-rail-page={p}
            aria-current={on ? 'page' : undefined}
            onClick={() => onPick(p)}
            onMouseEnter={e => { if (!on) e.currentTarget.style.background = tk.bg.hover; }}
            onMouseLeave={e => { if (!on) e.currentTarget.style.background = 'transparent'; }}
            onFocus={e => { if (!on) e.currentTarget.style.background = tk.bg.hover; }}
            onBlur={e => { if (!on) e.currentTarget.style.background = 'transparent'; }}
            style={{
              display: 'grid', gridTemplateColumns: '1fr auto', columnGap: 10, rowGap: 1, alignItems: 'baseline', width: '100%',
              padding: touch ? '12px 12px' : '8px 10px', border: 0, borderRadius: radius.md, cursor: 'pointer', textAlign: 'left', outline: 'none',
              background: on ? tk.bg.selected : 'transparent', color: tk.text.primary,
            }}
          >
            <span style={{ font: `600 ${touch ? 14 : 12.5}px ${fontFamily.ui}`, color: on ? tk.accent.text : tk.text.primary }}>{d.label}</span>
            <span style={{ font: `500 11px ${fontFamily.mono}`, color: tk.text.faint }}>{n ? n : ''}</span>
            <span style={{ gridColumn: '1 / -1', font: `${touch ? 12.5 : 11.5}px/1.4 ${fontFamily.ui}`, color: tk.text.muted }}>{d.description}</span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * Phones: the categories as a row along the bottom of the panel. A category
 * with one page opens it; the others open a sheet of their pages.
 */
export function PlayRailBar() {
  const tk = useTokens();
  const play = useNodeGraphStore(s => s.play);
  const tab = usePlayUi(s => s.tab);
  const finishView = usePlayUi(s => s.finishView);
  const picked = usePlayUi(s => s.phonePage);
  const showPage = usePlayUi(s => s.showPage);
  const locked = useLocked();
  const [sheet, setSheet] = useState<RailCategory | null>(null);
  const current = phonePageShown(tab, finishView, picked);
  const sheetDef = sheet ? RAIL_CATEGORIES.find(c => c.id === sheet) : undefined;
  return (
    <nav data-play-railbar="" aria-label="Play sections" style={{ flexShrink: 0, display: 'flex', gap: 2, padding: '2px 6px calc(2px + env(safe-area-inset-bottom, 0px))', background: tk.bg.panel, borderTop: `1px solid ${tk.border.default}`, boxShadow: `0 -1px 0 ${alpha(tk.border.default, 0.4)}` }}>
      {RAIL_CATEGORIES.map(c => (
        <RailButton
          key={c.id}
          phone
          def={c}
          active={tab === c.id}
          open={sheet === c.id}
          badge={categoryBadge(c.id, play)}
          locked={locked(c.id)}
          onPress={() => { if (c.pages.length === 1) showPage(c.pages[0]); else setSheet(c.id); }}
        />
      ))}
      {sheetDef && (
        <Sheet title={sheetDef.label} onClose={() => setSheet(null)}>
          <RailPageList touch def={sheetDef} current={current} play={play} onPick={p => { showPage(p); setSheet(null); }} />
        </Sheet>
      )}
    </nav>
  );
}
