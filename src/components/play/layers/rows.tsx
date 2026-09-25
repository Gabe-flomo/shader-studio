/**
 * rows.tsx — editor rows with state of their own: the font row (preset or a
 * web font from a link) and an audio layer's input (live, or a song file).
 */
import { useRef, useState, useSyncExternalStore } from 'react';
import { Button } from '../../ui/Button';
import { Segmented } from '../../ui/Choice';
import { Field } from '../../ui/Field';
import { NumberInput } from '../../NodeGraph/NumberInput';
import { klParseFontUrl } from '../../../play/kit/layers.js';
import { layerAudio } from '../../../lib/layerAudio';
import { toast } from '../../ui/toastStore';
import { LiveAudioChip } from '../chips';
import type { FieldKit } from './fields';

const FONTS = [{ value: 'sans', label: 'Sans' }, { value: 'serif', label: 'Serif' }, { value: 'mono', label: 'Mono' }];

/** Font: a preset (the fallback), weight, and a web font from a Google Fonts link or name, or a font file URL. */
export function FontRow({ f, weight = true }: { f: FieldKit; weight?: boolean }) {
  const url = f.get<string>('fontUrl') ?? '';
  const [draft, setDraft] = useState(url);
  const [seen, setSeen] = useState(url);
  if (url !== seen) { setSeen(url); setDraft(url); }
  const parsed = draft.trim() ? klParseFontUrl(draft) : null;
  const commit = () => { const v = draft.trim(); if (v !== url) f.set({ fontUrl: v }); };
  return (
    <>
      {f.row('Font', <>
        <Segmented size="sm" ariaLabel="Font" value={f.get<string>('font')} options={FONTS} onChange={v => f.set({ font: v })} />
        {weight && <NumberInput value={f.get<number>('weight')} min={100} max={900} step={100} title="Weight (400 regular, 700 bold)" onCommit={n => f.set({ weight: Math.max(100, Math.min(900, Math.round(n / 100) * 100)) })} style={{ ...f.numStyle, width: 48 }} />}
      </>, 'The typeface (and the fallback while a web font loads) and its weight.')}
      {f.row('Web font', (
        <Field
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={e => { if (e.key === 'Enter') commit(); }}
          placeholder="Google Fonts link or name, e.g. Space Grotesk"
          height={26}
          style={{ flex: 1, minWidth: 0 }}
        />
      ), 'Paste a link from Google Fonts (the css2 link, the <link> tag, or the font\'s page), type a family name like "Bebas Neue", or give a .woff2 / .ttf file URL. Websites you export load it too. Clear it to go back to the preset.')}
      {draft.trim() && f.note(parsed ? <>Using <b>{parsed.family}</b>{parsed.file ? ' from the file' : ' from Google Fonts'}. Weights the font doesn't have are faked by the browser.</> : 'Not a Google Fonts link, family name or font file URL (https, .woff2 / .woff / .ttf / .otf).')}
    </>
  );
}

/** An audio layer's input: the live input, or a song loaded into this layer. */
export function AudioSourceRows({ f }: { f: FieldKit }) {
  const id = f.l.id;
  const input = f.get<string>('input');
  const fileName = f.get<string>('fileName');
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const state = useSyncExternalStore(layerAudio.subscribe, () => `${layerAudio.isLoaded(id)}|${layerAudio.isPlaying(id)}`);
  const [loaded, playing] = state.split('|').map(x => x === 'true');
  const pick = async (file: File) => {
    setBusy(true);
    try {
      await layerAudio.load(id, file);
      f.set({ fileName: file.name, input: 'file' });
    } catch (e) {
      toast.error('Couldn’t load that song', { message: e instanceof Error ? e.message : String(e) });
    } finally { setBusy(false); }
  };
  return (
    <>
      {f.seg('Input', 'input', [
        { value: 'live', label: 'Live', title: 'A mic, an interface or your DAW' },
        { value: 'file', label: 'Song', title: 'A song file played through this layer' },
      ], 'Live listens to the live audio input (a mic, an audio interface, or your DAW through a virtual cable: see the Connect guide). Song plays a file you load here and draws that.')}
      {input === 'live' && f.row('Live', <LiveAudioChip />)}
      {input === 'file' && f.row('Song', (
        <>
          <input ref={fileRef} type="file" accept="audio/*" style={{ display: 'none' }} onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) void pick(file); }} />
          <Button size="sm" icon="import" disabled={busy} onClick={() => fileRef.current?.click()}>{busy ? 'Loading…' : loaded ? 'Change song' : fileName ? 'Load it again' : 'Load a song'}</Button>
          {loaded && <Button size="sm" variant="ghost" icon={playing ? 'pause' : 'play'} onClick={() => (playing ? layerAudio.stop(id) : layerAudio.play(id))}>{playing ? 'Pause' : 'Play'}</Button>}
          {fileName && <span style={{ color: f.tk.text.faint, font: '11px Inter, system-ui, sans-serif', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0, flex: 1 }} title={fileName}>{fileName}</span>}
        </>
      ), 'Plays through the master volume and loops. Songs stay for this session only (they are too big to save with the graph); after a reload, load it again. Websites you export use the live input instead.')}
    </>
  );
}
