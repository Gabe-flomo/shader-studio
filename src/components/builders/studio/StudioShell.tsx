/**
 * StudioShell — the shared builder layout (docs/agent-builder-redesign-plan.md §1), built once
 * and filled by each builder:
 *
 *   ┌ Back · name · kind ──────────────── 2D │ 3D ─ Add to graph ┐
 *   │ nav (kinds,  │       viewport (live)        │ inspector     │
 *   │  sections)   │                              │               │
 *   ├──────────────┴──────────────────────────────┴───────────────┤
 *   │ presets strip                                                │
 *   └──────────────────────────────────────────────────────────────┘
 *
 * The viewport is always there; the side panels and the presets strip fold (header toggles,
 * ⌘[ / ⌘], remembered per builder). Under 1100 px the side panels are drawers over the viewport
 * that start closed (code/SidePanels.tsx); on a phone the window fills the screen. The window is
 * the Modal's: scrim, 16 px corners, a 60 px header, Esc closes it when it is on top.
 *
 * On a phone (PhoneStudio.tsx) there are no side panels: the viewport fills the top, and the
 * bottom bar is a row of tabs (the presets first, then the sections the nav lists), with the
 * selected section's settings in a sheet over it. The sections come from the nav's StudioNavItems,
 * which register themselves here instead of drawing (NavRegistry), so a builder doesn't list them twice.
 */
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTokens } from '../../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../../theme/tokens';
import { IconButton, Button } from '../../ui/Button';
import { Icon } from '../../ui/Icon';
import type { IconName } from '../../ui/iconPaths';
import { Segmented } from '../../ui/Choice';
import { portalGuard } from '../../ui/portalGuard';
import { Tooltip } from '../../ui/Tooltip';
import { clampLines, tileName } from '../../ui/textFit';
import { usePhoneDialog } from '../../ui/phoneDialog';
import { SidePanel, useNarrowWindow } from '../../code/SidePanels';
import { BUILDER_RECIPE_EVENT } from '../../../builders/windows';
import { PhoneStudio, type PhonePanel, type PhoneSection } from './PhoneStudio';

// ── The phone's section tabs: the nav's items, registered rather than drawn ──

interface NavEntry extends PhoneSection { selected: boolean; click: () => void }
interface NavRegistry { put: (e: NavEntry) => void; drop: (id: string) => void }
const NavRegistryContext = createContext<NavRegistry | null>(null);

