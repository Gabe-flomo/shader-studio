/**
 * keyboardClaim.ts — who owns the computer keyboard right now.
 *
 * When an Audio engine rack takes the keyboard (lib/rackKeyboard.ts), every
 * plain key is a piano key: the app's shortcuts (hooks/useShortcuts.ts), the
 * Play page's key mappings and drum pad keys (lib/playEngine.ts,
 * play/drumPads.ts), the time hotkeys and the MIDI stand-in all ask
 * `keyboardClaimed(e)` first and stand aside. Keys with ⌘, ⌃ or ⌥ are never
 * claimed (Save, Undo and the like keep working), and neither is typing in a
 * text field. No React, no dependencies: anything can ask.
 */

let owner = '';
const listeners = new Set<(owner: string) => void>();

/** Take the keyboard for `who` (a rack id). Replaces any other owner. */
export function claimKeyboard(who: string): void {
  if (!who || owner === who) return;
  owner = who;
  for (const l of listeners) l(owner);
}

/** Let go, if `who` still holds it. */
export function releaseKeyboardClaim(who: string): void {
  if (!who || owner !== who) return;
  owner = '';
  for (const l of listeners) l(owner);
}

/** Who holds the keyboard ('' for nobody). */
export function keyboardOwner(): string {
  return owner;
}

/**
 * Should a plain-key handler ignore this key press? True while someone holds
 * the keyboard and the key has no ⌘/⌃/⌥ (those combos stay the app's) and
 * isn't typed into a field. Without an event: is the keyboard claimed at all.
 */
export function keyboardClaimed(e?: { metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean; target?: EventTarget | null } | null): boolean {
  if (!owner) return false;
  if (!e) return true;
  if (e.metaKey || e.ctrlKey || e.altKey) return false;
  return !isTypingTarget(e.target);
}

export function onKeyboardClaim(l: (owner: string) => void): () => void {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

/** A text field, select or editor: keys typed there are never a shortcut or a piano key. */
export function isTypingTarget(el: EventTarget | null | undefined): boolean {
  const node = el as HTMLElement | null | undefined;
  const tag = node?.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !!node?.isContentEditable;
}
