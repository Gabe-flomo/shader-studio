import { writeTextFileAtPath } from '../../utils/fileIO';

/** Convert a label to a filesystem-safe slug. */
function labelToSlug(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'preset';
}

interface PresetLike {
  id: string;
  label: string;
  savedAt: number;
}

export interface PresetManagerOptions {
  localStoragePrefix: string;
  /** CustomEvent name dispatched on save/delete/rename so palettes can refresh. */
  eventName?: string;
  /** Returns the user-configured disk folder for this preset type, or '' if unset. */
  diskDir?: () => string;
}

/**
 * Shared localStorage-backed save/load/delete/rename mechanics for the four
 * preset types (CustomFn, Expr, Transform, Group). Each type keeps its own
 * wrapper functions in useNodeGraphStore.ts for its own preset-shape
 * construction and sort order — this only owns the common storage plumbing.
 */
export class PresetManager<T extends PresetLike> {
  private opts: PresetManagerOptions;

  constructor(opts: PresetManagerOptions) {
    this.opts = opts;
  }

  /** Write a preset to localStorage, dispatch the change event, and sync to disk if configured. */
  save(preset: T): void {
    localStorage.setItem(`${this.opts.localStoragePrefix}${preset.id}`, JSON.stringify(preset));
    if (this.opts.eventName) window.dispatchEvent(new CustomEvent(this.opts.eventName));
    const dir = this.opts.diskDir?.();
    if (dir) {
      const filename = `${labelToSlug(preset.label)}_${preset.id}.json`;
      writeTextFileAtPath(`${dir}/${filename}`, JSON.stringify(preset, null, 2));
    }
  }

  /** Scan localStorage for all presets under this prefix (unsorted — caller applies its own order). */
  load(): T[] {
    const out: T[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith(this.opts.localStoragePrefix)) continue;
      try {
        const p = JSON.parse(localStorage.getItem(key)!) as T;
        if (p?.id) out.push(p);
      } catch { /* skip corrupt entry */ }
    }
    return out;
  }

  delete(id: string): void {
    localStorage.removeItem(`${this.opts.localStoragePrefix}${id}`);
    if (this.opts.eventName) window.dispatchEvent(new CustomEvent(this.opts.eventName));
  }

  rename(id: string, newLabel: string): void {
    const key = `${this.opts.localStoragePrefix}${id}`;
    const raw = localStorage.getItem(key);
    if (!raw) return;
    try {
      const preset = JSON.parse(raw) as T;
      preset.label = newLabel.trim() || preset.label;
      localStorage.setItem(key, JSON.stringify(preset));
      if (this.opts.eventName) window.dispatchEvent(new CustomEvent(this.opts.eventName));
    } catch { /* skip corrupt entry */ }
  }
}
