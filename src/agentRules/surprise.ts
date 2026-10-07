/**
 * surprise.ts — Agent Rules' Surprise me (docs/surprise.md): a random rule set that moves well.
 *
 * It picks a walker kind (the rule set's Kind: trail followers, ants-like carriers, a flock, a
 * swarm, a crowd, particles) and a template family of that kind, then sets the numbers inside
 * bands where the patterns form: sensor angle and distance, turn, wander, speed, how much trail
 * it leaves (deposit), how fast the trail fades (decay, the Trail field's Half-life) and its
 * colours. Trail followers come in three styles (trackers, flow drifters, crowd-shy gatherers);
 * carriers pulse between two states like fireflies; flocks, swarms, crowds and particles start
 * from their kind's template with every number varied. Now and then trail followers get a
 * second species drawn to, or keeping away from, the first one's trail.
 *
 * Every walker leaves trail, so the picture of a plain trail setup (Deposit → Trail field →
 * palette) shows them whatever the kind; no rule set needs a mask or births. Pure;
 * deterministic for a seed.
 */
import { harmoniousPalette, makeRng, rampPalette, type Rng, type RGB } from '../lib/surprise';
import { rulesTemplate } from './templates';
import type { AgentRule, AgentRuleSet, AgentSpeciesRules, ChannelRef, RuleAction, WalkerKind } from './spec';

/** How a trail follower or carrier moves (the styles Surprise me writes by hand). */
export type WalkerStyle = 'tracker' | 'drifter' | 'flocker' | 'pulser';

/** The kinds Surprise me picks, by weight, with the template family each comes from. */
export const SURPRISE_KINDS: Array<{ kind: WalkerKind; family: string; weight: number }> = [
  { kind: 'trail', family: 'slime', weight: 5 },
  { kind: 'ants', family: 'fireflies', weight: 1 },
  { kind: 'flock', family: 'boids', weight: 2 },
  { kind: 'swarm', family: 'swarm', weight: 1 },
  { kind: 'crowd', family: 'crowd', weight: 1 },
  { kind: 'particles', family: 'particles', weight: 1 },
];

const STYLE_LABEL: Record<WalkerStyle, string> = {
  tracker: 'Trail trackers (Slime mold)',
  drifter: 'Flow drifters (Slime mold on a flow field)',
  flocker: 'Gatherers that keep apart (Slime mold, crowd-shy)',
  pulser: 'Pulsers (Fireflies-like: two states, flashing)',
};
const KIND_LABEL: Partial<Record<WalkerKind, string>> = {
  flock: 'A flock (boids)', swarm: 'A swarm of orbiters', crowd: 'Two crowds walking past each other', particles: 'A particle fountain',
};

