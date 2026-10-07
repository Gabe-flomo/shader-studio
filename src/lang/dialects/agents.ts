/**
 * agents.ts — the Agent Rules dialect of the Playfield language (docs/playfield-language-plan.md
 * §4.4): text ⇄ an AgentRuleSet (agentRules/spec.ts).
 *
 *   agents kind=ants edges=bounce
 *   sensors ahead=0.04 angle=35deg
 *   channels home, food
 *   masks Food, Nest
 *   species Ants speed=0.3 states=searching,carrying
 *     state carrying color=gold
 *     always do memory += 1/s, wander 5deg
 *     when searching and mask Food > 0.5 do become carrying, turn around, memory = 0 @last
 *     when searching and food anywhere > 0.05 do turn toward food 20deg
 *
 * On one line a species takes its rules after a colon (§13 decision 7):
 *   species Slime speed=0.22: always do turn toward trail 45deg, wander 7deg, leave trail 1
 *
 * Names: a bare word in a condition is a state; a channel is always followed by where it is read
 * (ahead, left, right, anywhere, here); a mask follows `mask`; a species follows `near`. `trail`
 * is the walker's own species' channel. A name with a space, or one that is a keyword, is quoted.
 *
 * The rule set is the stored form (`params.agentRules`); text is a view of it.
 */
import { Cursor } from '../parse';
import type { Diagnostic, Value } from '../ast';
import type { Tok } from '../lex';
import { COLOUR_NAMES, colourOf, colourText, type RGB } from '../colours';
import { fmtNum } from '../print';
import { suggest } from '../fuzzy';
import { drawFrom, freshSeed, makeRng, rangeFor, resolveRandom, seedOf, type RandSpec, type Resolved, type Rng } from '../random';
import { registerEntries, type Entry } from '../registry';
import {
  ACTION_KINDS, CONDITION_KINDS, DEFAULT_STATE_COLOURS, MAX_MASKS, MAX_SPECIES, MAX_STATES, WALKER_KIND_KEYS, defaultRuleSet, normalizeRuleSet,
  type AgentRule, type AgentRuleSet, type AgentSpeciesRules, type ChannelRef, type Cmp, type NeighbourWho, type RuleAction, type RuleCondition, type SenseWhere, type WalkerKind,
} from '../../agentRules/spec';

const WHERE_WORDS: Record<string, SenseWhere> = { ahead: 'ahead', left: 'left', right: 'right', anywhere: 'any', any: 'any', here: 'here' };
const WHERE_TEXT: Record<SenseWhere, string> = { ahead: 'ahead', left: 'left', right: 'right', any: 'anywhere', here: 'here' };
const KEYWORDS = new Set(['when', 'always', 'do', 'and', 'not', 'near', 'chance', 'age', 'memory', 'mask', 'neighbours', 'trail', 'species', 'state', 'agents', 'sensors', 'channels', 'masks', 'flow', 'random', 'seed',
  ...Object.keys(WHERE_WORDS)]);

/** Interesting ranges for rule numbers (degrees a step, amounts…), by what they are. */
const AG_RAND: Record<string, RandSpec> = {
  turn: { kind: 'num', lo: 10, hi: 50, int: true }, wander: { kind: 'num', lo: 3, hi: 30, int: true }, align: { kind: 'num', lo: 4, hi: 15, int: true },
  separate: { kind: 'num', lo: 6, hi: 16, int: true }, match: { kind: 'num', lo: 3, hi: 12, int: true }, cohere: { kind: 'num', lo: 1, hi: 5 },
  flow: { kind: 'num', lo: 8, hi: 30, int: true }, orbit: { kind: 'num', lo: 3, hi: 10, int: true }, edges: { kind: 'num', lo: 6, hi: 16, int: true },
  ahead: { kind: 'num', lo: 0.015, hi: 0.06, log: true }, angle: { kind: 'num', lo: 15, hi: 60, int: true },
  'flow-size': { kind: 'num', lo: 0.6, hi: 2 }, evolve: { kind: 'num', lo: 0.05, hi: 0.4 },
  speed: rangeFor('speed') ?? { kind: 'num', lo: 0.1, hi: 1.2, log: true }, amount: { kind: 'num', lo: 0.5, hi: 2 }, fade: { kind: 'num', lo: 0.05, hi: 0.3 },
  drag: { kind: 'num', lo: 0.1, hi: 0.8 }, force: { kind: 'num', lo: 0.2, hi: 1.2 }, seconds: { kind: 'num', lo: 1, hi: 5 }, value: { kind: 'num', lo: 0.05, hi: 0.8 },
  chance: { kind: 'num', lo: 0.05, hi: 0.8 }, count: { kind: 'num', lo: 4, hi: 30, int: true }, distance: { kind: 'num', lo: 0.3, hi: 0.7 }, margin: { kind: 'num', lo: 0.05, hi: 0.15 },
  jam: { kind: 'num', lo: 10, hi: 40, int: true }, radius: { kind: 'num', lo: 0.02, hi: 0.08 },
};

// ── Printing ──────────────────────────────────────────────────────────────

const nameText = (s: string) => (/^[A-Za-z_][A-Za-z0-9_-]*$/.test(s) && !KEYWORDS.has(s.toLowerCase()) ? s : `"${s.replace(/"/g, '\'')}"`);
const deg = (n: number) => `${fmtNum(n)}deg`;
const sameRgb = (a: readonly number[], b: readonly number[]) => a.length === b.length && a.every((x, i) => Math.round(x * 10000) === Math.round(b[i] * 10000));

function channelText(set: AgentRuleSet, c: ChannelRef | undefined): string {
  if (c === undefined || c === 'own') return 'trail';
  const name = set.channels[c]?.trim();
  return name ? nameText(name) : `trail${c + 1}`;
}

const stateText = (sp: AgentSpeciesRules, s: number) => nameText(sp.states[s]?.name || `state${s + 1}`);
const whoArgs = (who: NeighbourWho, radius?: number) => [...(who !== 'all' ? [`who=${who}`] : []), ...(radius ? [`radius=${fmtNum(radius)}`] : [])];
const point = (x?: number, y?: number) => `(${fmtNum(x ?? 0)},${fmtNum(y ?? 0)})`;

