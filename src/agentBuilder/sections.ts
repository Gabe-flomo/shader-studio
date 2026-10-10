/**
 * sections.ts — which sections each kind of walker shows in the Agent Builder (docs/agent-builder.md),
 * which behaviour cards each holds (behaviours.ts), and their few words. The words retell the field
 * guide's Part 2: 2.9 (Particles: forces and Integrate), 2.10 (Species), and Reynolds' boids (2.2).
 *
 *   Trail followers  Born · Senses · Turning · Moving · Trail
 *   Particles        Born · Forces · Moving · Life · Look
 *   Flocks, Crowds   Born · Neighbours · Turning · Moving
 *   Orbiters         Born · Orbit · Neighbours · Moving
 */
import type { IconName } from '../components/ui/iconPaths';
import type { WalkerKind } from '../agentRules/spec';
import type { CardId } from './behaviours';
import { TRAIL_SECTIONS, type TrailSection } from './words';

export type SectionId = TrailSection | 'forces' | 'life' | 'look' | 'neighbours' | 'steering' | 'orbit' | 'memory';

export interface SectionDef {
  id: SectionId;
  /** Its cards, in the order a new one is placed. */
  cards: readonly CardId[];
  /** Order matters: its cards can be dragged (rule order). */
  reorder?: boolean;
}

export const KIND_SECTIONS: Record<WalkerKind, readonly SectionDef[]> = {
  trail: [{ id: 'born', cards: [] }, { id: 'senses', cards: ['senses'] }, { id: 'turning', cards: ['wobble'] }, { id: 'moving', cards: [] }, { id: 'trail', cards: ['trail'] }, { id: 'memory', cards: [] }],
  ants: [{ id: 'born', cards: [] }, { id: 'senses', cards: ['senses'] }, { id: 'turning', cards: ['wobble'] }, { id: 'moving', cards: [] }, { id: 'trail', cards: ['trail'] }, { id: 'memory', cards: [] }],
  particles: [
    { id: 'born', cards: [] },
    { id: 'forces', cards: ['gravity', 'wind', 'curl', 'field', 'attract', 'drag'], reorder: true },
    { id: 'moving', cards: [] },
    { id: 'life', cards: ['fade', 'die'] },
    { id: 'memory', cards: [] },
    { id: 'look', cards: [] },
  ],
  flock: [
    { id: 'born', cards: [] },
    { id: 'neighbours', cards: [] },
    { id: 'steering', cards: ['separate', 'match', 'cohere', 'avoidEdges', 'wobble'], reorder: true },
    { id: 'moving', cards: [] },
    { id: 'memory', cards: [] },
  ],
  crowd: [
    { id: 'born', cards: [] },
    { id: 'neighbours', cards: [] },
    { id: 'steering', cards: ['goal', 'separate', 'match', 'cohere', 'slow', 'avoidEdges', 'wobble'], reorder: true },
    { id: 'moving', cards: [] },
    { id: 'memory', cards: [] },
  ],
  swarm: [
    { id: 'born', cards: [] },
    { id: 'orbit', cards: ['orbit', 'wobble'], reorder: true },
    { id: 'neighbours', cards: ['separate', 'cohere', 'match'], reorder: true },
    { id: 'moving', cards: [] },
    { id: 'memory', cards: [] },
  ],
};

/** Every card a kind's sections hold, in section order (the order new cards are placed in). */
export const kindCards = (kind: WalkerKind): CardId[] => KIND_SECTIONS[kind].flatMap(s => s.cards);
/** The trail followers' sections are drawn by their own cards (phase 1). */
export const isTrailKind = (kind: WalkerKind) => kind === 'trail' || kind === 'ants';

export interface SectionWords { label: string; icon: IconName; hint: string; learn: string; guide: string }

const OTHER: Record<Exclude<SectionId, TrailSection>, SectionWords> = {
  forces: {
    label: 'Forces', icon: 'bolt',
    hint: 'Pushes and pulls that add up and change its velocity every step.',
    learn: 'Particles don\'t steer: they are pushed. Each step the forces add up, the total changes the velocity (a step of 1/60 s), drag takes a share of the speed away, and it moves with the new velocity. Gravity pulls one way everywhere, wind blows in gusts, curl noise swirls without bunching them up, and a point pulls in (or pushes out). Order matters for drag: drag after a force slows that push too.',
    guide: 'Field guide 2.9, Particles: forces and Integrate',
  },
  life: {
    label: 'Life', icon: 'clock',
    hint: 'How long each lives, how it fades with age, and when it dies.',
    learn: 'A slot is a live particle or a dead one. Emit gives each a life (0: for ever); it dies when its age passes it, or when a Dies card fires. With Births on Kept full a dead one is born again at once, so the fountain never thins out. Fade with age dims its colour from full at birth to black.',
    guide: 'Field guide 2.8, Birth, life and death',
  },
  look: {
    label: 'Look', icon: 'eye',
    hint: 'How the particles are drawn: dots, glow or streaks, their size and colour.',
    learn: 'Draw agents draws every live particle over the picture: soft dots, dots with a glow, streaks back along the motion, or ink. Size and Brightness set each one; the colour is its kind\'s, dimmed by Fade with age.',
    guide: 'Field guide 2.11, Drawing the walkers',
  },
  neighbours: {
    label: 'Neighbours', icon: 'target',
    hint: 'How far each one sees, and how many of the walkers it sees it counts.',
    learn: 'Each one only sees the walkers within its view radius, never the whole flock: that is what makes flocks (Reynolds, 1987). They are found through a grid each step, so a reading counts at most Max neighbours; a crowd past that counts the same as a full one. A bigger radius gives bigger, slower flocks.',
    guide: 'Field guide 2.2, Flocking (Reynolds\' boids)',
  },
  steering: {
    label: 'Turning', icon: 'curve',
    hint: 'Small turns from what it sees: keep apart, match heading, stay together.',
    learn: 'Three local rules make a flock: separation (turn away from the ones too close), alignment (turn toward the way they go) and cohesion (turn toward their middle). Each turns it at most so many degrees a step, in order. Strong alignment gives glassy streams; strong cohesion tight balls; strong separation a loose gas.',
    guide: 'Field guide 2.2, Flocking: separation, alignment, cohesion',
  },
  memory: {
    label: 'Memory', icon: 'clock',
    hint: 'Numbers each walker keeps from step to step: counters, timers, on / off, a place, a level that fades.',
    learn: 'A walker can carry a few numbers of its own from one step to the next: whether it carries food, how long since it left home, how much energy it has left. Each memory is changed by small cards (count up when…, start a timer, toggle, remember where it was, add up what it smells, decay) or by a line you write (energy = energy * 0.98 + here.food). Any card can then act only when a memory says so (only when carrying is on), and any slider can be multiplied by one (speed × energy).',
    guide: 'Field guide 2.10, Species, memory and colour of their own',
  },
  orbit: {
    label: 'Orbit', icon: 'loop',
    hint: 'The point it circles, how far out, which way, and how hard it turns.',
    learn: 'Each step it turns toward the way round the circle, and in when it is further out than the radius, out when nearer. A small turn makes loose wide orbits that drift; a big one holds the circle tight. Several kinds circling opposite ways shear into arms.',
    guide: 'Field guide 2.15, Recipes: orbits and arms',
  },
};

