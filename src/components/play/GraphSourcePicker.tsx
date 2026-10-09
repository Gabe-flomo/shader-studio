/**
 * GraphSourcePicker — pick a graph to show in a Background layer: this graph,
 * one of your saved graphs (copied into the setup) or a bundled example.
 * Searchable; a popover beside its button on desktop, a sheet on phones.
 */
import { useEffect, useMemo, useState, type RefObject } from 'react';
import { useNodeGraphStore, SAVED_GRAPHS_CHANGED } from '../../store/useNodeGraphStore';
import { EXAMPLE_FOLDERS, EXAMPLE_INDEX } from '../../store/exampleIndex';
import type { BackgroundItem } from '../../types/play';
import { thisGraphSource } from '../../play/backgroundQueue';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import { Field } from '../ui/Field';
import { Icon } from '../ui/Icon';
import type { IconName } from '../ui/iconPaths';
import { Popover } from '../ui/Popover';
import { Sheet } from '../ui/Sheet';
import { toast } from '../ui/toastStore';
import { exampleGraphSource, savedGraphSource, savedVersionSource } from './backgroundFiles';
import { listVersions, seriesLabel } from '../../store/graphVersions';
import { BACKGROUND_QUEUE_MAX } from '../../types/playLayers';

interface Row { key: string; label: string; hint?: string; icon: IconName; make: () => BackgroundItem | BackgroundItem[] }
interface Group { key: string; label: string; colour?: string; rows: Row[] }

const narrowScreen = () => typeof window !== 'undefined' && !!window.matchMedia?.('(max-width: 640px)').matches;

export function GraphSourcePicker({ anchorRef, onPick, onClose, title = 'Show a graph' }: {
  anchorRef: RefObject<HTMLElement | null>;
  onPick: (item: BackgroundItem) => void;
  onClose: () => void;
  title?: string;
}) {
  const list = <GraphList onPick={item => { onPick(item); onClose(); }} />;
  return narrowScreen()
    ? <Sheet title={title} onClose={onClose} maxHeight="75dvh">{list}</Sheet>
    : (
      <Popover anchorRef={anchorRef} onClose={onClose} align="start" width={340} padding={0}>
        <div style={{ maxHeight: 'min(64vh, 520px)', display: 'flex', flexDirection: 'column' }}>{list}</div>
      </Popover>
    );
}

