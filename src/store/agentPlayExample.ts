/**
 * agentPlayExample.ts — the Agents group on the Play page (docs/agents-plan.md, P4):
 * a million particles a hand steers (the pointer until a hand is seen) while the
 * Audio engine's kick track blasts shockwaves through them. The graph lives here;
 * its Play setup (controls, the hand pair, the mappings, the engine) is in
 * playExamples.ts. Every node, inside the group too, carries a plain-language note.
 */
import type { GraphNode } from '../types/nodeGraph';
import { n } from './graphBuilder';
import { agentsGroup, expr, note } from './agentExampleKit';

/** The ids the Play setup's controls point at. */
export const HAND_EX = { group: 'swarm', attract: 'hbAttract', kick: 'hbKick', curl: 'hbCurl', emit: 'hbEmit' } as const;

export function handBeatNodes(): GraphNode[] {
  const inputs = n('agentInputs', 'hbIn', 0, 160, {
    _groupOriginal: true, extraInputs: [],
    ...note([
      'Agent Inputs: this particle as the step begins. Its Position goes to Home (the pull back toward the middle); every force reads it by itself too.',
    ]),
  });
  const home = expr('hbHome', 420, 40, {
    label: 'Home',
    inputs: [{ name: 'p', type: 'vec2' }],
    lines: [['float r', 'length(p)'], ['float past', 'max(r - 0.7, 0.0)']],
    result: '-p / max(r, 1e-4) * past * 3.0',
    outputType: 'vec2',
    wires: { p: ['hbIn', 'position'] },
    note: [
      'Home (an Expression Block, used as a force): keeps the swarm on the picture. Particles a beat or the hand threw far out drift back.',
      'r: how far the particle is from the middle. past: how far beyond 0.7 it is; 0 inside.',
      'Result: a pull toward the middle, 3 × past, so nothing pulls inside the circle and it pulls harder the further out.',
    ],
  });
  const kick = n('agentSoundKick', HAND_EX.kick, 840, 40, {
    mode: 'shock', x: 0, y: 0, strength: 0.7, speed: 1.4, soundFrom: 'graph', level: 0, beat: 0,
    ...note([
      'Sound kick, Shockwave: every kick sends a ring of pressure out from the middle at 1.4 picture-heights a second, pushing the particles out as it passes.',
      'It hears the group\'s Sound from (Engine track 1, the Kick rack): the group\'s choice wins over this card\'s own Sound section. Its Also adds Home.',
      'Try: Kick Wave for rings as loud as the sound; Strength (pinned on the group card) 1.5 for harder blasts.',
    ]),
  }, { also: ['hbHome', 'result'] });
  const curl = n('agentCurl', HAND_EX.curl, 1260, 40, {
    strength: 0.35, size: 1.2, evolve: 0.25,
    ...note([
      'Curl noise: slow swirling currents, so the swarm is never still between kicks and the hand. Its Also adds the kick and Home.',
      'Try: Size 3 for busier eddies; Strength 0 for a calm swarm that only the hand and the beat move.',
    ]),
  }, { also: [HAND_EX.kick, 'force'] });
  const attract = n('agentAttract', HAND_EX.attract, 1680, 40, {
    target: 'hand', handX: 0.5, handY: 0.5, strength: 1.2, reach: 0.45, swirl: 1.6, falloff: 'reach',
    ...note([
      'Attract / Repel, Target "A hand or null": its Hand X / Y (0–1 across and up the picture) are Play controls paired as one position, and the pair follows a tracked hand\'s index fingertip; until a hand is seen, the pointer over the picture moves it.',
      'Within Reach 0.45 it pulls particles in and Swirl 1.6 stirs them round, like the Particles node\'s hands. Make a fist and Strength goes to −2.5: it pushes them away.',
      'Its Also adds everything before it: this Force is the total. Try: in Studio, right-click Hand X → Follow a hand on any Hand X / Y slider (Vortex, Emit) to make your own.',
    ]),
  }, { also: [HAND_EX.curl, 'force'] });
  const integrate = n('agentIntegrate', 'hbMove', 2100, 80, {
    drag: 1.8, maxSpeed: 5, mass: 1, edges: 'bounce',
    ...note([
      'Integrate: the total force moves each particle; Drag 1.8 settles a blast or a sweep of the hand within a second, so each move reads clearly.',
      'Edges Bounce keeps particles on the picture. Try: Drag 0.6 for long, floaty trails behind the hand.',
    ]),
  }, { force: [HAND_EX.attract, 'force'] });
  const age = n('agentAge', 'hbAge', 2100, 660, {
    span: 1,
    ...note(['Age / Life: each particle lives about 8 s; then Emit gives it a new place in the cloud, so the swarm stays full however hard it is thrown.']),
  });
  const output = n('agentOutput', 'hbOut', 2520, 140, {
    _groupOriginal: true,
    ...note(['Agent Output: Position and Velocity from Integrate, Alive from Age / Life. The streaks are drawn along the velocity.']),
  }, { position: ['hbMove', 'position'], velocity: ['hbMove', 'velocity'], alive: ['hbAge', 'alive'] });

  const emit = n('agentEmit', HAND_EX.emit, 0, 0, {
    mode: 'respawn', shape: 'disc', heading: 'random', at: 'point', x: 0, y: 0, size: 0.7, life: 8, lifeVar: 0.5, speed: 0,
    ...note([
      'Emit: particles are born anywhere in a disc (radius 0.7), still, each living 8 s ± half; Keep full gives each a new place when it dies.',
      'Burst is a Play control: press B and everyone is born again at once.',
      'Try: At "A hand or null", then right-click its Hand X → Follow a hand: new particles are born where your hand is.',
    ]),
  });
  const group = agentsGroup(HAND_EX.group, 420, 0, HAND_EX.emit, [inputs, home, kick, curl, attract, integrate, age, output], {
    label: 'Hand swarm',
    soundFrom: 'track1', level: 0, beat: 0,
    pinned: [`${HAND_EX.attract}::strength`, `${HAND_EX.attract}::swirl`, `${HAND_EX.kick}::strength`, `${HAND_EX.curl}::strength`],
    ...note([
      'Agents: a million particles (1M), 2 steps a frame. Inside (double-click): Home → Sound kick → Curl noise → Attract / Repel, added through Also, then Integrate and Age / Life.',
      'Sound from (Sound section) is Engine track 1: every Sound kick inside hears the Play page\'s Kick rack. Press Play on the Engine tab\'s transport (click the picture first). To try it in silence, set Sound from to Level (and Beat) and Beat to 120.',
      'Pinned: the hand\'s Strength and Swirl, the kick\'s Strength and the curl\'s Strength sit on this card (right-click a slider inside → Pin to the group card); right-click one here for Play.',
    ]),
  });
  const draw = n('drawAgents', 'hbDraw', 840, 0, {
    style: 'streaks', colorBy: 'speed', palette: 'neon', speedRef: 0.7, scaleBy: 'crowd', size: 2, brightness: 0.8, glow: 0.6, streak: 0.4, fade: 'on', lights: '0',
    ...note([
      'Draw agents, Streaks: each particle as a short glowing line along its motion, coloured by speed on the Neon palette: resting particles violet, a kick\'s ring or a sweep of the hand bright cyan.',
      'Try: Style Glow with Palette Ember for embers round your hand.',
    ]),
  }, { agents: [HAND_EX.group, 'agents'] });
  const out = n('output', 'hbOutput', 1260, 0, { ...note(['Output: the streaks are the picture.']) }, { color: ['hbDraw', 'color'] });
  return [emit, group, draw, out];
}
