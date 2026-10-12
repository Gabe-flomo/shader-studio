// @vitest-environment jsdom
/**
 * The Grid Rules builder on the Agent Builder's shell, drawn: the rule first in the left nav (with
 * summaries), the try board in the middle (draw, step forward and back, Use as the start), the
 * section's settings on the right, presets as pictures with Surprise me below; Born & Survive's
 * picture switches; Stencils as drawn stencils with choices; Blocks before/after and together;
 * Smooth in plain words; As text; Done; reopening a built node.
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
import type { GraphNode } from '../../../types/nodeGraph';
import { useNodeGraphStore } from '../../../store/useNodeGraphStore';
import { GridRulesEditor } from '../GridRulesEditor';
import { sharePercent } from '../TryBoard';
import { COUNT_PRESETS, GRID_DEFAULTS, SMOOTH_PRESETS, presetPatch } from '../../../gridRules/spec';
import { BLOCK_PRESETS, NOT_EMPTY, PATTERN_PRESETS } from '../../../gridRules/stencils';
import { useBuilderWindows } from '../../../builders/windows';
import { editBuiltScene, newGridRules } from '../../../builders/open';
import { builtScenes } from '../../../builders/sceneKinds';
import { buildFromGridBuilder, simulationFromGrid } from '../../../gridScene/actions';
import { useGridBuilder } from '../../../gridScene/store';
import { starterGridScene } from '../../../gridScene/spec';
import { resetRuntime } from '../../../lib/runtimeReset';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext'];

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
const click = (el: Element | null) => { expect(el).toBeTruthy(); act(() => { (el as HTMLElement).click(); }); };
const $ = (sel: string) => document.body.querySelector(sel);
const $$ = (sel: string) => [...document.body.querySelectorAll(sel)];
const params = () => useNodeGraphStore.getState().nodes.find(n => n.id === 'g1')!.params;
const nav = () => $$('[data-studio-panel="nav"] [data-studio-section]').map(b => b.getAttribute('data-studio-section'));
const gen = () => $('[data-try-gen]')?.textContent;
/** The step and the live count (the strip shows percents; the count rides on the element). */
const genLive = () => `${gen()!.split(' · ')[0]} · ${$('[data-try-gen]')?.getAttribute('data-try-live')} live`;
/** A press on the try board at cell (x, row from the top): jsdom lays out nothing, so a cell is 2 px from 0. */
const press = (x: number, row: number) => {
  const surface = $('[data-try-surface]')!;
  act(() => {
    surface.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: x * 2 + 1, clientY: row * 2 + 1 }));
    surface.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, button: 0, clientX: x * 2 + 1, clientY: row * 2 + 1 }));
  });
};

const node = (p: Record<string, unknown>): GraphNode => ({ id: 'g1', type: 'gridRules', position: { x: 0, y: 0 }, inputs: {}, outputs: {}, params: { ...GRID_DEFAULTS, ...p } });

beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 });
  localStorage.clear();
  useBuilderWindows.setState({ gridRules: null, agentRules: null, recipe: null, agentBuilder: null, sceneShell: null });
  useNodeGraphStore.setState({ nodes: [node({ ruleType: 'count', ...presetPatch(COUNT_PRESETS.life) })], activeGroupPath: [], selectedNodeId: null, selectedNodeIds: [] });
});

