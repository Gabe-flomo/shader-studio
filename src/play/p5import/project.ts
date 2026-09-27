/**
 * project — gathering a p5 project into files and assets for a Script layer.
 *
 * A p5 project is an index.html that loads p5, maybe some addons, and the
 * sketch's own scripts in order, next to its images, fonts and data. The
 * sketch's scripts become the layer's tabs in that order, the file with
 * setup / draw last as sketch.js. p5 itself and its addons are left out (the
 * layer has p5 built in) and listed, with why. Assets keep the path the
 * sketch loads them by.
 */

import { parseCode, topLevelDeclarations, type AstNode } from './ast';

/** The main file of a Script layer. Every other file is an extra tab, run before it. */
export const P5_MAIN_FILE = 'sketch.js';

/** A tab of a Script layer: its name and code. */
export interface P5File { name: string; code: string }

/** A source file of the project: its tab name and code, and where it came from. */
export interface P5SourceFile extends P5File { path: string }

export type P5AssetKind = 'image' | 'font' | 'json' | 'text';

/** An image, font or data file the sketch loads. `name` is the path the sketch uses. */
export interface P5Asset {
  name: string;
  kind: P5AssetKind;
  mime: string;
  /** The file's bytes (empty when it is too big to keep). */
  bytes: Uint8Array;
  size: number;
  /** Over the size cap: listed, not kept. */
  tooBig?: boolean;
}

/** An asset as a Script layer keeps it: a data URL for images and fonts, the text for json / csv / txt. */
export interface P5AssetRecord { name: string; kind: P5AssetKind; mime: string; data: string; libraryId?: string }

/** A file the import leaves out, and why. `unsupported`: something the sketch needed that the layer cannot do. */
export interface P5Skipped { path: string; reason: string; unsupported?: boolean }

/** A project ready to analyse: the main file (sketch.js), the other tabs in load order, assets, and what was left out. */
export interface P5Project {
  title: string;
  main: P5SourceFile;
  /** Extra tabs, in the order they run (before sketch.js). */
  files: P5SourceFile[];
  assets: P5Asset[];
  skipped: P5Skipped[];
  /** Plain-English notes about how the project was read (renames, order, guesses). */
  notes: string[];
  /** Things that may stop the sketch working (several setups, missing scripts). */
  warnings: string[];
}

export interface P5ProjectOptions {
  /** Largest image kept, bytes (8 MB). */
  imageCap?: number;
  /** Largest font or data file kept, bytes (2 MB). */
  otherCap?: number;
  /** A title when index.html has none (a zip or folder name). */
  title?: string;
}

export const P5_IMAGE_CAP = 8 * 1024 * 1024;
export const P5_OTHER_CAP = 2 * 1024 * 1024;

const ASSET_TYPES: Record<string, { kind: P5AssetKind; mime: string }> = {
  png: { kind: 'image', mime: 'image/png' },
  jpg: { kind: 'image', mime: 'image/jpeg' },
  jpeg: { kind: 'image', mime: 'image/jpeg' },
  gif: { kind: 'image', mime: 'image/gif' },
  webp: { kind: 'image', mime: 'image/webp' },
  svg: { kind: 'image', mime: 'image/svg+xml' },
  ttf: { kind: 'font', mime: 'font/ttf' },
  otf: { kind: 'font', mime: 'font/otf' },
  woff: { kind: 'font', mime: 'font/woff' },
  woff2: { kind: 'font', mime: 'font/woff2' },
  json: { kind: 'json', mime: 'application/json' },
  txt: { kind: 'text', mime: 'text/plain' },
  csv: { kind: 'text', mime: 'text/csv' },
  tsv: { kind: 'text', mime: 'text/tab-separated-values' },
};

