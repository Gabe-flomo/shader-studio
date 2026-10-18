/**
 * libraryCategories.ts — what the Library shows (docs/library.md): only what can be put on the
 * graph, and the media library. Each category is one row of the Library, drawn like a category of
 * the Nodes list; group presets come first.
 *
 *   Presets   Group presets (yours) · Built-in groups · My nodes · Functions · Expression Blocks ·
 *             Vector transforms · Palettes
 *   Media     Pictures · Videos · Sounds
 *
 * Not here, on purpose: saved graphs (the top bar's Load), the Code page's shaders (Code → Shader),
 * builder presets (their builder's strip), Play's layer sets, racks and drum kits, Finish presets
 * and keyframe curves (where they apply), background palettes (Backgrounds). They all still live
 * in the Library's facade (libraryFacade.ts) for Files, export and import.
 */
import { localMutableKV, type MutableKV } from '../files/mutate';
import { builtInPresets, listPresets } from '../presets/presetStore';
import { listLibrary, type LibraryItem } from './libraryFacade';
import { isAudioType, isSplatType, type BackgroundImageMeta, type LibraryVideoMeta } from '../lib/backgroundLibrary';
import type { MediaKind } from './mediaPlacement';

export type LibraryCategoryId = 'groups' | 'builtInGroups' | 'nodes' | 'functions' | 'expressions' | 'transforms' | 'palettes' | 'images' | 'videos' | 'sounds';

export interface LibraryCategory {
  id: LibraryCategoryId;
  label: string;
  section: 'Presets' | 'Media';
  /** One line about what is in it (the row's tooltip, the opened category's note). */
  info: string;
}

export const LIBRARY_CATEGORIES: readonly LibraryCategory[] = [
  { id: 'groups', label: 'Group presets', section: 'Presets', info: 'Groups you saved as presets (a group’s menu → Save as preset). Each one comes in as the same group, wired inside.' },
  { id: 'builtInGroups', label: 'Built-in groups', section: 'Presets', info: 'Effects that come with Playfield, as groups you can open and change.' },
  { id: 'nodes', label: 'My nodes', section: 'Presets', info: 'Node types you published (Publish node): a graph, a group or GLSL as one node.' },
  { id: 'functions', label: 'Functions', section: 'Presets', info: 'Custom Function nodes you saved as presets.' },
  { id: 'expressions', label: 'Expression Blocks', section: 'Presets', info: 'Expression Block nodes you saved as presets.' },
  { id: 'transforms', label: 'Vector transforms', section: 'Presets', info: 'Transform Vec nodes you saved as presets.' },
  { id: 'palettes', label: 'Palettes', section: 'Presets', info: 'Palettes you saved from a Palette node: each comes in as a Palette (or a Stops Palette) holding it.' },
  { id: 'images', label: 'Pictures', section: 'Media', info: 'Pictures in the media library: each comes in as a Texture node showing it.' },
  { id: 'videos', label: 'Videos', section: 'Media', info: 'Videos in the media library: each comes in as a Texture node playing it (muted).' },
  { id: 'sounds', label: 'Sounds', section: 'Media', info: 'Sounds in the media library: each comes in as an Audio Source with the sound loaded (press play on its card).' },
];

export const libraryCategory = (id: LibraryCategoryId) => LIBRARY_CATEGORIES.find(c => c.id === id)!;

/** A thing in the Library: a saved item, or a media file (`media`). */
export interface AddableItem extends LibraryItem {
  category: LibraryCategoryId;
  /** A built-in group (can't be renamed or deleted). */
  builtIn?: boolean;
  media?: MediaKind;
}

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);

/** The saved things that go on the graph, by category (sync: read from local storage). */
export function listAddable(kv: MutableKV = localMutableKV): Record<Exclude<LibraryCategoryId, 'images' | 'videos' | 'sounds'>, AddableItem[]> {
  const presets = listLibrary('presets', kv);
  const ofKind = (kind: string, category: LibraryCategoryId) => presets.filter(p => p.kind === kind).map(p => ({ ...p, category })).sort(byName);
  return {
    groups: ofKind('group', 'groups'),
    builtInGroups: builtInPresets('group').map(b => ({ type: 'presets' as const, id: b.id, name: b.name, kind: 'group', savedAt: 0, hint: b.hint, record: b.record, category: 'builtInGroups' as const, builtIn: true })),
    nodes: listLibrary('nodes', kv).map(n => ({ ...n, category: 'nodes' as const })),
    functions: listLibrary('functions', kv).map(f => ({ ...f, category: 'functions' as const })).sort(byName),
    expressions: listLibrary('expressions', kv).map(f => ({ ...f, category: 'expressions' as const })).sort(byName),
    transforms: ofKind('transform', 'transforms'),
    palettes: listPresets('palette', kv).map(p => ({ type: 'presets' as const, id: p.id, name: p.name, kind: 'palette', savedAt: p.savedAt, record: p.record, folderScope: 'presets:palette', category: 'palettes' as const })).sort(byName),
  };
}

/** The media library as Library items: pictures, videos and sounds (splats aren't media here). */
export function mediaItems(images: readonly BackgroundImageMeta[] | null, videos: readonly LibraryVideoMeta[] | null): Record<'images' | 'videos' | 'sounds', AddableItem[]> {
  const item = (m: { id: string; name: string; thumb?: string; createdAt: number }, category: 'images' | 'videos' | 'sounds', media: MediaKind): AddableItem =>
    ({ type: 'presets', id: m.id, name: m.name, savedAt: m.createdAt, thumb: m.thumb || null, category, media });
  const vids = (videos ?? []).filter(v => !isSplatType(v.type));
  return {
    images: (images ?? []).map(m => item(m, 'images', 'image')).sort(byName),
    videos: vids.filter(v => !isAudioType(v.type)).map(m => item(m, 'videos', 'video')).sort(byName),
    sounds: vids.filter(v => isAudioType(v.type)).map(m => item(m, 'sounds', 'sound')).sort(byName),
  };
}
