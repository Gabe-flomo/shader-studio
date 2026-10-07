/**
 * registry.ts — every word of the Playfield language, once (docs/playfield-language-plan.md §8.2).
 *
 * Each entry is a head word in one or more dialects: what kind of clause it starts, its words
 * (the first is canonical, the rest aliases), its settings with their defaults, which one may be
 * written bare (the primary), the range a `random` value is drawn from, a summary, examples and
 * the GLSL words the Code Explorer expands it to. The parser, printer, completion, signature
 * help, the in-app reference and the generated docs read it.
 *
 * It is built from what exists rather than written out again: the Do… bar's vocabulary
 * (vocabulary.ts) and moves (suggestions/moves.ts), the Scene Builder's shapes, warps and outputs
 * (sceneBuilder/spec.ts, output.ts), the edit verbs (commands.ts) and, from their phases, the
 * Grid Rules, Agent Rules and pass words (lang/dialects/*). A test checks that no word means two
 * things within one dialect.
 */
import { SHAPES as SCENE_SHAPES, WARPS, TONE_MODES, type ParamDef } from '../sceneBuilder/spec';
import { OUTPUTS, PALETTES } from '../sceneBuilder/output';
import { ACTIONS, SHAPES as WORD_SHAPES } from './vocabulary';
import { COMMAND_VERBS } from './commands';
import { moveById, type MoveArg } from '../suggestions/moves';
import { rangeFor, type RandSpec } from './random';
import { COLOUR_NAMES } from './colours';

export type Dialect = 'picture' | 'scene' | 'grid' | 'agents' | 'pass' | 'edit';
export type EntryKind = 'header' | 'maker' | 'step' | 'combine' | 'setting' | 'output' | 'verb' | 'condition' | 'action' | 'modifier';

export type ParamType = 'number' | 'count' | 'angle' | 'time' | 'vec2' | 'vec3' | 'colour' | 'choice' | 'list' | 'flag' | 'code' | 'name' | 'place' | 'ref' | 'range';

export interface ParamSpec {
  key: string;
  aliases?: string[];
  type: ParamType;
  label?: string;
  def?: unknown;
  min?: number;
  max?: number;
  /** May be written bare, first (`twist 0.5`, `blur 4`). */
  primary?: boolean;
  options?: readonly string[];
  /** What a `random` value is drawn from: an interesting range, not merely a legal one. */
  rand?: RandSpec;
  hint?: string;
}

export interface Entry {
  id: string;
  kind: EntryKind;
  dialects: Dialect[];
  /** The first is canonical; the rest are aliases. */
  words: string[];
  /** Aliases that still work with a hint: alias → hint. */
  deprecated?: Record<string, string>;
  params: ParamSpec[];
  flags?: string[];
  summary: string;
  hint?: string;
  examples: string[];
  /** GLSL words the Code Explorer finds it by. */
  expand?: string[];
  /** The flow stage it belongs to (structure hints), for "surprise me" and grouping. */
  stage?: 'space' | 'shape' | 'shape-it' | 'colour' | 'post' | 'camera' | 'objects' | 'combine' | 'lighting' | 'pass' | 'rule' | 'agents';
  /** The move it runs (picture steps), where it is one. */
  move?: string;
}

// ── Picture: shapes and steps ─────────────────────────────────────────────

/** A picture step's canonical head for each Do… bar action (§6.2). */
export const ACTION_HEAD: Readonly<Record<string, string>> = {
  glow: 'glow', rings: 'rings', outline: 'outline', onion: 'onion', round: 'round', blend: 'smooth-union', 'mask-from': 'mask',
  warp: 'warp', swirl: 'swirl', twist: 'twist', polar: 'polar', mirror: 'mirror', repeat: 'repeat', 'repeat-around': 'polar-repeat',
  'zoom-rotate': 'zoom-rotate', 'code-here': 'custom', 'mix-with': 'mix', palette: 'palette', 'tone-map': 'tone-map', grade: 'grade',
  brighten: 'brighten', grain: 'grain', 'blend-with': 'blend-mode', 'soft-edge': 'soft-edge', invert: 'invert', 'grow-mask': 'grow-mask',
  'mix-two': 'mix-two', 'blur-texture': 'blur', trails: 'fade', flow: 'flow', remap: 'remap',
};

