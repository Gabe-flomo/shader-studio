/**
 * BuilderWindow — the shell every "builder" editor shares (the 3D Scene
 * Builder; meant for the Grid Rules and Agent Rules editors too), in the
 * Expression Block editor's style: the Modal's header (tinted icon, title,
 * subtitle, actions, close), collapsible side panels toggled from the header
 * (⌘[ / ⌘], remembered per builder) that become drawers on a narrow window,
 * a scrolling main area, and a footer with secondary actions on the left and
 * Done on the right. On a phone it fills the screen and the panels become tabs
 * (builderLayout.ts).
 *
 * Built-in guidance comes with it (BuilderHelp.tsx, words in helpContent.ts): a Tips switch in
 * the header, and <BuilderHelp> / <EmptyHelp> / <HintMark> for the builder's sections, which find
 * their text by the window's `prefsKey`.
 */
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Modal } from '../ui/Modal';
import { Icon } from '../ui/Icon';
import type { IconName } from '../ui/iconPaths';
import { SidePanel, useNarrowWindow } from '../code/SidePanels';
import { useTokens } from '../../theme/themeStore';
import { fontFamily, radius } from '../../theme/tokens';
import { Segmented } from '../ui/Choice';
import { usePhoneDialog } from '../ui/phoneDialog';
import { builderTabs, type BuilderTab } from './builderLayout';
import { BuilderHelpContext, HintLabel, TipsToggle } from './BuilderHelp';

export { BuilderHelp, EmptyHelp, HintLabel, HintMark, TipsToggle, useTips } from './BuilderHelp';

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

export interface BuilderPanel {
  label: string;
  icon: IconName;
  width: number;
  content: ReactNode;
  /** Shown in place of the panel while it is folded (a slim rail); nothing when omitted. */
  rail?: (expand: () => void) => ReactNode;
  /** Open the first time the builder is used. */
  defaultOpen?: boolean;
}

function readPref(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v === '1';
  } catch { return fallback; }
}
function writePref(key: string, v: boolean) {
  try { localStorage.setItem(key, v ? '1' : '0'); } catch { /* storage unavailable: kept for this session only */ }
}

/** A header button that shows or hides a side panel. */
function PanelToggle({ panel, open, onToggle, shortcut }: { panel: BuilderPanel; open: boolean; onToggle: () => void; shortcut: string }) {
  const tk = useTokens();
  return (
    <button type="button" aria-pressed={open} data-builder-toggle={panel.label}
      title={`${open ? 'Hide' : 'Show'} ${panel.label} (${shortcut})`}
      onClick={onToggle}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6, height: 30, padding: '0 10px', marginRight: 4, border: 0, borderRadius: radius.md, cursor: 'pointer',
        background: open ? tk.bg.selected : 'none', color: open ? tk.accent.text : tk.text.secondary, font: `600 12.5px ${fontFamily.ui}`,
        boxShadow: open ? `inset 0 0 0 1px ${tk.border.default}` : 'none',
      }}>
      <Icon name={panel.icon} size={14} />{panel.label}
    </button>
  );
}

