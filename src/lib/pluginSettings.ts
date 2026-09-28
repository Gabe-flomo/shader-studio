/**
 * pluginSettings.ts — which installed Audio Units the app offers (Library →
 * Settings → Plugins, docs/audio-engine.md). Each unit is on (listed in the
 * rack and effect pickers) or hidden. A rescan adds new units, on unless
 * "New plugins start disabled" is set, tagged New until the list is looked
 * at. Kept on this device (`shader-studio:audio:plugins`, an app setting:
 * resetting it puts every unit back on).
 */
import { create } from 'zustand';

/** An installed unit, as the engine lists it (src-tauri/native/audio_engine.m ae_list_units). */
export interface AuUnitInfo {
  kind: 'instrument' | 'effect';
  type: number;
  subtype: number;
  manufacturer: number;
  /** "aumu/dls /appl": the unit's key. */
  code: string;
  name: string;
  vendor: string;
  version: string;
  v3: boolean;
  customView: boolean;
}

export interface PluginCrashNote {
  /** "Crashed Playfield while loading", "Crashed when it was tried out", "Didn't finish loading in 45 s". */
  why: string;
  at: number;
  /** Its name, for when the list hasn't been scanned. */
  name?: string;
}

export interface PluginUnitPref { on: boolean; new?: boolean; crashed?: PluginCrashNote }

export interface PluginPrefs {
  /**
   * Per unit key: shown or hidden, whether a rescan found it and it hasn't been looked at, and
   * `crashed` when it crashed the app or its trial load (docs/audio-engine.md "When a plug-in crashes"):
   * switched off, with why and when, until Try again.
   */
  units: Record<string, PluginUnitPref>;
  /** Units a rescan finds start hidden. */
  newOff: boolean;
  /** When the list was last scanned (ms), 0 never: the first scan tags nothing New. */
  scanned: number;
}

export const PLUGINS_KEY = 'shader-studio:audio:plugins';
export const DEFAULT_PLUGIN_PREFS: PluginPrefs = { units: {}, newOff: false, scanned: 0 };

export function parsePluginPrefs(raw: string | null): PluginPrefs {
  if (!raw) return { ...DEFAULT_PLUGIN_PREFS, units: {} };
  let v: unknown;
  try { v = JSON.parse(raw); } catch { return { ...DEFAULT_PLUGIN_PREFS, units: {} }; }
  if (!v || typeof v !== 'object') return { ...DEFAULT_PLUGIN_PREFS, units: {} };
  const o = v as Record<string, unknown>;
  const units: PluginPrefs['units'] = {};
  if (o.units && typeof o.units === 'object') {
    for (const [k, x] of Object.entries(o.units as Record<string, unknown>)) {
      if (!x || typeof x !== 'object' || k.length > 40) continue;
      const u = x as Record<string, unknown>;
      const c = u.crashed && typeof u.crashed === 'object' ? u.crashed as Record<string, unknown> : null;
      const crashed = c && typeof c.why === 'string' ? { why: c.why.slice(0, 200), at: typeof c.at === 'number' && Number.isFinite(c.at) ? c.at : 0, ...(typeof c.name === 'string' && c.name ? { name: c.name.slice(0, 120) } : {}) } : null;
      units[k] = { on: u.on !== false, ...(u.new === true ? { new: true } : {}), ...(crashed ? { crashed } : {}) };
    }
  }
  return { units, newOff: o.newOff === true, scanned: typeof o.scanned === 'number' && Number.isFinite(o.scanned) ? o.scanned : 0 };
}

/** Is a unit offered? One this device hasn't seen yet follows "New plugins start disabled". */
export function pluginEnabled(prefs: PluginPrefs, key: string): boolean {
  return prefs.units[key]?.on ?? !prefs.newOff;
}

/** A scan's units into the prefs: ones not seen before are added (on unless newOff), tagged New after the first scan. */
export function mergeScan(prefs: PluginPrefs, units: readonly Pick<AuUnitInfo, 'code'>[], now: number): { prefs: PluginPrefs; added: string[] } {
  const next: PluginPrefs = { ...prefs, units: { ...prefs.units }, scanned: now };
  const added: string[] = [];
  for (const u of units) {
    if (next.units[u.code]) continue;
    next.units[u.code] = { on: !prefs.newOff, ...(prefs.scanned ? { new: true } : {}) };
    if (prefs.scanned) added.push(u.code);
  }
  return { prefs: next, added };
}

export function setPluginsEnabled(prefs: PluginPrefs, keys: readonly string[], on: boolean): PluginPrefs {
  const units = { ...prefs.units };
  for (const k of keys) units[k] = { on };
  return { ...prefs, units };
}

/** Looked at: nothing is New any more (crash notes stay). */
export function clearNewTags(prefs: PluginPrefs): PluginPrefs {
  const units: PluginPrefs['units'] = {};
  for (const [k, v] of Object.entries(prefs.units)) units[k] = { on: v.on, ...(v.crashed ? { crashed: v.crashed } : {}) };
  return { ...prefs, units };
}