/** The moves an action can be, by what it lands on (doBar.ts resolveAction); the first is the usual one. */
const ACTION_MOVES: Readonly<Record<string, string[]>> = {
  glow: ['glow', 'glow-colour', 'glow-texture'], outline: ['outline', 'outline-texture'], blend: ['blend', 'blend-pair'],
  'mix-with': ['mix-with', 'mix-pair'], palette: ['palette', 'colour-it'], 'soft-edge': ['soft-edge'], round: ['round'],
};

const STAGE_OF: Readonly<Record<string, Entry['stage']>> = {
  glow: 'shape-it', rings: 'shape-it', outline: 'shape-it', onion: 'shape-it', round: 'shape-it', blend: 'shape-it', 'mask-from': 'shape-it',
  warp: 'space', swirl: 'space', twist: 'space', polar: 'space', mirror: 'space', repeat: 'space', 'repeat-around': 'space', 'zoom-rotate': 'space',
  'code-here': 'shape-it', 'mix-with': 'colour', palette: 'colour', 'tone-map': 'post', grade: 'post', brighten: 'post', grain: 'post',
  'blend-with': 'colour', 'soft-edge': 'shape-it', invert: 'shape-it', 'grow-mask': 'shape-it', 'mix-two': 'colour', 'blur-texture': 'pass',
  trails: 'pass', flow: 'pass', remap: 'shape-it',
};

/**
 * Interesting ranges for the moves' settings (`move.arg`). Chosen by looking: a glow falloff
 * under 3 floods the picture, over 25 is a hairline; 4–20 rings read as rings.
 */
const MOVE_RAND: Readonly<Record<string, RandSpec>> = {
  'glow.falloff': { kind: 'num', lo: 4, hi: 20, log: true },
  'rings.count': { kind: 'num', lo: 4, hi: 18, int: true },
  'rings.speed': { kind: 'num', lo: 0, hi: 0.8 },
  'outline.width': { kind: 'num', lo: 0.004, hi: 0.03, log: true },
  'onion.thickness': { kind: 'num', lo: 0.006, hi: 0.05, log: true },
  'round.amount': { kind: 'num', lo: 0.01, hi: 0.08 },
  'blend.smoothness': { kind: 'num', lo: 0.05, hi: 0.3 },
  'blend.shape': { kind: 'choice', options: ['circle', 'box'] },
  'mask-from.softness': { kind: 'num', lo: 0.004, hi: 0.06, log: true },
  'warp.amount': { kind: 'num', lo: 0.2, hi: 1.2 },
  'swirl.amount': { kind: 'num', lo: 0.8, hi: 4 },
  'twist.amount': { kind: 'num', lo: 0.5, hi: 5 },
  'polar.twist': { kind: 'num', lo: 0, hi: 2 },
  'mirror.axis': { kind: 'choice', options: ['x', 'y', 'both'] },
  'repeat.count': { kind: 'num', lo: 2, hi: 7, int: true },
  'repeat-around.count': { kind: 'num', lo: 3, hi: 12, int: true },
  'zoom-rotate.zoom': { kind: 'num', lo: 0.6, hi: 2.5, log: true },
  'zoom-rotate.angle': { kind: 'num', lo: -1.2, hi: 1.2 },
  'mix-with.amount': { kind: 'num', lo: 0.2, hi: 0.7 },
  'glow-colour.amount': { kind: 'num', lo: 0.6, hi: 2 },
  'brighten.amount': { kind: 'num', lo: 0.05, hi: 0.35 },
  'grain.amount': { kind: 'num', lo: 0.02, hi: 0.12 },
  'blend-with.mode': { kind: 'choice', options: ['screen', 'overlay', 'multiply', 'add', 'softlight'] },
  'soft-edge.amount': { kind: 'num', lo: 0.05, hi: 0.4 },
  'grow-mask.amount': { kind: 'num', lo: -0.3, hi: 0.3 },
  'blur-texture.amount': { kind: 'num', lo: 2, hi: 16, log: true },
  'mix-pair.amount': { kind: 'num', lo: 0.2, hi: 0.8 },
  'blend-pair.smoothness': { kind: 'num', lo: 0.05, hi: 0.3 },
};

