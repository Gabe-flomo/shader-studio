/**
 * relationshipNesting.ts — how a Relationship layer's members group under it
 * in the Layers list (LayersPanel.tsx). Pure and display-only: it never
 * touches the play record, so it can be recomputed on every render from
 * whatever slice of layers a view is showing.
 *
 * A member nests under the first relationship that claims it, by list order
 * (`layers` order — the caller passes whichever layers are in view, so a
 * member only nests when its relationship is in the same view). Any further
 * relationships it belongs to are its "extra" ones, shown as a small chip.
 */
import type { PlayLayer } from '../types/play';
import type { RelationRole } from '../types/playLayers';

export interface NestedMember {
  id: string;
  role: RelationRole;
}

export interface RelationshipNesting {
  /** Relationship layer id → its members, in role order (chaser, then prey, then member), then list order within a role. */
  byRelationship: ReadonlyMap<string, readonly NestedMember[]>;
  /** Member layer id → every relationship it belongs to, in list order. The first is where it nests. */
  byMember: ReadonlyMap<string, readonly string[]>;
}

const ROLE_ORDER: Record<RelationRole, number> = { chaser: 0, prey: 1, member: 2 };

/**
 * Groups `layers`' Relationship layers with their members. A member id that
 * isn't in `layers` (missing, or filtered out of the current view) is
 * dropped; a relationship can't nest itself.
 */
export function relationshipNesting(layers: readonly PlayLayer[]): RelationshipNesting {
  const idSet = new Set(layers.map(l => l.id));
  const byRelationship = new Map<string, NestedMember[]>();
  const byMember = new Map<string, string[]>();
  for (const l of layers) {
    if (l.kind !== 'relationship') continue;
    const ordered = l.members
      .filter(m => idSet.has(m.id) && m.id !== l.id)
      .map((m, order) => ({ id: m.id, role: m.role, order }))
      .sort((a, b) => (ROLE_ORDER[a.role] - ROLE_ORDER[b.role]) || (a.order - b.order))
      .map(({ id, role }): NestedMember => ({ id, role }));
    byRelationship.set(l.id, ordered);
    for (const m of ordered) {
      const list = byMember.get(m.id);
      if (list) list.push(l.id); else byMember.set(m.id, [l.id]);
    }
  }
  return { byRelationship, byMember };
}

/** The relationship a member visually nests under (the first, by list order), or '' when it belongs to none in view. */
export function primaryRelationshipOf(nesting: RelationshipNesting, memberId: string): string {
  return nesting.byMember.get(memberId)?.[0] ?? '';
}

/** The relationships a member belongs to besides its primary (nesting) one — the "+N" chip. */
export function extraRelationshipsOf(nesting: RelationshipNesting, memberId: string): readonly string[] {
  const list = nesting.byMember.get(memberId);
  return list && list.length > 1 ? list.slice(1) : [];
}

/** Does any relationship in `nesting` have at least one member? (Whether nesting has anything to show.) */
export function hasAnyNesting(nesting: RelationshipNesting): boolean {
  for (const members of nesting.byRelationship.values()) if (members.length) return true;
  return false;
}

export const RELATION_ROLE_LABEL: Record<RelationRole, string> = { chaser: 'Chaser', prey: 'Prey', member: 'Member' };