/** Why other kinds of file are left out. */
const SKIP_REASONS: Array<[RegExp, string, boolean?]> = [
  [/\.(mp3|wav|ogg|m4a|aac|flac)$/i, 'A sound file: the layer reads live audio input but does not play sounds.', true],
  [/\.(mp4|webm|mov|m4v)$/i, 'A video file: p5 video is not supported on the layer.', true],
  [/\.(frag|vert|glsl)$/i, 'A shader file: p5 shaders are not supported on the layer.', true],
  [/\.(obj|stl)$/i, 'A 3D model: loadModel is not supported on the layer.', true],
  [/\.(css)$/i, 'Page styles: the layer has no page around the canvas.'],
  [/\.(html?)$/i, 'A page: only index.html is read, for its script order.'],
  [/\.(md|markdown|txt)$/i, 'Notes.'],
];

const decoder = () => new TextDecoder('utf-8');

/** Text of a file's bytes (UTF-8, without a byte-order mark). */
export function bytesToText(bytes: Uint8Array): string {
  return decoder().decode(bytes).replace(/^\uFEFF/, '');
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Base64 of bytes, without FileReader or btoa (so it runs anywhere). */
export function bytesToBase64(bytes: Uint8Array): string {
  const out: string[] = [];
  let chunk = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i], b = bytes[i + 1], c = bytes[i + 2];
    const n = (a << 16) | ((b ?? 0) << 8) | (c ?? 0);
    chunk += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + (b === undefined ? '=' : B64[(n >> 6) & 63]) + (c === undefined ? '=' : B64[n & 63]);
    if (chunk.length > 8192) { out.push(chunk); chunk = ''; }
  }
  out.push(chunk);
  return out.join('');
}

/** The layer's record of an asset: a data URL for an image or font, the text for data. */
export function assetToRecord(asset: P5Asset): P5AssetRecord {
  const data = asset.kind === 'image' || asset.kind === 'font'
    ? `data:${asset.mime};base64,${bytesToBase64(asset.bytes)}`
    : bytesToText(asset.bytes);
  return { name: asset.name, kind: asset.kind, mime: asset.mime, data };
}

// ── Paths ────────────────────────────────────────────────────────────────────

const base = (p: string) => p.slice(p.lastIndexOf('/') + 1);
const dir = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/') + 1) : '');
const ext = (p: string) => (/\.([A-Za-z0-9]+)$/.exec(p)?.[1] ?? '').toLowerCase();

/** A path in `/` form without `./`, leading slashes or `..` beyond the top. */
export function normalisePath(p: string): string {
  const parts: string[] = [];
  for (const seg of p.replace(/\\/g, '/').split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') parts.pop(); else parts.push(seg);
  }
  return parts.join('/');
}

const ignored = (p: string) => p.split('/').some(seg => seg.startsWith('.') || seg === '__MACOSX' || seg === 'node_modules' || seg === 'Thumbs.db');

/** Paths without the one folder they all sit in (a zip of a folder, a picked folder). */
function stripCommonTop<T extends { path: string }>(entries: T[]): T[] {
  let out = entries;
  for (;;) {
    if (!out.length || out.some(e => !e.path.includes('/'))) return out;
    const top = out[0].path.slice(0, out[0].path.indexOf('/') + 1);
    if (!out.every(e => e.path.startsWith(top))) return out;
    out = out.map(e => ({ ...e, path: e.path.slice(top.length) }));
  }
}

// ── Scripts in index.html ────────────────────────────────────────────────────

const P5_CORE = /^p5(\.min)?\.js$/i;
const P5_SOUND = /^p5\.sound(\.min)?\.js$/i;
const P5_ADDON = /^p5\..+\.js$/i;
const REMOTE = /^(https?:)?\/\//i;

