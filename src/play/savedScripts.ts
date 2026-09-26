/**
 * savedScripts — sketches saved from the Script editor as starters of your
 * own: name, code and the layer settings the sketch expects. Kept in
 * localStorage, listed beside the built-in starters, and importable into
 * another script layer (whole, or just its functions).
 */
import { useSyncExternalStore } from 'react';

export interface SavedScript { id: string; name: string; code: string; clear: boolean; readPicture: boolean; savedAt: number }

const KEY = 'shader-studio:play:savedScripts';
const listeners = new Set<() => void>();
let cache: SavedScript[] | null = null;

function read(): SavedScript[] {
  if (cache) return cache;
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    cache = Array.isArray(raw) ? raw.filter((s): s is SavedScript => !!s && typeof s.id === 'string' && typeof s.name === 'string' && typeof s.code === 'string')
      .map(s => ({ ...s, clear: s.clear !== false, readPicture: !!s.readPicture, savedAt: typeof s.savedAt === 'number' ? s.savedAt : 0 })) : [];
  } catch { cache = []; }
  return cache;
}
function write(next: SavedScript[]) {
  cache = next;
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* storage full or blocked: the list still works for this session */ }
  for (const l of listeners) l();
}

export function listSavedScripts(): SavedScript[] { return read(); }

/** Save (or overwrite, by name) a sketch as a starter. Returns the entry. */
export function saveScript(name: string, code: string, settings: { clear: boolean; readPicture: boolean }): SavedScript {
  const trimmed = name.trim() || 'Untitled sketch';
  const existing = read().find(s => s.name.toLowerCase() === trimmed.toLowerCase());
  const entry: SavedScript = { id: existing?.id ?? `sk_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, name: trimmed, code, clear: settings.clear, readPicture: settings.readPicture, savedAt: Date.now() };
  write([...read().filter(s => s.id !== entry.id), entry].sort((a, b) => a.name.localeCompare(b.name)));
  return entry;
}

export function removeScript(id: string) { write(read().filter(s => s.id !== id)); }

export function useSavedScripts(): SavedScript[] {
  return useSyncExternalStore(cb => { listeners.add(cb); return () => { listeners.delete(cb); }; }, read, read);
}

/** Top-level function declarations in a sketch (name and source), for importing just the pieces you want. */
export function scriptFunctions(code: string): Array<{ name: string; source: string }> {
  const out: Array<{ name: string; source: string }> = [];
  const re = /^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code))) {
    // From the declaration to its matching closing brace.
    let i = code.indexOf('{', m.index); if (i < 0) continue;
    let depth = 0, end = -1;
    for (; i < code.length; i++) { const c = code[i]; if (c === '{') depth++; else if (c === '}' && --depth === 0) { end = i + 1; break; } }
    if (end < 0) continue;
    out.push({ name: m[1], source: code.slice(m.index, end) });
  }
  return out;
}
