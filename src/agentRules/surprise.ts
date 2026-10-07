/**
 * surprise.ts — Agent Rules' Surprise me (docs/surprise.md): a random rule set that moves well.
 *
 * It picks a walker kind (how it moves: tracks its trail, drifts on a flow field, flocks, or
 * pulses between two states) and the template family that kind comes from (Slime mold,
 * Boids-like, Fireflies, Infection), then sets the numbers inside bands where the patterns form:
 * sensor angle and distance, turn, wander, speed, how much trail it leaves (deposit), how fast
 * the trail fades (decay, the Trail field's Half-life) and its colours. Now and then it adds a
 * second species that is drawn to, or keeps away from, the first one's trail.
 *
 * Every rule set uses only actions a plain trail setup supports (no velocity trail, no masks,
 * no births), so it runs in any rules group. Pure; deterministic for a seed.
 */
import { harmoniousPalette, makeRng, rampPalette, type Rng, type RGB } from '../lib/surprise';
import type { AgentRule, AgentRuleSet, AgentSpeciesRules, ChannelRef } from './spec';

export type WalkerKind = 'tracker' | 'drifter' | 'flocker' | 'pulser';

/** Each walker kind and the template family it is drawn from. */
export const WALKER_KINDS: Array<{ kind: WalkerKind; family: string; label: string }> = [
  { kind: 'tracker', family: 'slime', label: 'Trail trackers (Slime mold)' },
  { kind: 'drifter', family: 'slime', label: 'Flow drifters (Slime mold on a flow field)' },
  { kind: 'flocker', family: 'boids', label: 'Flockers (Boids-like: gather, keep apart)' },
  { kind: 'pulser', family: 'fireflies', label: 'Pulsers (Fireflies-like: two states, flashing)' },
];

export interface AgentSurprise {
  set: AgentRuleSet;
  kind: WalkerKind;
  family: string;
  /** The Trail field's numbers: Half-life (decay) and Diffuse. */
  trail: { halfLife: number; diffuse: number };
  /** Five colours for the trail's Stops Palette, dark to light. */
  palette: RGB[];
  /** A second species and how it feels about the first one's trail. */
  relation: 'attract' | 'avoid' | null;
  summary: string;
}

const r = (v: number, d = 3) => Math.round(v * 10 ** d) / 10 ** d;

/** The movement rules of one kind, for species `sp` (its own trail is channel `sp`). */
function kindRules(kind: WalkerKind, rng: Rng, sp: number, deposit: number): { rules: AgentRule[]; states: number } {
  const own: ChannelRef = sp as ChannelRef;
  const turn = r(rng.float(15, 55), 1), wander = r(rng.float(3, 14), 1);
  const lay = { kind: 'trail' as const, channel: own, amount: r(deposit) };
  switch (kind) {
    case 'tracker':
      return { states: 1, rules: [{ when: [{ kind: 'always' }], do: [{ kind: 'turn', toward: 'trail', channel: own, degrees: turn }, { kind: 'wander', degrees: wander }, lay] }] };
    case 'drifter':
      return { states: 1, rules: [{ when: [{ kind: 'always' }], do: [
        { kind: 'flow', degrees: r(rng.float(8, 30), 1) },
        { kind: 'turn', toward: 'trail', channel: own, degrees: r(turn * rng.float(0.3, 0.7), 1) },
        { kind: 'wander', degrees: r(wander * 0.5, 1) }, lay,
      ] }] };
    case 'flocker': {
      const crowd = r(rng.float(4, 14), 1);
      return { states: 1, rules: [
        { when: [{ kind: 'sense', channel: own, where: 'here', cmp: '>', value: crowd }], do: [{ kind: 'turn', toward: 'trail', channel: own, away: true, degrees: r(rng.float(10, 25), 1) }, lay], stop: true },
        { when: [{ kind: 'always' }], do: [{ kind: 'turn', toward: 'trail', channel: own, degrees: r(rng.float(3, 12), 1) }, { kind: 'wander', degrees: r(rng.float(2, 6), 1) }, lay] },
      ] };
    }
    case 'pulser': {
      const rate = r(rng.float(0.4, 1.2), 2), on = r(rng.float(0.08, 0.3), 2);
      return { states: 2, rules: [
        { when: [{ kind: 'age', cmp: '<', seconds: 0.02 }], do: [{ kind: 'memory', mode: 'random', value: 1 }] },
        { when: [{ kind: 'always' }], do: [{ kind: 'memory', mode: 'perSecond', value: rate }, { kind: 'turn', toward: 'trail', channel: own, degrees: r(turn * 0.5, 1) }, { kind: 'wander', degrees: wander }] },
        { when: [{ kind: 'state', state: 0 }, { kind: 'sense', channel: own, where: 'any', cmp: '>', value: r(rng.float(0.3, 0.7), 2) }, { kind: 'memory', cmp: '>', value: 0.6 }], do: [{ kind: 'state', state: 1 }, { kind: 'memory', mode: 'set', value: 0 }] },
        { when: [{ kind: 'state', state: 0 }, { kind: 'memory', cmp: '>', value: 1 }], do: [{ kind: 'state', state: 1 }, { kind: 'memory', mode: 'set', value: 0 }] },
        { when: [{ kind: 'state', state: 1 }], do: [lay] },
        { when: [{ kind: 'state', state: 1 }, { kind: 'memory', cmp: '>', value: on }], do: [{ kind: 'state', state: 0 }] },
      ] };
    }
  }
}

