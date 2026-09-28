/**
 * Reading a .playfile: the one place a container is opened (writer.ts makes
 * them). It checks everything before anything is imported and never runs
 * anything inside: sizes against limits (the file, each item, the total, the
 * number of entries), every path (no `..`, no absolute paths), the manifest's
 * format and version, each item's size and SHA-256, and the signature.
 * Unknown kinds are left out with a note; a newer container is refused with
 * a sentence saying so.
 *
 * Both containers open: v2 (the encrypted envelope, container.ts, told by its
 * magic) is unwrapped first, and its tag refuses a changed file; v1 (a plain
 * ZIP) is read as it always was. Anything else is "Not a Playfield file".
 */
import { strFromU8, unzipSync } from 'fflate';
import { fromBase64, sha256Hex } from './bytes';
import { isContainer, unwrapContainer } from './container';
import {
  DEFAULT_LIMITS, formatBytes as mb, isItemKind, isSafePath, LEGACY_FORMATS, MANIFEST_PATH, PLAYFILE_FORMAT, PLAYFILE_VERSION, PlayfileError,
  type ItemKind, type ManifestItem, type PlayfileLimits, type PlayfileManifest,
} from './format';
import { fingerprint, verifyBytes } from './signing';
import { signedBytes } from './writer';

export interface ReadItem extends ManifestItem {
  kind: ItemKind;
  data: Uint8Array;
}

export type SignatureStatus =
  /** No signature: anyone could have made or changed it. */
  | { state: 'unsigned'; name?: string }
  /** The signature checks out and every item matches its hash. */
  | { state: 'signed'; name: string; publicKey: string; fingerprint: string }
  /** It was signed, but the manifest or an item changed since. */
  | { state: 'modified'; name: string; publicKey?: string; fingerprint?: string };

export interface PlayfileContents {
  manifest: PlayfileManifest;
  /** Known kinds whose bytes match the manifest. */
  items: ReadItem[];
  /** Items left out, each with why (unknown kind, missing, wrong size or hash). */
  skipped: Array<{ item: ManifestItem; reason: string }>;
  /** Things worth saying that aren't about one item. */
  notes: string[];
  signature: SignatureStatus;
}

const isZip = (b: Uint8Array) => b.length > 3 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;

/**
 * A quick look: is this a .playfile? A v2 container by its magic (what's inside
 * is checked when it's opened); a v1 ZIP by its manifest, which is all this
 * reads.
 */
