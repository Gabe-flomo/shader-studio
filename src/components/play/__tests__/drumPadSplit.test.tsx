/**
 * The Drum pads card: the sidebar shows a compact summary, the split view's
 * big Layers panel the full editor, and Open in split view gets there.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  const m = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); },
    key: () => null, get length() { return m.size; }, clear: () => m.clear(),
  });
});
import { renderToStaticMarkup } from 'react-dom/server';
import { DEFAULT_SPLIT, openLayerInSplit, usePlaySplit } from '../playSplit';
import { usePlayUi } from '../playUi';
import { DrumPadEditor, drumFxSummary } from '../layers/DrumPadEditor';
import { makeFieldKit } from '../layers/fields';
import type { EditorContext } from '../layers/editors';
import { THEMES } from '../../../theme/tokens';
import { defaultLayer, emptyPlayRecord, type PlayLayer } from '../../../types/play';
import { newAudioFxEffect } from '../../../types/playAudioFx';

const layer = defaultLayer('drumpad', 'dp1', 'Drums');

function render(big: boolean): string {
  const f = makeFieldKit({ l: layer, tk: THEMES.light, touch: false, exposedTargets: new Set(), set: () => {}, onExpose: () => {}, onExposeControl: () => {}, onDriveNull: () => {}, onPairXY: () => {} });
  const ctx: EditorContext = {
    layers: [layer as PlayLayer], act: () => {}, drawing: null, startDrawing: () => {}, cancelDrawing: () => {}, createNull: () => {},
    play: { ...emptyPlayRecord(), layers: [layer] }, changePlay: () => {}, big,
  };
  return renderToStaticMarkup(<DrumPadEditor f={f} ctx={ctx} />);
}

describe('drum pads card', () => {
  beforeEach(() => {
    usePlaySplit.setState({ ...DEFAULT_SPLIT, available: false });
    usePlayUi.setState({ selected: '' });
  });

  it('shows the compact summary in the sidebar, not the full editor', () => {
    const html = render(false);
    expect(html).toContain('data-drum-summary');
    expect(html).toContain('Drum pads (mini)');
    expect(html).toMatch(/of 16 pads have sounds/);
    expect(html).toContain('Effects: None');
    expect(html).not.toContain('Kit');
    expect(html).not.toContain('Readers listen here');
  });

  it('shows the full editor in the big panel', () => {
    const html = render(true);
    expect(html).not.toContain('data-drum-summary');
    expect(html).toContain('Kit');
  });

  it('without a split view on screen (phones) the card offers the full editor in a sheet', () => {
    // Server rendering reads the split store's initial state: no split area mounted.
    expect(render(false)).toContain('Open full editor');
  });

  it('opening in split turns the split on, on Layers, with the layer selected', () => {
    expect(openLayerInSplit('dp1')).toBe(false);
    expect(usePlaySplit.getState().on).toBe(false);
    usePlaySplit.setState({ available: true, tab: 'finish' });
    expect(openLayerInSplit('dp1')).toBe(true);
    const s = usePlaySplit.getState();
    expect(s.on).toBe(true);
    expect(s.tab).toBe('layers');
    expect(usePlayUi.getState().selected).toBe('dp1');
  });

  it('sums up the kit’s effect chain', () => {
    const fx = { chains: { 'layer:dp1': { on: true, effects: [newAudioFxEffect('filter'), newAudioFxEffect('reverb')] } } };
    expect(drumFxSummary(undefined, 'dp1')).toBe('None');
    expect(drumFxSummary(fx, 'dp1')).toBe('Filter → Reverb');
    expect(drumFxSummary({ chains: { 'layer:dp1': { ...fx.chains['layer:dp1'], on: false } } }, 'dp1')).toBe('Filter → Reverb (off)');
  });
});
