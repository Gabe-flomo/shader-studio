/**
 * agentSketchExamples.ts — the Simulation folder's "by hand" examples: the
 * Agents group's Slime mold, Particles and Ants rules as Script layers
 * (agentSketches.ts), with their settings as Play controls. They run on the
 * web player, so the "How Agents work" presentation shows them live where the
 * group itself can only be a still (pages don't run Agents groups yet).
 */
import type { ExampleGraph } from './exampleIndex';
import { AGENT_RULE_INDEX } from './agentExamples';
import { SKETCH_AGENT_ANTS, SKETCH_AGENT_PARTICLES, SKETCH_AGENT_SLIME } from './agentSketches';
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
        notes: `**What it shows.** The Agents group's Slime mold rule, written again in plain JavaScript so it runs anywhere (web pages and the Present page don't run the group itself yet). Every walker, every step: **Sense** the trail at three points, reshape the readings with **Crowding**, **Steer** by Jones' rule, **Move** one step, **Deposit** trail where it stands. Then the trail **spreads** and **fades**.

**How it's built.** The same rule as the preset, with the nodes' names and units (picture units, one step = 1/60 s), on a 200-row trail with tens of thousands of walkers instead of a million. Species above 1 gives each kind its own trail channel: it follows its own (+1) and avoids the others' (−0.5), like Multi-species slime.

**Try this.**
• Show the sensors of 10 walkers, and watch them pick the strongest smell.
• Sensor angle 45° for calm round cells; Turn 15° for long smooth veins.
• Crowding sat 0 (off): the network coarsens into a few thick loops.
• Species 3 for three colonies carving territories.
• The real thing: Examples → Simulation → Slime mold, then double-click the Agents group.`,
      }),
    },
    agentRuleParticles: {
      ...AGENT_RULE_INDEX.agentRuleParticles, counter: 20, nodes: quietGraph(),
      play: play({
        layers: [scriptLayer('parts', 'Particles rule', SKETCH_AGENT_PARTICLES, { clear: true })],
        controls: [
          slider('parts', 'gravity', 'Gravity', -1.5, 1.5, 0.05),
          slider('parts', 'curl', 'Curl noise · Strength', 0, 2, 0.05),
          slider('parts', 'curlSize', 'Curl noise · Size', 0.3, 4, 0.1),
          slider('parts', 'evolve', 'Curl noise · Evolve', 0, 1, 0.05),
          slider('parts', 'vortex', 'Vortex · Strength', -1.5, 1.5, 0.05),
          slider('parts', 'attract', 'Attract (mouse) · Strength', -3, 3, 0.1),
          slider('parts', 'shock', 'Sound kick · Strength', 0, 3, 0.05),
          slider('parts', 'beat', 'Sound kick · Beat', 30, 200, 1),
          slider('parts', 'drag', 'Integrate · Drag', 0, 6, 0.1),
          slider('parts', 'maxSpeed', 'Integrate · Max speed', 0.2, 8, 0.1),
          slider('parts', 'life', 'Emit · Life', 0.5, 12, 0.1),
          slider('parts', 'steps', 'Agents · Steps per frame', 1, 6, 1),
        ],
        notes: `**What it shows.** The Agents group's Particles rule in plain JavaScript: a chain of forces (Gravity, Curl noise, Vortex, Attract to the mouse, a Sound kick shockwave on a silent beat) added up, then **Integrate** turns the total into motion (drag, max speed) and **Age / Life** ends each particle; Emit's Keep full gives it a new life on the ring.

**Try this.**
• Move over the picture: the mouse pulls and stirs.
• Curl Strength 0: only the swirl is left. Curl Size 3: small, tight eddies.
• Sound kick 1.5 for the Sound burst preset's blasts; Drag 3 to settle them fast.
• Gravity −0.5 and Vortex 0 for rising smoke.
• The real thing: Examples → Simulation → Particles from nodes.`,
      }),
    },
    agentRuleAnts: {
      ...AGENT_RULE_INDEX.agentRuleAnts, counter: 20, nodes: quietGraph(),
      play: play({
        layers: [scriptLayer('ants', 'Ants rule', SKETCH_AGENT_ANTS, { clear: true })],
        controls: [
          slider('ants', 'angle', 'Sense · Angle', 5, 90, 1),
          slider('ants', 'distance', 'Sense · Distance', 0.02, 0.2, 0.005),
          slider('ants', 'turn', 'Steer · Turn', 0, 90, 1),
          slider('ants', 'jitter', 'Steer · Jitter', 0, 1, 0.01),
          slider('ants', 'speed', 'Move · Speed', 0.1, 1.5, 0.05),
          slider('ants', 'halfLife', 'Trail · Half-life', 0.2, 10, 0.1),
          slider('ants', 'fade', 'Deposit · Weakens over', 1, 30, 0.5),
          slider('ants', 'rock', 'Obstacle · Rock size', 0, 0.7, 0.01),
          slider('ants', 'steps', 'Agents · Steps per frame', 1, 8, 1),
          slider('ants', 'ants', 'Agents · Ants', 500, 12000, 500),
        ],
        notes: `**What it shows.** The Agents group's Ants rule in plain JavaScript. Each ant keeps a **Memory** from step to step: is it carrying food, and how long has it walked? Searching ants follow the food smell and lay the home smell; carrying ants follow the home smell and lay the food smell, weaker the longer they walked. Short roads get more fresh smell than long ones, so the roads straighten.

**Try this.**
• Wait 20 seconds: roads form from the nest to the food and bend round the rock.
• Rock size 0: the roads straighten into the short way.
• Smell half-life 0.5: the smell fades before roads can form.
• The real thing: Examples → Simulation → Ants.`,
      }),
    },
  };
}
