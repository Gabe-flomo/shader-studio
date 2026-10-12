/**
 * savedBlocks.ts — your own space blocks, saved (docs/scene-builder-2d.md, "My blocks").
 *
 * A block you wrote (or a library block you changed) saved under a name, with a line on what it
 * does, a category (one of the library's, or My blocks), its lines, sliders (names, values,
 * ranges), Run × and, for a combine, both sides and how they join. Each carries the same
 * warped-grid picture the library draws for its own blocks (thumbnails.ts renderWarpThumbnail),
 * stored as a small PNG so the Files page can show it too.
 *
 * Stored like rack presets: one list in localStorage (`shader-studio:space-blocks`), shown on the
 * Files page under Presets → Space blocks and carried in backups and library downloads. A block can
 * also travel on its own as a small JSON text (Copy / Export, Import).
 *
 * Pure over a KV, plus a tiny PNG writer (fflate's zlib). No React.
 */
import { zlibSync } from 'fflate';
import { safeSetItem, type FileResult } from '../utils/fileIO';
import {
  BLOCK_OPS, BLOCK_TARGETS, COMBINE_MODES, MAX_LINES, TRAP_KINDS, blockMap, checkBlock, clampTimes, cloneBlock, combineMap,
  type BlockLine, type BlockParam, type CombineSpec, type SpaceBlock,
} from './blocks';
import { BLOCK_CATEGORIES, type BlockCategory } from './blockLibrary';
import { renderWarpThumbnail } from './thumbnails';

export const SAVED_BLOCKS_KEY = 'shader-studio:space-blocks';
export const SAVED_BLOCKS_CHANGED = 'space-blocks-changed';
/** The category a saved block sits in when it isn't put in one of the library's. */
export const MY_BLOCKS = 'mine';
export const MY_BLOCKS_LABEL = 'My blocks';
export type SavedCategory = BlockCategory | typeof MY_BLOCKS;
/** The thumbnail's size in pixels (the library's tiles are 52–64). */
export const SAVED_THUMB = 64;
export const SHARE_KIND = 'playfield-space-block';

export interface SavedBlock {
  id: string;
  name: string;
  /** One line: what it does. */
  blurb: string;
  category: SavedCategory;
  savedAt: number;
  /** Offered by Random (only when you say so). */
  random: boolean;
  /** A plain block, or… */
  block?: SpaceBlock;
  /** …a combine (two blocks joined). Exactly one of the two is set. */
  combine?: CombineSpec;
  /** The warped grid, as a PNG data URL. */
  thumb: string;
}

export const categoryLabel = (c: SavedCategory | string) => (c === MY_BLOCKS ? MY_BLOCKS_LABEL : BLOCK_CATEGORIES.find(x => x.id === c)?.label ?? MY_BLOCKS_LABEL);

// ── Thumbnail ────────────────────────────────────────────────────────────────

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}
/** RGBA pixels → an RGB PNG (the thumbnails are opaque). */
export function encodePng(rgba: Uint8ClampedArray | Uint8Array, w: number, h: number): Uint8Array {
  const raw = new Uint8Array(h * (1 + w * 3));
  for (let y = 0; y < h; y++) {
    const o = y * (1 + w * 3);
    raw[o] = 0; // no filter
    for (let x = 0; x < w; x++) { const s = (y * w + x) * 4, d = o + 1 + x * 3; raw[d] = rgba[s]; raw[d + 1] = rgba[s + 1]; raw[d + 2] = rgba[s + 2]; }
  }
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w); dv.setUint32(4, h);
  ihdr[8] = 8; ihdr[9] = 2; // 8-bit RGB
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlibSync(raw, { level: 9 })), chunk('IEND', new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}
function base64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** The warped-grid picture the library draws for its blocks, for this block or combine, as a PNG data URL. */
export function blockThumbnail(src: { block?: SpaceBlock; combine?: CombineSpec }, size = SAVED_THUMB): string {
  const map = src.combine ? combineMap(src.combine, 1) : src.block ? blockMap(src.block, 1) : (x: number, y: number): [number, number] => [x, y];
  return `data:image/png;base64,${base64(encodePng(renderWarpThumbnail(map, size), size, size))}`;
}

