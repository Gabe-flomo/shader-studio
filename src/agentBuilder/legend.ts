/**
 * legend.ts — the viewport's legend (docs/agent-builder.md "Legend, tags and focus"). Pure.
 *
 * The diagram over the live picture used to carry its own sentences ("curl flow ×0.9 · eddies 1.4",
 * "one particle · all together (orange)", "a second later: 45%"), scattered over the picture. Now:
 *
 *  - one **legend** lists what is drawn: a colour dot matching its drawing, its key numbers and one
 *    plain line saying what it does to the walkers, worded from the actual values and directions
 *    (the phrase generators below, one per behaviour);
 *  - the drawings carry only small coloured **tags** (a number, never a sentence), laid out so they
 *    don't overlap (`layoutTags`);
 *  - an entry knows the control it comes from (`card`, `settings`, `el`), so the legend, the tag,
 *    the drawing and the inspector light together (`entryForFocus`);
 *  - an entry's `demo` is what its focus view animates, from the live values (demos.ts).
 */
import type { AgentRuleSet, RuleAction, RuleCondition, WalkerKind } from '../agentRules/spec';
import { DEFAULT_NEIGHBOURS } from '../agentRules/spec';
import type { CardRead } from './behaviours';
import type { TrailCards } from './cards';
import type { DiagramFocus } from './diagram';
import { CARD_WORDS } from './sections';
import { type FieldLayer, type FieldSpec, FIELD_KINDS, normalizeFieldSpec, ownParts } from '../agentRules/fields';

type Act<K extends RuleAction['kind']> = Extract<RuleAction, { kind: K }>;

/** A number as people read it: up to `d` decimals, a real minus sign. */
export const num = (v: number, d = 3) => {
  const r = Math.round(v * 10 ** d) / 10 ** d;
  return (r < 0 ? '−' : '') + String(Math.abs(r));
};
const pct = (v: number) => `${Math.round(v * 100)}%`;

// ── Words for walkers and directions ─────────────────────────────────────────

export interface Noun { one: string; many: string }
export const NOUNS: Record<WalkerKind, Noun> = {
  trail: { one: 'walker', many: 'walkers' },
  ants: { one: 'ant', many: 'ants' },
  particles: { one: 'particle', many: 'particles' },
  flock: { one: 'bird', many: 'birds' },
  crowd: { one: 'person', many: 'people' },
  swarm: { one: 'orbiter', many: 'orbiters' },
};

/**
 * A direction in degrees (0 right, 90 up, −90 down, as the forces' Direction) in words: the nearest
 * of eight, as "pointing up" (`to`) and "pulled upward" (`ward`).
 */
export function directionWords(deg: number): { to: string; ward: string } {
  const a = ((Math.round(deg / 45) % 8) + 8) % 8;
  return [
    { to: 'right', ward: 'to the right' },
    { to: 'up and to the right', ward: 'up and to the right' },
    { to: 'up', ward: 'upward' },
    { to: 'up and to the left', ward: 'up and to the left' },
    { to: 'left', ward: 'to the left' },
    { to: 'down and to the left', ward: 'down and to the left' },
    { to: 'down', ward: 'downward' },
    { to: 'down and to the right', ward: 'down and to the right' },
  ][a];
}

/** A force's strength and direction with a negative strength turned round (it pulls the other way). */
const signed = (strength: number, deg: number) => (strength < 0 ? { s: -strength, deg: deg + 180, flipped: true } : { s: strength, deg, flipped: false });

const where = (x: number, y: number) => `(${num(x, 2)}, ${num(y, 2)})`;

// ── One plain line for each behaviour ────────────────────────────────────────

