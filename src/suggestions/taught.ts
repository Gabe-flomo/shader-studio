/**
 * taught.ts — moves you teach the Do… bar (docs/suggestions.md).
 *
 * Select a few wired nodes (or one node with the settings you like), "Teach the Do bar…", and
 * give a phrase with optional slots: "neon edge {colour} {width}". The selection is saved as a
 * move: its nodes and the wires between them, where the value comes in (the first wire from
 * outside the selection) and where the result goes out. Afterwards typing the phrase builds that
 * chain with the slots filled ("neon edge pink 0.02"), the suggestions strip offers it on the
 * same kind of value, and the shared vocabulary (lang/vocabulary.ts) means builders that use it
 * can call it too.
 *
 * Stored in this browser (localStorage `playfield:suggestions:taught`), listed in the Do… bar's
 * Taught list (rename, delete, export to a file, import one).
 */
import type { GraphNode } from '../types/nodeGraph';
import { getNodeDefinition } from '../nodes/definitions';
import { PARAMS, colourOf, editDistance, fuzzBudget, numberOf, tokenize, FILLER, type RGB } from '../lang/vocabulary';
import { IN, labelOf, setExtraMoves, type Move, type MoveArg } from './moves';
import { socketKind, type ValueKind } from './kinds';

export const TAUGHT_KEY = 'playfield:suggestions:taught';

export interface TaughtSlot {
  name: string;
  /** The node (its id in `nodes`) and setting the slot fills. */
  nodeId: string;
  param: string;
  kind: 'number' | 'colour';
  default: number | RGB;
}

export interface TaughtMove {
  id: string;
  /** The phrase, with slots in braces: "neon edge {colour} {width}". */
  phrase: string;
  /** The selection: nodes with the wires between them, positions relative (first column at x = 420). */
  nodes: GraphNode[];
  /** Where the value comes in: an input of one of `nodes`. Absent: the chain makes something new. */
  entry?: { nodeId: string; key: string; type: string; kind: ValueKind };
  /** Where the result goes out. */
  exit: { nodeId: string; key: string; type: string };
  slots: TaughtSlot[];
  createdAt: number;
}

// ── Storage ─────────────────────────────────────────────────────────────────

let cache: TaughtMove[] | null = null;
let version = 0;
const listeners = new Set<() => void>();

export function taughtMoves(): TaughtMove[] {
  if (!cache) {
    try {
      const raw = JSON.parse(localStorage.getItem(TAUGHT_KEY) ?? '[]') as unknown;
      cache = Array.isArray(raw) ? (raw as TaughtMove[]).filter(t => t && typeof t.id === 'string' && Array.isArray(t.nodes) && typeof t.phrase === 'string') : [];
    } catch { cache = []; }
  }
  return cache;
}

function save(list: TaughtMove[]): void {
  cache = list;
  version++;
  movesCache = null;
  try { localStorage.setItem(TAUGHT_KEY, JSON.stringify(list)); } catch { /* full: this session only */ }
  for (const fn of listeners) fn();
}

export const subscribeTaught = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
export const taughtVersion = () => version;

/** For tests: forget the cached list (re-read from storage). */
export function reloadTaught(): void { cache = null; movesCache = null; version++; }

export function deleteTaught(id: string): void { save(taughtMoves().filter(t => t.id !== id)); }

export function renameTaught(id: string, phrase: string): { ok: boolean; error?: string } {
  const t = taughtMoves().find(x => x.id === id);
  if (!t) return { ok: false, error: 'It is gone.' };
  const slots = slotNames(phrase);
  const missing = t.slots.filter(s => !slots.includes(s.name)).map(s => s.name);
  if (missing.length) return { ok: false, error: `Keep the slots {${missing.join('}, {')}} in the phrase.` };
  if (!literalWords(phrase).length) return { ok: false, error: 'The phrase needs at least one word besides its slots.' };
  save(taughtMoves().map(x => (x.id === id ? { ...x, phrase: phrase.trim() } : x)));
  return { ok: true };
}

