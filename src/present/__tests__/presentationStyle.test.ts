/**
 * How presentations look: step backgrounds and the default they inherit,
 * legibility effects, embedded images and fonts through the parse gate, the
 * text colours over a background, Google Fonts embedding (with a stand-in
 * fetch), and the exported page carrying each picture and font once.
 */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  const mem = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, String(v)); }, removeItem: (k: string) => { mem.delete(k); },
    key: (i: number) => [...mem.keys()][i] ?? null, get length() { return mem.size; }, clear: () => mem.clear(),
  });
  vi.stubGlobal('window', { dispatchEvent: () => true, addEventListener: () => {}, removeEventListener: () => {} });
});
import { emptyPresentation, newStep, parsePresentation, type Presentation } from '../../types/presentation';
import {
  DARK_TEXT, LIGHT_TEXT, SHADE_DARK, fontFaceCss, luminance, resolveBackground, stepLook, styleBytes, typeVars,
  type EmbeddedFontFace, type PresentImage,
} from '../../types/presentationStyle';
import { backdropLayers, blurPx, falloffMask } from '../backdrop';
import { buildPresentationHtml } from '../exportPresentation';
import { fetchFontFaces, fontsCssUrl, mergeFaces, parseGoogleCss } from '../googleFonts';
import { renderMarkdown } from '../markdown';

// A 1×1 JPEG-shaped data URL (the gate checks the shape, not the pixels) and a font file.
const JPEG = `data:image/jpeg;base64,${'A'.repeat(4000)}`;
const WOFF2 = `data:font/woff2;base64,${'B'.repeat(800)}`;
const dark: PresentImage = { id: 'img1', name: 'Dusk', src: JPEG, libraryId: 'bg-lib-1', avg: [0.08, 0.07, 0.12] };
const face = (weight: string, unicodeRange?: string): EmbeddedFontFace => ({ family: 'Inter', weight, style: 'normal', src: WOFF2, ...(unicodeRange ? { unicodeRange } : {}) });

function styled(): Presentation {
  const p = emptyPresentation('Styled', 1);
  p.steps = [
    { ...newStep('Title'), id: 's1', background: { kind: 'image', image: 'img1', fit: 'cover', position: [0.3, 0.6], blur: 0.5, falloff: 0.75, shade: 0.4, vignette: 0.3 } },
    { ...newStep('Plain'), id: 's2' },
    { ...newStep('None'), id: 's3', background: { kind: 'none' } },
    { ...newStep('Again'), id: 's4', background: { kind: 'image', image: 'img1', blur: 0.2 } },
  ];
  p.style = {
    background: { kind: 'fill', fill: { style: 'gradient', stops: [{ pos: 0, color: [0.95, 0.94, 0.9] }, { pos: 1, color: [0.85, 0.83, 0.78] }], angle: 180 }, vignette: 0.2 },
    typography: { heading: { family: 'Fraunces', category: 'serif', weight: 600 }, body: { family: 'Inter', category: 'sans', weight: 400 }, scale: 1.1, lineHeight: 1.7 },
  };
  p.images = [dark];
  p.fonts = [face('400 700', 'U+0000-00FF'), { ...face('600'), family: 'Fraunces' }];
  return p;
}

