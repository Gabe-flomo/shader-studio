/**
 * LiveConnectorGuide — the Connect guide's "Ableton · Live connector" page (docs/connecting-ableton.md):
 * the connection's status, the one-click install (desktop app: copies the Remote Script into
 * Live's User Library), the three steps in Live, the latency offset, and troubleshooting.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { useTokens } from '../../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../../theme/tokens';
import { Button } from '../../ui/Button';
import { NumberInput } from '../../NodeGraph/NumberInput';
import { toast } from '../../ui/toastStore';
import { liveClient } from '../../../lib/liveClient';
import { LIVE_CONNECTOR_VERSION } from '../../../lib/live/liveProtocol';
import { compareVersions, LiveStatusChip, liveNeedsUpdate, useLive, useWantLive } from './LiveFields';

const isDesktopApp = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/** What the desktop app found (src-tauri live_connector_status). */
export interface ConnectorStatus {
  bundledVersion: string;
  installedVersion: string | null;
  userLibrary: string | null;
  remoteScripts: string | null;
  lives: string[];
  logPath: string | null;
}

/** The install button's words for what's there. */
export function installState(s: ConnectorStatus | null): { label: string; note: string } {
  if (!s) return { label: 'Install the Live connector', note: '' };
  if (!s.installedVersion) return { label: 'Install the Live connector', note: s.remoteScripts ? `Into ${s.remoteScripts}` : 'Ableton’s User Library wasn’t found: is Live installed?' };
  if (compareVersions(s.installedVersion, s.bundledVersion) < 0) return { label: `Update the Live connector (${s.installedVersion} → ${s.bundledVersion})`, note: 'Restart Live after updating.' };
  return { label: 'Reinstall the Live connector', note: `Version ${s.installedVersion} is installed in ${s.remoteScripts ?? 'the User Library'}.` };
}

