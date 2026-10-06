/**
 * doBar.ts — the Do… bar's phrase language (docs/suggestions.md): typed phrases → moves, with no
 * AI. "circle in the middle with a glow, falloff 8", "make it repeat 6 times around", "twist the
 * space 0.5", "tone map it", "mix these colours".
 *
 * A fixed vocabulary (lang/vocabulary.ts, shared with the 3D Scene Builder): shapes, actions,
 * targets, parameter names, colours, numbers and places, with synonyms and small typos. Parsing
 * is one left-to-right pass:
 *
 *  - a SHAPE starts a new subject ("circle", "two boxes" is one box: counts are for actions);
 *    a place ("in the middle", "top left") and a bare size right after it go on the shape;
 *  - an ACTION is a step on the current subject: the last shape named, else what a target word
 *    says ("it" / "this": the selection, "these": the two selected nodes, "the space": the
 *    subject's UV input, "the picture": what the Output shows), else the selection, else the
 *    Output's picture;
 *  - a parameter word with a number fills that slot ("falloff 8", "6 times", "by 0.5"); a colour
 *    fills the colour slot; a bare number fills the action's first number slot.
 *
 * The action is resolved against what the subject carries (kinds.ts): "glow" on a distance is
 * SDF Glow, on a colour Bloom, on a texture Glow (texture); a colour move on a shape goes to the
 * colour it ends up as; a space move goes in front of a shape's UV. Pure: `parseDo` makes a plan
 * the bar previews, `runDoPlan` applies it (the store wraps it in one undo step).
 */
import type { GraphNode } from '../types/nodeGraph';
import { n } from '../store/graphBuilder';
import { graphOutput } from '../nodes/scene3dDefaults';
import { placeNear } from '../nodes/recipes';
import { cardHeight } from '../store/agentSetup';
import { getNodeDefinition } from '../nodes/definitions';
import {
  ACTIONS, FILLER, PARAMS, PLACES, SHAPES, TARGETS, colourOf, matchAt, numberOf, tokenize, type ActionWord, type RGB, type ShapeWord,
} from '../lang/vocabulary';
import { moveById, exprBlock, labelOf, type Move } from './moves';
import { applyMove } from './applyMove';
import { outputKinds, spaceInputs, type ValueKind } from './kinds';
import { matchTaught, phraseLabel, taughtMoves, type TaughtMove } from './taught';
import { freshIds } from '../store/agentSetup';
import { addGridRules, gridRulesLabel, gridRulesParams, readGridRules } from './doBarGridRules';

// ── Plans ───────────────────────────────────────────────────────────────────

/** A node the plan refers to: a real id, or `$k` for the shape step k makes. */
export type NodeRef = string;

export type DoStep =
  | { kind: 'shape'; shape: string; type: string; params: Record<string, unknown>; place?: [number, number]; label: string }
  | { kind: 'chain'; taughtId: string; args: Record<string, unknown>; label: string }
  | { kind: 'move'; moveId: string; node: NodeRef; key: string; side: 'in' | 'out'; args: Record<string, unknown>; label: string }
  /** A Grid Rules node with a preset (doBarGridRules.ts): "game of life", "falling sand, fast". */
  | { kind: 'gridRules'; preset: string; params: Record<string, unknown>; label: string; /** The node to sit beside (the selection), when the graph isn't empty. */ beside?: string };

export interface DoPlan {
  steps: DoStep[];
  /** How each word was read, for the preview ("circle → shape", "8 → falloff"). */
  reading: Array<{ text: string; as: string }>;
  /** Words nothing matched. */
  unknown: string[];
  /** Why the phrase can't run (nothing to apply it to…). */
  problem?: string;
  /** Not a build: "is this typical?" (the connection check) or "teach …" (teach the selection). */
  intent?: 'check' | 'teach';
}

const CHECK_RE = /^(is (this|that|it) (typical|normal|common|usual)|how (common|typical|usual|often)|typical\??$|check (this|that|it|the wire|these)|is this (a )?common)/;
const TEACH_RE = /^teach\b/;

export interface DoContext {
  /** The level being edited. */
  nodes: GraphNode[];
  /** Selected node ids, in order. */
  selected: string[];
}

// ── Reading the words ───────────────────────────────────────────────────────

type Item =
  | { t: 'shape'; shape: ShapeWord; text: string; fuzzy?: boolean }
  | { t: 'action'; action: ActionWord; id: string; text: string; fuzzy?: boolean }
  | { t: 'target'; target: string; text: string }
  | { t: 'place'; at: [number, number]; text: string }
  | { t: 'slot'; slot: string; value: number; text: string }
  | { t: 'number'; value: number; text: string }
  | { t: 'colour'; rgb: RGB; text: string };