/** A setting key for a move argument: the canonical key people type (`r`, `falloff`, `width`, `color`…). */
export const ARG_KEY: Readonly<Record<string, string>> = { colour: 'color', thickness: 'thickness', smoothness: 'k', amount: 'amount' };

const argSpec = (moveId: string, a: MoveArg, primary: boolean): ParamSpec => ({
  key: ARG_KEY[a.name] ?? a.name,
  ...(ARG_KEY[a.name] && ARG_KEY[a.name] !== a.name ? { aliases: [a.name] } : {}),
  type: a.kind === 'colour' ? 'colour' : a.kind === 'count' ? 'count' : a.kind === 'word' ? 'choice' : 'number',
  label: a.label,
  def: a.default,
  ...(primary ? { primary } : {}),
  rand: MOVE_RAND[`${moveId}.${a.name}`] ?? (a.kind === 'colour' ? { kind: 'colour' } : a.kind === 'number' || a.kind === 'count' ? rangeFor(a.name, { def: a.default as number, int: a.kind === 'count' }) ?? undefined : undefined),
});

function pictureSteps(): Entry[] {
  return ACTIONS.map(a => {
    const head = ACTION_HEAD[a.id] ?? a.id;
    const moves = (ACTION_MOVES[a.id] ?? [a.id]).map(id => moveById(id)).filter(m => !!m);
    const params: ParamSpec[] = [];
    for (const m of moves) for (const arg of m!.args ?? []) {
      if (params.some(p => p.key === (ARG_KEY[arg.name] ?? arg.name))) continue;
      const primary = !params.some(p => p.primary) && (arg.kind === 'number' || arg.kind === 'count');
      params.push(argSpec(m!.id, arg, primary));
    }
    // Aliases: the bar's single words (phrases stay sugar), minus words that are other heads.
    const aliases = a.words.filter(w => !w.includes(' ') && w !== head && w !== 'noise');
    const words = [head, ...aliases];
    if (a.id === 'trails') words.splice(1, 0, 'trails');
    return {
      id: `picture:${a.id}`, kind: 'step', dialects: ['picture'], words: [...new Set(words)], params,
      summary: moves[0]?.label ?? a.id, hint: moves[0]?.why, examples: [], stage: STAGE_OF[a.id], move: moves[0]?.id,
    } satisfies Entry;
  });
}

/** Interesting sizes for a 2D shape's size setting (radius 0.1–0.35 fills the picture without filling it). */
const SHAPE_SIZE_RAND: RandSpec = { kind: 'num', lo: 0.1, hi: 0.35 };
export const PLACE_WORDS = ['middle', 'top', 'bottom', 'left', 'right', 'top-left', 'top-right', 'bottom-left', 'bottom-right'] as const;

function pictureShapes(): Entry[] {
  return WORD_SHAPES.filter(s => s.node2d).map(s => ({
    id: `picture:shape:${s.id}`, kind: 'maker' as const, dialects: ['picture' as Dialect], words: [s.words[0], ...s.words.slice(1).filter(w => !w.includes(' '))],
    params: [
      ...(s.node2d!.size ? [{ key: 'r', aliases: ['radius', 'size'], type: 'number' as const, primary: true, def: 0.25, rand: SHAPE_SIZE_RAND, label: 'Size' }] : []),
      { key: 'color', aliases: ['colour'], type: 'colour' as const, rand: { kind: 'colour' as const }, label: 'Colour' },
      { key: 'at', type: 'place' as const, def: 'middle', options: PLACE_WORDS, rand: { kind: 'choice' as const, options: ['middle', 'middle', 'top-left', 'top-right', 'bottom-left', 'bottom-right', 'left', 'right'] }, label: 'Where' },
    ],
    summary: `A ${s.words[0]} (a distance, with a UV in front).`, examples: [`${s.words[0]} · glow`], stage: 'shape' as const,
  }));
}