/** All taught moves as JSON (a file to keep or share). */
export function exportTaught(ids?: string[]): string {
  const list = taughtMoves().filter(t => !ids || ids.includes(t.id));
  return JSON.stringify({ kind: 'playfield-taught-moves', version: 1, moves: list }, null, 2);
}

/** Add moves from an exported file; ones already here (same id) are replaced. */
export function importTaught(json: string): { ok: boolean; count: number; error?: string } {
  try {
    const data = JSON.parse(json) as { kind?: string; moves?: TaughtMove[] };
    if (data.kind !== 'playfield-taught-moves' || !Array.isArray(data.moves)) return { ok: false, count: 0, error: 'Not a taught-moves file.' };
    const valid = data.moves.filter(t => t && typeof t.id === 'string' && Array.isArray(t.nodes) && typeof t.phrase === 'string' && t.exit && t.nodes.every(nd => getNodeDefinition(nd.type)));
    const ids = new Set(valid.map(t => t.id));
    save([...taughtMoves().filter(t => !ids.has(t.id)), ...valid]);
    return { ok: true, count: valid.length };
  } catch (e) {
    return { ok: false, count: 0, error: e instanceof Error ? e.message : String(e) };
  }
}

// ── Teaching ────────────────────────────────────────────────────────────────

const slotNames = (phrase: string) => [...phrase.matchAll(/\{\s*([a-zA-Z][\w-]*)\s*\}/g)].map(m => m[1].toLowerCase());
const literalWords = (phrase: string) => tokenize(phrase.replace(/\{[^}]*\}/g, ' ')).filter(w => !FILLER.has(w));

const OUTPUT_TYPES = new Set(['output', 'vec4Output', 'passOutput']);

/** The setting a slot name means on these nodes: key, label, or a vocabulary synonym. */
function findParam(nodes: GraphNode[], slot: string): { nodeId: string; param: string; kind: 'number' | 'colour'; value: number | RGB } | null {
  const wantsColour = /^colou?r$|^tint$|^hue$/.test(slot);
  const synonyms = Object.entries(PARAMS).find(([k, words]) => k === slot || words.includes(slot))?.[1] ?? [];
  const names = [slot, ...synonyms];
  for (const pass of [0, 1, 2] as const) {
    for (const nd of nodes) {
      const defs = getNodeDefinition(nd.type)?.paramDefs ?? {};
      for (const [key, pd] of Object.entries(defs)) {
        const v = nd.params[key] ?? (getNodeDefinition(nd.type)?.defaultParams ?? {})[key];
        const isColour = pd.type === 'vec3color' || (Array.isArray(v) && v.length === 3);
        const isNumber = typeof v === 'number' && (pd.type === 'float' || pd.type === undefined);
        if (wantsColour ? !isColour : !isNumber) continue;
        const l = (pd.label ?? '').toLowerCase();
        const hit = pass === 0 ? key.toLowerCase() === slot || l === slot
          : pass === 1 ? names.some(nm => key.toLowerCase() === nm || l === nm || l.split(/\W+/).includes(nm))
            : wantsColour;
        if (hit) return { nodeId: nd.id, param: key, kind: isColour ? 'colour' : 'number', value: (isColour ? v : v) as number | RGB };
      }
    }
  }
  return null;
}

/**
 * Teach `phrase` from the nodes `ids` in `scope`. The first wire into the selection from outside
 * is where the value comes in; the first output read from outside (else the last node's main
 * output) is the result.
 */
