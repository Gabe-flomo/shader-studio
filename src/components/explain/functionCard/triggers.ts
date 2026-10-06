/**
 * triggers.ts — how a function card opens and closes, for every place that shows code
 * (docs/expression-explainer.md, "Function cards"). One set of window listeners, installed at
 * start-up, so editors and code views only mark their elements (fnCardStore.ts).
 *
 * Opening
 *  - Editable code (`data-fn-card="edit"`: Expression Block lines, the Custom Function editor,
 *    the GLSL page): rest the pointer on a function name (desktop), ⌥-click or ⌘-click it
 *    (Ctrl-click off the Mac), or press F1 / ⌘I (Ctrl+I) with the caret on or inside a call.
 *    A plain click still just places the caret, and none of these move it.
 *  - Read-only code (`data-fn-code`: the card's Code page, the Generated code panel, the Code
 *    Explorer, the explainer's code): a plain click on a function name, a rest of the pointer,
 *    or F1 / ⌘I with text selected in it. A drag that selects text never opens it.
 *  - Touch: a long press on a function name, in either kind.
 *
 * Closing: Esc (focus goes back where it was), a click outside, or, for a card opened by
 * hovering, moving away from both the name and the card. Typing in the editor closes a peek.
 */
import { FN_CARD, closeFunctionCard, openFunctionCard, scopeOf, useFnCard, type AnchorRect, type CardMode } from './fnCardStore';
import { functionAt } from '../../../lib/glslPatterns/fnAt';

export const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

// ── Pure rules (tested) ───────────────────────────────────────────────────────

export interface KeyLike { key: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean }

/** F1, or ⌘I on the Mac / Ctrl+I elsewhere. */
export function isOpenShortcut(e: KeyLike, mac = IS_MAC): boolean {
  if (e.key === 'F1' && !e.metaKey && !e.ctrlKey && !e.altKey) return true;
  const mod = mac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
  return mod && !e.altKey && !e.shiftKey && (e.key === 'i' || e.key === 'I');
}

export interface PressLike { button: number; altKey: boolean; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean }

/** Does this press open the card? Editable code needs ⌥ or ⌘ (Ctrl off the Mac); read-only code a plain click. */
export function pressOpens(e: PressLike, editable: boolean, mac = IS_MAC): boolean {
  if (e.button !== 0 || e.shiftKey) return false;
  if (!editable) return !e.altKey && !e.metaKey && !e.ctrlKey;
  return e.altKey || (mac ? e.metaKey && !e.ctrlKey : e.ctrlKey || e.metaKey);
}

/** What lays out a monospace text field. */
export interface FieldMetrics {
  left: number; top: number;
  padL: number; padT: number;
  lineH: number; charW: number;
  scrollLeft: number; scrollTop: number;
  tabSize: number;
  /** An <input>: one line, vertically centred. */
  singleLine: boolean;
  height: number;
}

/** The character offset under a point in a field (the character the pointer is on, not a caret gap). */
export function fieldOffsetAt(text: string, m: FieldMetrics, x: number, y: number): number {
  const lines = text.split('\n');
  const li = m.singleLine ? 0 : Math.max(0, Math.min(lines.length - 1, Math.floor((y - m.top - m.padT + m.scrollTop) / m.lineH)));
  const col = (x - m.left - m.padL + m.scrollLeft) / m.charW;
  let at = 0;
  for (let i = 0; i < li; i++) at += lines[i].length + 1;
  const line = lines[li] ?? '';
  let v = 0;
  for (let i = 0; i < line.length; i++) {
    const w = line[i] === '\t' ? m.tabSize - (v % m.tabSize) : 1;
    if (col < v + w) return at + i;
    v += w;
  }
  return at + line.length;
}

/** Where characters [start, end) sit on screen in a field. */
export function fieldRect(text: string, m: FieldMetrics, start: number, end: number): AnchorRect {
  const before = text.slice(0, start);
  const li = m.singleLine ? 0 : before.split('\n').length - 1;
  const lineStart = before.lastIndexOf('\n') + 1;
  let v = 0;
  for (const ch of text.slice(lineStart, start)) v += ch === '\t' ? m.tabSize - (v % m.tabSize) : 1;
  const left = m.left + m.padL + v * m.charW - m.scrollLeft;
  if (m.singleLine) return { left, top: m.top, width: (end - start) * m.charW, height: m.height };
  return { left, top: m.top + m.padT + li * m.lineH - m.scrollTop, width: (end - start) * m.charW, height: m.lineH };
}

