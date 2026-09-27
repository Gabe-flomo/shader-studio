/**
 * Datasets from a link (docs/data-layer-plan.md, milestone 7): the pure half.
 *
 *  - `rewriteDataUrl` turns links people copy from a browser into the file
 *    itself: a GitHub page into its raw file, a Google Sheet into its CSV,
 *    a Hugging Face page into its download, a Dropbox share into a download.
 *  - `detectFormat` reads the format from the link's extension, then the
 *    content type, then a look at the text.
 *  - `decodeFetched` turns fetched bytes into text: gzip-free (the fetch did
 *    that), a zip opened (its first data file), newline-delimited JSON made
 *    into an array.
 *
 * The fetching itself (browser or desktop app) is in urlFetch.ts.
 */
import { unzipSync, strFromU8 } from 'fflate';
import { formatFor } from './parse';
import type { DatasetFormat } from './types';

export interface Rewrite { url: string; note?: string }

/** A link as typed, trimmed and given https:// when it has no scheme. Null when it isn't a web address. */
export function normalizeUrl(raw: string): string | null {
  let s = raw.trim();
  if (!s) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = `https://${s}`;
  try {
    const u = new URL(s);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    if (!u.hostname.includes('.') && u.hostname !== 'localhost') return null;
    return u.toString();
  } catch { return null; }
}

/** The raw file behind a link copied from a page: GitHub, Gist, Google Sheets, Hugging Face, Dropbox. Other links pass through. */
export function rewriteDataUrl(raw: string): Rewrite {
  let u: URL;
  try { u = new URL(raw); } catch { return { url: raw }; }
  const host = u.hostname.toLowerCase();
  const parts = u.pathname.split('/').filter(Boolean);

  // github.com/{owner}/{repo}/blob/{ref}/{path} (and /raw/) → raw.githubusercontent.com/{owner}/{repo}/{ref}/{path}
  if (host === 'github.com' || host === 'www.github.com') {
    if (parts.length >= 5 && (parts[2] === 'blob' || parts[2] === 'raw')) {
      const [owner, repo, , ...rest] = parts;
      return { url: `https://raw.githubusercontent.com/${owner}/${repo}/${rest.join('/')}`, note: 'GitHub page → its raw file' };
    }
  }
  // gist.github.com/{user}/{id} → its raw (first file)
  if (host === 'gist.github.com' && parts.length >= 2 && !parts.includes('raw')) {
    return { url: `https://gist.githubusercontent.com/${parts[0]}/${parts[1]}/raw`, note: 'Gist page → its raw file' };
  }
  // Google Sheets
  if (host === 'docs.google.com' && parts[0] === 'spreadsheets' && parts[1] === 'd') {
    const gid = /(?:^|[#&?])gid=(\d+)/.exec(u.hash + '&' + u.search)?.[1];
    if (parts[2] === 'e' && parts[3]) {
      // Published to the web: …/d/e/{id}/pubhtml or /pub → /pub?output=csv (keeping the sheet)
      const q = new URLSearchParams(u.search);
      if (q.get('output') === 'csv' || q.get('output') === 'tsv') return { url: raw };
      return { url: `https://docs.google.com/spreadsheets/d/e/${parts[3]}/pub?output=csv${gid ? `&gid=${gid}` : q.get('gid') ? `&gid=${q.get('gid')}` : ''}${q.get('single') ? '&single=true' : ''}`, note: 'Published Google Sheet → its CSV' };
    }
    if (parts[2] && parts[3] !== 'export') {
      return {
        url: `https://docs.google.com/spreadsheets/d/${parts[2]}/export?format=csv${gid ? `&gid=${gid}` : ''}`,
        note: 'Google Sheet → its CSV. This works when the sheet is shared as “Anyone with the link”; otherwise use File › Share › Publish to web › CSV.',
      };
    }
  }
  // huggingface.co/datasets/{owner}/{name}/blob/{ref}/{path} → /resolve/
  if (host === 'huggingface.co' && parts[0] === 'datasets') {
    const i = parts.indexOf('blob');
    if (i > 0) { const p = [...parts]; p[i] = 'resolve'; return { url: `https://huggingface.co/${p.join('/')}`, note: 'Hugging Face page → the file' }; }
  }
  // Dropbox share links: ?dl=0 → ?dl=1
  if ((host === 'www.dropbox.com' || host === 'dropbox.com') && u.searchParams.get('dl') !== '1') {
    u.searchParams.set('dl', '1');
    return { url: u.toString(), note: 'Dropbox link → a download' };
  }
  return { url: raw };
}

/** The file name a link ends in (for the dataset's name and the extension), without query or hash. */
export function urlFilename(url: string): string {
  try {
    const u = new URL(url);
    if (u.hostname === 'docs.google.com') return 'Google Sheet.csv';
    const last = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() ?? '');
    return last || u.hostname;
  } catch { return 'data'; }
}

const EXT_FORMAT: Record<string, DatasetFormat> = { csv: 'csv', tsv: 'tsv', tab: 'tsv', json: 'json', geojson: 'json', jsonl: 'json', ndjson: 'json', txt: 'text', md: 'text' };

export class UnsupportedFormatError extends Error {}

/**
 * The format of fetched data: the extension says it (the link's, or a
 * Google Sheets `output=`/`format=`), else the content type, else the text.
 */
export function detectFormat(o: { url: string; contentType?: string | null; text: string }): DatasetFormat {
  const name = urlFilename(o.url);
  const ext = /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase();
  if (ext === 'parquet' || ext === 'xlsx' || ext === 'xls') throw new UnsupportedFormatError(unsupportedMessage(ext));
  let query: string | null = null;
  try { const q = new URL(o.url).searchParams; query = q.get('output') ?? q.get('format'); } catch { /* not a URL */ }
  if (query === 'csv') return 'csv';
  if (query === 'tsv') return 'tsv';
  if (ext && EXT_FORMAT[ext]) {
    // A .csv that's really a web page (a login wall, an error) is caught by the caller's look at the text.
    return EXT_FORMAT[ext];
  }
  const ct = (o.contentType ?? '').toLowerCase().split(';')[0].trim();
  if (ct === 'text/csv' || ct === 'application/csv') return 'csv';
  if (ct === 'text/tab-separated-values') return 'tsv';
  if (ct === 'application/json' || ct.endsWith('+json') || ct === 'application/x-ndjson' || ct === 'application/geo+json') return 'json';
  if (ct === 'application/vnd.apache.parquet' || ct === 'application/x-parquet') throw new UnsupportedFormatError(unsupportedMessage('parquet'));
  if (ct.includes('spreadsheetml') || ct === 'application/vnd.ms-excel') throw new UnsupportedFormatError(unsupportedMessage('xlsx'));
  return formatFor('', o.text);
}

function unsupportedMessage(ext: string): string {
  return ext === 'parquet'
    ? 'Parquet files can’t be read yet. Look for a CSV or JSON download of the same data (many portals offer both).'
    : 'Excel files can’t be read directly. Open it and copy the cells into a typed-in table, or save it as CSV.';
}

/** Does this text look like a web page rather than data (a sign-in page, a 404 page)? */
export function looksLikeHtml(text: string): boolean {
  const head = text.slice(0, 600).trimStart().toLowerCase();
  return head.startsWith('<!doctype html') || head.startsWith('<html') || (head.startsWith('<') && head.includes('<head'));
}

/** Newline-delimited JSON (one object per line) as a JSON array's text, or null when it isn't that. */
export function ndjsonToArray(text: string): string | null {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length < 2 || !lines.every(l => l.startsWith('{') || l.startsWith('['))) return null;
  try { return JSON.stringify(lines.map(l => JSON.parse(l) as unknown)); } catch { return null; }
}

