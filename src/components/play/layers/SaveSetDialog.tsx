/**
 * SaveSetDialog — "Save as a set…" on the Layers list (docs/presets.md): a
 * name, an optional note and a poster of the picture as it is, then what the
 * set holds (layers, controls, mappings, actions…), the videos and sounds its
 * layers name (linked-folder ones stay links), and what touches the layers
 * but stays out ("Not included: mapping Lows → Radius (Radius isn't in the
 * set)").
 */
import { useEffect, useMemo, useState } from 'react';
import { useTokens } from '../../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../../theme/tokens';
import { Button } from '../../ui/Button';
import { Field } from '../../ui/Field';
import { Icon } from '../../ui/Icon';
import { Modal } from '../../ui/Modal';
import type { PlayRecord } from '../../../types/play';
import { captureLayerSet, layerSetNamed, saveLayerSet, setSummary } from '../../../play/layerSets';
import { capturePlayPoster } from '../presetsUi';
import { reportFileResult } from '../../shell/reportFileResult';
import { toast } from '../../ui/toastStore';

export function SaveSetDialog({ play, layerIds, onClose }: { play: PlayRecord; layerIds: string[]; onClose: (saved: boolean) => void }) {
  const tk = useTokens();
  const cap = useMemo(() => captureLayerSet(play, layerIds), [play, layerIds]);
  const first = cap.play.layers[0]?.label ?? 'Layers';
  const [name, setName] = useState(cap.play.layers.length === 1 ? first : `${first} set`);
  const [note, setNote] = useState('');
  const [poster, setPoster] = useState<string | undefined | null>(null);
  const [withPoster, setWithPoster] = useState(true);
  useEffect(() => { let live = true; void capturePlayPoster().then(p => { if (live) setPoster(p); }); return () => { live = false; }; }, []);
  const ok = !!name.trim() && cap.play.layers.length > 0;
  const clash = !!name.trim() && !!layerSetNamed(name);
  const save = () => {
    if (!ok) return;
    const { result } = saveLayerSet(name, cap, { ...(note.trim() ? { note } : {}), ...(withPoster && poster ? { poster } : {}) });
    if (!reportFileResult(result, { failTitle: 'Couldn’t save the set' })) return;
    toast.success(`Saved the set “${name.trim()}”`, { message: 'Add it from Add layer → Layer sets, in this setup or any other. It’s in Files → Presets → Layer sets too.' });
    onClose(true);
  };
  const label = (t: string) => <span style={{ font: `600 10.5px ${fontFamily.ui}`, letterSpacing: '0.06em', textTransform: 'uppercase', color: tk.text.faint }}>{t}</span>;
  const listStyle = { margin: 0, padding: '0 0 0 16px', display: 'flex', flexDirection: 'column' as const, gap: 3, font: `12px/1.45 ${fontFamily.ui}`, color: tk.text.secondary };

  return (
    <Modal title="Save as a set" subtitle={setSummary(cap.play)} icon="layers" width={520} onClose={() => onClose(false)}
      footer={<>
        <span style={{ flex: 1 }} />
        <Button variant="ghost" onClick={() => onClose(false)}>Cancel</Button>
        <Button variant="primary" icon="save" disabled={!ok} onClick={save}>{clash ? 'Replace the set' : 'Save the set'}</Button>
      </>}>
      <div style={{ padding: '14px 20px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 220px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {label('Name')}
              <Field autoFocus aria-label="Set name" value={name} maxLength={60} onChange={e => setName(e.target.value)}
                onFocus={e => e.currentTarget.select()} onKeyDown={e => { if (e.key === 'Enter') save(); }} />
              {clash && <span style={{ fontSize: 11.5, lineHeight: 1.4, color: tk.status.warningText }}>You have a set called “{name.trim()}”: saving replaces it.</span>}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {label('Note (optional)')}
              <textarea aria-label="Note" value={note} maxLength={2000} rows={3} placeholder="What it does, what to try" onChange={e => setNote(e.target.value)}
                style={{ resize: 'vertical', minHeight: 56, padding: '8px 10px', border: 0, borderRadius: radius.control, background: tk.bg.field, color: tk.text.primary, font: `12.5px/1.45 ${fontFamily.ui}`, outline: 'none' }} />
            </div>
          </div>
          <div style={{ flex: '0 0 176px', display: 'flex', flexDirection: 'column', gap: 5 }}>
            {label('Poster')}
            <div style={{ width: 176, aspectRatio: '16 / 9', borderRadius: radius.md, overflow: 'hidden', background: tk.bg.field, display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: withPoster ? 1 : 0.35 }}>
              {poster ? <img src={poster} alt="The picture now" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                : <span style={{ fontSize: 11, color: tk.text.faint, padding: 8, textAlign: 'center' }}>{poster === null ? 'Taking the picture…' : 'No picture yet'}</span>}
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: tk.text.muted, cursor: 'pointer' }}>
              <input type="checkbox" checked={withPoster} onChange={e => setWithPoster(e.target.checked)} /> The picture now
            </label>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          {label('In the set')}
          <ul style={listStyle}>
            <li>{cap.play.layers.map(l => l.label).join(', ')}</li>
            {cap.play.controls.length > 0 && <li>Controls: {cap.play.controls.map(c => c.label).join(', ')}</li>}
            {(cap.play.mappings.length + (cap.play.actions?.length ?? 0) + (cap.play.signals?.length ?? 0)) > 0 && (
              <li>{[cap.play.mappings.length && `${cap.play.mappings.length} mapping${cap.play.mappings.length === 1 ? '' : 's'}`, cap.play.actions?.length && `${cap.play.actions.length} action${cap.play.actions.length === 1 ? '' : 's'}`, cap.play.signals?.length && `signals ${cap.play.signals.map(s => `“${s.name}”`).join(', ')}`].filter(Boolean).join(' · ')}</li>
            )}
            {cap.play.audioReaders && <li>{cap.play.audioReaders.readers.length} audio reader{cap.play.audioReaders.readers.length === 1 ? '' : 's'} on a set layer’s sound</li>}
            {cap.backgroundMatte && <li>The Background’s matte</li>}
            {cap.media.map(m => <li key={m.id}>{m.kind === 'video' ? 'Video' : m.kind === 'font' ? 'Font' : 'Sound'} “{m.name}”{m.linked ? ' (a linked-folder file: kept as a link)' : ' (from the library; a .playfile export takes it along)'}</li>)}
          </ul>
        </div>

        {cap.excluded.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5, padding: '9px 12px', borderRadius: radius.md, background: alpha(tk.status.warning, 0.1) }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6, font: `600 12px ${fontFamily.ui}`, color: tk.status.warningText }}><Icon name="info" size={14} />Not included: it names something outside the set</span>
            <ul style={{ ...listStyle, color: tk.text.secondary }}>{cap.excluded.map(x => <li key={x}>{x}</li>)}</ul>
          </div>
        )}
      </div>
    </Modal>
  );
}
