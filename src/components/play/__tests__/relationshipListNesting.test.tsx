// @vitest-environment jsdom
/**
 * The Layers list nests a relationship's members under its row (LayersPanel.tsx +
 * play/relationshipNesting.ts): shown indented with a role chip, folds away, and the
 * member still renders as an ordinary layer row (its own controls, drag handle).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { LayersPanel } from '../LayersPanel';
import { usePlayUi } from '../playUi';
import { defaultLayer, emptyPlayRecord, newRelationMember, type PlayLayer, type PlayRecord, type RelationshipLayer } from '../../../types/play';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mounted: Array<{ root: Root; host: HTMLElement }> = [];
function mount(ui: React.ReactElement) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(ui));
  mounted.push({ root, host });
  return { host, rerender: (next: React.ReactElement) => act(() => root.render(next)) };
}
afterEach(() => { for (const m of mounted.splice(0)) { act(() => m.root.unmount()); m.host.remove(); } });

function playWithChase(): PlayRecord {
  const chaser = defaultLayer('shape', 'chaser1', 'Cat');
  const prey = defaultLayer('shape', 'prey1', 'Mouse');
  const rel = {
    ...defaultLayer('relationship', 'rel1', 'Chase 1'),
    relation: 'chase',
    members: [newRelationMember('chaser1', 'chaser'), newRelationMember('prey1', 'prey')],
  } as RelationshipLayer;
  return { ...emptyPlayRecord(), layers: [rel, chaser, prey] as PlayLayer[] };
}

describe('Layers list: a relationship layer nests its members', () => {
  beforeEach(() => { usePlayUi.setState({ selected: '', entered: '', folded: {} }); });

  it('shows the members indented under the relationship, with role chips, and not at their own top-level spot', () => {
    const { host } = mount(
      <LayersPanel play={playWithChase()} touch={false} exposedTargets={new Set()} onChange={() => {}} onExpose={() => {}} />,
    );
    const relRow = host.querySelector('[data-layer-id="rel1"]')!;
    const chaserRow = host.querySelector('[data-layer-id="chaser1"]')!;
    const preyRow = host.querySelector('[data-layer-id="prey1"]')!;
    expect(relRow).toBeTruthy();
    expect(chaserRow).toBeTruthy();
    expect(preyRow).toBeTruthy();
    // Both member rows come after the relationship row in the rendered order.
    const order = Array.from(host.querySelectorAll('[data-layer-id]')).map(el => el.getAttribute('data-layer-id'));
    expect(order.indexOf('chaser1')).toBeGreaterThan(order.indexOf('rel1'));
    expect(order.indexOf('prey1')).toBeGreaterThan(order.indexOf('rel1'));
    // Role chips.
    expect(chaserRow.textContent).toContain('Chaser');
    expect(preyRow.textContent).toContain('Prey');
    // The relationship row shows its member count.
    expect(relRow.parentElement?.textContent).toContain('2 members');
  });

  it('folds away and back, remembered per layer', () => {
    const { host } = mount(
      <LayersPanel play={playWithChase()} touch={false} exposedTargets={new Set()} onChange={() => {}} onExpose={() => {}} />,
    );
    expect(host.querySelector('[data-layer-id="chaser1"]')).toBeTruthy();
    const foldBtn = Array.from(host.querySelectorAll('button')).find(b => b.textContent?.includes('members'))!;
    expect(foldBtn).toBeTruthy();
    act(() => foldBtn.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(host.querySelector('[data-layer-id="chaser1"]')).toBeFalsy();
    expect(host.querySelector('[data-layer-id="prey1"]')).toBeFalsy();
    // Remembered in the shared fold store.
    expect(usePlayUi.getState().folded['rel:rel1']).toBe(true);
    // Unfold.
    const foldBtn2 = Array.from(host.querySelectorAll('button')).find(b => b.textContent?.includes('members'))!;
    act(() => foldBtn2.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(host.querySelector('[data-layer-id="chaser1"]')).toBeTruthy();
  });
});