export function teachFromSelection(scope: GraphNode[], ids: string[], phrase: string, now = Date.now()): { ok: true; move: TaughtMove } | { ok: false; error: string } {
  const set = new Set(ids);
  const sel = scope.filter(nd => set.has(nd.id) && !OUTPUT_TYPES.has(nd.type) && !nd.params.subgraph);
  if (!sel.length) return { ok: false, error: 'Select the nodes to teach (not the Output or a group).' };
  if (!literalWords(phrase).length) return { ok: false, error: 'Give it a phrase: a few words, with {slots} for the values to fill in.' };
  const left = Math.min(...sel.map(nd => nd.position.x)), top = Math.min(...sel.map(nd => nd.position.y));
  // Where the value comes in: the first outside wire, leftmost node first.
  let entry: TaughtMove['entry'];
  for (const nd of [...sel].sort((a, b) => a.position.x - b.position.x || a.position.y - b.position.y)) {
    const hit = Object.entries(nd.inputs).find(([, i]) => i.connection && !set.has(i.connection.nodeId));
    if (hit) {
      const [key, input] = hit;
      const src = scope.find(x => x.id === input.connection!.nodeId);
      const kind = src ? socketKind(src.type, input.connection!.outputKey, src.outputs[input.connection!.outputKey] ?? input, 'out') : socketKind(nd.type, key, input, 'in');
      if (kind) { entry = { nodeId: nd.id, key, type: input.type, kind }; break; }
    }
  }
  // Where the result goes out.
  const consumed = scope.filter(nd => !set.has(nd.id)).flatMap(nd => Object.values(nd.inputs).map(i => i.connection).filter((c): c is NonNullable<typeof c> => !!c && set.has(c.nodeId)));
  let exit: TaughtMove['exit'] | undefined;
  if (consumed.length) {
    const c = consumed[0];
    const nd = sel.find(x => x.id === c.nodeId)!;
    exit = { nodeId: nd.id, key: c.outputKey, type: nd.outputs[c.outputKey]?.type ?? 'float' };
  } else {
    const sinks = sel.filter(nd => !sel.some(o => Object.values(o.inputs).some(i => i.connection?.nodeId === nd.id)));
    const sink = sinks.sort((a, b) => b.position.x - a.position.x)[0] ?? sel[sel.length - 1];
    const outs = Object.entries(sink.outputs);
    const pick = outs.find(([, o]) => o.type === 'vec3') ?? outs[0];
    if (!pick) return { ok: false, error: `${labelOf(sink)} has no output to hand on.` };
    exit = { nodeId: sink.id, key: pick[0], type: pick[1].type };
  }
  // Slots.
  const slots: TaughtSlot[] = [];
  for (const name of slotNames(phrase)) {
    const p = findParam(sel, name);
    if (!p) return { ok: false, error: `No setting matches {${name}} in the selection. Use a setting's name, e.g. {${firstParamName(sel) ?? 'amount'}}.` };
    slots.push({ name, nodeId: p.nodeId, param: p.param, kind: p.kind, default: p.value });
  }
  // The snapshot: wires inside the selection kept, wires from outside dropped.
  const nodes: GraphNode[] = sel.map(nd => ({
    ...nd,
    position: { x: nd.position.x - left + 420, y: nd.position.y - top },
    inputs: Object.fromEntries(Object.entries(nd.inputs).map(([k, i]) => [k, i.connection && !set.has(i.connection.nodeId) ? { type: i.type, label: i.label } : i])),
    params: { ...nd.params },
  }));
  const move: TaughtMove = { id: `t${now.toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`, phrase: phrase.trim(), nodes, entry, exit, slots, createdAt: now };
  save([...taughtMoves(), move]);
  return { ok: true, move };
}

function firstParamName(nodes: GraphNode[]): string | undefined {
  for (const nd of nodes) for (const [k, pd] of Object.entries(getNodeDefinition(nd.type)?.paramDefs ?? {})) if (pd.type === 'float') return (pd.label ?? k).toLowerCase().split(/\W+/)[0];
  return undefined;
}

// ── As moves ────────────────────────────────────────────────────────────────

/** The label a phrase shows as: its words, slots dropped ("neon edge"). */
export const phraseLabel = (phrase: string) => phrase.replace(/\{[^}]*\}/g, '').replace(/\s+/g, ' ').trim();