/** Is this script p5 or a library, not the sketch? With why, and whether the sketch loses something. */
function libraryReason(src: string): { reason: string; unsupported?: boolean } | null {
  const name = base(src.split(/[?#]/)[0]);
  if (P5_CORE.test(name)) return { reason: 'p5 itself: the layer has p5 built in.' };
  if (P5_SOUND.test(name)) return { reason: 'p5.sound: amplitude and spectrum read the live audio input; sound playback is not supported.' };
  if (P5_ADDON.test(name)) return { reason: `The ${name.replace(/(\.min)?\.js$/i, '')} addon is not supported on the layer.`, unsupported: true };
  if (/(^|\/)(libraries|addons|lib)\//i.test(src)) return { reason: `A library (${name}) is not supported on the layer.`, unsupported: true };
  if (REMOTE.test(src)) return { reason: `A library loaded from the web (${name}) is not supported on the layer.`, unsupported: true };
  return null;
}

interface HtmlScript { src: string | null; body: string; type: string }

/** The <script> tags of a page, in order (comments skipped). */
export function htmlScripts(html: string): HtmlScript[] {
  const clean = html.replace(/<!--[\s\S]*?-->/g, '');
  const out: HtmlScript[] = [];
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
  for (let m; (m = re.exec(clean)); ) {
    const attrs = m[1];
    const attr = (name: string) => new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(attrs);
    const src = attr('src');
    const type = attr('type');
    out.push({ src: src ? (src[1] ?? src[2] ?? src[3]) : null, body: m[2], type: type ? (type[1] ?? type[2] ?? type[3]).toLowerCase() : '' });
  }
  return out;
}

const htmlTitle = (html: string) => /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1].replace(/\s+/g, ' ').trim() ?? '';

// ── Which file is the sketch ─────────────────────────────────────────────────

/** Does this code define setup or draw at its top level, or start an instance-mode sketch? */
export function definesSketch(code: string): boolean {
  if (/\bnew\s+p5\s*\(/.test(code)) return true;
  const { ast } = parseCode(code);
  if (!ast) return /^[ \t]*(?:async\s+)?function\s+(setup|draw)\s*\(|^[ \t]*(?:var|let|const)\s+(setup|draw)\s*=/m.test(code);
  const tops = topLevelDeclarations(ast);
  if (tops.has('setup') || tops.has('draw')) return true;
  // `setup = function () {}` without a declaration.
  return (ast.body as AstNode[]).some(s => s.type === 'ExpressionStatement' && s.expression.type === 'AssignmentExpression'
    && s.expression.left.type === 'Identifier' && /^(setup|draw)$/.test(s.expression.left.name));
}

// ── The project ──────────────────────────────────────────────────────────────

const JS_TYPES = new Set(['', 'text/javascript', 'application/javascript', 'module', 'text/babel', 'text/p5']);

/**
 * A p5 project from its files (paths relative to anywhere; one top folder is
 * dropped). Pure: the core of every way in (a zip, a folder, picked files).
 */
export function projectFromEntries(entries: { path: string; bytes: Uint8Array }[], opts: P5ProjectOptions = {}): P5Project {
  const imageCap = opts.imageCap ?? P5_IMAGE_CAP, otherCap = opts.otherCap ?? P5_OTHER_CAP;
  const notes: string[] = [], warnings: string[] = [], skipped: P5Skipped[] = [];
  let list = entries.map(e => ({ path: normalisePath(e.path), bytes: e.bytes })).filter(e => e.path && !ignored(e.path));
  list = stripCommonTop(list);
  const byPath = new Map(list.map(e => [e.path, e]));

  // The page: the top-most index.html.
  const pages = list.filter(e => /^index\.html?$/i.test(base(e.path))).sort((a, b) => a.path.split('/').length - b.path.split('/').length || a.path.localeCompare(b.path));
  const page = pages[0] ?? null;
  const root = page ? dir(page.path) : '';
  const html = page ? bytesToText(page.bytes) : '';
  const rel = (p: string) => (root && p.startsWith(root) ? p.slice(root.length) : p);

  const used = new Set<string>();
  const sources: { path: string; code: string }[] = [];
  let inline = 0;
  if (page) {
    used.add(page.path);
    for (const s of htmlScripts(html)) {
      if (s.type && !JS_TYPES.has(s.type)) {
        if (s.body.trim()) skipped.push({ path: `index.html (script type ${s.type})`, reason: /shader|glsl|frag|vert/.test(s.type) ? 'Shader code in the page: p5 shaders are not supported on the layer.' : 'Not JavaScript.', unsupported: /shader|glsl|frag|vert/.test(s.type) });
        continue;
      }
      if (s.src === null) {
        if (!s.body.trim()) continue;
        inline++;
        sources.push({ path: `inline-${inline}.js`, code: s.body.replace(/^\s*\n/, '') });
        notes.push(`The script written inside index.html became inline-${inline}.js.`);
        continue;
      }
      const lib = libraryReason(s.src);
      if (lib) {
        skipped.push({ path: s.src, ...lib });
        const local = normalisePath(root + s.src.split(/[?#]/)[0]);
        if (!REMOTE.test(s.src) && byPath.has(local)) used.add(local);
        continue;
      }
      const path = normalisePath(root + s.src.split(/[?#]/)[0]);
      const f = byPath.get(path);
      if (!f) { warnings.push(`index.html loads ${s.src}, which is not in the project.`); continue; }
      if (used.has(path)) continue;
      used.add(path);
      sources.push({ path, code: bytesToText(f.bytes) });
    }
  }

  // Scripts the page does not load (or every script, with no page).
  const loose = list.filter(e => ext(e.path) === 'js' && !used.has(e.path)).sort((a, b) => a.path.localeCompare(b.path));
  const extra: { path: string; code: string }[] = [];
  for (const e of loose) {
    const lib = libraryReason(e.path);
    if (lib) { skipped.push({ path: rel(e.path), ...lib }); continue; }
    extra.push({ path: e.path, code: bytesToText(e.bytes) });
    used.add(e.path);
  }
  if (page && extra.length) notes.push(`index.html does not load ${extra.map(e => rel(e.path)).join(', ')}; ${extra.length === 1 ? 'it runs' : 'they run'} after its scripts.`);
  if (!page && extra.length > 1) notes.push('There is no index.html, so the scripts run in alphabetical order with the sketch last.');
  sources.push(...extra);

  // The main file: the last that defines setup / draw (or starts `new p5`).
  const sketches = sources.map((s, i) => (definesSketch(s.code) ? i : -1)).filter(i => i >= 0);
  let mainAt = sketches.length ? sketches[sketches.length - 1] : sources.length - 1;
  if (!page && sources.length > 1) {
    // No page: the others alphabetical, the sketch last.
    const [m] = sources.splice(mainAt, 1);
    sources.push(m);
    mainAt = sources.length - 1;
  }
  if (sketches.length > 1) warnings.push(`${sketches.map(i => rel(sources[i]?.path ?? '')).join(', ')} each define setup or draw; ${rel(sources[mainAt].path)} is used as the sketch, as the last one loaded.`);
  if (sources.length && !sketches.length) warnings.push(`No script defines setup or draw; ${rel(sources[mainAt].path)} is used as the sketch.`);

  let main: P5SourceFile;
  const files: P5SourceFile[] = [];
  if (!sources.length) {
    main = { name: P5_MAIN_FILE, code: '', path: '' };
    warnings.push('The project has no JavaScript.');
  } else {
    const m = sources[mainAt];
    main = { name: P5_MAIN_FILE, code: m.code, path: rel(m.path) };
    if (base(m.path) !== P5_MAIN_FILE) notes.push(`${rel(m.path)} is the sketch, renamed sketch.js.`);
    if (mainAt < sources.length - 1) notes.push(`sketch.js now runs after ${sources.slice(mainAt + 1).map(s => rel(s.path)).join(', ')}.`);
    const taken = new Set<string>([P5_MAIN_FILE]);
    for (const s of sources) {
      if (s === m) continue;
      const want = base(s.path);
      let name = want;
      for (let k = 2; taken.has(name.toLowerCase()) || taken.has(name); k++) name = want.replace(/(\.js)?$/i, `-${k}.js`);
      taken.add(name.toLowerCase());
      if (name !== want) notes.push(`${rel(s.path)} is a tab called ${name}.`);
      files.push({ name, code: s.code, path: rel(s.path) });
    }
  }

  // Assets: the path the sketch uses is relative to the page.
  const assets: P5Asset[] = [];
  for (const e of list) {
    if (used.has(e.path) || ext(e.path) === 'js') continue;
    const name = rel(e.path);
    const t = ASSET_TYPES[ext(e.path)];
    if (t) {
      const cap = t.kind === 'image' ? imageCap : otherCap;
      if (e.bytes.length > cap) {
        assets.push({ name, kind: t.kind, mime: t.mime, bytes: new Uint8Array(0), size: e.bytes.length, tooBig: true });
        skipped.push({ path: name, reason: `Too big to keep in the layer (${mb(e.bytes.length)}; up to ${mb(cap)} for ${t.kind === 'image' ? 'an image' : 'a font or data file'}).` });
      } else assets.push({ name, kind: t.kind, mime: t.mime, bytes: e.bytes, size: e.bytes.length });
      continue;
    }
    const why = SKIP_REASONS.find(([re]) => re.test(e.path));
    skipped.push({ path: name, reason: why ? why[1] : 'Not a kind of file the layer keeps.', ...(why?.[2] ? { unsupported: true } : {}) });
  }

  const title = htmlTitle(html) || opts.title || (main.path ? main.path.replace(/\.js$/i, '') : '') || 'p5 sketch';
  return { title: title === 'sketch' ? opts.title || 'p5 sketch' : title, main, files, assets, skipped, notes, warnings };
}

const mb = (n: number) => (n >= 1024 * 1024 ? `${+(n / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(n / 1024)} KB`);

/** A project of one pasted sketch. */
export function projectFromText(code: string, title = 'p5 sketch'): P5Project {
  return { title, main: { name: P5_MAIN_FILE, code, path: '' }, files: [], assets: [], skipped: [], notes: [], warnings: [] };
}

// ── The browser's ways in ────────────────────────────────────────────────────

/**
 * A project from what the person gave: pasted code, picked files, a picked
 * folder (paths from webkitRelativePath) or a .zip.
 */
export async function readP5Inputs(input: { text?: string; files?: File[] }): Promise<P5Project> {
  const files = input.files ?? [];
  if (!files.length) return projectFromText(input.text ?? '');
  const entries: { path: string; bytes: Uint8Array }[] = [];
  let title: string | undefined;
  for (const f of files) {
    const bytes = new Uint8Array(await f.arrayBuffer());
    const path = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
    if (/\.zip$/i.test(f.name)) {
      const { unzipSync } = await import('fflate');
      const unzipped = unzipSync(bytes);
      for (const [p, b] of Object.entries(unzipped)) if (!p.endsWith('/')) entries.push({ path: p, bytes: b });
      title ??= f.name.replace(/\.zip$/i, '');
    } else {
      entries.push({ path, bytes });
      if (path.includes('/')) title ??= path.split('/')[0];
    }
  }
  return projectFromEntries(entries, { title });
}

/**
 * Keep the project's images in the image library (so they can be relinked at
 * full size) and return their layer records, scaled to fit a layer. Images
 * the library cannot take keep their plain records. Browser only.
 */
export async function saveImagesToLibrary(project: P5Project, o: { maxSide?: number; maxChars?: number } = {}): Promise<P5AssetRecord[]> {
  const lib = await import('../../lib/backgroundLibrary');
  const out: P5AssetRecord[] = [];
  for (const a of project.assets) {
    if (a.kind !== 'image' || a.tooBig) continue;
    try {
      const blob = new Blob([a.bytes as BlobPart], { type: a.mime });
      const meta = await lib.addImage(blob, { name: `${project.title} · ${base(a.name)}` });
      const embedded = await lib.embedImage(meta.id, { maxSide: o.maxSide ?? 2048, maxChars: o.maxChars ?? 3_000_000 });
      if (!embedded) continue;
      const mime = /^data:([^;,]+)/.exec(embedded.src)?.[1] ?? a.mime;
      out.push({ name: a.name, kind: 'image', mime, data: embedded.src, libraryId: embedded.libraryId });
    } catch { /* keep the plain record */ }
  }
  return out;
}
