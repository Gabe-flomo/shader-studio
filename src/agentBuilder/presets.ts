/**
 * presets.ts — the presets strips, per kind of walker (docs/agent-builder.md): the trail templates of
 * agentRules/templates.ts, plus four slime variants from the field guide's "What each setting does
 * to the look" (2.6): long veins (small turn), round cells (wide feelers), a busy mesh (big turn)
 * and separate clumps (very wide feelers, little turning). Applying one replaces the group's rule
 * set (as the rules editor's Templates menu does), one undo step.
 */
import type { AgentRule, AgentRuleSet, RuleAction, WalkerKind } from '../agentRules/spec';
import { rulesTemplate } from '../agentRules/templates';
import { patchCard, setSensors } from './cards';
import type { SimParams } from './miniSim';
import type { DotEmit } from './dotSim';

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
  /** Particles, flocks, crowds and orbiters: where its thumbnail's dots are born (dotSim.ts). */
  dots?: DotEmit[];
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

// ── Particles, flocks, crowds and orbiters (phase 2) ─────────────────────────

type Sp = AgentRuleSet['species'][number];
const always = (...a: RuleAction[]): AgentRule => ({ when: [{ kind: 'always' }], do: a });
const base = (o: Partial<AgentRuleSet> & { species: Sp[] }): AgentRuleSet => ({
  v: 1, channels: ['', '', '', ''], masks: [], edges: 'wrap', sensor: { distance: 0.03, angle: 40 }, flow: { size: 1, evolve: 0.15 }, ...o,
});
const kindOne = (name: string, speed: number, colour: [number, number, number], rules: AgentRule[]): Sp => ({ name, speed, states: [{ name: 'moving', colour }], rules });

