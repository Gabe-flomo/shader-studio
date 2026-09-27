/** A long press on a touch screen gets no browser menu, except on text people might copy. */
import { describe, expect, it } from 'vitest';
import { blocksTouchMenu } from '../touchGuards';

const el = (inText: boolean) => ({ closest: () => (inText ? {} : null) }) as unknown as Element;

describe('touch guards', () => {
  it('cancels the browser menu for a long press on the canvas, a card or a button', () => {
    expect(blocksTouchMenu(el(false), 'touch', true)).toBe(true);
    expect(blocksTouchMenu(el(false), undefined, true)).toBe(true);
  });
  it('leaves text, fields and code alone', () => {
    expect(blocksTouchMenu(el(true), 'touch', true)).toBe(false);
  });
  it('leaves the mouse alone', () => {
    expect(blocksTouchMenu(el(false), 'mouse', true)).toBe(false);
    expect(blocksTouchMenu(el(false), undefined, false)).toBe(false);
  });
});
