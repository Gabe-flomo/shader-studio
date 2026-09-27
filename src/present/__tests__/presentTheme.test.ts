/**
 * Present themes: a theme and its settings as the page's CSS variables,
 * changes and resets, old presentations staying Classic (exactly as before),
 * saved themes, pasted Google Fonts links, and the exported page carrying the
 * theme's look and the fonts.
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
import { emptyPresentation, newBlock, newStep, parsePresentation, type Presentation } from '../../types/presentation';
import { parseStyle, typeVars, type EmbeddedFontFace } from '../../types/presentationStyle';
import {
  isPlainClassic, parseTheme, resetTheme, themeAttrs, themeExportCss, themeIsDark, themeLook, THEMES, THEME_IDS, type PresentTheme,
} from '../../types/presentTheme';
import { buildPresentationHtml, styleSheet } from '../exportPresentation';
import { linkWeights, parseFontLink } from '../googleFonts';
import { renderMarkdown } from '../markdown';
import { deleteUserTheme, listUserThemes, parseUserThemes, saveUserTheme } from '../userThemes';

describe('themes as CSS variables', () => {
  it('Classic unchanged sets nothing: the page is as it always was', () => {
    expect(themeLook(undefined, false).vars).toEqual({});
    expect(themeLook({ id: 'classic' }, true).vars).toEqual({});
    expect(themeAttrs(themeLook(undefined, false))).toEqual({});
  });

  it('each built-in sets its palette, fonts, sizes and shapes', () => {
    const landing = themeLook({ id: 'landing' }, false).vars;
    expect(landing['--pp-page']).toBe('#f6f5f2');
    expect(landing['--pp-heading']).toBe('#1b1c22');
    expect(landing['--pp-btn-radius']).toBe('999px');
    expect(landing['--pp-track']).toBe('-0.035em');
    expect(landing['--pp-title']).toBe('1.5');
    expect(landing['--pp-font-heading']).toContain('-apple-system');
    const article = themeLook({ id: 'article' }, false).vars;
    expect(article['--pp-font-heading']).toContain('Georgia');
    expect(article['--pp-font-body']).toContain('Georgia');
    expect(article['--pp-col']).toBe('680px');
    expect(article['--pp-lh']).toBe('1.7');
    // Portfolio is dark unless asked otherwise.
    expect(themeLook({ id: 'portfolio' }, false).vars['--pp-page']).toBe('#0f0f12');
    expect(themeLook({ id: 'portfolio', mode: 'light' }, true).vars['--pp-page']).toBe('#f3f3f5');
    for (const id of THEME_IDS.filter(x => x !== 'classic')) {
      const v = themeLook({ id }, false).vars;
      for (const k of ['--pp-page', '--pp-surface', '--pp-body', '--pp-muted', '--pp-accent', '--pp-link', '--pp-code-bg', '--pp-radius', '--pp-col', '--pp-space', '--pp-scale', '--pp-lh']) expect(v[k], `${id} ${k}`).toBeTruthy();
    }
  });

  it('keys layouts on attributes: the step number as a pill or a byline, pictures on tiles', () => {
    expect(themeAttrs(themeLook({ id: 'landing' }, false))).toEqual({ 'data-pp-num': 'pill' });
    expect(themeAttrs(themeLook({ id: 'article' }, false))).toEqual({ 'data-pp-num': 'meta' });
    expect(themeAttrs(themeLook({ id: 'portfolio' }, false))).toEqual({ 'data-pp-tiles': '' });
  });

  it("'auto' follows the app; light and dark are pinned", () => {
    expect(themeIsDark({ id: 'landing', mode: 'auto' }, true)).toBe(true);
    expect(themeIsDark({ id: 'landing', mode: 'auto' }, false)).toBe(false);
    expect(themeIsDark({ id: 'landing' }, true)).toBe(false);
    expect(themeIsDark(undefined, true)).toBe(true);
    expect(themeLook({ id: 'landing', mode: 'dark' }, false).vars['--pp-page']).toBe(THEMES.landing.dark.background);
  });
});

describe('settings changed by hand, and back', () => {
  it('colours win, and what follows from them follows', () => {
    const t: PresentTheme = { id: 'landing', colours: { text: [1, 0, 0], accent: [0, 0, 0.5], background: [0.1, 0.1, 0.1], link: [0, 1, 0], surface: [0.2, 0.2, 0.2] } };
    const v = themeLook(t, false).vars;
    expect(v['--pp-body']).toBe('#ff0000');
    expect(v['--pp-heading']).toBe('#ff0000');
    expect(v['--pp-muted']).not.toBe('#ff0000');
    expect(v['--pp-accent']).toBe('#000080');
    expect(v['--pp-btn']).toBe('#000080');
    expect(v['--pp-on-btn']).toBe('#ffffff');
    expect(v['--pp-page']).toBe('#1a1a1a');
    expect(v['--pp-link']).toBe('#00ff00');
    expect(v['--pp-surface']).toBe('#333333');
  });

  it('corners, column and spacing change; the ranges hold', () => {
    const v = themeLook({ id: 'article', radius: 4, column: 900, spacing: 1.5 }, false).vars;
    expect(v['--pp-radius']).toBe('4px');
    expect(v['--pp-col']).toBe('900px');
    expect(v['--pp-space']).toBe('1.5');
    expect(parseTheme({ id: 'article', radius: 400, column: 10, spacing: 9 })).toEqual({ id: 'article', radius: 28, column: 560, spacing: 1.8 });
  });

  it('Classic sets only what was changed', () => {
    const v = themeLook({ id: 'classic', colours: { background: [1, 1, 1] }, radius: 0 }, false).vars;
    expect(Object.keys(v).sort()).toEqual(['--pp-page', '--pp-radius', '--pp-rule', '--pp-wash']);
    expect(themeLook({ id: 'classic', colours: { background: [1, 1, 1] } }, false).grain).toBe(false);
    expect(themeLook(undefined, false).grain).toBe(true);
  });

  it('resets one setting, or all of them', () => {
    const t: PresentTheme = { id: 'portfolio', mode: 'light', colours: { accent: [1, 0, 0], link: [0, 1, 0] }, radius: 3, column: 700, spacing: 1.2, saved: { id: 'x', name: 'Mine' } };
    expect(resetTheme(t, ['accent'])).toEqual({ ...t, colours: { link: [0, 1, 0] } });
    expect(resetTheme(t, ['accent', 'link', 'radius', 'mode']).colours).toBeUndefined();
    expect(resetTheme(t, ['radius']).radius).toBeUndefined();
    expect(resetTheme(t)).toEqual({ id: 'portfolio' });
    expect(themeLook(resetTheme(t, ['radius']), false).vars['--pp-radius']).toBe(`${THEMES.portfolio.radius}px`);
  });
});

describe('old presentations', () => {
  it('without a theme are Classic, and Classic unchanged stays out of the file', () => {
    const old = { title: 'Old', steps: [{ id: 's1', title: 'One', blocks: [], columns: 1 }], sources: [], style: { typography: { scale: 1.1 } } };
    const p = parsePresentation(old);
    expect(p).not.toBeNull();
    expect(p!.style?.theme).toBeUndefined();
    expect(themeLook(p!.style?.theme, false).id).toBe('classic');
    expect(parseTheme({ id: 'classic' })).toBeUndefined();
    expect(isPlainClassic(undefined)).toBe(true);
  });

  it('keeps a theme through the gate, and drops junk', () => {
    expect(parseStyle({ theme: { id: 'article', mode: 'dark', colours: { accent: [2, 0.5, -1], nope: [1, 1, 1] } } }, new Set())?.theme)
      .toEqual({ id: 'article', mode: 'dark', colours: { accent: [1, 0.5, 0] } });
    expect(parseTheme({ id: 'hacker' })).toBeUndefined();
    expect(parseTheme('landing')).toBeUndefined();
    expect(parseTheme({ id: 'landing', mode: 'sepia', radius: 'big' })).toEqual({ id: 'landing' });
  });

  it('keeps a text size of 100 % (under a theme with its own size it means something)', () => {
    const p = parsePresentation({ title: 'T', steps: [{ id: 's1', blocks: [], columns: 1 }], sources: [], style: { theme: { id: 'landing' }, typography: { scale: 1 } } });
    expect(p!.style?.typography?.scale).toBe(1);
    expect(typeVars(p!.style?.typography)['--pp-scale']).toBe('1');
  });
});

describe('your saved themes', () => {
  it('saves, lists, deletes and puts back', () => {
    const u = saveUserTheme('  Night   notes ', { id: 'article', mode: 'dark', saved: { id: 'old', name: 'Old' } }, { heading: { family: 'Fraunces', category: 'serif', weight: 600 } });
    expect(u.name).toBe('Night notes');
    expect(u.theme).toEqual({ id: 'article', mode: 'dark' });
    expect(listUserThemes().map(t => t.id)).toContain(u.id);
    const undo = deleteUserTheme(u.id);
    expect(listUserThemes().map(t => t.id)).not.toContain(u.id);
    undo?.();
    expect(listUserThemes().find(t => t.id === u.id)?.typography?.heading?.family).toBe('Fraunces');
  });

  it('leaves junk out when reading them', () => {
    expect(parseUserThemes([{ id: 'a', name: 'A', theme: { id: 'nope' } }, null, { id: 'b', name: 'B', theme: { id: 'classic' } }, { id: 'b', name: 'dup', theme: { id: 'landing' } }]).map(t => t.id)).toEqual(['b']);
    expect(parseUserThemes('nope')).toEqual([]);
  });
});

describe('Google Fonts by link', () => {
  it('reads specimen pages, css2 links, <link> tags and names', () => {
    expect(parseFontLink('https://fonts.google.com/specimen/Space+Grotesk')).toEqual({ family: 'Space Grotesk', category: 'sans', weights: [] });
    expect(parseFontLink('https://fonts.google.com/specimen/Bricolage+Grotesque?query=bri')?.family).toBe('Bricolage Grotesque');
    expect(parseFontLink('https://fonts.googleapis.com/css2?family=Fraunces:wght@300..700&display=swap')).toEqual({ family: 'Fraunces', category: 'serif', weights: [300, 400, 500, 600, 700] });
    expect(parseFontLink('<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&amp;display=swap" rel="stylesheet">')).toEqual({ family: 'Bebas Neue', category: 'display', weights: [] });
    expect(parseFontLink('@import url(\'https://fonts.googleapis.com/css2?family=Roboto+Mono:wght@400;700\');')?.weights).toEqual([400, 700]);
    expect(parseFontLink('Playfair Display')?.category).toBe('serif');
    // Outside the list: the name as given (capitalised), its kind guessed from it.
    expect(parseFontLink('bodoni moda')).toEqual({ family: 'Bodoni Moda', category: 'sans', weights: [] });
    expect(parseFontLink('https://fonts.google.com/specimen/Noto+Serif+Display')?.category).toBe('serif');
    expect(parseFontLink('https://fonts.googleapis.com/css2?family=Azeret+Mono:ital,wght@0,300;1,700')).toEqual({ family: 'Azeret Mono', category: 'mono', weights: [300, 700] });
  });

  it('refuses what isn’t a Google family', () => {
    for (const junk of ['', '   ', 'https://example.com/font.css', 'https://cdn.example.com/My-Font.woff2', 'javascript:alert(1)', 'Comic <b>Sans</b>', 'https://fonts.googleapis.com/css2?display=swap', 'x'.repeat(80), 'Font; drop']) {
      expect(parseFontLink(junk), junk).toBeNull();
    }
  });

  it('reads the weights a css2 link asks for', () => {
    expect(linkWeights('https://fonts.googleapis.com/css2?family=Inter:wght@100..900')).toEqual([100, 200, 300, 400, 500, 600, 700, 800, 900]);
    expect(linkWeights('https://fonts.googleapis.com/css2?family=Inter:wght@400;600')).toEqual([400, 600]);
    expect(linkWeights('https://fonts.googleapis.com/css2?family=Inter')).toEqual([]);
    expect(linkWeights('https://fonts.googleapis.com/css2?family=Inter:ital@1')).toEqual([]);
  });
});

describe('the exported page', () => {
  const WOFF2 = `data:font/woff2;base64,${'B'.repeat(800)}`;
  function themed(theme?: PresentTheme): Presentation {
    const p = emptyPresentation('Themed', 1);
    const text = newBlock('text');
    if (text.type === 'text') text.markdown = 'Some **bold** text and a [link](https://example.com).';
    p.steps = [{ ...newStep('First'), id: 's1', blocks: [text] }, { ...newStep('Second'), id: 's2' }];
    p.style = { typography: { heading: { family: 'Fraunces', category: 'serif', weight: 600 } }, ...(theme ? { theme } : {}) };
    p.fonts = [{ family: 'Fraunces', weight: '600', style: 'normal', src: WOFF2 } satisfies EmbeddedFontFace];
    return p;
  }

  it('Classic: no theme rules, the typography on :root as before', () => {
    const html = buildPresentationHtml(themed(), renderMarkdown, { layout: 'scroll', math: 'mathml' });
    expect(html).toContain(':root{--pp-font-heading:"Fraunces"');
    expect(html).not.toContain('body{--pp-page');
    expect(html).toContain('<body class="scroll">');
    expect(html).toContain('<span>01<i> / 02</i></span>');
  });

  it('carries the theme’s variables, its layout attributes and the fonts, the typography winning', () => {
    const html = buildPresentationHtml(themed({ id: 'article', colours: { accent: [1, 0, 0] } }), renderMarkdown, { layout: 'scroll', math: 'mathml' });
    expect(html).toContain('<body class="scroll" data-pp-num="meta">');
    expect(html).toMatch(/body\{--pp-page:#fbfaf7;[^}]*--pp-accent:#ff0000/);
    expect(html).toContain('<span>Step 1<i> of 2</i></span>');
    expect(html).toContain('@font-face{font-family:"Fraunces"');
    // Georgia is the theme's heading font; the chosen Fraunces replaces it, the body font stays the theme's.
    const rule = /body\{[^}]*\}/.exec(html.slice(html.indexOf('body{--pp-page')))![0];
    expect(rule).toContain('--pp-font-heading:"Fraunces", Georgia');
    expect(rule).not.toContain('--pp-font-heading:Georgia');
    expect(rule).toContain('--pp-font-body:Georgia');
  });

  it('a theme matching the reader’s system has a dark set; pinned ones don’t', () => {
    expect(themeExportCss({ id: 'landing', mode: 'auto' }, {}).css).toContain('@media (prefers-color-scheme:dark){body{--pp-page:#111114');
    expect(themeExportCss({ id: 'landing' }, {}).css).not.toContain('prefers-color-scheme');
    expect(themeExportCss(undefined, { '--pp-scale': '1.1' }).css).toBe('');
    // Classic following the app stays light in an export, as it always has.
    expect(themeExportCss({ id: 'classic', mode: 'auto' }, {}).css).toBe('');
  });

  it('a dark theme exports dark, with pictures on tiles', () => {
    const p = themed({ id: 'portfolio' });
    const s = styleSheet(p, 'slides');
    expect(s.dark).toBe(true);
    expect(s.attrs).toBe(' data-pp-tiles=""');
    expect(s.css).toContain('--pp-page:#0f0f12');
    expect(s.column).toBeGreaterThanOrEqual(1068);
  });
});
