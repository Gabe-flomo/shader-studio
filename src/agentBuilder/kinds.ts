/**
 * kinds.ts — the Agent Builder's start page, "What are you making?" (docs/agent-builder.md): four
 * kinds of walker, each mapped to the rule sets' WalkerKind (agentRules/spec.ts) and the template
 * it starts from. Ants / carriers and Crowd are not cards: Ants is a Trail followers preset, and
 * Crowd waits for phase 2 (Flocks).
 *
 * Phase 1 builds Trail followers in the new builder; the other three make their setup and open
 * the rules editor (AgentRulesModal) until their sections are built.
 */
import type { WalkerKind } from '../agentRules/spec';

export type StartKind = 'trail' | 'particles' | 'flock' | 'orbit';

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
  /** Built in the new builder (phase 1: Trail followers only); the others open the rules editor. */
  built: boolean;
}

export const START_CARDS: readonly StartCard[] = [
  { id: 'trail', label: 'Trail followers', makes: 'slime, ants, veins', kind: 'trail', template: 'slime', template3d: 'slime3d', built: true },
  { id: 'particles', label: 'Particles', makes: 'sparks, smoke, dust', kind: 'particles', template: 'particles', template3d: 'curl3d', built: false },
  { id: 'flock', label: 'Flocks', makes: 'boids, crowds, swarms', kind: 'flock', template: 'boids', template3d: 'flock3d', built: false },
  { id: 'orbit', label: 'Orbiters', makes: 'galaxies, vortices', kind: 'swarm', template: 'swarm', template3d: 'orbiters3d', built: false },
];

export const startCard = (id: StartKind) => START_CARDS.find(c => c.id === id)!;

/** Rule set kinds the new builder edits (the rest open the rules editor). */
export const BUILDER_KINDS: ReadonlySet<WalkerKind> = new Set<WalkerKind>(['trail', 'ants']);
