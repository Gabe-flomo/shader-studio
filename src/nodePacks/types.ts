/**
 * Node packs (docs/node-packs.md): a set of node types made in the Builder's
 * pack workspace and shared as one `.playfile`, with the graphs that show how
 * they're used, GLSL, presentations, images and notes alongside.
 *
 * Two shapes live here:
 *
 *   PackProject  the thing you edit (saved on this device, reopened and
 *                exported again with a new version)
 *   PackInfo     what travels in the file: inside the `nodes` item's JSON
 *                (`{ version: 1, nodes, pack }`), so older readers, which
 *                only read `nodes`, still import the node types
 */
import type { UserNodeDefinition } from '../types/userNode';

/** Where a node in a pack came from (for "include the graphs these nodes came from" and for editing it again). */
export type PackNodeOrigin =
  /** Written in the node builder (GLSL). */
  | { kind: 'scratch' }
  /** A whole saved graph: what's wired into its Output becomes the node. */
  | { kind: 'graph'; graph: string }
  /** A group inside a saved graph. */
  | { kind: 'graphGroup'; graph: string; groupId: string; groupLabel: string }
  /** A saved group preset. */
  | { kind: 'groupPreset'; presetId: string; label: string }
  /** A saved Custom Function. */
  | { kind: 'customFn'; presetId: string; label: string }
  /** A saved Expression Block. */
  | { kind: 'expr'; presetId: string; label: string }
  /** A node type that was already published. */
  | { kind: 'published' };

export interface PackNode {
  /** The published node type (its id is its type key and GLSL function name). */
  nodeId: string;
  /** Its name in the pack (renamed here without touching the node type). */
  label: string;
  origin: PackNodeOrigin;
  /** The node as it was when added or last checked (stored form: a sealed one stays sealed), so the pack still exports if the node type goes away. */
  snapshot?: UserNodeDefinition;
}

export type PackExtra =
  /** A saved graph; `auto` marks one offered for you (the graph a node came from). */
  | { kind: 'graph'; name: string; auto?: boolean }
  /** A saved presentation; `auto` marks a presentation linked to an included graph. */
  | { kind: 'presentation'; name: string; auto?: boolean }
  /** A shader from the GLSL page. */
  | { kind: 'glsl'; id: string; name: string }
  /** A background image from the library. */
  | { kind: 'background'; id: string; name: string }
  /** Notes in markdown (a readme, how to use the nodes). */
  | { kind: 'note'; id: string; name: string; text: string };

export type PackExtraKind = PackExtra['kind'];

export interface PackExport {
  version: string;
  at: number;
  /** The signing key's fingerprint. */
  signer?: string;
  sealed: boolean;
  bytes: number;
}

export const PACK_PROJECT_KIND = 'shader-studio-nodepack-project';

export interface PackProject {
  kind: typeof PACK_PROJECT_KIND;
  id: string;
  name: string;
  /** Display name, as it goes in the manifest's `author`. */
  author: string;
  /** Semver: `major.minor.patch`. */
  version: string;
  description: string;
  /** The pack's colour (a CSS hex colour). */
  color: string;
  /** A short glyph shown on the pack (one emoji or up to two letters). */
  icon: string;
  licence: string;
  sealed: boolean;
  /** In order: the order the pack lists them. Not called `nodes`: a stored value with a `nodes` array looks like a graph. */
  packNodes: PackNode[];
  extras: PackExtra[];
  createdAt: number;
  updatedAt: number;
  /** Every export, newest last. */
  exports: PackExport[];
}

/** The pack's description in the file. */
export interface PackInfo {
  id: string;
  name: string;
  version: string;
  author?: string;
  description?: string;
  color?: string;
  icon?: string;
  licence?: string;
  /** Markdown notes (a readme). */
  notes?: Array<{ name: string; text: string }>;
  /** Names of the `graph` items that show the nodes in use. */
  examples?: string[];
  /** Names of the `presentation` items that go with it. */
  presentations?: string[];
}

/** A pack that came in: its nodes sit in a node-list category named after it, with its examples a click away. */
export interface InstalledPack extends PackInfo {
  /** The node types it brought (ids as registered here). */
  nodeIds: string[];
  /** The category its nodes are listed under. */
  category: string;
  signedBy?: { name: string; fingerprint: string };
  installedAt: number;
}

const str = (v: unknown, max = 200): string | undefined => (typeof v === 'string' && v.trim() ? v.slice(0, max) : undefined);
const strList = (v: unknown, max = 200): string[] | undefined => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, max).map(s => s.slice(0, 200)) : undefined);

/** The `pack` of a node pack's JSON, checked field by field (it comes from a file). Null when there's none. */
export function readPackInfo(raw: unknown): PackInfo | null {
  const p = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as { pack?: unknown }).pack : undefined;
  if (!p || typeof p !== 'object' || Array.isArray(p)) return null;
  const o = p as Record<string, unknown>;
  const name = str(o.name, 80);
  if (!name) return null;
  const notes = Array.isArray(o.notes)
    ? o.notes.flatMap(n => (n && typeof n === 'object' && typeof (n as { text?: unknown }).text === 'string'
      ? [{ name: str((n as { name?: unknown }).name, 80) ?? 'Notes', text: ((n as { text: string }).text).slice(0, 100_000) }] : [])).slice(0, 20)
    : undefined;
  return {
    id: str(o.id, 80) ?? `pack_${name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`,
    name,
    version: str(o.version, 20) ?? '1.0.0',
    author: str(o.author, 80),
    description: str(o.description, 4000),
    color: typeof o.color === 'string' && /^#[0-9a-f]{3,8}$/i.test(o.color) ? o.color : undefined,
    icon: str(o.icon, 8),
    licence: str(o.licence, 20_000),
    notes: notes?.length ? notes : undefined,
    examples: strList(o.examples),
    presentations: strList(o.presentations),
  };
}
