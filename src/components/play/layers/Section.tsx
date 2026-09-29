import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';
import { useTokens } from '../../../theme/themeStore';
import { fontFamily } from '../../../theme/tokens';
import { Icon } from '../../ui/Icon';
import { Toggle } from '../../ui/Choice';
import { Tooltip } from '../../ui/Tooltip';
import { usePlayUi, registerSection, unregisterSection } from '../playUi';
import { sectionKey, useSectionTabs } from './sectionTabs';

/**
 * A foldable group of settings in a layer editor: click the heading to fold
 * it (remembered for every layer of that kind). With `on`, the heading
 * carries a switch, and the settings only show while it is on (Flocking,
 * Sequence…).
 *
 * Sections start folded so an editor opens uncluttered — except the one
 * marked `primary` (the section you almost always want first: Members,
 * Spawn, the file picker…), which starts open. A folded section with a
 * `summary` shows it as a one-line reminder of what's inside.
 *
 * Inside a tab host (BigEditorScaffold — every layer card and full editor
 * has one) with two or more Sections, each Section is a tab instead: only
 * the open one shows, without its fold heading (the tab is the heading). A
 * tab that has been opened stays mounted while hidden, so switching never
 * loses what's inside. "Show all" (the strip's toggle) brings back the
 * stacked, folded layout above.
 */
export function Section({ kind, title, hint, on, onToggle, id, primary, summary, children }: {
  /** The layer kind, so folding "Look" folds it on every particles layer. */
  kind: string;
  title: string;
  hint?: string;
  on?: boolean;
  onToggle?: (on: boolean) => void;
  /** An anchor id (a BigEditorScaffold's jump strip scrolls to it). */
  id?: string;
  /** This editor's one section that starts open instead of folded. */
  primary?: boolean;
  /** Shown in place of the body while folded: a glance at what's set inside. */
  summary?: ReactNode;
  children?: ReactNode;
}) {
  const tk = useTokens();
  const tabs = useSectionTabs();
  const tabKey = sectionKey(id, title);
  const rootRef = useRef<HTMLDivElement>(null);
  const key = `${kind}:${title}`;
  const stored = usePlayUi(s => s.folded[key]);
  const folded = stored === undefined ? !primary : stored;
  const toggleFold = usePlayUi(s => s.toggleFold);
  const switched = onToggle !== undefined;
  const showBody = !folded && (!switched || on);
  const heading = <span style={{ color: tk.text.secondary, font: `650 11px ${fontFamily.ui}` }}>{title}</span>;
  // Register so "Expand all" / "Collapse all" for this kind know this title exists.
  useEffect(() => {
    registerSection(kind, title);
    return () => unregisterSection(kind, title);
  }, [kind, title]);
  // Be one of the host's tabs.
  const register = tabs?.register, setMeta = tabs?.setMeta;
  useLayoutEffect(() => register?.({ key: tabKey, title, kind, primary: !!primary, el: rootRef }), [register, tabKey, title, kind, primary]);
  const summaryText = typeof summary === 'string' ? summary : undefined;
  const onState = switched ? !!on : undefined;
  useLayoutEffect(() => { setMeta?.(tabKey, { summary: summaryText, hint, on: onState }); }, [setMeta, tabKey, summaryText, hint, onState]);

  if (tabs && tabs.mode === 'pending') return <div ref={rootRef} id={id} hidden />;
  if (tabs && tabs.mode === 'tabs') {
    const open = tabs.active === tabKey;
    const keep = open || tabs.mounted.has(tabKey);
    return (
      <div ref={rootRef} id={id} role="tabpanel" aria-label={title} hidden={!open} data-section-tab={tabKey}>
        {keep && switched && (
          // The tab is the heading; a switched section still needs its switch.
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '8px 0 2px', minHeight: 22 }}>
            <span style={{ flex: 1, minWidth: 0, color: on ? tk.text.secondary : tk.text.faint, font: `11.5px/1.4 ${fontFamily.ui}` }}>
              {on ? `${title} is on` : `${title} is off: switch it on to use it`}
            </span>
            <Toggle checked={!!on} onChange={v => onToggle(v)} />
          </div>
        )}
        {keep && (!switched || on) && children}
      </div>
    );
  }
  return (
    <div ref={rootRef} id={id} data-section-tab={tabs ? tabKey : undefined} style={{ scrollMarginTop: 44 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '12px 0 2px', minHeight: 22 }}>
        <button
          type="button"
          aria-expanded={!folded}
          aria-label={`${folded ? 'Show' : 'Fold'} ${title}`}
          onClick={() => toggleFold(key, !folded)}
          style={{ display: 'flex', alignItems: 'center', gap: 4, border: 0, background: 'none', padding: 0, cursor: 'pointer', flex: 1, minWidth: 0 }}
        >
          <Icon name={folded ? 'chevR' : 'chevD'} size={12} style={{ color: tk.text.faint, flexShrink: 0 }} />
          {hint ? <Tooltip label={title} description={hint} placement="top">{heading}</Tooltip> : heading}
          <span style={{ flex: 1, height: 1, marginLeft: 4, background: tk.border.default }} />
        </button>
        {switched && <Toggle checked={!!on} onChange={v => onToggle(v)} />}
      </div>
      {folded && summary && (
        <div style={{ margin: '0 0 2px 18px', color: tk.text.faint, font: `11px/1.4 ${fontFamily.ui}`, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {summary}
        </div>
      )}
      {showBody && children}
    </div>
  );
}
