/**
 * PhoneStudio — every builder on a phone (docs/scene-builder.md, "On a phone"). StudioShell draws
 * it in place of its side panels when the screen is a phone, so every kind gets the same layout:
 *
 *   ┌ top bar (StudioShell's) ┐
 *   │                         │
 *   │   viewport (live)       │   as large as the sheet leaves it
 *   │                         │
 *   ├──────── handle ─────────┤   drag to resize the sheet
 *   │ ‹ Presets · Section  ⓘ  │
 *   │ the section's settings  │   scrolls
 *   ├─────────────────────────┤
 *   │ Presets │ Shapes │ Look …│   the bottom bar: one swipeable row of tabs
 *   └─────────────────────────┘
 *
 * The bottom bar holds the presets (with Surprise me) as its first tab, then any panel the builder
 * keeps beside its sections (a drawing grid, a layer list), then the sections. Tapping a section
 * selects it in the builder and turns the sheet into its settings; ‹ Presets (or the Presets tab)
 * goes back. Everything stays mounted while hidden, so a half-typed field keeps its text.
 *
 * Touch: tabs and buttons in the shell are at least 40 px (a scoped style), and a section's help is
 * a tap on ⓘ rather than a hover.
 */
import { createContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useTokens } from '../../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../../theme/tokens';
import { Icon } from '../../ui/Icon';
import type { IconName } from '../../ui/iconPaths';

/** True inside a PhoneStudio: builder sliders take their touch size (BuilderSlider). */
export const PhoneStudioContext = createContext(false);

export const PRESETS_TAB = '__presets';
export const SETTINGS_MODE = '__settings';

export interface PhoneSection {
  id: string;
  label: string;
  icon?: IconName;
  /** The section's one-line help: ⓘ in the sheet's header shows it. */
  hint?: string;
  dim?: boolean;
}

export interface PhonePanel {
  id: string;
  label: string;
  icon: IconName;
  content: ReactNode;
}

export interface PhoneStudioProps {
  prefsKey: string;
  /** The top bar (StudioShell draws its own). */
  top: ReactNode;
  /** The live viewport. */
  children: ReactNode;
  /** The presets strip (and Surprise me): the first tab. */
  presets?: ReactNode;
  presetsLabel?: string;
  /** Panels the builder keeps beside its sections, each a tab of its own (before the sections). */
  panels?: PhonePanel[];
  sections: PhoneSection[];
  /** The selected section (its tab is lit while the sheet shows the settings). */
  current: string | null;
  onSection: (id: string) => void;
  /** The selected section's settings. */
  settings?: ReactNode;
  /** Shown over the settings when no section is selected (Under the hood). */
  settingsTitle?: string;
  /** Any change after the first defined value shows the settings (a section picked in the viewport, ⌘⇧D, Under the hood). */
  settingsSignal?: unknown;
}

const LIMITS = { min: 120, top: 52, tabs: 56, viewport: 140 };

function readHeight(key: string): number | null {
  try { const v = Number(localStorage.getItem(key)); return Number.isFinite(v) && v > 0 ? v : null; } catch { return null; }
}

/** The sheet's height kept between the handle's limits for this screen. Pure. */
export function clampSheet(h: number, screen: number): number {
  const max = Math.max(LIMITS.min, screen - LIMITS.top - LIMITS.tabs - LIMITS.viewport);
  return Math.round(Math.min(max, Math.max(LIMITS.min, h)));
}

