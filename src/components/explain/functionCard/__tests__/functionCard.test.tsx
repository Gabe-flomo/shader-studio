// @vitest-environment jsdom
/**
 * The function card's open / close conventions (triggers.ts) and the card itself
 * (FunctionCard.tsx): a plain click in read-only code, ⌥/⌘-click, F1 / ⌘I or a rest of the
 * pointer in editable code (never moving the caret), a long press on touch; Esc and a click
 * outside close it, and focus goes back.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  const mem = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v); }, removeItem: (k: string) => { mem.delete(k); }, key: () => null, length: 0, clear: () => mem.clear() });
});
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { closeFunctionCard, useFnCard, FN_CARD, type FunctionCardRequest, scopeOf, useFnCardScope, toggleNodeCard } from '../fnCardStore';
import { fieldOffsetAt, fieldRect, installFunctionCardTriggers, isOpenShortcut, pressOpens, type FieldMetrics } from '../triggers';
import { FunctionCard, placeCard } from '../FunctionCard';
import { SNIPPETS } from '../../../../suggestions/snippets';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('the rules', () => {
  it('F1 and ⌘I (Ctrl+I off the Mac) open it', () => {
    const k = (key: string, m: Partial<{ metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean }> = {}) => ({ key, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...m });
    expect(isOpenShortcut(k('F1'), true)).toBe(true);
    expect(isOpenShortcut(k('i', { metaKey: true }), true)).toBe(true);
    expect(isOpenShortcut(k('i', { ctrlKey: true }), true)).toBe(false);
    expect(isOpenShortcut(k('i', { ctrlKey: true }), false)).toBe(true);
    expect(isOpenShortcut(k('i', { metaKey: true, shiftKey: true }), true)).toBe(false);
    expect(isOpenShortcut(k('i'), true)).toBe(false);
  });

  it('read-only code opens on a plain click; editable code needs ⌥ or ⌘ (Ctrl off the Mac)', () => {
    const p = (m: Partial<{ button: number; altKey: boolean; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean }> = {}) => ({ button: 0, altKey: false, metaKey: false, ctrlKey: false, shiftKey: false, ...m });
    expect(pressOpens(p(), false)).toBe(true);
    expect(pressOpens(p({ altKey: true }), false)).toBe(false);
    expect(pressOpens(p({ button: 2 }), false)).toBe(false);
    expect(pressOpens(p(), true)).toBe(false); // a plain click places the caret
    expect(pressOpens(p({ altKey: true }), true)).toBe(true);
    expect(pressOpens(p({ metaKey: true }), true, true)).toBe(true);
    expect(pressOpens(p({ ctrlKey: true }), true, true)).toBe(false); // Ctrl-click is a right-click on the Mac
    expect(pressOpens(p({ ctrlKey: true }), true, false)).toBe(true);
    expect(pressOpens(p({ altKey: true, shiftKey: true }), true)).toBe(false); // shift extends a selection
  });

  const m: FieldMetrics = { left: 100, top: 50, padL: 10, padT: 8, lineH: 20, charW: 8, scrollLeft: 0, scrollTop: 0, tabSize: 2, singleLine: false, height: 200 };
  const text = 'float a = sin(t);\n\tvec2 q = rotate(p, a);';

  it('a point in a field is the character under it, across lines and tabs', () => {
    // line 0, column 10 → 's' of sin
    expect(text[fieldOffsetAt(text, m, 100 + 10 + 10 * 8 + 3, 50 + 8 + 5)]).toBe('s');
    // line 1: a tab (2 columns) then "vec2 q = rotate": column 11 is 'r'
    const at = fieldOffsetAt(text, m, 100 + 10 + 11 * 8 + 1, 50 + 8 + 25);
    expect(text.slice(at, at + 6)).toBe('rotate');
    // scrolled
    expect(text[fieldOffsetAt(text, { ...m, scrollLeft: 16 }, 100 + 10 + 8 * 8 + 1, 60)]).toBe('s');
    // past the end of a line: its end
    expect(fieldOffsetAt(text, m, 900, 60)).toBe(text.indexOf('\n'));
  });

  it('a name’s rectangle in a field', () => {
    const s = text.indexOf('rotate');
    expect(fieldRect(text, m, s, s + 6)).toEqual({ left: 100 + 10 + 11 * 8, top: 50 + 8 + 20, width: 48, height: 20 });
    expect(fieldRect('x = mix(a, b, t)', { ...m, singleLine: true, height: 34 }, 4, 7)).toEqual({ left: 100 + 10 + 32, top: 50, width: 24, height: 34 });
  });

  it('the card sits under its name, or over it near the bottom, inside the window', () => {
    const view = { width: 400, height: 800 };
    expect(placeCard({ left: 50, top: 100, width: 40, height: 16 }, { width: 360, height: 200 }, view)).toEqual({ left: 24, top: 122, above: false });
    expect(placeCard({ left: 50, top: 700, width: 40, height: 16 }, { width: 360, height: 200 }, view)).toEqual({ left: 24, top: 494, above: true });
    expect(placeCard({ left: 0, top: 100, width: 40, height: 16 }, { width: 200, height: 200 }, view).left).toBe(16);
  });
});

// ── In the DOM ────────────────────────────────────────────────────────────────

const req = () => useFnCard.getState().req as FunctionCardRequest | null;
const mounted: Array<{ root: Root; host: HTMLElement }> = [];
function mount(ui: React.ReactElement) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(ui));
  mounted.push({ root, host });
  return host;
}

function fire(el: EventTarget, type: string, init: Record<string, unknown> = {}) {
  const Ctor = type.startsWith('key') ? KeyboardEvent : MouseEvent;
  const e = new Ctor(type, { bubbles: true, cancelable: true, button: 0, ...init });
  for (const [k, v] of Object.entries(init)) if (!(k in e)) Object.defineProperty(e, k, { value: v });
  if ('pointerType' in init) Object.defineProperty(e, 'pointerType', { value: init.pointerType });
  act(() => { el.dispatchEvent(e); });
  return e;
}

/** Read-only code the way the highlighters write it: one span per token. */
function codeLine(code: string, inButton = false) {
  const host = document.createElement('div');
  const wrap = inButton ? document.createElement('button') : host;
  if (inButton) host.appendChild(wrap);
  const c = document.createElement('code');
  c.setAttribute('data-fn-code', '');
  for (const tok of code.match(/\w+|\s+|[^\w\s]/g) ?? []) { const s = document.createElement('span'); s.textContent = tok; c.appendChild(s); }
  wrap.appendChild(c);
  document.body.appendChild(host);
  const tok = (word: string) => [...c.querySelectorAll('span')].find(s => s.textContent === word)!;
  return { host, c, tok };
}

