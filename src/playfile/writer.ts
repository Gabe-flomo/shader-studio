/**
 * Writing a .playfile: items in, a ZIP with a manifest out, signed when
 * a signer is given. The one place a .playfile is made (reader.ts reads it).
 */
import { strToU8, zipSync } from 'fflate';
import { APP_VERSION } from '../files/appVersion';
import { canonicalJson, sha256Hex, toBase64, utf8 } from './bytes';
import { fileSafeName, KIND_LAYOUT, PLAYFILE_EXT, MANIFEST_PATH, PLAYFILE_FORMAT, PLAYFILE_VERSION, type ItemKind, type ManifestItem, type PlayfileManifest } from './format';
import type { Signer } from './signing';

export interface WriteItem {
  kind: ItemKind;
  name: string;
  data: Uint8Array | string;
  /** The file's extension when the kind has none of its own (an image's `.png`). */
  ext?: string;
  meta?: Record<string, unknown>;
}

export interface WriteOptions {
  /** A display name for the author (goes in the manifest; signed when a signer is given). */
  author?: string;
  signer?: Signer | null;
  created?: Date;
  appVersion?: string;
}

const README = `This is a Playfield file (.playfile).

Open it in Playfield (Shader Studio): Import, or drop it on the window. The app
shows what is inside, who signed it, and what clashes with what you have,
before anything is added.

It is a ZIP: manifest.json lists every item with its kind, size and SHA-256,
and the items sit in folders by kind (graphs/, presentations/, nodes/…). The
graphs, presentations and shaders are readable files. A sealed node pack keeps
its code encrypted.
`;

/** The bytes a signature covers: the manifest without its signature, as canonical JSON. */
export function signedBytes(manifest: PlayfileManifest): Uint8Array {
  const { signature: _s, ...rest } = manifest;
  void _s;
  return utf8(canonicalJson(rest));
}

export async function writePlayfile(items: WriteItem[], opts: WriteOptions = {}): Promise<{ bytes: Uint8Array; manifest: PlayfileManifest }> {
  if (!items.length) throw new Error('Nothing to put in the file.');
  const files: Record<string, Uint8Array> = {};
  const entries: ManifestItem[] = [];
  const taken = new Set<string>([MANIFEST_PATH, 'README.txt']);
  for (const it of items) {
    const data = typeof it.data === 'string' ? strToU8(it.data) : it.data;
    const layout = KIND_LAYOUT[it.kind];
    const ext = layout.ext || (it.ext ?? '');
    const named = `${layout.dir}/${fileSafeName(it.name)}`;
    // A name that already ends in its extension ("Clip.webm") isn't given it twice.
    const base = ext && named.toLowerCase().endsWith(ext.toLowerCase()) && named.length > layout.dir.length + 1 + ext.length ? named.slice(0, -ext.length) : named;
    let path = `${base}${ext}`;
    for (let n = 2; taken.has(path.toLowerCase()); n++) path = `${base} (${n})${ext}`;
    taken.add(path.toLowerCase());
    files[path] = data;
    entries.push({ kind: it.kind, path, name: it.name.slice(0, 200), bytes: data.length, sha256: sha256Hex(data), ...(it.meta ? { meta: it.meta } : {}) });
  }
  const signer = opts.signer ?? null;
  const author = opts.author?.trim().slice(0, 80) ?? '';
  const manifest: PlayfileManifest = {
    format: PLAYFILE_FORMAT,
    version: PLAYFILE_VERSION,
    appVersion: opts.appVersion ?? APP_VERSION,
    kinds: [...new Set(entries.map(e => e.kind))],
    created: (opts.created ?? new Date()).toISOString(),
    ...(author || signer ? { author: { name: author || 'Unnamed author', ...(signer ? { publicKey: toBase64(signer.publicKey) } : {}) } } : {}),
    items: entries,
  };
  if (signer) manifest.signature = { alg: 'Ed25519', value: toBase64(await signer.sign(signedBytes(manifest))) };
  files[MANIFEST_PATH] = strToU8(JSON.stringify(manifest, null, 1));
  files['README.txt'] = strToU8(README);
  // Images, videos and ZIPs are already compressed.
  const zipped: Record<string, Uint8Array | [Uint8Array, { level: 0 }]> = {};
  for (const [p, b] of Object.entries(files)) zipped[p] = /\.(png|jpe?g|webp|gif|avif|zip|mp4|m4v|webm|mov|ogv)$/i.test(p) ? [b, { level: 0 }] : b;
  return { bytes: zipSync(zipped, { level: 6 }), manifest };
}

/** `name.playfile`, safe as a file name. */
export function playfileName(name: string): string {
  return `${fileSafeName(name).replace(/\.(playfile|playfield|play)$/i, '')}${PLAYFILE_EXT}`;
}