/** The registered nav items in the nav's own order, and the selected one. */
function usePhoneNav(root: React.RefObject<HTMLElement | null>) {
  const entries = useRef(new Map<string, NavEntry>());
  const [list, setList] = useState<{ sections: PhoneSection[]; current: string | null }>({ sections: [], current: null });
  const sync = useCallback(() => {
    const order = root.current ? Array.from(root.current.querySelectorAll('[data-studio-nav-slot]')).map(el => el.getAttribute('data-studio-nav-slot')) : [];
    const at = (id: string) => { const i = order.indexOf(id); return i < 0 ? order.length : i; };
    const all = [...entries.current.values()].sort((a, b) => at(a.id) - at(b.id));
    const next = { sections: all.map(({ id, label, icon, hint, dim }) => ({ id, label, icon, hint, dim })), current: all.find(e => e.selected)?.id ?? null };
    setList(prev => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
  }, [root]);
  const registry = useMemo<NavRegistry>(() => ({
    put: e => { entries.current.set(e.id, e); sync(); },
    drop: id => { entries.current.delete(id); sync(); },
  }), [sync]);
  const select = useCallback((id: string) => entries.current.get(id)?.click(), []);
  return { registry, ...list, select };
}

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

type Fold = 'nav' | 'inspector' | 'presets';

function readPref(key: string, fallback: boolean): boolean {
  try { const v = localStorage.getItem(key); return v === null ? fallback : v === '1'; } catch { return fallback; }
}
function writePref(key: string, v: boolean) {
  try { localStorage.setItem(key, v ? '1' : '0'); } catch { /* kept for this session only */ }
}

export interface StudioShellProps {
  /** Names the remembered panel choices (`builder:<prefsKey>:studio:nav`…). */
  prefsKey: string;
  icon: IconName;
  iconColor?: string;
  /** The thing being built ("Slime mold"). */
  title: ReactNode;
  /** Its kind ("Trail followers · 2D"). */
  kind?: ReactNode;
  /** A small line over the title: where this is ("Scene builder › Agent scene", components/builders/SceneCrumb.tsx). */
  crumb?: ReactNode;
  onClose: () => void;
  /** Esc first asks this (a focus view leaves on Esc): true means it was handled and the builder stays open. */
  onEscape?: () => boolean;
  /** Back (left of the name): the start page, or wherever the builder came from. */
  onBack?: () => void;
  backLabel?: string;
  /** The 2D | 3D switch. */
  space?: { value: '2d' | '3d'; onChange: (v: '2d' | '3d') => void; hint?: string };
  /** Other buttons in the top bar, before the primary one. */
  actions?: ReactNode;
  /** Surprise me: first in the top bar's actions; on a phone, over the presets in the Presets tab. */
  surprise?: ReactNode;
  /** Add to graph, or Done. */
  primary?: { label: string; onClick: () => void; title?: string };
  /** Left panel (kinds and sections), right panel (the selected section's settings), bottom strip. */
  nav?: ReactNode;
  inspector?: ReactNode;
  presets?: ReactNode;
  navWidth?: number;
  inspectorWidth?: number;
  /** On a phone: the nav itself as a tab of the bottom bar (its items still become the section tabs), for a nav with more than sections in it. */
  phoneNav?: { label: string; icon: IconName };
  /** On a phone: more panels, each a tab before the sections (the 2D builder's layers). */
  phonePanels?: PhonePanel[];
  /** On a phone: the sheet's title when no section is selected ("Under the hood"). */
  phoneSettingsTitle?: string;
  /** The centre: the live viewport (or the start page). */
  children: ReactNode;
}

export function StudioShell(p: StudioShellProps) {
  const tk = useTokens();
  const phone = usePhoneDialog();
  const narrow = useNarrowWindow() || phone;
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(p.onClose);
  const onEscapeRef = useRef(p.onEscape);
  useEffect(() => { onCloseRef.current = p.onClose; onEscapeRef.current = p.onEscape; });
  const key = (f: Fold) => `builder:${p.prefsKey}:studio:${f}`;
  const [wide, setWide] = useState<Record<Fold, boolean>>(() => ({ nav: readPref(key('nav'), true), inspector: readPref(key('inspector'), true), presets: readPref(key('presets'), true) }));
  const [drawers, setDrawers] = useState({ nav: false, inspector: false });
  const open: Record<Fold, boolean> = narrow ? { ...drawers, presets: wide.presets } : wide;
  const set = (f: Fold, v: boolean) => {
    if (narrow && f !== 'presets') setDrawers(d => (v ? { nav: false, inspector: false, [f]: true } : { ...d, [f]: false }));
    else { setWide(w => ({ ...w, [f]: v })); writePref(key(f), v); }
  };
  const toggle = useRef<(f: Fold) => void>(() => {});
  useEffect(() => { toggle.current = f => set(f, !open[f]); });
  // ⌘⇧D (builders/windows.ts requestBuilderRecipe): the recipe shows in the inspector, so unfold it.
  const showInspector = useRef<() => void>(() => {});
  const [recipeAsks, setRecipeAsks] = useState(0);
  useEffect(() => { showInspector.current = () => { if (phone) setRecipeAsks(n => n + 1); else if (!open.inspector) set('inspector', true); }; });
  const navRoot = useRef<HTMLDivElement>(null);
  const phoneNav = usePhoneNav(navRoot);
  useEffect(() => {
    const on = () => showInspector.current();
    window.addEventListener(BUILDER_RECIPE_EVENT, on);
    return () => window.removeEventListener(BUILDER_RECIPE_EVENT, on);
  }, []);

  useEffect(() => {
    if (!panelRef.current?.contains(document.activeElement)) panelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Only the top dialog closes (a picker or a confirm opened over the builder handles its own Esc).
        const dialogs = document.querySelectorAll('[aria-modal="true"]');
        if (dialogs[dialogs.length - 1] !== panelRef.current || (e.target as HTMLElement | null)?.closest?.('[data-captures-escape]')) return;
        e.stopPropagation();
        if (onEscapeRef.current?.()) return;
        onCloseRef.current();
        return;
      }
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey || (e.key !== '[' && e.key !== ']')) return;
      e.preventDefault();
      e.stopPropagation();
      toggle.current(e.key === '[' ? 'nav' : 'inspector');
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  const sc = (k: string) => `${IS_MAC ? '⌘' : 'Ctrl+'}${k}`;
  const foldButton = (f: Fold, icon: IconName, label: string, shortcut?: string) => (
    <IconButton icon={icon} label={`${open[f] ? 'Hide' : 'Show'} ${label}`} shortcut={shortcut} size="sm" active={open[f]}
      data-studio-toggle={f} onClick={() => toggle.current(f)} />
  );
  const tile = p.iconColor ?? tk.accent.base;
  const side = (f: 'nav' | 'inspector', content: ReactNode, width: number, label: string) => (
    <SidePanel side={f === 'nav' ? 'left' : 'right'} label={label} open={open[f]} narrow={narrow} width={width} onClose={() => set(f, false)}>
      <div data-studio-panel={f} data-studio-drawer={narrow || undefined} style={{
        width, maxWidth: '100%', flexShrink: 0, overflowY: 'auto', boxSizing: 'border-box', display: 'flex', flexDirection: 'column',
        background: tk.bg.subtle, [f === 'nav' ? 'borderRight' : 'borderLeft']: `1px solid ${tk.border.subtle}`,
      }}>{content}</div>
    </SidePanel>
  );

  // Top bar: Back · name · kind ……… panels · 2D | 3D · actions · primary · close
  // The builder's main action (Done, Add to graph).
  const primary = p.primary ? <Button variant="primary" size="sm" data-studio-primary title={p.primary.title} onClick={p.primary.onClick}>{p.primary.label}</Button> : null;
  const topBar = (
    <div data-studio-topbar style={{ minHeight: phone ? 52 : 60, flexShrink: 0, display: 'flex', alignItems: 'center', gap: phone ? 4 : 8, padding: phone ? '0 6px' : '0 12px', borderBottom: `1px solid ${tk.border.subtle}`, minWidth: 0 }}>
      {p.onBack && <IconButton icon="chevL" label={p.backLabel ?? 'Back'} onClick={p.onBack} data-studio-back />}
      {!phone && (
        <span style={{ width: 32, height: 32, borderRadius: 10, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: alpha(tile, 0.12), color: tile, marginLeft: p.onBack ? 0 : 4 }}>
          <Icon name={p.icon} />
        </span>
      )}
      <span style={{ display: 'flex', flexDirection: 'column', gap: p.crumb ? 0 : 1, minWidth: phone ? 96 : 0, flexShrink: 1, maxWidth: phone ? '55%' : undefined, marginRight: 'auto', paddingLeft: phone && !p.onBack ? 6 : 0 }}>
        {p.crumb && <span data-studio-crumb style={{ fontSize: 11, lineHeight: '14px', color: tk.text.muted, display: 'flex', minWidth: 0, overflow: phone ? 'hidden' : undefined }}>{p.crumb}</span>}
        <b data-studio-title title={typeof p.title === 'string' ? p.title : undefined} style={{ fontSize: 15, fontWeight: 650, letterSpacing: '-0.01em', lineHeight: 1.2, ...clampLines(2) }}>{p.title}</b>
        {p.kind && !(phone && p.crumb) && <span data-studio-kind style={{ fontSize: 12, color: tk.text.muted, lineHeight: 1.25 }}>{p.kind}</span>}
      </span>
      {/* On a phone the title gives way first (down to 96px), then the actions slide sideways. */}
      <span style={{ display: 'flex', alignItems: 'center', gap: phone ? 2 : 6, minWidth: 0, overflowX: phone ? 'auto' : undefined, scrollbarWidth: 'none', ...(phone ? { flexShrink: 0.2 } : null) }}>
        {!phone && p.nav !== undefined && foldButton('nav', 'panelLeft', 'the sections', sc('['))}
        {!phone && p.presets !== undefined && foldButton('presets', 'panelBottom', 'the presets')}
        {!phone && p.inspector !== undefined && foldButton('inspector', 'panelRight', 'the settings', sc(']'))}
        {p.space && (
          <span data-studio-space={p.space.value} title={p.space.hint} style={{ marginLeft: 4 }}>
            <Segmented size="sm" ariaLabel="2D or 3D" value={p.space.value} onChange={v => p.space!.onChange(v)}
              options={[{ value: '2d' as const, label: '2D' }, { value: '3d' as const, label: '3D' }]} />
          </span>
        )}
        {!phone && p.surprise}
        {p.actions}
        {!phone && primary}
      </span>
      {/* On a phone the actions above scroll sideways when they don't fit; Done stays in view beside them. */}
      {phone && primary && <span style={{ flexShrink: 0, display: 'flex' }}>{primary}</span>}
      <IconButton icon="close" label="Close" shortcut="esc" onClick={p.onClose} />
    </div>
  );

  // On a phone the nav is never drawn as a panel: its items register as the bottom bar's tabs.
  const navTree = phone && p.nav !== undefined ? (
    <NavRegistryContext.Provider value={phoneNav.registry}>
      <div ref={navRoot} data-studio-panel="nav" style={{ display: 'flex', flexDirection: 'column' }}>{p.nav}</div>
    </NavRegistryContext.Provider>
  ) : null;

  return createPortal(
    <div {...portalGuard} onPointerDown={e => e.stopPropagation()}
      style={{ position: 'fixed', inset: 0, zIndex: 2000, background: tk.bg.scrim, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: phone ? 0 : 16 }}>
      <div ref={panelRef} role="dialog" aria-modal="true" aria-label={typeof p.title === 'string' ? p.title : 'Builder'} tabIndex={-1} data-studio={p.prefsKey}
        style={{
          width: phone ? '100%' : 1440, maxWidth: '100%', height: phone ? '100%' : 900, maxHeight: '100%',
          display: 'flex', flexDirection: 'column', overflow: 'hidden', boxSizing: 'border-box', outline: 'none',
          background: tk.bg.panel, color: tk.text.primary, borderRadius: phone ? 0 : radius.modal, boxShadow: tk.shadow.modal,
          paddingTop: phone ? 'env(safe-area-inset-top, 0px)' : undefined, paddingBottom: phone ? 'env(safe-area-inset-bottom, 0px)' : undefined,
          font: `12.5px ${fontFamily.ui}`,
        }}>
        {phone ? (
          <PhoneStudio prefsKey={p.prefsKey} top={topBar} sections={phoneNav.sections} current={phoneNav.current}
            presets={p.presets !== undefined || p.surprise ? <>{p.surprise && <div data-phone-surprise style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>{p.surprise}</div>}{p.presets}</> : undefined}
            onSection={phoneNav.select} settings={p.inspector} settingsTitle={p.phoneSettingsTitle}
            settingsSignal={phoneNav.sections.length ? `${phoneNav.current}|${recipeAsks}` : undefined}
            panels={[...(p.phoneNav && navTree ? [{ id: '__nav', label: p.phoneNav.label, icon: p.phoneNav.icon, content: navTree }] : []), ...(p.phonePanels ?? [])]}>
            {!p.phoneNav && navTree && <div hidden style={{ display: 'none' }}>{navTree}</div>}
            {p.children}
          </PhoneStudio>
        ) : <>
          {topBar}
          <div style={{ display: 'flex', flex: 1, minHeight: 0, position: 'relative' }}>
            {p.nav !== undefined && side('nav', p.nav, p.navWidth ?? 216, 'Sections')}
            <div data-studio-viewport style={{ flex: 1, minWidth: 0, minHeight: 0, position: 'relative', display: 'flex', flexDirection: 'column' }}>{p.children}</div>
            {p.inspector !== undefined && side('inspector', p.inspector, p.inspectorWidth ?? 344, 'Settings')}
          </div>
          {p.presets !== undefined && open.presets && (
            <div data-studio-panel="presets" style={{ flexShrink: 0, borderTop: `1px solid ${tk.border.subtle}`, background: tk.bg.subtle, padding: '10px 12px 12px', overflowX: 'auto' }}>
              {p.presets}
            </div>
          )}
        </>}
      </div>
    </div>,
    document.body,
  );
}

/**
 * A small caps label for a panel's group ("Sections", "Presets"). `sections`: it heads a list of
 * StudioNavItems only, so on a phone (where they are the bottom bar's tabs) it isn't drawn.
 */
export function StudioLabel({ children, meta, sections = false }: { children: ReactNode; meta?: ReactNode; sections?: boolean }) {
  const tk = useTokens();
  const onPhone = useContext(NavRegistryContext) !== null;
  if (sections && onPhone) return null;
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 10.5, fontWeight: 700, letterSpacing: '0.08em', color: tk.text.faint, textTransform: 'uppercase' }}>
      <span style={{ flex: 1 }}>{children}</span>
      {meta && <span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 500, fontSize: 11.5 }}>{meta}</span>}
    </span>
  );
}

