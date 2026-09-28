/**
 * The .playfile container (Playfield's one file format): types, versions and
 * limits. The full spec is docs/playfile-format.md; the writer is writer.ts and
 * the reader reader.ts.
 *
 * A .playfile is a ZIP holding `manifest.json` and one file per item, wrapped
 * (since container v2) in an encrypted envelope so that only Playfield opens
 * it (container.ts). The manifest lists every item with its kind, path, size
 * and SHA-256, and can carry the author's Ed25519 signature over all of that.
 */

export const PLAYFILE_FORMAT = 'playfile';
/** Names the format had while it was being built (.playfield, .play): still read. */
export const LEGACY_FORMATS: readonly string[] = ['playfield', 'play'];
/** The manifest's format version (the ZIP's layout). A reader refuses a newer one (it says so) and reads every older one. */
export const PLAYFILE_VERSION = 1;
/**
 * The container's version: 1 is a plain ZIP (read forever, never written any
 * more), 2 the encrypted envelope this app writes (container.ts). The manifest
 * inside a v2 file is still `version: 1`: the envelope changed, not the layout.
 */
export const CONTAINER_VERSION = 2;
export const PLAYFILE_EXT = '.playfile';
/** Every extension Import offers for the container. */
export const CONTAINER_ACCEPT = '.playfile,.playfield,.play';
/** Is this file name one of the container's extensions? (What it holds is told by its bytes: reader.ts isPlayfile.) */
export const isContainerName = (name: string): boolean => /\.(playfile|playfield|play)$/i.test(name);
/** Not `+zip` any more: a v2 file isn't one (v1 files were `application/x-playfile+zip`). */
export const PLAYFILE_MIME = 'application/x-playfile';
export const MANIFEST_PATH = 'manifest.json';

/**
 * What an item can be.
 *   graph         a graph file (the Studio's Export as readable JSON), opens in the Studio
 *   play          a play file (a graph with its Play setup), opens on Play
 *   presentation  a .present.json, with its pictures and fonts embedded
 *   nodes         a node pack: { version: 1, nodes: UserNodeDefinition[] }, maybe sealed
 *   glsl          a .glsl shader (plain text) for the GLSL page
 *   background    an image for the backgrounds library
 *   library       a Library snapshot (presets, functions, scripts, settings…), merged in
 *   profile       a whole profile ZIP (Files → Download everything), installed with Install
 *   video         a Video layer's file (mp4, webm, mov…), kept in the videos library under its id
 */
export type ItemKind = 'graph' | 'play' | 'presentation' | 'nodes' | 'glsl' | 'background' | 'library' | 'profile' | 'video';
export const ITEM_KINDS: readonly ItemKind[] = ['graph', 'play', 'presentation', 'nodes', 'glsl', 'background', 'library', 'profile', 'video'];
export const isItemKind = (k: unknown): k is ItemKind => typeof k === 'string' && (ITEM_KINDS as readonly string[]).includes(k);

/** Where each kind's files go inside the ZIP, and the extension they get. */
export const KIND_LAYOUT: Record<ItemKind, { dir: string; ext: string; label: string; plural: string }> = {
  graph: { dir: 'graphs', ext: '.graph.json', label: 'Graph', plural: 'Graphs' },
  play: { dir: 'plays', ext: '.play.json', label: 'Play setup', plural: 'Play setups' },
  presentation: { dir: 'presentations', ext: '.present.json', label: 'Presentation', plural: 'Presentations' },
  nodes: { dir: 'nodes', ext: '.nodes.json', label: 'Node pack', plural: 'Node packs' },
  glsl: { dir: 'glsl', ext: '.glsl', label: 'GLSL shader', plural: 'GLSL shaders' },
  background: { dir: 'backgrounds', ext: '', label: 'Background image', plural: 'Background images' },
  library: { dir: 'library', ext: '.library.json', label: 'Presets and settings', plural: 'Presets and settings' },
  profile: { dir: 'profile', ext: '.zip', label: 'Whole profile', plural: 'Whole profiles' },
  video: { dir: 'videos', ext: '', label: 'Video', plural: 'Videos' },
};

export interface ManifestItem {
  kind: string;
  /** Inside the ZIP, `/`-separated, relative. */
  path: string;
  /** What it is called in the app (a graph's name, a presentation's title…). */
  name: string;
  /** Its length in bytes. */
  bytes: number;
  /** Lower-case hex SHA-256 of its bytes. */
  sha256: string;
  /** Kind-specific, informational: a node pack's `count` and `sealed`, an image's `type`… */
  meta?: Record<string, unknown>;
}

export interface ManifestAuthor {
  /** A display name, chosen by the author. Not verified by anyone. */
  name: string;
  /** Present when the file is signed: the author's Ed25519 public key, base64 (32 bytes). */
  publicKey?: string;
}

export interface ManifestSignature {
  alg: 'Ed25519';
  /** base64 signature over `canonicalJson(manifest without "signature")`. */
  value: string;
}

export interface PlayfileManifest {
  format: string;
  version: number;
  /** The app version that wrote it. */
  appVersion: string;
  /** The kinds inside, for a quick look. */
  kinds: string[];
  /** ISO 8601. */
  created: string;
  author?: ManifestAuthor;
  items: ManifestItem[];
  signature?: ManifestSignature;
}

/** Everything the reader checks sizes against. Tests pass smaller ones. */
export interface PlayfileLimits {
  /** The .playfile file itself. */
  fileBytes: number;
  /** One item, unpacked. */
  itemBytes: number;
  /** Everything, unpacked. */
  totalBytes: number;
  /** Files in the ZIP. */
  entries: number;
  manifestBytes: number;
  pathLength: number;
  nameLength: number;
}

export const DEFAULT_LIMITS: PlayfileLimits = {
  fileBytes: 256 * 1024 * 1024,
  itemBytes: 128 * 1024 * 1024,
  totalBytes: 512 * 1024 * 1024,
  entries: 2000,
  manifestBytes: 1024 * 1024,
  pathLength: 240,
  nameLength: 200,
};

/** "1.5 MB" / "300 KB", for limit messages. */
export function formatBytes(n: number): string {
  return n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(n >= 10 * 1024 * 1024 ? 0 : 1)} MB` : `${Math.ceil(n / 1024)} KB`;
}

/** A file this reader won't open, with a sentence saying why. */
export class PlayfileError extends Error {
  constructor(message: string) { super(message); this.name = 'PlayfileError'; }
}

/**
 * A path inside the ZIP that is safe to name anything by: relative, `/`
 * separated, no `..` or `.` parts, no drive letters, backslashes or control
 * characters. Nothing is ever written to disk by these paths, but a manifest
 * pointing outside itself is a sign of a crafted file.
 */
export function isSafePath(p: string, maxLength = DEFAULT_LIMITS.pathLength): boolean {
  if (typeof p !== 'string' || !p || p.length > maxLength) return false;
  // eslint-disable-next-line no-control-regex
  if (/[\\\u0000-\u001f\u007f]/.test(p) || p.startsWith('/') || /^[a-zA-Z]:/.test(p)) return false;
  return p.split('/').every(part => part !== '' && part !== '.' && part !== '..');
}

/** A name safe to use as a file name inside the ZIP. */
export function fileSafeName(name: string): string {
  // eslint-disable-next-line no-control-regex
  return name.trim().replace(/[/\\:*?"<>|\u0000-\u001f]/g, '-').replace(/\s+/g, ' ').replace(/^\.+/, '').slice(0, 80) || 'untitled';
}
