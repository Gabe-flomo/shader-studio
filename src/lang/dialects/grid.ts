/**
 * grid.ts — the Grid Rules dialect of the Playfield language (docs/playfield-language-plan.md §4.3).
 *
 *   grid life walls board=480
 *   grid count born=3 survive=2,3 neighbours=moore
 *   grid count neighbours=radius radius=5 born=34..45 survive=33..57      (bosco)
 *   grid stages born=2 survive= states=3                                    (brians-brain)
 *   grid smooth waves wave-speed=0.9 damping=0.995
 *   grid smooth custom u={u + 0.2 * lap_u} v={v} a=0.5
 *   grid patterns states=4
 *     stencil .../.1./... → 2
 *     stencil .../.3./... → 1 count=1:1..2
 *   grid blocks states=3
 *     block 11/00 → 00/11
 *     block 10/*0 → 00/=1 @mirror chance=0.8
 *
 * Text maps one-to-one onto the Grid Rules node's params (gridRules/spec.ts), both ways: parseGrid
 * reads a line into params, printGrid writes the shortest line for params (a preset, then what
 * differs from it). `grid` is needed only where a name clashes with another word (§13 decision 6):
 * inside the Grid Rules editor it can be left out, and the printer writes it only for a name the
 * Do… bar would read as something else (swirl, ripples, diamonds, spirals…).
 *
 * The params are the stored form; text is a view of them, so no saved file changes.
 */
import { Cursor } from '../parse';
import type { Arg, Diagnostic, Value } from '../ast';
import type { Tok } from '../lex';
import { COLOUR_NAMES, colourOf, colourText, type RGB } from '../colours';
import { fmtNum, printValue } from '../print';
import { suggest } from '../fuzzy';
import { drawFrom, freshSeed, makeRng, resolveRandom, seedOf, type RandSpec, type Resolved, type Rng } from '../random';
import { registerEntries, type Entry } from '../registry';
import {
  BOARD_SIZES, COUNT_PRESETS, GRID_DEFAULTS, LOOKS, MAX_RADIUS, MAX_STATES, MAX_STEPS, SMOOTH_PRESETS, STAGES_PRESETS,
  countsOf, gridTypeDefaults, maskOf, matchingPreset, parseRuleString, presetPatch, type GridPreset, type GridRuleType,
} from '../../gridRules/spec';
import { ANY, BLOCK_PRESETS, NOT_EMPTY, PATTERN_PRESETS, SAME, readBlocks, readPatterns, type BlockRule, type PatternRule } from '../../gridRules/stencils';

type P = Record<string, unknown>;

// ── Names ─────────────────────────────────────────────────────────────────

export const RULE_TYPE_WORDS: readonly GridRuleType[] = ['count', 'stages', 'smooth', 'patterns', 'blocks'];

const TABLES: Array<[GridRuleType, Record<string, GridPreset>]> = [
  ['count', COUNT_PRESETS], ['stages', STAGES_PRESETS], ['smooth', SMOOTH_PRESETS],
  ['patterns', PATTERN_PRESETS as Record<string, GridPreset>], ['blocks', BLOCK_PRESETS as Record<string, GridPreset>],
];

/** A preset's name in text: its label, slugged ("Day & Night" → day-and-night, "Bosco (radius 5)" → bosco). */
export const presetSlug = (label: string) => label.replace(/\(.*\)/, '').replace(/&/g, 'and').replace(/['’]/g, '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export interface GridPresetName { slug: string; ruleType: GridRuleType; key: string; preset: GridPreset; aliases: string[] }

/** Extra names (the Do… bar's own words for them, one word each). */
const PRESET_ALIASES: Record<string, string[]> = {
  life: ['conway', 'game-of-life'], highlife: ['high-life'], 'brians-brain': ['brian'], mitosis: ['reaction-diffusion', 'gray-scott'],
  heat: ['diffusion'], ripples: ['water', 'waves-preset'], 'falling-sand': ['sand'], gas: ['hpp'], wireworld: ['wire-world'],
};

export const GRID_PRESET_NAMES: readonly GridPresetName[] = TABLES.flatMap(([ruleType, table]) => Object.entries(table).map(([key, preset]) => {
  const slug = presetSlug(preset.label);
  return { slug, ruleType, key, preset, aliases: PRESET_ALIASES[slug] ?? [] };
}));

const presetBySlug = (w: string) => GRID_PRESET_NAMES.find(p => p.slug === w) ?? GRID_PRESET_NAMES.find(p => p.aliases.includes(w));

/** The params a preset sets (as the editor and the Do… bar set them: the type's look, then the preset). */
export function presetParams(ruleType: GridRuleType, preset: GridPreset): P {
  const typeLook = ruleType === 'count' ? { ...LOOKS.count, brushState: 1 } : {};
  return { ruleType, ...typeLook, ...presetPatch(preset) };
}

/** Board size by cells across at 1080p (960, 480, 240, 120, 60), snapped to the nearest. */
const ACROSS = BOARD_SIZES.map(b => ({ value: b.value, across: Math.round(1920 * b.scale), scale: b.scale }));
const boardFor = (cells: number) => ACROSS.reduce((best, b) => (Math.abs(Math.log(b.across / cells)) < Math.abs(Math.log(best.across / cells)) ? b : best)).value;
const acrossOf = (v: unknown) => ACROSS.find(b => b.value === String(v))?.across ?? 240;

const NB_WORDS: Record<string, string> = { moore: 'moore', 'von-neumann': 'vonNeumann', vonneumann: 'vonNeumann', 'von_neumann': 'vonNeumann', radius: 'radius', larger: 'radius' };
const NB_TEXT: Record<string, string> = { moore: 'moore', vonNeumann: 'von-neumann', radius: 'radius' };
const TEMPLATES = ['diffusion', 'waves', 'reaction', 'custom'] as const;
const START_WORDS = ['noise', 'empty', 'image', 'centre', 'center'];

/** Settings keys → params (number settings). */
const NUM_KEYS: Record<string, { param: string; min?: number; max?: number; int?: boolean }> = {
  states: { param: 'states', min: 2, max: MAX_STATES, int: true },
  radius: { param: 'radius', min: 1, max: MAX_RADIUS, int: true },
  spread: { param: 'spread' }, cooling: { param: 'decay' }, decay: { param: 'decay' },
  'wave-speed': { param: 'waveSpeed' }, damping: { param: 'damping' }, feed: { param: 'feed' }, kill: { param: 'kill' },
  'spread-a': { param: 'diffA' }, 'spread-b': { param: 'diffB' },
  a: { param: 'knobA' }, b: { param: 'knobB' }, c: { param: 'knobC' }, d: { param: 'knobD' }, gain: { param: 'gain' },
  density: { param: 'density', min: 0, max: 1 }, 'start-seed': { param: 'seed', int: true },
  steps: { param: 'steps', min: 1, max: MAX_STEPS, int: true },
  afterglow: { param: 'afterglow', min: 0, max: 1 }, 'age-rate': { param: 'ageRate' }, 'age-fade': { param: 'ageFade', min: 0, max: 1 },
  // Blocks: how much the block grid is shuffled each step (gridRules/dice.ts).
  jitter: { param: 'jitter', min: 0, max: 1 },
};

/** Colour keys of `colours …`: names per state, the glow and the old colour. */
const COLOUR_KEYS: Record<string, string> = {
  empty: 'color0', on: 'color1', dying: 'color2', glow: 'glowColor', old: 'oldColor',
  ...Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`c${i}`, `color${i}`])),
};

