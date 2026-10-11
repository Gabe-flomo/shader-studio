/**
 * mute.ts — muting a builder card for a while (docs/scene-builder.md, "Muting").
 *
 * Every builder's stacked or optional pieces (a space transform, a layer, a warp, an effect, a
 * rule, a behaviour) can carry `muted`. A muted piece keeps all its settings and stays in the
 * spec, the recipe (with a `muted` flag) and, where it can, the graph:
 *
 *  - preferred: it is still built, and the node that carries its work gets a mute gate
 *    (compiler/muteGate.ts): its output is mixed back to what came in by a uniform, so muting and
 *    unmuting set a number and nothing recompiles. In the graph the node shows the bypass style;
 *  - fallback: where nothing passes through (a motion, a behaviour), the build leaves it out.
 *
 * `muted` absent means "never muted": the build is exactly what it was before muting existed. Once
 * a piece has been muted, `muted: false` keeps its gate in the graph so the next toggle is live.
 *
 * Pure: no React, no store.
 */
import type { GraphNode } from '../types/nodeGraph';
import { MUTE_FROM_PARAM, MUTE_PARAM, MUTE_TO_PARAM } from '../compiler/muteGate';
import type { Arg as AstArg } from '../lang/ast';

export { MUTE_FROM_PARAM, MUTE_PARAM, MUTE_TO_PARAM };

/** Anything a builder can mute. */
export interface Mutable { muted?: boolean }

/** The recipe flag. */
export const MUTED_WORD = 'muted';

/** A far distance: a muted shape's distance, so it draws nothing (and unions, cuts and glows ignore it). */
export const FAR = '1e5';

export const isMuted = (x: Mutable | null | undefined): boolean => !!x?.muted;

/** The pieces of a list that build (not muted). */
export const live = <T extends Mutable>(xs: readonly T[]): T[] => xs.filter(x => !x.muted);

/** The node shows the builder mute (the bypass style in the graph). */
export function nodeMuted(n: Pick<GraphNode, 'params'> | null | undefined): boolean {
  return typeof n?.params?.[MUTE_PARAM] === 'number' && (n.params[MUTE_PARAM] as number) > 0;
}

/**
 * Give `node` a mute gate: while `muted`, its outputs are `from` (an input key) or, for a float
 * output, `to` (a GLSL literal). Nothing when `muted` is undefined (never muted).
 */
export function gateNode(node: GraphNode | null | undefined, muted: boolean | undefined, opts: { from?: string; to?: string } = {}): void {
  if (!node || muted === undefined) return;
  // Two pieces can share a node (a layer and the look's glow): muted when either is.
  const was = node.params[MUTE_PARAM];
  node.params[MUTE_PARAM] = Math.max(typeof was === 'number' ? was : 0, muted ? 1 : 0);
  if (opts.from && typeof node.params[MUTE_FROM_PARAM] !== 'string') node.params[MUTE_FROM_PARAM] = opts.from;
  if (opts.to && typeof node.params[MUTE_TO_PARAM] !== 'string') node.params[MUTE_TO_PARAM] = opts.to;
}

type Ref = { nodeId: string; outputKey: string };

/**
 * Gate the chain of nodes from `from` to `to` (the piece's work): each node on the path passes the
 * input that leads back to `from`, so muted, `to` gives what `from` gave. Returns the gated nodes.
 * Nothing when `muted` is undefined or `to` is `from`.
 */
export function gateChain(nodes: GraphNode[], from: Ref, to: Ref, muted: boolean | undefined): GraphNode[] {
  if (muted === undefined || (from.nodeId === to.nodeId && from.outputKey === to.outputKey)) return [];
  const byId = new Map(nodes.map(n => [n.id, n]));
  const reaches = new Map<string, boolean>();
  const leadsBack = (id: string, depth = 0): boolean => {
    if (id === from.nodeId) return true;
    if (reaches.has(id)) return reaches.get(id)!;
    reaches.set(id, false);
    const n = byId.get(id);
    const hit = !!n && depth < 200 && Object.values(n.inputs).some(s => !!s.connection && leadsBack(s.connection.nodeId, depth + 1));
    reaches.set(id, hit);
    return hit;
  };
  const gated: GraphNode[] = [];
  let at: string | null = to.nodeId;
  const seen = new Set<string>();
  while (at && at !== from.nodeId && !seen.has(at)) {
    seen.add(at);
    const n = byId.get(at);
    if (!n) break;
    const entries = Object.entries(n.inputs).filter(([, s]) => !!s.connection);
    // The input wired straight from `from` wins; else the first that leads back to it.
    const direct = entries.find(([, s]) => s.connection!.nodeId === from.nodeId && s.connection!.outputKey === from.outputKey);
    const next = direct ?? entries.find(([, s]) => leadsBack(s.connection!.nodeId));
    if (!next) break;
    gateNode(n, muted, { from: next[0] });
    gated.push(n);
    at = direct ? null : next[1].connection!.nodeId;
  }
  return gated;
}

// ── Editing ────────────────────────────────────────────────────────────────

/** Flip one piece's mute. */
export function toggleMuted(x: Mutable): void {
  x.muted = !x.muted;
}

/**
 * Solo `id` in its stack (Alt/Option-click): the others muted, it live. Soloing the one already
 * soloed unmutes the whole stack.
 */
export function soloIn<T extends Mutable & { id: string }>(xs: T[], id: string): void {
  const me = xs.find(x => x.id === id);
  if (!me) return;
  const alreadySolo = !me.muted && xs.every(x => x.id === id || x.muted);
  for (const x of xs) {
    if (alreadySolo) { if (x.muted) x.muted = false; }
    else if (x.id === id) { if (x.muted) x.muted = false; }
    else x.muted = true;
  }
}

/** Solo for a set of named switches (a look's effects): the same, by key. */
export function soloKeys<K extends string>(mutes: Partial<Record<K, boolean>>, keys: readonly K[], key: K): Partial<Record<K, boolean>> {
  const alreadySolo = !mutes[key] && keys.every(k => k === key || mutes[k]);
  const out: Partial<Record<K, boolean>> = { ...mutes };
  for (const k of keys) {
    if (alreadySolo) { if (out[k]) out[k] = false; }
    else if (k === key) { if (out[k]) out[k] = false; }
    else out[k] = true;
  }
  return out;
}

// ── Recipe ─────────────────────────────────────────────────────────────────

/** True for the bare `muted` flag. */
export function isMutedArg(a: AstArg): boolean {
  return a.key === null && (a.value.k === 'word' || a.value.k === 'str') && a.value.v.toLowerCase() === MUTED_WORD;
}

/** A clause's settings without its `muted` flag, and whether it had one. */
export function takeMuted(args: AstArg[]): { muted: boolean; rest: AstArg[] } {
  const rest = args.filter(a => !isMutedArg(a));
  return { muted: rest.length !== args.length, rest };
}

/** ` muted` after a muted clause, '' otherwise. */
export const mutedSuffix = (x: Mutable | null | undefined): string => (x?.muted ? ` ${MUTED_WORD}` : '');

/** The help for the flag (lang/help.ts shows it on hover in every builder's recipe). */
export const MUTED_HELP = {
  title: 'Muted',
  summary: 'Switched off for now: the clause keeps its settings but is left out of the picture.',
  more: 'A muted clause is bypassed: the chain runs as if it were not there, so you can see the picture without it. '
    + 'Its settings stay, and taking the word away (or clicking the eye on its card) turns it back on. '
    + 'Alt/Option-click the eye on a card to solo it: every other card in that stack is muted.',
  example: 'mirror xy muted',
};
