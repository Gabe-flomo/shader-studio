/**
 * The credit an example carries: parsed from files, written as one line for
 * lists and in full for the Notes card and Present, and drawn by the three
 * credit components.
 */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} });
});
import { renderToStaticMarkup } from 'react-dom/server';
import { CreditCaption, CreditLink, CreditTag } from '../Credit';
import { creditPlace, creditShort, creditSentence, parseSourceCredit } from '../../../types/credit';
import { parsePlayRecord } from '../../../types/play';
import { bookSource } from '../../../store/learnExampleIndex';
import { EXAMPLE_INDEX } from '../../../store/exampleIndex';

const step = bookSource(5, 'Step and Smoothstep');

describe('source credits', () => {
  it('reads as one line for lists and in full for tooltips', () => {
    expect(creditShort(step)).toBe('The Book of Shaders · Ch. 5 · Step and Smoothstep');
    expect(creditShort(step, true)).toBe('Ch. 5 · Step and Smoothstep');
    expect(creditShort(bookSource(13))).toBe('The Book of Shaders · Ch. 13 · Fractal Brownian Motion');
    expect(creditPlace(step)).toEqual(['Ch. 5 · Shaping functions', 'Step and Smoothstep']);
    expect(creditSentence(step)).toBe('From The Book of Shaders by Patricio Gonzalez Vivo and Jen Lowe, chapter 5, Shaping functions, section “Step and Smoothstep”');
    const article = EXAMPLE_INDEX.crtTv.source!;
    expect(creditShort(article)).toBe('GM Shaders Mini: CRT');
    expect(creditShort(article, true)).toBe('GM Shaders Mini: CRT');
    expect(creditSentence(article)).toBe('From GM Shaders Mini: CRT by Xor');
  });

  it('only takes https addresses from a file, and travels in a Play record', () => {
    expect(parseSourceCredit({ title: 'x', url: 'javascript:alert(1)' })).toBeUndefined();
    expect(parseSourceCredit({ title: 'x', url: 'http://example.com' })).toBeUndefined();
    expect(parseSourceCredit({ url: 'https://example.com' })).toBeUndefined();
    expect(parseSourceCredit({ title: ' x ', url: 'https://example.com/a', chapter: 2.5, section: '' })).toEqual({ title: 'x', url: 'https://example.com/a' });
    expect(parsePlayRecord({ version: 1, controls: [], mappings: [], layers: [], source: step }).source).toEqual(step);
    expect(parsePlayRecord({ version: 1, controls: [], mappings: [], layers: [] }).source).toBeUndefined();
  });

  it('credits the articles the other examples follow', () => {
    for (const k of ['crtTv', 'comboTurbulenceGlow', 'comboBloomDots', 'comboChaosStars']) {
      expect(EXAMPLE_INDEX[k].source, k).toMatchObject({ author: 'Xor' });
      expect(EXAMPLE_INDEX[k].source!.url, k).toMatch(/^https:\/\/mini\.gmshaders\.com\/p\//);
    }
  });
});

describe('credit components', () => {
  it('the list tag shows the short line', () => {
    const html = renderToStaticMarkup(<CreditTag source={step} />);
    expect(html).toContain('The Book of Shaders · Ch. 5 · Step and Smoothstep');
    expect(html).toContain('data-credit');
    expect(html).not.toContain('<a');
  });

  it('the Notes card link opens the chapter in a new tab', () => {
    const html = renderToStaticMarkup(<CreditLink source={step} />);
    expect(html).toContain('href="https://thebookofshaders.com/05/"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('Patricio Gonzalez Vivo and Jen Lowe');
    expect(html).toContain('Ch. 5 · Shaping functions · Step and Smoothstep');
  });

  it('the Present caption links the title', () => {
    const html = renderToStaticMarkup(<CreditCaption source={step} />);
    expect(html).toMatch(/<a href="https:\/\/thebookofshaders\.com\/05\/"[^>]*>The Book of Shaders<\/a>/);
    expect(html).toContain('Step and Smoothstep');
  });
});
