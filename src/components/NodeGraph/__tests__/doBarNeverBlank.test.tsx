// @vitest-environment jsdom
/**
 * The Do… bar must never take the app down while you type (the language pressure test found
 * `create palette` blanking the page): the crash case typed letter by letter keeps the bar up; a
 * reading that throws shows "couldn't read this line"; a render that throws is caught by the bar's
 * error boundary and leaves a note, not a blank app.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} });
});

const boom = vi.hoisted(() => ({ parse: false, render: false }));
vi.mock('../../../suggestions/doBar', async importOriginal => {
  const real = await importOriginal<typeof import('../../../suggestions/doBar')>();
  return { ...real, parseDo: (...a: Parameters<typeof real.parseDo>) => { if (boom.parse) throw new Error('parser blew up'); return real.parseDo(...a); } };
});
vi.mock('../../../lang/highlight', async importOriginal => {
  const real = await importOriginal<typeof import('../../../lang/highlight')>();
  return { ...real, wordKindFor: (...a: Parameters<typeof real.wordKindFor>) => { if (boom.render) throw new Error('render blew up'); return real.wordKindFor(...a); } };
});

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useNodeGraphStore } from '../../../store/useNodeGraphStore';
import { DoBar } from '../DoBar';
import { openDoBar, closeDoBar } from '../../../suggestions/doBarStore';
import { n } from '../../../store/graphBuilder';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext'];

let root: Root | null = null;
let host: HTMLElement | null = null;
function open(text: string) {
  act(() => { closeDoBar(); });
  act(() => { openDoBar({ text }); });
  if (!root) {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => root!.render(<DoBar />));
  }
}
/** Type into the open bar as a person does (React's onChange needs the native setter). */
function type(text: string) {
  const el = document.body.querySelector('[data-do-input]') as HTMLInputElement;
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => { set.call(el, text); el.dispatchEvent(new Event('input', { bubbles: true })); });
}
const $ = (sel: string) => document.body.querySelector(sel);

let errors: { mock: { calls: unknown[][] }; mockRestore: () => void };
beforeEach(() => {
  boom.parse = false; boom.render = false;
  errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  // `create time` on an empty graph: Time selected and on the Output (the pressure test's crash).
  useNodeGraphStore.setState({
    nodes: [n('time', 'time', 0, 0), n('output', 'o', 400, 0, {}, { color: ['time', 'time'] })],
    activeGroupPath: [], selectedNodeId: 'time', selectedNodeIds: ['time'],
  });
});
afterEach(() => { act(() => { closeDoBar(); root?.unmount(); }); root = null; host?.remove(); host = null; errors.mockRestore(); });

describe('the Do… bar never blanks the app', () => {
  for (const line of ['create palette', 'create crt-screen']) {
    it(`typing “${line}” letter by letter with Time selected keeps the bar up`, () => {
      open('');
      for (let i = 1; i <= line.length; i++) {
        type(line.slice(0, i));
        expect($('[data-do-input]'), `after “${line.slice(0, i)}”`).toBeTruthy();
        expect($('[data-do-crashed]')).toBeNull();
        expect($('[data-do-read-error]'), `after “${line.slice(0, i)}”`).toBeNull();
      }
      expect(($('[data-do-input]') as HTMLInputElement).value).toBe(line);
    });
  }

  it('a reading that throws shows “couldn’t read this line” and logs it', () => {
    open('');
    boom.parse = true;
    type('circle with a glow');
    expect($('[data-do-input]')).toBeTruthy();
    expect($('[data-do-read-error]')?.textContent).toMatch(/Couldn’t read this line/);
    expect(errors.mock.calls.some((c: unknown[]) => String(c[0]).includes('Do… bar: the phrase reader threw'))).toBe(true);
    // Fixed words read again.
    boom.parse = false;
    type('circle with a glow, falloff 8');
    expect($('[data-do-read-error]')).toBeNull();
  });

  it('a throw while the bar renders is caught by its boundary: a note, not a blank app', () => {
    open('');
    boom.render = true;
    type('circle with a glow');
    expect($('[data-do-crashed]')?.textContent).toMatch(/couldn’t read this line/);
    expect(host!.isConnected).toBe(true);
    // A new line starts a fresh bar.
    boom.render = false;
    act(() => { openDoBar(); });
    expect($('[data-do-crashed]')).toBeNull();
    expect($('[data-do-input]')).toBeTruthy();
  });
});
