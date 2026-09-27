/**
 * Kaggle datasets, with the user's own API key.
 *
 * The key is stored only on this machine: in the desktop app, in the system
 * keychain (the Rust side reads it and adds it to Kaggle requests itself, so
 * the page never holds it); in a browser, in this browser's storage, which
 * any code on this site can read, and the editor says so. Kaggle's API
 * doesn't allow other sites' pages to call it, so in a browser listing and
 * downloading usually fail with the CORS message: the desktop app does it.
 */
import { formatFor } from './parse';
import { fetchBytes, fetchDataUrl, isDesktopApp, type FetchedData } from './urlFetch';

export const KAGGLE_API = 'https://www.kaggle.com/api/v1';
const LOCAL_KEY = 'shader-studio:kaggle';

export interface KaggleFile { name: string; bytes: number | null }

/** `owner/dataset` from a slug or a dataset page's link. Null when it isn't one. */
export function parseKaggleSlug(raw: string): string | null {
  let s = raw.trim();
  const m = /kaggle\.com\/datasets\/([^/?#\s]+)\/([^/?#\s]+)/i.exec(s);
  if (m) s = `${m[1]}/${m[2]}`;
  s = s.replace(/^\/+|\/+$/g, '');
  return /^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(s) ? s : null;
}

export const kaggleListUrl = (slug: string) => `${KAGGLE_API}/datasets/list/${slug}`;
export const kaggleDownloadUrl = (slug: string, file: string) => `${KAGGLE_API}/datasets/download/${slug}/${encodeURIComponent(file)}`;

/**
 * The files of a dataset from Kaggle's list answer. It has been an array of
 * files, and is now `{ datasetFiles: [...] }`; each has a `name` and a size
 * (`totalBytes`, or `size` as text in older answers). Throws Kaggle's own
 * error message when it sent one.
 */
export function parseKaggleFiles(json: unknown): KaggleFile[] {
  const obj = json && typeof json === 'object' && !Array.isArray(json) ? json as Record<string, unknown> : null;
  if (obj && typeof obj.errorMessage === 'string' && obj.errorMessage) throw new Error(`Kaggle: ${obj.errorMessage}`);
  if (obj && typeof obj.message === 'string' && !Array.isArray(obj.datasetFiles)) throw new Error(`Kaggle: ${obj.message}`);
  const list = Array.isArray(json) ? json : Array.isArray(obj?.datasetFiles) ? obj.datasetFiles as unknown[] : Array.isArray(obj?.files) ? obj.files as unknown[] : null;
  if (!list) throw new Error('Kaggle sent an answer this app doesn’t understand.');
  const out: KaggleFile[] = [];
  for (const f of list) {
    if (!f || typeof f !== 'object') continue;
    const x = f as Record<string, unknown>;
    const name = typeof x.name === 'string' ? x.name : typeof x.nameNullable === 'string' ? x.nameNullable : null;
    if (!name) continue;
    const size = typeof x.totalBytes === 'number' ? x.totalBytes : typeof x.totalBytesNullable === 'number' ? x.totalBytesNullable : parseSize(x.size);
    out.push({ name, bytes: size });
  }
  return out;
}

/** "1.5 MB", "300 KB", "12345" → bytes. */
function parseSize(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v !== 'string') return null;
  const m = /^\s*([\d.]+)\s*(B|KB|MB|GB)?\s*$/i.exec(v);
  if (!m) return null;
  const mult = { B: 1, KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3 }[(m[2] ?? 'B').toUpperCase() as 'B'];
  return Math.round(Number(m[1]) * mult);
}

/** Files the Data editor can read, first; the rest after (shown, but not offered). */
export function readableKaggleFiles(files: KaggleFile[]): { readable: KaggleFile[]; other: KaggleFile[] } {
  const ok = /\.(csv|tsv|json|geojson|jsonl|txt)$/i;
  return { readable: files.filter(f => ok.test(f.name)), other: files.filter(f => !ok.test(f.name)) };
}

// ── Credentials ──────────────────────────────────────────────────────────────

export interface KaggleAccount { username: string; stored: 'keychain' | 'browser' }

/** Who is signed in to Kaggle on this machine (never the key itself), or null. */
export async function kaggleAccount(): Promise<KaggleAccount | null> {
  if (isDesktopApp()) {
    const { invoke } = await import('@tauri-apps/api/core');
    const username = await invoke<string | null>('kaggle_account');
    return username ? { username, stored: 'keychain' } : null;
  }
  const c = browserCredentials();
  return c ? { username: c.username, stored: 'browser' } : null;
}

export async function saveKaggleCredentials(username: string, key: string): Promise<void> {
  const u = username.trim(), k = key.trim();
  if (!u || !k) throw new Error('Enter both your Kaggle username and API key.');
  if (isDesktopApp()) {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('kaggle_save', { username: u, key: k });
    return;
  }
  try { localStorage.setItem(LOCAL_KEY, JSON.stringify({ username: u, key: k })); } catch { throw new Error('This browser won’t store it (a private window?).'); }
}

export async function forgetKaggleCredentials(): Promise<void> {
  if (isDesktopApp()) {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('kaggle_forget');
    return;
  }
  try { localStorage.removeItem(LOCAL_KEY); } catch { /* nothing stored */ }
}

function browserCredentials(): { username: string; key: string } | null {
  try {
    const v = JSON.parse(localStorage.getItem(LOCAL_KEY) ?? 'null') as { username?: unknown; key?: unknown } | null;
    return v && typeof v.username === 'string' && typeof v.key === 'string' ? { username: v.username, key: v.key } : null;
  } catch { return null; }
}

/** A kaggle.json file's contents (what Kaggle's "Create New Token" downloads). */
export function parseKaggleJson(text: string): { username: string; key: string } | null {
  try {
    const v = JSON.parse(text) as { username?: unknown; key?: unknown };
    return typeof v.username === 'string' && typeof v.key === 'string' && v.username && v.key ? { username: v.username, key: v.key } : null;
  } catch { return null; }
}

// ── Calls ────────────────────────────────────────────────────────────────────

export async function listKaggleFiles(slug: string): Promise<KaggleFile[]> {
  const got = await fetchBytes(kaggleListUrl(slug), { kaggle: true, browserAuth: browserCredentials() });
  let json: unknown;
  try { json = JSON.parse(new TextDecoder().decode(got.bytes)); } catch { throw new Error('Kaggle sent an answer this app doesn’t understand.'); }
  return parseKaggleFiles(json);
}

/** Download one file of a dataset (unzipped when Kaggle sends it zipped). */
export function downloadKaggleFile(slug: string, file: string): Promise<FetchedData> {
  const ext = /\.(csv|tsv|json|geojson|jsonl|txt)$/i.test(file) ? formatFor(file, '') : undefined;
  return fetchDataUrl(kaggleDownloadUrl(slug, file), { kaggle: true, browserAuth: browserCredentials(), zipEntry: file, ...(ext ? { format: ext } : {}) });
}
