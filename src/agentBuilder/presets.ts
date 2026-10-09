/**
 * presets.ts — the Trail followers' presets strip (docs/agent-builder.md): the trail templates of
 * agentRules/templates.ts, plus four slime variants from the field guide's "What each setting does
 * to the look" (2.6): long veins (small turn), round cells (wide feelers), a busy mesh (big turn)
 * and separate clumps (very wide feelers, little turning). Applying one replaces the group's rule
 * set (as the rules editor's Templates menu does), one undo step.
 */
import type { AgentRuleSet } from '../agentRules/spec';
import { rulesTemplate } from '../agentRules/templates';
import { patchCard, setSensors } from './cards';
import type { SimParams } from './miniSim';

export interface BuilderPreset {
  key: string;
  label: string;
  /** The hover line. */
  hint: string;
  set: () => AgentRuleSet;
  /**
   * Its thumbnail's walkers, when the cards alone don't show its look (miniSim.ts): ants' two
   * smells follow conditional rules; frost is walkers that stick.
   */
  sim?: (p: SimParams) => SimParams;
}

const ANTS_SIM = (p: SimParams): SimParams => ({
  ...p,
  species: [
    { distance: 0.03, angle: 40, turn: 20, away: false, wobble: 5, speed: 0.3, smell: 1, lay: 0, deposit: 1, colour: [0.45, 0.75, 1] },
    { distance: 0.03, angle: 40, turn: 20, away: false, wobble: 5, speed: 0.3, smell: 0, lay: 1, deposit: 1, colour: [1, 0.75, 0.3] },
  ],
});

const tpl = (key: string) => () => structuredClone(rulesTemplate(key)!.set());
const slimeWith = (f: (s: AgentRuleSet) => AgentRuleSet) => () => f(tpl('slime')());

export const TRAIL_PRESETS: readonly BuilderPreset[] = [
  { key: 'slime', label: 'Slime mold', hint: 'Feelers 22.5° apart, turning 45°: networks that keep reorganising.', set: tpl('slime') },
  { key: 'veins', label: 'Long veins', hint: 'A small turn (20°): long smooth veins.', set: slimeWith(s => patchCard(s, 0, 'senses', { degrees: 20 })) },
  { key: 'cells', label: 'Round cells', hint: 'Feelers 45° apart: calmer, rounder cells.', set: slimeWith(s => setSensors(s, { angle: 45 })) },
  { key: 'mesh', label: 'Busy mesh', hint: 'A big turn (90°): a dense mesh with many junctions.', set: slimeWith(s => patchCard(s, 0, 'senses', { degrees: 90 })) },
  { key: 'clumps', label: 'Clumps', hint: 'Feelers 90° apart and a tiny turn: separate round clumps.', set: slimeWith(s => patchCard(setSensors(s, { angle: 90 }), 0, 'senses', { degrees: 12 })) },
  { key: 'ants', label: 'Ants with food', hint: 'Search by one smell, carry home by the other (wire Food and Nest masks).', set: tpl('ants'), sim: ANTS_SIM },
  { key: 'predatorPrey', label: 'Predator & prey', hint: 'Prey follow their own trail and flee the predators\'; predators chase.', set: tpl('predatorPrey') },
  { key: 'dla', label: 'Frost (DLA)', hint: 'Random walkers stick where they touch the crystal: branching frost.', set: tpl('dla'), sim: p => ({ ...p, mode: 'dla' }) },
];

export const trailPreset = (key: string) => TRAIL_PRESETS.find(p => p.key === key);