/** Particles: the spark fountain and four looks from the field guide's forces (2.9). */
export const PARTICLE_PRESETS: readonly BuilderPreset[] = [
  { key: 'particles', label: 'Spark fountain', hint: 'Shot up from the bottom: gravity, curl noise and drag; they fade over 3 s.', set: tpl('particles'),
    dots: [{ shape: 'disc', x: 0, y: -0.85, size: 0.03, heading: 'up', speed: 1.1, life: 3.2 }] },
  { key: 'smoke', label: 'Smoke', hint: 'Light gravity upward and a strong curl flow: rising, curling smoke.', dots: [{ shape: 'disc', x: 0, y: -0.8, size: 0.12, heading: 'up', speed: 0.2, life: 5 }],
    set: () => base({ kind: 'particles', edges: 'wrap', flow: { size: 1.4, evolve: 0.25 }, species: [kindOne('Smoke', 0.2, [0.75, 0.78, 0.85], [
      always({ kind: 'force', field: 'gravity', strength: 0.25, angle: 90 }, { kind: 'force', field: 'curl', strength: 0.9 }, { kind: 'drag', amount: 0.8 }, { kind: 'fade', seconds: 5 }),
      { when: [{ kind: 'age', cmp: '>', seconds: 5 }], do: [{ kind: 'die' }] },
    ])] }) },
  { key: 'snow', label: 'Snow', hint: 'A slow fall, a gusty wind and a little swirl.', dots: [{ shape: 'line', x: 0, y: 1, size: 1.6, heading: 'random', speed: 0.05, life: 9 }],
    set: () => base({ kind: 'particles', edges: 'wrap', species: [kindOne('Snow', 0.05, [0.92, 0.96, 1], [
      always({ kind: 'force', field: 'gravity', strength: 0.15, angle: -90 }, { kind: 'force', field: 'wind', strength: 0.2, angle: 0 }, { kind: 'force', field: 'curl', strength: 0.15 }, { kind: 'drag', amount: 1.2 }),
    ])] }) },
  { key: 'vortex', label: 'Drain', hint: 'A pull toward the middle, stirred by curl noise: a whirlpool.', dots: [{ shape: 'screen', x: 0, y: 0, size: 1, heading: 'tangent', speed: 0.4, life: 6 }],
    set: () => base({ kind: 'particles', edges: 'wrap', species: [kindOne('Water', 0.4, [0.35, 0.75, 1], [
      always({ kind: 'force', field: 'point', strength: 0.6, x: 0, y: 0 }, { kind: 'force', field: 'curl', strength: 0.5 }, { kind: 'drag', amount: 0.3 }, { kind: 'fade', seconds: 6 }),
      { when: [{ kind: 'age', cmp: '>', seconds: 6 }], do: [{ kind: 'die' }] },
    ])] }) },
  { key: 'burst', label: 'Burst', hint: 'Shot out fast, dragged to a stop, falling, gone in 1.5 s.', dots: [{ shape: 'disc', x: 0, y: 0.1, size: 0.02, heading: 'outward', speed: 1.4, life: 1.5 }],
    set: () => base({ kind: 'particles', edges: 'bounce', species: [kindOne('Embers', 1.4, [1, 0.75, 0.35], [
      always({ kind: 'drag', amount: 2 }, { kind: 'force', field: 'gravity', strength: 0.4, angle: -90 }, { kind: 'fade', seconds: 1.5 }),
      { when: [{ kind: 'age', cmp: '>', seconds: 1.5 }], do: [{ kind: 'die' }] },
    ])] }) },
  { key: 'whirlpool', label: 'Whirlpool', hint: 'Follow a field: a vortex plus curl noise × 0.5 inside a circle, ridden; they fade over 6 s.', dots: [{ shape: 'screen', x: 0, y: 0, size: 1, heading: 'random', speed: 0.1, life: 6 }],
    set: () => base({ kind: 'particles', edges: 'wrap', species: [kindOne('Water', 0.1, [0.4, 0.85, 1], [
      always({ kind: 'field', strength: 1, grip: 3, spec: { layers: [
        { kind: 'vortex', weight: 0.6, size: 0.35, x: 0, y: 0 },
        { kind: 'curl', weight: 0.3, size: 0.25, mask: { shape: 'circle', x: 0, y: 0, size: 0.7 }, animate: { mode: 'drift', speed: 0.08, angle: 30 } },
      ] } }, { kind: 'fade', seconds: 6 }),
      { when: [{ kind: 'age', cmp: '>', seconds: 6 }], do: [{ kind: 'die' }] },
    ])] }) },
];

const birds = (name: string, rules: RuleAction[], speed = 0.4): Sp => kindOne(name, speed, [0.75, 0.9, 1], [always(...rules)]);
/** Flocks: Reynolds' boids, and the looks the three weights give. */
export const FLOCK_PRESETS: readonly BuilderPreset[] = [
  { key: 'boids', label: 'Boids', hint: 'Keep apart, match heading, stay together: flocks gather and wheel.', set: tpl('boids'), dots: [{ shape: 'screen', x: 0, y: 0, size: 1, heading: 'random' }] },
  { key: 'streams', label: 'Glassy streams', hint: 'Strong heading matching: long smooth streams.', dots: [{ shape: 'screen', x: 0, y: 0, size: 1, heading: 'random' }],
    set: () => base({ kind: 'flock', neighbours: { radius: 0.06, max: 36 }, species: [birds('Birds', [{ kind: 'separate', who: 'all', degrees: 8 }, { kind: 'match', who: 'all', degrees: 20 }, { kind: 'cohere', who: 'all', degrees: 1.5 }, { kind: 'wander', degrees: 2 }])] }) },
  { key: 'balls', label: 'Bait balls', hint: 'Strong pull to the middle: tight round shoals.', dots: [{ shape: 'screen', x: 0, y: 0, size: 1, heading: 'random' }],
    set: () => base({ kind: 'flock', neighbours: { radius: 0.08, max: 36 }, species: [birds('Fish', [{ kind: 'separate', who: 'all', degrees: 10 }, { kind: 'match', who: 'all', degrees: 6 }, { kind: 'cohere', who: 'all', degrees: 8 }, { kind: 'wander', degrees: 3 }], 0.3)] }) },
  { key: 'gnats', label: 'Gnats', hint: 'Mostly keep apart and wander: a buzzing loose cloud.', dots: [{ shape: 'screen', x: 0, y: 0, size: 1, heading: 'random' }],
    set: () => base({ kind: 'flock', neighbours: { radius: 0.05, max: 36 }, species: [birds('Gnats', [{ kind: 'separate', who: 'all', degrees: 15 }, { kind: 'match', who: 'all', degrees: 2 }, { kind: 'cohere', who: 'all', degrees: 1 }, { kind: 'wander', degrees: 18 }], 0.3)] }) },
  { key: 'murmuration', label: 'Murmuration', hint: 'Wide view, held off the edges: one big flock that folds and turns.', dots: [{ shape: 'screen', x: 0, y: 0, size: 1, heading: 'random' }],
    set: () => base({ kind: 'flock', edges: 'bounce', neighbours: { radius: 0.09, max: 48 }, species: [birds('Starlings', [{ kind: 'separate', who: 'all', degrees: 10 }, { kind: 'match', who: 'all', degrees: 14 }, { kind: 'cohere', who: 'all', degrees: 4 }, { kind: 'avoidEdges', margin: 0.25, degrees: 10 }, { kind: 'wander', degrees: 2 }], 0.45)] }) },
];

