/**
 * Fetching a link's data. In the desktop app the Rust side fetches it
 * (`fetch_url`: https only, no cookies, capped and timed out), so any public
 * link works; in a browser tab the page fetches it, and sites that don't
 * allow other pages to read their files (CORS) fail with a plain message.
 */
import { decodeFetched, detectFormat, looksLikeHtml, normalizeUrl, prepareText, rewriteDataUrl, urlFilename } from './urlSource';
import { DATASET_MAX_FILE_BYTES, formatBytes, type DatasetFormat } from './types';

export const isDesktopApp = (): boolean => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export const FETCH_TIMEOUT_MS = 30_000;
export const CORS_MESSAGE = 'This site doesn’t let other pages read its files; the desktop app can fetch it.';

/** The browser refused to read the response (or the network is down). */
export class CorsError extends Error {}

export interface Fetched { bytes: Uint8Array; contentType: string | null; url: string; status: number }

/** Basic auth for Kaggle in a browser tab (the desktop app adds it on the Rust side, from the keychain). */
type BrowserAuth = { username: string; key: string };

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function fetchDesktop(url: string, kaggle: boolean): Promise<Fetched> {
  const { invoke } = await import('@tauri-apps/api/core');
  try {
    const r = await invoke<{ status: number; contentType: string | null; finalUrl: string; body: string }>('fetch_url', { url, kaggle });
    return { bytes: base64ToBytes(r.body), contentType: r.contentType, url: r.finalUrl, status: r.status };
  } catch (e) {
    throw new Error(typeof e === 'string' ? e : e instanceof Error ? e.message : String(e));
  }
}

async function fetchBrowser(url: string, auth: BrowserAuth | null, signal?: AbortSignal): Promise<Fetched> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  signal?.addEventListener('abort', () => ctl.abort());
  let res: Response;
  try {
    res = await fetch(url, {
      credentials: 'omit', cache: 'no-store', redirect: 'follow', signal: ctl.signal,
      ...(auth ? { headers: { Authorization: `Basic ${btoa(`${auth.username}:${auth.key}`)}` } } : {}),
    });
  } catch (e) {
    clearTimeout(timer);
    if (ctl.signal.aborted) throw new Error(signal?.aborted ? 'Stopped.' : `No answer after ${FETCH_TIMEOUT_MS / 1000} s.`);
    if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new Error('You seem to be offline.');
    throw new CorsError(CORS_MESSAGE, { cause: e });
  }
  try {
    const len = Number(res.headers.get('content-length'));
    if (Number.isFinite(len) && len > DATASET_MAX_FILE_BYTES) throw new Error(`The file is ${formatBytes(len)}. Links up to ${formatBytes(DATASET_MAX_FILE_BYTES)} can be imported.`);
    const chunks: Uint8Array[] = [];
    let total = 0;
    const reader = res.body?.getReader();
    if (reader) {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.length;
        if (total > DATASET_MAX_FILE_BYTES) { void reader.cancel(); throw new Error(`The file is over ${formatBytes(DATASET_MAX_FILE_BYTES)}, the most a link can bring in.`); }
        chunks.push(value);
      }
    }
    const bytes = new Uint8Array(total);
    let o = 0;
    for (const c of chunks) { bytes.set(c, o); o += c.length; }
    return { bytes, contentType: res.headers.get('content-type'), url: res.url || url, status: res.status };
  } finally {
    clearTimeout(timer);
  }
}

/** Fetch a link's bytes, in whichever way this app can. Throws CorsError, or an Error with a plain message. */
export async function fetchBytes(url: string, opts: { kaggle?: boolean; browserAuth?: BrowserAuth | null; signal?: AbortSignal } = {}): Promise<Fetched> {
  const out = isDesktopApp() ? await fetchDesktop(url, !!opts.kaggle) : await fetchBrowser(url, opts.browserAuth ?? null, opts.signal);
  if (out.status >= 400) throw new Error(statusMessage(out.status));
  return out;
}

export function statusMessage(status: number): string {
  const why: Record<number, string> = {
    400: 'the request was refused', 401: 'it needs signing in', 403: 'access is refused (the file may be private)', 404: 'nothing is at that address',
    410: 'the file is gone', 429: 'too many requests; try again in a minute', 500: 'the site had an error', 502: 'the site is down', 503: 'the site is busy or down',
  };
  return `The site answered ${status}: ${why[status] ?? 'it couldn’t send the file'}.`;
}

export interface FetchedData {
  /** The link as typed (normalized) and the one fetched, after rewriting. */
  input: string;
  url: string;
  /** Why the link was changed (a GitHub page → its raw file). */
  note?: string;
  text: string;
  format: DatasetFormat;
  filename: string;
  bytes: number;
  contentType: string | null;
}

/**
 * Everything from a typed link to text ready to parse: normalize, rewrite
 * (GitHub, Sheets…), fetch, unzip, detect the format, refuse web pages.
 */
export async function fetchDataUrl(raw: string, opts: { format?: DatasetFormat; kaggle?: boolean; browserAuth?: BrowserAuth | null; zipEntry?: string; signal?: AbortSignal } = {}): Promise<FetchedData> {
  const input = normalizeUrl(raw);
  if (!input) throw new Error('That isn’t a web address. Paste a link that starts with https://');
  const { url, note } = rewriteDataUrl(input);
  if (isDesktopApp() && !/^https:\/\//i.test(url) && !/^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?\//i.test(url)) {
    throw new Error('Only https:// links can be fetched (and http:// on this computer).');
  }
  const got = await fetchBytes(url, opts);
  const dec = decodeFetched(got.bytes, opts.zipEntry);
  if (!dec.text.trim()) throw new Error('The link returned nothing.');
  if (looksLikeHtml(dec.text)) {
    throw new Error(/docs\.google\.com/.test(url)
      ? 'Google answered with a web page, not the sheet’s data: the sheet isn’t public. In Google Sheets choose File › Share › Publish to web, pick CSV, and paste that link.'
      : 'The link opened a web page, not a data file. Look for a “Raw” or “Download” link to the file itself.');
  }
  const filename = dec.filename ?? urlFilename(got.url || url);
  const format = opts.format ?? dec.format ?? detectFormat({ url: got.url || url, contentType: got.contentType, text: dec.text });
  const notes = [note, dec.note].filter(Boolean).join(' · ');
  return { input, url, ...(notes ? { note: notes } : {}), text: prepareText(dec.text, format), format, filename, bytes: got.bytes.length, contentType: got.contentType };
}