const SLOT_ENTRIES = Object.entries(PARAMS).map(([slot, words]) => ({ slot, words }));
const TARGET_ENTRIES = Object.entries(TARGETS).map(([target, words]) => ({ target, words }));
const PLACE_ENTRIES = Object.entries(PLACES).map(([key, at]) => ({ at, words: [key] }));
/** Words after a number that make it a count ("6 times", "8 rings"). */
const COUNT_WORDS = new Set(PARAMS.count);

/** Actions that take a shape as their argument ("blend it with a box"): the shape is a word, not a new shape. */
type ActionItem = Extract<Item, { t: 'action' }>;
const SHAPE_ARG_ACTIONS = new Set(['blend']);
const SLOT_WORDS = new Set(Object.values(PARAMS).flat());

function read(tokens: string[]): { items: Item[]; unknown: string[] } {
  const items: Item[] = [];
  const unknown: string[] = [];
  let lastAction = null as ActionItem | null;
  let lastActionEnd = -1;
  for (let i = 0; i < tokens.length;) {
    const tok = tokens[i];
    // A variant word of the last action ("repeat … around") is used up by it.
    if (lastAction?.action.variants?.some(v => v.words.includes(tok))) { i++; continue; }
    // "in the middle", "at the top left"
    const place = matchAt(tokens, i, PLACE_ENTRIES);
    if (place && !place.fuzzy) { items.push({ t: 'place', at: place.entry.at, text: tokens.slice(i, i + place.length).join(' ') }); i += place.length; continue; }
    // A number: a count ("6 times"), a slot after it ("0.2 radius"), or bare.
    const num = numberOf(tok);
    if (num !== null && !(tok === 'a' || tok === 'an')) {
      const next = tokens[i + 1];
      if (next && COUNT_WORDS.has(next)) {
        // "8 rings" is also the action (it comes first, so the count is its).
        const act = matchAt(tokens, i + 1, ACTIONS);
        if (act && !act.fuzzy && next !== 'times' && next !== 'x' && lastAction?.id !== act.entry.id) {
          const a: ActionItem = { t: 'action', action: act.entry, id: act.entry.id, text: next };
          items.push(a); lastAction = a; lastActionEnd = i + 2;
        }
        items.push({ t: 'slot', slot: 'count', value: num, text: `${tok} ${next}` });
        i += 2; continue;
      }
      // "45 degrees", "0.2 radius": the slot word after the number.
      const after = next ? SLOT_ENTRIES.find(e => e.words.includes(next)) : undefined;
      if (after) { items.push({ t: 'slot', slot: after.slot, value: num, text: `${tok} ${next}` }); i += 2; continue; }
      items.push({ t: 'number', value: num, text: tok });
      i++; continue;
    }
    // "falloff 8", "by 0.5", "radius = 0.2"
    const slot = matchAt(tokens, i, SLOT_ENTRIES);
    // A slot word that is also an action ("zoom 2") opens the action too.
    const slotAction = slot && !slot.fuzzy ? matchAt(tokens, i, ACTIONS) : null;
    if (slotAction && !slotAction.fuzzy && slotAction.length === slot!.length && lastAction?.id !== slotAction.entry.id && numberOf(tokens[i + slot!.length] ?? '') !== null) {
      const a: ActionItem = { t: 'action', action: slotAction.entry, id: slotAction.entry.id, text: tok };
      items.push(a); lastAction = a; lastActionEnd = i + 1;
    }
    if (slot && !slot.fuzzy) {
      const after = tokens.slice(i + slot.length, i + slot.length + 2).filter(t => t !== 'of' && t !== 'to' && t !== '=' && t !== 'is');
      const v = after.length ? numberOf(after[0]) : null;
      if (v !== null) {
        const used = tokens.indexOf(after[0], i + slot.length) - i + 1;
        items.push({ t: 'slot', slot: slot.entry.slot, value: v, text: tokens.slice(i, i + used).join(' ') });
        i += used; continue;
      }
    }
    const target = matchAt(tokens, i, TARGET_ENTRIES);
    if (target && !target.fuzzy && (target.length > 1 || !FILLER.has(tok) || tok === 'it')) {
      items.push({ t: 'target', target: target.entry.target, text: tokens.slice(i, i + target.length).join(' ') });
      i += target.length; continue;
    }
    // Glue words are never fuzzy-matched into shapes or actions ("around" is not "ground").
    const glue = FILLER.has(tok) || tok === 'around' || tok === 'x' || tok === '=' || tok === 'times' || SLOT_WORDS.has(tok);
    const action = glue && !ACTIONS.some(a => a.words.includes(tok)) ? null : matchAt(tokens, i, ACTIONS);
    const shape = glue && !SHAPES.some(sh => sh.words.includes(tok)) ? null : matchAt(tokens, i, SHAPES);
    // An exact match wins over a fuzzy one; then the longer phrase; then the word as typed
    // ("rings" is the action, "ring" the shape); else the shape.
    const said = (m: { length: number; word: string }) => tokens.slice(i, i + m.length).join(' ') === m.word;
    const pick = action && shape
      ? (action.fuzzy !== shape.fuzzy ? (action.fuzzy ? 'shape' : 'action')
        : action.length !== shape.length ? (action.length > shape.length ? 'action' : 'shape')
          : said(action) && !said(shape) ? 'action' : 'shape')
      : action ? 'action' : shape ? 'shape' : null;
    // A colour word beats a typo of something else ("blue" is not "blur").
    const rgbNow = colourOf(tok);
    if (rgbNow && !(action && !action.fuzzy) && !(shape && !shape.fuzzy)) { items.push({ t: 'colour', rgb: rgbNow, text: tok }); i++; continue; }
    if (pick === 'action' && action) {
      // Two actions side by side ("screen blend") are one: the first.
      if (lastAction && lastActionEnd === i) { i += action.length; lastActionEnd = i; continue; }
      // A variant later in the phrase ("repeat … around").
      const rest = tokens.slice(i + action.length);
      const variant = action.entry.variants?.find(v => v.words.some(w => rest.includes(w)));
      const a: ActionItem = { t: 'action', action: action.entry, id: variant?.id ?? action.entry.id, text: tokens.slice(i, i + action.length).join(' '), fuzzy: action.fuzzy };
      items.push(a); lastAction = a;
      i += action.length; lastActionEnd = i; continue;
    }
    if (pick === 'shape' && shape) {
      // "blend it with a box": the box is the blend's other shape.
      if (lastAction && SHAPE_ARG_ACTIONS.has(lastAction.action.id) && !items.slice(items.indexOf(lastAction) + 1).some(x => x.t === 'shape' || x.t === 'action')) { i += shape.length; continue; }
      items.push({ t: 'shape', shape: shape.entry, text: tokens.slice(i, i + shape.length).join(' '), fuzzy: shape.fuzzy }); i += shape.length; continue;
    }
    const rgb = colourOf(tok);
    if (rgb) { items.push({ t: 'colour', rgb, text: tok }); i++; continue; }
    // Variant words already used ("around"), filler and punctuation.
    if (FILLER.has(tok) || ACTIONS.some(a => a.variants?.some(v => v.words.includes(tok))) || tok === 'around' || tok === 'x' || tok === '=') { i++; continue; }
    unknown.push(tok);
    i++;
  }
  return { items, unknown };
}

