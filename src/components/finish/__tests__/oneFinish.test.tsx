// @vitest-environment jsdom
/**
 * One Finish (docs/finish-stack.md, "One Finish"): the Studio's Finish panel, the 2D builder's
 * Look → Finish card and Play's Finish rail are one component on one stack (`play.finish`), the
 * grade's Looks and the starting stacks are Finish presets in the one preset store, and on Free the
 * stack is locked but kept.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRoot, type Root } from 'react-dom/client';
import { FinishButton, FinishDrawer, FinishEditor, useFinishDrawer } from '../FinishEditor';
import { useNodeGraphStore } from '../../../store/useNodeGraphStore';
import { emptyPlayRecord } from '../../../types/play';
import { GRADE_LOOKS, newFinishEffect, parseFinish } from '../../../types/playFinish';
import { usePlan } from '../../../lib/plan';
import { BUILTIN_FINISH_PRESETS } from '../../../play/finishPresets';
import { parseStackPreset, applyStackPreset } from '../../../play/finishLibrary';
import '../../../presets/presetKinds';
import { builtInPresets, presetKind } from '../../../presets/presetStore';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mounted: Array<{ root: Root; host: HTMLElement }> = [];
async function mount(ui: React.ReactElement) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => { root.render(ui); });
  // The stack's editor is lazy: let it load.
  await act(async () => { await import('../../play/finish/FinishPanel'); await new Promise(r => setTimeout(r, 0)); });
  mounted.push({ root, host });
  return host;
}
afterEach(() => {
  for (const m of mounted.splice(0)) { act(() => m.root.unmount()); m.host.remove(); }
  usePlan.setState({ session: { status: 'signed-in', user: '', plan: 'pro', source: 'open' } });
  useFinishDrawer.getState().close();
});
beforeEach(() => {
  useNodeGraphStore.setState({ play: { ...emptyPlayRecord(), finish: { on: true, effects: [newFinishEffect('grade', 'g1'), newFinishEffect('vignette', 'v1')] } } });
});
const src = (p: string) => readFileSync(resolve(__dirname, '../../../..', p), 'utf8');

describe('one Finish, everywhere', () => {
  it('the Studio panel and an embedded editor (the builder card) show the same stack, and follow it', async () => {
    const studio = await mount(<><FinishButton /><FinishDrawer /></>);
    const builder = await mount(<FinishEditor embedded />);
    expect(studio.querySelector('[data-finish-button]')!.textContent).toBe('Finish · 2');
    await act(async () => { (studio.querySelector('[data-finish-button]') as HTMLElement).click(); });
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });
    const drawer = document.querySelector('[data-finish-drawer]')!;
    expect(drawer).toBeTruthy();
    for (const host of [drawer, builder]) {
      expect(host.querySelector('[data-finish-stack]')).toBeTruthy();
      expect(host.textContent).toContain('Grade');
      expect(host.textContent).toContain('Vignette');
    }
    // A change made anywhere (here: the store, as Play's rail writes it) shows in both.
    await act(async () => { useNodeGraphStore.getState().setPlay(p => ({ ...p, finish: { ...p.finish!, effects: [...p.finish!.effects, newFinishEffect('grain', 'gr')] } })); });
    expect(drawer.textContent).toContain('Film grain');
    expect(builder.textContent).toContain('Film grain');
    expect(studio.querySelector('[data-finish-button]')!.textContent).toBe('Finish · 3');
  });

  it('Play, the builder and the Studio all use the same component on play.finish', () => {
    expect(src('src/components/play/PlayPage.tsx')).toMatch(/<FinishPanel play=\{play\}/);
    expect(src('src/components/play/finish/FinishPanel.tsx')).toMatch(/export function PictureFinish/);
    expect(src('src/components/finish/FinishEditor.tsx')).toMatch(/m\.PictureFinish/);
    const modal = src('src/components/sceneBuilder2d/SceneBuilder2DModal.tsx');
    expect(modal).toMatch(/<FinishEditor embedded \/>/);
    expect(modal).not.toMatch(/id="look2-grade"/);
    expect(src('src/App.tsx')).toMatch(/page !== 'play' && <FinishButton \/>/);
    expect(src('src/components/shell/MobileTopBar.tsx')).toMatch(/label: 'Finish…'/);
  });

  it('on Free the stack is locked but kept', async () => {
    usePlan.setState({ session: { status: 'signed-in', user: '', plan: 'free', source: 'open' } });
    const host = await mount(<FinishEditor embedded />);
    expect(host.querySelector('[data-finish-locked]')).toBeTruthy();
    expect(host.textContent).toContain('2 effects are kept');
    expect(useNodeGraphStore.getState().play.finish!.effects).toHaveLength(2);
  });
});

describe('Finish presets', () => {
  it('every grade Look is a built-in Finish preset, with a few starting stacks; all load', () => {
    for (const l of GRADE_LOOKS) {
      const p = BUILTIN_FINISH_PRESETS.find(x => x.look === l.id)!;
      expect(p.name).toBe(l.name);
      expect(p.finish.effects[0].kind).toBe('grade');
      expect(p.finish.effects[0].look).toBe(l.id);
    }
    expect(BUILTIN_FINISH_PRESETS.filter(p => !p.look).length).toBeGreaterThanOrEqual(3);
    for (const p of BUILTIN_FINISH_PRESETS) {
      expect(parseStackPreset(p)).toBeTruthy();
      expect(parseFinish(applyStackPreset(undefined, p, 'replace').finish)!.effects.length).toBe(p.finish.effects.length);
    }
  });

  it('they are in the one preset store, under Finish', () => {
    expect(presetKind('finishStack')?.label).toBe('Finish presets');
    expect(presetKind('finishStack')?.group).toBe('finish');
    const ids = builtInPresets('finishStack').map(b => b.id);
    expect(ids).toEqual(BUILTIN_FINISH_PRESETS.map(p => p.id));
  });
});
