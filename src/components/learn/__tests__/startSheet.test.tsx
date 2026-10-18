// @vitest-environment jsdom
/**
 * The desktop Start sheet: offered once per device on first run (not on a phone, not when a link
 * opened something, after any other dialog), skippable, reopenable; with the Scene builder, the
 * Getting started lesson, a blank graph and the examples. Learn lists the app's lessons, which
 * Present no longer shows.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  const m = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); },
    key: () => null, get length() { return m.size; }, clear: () => m.clear(),
  });
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: false, media: q, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false }));
});
vi.mock('../../present/useSampleStills', () => ({ useSampleStills: () => ({}), useExampleStills: () => ({}) }));

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'fs';
import { LearnSurfaces } from '../LearnSurfaces';
import { START_SHEET_KEY, resetStartSheetSession, shouldShowStartSheet, useLearnUi } from '../learnStore';
import { LEARN_LESSONS } from '../../../present/samples';
import { useNodeGraphStore } from '../../../store/useNodeGraphStore';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLElement | null = null;
const mount = (phone = false) => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(<LearnSurfaces phone={phone} page="studio" />));
};
beforeEach(() => { localStorage.clear(); resetStartSheetSession(); useLearnUi.setState({ startOpen: false, learnOpen: false }); vi.useFakeTimers(); });
afterEach(() => { act(() => root?.unmount()); host?.remove(); root = null; host = null; vi.useRealTimers(); document.body.innerHTML = ''; });
const $ = (sel: string) => document.querySelector(sel);
const click = (el: Element | null) => act(() => { el!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });

describe('first run', () => {
  it('offers Start once per device on a desktop', () => {
    mount();
    expect($('[data-start-sheet]')).toBeNull();
    act(() => { vi.advanceTimersByTime(2000); });
    expect($('[data-start-sheet]')).toBeTruthy();
    expect(localStorage.getItem(START_SHEET_KEY)).toBe('1');
    // Skip keeps the graph; Start doesn't come back on the next launch.
    click($('[data-start-skip]'));
    expect($('[data-start-sheet]')).toBeNull();
    act(() => root!.unmount());
    resetStartSheetSession();
    root = createRoot(host!);
    act(() => root!.render(<LearnSurfaces phone={false} page="studio" />));
    act(() => { vi.advanceTimersByTime(5000); });
    expect($('[data-start-sheet]')).toBeNull();
    // Help → Start… opens it again.
    act(() => useLearnUi.getState().openStart());
    expect($('[data-start-sheet]')).toBeTruthy();
  });

  it('not on a phone (it has its own welcome), and not on another page', () => {
    expect(shouldShowStartSheet({ phone: true, page: 'studio' })).toBe(false);
    expect(shouldShowStartSheet({ phone: false, page: 'play' })).toBe(false);
    expect(shouldShowStartSheet({ phone: false, page: 'studio' })).toBe(true);
    mount(true);
    act(() => { vi.advanceTimersByTime(5000); });
    expect($('[data-start-sheet]')).toBeNull();
  });

  it('waits while another dialog (Recover) is up', () => {
    const other = document.createElement('div');
    other.setAttribute('role', 'dialog');
    document.body.appendChild(other);
    mount();
    act(() => { vi.advanceTimersByTime(3000); });
    expect($('[data-start-sheet]')).toBeNull();
    other.remove();
    act(() => { vi.advanceTimersByTime(1100); });
    expect($('[data-start-sheet]')).toBeTruthy();
  });
});

describe('the Start sheet', () => {
  it('has the Scene builder, the lesson, a blank graph and the examples by folder', () => {
    mount();
    act(() => useLearnUi.getState().openStart());
    expect(Array.from(document.querySelectorAll('[data-start-choice]')).map(b => b.getAttribute('data-start-choice'))).toEqual(['scene', 'lesson', 'blank']);
    expect(document.querySelectorAll('[data-start-example]').length).toBeGreaterThan(2);
    const folder = $('[data-start-folders] button');
    click(folder);
    expect($('[data-start-folder]')?.querySelectorAll('button').length).toBeGreaterThan(0);
  });

  it('Blank graph leaves just UV and the Output', () => {
    useNodeGraphStore.getState().loadExampleGraph('blank');
    mount();
    act(() => useLearnUi.getState().openStart());
    click($('[data-start-choice="blank"]'));
    expect(useNodeGraphStore.getState().nodes.map(n => n.type).sort()).toEqual(['output', 'uv']);
    expect($('[data-start-sheet]')).toBeNull();
  });
});

describe('Learn', () => {
  it('lists the app lessons; Present no longer shows them', () => {
    mount();
    act(() => useLearnUi.getState().openLearn());
    const titles = Array.from(document.querySelectorAll('[data-lesson]')).map(b => b.getAttribute('data-lesson'));
    expect(titles).toEqual(LEARN_LESSONS.map(l => l.title));
    expect(titles).toContain('Getting started in the Studio');
    const present = readFileSync('src/components/present/PresentPage.tsx', 'utf8');
    expect(present).toMatch(/PRESENT_SAMPLE_GROUPS = SAMPLE_GROUPS\.filter\(g => g\.id !== 'app'\)/);
    expect(present).not.toMatch(/\{SAMPLE_GROUPS\.map\(/);
  });
});
