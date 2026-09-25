/**
 * recordingsFolder.ts — where recordings and stills are saved.
 *
 *   folder     straight into a folder, no asking: Videos/Shader Studio in the
 *              desktop app by default; in Chrome and Edge a folder you pick
 *              (the browser asks again each visit, one click).
 *   ask        a save dialog each time (the desktop app; Chrome and Edge).
 *   downloads  the browser's usual download (the default on the web; the
 *              only way in Safari and Firefox, which can't ask or pick).
 *
 * A name already taken in the folder gets " (2)", " (3)"… rather than
 * replacing the older recording.
 */
import { idb, type DirHandle, type PickerWindow } from './backupFolder';

export type RecordingsMode = 'folder' | 'ask' | 'downloads';
export interface RecordingsSettings { mode: RecordingsMode; /** Desktop: the folder's path (unset = the default). */ dir?: string }

const KEY = 'shader-studio:settings:recordings';
const HANDLE = 'recordings';
const isTauri = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
type SaveWindow = Window & { showSaveFilePicker?: (o: { suggestedName: string; id?: string; types?: Array<{ description: string; accept: Record<string, string[]> }> }) => Promise<{ createWritable(): Promise<{ write(d: Blob): Promise<void>; close(): Promise<void> }> }> };

/** What this browser can do: pick a folder, ask with a save dialog. */
export function recordingsCan(): { folder: boolean; ask: boolean } {
  if (isTauri()) return { folder: true, ask: true };
  if (typeof window === 'undefined') return { folder: false, ask: false };
  return { folder: typeof (window as PickerWindow).showDirectoryPicker === 'function', ask: typeof (window as SaveWindow).showSaveFilePicker === 'function' };
}

export function recordingsSettings(): RecordingsSettings {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as RecordingsSettings | null;
    if (v && (v.mode === 'folder' || v.mode === 'ask' || v.mode === 'downloads')) return v;
  } catch { /* default below */ }
  return { mode: isTauri() ? 'folder' : 'downloads' };
}

const listeners = new Set<() => void>();
export function onRecordingsSettings(cb: () => void): () => void { listeners.add(cb); return () => { listeners.delete(cb); }; }
function save(s: RecordingsSettings): void {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* preference only */ }
  for (const l of listeners) l();
}

export function setRecordingsMode(mode: RecordingsMode): void { save({ ...recordingsSettings(), mode }); }

/** Back to the default: Videos/Shader Studio on desktop, Downloads on the web. */
export async function resetRecordings(): Promise<void> {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
  await idb('readwrite', s => s.delete(HANDLE));
  for (const l of listeners) l();
}

async function defaultDesktopDir(): Promise<string> {
  const { videoDir, homeDir, join } = await import('@tauri-apps/api/path');
  try { return await join(await videoDir(), 'Shader Studio'); } catch { return join(await homeDir(), 'Shader Studio Recordings'); }
}

/** Where recordings go, in words: a path, a folder name, "Downloads" or "Ask each time". */
export async function recordingsLabel(): Promise<string> {
  const s = recordingsSettings();
  if (s.mode === 'ask') return 'Ask each time';
  if (s.mode === 'downloads') return 'Downloads';
  if (isTauri()) return s.dir ?? await defaultDesktopDir();
  const h = await idb<DirHandle>('readonly', st => st.get(HANDLE));
  return h ? h.name : 'No folder picked';
}

/** Pick the folder (desktop: a path; browser: a folder handle) and switch to it. */
export async function chooseRecordingsFolder(): Promise<boolean> {
  if (isTauri()) {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const dir = await open({ directory: true, multiple: false });
    if (typeof dir !== 'string') return false;
    save({ mode: 'folder', dir });
    return true;
  }
  const pick = (window as PickerWindow).showDirectoryPicker;
  if (!pick) return false;
  const h = await pick({ id: 'shader-studio-recordings', mode: 'readwrite' });
  await idb('readwrite', st => st.put(h, HANDLE));
  save({ mode: 'folder' });
  return true;
}

