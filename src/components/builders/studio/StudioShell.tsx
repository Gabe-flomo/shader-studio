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
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTokens } from '../../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../../theme/tokens';
import { IconButton, Button } from '../../ui/Button';
import { Icon } from '../../ui/Icon';
import type { IconName } from '../../ui/iconPaths';
import { Segmented } from '../../ui/Choice';
import { portalGuard } from '../../ui/portalGuard';
import { usePhoneDialog } from '../../ui/phoneDialog';
import { SidePanel, useNarrowWindow } from '../../code/SidePanels';

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
  /** Add to graph, or Done. */
  primary?: { label: string; onClick: () => void; title?: string };
  /** Left panel (kinds and sections), right panel (the selected section's settings), bottom strip. */
  nav?: ReactNode;
  inspector?: ReactNode;
  presets?: ReactNode;
  navWidth?: number;
  inspectorWidth?: number;
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
        {/* Top bar: Back · name · kind ……… panels · 2D | 3D · actions · primary · close */}
        <div data-studio-topbar style={{ height: 60, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8, padding: '0 12px', borderBottom: `1px solid ${tk.border.subtle}`, minWidth: 0 }}>
          {p.onBack && <IconButton icon="chevL" label={p.backLabel ?? 'Back'} onClick={p.onBack} data-studio-back />}
          <span style={{ width: 32, height: 32, borderRadius: 10, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: alpha(tile, 0.12), color: tile, marginLeft: p.onBack ? 0 : 4 }}>
            <Icon name={p.icon} />
          </span>
          <span style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0, marginRight: 'auto' }}>
            <b data-studio-title style={{ fontSize: 15, fontWeight: 650, letterSpacing: '-0.01em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.title}</b>
            {p.kind && <span data-studio-kind style={{ fontSize: 12, color: tk.text.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.kind}</span>}
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, overflowX: phone ? 'auto' : undefined, scrollbarWidth: 'none' }}>
            {p.nav !== undefined && foldButton('nav', 'panelLeft', 'the sections', sc('['))}
            {p.presets !== undefined && foldButton('presets', 'panelBottom', 'the presets')}
            {p.inspector !== undefined && foldButton('inspector', 'panelRight', 'the settings', sc(']'))}
            {p.space && (
              <span data-studio-space={p.space.value} title={p.space.hint} style={{ marginLeft: 4 }}>
                <Segmented size="sm" ariaLabel="2D or 3D" value={p.space.value} onChange={v => p.space!.onChange(v)}
                  options={[{ value: '2d' as const, label: '2D' }, { value: '3d' as const, label: '3D' }]} />
              </span>
            )}
            {p.actions}
            {p.primary && <Button variant="primary" size="sm" data-studio-primary title={p.primary.title} onClick={p.primary.onClick}>{p.primary.label}</Button>}
          </span>
          <IconButton icon="close" label="Close" shortcut="esc" onClick={p.onClose} />
        </div>
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
      </div>
    </div>,
    document.body,
  );
}

/** A small caps label for a panel's group ("Sections", "Presets"). */
export function StudioLabel({ children, meta }: { children: ReactNode; meta?: ReactNode }) {
  const tk = useTokens();
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
  return (
    <button type="button" data-studio-section={id} aria-current={selected || undefined} title={hint} onClick={onClick}
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
        {summary && <span data-studio-summary style={{ fontSize: 11.5, color: tk.text.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{summary}</span>}
      </span>
    </button>
  );
}

/** A picture card in the presets strip: a thumbnail (or a placeholder while it renders) and a name. */
export function PresetCard({ id, label, hint, src, onClick, active = false }: { id: string; label: string; hint?: string; src?: string | null; onClick: () => void; active?: boolean }) {
  const tk = useTokens();
  const [hover, setHover] = useState(false);
  return (
    <button type="button" data-preset={id} title={hint} onClick={onClick} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
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
      <span style={{ padding: '0 2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: active ? tk.accent.text : undefined }}>{label}</span>
    </button>
  );
}