// ── Resolving against the graph ─────────────────────────────────────────────

/** The kind the subject carries (its main output), or null for a shape still to be made. */
function kindOf(node: GraphNode | undefined): ValueKind | null {
  return node ? outputKinds(node)[0]?.kind ?? null : null;
}

/** The first node downstream of `id` (BFS) with a colour output, else what the Output shows. */
function colourFrom(nodes: GraphNode[], id: string): GraphNode | undefined {
  const byId = new Map(nodes.map(nd => [nd.id, nd]));
  const seen = new Set<string>([id]);
  const queue = [id];
  while (queue.length) {
    const cur = queue.shift()!;
    const node = byId.get(cur);
    if (node && cur !== id && outputKinds(node).some(o => o.kind === 'colour')) return node;
    for (const nd of nodes) {
      if (seen.has(nd.id) || nd.type === 'output') continue;
      if (Object.values(nd.inputs).some(i => i.connection?.nodeId === cur)) { seen.add(nd.id); queue.push(nd.id); }
    }
  }
  const shown = graphOutput(nodes)?.inputs.color?.connection?.nodeId;
  return shown ? byId.get(shown) : undefined;
}

/** Which move an action is, for a subject of this kind, and where it goes. */
function resolveAction(actionId: string, subject: GraphNode | undefined, subjectIsNewShape: boolean, pair: GraphNode | undefined):
  { moveId: string; node?: GraphNode; key?: string; side?: 'in' | 'out'; colourTarget?: boolean; spaceTarget?: boolean; problem?: string } {
  const has = (k: ValueKind) => !!subject && outputKinds(subject).some(o => o.kind === k);
  // A node with a texture output (a Pass) takes the texture moves; else its main kind.
  const kind: ValueKind | null = subjectIsNewShape ? 'distance'
    : has('texture') && ['glow', 'outline', 'blur-texture', 'flow', 'trails'].includes(actionId) ? 'texture' : kindOf(subject);
  const SPACE_ACTIONS = new Set(['warp', 'swirl', 'twist', 'polar', 'mirror', 'repeat', 'repeat-around', 'zoom-rotate']);
  const COLOUR_ACTIONS = new Set(['mix-with', 'palette', 'tone-map', 'grade', 'brighten', 'grain', 'blend-with']);
  if (pair) {
    const pk = kindOf(pair);
    if ((actionId === 'blend' || actionId === 'mix-with' || actionId === 'soft-edge') && kind === 'distance' && pk === 'distance') return { moveId: 'blend-pair' };
    if ((actionId === 'mix-with' || actionId === 'blend' || actionId === 'blend-with') && kind === 'colour' && pk === 'colour') return { moveId: 'mix-pair' };
  }
  if (SPACE_ACTIONS.has(actionId)) return { moveId: actionId, spaceTarget: true };
  if (actionId === 'glow') {
    if (kind === 'distance') return { moveId: 'glow' };
    if (kind === 'texture') return { moveId: 'glow-texture' };
    return { moveId: 'glow-colour', colourTarget: kind !== 'colour' };
  }
  if (actionId === 'outline') {
    if (kind === 'texture') return { moveId: 'outline-texture' };
    if (kind === 'distance') return { moveId: 'outline' };
    return { moveId: 'outline', problem: 'Outline needs a shape (a distance) or a texture.' };
  }
  if (actionId === 'blend') {
    if (kind === 'distance') return { moveId: 'blend' };
    if (kind === 'mask' || kind === 'scalar') return { moveId: 'soft-edge' };
    return { moveId: 'blend-with', colourTarget: kind !== 'colour' };
  }
  if (actionId === 'soft-edge') {
    if (kind === 'distance') return { moveId: 'mask-from' };
    return { moveId: 'soft-edge' };
  }
  if (actionId === 'blur-texture') return kind === 'texture' ? { moveId: 'blur-texture' } : { moveId: 'blur-texture', problem: 'Blur works on a texture: select a Pass (it draws the picture into one).' };
  if (actionId === 'trails') return { moveId: 'trails' };
  if (actionId === 'flow') return kind === 'texture' ? { moveId: 'flow' } : { moveId: 'flow', problem: 'Flow works on a texture: select a Pass.' };
  if (actionId === 'palette' && (kind === 'scalar' || kind === 'mask')) return { moveId: 'colour-it' };
  if (COLOUR_ACTIONS.has(actionId)) return { moveId: actionId, colourTarget: kind !== 'colour' };
  if (actionId === 'invert' || actionId === 'grow-mask' || actionId === 'mix-two') {
    if (kind === 'mask' || kind === 'scalar') return { moveId: actionId };
    if (actionId === 'invert' && kind === 'colour') return { moveId: 'invert', problem: 'Invert here works on a mask; for a colour, try the Invert node.' };
  }
  if (actionId === 'round' && kind !== 'distance' && (kind === 'mask')) return { moveId: 'grow-mask' };
  return { moveId: actionId };
}

