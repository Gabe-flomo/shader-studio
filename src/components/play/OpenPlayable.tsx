/**
 * OpenPlayable — a button on the Play page that lists everything with a Play
 * setup and opens it: your saved graphs that carry controls, layers, mappings
 * or notes, and the bundled examples flagged as playable (the Play course,
 * the Learn lessons, and the others). Both are grouped into folders that
 * open and close: saved graphs by the folders you gave them in the graph
 * browser, examples by their example folder. A search opens every folder
 * that has a match. A popover on desktop, a sheet on phones.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNodeGraphStore, SAVED_GRAPHS_CHANGED } from '../../store/useNodeGraphStore';
import { EXAMPLE_FOLDERS, EXAMPLE_INDEX } from '../../store/exampleIndex';
import { PLAY_EXAMPLE_GROUPS, PLAY_EXAMPLE_KEYS } from '../../store/playExampleIndex';
import { getMembership, loadFolders } from '../../utils/assetFolders';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import { IconButton } from '../ui/Button';
import { Field } from '../ui/Field';
import { Icon } from '../ui/Icon';
import { Popover } from '../ui/Popover';
import { Sheet } from '../ui/Sheet';
import { toast } from '../ui/toastStore';
import { CreditTag } from '../ui/Credit';
import { creditSentence, type SourceCredit } from '../../types/credit';

export interface PlayableRow { kind: 'saved' | 'example'; id: string; label: string; hint?: string; folder: string; source?: SourceCredit }
type Row = PlayableRow;
interface Section { key: string; kind: Row['kind']; folder: string; color?: string; rows: Row[] }

const OPEN_KEY = 'shader-studio:play:openFolders';
/** Which folders were left open, remembered per browser (a convenience; empty if storage is unavailable). */
function loadOpen(): Set<string> | null {
  try { const raw = localStorage.getItem(OPEN_KEY); return raw ? new Set(JSON.parse(raw) as string[]) : null; } catch { return null; }
}
function saveOpen(open: Set<string>) {
  try { localStorage.setItem(OPEN_KEY, JSON.stringify([...open])); } catch { /* not remembered */ }
}

/** Saved graphs whose stored record has a Play setup (or, with `all`, every one), read without loading them. */
function savedPlayable(names: string[], all = false): Row[] {
  const out: Row[] = [];
  for (const name of names) {
    try {
      const raw = localStorage.getItem(`shader-studio:${name}`);
      if (!raw) continue;
      const play = (JSON.parse(raw) as { play?: { controls?: unknown[]; layers?: unknown[]; mappings?: unknown[]; notes?: string } }).play;
      const c = play?.controls?.length ?? 0, l = play?.layers?.length ?? 0, m = play?.mappings?.length ?? 0;
      if (!play || (!c && !l && !m && !play.notes)) {
        if (all) out.push({ kind: 'saved', id: name, label: name, hint: 'No Play setup', folder: 'Saved graphs' });
        continue;
      }
      const parts = [c && `${c} control${c === 1 ? '' : 's'}`, l && `${l} layer${l === 1 ? '' : 's'}`, m && `${m} mapping${m === 1 ? '' : 's'}`].filter(Boolean) as string[];
      out.push({ kind: 'saved', id: name, label: name, hint: parts.join(' · ') || 'notes', folder: 'Saved graphs' });
    } catch { /* an unreadable record is simply not offered */ }
  }
  return out;
}

/** Saved rows split by the folders from the graph browser, in that order; unfiled graphs last. */
function savedSections(rows: Row[]): Section[] {
  if (!rows.length) return [];
  let folders: ReturnType<typeof loadFolders> = [], membership: Record<string, string> = {};
  try { folders = loadFolders('graphs'); membership = getMembership('graphs'); } catch { /* all unfiled */ }
  const out: Section[] = [];
  for (const f of folders) {
    const inside = rows.filter(r => membership[r.id] === f.id).map(r => ({ ...r, folder: f.label }));
    if (inside.length) out.push({ key: `saved:${f.id}`, kind: 'saved', folder: f.label, rows: inside });
  }
  const known = new Set(folders.map(f => f.id));
  const loose = rows.filter(r => !known.has(membership[r.id]));
  if (loose.length) out.push({ key: 'saved:', kind: 'saved', folder: out.length ? 'Other saved graphs' : 'Saved graphs', rows: loose });
  return out;
}