const walkers = (name: string, x: number, colour: [number, number, number], extra: RuleAction[] = []): Sp => kindOne(name, 0.22, colour, [always(
  { kind: 'turn', toward: 'point', x, y: 0, degrees: 10 },
  { kind: 'separate', who: 'others', degrees: 12, radius: 0.045 },
  { kind: 'separate', who: 'all', degrees: 6, radius: 0.015 },
  { kind: 'slow', who: 'all', jam: 30, radius: 0.045 },
  ...extra,
  { kind: 'wander', degrees: 3 },
)]);
/** Crowds: two-way lanes, and people heading for one door. */
export const CROWD_PRESETS: readonly BuilderPreset[] = [
  { key: 'crowd', label: 'Two-way lanes', hint: 'Two crowds walking opposite ways step out of each other\'s way: lanes form.', set: tpl('crowd'),
    dots: [{ shape: 'disc', x: -0.9, y: 0, size: 0.85, heading: 'right', species: 0 }, { shape: 'disc', x: 0.9, y: 0, size: 0.85, heading: 'left', species: 1 }] },
  { key: 'door', label: 'One door', hint: 'Everyone heads for one door and slows in the jam in front of it.', dots: [{ shape: 'screen', x: 0, y: 0, size: 1, heading: 'random' }],
    set: () => base({ kind: 'crowd', edges: 'slide', neighbours: { radius: 0.045, max: 36 }, species: [kindOne('People', 0.2, [1, 0.75, 0.4], [always(
      { kind: 'turn', toward: 'point', x: 1.4, y: 0, degrees: 12 }, { kind: 'separate', who: 'all', degrees: 10, radius: 0.02 }, { kind: 'slow', who: 'all', jam: 12, radius: 0.04 }, { kind: 'wander', degrees: 4 },
    )])] }) },
  { key: 'crossing', label: 'Crossing', hint: 'Two crowds crossing at right angles: diagonal stripes form.',
    dots: [{ shape: 'disc', x: -0.9, y: 0, size: 0.8, heading: 'right', species: 0 }, { shape: 'disc', x: 0, y: -0.5, size: 0.5, heading: 'up', species: 1 }],
    set: () => base({ kind: 'crowd', neighbours: { radius: 0.045, max: 36 }, species: [walkers('Going right', 40, [1, 0.6, 0.2]), { ...walkers('Going up', 0, [0.25, 0.75, 1]), rules: [always(
      { kind: 'turn', toward: 'point', x: 0, y: 40, degrees: 10 }, { kind: 'separate', who: 'others', degrees: 12, radius: 0.045 }, { kind: 'separate', who: 'all', degrees: 6, radius: 0.015 }, { kind: 'slow', who: 'all', jam: 30, radius: 0.045 }, { kind: 'wander', degrees: 3 },
    )] }] }) },
];