/** Interesting random ranges for the grid's settings. */
export const GRID_RAND: Readonly<Record<string, RandSpec>> = {
  states: { kind: 'num', lo: 3, hi: 8, int: true }, radius: { kind: 'num', lo: 2, hi: 6, int: true },
  spread: { kind: 'num', lo: 0.5, hi: 1 }, cooling: { kind: 'num', lo: 0, hi: 0.01 }, 'wave-speed': { kind: 'num', lo: 0.5, hi: 1 }, damping: { kind: 'num', lo: 0.98, hi: 0.999 },
  feed: { kind: 'num', lo: 0.025, hi: 0.065 }, kill: { kind: 'num', lo: 0.055, hi: 0.065 }, 'spread-a': { kind: 'num', lo: 0.8, hi: 1 }, 'spread-b': { kind: 'num', lo: 0.3, hi: 0.6 },
  a: { kind: 'num', lo: 0, hi: 1 }, b: { kind: 'num', lo: 0, hi: 1 }, c: { kind: 'num', lo: 0, hi: 1 }, d: { kind: 'num', lo: 0, hi: 1 }, gain: { kind: 'num', lo: 0.8, hi: 3 },
  density: { kind: 'num', lo: 0.1, hi: 0.55 }, 'start-seed': { kind: 'num', lo: 1, hi: 999, int: true }, steps: { kind: 'num', lo: 1, hi: 4, int: true },
  afterglow: { kind: 'num', lo: 0, hi: 0.95 }, 'age-rate': { kind: 'num', lo: 0.005, hi: 0.05 }, 'age-fade': { kind: 'num', lo: 0, hi: 1 },
  jitter: { kind: 'num', lo: 0.6, hi: 1 },
  speed: { kind: 'num', lo: 0.2, hi: 1 }, board: { kind: 'choice', options: ['480', '240', '120'] },
  neighbours: { kind: 'choice', options: ['moore', 'von-neumann'] }, start: { kind: 'choice', options: ['noise', 'centre'] },
  colour: { kind: 'colour' },
};

// ── Reading ───────────────────────────────────────────────────────────────

export interface GridParse {
  params: P;
  errors: Diagnostic[];
  hints: Diagnostic[];
  resolved: Resolved[];
  seed?: number;
  /** The line named its rule type or preset (else it changes the params it was given). */
  headed: boolean;
}

const roundN = (n: number) => Math.round(n * 10000) / 10000;

/**
 * Read grid text into Grid Rules params. `base`: the params to change (the editor's node) when the
 * text has no rule type or preset; else GRID_DEFAULTS. `seed`: for `random` values.
 */
