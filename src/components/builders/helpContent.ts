/**
 * helpContent.ts — the builders' built-in guidance (docs/scene-builder.md, docs/grid-rules.md,
 * docs/agent-rules.md): a short "how this works" for every builder section, rule type and empty
 * list, each with a worked example the user can click to insert, and a plain-language hint for
 * every Agent Rules condition and action.
 *
 * Pure data, keyed by builder (BuilderWindow's `prefsKey`) and section id, so <BuilderHelp> and
 * <EmptyHelp> find their text by id and a test can check that every section, rule type, condition
 * and action has an entry. A new builder adds its own block here and gets the help panels for free.
 */
import type { AgentRule, RuleAction, RuleCondition } from '../../agentRules/spec';

/** What clicking an example inserts; the builder that shows it decides how. */
export type HelpInsert =
  /** Scene Builder: a recipe clause added to the scene. */
  | { recipe: string }
  /** Grid Rules: params set on the node. */
  | { patch: Record<string, unknown> }
  /** Agent Rules: a rule added to the species' list. */
  | { rule: AgentRule };

export interface HelpExample { label: string; insert: HelpInsert }

export interface HelpEntry {
  title: string;
  /** Two or three short lines: what it is, what it does, "you can do X to get Y". */
  lines: string[];
  examples?: HelpExample[];
}

export type BuilderKey = 'scene-builder' | 'grid-rules' | 'agent-rules';

const mask = (counts: number[]) => counts.reduce((m, k) => m | (1 << k), 0);