/** Orbiters: the swarm, a galaxy's two arms, and a pull to the mouse. */
export const ORBIT_PRESETS: readonly BuilderPreset[] = [
  { key: 'swarm', label: 'Swarm', hint: 'Circling the middle, keeping apart, drifting together.', set: tpl('swarm'), dots: [{ shape: 'ring', x: 0, y: 0, size: 0.55, heading: 'random' }] },
  { key: 'galaxy', label: 'Two arms', hint: 'Two kinds circling at different radii and speeds: they shear into arms.', dots: [{ shape: 'disc', x: 0, y: 0, size: 0.8, heading: 'tangent' }],
    set: () => base({ kind: 'swarm', species: [
      kindOne('Inner', 0.5, [1, 0.8, 0.5], [always({ kind: 'orbit', target: 'centre', distance: 0.3, degrees: 5 }, { kind: 'wander', degrees: 4 })]),
      kindOne('Outer', 0.35, [0.45, 0.7, 1], [always({ kind: 'orbit', target: 'centre', distance: 0.65, degrees: 2.5 }, { kind: 'wander', degrees: 4 })]),
    ] }) },
  { key: 'ring', label: 'Tight ring', hint: 'A big turn holds them on one circle.', dots: [{ shape: 'screen', x: 0, y: 0, size: 1, heading: 'random' }],
    set: () => base({ kind: 'swarm', neighbours: { radius: 0.03, max: 24 }, species: [kindOne('Ring', 0.45, [0.6, 1, 0.8], [always({ kind: 'orbit', target: 'centre', distance: 0.5, degrees: 14 }, { kind: 'separate', who: 'all', degrees: 8 }, { kind: 'wander', degrees: 3 })])] }) },
  { key: 'opposite', label: 'Opposite ways', hint: 'Two kinds circling opposite ways through each other.', dots: [{ shape: 'ring', x: 0, y: 0, size: 0.5, heading: 'random' }],
    set: () => base({ kind: 'swarm', species: [
      kindOne('One way', 0.4, [1, 0.55, 0.3], [always({ kind: 'orbit', target: 'centre', distance: 0.5, degrees: 6 }, { kind: 'wander', degrees: 6 })]),
      kindOne('The other', 0.4, [0.35, 0.75, 1], [always({ kind: 'orbit', target: 'centre', distance: 0.5, degrees: 6, cw: true }, { kind: 'wander', degrees: 6 })]),
    ] }) },
  { key: 'moths', label: 'Moths', hint: 'They circle the mouse wherever it goes.', dots: [{ shape: 'screen', x: 0, y: 0, size: 1, heading: 'random' }],
    set: () => base({ kind: 'swarm', species: [kindOne('Moths', 0.5, [1, 0.95, 0.7], [always({ kind: 'orbit', target: 'mouse', distance: 0.2, degrees: 7 }, { kind: 'wander', degrees: 10 })])] }) },
];

/** A kind's presets strip. */
export function presetsFor(kind: WalkerKind): readonly BuilderPreset[] {
  switch (kind) {
    case 'particles': return PARTICLE_PRESETS;
    case 'flock': return FLOCK_PRESETS;
    case 'crowd': return CROWD_PRESETS;
    case 'swarm': return ORBIT_PRESETS;
    default: return TRAIL_PRESETS;
  }
}

/** Any kind's preset by key. */
export const builderPreset = (key: string) => [...TRAIL_PRESETS, ...PARTICLE_PRESETS, ...FLOCK_PRESETS, ...CROWD_PRESETS, ...ORBIT_PRESETS].find(p => p.key === key);
