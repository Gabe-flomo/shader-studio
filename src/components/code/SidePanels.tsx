/**
 * Collapsible side panels for the code editors (Expression Block, Custom Function): the header's
 * "ƒ Functions" toggle, the Inputs panel's slim rail, the ⌘[ / ⌘] shortcuts, and drawers over
 * the code on narrow windows. Open / closed is remembered (editorPanelPrefs.ts).
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTokens } from '../../theme/themeStore';
import { fontFamily, radius } from '../../theme/tokens';
import { Icon } from '../ui/Icon';
import { TYPE_COLORS } from '../NodeGraph/typeColors';
import { DRAWER_BELOW_PX, panelForShortcut, useEditorPanels, type EditorPanel, type EditorPanels } from './editorPanelPrefs';

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
export const PANEL_SHORTCUT: Record<EditorPanel, string> = { inputs: IS_MAC ? '⌘[' : 'Ctrl+[', functions: IS_MAC ? '⌘]' : 'Ctrl+]' };

/** True while the window is narrower than the drawer threshold. */
export function useNarrowWindow(below = DRAWER_BELOW_PX): boolean {
  const get = () => typeof window !== 'undefined' && window.innerWidth < below;
  const [narrow, setNarrow] = useState(get);
  useEffect(() => {
    const on = () => setNarrow(get());
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [below]);
  return narrow;
}

/**
 * The editor's side panels. On a wide window they follow the remembered choice (editorPanelPrefs);
 * on a narrow one they are drawers over the code that start closed each time (opening one there
 * doesn't change the wide layout). ⌘[ / ⌘] toggle the given panels while the editor is open.
 */
export function useEditorSidePanels(panels: readonly EditorPanel[]) {
  const narrow = useNarrowWindow();
  const remembered = useEditorPanels(s => s.open);
  const [drawers, setDrawers] = useState<EditorPanels>({ functions: false, inputs: false });
  const open = narrow ? drawers : remembered;
  const set = (p: EditorPanel, v: boolean) => {
    if (narrow) setDrawers(d => ({ ...(v ? { functions: false, inputs: false } : d), [p]: v }));
    else useEditorPanels.getState().set(p, v);
  };
  const toggle = (p: EditorPanel) => set(p, !open[p]);
  const toggleRef = useRef(toggle);
  toggleRef.current = toggle;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const p = panelForShortcut(e);
      if (!p || !panels.includes(p)) return;
      e.preventDefault();
      e.stopPropagation();
      toggleRef.current(p);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [panels]);
  return { narrow, open, set, toggle };
}

/** The header's toggle for the function palette. */
export function FunctionsToggle({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const tk = useTokens();
  return (
    <button type="button" data-panel-toggle="functions" aria-pressed={open}
      title={`${open ? 'Hide' : 'Show'} the functions, variables and operators (${PANEL_SHORTCUT.functions})`}
      onClick={onToggle}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6, height: 30, padding: '0 10px', marginRight: 4, border: 0, borderRadius: radius.md, cursor: 'pointer',
        background: open ? tk.bg.selected : 'none', color: open ? tk.accent.text : tk.text.secondary, font: `600 12.5px ${fontFamily.ui}`,
        boxShadow: open ? `inset 0 0 0 1px ${tk.border.default}` : 'none',
      }}>
      <Icon name="fn" size={14} />Functions
    </button>
  );
}

/**
 * A side panel: beside the code on a wide window, a drawer over it (with a scrim that closes it)
 * on a narrow one. The parent must be `position: relative`.
 */
export function SidePanel({ side, open, narrow, width, onClose, label, children }: {
  side: 'left' | 'right'; open: boolean; narrow: boolean; width: number; onClose: () => void; label: string; children: ReactNode;
}) {
  const tk = useTokens();
  if (!open) return null;
  if (!narrow) return <>{children}</>;
  return (
    <>
      <div data-panel-scrim={side} onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(10,10,20,0.18)', zIndex: 4 }} />
      <div role="dialog" aria-label={label} data-panel-drawer={side}
        style={{
          position: 'absolute', top: 0, bottom: 0, [side]: 0, width: Math.min(width, 420), maxWidth: '88%', zIndex: 5, display: 'flex',
          background: tk.bg.panel, boxShadow: side === 'left' ? '8px 0 24px rgba(0,0,0,0.18)' : '-8px 0 24px rgba(0,0,0,0.18)',
        }}>
        {children}
      </div>
    </>
  );
}

/** The folded Inputs panel: a slim rail of input chips; clicking it opens the panel again. */
export function InputsRail({ inputs, onExpand }: { inputs: ReadonlyArray<{ name: string; type: string }>; onExpand: () => void }) {
  const tk = useTokens();
  return (
    <button type="button" data-panel-rail="inputs" onClick={onExpand}
      title={`Show the inputs (${PANEL_SHORTCUT.inputs})`} aria-label="Show the inputs"
      style={{
        width: 56, flexShrink: 0, border: 0, borderRight: `1px solid ${tk.border.subtle}`, background: tk.bg.subtle, cursor: 'pointer',
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, padding: '14px 4px', overflow: 'hidden',
      }}>
      <Icon name="chevR" size={14} style={{ color: tk.text.faint }} />
      <span style={{ font: `650 9.5px ${fontFamily.ui}`, letterSpacing: '0.08em', color: tk.text.faint, textTransform: 'uppercase', marginBottom: 2 }}>In</span>
      {inputs.map((inp, i) => (
        <span key={`${inp.name}-${i}`} title={`${inp.name} · ${inp.type}`}
          style={{
            maxWidth: 48, display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 6px', borderRadius: 7, background: tk.bg.panel,
            boxShadow: `inset 0 0 0 1px ${tk.border.default}`, font: `500 11px ${fontFamily.mono}`, color: tk.text.primary,
          }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', flexShrink: 0, background: TYPE_COLORS[inp.type] ?? tk.text.faint }} />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{inp.name}</span>
        </span>
      ))}
    </button>
  );
}

/** The Inputs panel's own fold button, next to its label. */
export function CollapseInputsButton({ onCollapse }: { onCollapse: () => void }) {
  const tk = useTokens();
  return (
    <button type="button" data-panel-collapse="inputs" onClick={onCollapse}
      title={`Fold the inputs to a rail (${PANEL_SHORTCUT.inputs})`} aria-label="Fold the inputs"
      style={{ marginLeft: 'auto', width: 26, height: 26, border: 0, borderRadius: radius.sm, background: 'none', color: tk.text.faint, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
      <Icon name="chevL" size={14} />
    </button>
  );
}
