/**
 * chips.tsx — small live-status chips used across the Play page: the OSC
 * listener or bridge, MIDI, the live audio input and the camera. Each shows a dot
 * (green on, amber starting, red failed), a short status, and the one button
 * that fixes it.
 */
import { useEffect, useRef, useState } from 'react';
import { useTokens } from '../../theme/themeStore';
import { fontFamily } from '../../theme/tokens';
import { oscClient, type OscStatus } from '../../lib/oscClient';
import { liveAudio, type LiveStatus } from '../../lib/liveAudio';
import { cameraInput, type CameraStatus } from '../../lib/cameraInput';
import { midiEngine } from '../../lib/midiEngine';
import { Button } from '../ui/Button';
import { Toggle } from '../ui/Choice';
import { Select } from '../ui/Select';
import { NumberInput } from '../NodeGraph/NumberInput';
import { reportFileResult } from '../shell/reportFileResult';
import { MidiMonitor } from './MidiMonitor';
import { toast } from '../ui/toastStore';
import { useReadersPanel } from './readersPanelUi';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { Popover } from '../ui/Popover';
import { ReaderDots } from './ReaderDots';

/**
 * Inside another site's frame (a preview on claude.ai, say) the browser refuses the camera,
 * the mic and MIDI unless that site allows them, without asking. Say so rather than "no camera".
 */
const EMBEDDED = typeof window !== 'undefined' && window.self !== window.top;
const EMBEDDED_HINT = 'This page is running inside another site, which does not allow the camera, the microphone or MIDI. Open Playfield in its own tab (or the desktop app) to use them.';

export function OscStatusChip() {
  const tk = useTokens();
  const native = oscClient.getMode() === 'native';
  const [status, setStatus] = useState<OscStatus>(() => oscClient.getStatus());
  const [port, setPort] = useState(() => oscClient.getPort());
  const [lan, setLan] = useState(() => oscClient.getLan());
  useEffect(() => oscClient.onStatus(setStatus), []);
  const colour = status === 'connected' ? tk.status.success : status === 'connecting' ? tk.status.warning : status === 'error' ? tk.status.danger : tk.text.disabled;
  const text = native
    ? (status === 'connected' ? `Listening on UDP ${port}` : status === 'connecting' ? 'Starting…' : status === 'error' ? (oscClient.getError() || 'Couldn’t listen') : 'Not listening')
    : (status === 'connected' ? 'Bridge connected' : status === 'connecting' ? 'Connecting…' : status === 'error' ? 'No bridge running' : 'Not connected');
  const portInput = (
    <NumberInput value={port} min={1} max={65535} step={1} title={native ? 'UDP port to listen on (send OSC here)' : 'The bridge’s WebSocket port'} onCommit={n => { const p = Math.round(n); setPort(p); oscClient.setPort(p); }} style={{ width: 52, height: 22, borderRadius: 5, border: 0, background: tk.bg.field, color: tk.text.primary, font: `500 10.5px ${fontFamily.mono}`, textAlign: 'center' }} />
  );
  const downloadBridge = async () => {
    const { buildStandaloneBridge, BRIDGE_FILE_NAME } = await import('../../play/bridgeDownload');
    const { saveTextFile } = await import('../../utils/fileIO');
    reportFileResult(await saveTextFile(buildStandaloneBridge(), BRIDGE_FILE_NAME, 'text/javascript'), { failTitle: 'Couldn’t save the bridge', success: `Saved ${BRIDGE_FILE_NAME}` });
  };
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', minWidth: 0 }}>
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: colour, flexShrink: 0 }} />
      <span title={text} style={{ color: status === 'error' ? tk.status.danger : tk.text.muted, font: `11px ${fontFamily.ui}`, maxWidth: 190, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{text}</span>
      {portInput}
      {native ? (
        <>
          <Toggle checked={lan} onChange={on => { setLan(on); oscClient.setLan(on); }} label="Phones too" />
          {status === 'connected'
            ? <Button size="sm" variant="ghost" onClick={() => oscClient.setWanted(false)}>Stop</Button>
            : <Button size="sm" onClick={() => oscClient.setWanted(true)}>Start listening</Button>}
        </>
      ) : (
        <>
          {status !== 'connected' && <Button size="sm" onClick={() => oscClient.setWanted(true)}>Connect</Button>}
          {status === 'error' && (
            <>
              <Button size="sm" icon="export" onClick={() => void downloadBridge()} title="A small program that passes OSC to this tab. Needs Node.js (nodejs.org).">Download bridge</Button>
              <Button size="sm" variant="ghost" icon="copy" title="Copy the command that starts it (run it in Terminal where the file downloaded)" onClick={() => { void navigator.clipboard?.writeText('node shader-studio-osc-bridge.mjs').then(() => toast.success('Command copied', { message: 'Paste it in Terminal, in the folder the bridge downloaded to.' })); }}>Command</Button>
            </>
          )}
        </>
      )}
    </span>
  );
}

