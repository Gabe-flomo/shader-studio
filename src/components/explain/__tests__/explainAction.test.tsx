// @vitest-environment jsdom
/**
 * Explain is always the model (docs/explain-model.md): an Expression Block line has one Explain action, and with no
 * model downloaded (or the model turned off) pressing it offers the download, with its size and what it is, instead
 * of any rule-based wording. A block's answer lists the lines first and the summary of the whole block last.
 * No model is downloaded or loaded here.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  const mem = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v); }, removeItem: (k: string) => { mem.delete(k); }, key: () => null, length: 0, clear: () => mem.clear() });
});
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ExplainMore } from '../ExplainMore';
import { ExplainRow } from '../ExplainRow';
import { AnswerBody } from '../ExplainAnswer';
import { viewAnswer } from '../../../explainModel/assess';
import { EXPLAIN_MODEL, downloadBytes, formatBytes } from '../../../explainModel/config';
import { useExplainModel } from '../../../explainModel/client';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mounted: Array<{ root: Root; host: HTMLElement }> = [];
function mount(ui: React.ReactElement): HTMLElement {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(ui));
  mounted.push({ root, host });
  return host;
}
const click = (el: Element | null) => { expect(el).toBeTruthy(); act(() => { (el as HTMLElement).click(); }); };

beforeEach(() => {
  useExplainModel.setState({ enabled: false, downloaded: false, downloadedIds: [], activeId: EXPLAIN_MODEL.id, loadedId: null, busyId: null, status: 'idle', progress: null, error: null });
});
afterEach(() => {
  for (const x of mounted.splice(0)) { act(() => x.root.unmount()); x.host.remove(); }
});

describe('the Explain action without a model', () => {
  it('a line offers the download, with its size and what it is, and no rule-based wording', () => {
    const host = mount(<ExplainMore text="float g = exp(-d * 4.0)" />);
    const btn = host.querySelector('[data-explain-action="explain"]');
    expect(btn?.textContent).toBe('Explain');
    click(btn);
    const offer = host.querySelector('[data-explain-offer]');
    expect(offer).toBeTruthy();
    const size = formatBytes(downloadBytes('webgpu', EXPLAIN_MODEL));
    expect(offer!.textContent).toContain('Explain uses a language model that runs on this device.');
    expect(offer!.textContent).toContain(`A one-time download of ${size}`);
    expect(offer!.textContent).toContain(EXPLAIN_MODEL.name);
    expect(offer!.textContent).toMatch(/your code never leaves this device/);
    expect(host.querySelector('[data-explain-action="download-model"]')?.textContent).toContain(`Download ${size} and explain`);
    // Nothing was explained by rules instead
    expect(host.textContent).not.toMatch(/glow|fading|First,|Step by step/i);
  });

  it('a downloaded model that is turned off offers to turn it on', () => {
    useExplainModel.setState({ enabled: false, downloaded: true, downloadedIds: [EXPLAIN_MODEL.id] });
    const host = mount(<ExplainMore mode="block" text={'float g = exp(-d * 4.0)\nreturn g'} />);
    const btn = host.querySelector('[data-explain-action="explain"]');
    expect(btn?.textContent).toBe('Explain the block');
    click(btn);
    expect(host.querySelector('[data-explain-offer]')?.textContent).toContain('The explanation model is off.');
    expect(host.querySelector('[data-explain-action="download-model"]')?.textContent).toContain('Turn it on');
  });

  it('an Expression Block line row leads with Explain, not a rule-based sentence; its working stays folded', () => {
    const host = mount(<ExplainRow text="float g = exp(-d * 4.0)" exprStart={10} ctx={{ types: { d: 'float' } }} where="line 1 of 2" />);
    expect(host.querySelector('[data-explain-action="explain"]')?.textContent).toBe('Explain');
    expect(host.querySelector('[data-explain-summary]')).toBeNull();
    expect(host.textContent).not.toMatch(/glow|fading/i);
    expect(host.querySelector('[data-explain-view]')).toBeNull();
    click(host.querySelector('[data-explain-toggle]'));
    expect(host.querySelector('[data-explain-view]')).toBeTruthy();
    // The working never offers the removed "Explain these steps"
    expect(host.textContent).not.toContain('Explain these steps');
  });
});

describe('a block’s answer', () => {
  it('shows each line, then the summary of the whole block last', () => {
    const raw = '{"line":1,"what":"A soft falloff.","effect":"A glow.","sure":"high","unsure_about":""}\n{"line":2,"what":"Returns it.","effect":"The glow is the output.","sure":"high","unsure_about":""}\n{"summary":"Makes a soft glow around the shape."}';
    const view = viewAnswer({ kind: 'block', raw, done: true });
    const host = mount(<AnswerBody view={view} mode="block" />);
    const text = host.textContent ?? '';
    expect(text.indexOf('Returns it.')).toBeLessThan(text.indexOf('Makes a soft glow'));
    expect(host.querySelector('[data-explain-summary-all]')?.textContent).toBe('AltogetherMakes a soft glow around the shape.');
  });
});
