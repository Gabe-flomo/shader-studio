/**
 * dropLayers.ts — image and video files dropped on the Play preview or the
 * Layers panel become Image and Video layers (play/layerDrop.ts takes the
 * drops on the picture). Layers are Pro: on Free a drop opens the Pro sheet.
 *
 *   An image    becomes an Image layer (the picture as a data URL, 1024 px at
 *               most, like the card's Choose image).
 *   A video     goes into the backgrounds library and becomes a Video layer
 *               naming it (like the card's Choose a video).
 *
 * Each lands where it was dropped on the picture (the middle from the Layers
 * panel), several stepped a little apart; the last one is selected.
 */
import { defaultLayer, type ImageLayer, type PlayLayer, type PlayRecord, type VideoLayer } from '../../types/play';
import { playId } from '../../play/playControls';
import { dropPlaces, mediaFiles, mediaKind, type DropPoint } from '../../play/layerDrop';
import { can, requireFeature } from '../../lib/plan';
import { toast } from '../ui/toastStore';
import { addToGroup } from './groupOps';
import { usePlayUi } from './playUi';

/** A layer's name from a file's: without the extension, at most 40 characters. */
export function layerNameOf(fileName: string, fallback: string): string {
  const base = fileName.replace(/\.[a-z0-9]{2,5}$/i, '').replace(/\s+/g, ' ').trim();
  return (base || fallback).slice(0, 40);
}

export interface DropMakers {
  /** An image file as an Image layer's src (null: unreadable). */
  imageSrc(file: File): Promise<string | null>;
  /** A video file kept in the library: what the Video layer records. */
  video(file: File): Promise<{ videoId: string; fileName: string; bytes: number; kept: boolean }>;
}

/** The layers for these files (images and videos; anything else is left out), placed from `at`. */
export async function layersFromFiles(files: readonly File[], at: DropPoint | null, make: DropMakers): Promise<{ layers: PlayLayer[]; failed: string[]; sessionOnly: number }> {
  const media = mediaFiles(files as File[]);
  const places = dropPlaces(media.length, at);
  const layers: PlayLayer[] = [];
  const failed: string[] = [];
  let sessionOnly = 0;
  for (let i = 0; i < media.length; i++) {
    const f = media[i], p = places[i];
    try {
      if (mediaKind(f) === 'image') {
        const src = await make.imageSrc(f);
        if (!src) { failed.push(f.name); continue; }
        layers.push({ ...(defaultLayer('image', playId('layer'), layerNameOf(f.name, 'Image')) as ImageLayer), src, x: p.x, y: p.y });
      } else {
        const got = await make.video(f);
        if (!got.kept) sessionOnly++;
        layers.push({ ...(defaultLayer('video', playId('layer'), layerNameOf(f.name, 'Video')) as VideoLayer), videoId: got.videoId, fileName: got.fileName, bytes: got.bytes, x: p.x, y: p.y });
      }
    } catch { failed.push(f.name); }
  }
  return { layers, failed, sessionOnly };
}

/** The overlay's words for a drag of `count` files (0: unknown yet). */
export function dropLabel(count: number, where: 'picture' | 'list' = 'picture'): string {
  if (!can('play.layers')) return 'Layers are Pro: drop to see Pro';
  const it = count > 1 ? `${count} layers` : 'it as a layer';
  return where === 'list' ? `Drop to add ${it} to the list` : `Drop to add ${it} here`;
}

/**
 * Add dropped files as layers: the Pro check, the files made into layers,
 * the setup changed (into the group the Layers panel has entered, if any),
 * the last one selected, and a word about anything that didn't come in.
 */
export async function addDroppedLayers(files: readonly File[], at: DropPoint | null, onChange: (fn: (p: PlayRecord) => PlayRecord) => void, make: DropMakers, group = ''): Promise<string[]> {
  const media = mediaFiles(files as File[]);
  if (!media.length) {
    if (files.length) toast.info('Nothing to add', { message: 'Drop images (PNG, JPG, WebP, GIF, SVG) or videos (MP4, WebM, MOV) to add them as layers.' });
    return [];
  }
  if (!requireFeature('play.layers')) return [];
  const r = await layersFromFiles(media, at, make);
  if (r.layers.length) {
    onChange(p => {
      let next: PlayRecord = { ...p, layers: [...p.layers, ...r.layers] };
      if (group) for (const l of r.layers) next = addToGroup(next, l.id, group);
      return next;
    });
    usePlayUi.getState().reveal(r.layers[r.layers.length - 1].id);
  }
  if (r.failed.length) toast.error(`Couldn’t add ${r.failed.length === 1 ? `“${r.failed[0]}”` : `${r.failed.length} files`}`, { message: 'This browser couldn’t read it as an image or video.' });
  if (r.sessionOnly) toast.info('Playing for this session only', { message: 'The library couldn’t keep the video (storage full or blocked), so after a reload its layer asks for it again.' });
  const skipped = files.length - media.length;
  if (skipped > 0 && r.layers.length) toast.info(`${skipped === 1 ? 'One file' : `${skipped} files`} left out`, { message: 'Only images and videos become layers.' });
  return r.layers.map(l => l.id);
}
