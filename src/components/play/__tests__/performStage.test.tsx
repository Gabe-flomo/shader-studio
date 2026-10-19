// @vitest-environment jsdom
/**
 * Round 5 (docs/perform-mode.md): the Stage puts the picture on the RIGHT with Perform's controls
 * on its left (stacked under the picture on a phone), Perform draws each control kind as its
 * widget with no edit icons, Free letterboxes on the Stage, the Output preview keeps the
 * picture's shape, and the exported page has its panel on the left too.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const mq = vi.hoisted(() => {
  const m = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); },
    key: () => null, get length() { return m.size; }, clear: () => m.clear(),
  });
  class RO { observe() {} unobserve() {} disconnect() {} }
  vi.stubGlobal('ResizeObserver', RO);
  const state = { narrow: false };
  vi.stubGlobal('matchMedia', (q: string) => ({ get matches() { return q.includes('max-width') && state.narrow; }, media: q, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false }));
  return state;
});

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Stage } from '../Stage';
import { useStage } from '../stageStore';
import { useNodeGraphStore } from '../../../store/useNodeGraphStore';
import { emptyPlayRecord, type PlayRecord } from '../../../types/play';
import { defaultLayer } from '../../../types/playLayers';
import type { GraphNode } from '../../../types/nodeGraph';
import { containBox, sameShape } from '../../../output/previewFit';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;
afterEach(() => { act(() => root?.unmount()); host?.remove(); root = null; host = null; useStage.setState({ mode: null, snapshot: null, panel: true, device: 'screen' }); });

const node = (id: string, params: Record<string, unknown>): GraphNode => ({ id, type: 'circleSDF', position: { x: 0, y: 0 }, inputs: {}, outputs: {}, params } as unknown as GraphNode);
beforeEach(() => {
  const play: PlayRecord = {
    ...emptyPlayRecord(),
    layers: [defaultLayer('particles', 'pop', 'Sparks')],
    controls: [
      { id: 'x', target: 'circ::posX', kind: 'float', label: 'X', min: -1, max: 1 },
      { id: 'y', target: 'circ::posY', kind: 'float', label: 'Y', min: -1, max: 1 },
      { id: 'r', target: 'circ::radius', kind: 'float', label: 'Radius', min: 0, max: 1 },
      { id: 'f', target: 'circ::freq', kind: 'float', label: 'Freq', min: 1, max: 30 },
      { id: 's', target: 'circ::hard', kind: 'float', label: 'Hard', min: 0, max: 1, toggle: true },
      { id: 't', target: 'circ::tint', kind: 'color', label: 'Tint', min: 0, max: 1 },
      { id: 'b', target: 'act:pop::burst', kind: 'action', label: 'Burst', min: 0, max: 1 },
    ],
    pairs: [{ id: 'p', label: 'Dot', a: 'x', b: 'y', position: true }],
  };
  useNodeGraphStore.setState({ nodes: [node('circ', { posX: 0, posY: 0, radius: 0.3, freq: 8, hard: 1, tint: [1, 0.5, 0] })], play });
});

function mount(): HTMLDivElement {
  useStage.setState({ mode: 'full', snapshot: null, panel: true, device: 'screen' });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(<Stage canvas={<div data-testid="picture" />} onRecord={() => {}} />));
  return host;
}
const orderOf = (el: Element | null) => Number((el as HTMLElement | null)?.style.order ?? NaN);

describe('the Stage: Perform on the left, the picture on the right', () => {
  it('on a wide screen: a row, controls (order 0) before the picture (order 1)', () => {
    mq.narrow = false;
    const h = mount();
    const body = h.querySelector('[data-stage-body]') as HTMLElement;
    expect(body.style.flexDirection).toBe('row');
    const controls = h.querySelector('[data-stage-controls]');
    const picture = h.querySelector('[data-stage-picture]');
    expect(orderOf(controls)).toBeLessThan(orderOf(picture));
    expect((controls as HTMLElement).style.borderRight).toContain('1px');
    expect(picture?.querySelector('[data-testid="picture"]')).not.toBeNull();
    // Perform is the default view.
    expect(controls?.querySelector('[data-perform]')).not.toBeNull();
  });

  it('on a phone: stacked, the picture on top', () => {
    mq.narrow = true;
    const h = mount();
    expect((h.querySelector('[data-stage-body]') as HTMLElement).style.flexDirection).toBe('column');
    expect(orderOf(h.querySelector('[data-stage-picture]'))).toBeLessThan(orderOf(h.querySelector('[data-stage-controls]')));
    // On a phone the size and legend ride in Perform's own bar.
    expect(h.querySelector('[data-perform-bar] [data-perform-view]')).not.toBeNull();
    mq.narrow = false;
  });

  it('hiding the controls leaves the picture alone', () => {
    const h = mount();
    act(() => useStage.getState().togglePanel());
    expect(h.querySelector('[data-stage-controls]')).toBeNull();
    expect(h.querySelector('[data-stage-picture]')).not.toBeNull();
  });
});

describe('Perform: each control kind is its widget, with no edit icons', () => {
  it('XY pad, fader, knob, toggle, swatch and pad', () => {
    const h = mount();
    const kinds = [...h.querySelectorAll('[data-widget]')].map(e => e.getAttribute('data-widget'));
    expect(kinds).toEqual(['xy', 'fader', 'knob', 'toggle', 'swatch', 'pad']);
    expect(h.querySelector('[data-fader="r"] [role="slider"]')?.getAttribute('aria-valuenow')).toBe('0.3');
    expect(h.querySelector('[data-toggle="s"]')?.getAttribute('aria-checked')).toBe('true');
    // No edit icons: no delete, move or detach buttons in the grid.
    const labels = [...h.querySelectorAll('[data-perform-grid] button')].map(b => b.getAttribute('aria-label') ?? '');
    expect(labels.some(l => /delete|remove|move|detach|edit/i.test(l))).toBe(false);
  });

  it('a switch flips on a tap, and the size buttons change the grid', () => {
    const h = mount();
    act(() => (h.querySelector('[data-toggle="s"]') as HTMLButtonElement).click());
    expect(useNodeGraphStore.getState().nodes[0].params.hard).toBe(0);
    act(() => (h.querySelector('[role="radio"][title="Large controls"]') as HTMLButtonElement).click());
    expect(h.querySelector('[data-perform-grid]')?.getAttribute('data-size')).toBe('L');
    act(() => useStage.getState().setSize('M'));
  });

  it('the bar has Randomize, Reset, Panic and the takes (named as the glossary has them)', () => {
    const h = mount();
    for (const k of ['randomize', 'strength', 'reset', 'panic', 'take', 'takes']) expect(h.querySelector(`[data-perform-${k}]`), k).not.toBeNull();
    expect(h.querySelector('[data-perform-take]')?.getAttribute('title')).toContain('Record performance (take)');
    // Randomize from the bar: one click moves the controls.
    const before = JSON.stringify(useNodeGraphStore.getState().nodes[0].params);
    act(() => (h.querySelector('[data-perform-randomize]') as HTMLButtonElement).click());
    expect(JSON.stringify(useNodeGraphStore.getState().nodes[0].params)).not.toBe(before);
  });
});

describe('Free letterboxes on the Stage', () => {
  it('ShaderCanvas fits Free on the Stage as on the Play page', () => {
    const src = readFileSync(join(__dirname, '../../ShaderCanvas.tsx'), 'utf8');
    expect(src).toMatch(/const onStage = useStage\(s => s\.mode !== null\);/);
    expect(src).toMatch(/const onPlayArea = usePlaySplit\(s => s\.available\) \|\| onStage;/);
  });
});

describe('Output (P23)', () => {
  it('fits the picture into the output picture’s shape, whole and unstretched', () => {
    expect(containBox(900, 800, 16 / 9)).toEqual({ w: 1422, h: 800, x: 261, y: 0 });
    expect(containBox(1600, 400, 1)).toEqual({ w: 1600, h: 1600, x: 0, y: 600 });
    const b = containBox(935, 755, 16 / 9);
    expect(b.w / b.h).toBeCloseTo(16 / 9, 2);
    expect(sameShape(1920, 1080, 16 / 9)).toBe(true);
    expect(sameShape(900, 800, 16 / 9)).toBe(false);
  });

  it('the preview draws through fitPicture, and the duplicate Start over is gone', () => {
    const src = readFileSync(join(__dirname, '../../output/ProjectionDialog.tsx'), 'utf8');
    expect(src).toMatch(/fitPicture\(picture\.canvas, L\.pictureAspect, fitted\)/);
    expect(src).not.toMatch(/Start over/);
  });
});

describe('the exported page: panel left, picture right; stacked when narrow', () => {
  it('orders the panel first with its border on the right, and back under the picture below 720 px', () => {
    const src = readFileSync(join(__dirname, '../../../play/runtime/play-runtime.js'), 'utf8');
    expect(src).toMatch(/\.ssp-panel\{order:-1;[^}]*border-right:1px solid #26272f/);
    const media = src.slice(src.indexOf('@media (max-width:720px)'));
    expect(media).toMatch(/\.ssp:not\(\.ssp-bg\)\{flex-direction:column\}/);
    expect(media).toMatch(/\.ssp-panel\{order:0;[^}]*border-top:1px solid #26272f/);
  });
});