/**
 * MIDI: which devices are listened to and the last message that arrived
 * ("CC 21 = 64 · ch 1"), so "is my controller getting through, and what does
 * this knob send?" has an answer on the page.
 */
export function MidiStatusChip({ monitor: monitorAtFirst = false }: { monitor?: boolean } = {}) {
  const tk = useTokens();
  const [wm, setWm] = useState(() => midiEngine.webMidi());
  const [last, setLast] = useState(() => midiEngine.lastActivity());
  const [now, setNow] = useState(0);
  const [monitor, setMonitor] = useState(monitorAtFirst);
  useEffect(() => {
    // A knob sends hundreds of messages a second: read the newest a few times a second, not per message.
    const id = window.setInterval(() => { setLast(midiEngine.lastActivity()); setNow(Date.now()); }, 250);
    const off = midiEngine.subscribe(e => { if (e.kind === 'devices') setWm(midiEngine.webMidi()); });
    return () => { window.clearInterval(id); off(); };
  }, []);
  const { status, inputs, busy, off, transport } = wm;
  const ok = status === 'ready' && inputs.length > busy.length + inputs.filter(n => off.includes(n)).length;
  const colour = ok ? tk.status.success : status === 'requesting' ? tk.status.warning : status === 'denied' || busy.length ? tk.status.danger : tk.text.disabled;
  const text = status === 'ready'
    ? (inputs.length ? inputs.join(', ') : 'No MIDI devices found. Plug one in: it shows up here.')
    : status === 'requesting' ? (transport === 'native' ? 'Opening MIDI devices…' : 'Waiting for the browser’s MIDI permission…')
    : status === 'denied' ? (transport === 'native' ? 'MIDI couldn’t start' : EMBEDDED ? 'MIDI blocked by this page' : 'MIDI access refused')
    : status === 'unsupported' ? 'No Web MIDI in this browser (use Chrome or Edge)'
    : 'MIDI not connected';
  const why = midiEngine.blockReason();
  const ago = last && now ? Math.max(0, Math.round((now - last.at) / 1000)) : 0;
  return (
    <span style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: colour, flexShrink: 0 }} />
        <span title={why ?? text} style={{ color: tk.text.muted, font: `11px ${fontFamily.ui}`, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{text}</span>
        <span style={{ flex: 1 }} />
        {(status === 'idle' || (status === 'denied' && !EMBEDDED) || busy.length > 0) && (
          <Button size="sm" onClick={() => void midiEngine.connectWebMidi({ retry: true }).then(() => setWm(midiEngine.webMidi()))}>Connect</Button>
        )}
        {status !== 'unsupported' && (
          <Button size="sm" variant={monitor ? 'secondary' : 'ghost'} icon="live" onClick={() => setMonitor(m => !m)} title="Every MIDI source the system knows and a live log of what each one sends">{monitor ? 'Hide monitor' : 'Monitor'}</Button>
        )}
      </span>
      {why && status !== 'unsupported' && <span style={{ color: tk.status.danger, font: `11px/1.4 ${fontFamily.ui}` }}>{why}</span>}
      {status === 'ready' && inputs.length > 1 && (
        <span style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {inputs.map(name => {
            const on = !off.includes(name);
            return (
              <button key={name} onClick={() => { midiEngine.setDeviceEnabled(name, !on); setWm(midiEngine.webMidi()); }}
                title={on ? `Listening to ${name}: click to ignore it` : `Ignoring ${name}: click to listen again`}
                style={{ background: 'none', border: `1px solid ${on ? tk.status.success : tk.text.disabled}`, color: on ? tk.text.secondary : tk.text.disabled, textDecoration: on ? 'none' : 'line-through', borderRadius: 4, padding: '1px 6px', font: `10.5px ${fontFamily.ui}`, cursor: 'pointer' }}>
                {name}
              </button>
            );
          })}
        </span>
      )}
      {status === 'ready' && inputs.length > 0 && (
        <span style={{ color: last && ago < 3 ? tk.text.secondary : tk.text.faint, font: `500 10.5px ${fontFamily.mono}` }}>
          {last ? `Last: ${last.text}${ago >= 3 ? ` · ${ago < 60 ? `${ago}s` : `${Math.round(ago / 60)} min`} ago` : ''}` : 'Nothing received yet: move a knob or play a note.'}
        </span>
      )}
      {monitor && <span style={{ marginTop: 4, paddingTop: 8, borderTop: `1px solid ${tk.border.subtle}` }}><MidiMonitor /></span>}
    </span>
  );
}