export function parseGrid(src: string, opts: { base?: P; seed?: number } = {}): GridParse {
  // `rule=B36/S23` and a bare B/S rule are read before lexing (the slash isn't a token there).
  const bare = parseRuleString(src.replace(/^\s*grid\s+/i, ''));
  if (bare && !/[=·]/.test(src)) {
    const params = { ...GRID_DEFAULTS, ...presetParams('count', COUNT_PRESETS.life), bornMask: bare.born, surviveMask: bare.survive };
    return { params, errors: [], hints: [], resolved: [], headed: true };
  }
  const ruleAt: Array<{ at: number; end: number; born: number; survive: number } | { at: number; end: number; bad: string }> = [];
  const masked = src.replace(/\brule\s*=\s*([A-Za-z0-9/]+)/g, (m, rule: string, at: number) => {
    const r = parseRuleString(rule);
    ruleAt.push(r ? { at, end: at + m.length, ...r } : { at, end: at + m.length, bad: rule });
    return ' '.repeat(m.length);
  });
  const c = new Cursor(masked);
  const P: P = { ...GRID_DEFAULTS, ...(opts.base ?? {}) };
  const resolved: Resolved[] = [];
  let seed: number | null = (() => { const m = /(?:^|[\s·;|])seed\s*=?\s*([A-Za-z0-9_-]+)/i.exec(src); return m ? seedOf(m[1]) : null; })();
  let rngCache: Rng | null = null;
  const rng = () => { if (!rngCache) { if (seed === null) seed = opts.seed ?? freshSeed(); rngCache = makeRng(seed); } return rngCache; };
  let randomAll = false;
  let headed = false;
  const given = new Set<string>();
  let patterns: PatternRule[] | null = null;
  let blocks: BlockRule[] | null = null;
  for (const r of ruleAt) {
    if ('bad' in r) c.error(r, `“${r.bad}” isn't a B/S rule: write B36/S23.`);
    else { given.add('born'); given.add('survive'); }
  }

  /** A `random…` value drawn for setting `key`. */
  const draw = (a: Arg, key: string, spec?: RandSpec): Value | null => {
    if (a.value.k !== 'random') return a.value;
    const v = resolveRandom(a.value, spec ?? GRID_RAND[key], rng());
    if (!v) { c.error(a, `There is nothing to draw ${key} from: give it a range, random(0.2..2).`); return null; }
    resolved.push({ key, from: c.text(a).replace(/^[\w-]+=/, ''), to: printValue(v), at: a.at, end: a.end });
    return v;
  };
  const drawUnset = (key: string, spec: RandSpec, at: { at: number; end: number }): Value => {
    const v = drawFrom(spec, rng());
    resolved.push({ key, from: 'random', to: printValue(v), at: at.at, end: at.end });
    return v;
  };

  const num = (v: Value | null, a: Arg, what: string): number | null => {
    if (v?.k === 'num') return v.unit === '%' ? v.v / 100 : v.v;
    c.error(a, `${what} is a number.`);
    return null;
  };
  const counts = (v: Value | null, a: Arg, what: string): number[] | null => {
    if (!v) return null;
    if (v.k === 'num' && Number.isInteger(v.v)) return [v.v];
    if (v.k === 'list' && v.v.every(x => x.k === 'num' && Number.isInteger(x.v))) return v.v.map(x => (x as { v: number }).v);
    c.error(a, `${what} is neighbour counts: ${what}=2,3 (or a range, ${what}=34..45, with neighbours=radius).`);
    return null;
  };
  const colour = (v: Value | null, a: Arg): RGB | null => {
    if (!v) return null;
    if (v.k === 'colour') return v.v;
    if (v.k === 'vec' && v.v.length >= 3) return [v.v[0], v.v[1], v.v[2]];
    if (v.k === 'num') return [v.v, v.v, v.v];
    if (v.k === 'word') {
      const rgb = colourOf(v.v);
      if (rgb) return rgb;
      const s = suggest(v.v, COLOUR_NAMES);
      c.error(a, `“${v.v}” isn't a colour.${s ? ` Did you mean “${s}”?` : ''}`);
      return null;
    }
    c.error(a, 'A colour: a name, #rrggbb or (r,g,b).');
    return null;
  };

  /** One setting (`key=value` or a flag) on the rule. */
  const setting = (a: Arg) => {
    const key = a.key?.toLowerCase() ?? null;
    if (!key) {
      const v = a.value;
      const w = v.k === 'word' ? v.v.toLowerCase() : '';
      if (w === 'wrap' || w === 'walls') { P.edges = w; given.add('edges'); return; }
      if ((TEMPLATES as readonly string[]).includes(w) && P.ruleType === 'smooth') { P.template = w; given.add('template'); return; }
      c.error(a, `“${c.text(a)}” isn't a grid setting: born=, survive=, neighbours=, states=, board=, wrap, walls, speed=…`);
      return;
    }
    given.add(key);
    if (key === 'born-range' || key === 'survive-range') {
      const v = a.value;
      if (v.k === 'range') { const s0 = key === 'born-range' ? 'born' : 'survive'; P[`${s0}Lo`] = Math.round(v.lo); P[`${s0}Hi`] = Math.round(v.hi); }
      else c.error(a, `${key} is a range: ${key}=34..45.`);
      return;
    }
    if ((key === 'born' || key === 'survive') && a.value.k === 'word' && /^(wrap|walls|diffusion|waves|reaction|custom)$/i.test(a.value.v)) {
      // `survive= walls`: an empty list, then the flag.
      P[key === 'born' ? 'bornMask' : 'surviveMask'] = 0;
      setting({ ...a, key: null });
      return;
    }
    if (key === 'born' || key === 'survive') {
      const v = draw(a, key, { kind: 'choice', options: key === 'born' ? ['3', '2', '36', '3678', '35678', '1'] : ['23', '2345', '45678', '12345', '1357', '34'] });
      if (v?.k === 'range') { P[`${key}Lo`] = Math.round(v.lo); P[`${key}Hi`] = Math.round(v.hi); return; }
      // A random choice comes back as a word of digits ("36").
      const list = v?.k === 'word' && /^\d+$/.test(v.v) ? [...v.v].map(Number) : counts(v, a, key);
      if (list) P[key === 'born' ? 'bornMask' : 'surviveMask'] = maskOf(list);
      return;
    }
    if (key === 'neighbours' || key === 'neighbors' || key === 'neighbourhood') {
      const v = draw(a, 'neighbours');
      const w = v?.k === 'word' ? v.v.toLowerCase() : '';
      if (NB_WORDS[w]) P.neighbourhood = NB_WORDS[w]; else c.error(a, 'neighbours is moore, von-neumann or radius.');
      return;
    }
    if (key === 'shape') {
      const w = a.value.k === 'word' ? a.value.v.toLowerCase() : '';
      if (w === 'box' || w === 'circle') P.shape = w; else c.error(a, 'shape is box or circle (the radius neighbourhood).');
      return;
    }
    if (key === 'board') {
      const v = draw(a, 'board');
      const n = v?.k === 'word' ? Number(v.v) : num(v, a, 'board');
      if (n !== null && Number.isFinite(n)) P.board = n <= 1 ? (BOARD_SIZES.reduce((b, x) => (Math.abs(x.scale - n) < Math.abs(b.scale - n) ? x : b)).value) : boardFor(n);
      return;
    }
    if (key === 'speed') {
      const n = num(draw(a, 'speed'), a, 'speed');
      if (n === null) return;
      if (n <= 1) P.rate = Math.max(0.01, n);
      else { P.rate = 1; P.steps = Math.max(1, Math.min(MAX_STEPS, Math.round(n))); }
      return;
    }
    if (key === 'start') {
      const v = draw(a, 'start');
      const w = v?.k === 'word' ? v.v.toLowerCase() : '';
      if (START_WORDS.includes(w)) P.start = w === 'center' ? 'centre' : w; else c.error(a, 'start is noise, empty, image or centre.');
      return;
    }
    if (key === 'template') {
      const w = a.value.k === 'word' ? a.value.v.toLowerCase() : '';
      if ((TEMPLATES as readonly string[]).includes(w)) P.template = w; else c.error(a, 'template is diffusion, waves, reaction or custom.');
      return;
    }
    if (key === 'u' || key === 'v') {
      if (a.value.k === 'code' || a.value.k === 'str') P[key === 'u' ? 'customU' : 'customV'] = a.value.v;
      else c.error(a, `${key} is one line of GLSL in braces: ${key}={u + 0.2 * lap_u}.`);
      return;
    }
    if (key === 'edges') {
      const w = a.value.k === 'word' ? a.value.v.toLowerCase() : '';
      if (w === 'wrap' || w === 'walls') P.edges = w; else c.error(a, 'edges is wrap or walls.');
      return;
    }
    if (COLOUR_KEYS[key]) { const rgb = colour(draw(a, 'colour'), a); if (rgb) P[COLOUR_KEYS[key]] = rgb; return; }
    const nk = NUM_KEYS[key];
    if (nk) {
      const n = num(draw(a, key), a, key);
      if (n === null) return;
      let x = nk.int ? Math.round(n) : n;
      if (nk.min !== undefined) x = Math.max(nk.min, x);
      if (nk.max !== undefined) x = Math.min(nk.max, x);
      P[nk.param] = x;
      return;
    }
    const s = suggest(key, ['board', 'speed', 'states', 'born', 'survive', 'neighbours', 'radius', 'shape', 'start', 'density', 'template', 'edges', ...Object.keys(NUM_KEYS), ...Object.keys(COLOUR_KEYS), 'u', 'v']);
    c.error(a, `“${a.key}” isn't a grid setting.${s ? ` Did you mean “${s}”?` : ''}`);
  };

  /** Stencil / block cells: '.' any, '*' not empty, '=' unchanged (an after cell), a state (0–9, a–f). */
  const cellOf = (ch: string, after: boolean): number | null => {
    if (ch === '.') return after ? null : ANY;
    if (ch === '*') return after ? null : NOT_EMPTY;
    if (ch === '=') return after ? SAME : null;
    const n = parseInt(ch, 16);
    return Number.isFinite(n) && n < MAX_STATES ? n : null;
  };
  const cellsOf = (t: Tok, size: 2 | 3, after: boolean, what: string): number[] | null => {
    if (t.t !== 'cells' || t.v.length !== size) { c.error(t, `${what} is ${size}×${size} cells in rows split by /: ${size === 3 ? '.../.1./...' : '11/00'}.`); return null; }
    const out: number[] = [];
    for (const ch of t.v.join('')) {
      const v = cellOf(ch, after);
      if (v === null) { c.error(t, after ? 'An after cell is = (unchanged) or a state.' : `A cell is . (any), * (not empty) or a state.`); return null; }
      out.push(v);
    }
    return out;
  };
  const mods = (allowed: Record<string, string>, what: string): { symmetry?: string; off?: boolean; last?: boolean } => {
    const out: { symmetry?: string; off?: boolean } = {};
    for (const m of c.mods()) {
      const name = m.name.toLowerCase();
      if (name === 'off') out.off = true;
      else if (allowed[name]) out.symmetry = allowed[name];
      else c.error(m, `@${m.name} isn't a ${what} modifier: ${Object.keys(allowed).map(k => `@${k}`).join(', ')} or @off.`);
    }
    return out;
  };
  /** `count=1:1..2` (state 1, one or two neighbours), `count=1:2`. */
  const readCount = (): PatternRule['count'] | null => {
    const st = c.next();
    if (st.t !== 'num' || c.peek().t !== ':') { c.error(st, 'count is state:min..max, like count=1:1..2.'); while (!c.atClauseEnd() && c.peek().t !== '@') c.next(); return null; }
    c.next();
    const r = c.next();
    if (r.t === 'range') return { state: Math.round(st.v), min: Math.round(r.lo), max: Math.round(r.hi) };
    if (r.t === 'num') return { state: Math.round(st.v), min: Math.round(r.v), max: Math.round(r.v) };
    c.error(r, 'count is state:min..max, like count=1:1..2.');
    return null;
  };

  while (c.peek().t !== 'eof') {
    if (c.peek().t === 'sep') { c.next(); continue; }
    const t = c.peek();
    if (t.t === 'word') {
      const w = t.v.toLowerCase();
      if (w === 'grid' && !(c.peek(1).t === '=')) { c.next(); continue; }
      if (w === 'random' && c.peek(1).t !== '(' && c.peek(1).t !== '=') { c.next(); randomAll = true; continue; }
      if (w === 'seed') { c.next(); if (c.peek().t === '=') c.next(); if (c.peek().t === 'num' || c.peek().t === 'word') c.next(); continue; }
      const preset = presetBySlug(w);
      if ((RULE_TYPE_WORDS as readonly string[]).includes(w) || preset) {
        c.next();
        if (preset && !(RULE_TYPE_WORDS as readonly string[]).includes(w)) {
          if (preset.slug !== w) c.hint(t, `“${t.v}”: the preset is called ${preset.slug}.`, [preset.slug]);
          Object.assign(P, presetParams(preset.ruleType, preset.preset));
        } else Object.assign(P, gridTypeDefaults(w as GridRuleType));
        headed = true;
        for (const a of c.args([])) setting(a);
        continue;
      }
      if (w === 'stencil' || w === 'pattern') {
        c.next();
        const cellsTok = c.next();
        const cells = cellsOf(cellsTok, 3, false, 'A stencil');
        if (c.peek().t === 'arrow') c.next(); else { c.error(c.peek(), 'A stencil is cells → the state it becomes: stencil .../.1./... → 2.'); c.skipClause(); continue; }
        const to = c.next();
        const becomes = to.t === 'num' && Number.isInteger(to.v) && to.v >= 0 && to.v < MAX_STATES ? to.v : null;
        if (becomes === null) c.error(to, 'A stencil becomes a state: → 2.');
        let count: PatternRule['count'] = null;
        let m: ReturnType<typeof mods> = {};
        while (!c.atClauseEnd()) {
          if (c.peek().t === '@') { m = { ...m, ...mods({ turns: 'rotate', 'turns-mirrors': 'all' }, 'stencil') }; continue; }
          const k = c.peek();
          if (k.t === 'word' && k.v.toLowerCase() === 'count' && c.peek(1).t === '=') { c.next(); c.next(); count = readCount(); continue; }
          c.error(k, `Unexpected “${c.text(k)}”: a stencil takes count=state:min..max and @turns or @turns-mirrors.`);
          c.next();
        }
        if (cells && becomes !== null) (patterns ??= []).push({ cells, becomes, symmetry: (m.symmetry ?? 'none') as PatternRule['symmetry'], ...(count ? { count } : {}), ...(m.off ? { off: true } : {}) });
        continue;
      }
      if (w === 'block') {
        c.next();
        const before = cellsOf(c.next(), 2, false, 'A block\'s before');
        if (c.peek().t === 'arrow') c.next(); else { c.error(c.peek(), 'A block is before → after: block 11/00 → 00/11.'); c.skipClause(); continue; }
        const after = cellsOf(c.next(), 2, true, 'A block\'s after');
        let chance = 1;
        let m: ReturnType<typeof mods> = {};
        while (!c.atClauseEnd()) {
          if (c.peek().t === '@') { m = { ...m, ...mods({ mirror: 'mirror', turns: 'rotate' }, 'block') }; continue; }
          const args = c.args(['@']);
          for (const a of args) {
            if (a.key?.toLowerCase() === 'chance') { const n = num(draw(a, 'chance', { kind: 'num', lo: 0.3, hi: 1 }), a, 'chance'); if (n !== null) chance = Math.max(0, Math.min(1, n)); }
            else c.error(a, 'A block takes chance= and @mirror or @turns.');
          }
        }
        if (before && after) (blocks ??= []).push({ before, after, symmetry: (m.symmetry ?? 'none') as BlockRule['symmetry'], chance, ...(m.off ? { off: true } : {}) });
        continue;
      }
      if (w === 'colours' || w === 'colors') {
        c.next();
        for (const a of c.args([])) {
          const k = a.key?.toLowerCase();
          if (!k || !COLOUR_KEYS[k]) { c.error(a, 'colours takes empty=, on=, dying=, c0= … c7=, glow= and old=.'); continue; }
          given.add(k);
          const rgb = colour(draw(a, 'colour'), a);
          if (rgb) P[COLOUR_KEYS[k]] = rgb;
        }
        continue;
      }
      if (w === 'brush') {
        c.next();
        for (const a of c.args([])) {
          const k = a.key?.toLowerCase() ?? (a.value.k === 'num' ? 'size' : '');
          const key = k === 'size' ? 'brushRadius' : k === 'state' ? 'brushState' : k === 'fill' ? 'brushFill' : null;
          if (!key) { c.error(a, 'brush takes size=, state= and fill=.'); continue; }
          const n = num(draw(a, k, k === 'size' ? { kind: 'num', lo: 1, hi: 8 } : k === 'fill' ? { kind: 'num', lo: 0.2, hi: 1 } : { kind: 'num', lo: 1, hi: 3, int: true }), a, `brush ${k}`);
          if (n !== null) P[key] = key === 'brushState' ? Math.max(0, Math.round(n)) : n;
        }
        continue;
      }
      // A setting on its own clause: board=240, wrap, speed=0.3.
      if (c.peek(1).t === '=' || w === 'wrap' || w === 'walls' || c.peek(1).t === 'opeq') {
        for (const a of c.args([])) setting(a);
        continue;
      }
      const s = suggest(w, [...RULE_TYPE_WORDS, ...GRID_PRESET_NAMES.map(p => p.slug), 'stencil', 'block', 'colours', 'brush']);
      c.error(t, `“${t.v}” isn't a grid rule type, preset or setting.${s ? ` Did you mean “${s}”?` : ''}`);
      c.skipClause();
      continue;
    }
    c.error(t, 'A grid line starts with a word: a rule type (count, stages, smooth, patterns, blocks), a preset (life, seeds…), a setting or stencil / block.');
    c.skipClause();
  }
  // rule=B36/S23 (read before lexing) applies over the rule type or preset.
  for (const r of ruleAt) if (!('bad' in r)) { P.bornMask = r.born; P.surviveMask = r.survive; }
  if (patterns) P.patterns = patterns;
  if (blocks) P.blocks = blocks;
  // A leading random: what the line leaves unset, drawn.
  if (randomAll) {
    const at = { at: 0, end: 6 };
    const type = P.ruleType as GridRuleType;
    const set = (key: string, spec: RandSpec, apply: (v: Value) => void) => { if (!given.has(key)) apply(drawUnset(key, spec, at)); };
    if (type === 'count' || type === 'stages') {
      set('born', { kind: 'choice', options: ['3', '36', '2', '3678', '35678', '34'] }, v => { P.bornMask = maskOf([...String((v as { v: string }).v)].map(Number)); });
      set('survive', { kind: 'choice', options: ['23', '2345', '45678', '12345', '1357', '238'] }, v => { P.surviveMask = maskOf([...String((v as { v: string }).v)].map(Number)); });
      if (type === 'stages') set('states', GRID_RAND.states, v => { P.states = (v as { v: number }).v; });
    }
    if (type === 'smooth' && P.template === 'reaction') {
      set('feed', GRID_RAND.feed, v => { P.feed = (v as { v: number }).v; });
      set('kill', GRID_RAND.kill, v => { P.kill = (v as { v: number }).v; });
    }
    set('density', GRID_RAND.density, v => { P.density = (v as { v: number }).v; });
    set('on', { kind: 'colour' }, v => { const rgb = colourOf(String((v as { v: string }).v)); if (rgb) P[type === 'smooth' ? 'color3' : 'color1'] = rgb; });
  }
  return { params: P, errors: c.errors, hints: c.diagnostics.filter(d => d.severity === 'hint'), resolved, ...(seed !== null && (resolved.length || randomAll) ? { seed } : {}), headed };
}

