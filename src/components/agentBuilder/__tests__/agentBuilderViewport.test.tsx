// @vitest-environment jsdom
/**
 * The Agent Builder's viewport, organised (docs/agent-builder.md "Legend, tags and focus"): one
 * legend instead of scattered labels, small tags that don't overlap, hover linking legend ↔ drawing
 * ↔ control, and focus (only that card, more words, a moving demo that runs only in focus; Esc or ×
 * leaves it).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  const m = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); },
    key: () => null, get length() { return m.size; }, clear: () => m.clear(),
  });
});

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useNodeGraphStore } from '../../../store/useNodeGraphStore';
import { useBuilderWindows } from '../../../builders/windows';
import { AgentBuilder } from '../AgentBuilder';
import { tagsOverlap } from '../../../agentBuilder/legend';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext'];
Element.prototype.getBoundingClientRect = function () { return { x: 0, y: 0, left: 0, top: 0, right: 900, bottom: 600, width: 900, height: 600, toJSON: () => ({}) } as DOMRect; };

const raf = vi.fn<(cb: FrameRequestCallback) => number>(() => 1);
const caf = vi.fn();
const mounted: Array<{ root: Root; host: HTMLElement }> = [];
function mount(ui: React.ReactElement) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(ui));
  mounted.push({ root, host });
}
afterEach(() => { for (const m of mounted.splice(0)) { act(() => m.root.unmount()); m.host.remove(); } vi.useRealTimers(); });
const $ = (sel: string) => document.body.querySelector(sel);
const $$ = (sel: string) => [...document.body.querySelectorAll(sel)];
const click = (el: Element | null) => { expect(el).toBeTruthy(); act(() => { el!.dispatchEvent(new MouseEvent('click', { bubbles: true })); }); };
/** Fake timers that leave requestAnimationFrame to the spy. */
const fake = () => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
const enter = (el: Element | null) => { expect(el).toBeTruthy(); act(() => { el!.dispatchEvent(new PointerEvent('pointerover', { bubbles: true })); el!.dispatchEvent(new PointerEvent('pointerenter', { bubbles: false })); }); };
const leave = (el: Element | null) => { expect(el).toBeTruthy(); act(() => { el!.dispatchEvent(new PointerEvent('pointerout', { bubbles: true })); el!.dispatchEvent(new PointerEvent('pointerleave', { bubbles: false })); }); };
const esc = () => act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });

let closed = 0;
beforeEach(() => {
  localStorage.clear();
  closed = 0;
  raf.mockClear(); caf.mockClear();
  vi.stubGlobal('requestAnimationFrame', raf);
  vi.stubGlobal('cancelAnimationFrame', caf);
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 });
  useNodeGraphStore.setState({ nodes: [], activeGroupPath: [], selectedNodeId: null, selectedNodeIds: [] });
  useBuilderWindows.setState({ gridRules: null, agentRules: null, agentBuilder: null, recipe: null });
});

function start(kind: string) {
  mount(<AgentBuilder groupId={null} onClose={() => { closed++; }} />);
  click($(`[data-start-kind="${kind}"]`));
}
const legendIds = () => $$('[data-legend-entry]').map(e => e.getAttribute('data-legend-entry'));
const tagBoxes = () => $$('[data-tag]').map(t => ({ left: Number(t.getAttribute('data-x')), top: Number(t.getAttribute('data-y')), w: Number(t.querySelector('rect')!.getAttribute('width')), h: 18 }));

describe('one legend instead of scattered labels', () => {
  it('particles\' Forces: the legend lists each drawing with a dot, numbers and a plain line; the picture has only small tags, not overlapping', () => {
    fake();
    start('particles');
    const ids = legendIds();
    expect(ids).toEqual(expect.arrayContaining(['curl#0', 'gravity#0', 'drag#0']));
    const g = $('[data-legend-entry="gravity#0"]')!;
    expect(g.querySelector('[data-legend-line]')?.textContent).toMatch(/^Gravity [\d.]+, pointing (up|down): each particle is pulled (upward|downward)/);
    // Every tag on the picture belongs to an entry of the legend, and none is a sentence.
    const tags = $$('[data-tag]');
    expect(tags.length).toBeGreaterThan(2);
    for (const t of tags) {
      expect(ids).toContain(t.getAttribute('data-tag'));
      expect((t.getAttribute('data-tag-text') ?? '').split(' ').length).toBeLessThanOrEqual(4);
    }
    // The old scattered labels are gone.
    expect($('[data-kind-diagram] [data-label]')).toBeNull();
    expect(document.body.textContent).not.toContain('all together (orange)');
    expect(tagsOverlap(tagBoxes())).toBe(false);
    // It folds (remembered).
    click($('[data-legend-toggle]'));
    expect($('[data-viewport-legend]')?.getAttribute('data-viewport-legend')).toBe('folded');
    expect(localStorage.getItem('builder:agent-builder:studio:legend')).toBe('0');
  });

  it('the legend follows the section: Life, then Moving', () => {
    fake();
    start('particles');
    click($('[data-studio-section="life"]'));
    expect(legendIds()).toEqual(['lives', 'fade#0', 'die#0']);
    click($('[data-studio-section="moving"]'));
    expect(legendIds()).toEqual(['speed', 'edges']);
    click($('[data-studio-section="look"]'));
    expect($('[data-viewport-legend]')).toBeNull();
  });
});