describe('backgrounds in the file', () => {
  it('round-trip: step backgrounds, the default, images, typography and fonts', () => {
    const p = styled();
    const back = parsePresentation(JSON.parse(JSON.stringify(p)));
    expect(back).toEqual(p);
  });

  it('leaves presentations from before styling as they were', () => {
    const p = emptyPresentation('Old', 5);
    const back = parsePresentation(JSON.parse(JSON.stringify(p)))!;
    expect(back).toEqual(p);
    expect('style' in back || 'images' in back || 'fonts' in back || 'background' in back.steps[0]).toBe(false);
  });

  it('clamps effects, drops what points nowhere, and keeps only images and fonts in use', () => {
    const raw = JSON.parse(JSON.stringify(styled()));
    raw.steps[0].background.blur = 7;
    raw.steps[0].background.shade = -3;
    raw.steps[1].background = { kind: 'image', image: 'gone' };
    raw.steps[2].background = { kind: 'sparkles' };
    raw.images.push({ id: 'unused', name: 'x', src: JPEG });
    raw.images.push({ id: 'bad', name: 'x', src: 'https://example.com/a.jpg' });
    raw.fonts.push({ ...face('400'), family: 'Lobster' });
    raw.fonts.push({ ...face('400'), src: 'https://fonts.gstatic.com/x.woff2' });
    const back = parsePresentation(raw)!;
    expect(back.steps[0].background?.blur).toBe(1);
    expect(back.steps[0].background?.shade).toBe(0);
    expect(back.steps[1].background).toBeUndefined();
    expect(back.steps[2].background).toBeUndefined();
    expect(back.images?.map(i => i.id)).toEqual(['img1']);
    expect(back.fonts?.map(f => f.family).sort()).toEqual(['Fraunces', 'Inter']);
  });
});

