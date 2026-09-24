import { writeTextFileAtPath, safeSetItem, errorMessage } from '../../utils/fileIO';
import type { FileResult } from '../../utils/fileIO';

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

  /**
   * Write a preset to localStorage, dispatch the change event, and sync to
   * disk if configured. The localStorage write happens synchronously before
   * the first await, so callers that re-read presets right after calling
   * save() (without awaiting) still see the new one. Returns a result rather
   * than throwing so a UI can report a full quota or a failed disk write.
   */
  async save(preset: T): Promise<FileResult> {
    const stored = safeSetItem(
      `${this.opts.localStoragePrefix}${preset.id}`, JSON.stringify(preset), `preset "${preset.label}"`,
    );
    if (!stored.ok) return stored;
    if (this.opts.eventName) window.dispatchEvent(new CustomEvent(this.opts.eventName));
    const dir = this.opts.diskDir?.();
    if (dir) {
      const path = `${dir}/${labelToSlug(preset.label)}_${preset.id}.json`;
      try {
        await writeTextFileAtPath(path, JSON.stringify(preset, null, 2));
      } catch (e) {
        console.error('[PresetManager] disk write failed', path, e);
        return { ok: false, error: `Preset "${preset.label}" was saved in the browser, but writing ${path} failed: ${errorMessage(e)}` };
      }
    }
    return { ok: true };
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