export const BUILDER_HELP: Record<BuilderKey, Record<string, HelpEntry>> = {
  // ── 3D Scene Builder ──────────────────────────────────────────────────────────
  'scene-builder': {
    tree: {
      title: 'The scene tree',
      lines: [
        'Every shape and combine group in the scene, top to bottom. Click one to edit it; drag a row onto another to reorder it or nest it in a group.',
        'An empty scene draws only the background: add a shape, pick a template, or type a recipe.',
      ],
      examples: [{ label: 'Add a sphere', insert: { recipe: 'sphere r=0.8 color=orange' } }],
    },
    shapes: {
      title: 'Shapes',
      lines: [
        'A shape has a kind (sphere, box, torus…), a size, a place (Position), a turn (Rotation) and a material (Colour, Shine).',
        'You can add a second shape and move it with Position to build a still life; join them under Combine.',
      ],
      examples: [
        { label: 'A sphere to the right', insert: { recipe: 'sphere r=0.5 at=(1,0,0) color=teal' } },
        { label: 'A floor', insert: { recipe: 'plane y=-0.8 color=grey' } },
      ],
    },
    combine: {
      title: 'Combine',
      lines: [
        'A group joins what is inside it, in order: Union keeps the nearer surface, Subtract cuts every later item out of the first, Intersect keeps only the overlap.',
        'The smooth ones blend over a Blend radius (k): you can melt two shapes together like putty to get organic forms.',
      ],
      examples: [{ label: 'Melt a ball into a box', insert: { recipe: 'smooth-union(sphere r=0.6, box size=0.4 at=(0.6,0,0)) k=0.3' } }],
    },
    warps: {
      title: 'Bend space',
      lines: [
        'A warp changes the space a shape lives in, not the shape: repeat it forever, mirror it, twist or bend it. Warps stack top to bottom.',
        'On the whole scene they bend every shape; on a group, everything in it; on a shape, only that shape.',
      ],
      examples: [
        { label: 'Twist everything', insert: { recipe: 'twist 0.5' } },
        { label: 'Six copies round', insert: { recipe: 'polar-repeat 6' } },
      ],
    },
    look: {
      title: 'Look',
      lines: [
        'How the scene is drawn: Surface (lit, with shadows), Volumetric glow (see-through light), Glass (refracts the rest) or GI lit (one bounce of light).',
        'Then the lights, shadows, fog, background and tone map. You can switch to Volumetric to get a neon, plasma look from the same shapes.',
      ],
      examples: [
        { label: 'Fog', insert: { recipe: 'fog 0.2' } },
        { label: 'Volumetric glow', insert: { recipe: 'volumetric' } },
      ],
    },
    camera: {
      title: 'Camera',
      lines: [
        'An orbit camera: it circles the point it looks at. Distance is how far away, Angle where it stands round the point, Elevation how far above.',
        'Set Orbit speed to turn it over time, or Flatten to 1 for an isometric drawing.',
      ],
      examples: [{ label: 'Slow orbit from further away', insert: { recipe: 'camera dist=6 orbit=10' } }],
    },
    quality: {
      title: 'Quality',
      lines: [
        'How hard the ray marcher works: Steps per pixel, how far a ray goes (Max distance) and how big each step is (Step scale).',
        'Raise Steps to get fine detail at a distance; lower Step scale if warps tear holes in a surface.',
      ],
      examples: [{ label: 'More steps', insert: { recipe: 'quality steps=160' } }],
    },
    output: {
      title: 'Output',
      lines: [
        'What the built scene shows: the picture (the default), or one of the march\'s own measurements: depth, distance, normal, hit mask, position, steps, ambient occlusion or shadow.',
        'Colour by sends a measurement through a palette: you can colour the space by depth or height to get a contour-map or heat-map look.',
      ],
      examples: [
        { label: 'Show the depth', insert: { recipe: 'output depth' } },
        { label: 'Colour by depth (sunset)', insert: { recipe: 'colour by depth palette=sunset' } },
        { label: 'Show the normals', insert: { recipe: 'output normal' } },
      ],
    },
    recipe: {
      title: 'Recipe',
      lines: [
        'The whole scene as text: clauses separated by new lines or ·. A render mode, shapes and combines, warps for the whole scene, then settings (sun, fog, camera, output…).',
        'Type and the form follows. Suggestions pop up as you type (Tab or Enter takes one); a mistake shows its line, column and a "did you mean".',
      ],
      examples: [{ label: 'Two spheres, depth', insert: { recipe: 'sphere · sphere at=(1,0,0) · output depth' } }],
    },
    templates: {
      title: 'Templates',
      lines: ['A template fills the whole form with a finished scene (Undo brings back what was there). Each is a recipe you can read and change.'],
    },
    describe: {
      title: 'Describe',
      lines: [
        'Reads the 3D scene on the canvas back into words: shapes, combines, warps, look, camera and output.',
        'What the builder doesn\'t know is marked custom(…); the recognised part can be opened in the builder.',
      ],
    },
  },

  // ── Grid Rules ────────────────────────────────────────────────────────────────
  'grid-rules': {
    count: {
      title: 'Count rules',
      lines: [
        'Every step, each cell counts its live neighbours. Born: an empty cell with one of these counts comes alive. Survive: a live cell with one of these counts stays alive; every other cell is empty next step.',
        'You can switch on Born 6 to get HighLife\'s replicators, or pick a preset.',
      ],
      examples: [{ label: 'Life (B3/S23)', insert: { patch: { bornMask: mask([3]), surviveMask: mask([2, 3]) } } }],
    },
    stages: {
      title: 'Stages rules',
      lines: [
        'Like Count, but a cell that stops surviving fades through dying stages before it is empty: States is how many (empty, on, then the stages).',
        'Raise States to get longer, flowing tails.',
      ],
      examples: [{ label: 'Brian\'s Brain', insert: { patch: { bornMask: mask([2]), surviveMask: 0, states: 3 } } }],
    },
    patterns: {
      title: 'Patterns rules',
      lines: [
        'An ordered list of 3×3 pictures (stencils). Each step a cell looks round itself; the first picture that matches decides what it becomes.',
        'A pattern with a symmetry also matches turned or mirrored, so you can draw one case and get all four.',
      ],
    },
    blocks: {
      title: 'Blocks rules',
      lines: [
        'Margolus blocks: the board is cut into 2×2 blocks that change together, from a before picture to an after picture. The blocks shift by one cell every step.',
        'Blocks move things without losing them: sand falls, water spreads, gas mixes.',
      ],
    },
    smooth: {
      title: 'Smooth rules',
      lines: [
        'Continuous values instead of states: every cell runs the same small update from its neighbours (diffusion, waves, reaction–diffusion, or your own one-line update).',
        'Your own update is one expression for the new u (and v): a number, not a colour.',
      ],
      examples: [{ label: 'Heat', insert: { patch: { template: 'diffusion', spread: 0.9, decay: 0.004 } } }],
    },
    presets: {
      title: 'Presets',
      lines: ['Known rules with their numbers set. A preset lights up while the switches match it; change any switch to make your own.'],
    },
    neighbourhood: {
      title: 'Neighbourhood',
      lines: [
        'Which cells round a cell are counted: Moore (the 8 round it), von Neumann (the 4 up, down, left and right) or Radius N (a bigger block: Larger than Life).',
        'Radius rules count up to dozens of neighbours, so Born and Survive become ranges.',
      ],
    },
    'born-survive': {
      title: 'Born and survive',
      lines: [
        'Each switch is a neighbour count. Green (Born): an empty cell with that many live neighbours comes alive. Blue (Survive): a live cell with that many stays alive.',
        'B3/S23 is Conway\'s Life: born on 3, survive on 2 or 3. Type it under As text.',
      ],
      examples: [{ label: 'HighLife (B36/S23)', insert: { patch: { bornMask: mask([3, 6]), surviveMask: mask([2, 3]) } } }],
    },
    states: {
      title: 'States',
      lines: ['Empty (0), on (1), then the dying stages. 3 is one dying stage (Brian\'s Brain); 8 gives long tails.'],
    },
    stencils: {
      title: 'Stencils',
      lines: [
        'Each pattern is a 3×3 picture round the cell: a state, Any, Not empty or Same as the centre. When it matches, the cell becomes the state on the right.',
        'Patterns are tried top to bottom; the first match wins, so put special cases first.',
      ],
    },
    'block-rules': {
      title: 'Block rules',
      lines: [
        'Each rule is a 2×2 before picture and an after picture. A block that matches before becomes after (with its chance), else it stays as it is.',
        'Keep the counts the same on both sides and nothing is lost or made.',
      ],
    },
    run: {
      title: 'Start and run',
      lines: ['How the board starts (noise, empty, a picture, one seed), how big a cell is, whether the edges wrap, and how many steps it runs a frame.'],
    },
    brush: {
      title: 'Brush',
      lines: ['Hold the mouse button over the picture to paint cells: the brush paints this state (0 erases).'],
    },
    colours: {
      title: 'Colours',
      lines: ['A colour per state, and how dead cells glow after they die (Afterglow) and live ones change as they age.'],
    },
    output: {
      title: 'What the node shows',
      lines: [
        'Color shows the board coloured by state. You can show the raw State, the cells\' Age, or each cell\'s live Neighbour count instead, as grey: handy to drive other nodes or to see why a rule behaves as it does.',
        'The State, On, Age, Shade and Neighbours sockets carry the same numbers, whatever is shown.',
      ],
      examples: [{ label: 'Show neighbour counts', insert: { patch: { view: 'neighbours' } } }],
    },
  },

  // ── Agent Rules ───────────────────────────────────────────────────────────────
  'agent-rules': {
    rules: {
      title: 'How rules work',
      lines: [
        'When is the condition checked every step for each walker, e.g. Food trail ahead > 0.3.',
        'Do is what it does if the condition is true, e.g. turn toward it.',
        'Rules run top to bottom; "Stop after this rule" skips the rest.',
      ],
      examples: [{ label: 'Follow food ahead', insert: { rule: { when: [{ kind: 'sense', channel: 0, where: 'any', cmp: '>', value: 0.3 }], do: [{ kind: 'turn', toward: 'trail', channel: 0, degrees: 25 }] } } }],
    },
    'empty-rules': {
      title: 'No rules yet',
      lines: [
        'Without rules these walkers stand still. A rule is When … Do …: a condition checked every step, and what to do when it holds.',
        'The usual first rule is the slime mold: always → turn toward its own trail, wander, leave trail.',
      ],
      examples: [{ label: 'Slime mold rule', insert: { rule: { when: [{ kind: 'always' }], do: [{ kind: 'turn', toward: 'trail', channel: 'own', degrees: 30 }, { kind: 'wander', degrees: 8 }, { kind: 'trail', channel: 'own', amount: 1 }] } } }],
    },
    when: {
      title: 'When',
      lines: ['Conditions joined by and: all must hold. Type in + and… to find one (trail sensed, age, random chance…).'],
    },
    do: {
      title: 'Do',
      lines: ['Actions run in order when the rule applies. Type in + do… to find one (turn, wander, leave trail, change state…).'],
    },
    stop: {
      title: 'Stop after this rule',
      lines: ['When this rule applies, the rules below it are skipped for that walker this step: use it for "if this, do only this".'],
    },
    species: {
      title: 'Species',
      lines: ['Up to four kinds of walker, each with its own rules, speed and states. Each lays its own trail channel by default.'],
    },
    states: {
      title: 'States',
      lines: ['Each walker is in one state (born in the first). Rules can check it (in state) and change it (become). Draw agents → Colour by State shows its colour.'],
    },
    channels: {
      title: 'Trail channels',
      lines: ['Four trail channels, one per species by default. Name them (food, home) and the rules read as sentences: "food trail ahead > 0.3".'],
    },
    masks: {
      title: 'Masks',
      lines: ['Inputs on the group card: a texture (its brightness) or any number chain, read where the walker stands. Use them for food, walls or a nest.'],
    },
    sensing: {
      title: 'Moving and sensing',
      lines: ['Edges: wrap, bounce or slide at the picture\'s edges. Sensors: how far ahead and how wide every trail reading looks.'],
    },
    output: {
      title: 'What the picture shows',
      lines: [
        'The group\'s Trail field is what you usually see. You can show one trail channel (food only, home only) or the walkers\' density (from Draw agents) instead.',
        'Every option is also an output socket on the Trail field (Channel 1–4) or Draw agents (Density).',
      ],
    },
  },
};