export const phrase = {
  gravity(n: Noun, strength: number, angle: number): string {
    if (Math.abs(strength) < 1e-6) return `Gravity 0: no pull; each ${n.one} keeps the speed it has.`;
    const g = signed(strength, angle);
    const d = directionWords(g.deg);
    return `Gravity ${num(g.s, 2)}, pointing ${d.to}${g.flipped ? ' (negative: turned round)' : ''}: each ${n.one} is pulled ${d.ward}; its speed that way grows by ${num(g.s, 2)} a second.`;
  },
  wind(n: Noun, strength: number, angle: number): string {
    if (Math.abs(strength) < 1e-6) return 'Wind 0: still air.';
    const g = signed(strength, angle);
    const d = directionWords(g.deg);
    return `Wind ${num(g.s, 2)} blowing ${d.to}, in gusts: ${n.many} drift ${d.ward}, gaining up to about ${num(g.s, 2)} speed a second as the gusts rise and fall.`;
  },
  curl(n: Noun, strength: number, eddies: number, evolve: number): string {
    if (Math.abs(strength) < 1e-6) return 'Curl flow ×0: no current.';
    const still = evolve <= 1e-6 ? 'the currents stand still' : evolve < 0.3 ? 'the currents shift slowly' : 'the currents shift quickly';
    return `Curl flow ×${num(Math.abs(strength), 2)}, eddies ${num(eddies, 2)}: ${n.many} ride swirling currents that never bunch them up (bigger Eddies: smaller, busier swirls); ${still}.`;
  },
  attract(n: Noun, strength: number, target: 'point' | 'mouse', x = 0, y = 0): string {
    const at = target === 'mouse' ? 'the mouse' : `the point ${where(x, y)}`;
    if (Math.abs(strength) < 1e-6) return `Attract 0: ${at} neither pulls nor pushes.`;
    return strength > 0
      ? `Attract ${num(strength, 2)}: each ${n.one} is pulled toward ${at}, gaining ${num(strength, 2)} speed a second toward it, however far away it is.`
      : `Repel ${num(-strength, 2)}: each ${n.one} is pushed away from ${at}, gaining ${num(-strength, 2)} speed a second away from it, however far away it is.`;
  },
  drag(n: Noun, amount: number): string {
    const a = Math.max(0, amount);
    if (a < 1e-6) return `Drag 0: nothing slows ${n.many}; they keep all their speed.`;
    return `Drag ${num(a, 2)}: after a second a ${n.one} keeps ${pct(Math.exp(-a))} of its speed.`;
  },
  sum(n: Noun, strength: number, deg: number): string {
    if (strength < 1e-6) return `All together: the forces cancel out; a ${n.one} keeps the speed it has.`;
    return `All together: the forces add up to ${num(strength, 2)}, pointing ${directionWords(deg).to}; that is how each ${n.one}'s velocity changes every second.`;
  },
  fade(n: Noun, seconds: number): string {
    return `Fade with age ${num(seconds, 2)} s: each ${n.one} dims from full colour at birth to black at ${num(seconds, 2)} s old.`;
  },
  die(n: Noun, when: string | null, seconds: number | null): string {
    if (seconds !== null) return `Dies at ${num(seconds, 2)} s old: then the ${n.one} is gone (Kept full brings a new one at once).`;
    if (when) return `Dies when ${when}.`;
    return 'Dies at once, every step: give it an "only when".';
  },
  lives(n: Noun, life: number): string {
    return life > 0 ? `Lives for ${num(life, 2)} s: each ${n.one} is taken away at that age.` : `Lives for ever: only a Dies card ends a ${n.one}.`;
  },
  turnRule(n: Noun, what: 'separate' | 'match' | 'cohere', degrees: number, who: 'all' | 'own' | 'others' = 'all'): string {
    const title = CARD_WORDS[what].title;
    if (degrees <= 1e-6) return `${title} 0°: it doesn't turn for this.`;
    const whose = who === 'own' ? ' of its own kind' : who === 'others' ? ' of the other kinds' : '';
    const how = what === 'separate' ? `away from the ones${whose} too close`
      : what === 'match' ? `toward the way its neighbours${whose} go`
        : `toward the middle of the ones${whose} it sees`;
    return `${title} ${num(degrees, 1)}°: each ${n.one} turns up to ${num(degrees, 1)}° a step ${how}.`;
  },
  avoidEdges(n: Noun, margin: number, degrees: number): string {
    return `Avoid edges ${num(margin, 2)}: within ${num(margin, 2)} of the picture's edge, each ${n.one} turns back inward, up to ${num(degrees, 1)}° a step.`;
  },
  goal(n: Noun, toward: string, degrees: number, x = 0, y = 0): string {
    const at = toward === 'point' ? `the point ${where(x, y)}` : `the ${toward}`;
    return `Head for ${at}: each ${n.one} turns up to ${num(degrees, 1)}° a step toward it.`;
  },
  slow(n: Noun, jam: number): string {
    return `Slow in a crowd, jam at ${num(jam, 0)}: a ${n.one} slows as more gather round it, nearly stopping with ${num(jam, 0)} near.`;
  },
  orbit(n: Noun, target: string, distance: number, degrees: number, cw: boolean, x = 0, y = 0): string {
    const at = target === 'point' ? `the point ${where(x, y)}` : `the ${target}`;
    return `Orbit ${num(distance, 2)} round ${at}, ${cw ? 'clockwise' : 'anticlockwise'}: each ${n.one} turns up to ${num(degrees, 1)}° a step to circle ${num(distance, 2)} out, in when further, out when nearer.`;
  },
  wander(n: Noun, degrees: number): string {
    if (degrees <= 1e-6) return `Wander 0°: each ${n.one} goes straight.`;
    return `Wander ±${num(degrees, 1)}°: each step a ${n.one} turns a random amount, up to ${num(degrees, 1)}° either way.`;
  },
  view(n: Noun, radius: number): string {
    return `View radius ${num(radius, 3)}: each ${n.one} looks this far around it, and only knows the ones inside.`;
  },
  max(n: Noun, max: number): string {
    return `Max neighbours ${num(max, 0)}: a ${n.one} counts at most ${num(max, 0)} of the ones it sees; more count the same.`;
  },
  senses(n: Noun, on: boolean, distance: number, angle: number): string {
    if (!on) return `Senses off: ${n.many} don't smell the trail.`;
    return `Sensors ${num(distance, 3)} ahead, ±${num(angle, 1)}°: three feelers smell the trail straight ahead and ${num(angle, 1)}° to each side.`;
  },
  turn(n: Noun, on: boolean, degrees: number, away: boolean): string {
    if (!on) return `No turn: Senses is off, so a ${n.one} doesn't turn toward a smell.`;
    const w = away ? 'away from' : 'toward';
    return `Turn ${num(degrees, 1)}° ${w} the smell: each step a ${n.one} turns up to ${num(degrees, 1)}° ${w} the feeler that smells most.`;
  },
  speed(n: Noun, speed: number, toFeelers?: number): string {
    if (speed <= 1e-6) return `Speed 0: ${n.many} stand still.`;
    const steps = toFeelers !== undefined && isFinite(toFeelers) ? `, ${Math.round(toFeelers)} steps to reach its feelers` : '';
    return `Speed ${num(speed, 3)}: each ${n.one} moves ${num(speed, 3)} a second (${num(speed / 60, 4)} a step)${steps}.`;
  },
  edges(n: Noun, edges: 'wrap' | 'bounce' | 'slide'): string {
    return edges === 'wrap' ? `At the edges: wrap. A ${n.one} that leaves one side comes back in at the other.`
      : edges === 'bounce' ? `At the edges: bounce. A ${n.one} that reaches the edge turns back.`
        : `At the edges: slide. A ${n.one} that reaches the edge runs along it.`;
  },
  trail(n: Noun, on: boolean, amount: number, halfLife: number, diffuse: number): string {
    if (!on) return `Trail off: ${n.many} leave nothing behind.`;
    return `Trail ${num(amount, 2)} a step: it leaves ${num(amount, 2)} where it walks; half of it is gone in ${num(halfLife, 3)} s, and ${pct(diffuse)} spreads to the pixels round it each step.`;
  },
  /**
   * One layer of a field: "Vortex at the centre, strength 0.6: particles circle anticlockwise,
   * faster near the middle." Then what is done to it: turned, only inside a shape, drifting.
   */
  fieldLayer(n: Noun, l: FieldLayer): string {
    const w = Math.abs(l.weight), back = l.weight < 0;
    const at = (l.x ?? 0) === 0 && (l.y ?? 0) === 0 ? 'at the centre' : `at ${where(l.x ?? 0, l.y ?? 0)}`;
    const s = num(l.size ?? FIELD_KINDS[l.kind].defaults.size ?? 0, 2);
    const way = (cw: boolean) => ((cw !== back) ? 'clockwise' : 'anticlockwise');
    const dir = (deg: number) => directionWords(back ? deg + 180 : deg).to;
    let head: string;
    if (w < 1e-6) head = `${FIELD_KINDS[l.kind].label} × 0: it adds nothing.`;
    else switch (l.kind) {
      case 'curl': head = `Curl noise, eddies ${s} across, strength ${num(w, 2)}: ${n.many} ride swirling eddies that never bunch them up.`; break;
      case 'vortex': head = `Vortex ${at}, strength ${num(w, 2)}: ${n.many} circle ${way(!!l.flip)}, faster near the middle (fastest ${s} out).`; break;
      case 'source': head = (!!l.flip !== back)
        ? `Sink ${at}, strength ${num(w, 2)}: ${n.many} stream in to it and gather there.`
        : `Source ${at}, strength ${num(w, 2)}: ${n.many} stream out from it, fastest ${s} out, slower further away.`; break;
      case 'saddle': head = `Saddle ${at}, strength ${num(w, 2)}: ${n.many} come in from ${dir((l.angle ?? 0) + 90)} and ${dir((l.angle ?? 0) - 90)} and leave to the ${dir(l.angle ?? 0)} and ${dir((l.angle ?? 0) + 180)}.`; break;
      case 'dipole': head = `Dipole ${at}, strength ${num(w, 2)}: ${n.many} pour out of one pole and into the other, ${s} each side, flowing ${dir((l.angle ?? 0) + (l.flip ? 180 : 0))} between them.`; break;
      case 'waves': head = `Waves ${s} long, strength ${num(w, 2)}: ${n.many} flow ${dir((l.angle ?? 0) + (l.flip ? 180 : 0))}, weaving from side to side.`; break;
      case 'wind': head = `Uniform wind, strength ${num(w, 2)}, blowing ${dir(l.angle ?? 0)}: every ${n.one} is pushed the same way everywhere.`; break;
      case 'spiral': head = `Spiral ${at}, strength ${num(w, 2)}: ${n.many} circle ${way(!!l.flip)} and drain into the middle.`; break;
      case 'shear': head = `Shear ${at}, band ${s}, strength ${num(w, 2)}: ${n.many} on one side of the line flow ${dir((l.angle ?? 0) + (l.flip ? 180 : 0))}, on the other ${dir((l.angle ?? 0) + (l.flip ? 0 : 180))}.`; break;
      case 'slope': head = `Slope of the graph's field (Field ƒ), strength ${num(w, 2)}: ${n.many} flow ${l.around ? 'round its contour lines' : (!!l.flip !== back) ? 'uphill, toward its high places' : 'downhill, toward its low places'}.`; break;
      case 'own': head = ownParts(l, true).some(p => !p.check.ok) ? `Your own field: not running yet; fix ${ownParts(l, true).filter(p => !p.check.ok).map(p => p.key).join(' and ')} in its card.` : `Your own field, × ${num(l.weight, 2)}: vx = ${l.vx ?? ''}, vy = ${l.vy ?? ''}${l.vz && l.vz.trim() !== '0.0' ? `, vz = ${l.vz}` : ''}.`; break;
    }
    const extra: string[] = [];
    if (l.rotate) extra.push(`turned ${num(l.rotate, 1)}°`);
    if (l.mask) extra.push(`only ${l.mask.outside ? 'outside' : 'inside'} a ${l.mask.shape} ${l.mask.shape === 'circle' ? 'radius' : 'half-width'} ${num(l.mask.size, 2)} round ${where(l.mask.x, l.mask.y)}`);
    if (l.animate?.speed) extra.push(l.animate.mode === 'spin' ? `turning ${num(l.animate.speed, 1)}° a second` : `drifting ${directionWords(l.animate.angle ?? 0).to} at ${num(l.animate.speed, 2)} a second`);
    if (l.off) extra.push('switched off');
    return extra.length ? `${head.replace(/\.$/, '')}; ${extra.join(', ')}.` : head;
  },
  /** How the card uses its field: ridden or as a force. */
  fieldHow(n: Noun, strength: number, grip: number | undefined): string {
    return grip && grip > 0
      ? `Each ${n.one} rides the field × ${num(strength, 2)}: its velocity eases toward the field's, at ${num(grip, 2)} a second.`
      : `The field × ${num(strength, 2)} is a force: each ${n.one}'s velocity changes by it every second.`;
  },
  born(n: Noun, shape: string, size: number, count: string): string {
    const many = count.toUpperCase().replace('K', 'k');
    const at = shape === 'screen' ? 'all over the picture' : shape === 'point' ? 'at one point'
      : shape === 'picture' || shape === 'field' ? 'where the picture is bright'
        : `in a ${shape === 'sphere' ? 'shell' : shape === 'ball' ? 'ball' : shape} of size ${num(size, 2)}`;
    return `Born ${at}: ${many} ${n.many}.`;
  },
};

