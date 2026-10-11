/**
 * removable.ts — one rule for anything a builder lets you add (a card, a rule, a layer, an effect…): it has a visible
 * remove control at the end of its header, and Delete / Backspace removes it while the card itself has focus (click
 * its header, or Tab to it). A key typed in one of its fields is the field's, never a remove.
 */
import type { KeyboardEvent } from 'react';

/** Props for the removable card's outer element: focusable, and Delete / Backspace on it removes it. */
export function removeKeys(onRemove: (() => void) | undefined, label = 'this'): { tabIndex?: number; onKeyDown?: (e: KeyboardEvent<HTMLElement>) => void; 'data-removable'?: string } {
  if (!onRemove) return {};
  return {
    tabIndex: -1,
    'data-removable': label,
    onKeyDown: e => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      if (isTyping(e.target)) return;
      e.preventDefault();
      e.stopPropagation();
      onRemove();
    },
  };
}

/** A key going to a text field, a select or an editable region (its own Backspace), not to the card. */
function isTyping(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el || typeof el.closest !== 'function') return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') return true;
  // A slider or a picker being worked keeps its keys: only the card (or a plain button on it) removes.
  return !!el.closest('[role="slider"], [role="combobox"], [role="listbox"]');
}
