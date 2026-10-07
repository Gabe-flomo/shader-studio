/**
 * agentRuleExamples.ts — the "Agents: rules" folder (docs/agent-rules.md): the Agent Rules
 * templates as examples. Each is an Agents group in rules mode (its behaviour as When … Do …
 * lines; Edit rules on the card) with the setup round it; every node has a note, and the group's
 * note lists the rules as sentences and points to the node version where there is one.
 */
import type { ExampleGraph } from './exampleIndex';
import { rulesTemplateNodes } from '../agentRules/templates';

export const AGENT_RULE_EXAMPLE_INDEX: Record<string, { label: string; description: string }> = {
  agentRulesSlime: {
    label: 'Agent rules 1 · Slime mold',
    description: 'The slime-mold walker as one rule: "When always → turn toward its own trail, wander, leave trail". Press Edit rules on the Agents card to change it, or Open as nodes to see the nodes it makes. The node version: Simulation → Slime mold.',
  },
  agentRulesAnts: {
    label: 'Agent rules 2 · Ants with food',
    description: 'Ants in six rules with two states (searching, carrying) and two masks (Food, Nest): searching ants lay the home smell and follow the food smell, carrying ants the other way round; they turn at the food and at the nest. The node version: Simulation → Ants.',
  },
  agentRulesBoids: {
    label: 'Agent rules 3 · Flock (boids)',
    description: 'Kind: Flock. Boids in one rule, from the birds themselves (Neighbours): steer away from the birds near it, match their heading, drift to their centre, wobble. Flocks gather, keep their spacing and wheel together. (It used to read a blurred velocity trail.) The node version: Simulation → Boids.',
  },
  agentRulesPredatorPrey: {
    label: 'Agent rules 4 · Predator & prey',
    description: 'Two species. Prey graze along their own trail and flee the predators\' smell (turning yellow); predators chase the prey\'s smell; prey caught in thick predator smell die and are born again elsewhere. The node version (with births, energy and grass): Simulations: agents → Predators and prey.',
  },
  agentRulesSir: {
    label: 'Agent rules 5 · Infection (SIR)',
    description: 'Healthy, sick and recovered as three states with a timer in the Memory number. The sick leave germs; the healthy walking through germs may fall sick (a chance a second); the sick recover after 5 s; immunity wanes after 20 s, so waves come back. The node version: Simulations: agents → Infection spread (SIR).',
  },
  agentRulesTermites: {
    label: 'Agent rules 6 · Termites',
    description: 'Termites pick up wood chips (leave trail −1) and drop them on other chips (+1): scattered chips gather into piles, with no termite knowing where a pile is. The node version: Simulations: agents → Termites and wood chips.',
  },
  agentRulesFireflies: {
    label: 'Agent rules 7 · Fireflies',
    description: 'A sparse swarm of fireflies, each flashing when its clock (the Memory number) reaches 1. One past the middle of its cycle that sees a neighbour\'s flash flashes at once: light runs through the swarm in waves. The node version: Simulations: agents → Fireflies flashing in time.',
  },
  agentRulesDla: {
    label: 'Agent rules 8 · DLA growth',
    description: 'Diffusion-limited aggregation: free walkers wander until they touch the seed or the crystal, then stick and become part of it. Branching frost grows from the middle. The node version: Simulations: agents → Diffusion-limited aggregation.',
  },
  agentRulesParticles: {
    label: 'Agent rules 9 · Particles: spark fountain',
    description: 'Kind: Particles. No sensing: sparks shot up from a fountain, moved by forces (gravity, curl noise, drag), fading over three seconds and born again when they die. A switched-off rule pushes them away from the mouse: turn it on in Edit rules.',
  },
  agentRulesSwarm: {
    label: 'Agent rules 10 · Swarm: orbiters',
    description: 'Kind: Swarm. Walkers circle the middle, keep apart from their neighbours and drift toward them; where more than 250 pack in they turn orange and speed out, so the ring breathes.',
  },
  agentRulesCrowd: {
    label: 'Agent rules 11 · Crowd: two-way walkers',
    description: 'Kind: Crowd. Two crowds walk opposite ways; each walker steps out of the other kind\'s way, keeps a little apart and slows as the crowd round it thickens, all from Neighbours. Lanes form by themselves. The node version: Simulations: agents → Crowd: lanes in two-way traffic.',
  },
};

/** The ordered keys, for the Agents: rules folder. */
export const AGENT_RULE_EXAMPLE_KEYS = Object.keys(AGENT_RULE_EXAMPLE_INDEX);

const TEMPLATE_OF: Record<string, [string, string]> = {
  agentRulesSlime: ['slime', 'arSl'], agentRulesAnts: ['ants', 'arAn'], agentRulesBoids: ['boids', 'arBo'], agentRulesPredatorPrey: ['predatorPrey', 'arPp'],
  agentRulesSir: ['sir', 'arSir'], agentRulesTermites: ['termites', 'arTe'], agentRulesFireflies: ['fireflies', 'arFf'], agentRulesDla: ['dla', 'arDla'],
  agentRulesParticles: ['particles', 'arPa'], agentRulesSwarm: ['swarm', 'arSw'], agentRulesCrowd: ['crowd', 'arCr'],
};

export function buildAgentRuleExamples(): Record<string, ExampleGraph> {
  return Object.fromEntries(AGENT_RULE_EXAMPLE_KEYS.map(k => {
    const [template, prefix] = TEMPLATE_OF[k];
    return [k, { ...AGENT_RULE_EXAMPLE_INDEX[k], counter: 60, nodes: rulesTemplateNodes(template, prefix, 0, 200) }];
  }));
}