export function printCondition(set: AgentRuleSet, sp: AgentSpeciesRules, c: RuleCondition): string {
  switch (c.kind) {
    case 'always': return 'always';
    case 'sense': return `${channelText(set, c.channel)} ${WHERE_TEXT[c.where]} ${c.cmp} ${fmtNum(c.value)}`;
    case 'near': return `near ${nameText(set.species[c.species]?.name || `species${c.species + 1}`)} > ${fmtNum(c.value)}`;
    case 'chance': return `chance ${fmtNum(c.perSecond * 100)}%`;
    case 'age': return `age ${c.cmp} ${fmtNum(c.seconds)}s`;
    case 'state': return `${c.not ? 'not ' : ''}${stateText(sp, c.state)}`;
    case 'memory': return `memory ${c.cmp} ${fmtNum(c.value)}`;
    case 'mask': return `mask ${nameText(set.masks[c.mask]?.name || `mask${c.mask + 1}`)} ${c.cmp} ${fmtNum(c.value)}`;
    case 'neighbours': return ['neighbours', c.cmp, fmtNum(c.count), ...whoArgs(c.who, c.radius)].join(' ');
  }
}

export function printAction(set: AgentRuleSet, sp: AgentSpeciesRules, a: RuleAction): string {
  switch (a.kind) {
    case 'turn': {
      const what = a.toward === 'trail' ? channelText(set, a.channel) : a.toward === 'point' ? point(a.x, a.y) : a.toward;
      return `turn ${a.away ? 'away' : 'toward'} ${what} ${deg(a.degrees)}`;
    }
    case 'wander': return `wander ${deg(a.degrees)}`;
    case 'speed': return a.mode === 'set' ? `speed ${fmtNum(a.value)}` : `accelerate ${fmtNum(a.value)}/s`;
    case 'trail': return `leave ${channelText(set, a.channel)} ${fmtNum(a.amount)}${a.fade ? ` fade=${fmtNum(a.fade)}` : ''}`;
    case 'state': return `become ${stateText(sp, a.state)}`;
    case 'memory': return a.mode === 'set' ? `memory = ${fmtNum(a.value)}` : a.mode === 'add' ? `memory += ${fmtNum(a.value)}` : a.mode === 'perSecond' ? `memory += ${fmtNum(a.value)}/s` : `memory = random ${fmtNum(a.value)}`;
    case 'stop': case 'stick': case 'die': return a.kind;
    case 'spawn': return `spawn ${fmtNum(a.amount)}`;
    case 'bounce': return 'turn around';
    case 'flow': return `${a.away ? 'against' : 'follow'} flow ${deg(a.degrees)}`;
    case 'align': return `align ${deg(a.degrees)}`;
    case 'separate': case 'match': case 'cohere': return [a.kind, deg(a.degrees), ...whoArgs(a.who, a.radius)].join(' ');
    case 'slow': return ['slow', `jam=${fmtNum(a.jam)}`, ...whoArgs(a.who, a.radius)].join(' ');
    case 'avoidEdges': return `avoid-edges ${deg(a.degrees)} margin=${fmtNum(a.margin)}`;
    case 'orbit': return [`orbit ${a.target === 'point' ? point(a.x, a.y) : a.target}`, deg(a.degrees), `distance=${fmtNum(a.distance)}`, ...(a.cw ? ['cw'] : [])].join(' ');
    case 'force': {
      if (a.field === 'point' || a.field === 'mouse') return `force ${a.strength < 0 ? 'away' : 'toward'} ${a.field === 'mouse' ? 'mouse' : point(a.x, a.y)} ${fmtNum(Math.abs(a.strength))}`;
      const angle = a.angle !== undefined && (a.field === 'gravity' || a.field === 'wind') ? ` angle=${deg(a.angle)}` : '';
      return `force ${a.field} ${fmtNum(a.strength)}${angle}`;
    }
    case 'drag': return `drag ${fmtNum(a.amount)}`;
    case 'fade': return `fade ${fmtNum(a.seconds)}s`;
  }
}

export function printRule(set: AgentRuleSet, sp: AgentSpeciesRules, r: AgentRule): string {
  const conds = r.when.filter(c => c.kind !== 'always');
  const head = conds.length ? `when ${conds.map(c => printCondition(set, sp, c)).join(' and ')}` : 'always';
  const acts = r.do.length ? r.do.map(a => printAction(set, sp, a)).join(', ') : 'nothing';
  return `${head} do ${acts}${r.stop ? ' @last' : ''}${r.off ? ' @off' : ''}`;
}

const DEF = defaultRuleSet();

/**
 * A rule set as text. Compact: one line, `·` between clauses, each species' rules after a colon.
 * Pretty: one clause a line, a species' rules indented under it.
 */
export function printAgents(raw: AgentRuleSet, opts: { pretty?: boolean } = {}): string {
  const set = normalizeRuleSet(raw);
  const top: string[] = [];
  const head = ['agents'];
  if (set.kind) head.push(`kind=${set.kind}`);
  if (set.edges !== 'wrap') head.push(`edges=${set.edges}`);
  if (set.neighbours) head.push(`view=${fmtNum(set.neighbours.radius)}`, `view-max=${fmtNum(set.neighbours.max)}`);
  top.push(head.join(' '));
  if (set.sensor.distance !== DEF.sensor.distance || set.sensor.angle !== DEF.sensor.angle) top.push(`sensors ahead=${fmtNum(set.sensor.distance)} angle=${deg(set.sensor.angle)}`);
  if (set.flow.size !== DEF.flow.size || set.flow.evolve !== DEF.flow.evolve) top.push(`flow size=${fmtNum(set.flow.size)} evolve=${fmtNum(set.flow.evolve)}`);
  const ch = [...set.channels];
  while (ch.length && !ch[ch.length - 1].trim()) ch.pop();
  if (ch.length) top.push(`channels ${ch.map(c => (c.trim() ? nameText(c.trim()) : '_')).join(', ')}`);
  if (set.masks.length) top.push(`masks ${set.masks.map(m => `${nameText(m.name || 'mask')}${m.kind === 'texture' ? ':texture' : ''}`).join(', ')}`);
  const blocks: string[] = [];
  for (const sp of set.species) {
    const h = [`species ${nameText(sp.name)}`];
    if (sp.speed !== 0.25) h.push(`speed=${fmtNum(sp.speed)}`);
    const names = sp.states.map(s => s.name);
    if (!(names.length === 1 && names[0] === 'walking')) h.push(`states=${names.map(nameText).join(',')}`);
    const body: string[] = [];
    sp.states.forEach((s, j) => { if (!sameRgb(s.colour, DEFAULT_STATE_COLOURS[j] ?? [1, 1, 1])) body.push(`state ${nameText(s.name || `state${j + 1}`)} color=${colourText(s.colour)}`); });
    for (const r of sp.rules) body.push(printRule(set, sp, r));
    if (opts.pretty) blocks.push([h.join(' '), ...body.map(b => `  ${b}`)].join('\n'));
    else blocks.push(body.length ? `${h.join(' ')}: ${body.join(' · ')}` : h.join(' '));
  }
  return opts.pretty ? [...top, ...blocks].join('\n') : [...top, ...blocks].join(' · ');
}

