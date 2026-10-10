/**
 * Saved graphs by when they were last worked on: Today (24 h), This week (7 days), Earlier,
 * newest first, where "worked on" is the latest save of any version in the series.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  const ls: Record<string, string> = {};
  const hidden = (k: string, v: unknown) => Object.defineProperty(ls, k, { value: v, enumerable: false });
  hidden('getItem', (k: string) => (Object.prototype.hasOwnProperty.call(ls, k) ? ls[k] : null));
  hidden('setItem', (k: string, v: string) => { ls[k] = String(v); });
  hidden('removeItem', (k: string) => { delete ls[k]; });
  hidden('clear', () => { for (const k of Object.keys(ls)) delete ls[k]; });
  vi.stubGlobal('localStorage', ls);
});
import { DAY_MS, WEEK_MS, groupByTime, groupGraphsByTime, lastWorkedOn, sortGraphsByRecent, timeBucket } from '../graphRecency';

const NOW = 1_800_000_000_000;

describe('time buckets', () => {
  it('splits at exactly 24 hours and 7 days', () => {
    expect(timeBucket(NOW, NOW)).toBe('today');
    expect(timeBucket(NOW - DAY_MS + 1, NOW)).toBe('today');
    expect(timeBucket(NOW - DAY_MS, NOW)).toBe('week');
    expect(timeBucket(NOW - WEEK_MS + 1, NOW)).toBe('week');
    expect(timeBucket(NOW - WEEK_MS, NOW)).toBe('earlier');
    expect(timeBucket(NOW - 400 * DAY_MS, NOW)).toBe('earlier');
  });

  it('a save with no date (older graphs) is Earlier', () => {
    expect(timeBucket(0, NOW)).toBe('earlier');
    expect(timeBucket(Number.NaN, NOW)).toBe('earlier');
  });

  it('groups newest first, leaves out empty groups, and puts undated ones last by name', () => {
    const items = [
      { n: 'b', t: NOW - 2 * DAY_MS }, { n: 'a', t: NOW - 1000 }, { n: 'old', t: NOW - 30 * DAY_MS },
      { n: 'z-undated', t: 0 }, { n: 'c', t: NOW - 3 * DAY_MS }, { n: 'a-undated', t: 0 }, { n: 'd', t: NOW - 60_000 },
    ];
    const groups = groupByTime(items, i => i.t, i => i.n, NOW);
    expect(groups.map(g => [g.label, g.items.map(i => i.n)])).toEqual([
      ['Today', ['a', 'd']],
      ['This week', ['b', 'c']],
      ['Earlier', ['old', 'a-undated', 'z-undated']],
    ]);
    expect(groupByTime([{ n: 'x', t: NOW - 9 * DAY_MS }], i => i.t, i => i.n, NOW).map(g => g.id)).toEqual(['earlier']);
  });
});

describe('when a series was last worked on', () => {
  beforeEach(() => localStorage.clear());

  it('is the latest save of any version, not only the newest one', () => {
    // The newest version (1.2) was saved 3 days ago; 1.0 was saved over in place an hour ago.
    const graph = (savedAt: number) => JSON.stringify({ nodes: [], savedAt, version: 3, major: 1, minor: 2 });
    localStorage.setItem('shader-studio:Glow', graph(NOW - 3 * DAY_MS));
    localStorage.setItem('shader-studio-versions:Glow', JSON.stringify([
      { version: 1, major: 1, minor: 0, savedAt: NOW - 3600_000, payload: JSON.stringify({ nodes: [], savedAt: NOW + 99 * DAY_MS }) },
      { version: 2, major: 1, minor: 1, savedAt: NOW - 5 * DAY_MS, payload: '{}' },
    ]));
    // The time inside a stored graph (escaped) doesn't count; the version's own does.
    expect(lastWorkedOn('Glow')).toBe(NOW - 3600_000);
    localStorage.setItem('shader-studio:Plain', graph(NOW - 2 * DAY_MS));
    expect(lastWorkedOn('Plain')).toBe(NOW - 2 * DAY_MS);
    localStorage.setItem('shader-studio:Ancient', JSON.stringify({ nodes: [] }));
    expect(lastWorkedOn('Ancient')).toBe(0);
    expect(sortGraphsByRecent(['Ancient', 'Plain', 'Glow'])).toEqual(['Glow', 'Plain', 'Ancient']);
    expect(groupGraphsByTime(['Ancient', 'Plain', 'Glow'], NOW).map(g => [g.id, g.items])).toEqual([['today', ['Glow']], ['week', ['Plain']], ['earlier', ['Ancient']]]);
  });

  it('notices a new save (no stale cache)', () => {
    localStorage.setItem('shader-studio:Glow', JSON.stringify({ nodes: [], savedAt: 5 }));
    expect(lastWorkedOn('Glow')).toBe(5);
    localStorage.setItem('shader-studio:Glow', JSON.stringify({ nodes: [], savedAt: 7 }));
    expect(lastWorkedOn('Glow')).toBe(7);
  });
});
