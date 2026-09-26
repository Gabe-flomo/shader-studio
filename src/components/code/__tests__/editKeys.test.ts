import { describe, expect, it } from 'vitest';
import { tokenRangeAt, wrapSelection } from '../editKeys';

const tok = (text: string, at: number) => { const r = tokenRangeAt(text, at); return r ? text.slice(r[0], r[1]) : null; };

describe('editKeys', () => {
  it('selects the whole token under the caret: names with digits, numbers with dots and exponents', () => {
    expect(tok('p += 0.005*normalize(v)', 8)).toBe('0.005');
    expect(tok('p += 0.005*normalize(v)', 5)).toBe('0.005');
    expect(tok('x = p3.yzx + 1e-3;', 5)).toBe('p3');
    expect(tok('x = p3.yzx + 1e-3;', 8)).toBe('yzx');
    expect(tok('x = p3.yzx + 1e-3;', 14)).toBe('1e-3');
    expect(tok('sin(iTime)', 6)).toBe('iTime');
    expect(tok('a + b', 2)).toBeNull();
  });

  it('wraps a selection in the typed bracket and keeps the inside selected', () => {
    expect(wrapSelection('(', 'x * y', 0, 1)).toEqual({ text: '(x) * y', start: 1, end: 2 });
    expect(wrapSelection('[', 'abc', 1, 2)).toEqual({ text: 'a[b]c', start: 2, end: 3 });
    expect(wrapSelection('(', 'abc', 1, 1)).toBeNull();
    expect(wrapSelection('a', 'abc', 0, 2)).toBeNull();
  });
});

describe('double-click', () => {
  it('selects the token, and the same token double-clicked again selects everything', async () => {
    const { selectTokenOnDoubleClick } = await import('../editKeys');
    const field = { value: 'a = sin(x) * 0.5;', selectionStart: 5, selectionEnd: 5, setSelectionRange(a: number, b: number) { this.selectionStart = a; this.selectionEnd = b; } };
    const ev = { currentTarget: field as unknown as HTMLInputElement, preventDefault() {} };
    selectTokenOnDoubleClick(ev);
    expect([field.selectionStart, field.selectionEnd]).toEqual([4, 7]); // sin
    field.selectionStart = 5; field.selectionEnd = 5; // the browser's own word selection happens first; we read the caret
    selectTokenOnDoubleClick(ev);
    expect([field.selectionStart, field.selectionEnd]).toEqual([0, field.value.length]);
    // A third double-click starts over with the token
    field.selectionStart = 5; field.selectionEnd = 5;
    selectTokenOnDoubleClick(ev);
    expect([field.selectionStart, field.selectionEnd]).toEqual([4, 7]);
  });
});
