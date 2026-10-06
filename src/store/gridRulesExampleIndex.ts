/**
 * gridRulesExampleIndex.ts — the names and descriptions of the Grid Rules examples (built in
 * gridRulesExamples.ts), and the Simulations: grids folder's order: each Grid Rules version beside
 * the wired one it rebuilds. Light: no node definitions, so the Examples list loads without them.
 */
import { SIM_GRID_EXAMPLE_KEYS } from './simGridExamples';

export const GRID_RULES_EXAMPLE_INDEX: Record<string, { label: string; description: string; play: true }> = {
  gridRulesLife: {
    label: 'Grid sims 1 · Game of Life (Grid Rules)', play: true,
    description: 'Conway\'s Game of Life as one Grid Rules node: born with 3 neighbours, survive with 2 or 3. Open its editor for the switches and presets, hold the mouse button to paint, and use Open as nodes to see the wired graph it stands for.',
  },
  gridRulesLifeLike: {
    label: 'Grid sims 2 · Life-like rules (Grid Rules)', play: true,
    description: 'Day & Night (B3678/S34678) on a Grid Rules node. In its editor, click the Born on and Survive on numbers, or pick HighLife, Seeds, Maze, Coral, Anneal…',
  },
  gridRulesBrain: {
    label: 'Grid sims 3 · Brian\'s Brain (Grid Rules)', play: true,
    description: 'A Stages rule (Generations /2/3): off cells with exactly two on neighbours switch on, on cells start dying, dying cells switch off. The node\'s Texture output feeds a Glow.',
  },
  gridRulesCave: {
    label: 'Grid sims 4 · Cave generator (Grid Rules)', play: true,
    description: 'The 4-5 cave rule as a Count rule (B5678/S45678: rock with 5 or more of its 3×3 block), 8 steps a frame with walls, so a new map smooths itself at once and holds. Change Seed or press Reset for a new map; hold the mouse button to dig.',
  },
  gridRulesWater: {
    label: 'Grid sims 5 · Water ripples (Grid Rules)', play: true,
    description: 'The Waves template of a Smooth rule: height and last height per cell, walls that reflect. Hold the mouse button to push the water.',
  },
  gridRulesHeat: {
    label: 'Grid sims 6 · Heat diffusion (Grid Rules)', play: true,
    description: 'A Smooth rule with a one-line custom update: every cell drifts towards its neighbours, cools a little, and now and then flares. Paint heat with the mouse.',
  },
  gridRulesFire: {
    label: 'Grid sims 7 · Forest fire (Grid Rules)', play: true,
    description: 'The Drossel–Schwabl forest fire in one custom Smooth update: 0 is ground, 1 a tree, 2 fire. Trees grow, lightning (knob D) strikes, fire spreads to the trees beside it and burns out. Click to light trees.',
  },
  gridRulesSand: {
    label: 'Grid sims 8 · Falling sand (Grid Rules)', play: true,
    description: 'A Blocks rule (Margolus 2×2 blocks, the grid shifting every step): grains fall, slide off each other and rest on walls, and none is ever lost or made. Draw sand, or switch the brush to walls.',
  },
  gridRulesWire: {
    label: 'Grid sims 9 · Wireworld (Grid Rules)', play: true,
    description: 'A Patterns rule: three stencils (head → tail, tail → copper, copper → head with 1 or 2 heads round it). A small Expression Block draws the starter circuit into a Pass; its brightness picks each cell\'s state as the board starts.',
  },
  gridRulesCrystal: {
    label: 'Grid sims 10 · Pattern rules: frost (Grid Rules)', play: true,
    description: 'One pattern rule with a count: an empty cell with exactly one frozen cell round it freezes. Arms branch from a few seeds in the middle; Age fade colours them by when they froze. Shows the Patterns editor.',
  },
  gridRulesGas: {
    label: 'Grid sims 11 · Block rules: gas (Grid Rules)', play: true,
    description: 'Toffoli and Margolus\'s HPP gas as four block rules turned four ways: particles fly diagonally and bounce off each other at right angles. A ball of gas in the middle spreads into a diamond. Shows the Blocks editor.',
  },
};

export const GRID_RULES_EXAMPLE_KEYS = Object.keys(GRID_RULES_EXAMPLE_INDEX);

/** The Simulations: grids folder: each Grid Rules version beside the wired one it rebuilds. */
export function simGridsFolderKeys(): string[] {
  const out: string[] = [];
  SIM_GRID_EXAMPLE_KEYS.forEach((k, i) => {
    const rules = GRID_RULES_EXAMPLE_KEYS.find(r => GRID_RULES_EXAMPLE_INDEX[r].label.startsWith(`Grid sims ${i + 1} ·`));
    if (rules) out.push(rules);
    out.push(k);
  });
  for (const k of GRID_RULES_EXAMPLE_KEYS) if (!out.includes(k)) out.push(k);
  return out;
}

