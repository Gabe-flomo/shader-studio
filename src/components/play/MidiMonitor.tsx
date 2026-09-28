/**
 * MidiMonitor — every MIDI source the system knows (name, maker, id, open or
 * offline) and a live log of the raw messages each one sends, decoded
 * (lib/midiMonitor.ts). For "is my controller getting through, and what
 * exactly does it send?": copy the log and paste it into a bug report.
 *
 * Shown from the MIDI status chip's Monitor button (Mappings) and from the
 * Engine tab's header.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTokens } from '../../theme/themeStore';
import { fontFamily, radius } from '../../theme/tokens';
import { midiEngine } from '../../lib/midiEngine';
import { formatMonitorLine, midiMonitor } from '../../lib/midiMonitor';
import type { MidiSourceInfo } from '../../lib/midiTransport';
import { Button } from '../ui/Button';
import { Select } from '../ui/Select';
import { toast } from '../ui/toastStore';

const SHOWN = 200;
const ALL = '\u0000all';

export function MidiMonitor() {
  const tk = useTokens();
  const [sources, setSources] = useState<MidiSourceInfo[]>(() => midiEngine.sources());
  const [ver, setVer] = useState(0);
  const [device, setDevice] = useState(ALL);
  const [follow, setFollow] = useState(true);
  const logRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    void midiEngine.connectWebMidi();
    const refresh = () => setSources(midiEngine.sources());
    const off = midiEngine.subscribe(e => { if (e.kind === 'devices') refresh(); });
    // A knob sends hundreds of messages a second: read the log a few times a second, not per message.
    const tick = window.setInterval(() => { setVer(midiMonitor.version()); refresh(); }, 200);
    return () => { off(); window.clearInterval(tick); };
  }, []);

  const filter = device === ALL ? undefined : device;
  const entries = useMemo(() => midiMonitor.list(filter, SHOWN), [filter, ver]); // eslint-disable-line react-hooks/exhaustive-deps
  const paused = midiMonitor.isPaused();

  useEffect(() => {
    const el = logRef.current;
    if (el && follow) el.scrollTop = el.scrollHeight;
  }, [entries, follow]);

  // Devices to filter by: the sources, plus any name that appears in the log (the stand-in, a scripted message).
  const names = useMemo(() => {
    const set = new Set<string>(sources.map(s => s.name));
    for (const e of midiMonitor.list()) set.add(e.device);
    return [...set];
  }, [sources, ver]); // eslint-disable-line react-hooks/exhaustive-deps

  const copy = () => {
    const head = sources.length
      ? `MIDI sources (${midiEngine.webMidi().transport === 'native' ? 'desktop app, CoreMIDI' : 'browser, Web MIDI'}):\n${sources.map(s => `  ${s.name} · ${s.manufacturer || 'maker unknown'} · id ${s.id} · ${sourceState(s)}`).join('\n')}\n\n`
      : 'MIDI sources: none\n\n';
    const body = midiMonitor.text(filter);
    const text = head + (body || '(no messages)');
    const done = () => toast.success('MIDI log copied', { message: `${entries.length} line${entries.length === 1 ? '' : 's'} and ${sources.length} source${sources.length === 1 ? '' : 's'}.` });
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(done, () => toast.error('Couldn’t copy'));
    else toast.error('Couldn’t copy');
  };

  const mono = `500 10.5px/1.5 ${fontFamily.mono}`;
  const wm = midiEngine.webMidi();
  return (
    <div data-testid="midi-monitor" style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        <span style={{ color: tk.text.faint, font: `600 10px ${fontFamily.ui}`, letterSpacing: '0.05em', textTransform: 'uppercase' }}>Sources</span>
        {sources.length === 0 ? (
          <span style={{ color: tk.text.muted, font: `11.5px/1.45 ${fontFamily.ui}` }}>
            {wm.status === 'ready' ? 'The system lists no MIDI sources. Plug a controller in (it shows up within a couple of seconds), or check Audio MIDI Setup → MIDI Studio.' : wm.status === 'requesting' ? 'Opening MIDI…' : (midiEngine.blockReason() ?? 'MIDI isn’t connected yet: press Connect.')}
          </span>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.4fr) minmax(0, 1fr) auto auto', columnGap: 10, rowGap: 2, alignItems: 'baseline', font: `11px ${fontFamily.ui}`, color: tk.text.secondary }}>
            {sources.map(s => {
              const seen = midiMonitor.seen(s.name);
              const colour = s.offline ? tk.text.disabled : s.open ? tk.status.success : s.note ? tk.status.danger : tk.text.muted;
              return (
                <div key={s.id} style={{ display: 'contents' }}>
                  <span title={`${s.name} (id ${s.id})`} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: s.offline ? tk.text.disabled : tk.text.primary }}>
                    <span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: colour, marginRight: 6, verticalAlign: 'middle' }} />
                    {s.name}
                  </span>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: tk.text.muted }}>{s.manufacturer || '—'}</span>
                  <span style={{ font: mono, color: tk.text.faint }}>id {s.id}</span>
                  <span style={{ color: s.offline ? tk.text.disabled : s.note ? tk.status.danger : tk.text.muted, whiteSpace: 'nowrap' }}>
                    {sourceState(s)}{seen ? ` · ${seen.count} msg${seen.count === 1 ? '' : 's'}` : ''}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <span style={{ color: tk.text.faint, font: `600 10px ${fontFamily.ui}`, letterSpacing: '0.05em', textTransform: 'uppercase' }}>Messages</span>
        <Select ariaLabel="Monitor device" value={names.includes(device) ? device : ALL} height={24} style={{ flex: '1 1 120px', minWidth: 0, maxWidth: 220 }}
          options={[{ value: ALL, label: 'All devices' }, ...names.map(n => ({ value: n, label: n || '(no device: keyboard, file, script)' }))]} onChange={setDevice} />
        <span style={{ flex: 1 }} />
        <Button size="sm" variant="ghost" icon={paused ? 'play' : 'pause'} onClick={() => midiMonitor.setPaused(!paused)}>{paused ? 'Resume' : 'Pause'}</Button>
        <Button size="sm" variant="ghost" icon="trash" onClick={() => midiMonitor.clear()}>Clear</Button>
        <Button size="sm" icon="copy" onClick={copy} title="Copy the sources and the log as text">Copy</Button>
      </div>
      <pre
        ref={logRef}
        aria-label="MIDI messages"
        onScroll={e => { const el = e.currentTarget; setFollow(el.scrollHeight - el.scrollTop - el.clientHeight < 8); }}
        style={{ margin: 0, height: 180, overflow: 'auto', padding: '6px 8px', borderRadius: radius.sm, background: tk.bg.field, color: tk.text.secondary, font: mono, whiteSpace: 'pre', userSelect: 'text' }}
      >
        {entries.length === 0
          ? (paused ? 'Paused.' : 'Nothing yet. Play a note, hit a pad or turn a knob: every message shows here, sysex and clock too.')
          : entries.map(e => formatMonitorLine(e)).join('\n')}
      </pre>
      <span style={{ color: tk.text.faint, font: `11px/1.4 ${fontFamily.ui}` }}>
        The newest {SHOWN} messages. A controller that isn’t listed: check it in Audio MIDI Setup → MIDI Studio (grey = offline). Listed but silent: press Connect above, or unplug it and plug it back in.
      </span>
    </div>
  );
}

function sourceState(s: MidiSourceInfo): string {
  if (s.offline) return 'offline';
  if (s.open) return 'open';
  return s.note || 'not open';
}
