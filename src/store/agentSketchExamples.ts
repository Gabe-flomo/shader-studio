/**
 * agentSketchExamples.ts — the Simulation folder's "by hand" example: the
 * Agents group's Slime mold rule as a Script layer (agentSketches.ts), with
 * its settings as Play controls. The group itself runs on web pages and the
 * Present page; this copy stays for its readable code and its "Show the
 * sensors of" view, which "How Agents work" uses on "The loop".
 */
import type { ExampleGraph } from './exampleIndex';
import { AGENT_RULE_INDEX } from './agentExamples';
import { SKETCH_AGENT_SLIME } from './agentSketches';
import { ctl, play, quietGraph, scriptLayer } from './playExamples';

const slider = (layer: string, key: string, label: string, min: number, max: number, step?: number) =>
  ctl(key, `layer:${layer}::p_${key}`, label, min, max, step);

export function buildAgentSketchExamples(): Record<string, ExampleGraph> {
  return {
    agentRuleSlime: {
      ...AGENT_RULE_INDEX.agentRuleSlime, counter: 20, nodes: quietGraph(),
      play: play({
        layers: [scriptLayer('slime', 'Slime rule', SKETCH_AGENT_SLIME, { clear: true })],
        controls: [
          slider('slime', 'angle', 'Sense · Angle', 5, 90, 0.5),
          slider('slime', 'distance', 'Sense · Distance', 0.02, 0.3, 0.005),
          slider('slime', 'sat', 'Crowding · sat', 0, 100, 1),
          slider('slime', 'turn', 'Steer · Turn', 0, 90, 1),
          slider('slime', 'jitter', 'Steer · Jitter', 0, 1, 0.01),
          slider('slime', 'speed', 'Move · Speed', 0.1, 2, 0.05),
          slider('slime', 'deposit', 'Deposit · Amount', 0.1, 5, 0.1),
          slider('slime', 'halfLife', 'Trail · Half-life', 0.01, 0.5, 0.005),
          slider('slime', 'diffuse', 'Trail · Diffuse', 0, 1, 0.05),
          slider('slime', 'steps', 'Agents · Steps per frame', 1, 8, 1),
          slider('slime', 'walkers', 'Agents · Walkers', 2000, 80000, 1000),
          slider('slime', 'species', 'Agents · Species', 1, 3, 1),
          slider('slime', 'sensors', 'Show the sensors of', 0, 40, 1),
        ],
        notes: `**What it shows.** The Agents group's Slime mold rule, written again in plain JavaScript: a few dozen lines you can read and edit, and a view the group can't give, the sensors of a few walkers. Every walker, every step: **Sense** the trail at three points, reshape the readings with **Crowding**, **Steer** by Jones' rule, **Move** one step, **Deposit** trail where it stands. Then the trail **spreads** and **fades**.

**How it's built.** The same rule as the preset, with the nodes' names and units (picture units, one step = 1/60 s), on a 200-row trail with tens of thousands of walkers instead of a million. Species above 1 gives each kind its own trail channel: it follows its own (+1) and avoids the others' (−0.5), like Multi-species slime.

**Try this.**
• Show the sensors of 10 walkers, and watch them pick the strongest smell.
• Sensor angle 45° for calm round cells; Turn 15° for long smooth veins.
• Crowding sat 0 (off): the network coarsens into a few thick loops.
• Species 3 for three colonies carving territories.
• The real thing: Examples → Simulation → Slime mold, then double-click the Agents group.`,
      }),
    },
  };
}
