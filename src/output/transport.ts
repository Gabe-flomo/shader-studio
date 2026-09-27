/**
 * transport.ts — how the main window and the output window reach each other.
 *
 *   desktop app  Tauri events between the two webviews ('pf-output-down' to the
 *                output, 'pf-output-up' back); a record too big for an event
 *                waits in the app (output_record_put / output_record_get)
 *   browser      a BroadcastChannel between the page and its popup
 */
import type { DownMsg, OutputRecord, UpMsg } from './protocol';

export const CHANNEL = 'playfield-output';
export const EVENT_DOWN = 'pf-output-down';
export const EVENT_UP = 'pf-output-up';
export const OUTPUT_LABEL = 'output';

export function isDesktopApp(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export interface Link<Out, In> {
  send(msg: Out): void;
  onMessage(cb: (msg: In) => void): () => void;
  close(): void;
}

/** A BroadcastChannel link (the browser, and tests). */
export function channelLink<Out, In>(name = CHANNEL): Link<Out, In> {
  const ch = new BroadcastChannel(name);
  const subs = new Set<(m: In) => void>();
  ch.onmessage = e => { for (const cb of subs) cb(e.data as In); };
  return {
    send: msg => { try { ch.postMessage(msg); } catch { /* the other side is gone */ } },
    onMessage: cb => { subs.add(cb); return () => { subs.delete(cb); }; },
    close: () => { subs.clear(); ch.close(); },
  };
}

/** A Tauri event link: `emitTo` the other window, listen for our own event. */
export function tauriLink<Out, In>(target: string, sendEvent: string, listenEvent: string): Link<Out, In> {
  const subs = new Set<(m: In) => void>();
  let unlisten: (() => void) | null = null;
  let closed = false;
  const api = import('@tauri-apps/api/event');
  void api.then(({ listen }) => listen<In>(listenEvent, e => { for (const cb of subs) cb(e.payload); })).then(u => { if (closed) u(); else unlisten = u; }, () => {});
  return {
    send: msg => { void api.then(({ emitTo }) => emitTo(target, sendEvent, msg)).catch(() => {}); },
    onMessage: cb => { subs.add(cb); return () => { subs.delete(cb); }; },
    close: () => { closed = true; subs.clear(); unlisten?.(); },
  };
}

/** The main window's end. */
export function mainLink(): Link<DownMsg, UpMsg> {
  return isDesktopApp() ? tauriLink<DownMsg, UpMsg>(OUTPUT_LABEL, EVENT_DOWN, EVENT_UP) : channelLink<DownMsg, UpMsg>();
}

/** The output window's end. */
export function outputLink(): Link<UpMsg, DownMsg> {
  return isDesktopApp() ? tauriLink<UpMsg, DownMsg>('main', EVENT_UP, EVENT_DOWN) : channelLink<UpMsg, DownMsg>();
}

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke: inv } = await import('@tauri-apps/api/core');
  return inv<T>(cmd, args);
}

/** Desktop: leave the record with the app for the output to fetch. */
export async function putRecord(record: OutputRecord): Promise<void> {
  await invoke('output_record_put', { json: JSON.stringify(record) });
}

export async function getRecord(): Promise<OutputRecord | null> {
  const json = await invoke<string>('output_record_get');
  try { return json ? JSON.parse(json) as OutputRecord : null; } catch { return null; }
}

// ── Displays and the window (desktop) ──────────────────────────────────────

export interface Monitor { index: number; name: string; x: number; y: number; width: number; height: number; scale: number; primary: boolean }

export async function listMonitors(): Promise<Monitor[]> {
  if (isDesktopApp()) return invoke<Monitor[]>('output_monitors');
  // Chrome's Window Management API: every screen, once the person allows it.
  const w = window as unknown as { getScreenDetails?: () => Promise<{ screens: { label?: string; left: number; top: number; width: number; height: number; devicePixelRatio: number; isPrimary: boolean }[] }> };
  if (!w.getScreenDetails) return [];
  try {
    const d = await w.getScreenDetails();
    return d.screens.map((s, index) => ({ index, name: s.label || `Screen ${index + 1}`, x: s.left, y: s.top, width: Math.round(s.width * s.devicePixelRatio), height: Math.round(s.height * s.devicePixelRatio), scale: s.devicePixelRatio, primary: s.isPrimary }));
  } catch { return []; }
}

export async function openDesktopOutput(monitor: number | null, fullscreen: boolean): Promise<void> {
  await invoke('output_open', { monitor, fullscreen });
}

export async function closeDesktopOutput(): Promise<void> {
  await invoke('output_close');
}

export async function setDesktopFullscreen(on: boolean): Promise<void> {
  await invoke('output_fullscreen', { on });
}
