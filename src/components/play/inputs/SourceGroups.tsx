/**
 * SourceGroups — the Inputs board's sources column by kind: the record's own
 * sources and the old mappings together under MIDI and OSC, Keys, mouse and
 * gamepad, Audio… (mappingGroups.ts groupSourceItems), each heading folding
 * its cards away and saying how many it holds, with a search over names and
 * what each reads once there are enough cards to look for one. Folds and the
 * search are UI state only.
 */
import { useState, type CSSProperties, type ReactNode } from 'react';
import { useTokens } from '../../../theme/themeStore';
import { fontFamily } from '../../../theme/tokens';
import { Field } from '../../ui/Field';
import { Icon } from '../../ui/Icon';
import { IconButton } from '../../ui/Button';
import { groupSourceItems, type MappingGroupId, type SourceItem } from '../mappingGroups';
import type { PlayMapping, PlaySourceDef } from '../../../types/play';

/** Fewer cards than this and a search box is more clutter than help. */
const SEARCH_FROM = 4;

export function SourceGroups({ sources, mappings, words, gridStyle, renderItem }: {
  sources: readonly PlaySourceDef[];
  mappings: readonly PlayMapping[];
  /** What the search looks in for a card: its name, what it reads, what it drives. */
  words: (item: SourceItem) => ReadonlyArray<string | undefined>;
  gridStyle?: CSSProperties;
  renderItem: (item: SourceItem) => ReactNode;
}) {
  const tk = useTokens();
  const [query, setQuery] = useState('');
  const [folded, setFolded] = useState<ReadonlySet<MappingGroupId>>(() => new Set());
  const total = sources.length + mappings.length;
  if (!total) return null;
  const groups = groupSourceItems(sources, mappings, words, query);
  const fold = (id: MappingGroupId) => setFolded(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  return (
    <div data-source-groups="">
      {(total >= SEARCH_FROM || query) && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '4px 0 2px' }}>
          <Field height={28} leading={<Icon name="search" size={13} />} value={query} placeholder="Search sources" aria-label="Search sources"
            onChange={e => setQuery(e.target.value)} onKeyDown={e => { if (e.key === 'Escape' && query) { e.stopPropagation(); setQuery(''); } }} style={{ flex: 1, minWidth: 0 }} />
          {query && <IconButton icon="close" label="Clear the search" size="sm" onClick={() => setQuery('')} />}
        </div>
      )}
      {!groups.length && <div style={{ padding: '10px 2px', color: tk.text.faint, font: `12px ${fontFamily.ui}` }}>No source matches “{query.trim()}”.</div>}
      {groups.map(g => {
        const open = !folded.has(g.id) || !!query.trim();
        return (
          <section key={g.id} data-source-group={g.id}>
            <button type="button" aria-expanded={open} onClick={() => fold(g.id)}
              title={open ? 'Fold this group away' : 'Show this group'}
              style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', margin: '10px 0 0', padding: '2px 0', border: 0, background: 'none', cursor: 'pointer', color: tk.text.faint, font: `600 10px ${fontFamily.ui}`, letterSpacing: '0.04em', textTransform: 'uppercase', textAlign: 'left' }}>
              <Icon name={open ? 'chevD' : 'chevR'} size={11} />
              <span style={{ flex: 1, minWidth: 0 }}>{g.label}</span>
              <span style={{ fontVariantNumeric: 'tabular-nums' }}>{g.items.length}</span>
            </button>
            {open && <div style={gridStyle}>{g.items.map(renderItem)}</div>}
          </section>
        );
      })}
    </div>
  );
}