export function BuilderWindow({
  prefsKey, title, subtitle, icon, iconColor, left, right, headerActions, footer, onClose, width = 1240, height = 780, mainLabel = 'Edit', children,
}: {
  /** Names the remembered panel choices (`scene-builder`). */
  prefsKey: string;
  title: ReactNode;
  subtitle?: ReactNode;
  icon: IconName;
  iconColor?: string;
  left?: BuilderPanel;
  right?: BuilderPanel;
  headerActions?: ReactNode;
  footer: ReactNode;
  onClose: () => void;
  width?: number;
  height?: number;
  /** The main area's name in the phone's tab row (the side panels go by their labels). */
  mainLabel?: string;
  children: ReactNode;
}) {
  const tk = useTokens();
  const narrow = useNarrowWindow();
  // A phone (builderLayout.ts): the window is full screen and the panels are tabs, one at a time.
  const phone = usePhoneDialog();
  const [tab, setTab] = useState<BuilderTab>('main');
  const [wide, setWide] = useState(() => ({
    left: readPref(`builder:${prefsKey}:left`, left?.defaultOpen ?? true),
    right: readPref(`builder:${prefsKey}:right`, right?.defaultOpen ?? true),
  }));
  // On a narrow window the panels are drawers over the main area that start closed.
  const [drawers, setDrawers] = useState({ left: false, right: false });
  const open = narrow ? drawers : wide;
  const set = (side: 'left' | 'right', v: boolean) => {
    if (narrow) setDrawers(d => (v ? { left: false, right: false, [side]: true } : { ...d, [side]: false }));
    else { setWide(w => ({ ...w, [side]: v })); writePref(`builder:${prefsKey}:${side}`, v); }
  };
  const toggle = useRef<(side: 'left' | 'right') => void>(() => {});
  toggle.current = side => set(side, !open[side]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
      if (e.key !== '[' && e.key !== ']') return;
      e.preventDefault();
      e.stopPropagation();
      if (e.key === '[' && left) toggle.current('left');
      if (e.key === ']' && right) toggle.current('right');
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [left, right]);
  const sc = (k: string) => `${IS_MAC ? '⌘' : 'Ctrl+'}${k}`;

  const panelBox = (p: BuilderPanel, side: 'left' | 'right') => (
    <div data-builder-panel={p.label} style={{
      width: p.width, maxWidth: '100%', flexShrink: 0, overflowY: 'auto', boxSizing: 'border-box', display: 'flex', flexDirection: 'column',
      background: tk.bg.subtle, [side === 'left' ? 'borderRight' : 'borderLeft']: `1px solid ${tk.border.subtle}`,
    }}>
      {p.content}
    </div>
  );

  return (
    <BuilderHelpContext.Provider value={prefsKey}>
    <Modal title={title} subtitle={subtitle} icon={icon} iconColor={iconColor} width={width} height={height} onClose={onClose} closeOnScrim={false}
      headerActions={phone ? <><TipsToggle builder={prefsKey} />{headerActions}</> : <>
        <TipsToggle builder={prefsKey} />
        {left && <PanelToggle panel={left} open={open.left} onToggle={() => toggle.current('left')} shortcut={sc('[')} />}
        {right && <PanelToggle panel={right} open={open.right} onToggle={() => toggle.current('right')} shortcut={sc(']')} />}
        {headerActions}
      </>}
      footer={footer}>
      {phone ? (
        <div data-builder-tabs style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
          {(left || right) && (
            <div style={{ flexShrink: 0, padding: '8px 12px', borderBottom: `1px solid ${tk.border.subtle}` }}>
              <Segmented<BuilderTab> fill ariaLabel="Section" value={tab} onChange={setTab} options={builderTabs(left?.label, mainLabel, right?.label)} />
            </div>
          )}
          {/* All three stay mounted (a preview keeps running, a half-typed field keeps its text); only one shows. */}
          {left && <div data-builder-panel={left.label} style={{ display: tab === 'left' ? 'flex' : 'none', flex: 1, minHeight: 0, overflowY: 'auto', flexDirection: 'column', background: tk.bg.subtle }}>{left.content}</div>}
          <div data-builder-main style={{ display: tab === 'main' ? 'flex' : 'none', flex: 1, minHeight: 0, overflowY: 'auto', flexDirection: 'column' }}>{children}</div>
          {right && <div data-builder-panel={right.label} style={{ display: tab === 'right' ? 'flex' : 'none', flex: 1, minHeight: 0, overflowY: 'auto', flexDirection: 'column', background: tk.bg.subtle }}>{right.content}</div>}
        </div>
      ) : (
      <div style={{ display: 'flex', height: '100%', minHeight: 0, position: 'relative' }}>
        {left && (!open.left || narrow) && left.rail?.(() => set('left', true))}
        {left && (
          <SidePanel side="left" label={left.label} open={open.left} narrow={narrow} width={left.width} onClose={() => set('left', false)}>
            {panelBox(left, 'left')}
          </SidePanel>
        )}
        <div data-builder-main style={{ flex: 1, minWidth: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>{children}</div>
        {right && (
          <SidePanel side="right" label={right.label} open={open.right} narrow={narrow} width={right.width} onClose={() => set('right', false)}>
            {panelBox(right, 'right')}
          </SidePanel>
        )}
      </div>
      )}
    </Modal>
    </BuilderHelpContext.Provider>
  );
}

/** Small caps section label, as in the Expression Block editor. */
export function BuilderLabel({ children, meta, hint }: { children: ReactNode; meta?: ReactNode; hint?: string }) {
  const tk = useTokens();
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 10.5, fontWeight: 700, letterSpacing: '0.08em', color: tk.text.faint, textTransform: 'uppercase' }}>
      <span style={{ flex: 1 }}>{hint ? <HintLabel hint={hint}>{children}</HintLabel> : children}</span>
      {meta && <span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 500, fontSize: 12 }}>{meta}</span>}
    </span>
  );
}

export function BuilderNote({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  const tk = useTokens();
  return <span style={{ fontSize: 12, lineHeight: 1.45, color: tk.text.muted, ...style }}>{children}</span>;
}