// ── Reading what's stored (or pasted) ───────────────────────────────────────

const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const str = (v: unknown) => (typeof v === 'string' ? v : '');

function parseLine(raw: unknown): BlockLine | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const target = BLOCK_TARGETS.find(t => t === r.target), op = BLOCK_OPS.find(o => o === r.op);
  if (!target || !op) return null;
  return { target, op, rhs: str(r.rhs).slice(0, 400) };
}
function parseParam(raw: unknown): BlockParam | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (!/^[A-Za-z_]\w*$/.test(str(r.name))) return null;
  const value = num(r.value, 0), min = num(r.min, Math.min(0, value)), max = num(r.max, Math.max(1, value));
  return { name: str(r.name), value, min: Math.min(min, max, value), max: Math.max(min, max, value) };
}
/** A stored block, cleaned (lines, sliders, Run ×, name; a library id or saved name it came from). */
export function parseSpaceBlock(raw: unknown): SpaceBlock | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const lines = (Array.isArray(r.lines) ? r.lines : []).map(parseLine).filter((l): l is BlockLine => !!l).slice(0, MAX_LINES);
  const params = (Array.isArray(r.params) ? r.params : []).map(parseParam).filter((p): p is BlockParam => !!p);
  const out: SpaceBlock = { lines, params: params.filter((p, i) => params.findIndex(q => q.name === p.name) === i), times: clampTimes(r.times, r.loop === true) };
  // A looped block (Iterations up to 64) and its orbit trap
  if (r.loop === true) { out.loop = true; out.trap = TRAP_KINDS.find(k => k.kind === r.trap)?.kind ?? null; }
  if (str(r.name).trim()) out.name = str(r.name).trim().slice(0, 60);
  if (str(r.lib)) out.lib = str(r.lib);
  if (str(r.my)) out.my = str(r.my).slice(0, 60);
  return out;
}
function parseCombine(raw: unknown): CombineSpec | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const a = parseSpaceBlock(r.a), b = parseSpaceBlock(r.b);
  const mode = COMBINE_MODES.find(m => m.mode === r.mode)?.mode;
  if (!a || !b || !mode) return null;
  return { mode, amount: Math.max(0, Math.min(1, num(r.amount, 0.5))), a, b, ...(str(r.my) ? { my: str(r.my).slice(0, 60) } : {}) };
}

export function parseSavedBlock(raw: unknown): SavedBlock | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const name = str(r.name).trim().slice(0, 60);
  if (!name) return null;
  const combine = r.combine ? parseCombine(r.combine) : null;
  const block = !combine && r.block ? parseSpaceBlock(r.block) : null;
  if (!combine && !block) return null;
  const cat = str(r.category);
  const out: SavedBlock = {
    id: str(r.id).slice(0, 80) || newSavedId(),
    name,
    blurb: str(r.blurb).trim().slice(0, 200),
    category: cat === MY_BLOCKS || BLOCK_CATEGORIES.some(c => c.id === cat) ? cat as SavedCategory : MY_BLOCKS,
    savedAt: num(r.savedAt, 0),
    random: r.random === true,
    thumb: /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(str(r.thumb)) && str(r.thumb).length < 200_000 ? str(r.thumb) : '',
  };
  if (combine) out.combine = combine; else out.block = block!;
  if (!out.thumb) out.thumb = blockThumbnail(out);
  return out;
}

// ── Making one from the scene ────────────────────────────────────────────────

export interface SaveRequest { name: string; blurb?: string; category?: SavedCategory; random?: boolean }

/**
 * A block (or a combine) as a saved block, not yet stored: its lines, sliders, Run × (and both
 * sides and the join), a fresh picture, and the link back (`my`) set to its name.
 */
