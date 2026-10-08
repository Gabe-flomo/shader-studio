/**
 * store.ts — where the taste model lives: this browser's local storage, like the rest of your Playfield
 * data (one key, `shader-studio:taste`, carried by profile ZIPs and backups). Nothing leaves the device.
 * Versioned; Reset forgets it; Export / Import move it as JSON.
 */
import { create } from 'zustand';
import { emptyModel, TASTE_VERSION, type TasteModel } from './model';

export const TASTE_KEY = 'shader-studio:taste';
const FORMAT = 'playfield-taste';

type KV = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const local = (): KV | null => { try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; } };

/** The model as a JSON file's text. */
export function serialiseTaste(m: TasteModel): string {
  return JSON.stringify({ format: FORMAT, version: TASTE_VERSION, model: m });
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const numbers = (v: unknown): Record<string, number> => {
  const out: Record<string, number> = {};
  if (isRecord(v)) for (const [k, x] of Object.entries(v)) if (typeof x === 'number' && Number.isFinite(x)) out[k] = x;
  return out;
};

/** Read a taste file (or the stored value): the model, or why it can't be read. */
export function parseTaste(text: string): { ok: true; model: TasteModel } | { ok: false; error: string } {
  let v: unknown;
  try { v = JSON.parse(text); } catch { return { ok: false, error: 'This isn’t a taste file (it isn’t JSON).' }; }
  if (!isRecord(v) || v.format !== FORMAT || !isRecord(v.model)) return { ok: false, error: 'This isn’t a Playfield taste file.' };
  const version = Number(v.version);
  if (!(version >= 1)) return { ok: false, error: 'This taste file has no version.' };
  if (version > TASTE_VERSION) return { ok: false, error: `This taste file is from a newer Playfield (version ${version}); update to read it.` };
  const m = v.model;
  const stages: TasteModel['stages'] = {};
  if (isRecord(m.stages)) for (const [st, row] of Object.entries(m.stages)) stages[st] = numbers(row);
  const ratings: TasteModel['ratings'] = {};
  if (isRecord(m.ratings)) for (const [id, r] of Object.entries(m.ratings)) {
    if (isRecord(r) && typeof r.v === 'number' && typeof r.kind === 'string') ratings[id] = { v: Math.max(-1, Math.min(1, r.v)), kind: r.kind as TasteModel['ratings'][string]['kind'], ...(typeof r.label === 'string' ? { label: r.label } : {}), at: Number(r.at) || 0 };
  }
  // Older versions migrate here (there are none yet: version 1 is the first).
  return {
    ok: true,
    model: {
      ...emptyModel(), w: numbers(m.w), n: numbers(m.n), stages, ratings, signals: numbers(m.signals), opens: numbers(m.opens),
      ...(typeof m.embedder === 'string' ? { embedder: m.embedder } : {}),
    },
  };
}

export function loadTaste(store: KV | null = local()): TasteModel {
  try {
    const text = store?.getItem(TASTE_KEY);
    if (!text) return emptyModel();
    const r = parseTaste(text);
    return r.ok ? r.model : emptyModel();
  } catch { return emptyModel(); }
}

export function saveTaste(m: TasteModel, store: KV | null = local()): void {
  try { store?.setItem(TASTE_KEY, serialiseTaste(m)); } catch { /* full or blocked: this session only */ }
}

interface TasteState { model: TasteModel }

/** The model in the app; every change is saved. */
export const useTaste = create<TasteState>(() => ({ model: loadTaste() }));

export const tasteModel = (): TasteModel => useTaste.getState().model;

/** Change the model (and save it). */
export function updateTaste(fn: (m: TasteModel) => TasteModel): TasteModel {
  const next = fn(useTaste.getState().model);
  useTaste.setState({ model: next });
  saveTaste(next);
  return next;
}

/** Reset my taste: forget everything. */
export function resetTaste(): void {
  useTaste.setState({ model: emptyModel() });
  try { local()?.removeItem(TASTE_KEY); } catch { /* nothing stored */ }
}

export const exportTaste = (): string => serialiseTaste(useTaste.getState().model);

/** Import replaces the model with the file's (after it reads). */
export function importTaste(text: string): { ok: true } | { ok: false; error: string } {
  const r = parseTaste(text);
  if (!r.ok) return r;
  useTaste.setState({ model: r.model });
  saveTaste(r.model);
  return { ok: true };
}

// The model changed in another window of this browser: pick it up.
if (typeof window !== 'undefined') {
  try {
    window.addEventListener('storage', e => { if (e.key === TASTE_KEY) useTaste.setState({ model: loadTaste() }); });
  } catch { /* no window events */ }
}
