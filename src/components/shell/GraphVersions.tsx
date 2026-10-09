/**
 * GraphVersions — saving a graph as a project with versions.
 *
 * SaveGraphForm (docs/graph-series-plan.md): a saved graph is a series numbered major.minor. With
 * one open, Minor (the default) saves the next tweak in its family, Major starts a new family,
 * Save in place replaces the open version, New graph saves under another name. With nothing open
 * it asks for a name: a new name starts at 1.0, an existing one gets a new family.
 *
 * VersionsButton: a saved graph's versions, newest first; any of them opens,
 * and saving an older one makes it the newest again.
 */
import { useRef, useState } from 'react';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { listVersions, nextNumber, seriesLabel, whenSaved, type SaveKind } from '../../store/graphVersions';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import { Button } from '../ui/Button';
import { Field } from '../ui/Field';
import { Popover } from '../ui/Popover';
import { reportFileResult } from './reportFileResult';
import { GraphPresentationLink } from './GraphLinks';

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

  const save = async (target: string, kind: SaveKind, what: string) => {
    if (!reportFileResult(await saveGraph(target, note, kind), { failTitle: `Couldn’t save “${target}”`, success: what })) return;
    setNote(''); setName('');
    onDone?.();
  };
  const noteField = (enter: () => void) => (
    <Field
      value={note}
      onChange={e => setNote(e.target.value)}
      onKeyDown={e => { if (e.key === 'Enter') enter(); }}
      placeholder="What changed? (optional)"
      height={30}
      style={{ width: '100%' }}
    />
  );
  const explain = (
    <span style={{ color: tk.text.faint, fontSize: 11.5, lineHeight: 1.45 }}>
      A graph is a series of versions: <b>Minor</b> for a tweak (2.3 → 2.4), <b>Major</b> for a new direction (→ 3.0), <b>New graph</b> for a different idea.
    </span>
  );

  if (current && !asNew) {
    const base = { major: current.major, minor: current.minor };
    const minor = nextNumber(current.name, 'minor', base);
    const major = nextNumber(current.name, 'major', base);
    const saveMinor = () => save(current.name, 'minor', `Saved “${current.name}” ${seriesLabel(minor)}`);
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, minWidth: 0 }}>
          <b style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{current.name}</b>
          <span style={{ color: tk.text.faint, font: `500 11px ${fontFamily.mono}`, flexShrink: 0 }}>{seriesLabel(base)}{current.latest ? '' : ' (older)'}</span>
          <span style={{ flex: 1 }} />
          <span style={{ color: dirty ? tk.status.warningText : tk.text.faint, fontSize: 11, flexShrink: 0 }}>{dirty ? 'Unsaved changes' : 'Saved'}</span>
        </div>
        {noteField(() => { void saveMinor(); })}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
          <Button size="sm" variant="primary" icon="save" autoFocus onClick={saveMinor} title="A tweak: the next number in this family">
            Minor → {seriesLabel(minor)}
          </Button>
          <Button size="sm" onClick={() => save(current.name, 'major', `Saved “${current.name}” ${seriesLabel(major)}, a new family`)} title="A new direction: a new family in this series">
            Major → {seriesLabel(major)}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => save(current.name, 'inPlace', `Saved over “${current.name}” ${seriesLabel(base)}`)} title="Replace this version: its number stays">
            Save in place ({seriesLabel(base)})
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setAsNew(true)} title="Save under another name: a new series, or a new family of a series with that name">
            New graph…
          </Button>
        </div>
        {explain}
        <GraphPresentationLink graph={current.name} onNavigated={onDone} />
      </div>
    );
  }
  const family = exists ? nextNumber(n, 'new', null) : null;
  const saveNamed = () => { if (n) void save(n, 'new', family ? `Saved “${n}” ${seriesLabel(family)}, a new family` : `Saved “${n}” 1.0`); };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', gap: 6 }}>
        <Field
          autoFocus
          placeholder="Graph name"
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') saveNamed(); if (e.key === 'Escape') onDone?.(); }}
          height={30}
          style={{ flex: 1 }}
        />
        <Button size="sm" variant="primary" disabled={!n} onClick={saveNamed}>{family ? `Add ${seriesLabel(family)}` : 'Save 1.0'}</Button>
      </div>
      {family && <span style={{ color: tk.text.faint, fontSize: 11.5, lineHeight: 1.4 }}>“{n}” is a series already: this adds a new family to it ({seriesLabel(family)}); its other versions stay.</span>}
      {noteField(saveNamed)}
      {explain}
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
  const newest = versions[0] ? seriesLabel(versions[0]) : '1.0';
  return (
    <span ref={anchor} style={{ display: 'inline-flex', flexShrink: 0 }} onClick={e => e.stopPropagation()}>
      <button
        type="button"
        title={`${versions.length} versions in ${new Set(versions.map(v => v.major)).size} famil${new Set(versions.map(v => v.major)).size === 1 ? 'y' : 'ies'}: open one`}
        onClick={() => setOpen(o => !o)}
        style={{ height: 18, padding: '0 6px', borderRadius: 5, border: 0, cursor: 'pointer', background: open ? alpha(tk.accent.base, 0.18) : tk.bg.field, color: tk.text.muted, font: `600 10px ${fontFamily.mono}` }}
      >{newest}</button>
      {open && (
        <Popover anchorRef={anchor} onClose={() => setOpen(false)} align="end" width={300} padding={6}>
          <div style={{ padding: '4px 6px 6px', color: tk.text.faint, fontSize: 11.5 }}>The “{name}” series, by family (major) and tweak (minor). Open one to look at it or carry on from it; Minor then adds the next tweak in its family.</div>
          <div style={{ maxHeight: 320, overflowY: 'auto' }}>
            {versions.map((v, i) => {
              const here = current?.name === name && current.version === v.version;
              const familyStart = i === 0 || versions[i - 1].major !== v.major;
              return (<div key={v.version}>
                {familyStart && <div style={{ padding: '8px 8px 2px', color: tk.text.faint, font: `700 10px ${fontFamily.ui}`, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Family {v.major}</div>}
                <button
                  type="button"
                  onClick={() => { if (reportFileResult(loadGraphVersion(name, v.current ? 0 : v.version), { failTitle: `Couldn’t open ${seriesLabel(v)} of “${name}”` })) { setOpen(false); onOpened?.(); } }}
                  onMouseEnter={e => ((e.currentTarget as HTMLButtonElement).style.background = tk.bg.hover)}
                  onMouseLeave={e => ((e.currentTarget as HTMLButtonElement).style.background = here ? tk.bg.selected : 'none')}
                  style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 2, padding: '6px 8px', border: 0, borderRadius: radius.md, cursor: 'pointer', textAlign: 'left', background: here ? tk.bg.selected : 'none', color: tk.text.primary, font: `12.5px ${fontFamily.ui}` }}
                >
                  <span style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                    <b style={{ font: `600 12px ${fontFamily.mono}` }}>{seriesLabel(v)}</b>
                    {v.current && <span style={{ color: tk.accent.text, fontSize: 11 }}>newest</span>}
                    {here && <span style={{ color: tk.text.faint, fontSize: 11 }}>open</span>}
                    <span style={{ flex: 1 }} />
                    <span style={{ color: tk.text.faint, fontSize: 11 }}>{whenSaved(v.savedAt)}</span>
                  </span>
                  {v.note && <span style={{ color: tk.text.secondary, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.note}</span>}
                </button>
              </div>);
            })}
          </div>
        </Popover>
      )}
    </span>
  );
}
