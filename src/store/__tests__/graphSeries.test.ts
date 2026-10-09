/**
 * Graph series (docs/graph-series-plan.md): major.minor numbering, a new family for an existing
 * name, save in place, old graphs reading as 1.(v − 1), and the history trimmed by size.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  const ls: Record<string, string> = {};
  const hidden = (k: string, v: unknown) => Object.defineProperty(ls, k, { value: v, enumerable: false });
  hidden('getItem', (k: string) => (Object.prototype.hasOwnProperty.call(ls, k) ? ls[k] : null));
  hidden('setItem', (k: string, v: string) => { ls[k] = String(v); });
  hidden('removeItem', (k: string) => { delete ls[k]; });
  hidden('clear', () => { for (const k of Object.keys(ls)) delete ls[k]; });
  hidden('key', (i: number) => Object.keys(ls)[i] ?? null);
  Object.defineProperty(ls, 'length', { get: () => Object.keys(ls).length, enumerable: false });
  vi.stubGlobal('localStorage', ls);
  vi.stubGlobal('window', { dispatchEvent: () => true, addEventListener: () => {}, removeEventListener: () => {} });
});

import { useNodeGraphStore } from '../useNodeGraphStore';
import { adoptSeriesHistory, listVersions, nextNumber, numberOf, seriesHistory, trimToSize, type GraphVersion } from '../graphVersions';

const st = () => useNodeGraphStore.getState();
const label = () => { const c = st().currentGraph; return c ? `${c.major}.${c.minor}` : null; };

describe('graph series', () => {
  beforeEach(() => { localStorage.clear(); useNodeGraphStore.setState({ currentGraph: null }); });

  it('a new name starts at 1.0; Minor counts up; Major starts a new family at x.0', async () => {
    await st().saveGraph('Curves', '', 'new');
    expect(label()).toBe('1.0');
    await st().saveGraph('Curves', '', 'minor');
    await st().saveGraph('Curves');
    expect(label()).toBe('1.2');
    await st().saveGraph('Curves', '', 'major');
    expect(label()).toBe('2.0');
    await st().saveGraph('Curves');
    expect(label()).toBe('2.1');
    expect(listVersions('Curves').map(v => `${v.major}.${v.minor}`)).toEqual(['2.1', '2.0', '1.2', '1.1', '1.0']);
  });

  it('Minor from an older version continues that family after its newest', async () => {
    await st().saveGraph('S', '', 'new');      // 1.0
    await st().saveGraph('S');                 // 1.1
    await st().saveGraph('S', '', 'major');    // 2.0
    const first = listVersions('S').find(v => v.major === 1 && v.minor === 0)!;
    expect(st().loadGraphVersion('S', first.version).ok).toBe(true);
    expect(label()).toBe('1.0');
    await st().saveGraph('S');
    expect(label()).toBe('1.2');
  });

  it('saving under an existing name from elsewhere adds a family', async () => {
    await st().saveGraph('XYZ', '', 'new');
    await st().saveGraph('XYZ');
    useNodeGraphStore.setState({ currentGraph: null });
    await st().saveGraph('XYZ', '', 'new');
    expect(label()).toBe('2.0');
    expect(nextNumber('Fresh', 'new', null)).toEqual({ major: 1, minor: 0 });
  });

  it('save in place keeps the number and replaces the graph', async () => {
    await st().saveGraph('P', 'first', 'new');
    const before = listVersions('P').length;
    await st().saveGraph('P', 'changed', 'inPlace');
    expect(label()).toBe('1.0');
    expect(listVersions('P').length).toBe(before);
    expect(listVersions('P')[0].note).toBe('changed');
  });

  it('graphs saved before series read as 1.(version − 1)', () => {
    expect(numberOf({ version: 1 })).toEqual({ major: 1, minor: 0 });
    expect(numberOf({ version: 4 })).toEqual({ major: 1, minor: 3 });
    expect(numberOf({ version: 4, major: 3, minor: 2 })).toEqual({ major: 3, minor: 2 });
  });

  it('trims by size: oldest tweaks first, each family keeps its first and latest', () => {
    const v = (version: number, major: number, minor: number): GraphVersion => ({ version, major, minor, savedAt: version, payload: 'x'.repeat(100) });
    const hist = [v(1, 1, 0), v(2, 1, 1), v(3, 1, 2), v(4, 1, 3), v(5, 2, 0), v(6, 2, 1), v(7, 2, 2)];
    const kept = trimToSize(hist, 5 * 200);
    expect(kept.map(x => `${x.major}.${x.minor}`)).toEqual(['1.0', '1.3', '2.0', '2.1', '2.2']);
  });

  it('a whole series travels: its history is adopted only by a name with none of its own', async () => {
    await st().saveGraph('Trip', 'a', 'new');
    await st().saveGraph('Trip', 'b');
    await st().saveGraph('Trip', 'c', 'major');
    const history = seriesHistory('Trip');
    expect(history.map(v => `${v.major}.${v.minor}`)).toEqual(['1.0', '1.1']);
    // Arriving under a new name: the versions come with their numbers.
    localStorage.setItem('shader-studio:Trip copy', localStorage.getItem('shader-studio:Trip')!);
    expect(adoptSeriesHistory('Trip copy', history)).toBe(2);
    expect(listVersions('Trip copy').map(v => `${v.major}.${v.minor}`)).toEqual(['2.0', '1.1', '1.0']);
    // A name that has its own past keeps it.
    expect(adoptSeriesHistory('Trip', [{ version: 9, major: 9, minor: 0, savedAt: 1, payload: '{}' }])).toBe(0);
  });
});