export function isPlayfile(bytes: Uint8Array): boolean {
  if (isContainer(bytes)) return true;
  if (!isZip(bytes)) return false;
  try {
    const m = unzipSync(bytes, { filter: f => f.name === MANIFEST_PATH && f.originalSize <= DEFAULT_LIMITS.manifestBytes })[MANIFEST_PATH];
    if (!m) return false;
    const f = (JSON.parse(strFromU8(m)) as { format?: unknown } | null)?.format;
    return f === PLAYFILE_FORMAT || LEGACY_FORMATS.includes(f as string);
  } catch { return false; }
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export async function readPlayfile(bytes: Uint8Array, limits: PlayfileLimits = DEFAULT_LIMITS): Promise<PlayfileContents> {
  if (bytes.length > limits.fileBytes) throw new PlayfileError(`It’s too big to open (${mb(bytes.length)}; the limit is ${mb(limits.fileBytes)}).`);
  if (isContainer(bytes)) bytes = await unwrapContainer(bytes, limits);
  else if (!isZip(bytes)) throw new PlayfileError('Not a Playfield file.');
  return readPlayfileZip(bytes, limits);
}

/** The v1 container (a plain ZIP with a manifest), which is also what a v2 envelope holds. */
async function readPlayfileZip(bytes: Uint8Array, limits: PlayfileLimits): Promise<PlayfileContents> {
  if (bytes.length > limits.fileBytes) throw new PlayfileError(`It’s too big to open (${mb(bytes.length)}; the limit is ${mb(limits.fileBytes)}).`);
  if (!isZip(bytes)) throw new PlayfileError('Not a Playfield file.');

  // Look at every entry before inflating anything: count, declared sizes, paths.
  let entries = 0, declared = 0;
  const unsafe: string[] = [];
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, {
      filter: f => {
        if (f.name.endsWith('/')) return false;
        if (++entries > limits.entries) throw new PlayfileError(`It has too many files in it (more than ${limits.entries}).`);
        if (!isSafePath(f.name, limits.pathLength)) { unsafe.push(f.name); return false; }
        const cap = f.name === MANIFEST_PATH ? limits.manifestBytes : limits.itemBytes;
        if (f.originalSize > cap) throw new PlayfileError(`“${f.name}” is too big (${mb(f.originalSize)}; the limit is ${mb(cap)}).`);
        declared += f.originalSize;
        if (declared > limits.totalBytes) throw new PlayfileError(`Unpacked it would be too big (over ${mb(limits.totalBytes)}).`);
        return true;
      },
    });
  } catch (e) {
    if (e instanceof PlayfileError) throw e;
    throw new PlayfileError(`It couldn’t be unpacked: ${e instanceof Error ? e.message : String(e)}`);
  }
  // A ZIP can lie about sizes: check what actually came out too.
  let actual = 0;
  for (const [p, b] of Object.entries(files)) {
    actual += b.length;
    const cap = p === MANIFEST_PATH ? limits.manifestBytes : limits.itemBytes;
    if (b.length > cap || actual > limits.totalBytes) throw new PlayfileError('Unpacked it’s bigger than it says: it may be damaged or crafted, so it wasn’t opened.');
  }

  const rawManifest = files[MANIFEST_PATH];
  if (!rawManifest) throw new PlayfileError('It has no manifest.json, so it isn’t a .playfile.');
  let m: unknown;
  try { m = JSON.parse(strFromU8(rawManifest)); } catch { throw new PlayfileError('Its manifest.json isn’t readable JSON.'); }
  const manifest = checkManifest(m, limits);

  const notes: string[] = [];
  if (unsafe.length) notes.push(`${plural(unsafe.length, 'file')} with an unsafe path ${unsafe.length === 1 ? 'was' : 'were'} ignored.`);
  const listed = new Set(manifest.items.map(i => i.path));
  const extra = Object.keys(files).filter(p => p !== MANIFEST_PATH && p !== 'README.txt' && !listed.has(p));
  if (extra.length) notes.push(`${plural(extra.length, 'file')} not listed in the manifest ${extra.length === 1 ? 'was' : 'were'} ignored.`);

  const items: ReadItem[] = [];
  const skipped: PlayfileContents['skipped'] = [];
  let damaged = 0;
  const unknownKinds = new Set<string>();
  for (const it of manifest.items) {
    const data = files[it.path];
    if (!isItemKind(it.kind)) { unknownKinds.add(it.kind); skipped.push({ item: it, reason: `“${it.kind}” isn’t something this version of Playfield knows` }); continue; }
    if (!data) { damaged++; skipped.push({ item: it, reason: unsafe.includes(it.path) ? 'Its path is unsafe' : 'It’s missing from the file' }); continue; }
    if (data.length !== it.bytes) { damaged++; skipped.push({ item: it, reason: 'Its size doesn’t match the manifest: it was changed or damaged' }); continue; }
    if (sha256Hex(data) !== it.sha256) { damaged++; skipped.push({ item: it, reason: 'Its contents don’t match the manifest’s hash: it was changed or damaged' }); continue; }
    items.push({ ...it, kind: it.kind, data });
  }
  if (unknownKinds.size) notes.push(`Left out: ${[...unknownKinds].map(k => `“${k}”`).join(', ')} (made by a newer Playfield, or another app). Update Playfield to open ${unknownKinds.size === 1 ? 'it' : 'them'}.`);

  return { manifest, items, skipped, notes, signature: await checkSignature(manifest, m as PlayfileManifest, damaged > 0) };
}