/** A plain-language hint for each Agent Rules condition (the + and… picker and its "?"). */
export const CONDITION_HELP: Record<RuleCondition['kind'], { hint: string; example: string }> = {
  always: { hint: 'Every step, for every walker.', example: 'always → wander ±8°' },
  sense: { hint: 'A trail channel read ahead, to the side, anywhere ahead or here, compared with a value.', example: 'food trail ahead > 0.3' },
  near: { hint: 'Another species\' trail round the walker (any sensor or here) above a value.', example: 'near Predators\' trail > 0.2' },
  chance: { hint: 'A random chance within one second, whatever the frame rate.', example: 'a 5% chance a second' },
  age: { hint: 'Seconds since the walker was born.', example: 'age > 2 s' },
  state: { hint: 'In (or not in) one of its species\' states.', example: 'in state carrying' },
  memory: { hint: 'The walker\'s one free number: a timer, a counter, an energy.', example: 'Memory number > 1' },
  mask: { hint: 'A mask (a texture\'s brightness or a number) where the walker stands.', example: 'Food mask > 0.5' },
  neighbours: { hint: 'How many other walkers (everyone, its own kind or other kinds) are within the radius: the walkers themselves, found through the group\'s grid (a Neighbours node).', example: 'more than 8 neighbours within 0.05' },
};

