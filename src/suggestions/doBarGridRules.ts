/**
 * doBarGridRules.ts — Grid Rules phrases in the Do… bar (docs/suggestions.md, docs/grid-rules.md):
 * "game of life", "brian's brain on a chunky board", "falling sand, fast", "heat in red on black".
 *
 * A phrase is a Grid Rules phrase when it names one of the node's presets and every other word is
 * glue, a grid word ("grid", "cells", "simulation"…), or one of the optional slots:
 *
 *  - board size: "fine / medium / coarse / chunky / huge (board)", "small / big cells",
 *    "board 120", "120 cells (across)";
 *  - speed: "slow", "fast", "speed 0.3" (0–1 is the node's Speed; above 1 is Steps a frame);
 *  - colours: the first colour is the live cells (Smooth: the high end), the second the empty
 *    ones ("green on black"); "… background" makes a colour the empty one.
 *
 * Preset words that are also Do… bar actions or shapes ("ripples", "swirl", "diamonds") need a
 * grid word or a longer name ("water ripples"), so "add ripples" on a shape still means rings.
 * The step adds one Grid Rules node: its Color goes to the Output when the graph is empty, else it
 * sits beside the selection, unwired.
 */
import type { GraphNode } from '../types/nodeGraph';
import { n } from '../store/graphBuilder';
import { graphOutput } from '../nodes/scene3dDefaults';
import { placeNear } from '../nodes/recipes';
import {
  BLOCK_PRESETS, PATTERN_PRESETS,
} from '../gridRules/stencils';
import {
  BOARD_SIZES, COUNT_PRESETS, LOOKS, MAX_STEPS, SMOOTH_PRESETS, STAGES_PRESETS, presetPatch, type GridPreset, type GridRuleType,
} from '../gridRules/spec';
import { ACTIONS, FILLER, SHAPES, colourOf, matchAt, numberOf, tokenize, type RGB } from '../lang/vocabulary';

export interface GridPhrase {
  /** `count:life`, `blocks:sand`… */
  id: string;
  ruleType: GridRuleType;
  preset: string;
  label: string;
  /** The words that name it; the first is the one shown. */
  words: string[];
}

/** Extra names for presets, beyond their labels. */
const EXTRA_WORDS: Record<string, string[]> = {
  'count:life': ['game of life', 'conways life', 'conway', 'conways game of life', 'life'],
  'count:highLife': ['highlife', 'high life'],
  'count:dayNight': ['day and night', 'day night', 'day & night'],
  'count:lifeWithoutDeath': ['life without death'],
  'count:caves': ['caves', 'cave', 'cave generator'],
  'count:bosco': ['bosco', 'boscos rule'],
  'count:majority': ['majority', 'majority vote'],
  'count:diamonds': ['diamonds'],
  'stages:briansBrain': ['brians brain', 'brian brain'],
  'smooth:heat': ['heat', 'heat diffusion', 'diffusion'],
  'smooth:ripples': ['water ripples', 'water', 'waves', 'ripples', 'water waves'],
  'smooth:mitosis': ['reaction diffusion', 'reaction-diffusion', 'gray scott', 'gray-scott', 'mitosis'],
  'smooth:coralRd': ['coral growth'],
  'smooth:maze': ['labyrinth'],
  'patterns:wireworld': ['wireworld', 'wire world'],
  'patterns:fallingDots': ['falling dots'],
  'patterns:crystal': ['crystal', 'frost'],
  'blocks:sand': ['falling sand', 'sand'],
  'blocks:gas': ['gas', 'hpp gas', 'hpp'],
};

const TABLES: Array<[GridRuleType, Record<string, GridPreset>]> = [
  ['count', COUNT_PRESETS], ['stages', STAGES_PRESETS], ['smooth', SMOOTH_PRESETS],
  ['patterns', PATTERN_PRESETS as Record<string, GridPreset>], ['blocks', BLOCK_PRESETS as Record<string, GridPreset>],
];

const nameWords = (label: string) => tokenize(label.replace(/\(.*\)/, '').replace(/&/g, 'and')).join(' ');

/** Every preset as a phrase. */
export const GRID_PHRASES: readonly GridPhrase[] = TABLES.flatMap(([ruleType, table]) => Object.entries(table).map(([preset, pr]) => {
  const id = `${ruleType}:${preset}`;
  const words = [...(EXTRA_WORDS[id] ?? []).map(w => tokenize(w).join(' ')), nameWords(pr.label)];
  return { id, ruleType, preset, label: pr.label, words: words.filter((w, i) => w && words.indexOf(w) === i) };
}));

