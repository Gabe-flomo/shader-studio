/**
 * linkedSources.ts — files from linked folders as the things pickers make
 * (docs/linked-folders.md): a Background layer's image or video source, the
 * header Background's image or video, an image layer's picture.
 *
 * Images are embedded in the setup the way an uploaded picture is (scaled,
 * so a shared setup works anywhere), with `libraryId` naming the linked file
 * it came from. Videos aren't embedded at all: the setup names the linked
 * file and it plays from disk (play/background.ts reads it).
 */
import type { BackgroundItem, BackgroundVideo } from '../../types/play';
import { newSourceId } from '../../play/backgroundQueue';
import { resolveLinked } from '../../files/linkedFolders';
import { baseNameOf, mimeOf, parseLinkedRef } from '../../files/linkedRefs';
import { baseName, loadBackgroundImage } from '../play/backgroundFiles';

/** The linked file as a File (for the code that takes a picked file); throws when it can't be read. */
export async function linkedFile(ref: string): Promise<File> {
  const got = await resolveLinked(ref);
  if (!got.ok) throw new Error(got.reason === 'permission' ? 'The folder needs your OK again (Files → Linked folders).' : got.reason === 'folder' ? 'The linked folder isn’t there (drive unplugged, moved?).' : 'That file isn’t in its folder any more.');
  return new File([got.blob], got.name, { type: got.type || mimeOf(got.name), lastModified: got.mtime });
}

const nameOf = (ref: string) => baseNameOf(parseLinkedRef(ref)?.path ?? ref);

/** A Background layer image source from a linked picture (embedded, like a file you pick). */
export async function linkedImageSource(ref: string): Promise<BackgroundItem> {
  const file = await linkedFile(ref);
  return { id: newSourceId(), kind: 'image', name: baseName(file.name), src: await loadBackgroundImage(file), libraryId: ref };
}

/** A Background layer video source that plays a linked video from disk. */
export function linkedVideoSource(ref: string, bytes: number, prev?: Pick<BackgroundItem, 'loop' | 'muted' | 'rate'>): BackgroundItem {
  return { id: newSourceId(), kind: 'video', name: nameOf(ref).slice(0, 120), src: '', bytes, libraryId: ref, loop: prev?.loop ?? true, muted: prev?.muted ?? true, rate: prev?.rate ?? 1 };
}

/** The header Background's image from a linked picture. */
export async function linkedBackgroundImage(ref: string): Promise<{ name: string; src: string; libraryId: string }> {
  const file = await linkedFile(ref);
  return { name: baseName(file.name), src: await loadBackgroundImage(file), libraryId: ref };
}

/** The header Background's video, playing a linked file from disk. */
export function linkedBackgroundVideo(ref: string, bytes: number, prev?: Pick<BackgroundVideo, 'loop' | 'muted' | 'rate'>): BackgroundVideo {
  return { name: nameOf(ref).slice(0, 120), src: '', bytes, libraryId: ref, loop: prev?.loop ?? true, muted: prev?.muted ?? true, rate: prev?.rate ?? 1 };
}