// ── The legend ───────────────────────────────────────────────────────────────

/** What a focus view animates (demos.ts), with the live values it needs. */
export type DemoSpec =
  | { kind: 'gravity' | 'wind'; strength: number; angle: number }
  | { kind: 'curl'; strength: number; eddies: number; evolve: number }
  | { kind: 'attract'; strength: number; x: number; y: number }
  | { kind: 'drag'; amount: number }
  | { kind: 'sum'; forces: Array<{ field: string; strength: number; angle?: number; x?: number; y?: number }>; drag: number; eddies: number }
  | { kind: 'life'; fade: number | null; dies: number | null }
  | { kind: 'flock'; rule: 'separate' | 'match' | 'cohere'; separate: number; match: number; cohere: number }
  | { kind: 'goal'; degrees: number }
  | { kind: 'slow'; jam: number }
  | { kind: 'avoidEdges'; margin: number; degrees: number }
  | { kind: 'wander'; degrees: number }
  | { kind: 'view'; radius: number; max: number }
  | { kind: 'senses'; angle: number; turn: number; away: boolean }
  | { kind: 'orbit'; degrees: number; cw: boolean }
  | { kind: 'speed'; speed: number }
  | { kind: 'edges'; edges: 'wrap' | 'bounce' | 'slide' }
  | { kind: 'trail'; amount: number; halfLife: number; diffuse: number }
  | { kind: 'born'; shape: string }
  /** Follow a field: the field in motion, particles riding it (`layer`: only that layer, else all). */
  | { kind: 'field'; spec: FieldSpec; strength: number; grip?: number; layer?: number };

