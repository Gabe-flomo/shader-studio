/**
 * BuilderTabBar — the one tab row every builder uses (BuilderWindow draws it above the main area:
 * the 3D Scene Builder's sections, Grid Rules' Presets · Neighbourhood · Born & Survive …, Agent
 * Rules' Species · Rules · Trails · Look; on a phone the side panels join the row). HowLine is the
 * tab's one-line "How this works" under it. useRememberedTab keeps the tab per builder
 * (builderLayout.ts).
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import { Icon } from '../ui/Icon';
import { useFoldState } from '../NodeGraph/foldState';
import type { IconName } from '../ui/iconPaths';
import { rememberTab, rememberedTab, validTab, type BuilderSectionTab } from './builderLayout';

export interface TabBarItem { value: string; label: string; icon?: IconName; gapBefore?: boolean }

export function BuilderTabBar({ items, value, onChange, ariaLabel, scroll = false }: {
  items: TabBarItem[]; value: string; onChange: (v: string) => void; ariaLabel: string;
  /** One row that scrolls sideways (a phone) instead of wrapping. */
  scroll?: boolean;
}) {
  const tk = useTokens();
  const row = useRef<HTMLDivElement>(null);
  // A row that scrolls sideways keeps the chosen tab in view (a remembered tab far along the row).
  useEffect(() => {
    if (!scroll || !row.current) return;
    const el = row.current.querySelector<HTMLElement>('[aria-selected="true"]');
    if (el) row.current.scrollLeft = Math.max(0, el.offsetLeft - (row.current.clientWidth - el.offsetWidth) / 2);
  }, [scroll, value]);
  return (
    <div ref={row} role="tablist" aria-label={ariaLabel} data-builder-tabbar style={{
      position: 'sticky', top: 0, zIndex: 2, display: 'flex', gap: 2, padding: '8px 14px', flexShrink: 0,
      flexWrap: scroll ? 'nowrap' : 'wrap', overflowX: scroll ? 'auto' : undefined, scrollbarWidth: 'none',
      background: tk.bg.panel, borderBottom: `1px solid ${tk.border.subtle}`,
    }}>
      {items.map(t => {
        const on = t.value === value;
        return (
          <button key={t.value} role="tab" aria-selected={on} type="button" data-builder-tab={t.value} onClick={() => onChange(t.value)}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6, height: 30, padding: '0 10px', border: 0, borderRadius: radius.md, cursor: 'pointer', flexShrink: 0, whiteSpace: 'nowrap',
              background: on ? tk.bg.selected : 'none', color: on ? tk.accent.text : tk.text.secondary, font: `${on ? 650 : 500} 12.5px ${fontFamily.ui}`,
              boxShadow: on ? `inset 0 0 0 1px ${tk.border.default}` : 'none',
              ...(t.gapBefore ? { marginLeft: 10 } : {}),
            }}>
            {t.icon && <Icon name={t.icon} size={14} />}{t.label}
          </button>
        );
      })}
    </div>
  );
}

/** A tab's "How this works", one line at its top. */
export function HowLine({ text }: { text: string }) {
  const tk = useTokens();
  return (
    <div data-builder-how style={{
      display: 'flex', alignItems: 'flex-start', gap: 8, margin: '14px 22px 0', padding: '0 0 10px',
      borderBottom: `1px dashed ${alpha(tk.accent.base, 0.25)}`, color: tk.text.secondary, font: `12.5px/1.45 ${fontFamily.ui}`,
    }}>
      <Icon name="info" size={13} style={{ flexShrink: 0, marginTop: 2, color: tk.accent.base }} />
      <span><b style={{ fontWeight: 650, color: tk.text.primary }}>How this works: </b>{text}</span>
    </div>
  );
}

/**
 * The builder's tab, remembered between openings (`initial` the first time); `fallback` when the
 * tab isn't offered now (a rule type without a Neighbourhood tab).
 */
export function useRememberedTab(builder: string, tabs: BuilderSectionTab[], initial: string, fallback = initial): [string, (id: string) => void] {
  const [tab, setTab] = useState(() => rememberedTab(builder, tabs.map(t => t.id), initial));
  const choose = (id: string) => { setTab(id); rememberTab(builder, id); };
  return [validTab(tab, tabs, fallback), choose];
}

/**
 * A folded group of rarely used settings, with a summary while folded. Folded by default; the
 * ones opened are remembered for the session (the fold store, by `foldKey`).
 */
export function BuilderFold({ foldKey, title, summary, children }: { foldKey: string; title: string; summary: string; children: ReactNode }) {
  const tk = useTokens();
  const open = useFoldState(s => !!s.folded[foldKey]);
  const toggle = useFoldState(s => s.toggle);
  return (
    <section data-fold={foldKey} style={{ borderTop: `1px solid ${tk.border.subtle}`, paddingTop: 8 }}>
      <button type="button" aria-expanded={open} onClick={() => toggle(foldKey)}
        style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, border: 0, background: 'transparent', padding: '4px 0', cursor: 'pointer', color: tk.text.primary, textAlign: 'left' }}>
        <Icon name={open ? 'chevD' : 'chevR'} size={14} style={{ color: tk.text.faint }} />
        <b style={{ font: `600 13px ${fontFamily.ui}` }}>{title}</b>
        {!open && <span style={{ marginLeft: 'auto', color: tk.text.muted, fontSize: 11.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 320 }}>{summary}</span>}
      </button>
      {open && <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '8px 0 4px' }}>{children}</div>}
    </section>
  );
}
