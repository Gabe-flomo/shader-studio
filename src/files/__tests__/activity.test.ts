/** The Files home's activity log: recording, the cap, totals per kind and the calendar's day buckets. */
import { describe, it, expect } from 'vitest';
import { memoryKV } from '../mutate';
import { ACTIVITY_KEY, ACTIVITY_LOG_CAP, activitySince, activityTotals, calendarBuckets, clearActivity, describeCount, readActivity, recordActivity, startActivity } from '../activity';

const day = (y: number, m: number, d: number, h = 12) => new Date(y, m, d, h).getTime();

describe('activity log', () => {
  it('records events with a label and starts counting at the first one', () => {
    const kv = memoryKV();
    expect(readActivity(kv)).toEqual([]);
    expect(activitySince(kv)).toBe(0);
    recordActivity('save', 'Sunset', 1000, kv);
    recordActivity('render', undefined, 2000, kv);
    expect(readActivity(kv)).toEqual([{ at: 1000, kind: 'save', label: 'Sunset' }, { at: 2000, kind: 'render' }]);
    expect(activitySince(kv)).toBe(1000);
    expect(JSON.parse(kv.get(ACTIVITY_KEY)!).events).toHaveLength(2);
  });

  it('starts counting on first open without any events, and keeps that start', () => {
    const kv = memoryKV();
    expect(startActivity(500, kv)).toBe(500);
    expect(startActivity(900, kv)).toBe(500);
    recordActivity('take', 'Take 1', 1200, kv);
    expect(activitySince(kv)).toBe(500);
  });

  it('caps the log, dropping the oldest', () => {
    const kv = memoryKV();
    for (let i = 0; i < ACTIVITY_LOG_CAP + 25; i++) recordActivity('save', undefined, i + 1, kv);
    const ev = readActivity(kv);
    expect(ev).toHaveLength(ACTIVITY_LOG_CAP);
    expect(ev[0].at).toBe(26);
    expect(ev[ev.length - 1].at).toBe(ACTIVITY_LOG_CAP + 25);
  });

  it('ignores junk in storage and clears', () => {
    const kv = memoryKV({ [ACTIVITY_KEY]: JSON.stringify({ since: 5, events: [{ at: 1, kind: 'save' }, { at: 'x', kind: 'save' }, { at: 2, kind: 'dance' }, null] }) });
    expect(readActivity(kv)).toEqual([{ at: 1, kind: 'save' }]);
    expect(activitySince(kv)).toBe(5);
    clearActivity(kv);
    expect(readActivity(kv)).toEqual([]);
    expect(readActivity(memoryKV({ [ACTIVITY_KEY]: '{not json' }))).toEqual([]);
  });

  it('totals the last 7 days per kind with one bucket per day', () => {
    const now = day(2026, 8, 27, 15); // 27 September 2026
    const events = [
      { at: day(2026, 8, 27, 9), kind: 'save' as const },
      { at: day(2026, 8, 27, 14), kind: 'save' as const },
      { at: day(2026, 8, 25), kind: 'save' as const },
      { at: day(2026, 8, 21, 0), kind: 'save' as const }, // 7th day back: counts
      { at: day(2026, 8, 20, 23), kind: 'save' as const }, // 8 days back: not this week
      { at: day(2026, 8, 26), kind: 'render' as const },
      { at: now + 60_000, kind: 'take' as const }, // the future doesn't count
    ];
    const t = activityTotals(events, now, 7);
    const saves = t.find(x => x.kind === 'save')!;
    expect(saves.count).toBe(4);
    expect(saves.perDay).toEqual([1, 0, 0, 0, 1, 0, 2]);
    expect(t.find(x => x.kind === 'render')!.perDay).toEqual([0, 0, 0, 0, 0, 1, 0]);
    expect(t.find(x => x.kind === 'take')!.count).toBe(0);
    expect(activityTotals(events, now, 30).find(x => x.kind === 'save')!.count).toBe(5);
    expect(activityTotals(events, now, 30).find(x => x.kind === 'save')!.perDay).toHaveLength(30);
  });

  it('buckets a month by day', () => {
    const events = [
      { at: day(2026, 8, 3), kind: 'save' as const },
      { at: day(2026, 8, 3, 18), kind: 'import' as const },
      { at: day(2026, 8, 30, 23), kind: 'save' as const },
      { at: day(2026, 9, 1, 0), kind: 'save' as const },
      { at: day(2026, 7, 31, 23), kind: 'save' as const },
    ];
    const b = calendarBuckets(events, 2026, 8);
    expect([...b.keys()].sort((a, c) => a - c)).toEqual([3, 30]);
    expect(b.get(3)).toHaveLength(2);
    expect(calendarBuckets(events, 2026, 9).get(1)).toHaveLength(1);
  });

  it('describes counts', () => {
    expect(describeCount('save', 14)).toBe('14 saves');
    expect(describeCount('render', 1)).toBe('1 render');
    expect(describeCount('take', 0)).toBe('no takes');
  });
});
