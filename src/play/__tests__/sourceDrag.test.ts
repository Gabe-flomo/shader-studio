/**
 * Dragging a source onto a control (inputs/sourceDrag.ts): only our own drag
 * type lights a control up; a drop makes the route a Map click would, or says
 * why it can't.
 */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});
import { SOURCE_DRAG_TYPE, dropOutcome, isSourceDrag, sourceIdOfDrop } from '../../components/play/inputs/sourceDrag';
import { routeToControl } from '../routeOps';
import { NOTE_REF_TYPE } from '../../components/play/noteRefs';
import { emptyPlayRecord, ROUTES_PER_SOURCE_MAX, type PlayControl, type PlayMapping, type PlayRecord } from '../../types/play';

const ctl = (id: string): PlayControl => ({ id, target: `n::${id}`, kind: 'float', label: id, min: 0, max: 10 });
const knob: PlayMapping = { id: 'm1', controlId: 'a', source: { kind: 'mouse', axis: 'x' }, outMin: 0, outMax: 10, curve: 'linear', smoothMs: 0, enabled: true };
const base = (): PlayRecord => ({ ...emptyPlayRecord(), controls: [ctl('a'), ctl('b')], mappings: [knob] });

describe('dragging a source onto a control', () => {
  it('only a source drag counts', () => {
    expect(SOURCE_DRAG_TYPE).not.toBe(NOTE_REF_TYPE);
    expect(isSourceDrag(['text/plain', SOURCE_DRAG_TYPE])).toBe(true);
    expect(isSourceDrag([NOTE_REF_TYPE, 'text/plain'])).toBe(false);
    expect(isSourceDrag(['Files'])).toBe(false);
    expect(isSourceDrag(null)).toBe(false);
  });

  it('reads the id it carries', () => {
    expect(sourceIdOfDrop(' src_k3_1 ')).toBe('src_k3_1');
    expect(sourceIdOfDrop('m-1')).toBe('m-1');
    expect(sourceIdOfDrop('')).toBeNull();
    expect(sourceIdOfDrop('two words')).toBeNull();
    expect(sourceIdOfDrop(null)).toBeNull();
  });

  it('routes onto a new control; says why not onto one it drives, a missing one, or when full', () => {
    expect(dropOutcome(base(), 'm1', 'b')).toBe('route');
    expect(dropOutcome(base(), 'm1', 'a')).toBe('already');
    expect(dropOutcome(base(), 'm1', 'zz')).toBe('missing');
    expect(dropOutcome(base(), 'nope', 'b')).toBe('missing');
    const routed = routeToControl(base(), 'm1', 'b').play;
    expect(dropOutcome(routed, 'm1', 'b')).toBe('already');
    const full: PlayRecord = { ...base(), mappings: [], sources: [{ id: 's', enabled: true, source: { kind: 'mouse', axis: 'y' }, outputs: [{ kind: 'value', routes: Array.from({ length: ROUTES_PER_SOURCE_MAX }, (_, i) => ({ id: `r${i}`, to: `x${i}`, mode: 'replace' as const, outMin: 0, outMax: 1, curve: 'linear' as const, enabled: true })) }] }] };
    expect(dropOutcome(full, 's', 'b')).toBe('full');
  });
});