function field(value: string, tag: 'textarea' | 'input' = 'textarea') {
  const el = document.createElement(tag);
  el.setAttribute('data-fn-card', 'edit');
  el.value = value;
  el.style.padding = '0';
  el.style.font = '10px monospace';
  el.style.lineHeight = '20px';
  document.body.appendChild(el);
  return el;
}

beforeAll(() => installFunctionCardTriggers());
beforeEach(() => { closeFunctionCard(); document.body.innerHTML = ''; });
afterEach(() => {
  for (const x of mounted.splice(0)) { act(() => x.root.unmount()); x.host.remove(); }
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('read-only code', () => {
  it('a plain click on a function name opens a pinned card that takes focus', () => {
    const { tok } = codeLine('float e = smoothstep(0.3, 0.35, d);');
    const e = fire(tok('smoothstep'), 'click');
    expect(e.defaultPrevented).toBe(true);
    expect(req()).toMatchObject({ kind: 'function', mode: 'pinned', focus: true, editable: false, pos: 10 });
    expect(req()!.code).toBe('float e = smoothstep(0.3, 0.35, d);');
  });

  it('a click on a variable, a number or a type does nothing', () => {
    const { tok } = codeLine('float e = smoothstep(0.3, 0.35, d);');
    for (const w of ['float', 'e', 'd', '3']) { const ev = fire(tok(w), 'click'); expect(ev.defaultPrevented).toBe(false); }
    expect(req()).toBeNull();
  });

  it('inside a button (a search hit) a plain click stays the button’s', () => {
    const { tok } = codeLine('mix(a, b, t)', true);
    fire(tok('mix'), 'click');
    expect(req()).toBeNull();
  });

  it('a click that ends a text selection does not open it', () => {
    const { c, tok } = codeLine('mix(a, b, t)');
    const sel = window.getSelection()!;
    const r = document.createRange();
    r.selectNodeContents(c);
    sel.removeAllRanges(); sel.addRange(r);
    fire(tok('mix'), 'click');
    expect(req()).toBeNull();
    sel.removeAllRanges();
  });

  it('Esc closes it and gives focus back; so does a click outside', () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    const { tok } = codeLine('sin(t)');
    fire(tok('sin'), 'click');
    expect(req()?.opener).toBe(opener);
    const esc = fire(window, 'keydown', { key: 'Escape' });
    expect(esc.defaultPrevented).toBe(true);
    expect(req()).toBeNull();
    expect(document.activeElement).toBe(opener);

    fire(tok('sin'), 'click');
    expect(req()).not.toBeNull();
    fire(document.body, 'pointerdown', { clientX: 500, clientY: 500 });
    expect(req()).toBeNull();
  });

  it('F1 with the selection in read-only code opens the call around it', () => {
    const { c } = codeLine('x = clamp(v, 0.0, 1.0);');
    const textNodes = [...c.querySelectorAll('span')].map(s => s.firstChild!);
    const zero = textNodes.find(t => t.textContent === '0')!;
    const sel = window.getSelection()!;
    const r = document.createRange();
    r.setStart(zero, 0); r.collapse(true);
    sel.removeAllRanges(); sel.addRange(r);
    fire(c, 'keydown', { key: 'F1' });
    expect(req()).toMatchObject({ pos: 4, focus: true });
    sel.removeAllRanges();
  });
});

describe('editable code', () => {
  it('a plain press leaves the caret alone; ⌥-press opens without moving it', () => {
    const ta = field('float a = sin(t);');
    ta.setSelectionRange(2, 2);
    const plain = fire(ta, 'mousedown', { clientX: 10 * 6.0 + 2, clientY: 5 });
    expect(plain.defaultPrevented).toBe(false);
    expect(req()).toBeNull();
    // jsdom has no canvas: the field's character width falls back to 7.2
    const alt = fire(ta, 'mousedown', { clientX: 10 * 7.2 + 2, clientY: 5, altKey: true });
    expect(alt.defaultPrevented).toBe(true);
    expect(req()).toMatchObject({ mode: 'pinned', focus: false, editable: true, opener: ta, pos: 10 });
    expect(ta.selectionStart).toBe(2);
    // The click that follows is swallowed
    const click = fire(ta, 'click', { altKey: true });
    expect(click.defaultPrevented).toBe(true);
  });

  it('⌥-press on a variable does nothing (and lets the press through)', () => {
    const ta = field('float a = sin(t);');
    const e = fire(ta, 'mousedown', { clientX: 6 * 7.2 + 2, clientY: 5, altKey: true });
    expect(e.defaultPrevented).toBe(false);
    expect(req()).toBeNull();
  });

  it('⌘I with the caret in the arguments opens the call around it, and takes focus', () => {
    const ta = field('vec3 c = mix(a, b, smoothstep(0.0, 1.0, x));');
    ta.focus();
    ta.setSelectionRange(32, 32); // in smoothstep's arguments
    fire(ta, 'keydown', { key: 'i', metaKey: true, ctrlKey: false });
    // Off the Mac it is Ctrl+I
    if (!req()) fire(ta, 'keydown', { key: 'i', ctrlKey: true });
    expect(req()).toMatchObject({ focus: true, editable: true, pos: 19 });
    ta.setSelectionRange(14, 14);
    fire(ta, 'keydown', { key: 'F1' });
    expect(req()!.pos).toBe(9); // mix
  });

  it('works in a one-line input (Expression Block lines)', () => {
    const inp = field('d = length(p) - 0.3', 'input');
    fire(inp, 'mousedown', { clientX: 5 * 7.2 + 2, clientY: 5, altKey: true });
    expect(req()?.pos).toBe(4);
  });

  it('resting the pointer on a name opens a peek; leaving closes it; typing closes it', () => {
    vi.useFakeTimers();
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    window.matchMedia = (() => ({ matches: true })) as unknown as typeof window.matchMedia;
    const ta = field('float a = sin(t);');
    fire(ta, 'mousemove', { clientX: 11 * 7.2, clientY: 5, buttons: 0 });
    act(() => { vi.advanceTimersByTime(FN_CARD.hoverMs - 50); });
    expect(req()).toBeNull();
    act(() => { vi.advanceTimersByTime(100); });
    expect(req()).toMatchObject({ mode: 'peek', focus: false });
    fire(document.body, 'mousemove', { clientX: 600, clientY: 600, buttons: 0 });
    act(() => { vi.advanceTimersByTime(FN_CARD.leaveMs + 10); });
    expect(req()).toBeNull();

    fire(ta, 'mousemove', { clientX: 11 * 7.2 + 1, clientY: 5, buttons: 0 });
    act(() => { vi.advanceTimersByTime(FN_CARD.hoverMs + 10); });
    expect(req()?.mode).toBe('peek');
    fire(ta, 'keydown', { key: 'x' });
    expect(req()).toBeNull();
    window.matchMedia = undefined as unknown as typeof window.matchMedia;
  });

  it('a long press on touch opens it', () => {
    vi.useFakeTimers();
    const { tok } = codeLine('step(0.5, x)');
    fire(tok('step'), 'pointerdown', { pointerType: 'touch', clientX: 3, clientY: 3 });
    act(() => { vi.advanceTimersByTime(FN_CARD.longPressMs + 10); });
    expect(req()).toMatchObject({ mode: 'pinned', pos: 0 });
    // The lift's click doesn't also count
    const click = fire(tok('step'), 'click');
    expect(click.defaultPrevented).toBe(true);
  });

  it('moving the finger cancels the long press', () => {
    vi.useFakeTimers();
    const { tok } = codeLine('step(0.5, x)');
    fire(tok('step'), 'pointerdown', { pointerType: 'touch', clientX: 3, clientY: 3 });
    fire(window, 'pointermove', { clientX: 40, clientY: 3 });
    act(() => { vi.advanceTimersByTime(FN_CARD.longPressMs + 10); });
    expect(req()).toBeNull();
  });
});

describe('scopes', () => {
  it('nearest scope wins, types and source merge', () => {
    function Probe() {
      const outer = useFnCardScope({ types: { a: 'float' }, source: 'float f(float x) { return x; }' });
      const inner = useFnCardScope({ types: { b: 'vec2' } });
      return <div {...outer}><div {...inner}><code data-fn-code="" id="probe">f(b)</code></div></div>;
    }
    const host = mount(<Probe />);
    const s = scopeOf(host.querySelector('#probe'));
    expect(s.types).toEqual({ a: 'float', b: 'vec2' });
    expect(s.source).toContain('float f(');
  });
});

describe('the card', () => {
  const open = (code: string, pos: number, extra: Partial<FunctionCardRequest> = {}): FunctionCardRequest =>
    ({ kind: 'function', code, pos, scope: {}, anchor: { left: 10, top: 10, width: 40, height: 16 }, mode: 'pinned', focus: true, opener: null, editable: false, ...extra });

  it('is a labelled, focusable dialog with the overloads, the meaning, this call and the links', () => {
    const host = mount(<FunctionCard req={open('float e = smoothstep(0.3, 0.35, d);', 10, { scope: { types: { d: 'float' } } })} />);
    const card = document.querySelector<HTMLElement>('[data-function-card]')!;
    void host;
    expect(card.getAttribute('role')).toBe('dialog');
    expect(card.getAttribute('aria-label')).toBe('smoothstep: function card');
    expect(card.tabIndex).toBe(-1);
    expect(document.activeElement).toBe(card);
    expect(card.querySelectorAll('tbody tr')).toHaveLength(2);
    expect(card.textContent).toContain('genType: float, vec2, vec3 or vec4');
    expect(card.querySelector('[data-fn-card-meaning]')!.textContent).toMatch(/^A soft ramp from 0 to 1/);
    expect(card.querySelector('[data-transfer-plot]')).not.toBeNull();
    expect(card.textContent).toContain('with this call’s numbers');
    expect(card.querySelector('[data-fn-card-here]')!.textContent).toMatch(/0\.35/);
    const links = [...card.querySelectorAll('[data-fn-card-links] button, [data-fn-card-links] a')].map(b => b.textContent);
    expect(links).toEqual(['How is this used?', 'Docs']);
    expect(card.querySelector('a')!.getAttribute('href')).toMatch(/smoothstep/);
  });

  it('Insert snippet in an editor with the snippet library; Copy snippet elsewhere', () => {
    const onSnippet = vi.fn();
    mount(<FunctionCard req={open('d = smin(a, b, 0.2);', 4, { editable: true, scope: { onSnippet } })} />);
    const btn = [...document.querySelectorAll('[data-function-card] button')].find(b => b.textContent === 'Insert snippet') as HTMLButtonElement;
    expect(btn).toBeDefined();
    act(() => { btn.click(); });
    expect(onSnippet).toHaveBeenCalledWith(SNIPPETS.find(s => s.id === 'smin'));
    expect(req()).toBeNull();

    mount(<FunctionCard req={open('d = smin(a, b, 0.2);', 4)} />);
    expect([...document.querySelectorAll('[data-function-card] button')].some(b => b.textContent === 'Copy snippet')).toBe(true);
  });

  it('a user function shows its parsed signature', () => {
    mount(<FunctionCard req={open('float d = ring(uv, 0.3);', 11, { scope: { source: '// A ring.\nfloat ring(vec2 p, float r) { return abs(length(p) - r); }' } })} />);
    const card = document.querySelector('[data-function-card]')!;
    expect(card.querySelector('[data-fn-card-signature]')!.textContent).toBe('float ring(vec2 p, float r)');
    expect(card.querySelector('[data-fn-card-doc]')!.textContent).toBe('A ring.');
    expect(card.textContent).toContain('Your function');
  });

  it('the close button closes it', () => {
    useFnCard.setState({ req: open('sin(t)', 0) });
    mount(<FunctionCard req={req()!} />);
    act(() => { document.querySelector<HTMLButtonElement>('[aria-label="Close (Esc)"]')!.click(); });
    expect(req()).toBeNull();
  });

  it('the node ⓘ toggles the node card', () => {
    const b = document.createElement('button');
    document.body.appendChild(b);
    toggleNodeCard(b, 'n1');
    expect(useFnCard.getState().req).toMatchObject({ kind: 'node', nodeId: 'n1', focus: true, opener: b });
    toggleNodeCard(b, 'n1');
    expect(useFnCard.getState().req).toBeNull();
  });
});
