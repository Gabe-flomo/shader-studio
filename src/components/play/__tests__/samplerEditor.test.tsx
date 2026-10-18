/**
 * The Sampler's editor (docs/sampler.md): one editor in the sidebar and the
 * split view's big Layers panel. The sidebar card is compact (the pads, the
 * selected sound's waveform, envelope and main numbers) with Expand; the big
 * panel has zoom and every section; phones get the sheet.
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
import { SamplerEditor, drumFxSummary } from '../layers/sampler/SamplerEditor';
import { makeFieldKit } from '../layers/fields';
import type { EditorContext } from '../layers/editors';
import { THEMES } from '../../../theme/tokens';
import { defaultLayer, emptyPlayRecord, type PlayLayer } from '../../../types/play';
import { newSamplerZone, padNumbers, type SamplerLayer } from '../../../types/playLayers';
import { newAudioFxEffect } from '../../../types/playAudioFx';

const base = defaultLayer('sampler', 'dp1', 'Drums') as SamplerLayer;
const withKick: SamplerLayer = { ...base, ...padNumbers(0), pads: base.pads.map((p, i) => (i === 0 ? { ...p, synth: 'kick' } : p)) };
const keys: SamplerLayer = { ...base, view: 'keys', zones: [newSamplerZone(1, { synth: 'tom', lo: 48, hi: 72, root: 60 })] };

function render(layer: SamplerLayer, big: boolean, touch = false): string {
  const f = makeFieldKit({ l: layer, tk: THEMES.light, touch, exposedTargets: new Set(), set: () => {}, onExpose: () => {}, onExposeControl: () => {}, onDriveNull: () => {}, onPairXY: () => {} });
  const ctx: EditorContext = {
    layers: [layer as PlayLayer], act: () => {}, drawing: null, startDrawing: () => {}, cancelDrawing: () => {}, createNull: () => {},
    play: { ...emptyPlayRecord(), layers: [layer] }, changePlay: () => {}, big, touch,
  };
  return renderToStaticMarkup(<SamplerEditor f={f} ctx={ctx} />);
}

describe('the Sampler editor', () => {
  beforeEach(() => {
    usePlaySplit.setState({ ...DEFAULT_SPLIT, available: false });
    usePlayUi.setState({ selected: '' });
  });

  it('the Drum view: 16 pads named by their notes, the view switch, the selected pad', () => {
    const html = render(withKick, false);
    expect(html).toContain('aria-label="Sampler view"');
    expect(html).toContain('Pad C1: Kick');
    expect(html).toContain('Pad D#2: empty');
    expect((html.match(/aria-label="Pad [A-G]#?-?\d: /g) ?? []).length).toBe(16);
    // The selected pad's sound: its waveform and its amp envelope picture.
    expect(html).toContain('data-sampler-wave');
    expect(html).toContain('data-sampler-envelope');
    // No overview strip: ‹ › bank buttons move the 16 in view.
    expect(html).not.toContain('Pad overview');
    expect(html).toContain('data-pad-bank');
    expect(html).toContain('Higher 16 pads');
  });

  it('the sidebar is the same editor, compact, with Expand; phones open a sheet', () => {
    const side = render(withKick, false);
    expect(side).toContain('Open full editor');
    expect(side).toContain('data-sampler-wave');
    expect(render(withKick, true)).not.toContain('Open full editor');
    expect(render(withKick, false, true)).toContain('Open full editor');
  });

  it('the big panel has every section as a tab', () => {
    const html = render(withKick, true);
    for (const t of ['Pads', 'Sample', 'Filter', 'Pitch &amp; LFO', 'Kit', 'Play']) expect(html).toContain(t);
  });

  it('the Keys view: the zone editor, modes and what overlaps do', () => {
    const html = render(keys, true);
    expect(html).toContain('data-sampler-zones');
    expect(html).toContain('Classic');
    expect(html).toContain('One-shot');
    expect(html).toContain('Slice');
    expect(html).toContain('root C3');
    expect(html).toContain('data-sampler-envelope');
  });

  it('opening in split turns the split on, on Layers, with the layer selected', () => {
    usePlaySplit.setState({ on: false });
    expect(openLayerInSplit('dp1')).toBe(false);
    expect(usePlaySplit.getState().on).toBe(false);
    usePlaySplit.setState({ available: true, tab: 'finish', sidebar: 'full' });
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