// ── Printing ──────────────────────────────────────────────────────────────

/** Keys a recipe doesn't carry: one-off triggers. */
const RUNTIME_KEYS = new Set(['reset', 'paint']);

/** The params a recipe compares and prints (GRID_DEFAULTS' keys, minus the triggers). */
export const RECIPE_KEYS = Object.keys(GRID_DEFAULTS).filter(k => !RUNTIME_KEYS.has(k));

const same = (a: unknown, b: unknown): boolean => {
  if (typeof a === 'number' && typeof b === 'number') return roundN(a) === roundN(b);
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => same(x, b[i]));
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a as object).filter(k => (a as P)[k] !== undefined && (a as P)[k] !== null), kb = Object.keys(b as object).filter(k => (b as P)[k] !== undefined && (b as P)[k] !== null);
    return ka.length === kb.length && ka.every(k => same((a as P)[k], (b as P)[k]));
  }
  return a === b;
};

/** Names a clash with another word in the Do… bar (it reads them as an action or shape): `grid` goes before them. */
const CLASHING = new Set(['swirl', 'ripples', 'diamonds', 'spirals', 'maze', 'heat', 'crystal', 'gas', 'spots', 'worms', 'lava', 'frogs', 'sticks', 'coral', 'seeds', 'smooth', 'blocks', 'patterns', 'count', 'stages', 'majority', 'anneal']);