export interface AgentSurprise {
  set: AgentRuleSet;
  /** The rule set's Kind. */
  kind: WalkerKind;
  /** Trail followers and carriers: how they move (null for a template-based kind). */
  style: WalkerStyle | null;
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
function kindRules(kind: WalkerStyle, rng: Rng, sp: number, deposit: number): { rules: AgentRule[]; states: number } {
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

const SPECIES_NAMES: Record<WalkerStyle, string[]> = {
  tracker: ['Slime', 'Threads', 'Veins', 'Mould'],
  drifter: ['Drifters', 'Spores', 'Currents', 'Pollen'],
  flocker: ['Flock', 'Swarm', 'Shoal', 'Starlings'],
  pulser: ['Fireflies', 'Sparks', 'Beacons', 'Pulses'],
};

/** Trail followers (tracker, drifter, flocker styles) and carriers (pulsers), written by hand. */
function styledAgents(rng: Rng, specKind: 'trail' | 'ants', o: { d3?: boolean }): AgentSurprise {
  const kind: WalkerStyle = specKind === 'ants' ? 'pulser' : rng.weighted<WalkerStyle>([['tracker', 4], ['drifter', 2], ['flocker', 2]]);
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
    const k2 = rng.pick<WalkerStyle>(['tracker', 'drifter', 'flocker']);
    const second = kindRules(k2, rng.fork('rules1'), 1, deposit);
    const react: AgentRule = { when: [{ kind: 'near', species: 0, value: r(rng.float(0.1, 0.5), 2) }], do: [{ kind: 'turn', toward: 'trail', channel: 0, away: relation === 'avoid', degrees: r(rng.float(15, 40), 1) }, { kind: 'trail', channel: 1, amount: r(deposit) }], stop: true };
    species.push({ name: relation === 'attract' ? 'Followers' : 'Shy ones', speed: r(rng.float(...speedBand) * rng.float(0.8, 1.3), 3), states: [{ name: 'moving', colour: cols[3] }], rules: [react, ...second.rules] });
  }
  const set: AgentRuleSet = {
    v: 1,
    kind: specKind,
    channels: ['', '', '', ''],
    masks: [],
    edges: rng.weighted([['wrap', 4], ['bounce', 1]]),
    sensor: o.d3 ? { distance: r(rng.float(0.1, 0.2)), angle: r(rng.float(20, 50), 1) } : { distance: r(rng.logFloat(0.015, 0.06), 4), angle: r(rng.float(15, 60), 1) },
    flow: { size: r(rng.logFloat(0.5, 3), 2), evolve: r(rng.float(0.05, 0.4), 2) },
    species,
  };
  const trail = { halfLife: r(rng.logFloat(0.03, 0.3)), diffuse: r(rng.float(0.3, 1), 2) };
  const palette = rampPalette(rng.fork('palette'), 5).map(c => c.map(v => r(v)) as RGB);
  const summary = `${STYLE_LABEL[kind]}${relation ? ` + a second species that ${relation === 'attract' ? 'follows' : 'avoids'} it` : ''}`;
  return { set, kind: specKind, style: kind, family: kind === 'pulser' ? 'fireflies' : 'slime', trail, palette, relation, summary };
}

/** Numbers of an action worth varying (its strength, reach and timing), and their bounds. */
const VARY: Record<string, [number, number]> = {
  degrees: [0.5, 60], radius: [0.01, 0.12], strength: [0.1, 3], distance: [0.2, 0.8], amount: [0.05, 2], jam: [10, 60], margin: [0.02, 0.2], seconds: [1, 6], value: [0.05, 1.5],
};

/** A copy of an action with each of its numbers times 0.65–1.5, inside its bounds (angles of a force kept). */
function varyAction(a: RuleAction, rng: Rng): RuleAction {
  const out: Record<string, unknown> = { ...a };
  for (const [k, v] of Object.entries(a)) {
    const b = VARY[k];
    if (!b || typeof v !== 'number' || (a.kind === 'state')) continue;
    const sign = v < 0 ? -1 : 1;
    out[k] = r(sign * Math.min(b[1], Math.max(b[0], Math.abs(v) * rng.float(0.65, 1.5))), 3);
  }
  if (a.kind === 'orbit') out.cw = rng.chance(0.5);
  return out as RuleAction;
}

/** Flock, swarm, crowd, particles: the kind's template with every number varied, new colours, and trail laid. */
function templateAgents(rng: Rng, kind: WalkerKind, family: string, o: { d3?: boolean }): AgentSurprise {
  const base = rulesTemplate(family)!.set();
  const cols = harmoniousPalette(rng.fork('colours'), 4, { light: [0.55, 0.78] });
  const deposit = r(rng.float(0.5, 2));
  const species: AgentSpeciesRules[] = base.species.map((sp, i) => ({
    ...sp,
    speed: r(o.d3 ? rng.float(1, 1.5) : sp.speed * rng.float(0.7, 1.4), 3),
    states: sp.states.map((st, j) => ({ ...st, colour: cols[(i + j) % cols.length] })),
    // No "die": the trail setup's Emit may not refill, and a surprise must not empty the picture.
    rules: sp.rules.filter(rule => !rule.do.some(a => a.kind === 'die')).map((rule, j) => ({
      ...rule,
      do: [...rule.do.map(a => varyAction(a, rng)), ...(j === 0 && !rule.off && !rule.do.some(a => a.kind === 'trail') ? [{ kind: 'trail' as const, channel: i as ChannelRef, amount: deposit }] : [])],
    })),
  }));
  const set: AgentRuleSet = {
    ...base,
    edges: base.edges,
    neighbours: base.neighbours ? { ...base.neighbours, radius: r(base.neighbours.radius * rng.float(0.7, 1.4), 3) } : undefined,
    flow: { size: r(rng.logFloat(0.5, 3), 2), evolve: r(rng.float(0.05, 0.4), 2) },
    species,
  };
  if (!set.neighbours) delete set.neighbours;
  const trail = { halfLife: r(rng.logFloat(0.03, 0.3)), diffuse: r(rng.float(0.3, 1), 2) };
  const palette = rampPalette(rng.fork('palette'), 5).map(c => c.map(v => r(v)) as RGB);
  return { set, kind, style: null, family, trail, palette, relation: null, summary: `${KIND_LABEL[kind] ?? kind} (${family} template, varied)` };
}

/** A random rule set (and its trail's numbers and colours). `d3`: bands for a 3D group. */
export function surpriseAgents(rng: Rng, o: { d3?: boolean } = {}): AgentSurprise {
  const pick = rng.weighted(SURPRISE_KINDS.map(k => [k, k.weight] as const));
  if (pick.kind === 'trail' || pick.kind === 'ants') return styledAgents(rng.fork('styled'), pick.kind, o);
  return templateAgents(rng.fork('template'), pick.kind, pick.family, o);
}

export const surpriseAgentsFromSeed = (seed: number, o: { d3?: boolean } = {}) => surpriseAgents(makeRng(seed), o);
