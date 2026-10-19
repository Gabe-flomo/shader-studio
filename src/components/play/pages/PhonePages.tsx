/**
 * What a phone's Play page shows in place of the desktop's (user decisions
 * 2026-10-18; play/phoneTrim.ts says what's left out and why):
 *
 * - PhoneSizeRow: the top of the Layers page. The picture's size, Free or
 *   1:1, and nothing else (the Background is the list's pinned first row).
 * - PhoneSoundPage: the Sound tab. The Sampler (upload sounds, which readers
 *   can hear), the readers, and the effects on each sound. No Arrangement,
 *   Audio engine, Granulator, MIDI synth or tracks.
 */
import { useNodeGraphStore } from '../../../store/useNodeGraphStore';
import { useTokens } from '../../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../../theme/tokens';
import { openProSheet, useCan } from '../../../lib/plan';
import { defaultLayer, padHasSound, padsReaderInput, type SamplerLayer } from '../../../types/playLayers';
import type { PlayRecord } from '../../../types/play';
import { playId } from '../../../play/playControls';
import { readerSourceName, setReaderInput } from '../../../play/readerControls';
import { Segmented } from '../../ui/Choice';
import { Button } from '../../ui/Button';
import { Icon } from '../../ui/Icon';
import { AudioFxPanel } from '../finish/AudioFxPanel';
import { LockedFinish } from './FinishPage';
import { usePlayUi } from '../playUi';
import { showPage } from '../playSplit';
import { useReadersPanel } from '../readersPanelUi';
import { aspectChoices, desktopSoundNote, phoneAspect } from '../phoneTrim';

/** The phone's Layers top: the picture's size, Free or 1:1. */
export function PhoneSizeRow() {
  const tk = useTokens();
  const saved = useNodeGraphStore(s => s.previewAspect);
  const set = useNodeGraphStore(s => s.setPreviewAspect);
  return (
    <div data-phone-size-row="" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px 0' }}>
      <span style={{ color: tk.text.faint, font: `600 10px ${fontFamily.ui}`, letterSpacing: '0.04em', textTransform: 'uppercase' }}>Picture</span>
      <div style={{ width: 150 }}>
        <Segmented size="sm" fill ariaLabel="Picture size" value={phoneAspect(saved)} onChange={set}
          options={aspectChoices(true).map(a => ({ value: a.id, label: a.label, title: a.hint }))} />
      </div>
    </div>
  );
}

/** How many sounds a Sampler holds: its pads' and its zones'. */
export function samplerSoundCount(l: SamplerLayer): number {
  return l.pads.filter(padHasSound).length + l.zones.filter(padHasSound).length;
}

/** A Sampler added from the phone's Sound tab: readers with nothing to hear yet listen to it. */
export function addPhoneSampler(p: PlayRecord, id: string): PlayRecord {
  const n = p.layers.filter(l => l.kind === 'sampler').length + 1;
  const next: PlayRecord = { ...p, layers: [...p.layers, defaultLayer('sampler', id, `Sampler ${n}`)] };
  const readers = p.audioReaders;
  return !readers?.readers.length && !readers?.input ? setReaderInput(next, padsReaderInput(id)) : next;
}

