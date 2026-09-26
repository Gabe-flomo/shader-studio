import { describe, expect, it } from 'vitest';
import { bracketAtCaret, lineCol, scanBrackets } from '../brackets';

describe('bracket matching', () => {
  it('pairs brackets, skips comments, and lists the unmatched ones', () => {
    const t = 'float f(vec2 p) { return sin(p.x) * (1.0 + p.y; }'; // the `(1.0` never closes
    const s = scanBrackets(t);
    expect(s.pairs.get(7)).toBe(14); // f( … )
    expect(s.pairs.get(14)).toBe(7);
    expect(s.pairs.get(t.indexOf('{'))).toBe(t.length - 1);
    expect(s.unmatched).toEqual([t.indexOf('(1.0')]);
    const c = scanBrackets('a( // )\n)'); // the ) in the comment does not count
    expect(c.unmatched).toEqual([]);
    expect(c.pairs.get(1)).toBe(8);
    const b = scanBrackets('/* ( */ x)');
    expect(b.unmatched).toEqual([9]);
  });

  it('a wrong-kind close marks the openers above the right one', () => {
    const s = scanBrackets('f([1, 2) + 3]');
    // `(` closes at `)`; the `[` inside it is unclosed; the trailing `]` has no partner.
    expect(s.pairs.get(1)).toBe(7);
    expect(s.unmatched).toEqual([2, 12]);
  });

  it('finds the bracket at the caret, before it first, and maps an index to line and column', () => {
    expect(bracketAtCaret('a(b)', 2)).toBe(1); // caret right after `(`
    expect(bracketAtCaret('a(b)', 1)).toBe(1); // caret before `(`
    expect(bracketAtCaret('a(b)', 3)).toBe(3);
    expect(bracketAtCaret('ab', 1)).toBe(-1);
    expect(lineCol('ab\ncd\nef', 7)).toEqual({ line: 2, col: 1 });
    expect(lineCol('ab', 0)).toEqual({ line: 0, col: 0 });
  });
});