/** Whether a grid line needs its `grid` header outside the Grid Rules editor (§13 decision 6). */
export const gridNeedsHeader = (head: string) => CLASHING.has(head);

const cellText = (v: number, after: boolean) => (after && v === SAME ? '=' : !after && v === ANY ? '.' : !after && v === NOT_EMPTY ? '*' : v.toString(16));
const rows = (cells: number[], n: 2 | 3, after = false) => Array.from({ length: n }, (_, r) => cells.slice(r * n, r * n + n).map(v => cellText(v, after)).join('')).join('/');

export function printStencil(r: PatternRule): string {
  const parts = [`stencil ${rows(r.cells, 3)} → ${r.becomes}`];
  if (r.count) parts.push(`count=${r.count.state}:${r.count.min === r.count.max ? r.count.min : `${r.count.min}..${r.count.max}`}`);
  if (r.symmetry === 'rotate') parts.push('@turns');
  if (r.symmetry === 'all') parts.push('@turns-mirrors');
  if (r.off) parts.push('@off');
  return parts.join(' ');
}

export function printBlock(r: BlockRule): string {
  const parts = [`block ${rows(r.before, 2)} → ${rows(r.after, 2, true)}`];
  if (roundN(r.chance) !== 1) parts.push(`chance=${fmtNum(r.chance)}`);
  if (r.symmetry === 'mirror') parts.push('@mirror');
  if (r.symmetry === 'rotate') parts.push('@turns');
  if (r.off) parts.push('@off');
  return parts.join(' ');
}

