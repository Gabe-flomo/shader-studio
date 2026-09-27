/**
 * tauriFs.ts — the workspace folder in the desktop app, through the small
 * Rust command set in src-tauri/src/workspace.rs (paths relative to the
 * chosen folder; atomic writes; never creates the folder behind an unplugged
 * drive). Bytes travel raw both ways, not as JSON arrays.
 */
import { fsError, type FileStat, type WsFs } from './fs';

type Invoke = <T>(cmd: string, args?: Record<string, unknown> | Uint8Array, opts?: { headers: Record<string, string> }) => Promise<T>;

let invokeP: Promise<Invoke> | null = null;
const tauri = () => (invokeP ??= import('@tauri-apps/api/core').then(m => m.invoke as Invoke));

const b64 = (s: string) => { const bytes = new TextEncoder().encode(s); let bin = ''; for (const b of bytes) bin += String.fromCharCode(b); return btoa(bin); };

export function tauriFs(root: string): WsFs {
  const call = async <T>(cmd: string, args?: Record<string, unknown> | Uint8Array, opts?: { headers: Record<string, string> }): Promise<T> => {
    try { return await (await tauri())<T>(cmd, args, opts); } catch (e) { throw fsError(e); }
  };
  return {
    label: root,
    async probe() {
      try { return await (await tauri())<'ok' | 'gone' | 'permission'>('ws_probe', { root }); } catch { return 'gone'; }
    },
    async list(dirs, files) {
      const out = await call<Array<{ path: string; size: number; mtime: number }>>('ws_list', { root, dirs, files });
      return new Map(out.map(f => [f.path.normalize('NFC'), { size: f.size, mtime: f.mtime }]));
    },
    async readText(path) { return new TextDecoder().decode(await this.readBytes(path)); },
    async readBytes(path) { return new Uint8Array(await call<ArrayBuffer>('ws_read', { root, path })); },
    async write(path, data) {
      const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
      return call<FileStat>('ws_write', bytes, { headers: { 'x-ws-root': b64(root), 'x-ws-path': b64(path) } });
    },
    async remove(path) { await call('ws_remove', { root, path }); },
  };
}

/** Make the chosen folder (the suggested one may not exist yet). */
export async function createDesktopRoot(root: string): Promise<void> {
  await (await tauri())('ws_create_root', { root });
}

/** Watch the folder; `onChange` is called (throttled by the caller) when anything in it changes. */
export async function watchDesktop(root: string, onChange: () => void): Promise<() => void> {
  const { listen } = await import('@tauri-apps/api/event');
  const off = await listen('workspace-changed', () => onChange());
  try { await (await tauri())('ws_watch', { root }); } catch (e) { console.warn('[workspace] watching the folder failed; checking every so often instead', e); }
  return () => { off(); void tauri().then(i => i('ws_unwatch')).catch(() => {}); };
}

export async function revealDesktop(root: string): Promise<void> {
  await (await tauri())('ws_reveal', { root });
}