/** The phone's Sound tab: the Sampler, the readers, the effects. */
export function PhoneSoundPage({ play, onChange }: { play: PlayRecord; onChange: (fn: (p: PlayRecord) => PlayRecord) => void }) {
  const tk = useTokens();
  const layersOk = useCan('play.layers');
  const finishOk = useCan('play.finish');
  const samplers = play.layers.filter((l): l is SamplerLayer => l.kind === 'sampler');
  const readers = play.audioReaders;
  const readerCount = readers?.readers.length ?? 0;
  const note = desktopSoundNote(play);
  const open = (id: string) => { usePlayUi.getState().reveal(id); showPage('layers'); };
  const add = () => {
    if (!layersOk) { openProSheet('play.layers'); return; }
    const id = playId('layer');
    onChange(p => addPhoneSampler(p, id));
    open(id);
  };
  const card: React.CSSProperties = { borderRadius: radius.card, background: tk.bg.panel, boxShadow: `inset 0 0 0 1px ${tk.border.default}`, overflow: 'hidden' };
  const heading = (title: string, hint: string) => (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, margin: '14px 2px 6px' }}>
      <b style={{ font: `650 13px ${fontFamily.ui}`, color: tk.text.primary }}>{title}</b>
      <span style={{ flex: 1, minWidth: 0, color: tk.text.faint, font: `11.5px ${fontFamily.ui}`, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{hint}</span>
    </div>
  );
  return (
    <div data-phone-sound="" style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '0 12px 16px' }}>
      {note && (
        <div data-phone-sound-note="" style={{ display: 'flex', gap: 8, marginTop: 10, padding: '8px 10px', borderRadius: radius.md, background: alpha(tk.accent.base, 0.08), color: tk.text.secondary, font: `11.5px/1.45 ${fontFamily.ui}` }}>
          <Icon name="info" size={14} style={{ flexShrink: 0, marginTop: 1, color: tk.text.faint }} />
          <span>{note}</span>
        </div>
      )}

      <section data-phone-sound-section="sampler">
        {heading('Sounds', 'Upload audio into a Sampler')}
        <div style={card}>
          {samplers.map((l, i) => {
            const n = samplerSoundCount(l);
            const heard = readers?.input === padsReaderInput(l.id);
            return (
              <div key={l.id} style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 52, padding: '0 6px 0 12px', borderTop: i ? `1px solid ${tk.border.subtle}` : undefined }}>
                <Icon name="pads" size={16} style={{ color: tk.text.faint, flexShrink: 0 }} />
                <button type="button" onClick={() => open(l.id)} style={{ flex: 1, minWidth: 0, minHeight: 44, border: 0, background: 'transparent', padding: 0, textAlign: 'left', cursor: 'pointer', color: tk.text.primary }}>
                  <div style={{ font: `600 13px ${fontFamily.ui}`, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.label}</div>
                  <div style={{ font: `11.5px ${fontFamily.ui}`, color: tk.text.faint }}>{n ? `${n} sound${n === 1 ? '' : 's'}` : 'No sounds yet'}{heard ? ' · readers hear it' : ''}</div>
                </button>
                {!heard && (
                  <Button size="sm" variant="ghost" onClick={() => onChange(p => setReaderInput(p, padsReaderInput(l.id)))} title="The audio readers listen to this Sampler">Readers hear it</Button>
                )}
                <Button size="sm" variant="secondary" onClick={() => open(l.id)} title="Open it to put sounds on its pads">Open</Button>
              </div>
            );
          })}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderTop: samplers.length ? `1px solid ${tk.border.subtle}` : undefined }}>
            <Button size="md" variant={samplers.length ? 'secondary' : 'primary'} icon="plus" onClick={add}>Sampler</Button>
            <span style={{ flex: 1, minWidth: 0, color: tk.text.faint, font: `11.5px/1.4 ${fontFamily.ui}` }}>
              {samplers.length ? 'Another set of pads' : 'Pads you fill with your own sounds: tap to play, and readers can listen'}
            </span>
          </div>
        </div>
      </section>

      <section data-phone-sound-section="readers">
        {heading('Readers', 'Parts of the sound that drive controls')}
        <div style={{ ...card, display: 'flex', alignItems: 'center', gap: 10, minHeight: 52, padding: '6px 6px 6px 12px' }}>
          <Icon name="wave" size={16} style={{ color: tk.text.faint, flexShrink: 0 }} />
          <span style={{ flex: 1, minWidth: 0, color: tk.text.secondary, font: `12px/1.4 ${fontFamily.ui}` }}>
            {readerCount ? `${readerCount} reader${readerCount === 1 ? '' : 's'}` : 'No readers yet'} · hear {play.audioReaders?.input ? readerSourceName(play) : 'the live input'}
          </span>
          <Button size="sm" variant={readerCount ? 'secondary' : 'primary'} icon={readerCount ? undefined : 'plus'} onClick={() => useReadersPanel.getState().show()}>{readerCount ? 'Edit' : 'Reader'}</Button>
        </div>
      </section>

      <section data-phone-sound-section="effects">
        {heading('Effects', 'Reverb, echo, filter and more')}
        {finishOk
          ? <div style={{ margin: '0 -12px' }}><AudioFxPanel play={play} onChange={onChange} touch /></div>
          : <LockedFinish play={play} />}
      </section>
    </div>
  );
}
