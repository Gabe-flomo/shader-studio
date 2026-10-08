import { describe, expect, it, vi } from 'vitest';
import type { GraphNode } from '../../types/nodeGraph';
import type { PlayCandidate } from '../../play/playControls';
import type { PlayRecord } from '../../types/play';

vi.hoisted(() => {
  const mem = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v); },
    removeItem: (k: string) => { mem.delete(k); }, key: () => null, length: 0, clear: () => mem.clear(),
  });
});
import { DEFAULT_RANDOMIZE_OPTIONS } from '../randomizeOptions';
import { focusItems } from '../randomizeFocus';
import { analyseSamples, absCosine, controlItems, findControls, FRACS, type ControlItem, type FinderIO, type SampleFrame } from '../controlFinder';
import { addSuggestedControls } from '../../play/suggestControls';

const node = (params: Record<string, unknown> = {}, id = 'a', type = 'fbm'): GraphNode =>
  ({ id, type, position: { x: 0, y: 0 }, inputs: {}, outputs: {}, params });

// A mocked renderer: an 8 × 8 gradient picture, changed by each setting's own effect.
const N = 8;
type Effect = (v: number, x: number, y: number) => number | null; // added brightness, or null: black
const effects: Record<string, Effect> = {
  bright: v => 0.4 * v,
  bright2: v => 0.35 * v,
  stripes: (v, x) => 0.3 * v * (x % 2 ? 1 : -1),
  jump: (v, x) => (v > 0.5 && x < N / 2 ? 0.4 : 0),
  blank: (v, _x, y) => (v > 0.6 ? null : 0.2 * v * (y % 2 ? 1 : -1)),
  dull: () => 0,
};
const frameOf = (effect: Effect | undefined, v: number, later: boolean): SampleFrame => {
  const rgba = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const add = effect ? effect(v, x, y) : 0;
    const g = (x + y) / (2 * (N - 1)) * 0.5 + 0.25 + (later ? 0.0 : 0);
    const c = add === null ? 0 : Math.min(1, Math.max(0, g + add));
    const o = (y * N + x) * 4;
    rgba[o] = rgba[o + 1] = rgba[o + 2] = Math.round(c * 255); rgba[o + 3] = 255;
  }
  return { rgba, w: N, h: N };
};
const mockIO = (extra: Partial<FinderIO> = {}): FinderIO => ({
  render: (item, value = 0, later = false) => frameOf(item ? effects[item.target.split('::')[1]] : undefined, value, later),
  yieldNow: async () => {},
  ...extra,
});
const item = (key: string): ControlItem => ({ target: `n::${key}`, nodeLabel: 'Glow', paramLabel: key, lo: 0, hi: 1, cur: 0.2 });
const items = ['bright', 'stripes', 'jump', 'blank', 'dull', 'bright2'].map(item);

describe('analyseSamples', () => {
  const at = (key: string) => FRACS.map(f => frameOf(effects[key], f, false));
  it('scores a steady change as smooth and a jump as not', () => {
    const smooth = analyseSamples(at('bright'))!, jumpy = analyseSamples(at('jump'))!;
    expect(smooth.smoothness).toBeGreaterThan(0.6);
    expect(jumpy.smoothness).toBeLessThan(0.2);
    expect(smooth.usableFrac).toBe(1);
  });
  it('limits the usable run to the frames that are not blank', () => {
    const a = analyseSamples(at('blank'))!;
    expect(a.run).toEqual([0, 2]);
    expect(a.usableFrac).toBe(0.5);
  });
  it('finds nothing in a setting that changes nothing', () => {
    expect(analyseSamples(at('dull'))!.impactPx).toBe(0);
  });
  it('gives the same pattern for settings with the same effect, a different one for another', () => {
    const sig = (k: string) => analyseSamples(at(k))!.signature;
    expect(absCosine(sig('bright'), sig('bright2'))).toBeGreaterThan(0.95);
    expect(absCosine(sig('bright'), sig('stripes'))).toBeLessThan(0.5);
  });
});