// ── DOM measuring ─────────────────────────────────────────────────────────────

const widthCache = new Map<string, number>();
function charWidthFor(font: string): number {
  let w = widthCache.get(font);
  if (w === undefined) {
    // (jsdom has no canvas: the fallback width)
    const ctx = typeof document !== 'undefined' && !/jsdom/.test(navigator.userAgent) ? document.createElement('canvas').getContext('2d') : null;
    if (ctx) { ctx.font = font; w = ctx.measureText('MMMMMMMMMM').width / 10; }
    w = w || 7.2;
    widthCache.set(font, w);
  }
  return w;
}

type Field = HTMLTextAreaElement | HTMLInputElement;

export function metricsOf(el: Field): FieldMetrics {
  const cs = getComputedStyle(el);
  const r = el.getBoundingClientRect();
  const fs = parseFloat(cs.fontSize) || 12;
  const lh = parseFloat(cs.lineHeight);
  const font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  return {
    left: r.left, top: r.top,
    padL: (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.borderLeftWidth) || 0),
    padT: (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.borderTopWidth) || 0),
    lineH: Number.isFinite(lh) ? lh : fs * 1.4,
    charW: charWidthFor(font),
    scrollLeft: el.scrollLeft, scrollTop: el.scrollTop,
    tabSize: parseInt(cs.tabSize, 10) || 4,
    singleLine: el instanceof HTMLInputElement,
    height: r.height,
  };
}

/** The read-only code element a node is in, and the node's text offset in it. */
function codeOffset(container: Element, node: Node, offset: number): number {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let at = 0;
  for (let t = walker.nextNode(); t; t = walker.nextNode()) {
    if (t === node) return at + offset;
    at += (t.textContent ?? '').length;
  }
  return -1;
}

/** A rectangle for text offsets [start, end) of a read-only code element. */
function codeRect(container: Element, start: number, end: number): AnchorRect | null {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let at = 0;
  const range = document.createRange();
  let set = 0;
  for (let t = walker.nextNode(); t && set < 2; t = walker.nextNode()) {
    const len = (t.textContent ?? '').length;
    if (set === 0 && start <= at + len) { range.setStart(t, start - at); set = 1; }
    if (set === 1 && end <= at + len) { range.setEnd(t, end - at); set = 2; }
    at += len;
  }
  if (set < 2) return null;
  // (jsdom has no Range rectangles: the element's own then)
  const r = typeof range.getBoundingClientRect === 'function' ? range.getBoundingClientRect() : container.getBoundingClientRect();
  return { left: r.left, top: r.top, width: r.width, height: r.height };
}

/** The text offset in a read-only code element under a pointer event. */
function pointOffset(container: Element, target: EventTarget | null, x: number, y: number): number {
  // A whole-word token (the highlighters' spans): its middle, so the word is unambiguous
  if (target instanceof Element && target !== container && container.contains(target) && target.childElementCount === 0 && /^\w+$/.test(target.textContent ?? '') && target.firstChild) {
    return codeOffset(container, target.firstChild, Math.floor((target.textContent ?? '').length / 2));
  }
  const d = document as Document & { caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null };
  if (d.caretPositionFromPoint) {
    const p = d.caretPositionFromPoint(x, y);
    if (p && container.contains(p.offsetNode)) return codeOffset(container, p.offsetNode, p.offset);
  } else if (document.caretRangeFromPoint) {
    const r = document.caretRangeFromPoint(x, y);
    if (r && container.contains(r.startContainer)) return codeOffset(container, r.startContainer, r.startOffset);
  }
  return -1;
}

// ── Opening ───────────────────────────────────────────────────────────────────