export interface LegendEntry {
  /** A card's key (`gravity#0`), or a fixed id (`senses`, `turn`, `view`, `max`, `sum`, `born`…). */
  id: string;
  title: string;
  /** The colour of its drawing, dot and tag. */
  colour: string;
  /** Its key numbers ("0.25 · up"). */
  numbers: string;
  /** One plain line: what it does to the walkers. */
  line: string;
  on: boolean;
  /** The control it comes from: the card (the diagram focus' `card`) and the settings in it. */
  card?: string;
  settings?: string[];
  /** The inspector card to scroll to and pulse (`[data-card="…"]`; empty: none). */
  el: string;
  demo: DemoSpec;
}

/** Each behaviour's colour on the picture (the drawings, dots and tags): light, to read on any picture. */
export const LEGEND_COLOURS = {
  gravity: '#ff9a6b', wind: '#8fd3ff', curl: '#b79cff', attract: '#ffd166', drag: '#6fd6c4', sum: '#ffffff',
  fade: '#ffd166', die: '#ff7a7a', lives: '#6fd6c4',
  separate: '#ff9a6b', match: '#57b6ff', cohere: '#7ad38a', avoidEdges: '#8aa8ff', goal: '#e8a33a', slow: '#d58cff', wobble: '#d6d6e0',
  view: '#7f9cff', max: '#ffffff', orbit: '#b79cff', field: '#7ee0ff',
  senses: '#7f9cff', turn: '#ffd166', speed: '#6fd6c4', edges: '#8aa8ff', trail: '#e8a33a', born: '#7f9cff',
} as const;

export interface LegendInput {
  set: AgentRuleSet; sp: number; kind: WalkerKind;
  /** The section drawn now. */
  section: DiagramFocus['section'];
  /** The kind's cards (behaviours.ts). */
  cards: readonly CardRead[];
  /** Trail followers' cards (cards.ts). */
  trail?: TrailCards;
  born?: { shape: string; size: number; count: string };
  trailField?: { halfLife: number; diffuse: number };
  /** The Emit's Life (0: for ever); null: no Emit. */
  life: number | null;
  /** An "only when" in words (onlyWhen.ts). */
  whenText?: (c: RuleCondition) => string;
}

/** Where the Forces diagram puts its one particle (picture units): right of the middle, clear of the legend. */
export const FORCE_PARTICLE = { x: 0.3, y: 0.1 };

/** The forces' sum on one particle, as the Forces diagram draws it (gravity, wind, a point's pull). */
export function forceSum(cards: readonly CardRead[], from = FORCE_PARTICLE): { strength: number; deg: number } {
  let sx = 0, sy = 0;
  for (const c of cards) {
    if (!c.on || c.action.kind !== 'force') continue;
    const a = c.action;
    if (a.field === 'gravity' || a.field === 'wind') {
      const deg = a.angle ?? (a.field === 'gravity' ? -90 : 0);
      sx += Math.cos(deg * Math.PI / 180) * a.strength; sy += Math.sin(deg * Math.PI / 180) * a.strength;
    } else if (a.field === 'point' || a.field === 'mouse') {
      const t = a.field === 'mouse' ? { x: 0, y: 0 } : { x: a.x ?? 0, y: a.y ?? 0 };
      const d = Math.hypot(t.x - from.x, t.y - from.y) || 1;
      sx += (t.x - from.x) / d * a.strength; sy += (t.y - from.y) / d * a.strength;
    }
  }
  return { strength: Math.hypot(sx, sy), deg: Math.atan2(sy, sx) * 180 / Math.PI };
}

const fadeOf = (cards: readonly CardRead[]) => {
  const f = cards.find(c => c.on && c.action.kind === 'fade')?.action as Act<'fade'> | undefined;
  return f ? f.seconds : null;
};
const dieAt = (cards: readonly CardRead[]) => {
  const d = cards.find(c => c.on && c.action.kind === 'die');
  return d?.when?.kind === 'age' && d.when.cmp === '>' ? d.when.seconds : null;
};

