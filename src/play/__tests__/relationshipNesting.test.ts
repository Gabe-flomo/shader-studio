/**
 * relationshipNesting: roles order, list-order nesting, multi-membership
 * (the "+N" chip), and missing/filtered member ids.
 */
import { describe, it, expect } from 'vitest';
import { defaultLayer, newRelationMember, type PlayLayer, type RelationshipLayer } from '../../types/playLayers';
import { extraRelationshipsOf, hasAnyNesting, primaryRelationshipOf, relationshipNesting } from '../relationshipNesting';

const rel = (id: string, members: RelationshipLayer['members'], over: Partial<RelationshipLayer> = {}): RelationshipLayer =>
  ({ ...defaultLayer('relationship', id, id), members, ...over } as RelationshipLayer);
const shape = (id: string): PlayLayer => defaultLayer('shape', id, id);

describe('relationshipNesting', () => {
  it('orders members chaser, then prey, then member, preserving list order within a role', () => {
    const r = rel('r1', [
      newRelationMember('m1', 'member'),
      newRelationMember('p1', 'prey'),
      newRelationMember('c1', 'chaser'),
      newRelationMember('p2', 'prey'),
      newRelationMember('c2', 'chaser'),
    ]);
    const layers = [r, shape('m1'), shape('p1'), shape('c1'), shape('p2'), shape('c2')];
    const n = relationshipNesting(layers);
    expect(n.byRelationship.get('r1')?.map(m => m.id)).toEqual(['c1', 'c2', 'p1', 'p2', 'm1']);
  });

  it('nests a member under the first (by list order) relationship it belongs to, and lists extras', () => {
    const r1 = rel('r1', [newRelationMember('x', 'member')]);
    const r2 = rel('r2', [newRelationMember('x', 'member')]);
    const layers = [r1, r2, shape('x')];
    const n = relationshipNesting(layers);
    expect(primaryRelationshipOf(n, 'x')).toBe('r1');
    expect(extraRelationshipsOf(n, 'x')).toEqual(['r2']);
    // The reverse order: r2 first in the list now nests it.
    const n2 = relationshipNesting([r2, r1, shape('x')]);
    expect(primaryRelationshipOf(n2, 'x')).toBe('r2');
    expect(extraRelationshipsOf(n2, 'x')).toEqual(['r1']);
  });

  it('drops a member id that is missing from the given layers (or filtered out of the view)', () => {
    const r = rel('r1', [newRelationMember('gone', 'member'), newRelationMember('here', 'member')]);
    const layers = [r, shape('here')]; // 'gone' isn't in view
    const n = relationshipNesting(layers);
    expect(n.byRelationship.get('r1')?.map(m => m.id)).toEqual(['here']);
    expect(primaryRelationshipOf(n, 'gone')).toBe('');
  });

  it('never nests a relationship under itself even if it lists its own id', () => {
    const r = rel('r1', [{ ...newRelationMember('r1', 'member') }]);
    const n = relationshipNesting([r]);
    expect(n.byRelationship.get('r1')).toEqual([]);
  });

  it('a member with no relationship in view has no primary and no extras', () => {
    const n = relationshipNesting([shape('solo')]);
    expect(primaryRelationshipOf(n, 'solo')).toBe('');
    expect(extraRelationshipsOf(n, 'solo')).toEqual([]);
  });

  it('hasAnyNesting is false with no members, true once one relationship has one', () => {
    const empty = relationshipNesting([rel('r1', [])]);
    expect(hasAnyNesting(empty)).toBe(false);
    const full = relationshipNesting([rel('r1', [newRelationMember('a', 'member')]), shape('a')]);
    expect(hasAnyNesting(full)).toBe(true);
  });
});