/** `readers`: offer the Audio readers panel and the readers on the live input (off inside the panel itself). */
export function LiveAudioChip({ readers = true }: { readers?: boolean } = {}) {
  const tk = useTokens();
  const play = useNodeGraphStore(s => s.play);
  const liveReaders = readers && play.audioReaders && !play.audioReaders.input ? play.audioReaders.readers.length : 0;
  const dotsRef = useRef<HTMLSpanElement>(null);
  const [dotsOpen, setDotsOpen] = useState(false);
  const [status, setStatus] = useState<LiveStatus>(() => liveAudio.getStatus());
  const [devices, setDevices] = useState<Array<{ id: string; label: string }>>([]);
  const [deviceId, setDeviceId] = useState(() => liveAudio.getDeviceId());
  useEffect(() => liveAudio.onStatus(st => { setStatus(st); setDeviceId(liveAudio.getDeviceId()); if (st === 'on') void liveAudio.devices().then(setDevices); }), []);
  useEffect(() => { if (liveAudio.isOn()) void liveAudio.devices().then(setDevices); }, []);
  const colour = status === 'on' ? tk.status.success : status === 'requesting' ? tk.status.warning : status === 'denied' ? tk.status.danger : tk.text.disabled;
  const text = status === 'on' ? (liveAudio.getLabel() || 'Listening') : status === 'requesting' ? 'Asking…' : status === 'denied' ? (EMBEDDED ? 'Blocked by this page' : 'Blocked or no input') : status === 'unsupported' ? 'Not available here' : 'Not listening';
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', minWidth: 0 }}>
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: colour, flexShrink: 0 }} />
      <span style={{ color: tk.text.muted, font: `11px ${fontFamily.ui}`, maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={status === 'denied' && EMBEDDED ? EMBEDDED_HINT : text}>{text}</span>
      {status === 'on' && devices.length > 1 && (
        <Select ariaLabel="Audio input" value={deviceId} options={devices.map(d => ({ value: d.id, label: d.label }))} onChange={id => { setDeviceId(id); void liveAudio.start(id); }} height={24} style={{ maxWidth: 160 }} />
      )}
      {status !== 'on' && status !== 'unsupported' && <Button size="sm" onClick={() => void liveAudio.start(deviceId)}>Listen</Button>}
      {status === 'on' && <Button size="sm" variant="ghost" onClick={() => liveAudio.stop()}>Stop</Button>}
      {readers && <Button size="sm" variant="ghost" icon="wave" onClick={() => useReadersPanel.getState().show()} title="See the live spectrum and place readers on it">Spectrum</Button>}
      {liveReaders > 0 && (
        <span ref={dotsRef} style={{ display: 'inline-flex' }}>
          <Button size="sm" variant={dotsOpen ? 'secondary' : 'ghost'} onClick={() => setDotsOpen(o => !o)} title="The readers on the live input, with their levels and their controls">{liveReaders} reader{liveReaders === 1 ? '' : 's'}</Button>
        </span>
      )}
      {dotsOpen && (
        <Popover anchorRef={dotsRef} onClose={() => setDotsOpen(false)} align="end" width={320} padding={8}>
          <ReaderDots play={play} input="" />
        </Popover>
      )}
    </span>
  );
}