export function savedBlockFrom(src: { block?: SpaceBlock; combine?: CombineSpec }, req: SaveRequest, id = newSavedId()): SavedBlock | null {
  const name = req.name.trim().slice(0, 60);
  if (!name) return null;
  const out: SavedBlock = { id, name, blurb: (req.blurb ?? '').trim().slice(0, 200), category: req.category ?? MY_BLOCKS, savedAt: Date.now(), random: !!req.random, thumb: '' };
  if (src.combine) {
    const c = src.combine;
    out.combine = { mode: c.mode, amount: c.amount, a: strip(c.a), b: strip(c.b) };
  } else if (src.block) {
    out.block = { ...strip(src.block), name };
  } else return null;
  out.thumb = blockThumbnail(out);
  return out;
}
/** A plain copy without the library/saved links (a saved block stands on its own). */
function strip(b: SpaceBlock): SpaceBlock {
  const c = cloneBlock(b);
  delete c.lib; delete c.my;
  return c;
}

/** What a saved block puts in the scene: a block (or combine) linked back to it by name. */
export function sceneOpFromSaved(s: SavedBlock): { block?: SpaceBlock; combine?: CombineSpec } {
  if (s.combine) return { combine: { mode: s.combine.mode, amount: s.combine.amount, a: cloneBlock(s.combine.a), b: cloneBlock(s.combine.b), my: s.name } };
  return { block: { ...cloneBlock(s.block!), name: s.name, my: s.name } };
}

/** Does it check (every line types, every slider name fits)? A combine checks both sides. */
export function savedBlockOk(s: { block?: SpaceBlock; combine?: CombineSpec }): boolean {
  return s.combine ? checkBlock(s.combine.a).ok && checkBlock(s.combine.b).ok : !!s.block && checkBlock(s.block).ok;
}

// ── Storage ──────────────────────────────────────────────────────────────────

export interface ListKV { get(key: string): string | null; set(key: string, value: string): FileResult | void }
const localList: ListKV = {
  get: k => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => safeSetItem(k, v, 'saved space blocks'),
};
export function newSavedId(): string { return `sblk_${Date.now().toString(36)}_${Math.round(Math.random() * 1e6).toString(36)}`; }
const readList = (kv: ListKV): unknown[] => { try { const a = JSON.parse(kv.get(SAVED_BLOCKS_KEY) ?? '[]'); return Array.isArray(a) ? a : []; } catch { return []; } };
function writeList(kv: ListKV, list: SavedBlock[]): FileResult {
  const r = kv.set(SAVED_BLOCKS_KEY, JSON.stringify(list)) ?? { ok: true as const };
  if (r.ok && typeof window !== 'undefined' && kv === localList) window.dispatchEvent(new Event(SAVED_BLOCKS_CHANGED));
  return r;
}

export function loadSavedBlocks(kv: ListKV = localList): SavedBlock[] {
  return readList(kv).flatMap(x => { const s = parseSavedBlock(x); return s ? [s] : []; });
}

/** The saved block called `name` (case doesn't matter), if this machine has one. */
export function findSavedBlock(name: string, kv: ListKV = localList): SavedBlock | null {
  const n = name.trim().toLowerCase();
  return loadSavedBlocks(kv).find(s => s.name.toLowerCase() === n) ?? null;
}

/** Save under its name: one with the same name is replaced (keeping its id) — that is how a block is edited. */
export function saveSavedBlock(s: SavedBlock, kv: ListKV = localList): FileResult {
  const n = s.name.trim().slice(0, 60);
  if (!n) return { ok: false, error: 'A block needs a name.' };
  const list = loadSavedBlocks(kv);
  const had = list.find(x => x.name.toLowerCase() === n.toLowerCase());
  const next = { ...s, name: n, id: had?.id ?? s.id };
  if (next.block) next.block = { ...next.block, name: n };
  return writeList(kv, had ? list.map(x => (x === had ? next : x)) : [...list, next]);
}