// ── Reading ───────────────────────────────────────────────────────────────

export interface AgentsParse {
  set: AgentRuleSet;
  errors: Diagnostic[];
  hints: Diagnostic[];
  resolved: Resolved[];
  seed?: number;
}

type SpeciesDraft = { sp: AgentSpeciesRules; colours: Record<number, boolean>; ruleAt: number[]; header: Tok };

/** Read agents text into a rule set. `seed`: for `random` values. */
export function parseAgents(src: string, opts: { seed?: number } = {}): AgentsParse {
  const c = new Cursor(src);
  const set: AgentRuleSet = { ...defaultRuleSet(), species: [] };
  const resolved: Resolved[] = [];
  let seed: number | null = (() => { const m = /(?:^|[\s·;|])seed\s*=?\s*([A-Za-z0-9_-]+)/i.exec(src); return m ? seedOf(m[1]) : null; })();
  let rngCache: Rng | null = null;
  const rng = () => { if (!rngCache) { if (seed === null) seed = opts.seed ?? freshSeed(); rngCache = makeRng(seed); } return rngCache; };
  let randomAll = false;
  const given = new Set<string>();
  const drafts: SpeciesDraft[] = [];
  const loose: number[] = [];

  /** A number, a number with a unit, or `random…` for what `what` is. */
  const numVal = (what: string, unitOk?: (u: string | null) => boolean): number | null => {
    const t = c.peek();
    if (t.t === 'num') { c.next(); if (unitOk && !unitOk(t.unit)) c.error(t, `${what}: “${t.text}” has the wrong unit.`); return t.unit === '%' ? t.v / 100 : t.v; }
    if (t.t === 'word' && t.v.toLowerCase() === 'random') {
      const v = c.value() as Extract<Value, { k: 'random' }>;
      const r = resolveRandom(v, AG_RAND[what], rng());
      if (!r || r.k !== 'num') { c.error(t, `There is nothing to draw ${what} from: give it a range, random(10..40).`); return null; }
      resolved.push({ key: what, from: c.text({ at: t.at, end: c.toks[c.i - 1].end }), to: fmtNum(r.v), at: t.at, end: c.toks[c.i - 1].end });
      return r.v;
    }
    c.error(t, `${what} needs a number here.`);
    return null;
  };
  const nameOf = (t: Tok) => (t.t === 'str' || t.t === 'word' ? t.v : '');
  const settingArgs = (clause: string, apply: (key: string, a: { v: Value; at: Tok }) => void) => {
    while (!c.atClauseEnd() && c.peek().t !== ':') {
      const k = c.peek();
      if (k.t !== 'word' || c.peek(1).t !== '=') { c.error(k, `${clause} takes key=value settings.`); c.next(); continue; }
      c.next(); c.next();
      const at = c.peek();
      let v: Value | null;
      if (at.t === 'word' && at.v.toLowerCase() === 'random') {
        const rv = c.value() as Extract<Value, { k: 'random' }>;
        const key = `${clause}.${k.v.toLowerCase()}`;
        v = resolveRandom(rv, AG_RAND[k.v.toLowerCase() === 'size' ? 'flow-size' : k.v.toLowerCase()] ?? (k.v.toLowerCase() === 'color' ? { kind: 'colour' } : undefined), rng());
        if (v) resolved.push({ key, from: 'random', to: v.k === 'num' ? fmtNum(v.v) : v.k === 'colour' ? v.text : String((v as { v: unknown }).v), at: at.at, end: c.toks[c.i - 1].end });
        else { c.error(at, `There is nothing to draw ${k.v} from.`); continue; }
      } else v = c.keyValue([':']);
      if (!v) { c.error(k, `${k.v}= needs a value.`); continue; }
      given.add(`${clause}.${k.v.toLowerCase()}`);
      apply(k.v.toLowerCase(), { v, at: k });
    }
  };
  const num = (v: Value, at: Tok, what: string): number | null => (v.k === 'num' ? v.v : (c.error(at, `${what} is a number.`), null));

  // Pass 1: settings, species headers; rules remembered by where they start.
  let cur: SpeciesDraft | null = null;
  let colonLine = false;
  let sawNewline = true;
  let lineIndent = 0;
  let headerIndent = 0;
  while (c.peek().t !== 'eof') {
    const t = c.peek();
    if (t.t === 'sep') { c.next(); if (t.nl) { sawNewline = true; lineIndent = t.indent; colonLine = false; } continue; }
    const startNewLine = sawNewline;
    sawNewline = false;
    if (t.t !== 'word' && t.t !== 'str') { c.error(t, 'A line starts with a word: agents, sensors, channels, masks, species, state, when, always.'); c.skipClause(); continue; }
    const w = t.t === 'word' ? t.v.toLowerCase() : '';
    const inBlock = !!cur && ((startNewLine && lineIndent > headerIndent) || (!startNewLine && colonLine));
    if (w === 'random' && c.peek(1).t !== '(') { c.next(); randomAll = true; continue; }
    if (w === 'seed') { c.next(); if (c.peek().t === '=') c.next(); c.next(); continue; }
    if (w === 'when' || w === 'always' || (w === 'state' && inBlock)) {
      if (!cur && !inBlock && !drafts.length) {
        // Rules with no species line: the one species a rule set starts with.
        cur = { sp: { ...defaultRuleSet().species[0], rules: [] }, colours: {}, ruleAt: [], header: t };
        drafts.push(cur);
      } else if (!inBlock) {
        c.error(t, `Put a species' rules under it: indent them, or on one line write species ${nameText(cur?.sp.name ?? 'Ants')}: ${w} … (§ one-liners use a colon).`);
        c.skipClause();
        continue;
      }
      if (w === 'state') {
        c.next();
        const nt = c.next();
        const name = nameOf(nt);
        const j = cur!.sp.states.findIndex(s => s.name.toLowerCase() === name.toLowerCase());
        if (j < 0) { c.error(nt, `“${name}” isn't a state of ${cur!.sp.name}: ${cur!.sp.states.map(s => s.name).join(', ')}.`); c.skipClause(); continue; }
        settingArgs('state', (key, a) => {
          if (key !== 'color' && key !== 'colour') { c.error(a.at, 'state takes color=.'); return; }
          const rgb = a.v.k === 'colour' ? a.v.v : a.v.k === 'vec' && a.v.v.length >= 3 ? [a.v.v[0], a.v.v[1], a.v.v[2]] as RGB : a.v.k === 'word' ? colourOf(a.v.v) : null;
          if (!rgb) { const s = a.v.k === 'word' ? suggest(a.v.v, COLOUR_NAMES) : null; c.error(a.at, `A colour: a name, #rrggbb or (r,g,b).${s ? ` Did you mean “${s}”?` : ''}`); return; }
          cur!.sp.states[j] = { ...cur!.sp.states[j], colour: rgb };
          cur!.colours[j] = true;
        });
        continue;
      }
      cur!.ruleAt.push(c.i);
      c.skipClause();
      continue;
    }
    cur = null;
    if (w === 'agents') {
      c.next();
      settingArgs('agents', (key, a) => {
        if (key === 'kind') { const k = a.v.k === 'word' ? a.v.v.toLowerCase() : ''; if ((WALKER_KIND_KEYS as string[]).includes(k)) set.kind = k as WalkerKind; else c.error(a.at, `kind is one of ${WALKER_KIND_KEYS.join(', ')}.`); }
        else if (key === 'edges') { const k = a.v.k === 'word' ? a.v.v.toLowerCase() : ''; if (k === 'wrap' || k === 'bounce' || k === 'slide') set.edges = k; else c.error(a.at, 'edges is wrap, bounce or slide.'); }
        else if (key === 'view') { const n = num(a.v, a.at, 'view'); if (n !== null) set.neighbours = { radius: n, max: set.neighbours?.max ?? 36 }; }
        else if (key === 'view-max') { const n = num(a.v, a.at, 'view-max'); if (n !== null) set.neighbours = { radius: set.neighbours?.radius ?? 0.05, max: Math.round(n) }; }
        else { const s = suggest(key, ['kind', 'edges', 'view', 'view-max']); c.error(a.at, `agents takes kind=, edges=, view= and view-max=.${s ? ` Did you mean “${s}”?` : ''}`); }
      });
      continue;
    }
    if (w === 'sensors') {
      c.next();
      settingArgs('sensors', (key, a) => {
        const n = num(a.v, a.at, key);
        if (n === null) return;
        if (key === 'ahead' || key === 'distance') set.sensor = { ...set.sensor, distance: n };
        else if (key === 'angle') set.sensor = { ...set.sensor, angle: a.v.k === 'num' && a.v.unit === 'rad' ? n * 180 / Math.PI : n };
        else c.error(a.at, 'sensors takes ahead= and angle=.');
      });
      continue;
    }
    if (w === 'flow') {
      c.next();
      settingArgs('flow', (key, a) => {
        const n = num(a.v, a.at, key);
        if (n === null) return;
        if (key === 'size') set.flow = { ...set.flow, size: n };
        else if (key === 'evolve') set.flow = { ...set.flow, evolve: n };
        else c.error(a.at, 'flow takes size= and evolve=.');
      });
      continue;
    }
    if (w === 'channels') {
      c.next();
      const names: string[] = [];
      while (!c.atClauseEnd()) {
        const x = c.next();
        if (x.t === ',') continue;
        if (x.t === 'word' || x.t === 'str') names.push(x.t === 'word' && x.v === '_' ? '' : x.v);
        else c.error(x, 'channels is up to four names: channels home, food.');
      }
      if (names.length > 4) c.error(t, 'There are four channels.');
      set.channels = [0, 1, 2, 3].map(i => names[i] ?? '');
      continue;
    }
    if (w === 'masks') {
      c.next();
      const masks: AgentRuleSet['masks'] = [];
      while (!c.atClauseEnd()) {
        const x = c.next();
        if (x.t === ',') continue;
        if (x.t !== 'word' && x.t !== 'str') { c.error(x, 'masks is up to two names: masks Food, Nest:texture.'); continue; }
        let kind: 'number' | 'texture' = 'number';
        if (c.peek().t === ':' && c.peek(1).t === 'word') { c.next(); const k = c.next() as Extract<Tok, { t: 'word' }>; if (k.v.toLowerCase() === 'texture') kind = 'texture'; else if (k.v.toLowerCase() !== 'number') c.error(k, 'A mask is a texture or a number.'); }
        masks.push({ name: x.v, kind });
      }
      if (masks.length > MAX_MASKS) c.error(t, `At most ${MAX_MASKS} masks.`);
      set.masks = masks.slice(0, MAX_MASKS);
      continue;
    }
    if (w === 'species') {
      c.next();
      const nt = c.next();
      if (nt.t !== 'word' && nt.t !== 'str') { c.error(nt, 'species needs a name: species Ants.'); c.skipClause(); continue; }
      if (drafts.length >= MAX_SPECIES) c.error(t, `At most ${MAX_SPECIES} species.`);
      const i = drafts.length;
      const sp: AgentSpeciesRules = { name: nt.v, speed: 0.25, states: [{ name: 'walking', colour: DEFAULT_STATE_COLOURS[0] }], rules: [] };
      settingArgs(`species`, (key, a) => {
        if (key === 'speed') { const n = num(a.v, a.at, 'speed'); if (n !== null) sp.speed = n; }
        else if (key === 'states') {
          const vals = a.v.k === 'list' ? a.v.v : [a.v];
          const names = vals.map(v => (v.k === 'word' || v.k === 'str' ? v.v : '')).filter(Boolean);
          if (!names.length) c.error(a.at, 'states is names: states=searching,carrying.');
          if (names.length > MAX_STATES) c.error(a.at, `At most ${MAX_STATES} states.`);
          sp.states = names.slice(0, MAX_STATES).map((n, j) => ({ name: n, colour: DEFAULT_STATE_COLOURS[j] ?? [1, 1, 1] }));
        } else { const s = suggest(key, ['speed', 'states']); c.error(a.at, `species takes speed= and states=.${s ? ` Did you mean “${s}”?` : ''}`); }
      });
      sp.states[0] = sp.states[0] ?? { name: 'walking', colour: DEFAULT_STATE_COLOURS[0] };
      if (sp.states.length === 1 && sp.states[0].name === 'walking') sp.states[0] = { name: 'walking', colour: DEFAULT_STATE_COLOURS[i] ?? [1, 1, 1] };
      cur = { sp, colours: {}, ruleAt: [], header: t };
      drafts.push(cur);
      headerIndent = startNewLine ? lineIndent : headerIndent;
      if (c.peek().t === ':') { c.next(); colonLine = true; }
      else colonLine = false;
      continue;
    }
    const s = suggest(w || nameOf(t), ['agents', 'sensors', 'flow', 'channels', 'masks', 'species', 'when', 'always']);
    c.error(t, `“${c.text(t)}” doesn't start an agents line.${s ? ` Did you mean “${s}”?` : ''}`);
    c.skipClause();
  }
  void loose;
  set.species = drafts.map(d => d.sp);
  if (!set.species.length) set.species = defaultRuleSet().species;

  // Pass 2: the rules, now that every channel, mask, species and state has its name.
  const channelOf = (x: Tok): ChannelRef | null => {
    const n = nameOf(x).toLowerCase();
    if (n === 'trail' || n === 'own') return 'own';
    const m = /^(?:trail|channel)([1-4])$/.exec(n);
    if (m) return (Number(m[1]) - 1) as ChannelRef;
    const i = set.channels.findIndex(ch => ch.trim().toLowerCase() === n);
    return i >= 0 ? i as ChannelRef : null;
  };
  const cmpOf = (): Cmp | null => { const x = c.next(); if (x.t === 'cmp' && (x.v === '>' || x.v === '<')) return x.v; c.error(x, 'Compare with > or <.'); return null; };
  const isWhere = (x: Tok) => x.t === 'word' && !!WHERE_WORDS[x.v.toLowerCase()];

  drafts.forEach((d, si) => {
    const sp = d.sp;
    const stateOf = (x: Tok): number | null => {
      const n = nameOf(x).toLowerCase();
      const j = sp.states.findIndex(s => s.name.toLowerCase() === n);
      if (j >= 0) return j;
      const m = /^state([1-8])$/.exec(n);
      return m ? Number(m[1]) - 1 : null;
    };
    const unknown = (x: Tok, what: string, among: string[]) => {
      const s = suggest(nameOf(x), among);
      c.error(x, `“${nameOf(x) || c.text(x)}” isn't ${what}.${s ? ` Did you mean “${s}”?` : among.length ? ` (${among.slice(0, 6).join(', ')})` : ''}`);
    };
    const whoRadius = (o: { who: NeighbourWho; radius?: number }) => {
      while (c.peek().t === 'word' && c.peek(1).t === '=' && ['who', 'radius'].includes((c.peek() as Extract<Tok, { t: 'word' }>).v.toLowerCase())) {
        const k = (c.next() as Extract<Tok, { t: 'word' }>).v.toLowerCase(); c.next();
        if (k === 'who') { const v = c.next(); const w = nameOf(v).toLowerCase(); if (w === 'all' || w === 'own' || w === 'others') o.who = w; else c.error(v, 'who is all, own or others.'); }
        else { const n = numVal('radius'); if (n !== null) o.radius = n; }
      }
    };
    const condition = (): RuleCondition | null => {
      const x = c.next();
      const w = nameOf(x).toLowerCase();
      if (x.t === 'word' && w === 'always') return { kind: 'always' };
      if (x.t === 'word' && w === 'not') { const y = c.next(); const s = stateOf(y); if (s === null) { unknown(y, `a state of ${sp.name}`, sp.states.map(q => q.name)); return null; } return { kind: 'state', state: s, not: true }; }
      if (x.t === 'word' && w === 'near') {
        const y = c.next();
        const k = set.species.findIndex(q => q.name.toLowerCase() === nameOf(y).toLowerCase());
        if (k < 0) { unknown(y, 'a species', set.species.map(q => q.name)); return null; }
        const cm = c.next(); if (!(cm.t === 'cmp' && cm.v === '>')) c.error(cm, 'near reads “more than”: near Predators > 0.2.');
        const v = numVal('value'); return v === null ? null : { kind: 'near', species: k, value: v };
      }
      if (x.t === 'word' && w === 'chance') { const v = numVal('chance'); return v === null ? null : { kind: 'chance', perSecond: v }; }
      if (x.t === 'word' && w === 'age') { const cm = cmpOf(); const v = numVal('seconds'); return cm && v !== null ? { kind: 'age', cmp: cm, seconds: v } : null; }
      if (x.t === 'word' && w === 'memory') {
        const cm = c.next();
        const op = cm.t === 'cmp' && (cm.v === '>' || cm.v === '<') ? cm.v : cm.t === '=' ? '=' : null;
        if (!op) { c.error(cm, 'memory > v, memory < v or memory = v.'); return null; }
        const v = numVal('value'); return v === null ? null : { kind: 'memory', cmp: op, value: v };
      }
      if (x.t === 'word' && w === 'mask') {
        const y = c.next();
        const m = set.masks.findIndex(q => q.name.toLowerCase() === nameOf(y).toLowerCase());
        const mm = m >= 0 ? m : /^mask([12])$/.test(nameOf(y).toLowerCase()) ? Number(nameOf(y).slice(4)) - 1 : -1;
        if (mm < 0) { unknown(y, 'a mask', set.masks.map(q => q.name)); return null; }
        const cm = cmpOf(); const v = numVal('value'); return cm && v !== null ? { kind: 'mask', mask: mm, cmp: cm, value: v } : null;
      }
      if (x.t === 'word' && (w === 'neighbours' || w === 'neighbors')) {
        const cm = cmpOf(); const n = numVal('count');
        const o: { who: NeighbourWho; radius?: number } = { who: 'all' }; whoRadius(o);
        return cm && n !== null ? { kind: 'neighbours', who: o.who, cmp: cm, count: n, ...(o.radius ? { radius: o.radius } : {}) } : null;
      }
      // A channel read somewhere, or a state.
      if (isWhere(c.peek())) {
        const ch = channelOf(x);
        if (ch === null) { unknown(x, 'a trail channel', ['trail', ...set.channels.filter(Boolean)]); c.next(); c.next(); c.next(); return null; }
        const where = WHERE_WORDS[(c.next() as Extract<Tok, { t: 'word' }>).v.toLowerCase()];
        const cm = cmpOf(); const v = numVal('value');
        return cm && v !== null ? { kind: 'sense', channel: ch, where, cmp: cm, value: v } : null;
      }
      const s = stateOf(x);
      if (s !== null) return { kind: 'state', state: s };
      unknown(x, `a condition or a state of ${sp.name}`, [...sp.states.map(q => q.name), ...CONDITION_KINDS.map(k => k.kind)]);
      return null;
    };
    const target = (): { toward: 'trail' | 'point' | 'centre' | 'mouse'; channel?: ChannelRef; x?: number; y?: number } | null => {
      const t0 = c.peek();
      if (t0.t === '(') { const v = c.vector(); if (v?.k === 'vec') return { toward: 'point', x: v.v[0], y: v.v[1] ?? v.v[0] }; return null; }
      const y = c.next();
      const w = nameOf(y).toLowerCase();
      if (w === 'centre' || w === 'center' || w === 'middle') return { toward: 'centre' };
      if (w === 'mouse') return { toward: 'mouse' };
      const ch = channelOf(y);
      if (ch !== null) return { toward: 'trail', channel: ch };
      unknown(y, 'something to turn to: a trail channel, centre, mouse or (x,y)', ['trail', 'centre', 'mouse', ...set.channels.filter(Boolean)]);
      return null;
    };
    const degrees = (what: string) => numVal(what, u => u === null || u === 'deg');
    const action = (): RuleAction | null => {
      const x = c.next();
      const w = nameOf(x).toLowerCase();
      switch (w) {
        case 'turn': {
          const dir = c.next();
          const d = nameOf(dir).toLowerCase();
          if (d === 'around' || d === 'round') return { kind: 'bounce' };
          if (d !== 'toward' && d !== 'towards' && d !== 'away') { c.error(dir, 'turn toward …, turn away …, or turn around.'); return null; }
          if (d === 'away' && c.peek().t === 'word' && nameOf(c.peek()).toLowerCase() === 'from') c.next();
          const tg = target(); const deg0 = degrees('turn');
          if (!tg || deg0 === null) return null;
          return { kind: 'turn', toward: tg.toward, ...(d === 'away' ? { away: true } : {}), ...(tg.toward === 'trail' ? { channel: tg.channel } : {}), ...(tg.toward === 'point' ? { x: tg.x, y: tg.y } : {}), degrees: deg0 };
        }
        case 'bounce': return { kind: 'bounce' };
        case 'wander': { const v = degrees('wander'); return v === null ? null : { kind: 'wander', degrees: v }; }
        case 'speed': { const v = numVal('speed'); return v === null ? null : { kind: 'speed', mode: 'set', value: v }; }
        case 'accelerate': { const v = numVal('speed'); return v === null ? null : { kind: 'speed', mode: 'add', value: v }; }
        case 'leave': {
          const y = c.next(); const ch = channelOf(y);
          if (ch === null) { unknown(y, 'a trail channel', ['trail', ...set.channels.filter(Boolean)]); return null; }
          const amt = numVal('amount');
          let fade: number | undefined;
          if (c.peek().t === 'word' && nameOf(c.peek()).toLowerCase() === 'fade' && c.peek(1).t === '=') { c.next(); c.next(); fade = numVal('fade') ?? undefined; }
          return amt === null ? null : { kind: 'trail', channel: ch, amount: amt, ...(fade ? { fade } : {}) };
        }
        case 'become': { const y = c.next(); const s = stateOf(y); if (s === null) { unknown(y, `a state of ${sp.name}`, sp.states.map(q => q.name)); return null; } return { kind: 'state', state: s }; }
        case 'memory': {
          const op = c.next();
          if (op.t === '=') {
            if (c.peek().t === 'word' && nameOf(c.peek()).toLowerCase() === 'random' && c.peek(1).t !== '(') { c.next(); const v = numVal('value'); return v === null ? null : { kind: 'memory', mode: 'random', value: v }; }
            const v = numVal('value'); return v === null ? null : { kind: 'memory', mode: 'set', value: v };
          }
          if (op.t === 'opeq' && op.v === '+=') {
            const t1 = c.peek();
            const v = numVal('value');
            return v === null ? null : { kind: 'memory', mode: t1.t === 'num' && t1.unit === '/s' ? 'perSecond' : 'add', value: v };
          }
          c.error(op, 'memory = v, memory += v, memory += v/s or memory = random v.');
          return null;
        }
        case 'stop': case 'stick': case 'die': return { kind: w };
        case 'spawn': { const v = numVal('amount'); return v === null ? null : { kind: 'spawn', amount: v }; }
        case 'follow': case 'against': {
          const f = c.next(); if (nameOf(f).toLowerCase() !== 'flow') c.error(f, `${w} flow 10deg.`);
          const v = degrees('flow'); return v === null ? null : { kind: 'flow', degrees: v, ...(w === 'against' ? { away: true } : {}) };
        }
        case 'align': { const v = degrees('align'); return v === null ? null : { kind: 'align', degrees: v }; }
        case 'separate': case 'match': case 'cohere': {
          const v = degrees(w); const o: { who: NeighbourWho; radius?: number } = { who: 'all' }; whoRadius(o);
          return v === null ? null : { kind: w, who: o.who, degrees: v, ...(o.radius ? { radius: o.radius } : {}) };
        }
        case 'slow': {
          let jam: number | null = null; const o: { who: NeighbourWho; radius?: number } = { who: 'all' };
          if (c.peek().t === 'word' && nameOf(c.peek()).toLowerCase() === 'jam' && c.peek(1).t === '=') { c.next(); c.next(); jam = numVal('jam'); }
          whoRadius(o);
          if (jam === null) { c.error(x, 'slow takes jam= (how many make a jam).'); return null; }
          return { kind: 'slow', who: o.who, jam, ...(o.radius ? { radius: o.radius } : {}) };
        }
        case 'avoid-edges': {
          const v = degrees('edges'); let margin = 0.1;
          if (c.peek().t === 'word' && nameOf(c.peek()).toLowerCase() === 'margin' && c.peek(1).t === '=') { c.next(); c.next(); margin = numVal('margin') ?? margin; }
          return v === null ? null : { kind: 'avoidEdges', margin, degrees: v };
        }
        case 'orbit': {
          const tg = c.peek().t === '(' ? (() => { const v = c.vector(); return v?.k === 'vec' ? { target: 'point' as const, x: v.v[0], y: v.v[1] ?? v.v[0] } : null; })()
            : (() => { const y = c.next(); const n = nameOf(y).toLowerCase(); return n === 'centre' || n === 'center' ? { target: 'centre' as const } : n === 'mouse' ? { target: 'mouse' as const } : (c.error(y, 'orbit centre, mouse or (x,y).'), null); })();
          const v = degrees('orbit'); let distance = 0.5; let cw = false;
          while (c.peek().t === 'word' && ['distance', 'cw'].includes(nameOf(c.peek()).toLowerCase())) {
            const k = nameOf(c.next()).toLowerCase();
            if (k === 'cw') cw = true; else { c.next(); distance = numVal('distance') ?? distance; }
          }
          return tg && v !== null ? { kind: 'orbit', ...tg, distance, degrees: v, ...(cw ? { cw } : {}) } : null;
        }
        case 'force': {
          const f = c.next(); const fw = nameOf(f).toLowerCase();
          if (fw === 'toward' || fw === 'away') {
            const where = c.peek().t === '(' ? c.vector() : null;
            const isMouse = !where && nameOf(c.peek()).toLowerCase() === 'mouse';
            if (isMouse) c.next();
            if (!where && !isMouse) { c.error(c.peek(), 'force toward mouse 1, or force toward (x,y) 1.'); return null; }
            const s = numVal('force'); if (s === null) return null;
            const strength = fw === 'away' ? -s : s;
            return isMouse ? { kind: 'force', field: 'mouse', strength } : { kind: 'force', field: 'point', strength, x: (where as { v: number[] }).v[0], y: (where as { v: number[] }).v[1] ?? 0 };
          }
          if (!['gravity', 'wind', 'curl'].includes(fw)) { c.error(f, 'force gravity, wind, curl, toward … or away ….'); return null; }
          const s = numVal('force');
          let angle: number | undefined;
          if (c.peek().t === 'word' && nameOf(c.peek()).toLowerCase() === 'angle' && c.peek(1).t === '=') { c.next(); c.next(); angle = degrees('angle') ?? undefined; }
          return s === null ? null : { kind: 'force', field: fw as 'gravity', strength: s, ...(angle !== undefined ? { angle } : {}) };
        }
        case 'drag': { const v = numVal('drag'); return v === null ? null : { kind: 'drag', amount: v }; }
        case 'fade': { const v = numVal('seconds', u => u === null || u === 's'); return v === null ? null : { kind: 'fade', seconds: v }; }
        default: unknown(x, 'an action', ['turn', 'wander', 'speed', 'accelerate', 'leave', 'become', 'memory', 'stop', 'stick', 'die', 'spawn', 'follow', 'against', 'align', 'separate', 'match', 'cohere', 'slow', 'avoid-edges', 'orbit', 'force', 'drag', 'fade']); while (!c.atClauseEnd() && c.peek().t !== ',' && c.peek().t !== '@') c.next(); return null;
      }
    };
    for (const at of d.ruleAt) {
      c.i = at;
      const first = c.next() as Extract<Tok, { t: 'word' }>;
      const when: RuleCondition[] = [];
      let ok = true;
      if (first.v.toLowerCase() === 'when') {
        for (;;) {
          const cond = condition();
          if (cond) when.push(cond); else ok = false;
          if (c.peek().t === 'word' && nameOf(c.peek()).toLowerCase() === 'and') { c.next(); continue; }
          break;
        }
      } else when.push({ kind: 'always' });
      if (!(c.peek().t === 'word' && nameOf(c.peek()).toLowerCase() === 'do')) { c.error(c.peek(), 'A rule is when … do …, or always do ….'); continue; }
      c.next();
      const acts: RuleAction[] = [];
      if (c.peek().t === 'word' && nameOf(c.peek()).toLowerCase() === 'nothing') c.next();
      else for (;;) {
        const a = action();
        if (a) acts.push(a); else ok = false;
        if (c.peek().t === ',') { c.next(); continue; }
        break;
      }
      const rule: AgentRule = { when, do: acts };
      for (const m of c.mods()) {
        const n = m.name.toLowerCase();
        if (n === 'last' || n === 'stop') rule.stop = true;
        else if (n === 'off') rule.off = true;
        else c.error(m, `@${m.name}: a rule takes @last (stop after it) and @off.`);
      }
      if (!c.atClauseEnd()) { c.error(c.peek(), `Unexpected “${c.text(c.peek())}”: separate actions with commas.`); c.skipClause(); }
      if (ok) sp.rules.push(rule);
      void si;
    }
  });

  if (randomAll) {
    const at = { at: 0, end: 6 };
    const draw = (key: string, spec: RandSpec) => { const v = drawFrom(spec, rng()); resolved.push({ key, from: 'random', to: v.k === 'num' ? fmtNum(v.v) : v.k === 'colour' ? v.text : '', at: at.at, end: at.end }); return v; };
    if (!given.has('sensors.ahead')) set.sensor = { ...set.sensor, distance: (draw('sensors.ahead', AG_RAND.ahead) as { v: number }).v };
    if (!given.has('sensors.angle')) set.sensor = { ...set.sensor, angle: (draw('sensors.angle', AG_RAND.angle) as { v: number }).v };
    drafts.forEach(d => {
      if (!given.has('species.speed')) d.sp.speed = (draw(`${d.sp.name}.speed`, AG_RAND.speed) as { v: number }).v;
      d.sp.states.forEach((s, j) => { if (!d.colours[j]) { const v = draw(`${s.name}.color`, { kind: 'colour' }); if (v.k === 'colour') d.sp.states[j] = { ...s, colour: v.v }; } });
    });
  }
  return { set: normalizeRuleSet(set), errors: c.errors, hints: c.diagnostics.filter(x => x.severity === 'hint'), resolved, ...(seed !== null && (resolved.length || randomAll) ? { seed } : {}) };
}