function pictureExtras(): Entry[] {
  return [
    {
      id: 'picture:colour-by', kind: 'output', dialects: ['picture', 'edit'], words: ['colour', 'color', 'palette'], params: [
        { key: 'by', type: 'choice', options: ['length', 'angle', 'x', 'y', 'time', 'noise'], primary: true, rand: { kind: 'choice', options: ['length', 'length', 'angle', 'x', 'y', 'time'] } },
        { key: 'palette', type: 'choice', options: PALETTES.map(p => p.key), rand: { kind: 'choice', options: PALETTES.map(p => p.key) } },
      ],
      summary: 'Colours it through a palette, by a driver: the length of the space, the angle, x, y, time, noise or a node.',
      examples: ['circle · glow · colour by length', 'noise · colour by it'], stage: 'colour',
    },
    {
      id: 'picture:repeat-around', kind: 'step', dialects: ['picture'], words: ['polar-repeat', 'repeat-around', 'petals', 'kaleidoscope'],
      params: [{ key: 'count', type: 'count', primary: true, def: 6, rand: MOVE_RAND['repeat-around.count'], label: 'Copies' }],
      summary: 'Repeat around: copies round the centre, like a flower (Angular Repeat).', examples: ['star · glow · polar-repeat 6'], stage: 'space', move: 'repeat-around',
    },
    {
      id: 'picture:noise', kind: 'maker', dialects: ['picture'], words: ['noise', 'fbm', 'clouds'], params: [{ key: 'scale', type: 'number', rand: { kind: 'num', lo: 1.5, hi: 6 } }],
      summary: 'Fractal noise (a number field).', examples: ['noise · colour by it'], stage: 'shape',
    },
    {
      id: 'picture:voronoi', kind: 'maker', dialects: ['picture'], words: ['voronoi', 'cells'], params: [],
      summary: 'Voronoi cells (a number field).', examples: ['voronoi · colour by it'], stage: 'shape',
    },
  ];
}

// ── Scene ─────────────────────────────────────────────────────────────────

const sceneParam = (p: ParamDef, primary: boolean): ParamSpec => {
  const vec = Array.isArray(p.def);
  const d = vec ? (p.def as number[])[0] : p.def as number;
  // Interesting: round the default, inside the legal range (half to one and a half times, or a third of the range).
  const lo = Math.max(p.min, d > 0 ? d * 0.5 : d - (p.max - p.min) / 6);
  const hi = Math.min(p.max, d > 0 ? d * 1.6 : d + (p.max - p.min) / 6);
  return {
    key: p.key, type: vec ? 'vec3' : p.deg ? 'angle' : 'number', label: p.label, def: p.def, min: p.min, max: p.max, hint: p.hint,
    ...(primary ? { primary } : {}), rand: vec ? { kind: 'vec', lo, hi, n: 3 } : { kind: 'num', lo, hi, log: lo > 0 && hi / lo > 4 },
  };
};

/** D8: the scene's noise warp is written `warp`; `noise` is the 2D node. */
export const SCENE_WARP_WORD: Readonly<Record<string, string>> = { noise: 'warp' };

