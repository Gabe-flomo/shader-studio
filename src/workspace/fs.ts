/**
 * fs.ts — the workspace folder as the sync engine sees it: list, read,
 * write (atomically), remove. Three backends:
 *
 *   memoryFs   tests (and a stand-in in the preview browser)
 *   handleFs   a FileSystemDirectoryHandle: a folder picked in Chrome/Edge
 *              (File System Access) or the browser's private file system (OPFS)
 *   tauriFs    the desktop app (tauriFs.ts: small Rust commands)
 *
 * Every error comes out as a WorkspaceFsError with a code, so the app can
 * tell "the drive is gone" from "that one file couldn't be written".
 */
import { foldCase } from './names';

export interface FileStat { size: number; mtime: number }

export type FsErrorCode = 'gone' | 'permission' | 'io';

export class WorkspaceFsError extends Error {
  code: FsErrorCode;
  constructor(code: FsErrorCode, message: string) { super(message); this.code = code; this.name = 'WorkspaceFsError'; }
}

export interface WsFs {
  /** What to show: a path on desktop, the folder's name in a browser. */
  label: string;
  /** Is the folder there and usable? Never throws. */
  probe(): Promise<'ok' | 'gone' | 'permission'>;
  /** Every file under these top-level folders (and these top-level files), by '/' path, NFC. */
  list(dirs: string[], files: string[]): Promise<Map<string, FileStat>>;
  readText(path: string): Promise<string>;
  readBytes(path: string): Promise<Uint8Array>;
  /** Write a whole file (temp file then rename where the backend can); makes folders as needed. */
  write(path: string, data: string | Uint8Array): Promise<FileStat>;
  /** Remove a file; one that isn't there is fine. Empty folders left behind are removed too where cheap. */
  remove(path: string): Promise<void>;
}

/** Temp files a write leaves while it's under way (and never lists). */
export const TEMP_MARK = '.ss-tmp-';
export const isSkippedName = (name: string) => name.startsWith(TEMP_MARK) || name === '.DS_Store' || name === 'Thumbs.db' || name.startsWith('._') || name.endsWith('.crswap');

/** Turn anything thrown by a backend into a WorkspaceFsError. */
export function fsError(e: unknown): WorkspaceFsError {
  if (e instanceof WorkspaceFsError) return e;
  const name = (e as { name?: string })?.name ?? '';
  const msg = e instanceof Error ? e.message : String(e);
  if (name === 'NotAllowedError' || name === 'SecurityError' || /permission|not allowed|denied/i.test(msg)) return new WorkspaceFsError('permission', msg);
  if (name === 'NotFoundError' || /^gone:|no such file|not found|os error 2\b|os error 6\b|device not configured|os error 5\b/i.test(msg)) return new WorkspaceFsError('gone', msg.replace(/^gone:\s*/, ''));
  return new WorkspaceFsError('io', msg);
}

const enc = new TextEncoder();
const dec = new TextDecoder();
export const toBytes = (d: string | Uint8Array) => (typeof d === 'string' ? enc.encode(d) : d);
export const toText = (b: Uint8Array) => dec.decode(b);

// ── In memory ───────────────────────────────────────────────────────────────

export interface MemoryFs extends WsFs {
  files: Map<string, { data: Uint8Array; mtime: number }>;
  /** Pretend the drive was pulled out (every call fails with 'gone') or put back. */
  setGone(gone: boolean): void;
  /** Fail writes after this many more succeed (a drive pulled out mid-sync). */
  failWritesAfter(n: number | null): void;
  /** Set a file as another app would (bumps its mtime). */
  put(path: string, data: string | Uint8Array, mtime?: number): void;
  clock: { now: number };
}

/** A folder in memory. Case-insensitive like macOS (a second name differing only in case replaces the first). */
export function memoryFs(label = 'Memory folder'): MemoryFs {
  const files = new Map<string, { data: Uint8Array; mtime: number }>();
  let gone = false;
  let writesLeft: number | null = null;
  const clock = { now: 1_000_000 };
  const tick = () => (clock.now += 1000);
  const check = () => { if (gone) throw new WorkspaceFsError('gone', 'The folder isn’t there (drive removed?)'); };
  const find = (p: string) => { const f = foldCase(p); for (const k of files.keys()) if (foldCase(k) === f) return k; return null; };
  return {
    label, files, clock,
    setGone(g) { gone = g; },
    failWritesAfter(n) { writesLeft = n; },
    put(p, d, mtime) { const k = find(p); if (k) files.delete(k); files.set(p, { data: toBytes(d), mtime: mtime ?? tick() }); },
    async probe() { return gone ? 'gone' : 'ok'; },
    async list(dirs, top) {
      check();
      const out = new Map<string, FileStat>();
      for (const [p, f] of files) {
        const first = p.split('/')[0];
        if ((p.includes('/') && dirs.includes(first)) || (!p.includes('/') && top.includes(p))) {
          if (!p.split('/').some(isSkippedName)) out.set(p.normalize('NFC'), { size: f.data.length, mtime: f.mtime });
        }
      }
      return out;
    },
    async readText(p) { check(); const k = find(p); if (!k) throw new WorkspaceFsError('io', `No file ${p}`); return toText(files.get(k)!.data); },
    async readBytes(p) { check(); const k = find(p); if (!k) throw new WorkspaceFsError('io', `No file ${p}`); return files.get(k)!.data.slice(); },
    async write(p, d) {
      check();
      if (writesLeft != null) { if (writesLeft <= 0) { gone = true; throw new WorkspaceFsError('gone', 'The drive was removed during the write'); } writesLeft--; }
      const k = find(p); if (k) files.delete(k);
      const data = toBytes(d).slice();
      const mtime = tick();
      files.set(p, { data, mtime });
      return { size: data.length, mtime };
    },
    async remove(p) { check(); const k = find(p); if (k) files.delete(k); },
  };
}

