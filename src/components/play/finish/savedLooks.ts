/**
 * savedLooks.ts — grades saved as your own Looks, on this device (like the
 * palette presets in lib/palette.ts). A look keeps the grade's numbers that
 * differ from the defaults, its curves and its tone mapping; picking it sets
 * a grade to exactly that (types/playFinish.ts applyLook).
 */
import { safeSetItem, type FileResult } from '../../../utils/fileIO';
import { parseCurves, type GradeLook } from '../../../types/playFinish';

const KEY = 'shader-studio:finish-looks';
/** Fired on window when the saved looks change, so every open grade's picker refreshes. */
export const SAVED_LOOKS_CHANGED = 'finish-looks-changed';

export interface SavedLook extends GradeLook { savedAt: number }

export function loadSavedLooks(): SavedLook[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    if (!Array.isArray(raw)) return [];
    return raw.flatMap((x): SavedLook[] => {
      if (!x || typeof x.id !== 'string' || typeof x.name !== 'string' || !x.values || typeof x.values !== 'object') return [];
      const values: Record<string, number> = {};
      for (const [k, v] of Object.entries(x.values as Record<string, unknown>)) if (typeof v === 'number' && Number.isFinite(v)) values[k] = v;
      return [{ id: x.id, name: x.name.slice(0, 60), description: typeof x.description === 'string' ? x.description : 'Saved on this device', values, tone: typeof x.tone === 'string' ? x.tone : 'none', curves: parseCurves(x.curves), savedAt: typeof x.savedAt === 'number' ? x.savedAt : 0 }];
    });
  } catch {
    return [];
  }
}

function write(list: SavedLook[]): FileResult {
  const r = safeSetItem(KEY, JSON.stringify(list), 'saved looks');
  if (r.ok && typeof window !== 'undefined') window.dispatchEvent(new Event(SAVED_LOOKS_CHANGED));
  return r;
}

/** Save a look; one with the same name is replaced. Returns its id. */
export function saveLook(name: string, look: Pick<GradeLook, 'values' | 'tone' | 'curves'>): { result: FileResult; id: string } {
  const id = `look_${Date.now().toString(36)}_${Math.round(Math.random() * 1e6).toString(36)}`;
  const list = loadSavedLooks().filter(x => x.name !== name);
  return { result: write([...list, { id, name, description: 'Saved on this device', ...look, savedAt: Date.now() }]), id };
}

export function deleteLook(id: string): FileResult {
  return write(loadSavedLooks().filter(x => x.id !== id));
}
