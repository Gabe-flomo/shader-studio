/**
 * surprise.ts — the Agent Builder's Surprise me (docs/agent-builder.md "Surprise me"): a random
 * rule set of the group's own kind, so the builder keeps its sections and the setup round the group
 * (Emit, Draw agents, Trail) still suits it. Pure; the same seed and kind give the same result.
 *
 *  - Trail followers: half the time one of agentRules/surprise.ts's hand-written styles (trackers,
 *    flow drifters, crowd-shy gatherers, sometimes a second species), else one of the kind's presets
 *    with its numbers varied.
 *  - Ants / carriers: the pulsers style, or the ants preset varied (its memories kept as they are).
 *  - Particles, flocks, crowds, orbiters: one of the kind's presets, every number varied inside
 *    bands where it still moves well (agentRules/surprise.ts varyAction), new colours. Unlike the
 *    rules editor's surprise, "dies" rules stay (the builder's particle setups are born again) and no
 *    trail is added (their picture is Draw agents).
 *
 * In 3D the result is rescaled the way a preset is (rescaleForSpace), and a shape's Collide is kept
 * by the caller.
 */
import { harmoniousPalette, makeRng, rampPalette, type Rng, type RGB } from '../lib/surprise';
import { type AgentSurprise, styledAgents, varyAction } from '../agentRules/surprise';
import { rescaleForSpace } from '../agentRules/space3d';
import { type AgentRuleSet, type RuleAction, type WalkerKind, kindOf } from '../agentRules/spec';
import { presetsFor } from './presets';

const r3 = (v: number) => Math.round(v * 1000) / 1000;
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/** Actions whose numbers mean something exact (a memory flag, a state, a birth mark): never varied. */
const KEEP = new Set<RuleAction['kind']>(['mem', 'memory', 'state', 'spawn', 'field'] as RuleAction['kind'][]);

/** One of the kind's presets (only those of this kind), with every number varied and new colours. */
function variedPreset(rng: Rng, kind: WalkerKind, d3 = false): { set: AgentRuleSet; label: string } | null {
  // In 3D only presets that rescale (they sense a trail): a 2D-sized one would be tiny in the volume.
  const list = presetsFor(kind).filter(p => { const set = p.set(); return kindOf(set) === kind && (!d3 || (kind !== 'trail' && kind !== 'ants') || rescaleForSpace(set, '3d') !== set); });
  if (!list.length) return null;
  const p = rng.pick(list);
  const base = p.set();
  const cols = harmoniousPalette(rng.fork('colours'), 4, { light: [0.55, 0.78] });
  const trailKind = kind === 'trail' || kind === 'ants';
  const set: AgentRuleSet = {
    ...base,
    sensor: trailKind
      ? { distance: r3(clamp(base.sensor.distance * rng.float(0.7, 1.45), 0.012, 0.08)), angle: r3(clamp(base.sensor.angle * rng.float(0.7, 1.4), 8, 85)) }
      : base.sensor,
    neighbours: base.neighbours ? { ...base.neighbours, radius: r3(clamp(base.neighbours.radius * rng.float(0.75, 1.35), 0.01, 0.2)) } : undefined,
    flow: { size: r3(rng.logFloat(0.5, 3)), evolve: r3(rng.float(0.05, 0.4)) },
    species: base.species.map((sp, i) => ({
      ...sp,
      speed: r3(sp.speed * rng.float(0.75, 1.35)),
      states: sp.states.map((st, j) => ({ ...st, colour: cols[(i + j) % cols.length] })),
      rules: sp.rules.map(rule => ({ ...rule, do: rule.do.map(a => (KEEP.has(a.kind) ? a : varyAction(a, rng))) })),
    })),
  };
  if (!set.neighbours) delete set.neighbours;
  return { set, label: p.label };
}

/** A surprise for a builder group of kind `kind` (its Trail's numbers and palette too, for trail followers). */
export function surpriseForKind(rng: Rng, kind: WalkerKind, o: { d3?: boolean } = {}): AgentSurprise {
  const trail = { halfLife: r3(rng.logFloat(0.03, 0.3)), diffuse: r3(rng.float(0.3, 1)) };
  const palette = rampPalette(rng.fork('palette'), 5).map(c => c.map(r3) as RGB);
  const trailKind = kind === 'trail' || kind === 'ants';
  if (trailKind && rng.chance(0.5)) {
    const s = styledAgents(rng.fork('styled'), kind, { d3: o.d3 });
    return { ...s, kind, set: { ...s.set, kind } };
  }
  const v = variedPreset(rng.fork('preset'), kind, o.d3);
  if (!v) {
    const s = styledAgents(rng.fork('styled'), 'trail', { d3: o.d3 });
    return { ...s, kind: 'trail' };
  }
  const set = o.d3 ? rescaleForSpace(v.set, '3d') : v.set;
  return { set, kind, style: null, family: v.label, trail, palette, relation: null, summary: `${v.label}, every number varied` };
}

export const surpriseForKindFromSeed = (seed: number, kind: WalkerKind, o: { d3?: boolean } = {}) => surpriseForKind(makeRng(seed), kind, o);