/** The legend: what the selected section's diagram draws now, in drawing order. */
export function legendEntries(inp: LegendInput): LegendEntry[] {
  const { set, kind, section, cards } = inp;
  const n = NOUNS[kind];
  const out: LegendEntry[] = [];
  const radius = set.neighbours?.radius ?? DEFAULT_NEIGHBOURS.radius;
  const max = set.neighbours?.max ?? DEFAULT_NEIGHBOURS.max;
  const deg = (id: string) => { const a = cards.find(c => c.on && c.card === id)?.action as Act<'separate'> | undefined; return a?.degrees ?? 0; };
  const flockDemo = (rule: 'separate' | 'match' | 'cohere'): DemoSpec => ({ kind: 'flock', rule, separate: deg('separate'), match: deg('match'), cohere: deg('cohere') });
  const card = (c: CardRead): LegendEntry | null => {
    const a = c.action;
    const base = { id: c.key, on: c.on, card: c.key, el: c.key };
    switch (a.kind) {
      case 'force': {
        if (a.field === 'gravity' || a.field === 'wind') {
          const d = a.angle ?? (a.field === 'gravity' ? -90 : 0);
          return { ...base, title: CARD_WORDS[c.card].title, colour: LEGEND_COLOURS[a.field], numbers: `${num(a.strength, 2)} · ${directionWords(signed(a.strength, d).deg).to}`,
            line: a.field === 'gravity' ? phrase.gravity(n, a.strength, d) : phrase.wind(n, a.strength, d), settings: ['strength', 'angle'],
            demo: { kind: a.field, strength: a.strength, angle: d } };
        }
        if (a.field === 'curl') {
          return { ...base, title: 'Curl flow', colour: LEGEND_COLOURS.curl, numbers: `×${num(a.strength, 2)} · eddies ${num(set.flow.size, 2)}`,
            line: phrase.curl(n, a.strength, set.flow.size, set.flow.evolve), settings: ['strength', 'flowSize', 'flowEvolve'],
            demo: { kind: 'curl', strength: a.strength, eddies: set.flow.size, evolve: set.flow.evolve } };
        }
        const t = a.field === 'mouse' ? 'mouse' : 'point';
        return { ...base, title: a.strength < 0 ? 'Repel' : 'Attract', colour: LEGEND_COLOURS.attract,
          numbers: `${num(a.strength, 2)} · ${t === 'mouse' ? 'the mouse' : where(a.x ?? 0, a.y ?? 0)}`,
          line: phrase.attract(n, a.strength, t, a.x ?? 0, a.y ?? 0), settings: ['strength', 'target', 'x', 'y'],
          demo: { kind: 'attract', strength: a.strength, x: t === 'mouse' ? 0 : a.x ?? 0, y: t === 'mouse' ? 0 : a.y ?? 0 } };
      }
      case 'field': return null;
      case 'drag': return { ...base, title: 'Drag', colour: LEGEND_COLOURS.drag, numbers: `${num(a.amount, 2)} · keeps ${pct(Math.exp(-Math.max(0, a.amount)))}`,
        line: phrase.drag(n, a.amount), settings: ['drag'], demo: { kind: 'drag', amount: Math.max(0, a.amount) } };
      case 'fade': return { ...base, title: 'Fade with age', colour: LEGEND_COLOURS.fade, numbers: `${num(a.seconds, 2)} s`, line: phrase.fade(n, a.seconds), settings: ['fade'],
        demo: { kind: 'life', fade: a.seconds, dies: dieAt(cards) } };
      case 'die': {
        const s = c.when?.kind === 'age' && c.when.cmp === '>' ? c.when.seconds : null;
        return { ...base, title: 'Dies', colour: LEGEND_COLOURS.die, numbers: s !== null ? `at ${num(s, 2)} s` : c.when ? 'only when' : 'at once',
          line: phrase.die(n, c.when ? inp.whenText?.(c.when) ?? null : null, s), settings: ['dieAfter'], demo: { kind: 'life', fade: fadeOf(cards), dies: s } };
      }
      case 'separate': case 'match': case 'cohere':
        return { ...base, title: CARD_WORDS[c.card].title, colour: LEGEND_COLOURS[a.kind], numbers: `≤ ${num(a.degrees, 1)}° a step`,
          line: phrase.turnRule(n, a.kind, a.degrees, a.who), settings: ['degrees', 'who', 'reach'], demo: flockDemo(a.kind) };
      case 'avoidEdges': return { ...base, title: 'Avoid edges', colour: LEGEND_COLOURS.avoidEdges, numbers: `${num(a.margin, 2)} · ≤ ${num(a.degrees, 1)}°`,
        line: phrase.avoidEdges(n, a.margin, a.degrees), settings: ['degrees', 'margin'], demo: { kind: 'avoidEdges', margin: a.margin, degrees: a.degrees } };
      case 'turn': return { ...base, title: 'Head for', colour: LEGEND_COLOURS.goal, numbers: `${a.toward === 'point' ? where(a.x ?? 0, a.y ?? 0) : a.toward} · ≤ ${num(a.degrees, 1)}°`,
        line: phrase.goal(n, a.toward, a.degrees, a.x ?? 0, a.y ?? 0), settings: ['target', 'x', 'y', 'degrees'], demo: { kind: 'goal', degrees: a.degrees } };
      case 'slow': return { ...base, title: 'Slow in a crowd', colour: LEGEND_COLOURS.slow, numbers: `jam ${num(a.jam, 0)}`, line: phrase.slow(n, a.jam), settings: ['jam', 'who', 'reach'],
        demo: { kind: 'slow', jam: a.jam } };
      case 'orbit': return { ...base, title: 'Orbit', colour: LEGEND_COLOURS.orbit, numbers: `${num(a.distance, 2)} · ${a.cw ? '↻' : '↺'} ≤ ${num(a.degrees, 1)}°`,
        line: phrase.orbit(n, a.target, a.distance, a.degrees, !!a.cw, a.x ?? 0, a.y ?? 0), settings: ['target', 'x', 'y', 'distance', 'way', 'degrees'],
        demo: { kind: 'orbit', degrees: a.degrees, cw: !!a.cw } };
      case 'wander': return { ...base, title: 'Wander', colour: LEGEND_COLOURS.wobble, numbers: `±${num(a.degrees, 1)}°`, line: phrase.wander(n, a.degrees), settings: ['wobble'],
        demo: { kind: 'wander', degrees: a.degrees } };
      default: return null;
    }
  };
  const of = (ids: string[]) => ids.flatMap(id => cards.filter(c => c.card === id)).flatMap(c => (c.action.kind === 'field' ? fieldEntries(c, n) : [card(c)])).filter((e): e is LegendEntry => !!e);
  const viewEntries = (): LegendEntry[] => [
    { id: 'view', title: 'View radius', colour: LEGEND_COLOURS.view, numbers: num(radius, 3), line: phrase.view(n, radius), on: true, settings: ['radius'], el: 'view', demo: { kind: 'view', radius, max } },
    { id: 'max', title: 'Max neighbours', colour: LEGEND_COLOURS.max, numbers: num(max, 0), line: phrase.max(n, max), on: true, settings: ['max'], el: 'view', demo: { kind: 'view', radius, max } },
  ];
  const t = inp.trail;
  switch (section) {
    case 'forces': {
      out.push(...of(['curl', 'field', 'gravity', 'wind', 'attract', 'drag']));
      const sum = forceSum(cards);
      if (sum.strength > 1e-3) {
        const forces = cards.filter(c => c.on && c.action.kind === 'force').map(c => { const a = c.action as Act<'force'>; return { field: a.field, strength: a.strength, angle: a.angle, x: a.x, y: a.y }; });
        const drag = cards.find(c => c.on && c.action.kind === 'drag')?.action as Act<'drag'> | undefined;
        out.push({ id: 'sum', title: 'All together', colour: LEGEND_COLOURS.sum, numbers: `${num(sum.strength, 2)} · ${directionWords(sum.deg).to}`, line: phrase.sum(n, sum.strength, sum.deg), on: true, el: '',
          demo: { kind: 'sum', forces, drag: Math.max(0, drag?.amount ?? 0), eddies: set.flow.size } });
      }
      break;
    }
    case 'neighbours':
      out.push(...viewEntries());
      if (kind === 'swarm') out.push(...of(['separate', 'match', 'cohere']));
      break;
    case 'steering':
      out.push(...viewEntries(), ...of(['goal', 'separate', 'match', 'cohere', 'slow', 'avoidEdges', 'wobble']));
      break;
    case 'orbit': out.push(...of(['orbit'])); break;
    case 'life':
      if (inp.life !== null) out.push({ id: 'lives', title: 'Lives for', colour: LEGEND_COLOURS.lives, numbers: inp.life > 0 ? `${num(inp.life, 2)} s` : 'for ever', line: phrase.lives(n, inp.life), on: true, settings: ['life'], el: 'lives',
        demo: { kind: 'life', fade: fadeOf(cards), dies: dieAt(cards) ?? (inp.life > 0 ? inp.life : null) } });
      out.push(...of(['fade', 'die']));
      break;
    case 'moving': {
      const speed = t?.moving.speed ?? set.species[Math.min(inp.sp, set.species.length - 1)]?.speed ?? 0;
      const edges = t?.moving.edges ?? set.edges;
      const toFeelers = t ? set.sensor.distance / Math.max(speed / 60, 1e-9) : undefined;
      out.push(
        { id: 'speed', title: 'Speed', colour: LEGEND_COLOURS.speed, numbers: `${num(speed, 3)} a second`, line: phrase.speed(n, speed, speed > 0 ? toFeelers : undefined), on: true, settings: ['speed'], el: 'moving', demo: { kind: 'speed', speed } },
        { id: 'edges', title: 'At the edges', colour: LEGEND_COLOURS.edges, numbers: edges, line: phrase.edges(n, edges), on: true, settings: ['edges'], el: 'moving', demo: { kind: 'edges', edges } },
      );
      break;
    }
    case 'senses':
      if (t) out.push({ id: 'senses', title: 'Sensors', colour: LEGEND_COLOURS.senses, numbers: `${num(t.senses.distance, 3)} · ±${num(t.senses.angle, 1)}°`, line: phrase.senses(n, t.senses.on, t.senses.distance, t.senses.angle),
        on: t.senses.on, card: 'senses', settings: ['distance', 'angle', 'smells'], el: 'senses', demo: { kind: 'senses', angle: t.senses.angle, turn: t.turning.sharp, away: t.senses.away } });
      break;
    case 'turning':
      if (t) out.push(
        { id: 'turn', title: 'Turn', colour: LEGEND_COLOURS.turn, numbers: `${num(t.turning.sharp, 1)}°`, line: phrase.turn(n, t.turning.sharpOn, t.turning.sharp, t.senses.away), on: t.turning.sharpOn, settings: ['sharp'], el: 'turning',
          demo: { kind: 'senses', angle: t.senses.angle, turn: t.turning.sharp, away: t.senses.away } },
        { id: 'wobble', title: 'Wobble', colour: LEGEND_COLOURS.wobble, numbers: `±${num(t.turning.wobble, 1)}°`, line: phrase.wander(n, t.turning.wobbleOn ? t.turning.wobble : 0), on: t.turning.wobbleOn, card: 'wobble', settings: ['wobble'], el: 'turning',
          demo: { kind: 'wander', degrees: t.turning.wobbleOn ? t.turning.wobble : 0 } },
      );
      break;
    case 'trail':
      if (t) {
        const f = inp.trailField ?? { halfLife: 0.12, diffuse: 1 };
        out.push({ id: 'trail', title: 'Trail', colour: LEGEND_COLOURS.trail, numbers: `${num(t.trail.amount, 2)} · ½ in ${num(f.halfLife, 3)} s · ${pct(f.diffuse)}`,
          line: phrase.trail(n, t.trail.on, t.trail.amount, f.halfLife, f.diffuse), on: t.trail.on, card: 'trail', settings: ['amount', 'fades', 'spreads', 'lays'], el: 'trail',
          demo: { kind: 'trail', amount: t.trail.amount, halfLife: f.halfLife, diffuse: f.diffuse } });
      }
      break;
    case 'born':
      if (inp.born) out.push({ id: 'born', title: 'Born', colour: LEGEND_COLOURS.born, numbers: `${inp.born.shape} · ${inp.born.count.toUpperCase().replace('K', 'k')}`,
        line: phrase.born(n, inp.born.shape, inp.born.size, inp.born.count), on: true, settings: ['where', 'size', 'count', 'facing', 'births', 'launch'], el: 'born',
        demo: { kind: 'born', shape: inp.born.shape } });
      break;
    default: break;
  }
  return out;
}