/** Values for a move's args from what was read: named slots, colours, then bare numbers in order. */
function fillArgs(move: Move, slots: Array<{ slot: string; value: number }>, numbers: number[], colours: RGB[], words: string[]): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  const specs = move.args ?? [];
  const SLOT_FOR: Record<string, string[]> = {
    falloff: ['falloff'], count: ['count'], amount: ['amount', 'smoothness', 'thickness', 'falloff', 'count'], thickness: ['thickness', 'width', 'amount'],
    smoothness: ['smoothness', 'amount'], radius: ['amount', 'thickness'], speed: ['speed'], angle: ['angle'], zoom: ['zoom'],
  };
  for (const s of slots) {
    const name = (SLOT_FOR[s.slot] ?? [s.slot]).find(nm => specs.some(a => a.name === nm) && !(nm in args));
    if (name) args[name] = s.slot === 'angle' && words.some(w => w === 'degrees' || w === 'deg') ? s.value * Math.PI / 180 : s.value;
  }
  const colourArg = specs.find(a => a.kind === 'colour');
  if (colourArg && colours.length) args[colourArg.name] = colours[0];
  const free = specs.filter(a => (a.kind === 'number' || a.kind === 'count') && !(a.name in args));
  numbers.forEach((v, i) => { if (free[i]) args[free[i].name] = v; });
  // Word args: "blend with a box", "mirror both ways", "screen" mode.
  for (const a of specs.filter(x => x.kind === 'word' && !(x.name in args))) {
    if (a.name === 'shape') { const sh = words.find(w => /box|square|circle/.test(w)); if (sh) args.shape = sh; }
    if (a.name === 'axis') { if (words.includes('both')) args.axis = 'both'; else if (words.some(w => w === 'vertical' || w === 'vertically' || w === 'y')) args.axis = 'y'; }
    if (a.name === 'mode') { const m = words.find(w => ['screen', 'multiply', 'overlay', 'add', 'difference', 'softlight'].includes(w)); if (m) args.mode = m; }
  }
  return args;
}

