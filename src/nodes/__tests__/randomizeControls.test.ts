import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GraphNode, NodeDefinition, SubgraphData } from '../../types/nodeGraph';

vi.hoisted(() => {
  const mem = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v); },
    removeItem: (k: string) => { mem.delete(k); }, key: () => null, length: 0, clear: () => mem.clear(),
  });
});
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { DEFAULT_RANDOMIZE_OPTIONS, optionsSummary, sanitizeOptions, type RandomizeOptions } from '../randomizeOptions';
import { lockedItems, moveShare, randomizedGraph, randomizedParams, withoutLock, withoutLocks } from '../randomizeParams';
import { focusItems, measureSensitivity, type FocusItem } from '../randomizeFocus';

const def = {
  paramDefs: {
    radius: { label: 'Radius', type: 'float', min: 0.01, max: 2, step: 0.01 },
    freq:   { label: 'Frequency', type: 'float', min: 0.1, max: 40, step: 0.01 },
    glow:   { label: 'Glow', type: 'float', min: 0, max: 1, step: 0.01 },
    col:    { label: 'Col', type: 'vec3color' },
    mode:   { label: 'Mode', type: 'select', options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }, { value: 'c', label: 'C' }] },
    on:     { label: 'On', type: 'bool' },
    bornMask: { label: 'Born', type: 'float', min: 0, max: 511 },
  },
} as unknown as NodeDefinition;

const node = (params: Record<string, unknown> = {}, id = 'n', type = 't'): GraphNode =>
  ({ id, type, position: { x: 0, y: 0 }, inputs: {}, outputs: {}, params });
const O = (patch: Partial<RandomizeOptions> = {}): RandomizeOptions => ({ ...DEFAULT_RANDOMIZE_OPTIONS, ...patch });
const seq = (...xs: number[]) => { let i = 0; return () => xs[i++ % xs.length]; };

describe('strength', () => {
  const n = node({ radius: 1, freq: 5, glow: 0.5 });
  it('0 changes little: a nudge of at most 5% toward the target', () => {
    for (const r of [0, 0.5, 0.999]) {
      const p = randomizedParams(n, def, () => r, O({ strength: 0, colours: false }));
      // radius: interesting range 0.12–0.7, current 1 → at most 0.05 × |target − 1|
      expect(Math.abs((p.radius as number) - 1)).toBeLessThanOrEqual(0.05 * 0.9 + 0.011);
      expect(Math.abs((p.glow as number) - 0.5)).toBeLessThanOrEqual(0.05 * 1 + 0.011);
    }
  });

  it('1 spans the interesting range and lands on the target', () => {
    const lo = randomizedParams(n, def, () => 0, O({ strength: 1 }));
    const hi = randomizedParams(n, def, () => 0.999999, O({ strength: 1 }));
    expect(lo.radius).toBe(0.12); expect(hi.radius).toBe(0.7);
    expect(lo.freq).toBe(1); expect(hi.freq).toBeCloseTo(12, 0);
  });

  it('moves a log-scaled setting in log space', () => {
    // frequency 1–12 is log: from 12 toward 1 by 0.5 is the geometric middle, not the arithmetic one
    const p = randomizedParams(node({ freq: 12 }), def, () => 0, O({ strength: 0.4 }));
    const t = moveShare(O({ strength: 0.4 }))!;
    expect(p.freq as number).toBeCloseTo(Math.exp(Math.log(12) + (Math.log(1) - Math.log(12)) * t), 1);
  });

  it('is monotone: a bigger strength moves the same draw further', () => {
    const d = (s: number) => Math.abs((randomizedParams(n, def, () => 0, O({ strength: s })).radius as number) - 1);
    expect(d(0)).toBeLessThan(d(0.5)); expect(d(0.5)).toBeLessThan(d(1));
  });
});

describe('locks', () => {
  it('a locked setting is never touched, at any strength or draw', () => {
    const n = node({ radius: 1, __randExclude: ['radius', 'col'] });
    for (const strength of [0, 0.5, 1]) for (const r of [0, 0.3, 0.999]) {
      const p = randomizedParams(n, def, () => r, O({ strength, includeChoices: true }));
      expect('radius' in p).toBe(false); expect('col' in p).toBe(false);
    }
  });

  it('a skipped node is left alone by the graph dice, but its settings still list', () => {
    const nodes = [node({ __randSkip: true }, 'a', 'fbm'), node({}, 'b', 'fbm')];
    const r = randomizedGraph(nodes, 5, O({ strength: 1 }));
    expect(r.nodes[0]).toBe(nodes[0]);
    expect(r.nodes[1].params).not.toEqual({});
  });

  it('locks are listed, cleared one by one and all at once, inside groups too', () => {
    const inner = node({ __randExclude: ['scale'], __randSkip: true }, 'in', 'fbm');
    const group = { ...node({ subgraph: { nodes: [inner], inputPorts: [], outputPorts: [] } as SubgraphData }, 'g', 'group') };
    const nodes = [node({ __randExclude: ['frequency'] }, 'a', 'fbm'), group];
    const items = lockedItems(nodes);
    expect(items.map(i => [i.nodeId, i.key ?? 'node', i.path.join('/')])).toEqual([['a', 'frequency', ''], ['in', 'node', 'g'], ['in', 'scale', 'g']]);
    const one = withoutLock(nodes, items[2]);
    expect(lockedItems(one).length).toBe(2);
    expect(lockedItems(withoutLocks(nodes))).toEqual([]);
    expect(JSON.stringify(withoutLocks(nodes))).not.toContain('__rand');
  });
});