/** A plain-language hint for each Agent Rules action (the + do… picker and its "?"). */
export const ACTION_HELP: Record<RuleAction['kind'], { hint: string; example: string }> = {
  turn: { hint: 'Turn toward (or away from) a trail, a point, the centre or the mouse, at most the degrees each step.', example: 'turn toward food trail (25°)' },
  wander: { hint: 'A random turn of up to ± the degrees each step.', example: 'wander ±8°' },
  speed: { hint: 'Set the speed, or accelerate by the value a second.', example: 'set speed 0.4' },
  trail: { hint: 'Leave trail in a channel; fade weakens it as the Memory number grows.', example: 'leave food trail 1' },
  state: { hint: 'Change to another state.', example: 'become carrying' },
  memory: { hint: 'Set, add to, count up or randomise the Memory number.', example: 'count Memory number up 1 a second' },
  stop: { hint: 'Speed 0 (another rule can set it moving again).', example: 'stop' },
  stick: { hint: 'Speed 0 for good: it never moves again (its rules still run).', example: 'stick' },
  die: { hint: 'The walker dies; Emit\'s Keep full or Rate brings a new one.', example: 'die' },
  spawn: { hint: 'Lay a birth mark (trail channel 4): a Births Emit gives birth there.', example: 'spawn a child' },
  bounce: { hint: 'Turn round.', example: 'bounce' },
  flow: { hint: 'Turn toward (or against) a curl-noise flow field.', example: 'follow the flow field (20°)' },
  align: { hint: 'Turn toward the way the crowd round it flies, read from a velocity trail (the older, blurrier way; match neighbours\' heading sees the walkers themselves).', example: 'align with the crowd (10°)' },
  separate: { hint: 'Boids\' separation: turn away from the walkers within the radius, harder the closer they are (Neighbours\' Push).', example: 'steer away from neighbours within 0.02 (15°)' },
  match: { hint: 'Boids\' alignment: turn toward the way the walkers within the radius are going (their average velocity).', example: 'match the heading of neighbours within 0.05 (6°)' },
  cohere: { hint: 'Boids\' cohesion: turn toward the middle of the walkers within the radius.', example: 'move to the centre of neighbours within 0.05 (3°)' },
  slow: { hint: 'Slow down in a crowd: the speed falls from the species\' Speed toward 0 as the walkers within the radius reach Jam.', example: 'slow down as neighbours within 0.04 reach 20' },
  avoidEdges: { hint: 'Turn back inward when within the margin of an edge of the picture (or the 3D box).', example: 'avoid the edges (within 0.1, 12°)' },
  orbit: { hint: 'Circle a point, the centre or the mouse at a distance: turn along the circle, and in or out toward it.', example: 'orbit the centre at 0.5 (8°)' },
  force: { hint: 'A force that changes the velocity (so the heading and the speed follow): gravity, a gusty wind, curl noise, or a pull toward a point or the mouse (negative pushes away).', example: 'apply gravity 0.5 at −90°' },
  drag: { hint: 'Lose this share of the speed every second, like moving through water.', example: 'drag 0.5 a second' },
  fade: { hint: 'Dim to black over the seconds since it was born (its colour; Draw agents\' Colour by State shows it).', example: 'fade with age over 3 s' },
};

export function helpFor(builder: string, id: string): HelpEntry | null {
  return (BUILDER_HELP as Record<string, Record<string, HelpEntry>>)[builder]?.[id] ?? null;
}