function sceneEntries(): Entry[] {
  const out: Entry[] = [];
  out.push(
    { id: 'scene:surface', kind: 'header', dialects: ['scene'], words: ['surface', 'lit', 'solid'], params: [], summary: 'Render mode: lit surfaces with shadows.', examples: ['surface · sphere · plane y=-1'], stage: 'lighting' },
    { id: 'scene:volumetric', kind: 'header', dialects: ['scene'], words: ['volumetric', 'volume', 'glowing'], deprecated: { glow: 'glow as a render mode: write volumetric (glow is the glow step).' },
      params: [...['density', 'falloff', 'shell', 'exposure'].map(k => ({ key: k, type: 'number' as const })), { key: 'tint', type: 'colour' }], summary: 'Render mode: see-through glowing gas.', examples: ['volumetric · torus'], stage: 'lighting' },
    { id: 'scene:glass', kind: 'header', dialects: ['scene'], words: ['glass', 'glassy'], params: [{ key: 'ior', type: 'number', rand: { kind: 'num', lo: 1.2, hi: 1.7 } }, { key: 'dispersion', type: 'number' }, { key: 'tint', type: 'colour' }], summary: 'Render mode: refracting glass.', examples: ['glass · sphere glass'], stage: 'lighting' },
    { id: 'scene:gi', kind: 'header', dialects: ['scene'], words: ['gi', 'gi-lit', 'global'], params: ['bounce', 'metal', 'rough', 'spec'].map(k => ({ key: k, type: 'number' as const })), summary: 'Render mode: one bounce of light.', examples: ['gi · torus'], stage: 'lighting' },
  );
  for (const s of SCENE_SHAPES) {
    out.push({
      id: `scene:shape:${s.kind}`, kind: 'maker', dialects: ['scene'], words: [s.kind, ...s.aliases],
      params: [
        ...s.params.map((p, i) => sceneParam(p, i === 0)),
        { key: 'at', aliases: ['pos', 'position'], type: 'vec3', rand: { kind: 'vec', lo: -0.6, hi: 0.6, n: 3 } },
        { key: 'rot', aliases: ['rotate', 'turn'], type: 'vec3', rand: { kind: 'vec', lo: -45, hi: 45, n: 3 } },
        { key: 'color', aliases: ['colour', 'c'], type: 'colour', rand: { kind: 'colour' } },
        { key: 'shine', aliases: ['gloss'], type: 'number', rand: { kind: 'num', lo: 0, hi: 0.8 } },
        { key: 'name', type: 'name' },
      ],
      flags: ['glass'], summary: `${s.label}: ${s.blurb}`, examples: [`${s.kind}`], stage: 'objects',
    });
  }
  const ops: Array<[string, string[], string]> = [
    ['union', ['add', 'combine', 'group'], 'join: the nearer surface wins'],
    ['smooth-union', ['blend', 'merge', 'smooth'], 'melt together over k'],
    ['subtract', ['cut', 'difference', 'minus'], 'cut the rest out of the first'],
    ['smooth-subtract', ['smooth-cut'], 'a softened cut'],
    ['intersect', ['intersection', 'both'], 'only where all overlap'],
    ['smooth-intersect', [], 'a rounded overlap'],
  ];
  for (const [w, aliases, summary] of ops) {
    out.push({
      id: `combine:${w}`, kind: 'combine', dialects: ['scene', 'picture', 'edit'], words: [w, ...aliases.filter(a => a !== 'group')],
      ...(aliases.includes('group') ? { deprecated: { group: 'group( ) in a scene: write union( ) (group( ) groups nodes in an edit).' } } : {}),
      params: w.startsWith('smooth') ? [{ key: 'k', aliases: ['blend', 'smooth'], type: 'number', primary: true, def: 0.3, rand: { kind: 'num', lo: 0.1, hi: 0.5 } }, { key: 'name', type: 'name' }] : [{ key: 'name', type: 'name' }],
      summary, examples: [`${w}(sphere, box)`], stage: 'combine',
    });
  }
  for (const wd of WARPS) {
    const word = SCENE_WARP_WORD[wd.kind] ?? wd.kind;
    out.push({
      id: `scene:warp:${wd.kind}`, kind: 'step', dialects: ['scene'], words: [word, ...wd.aliases.filter(a => a !== word)],
      ...(word !== wd.kind ? { deprecated: { [wd.kind]: `${wd.kind} as a 3D warp: write ${word} (noise is the 2D noise node).` } } : {}),
      params: [
        ...(wd.axes ? [{ key: wd.axes.key, aliases: ['axis', 'axes'], type: 'choice' as const, options: wd.axes.kind === 'one' ? wd.axes.options : ['x', 'y', 'z', 'xy', 'xz', 'yz', 'xyz'] }] : []),
        ...wd.params.map((p, i) => sceneParam(p, i === 0)),
        ...(wd.select ? [{ key: wd.select.key, type: 'choice' as const, options: wd.select.options }] : []),
      ],
      summary: `${wd.label}: ${wd.blurb}`, examples: [`sphere · ${word}`], stage: 'objects',
    });
  }
  const settings: Array<[string, string[], string, ParamSpec[]]> = [
    ['sun', [], 'the sun\'s direction and colour', [{ key: 'dir', aliases: ['direction'], type: 'vec3', primary: true }, { key: 'color', type: 'colour' }]],
    ['sky', [], 'light from above', [{ key: 'color', type: 'colour', primary: true, rand: { kind: 'colour' } }]],
    ['bounce', [], 'light from below', [{ key: 'color', type: 'colour', primary: true }]],
    ['shadows', ['shadow'], 'soft shadows: hardness (8 soft … 32 hard) or off', [{ key: 'hardness', type: 'number', primary: true, rand: { kind: 'num', lo: 6, hi: 32 } }]],
    ['ao', ['occlusion'], 'ambient occlusion: step or off', [{ key: 'step', type: 'number', primary: true }]],
    ['fog', [], 'distance fades into fog', [{ key: 'density', type: 'number', primary: true, rand: { kind: 'num', lo: 0.05, hi: 0.5 } }, { key: 'color', type: 'colour' }]],
    ['background', ['bg'], 'the background colour or gradient', [{ key: 'top', type: 'colour', primary: true }, { key: 'bottom', type: 'colour' }]],
    ['tone', [], 'tone map', [{ key: 'mode', type: 'choice', options: TONE_MODES, primary: true }]],
    ['camera', ['cam'], 'the orbit camera', ['dist', 'angle', 'elev', 'orbit', 'zoom', 'flatten', 'x', 'y', 'z'].map((k, i) => ({ key: k, type: 'number' as const, ...(i === 0 ? { primary: true } : {}), ...(k === 'dist' ? { rand: { kind: 'num' as const, lo: 3, hi: 6 } } : k === 'orbit' ? { rand: { kind: 'num' as const, lo: 0, hi: 15 } } : k === 'elev' ? { rand: { kind: 'num' as const, lo: 5, hi: 35 } } : {}) }))],
    ['quality', [], 'the march\'s steps and limits', ['steps', 'dist', 'step', 'jitter'].map(k => ({ key: k, type: 'number' as const }))],
  ];
  for (const [w, aliases, summary, params] of settings) out.push({ id: `scene:${w}`, kind: 'setting', dialects: ['scene'], words: [w, ...aliases], params, summary, examples: [`sphere · ${w}`], stage: w === 'camera' ? 'camera' : 'lighting' });
  out.push({
    id: 'scene:output', kind: 'output', dialects: ['scene', 'edit'], words: ['output'], deprecated: { show: 'show in a recipe: write output.' },
    params: [{ key: 'show', type: 'choice', options: OUTPUTS.map(o => o.words[0]), primary: true }, { key: 'palette', type: 'choice', options: PALETTES.map(p => p.key) }],
    summary: 'What a 3D scene shows (depth, normal, hit…), or (in an edit) wires a node to the Output.', examples: ['sphere · output depth', 'output glow'], stage: 'post',
  });
  return out;
}

