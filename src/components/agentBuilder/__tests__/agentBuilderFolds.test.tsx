// @vitest-environment jsdom
/**
 * The Agent Builder's cards fold to one line (agentBuilder/cardFolds.ts): a section's first card open,
 * the rest folded with their summary, remembered per section and card, Open all / Fold all, a card just
 * added opens.
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
import { useCardFolds } from '../../../agentBuilder/cardFolds';
import { useBuilderWindows } from '../../../builders/windows';
import { AgentBuilder } from '../AgentBuilder';
import { cardSummary } from '../SectionCards';
import { directionWord } from '../../../agentBuilder/cardFolds';
import type { CardRead } from '../../../agentBuilder/behaviours';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext'];
Element.prototype.getBoundingClientRect = function () { return { x: 0, y: 0, left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, toJSON: () => ({}) } as DOMRect; };

const mounted: Array<{ root: Root; host: HTMLElement }> = [];
function mount(ui: React.ReactElement) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(ui));
  mounted.push({ root, host });
}
const unmountAll = () => { for (const m of mounted.splice(0)) { act(() => m.root.unmount()); m.host.remove(); } };
afterEach(() => { unmountAll(); vi.useRealTimers(); });
const $ = (sel: string) => document.body.querySelector(sel);
const $$ = (sel: string) => [...document.body.querySelectorAll(sel)];
const click = (el: Element | null) => { expect(el).toBeTruthy(); act(() => { (el as HTMLElement).click(); }); };
const group = () => useNodeGraphStore.getState().nodes.find(n => n.type === 'agentsGroup');

beforeEach(() => {
  localStorage.clear();
  useCardFolds.setState({ open: {} });
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 });
  useNodeGraphStore.setState({ nodes: [], activeGroupPath: [], selectedNodeId: null, selectedNodeIds: [] });
  useBuilderWindows.setState({ gridRules: null, agentRules: null, agentBuilder: null, recipe: null });
});

function start(kind: string) {
  mount(<AgentBuilder groupId={null} onClose={() => {}} />);
  click($(`[data-start-kind="${kind}"]`));
  return group()!;
}
const folded = () => $$('[data-card-folded]').map(c => `${c.getAttribute('data-card')}:${c.getAttribute('data-card-folded')}`);

describe('folding cards', () => {
  it('Forces opens with its first card open and the others folded to one line', () => {
    start('particles');
    const f = folded();
    expect(f.length).toBeGreaterThan(1);
    expect(f[0]).toBe('gravity#0:false');
    expect(f.slice(1).every(x => x.endsWith(':true'))).toBe(true);
    // A folded card: its head and its summary, no settings.
    const drag = $('[data-card="drag#0"]')!;
    expect(drag.querySelector('[data-setting]')).toBeNull();
    expect(drag.querySelector('[data-card-summary]')?.textContent).toMatch(/^· [\d.]+ \/s$/);
    expect($('[data-card="gravity#0"] [data-card-summary]')?.textContent).toMatch(/^[\d.]+ down$/);
    expect($('[data-card="gravity#0"] [data-setting="strength"]')).toBeTruthy();
  });

  it('a card opens and folds from its chevron, and stays so when the builder opens again', () => {
    start('particles');
    click($('[data-card-fold="drag#0"]'));
    expect($('[data-card="drag#0"] [data-setting="drag"]')).toBeTruthy();
    click($('[data-card-fold="gravity#0"]'));
    expect($('[data-card="gravity#0"]')?.getAttribute('data-card-folded')).toBe('true');
    const id = group()!.id;
    unmountAll();
    mount(<AgentBuilder groupId={id} onClose={() => {}} />);
    expect($('[data-card="drag#0"]')?.getAttribute('data-card-folded')).toBe('false');
    expect($('[data-card="gravity#0"]')?.getAttribute('data-card-folded')).toBe('true');
  });

  it('Open all and Fold all; Life\'s cards start folded under Lives for', () => {
    start('particles');
    click($('[data-card-folds-all="open"]'));
    expect(folded().every(x => x.endsWith(':false'))).toBe(true);
    click($('[data-card-folds-all="fold"]'));
    expect(folded().every(x => x.endsWith(':true'))).toBe(true);
    click($('[data-studio-section="life"]'));
    expect($('[data-card="lives"] [data-setting="life"]')).toBeTruthy();
    expect(folded().length).toBeGreaterThan(0);
    expect(folded().every(x => x.endsWith(':true'))).toBe(true);
  });

  it('a card just added opens', () => {
    start('particles');
    const add = $('[data-card-add]');
    const id = add!.getAttribute('data-card-add');
    click(add);
    expect($(`[data-card="${id}#0"]`)?.getAttribute('data-card-folded')).toBe('false');
  });

  it('summaries say what the card does with its key numbers', () => {
    const card = (action: unknown): CardRead => ({ card: 'gravity', key: 'gravity#0', at: { rule: 0, action: 0 }, action: action as CardRead['action'], on: true, when: null });
    expect(cardSummary(card({ kind: 'force', field: 'gravity', strength: 0.4, angle: -90 }))).toBe('0.4 down');
    expect(cardSummary(card({ kind: 'force', field: 'wind', strength: 1, angle: 30 }))).toBe('1 at 30°');
    expect(cardSummary(card({ kind: 'drag', amount: 2 }))).toBe('2 /s');
    expect([90, 0, 180, -180, 270, 45].map(directionWord)).toEqual(['up', 'right', 'left', 'left', 'down', 'at 45°']);
  });
});