export function CameraChip() {
  const tk = useTokens();
  const [status, setStatus] = useState<CameraStatus>(() => cameraInput.getStatus());
  const [devices, setDevices] = useState<Array<{ id: string; label: string }>>([]);
  const [deviceId, setDeviceId] = useState(() => cameraInput.getDeviceId());
  const [res, setRes] = useState(() => cameraInput.getResolution());
  useEffect(() => {
    const refresh = () => { void cameraInput.devices().then(setDevices); };
    const offStatus = cameraInput.onStatus(st => { setStatus(st); setDeviceId(cameraInput.getDeviceId()); if (st === 'on') refresh(); });
    const offDevices = cameraInput.onDevices(refresh);
    refresh();
    return () => { offStatus(); offDevices(); };
  }, []);
  const colour = status === 'on' ? tk.status.success : status === 'requesting' ? tk.status.warning : status === 'denied' ? tk.status.danger : tk.text.disabled;
  const text = status === 'on' ? (cameraInput.getLabel() || 'Camera on') : status === 'requesting' ? 'Asking…' : status === 'denied' ? (EMBEDDED ? 'Blocked by this page' : 'Blocked or no camera') : status === 'unsupported' ? 'Not available here' : 'Camera off';
  // Labels only appear once access is allowed; before that, one "Default camera" entry is enough.
  const labelled = devices.some(d => !/^Camera \d+$/.test(d.label));
  const options = [{ value: '', label: 'Default camera' }, ...(labelled ? devices.map(d => ({ value: d.id, label: d.label })) : [])];
  const pick = (id: string) => { setDeviceId(id); void cameraInput.setDevice(id); };
  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', minWidth: 0 }}>
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: colour, flexShrink: 0 }} />
        <span style={{ color: tk.text.muted, font: `11px ${fontFamily.ui}`, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={status === 'denied' && EMBEDDED ? EMBEDDED_HINT : text}>{text}</span>
        {status !== 'on' && status !== 'unsupported' && <Button size="sm" onClick={() => void cameraInput.start()}>Turn on camera</Button>}
        {status === 'on' && <Button size="sm" variant="ghost" onClick={() => cameraInput.stop()}>Stop</Button>}
      </span>
      {status !== 'unsupported' && (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', minWidth: 0 }}>
          <Select ariaLabel="Camera" value={options.some(o => o.value === deviceId) ? deviceId : ''} options={options} onChange={pick} height={24} style={{ maxWidth: 190 }} />
          <Select ariaLabel="Camera resolution" value={res} options={[{ value: '720p', label: '720p' }, { value: '1080p', label: '1080p' }]} onChange={v => { const r = v as '720p' | '1080p'; setRes(r); void cameraInput.setResolution(r); }} height={24} style={{ width: 76 }} />
        </span>
      )}
      {status === 'on' && cameraInput.usedFallback() && (
        <span style={{ color: tk.status.warningText, font: `11px/1.4 ${fontFamily.ui}` }}>The chosen camera isn’t connected, so the default one opened.</span>
      )}
      {status !== 'on' && status !== 'unsupported' && !labelled && (
        <span style={{ color: tk.text.faint, font: `11px/1.4 ${fontFamily.ui}` }}>Turn the camera on once to list every camera: an iPhone (Continuity Camera), an HDMI capture card, a DSLR’s webcam app or OBS.</span>
      )}
    </span>
  );
}
