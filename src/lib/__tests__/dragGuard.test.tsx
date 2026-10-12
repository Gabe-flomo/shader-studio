// @vitest-environment jsdom
/**
 * Desktop polish: card reordering starts only from a card's grip (lib/dragGuard.ts) — WebKit dragged
 * the whole card away as a ghost when a slider inside it was dragged past its edge — and the
 * WKWebView-only guards (lib/desktopPolish.ts) switch on in the Tauri app.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  const m = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); },
    key: () => null, get length() { return m.size; }, clear: () => m.clear(),
  });
});

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { StackCards } from '../../components/builders/look/StackCards';
import { FX_KINDS } from '../../builders/look/effects';
import { newStackItem } from '../../builders/look/stack';
import { dragStartAllowed, installDragGuard } from '../dragGuard';
import { blocksNativeMenu, installDesktopPolish, pinchDeltaY } from '../desktopPolish';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext'];

const html = (s: string) => { const d = document.createElement('div'); d.innerHTML = s; document.body.appendChild(d); return d; };
const press = (el: Element) => el.dispatchEvent(new Event('pointerdown', { bubbles: true, cancelable: true }));
/** A dragstart on `el` (jsdom has no DragEvent): returns whether it was cancelled and the data the card set. */
function dragStart(el: Element) {
  const data: Record<string, string> = {};
  const e = new Event('dragstart', { bubbles: true, cancelable: true });
  Object.defineProperty(e, 'dataTransfer', { value: { setData: (t: string, v: string) => { data[t] = v; }, effectAllowed: '', types: [] } });
  el.dispatchEvent(e);
  return { prevented: e.defaultPrevented, data };
}

let uninstall: () => void;
beforeAll(() => { uninstall = installDragGuard(window); });
afterAll(() => uninstall());
afterEach(() => { document.body.innerHTML = ''; });

describe('dragStartAllowed', () => {
  it('a plain draggable row drags from anywhere but its controls', () => {
    const d = html('<div draggable="true" id="row"><span id="label">Row</span><div role="slider" id="s"><i id="thumb"></i></div><input id="f"></div>');
    const row = d.querySelector('#row')!;
    expect(dragStartAllowed(row, d.querySelector('#label'))).toBe(true);
    expect(dragStartAllowed(row, d.querySelector('#thumb'))).toBe(false);
    expect(dragStartAllowed(row, d.querySelector('#f'))).toBe(false);
  });

  it('a handle-only card drags from its own grip only, not a nested card’s', () => {
    const d = html('<div data-drag-by-handle id="outer"><span data-drag-handle id="g1"><svg id="icon"></svg></span><b id="title">A</b>'
      + '<div data-drag-by-handle id="inner"><span data-drag-handle id="g2"></span></div></div>');
    const outer = d.querySelector('#outer')!;
    expect(dragStartAllowed(outer, d.querySelector('#icon'))).toBe(true);
    expect(dragStartAllowed(outer, d.querySelector('#title'))).toBe(false);
    expect(dragStartAllowed(outer, d.querySelector('#g2'))).toBe(false);
    expect(dragStartAllowed(d.querySelector('#inner')!, d.querySelector('#g2'))).toBe(true);
    expect(dragStartAllowed(outer, null)).toBe(false);
  });
});

