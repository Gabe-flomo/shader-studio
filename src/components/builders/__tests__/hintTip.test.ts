/** Where a builder hint's tooltip goes (BuilderHelp.tsx hintTipPlace): right of the "?", left near the window's edge, always inside. */
import { describe, expect, it } from 'vitest';
import { hintTipPlace } from '../BuilderHelp';

const view = { w: 1000, h: 700 };
const mark = (x: number, y: number) => ({ left: x, right: x + 14, top: y });

describe('hint tooltip placement', () => {
  it('opens to the right of the "?" when there is room', () => {
    expect(hintTipPlace(mark(100, 200), view)).toEqual({ left: 120, top: 196 });
  });

  it('opens to the left near the right edge, as in the agent rule editor', () => {
    const at = hintTipPlace(mark(900, 200), view);
    expect(at.left + 240).toBeLessThanOrEqual(900);
    expect(at.left).toBe(900 - 6 - 240);
  });

  it('stays inside the window at the top, the bottom and the left', () => {
    expect(hintTipPlace(mark(100, 0), view).top).toBe(8);
    expect(hintTipPlace(mark(100, 690), view, { w: 240, h: 120 }).top).toBe(700 - 8 - 120);
    expect(hintTipPlace(mark(20, 200), { w: 200, h: 700 }).left).toBe(8);
  });
});