// ── Edit verbs ────────────────────────────────────────────────────────────

/** The canonical form of each edit verb (§3.9), with "the" left out of its slots (§13 decision 2). */
export const EDIT_SYNTAX: Readonly<Record<string, string[]>> = {
  create: ['create <maker>'],
  connect: ['connect <ref> → <ref>[.<socket>]'],
  disconnect: ['disconnect <ref> [from <ref>]', 'disconnect <ref>.<socket>'],
  reconnect: ['reconnect <ref> → <ref>[.<socket>]'],
  insert: ['insert <maker> between <ref> and <ref>', 'insert <maker> after <ref>', 'insert <maker> before <ref>'],
  combine: ['<ref> * <ref|number>', '<ref> + <ref>', '<ref> - <ref>', 'mix(<ref>, <ref>) by=<n>', 'screen(<ref>, <ref>)', 'union(<ref>, <ref>)'],
  output: ['output [<ref>]'],
  replace: ['switch <ref> to <type>'],
  delete: ['delete <ref>'],
  rename: ['rename <ref> "<name>"'],
  duplicate: ['duplicate <ref>'],
  set: ['set <ref> <key>=<value>…'],
  adjust: ['set <ref> <key>*=<factor>', 'set <ref> <key>+=<amount>'],
  group: ['group(<ref>, …) [name="<name>"]'],
  select: ['select <ref>'],
  colour: ['colour by <driver> [palette=<name>]'],
};

