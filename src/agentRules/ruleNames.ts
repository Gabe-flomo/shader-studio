/**
 * ruleNames.ts — short names for rules and their actions, from what they do ("Follow trail",
 * "Keep apart", "Die when older than 6 s"), for the nodes a rule set becomes (generate.ts: node
 * labels and notes) and the editors' rule titles. A rule the user named keeps its name.
 */
import { type AgentRule, type AgentRuleSet, type RuleAction, type RuleCondition, channelName, memoryOf } from './spec';
import { fieldName } from './fields';

const num = (v: number) => String(Math.round(v * 1000) / 1000);
const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
/** "food trail" stays; "its own trail" reads "trail". */
const trailWord = (set: AgentRuleSet, ch: Parameters<typeof channelName>[1]) => {
  const n = channelName(set, ch);
  return n === 'its own trail' ? 'trail' : n;
};
const stateName = (set: AgentRuleSet, sp: number, s: number) => set.species[sp]?.states[s]?.name || `state ${s + 1}`;
const target = (t: string) => (t === 'mouse' ? 'mouse' : t === 'centre' ? 'centre' : 'point');

/** An action's short name: "Follow trail", "Seek mouse", "Gravity", "Keep apart". */
export function actionTitle(set: AgentRuleSet, sp: number, a: RuleAction): string {
  switch (a.kind) {
    case 'turn':
      if (a.toward === 'trail') return `${a.away ? 'Avoid' : 'Follow'} ${trailWord(set, a.channel)}`;
      if (a.toward === 'mouse') return a.away ? 'Flee mouse' : 'Seek mouse';
      return `${a.away ? 'Away from' : 'Head to'} ${target(a.toward)}`;
    case 'wander': return 'Wander';
    case 'speed': return a.mode === 'set' ? `Speed ${num(a.value)}` : a.value < 0 ? 'Slow down' : 'Speed up';
    case 'trail': return `Leave ${trailWord(set, a.channel)}`;
    case 'state': return `Become ${stateName(set, sp, a.state)}`;
    case 'memory': return a.mode === 'random' ? 'Random memory' : a.mode === 'set' ? 'Set memory' : 'Count memory';
    case 'stop': return 'Stop';
    case 'stick': return 'Stick';
    case 'die': return 'Die';
    case 'spawn': return 'Spawn';
    case 'bounce': return 'Turn round';
    case 'flow': return a.away ? 'Against the flow' : 'Follow flow';
    case 'align': return 'Fly with crowd';
    case 'separate': return a.who === 'others' ? 'Avoid other kinds' : 'Keep apart';
    case 'match': return 'Align with neighbours';
    case 'cohere': return 'Stay together';
    case 'slow': return 'Slow in a crowd';
    case 'avoidEdges': return 'Avoid walls';
    case 'orbit': return `Orbit ${target(a.target)}`;
    case 'force':
      switch (a.field) {
        case 'gravity': {
          const ang = a.angle ?? -90;
          return Math.abs(ang - 90) < 1 ? 'Rise' : 'Gravity';
        }
        case 'wind': return 'Wind';
        case 'curl': return 'Curl noise';
        case 'mouse': return a.strength < 0 ? 'Push from mouse' : 'Pull to mouse';
        case 'point': return a.strength < 0 ? 'Push from point' : 'Pull to point';
      }
      return 'Force';
    case 'drag': return 'Drag';
    case 'fade': return 'Fade with age';
    case 'field': return `Follow ${fieldName(a.spec)}`;
    case 'home': return 'Return home';
    case 'mem': {
      const m = memoryOf(set, a.memory)?.name || 'memory';
      const verb = ({ add: 'Count', set: 'Set', toggle: 'Toggle', reset: 'Reset', place: 'Remember', smell: 'Smell into', sum: 'Add up', decay: 'Decay', expr: 'Update' } as const)[a.op];
      return `${verb} ${m}`;
    }
  }
}

/** A condition, short, after "when": "older than 6 s", "on food trail", "sometimes". */
export function conditionWords(set: AgentRuleSet, sp: number, c: RuleCondition): string {
  switch (c.kind) {
    case 'always': return '';
    case 'sense': return `${c.cmp === '<' ? 'off' : 'on'} ${trailWord(set, c.channel)}`;
    case 'near': return `near ${set.species[c.species]?.name ?? `species ${c.species + 1}`}`;
    case 'chance': return 'by chance';
    case 'age': return `${c.cmp === '<' ? 'younger' : 'older'} than ${num(c.seconds)} s`;
    case 'state': return `${c.not ? 'not ' : ''}${stateName(set, sp, c.state)}`;
    case 'memory': return 'memory says so';
    case 'mem': {
      const m = memoryOf(set, c.memory);
      const name = m?.name || 'memory';
      if (m?.type === 'flag') return `${name} ${c.cmp === '<' ? 'off' : 'on'}`;
      return `${name} ${c.cmp} ${num(c.value)}`;
    }
    case 'mask': return `${c.cmp === '<' ? 'outside' : 'in'} ${set.masks[c.mask]?.name || `mask ${c.mask + 1}`}`;
    case 'neighbours': return c.cmp === '<' ? 'alone' : 'crowded';
    case 'shape': return `${c.outside ? 'outside' : 'inside'} the ${c.shape}`;
  }
}

/** What a rule's actions do, short: "Keep apart, align with neighbours + 2 more". */
export function actionsTitle(set: AgentRuleSet, sp: number, rule: AgentRule): string {
  const t = rule.do.map(a => actionTitle(set, sp, a));
  if (!t.length) return 'Nothing';
  if (t.length === 1) return t[0];
  if (t.length === 2) return `${t[0]} & ${t[1].toLowerCase()}`;
  return `${t[0]}, ${t[1].toLowerCase()} + ${t.length - 2} more`;
}

/** The conditions of a rule, short ("older than 6 s and on trail"), or '' when it always applies. */
export function whenTitle(set: AgentRuleSet, sp: number, rule: AgentRule): string {
  return rule.when.map(c => conditionWords(set, sp, c)).filter(Boolean).join(' and ');
}

/** A rule's name: the user's, else from what it does ("Die when older than 6 s", "Follow trail"). */
export function ruleTitle(set: AgentRuleSet, sp: number, rule: AgentRule): string {
  const own = rule.name?.trim();
  if (own) return own;
  const when = whenTitle(set, sp, rule);
  return cap(`${actionsTitle(set, sp, rule)}${when ? ` when ${when}` : ''}`);
}
