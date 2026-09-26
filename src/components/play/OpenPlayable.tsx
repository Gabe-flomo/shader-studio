/**
 * OpenPlayable — a button on the Play page that lists everything with a Play
 * setup and opens it: your saved graphs that carry controls, layers, mappings
 * or notes, and the bundled examples flagged as playable (the Play course,
 * the Learn lessons, and the others). A popover on desktop, a sheet on
 * phones; one search box over both lists.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNodeGraphStore, SAVED_GRAPHS_CHANGED } from '../../store/useNodeGraphStore';
import { EXAMPLE_FOLDERS, EXAMPLE_INDEX } from '../../store/exampleIndex';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import { IconButton } from '../ui/Button';
import { Field } from '../ui/Field';
import { Icon } from '../ui/Icon';
import { Popover } from '../ui/Popover';
import { Sheet } from '../ui/Sheet';
import { toast } from '../ui/toastStore';

interface Row { kind: 'saved' | 'example'; id: string; label: string; hint?: string; folder: string }

/** Saved graphs whose stored record has a Play setup, read without loading them. */
function savedPlayable(names: string[]): Row[] {
  const out: Row[] = [];
  for (const name of names) {
    try {
      const raw = localStorage.getItem(`shader-studio:${name}`);
      if (!raw) continue;
      const play = (JSON.parse(raw) as { play?: { controls?: unknown[]; layers?: unknown[]; mappings?: unknown[]; notes?: string } }).play;
      if (!play) continue;
      const c = play.controls?.length ?? 0, l = play.layers?.length ?? 0, m = play.mappings?.length ?? 0;
      if (!c && !l && !m && !play.notes) continue;
      const parts = [c && `${c} control${c === 1 ? '' : 's'}`, l && `${l} layer${l === 1 ? '' : 's'}`, m && `${m} mapping${m === 1 ? '' : 's'}`].filter(Boolean) as string[];
      out.push({ kind: 'saved', id: name, label: name, hint: parts.join(' · ') || 'notes', folder: 'Saved graphs' });
    } catch { /* an unreadable record is simply not offered */ }
  }
  return out;
}

function examplePlayable(): Array<{ folder: string; rows: Row[] }> {
  const sections: Array<{ folder: string; rows: Row[] }> = [];
  for (const f of EXAMPLE_FOLDERS) {
    const rows = f.keys.filter(k => EXAMPLE_INDEX[k]?.play).map(k => ({ kind: 'example' as const, id: k, label: EXAMPLE_INDEX[k].label, hint: EXAMPLE_INDEX[k].description, folder: f.label }));
    if (rows.length) sections.push({ folder: f.label, rows });
  }
  return sections;
}

function PlayableList({ onDone }: { onDone: () => void }) {
  const tk = useTokens();
  const getSavedGraphNames = useNodeGraphStore(s => s.getSavedGraphNames);
  const loadSavedGraph = useNodeGraphStore(s => s.loadSavedGraph);
  const loadExampleGraph = useNodeGraphStore(s => s.loadExampleGraph);
  const current = useNodeGraphStore(s => s.currentGraph?.name ?? null);
  const [names, setNames] = useState<string[]>(() => getSavedGraphNames());
  useEffect(() => {
    const onChange = () => setNames(getSavedGraphNames());
    window.addEventListener(SAVED_GRAPHS_CHANGED, onChange);
    return () => window.removeEventListener(SAVED_GRAPHS_CHANGED, onChange);
  }, [getSavedGraphNames]);
  const [q, setQ] = useState('');
  const sections = useMemo(() => {
    const saved = savedPlayable(names);
    const all = [...(saved.length ? [{ folder: 'Saved graphs', rows: saved }] : []), ...examplePlayable()];
    const w = q.trim().toLowerCase();
    if (!w) return all;
    return all.map(s => ({ ...s, rows: s.rows.filter(r => `${r.label} ${r.hint ?? ''} ${r.folder}`.toLowerCase().includes(w)) })).filter(s => s.rows.length);
  }, [names, q]);

  const pick = async (r: Row) => {
    if (r.kind === 'saved') {
      const res = loadSavedGraph(r.id);
      if (!res.ok) { toast.error('Couldn’t open it', { message: res.error }); return; }
    } else {
      await loadExampleGraph(r.id);
    }
    onDone();
  };

  const caps: React.CSSProperties = { fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: tk.text.faint, padding: '10px 12px 4px' };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, maxHeight: 'inherit' }}>
      <div style={{ padding: '8px 10px 6px', flexShrink: 0 }}>
        <Field autoFocus aria-label="Search Play setups" placeholder="Search saved graphs and examples" height={30} value={q} onChange={e => setQ(e.target.value)} leading={<Icon name="search" size={13} style={{ color: tk.text.faint }} />} onKeyDown={e => { if (e.key === 'Escape' && q) { e.stopPropagation(); setQ(''); } }} />
      </div>
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', paddingBottom: 8 }} role="listbox" aria-label="Graphs with a Play setup">
        {sections.length === 0 && <div style={{ padding: '10px 14px', fontSize: 12, color: tk.text.faint, lineHeight: 1.5 }}>{q ? `Nothing matches “${q.trim()}”.` : 'Nothing saved with a Play setup yet. Add controls or layers here and save the graph; it will show up in this list.'}</div>}
        {sections.map(s => (
          <div key={s.folder}>
            <div style={caps}>{s.folder}{s.folder === 'Saved graphs' ? '' : ' · examples'}</div>
            {s.rows.map(r => {
              const isCurrent = r.kind === 'saved' && r.id === current;
              return (
                <button
                  key={`${r.kind}:${r.id}`} type="button" role="option" aria-selected={isCurrent}
                  onClick={() => pick(r)}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left', border: 0, cursor: 'pointer', padding: '6px 12px', background: 'transparent', color: tk.text.primary, font: `500 12.5px ${fontFamily.ui}` }}
                  onMouseEnter={e => { e.currentTarget.style.background = alpha(tk.accent.base, 0.08); }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
                >
                  <span style={{ width: 22, height: 22, borderRadius: radius.sm, flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: r.kind === 'saved' ? alpha(tk.accent.base, 0.14) : tk.bg.field, color: r.kind === 'saved' ? tk.accent.base : tk.text.muted }}>
                    <Icon name={r.kind === 'saved' ? 'save' : 'graphs'} size={13} />
                  </span>
                  <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.label}{isCurrent && <span style={{ color: tk.text.faint, fontWeight: 400 }}> · open</span>}</span>
                    {r.hint && <span style={{ fontSize: 11, fontWeight: 400, color: tk.text.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.hint}</span>}
                  </span>
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

/** The button that opens the list: a popover beside it on desktop, a sheet on phones. */
export function OpenPlayableButton({ compact = false }: { compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLSpanElement>(null);
  return (
    <span ref={anchor} style={{ display: 'inline-flex' }}>
      <IconButton icon="folder" label="Open a saved graph or example that has a Play setup" active={open} tooltip={!open} onClick={() => setOpen(o => !o)} />
      {open && (compact ? (
        <Sheet title="Open a Play setup" onClose={() => setOpen(false)} maxHeight="75dvh">
          <PlayableList onDone={() => setOpen(false)} />
        </Sheet>
      ) : (
        <Popover anchorRef={anchor} onClose={() => setOpen(false)} align="end" width={360} padding={0}>
          <div style={{ maxHeight: 'min(70vh, 560px)', display: 'flex', flexDirection: 'column' }}>
            <PlayableList onDone={() => setOpen(false)} />
          </div>
        </Popover>
      ))}
    </span>
  );
}