/** The canonical head of each verb (the bar's words stay sugar). */
export const VERB_HEAD: Readonly<Record<string, string>> = {
  create: 'create', connect: 'connect', disconnect: 'disconnect', reconnect: 'reconnect', insert: 'insert', combine: '', output: 'output',
  replace: 'switch', delete: 'delete', rename: 'rename', duplicate: 'duplicate', set: 'set', adjust: 'set', group: 'group', select: 'select', colour: 'colour',
};

function editEntries(): Entry[] {
  return COMMAND_VERBS.filter(v => VERB_HEAD[v.id] && v.id !== 'adjust' && v.id !== 'colour' && v.id !== 'output').map(v => ({
    id: `edit:${v.id}`, kind: 'verb' as const, dialects: ['edit' as Dialect], words: [VERB_HEAD[v.id], ...v.words.filter(w => !w.includes(' ') && w !== VERB_HEAD[v.id] && !['add', 'make', 'change', 'turn', 'times', 'show', 'copy', 'name', 'call', 'label', 'find', 'pick', 'wrap', 'put', 'draw', 'new', 'place', 'drop', 'feed', 'attach', 'link', 'plug', 'swap', 'replace'].includes(w))],
    params: [], summary: v.summary, hint: EDIT_SYNTAX[v.id]?.join(' · '), examples: [],
  }));
}

/** Colour combines (§3.5): mix, screen, overlay of two references. */
function colourCombines(): Entry[] {
  return [
    { id: 'combine:mix', kind: 'combine', dialects: ['picture', 'edit'], words: ['mix', 'blend-colours'], params: [{ key: 'by', aliases: ['amount', 't'], type: 'number', primary: true, def: 0.5, rand: { kind: 'num', lo: 0.2, hi: 0.8 } }], summary: 'Mixes two colours (OkLab Mix).', examples: ['mix(palette, glow) by=0.3'], stage: 'colour' },
    { id: 'combine:screen', kind: 'combine', dialects: ['picture', 'edit'], words: ['screen'], params: [], summary: 'Screen blend: the second over the first, only brightening.', examples: ['screen(palette, glow)'], stage: 'colour' },
    { id: 'combine:overlay', kind: 'combine', dialects: ['picture', 'edit'], words: ['overlay'], params: [], summary: 'Overlay blend.', examples: ['overlay(palette, glow)'], stage: 'colour' },
    { id: 'edit:group', kind: 'combine', dialects: ['edit'], words: ['group', 'bundle'], params: [{ key: 'name', type: 'name', primary: true }], summary: 'Puts nodes into a group (as Group selection does). Goes last.', examples: ['group(circle, glow) name="Neon"'] },
  ];
}