export function PhoneStudio(p: PhoneStudioProps) {
  const tk = useTokens();
  const screen = () => (typeof window !== 'undefined' ? window.innerHeight : 800);
  const heightKey = `builder:${p.prefsKey}:phoneSheet`;
  const [mode, setMode] = useState<string>(() => (p.presets !== undefined ? PRESETS_TAB : SETTINGS_MODE));
  const [height, setHeight] = useState(() => clampSheet(readHeight(heightKey) ?? screen() * 0.42, screen()));
  const [help, setHelp] = useState(false);
  const rowRef = useRef<HTMLDivElement>(null);

  // A section picked elsewhere (the viewport, ⌘⇧D, Under the hood) shows its settings.
  const seen = useRef<{ v: unknown } | null>(null);
  useEffect(() => {
    if (p.settingsSignal === undefined) return;
    if (seen.current && seen.current.v !== p.settingsSignal) setMode(SETTINGS_MODE);
    seen.current = { v: p.settingsSignal };
  }, [p.settingsSignal]);

  const active = mode === SETTINGS_MODE ? p.current ?? SETTINGS_MODE : mode;
  useEffect(() => {
    const el = rowRef.current?.querySelector<HTMLElement>(`[data-phone-tab="${active.replace(/"/g, '\\"')}"]`);
    el?.scrollIntoView?.({ inline: 'nearest', block: 'nearest' });
    setHelp(false);
  }, [active]);

  const drag = useRef<{ y: number; h: number } | null>(null);
  const onHandleDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    drag.current = { y: e.clientY, h: height };
  };
  const onHandleMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (d) setHeight(clampSheet(d.h - (e.clientY - d.y), screen()));
  };
  const onHandleUp = () => {
    if (!drag.current) return;
    drag.current = null;
    try { localStorage.setItem(heightKey, String(height)); } catch { /* kept for this session */ }
  };

  const section = p.sections.find(s => s.id === p.current);
  const panel = p.panels?.find(x => x.id === mode);
  const presetsOpen = mode === PRESETS_TAB && p.presets !== undefined;
  const settingsOpen = mode === SETTINGS_MODE;
  const title = panel?.label ?? section?.label ?? p.settingsTitle ?? 'Settings';
  const hint = settingsOpen ? section?.hint : undefined;

  const tab = (id: string, label: string, icon: IconName | undefined, onClick: () => void, dim = false) => {
    const on = active === id;
    return (
      <button key={id} type="button" role="tab" aria-selected={on} data-phone-tab={id} onClick={onClick}
        style={{
          flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 6, minHeight: 40, padding: '0 14px', border: 0, borderRadius: 20, cursor: 'pointer',
          background: on ? tk.bg.selected : 'none', color: on ? tk.accent.text : tk.text.secondary, opacity: dim && !on ? 0.6 : 1,
          boxShadow: on ? `inset 0 0 0 1px ${alpha(tk.accent.base, 0.35)}` : 'none', font: `600 13px ${fontFamily.ui}`, whiteSpace: 'nowrap',
        }}>
        {icon && <Icon name={icon} size={15} />}{label}
      </button>
    );
  };

  const hasSheet = p.presets !== undefined || !!p.panels?.length || p.sections.length > 0;

  return (
    <PhoneStudioContext.Provider value={true}>
      <div data-phone-studio={p.prefsKey} data-phone-mode={presetsOpen ? 'presets' : panel ? `panel:${panel.id}` : 'settings'}
        style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
        <style>{TOUCH_CSS}</style>
        {p.top}
        <div data-studio-viewport style={{ flex: 1, minHeight: LIMITS.viewport / 2, position: 'relative', display: 'flex', flexDirection: 'column', minWidth: 0 }}>{p.children}</div>
        {hasSheet && (
          <div data-phone-sheet style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', borderTop: `1px solid ${tk.border.subtle}`, background: tk.bg.subtle, boxShadow: '0 -8px 24px rgba(0,0,0,0.12)' }}>
            {!presetsOpen && (
              <>
                <div data-phone-handle role="separator" aria-orientation="horizontal" aria-label="Resize the settings" aria-valuenow={height}
                  onPointerDown={onHandleDown} onPointerMove={onHandleMove} onPointerUp={onHandleUp} onPointerCancel={onHandleUp}
                  style={{ height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'ns-resize', touchAction: 'none', flexShrink: 0 }}>
                  <span style={{ width: 40, height: 5, borderRadius: 3, background: tk.border.strong }} />
                </div>
                <div data-phone-sheet-head style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0 8px 4px', minHeight: 40, flexShrink: 0 }}>
                  {p.presets !== undefined && (
                    <button type="button" data-phone-back onClick={() => setMode(PRESETS_TAB)}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 2, minHeight: 40, padding: '0 8px 0 4px', border: 0, borderRadius: radius.md, background: 'none', cursor: 'pointer', color: tk.accent.text, font: `600 13px ${fontFamily.ui}` }}>
                      <Icon name="chevL" size={16} />{p.presetsLabel ?? 'Presets'}
                    </button>
                  )}
                  <b data-phone-sheet-title style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 650, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: p.presets !== undefined ? 'center' : 'left', paddingLeft: p.presets !== undefined ? 0 : 6 }}>{title}</b>
                  {hint ? (
                    <button type="button" data-phone-help aria-pressed={help} aria-label={help ? 'Hide the help' : `What ${title} does`} onClick={() => setHelp(h => !h)}
                      style={{ width: 40, height: 40, border: 0, borderRadius: 20, background: help ? tk.bg.selected : 'none', color: help ? tk.accent.text : tk.text.muted, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Icon name="info" size={16} />
                    </button>
                  ) : p.presets !== undefined ? <span style={{ width: 40 }} /> : null}
                </div>
                {help && hint && <div data-phone-help-text style={{ padding: '0 16px 8px', fontSize: 12.5, lineHeight: 1.45, color: tk.text.secondary }}>{hint}</div>}
              </>
            )}
            {/* All stay mounted; only the one shown has a size. */}
            {p.presets !== undefined && (
              <div data-phone-presets hidden={!presetsOpen} style={{ display: presetsOpen ? 'block' : 'none', maxHeight: '42vh', overflow: 'auto', padding: '12px 16px', touchAction: 'pan-x pan-y' }}>{p.presets}</div>
            )}
            {p.panels?.map(x => (
              <div key={x.id} data-phone-panel={x.id} hidden={mode !== x.id} style={{ display: mode === x.id ? 'flex' : 'none', flexDirection: 'column', height, overflowY: 'auto', touchAction: 'pan-y' }}>{x.content}</div>
            ))}
            <div data-phone-settings hidden={!settingsOpen} style={{ display: settingsOpen ? 'flex' : 'none', flexDirection: 'column', height, overflowY: 'auto', touchAction: 'pan-y' }}>{p.settings}</div>
            <div ref={rowRef} role="tablist" aria-label="Builder sections" data-phone-tabs
              style={{ flexShrink: 0, display: 'flex', gap: 4, padding: '6px 8px', overflowX: 'auto', scrollbarWidth: 'none', touchAction: 'pan-x', borderTop: `1px solid ${tk.border.subtle}`, background: tk.bg.panel }}>
              {p.presets !== undefined && tab(PRESETS_TAB, p.presetsLabel ?? 'Presets', 'presets', () => setMode(PRESETS_TAB))}
              {p.panels?.map(x => tab(x.id, x.label, x.icon, () => setMode(x.id)))}
              {p.sections.map(s => tab(s.id, s.label, s.icon, () => { p.onSection(s.id); setMode(SETTINGS_MODE); }, s.dim))}
            </div>
          </div>
        )}
      </div>
    </PhoneStudioContext.Provider>
  );
}

/** Touch sizes inside the phone shell: every button, field and slider at least 40 px. */
const TOUCH_CSS = `
[data-phone-studio] button, [data-phone-studio] select, [data-phone-studio] input:not([type=checkbox]):not([type=radio]) { min-height: 40px; }
[data-phone-studio] button:has(> svg:only-child) { min-width: 40px; }
[data-phone-studio] [data-ruler-track] { height: 40px !important; border-radius: 20px !important; }
[data-phone-presets] span:has(> [data-surprise-bar]) { flex-wrap: wrap; row-gap: 8px; }
[data-phone-presets] span:has(> [data-surprise-bar]) > span:first-child { flex: 1 1 100% !important; }
`;