export function sectionWordsOf(id: SectionId): SectionWords {
  if (id in OTHER) return OTHER[id as keyof typeof OTHER];
  const t = TRAIL_SECTIONS.find(s => s.id === id)!;
  const icons: Record<TrailSection, IconName> = { born: 'spark', senses: 'eye', turning: 'curve', moving: 'play', trail: 'wave' };
  return { label: t.label, icon: icons[t.id], hint: t.hint, learn: t.learn, guide: t.guide };
}

/** Each card's plain name and one line (the name's hover). Wobble is "Wander" outside trail followers. */
export const CARD_WORDS: Record<CardId, { title: string; hint: string }> = {
  senses: { title: 'Senses', hint: 'Three feelers smell the trail ahead.' },
  wobble: { title: 'Wander', hint: 'A random turn of up to this many degrees each step.' },
  trail: { title: 'Trail', hint: 'What it leaves where it lands.' },
  gravity: { title: 'Gravity', hint: 'The same pull everywhere, one way (down is −90°).' },
  wind: { title: 'Wind', hint: 'A steady push one way, rising and falling in gusts.' },
  curl: { title: 'Curl flow', hint: 'Swirling currents that never bunch them up.' },
  field: { title: 'Follow a field', hint: 'Flow along a field you pick, combine or write yourself.' },
  attract: { title: 'Attract / repel', hint: 'A pull toward a point or the mouse; negative pushes away.' },
  drag: { title: 'Drag', hint: 'Loses this share of its speed every second.' },
  fade: { title: 'Fade with age', hint: 'Its colour dims to black over this many seconds.' },
  die: { title: 'Dies', hint: 'It dies (Kept full brings it back at once).' },
  separate: { title: 'Keep apart', hint: 'Turn away from the ones too close (separation).' },
  match: { title: 'Match heading', hint: 'Turn toward the way they go (alignment).' },
  cohere: { title: 'Stay together', hint: 'Turn toward the middle of the ones it sees (cohesion).' },
  avoidEdges: { title: 'Avoid edges', hint: 'Turn back inward near the edge of the picture.' },
  goal: { title: 'Head for', hint: 'Turn toward a point, the centre or the mouse.' },
  slow: { title: 'Slow in a crowd', hint: 'Slow down as the ones round it reach a jam.' },
  orbit: { title: 'Orbit', hint: 'Circle a point at a distance.' },
  memory: { title: 'Memory', hint: 'Changes one of its memories.' },
  turnRound: { title: 'Turn round', hint: 'Turns round on the spot.' },
};

/** Each setting's one-line hint for the cards of the new kinds. */
export const MORE_HINTS: Record<string, string> = {
  strength: 'How hard it pushes (units a second²).',
  direction: 'Which way, in degrees: 0 right, 90 up, −90 down.',
  flowSize: 'Bigger: smaller, busier eddies.',
  flowEvolve: 'How fast the currents change (0: a still flow).',
  target: 'The point it pulls toward (or circles).',
  dragAmount: 'The share of its speed lost each second.',
  fadeSeconds: 'Seconds from full colour to black.',
  life: 'How long each lives (0: for ever). Emit\'s Life.',
  degrees: 'At most this many degrees a step.',
  who: 'Which walkers it reads: everyone, its own kind or the other kinds.',
  reach: 'How far it looks for these (0: the view radius).',
  radius: 'How far each one sees (picture units: the picture is 2 tall).',
  max: 'At most this many of the ones it sees are counted.',
  margin: 'How near the edge it starts to turn back.',
  jam: 'How many round it make it nearly stop.',
  distance: 'How far from the point it circles.',
  direction2: 'Which way round it goes.',
  style: 'Dots, dots with a glow, streaks or ink.',
  size: 'How big each one is drawn.',
  brightness: 'How bright each one is.',
  colour: 'Its kind\'s colour.',
};
