/**
 * pluginSafety.ts — the page's side of "When a plug-in crashes"
 * (docs/audio-engine.md). The desktop engine tries each third-party Audio
 * Unit out in a throwaway process before the app loads it, refuses one that
 * crashed or hung there, and notes which plug-in was loading when the app
 * itself went down. Here:
 *
 * - at launch, the plug-in the app went down with (if any) is switched off in
 *   the Plugins setting with a note, and handed to crash recovery's dialog;
 * - a refused load and a trial run in progress become toasts;
 * - Try again (the toast, Files → App settings) runs the trial again now.
 */
import { parsePluginCrash, type PluginCrash } from '../files/autosave';
import { toast } from '../components/ui/toastStore';
import { usePluginSettings } from './pluginSettings';

const isTauri = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke: inv } = await import('@tauri-apps/api/core');
  return inv<T>(cmd, args);
}

export const PROBING_EVENT = 'audio-engine:plugin-probing';
export const BLOCKED_EVENT = 'audio-engine:plugin-blocked';

/** What a trial run found (src-tauri/src/audio_engine/safety.rs `Verdict`). */
export type ProbeStatus = 'ok' | 'failed' | 'crashed' | 'timeout';

export interface ProbeReport { code: string; name: string; status: ProbeStatus; message: string }

export function parseProbeReport(raw: unknown): ProbeReport | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const status = o.status;
  if (typeof o.code !== 'string' || (status !== 'ok' && status !== 'failed' && status !== 'crashed' && status !== 'timeout')) return null;
  return { code: o.code, name: typeof o.name === 'string' && o.name ? o.name : o.code, status, message: typeof o.message === 'string' ? o.message : '' };
}

/** The note the Plugins setting shows for a unit that crashed. */
export function crashNote(stage: string | undefined): string {
  return stage === 'window' ? 'Crashed Playfield while opening its window'
    : stage === 'preset' ? 'Crashed Playfield while restoring its settings'
    : stage === 'probe' ? 'Crashed when it was tried out'
    : stage === 'timeout' ? 'Didn’t finish loading when it was tried out'
    : 'Crashed Playfield while loading';
}

let crashTaken: Promise<PluginCrash | null> | null = null;

/** The plug-in the app went down with last time (desktop), once per launch; null when none. */
export function takePluginCrash(): Promise<PluginCrash | null> {
  return crashTaken ??= (isTauri() ? invoke<unknown>('ae_crash_take').then(parsePluginCrash).catch(() => null) : Promise.resolve(null));
}

/** Try a plug-in out again now (its trial run); on success it's switched back on. */
export async function retryPlugin(code: string, name = code): Promise<ProbeReport | null> {
  if (!isTauri()) return null;
  toast.info(`Trying ${name} out…`, { message: 'In a separate process, so a crash can’t take Playfield down.' });
  let report: ProbeReport | null = null;
  try { report = parseProbeReport(await invoke<unknown>('ae_plugin_retry', { code })); }
  catch (e) { toast.error(`Couldn’t try ${name} out`, { details: e instanceof Error ? e.message : String(e) }); return null; }
  if (!report) return null;
  if (report.status === 'ok' || report.status === 'failed') {
    usePluginSettings.getState().clearCrash(code);
    toast.success(`${report.name} loaded fine`, { message: report.status === 'failed' ? `It reported a problem, but didn’t crash: ${report.message}` : 'It’s switched on again.' });
  } else {
    usePluginSettings.getState().markCrashed(code, crashNote(report.status === 'timeout' ? 'timeout' : 'probe'), Date.now(), report.name);
    toast.error(`${report.name} still ${report.status === 'timeout' ? 'doesn’t finish loading' : 'crashes'}`, { message: report.message || 'It stays switched off.' });
  }
  return report;
}

/** Trust a plug-in whose trial didn't finish (one that waits for a licence dialog, say) without trying again: it's loaded in the app next time. */
export async function loadAnyway(code: string, name = code): Promise<void> {
  if (!isTauri()) return;
  try { await invoke<unknown>('ae_plugin_retry', { code, force: true }); }
  catch (e) { toast.error(`Couldn’t switch ${name} back on`, { details: e instanceof Error ? e.message : String(e) }); return; }
  usePluginSettings.getState().clearCrash(code);
  toast.success(`${name} is switched on again`, { message: 'It’s loaded without a trial next time. If it takes Playfield down, the next launch offers to recover your work.' });
}

export const TIMEOUT_NOTE = crashNote('timeout');

let installed = false;

/**
 * Desktop: switch off the plug-in the app went down with, and turn the
 * engine's trial runs and refusals into toasts. Returns that plug-in (for the
 * Recover dialog).
 */
export async function installPluginSafety(): Promise<PluginCrash | null> {
  if (!isTauri() || installed) return null;
  installed = true;
  const crash = await takePluginCrash();
  if (crash) usePluginSettings.getState().markCrashed(crash.code, crashNote(crash.stage), crash.at || Date.now(), crash.name);
  try {
    const { listen } = await import('@tauri-apps/api/event');
    await listen<{ code: string; name: string }>(PROBING_EVENT, e => {
      toast.info(`Trying ${e.payload.name} out first…`, { message: 'The first time a plug-in is used (and after it’s updated) it’s loaded in a separate process, so a crash can’t take Playfield down.' });
    });
    await listen<{ code: string; name: string; why: string; stage?: string }>(BLOCKED_EVENT, e => {
      const { code, name, why, stage } = e.payload;
      usePluginSettings.getState().markCrashed(code, crashNote(stage), Date.now(), name);
      toast.error(`${name} wasn’t loaded`, { message: why, action: { label: 'Try again', onClick: () => { void retryPlugin(code, name); } } });
    });
  } catch { /* no events: the refusal still comes back as the load's error */ }
  return crash;
}
