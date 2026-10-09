/**
 * kinds.ts — the Agent Builder's start page, "What are you making?" (docs/agent-builder.md): five
 * kinds of walker, each mapped to the rule sets' WalkerKind (agentRules/spec.ts) and the template
 * it starts from. Ants / carriers is a Trail followers preset.
 *
 * Crowds have a card of their own, though they are built with the Flocks sections: a crowd is a
 * flock with somewhere to go (Head for) that slows in a jam, and what you make looks different
 * (people in lanes, not birds), so it starts from its own setup (two kinds walking opposite ways).
 */
import type { WalkerKind } from '../agentRules/spec';

export type StartKind = 'trail' | 'particles' | 'flock' | 'crowd' | 'orbit';

export interface StartCard {
  id: StartKind;
  label: string;
  /** A few words under the name. */
  makes: string;
  /** The rule sets' kind. */
  kind: WalkerKind;
  /** The 2D template it starts from (agentRules/templates.ts) and the 3D one (space3d.ts). */
  template: string;
  template3d: string;
  /** Built in the new builder (all of them since phase 2). */
  built: boolean;
}

export const START_CARDS: readonly StartCard[] = [
  { id: 'trail', label: 'Trail followers', makes: 'slime, ants, veins', kind: 'trail', template: 'slime', template3d: 'slime3d', built: true },
  { id: 'particles', label: 'Particles', makes: 'sparks, smoke, dust', kind: 'particles', template: 'particles', template3d: 'curl3d', built: true },
  { id: 'flock', label: 'Flocks', makes: 'boids, swarms, schools', kind: 'flock', template: 'boids', template3d: 'flock3d', built: true },
  { id: 'crowd', label: 'Crowds', makes: 'people, traffic, lanes', kind: 'crowd', template: 'crowd', template3d: 'flock3d', built: true },
  { id: 'orbit', label: 'Orbiters', makes: 'galaxies, vortices', kind: 'swarm', template: 'swarm', template3d: 'orbiters3d', built: true },
];

export const startCard = (id: StartKind) => START_CARDS.find(c => c.id === id)!;

/** Rule set kinds the new builder edits: every kind (the rules editor stays for Advanced rules). */
export const BUILDER_KINDS: ReadonlySet<WalkerKind> = new Set<WalkerKind>(['trail', 'ants', 'particles', 'flock', 'crowd', 'swarm']);