const describeArgs = (move: Move, args: Record<string, unknown>) => (move.args ?? [])
  .filter(a => a.name in args)
  .map(a => {
    const v = args[a.name];
    return `${a.label.toLowerCase()} ${Array.isArray(v) ? `rgb(${v.map(x => Math.round(Number(x) * 255)).join(', ')})` : String(Math.round(Number(v) * 1000) / 1000)}`;
  }).join(', ');

/** Read a phrase into a plan. */
export function parseDo(text: string, ctx: DoContext): DoPlan {
  const lower = text.trim().toLowerCase();
  if (CHECK_RE.test(lower)) return { steps: [], reading: [{ text: lower, as: 'check: is this typical?' }], unknown: [], intent: 'check' };
  if (TEACH_RE.test(lower)) return { steps: [], reading: [{ text: lower, as: 'teach the selection' }], unknown: [], intent: 'teach' };
  const taught = matchTaught(text);
  if (taught) return taughtPlan(taught.move, taught.args, ctx);
  const grid = readGridRules(text);
  if (grid) return { steps: [{ kind: 'gridRules', preset: grid.phrase.id, params: gridRulesParams(grid), label: gridRulesLabel(grid), beside: ctx.selected[0] }], reading: grid.reading, unknown: [] };
  const tokens = tokenize(text);
  const { items, unknown } = read(tokens);
  const reading: DoPlan['reading'] = items.map(it => ({
    text: it.text,
    as: it.t === 'shape' ? `shape: ${it.shape.id}${it.fuzzy ? ' (guessed)' : ''}` : it.t === 'action' ? `do: ${it.id}${it.fuzzy ? ' (guessed)' : ''}` : it.t === 'target' ? `on: ${it.target}` : it.t === 'place' ? `at ${it.at.join(', ')}`
      : it.t === 'slot' ? `${it.slot} = ${it.value}` : it.t === 'number' ? `number ${it.value}` : 'colour',
  }));
  const byId = new Map(ctx.nodes.map(nd => [nd.id, nd]));
  const selected = ctx.selected.map(id => byId.get(id)).filter((nd): nd is GraphNode => !!nd);
  const steps: DoStep[] = [];
  const plan: DoPlan = { steps, reading, unknown };
  if (!items.some(it => it.t === 'shape' || it.t === 'action')) {
    plan.problem = items.length ? 'No shape or action in that.' : undefined;
    return plan;
  }

  // Group: each shape or action opens a group; the words after it (until the next) belong to it.
  type Group = { head: Item & ({ t: 'shape' } | { t: 'action' }); target?: string; slots: Array<{ slot: string; value: number }>; numbers: number[]; colours: RGB[]; place?: [number, number] };
  const groups: Group[] = [];
  let pendingTarget: string | undefined;
  const preface: Item[] = [];
  for (const it of items) {
    if (it.t === 'shape' || it.t === 'action') {
      groups.push({ head: it, target: pendingTarget, slots: [], numbers: [], colours: [] });
      pendingTarget = undefined;
      // Words before the first head ("these colours, mix") belong to it.
      for (const p of preface.splice(0)) absorb(groups[groups.length - 1], p);
      continue;
    }
    if (it.t === 'target') {
      const g = groups[groups.length - 1];
      // "tone map it", "twist the space": a target after an action is that action's.
      if (g && g.head.t === 'action' && !g.target) g.target = it.target;
      else pendingTarget = it.target;
      continue;
    }
    const g = groups[groups.length - 1];
    if (g) absorb(g, it); else preface.push(it);
  }
  function absorb(g: Group, it: Item) {
    if (it.t === 'slot') g.slots.push({ slot: it.slot, value: it.value });
    else if (it.t === 'number') g.numbers.push(it.value);
    else if (it.t === 'colour') g.colours.push(it.rgb);
    else if (it.t === 'place') g.place = it.at;
    else if (it.t === 'target') g.target = it.target;
  }

  const shown = graphOutput(ctx.nodes)?.inputs.color?.connection?.nodeId;
  let subject: NodeRef | null = null;
  let subjectShape: ShapeWord | null = null;
  const nodeOf = (ref: NodeRef | null) => (ref && !ref.startsWith('$') ? byId.get(ref) : undefined);

  for (const g of groups) {
    if (g.head.t === 'shape') {
      const sh = g.head.shape;
      if (!sh.node2d) { plan.problem = `${sh.words[0]} is a 3D shape: build it with the 3D Scene Builder.`; continue; }
      const params: Record<string, unknown> = { ...(sh.node2d.params ?? {}) };
      const size = g.slots.find(s => s.slot === 'radius')?.value ?? g.numbers[0];
      if (size !== undefined && sh.node2d.size) {
        params[sh.node2d.size] = size;
        if (sh.node2d.type === 'boxSDF') params.height = size;
      }
      if (g.colours.length) params.__colour = g.colours[0];
      steps.push({ kind: 'shape', shape: sh.id, type: sh.node2d.type, params, place: g.place, label: `Add ${getNodeDefinition(sh.node2d.type)?.label ?? sh.id}${sh.node2d.params?.shape ? ` (${sh.id})` : ''}${g.place ? ` at ${g.place.join(', ')}` : ''}${size !== undefined ? `, size ${size}` : ''}` });
      subject = `$${steps.length - 1}`;
      subjectShape = sh;
      continue;
    }
    // An action.
    let target: NodeRef | null = subject;
    let pair: GraphNode | undefined;
    if (g.target === 'selection' || (!target && selected.length)) target = selected[0]?.id ?? target;
    if (g.target === 'pair') {
      if (selected.length >= 2) { target = selected[0].id; pair = selected[1]; }
      else target = selected[0]?.id ?? target;
    }
    if (g.target === 'picture') target = shown ?? target;
    if (!target) target = shown ?? null;
    if (!target) { plan.problem = 'Select a node, or name a shape ("circle with a glow").'; continue; }
    const isNewShape = target.startsWith('$');
    const subjectNode = nodeOf(target);
    const r = resolveAction(g.head.id, subjectNode, isNewShape, pair);
    if (r.problem) { plan.problem = r.problem; continue; }
    const move = moveById(r.moveId);
    if (!move) { plan.problem = `Nothing does “${g.head.text}” yet.`; continue; }
    const words = tokens;
    const args = fillArgs(move, g.slots, g.numbers, g.colours, words);
    if (pair) {
      const pk = outputKinds(pair)[0];
      args.other = pair.id; args.otherKey = pk?.key;
    }
    // Where it goes: a space move in front of the subject's UV (or after it, when it is a space);
    // a colour move on the colour the subject ends up as; anything else on its main output.
    let node: string = target, key = '', side: 'in' | 'out' = 'out';
    if (r.spaceTarget || g.target === 'space') {
      const subjectKind = isNewShape ? 'distance' : kindOf(subjectNode);
      if (subjectKind === 'space') key = outputKinds(subjectNode!)[0].key;
      else if (isNewShape) { key = (subjectShape?.node2d?.type === 'shapeSDF' || subjectShape?.node2d?.type === 'simpleSDF') ? 'p' : 'position'; side = 'in'; }
      else {
        const s = subjectNode ? spaceInputs(subjectNode)[0] : undefined;
        if (!s) { plan.problem = `${subjectNode ? labelOf(subjectNode) : 'That'} has no space (UV) input to ${g.head.text}.`; continue; }
        key = s.key; side = 'in';
      }
    } else if (r.colourTarget) {
      if (isNewShape) { plan.problem = `Make it a picture first ("${subjectShape?.words[0] ?? 'shape'} with a glow"), then ${g.head.text}.`; continue; }
      const c = subjectNode && outputKinds(subjectNode).some(o => o.kind === 'colour') ? subjectNode : subjectNode ? colourFrom(ctx.nodes, subjectNode.id) : undefined;
      if (!c) { plan.problem = 'There is no colour to do that to yet.'; continue; }
      node = c.id;
      key = outputKinds(c).find(o => o.kind === 'colour')!.key;
    } else if (isNewShape) {
      key = 'distance';
    } else {
      const outs = subjectNode ? outputKinds(subjectNode) : [];
      const fit = outs.find(o => move.kinds.includes(o.kind)) ?? outs[0];
      if (!fit) { plan.problem = `${subjectNode ? labelOf(subjectNode) : 'That'} has no output to ${g.head.text}.`; continue; }
      key = fit.key;
    }
    const where = node === target ? '' : ` on ${labelOf(byId.get(node)!)}`;
    const detail = describeArgs(move, args);
    steps.push({ kind: 'move', moveId: move.id, node, key, side, args, label: `${move.label}${where}${pair ? ` with ${labelOf(pair)}` : ''}${detail ? ` · ${detail}` : ''}` });
    // A move's result becomes the subject for what follows ("… with a glow, then tone map it").
    subject = node;
  }
  return plan;
}

