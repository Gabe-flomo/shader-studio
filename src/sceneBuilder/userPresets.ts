/**
 * Your own 3D Scene Builder presets (docs/scene-builder.md, "Presets"): a scene saved from the builder
 * with a name and a picture of it, loaded only from the builder's preset strip. A preset is a recipe
 * (printRecipe), not a graph: it becomes nodes only when you Build.
 *
 * Kept in this browser's local storage (the desktop app keeps its own). Reads and writes never throw:
 * private windows and full storage leave the list as it is in memory.
 */
import { create } from 'zustand';

export interface UserScenePreset {
  id: string;
  name: string;
  /** The scene, as recipe text (sceneBuilder/recipe.ts printRecipe / parseRecipe). */
  recipe: string;
  /** A picture of the scene when it was saved (a JPEG data URL), or null when it couldn't be drawn. */
  thumb: string | null;
  createdAt: number;
}

export const USER_PRESETS_KEY = 'playfield:scene-builder-presets';
/** Most presets kept: the strip stays usable and the pictures fit in local storage. */
export const MAX_USER_PRESETS = 48;

function load(): UserScenePreset[] {
  try {
    const raw = globalThis.localStorage?.getItem(USER_PRESETS_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter(p => p && typeof p.id === 'string' && typeof p.recipe === 'string') : [];
  } catch { return []; }
}

function save(list: UserScenePreset[]): boolean {
  try { globalThis.localStorage?.setItem(USER_PRESETS_KEY, JSON.stringify(list)); return true; } catch { return false; }
}

interface UserPresetsState {
  presets: UserScenePreset[];
  /** Save a scene; returns the new preset, or null when storage is full (it is still kept until reload). */
  add: (name: string, recipe: string, thumb: string | null) => { preset: UserScenePreset; stored: boolean };
  rename: (id: string, name: string) => void;
  remove: (id: string) => void;
}

export const useUserScenePresets = create<UserPresetsState>((set, get) => ({
  presets: load(),
  add: (name, recipe, thumb) => {
    const preset: UserScenePreset = {
      id: `up_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      name: name.trim() || 'My scene', recipe, thumb, createdAt: Date.now(),
    };
    const presets = [...get().presets, preset].slice(-MAX_USER_PRESETS);
    set({ presets });
    // A picture too big for what's left: keep the preset without it.
    let stored = save(presets);
    if (!stored && thumb) {
      const lean = presets.map(p => (p.id === preset.id ? { ...p, thumb: null } : p));
      stored = save(lean);
      if (stored) set({ presets: lean });
    }
    return { preset, stored };
  },
  rename: (id, name) => {
    const presets = get().presets.map(p => (p.id === id ? { ...p, name: name.trim() || p.name } : p));
    set({ presets }); save(presets);
  },
  remove: (id) => {
    const presets = get().presets.filter(p => p.id !== id);
    set({ presets }); save(presets);
  },
}));