describe('look / effects stack cards', () => {
  let root: Root;
  function mount() {
    const def = FX_KINDS.find(k => k.params.some(p => !['select', 'colour', 'rgb'].includes(String(p.type)))) ?? FX_KINDS[0];
    const host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    const items = [newStackItem(def, 'fx1')];
    act(() => root.render(<StackCards name="fx" items={items} defs={FX_KINDS} onEdit={() => {}} idPrefix="fx" empty="None" />));
    return host.querySelector<HTMLElement>('[data-look-stack-card="fx1"]')!;
  }
  afterEach(() => act(() => root.unmount()));

  it('dragging a slider in an open card never starts a reorder drag', () => {
    const card = mount();
    const slider = card.querySelector('[role="slider"]');
    expect(slider).toBeTruthy();
    press(slider!);
    expect(card.getAttribute('draggable')).toBe('false');
    const r = dragStart(card);
    expect(r.prevented).toBe(true);
    expect(r.data).toEqual({}); // the card's own onDragStart never ran
  });

  it('a press on the card body (not the grip) does not drag it either', () => {
    const card = mount();
    press(card.querySelector('[data-look-stack-summary]')!);
    expect(card.getAttribute('draggable')).toBe('false');
    expect(dragStart(card).prevented).toBe(true);
  });

  it('the grip starts the reorder drag', () => {
    const card = mount();
    const grip = card.querySelector('[data-drag-handle]');
    expect(grip).toBeTruthy();
    press(grip!);
    expect(card.getAttribute('draggable')).toBe('true');
    const r = dragStart(card);
    expect(r.prevented).toBe(false);
    expect(r.data['text/x-look-fx']).toBe('fx1');
  });
});

describe('desktop polish (Tauri)', () => {
  const css = readFileSync(resolve(__dirname, '../../index.css'), 'utf8');

  it('switches on the desktop-only rules under Tauri', () => {
    expect(document.documentElement.hasAttribute('data-desktop')).toBe(false);
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
    installDesktopPolish();
    expect(document.documentElement.hasAttribute('data-desktop')).toBe(true);
  });

  it('the stylesheet keeps chrome text unselectable (fields stay selectable) and stops native drags on desktop', () => {
    expect(css).toMatch(/body\s*\{[^}]*user-select:\s*none/);
    expect(css).toMatch(/input, textarea[^{]*\{[^}]*user-select:\s*text/);
    expect(css).toMatch(/\[data-desktop\][^{]*img[^{]*\{[^}]*-webkit-user-drag:\s*none/);
    expect(css).toMatch(/\[data-desktop\][^{]*\[role="slider"\][^{]*\{[^}]*-webkit-user-drag:\s*none/);
  });

  it('keeps the native context menu (Reload / Inspect) off the app, but not off text fields', () => {
    const d = html('<div id="panel"><span id="t">x</span></div><input id="f"><pre id="code">c</pre>');
    expect(blocksNativeMenu(d.querySelector('#t'))).toBe(true);
    expect(blocksNativeMenu(d.querySelector('#f'))).toBe(false);
    expect(blocksNativeMenu(d.querySelector('#code'))).toBe(false);
    const e = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    d.querySelector('#t')!.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
    const f = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    d.querySelector('#f')!.dispatchEvent(f);
    expect(f.defaultPrevented).toBe(false);
  });

  it('turns a trackpad pinch (WebKit gesture events) into ctrl+wheel zoom', () => {
    expect(pinchDeltaY(1, 1.1)).toBeLessThan(0); // spreading the fingers zooms in, like Chrome's ctrl+wheel
    expect(pinchDeltaY(1, 0.9)).toBeGreaterThan(0);
    const d = html('<div id="canvas"></div>');
    const canvas = d.querySelector('#canvas')!;
    const wheels: WheelEvent[] = [];
    canvas.addEventListener('wheel', e => wheels.push(e as WheelEvent));
    const elementFromPoint = document.elementFromPoint;
    document.elementFromPoint = () => canvas;
    try {
      const gesture = (type: string, scale: number) => {
        const e = new Event(type, { bubbles: true, cancelable: true });
        Object.assign(e, { scale, clientX: 10, clientY: 10 });
        canvas.dispatchEvent(e);
        return e;
      };
      expect(gesture('gesturestart', 1).defaultPrevented).toBe(true);
      gesture('gesturechange', 1.2);
      gesture('gestureend', 1.2);
    } finally { document.elementFromPoint = elementFromPoint; }
    expect(wheels).toHaveLength(1);
    expect(wheels[0].ctrlKey).toBe(true);
    expect(wheels[0].deltaY).toBeLessThan(0);
  });
});
