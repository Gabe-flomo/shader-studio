/**
 * onlyWhen.ts — the "Only when…" line on a behaviour card (docs/agent-builder.md): a picker of plain
 * conditions, each one a rule condition (agentRules/spec.ts), and the few words of its chip. Pure.
 */
import { type AgentRuleSet, type RuleCondition, DEFAULT_NEIGHBOURS, channelName } from '../agentRules/spec';
import type { OnlyWhenKind } from './behaviours';

export const ONLY_WHEN_PICKER: ReadonlyArray<{ kind: OnlyWhenKind; label: string; hint: string }> = [
  { kind: 'neighbours', label: 'a neighbour is near', hint: 'More than so many walkers within its view.' },
  { kind: 'sense', label: 'it smells …', hint: 'A trail it smells anywhere ahead is above a level.' },
  { kind: 'shape', label: 'inside / outside a shape', hint: 'Where it stands: inside or outside a circle or a box.' },
  { kind: 'age', label: 'older than …', hint: 'Seconds since it was born.' },
  { kind: 'chance', label: 'by chance …', hint: 'A random chance each second.' },
  { kind: 'state', label: 'in state …', hint: 'One of its kind\'s states (from the rules editor).' },
];

/** A new "only when" of a kind, with plain defaults. */
export function newOnlyWhen(kind: OnlyWhenKind): RuleCondition {
  switch (kind) {
    case 'neighbours': return { kind, who: 'all', cmp: '>', count: 0 };
    case 'sense': return { kind, channel: 'own', where: 'any', cmp: '>', value: 0.3 };
    case 'shape': return { kind, shape: 'circle', x: 0, y: 0, size: 0.4 };
    case 'age': return { kind, cmp: '>', seconds: 2 };
    case 'chance': return { kind, perSecond: 0.2 };
    case 'state': return { kind, state: 0 };
  }
}

const n = (v: number, d = 3) => String(Math.round(v * 10 ** d) / 10 ** d);

/** The chip's words: "a neighbour is near", "older than 2 s", "inside a circle"… */
export function onlyWhenText(set: AgentRuleSet, sp: number, c: RuleCondition): string {
  switch (c.kind) {
    case 'neighbours': {
      const who = c.who === 'own' ? ' of its kind' : c.who === 'others' ? ' of another kind' : '';
      if (c.cmp === '>' && c.count < 1) return `a neighbour${who} is near`;
      return `${c.cmp === '>' ? 'more' : 'fewer'} than ${n(c.count, 0)}${who} near`;
    }
    case 'sense': return `it smells ${channelName(set, c.channel).replace(/ trail$/, '')} ${c.cmp === '>' ? 'above' : 'below'} ${n(c.value, 2)}`;
    case 'shape': return `${c.outside ? 'outside' : 'inside'} a ${c.shape}`;
    case 'age': return `${c.cmp === '>' ? 'older' : 'younger'} than ${n(c.seconds, 2)} s`;
    case 'chance': return `by chance, ${n(c.perSecond * 100, 1)}% a second`;
    case 'state': return `${c.not ? 'not ' : ''}${set.species[sp]?.states[c.state]?.name || `state ${c.state + 1}`}`;
    default: return 'a condition';
  }
}

/** The radius a neighbour "only when" reads (its own, or the view radius). */
export const onlyWhenReach = (set: AgentRuleSet, c: Extract<RuleCondition, { kind: 'neighbours' }>) =>
  (c.radius && c.radius > 0 ? c.radius : set.neighbours?.radius ?? DEFAULT_NEIGHBOURS.radius);