/** One row of the left nav: an icon, a plain name, a one-line summary; selected when it is the inspector's. */
export function StudioNavItem({ icon, label, summary, selected, onClick, hint, dim = false, id }: {
  icon: IconName; label: string; summary?: string; selected: boolean; onClick: () => void; hint?: string; dim?: boolean; id: string;
}) {
  const tk = useTokens();
  const [hover, setHover] = useState(false);
  // On a phone the item is a tab of the bottom bar (PhoneStudio): it registers there and draws nothing here.
  const reg = useContext(NavRegistryContext);
  const click = useRef(onClick);
  useLayoutEffect(() => {
    click.current = onClick;
    reg?.put({ id, label, icon, hint, dim, selected, click: () => click.current() });
  });
  useLayoutEffect(() => () => reg?.drop(id), [reg, id]);
  if (reg) return <span hidden data-studio-nav-slot={id} />;
  const item = (
    <button type="button" data-studio-section={id} aria-current={selected || undefined} onClick={onClick}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 10, width: '100%', minHeight: 44, padding: '6px 10px', border: 0, borderRadius: radius.control, cursor: 'pointer', textAlign: 'left',
        background: selected ? tk.bg.selected : hover ? tk.bg.hover : 'none', boxShadow: selected ? `inset 0 0 0 1px ${alpha(tk.accent.base, 0.35)}` : 'none',
        color: tk.text.primary, opacity: dim ? 0.55 : 1, font: `12.5px ${fontFamily.ui}`,
      }}>
      <span style={{ width: 26, height: 26, borderRadius: 8, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: selected ? alpha(tk.accent.base, 0.14) : tk.bg.field, color: selected ? tk.accent.base : tk.text.muted }}>
        <Icon name={icon} size={14} />
      </span>
      <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0, gap: 1 }}>
        <span style={{ fontWeight: 600 }}>{label}</span>
        {summary && <span data-studio-summary style={{ fontSize: 11.5, color: tk.text.muted, fontVariantNumeric: 'tabular-nums', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{summary}</span>}
      </span>
    </button>
  );
  return hint ? <Tooltip label={label} description={hint} placement="right" block>{item}</Tooltip> : item;
}