const isField = (el: unknown): el is Field => (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) && el.dataset.fnCard === 'edit';
const codeEl = (el: unknown): Element | null => (el instanceof Element ? el.closest('[data-fn-code]') : null);
/** Plain clicks are left alone inside controls (a hit row that is a button): there only hover and long press open it. */
const inControl = (el: Element) => !!el.closest('button, a, [role="button"], [role="option"]');

/** Open the card for the function at `pos` in an editable field; false when there is none. */
function openInField(el: Field, pos: number, mode: CardMode, focus: boolean, enclosing = false): boolean {
  const code = el.value;
  const hit = functionAt(code, pos, { enclosing });
  if (!hit) return false;
  const anchor = fieldRect(code, metricsOf(el), hit.start, hit.end);
  openFunctionCard({ code, pos: hit.start, enclosing: false, scope: scopeOf(el), anchor, mode, focus, opener: el, editable: true });
  return true;
}

/** Open the card for the function at `pos` in read-only code; false when there is none. */
function openInCode(container: Element, pos: number, mode: CardMode, focus: boolean, enclosing = false): boolean {
  const code = container.textContent ?? '';
  const hit = functionAt(code, pos, { enclosing });
  if (!hit) return false;
  const anchor = codeRect(container, hit.start, hit.end);
  if (!anchor) return false;
  const opener = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
  openFunctionCard({ code, pos: hit.start, scope: scopeOf(container), anchor, mode, focus, opener, editable: false });
  return true;
}

/** The function under a pointer, as a key ("which word"), and how to open it. */
function underPointer(e: MouseEvent | PointerEvent): { key: string; open: (mode: CardMode, focus: boolean) => boolean } | null {
  const t = e.target;
  if (isField(t)) {
    const pos = fieldOffsetAt(t.value, metricsOf(t), e.clientX, e.clientY);
    const hit = functionAt(t.value, pos);
    if (!hit) return null;
    return { key: `f:${hit.start}:${hit.name}`, open: (mode, focus) => openInField(t, pos, mode, focus) };
  }
  const c = codeEl(t);
  if (!c) return null;
  const pos = pointOffset(c, t, e.clientX, e.clientY);
  if (pos < 0) return null;
  const hit = functionAt(c.textContent ?? '', pos);
  if (!hit) return null;
  return { key: `c:${hit.start}:${hit.name}`, open: (mode, focus) => openInCode(c, pos, mode, focus) };
}

// ── The listeners ─────────────────────────────────────────────────────────────

let installed = false;

