/**
 * storage.ts — presentations saved in the browser, one per name, under
 * `shader-studio-presentation:<name>` (the name is the title). They are part
 * of the library (library.ts), so Export everything and the backup folder
 * carry them like graphs, as readable files under presentations/.
 */
import { safeSetItem, type FileResult } from '../utils/fileIO';
import { parsePresentation, type Presentation } from '../types/presentation';

export const PRESENTATION_PREFIX = 'shader-studio-presentation:';
/** Fired on window whenever the saved list changes. */
export const PRESENTATIONS_CHANGED = 'presentations-changed';
const LAST_KEY = 'shader-studio:settings:lastPresentation';

export interface PresentationEntry { name: string; steps: number; updatedAt: number }

const changed = () => { try { window.dispatchEvent(new Event(PRESENTATIONS_CHANGED)); } catch { /* no window in tests */ } };

/** Every saved presentation, newest first, read without parsing their sources. */
export function listPresentations(): PresentationEntry[] {
  const out: PresentationEntry[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(PRESENTATION_PREFIX)) continue;
      try {
        const v = JSON.parse(localStorage.getItem(k) ?? 'null') as { steps?: unknown[]; updatedAt?: number } | null;
        if (!v || !Array.isArray(v.steps)) continue;
        out.push({ name: k.slice(PRESENTATION_PREFIX.length), steps: v.steps.length, updatedAt: typeof v.updatedAt === 'number' ? v.updatedAt : 0 });
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

export function deletePresentation(name: string): void {
  try { localStorage.removeItem(PRESENTATION_PREFIX + name); } catch { /* nothing to do */ }
  changed();
}

/** Move a presentation to a new name (and title). False when that name is taken. */
export function renamePresentation(from: string, to: string): boolean {
  if (from === to) return true;
  if (presentationExists(to)) return false;
  const p = loadPresentation(from);
  if (!p) return false;
  const r = savePresentation(to, { ...p, title: to });
  if (!r.ok) return false;
  try { localStorage.removeItem(PRESENTATION_PREFIX + from); } catch { /* kept under both */ }
  changed();
  return true;
}

/** `base`, or `base 2`, `base 3`… whichever is free. */
export function freeName(base: string): string {
  const b = base.trim() || 'Untitled presentation';
  if (!presentationExists(b)) return b;
  let i = 2;
  while (presentationExists(`${b} ${i}`)) i++;
  return `${b} ${i}`;
}

export function rememberLast(name: string): void {
  try { localStorage.setItem(LAST_KEY, name); } catch { /* a convenience */ }
}
export function lastPresentation(): string | null {
  try { return localStorage.getItem(LAST_KEY); } catch { return null; }
}
