/**
 * Links in notes and comments: only http(s) addresses ever become links, Markdown
 * [words](url) and bare addresses both work, and the insert-link helper wraps the selection.
 */
import { describe, expect, it } from 'vitest';
import { insertLink, normaliseTypedUrl, parseLinks, safeHttpUrl } from '../links';

describe('safeHttpUrl', () => {
  it('keeps http and https addresses', () => {
    expect(safeHttpUrl('https://thebookofshaders.com/09/')).toBe('https://thebookofshaders.com/09/');
    expect(safeHttpUrl('http://example.com')).toBe('http://example.com/');
    expect(safeHttpUrl('  https://example.com/a?b=1#c  ')).toBe('https://example.com/a?b=1#c');
  });

  it('refuses every other scheme and anything odd', () => {
    for (const bad of [
      'javascript:alert(1)', 'JavaScript:alert(1)', ' javascript:alert(1)', 'data:text/html,<b>x</b>', 'file:///etc/passwd',
      'vbscript:x', 'ftp://example.com', '//example.com', 'example.com', 'https://', 'https://exa mple.com',
      'https://example.com/"onmouseover="x', 'https://example.com/<script>', 'https://user:pw@example.com/',
      'java\nscript:alert(1)', 'https://example.com/\u0000', '', undefined, 42,
    ]) expect(safeHttpUrl(bad), String(bad)).toBeNull();
    expect(safeHttpUrl(`https://example.com/${'a'.repeat(2100)}`)).toBeNull();
  });

  it('adds https:// to a typed address, and refuses other schemes', () => {
    expect(normaliseTypedUrl('example.com/page')).toBe('https://example.com/page');
    expect(normaliseTypedUrl('http://example.com')).toBe('http://example.com/');
    expect(normaliseTypedUrl('javascript:alert(1)')).toBeNull();
    expect(normaliseTypedUrl('mailto:a@b.c')).toBeNull();
    expect(normaliseTypedUrl('  ')).toBeNull();
  });
});

describe('parseLinks', () => {
  it('finds Markdown links and bare addresses', () => {
    expect(parseLinks('Read [chapter 9](https://thebookofshaders.com/09/) first.')).toEqual([
      { text: 'Read ' },
      { text: 'chapter 9', url: 'https://thebookofshaders.com/09/' },
      { text: ' first.' },
    ]);
    expect(parseLinks('See https://example.com/a, then http://x.org.')).toEqual([
      { text: 'See ' },
      { text: 'example.com/a', url: 'https://example.com/a' },
      { text: ', then ' },
      { text: 'x.org', url: 'http://x.org/' },
      { text: '.' },
    ]);
  });

  it('leaves unsafe Markdown links as their text', () => {
    expect(parseLinks('[click](javascript:alert(1)) now')).toEqual([{ text: '[click](javascript:alert(1)) now' }]);
    expect(parseLinks('[x](data:text/html,hi)')).toEqual([{ text: '[x](data:text/html,hi)' }]);
    expect(parseLinks('javascript:alert(1)').every(s => !s.url)).toBe(true);
  });

  it('leaves plain text and note chips alone', () => {
    expect(parseLinks('no links here')).toEqual([{ text: 'no links here' }]);
    expect(parseLinks('Drag [[layer:a1]] and [[control:c2]]')).toEqual([{ text: 'Drag [[layer:a1]] and [[control:c2]]' }]);
    expect(parseLinks('')).toEqual([]);
  });

  it('keeps an address in brackets out of the brackets', () => {
    expect(parseLinks('(https://example.com)')).toEqual([{ text: '(' }, { text: 'example.com', url: 'https://example.com/' }, { text: ')' }]);
  });
});

describe('insertLink', () => {
  it('wraps the selected words and selects them', () => {
    const r = insertLink('Read the book now', 5, 13, 'https://thebookofshaders.com/');
    expect(r.value).toBe('Read [the book](https://thebookofshaders.com/) now');
    expect(r.value.slice(r.start, r.end)).toBe('the book');
  });

  it('inserts the address itself with nothing selected', () => {
    const r = insertLink('See ', 4, 4, 'https://example.com/');
    expect(r.value).toBe('See https://example.com/');
    expect(r.start).toBe(r.value.length);
  });

  it('drops brackets from the words so the link stays whole', () => {
    expect(insertLink('a [b] c', 0, 7, 'https://x.org/').value).toBe('[a b c](https://x.org/)');
  });
});