/** A plan for a taught phrase: on the selection's matching output, or (a chain that makes something new) added on its own. */
function taughtPlan(t: TaughtMove, args: Record<string, unknown>, ctx: DoContext): DoPlan {
  const label = `${phraseLabel(t.phrase)} (taught)${Object.keys(args).length ? ` · ${Object.entries(args).map(([k, v]) => `${k} ${Array.isArray(v) ? 'colour' : v}`).join(', ')}` : ''}`;
  const plan: DoPlan = { steps: [], reading: [{ text: t.phrase, as: 'taught phrase' }], unknown: [] };
  if (!t.entry) { plan.steps.push({ kind: 'chain', taughtId: t.id, args, label }); return plan; }
  const byId = new Map(ctx.nodes.map(nd => [nd.id, nd]));
  const shown = graphOutput(ctx.nodes)?.inputs.color?.connection?.nodeId;
  const candidates = [...ctx.selected, ...(shown ? [shown] : [])].map(id => byId.get(id)).filter((nd): nd is GraphNode => !!nd);
  for (const nd of candidates) {
    const out = outputKinds(nd).find(o => o.kind === t.entry!.kind);
    if (out) { plan.steps.push({ kind: 'move', moveId: `taught:${t.id}`, node: nd.id, key: out.key, side: 'out', args, label }); return plan; }
  }
  plan.problem = `“${phraseLabel(t.phrase)}” works on ${t.entry.kind === 'colour' ? 'a colour' : `a ${t.entry.kind}`}: select one.`;
  return plan;
}

