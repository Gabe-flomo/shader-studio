/** Folding the Agent Builder's cards to one line (agentBuilder/cardFolds.ts). */
import { beforeEach, describe, expect, it } from 'vitest';
import { cardFoldKey, cardIsOpen, foldedLine, useCardFolds } from '../cardFolds';

describe('card folds', () => {
  beforeEach(() => useCardFolds.setState({ open: {} }));

  it('a section starts with its first card open and the rest folded; none open when its settings card is the primary', () => {
    expect([0, 1, 2].map(i => cardIsOpen(undefined, i))).toEqual([true, false, false]);
    expect([0, 1].map(i => cardIsOpen(undefined, i, false))).toEqual([false, false]);
  });

  it('what was chosen wins over the start, per section and card', () => {
    expect(cardIsOpen(false, 0)).toBe(false);
    expect(cardIsOpen(true, 3)).toBe(true);
    expect(cardFoldKey('forces', 'gravity#0')).toBe('forces:gravity#0');
    expect(cardFoldKey('forces', 'gravity#0')).not.toBe(cardFoldKey('life', 'gravity#0'));
  });

  it('the store remembers opens and folds, one or many at once', () => {
    const { set } = useCardFolds.getState();
    set('forces:drag#0', true);
    set(['forces:gravity#0', 'forces:curl#0'], false);
    expect(useCardFolds.getState().open).toEqual({ 'forces:drag#0': true, 'forces:gravity#0': false, 'forces:curl#0': false });
  });

  it('the folded line is the name and what it does with its numbers', () => {
    expect(foldedLine('Gravity', '0.4 down')).toBe('Gravity · 0.4 down');
    expect(foldedLine('Drag', '2 /s', false)).toBe('Drag · 2 /s · muted');
    expect(foldedLine('Bounce', undefined)).toBe('Bounce');
  });
});