/** Browser folder mode: does the folder need a click to allow it again this visit? */
export async function recordingsNeedPermission(): Promise<boolean> {
  if (isTauri() || recordingsSettings().mode !== 'folder') return false;
  const h = await idb<DirHandle>('readonly', st => st.get(HANDLE));
  return !!h && (await h.queryPermission({ mode: 'readwrite' })) !== 'granted';
}

/** Allow the picked folder again (needs a click). */
export async function allowRecordingsFolder(): Promise<boolean> {
  const h = await idb<DirHandle>('readonly', st => st.get(HANDLE));
  return !!h && (await h.requestPermission({ mode: 'readwrite' })) === 'granted';
}

/** "Sunset" → "Sunset", a name safe for any file system. */
export function recordingBaseName(graphName: string | null | undefined): string {
  const n = (graphName ?? '').replace(/[/\\:*?"<>|]/g, '-').trim();
  return n || 'shader graph';
}

const splitName = (file: string) => { const i = file.lastIndexOf('.'); return i > 0 ? [file.slice(0, i), file.slice(i)] : [file, '']; };

/**
 * Desktop: the path a recording goes to (the FFmpeg export needs it before it
 * starts): the folder with a free name, or a save dialog. Null when cancelled.
 */
export async function recordingPath(file: string): Promise<string | null> {
  const s = recordingsSettings();
  const { join } = await import('@tauri-apps/api/path');
  const dir = s.dir ?? await defaultDesktopDir();
  const [base, ext] = splitName(file);
  if (s.mode === 'folder') {
    const fs = await import('@tauri-apps/plugin-fs');
    await fs.mkdir(dir, { recursive: true });
    let p = await join(dir, file), n = 2;
    while (await fs.exists(p)) p = await join(dir, `${base} (${n++})${ext}`);
    return p;
  }
  const { save: dialog } = await import('@tauri-apps/plugin-dialog');
  const p = await dialog({ defaultPath: await join(dir, file), filters: [{ name: ext.slice(1).toUpperCase() || 'File', extensions: [ext.slice(1) || '*'] }] });
  return typeof p === 'string' ? p : null;
}

/**
 * Save a finished recording or still where the settings say. Returns where it
 * went (a path or a folder/file name), or null when the save was cancelled.
 */
export async function saveRecording(blob: Blob, file: string): Promise<string | null> {
  if (isTauri()) {
    const path = await recordingPath(file);
    if (!path) return null;
    const { writeFile } = await import('@tauri-apps/plugin-fs');
    await writeFile(path, new Uint8Array(await blob.arrayBuffer()));
    return path;
  }
  const s = recordingsSettings();
  if (s.mode === 'folder') {
    const h = await idb<DirHandle>('readonly', st => st.get(HANDLE));
    if (h && (await h.queryPermission({ mode: 'readwrite' })) === 'granted') {
      const [base, ext] = splitName(file);
      let name = file, n = 2;
      for (;;) { try { await h.getFileHandle(name); name = `${base} (${n++})${ext}`; } catch { break; } }
      const w = await (await h.getFileHandle(name, { create: true })).createWritable();
      await (w as unknown as { write(d: Blob): Promise<void> }).write(blob);
      await w.close();
      return `${h.name}/${name}`;
    }
  }
  if (s.mode === 'ask') {
    const picker = (window as SaveWindow).showSaveFilePicker;
    if (picker) {
      try {
        const ext = splitName(file)[1];
        const fh = await picker({ suggestedName: file, id: 'shader-studio-recordings', types: ext ? [{ description: 'Recording', accept: { [blob.type || 'application/octet-stream']: [ext] } }] : undefined });
        const w = await fh.createWritable();
        await w.write(blob);
        await w.close();
        return file;
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') return null;
        throw e;
      }
    }
  }
  // Downloads (or a folder that isn't allowed this visit, or no picker): the usual download.
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: file });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return `Downloads/${file}`;
}
