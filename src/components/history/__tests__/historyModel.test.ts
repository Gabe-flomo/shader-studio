/** The History panel's time groups and card kinds. */
import { describe, expect, it } from 'vitest';
import { activityKind, groupByTime, stepKind, timeBucket } from '../historyModel';
import type { StepDiff } from '../../../store/historyLabels';

const at = (y: number, mo: number, d: number, h = 12, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();
const now = at(2026, 9, 27, 15, 0);

describe('timeBucket', () => {
  it('groups by how long ago', () => {
    expect(timeBucket(now - 60_000, now)).toBe('Just now');
    expect(timeBucket(now - 20 * 60_000, now)).toBe('Last hour');
    expect(timeBucket(at(2026, 9, 27, 9), now)).toBe('Earlier today');
    expect(timeBucket(at(2026, 9, 26, 23), now)).toBe('Yesterday');
    expect(timeBucket(at(2026, 9, 23), now)).toBe('Earlier this week');
    expect(timeBucket(at(2026, 8, 1), now)).toBe('Older');
    expect(timeBucket(now + 5000, now)).toBe('Just now');
  });

  it('starts a new run whenever the group changes, keeping the order', () => {
    const items = [now - 1000, now - 30 * 60_000, now - 40 * 60_000, now - 2000];
    expect(groupByTime(items, t => t, now).map(g => [g.bucket, g.items.length])).toEqual([
      ['Just now', 1], ['Last hour', 2], ['Just now', 1],
    ]);
  });
});

const empty: StepDiff = { added: [], removed: [], params: [], wires: [], moved: [], other: [], touchedTopIds: [], changedCount: 0 };
const ref = { key: 'n1', id: 'n1', topId: 'n1', name: 'Circle' };

describe('card kinds', () => {
  it('reads an undo step', () => {
    expect(stepKind({ ...empty, added: [ref] })).toBe('added');
    expect(stepKind({ ...empty, removed: [ref] })).toBe('removed');
    expect(stepKind({ ...empty, params: [{ ...ref, param: 'radius', label: 'Radius', from: '0.3', to: '0.4' }] })).toBe('edit');
    expect(stepKind({ ...empty, params: [{ ...ref, param: '__comment', label: 'Comment', from: null, to: null }] })).toBe('comment');
    expect(stepKind({ ...empty, wires: [{ kind: 'added', fromName: 'UV', toName: 'Circle', fromPort: 'uv', toPort: 'p', toTopId: 'n1', fromTopId: 'n0' }] })).toBe('wiring');
    expect(stepKind({ ...empty, moved: [ref] })).toBe('moved');
    expect(stepKind(empty)).toBe('graph');
  });

  it('reads a notice', () => {
    expect(activityKind({ kind: 'error', title: 'Export failed' })).toBe('error');
    expect(activityKind({ kind: 'success', title: 'Exported a play file' })).toBe('export');
    expect(activityKind({ kind: 'success', title: 'Imported shader.glsl' })).toBe('import');
    expect(activityKind({ kind: 'info', title: 'Play setup loaded' })).toBe('import');
    expect(activityKind({ kind: 'info', title: 'Added a control' })).toBe('play');
    expect(activityKind({ kind: 'success', title: 'Saved “Waves”' })).toBe('saved');
    expect(activityKind({ kind: 'info', title: 'Went back 2 steps' })).toBe('info');
  });
});