/** Clause words a dialect group reads together: the Do… bar reads picture and edit lines. */
const GROUPS: Dialect[][] = [['picture', 'edit'], ['scene'], ['grid'], ['agents'], ['pass']];
/** Calls (`op(`) and plain heads are told apart by the bracket (§3.9 rule 1), so they may share words. */
const callClass = (e: Entry) => (e.kind === 'combine' ? 'call' : 'head');

/**
 * Within a dialect group, an alias that is another entry's canonical word, or an earlier entry's
 * alias, is dropped from the later entry: a word means one thing (the test checks canonical
 * words never clash).
 */
function dedupe(entries: Entry[]): Entry[] {
  const out = entries.map(e => ({ ...e, words: [...e.words] }));
  for (const g of GROUPS) {
    for (const cls of ['call', 'head']) {
      const inGroup = out.filter(e => callClass(e) === cls && e.dialects.some(d => g.includes(d)));
      const canonical = new Map(inGroup.map(e => [e.words[0], e]));
      const claimed = new Map<string, Entry>();
      for (const e of inGroup) {
        e.words = e.words.filter((w, i) => {
          if (i === 0) return true;
          const c = canonical.get(w);
          if (c && c !== e) return false;
          const prev = claimed.get(w);
          if (prev && prev !== e) return false;
          claimed.set(w, e);
          return true;
        });
      }
    }
  }
  return out;
}

// ── The registry ──────────────────────────────────────────────────────────

const extra: Entry[] = [];

/** Dialect modules add their words here (grid, agents, pass), once, at import. */
export function registerEntries(entries: Entry[]) {
  for (const e of entries) if (!extra.some(x => x.id === e.id)) extra.push(e);
}

let cache: Entry[] | null = null;
let cacheLen = -1;

/** Every entry. */
export function registry(): Entry[] {
  if (!cache || cacheLen !== extra.length) {
    cache = dedupe([...pictureShapes(), ...pictureExtras(), ...pictureSteps(), ...sceneEntries(), ...colourCombines(), ...editEntries(), ...extra]);
    cacheLen = extra.length;
  }
  return cache;
}

/** Entries of one dialect. */
export const entriesFor = (d: Dialect) => registry().filter(e => e.dialects.includes(d));

export interface HeadHit { entry: Entry; word: string; how: 'exact' | 'alias' | 'deprecated' | 'plural'; hint?: string }

/** The entry a head word names in a dialect: exact, then alias, then deprecated alias (with its hint), then a plural. */
export function lookupHead(word: string, d: Dialect, kinds?: EntryKind[]): HeadHit | null {
  const w = word.toLowerCase();
  const list = entriesFor(d).filter(e => !kinds || kinds.includes(e.kind));
  for (const e of list) if (e.words[0] === w) return { entry: e, word: w, how: 'exact' };
  for (const e of list) if (e.words.includes(w)) return { entry: e, word: w, how: 'alias' };
  for (const e of list) if (e.deprecated?.[w]) return { entry: e, word: w, how: 'deprecated', hint: e.deprecated[w] };
  const sing = w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : null;
  if (sing) for (const e of list) if (e.words.includes(sing)) return { entry: e, word: sing, how: 'plural' };
  return null;
}

/** A setting of an entry by key or alias. */
export const paramOf = (e: Entry, key: string): ParamSpec | undefined => {
  const k = key.toLowerCase();
  return e.params.find(p => p.key === key) ?? e.params.find(p => p.key.toLowerCase() === k || p.aliases?.includes(k));
};

/** Every head word of a dialect (for "did you mean"). */
export const headWords = (d: Dialect) => entriesFor(d).flatMap(e => e.words);

/** Colour words (the one table), for completion and the reference. */
export const colourWords = () => COLOUR_NAMES;
