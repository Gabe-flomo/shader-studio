/**
 * addLayerCatalog — what the Add layer menu offers and how it is grouped.
 *
 * Two sections: Playfield layers (the built-in kinds, each in one group) and
 * Your layers (sketches saved as layer kinds, in folders of your own kept by
 * utils/assetFolders under the `layerKinds` scope). A new built-in kind needs
 * one entry in BUILTIN_LAYERS with its `group`; nothing else changes.
 *
 * Everything here is pure, so tests cover the grouping, folders and search.
 */
import type { PlayLayerKind } from '../../../types/play';
import type { IconName } from '../../ui/iconPaths';
import type { FolderEntry } from '../../../utils/assetFolders';
import type { LayerKindDef } from '../../../types/layerKinds';

/** assetFolders scope for folders of saved layer kinds. */
export const LAYER_KIND_FOLDER_SCOPE = 'layerKinds';

export type BuiltinGroupId = 'drawing' | 'textImages' | 'particles' | 'effects' | 'inputs' | 'code';

/** The groups under Playfield layers, in menu order. */
export const BUILTIN_GROUPS: ReadonlyArray<{ id: BuiltinGroupId; label: string }> = [
  { id: 'drawing', label: 'Drawing' },
  { id: 'textImages', label: 'Text & images' },
  { id: 'particles', label: 'Particles & physics' },
  { id: 'effects', label: 'Picture effects' },
  { id: 'inputs', label: 'Inputs & helpers' },
  { id: 'code', label: 'Code' },
];

/** `variant`: the same kind set up another way (a Script layer in 3D, a Shape made from hand nulls). */
export type BuiltinVariant = 'script3d' | 'handPath';
export interface BuiltinLayer { kind: PlayLayerKind; label: string; hint: string; icon: IconName; group: BuiltinGroupId; variant?: BuiltinVariant }

/** The built-in layer kinds: name, one-line hint, icon, and the group Add layer shows them in. */
export const BUILTIN_LAYERS: readonly BuiltinLayer[] = [
  { kind: 'shape', group: 'drawing', label: 'Shape', hint: 'Boxes, circles, lines or drawn outlines: to see, and as walls, emitters, portals, sensors.', icon: 'layoutCanvas' },
  { kind: 'shape', variant: 'handPath', group: 'drawing', label: 'Hand path', hint: 'A shape between your thumb and index fingertips, both hands, that moves as they do (hand tracking). Fill it, mask with it, use it as a matte or a zone.', icon: 'hand' },
  { kind: 'brush', group: 'drawing', label: 'Brush', hint: 'Paint on the picture with the mouse. Strokes fade and can be walls.', icon: 'curve' },
  { kind: 'cloner', group: 'drawing', label: 'Cloner', hint: 'Copies of a shape, text, image or null in a grid, ring, line or along a stroke. Vary them by index; nulls and shapes push, grow, turn or hide the copies near them.', icon: 'copy' },
  { kind: 'background', group: 'textImages', label: 'Background', hint: 'Under every layer: a queue of graphs, sketches, images, videos and colours, one showing at a time. Step through it with keys, beats, notes or hands; cut or crossfade. One per setup.', icon: 'slides' },
  { kind: 'text', group: 'textImages', label: 'Text', hint: 'Words over the picture or the picture inside them. Can step through lines.', icon: 'edit' },
  { kind: 'image', group: 'textImages', label: 'Image', hint: 'A picture of your own, blended or matted.', icon: 'overlay' },
  { kind: 'data', group: 'textImages', label: 'Data', hint: 'A dataset on the picture: a table as points, a path, bars, a pie or lines; text a word or a line at a time. Step through the rows with keys, beats or an Offset.', icon: 'grid' },
  { kind: 'particles', group: 'particles', label: 'Particles', hint: 'Flow along the picture, flock, swarm nulls and shapes, burst on the beat.', icon: 'spark' },
  { kind: 'bodies', group: 'particles', label: 'Bodies', hint: 'Letters, circles or boxes that fall, bounce and pile up.', icon: 'dice' },
  { kind: 'glyphs', group: 'effects', label: 'Glyphs', hint: 'The picture as ASCII, halftone dots, squares or lines.', icon: 'hash' },
  { kind: 'contours', group: 'effects', label: 'Contours', hint: 'Topographic lines through the picture\'s brightness.', icon: 'loop' },
  { kind: 'lens', group: 'effects', label: 'Lens', hint: 'A circle that magnifies, pixelates, blurs or inverts what is under it.', icon: 'search' },
  { kind: 'null', group: 'inputs', label: 'Null', hint: 'A point to drag or animate. Drives mappings, follows things, emits or absorbs particles.', icon: 'grip' },
  { kind: 'audio', group: 'inputs', label: 'Audio', hint: 'Live sound as a waveform, bars, a ring or a blob.', icon: 'wave' },
  { kind: 'camera', group: 'inputs', label: 'Camera', hint: 'Your webcam: as a layer, a mask, or what particles read. Its motion is a source.', icon: 'camera' },
  { kind: 'script', group: 'code', label: 'Script', hint: 'Draw with JavaScript: a setup and a draw function on a 2D canvas over the picture, with sliders you declare. Reads the picture, the mouse and nulls.', icon: 'code' },
  { kind: 'script', variant: 'script3d', group: 'code', label: '3D Script', hint: 'Draw in 3D with p5-style JavaScript on WebGL: boxes, spheres, lights and a camera you can drag, over the picture. The picture can skin the shapes.', icon: 'cube' },
];

