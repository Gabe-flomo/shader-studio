/**
 * library.ts — splat scans in the library (docs/splat-scene.md "Files").
 *
 * A scan is kept like a video: its bytes in the library's file store (lib/backgroundLibrary.ts, the `videos` store),
 * the node naming it by `videoId`. So it travels the way videos do: in .play file bundles (bundle.ts videoIdsIn finds
 * `videoId`), library ZIPs, the backup folder and the workspace folder (shared between the browser and the desktop
 * app). Video lists leave scans out (isSplatType). Each format has its own type, `model/x-splat-<format>`.
 */
import { addVideoFile, getVideo, isSplatType, listVideos, type LibraryVideoMeta } from '../backgroundLibrary';
import { detectFormat, formatFromName, type SplatFormat } from './format';

/** The biggest scan a node takes (the whole file is read into memory to parse it). */
export const MAX_SPLAT_FILE_BYTES = 1024 * 1024 * 1024;
/** What the file picker and drops accept. */
export const SPLAT_ACCEPT = '.ply,.splat,.spz,.ksplat';

export const splatMime = (f: SplatFormat) => `model/x-splat-${f}`;
export const formatOfType = (type: string): SplatFormat | null => {
  const m = /^model\/x-splat-(ply|splat|spz|ksplat)/.exec(type);
  return m ? (m[1] as SplatFormat) : null;
};

const mb = (n: number) => `${(n / (1024 * 1024)).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;

/** Is this file one a Splat Scene takes (by name)? */
export const isSplatFileName = (name: string) => formatFromName(name) !== null;

/** Why a file can't be a scan, or null when it can (checked before anything is stored). */
export async function splatFileProblem(file: Blob & { name?: string }): Promise<string | null> {
  const name = file.name ?? '';
  if (file.size > MAX_SPLAT_FILE_BYTES) return `This scan is ${mb(file.size)}; a Splat Scene takes up to ${mb(MAX_SPLAT_FILE_BYTES)}. Export it smaller (fewer splats, or .spz).`;
  if (file.size === 0) return 'This file is empty.';
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const fmt = detectFormat(head, name);
  if (!fmt) return `“${name || 'This file'}” isn’t a splat scan Playfield knows (.ply, .splat or .spz).`;
  if (fmt === 'ksplat') return '.ksplat files aren’t read yet. Export the scan as .ply, .splat or .spz from the app that made it.';
  return null;
}

/** Keep a scan in the library. The same name and size again reuses its record. Throws a plain sentence when it can't. */
export async function addSplatFile(file: Blob & { name?: string }, thumb?: string): Promise<LibraryVideoMeta> {
  const problem = await splatFileProblem(file);
  if (problem) throw new Error(problem);
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const fmt = detectFormat(head, file.name ?? '')!;
  const typed = new Blob([file], { type: splatMime(fmt) });
  return addVideoFile(Object.assign(typed, { name: file.name ?? `Scan.${fmt}` }), { name: file.name ?? `Scan.${fmt}`, poster: thumb ? { thumb } : undefined });
}

/** Every kept scan, newest first. */
export async function listSplats(): Promise<LibraryVideoMeta[]> {
  return (await listVideos({ withSplats: true })).filter(v => isSplatType(v.type));
}

/** A kept scan's bytes and name, or null when this device doesn't have it. */
export async function getSplatFile(id: string): Promise<{ name: string; bytes: number; blob: Blob } | null> {
  const v = await getVideo(id);
  return v ? { name: v.name, bytes: v.bytes, blob: v.blob } : null;
}
