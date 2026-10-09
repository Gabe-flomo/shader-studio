// @vitest-environment jsdom
/**
 * The Expression Builder window, drawn (docs/expression-builder.md): it opens from the Builders
 * section on UV, shows the grid with same-type moves open and the others folded with a summary,
 * each tile with its "used in"; picking a move adds a chain row; clicking a row goes back to it
 * (the rows after it kept, dimmed) and picking the same move walks forward again; a tile's
 * sliders tune it before picking; Add to graph makes the Expression Block with the seed wired.
 *
 * The renders are stubbed (no WebGL here): exprPictures returns a flat field per row.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  const m = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); },
    key: () => null, get length() { return m.size; }, clear: () => m.clear(),
  });
});

const rendered = vi.hoisted(() => ({ calls: [] as Array<{ upTo: number; rows: Array<{ key: string; expr: string }> }> }));
vi.mock('../exprPictures', async importOriginal => {
  const real = await importOriginal<typeof import('../exprPictures')>();
  return {
    ...real,
    renderChainRows: async (_chain: unknown, upTo: number, rows: Array<{ key: string; expr: string }>) => {
      rendered.calls.push({ upTo, rows: rows.map(r => ({ key: r.key, expr: r.expr })) });
      return new Map(rows.map(r => [r.key, { data: new Float32Array(4 * 4 * 4).map((_, i) => (i % 4 === 3 ? 1 : (i % 7) / 7)), w: 4, h: 4 }]));
    },
  };
});

const jumps = vi.hoisted(() => ({ calls: [] as unknown[] }));
vi.mock('../../../codeExplorer/jumpRun', () => ({ jumpToSource: async (p: unknown) => { jumps.calls.push(p); } }));
vi.mock('../../explain/FindUsesDialog', () => ({
  FindUsesDialog: ({ query, title }: { query: { pattern?: string }; title: string }) => <div data-test-find-uses={query.pattern}>{title}</div>,
}));

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import raw from '../../../exprBuilder/prebuilt/moves.json?raw';
import { unpackCatalogue, type PackedCatalogue } from '../../../exprBuilder/pack';
import { setBuilderCatalogue } from '../../../exprBuilder/catalogueSource';
import { useExprBuilder } from '../../../exprBuilder/store';
import { useNodeGraphStore } from '../../../store/useNodeGraphStore';
import { BuildersSection } from '../../builders/BuildersSection';
import { ExpressionBuilderModal } from '../ExpressionBuilderModal';
import { chainOfBlock, previewGraph } from '../../../exprBuilder/block';
import { compileGraph } from '../../../compiler/graphCompiler';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext'];
// A desktop-wide window: the chain and preview are side panels, not drawers.
Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1600 });

const mounted: Array<{ root: Root; host: HTMLElement }> = [];
function mount(ui: React.ReactElement) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(ui));
  mounted.push({ root, host });
  return host;
}
afterEach(() => { for (const m of mounted.splice(0)) { act(() => m.root.unmount()); m.host.remove(); } });
const click = (el: Element | null | undefined) => { expect(el).toBeTruthy(); act(() => { (el as HTMLElement).click(); }); };
const $ = (sel: string) => document.body.querySelector(sel);
const $$ = (sel: string) => [...document.body.querySelectorAll(sel)];
/** Let the catalogue promise and the pictures' debounce settle. */
const settle = async (ms = 320) => { await act(async () => { await new Promise(r => setTimeout(r, ms)); }); };
const tile = (template: string) => $$('[data-xb-tile]').find(t => t.querySelector('code')?.textContent === template);
const pick = (template: string) => click(tile(template)?.querySelector('[data-xb-pick]'));
const rows = () => $$('[data-xb-step]').map(r => ({ i: r.getAttribute('data-xb-step'), ahead: r.hasAttribute('data-ahead'), text: r.querySelector('code')?.textContent }));

beforeAll(() => setBuilderCatalogue(unpackCatalogue(JSON.parse(raw) as PackedCatalogue)));
beforeEach(() => {
  localStorage.clear();
  rendered.calls.length = 0;
  useNodeGraphStore.setState({ nodes: [], activeGroupPath: [], selectedNodeId: null, selectedNodeIds: [] });
  useExprBuilder.setState({ open: false });
});

