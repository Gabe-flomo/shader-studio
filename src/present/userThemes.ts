/**
 * userThemes.ts — your saved Present themes ("Save as my theme"): a built-in
 * theme with its changed settings and the typography (fonts, size, line
 * height, colours), under a name. Kept in localStorage beside your palettes
 * (USER_THEMES_KEY, part of library.json and the backups like them), listed
 * after the built-ins in the Style panel, and deletable.
 *
 * Applying one copies it into the presentation (style.theme, with `saved`
 * naming where it came from, and style.typography), so the presentation,
 * its file and its export never need this list.
 */
import { parseTheme, type PresentTheme } from '../types/presentTheme';
import { parseTypography, type PresentTypography } from '../types/presentationStyle';

export const USER_THEMES_KEY = 'shader-studio-present:themes';
export const USER_THEMES_CHANGED = 'present-themes-changed';
const MAX = 60;

export interface UserTheme {
  id: string;
  name: string;
  createdAt: number;
  theme: PresentTheme;
  typography?: PresentTypography;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const cleanName = (n: string) => n.replace(/\s+/g, ' ').trim().slice(0, 60) || 'My theme';

/** Your saved themes from storage (junk left out). */
export function parseUserThemes(raw: unknown): UserTheme[] {
  if (!Array.isArray(raw)) return [];
  const out: UserTheme[] = [];
  const seen = new Set<string>();
  for (const x of raw.slice(0, MAX)) {
    if (!isObj(x) || typeof x.id !== 'string' || !x.id || x.id.length > 80 || seen.has(x.id) || typeof x.name !== 'string') continue;
    // Classic unchanged parses as nothing: still a theme to keep.
    const theme = parseTheme(x.theme) ?? (isObj(x.theme) && x.theme.id === 'classic' ? { id: 'classic' as const } : undefined);
    if (!theme) continue;
    delete theme.saved;
    const t: UserTheme = { id: x.id, name: cleanName(x.name), createdAt: typeof x.createdAt === 'number' ? x.createdAt : 0, theme };
    const typo = parseTypography(x.typography);
    if (typo) t.typography = typo;
    seen.add(x.id);
    out.push(t);
  }
  return out;
}

function read(): UserTheme[] {
  try { return parseUserThemes(JSON.parse(localStorage.getItem(USER_THEMES_KEY) ?? '[]')); } catch { return []; }
}

function write(list: UserTheme[]): void {
  try { localStorage.setItem(USER_THEMES_KEY, JSON.stringify(list)); } catch (e) { throw new Error(`Couldn’t save the theme: ${e instanceof Error ? e.message : String(e)}`); }
  try { window.dispatchEvent(new Event(USER_THEMES_CHANGED)); } catch { /* no window (tests) */ }
}

/** Your saved themes, oldest first (the order they were made). */
export function listUserThemes(): UserTheme[] { return read().sort((a, b) => a.createdAt - b.createdAt); }

/** A name none of your themes has: `name`, or `name (2)`… */
export function freeThemeName(name: string): string {
  const taken = new Set(read().map(t => t.name));
  const b = cleanName(name);
  if (!taken.has(b)) return b;
  let i = 2;
  while (taken.has(`${b} (${i})`)) i++;
  return `${b} (${i})`;
}

export function saveUserTheme(name: string, theme: PresentTheme, typography: PresentTypography | undefined): UserTheme {
  const list = read();
  if (list.length >= MAX) throw new Error(`You have ${MAX} saved themes: delete one first.`);
  const { saved: _s, ...plain } = theme;
  void _s;
  const t: UserTheme = { id: `th-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, name: cleanName(name), createdAt: Date.now(), theme: plain };
  if (typography && Object.keys(typography).length) t.typography = typography;
  write([...list, t]);
  return t;
}

/** Delete one of your themes. Returns a function that puts it back, or null. */
export function deleteUserTheme(id: string): (() => void) | null {
  const list = read();
  const gone = list.find(t => t.id === id);
  if (!gone) return null;
  write(list.filter(t => t.id !== id));
  return () => write([...read().filter(t => t.id !== id), gone]);
}