/** A Follow a field card's entries: one per layer, its colour, numbers and line, its demo the field with only that layer. */
export function fieldEntries(c: CardRead, n: Noun): LegendEntry[] {
  const a = c.action as Act<'field'>;
  const spec = normalizeFieldSpec(a.spec);
  const how = phrase.fieldHow(n, a.strength, a.grip);
  return spec.layers.map((l, k) => ({
    id: `${c.key}:L${k}`, card: c.key, el: c.key, on: c.on && !l.off,
    title: FIELD_KINDS[l.kind].label, colour: FIELD_COLOURS[k % FIELD_COLOURS.length],
    numbers: `× ${num(l.weight, 2)}${l.mask ? ` · ${l.mask.outside ? 'outside' : 'inside'} ${l.mask.shape}` : ''}${l.animate?.speed ? ` · ${l.animate.mode}` : ''}`,
    line: `${phrase.fieldLayer(n, l)}${k === 0 ? ` ${how}` : ''}`,
    settings: [`layer${k}`],
    demo: { kind: 'field', spec, strength: a.strength, ...(a.grip ? { grip: a.grip } : {}), layer: k },
  }));
}
/** Each field layer's colour (its legend dot, tag and lit arrows). */
export const FIELD_COLOURS = ['#7ee0ff', '#b79cff', '#ffd166', '#7ad38a', '#ff9a6b', '#ff8fc8'];