const SPECIES_NAMES: Record<WalkerKind, string[]> = {
  tracker: ['Slime', 'Threads', 'Veins', 'Mould'],
  drifter: ['Drifters', 'Spores', 'Currents', 'Pollen'],
  flocker: ['Flock', 'Swarm', 'Shoal', 'Starlings'],
  pulser: ['Fireflies', 'Sparks', 'Beacons', 'Pulses'],
};

/** A random rule set (and its trail's numbers and colours). `d3`: bands for a 3D group. */
export function surpriseAgents(rng: Rng, o: { d3?: boolean } = {}): AgentSurprise {
  const pick = rng.weighted<(typeof WALKER_KINDS)[number]>([[WALKER_KINDS[0], 4], [WALKER_KINDS[1], 2], [WALKER_KINDS[2], 2], [WALKER_KINDS[3], 2]]);
  const kind = pick.kind;
  const deposit = rng.float(0.5, 2);
  const cols = harmoniousPalette(rng.fork('colours'), 4, { light: [0.55, 0.78] });
  const speedBand: [number, number] = o.d3 ? [1, 1.5] : kind === 'pulser' ? [0.03, 0.1] : [0.12, 0.4];
  const first = kindRules(kind, rng.fork('rules0'), 0, deposit);
  const species: AgentSpeciesRules[] = [{
    name: rng.pick(SPECIES_NAMES[kind]),
    speed: r(rng.float(...speedBand), 3),
    states: Array.from({ length: first.states }, (_, i) => ({ name: kind === 'pulser' ? (i ? 'flash' : 'dark') : 'moving', colour: i === 0 && kind === 'pulser' ? cols[0].map(v => r(v * 0.3)) as RGB : cols[i] })),
    rules: first.rules,
  }];
  let relation: AgentSurprise['relation'] = null;
  if (rng.chance(0.3)) {
    relation = rng.chance(0.5) ? 'attract' : 'avoid';
    const k2 = rng.pick<WalkerKind>(['tracker', 'drifter', 'flocker']);
    const second = kindRules(k2, rng.fork('rules1'), 1, deposit);
    const react: AgentRule = { when: [{ kind: 'near', species: 0, value: r(rng.float(0.1, 0.5), 2) }], do: [{ kind: 'turn', toward: 'trail', channel: 0, away: relation === 'avoid', degrees: r(rng.float(15, 40), 1) }, { kind: 'trail', channel: 1, amount: r(deposit) }], stop: true };
    species.push({ name: relation === 'attract' ? 'Followers' : 'Shy ones', speed: r(rng.float(...speedBand) * rng.float(0.8, 1.3), 3), states: [{ name: 'moving', colour: cols[3] }], rules: [react, ...second.rules] });
  }
  const set: AgentRuleSet = {
    v: 1,
    channels: ['', '', '', ''],
    masks: [],
    edges: rng.weighted([['wrap', 4], ['bounce', 1]]),
    sensor: o.d3 ? { distance: r(rng.float(0.1, 0.2)), angle: r(rng.float(20, 50), 1) } : { distance: r(rng.logFloat(0.015, 0.06), 4), angle: r(rng.float(15, 60), 1) },
    flow: { size: r(rng.logFloat(0.5, 3), 2), evolve: r(rng.float(0.05, 0.4), 2) },
    species,
  };
  const trail = { halfLife: r(rng.logFloat(0.03, 0.3)), diffuse: r(rng.float(0.3, 1), 2) };
  const palette = rampPalette(rng.fork('palette'), 5).map(c => c.map(v => r(v)) as RGB);
  const summary = `${pick.label}${relation ? ` + a second species that ${relation === 'attract' ? 'follows' : 'avoids'} it` : ''}`;
  return { set, kind, family: pick.family, trail, palette, relation, summary };
}

export const surpriseAgentsFromSeed = (seed: number, o: { d3?: boolean } = {}) => surpriseAgents(makeRng(seed), o);
