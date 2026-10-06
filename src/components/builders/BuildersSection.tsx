/**
 * BuildersSection — the Builders at the top of the node browser (docs/node-browser.md, "Builders"):
 * the 3D Scene Builder, Grid Rules and Agent Rules as three big entries, each with what it is and
 * what you can make with it. A click opens it (builders/open.ts): a new scene in the Scene
 * Builder, a new Grid Rules node with its editor open, a new rules Agents group with its rules open.
 *
 * Folds, and remembers that in this browser. While searching, only the builders the search finds
 * show ("builder", "scene", "rules"), unfolded. The desktop palette, its drawer and the phone's
 * node browser all use it (`touch` makes the rows finger-sized).
 */
import { useState } from 'react';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import { Icon } from '../ui/Icon';
import { BUILDERS, matchBuilders, type BuilderInfo } from '../../builders/registry';
import { openBuilder } from '../../builders/open';
import { useBuildersFold } from '../../builders/fold';

export function BuildersSection({ query = '', touch = false, onOpened }: { query?: string; touch?: boolean; onOpened?: () => void }) {
  const tk = useTokens();
  const folded = useBuildersFold(s => s.folded);
  const toggle = useBuildersFold(s => s.toggle);
  const searching = query.trim().length > 0;
  const list = searching ? matchBuilders(query) : BUILDERS;
  if (searching && !list.length) return null;
  const open = searching || !folded;
  return (
    <section data-builders-section aria-label="Builders" style={{ display: 'flex', flexDirection: 'column', gap: touch ? 6 : 4, marginBottom: touch ? 10 : 6 }}>
      <button type="button" onClick={searching ? undefined : toggle} aria-expanded={open} disabled={searching} data-builders-toggle
        title={searching ? undefined : open ? 'Fold the builders' : 'Show the builders'}
        style={{
          display: 'flex', alignItems: 'center', gap: 6, padding: touch ? '6px 4px' : '8px 2px 2px', border: 0, background: 'none',
          cursor: searching ? 'default' : 'pointer', color: tk.text.faint, textAlign: 'left',
        }}>
        <span style={{ fontSize: touch ? 10.5 : 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Builders</span>
        {!open && <span style={{ font: `500 11px ${fontFamily.ui}`, color: tk.text.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>3D scenes, grid rules, agent rules</span>}
        <span style={{ flex: 1, height: 1, background: tk.border.subtle }} />
        {!searching && <Icon name={open ? 'chevU' : 'chevD'} size={13} />}
      </button>
      {open && list.map(b => <BuilderEntry key={b.id} b={b} touch={touch} onOpened={onOpened} />)}
    </section>
  );
}

function BuilderEntry({ b, touch, onOpened }: { b: BuilderInfo; touch: boolean; onOpened?: () => void }) {
  const tk = useTokens();
  const [hover, setHover] = useState(false);
  return (
    <button type="button" data-builder={b.id} title={`${b.description}. ${b.action}.`}
      onClick={() => { openBuilder(b.id); onOpened?.(); }}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: touch ? 12 : 10, width: '100%', padding: touch ? '12px 12px' : '8px 10px',
        border: 0, borderRadius: touch ? 12 : radius.md, cursor: 'pointer', textAlign: 'left', touchAction: 'manipulation',
        background: hover ? tk.bg.hover : tk.bg.field, boxShadow: `inset 0 0 0 1px ${tk.border.subtle}`, color: tk.text.primary,
        transition: 'background 0.12s',
      }}>
      <span style={{ width: touch ? 38 : 32, height: touch ? 38 : 32, borderRadius: touch ? 10 : 8, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: alpha(tk.accent.base, 0.12), color: tk.accent.base }}>
        <Icon name={b.icon} size={touch ? 19 : 16} />
      </span>
      <span style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0, flex: 1 }}>
        <b style={{ font: `600 ${touch ? 14 : 12.5}px ${fontFamily.ui}` }}>{b.title}</b>
        <span style={{ fontSize: touch ? 12.5 : 11.5, color: tk.text.muted, lineHeight: 1.35 }}>{b.description}</span>
        <span style={{ fontSize: touch ? 12 : 11, color: tk.text.faint, lineHeight: 1.35 }}>Make: <span style={{ color: tk.text.secondary }}>{b.makes}</span></span>
      </span>
      <Icon name="chevR" size={14} style={{ color: tk.text.faint, flexShrink: 0 }} />
    </button>
  );
}