/**
 * The legend entry for what the pointer is on in the inspector (a card, a setting): the reverse of
 * hovering an entry. A setting picks the entry that holds it in the pointed card (or an entry that
 * isn't a card, as View radius); else the card's first entry.
 */
export function entryForFocus(entries: readonly LegendEntry[], focus: Pick<DiagramFocus, 'card' | 'setting'>): string | null {
  const byCard = focus.card ? entries.filter(e => e.card === focus.card) : [];
  if (focus.setting) {
    const s = focus.setting;
    const hit = byCard.find(e => e.settings?.includes(s)) ?? entries.find(e => !e.card?.includes('#') && e.settings?.includes(s));
    if (hit) return hit.id;
  }
  return byCard[0]?.id ?? null;
}

/** What hovering (or focusing) an entry points the diagram at: its card, or its first setting. */
export const focusOfEntry = (e: LegendEntry): Pick<DiagramFocus, 'card' | 'setting'> => ({ card: e.card, setting: e.card ? undefined : e.settings?.[0] });

// ── Tags on the picture ──────────────────────────────────────────────────────

/** A tag asked for at a point of a drawing: its entry, its short text, where it would like to be. */
export interface TagRequest { entry: string; text: string; x: number; y: number; key?: string }
export interface Box { left: number; top: number; w: number; h: number }
export interface PlacedTag extends TagRequest, Box { moved: boolean }

export const TAG_H = 18;
/** A tag's width: the dot, the text (about 6.1 px a character at 10.5 px) and the padding. */
export const tagWidth = (text: string) => Math.round(22 + text.length * 6.1);

const overlap = (a: Box, b: Box, gap = 3) =>
  Math.max(0, Math.min(a.left + a.w + gap, b.left + b.w + gap) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.top + a.h + gap, b.top + b.h + gap) - Math.max(a.top, b.top));

/**
 * Place the tags so they don't overlap: each in order, centred on its point if that is free, else
 * the nearest free spot of a few tried round it (above, below, beside, further out), kept inside
 * `bounds` and off the `avoid` boxes (the legend). If nothing is free it takes the spot that
 * overlaps least.
 */
export function layoutTags(tags: readonly TagRequest[], bounds: { x: number; y: number; w: number; h: number }, avoid: readonly Box[] = []): PlacedTag[] {
  const placed: PlacedTag[] = [];
  for (const t of tags) {
    const w = tagWidth(t.text), h = TAG_H;
    const dy = h + 4, dx = w / 2 + 6;
    const tries: Array<[number, number]> = [[0, 0], [0, -dy], [0, dy], [dx, 0], [-dx, 0], [dx, -dy], [-dx, -dy], [dx, dy], [-dx, dy],
      [0, -2 * dy], [0, 2 * dy], [2 * dx, 0], [-2 * dx, 0], [0, -3 * dy], [0, 3 * dy], [2 * dx, -2 * dy], [-2 * dx, 2 * dy],
      // Further out, for a tag asked for under the legend.
      ...[4, 6, 8, 10, 12].flatMap((k): Array<[number, number]> => [[0, k * dy], [0, -k * dy]]), ...[3, 4, 6, 8, 10].map((k): [number, number] => [k * dx, 0])];
    let best: PlacedTag | null = null, bestCost = Infinity;
    for (const [ox, oy] of tries) {
      const left = Math.max(bounds.x + 2, Math.min(t.x + ox - w / 2, bounds.x + bounds.w - w - 2));
      const top = Math.max(bounds.y + 2, Math.min(t.y + oy - h / 2, bounds.y + bounds.h - h - 2));
      const r = { left, top, w, h };
      const cost = placed.reduce((s, p) => s + overlap(r, p), 0) + avoid.reduce((s, p) => s + overlap(r, p), 0);
      if (cost < bestCost) { bestCost = cost; best = { ...t, ...r, moved: ox !== 0 || oy !== 0 }; }
      if (cost === 0) break;
    }
    placed.push(best!);
  }
  return placed;
}