describe('the Expression Builder window', () => {
  it('opens from the Builders section on UV, with the grid grouped and folded', async () => {
    const host = mount(<BuildersSection />);
    click(host.querySelector('[data-builder="expr"]'));
    expect(useExprBuilder.getState().open).toBe(true);
    mount(<ExpressionBuilderModal />);
    // The catalogue, the dull filter's slices, then the pictures' debounce
    await settle();
    await settle();
    await settle();
    expect($('[role="dialog"]')?.textContent).toContain('Expression Builder');
    expect($$('[data-builder-tab]').map(t => t.textContent)).toEqual(['Next moves', 'Seed', 'Code']);
    // Same type open (the primary section); the others folded with a summary
    expect($('[data-xb-section="same"]')?.hasAttribute('data-open')).toBe(true);
    expect($('[data-xb-section="changing"]')?.hasAttribute('data-open')).toBe(false);
    expect($('[data-xb-section="changing"] [data-xb-summary]')?.textContent).toMatch(/moves:/);
    expect($('[data-xb-section="recipes"] [data-xb-summary]')?.textContent).toMatch(/moves:/);
    expect($$('[data-xb-section="same"] [data-xb-tile]').length).toBe(12);
    // Each tile: its picture (the stubbed render), its template and where it was used
    expect($$('[data-xb-section="same"] [data-xb-tile] canvas').length).toBe(12);
    expect(tile('x * #a')?.querySelector('[data-xb-sources]')?.textContent).toMatch(/^used in: .+/);
    // The empty chain's help, with the worked example
    expect($('[data-builder-help="empty:empty-chain"]')?.textContent).toMatch(/UV → Repeat → Centre → Circle/);
    // The renders asked for were the tiles applied to the seed
    expect(rendered.calls.some(c => c.rows.some(r => r.expr === 'uv * 2.0'))).toBe(true);
  });

  it('pick a move, go back to a step, walk forward, then add to graph', async () => {
    useExprBuilder.getState().openWith();
    mount(<ExpressionBuilderModal />);
    await settle();
    pick('x * #a');
    pick('fract(x)');
    click($('[data-xb-section="changing"] button'));
    await settle(10);
    pick('length(x)');
    await settle();
    expect(rows().map(r => r.text)).toEqual(['uv', 's1 = uv * 2.0', 's2 = fract(s1)', 's3 = length(s2)']);
    expect($('[role="dialog"]')?.textContent).toContain('UV → zoom → repeat → distance · float');

    // Back to step 1: steps 2 and 3 stay, dimmed; the grid is for a vec2 again
    click($('[data-xb-step="1"]'));
    expect(rows().filter(r => r.ahead).map(r => r.i)).toEqual(['2', '3']);
    expect(useExprBuilder.getState().at).toBe(1);
    // Picking the same move walks forward onto the kept step
    pick('fract(x)');
    expect(useExprBuilder.getState().at).toBe(2);
    expect(rows().filter(r => r.ahead).map(r => r.i)).toEqual(['3']);
    // Picking another one replaces the rest
    click($('[data-xb-step="2"]'));
    expect(useExprBuilder.getState().chain.steps).toHaveLength(3);
    await settle(10);
    const other = $$('[data-xb-section="same"] [data-xb-tile]:not([data-broken]) code').map(c => c.textContent!).find(t => t !== 'length(x)' && t !== 'x * #a')!;
    pick(other);
    expect(useExprBuilder.getState().chain.steps.map(s => s.template)).toEqual(['x * #a', 'fract(x)', other]);
    expect(rows().some(r => r.ahead)).toBe(false);

    // Tune step 1 afterwards: its slider is in the chain
    click($('[data-xb-tune-step="0"]'));
    expect($('[data-xb-sliders="Step 1"]')).toBeTruthy();
    act(() => useExprBuilder.getState().setHole(0, '#a', 4));
    expect(rows()[1].text).toBe('s1 = uv * 4.0');

    // Add to graph: a UV node wired into the Expression Block, the chain on it
    click($('[data-xb-add]'));
    const nodes = useNodeGraphStore.getState().nodes;
    expect(nodes.map(n => n.type)).toEqual(['uv', 'exprNode']);
    const block = nodes[1];
    expect(block.inputs.uv.connection).toEqual({ nodeId: nodes[0].id, outputKey: 'uv' });
    expect(block.params.outputType).toBe(useExprBuilder.getState().chain.steps[2].sig.out);
    expect(block.params.s1_a).toBe(4);
    expect(chainOfBlock(block)?.steps.map(s => s.template)).toEqual(['x * #a', 'fract(x)', other]);
    // It compiles, as the block the preview drew (with an Output to compile against)
    const pv = previewGraph(chainOfBlock(block)!);
    expect(pv.nodes.find(n => n.id === pv.blockId)!.params.lines).toEqual(block.params.lines);
    expect(compileGraph({ nodes: pv.nodes }).success).toBe(true);
    expect(useExprBuilder.getState().open).toBe(false);
  });

  it('a tile\'s sliders tune it before it is picked', async () => {
    useExprBuilder.getState().openWith();
    mount(<ExpressionBuilderModal />);
    await settle();
    const t = tile('x * #a')!;
    click(t.querySelector('[data-xb-tune]'));
    expect(t.querySelector('[data-xb-sliders]')).toBeTruthy();
    act(() => useExprBuilder.getState().setDraft(t.getAttribute('data-xb-tile')!, '0:#a', 7));
    await settle();
    expect(rendered.calls.some(c => c.rows.some(r => r.expr === 'uv * 7.0'))).toBe(true);
    pick('x * #a');
    expect(useExprBuilder.getState().chain.steps[0].holes[0]).toMatchObject({ kind: 'number', value: 7 });
  });

  it('the worked example builds the grid of dots; the Seed and Code tabs', async () => {
    useExprBuilder.getState().openWith();
    mount(<ExpressionBuilderModal />);
    await settle();
    click($('[data-builder-help="empty:empty-chain"] [data-help-example]'));
    expect(useExprBuilder.getState().chain.steps.map(s => s.template)).toEqual(['fract(x * #a)', 'x - #a', 'length(x)']);
    click($('[data-builder-tab="code"]'));
    expect($('[data-xb-code]')?.textContent).toMatch(/vec2 s1 = fract\(uv \* s1_a\)[^\n]*\n.*vec2 s2 = s1 - s2_a[^\n]*\nfloat s3 = length\(s2\)[^\n]*\nreturn s3; \/\/ float/);
    click($('[data-builder-tab="seed"]'));
    click($('[data-xb-seed="time"] button'));
    expect(useExprBuilder.getState().chain).toMatchObject({ seed: { kind: 'time', type: 'float' }, steps: [] });
  });

  it('hides dull moves behind "Show hidden (n)", and shows why', async () => {
    useExprBuilder.getState().openWith();
    mount(<ExpressionBuilderModal />);
    await settle(); await settle(); await settle();
    const btn = $('[data-xb-show-hidden="same"]');
    expect(btn?.textContent).toMatch(/^Show hidden \(\d+\)$/);
    const n = Number(/\((\d+)\)/.exec(btn!.textContent!)![1]);
    expect(n).toBeGreaterThan(0);
    expect($('[data-xb-grid="hidden"]')).toBeNull();
    click(btn);
    const hidden = $$('[data-xb-grid="hidden"] [data-xb-tile]');
    expect(hidden.length).toBe(n);
    expect(hidden.every(t => t.hasAttribute('data-dull'))).toBe(true);
    expect(hidden[0].querySelector('[data-xb-reason]')?.textContent).toMatch(/^Hidden: /);
    // None of the shown ones is dull
    expect($$('[data-xb-section="same"] [data-xb-grid=""] [data-xb-tile][data-dull]')).toHaveLength(0);
    click($('[data-xb-show-hidden="same"]'));
    expect($('[data-xb-grid="hidden"]')).toBeNull();
  });

  it('"used in" opens the source where it is written; "Where else?" opens Find uses with the move\'s shape', async () => {
    jumps.calls.length = 0;
    useExprBuilder.getState().openWith();
    mount(<ExpressionBuilderModal />);
    await settle();
    const t = tile('x * #a')!;
    const link = t.querySelector('[data-xb-source]') as HTMLElement;
    expect(link.textContent).toBeTruthy();
    click(link);
    await settle(10);
    expect(jumps.calls).toHaveLength(1);
    expect(jumps.calls[0]).toMatchObject({ docId: link.getAttribute('data-xb-source') });
    expect(useExprBuilder.getState().open).toBe(false);

    useExprBuilder.getState().openWith();
    await settle();
    click(tile('x * #a')!.querySelector('[data-xb-where]'));
    await settle(10);
    expect($('[data-test-find-uses]')?.getAttribute('data-test-find-uses')).toBe('$x * #a');
  });

  it('names the chain on its rows as it grows', async () => {
    useExprBuilder.getState().openWith();
    mount(<ExpressionBuilderModal />);
    await settle();
    click($('[data-builder-help="empty:empty-chain"] [data-help-example]'));
    await settle(10);
    expect($$('[data-xb-name]').map(n => n.textContent)).toEqual(['cell repeat', 'centred cells', 'grid of circles']);
    expect($('[data-xb-current-name]')?.textContent).toBe('grid of circles');
  });

  it('Surprise me adds 2–5 steps (the same ones for the same seed); Undo takes them back; they stay editable', async () => {
    useExprBuilder.getState().openWith();
    mount(<ExpressionBuilderModal />);
    await settle();
    expect(($('[data-xb-undo]') as HTMLButtonElement).disabled).toBe(true);
    act(() => useExprBuilder.setState({ surpriseSeed: 11 }));
    click($('[data-xb-surprise]'));
    const first = useExprBuilder.getState().chain.steps.map(s => s.template);
    expect(first.length).toBeGreaterThanOrEqual(2);
    expect(first.length).toBeLessThanOrEqual(5);
    expect(useExprBuilder.getState().at).toBe(first.length);
    expect(rows()).toHaveLength(first.length + 1);
    // Undo, then the same seed again: the same chain
    click($('[data-xb-undo]'));
    expect(useExprBuilder.getState().chain.steps).toHaveLength(0);
    act(() => useExprBuilder.setState({ surpriseSeed: 11 }));
    click($('[data-xb-surprise]'));
    expect(useExprBuilder.getState().chain.steps.map(s => s.template)).toEqual(first);
    // Editable: go back to step 1 and tune it, or pick something else there
    click($('[data-xb-step="1"]'));
    expect(useExprBuilder.getState().at).toBe(1);
    // The block compiles
    const pv = previewGraph(useExprBuilder.getState().chain);
    expect(compileGraph({ nodes: pv.nodes }).success).toBe(true);
  });
});
