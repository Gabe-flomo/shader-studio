// @vitest-environment jsdom
/**
 * The Rules page after the Play audit (P11): a rule sent by others reads
 * "When ‹it› arrives · sent by …", Send a signal doesn't offer the rule
 * itself, Set / Nudge a control are in the Do list with no layers, and the
 * page shows what a rule is and behaviours to start from when it has none.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  const m = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); },
    key: () => null, get length() { return m.size; }, clear: () => m.clear(),
  });
  class RO { observe() {} unobserve() {} disconnect() {} }
  vi.stubGlobal('ResizeObserver', RO);
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: false, media: q, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false }));
});

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { RulesPage } from '../rules/RulesPage';
import { useNodeGraphStore } from '../../../store/useNodeGraphStore';
import { emptyPlayRecord, type PlayRecord } from '../../../types/play';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// No layers: the controls are the only thing a rule can move.
const record = (): PlayRecord => ({
  ...emptyPlayRecord(),
  controls: [{ id: 'c1', target: 'n1::radius', kind: 'float', label: 'Radius', min: 0, max: 1 }],
  signals: [
    { id: 'r1', name: 'Reached', do: [{ id: 'e1', do: 'signal', layerId: '', amount: 1, enabled: true, signal: 'r2' }] },
    { id: 'r2', name: 'Celebrate', do: [{ id: 'e2', do: 'ctlset', layerId: '', amount: 1, enabled: true, control: 'c1', value: 0.5 }] },
    { id: 'r3', name: 'Near', inputs: [{ kind: 'trigger', trigger: { on: 'key', code: 'Space' } }], do: [{ id: 'e3', do: 'signal', layerId: '', amount: 1, enabled: true, signal: 'r1' }] },
  ],
});

let root: Root | null = null;
let host: HTMLDivElement | null = null;
afterEach(() => { act(() => root?.unmount()); host?.remove(); root = null; host = null; });

function mount(play: PlayRecord, wide = true) {
  useNodeGraphStore.setState({ play });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(<RulesPage play={play} onChange={() => {}} wide={wide} />));
  return host;
}
const optionsOf = (el: HTMLElement, label: string) => [...(el.querySelector(`select[aria-label="${label}"]`) as HTMLSelectElement).options].map(o => o.textContent);

describe('Rules page (Play audit P11)', () => {
  it('a rule only others send reads "When ‹it› arrives · sent by …", in the card and the list', () => {
    const el = mount(record());
    const when = el.querySelector('[data-receiver]');
    expect(when?.textContent).toContain('Reached arrives');
    expect(when?.textContent).toContain('sent by Near');
    expect(el.textContent).not.toContain('Nothing yet: only a Test');
    expect(el.querySelector('[data-rule-row="r1"]')?.textContent).toContain('arrives from Near');
  });

  it('Send a signal doesn’t offer the rule itself', () => {
    const el = mount(record());
    // The first rule (Reached) is selected: its Send a signal lists the others.
    const signals = optionsOf(el, 'Signal');
    expect(signals).toContain('Celebrate');
    expect(signals).not.toContain('Reached');
  });

  it('Set a control and Nudge a control are in the Do list with no layers, with the control beside it', () => {
    const el = mount(record());
    act(() => (el.querySelector('[data-rule-row="r2"]') as HTMLElement).click());
    expect(optionsOf(el, 'Do')).toEqual(['Set a control', 'Nudge a control', 'Send a signal']);
    expect(optionsOf(el, 'Which control')).toEqual(['Radius']);
    expect(el.querySelector('[data-rule-row="r2"]')?.textContent).toContain('Set Radius to 0.5');
  });

  it('with no rules, the other half says what a rule is and offers behaviours to start from', () => {
    const el = mount({ ...emptyPlayRecord(), controls: record().controls });
    const start = el.querySelector('[data-rules-start]');
    expect(start).toBeTruthy();
    expect(start?.textContent).toContain('When');
    expect(el.querySelectorAll('[data-behaviour-idea]').length).toBeGreaterThan(0);
    act(() => (el.querySelector('[data-behaviour-idea]') as HTMLButtonElement).click());
    // The library opens on it, picked.
    expect(document.querySelector('[data-behaviour][aria-pressed="true"]')).toBeTruthy();
  });
});
