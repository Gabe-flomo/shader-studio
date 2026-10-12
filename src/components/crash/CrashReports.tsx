/**
 * Crash reports in the UI (docs/crash-recovery.md "Crash reports"): the viewer
 * (Show report, mounted once next to the dialogs) and the list in Files → App
 * settings, with Report a problem… and, for development, Simulate a crash.
 */
import { useEffect, useState } from 'react';
import { useTokens } from '../../theme/themeStore';
import { fontFamily } from '../../theme/tokens';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { Select } from '../ui/Select';
import { cardStyle } from '../files/fileUiShared';
import {
  copyCrashReport, copyText, parseCrashReport, readCrashReport, reportFileTime, reportProblem, revealCrashReport, showCrashReport, useCrashReports,
} from '../../files/crashReports';
import { formatClock } from '../../files/recovery';
import { CRASH_KINDS, devToolsOn, simulateCrash, type CrashKind } from '../../dev/simulateCrash';

const isTauri = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/** Show report: the report's JSON, with Copy and Reveal in Finder. */
export function CrashReportViewerHost() {
  const tk = useTokens();
  const viewing = useCrashReports(s => s.viewing);
  if (!viewing) return null;
  const close = () => useCrashReports.setState({ viewing: null });
  const r = parseCrashReport(viewing.text);
  return (
    <Modal title="Crash report" subtitle={r ? `${r.summary} · ${new Date(r.at).toLocaleString()}` : viewing.name} icon="warning" width={720} height={620} onClose={close}
      footer={<>
        <Button variant="ghost" onClick={() => { void copyText(viewing.text); }}>Copy</Button>
        <Button variant="ghost" onClick={() => { void revealCrashReport(viewing.name); }}>{isTauri() ? 'Reveal in Finder' : 'Download'}</Button>
        <span style={{ flex: 1 }} />
        <Button variant="primary" autoFocus onClick={close}>Done</Button>
      </>}>
      <pre style={{ margin: 0, padding: '14px 20px', font: `12px/1.45 ${fontFamily.mono}`, color: tk.text.secondary, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{viewing.text}</pre>
    </Modal>
  );
}

function summaryOf(text: string): string {
  const r = parseCrashReport(text);
  if (!r) return 'Unreadable';
  return `${r.summary}${r.page && r.page !== 'unknown' ? ` · on ${r.page}` : ''} · v${r.crashedAppVersion ?? r.appVersion}`;
}

/** Files → App settings → Crash reports. */
export function CrashReportsSettings() {
  const tk = useTokens();
  const names = useCrashReports(s => s.names);
  const [summaries, setSummaries] = useState<Record<string, string>>({});
  const [kind, setKind] = useState<CrashKind>('js-fatal');
  useEffect(() => { useCrashReports.getState().refresh(); }, []);
  useEffect(() => {
    let live = true;
    void (async () => {
      const out: Record<string, string> = {};
      for (const n of names.slice(0, 20)) { try { out[n] = summaryOf(await readCrashReport(n)); } catch { out[n] = 'Unreadable'; } }
      if (live) setSummaries(out);
    })();
    return () => { live = false; };
  }, [names]);
  const row = (first: boolean) => ({ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 10px 8px 14px', borderTop: first ? 0 : `1px solid ${tk.border.subtle}` });
  return (
    <section aria-label="Crash reports" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 4px', minHeight: 28 }}>
        <span style={{ font: `650 13px ${fontFamily.ui}`, color: tk.text.primary }}>Crash reports</span>
        <span style={{ fontSize: 12, color: tk.text.faint, flex: 1 }}>Kept on this device only (the last 20); nothing is sent anywhere</span>
        <Button size="sm" variant="ghost" onClick={() => { void reportProblem(); }}>Report a problem…</Button>
      </div>
      <div style={{ ...cardStyle(tk), overflow: 'hidden' }}>
        {names.map((n, i) => (
          <div key={n} style={row(i === 0)}>
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
              <span style={{ font: `600 12.5px ${fontFamily.ui}`, color: tk.text.primary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{summaries[n] ?? '…'}</span>
              <span style={{ fontSize: 11.5, color: tk.text.muted }}>{formatClock(reportFileTime(n) ?? 0)}</span>
            </div>
            <Button size="sm" variant="ghost" onClick={() => { void showCrashReport(n); }}>Show</Button>
            <Button size="sm" variant="ghost" onClick={() => { void copyCrashReport(n); }}>Copy</Button>
            <Button size="sm" variant="ghost" onClick={() => { void revealCrashReport(n); }}>{isTauri() ? 'Reveal' : 'Download'}</Button>
          </div>
        ))}
        {!names.length && (
          <div style={row(true)}>
            <span style={{ fontSize: 12, color: tk.text.muted }}>No crash reports. One is written when Playfield closes unexpectedly, stops on an error, or loses its graphics context.</span>
          </div>
        )}
        {devToolsOn() && (
          <div style={row(false)} data-dev-simulate-crash="">
            <span style={{ flex: 1, fontSize: 12, color: tk.text.muted }}>Developer: simulate a crash</span>
            <Select ariaLabel="Crash kind" value={kind} height={26} options={CRASH_KINDS.filter(k => isTauri() || !k.desktop).map(k => ({ value: k.id, label: k.label }))} onChange={v => setKind(v as CrashKind)} />
            <Button size="sm" variant="danger" onClick={() => { void simulateCrash(kind); }}>Simulate</Button>
          </div>
        )}
      </div>
    </section>
  );
}