/** A tag collector for one render: `tag(p, entry, text)` adds a request (and draws nothing); the list goes to DiagramTags. */
export function tagCollector() {
  const list: TagRequest[] = [];
  return { list, tag: (p: { x: number; y: number }, entry: string, text: string, key?: string): null => { list.push({ entry, text, x: p.x, y: p.y, key }); return null; } };
}

/** The opacity of an entry's drawing: full, or dimmed while another entry is lit (a legend or tag hover, or focus). */
export const dimFor = (link: { dim: boolean; lit: string | null } | undefined, id: string | undefined) => (link?.dim && link.lit && id && link.lit !== id ? 0.16 : 1);

/** Do any two placed tags overlap? */
export const tagsOverlap = (tags: readonly Box[]) => tags.some((a, i) => tags.some((b, j) => j > i && overlap(a, b, 0) > 0));

// ── Focus: a little more, in plain words (the field guide's Part 2, retold) ───

const MORE: Record<string, string> = {
  gravity: 'Gravity is the same pull everywhere, in one direction. Every step it adds a little to the velocity (strength × 1/60 s), so a thrown particle curves into an arc: the longer it flies, the faster it goes that way. Point it up for smoke and sparks.',
  wind: 'Wind pushes one way like gravity, but its strength rises and falls in gusts over time and across the picture, so particles drift and bunch in waves instead of falling evenly.',
  curl: 'Curl flow is the curl of a noise field: currents that only swirl, never squeeze particles together or pull them apart (Bridson, 2007), like a real liquid. Eddies sets their size (bigger: smaller, busier swirls) and Changes how fast they drift.',
  attract: 'A point that pulls with the same strength however far away it is, so particles fall toward it, overshoot and swing back. A negative strength pushes them away and empties the space round it.',
  drag: 'Drag takes a share of the speed away every second (speed × e^(−drag × 1/60) each step, the same at any frame rate). With forces it sets a top speed: a particle speeds up until drag takes away as much as the forces add.',
  sum: 'Each step the forces are added up (they run in the cards\' order), the total changes the velocity, drag takes its share, and the particle moves with the new velocity: semi-implicit Euler, which keeps orbits from gaining energy.',
  fade: 'Fade with age dims each particle from its full colour at birth to black at this age, so a stream of particles shows its own age: bright at the source, dark at the tail.',
  die: 'Dies takes the particle away when its "only when" holds (usually an age). With Births on Kept full the slot is born again at once, so the stream never thins out.',
  lives: 'Emit gives each walker a life in seconds (0: for ever). At that age it is taken away, and Kept full or a stream brings a new one.',
  separate: 'Separation, the first of Reynolds\' three rules (1987): turn away from the neighbours that are too close, the closer the harder. Strong separation gives a loose gas of birds.',
  match: 'Alignment: turn toward the average way the neighbours are heading. Strong alignment gives glassy streams that all flow the same way.',
  cohere: 'Cohesion: turn toward the middle of the neighbours you see. Strong cohesion gives tight balls; with separation it keeps a comfortable spacing.',
  avoidEdges: 'Near the picture\'s edge, turn back toward the middle a little each step, so the flock stays in view instead of wrapping round.',
  goal: 'Head for turns each walker a little toward a goal every step. With Keep apart and Slow in a crowd, people form lanes and queues on their way.',
  slow: 'Each walker counts the ones round it and slows as the count nears the jam, nearly stopping at it: crowds bunch up at doors and crossings.',
  orbit: 'Each step it turns toward the way round the circle, and in when it is further out than the radius, out when nearer. A small turn makes loose, drifting orbits; a big one holds the circle tight.',
  wander: 'A random turn each step, up to this many degrees either way. A little keeps things alive and exploring; a lot makes them lost.',
  view: 'Each walker only sees the ones within its view radius, never the whole group: that is what makes flocks (Reynolds). A bigger radius gives bigger, slower groups.',
  max: 'Neighbours are found through a grid each step, so a reading counts at most this many; a crowd past it counts the same as a full one. More costs more.',
  senses: 'Each step a walker smells the trail at three points: straight ahead, and the same distance ahead turned left and right by the angle (the field guide\'s figure 2.4). Far feelers make bigger cells, near ones fine lace.',
  turn: 'If the left feeler smells most it turns left by the full amount, right if the right one does, straight on if the middle wins, and a random way if both sides beat the middle. A small turn gives long smooth veins; a big one a tight mesh.',
  speed: 'How far it moves each second; one step is a sixtieth of it. For trail followers the steps to reach the feelers matter: about 9 to 1 gives the classic slime network.',
  edges: 'What happens at the picture\'s edge: wrap (out one side, in the other: no edge at all), bounce (turn back) or slide (run along it).',
  trail: 'Each step every walker adds to the trail where it stands; the trail keeps a share of itself (set by the half-life) and blurs a little into its neighbours. The walkers smell what they and the others left: many small rules, one big pattern.',
  field: 'A field gives every point of the picture a velocity. Layers add up, each with its weight; a mask keeps one to a shape, and Animate lets it drift or spin. Ride (grip) makes particles take on the field\'s velocity, so they trace its streamlines; Push makes it a force, so they overshoot and swing like real matter. The arrows on the picture are the very field the GPU runs.',
  born: 'Every group has a fixed number of walkers. They are born inside the shape, facing the way you pick, all at once or as a stream.',
};

/** The behaviour an entry is about (`gravity#1` → gravity, the wobble card → wander). */
export const behaviourOf = (e: Pick<LegendEntry, 'id' | 'demo'>): string => {
  const k = e.id.split('#')[0];
  if (k === 'wobble') return 'wander';
  if (k === 'attract') return 'attract';
  if (e.demo.kind === 'field') return 'field';
  return k;
};

/** The focus view's "more": a short explanation of what the behaviour is and how it shapes the result. */
export const moreAbout = (e: Pick<LegendEntry, 'id' | 'demo'>): string => MORE[behaviourOf(e)] ?? '';
