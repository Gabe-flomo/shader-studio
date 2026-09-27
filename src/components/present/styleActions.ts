/**
 * styleActions — changing how the open presentation looks (the Style panel's
 * side): step and default backgrounds, image backgrounds from the library, a
 * file or a capture (referenced, with a tiny preview and their average colour),
 * and typography, whose fonts are fetched from Google Fonts once when chosen
 * and kept in the font cache (googleFonts.ts, lib/fontCache.ts).
 */
import { importImageFile } from '../../lib/backgroundLibrary';
import { referenceTo } from '../../present/presentAssets';
import { openBackgrounds } from '../backgrounds/backgroundsUi';
import { fetchFontFaces, findFont, nearestWeight, parseFontLink } from '../../present/googleFonts';
import { putFace } from '../../lib/fontCache';
import type { Presentation } from '../../types/presentation';
import {
  faceCovers, neededFonts, usedImages, type EmbeddedFontFace, type FontRole, type FontRoleName, type PresentBackground, type PresentImage, type PresentTypography, type RGB,
} from '../../types/presentationStyle';
import { isPlainClassic, resetTheme, type PresentTheme, type ThemeColourKey, type ThemeId } from '../../types/presentTheme';
import type { UserTheme } from '../../present/userThemes';
import { toast } from '../ui/toastStore';
import { usePresentation } from './presentationStore';

/** A library image background as the presentation's image: a reference (the picture stays in the library). Null when it's gone. */
export function presentImageFromLibrary(libraryId: string): Promise<PresentImage | null> {
  return referenceTo(libraryId);
}

/** A picture file: kept in the library's Image backgrounds (so other setups can use it), and referenced. */
export async function presentImageFromFile(file: File): Promise<PresentImage | null> {
  const meta = await importImageFile(file);
  return referenceTo(meta.id);
}

/** Point an image the library doesn't have (any more) at a picture picked from it; its fit, position and effects stay. */
export async function relinkImage(imageId: string): Promise<void> {
  const p = await openBackgrounds({ pick: 'image', title: 'Relink the image background' });
  if (p?.kind !== 'image') return;
  const img = await referenceTo(p.image.id);
  if (!img) { toast.error('That image background is gone'); return; }
  usePresentation.getState().update(doc => ({ ...doc, images: (doc.images ?? []).map(i => (i.id === imageId ? { ...img, id: imageId } : i)) }));
  toast.success(`Relinked to “${img.name}”`);
}

