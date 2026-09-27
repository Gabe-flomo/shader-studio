/**
 * Where a presentation's pictures and fonts live: saved here as references
 * (the backgrounds library and the font cache, IndexedDB via fake-indexeddb),
 * embedded again for exported pages and files, moved back out when a file or
 * an old presentation comes in (the same picture once), and missing ones
 * named. Plus the Files page's "used by" for step backgrounds.
 */
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => {
  const mem = new Map<string, string>();
  const g = globalThis as unknown as Record<string, unknown>;
  g.window = globalThis;
  g.dispatchEvent = () => true;
  g.localStorage = {
    get length() { return mem.size; },
    key: (i: number) => [...mem.keys()][i] ?? null,
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, v); },
    removeItem: (k: string) => { mem.delete(k); },
    clear: () => mem.clear(),
  };
  return mem;
});
// No canvas here: embedding gives the library's bytes back as they are. Google isn't asked.
vi.mock('../../lib/backgroundLibrary', async orig => {
  const m = await orig<typeof import('../../lib/backgroundLibrary')>();
  return {
    ...m,
    embedImage: async (id: string) => {
      const img = await m.getImage(id);
      if (!img) return null;
      const b = new Uint8Array(await img.blob.arrayBuffer());
      let bin = '';
      for (const x of b) bin += String.fromCharCode(x);
      return { name: img.name, src: `data:image/jpeg;base64,${btoa(bin)}`, libraryId: id };
    },
  };
});
vi.mock('../googleFonts', async orig => ({ ...(await orig<typeof import('../googleFonts')>()), fetchFontFaces: async () => { throw new Error('offline'); } }));

import { listImages, resetBackgroundCache, addImage } from '../../lib/backgroundLibrary';
import { faceDataUrl, fontKey } from '../../lib/fontCache';
import { internPresentation, internStoredPresentations, withEmbeddedAssets } from '../presentAssets';
import { buildPresentationHtml, exportNotes, presentationFileJson } from '../exportPresentation';
import { renderMarkdown } from '../markdown';
import { loadPresentation, savePresentation, PRESENTATION_PREFIX } from '../storage';
import { emptyPresentation, newStep, parsePresentation, type Presentation } from '../../types/presentation';
import type { EmbeddedFontFace, PresentImage } from '../../types/presentationStyle';
import { presentationBackgroundUse } from '../../files/inventory';

/** A JPEG-shaped data URL of `kb` KB of distinct bytes. */
function picture(seed: number, kb: number): string {
  const n = kb * 1024;
  let bin = '';
  for (let i = 0; i < n; i++) bin += String.fromCharCode((i * 31 + seed * 7) & 255);
  return `data:image/jpeg;base64,${btoa(bin)}`;
}
const THUMB = `data:image/jpeg;base64,${'Q'.repeat(2400)}`;
const FONT = (n: number) => `data:font/woff2;base64,${btoa(String.fromCharCode(...Array.from({ length: 60_000 }, (_, i) => (i * n) & 255)))}`;

/** A presentation as a downloaded file or an old save has it: three step backgrounds and two families, all embedded. */
function embedded(): Presentation {
  const p = emptyPresentation('Three pictures', 1);
  const images: PresentImage[] = [1, 2, 3].map(i => ({ id: `img${i}`, name: `Picture ${i}`, src: picture(i, 300), thumb: THUMB, avg: [0.1, 0.1, 0.1] }));
  p.steps = [1, 2, 3].map(i => ({ ...newStep(`Step ${i}`), id: `s${i}`, background: { kind: 'image' as const, image: `img${i}`, blur: 0.5, falloff: 0.7 } }));
  p.images = images;
  p.style = { typography: { heading: { family: 'Fraunces', category: 'serif', weight: 600 }, body: { family: 'Inter', category: 'sans', weight: 400 } } };
  const faces: EmbeddedFontFace[] = [
    { family: 'Inter', weight: '400 700', style: 'normal', unicodeRange: 'U+0000-00FF', src: FONT(3) },
    { family: 'Inter', weight: '400 700', style: 'normal', unicodeRange: 'U+0100-02BA', src: FONT(5) },
    { family: 'Fraunces', weight: '600', style: 'normal', unicodeRange: 'U+0000-00FF', src: FONT(7) },
  ];
  p.fonts = faces;
  return p;
}