export function taughtAsMove(t: TaughtMove): Move {
  const entryNode = t.entry ? t.nodes.find(nd => nd.id === t.entry!.nodeId) : undefined;
  const sameType = !!t.entry && t.entry.type === t.exit.type;
  const args: MoveArg[] = t.slots.map(s => ({ name: s.name, label: s.name, kind: s.kind === 'colour' ? 'colour' : 'number', default: s.default as number | RGB, words: [s.name] }));
  return {
    id: `taught:${t.id}`,
    label: phraseLabel(t.phrase),
    kinds: t.entry ? [t.entry.kind] : [],
    shape: sameType ? 'transform' : 'branch',
    sides: ['out'],
    hidden: !t.entry,
    anchor: entryNode && t.entry ? { type: entryNode.type, key: t.entry.key, out: t.exit.key } : undefined,
    why: 'you taught this',
    args,
    build: ctx => {
      const nodes = t.nodes.map(nd => {
        const params = { ...nd.params };
        for (const s of t.slots) if (s.nodeId === nd.id && ctx.args[s.name] !== undefined) params[s.param] = ctx.args[s.name];
        const note = String(params.__comment ?? '').trim();
        params.__comment = `${note ? `${note}\n` : `${labelOf(nd)}.\n`}Why: from your taught move “${phraseLabel(t.phrase)}”.`;
        const inputs = t.entry && nd.id === t.entry.nodeId
          ? { ...nd.inputs, [t.entry.key]: { ...nd.inputs[t.entry.key], connection: { nodeId: IN, outputKey: '' } } }
          : nd.inputs;
        return { ...nd, params, inputs };
      });
      return {
        nodes,
        result: [t.exit.nodeId, t.exit.key],
        show: sameType ? undefined : t.exit.type === 'vec3' ? (t.entry?.kind === 'distance' || t.entry?.kind === 'texture' ? 'layer' : 'replace') : 'ifEmpty',
      };
    },
  };
}

let movesCache: Move[] | null = null;
setExtraMoves(() => (movesCache ??= taughtMoves().map(taughtAsMove)));

// ── Matching a phrase ───────────────────────────────────────────────────────

/**
 * A taught phrase in `text`: every word of it in order (small typos allowed), slot values from the
 * numbers and colours typed ("neon edge pink 0.02": colour pink, width 0.02; or "width 0.02").
 * The longest phrase wins.
 */
export function matchTaught(text: string): { move: TaughtMove; args: Record<string, unknown> } | null {
  const tokens = tokenize(text);
  let best: { move: TaughtMove; args: Record<string, unknown>; words: number } | null = null;
  for (const t of taughtMoves()) {
    const words = literalWords(t.phrase);
    let at = 0;
    const used = new Set<number>();
    const ok = words.every(w => {
      for (let i = at; i < tokens.length; i++) {
        if (tokens[i] === w || (fuzzBudget(w) && editDistance(tokens[i], w, fuzzBudget(w)) <= fuzzBudget(w))) { used.add(i); at = i + 1; return true; }
      }
      return false;
    });
    if (!ok) continue;
    // Slot values: named ("width 0.02") first, then in order.
    const args: Record<string, unknown> = {};
    const free = tokens.map((tok, i) => ({ tok, i })).filter(x => !used.has(x.i));
    for (const s of t.slots) {
      const named = free.findIndex(x => x.tok === s.name);
      if (named >= 0 && free[named + 1]) {
        const v = s.kind === 'colour' ? colourOf(free[named + 1].tok) : numberOf(free[named + 1].tok);
        if (v !== null) { args[s.name] = v; used.add(free[named].i); used.add(free[named + 1].i); }
      }
    }
    for (const s of t.slots) {
      if (s.name in args) continue;
      const x = tokens.map((tok, i) => ({ tok, i })).find(y => !used.has(y.i) && (s.kind === 'colour' ? colourOf(y.tok) : numberOf(y.tok)) !== null);
      if (x) { args[s.name] = s.kind === 'colour' ? colourOf(x.tok) : numberOf(x.tok); used.add(x.i); }
    }
    if (!best || words.length > best.words) best = { move: t, args, words: words.length };
  }
  return best ? { move: best.move, args: best.args } : null;
}
