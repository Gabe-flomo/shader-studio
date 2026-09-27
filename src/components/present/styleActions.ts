/**
 * styleActions — changing how the open presentation looks (the Style panel's
 * side): step and default backgrounds, image backgrounds from the library, a
 * file or a capture (embedded once, with their average colour measured),
 * and typography, whose fonts are fetched from Google Fonts once when chosen
 * and embedded (googleFonts.ts).
 */
import { embedImage, importImageFile } from '../../lib/backgroundLibrary';
import { fetchFontFaces, findFont, nearestWeight } from '../../present/googleFonts';
import { newId, type Presentation } from '../../types/presentation';
import {
  faceCovers, neededFonts, usedImages, type EmbeddedFontFace, type FontRole, type FontRoleName, type PresentBackground, type PresentImage, type PresentTypography, type RGB,
} from '../../types/presentationStyle';
import { toast } from '../ui/toastStore';
import { usePresentation } from './presentationStore';

/** An image background in a presentation: at most this on its long side, and this many characters. */
const EMBED = { maxSide: 1920, maxChars: 1_600_000 };

/** The average colour of a picture (a data or object URL), 0..1; undefined when it can't be read. */
export async function imageAverage(src: string): Promise<RGB | undefined> {
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = src;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = 16; c.height = 16;
    const x = c.getContext('2d', { willReadFrequently: true });
    if (!x) return undefined;
    x.drawImage(img, 0, 0, 16, 16);
    const d = x.getImageData(0, 0, 16, 16).data;
    const acc = [0, 0, 0];
    for (let i = 0; i < d.length; i += 4) for (let j = 0; j < 3; j++) acc[j] += d[i + j];
    const n = d.length / 4;
    return acc.map(v => Math.round((v / n / 255) * 1000) / 1000) as RGB;
  } catch { return undefined; }
}

/** A library image background, embedded for the presentation. Null when it's gone. */
export async function presentImageFromLibrary(libraryId: string): Promise<PresentImage | null> {
  const e = await embedImage(libraryId, EMBED);
  if (!e) return null;
  const img: PresentImage = { id: newId('i'), name: e.name, src: e.src, libraryId: e.libraryId };
  const avg = await imageAverage(e.src);
  if (avg) img.avg = avg;
  return img;
}

/** A picture file: kept in the library's Image backgrounds too (so other setups can use it), and embedded. */
export async function presentImageFromFile(file: File): Promise<PresentImage | null> {
  const meta = await importImageFile(file);
  return presentImageFromLibrary(meta.id);
}

/** Put an image in the presentation (the same library image or picture is kept once); returns its id there. */
export function withImage(p: Presentation, img: PresentImage): { doc: Presentation; id: string } {
  const list = p.images ?? [];
  const same = list.find(i => (img.libraryId && i.libraryId === img.libraryId) || i.src === img.src);
  if (same) return { doc: { ...p, images: list.map(i => (i.id === same.id ? { ...img, id: same.id } : i)) }, id: same.id };
  return { doc: { ...p, images: [...list, img] }, id: img.id };
}

/** Drop images no background uses any more. */
export function tidyImages(p: Presentation): Presentation {
  if (!p.images?.length) return p;
  const used = usedImages(p.style, p.steps);
  const images = p.images.filter(i => used.has(i.id));
  if (images.length === p.images.length) return p;
  const next = { ...p };
  if (images.length) next.images = images; else delete next.images;
  return next;
}

/** Set a step's own background (undefined: use the presentation's). */
export function setStepBackground(index: number, bg: PresentBackground | undefined): void {
  usePresentation.getState().update(p => tidyImages({
    ...p,
    steps: p.steps.map((s, i) => {
      if (i !== index) return s;
      const next = { ...s };
      if (bg) next.background = bg; else delete next.background;
      return next;
    }),
  }));
}

/** Set the presentation's background, the one steps show unless they set their own. */
export function setDefaultBackground(bg: PresentBackground | undefined): void {
  usePresentation.getState().update(p => {
    const style = { ...p.style };
    if (bg && bg.kind !== 'none') style.background = bg; else delete style.background;
    const next: Presentation = { ...p, style };
    if (!Object.keys(style).length) delete next.style;
    return tidyImages(next);
  });
}

