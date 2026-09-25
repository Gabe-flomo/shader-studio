/**
 * GraphVersions — saving a graph as a project with versions.
 *
 * SaveGraphForm: with a saved graph open, the main button saves its next
 * version (with an optional note on what changed); "Save as a new graph"
 * starts another project. With nothing open (an example, an import, a new
 * graph) it asks for a name; a name that already exists adds a version to
 * that project rather than replacing it.
 *
 * VersionsButton: a saved graph's versions, newest first; any of them opens,
 * and saving an older one makes it the newest again.
 */
import { useRef, useState } from 'react';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { listVersions, whenSaved } from '../../store/graphVersions';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import { Button } from '../ui/Button';
import { Field } from '../ui/Field';
import { Popover } from '../ui/Popover';
import { reportFileResult } from './reportFileResult';

export function SaveGraphForm({ onDone }: { onDone?: () => void }) {
  const tk = useTokens();
  const saveGraph = useNodeGraphStore(s => s.saveGraph);
  const current = useNodeGraphStore(s => s.currentGraph);
  const dirty = useNodeGraphStore(s => s.graphDirty);
  const getSavedGraphNames = useNodeGraphStore(s => s.getSavedGraphNames);
  const [note, setNote] = useState('');
  const [asNew, setAsNew] = useState(!current);
  const [name, setName] = useState('');
  const n = name.trim();
  const exists = !!n && getSavedGraphNames().includes(n);

  const save = async (target: string, what: string) => {
    if (!reportFileResult(await saveGraph(target, note), { failTitle: `Couldn’t save “${target}”`, success: what })) return;
    setNote(''); setName('');
    onDone?.();
  };
  const noteField = (
    <Field
      value={note}
      onChange={e => setNote(e.target.value)}
      onKeyDown={e => { if (e.key === 'Enter') { if (current && !asNew) void save(current.name, `Saved “${current.name}” v${current.version + 1}`); else if (n) void save(n, `Saved “${n}”`); } }}
      placeholder="What changed? (optional)"
      height={30}
      style={{ width: '100%' }}
    />
  );

  if (current && !asNew) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, minWidth: 0 }}>
          <b style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{current.name}</b>
          <span style={{ color: tk.text.faint, font: `500 11px ${fontFamily.mono}`, flexShrink: 0 }}>v{current.version}{current.latest ? '' : ' (older)'}</span>
          <span style={{ flex: 1 }} />
          <span style={{ color: dirty ? tk.status.warningText : tk.text.faint, fontSize: 11, flexShrink: 0 }}>{dirty ? 'Unsaved changes' : 'Saved'}</span>
        </div>
        {noteField}
        <Button size="sm" variant="primary" icon="save" autoFocus onClick={() => save(current.name, `Saved “${current.name}” as a new version`)}>
          {current.latest ? 'Save new version' : `Save as newest version (restores v${current.version})`}
        </Button>
        <button type="button" onClick={() => setAsNew(true)} style={{ border: 0, background: 'none', padding: 0, cursor: 'pointer', color: tk.accent.text, font: `500 12px ${fontFamily.ui}`, alignSelf: 'flex-start' }}>
          Save as a new graph instead…
        </button>
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', gap: 6 }}>
        <Field
          autoFocus
          placeholder="Graph name"
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && n) void save(n, exists ? `Saved a new version of “${n}”` : `Saved “${n}”`); if (e.key === 'Escape') onDone?.(); }}
          height={30}
          style={{ flex: 1 }}
        />
        <Button size="sm" variant="primary" disabled={!n} onClick={() => save(n, exists ? `Saved a new version of “${n}”` : `Saved “${n}”`)}>Save</Button>
      </div>
      {exists && <span style={{ color: tk.text.faint, fontSize: 11.5, lineHeight: 1.4 }}>“{n}” exists: this saves a new version of it (the old one stays in its versions).</span>}
      {noteField}
      {current && (
        <button type="button" onClick={() => setAsNew(false)} style={{ border: 0, background: 'none', padding: 0, cursor: 'pointer', color: tk.accent.text, font: `500 12px ${fontFamily.ui}`, alignSelf: 'flex-start' }}>
          ← Back to saving “{current.name}”
        </button>
      )}
    </div>
  );
}

/** A saved graph's version count, which opens its versions. Shows nothing for a graph with one version. */
export function VersionsButton({ name, onOpened, always = false }: { name: string; onOpened?: () => void; always?: boolean }) {
  const tk = useTokens();
  const loadGraphVersion = useNodeGraphStore(s => s.loadGraphVersion);
  const current = useNodeGraphStore(s => s.currentGraph);
  const anchor = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const versions = listVersions(name);
  if (versions.length < 2 && !always) return null;
  const newest = versions[0]?.version ?? 1;
  return (
    <span ref={anchor} style={{ display: 'inline-flex', flexShrink: 0 }} onClick={e => e.stopPropagation()}>
      <button
        type="button"
        title={`${versions.length} versions: open an earlier one`}
        onClick={() => setOpen(o => !o)}
        style={{ height: 18, padding: '0 6px', borderRadius: 5, border: 0, cursor: 'pointer', background: open ? alpha(tk.accent.base, 0.18) : tk.bg.field, color: tk.text.muted, font: `600 10px ${fontFamily.mono}` }}
      >v{newest}</button>
      {open && (
        <Popover anchorRef={anchor} onClose={() => setOpen(false)} align="end" width={300} padding={6}>
          <div style={{ padding: '4px 6px 6px', color: tk.text.faint, fontSize: 11.5 }}>Versions of “{name}”. Open one to look at it or carry on from it; saving it makes it the newest.</div>
          <div style={{ maxHeight: 320, overflowY: 'auto' }}>
            {versions.map(v => {
              const here = current?.name === name && current.version === v.version;
              return (
                <button
                  key={v.version}
                  type="button"
                  onClick={() => { if (reportFileResult(loadGraphVersion(name, v.current ? 0 : v.version), { failTitle: `Couldn’t open v${v.version} of “${name}”` })) { setOpen(false); onOpened?.(); } }}
                  onMouseEnter={e => ((e.currentTarget as HTMLButtonElement).style.background = tk.bg.hover)}
                  onMouseLeave={e => ((e.currentTarget as HTMLButtonElement).style.background = here ? tk.bg.selected : 'none')}
                  style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 2, padding: '6px 8px', border: 0, borderRadius: radius.md, cursor: 'pointer', textAlign: 'left', background: here ? tk.bg.selected : 'none', color: tk.text.primary, font: `12.5px ${fontFamily.ui}` }}
                >
                  <span style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                    <b style={{ font: `600 12px ${fontFamily.mono}` }}>v{v.version}</b>
                    {v.current && <span style={{ color: tk.accent.text, fontSize: 11 }}>newest</span>}
                    {here && <span style={{ color: tk.text.faint, fontSize: 11 }}>open</span>}
                    <span style={{ flex: 1 }} />
                    <span style={{ color: tk.text.faint, fontSize: 11 }}>{whenSaved(v.savedAt)}</span>
                  </span>
                  {v.note && <span style={{ color: tk.text.secondary, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.note}</span>}
                </button>
              );
            })}
          </div>
        </Popover>
      )}
    </span>
  );
}