export function installFunctionCardTriggers(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  const canHover = () => !!window.matchMedia?.('(hover: hover) and (pointer: fine)').matches;
  const cardEl = () => document.querySelector('[data-function-card]');
  const overCard = (t: EventTarget | null) => t instanceof Node && !!cardEl()?.contains(t);
  const anchorHit = (x: number, y: number) => {
    const a = useFnCard.getState().req?.anchor;
    return !!a && x >= a.left - 2 && x <= a.left + a.width + 2 && y >= a.top - 2 && y <= a.top + a.height + 2;
  };

  // Esc first: installed before any modal's listener, so it closes the card and not the modal under it.
  window.addEventListener('keydown', e => {
    if (e.key === 'Escape' && useFnCard.getState().req) {
      e.preventDefault();
      e.stopImmediatePropagation();
      closeFunctionCard(true);
      return;
    }
    if (isOpenShortcut(e)) {
      const a = document.activeElement;
      if (isField(a)) {
        if (openInField(a, a.selectionStart ?? 0, 'pinned', true, true)) { e.preventDefault(); e.stopPropagation(); }
        return;
      }
      const sel = window.getSelection();
      const c = sel?.anchorNode ? codeEl(sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement) : null;
      if (c && sel?.anchorNode) {
        const pos = codeOffset(c, sel.anchorNode, sel.anchorOffset);
        if (pos >= 0 && openInCode(c, pos, 'pinned', true, true)) { e.preventDefault(); e.stopPropagation(); }
      }
      return;
    }
    // Typing closes a peek opened by hovering
    const req = useFnCard.getState().req;
    if (req?.mode === 'peek' && !['Shift', 'Alt', 'Meta', 'Control'].includes(e.key) && !overCard(e.target)) closeFunctionCard();
  }, true);

  // Hover: rest on a name to peek
  let hover: { key: string; timer: ReturnType<typeof setTimeout> } | null = null;
  let leave: ReturnType<typeof setTimeout> | null = null;
  const clearHover = () => { if (hover) { clearTimeout(hover.timer); hover = null; } };
  window.addEventListener('mousemove', e => {
    const req = useFnCard.getState().req;
    // A peek stays while the pointer is on the name or the card
    if (req?.mode === 'peek') {
      if (overCard(e.target) || anchorHit(e.clientX, e.clientY)) { if (leave) { clearTimeout(leave); leave = null; } }
      else if (!leave) leave = setTimeout(() => { leave = null; if (useFnCard.getState().req?.mode === 'peek') closeFunctionCard(); }, FN_CARD.leaveMs);
    }
    if (e.buttons !== 0 || !canHover() || overCard(e.target)) { clearHover(); return; }
    if (!(isField(e.target) || codeEl(e.target))) { clearHover(); return; }
    const u = underPointer(e);
    if (!u) { clearHover(); return; }
    if (hover?.key === u.key) return;
    clearHover();
    // Already showing this one
    if (req && anchorHit(e.clientX, e.clientY)) return;
    hover = { key: u.key, timer: setTimeout(() => { hover = null; if (!useFnCard.getState().req || useFnCard.getState().req?.mode === 'peek') u.open('peek', false); }, FN_CARD.hoverMs) };
  }, { passive: true });

  // Presses: ⌥/⌘-click in editable code (keeps the caret), a plain click in read-only code
  let down: { x: number; y: number; t: EventTarget | null } | null = null;
  let swallowClick = false;
  let press: { timer: ReturnType<typeof setTimeout>; x: number; y: number } | null = null;
  const cancelPress = () => { if (press) { clearTimeout(press.timer); press = null; } };

  window.addEventListener('pointerdown', e => {
    clearHover();
    down = { x: e.clientX, y: e.clientY, t: e.target };
    // Outside the card (and not on its name): close
    const req = useFnCard.getState().req;
    if (req && !overCard(e.target) && !anchorHit(e.clientX, e.clientY)) closeFunctionCard();
    if (e.pointerType === 'touch' || e.pointerType === 'pen') {
      cancelPress();
      if (!(isField(e.target) || codeEl(e.target))) return;
      const ev = { target: e.target, clientX: e.clientX, clientY: e.clientY } as unknown as MouseEvent;
      press = {
        x: e.clientX, y: e.clientY,
        timer: setTimeout(() => {
          press = null;
          const u = underPointer(ev);
          if (u && u.open('pinned', false)) swallowClick = true;
        }, FN_CARD.longPressMs),
      };
    }
  }, true);
  window.addEventListener('pointermove', e => {
    if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > FN_CARD.slopPx) cancelPress();
  }, { passive: true });
  window.addEventListener('pointerup', cancelPress, true);
  window.addEventListener('pointercancel', cancelPress, true);
  window.addEventListener('contextmenu', e => { if (swallowClick) e.preventDefault(); }, true);

  window.addEventListener('mousedown', e => {
    if (!isField(e.target) || !pressOpens(e, true)) return;
    const u = underPointer(e);
    if (u && u.open('pinned', false)) { e.preventDefault(); e.stopPropagation(); swallowClick = true; }
  }, true);

  window.addEventListener('click', e => {
    if (swallowClick) { swallowClick = false; e.preventDefault(); e.stopPropagation(); return; }
    const c = codeEl(e.target);
    if (!c || isField(e.target) || !pressOpens(e, false) || inControl(c)) return;
    if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > FN_CARD.slopPx) return;
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed && c.contains(sel.anchorNode)) return;
    const u = underPointer(e);
    if (u && u.open('pinned', true)) { e.preventDefault(); e.stopPropagation(); }
  }, true);

  // The anchor moves with scrolling and resizing: a peek closes, a pinned card follows by closing too
  const onScroll = (e: Event) => { if (useFnCard.getState().req && !overCard(e.target)) closeFunctionCard(); };
  window.addEventListener('scroll', onScroll, true);
  window.addEventListener('resize', () => closeFunctionCard());
}