export function renameSavedBlock(id: string, name: string, kv: ListKV = localList): FileResult {
  const n = name.trim().slice(0, 60);
  if (!n) return { ok: false, error: 'A block needs a name.' };
  const list = loadSavedBlocks(kv);
  if (list.some(x => x.id !== id && x.name.toLowerCase() === n.toLowerCase())) return { ok: false, error: `There is already a block called “${n}”.` };
  return writeList(kv, list.map(x => (x.id === id ? { ...x, name: n, ...(x.block ? { block: { ...x.block, name: n } } : {}) } : x)));
}

/** Change its description, category or whether Random offers it. */
export function updateSavedBlock(id: string, patch: Partial<Pick<SavedBlock, 'blurb' | 'category' | 'random'>>, kv: ListKV = localList): FileResult {
  return writeList(kv, loadSavedBlocks(kv).map(x => (x.id === id ? { ...x, ...patch } : x)));
}

/** A name not yet taken: “Wobble”, “Wobble 2”, … */
export function freeName(name: string, list: readonly SavedBlock[]): string {
  const base = name.trim().replace(/\s+\d+$/, '') || 'My block';
  const taken = new Set(list.map(x => x.name.toLowerCase()));
  if (!taken.has(name.trim().toLowerCase()) && name.trim()) return name.trim();
  for (let k = 2; ; k++) if (!taken.has(`${base} ${k}`.toLowerCase())) return `${base} ${k}`;
}

export function duplicateSavedBlock(id: string, kv: ListKV = localList): { result: FileResult; copy: SavedBlock | null } {
  const list = loadSavedBlocks(kv);
  const s = list.find(x => x.id === id);
  if (!s) return { result: { ok: false, error: 'That block is gone.' }, copy: null };
  const name = freeName(`${s.name} copy`, list);
  const copy: SavedBlock = { ...JSON.parse(JSON.stringify(s)) as SavedBlock, id: newSavedId(), name, savedAt: Date.now() };
  if (copy.block) copy.block.name = name;
  return { result: writeList(kv, [...list, copy]), copy };
}

export function deleteSavedBlock(id: string, kv: ListKV = localList): FileResult {
  return writeList(kv, loadSavedBlocks(kv).filter(x => x.id !== id));
}

// ── Sharing ─────────────────────────────────────────────────────────────────

/** A saved block as a small text to copy or save as a file (`.spaceblock.json`); the picture is redrawn on import. */
export function exportSavedBlock(s: SavedBlock): string {
  const body: Record<string, unknown> = { kind: SHARE_KIND, format: 1, name: s.name, blurb: s.blurb, category: s.category };
  if (s.combine) body.combine = s.combine; else body.block = s.block;
  return JSON.stringify(body, null, 1);
}

/**
 * A shared block (from exportSavedBlock) read back, with a fresh picture and a name not yet taken.
 * Null and a reason when it isn't one.
 */
export function importSavedBlock(text: string, list: readonly SavedBlock[] = []): { block: SavedBlock | null; error?: string } {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return { block: null, error: 'That isn’t a shared block: paste the text Copy gave you (it starts with {).' }; }
  const r = raw as Record<string, unknown> | null;
  if (!r || typeof r !== 'object' || r.kind !== SHARE_KIND) return { block: null, error: 'That isn’t a shared space block.' };
  const s = parseSavedBlock({ ...r, id: newSavedId(), savedAt: Date.now(), thumb: '' });
  if (!s) return { block: null, error: 'The block in that text is missing its lines.' };
  if (!savedBlockOk(s)) return { block: null, error: 'That block doesn’t check: one of its lines isn’t valid.' };
  s.name = freeName(s.name, list);
  if (s.block) s.block.name = s.name;
  s.thumb = blockThumbnail(s);
  return { block: s };
}
