/**
 * sampleStyle.ts — dressing a sample presentation when it's built in the
 * app: a still of one of its sources rendered as an image background (the
 * same renderAt a capture uses), and a font pairing fetched from Google Fonts
 * and embedded. Only in a browser, and only what works: offline, the sample
 * keeps the page's own fonts; without WebGL, its title step has no picture.
 */
import { captureInput, needsWarmup } from '../lib/backgroundCapture';
import { captureSteps } from '../lib/backgroundLibrary';
import { mountPlay } from './runtimeHost';
import { fetchFontFaces, findFont, nearestWeight } from './googleFonts';
import { newId, type Presentation, type PresentSource } from '../types/presentation';
import { roleWeights, type EmbeddedFontFace, type FontRole, type FontRoleName, type PresentBackground, type PresentImage, type PresentTypography, type RGB } from '../types/presentationStyle';

const inBrowser = () => typeof document !== 'undefined' && typeof window !== 'undefined' && typeof HTMLCanvasElement !== 'undefined';

/** A JPEG still of a source's shader (no layers) at `time`, or null when it can't be drawn here. */
export async function renderStill(source: PresentSource, o: { w: number; h: number; time: number; quality?: number }): Promise<{ src: string; avg: RGB } | null> {
  if (!inBrowser()) return null;
  const el = document.createElement('div');
  el.style.cssText = `position:fixed;left:-20000px;top:0;width:${o.w}px;height:${o.h}px;pointer-events:none;opacity:0`;
  document.body.appendChild(el);
  const input = captureInput(source.bundle, 'graph');
  let m: ReturnType<typeof mountPlay> | null = null;
  try {
    m = mountPlay(el, input, { panel: false, pointer: false, markers: false, maxDpr: 1, fit: 'cover', paused: true, startTime: o.time, pixelSize: { w: o.w, h: o.h } });
    const plan = needsWarmup(input, 'graph') ? captureSteps(o.time, { maxSteps: 240 }) : { dt: 1 / 60, steps: [] as number[] };
    // The player needs a frame or two to compile; try a few times.
    for (let i = 0; i < 12; i++) {
      await new Promise(r => setTimeout(r, i === 0 ? 120 : 200));
      await m.seekVideos?.(o.time);
      const c = m.renderAt?.(o.time, { steps: plan.steps, dt: plan.dt, seed: 1, capture: true });
      if (!c || !c.width) continue;
      const out = document.createElement('canvas');
      out.width = o.w; out.height = o.h;
      const x = out.getContext('2d');
      if (!x) return null;
      x.drawImage(c, 0, 0, o.w, o.h);
      const d = x.getImageData(0, 0, o.w, o.h).data;
      let r = 0, g = 0, b = 0, n = 0;
      for (let k = 0; k < d.length; k += 4 * 97) { r += d[k]; g += d[k + 1]; b += d[k + 2]; n++; }
      // A blank frame (still compiling) isn't a picture.
      if (r + g + b === 0 && i < 11) continue;
      return { src: out.toDataURL('image/jpeg', o.quality ?? 0.86), avg: [r / n / 255, g / n / 255, b / n / 255] };
    }
    return null;
  } catch { return null; }
  finally { m?.destroy(); el.remove(); }
}

/** Fonts for the roles, fetched and embedded; roles whose font can't be fetched are left to the page's own. */
export async function sampleFonts(roles: Partial<Record<FontRoleName, { family: string; weight?: number }>>): Promise<{ typography: PresentTypography; fonts: EmbeddedFontFace[] }> {
  const typography: PresentTypography = {};
  const fonts: EmbeddedFontFace[] = [];
  if (!inBrowser()) return { typography, fonts };
  const byFamily = new Map<string, { weights: Set<number>; roles: Array<[FontRoleName, FontRole]> }>();
  for (const [name, want] of Object.entries(roles) as Array<[FontRoleName, { family: string; weight?: number }]>) {
    const f = findFont(want.family);
    if (!f) continue;
    const role: FontRole = { family: f.family, category: f.category, weight: name === 'heading' ? nearestWeight(f, want.weight ?? 600) : 400 };
    const e = byFamily.get(f.family) ?? { weights: new Set<number>(), roles: [] };
    for (const w of roleWeights(name, role)) e.weights.add(w);
    e.roles.push([name, role]);
    byFamily.set(f.family, e);
  }
  await Promise.all([...byFamily].map(async ([family, e]) => {
    try {
      fonts.push(...await fetchFontFaces(family, [...e.weights]));
      for (const [name, role] of e.roles) typography[name] = role;
    } catch { /* offline: the page's fonts */ }
  }));
  return { typography, fonts };
}

/** Put an image background on one step. */
export function withStepImage(p: Presentation, stepIndex: number, still: { src: string; avg: RGB }, name: string, bg: Omit<PresentBackground, 'kind' | 'image'>): Presentation {
  const img: PresentImage = { id: newId('i'), name, src: still.src, avg: still.avg };
  return {
    ...p,
    images: [...(p.images ?? []), img],
    steps: p.steps.map((s, i) => (i === stepIndex ? { ...s, background: { ...bg, kind: 'image', image: img.id } } : s)),
  };
}

/** Add typography (and its fonts) to a presentation. */
export function withTypography(p: Presentation, t: { typography: PresentTypography; fonts: EmbeddedFontFace[] }): Presentation {
  if (!Object.keys(t.typography).length) return p;
  return { ...p, style: { ...p.style, typography: { ...p.style?.typography, ...t.typography } }, fonts: [...(p.fonts ?? []), ...t.fonts] };
}