function exampleSections(all = false): Section[] {
  const sections: Section[] = [];
  const inPlayCourse = new Set(PLAY_EXAMPLE_KEYS);
  // The Play course is long, so it comes as one folder per topic.
  const folders = EXAMPLE_FOLDERS.flatMap(f => f.label === 'Play' && f.keys.every(k => inPlayCourse.has(k))
    ? PLAY_EXAMPLE_GROUPS.map(g => ({ ...f, label: `Play · ${g.label}`, keys: g.keys }))
    : [f]);
  for (const f of folders) {
    const rows = f.keys.filter(k => EXAMPLE_INDEX[k] && (all || EXAMPLE_INDEX[k].play)).map(k => ({ kind: 'example' as const, id: k, label: EXAMPLE_INDEX[k].label, hint: EXAMPLE_INDEX[k].description, folder: f.label, source: EXAMPLE_INDEX[k].source }));
    if (rows.length) sections.push({ key: `example:${f.label}`, kind: 'example', folder: f.label, color: f.color, rows });
  }
  return sections;
}

/**
 * The list itself. Picking a row opens it (loads the graph), or, with `onPick`,
 * hands the row over instead (the Present page takes a snapshot of it).
 */
export function PlayableList({ onDone, onPick, current: currentOverride, all = false }: {
  onDone: () => void;
  onPick?: (row: PlayableRow) => void;
  current?: string | null;
  /** Every saved graph and example, with a Play setup or not (the capture window renders any graph). */
  all?: boolean;
}) {
  const tk = useTokens();
  const getSavedGraphNames = useNodeGraphStore(s => s.getSavedGraphNames);
  const loadSavedGraph = useNodeGraphStore(s => s.loadSavedGraph);
  const loadExampleGraph = useNodeGraphStore(s => s.loadExampleGraph);
  const openGraph = useNodeGraphStore(s => s.currentGraph?.name ?? null);
  const current = currentOverride === undefined ? openGraph : currentOverride;
  const [names, setNames] = useState<string[]>(() => getSavedGraphNames());
  useEffect(() => {
    const onChange = () => setNames(getSavedGraphNames());
    window.addEventListener(SAVED_GRAPHS_CHANGED, onChange);
    return () => window.removeEventListener(SAVED_GRAPHS_CHANGED, onChange);
  }, [getSavedGraphNames]);
  const [q, setQ] = useState('');
  const everything = useMemo(() => [...savedSections(savedPlayable(names, all)), ...exampleSections(all)], [names, all]);
  const searching = q.trim() !== '';
  const sections = useMemo(() => {
    const w = q.trim().toLowerCase();
    if (!w) return everything;
    return everything.map(s => ({ ...s, rows: s.rows.filter(r => `${r.label} ${r.hint ?? ''} ${r.folder} ${r.source ? creditSentence(r.source) : ''}`.toLowerCase().includes(w)) })).filter(s => s.rows.length);
  }, [everything, q]);
  // Saved folders start open, example folders closed; the folder holding the open graph is always open.
  const [open, setOpen] = useState<Set<string>>(() => loadOpen() ?? new Set(everything.filter(s => s.kind === 'saved').map(s => s.key)));
  const holdsCurrent = (s: Section) => s.kind === 'saved' && s.rows.some(r => r.id === current);
  const isOpen = (s: Section) => searching || open.has(s.key) || holdsCurrent(s);
  const toggle = (s: Section) => setOpen(prev => {
    const next = new Set(prev);
    if (isOpen(s)) { next.delete(s.key); } else next.add(s.key);
    saveOpen(next);
    return next;
  });

  const pick = async (r: Row) => {
    if (onPick) { onPick(r); onDone(); return; }
    if (r.kind === 'saved') {
      const res = loadSavedGraph(r.id);
      if (!res.ok) { toast.error('Couldn’t open it', { message: res.error }); return; }
    } else {
      await loadExampleGraph(r.id);
    }
    onDone();
  };

  const caps: React.CSSProperties = { fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: tk.text.faint, padding: '10px 12px 4px' };
  const firstExample = sections.findIndex(s => s.kind === 'example');
  const hasSaved = sections.some(s => s.kind === 'saved');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, maxHeight: 'inherit' }}>
      <div style={{ padding: '8px 10px 6px', flexShrink: 0 }}>
        <Field autoFocus aria-label="Search Play setups" placeholder="Search saved graphs and examples" height={30} value={q} onChange={e => setQ(e.target.value)} leading={<Icon name="search" size={13} style={{ color: tk.text.faint }} />} onKeyDown={e => { if (e.key === 'Escape' && q) { e.stopPropagation(); setQ(''); } }} />
      </div>
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', paddingBottom: 8 }} role="listbox" aria-label="Graphs with a Play setup">
        {sections.length === 0 && <div style={{ padding: '10px 14px', fontSize: 12, color: tk.text.faint, lineHeight: 1.5 }}>{q ? `Nothing matches “${q.trim()}”.` : 'Nothing saved with a Play setup yet. Add controls or layers here and save the graph; it will show up in this list.'}</div>}
        {hasSaved && <div style={caps}>Your graphs</div>}
        {sections.map((s, i) => {
          const shown = isOpen(s);
          return (
            <div key={s.key}>
              {i === firstExample && <div style={{ ...caps, paddingTop: hasSaved ? 14 : 10 }}>Examples</div>}
              <button
                type="button" aria-expanded={shown} onClick={() => toggle(s)} disabled={searching}
                style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', textAlign: 'left', border: 0, cursor: searching ? 'default' : 'pointer', padding: '6px 10px', background: 'transparent', color: tk.text.secondary, font: `600 12.5px ${fontFamily.ui}` }}
                onMouseEnter={e => { if (!searching) e.currentTarget.style.background = alpha(tk.accent.base, 0.06); }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
              >
                <Icon name={shown ? 'chevD' : 'chevR'} size={14} style={{ color: tk.text.faint, flexShrink: 0 }} />
                <Icon name="folder" size={15} style={{ color: s.color ?? tk.accent.base, flexShrink: 0 }} />
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.folder}</span>
                <span style={{ fontSize: 11, fontWeight: 500, color: tk.text.faint }}>{s.rows.length}</span>
              </button>
              {shown && s.rows.map(r => {
                const isCurrent = r.kind === 'saved' && r.id === current;
                return (
                  <button
                    key={`${r.kind}:${r.id}`} type="button" role="option" aria-selected={isCurrent}
                    onClick={() => pick(r)}
                    style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left', border: 0, cursor: 'pointer', padding: '6px 12px 6px 30px', background: 'transparent', color: tk.text.primary, font: `500 12.5px ${fontFamily.ui}` }}
                    onMouseEnter={e => { e.currentTarget.style.background = alpha(tk.accent.base, 0.08); }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
                  >
                    <span style={{ width: 22, height: 22, borderRadius: radius.sm, flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: r.kind === 'saved' ? alpha(tk.accent.base, 0.14) : tk.bg.field, color: r.kind === 'saved' ? tk.accent.base : tk.text.muted }}>
                      <Icon name={r.kind === 'saved' ? 'save' : 'graphs'} size={13} />
                    </span>
                    <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.label}{isCurrent && <span style={{ color: tk.text.faint, fontWeight: 400 }}> · open</span>}</span>
                      {r.hint && <span style={{ fontSize: 11, fontWeight: 400, color: tk.text.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.hint}</span>}
                      {r.source && <CreditTag source={r.source} size={10.5} style={{ marginTop: 1 }} />}
                    </span>
                  </button>
                );
              })}
            </div>
          );
        })}
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