/** A picture card in the presets strip: a thumbnail (or a placeholder while it renders) and a name. */
export function PresetCard({ id, label, hint, src, onClick, active = false }: { id: string; label: string; hint?: string; src?: string | null; onClick: () => void; active?: boolean }) {
  const tk = useTokens();
  const [hover, setHover] = useState(false);
  const card = (
    <button type="button" data-preset={id} onClick={onClick} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{
        flexShrink: 0, width: 132, padding: 0, border: 0, borderRadius: radius.control, cursor: 'pointer', textAlign: 'left', background: 'none',
        display: 'flex', flexDirection: 'column', gap: 6, color: tk.text.secondary, font: `500 12px ${fontFamily.ui}`,
      }}>
      <span style={{
        width: 132, height: 76, borderRadius: radius.md, overflow: 'hidden', background: tk.bg.render, display: 'block',
        boxShadow: active ? `0 0 0 2px ${tk.accent.base}` : hover ? `0 0 0 1px ${tk.border.strong}` : `0 0 0 1px ${tk.border.default}`,
      }}>
        {src ? <img src={src} alt="" draggable={false} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} /> : null}
      </span>
      <span data-preset-name title={label} style={{ padding: '0 2px', ...tileName, color: active ? tk.accent.text : undefined }}>{label}</span>
    </button>
  );
  return hint ? <Tooltip label={label} description={hint} placement="top">{card}</Tooltip> : card;
}