/** Each kind's plain entry (not a variant), by kind. */
export const BUILTIN_LAYER = Object.fromEntries(BUILTIN_LAYERS.filter(k => !k.variant).map(k => [k.kind, k])) as Record<PlayLayerKind, BuiltinLayer>;

/** A row's stable key in the menu. */
export const builtinKey = (b: BuiltinLayer) => `b:${b.kind}${b.variant ? `:${b.variant}` : ''}`;

// ── Search ──────────────────────────────────────────────────────────────────

/** Every word of the query appears in the text (any order, any case). An empty query matches everything. */
export function matchesQuery(query: string, ...text: string[]): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = text.join(' ').toLowerCase();
  return words.every(w => hay.includes(w));
}

// ── The menu's shape ────────────────────────────────────────────────────────

export interface KindEntry { def: LayerKindDef; inFile: boolean }

export interface MenuGroup<T> {
  /** Stable key for remembering open/closed: `builtin:<id>`, `folder:<id>`. */
  key: string;
  label: string;
  items: T[];
  /** Items before the search, for the count shown when collapsed. */
  total: number;
  folder?: FolderEntry;
}

/** Built-ins grouped, filtered by the query; groups with no match are left out while searching. */
export function builtinGroups(query = '', layers: readonly BuiltinLayer[] = BUILTIN_LAYERS): MenuGroup<BuiltinLayer>[] {
  return BUILTIN_GROUPS.map(g => {
    const all = layers.filter(l => l.group === g.id);
    return { key: `builtin:${g.id}`, label: g.label, total: all.length, items: all.filter(l => matchesQuery(query, l.label, l.hint, g.label)) };
  }).filter(g => g.total > 0 && (!query.trim() || g.items.length > 0));
}

/**
 * Your layers: a group per folder (in the folders' order) and the kinds in
 * no folder (or in a folder that is gone). Searching matches the kind's name,
 * hint and its folder's name.
 */
export function yourLayers(kinds: readonly KindEntry[], folders: readonly FolderEntry[], membership: Readonly<Record<string, string>>, query = ''): { folders: MenuGroup<KindEntry>[]; loose: KindEntry[]; looseTotal: number } {
  const known = new Set(folders.map(f => f.id));
  const folderOf = (k: KindEntry) => { const f = membership[k.def.id]; return f && known.has(f) ? f : null; };
  const searching = !!query.trim();
  const groups = folders.map(f => {
    const all = kinds.filter(k => folderOf(k) === f.id);
    return { key: `folder:${f.id}`, label: f.label, folder: f, total: all.length, items: all.filter(k => matchesQuery(query, k.def.name, k.def.hint, f.label)) };
  }).filter(g => !searching || g.items.length > 0);
  const looseAll = kinds.filter(k => !folderOf(k));
  return { folders: groups, loose: looseAll.filter(k => matchesQuery(query, k.def.name, k.def.hint)), looseTotal: looseAll.length };
}

// ── Open / closed, per browser ──────────────────────────────────────────────

const OPEN_KEY = 'shader-studio:play:addLayerOpen';

/** Which groups you closed (sections and built-in groups; folders keep theirs in assetFolders). */
export function loadClosed(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(OPEN_KEY);
    const v = raw ? JSON.parse(raw) : {};
    return v && typeof v === 'object' ? v as Record<string, boolean> : {};
  } catch { return {}; }
}

export function saveClosed(closed: Record<string, boolean>): void {
  try { localStorage.setItem(OPEN_KEY, JSON.stringify(closed)); } catch { /* storage blocked: it still works until reload */ }
}