describe('linking legend ↔ drawing ↔ control', () => {
  it('hovering an entry lights its drawing (the others dim) and its card in the inspector (pulsed)', () => {
    fake();
    start('particles');
    enter($('[data-legend-entry="gravity#0"]'));
    expect($('[data-legend-entry="gravity#0"]')?.hasAttribute('data-lit')).toBe(true);
    expect($('[data-kind-diagram]')?.getAttribute('data-card-hot')).toBe('gravity#0');
    expect(Number($('[data-force="curl"]')?.getAttribute('opacity'))).toBeLessThan(0.2);
    expect(Number($('[data-force="gravity"]')?.getAttribute('opacity'))).toBe(1);
    expect($('[data-card="gravity#0"]')?.hasAttribute('data-link-pulse')).toBe(true);
    // Its tag is lit, the others dimmed.
    expect($('[data-tag="gravity#0"] rect')?.getAttribute('stroke-width')).toBe('1.5');
    expect($('[data-tag="drag#0"]')?.getAttribute('opacity')).toBe('0.35');
    leave($('[data-viewport-legend]'));
    expect(Number($('[data-force="curl"]')?.getAttribute('opacity'))).toBeGreaterThan(0.2);
  });

  it('hovering a tag does the same; hovering a control lights its entry', () => {
    fake();
    start('particles');
    enter($('[data-tag="drag#0"]'));
    expect($('[data-legend-entry="drag#0"]')?.hasAttribute('data-lit')).toBe(true);
    expect($('[data-kind-diagram]')?.getAttribute('data-card-hot')).toBe('drag#0');
    leave($('[data-tag="drag#0"]'));
    enter($('[data-card-slot="curl#0"]'));
    expect($('[data-legend-entry="curl#0"]')?.hasAttribute('data-lit')).toBe(true);
    expect($('[data-legend-entry="gravity#0"]')?.hasAttribute('data-lit')).toBe(false);
  });

  it('flocks: hovering View radius thickens the ring and lights its slider; pointing at the slider lights the entry', () => {
    fake();
    start('flock');
    expect(legendIds()).toEqual(['view', 'max']);
    enter($('[data-legend-entry="view"]'));
    expect($('[data-view-ring]')?.getAttribute('stroke-width')).toBe('3');
    expect($('[data-card="view"] [data-setting="radius"]')?.hasAttribute('data-link-pulse')).toBe(true);
    leave($('[data-viewport-legend]'));
    enter($('[data-setting="max"]'));
    expect($('[data-legend-entry="max"]')?.hasAttribute('data-lit')).toBe(true);
  });
});

describe('focus', () => {
  it('clicking an entry focuses it: other overlays fade, the inspector shows only its card with more words, a demo plays; Esc leaves (the builder stays)', () => {
    fake();
    start('particles');
    expect(raf).not.toHaveBeenCalled(); // no demo out of focus
    expect($('[data-focus-demo]')).toBeNull();
    click($('[data-legend-entry="gravity#0"]'));
    expect($('[data-inspector]')?.getAttribute('data-inspector-focus')).toBe('gravity#0');
    expect($$('[data-card-slot]').map(c => c.getAttribute('data-card-slot'))).toEqual(['gravity#0']);
    expect($('[data-card-add]')).toBeNull();
    expect($('[data-focus-intro] [data-focus-more]')?.textContent).toMatch(/same pull everywhere/);
    expect($('[data-focus-demo]')?.getAttribute('data-demo-kind')).toBe('gravity');
    expect(raf).toHaveBeenCalled();
    expect(Number($('[data-force="curl"]')?.getAttribute('opacity'))).toBeLessThan(0.2);
    esc();
    expect(closed).toBe(0);
    expect($('[data-focus-demo]')).toBeNull();
    expect(caf).toHaveBeenCalled(); // its frames stopped
    expect($('[data-inspector]')?.getAttribute('data-inspector-focus')).toBeNull();
    expect($$('[data-card-slot]').length).toBeGreaterThan(1);
    esc();
    expect(closed).toBe(1); // a second Esc closes the builder as before
  });

  it('a tag click focuses its entry; × leaves; picking a section leaves too', () => {
    fake();
    start('particles');
    click($('[data-tag="curl#0"]'));
    expect($('[data-focus-demo]')?.getAttribute('data-demo-kind')).toBe('curl');
    click($('[data-focus-close]'));
    expect($('[data-focus-demo]')).toBeNull();
    click($('[data-legend-entry="drag#0"]'));
    expect($('[data-focus-demo]')?.getAttribute('data-demo-kind')).toBe('drag');
    click($('[data-studio-section="moving"]'));
    expect($('[data-focus-demo]')).toBeNull();
  });

  it('flocks: focusing Keep apart plays the boids demo; View radius shows only its card', () => {
    fake();
    start('flock');
    click($('[data-studio-section="steering"]'));
    click($('[data-legend-entry="separate#0"]'));
    expect($('[data-focus-demo]')?.getAttribute('data-demo-kind')).toBe('flock');
    expect($$('[data-card-slot]').map(c => c.getAttribute('data-card-slot'))).toEqual(['separate#0']);
    click($('[data-legend-entry="view"]'));
    expect($('[data-focus-demo]')?.getAttribute('data-demo-kind')).toBe('view');
    expect($('[data-card="view"]')).toBeTruthy();
    expect($$('[data-card-slot]').length).toBe(0);
  });

  it('slime: Senses and Turning have their legend and focus demos', () => {
    fake();
    start('trail');
    expect(legendIds()).toEqual(['senses']);
    expect($('[data-viewport-legend] [data-legend-note]')?.textContent).toBe('One walker, up close.');
    click($('[data-legend-entry="senses"]'));
    expect($('[data-focus-demo]')?.getAttribute('data-demo-kind')).toBe('senses');
    click($('[data-studio-section="turning"]'));
    expect(legendIds()).toEqual(['turn', 'wobble']);
    click($('[data-tag="wobble"]'));
    expect($('[data-focus-demo]')?.getAttribute('data-demo-kind')).toBe('wander');
  });
});
