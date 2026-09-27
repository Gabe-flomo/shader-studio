/**
 * GraphLinks — the Studio/Play side of links between graphs and presentations
 * (present/links.ts): the "Presentation: … · Link…" row in the save popover,
 * the small link badge the graph and presentation lists show, and the
 * "Linked presentations" setting (Ask / Always / Never).
 */
import { useEffect, useState } from 'react';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import { Icon } from '../ui/Icon';
import { Segmented } from '../ui/Choice';
import { toast } from '../ui/toastStore';
import { requestPage } from '../page';
import { listPresentations } from '../../present/storage';
import { exampleLinks, link, linkedOpenSetting, LINKED_OPEN_SETTING_CHANGED, setLinkedOpenSetting, unlink, type LinkedOpenSetting } from '../../present/links';
import { useGraphLinks } from './linkHooks';

const quoteList = (xs: readonly string[]) => xs.map(x => `“${x}”`).join(', ');

/** The small link mark on a list row; hovering names the partner(s). Nothing when there are none. */
export function LinkBadge({ partners, kind, compact = false }: { partners: readonly string[]; kind: 'presentation' | 'graph' | 'sample'; compact?: boolean }) {
  const tk = useTokens();
  if (!partners.length) return null;
  const what = kind === 'graph' ? (partners.length === 1 ? 'graph' : 'graphs') : kind === 'sample' ? (partners.length === 1 ? 'sample presentation' : 'sample presentations') : (partners.length === 1 ? 'presentation' : 'presentations');
  const title = `Linked ${what}: ${quoteList(partners)}`;
  return (
    <span title={title} aria-label={title} role="img"
      style={{ flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 3, height: 18, padding: compact ? '0 4px' : '0 6px 0 4px', borderRadius: 5, background: alpha(tk.accent.base, 0.1), color: tk.accent.text, font: `600 10px ${fontFamily.ui}` }}>
      <Icon name="link" size={12} />
      {!compact && (kind === 'graph' ? 'Graph' : 'Slides')}
    </span>
  );
}

/** The badge for a saved graph (by name) or an example (by key). */
export function GraphLinkBadge({ graph, example, compact }: { graph?: string; example?: string; compact?: boolean }) {
  const linked = useGraphLinks(graph);
  if (example) return <LinkBadge partners={exampleLinks(example)} kind="sample" compact={compact} />;
  return <LinkBadge partners={linked} kind="presentation" compact={compact} />;
}

async function actions() { return import('../present/linkActions'); }

/** Open a presentation on Present and go there. */
async function goToPresentation(name: string): Promise<void> {
  const m = await actions();
  if (m.openPresentation(name)) requestPage('present');
}

/**
 * "Presentation: none · Link…" for the open saved graph: link it to an
 * existing presentation or a new one made from it, open a linked one, unlink.
 */
