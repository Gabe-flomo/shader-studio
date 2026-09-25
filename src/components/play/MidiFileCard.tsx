/**
 * MidiFileCard — a .mid file as an input. It plays on the graph clock (the
 * preview's ↺ starts it over, pause pauses it), and its notes and CCs reach
 * everything a controller would: mappings, note triggers, Learn and the
 * Studio's MIDI Input node. It's kept in the Play record, so it saves with
 * the graph and in play files; record the preview for the file's length to
 * get a video that lines up with the song.
 */
import { useEffect, useRef, useState } from 'react';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { midiEngine } from '../../lib/midiEngine';
import { bytesToBase64, formatDuration, parseMidiFile } from '../../lib/midiFile';
import { MIDI_FILE_MAX } from '../../types/play';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import { Button, IconButton } from '../ui/Button';
import { Toggle } from '../ui/Choice';
import { Icon } from '../ui/Icon';
import { NumberInput } from '../NodeGraph/NumberInput';
import { toast } from '../ui/toastStore';

/** Read a picked .mid into the record (checked first, so a bad file never replaces a good one). */
async function loadMidiFile(file: File): Promise<void> {
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const data = parseMidiFile(bytes);
    if (data.events.length === 0) { toast.error(`“${file.name}” has no notes or controller moves`); return; }
    const b64 = bytesToBase64(bytes);
    if (b64.length > MIDI_FILE_MAX) { toast.error(`“${file.name}” is too big`, { message: 'MIDI files up to about 1.5 MB can be kept with the graph.' }); return; }
    const name = file.name.replace(/\.midi?$/i, '');
    useNodeGraphStore.getState().setPlay(p => ({ ...p, midiFile: { name, data: b64, loop: p.midiFile?.loop ?? false, offset: p.midiFile?.offset ?? 0 } }));
    toast.success(`Playing “${name}” as MIDI input`, { message: `${formatDuration(data.duration)} · ${data.notes} notes · channel${data.channels.length === 1 ? '' : 's'} ${data.channels.join(', ')}. ↺ in the preview starts it over.` });
  } catch (e) {
    toast.error(`Couldn’t read “${file.name}”`, { message: e instanceof Error ? e.message : undefined });
  }
}

export function MidiFileCard() {
  const tk = useTokens();
  const midiFile = useNodeGraphStore(s => s.play.midiFile);
  const setPlay = useNodeGraphStore(s => s.setPlay);
  const input = useRef<HTMLInputElement>(null);
  const [pos, setPos] = useState<number | null>(null);
  const info = midiFile ? midiEngine.fileInfo() : null;
  useEffect(() => {
    if (!midiFile) return;
    const id = window.setInterval(() => setPos(midiEngine.filePosition()), 200);
    return () => window.clearInterval(id);
  }, [midiFile]);
  const picker = (
    <input ref={input} type="file" accept=".mid,.midi,audio/midi,audio/x-midi" style={{ display: 'none' }}
      onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void loadMidiFile(f); }} />
  );

  if (!midiFile) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
        {picker}
        <Button size="sm" variant="ghost" icon="import" onClick={() => input.current?.click()} title="Its notes and knob moves play on the clock as if a controller sent them. Record the preview for the file's length to get a video in sync with the song.">
          Play a MIDI file
        </Button>
        <span style={{ color: tk.text.faint, font: `11px ${fontFamily.ui}` }}>A .mid as input, in sync with the clock</span>
      </div>
    );
  }

  const patch = (p: Partial<typeof midiFile>) => setPlay(r => (r.midiFile ? { ...r, midiFile: { ...r.midiFile, ...p } } : r));
  const dur = info && 'duration' in info ? info.duration : 0;
  const frac = dur > 0 && pos !== null ? Math.max(0, Math.min(1, pos / dur)) : 0;
  return (
    <div style={{ margin: '6px 0 4px', padding: '8px 10px', borderRadius: radius.md, background: tk.bg.field }}>
      {picker}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
        <Icon name="wave" size={14} style={{ color: tk.accent.base, flexShrink: 0 }} />
        <span style={{ font: `600 12px ${fontFamily.ui}`, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{midiFile.name}</span>
        <span style={{ flex: 1 }} />
        <IconButton icon="import" label="Replace with another MIDI file" size="sm" onClick={() => input.current?.click()} />
        <IconButton icon="trash" label="Remove the MIDI file" size="sm" tone="danger" onClick={() => setPlay(r => { const next = { ...r }; delete next.midiFile; return next; })} />
      </div>
      {info && 'error' in info ? (
        <div style={{ marginTop: 4, color: tk.status.danger, font: `11px ${fontFamily.ui}` }}>Couldn’t read it: {info.error}</div>
      ) : info && (
        <>
          <div style={{ marginTop: 2, color: tk.text.faint, font: `500 10.5px ${fontFamily.mono}` }}>
            {formatDuration(info.duration)} · {info.notes} notes · ch {info.channels.join(', ')}
            {pos !== null && ` · ${pos < 0 ? `starts in ${formatDuration(-pos)}` : formatDuration(Math.min(pos, info.duration))}`}
          </div>
          <div style={{ height: 3, marginTop: 6, borderRadius: 2, background: alpha(tk.text.faint, 0.2), overflow: 'hidden' }}>
            <div style={{ width: `${frac * 100}%`, height: '100%', background: tk.accent.base }} />
          </div>
        </>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8, flexWrap: 'wrap' }}>
        <Toggle checked={midiFile.loop} onChange={loop => patch({ loop })} label="Loop" />
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }} title="Seconds of clock before the file starts, to line it up with a song (negative starts partway in)">
          <span style={{ color: tk.text.faint, font: `600 10px ${fontFamily.ui}`, letterSpacing: '0.04em', textTransform: 'uppercase' }}>Start at</span>
          <NumberInput value={midiFile.offset} min={-3600} max={3600} step={0.1} onCommit={n => patch({ offset: Math.max(-3600, Math.min(3600, n)) })}
            style={{ width: 54, height: 24, borderRadius: 6, border: 0, background: tk.bg.panel, color: tk.text.primary, font: `500 11px ${fontFamily.mono}`, textAlign: 'center' }} />
          <span style={{ color: tk.text.faint, fontSize: 11 }}>s</span>
        </span>
      </div>
      <div style={{ marginTop: 6, color: tk.text.faint, font: `11px/1.4 ${fontFamily.ui}` }}>Plays on the clock: ↺ in the preview starts it over. Learn and note triggers hear it like a controller.</div>
    </div>
  );
}