/** Put an image in the presentation (the same library image or picture is kept once); returns its id there. */
export function withImage(p: Presentation, img: PresentImage): { doc: Presentation; id: string } {
  const list = p.images ?? [];
  const same = list.find(i => (img.libraryId && i.libraryId === img.libraryId) || (!!img.src && i.src === img.src));
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
    // A family from a link (outside the list) came with the weights Google has: those are what it has.
    if (!font && own.length) continue;
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
 * Use a font for a role (null: the theme's). The family is downloaded from
 * Google Fonts once, at the weights the roles need, and embedded; if it can't
 * be, nothing changes and a toast says why.
 */
export async function chooseFont(role: FontRoleName, choice: FontRole | null): Promise<boolean> {
  return applyTypography(t => {
    const next: PresentTypography = { ...t };
    if (choice) next[role] = choice; else delete next[role];
    return next;
  });
}

/**
 * A font from a pasted Google Fonts link or family name (parseFontLink) for a
 * role. A heading takes the link's weight nearest bold; a family outside the
 * list is asked for at the weights it's needed in. Null (with a toast) when
 * the text isn't one, or the font couldn't be downloaded.
 */
export async function chooseFontByLink(role: FontRoleName, input: string): Promise<FontRole | null> {
  const link = parseFontLink(input);
  if (!link) {
    toast.error('That isn’t a Google Fonts link or family name', { message: 'Paste a fonts.google.com page, a fonts.googleapis.com/css2 link, or a name like “Space Grotesk”.' });
    return null;
  }
  const known = findFont(link.family);
  const offered = link.weights.length ? link.weights : known?.weights ?? [400, 700];
  const want = link.category === 'serif' || link.category === 'display' ? 600 : 700;
  // A tie goes to the heavier (a headline wants weight).
  const weight = role === 'heading' ? nearestWeight({ weights: offered }, want + 1) : 400;
  const choice: FontRole = { family: link.family, category: link.category, weight };
  return (await chooseFont(role, choice)) ? usePresentation.getState().doc?.style?.typography?.[role] ?? choice : null;
}

/** Each weight (in 100s) some face covers. */
function coveredWeights(faces: readonly EmbeddedFontFace[]): number[] {
  const out = new Set<number>();
  for (const f of faces) for (let w = 100; w <= 900; w += 100) if (faceCovers(f, w)) out.add(w);
  return [...out];
}

/**
 * Change the typography, downloading the fonts it now needs (once, into the
 * font cache; the presentation lists their faces). A heading in a family that
 * came without its weight (outside the list, Google sent only regular) takes
 * the nearest it has. False, and nothing changes, when a download fails.
 */
export async function applyTypography(change: (t: PresentTypography) => PresentTypography): Promise<boolean> {
  const st = usePresentation.getState();
  const doc = st.doc;
  if (!doc) return false;
  const t = change({ ...doc.style?.typography });
  const missing = missingFonts(t, doc.fonts ?? []);
  let faces = doc.fonts ?? [];
  if (missing.length) {
    try {
      for (const m of missing) {
        setBusy(m.family);
        const got = await fetchFontFaces(m.family, m.weights);
        // The files go to the font cache; the presentation lists the faces (exports embed them again).
        await Promise.all(got.map(g => putFace(g)));
        faces = [...faces.filter(f => f.family !== m.family), ...got.map(({ src: _s, ...f }) => { void _s; return f; })];
      }
    } catch (e) {
      toast.error('Couldn’t download the font', { message: `${e instanceof Error ? e.message : String(e)} Fonts come from Google Fonts: check the connection and try again.` });
      return false;
    } finally { setBusy(null); }
  }
  // The presentation may have changed while the font downloaded: apply to what it is now.
  usePresentation.getState().update(p => {
    const now = change({ ...p.style?.typography });
    for (const role of ['heading', 'body', 'code'] as const) {
      const r = now[role];
      if (!r || findFont(r.family)) continue;
      const has = coveredWeights(faces.filter(f => f.family === r.family && f.style === 'normal'));
      if (has.length && !has.includes(r.weight)) now[role] = { ...r, weight: nearestWeight({ weights: has }, r.weight) };
    }
    for (const k of Object.keys(now) as Array<keyof PresentTypography>) if (now[k] === undefined) delete now[k];
    const style = { ...p.style };
    if (Object.keys(now).length) style.typography = now; else delete style.typography;
    const next: Presentation = { ...p, style };
    if (!Object.keys(style).length) delete next.style;
    const merged = [...(p.fonts ?? []).filter(f => !faces.some(g => g.family === f.family)), ...faces];
    return withFontsFor(next, merged);
  });
  return true;
}

// ── Theme ───────────────────────────────────────────────────────────────────

/** Change the theme (undefined, or Classic with nothing changed: no theme, the page as it always was). */
export function setTheme(change: (t: PresentTheme) => PresentTheme | undefined): void {
  usePresentation.getState().update(p => {
    const t = change(p.style?.theme ?? { id: 'classic' });
    const style = { ...p.style };
    if (t && !isPlainClassic(t)) style.theme = t; else delete style.theme;
    const next: Presentation = { ...p, style };
    if (!Object.keys(style).length) delete next.style;
    return next;
  });
}

/** Choose a built-in theme: its look, fresh (settings changed on the last one are dropped; fonts chosen by hand stay). */
export function pickTheme(id: ThemeId): void {
  setTheme(() => ({ id }));
}

type ThemePatch = Partial<Pick<PresentTheme, 'mode' | 'radius' | 'column' | 'spacing'>> & { colours?: Partial<Record<ThemeColourKey, RGB | undefined>> };

/** Change some of the theme's settings (undefined: back to the theme's). */
export function patchTheme(patch: ThemePatch): void {
  setTheme(t => {
    const next: PresentTheme = { ...t };
    delete next.saved;
    for (const k of ['mode', 'radius', 'column', 'spacing'] as const) {
      if (!(k in patch)) continue;
      const v = patch[k];
      if (v === undefined) delete next[k]; else (next as unknown as Record<string, unknown>)[k] = v;
    }
    if (patch.colours) {
      const c = { ...t.colours };
      for (const [k, v] of Object.entries(patch.colours) as Array<[ThemeColourKey, RGB | undefined]>) { if (v) c[k] = v; else delete c[k]; }
      if (Object.keys(c).length) next.colours = c; else delete next.colours;
    }
    return next;
  });
}

/** Back to the theme as it comes: its settings, and the fonts, size and colours set by hand. */
export async function resetAllToTheme(): Promise<void> {
  setTheme(t => resetTheme(t));
  await applyTypography(() => ({}));
}

/** Apply one of your saved themes: its theme and typography (fonts downloaded when needed). */
export async function applyUserTheme(u: UserTheme): Promise<boolean> {
  const ok = await applyTypography(() => ({ ...u.typography }));
  if (ok) setTheme(() => ({ ...u.theme, saved: { id: u.id, name: u.name } }));
  return ok;
}
