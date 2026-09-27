/**
 * useBackgrounds.ts — the library's image backgrounds and palettes as React
 * state, kept current (lib/backgroundLibrary.ts subscribe, and folder
 * changes), plus the undoable deletes the lists use.
 */
import { useEffect, useState } from 'react';
import { allPalettes, deleteImage, deletePalette, ensureVideoPoster, listImages, listVideos, removeVideo, subscribe, type BackgroundImageMeta, type LibraryVideoMeta, type Palette } from '../../lib/backgroundLibrary';
import { formatSize } from '../../utils/library';
import { toast } from '../ui/toastStore';

/** Every image background (null while the first read is under way; [] when the store can't open). */
export function useBackgroundImages(): { images: BackgroundImageMeta[] | null; error: string | null } {
  const [images, setImages] = useState<BackgroundImageMeta[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    const read = () => { listImages().then(l => { if (live) { setImages(l); setError(null); } }, e => { if (live) { setImages([]); setError(e instanceof Error ? e.message : String(e)); } }); };
    read();
    const off = subscribe(read);
    window.addEventListener('assetbrowser-folders-changed', read);
    return () => { live = false; off(); window.removeEventListener('assetbrowser-folders-changed', read); };
  }, []);
  return { images, error };
}

/** The built-in palettes, then yours. */
export function usePalettes(): Palette[] {
  const [list, setList] = useState<Palette[]>(allPalettes);
  useEffect(() => {
    const read = () => setList(allPalettes());
    const off = subscribe(read);
    window.addEventListener('assetbrowser-folders-changed', read);
    return () => { off(); window.removeEventListener('assetbrowser-folders-changed', read); };
  }, []);
  return list;
}

export async function deleteImageWithUndo(img: Pick<BackgroundImageMeta, 'id' | 'name'>): Promise<void> {
  try {
    const undo = await deleteImage(img.id);
    if (!undo) return;
    toast.info(`Deleted “${img.name}”`, {
      message: 'Setups and presentations that use it keep their copy.',
      action: { label: 'Undo', onClick: () => { void undo(); } },
    });
  } catch (e) { toast.error('Couldn’t delete it', { message: e instanceof Error ? e.message : String(e) }); }
}

export function deletePaletteWithUndo(p: Pick<Palette, 'id' | 'name'>): void {
  const undo = deletePalette(p.id);
  if (!undo) return;
  toast.info(`Deleted “${p.name}”`, { message: 'Backgrounds that use it keep their colours.', action: { label: 'Undo', onClick: undo } });
}

/** Every kept video (the Video layers' files), newest first; null while the first read is under way. Missing posters are made as they're listed. */
export function useLibraryVideos(): { videos: LibraryVideoMeta[] | null; error: string | null } {
  const [videos, setVideos] = useState<LibraryVideoMeta[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    const read = () => {
      listVideos().then(l => {
        if (!live) return;
        setVideos(l); setError(null);
        for (const v of l) if (v.thumb === undefined) void ensureVideoPoster(v.id).catch(() => {});
      }, e => { if (live) { setVideos([]); setError(e instanceof Error ? e.message : String(e)); } });
    };
    read();
    const off = subscribe(read);
    return () => { live = false; off(); };
  }, []);
  return { videos, error };
}

/** Delete kept videos with one Undo. `note` says what the layers that used them do now. */
export async function deleteVideosWithUndo(list: ReadonlyArray<Pick<LibraryVideoMeta, 'id' | 'name' | 'bytes'>>, note?: string): Promise<void> {
  try {
    const undos: Array<() => Promise<void>> = [];
    for (const v of list) { const u = await removeVideo(v.id); if (u) undos.push(u); }
    if (!undos.length) return;
    const bytes = list.reduce((n, v) => n + v.bytes, 0);
    toast.info(list.length === 1 ? `Deleted “${list[0].name}”` : `Deleted ${list.length} videos`, {
      message: `Freed ${formatSize(bytes)}.${note ? ` ${note}` : ''}`,
      action: { label: 'Undo', onClick: () => { void (async () => { for (const u of undos) await u(); })(); } },
    });
  } catch (e) { toast.error('Couldn’t delete it', { message: e instanceof Error ? e.message : String(e) }); }
}
