/**
 * LinkedGraphs — the settings panel's "Linked graphs": the saved graphs this
 * presentation goes with (present/links.ts). Load one into the Studio, add or
 * remove a link, or link every graph its Plays were copied from.
 */
import { useRef, useState } from 'react';
import { useTokens } from '../../theme/themeStore';
import { fontFamily, radius } from '../../theme/tokens';
import { Button, IconButton } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { Menu, type MenuItem } from '../ui/Menu';
import { toast } from '../ui/toastStore';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { link, unlink } from '../../present/links';
import { usePresentationLinks } from '../shell/linkHooks';
import { Section } from './InspectorParts';
import { usePresentation } from './presentationStore';
import { graphsUsedHere, loadLinkedGraph } from './linkActions';

export function LinkedGraphsSection() {
  const tk = useTokens();
  const name = usePresentation(s => s.name);
  // The sources decide what "used here" offers; re-read when they change.
  usePresentation(s => s.doc?.sources);
  const linked = usePresentationLinks(name);
  const current = useNodeGraphStore(s => s.currentGraph?.name ?? null);
  const anchor = useRef<HTMLSpanElement>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  if (!name) return null;
  const used = graphsUsedHere().filter(g => !linked.includes(g));
  const saved = menu ? useNodeGraphStore.getState().getSavedGraphNames().filter(g => !linked.includes(g)) : [];
  const items: MenuItem[] = saved.length
    ? saved.slice(0, 60).map(g => ({ label: g, icon: 'graphs' as const, onSelect: () => { if (!link(g, name)) toast.error('Couldn’t link it', { message: 'That graph isn’t saved here any more.' }); } }))
    : [{ label: 'No other saved graphs', disabled: true, onSelect: () => {} }];
  const linkUsed = () => {
    let n = 0;
    for (const g of used) if (link(g, name)) n++;
    if (n) toast.success(n === 1 ? `Linked “${used[0]}”` : `Linked ${n} graphs`);
  };
  return (
    <Section title="Linked graphs" extra={
      <span ref={anchor} style={{ display: 'inline-flex' }}>
        <Button size="sm" variant="ghost" icon="link" onClick={() => { const r = anchor.current?.getBoundingClientRect(); setMenu(menu ? null : r ? { x: Math.max(8, r.right - 260), y: r.bottom + 4 } : null); }}>Link…</Button>
      </span>
    }>
      {linked.length === 0 && (
        <div style={{ color: tk.text.muted, font: `500 12px/1.5 ${fontFamily.ui}` }}>
          None. A linked graph is offered when this presentation opens (and this presentation when the graph loads). Both stay independent.
        </div>
      )}
      {linked.map(g => (
        <div key={g} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 6px 6px 10px', borderRadius: radius.lg, background: tk.bg.panel, boxShadow: `inset 0 0 0 1px ${tk.border.default}` }}>
          <Icon name="link" size={13} style={{ color: tk.accent.text, flexShrink: 0 }} />
          <span title={g} style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: tk.text.primary, font: `600 12.5px ${fontFamily.ui}` }}>
            {g}{current === g && <span style={{ color: tk.text.faint, fontWeight: 500 }}> · open</span>}
          </span>
          <Button size="sm" variant="ghost" disabled={current === g} onClick={() => void loadLinkedGraph(g)} title="Make it the open graph in the Studio and on Play (asks first if that would replace unsaved changes)">Load</Button>
          <IconButton size="sm" icon="unlink" label="Unlink (both stay)" onClick={() => { unlink(g, name); toast.info(`Unlinked “${g}”`, { action: { label: 'Undo', onClick: () => { link(g, name); } } }); }} />
        </div>
      ))}
      {used.length > 0 && (
        <Button size="sm" icon="link" onClick={linkUsed} style={{ alignSelf: 'flex-start' }} title={used.map(g => `“${g}”`).join(', ')}>
          {used.length === 1 ? `Link “${used[0]}”, used here` : `Link the ${used.length} graphs used here`}
        </Button>
      )}
      {menu && <Menu x={menu.x} y={menu.y} minWidth={260} title="Link a saved graph" items={items} onClose={() => setMenu(null)} />}
    </Section>
  );
}