describe('the Grid Rules builder', () => {
  it('the shell: sections with summaries, the try board in the middle, presets below, the section remembered', () => {
    mount(<GridRulesEditor nodeId="g1" onClose={() => {}} />);
    expect($('[data-studio="grid-rules"]')).toBeTruthy();
    expect($('[data-scene-crumb="simulation"]')).toBeTruthy();
    expect(nav()).toEqual(['rule', 'neighbourhood', 'stack', 'start', 'run', 'brush', 'look', 'recipe']);
    expect($('[data-studio-section="rule"] [data-studio-summary]')?.textContent).toBe('B3/S23');
    expect($('[data-studio-section="run"] [data-studio-summary]')?.textContent).toBe('30 steps a second');
    expect($('[data-inspector]')?.getAttribute('data-inspector')).toBe('rule');
    expect($('[data-try-board]')).toBeTruthy();
    expect($$('[data-studio-panel="presets"] [data-preset]').map(b => b.getAttribute('data-preset'))).toContain('highLife');
    click($('[data-studio-section="start"]'));
    expect($('[data-inspector]')?.getAttribute('data-inspector')).toBe('start');
    expect(localStorage.getItem('builder:grid-rules:tab')).toBe('start');
    // A preset is one click.
    click($('[data-preset="highLife"]'));
    expect(params().bornMask).toBe((1 << 3) | (1 << 6));
  });

  it('↺ on the try board is a true reset: step 0, the board as dealt, nothing kept to step back to; the app\'s ↺ does it too', () => {
    mount(<GridRulesEditor nodeId="g1" onClose={() => {}} />);
    const start = genLive();
    expect(start).toMatch(/^Start · /);
    for (let k = 0; k < 6; k++) click($('[data-try-forward]'));
    expect(gen()).toMatch(/^Step 6 · /);
    click($('[data-try-reset]'));
    expect(genLive()).toBe(start);
    expect(($('[data-try-back]') as HTMLButtonElement).disabled).toBe(true);
    // Stepping on from it gives what stepping from the fresh board gave (nothing kept from before).
    click($('[data-try-forward]'));
    const one = genLive();
    for (let k = 0; k < 3; k++) click($('[data-try-forward]'));
    act(() => resetRuntime());
    expect(genLive()).toBe(start);
    click($('[data-try-forward]'));
    expect(genLive()).toBe(one);
  });

  it('Born & Survive: a 3×3 picture on every switch, one live sentence', () => {
    mount(<GridRulesEditor nodeId="g1" onClose={() => {}} />);
    const born = $$('[data-count-row="born"] [data-count]');
    const survive = $$('[data-count-row="survive"] [data-count]');
    expect(born).toHaveLength(9);
    expect(survive).toHaveLength(9);
    for (const b of [...born, ...survive]) expect(b.querySelectorAll('svg rect')).toHaveLength(9);
    expect(survive[4].getAttribute('aria-label')).toBe('Survive with 4: live + 4 → dies (too crowded)');
    expect($('[data-rule-sentence]')?.textContent).toBe('Cells are born with exactly 3 neighbours and survive with 2 or 3; fewer and they die of loneliness, more and they die of crowding.');
    click(born[6]);
    expect(params().bornMask).toBe((1 << 3) | (1 << 6));
    expect($('[data-rule-sentence]')?.textContent).toMatch(/^Cells are born with 3 or 6 neighbours/);
  });

  it('the try board header: step · alive % · dead %, the key on every tab, markers always on, no toggle', () => {
    // A laid-out stage, so cells are big enough for the markers (jsdom lays out nothing).
    const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 900, bottom: 900, width: 900, height: 900, toJSON: () => ({}) } as DOMRect);
    mount(<GridRulesEditor nodeId="g1" onClose={() => {}} />);
    click($('[data-try-clear]'));
    const header = $('[data-try-header]')!;
    expect(header).toBeTruthy();
    expect(gen()).toBe('Start · 0% · 100%');
    expect(($('[data-try-alive]') as HTMLElement).style.color).toBe('rgb(63, 191, 127)');
    expect(($('[data-try-dead]') as HTMLElement).style.color).toBe('rgb(255, 90, 90)');
    const canvas = $('[data-try-surface] canvas') as HTMLCanvasElement;
    const cell = parseFloat(canvas.style.width) / canvas.width;
    expect(cell).toBeGreaterThanOrEqual(6);
    const at = (x: number, row: number) => ({ bubbles: true, button: 0, clientX: x * cell + 1, clientY: row * cell + 1 });
    for (const x of [10, 11, 12]) act(() => {
      $('[data-try-surface]')!.dispatchEvent(new MouseEvent('pointerdown', at(x, 5)));
      $('[data-try-surface]')!.dispatchEvent(new MouseEvent('pointerup', at(x, 5)));
    });
    // Three cells on a big board: never 0%.
    expect(gen()).toBe('Start · <1% · >99%');
    expect(sharePercent(34, 100)).toBe('34%');
    expect(sharePercent(66, 100)).toBe('66%');
    // No toggle: the next-step markers are always drawn (a blinker: two born, two die).
    expect($('[data-try-show-next]')).toBeNull();
    expect(header.querySelector('input, [role="switch"], [role="checkbox"]')).toBeNull();
    const marks = () => $$('[data-try-surface] svg circle[stroke="#3fbf7f"]').length;
    expect(marks()).toBe(2);
    expect(header.querySelector('[data-try-key]')?.textContent).toMatch(/born.*dies/);
    // The pointer cell's note sits in the strip's centre.
    act(() => { $('[data-try-surface]')!.dispatchEvent(new MouseEvent('pointermove', at(11, 4))); });
    expect(header.querySelector('[data-try-note]')?.textContent).toMatch(/comes alive|→/);
    // Another tab: the strip, the key and the markers stay.
    click($('[data-studio-section="look"]'));
    expect($('[data-try-header] [data-try-key]')).toBeTruthy();
    expect(marks()).toBe(2);
    rect.mockRestore();
  });

  it('the try board: clear, draw a blinker, step forward and back, then Use as the start', () => {
    mount(<GridRulesEditor nodeId="g1" onClose={() => {}} />);
    click($('[data-try-clear]'));
    expect(genLive()).toBe('Start · 0 live');
    press(10, 5); press(11, 5); press(12, 5);
    expect(genLive()).toBe('Start · 3 live');
    // Pressing a live cell erases it; pressing again draws it back.
    press(12, 5);
    expect(genLive()).toBe('Start · 2 live');
    press(12, 5);
    click($('[data-try-forward]'));
    expect(genLive()).toBe('Step 1 · 3 live');
    click($('[data-try-forward]'));
    expect(genLive()).toBe('Step 2 · 3 live');
    click($('[data-try-back]'));
    click($('[data-try-back]'));
    expect(genLive()).toBe('Start · 3 live');
    expect(($('[data-try-back]') as HTMLButtonElement).disabled).toBe(true);
    click($('[data-try-use-start]'));
    expect(params().start).toBe('cells');
    expect(params().startCells).toEqual({ w: 3, h: 1, rows: ['111'] });
    expect($('[data-studio-section="start"] [data-studio-summary]')?.textContent).toBe('your drawing · 3 cells');
  });

  it('Stencils: drawn stencils that read as sentences; a picked cell offers its choices', () => {
    useNodeGraphStore.setState({ nodes: [node({ ruleType: 'patterns', ...presetPatch(PATTERN_PRESETS.fallingDots) })] });
    mount(<GridRulesEditor nodeId="g1" onClose={() => {}} />);
    expect($('[data-studio-section="rule"]')?.textContent).toMatch(/Stencils/);
    expect($$('[data-rule-card]')).toHaveLength(2);
    expect($$('[data-rule-sentence-stencil]').map(x => x.textContent)).toEqual([
      'A cell that is 1 with below empty becomes empty.',
      'A cell that is empty with above 1 becomes 1.',
    ]);
    expect($$('[data-rule-card="0"] [data-flip-grid]')).toHaveLength(1);
    click($('[data-rule-card="0"] [data-stencil-cell="Below left"]'));
    expect($$('[data-cell-choices] [data-choice]').map(b => b.textContent)).toEqual(['any', 'not empty', 'empty (0)', 'state 1']);
    click($(`[data-cell-choices] [data-choice="${NOT_EMPTY}"]`));
    expect((params().patterns as Array<{ cells: number[] }>)[0].cells[6]).toBe(NOT_EMPTY);
  });

  it('Blocks: each rule beside its before/after, then the rules together, a step at a time', () => {
    useNodeGraphStore.setState({ nodes: [node({ ruleType: 'blocks', ...presetPatch(BLOCK_PRESETS.sand) })] });
    mount(<GridRulesEditor nodeId="g1" onClose={() => {}} />);
    const cards = $$('[data-rule-card]');
    expect(cards.length).toBeGreaterThan(1);
    for (const c of cards) expect(c.querySelector('[data-flip-grid]')).toBeTruthy();
    expect($('[data-blocks-together]')).toBeTruthy();
    expect($$('[data-together-rule]').map(b => b.getAttribute('aria-pressed'))).toEqual(cards.map(() => 'true'));
    // One rule alone.
    for (const b of $$('[data-together-rule]').slice(1)) click(b);
    expect($('[data-blocks-together]')?.textContent).toMatch(/Rule 1 alone/);
    click($('[data-together-next]'));
  });

  it('Smooth: named for what it makes, settings in plain words with a feel for the number', () => {
    useNodeGraphStore.setState({ nodes: [node({ ruleType: 'smooth', ...presetPatch(SMOOTH_PRESETS.ripples) })] });
    mount(<GridRulesEditor nodeId="g1" onClose={() => {}} />);
    expect($('[data-studio-section="rule"]')?.textContent).toMatch(/Ripples/);
    expect($('[data-template="waves"]')?.getAttribute('aria-checked')).toBe('true');
    expect($$('[data-smooth-setting]').map(x => x.getAttribute('data-smooth-setting'))).toEqual(['waveSpeed', 'damping']);
    expect($('[data-smooth-setting="damping"]')?.textContent).toMatch(/Ripples last.*half gone after about 138 steps/);
    expect($('[data-smooth-demo="waves"]')).toBeTruthy();
    click($('[data-template="reaction"]'));
    expect(params().template).toBe('reaction');
    expect($('[data-feed-kill-map]')).toBeTruthy();
    expect($$('[data-smooth-setting]').map(x => x.getAttribute('data-smooth-setting'))).toEqual(['feed', 'kill']);
  });

  it('As text: the rule as one line; Apply changes the node', () => {
    localStorage.setItem('builder:grid-rules:tab', 'recipe');
    mount(<GridRulesEditor nodeId="g1" onClose={() => {}} />);
    const ta = $('textarea[data-language-text="grid"]') as HTMLTextAreaElement;
    expect(ta.value).toBe('life');
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(ta, 'highlife walls board=480');
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    });
    click($('[data-language-apply]'));
    expect(params()).toMatchObject({ bornMask: (1 << 3) | (1 << 6), edges: 'walls', board: '0.25' });
  });

  it('Stacked rules: add cards on the base, in order; a recipe sets base and cards; the text keeps them', () => {
    mount(<GridRulesEditor nodeId="g1" onClose={() => {}} />);
    click($('[data-studio-section="stack"]'));
    expect($('[data-inspector]')?.getAttribute('data-inspector')).toBe('stack');
    expect($('[data-studio-section="stack"] [data-studio-summary]')?.textContent).toBe('none yet: add a card');
    click($('[data-stack-add-kind="explode"]'));
    click($('[data-stack-add-kind="drift"]'));
    expect((params().stack as Array<{ kind: string }>).map(r => r.kind)).toEqual(['explode', 'drift']);
    expect($('[data-studio-section="stack"] [data-studio-summary]')?.textContent).toBe('+ explode, drift');
    expect($$('[data-stack-sentence]').map(e => e.textContent)[0]).toMatch(/^When two live cells meet/);
    // Drift's direction: the arrows.
    click($('[data-drift-dir="nw"]'));
    expect((params().stack as Array<{ dir: number }>)[1].dir).toBe(7);
    // A recipe: Brian's Brain with a crowd card.
    click($('[data-stack-recipe="crowdedBrain"]'));
    expect(params()).toMatchObject({ ruleType: 'stages', states: 3 });
    expect((params().stack as Array<{ kind: string; move: boolean }>)).toMatchObject([{ kind: 'crowd', move: true }]);
    // As text: the card is a then line, and applying the text keeps it.
    click($('[data-studio-section="recipe"]'));
    expect(document.body.textContent).toContain('then crowd at=4 move');
  });

  it('a section the rule type does not have falls back to the rule', () => {
    localStorage.setItem('builder:grid-rules:tab', 'neighbourhood');
    useNodeGraphStore.setState({ nodes: [node({ ruleType: 'smooth' })] });
    mount(<GridRulesEditor nodeId="g1" onClose={() => {}} />);
    expect(nav()).toEqual(['rule', 'start', 'run', 'brush', 'look', 'recipe']);
    expect($('[data-inspector]')?.getAttribute('data-inspector')).toBe('rule');
  });

  it('Done closes; a node made with a drawing is a built scene that reopens in the builder as it was', () => {
    useNodeGraphStore.setState({ nodes: [] });
    const id = newGridRules({ params: { ruleType: 'count', ...presetPatch(COUNT_PRESETS.highLife) }, startCells: [[1, 1, 1]] });
    expect(useBuilderWindows.getState().gridRules).toBe(id);
    useBuilderWindows.setState({ gridRules: null });
    const built = builtScenes(useNodeGraphStore.getState().nodes).find(b => b.id === id)!;
    expect(built.kind).toBe('simulation');
    expect(editBuiltScene(built)).toBe(true);
    expect(useBuilderWindows.getState().gridRules).toBe(id);
    let closed = 0;
    mount(<GridRulesEditor nodeId={id} onClose={() => { closed++; }} />);
    expect($('[data-studio-section="start"] [data-studio-summary]')?.textContent).toBe('your drawing · 3 cells');
    expect($('[data-studio-section="rule"] [data-studio-summary]')?.textContent).toBe('B36/S23');
    click($('[data-studio-primary]'));
    expect(closed).toBe(1);
  });

  it('a node the Grid builder made (Make it a simulation) keeps ‹ Pattern grid, which goes back to the drawing', () => {
    const out: GraphNode = { id: 'out', type: 'output', position: { x: 600, y: 0 }, inputs: { color: { type: 'vec3', label: 'Color' } } as GraphNode['inputs'], outputs: {}, params: {} };
    useNodeGraphStore.setState({ nodes: [out] });
    useGridBuilder.getState().openWith(starterGridScene());
    const sceneId = buildFromGridBuilder(false, { quiet: true });
    let k = 0;
    const r = simulationFromGrid(useNodeGraphStore.getState().nodes, sceneId, () => `sim${++k}`)!;
    useNodeGraphStore.setState({ nodes: r.nodes });
    useGridBuilder.setState({ open: false });
    useBuilderWindows.setState({ gridRules: r.gridRulesId });
    mount(<GridRulesEditor nodeId={r.gridRulesId} onClose={() => {}} />);
    expect($('[data-scene-crumb="grid"]')?.textContent).toMatch(/Simulation/);
    click($('[data-grid-back]'));
    expect(useBuilderWindows.getState().gridRules).toBeNull();
    expect(useGridBuilder.getState().open).toBe(true);
    expect(useGridBuilder.getState().targetSceneId).toBe(sceneId);
  });

  it('a plain Grid Rules node has no Pattern grid link', () => {
    mount(<GridRulesEditor nodeId="g1" onClose={() => {}} />);
    expect($('[data-grid-back]')).toBeNull();
  });
});