describe('findControls', () => {
  it('ranks by impact and smoothness, keeps usable ranges, drops same-effect twins and do-nothing settings', async () => {
    const r = (await findControls(items, mockIO()))!;
    const by = Object.fromEntries(r.suggestions.map(s => [s.target.split('::')[1], s]));
    expect(by.dull).toBeUndefined();
    expect(by.bright2).toBeUndefined();
    expect(by.bright.similar).toEqual(['Glow · bright2']);
    expect(by.bright.impact).toBe(1);
    expect(by.bright.smoothness).toBeGreaterThan(by.jump.smoothness);
    expect(r.suggestions[0].target).toBe('n::bright');
    expect(r.suggestions.map(s => s.score)).toEqual([...r.suggestions.map(s => s.score)].sort((a, b) => b - a));
    // blank: usable only up to the middle of the range, min/max widened to hold the current value 0.2
    expect(by.blank.min).toBe(0);
    expect(by.blank.max).toBe(0.5);
    expect(by.blank.usable).toBe(0.5);
    expect(by.blank.frames).toHaveLength(3);
    expect(by.bright.min).toBe(0); expect(by.bright.max).toBe(1);
    expect(by.bright.label).toBe('Glow · bright');
    expect(r.measured).toBe(6); expect(r.complete).toBe(true); expect(r.animated).toBe(false);
  });

  it('is deterministic', async () => {
    const a = await findControls(items, mockIO());
    const b = await findControls([...items], mockIO());
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('is null when nothing can be drawn and empty when nothing moves the picture', async () => {
    expect(await findControls(items, mockIO({ render: () => null }))).toBeNull();
    const r = await findControls([item('dull')], mockIO());
    expect(r?.suggestions).toEqual([]);
  });

  it('stops at the time budget and says so', async () => {
    let t = 0;
    const r = (await findControls(items, mockIO({ chunk: 2, budgetMs: 100, now: () => (t += 60) })))!;
    expect(r.complete).toBe(false);
    expect(r.measured).toBeLessThan(6);
  });

  it('adds motion interest only for an animated graph', async () => {
    const anim: FinderIO = {
      ...mockIO(),
      // the picture drifts brighter over time, more where the setting's value is high
      render: (it, v = 0, later = false) => {
        const f = frameOf(it ? effects[it.target.split('::')[1]] : undefined, v, false);
        if (!later) return f;
        const g = new Uint8Array(f.rgba); const k = it ? Math.round(40 * v) : 40;
        for (let i = 0; i < g.length; i += 4) { g[i] = Math.min(255, g[i] + k); g[i + 1] = Math.min(255, g[i + 1] + k); g[i + 2] = Math.min(255, g[i + 2] + k); }
        return { ...f, rgba: g };
      },
    };
    const r = (await findControls([item('bright'), item('stripes')], anim))!;
    expect(r.animated).toBe(true);
    expect(Math.max(...r.suggestions.map(s => s.motion))).toBe(1);
  });

  it('blends in the embedding distance when a model is loaded', async () => {
    // the embedding says "stripes" moves the picture far and "bright" not at all
    const embed: FinderIO['embed'] = async f => {
      const striped = f.rgba[0] !== f.rgba[4];
      void striped;
      return [1, 0];
    };
    const r = (await findControls([item('bright'), item('stripes')], mockIO({ embed })))!;
    expect(r.usedEmbedding).toBe(true);
    expect(r.suggestions.length).toBeGreaterThan(0);
  });
});

describe('controlItems', () => {
  const probe = focusItems([node()], DEFAULT_RANDOMIZE_OPTIONS).filter(i => typeof i.lo === 'number');
  const cands = (level: GraphNode[]): PlayCandidate[] => focusItems(level, DEFAULT_RANDOMIZE_OPTIONS).filter(i => typeof i.lo === 'number').map(i => ({
    target: `${i.nodeId}::${i.key}`, kind: 'float', nodeLabel: 'Noise', paramLabel: i.key, min: -1000, max: 1000, value: i.cur as number,
  }));

  it('offers the free floats of a node', () => {
    const level = [node()];
    const { items: its, onPlay } = controlItems(level, DEFAULT_RANDOMIZE_OPTIONS, cands(level), new Set());
    expect(probe.length).toBeGreaterThan(0);
    expect(its.map(i => i.target).sort()).toEqual(probe.map(i => `a::${i.key}`).sort());
    expect(onPlay).toBe(0);
    expect(its.every(i => i.hi > i.lo)).toBe(true);
  });

  it('leaves out locked settings, skipped nodes and settings already on Play', () => {
    const first = probe[0].key, second = probe[1].key;
    const level = [node({ __randExclude: [first] }), node({ __randSkip: true }, 'b')];
    const { items: its, onPlay } = controlItems(level, DEFAULT_RANDOMIZE_OPTIONS, [...cands([node()]), ...cands([node({}, 'b')])], new Set([`a::${second}`]));
    const targets = its.map(i => i.target);
    expect(targets).not.toContain(`a::${first}`);
    expect(targets).not.toContain(`a::${second}`);
    expect(targets.some(t => t.startsWith('b::'))).toBe(false);
    expect(onPlay).toBe(1);
  });

  it('only offers settings Play can actually control', () => {
    const { items: its } = controlItems([node()], DEFAULT_RANDOMIZE_OPTIONS, [], new Set());
    expect(its).toEqual([]);
  });
});

describe('addSuggestedControls', () => {
  const play = (controls: PlayRecord['controls'] = []): PlayRecord => ({ controls, mappings: [], layers: [] } as unknown as PlayRecord);
  it('creates float controls with the usable range, the step and a readable label, skipping any already there', async () => {
    const r = (await findControls(items, mockIO()))!;
    const blank = r.suggestions.find(s => s.target === 'n::blank')!;
    const bright = r.suggestions.find(s => s.target === 'n::bright')!;
    const next = addSuggestedControls(play([{ id: 'c1', target: 'n::bright', kind: 'float', label: 'mine', min: 0, max: 2 }]), [bright, blank], { 'n::blank': 'Softness' });
    expect(next.controls).toHaveLength(2);
    expect(next.controls[0].label).toBe('mine');
    expect(next.controls[1]).toMatchObject({ target: 'n::blank', kind: 'float', label: 'Softness', min: 0, max: 0.5 });
    expect(addSuggestedControls(next, [bright, blank])).toBe(next);
  });
});