export function LiveConnectorGuide({ os, P, Steps, H, B, Code, Note }: {
  os: 'mac' | 'win';
  P: (p: { children: ReactNode }) => ReactNode;
  Steps: (p: { children: ReactNode }) => ReactNode;
  H: (p: { children: ReactNode }) => ReactNode;
  B: (p: { children: ReactNode }) => ReactNode;
  Code: (p: { children: string }) => ReactNode;
  Note: (p: { children: ReactNode; tone?: 'info' | 'warn' }) => ReactNode;
}) {
  useLive();
  useWantLive('guide');
  const tk = useTokens();
  const [status, setStatus] = useState<ConnectorStatus | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!isDesktopApp) return;
    void import('@tauri-apps/api/core').then(({ invoke }) => invoke<ConnectorStatus>('live_connector_status')).then(setStatus).catch(() => { /* older app */ });
  }, []);
  const install = async () => {
    setBusy(true);
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const s = await invoke<ConnectorStatus>('live_connector_install');
      setStatus(s);
      toast.success('Live connector installed', { message: 'Restart Live, then pick Playfield as a Control Surface.' });
    } catch (e) {
      toast.error('Couldn’t install the Live connector', { message: e instanceof Error ? e.message : String(e) });
    } finally { setBusy(false); }
  };
  const revealLog = async () => {
    try { const { invoke } = await import('@tauri-apps/api/core'); await invoke('live_reveal_log'); } catch (e) { toast.error('Couldn’t show Live’s log', { message: e instanceof Error ? e.message : String(e) }); }
  };
  const st = installState(status);
  const userLib = os === 'mac' ? '~/Music/Ableton/User Library/Remote Scripts/Playfield' : 'Documents\\Ableton\\User Library\\Remote Scripts\\Playfield';
  return (
    <>
      <P>The <B>Live connector</B> is a small script that runs inside Ableton Live (a “Control Surface”). It sends Playfield Live’s <B>tempo and beat</B>, <B>clip and scene launches</B>, track names and colours, and <B>any parameter by name</B> at full resolution, with no Max for Live and nothing else running. Playfield can launch clips and scenes back. Live 11 and 12.</P>
      <div data-live-guide="" style={{ margin: '0 0 12px', padding: '8px 12px', borderRadius: radius.md, background: tk.bg.field, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <LiveStatusChip />
        <span style={{ flex: 1 }} />
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: tk.text.muted, font: `11.5px ${fontFamily.ui}` }} title="Your audio interface’s output delay: the followed beat runs this much later, so flashes land on the kick you hear">
          Latency
          <NumberInput value={liveClient.getLatency()} min={-200} max={500} step={1} title="ms: positive runs the beat later" onCommit={n => liveClient.setLatency(n)} style={{ width: 52, height: 22, borderRadius: 5, border: 0, background: tk.bg.panel, color: tk.text.primary, font: `500 11px ${fontFamily.mono}`, textAlign: 'center' }} />
          ms
        </span>
      </div>
      {liveNeedsUpdate() && <Note tone="warn">Live is running an older connector ({liveClient.state.hello?.script}) than this app ships ({LIVE_CONNECTOR_VERSION}). Update it below and restart Live.</Note>}
      <H>1. Install it</H>
      {isDesktopApp ? (
        <div style={{ margin: '0 0 10px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <Button size="sm" variant="primary" icon="import" disabled={busy || (!!status && !status.remoteScripts)} onClick={() => void install()}>{busy ? 'Installing…' : st.label}</Button>
          {st.note && <span style={{ color: tk.text.muted, font: `12px/1.4 ${fontFamily.ui}`, flex: 1, minWidth: 200 }}>{st.note}</span>}
        </div>
      ) : (
        <Steps>
          <li>Copy the <B>Playfield</B> folder from <Code>tools/live-connector/Playfield</Code> (in the shader-studio folder) to <Code>{userLib}</Code>. Make the <B>Remote Scripts</B> folder if it isn’t there. (The desktop app does this with one click.)</li>
        </Steps>
      )}
      <H>2. Switch it on in Live</H>
      <Steps>
        <li><B>Restart Live</B> (it reads new scripts as it starts).</li>
        <li>Live → {os === 'mac' ? 'Settings' : 'Options → Preferences'} → <B>Link, Tempo & MIDI</B> → pick <B>Playfield</B> in an empty <B>Control Surface</B> slot. Leave its <B>Input</B> and <B>Output</B> on <B>None</B>.</li>
        <li>The dot above turns <B>green</B>: “Connected”, with your set’s tempo.</li>
      </Steps>
      {!isDesktopApp && (
        <Note>In a browser, run the bridge beside it: <Code>npm run osc-bridge -- --live</Code> (browsers can’t receive UDP). The desktop app needs nothing else.</Note>
      )}
      <H>3. Use it</H>
      <Steps>
        <li><B>+ Map → Ableton Live</B>: <B>Learn from Live</B> (click any parameter in Live), the <B>Playfield rack</B>’s macros, the selected device’s parameters, Live’s beat and bar, and clip and scene launches.</li>
        <li><B>A “Playfield” rack</B> is the steady way for a show: put an Audio or MIDI Effect Rack named <B>Playfield</B> on any track, map anything in Live to its macros (Live’s own Map), and name the macros. Playfield sees them by name.</li>
        <li><B>Follow Live</B> on a Clock source, a Beat trigger, and the Arrangement’s transport (Live’s play and stop run the tape).</li>
        <li>A rule’s <B>Do</B> can launch a clip or a scene, the next scene, stop all clips, or tap the tempo in Live.</li>
      </Steps>
      <H>If it doesn’t connect</H>
      <Steps>
        <li><B>Playfield isn’t in Live’s list</B>: restart Live; check the folder is <Code>Remote Scripts/Playfield</Code> (not Playfield/Playfield) inside the User Library Live uses (Live → Settings → Library shows where).</li>
        <li><B>Listed but never green</B>: the Control Surface slot isn’t set; or another Playfield window (or the bridge with --live) has port 11101; or the script hit an error: {isDesktopApp ? <Button size="sm" variant="ghost" disabled={!status?.logPath} onClick={() => void revealLog()}>Show Live’s log</Button> : <>see Live’s <B>Log.txt</B></>}.</li>
        <li><B>Values move in steps</B>: Live sends them about 20–30 times a second; raise the mapping’s smoothing.</li>
        <li><B>The beat is late</B>: set <B>Latency</B> above to your audio interface’s output latency.</li>
        <li><B>Live 10 or older</B> isn’t supported (its scripts are Python 2).</li>
      </Steps>
      {status && status.lives.length > 0 && <div style={{ color: tk.text.faint, font: `11px ${fontFamily.ui}` }}>Found: {status.lives.join(', ')}{status.userLibrary ? ` · User Library: ${status.userLibrary}` : ''}</div>}
      <div style={{ marginTop: 8, padding: '6px 10px', borderRadius: radius.md, background: alpha(tk.accent.base, 0.06), color: tk.text.muted, font: `11.5px/1.5 ${fontFamily.ui}` }}>
        It only talks on this computer (127.0.0.1, ports 11100 and 11101), so it sits beside AbletonOSC or TouchOSC setups.
      </div>
    </>
  );
}
