/**
 * PlayfieldSendGuide — the Connect guide's "Ableton · Audio" part about Playfield Send
 * (docs/playfield-send-plan.md, docs/connecting-ableton.md): the plug-in's status, the one-click
 * install or update into ~/Library/Audio/Plug-Ins/VST3 (desktop app), the steps in Live, and what
 * to do when Live doesn't list it (a copy downloaded separately is quarantined by macOS).
 */
import { useEffect, useState, type ReactNode } from 'react';
import { useTokens } from '../../../theme/themeStore';
import { fontFamily, radius } from '../../../theme/tokens';
import { Button } from '../../ui/Button';
import { toast } from '../../ui/toastStore';
import { ProBadgeFor } from '../../account/ProSheet';
import { liveSend, olderVersion } from '../../../lib/liveSend';
import { useLiveSend } from '../../audio/LiveSendPicker';

const isDesktopApp = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/** What the desktop app found (src-tauri live_send.rs PluginStatus). */
export interface PluginStatus {
  bundledVersion: string | null;
  installedVersion: string | null;
  installedPath: string | null;
  folder: string | null;
  quarantined: boolean;
}

/** The install button's words for what's there. */
export function pluginInstallState(s: PluginStatus | null): { label: string; note: string; can: boolean } {
  if (!s) return { label: 'Install Playfield Send', note: '', can: false };
  if (!s.bundledVersion) return { label: 'Install Playfield Send', note: 'This build of Playfield doesn’t include the plug-in (run npm run plugin:build first).', can: false };
  if (!s.installedVersion) return { label: 'Install Playfield Send', note: `Into ${s.folder ?? '~/Library/Audio/Plug-Ins/VST3'}`, can: true };
  if (olderVersion(s.installedVersion, s.bundledVersion)) return { label: `Update Playfield Send (${s.installedVersion} → ${s.bundledVersion})`, note: 'Then restart Live (Live keeps the old one loaded until it restarts).', can: true };
  return { label: 'Reinstall Playfield Send', note: `Version ${s.installedVersion} is installed${s.installedPath ? ` at ${s.installedPath}` : ''}.`, can: true };
}

export function PlayfieldSendGuide({ P, Steps, H, B, Code, Note }: {
  P: (p: { children: ReactNode }) => ReactNode;
  Steps: (p: { children: ReactNode }) => ReactNode;
  H: (p: { children: ReactNode }) => ReactNode;
  B: (p: { children: ReactNode }) => ReactNode;
  Code: (p: { children: string }) => ReactNode;
  Note: (p: { children: ReactNode; tone?: 'info' | 'warn' }) => ReactNode;
}) {
  useLiveSend();
  const tk = useTokens();
  const [status, setStatus] = useState<PluginStatus | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    liveSend.want('guide', true);
    if (isDesktopApp) void import('@tauri-apps/api/core').then(({ invoke }) => invoke<PluginStatus>('pfsend_status')).then(setStatus).catch(() => { /* older app */ });
    return () => liveSend.want('guide', false);
  }, []);
  const install = async () => {
    setBusy(true);
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const s = await invoke<PluginStatus>('pfsend_install');
      setStatus(s);
      toast.success('Playfield Send installed', { message: 'Restart Live (or Settings → Plug-Ins → Rescan), then find it under Plug-Ins → VST3 → Playfield.' });
    } catch (e) {
      toast.error('Couldn’t install Playfield Send', { message: e instanceof Error ? e.message : String(e) });
    } finally { setBusy(false); }
  };
  const st = pluginInstallState(status);
  const running = liveSend.list();
  const outdated = status?.bundledVersion ? running.filter(i => olderVersion(i.version, status.bundledVersion!)) : [];
  return (
    <>
      <H>One track at a time: Playfield Send <ProBadgeFor feature="audio.liveSend" /></H>
      <P><B>Playfield Send</B> is a small plug-in you put on any Live track, return or group. It passes the sound through untouched and sends that track’s audio to Playfield on this Mac. In Playfield, each one is a source named after its track (“Live · Drums”): pick it on the <B>Audio Source</B> node’s <B>Live</B> tab, or in Play’s audio readers. It is never played out loud here.</P>
      {isDesktopApp ? (
        <div data-pfsend-install="" style={{ margin: '0 0 10px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <Button size="sm" variant="primary" icon="import" disabled={busy || !st.can} onClick={() => void install()}>{busy ? 'Installing…' : st.label}</Button>
          {st.note && <span style={{ color: tk.text.muted, font: `12px/1.4 ${fontFamily.ui}`, flex: 1, minWidth: 200 }}>{st.note}</span>}
        </div>
      ) : (
        <Note>Playfield Send needs the <B>desktop app</B> (a browser can’t receive it). In a browser, use the whole mix through a virtual cable, below.</Note>
      )}
      {outdated.length > 0 && <Note tone="warn">Live is running an older Playfield Send ({outdated[0].version}). Update it above, then restart Live.</Note>}
      {status?.quarantined && (
        <Note tone="warn">macOS has flagged the installed plug-in as downloaded, so Live may refuse it. Reinstall it with the button above, or run <Code>{`xattr -dr com.apple.quarantine "${status.installedPath ?? '~/Library/Audio/Plug-Ins/VST3/Playfield Send.vst3'}"`}</Code> and restart Live.</Note>
      )}
      <Steps>
        <li>{isDesktopApp ? 'Install it with the button above' : 'Install it from the desktop app'}, then <B>restart Live</B> (or Live → Settings → <B>Plug-Ins</B> → <B>Rescan</B>; <B>Use VST3 Plug-In System Folders</B> must be on, as it is by default).</li>
        <li>In Live’s browser: <B>Plug-Ins</B> → <B>VST3</B> → <B>Playfield</B> → drag <B>Playfield Send</B> onto a track. Put it where you want to listen in the chain (last = what the track sounds like).</li>
        <li>In Playfield, add an <B>Audio Source</B> node, pick the <B>Live</B> tab and the track. With the <B>Live connector</B> on, sends are named after their tracks; without it, name them in the source’s Open ↗ window.</li>
      </Steps>
      {running.length > 0 && (
        <div style={{ margin: '0 0 10px', padding: '6px 10px', borderRadius: radius.md, background: tk.bg.field, color: tk.text.muted, font: `12px/1.5 ${fontFamily.ui}` }}>
          Running now: {running.map(i => `${liveSend.sourceName(i.id)} (${i.status})`).join(', ')}
        </div>
      )}
      <Note>Each plug-in shows its <B>Pairing ID</B> (four digits) and whether Playfield is listening; open its window with the wrench on the device. Duplicating a track gives the copy a new ID. Expect about 40–70 ms from Live to the picture; the source’s <B>Sync offset</B> lines it up.</Note>
      <H>If Live doesn’t list it</H>
      <Steps>
        <li>Rescan (Settings → Plug-Ins → Rescan), or restart Live.</li>
        <li>A copy you <B>downloaded</B> (not installed from Playfield) carries macOS’s quarantine flag, and Live won’t load it. Install it from Playfield instead, or clear the flag: <Code>{'xattr -dr com.apple.quarantine ~/Library/Audio/Plug-Ins/VST3/Playfield\\ Send.vst3'}</Code></li>
        <li>On an Intel Mac, or with Live running under Rosetta, the plug-in needs its Intel half: install it from a Playfield build made with both.</li>
      </Steps>
    </>
  );
}
