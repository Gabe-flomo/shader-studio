/**
 * storageLimit.ts — a per-device cap on what Shader Studio keeps here
 * (docs/storage-limit.md). Used space is everything the Files page counts:
 * saved work in localStorage, the media library in IndexedDB (images, videos,
 * sounds) and, in the desktop app, the workspace folder's files on disk.
 *
 *   readStorageLimit()      bytes; 0 means no limit (default 10 GB)
 *   storageUsage()          the parts and their total, cached briefly
 *   roomFor(used, limit, n) pure: may n more bytes go in?
 *   ensureRoom(n, what)     the async gate for uploads and imports: refuses
 *                           with a toast (and a way to Files → Clean up) and
 *                           throws a StorageLimitError
 *   roomNow(n)              the sync gate localStorage saves use (safeSetItem)
 *
 * Nothing that shrinks or removes is ever refused: only growth counts, and
 * only when it would cross the limit. At 90% a warning shows once a session.
 */
import { formatSize } from '../utils/library';

export const STORAGE_LIMIT_KEY = 'shader-studio:settings:storageLimit';
export const STORAGE_LIMIT_CHANGED = 'storage-limit-changed';
/** Ask the Files page to open Clean up (read when it opens, or heard when it's open). */
export const OPEN_CLEANUP_VIEW = 'open-files-cleanup';

export const GB = 1024 ** 3;
export const DEFAULT_STORAGE_LIMIT = 10 * GB;
/** The presets in the setting's list; 0 is "No limit". */
export const STORAGE_LIMIT_PRESETS: ReadonlyArray<{ bytes: number; label: string }> = [
  { bytes: 1 * GB, label: '1 GB' }, { bytes: 5 * GB, label: '5 GB' }, { bytes: 10 * GB, label: '10 GB' }, { bytes: 20 * GB, label: '20 GB' }, { bytes: 50 * GB, label: '50 GB' }, { bytes: 0, label: 'No limit' },
];
export const WARN_FRACTION = 0.9;

export interface LimitKV { get(key: string): string | null; set(key: string, value: string): void; remove?(key: string): void }
const localKV: LimitKV = {
  get: k => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* a preference */ } },
  remove: k => { try { localStorage.removeItem(k); } catch { /* a preference */ } },
};

/** The limit in bytes (0: none). Anything unreadable is the default. */
export function readStorageLimit(kv: LimitKV = localKV): number {
  const raw = kv.get(STORAGE_LIMIT_KEY);
  if (raw == null) return DEFAULT_STORAGE_LIMIT;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : DEFAULT_STORAGE_LIMIT;
}

export function setStorageLimit(bytes: number, kv: LimitKV = localKV): void {
  const n = Number.isFinite(bytes) && bytes > 0 ? Math.round(bytes) : 0;
  if (n === DEFAULT_STORAGE_LIMIT && kv.remove) kv.remove(STORAGE_LIMIT_KEY); else kv.set(STORAGE_LIMIT_KEY, String(n));
  if (typeof window !== 'undefined' && kv === localKV) window.dispatchEvent(new Event(STORAGE_LIMIT_CHANGED));
}

/** "10 GB", "1.5 GB", "512 MB" — the limit as the setting shows it. */
export function limitLabel(bytes: number): string {
  if (!bytes) return 'No limit';
  const preset = STORAGE_LIMIT_PRESETS.find(p => p.bytes === bytes);
  if (preset) return preset.label;
  if (bytes >= GB) { const g = bytes / GB; return `${Number.isInteger(g) ? g : g.toFixed(g < 10 ? 1 : 0)} GB`; }
  return formatSize(bytes);
}

/** Used space, one decimal in GB once it is that big ("10.0 GB", "1.2 GB", "312 MB"). */
export function usedLabel(bytes: number): string {
  return bytes >= GB ? `${(bytes / GB).toFixed(1)} GB` : formatSize(bytes);
}

// ── Usage ───────────────────────────────────────────────────────────────────

export interface StorageParts {
  /** Characters in localStorage keys Shader Studio owns (≈ bytes). */
  local: number;
  images: number;
  videos: number;
  sounds: number;
  /** Desktop: the workspace folder's files on disk. */
  workspace: number;
}
export interface StorageUsage extends StorageParts {
  total: number;
  /** navigator.storage.estimate(), a cross-check for the browser's own stores. */
  estimate?: { usage: number; quota: number };
  at: number;
}

export const usageTotal = (p: StorageParts): number => p.local + p.images + p.videos + p.sounds + p.workspace;

/** Are `bytes` more welcome? Growth past the limit is refused; nothing else is. */
export function roomFor(used: number, limit: number, bytes: number): { ok: true } | { ok: false; error: string } {
  if (!limit || bytes <= 0 || used + bytes <= limit) return { ok: true };
  return { ok: false, error: limitMessage(used, limit) };
}

export function limitMessage(used: number, limit: number): string {
  return `Storage limit reached: ${usedLabel(used)} of ${limitLabel(limit)} used. Free space on the Files page or raise the limit in Settings.`;
}