function checkManifest(m: unknown, limits: PlayfileLimits): PlayfileManifest {
  if (!m || typeof m !== 'object' || Array.isArray(m)) throw new PlayfileError('Its manifest isn’t a Playfield manifest.');
  const o = m as Record<string, unknown>;
  if (o.format !== PLAYFILE_FORMAT && !LEGACY_FORMATS.includes(o.format as string)) throw new PlayfileError('Its manifest isn’t a Playfield manifest.');
  if (typeof o.version !== 'number' || !Number.isInteger(o.version) || o.version < 1) throw new PlayfileError('Its manifest has no version this app understands.');
  if (o.version > PLAYFILE_VERSION) throw new PlayfileError(`It was made by a newer Playfield (format ${o.version}; this one reads up to ${PLAYFILE_VERSION}). Update Playfield to open it.`);
  if (!Array.isArray(o.items)) throw new PlayfileError('Its manifest lists no items.');
  if (o.items.length > limits.entries) throw new PlayfileError(`Its manifest lists too many items (more than ${limits.entries}).`);
  const seen = new Set<string>();
  const items: ManifestItem[] = o.items.map((raw, i) => {
    const it = raw as Record<string, unknown> | null;
    if (!it || typeof it !== 'object') throw new PlayfileError(`Item ${i + 1} in its manifest isn’t readable.`);
    if (typeof it.kind !== 'string' || !it.kind) throw new PlayfileError(`Item ${i + 1} in its manifest has no kind.`);
    if (typeof it.path !== 'string' || !isSafePath(it.path, limits.pathLength) || it.path === MANIFEST_PATH) throw new PlayfileError(`Item ${i + 1} in its manifest points outside the file (“${String(it.path).slice(0, 60)}”). It may be crafted, so it wasn’t opened.`);
    if (seen.has(it.path)) throw new PlayfileError(`Its manifest lists “${it.path}” twice.`);
    seen.add(it.path);
    if (typeof it.bytes !== 'number' || !Number.isInteger(it.bytes) || it.bytes < 0 || it.bytes > limits.itemBytes) throw new PlayfileError(`Item ${i + 1} in its manifest has a size out of range.`);
    if (typeof it.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(it.sha256)) throw new PlayfileError(`Item ${i + 1} in its manifest has no valid SHA-256.`);
    const name = typeof it.name === 'string' && it.name.trim() ? it.name.trim().slice(0, limits.nameLength) : it.path.split('/').pop()!;
    const meta = it.meta && typeof it.meta === 'object' && !Array.isArray(it.meta) ? it.meta as Record<string, unknown> : undefined;
    return { kind: it.kind, path: it.path, name, bytes: it.bytes, sha256: it.sha256, ...(meta ? { meta } : {}) };
  });
  const author = o.author && typeof o.author === 'object' ? o.author as Record<string, unknown> : null;
  const sig = o.signature && typeof o.signature === 'object' ? o.signature as Record<string, unknown> : null;
  return {
    ...o,
    format: o.format as string,
    version: o.version,
    appVersion: typeof o.appVersion === 'string' ? o.appVersion.slice(0, 40) : '?',
    kinds: Array.isArray(o.kinds) ? o.kinds.filter((k): k is string => typeof k === 'string') : [...new Set(items.map(i => i.kind))],
    created: typeof o.created === 'string' ? o.created : '',
    ...(author && typeof author.name === 'string' ? { author: { ...author, name: author.name.slice(0, 80), ...(typeof author.publicKey === 'string' ? { publicKey: author.publicKey } : {}) } } : {}),
    items,
    ...(sig && sig.alg === 'Ed25519' && typeof sig.value === 'string' ? { signature: { alg: 'Ed25519' as const, value: sig.value } } : {}),
  } as PlayfileManifest;
}

/**
 * Checked against the manifest exactly as it is in the file (so a field this
 * version doesn't know about is still covered).
 */
async function checkSignature(manifest: PlayfileManifest, raw: PlayfileManifest, damaged: boolean): Promise<SignatureStatus> {
  const name = manifest.author?.name ?? '';
  if (!manifest.signature) return { state: 'unsigned', ...(name ? { name } : {}) };
  const pk = manifest.author?.publicKey;
  if (!pk) return { state: 'modified', name: name || 'Someone' };
  let ok = false;
  let fp: string | undefined;
  try {
    const key = fromBase64(pk);
    fp = fingerprint(key);
    ok = await verifyBytes(key, signedBytes(raw), fromBase64(manifest.signature.value));
  } catch { ok = false; }
  if (!ok || damaged) return { state: 'modified', name: name || 'Someone', publicKey: pk, ...(fp ? { fingerprint: fp } : {}) };
  return { state: 'signed', name: name || 'Someone', publicKey: pk, fingerprint: fp! };
}