function GraphList({ onPick }: { onPick: (item: BackgroundItem) => void }) {
  const tk = useTokens();
  const getSavedGraphNames = useNodeGraphStore(s => s.getSavedGraphNames);
  const openName = useNodeGraphStore(s => s.currentGraph?.name ?? null);
  const [names, setNames] = useState<string[]>(() => getSavedGraphNames());
  useEffect(() => {
    const onChange = () => setNames(getSavedGraphNames());
    window.addEventListener(SAVED_GRAPHS_CHANGED, onChange);
    return () => window.removeEventListener(SAVED_GRAPHS_CHANGED, onChange);
  }, [getSavedGraphNames]);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<Set<string>>(() => new Set(['this', 'saved']));

  const groups = useMemo<Group[]>(() => {
    const out: Group[] = [{ key: 'this', label: 'This setup', rows: [{ key: 'this', label: 'This graph', hint: 'The graph open in the Studio, with its controls and mappings', icon: 'graphs', make: thisGraphSource }] }];
    const saved = [...names].sort((a, b) => a.localeCompare(b)).flatMap<Row>(n => {
      const row: Row = { key: `saved:${n}`, label: n, hint: n === openName ? 'Open now · copied as it was saved' : 'Copied into this setup', icon: 'save', make: () => savedGraphSource(n) };
      // A series (docs/graph-series-plan.md): queue its versions, to step through iterations of one idea.
      const versions = listVersions(n);
      if (versions.length < 2) return [row];
      const asSources = (vs: typeof versions) => () => [...vs].reverse().slice(-BACKGROUND_QUEUE_MAX).map(v => savedVersionSource(n, v.version, seriesLabel(v)));
      const families = [...new Set(versions.map(v => v.major))];
      const newestOfEach = families.map(m => versions.find(v => v.major === m)!);
      return [
        row,
        { key: `series:${n}`, label: `${n} · every version (${versions.length})`, hint: 'Each saved version in the queue, oldest first: step through them with Change background', icon: 'layers', make: asSources(versions) },
        ...(families.length > 1 ? [{ key: `families:${n}`, label: `${n} · newest of each family (${families.length})`, hint: 'One per family: the big ideas, side by side', icon: 'layers' as const, make: asSources(newestOfEach) }] : []),
      ];
    });
    if (saved.length) out.push({ key: 'saved', label: 'Your graphs', rows: saved });
    for (const f of EXAMPLE_FOLDERS) {
      const rows = f.keys.filter(k => EXAMPLE_INDEX[k]).map<Row>(k => ({ key: `example:${k}`, label: EXAMPLE_INDEX[k].label, hint: EXAMPLE_INDEX[k].description, icon: 'graphs', make: () => exampleGraphSource(k, EXAMPLE_INDEX[k].label) }));
      if (rows.length) out.push({ key: `ex:${f.label}`, label: `Examples · ${f.label}`, colour: f.color, rows });
    }
    return out;
  }, [names, openName]);
  const searching = q.trim() !== '';
  const shown = useMemo(() => {
    const w = q.trim().toLowerCase();
    if (!w) return groups;
    return groups.map(g => ({ ...g, rows: g.rows.filter(r => `${r.label} ${r.hint ?? ''} ${g.label}`.toLowerCase().includes(w)) })).filter(g => g.rows.length);
  }, [groups, q]);
  const pick = (r: Row) => {
    try { const made = r.make(); for (const item of Array.isArray(made) ? made : [made]) onPick(item); } catch (e) { toast.error('Couldn’t add that graph', { message: e instanceof Error ? e.message : String(e) }); }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, maxHeight: 'inherit' }}>
      <div style={{ padding: '8px 10px 6px', flexShrink: 0 }}>
        <Field autoFocus aria-label="Search graphs" placeholder="Search your graphs and examples" height={30} value={q} onChange={e => setQ(e.target.value)} leading={<Icon name="search" size={13} style={{ color: tk.text.faint }} />} onKeyDown={e => { if (e.key === 'Escape' && q) { e.stopPropagation(); setQ(''); } }} />
      </div>
      <div role="listbox" aria-label="Graphs" style={{ flex: 1, minHeight: 0, overflowY: 'auto', paddingBottom: 8 }}>
        {shown.length === 0 && <div style={{ padding: '10px 14px', color: tk.text.faint, font: `12px/1.5 ${fontFamily.ui}` }}>Nothing matches “{q.trim()}”.</div>}
        {shown.map(g => {
          const isOpen = searching || open.has(g.key);
          return (
            <div key={g.key}>
              <button
                type="button" aria-expanded={isOpen} disabled={searching}
                onClick={() => setOpen(prev => { const n = new Set(prev); if (n.has(g.key)) n.delete(g.key); else n.add(g.key); return n; })}
                style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', textAlign: 'left', border: 0, cursor: searching ? 'default' : 'pointer', padding: '6px 10px', background: 'transparent', color: tk.text.secondary, font: `600 12.5px ${fontFamily.ui}` }}
              >
                <Icon name={isOpen ? 'chevD' : 'chevR'} size={14} style={{ color: tk.text.faint, flexShrink: 0 }} />
                <Icon name="folder" size={15} style={{ color: g.colour ?? tk.accent.base, flexShrink: 0 }} />
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.label}</span>
                <span style={{ fontSize: 11, fontWeight: 500, color: tk.text.faint }}>{g.rows.length}</span>
              </button>
              {isOpen && g.rows.map(r => (
                <button
                  key={r.key} type="button" role="option" aria-selected={false} onClick={() => pick(r)}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left', border: 0, cursor: 'pointer', padding: '6px 12px 6px 30px', background: 'transparent', color: tk.text.primary, font: `500 12.5px ${fontFamily.ui}` }}
                  onMouseEnter={e => { e.currentTarget.style.background = alpha(tk.accent.base, 0.08); }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
                >
                  <span style={{ width: 22, height: 22, borderRadius: radius.sm, flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: g.key === 'this' ? alpha(tk.accent.base, 0.14) : tk.bg.field, color: g.key === 'this' ? tk.accent.base : tk.text.muted }}>
                    <Icon name={r.icon} size={13} />
                  </span>
                  <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.label}</span>
                    {r.hint && <span style={{ fontSize: 11, fontWeight: 400, color: tk.text.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.hint}</span>}
                  </span>
                </button>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