describe('a step’s look', () => {
  const p = styled();
  const images = new Map([[dark.id, dark]]);

  it('inherits the presentation’s background unless it sets its own; None is none', () => {
    expect(resolveBackground(p.style, p.steps[0])?.kind).toBe('image');
    expect(resolveBackground(p.style, p.steps[1])?.kind).toBe('fill');
    expect(resolveBackground(p.style, p.steps[2])).toBeNull();
    expect(resolveBackground(undefined, newStep())).toBeNull();
  });

  it('puts light text on dark backgrounds and dark text on light ones', () => {
    const onImage = stepLook(p.style, images, p.steps[0]);
    expect(onImage.lightText).toBe(true);
    expect(onImage.text?.heading).toBe(LIGHT_TEXT.heading);
    expect(onImage.text?.shadow).not.toBe('');
    expect(onImage.tone).toEqual(SHADE_DARK);
    const onPaper = stepLook(p.style, images, p.steps[1]);
    expect(onPaper.lightText).toBe(false);
    expect(onPaper.text?.body).toBe(DARK_TEXT.body);
    // No background and no colours set: the page's theme decides.
    expect(stepLook(p.style, images, p.steps[2]).text).toBeNull();
    // Text colours set win, and the shade follows them.
    const set = stepLook({ ...p.style, typography: { bodyColour: [0.1, 0.1, 0.1] } }, images, p.steps[0]);
    expect(set.lightText).toBe(false);
    expect(set.text?.body).toBe('#1a1a1a');
    // The automatic colours are readable: well past 4.5:1 against the backgrounds that pick them.
    const contrast = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    const hexL = (h: string) => luminance([1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255));
    expect(contrast(hexL(LIGHT_TEXT.body), luminance(dark.avg!))).toBeGreaterThan(7);
    expect(contrast(hexL(DARK_TEXT.body), luminance([0.9, 0.89, 0.85]))).toBeGreaterThan(7);
  });

  it('builds the layers: picture, blur with its falloff mask, shade, vignette', () => {
    const look = stepLook(p.style, images, p.steps[0]);
    const layers = backdropLayers(look.bg!, { src: dark.src, matte: dark.avg, tone: look.tone, column: 1000 });
    expect(layers.map(l => l.name)).toEqual(['base', 'blur', 'shade', 'vignette']);
    const blur = Object.fromEntries(layers[1].decls);
    expect(blur.filter).toBe(`blur(${blurPx(0.5)}px)`);
    expect(blur['mask-image']).toBe(falloffMask(0.75, 1000));
    expect(blur['-webkit-mask-image']).toBe(blur['mask-image']);
    expect(blur['background-position']).toBe('30% 60%');
    // The mask: full across the 1000 px column, a quarter strength (1 − falloff) at the edges.
    expect(falloffMask(0.75, 1000)).toMatch(/^linear-gradient\(90deg, rgb\(0 0 0 \/ 0\.25\) 0%.*#000 calc\(50% - min\(50%, 500px\)\), #000 calc\(50% \+ min\(50%, 500px\)\)/);
    // No falloff: blurred evenly (no mask). No blur: no blurred copy at all.
    expect(Object.fromEntries(backdropLayers({ ...look.bg!, falloff: 0 }, { src: 'x', tone: look.tone, column: 900 })[1].decls)['mask-image']).toBeUndefined();
    expect(backdropLayers({ ...look.bg!, blur: 0 }, { src: 'x', tone: look.tone, column: 900 }).map(l => l.name)).toEqual(['base', 'shade', 'vignette']);
    // A gradient has nothing to blur.
    expect(backdropLayers({ kind: 'fill', fill: p.style!.background!.fill, blur: 1 }, { tone: look.tone, column: 900 }).map(l => l.name)).toEqual(['base']);
  });

  it('turns the typography into variables with system fallbacks', () => {
    const v = typeVars(p.style?.typography);
    expect(v['--pp-font-heading']).toMatch(/^"Fraunces", Georgia/);
    expect(v['--pp-font-body']).toMatch(/^"Inter", system-ui/);
    expect(v['--pp-hw']).toBe('600');
    expect(v['--pp-scale']).toBe('1.1');
    expect(v['--pp-lh']).toBe('1.7');
  });
});

describe('Google Fonts, embedded', () => {
  const css = `/* cyrillic */
@font-face { font-family: 'Inter'; font-style: normal; font-weight: 400; src: url(https://fonts.gstatic.com/s/inter/cyr.woff2) format('woff2'); unicode-range: U+0400-045F; }
/* latin-ext */
@font-face { font-family: 'Inter'; font-style: normal; font-weight: 400; src: url(https://fonts.gstatic.com/s/inter/ext.woff2) format('woff2'); unicode-range: U+0100-02BA; }
/* latin */
@font-face { font-family: 'Inter'; font-style: normal; font-weight: 400; src: url(https://fonts.gstatic.com/s/inter/latin.woff2) format('woff2'); unicode-range: U+0000-00FF, U+0131; }
/* latin-ext */
@font-face { font-family: 'Inter'; font-style: normal; font-weight: 700; src: url(https://fonts.gstatic.com/s/inter/ext.woff2) format('woff2'); unicode-range: U+0100-02BA; }
/* latin */
@font-face { font-family: 'Inter'; font-style: normal; font-weight: 700; src: url(https://fonts.gstatic.com/s/inter/latin.woff2) format('woff2'); unicode-range: U+0000-00FF, U+0131; }`;

  it('keeps the Latin subsets and merges a variable font’s weights into one face per file', () => {
    const faces = parseGoogleCss(css);
    expect(faces.map(f => f.subset)).toEqual(['latin-ext', 'latin', 'latin-ext', 'latin']);
    const merged = mergeFaces(faces);
    expect(merged).toHaveLength(2);
    expect(merged.every(f => f.weight === '400 700')).toBe(true);
  });

  it('fetches the stylesheet and each file once, and embeds them as data URLs', async () => {
    const calls: string[] = [];
    const fetchMock = vi.fn(async (url: string) => {
      calls.push(url);
      if (url.startsWith('https://fonts.googleapis.com/')) return { ok: true, status: 200, text: async () => css, arrayBuffer: async () => new ArrayBuffer(0), headers: new Headers() };
      const bytes = new TextEncoder().encode(`font:${url}`);
      return { ok: true, status: 200, text: async () => '', arrayBuffer: async () => bytes.buffer, headers: new Headers({ 'content-type': 'font/woff2' }) };
    });
    const faces = await fetchFontFaces('Inter', [400, 700], fetchMock);
    expect(calls[0]).toBe(fontsCssUrl('Inter', [400, 700]));
    expect(calls[0]).toBe('https://fonts.googleapis.com/css2?family=Inter:wght@400;700&display=swap');
    // Two files (latin, latin-ext), each downloaded once; cyrillic never.
    expect(calls.filter(u => u.includes('gstatic'))).toHaveLength(2);
    expect(calls.some(u => u.includes('cyr'))).toBe(false);
    expect(faces).toHaveLength(2);
    for (const f of faces) {
      expect(f.src).toMatch(/^data:font\/woff2;base64,/);
      expect(f.weight).toBe('400 700');
    }
    expect(atob(faces.find(f => f.unicodeRange?.startsWith('U+0000'))!.src.split(',')[1])).toBe('font:https://fonts.gstatic.com/s/inter/latin.woff2');
  });

  it('falls back to the regular face when Google refuses the weights, and throws when it has nothing', async () => {
    const urls: string[] = [];
    const fetchMock = async (url: string) => {
      urls.push(url);
      if (url.includes('wght@')) return { ok: false, status: 400, text: async () => '', arrayBuffer: async () => new ArrayBuffer(0), headers: new Headers() };
      if (url.includes('googleapis')) return { ok: true, status: 200, text: async () => css.replace(/font-weight: 700/g, 'font-weight: 400'), arrayBuffer: async () => new ArrayBuffer(0), headers: new Headers() };
      return { ok: true, status: 200, text: async () => '', arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer, headers: new Headers() };
    };
    const faces = await fetchFontFaces('Inter', [300, 900], fetchMock);
    expect(urls[1]).toBe('https://fonts.googleapis.com/css2?family=Inter&display=swap');
    expect(faces.every(f => f.weight === '400')).toBe(true);
    await expect(fetchFontFaces('Inter', [400], async () => ({ ok: false, status: 503, text: async () => '', arrayBuffer: async () => new ArrayBuffer(0), headers: new Headers() }))).rejects.toThrow(/503/);
  });

  it('writes each face once', () => {
    const faces = [face('400 700', 'U+0000-00FF'), face('400 700', 'U+0000-00FF'), face('400 700', 'U+0100-02BA')];
    const out = fontFaceCss(faces);
    expect(out.match(/@font-face/g)).toHaveLength(2);
    expect(out).toContain('font-weight:400 700');
    expect(out).toContain('format("woff2")');
  });
});

describe('the exported page', () => {
  const p = styled();

  it('carries each picture and each font face once, with the effects', () => {
    for (const layout of ['slides', 'scroll'] as const) {
      const html = buildPresentationHtml(p, renderMarkdown, { layout, math: 'mathml' });
      // The picture is on two steps and blurred over itself: still in the page once.
      expect(html.split(JPEG).length - 1).toBe(1);
      expect(html.match(/@font-face/g)).toHaveLength(2);
      expect(html.split(WOFF2).length - 1).toBe(2);
      expect(html).toContain(`filter:blur(${blurPx(0.5)}px)`);
      expect(html).toContain('mask-image:linear-gradient(90deg');
      expect(html).toContain('radial-gradient(ellipse');
      expect(html).toContain('--pp-font-heading:"Fraunces"');
      // Light text over the picture, dark over the paper gradient.
      expect(html).toContain(`--pp-heading:${LIGHT_TEXT.heading}`);
      expect(html).toContain(`--pp-heading:${DARK_TEXT.heading}`);
      expect((html.match(/<section class="pp-step[ "]/g) ?? []).length).toBe(p.steps.length);
      expect((html.match(/class="pp-bg"/g) ?? []).length).toBe(3);
    }
  });

  it('adds nothing to a page without styling', () => {
    const html = buildPresentationHtml(emptyPresentation('Plain', 0), renderMarkdown, { layout: 'slides', math: 'mathml' });
    expect(html).not.toContain('@font-face');
    expect(html).not.toContain('class="pp-bg"');
  });

  it('weighs what it embeds', () => {
    const b = styleBytes(p);
    expect(b.images).toBe(JPEG.length);
    expect(b.fonts).toBe(WOFF2.length * 2);
    expect(b.total).toBe(b.images + b.fonts);
  });
});
