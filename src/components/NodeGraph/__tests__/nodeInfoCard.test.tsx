// @vitest-environment jsdom
/**
 * The node info card (NodeInfoCard.tsx): a long definition (Segment) leads with a summary, its
 * sections fold with counts (first open, the rest folded, remembered per section), rows are one
 * line that open to the full text and a select's choices, settings keep their card sections, and
 * a filter narrows everything. A small node gets no filter.
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

import { act, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NODE_REGISTRY } from '../../../nodes/definitions';
import { useSectionFold } from '../../../builders/sectionFold';
import { NodeInfoBody, NodeInfoCard, nodeInfoEntries, whenText, FILTER_THRESHOLD } from '../NodeInfoCard';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  useSectionFold.setState({ open: {} });
});
afterEach(() => { act(() => root.unmount()); host.remove(); document.body.innerHTML = ''; });

const segment = NODE_REGISTRY.segment;
const q = <T extends Element = HTMLElement>(sel: string) => document.querySelector<T>(sel);
const qa = (sel: string) => [...document.querySelectorAll<HTMLElement>(sel)];
const click = (el: Element | null) => act(() => { (el as HTMLElement).click(); });
const sectionButton = (id: string) => q(`[data-info-section="${id}"] > button`);

describe('NodeInfoCard', () => {
  it('leads with the summary; the rest of the description is behind More', () => {
    act(() => root.render(<NodeInfoBody def={segment} />));
    const summary = q('[data-doc-summary]')!;
    expect(summary.textContent).toContain('Cuts people, objects, or whatever you click out of a picture or video as a mask');
    expect(summary.textContent).not.toContain('People finds everyone');
    click(q('[data-doc-more]'));
    expect(q('[data-doc-summary]')!.textContent).toContain('People finds everyone');
    expect(q('[data-doc-more]')!.getAttribute('aria-expanded')).toBe('true');
  });

  it('opens the first section, folds the rest with counts and names, and remembers a choice per section', () => {
    act(() => root.render(<NodeInfoBody def={segment} />));
    const { inputs, outputs, settings } = nodeInfoEntries(segment);
    expect(sectionButton('inputs')!.getAttribute('aria-expanded')).toBe('true');
    expect(sectionButton('outputs')!.getAttribute('aria-expanded')).toBe('false');
    expect(sectionButton('settings')!.getAttribute('aria-expanded')).toBe('false');
    expect(sectionButton('settings')!.textContent).toContain(String(settings.length));
    expect(sectionButton('outputs')!.textContent).toContain(String(outputs.length));
    expect(sectionButton('outputs')!.textContent).toContain('Mask, Cut-out');
    expect(qa('[data-info-section="inputs"] [data-doc-row]').length).toBe(inputs.length);
    expect(qa('[data-info-section="settings"] [data-doc-row]').length).toBe(0);
    click(sectionButton('settings'));
    expect(useSectionFold.getState().open['node-info:settings']).toBe(true);
    // Another card opens with Settings open too.
    act(() => root.render(<NodeInfoBody key="again" def={NODE_REGISTRY.segment} />));
    expect(sectionButton('settings')!.getAttribute('aria-expanded')).toBe('true');
  });

  it('keeps every entry reachable: rows are one line that open to the full text', () => {
    useSectionFold.setState({ open: { 'node-info:settings': true, 'node-info:outputs': true } });
    act(() => root.render(<NodeInfoBody def={segment} />));
    const all = Object.keys(segment.inputs).length + Object.keys(segment.outputs).length;
    expect(qa('[data-doc-row]').length).toBeGreaterThan(all);
    const row = q('[data-doc-row="threshold"]')!;
    const btn = row.querySelector('button')!;
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    expect(btn.getAttribute('title')).toBe(segment.inputs.threshold.hint);
    expect(row.querySelector('[data-doc-line]')!.textContent).toBe(segment.inputs.threshold.hint);
    expect(row.querySelector('[data-doc-chip]')!.textContent).toBe('float 0 – 1');
    click(btn);
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    expect(row.querySelector('[data-doc-detail]')!.textContent).toContain(segment.inputs.threshold.hint);
  });

  it('shows a select\'s choices as chips, when a setting shows, and settings in their card sections', () => {
    useSectionFold.setState({ open: { 'node-info:settings': true } });
    act(() => root.render(<NodeInfoBody def={segment} />));
    expect(qa('[data-settings-group]').map(g => g.dataset.settingsGroup)).toEqual(['Find', 'Mask']);
    const find = q('[data-doc-row="mode"]')!;
    expect(find.querySelector('[data-doc-chip]')!.textContent).toBe('3 choices');
    click(find.querySelector('button'));
    expect([...find.querySelectorAll('[data-doc-options] span')].map(s => s.textContent)).toEqual(['People', 'Objects', 'Click (pick a point)']);
    const px = q('[data-doc-row="pointX"]')!;
    click(px.querySelector('button'));
    expect(px.textContent).toContain('Shown when Find is Click (pick a point).');
  });

  it('filters every section at once when there are many entries', () => {
    act(() => root.render(<NodeInfoBody def={segment} />));
    const input = q<HTMLInputElement>('[data-node-info-filter]')!;
    expect(input).toBeTruthy();
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    act(() => { setter.call(input, 'edge'); input.dispatchEvent(new Event('input', { bubbles: true })); });
    const keys = qa('[data-doc-row]').map(r => r.dataset.docRow);
    expect(keys).toContain('edge');      // an output
    expect(keys).toContain('refine');    // a setting (Edge refine), from a folded section
    expect(keys).not.toContain('uv');
    act(() => { setter.call(input, 'zzzz'); input.dispatchEvent(new Event('input', { bubbles: true })); });
    expect(q('[data-node-info-empty]')).toBeTruthy();
  });

  it('a small node has no filter', () => {
    const small = Object.values(NODE_REGISTRY).find(d => {
      const e = nodeInfoEntries(d);
      return !d.brief && e.inputs.length + e.outputs.length + e.settings.length <= 3 && e.inputs.length > 0;
    })!;
    act(() => root.render(<NodeInfoBody def={small} />));
    expect(q('[data-node-info-filter]')).toBeNull();
    // Nothing worth folding: every section shows, even one folded on a long card.
    useSectionFold.setState({ open: { 'node-info:inputs': false, 'node-info:outputs': false } });
    expect(qa('[data-info-section] > button').every(b => b.getAttribute('aria-expanded') === 'true')).toBe(true);
    expect(nodeInfoEntries(small).inputs.length).toBeLessThanOrEqual(FILTER_THRESHOLD);
  });

  it('pops up as a dialog with a close button, closing on Esc', () => {
    const anchor = createRef<HTMLButtonElement>();
    const onClose = vi.fn();
    act(() => root.render(<><button ref={anchor}>i</button><NodeInfoCard def={segment} anchorRef={anchor} onClose={onClose} /></>));
    const dialog = q('[role="dialog"][data-node-info="segment"]')!;
    expect(dialog.getAttribute('aria-label')).toBe('Segment: node info');
    expect(dialog.closest('[data-popover]')).toBeTruthy();
    click(q('[aria-label="Close node info"]'));
    expect(onClose).toHaveBeenCalledTimes(1);
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});

describe('whenText', () => {
  it('names the other setting and its choice', () => {
    expect(whenText({ param: 'update', value: 'every' }, segment.paramDefs)).toBe('Shown when Update is Every Nth frame.');
    expect(whenText(undefined, segment.paramDefs)).toBeUndefined();
  });
});
