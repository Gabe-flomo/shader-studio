// @vitest-environment jsdom
/**
 * Muting in the Agent Builder, drawn (docs/agent-builder.md, "Muting"): a card's mute (the shared
 * MuteToggle) switches its rule off, says Muted and dims; Alt-click solos it in its section; a mute
 * is one undo step and is still there when the builder is opened again.
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
import { groupRules } from '../../../agentRules/apply';
import { AgentBuilder } from '../AgentBuilder';

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
const click = (el: Element | null, init: MouseEventInit = {}) => {
  expect(el).toBeTruthy();
  act(() => { el!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ...init })); });
};
const group = () => useNodeGraphStore.getState().nodes.find(n => n.type === 'agentsGroup');
const settle = () => act(() => { vi.advanceTimersByTime(300); });
const offOf = (kind: string) => groupRules(group()!).species[0].rules.find(r => r.do.some(a => a.kind === kind))?.off;
const mute = (key: string) => $(`[data-card-switch="${key}"] [data-mute-toggle]`);

beforeEach(() => {
  localStorage.clear();
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 });
  useNodeGraphStore.setState({ nodes: [], activeGroupPath: [], selectedNodeId: null, selectedNodeIds: [] });
  useBuilderWindows.setState({ gridRules: null, agentRules: null, agentBuilder: null, recipe: null });
});

describe('agent builder: muting a card', () => {
  it('mutes a card (its rule off, Muted, dimmed); undo brings it back; it survives reopening', () => {
    vi.useFakeTimers();
    mount(<AgentBuilder groupId={null} onClose={() => {}} />);
    click($('[data-start-kind="flock"]'));
    settle();
    click($('[data-studio-section="steering"]'));
    const cohere = () => groupRules(group()!).species[0].rules.flatMap(r => r.do).find(a => a.kind === 'cohere');
    const before = cohere();
    expect(mute('cohere#0')?.getAttribute('aria-pressed')).toBe('false');
    click(mute('cohere#0'));
    expect(mute('cohere#0')?.getAttribute('aria-pressed')).toBe('true');
    expect($('[data-card="cohere#0"]')?.getAttribute('data-muted')).toBe('true');
    expect($('[data-card="cohere#0"] [data-muted-tag]')).toBeTruthy();
    settle();
    expect(offOf('cohere')).toBe(true);
    // Its settings are kept.
    expect(cohere()).toEqual(before);
    // Reopen: still muted.
    const id = group()!.id;
    unmountAll();
    mount(<AgentBuilder groupId={id} onClose={() => {}} />);
    click($('[data-studio-section="steering"]'));
    expect(mute('cohere#0')?.getAttribute('aria-pressed')).toBe('true');
    // One undo step.
    act(() => { useNodeGraphStore.getState().undo(); });
    expect(offOf('cohere')).toBeUndefined();
    expect(mute('cohere#0')?.getAttribute('aria-pressed')).toBe('false');
  });

  it('Alt-click solos a card in its section; Alt-click again turns them all back on', () => {
    vi.useFakeTimers();
    mount(<AgentBuilder groupId={null} onClose={() => {}} />);
    click($('[data-start-kind="flock"]'));
    settle();
    click($('[data-studio-section="steering"]'));
    click(mute('match#0'), { altKey: true });
    const pressed = () => ['separate#0', 'match#0', 'cohere#0', 'wobble#0'].map(k => mute(k)?.getAttribute('aria-pressed'));
    expect(pressed()).toEqual(['true', 'false', 'true', 'true']);
    settle();
    expect(offOf('separate')).toBe(true);
    expect(offOf('match')).toBeUndefined();
    click(mute('match#0'), { altKey: true });
    expect(pressed()).toEqual(['false', 'false', 'false', 'false']);
    expect($$('[data-muted-tag]').length).toBe(0);
  });
});
