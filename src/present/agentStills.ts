/**
 * agentStills.ts — pictures of the Agents examples for the "How Agents work"
 * presentation (agentsSample.ts). The web player that runs Present canvases
 * doesn't run Agents groups yet (docs/agents-plan.md, P5), so their sources
 * carry these stills as posters: each rendered in the app with the example's
 * own offline render (renderAtTime, 1280 × 720, scaled to 640 × 360), at the
 * time in its name below. Loaded only when the sample is built.
 */
import slimeMold from './stills/still-slimeMold.jpg?inline';
import agentParticles from './stills/still-agentParticles.jpg?inline';
import agentCurlSmoke from './stills/still-agentCurlSmoke.jpg?inline';
import agentSoundBurst from './stills/still-agentSoundBurst.jpg?inline';
import agentMultiSlime from './stills/still-agentMultiSlime.jpg?inline';
import agentAnts from './stills/still-agentAnts.jpg?inline';
import agentBoids from './stills/still-agentBoids.jpg?inline';
import agentStrands from './stills/still-agentStrands.jpg?inline';
import agentGrowPicture from './stills/still-agentGrowPicture.jpg?inline';
import agentsHandBeat from './stills/still-agentsHandBeat.jpg?inline';

/** Example key → a JPEG data URL (times: slime 20 s, particles 6 s, smoke 9 s, burst 4.2 s, multi-species 25 s, ants 20 s, boids 12 s, strands 20 s, picture 20 s, hand and beat 5.3 s). */
export const AGENT_STILLS: Readonly<Record<string, string>> = {
  slimeMold, agentParticles, agentCurlSmoke, agentSoundBurst, agentMultiSlime, agentAnts, agentBoids, agentStrands, agentGrowPicture, agentsHandBeat,
};