/** Words that say "a grid simulation". */
const GRID_WORDS = new Set(['grid', 'grids', 'rules', 'rule', 'cellular', 'automaton', 'automata', 'ca', 'simulation', 'sim', 'cells', 'cell', 'board', 'node', 'preset', 'run', 'start', 'show', 'me', 'like', 'style', 'kind', 'type', 'sort', 'want', 'try', 'do', 'new', 'create', 'build', 'set', 'up', 'grid-rules']);
const BOARD_WORDS: Record<string, string> = { fine: '0.5', tiny: '0.5', small: '0.5', medium: '0.25', coarse: '0.125', chunky: '0.0625', big: '0.0625', large: '0.0625', huge: '0.03125', giant: '0.03125' };
const SPEED_WORDS: Record<string, number> = { slow: 0.2, slowly: 0.2, slower: 0.25, calm: 0.25, fast: 1, quick: 1, quickly: 1, faster: 1 };
const ACROSS = BOARD_SIZES.map(b => ({ value: b.value, across: Math.round(1920 * b.scale) }));

/** The board size nearest to `cells` across (at 1080p). */
const boardFor = (cells: number) => ACROSS.reduce((best, b) => (Math.abs(Math.log(b.across / cells)) < Math.abs(Math.log(best.across / cells)) ? b : best)).value;

export interface GridRulesRead {
  phrase: GridPhrase;
  /** Params to set over the preset: board, rate / steps, colours. */
  extra: Record<string, unknown>;
  reading: Array<{ text: string; as: string }>;
}

