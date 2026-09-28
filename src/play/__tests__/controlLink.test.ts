/** controlLink.ts — quick-linking two controls (Controls page, ⌘-click). */
import { describe, expect, it } from 'vitest';
import { findControlLink, linkControls } from '../controlLink';
import { emptyPlayRecord, type PlayControl, type PlayRecord } from '../../types/play';

function withControls(...controls: PlayControl[]): PlayRecord {
  return { ...emptyPlayRecord(), controls };
}

const lows: PlayControl = { id: 'lows', target: 'reader::lows', kind: 'float', label: 'Lows', min: 0, max: 1 };
const radius: PlayControl = { id: 'radius', target: 'n1::radius', kind: 'float', label: 'Circle SDF · Radius', min: 0.01, max: 2 };

describe('linkControls', () => {
  it('makes the source drive the target, with the target’s own range', () => {
    const play = withControls(lows, radius);
    const r = linkControls(play, lows.id, radius.id);
    expect(r).not.toBeNull();
    const mapping = r!.mapping;
    expect(mapping.controlId).toBe(radius.id);
    expect(mapping.source).toEqual({ kind: 'control', controlId: lows.id });
    expect(mapping.outMin).toBe(radius.min);
    expect(mapping.outMax).toBe(radius.max);
    expect(mapping.curve).toBe('linear');
    expect(mapping.enabled).toBe(true);
    expect(r!.play.mappings).toHaveLength(1);
    expect(r!.play.mappings[0]).toBe(mapping);
    // The rest of the record is untouched.
    expect(r!.play.controls).toBe(play.controls);
  });

  it('runs the other way just as well, with ids swapped', () => {
    const play = withControls(lows, radius);
    const r = linkControls(play, radius.id, lows.id);
    expect(r!.mapping.controlId).toBe(lows.id);
    expect(r!.mapping.source).toEqual({ kind: 'control', controlId: radius.id });
    expect(r!.mapping.outMin).toBe(lows.min);
    expect(r!.mapping.outMax).toBe(lows.max);
  });

  it('refuses a control linked to itself', () => {
    const play = withControls(lows);
    expect(linkControls(play, lows.id, lows.id)).toBeNull();
  });

  it('refuses an id that isn’t a control on the panel', () => {
    const play = withControls(lows);
    expect(linkControls(play, lows.id, 'ghost')).toBeNull();
    expect(linkControls(play, 'ghost', lows.id)).toBeNull();
  });

  it('is additive: existing mappings and controls stay', () => {
    const other: PlayControl = { id: 'x', target: 'n2::x', kind: 'float', label: 'X', min: 0, max: 1 };
    const play: PlayRecord = {
      ...withControls(lows, radius, other),
      mappings: [{ id: 'map:old', controlId: other.id, source: { kind: 'mouse', axis: 'x' }, outMin: 0, outMax: 1, curve: 'linear', smoothMs: 0, enabled: true }],
    };
    const r = linkControls(play, lows.id, radius.id)!;
    expect(r.play.mappings).toHaveLength(2);
    expect(r.play.mappings[0]).toBe(play.mappings[0]);
  });
});

describe('findControlLink', () => {
  it('finds a link regardless of which side it was made from', () => {
    const play = withControls(lows, radius);
    const forward = linkControls(play, lows.id, radius.id)!.play;
    expect(findControlLink(forward, lows.id, radius.id)?.id).toBe(forward.mappings[0].id);
    expect(findControlLink(forward, radius.id, lows.id)?.id).toBe(forward.mappings[0].id);
  });

  it('is undefined with no link between them', () => {
    const play = withControls(lows, radius);
    expect(findControlLink(play, lows.id, radius.id)).toBeUndefined();
  });

  it('ignores a disabled mapping, and one to or from a third control', () => {
    const other: PlayControl = { id: 'x', target: 'n2::x', kind: 'float', label: 'X', min: 0, max: 1 };
    const play: PlayRecord = {
      ...withControls(lows, radius, other),
      mappings: [
        { id: 'm1', controlId: radius.id, source: { kind: 'control', controlId: lows.id }, outMin: 0, outMax: 1, curve: 'linear', smoothMs: 0, enabled: false },
        { id: 'm2', controlId: other.id, source: { kind: 'control', controlId: lows.id }, outMin: 0, outMax: 1, curve: 'linear', smoothMs: 0, enabled: true },
      ],
    };
    expect(findControlLink(play, lows.id, radius.id)).toBeUndefined();
    expect(findControlLink(play, lows.id, other.id)?.id).toBe('m2');
  });

  it('ignores a mapping from a non-control source', () => {
    const play: PlayRecord = {
      ...withControls(lows, radius),
      mappings: [{ id: 'm1', controlId: radius.id, source: { kind: 'mouse', axis: 'x' }, outMin: 0, outMax: 1, curve: 'linear', smoothMs: 0, enabled: true }],
    };
    expect(findControlLink(play, lows.id, radius.id)).toBeUndefined();
  });
});
