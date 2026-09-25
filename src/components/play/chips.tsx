/**
 * chips.tsx — small live-status chips used across the Play page: the OSC
 * listener or bridge, the live audio input and the camera. Each shows a dot
 * (green on, amber starting, red failed), a short status, and the one button
 * that fixes it.
 */
import { useEffect, useState } from 'react';
import { useTokens } from '../../theme/themeStore';
import { fontFamily } from '../../theme/tokens';
import { oscClient, type OscStatus } from '../../lib/oscClient';
import { liveAudio, type LiveStatus } from '../../lib/liveAudio';
import { cameraInput, type CameraStatus } from '../../lib/cameraInput';
import { Button } from '../ui/Button';
import { Toggle } from '../ui/Choice';
import { Select } from '../ui/Select';
import { NumberInput } from '../NodeGraph/NumberInput';
import { reportFileResult } from '../shell/reportFileResult';
import { toast } from '../ui/toastStore';

/**
 * Inside another site's frame (a preview on claude.ai, say) the browser refuses the camera,
 * the mic and MIDI unless that site allows them, without asking. Say so rather than "no camera".
 */
const EMBEDDED = typeof window !== 'undefined' && window.self !== window.top;
const EMBEDDED_HINT = 'This page is running inside another site, which does not allow the camera, the microphone or MIDI. Open Shader Studio in its own tab (or the desktop app) to use them.';

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

export function LiveAudioChip() {
  const tk = useTokens();
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
    </span>
  );
}

export function CameraChip() {
  const tk = useTokens();
  const [status, setStatus] = useState<CameraStatus>(() => cameraInput.getStatus());
  useEffect(() => cameraInput.onStatus(setStatus), []);
  const colour = status === 'on' ? tk.status.success : status === 'requesting' ? tk.status.warning : status === 'denied' ? tk.status.danger : tk.text.disabled;
  const text = status === 'on' ? 'Camera on' : status === 'requesting' ? 'Asking…' : status === 'denied' ? (EMBEDDED ? 'Blocked by this page' : 'Blocked or no camera') : status === 'unsupported' ? 'Not available here' : 'Camera off';
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', minWidth: 0 }}>
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: colour, flexShrink: 0 }} />
      <span style={{ color: tk.text.muted, font: `11px ${fontFamily.ui}` }} title={status === 'denied' && EMBEDDED ? EMBEDDED_HINT : undefined}>{text}</span>
      {status !== 'on' && status !== 'unsupported' && <Button size="sm" onClick={() => void cameraInput.start()}>Turn on camera</Button>}
      {status === 'on' && <Button size="sm" variant="ghost" onClick={() => cameraInput.stop()}>Stop</Button>}
    </span>
  );
}
