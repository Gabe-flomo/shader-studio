/**
 * userPresets.ts — your own builder presets (docs/scene-builder.md, "Your presets"): a builder's scene
 * saved from the builder with a name and a picture of its viewport, loaded only from that builder's
 * presets strip. A preset is the builder's scaffold (its spec, as text), not a graph: it becomes nodes
 * only when the builder builds.
 *
 * One list per builder kind, each in its own local-storage key (the 3D Scene Builder keeps the key it
 * has had since 2026.10.204, so presets saved before still show). The desktop app keeps its own.
 * Reads and writes never throw: private windows and full storage leave the list as it is in memory.
 */
import { create, type StoreApi, type UseBoundStore } from 'zustand';

/** The builders that keep presets of their own. */
export type PresetBuilderKind = '3d' | '2d' | 'grid' | 'warp' | 'gridRules' | 'splat' | 'timecube' | 'agents' | 'texture';
export const PRESET_BUILDER_KINDS: PresetBuilderKind[] = ['3d', '2d', 'grid', 'warp', 'gridRules', 'splat', 'timecube', 'agents', 'texture'];

export interface UserBuilderPreset {
  id: string;
  name: string;
  /** The scene as text: the 3D builder's recipe (sceneBuilder/recipe.ts printRecipe), else the builder's spec as JSON. */
  recipe: string;
  /** A picture of the viewport when it was saved (a JPEG data URL), or null when it couldn't be taken. */
  thumb: string | null;
  createdAt: number;
}

/** Most presets kept per builder: the strip stays usable and the pictures fit in local storage. */
export const MAX_USER_PRESETS = 48;

export function presetStorageKey(kind: PresetBuilderKind): string {
  return kind === '3d' ? 'playfield:scene-builder-presets' : `playfield:builder-presets:${kind}`;
}

export interface UserPresetsState {
  presets: UserBuilderPreset[];
  /** Save a scene; `stored` is false when storage is full (it is still kept until reload). */
  add: (name: string, recipe: string, thumb: string | null) => { preset: UserBuilderPreset; stored: boolean };
  rename: (id: string, name: string) => void;
  remove: (id: string) => void;
  /** Read the list again from storage (after an import or an undo wrote it). */
  reload: () => void;
}

export type UserPresetsStore = UseBoundStore<StoreApi<UserPresetsState>>;

function makeStore(kind: PresetBuilderKind): UserPresetsStore {
  const key = presetStorageKey(kind);
  const load = (): UserBuilderPreset[] => {
    try {
      const raw = globalThis.localStorage?.getItem(key);
      const list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list.filter(p => p && typeof p.id === 'string' && typeof p.recipe === 'string') : [];
    } catch { return []; }
  };
  const save = (list: UserBuilderPreset[]): boolean => {
    try { globalThis.localStorage?.setItem(key, JSON.stringify(list)); return true; } catch { return false; }
  };
  return create<UserPresetsState>((set, get) => ({
    presets: load(),
    add: (name, recipe, thumb) => {
      const preset: UserBuilderPreset = {
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
    reload: () => set({ presets: load() }),
  }));
}

const stores = new Map<PresetBuilderKind, UserPresetsStore>();

/** The presets store of one builder (made on first use). */
export function builderPresets(kind: PresetBuilderKind): UserPresetsStore {
  let s = stores.get(kind);
  if (!s) { s = makeStore(kind); stores.set(kind, s); }
  return s;
}

/** A builder's spec as preset text, and back (a deep copy, so editing the scene never touches the preset). */
export const specToPresetText = (spec: unknown): string => JSON.stringify(spec);
export function presetTextToSpec<T>(text: string): T | null {
  try { return JSON.parse(text) as T; } catch { return null; }
}