// ── Running a plan ──────────────────────────────────────────────────────────

const PLACE_PARAMS: Record<string, [string, string]> = { circleSDF: ['posX', 'posY'], boxSDF: ['posX', 'posY'], ringSDF: ['posX', 'posY'] };

export interface DoResult {
  nodes: GraphNode[];
  added: string[];
  /** The node to select afterwards. */
  select: string | null;
  /** Labels of the steps that ran. */
  ran: string[];
}

/** Apply a plan to the level `nodes` (pure). */
export function runDoPlan(nodes: GraphNode[], plan: DoPlan, nextId: () => string, opts: { topLevel?: boolean; heightOf?: (nd: GraphNode) => number } = {}): DoResult {
  const heightOf = opts.heightOf ?? cardHeight;
  let cur = nodes;
  const added: string[] = [];
  const ran: string[] = [];
  const made = new Map<string, string>();
  let select: string | null = null;
  const real = (ref: NodeRef) => (ref.startsWith('$') ? made.get(ref) : ref);
  plan.steps.forEach((step, k) => {
    if (step.kind === 'gridRules') {
      const r = addGridRules(cur, step.params, step.beside ? [step.beside] : [], nextId, { topLevel: opts.topLevel, heightOf });
      cur = r.nodes;
      added.push(...r.added);
      select = r.id;
      ran.push(step.label);
      return;
    }
    if (step.kind === 'shape') {
      // A row below the graph, left-aligned with it; free space found by placeNear.
      const xs = cur.map(nd => nd.position.x), ys = cur.map(nd => nd.position.y + heightOf(nd));
      const x0 = xs.length ? Math.min(...xs) : 0, y0 = ys.length ? Math.max(...ys) + 120 : 0;
      const uvId = nextId(), shapeId = nextId();
      const { __colour, ...params } = step.params;
      void __colour;
      const extra: GraphNode[] = [n('uv', uvId, x0, y0, { __comment: 'UV: the position of each pixel, (0, 0) in the middle.\nWhy: the space the shape is drawn in (added by the Do… bar).' })];
      let pos: [string, string] = [uvId, 'uv'];
      const pp = PLACE_PARAMS[step.type];
      if (step.place && pp) { params[pp[0]] = step.place[0]; params[pp[1]] = step.place[1]; }
      else if (step.place) {
        const mv = exprBlock(nextId(), x0 + 420, y0, {
          label: 'Move to', inputs: [{ name: 'p', type: 'vec2' }], result: `p - vec2(${step.place[0].toFixed(2)}, ${step.place[1].toFixed(2)})`, outputType: 'vec2', wires: { p: [uvId, 'uv'] },
          comment: `Move to (Expression Block): shifts the space so the shape sits at (${step.place.join(', ')}).\nWhy: the Do… bar placed it there.`,
        });
        extra.push(mv);
        pos = [mv.id, 'result'];
      }
      const def = getNodeDefinition(step.type)!;
      const posKey = def.inputs.position ? 'position' : 'p';
      const shape = n(step.type, shapeId, x0 + 840, y0, { ...params, __comment: `${def.label}: a shape as a distance (negative inside, 0 on the edge).\nWhy: added by the Do… bar.` }, { [posKey]: pos });
      const placed = placeNear(cur, [...extra, shape], heightOf);
      cur = [...cur, ...placed];
      added.push(...placed.map(nd => nd.id));
      made.set(`$${k}`, shapeId);
      select = shapeId;
      ran.push(step.label);
      // Shown only when nothing later in the plan works on it and the Output is empty.
      const usedLater = plan.steps.slice(k + 1).some(s => s.kind === 'move' && s.node === `$${k}`);
      const out = graphOutput(cur);
      if (!usedLater && (!out || !out.inputs.color?.connection)) {
        const paint = n('sdfFill', nextId(), x0 + 1260, y0, { antialias: 0.006, __comment: 'SDF Fill: paints the shape.\nWhy: the Output showed nothing, so the Do… bar shows the new shape.' }, { d: [shapeId, 'distance'] });
        const placedPaint = placeNear(cur, [paint], heightOf);
        cur = [...cur, ...placedPaint];
        added.push(paint.id);
        if (out) cur = cur.map(nd => (nd.id === out.id ? { ...nd, inputs: { ...nd.inputs, color: { ...nd.inputs.color, connection: { nodeId: paint.id, outputKey: 'result' } } } } : nd));
        else if (opts.topLevel !== false) {
          const o = n('output', nextId(), x0 + 1680, y0, { __comment: 'Output: what the canvas shows. Added by the Do… bar.' }, { color: [paint.id, 'result'] });
          cur = [...cur, ...placeNear(cur, [o], heightOf)];
          added.push(o.id);
        }
      }
      return;
    }
    if (step.kind === 'chain') {
      const t = taughtMoves().find(x => x.id === step.taughtId);
      if (!t) return;
      const xs = cur.map(nd => nd.position.x), ys = cur.map(nd => nd.position.y + heightOf(nd));
      const x0 = xs.length ? Math.min(...xs) : 0, y0 = ys.length ? Math.max(...ys) + 120 : 0;
      const built = t.nodes.map(nd => {
        const params = { ...nd.params };
        for (const sl of t.slots) if (sl.nodeId === nd.id && step.args[sl.name] !== undefined) params[sl.param] = step.args[sl.name];
        return { ...nd, params, position: { x: x0 + nd.position.x - 420, y: y0 + nd.position.y } };
      });
      const { nodes: fresh, idOf } = freshIds(built, nextId);
      const placed = placeNear(cur, fresh, heightOf);
      cur = [...cur, ...placed];
      added.push(...placed.map(nd => nd.id));
      const exitId = idOf(t.exit.nodeId);
      select = exitId;
      ran.push(step.label);
      const out = graphOutput(cur);
      if (out && !out.inputs.color?.connection && t.exit.type === 'vec3') {
        cur = cur.map(nd => (nd.id === out.id ? { ...nd, inputs: { ...nd.inputs, color: { ...nd.inputs.color, connection: { nodeId: exitId, outputKey: t.exit.key } } } } : nd));
      }
      return;
    }
    const id = real(step.node);
    const move = moveById(step.moveId);
    if (!id || !move) return;
    const r = applyMove(cur, { nodeId: id, key: step.key, side: step.side }, move, step.args, nextId, { topLevel: opts.topLevel, heightOf });
    if (!r) return;
    cur = r.nodes;
    added.push(...r.added);
    select = r.resultNodeId ?? id;
    ran.push(step.label);
    // What follows works on the result.
    if (r.resultNodeId) for (const [ref, rid] of made) if (rid === id) made.set(ref, id);
  });
  return { nodes: cur, added, select, ran };
}
