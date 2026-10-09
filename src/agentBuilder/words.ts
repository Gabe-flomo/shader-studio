/**
 * words.ts — the Agent Builder's few words (docs/agent-builder.md): each section's plain name, a
 * one-line hint for hovering, and a "Learn more" paragraph. The paragraphs retell the field
 * guide's Part 2 (Agents: 2.6 Sense, Steer, Move; 2.7 Deposit and the Trail field; 2.8 Emit) in
 * short, in the order one step runs: Born, then Sense → Steer → Move → Deposit.
 */
export type TrailSection = 'born' | 'senses' | 'turning' | 'moving' | 'trail';

export const TRAIL_SECTIONS: ReadonlyArray<{ id: TrailSection; label: string; icon: 'spark' | 'eye' | 'curve' | 'play' | 'wave'; hint: string; learn: string; guide: string }> = [
  {
    id: 'born', label: 'Born', icon: 'spark',
    hint: 'Where the walkers start, and how many there are.',
    learn: 'Every group has a fixed number of walkers. With Fill they are all born at once on the first step, inside the shape you pick, facing the way you pick, and live for ever: right for slime. A small disc in the middle grows outward as a fan of veins; the whole picture starts everywhere at once.',
    guide: 'Field guide 2.8, Birth, life and death',
  },
  {
    id: 'senses', label: 'Senses', icon: 'eye',
    hint: 'Three feelers smell the trail ahead: how far, and how wide apart.',
    learn: 'Each step a walker smells the trail at three points: straight ahead, and the same distance ahead turned left and right by the angle. Far feelers make bigger, coarser cells; near ones fine lace. A narrow angle gives long straight veins, a wide one rounder blobs, and very wide with little turning gives separate clumps.',
    guide: 'Field guide 2.6, Sense: three sniffs ahead (figure 2.4)',
  },
  {
    id: 'turning', label: 'Turning', icon: 'curve',
    hint: 'How far it turns toward the strongest smell each step, plus a random wobble.',
    learn: 'If the left feeler smells most it turns left by the full amount, right if the right one does, straight on if the middle wins, and a random way if both sides beat the middle. A small turn gives long smooth veins; a big one a tight mesh with many junctions. A little wobble keeps the network alive; none can freeze it.',
    guide: 'Field guide 2.6, Steer: the turning rule (figure 2.5)',
  },
  {
    id: 'moving', label: 'Moving', icon: 'play',
    hint: 'How far it steps each time, and what happens at the edge of the picture.',
    learn: 'After turning it steps forward: its speed is picture units a second, so one step is a sixtieth of it. Slower walkers grow tight networks, faster ones looser. At the edges it can wrap round to the other side (so the network has no border), bounce back, or slide along the edge.',
    guide: 'Field guide 2.6, Move: the step itself',
  },
  {
    id: 'trail', label: 'Trail', icon: 'wave',
    hint: 'What it leaves where it lands, how fast that fades, and how far it spreads.',
    learn: 'Where it lands it leaves a little trail; dots from many walkers add up. Then the whole trail spreads a little (a blur) and fades (it loses half in the half-life). Spreading lets a walker find a vein its feelers just miss; fading lets unused paths disappear, so the network keeps changing, like ants\' smell evaporating.',
    guide: 'Field guide 2.7, Deposit and the Trail field',
  },
];

export const sectionWords = (id: TrailSection) => TRAIL_SECTIONS.find(s => s.id === id)!;

/** Each setting's one-line hint (the slider's label hover). */
export const SETTING_HINTS: Record<string, string> = {
  where: 'The shape they are born in.',
  size: 'How big the shape is (picture units: the picture is 2 tall).',
  count: 'How many walkers: 256k runs anywhere; 1M is the slime look on a laptop.',
  facing: 'Which way each faces when born.',
  births: 'All at once, a stream a second, or kept full (reborn when they die).',
  distance: 'How far ahead the feelers reach (picture units).',
  angle: 'How far the side feelers point from straight ahead.',
  smells: 'Which trail it follows.',
  avoid: 'Turn away from the smell instead of toward it.',
  sharp: 'Degrees it turns toward the strongest smell each step.',
  wobble: 'A random turn of up to this many degrees each step.',
  speed: 'Picture units a second; one step is a sixtieth of it.',
  edges: 'Wrap round, bounce back or slide along the edge.',
  amount: 'How much trail it leaves each step.',
  lays: 'Which trail channel it leaves.',
  fades: 'Seconds for the trail to fade to half.',
  spreads: 'How much the trail blurs into its neighbours each step.',
};