const listText = (mask: number) => countsOf(mask, 24).join(',');

/**
 * The shortest grid text for `params`: a preset (or the rule type) and what differs from it, then
 * colours, the brush and the stencils or blocks. `header`: write `grid` first (always, never, or
 * only where the name clashes: the default). `pretty`: one clause a line, rules indented.
 */
export function printGrid(params: P, opts: { header?: 'always' | 'never' | 'clash'; pretty?: boolean } = {}): string {
  const P = { ...GRID_DEFAULTS, ...params };
  const type = (RULE_TYPE_WORDS as readonly string[]).includes(String(P.ruleType)) ? P.ruleType as GridRuleType : 'count';
  const key = matchingPreset(P);
  const preset = key ? GRID_PRESET_NAMES.find(p => p.ruleType === type && p.key === key) : undefined;
  const head = preset ? preset.slug : type;
  const base: P = { ...GRID_DEFAULTS, ...(preset ? presetParams(type, preset.preset) : gridTypeDefaults(type)) };
  const differs = (k: string) => !same(P[k], base[k]);
  const head1: string[] = [];
  const hdr = opts.header ?? 'clash';
  if (hdr === 'always' || (hdr === 'clash' && gridNeedsHeader(head))) head1.push('grid');
  head1.push(head);
  const parts: string[] = [];
  // A Smooth template word goes first, next to its type.
  if (differs('template') && type === 'smooth') parts.push(String(P.template));
  const nb = String(P.neighbourhood);
  if (type === 'count' || type === 'stages') {
    if (differs('neighbourhood')) parts.push(`neighbours=${NB_TEXT[nb] ?? nb}`);
    if (nb === 'radius') {
      if (differs('radius')) parts.push(`radius=${P.radius}`);
      if (differs('shape')) parts.push(`shape=${P.shape}`);
      if (differs('bornLo') || differs('bornHi')) parts.push(`born=${P.bornLo}..${P.bornHi}`);
      if (differs('surviveLo') || differs('surviveHi')) parts.push(`survive=${P.surviveLo}..${P.surviveHi}`);
    }
    if (differs('bornMask')) parts.push(`born=${listText(Number(P.bornMask))}`);
    if (differs('surviveMask')) parts.push(`survive=${listText(Number(P.surviveMask))}`);
    if (nb !== 'radius') {
      if (differs('radius')) parts.push(`radius=${P.radius}`);
      if (differs('shape')) parts.push(`shape=${P.shape}`);
      for (const [k, s] of [['bornLo', 'born'], ['surviveLo', 'survive']] as const) {
        const hi = k === 'bornLo' ? 'bornHi' : 'surviveHi';
        if (differs(k) || differs(hi)) parts.push(`${s}-range=${P[k]}..${P[hi]}`);
      }
    }
  } else {
    // Settings of the other types that a count rule keeps: still printed when changed.
    for (const k of ['neighbourhood', 'radius', 'shape', 'bornMask', 'surviveMask', 'bornLo', 'bornHi', 'surviveLo', 'surviveHi']) {
      if (!differs(k)) continue;
      if (k === 'neighbourhood') parts.push(`neighbours=${NB_TEXT[nb] ?? nb}`);
      else if (k === 'bornMask') parts.push(`born=${listText(Number(P.bornMask))}`);
      else if (k === 'surviveMask') parts.push(`survive=${listText(Number(P.surviveMask))}`);
      else if (k === 'radius' || k === 'shape') parts.push(`${k}=${P[k]}`);
      else if (k === 'bornLo' || k === 'bornHi') { if (!parts.some(p => p.startsWith('born-range='))) parts.push(`born-range=${P.bornLo}..${P.bornHi}`); }
      else if (!parts.some(p => p.startsWith('survive-range='))) parts.push(`survive-range=${P.surviveLo}..${P.surviveHi}`);
    }
  }
  if (differs('states')) parts.push(`states=${P.states}`);
  if (differs('template') && type !== 'smooth') parts.push(`template=${P.template}`);
  const NUM_PRINT: Array<[string, string]> = [['spread', 'spread'], ['decay', 'cooling'], ['waveSpeed', 'wave-speed'], ['damping', 'damping'], ['feed', 'feed'], ['kill', 'kill'], ['diffA', 'spread-a'], ['diffB', 'spread-b'],
    ['knobA', 'a'], ['knobB', 'b'], ['knobC', 'c'], ['knobD', 'd'], ['gain', 'gain']];
  if (differs('customU')) parts.push(`u={${P.customU}}`);
  if (differs('customV')) parts.push(`v={${P.customV}}`);
  for (const [param, k] of NUM_PRINT) if (differs(param)) parts.push(`${k}=${fmtNum(Number(P[param]))}`);
  if (differs('start')) parts.push(`start=${P.start}`);
  if (differs('density')) parts.push(`density=${fmtNum(Number(P.density))}`);
  if (differs('seed')) parts.push(`start-seed=${P.seed}`);
  if (differs('board')) parts.push(`board=${acrossOf(P.board)}`);
  if (differs('edges')) parts.push(String(P.edges));
  if (differs('rate')) parts.push(`speed=${fmtNum(Number(P.rate))}`);
  if (differs('steps')) parts.push(`steps=${P.steps}`);
  for (const [param, k] of [['afterglow', 'afterglow'], ['ageRate', 'age-rate'], ['ageFade', 'age-fade'], ['jitter', 'jitter']] as const) if (differs(param)) parts.push(`${k}=${fmtNum(Number(P[param]))}`);
  const clauses: string[] = [[...head1, ...parts].join(' ')];
  const brush: string[] = [];
  if (differs('brushRadius')) brush.push(`size=${fmtNum(Number(P.brushRadius))}`);
  if (differs('brushState')) brush.push(`state=${P.brushState}`);
  if (differs('brushFill')) brush.push(`fill=${fmtNum(Number(P.brushFill))}`);
  if (brush.length) clauses.push(['brush', ...brush].join(' '));
  const colours: string[] = [];
  const names = type === 'count' ? ['empty', 'on'] : type === 'stages' ? ['empty', 'on', 'dying'] : [];
  for (let i = 0; i < 8; i++) if (differs(`color${i}`)) colours.push(`${names[i] ?? `c${i}`}=${colourText(P[`color${i}`] as number[])}`);
  if (differs('glowColor')) colours.push(`glow=${colourText(P.glowColor as number[])}`);
  if (differs('oldColor')) colours.push(`old=${colourText(P.oldColor as number[])}`);
  if (colours.length) clauses.push(['colours', ...colours].join(' '));
  const ind = opts.pretty ? '  ' : '';
  if (differs('patterns')) clauses.push(...readPatterns(P.patterns).map(r => `${ind}${printStencil(r)}`));
  if (differs('blocks')) clauses.push(...readBlocks(P.blocks).map(r => `${ind}${printBlock(r)}`));
  return clauses.join(opts.pretty ? '\n' : ' · ');
}