/** Past 90% of the limit (and there is one)? */
export const nearLimit = (used: number, limit: number): boolean => !!limit && used >= limit * WARN_FRACTION;

/** Bytes of every localStorage key Shader Studio owns. */
export function localBytes(keys: () => string[], get: (k: string) => string | null, owned: (k: string) => boolean): number {
  let n = 0;
  for (const k of keys()) { if (!owned(k)) continue; const v = get(k); if (v != null) n += k.length + v.length; }
  return n;
}

// ── The app's gate ──────────────────────────────────────────────────────────

/** Stores the gate asks, set by the app (storageLimitApp.ts); tests set their own. */
export interface UsageSources {
  local: () => number;
  media: () => Promise<Pick<StorageParts, 'images' | 'videos' | 'sounds'>>;
  workspace: () => Promise<number>;
  estimate?: () => Promise<{ usage: number; quota: number } | null>;
}
let sources: UsageSources | null = null;
export function setUsageSources(s: UsageSources | null): void { sources = s; cached = null; }

let cached: StorageUsage | null = null;
let pending: Promise<StorageUsage> | null = null;
const FRESH_MS = 4000;

/** Forget what was measured (something was added or removed). */
export function invalidateUsage(): void { cached = null; }

/** Every part measured (the media and folder parts at most every few seconds). */
export async function storageUsage(force = false): Promise<StorageUsage> {
  if (!force && cached && Date.now() - cached.at < FRESH_MS) return refreshTotal(cached);
  if (pending) return pending;
  pending = (async () => {
    const s = sources;
    const local = s?.local() ?? 0;
    let media = { images: 0, videos: 0, sounds: 0 };
    let workspace = 0;
    let estimate: StorageUsage['estimate'];
    if (s) {
      try { media = await s.media(); } catch { /* unreadable store: counts as empty */ }
      try { workspace = await s.workspace(); } catch { /* folder away: counts as empty */ }
      try { estimate = (await s.estimate?.()) ?? undefined; } catch { /* not offered */ }
    }
    const parts: StorageParts = { local, ...media, workspace };
    cached = { ...parts, total: usageTotal(parts), ...(estimate ? { estimate } : {}), at: Date.now() };
    pending = null;
    return cached;
  })();
  return pending;
}
function refreshTotal(u: StorageUsage): StorageUsage {
  const local = sources?.local() ?? u.local;
  const parts: StorageParts = { local, images: u.images, videos: u.videos, sounds: u.sounds, workspace: u.workspace };
  return { ...u, local, total: usageTotal(parts) };
}

/** What was last measured, with localStorage read afresh (cheap); null before the first measure. */
export function usageNow(): StorageUsage | null { return cached ? refreshTotal(cached) : null; }

export class StorageLimitError extends Error {
  readonly used: number;
  readonly limit: number;
  constructor(used: number, limit: number) { super(limitMessage(used, limit)); this.name = 'StorageLimitError'; this.used = used; this.limit = limit; }
}
export const isStorageLimitError = (e: unknown): e is StorageLimitError => e instanceof StorageLimitError || (e instanceof Error && e.name === 'StorageLimitError');

/** How the app shows a refusal (a toast with a way to Clean up) and the 90% warning; set by storageLimitApp.ts. */
export interface LimitReporter { refused: (message: string) => void; warn: (used: number, limit: number) => void }
let reporter: LimitReporter | null = null;
export function setLimitReporter(r: LimitReporter | null): void { reporter = r; }

let warned = false;
/** Reset the once-a-session warning (tests). */
export function resetLimitWarning(): void { warned = false; }
/** Show the 90% warning once a session, when usage is there. Returns whether it fired now. */
export function warnIfNear(used: number, limit = readStorageLimit()): boolean {
  if (warned || !nearLimit(used, limit)) return false;
  warned = true;
  reporter?.warn(used, limit);
  return true;
}

/**
 * The sync gate (localStorage saves): uses the last measure of the other
 * stores (or none, before the first) plus localStorage read now. `delta` is
 * how much bigger storage would get; shrinking is always fine.
 */
export function roomNow(delta: number, limit = readStorageLimit()): { ok: true } | { ok: false; error: string } {
  if (delta <= 0 || !limit) return { ok: true };
  const u = usageNow();
  const used = u ? u.total : sources?.local() ?? 0;
  const r = roomFor(used, limit, delta);
  if (!r.ok) reporter?.refused(r.error); else warnIfNear(used + delta, limit);
  return r;
}

/**
 * The async gate (uploads, imports, recordings): measures, then refuses with a
 * toast and a StorageLimitError when `bytes` more would cross the limit.
 */
export async function ensureRoom(bytes: number, limit = readStorageLimit()): Promise<void> {
  if (bytes <= 0 || !limit) return;
  const u = await storageUsage();
  const r = roomFor(u.total, limit, bytes);
  if (!r.ok) { reporter?.refused(r.error); throw new StorageLimitError(u.total, limit); }
  warnIfNear(u.total + bytes, limit);
}