const isZip = (b: Uint8Array) => b.length > 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;
const DATA_EXT = /\.(csv|tsv|tab|json|geojson|jsonl|ndjson|txt)$/i;

export interface Decoded { text: string; filename?: string; format?: DatasetFormat; note?: string }

/**
 * Fetched bytes as text. A zip is opened and its data file read (the one
 * named `want`, else the first CSV/JSON/text file in it). Throws when there
 * is nothing readable in it.
 */
export function decodeFetched(bytes: Uint8Array, want?: string): Decoded {
  if (isZip(bytes)) {
    const files = unzipSync(bytes, { filter: f => DATA_EXT.test(f.name) && !f.name.startsWith('__MACOSX/') });
    const names = Object.keys(files);
    const pick = (want && names.find(n => n === want || n.endsWith(`/${want}`))) ?? names.find(n => /\.csv$/i.test(n)) ?? names[0];
    if (!pick) throw new Error('The link is a zip with no CSV, JSON or text file in it.');
    const inner = pick.split('/').pop() ?? pick;
    return { text: strFromU8(files[pick]), filename: inner, format: formatFor(inner, ''), note: names.length > 1 ? `Unzipped ${inner} (1 of ${names.length} data files in the zip)` : `Unzipped ${inner}` };
  }
  return { text: new TextDecoder('utf-8').decode(bytes) };
}

/** Text ready for parseSourceText: ndjson as an array. */
export function prepareText(text: string, format: DatasetFormat): string {
  if (format !== 'json') return text;
  try { JSON.parse(text); return text; } catch { return ndjsonToArray(text) ?? text; }
}
