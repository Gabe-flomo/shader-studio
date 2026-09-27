/**
 * storage.ts — presentations saved in the browser, one per name, under
 * `shader-studio-presentation:<name>` (the name is the title). They are part
 * of the library (library.ts), so Export everything and the backup folder
 * carry them like graphs, as .present.json files under presentations/.
 */
import { safeSetItem, type FileResult } from '../utils/fileIO';
import { freePresentationName, PRESENTATION_FOLDER_SCOPE, PRESENTATION_KEY_PREFIX } from '../utils/library';
import { getFolderForItem, moveItemsToFolder, removeItemsFromFolders } from '../utils/assetFolders';
import { parsePresentation, type Presentation } from '../types/presentation';

export const PRESENTATION_PREFIX = PRESENTATION_KEY_PREFIX;
/** Fired on window whenever the saved list changes. */
export const PRESENTATIONS_CHANGED = 'presentations-changed';
const LAST_KEY = 'shader-studio:settings:lastPresentation';

export interface PresentationEntry {
  name: string;
  steps: number;
  /** Plays it carries. */
  sources: number;
  updatedAt: number;
  /** The first source's still, for the list. */
  poster?: string;
}

const changed = () => { try { window.dispatchEvent(new Event(PRESENTATIONS_CHANGED)); } catch { /* no window in tests */ } };

/** Every saved presentation, newest first. */
export function listPresentations(): PresentationEntry[] {
  const out: PresentationEntry[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(PRESENTATION_PREFIX)) continue;
      try {
        const v = JSON.parse(localStorage.getItem(k) ?? 'null') as { steps?: unknown[]; sources?: Array<{ poster?: unknown }>; updatedAt?: number } | null;
        if (!v || !Array.isArray(v.steps)) continue;
        const sources = Array.isArray(v.sources) ? v.sources : [];
        const poster = sources.map(s => s?.poster).find((p): p is string => typeof p === 'string' && p.startsWith('data:image/'));
        out.push({ name: k.slice(PRESENTATION_PREFIX.length), steps: v.steps.length, sources: sources.length, updatedAt: typeof v.updatedAt === 'number' ? v.updatedAt : 0, poster });
      } catch { /* unreadable: not offered */ }
    }
  } catch { /* storage unavailable */ }
  return out.sort((a, b) => b.updatedAt - a.updatedAt || a.name.localeCompare(b.name));
}

export function loadPresentation(name: string): Presentation | null {
  try { return parsePresentation(JSON.parse(localStorage.getItem(PRESENTATION_PREFIX + name) ?? 'null')); } catch { return null; }
}

export function presentationExists(name: string): boolean {
  try { return localStorage.getItem(PRESENTATION_PREFIX + name) !== null; } catch { return false; }
}

export function savePresentation(name: string, p: Presentation): FileResult {
  const r = safeSetItem(PRESENTATION_PREFIX + name, JSON.stringify(p), `presentation "${name}"`);
  if (r.ok) { rememberLast(name); changed(); }
  return r;
}

/** What was stored, to put back with `restorePresentation` (Undo). */
export interface DeletedPresentation { name: string; value: string; folder: string | null }

export function deletePresentation(name: string): DeletedPresentation | null {
  let value: string | null = null;
  const folder = getFolderForItem(PRESENTATION_FOLDER_SCOPE, name);
  try { value = localStorage.getItem(PRESENTATION_PREFIX + name); localStorage.removeItem(PRESENTATION_PREFIX + name); } catch { /* nothing to do */ }
  if (folder) removeItemsFromFolders(PRESENTATION_FOLDER_SCOPE, [name]);
  changed();
  return value === null ? null : { name, value, folder };
}

/** Put a deleted presentation back (under a free name if its own was taken meanwhile). */
export function restorePresentation(d: DeletedPresentation): string {
  const name = freeName(d.name);
  let value = d.value;
  if (name !== d.name) { try { value = JSON.stringify({ ...JSON.parse(d.value), title: name }); } catch { /* keep as it was */ } }
  safeSetItem(PRESENTATION_PREFIX + name, value, `presentation "${name}"`);
  if (d.folder) moveItemsToFolder(PRESENTATION_FOLDER_SCOPE, [name], d.folder);
  changed();
  return name;
}

/** Move a presentation to a new name (and title), keeping its folder. False when that name is taken. */
export function renamePresentation(from: string, to: string): boolean {
  if (from === to) return true;
  if (presentationExists(to)) return false;
  const p = loadPresentation(from);
  if (!p) return false;
  const r = savePresentation(to, { ...p, title: to });
  if (!r.ok) return false;
  try { localStorage.removeItem(PRESENTATION_PREFIX + from); } catch { /* kept under both */ }
  const folder = getFolderForItem(PRESENTATION_FOLDER_SCOPE, from);
  if (folder) { removeItemsFromFolders(PRESENTATION_FOLDER_SCOPE, [from]); moveItemsToFolder(PRESENTATION_FOLDER_SCOPE, [to], folder); }
  changed();
  return true;
}

/** `base`, or `base (2)`, `base (3)`… whichever is free. */
export function freeName(base: string): string {
  return freePresentationName(base, { get: k => { try { return localStorage.getItem(k); } catch { return null; } } });
}

export function rememberLast(name: string): void {
  try { localStorage.setItem(LAST_KEY, name); } catch { /* a convenience */ }
}
export function lastPresentation(): string | null {
  try { return localStorage.getItem(LAST_KEY); } catch { return null; }
}