// ── A directory handle (File System Access, OPFS) ───────────────────────────

/** The parts of FileSystemDirectoryHandle used here (not all in TypeScript's DOM types yet). */
export interface DirHandleLike {
  kind?: 'directory';
  name: string;
  getDirectoryHandle(name: string, o?: { create?: boolean }): Promise<DirHandleLike>;
  getFileHandle(name: string, o?: { create?: boolean }): Promise<FileHandleLike>;
  removeEntry(name: string, o?: { recursive?: boolean }): Promise<void>;
  entries(): AsyncIterable<[string, DirHandleLike | FileHandleLike]>;
  queryPermission?(o: { mode: 'readwrite' }): Promise<PermissionState>;
  requestPermission?(o: { mode: 'readwrite' }): Promise<PermissionState>;
}
export interface FileHandleLike {
  kind: 'file';
  name: string;
  getFile(): Promise<File>;
  createWritable(o?: { keepExistingData?: boolean }): Promise<{ write(d: BufferSource | Blob | string): Promise<void>; close(): Promise<void>; abort?(): Promise<void> }>;
}

export function handleFs(root: DirHandleLike, label = root.name): WsFs {
  const dirOf = async (parts: string[], create: boolean) => {
    let d = root;
    for (const p of parts) d = await d.getDirectoryHandle(p, { create });
    return d;
  };
  const split = (p: string) => { const parts = p.split('/'); return { dirs: parts.slice(0, -1), name: parts[parts.length - 1] }; };
  const wrap = async <T>(run: () => Promise<T>): Promise<T> => { try { return await run(); } catch (e) { throw fsError(e); } };
  return {
    label,
    async probe() {
      try {
        if (root.queryPermission && (await root.queryPermission({ mode: 'readwrite' })) !== 'granted') return 'permission';
        // Touch it: a folder on a removed drive (or deleted) fails here.
        const it = root.entries()[Symbol.asyncIterator]();
        await it.next();
        return 'ok';
      } catch (e) { return fsError(e).code === 'permission' ? 'permission' : 'gone'; }
    },
    list: (dirs, top) => wrap(async () => {
      const out = new Map<string, FileStat>();
      const walkDir = async (d: DirHandleLike, prefix: string) => {
        for await (const [name, h] of d.entries()) {
          if (isSkippedName(name)) continue;
          const p = `${prefix}${name}`;
          if (h.kind === 'directory') await walkDir(h as DirHandleLike, `${p}/`);
          else { const f = await (h as FileHandleLike).getFile(); out.set(p.normalize('NFC'), { size: f.size, mtime: f.lastModified }); }
        }
      };
      for await (const [name, h] of root.entries()) {
        if (h.kind === 'directory' && dirs.includes(name.normalize('NFC'))) await walkDir(h as DirHandleLike, `${name.normalize('NFC')}/`);
        else if (h.kind === 'file' && top.includes(name.normalize('NFC'))) { const f = await (h as FileHandleLike).getFile(); out.set(name.normalize('NFC'), { size: f.size, mtime: f.lastModified }); }
      }
      return out;
    }),
    readText: p => wrap(async () => { const { dirs, name } = split(p); return (await (await (await dirOf(dirs, false)).getFileHandle(name)).getFile()).text(); }),
    readBytes: p => wrap(async () => { const { dirs, name } = split(p); return new Uint8Array(await (await (await (await dirOf(dirs, false)).getFileHandle(name)).getFile()).arrayBuffer()); }),
    write: (p, data) => wrap(async () => {
      const { dirs, name } = split(p);
      const d = await dirOf(dirs, true);
      const fh = await d.getFileHandle(name, { create: true });
      // createWritable writes to a swap file and swaps it in on close: the old file stays whole until then.
      const w = await fh.createWritable();
      try {
        const bytes = toBytes(data);
        const copy = new Uint8Array(bytes.byteLength); copy.set(bytes);
        await w.write(copy);
        await w.close();
      } catch (e) { try { await w.abort?.(); } catch { /* already failed */ } throw e; }
      const f = await fh.getFile();
      return { size: f.size, mtime: f.lastModified };
    }),
    remove: p => wrap(async () => {
      const { dirs, name } = split(p);
      let d: DirHandleLike;
      try { d = await dirOf(dirs, false); } catch { return; }
      try { await d.removeEntry(name); } catch (e) { if (fsError(e).code !== 'gone') throw e; }
      // Tidy empty folders left behind (a graph moved out of a folder).
      for (let i = dirs.length; i > 1; i--) {
        try {
          const parent = await dirOf(dirs.slice(0, i - 1), false);
          const child = await parent.getDirectoryHandle(dirs[i - 1]);
          const it = child.entries()[Symbol.asyncIterator]();
          if (!(await it.next()).done) break;
          await parent.removeEntry(dirs[i - 1]);
        } catch { break; }
      }
    }),
  };
}