export function GraphPresentationLink({ graph, onNavigated }: { graph: string; onNavigated?: () => void }) {
  const tk = useTokens();
  const linked = useGraphLinks(graph);
  // The choices open inline (a menu portaled out of the save popover would close it).
  const [picking, setPicking] = useState(false);
  const others = picking ? listPresentations().filter(p => !linked.includes(p.name)) : [];
  const makeNew = async () => {
    const m = await actions();
    const name = m.createPresentationFromGraph(graph);
    if (!name) return;
    toast.success(`Made “${name}”`, { message: 'Linked to this graph. It’s open on Present.' });
    onNavigated?.();
    requestPage('present');
  };
  const linkTo = (p: string) => {
    if (link(graph, p)) toast.success(`Linked “${graph}” and “${p}”`);
    else toast.error('Couldn’t link them', { message: 'One of them isn’t saved here any more.' });
    setPicking(false);
  };
  const text = { border: 0, background: 'none', padding: 0, cursor: 'pointer', font: `500 12px ${fontFamily.ui}`, flexShrink: 0 } as const;
  const choice = { display: 'flex', alignItems: 'center', gap: 8, width: '100%', minHeight: 30, padding: '4px 8px', border: 0, borderRadius: radius.md, background: 'none', cursor: 'pointer', textAlign: 'left', color: tk.text.primary, font: `500 12.5px ${fontFamily.ui}` } as const;
  const hover = (on: boolean) => (e: React.MouseEvent<HTMLButtonElement>) => { e.currentTarget.style.background = on ? tk.bg.hover : 'none'; };
  const linkBtn = (label: string) => (
    <button type="button" aria-expanded={picking} onClick={() => setPicking(x => !x)} style={{ ...text, color: tk.accent.text }}>{picking ? 'Cancel' : label}</button>
  );
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '8px 0 0', borderTop: `1px solid ${tk.border.subtle}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, fontSize: 12 }}>
        <Icon name="slides" size={13} style={{ color: tk.text.faint, flexShrink: 0 }} />
        <span style={{ color: tk.text.muted, flexShrink: 0 }}>Presentation:</span>
        {linked.length === 0 && <><span style={{ color: tk.text.faint }}>none</span><span style={{ color: tk.text.faint }}>·</span>{linkBtn('Link…')}</>}
        {linked.length > 0 && <span style={{ flex: 1 }} />}
        {linked.length > 0 && linkBtn('Link another…')}
      </div>
      {linked.map(p => (
        <div key={p} style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, padding: '4px 8px', borderRadius: radius.md, background: tk.bg.field }}>
          <Icon name="link" size={12} style={{ color: tk.accent.text, flexShrink: 0 }} />
          <span title={p} style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: tk.text.primary, font: `600 12px ${fontFamily.ui}` }}>{p}</span>
          <button type="button" style={{ ...text, color: tk.accent.text }} onClick={() => { onNavigated?.(); void goToPresentation(p); }}>Open</button>
          <button type="button" style={{ ...text, color: tk.text.muted }} title="The graph and the presentation both stay; only the link goes" onClick={() => { unlink(graph, p); toast.info(`Unlinked “${p}”`, { action: { label: 'Undo', onClick: () => { link(graph, p); } } }); }}>Unlink</button>
        </div>
      ))}
      {picking && (
        <div role="menu" aria-label="Link a presentation" style={{ display: 'flex', flexDirection: 'column', gap: 1, padding: 4, borderRadius: radius.md, boxShadow: `inset 0 0 0 1px ${tk.border.default}` }}>
          <button type="button" role="menuitem" style={choice} onMouseEnter={hover(true)} onMouseLeave={hover(false)} onClick={() => void makeNew()}>
            <Icon name="plus" size={14} style={{ color: tk.text.muted, flexShrink: 0 }} />
            <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
              <span>New presentation from this graph</span>
              <span style={{ color: tk.text.faint, fontSize: 11 }}>A first step showing it, linked to it</span>
            </span>
          </button>
          {others.length > 0 && <span style={{ padding: '6px 8px 2px', color: tk.text.faint, font: `700 10px ${fontFamily.ui}`, letterSpacing: '0.07em', textTransform: 'uppercase' }}>Or link one you have</span>}
          <div style={{ maxHeight: 180, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 1 }}>
            {others.map(p => (
              <button key={p.name} type="button" role="menuitem" style={choice} onMouseEnter={hover(true)} onMouseLeave={hover(false)} onClick={() => linkTo(p.name)}>
                <Icon name="slides" size={14} style={{ color: tk.text.muted, flexShrink: 0 }} />
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
                <span style={{ color: tk.text.faint, fontSize: 11, flexShrink: 0 }}>{p.steps} step{p.steps === 1 ? '' : 's'}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** What loading a linked graph or presentation does. In the Library panel. */
export function LinkedOpenSettingControl() {
  const tk = useTokens();
  const [v, setV] = useState<LinkedOpenSetting>(linkedOpenSetting);
  useEffect(() => {
    const on = () => setV(linkedOpenSetting());
    window.addEventListener(LINKED_OPEN_SETTING_CHANGED, on);
    return () => window.removeEventListener(LINKED_OPEN_SETTING_CHANGED, on);
  }, []);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <Segmented fill size="sm" ariaLabel="Linked presentations" value={v} onChange={x => { setLinkedOpenSetting(x); setV(x); }} options={[
        { value: 'ask', label: 'Ask', title: 'A small notice with Open (or Load it)' },
        { value: 'open', label: 'Always', title: 'Open it alongside, without leaving the page you’re on' },
        { value: 'never', label: 'Never', title: 'Say nothing' },
      ]} />
      <span style={{ color: tk.text.faint, fontSize: 11, lineHeight: 1.45 }}>When a graph you open has a linked presentation, and when a presentation you open has a linked graph. A graph with unsaved changes is never replaced without asking.</span>
    </div>
  );
}
