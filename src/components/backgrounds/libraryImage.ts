/**
 * libraryImage.ts — a library image background as a Play source: picked in
 * the backgrounds window, embedded (a data URL within the setup's limits, so
 * the setup works anywhere it goes) with its library id kept for relinking.
 */
import type { BackgroundItem } from '../../types/play';
import { embedImage } from '../../lib/backgroundLibrary';
import { newSourceId } from '../../play/backgroundQueue';
import type { MenuItem } from '../ui/Menu';
import { toast } from '../ui/toastStore';
import { openBackgrounds } from './backgroundsUi';
import { linkedImageSource } from '../linked/linkedSources';

/** A library image as a Play source: embedded (so the setup works anywhere), with its id kept for relinking. */
export async function libraryImageSource(id: string): Promise<BackgroundItem | null> {
  const e = await embedImage(id);
  return e ? { id: newSourceId(), kind: 'image', name: e.name, src: e.src, libraryId: e.libraryId } : null;
}

/** Ask for an image: from the library's backgrounds, a file, or (when given) a linked folder. */
export function imageMenuItems(fromLibrary: () => void, fromFile: () => void, fromLinked?: () => void): MenuItem[] {
  return [
    { label: 'From your backgrounds…', icon: 'overlay', hint: 'An image background from the Library: captured from a graph, or imported', onSelect: fromLibrary },
    { label: 'Upload a file…', icon: 'import', hint: 'PNG, JPG, WebP or SVG', onSelect: fromFile },
    ...(fromLinked ? [{ label: 'From a linked folder…', icon: 'link' as const, hint: 'A picture in a folder you linked on the Files page', onSelect: fromLinked }] : []),
  ];
}

/** Pick an image background from the library and make it a source (null when cancelled or gone). */
export async function pickLibraryImage(): Promise<BackgroundItem | null> {
  const p = await openBackgrounds({ pick: 'image', title: 'Choose an image background', linked: true });
  if (p?.kind === 'linked') {
    try { return await linkedImageSource(p.ref); } catch (e) { toast.error('Couldn’t use that image', { message: e instanceof Error ? e.message : String(e) }); return null; }
  }
  if (!p || p.kind !== 'image') return null;
  try {
    const item = await libraryImageSource(p.image.id);
    if (!item) toast.error('That image background is gone');
    return item;
  } catch (e) { toast.error('Couldn’t use that image', { message: e instanceof Error ? e.message : String(e) }); return null; }
}