/** Add an image and point a background at it, in one change. */
export function applyImage(img: PresentImage, apply: (id: string, p: Presentation) => Presentation): void {
  usePresentation.getState().update(p => { const r = withImage(p, img); return tidyImages(apply(r.id, r.doc)); });
}

export function patchTypography(patch: Partial<PresentTypography>): void {
  usePresentation.getState().update(p => {
    const t: PresentTypography = { ...p.style?.typography, ...patch };
    for (const k of Object.keys(t) as Array<keyof PresentTypography>) if (t[k] === undefined) delete t[k];
    const style = { ...p.style };
    if (Object.keys(t).length) style.typography = t; else delete style.typography;
    const next: Presentation = { ...p, style };
    if (!Object.keys(style).length) delete next.style;
    return withFontsFor(next, p.fonts ?? []);
  });
}

/** Keep only the faces of families the typography uses. */
function withFontsFor(p: Presentation, faces: readonly EmbeddedFontFace[]): Presentation {
  const need = neededFonts(p.style?.typography);
  const fonts = faces.filter(f => need.has(f.family));
  const next = { ...p };
  if (fonts.length) next.fonts = fonts; else delete next.fonts;
  return next;
}

/** Families whose needed weights the embedded faces don't cover yet. */
export function missingFonts(t: PresentTypography | undefined, faces: readonly EmbeddedFontFace[]): Array<{ family: string; weights: number[] }> {
  const out: Array<{ family: string; weights: number[] }> = [];
  for (const [family, need] of neededFonts(t)) {
    const own = faces.filter(f => f.family === family && f.style === 'normal');
    const font = findFont(family);
    // A weight the family doesn't have is stood in for by its nearest (the browser picks it the same way).
    const missing = [...need.weights].filter(w => { const at = font ? nearestWeight(font, w) : w; return !own.some(f => faceCovers(f, at)); });
    if (!own.length || missing.length) out.push({ family, weights: [...need.weights] });
  }
  return out;
}

/** Which family is downloading now (for the panel). */
let busyFamily: string | null = null;
const busyListeners = new Set<() => void>();
export function fontBusy(): string | null { return busyFamily; }
export function onFontBusy(cb: () => void): () => void { busyListeners.add(cb); return () => { busyListeners.delete(cb); }; }
function setBusy(f: string | null) { busyFamily = f; for (const cb of busyListeners) cb(); }

/**
 * Use a font for a role (null: the system font). The family is downloaded
 * from Google Fonts once, at the weights the roles need, and embedded; if it
 * can't be, nothing changes and a toast says why.
 */
export async function chooseFont(role: FontRoleName, choice: FontRole | null): Promise<boolean> {
  const st = usePresentation.getState();
  const doc = st.doc;
  if (!doc) return false;
  const t: PresentTypography = { ...doc.style?.typography };
  if (choice) t[role] = choice; else delete t[role];
  const missing = missingFonts(t, doc.fonts ?? []);
  let faces = doc.fonts ?? [];
  if (missing.length) {
    try {
      for (const m of missing) {
        setBusy(m.family);
        const got = await fetchFontFaces(m.family, m.weights);
        faces = [...faces.filter(f => f.family !== m.family), ...got];
      }
    } catch (e) {
      toast.error('Couldn’t download the font', { message: `${e instanceof Error ? e.message : String(e)} Fonts come from Google Fonts: check the connection and try again.` });
      return false;
    } finally { setBusy(null); }
  }
  // The presentation may have changed while the font downloaded: apply to what it is now.
  usePresentation.getState().update(p => {
    const now: PresentTypography = { ...p.style?.typography };
    if (choice) now[role] = choice; else delete now[role];
    const style = { ...p.style };
    if (Object.keys(now).length) style.typography = now; else delete style.typography;
    const next: Presentation = { ...p, style };
    if (!Object.keys(style).length) delete next.style;
    const merged = [...(p.fonts ?? []).filter(f => !faces.some(g => g.family === f.family)), ...faces];
    return withFontsFor(next, merged);
  });
  return true;
}