describe('choices and colours', () => {
  const n = node({ mode: 'a', on: false, col: [0.2, 0.2, 0.2] });
  it('choices stay put unless included; bit masks never move', () => {
    expect(Object.keys(randomizedParams(n, def, () => 0, O())).sort()).toEqual(['col', 'freq', 'glow', 'radius']);
    const p = randomizedParams(n, def, () => 0, O({ includeChoices: true }));
    expect(p.mode).not.toBe('a'); expect(p.on).toBe(true);
    expect('bornMask' in p).toBe(false);
  });

  it('a choice only changes with a chance that grows with strength', () => {
    const at = (strength: number) => randomizedParams(n, def, seq(0.4, 0.1), O({ strength, includeChoices: true })).mode;
    expect(at(0)).toBeUndefined();
    expect(at(1)).toBeDefined();
  });

  it('colours are skipped when the toggle is off, and move toward a pleasant colour when on', () => {
    expect('col' in randomizedParams(n, def, () => 0.5, O({ colours: false }))).toBe(false);
    const col = randomizedParams(n, def, () => 0.5, O({ strength: 1 })).col as number[];
    expect(Math.max(...col) - Math.min(...col)).toBeGreaterThan(0.2);
  });
});

describe('groups', () => {
  const inner = node({}, 'in', 'fbm');
  const group = node({ subgraph: { nodes: [inner], inputPorts: [], outputPorts: [] } as SubgraphData }, 'g', 'group');
  const innerOf = (g: GraphNode) => (g.params.subgraph as SubgraphData).nodes[0];

  it('groups are left alone by default', () => {
    const r = randomizedGraph([group], 3, O({ strength: 1 }));
    expect(r.changed).toBe(0);
    expect(r.nodes[0]).toBe(group);
  });

  it('"Inside groups" goes into the group and respects locks inside', () => {
    const r = randomizedGraph([group], 3, O({ strength: 1, insideGroups: true }));
    expect(r.changed).toBeGreaterThan(0);
    expect(innerOf(r.nodes[0]).params).not.toEqual({});
    const locked = { ...group, params: { subgraph: { ...(group.params.subgraph as SubgraphData), nodes: [{ ...inner, params: { __randSkip: true } }] } } };
    const r2 = randomizedGraph([locked], 3, O({ strength: 1, insideGroups: true }));
    expect(r2.changed).toBe(0);
  });

  it('"Settings on a group\'s face" changes the group\'s override keys, not its insides', () => {
    const r = randomizedGraph([group], 3, O({ strength: 1, groupFace: true }));
    expect(r.changed).toBeGreaterThan(0);
    expect(Object.keys(r.nodes[0].params).some(k => k.startsWith('in::'))).toBe(true);
    // The values reach the nodes inside, as editing the card does
    const keys = Object.keys(r.nodes[0].params).filter(k => k.startsWith('in::'));
    for (const k of keys) expect(innerOf(r.nodes[0]).params[k.slice(4)]).toBe(r.nodes[0].params[k]);
  });

  it('a setting locked where it lives is left alone on the group\'s face too', () => {
    const locked = { ...group, params: { subgraph: { ...(group.params.subgraph as SubgraphData), nodes: [{ ...inner, params: { __randExclude: ['frequency'] } }] } } };
    const r = randomizedGraph([locked], 3, O({ strength: 1, groupFace: true }));
    expect(Object.keys(r.nodes[0].params).filter(k => k.startsWith('in::')).length).toBeGreaterThan(0);
    expect('in::frequency' in r.nodes[0].params).toBe(false);
  });
});

describe('determinism', () => {
  const nodes = [node({}, 'a', 'fbm'), node({}, 'b', 'fbm')];
  it('the same seed, options and graph give the same result; another seed does not', () => {
    const o = O({ strength: 0.7 });
    expect(randomizedGraph(nodes, 11, o)).toEqual(randomizedGraph(nodes, 11, o));
    expect(randomizedGraph(nodes, 12, o).nodes).not.toEqual(randomizedGraph(nodes, 11, o).nodes);
  });

  it('adding a node elsewhere does not change the others', () => {
    const a = randomizedGraph(nodes, 11).nodes[0];
    const b = randomizedGraph([...nodes, node({}, 'c', 'fbm')], 11).nodes[0];
    expect(b).toEqual(a);
  });
});