/** A unit crashed (the app, or its trial load): switched off, with the note. */
export function markPluginCrashed(prefs: PluginPrefs, key: string, why: string, at: number, name?: string): PluginPrefs {
  return { ...prefs, units: { ...prefs.units, [key]: { on: false, crashed: { why, at, ...(name ? { name } : {}) } } } };
}

/** Try again worked: the note goes and the unit is on again. */
export function clearPluginCrash(prefs: PluginPrefs, key: string): PluginPrefs {
  return { ...prefs, units: { ...prefs.units, [key]: { on: true } } };
}

/** The units switched off for crashing, newest first. */
export function crashedPlugins(prefs: PluginPrefs): Array<{ code: string } & PluginCrashNote> {
  return Object.entries(prefs.units).filter(([, v]) => v.crashed).map(([code, v]) => ({ code, ...v.crashed! })).sort((a, b) => b.at - a.at);
}

/** The units the pickers offer. */
export function enabledUnits<T extends Pick<AuUnitInfo, 'code'>>(units: readonly T[], prefs: PluginPrefs): T[] {
  return units.filter(u => pluginEnabled(prefs, u.code));
}

/** Search over name, maker, kind and code. */
export function matchUnit(u: AuUnitInfo, q: string): boolean {
  const n = q.trim().toLowerCase();
  if (!n) return true;
  return `${u.name} ${u.vendor} ${u.kind} ${u.code}`.toLowerCase().includes(n);
}

/** Units as the list shows them: instruments first, then effects, each by maker and name. */
export function sortUnits<T extends AuUnitInfo>(units: readonly T[]): T[] {
  return [...units].sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'instrument' ? -1 : 1) || a.vendor.localeCompare(b.vendor) || a.name.localeCompare(b.name));
}

/** A unit list from the engine's JSON (entries it can't read are left out). */
export function parseUnits(raw: unknown): AuUnitInfo[] {
  const out: AuUnitInfo[] = [];
  for (const x of Array.isArray(raw) ? raw : []) {
    if (!x || typeof x !== 'object') continue;
    const o = x as Record<string, unknown>;
    const n = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : null);
    const type = n(o.type), subtype = n(o.subtype), manufacturer = n(o.manufacturer);
    if (type === null || subtype === null || manufacturer === null || typeof o.code !== 'string') continue;
    if (o.kind !== 'instrument' && o.kind !== 'effect') continue;
    out.push({
      kind: o.kind, type, subtype, manufacturer, code: o.code,
      name: typeof o.name === 'string' && o.name ? o.name : o.code,
      vendor: typeof o.vendor === 'string' ? o.vendor : '',
      version: typeof o.version === 'string' ? o.version : '',
      v3: o.v3 === true, customView: o.customView === true,
    });
  }
  return out;
}

// ── The store ───────────────────────────────────────────────────────────────

function load(): PluginPrefs {
  try { return parsePluginPrefs(localStorage.getItem(PLUGINS_KEY)); } catch { return parsePluginPrefs(null); }
}

function save(p: PluginPrefs): void {
  try { localStorage.setItem(PLUGINS_KEY, JSON.stringify(p)); } catch { /* preference only */ }
}

type Invoke = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

interface PluginStore {
  prefs: PluginPrefs;
  /** The last scan's units (null before one). */
  units: AuUnitInfo[] | null;
  scanning: boolean;
  error: string;
  /** Read the prefs again (the Files page may have reset them). */
  reload: () => void;
  /** Ask the engine for its units; `invoke` is Tauri's. The New ones found. */
  rescan: (invoke: Invoke) => Promise<string[]>;
  setEnabled: (keys: readonly string[], on: boolean) => void;
  setNewOff: (on: boolean) => void;
  clearNew: () => void;
  markCrashed: (key: string, why: string, at?: number, name?: string) => void;
  clearCrash: (key: string) => void;
}

export const usePluginSettings = create<PluginStore>((set, get) => {
  const put = (prefs: PluginPrefs) => { save(prefs); set({ prefs }); };
  return {
    prefs: load(),
    units: null,
    scanning: false,
    error: '',
    reload: () => set({ prefs: load() }),
    rescan: async invoke => {
      set({ scanning: true, error: '' });
      try {
        const units = parseUnits(await invoke<unknown>('ae_units'));
        const { prefs, added } = mergeScan(load(), units, Date.now());
        save(prefs);
        set({ units: sortUnits(units), prefs, scanning: false });
        return added;
      } catch (e) {
        set({ scanning: false, error: e instanceof Error ? e.message : String(e) });
        return [];
      }
    },
    setEnabled: (keys, on) => put(setPluginsEnabled(get().prefs, keys, on)),
    setNewOff: on => put({ ...get().prefs, newOff: on }),
    clearNew: () => put(clearNewTags(get().prefs)),
    markCrashed: (key, why, at = Date.now(), name) => put(markPluginCrashed(load(), key, why, at, name)),
    clearCrash: key => put(clearPluginCrash(load(), key)),
  };
});