/** The phrase as a Grid Rules preset, or null when it isn't one. */
export function readGridRules(text: string): GridRulesRead | null {
  const tokens = tokenize(text.replace(/[’']/g, ''));
  if (!tokens.length) return null;
  // The longest preset name anywhere in the phrase.
  let hit: { phrase: GridPhrase; at: number; length: number } | null = null;
  for (let i = 0; i < tokens.length; i++) {
    for (const phrase of GRID_PHRASES) for (const w of phrase.words) {
      const parts = w.split(' ');
      if (parts.length <= (hit?.length ?? 0) || !parts.every((p, k) => tokens[i + k] === p)) continue;
      hit = { phrase, at: i, length: parts.length };
    }
  }
  if (!hit) return null;
  const rest = [...tokens.slice(0, hit.at), ...tokens.slice(hit.at + hit.length)];
  const said = tokens.slice(hit.at, hit.at + hit.length).join(' ');
  const gridWord = rest.some(t => GRID_WORDS.has(t) && !FILLER.has(t) && !['show', 'me', 'run', 'like', 'want', 'try', 'do', 'set', 'up', 'new'].includes(t));
  // A one-word name that is also an action or a shape ("ripples", "swirl", "diamonds") needs a grid word.
  if (hit.length === 1) {
    const act = matchAt([said], 0, ACTIONS), shape = matchAt([said], 0, SHAPES);
    if (((act && !act.fuzzy) || (shape && !shape.fuzzy)) && !gridWord) return null;
  }
  const reading: GridRulesRead['reading'] = [{ text: said, as: `do: grid rules (${hit.phrase.label})` }];
  const extra: Record<string, unknown> = {};
  const colours: Array<{ rgb: RGB; bg: boolean }> = [];
  const smooth = hit.phrase.ruleType === 'smooth';
  for (let i = 0; i < rest.length; i++) {
    const t = rest[i], next = rest[i + 1];
    const num = numberOf(t);
    if (t === 'very' && next && SPEED_WORDS[next] !== undefined) continue;
    if (BOARD_WORDS[t]) {
      extra.board = (next === 'cells' || next === 'cell') && (t === 'big' || t === 'large') ? BOARD_WORDS.chunky : BOARD_WORDS[t];
      reading.push({ text: next === 'board' || next === 'cells' || next === 'cell' || next === 'grid' ? `${t} ${next}` : t, as: `board ${extra.board}` });
      if (next === 'board' || next === 'cells' || next === 'cell' || next === 'grid') i++;
      continue;
    }
    if ((t === 'board' || t === 'size') && next && numberOf(next) !== null) {
      extra.board = boardFor(numberOf(next)!); reading.push({ text: `${t} ${next}`, as: `board ${extra.board}` }); i++; continue;
    }
    if (num !== null && (next === 'cells' || next === 'across' || next === 'wide') && num > 8) {
      extra.board = boardFor(num); reading.push({ text: `${t} ${next}`, as: `board ${extra.board}` }); i++;
      if (rest[i + 1] === 'across' || rest[i + 1] === 'wide') i++;
      continue;
    }
    if ((t === 'speed' || t === 'rate') && next && numberOf(next) !== null) {
      Object.assign(extra, speedParams(numberOf(next)!)); reading.push({ text: `${t} ${next}`, as: `speed ${numberOf(next)}` }); i++; continue;
    }
    if (num !== null && next === 'steps') {
      extra.steps = Math.max(1, Math.min(MAX_STEPS, Math.round(num))); extra.rate = 1; reading.push({ text: `${t} steps`, as: `steps ${extra.steps}` }); i++; continue;
    }
    if (SPEED_WORDS[t] !== undefined) {
      const very = rest[i - 1] === 'very';
      const v = SPEED_WORDS[t] * (very ? (SPEED_WORDS[t] < 1 ? 0.5 : 2) : 1);
      Object.assign(extra, speedParams(v)); reading.push({ text: very ? `very ${t}` : t, as: `speed ${v}` }); continue;
    }
    const rgb = colourOf(t);
    if (rgb) {
      const bg = next === 'background' || next === 'bg' || rest[i - 1] === 'on';
      colours.push({ rgb, bg }); reading.push({ text: t, as: bg ? 'colour: empty cells' : 'colour: live cells' });
      if (next === 'background' || next === 'bg') i++;
      continue;
    }
    if (FILLER.has(t) || GRID_WORDS.has(t) || t === 'very' || t === 'background' || t === 'colours' || t === 'colors' || t === 'colour' || t === 'color' || t === 'in' || t === 'on' || t === 'game') continue;
    // Anything else (a shape, an action, a word nothing knows): not a Grid Rules phrase.
    return null;
  }
  const live = colours.find(c => !c.bg) ?? null;
  const empty = colours.find(c => c.bg) ?? colours.find(c => c !== live && !c.bg) ?? null;
  if (live) {
    if (smooth) { extra.color3 = live.rgb; extra.color2 = live.rgb.map(v => v * 0.6); }
    else { extra.color1 = live.rgb; if (hit.phrase.ruleType === 'stages') extra.color2 = live.rgb.map(v => v * 0.55); }
  }
  if (empty) extra.color0 = empty.rgb;
  return { phrase: hit.phrase, extra, reading };
}

function speedParams(v: number): Record<string, unknown> {
  if (v <= 1) return { rate: Math.max(0.01, v) };
  return { rate: 1, steps: Math.max(1, Math.min(MAX_STEPS, Math.round(v))) };
}

/** Everything the new node is set to: the preset, the look its rule type brings, then the slots. */
export function gridRulesParams(read: GridRulesRead): Record<string, unknown> {
  const { phrase, extra } = read;
  const table = TABLES.find(([t]) => t === phrase.ruleType)![1];
  const pr = table[phrase.preset];
  const typeLook = phrase.ruleType === 'count' ? { ...LOOKS.count, brushState: 1 } : {};
  return { ruleType: phrase.ruleType, ...typeLook, ...presetPatch(pr), ...extra };
}

/** A one-line label for the step. */
export function gridRulesLabel(read: GridRulesRead): string {
  const bits: string[] = [];
  const e = read.extra;
  if (e.board) bits.push(`board ${BOARD_SIZES.find(b => b.value === e.board)?.label.split(' (')[0].toLowerCase() ?? e.board}`);
  if (e.steps) bits.push(`${e.steps} steps a frame`);
  else if (e.rate !== undefined) bits.push(`speed ${e.rate}`);
  if (e.color1 || e.color3 || e.color0) bits.push('colours');
  return `Add Grid Rules (${read.phrase.label})${bits.length ? ` · ${bits.join(', ')}` : ''}`;
}

/** Nothing on the level but an Output that shows nothing. */
export function graphIsEmpty(nodes: GraphNode[]): boolean {
  const out = graphOutput(nodes);
  return nodes.every(nd => nd.type === 'output') && !out?.inputs.color?.connection;
}

/**
 * Add the node (pure). Empty graph: wired to the Output (one is made at the top level when there
 * is none). Otherwise beside the first selected node, else below the graph; not wired.
 */
export function addGridRules(nodes: GraphNode[], params: Record<string, unknown>, selected: string[], nextId: () => string,
  opts: { topLevel?: boolean; heightOf: (nd: GraphNode) => number }): { nodes: GraphNode[]; added: string[]; id: string } {
  const id = nextId();
  const comment = 'Grid Rules: a board of cells and the rule that steps it. Open the editor (⊞) for the rule, the brush and the colours.\nWhy: added by the Do… bar.';
  if (graphIsEmpty(nodes)) {
    const out = graphOutput(nodes);
    const x = out ? out.position.x - 480 : 0, y = out ? out.position.y : 0;
    const node = n('gridRules', id, x, y, { ...params, __comment: comment });
    let cur = [...nodes, ...placeNear(nodes, [node], opts.heightOf)];
    const added = [id];
    if (out) cur = cur.map(nd => (nd.id === out.id ? { ...nd, inputs: { ...nd.inputs, color: { ...nd.inputs.color, connection: { nodeId: id, outputKey: 'color' } } } } : nd));
    else if (opts.topLevel !== false) {
      const o = n('output', nextId(), x + 480, y, { __comment: 'Output: what the canvas shows. Added by the Do… bar.' }, { color: [id, 'color'] });
      cur = [...cur, ...placeNear(cur, [o], opts.heightOf)];
      added.push(o.id);
    }
    return { nodes: cur, added, id };
  }
  const sel = selected.map(s => nodes.find(nd => nd.id === s)).find((nd): nd is GraphNode => !!nd);
  let x: number, y: number;
  if (sel) { x = sel.position.x + 420; y = sel.position.y; }
  else {
    x = Math.min(...nodes.map(nd => nd.position.x));
    y = Math.max(...nodes.map(nd => nd.position.y + opts.heightOf(nd))) + 120;
  }
  const node = n('gridRules', id, x, y, { ...params, __comment: comment });
  return { nodes: [...nodes, ...placeNear(nodes, [node], opts.heightOf)], added: [id], id };
}