// ── The registry's agents words ───────────────────────────────────────────

const agentEntries = (): Entry[] => [
  { id: 'agents:agents', kind: 'header', dialects: ['agents'], words: ['agents'], params: [{ key: 'kind', type: 'choice', options: WALKER_KIND_KEYS }, { key: 'edges', type: 'choice', options: ['wrap', 'bounce', 'slide'] }, { key: 'view', type: 'number', rand: AG_RAND.radius }, { key: 'view-max', type: 'count' }], summary: 'The rule set: what kind of walkers, what the edges do, how far they see each other.', examples: ['agents kind=flock edges=bounce view=0.05'], stage: 'agents' },
  { id: 'agents:sensors', kind: 'setting', dialects: ['agents'], words: ['sensors'], params: [{ key: 'ahead', type: 'number', rand: AG_RAND.ahead }, { key: 'angle', type: 'angle', rand: AG_RAND.angle }], summary: 'The trail sensors: how far ahead and how wide.', examples: ['sensors ahead=0.035 angle=22.5deg'], stage: 'agents' },
  { id: 'agents:flow', kind: 'setting', dialects: ['agents'], words: ['flow'], params: [{ key: 'size', type: 'number', rand: AG_RAND['flow-size'] }, { key: 'evolve', type: 'number', rand: AG_RAND.evolve }], summary: 'The flow field (curl noise) follow flow reads.', examples: ['flow size=1.2 evolve=0.2'], stage: 'agents' },
  { id: 'agents:channels', kind: 'setting', dialects: ['agents'], words: ['channels'], params: [], summary: 'Names for the four trail channels (_ for a blank one).', examples: ['channels home, food'], stage: 'agents' },
  { id: 'agents:masks', kind: 'setting', dialects: ['agents'], words: ['masks'], params: [], summary: 'Up to two masks (inputs on the group card); Name:texture for a texture.', examples: ['masks Food, Nest'], stage: 'agents' },
  { id: 'agents:species', kind: 'header', dialects: ['agents'], words: ['species'], params: [{ key: 'speed', type: 'number', rand: AG_RAND.speed }, { key: 'states', type: 'list' }], summary: 'A species: its name, speed and states, then its rules (indented, or after a colon on one line).', examples: ['species Ants speed=0.3 states=searching,carrying', 'species Slime: always do wander 7deg'], stage: 'agents' },
  { id: 'agents:state', kind: 'setting', dialects: ['agents'], words: ['state'], params: [{ key: 'color', type: 'colour', rand: { kind: 'colour' } }], summary: 'A state\'s colour, under its species.', examples: ['state carrying color=gold'], stage: 'colour' },
  { id: 'agents:when', kind: 'header', dialects: ['agents'], words: ['when', 'always'], params: [], summary: 'A rule: when <condition> and … do <action>, …  (or always do …); @last stops after it, @off switches it off.', examples: ['when searching and food anywhere > 0.05 do turn toward food 20deg', 'always do wander 7deg'], stage: 'rule' },
  ...CONDITION_KINDS.filter(k => k.kind !== 'always' && k.kind !== 'sense' && k.kind !== 'state').map((k): Entry => ({ id: `agents:cond:${k.kind}`, kind: 'condition', dialects: ['agents'], words: [k.kind], params: [], summary: `Condition: ${k.label}.`, examples: [] })),
  ...[['turn', 'turn toward food 20deg · turn away mouse 30deg · turn around'], ['wander', 'wander 7deg'], ['speed', 'speed 0.4'], ['accelerate', 'accelerate 0.1/s'], ['leave', 'leave food 1 fade=0.15'], ['become', 'become carrying'],
    ['stop', 'stop'], ['stick', 'stick'], ['die', 'die'], ['spawn', 'spawn 1'], ['follow', 'follow flow 10deg'], ['against', 'against flow 10deg'], ['align', 'align 10deg'], ['separate', 'separate 12deg who=others radius=0.045'],
    ['match', 'match 6deg'], ['cohere', 'cohere 3deg'], ['slow', 'slow jam=20'], ['avoid-edges', 'avoid-edges 12deg margin=0.1'], ['orbit', 'orbit centre 8deg distance=0.5 cw'], ['force', 'force gravity 0.75 angle=-90deg · force toward mouse 1'],
    ['drag', 'drag 0.35'], ['fade', 'fade 3s']].map(([w, ex]): Entry => ({ id: `agents:act:${w}`, kind: 'action', dialects: ['agents'], words: [w], params: [], summary: `Action: ${ACTION_KINDS.find(a => a.kind === w || (w === 'avoid-edges' && a.kind === 'avoidEdges') || (w === 'leave' && a.kind === 'trail') || (w === 'become' && a.kind === 'state') || ((w === 'follow' || w === 'against') && a.kind === 'flow') || (w === 'accelerate' && a.kind === 'speed'))?.label ?? w}.`, examples: ex.split(' · ') })),
];

registerEntries(agentEntries());