// ── The registry's grid words ─────────────────────────────────────────────

const gridEntries = (): Entry[] => [
  ...RULE_TYPE_WORDS.map((w): Entry => ({ id: `grid:type:${w}`, kind: 'header', dialects: ['grid'], words: [w], params: [], summary: `A ${w} rule (the rule type), starting from its first preset.`, examples: [`grid ${w}`], stage: 'rule' })),
  ...GRID_PRESET_NAMES.map((p): Entry => ({ id: `grid:preset:${p.ruleType}:${p.key}`, kind: 'header', dialects: ['grid'], words: [p.slug, ...p.aliases], params: [], summary: `${p.preset.label} (${p.ruleType}): ${p.preset.hint}`, examples: [`grid ${p.slug}`], stage: 'rule' })),
  {
    id: 'grid:settings', kind: 'setting', dialects: ['grid'], words: ['settings'], summary: 'Settings on a grid rule.', examples: ['grid life board=480 walls speed=0.3'],
    params: [
      { key: 'born', type: 'list', hint: 'neighbour counts a cell is born on: 3,6 (or 34..45 with neighbours=radius)', rand: { kind: 'choice', options: ['3', '36', '3678'] } },
      { key: 'survive', type: 'list', hint: 'neighbour counts a live cell stays on: 2,3' },
      { key: 'neighbours', type: 'choice', options: ['moore', 'von-neumann', 'radius'], rand: GRID_RAND.neighbours },
      { key: 'radius', type: 'count', min: 1, max: MAX_RADIUS, rand: GRID_RAND.radius }, { key: 'shape', type: 'choice', options: ['box', 'circle'] },
      { key: 'states', type: 'count', min: 2, max: MAX_STATES, rand: GRID_RAND.states },
      { key: 'board', type: 'choice', options: ['960', '480', '240', '120', '60'], hint: 'cells across at 1080p', rand: GRID_RAND.board },
      { key: 'speed', type: 'number', hint: '0–1 a frame; above 1, steps a frame', rand: GRID_RAND.speed }, { key: 'steps', type: 'count', min: 1, max: MAX_STEPS, rand: GRID_RAND.steps },
      { key: 'start', type: 'choice', options: ['noise', 'empty', 'image', 'centre'], rand: GRID_RAND.start }, { key: 'density', type: 'number', min: 0, max: 1, rand: GRID_RAND.density },
      { key: 'start-seed', type: 'count' },
      { key: 'spread', type: 'number', rand: GRID_RAND.spread }, { key: 'cooling', type: 'number', rand: GRID_RAND.cooling }, { key: 'wave-speed', type: 'number', rand: GRID_RAND['wave-speed'] },
      { key: 'damping', type: 'number', rand: GRID_RAND.damping }, { key: 'feed', type: 'number', rand: GRID_RAND.feed }, { key: 'kill', type: 'number', rand: GRID_RAND.kill },
      { key: 'spread-a', type: 'number' }, { key: 'spread-b', type: 'number' }, { key: 'u', type: 'code' }, { key: 'v', type: 'code' }, { key: 'gain', type: 'number', rand: GRID_RAND.gain },
      { key: 'afterglow', type: 'number', min: 0, max: 1, rand: GRID_RAND.afterglow }, { key: 'age-rate', type: 'number' }, { key: 'age-fade', type: 'number', min: 0, max: 1 },
      { key: 'jitter', type: 'number', min: 0, max: 1, rand: GRID_RAND.jitter, hint: 'Blocks: shuffle the block rows a little each step, so falling grains don\'t band (0 classic, 1 most)' },
      { key: 'rule', type: 'name', hint: 'B/S notation: rule=B36/S23' },
    ],
    flags: ['wrap', 'walls', 'diffusion', 'waves', 'reaction', 'custom'],
  },
  { id: 'grid:stencil', kind: 'action', dialects: ['grid'], words: ['stencil'], params: [{ key: 'count', type: 'name', hint: 'state:min..max neighbours, like count=1:1..2' }], summary: 'A Patterns rule: 3×3 cells (. any, * not empty, a state) → the state the middle becomes. @turns / @turns-mirrors for every orientation.', examples: ['stencil .../.1./... → 2', 'stencil .../.3./... → 1 count=1:1..2'], stage: 'rule' },
  { id: 'grid:block', kind: 'action', dialects: ['grid'], words: ['block'], params: [{ key: 'chance', type: 'number', min: 0, max: 1, rand: { kind: 'num', lo: 0.3, hi: 1 } }], summary: 'A Blocks rule: 2×2 before → after (= unchanged). @mirror / @turns; chance= per block.', examples: ['block 11/00 → 00/11', 'block 10/*0 → 00/=1 @mirror chance=0.8'], stage: 'rule' },
  { id: 'grid:colours', kind: 'setting', dialects: ['grid'], words: ['colours', 'colors'], params: Object.keys(COLOUR_KEYS).map(k => ({ key: k, type: 'colour' as const, rand: { kind: 'colour' as const } })), summary: 'Colours of the states (empty=, on=, dying=, c0= … c7=), the afterglow (glow=) and old cells (old=).', examples: ['grid life · colours on=green empty=black'], stage: 'colour' },
  { id: 'grid:brush', kind: 'setting', dialects: ['grid'], words: ['brush'], params: [{ key: 'size', type: 'number', primary: true }, { key: 'state', type: 'count' }, { key: 'fill', type: 'number', min: 0, max: 1 }], summary: 'The mouse brush: its size, the state it paints and how thickly.', examples: ['grid life · brush size=5 fill=0.3'] },
];

registerEntries(gridEntries());