beforeEach(() => {
  store.clear();
  (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
  resetBackgroundCache();
});

describe('saved presentations keep references', () => {
  it('moves embedded pictures into the library and fonts into the font cache; three backgrounds save in under 50 KB', async () => {
    const p = embedded();
    expect(JSON.stringify(p).length).toBeGreaterThan(1_000_000);
    const back = (await internPresentation(p))!;
    expect(back.images!.every(i => !i.src && i.libraryId && i.thumb)).toBe(true);
    expect(back.fonts!.every(f => !f.src)).toBe(true);
    expect(await listImages()).toHaveLength(3);
    expect(await faceDataUrl(fontKey(p.fonts![0]))).toBe(p.fonts![0].src);
    savePresentation('Three pictures', back);
    const stored = store.get(PRESENTATION_PREFIX + 'Three pictures')!;
    expect(stored.length).toBeLessThan(50_000);
    // And it reads back as the same presentation, references and all.
    expect(loadPresentation('Three pictures')).toEqual(parsePresentation(JSON.parse(JSON.stringify(back))));
  });

  it('keeps library ids that are here, adds the same picture once, and keeps a missing id for a new one', async () => {
    const own = await addImage(new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }), { name: 'Mine', width: 10, height: 10, thumb: THUMB });
    const p = embedded();
    p.images![0].libraryId = own.id;
    p.images![1].libraryId = 'img_from_elsewhere';
    const once = (await internPresentation(p))!;
    expect(once.images![0].libraryId).toBe(own.id);
    expect(once.images![1].libraryId).toBe('img_from_elsewhere');
    // The same file imported again: nothing new in the library.
    const again = (await internPresentation(embedded()))!;
    expect(await listImages()).toHaveLength(4);
    expect(again.images![2].libraryId).toBe(once.images![2].libraryId);
  });

  it('migrates old saved presentations (and restored ones) that still carry pictures', async () => {
    store.set(PRESENTATION_PREFIX + 'Old one', JSON.stringify(embedded()));
    store.set(PRESENTATION_PREFIX + 'Plain', JSON.stringify(emptyPresentation('Plain', 1)));
    const changed = await internStoredPresentations(savePresentation);
    expect(changed).toEqual(['Old one']);
    expect(store.get(PRESENTATION_PREFIX + 'Old one')!.length).toBeLessThan(50_000);
    const p = loadPresentation('Old one')!;
    expect(p.images).toHaveLength(3);
    expect(p.steps[2].background?.image).toBe('img3');
    // Nothing left to do the second time.
    expect(await internStoredPresentations(savePresentation)).toEqual([]);
  });
});

describe('exports and files embed them again', () => {
  it('embeds each picture once and every font face', async () => {
    const saved = (await internPresentation(embedded()))!;
    // Two steps showing the same picture.
    saved.steps[1] = { ...saved.steps[1], background: { kind: 'image', image: 'img1' } };
    const { doc, missingImages, missingFonts } = await withEmbeddedAssets(saved);
    expect(missingImages).toEqual([]);
    expect(missingFonts).toEqual([]);
    expect(doc.images!.map(i => i.id).sort()).toEqual(['img1', 'img3']);
    for (const layout of ['slides', 'scroll'] as const) {
      const html = buildPresentationHtml(doc, renderMarkdown, { layout, math: 'mathml' });
      for (const img of doc.images!) expect(html.split(img.src!).length - 1).toBe(1);
      expect(html.match(/@font-face/g)).toHaveLength(3);
    }
    // A downloaded file comes back in whole.
    const file = parsePresentation(JSON.parse(presentationFileJson(doc)))!;
    expect(file.images!.every(i => i.src)).toBe(true);
    expect(file.fonts!.every(f => f.src)).toBe(true);
  });

  it('names what the library doesn’t have, and shows its preview', async () => {
    const saved = (await internPresentation(embedded()))!;
    saved.images![0] = { ...saved.images![0], libraryId: 'gone' };
    const { doc, missingImages } = await withEmbeddedAssets(saved);
    expect(missingImages).toEqual(['Picture 1']);
    expect(exportNotes(doc).some(n => n.what === 'The image background “Picture 1”')).toBe(true);
    const html = buildPresentationHtml(doc, renderMarkdown, { layout: 'slides', math: 'mathml' });
    expect(html).toContain(THUMB);
  });

  it('lists fonts it can’t find (not cached here, offline)', async () => {
    const saved = (await internPresentation(embedded()))!;
    saved.fonts = [...saved.fonts!, { family: 'Lora', weight: '400', style: 'normal' }];
    saved.style = { ...saved.style, typography: { ...saved.style!.typography, code: { family: 'Lora', category: 'serif', weight: 400 } } };
    const { doc, missingFonts } = await withEmbeddedAssets(saved);
    expect(missingFonts).toEqual(['Lora']);
    expect(exportNotes({ ...doc, fonts: saved.fonts }).some(n => n.what === 'The font Lora')).toBe(true);
  });
});

describe('Files page', () => {
  it('says which steps show a library image', () => {
    const p = embedded();
    p.images = p.images!.map((i, k) => ({ ...i, libraryId: k === 2 ? 'other' : 'lib1' }));
    p.style = { ...p.style, background: { kind: 'image', image: 'img1' } };
    const use = presentationBackgroundUse(JSON.parse(JSON.stringify(p)), 'libraryId', 'lib1');
    expect(use).toEqual({ images: 2, where: 'The default background and the background of steps 1, 2' });
    expect(presentationBackgroundUse(JSON.parse(JSON.stringify(p)), 'libraryId', 'nope').images).toBe(0);
  });
});