describe('focus weighting', () => {
  const n = node({ radius: 1, freq: 5, glow: 0.5 });
  const draws = () => seq(0.2, 0.8, 0.5);

  it('settings measured as dead are left alone', () => {
    const w = (k: string) => (k === 'glow' ? 0.0 : 1);
    const p = randomizedParams(n, def, draws(), O({ strength: 1, focus: true }), w);
    expect('glow' in p).toBe(false);
    expect('radius' in p).toBe(true);
  });

  it('big-impact settings move further than minor ones', () => {
    const big = moveShare(O({ strength: 0.6 }), 1)!, small = moveShare(O({ strength: 0.6 }), 0.1)!;
    expect(big).toBeGreaterThan(small);
    expect(moveShare(O({ strength: 0.6 }), 0.02)).toBeNull();
    const move = (weight: number) => Math.abs((randomizedParams(n, def, () => 0, O({ strength: 0.6 }), () => weight).radius as number) - 1);
    expect(move(1)).toBeGreaterThan(move(0.1));
  });

  it('randomizedGraph lists the changes with the biggest measured effect first', () => {
    const nodes = [node({}, 'a', 'fbm')];
    const keys = Object.keys(randomizedGraph(nodes, 2, O({ strength: 1 })).nodes[0].params);
    expect(keys.length).toBeGreaterThan(1);
    const weights = Object.fromEntries(keys.map((k, i) => [`a::${k}`, (i + 1) / keys.length]));
    const r = randomizedGraph(nodes, 2, O({ strength: 1, focus: true }), weights);
    const ws = r.changes.map(c => c.weight!);
    expect(ws).toEqual([...ws].sort((x, y) => y - x));
  });

  it('measureSensitivity normalises a mocked renderer and drops what it could not draw', async () => {
    const items: FocusItem[] = ['big', 'small', 'dead'].map(k => ({ weightKey: `n::${k}`, path: [], nodeId: 'n', key: k, binding: `n::${k}`, down: 0, up: 1 }));
    const amount: Record<string, number> = { big: 200, small: 20, dead: 0 };
    const frame = (v: number) => ({ rgba: new Uint8Array([v, v, v, 255]) });
    const w = await measureSensitivity(items, {
      render: (it, value) => (it ? frame(Math.round(amount[it.key] * (value as number))) : frame(0)),
      yieldNow: async () => {},
    });
    expect(w!['n::big']).toBe(1);
    expect(w!['n::small']).toBeCloseTo(0.1, 2);
    expect(w!['n::dead']).toBe(0);
  });

  it('measureSensitivity stops at the time box, and gives null when nothing can be drawn', async () => {
    const items: FocusItem[] = ['a', 'b', 'c', 'd'].map(k => ({ weightKey: `n::${k}`, path: [], nodeId: 'n', key: k, binding: `n::${k}`, down: 0, up: 1 }));
    let t = 0;
    const w = await measureSensitivity(items, {
      render: (it, value) => ({ rgba: new Uint8Array([it ? 50 * (value as number) : 0, 0, 0, 255]) }),
      now: () => (t += 400), budgetMs: 1000, yieldNow: async () => {},
    });
    expect(Object.keys(w!).length).toBeLessThan(4);
    expect(await measureSensitivity(items, { render: () => null })).toBeNull();
  });

  it('focusItems lists the probes for the settings Randomize would change, skipping locks and skipped nodes', () => {
    const level = [node({ __randExclude: ['scale'] }, 'a', 'fbm'), node({ __randSkip: true }, 'b', 'fbm')];
    const items = focusItems(level, O());
    expect(items.length).toBeGreaterThan(0);
    expect(items.every(i => i.nodeId === 'a')).toBe(true);
    expect(items.some(i => i.key === 'scale')).toBe(false);
  });
});

describe('options', () => {
  it('are sanitised and summarised on one line', () => {
    expect(sanitizeOptions({ strength: 7, colours: 'x' })).toEqual({ ...DEFAULT_RANDOMIZE_OPTIONS, strength: 1 });
    expect(optionsSummary(O({ strength: 0.5 }), 3)).toBe('strength 0.5 · 3 locked · groups off');
  });
});

describe('lock persistence', () => {
  beforeEach(() => { useNodeGraphStore.getState().importGraph(JSON.stringify({ nodes: [] })); });

  it('survives save and load, including inside a group', () => {
    const inner = node({ __randExclude: ['scale'] }, 'in', 'fbm');
    const nodes = [
      node({ __randExclude: ['frequency'], __randSkip: true }, 'a', 'fbm'),
      node({ subgraph: { nodes: [inner], inputPorts: [], outputPorts: [] } as SubgraphData }, 'g', 'group'),
    ];
    useNodeGraphStore.setState({ nodes });
    const json = useNodeGraphStore.getState().graphFileJson(false);
    expect(useNodeGraphStore.getState().importGraph(json).ok).toBe(true);
    const after = lockedItems(useNodeGraphStore.getState().nodes);
    expect(after.map(i => `${i.path.join('/')}|${i.nodeId}|${i.key ?? 'node'}`).sort()).toEqual(['g|in|scale', '|a|frequency', '|a|node'].sort());
  });
});
