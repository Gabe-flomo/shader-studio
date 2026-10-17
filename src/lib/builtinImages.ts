/**
 * builtinImages.ts — pictures that ship with the app, as static files under `public/media/`
 * (served at `<base>media/…` on the web build and from the desktop app's bundle alike), as
 * lib/builtinVideos.ts does for the Ball action clip.
 *
 * Two photos, used by the Pictures examples (store/pictureExamples.ts):
 *  - **Room and cat** (1280 × 720): a person in glasses and a crochet hat holding a grey cat close to the
 *    camera in a warm-lit bedroom (posters, a door);
 *  - **Walkway cat** (768 × 1024, portrait): the same person and the grey cat on a stone walkway, plants
 *    on the right.
 *
 * A Texture node names one by its id in `params.libraryId`, where a Library picture's id goes, and
 * `getImage` (lib/backgroundLibrary.ts) resolves it here: fetched from the build once and kept, never
 * stored in the library. The Texture card's Library picker lists them first, under Built in.
 *
 * Where a picture can't be decoded (node and jsdom tests: no createImageBitmap) `canDecodeImage()` is
 * false and nothing is fetched.
 */

export interface BuiltinImage {
  id: string;
  name: string;
  /** Path under the app's base URL. */
  path: string;
  type: string;
  bytes: number;
  width: number;
  height: number;
}

/** Room and cat: a warm-lit bedroom, a person holding a grey cat (16:9). */
export const ROOM_AND_CAT_ID = 'builtin:room-and-cat';
/** Walkway cat: a grey cat on a stone walkway, a selfie (3:4 portrait). */
export const WALKWAY_CAT_ID = 'builtin:walkway-cat';

export const BUILTIN_IMAGES: Record<string, BuiltinImage> = {
  [ROOM_AND_CAT_ID]: { id: ROOM_AND_CAT_ID, name: 'Room and cat', path: 'media/room-and-cat.jpg', type: 'image/jpeg', bytes: 133_254, width: 1280, height: 720 },
  [WALKWAY_CAT_ID]: { id: WALKWAY_CAT_ID, name: 'Walkway cat', path: 'media/walkway-cat.jpg', type: 'image/jpeg', bytes: 288_558, width: 768, height: 1024 },
};

/** In the order the Library picker lists them. */
export const BUILTIN_IMAGE_LIST: readonly BuiltinImage[] = Object.values(BUILTIN_IMAGES);

export const isBuiltinImage = (id: string): boolean => Object.prototype.hasOwnProperty.call(BUILTIN_IMAGES, id);

/** A built-in picture's URL in this build ('/shader-studio/media/…' on the web, '/media/…' on the desktop). */
export function builtinImageUrl(id: string): string {
  const v = BUILTIN_IMAGES[id];
  const base = (import.meta.env?.BASE_URL as string | undefined) ?? '/';
  return v ? `${base}${v.path}` : '';
}

/** Can this page decode a picture into a texture? False in node / jsdom (tests), where pictures never load. */
export function canDecodeImage(): boolean {
  return typeof document !== 'undefined' && typeof fetch !== 'undefined' && typeof createImageBitmap === 'function';
}

/**
 * A Texture node's params showing a built-in picture: its id where a Library picture's goes (the picture
 * restorer loads it through getImage), its name, shape and the card's thumbnail (the file itself).
 */
export function builtinImageParams(id: string): Record<string, unknown> {
  const v = BUILTIN_IMAGES[id];
  if (!v) return {};
  return { libraryId: v.id, _imageName: v.name, _imageAspect: v.width / v.height, _thumbnailUrl: builtinImageUrl(v.id) };
}

const cache = new Map<string, Promise<Blob | null>>();

/** A built-in picture's file, fetched once; null when it can't be had here (offline, tests, a missing file). */
export function builtinImageBlob(id: string): Promise<Blob | null> {
  if (!isBuiltinImage(id) || !canDecodeImage()) return Promise.resolve(null);
  let p = cache.get(id);
  if (!p) {
    p = fetch(builtinImageUrl(id))
      .then(r => (r.ok ? r.blob() : null))
      .then(b => (b && b.size > 0 ? (b.type.startsWith('image/') ? b : new Blob([b], { type: BUILTIN_IMAGES[id].type })) : null))
      .catch(() => null);
    // A failed fetch is tried again next time (it may have been the network).
    void p.then(b => { if (!b) cache.delete(id); });
    cache.set(id, p);
  }
  return p;
}
